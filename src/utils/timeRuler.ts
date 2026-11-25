/**
 * timeRuler.ts — 시간 자(눈금자를 끌어 시각을 바꾸는 줄)의 순수 계산(목업 "4차 b", 2026-11-21).
 *
 * 가운데 파란 핀은 고정이고 눈금이 손가락을 따라 움직입니다. 한 시간 72 px(15분 18 px)로 15분마다 눈금, 30분은 조금 길게, 정시는 더 길고 글자가 붙습니다.
 * 시각은 ms(UTC), 현지 시각은 시간대(시간 단위 오프셋)로만 봅니다.
 *
 * 판정: `tools/shader-preview/verify-time-ruler.js`
 */
type Lang = 'ko' | 'en' | 'ja';

export const PX_PER_HOUR = 72;
export const RULER_WIDTH = 390;
/** 화면 밖으로 이만큼(px)까지 눈금을 더 그립니다. */
export const RULER_PAD_PX = 18;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const DAY_MS = 24 * HOUR_MS;

export type TickKind = 'hour' | 'half' | 'quarter';
export interface RulerTick { x: number; ms: number; kind: TickKind; label?: string }

const pad2 = (n: number): string => String(n).padStart(2, '0');
const localDate = (ms: number, tz: number): Date => new Date(ms + tz * HOUR_MS);

export function timeText(ms: number, tz: number, withSeconds: boolean = false): string {
  const d = localDate(ms, tz);
  const hhmm = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  return withSeconds ? `${hhmm}:${pad2(d.getUTCSeconds())}` : hhmm;
}

/** 가운데 시각을 기준으로 화면에 보일 눈금들(x 오름차순). */
export function rulerTicks(centerMs: number, tz: number, width: number = RULER_WIDTH, pxPerHour: number = PX_PER_HOUR): RulerTick[] {
  const out: RulerTick[] = [];
  if (![centerMs, tz, width, pxPerHour].every(Number.isFinite) || pxPerHour <= 0) return out;
  const pxPerMs = pxPerHour / HOUR_MS;
  const lo = centerMs + (-RULER_PAD_PX - width / 2) / pxPerMs;
  const hi = centerMs + (width + RULER_PAD_PX - width / 2) / pxPerMs;
  // 현지 15분 경계. 현지 오프셋이 분 단위라 에포크 15분 경계에 시간대 분(0 · 30 · 45)을 더해 맞춥니다.
  const off = tz * HOUR_MS;
  const step = 15 * MIN_MS;
  let t = Math.ceil((lo + off) / step) * step - off;
  for (; t <= hi; t += step) {
    const x = width / 2 + (t - centerMs) * pxPerMs;
    if (x < -RULER_PAD_PX || x > width + RULER_PAD_PX) continue;
    const d = localDate(t, tz);
    const m = d.getUTCMinutes();
    if (m === 0) out.push({ x, ms: t, kind: 'hour', label: `${pad2(d.getUTCHours())}:00` });
    else out.push({ x, ms: t, kind: m === 30 ? 'half' : 'quarter' });
  }
  return out;
}

/** 손가락이 오른쪽(+)으로 가면 눈금이 따라 오므로 시각은 이전으로. snapMin 분 단위로 가장 가까운 분에 맞춥니다. */
export function dragTimeMs(startMs: number, dx: number, opt: { pxPerHour?: number; snapMin?: number } = {}): number {
  const pxPerHour = opt.pxPerHour ?? PX_PER_HOUR;
  const snapMin = opt.snapMin ?? 1;
  if (!Number.isFinite(startMs) || !Number.isFinite(dx) || !(pxPerHour > 0) || !(snapMin > 0)) return startMs;
  const raw = startMs - (dx / pxPerHour) * HOUR_MS;
  const unit = snapMin * MIN_MS;
  return Math.round(raw / unit) * unit;
}

/** 표시(일몰 등)의 x. 0 ~ 폭 밖이면 null. */
export function markerX(centerMs: number, markMs: number, width: number = RULER_WIDTH, pxPerHour: number = PX_PER_HOUR): number | null {
  if (![centerMs, markMs, width, pxPerHour].every(Number.isFinite)) return null;
  const x = width / 2 + ((markMs - centerMs) / HOUR_MS) * pxPerHour;
  return x < 0 || x > width ? null : x;
}

const localDayIndex = (ms: number, tz: number): number => Math.floor((ms + tz * HOUR_MS) / DAY_MS);

/** 현지 날짜 차이(시각 − 지금), 정수. */
export const dayOffset = (ms: number, nowMs: number, tz: number): number => localDayIndex(ms, tz) - localDayIndex(nowMs, tz);

/** 현지 시각은 그대로 n 일 옮김. */
export const shiftDays = (ms: number, n: number): number => ms + n * DAY_MS;

const WEEKDAYS: Record<Lang, readonly string[]> = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ja: ['日', '月', '火', '水', '木', '金', '土'],
};

export function dateLabel(ms: number, nowMs: number, tz: number, lang: Lang): string {
  const off = dayOffset(ms, nowMs, tz);
  if (off === 0) return lang === 'en' ? 'Today' : lang === 'ja' ? '今日' : '오늘';
  if (off === -1) return lang === 'en' ? 'Yesterday' : lang === 'ja' ? '昨日' : '어제';
  if (off === 1) return lang === 'en' ? 'Tomorrow' : lang === 'ja' ? '明日' : '내일';
  return dateShort(ms, tz, lang);
}

/** 오늘 · 어제 · 내일 말고 날짜와 요일 그대로("11.21 토" · "Sat 11/21" · "11/21(土)"). */
export function dateShort(ms: number, tz: number, lang: Lang): string {
  const d = localDate(ms, tz);
  const mo = d.getUTCMonth() + 1, da = d.getUTCDate();
  const wd = WEEKDAYS[lang][d.getUTCDay()];
  if (lang === 'en') return `${wd} ${mo}/${da}`;
  if (lang === 'ja') return `${mo}/${da}(${wd})`;
  return `${mo}.${da} ${wd}`;
}

export interface WeekDay { offset: number; ms: number; day: number; weekday: string; selected: boolean }

/** 지금 기준 −2일 ~ +4일 일곱 칸. 각 칸의 ms 는 고른 시각의 현지 시각을 그대로 두고 날짜만 옮긴 값. */
export function weekStrip(selectedMs: number, nowMs: number, tz: number, lang: Lang): WeekDay[] {
  const selOff = dayOffset(selectedMs, nowMs, tz);
  const base = shiftDays(selectedMs, -selOff);
  return Array.from({ length: 7 }, (_, i) => {
    const offset = i - 2;
    const ms = shiftDays(base, offset);
    const d = localDate(ms, tz);
    return { offset, ms, day: d.getUTCDate(), weekday: WEEKDAYS[lang][d.getUTCDay()], selected: offset === selOff };
  });
}

export interface RulerBandSeg { x0: number; x1: number; alpha: number }
export interface ScoreSample { t: number; score: number | null }

/**
 * 자 위 노을 점수 띠. 이웃한 두 표본이 모두 점수가 있을 때만 그 사이 한 칸(알파 = 평균 점수 / 100)을 만들고, 0 ~ 폭으로 자릅니다.
 * 없는 값(null)은 메우지 않아 띠가 거기서 끊깁니다.
 */
export function rulerBand(samples: readonly ScoreSample[], centerMs: number, width: number = RULER_WIDTH, pxPerHour: number = PX_PER_HOUR): RulerBandSeg[] {
  if (![centerMs, width, pxPerHour].every(Number.isFinite) || pxPerHour <= 0) return [];
  if (samples.length < 2 || samples.some(s => !Number.isFinite(s.t))) return [];
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const xOf = (t: number): number => width / 2 + ((t - centerMs) / HOUR_MS) * pxPerHour;
  const out: RulerBandSeg[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (a.score == null || b.score == null) continue;
    const avg = (a.score + b.score) / 2;
    if (!(avg > 0)) continue;
    const x0 = Math.max(0, xOf(a.t)), x1 = Math.min(width, xOf(b.t));
    if (x1 <= x0) continue;
    out.push({ x0, x1, alpha: Math.min(1, avg / 100) });
  }
  return out;
}

/**
 * 가장자리로 갈수록 작고 투명하게(입체감). d = 가운데에서 떨어진 정도(0 ~ 1)일 때 scale = 1 − 0.45·d, opacity = 1 − 0.8·d².
 * 숫자가 아니면 { 1, 1 }.
 */
export function rulerFade(x: number, width: number = RULER_WIDTH): { scale: number; opacity: number } {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) return { scale: 1, opacity: 1 };
  const d = Math.max(0, Math.min(1, Math.abs(x - width / 2) / (width / 2)));
  return { scale: 1 - 0.45 * d, opacity: 1 - 0.8 * d * d };
}

/** 날짜 단추를 위아래로 밀 때 옮길 날 수. 위로(dy 음수) 다음 날, 아래로 이전 날. 20 px 마다 하루(소수 버림), 최대 7일. */
export function daySwipeSteps(dy: number): number {
  if (!Number.isFinite(dy)) return 0;
  const n = Math.max(-7, Math.min(7, Math.trunc(-dy / 20)));
  return n === 0 ? 0 : n;
}
