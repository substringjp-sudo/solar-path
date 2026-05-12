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
  /** Surface visibility in meters. Only populated for the observer point. */
  visibility?: number;
  /** 2 m relative humidity in percent. Only populated for the observer point. */
  humidity?: number;
}

export interface WeatherPoint {
  latitude: number;
  longitude: number;
  distance: number;
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
}

export interface CloudPathData {
  distance: number;
  hourly: HourlyCloudData;
  source: 'standard' | 'ultra-short'; // 'standard' (Open-Meteo), 'ultra-short' (KMA 등)
}

const weatherCache = new Map<string, CloudPathData[]>();

export const fetchSunsetWeather = async (lat: number, lon: number, azimuth: number): Promise<CloudPathData[]> => {
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)},${azimuth.toFixed(1)}`;
  if (weatherCache.has(cacheKey)) {
    return weatherCache.get(cacheKey)!;
  }

  const points = [
    { dist: 0, lat, lon },
    { dist: 80, ...calculateDestination(lat, lon, 80, azimuth) },
    { dist: 200, ...calculateDestination(lat, lon, 200, azimuth) },
    { dist: 350, ...calculateDestination(lat, lon, 350, azimuth) },
  ];
// ... (rest of the function remains same but uses results to populate cache)

  const lats = points.map(p => (p as any).latitude || (p as any).lat).join(',');
  const lons = points.map(p => (p as any).longitude || (p as any).lon).join(',');

  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
        `&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m` +
        `&timezone=auto`
    );
    const data = await response.json();

    // The API returns an array if multiple latitudes are passed
    const results = Array.isArray(data) ? data : [data];

    const fetched: CloudPathData[] = points.map((p, i) => {
      const res = results[i];

      if (!res || !res.hourly) {
        console.warn(`Weather data missing for point ${i} (${p.dist}km). Using clear sky fallback.`);
        const fallbackTime: string[] = results[0]?.hourly?.time || [];
        return {
          distance: p.dist,
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
      const hourly: HourlyCloudData = {
        time,
        timeMs: time.map((t: string) => new Date(t).getTime()),
        low: res.hourly.cloud_cover_low,
        mid: res.hourly.cloud_cover_mid,
        high: res.hourly.cloud_cover_high,
      };
      // Visibility and humidity are only meaningful at the observer; the API
      // returns them for all points but we only consume them at index 0.
      if (i === 0) {
        if (Array.isArray(res.hourly.visibility)) hourly.visibility = res.hourly.visibility;
        if (Array.isArray(res.hourly.relative_humidity_2m)) hourly.humidity = res.hourly.relative_humidity_2m;
      }

      return {
        distance: p.dist,
        hourly,
        source: 'standard',
      };
    });

    weatherCache.set(cacheKey, fetched);
    return fetched;
  } catch (error) {
    console.error("Failed to fetch weather data:", error);
    // Return empty but valid structure to prevent simulation crash
    return [];
  }
};

/**
 * Interpolates hourly weather data for a specific time.
 */
export const getInterpolatedWeather = (pathData: CloudPathData[], targetTime: Date): CloudData[] => {
  const targetMs = targetTime.getTime();
  return pathData.map(p => {
    // timeMs is pre-parsed at fetch time. Tolerate legacy / hand-built data
    // that only has the string `time` field by parsing on the fly.
    const times = p.hourly.timeMs ?? p.hourly.time.map(t => new Date(t).getTime());

    if (times.length === 0) {
      return { distance: p.distance, low: 0, mid: 0, high: 0 };
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
      low: interpolate(p.hourly.low[i], p.hourly.low[i+1] ?? p.hourly.low[i]),
      mid: interpolate(p.hourly.mid[i], p.hourly.mid[i+1] ?? p.hourly.mid[i]),
      high: interpolate(p.hourly.high[i], p.hourly.high[i+1] ?? p.hourly.high[i]),
      visibility: interpolateOpt(p.hourly.visibility),
      humidity: interpolateOpt(p.hourly.humidity),
    };
  });
};

export interface TerrainData {
  panoramicAngles: number[]; // Max of all distances (near/mid/far)
  farAngles: number[];       // Only distant mountains (15km, 40km)
  minAz: number;
  maxAz: number;
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
        observerElev = (obsData && Array.isArray(obsData.elevation)) ? (obsData.elevation[0] || 0) : 0;
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
      let maxAzAngle = 0;
      let maxFarAngle = 0;
      for (let j = 0; j < DISTANCES.length; j++) {
        const idx = i * DISTANCES.length + j;
        const elev = results[idx];
        if (elev === undefined) continue;
        
        const distMeters = DISTANCES[j] * 1000;
        const elevDiff = elev - observerElev;
        const angle = (Math.atan2(elevDiff, distMeters) * 180) / Math.PI;
        
        if (angle > maxAzAngle) maxAzAngle = angle;
        // DISTANCES = [5, 15, 40], so j >= 1 covers 15km and 40km
        if (j >= 1 && angle > maxFarAngle) maxFarAngle = angle;
      }
      panoramicAngles.push(maxAzAngle);
      farAngles.push(maxFarAngle);
    }

    const terrainData = { panoramicAngles, farAngles, minAz, maxAz };
    terrainCache.set(cacheKey, terrainData);
    return terrainData;
  } catch (error) {
    console.error("Failed to fetch panoramic terrain:", error);
    return { panoramicAngles: Array(SAMPLES).fill(0), farAngles: Array(SAMPLES).fill(0), minAz, maxAz };
  }
};
