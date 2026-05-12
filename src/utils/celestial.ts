import SunCalc from 'suncalc';
import { addHours, startOfDay } from 'date-fns';

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
