/**
 * 정밀한 달 위치 (2026-11-19, docs/SANDBOX_MODE_PLAN.md 5 장 — 해·달을 대상에 거는 기능의 바탕).
 *
 * ## 왜
 *
 * `SunCalc.getMoonPosition` 은 황경 항 하나(6.289° sin M)만 쓰는 저정밀 식이라, 기준(astronomy-engine, 약 1′)에 견줘
 * 중앙값 1.2°, 최대 3.4° 어긋납니다(2026-11 시험: 3,000 표본 중 달이 떠 있던 1,467 개). 달의 겉지름은 0.5° 라서
 * "달이 이 봉우리에 걸리는 날"을 찾기에는 한참 모자랍니다. 거기에 시차(지평선 근처에서 최대 0.95° 낮아짐)도 빠져 있습니다.
 *
 * ## 무엇을
 *
 * Meeus, *Astronomical Algorithms* 47 장의 달 위치 주기항(경도·거리 60 개, 위도 60 개)과 보정항으로 지심 황경·황위·거리를 구하고,
 * 적도 좌표 → **관측지 시차 보정** → 지평 좌표 → 대기 굴절(Sæmundsson)로 겉보기 방위·고도를 냅니다.
 * 장동(≲ 0.005°)·광행차(달은 무시)는 넣지 않았습니다. ΔT 는 2026 년 값(69 s)으로 고정합니다.
 *
 * 반환 모양은 `SunCalc.getMoonPosition` 과 같습니다(방위 = 남쪽에서 서쪽으로 잰 라디안, 고도 = 굴절 포함 라디안,
 * 거리 km, 시차각) — 호출부는 이름만 바꾸면 됩니다.
 */

const RAD = Math.PI / 180;
const DELTA_T_S = 69;
const EARTH_EQ_RADIUS_KM = 6378.14;

// 표 47.A — D, M, M', F, Σl (1e-6°), Σr (1e-3 km)
const LR: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149], [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210], [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056], [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751], [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0], [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897], [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0], [2, -1, 0, -2, 596, 0], [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739], [2, 1, 0, -2, -399, 0], [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0], [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165], [1, 1, -1, 0, 299, 0], [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];

// 표 47.B — D, M, M', F, Σb (1e-6°)
const B: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324], [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475], [0, 1, 1, -1, -1410],
  [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107], [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777], [4, 0, -2, 1, 671], [2, 0, 0, -3, 607], [2, 0, 2, -1, 596], [2, -1, 1, -1, 491],
  [2, 0, -2, 1, -451], [0, 0, 3, -1, 439], [2, 0, 2, 1, 422], [2, 0, -3, -1, 421], [2, 1, -1, 1, -366],
  [2, 1, 0, 1, -351], [4, 0, 0, 1, 331], [2, -1, 1, 1, 315], [2, -2, 0, -1, 302], [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229], [1, 1, 0, -1, 223], [1, 1, 0, 1, 223], [0, 1, -2, -1, -220], [2, 1, -1, -1, -220],
  [1, 0, 1, 1, -185], [2, -1, -2, -1, 181], [0, 1, 2, 1, -177], [4, 0, -2, -1, 176], [4, -1, -1, -1, 166],
  [1, 0, 1, -1, -164], [4, 0, 1, -1, 132], [1, 0, -1, -1, -119], [4, -1, 0, -1, 115], [2, -2, 0, 1, 107],
];

const norm360 = (d: number) => ((d % 360) + 360) % 360;

export interface MoonGeocentric {
  /** 황경·황위(°), 지심 거리(km) */
  lonDeg: number;
  latDeg: number;
  distKm: number;
}

// 한 프레임에 같은 시각으로 여러 곳(3D 달, 위상, 화면 숫자)이 부르므로 마지막 결과를 들고 있습니다.
let memoMs = NaN;
let memoVal: Readonly<MoonGeocentric> | null = null;

/** 지심 황경·황위·거리. `date` 는 UT. 돌려준 값을 고치지 마세요(캐시됩니다). */
export function moonGeocentric(date: Date): Readonly<MoonGeocentric> {
  const ms = date.getTime();
  if (ms === memoMs && memoVal) return memoVal;
  const jd = ms / 86400000 + 2440587.5 + DELTA_T_S / 86400;
  const T = (jd - 2451545) / 36525;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000);
  const D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000) * RAD;
  const M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000) * RAD;
  const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000) * RAD;
  const F = norm360(93.272095 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000) * RAD;
  const A1 = norm360(119.75 + 131.849 * T) * RAD;
  const A2 = norm360(53.09 + 479264.29 * T) * RAD;
  const A3 = norm360(313.45 + 481266.484 * T) * RAD;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, cl, cr] of LR) {
    const e = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
    const arg = d * D + m * M + mp * Mp + f * F;
    sl += cl * e * Math.sin(arg);
    sr += cr * e * Math.cos(arg);
  }
  for (const [d, m, mp, f, cb] of B) {
    const e = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
    sb += cb * e * Math.sin(d * D + m * M + mp * Mp + f * F);
  }
  const LpR = Lp * RAD;
  sl += 3958 * Math.sin(A1) + 1962 * Math.sin(LpR - F) + 318 * Math.sin(A2);
  sb += -2235 * Math.sin(LpR) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F) + 175 * Math.sin(A1 + F) + 127 * Math.sin(LpR - Mp) - 115 * Math.sin(LpR + Mp);
  const out: MoonGeocentric = { lonDeg: norm360(Lp + sl / 1e6), latDeg: sb / 1e6, distKm: 385000.56 + sr / 1000 };
  memoMs = ms;
  memoVal = out;
  return out;
}

/** 그리니치 평균 항성시(°). */
function gmstDeg(date: Date): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  return norm360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T - (T * T * T) / 38710000);
}

/**
 * Sæmundsson 굴절(°) — 기하 고도 h(°) 에 더해 겉보기 고도를 얻는 양.
 *
 * `sunsetPhysics.getApparentAltitude` 와 **같은 식·같은 끝처리**입니다(−4.2° 에서 −6° 사이를 서서히 0 으로).
 * 해와 달이 같은 굴절을 쓰지 않으면 "해와 달이 같은 곳에 걸린다" 의 판정이 지평 근처에서 밀립니다.
 * 두 식이 같다는 것은 `verify-moon-position.js` 가 지킵니다.
 */
export function refractionDeg(hDeg: number): number {
  if (hDeg <= -6) return 0;
  const safe = Math.max(hDeg, -4.2);
  const r = 1.02 / Math.tan((safe + 10.3 / (safe + 5.11)) * RAD) / 60;
  return hDeg < -4.2 ? (r * (hDeg + 6)) / 1.8 : r;
}

/** 지심 적경·적위(라디안, 그 시각의 분점 기준)와 거리. 지구본의 달 직하점이 이걸 씁니다. */
export function moonEquatorial(date: Date): { raRad: number; decRad: number; distKm: number } {
  const g = moonGeocentric(date);
  const T = (date.getTime() / 86400000 + 2440587.5 + DELTA_T_S / 86400 - 2451545) / 36525;
  const eps = (23.4392911 - 0.0130042 * T) * RAD;
  const lam = g.lonDeg * RAD, bet = g.latDeg * RAD;
  const raRad = Math.atan2(Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps), Math.cos(lam));
  const decRad = Math.asin(Math.sin(bet) * Math.cos(eps) + Math.cos(bet) * Math.sin(eps) * Math.sin(lam));
  return { raRad, decRad, distKm: g.distKm };
}

/** 달의 겉보기 반지름(°). 평균 반지름 1737.4 km. */
export function moonSemidiameterDeg(distKm: number): number {
  return Math.asin(1737.4 / distKm) / RAD;
}

export interface MoonPositionSunCalcShape {
  /** 남쪽 0, 서쪽 +(라디안) — SunCalc 와 같은 규약. 북쪽 기준 도로는 `azimuth / RAD + 180`. */
  azimuth: number;
  /** 겉보기 고도(굴절 포함, 라디안) */
  altitude: number;
  /** 지심 거리(km) */
  distance: number;
  /** 시차각(라디안) */
  parallacticAngle: number;
}

/**
 * 관측지(lat, lon °, 고도 elevM m)에서 본 달의 겉보기 위치. 시차 보정과 굴절을 포함합니다.
 * 같은 값을 `geometricAltitude`(굴절·시차 포함 전, 지평 좌표의 기하 고도)로도 줍니다.
 */
export function getMoonPositionPrecise(date: Date, latDeg: number, lonDeg: number, elevM = 0): MoonPositionSunCalcShape & { geometricAltitude: number } {
  const g = moonGeocentric(date);
  const { raRad: ra, decRad: dec } = moonEquatorial(date);
  const phi = latDeg * RAD;
  const theta = (gmstDeg(date) + lonDeg) * RAD;           // 지방 항성시
  const H = theta - ra;                                    // 시간각
  // 관측지 시차(Meeus 40 장): 편평한 지구 보정 ρ sinφ′, ρ cosφ′
  const u = Math.atan(0.99664719 * Math.tan(phi));
  const rs = 0.99664719 * Math.sin(u) + (elevM / 6378140) * Math.sin(phi);
  const rc = Math.cos(u) + (elevM / 6378140) * Math.cos(phi);
  const sinPi = Math.sin(Math.asin(EARTH_EQ_RADIUS_KM / g.distKm));
  const dRa = Math.atan2(-rc * sinPi * Math.sin(H), Math.cos(dec) - rc * sinPi * Math.cos(H));
  const decT = Math.atan2((Math.sin(dec) - rs * sinPi) * Math.cos(dRa), Math.cos(dec) - rc * sinPi * Math.cos(H));
  const Ht = H - dRa;                                      // 시차 보정한 시간각
  const sinAlt = Math.sin(phi) * Math.sin(decT) + Math.cos(phi) * Math.cos(decT) * Math.cos(Ht);
  const altGeo = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const azSouth = Math.atan2(Math.sin(Ht), Math.cos(Ht) * Math.sin(phi) - Math.tan(decT) * Math.cos(phi));
  const altDeg = altGeo / RAD;
  const q = Math.atan2(Math.sin(Ht), Math.tan(phi) * Math.cos(decT) - Math.sin(decT) * Math.cos(Ht));
  return {
    azimuth: azSouth,
    altitude: (altDeg + refractionDeg(altDeg)) * RAD,
    distance: g.distKm,
    parallacticAngle: q,
    geometricAltitude: altGeo,
  };
}

export interface MoonRiseSet {
  rise: Date | null;
  set: Date | null;
  /** 창 안에서 한 번도 지지 않음 / 한 번도 뜨지 않음 */
  alwaysUp: boolean;
  alwaysDown: boolean;
}

/**
 * `startMs` 부터 `hours` 시간 안의 첫 월출·월몰 — 달 **윗가장자리**가 겉보기 수평선에 닿는 순간
 * (겉보기 중심 고도 = −반지름). 시차·굴절은 위치 함수 그대로라 3D 하늘의 달과 같은 순간입니다.
 *
 * 10 분 걸음으로 부호가 바뀌는 곳을 찾고 이분법으로 1 초 아래까지 다듬습니다. `SunCalc.getMoonTimes` 는
 * 시차를 빼서 한 줄 근사(+0.133°)를 쓰고, 달 위치도 1~3° 틀려 월출이 몇 분 어긋났습니다.
 */
export function moonRiseSet(startMs: number, latDeg: number, lonDeg: number, hours = 24, elevM = 0): MoonRiseSet {
  const f = (ms: number) => {
    const p = getMoonPositionPrecise(new Date(ms), latDeg, lonDeg, elevM);
    return p.altitude / RAD + moonSemidiameterDeg(p.distance);
  };
  const STEP = 600e3;
  const end = startMs + hours * 3600e3;
  let rise: Date | null = null;
  let set: Date | null = null;
  let anyUp = false, anyDown = false;
  let tPrev = startMs;
  let fPrev = f(tPrev);
  if (fPrev > 0) anyUp = true; else anyDown = true;
  while (tPrev < end && (!rise || !set)) {
    const tNext = Math.min(end, tPrev + STEP);
    const fNext = f(tNext);
    if (fNext > 0) anyUp = true; else anyDown = true;
    if ((fPrev <= 0) !== (fNext <= 0)) {
      let lo = tPrev, hi = tNext;
      const risingHere = fPrev <= 0;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        const up = f(mid) > 0;
        if (up === risingHere) hi = mid; else lo = mid;
      }
      const when = new Date((lo + hi) / 2);
      if (risingHere) { if (!rise) rise = when; } else if (!set) set = when;
    }
    tPrev = tNext;
    fPrev = fNext;
  }
  return { rise, set, alwaysUp: anyUp && !anyDown, alwaysDown: anyDown && !anyUp };
}
