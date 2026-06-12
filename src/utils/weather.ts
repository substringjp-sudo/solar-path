/**
 * Weather and Geographic Utilities for Sunset Simulation
 * Considers Earth's curvature and multi-point sampling along the sun's path.
 */

const EARTH_RADIUS_KM = 6371;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = 5000): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

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

export interface CloudData {
  low: number;
  mid: number;
  high: number;
  distance: number;
  azimuthOffset: number;
  /** Surface visibility in meters. Only populated for the observer point. */
  visibility?: number;
  /** 2 m relative humidity in percent. Only populated for the observer point. */
  humidity?: number;
  directNormalIrradiance?: number;
  totalColumnWaterVapour?: number;
  precipitation?: number;
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
  directNormalIrradiance?: number[];
  totalColumnWaterVapour?: number[];
  precipitation?: number[];
}

export interface CloudPathData {
  distance: number;
  azimuthOffset: number;
  hourly: HourlyCloudData;
  source: 'standard' | 'ultra-short'; // 'standard' (Global/Open-Meteo), 'ultra-short' (Regional High-res/Nowcast)
}

export const getLocalHighResModel = (lat: number, lon: number): string => {
  // 대한민국 영역 (위도 33~39, 경도 124~132)
  if (lat >= 33 && lat <= 39 && lon >= 124 && lon <= 132) {
    return 'best_match';
  }
  // 미국 영역 (위도 24~50, 경도 -125~-66)
  if (lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66) {
    return 'hrrr';
  }
  // 독일 및 주변 유럽 영역 (위도 47~55, 경도 5~16)
  if (lat >= 47 && lat <= 55 && lon >= 5 && lon <= 16) {
    return 'icon_d2';
  }
  return 'best_match';
};

const weatherCache = new Map<string, CloudPathData[]>();

export const fetchSunsetWeather = async (
  lat: number,
  lon: number,
  azimuth: number,
  useNowcast: boolean = false,
  targetDate: Date = new Date()
): Promise<CloudPathData[]> => {
  // Bucket azimuth to nearest 30 degrees to reduce weather API requests on tiny azimuth adjustments
  const targetDateStr = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD
  const bucketedAzimuth = (Math.round(azimuth / 30) * 30) % 360;
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)},${bucketedAzimuth}_nowcast_${useNowcast}_date_${targetDateStr}`;
  if (weatherCache.has(cacheKey)) {
    return weatherCache.get(cacheKey)!;
  }
  
  const startTime = Date.now();
  if (__DEV__) {
    console.log(`[WeatherAPI] Fetching weather data for lat=${lat.toFixed(4)}, lon=${lon.toFixed(4)}, azimuth=${azimuth.toFixed(1)} (Date: ${targetDateStr}, Nowcast: ${useNowcast})`);
  }

  // Define 36 virtual points representing the full 5-Ray * 7-Distance grid
  const angles = [-20, -10, 0, 10, 20];
  const distances = [10, 30, 70, 130, 200, 280, 380];
  const virtualPoints: { dist: number; azOffset: number; lat: number; lon: number; targetLat: number; targetLon: number }[] = [
    { dist: 0, azOffset: 0, lat, lon, targetLat: lat, targetLon: lon }
  ];

  angles.forEach(ang => {
    distances.forEach(d => {
      // Near distances (10, 30, 70km) use only 3 angles [-10, 0, 10] by mapping outer angles (-20, 20) to adjacent ones.
      let targetAng = ang;
      if (d <= 70) {
        if (ang === -20) targetAng = -10;
        if (ang === 20) targetAng = 10;
      }
      
      const origDest = calculateDestination(lat, lon, d, bucketedAzimuth + ang);
      const targetDest = calculateDestination(lat, lon, d, bucketedAzimuth + targetAng);
      
      virtualPoints.push({
        dist: d,
        azOffset: ang,
        lat: origDest.latitude,
        lon: origDest.longitude,
        targetLat: targetDest.latitude,
        targetLon: targetDest.longitude
      });
    });
  });

  // Deduplicate target coordinates to send minimum API requests (total 30 points)
  const uniquePoints: { lat: number; lon: number; key: string }[] = [];
  const seen = new Set<string>();

  virtualPoints.forEach(vp => {
    const key = `${vp.targetLat.toFixed(5)},${vp.targetLon.toFixed(5)}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePoints.push({ lat: vp.targetLat, lon: vp.targetLon, key });
    }
  });

  const modelName = useNowcast ? getLocalHighResModel(lat, lon) : '';
  const modelParam = modelName ? `&models=${modelName}` : '';

  // 국지 고해상도 모델은 direct_normal_irradiance 및 total_column_integrated_water_vapour를 미지원하므로 제외하고 요청
  const hourlyVariables = useNowcast
    ? 'cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m,precipitation'
    : 'cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m,direct_normal_irradiance,total_column_integrated_water_vapour,precipitation';

  const cLats = uniquePoints.map(p => p.lat.toFixed(5)).join(',');
  const cLons = uniquePoints.map(p => p.lon.toFixed(5)).join(',');

  // Check if targetDate is older than 5 days to determine forecast vs archive endpoint
  const diffDays = Math.ceil((Date.now() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
  const isHistorical = diffDays > 5;

  let url = '';
  if (isHistorical) {
    // Open-Meteo Archive API (total_column_integrated_water_vapour excluded due to archive support limits)
    const archiveVariables = 'cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m,direct_normal_irradiance,precipitation';
    url = `https://archive-api.open-meteo.com/v1/archive?latitude=${cLats}&longitude=${cLons}` +
      `&hourly=${archiveVariables}` +
      `&start_date=${targetDateStr}&end_date=${targetDateStr}` +
      `&timezone=auto`;
  } else {
    // Open-Meteo Forecast API (limit data payload to targetDateStr to drastically reduce download and parsing latency)
    url = `https://api.open-meteo.com/v1/forecast?latitude=${cLats}&longitude=${cLons}` +
      `&hourly=${hourlyVariables}` +
      `&start_date=${targetDateStr}&end_date=${targetDateStr}` +
      `&timezone=auto${modelParam}`;
  }

  if (__DEV__) {
    console.log(`[WeatherAPI] Request URL: ${url}`);
  }

  try {
    let response;
    try {
      response = await fetchWithTimeout(url, {}, 5000);
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error(`[WeatherAPI] Network failure or Timeout after ${duration}ms. Error: ${err?.message}`);
      throw new Error(`NETWORK_ERROR: 인터넷 연결이 불안정하거나 타임아웃이 발생했습니다.`);
    }
    
    const duration = Date.now() - startTime;
    if (!response.ok) {
      console.error(`[WeatherAPI] API responded with error status ${response.status} in ${duration}ms`);
      if (response.status === 429) {
        throw new Error(`RATE_LIMIT: API 요청 한도를 초과했습니다.`);
      }
      if (response.status >= 500) {
        throw new Error(`SERVER_ERROR: 날씨 API 서버에 장애가 발생했습니다. (오류 코드: ${response.status})`);
      }
      throw new Error(`HTTP_ERROR: 날씨 데이터를 가져오지 못했습니다. (오류 코드: ${response.status})`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.error(`[WeatherAPI] Non-JSON content-type received: ${contentType}`);
      throw new Error(`HTTP_ERROR: 올바르지 않은 응답 형식입니다. (비JSON 응답)`);
    }

    const data = await response.json();
    if (data.error) {
      console.error(`[WeatherAPI] Open-Meteo API Error: ${data.reason || 'Unknown error'}`);
      if (data.reason && data.reason.includes('Minutely usage limit reached')) {
        throw new Error(`RATE_LIMIT: 분당 API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.`);
      }
      throw new Error(`HTTP_ERROR: API 호출 오류 (${data.reason || 'Unknown'})`);
    }

    if (__DEV__) {
      console.log(`[WeatherAPI] Successfully fetched weather data in ${duration}ms. Deduplicated size: ${uniquePoints.length} items.`);
    }
    const results = Array.isArray(data) ? data : [data];

    // Reconstruct the 36 CloudPathData items from deduplicated results
    const fetched: CloudPathData[] = virtualPoints.map((vp, i) => {
      const targetKey = `${vp.targetLat.toFixed(5)},${vp.targetLon.toFixed(5)}`;
      const uniqueIdx = uniquePoints.findIndex(up => up.key === targetKey);
      const res = results[uniqueIdx];
      const resHourly = res?.hourly || (modelName ? res?.[`hourly_${modelName}`] : null);

      if (!res || !resHourly) {
        console.warn(`Weather data missing for virtual point ${i} (${vp.dist}km, offset ${vp.azOffset}°). Using clear sky fallback.`);
        const fallbackTime: string[] = results[0]?.hourly?.time || results[0]?.[`hourly_${modelName}`]?.time || [];
        return {
          distance: vp.dist,
          azimuthOffset: vp.azOffset,
          hourly: {
            time: fallbackTime,
            timeMs: fallbackTime.map(t => new Date(t).getTime()),
            low: Array(24).fill(0),
            mid: Array(24).fill(0),
            high: Array(24).fill(0),
          },
          source: useNowcast ? 'ultra-short' : 'standard',
        };
      }

      const time: string[] = resHourly.time;
      const low = Array.isArray(resHourly.cloud_cover_low) && resHourly.cloud_cover_low.length > 0
        ? resHourly.cloud_cover_low
        : Array(time.length).fill(0);
      const mid = Array.isArray(resHourly.cloud_cover_mid) && resHourly.cloud_cover_mid.length > 0
        ? resHourly.cloud_cover_mid
        : Array(time.length).fill(0);
      const high = Array.isArray(resHourly.cloud_cover_high) && resHourly.cloud_cover_high.length > 0
        ? resHourly.cloud_cover_high
        : Array(time.length).fill(0);

      const hourly: HourlyCloudData = {
        time,
        timeMs: time.map((t: string) => new Date(t).getTime()),
        low,
        mid,
        high,
        directNormalIrradiance: resHourly.direct_normal_irradiance,
        totalColumnWaterVapour: resHourly.total_column_integrated_water_vapour,
        precipitation: resHourly.precipitation,
      };
      
      // Visibility and humidity are only meaningful at the observer (index 0)
      if (i === 0) {
        if (Array.isArray(resHourly.visibility)) hourly.visibility = resHourly.visibility;
        if (Array.isArray(resHourly.relative_humidity_2m)) hourly.humidity = resHourly.relative_humidity_2m;
      }

      return {
        distance: vp.dist,
        azimuthOffset: vp.azOffset,
        hourly,
        source: useNowcast ? 'ultra-short' : 'standard',
      };
    });

    weatherCache.set(cacheKey, fetched);
    return fetched;
  } catch (error) {
    console.error("Failed to fetch weather data:", error);
    throw error;
  }
};

/**
 * Interpolates hourly weather data for a specific time.
 */
export const getInterpolatedWeather = (pathData: CloudPathData[], targetTime: Date): CloudData[] => {
  if (!pathData || !Array.isArray(pathData)) return [];

  const targetMs = targetTime.getTime();
  return pathData.map(p => {
    if (!p?.hourly?.time || !p?.hourly?.high || !p?.hourly?.low) {
      return { high: 0, mid: 0, low: 0, distance: p.distance || 0, azimuthOffset: p.azimuthOffset || 0 };
    }
    // timeMs is pre-parsed at fetch time. Tolerate legacy / hand-built data
    // that only has the string `time` field by parsing on the fly.
    const times = p.hourly.timeMs ?? p.hourly.time.map(t => new Date(t).getTime());

    if (times.length === 0) {
      return { distance: p.distance || 0, azimuthOffset: p.azimuthOffset || 0, low: 0, mid: 0, high: 0 };
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

    return {
      distance: p.distance,
      azimuthOffset: p.azimuthOffset,
      low: interpolate(p.hourly.low[i] ?? 0, p.hourly.low[i+1] ?? p.hourly.low[i] ?? 0),
      mid: interpolate(p.hourly.mid[i] ?? 0, p.hourly.mid[i+1] ?? p.hourly.mid[i] ?? 0),
      high: interpolate(p.hourly.high[i] ?? 0, p.hourly.high[i+1] ?? p.hourly.high[i] ?? 0),
      visibility: interpolateOpt(p.hourly.visibility),
      humidity: interpolateOpt(p.hourly.humidity),
      directNormalIrradiance: interpolateOpt(p.hourly.directNormalIrradiance),
      totalColumnWaterVapour: interpolateOpt(p.hourly.totalColumnWaterVapour),
      precipitation: interpolateOpt(p.hourly.precipitation),
    };
  });
};

export interface TerrainData {
  panoramicAngles: number[]; // Max of all distances (near/mid/far)
  farAngles: number[];       // Only distant mountains (15km, 40km)
  minAz: number;
  maxAz: number;
  observerElevation?: number; // Observer elevation in meters
  /** API 실패로 인해 0으로 채워진 fallback 데이터임을 나타냄. 캐싱 금지. */
  isFallback?: boolean;
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

  const SAMPLES = 31; // Optimized from 61 to query within Open-Meteo's 100 coordinates limit in a single request.
  const DISTANCES = [5, 15, 40]; 
  
  const range = maxAz - minAz;
  const azimuths = Array.from({ length: SAMPLES }, (_, i) => 
    (minAz + (i * range) / (SAMPLES - 1) + 360) % 360
  );

  const points: { lat: number; lon: number; dist: number; az: number }[] = [];
  
  // 1. 관측자 본인(거리 0)을 첫 번째로 포함시켜 단일 호출로 통합
  points.push({ lat, lon, dist: 0, az: 0 });

  azimuths.forEach(az => {
    DISTANCES.forEach(dist => {
      const dest = calculateDestination(lat, lon, dist, az);
      points.push({ lat: dest.latitude, lon: dest.longitude, dist, az });
    });
  });

  const startTime = Date.now();
  if (__DEV__) {
    console.log(`[TerrainAPI] Fetching terrain elevation profile for lat=${lat.toFixed(4)}, lon=${lon.toFixed(4)} (Samples: ${SAMPLES})`);
  }

  try {
    onProgress?.(`Analyzing Terrain Data...`);
    
    const lats = points.map(p => p.lat.toFixed(5)).join(',');
    const lons = points.map(p => p.lon.toFixed(5)).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
    
    if (__DEV__) {
      console.log(`[TerrainAPI] Request URL: ${url}`);
    }
    
    let results: number[] = [];
    let retries = 0;
    
    while (retries < 3) {
      try {
        const response = await fetchWithTimeout(url, {}, 5000);
        
        if (response.status === 429) {
          const waitTime = 1000 * (retries + 1);
          await sleep(waitTime);
          retries++;
          continue;
        }

        if (!response.ok) {
          throw new Error(`Status ${response.status}`);
        }

        const data = await response.json();
        if (data && Array.isArray(data.elevation)) {
          results = data.elevation;
          break;
        } else {
          throw new Error("Missing elevation array in response");
        }
      } catch (e) {
        retries++;
        if (retries >= 3) throw e;
        await sleep(500);
      }
    }

    if (results.length !== points.length) {
      throw new Error(`Data size mismatch: expected ${points.length}, got ${results.length}`);
    }

    const duration = Date.now() - startTime;
    if (__DEV__) {
      console.log(`[TerrainAPI] Successfully fetched ${results.length} terrain elevation points in ${duration}ms`);
    }

    // 0번째 결과가 바로 첫 머리에 끼워넣은 관측자의 고도(observerElevation)
    const observerElev = results[0] || 0;
    
    // 1번째 결과부터 실제 샘플링 지형 데이터
    const terrainPoints = results.slice(1);

    const panoramicAngles: number[] = [];
    const farAngles: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      let maxAzAngle = 0;
      let maxFarAngle = 0;
      for (let j = 0; j < DISTANCES.length; j++) {
        const idx = i * DISTANCES.length + j;
        const elev = terrainPoints[idx];
        if (elev === undefined) continue;
        
        const distMeters = DISTANCES[j] * 1000;
        const elevDiff = elev - observerElev;
        const angle = (Math.atan2(elevDiff, distMeters) * 180) / Math.PI;
        
        if (angle > maxAzAngle) maxAzAngle = angle;
        if (j >= 1 && angle > maxFarAngle) maxFarAngle = angle;
      }
      panoramicAngles.push(maxAzAngle);
      farAngles.push(maxFarAngle);
    }

    const terrainData = { panoramicAngles, farAngles, minAz, maxAz, observerElevation: observerElev };
    terrainCache.set(cacheKey, terrainData);
    return terrainData;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`[TerrainAPI] Failed to fetch panoramic terrain in ${duration}ms. Error: ${error?.message}`);
    // isFallback: true 로 마킹하여 호출부에서 캐싱하지 않도록 방지
    return { panoramicAngles: Array(SAMPLES).fill(0), farAngles: Array(SAMPLES).fill(0), minAz, maxAz, observerElevation: 0, isFallback: true };
  }
};
