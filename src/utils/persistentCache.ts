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

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { encryptData, decryptData } from './security';
import {
  CACHE_SCHEMA_VERSION, MAX_CACHE_ENTRIES, CacheEntry,
} from './cachePolicy';

const WEATHER_KEY = 'solar-path-cache-weather';
const TERRAIN_KEY = 'solar-path-cache-terrain';
const RING_KEY = 'solar-path-cache-ring';

const BASE_DIR = Platform.OS !== 'web' && FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}weather_store/`
  : null;

interface Envelope<T> {
  v: number;
  entries: CacheEntry<T>[];
}

interface FileEnvelope<T> {
  v: number;
  entry: CacheEntry<T>;
}

const MAX_STORAGE_CHARS = 1_400_000; // Web/AsyncStorage 폴백용 행 크기 상한
const HARD_STORAGE_CHARS = 1_800_000;
const writtenTimestamps = new Map<string, number>();

const decodeText = (raw: string): string => {
  try {
    return decryptData(raw);
  } catch {
    return raw; // 암호화 전에 쓰인 것이 있으면 그대로 읽어 봅니다
  }
};

const safeFileName = (entryKey: string): string =>
  `${entryKey.replace(/[^a-zA-Z0-9._-]/g, '_')}.dat`;

const ensureDir = async (dir: string): Promise<void> => {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
};

const readAsyncStorage = async <T>(key: string, max = MAX_CACHE_ENTRIES): Promise<CacheEntry<T>[]> => {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const env = JSON.parse(decodeText(raw)) as Envelope<T>;
    // ⚠ 형식이 다르면 **읽지 않고 버립니다.** 모양이 달라진 캐시를 화면에
    //   먹이면 조용히 망가지는데, 다시 받으면 되는 것이라 버리는 값이 0입니다.
    if (!env || env.v !== CACHE_SCHEMA_VERSION || !Array.isArray(env.entries)) return [];
    return env.entries.slice(0, max);
  } catch (e) {
    console.warn(`[Cache] ${key} 를 못 읽었습니다:`, e);
    await AsyncStorage.removeItem(key).catch(() => {});
    return [];
  }
};

const writeAsyncStorage = async <T>(key: string, entries: CacheEntry<T>[]): Promise<void> => {
  try {
    let trimmed = entries;
    let encrypted = encryptData(JSON.stringify({ v: CACHE_SCHEMA_VERSION, entries: trimmed } as Envelope<T>));
    while (encrypted.length > MAX_STORAGE_CHARS && trimmed.length > 1) {
      trimmed = trimmed.slice(0, -1);
      encrypted = encryptData(JSON.stringify({ v: CACHE_SCHEMA_VERSION, entries: trimmed } as Envelope<T>));
    }
    if (encrypted.length > HARD_STORAGE_CHARS) {
      console.warn(`[Cache] ${key} 크기가 한도를 초과해 쓰기를 건너뜁니다 (${encrypted.length} chars)`);
      return;
    }
    await AsyncStorage.setItem(key, encrypted);
  } catch (e) {
    // 캐시 쓰기 실패는 **치명적이지 않습니다** — 다음에 다시 받으면 됩니다.
    // 앱을 멈추지 않고 넘어갑니다.
    console.warn(`[Cache] ${key} 를 못 썼습니다:`, e);
  }
};

const readFiles = async <T>(bucket: string, legacyKey: string, max = MAX_CACHE_ENTRIES): Promise<CacheEntry<T>[]> => {
  if (!BASE_DIR) return readAsyncStorage<T>(legacyKey, max);
  const dir = `${BASE_DIR}${bucket}/`;
  try {
    await ensureDir(dir);
    const files = (await FileSystem.readDirectoryAsync(dir)).filter(f => f.endsWith('.dat'));
    const loaded: CacheEntry<T>[] = [];
    for (const file of files) {
      const path = `${dir}${file}`;
      try {
        const raw = await FileSystem.readAsStringAsync(path);
        const env = JSON.parse(decodeText(raw)) as FileEnvelope<T>;
        if (env?.v === CACHE_SCHEMA_VERSION && env.entry?.key) {
          loaded.push(env.entry);
          writtenTimestamps.set(path, env.entry.timestamp);
        } else {
          await FileSystem.deleteAsync(path, { idempotent: true });
        }
      } catch {
        await FileSystem.deleteAsync(path, { idempotent: true });
      }
    }
    loaded.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    if (loaded.length > 0) {
      await AsyncStorage.removeItem(legacyKey).catch(() => {});
      return loaded.slice(0, max);
    }

    // 기존 AsyncStorage 에 남아있던 항목이 있으면 파일 저장소로 1회 이관
    const legacy = await readAsyncStorage<T>(legacyKey, max);
    if (legacy.length > 0) {
      await writeFiles(bucket, legacyKey, legacy);
      await AsyncStorage.removeItem(legacyKey).catch(() => {});
    }
    return legacy;
  } catch (e) {
    console.warn(`[Cache] ${bucket} 파일 저장소를 못 읽었습니다:`, e);
    return [];
  }
};

const writeFiles = async <T>(bucket: string, legacyKey: string, entries: CacheEntry<T>[]): Promise<void> => {
  if (!BASE_DIR) return writeAsyncStorage<T>(legacyKey, entries);
  const dir = `${BASE_DIR}${bucket}/`;
  try {
    await ensureDir(dir);
    const keepNames = new Set<string>();
    for (const entry of entries) {
      const name = safeFileName(entry.key);
      keepNames.add(name);
      const path = `${dir}${name}`;
      // 이미 같은 timestamp 로 저장된 파일은 다시 암호화·기록하지 않습니다.
      if (writtenTimestamps.get(path) === entry.timestamp) continue;
      const body = JSON.stringify({ v: CACHE_SCHEMA_VERSION, entry } as FileEnvelope<T>);
      await FileSystem.writeAsStringAsync(path, encryptData(body));
      writtenTimestamps.set(path, entry.timestamp);
    }
    const existing = await FileSystem.readDirectoryAsync(dir);
    for (const file of existing) {
      if (!keepNames.has(file)) {
        const path = `${dir}${file}`;
        await FileSystem.deleteAsync(path, { idempotent: true });
        writtenTimestamps.delete(path);
      }
    }
  } catch (e) {
    console.warn(`[Cache] ${bucket} 파일 저장소에 못 썼습니다:`, e);
  }
};

export const loadWeatherCache = <T = any>() => readFiles<T>('weather', WEATHER_KEY, MAX_CACHE_ENTRIES);
export const loadTerrainCache = <T = any>() => readAsyncStorage<T>(TERRAIN_KEY);
export const loadRingCache = <T = any>() => readFiles<T>('ring', RING_KEY, MAX_CACHE_ENTRIES);
export const saveWeatherCache = <T = any>(e: CacheEntry<T>[]) => writeFiles('weather', WEATHER_KEY, e);
export const saveTerrainCache = <T = any>(e: CacheEntry<T>[]) => writeAsyncStorage(TERRAIN_KEY, e);
export const saveRingCache = <T = any>(e: CacheEntry<T>[]) => writeFiles('ring', RING_KEY, e);

/** 캐시만 통째로 비웁니다. 사용자 자료(`solar-path-storage`)는 안 건드립니다. */
export const clearCaches = async (): Promise<void> => {
  try {
    writtenTimestamps.clear();
    await AsyncStorage.multiRemove([WEATHER_KEY, TERRAIN_KEY, RING_KEY]);
    if (BASE_DIR) {
      await FileSystem.deleteAsync(BASE_DIR, { idempotent: true });
    }
  } catch (e) {
    console.warn('[Cache] 비우기 실패:', e);
  }
};
