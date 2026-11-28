package com.pplaner.astrocamera

import android.graphics.Bitmap
import android.hardware.camera2.CameraCharacteristics
import android.media.Image
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.asinh
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * 16-bit 선형 RGB 임시 프레임 디코딩 및 32-bit float 역투영 누적기.
 *
 * Why 네이티브에서 직접 누적하는가:
 *  - 고해상도(예: 2000×1500) 20~40프레임 float 버퍼를 JS 힙에 올리면 바로 OOM이 납니다.
 *  - RAW_SENSOR(베이어 모자이크)는 JPEG 인코더·ISP 노이즈 제거를 거치지 않은 선형 값이라
 *    2×2 슈퍼픽셀 비닝만으로도 색 보간 얼룩 없이 SNR을 2배(+1 stop) 끌어올릴 수 있습니다.
 */
object AstroStackAccumulator {
  private const val HDR_HEADROOM = 2.0f
  private const val THUMB_WIDTH = 240

  private val SRGB_TO_LIN = FloatArray(256) { i ->
    val c = i / 255.0f
    if (c <= 0.04045f) c / 12.92f else ((c + 0.055f) / 1.055f).pow(2.4f)
  }

  data class DecodedFrameResult(
    val framePath: String,
    val width: Int,
    val height: Int,
    val thumbWidth: Int,
    val thumbHeight: Int,
    val thumbLuma: ByteArray,
  )

  data class RawParams(
    val cfa: Int,
    val blackLevels: FloatArray,
    val whiteLevel: Float,
    val wbGains: FloatArray, // [R, G, B]
  )

  class StackSession(
    val width: Int,
    val height: Int,
  ) {
    private val n = width * height
    private val rAcc = FloatArray(n)
    private val gAcc = FloatArray(n)
    private val bAcc = FloatArray(n)
    private val wAcc = FloatArray(n)
    private var fixedGroundCaptured = false
    private val scratchShort = ShortArray(n * 3)
    var acceptedCount = 0
      private set

    @Synchronized
    fun addFrame(
      framePath: String,
      weight: Float,
      hUv0ToK: FloatArray,
      skyLimitNormY: FloatArray?,
      keepFixedGround: Boolean,
    ): Boolean {
      val file = File(framePath)
      if (!file.exists()) return false
      if (weight <= 0.0f) {
        file.delete()
        return false
      }

      val loaded = try {
        readLinearFrame(file, width, height, scratchShort)
      } finally {
        file.delete()
      }
      if (!loaded) return false

      val isFirstFrame = !fixedGroundCaptured && acceptedCount == 0
      val captureGroundNow = keepFixedGround && isFirstFrame
      if (captureGroundNow) fixedGroundCaptured = true

      val h0 = hUv0ToK[0]; val h1 = hUv0ToK[1]; val h2 = hUv0ToK[2]
      val h3 = hUv0ToK[3]; val h4 = hUv0ToK[4]; val h5 = hUv0ToK[5]
      val h6 = hUv0ToK[6]; val h7 = hUv0ToK[7]; val h8 = hUv0ToK[8]

      val limitLen = skyLimitNormY?.size ?: 0
      val invW = 1.0f / width
      val invH = 1.0f / height

      for (y in 0 until height) {
        val v = (y + 0.5f) * invH
        for (x in 0 until width) {
          val u = (x + 0.5f) * invW
          val dstIdx = y * width + x

          val limitV = if (skyLimitNormY != null && limitLen > 0) {
            val col = min(limitLen - 1, max(0, (u * limitLen).toInt()))
            skyLimitNormY[col]
          } else {
            1.1f
          }
          val isGround = v > limitV

          // 고정 지형 합성 모드: 지평선 아래는 첫 프레임(frame 0)만 그대로 남기고 이후 하늘만 회전 누적
          if (isGround && keepFixedGround && !captureGroundNow) {
            continue
          }

          val (su, sv) = if (isGround) {
            u to v
          } else {
            val z = h6 * u + h7 * v + h8
            if (kotlin.math.abs(z) <= 1e-6f) continue
            ((h0 * u + h1 * v + h2) / z) to ((h3 * u + h4 * v + h5) / z)
          }

          // 회전 후 화면 바깥으로 나간 모서리·프레임 k의 지평선 아래는 기여에서 빼서 산·불빛 번짐 방지
          if (su < 0.0f || su >= 1.0f || sv < 0.0f || sv >= 1.0f) continue
          if (!isGround && keepFixedGround && skyLimitNormY != null && limitLen > 0) {
            val srcCol = min(limitLen - 1, max(0, (su * limitLen).toInt()))
            if (sv > skyLimitNormY[srcCol]) continue
          }

          val sxF = su * width - 0.5f
          val syF = sv * height - 0.5f
          val x0 = max(0, min(width - 1, floor(sxF).toInt()))
          val y0 = max(0, min(height - 1, floor(syF).toInt()))
          val x1 = min(width - 1, x0 + 1)
          val y1 = min(height - 1, y0 + 1)
          val fx = max(0f, min(1f, sxF - x0))
          val fy = max(0f, min(1f, syF - y0))

          val w00 = (1f - fx) * (1f - fy)
          val w10 = fx * (1f - fy)
          val w01 = (1f - fx) * fy
          val w11 = fx * fy

          val i00 = (y0 * width + x0) * 3
          val i10 = (y0 * width + x1) * 3
          val i01 = (y1 * width + x0) * 3
          val i11 = (y1 * width + x1) * 3

          val scale = HDR_HEADROOM / 65535.0f
          val r = scale * (
            w00 * (scratchShort[i00].toInt() and 0xFFFF) +
              w10 * (scratchShort[i10].toInt() and 0xFFFF) +
              w01 * (scratchShort[i01].toInt() and 0xFFFF) +
              w11 * (scratchShort[i11].toInt() and 0xFFFF)
          )
          val g = scale * (
            w00 * (scratchShort[i00 + 1].toInt() and 0xFFFF) +
              w10 * (scratchShort[i10 + 1].toInt() and 0xFFFF) +
              w01 * (scratchShort[i01 + 1].toInt() and 0xFFFF) +
              w11 * (scratchShort[i11 + 1].toInt() and 0xFFFF)
          )
          val b = scale * (
            w00 * (scratchShort[i00 + 2].toInt() and 0xFFFF) +
              w10 * (scratchShort[i10 + 2].toInt() and 0xFFFF) +
              w01 * (scratchShort[i01 + 2].toInt() and 0xFFFF) +
              w11 * (scratchShort[i11 + 2].toInt() and 0xFFFF)
          )

          rAcc[dstIdx] += r * weight
          gAcc[dstIdx] += g * weight
          bAcc[dstIdx] += b * weight
          wAcc[dstIdx] += weight
        }
      }

      acceptedCount++
      return true
    }

    private fun estimateSkyFloor(stepStride: Int, subtractBlackPercentile: Float): Float {
      if (subtractBlackPercentile <= 0f) return 0f
      val lumaSamples = ArrayList<Float>(1024)
      val sampleStep = max(stepStride, (n / 1024))
      for (i in 0 until n step sampleStep) {
        val w = wAcc[i]
        if (w <= 1e-6f) continue
        val l = (0.2126f * rAcc[i] + 0.7152f * gAcc[i] + 0.0722f * bAcc[i]) / w
        lumaSamples.add(l)
      }
      if (lumaSamples.isEmpty()) return 0f
      lumaSamples.sort()
      val pIdx = min(
        lumaSamples.size - 1,
        max(0, (lumaSamples.size * subtractBlackPercentile).toInt()),
      )
      // 완전 0으로 깎아 암부 정보가 잘리지 않게 배경의 75%만 빼줍니다.
      return max(0f, lumaSamples[pIdx] * 0.75f)
    }

    private fun renderToFile(
      outputFile: File,
      format: String,
      stretchGain: Float,
      asinhStrength: Float,
      subtractBlackPercentile: Float,
      jpegQuality: Int,
      maxLongEdge: Int,
      monochromeRed: Boolean,
    ): Map<String, Any> {
      val longEdge = max(width, height)
      val stride = if (maxLongEdge > 0 && longEdge > maxLongEdge) {
        max(1, longEdge / maxLongEdge)
      } else {
        1
      }
      val outW = if (stride == 1) width else max(1, (width + stride - 1) / stride)
      val outH = if (stride == 1) height else max(1, (height + stride - 1) / stride)

      val skyFloor = estimateSkyFloor(stride, subtractBlackPercentile)
      val pixels = IntArray(outW * outH)
      val k = max(0.5f, asinhStrength)
      val invAsinhK = 1.0f / asinh(k.toDouble()).toFloat()

      var dst = 0
      for (oy in 0 until outH) {
        val y = min(height - 1, oy * stride)
        val rowBase = y * width
        for (ox in 0 until outW) {
          val x = min(width - 1, ox * stride)
          val i = rowBase + x
          val w = wAcc[i]
          if (w <= 1e-6f) {
            pixels[dst++] = 0xFF000000.toInt()
            continue
          }
          val invW = 1.0f / w
          val rLin = max(0f, rAcc[i] * invW - skyFloor) * stretchGain
          val gLin = max(0f, gAcc[i] * invW - skyFloor) * stretchGain
          val bLin = max(0f, bAcc[i] * invW - skyFloor) * stretchGain

          // Asinh 천체 스트레칭: 어두운 은하수·미약한 별은 크게 당기고 밝은 별 코어 색상은 유지
          val rOut = linearToSrgbByte(asinh(k * rLin.toDouble()).toFloat() * invAsinhK)
          val gOut = linearToSrgbByte(asinh(k * gLin.toDouble()).toFloat() * invAsinhK)
          val bOut = linearToSrgbByte(asinh(k * bLin.toDouble()).toFloat() * invAsinhK)
          pixels[dst++] = if (monochromeRed) {
            // 암적응 보호: G/B 방출 없이 R 채널에만 별/은하수 대비 표시
            val redVal = max(rOut, max(gOut, bOut))
            (0xFF shl 24) or (redVal shl 16)
          } else {
            (0xFF shl 24) or (rOut shl 16) or (gOut shl 8) or bOut
          }
        }
      }

      val bmp = Bitmap.createBitmap(pixels, outW, outH, Bitmap.Config.ARGB_8888)
      try {
        FileOutputStream(outputFile).use { fos ->
          val compressFmt = if (format.equals("png", ignoreCase = true)) {
            Bitmap.CompressFormat.PNG
          } else {
            Bitmap.CompressFormat.JPEG
          }
          val q = max(70, min(100, jpegQuality))
          bmp.compress(compressFmt, q, fos)
        }
      } finally {
        bmp.recycle()
      }

      return mapOf(
        "uri" to outputFile.toURI().toString(),
        "width" to outW,
        "height" to outH,
        "acceptedFrames" to acceptedCount,
        "estimatedSkyFloor" to skyFloor,
      )
    }

    /** 진행 중인 누적 버퍼를 비우지 않고 축소 미리보기 JPEG를 생성한다. */
    @Synchronized
    fun renderPreviewToFile(
      outputFile: File,
      maxLongEdge: Int,
      stretchGain: Float,
      asinhStrength: Float,
      subtractBlackPercentile: Float,
      jpegQuality: Int,
      monochromeRed: Boolean,
    ): Map<String, Any> = renderToFile(
      outputFile = outputFile,
      format = "jpeg",
      stretchGain = stretchGain,
      asinhStrength = asinhStrength,
      subtractBlackPercentile = subtractBlackPercentile,
      jpegQuality = jpegQuality,
      maxLongEdge = max(240, min(1024, maxLongEdge)),
      monochromeRed = monochromeRed,
    )

    @Synchronized
    fun finalizeToFile(
      outputFile: File,
      format: String,
      stretchGain: Float,
      asinhStrength: Float,
      subtractBlackPercentile: Float,
      jpegQuality: Int,
    ): Map<String, Any> = renderToFile(
      outputFile = outputFile,
      format = format,
      stretchGain = stretchGain,
      asinhStrength = asinhStrength,
      subtractBlackPercentile = subtractBlackPercentile,
      jpegQuality = jpegQuality,
      maxLongEdge = 0,
      monochromeRed = false,
    )
  }

  fun decodeRawImage(
    image: Image,
    params: RawParams,
    rotationDeg: Int,
    maxLongEdge: Int,
    outFile: File,
  ): DecodedFrameResult {
    val rawHalfW = image.width / 2
    val rawHalfH = image.height / 2
    val capEdge = max(512, min(2048, if (maxLongEdge > 0) maxLongEdge else 2048))
    val bayerStride = max(1, ceil(max(rawHalfW, rawHalfH).toDouble() / capEdge).toInt())
    val halfW = max(1, rawHalfW / bayerStride)
    val halfH = max(1, rawHalfH / bayerStride)
    val rot = ((rotationDeg % 360) + 360) % 360
    val swap = rot == 90 || rot == 270
    val outW = if (swap) halfH else halfW
    val outH = if (swap) halfW else halfH

    val plane = image.planes[0]
    val buf = plane.buffer
    val rowStride = plane.rowStride
    val pixStride = plane.pixelStride
    val rowBytes = ByteArray(image.width * pixStride)

    val outLinear = ShortArray(outW * outH * 3)
    val thumbW = min(THUMB_WIDTH, outW)
    val thumbH = max(1, (outH.toFloat() * thumbW / outW).roundToInt())
    val thumbAcc = FloatArray(thumbW * thumbH)
    val thumbCnt = IntArray(thumbW * thumbH)

    val bl = params.blackLevels
    val wl = max(64f, params.whiteLevel)
    val d0 = max(1f, wl - bl[0])
    val d1 = max(1f, wl - bl[1])
    val d2 = max(1f, wl - bl[2])
    val d3 = max(1f, wl - bl[3])
    val wbR = params.wbGains[0]
    val wbG = params.wbGains[1]
    val wbB = params.wbGains[2]

    val nextRowBytes = ByteArray(image.width * pixStride)

    for (by in 0 until halfH) {
      val sy0 = by * 2 * bayerStride
      buf.position(sy0 * rowStride)
      buf.get(rowBytes, 0, min(rowBytes.size, buf.remaining()))
      buf.position((sy0 + 1) * rowStride)
      buf.get(nextRowBytes, 0, min(nextRowBytes.size, buf.remaining()))

      for (bx in 0 until halfW) {
        val sx0 = bx * 2 * bayerStride
        val o0 = sx0 * pixStride
        val o1 = (sx0 + 1) * pixStride

        val u00 = ((rowBytes[o0].toInt() and 0xFF) or ((rowBytes[o0 + 1].toInt() and 0xFF) shl 8)).toFloat()
        val u10 = ((rowBytes[o1].toInt() and 0xFF) or ((rowBytes[o1 + 1].toInt() and 0xFF) shl 8)).toFloat()
        val u01 = ((nextRowBytes[o0].toInt() and 0xFF) or ((nextRowBytes[o0 + 1].toInt() and 0xFF) shl 8)).toFloat()
        val u11 = ((nextRowBytes[o1].toInt() and 0xFF) or ((nextRowBytes[o1 + 1].toInt() and 0xFF) shl 8)).toFloat()

        val p00 = max(0f, (u00 - bl[0]) / d0)
        val p10 = max(0f, (u10 - bl[1]) / d1)
        val p01 = max(0f, (u01 - bl[2]) / d2)
        val p11 = max(0f, (u11 - bl[3]) / d3)

        val rLin: Float
        val gLin: Float
        val bLin: Float
        when (params.cfa) {
          CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_GRBG -> {
            rLin = p10; gLin = 0.5f * (p00 + p11); bLin = p01
          }
          CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_GBRG -> {
            rLin = p01; gLin = 0.5f * (p00 + p11); bLin = p10
          }
          CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_BGGR -> {
            rLin = p11; gLin = 0.5f * (p10 + p01); bLin = p00
          }
          else -> { // RGGB
            rLin = p00; gLin = 0.5f * (p10 + p01); bLin = p11
          }
        }

        val rw = rLin * wbR
        val gw = gLin * wbG
        val bw = bLin * wbB

        val (dx, dy) = mapRotatedCoord(bx, by, halfW, halfH, rot)
        val dIdx = (dy * outW + dx) * 3
        outLinear[dIdx] = encodeLin16(rw)
        outLinear[dIdx + 1] = encodeLin16(gw)
        outLinear[dIdx + 2] = encodeLin16(bw)

        val tx = min(thumbW - 1, (dx * thumbW) / outW)
        val ty = min(thumbH - 1, (dy * thumbH) / outH)
        val tIdx = ty * thumbW + tx
        thumbAcc[tIdx] += 0.2126f * rw + 0.7152f * gw + 0.0722f * bw
        thumbCnt[tIdx]++
      }
    }

    writeLinearFrame(outFile, outW, outH, outLinear)
    val thumbBytes = finishThumbBytes(thumbAcc, thumbCnt)
    return DecodedFrameResult(outFile.absolutePath, outW, outH, thumbW, thumbH, thumbBytes)
  }

  fun decodeYuvImage(
    image: Image,
    rotationDeg: Int,
    maxLongEdge: Int,
    outFile: File,
  ): DecodedFrameResult {
    val srcW = image.width
    val srcH = image.height
    val strideScale = max(1, ceil(max(srcW, srcH).toDouble() / maxLongEdge).toInt())
    val sampW = max(1, srcW / strideScale)
    val sampH = max(1, srcH / strideScale)

    val rot = ((rotationDeg % 360) + 360) % 360
    val swap = rot == 90 || rot == 270
    val outW = if (swap) sampH else sampW
    val outH = if (swap) sampW else sampH

    val yPlane = image.planes[0]
    val uPlane = image.planes[1]
    val vPlane = image.planes[2]

    val yBuf = yPlane.buffer
    val uBuf = uPlane.buffer
    val vBuf = vPlane.buffer
    val yRow = yPlane.rowStride; val yPix = yPlane.pixelStride
    val uRow = uPlane.rowStride; val uPix = uPlane.pixelStride
    val vRow = vPlane.rowStride; val vPix = vPlane.pixelStride

    val outLinear = ShortArray(outW * outH * 3)
    val thumbW = min(THUMB_WIDTH, outW)
    val thumbH = max(1, (outH.toFloat() * thumbW / outW).roundToInt())
    val thumbAcc = FloatArray(thumbW * thumbH)
    val thumbCnt = IntArray(thumbW * thumbH)

    for (syIdx in 0 until sampH) {
      val sy = syIdx * strideScale
      val uvY = sy shr 1
      for (sxIdx in 0 until sampW) {
        val sx = sxIdx * strideScale
        val uvX = sx shr 1

        val yVal = yBuf.get(sy * yRow + sx * yPix).toInt() and 0xFF
        val uVal = (uBuf.get(uvY * uRow + uvX * uPix).toInt() and 0xFF) - 128
        val vVal = (vBuf.get(uvY * vRow + uvX * vPix).toInt() and 0xFF) - 128

        val rSrgb = max(0, min(255, (yVal + 1.402f * vVal).roundToInt()))
        val gSrgb = max(0, min(255, (yVal - 0.344136f * uVal - 0.714136f * vVal).roundToInt()))
        val bSrgb = max(0, min(255, (yVal + 1.772f * uVal).roundToInt()))

        val rLin = SRGB_TO_LIN[rSrgb]
        val gLin = SRGB_TO_LIN[gSrgb]
        val bLin = SRGB_TO_LIN[bSrgb]

        val (dx, dy) = mapRotatedCoord(sxIdx, syIdx, sampW, sampH, rot)
        val dIdx = (dy * outW + dx) * 3
        outLinear[dIdx] = encodeLin16(rLin)
        outLinear[dIdx + 1] = encodeLin16(gLin)
        outLinear[dIdx + 2] = encodeLin16(bLin)

        val tx = min(thumbW - 1, (dx * thumbW) / outW)
        val ty = min(thumbH - 1, (dy * thumbH) / outH)
        val tIdx = ty * thumbW + tx
        thumbAcc[tIdx] += 0.2126f * rLin + 0.7152f * gLin + 0.0722f * bLin
        thumbCnt[tIdx]++
      }
    }

    writeLinearFrame(outFile, outW, outH, outLinear)
    val thumbBytes = finishThumbBytes(thumbAcc, thumbCnt)
    return DecodedFrameResult(outFile.absolutePath, outW, outH, thumbW, thumbH, thumbBytes)
  }

  private fun mapRotatedCoord(x: Int, y: Int, w: Int, h: Int, rot: Int): Pair<Int, Int> {
    return when (rot) {
      90 -> (h - 1 - y) to x
      180 -> (w - 1 - x) to (h - 1 - y)
      270 -> y to (w - 1 - x)
      else -> x to y
    }
  }

  private fun encodeLin16(v: Float): Short {
    val norm = max(0f, min(1f, v / HDR_HEADROOM))
    return (norm * 65535.0f).roundToInt().toShort()
  }

  private fun linearToSrgbByte(lin: Float): Int {
    val c = max(0f, min(1f, lin))
    val s = if (c <= 0.0031308f) c * 12.92f else 1.055f * c.pow(1.0f / 2.4f) - 0.055f
    return max(0, min(255, (s * 255.0f).roundToInt()))
  }

  private fun finishThumbBytes(acc: FloatArray, cnt: IntArray): ByteArray {
    // 썸네일은 별 피크 검출이 쉬워야 하므로 선형→약한 감마(sqrt)로 어두운 별도 바닥에서 띄워 넘김
    val out = ByteArray(acc.size)
    for (i in acc.indices) {
      val v = if (cnt[i] > 0) acc[i] / cnt[i] else 0f
      val lifted = kotlin.math.sqrt(max(0f, min(1f, v * 3.0f)))
      out[i] = max(0, min(255, (lifted * 255.0f).roundToInt())).toByte()
    }
    return out
  }

  private fun writeLinearFrame(file: File, w: Int, h: Int, data: ShortArray) {
    DataOutputStream(BufferedOutputStream(FileOutputStream(file), 65536)).use { dos ->
      dos.writeInt(w)
      dos.writeInt(h)
      val chunkPx = w * 3
      val byteRow = ByteArray(chunkPx * 2)
      val bb = ByteBuffer.wrap(byteRow).order(ByteOrder.LITTLE_ENDIAN)
      for (y in 0 until h) {
        bb.clear()
        val off = y * chunkPx
        for (i in 0 until chunkPx) {
          bb.putShort(data[off + i])
        }
        dos.write(byteRow)
      }
    }
  }

  private fun readLinearFrame(file: File, expectedW: Int, expectedH: Int, dst: ShortArray): Boolean {
    DataInputStream(BufferedInputStream(FileInputStream(file), 65536)).use { dis ->
      val w = dis.readInt()
      val h = dis.readInt()
      if (w != expectedW || h != expectedH) return false
      val chunkPx = w * 3
      val byteRow = ByteArray(chunkPx * 2)
      val bb = ByteBuffer.wrap(byteRow).order(ByteOrder.LITTLE_ENDIAN)
      for (y in 0 until h) {
        dis.readFully(byteRow)
        bb.rewind()
        val off = y * chunkPx
        for (i in 0 until chunkPx) {
          dst[off + i] = bb.short
        }
      }
      return true
    }
  }
}
