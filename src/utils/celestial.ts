import SunCalc from 'suncalc';
import { addHours, startOfDay, addDays } from 'date-fns';
import { sunEquatorial, sunPosition, sunTimes } from './solarPosition';
import { getGMSTDeg } from './celestialCoords';

export interface CelestialPosition {
  azimuth: number;
  altitude: number;
}

export interface PathPoint extends CelestialPosition {
  time: Date;
}

export interface CelestialEvents {
  sunrise: Date;
  sunset: Date;
  goldenHour: Date;
  moonrise: Date | null;
  moonset: Date | null;
}

export const getSunPosition = (date: Date, lat: number, lng: number): CelestialPosition => {
  const pos = sunPosition(date, lat, lng);
  return {
    azimuth: (pos.azimuth * 180) / Math.PI + 180, // Convert to 0-360 starting from North
    altitude: (pos.altitude * 180) / Math.PI,
  };
};

export const getMoonPosition = (date: Date, lat: number, lng: number): CelestialPosition => {
  const pos = SunCalc.getMoonPosition(date, lat, lng);
  return {
    azimuth: (pos.azimuth * 180) / Math.PI + 180,
    altitude: (pos.altitude * 180) / Math.PI,
  };
};

export const getCelestialEvents = (date: Date, lat: number, lng: number): CelestialEvents => {
  // 기준 날짜(date) 당일의 일출, 일몰, 월출, 월몰 물리 시각을 기기 시스템 시간대로 구합니다.
  // (이후 사용부에서 현지 법정 오프셋을 적용해 포맷팅합니다.)
  const times = sunTimes(date, lat, lng);
  const moonTimes = SunCalc.getMoonTimes(date, lat, lng);
  
  return {
    sunrise: times.sunrise,
    sunset: times.sunset,
    goldenHour: times.goldenHour,
    moonrise: moonTimes.rise || null,
    moonset: moonTimes.set || null,
  };
};

export const getSunPath = (date: Date, lat: number, lng: number): PathPoint[] => {
  const dayStart = startOfDay(date);
  const points: PathPoint[] = [];
  
  for (let i = 0; i <= 24; i += 0.5) {
    const time = addHours(dayStart, i);
    const pos = getSunPosition(time, lat, lng);
    points.push({ ...pos, time });
  }
  
  return points;
};

export const getMoonPath = (date: Date, lat: number, lng: number): PathPoint[] => {
  const dayStart = startOfDay(date);
  const points: PathPoint[] = [];
  
  for (let i = 0; i <= 24; i += 1) {
    const time = addHours(dayStart, i);
    const pos = getMoonPosition(time, lat, lng);
    points.push({ ...pos, time });
  }
  
  return points;
};

export interface IsochronePoint {
  latitude: number;
  longitude: number;
}

export interface IsochroneLine {
  timeLabel: string; // "HH:MM" (local time for standard display or UTC based)
  points: IsochronePoint[];
  type: 'sunrise' | 'sunset';
}

/**
 * 태양 적위(declination)와 균시차(equation of time) — `solarPosition.ts` 가 냅니다.
 *
 * 직하점·명암 경계(지도)와 3D 하늘이 **같은 태양력**을 써야 지도의 일몰선과 하늘의
 * 일몰이 갈라지지 않습니다. 예전에는 여기 NOAA 저정밀 식이 따로 있었고(적위 0.003°,
 * 균시차 3초 차), 하늘은 SunCalc(0.2° 차)이었습니다.
 *
 * (그 식의 황도경사각이 하루마다 줄던 결함 — 2026년이면 22.17° — 은
 * `verify-solar-geometry.js` 가 잡았고, 지금 식은 세기당 감소율을 씁니다.)
 */
export const getSunDeclinationAndEquationOfTime = (date: Date): { declination: number; equationOfTimeMinutes: number } =>
  sunEquatorial(date);

/**
 * 태양의 남중점(subsolar point, 태양이 정확히 머리 위에 있는 지표 좌표)을 계산합니다.
 */
export const getSubsolarPoint = (date: Date): IsochronePoint => {
  const { declination, equationOfTimeMinutes } = getSunDeclinationAndEquationOfTime(date);
  const hourDecimal = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600 + date.getUTCMilliseconds() / 3600000;
  const latitude = declination * (180 / Math.PI);
  let longitude = -15 * (hourDecimal - 12 + equationOfTimeMinutes / 60);
  longitude = ((longitude + 180) % 360 + 360) % 360 - 180;
  return { latitude, longitude };
};

/**
 * 달의 직하점(sublunar point) — 달이 바로 머리 위에 있는 지표 좌표.
 *
 * 3D 하늘의 달(`SunCalc.getMoonPosition`)과 **같은 저정밀 월령식**(SunCalc moonCoords: 평균 황경·근점이각·
 * 승교점 이각)으로 적경·적위를 내고, 그리니치 항성시를 빼서 경도로 바꿉니다. 지구본의 달 위치가 하늘의
 * 달과 갈라지지 않게 같은 식을 씁니다(차이 ≲ 0.5°, 지구본에서는 화소 한두 칸).
 */
export const getSublunarPoint = (date: Date): IsochronePoint => {
  const RAD = Math.PI / 180;
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545;   // J2000 기준 일수
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.229350 * d);
  const l = L + RAD * 6.289 * Math.sin(M);   // 황경
  const b = RAD * 5.128 * Math.sin(F);       // 황위
  const e = RAD * 23.4397;                   // 황도경사
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  let longitude = ra / RAD - getGMSTDeg(date);
  longitude = ((longitude + 180) % 360 + 360) % 360 - 180;
  return { latitude: dec / RAD, longitude };
};

/**
 * 달 위상 — 밝은 부분 비율(0 삭 ~ 1 망)과 차오르는지(상현 쪽). 3D 하늘의 달과 같은 SunCalc 값.
 */
export const getMoonPhase = (date: Date): { fraction: number; waxing: boolean } => {
  const m = SunCalc.getMoonIllumination(date);
  return { fraction: m.fraction, waxing: m.phase < 0.5 };
};

/**
 * 연속된 [경도, 위도] 좌표열을 날짜변경선(경도 ±180°) 교차 지점에서 여러 구간으로 분리합니다.
 * react-native-maps의 Polyline은 좌표 사이를 직선으로 잇기 때문에, 분리하지 않으면
 * 지도 반대편까지 선이 가로질러 그려지는 문제가 발생합니다.
 */
const splitAtAntimeridian = (points: [number, number][]): IsochronePoint[][] => {
  const segments: IsochronePoint[][] = [];
  let current: IsochronePoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const [longitude, latitude] = points[i];
    
    // 위도가 ±85도 이상인 극지방 영역은 2D 평면 지도 외곽 찢어짐(Stretching) 및 꼬임선 차단을 위해 제외합니다.
    if (Math.abs(latitude) >= 85) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }

    // 날짜변경선(경도 ±180도) 부근 경계면 1.5도 이내는 지도 꼬임 선 버그 차단을 위해 스킵하며 세그먼트를 분리합니다.
    if (Math.abs(longitude) >= 178.5) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    // 극지방 및 대권 경계 분할 지점에서 위경도가 도약할 때(진짜 날짜변경선 교차 혹은 좌표 꼬임),
    // 30도 이상의 급격한 경도 차이를 감지하여 횡단하는 가로지르기 꼬임선을 분리합니다.
    if (i > 0 && Math.abs(longitude - points[i - 1][0]) > 30) {
      if (current.length > 0) segments.push(current);
      current = [];
    }
    current.push({ latitude, longitude });
  }
  if (current.length > 0) segments.push(current);
  return segments;
};

/**
 * 특정 시각(date)에 대해 전 지구를 가로지르는 일출선/일몰선(태양 천정각 기준 등시선)을 계산합니다.
 * zenithAngleDeg: 90(기하학적 수평선, 기본값), 90.833(대기굴절 보정 실제 일출/일몰), 96/102/108(박명 단계) 등.
 * 반환값은 날짜변경선에서 분리된 여러 개의 좌표 구간(segments) 배열입니다.
 */
export const getTerminatorSegments = (date: Date, zenithAngleDeg: number = 90): { sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] } => {
  const { declination } = getSunDeclinationAndEquationOfTime(date);
  const { latitude: subsolarLat, longitude: subsolarLon } = getSubsolarPoint(date);

  const lat_s = subsolarLat * (Math.PI / 180);
  const lon_s = subsolarLon * (Math.PI / 180);
  const zenithRad = zenithAngleDeg * (Math.PI / 180);
  const phi_prime = Math.PI / 2 - zenithRad;

  const sunrisePoints: [number, number][] = [];
  const sunsetPoints: [number, number][] = [];
  const STEPS = 180;
  const sin_phi_prime = Math.sin(phi_prime);
  const cos_phi_prime = Math.cos(phi_prime);
  const sin_lat_s = Math.sin(lat_s);
  const cos_lat_s = Math.cos(lat_s);

  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * 2 * Math.PI;
    const sin_phi = sin_phi_prime * sin_lat_s + cos_phi_prime * cos_lat_s * Math.cos(t);
    const clamped_sin = Math.max(-1, Math.min(1, sin_phi));
    const lat = Math.asin(clamped_sin);

    const y = cos_phi_prime * Math.sin(t);
    const x = sin_phi_prime * cos_lat_s - cos_phi_prime * sin_lat_s * Math.cos(t);
    const lon = lon_s + Math.atan2(y, x);

    const lonDeg = ((lon * (180 / Math.PI) + 180) % 360 + 360) % 360 - 180;
    const latDeg = lat * (180 / Math.PI);

    let lonDiff = lonDeg - subsolarLon;
    lonDiff = ((lonDiff + 180) % 360 + 360) % 360 - 180;

    if (lonDiff < 0) {
      sunrisePoints.push([lonDeg, latDeg]);
    } else {
      sunsetPoints.push([lonDeg, latDeg]);
    }
  }

  return {
    sunrise: splitAtAntimeridian(sunrisePoints),
    sunset: splitAtAntimeridian(sunsetPoints),
  };
};

export interface SeasonMarkers {
  springEquinox: Date;
  summerSolstice: Date;
  autumnEquinox: Date;
  winterSolstice: Date;
}

/**
 * 주어진 연도의 춘분/하지/추분/동지 날짜를 태양 적위 변화를 스캔하여 계산합니다.
 * (일 단위 정밀도로 충분 - 슬라이더 마커 표시 용도)
 */
export const getSeasonMarkers = (year: number): SeasonMarkers => {
  let summerSolstice = new Date(Date.UTC(year, 5, 21, 12, 0, 0));
  let winterSolstice = new Date(Date.UTC(year, 11, 21, 12, 0, 0));
  let springEquinox = new Date(Date.UTC(year, 2, 20, 12, 0, 0));
  let autumnEquinox = new Date(Date.UTC(year, 8, 22, 12, 0, 0));

  let maxDecl = -Infinity;
  let minDecl = Infinity;
  let prevDecl: number | null = null;
  let prevDate: Date | null = null;

  for (let day = 1; day <= 366; day++) {
    const date = new Date(Date.UTC(year, 0, day, 12, 0, 0));
    if (date.getUTCFullYear() !== year) break;

    const { declination } = getSunDeclinationAndEquationOfTime(date);
    if (declination > maxDecl) {
      maxDecl = declination;
      summerSolstice = date;
    }
    if (declination < minDecl) {
      minDecl = declination;
      winterSolstice = date;
    }
    if (prevDecl !== null && prevDate !== null) {
      if (prevDecl < 0 && declination >= 0) springEquinox = date;
      if (prevDecl > 0 && declination <= 0) autumnEquinox = date;
    }
    prevDecl = declination;
    prevDate = date;
  }

  return { springEquinox, summerSolstice, autumnEquinox, winterSolstice };
};

