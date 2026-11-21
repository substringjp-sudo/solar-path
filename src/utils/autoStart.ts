/**
 * autoStart.ts — 장면의 시각이 오면 **자동으로 찍기**(docs/SANDBOX_MODE_PLAN.md 12.1 · 목업 4 의 "자동 시작 T−06:40"). 순수 함수.
 *
 * 장면 시각이 아직 안 지났을 때만 남은 시간과 "자동 시작" 을 보이고, 지났으면 "지금 시작"만 남깁니다. 앱이 켜져 있는 동안만 기다리므로
 * 남은 시간이 2 시간을 넘으면 자동 시작을 권하지 않습니다(far).
 */
export const AUTO_START_MAX_MS = 2 * 3600_000;

export type AutoStartState =
  | { kind: 'now' }
  | { kind: 'wait'; remainingMs: number; text: string }
  | { kind: 'far' };

const p2 = (n: number) => String(n).padStart(2, '0');

/** 남은 ms → "T−06:40" · 1 시간 이상 "T−1:00:00"(초는 올림). */
export function countdownText(remainingMs: number): string {
  const sec = Math.max(0, Math.ceil(remainingMs / 1000));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h >= 1 ? `T−${h}:${p2(m)}:${p2(s)}` : `T−${p2(m)}:${p2(s)}`;
}

export function autoStartState(sceneMs: number | null | undefined, nowMs: number): AutoStartState {
  if (typeof sceneMs !== 'number' || !Number.isFinite(sceneMs) || !Number.isFinite(nowMs)) return { kind: 'now' };
  const remainingMs = sceneMs - nowMs;
  if (remainingMs <= 0) return { kind: 'now' };
  if (remainingMs > AUTO_START_MAX_MS) return { kind: 'far' };
  return { kind: 'wait', remainingMs, text: countdownText(remainingMs) };
}

/** 예약 시각이 되었는가(예약이 없거나 숫자가 아니면 거짓). */
export function autoStartDue(atMs: number | null | undefined, nowMs: number): boolean {
  return typeof atMs === 'number' && Number.isFinite(atMs) && Number.isFinite(nowMs) && atMs <= nowMs;
}
