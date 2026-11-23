package com.pplaner.astrocamera

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureFailure
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.TotalCaptureResult
import android.hardware.camera2.params.OutputConfiguration
import android.hardware.camera2.params.RggbChannelVector
import android.hardware.camera2.params.SessionConfiguration
import android.media.Image
import android.media.ImageReader
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.util.Range
import android.util.Size
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.atan
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Android Camera2 기반 수동 장노출 · RAW_SENSOR/YUV 촬영 · 선형 누적 Expo 네이티브 모듈.
 *
 * Why expo-camera 대신 별도 모듈인가:
 *  - expo-camera는 자동 노출(AE) + JPEG 압축만 지원해 밤하늘 별이 8-bit 검은 바닥과
 *    블록 노이즈 아래로 묻힙니다.
 *  - 이 모듈은 NOISE_REDUCTION_MODE_OFF · 수동 셔터/ISO · 16-bit Bayer RAW(미지원 기기는
 *    무압축 YUV_420_888) 출력과 네이티브 float 누적을 제공해 JS 힙 없이 별을 합성합니다.
 */
class AstroCameraModule : Module() {
  private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  private var cameraThread: HandlerThread? = null
  private var cameraHandler: Handler? = null
  private var cameraDevice: CameraDevice? = null
  private var captureSession: CameraCaptureSession? = null
  private var imageReader: ImageReader? = null
  private var activeCameraId: String? = null
  private var activePhysicalId: String? = null
  private var activeZoomRatio: Float? = null
  private var activeFormat: Int = ImageFormat.YUV_420_888
  private var activeMaxLongEdge: Int = 2048
  private var activeChars: CameraCharacteristics? = null
  private val captureBusy = AtomicBoolean(false)
  private val frameCounter = AtomicInteger(0)
  private val activeImgLatch = AtomicReference<CountDownLatch?>(null)
  private val activeResLatch = AtomicReference<CountDownLatch?>(null)
  private val activeFailRef = AtomicReference<AtomicReference<String?>?>(null)

  @Volatile
  private var stackSession: AstroStackAccumulator.StackSession? = null
  private val previewCounter = AtomicInteger(0)
  @Volatile
  private var lastPreviewFile: File? = null

  private fun appContextSafe(): Context =
    appContext.reactContext ?: throw CodedException("ERR_CONTEXT", "React context is unavailable", null)

  private fun frameCacheDir(context: Context): File {
    val dir = File(context.cacheDir, "astro_frames")
    if (!dir.exists()) dir.mkdirs()
    return dir
  }

  private fun clearFrameCache(context: Context) {
    frameCacheDir(context).listFiles()?.forEach { it.delete() }
    lastPreviewFile?.delete()
    lastPreviewFile = null
  }

  private fun ensureThread(): Handler {
    if (cameraThread == null || !cameraThread!!.isAlive) {
      cameraThread = HandlerThread("AstroCamera2").apply { start() }
      cameraHandler = Handler(cameraThread!!.looper)
    }
    return cameraHandler!!
  }

  private data class ResolvedCameraTarget(
    val logicalId: String,
    val physicalId: String?,
    val logicalChars: CameraCharacteristics,
    val lensChars: CameraCharacteristics,
    val focalOverrideMm: Double?,
    val zoomRatio: Double?,
  )

  private fun pickCameraId(
    manager: CameraManager,
    facing: String,
    requestedId: String? = null,
  ): ResolvedCameraTarget {
    if (!requestedId.isNullOrEmpty()) {
      var logicalId = requestedId
      var physId: String? = null
      var zoomOverride: Double? = null
      var focalOverride: Double? = null
      if (requestedId.contains("#phys:")) {
        logicalId = requestedId.substringBefore("#phys:")
        physId = requestedId.substringAfter("#phys:")
      } else if (requestedId.contains("#focal:")) {
        logicalId = requestedId.substringBefore("#focal:")
        focalOverride = requestedId.substringAfter("#focal:").substringBefore("@z:").toDoubleOrNull()
        zoomOverride = requestedId.substringAfter("@z:", "").toDoubleOrNull()
      }
      if (manager.cameraIdList.contains(logicalId)) {
        val logCh = manager.getCameraCharacteristics(logicalId)
        val lensCh = if (!physId.isNullOrEmpty()) {
          try {
            manager.getCameraCharacteristics(physId)
          } catch (_: Throwable) {
            logCh
          }
        } else {
          logCh
        }
        return ResolvedCameraTarget(logicalId, physId, logCh, lensCh, focalOverride, zoomOverride)
      }
    }
    val wantLens = if (facing == "front") {
      CameraCharacteristics.LENS_FACING_FRONT
    } else {
      CameraCharacteristics.LENS_FACING_BACK
    }
    for (id in manager.cameraIdList) {
      val ch = manager.getCameraCharacteristics(id)
      if (ch.get(CameraCharacteristics.LENS_FACING) == wantLens) {
        return ResolvedCameraTarget(id, null, ch, ch, null, null)
      }
    }
    val fallback = manager.cameraIdList.firstOrNull()
      ?: throw CodedException("ERR_NO_CAMERA", "No Camera2 devices found", null)
    val fbCh = manager.getCameraCharacteristics(fallback)
    return ResolvedCameraTarget(fallback, null, fbCh, fbCh, null, null)
  }

  private fun supportsCapability(ch: CameraCharacteristics, cap: Int): Boolean {
    val caps = ch.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: return false
    return caps.contains(cap)
  }

  private fun chooseSize(sizes: Array<Size>?, maxEdge: Int?): Size? {
    if (sizes == null || sizes.isEmpty()) return null
    if (maxEdge == null) {
      return sizes.maxByOrNull { it.width.toLong() * it.height.toLong() }
    }
    val fit = sizes.filter { max(it.width, it.height) <= maxEdge }
    return (if (fit.isNotEmpty()) fit else sizes.toList())
      .maxByOrNull { it.width.toLong() * it.height.toLong() }
  }

  private fun estimateFocal35AndHfov(
    ch: CameraCharacteristics,
    focalOverrideMm: Double? = null,
  ): Pair<Double, Double> {
    val focalMm = focalOverrideMm
      ?: ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull()?.toDouble()
      ?: 4.5
    val phys = ch.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
    if (phys != null && phys.width > 0f && phys.height > 0f && focalMm > 0.1) {
      val diagMm = hypot(phys.width.toDouble(), phys.height.toDouble())
      val focal35 = focalMm * (43.2666 / diagMm)
      val hfovDeg = Math.toDegrees(2.0 * atan(phys.width.toDouble() / (2.0 * focalMm)))
      return focal35 to hfovDeg
    }
    return 24.0 to 65.0
  }

  private fun estimateZoomRange(ch: CameraCharacteristics): Pair<Double, Double> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val range = ch.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)
      if (range != null) {
        return max(0.2, range.lower.toDouble()) to max(1.0, range.upper.toDouble())
      }
    }
    val maxDig = ch.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM)?.toDouble() ?: 1.0
    return 1.0 to max(1.0, maxDig)
  }

  private fun buildRawParams(ch: CameraCharacteristics, result: TotalCaptureResult?): AstroStackAccumulator.RawParams {
    val cfa = ch.get(CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT)
      ?: CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_RGGB
    val wl = (ch.get(CameraCharacteristics.SENSOR_INFO_WHITE_LEVEL) ?: 1023).toFloat()
    val blackPattern = ch.get(CameraCharacteristics.SENSOR_BLACK_LEVEL_PATTERN)
    val bl = FloatArray(4) { 0f }
    if (blackPattern != null) {
      bl[0] = blackPattern.getOffsetForIndex(0, 0).toFloat()
      bl[1] = blackPattern.getOffsetForIndex(1, 0).toFloat()
      bl[2] = blackPattern.getOffsetForIndex(0, 1).toFloat()
      bl[3] = blackPattern.getOffsetForIndex(1, 1).toFloat()
    }

    val wb = floatArrayOf(1.6f, 1.0f, 1.4f)
    val gains: RggbChannelVector? = result?.get(CaptureResultKeyCompat.colorCorrectionGains())
    if (gains != null && gains.red > 0f && gains.greenEven > 0f && gains.blue > 0f) {
      val gAvg = 0.5f * (gains.greenEven + gains.greenOdd)
      // 녹색 채널을 1.0 기준으로 정규화해 노출 기준을 일정하게 유지
      val invG = if (gAvg > 1e-4f) 1.0f / gAvg else 1.0f
      wb[0] = gains.red * invG
      wb[1] = 1.0f
      wb[2] = gains.blue * invG
    }
    return AstroStackAccumulator.RawParams(cfa = cfa, blackLevels = bl, whiteLevel = wl, wbGains = wb)
  }

  private fun closeCameraLocked() {
    activeFailRef.get()?.compareAndSet(null, "Session closed")
    activeImgLatch.getAndSet(null)?.countDown()
    activeResLatch.getAndSet(null)?.countDown()
    try { captureSession?.abortCaptures() } catch (_: Throwable) {}
    try { captureSession?.close() } catch (_: Throwable) {}
    captureSession = null
    try { cameraDevice?.close() } catch (_: Throwable) {}
    cameraDevice = null
    try { imageReader?.close() } catch (_: Throwable) {}
    imageReader = null
    activeCameraId = null
    activePhysicalId = null
    activeZoomRatio = null
    activeChars = null
    try { cameraThread?.quitSafely() } catch (_: Throwable) {}
    cameraThread = null
    cameraHandler = null
  }

  override fun definition() = ModuleDefinition {
    Name("AstroCamera")

    OnDestroy {
      closeCameraLocked()
      stackSession = null
      ioScope.cancel()
    }

    AsyncFunction("getRearLensesAsync") {
      val ctx = appContextSafe()
      val manager = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val seenFocalBuckets = HashSet<Int>()
      data class RawLens(
        val cameraId: String,
        val logicalCameraId: String,
        val physicalCameraId: String?,
        val focalLengthMm: Double,
        val focal35mm: Double,
        val hfovDeg: Double,
        val minZoomRatio: Double,
        val maxZoomRatio: Double,
      )
      val rawList = mutableListOf<RawLens>()
      val topLevelBackIds = mutableListOf<String>()

      for (id in manager.cameraIdList) {
        val ch = manager.getCameraCharacteristics(id)
        if (ch.get(CameraCharacteristics.LENS_FACING) != CameraCharacteristics.LENS_FACING_BACK) continue
        topLevelBackIds.add(id)
        val (minZ, maxZ) = estimateZoomRange(ch)
        val focals = ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
        if (focals != null && focals.isNotEmpty()) {
          val baseFocalMm = focals[0].toDouble()
          val (baseFocal35, _) = estimateFocal35AndHfov(ch, baseFocalMm)
          for (idx in focals.indices) {
            val fMm = focals[idx].toDouble()
            val (f35, hfov) = estimateFocal35AndHfov(ch, fMm)
            val bucket = (f35 * 2.0).roundToInt()
            if (!seenFocalBuckets.add(bucket)) continue
            val token = if (idx == 0) {
              id
            } else {
              val z = max(0.5, f35 / max(1.0, baseFocal35))
              "$id#focal:$fMm@z:${((z * 100.0).roundToInt() / 100.0)}"
            }
            rawList.add(RawLens(token, id, null, fMm, f35, hfov, minZ, maxZ))
          }
        } else {
          val (f35, hfov) = estimateFocal35AndHfov(ch)
          val bucket = (f35 * 2.0).roundToInt()
          if (seenFocalBuckets.add(bucket)) {
            rawList.add(RawLens(id, id, null, 4.5, f35, hfov, minZ, maxZ))
          }
        }
      }

      // Android 9(API 28)+ 멀티카메라: 논리 카메라 안에 숨겨진 물리 서브 카메라(초광각·3배·5배 등) 추가 탐색
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        for (logicalId in topLevelBackIds) {
          val logCh = manager.getCameraCharacteristics(logicalId)
          val (minZ, maxZ) = estimateZoomRange(logCh)
          val physIds = logCh.physicalCameraIds
          for (physId in physIds) {
            if (physId == logicalId) continue
            try {
              val pCh = manager.getCameraCharacteristics(physId)
              if (pCh.get(CameraCharacteristics.LENS_FACING) != CameraCharacteristics.LENS_FACING_BACK) continue
              val fMm = pCh.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull()?.toDouble() ?: 4.5
              val (f35, hfov) = estimateFocal35AndHfov(pCh, fMm)
              val bucket = (f35 * 2.0).roundToInt()
              if (!seenFocalBuckets.add(bucket)) continue
              val directlyOpenable = manager.cameraIdList.contains(physId)
              val token = if (directlyOpenable) physId else "$logicalId#phys:$physId"
              rawList.add(
                RawLens(
                  cameraId = token,
                  logicalCameraId = if (directlyOpenable) physId else logicalId,
                  physicalCameraId = if (directlyOpenable) null else physId,
                  focalLengthMm = fMm,
                  focal35mm = f35,
                  hfovDeg = hfov,
                  minZoomRatio = minZ,
                  maxZoomRatio = maxZ,
                )
              )
            } catch (_: Throwable) {
              // 일부 제조사가 특정 physicalId 특성을 비공개 처리한 경우 안전히 건너뜀
            }
          }
        }
      }

      // 기준 광각(20~32mm에 가장 가까운 렌즈) 대비 각 렌즈의 상대 배율 산출
      val wideRef = rawList
        .filter { it.focal35mm in 20.0..34.0 }
        .minByOrNull { kotlin.math.abs(it.focal35mm - 24.0) }
        ?: rawList.firstOrNull()
      val baseFocal35 = wideRef?.focal35mm ?: 24.0

      rawList
        .sortedBy { it.focal35mm }
        .map { item ->
          val relZoom = max(0.5, item.focal35mm / max(1.0, baseFocal35))
          mapOf(
            "cameraId" to item.cameraId,
            "logicalCameraId" to item.logicalCameraId,
            "physicalCameraId" to (item.physicalCameraId ?: ""),
            "focalLengthMm" to item.focalLengthMm,
            "focal35mm" to item.focal35mm,
            "hfovDeg" to item.hfovDeg,
            "zoomRatio" to relZoom,
            "minZoomRatio" to item.minZoomRatio,
            "maxZoomRatio" to item.maxZoomRatio,
          )
        }
    }

    AsyncFunction("getCapabilitiesAsync") { facing: String?, cameraId: String? ->
      val ctx = appContextSafe()
      val manager = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val target = pickCameraId(manager, facing ?: "back", cameraId)
      val ch = target.lensChars
      val streamCh = target.logicalChars

      val hwLevel = ch.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL) ?: -1
      val rawCapable = supportsCapability(streamCh, CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_RAW)
      val manualCapable = supportsCapability(ch, CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR)
      val cfgMap = streamCh.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
      val rawSize = chooseSize(cfgMap?.getOutputSizes(ImageFormat.RAW_SENSOR), null)
      val yuvSize = chooseSize(cfgMap?.getOutputSizes(ImageFormat.YUV_420_888), 2560)
      val expRange: Range<Long>? = ch.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)
      val isoRange: Range<Int>? = ch.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)
      val (focal35, hfov) = estimateFocal35AndHfov(ch, target.focalOverrideMm)
      val focalMm = target.focalOverrideMm
        ?: ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull()?.toDouble()
        ?: 4.5
      val (minZ, maxZ) = estimateZoomRange(streamCh)
      val sensorOrient = ch.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
      val minFocusDist = ch.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE)?.toDouble() ?: 0.0

      mapOf(
        "available" to true,
        "cameraId" to target.logicalId,
        "hardwareLevel" to hwLevel,
        "rawSupported" to (rawCapable && rawSize != null),
        "manualSensorSupported" to manualCapable,
        "minExposureMs" to ((expRange?.lower ?: 100_000L) / 1e6),
        "maxExposureMs" to ((expRange?.upper ?: 1_000_000_000L) / 1e6),
        "minIso" to (isoRange?.lower ?: 100),
        "maxIso" to (isoRange?.upper ?: 3200),
        "focalLengthMm" to focalMm,
        "focal35mm" to focal35,
        "hfovDeg" to hfov,
        "minZoomRatio" to minZ,
        "maxZoomRatio" to maxZ,
        "sensorOrientation" to sensorOrient,
        "supportsFocusDistance" to (minFocusDist > 0.0),
        "rawWidth" to (rawSize?.width ?: 0),
        "rawHeight" to (rawSize?.height ?: 0),
        "yuvWidth" to (yuvSize?.width ?: 0),
        "yuvHeight" to (yuvSize?.height ?: 0),
      )
    }

    AsyncFunction("startSessionAsync") { opts: Map<String, Any?>, promise: Promise ->
      ioScope.launch {
        try {
          val ctx = appContextSafe()
          if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            promise.reject("ERR_PERMISSION", "CAMERA permission is not granted", null)
            return@launch
          }
          closeCameraLocked()
          clearFrameCache(ctx)
          frameCounter.set(0)

          val facing = (opts["facing"] as? String) ?: "back"
          val requestedCameraId = opts["cameraId"] as? String
          val preferRaw = (opts["preferRaw"] as? Boolean) ?: true
          activeMaxLongEdge = ((opts["maxLongEdge"] as? Number)?.toInt() ?: 2048).coerceIn(640, 4096)

          val manager = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
          val target = pickCameraId(manager, facing, requestedCameraId)
          val camId = target.logicalId
          val ch = target.logicalChars
          val lensCh = target.lensChars
          val cfgMap = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
          val rawCapable = supportsCapability(ch, CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_RAW)
          val rawSize = if (preferRaw && rawCapable) chooseSize(cfgMap?.getOutputSizes(ImageFormat.RAW_SENSOR), null) else null
          val yuvSize = chooseSize(cfgMap?.getOutputSizes(ImageFormat.YUV_420_888), activeMaxLongEdge)

          val chosenFormat: Int
          val chosenSize: Size
          if (rawSize != null) {
            chosenFormat = ImageFormat.RAW_SENSOR
            chosenSize = rawSize
          } else if (yuvSize != null) {
            chosenFormat = ImageFormat.YUV_420_888
            chosenSize = yuvSize
          } else {
            promise.reject("ERR_NO_STREAM", "No RAW_SENSOR or YUV_420_888 output stream available", null)
            return@launch
          }

          Log.i("AstroCamera", "startSession camId=$camId phys=${target.physicalId} fmt=$chosenFormat size=${chosenSize.width}x${chosenSize.height}")
          val handler = ensureThread()
          val openedDevice = openCameraBlocking(manager, camId, handler)
          val reader = ImageReader.newInstance(chosenSize.width, chosenSize.height, chosenFormat, 2)
          val session = try {
            createSessionBlocking(openedDevice, listOf(reader.surface), handler, target.physicalId)
          } catch (physErr: Throwable) {
            if (target.physicalId != null) {
              Log.w("AstroCamera", "Physical stream rejected (${physErr.message}), falling back to logical zoom")
              createSessionBlocking(openedDevice, listOf(reader.surface), handler, null)
            } else {
              throw physErr
            }
          }
          Log.i("AstroCamera", "startSession ready camId=$camId")

          cameraDevice = openedDevice
          imageReader = reader
          captureSession = session
          activeCameraId = camId
          activePhysicalId = target.physicalId
          activeZoomRatio = target.zoomRatio?.toFloat()
          activeChars = ch
          activeFormat = chosenFormat

          val (focal35, hfov) = estimateFocal35AndHfov(lensCh, target.focalOverrideMm)
          val outW = if (chosenFormat == ImageFormat.RAW_SENSOR) chosenSize.width / 2 else min(chosenSize.width, activeMaxLongEdge)
          val outH = if (chosenFormat == ImageFormat.RAW_SENSOR) chosenSize.height / 2 else ((outW.toDouble() * chosenSize.height) / chosenSize.width).toInt()

          promise.resolve(
            mapOf(
              "cameraId" to camId,
              "format" to if (chosenFormat == ImageFormat.RAW_SENSOR) "raw16" else "yuv",
              "streamWidth" to chosenSize.width,
              "streamHeight" to chosenSize.height,
              "outputWidth" to outW,
              "outputHeight" to outH,
              "focal35mm" to focal35,
              "hfovDeg" to hfov,
              "sensorOrientation" to (ch.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90),
            ),
          )
        } catch (t: Throwable) {
          closeCameraLocked()
          promise.reject("ERR_SESSION_START", t.message ?: "Failed to start AstroCamera session", t)
        }
      }
    }

    AsyncFunction("captureSubFrameAsync") { opts: Map<String, Any?>, promise: Promise ->
      ioScope.launch {
        if (!captureBusy.compareAndSet(false, true)) {
          promise.reject("ERR_BUSY", "A sub-frame capture is already in progress", null)
          return@launch
        }
        try {
          val ctx = appContextSafe()
          val dev = cameraDevice ?: throw CodedException("ERR_NO_SESSION", "Call startSessionAsync first", null)
          val session = captureSession ?: throw CodedException("ERR_NO_SESSION", "Capture session is not ready", null)
          val reader = imageReader ?: throw CodedException("ERR_NO_SESSION", "ImageReader is not ready", null)
          val ch = activeChars ?: throw CodedException("ERR_NO_SESSION", "Camera characteristics missing", null)
          val handler = ensureThread()

          val reqExposureMs = (opts["exposureMs"] as? Number)?.toDouble() ?: 4000.0
          val reqIso = (opts["iso"] as? Number)?.toInt() ?: 1600
          val focusDistance = (opts["focusDistance"] as? Number)?.toFloat() ?: 0.0f
          val lockInfinity = (opts["lockFocusInfinity"] as? Boolean) ?: true
          val deviceRotationDeg = (opts["deviceRotationDeg"] as? Number)?.toInt() ?: 0

          val expRange = ch.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)
          val isoRange = ch.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)
          val rawExpNs = (reqExposureMs * 1_000_000.0).toLong()
          val exposureNs = if (expRange != null) expRange.clamp(rawExpNs) else rawExpNs
          val isoVal = if (isoRange != null) isoRange.clamp(reqIso) else reqIso

          val manualCapable = supportsCapability(ch, CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR)
          val template = if (manualCapable) CameraDevice.TEMPLATE_MANUAL else CameraDevice.TEMPLATE_STILL_CAPTURE
          val reqBuilder = dev.createCaptureRequest(template).apply {
            addTarget(reader.surface)
            if (manualCapable) {
              set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_OFF)
              set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_OFF)
              set(CaptureRequest.SENSOR_EXPOSURE_TIME, exposureNs)
              set(CaptureRequest.SENSOR_SENSITIVITY, isoVal)
              // 프레임 타임이 셔터보다 짧아 잘리지 않도록 여유 보장
              set(CaptureRequest.SENSOR_FRAME_DURATION, exposureNs + 20_000_000L)
            } else {
              set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
              set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_OFF)
              set(CaptureRequest.SENSOR_EXPOSURE_TIME, exposureNs)
              set(CaptureRequest.SENSOR_SENSITIVITY, isoVal)
            }
            // 별을 노이즈/엣지로 착각해 깎아내지 않도록 ISP 후처리 끄기
            set(CaptureRequest.NOISE_REDUCTION_MODE, CaptureRequest.NOISE_REDUCTION_MODE_OFF)
            set(CaptureRequest.EDGE_MODE, CaptureRequest.EDGE_MODE_OFF)
            set(CaptureRequest.HOT_PIXEL_MODE, CaptureRequest.HOT_PIXEL_MODE_FAST)
            set(CaptureRequest.STATISTICS_FACE_DETECT_MODE, CaptureRequest.STATISTICS_FACE_DETECT_MODE_OFF)
            if (lockInfinity) {
              set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_OFF)
              set(CaptureRequest.LENS_FOCUS_DISTANCE, max(0f, focusDistance))
            }
            val wbList = opts["wbGains"] as? List<*>
            if (wbList != null && wbList.size >= 3) {
              val rG = max(0.2f, min(4.0f, (wbList[0] as? Number)?.toFloat() ?: 1.0f))
              val gG = max(0.2f, min(4.0f, (wbList[1] as? Number)?.toFloat() ?: 1.0f))
              val bG = max(0.2f, min(4.0f, (wbList[2] as? Number)?.toFloat() ?: 1.0f))
              set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_OFF)
              set(CaptureRequest.COLOR_CORRECTION_MODE, CaptureRequest.COLOR_CORRECTION_MODE_TRANSFORM_MATRIX)
              set(CaptureRequest.COLOR_CORRECTION_GAINS, RggbChannelVector(rG, gG, gG, bG))
            }
            val reqZoomRatio = (opts["zoomRatio"] as? Number)?.toFloat() ?: activeZoomRatio
            if (reqZoomRatio != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
              val zRange = ch.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)
              if (zRange != null) {
                set(CaptureRequest.CONTROL_ZOOM_RATIO, zRange.clamp(reqZoomRatio))
              }
            }
          }

          val imageRef = AtomicReference<Image?>()
          val resultRef = AtomicReference<TotalCaptureResult?>()
          val failRef = AtomicReference<String?>()
          val imgLatch = CountDownLatch(1)
          val resLatch = CountDownLatch(1)
          activeFailRef.set(failRef)
          activeImgLatch.set(imgLatch)
          activeResLatch.set(resLatch)
          var startWallMs = System.currentTimeMillis()
          var endWallMs = startWallMs
          Log.i("AstroCamera", "captureSubFrame start fmt=$activeFormat expMs=${exposureNs / 1_000_000L} iso=$isoVal")

          reader.setOnImageAvailableListener({ r ->
            try {
              val img = r.acquireLatestImage()
              if (img != null && !imageRef.compareAndSet(null, img)) {
                img.close()
              }
            } catch (e: Throwable) {
              failRef.compareAndSet(null, e.message ?: "Image acquire error")
            } finally {
              imgLatch.countDown()
            }
          }, handler)

          session.capture(
            reqBuilder.build(),
            object : CameraCaptureSession.CaptureCallback() {
              override fun onCaptureStarted(
                session: CameraCaptureSession,
                request: CaptureRequest,
                timestamp: Long,
                frameNumber: Long,
              ) {
                startWallMs = System.currentTimeMillis()
              }

              override fun onCaptureCompleted(
                session: CameraCaptureSession,
                request: CaptureRequest,
                result: TotalCaptureResult,
              ) {
                endWallMs = System.currentTimeMillis()
                resultRef.set(result)
                resLatch.countDown()
              }

              override fun onCaptureFailed(
                session: CameraCaptureSession,
                request: CaptureRequest,
                failure: CaptureFailure,
              ) {
                Log.w("AstroCamera", "onCaptureFailed reason=${failure.reason}")
                failRef.compareAndSet(null, "Capture failed reason=${failure.reason}")
                imgLatch.countDown()
                resLatch.countDown()
              }
            },
            handler,
          )

          val timeoutMs = (exposureNs / 1_000_000L) + 12_000L
          val gotImg = imgLatch.await(timeoutMs, TimeUnit.MILLISECONDS)
          resLatch.await(2000L, TimeUnit.MILLISECONDS)
          reader.setOnImageAvailableListener(null, null)

          val capturedImg = imageRef.get()
          val err = failRef.get()
          if (!gotImg || capturedImg == null) {
            capturedImg?.close()
            promise.reject("ERR_CAPTURE_TIMEOUT", err ?: "Timed out waiting for manual camera image", null)
            return@launch
          }

          val idx = frameCounter.incrementAndGet()
          val outFile = File(frameCacheDir(ctx), "frame_$idx.rgb16")
          val sensorOrient = ch.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
          val rotDeg = ((sensorOrient - deviceRotationDeg) % 360 + 360) % 360
          val totalRes = resultRef.get()

          val decoded = try {
            if (activeFormat == ImageFormat.RAW_SENSOR) {
              val rawParams = buildRawParams(ch, totalRes)
              AstroStackAccumulator.decodeRawImage(capturedImg, rawParams, rotDeg, outFile)
            } else {
              AstroStackAccumulator.decodeYuvImage(capturedImg, rotDeg, activeMaxLongEdge, outFile)
            }
          } finally {
            capturedImg.close()
          }

          val actualExpNs = totalRes?.get(TotalCaptureResult.SENSOR_EXPOSURE_TIME) ?: exposureNs
          val actualIso = totalRes?.get(TotalCaptureResult.SENSOR_SENSITIVITY) ?: isoVal

          promise.resolve(
            mapOf(
              "frameId" to idx,
              "framePath" to decoded.framePath,
              "format" to if (activeFormat == ImageFormat.RAW_SENSOR) "raw16" else "yuv",
              "width" to decoded.width,
              "height" to decoded.height,
              "thumbWidth" to decoded.thumbWidth,
              "thumbHeight" to decoded.thumbHeight,
              "thumbLuma" to decoded.thumbLuma,
              "exposureMs" to (actualExpNs / 1e6),
              "iso" to actualIso,
              "startTimeMs" to startWallMs.toDouble(),
              "endTimeMs" to endWallMs.toDouble(),
              "midTimeMs" to (0.5 * (startWallMs + endWallMs)),
            ),
          )
        } catch (t: Throwable) {
          Log.w("AstroCamera", "captureSubFrame error: ${t.message}")
          promise.reject("ERR_CAPTURE", t.message ?: "Capture sub-frame failed", t)
        } finally {
          activeImgLatch.set(null)
          activeResLatch.set(null)
          activeFailRef.set(null)
          captureBusy.set(false)
        }
      }
    }

    AsyncFunction("stopSessionAsync") { promise: Promise ->
      ioScope.launch {
        closeCameraLocked()
        stackSession = null
        lastPreviewFile?.delete()
        lastPreviewFile = null
        promise.resolve(null)
      }
    }

    AsyncFunction("beginStackAsync") { opts: Map<String, Any?>, promise: Promise ->
      ioScope.launch {
        try {
          val w = (opts["width"] as? Number)?.toInt() ?: 0
          val h = (opts["height"] as? Number)?.toInt() ?: 0
          if (w <= 0 || h <= 0) {
            promise.reject("ERR_STACK_SIZE", "Valid positive stack width/height required", null)
            return@launch
          }
          stackSession = AstroStackAccumulator.StackSession(w, h)
          promise.resolve(mapOf("width" to w, "height" to h))
        } catch (t: Throwable) {
          promise.reject("ERR_STACK_BEGIN", t.message ?: "Failed to initialize stack session", t)
        }
      }
    }

    AsyncFunction("addStackFrameAsync") { opts: Map<String, Any?>, promise: Promise ->
      ioScope.launch {
        try {
          val session = stackSession ?: throw CodedException("ERR_NO_STACK", "Call beginStackAsync first", null)
          val framePath = (opts["framePath"] as? String)
            ?: throw CodedException("ERR_ARG", "framePath is required", null)
          val weight = (opts["weight"] as? Number)?.toFloat() ?: 1.0f
          val keepFixedGround = (opts["keepFixedGround"] as? Boolean) ?: false

          val hList = (opts["homographyUv0ToK"] as? List<*>) ?: emptyList<Any>()
          if (hList.size != 9) {
            throw CodedException("ERR_ARG", "homographyUv0ToK must have 9 numbers", null)
          }
          val hArr = FloatArray(9) { i -> (hList[i] as? Number)?.toFloat() ?: if (i % 4 == 0) 1f else 0f }

          val skyList = opts["skyLimitNormY"] as? List<*>
          val skyArr = skyList?.let { list ->
            FloatArray(list.size) { i -> (list[i] as? Number)?.toFloat() ?: 1.1f }
          }

          val added = session.addFrame(
            framePath = framePath,
            weight = weight,
            hUv0ToK = hArr,
            skyLimitNormY = skyArr,
            keepFixedGround = keepFixedGround,
          )
          promise.resolve(
            mapOf(
              "added" to added,
              "acceptedFrames" to session.acceptedCount,
            ),
          )
        } catch (t: Throwable) {
          promise.reject("ERR_STACK_ADD", t.message ?: "Failed to accumulate frame", t)
        }
      }
    }

    AsyncFunction("renderStackPreviewAsync") { opts: Map<String, Any?>, promise: Promise ->
      ioScope.launch {
        try {
          val ctx = appContextSafe()
          val session = stackSession
          if (session == null || session.acceptedCount == 0) {
            promise.resolve(null)
            return@launch
          }
          val maxLongEdge = (opts["maxLongEdge"] as? Number)?.toInt() ?: 640
          val stretchGain = (opts["stretchGain"] as? Number)?.toFloat() ?: 1.8f
          val asinhStrength = (opts["asinhStrength"] as? Number)?.toFloat() ?: 10.0f
          val blackPct = (opts["subtractBlackPercentile"] as? Number)?.toFloat() ?: 0.2f
          val jpegQuality = (opts["jpegQuality"] as? Number)?.toInt() ?: 82
          val monochromeRed = (opts["monochromeRed"] as? Boolean) ?: true

          val seq = previewCounter.incrementAndGet()
          val outFile = File(ctx.cacheDir, "astro_preview_${seq}.jpg")
          val result = session.renderPreviewToFile(
            outputFile = outFile,
            maxLongEdge = maxLongEdge,
            stretchGain = stretchGain,
            asinhStrength = asinhStrength,
            subtractBlackPercentile = blackPct,
            jpegQuality = jpegQuality,
            monochromeRed = monochromeRed,
          )
          val prev = lastPreviewFile
          lastPreviewFile = outFile
          if (prev != null && prev != outFile) prev.delete()
          promise.resolve(result)
        } catch (t: Throwable) {
          promise.reject("ERR_STACK_PREVIEW", t.message ?: "Failed to render preview", t)
        }
      }
    }

    AsyncFunction("finalizeStackAsync") { opts: Map<String, Any?>, promise: Promise ->
      ioScope.launch {
        try {
          val ctx = appContextSafe()
          val session = stackSession ?: throw CodedException("ERR_NO_STACK", "No active stack session", null)
          val format = (opts["format"] as? String) ?: "png"
          val stretchGain = (opts["stretchGain"] as? Number)?.toFloat() ?: 1.8f
          val asinhStrength = (opts["asinhStrength"] as? Number)?.toFloat() ?: 10.0f
          val blackPct = (opts["subtractBlackPercentile"] as? Number)?.toFloat() ?: 0.2f
          val jpegQuality = (opts["jpegQuality"] as? Number)?.toInt() ?: 96

          val ext = if (format.equals("png", ignoreCase = true)) "png" else "jpg"
          val outFile = File(ctx.cacheDir, "astro_stack_${System.currentTimeMillis()}.$ext")
          val result = session.finalizeToFile(
            outputFile = outFile,
            format = format,
            stretchGain = stretchGain,
            asinhStrength = asinhStrength,
            subtractBlackPercentile = blackPct,
            jpegQuality = jpegQuality,
          )
          stackSession = null
          clearFrameCache(ctx)
          promise.resolve(result)
        } catch (t: Throwable) {
          promise.reject("ERR_STACK_FINALIZE", t.message ?: "Failed to finalize astro stack", t)
        }
      }
    }
  }

  @SuppressLint("MissingPermission")
  private fun openCameraBlocking(manager: CameraManager, cameraId: String, handler: Handler): CameraDevice {
    val devRef = AtomicReference<CameraDevice?>()
    val errRef = AtomicReference<String?>()
    val latch = CountDownLatch(1)

    manager.openCamera(
      cameraId,
      object : CameraDevice.StateCallback() {
        override fun onOpened(camera: CameraDevice) {
          devRef.set(camera)
          latch.countDown()
        }

        override fun onDisconnected(camera: CameraDevice) {
          camera.close()
          errRef.compareAndSet(null, "Camera disconnected")
          latch.countDown()
        }

        override fun onError(camera: CameraDevice, error: Int) {
          camera.close()
          errRef.compareAndSet(null, "Camera open error code=$error")
          latch.countDown()
        }
      },
      handler,
    )

    if (!latch.await(6, TimeUnit.SECONDS)) {
      throw CodedException("ERR_CAMERA_TIMEOUT", "Timed out opening Camera2 device", null)
    }
    return devRef.get() ?: throw CodedException("ERR_CAMERA_OPEN", errRef.get() ?: "Failed to open camera", null)
  }

  @Suppress("DEPRECATION")
  private fun createSessionBlocking(
    device: CameraDevice,
    surfaces: List<android.view.Surface>,
    handler: Handler,
    physicalCameraId: String? = null,
  ): CameraCaptureSession {
    val sesRef = AtomicReference<CameraCaptureSession?>()
    val errRef = AtomicReference<String?>()
    val latch = CountDownLatch(1)

    val callback = object : CameraCaptureSession.StateCallback() {
      override fun onConfigured(session: CameraCaptureSession) {
        sesRef.set(session)
        latch.countDown()
      }

      override fun onConfigureFailed(session: CameraCaptureSession) {
        errRef.compareAndSet(null, "CameraCaptureSession configuration failed")
        latch.countDown()
      }
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val outputs = surfaces.map { s ->
        OutputConfiguration(s).apply {
          if (!physicalCameraId.isNullOrEmpty()) {
            setPhysicalCameraId(physicalCameraId)
          }
        }
      }
      val cfg = SessionConfiguration(
        SessionConfiguration.SESSION_REGULAR,
        outputs,
        { cmd -> handler.post(cmd) },
        callback,
      )
      device.createCaptureSession(cfg)
    } else {
      device.createCaptureSession(surfaces, callback, handler)
    }

    if (!latch.await(6, TimeUnit.SECONDS)) {
      throw CodedException("ERR_SESSION_TIMEOUT", "Timed out creating capture session", null)
    }
    return sesRef.get() ?: throw CodedException("ERR_SESSION_CONFIG", errRef.get() ?: "Session configuration failed", null)
  }

  private object CaptureResultKeyCompat {
    fun colorCorrectionGains() = TotalCaptureResult.COLOR_CORRECTION_GAINS
  }
}
