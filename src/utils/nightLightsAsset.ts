/**
 * nightLightsAsset.ts — 앱에 담은 밤 불빛 지도(assets/nightlights/lights_01deg.png, 0.1° 세계, 약 730 KB)를 한 번 읽어 풉니다.
 * 3600×1800 을 푸는 데 기기에서 수백 ms — 한 번만, 비동기로. 실패하면 null(도시 불빛은 사방 고르게).
 * 하네스(웹 묶기)는 react-native·expo 를 대체 모듈로 바꾸므로 이 파일은 앱(SkyScene3D)에서만 부릅니다.
 */
import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { decodeGrayPng, type NightLights } from './cityLightMap';

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

let cache: Promise<NightLights | null> | null = null;
export function loadNightLights(): Promise<NightLights | null> {
  if (!cache) {
    cache = (async () => {
      try {
        const asset = Asset.fromModule(require('../../assets/nightlights/lights_01deg.png'));
        await asset.downloadAsync();
        const uri = asset.localUri ?? asset.uri;
        const bytes = Platform.OS === 'web'
          ? new Uint8Array(await (await fetch(uri)).arrayBuffer())
          : fromBase64(await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }));
        return decodeGrayPng(bytes);
      } catch (e) {
        if (__DEV__) console.warn('[nightLights] load failed', e);
        return null;
      }
    })();
  }
  return cache;
}
