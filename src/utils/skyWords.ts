/**
 * skyWords.ts — 01 하늘의 **쉬운 말**(docs/SANDBOX_MODE_PLAN.md 2.4, 목업 1번): 구름 한 줄과 해 방향.
 *
 *  - 구름 한 줄: "낮은 구름 조금 · 높은 구름 많음". 층별 운량 %(숫자)를 말로 바꿉니다. 10 % 미만인 층은 말하지 않고, 전부 10 % 미만이면 "구름이 거의 없어요".
 *    값이 없는 층은 건너뜁니다(없는 값을 맑다고 지어내지 않음). 층 값이 하나도 없으면 null.
 *  - 해 방향: 해가 뜨고 지는 방위(북 0 · 동 90 …)를 여덟 방위 말로 — "서쪽 하늘". "어디를 보면 되나" 에 답합니다.
 *
 * 문턱(운량 %): 10 미만 거의 없음 · 35 미만 조금 · 65 미만 보통 · 90 미만 많음 · 그 이상 가득.
 */

type Lang = 'ko' | 'en' | 'ja';

export type CoverLevel = 'none' | 'few' | 'some' | 'many' | 'full';
export const COVER_LEVEL_EDGES = [10, 35, 65, 90] as const;
export const coverLevel = (pct: number): CoverLevel => (pct < 10 ? 'none' : pct < 35 ? 'few' : pct < 65 ? 'some' : pct < 90 ? 'many' : 'full');

export interface CloudLayers { low?: number | null; mid?: number | null; high?: number | null }

const LAYERS = ['low', 'mid', 'high'] as const;
const LAYER_NAME: Record<Lang, Record<(typeof LAYERS)[number], string>> = {
  ko: { low: '낮은 구름', mid: '중간 구름', high: '높은 구름' },
  en: { low: 'low clouds', mid: 'mid-level clouds', high: 'high clouds' },
  ja: { low: '低い雲', mid: '中くらいの雲', high: '高い雲' },
};
const LEVEL_WORD: Record<Lang, Record<Exclude<CoverLevel, 'none'>, string>> = {
  ko: { few: '조금', some: '보통', many: '많음', full: '가득' },
  en: { few: 'Few', some: 'Some', many: 'Many', full: 'Thick' },
  ja: { few: '少し', some: 'ふつう', many: '多い', full: 'びっしり' },
};
const CLEAR: Record<Lang, string> = { ko: '구름이 거의 없어요', en: 'Almost no clouds', ja: '雲はほとんどありません' };

const finite = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

/** 층별 운량 → 한 줄. 값이 있는 층이 하나도 없으면 null. */
export function cloudSummary(c: CloudLayers | null | undefined, language: Lang): string | null {
  if (!c) return null;
  const known = LAYERS.filter(k => finite(c[k]));
  if (!known.length) return null;
  const parts: string[] = [];
  for (const k of known) {
    const lvl = coverLevel(c[k] as number);
    if (lvl === 'none') continue;
    const word = LEVEL_WORD[language][lvl], name = LAYER_NAME[language][k];
    parts.push(language === 'en' ? `${word} ${name}` : `${name} ${word}`);
  }
  return parts.length ? parts.join(' · ') : CLEAR[language];
}

const WINDS: Record<Lang, readonly string[]> = {
  ko: ['북쪽', '북동쪽', '동쪽', '남동쪽', '남쪽', '남서쪽', '서쪽', '북서쪽'],
  en: ['northern', 'north-eastern', 'eastern', 'south-eastern', 'southern', 'south-western', 'western', 'north-western'],
  ja: ['北', '北東', '東', '南東', '南', '南西', '西', '北西'],
};

/** 방위(°, 북 0 · 동 90)가 든 여덟 방위의 번호(0 북 · 1 북동 … 7 북서). 경계(22.5° …)는 시계 방향 쪽. */
export const compassIndex = (azDeg: number): number => Math.round((((azDeg % 360) + 360) % 360) / 45) % 8;

/** "서쪽 하늘" · "western sky" · "西の空". 방위가 숫자가 아니면 null. */
export function skyDirection(azDeg: number, language: Lang): string | null {
  if (!Number.isFinite(azDeg)) return null;
  const w = WINDS[language][compassIndex(azDeg)];
  return language === 'ko' ? `${w} 하늘` : language === 'en' ? `${w} sky` : `${w}の空`;
}
