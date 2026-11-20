/**
 * loadProgress.ts — **멈춘 뒤 주변(건물)을 받는 동안의 진행 막대**가 쓰는 계산(순수 함수). docs/SANDBOX_MODE_PLAN.md 12.2, 목업 "샌드박스 이동 중"의 "주변 불러오는 중 · 건물 62 %".
 *
 * 장면은 건물을 타일 단위로 받습니다(`buildingTiles.fetchNearbyBuildings` 의 `onProgress`). 몇 장 중 몇 장이 끝났는지를 `LoadProgress` 로 알리면
 * 이 모듈이 막대의 제목 · 옆 글 · 비율을 만듭니다.
 *
 *  - 퍼센트는 **내림**입니다(5/8 → 62). 받는 중에는 99 를 넘기지 않습니다: 타일을 다 받은 뒤에도 기하를 합치는 시간이 남아 있어서,
 *    "끝났다"는 신호는 phase 가 `idle` 로 바뀌는 것뿐입니다.
 *  - 전체 장수를 모르면(예비 경로로 한 번에 받을 때 등) 퍼센트 없이 "주변 불러오는 중"만 보입니다.
 *  - 받지 못해 다시 시도하는 중이면(`retry`) 그 사실을 알립니다. 건물이 안 보이는 이유를 조용히 두지 않기 위해서입니다.
 *
 * 판정: `tools/shader-preview/verify-joystick-driver.js`
 */

export type LoadPhase = 'idle' | 'loading' | 'retry';

export interface LoadProgress {
  phase: LoadPhase;
  /** 끝난 타일 수 */
  done: number;
  /** 받을 타일 수. 모르면 0. */
  total: number;
}

export type LoadLang = 'ko' | 'en' | 'ja';

export interface LoadBar {
  title: string;
  /** 옆 글("건물 62 %"). 퍼센트를 모르면 null. */
  detail: string | null;
  /** 막대를 채울 비율 0~0.99. 모르면 null(막대를 움직이는 줄무늬로 그립니다). */
  fraction: number | null;
  tone: 'loading' | 'retry';
}

const pick = (lang: LoadLang, ko: string, en: string, ja: string): string => (lang === 'en' ? en : lang === 'ja' ? ja : ko);

/** 받는 중일 때의 퍼센트(내림, 0 ~ 99). 받는 중이 아니거나 전체를 모르거나 값이 이상하면 null. */
export function loadPercent(p: LoadProgress | null | undefined): number | null {
  if (!p || p.phase !== 'loading') return null;
  if (!Number.isFinite(p.done) || !Number.isFinite(p.total) || p.total <= 0) return null;
  return Math.min(99, Math.max(0, Math.floor((100 * p.done) / p.total)));
}

/** 막대의 글과 비율. 보일 것이 없으면(idle · null) null. */
export function loadBar(p: LoadProgress | null | undefined, lang: LoadLang): LoadBar | null {
  if (!p || p.phase === 'idle') return null;
  if (p.phase === 'retry') {
    return { title: pick(lang, '건물을 못 받았어요', "Couldn't load buildings", '建物を読めませんでした'), detail: pick(lang, '다시 시도해요', 'Retrying', '再試行します'), fraction: null, tone: 'retry' };
  }
  const pct = loadPercent(p);
  return {
    title: pick(lang, '주변 불러오는 중', 'Loading surroundings', '周囲を読み込み中'),
    detail: pct === null ? null : pick(lang, `건물 ${pct} %`, `Buildings ${pct} %`, `建物 ${pct} %`),
    fraction: pct === null ? null : pct / 100,
    tone: 'loading',
  };
}
