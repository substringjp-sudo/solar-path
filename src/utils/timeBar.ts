/**
 * timeBar.ts
 *
 * 하단 날짜·시간 막대의 **순수 논리** — 화면·RN 과 떨어져 있어 가짜 시계로 판정합니다
 * (tools/shader-preview/verify-time-bar.js).
 *
 * 세 가지를 맡습니다.
 *
 * 1. **정확도 구간.** 고른 시각이 "지금"에서 얼마나 떨어져 있는가(리드타임)로 날씨가 얼마나 믿을 만한지 가릅니다.
 *    막대 위에 띠로 그려 어느 시각이 믿을 만한지 한눈에 보이게 합니다.
 * 2. **데이터 기간.** 날씨를 받을 수 있는 끝 — 과거는 Open-Meteo 재분석(1940~), 앞날은 예보 16일까지.
 *    그 밖은 해·달·별의 위치(천문 계산)만 맞고 구름은 없습니다.
 * 3. **날짜·시간 산술.** ±1일 · ±1시간 · ±1년(윤일 보정)과 손가락 이동의 커밋 간격 조절.
 *
 * ## ⚠ 정확도 구간은 "전형적인 수치예보의 리드타임별 쓸모" 이지 이 앱에서 잰 값이 아닙니다
 *
 * 경계(3일 · 7일 · 16일)는 중기 예보가 보통 그만큼 믿을 만하다는 일반적 기준입니다. 이 앱의 운량 오차를
 * 리드타임별로 재서 정한 것이 아닙니다(§56 은 한 달·10지역의 위성 일사에 대고 모델 조합만 골랐습니다).
 * 그래서 막대의 띠는 "정확도 등급" 이 아니라 **"리드타임 등급"** 으로 이름 붙입니다. 재서 바꾸려면
 * `TIER_LEAD_HOURS` 한 곳만 고치면 막대·판정이 같이 따라옵니다.
 *
 * 시각은 모두 **UTC 밀리초**(instant)입니다. 지역 시각이 필요한 곳은 `tzHours`(관측지 법정 오프셋, 고정값 —
 * 앱이 이미 그렇게 씁니다. 먼 과거·미래의 서머타임 변화는 반영하지 않습니다)를 받습니다.
 */

export const MS_MIN = 60_000;
export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;

/** Open-Meteo 아카이브(ERA5 재분석)가 시작하는 때. 이전은 날씨가 없습니다. */
export const DATA_START_MS = Date.UTC(1940, 0, 1);
/** 막대가 다루는 마지막 시각(천문 계산은 그 뒤도 되지만 슬라이더는 여기서 멈춥니다). */
export const MAX_MS = Date.UTC(2100, 11, 31, 23, 59);
/** 예보 API 가 주는 앞날(일). 그 뒤는 날씨가 없습니다. */
export const FORECAST_DAYS = 16;

/**
 * 리드타임 등급.
 *  - `past`   지난 시각 — 최근은 모델 분석, 오래된 것은 재분석(관측을 녹여 넣은 값)
 *  - `high`   앞 3일(72시간) 안
 *  - `medium` 3~7일
 *  - `low`    7~16일 — 모델 간 차이가 커서 "그럴 수도 있는" 수준
 *  - `none`   16일 너머 · 1940년 이전 — 날씨 자료 없음(천문 계산만)
 */
export type AccuracyTier = 'past' | 'high' | 'medium' | 'low' | 'none';
export const TIER_ORDER: AccuracyTier[] = ['past', 'high', 'medium', 'low', 'none'];

/** 등급 경계(지금으로부터 시간). 이것만 고치면 막대·판정이 같이 바뀝니다. */
export const TIER_LEAD_HOURS = { high: 72, medium: 168, low: FORECAST_DAYS * 24 } as const;

/** 그 시각의 등급. */
export function tierAt(tMs: number, nowMs: number): AccuracyTier {
  if (tMs < DATA_START_MS) return 'none';
  const lead = (tMs - nowMs) / MS_HOUR;
  if (lead < 0) return 'past';
  if (lead < TIER_LEAD_HOURS.high) return 'high';
  if (lead < TIER_LEAD_HOURS.medium) return 'medium';
  if (lead < TIER_LEAD_HOURS.low) return 'low';
  return 'none';
}

/** 날씨 자료를 받을 수 있는 기간 — 막대 끝에 적는 값. */
export function dataWindow(nowMs: number): { fromMs: number; toMs: number } {
  return { fromMs: DATA_START_MS, toMs: nowMs + TIER_LEAD_HOURS.low * MS_HOUR };
}

/** 등급이 바뀌는 시각들(지금 · +72h · +7d · +16d · 1940). */
function tierCuts(nowMs: number): number[] {
  return [
    DATA_START_MS,
    nowMs,
    nowMs + TIER_LEAD_HOURS.high * MS_HOUR,
    nowMs + TIER_LEAD_HOURS.medium * MS_HOUR,
    nowMs + TIER_LEAD_HOURS.low * MS_HOUR,
  ];
}

export interface TierSegment { from: number; to: number; tier: AccuracyTier }

/**
 * [startMs, endMs] 위의 등급 띠를 냅니다(위치는 `toPct` 가 0~100 으로). 경계는 표본이 아니라 **정확한 위치**에서 끊고,
 * 이웃한 같은 등급은 합칩니다. `toPct` 로 시각 → 막대 위치를 바꿉니다(예: 해 슬라이더는 날짜 정오 기준).
 */
export function tierSegmentsBetween(
  startMs: number,
  endMs: number,
  nowMs: number,
  toPct: (tMs: number) => number,
): TierSegment[] {
  const lo = Math.min(startMs, endMs), hi = Math.max(startMs, endMs);
  const cuts = tierCuts(nowMs).filter(c => c > lo && c < hi).sort((a, b) => a - b);
  const edges = [lo, ...cuts, hi];
  const out: TierSegment[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i], b = edges[i + 1];
    if (b <= a) continue;
    const tier = tierAt((a + b) / 2, nowMs);
    const seg = { from: toPct(a), to: toPct(b), tier };
    const prev = out[out.length - 1];
    if (prev && prev.tier === tier) prev.to = seg.to; else out.push(seg);
  }
  if (out.length) { out[0].from = 0; out[out.length - 1].to = 100; }
  return out;
}

/** 하루(지역 자정부터 24시간) 시간 슬라이더의 등급 띠. `dayStartMs` 는 그 지역 자정의 UTC 순간. */
export function dayTierSegments(dayStartMs: number, nowMs: number): TierSegment[] {
  return tierSegmentsBetween(
    dayStartMs, dayStartMs + MS_DAY, nowMs,
    t => ((t - dayStartMs) / MS_DAY) * 100,
  );
}

export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInYear = (y: number) => (isLeapYear(y) ? 366 : 365);
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** 그 해 1월 1일 지역 정오의 UTC 순간 — 날짜 슬라이더의 0%. */
export const yearNoon0Ms = (year: number, tzHours: number) => Date.UTC(year, 0, 1, 12) - tzHours * MS_HOUR;

/** 시각 → 그 해 날짜 슬라이더 위치(0~100). `dateSlider.dateToDatePercent` 와 같은 사상(하루 한 칸, 정오 기준). */
export function yearPct(tMs: number, year: number, tzHours: number): number {
  return ((tMs - yearNoon0Ms(year, tzHours)) / (MS_DAY * (daysInYear(year) - 1))) * 100;
}

/**
 * 날짜 슬라이더 손잡이 위치 — **하루 한 칸**(시각과 무관). `dateSlider.dateToDatePercent` 와 같은 값이라
 * 시간 슬라이더로 시각을 옮겨도 날짜 손잡이가 꿈틀대지 않습니다.
 */
export function dayIndexPct(tMs: number, tzHours: number): number {
  const l = new Date(tMs + tzHours * MS_HOUR);
  const y = l.getUTCFullYear();
  const idx = Math.floor((Date.UTC(y, l.getUTCMonth(), l.getUTCDate()) - Date.UTC(y, 0, 1)) / MS_DAY);
  return (idx / (daysInYear(y) - 1)) * 100;
}

/** 날짜 슬라이더(1년 = 0~100) 위의 등급 띠. */
export function yearTierSegments(year: number, tzHours: number, nowMs: number): TierSegment[] {
  const n0 = yearNoon0Ms(year, tzHours);
  const span = MS_DAY * (daysInYear(year) - 1);
  return tierSegmentsBetween(
    n0, n0 + span, nowMs,
    t => ((t - n0) / span) * 100,
  );
}

/** "지금" 의 막대 위치(범위 밖이면 null). */
export function nowPctInYear(nowMs: number, year: number, tzHours: number): number | null {
  const p = yearPct(nowMs, year, tzHours);
  return p >= 0 && p <= 100 ? p : null;
}
export function nowPctInDay(nowMs: number, dayStartMs: number): number | null {
  const p = ((nowMs - dayStartMs) / MS_DAY) * 100;
  return p >= 0 && p <= 100 ? p : null;
}

// ── 날짜·시간 산술 ───────────────────────────────────────────────────────────

export const clampMs = (tMs: number) => Math.max(DATA_START_MS, Math.min(MAX_MS, tMs));

/** 같은 지역 시각으로 n일 앞뒤(고정 오프셋이라 24시간 × n). */
export const shiftDays = (tMs: number, n: number) => clampMs(tMs + n * MS_DAY);

/** n시간 앞뒤. 자정을 넘으면 날짜도 따라갑니다. */
export const shiftHours = (tMs: number, n: number) => clampMs(tMs + n * MS_HOUR);

/** n년 앞뒤 — 월·일·시각은 지역 기준으로 그대로, 2/29 는 평년에서 2/28 로. */
export function shiftYears(tMs: number, tzHours: number, n: number): number {
  const l = new Date(tMs + tzHours * MS_HOUR);
  const y = l.getUTCFullYear() + n, m = l.getUTCMonth();
  const d = Math.min(l.getUTCDate(), daysInMonth(y, m));
  const t = Date.UTC(y, m, d, l.getUTCHours(), l.getUTCMinutes(), l.getUTCSeconds(), l.getUTCMilliseconds()) - tzHours * MS_HOUR;
  return clampMs(t);
}

/** 지역 날짜(년·월·일)는 그대로 두고 시각만 `minutesOfDay`(0~1439) 로. */
export function withLocalMinutes(tMs: number, tzHours: number, minutesOfDay: number): number {
  const l = new Date(tMs + tzHours * MS_HOUR);
  const m = Math.max(0, Math.min(1439, Math.round(minutesOfDay)));
  return Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate(), 0, m, 0, 0) - tzHours * MS_HOUR;
}

/** 지역 날짜는 그대로 두고 `dayIndex` 번째 날(0 = 1월 1일)로, 시각은 유지. */
export function withLocalDayOfYear(tMs: number, tzHours: number, year: number, dayIndex: number): number {
  const l = new Date(tMs + tzHours * MS_HOUR);
  const di = Math.max(0, Math.min(daysInYear(year) - 1, Math.round(dayIndex)));
  const t = Date.UTC(year, 0, 1 + di, l.getUTCHours(), l.getUTCMinutes(), 0, 0) - tzHours * MS_HOUR;
  return clampMs(t);
}

/** 그 지역 날짜의 자정(UTC 순간). */
export function localDayStartMs(tMs: number, tzHours: number): number {
  const l = new Date(tMs + tzHours * MS_HOUR);
  return Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) - tzHours * MS_HOUR;
}

/** 지역 "yyyy-mm-dd" 키 — 하루 단위로 바뀌는 계산(일출·월출 등)을 한 번만 하게 합니다. */
export function localDayKey(tMs: number, tzHours: number): string {
  const l = new Date(tMs + tzHours * MS_HOUR);
  return `${l.getUTCFullYear()}-${String(l.getUTCMonth() + 1).padStart(2, '0')}-${String(l.getUTCDate()).padStart(2, '0')}`;
}

// ── 하루 막대의 낮·노을·밤 ────────────────────────────────────────────────────

/** 시간 슬라이더 바탕 색의 뜻. `golden` 은 일출 −60 ~ +90분, 일몰 −90 ~ +60분(예전 슬라이더와 같은 창). */
export type DayPhase = 'night' | 'golden' | 'day';
export interface PhaseSegment { from: number; to: number; phase: DayPhase }

/** 하루의 분(0~1440)이 어느 때인가. 일출·일몰이 없는 날(극지)은 06:00 · 18:30 로 둡니다(예전 슬라이더와 같음). */
export function phaseAtMinute(m: number, sunriseMin: number | null, sunsetMin: number | null): DayPhase {
  const sr = sunriseMin ?? 360, ss = sunsetMin ?? 1110;
  if ((m >= sr - 60 && m <= sr + 90) || (m >= ss - 90 && m <= ss + 60)) return 'golden';
  return m >= sr && m < ss ? 'day' : 'night';
}

/** 0~1440 분 위의 낮·노을·밤 구간(이웃한 같은 것은 합침). 막대는 이것을 정적인 띠로 그립니다(손가락을 따라 색을 보간하지 않습니다). */
export function dayPhaseSegments(sunriseMin: number | null, sunsetMin: number | null): PhaseSegment[] {
  const sr = sunriseMin ?? 360, ss = sunsetMin ?? 1110;
  const pts = [0, 1440, sr - 60, sr, sr + 90, ss - 90, ss, ss + 60]
    .map(v => Math.max(0, Math.min(1440, v)))
    .sort((a, b) => a - b)
    .filter((v, i, a) => i === 0 || v > a[i - 1]);
  const out: PhaseSegment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const phase = phaseAtMinute((pts[i] + pts[i + 1]) / 2, sunriseMin, sunsetMin);
    const prev = out[out.length - 1];
    if (prev && prev.phase === phase) prev.to = pts[i + 1]; else out.push({ from: pts[i], to: pts[i + 1], phase });
  }
  return out;
}

/** 그 순간(UTC ms)이 `dayStartMs` 로 시작하는 하루 안에 있으면 그날의 분(0~1440), 아니면 null — 일출·월출 표시용. */
export function minuteInDay(tMs: number | null | undefined, dayStartMs: number): number | null {
  if (tMs == null || !Number.isFinite(tMs)) return null;
  const m = (tMs - dayStartMs) / MS_MIN;
  return m >= 0 && m < 1440 ? m : null;
}

// ── 손가락 이동의 커밋 간격 ──────────────────────────────────────────────────

export interface ThrottleEnv {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: any) => void;
}
const REAL_ENV: ThrottleEnv = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

/**
 * 손가락이 움직일 때마다 앱 전체 상태(시각)를 바꾸면 매번 하늘 화면 전체가 다시 계산됩니다. 첫 값은 **바로**,
 * 이어지는 값은 `intervalMs` 에 한 번(마지막 값)만 내보내고, `flush()` 는 남은 값을 **즉시** 내보냅니다(손을 뗄 때).
 */
export function createCommitThrottle<T>(commit: (v: T) => void, intervalMs: number, env: ThrottleEnv = REAL_ENV) {
  let last = -Infinity;
  let pending: { v: T } | null = null;
  let timer: unknown = null;
  const fire = (v: T) => { last = env.now(); commit(v); };
  return {
    push(v: T) {
      const t = env.now();
      if (timer === null && t - last >= intervalMs) { pending = null; fire(v); return; }
      pending = { v };
      if (timer === null) {
        timer = env.setTimeout(() => {
          timer = null;
          if (pending) { const p = pending; pending = null; fire(p.v); }
        }, Math.max(0, intervalMs - (t - last)));
      }
    },
    flush() {
      if (timer !== null) { env.clearTimeout(timer); timer = null; }
      if (pending) { const p = pending; pending = null; fire(p.v); }
    },
    cancel() {
      if (timer !== null) { env.clearTimeout(timer); timer = null; }
      pending = null;
    },
  };
}
