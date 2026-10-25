/**
 * sunForecast.ts — **02 예보**: 앞으로 16일, 날마다 일출 · 일몰의 노을 판정(2026-10-25, 디자인 2단).
 *
 * ## 무엇을 받나
 *
 * 하루치 링(`fetchDayWeatherRing`, 97점 × 1일)을 16번 받으면 너무 비쌉니다. 판정에 쓰는 것은
 * **관측점 + 해 쪽 줄**뿐이므로(`predictSunset` · `beamPathTransmittance`), 그것만 16일치로 한 번 받습니다.
 *
 *  - 관측점 1점 + (일출 쪽 · 일몰 쪽) × 방위 2개 × 링과 같은 거리 8개 = 33점, `forecast_days=16`.
 *  - 방위 2개는 16일 동안 그쪽 출몰 방위의 **양 끝(± 2°)** 입니다. 해는 그 사이에서 움직이므로
 *    `alignRingToSun` 이 두 방위를 각도 비율로 보간해 그날의 해 쪽 줄을 만듭니다(링과 같은 식).
 *  - 변수 · 모델 섞기는 링과 같습니다(`modelBlend`). 그래야 같은 날의 판정이 01 하늘과 같은 식으로 나옵니다.
 *
 * ## 무엇을 하지 않나
 *
 *  - **예보가 없는 시각은 판정하지 않습니다.** 모델이 끝난 날(icon 은 약 7.5일, ecmwf 는 15일)의 값은 null 로
 *    오는데, `getInterpolatedWeather` 는 null 을 0(맑음)으로 읽습니다. 그래서 출몰 시각에 관측점 운량이
 *    비어 있으면 `null` — "예보 없음" 입니다. 맑다고 지어내지 않습니다.
 *  - 한도 초과(429)에서 맑은 하늘 대용값을 만들지 않습니다(링은 화면을 그려야 해서 만들지만, 여기는 판정표라
 *    지어낸 값이 그대로 "보통" 으로 보입니다). 오류로 돌려 화면이 다시 받기를 보여 줍니다.
 *  - 대기질(AOD)은 받지 않습니다 — 약 5일까지만 있습니다. 시정 · 습도 식으로 셉니다.
 *
 * ## 01 하늘과 맞추기
 *
 * 그날의 링을 이미 받아 두었으면(보통 오늘) 그 링으로 셉니다(`ringFor`). 01 하늘의 요약 줄(가장 붉을 때)과
 * **같은 함수 · 같은 자료**라 숫자가 같습니다. 링이 없는 날만 이 16일 자료를 씁니다.
 */
import { BLEND_MODELS_PARAM, blendHourly } from './modelBlend';
import {
  calculateDestination,
  fetchWithTimeout,
  getInterpolatedWeather,
  RING_DISTANCES_KM,
  type CloudPathData,
  type HourlyCloudData,
} from './weather';
import { sunPosition, sunTimes } from './solarPosition';
import { scenePrediction } from './scenePrediction';
import { findGlowPeak, type GlowPeak } from './glowPeak';
import { tierAt, MS_DAY, MS_HOUR, FORECAST_DAYS, type AccuracyTier } from './timeBar';
import { gridBucket } from './weatherCacheKey';
import { localDateString } from './localDate';
import type { SunsetPrediction } from './sunsetPhysics';

export type EventSide = 'sunrise' | 'sunset';
export type Quality = SunsetPrediction['quality'];

export interface ForecastEvent {
  side: EventSide;
  /** 출몰 시각 */
  at: Date;
  /** 가장 붉을 때(`glowPeak`). 예보가 없으면 null. */
  peakAt: Date | null;
  score: number | null;
  quality: Quality | null;
  /** 리드타임 등급(`timeBar.tierAt`) — 무늬와 점수를 보일지 정합니다. */
  tier: AccuracyTier;
  /** 무엇으로 셌나. null 이면 예보 없음. */
  source: 'ring' | 'forecast' | null;
}

export interface ForecastDay {
  /** 관측지 현지 날짜의 정오(UTC ms) — 날짜 글자와 키에 씁니다. */
  noonMs: number;
  sunrise: ForecastEvent | null;
  sunset: ForecastEvent | null;
}

const DEG = 180 / Math.PI;
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
/** 방위 범위 양 끝에 두는 여유(도). 끝 방위에 해가 딱 걸려도 보간이 한쪽으로 치우치지 않게. */
const BEARING_MARGIN_DEG = 2;

/** 관측지 현지 날짜의 정오들(UTC ms). `notificationPlan` 과 같은 방식입니다. */
export function localNoons(now: Date, tzHours: number, days: number): number[] {
  const l = new Date(now.getTime() + tzHours * MS_HOUR);
  const noon0 = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate(), 12) - tzHours * MS_HOUR;
  return Array.from({ length: days }, (_, i) => noon0 + i * MS_DAY);
}

const validDate = (d?: Date | null): d is Date => !!d && Number.isFinite(d.getTime());

/** 출몰 방위(도, 북 0 · 동 90). */
const eventBearing = (at: Date, lat: number, lon: number) => sunPosition(at, lat, lon).azimuth * DEG + 180;

/**
 * 16일 동안 그쪽 출몰 방위의 양 끝(± 여유)을 링 규약(-180~180)으로. 그 쪽 출몰이 하루도 없으면 빈 배열.
 */
export function sideBearings(lat: number, lon: number, noonsMs: number[]): Record<EventSide, number[]> {
  const out: Record<EventSide, number[]> = { sunrise: [], sunset: [] };
  for (const side of ['sunrise', 'sunset'] as EventSide[]) {
    const az = noonsMs
      .map(n => sunTimes(new Date(n), lat, lon)[side])
      .filter(validDate)
      .map(at => eventBearing(at, lat, lon));
    if (!az.length) continue;
    const ref = az[0];
    const rel = az.map(a => wrap180(a - ref));
    const lo = Math.min(...rel) - BEARING_MARGIN_DEG;
    const hi = Math.max(...rel) + BEARING_MARGIN_DEG;
    out[side] = [wrap180(ref + lo), wrap180(ref + hi)];
  }
  return out;
}

/** 요청할 점들 — 관측점이 첫 점입니다(`getInterpolatedWeather(...)[0]` 이 관측점이어야 합니다). */
export function forecastPoints(lat: number, lon: number, bearings: Record<EventSide, number[]>) {
  const pts: { dist: number; az: number; lat: number; lon: number }[] = [{ dist: 0, az: 0, lat, lon }];
  for (const az of [...bearings.sunrise, ...bearings.sunset]) {
    for (const dist of RING_DISTANCES_KM) {
      const d = calculateDestination(lat, lon, dist, az);
      pts.push({ dist, az, lat: d.latitude, lon: d.longitude });
    }
  }
  return pts;
}

const HOURLY_VARS =
  'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,' +
  'direct_normal_irradiance,total_column_integrated_water_vapour,precipitation';

export function sunForecastUrl(points: { lat: number; lon: number }[]): string {
  const la = points.map(p => p.lat.toFixed(5)).join(',');
  const lo = points.map(p => p.lon.toFixed(5)).join(',');
  return `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}` +
    `&hourly=${HOURLY_VARS}&forecast_days=${FORECAST_DAYS}&timezone=auto${BLEND_MODELS_PARAM}`;
}

/**
 * 응답을 `CloudPathData` 로. 링과 달리 **빈 칸(null)을 0 으로 메우지 않습니다** — 판정 전에 `hasDataAt` 이 거릅니다.
 */
export function pathFromResponse(
  points: { dist: number; az: number }[],
  results: any[],
): CloudPathData[] {
  return points.map((vp, i) => {
    const rh = blendHourly(results[i]?.hourly) as any;
    const time: string[] = rh?.time ?? [];
    const col = (a: any): number[] => (Array.isArray(a) ? a : time.map(() => null)) as number[];
    const hourly: HourlyCloudData = {
      time,
      // 링과 같은 규약 — 시간대 표시 없는 현지 시각 문자열을 기기 현지시로 읽습니다(`localDate.ts` 머리말).
      timeMs: time.map(t => new Date(t).getTime()),
      low: col(rh?.cloud_cover_low),
      mid: col(rh?.cloud_cover_mid),
      high: col(rh?.cloud_cover_high),
      total: Array.isArray(rh?.cloud_cover) ? rh.cloud_cover : undefined,
      directNormalIrradiance: rh?.direct_normal_irradiance,
      totalColumnWaterVapour: rh?.total_column_integrated_water_vapour,
      precipitation: rh?.precipitation,
    };
    if (i === 0 && Array.isArray(rh?.relative_humidity_2m)) hourly.humidity = rh.relative_humidity_2m;
    return { distance: vp.dist, azimuthOffset: vp.az, hourly, source: 'standard' as const };
  });
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 관측점에 그 시각 앞뒤 두 시간의 층별 운량이 모두 있는가. 없으면 판정하지 않습니다. */
export function hasDataAt(path: readonly CloudPathData[], t: Date): boolean {
  const h = path[0]?.hourly;
  const times = h?.timeMs;
  if (!h || !times?.length) return false;
  const ms = t.getTime();
  if (ms < times[0] || ms > times[times.length - 1]) return false;
  let i = 0;
  while (i < times.length - 1 && times[i + 1] <= ms) i++;
  const j = Math.min(times.length - 1, i + 1);
  return [h.low, h.mid, h.high].every(a => isNum(a?.[i]) && isNum(a?.[j]));
}

/**
 * 한 출몰의 판정 — 01 하늘의 요약 줄과 **같은 함수**(`scenePrediction` 을 출몰 앞뒤로 훑는 `findGlowPeak`).
 * 출몰 시각에 예보가 없으면 null.
 */
export function eventVerdict(
  path: readonly CloudPathData[],
  at: Date,
  side: EventSide,
  latitude: number,
  longitude: number,
  observerElevM?: number,
): GlowPeak<SunsetPrediction> | null {
  if (!path.length || !hasDataAt(path, at)) return null;
  return findGlowPeak(at, side, (tm) => {
    if (!hasDataAt(path, tm)) return null;
    const sp = sunPosition(tm, latitude, longitude);
    return scenePrediction({
      pathData: path,
      time: tm,
      sunAltDeg: sp.altitude * DEG,
      sunAzDeg: sp.azimuth * DEG + 180,
      obs: getInterpolatedWeather(path as CloudPathData[], tm)[0],
      latitude,
      observerElevM,
    });
  });
}

export function buildForecastDays(p: {
  latitude: number;
  longitude: number;
  now: Date;
  tzHours: number;
  observerElevM?: number;
  /** 16일 자료(`fetchSunForecast`). 아직 없으면 null — 링이 있는 날만 판정됩니다. */
  forecast: readonly CloudPathData[] | null;
  /** 그 출몰이 든 날의 링을 받아 두었으면 그것(보통 오늘). */
  ringFor?: (at: Date) => readonly CloudPathData[] | null | undefined;
  days?: number;
}): ForecastDay[] {
  const { latitude: lat, longitude: lon, now, tzHours, observerElevM } = p;
  return localNoons(now, tzHours, p.days ?? FORECAST_DAYS).map((noonMs) => {
    const times = sunTimes(new Date(noonMs), lat, lon);
    const one = (side: EventSide): ForecastEvent | null => {
      const at = times[side];
      if (!validDate(at)) return null;
      const tier = tierAt(at.getTime(), now.getTime());
      const ring = p.ringFor?.(at);
      const tries: [CloudPathData[] | null | undefined, 'ring' | 'forecast'][] = [
        [ring as CloudPathData[] | null | undefined, 'ring'],
        [p.forecast as CloudPathData[] | null, 'forecast'],
      ];
      for (const [path, source] of tries) {
        if (!path?.length) continue;
        const v = eventVerdict(path, at, side, lat, lon, observerElevM);
        if (v) return { side, at, peakAt: v.time, score: v.score, quality: v.prediction.quality, tier, source };
      }
      return { side, at, peakAt: null, score: null, quality: null, tier, source: null };
    };
    return { noonMs, sunrise: one('sunrise'), sunset: one('sunset') };
  });
}

/**
 * 관측 높이(m) — 01 하늘(`SkyScreen` 의 `initialTerrain`)과 같은 규칙: 0.05° 안의 받아 둔 지형, 없으면 위치 고도, 없으면 50.
 * 높이는 지평선 내림각으로 판정에 들어가므로 두 화면 · 알림이 같은 값을 써야 숫자가 같습니다.
 */
export function observerElevationFrom(
  terrainCacheList: readonly { latitude: number; longitude: number; data: any }[] | undefined,
  lat: number,
  lon: number,
  altitude?: number | null,
): number {
  const hit = terrainCacheList?.find(c => Math.abs(c.latitude - lat) < 0.05 && Math.abs(c.longitude - lon) < 0.05);
  const fromTerrain = Array.isArray(hit?.data?.panoramicAngles) ? hit?.data?.observerElevation : undefined;
  return fromTerrain ?? altitude ?? 50;
}

/** 판정이 "좋음" 이상인가 — 알림 거르기(`notifPrefs.goodOnly`)와 화면이 같은 기준을 씁니다. */
export const isGoodOrBetter = (q: Quality | null | undefined): boolean => q === 'Great' || q === 'Epic';

/** 앞으로 올 출몰 중 가장 좋은 것. 16일 끝자락(`low`)은 참고라 빼고, 3~7일 안에서 고릅니다. */
export function bestUpcoming(days: ForecastDay[], now: Date): ForecastEvent | null {
  let best: ForecastEvent | null = null;
  for (const d of days) {
    for (const e of [d.sunrise, d.sunset]) {
      if (!e || e.score == null || e.at.getTime() <= now.getTime()) continue;
      if (e.tier !== 'high' && e.tier !== 'medium') continue;
      if (!best || e.score > (best.score ?? -1)) best = e;
    }
  }
  return best;
}

// ── 받기 · 캐시 ─────────────────────────────────────────────────────────────

export interface SunForecastData {
  path: CloudPathData[];
  fetchedAt: number;
}

/** 한 시간 — 모델 실행은 몇 시간 간격이라 더 자주 받아도 같은 값입니다. */
export const SUN_FORECAST_TTL_MS = 60 * 60 * 1000;
const MEM = new Map<string, SunForecastData>();
const INFLIGHT = new Map<string, Promise<SunForecastData>>();

export const sunForecastKey = (lat: number, lon: number, now: Date) =>
  `fc16_${gridBucket(lat, lon)}_${localDateString(now)}`;

/** 받아 둔 16일 자료(네트워크 없음). 알림이 다른 날 판정을 볼 때도 씁니다. */
export function cachedSunForecast(lat: number, lon: number, now: Date = new Date()): SunForecastData | null {
  const hit = MEM.get(sunForecastKey(lat, lon, now));
  return hit && Date.now() - hit.fetchedAt < SUN_FORECAST_TTL_MS ? hit : null;
}

export async function fetchSunForecast(
  lat: number,
  lon: number,
  now: Date = new Date(),
  opts: { force?: boolean; signal?: AbortSignal; tzHours?: number } = {},
): Promise<SunForecastData> {
  const key = sunForecastKey(lat, lon, now);
  if (!opts.force) {
    const hit = cachedSunForecast(lat, lon, now);
    if (hit) return hit;
    const pending = INFLIGHT.get(key);
    if (pending) return pending;
  }
  const job = (async () => {
    const points = forecastPoints(lat, lon, sideBearings(lat, lon, localNoons(now, opts.tzHours ?? 0, FORECAST_DAYS)));
    const res = await fetchWithTimeout(sunForecastUrl(points), { signal: opts.signal }, 20000);
    if (!res.ok) throw new Error(res.status === 429 ? 'RATE_LIMIT' : `HTTP_${res.status}`);
    const json = await res.json();
    if (json?.error) throw new Error(/limit/i.test(String(json?.reason ?? '')) ? 'RATE_LIMIT' : String(json?.reason ?? 'ERROR'));
    const results = Array.isArray(json) ? json : [json];
    const data: SunForecastData = { path: pathFromResponse(points, results), fetchedAt: Date.now() };
    MEM.set(key, data);
    return data;
  })();
  INFLIGHT.set(key, job);
  try {
    return await job;
  } finally {
    INFLIGHT.delete(key);
  }
}
