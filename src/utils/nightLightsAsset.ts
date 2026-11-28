/**
 * nightLightsAsset.ts — 앱에 담은 밤 불빛 지도(assets/nightlights/lights_01deg.png, 0.1° 세계, 약 730 KB)를 한 번 읽어 풉니다.
 * 3600×1800 을 푸는 데 기기에서 수백 ms — 한 번만, 비동기로. 실패하면 null(도시 불빛은 사방 고르게).
 * 하네스(웹 묶기)는 react-native·expo 를 대체 모듈로 바꾸므로 이 파일은 앱(SkyScene3D)에서만 부릅니다.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  cityLightField,
  decodeGrayPng,
  getPrehydratedCityLightField,
  primeCityLightFieldCache,
  setCityLightFieldPersister,
  type CityLightField,
  type NightLights,
} from './cityLightMap';
import { setMvtDiskCacheAdapter } from './mvtTiles';
import { setStbnDiskCacheAdapter } from '../components/VolumetricProbe/volumetricScene';
import { perfStart, perfEnd } from './perfTrace';

const { Asset } = require('expo-asset') as {
  Asset: {
    fromModule: (moduleId: number) => {
      downloadAsync: () => Promise<void>;
      localUri: string | null;
      uri: string;
    };
  };
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_REV = (() => { const t = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i; return t; })();
/** base64 → 바이트 — Hermes 의 atob 유무에 기대지 않습니다. */
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const a = B64_REV[clean.charCodeAt(i)], b = B64_REV[clean.charCodeAt(i + 1)];
    const c = i + 2 < clean.length ? B64_REV[clean.charCodeAt(i + 2)] : -1, d = i + 3 < clean.length ? B64_REV[clean.charCodeAt(i + 3)] : -1;
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    out[o++] = (n >> 16) & 255;
    if (c >= 0) out[o++] = (n >> 8) & 255;
    if (d >= 0) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    chunk +=
      B64[(n >> 18) & 63] +
      B64[(n >> 12) & 63] +
      (i + 1 < len ? B64[(n >> 6) & 63] : '=') +
      (i + 2 < len ? B64[n & 63] : '=');
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = '';
    }
  }
  if (chunk) parts.push(chunk);
  return parts.join('');
}

const STBN_CACHE_FILE = Platform.OS !== 'web' && FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}stbn_3d_v1.b64`
  : null;

if (STBN_CACHE_FILE) {
  setStbnDiskCacheAdapter({
    read: async () => {
      try {
        const info = await FileSystem.getInfoAsync(STBN_CACHE_FILE);
        if (!info.exists || !info.size) return null;
        const b64 = await FileSystem.readAsStringAsync(STBN_CACHE_FILE);
        return b64 ? fromBase64(b64) : null;
      } catch {
        return null;
      }
    },
    write: (bytes: Uint8Array) => {
      FileSystem.writeAsStringAsync(STBN_CACHE_FILE, toBase64(bytes)).catch(() => {});
    },
  });
}

const MVT_CACHE_DIR = Platform.OS !== 'web' && FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}mvt_tiles/`
  : null;
let mvtDirReady = false;

if (MVT_CACHE_DIR) {
  setMvtDiskCacheAdapter({
    read: async (key: string) => {
      try {
        const path = `${MVT_CACHE_DIR}${key.replace(/\//g, '_')}.b64`;
        const info = await FileSystem.getInfoAsync(path);
        if (!info.exists || !info.size) return null;
        const b64 = await FileSystem.readAsStringAsync(path);
        return b64 ? fromBase64(b64) : null;
      } catch {
        return null;
      }
    },
    write: (key: string, bytes: Uint8Array) => {
      void (async () => {
        try {
          if (!mvtDirReady) {
            const info = await FileSystem.getInfoAsync(MVT_CACHE_DIR);
            if (!info.exists) await FileSystem.makeDirectoryAsync(MVT_CACHE_DIR, { intermediates: true });
            mvtDirReady = true;
          }
          const path = `${MVT_CACHE_DIR}${key.replace(/\//g, '_')}.b64`;
          await FileSystem.writeAsStringAsync(path, toBase64(bytes));
        } catch {
          // ignore disk cache write failure
        }
      })();
    },
  });
}

const FIELD_CACHE_FILE = Platform.OS !== 'web' && FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}nightlights_field_v1.json`
  : null;
const RAW_BIN_CACHE_FILE = Platform.OS !== 'web' && FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}nightlights_3600x1800_v1.b64`
  : null;
const MAX_PERSISTED_FIELDS = 24;

interface SerializedCityField {
  n: number;
  halfKm: number;
  maxPatch: number;
  local: number;
  walker: number;
  skyGlow: number;
  pollution: number;
  magLimit: number;
  azGain: number[];
  patch: number[];
}

let persistedFieldsMap: Record<string, SerializedCityField> = {};
let fieldCacheHydratedPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSaveFieldCache(): void {
  if (!FIELD_CACHE_FILE) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    FileSystem.writeAsStringAsync(FIELD_CACHE_FILE, JSON.stringify(persistedFieldsMap)).catch(() => {});
  }, 1200);
}

setCityLightFieldPersister((key, field) => {
  if (!FIELD_CACHE_FILE) return;
  const keys = Object.keys(persistedFieldsMap);
  if (!persistedFieldsMap[key] && keys.length >= MAX_PERSISTED_FIELDS) {
    delete persistedFieldsMap[keys[0]];
  }
  persistedFieldsMap[key] = {
    n: field.n,
    halfKm: field.halfKm,
    maxPatch: field.maxPatch,
    local: field.local,
    walker: field.walker,
    skyGlow: field.skyGlow,
    pollution: field.pollution,
    magLimit: field.magLimit,
    azGain: Array.from(field.azGain, v => Math.round(v * 10000) / 10000),
    patch: Array.from(field.patch, v => Math.round(v * 10000) / 10000),
  };
  scheduleSaveFieldCache();
});

/** 디스크에 영구 저장된 위치별 밤 불빛 계산 결과(CityLightField)를 읽어 메모리에 적재합니다(약 1~2ms). */
export function hydrateNightLightsFieldCache(): Promise<void> {
  if (!FIELD_CACHE_FILE) return Promise.resolve();
  if (!fieldCacheHydratedPromise) {
    fieldCacheHydratedPromise = (async () => {
      try {
        const info = await FileSystem.getInfoAsync(FIELD_CACHE_FILE);
        if (!info.exists) return;
        const raw = await FileSystem.readAsStringAsync(FIELD_CACHE_FILE);
        const parsed = JSON.parse(raw) as Record<string, SerializedCityField>;
        if (!parsed || typeof parsed !== 'object') return;
        persistedFieldsMap = parsed;
        const hydrated: Record<string, CityLightField> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (!v || !Array.isArray(v.azGain) || !Array.isArray(v.patch)) continue;
          hydrated[k] = {
            n: v.n,
            halfKm: v.halfKm,
            maxPatch: v.maxPatch,
            local: v.local,
            walker: v.walker,
            skyGlow: v.skyGlow,
            pollution: v.pollution,
            magLimit: v.magLimit,
            azGain: new Float32Array(v.azGain),
            patch: new Float32Array(v.patch),
          };
        }
        primeCityLightFieldCache(hydrated);
      } catch {
        // ignore corrupted cache
      }
    })();
  }
  return fieldCacheHydratedPromise;
}

let cache: Promise<NightLights | null> | null = null;
let resolvedCache: NightLights | null = null;
const PREHYDRATED_STUB: NightLights = { w: 3600, h: 1800, data: new Uint8Array(0) };

/**
 * 해당 위치(lat, lon)의 밤 불빛 계산 결과가 디스크 캐시에 있으면 3600×1800 PNG 디코딩을 아예 생략하고 즉시 반환합니다.
 * 캐시에 없는 새 위치로 이동했을 때만 원본 밤지도를 로드해 계산·영구 저장합니다.
 */
export async function ensureNightLightsForLocation(lat: number, lon: number): Promise<CityLightField | null> {
  const tAll = perfStart('NightLights', `ensure(${lat.toFixed(2)},${lon.toFixed(2)})`);
  await hydrateNightLightsFieldCache();
  const hit = getPrehydratedCityLightField(lat, lon);
  if (hit) {
    if (!resolvedCache) resolvedCache = PREHYDRATED_STUB;
    perfEnd(tAll, 'diskCacheHit');
    return hit;
  }
  const map = await loadNightLights();
  if (!map) { perfEnd(tAll, 'mapNull'); return null; }
  const tField = perfStart('NightLights', 'cityLightField');
  const field = cityLightField(map, lat, lon);
  perfEnd(tField);
  perfEnd(tAll, 'computed');
  return field;
}

/** 이미 로드가 끝난 밤 불빛 지도가 있으면 동기로 반환합니다. */
export function getCachedNightLights(): NightLights | null {
  return resolvedCache;
}

export function loadNightLights(): Promise<NightLights | null> {
  if (!cache) {
    cache = (async () => {
      try {
        await hydrateNightLightsFieldCache();
        const tAsset = perfStart('NightLights', 'asset+readBase64');
        const asset = Asset.fromModule(require('../../assets/nightlights/lights_01deg.png'));
        await asset.downloadAsync();
        const uri = asset.localUri ?? asset.uri;
        const bytes = Platform.OS === 'web'
          ? new Uint8Array(await (await fetch(uri)).arrayBuffer())
          : fromBase64(await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }));
        perfEnd(tAsset, `${Math.round(bytes.length / 1024)}KB`);
        // PNG 디코딩 전후로 이벤트 루프에 양보해 UI/렌더 스레드가 멈추지 않게 합니다.
        await new Promise(r => setTimeout(r, 0));
        const tPng = perfStart('NightLights', 'decodeGrayPng(3600x1800)');
        resolvedCache = decodeGrayPng(bytes);
        perfEnd(tPng);
        return resolvedCache;
      } catch (e) {
        if (__DEV__) console.warn('[nightLights] load failed', e);
        return null;
      }
    })();
  }
  return cache;
}
