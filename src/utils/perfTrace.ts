/**
 * perfTrace.ts — __DEV__ 전용 실측 계측 로거.
 *
 * 앱 초기 로딩 · 날짜 변경 · 장소 변경 시:
 *  1) 각 단계의 실제 소요 시간(ms)과 처리량(파일 수, 바이트, 타일 수 등)
 *  2) JS 이벤트 루프 스톨(50ms 타이머가 80ms 이상 밀린 구간)
 * 을 `[PerfTrace]` 접두사로 출력해 병목 원인을 숫자로 특정합니다.
 */

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;

export interface PerfToken {
  tag: string;
  label: string;
  t0: number;
}

export function perfStart(tag: string, label: string): PerfToken | null {
  if (!IS_DEV) return null;
  return { tag, label, t0: Date.now() };
}

export function perfEnd(token: PerfToken | null, detail?: string): number {
  if (!token || !IS_DEV) return 0;
  const ms = Date.now() - token.t0;
  console.log(`[PerfTrace][${token.tag}] ${token.label}: ${ms}ms${detail ? ` (${detail})` : ''}`);
  return ms;
}

export function perfLog(tag: string, label: string, ms: number, detail?: string): void {
  if (!IS_DEV) return;
  console.log(`[PerfTrace][${tag}] ${label}: ${ms}ms${detail ? ` (${detail})` : ''}`);
}

const activeStallWatchers = new Map<string, () => void>();

/**
 * durationMs 동안 50ms 간격 타이머가 얼마나 밀리는지 감시해 JS 스레드 블로킹을 포착합니다.
 * 같은 tag로 다시 호출하면 기존 감시기를 정리하고 새로 시작합니다.
 */
export function watchJsStall(tag: string, durationMs = 6000, thresholdMs = 80): () => void {
  if (!IS_DEV) return () => {};
  activeStallWatchers.get(tag)?.();

  const intervalMs = 50;
  const endAt = Date.now() + durationMs;
  let last = Date.now();
  let maxLag = 0;
  let stallCount = 0;
  let totalLag = 0;
  let stopped = false;

  const timer = setInterval(() => {
    const now = Date.now();
    const lag = now - last - intervalMs;
    last = now;
    if (lag >= thresholdMs) {
      stallCount++;
      totalLag += lag;
      if (lag > maxLag) maxLag = lag;
      console.log(`[PerfTrace][JS-STALL][${tag}] +${lag}ms blocked`);
    }
    if (now >= endAt) stop();
  }, intervalMs);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (activeStallWatchers.get(tag) === stop) activeStallWatchers.delete(tag);
    if (stallCount > 0) {
      console.log(
        `[PerfTrace][JS-STALL][${tag}] summary: ${stallCount} stalls, max=${maxLag}ms, sum=${totalLag}ms`,
      );
    }
  };

  activeStallWatchers.set(tag, stop);
  return stop;
}
