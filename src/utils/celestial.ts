import SunCalc from 'suncalc';
import { addHours, startOfDay, addDays } from 'date-fns';

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
  const pos = SunCalc.getPosition(date, lat, lng);
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
  const sunTimes = SunCalc.getTimes(date, lat, lng);
  const moonTimes = SunCalc.getMoonTimes(date, lat, lng);
  
  return {
    sunrise: sunTimes.sunrise,
    sunset: sunTimes.sunset,
    goldenHour: sunTimes.goldenHour,
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

export const getIsochroneInterval = (zoom: number): number => {
  if (zoom >= 10) return 5;
  if (zoom >= 8) return 10;
  if (zoom >= 6) return 15;
  return 30;
};

/**
 * 태양 적위(declination)와 균시차(equation of time)를 계산합니다.
 * NOAA 저정밀도 태양 위치 알고리즘(J2000 기준일) 기반.
 */
const daysSinceJ2000 = (date: Date): number => {
  const j2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
  return (date.getTime() - j2000) / 86400000;
};

export const getSunDeclinationAndEquationOfTime = (date: Date): { declination: number; equationOfTimeMinutes: number } => {
  const d = daysSinceJ2000(date);
  const meanAnomaly = (357.5291 + 0.98560028 * d) * (Math.PI / 180);
  const meanLongitude = (280.4665 + 0.98564736 * d) * (Math.PI / 180);
  const eclipticLongitude = meanLongitude + (1.9146 * Math.sin(meanAnomaly) + 0.01999 * Math.sin(2 * meanAnomaly)) * (Math.PI / 180);
  const obliquity = (23.439291 - 0.000130043 * d) * (Math.PI / 180);
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));

  const y = Math.sin(eclipticLongitude) * Math.cos(obliquity);
  const x = Math.cos(eclipticLongitude);
  let rightAscension = Math.atan2(y, x);
  if (rightAscension < 0) rightAscension += 2 * Math.PI;

  let equationOfTimeMinutes = (meanLongitude - rightAscension) * (180 / Math.PI) * 4;
  while (equationOfTimeMinutes < -20) equationOfTimeMinutes += 1440;
  while (equationOfTimeMinutes > 20) equationOfTimeMinutes -= 1440;

  return { declination, equationOfTimeMinutes };
};

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



