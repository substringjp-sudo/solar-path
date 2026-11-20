/**
 * upcomingMoments.ts — 01 하늘 시트의 **"다가오는 좋은 순간" 카드**(docs/SANDBOX_MODE_PLAN.md 2.4, 목업 1번)를 고르는 규칙.
 *
 * 02 예보와 **같은 판정**(`sunForecast.buildForecastDays`)에서 고릅니다. 새로 세지 않으므로 카드의 판정과 02 예보의 칸이 어긋날 수 없습니다.
 *
 *  - 오늘은 위 판정 카드가 이미 말하므로 **내일과 모레**만 봅니다(목업: "내일 일출 보통", "모레 일몰 좋음").
 *  - 하루에 카드 하나: 그날 일출·일몰 가운데 판정이 더 좋은 쪽. 같으면 점수가 높은 쪽, 그래도 같으면 일몰(많은 사람이 찍는 쪽).
 *  - **보통 이상**만 올립니다. 아쉬움·흐림은 "좋은 순간" 이 아닙니다. 예보가 없는 출몰(판정 null)은 건너뜁니다 — 지어내지 않습니다.
 *  - 3일 안(`high`) 등급만: 먼 날은 점수를 숨기는 규칙(`timeBar`)에 따라 카드로 올리지 않습니다.
 *  - 이미 지난 출몰은 건너뜁니다.
 *
 *
 * **"오늘 밤 별 보기" 카드**(`starMoment`)도 여기서 고릅니다(목업의 첫 카드). 별을 보는 시각의 하늘 전체 운량이 **보통 이하**(50 % 이하)이고 맨눈 한계등급이
 * **3 이상**(밝은 별과 큰 별자리가 보임)일 때만 올립니다. 운량을 모르면 올리지 않습니다 — 별이 보일지 말할 근거가 없습니다. 구름은 `starVisibility.cloudRating`
 * 의 문턱(20 % 좋음 · 50 % 보통)을 그대로 씁니다. 누르면 별 보기 계산 과정(`calcSteps` 의 stars 주제)이 열립니다.
 *
 * 카드를 누르면 02 예보의 그 칸으로 가는 데 쓰는 `ForecastFocus`(날짜 정오 + 일출/일몰)와 그 칸 알아보기(`matchesFocus`)도 여기 둡니다.
 */
import type { EventSide, ForecastDay, ForecastEvent, Quality } from './sunForecast';
import { cloudRating, starLimit, type StarInput } from './starVisibility';

/** 판정 순서(낮음 → 높음). `PredictionCard.VERDICT_ORDER` 와 같아야 하며 `verify-upcoming-moments.js` 가 소스에서 대어 봅니다. */
export const QUALITY_ORDER: readonly Quality[] = ['Overcast', 'Muted', 'Fair', 'Great', 'Epic'];
export const qualityLevel = (q: Quality | null | undefined): number => (q ? QUALITY_ORDER.indexOf(q) + 1 : 0);
/** 카드로 올리는 가장 낮은 판정: 보통 */
export const MIN_CARD_LEVEL = 3;
/** 오늘을 0 으로 셀 때 카드가 보는 마지막 날(모레) */
export const LAST_CARD_DAY = 2;

const MS_DAY = 86_400_000;
const HALF_DAY = 12 * 3_600_000;

export interface UpcomingMoment {
  /** `${날짜 정오 ms}_${side}` */
  id: string;
  /** 관측지 현지 날짜의 정오(ms) — 02 예보 줄의 키와 같음 */
  noonMs: number;
  side: EventSide;
  /** 오늘 0 · 내일 1 · 모레 2 */
  dayOffset: number;
  quality: Quality;
  score: number | null;
  /** 출몰 시각(ms) */
  atMs: number;
  /** 카드에 적는 시각: 가장 붉을 때(없으면 출몰 시각) */
  timeMs: number;
  /** 판정 이유 한 문장(예측의 `description`, 영어 원문). 없으면 null. */
  description: string | null;
}

/** 02 예보로 가서 강조할 칸 */
export interface ForecastFocus {
  noonMs: number;
  side: EventSide;
}

const usable = (e: ForecastEvent | null, nowMs: number): e is ForecastEvent =>
  !!e && e.quality != null && e.tier === 'high' && e.at.getTime() > nowMs && qualityLevel(e.quality) >= MIN_CARD_LEVEL;

/** 앞으로의 카드(날짜 순). `days[0]` 이 오늘이어야 합니다(`buildForecastDays` 의 순서). */
export function upcomingMoments(days: readonly ForecastDay[], nowMs: number, opts: { max?: number } = {}): UpcomingMoment[] {
  const todayNoon = days[0]?.noonMs;
  if (todayNoon == null) return [];
  const out: UpcomingMoment[] = [];
  for (const d of days) {
    const dayOffset = Math.round((d.noonMs - todayNoon) / MS_DAY);
    if (dayOffset < 1 || dayOffset > LAST_CARD_DAY) continue;
    const cands = [d.sunrise, d.sunset].filter((e): e is ForecastEvent => usable(e, nowMs));
    if (!cands.length) continue;
    // 더 좋은 쪽: 판정, 같으면 점수, 그래도 같으면 일몰
    const best = cands.reduce((a, b) => {
      const la = qualityLevel(a.quality), lb = qualityLevel(b.quality);
      if (lb !== la) return lb > la ? b : a;
      const sa = a.score ?? -1, sb = b.score ?? -1;
      if (sb !== sa) return sb > sa ? b : a;
      return b.side === 'sunset' ? b : a;
    });
    out.push({
      id: `${d.noonMs}_${best.side}`,
      noonMs: d.noonMs,
      side: best.side,
      dayOffset,
      quality: best.quality as Quality,
      score: best.score,
      atMs: best.at.getTime(),
      timeMs: (best.peakAt ?? best.at).getTime(),
      description: best.description ?? null,
    });
  }
  return out.slice(0, opts.max ?? 3);
}

/**
 * 별 보기 카드로 올리는 가장 낮은 한계등급(`starVisibility.seeLevel` 의 bright: 밝은 별과 큰 별자리).
 * 앱의 빛 지도가 내는 가장 낮은 값이 정확히 3.0 이라 달 없는 도시 밤의 한계등급이 3.0 에 놓입니다. 부동소수 오차(`STAR_LIMIT_EPS`)로
 * 카드가 나왔다 안 나왔다 하지 않게 이만큼은 봐줍니다.
 */
export const MIN_STAR_LIMIT = 3;
export const STAR_LIMIT_EPS = 1e-6;
/** 별 보는 시각이 지금에서 이 안(ms)이면 "지금부터" 로 적습니다(이미 어두운 밤). */
export const STAR_NOW_MS = 5 * 60_000;

export interface StarMoment {
  /** 별을 보기 시작할 시각(ms) — 그날 천문 박명이 끝난 30분 뒤, 이미 어두우면 지금 */
  timeMs: number;
  /** 그때 맨눈 한계등급 */
  limitMag: number;
  /** 그때 하늘 전체 운량(%) */
  cloudPct: number;
  /** 이미 어두운 밤이라 지금부터 보인다 */
  fromNow: boolean;
}

/** "오늘 밤 별 보기" 카드. 운량이 보통 이하(50 % 이하)이고 한계등급 3 이상일 때만. 운량을 모르면 null. */
export function starMoment(a: { timeMs: number; nowMs: number; input: StarInput; cloudKnown: boolean }): StarMoment | null {
  if (!a.cloudKnown || !Number.isFinite(a.timeMs) || !Number.isFinite(a.input.cloudPct)) return null;
  if (cloudRating(a.input.cloudPct) === 'bad') return null;
  const limitMag = starLimit(a.input).limitMag;
  if (!(limitMag >= MIN_STAR_LIMIT - STAR_LIMIT_EPS)) return null;
  return { timeMs: a.timeMs, limitMag, cloudPct: a.input.cloudPct, fromNow: a.timeMs <= a.nowMs + STAR_NOW_MS };
}

/** 이 날·이 쪽 칸이 강조할 칸인가. 날짜 정오는 계산한 때가 달라도 반나절 안으로 같은 날로 봅니다. */
export const matchesFocus = (d: Pick<ForecastDay, 'noonMs'>, side: EventSide, focus: ForecastFocus | null | undefined): boolean =>
  !!focus && focus.side === side && Math.abs(d.noonMs - focus.noonMs) < HALF_DAY;
