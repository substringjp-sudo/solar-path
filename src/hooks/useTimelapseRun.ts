/**
 * useTimelapseRun.ts — 타임랩스 연속 촬영(docs/SANDBOX_MODE_PLAN.md 8.3.1, 목업 12). 계산은 `utils/timelapsePlan.ts`(순수).
 *
 * 시작하면 계획의 간격마다 `shoot()` 를 불러 사진 한 장씩 찍고 저장합니다. 시작 시각 기준으로 다음 장을 잡아(`nextDelayMs`) 간격이 어긋나 쌓이지 않습니다.
 * `shoot` 는 한 장을 찍어 저장했으면 true. 연속 3 번 실패하면 멈추고 `error` 를 알립니다. 마지막 장을 찍으면 끝납니다(`done`).
 * 사진 묶음을 앨범에 저장하는 것까지가 지금 범위입니다(영상 만들기는 아직 없습니다).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { nextDelayMs, runProgress, type RunProgress, type TimelapsePlan } from '../utils/timelapsePlan';

export const MAX_CONSECUTIVE_FAILS = 3;

export interface RunState {
  plan: TimelapsePlan;
  startMs: number;
  /** 저장까지 끝난 장수 */
  taken: number;
  failed: number;
  running: boolean;
  /** 연속 실패로 멈췄다 */
  error: boolean;
}

export function useTimelapseRun(shoot: () => Promise<boolean>) {
  const shootRef = useRef(shoot);
  shootRef.current = shoot;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef<RunState | null>(null);
  const streak = useRef(0);
  const [run, setRun] = useState<RunState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const publish = (s: RunState | null) => { live.current = s; setRun(s); };

  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  const step = useRef<(index: number) => void>(() => {});
  step.current = (index: number) => {
    const s = live.current;
    if (!s || !s.running) return;
    const wait = nextDelayMs(s.startMs, s.plan.intervalS, index, Date.now());
    timer.current = setTimeout(async () => {
      const cur = live.current;
      if (!cur || !cur.running) return;
      let ok = false;
      try { ok = await shootRef.current(); } catch { ok = false; }
      const after = live.current;
      if (!after || !after.running) return;
      streak.current = ok ? 0 : streak.current + 1;
      const next: RunState = { ...after, taken: after.taken + (ok ? 1 : 0), failed: after.failed + (ok ? 0 : 1) };
      if (streak.current >= MAX_CONSECUTIVE_FAILS) { publish({ ...next, running: false, error: true }); return; }
      if (index + 1 >= after.plan.frames) { publish({ ...next, running: false }); return; }
      publish(next);
      setNow(Date.now());
      step.current(index + 1);
    }, wait);
  };

  const start = useCallback((plan: TimelapsePlan) => {
    clear();
    streak.current = 0;
    publish({ plan, startMs: Date.now(), taken: 0, failed: 0, running: true, error: false });
    step.current(0);
  }, []);

  /** 마치기: 지금까지 찍은 사진은 남습니다. */
  const stop = useCallback(() => {
    clear();
    const s = live.current;
    if (s) publish({ ...s, running: false });
  }, []);

  const dismiss = useCallback(() => { clear(); publish(null); }, []);

  // 남은 시간 글을 1 초마다 새로 그립니다.
  useEffect(() => {
    if (!run?.running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [run?.running]);

  useEffect(() => () => { clear(); }, []);

  const progress: RunProgress | null = run ? runProgress(run.startMs, run.plan.intervalS, run.plan.frames, run.taken, now) : null;
  return { run, progress, start, stop, dismiss };
}
