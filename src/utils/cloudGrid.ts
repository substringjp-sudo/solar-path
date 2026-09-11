/**
 * Enhanced Cloud Grid — fetches high-density cloud cover data
 * along a fan-shaped polar grid toward the sunset/sunrise direction.
 *
 * Uses Open-Meteo batch API (same endpoint already used by the app).
 * ~100 points in a single HTTP request, completes in 1-2 seconds.
 */

import { BLEND_MODELS_PARAM, blendHourly } from './modelBlend';
import { gridBucket } from './weatherCacheKey';
import { calculateDestination } from './weather';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CloudGridPoint {
  latitude: number;
  longitude: number;
  /** Distance from observer in km */
  distance: number;
  /** Bearing from observer in degrees (absolute, not offset) */
  bearing: number;
  /** Azimuth offset from center in degrees */
  azOffset: number;
  /** Low cloud cover % at target time */
  low: number;
  /** Mid cloud cover % at target time */
  mid: number;
  /** High cloud cover % at target time */
  high: number;
  /**
   * Raw hourly series kept alongside the interpolated snapshot.
   *
   * Why: without this the grid is frozen at whatever `targetTime` it was
   * fetched for, so scrubbing the time slider silently shows stale structure
   * (or forces a refetch per tick). The arrays come back in the same response
   * we already pay for — keeping them makes the grid re-interpolable for free.
   */
  hourly?: {
    timeMs: number[];
    low: number[];
    mid: number[];
    high: number[];
  };
}

export interface CloudDensityGrid {
  points: CloudGridPoint[];
  /** Epoch ms when the data was fetched */
  timestamp: number;
  /** Center azimuth of the fan (sun direction) */
  azCenter: number;
  /** Observer lat/lon used for this grid */
  observerLat: number;
  observerLon: number;
}

// ---------------------------------------------------------------------------
// Grid geometry
// ---------------------------------------------------------------------------

/** Azimuth offsets from center (7 rays spanning ±30°) */
const AZ_OFFSETS = [-30, -20, -10, 0, 10, 20, 30];

/** Distance rings in km — denser near observer, sparser far away */
const DIST_RINGS = [10, 20, 35, 55, 80, 120, 170, 230, 300, 380];

// Total grid points: 7 × 10 = 70  (well within Open-Meteo 1000-point limit)

// ---------------------------------------------------------------------------
// Cache & cooldown
// ---------------------------------------------------------------------------

let lastFetchTimestamp = 0;
const COOLDOWN_MS = 30_000; // 30-second cooldown between fetches
const gridCache = new Map<string, CloudDensityGrid>();

// ⚠ 자리는 **격자 버킷**으로 자릅니다(utils/weatherCacheKey.ts). 예전 toFixed(2)
//   는 1.1km 라 격자(2.3~7.8km)보다 촘촘해 같은 칸을 거듭 받았습니다.
const makeCacheKey = (lat: number, lon: number, az: number) =>
  `${gridBucket(lat, lon)},${Math.round(az / 10) * 10}`;

// ---------------------------------------------------------------------------
// Main fetch
// ---------------------------------------------------------------------------

/**
 * Fetches a high-density cloud grid for the given observer location and azimuth direction.
 * Returns cached data if available and still fresh. Enforces 30s cooldown between fetches.
 *
 * @param lat - Observer latitude
 * @param lon - Observer longitude
 * @param azimuth - Center azimuth (sun direction) in degrees
 * @param targetTime - The time to interpolate hourly cloud data for
 * @returns CloudDensityGrid or null if cooldown hasn't elapsed
 */
export const fetchCloudGrid = async (
  lat: number,
  lon: number,
  azimuth: number,
  targetTime: Date,
): Promise<CloudDensityGrid | null> => {
  const now = Date.now();
  const cacheKey = makeCacheKey(lat, lon, azimuth);

  // Return cached data if fresh (< 10 min)
  const cached = gridCache.get(cacheKey);
  if (cached && now - cached.timestamp < 600_000) {
    return cached;
  }

  // Enforce cooldown
  if (now - lastFetchTimestamp < COOLDOWN_MS) {
    if (__DEV__) {
      console.log('[CloudGrid] Cooldown active, skipping fetch');
    }
    return cached ?? null;
  }

  lastFetchTimestamp = now;

  // Build polar grid coordinates
  const gridPoints: { lat: number; lon: number; dist: number; azOffset: number; bearing: number }[] = [];

  for (const azOff of AZ_OFFSETS) {
    const bearing = (azimuth + azOff + 360) % 360;
    for (const dist of DIST_RINGS) {
      const dest = calculateDestination(lat, lon, dist, bearing);
      gridPoints.push({
        lat: dest.latitude,
        lon: dest.longitude,
        dist,
        azOffset: azOff,
        bearing,
      });
    }
  }

  const lats = gridPoints.map(p => p.lat.toFixed(5)).join(',');
  const lons = gridPoints.map(p => p.lon.toFixed(5)).join(',');
  // 모델을 고르지 않으면 Open-Meteo 기본값 `best_match` 가 오는데, §56 에서
  // 재 보니 짙게 흐린 하늘에서 τ 를 +34 만큼 맑은 쪽으로 틀립니다. ecmwf+icon
  // 을 섞으면 그 편향이 +10.3 으로 줄어듭니다.
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
    `&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high` +
    `&timezone=auto${BLEND_MODELS_PARAM}`;

  const startTime = Date.now();
  if (__DEV__) {
    console.log(`[CloudGrid] Request URL: ${url}`);
  }

  try {
    const response = await fetch(url);

    if (!response.ok) {
      const duration = Date.now() - startTime;
      console.error(`[CloudGrid] API responded with error status ${response.status} in ${duration}ms`);
      throw new Error(`Open-Meteo returned ${response.status}`);
    }

    const data = await response.json();
    const duration = Date.now() - startTime;
    if (__DEV__) {
      console.log(`[CloudGrid] Successfully fetched grid data in ${duration}ms. Size: ${Array.isArray(data) ? data.length : 1} items.`);
    }
    const results = Array.isArray(data) ? data : [data];

    const targetMs = targetTime.getTime();

    const points: CloudGridPoint[] = gridPoints.map((gp, i) => {
      // 모델을 둘 이상 요청하면 변수 이름에 모델 이름이 접미사로 붙습니다.
      // `blendHourly` 가 그것을 떼고 섞어 접미사 없는 꼴로 되돌립니다.
      const res = { hourly: blendHourly(results[i]?.hourly) as any };
      if (!res?.hourly?.time) {
        return { ...gp, latitude: gp.lat, longitude: gp.lon, distance: gp.dist, low: 0, mid: 0, high: 0 };
      }

      // Find the two hours bracketing targetTime and linearly interpolate
      const times: string[] = res.hourly.time;
      const timeEpochs = times.map((t: string) => new Date(t).getTime());

      let idx = 0;
      while (idx < timeEpochs.length - 1 && timeEpochs[idx + 1] < targetMs) idx++;

      const t1 = timeEpochs[idx];
      const t2 = timeEpochs[idx + 1] ?? t1 + 3600_000;
      const ratio = Math.max(0, Math.min(1, (targetMs - t1) / (t2 - t1)));

      const lerp = (arr: number[]) => {
        const a = arr[idx] ?? 0;
        const b = arr[idx + 1] ?? a;
        return a + (b - a) * ratio;
      };

      return {
        latitude: gp.lat,
        longitude: gp.lon,
        distance: gp.dist,
        bearing: gp.bearing,
        azOffset: gp.azOffset,
        low: lerp(res.hourly.cloud_cover_low),
        mid: lerp(res.hourly.cloud_cover_mid),
        high: lerp(res.hourly.cloud_cover_high),
        hourly: {
          timeMs: timeEpochs,
          low: res.hourly.cloud_cover_low,
          mid: res.hourly.cloud_cover_mid,
          high: res.hourly.cloud_cover_high,
        },
      };
    });

    const grid: CloudDensityGrid = {
      points,
      timestamp: now,
      azCenter: azimuth,
      observerLat: lat,
      observerLon: lon,
    };

    gridCache.set(cacheKey, grid);
    if (__DEV__) {
      console.log(`[CloudGrid] Fetched ${points.length} grid points successfully`);
    }
    return grid;
  } catch (error) {
    console.error('[CloudGrid] Fetch failed:', error);
    return cached ?? null;
  }
};

// ---------------------------------------------------------------------------
// Time re-interpolation
// ---------------------------------------------------------------------------

/**
 * Re-reads the grid at an arbitrary time using the retained hourly series.
 *
 * A grid is cached for 10 minutes and keyed only by (lat, lon, azimuth bucket),
 * so the `targetTime` it was originally fetched for is often *not* the time the
 * user is now looking at. Points without `hourly` (older cache entries) keep
 * their snapshot values.
 */
export const interpolateCloudGrid = (
  grid: CloudDensityGrid,
  time: Date,
): CloudGridPoint[] => {
  const targetMs = time.getTime();

  return grid.points.map(p => {
    const h = p.hourly;
    if (!h || h.timeMs.length === 0) return p;

    let idx = 0;
    while (idx < h.timeMs.length - 1 && h.timeMs[idx + 1] < targetMs) idx++;

    const t1 = h.timeMs[idx];
    const t2 = h.timeMs[idx + 1] ?? t1 + 3600_000;
    const ratio = Math.max(0, Math.min(1, (targetMs - t1) / (t2 - t1)));

    const lerp = (arr: number[]) => {
      const a = arr[idx] ?? 0;
      const b = arr[idx + 1] ?? a;
      return a + (b - a) * ratio;
    };

    return {
      ...p,
      low: lerp(h.low),
      mid: lerp(h.mid),
      high: lerp(h.high),
    };
  });
};
