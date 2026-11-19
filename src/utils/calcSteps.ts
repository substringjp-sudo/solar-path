/**
 * 계산 과정 보기의 단계 카드 (2026-11-19, docs/SANDBOX_MODE_PLAN.md 9 장).
 *
 * 용어집이 아니라 **앱이 실제로 하는 계산을 오늘의 숫자 그대로** 보여 줍니다. 결과 하나마다 단계들을 차례로 펼치고, 단계마다
 * 들어온 값 · 한 일 · 나온 값과 "왜 사진에 중요한가" 한 문장만 붙입니다. 값은 늘 지금 보는 위치·날짜의 실제 값입니다.
 *
 * 카드는 세 모양 중 하나입니다(처음 주제인 "해 뜨는 시각과 방향" 에 필요한 것만): 숫자 줄(`rows`), 하늘 그림(`sky`, 스카이라인 윤곽과 해 자리),
 * 결과 줄(`result`). 나머지 모양(막대 · 작은 지도 · 그래프)은 다음 주제와 함께 옵니다.
 *
 * 순수 함수입니다 — 화면(`components/CalcSteps`)이 그립니다. 시각 표기는 `fmtTime` 으로 받습니다(화면은 기기 시간대, 판정은 UTC).
 */
import { sunHorizonSteps, SUN_RADIUS_DEG, type SkylineFn } from './terrainSun';
import { skylineDistM, type HorizonProfile, skylineAngleDeg } from './horizon';
import { sunPosition } from './solarPosition';
import { refractionDeg } from './moonPosition';

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

export interface StepCard {
  id: string;
  title: string;
  shape: 'rows' | 'sky' | 'result';
  rows?: StepRow[];
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
const fmtDeg = (d: number, digits = 1) => `${(Math.abs(d) < 0.5 * 10 ** -digits ? 0 : d).toFixed(digits)}°`;
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
  const suns: SkyPicture['suns'] = [
    { az: (flatSun.azimuth * R2D + 180 + 360) % 360, el: flatSunEl, kind: 'flat', label: fmtTime(ev.flatMs) },
  ];
  if (ev.visibleMs != null) {
    const vs = sunPosition(new Date(ev.visibleMs), lat, lon);
    suns.push({ az: ev.azDeg, el: vs.altitude * R2D + refractionDeg(vs.altitude * R2D), kind: 'visible', label: fmtTime(ev.visibleMs) });
  }
  const sunMax = Math.max(...suns.map(s => s.el));
  const elRange: [number, number] = [Math.min(-1, skyMin - 0.5), Math.max(skyMax, sunMax) + 1.5];
  const ridgeM = a.profile ? skylineDistM(a.profile, ev.azDeg) : null;
  const skyHere = ev.skylineDeg ?? (a.profile ? skylineAngleDeg(a.profile, ev.azDeg) : 0);
  const caption = usedTerrain
    ? `${L3(L, '능선', 'Ridge', '稜線')} ${fmtDeg(skyHere)}${ridgeM != null ? `, ${(ridgeM / 1000).toFixed(1)} km` : ''}`
    : L3(L, '평평한 수평선 0°', 'Flat horizon 0°', '平らな水平線 0°');
  const delay = ev.deltaMin ?? 0;
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
