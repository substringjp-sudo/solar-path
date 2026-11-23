/**
 * startupTrace.ts — **앱을 켜는 단계별 시간 기록**. 개발 빌드에서만 로그를 냅니다.
 * `mark('이름')` 을 부르면 직전 표시부터의 시간이 그 이름의 구간이 됩니다. 어디가 느린지를 숫자로 보고 고치려는 것입니다(추측 대신 측정).
 */
export interface StartupSpan { label: string; ms: number }

export function createStartupTrace(opts: { now?: () => number; log?: (msg: string) => void; enabled?: boolean } = {}) {
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? ((m: string) => { console.log(m); });
  const enabled = opts.enabled ?? (typeof __DEV__ !== 'undefined' ? __DEV__ : false);
  let t0: number | null = null, last = 0;
  const out: StartupSpan[] = [];
  return {
    mark(label: string): void {
      const t = now();
      if (t0 === null) { t0 = t; last = t; return; }
      const ms = t - last; last = t;
      out.push({ label, ms });
      if (enabled) log(`[Startup] ${label} +${ms}ms (누적 ${t - t0}ms)`);
    },
    spans: (): StartupSpan[] => out.slice(),
    total: (): number => (t0 === null ? 0 : last - t0),
  };
}

export const startupTrace = createStartupTrace();
