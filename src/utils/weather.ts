/**
 * Weather and Geographic Utilities for Sunset Simulation
 * Considers Earth's curvature and multi-point sampling along the sun's path.
 */

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
    return 'kma_ldaps';
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
  useNowcast: boolean = false
): Promise<CloudPathData[]> => {
  // Bucket azimuth to nearest 30 degrees to reduce weather API requests on tiny azimuth adjustments
  const bucketedAzimuth = (Math.round(azimuth / 30) * 30) % 360;
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)},${bucketedAzimuth}_nowcast_${useNowcast}`;
  if (weatherCache.has(cacheKey)) {
    return weatherCache.get(cacheKey)!;
  }
  
  // 5-Ray Fanning: Observer (0km) + Left2(-20 deg), Left1(-10 deg), Center(0 deg), Right1(10 deg), Right2(20 deg)
  // Distances: [10, 30, 70, 130, 200, 280, 380] km (More non-linear sampling density near horizon)
  const angles = [-20, -10, 0, 10, 20];
  const distances = [10, 30, 70, 130, 200, 280, 380];
  const points: { dist: number; azOffset: number; lat: number; lon: number }[] = [
    { dist: 0, azOffset: 0, lat, lon }
  ];

  angles.forEach(ang => {
    distances.forEach(d => {
      const dest = calculateDestination(lat, lon, d, bucketedAzimuth + ang);
      points.push({ dist: d, azOffset: ang, lat: dest.latitude, lon: dest.longitude });
    });
  });

  const lats = points.map(p => p.lat.toFixed(5)).join(',');
  const lons = points.map(p => p.lon.toFixed(5)).join(',');

  const modelName = useNowcast ? getLocalHighResModel(lat, lon) : '';
  const modelParam = modelName ? `&models=${modelName}` : '';

  // 국지 고해상도 모델은 direct_normal_irradiance 및 total_column_integrated_water_vapour를 미지원하므로 제외하고 요청
  const hourlyVariables = useNowcast
    ? 'cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m,precipitation'
    : 'cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m,direct_normal_irradiance,total_column_integrated_water_vapour,precipitation';

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
      `&hourly=${hourlyVariables}` +
      `&timezone=auto${modelParam}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      // 만약 고해상도 국지 모델(Nowcast) 요청이 실패(400)했거나 Rate Limit(429)이 걸렸다면 자동으로 글로벌 표준 모델로 재시도
      if (useNowcast) {
        console.warn(`Nowcast model [${modelName}] fetch failed (Status: ${response.status}). Falling back to standard global model.`);
        return fetchSunsetWeather(lat, lon, azimuth, false);
      }
      throw new Error(`Open-Meteo API returned error status: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Open-Meteo API returned non-JSON response: ${contentType}`);
    }

    const data = await response.json();

    if (data.error) {
      if (useNowcast) {
        console.warn(`Nowcast API returned error data. Falling back to standard global model.`);
        return fetchSunsetWeather(lat, lon, azimuth, false);
      }
      throw new Error(`Open-Meteo API Error: ${data.reason || 'Unknown error'}`);
    }

    // The API returns an array if multiple latitudes are passed
    const results = Array.isArray(data) ? data : [data];

    const fetched: CloudPathData[] = points.map((p, i) => {
      const res = results[i];
      const resHourly = res?.hourly || (modelName ? res?.[`hourly_${modelName}`] : null);

      if (!res || !resHourly) {
        console.warn(`Weather data missing for point ${i} (${p.dist}km, offset ${p.azOffset}°). Using clear sky fallback.`);
        const fallbackTime: string[] = results[0]?.hourly?.time || results[0]?.[`hourly_${modelName}`]?.time || [];
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
          source: useNowcast ? 'ultra-short' : 'standard',
        };
      }

      const time: string[] = resHourly.time;
      const hourly: HourlyCloudData = {
        time,
        timeMs: time.map((t: string) => new Date(t).getTime()),
        low: resHourly.cloud_cover_low || Array(24).fill(0),
        mid: resHourly.cloud_cover_mid || Array(24).fill(0),
        high: resHourly.cloud_cover_high || Array(24).fill(0),
        directNormalIrradiance: resHourly.direct_normal_irradiance,
        totalColumnWaterVapour: resHourly.total_column_integrated_water_vapour,
        precipitation: resHourly.precipitation,
      };
      
      // Visibility and humidity are only meaningful at the observer
      if (i === 0) {
        if (Array.isArray(resHourly.visibility)) hourly.visibility = resHourly.visibility;
        if (Array.isArray(resHourly.relative_humidity_2m)) hourly.humidity = resHourly.relative_humidity_2m;
      }

      return {
        distance: p.dist,
        azimuthOffset: p.azOffset,
        hourly,
        source: useNowcast ? 'ultra-short' : 'standard',
      };
    });

    weatherCache.set(cacheKey, fetched);
    return fetched;
  } catch (error) {
    console.error("Failed to fetch weather data:", error);
    
    // 만약 캐시가 실패하였으나 메모리에 캐싱된 가장 최근 데이터가 있다면 그것을 우선 반환
    if (weatherCache.size > 0) {
      const lastCached = Array.from(weatherCache.values())[weatherCache.size - 1];
      console.warn("Using last successfully cached weather data as emergency fallback.");
      return lastCached;
    }
    
    // 최악의 경우 격자/수치 렌더링을 위해 36개 포인트의 유효한 fallback 데이터를 정밀 조립하여 리턴
    console.warn("Generating mock clear weather data for 36 points to prevent crash.");
    const dummyTime = [new Date().toISOString()];
    const dummyTimeMs = [new Date().getTime()];
    
    return points.map(p => ({
      distance: p.dist,
      azimuthOffset: p.azOffset,
      hourly: {
        time: dummyTime,
        timeMs: dummyTimeMs,
        low: [0],
        mid: [0],
        high: [0],
        visibility: [10000],
        humidity: [50],
        precipitation: [0]
      },
      source: 'standard'
    }));
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
      low: interpolate(p.hourly.low[i], p.hourly.low[i+1] ?? p.hourly.low[i]),
      mid: interpolate(p.hourly.mid[i], p.hourly.mid[i+1] ?? p.hourly.mid[i]),
      high: interpolate(p.hourly.high[i], p.hourly.high[i+1] ?? p.hourly.high[i]),
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
  
  // 1. 관측자 본인(거리 0)을 첫 번째로 포함시켜 단일 호출로 통합
  points.push({ lat, lon, dist: 0, az: 0 });

  azimuths.forEach(az => {
    DISTANCES.forEach(dist => {
      const dest = calculateDestination(lat, lon, dist, az);
      points.push({ lat: dest.latitude, lon: dest.longitude, dist, az });
    });
  });

  // 2. 청크 크기를 60으로 늘려 리퀘스트 갯수 최소화 (총 4개 미만 청크)
  const CHUNK_SIZE = 60;
  const chunkedPoints: typeof points[] = [];
  for (let i = 0; i < points.length; i += CHUNK_SIZE) {
    chunkedPoints.push(points.slice(i, i + CHUNK_SIZE));
  }

  try {
    onProgress?.(`Analyzing Terrain Data...`);
    
    // 3. 순차 대기(sleep) 없이 모든 청크를 병렬(Promise.all)로 동시 호출하여 로딩 속도 600% 이상 단축
    const fetchPromises = chunkedPoints.map(async (chunk, idx) => {
      const lats = chunk.map(p => p.lat.toFixed(5)).join(',');
      const lons = chunk.map(p => p.lon.toFixed(5)).join(',');
      const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
      
      let retries = 0;
      while (retries < 3) {
        try {
          const response = await fetch(url);
          
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
            return { idx, elevation: data.elevation };
          } else {
            throw new Error("Missing elevation array in response");
          }
        } catch (e) {
          retries++;
          if (retries >= 3) throw e;
          await sleep(500);
        }
      }
      return { idx, elevation: [] as number[] };
    });

    const chunkResults = await Promise.all(fetchPromises);
    
    // 청크 인덱스 순서대로 정렬하여 데이터 머지
    chunkResults.sort((a, b) => a.idx - b.idx);
    const results: number[] = [];
    chunkResults.forEach(r => results.push(...r.elevation));

    if (results.length !== points.length) {
      throw new Error(`Data size mismatch: expected ${points.length}, got ${results.length}`);
    }

    console.log(`Successfully fetched ${results.length} terrain points in parallel`);

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
  } catch (error) {
    console.error("Failed to fetch panoramic terrain:", error);
    return { panoramicAngles: Array(SAMPLES).fill(0), farAngles: Array(SAMPLES).fill(0), minAz, maxAz, observerElevation: 0 };
  }
};
