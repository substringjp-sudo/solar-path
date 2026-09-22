/**
 * persistentCache.ts
 *
 * **날씨·지형 캐시를 저장장치에 둡니다.**
 *
 * ## 왜 zustand `persist` 에 안 얹었나 — 재서 정했습니다
 *
 * 스토어에는 이미 `persist` 가 붙어 있고 AsyncStorage 에 암호화까지 합니다.
 * 거기에 캐시를 얹는 게 한 줄로 끝나 보이지만, **한 덩어리로 쓴다**는 것이
 * 문제입니다. `partialize` 에 든 값이 **하나라도** 바뀌면 덩어리 전체를 다시
 * 직렬화하고 다시 암호화합니다.
 *
 * 실제 크기를 쟀습니다(2026-09-22, 35점·24시간·변수 11개):
 *
 * ```
 *   날씨 1칸   64 KB      10칸 가득이면  0.63 MB
 *   지형 1칸  1.3 KB      10칸 가득이면    13 KB     ← 날씨의 1/51
 * ```
 *
 * 지도에서 핀만 옮겨도 `location` 이 바뀌어 덩어리가 다시 써집니다. 거기에
 * 날씨 0.63MB 가 얹혀 있으면 **핀을 옮길 때마다 0.63MB 를 다시 암호화**합니다.
 * 그래서 캐시는 **자기 열쇠**에 따로 둡니다.
 *
 * 덤으로 나뉘는 것이 하나 더 있습니다 — `solar-path-storage` 는 사용자의
 * 것(위치·저장한 곳·사진)이고 여기는 **언제 버려도 되는 것**입니다. 캐시만
 * 통째로 비울 수 있습니다.
 *
 * ⚠ 그래도 암호화는 합니다. 캐시 항목이 위경도를 들고 있어서, 이게 평문이면
 * 사용자가 어디 있었는지가 그대로 남습니다.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { encryptData, decryptData } from './security';
import {
  CACHE_SCHEMA_VERSION, MAX_CACHE_ENTRIES, CacheEntry,
} from './cachePolicy';

const WEATHER_KEY = 'solar-path-cache-weather';
const TERRAIN_KEY = 'solar-path-cache-terrain';

interface Envelope<T> {
  v: number;
  entries: CacheEntry<T>[];
}

const read = async <T>(key: string): Promise<CacheEntry<T>[]> => {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    let text: string;
    try {
      text = decryptData(raw);
    } catch {
      text = raw; // 암호화 전에 쓰인 것이 있으면 그대로 읽어 봅니다
    }
    const env = JSON.parse(text) as Envelope<T>;
    // ⚠ 형식이 다르면 **읽지 않고 버립니다.** 모양이 달라진 캐시를 화면에
    //   먹이면 조용히 망가지는데, 다시 받으면 되는 것이라 버리는 값이 0입니다.
    if (!env || env.v !== CACHE_SCHEMA_VERSION || !Array.isArray(env.entries)) return [];
    return env.entries.slice(0, MAX_CACHE_ENTRIES);
  } catch (e) {
    console.warn(`[Cache] ${key} 를 못 읽었습니다:`, e);
    return [];
  }
};

const write = async <T>(key: string, entries: CacheEntry<T>[]): Promise<void> => {
  try {
    const body = JSON.stringify({ v: CACHE_SCHEMA_VERSION, entries } as Envelope<T>);
    await AsyncStorage.setItem(key, encryptData(body));
  } catch (e) {
    // 캐시 쓰기 실패는 **치명적이지 않습니다** — 다음에 다시 받으면 됩니다.
    // 앱을 멈추지 않고 넘어갑니다.
    console.warn(`[Cache] ${key} 를 못 썼습니다:`, e);
  }
};

export const loadWeatherCache = <T = any>() => read<T>(WEATHER_KEY);
export const loadTerrainCache = <T = any>() => read<T>(TERRAIN_KEY);
export const saveWeatherCache = <T = any>(e: CacheEntry<T>[]) => write(WEATHER_KEY, e);
export const saveTerrainCache = <T = any>(e: CacheEntry<T>[]) => write(TERRAIN_KEY, e);

/** 캐시만 통째로 비웁니다. 사용자 자료(`solar-path-storage`)는 안 건드립니다. */
export const clearCaches = async (): Promise<void> => {
  try {
    await AsyncStorage.multiRemove([WEATHER_KEY, TERRAIN_KEY]);
  } catch (e) {
    console.warn('[Cache] 비우기 실패:', e);
  }
};
