/**
 * Weather and Geographic Utilities for Sunset Simulation
 * Considers Earth's curvature and multi-point sampling along the sun's path.
 */

import { findPresetTerrain } from './presetTerrains';
import { EARTH_RADIUS_KM, EARTH_RADIUS_M } from './earth';
import { BLEND_MODELS_PARAM, blendHourly } from './modelBlend';
import { CANARY_VARIABLE, ringCacheKey } from './cachePolicy';
import { localDateString } from './localDate';
import { extractProfile, layerAltitudes, lowDeck } from './cloudProfile';
import { gridBucket } from './weatherCacheKey';
import { getSunPosition } from './celestial';
import { clearSkyGHIMean, estimateBias, correctCloudAt, LOOKBACK_HOURS, MIN_CLEAR_GHI } from './satelliteBias';

// 지구는 utils/earth.ts 한 곳에서만 정의합니다.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ── In-Memory Weather & Terrain Cache (30 min TTL) ──
const MEM_SUNSET_CACHE = new Map<string, { data: CloudPathData[]; time: number }>();
const MEM_RING_CACHE = new Map<string, { data: CloudPathData[]; time: number }>();
const INFLIGHT_REQUESTS = new Map<string, Promise<any>>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const FALLBACK_CACHE_TTL_MS = 30 * 1000; // API 한도 초과 등 Fallback 대체 데이터는 30초 단기 쿨다운만 적용

const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = 5000): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(id);
      controller.abort();
    } else {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
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

export interface CloudData {
  low: number;
  mid: number;
  high: number;
  /** 모델이 스스로 낸 총운량(%). `HourlyCloudData.total` 주석 참고. */
  total?: number;
  /** 층별 실제 높이(km). 관측점에서만 채워집니다. */
  layerAltLowKm?: number;
  layerAltMidKm?: number;
  layerAltHighKm?: number;
  /** 저층 덱 밑면·윗면(km, 해발, §82). 관측점에서만. 저층이 비면 없음. */
  lowDeckBaseKm?: number;
  lowDeckTopKm?: number;
  /**
   * 그 시각의 기압면 단면(§93) — `PROFILE_LEVELS` 순서의 높이(m)·운량(%).
   * 관측점에서만. 산 위가 구름 속인지(`cloudProfile.cloudAround`)를 여기서 봅니다.
   */
  profileHeightM?: number[];
  profileCoverPct?: number[];
  /**
   * §135 열역학 입력 — 관측점에서만(`fetchThermoProfile`). 빈 칸·받지 못한 값은 NaN/undefined 이고
   * 아카이브(5일 넘은 과거)는 CAPE·결빙고도·기압면 기온·습도를 주지 않습니다. 소비자는 Number.isFinite 로 거릅니다.
   */
  t2mC?: number;
  td2mC?: number;
  capeJkg?: number;
  freezingLevelM?: number;
  pblM?: number;
  /** `THERMO_TEMP_LEVELS` / `THERMO_RH_LEVELS` 순서의 기온(°C)·상대습도(%) */
  profileTempC?: number[];
  profileRhPct?: number[];
  distance: number;
  azimuthOffset: number;
  /** Surface visibility in meters. Only populated for the observer point. */
  visibility?: number;
  /** 2 m relative humidity in percent. Only populated for the observer point. */
  humidity?: number;
  /**
   * 대기질(CAMS, Open-Meteo 대기질 API). 관측점에서만. 받지 못한 시각은 undefined — 지어내지 않습니다.
   * aod550: 에어로졸 광학두께(550nm, 무차원) · dust·pm25·pm10: 지표 농도(µg/m³).
   */
  aod550?: number;
  dust?: number;
  pm25?: number;
  pm10?: number;
  directNormalIrradiance?: number;
  totalColumnWaterVapour?: number;
  precipitation?: number;
  /**
   * 층별 바람 (km/h), **동/북 성분**. 관측점에서만 채워집니다.
   *
   * 방향이 아니라 성분으로 나르는 이유: 시간 보간이 선형이라 350°와 10°를
   * 각도로 섞으면 180°를 거쳐 반대로 돕니다. 성분은 그런 문제가 없고,
   * 약한 바람이 방향을 홱 바꿀 때도 자연스럽게 크기가 줄어듭니다.
   */
  windULow?: number;
  windVLow?: number;
  windUMid?: number;
  windVMid?: number;
  windUHigh?: number;
  windVHigh?: number;
}

/** 한 층의 바람. `bearingDeg` 는 기상 관례대로 **불어오는 쪽** 방위입니다. */
export interface LayerWind {
  speedKmh: number;
  bearingDeg: number;
}

export type LayerWinds = Record<'low' | 'mid' | 'high', LayerWind>;

/**
 * 관측점 `CloudData` 에서 층별 바람을 꺼냅니다. 실측이 없으면 `null`.
 *
 * 성분 → (속도, 방위) 역변환입니다. 저장은 "불어가는" 벡터(u=동, v=북)이고
 * 방위는 "불어오는" 쪽이라 180°를 더합니다.
 */
export const layerWindsFrom = (d?: CloudData | null): LayerWinds | null => {
  if (!d) return null;
  const one = (u?: number, v?: number): LayerWind | null => {
    if (u == null || v == null || !Number.isFinite(u) || !Number.isFinite(v)) return null;
    const speedKmh = Math.hypot(u, v);
    // atan2(u, v) 는 북에서 시계방향 — 지리 방위 그대로입니다.
    const toDeg = (Math.atan2(u, v) * 180) / Math.PI;
    return { speedKmh, bearingDeg: ((toDeg + 180) % 360 + 360) % 360 };
  };
  const low = one(d.windULow, d.windVLow);
  const mid = one(d.windUMid, d.windVMid);
  const high = one(d.windUHigh, d.windVHigh);
  if (!low || !mid || !high) return null;
  return { low, mid, high };
};

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
  /**
   * 모델이 스스로 낸 **총운량**(%). 층을 합친 값이 아닙니다.
   *
   * 위성 관측과 견줘 보니 총량을 만드는 네 방식 중 이것이 가장 맞습니다(§60):
   * 모델 총량 τ오차 16.5 · 무작위 겹침 17.5 · 최대 겹침 19.1 ·
   * 앱의 `cloudWeight`(0.95/0.55/0.25 가중합) 24.3.
   */
  total?: number[];
  /** 층별 실제 높이(km). `LayerWindHourly.layerAltLowKm` 주석 참고. */
  layerAltLowKm?: number[];
  layerAltMidKm?: number[];
  layerAltHighKm?: number[];
  /** 저층 덱 밑면·윗면(km). `cloudProfile.lowDeck`. 빈 시각은 NaN/null. */
  lowDeckBaseKm?: number[];
  lowDeckTopKm?: number[];
  /** 기압면 단면 [면][시각] — `LayerWindHourly.profileHeightM` 주석 참고. */
  profileHeightM?: number[][];
  profileCoverPct?: number[][];
  /** §135 열역학 입력 [시각] / [면][시각] — `ThermoHourly` 주석 참고. */
  t2mC?: number[];
  td2mC?: number[];
  capeJkg?: number[];
  freezingLevelM?: number[];
  pblM?: number[];
  profileTempC?: number[][];
  profileRhPct?: number[][];
  visibility?: number[];
  humidity?: number[];
  /** 대기질(CAMS). 관측점에서만. 받지 못한 시각은 null. `CloudData.aod550` 주석 참고. */
  aod550?: (number | null)[];
  dust?: (number | null)[];
  pm25?: (number | null)[];
  pm10?: (number | null)[];
  directNormalIrradiance?: number[];
  totalColumnWaterVapour?: number[];
  precipitation?: number[];
  /** 층별 바람의 동/북 성분 (km/h). 관측점에서만 채워집니다. */
  windULow?: number[];
  windVLow?: number[];
  windUMid?: number[];
  windVMid?: number[];
  windUHigh?: number[];
  windVHigh?: number[];
}

export interface CloudPathData {
  distance: number;
  azimuthOffset: number;
  hourly: HourlyCloudData;
  source: 'standard' | 'ultra-short'; // 'standard' (Global/Open-Meteo), 'ultra-short' (Regional High-res/Nowcast)
  isFallback?: boolean;
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

/**
 * Open-Meteo 일일/분당 API 한도 초과 시 맑은 날씨(구름 0%)를 즉시 생성하는 Fallback 함수
 */
function createClearSkyFallback(
  points: { dist: number; azOffset?: number; az?: number; azimuthOffset?: number }[],
  targetDate: Date,
  source: 'ultra-short' | 'standard' = 'standard'
): CloudPathData[] {
  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const times: string[] = [];
  const timeMs: number[] = [];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    const tStr = `${dateStr}T${hh}:00`;
    times.push(tStr);
    timeMs.push(new Date(tStr).getTime());
  }

  return points.map(p => ({
    distance: p.dist,
    azimuthOffset: p.azOffset ?? p.az ?? p.azimuthOffset ?? 0,
    hourly: {
      time: times,
      timeMs,
      low: Array(24).fill(0),
      mid: Array(24).fill(0),
      high: Array(24).fill(0),
      directNormalIrradiance: Array(24).fill(800),
      visibility: Array(24).fill(25000),
      humidity: Array(24).fill(45),
    },
    source,
    isFallback: true,
  }));
}

export const fetchSunsetWeather = async (
  lat: number,
  lon: number,
  azimuth: number,
  useNowcast: boolean = false,
  targetDate: Date = new Date(),
  forceRefresh: boolean = false,
  signal?: AbortSignal
): Promise<CloudPathData[]> => {
  // 캐시 키와 요청 날짜는 **같은 날짜**여야 합니다. 예전에는 키만 현지 날짜,
  // 요청은 UTC 날짜여서 한국 현지 00~08시에 서로 어긋났습니다(§59).
  const dateKey = localDateString(targetDate);
  const targetDateStr = dateKey;
  const bucketedAzimuth = (Math.round(azimuth / 30) * 30) % 360;
  const sunsetCacheKey = `sunset_${gridBucket(lat, lon)}_${dateKey}_${useNowcast ? 'nc' : 'fc'}_${bucketedAzimuth}`;

  if (forceRefresh) {
    MEM_SUNSET_CACHE.delete(sunsetCacheKey);
    INFLIGHT_REQUESTS.delete(sunsetCacheKey);
  } else {
    const cachedSunset = MEM_SUNSET_CACHE.get(sunsetCacheKey);
    if (cachedSunset) {
      const isFallback = cachedSunset.data?.[0]?.isFallback;
      const ttl = isFallback ? FALLBACK_CACHE_TTL_MS : CACHE_TTL_MS;
      if (Date.now() - cachedSunset.time < ttl) {
        if (__DEV__) console.log(`[WeatherAPI] Cache hit for ${sunsetCacheKey}${isFallback ? ' (temporary fallback)' : ''}`);
        return cachedSunset.data;
      }
    }

    if (INFLIGHT_REQUESTS.has(sunsetCacheKey)) {
      if (__DEV__) console.log(`[WeatherAPI] Joining inflight request for ${sunsetCacheKey}`);
      return INFLIGHT_REQUESTS.get(sunsetCacheKey)!;
    }
  }

  const startTime = Date.now();
  if (__DEV__) {
    console.log(`[WeatherAPI] Fetching 36 multi-point cloud data along solar vector for Azimuth: ${azimuth}° (Bucketed: ${bucketedAzimuth}°), Lat: ${lat}, Lon: ${lon}, Date: ${dateKey}`);
  }

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

  // 국지 고해상도 모델이 **진짜로 있는 곳**에서만 그것을 씁니다. 없는 곳에서
  // `getLocalHighResModel` 은 'best_match' 를 돌려주는데, §56 에서 재 보니
  // best_match 는 짙게 흐린 하늘에서 τ 를 +34 만큼 맑은 쪽으로 틀립니다.
  // 그럴 바에는 예보 경로와 같은 ecmwf+icon 을 쓰는 편이 낫습니다.
  const localModel = useNowcast ? getLocalHighResModel(lat, lon) : '';
  const modelName = localModel && localModel !== 'best_match' ? localModel : '';
  const modelParam = modelName ? `&models=${modelName}` : BLEND_MODELS_PARAM;

  // 국지 고해상도 모델은 direct_normal_irradiance 및 total_column_integrated_water_vapour를 미지원하므로 제외하고 요청.
  // 판정 기준이 `useNowcast` 가 아니라 **정말 국지 모델을 쓰는가** 로 바뀌었습니다 —
  // 한국처럼 국지 모델이 없어 ecmwf+icon 으로 내려앉는 곳은 전지구 모델이라
  // 둘 다 줍니다(§56). 예전에는 그 경우에도 DNI 를 안 받아 흐림 문장이
  // 근거를 잃었습니다.
  // ⚠ `visibility` 를 여기서 뺐습니다. ecmwf·icon 은 시정을 전부 null 로 주므로
  // 받아 봐야 버리는 자리였습니다. 시정은 §58 에서 관측점 1점 요청으로 옮겼습니다.
  // 그 빈 자리에 모델 자체 총운량 `cloud_cover` 를 넣습니다 — 변수 수가 그대로라
  // 호출 가중치도 그대로입니다(8 × 2모델 = 16 → 1.6회).
  const hourlyVariables = modelName
    ? 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m,precipitation'
    : 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,direct_normal_irradiance,total_column_integrated_water_vapour,precipitation';

  const cLats = uniquePoints.map(p => p.lat.toFixed(5)).join(',');
  const cLons = uniquePoints.map(p => p.lon.toFixed(5)).join(',');

  // Check if targetDate is older than 5 days to determine forecast vs archive endpoint
  const diffDays = Math.ceil((Date.now() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
  const isHistorical = diffDays > 5;

  let url = '';
  if (isHistorical) {
    // Open-Meteo Archive API (total_column_integrated_water_vapour excluded due to archive support limits)
    // 아카이브는 모델을 안 붙이므로 시정이 제대로 옵니다 — 그대로 둡니다.
    const archiveVariables = 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m,direct_normal_irradiance,precipitation';
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

  // 층별 바람은 별도 요청입니다 (`fetchLayerWinds` 주석: 기압면 변수 하나가
  // 없다고 운량까지 통째로 실패하면 안 됩니다). 여기서 미리 던져 두고
  // 아래에서 거둡니다 — 왕복 한 번 값이 겹칩니다.
  const windsPromise = fetchLayerWinds(lat, lon, targetDate, signal);
  // §135 열역학 입력도 따로(실패해도 운량·바람에 영향 없음 — `fetchThermoProfile`).
  const thermoPromise = fetchThermoProfile(lat, lon, targetDate, signal);
  // 대기질도 따로, 동시에 던집니다 — 실패해도 운량에는 영향이 없습니다(`fetchAirQuality`).
  const airPromise = fetchAirQuality(lat, lon, targetDate, signal);

  try {
    let response;
    try {
      response = await fetchWithTimeout(url, { signal }, 5000);
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError') {
        INFLIGHT_REQUESTS.delete(sunsetCacheKey);
        const abortErr = new Error('Aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      const duration = Date.now() - startTime;
      console.error(`[WeatherAPI] Network failure or Timeout after ${duration}ms. Error: ${err?.message}`);
      throw new Error(`NETWORK_ERROR: 인터넷 연결이 불안정하거나 타임아웃이 발생했습니다.`);
    }
    
    const duration = Date.now() - startTime;
    if (!response.ok) {
      console.warn(`[WeatherAPI] API responded with status ${response.status} in ${duration}ms`);
      if (response.status === 429) {
        console.warn(`[WeatherAPI] 429 Rate limit reached. Using synthetic clear sky fallback.`);
        const fallback = createClearSkyFallback(virtualPoints, targetDate, useNowcast ? 'ultra-short' : 'standard');
        MEM_SUNSET_CACHE.set(sunsetCacheKey, { data: fallback, time: Date.now() });
        INFLIGHT_REQUESTS.delete(sunsetCacheKey);
        return fallback;
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
      console.warn(`[WeatherAPI] Open-Meteo API Error: ${data.reason || 'Unknown error'}`);
      if (data.reason && (data.reason.includes('limit reached') || data.reason.includes('Hourly limit') || data.reason.includes('Minutely usage'))) {
        console.warn(`[WeatherAPI] Rate limit in error payload. Using synthetic clear sky fallback.`);
        const fallback = createClearSkyFallback(virtualPoints, targetDate, useNowcast ? 'ultra-short' : 'standard');
        MEM_SUNSET_CACHE.set(sunsetCacheKey, { data: fallback, time: Date.now() });
        INFLIGHT_REQUESTS.delete(sunsetCacheKey);
        return fallback;
      }
      throw new Error(`HTTP_ERROR: API 호출 오류 (${data.reason || 'Unknown'})`);
    }

    if (__DEV__) {
      console.log(`[WeatherAPI] Successfully fetched weather data in ${duration}ms. Deduplicated size: ${uniquePoints.length} items.`);
    }
    const results = Array.isArray(data) ? data : [data];
    // 위에서 미리 던져 둔 바람. 실패했으면 null 이고, 그때는 호출부가
    // 대용값으로 내려앉습니다 (`skyColumn.ts: resolveLayerWinds`).
    const winds = await windsPromise;
    const thermo = await thermoPromise;
    const air = await airPromise;

    // Reconstruct the 36 CloudPathData items from deduplicated results
    const fetched: CloudPathData[] = virtualPoints.map((vp, i) => {
      const targetKey = `${vp.targetLat.toFixed(5)},${vp.targetLon.toFixed(5)}`;
      const uniqueIdx = uniquePoints.findIndex(up => up.key === targetKey);
      const res = results[uniqueIdx];
      // 모델을 둘 이상 요청하면 Open-Meteo 가 변수 이름에 모델 이름을 접미사로
      // 답니다(`cloud_cover_mid_ecmwf_ifs025`). `blendHourly` 가 접미사를 떼고
      // 섞어 주므로 아래 코드는 그대로입니다.
      const resHourly = blendHourly(res?.hourly) as any;

      if (!res || !resHourly) {
        console.warn(`Weather data missing for virtual point ${i} (${vp.dist}km, offset ${vp.azOffset}°). Using clear sky fallback.`);
        const fallbackTime: string[] = (blendHourly(results[0]?.hourly)?.time as string[]) || [];
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
        total: Array.isArray(resHourly.cloud_cover) ? resHourly.cloud_cover : undefined,
        directNormalIrradiance: resHourly.direct_normal_irradiance,
        totalColumnWaterVapour: resHourly.total_column_integrated_water_vapour,
        precipitation: resHourly.precipitation,
      };
      
      // Visibility, humidity and wind are only meaningful at the observer (index 0)
      if (i === 0) {
        if (Array.isArray(resHourly.visibility)) hourly.visibility = resHourly.visibility;
        if (Array.isArray(resHourly.relative_humidity_2m)) hourly.humidity = resHourly.relative_humidity_2m;
        if (winds) attachLayerWinds(hourly, winds);
        if (thermo) attachThermo(hourly, thermo);
        if (air) attachAirQuality(hourly, air);
      }

      return {
        distance: vp.dist,
        azimuthOffset: vp.azOffset,
        hourly,
        source: useNowcast ? 'ultra-short' : 'standard',
      };
    });

    // 위성이 방금 본 하늘로 예보의 치우침을 깎습니다(§70). 실패하면 예보
    // 그대로 갑니다 — 보정은 있으면 좋은 것입니다.
    try {
      const sat = await fetchSatelliteBias(lat, lon, targetDate, fetched[0]?.hourly);
      if (sat?.biasTau != null) applyBiasToPath(fetched, sat.biasTau, sat.observedUntilMs);
    } catch (e) {
      console.warn('위성 보정 적용을 건너뜁니다:', e);
    }

    weatherCache.set(sunsetCacheKey, fetched);
    MEM_SUNSET_CACHE.set(sunsetCacheKey, { data: fetched, time: Date.now() });
    INFLIGHT_REQUESTS.delete(sunsetCacheKey);
    return fetched;
  } catch (error) {
    INFLIGHT_REQUESTS.delete(sunsetCacheKey);
    console.error("Failed to fetch weather data:", error);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// 360° 하루치 링 — 사전 계산(skyTimeline)용
// ---------------------------------------------------------------------------

/**
 * **디스크에 둔 고리를 모듈 캐시에 채웁니다.**
 *
 * 이게 있으면 `fetchDayWeatherRing` 을 부르는 쪽(`IsolineMap`·`skyTimeline`)을
 * 하나도 안 고쳐도 됩니다 — 평소처럼 부르면 **네트워크 없이** 돌아옵니다.
 *
 * ⚠ 호출부가 **카나리아가 "그대로" 라고 할 때만** 불러야 합니다. 모듈 고리
 * 캐시에는 나이 검사가 없어서, 아무 때나 채우면 새 런이 나온 뒤에도 옛 고리를
 * 계속 돌려줍니다.
 */
export const primeRingCache = (
  entries: { key: string; data: CloudPathData[]; latitude?: number; longitude?: number }[],
): void => {
  const now = Date.now();
  for (const e of entries) {
    if (!e?.key || !Array.isArray(e.data) || e.data.length === 0 || e.data[0]?.isFallback) continue;
    ringCache.set(e.key, e.data);
    MEM_RING_CACHE.set(e.key, { data: e.data, time: now });
    // w_ 와 ring_ 접두어를 상호 등록하여 캐시 누락 방지
    if (e.key.startsWith('w_')) {
      const rKey = e.key.replace(/^w_/, 'ring_');
      ringCache.set(rKey, e.data);
      MEM_RING_CACHE.set(rKey, { data: e.data, time: now });
    } else if (e.key.startsWith('ring_')) {
      const wKey = e.key.replace(/^ring_/, 'w_');
      ringCache.set(wKey, e.data);
      MEM_RING_CACHE.set(wKey, { data: e.data, time: now });
    }
    if (e.latitude != null && e.longitude != null) {
      const datePart = e.key.split('_')[2];
      if (datePart) {
        const k = ringCacheKey(e.latitude, e.longitude, datePart);
        ringCache.set(k, e.data);
        MEM_RING_CACHE.set(k, { data: e.data, time: now });
      }
    }
  }
};

type RingFallbackFinder = (lat: number, lon: number, dateStr: string) => CloudPathData[] | null;
let ringFallbackFinder: RingFallbackFinder | null = null;
export const setRingFallbackFinder = (fn: RingFallbackFinder | null): void => { ringFallbackFinder = fn; };

/**
 * 성공한 고리를 어디에 남길지 — **호출부가 꽂아 줍니다.**
 *
 * ⚠ 여기서 `persistentCache` 를 직접 부르면 안 됩니다. 그쪽이 `security.ts` 를
 * 타고 `expo-constants` → `expo-modules-core/src/index.ts` 를 끌어오는데, 그
 * 파일은 Metro 전용 TypeScript 소스라 **Node 가 못 읽습니다.** 이 파일은
 * 판정 하네스가 Node 로 컴파일해 쓰는 자리여서, 한 줄 import 로 하네스
 * 아홉 개가 통째로 죽었습니다. 저장은 앱 쪽(`useCelestialStore`)이 꽂습니다.
 */
type RingPersister = (key: string, lat: number, lon: number, data: CloudPathData[]) => void;
let ringPersister: RingPersister | null = null;
export const setRingPersister = (fn: RingPersister | null): void => { ringPersister = fn; };

/** 성공한 고리를 남깁니다. 아무도 안 꽂았으면 조용히 넘어갑니다. */
const persistRing = (key: string, lat: number, lon: number, data: CloudPathData[]): void => {
  try {
    ringPersister?.(key, lat, lon, data);
  } catch (e) {
    console.warn('[WeatherAPI] 고리를 디스크에 못 남겼습니다:', e);
  }
};

/** 링 방위 (12방위, 30° 간격). WeatherFan이 쓰도록 [-180,180]로 매핑합니다. */
const RING_AZIMUTHS = [0, 30, 60, 90, 120, 150, 180, -150, -120, -90, -60, -30];
/** 가까운 고리용 6방위 (60° 간격). 아래 `RING` 주석 참고. */
const RING_AZIMUTHS_NEAR = [0, 60, 120, 180, -120, -60];

/**
 * 링의 거리 고리와 각 고리가 쓸 방위.
 *
 * ## 왜 5km 고리를 더했나 — 머리 위 하늘이 값 하나였습니다
 *
 * 예전 최단 거리는 10km 였습니다. 그 거리가 하늘 어디에 떨어지는지 재보면:
 *
 *   | 층 | 10km 가 놓이는 고도각 | 그 **위**는 전부 관측점 값 하나 |
 *   |---|---|---|
 *   | 저 1.5km | 8.5° | 하늘의 거의 전부 |
 *   | 중 4.5km | 24.2° | |
 *   | 상 10km | 44.9° | |
 *
 * 저층은 **고도 8.5° 위가 통째로 단일값**이었습니다. 황금비로 잘라 배치를
 * 맞춰 보는 판정(1절)이 원리적으로 통과할 수 없는 구조입니다.
 *
 * 5km 고리를 더하면 그 경계가 저층 15°, 중층 38°, 상층 60°로 올라갑니다.
 *
 * ## 왜 5km 인가 — 그보다 가까우면 같은 격자칸입니다
 *
 * 관측점에서 동쪽으로 0/1/2/3/5/8/12/20/30km 떨어진 점을 한 번에 물어
 * 모델이 언제 다른 칸을 주는지 쟀습니다 (2026-09, 서울):
 *
 *   0~3km  → 전부 같은 칸, 값도 소수점까지 동일
 *   5km    → 처음으로 다른 칸
 *
 * 유효 격자가 **약 5.5km** 입니다(경도 0.0625°). `best_match` 가 이 지역에서
 * 실제로 JMA MSM 을 쓰고 있고, 둘의 응답이 완전히 같습니다. 2~3km 고리를
 * 더해 봐야 관측점 값의 복사본만 늘어납니다.
 *
 * ## 왜 가까운 고리만 방위 6개인가
 *
 * 반경 5km 에서 12방위는 이웃 점 간격이 2.6km 로 격자(5.5km)보다 촘촘합니다 —
 * 같은 값 12개를 받으려고 요청을 12번 하는 셈입니다. 6방위면 간격이 5km 라
 * 격자와 맞고, 요청점은 85 → 91 로 7%만 늘어납니다.
 */
const RING: { dist: number; azimuths: number[] }[] = [
  { dist: 5, azimuths: RING_AZIMUTHS_NEAR },
  { dist: 10, azimuths: RING_AZIMUTHS },
  { dist: 30, azimuths: RING_AZIMUTHS },
  { dist: 70, azimuths: RING_AZIMUTHS },
  { dist: 130, azimuths: RING_AZIMUTHS },
  { dist: 200, azimuths: RING_AZIMUTHS },
  { dist: 280, azimuths: RING_AZIMUTHS },
  { dist: 380, azimuths: RING_AZIMUTHS },
];

const ringCache = new Map<string, CloudPathData[]>();

// ---------------------------------------------------------------------------
// 층별 바람 — 관측점 한 점만, 기압면에서
// ---------------------------------------------------------------------------

/**
 * 구름 층 고도에 대응하는 기압면.
 *
 * `LAYER_ALTITUDE_KM` 은 1.5 / 4.5 / 10.0 km 이고, 표준대기에서
 * 850 hPa ≈ 1.5 km, 600 hPa ≈ 4.2 km, 250 hPa ≈ 10.4 km 입니다.
 * 지상 10 m 바람(`wind_speed_10m`)을 쓰지 않는 이유는 그게 구름이 아니라
 * 지표 마찰층을 재기 때문입니다 — 상층운은 지상풍의 서너 배로 흐릅니다.
 */
const WIND_LEVELS = { low: '850hPa', mid: '600hPa', high: '250hPa' } as const;

/** 하루치 층별 바람 시계열. 성분(동/북, km/h)으로 저장합니다. */
/**
 * 단면을 받을 기압면. 16개 전부는 필요 없고 층마다 두세 면이면 무게중심이
 * 잡힙니다. 늘리면 그만큼 호출 가중치가 오릅니다.
 */
// 975·950·900·800·750 은 저층 덱의 윗면을 250m 간격으로 잡으려고 넣었습니다
// (§82). 없으면 850(1.45km)과 700(3.0km) 사이 1.5km 가 비어 운해의 윗면을
// 못 냅니다. 관측점 1점 요청이라 변수 10개 = 가중치 1.0 이 늡니다.
export const PROFILE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 600, 500, 400, 300, 250, 200] as const;

/**
 * 위성 편향 캐시. 같은 격자칸·같은 날이면 다시 안 받습니다.
 * `biasTau === null` 은 "받았지만 쓸 수 없었다"(밤·배율 불신 등)는 뜻이고,
 * 그것도 캐시합니다 — 안 그러면 밤새 같은 요청을 되풀이합니다.
 */
const satBiasCache = new Map<string, { biasTau: number | null; observedUntilMs: number }>();

/** 맑은하늘 배율을 잡는 데 쓰는 되돌아보기(일). 7일이면 30일과 거의 같습니다. */
const SCALE_DAYS = 7;
/** 배율이 이보다 낮으면 못 믿습니다 — 그 주가 내내 흐렸다는 뜻이라 보정을 안 씁니다. */
const MIN_CLEAR_SCALE = 0.6;

/**
 * **위성이 방금 본 하늘과 견줘 예보의 치우침을 잽니다.**
 *
 * 왜 이것이 필요한지, 얼마나 듣는지는 `utils/satelliteBias.ts` 머리말에
 * 있습니다(관측점 총운량 τ오차 −32% — 처음 적은 −45% 는 자의 잡음이 섞인 값이었습니다).
 * 그 편향 하나를 경로 점과 층에 어떻게 나누는지는 같은 머리말의 "거리와 층" 입니다.
 *
 * 요청은 **관측점 1점 · 변수 하나 · 8일**입니다 — 가중치 1회입니다.
 * 과거 예보는 이미 받은 자료 안에 있으므로 따로 안 받습니다.
 *
 * @param observer 관측점의 시간별 자료. `total`(모델 총운량)을 씁니다.
 */
export const fetchSatelliteBias = async (
  lat: number,
  lon: number,
  targetDate: Date,
  observer: HourlyCloudData | null | undefined,
): Promise<{ biasTau: number | null; observedUntilMs: number } | null> => {
  if (!observer?.time?.length || !observer.total) return null;

  const dateStr = localDateString(targetDate);
  const key = `sat_${gridBucket(lat, lon)}_${dateStr}`;
  const hit = satBiasCache.get(key);
  if (hit) return hit;

  const start = new Date(targetDate.getTime() - SCALE_DAYS * 86400_000);
  const url = `https://satellite-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(5)}` +
    `&longitude=${lon.toFixed(5)}&hourly=shortwave_radiation` +
    `&models=satellite_radiation_seamless&start_date=${localDateString(start)}` +
    `&end_date=${dateStr}&timezone=auto`;

  try {
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const t: string[] = data?.hourly?.time ?? [];
    const sw: (number | null)[] = data?.hourly?.shortwave_radiation ?? [];
    if (t.length === 0) throw new Error('empty');

    // ⚠ `timezone=auto` 가 주는 시각에는 시간대 표시가 없습니다. `new Date(s)`
    //   로 읽으면 **기기 시간대**로 해석되어, 기기와 관측지가 다르면 태양 위치가
    //   통째로 어긋납니다(§59 와 같은 부류). 실제로 그렇게 짜 놓고 재니 09:00 의
    //   맑은하늘이 107W/m² 로 나와 배율이 1.895 가 됐습니다 — 9시간 밀린 것입니다.
    //   응답이 주는 `utc_offset_seconds` 로 **참 시각**을 못 박습니다.
    const offsetMs = (data?.utc_offset_seconds ?? 0) * 1000;
    const trueMs = (local: string) => Date.parse(local + 'Z') - offsetMs;

    // 1) 맑은하늘 배율 — 지난 SCALE_DAYS 일의 τ 상위 5%.
    //    Haurwitz 는 연무를 무시하므로 지역마다 몇 % 씩 어긋납니다(§56 README).
    const raws: number[] = [];
    // ⚠ 원시 τ 만 담으면 안 됩니다. `estimateBias` 는 맑은하늘이 80 미만인
    //   표본을 버리므로(태양이 낮으면 잡음이 큼), **일사와 맑은하늘을 그대로**
    //   넘겨야 합니다. 처음에 τ 를 넘기고 맑은하늘을 1 로 뒀다가 전 표본이
    //   버려져 보정이 한 번도 안 걸릴 뻔했습니다.
    const obs: { local: string; raw: number; sw: number; cs: number }[] = [];
    for (let i = 0; i < t.length; i++) {
      if (sw[i] == null) continue;
      const d = new Date(trueMs(t[i]));
      // ⚠ 일사는 **직전 한 시간의 평균**이므로 분모도 같은 창에서 평균해야
      //   합니다. 순간값으로 나누다가 재 보니 아침은 1.53배 흐리게, **일몰은
      //   0.49배 맑게** 읽히고 있었습니다. 배율(p95)은 하루에 하나뿐이라 이
      //   시각별 오차를 못 지웁니다. 이 앱이 겨누는 일몰에서 가장 컸습니다.
      const cs = clearSkyGHIMean(
        d.getTime(),
        ms => Math.sin((getSunPosition(new Date(ms), lat, lon).altitude * Math.PI) / 180),
      );
      if (cs < MIN_CLEAR_GHI) continue;            // 태양고도 15° 미만은 버립니다
      const raw = (sw[i] as number) / cs;
      raws.push(raw);
      // 예보와는 **현지 시각 문자열**로 맞춥니다 — 둘 다 같은 자리의
      // `timezone=auto` 라 문자열이 그대로 겹칩니다. 기기 시간대와 무관합니다.
      obs.push({ local: t[i], raw, sw: sw[i] as number, cs });
    }
    if (raws.length < 20 || obs.length === 0) {
      const miss = { biasTau: null, observedUntilMs: 0 };
      satBiasCache.set(key, miss);
      return miss;
    }
    raws.sort((a, b) => a - b);
    const scale = raws[Math.floor(0.95 * (raws.length - 1))];
    if (!(scale > MIN_CLEAR_SCALE)) {
      const miss = { biasTau: null, observedUntilMs: 0 };
      satBiasCache.set(key, miss);
      return miss;
    }

    // 2) 가장 최근 관측 시각에서 LOOKBACK_HOURS 만큼 거슬러 편향을 모읍니다.
    obs.sort((a, b) => a.local.localeCompare(b.local));
    const lastLocal = obs[obs.length - 1].local;
    const lastMs = trueMs(lastLocal);
    const obsAt = new Map(obs.map(o => [o.local, o]));
    const fcAt = new Map<string, number>();
    for (let i = 0; i < observer.time.length; i++) {
      const v = observer.total?.[i];
      if (v != null) fcAt.set(observer.time[i], v);
    }

    const samples: { forecastCoverPct: number; observedGHI: number; clearSkyGHI: number }[] = [];
    for (let k = 0; k < LOOKBACK_HOURS; k++) {
      // 현지 시각 문자열을 한 시간씩 거슬러 만듭니다.
      const local = new Date(Date.parse(lastLocal + 'Z') - k * 3600_000)
        .toISOString().slice(0, 16);
      const o = obsAt.get(local);
      const cover = fcAt.get(local);
      if (!o || cover == null) continue;
      samples.push({ forecastCoverPct: cover, observedGHI: o.sw, clearSkyGHI: o.cs });
    }
    const biasTau = samples.length ? estimateBias(samples, scale) : null;
    const out = { biasTau, observedUntilMs: lastMs };
    satBiasCache.set(key, out);
    if (__DEV__) {
      console.log(`[SatBias] ${key} 배율 ${scale.toFixed(3)} 편향 ${biasTau?.toFixed(3) ?? 'none'} 표본 ${samples.length}`);
    }
    return out;
  } catch (error) {
    // 보정은 있으면 좋은 것입니다 — 없다고 하늘을 못 그리지 않습니다.
    console.warn('위성 보정을 못 받았습니다. 예보 그대로 갑니다:', error);
    const miss = { biasTau: null, observedUntilMs: 0 };
    satBiasCache.set(key, miss);
    return miss;
  }
};

/**
 * 예보 배열에 편향을 **시각마다** 적용합니다. 앞선 시간이 길수록 덜 적용하고,
 * 6시간을 넘으면 아예 안 합니다(`satelliteBias.ts` 의 감쇠 곡선).
 *
 * ⚠ 편향은 **관측점 1점**에서 낸 것입니다. 점마다 거리로 줄이고, 층에는 모델이 둔 구름에
 * 비례해 나눕니다(`correctCloudAt`). 예전에는 380km 밖 저·중·상층에 똑같이 더해 후쿠이
 * 2026-10-02 의 서쪽 바다 위에 없던 저층 28~51% 를 만들었습니다(`satelliteBias.ts` 머리말).
 */
function applyBiasToPath(path: CloudPathData[], bias: number | null, observedUntilMs: number): void {
  if (bias == null || !Number.isFinite(observedUntilMs) || observedUntilMs <= 0) return;
  for (const p of path) {
    const h = p.hourly;
    if (!h?.timeMs) continue;
    for (let i = 0; i < h.timeMs.length; i++) {
      const lead = (h.timeMs[i] - observedUntilMs) / 3600_000;
      const c = correctCloudAt(
        { low: h.low[i] ?? 0, mid: h.mid[i] ?? 0, high: h.high[i] ?? 0, total: h.total?.[i] },
        bias, lead, p.distance,
      );
      h.low[i] = c.low;
      h.mid[i] = c.mid;
      h.high[i] = c.high;
      if (h.total && h.total[i] != null && c.total != null) h.total[i] = c.total;
    }
  }
}

export interface LayerWindHourly {
  time: string[];
  windULow: number[]; windVLow: number[];
  windUMid: number[]; windVMid: number[];
  windUHigh: number[]; windVHigh: number[];
  /**
   * 예보 단면에서 뽑은 **층별 실제 높이**(km). 시각마다 다릅니다.
   *
   * 앱은 예전에 `{1.5, 4.5, 10.0}` 을 박아 썼습니다. 실기에서 상층운이
   * 9,652m 에 있는데 10,000m 에 그렸고, 같은 "상층운" 이 7,556m 이거나
   * 12,400m 여도 늘 10km 였습니다(§66.1). 구름이 없는 층은 예전 상수로
   * 물러납니다 — 그릴 것이 없으면 높이도 뜻이 없습니다.
   */
  layerAltLowKm?: number[];
  layerAltMidKm?: number[];
  layerAltHighKm?: number[];
  /** 저층 덱 밑면·윗면(km, 해발) — 운해의 윗면(§82). 빈 시각은 NaN. */
  lowDeckBaseKm?: number[];
  lowDeckTopKm?: number[];
  /**
   * 기압면 단면 그대로 — [면 (`PROFILE_LEVELS` 순서)][시각]. 높이(m)·운량(%).
   * 빈 칸은 NaN. 산 위 관측자가 구름 속인지는 관측 고도를 알아야 풀 수 있어서
   * (DEM 은 앱에서 옵니다) 요약하지 않고 통째로 싣습니다(§93).
   */
  profileHeightM?: number[][];
  profileCoverPct?: number[][];
  /**
   * 시정(m). 바람과 상관없지만 **여기 얹혀 옵니다.**
   *
   * 큰 팬 요청은 ecmwf+icon 을 쓰는데 둘 다 시정을 null 로 줍니다. 그것 하나
   * 때문에 큰 요청에 best_match 를 더하면 변수가 8→24 가 되어 호출 수가
   * 2.4배로 셉니다(Open-Meteo 는 변수 10개 초과분을 곱해 셉니다).
   * 이 요청은 관측점 1점 · 변수 6개라 하나 더 실어도 10 미만 — 공짜입니다.
   * 그리고 시정은 원래 **관측점에서만** 쓰입니다.
   */
  visibility?: number[];
}

export interface AirQualityHourly {
  time: string[];
  aod550: (number | null)[];
  dust: (number | null)[];
  pm25: (number | null)[];
  pm10: (number | null)[];
}

const airCache = new Map<string, AirQualityHourly | null>();

/**
 * 관측점 한 곳의 하루치 대기질(2026-10-01) — CAMS 에어로졸 광학두께·먼지·PM.
 *
 * 노을 색은 구름만큼 공기 속 입자에 달려 있는데, 예전에는 그것을 **시정**으로만 짐작했습니다. 시정은
 * 지표 근처 모델 값이라 상공의 황사·연기 층을 모릅니다. CAMS 는 위성 AOD 를 동화한 기둥 전체 값입니다
 * (`sunsetPhysics.AOD_TO_APP_BETA` 주석).
 *
 * 바람과 같은 원칙입니다: 따로 요청하고, 실패하면 null — 그때 예측은 예전 시정 식으로 내려앉습니다.
 * CAMS 전 지구 예보는 약 5일까지라, 그보다 먼 날은 자료가 없고 그것이 정상입니다.
 */
export const fetchAirQuality = async (
  lat: number,
  lon: number,
  targetDate: Date = new Date(),
  signal?: AbortSignal
): Promise<AirQualityHourly | null> => {
  const dateStr = localDateString(targetDate);
  const key = `aq_${gridBucket(lat, lon)}_${dateStr}`;
  if (airCache.has(key)) return airCache.get(key) ?? null;

  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}` +
    `&hourly=aerosol_optical_depth,dust,pm2_5,pm10&start_date=${dateStr}&end_date=${dateStr}&timezone=auto`;
  try {
    const response = await fetchWithTimeout(url, { signal }, 8000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data?.error) throw new Error(data.reason || 'unknown');
    const h = data?.hourly;
    const time: string[] = Array.isArray(h?.time) ? h.time : [];
    const aod: (number | null)[] | undefined = h?.aerosol_optical_depth;
    if (time.length === 0 || !Array.isArray(aod) || !aod.some(v => v != null)) throw new Error('empty');
    const col = (a: unknown): (number | null)[] =>
      time.map((_, i) => {
        const v = Array.isArray(a) ? a[i] : null;
        return typeof v === 'number' && Number.isFinite(v) ? v : null;
      });
    const out: AirQualityHourly = { time, aod550: col(aod), dust: col(h.dust), pm25: col(h.pm2_5), pm10: col(h.pm10) };
    airCache.set(key, out);
    return out;
  } catch (error) {
    if (__DEV__) console.warn('대기질을 받지 못했습니다. 시정으로 진행합니다:', error);
    airCache.set(key, null);
    return null;
  }
};

/**
 * 대기질을 관측점 시각 축에 붙입니다. 시각 **문자열**로 맞추고, 짝이 없는 시각은 null 로 둡니다 —
 * 바람처럼 앞 시각을 물려받지 않습니다. 에어로졸은 없는 값을 지어내면 그 날의 색이 통째로 바뀝니다.
 */
export function attachAirQuality(hourly: HourlyCloudData, aq: AirQualityHourly): void {
  const pos = new Map<string, number>();
  aq.time.forEach((t, i) => pos.set(t, i));
  const pick = (src: (number | null)[]) => hourly.time.map(t => {
    const j = pos.get(t);
    return j === undefined ? null : src[j] ?? null;
  });
  hourly.aod550 = pick(aq.aod550);
  hourly.dust = pick(aq.dust);
  hourly.pm25 = pick(aq.pm25);
  hourly.pm10 = pick(aq.pm10);
}

/**
 * §135 열역학 입력 하루치 — 응결고도(지상 기온·이슬점)·안정도/역전(기압면 기온)·상대습도·CAPE·결빙고도·경계층 높이.
 * 구름 종류별 물리(밑면 높이, 물/얼음, 단열 물 함량)를 예보에서 정하는 재료입니다.
 *
 * Why 바람 요청에 **얹지 않고 따로** 받는가: 변수 하나가 모델·기간에 없어서 400 이 나면 요청이 통째로 실패합니다. 바람 요청에
 * 얹으면 바람·기압면 단면까지 같이 잃습니다. 따로 두면 열역학만 포기합니다(소비자는 없는 값을 NaN 으로 보고 예전 상수로 갑니다).
 * 변수 수는 5 + 15 + 13 = 33 → 호출 가중치 3.3. 관측점 1점·(위경도 칸, 날짜)당 한 번 받고 캐시합니다.
 *
 * 아카이브(5일 넘은 과거)는 CAPE·결빙고도·기압면 기온·습도를 주지 않습니다(단위가 `undefined` 로 와서 값이 전부 null,
 * 2026-10 확인). 그때는 NaN 으로 채워 돌려줍니다 — 지상 기온·이슬점·경계층 높이만 값이 있습니다.
 */
export const THERMO_TEMP_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 600, 500, 400, 300, 250, 200] as const;
/** 상대습도는 300 hPa 위(권운 높이)는 모델이 믿을 만하지 않아 받지 않습니다. */
export const THERMO_RH_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 600, 500, 400, 300] as const;

export interface ThermoHourly {
  time: string[];
  /** 지상 2 m 기온·이슬점(°C) */
  t2mC: number[]; td2mC: number[];
  /** CAPE(J/kg) · 결빙고도(m, 해발) · 경계층 높이(m). 없으면 NaN. */
  capeJkg: number[]; freezingLevelM: number[]; pblM: number[];
  /** [면 (`THERMO_TEMP_LEVELS` 순서)][시각] 기온(°C) / [면 (`THERMO_RH_LEVELS` 순서)][시각] 상대습도(%). 빈 칸 NaN. */
  profileTempC: number[][];
  profileRhPct: number[][];
}

const thermoCache = new Map<string, ThermoHourly | null>();

export const fetchThermoProfile = async (
  lat: number,
  lon: number,
  targetDate: Date = new Date(),
  signal?: AbortSignal
): Promise<ThermoHourly | null> => {
  const dateStr = localDateString(targetDate);
  const key = `thermo_${gridBucket(lat, lon)}_${dateStr}`;
  if (thermoCache.has(key)) return thermoCache.get(key) ?? null;

  const vars = ['temperature_2m', 'dew_point_2m', 'cape', 'freezing_level_height', 'boundary_layer_height']
    .concat(THERMO_TEMP_LEVELS.map(p => `temperature_${p}hPa`))
    .concat(THERMO_RH_LEVELS.map(p => `relative_humidity_${p}hPa`))
    .join(',');
  const diffDays = Math.ceil((Date.now() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
  const base = diffDays > 5
    ? 'https://archive-api.open-meteo.com/v1/archive'
    : 'https://api.open-meteo.com/v1/forecast';
  const url = `${base}?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}` +
    `&hourly=${vars}&start_date=${dateStr}&end_date=${dateStr}&timezone=auto`;

  try {
    const response = await fetchWithTimeout(url, { signal }, 12000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data?.error) throw new Error(data.reason || 'unknown');
    const h = data?.hourly;
    const time: string[] = Array.isArray(h?.time) ? h.time : [];
    if (time.length === 0) throw new Error('empty');
    const col = (k: string): number[] => time.map((_, i) => {
      const v = (h[k] as (number | null)[] | undefined)?.[i];
      return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
    });
    const out: ThermoHourly = {
      time,
      t2mC: col('temperature_2m'), td2mC: col('dew_point_2m'),
      capeJkg: col('cape'), freezingLevelM: col('freezing_level_height'), pblM: col('boundary_layer_height'),
      profileTempC: THERMO_TEMP_LEVELS.map(p => col(`temperature_${p}hPa`)),
      profileRhPct: THERMO_RH_LEVELS.map(p => col(`relative_humidity_${p}hPa`)),
    };
    // 값이 하나도 없으면(지원하지 않는 모델·기간) 없는 것으로 캐시합니다.
    if (!out.t2mC.some(Number.isFinite) && !out.profileTempC.some(a => a.some(Number.isFinite))) throw new Error('no values');
    thermoCache.set(key, out);
    return out;
  } catch (error) {
    // 열역학은 있으면 좋은 재료입니다 — 없다고 하늘을 못 그리지 않습니다(소비자는 예전 상수로 진행).
    if (__DEV__) console.warn('열역학 입력을 받지 못했습니다. 예전 상수로 진행합니다:', error);
    thermoCache.set(key, null);
    return null;
  }
};

/**
 * 열역학 시계열을 관측점 시각 **문자열**에 맞춰 붙입니다. 짝이 없는 시각은 NaN — 바람처럼 앞 시각을 물려받지 않습니다
 * (CAPE·결빙고도를 지어내면 종류 판정이 통째로 바뀝니다).
 */
export function attachThermo(hourly: HourlyCloudData, t: ThermoHourly): void {
  const same = t.time.length === hourly.time.length && t.time.every((x, i) => x === hourly.time[i]);
  const pos = new Map<string, number>();
  if (!same) t.time.forEach((x, i) => pos.set(x, i));
  const pick = (src: number[]): number[] => same ? src : hourly.time.map(x => { const j = pos.get(x); return j === undefined ? NaN : src[j]; });
  hourly.t2mC = pick(t.t2mC);
  hourly.td2mC = pick(t.td2mC);
  hourly.capeJkg = pick(t.capeJkg);
  hourly.freezingLevelM = pick(t.freezingLevelM);
  hourly.pblM = pick(t.pblM);
  hourly.profileTempC = t.profileTempC.map(pick);
  hourly.profileRhPct = t.profileRhPct.map(pick);
}

const windCache = new Map<string, LayerWindHourly | null>();

/**
 * 관측점의 층별 바람을 하루치 받아옵니다.
 *
 * Why 링과 **따로** 요청하는가:
 * 1. 기압면 변수는 모델에 따라 없을 수 있습니다. 링 요청에 끼워 넣으면
 *    변수 하나 때문에 **운량까지 통째로** 실패합니다. 따로 두면 바람만
 *    포기하고 대용 상수로 내려앉습니다.
 * 2. 바람은 하늘 전체에 하나의 이류 벡터로 쓰므로 84개 지점이 필요 없습니다.
 *    한 점이면 충분하고, 그만큼 요청이 가볍습니다.
 *
 * 실패하면 `null` 을 돌려주고 **그 사실을 캐시합니다** — 지원하지 않는
 * 지역/날짜에서 매번 다시 두드리지 않도록.
 */
export const fetchLayerWinds = async (
  lat: number,
  lon: number,
  targetDate: Date = new Date(),
  signal?: AbortSignal
): Promise<LayerWindHourly | null> => {
  const dateStr = localDateString(targetDate);
  const key = `wind_${gridBucket(lat, lon)}_${dateStr}`;
  if (windCache.has(key)) return windCache.get(key) ?? null;

  // 바람 6 + 시정 1 + 기압면 단면 20 = 27개 → 가중치 2.7회. **관측점 1점**
  // 요청이라 절대량은 미미합니다(§58 의 합계 186 에 2.7). 팬에는 안 붙입니다 —
  // 36점에 붙이면 감당이 안 됩니다.
  const vars = (['low', 'mid', 'high'] as const)
    .flatMap(k => [`wind_speed_${WIND_LEVELS[k]}`, `wind_direction_${WIND_LEVELS[k]}`])
    .concat(['visibility'])
    .concat(PROFILE_LEVELS.flatMap(p => [`cloud_cover_${p}hPa`, `geopotential_height_${p}hPa`]))
    .join(',');

  const diffDays = Math.ceil((Date.now() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
  const base = diffDays > 5
    ? 'https://archive-api.open-meteo.com/v1/archive'
    : 'https://api.open-meteo.com/v1/forecast';
  const url = `${base}?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}` +
    `&hourly=${vars}&start_date=${dateStr}&end_date=${dateStr}&timezone=auto`;

  try {
    const response = await fetchWithTimeout(url, { signal }, 12000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data?.error) throw new Error(data.reason || 'unknown');
    const h = data?.hourly;
    const time: string[] = Array.isArray(h?.time) ? h.time : [];
    if (time.length === 0) throw new Error('empty');

    const comps = (k: 'low' | 'mid' | 'high') => {
      const sp = h[`wind_speed_${WIND_LEVELS[k]}`];
      const dir = h[`wind_direction_${WIND_LEVELS[k]}`];
      if (!Array.isArray(sp) || !Array.isArray(dir)) return null;
      const u = new Array<number>(time.length);
      const v = new Array<number>(time.length);
      for (let i = 0; i < time.length; i++) {
        const speed = sp[i];
        const from = dir[i];
        if (speed == null || from == null) { u[i] = 0; v[i] = 0; continue; }
        // 기상 방위는 **불어오는 쪽**입니다. 이류 벡터는 그 반대이므로
        // 180°를 돌려 (동, 북) 성분으로 바꿉니다.
        const rad = ((from + 180) * Math.PI) / 180;
        u[i] = speed * Math.sin(rad);
        v[i] = speed * Math.cos(rad);
      }
      return { u, v };
    };

    const cl = comps('low'), cm = comps('mid'), ch = comps('high');
    if (!cl || !cm || !ch) throw new Error('missing level');

    const out: LayerWindHourly = {
      time,
      windULow: cl.u, windVLow: cl.v,
      windUMid: cm.u, windVMid: cm.v,
      windUHigh: ch.u, windVHigh: ch.v,
    };
    // 시정은 없어도 바람은 살립니다 — 있을 때만 싣습니다.
    if (Array.isArray(h.visibility) && h.visibility.some((v: unknown) => v != null)) {
      out.visibility = h.visibility;
    }

    // 단면에서 시각마다 층 높이를 뽑습니다. 단면이 없으면 아예 안 싣고,
    // 그러면 소비자가 예전 상수를 그대로 씁니다.
    if (PROFILE_LEVELS.some(p => Array.isArray(h[`cloud_cover_${p}hPa`]))) {
      const lo: number[] = [], mi: number[] = [], hi: number[] = [];
      // 덱 밑면·윗면. 저층이 빈 시각은 NaN — 보간이 NaN 을 퍼뜨리므로
      // 소비자는 Number.isFinite 로 거릅니다(null 은 배열 보간이 못 받음).
      const db: number[] = [], dt: number[] = [];
      for (let i = 0; i < time.length; i++) {
        const prof = extractProfile(h, i);
        const a = layerAltitudes(prof);
        lo.push(a.lowKm); mi.push(a.midKm); hi.push(a.highKm);
        const d = lowDeck(prof);
        db.push(d ? d.baseKm : NaN); dt.push(d ? d.topKm : NaN);
      }
      out.layerAltLowKm = lo; out.layerAltMidKm = mi; out.layerAltHighKm = hi;
      out.lowDeckBaseKm = db; out.lowDeckTopKm = dt;
      const col = (key: string) => time.map((_, i) => {
        const v = (h[key] as (number | null)[] | undefined)?.[i];
        return v == null || !Number.isFinite(v) ? NaN : v;
      });
      out.profileHeightM = PROFILE_LEVELS.map(p => col(`geopotential_height_${p}hPa`));
      out.profileCoverPct = PROFILE_LEVELS.map(p => col(`cloud_cover_${p}hPa`));
    }
    windCache.set(key, out);
    return out;
  } catch (error) {
    // 바람은 있으면 좋은 재료입니다 — 없다고 하늘을 못 그리지 않습니다.
    console.warn('층별 바람을 받지 못했습니다. 대용 상수로 진행합니다:', error);
    windCache.set(key, null);
    return null;
  }
};

/**
 * 바람 시계열을 운량 시계열의 **시각 축에 맞춰** 붙입니다.
 *
 * 두 요청은 같은 날짜·같은 `timezone=auto` 라 보통 시각이 그대로 겹치지만,
 * 모델이 다르면 시간 수가 어긋날 수 있습니다. 길이가 같을 때만 그대로 쓰고,
 * 다르면 시각 문자열로 맞춥니다. 못 맞춘 시각은 0(무풍)이 아니라
 * **가장 가까운 앞 시각**을 물려받습니다.
 */
function attachLayerWinds(hourly: HourlyCloudData, w: LayerWindHourly): void {
  const keys = ['windULow', 'windVLow', 'windUMid', 'windVMid', 'windUHigh', 'windVHigh'] as const;
  // 층 높이도 이 요청에 얹혀 옵니다. 시각 축이 그대로 겹칠 때만 씁니다 —
  // 어긋난 채로 붙이면 엉뚱한 시각의 높이가 들어갑니다.
  if (w.layerAltLowKm && w.time.length === hourly.time.length) {
    hourly.layerAltLowKm = w.layerAltLowKm;
    hourly.layerAltMidKm = w.layerAltMidKm;
    hourly.layerAltHighKm = w.layerAltHighKm;
    hourly.lowDeckBaseKm = w.lowDeckBaseKm;
    hourly.lowDeckTopKm = w.lowDeckTopKm;
    hourly.profileHeightM = w.profileHeightM;
    hourly.profileCoverPct = w.profileCoverPct;
  }
  // 시정은 이 요청에 얹혀 옵니다(LayerWindHourly.visibility 주석). 큰 요청이
  // 이미 시정을 받았으면 덮지 않습니다 — 아카이브 경로가 그렇습니다.
  if (w.visibility && !hourly.visibility) {
    if (w.time.length === hourly.time.length) {
      hourly.visibility = w.visibility;
    } else {
      const at = new Map<string, number>();
      w.time.forEach((t, i) => at.set(t, i));
      hourly.visibility = hourly.time.map(t => {
        const j = at.get(t);
        return j !== undefined ? w.visibility![j] : 10000;
      });
    }
  }
  if (w.time.length === hourly.time.length) {
    for (const k of keys) hourly[k] = w[k];
    return;
  }
  const pos = new Map<string, number>();
  w.time.forEach((t, i) => pos.set(t, i));
  for (const k of keys) {
    const src = w[k];
    const dst = new Array<number>(hourly.time.length);
    let last = 0;
    for (let i = 0; i < hourly.time.length; i++) {
      const j = pos.get(hourly.time[i]);
      if (j !== undefined && src[j] != null) last = src[j];
      dst[i] = last;
    }
    hourly[k] = dst;
  }
}

/**
 * 하루치 날씨를 **360° 전 방위**로 한 번에 받아옵니다.
 *
 * Why 팬이 아니라 링인가:
 * `fetchSunsetWeather`의 팬은 **태양 방위 중심**이라 캐시 키에 방위 버킷이
 * 들어갑니다. 시간을 옮기면 태양 방위가 30° 버킷을 넘어가고, 그때마다
 * 캐시 미스 → 재요청입니다. 하루를 스크럽하면 방위가 180° 넘게 도니
 * 같은 날 같은 장소인데도 6번 이상 새로 받습니다. "날씨를 매번 받아온다"의
 * 정체가 이것입니다.
 *
 * 링은 방위에 의존하지 않으므로 **(위경도, 날짜)당 한 번**이면 끝입니다.
 * 덤으로 품질도 올라갑니다 — 팬은 ±20°만 실측이라 나머지 하늘은
 * 관측점 값 + 노이즈로 메웠는데(신뢰도 0), 링은 전 방위가 실측입니다.
 *
 * 반환 `azimuthOffset`은 **절대 방위**(-180~180)입니다. 그래서
 * `new WeatherFan(samples, 0)` 으로 감싸면 됩니다 (중심 0 = 북).
 */
export const fetchDayWeatherRing = async (
  lat: number,
  lon: number,
  targetDate: Date = new Date(),
  forceRefresh: boolean = false,
  signal?: AbortSignal
): Promise<CloudPathData[]> => {
  const targetDateStr = localDateString(targetDate);
  // ⚠ 예전에는 `lat.toFixed(3)` — **111m** 였습니다. §68 에서 일몰 날씨 키를,
  //   §77 에서 스토어 키를 격자 크기로 고쳤는데 **고리만 남아 있었습니다.**
  //   같은 부류의 세 번째 자리입니다. 111m 움직일 때마다 139KB 를 다시 받습니다.
  const cacheKey = ringCacheKey(lat, lon, targetDateStr);
  if (forceRefresh) {
    MEM_RING_CACHE.delete(cacheKey);
    ringCache.delete(cacheKey);
    INFLIGHT_REQUESTS.delete(cacheKey);
  } else {
    const cachedEntry = MEM_RING_CACHE.get(cacheKey) || MEM_RING_CACHE.get(cacheKey.replace(/^ring_/, 'w_'));
    if (cachedEntry) {
      const isFallback = Boolean(cachedEntry.data?.[0]?.isFallback);
      const ttl = isFallback ? FALLBACK_CACHE_TTL_MS : CACHE_TTL_MS;
      if (Date.now() - cachedEntry.time < ttl) {
        if (__DEV__) console.log(`[WeatherAPI] Ring cache hit for ${cacheKey} (fallback: ${isFallback})`);
        return cachedEntry.data;
      }
    }

    const fallbackData = ringFallbackFinder?.(lat, lon, targetDateStr);
    if (fallbackData && fallbackData.length > 0 && !fallbackData[0]?.isFallback) {
      if (__DEV__) console.log(`[WeatherAPI] Fallback store cache hit for ${cacheKey}`);
      ringCache.set(cacheKey, fallbackData);
      MEM_RING_CACHE.set(cacheKey, { data: fallbackData, time: Date.now() });
      return fallbackData;
    }

    if (INFLIGHT_REQUESTS.has(cacheKey)) {
      if (__DEV__) console.log(`[WeatherAPI] Joining inflight ring request for ${cacheKey}`);
      return INFLIGHT_REQUESTS.get(cacheKey)!;
    }
  }

  const ringPromise = (async () => {
    // 관측점 + 고리별 방위 (위 `RING` 주석: 가까운 고리는 방위 6개)
    const virtualPoints: { dist: number; az: number; lat: number; lon: number }[] = [
      { dist: 0, az: 0, lat, lon },
    ];
    for (const ring of RING) {
      for (const az of ring.azimuths) {
        const dest = calculateDestination(lat, lon, ring.dist, az);
        virtualPoints.push({ dist: ring.dist, az, lat: dest.latitude, lon: dest.longitude });
      }
    }

    // 가까운 고리는 12방위가 수 km 간격이라 예보 격자(약 11km) 한 칸에 여럿이
    // 들어갑니다. 좌표를 반올림해 중복 요청을 없앱니다.
    const uniquePoints: { lat: number; lon: number; key: string }[] = [];
    const seen = new Map<string, number>();
    const keyOf = (la: number, lo: number) => `${la.toFixed(4)},${lo.toFixed(4)}`;
    const idxOf: number[] = virtualPoints.map(vp => {
      const k = keyOf(vp.lat, vp.lon);
      let i = seen.get(k);
      if (i === undefined) {
        i = uniquePoints.length;
        seen.set(k, i);
        uniquePoints.push({ lat: vp.lat, lon: vp.lon, key: k });
      }
      return i;
    });

    const cLats = uniquePoints.map(p => p.lat.toFixed(5)).join(',');
    const cLons = uniquePoints.map(p => p.lon.toFixed(5)).join(',');

    const diffDays = Math.ceil((Date.now() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
    const isHistorical = diffDays > 5;

    const url = isHistorical
      ? `https://archive-api.open-meteo.com/v1/archive?latitude=${cLats}&longitude=${cLons}` +
        `&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m,direct_normal_irradiance,precipitation` +
        `&start_date=${targetDateStr}&end_date=${targetDateStr}&timezone=auto`
      : `https://api.open-meteo.com/v1/forecast?latitude=${cLats}&longitude=${cLons}` +
        `&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,direct_normal_irradiance,total_column_integrated_water_vapour,precipitation` +
        `&start_date=${targetDateStr}&end_date=${targetDateStr}&timezone=auto${BLEND_MODELS_PARAM}`;

    // 1) 360° 메인 구름 링 먼저 수신
    const response = await fetchWithTimeout(url, { signal }, 15000);
    if (!response.ok) {
      if (response.status === 429) {
        console.warn(`[WeatherAPI] fetchCloudRing 429 rate limit. Using synthetic clear sky fallback.`);
        const ringFallback = createClearSkyFallback(virtualPoints.map(vp => ({ dist: vp.dist, azimuthOffset: vp.az })), targetDate, 'standard');
        MEM_RING_CACHE.set(cacheKey, { data: ringFallback, time: Date.now() });
        INFLIGHT_REQUESTS.delete(cacheKey);
        return ringFallback;
      }
      throw new Error(`HTTP_ERROR: 날씨 데이터를 가져오지 못했습니다. (${response.status})`);
    }
    const data = await response.json();
    if (data?.error) {
      if (data?.reason && (data.reason.includes('limit reached') || data.reason.includes('Hourly limit') || data.reason.includes('Minutely usage'))) {
        console.warn(`[WeatherAPI] fetchCloudRing rate limit error. Using synthetic clear sky fallback.`);
        const ringFallback = createClearSkyFallback(virtualPoints.map(vp => ({ dist: vp.dist, azimuthOffset: vp.az })), targetDate, 'standard');
        MEM_RING_CACHE.set(cacheKey, { data: ringFallback, time: Date.now() });
        INFLIGHT_REQUESTS.delete(cacheKey);
        return ringFallback;
      }
      throw new Error(`HTTP_ERROR: ${data.reason || 'Unknown'}`);
    }

    // 2) 메인 링이 성공했을 때만 바람 및 대기질을 이어서 요청 (429일 때 불필요한 추가 요청 폭주 방지)
    const [winds, air, thermo] = await Promise.all([
      fetchLayerWinds(lat, lon, targetDate, signal),
      fetchAirQuality(lat, lon, targetDate, signal),
      fetchThermoProfile(lat, lon, targetDate, signal),
    ]);
    const results = Array.isArray(data) ? data : [data];

    const out: CloudPathData[] = virtualPoints.map((vp, i) => {
      const res = results[idxOf[i]];
      const rh = blendHourly(res?.hourly) as any;
      const time: string[] = rh?.time ?? [];
      const fill = (a: any) => (Array.isArray(a) && a.length ? a : Array(Math.max(1, time.length)).fill(0));
      const hourly: HourlyCloudData = {
        time,
        timeMs: time.map((t: string) => new Date(t).getTime()),
        low: fill(rh?.cloud_cover_low),
        mid: fill(rh?.cloud_cover_mid),
        high: fill(rh?.cloud_cover_high),
        total: Array.isArray(rh?.cloud_cover) ? rh.cloud_cover : undefined,
        directNormalIrradiance: rh?.direct_normal_irradiance,
        totalColumnWaterVapour: rh?.total_column_integrated_water_vapour,
        precipitation: rh?.precipitation,
      };
      if (i === 0) {
        if (Array.isArray(rh?.visibility)) hourly.visibility = rh.visibility;
        if (Array.isArray(rh?.relative_humidity_2m)) hourly.humidity = rh.relative_humidity_2m;
        if (winds) attachLayerWinds(hourly, winds);
        if (thermo) attachThermo(hourly, thermo);
        if (air) attachAirQuality(hourly, air);
      }
      return { distance: vp.dist, azimuthOffset: vp.az, hourly, source: 'standard' as const };
    });

    for (const p of out.filter(p => p.azimuthOffset === 180)) {
      out.push({ ...p, azimuthOffset: -180 });
    }

    ringCache.set(cacheKey, out);
    MEM_RING_CACHE.set(cacheKey, { data: out, time: Date.now() });
    // ⚠ **진짜 자료일 때만** 디스크에 남깁니다. 위쪽 한도 초과 갈래의
    //   맑은하늘 대용값은 지어낸 것이라 저장하면 안 됩니다 — 저장하면
    //   다음 실행이 그걸 "받아 둔 고리" 로 믿습니다.
    persistRing(cacheKey, lat, lon, out);
    INFLIGHT_REQUESTS.delete(cacheKey);
    return out;
  })();

  INFLIGHT_REQUESTS.set(cacheKey, ringPromise);
  try {
    return await ringPromise;
  } catch (err) {
    INFLIGHT_REQUESTS.delete(cacheKey);
    throw err;
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
      total: interpolateOpt(p.hourly.total),
      layerAltLowKm: interpolateOpt(p.hourly.layerAltLowKm),
      layerAltMidKm: interpolateOpt(p.hourly.layerAltMidKm),
      layerAltHighKm: interpolateOpt(p.hourly.layerAltHighKm),
      lowDeckBaseKm: interpolateOpt(p.hourly.lowDeckBaseKm),
      lowDeckTopKm: interpolateOpt(p.hourly.lowDeckTopKm),
      // 면마다 따로 시각 보간합니다. 빈 칸(NaN)은 NaN 으로 남아 소비자가 거릅니다.
      profileHeightM: p.hourly.profileHeightM?.map(a => interpolateOpt(a) ?? NaN),
      profileCoverPct: p.hourly.profileCoverPct?.map(a => interpolateOpt(a) ?? NaN),
      // §135 열역학: NaN 은 NaN 으로 보간됩니다(받지 못한 시각을 값으로 지어내지 않음). 소비자는 Number.isFinite 로 거릅니다.
      t2mC: interpolateOpt(p.hourly.t2mC),
      td2mC: interpolateOpt(p.hourly.td2mC),
      capeJkg: interpolateOpt(p.hourly.capeJkg),
      freezingLevelM: interpolateOpt(p.hourly.freezingLevelM),
      pblM: interpolateOpt(p.hourly.pblM),
      profileTempC: p.hourly.profileTempC?.map(a => interpolateOpt(a) ?? NaN),
      profileRhPct: p.hourly.profileRhPct?.map(a => interpolateOpt(a) ?? NaN),
      visibility: interpolateOpt(p.hourly.visibility),
      humidity: interpolateOpt(p.hourly.humidity),
      aod550: interpolateOpt(p.hourly.aod550 as number[] | undefined),
      dust: interpolateOpt(p.hourly.dust as number[] | undefined),
      pm25: interpolateOpt(p.hourly.pm25 as number[] | undefined),
      pm10: interpolateOpt(p.hourly.pm10 as number[] | undefined),
      directNormalIrradiance: interpolateOpt(p.hourly.directNormalIrradiance),
      totalColumnWaterVapour: interpolateOpt(p.hourly.totalColumnWaterVapour),
      precipitation: interpolateOpt(p.hourly.precipitation),
      // 성분이라 선형 보간이 그대로 맞습니다 (CloudData 주석 참고).
      windULow: interpolateOpt(p.hourly.windULow),
      windVLow: interpolateOpt(p.hourly.windVLow),
      windUMid: interpolateOpt(p.hourly.windUMid),
      windVMid: interpolateOpt(p.hourly.windVMid),
      windUHigh: interpolateOpt(p.hourly.windUHigh),
      windVHigh: interpolateOpt(p.hourly.windVHigh),
    };
  });
};

/**
 * 지구 반지름 (m). `TerrainRing.seaHorizonDipDeg` 와 **같은 값**이어야 합니다.
 *
 * `createTerrainBands` 는 `raw > -dipDeg` 로 "산인가 물인가"를 가릅니다.
 * 그 판정이 성립하려면 지형각과 수평선이 **같은 지구**를 써야 합니다 —
 * 곡률이 빠지면 40km 의 해수면이 -0.043° 로 읽혀 수평선(-0.176°)보다 위에
 * 뜨고, 그러면 바다가 산으로 오인돼 수면 위에 회색 띠가 남습니다.
 * (44절에서 지면과 구름이 서로 다른 지평선을 써서 띠가 벌어진 적이 있습니다.)
 */

export interface TerrainData {
  panoramicAngles: number[]; // Max of all distances (near/mid/far)
  farAngles: number[];       // Only distant mountains (15km, 40km)
  /**
   * 거리대별 지형각 `[거리대][방위]`.
   *
   * 위 두 배열은 거리를 최댓값으로 뭉갠 것이라 "가까운 능선 뒤에 먼 능선"이
   * 사라집니다. 그 정보가 거리별 대기 투시의 재료입니다
   * (docs/GROUND_PLAN.md 3단계).
   */
  bandAngles: number[][];
  /** `bandAngles`의 거리 (km) */
  bandDistancesKm: number[];
  /**
   * 방위별 수역 비율 0~1.
   *
   * Open-Meteo elevation API는 **해상에서 정확히 0.0**을 반환합니다
   * (육지는 0이 아닌 정수). 새 데이터원 없이 바다를 읽을 수 있습니다.
   * ⚠ 해수면 높이의 해안 평야도 0으로 읽힙니다 — 드물고 시각적으로 물
   * 근처라 실패해도 크게 어긋나지 않지만, 한계로 남겨 둡니다.
   */
  waterFrac: number[];
  minAz: number;
  maxAz: number;
  observerElevation?: number; // Observer elevation in meters
  /** 각 샘플 포인트(SAMPLES 31 × DISTANCES 3)의 실제 고도값 (미터). 2D 수역 마스크 보간에 사용 */
  elevations?: number[];
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

  const preset = findPresetTerrain(lat, lon);
  if (preset) {
    terrainCache.set(cacheKey, preset);
    return preset;
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

    // Open-Meteo Elevation API (단일 요청 배치)
    try {
      const response = await fetchWithTimeout(url, {}, 6000);
      if (response.status === 429) {
        if (__DEV__) console.warn('[TerrainAPI] Open-Meteo elevation rate limited (429). Using flat horizon fallback immediately.');
      } else if (response.ok) {
        const data = await response.json();
        if (data && Array.isArray(data.elevation) && data.elevation.length === points.length) {
          results = data.elevation;
        }
      }
    } catch (e: any) {
      if (__DEV__) console.warn('[TerrainAPI] Open-Meteo elevation fetch failed:', e?.message);
    }

    if (results.length !== points.length) {
      if (__DEV__) console.log('[TerrainAPI] Using immediate flat horizon fallback.');
      return {
        panoramicAngles: Array(SAMPLES).fill(0), farAngles: Array(SAMPLES).fill(0),
        bandAngles: DISTANCES.map(() => Array(SAMPLES).fill(0)),
        waterFrac: Array(SAMPLES).fill(0),
        bandDistancesKm: DISTANCES.slice(),
        minAz, maxAz, observerElevation: 0,
        elevations: [],
        isFallback: true,
      };
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
    // 거리대별 지형각. 예전에는 세 거리를 최댓값으로 뭉개 버려서 "가까운 능선
    // 뒤에 먼 능선"이라는 정보가 사라졌습니다. 이미 계산하는 값이므로 그대로
    // 내보냅니다 — 거리별 대기 투시(docs/GROUND_PLAN.md 3단계)에 씁니다.
    // 모양: [거리대][방위]  (기존 두 배열은 호환을 위해 그대로 둡니다)
    const bandAngles: number[][] = DISTANCES.map(() => []);
    // 바다 판정. Open-Meteo elevation API는 **해상에서 정확히 0.0**을
    // 반환합니다 (육지는 0이 아닌 정수). 새 데이터원 없이 방위별 수역 여부를
    // 읽을 수 있습니다. 한계: 해수면 높이의 해안 평야도 0으로 읽힙니다.
    const waterFrac: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      let maxAzAngle = 0;
      let maxFarAngle = 0;
      let water = 0;
      let counted = 0;
      for (let j = 0; j < DISTANCES.length; j++) {
        const idx = i * DISTANCES.length + j;
        const elev = terrainPoints[idx];
        if (elev === undefined) { bandAngles[j].push(0); continue; }

        const distMeters = DISTANCES[j] * 1000;
        // ⚠ **지구 곡률**을 빼야 합니다. 멀리 있는 지면은 그만큼 발밑으로
        // 휘어 내려갑니다 — 낙차는 d²/2R 로, 5km 에서 2m 지만 40km 면
        // **108m** 입니다. 이게 없으면 40km 의 해수면이 -0.043° 로 읽혀
        // 진짜 수평선(-0.176°)보다 위에 뜨고, 능선 띠와 지면 원반이 서로
        // 다른 수평선을 그려 경계가 어긋납니다.
        //
        // R 은 `TerrainRing.seaHorizonDipDeg` 와 **같은 값**을 씁니다.
        // 44절에서 지면과 구름이 서로 다른 지평선을 써서 띠가 벌어진 적이
        // 있습니다 — 같은 종류의 결함을 만들지 않으려고 맞춰 둡니다.
        // (둘 다 대기 굴절은 넣지 않았습니다. 넣으면 낙차가 약 13% 줄어들고,
        //  올릴 때는 **두 곳을 같이** 올려야 합니다.)
        const curvatureDropM = (distMeters * distMeters) / (2 * EARTH_RADIUS_M);
        const elevDiff = elev - observerElev - curvatureDropM;
        const angle = (Math.atan2(elevDiff, distMeters) * 180) / Math.PI;

        bandAngles[j].push(angle);
        const isWater = elev === 0 ? 1 : 0;
        if (angle > maxAzAngle) maxAzAngle = angle;
        if (j >= 1 && angle > maxFarAngle) maxFarAngle = angle;
        water += isWater;
        counted++;
      }
      panoramicAngles.push(maxAzAngle);
      farAngles.push(maxFarAngle);
      waterFrac.push(counted > 0 ? water / counted : 0);
    }

    const terrainData = {
      panoramicAngles, farAngles, bandAngles, waterFrac,
      bandDistancesKm: DISTANCES.slice(),
      minAz, maxAz, observerElevation: observerElev,
      elevations: terrainPoints,
    };
    terrainCache.set(cacheKey, terrainData);
    return terrainData;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    if (__DEV__) {
      console.warn(`[TerrainAPI] Panoramic terrain unavailable (${duration}ms). Using flat horizon fallback: ${error?.message}`);
    }
    // isFallback: true 로 마킹하여 호출부에서 캐싱하지 않도록 방지
    return {
      panoramicAngles: Array(SAMPLES).fill(0), farAngles: Array(SAMPLES).fill(0),
      bandAngles: DISTANCES.map(() => Array(SAMPLES).fill(0)),
      waterFrac: Array(SAMPLES).fill(0),
      bandDistancesKm: DISTANCES.slice(),
      minAz, maxAz, observerElevation: 0,
      elevations: [],
      isFallback: true,
    };
  }
};

/**
 * **카나리아 한 점.** 큰 요청을 건너뛰어도 되는지 묻는 데만 씁니다.
 *
 * 관측점 한 곳의 `temperature_2m` 하루치만 받습니다 — 35점 · 변수 8개 · 모델
 * 둘짜리 본 요청의 **약 1/300** 입니다.
 *
 * 왜 기온이고 왜 운량이 아닌지, 왜 같은 모델을 물어야 하는지는
 * `cachePolicy.ts` 의 카나리아 절에 있습니다. 요지만 옮기면 — `cloud_cover` 는
 * 맑은 날 24시간이 통째로 0 이라 **런이 갈려도 "안 바뀜" 이라고 거짓말**합니다.
 *
 * ⚠ 본 요청과 **같은 모델**(`BLEND_MODELS_PARAM`)을 물어야 합니다. 갱신 주기가
 * 다른 모델을 물으면 엉뚱한 답이 나옵니다.
 *
 * 실패하면 `null` — 호출부는 그때 **그냥 다 받습니다.**
 */
export const fetchWeatherCanary = async (
  lat: number, lon: number, targetDate: Date = new Date(), signal?: AbortSignal,
): Promise<number[] | null> => {
  const dateStr = localDateString(targetDate);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`
    + `&hourly=${CANARY_VARIABLE}`
    + `&start_date=${dateStr}&end_date=${dateStr}&timezone=auto${BLEND_MODELS_PARAM}`;
  try {
    const res = await fetchWithTimeout(url, { signal }, 4000);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.error) return null;
    const h = blendHourly((Array.isArray(data) ? data[0] : data)?.hourly) as any;
    const series = h?.[CANARY_VARIABLE];
    return Array.isArray(series) ? series : null;
  } catch {
    // 카나리아가 실패하면 **아무 결론도 내리지 않습니다.** 그냥 다 받습니다.
    return null;
  }
};
