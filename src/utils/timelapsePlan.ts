/**
 * timelapsePlan.ts — 타임랩스 계획(간격 · 총 시간 · 영상 길이)의 순수 계산 (docs/SANDBOX_MODE_PLAN.md 8.3.1, 목업 9).
 *
 * 영상 길이 = 장수 ÷ fps, 빨라지는 배수 = 총 시간 ÷ 영상 길이. 사용자가 총 시간과 원하는 영상 길이를 고르면 간격이 나옵니다.
 * 한 장을 찍고 저장하는 시간이 있어 간격은 2 초 아래로 내리지 않고(내려가면 간격을 올리고 영상이 짧아집니다), 0.5 초 단위로 맞춥니다.
 *
 * 판정: `tools/shader-preview/verify-timelapse-plan.js`
 */
type Lang = 'ko' | 'en' | 'ja';

export const MIN_INTERVAL_S = 2;
export const TOTAL_MIN_RANGE = { min: 1, max: 360 } as const;
export const VIDEO_SEC_RANGE = { min: 3, max: 60 } as const;
export const DEFAULTS = { totalMin: 60, videoSec: 10, fps: 30 } as const;
/** 한 장 평균 크기(MB). 저장 공간 어림에 씁니다. */
export const FRAME_MB = 3;

export type TimelapseFps = 24 | 30;

export interface PlanInput { totalMin?: number | null; videoSec?: number | null; fps?: number | null }

export interface TimelapsePlan {
  /** 자른 뒤의 총 시간(분) */
  totalMin: number;
  /** 요청한(자른 뒤) 영상 길이(초) */
  targetVideoSec: number;
  fps: TimelapseFps;
  /** 찍는 간격(초), 0.5 초 단위 */
  intervalS: number;
  /** 찍을 장수(처음 한 장 포함) */
  frames: number;
  /** 실제 영상 길이(초) = 장수 ÷ fps */
  videoSec: number;
  /** 빨라지는 배수 = 총 시간 ÷ 요청한 영상 길이 */
  speedup: number;
  /** 저장 공간 어림(MB) */
  estimateMB: number;
  /** 간격을 2 초로 올려 영상이 요청보다 짧아졌으면 'interval', 아니면 null */
  clamped: 'interval' | null;
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function planTimelapse(input: PlanInput): TimelapsePlan {
  const totalMin = clamp(num(input.totalMin, DEFAULTS.totalMin), TOTAL_MIN_RANGE.min, TOTAL_MIN_RANGE.max);
  const targetVideoSec = clamp(num(input.videoSec, DEFAULTS.videoSec), VIDEO_SEC_RANGE.min, VIDEO_SEC_RANGE.max);
  const fps: TimelapseFps = input.fps === 24 ? 24 : 30;
  const totalS = totalMin * 60;
  const raw = totalS / (targetVideoSec * fps);
  const rounded = Math.round(raw * 2) / 2;
  const clamped: TimelapsePlan['clamped'] = rounded < MIN_INTERVAL_S ? 'interval' : null;
  const intervalS = Math.max(MIN_INTERVAL_S, rounded);
  const frames = Math.floor(totalS / intervalS) + 1;
  return {
    totalMin, targetVideoSec, fps, intervalS, frames,
    videoSec: frames / fps,
    speedup: totalS / targetVideoSec,
    estimateMB: Math.round(frames * FRAME_MB),
    clamped,
  };
}

export type PresetKind = 'sunset' | 'sunrise' | 'day-to-night';

/** 촬영 구간: 해가 뜨고 지는 시각(eventMs) 앞뒤. */
const WINDOW_MIN: Record<PresetKind, { before: number; after: number }> = {
  sunset: { before: 20, after: 40 },
  sunrise: { before: 40, after: 20 },
  'day-to-night': { before: 20, after: 130 },
};

export function presetWindow(kind: PresetKind, eventMs: number): { startMs: number; endMs: number; totalMin: number } | null {
  if (typeof eventMs !== 'number' || !Number.isFinite(eventMs)) return null;
  const w = WINDOW_MIN[kind];
  return { startMs: eventMs - w.before * 60000, endMs: eventMs + w.after * 60000, totalMin: w.before + w.after };
}

/** 찍을 시각 목록(ms). 첫 장은 startMs. */
export function frameTimes(startMs: number, intervalS: number, frames: number): number[] {
  if (!(intervalS > 0) || !(frames >= 1)) return [];
  const out: number[] = [];
  for (let i = 0; i < Math.floor(frames); i++) out.push(startMs + i * intervalS * 1000);
  return out;
}

const fmtNum = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function planSummary(p: TimelapsePlan, lang: Lang): string {
  const iv = fmtNum(p.intervalS);
  const v = fmtNum(Math.round(p.videoSec * 10) / 10 === Math.round(p.videoSec) ? Math.round(p.videoSec) : Math.round(p.videoSec * 10) / 10);
  const sp = String(Math.round(p.speedup));
  if (lang === 'en') return `Every ${iv} s, ${p.frames} frames · ${v} s video · ${sp}×`;
  if (lang === 'ja') return `${iv}秒ごと ${p.frames}枚 · 動画${v}秒 · ${sp}倍速`;
  return `${iv}초마다 ${p.frames}장 · 영상 ${v}초 · ${sp}배속`;
}

/** 다음 장까지 기다릴 ms. 시작 시각 기준이라 간격마다 어긋남이 쌓이지 않습니다. 늦었거나 숫자가 아니면 0. */
export function nextDelayMs(startMs: number, intervalS: number, index: number, nowMs: number): number {
  const d = startMs + index * intervalS * 1000 - nowMs;
  return Number.isFinite(d) ? Math.max(0, d) : 0;
}

export interface RunProgress { taken: number; frames: number; remainingS: number; done: boolean }

export function runProgress(startMs: number, intervalS: number, frames: number, taken: number, nowMs: number): RunProgress {
  const lastMs = startMs + (frames - 1) * intervalS * 1000;
  const rem = Math.ceil((lastMs - nowMs) / 1000);
  return { taken, frames, remainingS: Number.isFinite(rem) ? Math.max(0, rem) : 0, done: taken >= frames };
}

/** 미리보기 재생에서 지금 보일 시뮬레이션 시각(ms). 영상 길이에 걸쳐 시작에서 끝까지. */
export function previewTimeAt(startMs: number, endMs: number, videoSec: number, elapsedS: number): number {
  if (!(videoSec > 0) || !Number.isFinite(elapsedS)) return endMs;
  const u = Math.min(1, Math.max(0, elapsedS / videoSec));
  return startMs + (endMs - startMs) * u;
}
