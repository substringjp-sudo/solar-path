package com.pplaner.mp4encoder;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Rect;
import android.media.ExifInterface;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.view.Surface;

import java.io.File;
import java.io.IOException;
import java.util.List;

/**
 * 사진(JPEG) 목록을 H.264 MP4 로 묶는 인코더 — MediaCodec(입력 Surface) + MediaMuxer.
 *
 * 값(크기 · 비트레이트 · 프레임률)은 JS 의 `src/utils/mp4Plan.ts` 가 정해 넘기고 여기서는 그대로 씁니다
 * (판정 `tools/shader-preview/verify-mp4-plan.js`).
 *
 * 색 변환 없이 쓰려고 입력 Surface 에 사진을 Canvas 로 그립니다. 이 방식은 프레임마다 시각을 정할 수 없으므로
 * **뮤서에 쓸 때 시각을 `i × 1e6 / fps` 로 덮어씁니다**(프레임 하나가 인코더에서 하나로 나온다고 보는 B 프레임 없는 설정 —
 * 기본 프로필에서 그렇고, 어긋나면 영상이 느려지거나 빨라지니 실기기에서 길이를 확인해야 합니다).
 *
 * 컴파일 검사는 `tools/mp4-encoder/compile-check.sh`(안드로이드 프레임워크 jar 에 대해 javac). 실제 인코딩은 실기기에서만 돌려 봤어야 하고 아직 못 돌렸습니다.
 */
public final class Mp4FrameEncoder {
  /** 한 프레임을 마칠 때마다 불립니다(done 은 1 부터). */
  public interface Progress { void onFrame(int done, int total); }

  /** 인코더 출력을 기다리는 한 번의 길이(µs). */
  private static final long DEQUEUE_TIMEOUT_US = 10_000L;
  /** 끝 신호 뒤 출력이 이만큼(번) 연달아 안 나오면 포기합니다(약 10 초). */
  private static final int EOS_MAX_IDLE = 1000;

  private final int width;
  private final int height;
  private final int fps;
  private final int bitrate;

  private MediaCodec codec;
  private MediaMuxer muxer;
  private Surface inputSurface;
  private int trackIndex = -1;
  private boolean muxerStarted = false;
  private long writtenFrames = 0;
  private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

  public Mp4FrameEncoder(int width, int height, int fps, int bitrate) {
    if (width < 2 || height < 2 || (width & 1) != 0 || (height & 1) != 0) {
      throw new IllegalArgumentException("size must be even and positive: " + width + "x" + height);
    }
    if (fps < 1 || fps > 60) throw new IllegalArgumentException("fps out of range: " + fps);
    if (bitrate < 1) throw new IllegalArgumentException("bitrate out of range: " + bitrate);
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.bitrate = bitrate;
  }

  /** 시각 계산(µs). `mp4Plan.frameTimeUs` 와 같은 식 — 판정이 두 식이 같은 값을 내는지 소스로 봅니다. */
  static long frameTimeUs(long index, int fps) {
    return (index * 1_000_000L) / fps;
  }

  public void encode(List<String> jpegPaths, String outPath, Progress progress) throws IOException {
    if (jpegPaths == null || jpegPaths.size() < 2) throw new IOException("need at least 2 frames");
    final File out = new File(outPath);
    if (out.exists() && !out.delete()) throw new IOException("cannot overwrite " + outPath);
    boolean ok = false;
    try {
      MediaFormat format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height);
      format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
      format.setInteger(MediaFormat.KEY_BIT_RATE, bitrate);
      format.setInteger(MediaFormat.KEY_FRAME_RATE, fps);
      format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);
      codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
      codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
      inputSurface = codec.createInputSurface();
      codec.start();
      muxer = new MediaMuxer(outPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);

      final int total = jpegPaths.size();
      final Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG);
      final Rect dst = new Rect(0, 0, width, height);
      for (int i = 0; i < total; i++) {
        Bitmap bmp = decodeOriented(jpegPaths.get(i));
        if (bmp == null) throw new IOException("cannot decode frame " + i + ": " + jpegPaths.get(i));
        try {
          Canvas canvas = inputSurface.lockCanvas(null);
          try {
            canvas.drawBitmap(bmp, new Rect(0, 0, bmp.getWidth(), bmp.getHeight()), dst, paint);
          } finally {
            inputSurface.unlockCanvasAndPost(canvas);
          }
        } finally {
          bmp.recycle();
        }
        drain(false);
        if (progress != null) progress.onFrame(i + 1, total);
      }
      codec.signalEndOfInputStream();
      drain(true);
      ok = true;
    } catch (RuntimeException e) {
      throw new IOException("encoder failed: " + e.getMessage(), e);
    } finally {
      release();
      if (!ok) { //noinspection ResultOfMethodCallIgnored
        out.delete();
      }
    }
  }

  /** 인코더에서 나온 출력을 뮤서에 씁니다. endOfStream 이면 끝 표시가 나올 때까지 기다립니다. */
  private void drain(boolean endOfStream) throws IOException {
    int idle = 0;
    while (true) {
      int index = codec.dequeueOutputBuffer(info, DEQUEUE_TIMEOUT_US);
      if (index == MediaCodec.INFO_TRY_AGAIN_LATER) {
        if (!endOfStream) return;
        if (++idle > EOS_MAX_IDLE) throw new IOException("encoder did not finish");
      } else if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        if (muxerStarted) throw new IOException("format changed twice");
        trackIndex = muxer.addTrack(codec.getOutputFormat());
        muxer.start();
        muxerStarted = true;
      } else if (index >= 0) {
        idle = 0;
        java.nio.ByteBuffer data = codec.getOutputBuffer(index);
        if (data == null) throw new IOException("null output buffer " + index);
        if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) info.size = 0;
        if (info.size != 0) {
          if (!muxerStarted) throw new IOException("muxer not started");
          data.position(info.offset);
          data.limit(info.offset + info.size);
          info.presentationTimeUs = frameTimeUs(writtenFrames, fps);
          muxer.writeSampleData(trackIndex, data, info);
          writtenFrames++;
        }
        codec.releaseOutputBuffer(index, false);
        if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) return;
      }
    }
  }

  /** 사진을 EXIF 회전을 적용해 읽고, 영상 크기의 2 배 안으로 줄여 메모리를 아낍니다. */
  private Bitmap decodeOriented(String path) throws IOException {
    BitmapFactory.Options bounds = new BitmapFactory.Options();
    bounds.inJustDecodeBounds = true;
    BitmapFactory.decodeFile(path, bounds);
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
    int sample = 1;
    while (bounds.outWidth / (sample * 2) >= width * 2 && bounds.outHeight / (sample * 2) >= height * 2) sample *= 2;
    BitmapFactory.Options opts = new BitmapFactory.Options();
    opts.inSampleSize = sample;
    Bitmap raw = BitmapFactory.decodeFile(path, opts);
    if (raw == null) return null;
    int rotation = exifRotationDegrees(path);
    if (rotation == 0) return raw;
    Matrix m = new Matrix();
    m.postRotate(rotation);
    Bitmap rotated = Bitmap.createBitmap(raw, 0, 0, raw.getWidth(), raw.getHeight(), m, true);
    if (rotated != raw) raw.recycle();
    return rotated;
  }

  static int exifRotationDegrees(String path) {
    try {
      int o = new ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
      switch (o) {
        case ExifInterface.ORIENTATION_ROTATE_90: return 90;
        case ExifInterface.ORIENTATION_ROTATE_180: return 180;
        case ExifInterface.ORIENTATION_ROTATE_270: return 270;
        default: return 0;
      }
    } catch (IOException e) {
      return 0;
    }
  }

  private void release() {
    if (codec != null) {
      try { codec.stop(); } catch (RuntimeException ignored) { }
      try { codec.release(); } catch (RuntimeException ignored) { }
      codec = null;
    }
    if (inputSurface != null) { inputSurface.release(); inputSurface = null; }
    if (muxer != null) {
      try { if (muxerStarted) muxer.stop(); } catch (RuntimeException ignored) { }
      try { muxer.release(); } catch (RuntimeException ignored) { }
      muxer = null;
    }
  }
}
