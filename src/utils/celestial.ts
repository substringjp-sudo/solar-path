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

// Generates sunrise or sunset isochrones for the given date.
// We scan latitudes from -65 to 65.
// For each latitude, we calculate the UTC time of sunrise/sunset at longitude 0.
// Then for each target time (e.g. 06:00, 06:10, etc.), we solve for the longitude that yields that exact event time.
export const getCelestialIsochrones = (
  date: Date,
  type: 'sunrise' | 'sunset',
  zoom: number,
  timezoneOffsetMinutes: number = new Date().getTimezoneOffset()
): IsochroneLine[] => {
  const interval = getIsochroneInterval(zoom);
  const lines: { [key: number]: IsochronePoint[] } = {};
  
  // Latitudes from -65 to 65 with 3 degree step
  const lats: number[] = [];
  for (let lat = -65; lat <= 65; lat += 3) {
    lats.push(lat);
  }

  // Target minutes within a day (0 to 1439), in steps of 'interval'
  const targets: number[] = [];
  for (let min = 0; min < 1440; min += interval) {
    targets.push(min);
    lines[min] = [];
  }

  const baseDate = startOfDay(date);

  for (const lat of lats) {
    // 1. Get times at longitude 0 to use as base
    const times = SunCalc.getTimes(baseDate, lat, 0);
    const eventDate = type === 'sunrise' ? times.sunrise : times.sunset;
    
    // Check for polar night/day
    if (!eventDate || isNaN(eventDate.getTime())) {
      continue;
    }

    // Event time in UTC minutes from the start of the UTC day
    const eventUtcStartOfDay = new Date(Date.UTC(
      eventDate.getUTCFullYear(),
      eventDate.getUTCMonth(),
      eventDate.getUTCDate()
    ));
    const eventUtcMinutes = (eventDate.getTime() - eventUtcStartOfDay.getTime()) / 60000;

    for (const targetMin of targets) {
      // We want the local time at the target longitude to be 'targetMin' minutes from the local start of day.
      // Local Time = UTC Time + (Longitude / 15) hours = UTC Time - timezoneOffsetMinutes + (Longitude / 15) * 60 (approx)
      // Actually, since SunCalc operates on UTC, the event occurs when:
      // UTC_event(lng) = UTC_event(0) - lng * 4 minutes.
      // So at longitude 'lng', the UTC time of the event is: UTC_time = eventUtcMinutes - lng * 4.
      // We want this event to happen at local time representing 'targetMin' minutes of the day.
      // Local_time = UTC_time - timezoneOffsetMinutes.
      // Therefore, targetMin = (eventUtcMinutes - lng * 4) - timezoneOffsetMinutes
      // Solving for lng:
      // lng * 4 = eventUtcMinutes - timezoneOffsetMinutes - targetMin
      // lng = (eventUtcMinutes - timezoneOffsetMinutes - targetMin) / 4
      
      let lng = (eventUtcMinutes - timezoneOffsetMinutes - targetMin) / 4;
      
      // Normalize longitude to [-180, 180]
      lng = ((lng + 180) % 360 + 360) % 360 - 180;
      
      lines[targetMin].push({ latitude: lat, longitude: lng });
    }
  }

  // Format into IsochroneLine array, sorted by longitude to avoid drawing zig-zag lines
  return targets.map(min => {
    const hh = String(Math.floor(min / 60)).padStart(2, '0');
    const mm = String(min % 60).padStart(2, '0');
    
    // Sort points by longitude so Leaflet draws a continuous north-south style line
    const points = lines[min].sort((a, b) => a.latitude - b.latitude);
    
    return {
      timeLabel: `${hh}:${mm}`,
      points,
      type
    };
  }).filter(line => line.points.length > 1);
};

