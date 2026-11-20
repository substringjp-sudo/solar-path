/**
 * joystickMotion.ts — **연속 이동 조이스틱의 이동 엔진**(순수 로직, 장면은 건드리지 않습니다. docs/SANDBOX_MODE_PLAN.md 12.2, 사용자 승인 2026-11-20).
 *
 * 옛 조이스틱은 손잡이를 민 방향으로 10 m · 100 m · 1 km 씩 **걸음 단위로** 위치를 바꿨습니다(`sandboxDials.stepMove`). 그래서 순간이동처럼 보였습니다.
 * 새 조이스틱은 손잡이를 민 정도로 **속도**를 정하고, 프레임마다 그 속도로 조금씩 움직입니다.
 *
 *  - 속도 곡선: 데드존(중심 둘레 28 %)을 뺀 나머지를 0~1 로 늘려 **제곱**하고 모드의 최고 속도를 곱합니다. 조금 밀면 천천히, 끝까지 밀면 최고 속도입니다.
 *    모드와 최고 속도: 걷기 2 · 자전거 8 · 차 25 · 비행 120 m/s. (데드존을 빼고 0~1 로 늘리는 것은 `sandboxDials.stickState` 가 이미 `mag` 로 냅니다.)
 *  - 부드러운 가감속: 현재 속도가 목표 속도를 향해 **지수로**(시간상수 τ = 0.3 초) 다가갑니다. 손을 떼면 같은 꼴로 줄어 미끄러지듯 멈춥니다. 목표를 넘지 않습니다.
 *  - 프레임 간격에 무관한 이동량: 한 프레임에서 간 거리를 `속도 × dt` 로 어림하지 않고 **닫힌 식으로 적분**합니다. 목표가 일정한 동안은 프레임 간격이 얼마든 합이 같습니다.
 *  - 방향은 **시선 기준**이 기본입니다(손잡이 위 = 보고 있는 쪽). 나침반 기준으로도 바꿀 수 있습니다(손잡이 위 = 북).
 *
 * 먼 곳은 이 조이스틱으로 가지 않습니다(비행 최고 속도로도 10 km 에 약 84 초). 먼 곳은 저장한 장면 열기나 "여기로 가기"로 갑니다.
 *
 * 판정: `tools/shader-preview/verify-joystick-motion.js`
 */
import type { StickState } from './sandboxDials';

export type MoveMode = 'walk' | 'bike' | 'car' | 'fly';
export const MOVE_MODES: readonly MoveMode[] = ['walk', 'bike', 'car', 'fly'];
/** 모드마다 손잡이를 끝까지 밀었을 때의 속도(m/s) */
export const MODE_MAX_SPEED_MPS: Record<MoveMode, number> = { walk: 2, bike: 8, car: 25, fly: 120 };
/** 속도가 목표를 향해 다가가는 시간상수(초). 이 시간에 남은 차의 1/e 만 남습니다. */
export const SPEED_SMOOTH_S = 0.3;

/** 시선 기준이면 손잡이 위가 보고 있는 쪽, 나침반 기준이면 북. */
export type HeadingRef = 'view' | 'compass';

/** 동(+) · 북(+) 두 성분. 속도(m/s)로도, 거리(m)로도 씁니다. */
export interface Vec2 { east: number; north: number }

const finite = (x: number): number => (Number.isFinite(x) ? x : 0);

/**
 * 손잡이 상태 → 목표 속도(m/s). 방향은 손잡이 축(동 = 화면 오른쪽, 북 = 화면 위), 크기는 `모드 최고 속도 × mag²`.
 * 비활성이거나 값이 NaN 이면 0 입니다.
 */
export function targetVelocity(s: StickState, mode: MoveMode): Vec2 {
  if (!s.active || !Number.isFinite(s.east) || !Number.isFinite(s.north) || !Number.isFinite(s.mag)) return { east: 0, north: 0 };
  const mag = Math.min(1, Math.max(0, s.mag));
  const len = Math.hypot(s.east, s.north);
  const speed = MODE_MAX_SPEED_MPS[mode] * mag * mag;
  if (!(len > 0) || !(speed > 0)) return { east: 0, north: 0 };
  return { east: (s.east / len) * speed, north: (s.north / len) * speed };
}

/**
 * 손잡이 축의 속도 → 지도 축(동 · 북)의 속도. `view` 면 시선 방위 `headingDeg`(북 0, 동쪽으로 늘어남)만큼 돌립니다:
 * 손잡이 "앞"은 (동, 북) = (sin h, cos h), "오른쪽"은 (cos h, −sin h). `compass` 면 그대로. 회전은 속력을 바꾸지 않습니다.
 */
export function toWorld(v: Vec2, headingDeg: number, ref: HeadingRef): Vec2 {
  if (ref === 'compass') return { east: v.east, north: v.north };
  const h = (finite(headingDeg) * Math.PI) / 180;
  const s = Math.sin(h);
  const c = Math.cos(h);
  return { east: v.east * c + v.north * s, north: -v.east * s + v.north * c };
}

/**
 * 한 프레임: 현재 속도 `v` 를 목표 `target` 쪽으로 부드럽게 바꾸고, 이 프레임 동안 간 거리(m)를 **정확히** 적분합니다.
 * 목표가 이 프레임 동안 일정하다고 보면 v(t) = target + (v0 − target)·e^(−t/τ) 이므로
 *   다음 속도 = target + (v0 − target)·e^(−dt/τ),   간 거리 = target·dt + (v0 − target)·τ·(1 − e^(−dt/τ)).
 * `dt` 가 0 이하이거나 NaN · 무한대면 움직이지 않고 속도도 그대로입니다. 속도에 NaN 이 들어오면 0 으로 칩니다.
 */
export function stepMotion(v: Vec2, target: Vec2, dtS: number, tauS: number = SPEED_SMOOTH_S): { v: Vec2; dEast: number; dNorth: number } {
  const cur: Vec2 = { east: finite(v.east), north: finite(v.north) };
  if (!(dtS > 0) || !Number.isFinite(dtS)) return { v: cur, dEast: 0, dNorth: 0 };
  const tau = Math.max(1e-6, finite(tauS));
  const k = Math.exp(-dtS / tau);          // dt 뒤에 남는 비율
  const w = tau * (1 - k);                 // 속도 차 1 이 이 프레임에서 만드는 거리
  const tgt: Vec2 = { east: finite(target.east), north: finite(target.north) };
  return {
    v: { east: tgt.east + (cur.east - tgt.east) * k, north: tgt.north + (cur.north - tgt.north) * k },
    dEast: tgt.east * dtS + (cur.east - tgt.east) * w,
    dNorth: tgt.north * dtS + (cur.north - tgt.north) * w,
  };
}

/** 속력(m/s) */
export const speedOf = (v: Vec2): number => Math.hypot(v.east, v.north);

/** 움직이는 동안 보이는 속도 글: 9.95 m/s 미만은 소수 한 자리("1.2 m/s"), 그 이상은 정수("84 m/s"). 음수나 NaN 은 "0.0 m/s". */
export function formatSpeed(mps: number): string {
  const v = Number.isFinite(mps) && mps > 0 ? mps : 0;
  return v < 9.95 ? `${v.toFixed(1)} m/s` : `${Math.round(v)} m/s`;
}
