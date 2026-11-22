/**
 * mp4Plan.ts — 타임랩스 사진들을 MP4 로 묶을 때의 **영상 크기 · 비트레이트 · 시간표 · 용량 어림**(계획 문서 8.5 "MP4 인코더", 23-9절). 순수 함수.
 * 네이티브 인코더(`modules/mp4-encoder`)는 이 값을 그대로 받아 씁니다. 판정: `tools/shader-preview/verify-mp4-plan.js`
 */
export interface Mp4PlanInput { srcW: number; srcH: number; frames: number; fps: number; maxLongEdge?: number }
export interface Mp4Plan {
  width: number; height: number; bitrate: number; durationSec: number;
  /** 영상 파일 크기 어림(MB) */
  estimatedMB: number;
  /** 영상용으로 줄인 사진 임시 파일의 합(MB) */
  tempMB: number;
  frames: number; fps: number;
}

export const MP4_MAX_LONG_EDGE = 1920;
export const MP4_MAX_FRAMES = 3600;
/** 움직임이 적은 타임랩스용 픽셀당 비트. */
const BITS_PER_PIXEL = 0.07;
const MIN_BITRATE = 1_000_000;
const MAX_BITRATE = 20_000_000;
/** JPEG 품질 85 의 픽셀당 바이트 어림. */
const JPEG_BYTES_PER_PIXEL = 0.25;

export function planMp4(i: Mp4PlanInput): Mp4Plan | null {
  const { srcW, srcH, frames, fps } = i;
  const maxEdge = i.maxLongEdge ?? MP4_MAX_LONG_EDGE;
  if (![srcW, srcH, frames, fps, maxEdge].every(Number.isFinite)) return null;
  if (srcW <= 0 || srcH <= 0 || maxEdge < 16) return null;
  if (!Number.isInteger(frames) || frames < 2 || frames > MP4_MAX_FRAMES) return null;
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) return null;
  const s = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const width = Math.floor((srcW * s) / 2) * 2;
  const height = Math.floor((srcH * s) / 2) * 2;
  if (width < 2 || height < 2) return null;
  const bitrate = Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, Math.round(width * height * fps * BITS_PER_PIXEL)));
  const durationSec = frames / fps;
  return {
    width, height, bitrate, durationSec,
    estimatedMB: (bitrate * durationSec) / 8 / 1e6,
    tempMB: (frames * width * height * JPEG_BYTES_PER_PIXEL) / 1e6,
    frames, fps,
  };
}

/** i 번째 프레임의 표시 시각(µs). 틀린 입력은 NaN. */
export function frameTimeUs(i: number, fps: number): number {
  if (!Number.isInteger(i) || i < 0 || !Number.isFinite(fps) || fps <= 0) return NaN;
  return Math.floor((i * 1_000_000) / fps);
}
