/**
 * scoreWaterfall.ts — 노을 점수와 별 한계등급을 **"앞 단계가 남긴 값에서 다음 단계가 얼마를 깎았나"** 순서의 막대 한 줄씩으로 풀어 냅니다.
 *
 * 노을 점수 = 38·해높이창·길투과율·날씨^0.85 (맑은 하늘 몫) + 62·붉게 물든 구름·날씨^0.55 (구름 몫) (`sunsetPhysics.ts`).
 * 두 몫이 100 점 만점에서 시작해 네 단계로 깎이는 것으로 읽습니다.
 *   1. window  해 높이: 노을 창(지평선 근처) 밖이면 맑은 하늘 몫(38)이 줄어든다.
 *   2. paint   구름이 붉게 물든 정도: 구름 몫(62)이 줄어든다. 이 값은 해 쪽 길 투과율을 이미 포함한다.
 *   3. path    해 쪽 길 투과율: 맑은 하늘 몫(해높이 반영 뒤)이 줄어든다.
 *   4. weather 날씨(흐림 · 습한 공기 · 강수): 남은 두 몫이 각자의 지수로 줄어든다.
 * 단계마다의 delta 는 항상 0 이하이고, 마지막 after 는 baseSkyGlow + cloudRedScore(반올림 전)와 같습니다.
 * 목업의 "+18 −12 …" 같은 더하기 줄은 없습니다 — 실제 점수는 깎이기만 합니다.
 *
 * 별 한계등급은 시작 등급(`startMag`)에서 박명 · 달빛 · 빛 공해 · 연무가 줄인 값(`starVisibility.ts` 의 단계별 deltaMag)을 그대로 이어 붙입니다.
 *
 * 순수 함수입니다 — 화면(`components/LearnScreen/WaterfallBars`)이 그립니다. 판정: `tools/shader-preview/verify-score-waterfall.js`.
 */
import type { SunsetScoreBreakdown } from './sunsetPhysics';
import type { StarResult } from './starVisibility';

type Lang = 'ko' | 'en' | 'ja';
const L3 = (lang: Lang, ko: string, en: string, ja: string) => (lang === 'ko' ? ko : lang === 'ja' ? ja : en);

export interface WaterfallRow {
  id: string;
  label: string;
  /** 한 줄 이유 */
  note: string;
  /** 이 단계가 줄인 양(0 이하) */
  delta: number;
  /** 이 단계가 끝난 뒤 남은 값 */
  after: number;
}

export interface Waterfall {
  unit: 'pts' | 'mag';
  start: number;
  startLabel: string;
  startNote: string;
  rows: WaterfallRow[];
  end: number;
  endLabel: string;
  endNote: string;
  /** 막대 칸의 끝 값(노을 100 · 별 7) */
  scaleMax: number;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

export function sunsetWaterfall(b: SunsetScoreBreakdown | null | undefined, lang: Lang): Waterfall | null {
  if (!b) return null;
  const wA = Math.pow(b.weatherClear, 0.85), wC = Math.pow(b.weatherClear, 0.55);
  let base = 38, cloud = 62;
  const raw: Array<{ id: string; label: string; note: string; delta: number }> = [];
  const step = (id: string, label: string, note: string, nb: number, nc: number) => {
    raw.push({ id, label, note, delta: nb + nc - base - cloud });
    base = nb; cloud = nc;
  };
  const alt = b.sunAltDeg.toFixed(0);
  step('window', L3(lang, '해 높이', 'Sun height', '太陽の高さ'),
    b.sunWindow >= 0.99 ? L3(lang, `해 ${alt}°, 노을이 생기는 높이`, `Sun at ${alt}°, within the glow height`, `太陽${alt}°、夕焼けの高さ`)
      : L3(lang, `해 ${alt}°, 노을 높이에서 벗어남 (${pct(b.sunWindow)})`, `Sun at ${alt}°, off the glow height (${pct(b.sunWindow)})`, `太陽${alt}°、夕焼けの高さを外れています(${pct(b.sunWindow)})`),
    38 * b.sunWindow, 62);
  step('paint', L3(lang, '붉게 물드는 구름', 'Clouds painted red', '赤く染まる雲'),
    L3(lang, `구름이 붉게 칠해지는 정도 ${pct(b.paintedCloud)}`, `Clouds painted red: ${pct(b.paintedCloud)}`, `雲が赤く染まる度合い ${pct(b.paintedCloud)}`),
    base, 62 * b.paintedCloud);
  step('path', L3(lang, '해 쪽 빛의 길', 'Light path toward the sun', '太陽方向の光の道'),
    L3(lang, `해 쪽 구름을 지나 ${pct(b.pathClarity)} 도착`, `${pct(b.pathClarity)} of the light gets through`, `太陽方向の雲を抜けて${pct(b.pathClarity)}届く`),
    base * b.pathClarity, cloud);
  step('weather', L3(lang, '날씨', 'Weather', '天気'),
    L3(lang, `흐림 · 습기 · 비를 뺀 맑음 ${pct(b.weatherClear)}`, `Clearness after cloud, moisture and rain: ${pct(b.weatherClear)}`, `曇り・湿気・雨を除いた晴れ ${pct(b.weatherClear)}`),
    base * wA, cloud * wC);
  let run = 100;
  const rows: WaterfallRow[] = raw.map(r => { run += r.delta; return { ...r, after: run }; });
  return {
    unit: 'pts', start: 100,
    startLabel: L3(lang, '만점', 'Full marks', '満点'),
    startNote: L3(lang, '구름도 해도 완벽한 노을', 'A perfect glow', '完璧な夕焼け'),
    rows, end: base + cloud,
    endLabel: L3(lang, '노을 점수', 'Glow score', '夕焼けスコア'),
    endNote: L3(lang, '맑은 하늘 노을 + 붉게 물든 구름', 'Clear-sky glow + red clouds', '晴天の空の色+赤く染まる雲'),
    scaleMax: 100,
  };
}

const fmtMag = (d: number) => `${d <= -0.05 ? '−' : ''}${Math.abs(d).toFixed(1)}`;

export function starWaterfall(r: StarResult, lang: Lang): Waterfall {
  const rows: WaterfallRow[] = [];
  let run = r.startMag;
  const add = (id: string, label: string, note: string, delta: number) => { run += delta; rows.push({ id, label, note, delta, after: run }); };
  if (r.twilight) {
    add('twilight', L3(lang, '박명', 'Twilight', '薄明'),
      L3(lang, `해 ${r.twilight.sunAltDeg.toFixed(0)}°, 하늘이 아직 밝음`, `Sun at ${r.twilight.sunAltDeg.toFixed(0)}°, the sky is still bright`, `太陽${r.twilight.sunAltDeg.toFixed(0)}°、空がまだ明るい`), r.twilight.deltaMag);
  }
  add('moon', L3(lang, '달빛', 'Moonlight', '月明かり'),
    r.moon.up ? L3(lang, `달 ${Math.round(r.moon.illum * 100)} %, 고도 ${r.moon.altDeg.toFixed(0)}°`, `Moon ${Math.round(r.moon.illum * 100)}%, altitude ${r.moon.altDeg.toFixed(0)}°`, `月${Math.round(r.moon.illum * 100)} %、高度${r.moon.altDeg.toFixed(0)}°`)
      : L3(lang, '달이 지평선 아래', 'The moon is below the horizon', '月は地平線の下'), r.moon.deltaMag);
  add('light', L3(lang, '빛 공해', 'Light pollution', '光害'),
    r.light.baseMag == null ? L3(lang, '밤 불빛 지도를 못 읽음', 'Night-light map unavailable', '夜間光の地図なし')
      : L3(lang, `도시 불빛 지도 기준 한계 ${r.light.baseMag.toFixed(1)}`, `Limit by the light map: ${r.light.baseMag.toFixed(1)}`, `光地図での限界 ${r.light.baseMag.toFixed(1)}`), r.light.deltaMag);
  add('haze', L3(lang, '습도 · 연무', 'Humidity · haze', '湿度・かすみ'),
    r.haze.aodSource === 'none' ? L3(lang, '연무 자료 없음, 맑은 대기로 계산', 'No haze data; air counted as clear', 'かすみのデータなし、澄んだ大気として計算')
      : L3(lang, `에어로졸 AOD ${(r.haze.aod ?? 0).toFixed(2)}`, `Aerosol AOD ${(r.haze.aod ?? 0).toFixed(2)}`, `エアロゾル AOD ${(r.haze.aod ?? 0).toFixed(2)}`), r.haze.deltaMag);
  return {
    unit: 'mag', start: r.startMag,
    startLabel: L3(lang, '기본', 'Base', '基本'),
    startNote: L3(lang, '맑고 깜깜한 곳에서 맨눈 한계', 'Naked-eye limit under a clear, dark sky', '澄んだ暗い場所での肉眼の限界'),
    rows, end: r.limitMag,
    endLabel: L3(lang, '한계등급', 'Limiting magnitude', '限界等級'),
    endNote: L3(lang, `구름은 등급을 바꾸지 않고 가리는 하늘의 비율만 줄여요(${Math.round(r.cloud.pct)} %)`, `Clouds do not change the limit, they only hide part of the sky (${Math.round(r.cloud.pct)}%)`, `雲は等級を変えず、空を隠す割合だけを減らします(${Math.round(r.cloud.pct)} %)`),
    scaleMax: 7,
  };
}

export { fmtMag as formatWaterfallMag };
