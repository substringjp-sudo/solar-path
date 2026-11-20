/**
 * 학습 페이지(02 학습)의 순수 계산 — 화면에서 떨어뜨려 판정(`tools/shader-preview/verify-learn-sections.js`)이 붙습니다.
 * docs/SANDBOX_MODE_PLAN.md 13 장.
 *
 * 학습 페이지는 한 페이지에 다섯 구역이 이어집니다: 오늘 · 앞으로 16일 · 근거 데이터 · 결과가 나온 과정 · 낮과 밤의 경계.
 * 항목마다 중요한 정보만 먼저 보이고 나머지는 접어 둡니다(사용자 결정 2026-11-20). 무엇을 먼저 보이고 무엇을 접을지,
 * 들어올 때 어느 날을 고를지, 하늘 일정 줄을 누르면 어느 과정 주제를 열지를 여기서 정합니다.
 *
 * ## 고른 날(`LearnPick`)
 *  페이지는 "고른 날" 하나(그 날의 일출 또는 일몰)를 따라갑니다. 들어올 때는 온 곳의 날로 맞춰집니다:
 *   1. 01 하늘의 카드에서 왔으면(`focus`) 그 카드가 가리킨 날 · 쪽
 *   2. 아니면 앞으로 가장 좋은 때(`bestUpcoming`)
 *   3. 그것도 없으면 오늘 — 일몰이 있으면 일몰, 없으면 일출. 오늘이 없으면(받은 날이 없음) null.
 *
 * ## 접는 규칙
 *  - 하늘 일정: 추천 이벤트(`featured`: 일몰·일출 판정, 초승달, 은하수, 행성)는 먼저, 일반(`general`: 해·달 출몰 시각)은 접습니다.
 *    추천이 하나도 없으면 일반을 접지 않고 그대로 보입니다(아무것도 안 보이는 화면을 만들지 않음).
 *  - 16일 표: 3일 안(`high` · `past`)은 먼저, 7일 안(`medium`)과 16일 안(`low` · `none`)은 접습니다. 3일 안이 하나도 없으면 첫 묶음은 보입니다.
 */
import { bestUpcoming, type EventSide, type ForecastDay, type ForecastEvent } from './sunForecast';
import { matchesFocus, type ForecastFocus } from './upcomingMoments';
import type { AccuracyTier } from './timeBar';
import type { StepCard } from './calcSteps';

export type LearnSection = 'today' | 'forecast' | 'data' | 'why' | 'globe';
export const LEARN_SECTIONS: readonly LearnSection[] = ['today', 'forecast', 'data', 'why', 'globe'];

/** 결과가 나온 과정의 주제(`CalcSteps` 의 주제와 같은 이름). */
export type LearnTopic = 'score' | 'sunrise' | 'sunset' | 'stars' | 'cloud';
export const LEARN_TOPICS: readonly LearnTopic[] = ['score', 'sunrise', 'sunset', 'stars', 'cloud'];

/** 고른 날: 관측지 현지 정오(UTC ms)와 그 날의 일출·일몰 중 어느 쪽. */
export interface LearnPick { noonMs: number; side: EventSide }

const HALF_DAY = 12 * 3_600_000;
/** 정오 두 값이 같은 날인가(계산한 때가 달라도 반나절 안이면 같은 날). */
export const sameNoon = (a: number, b: number): boolean => Math.abs(a - b) < HALF_DAY;

/** 들어올 때 고를 날. 우선순위는 머리말 참고. */
export function defaultPick(days: readonly ForecastDay[], now: Date, focus?: ForecastFocus | null): LearnPick | null {
  if (days.length === 0) return null;
  if (focus) {
    const d = days.find(x => matchesFocus(x, focus.side, focus));
    const e = d ? (focus.side === 'sunrise' ? d.sunrise : d.sunset) : null;
    if (d && e) return { noonMs: d.noonMs, side: focus.side };   // 그 날에 그 쪽 사건이 없으면 건너뜀(없는 칸을 고르지 않음)
  }
  const best = bestUpcoming([...days], now);
  if (best) {
    const d = days.find(x => x.sunrise === best || x.sunset === best);
    if (d) return { noonMs: d.noonMs, side: best.side };
  }
  const first = days[0];
  return { noonMs: first.noonMs, side: first.sunset ? 'sunset' : 'sunrise' };
}

/** 고른 날에 해당하는 날과 사건(없으면 null). 사건이 없는 쪽(극지 등)이면 event 가 null 입니다. */
export function pickedEvent(days: readonly ForecastDay[], pick: LearnPick | null): { day: ForecastDay; event: ForecastEvent | null } | null {
  if (!pick) return null;
  const day = days.find(d => sameNoon(d.noonMs, pick.noonMs));
  if (!day) return null;
  return { day, event: pick.side === 'sunrise' ? day.sunrise : day.sunset };
}

/** 하늘 일정 줄(`skyEvents.ts` 의 id)을 누르면 열 과정 주제. */
export function topicForEventId(id: string): LearnTopic {
  switch (id) {
    case 'g_sunrise': return 'sunrise';
    case 'g_sunset': return 'sunset';
    case 'f_crescent':
    case 'f_milkyway':
    case 'f_planets':
    case 'g_moonrise':
    case 'g_moonset': return 'stars';
    default: return 'score';   // f_sunrise · f_sunset(노을 판정)과 모르는 id
  }
}

/** 하늘 일정을 먼저 보일 것과 접을 것으로 나눕니다(순서는 그대로). */
export function splitSkyEvents<T extends { category: 'featured' | 'general' }>(items: readonly T[]): { shown: T[]; folded: T[] } {
  const shown = items.filter(e => e.category === 'featured');
  if (shown.length === 0) return { shown: [...items], folded: [] };
  return { shown, folded: items.filter(e => e.category !== 'featured') };
}

/** 16일 표의 묶음을 먼저 보일 것(3일 안)과 접을 것으로 나눕니다(순서는 그대로). */
export function splitForecastGroups<G extends { tier: AccuracyTier }>(groups: readonly G[]): { shown: G[]; folded: G[] } {
  const isNear = (g: G) => g.tier === 'high' || g.tier === 'past';
  const shown = groups.filter(isNear);
  if (shown.length === 0 && groups.length > 0) return { shown: [groups[0]], folded: groups.slice(1) };
  return { shown, folded: groups.filter(g => !isNear(g)) };
}

/** 과정 항목 하나의 단계 카드 묶음(`buildSunsetScoreCards` 등이 돌려주는 모양 중 머리 줄이 쓰는 부분). */
export interface TopicCards { cards: readonly StepCard[]; footnote: string }

const text = (s: string | null | undefined): string | null => (s && s.trim() ? s : null);

/**
 * 과정 항목의 **머리 줄**: 접어 둔 채로도 보이는 결과 값과 한 줄 이유를 단계 카드에서 고릅니다.
 *  - 값: 노을 점수 · 해 뜨는/지는 시각은 result 모양 카드의 글, 별 보기는 'limit' 카드의 막대 글, 구름 모양은 'genus' 카드의 행 값을 " · " 로 이은 것.
 *  - 한 줄 이유: 결과를 가장 크게 바꾼 단계(key)의 설명. 없으면 별 보기는 'limit' 카드의 설명, 나머지는 맺음말.
 * 값이 없으면 null 입니다(빈 글이나 지어낸 값을 돌려주지 않음).
 */
export function topicHeadline(topic: LearnTopic, r: TopicCards | null): { value: string | null; reason: string | null } {
  if (!r) return { value: null, reason: null };
  const byId = (id: string) => r.cards.find(c => c.id === id);
  let value: string | null = null;
  if (topic === 'stars') value = text(byId('limit')?.bar?.display);
  else if (topic === 'cloud') value = text(byId('genus')?.rows?.map(x => x.value).join(' · '));
  else value = text(r.cards.find(c => c.shape === 'result')?.result);
  const key = r.cards.find(c => c.key && text(c.note));
  const fallback = topic === 'stars' ? text(byId('limit')?.note) ?? text(r.footnote) : text(r.footnote);
  return { value, reason: text(key?.note) ?? fallback };
}
