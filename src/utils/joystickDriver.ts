/**
 * joystickDriver.ts — **연속 이동 조이스틱의 구동기**(순수 로직, 장면 · 화면은 건드리지 않습니다. docs/SANDBOX_MODE_PLAN.md 12.2, 사용자 승인 2026-11-20).
 *
 * `joystickMotion.ts` 는 "프레임 하나"의 계산이었습니다(속도 곡선 · 부드러운 가감속 · 시선 기준 회전). 이 모듈은 그것을 **프레임마다 이어 붙여** 눈의 자리를 만들고,
 * 언제 위치를 확정(커밋)할지 정합니다. 화면(`useJoystickDriver`)은 프레임마다 `advance` 를 부르고 그 결과를 장면(`setEyeLocation`)과 저장소(`setLocation`)에 옮기기만 합니다.
 *
 *  - 움직이는 동안 **저장된 위치는 그대로**고 눈만 옮깁니다. 날씨 · 물 지도 · 땅 프로필은 저장된 위치를 따르므로, 움직이는 동안 다시 받지 않습니다.
 *  - **손을 놓고 속도가 0.05 m/s 아래로 가라앉으면 멈춘 것**으로 보고 눈의 자리를 한 번만 확정합니다(`done = 'commit'`). 손잡이를 쥐고 있는 동안은 속도가 작아도 멈춘 게 아닙니다.
 *    손을 놓은 프레임에서 목표 속도가 0 이 되므로, 확정한 자리는 "누른 시간 × 목표 속도"에서 남은 미끄러짐(최대 0.05·τ = 1.5 cm)만 못 미친 자리입니다(판정이 이 항등식을 잽니다).
 *  - 1 cm 도 못 움직였으면 확정하지 않고 접습니다(`done = 'cancel'`) — 같은 자리를 다시 저장해 날씨 · 지도를 헛되이 다시 받게 하지 않습니다.
 *  - 이동 중에 저장된 위치가 **바깥에서** 바뀌면(내 위치로 · 다른 곳 고르기 · 위치 갱신) 움직임을 접습니다. 눈이 옛 위치로 되돌아가 장면과 저장소가 어긋나는 것을 막습니다.
 *  - 한 프레임이 0.1 초보다 길면(탭 전환 · 일시 정지에서 돌아옴) 0.1 초만 간 것으로 칩니다. 긴 프레임이 순간이동이 되지 않게 합니다.
 *  - 시선 방위를 모르면(`null` · NaN) "시선 기준"을 골라도 나침반 기준으로 움직입니다.
 *  - 스크린리더(손잡이를 끌 수 없는 사람)는 한 동작에 **모드 최고 속도로 5 초 가는 거리**(걷기 10 m · 자전거 40 m · 차 125 m · 비행 600 m)를 한 번에 갑니다(`nudgeTo`).
 *
 * 판정: `tools/shader-preview/verify-joystick-driver.js`
 */
import { localOffsetM, offsetLatLon } from './geoMove';
import { MODE_MAX_SPEED_MPS, speedOf, stepMotion, targetVelocity, toWorld, type HeadingRef, type MoveMode, type Vec2 } from './joystickMotion';
import type { StickState } from './sandboxDials';

export interface LatLon { latitude: number; longitude: number }

/** 이 속도(m/s) 아래로 가라앉고 손잡이도 놓았으면 멈춘 것으로 봅니다. 남는 미끄러짐은 이 값 × τ = 1.5 cm 안쪽. */
export const STOP_SPEED_MPS = 0.05;
/** 한 프레임이 이보다 길면 이만큼만 간 것으로 칩니다(초). */
export const MAX_FRAME_S = 0.1;
/** 스크린리더 한 동작: 모드 최고 속도로 이 시간(초)만큼 가는 거리. */
export const NUDGE_S = 5;
/** 속도 · 거리 글을 새로 그리는 최소 간격(ms). 프레임마다 다시 그리지 않게 합니다. */
export const READOUT_MS = 100;
/** 이 거리(m)보다 적게 움직였으면 위치를 확정하지 않습니다. */
export const COMMIT_MIN_M = 0.01;
/** 저장된 위치가 이만큼(도) 넘게 달라지면 바깥에서 바뀐 것으로 봅니다(≈ 0.1 mm). 반올림 차는 무시합니다. */
const SAME_SPOT_DEG = 1e-9;

export interface DriverState {
  /** 지도 축 속도(m/s) */
  v: Vec2;
  /** 움직이는 중에만: 눈의 자리. 쉬는 중이면 null. */
  eye: LatLon | null;
  /** 이번 움직임을 시작할 때의 저장된 위치. 바깥에서 바뀌었는지 가리는 기준입니다. 쉬는 중이면 null. */
  startOrigin: LatLon | null;
}

export const IDLE: DriverState = Object.freeze({ v: Object.freeze({ east: 0, north: 0 }), eye: null, startOrigin: null }) as DriverState;

export interface DriveInput {
  stick: StickState;
  mode: MoveMode;
  ref: HeadingRef;
  /** 장면이 알려 주는 시선 방위(도). 모르면 null. */
  headingDeg: number | null;
}

export interface DriveStep {
  state: DriverState;
  /** 이 프레임에 장면에 둘 눈의 자리. null 이면 장면에 새로 줄 것이 없습니다(쉬는 중이거나 확정 없이 접힘). */
  eye: LatLon | null;
  /** 멈췄으니 이 자리를 위치로 확정하라. 한 번만 나옵니다. */
  commit: LatLon | null;
  /** 이 프레임의 속력(m/s) */
  speed: number;
  /** 손잡이를 쥐었거나 미끄러지는 중 */
  moving: boolean;
  /** 이 프레임에 움직임이 끝났다: 'commit' = 확정, 'cancel' = 확정 없이 접음(호스트는 장면의 눈을 거둡니다). 아니면 null. */
  done: 'commit' | 'cancel' | null;
}

const ZERO: Vec2 = { east: 0, north: 0 };

/** 시선 기준을 골라도 방위를 모르면 나침반 기준. */
export const effectiveRef = (ref: HeadingRef, headingDeg: number | null): HeadingRef =>
  ref === 'view' && headingDeg !== null && Number.isFinite(headingDeg) ? 'view' : 'compass';

const sameSpot = (a: LatLon, b: LatLon): boolean => Math.abs(a.latitude - b.latitude) <= SAME_SPOT_DEG && Math.abs(a.longitude - b.longitude) <= SAME_SPOT_DEG;

const movedM = (from: LatLon, to: LatLon): number => {
  const o = localOffsetM(from, to.latitude, to.longitude);
  return Math.hypot(o.eastM, o.northM);
};

/**
 * 한 프레임. `state` 는 지난 프레임의 `step.state`(처음엔 `IDLE`), `origin` 은 지금 **저장된** 위치입니다.
 * 쉬는 중이고 손잡이도 안 잡았으면 상태를 그대로 돌려줍니다.
 */
export function advance(state: DriverState, dtS: number, input: DriveInput, origin: LatLon): DriveStep {
  const { stick } = input;
  // 이동 중인데 저장된 위치가 바깥에서 바뀌었다: 접습니다(확정하지 않습니다).
  if (state.eye && state.startOrigin && !sameSpot(origin, state.startOrigin)) {
    return { state: IDLE, eye: null, commit: null, speed: 0, moving: false, done: 'cancel' };
  }
  if (!state.eye && !stick.active) return { state, eye: null, commit: null, speed: 0, moving: false, done: null };

  const heading = input.headingDeg !== null && Number.isFinite(input.headingDeg) ? input.headingDeg : 0;
  const target = stick.active ? toWorld(targetVelocity(stick, input.mode), heading, effectiveRef(input.ref, input.headingDeg)) : ZERO;
  const dt = Number.isFinite(dtS) ? Math.min(dtS, MAX_FRAME_S) : 0;
  const r = stepMotion(state.v, target, dt);
  const base = state.eye ?? origin;
  const p = offsetLatLon(base.latitude, base.longitude, r.dEast, r.dNorth);
  const eye: LatLon = { latitude: p.latitude, longitude: p.longitude };
  const speed = speedOf(r.v);
  const startOrigin = state.startOrigin ?? { latitude: origin.latitude, longitude: origin.longitude };

  if (!stick.active && speed < STOP_SPEED_MPS) {
    if (movedM(startOrigin, eye) >= COMMIT_MIN_M) return { state: IDLE, eye, commit: eye, speed, moving: false, done: 'commit' };
    return { state: IDLE, eye: null, commit: null, speed, moving: false, done: 'cancel' };
  }
  return { state: { v: r.v, eye, startOrigin }, eye, commit: null, speed, moving: true, done: null };
}

/**
 * 스크린리더 한 동작이 가는 자리: `from` 에서 `dir`(손잡이 축, 동 +, 북 +) 방향으로 모드 최고 속도 × 5 초만큼.
 * 손잡이를 안 민 방향(0, 0)이면 제자리입니다.
 */
export function nudgeTo(from: LatLon, dir: Vec2, mode: MoveMode, ref: HeadingRef, headingDeg: number | null): LatLon {
  const heading = headingDeg !== null && Number.isFinite(headingDeg) ? headingDeg : 0;
  const w = toWorld(dir, heading, effectiveRef(ref, headingDeg));
  const len = Math.hypot(w.east, w.north);
  if (!(len > 0)) return { latitude: from.latitude, longitude: from.longitude };
  const d = MODE_MAX_SPEED_MPS[mode] * NUDGE_S;
  const p = offsetLatLon(from.latitude, from.longitude, (w.east / len) * d, (w.north / len) * d);
  return { latitude: p.latitude, longitude: p.longitude };
}

/**
 * 속도 · 거리 글을 지금 새로 그릴 때인가. 처음이거나 강제(움직임의 시작 · 끝)면 참, 아니면 `READOUT_MS` 가 지나야 참입니다.
 * 시계가 거꾸로 가거나 NaN 이면 참입니다(글이 멈춰 버리지 않게).
 */
export function readoutDue(lastMs: number | null, nowMs: number, force: boolean): boolean {
  if (force || lastMs === null) return true;
  const dt = nowMs - lastMs;
  return !Number.isFinite(dt) || dt < 0 || dt >= READOUT_MS;
}
