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

/**
 * 타임랩스의 세 종류(2026-11-20): 일반(한 장이 영상 한 프레임) · 밝게 합성(`stackSize` 장을 한 프레임으로 합쳐 밤을 밝게) · 궤적 누적(처음 장부터 쌓아 궤적이 점점 그려짐, 마지막 프레임이 별 일주 사진).
 */
export type TimelapseKind = 'plain' | 'stacked' | 'trail';
export const STACK_RANGE = { min: 2, max: 16, def: 4 } as const;

export interface PlanInput { totalMin?: number | null; videoSec?: number | null; fps?: number | null; kind?: TimelapseKind | null; stackSize?: number | null }

export interface TimelapsePlan {
  /** 자른 뒤의 총 시간(분) */
  totalMin: number;
  /** 요청한(자른 뒤) 영상 길이(초) */
  targetVideoSec: number;
  fps: TimelapseFps;
  /** 찍는 간격(초), 0.5 초 단위 */
  intervalS: number;
  kind: TimelapseKind;
  /** 한 프레임으로 합치는 장수(밝게 합성만 2~16, 나머지 1) */
  stackSize: number;
  /** 궤적 누적이면 참: 영상의 매 프레임이 "지금까지의 합" */
  cumulative: boolean;
  /** 찍을 장수(처음 한 장 포함) */
  frames: number;
  /** 영상 프레임 수(일반 · 누적은 찍는 장수, 합성은 찍는 장수 ÷ stackSize 내림) */
  outFrames: number;
  /** 실제 영상 길이(초) = 영상 프레임 수 ÷ fps */
  videoSec: number;
  /** 빨라지는 배수 = 총 시간 ÷ 요청한 영상 길이 */
  speedup: number;
  /** 앨범에 저장되는 그림 수(일반 · 누적은 찍은 장수, 합성은 묶음 수 = 올림(장수 ÷ stackSize)) */
  savedFrames: number;
  /** 저장 공간 어림(MB), 앨범에 저장되는 그림 기준 */
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
  const kind: TimelapseKind = input.kind === 'stacked' || input.kind === 'trail' ? input.kind : 'plain';
  const stackSize = kind === 'stacked'
    ? clamp(Math.floor(num(input.stackSize, STACK_RANGE.def)), STACK_RANGE.min, STACK_RANGE.max)
    : 1;
  const raw = totalS / (targetVideoSec * fps * stackSize);
  const rounded = Math.round(raw * 2) / 2;
  const clamped: TimelapsePlan['clamped'] = rounded < MIN_INTERVAL_S ? 'interval' : null;
  const intervalS = Math.max(MIN_INTERVAL_S, rounded);
  const frames = Math.floor(totalS / intervalS) + 1;
  const outFrames = kind === 'stacked' ? Math.floor(frames / stackSize) : frames;
  const savedFrames = kind === 'stacked' ? Math.ceil(frames / stackSize) : frames;
  return {
    totalMin, targetVideoSec, fps, intervalS, kind, stackSize, cumulative: kind === 'trail', frames, outFrames, savedFrames,
    videoSec: outFrames / fps,
    speedup: totalS / targetVideoSec,
    estimateMB: Math.round(savedFrames * FRAME_MB),
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
  const mid = p.kind === 'stacked'
    ? (lang === 'en' ? ` · stacked ${p.stackSize} per frame` : lang === 'ja' ? ` · ${p.stackSize}枚ずつ合成` : ` · ${p.stackSize}장씩 합성`)
    : p.kind === 'trail'
      ? (lang === 'en' ? ' · cumulative' : lang === 'ja' ? ' · 累積' : ' · 누적')
      : '';
  if (lang === 'en') return `Every ${iv} s, ${p.frames} frames${mid} · ${v} s video · ${sp}×`;
  if (lang === 'ja') return `${iv}秒ごと ${p.frames}枚${mid} · 動画${v}秒 · ${sp}倍速`;
  return `${iv}초마다 ${p.frames}장${mid} · 영상 ${v}초 · ${sp}배속`;
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

export interface ShotPlan {
  /** 이 장을 쌓는 그림(평균 또는 밝은 쪽 남기기)에 겹친다 */
  accumulate: boolean;
  /** 쌓인 그림을 앨범에 저장한다 */
  flush: boolean;
  /** 저장한 뒤 쌓은 그림을 비운다 */
  reset: boolean;
  /** 이 장을 합치지 않고 그대로 저장한다 */
  saveRaw: boolean;
}

/** 장마다 합치기: 일반은 그대로 저장, 궤적 누적은 겹치고 매번 저장(안 비움), 밝게 합성은 `stackSize` 장마다(마지막이 덜 차도) 저장하고 비웁니다. */
export function shotPlan(kind: TimelapseKind, stackSize: number, index: number, isLast: boolean): ShotPlan {
  if (kind === 'plain') return { accumulate: false, flush: false, reset: false, saveRaw: true };
  if (kind === 'trail') return { accumulate: true, flush: true, reset: false, saveRaw: false };
  const k = Math.max(1, Math.floor(stackSize));
  const full = (index + 1) % k === 0;
  const flush = full || isLast;
  return { accumulate: true, flush, reset: flush, saveRaw: false };
}
