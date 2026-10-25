/**
 * satelliteIrradiance.ts — 위성이 **실제로 본** 일사(§160, 2026-10-25).
 *
 * 왜: §158 은 예보 DNI 로 구름 두께 τ 를 되짚습니다. 그런데 예보가 하늘을 틀린 시각(10/24 서울: 예보는 밝음, 실제는 비)에는
 * 예보 DNI 도 함께 틀립니다. RULER-genus2 §7.2 — 유럽 241 관측소 낮 15,165 시각 중 예보 밝음·위성 어두움 181 + 반대 352 = 3.5 %.
 * Open-Meteo 위성 일사(satellite-api, Himawari-9 아시아 30 분 지연·10 분 간격, EUMETSAT MTG 유럽 20 분)는 지난 시각의 관측값이라
 * 그 3.5 % 를 바로잡습니다. 관측이 있는 시각은 관측 DNI 로 τ 를, 없는 시각(미래·밤·결측)은 예보 DNI 로.
 *
 * 요청: 관측점 1 점 · 변수 2 개(GHI·DNI) · 어제~오늘(timezone=auto). `fetchSatelliteBias`(§70) 와 같은 끝점이지만 그것은 8 일치 GHI 로
 * 운량 편향을 재고, 이것은 시각별 DNI 를 그대로 나릅니다. 실패하면 null — 예보 그대로 갑니다.
 *
 * ⚠ `timezone=auto` 시각 문자열에는 시간대 표시가 없습니다. 예보 시각 축도 같은 자리의 `timezone=auto` 라 **문자열로** 맞춥니다
 * (`attachAirQuality` 와 같은 방식). 기기 시간대와 무관합니다.
 */
import { gridBucket } from './weatherCacheKey';
import { localDateString } from './localDate';

export interface SatelliteIrradianceHourly {
  time: string[];
  /** 직전 한 시간 평균(W/m²). 결측·밤은 null. */
  dni: (number | null)[];
  ghi: (number | null)[];
  /** 마지막으로 값이 있는 시각(참 시각 ms). 0 이면 없음. */
  observedUntilMs: number;
}

/** 위성은 10 분마다 갱신되므로 캐시는 15 분 칸으로 — 같은 칸 안에서는 다시 묻지 않습니다. */
const CACHE_SLOT_MS = 15 * 60_000;
const cache = new Map<string, SatelliteIrradianceHourly | null>();

const fetchWithTimeout = async (url: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<Response> => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    return await fetch(url, { signal: ctl.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
};

/**
 * 관측점의 어제~대상 날짜 위성 일사. 대상 날짜가 미래면 응답이 비어(null 만) 오고, 그때도 null 을 돌려줍니다.
 */
export const fetchSatelliteIrradiance = async (
  lat: number,
  lon: number,
  targetDate: Date = new Date(),
  signal?: AbortSignal,
): Promise<SatelliteIrradianceHourly | null> => {
  const dateStr = localDateString(targetDate);
  // 미래 날짜(내일 이후)는 위성에 없습니다 — 요청하지 않습니다.
  if (targetDate.getTime() - Date.now() > 36 * 3600_000) return null;
  const slot = Math.floor(Date.now() / CACHE_SLOT_MS);
  const key = `sati_${gridBucket(lat, lon)}_${dateStr}_${slot}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  const start = new Date(targetDate.getTime() - 86400_000);
  const url = `https://satellite-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}` +
    `&hourly=shortwave_radiation,direct_normal_irradiance&models=satellite_radiation_seamless` +
    `&start_date=${localDateString(start)}&end_date=${dateStr}&timezone=auto`;
  try {
    const res = await fetchWithTimeout(url, signal, 8000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data?.error) throw new Error(data.reason || 'unknown');
    const time: string[] = Array.isArray(data?.hourly?.time) ? data.hourly.time : [];
    const col = (a: unknown): (number | null)[] => time.map((_, i) => {
      const v = Array.isArray(a) ? a[i] : null;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    });
    const dni = col(data?.hourly?.direct_normal_irradiance);
    const ghi = col(data?.hourly?.shortwave_radiation);
    const offsetMs = (data?.utc_offset_seconds ?? 0) * 1000;
    let observedUntilMs = 0;
    for (let i = time.length - 1; i >= 0; i--) {
      if (ghi[i] != null) { observedUntilMs = Date.parse(time[i] + 'Z') - offsetMs; break; }
    }
    if (!time.length || observedUntilMs === 0) { cache.set(key, null); return null; }
    const out: SatelliteIrradianceHourly = { time, dni, ghi, observedUntilMs };
    cache.set(key, out);
    return out;
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('위성 일사를 받지 못했습니다. 예보 DNI 로 진행합니다:', error);
    cache.set(key, null);
    return null;
  }
};

/**
 * 관측점 시각 축에 붙입니다 — 시각 문자열로 맞추고 짝이 없는 시각은 null(지어내지 않음).
 * `hourly.satDirectNormalIrradiance` / `satShortwaveRadiation` 에 들어가고, `getInterpolatedWeather` 가 `CloudData` 로 나릅니다.
 */
export function attachSatelliteIrradiance(
  hourly: { time: string[]; satDirectNormalIrradiance?: (number | null)[]; satShortwaveRadiation?: (number | null)[] },
  sat: SatelliteIrradianceHourly,
): void {
  const pos = new Map<string, number>();
  sat.time.forEach((t, i) => pos.set(t, i));
  const pick = (src: (number | null)[]) => hourly.time.map(t => {
    const j = pos.get(t);
    return j === undefined ? null : src[j] ?? null;
  });
  hourly.satDirectNormalIrradiance = pick(sat.dni);
  hourly.satShortwaveRadiation = pick(sat.ghi);
}

/**
 * τ 계산에 쓸 DNI 를 고릅니다: 위성 관측이 있으면 관측, 없으면 예보. 어느 쪽을 썼는지도 돌려줍니다(요약 표시용).
 */
export function pickDni(obs: { directNormalIrradiance?: number; satDirectNormalIrradiance?: number | null }): { dni: number | undefined; source: 'sat' | 'fc' | null } {
  const s = obs.satDirectNormalIrradiance;
  if (s != null && Number.isFinite(s)) return { dni: s, source: 'sat' };
  const f = obs.directNormalIrradiance;
  if (f != null && Number.isFinite(f)) return { dni: f, source: 'fc' };
  return { dni: undefined, source: null };
}
