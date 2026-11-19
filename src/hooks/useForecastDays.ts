/**
 * useForecastDays.ts — 앞으로 며칠의 일출·일몰 판정 목록과 그 바탕 16일 예보 받기.
 *
 * 02 예보 화면과 01 하늘 시트의 "다가오는 좋은 순간" 카드가 **같은 식 · 같은 한 시간 캐시**를 씁니다(`utils/sunForecast.ts`).
 * 받는 때는 부르는 쪽이 `fetch` 로 정합니다 — 02 예보는 탭이 보일 때, 01 하늘은 시트를 펼쳤을 때만. 앱을 켤 때는 받지 않습니다.
 * `compute` 가 꺼져 있으면 판정 목록을 세지 않습니다(안 보이는 화면에서 헛수고 하지 않음).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCelestialStore } from '../store/useCelestialStore';
import {
  buildForecastDays,
  cachedSunForecast,
  fetchSunForecast,
  observerElevationFrom,
  type ForecastDay,
} from '../utils/sunForecast';
import { localDateString } from '../utils/localDate';
import { hapticError } from '../utils/haptics';
import { sameBucket } from '../utils/weatherCacheKey';
import type { CloudPathData } from '../utils/weather';

export type ForecastLoadState = { kind: 'idle' | 'loading' | 'ready' } | { kind: 'error'; rateLimited: boolean };

export interface UseForecastDaysOptions {
  /** 켜져 있는 동안(켜지는 순간 한 번) 예보를 받습니다. 한 시간 안의 캐시가 있으면 그것을 씁니다. */
  fetch: boolean;
  /** 켜져 있을 때만 판정 목록을 셉니다. */
  compute: boolean;
  /** 앞으로 몇 날을 셀지(기본 16일). 오늘이 첫날입니다. */
  days?: number;
  /** 받기에 실패했을 때 손에 진동을 줄지(기본 켬). */
  haptic?: boolean;
}

export function useForecastDays({ fetch, compute, days: dayCount, haptic = true }: UseForecastDaysOptions) {
  const location = useCelestialStore(s => s.location);
  const tz = useCelestialStore(s => s.timezoneOffsetHours) ?? 0;
  const weatherCacheList = useCelestialStore(s => s.weatherCacheList);
  const terrainCacheList = useCelestialStore(s => s.terrainCacheList);
  const lat = location?.coords?.latitude;
  const lon = location?.coords?.longitude;

  const [forecast, setForecast] = useState<CloudPathData[] | null>(() =>
    lat != null && lon != null ? cachedSunForecast(lat, lon)?.path ?? null : null);
  const [load, setLoad] = useState<ForecastLoadState>({ kind: 'idle' });
  // "지금" 은 받기를 시작할 때마다 새로 — 렌더마다 바꾸면 판정을 매번 다시 셉니다.
  const [now, setNow] = useState(() => new Date());

  const get = useCallback((force: boolean) => {
    if (lat == null || lon == null) return () => {};
    const ctrl = new AbortController();
    setLoad({ kind: 'loading' });
    fetchSunForecast(lat, lon, new Date(), { force, signal: ctrl.signal, tzHours: tz })
      .then(d => { setForecast(d.path); setLoad({ kind: 'ready' }); })
      .catch(err => {
        if (ctrl.signal.aborted || err?.name === 'AbortError') return;
        if (haptic) hapticError();
        setLoad({ kind: 'error', rateLimited: String(err?.message) === 'RATE_LIMIT' });
      });
    return () => ctrl.abort();
  }, [lat, lon, tz, haptic]);

  useEffect(() => {
    if (!fetch) return;
    setNow(new Date());
    return get(false);
  }, [fetch, get]);

  const elev = lat != null && lon != null ? observerElevationFrom(terrainCacheList, lat, lon, location?.coords?.altitude) : undefined;
  const ringFor = useCallback((at: Date) => {
    if (lat == null || lon == null) return null;
    const dateStr = localDateString(at);
    const hit = weatherCacheList.find(c => c.key.includes(dateStr) && sameBucket(c.latitude, c.longitude, lat, lon));
    return (hit?.data as CloudPathData[] | undefined) ?? null;
  }, [weatherCacheList, lat, lon]);

  const days: ForecastDay[] = useMemo(() => {
    if (!compute || lat == null || lon == null) return [];
    return buildForecastDays({ latitude: lat, longitude: lon, now, tzHours: tz, observerElevM: elev, forecast, ringFor, days: dayCount });
  }, [compute, lat, lon, now, tz, elev, forecast, ringFor, dayCount]);

  return { days, forecast, load, get, now };
}
