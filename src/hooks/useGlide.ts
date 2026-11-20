/**
 * useGlide.ts — "여기로 가기": 고른 점까지 눈을 부드럽게 옮기는 훅(docs/SANDBOX_MODE_PLAN.md 12.5 6번). 계산은 `utils/flightAssist.ts`(순수).
 *
 * 움직이는 동안 저장된 위치는 그대로 두고 장면의 눈만 옮기며(조이스틱과 같은 길), 도착하면 그 자리를 새 위치로 한 번 저장합니다.
 *  - 저장된 위치가 바깥에서 바뀌면(내 위치로 · 장면 열기 · 위치 갱신) 접습니다. 그쪽이 눈을 정합니다.
 *  - `finish()`: 지금 눈의 자리에서 멈추고 그 자리를 저장합니다(조이스틱을 쥘 때, 옛 자리로 튀지 않게).
 *  - `cancel()`: 확정 없이 접고 눈을 저장된 위치로 되돌립니다.
 */
import { useCallback, useEffect, useRef } from 'react';
import { glideAt, glidePlan, type LatLon } from '../utils/flightAssist';

export interface GlideHost {
  getOrigin: () => LatLon;
  setEye: (p: LatLon) => void;
  clearEye: () => void;
  commit: (p: LatLon) => void;
}

interface Run { from: LatLon; to: LatLon; startMs: number; durationS: number; eye: LatLon }

const SAME_DEG = 1e-9;
const nowMs = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const raf = (cb: () => void): number => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number));
const caf = (id: number): void => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); else clearTimeout(id as unknown as ReturnType<typeof setTimeout>); };

export function useGlide(host: GlideHost) {
  const hostRef = useRef(host);
  hostRef.current = host;
  const run = useRef<Run | null>(null);
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) { caf(timer.current); timer.current = null; }
    run.current = null;
  }, []);

  const tick = useRef<() => void>(() => {});
  tick.current = () => {
    timer.current = null;
    const r = run.current;
    if (!r) return;
    const h = hostRef.current;
    const o = h.getOrigin();
    if (Math.abs(o.latitude - r.from.latitude) > SAME_DEG || Math.abs(o.longitude - r.from.longitude) > SAME_DEG) { stop(); return; }
    const u = (nowMs() - r.startMs) / 1000 / r.durationS;
    if (u >= 1) { stop(); h.commit(r.to); return; }
    r.eye = glideAt(r.from, r.to, u);
    h.setEye(r.eye);
    timer.current = raf(() => tick.current());
  };

  /** `to` 로 가기를 시작합니다. 갈 필요가 없으면(이미 그 자리) false. */
  const start = useCallback((to: LatLon): boolean => {
    stop();
    const from = hostRef.current.getOrigin();
    const plan = glidePlan(from, to);
    if (!plan) return false;
    run.current = { from, to, startMs: nowMs(), durationS: plan.durationS, eye: from };
    timer.current = raf(() => tick.current());
    return true;
  }, [stop]);

  const finish = useCallback(() => {
    const r = run.current;
    if (!r) return;
    stop();
    hostRef.current.commit(r.eye);
  }, [stop]);

  const cancel = useCallback(() => {
    if (!run.current) return;
    stop();
    hostRef.current.clearEye();
  }, [stop]);

  useEffect(() => () => { if (timer.current !== null) caf(timer.current); run.current = null; }, []);

  return { start, finish, cancel };
}
