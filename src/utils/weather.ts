import { format } from 'date-fns';
import { getCelestialEvents, getSunPosition } from './celestial';

const EARTH_RADIUS_KM = 6371;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calculates the distance between two points in meters using the Haversine formula.
 */
export const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

import { CloudGenus, PressureLevelCloud, ClassifiedCloud, CloudPoint } from '../types/simulation';

export interface CloudData {
  low: number;
  mid: number;
  high: number;
  distance: number;
  /** Surface visibility in meters. Only populated for the observer point. */
  visibility?: number;
  /** 2 m relative humidity in percent. Only populated for the observer point. */
  humidity?: number;
  pressureLevels?: PressureLevelCloud[];
  classifiedClouds?: ClassifiedCloud[];
}

export interface WeatherPoint {
  latitude: number;
  longitude: number;
  distance: number;
  azimuthOffset: number;
}

/**
 * Calculates a new coordinate based on distance (km) and bearing (degrees) from a starting point.
 */
export const calculateDestination = (lat: number, lon: number, distance: number, bearing: number): { latitude: number; longitude: number } => {
  const ad = distance / EARTH_RADIUS_KM;
  const la1 = (lat * Math.PI) / 180;
  const lo1 = (lon * Math.PI) / 180;
  const br = (bearing * Math.PI) / 180;

  const la2 = Math.asin(Math.sin(la1) * Math.cos(ad) + Math.cos(la1) * Math.sin(ad) * Math.cos(br));
  const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(ad) * Math.cos(la1), Math.cos(ad) - Math.sin(la1) * Math.sin(la2));

  return {
    latitude: (la2 * 180) / Math.PI,
    longitude: (lo2 * 180) / Math.PI,
  };
};

export interface HourlyPressureLevelData {
  [key: string]: number[];
}

export interface HourlyCloudData {
  time: string[];
  /** time[] pre-parsed to epoch ms; kept in sync with `time` so interpolation
   *  doesn't have to re-parse on every slider tick. */
  timeMs: number[];
  low: number[];
  mid: number[];
  high: number[];
  visibility?: number[];
  humidity?: number[];
  pressureLevels?: HourlyPressureLevelData;
}

export interface CloudPathData {
  distance: number;
  azimuthOffset: number;
  hourly: HourlyCloudData;
  source: 'standard' | 'ultra-short'; // 'standard' (Global/Open-Meteo), 'ultra-short' (Regional High-res/Nowcast)
}

const weatherCache = new Map<string, CloudPathData[]>();

const selectModel = (lat: number, lon: number): string | undefined => {
  // Korea/Japan region → JMA MSM (5km resolution)
  if (lat >= 20 && lat <= 50 && lon >= 120 && lon <= 150) {
    return 'jma_msm';
  }
  return undefined;
};

export const fetchSunsetWeather = async (lat: number, lon: number, azimuth: number, date: Date = new Date()): Promise<CloudPathData[]> => {
  const dateStr = format(date, 'yyyy-MM-dd');
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + 1);
  const nextDateStr = format(nextDate, 'yyyy-MM-dd');

  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)},${azimuth.toFixed(1)},${dateStr}`;
  if (weatherCache.has(cacheKey)) {
    return weatherCache.get(cacheKey)!;
  }

  // 2D fan-grid sampling points
  const distances = [0, 80, 200, 350];
  const azimuthOffsets = [-15, -7.5, 0, 7.5, 15];
  
  const points: { dist: number; azOffset: number; latitude: number; longitude: number }[] = [];
  
  // 0km observer point
  points.push({ dist: 0, azOffset: 0, latitude: lat, longitude: lon });
  
  // 80km, 200km, 350km points (5 directions each)
  for (const dist of [80, 200, 350]) {
    for (const offset of azimuthOffsets) {
      const ptAz = (azimuth + offset + 360) % 360;
      const dest = calculateDestination(lat, lon, dist, ptAz);
      points.push({
        dist,
        azOffset: offset,
        latitude: dest.latitude,
        longitude: dest.longitude,
      });
    }
  }

  const lats = points.map(p => p.latitude.toFixed(5)).join(',');
  const lons = points.map(p => p.longitude.toFixed(5)).join(',');

  const pLevels = [1000, 925, 850, 700, 500, 300, 200];
  const ccVars = pLevels.map(p => `cloud_cover_${p}hPa`).join(',');
  const rhVars = pLevels.map(p => `relative_humidity_${p}hPa`).join(',');
  const tVars = pLevels.map(p => `temperature_${p}hPa`).join(',');
  const ghVars = pLevels.map(p => `geopotential_height_${p}hPa`).join(',');

  const hourlyParams = `cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m,${ccVars},${rhVars},${tVars},${ghVars}`;
  const model = selectModel(lat, lon);
  const modelParam = model ? `&models=${model}` : '';

  try {
    let response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
        `&hourly=${hourlyParams}` +
        `&timezone=auto&start_date=${dateStr}&end_date=${nextDateStr}${modelParam}`
    );

    let data;
    if (!response.ok) {
      console.warn(`Failed to fetch with model ${model || 'default'}. Falling back to default model.`);
      response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
          `&hourly=${hourlyParams}` +
          `&timezone=auto&start_date=${dateStr}&end_date=${nextDateStr}`
      );
      data = await response.json();
    } else {
      data = await response.json();
      // Verify if pressure level variables actually exist (JMA MSM might lack some fields)
      const testRes = Array.isArray(data) ? data[0] : data;
      if (!testRes || !testRes.hourly || !testRes.hourly.cloud_cover_500hPa) {
        console.warn(`Required pressure level fields missing in ${model} response. Falling back to default.`);
        response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
            `&hourly=${hourlyParams}` +
            `&timezone=auto&start_date=${dateStr}&end_date=${nextDateStr}`
        );
        data = await response.json();
      }
    }

    const results = Array.isArray(data) ? data : [data];

    const fetched: CloudPathData[] = points.map((p, i) => {
      const res = results[i];

      if (!res || !res.hourly) {
        console.warn(`Weather data missing for point ${i} (${p.dist}km). Using clear sky fallback.`);
        const fallbackTime: string[] = results[0]?.hourly?.time || [];
        return {
          distance: p.dist,
          azimuthOffset: p.azOffset,
          hourly: {
            time: fallbackTime,
            timeMs: fallbackTime.map(t => new Date(t).getTime()),
            low: Array(24).fill(0),
            mid: Array(24).fill(0),
            high: Array(24).fill(0),
          },
          source: 'standard',
        };
      }

      const time: string[] = res.hourly.time;
      
      const pressureLevels: HourlyPressureLevelData = {};
      pLevels.forEach(press => {
        const ccKey = `cloud_cover_${press}hPa`;
        const tempKey = `temperature_${press}hPa`;
        const rhKey = `relative_humidity_${press}hPa`;
        const ghKey = `geopotential_height_${press}hPa`;
        
        if (Array.isArray(res.hourly[ccKey])) pressureLevels[ccKey] = res.hourly[ccKey];
        if (Array.isArray(res.hourly[tempKey])) pressureLevels[tempKey] = res.hourly[tempKey];
        if (Array.isArray(res.hourly[rhKey])) pressureLevels[rhKey] = res.hourly[rhKey];
        if (Array.isArray(res.hourly[ghKey])) pressureLevels[ghKey] = res.hourly[ghKey];
      });

      const hourly: HourlyCloudData = {
        time,
        timeMs: time.map((t: string) => new Date(t).getTime()),
        low: res.hourly.cloud_cover_low,
        mid: res.hourly.cloud_cover_mid,
        high: res.hourly.cloud_cover_high,
        pressureLevels,
      };

      if (i === 0) {
        if (Array.isArray(res.hourly.visibility)) hourly.visibility = res.hourly.visibility;
        if (Array.isArray(res.hourly.relative_humidity_2m)) hourly.humidity = res.hourly.relative_humidity_2m;
      }

      return {
        distance: p.dist,
        azimuthOffset: p.azOffset,
        hourly,
        source: 'standard',
      };
    });

    weatherCache.set(cacheKey, fetched);
    return fetched;
  } catch (error) {
    console.error("Failed to fetch weather data:", error);
    return [];
  }
};

/**
 * ISCCP-based cloud classification algorithm
 */
export const classifyClouds = (levels: PressureLevelCloud[]): ClassifiedCloud[] => {
  const result: ClassifiedCloud[] = [];

  // 1. Detect vertical deep convective clouds (Cumulonimbus)
  // Cumulonimbus covers low, mid, and high levels continuously
  const hasLow = levels.some(l => l.pressure >= 850 && l.cloudCover > 25);
  const hasMid = levels.some(l => l.pressure >= 500 && l.pressure <= 700 && l.cloudCover > 25);
  const hasHigh = levels.some(l => l.pressure <= 300 && l.cloudCover > 25);

  const isCumulonimbus = hasLow && hasMid && hasHigh;

  if (isCumulonimbus) {
    const activeLevels = levels.filter(l => l.cloudCover > 20);
    if (activeLevels.length > 0) {
      const baseAlt = Math.min(...activeLevels.map(l => l.altitudeKm));
      const topAlt = Math.max(...activeLevels.map(l => l.altitudeKm));
      const maxCoverage = Math.max(...activeLevels.map(l => l.cloudCover)) / 100;
      
      result.push({
        genus: 'cumulonimbus',
        baseAltKm: baseAlt,
        topAltKm: topAlt,
        opticalThickness: 90, // Cumulonimbus is extremely thick (heavy sunlight blockage)
        coverage: maxCoverage,
        isIce: activeLevels.some(l => l.temperature < -40),
      });
    }
  }

  // 2. Classify individual levels
  levels.forEach(level => {
    if (level.cloudCover <= 15) return; // Ignore very thin/scattered layers
    
    // Skip if it was already incorporated into a Cumulonimbus
    if (isCumulonimbus && level.cloudCover > 25) return;

    const p = level.pressure;
    const hum = level.humidity;
    const cov = level.cloudCover / 100;
    
    // Estimate optical thickness based on coverage and humidity
    const optThickness = Math.min(100, Math.max(5, cov * 100 * (hum / 100)));
    const isIce = level.temperature < -40;

    let genus: CloudGenus = 'clear';
    let baseAlt = level.altitudeKm - 0.25;
    let topAlt = level.altitudeKm + 0.25;

    if (p <= 440) {
      // High clouds (< 440 hPa)
      if (optThickness < 30) {
        genus = 'cirrus';
      } else {
        genus = 'cirrostratus';
      }
    } else if (p > 440 && p <= 700) {
      // Mid clouds (440 - 700 hPa)
      if (optThickness < 45) {
        genus = 'altocumulus';
      } else {
        genus = 'altostratus';
      }
    } else {
      // Low clouds (> 700 hPa)
      if (optThickness < 30) {
        genus = 'cumulus';
      } else if (optThickness < 65) {
        genus = 'stratocumulus';
      } else {
        genus = 'stratus';
      }
    }

    result.push({
      genus,
      baseAltKm: Math.max(0.1, baseAlt),
      topAltKm: topAlt,
      opticalThickness: Math.round(optThickness),
      coverage: cov,
      isIce,
    });
  });

  return result;
};

/**
 * Interpolates hourly weather data for a specific time.
 */
export const getInterpolatedWeather = (pathData: CloudPathData[], targetTime: Date): CloudData[] => {
  if (!pathData || !Array.isArray(pathData)) return [];

  const targetMs = targetTime.getTime();
  return pathData.map(p => {
    if (!p?.hourly?.time || !p?.hourly?.high || !p?.hourly?.low) {
      return { high: 0, mid: 0, low: 0, distance: p.distance || 0 };
    }
    const times = p.hourly.timeMs ?? p.hourly.time.map(t => new Date(t).getTime());

    if (times.length === 0) {
      return { distance: p.distance || 0, low: 0, mid: 0, high: 0 };
    }

    // Find the two nearest hours
    let i = 0;
    while (i < times.length - 1 && times[i + 1] < targetMs) i++;

    const t1 = times[i];
    const t2 = times[i + 1] || t1 + 3600000;
    const ratio = Math.max(0, Math.min(1, (targetMs - t1) / (t2 - t1)));

    const interpolate = (v1: number, v2: number) => v1 + (v2 - v1) * ratio;
    const interpolateOpt = (arr?: number[]): number | undefined => {
      if (!arr) return undefined;
      const a = arr[i];
      const b = arr[i + 1] ?? a;
      if (a == null) return undefined;
      return interpolate(a, b);
    };

    const low = interpolate(p.hourly.low[i], p.hourly.low[i+1] ?? p.hourly.low[i]);
    const mid = interpolate(p.hourly.mid[i], p.hourly.mid[i+1] ?? p.hourly.mid[i]);
    const high = interpolate(p.hourly.high[i], p.hourly.high[i+1] ?? p.hourly.high[i]);

    // Interpolate pressure level parameters
    const pressureLevels: PressureLevelCloud[] = [];
    const pLevels = [1000, 925, 850, 700, 500, 300, 200];
    
    if (p.hourly.pressureLevels) {
      pLevels.forEach(press => {
        const ccKey = `cloud_cover_${press}hPa`;
        const tempKey = `temperature_${press}hPa`;
        const rhKey = `relative_humidity_${press}hPa`;
        const ghKey = `geopotential_height_${press}hPa`;
        
        const cc = interpolateOpt(p.hourly.pressureLevels![ccKey]) ?? 0;
        const temp = interpolateOpt(p.hourly.pressureLevels![tempKey]) ?? 0;
        const rh = interpolateOpt(p.hourly.pressureLevels![rhKey]) ?? 0;
        
        // Approximate geopotential height in meters if missing
        const standardHeightMap: Record<number, number> = {
          1000: 100, 925: 750, 850: 1500, 700: 3000, 500: 5500, 300: 9000, 200: 12000
        };
        const gh = interpolateOpt(p.hourly.pressureLevels![ghKey]) ?? standardHeightMap[press];
        
        pressureLevels.push({
          pressure: press,
          altitudeKm: gh / 1000,
          cloudCover: cc,
          humidity: rh,
          temperature: temp,
        });
      });
    }

    // Classify clouds or fallback to basic 3-layer estimation
    let classifiedClouds: ClassifiedCloud[] = [];
    if (pressureLevels.length > 0) {
      classifiedClouds = classifyClouds(pressureLevels);
    } else {
      if (high > 15) {
        classifiedClouds.push({
          genus: 'cirrus',
          baseAltKm: 8.0,
          topAltKm: 10.0,
          opticalThickness: Math.round(high * 0.2),
          coverage: high / 100,
          isIce: true,
        });
      }
      if (mid > 15) {
        classifiedClouds.push({
          genus: 'altocumulus',
          baseAltKm: 3.5,
          topAltKm: 5.0,
          opticalThickness: Math.round(mid * 0.5),
          coverage: mid / 100,
          isIce: false,
        });
      }
      if (low > 15) {
        classifiedClouds.push({
          genus: 'stratocumulus',
          baseAltKm: 1.0,
          topAltKm: 2.5,
          opticalThickness: Math.round(low * 0.7),
          coverage: low / 100,
          isIce: false,
        });
      }
    }

    return {
      distance: p.distance,
      low,
      mid,
      high,
      visibility: interpolateOpt(p.hourly.visibility),
      humidity: interpolateOpt(p.hourly.humidity),
      pressureLevels,
      classifiedClouds,
      // Pass azimuthOffset along to reconstruction stage
      ...({ azimuthOffset: p.azimuthOffset } as any),
    };
  });
};

export interface TerrainData {
  panoramicAngles: number[]; // Max of all distances (near/mid/far)
  farAngles: number[];       // Only distant mountains (15km, 40km)
  minAz: number;
  maxAz: number;
  avgAngle: number;
}

const terrainCache = new Map<string, TerrainData>();

/**
 * Fetches a panoramic skyline by sampling multiple azimuths around the target.
 */
export const fetchTerrainProfile = async (
  lat: number, 
  lon: number, 
  minAz: number, 
  maxAz: number,
  onProgress?: (msg: string) => void
): Promise<TerrainData> => {
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)},${minAz},${maxAz}`;
  if (terrainCache.has(cacheKey)) {
    return terrainCache.get(cacheKey)!;
  }

  const SAMPLES = 61; // 6 degree resolution (Total 183 points with 3 distances)
  const DISTANCES = [5, 15, 40]; 
  
  const range = maxAz - minAz;
  const azimuths = Array.from({ length: SAMPLES }, (_, i) => 
    (minAz + (i * range) / (SAMPLES - 1) + 360) % 360
  );

  const points: { lat: number; lon: number; dist: number; az: number }[] = [];
  azimuths.forEach(az => {
    DISTANCES.forEach(dist => {
      const dest = calculateDestination(lat, lon, dist, az);
      points.push({ lat: dest.latitude, lon: dest.longitude, dist, az });
    });
  });

  const CHUNK_SIZE = 30; // Further reduced to safely avoid 414 Request-URI Too Large
  const chunkedPoints: typeof points[] = [];
  for (let i = 0; i < points.length; i += CHUNK_SIZE) {
    chunkedPoints.push(points.slice(i, i + CHUNK_SIZE));
  }

  try {
    const results: number[] = [];
    
    for (let i = 0; i < chunkedPoints.length; i++) {
      onProgress?.(`지형 데이터 분석 중 (${i + 1}/${chunkedPoints.length})...`);
      if (i > 0) await sleep(1000); // 1s delay between batches to stay under minutely limits
      
      const chunk = chunkedPoints[i];
      const lats = chunk.map(p => p.lat.toFixed(5)).join(',');
      const lons = chunk.map(p => p.lon.toFixed(5)).join(',');
      const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
      
      let success = false;
      let retries = 0;
      while (!success && retries < 3) {
        try {
          const response = await fetch(url);
          
          if (response.status === 429) {
            const waitTime = 2000 * (retries + 1);
            console.warn(`Elevation API 429. Retrying in ${waitTime}ms...`);
            await sleep(waitTime);
            retries++;
            continue;
          }

          if (!response.ok) {
            throw new Error(`Status ${response.status}`);
          }

          const data = await response.json();
          if (data && Array.isArray(data.elevation)) {
            results.push(...data.elevation);
            success = true;
          } else {
            throw new Error("Missing elevation array in response");
          }
        } catch (e) {
          retries++;
          if (retries >= 3) throw e;
          await sleep(1000);
        }
      }
    }
    
    console.log(`Successfully fetched ${results.length} terrain points`);

    // Get observer elevation with retry logic
    let observerElev = 0;
    let obsSuccess = false;
    let obsRetries = 0;
    const obsUrl = `https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`;
    
    while (!obsSuccess && obsRetries < 3) {
      try {
        const obsRes = await fetch(obsUrl);
        if (obsRes.status === 429) {
          await sleep(2000);
          obsRetries++;
          continue;
        }
        const obsData = await obsRes.json();
        const rawObsElev = (obsData && Array.isArray(obsData.elevation)) ? obsData.elevation[0] : 0;
        observerElev = isNaN(Number(rawObsElev)) ? 0 : Number(rawObsElev);
        obsSuccess = true;
      } catch (e) {
        obsRetries++;
        if (obsRetries >= 3) break;
        await sleep(1000);
      }
    }

    const panoramicAngles: number[] = [];
    const farAngles: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      let maxAzAngle = -10; // Start very low to allow negative angles
      let maxFarAngle = -10;
      for (let j = 0; j < DISTANCES.length; j++) {
        const idx = i * DISTANCES.length + j;
        const rawElev = results[idx];
        if (rawElev === undefined || rawElev === null) continue;
        
        const elev = Number(rawElev);
        if (isNaN(elev)) continue;
        
        const distMeters = DISTANCES[j] * 1000;
        const elevDiff = elev - observerElev;
        const angle = (Math.atan2(elevDiff, distMeters) * 180) / Math.PI;
        
        if (!isNaN(angle)) {
          if (angle > maxAzAngle) maxAzAngle = angle;
          // DISTANCES = [5, 15, 40], so j >= 1 covers 15km and 40km
          if (j >= 1 && angle > maxFarAngle) maxFarAngle = angle;
        }
      }
      panoramicAngles.push(maxAzAngle);
      farAngles.push(maxFarAngle);
    }

    const avgAngle = panoramicAngles.reduce((a, b) => a + b, 0) / panoramicAngles.length;
    const terrainData = { panoramicAngles, farAngles, minAz, maxAz, avgAngle };
    terrainCache.set(cacheKey, terrainData);
    return terrainData;
  } catch (error) {
    console.error("Failed to fetch panoramic terrain:", error);
    const SAMPLES = 61;
    return { 
      panoramicAngles: Array(SAMPLES).fill(0), 
      farAngles: Array(SAMPLES).fill(0), 
      minAz, 
      maxAz,
      avgAngle: 0
    };
  }
};

export const getSimulationData = async (lat: number, lon: number, date: Date = new Date()) => {
  const events = getCelestialEvents(date, lat, lon);
  const eventTime = events.sunset;
  
  // Get sun azimuth at sunset
  const pos = getSunPosition(eventTime, lat, lon);
  
  // Fetch weather data for that azimuth in 2D fan-grid
  const weatherData = await fetchSunsetWeather(lat, lon, pos.azimuth, date);
  
  // Interpolate weather values at target eventTime
  const interpolated = getInterpolatedWeather(weatherData, eventTime);
  
  const targetDistances = [0, 80, 200, 350];
  const pathData = targetDistances.map(dist => {
    // Filter points corresponding to this distance
    const pointsAtDist = interpolated.filter(p => p.distance === dist);
    const profile: CloudPoint[] = [];

    if (dist === 0) {
      // For 0km observer point, replicate to all azimuth offsets to cover the FOV
      const pData = pointsAtDist[0];
      if (pData && pData.classifiedClouds) {
        const azimuthOffsets = [-15, -7.5, 0, 7.5, 15];
        azimuthOffsets.forEach((offset, oIdx) => {
          pData.classifiedClouds!.forEach((cloud, cIdx) => {
            const seed = Math.abs(Math.sin(lat * 100 + lon * 50 + dist * 10 + oIdx * 13 + cIdx * 7));
            
            // Map km height to simulation height scale (0 - 120 approx)
            const height = cloud.baseAltKm * 10 + seed * (cloud.topAltKm - cloud.baseAltKm) * 10;
            const density = cloud.coverage * (0.6 + seed * 0.4);
            
            profile.push({
              height,
              density,
              azimuth: (pos.azimuth + offset + (seed - 0.5) * 3 + 360) % 360,
              genus: cloud.genus,
              opticalThickness: cloud.opticalThickness,
              isIce: cloud.isIce,
              topHeight: cloud.topAltKm * 10,
            });
          });
        });
      }
    } else {
      // For 80, 200, 350 km, use the actual 5 azimuth offsets sampled
      pointsAtDist.forEach((pData) => {
        const offset = (pData as any).azimuthOffset ?? 0;
        
        if (pData.classifiedClouds) {
          pData.classifiedClouds.forEach((cloud, cIdx) => {
            // Generate multiple particles per cloud group to add depth/realism
            for (let i = 0; i < 3; i++) {
              const seed = Math.abs(Math.sin(lat * 100 + lon * 50 + dist * 10 + offset * 13 + cIdx * 7 + i * 19));
              
              const height = cloud.baseAltKm * 10 + seed * (cloud.topAltKm - cloud.baseAltKm) * 10;
              const density = cloud.coverage * (0.5 + seed * 0.5);
              
              profile.push({
                height,
                density,
                azimuth: (pos.azimuth + offset + (seed - 0.5) * 2.5 + 360) % 360,
                genus: cloud.genus,
                opticalThickness: cloud.opticalThickness,
                isIce: cloud.isIce,
                topHeight: cloud.topAltKm * 10,
              });
            }
          });
        }
      });
    }

    // Safety fallback: if no clouds are classified, add a clear marker
    if (profile.length === 0) {
      profile.push({
        height: 10,
        density: 0,
        azimuth: pos.azimuth,
        genus: 'clear',
        opticalThickness: 0,
        isIce: false,
        topHeight: 12,
      });
    }

    return {
      distance: dist,
      profile,
    };
  });

  return {
    eventTime,
    weatherData,
    pathData,
    sunAzimuth: pos.azimuth,
    weatherSource: selectModel(lat, lon) ? `JMA MSM / Open-Meteo` : 'Open-Meteo',
    terrainInfo: {
      horizonOffset: 0
    }
  };
};

