/**
 * 계산 과정 보기의 단계 카드 (2026-11-19, docs/SANDBOX_MODE_PLAN.md 9 장).
 *
 * 용어집이 아니라 **앱이 실제로 하는 계산을 오늘의 숫자 그대로** 보여 줍니다. 결과 하나마다 단계들을 차례로 펼치고, 단계마다
 * 들어온 값 · 한 일 · 나온 값과 "왜 사진에 중요한가" 한 문장만 붙입니다. 값은 늘 지금 보는 위치·날짜의 실제 값입니다.
 *
 * 카드는 여섯 모양 중 하나입니다: 숫자 줄(`rows`), 막대(`bar`), 작은 지도(`map`, 해 쪽 구름), 하늘 그림(`sky`, 스카이라인 윤곽과 해 자리),
 * 결과 줄(`result`), 값 줄(`metric`, 제목 · 한 문장 · 오른쪽 값). 그래프는 다음 주제와 함께 옵니다. 주제는 셋: 해 뜨는·지는 시각과 방향
 * (`buildSunHorizonCards`), 노을 점수(`buildSunsetScoreCards`), 별 보기 조건(`buildStarCards`).
 *
 * 순수 함수입니다 — 화면(`components/CalcSteps`)이 그립니다. 시각 표기는 `fmtTime` 으로 받습니다(화면은 기기 시간대, 판정은 UTC).
 */
import { sunHorizonSteps, SUN_RADIUS_DEG, type SkylineFn } from './terrainSun';
import { skylineDistM, type HorizonProfile, skylineAngleDeg } from './horizon';
import { sunPosition } from './solarPosition';
import { refractionDeg } from './moonPosition';
import type { SunsetScoreBreakdown } from './sunsetPhysics';
import { starLimit, limitWithoutMoon, seeLevel, type StarInput, type StarResult } from './starVisibility';

type Lang = 'ko' | 'en' | 'ja';
const L3 = (lang: Lang, ko: string, en: string, ja: string) => (lang === 'ko' ? ko : lang === 'ja' ? ja : en);
const R2D = 180 / Math.PI;

export interface StepRow { label: string; value: string }

export interface SkyPicture {
  /** 그림 범위: 방위(°)와 고도(°) */
  azRange: [number, number];
  elRange: [number, number];
  /** 스카이라인 윤곽 [방위, 고도] — 방위가 늘어나는 순서 */
  skyline: Array<[number, number]>;
  /** 해 자리: 평평한 수평선 기준 시각의 해 / 실제로 보이기 시작하는(사라지는) 해 */
  suns: Array<{ az: number; el: number; kind: 'flat' | 'visible'; label: string }>;
  /** 그림 위 글: "능선 1.8°, 4.2 km" */
  caption?: string;
  /** 해 원반 반지름(°) */
  sunRadiusDeg: number;
}

/** 막대 한 줄: 0~1 의 값을 채운 칸으로. */
export interface BarPart { value: number; display: string }

/** 작은 지도의 한 칸: 관측점에서 본 방위(북 0 시계)·거리(km)의 구름 */
export interface SkyMapCell { distKm: number; azDeg: number; cover: number; low: number; mid: number; high: number }

/** 해 쪽을 포함한 주변 구름 지도(북쪽이 위). 해 방향 선과 거리 고리를 함께 그립니다. */
export interface SkyMap { maxKm: number; ringsKm: number[]; cells: SkyMapCell[]; sunAzDeg: number }

/** 값 줄(`metric`)의 오른쪽 값 색: 좋음 · 주의 · 나쁨 · 달 · 보통 */
export type MetricTone = 'good' | 'warn' | 'bad' | 'moon' | 'plain';

export interface StepCard {
  id: string;
  title: string;
  shape: 'rows' | 'sky' | 'result' | 'bar' | 'map' | 'metric';
  /** `metric` 의 오른쪽 값 색 */
  tone?: MetricTone;
  rows?: StepRow[];
  bar?: BarPart;
  map?: SkyMap;
  sky?: SkyPicture;
  /** result 모양의 큰 글(예: "07:29 · 117.4°") */
  result?: string;
  /** 단계마다 한 문장: 이 단계가 사진에 왜 중요한가 */
  note: string;
  /** 결과를 가장 크게 바꾼 단계(화면이 테두리로 짚음) */
  key?: boolean;
}

export interface SunHorizonCards {
  title: string;
  cards: StepCard[];
  /** 카드 아래 한 줄: 예보 시각과의 차이와 "실제는 더 복잡함" */
  footnote: string;
  /** 스카이라인(땅 자료)을 쓴 계산인가. false 면 평평한 수평선으로 계산 */
  usedTerrain: boolean;
  /** 평평한 수평선 기준 시각 · 보이기 시작하는 시각(분 차이) — 화면이 따로 쓰는 값 */
  flatMs: number;
  visibleMs: number | null;
  deltaMin: number | null;
}

/** 도 표기. 반올림하면 0 이 되는 음수(−0.0°)는 0.0° 로 적습니다. */
const fmtDeg = (d: number, digits = 1) => `${(Math.abs(d) < 0.5 * 10 ** -digits ? 0 : d).toFixed(digits).replace('-', '−')}°`;
const signed = (d: number, digits = 2) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(digits)}°`;

export interface BuildSunHorizonArgs {
  kind: 'rise' | 'set';
  date: Date;
  lat: number;
  lon: number;
  language: Lang;
  /** 땅 스카이라인(방위 → 앙각). 없으면 평평한 수평선(0°)으로 계산하고 그렇다고 알립니다. */
  skyline?: SkylineFn | null;
  /** 능선까지의 거리(m)를 알려 주는 프로필(있으면 "능선 1.8°, 4.2 km" 를 적음) */
  profile?: HorizonProfile | null;
  fmtTime: (ms: number) => string;
}

/** "해 뜨는 시각과 방향"(일몰이면 "해 지는 시각과 방향") 단계 카드. 극야·백야로 사건이 없으면 null. */
export function buildSunHorizonCards(a: BuildSunHorizonArgs): SunHorizonCards | null {
  const { kind, date, lat, lon, language: L, fmtTime } = a;
  const rise = kind === 'rise';
  const flatSky: SkylineFn = () => 0;
  const usedTerrain = !!a.skyline;
  const st = sunHorizonSteps(kind, date, lat, lon, a.skyline ?? flatSky);
  if (!st) return null;
  const ev = st.event;
  const verb = rise ? L3(L, '보이기 시작', 'First sight', '見え始め') : L3(L, '사라짐', 'Gone', '見えなくなる');
  const title = rise ? L3(L, '해 뜨는 시각과 방향', 'Sunrise time and direction', '日の出の時刻と方向') : L3(L, '해 지는 시각과 방향', 'Sunset time and direction', '日の入りの時刻と方向');

  // 1. 해의 실제 위치
  const geoSun = sunPosition(new Date(st.geoZeroMs), lat, lon);
  const c1: StepCard = {
    id: 'geo',
    title: L3(L, '해의 실제 위치', 'Where the sun really is', '太陽の実際の位置'),
    shape: 'rows',
    rows: [
      { label: L3(L, '방위', 'Azimuth', '方位'), value: fmtDeg(st.geoZeroAzDeg) },
      { label: L3(L, '고도', 'Altitude', '高度'), value: `${fmtDeg(geoSun.altitude * R2D)} ${fmtTime(st.geoZeroMs)}` },
    ],
    note: L3(L, '날짜와 위치로 계산한 기하학적 위치예요.', 'Geometric position from the date and place.', '日付と場所から計算した幾何学的な位置です。'),
  };

  // 2. 대기 굴절
  const earlyMin = Number.isFinite(st.refractionEarlyMin) ? Math.round(st.refractionEarlyMin) : null;
  const c2: StepCard = {
    id: 'refraction',
    title: L3(L, '대기 굴절', 'Atmospheric refraction', '大気の屈折'),
    shape: 'rows',
    rows: [
      { label: L3(L, '떠 보임', 'Lifted', '浮いて見える'), value: signed(st.refractionDeg) },
      ...(earlyMin != null ? [{ label: rise ? L3(L, '일찍', 'Earlier', '早く') : L3(L, '늦게까지', 'Later', '遅くまで'), value: L3(L, `약 ${earlyMin}분`, `~${earlyMin} min`, `約${earlyMin}分`) }] : []),
    ],
    note: rise
      ? L3(L, '공기가 빛을 휘게 해서 해가 실제보다 먼저 보여요.', 'Air bends the light, so the sun shows before it truly rises.', '空気が光を曲げるので、太陽は実際より先に見えます。')
      : L3(L, '공기가 빛을 휘게 해서 해가 실제보다 늦게까지 보여요.', 'Air bends the light, so the sun stays visible longer than it truly does.', '空気が光を曲げるので、太陽は実際より遅くまで見えます。'),
  };

  // 3. 지평선 높이: 하늘 그림
  const evAz = ev.azDeg;
  const azRange: [number, number] = [evAz - 22, evAz + 22];
  // 윤곽은 범위의 양 끝을 포함해 1° 마다(45 점) — 그림이 가장자리까지 이어지도록 끝점이 정수가 아니어도 끝에서 시작합니다.
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 44; i++) {
    const az = azRange[0] + i;
    const sk = (a.skyline ?? flatSky)(((az % 360) + 360) % 360);
    pts.push([az, sk ?? -3]);
  }
  const skyMin = Math.min(...pts.map(p => p[1]));
  const skyMax = Math.max(...pts.map(p => p[1]));
  const flatSun = sunPosition(new Date(ev.flatMs), lat, lon);
  const flatSunEl = flatSun.altitude * R2D + refractionDeg(flatSun.altitude * R2D);
  const delay = ev.deltaMin ?? 0;
  // 평평한 수평선 기준 해와 실제로 보이는 해가 30초 안으로 겹치면 하나만 그립니다(같은 자리에 같은 글이 두 번 나오지 않게).
  const suns: SkyPicture['suns'] = [];
  if (ev.visibleMs == null || Math.abs(delay) >= 0.5) {
    suns.push({ az: (flatSun.azimuth * R2D + 180 + 360) % 360, el: flatSunEl, kind: 'flat', label: fmtTime(ev.flatMs) });
  }
  if (ev.visibleMs != null) {
    const vs = sunPosition(new Date(ev.visibleMs), lat, lon);
    suns.push({ az: ev.azDeg, el: vs.altitude * R2D + refractionDeg(vs.altitude * R2D), kind: 'visible', label: fmtTime(ev.visibleMs) });
  }
  const sunMax = Math.max(...suns.map(s => s.el));
  const elRange: [number, number] = [Math.min(-1, skyMin - 0.5), Math.max(skyMax, sunMax) + 1.5];
  const ridgeM = a.profile ? skylineDistM(a.profile, ev.azDeg) : null;
  const skyHere = ev.skylineDeg ?? (a.profile ? skylineAngleDeg(a.profile, ev.azDeg) : 0);
  // 스카이라인이 0.3° 도 안 되면 능선이 아니라 낮은 지평선입니다(평지·바다) — "능선 0.0°" 라고 쓰지 않습니다.
  const caption = usedTerrain
    ? (skyHere >= 0.3
      ? `${L3(L, '능선', 'Ridge', '稜線')} ${fmtDeg(skyHere)}${ridgeM != null ? `, ${(ridgeM / 1000).toFixed(1)} km` : ''}`
      : `${L3(L, '낮은 지평선', 'Low horizon', '低い地平線')} ${fmtDeg(skyHere)}`)
    : L3(L, '평평한 수평선 0°', 'Flat horizon 0°', '平らな水平線 0°');
  const big = usedTerrain && Math.abs(delay) >= 1;
  const c3: StepCard = {
    id: 'skyline',
    title: L3(L, '지평선 높이', 'Horizon height', '地平線の高さ'),
    shape: 'sky',
    sky: { azRange, elRange, skyline: pts, suns, caption, sunRadiusDeg: SUN_RADIUS_DEG },
    note: !usedTerrain
      ? L3(L, '지형 자료가 아직 없어 평평한 수평선으로 계산했어요.', 'No terrain data yet, so a flat horizon is used.', '地形データがまだないので平らな水平線で計算しました。')
      : big
        ? (rise
          ? L3(L, `이 방향은 산 능선이 ${fmtDeg(skyHere)} 높아요. 해가 실제로 보이는 시각을 가장 크게 늦춘 단계예요.`, `The ridge in this direction is ${fmtDeg(skyHere)} high. This step delays the sunrise the most.`, `この方向は稜線が${fmtDeg(skyHere)}の高さです。日の出が見える時刻を最も遅らせる段階です。`)
          : L3(L, `이 방향은 산 능선이 ${fmtDeg(skyHere)} 높아요. 해가 실제로 사라지는 시각을 가장 크게 앞당긴 단계예요.`, `The ridge in this direction is ${fmtDeg(skyHere)} high. This step brings the sunset forward the most.`, `この方向は稜線が${fmtDeg(skyHere)}の高さです。日の入りを最も早める段階です。`))
        : L3(L, '이 방향은 지평선이 거의 낮아서 시각이 거의 달라지지 않아요.', 'The horizon is low in this direction, so the time barely changes.', 'この方向は地平線が低く、時刻はほとんど変わりません。'),
    key: big,
  };

  // 4. 결과
  const c4: StepCard = {
    id: 'result',
    title: verb,
    shape: 'result',
    result: ev.visibleMs != null ? `${fmtTime(ev.visibleMs)} · ${fmtDeg(ev.azDeg)}` : L3(L, '오늘은 안 보여요', 'Not visible today', '今日は見えません'),
    note: '',
  };

  const flatTxt = fmtTime(ev.flatMs);
  const footnote = ev.visibleMs == null
    ? L3(L, '이 방향의 스카이라인이 해가 닿는 높이보다 높아요.', 'The skyline in this direction is higher than the sun gets.', 'この方向のスカイラインは太陽が届く高さより高いです。')
    : Math.abs(delay) < 0.5
      ? L3(L, `예보 ${rise ? '일출' : '일몰'} ${flatTxt} 와 거의 같아요. 실제 대기는 더 복잡해서 1~2분 차이가 날 수 있어요.`, `Almost the same as the forecast ${rise ? 'sunrise' : 'sunset'} ${flatTxt}. The real atmosphere is messier, so 1-2 minutes can differ.`, `予報の${rise ? '日の出' : '日の入り'}${flatTxt}とほぼ同じです。実際の大気はもっと複雑で、1〜2分ずれることがあります。`)
      : L3(L,
        `예보 ${rise ? '일출' : '일몰'} ${flatTxt} 보다 ${Math.round(Math.abs(delay))}분 ${delay > 0 ? '늦어요' : '일러요'}. 실제 대기는 더 복잡해서 1~2분 차이가 날 수 있어요.`,
        `${Math.round(Math.abs(delay))} min ${delay > 0 ? 'later' : 'earlier'} than the forecast ${rise ? 'sunrise' : 'sunset'} ${flatTxt}. The real atmosphere is messier, so 1-2 minutes can differ.`,
        `予報の${rise ? '日の出' : '日の入り'}${flatTxt}より${Math.round(Math.abs(delay))}分${delay > 0 ? '遅い' : '早い'}です。実際の大気はもっと複雑で、1〜2分ずれることがあります。`);

  return { title, cards: [c1, c2, c3, c4], footnote, usedTerrain, flatMs: ev.flatMs, visibleMs: ev.visibleMs, deltaMin: ev.deltaMin };
}

// ── 노을 점수 ──────────────────────────────────────────────────────────────

export interface SunsetRingPoint { distance: number; azimuthOffset: number; low: number; mid: number; high: number }

export interface BuildSunsetScoreArgs {
  prediction: { score: number; quality: string; breakdown?: SunsetScoreBreakdown };
  /** 해 쪽으로 돌린 보간 링(`alignRingToSun(getInterpolatedWeather(...), sunAz)`): 관측점(distance 0)과 방위·거리 점들. azimuthOffset 0 = 해 쪽 */
  ring: SunsetRingPoint[];
  /** 예측 시각(가장 붉을 때) · 출몰 시각(부제) */
  time: Date;
  eventMs?: number;
  sunAzDeg: number;
  kind: 'sunrise' | 'sunset';
  language: Lang;
  fmtTime: (ms: number) => string;
  /** 앱의 판정 단어(좋음 · 훌륭함 …) */
  qualityWord: (quality: string) => string;
}

export interface SunsetScoreCards {
  title: string;
  /** 부제 뒤에 붙는 말: "일몰 17:04" */
  eventLabel: string | null;
  cards: StepCard[];
  footnote: string;
  score: number;
  /** 결과를 가장 크게 깎은 카드의 id. 해가 노을 창 밖이거나 깎인 게 없으면 null */
  keyId: string | null;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const cover3 = (low: number, mid: number, high: number) => 1 - (1 - low / 100) * (1 - mid / 100) * (1 - high / 100);

/** "노을 점수가 나오기까지" 단계 카드. 점수를 만든 중간값(`SunsetPrediction.breakdown`)이 없으면 null. */
export function buildSunsetScoreCards(a: BuildSunsetScoreArgs): SunsetScoreCards | null {
  const b = a.prediction.breakdown;
  if (!b) return null;
  const L = a.language;
  const sunrise = a.kind === 'sunrise';
  const hour = Number(a.fmtTime(a.time.getTime()).split(':')[0]);

  // 1. 예보 원자료
  const rows1: StepRow[] = [
    { label: L3(L, '낮은', 'Low', '低層'), value: `${Math.round(b.obs.low)} %` },
    { label: L3(L, '중간', 'Mid', '中層'), value: `${Math.round(b.obs.mid)} %` },
    { label: L3(L, '높은', 'High', '高層'), value: `${Math.round(b.obs.high)} %` },
    { label: L3(L, '습도', 'Humidity', '湿度'), value: `${Math.round(b.obs.humidity)} %` },
  ];
  if (b.obs.precipMm > 0.1) rows1.push({ label: L3(L, '강수', 'Rain', '降水'), value: `${b.obs.precipMm.toFixed(1)} mm/h` });

  // 2. 주변 지도: 관측점 밖의 점을 방위·거리로
  const cells: SkyMapCell[] = a.ring.filter(p => p.distance > 0).map(p => ({
    distKm: p.distance,
    azDeg: (((a.sunAzDeg + p.azimuthOffset) % 360) + 360) % 360,
    cover: cover3(p.low, p.mid, p.high),
    low: p.low, mid: p.mid, high: p.high,
  }));
  const ringsKm = [...new Set(cells.map(c => c.distKm))].sort((x, y) => x - y);
  const maxKm = ringsKm.length ? ringsKm[ringsKm.length - 1] : 100;
  const sunLine = a.ring.filter(p => p.distance > 0 && Math.abs(p.azimuthOffset) < 1e-6);
  let best: SunsetRingPoint | null = null;
  for (const p of sunLine) if (!best || cover3(p.low, p.mid, p.high) > cover3(best.low, best.mid, best.high) + 1e-9) best = p;
  const bestCover = best ? cover3(best.low, best.mid, best.high) : 0;
  const overhead = cover3(b.obs.low, b.obs.mid, b.obs.high);
  let note2: string;
  if (!best || bestCover < 0.15) {
    note2 = L3(L, '해 쪽 길이 거의 맑아요.', 'The path toward the sun is almost clear.', '太陽の方向はほぼ晴れています。');
  } else {
    const dom = best.low >= best.mid && best.low >= best.high ? 'low' : best.mid >= best.high ? 'mid' : 'high';
    const word = dom === 'low' ? L3(L, '낮은', 'low', '低い') : dom === 'mid' ? L3(L, '중간', 'mid-level', '中層の') : L3(L, '높은', 'high', '高い');
    const v = Math.round(best[dom]);
    const missed = bestCover - overhead >= 0.25;
    note2 = L3(L,
      `해 쪽 ${Math.round(best.distance)} km 근처에 ${word} 구름이 ${v} % 있어요.${missed ? ' 머리 위만 보면 놓치는 구름이에요.' : ''}`,
      `Near ${Math.round(best.distance)} km toward the sun there is ${v}% ${word} cloud.${missed ? ' You would miss it by looking only overhead.' : ''}`,
      `太陽方向${Math.round(best.distance)} km付近に${word}雲が${v} %あります。${missed ? '真上だけ見ていると見落とす雲です。' : ''}`);
  }

  // 키 단계: 해가 노을 창 안일 때만. 점수를 **깎는** 단계는 날씨(맑음 정도)와 해 쪽 빛의 길(투과율) 둘이고, 그중 15% 넘게 깎은 가장 큰 것이
  // 키입니다. 둘 다 거의 안 깎았는데 점수가 60 미만이면 남은 것은 붉게 물들 구름의 양뿐이라 구름 단계를 짚습니다(구름이 없다는 것은
  // 깎임이 아니라 보탤 것이 없다는 뜻이라 말을 달리합니다).
  const inWindow = b.sunWindow >= 0.2;
  const reducers: Array<[string, number]> = [['forecast', 1 - b.weatherClear], ['path', 1 - b.pathClarity]];
  let keyId: string | null = null;
  if (inWindow) {
    const top = reducers.reduce((m, x) => (x[1] > m[1] ? x : m), reducers[0]);
    if (top[1] >= 0.15) keyId = top[0];
    else if (a.prediction.score < 60) keyId = 'cloudtype';
  }
  const keyTail = (id: string) => {
    if (keyId !== id) return '';
    return id === 'cloudtype'
      ? L3(L, ' 점수를 더 올릴 수 있는 건 이 단계예요.', ' This is the step that could still raise the score.', ' スコアをさらに上げられるのはこの段階です。')
      : L3(L, ' 점수를 가장 크게 깎은 단계예요.', ' This step cost the score the most.', ' スコアを最も下げた段階です。');
  };

  // 3. 해 쪽 빛의 길
  const clarityPct = Math.round(b.pathClarity * 100);
  const note3 = L3(L,
    `노을빛의 ${clarityPct} %가 내 하늘의 구름까지 와요.${b.pathClarity < 0.5 ? ' 해 쪽 길의 구름이 빛을 많이 막아요.' : ''}${keyTail('path')}`,
    `${clarityPct}% of the sunset light reaches the clouds over you.${b.pathClarity < 0.5 ? ' Clouds on the path block much of it.' : ''}${keyTail('path')}`,
    `夕焼けの光の${clarityPct} %が自分の空の雲まで届きます。${b.pathClarity < 0.5 ? '太陽方向の雲が光を多く遮ります。' : ''}${keyTail('path')}`);

  // 4. 구름 종류: 층별 비율과 붉게 칠해진 정도
  const names = {
    high: L3(L, '높은 층 · 권운', 'High · cirrus', '高層・巻雲'),
    mid: L3(L, '중간 층 · 고적운', 'Mid · altocumulus', '中層・高積雲'),
    low: L3(L, '낮은 층 · 층적운', 'Low · stratocumulus', '低層・層積雲'),
  } as const;
  const present = (['high', 'mid', 'low'] as const).filter(k => b.layers[k].cover >= 0.05);
  const rows4: StepRow[] = present.map(k => ({ label: names[k], value: `${Math.round(b.layers[k].cover * 100)} %` }));
  if (present.length) rows4.push({ label: L3(L, '붉게 물든 정도', 'Painted red', '赤く染まる度合い'), value: pct(b.paintedCloud) });
  else rows4.push({ label: L3(L, '구름', 'Clouds', '雲'), value: L3(L, '거의 없음', 'almost none', 'ほとんどなし') });
  const topLit = (['high', 'mid', 'low'] as const).reduce((m, k) => (b.layers[k].lit > b.layers[m].lit ? k : m), 'high' as 'high' | 'mid' | 'low');
  const note4base = !present.length
    ? L3(L, '하늘을 붉게 칠할 구름이 거의 없어요. 맑은 하늘 노을만 남아요.', 'Almost no clouds to paint red; only the clear-sky glow remains.', '赤く染まる雲がほとんどなく、晴天の空の色だけが残ります。')
    : b.layers[topLit].lit < 0.01
      ? L3(L, '구름은 있지만 지금은 붉은 빛이 닿지 않거나 아래 구름에 가려 거의 물들지 않아요.', 'There are clouds, but red light barely reaches them or lower clouds hide them.', '雲はありますが、赤い光がほとんど届かないか低い雲に隠れて染まりません。')
      : topLit === 'high'
        ? L3(L, '권운은 해가 진 뒤에도 빛을 받아 붉게 물들어요.', 'Cirrus keeps catching light after sunset and turns red.', '巻雲は日没後も光を受けて赤く染まります。')
        : topLit === 'mid'
          ? L3(L, '중간 높이 구름은 해가 진 직후 잠깐 붉게 물들어요.', 'Mid-level clouds glow red briefly right after sunset.', '中層の雲は日没直後の短い間、赤く染まります。')
          : L3(L, '낮은 구름은 일찍 어두워지고 해 쪽 빛을 가리기도 해요.', 'Low clouds darken early and can block the light from the sun.', '低い雲は早く暗くなり、太陽の光を遮ることもあります。');
  const note4 = note4base + keyTail('cloudtype');

  // 5. 점수
  const base = Math.round(b.baseSkyGlow), cloud = Math.round(b.cloudRedScore);
  const qword = a.qualityWord(a.prediction.quality);
  const cards: StepCard[] = [
    { id: 'forecast', title: L3(L, '예보 원자료', 'Forecast data', '予報の元データ'), shape: 'rows', rows: rows1,
      note: L3(L, `내 위치의 ${hour}시 예보예요.`, `The forecast for your location at ${hour}:00.`, `あなたの場所の${hour}時の予報です。`) + keyTail('forecast'), key: keyId === 'forecast' },
    { id: 'map', title: L3(L, '주변 지도로 펴기', 'Spread over the map', '周りの地図に広げる'), shape: 'map', map: { maxKm, ringsKm, cells, sunAzDeg: a.sunAzDeg }, note: note2 },
    { id: 'path', title: L3(L, '해 쪽으로 빛 따라가기', 'Follow the light toward the sun', '太陽方向へ光をたどる'), shape: 'bar', bar: { value: b.pathClarity, display: `${clarityPct} %` }, note: note3, key: keyId === 'path' },
    { id: 'cloudtype', title: L3(L, '구름 종류 정하기', 'Decide the cloud types', '雲の種類を決める'), shape: 'rows', rows: rows4, note: note4, key: keyId === 'cloudtype' },
    { id: 'score', title: L3(L, '점수', 'Score', 'スコア'), shape: 'result', result: `${qword} ${Math.round(a.prediction.score)}`,
      rows: [
        { label: L3(L, '맑은 하늘 노을', 'Clear-sky glow', '晴天の空の色'), value: L3(L, `${base}점`, `${base} pts`, `${base}点`) },
        { label: L3(L, '붉게 물든 구름', 'Red clouds', '赤く染まる雲'), value: L3(L, `${cloud}점`, `${cloud} pts`, `${cloud}点`) },
      ],
      note: '' },
  ];

  let footnote = L3(L, '실제 대기는 더 복잡해요. 이 계산은 주요 요인만 단순하게 셉니다.', 'The real atmosphere is messier. This counts only the main factors, simply.', '実際の大気はもっと複雑です。この計算は主な要因だけを単純に数えます。');
  if (!inWindow) {
    const alt = b.sunAltDeg.toFixed(0);
    footnote = L3(L,
      `이 시각은 해 고도가 ${alt}° 라 ${b.sunAltDeg > 0 ? '해가 너무 높아' : '해가 너무 낮아'} 노을이 생기는 때가 아니에요. ${footnote}`,
      `At this time the sun is at ${alt}°, ${b.sunAltDeg > 0 ? 'too high' : 'too low'} for a sunset glow. ${footnote}`,
      `この時刻は太陽の高度が${alt}°で、${b.sunAltDeg > 0 ? '高すぎて' : '低すぎて'}夕焼けになりません。${footnote}`);
  }
  return {
    title: sunrise ? L3(L, '새벽 노을 점수가 나오기까지', 'How the dawn score is made', '朝焼けスコアの出し方') : L3(L, '노을 점수가 나오기까지', 'How the sunset score is made', '夕焼けスコアの出し方'),
    eventLabel: a.eventMs != null ? `${sunrise ? L3(L, '일출', 'sunrise', '日の出') : L3(L, '일몰', 'sunset', '日の入り')} ${a.fmtTime(a.eventMs)}` : null,
    cards,
    footnote,
    score: Math.round(a.prediction.score),
    keyId,
  };
}


// ── 별 보기 조건 ─────────────────────────────────────────────────────────

export interface BuildStarArgs {
  language: Lang;
  /** 별을 보는 시각(ms) */
  timeMs: number;
  /** 그 시각의 입력(운량·해·달·빛 지도·연무) */
  input: StarInput;
  /** 구름 예보가 있는가(없으면 운량 칸이 "모름") */
  cloudKnown: boolean;
  /** 달이 이 시각 뒤에 지는 시각(ms). 이미 없거나 오래 안 지면 null. */
  moonSetMs: number | null;
  /** 달이 진 시각의 해 고도(°) — 달이 진 뒤의 한계등급을 셉니다. moonSetMs 가 null 이면 안 씁니다. */
  sunAltAtMoonSetDeg?: number;
  fmtTime: (ms: number) => string;
}

export interface StarCards {
  title: string;
  /** 제목 아래 시각 글자 */
  eventLabel: string;
  cards: StepCard[];
  footnote: string;
  limitMag: number;
  /** 가장 크게 줄인 단계 id (`moon` · `light` · `haze` · `twilight`). 가장 큰 것도 0.3 등급 미만이면 null */
  keyId: StarResult['keyStep'];
}

const fmtMag = (d: number) => `${d <= -0.05 ? '−' : ''}${Math.abs(d).toFixed(1)}`;

/** "별 보기 조건" 단계 카드: 구름 → (박명) → 달빛 → 빛 공해 → 습도와 연무 → 보이는 별(한계등급). 계산은 `starVisibility.ts`. */
export function buildStarCards(a: BuildStarArgs): StarCards {
  const L = a.language;
  const r = starLimit(a.input);
  const inp = a.input;
  const mag = L3(L, '등급', 'mag', '等級');
  const cloudWord = r.cloud.rating === 'good' ? L3(L, '좋음', 'Good', '良い') : r.cloud.rating === 'fair' ? L3(L, '보통', 'Fair', '普通') : L3(L, '나쁨', 'Poor', '悪い');
  const cards: StepCard[] = [];

  // 1. 구름 — 등급을 바꾸지 않고 하늘의 얼마가 가려지는가
  cards.push({
    id: 'cloud', title: L3(L, '구름', 'Clouds', '雲'), shape: 'metric',
    tone: !a.cloudKnown ? 'plain' : r.cloud.rating === 'good' ? 'good' : r.cloud.rating === 'fair' ? 'warn' : 'bad',
    result: a.cloudKnown ? cloudWord : L3(L, '모름', 'Unknown', '不明'),
    rows: a.cloudKnown ? [{ label: L3(L, '하늘 전체', 'Whole sky', '空全体'), value: `${Math.round(r.cloud.pct)} %` }] : [],
    note: !a.cloudKnown ? L3(L, '이 시각의 구름 예보가 없어요.', 'There is no cloud forecast for this time.', 'この時刻の雲の予報がありません。')
      : r.cloud.rating === 'good' ? L3(L, '별을 가리는 구름은 거의 없어요.', 'Hardly any clouds block the stars.', '星を隠す雲はほとんどありません。')
        : r.cloud.rating === 'fair' ? L3(L, '구름이 하늘 곳곳을 가려요. 구름 사이로 별이 보여요.', 'Clouds cover parts of the sky. Stars show between them.', '雲が空のところどころを隠します。雲の間から星が見えます。')
          : L3(L, '구름이 하늘 대부분을 가려 별이 거의 안 보여요.', 'Clouds cover most of the sky, so few stars show.', '雲が空の大半を覆い、星はほとんど見えません。'),
  });

  // 박명 — 어두운 밤이 아닐 때만
  if (r.twilight) {
    cards.push({
      id: 'twilight', title: L3(L, '박명', 'Twilight', '薄明'), shape: 'metric', tone: 'warn', key: r.keyStep === 'twilight',
      result: `${fmtMag(r.twilight.deltaMag)} ${mag}`,
      rows: [{ label: L3(L, '해', 'Sun', '太陽'), value: fmtDeg(r.twilight.sunAltDeg) }],
      note: r.twilight.deltaMag > -0.15
        ? L3(L, '해가 거의 다 내려가 하늘이 거의 어두워졌어요.', 'The sun is almost low enough, so the sky is nearly dark.', '太陽がほぼ下がり、空はほとんど暗くなりました。')
        : L3(L, '해가 아직 충분히 내려가지 않아 하늘이 밝아요. 지평선 아래 18° 가 되면 어두워져요.', 'The sun is not low enough yet, so the sky is bright. It gets dark at 18° below the horizon.', '太陽がまだ十分に下がっておらず空が明るいです。地平線の下18°で暗くなります。'),
    });
  }

  // 2. 달빛
  cards.push({
    id: 'moon', title: L3(L, '달빛', 'Moonlight', '月明かり'), shape: 'metric', tone: 'moon', key: r.keyStep === 'moon',
    result: r.moon.up ? `${fmtMag(r.moon.deltaMag)} ${mag}` : L3(L, '없음', 'None', 'なし'),
    rows: r.moon.up
      ? [{ label: L3(L, '밝은 면', 'Lit', '輝面'), value: `${Math.round(r.moon.illum * 100)} %` }, { label: L3(L, '고도', 'Altitude', '高度'), value: fmtDeg(r.moon.altDeg, 0) }]
      : [{ label: L3(L, '달', 'Moon', '月'), value: L3(L, '지평선 아래', 'below the horizon', '地平線の下') }],
    note: !r.moon.up ? L3(L, '달이 떠 있지 않아 영향이 없어요.', 'The moon is down, so it has no effect.', '月が出ていないので影響はありません。')
      : r.keyStep === 'moon' ? L3(L, '어두운 별을 가장 많이 지운 단계예요.', 'This step hides the most faint stars.', '暗い星を最も多く消している段階です。')
        : r.moon.deltaMag > -0.15 ? L3(L, '달이 떠 있지만 가늘거나 낮아 영향이 작아요.', 'The moon is up but thin or low, so the effect is small.', '月は出ていますが細いか低いため、影響は小さいです。')
          : L3(L, '달빛이 하늘을 밝혀 어두운 별이 가려져요.', 'Moonlight brightens the sky and hides faint stars.', '月明かりが空を明るくして暗い星を隠します。'),
  });

  // 3. 빛 공해
  const lp = r.light.baseMag;
  cards.push({
    id: 'light', title: L3(L, '빛 공해', 'Light pollution', '光害'), shape: 'metric', tone: r.light.deltaMag < -1 ? 'warn' : 'plain', key: r.keyStep === 'light',
    result: lp == null ? L3(L, '모름', 'Unknown', '不明') : `${fmtMag(r.light.deltaMag)} ${mag}`,
    rows: lp == null ? [] : [{ label: L3(L, '빛 지도 기준 한계', 'Limit by the light map', '光地図での限界'), value: `${lp.toFixed(1)} ${mag}` }],
    note: lp == null ? L3(L, '밤 불빛 지도를 못 읽어 빛 공해를 셈에 넣지 못했어요.', 'The night-light map could not be read, so light pollution is not counted.', '夜間光の地図を読めず、光害を計算に入れていません。')
      : r.keyStep === 'light' ? L3(L, '어두운 별을 가장 많이 지운 단계예요.', 'This step hides the most faint stars.', '暗い星を最も多く消している段階です。')
        : r.light.deltaMag > -0.15 ? L3(L, '도시 불빛의 영향이 작아요(밤 불빛 지도 기준).', 'City lights have little effect here (from the night-light map).', '街の明かりの影響は小さいです(夜間光の地図による)。')
          : L3(L, '도시 불빛이 하늘을 밝혀요(밤 불빛 지도 기준).', 'City lights brighten the sky (from the night-light map).', '街の明かりが空を明るくします(夜間光の地図による)。'),
  });

  // 4. 습도와 연무
  const hazeRows: StepRow[] = [];
  if (r.haze.aodSource === 'aod') hazeRows.push({ label: L3(L, '에어로졸', 'Aerosol', 'エアロゾル'), value: `AOD ${r.haze.aod!.toFixed(2)}` });
  else if (r.haze.aodSource === 'visibility') {
    hazeRows.push({ label: L3(L, '시정', 'Visibility', '視程'), value: `${((inp.visibilityM as number) / 1000).toFixed(0)} km` });
    hazeRows.push({ label: L3(L, '어림 AOD', 'Est. AOD', '推定AOD'), value: r.haze.aod!.toFixed(2) });
  }
  if (inp.humidityPct != null) hazeRows.push({ label: L3(L, '습도', 'Humidity', '湿度'), value: `${Math.round(inp.humidityPct)} %` });
  if (inp.pm25 != null) hazeRows.push({ label: 'PM2.5', value: `${Math.round(inp.pm25)} µg/m³` });
  cards.push({
    id: 'haze', title: L3(L, '습도와 연무', 'Humidity and haze', '湿度とかすみ'), shape: 'metric', tone: r.haze.deltaMag < -0.5 ? 'warn' : 'plain', key: r.keyStep === 'haze',
    result: r.haze.aodSource === 'none' ? L3(L, '모름', 'Unknown', '不明') : `${fmtMag(r.haze.deltaMag)} ${mag}`,
    rows: hazeRows,
    note: r.haze.aodSource === 'none' ? L3(L, '연무 자료가 없어 맑은 대기로 셌어요.', 'There is no haze data, so the air is counted as clear.', 'かすみのデータがないため澄んだ大気として計算しました。')
      : r.haze.deltaMag > -0.15 ? L3(L, '대기가 맑아 영향이 작아요.', 'The air is clear, so the effect is small.', '大気が澄んでいて影響は小さいです。')
        : L3(L, '연무가 별빛을 줄여요. 지평선 근처가 더 흐려요.', 'Haze dims starlight, most near the horizon.', 'かすみが星の光を弱めます。地平線近くほど暗くなります。'),
  });

  // 5. 보이는 별 — 막대 1~6.5 등급
  const limit = r.limitMag;
  const after = a.moonSetMs != null && r.moon.up ? limitWithoutMoon({ ...inp, sunAltDeg: a.sunAltAtMoonSetDeg ?? inp.sunAltDeg }) : null;
  const lvl = seeLevel(limit);
  const levelText = lvl === 'darkest' ? L3(L, '아주 어두운 하늘이에요. 은하수가 또렷해요.', 'A very dark sky. The Milky Way is clear.', 'とても暗い空です。天の川がはっきり見えます。')
    : lvl === 'milkyway' ? L3(L, '별자리와 은하수 일부가 보여요.', 'Constellations and part of the Milky Way show.', '星座と天の川の一部が見えます。')
      : lvl === 'constellations' ? L3(L, '주요 별자리가 보여요. 은하수는 어려워요.', 'The main constellations show. The Milky Way is hard.', '主な星座が見えます。天の川は難しいです。')
        : lvl === 'bright' ? L3(L, '밝은 별과 큰 별자리만 보여요.', 'Only bright stars and big constellations show.', '明るい星と大きな星座だけが見えます。')
          : L3(L, '밝은 별 몇 개만 보여요.', 'Only a few bright stars show.', '明るい星が数個だけ見えます。');
  const moonTail = after != null && a.moonSetMs != null && after - limit >= 0.3
    ? L3(L, `달이 지는 ${a.fmtTime(a.moonSetMs)} 뒤에는 ${after.toFixed(1)} 등급까지 보여요.${after >= 4.5 ? ' 은하수는 달이 진 뒤를 권해요.' : ''}`,
      `After the moon sets at ${a.fmtTime(a.moonSetMs)}, stars to magnitude ${after.toFixed(1)} show.${after >= 4.5 ? ' The Milky Way is best after moonset.' : ''}`,
      `月が沈む${a.fmtTime(a.moonSetMs)}以降は${after.toFixed(1)}等級まで見えます。${after >= 4.5 ? '天の川は月が沈んだ後がおすすめです。' : ''}`)
    : '';
  // 빛 지도를 못 읽었으면 빛 공해를 0 으로 센 값이라 도시에서는 낙관적입니다(모르는 것을 좋게 말하지 않습니다).
  const lpCaveat = inp.lightPollutionMag == null
    ? L3(L, '빛 공해를 셈에 넣지 못해 도시에서는 이보다 덜 보일 수 있어요.', 'Light pollution is not counted, so fewer stars may show in a city.', '光害を計算に入れていないため、街中ではこれより少なくなることがあります。')
    : '';
  const sep = L === 'ja' ? '' : ' ';   // 일본어는 문장 사이에 공백을 두지 않습니다
  const cloudHead = a.cloudKnown && r.cloud.rating === 'bad' ? L3(L, '구름이 많아 대부분 가려져요. 구름이 없는 곳에서는 ', 'Clouds hide most of it. Where it is clear, ', '雲が多くほとんど隠れます。雲のないところでは') : '';
  cards.push({
    id: 'limit', title: L3(L, '보이는 별', 'Visible stars', '見える星'), shape: 'bar', key: false,
    bar: { value: Math.max(0, Math.min(1, (limit - 1) / 5.5)), display: L3(L, `${limit.toFixed(1)} 등급까지`, `to mag ${limit.toFixed(1)}`, `${limit.toFixed(1)}等級まで`) },
    note: `${cloudHead}${levelText}${moonTail ? sep + moonTail : ''}${lpCaveat ? sep + lpCaveat : ''}`,
  });

  const footnote = L3(L,
    '한계등급은 천정 하늘 밝기로 구한 값이에요. 지평선 근처는 더 어둡게 보여요. 달빛은 Krisciunas & Schaefer(1991) 식, 빛 공해는 밤 불빛 지도(NASA Black Marble) 기준이에요.',
    'The limit comes from the zenith sky brightness; near the horizon it is worse. Moonlight follows Krisciunas & Schaefer (1991), light pollution the night-light map (NASA Black Marble).',
    '限界等級は天頂の空の明るさから求めています。地平線近くはさらに暗く見えます。月明かりは Krisciunas & Schaefer (1991)、光害は夜間光の地図(NASA Black Marble)に基づきます。');
  return {
    title: L3(L, '별 보기 조건', 'Stargazing conditions', '星空の条件'),
    eventLabel: a.fmtTime(a.timeMs),
    cards,
    footnote,
    limitMag: limit,
    keyId: r.keyStep,
  };
}
