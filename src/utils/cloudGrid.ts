/**
 * Enhanced Cloud Grid — fetches high-density cloud cover data
 * along a fan-shaped polar grid toward the sunset/sunrise direction.
 *
 * Uses Open-Meteo batch API (same endpoint already used by the app).
 * ~100 points in a single HTTP request, completes in 1-2 seconds.
 */

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

const makeCacheKey = (lat: number, lon: number, az: number) =>
  `${lat.toFixed(2)},${lon.toFixed(2)},${Math.round(az / 10) * 10}`;

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
    console.log('[CloudGrid] Cooldown active, skipping fetch');
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

  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
      `&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high` +
      `&timezone=auto`,
    );

    if (!response.ok) {
      throw new Error(`Open-Meteo returned ${response.status}`);
    }

    const data = await response.json();
    const results = Array.isArray(data) ? data : [data];

    const targetMs = targetTime.getTime();

    const points: CloudGridPoint[] = gridPoints.map((gp, i) => {
      const res = results[i];
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
    console.log(`[CloudGrid] Fetched ${points.length} grid points successfully`);
    return grid;
  } catch (error) {
    console.error('[CloudGrid] Fetch failed:', error);
    return cached ?? null;
  }
};
