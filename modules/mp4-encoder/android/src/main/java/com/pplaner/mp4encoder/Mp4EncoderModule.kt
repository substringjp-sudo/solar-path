package com.pplaner.mp4encoder

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 사진 목록을 MP4 로 묶는 Expo 네이티브 모듈(안드로이드). 실제 인코딩은 [Mp4FrameEncoder].
 * 값(크기 · 비트레이트 · 프레임률)은 JS 의 `src/utils/mp4Plan.ts` 가 정해 넘깁니다. 한 번에 하나만 돌립니다.
 */
class Mp4EncoderModule : Module() {
  private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val busy = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("Mp4Encoder")

    OnDestroy {
      ioScope.cancel()
    }

    AsyncFunction("encodeAsync") { opts: Map<String, Any?>, promise: Promise ->
      // 기존 모듈(AstroCamera)처럼 본문의 마지막 식을 launch 로 두어, 중간에 빠져나갈 때는 return@launch 를 씁니다.
      ioScope.launch {
        val frames = (opts["frames"] as? List<*>)?.mapNotNull { it as? String }
        val outPath = opts["outPath"] as? String
        val width = (opts["width"] as? Number)?.toInt()
        val height = (opts["height"] as? Number)?.toInt()
        val fps = (opts["fps"] as? Number)?.toInt()
        val bitrate = (opts["bitrate"] as? Number)?.toInt()
        if (frames == null || outPath == null || width == null || height == null || fps == null || bitrate == null) {
          promise.reject("ERR_ARGS", "frames, outPath, width, height, fps, bitrate are required", null)
          return@launch
        }
        if (!busy.compareAndSet(false, true)) {
          promise.reject("ERR_BUSY", "Another encode is already running", null)
          return@launch
        }
        try {
          // `file://` 로 시작하는 주소도 받는다(expo-file-system 의 uri).
          val paths = frames.map { it.removePrefix("file://") }
          val out = outPath.removePrefix("file://")
          Mp4FrameEncoder(width, height, fps, bitrate).encode(paths, out, null)
          promise.resolve(mapOf("path" to out, "frames" to paths.size))
        } catch (t: Throwable) {
          promise.reject("ERR_ENCODE", t.message ?: "MP4 encoding failed", t)
        } finally {
          busy.set(false)
        }
      }
    }
  }
}
