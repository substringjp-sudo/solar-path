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




