/**
 * cloudOutlook.ts — 서 있을 자리 후보의 "예보 맑음 / 구름 보통 / 구름 많음 / 날씨 모름" 표시용 구름 예보(2026-11-19, 목업 3번).
 *
 * 대상 위치 한 점의 앞으로 16일 시간별 구름(총운량 · 저·중·고층)을 한 번 받습니다. 후보는 대상에서 몇 km~60 km 떨어져 있지만 예보 격자
 * (10~25 km)와 같은 규모라 한 점의 값으로 매깁니다(`standSuggest` 머리말).
 *
 *  - 모델 섞기는 하늘 화면과 같습니다(`modelBlend`: ecmwf + icon) — 같은 날 같은 구름이 나옵니다. 변수 4 × 모델 2 = 8 개라 호출 수는 1 회입니다.
 *  - **시각은 UTC 로 받습니다**(`timezone=GMT`). 하늘 화면의 링은 "그 곳 현지 시각 문자열을 기기 현지시로 읽는" 규약이라 기기와 대상의 시간대가
 *    다르면 어긋나지만, 후보의 시각은 진짜 순간(UTC ms)이므로 여기서는 시간대 표시를 명확히 합니다.
 *  - 빈 칸(모델이 끝난 시각)은 0 으로 메우지 않고 null 로 둡니다 → "날씨 모름"(`standSuggest.forecastAt`). 맑다고 지어내지 않습니다.
 *  - 한 시간 동안 같은 격자(`gridBucket`)는 다시 받지 않습니다. 한도 초과(429)나 오류는 던집니다 — 호출한 쪽이 "날씨 모름"으로 둡니다.
 */
import { BLEND_MODELS_PARAM, blendHourly } from './modelBlend';
import { gridBucket } from './weatherCacheKey';
import { FORECAST_DAYS } from './timeBar';
import { outlookFromHourly, type CloudOutlook } from './standSuggest';

const HOURLY_VARS = 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high';

export function outlookUrl(lat: number, lon: number): string {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=${HOURLY_VARS}&forecast_days=${FORECAST_DAYS}&timezone=GMT${BLEND_MODELS_PARAM}`;
}

/** "2026-11-20T03:00"(시간대 없음, GMT 로 받음) → UTC ms. 이미 시간대가 붙었으면 그대로. */
const parseUtc = (t: string): number => Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/.test(t) ? t : `${t}Z`);

/** 응답(JSON 한 점)을 예보 자료로. 시간이 없으면 null. */
export function outlookFromResponse(json: any): CloudOutlook | null {
  const h = blendHourly(json?.hourly) as any;
  const time: unknown = h?.time;
  if (!Array.isArray(time) || time.length === 0) return null;
  return outlookFromHourly({
    timeMs: time.map((t: string) => parseUtc(t)),
    total: h.cloud_cover,
    low: h.cloud_cover_low,
    mid: h.cloud_cover_mid,
    high: h.cloud_cover_high,
  });
}

/** 한 시간 — 모델 실행은 몇 시간 간격이라 더 자주 받아도 같은 값입니다. */
export const OUTLOOK_TTL_MS = 60 * 60 * 1000;
const MEM = new Map<string, { data: CloudOutlook; at: number }>();
const INFLIGHT = new Map<string, Promise<CloudOutlook>>();

export const outlookKey = (lat: number, lon: number) => `outlook16_${gridBucket(lat, lon)}`;

/** 받아 둔 예보(네트워크 없음). 없거나 한 시간이 지났으면 null. */
export function cachedOutlook(lat: number, lon: number): CloudOutlook | null {
  const hit = MEM.get(outlookKey(lat, lon));
  return hit && Date.now() - hit.at < OUTLOOK_TTL_MS ? hit.data : null;
}

export async function fetchCloudOutlook(lat: number, lon: number, opts: { signal?: AbortSignal; force?: boolean } = {}): Promise<CloudOutlook> {
  const key = outlookKey(lat, lon);
  if (!opts.force) {
    const hit = cachedOutlook(lat, lon);
    if (hit) return hit;
    const pending = INFLIGHT.get(key);
    if (pending) return pending;
  }
  const job = (async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    opts.signal?.addEventListener('abort', () => ctl.abort(), { once: true });
    try {
      const res = await fetch(outlookUrl(lat, lon), { signal: ctl.signal });
      if (!res.ok) throw new Error(res.status === 429 ? 'RATE_LIMIT' : `HTTP_${res.status}`);
      const json = await res.json();
      if (json?.error) throw new Error(/limit/i.test(String(json?.reason ?? '')) ? 'RATE_LIMIT' : String(json?.reason ?? 'ERROR'));
      const data = outlookFromResponse(json);
      if (!data) throw new Error('EMPTY');
      MEM.set(key, { data, at: Date.now() });
      return data;
    } finally {
      clearTimeout(timer);
    }
  })();
  INFLIGHT.set(key, job);
  try {
    return await job;
  } finally {
    INFLIGHT.delete(key);
  }
}
