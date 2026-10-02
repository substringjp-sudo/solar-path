/**
 * **해의 위치와 출몰 시각** — 앱 전체가 쓰는 태양력은 이것 하나입니다.
 *
 * ## 왜 SunCalc 을 걷어냈나
 *
 * SunCalc 1.9.0 의 해는 **0.2° 높게** 떠 있었습니다. 2026-10-02 17:31 JST
 * 후쿠이(36.02 N, 136.29 E)에서 SunCalc 은 기하 고도 0.73° 를, PyEphem 은
 * 0.53° 를 냅니다. 원인은 두 가지입니다.
 *
 *  - **근일점 세차가 빠져 있습니다.** 황경을 `M + 102.9372° + 180°` 로 내면서
 *    평균근점이각 M 의 속도(0.98560028°/일)를 그대로 써, 근일점이 해마다 0.017°
 *    씩 도는 것을 놓칩니다. J2000 에서 26년이면 황경이 **0.46°** 밀리고,
 *    분점 무렵 적위가 0.18° 어긋납니다.
 *  - **항성시 상수**가 280.16° 입니다(IAU 280.46°).
 *
 * 그리고 **SunCalc 의 두 함수가 서로 맞지 않습니다.** `getTimes` 는 정오의
 * 적위 하나로 출몰을 대칭으로 풀고, `getPosition` 은 순간의 위치를 냅니다.
 * 같은 날 후쿠이에서 `getTimes` 의 일몰은 `getPosition` 이 −0.833° 를 지나는
 * 시각보다 **72초 늦습니다.** 3D 해와 앱이 알리는 일몰이 처음부터 갈라져
 * 있었던 셈입니다(참 일몰은 그보다 58초 더 이릅니다 — 합쳐 2분 12초).
 *
 * ## 무엇을 쓰나
 *
 * NOAA 태양 계산기의 일반식(Meeus, *Astronomical Algorithms* 25장 저정밀판)
 * 입니다. 2026년 다섯 곳 × 다섯 날 × 여덟 시각 200표본에서 PyEphem 과 고도
 * **0.006°**, 방위 0.012° 안입니다(SunCalc 은 0.215°). 대조는
 * `tools/shader-preview/verify-solar-position.js` 가 PyEphem 표에 대고 합니다.
 *
 * ## 출몰은 **같은 위치 함수의 근**으로 냅니다
 *
 * 일몰을 따로 닫힌 식으로 풀면 위치 함수와 또 갈라집니다. 그래서 `sunPosition`
 * 이 그 고도를 지나는 순간을 이분법으로 찾습니다. 그러면 앱이 알리는 일몰과
 * 3D 해의 일몰이 **정의상** 같은 순간이 됩니다.
 *
 * 반환 모양은 SunCalc 과 같습니다(라디안, 방위는 남 0 · 서 +). 바꾼 자리에서
 * 변환식을 그대로 둘 수 있게 하려는 것입니다. 달은 그대로 SunCalc 이 맡습니다.
 *
 * ⚠ 고도는 **기하 고도**입니다(대기 굴절 없음). 굴절은 그리는 쪽이 필요한
 * 자리에서 `sunsetPhysics.getApparentAltitude` 로 더합니다. 출몰 시각의
 * −0.833° 가 굴절 34′ 와 시반경 16′ 을 이미 담고 있습니다.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440587.5;
const J2000 = 2451545;

/** 해의 적도 좌표 일부 — 지도(직하점·명암 경계)와 하늘이 같은 값을 씁니다. */
export interface SunEquatorial {
  /** 적위 (rad) */
  declination: number;
  /** 균시차 (분). 겉보기 태양시 − 평균 태양시. */
  equationOfTimeMinutes: number;
}

/** SunCalc.getPosition 과 같은 모양. */
export interface SunPosition {
  /** 기하 고도 (rad) */
  altitude: number;
  /** 방위 (rad), 남 0 · 서 + — 북 기준 도로 바꾸려면 `× 180/π + 180`. */
  azimuth: number;
}

/** SunCalc.getTimes 와 같은 키. 그날 그 고도를 안 지나면 `Invalid Date` 입니다. */
export interface SunTimes {
  solarNoon: Date;
  nadir: Date;
  sunrise: Date;
  sunset: Date;
  sunriseEnd: Date;
  sunsetStart: Date;
  dawn: Date;
  dusk: Date;
  nauticalDawn: Date;
  nauticalDusk: Date;
  nightEnd: Date;
  night: Date;
  goldenHourEnd: Date;
  goldenHour: Date;
}

/** [고도(도), 아침 키, 저녁 키] — SunCalc.times 와 같은 표입니다. */
const EVENTS: ReadonlyArray<readonly [number, keyof SunTimes, keyof SunTimes]> = [
  [-0.833, 'sunrise', 'sunset'],
  [-0.3, 'sunriseEnd', 'sunsetStart'],
  [-6, 'dawn', 'dusk'],
  [-12, 'nauticalDawn', 'nauticalDusk'],
  [-18, 'nightEnd', 'night'],
  [6, 'goldenHourEnd', 'goldenHour'],
];

const julian = (ms: number) => ms / DAY_MS + J1970;

/** 적위·균시차. NOAA 일반식 — 시각은 UT 로 받습니다(ΔT 69초가 황경에 주는 0.0008° 는 버립니다). */
export function sunEquatorial(date: Date): SunEquatorial {
  return equatorialAt(date.getTime());
}

function equatorialAt(ms: number): SunEquatorial {
  const T = (julian(ms) - J2000) / 36525;
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  // 겉보기 황경 — 광행차(−20.5″)와 장동을 넣습니다.
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps * RAD) / 2) ** 2;
  const eotRad =
    y * Math.sin(2 * L0 * RAD) -
    2 * e * Math.sin(M * RAD) +
    4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
    0.5 * y * y * Math.sin(4 * L0 * RAD) -
    1.25 * e * e * Math.sin(2 * M * RAD);
  return { declination, equationOfTimeMinutes: (4 * eotRad) / RAD };
}

/** 시간각 (rad, −π~π). 남중 0, 오후 +. */
function hourAngleAt(ms: number, lng: number, eotMin: number): number {
  const utMin = (((ms / 60000) % 1440) + 1440) % 1440;
  const tst = (((utMin + eotMin + 4 * lng) % 1440) + 1440) % 1440;
  return (tst / 4 - 180) * RAD;
}

function positionAt(ms: number, lat: number, lng: number): SunPosition {
  const { declination: dec, equationOfTimeMinutes: eot } = equatorialAt(ms);
  const H = hourAngleAt(ms, lng, eot);
  const phi = lat * RAD;
  const altitude = Math.asin(
    Math.max(-1, Math.min(1, Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))),
  );
  const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { altitude, azimuth };
}

/** 해의 위치 — SunCalc.getPosition 자리에 그대로 들어갑니다. */
export function sunPosition(date: Date, lat: number, lng: number): SunPosition {
  return positionAt(date.getTime(), lat, lng);
}

/**
 * 그날의 남중 (ms).
 *
 * **어느 날인가**는 SunCalc 과 같이 고릅니다 — 넘긴 시각에서 가장 가까운
 * 그 경도의 정오. 알림·카메라가 "정오를 넘겨 그날을 고르는" 식으로 짜여 있어
 * 이 규칙이 바뀌면 하루가 밀립니다.
 */
function solarNoonMs(date: Date, lng: number): number {
  const J0 = 0.0009;
  const d = julian(date.getTime()) - J2000;
  const n = Math.round(d - J0 + lng / 360);
  let ms = (J2000 + J0 + n - lng / 360 - J1970) * DAY_MS;
  // 시간각이 0 인 순간으로 다듬습니다. 시간각은 태양일(86400초)에 한 바퀴 돌고, 균시차가
  // 하루에 30초 안쪽으로만 변해 세 번이면 충분합니다.
  for (let i = 0; i < 3; i++) {
    const H = hourAngleAt(ms, lng, equatorialAt(ms).equationOfTimeMinutes);
    ms -= (H / (2 * Math.PI)) * DAY_MS;
  }
  return ms;
}

/** 고도(rad)와 그 시간 변화율(rad/ms). 변화율은 적위가 반나절에 움직이는 몫(0.2° 안)을 버린 값입니다. */
function altitudeAndRate(ms: number, lat: number, lng: number): { alt: number; rate: number } {
  const { declination: dec, equationOfTimeMinutes: eot } = equatorialAt(ms);
  const H = hourAngleAt(ms, lng, eot);
  const phi = lat * RAD;
  const s = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, s)));
  const rate = (-Math.cos(phi) * Math.cos(dec) * Math.sin(H) * (2 * Math.PI / DAY_MS)) / Math.max(1e-9, Math.cos(alt));
  return { alt, rate };
}

/** 한 날의 공통 자리 — 남중과 양쪽 자정의 고도를 사건마다 다시 풀지 않게 묶습니다. */
interface DayFrame { noon: number; altNoon: number; altBefore: number; altAfter: number; dec: number }

function dayFrame(date: Date, lat: number, lng: number): DayFrame {
  const noon = solarNoonMs(date, lng);
  const half = DAY_MS / 2;
  return {
    noon,
    altNoon: positionAt(noon, lat, lng).altitude,
    altBefore: positionAt(noon - half, lat, lng).altitude,
    altAfter: positionAt(noon + half, lat, lng).altitude,
    dec: equatorialAt(noon).declination,
  };
}

/**
 * 고도 `altDeg` 를 지나는 순간 — 남중과 그 앞(`side` −1)·뒤(+1) 자정 사이에서 찾습니다.
 *
 * 닫힌 식(정오의 적위로 푼 시간각)에서 출발해 **위치 함수 자체**에 뉴턴으로 붙입니다.
 * 근은 위치 함수의 것이라 3D 해와 1 ms 안에서 같은 순간이고, 구간을 벗어나는 걸음은
 * 이분으로 받아 백야 문턱 근처처럼 변화율이 0 에 가까운 곳에서도 구간 밖으로 안 나갑니다.
 * 이분법만 쓰면 사건 하나에 위치를 33번 푸는데(`sunTimes` 한 번에 120 µs — 화면이 매번
 * 부릅니다), 이렇게 하면 서너 번입니다.
 */
function crossingMs(f: DayFrame, side: -1 | 1, lat: number, lng: number, altDeg: number): number {
  const h0 = altDeg * RAD;
  const half = DAY_MS / 2;
  let lo = side < 0 ? f.noon - half : f.noon;
  let hi = side < 0 ? f.noon : f.noon + half;
  let flo = (side < 0 ? f.altBefore : f.altNoon) - h0;
  const fhi = (side < 0 ? f.altNoon : f.altAfter) - h0;
  if (!(flo * fhi < 0)) return NaN;
  const phi = lat * RAD;
  const cosH = (Math.sin(h0) - Math.sin(phi) * Math.sin(f.dec)) / (Math.cos(phi) * Math.cos(f.dec));
  let t = Math.abs(cosH) <= 1
    ? f.noon + side * (Math.acos(cosH) / (2 * Math.PI)) * DAY_MS
    : (lo + hi) / 2;
  for (let i = 0; i < 60; i++) {
    const { alt, rate } = altitudeAndRate(t, lat, lng);
    const ft = alt - h0;
    if (ft * flo < 0) hi = t;
    else { lo = t; flo = ft; }
    let next = t - ft / rate;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - t) < 1) return next;
    t = next;
  }
  return t;
}

/** 관측 높이 h(m) 에서 수평선이 내려앉는 각 — SunCalc 의 `observerAngle` 과 같은 식(도). */
const observerAngleDeg = (heightM: number) => (-2.076 * Math.sqrt(Math.max(0, heightM))) / 60;

/**
 * 그날 해 중심이 `altDeg` 를 지나는 아침·저녁 순간.
 *
 * 알림의 블루아워(−4°)처럼 SunCalc 표에 없는 고도에 씁니다. 그날 그 고도를
 * 안 지나면(백야·극야) 둘 다 `Invalid Date` 입니다.
 */
export function sunCrossings(
  date: Date, lat: number, lng: number, altDeg: number, heightM: number = 0,
): { rise: Date; set: Date } {
  const f = dayFrame(date, lat, lng);
  const h = altDeg + observerAngleDeg(heightM);
  return {
    rise: new Date(crossingMs(f, -1, lat, lng, h)),
    set: new Date(crossingMs(f, 1, lat, lng, h)),
  };
}

/** 출몰·박명 시각 — SunCalc.getTimes 자리에 그대로 들어갑니다. */
export function sunTimes(date: Date, lat: number, lng: number, heightM: number = 0): SunTimes {
  const f = dayFrame(date, lat, lng);
  const dh = observerAngleDeg(heightM);
  const out = { solarNoon: new Date(f.noon), nadir: new Date(f.noon - DAY_MS / 2) } as SunTimes;
  for (const [alt, morning, evening] of EVENTS) {
    out[morning] = new Date(crossingMs(f, -1, lat, lng, alt + dh));
    out[evening] = new Date(crossingMs(f, 1, lat, lng, alt + dh));
  }
  return out;
}
