/**
 * sandboxDials.ts — 샌드박스의 **세로 막대(높이 · 줌)와 이동 조이스틱**(docs/SANDBOX_MODE_PLAN.md 2.2, 목업 2번)이 쓰는 계산. 순수 함수입니다.
 *
 *  - 세로 막대는 **로그 눈금**입니다(아래 = 최솟값, 위 = 최댓값). 눈 높이 1.6 m → 300 m, 줌 1× → 20×. 낮은 값에서 잘게, 높은 값에서 크게 움직입니다.
 *  - 눈금(미리 정한 값: 눈 높이 1.6 · 10 · 30 · 100 · 300 m, 줌 1 · 2 · 5 · 10 · 20×) **가까이(±3.5 %)에서 놓으면 그 값으로 붙습니다.**
 *    예전의 칩과 망원 단추가 하던 일을 막대 위 눈금이 이어받습니다.
 *  - 조이스틱은 손잡이를 민 방향으로, **누르고 있는 동안 한 걸음(걸음 크기만큼)씩 반복**해서 움직입니다. 많이 밀수록 더 자주(450 ms → 120 ms).
 *    중심 둘레 데드존(28 %) 안에서는 움직이지 않습니다. 방향은 나침반 기준(위 = 북, 오른쪽 = 동)이라 예전 동서남북 단추와 같습니다.
 */

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface DialRange { min: number; max: number }

/** 눈 높이(m). `SandboxPanel.EYE_HEIGHT_CHOICES_M` 의 처음과 끝과 같아야 합니다(판정이 소스에서 대어 봅니다). */
export const EYE_RANGE: DialRange = { min: 1.6, max: 300 };
export const EYE_TICKS: readonly number[] = [1.6, 10, 30, 100, 300];
/** 줌 배율. `SkyScene3D.TELE_MAX` 와 같아야 합니다(판정이 소스에서 대어 봅니다). */
export const ZOOM_RANGE: DialRange = { min: 1, max: 20 };
export const ZOOM_TICKS: readonly number[] = [1, 2, 5, 10, 20];

/** 눈금에 붙는 거리(막대 길이의 비율) */
export const SNAP_T = 0.035;

/** 값 → 막대 위치 t(0 아래 ~ 1 위, 로그) */
export const valueToT = (v: number, r: DialRange): number => clamp(Math.log(Math.max(r.min, v) / r.min) / Math.log(r.max / r.min), 0, 1);
/** 막대 위치 t → 값 */
export const tToValue = (t: number, r: DialRange): number => r.min * Math.pow(r.max / r.min, clamp(t, 0, 1));

/** 눈금 가까이(±`SNAP_T`)면 가장 가까운 눈금 값, 아니면 그대로. */
export function snapValue(v: number, r: DialRange, ticks: readonly number[]): number {
  const t = valueToT(v, r);
  let best = v, bestD = SNAP_T;
  for (const k of ticks) {
    const d = Math.abs(valueToT(k, r) - t);
    if (d <= bestD) { bestD = d; best = k; }
  }
  return best;
}

/** 스크린리더의 올리기·내리기: 지금 값에서 한 눈금 위(`dir` 1) 또는 아래(−1). 끝에서는 그대로. */
export function stepToTick(v: number, ticks: readonly number[], dir: 1 | -1): number {
  const eps = 1e-6;
  if (dir === 1) { for (const k of ticks) if (k > v + eps) return k; return ticks[ticks.length - 1]; }
  for (let i = ticks.length - 1; i >= 0; i--) if (ticks[i] < v - eps) return ticks[i];
  return ticks[0];
}

/** 화면에 적고 장면에 넘길 눈 높이: 10 m 미만 0.1 m, 100 m 미만 1 m, 그 위 5 m 단위 */
export const roundEye = (m: number): number => (m < 10 ? Math.round(m * 10) / 10 : m < 100 ? Math.round(m) : Math.round(m / 5) * 5);
/** 화면에 적고 장면에 넘길 줌: 10× 미만 0.1×, 그 위 0.5× 단위 */
export const roundZoom = (x: number): number => (x < 10 ? Math.round(x * 10) / 10 : Math.round(x * 2) / 2);

export const fmtEye = (m: number): string => `${m < 10 ? m.toFixed(1) : String(m)} m`;
export const fmtZoom = (x: number): string => (Number.isInteger(x) ? `${x}×` : `${x.toFixed(1)}×`);

/** 막대 위에서 손가락의 세로 위치 y(px, 위가 0) → t. 위쪽이 큰 값. */
export const tFromY = (y: number, heightPx: number): number => clamp(1 - y / Math.max(1, heightPx), 0, 1);
export const yFromT = (t: number, heightPx: number): number => (1 - clamp(t, 0, 1)) * heightPx;

// ── 조이스틱 ────────────────────────────────────────────────────────────────

/** 중심 둘레 이 비율 안은 안 움직입니다. */
export const STICK_DEADZONE = 0.28;

export interface StickState {
  active: boolean;
  /** 방향 단위 벡터(동 +, 북 +). 안 움직이면 0. */
  east: number;
  north: number;
  /** 밀린 정도 0~1(데드존 바깥에서 다시 0 부터 1 로 늘림) */
  mag: number;
}

/** 손잡이가 중심에서 (dx, dy)px(화면 좌표: 오른쪽 +, 아래 +) 벗어났을 때. `travelPx` 는 손잡이가 갈 수 있는 반지름. */
export function stickState(dx: number, dy: number, travelPx: number): StickState {
  const off: StickState = { active: false, east: 0, north: 0, mag: 0 };
  const r = Math.hypot(dx, dy);
  if (!(travelPx > 0) || !Number.isFinite(r) || r === 0) return off;
  const m = Math.min(1, r / travelPx);
  if (m < STICK_DEADZONE) return off;
  return { active: true, east: dx / r, north: -dy / r, mag: (m - STICK_DEADZONE) / (1 - STICK_DEADZONE) };
}

/** 한 걸음과 다음 걸음 사이(ms). 데드존 바로 밖 450, 끝까지 밀면 120. */
export const stickIntervalMs = (mag: number): number => Math.round(450 - 330 * clamp(mag, 0, 1));

/** 손잡이를 그릴 자리: 중심에서 `travelPx` 안으로 자릅니다. */
export function clampKnob(dx: number, dy: number, travelPx: number): { x: number; y: number } {
  const r = Math.hypot(dx, dy);
  if (!(r > travelPx) || r === 0) return { x: dx, y: dy };
  return { x: (dx / r) * travelPx, y: (dy / r) * travelPx };
}

/** 한 걸음의 이동량(m): 걸음 크기(`stepM`)만큼, 민 방향으로. */
export const stepMove = (s: StickState, stepM: number): { eastM: number; northM: number } => ({ eastM: s.east * stepM, northM: s.north * stepM });
