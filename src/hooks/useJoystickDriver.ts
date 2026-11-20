/**
 * useJoystickDriver.ts — 연속 이동 조이스틱을 화면에 잇는 훅(docs/SANDBOX_MODE_PLAN.md 12.2). 계산은 `utils/joystickDriver.ts`(순수)가 하고, 이 훅은
 *
 *  - 손잡이를 쥐고 있는 동안(그리고 놓은 뒤 미끄러지는 동안) `requestAnimationFrame` 으로 프레임을 돌리고,
 *  - 프레임마다 `advance` 의 결과를 장면(`setEye`)과 저장소(`commit`)에 옮기며,
 *  - 속도 · 눈의 자리를 초당 10 번만 읽음 상태(`readout`)로 내보냅니다 — 숫자 글이 프레임마다 다시 그려지지 않게.
 *
 * 움직임이 끝나면(속도가 가라앉으면) `commit` 이 한 번 불리고, 장면은 그 자리가 새 위치가 되면서 눈이 위치를 다시 따릅니다(커밋이 눈의 자리라 화면이 튀지 않습니다).
 * 확정 없이 접히면(`done = 'cancel'`) `clearEye` 가 불려 장면의 눈이 저장된 위치로 돌아갑니다.
 * 패널이 사라질 때 아직 움직이는 중이면 그 자리를 확정합니다(옛 위치로 되돌아가지 않게).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { IDLE, advance, nudgeTo, readoutDue, type DriverState, type LatLon } from '../utils/joystickDriver';
import type { HeadingRef, MoveMode, Vec2 } from '../utils/joystickMotion';
import type { StickState } from '../utils/sandboxDials';

const OFF: StickState = { active: false, east: 0, north: 0, mag: 0 };

export interface DriverHost {
  mode: MoveMode;
  ref: HeadingRef;
  /** 지금 **저장된** 위치. 움직임을 시작할 때와 프레임마다 바깥에서 바뀌었는지 가릴 때 읽습니다(저장소에서 바로 읽어야 방금 확정한 값이 옵니다). */
  getOrigin: () => LatLon;
  /** 장면이 알려 주는 시선 방위(도). 모르면 null. */
  getHeading: () => number | null;
  /** 장면의 눈을 옮깁니다(프레임마다). */
  setEye: (p: LatLon) => void;
  /** 장면의 눈을 저장된 위치로 되돌립니다(확정 없이 접을 때). */
  clearEye: () => void;
  /** 이 자리를 새 위치로 저장합니다. */
  commit: (p: LatLon) => void;
  /** 손잡이를 새로 쥘 때(움직임이 시작되기 직전). 다른 이동(여기로 가기)을 그 자리에서 끝낼 때 씁니다. */
  onGrab?: () => void;
}

export interface DriverReadout {
  /** 손잡이를 쥐었거나 미끄러지는 중 */
  moving: boolean;
  /** 지금 속력(m/s) */
  speed: number;
  /** 움직이는 중에만: 눈의 자리 */
  eye: LatLon | null;
}

export const REST: DriverReadout = Object.freeze({ moving: false, speed: 0, eye: null });

const nowMs = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const raf = (cb: () => void): number => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number));
const caf = (id: number): void => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); else clearTimeout(id as unknown as ReturnType<typeof setTimeout>); };

export function useJoystickDriver(host: DriverHost) {
  const hostRef = useRef(host);
  hostRef.current = host;
  const stick = useRef<StickState>(OFF);
  const state = useRef<DriverState>(IDLE);
  const timer = useRef<number | null>(null);
  const lastT = useRef(0);
  const lastPub = useRef<number | null>(null);
  const wasMoving = useRef(false);
  const [readout, setReadout] = useState<DriverReadout>(REST);

  const frame = useRef<() => void>(() => {});
  const schedule = useCallback(() => {
    if (timer.current === null) timer.current = raf(() => frame.current());
  }, []);
  frame.current = () => {
    timer.current = null;
    const h = hostRef.current;
    const t = nowMs();
    const dt = (t - lastT.current) / 1000;
    lastT.current = t;
    const step = advance(state.current, dt, { stick: stick.current, mode: h.mode, ref: h.ref, headingDeg: h.getHeading() }, h.getOrigin());
    state.current = step.state;
    if (step.eye) h.setEye(step.eye);
    if (step.done === 'commit' && step.commit) h.commit(step.commit);
    else if (step.done === 'cancel') h.clearEye();
    const force = step.moving !== wasMoving.current;
    wasMoving.current = step.moving;
    if (readoutDue(lastPub.current, t, force)) {
      lastPub.current = t;
      setReadout(step.moving ? { moving: true, speed: step.speed, eye: step.eye } : REST);
    }
    if (step.moving) schedule();
  };

  const halt = useCallback(() => {
    if (timer.current !== null) { caf(timer.current); timer.current = null; }
    state.current = IDLE;
    stick.current = OFF;
    wasMoving.current = false;
    setReadout(REST);
  }, []);

  /** 손잡이 상태가 바뀔 때마다. 쥐었거나 미끄러지는 중이면 프레임 순환을 시작합니다. */
  const onStick = useCallback((s: StickState) => {
    if (s.active && !stick.current.active) hostRef.current.onGrab?.();
    stick.current = s;
    if ((s.active || state.current.eye) && timer.current === null) {
      lastT.current = nowMs();
      schedule();
    }
  }, [schedule]);

  /** 스크린리더 한 동작: 지금 자리에서 한 번에 가서 바로 확정합니다. */
  const nudge = useCallback((dir: Vec2) => {
    const h = hostRef.current;
    const from = state.current.eye ?? h.getOrigin();
    const to = nudgeTo(from, dir, h.mode, h.ref, h.getHeading());
    halt();
    h.commit(to);
  }, [halt]);

  /** 움직임을 확정 없이 접습니다(바깥에서 위치를 바꿀 때: 내 위치로 등). 장면의 눈은 부르는 쪽이 정합니다. */
  const cancel = halt;

  useEffect(() => () => {
    if (timer.current !== null) { caf(timer.current); timer.current = null; }
    const e = state.current.eye;
    state.current = IDLE;
    if (e) hostRef.current.commit(e);
  }, []);

  return { readout, onStick, nudge, cancel };
}
