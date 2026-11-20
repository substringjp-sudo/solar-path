/**
 * flightAssist.ts — 비행 모드의 눈 높이와 "여기로 가기"(부드러운 이동)의 순수 계산 (docs/SANDBOX_MODE_PLAN.md 12.2, 12.5 6번).
 *
 *  - 비행 모드로 바꾸면 눈이 100 m 까지 올라가고(이미 높으면 그대로), 다른 모드로 돌아가면 올리기 전 높이로 되돌아갑니다. 그동안 사용자가 눈 높이를 바꿨으면 건드리지 않습니다.
 *  - "여기로 가기": 고른 점까지 직선으로, 양 끝에서 천천히 · 가운데서 빠르게(5 차 smootherstep) 눈을 옮깁니다. 걸리는 시간은 거리 ÷ 150 m/s 를 1 ~ 8 초로 잘랐습니다.
 *
 * 판정: `tools/shader-preview/verify-fly-glide.js`
 */
import { localOffsetM, offsetLatLon } from './geoMove';
import type { MoveMode } from './joystickMotion';

export interface LatLon { latitude: number; longitude: number }

/** 비행 모드에서 눈이 올라가는 높이(m). `sandboxDials.EYE_TICKS` 의 칩 하나입니다. */
export const FLY_EYE_M = 100;
/** 여기로 가기: 이 거리(m)보다 가까우면 가지 않습니다. */
export const GLIDE_MIN_M = 0.01;
const GLIDE_MPS = 150;
const GLIDE_MIN_S = 1;
const GLIDE_MAX_S = 8;

export interface EyeForMode { eyeH: number; stash: number | null }

/** 모드가 바뀔 때의 눈 높이. `stash` 는 비행으로 올리기 전 높이(없으면 null). */
export function eyeForMode(from: MoveMode, to: MoveMode, eyeH: number, stash: number | null): EyeForMode {
  const fin = Number.isFinite(eyeH);
  if (to === 'fly' && from !== 'fly') {
    if (!fin) return { eyeH: FLY_EYE_M, stash: null };
    if (eyeH >= FLY_EYE_M) return { eyeH, stash: null };
    return { eyeH: FLY_EYE_M, stash: eyeH };
  }
  if (from === 'fly' && to !== 'fly') {
    if (stash !== null && eyeH === FLY_EYE_M) return { eyeH: stash, stash: null };
    return { eyeH, stash: null };
  }
  return { eyeH, stash };
}

export interface GlidePlan { distM: number; durationS: number }

const finLL = (p: LatLon): boolean => !!p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude);

/** 거리와 걸리는 시간. 가까우면(0.01 m 미만) 또는 좌표가 숫자가 아니면 null. */
export function glidePlan(from: LatLon, to: LatLon): GlidePlan | null {
  if (!finLL(from) || !finLL(to)) return null;
  const o = localOffsetM(from, to.latitude, to.longitude);
  const d = Math.hypot(o.eastM, o.northM);
  if (!(d >= GLIDE_MIN_M)) return null;
  return { distM: d, durationS: Math.min(GLIDE_MAX_S, Math.max(GLIDE_MIN_S, d / GLIDE_MPS)) };
}

const smoother = (u: number): number => u * u * u * (u * (6 * u - 15) + 10);

/** 지난 시간 비율 u(0 ~ 1)에서의 눈의 자리. u ≤ 0 · NaN 은 출발점, u ≥ 1 은 도착점. */
export function glideAt(from: LatLon, to: LatLon, u: number): LatLon {
  if (!(u > 0)) return { latitude: from.latitude, longitude: from.longitude };
  if (u >= 1) return { latitude: to.latitude, longitude: to.longitude };
  const o = localOffsetM(from, to.latitude, to.longitude);
  const s = smoother(u);
  const p = offsetLatLon(from.latitude, from.longitude, o.eastM * s, o.northM * s);
  return { latitude: p.latitude, longitude: p.longitude };
}
