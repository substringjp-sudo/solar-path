/**
 * cityLightMap.ts — 밤 불빛 지도(NASA Black Marble 2016, 0.1° 칸, `assets/nightlights/lights_01deg.png`, tools/nightlights/README.md)로
 * 관측점 둘레 도시 불빛의 방향·구름 반사 분포·별 광해 등급을 냅니다.
 *
 *  - azGain[36]: 방위 10° 칸마다 지평선 빛의 상대 세기(평균 1). 도시가 있는 쪽 지평선만 밝게.
 *    칸의 몫 = Σ L·면적·d^(−2.5) (Walker 의 법칙: 도시 하나의 하늘빛은 거리의 −2.5 제곱), 10~300 km.
 *  - patch: 관측점 둘레 ±60 km 의 구름 밑면 배율 (표준 대도시 밝기 `CITY_REF_LOCAL` 기준 절대 비율 0~1.25).
 *    어두운 시골·바다 위 구름은 0 에 가깝고, 근처 도시 위 구름만 밝게 비춥니다.
 *  - skyGlow (0~1): 3.0등급 기준 도시 하늘빛 대비 관측점 지평선/천정 인공광 비율(선형 복사).
 *  - pollution (0~1) · magLimit (3.0~6.5): Weber-Fechner 로그 감각으로 환산한 관측점 별 한계 등급·광해 계수.
 * 저장 값 v → 상대 밝기 L = (v/255)².
 */
import { unzlibSync } from 'fflate';

export interface NightLights { w: number; h: number; data: Uint8Array }

/** 표준 대도시 중심(서울/수도권 등)의 5km 가우스 흐림 땅 밝기 및 Walker 적분 기준치 */
export const CITY_REF_LOCAL = 0.88;
export const CITY_REF_WALKER = 1.22;

/**
 * 8 비트 PNG(인터레이스 없음)를 풀어 첫 채널만 남깁니다 — RN 에 캔버스가 없어 직접. 회색·RGB·팔레트·알파 모두 받음
 * (안드로이드 빌드가 PNG 를 다시 눌러 팔레트로 바꿀 수 있음).
 */
export function decodeGrayPng(bytes: Uint8Array): NightLights {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8, w = 0, h = 0, ct = 0;
  let plte: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (p < bytes.length) {
    const len = dv.getUint32(p); const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const body = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); ct = body[9];
      if (body[8] !== 8 || body[12] !== 0) throw new Error('cityLightMap: 8 비트·비인터레이스 PNG 만');
    } else if (type === 'PLTE') plte = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ct];
  if (!bpp) throw new Error('cityLightMap: PNG 색 형식 ' + ct);
  const total = idat.reduce((a, b) => a + b.length, 0);
  const z = new Uint8Array(total); let o = 0; for (const b of idat) { z.set(b, o); o += b.length; }
  const raw = unzlibSync(z);
  const stride = w * bpp;
  const out = new Uint8Array(w * h);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) { const v = cur[x * bpp]; out[y * w + x] = ct === 3 && plte ? plte[v * 3] : v; }
    const t = prev; prev = cur; cur = t;
  }
  return { w, h, data: out };
}

const R_KM = 6371;
/** 위경도(°)의 상대 밝기 L(쌍선형). */
export function lightAt(m: NightLights, lat: number, lon: number): number {
  const fx = ((lon + 180) / 360) * m.w - 0.5, fy = ((90 - lat) / 180) * m.h - 0.5;
  const x0 = Math.floor(fx), y0 = Math.max(0, Math.min(m.h - 2, Math.floor(fy))), u = fx - x0, v = Math.min(1, Math.max(0, fy - y0));
  const g = (x: number, y: number) => { const q = m.data[y * m.w + (((x % m.w) + m.w) % m.w)] / 255; return q * q; };
  return (g(x0, y0) * (1 - u) + g(x0 + 1, y0) * u) * (1 - v) + (g(x0, y0 + 1) * (1 - u) + g(x0 + 1, y0 + 1) * u) * v;
}

export interface LightPollutionEstimate {
  /** 관측점 흐린 땅 밝기 L (0~1) */
  local: number;
  /** 주변 10~300km Walker 방위 적분 합 */
  walker: number;
  /** 3.0등급 기준 도시 하늘빛 대비 관측점 인공광 비율 (0~1, 선형 복사) */
  skyGlow: number;
  /** 광해 감각 지수 (0=완전 암천 6.5등급, 1=대도시 3.0등급) */
  pollution: number;
  /** 빛지도 기준 추정 별 한계 등급 (3.0~6.5) */
  magLimit: number;
}

export interface CityLightField extends LightPollutionEstimate {
  /** 방위 0°(북)부터 10° 칸 36 개, 평균 1 */
  azGain: Float32Array;
  /** ±halfKm 정사각형(n×n, 행 = 남→북, 열 = 서→동) 구름 밑면 배율 (절대 도시 밝기 비율 0~1.25) */
  patch: Float32Array; n: number; halfKm: number;
  /** 패치 안 최대 땅 밝기 배율 (멀리 도심이 있어 반사될 구름이 있는지 판별) */
  maxPatch: number;
}

/** 5×5 σ=5 km 가우스 흐림 땅 밝기 L */
function blurredLightAt(m: NightLights, lat: number, lon: number, kmLat: number, kmLon: number): number {
  let s = 0, w = 0;
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
    const wk = Math.exp(-((i * 2.5) ** 2 + (j * 2.5) ** 2) / (2 * 25));
    s += wk * lightAt(m, lat + (j * 2.5) / kmLat, lon + (i * 2.5) / kmLon);
    w += wk;
  }
  return s / w;
}

interface WalkerStats {
  azGain: Float32Array;
  local: number;
  walker: number;
  skyGlow: number;
  pollution: number;
  magLimit: number;
}

const walkerCache = new WeakMap<NightLights, Map<string, WalkerStats>>();
const fieldCache = new WeakMap<NightLights, Map<string, CityLightField>>();
const prehydratedFieldCache = new Map<string, CityLightField>();
const MAP_CACHE_MAX = 16;

type CityFieldPersister = (key: string, field: CityLightField) => void;
let cityFieldPersister: CityFieldPersister | null = null;

/** 디스크에서 복원한 위치별 광해 계산 결과(CityLightField)를 메모리에 미리 적재합니다. */
export function primeCityLightFieldCache(entries: Record<string, CityLightField>): void {
  for (const [k, v] of Object.entries(entries)) {
    if (!v || !(v.azGain instanceof Float32Array) || !(v.patch instanceof Float32Array)) continue;
    prehydratedFieldCache.set(k, v);
  }
}

/** 새 위치의 CityLightField 가 계산될 때 디스크에 영구 저장할 콜백을 등록합니다. */
export function setCityLightFieldPersister(fn: CityFieldPersister | null): void {
  cityFieldPersister = fn;
}

/** 원본 3600×1800 밤 불빛 지도 PNG 를 디코딩하지 않고도 프리하이드레이션된 위치 캐시가 있으면 즉시 반환합니다. */
export function getPrehydratedCityLightField(lat: number, lon: number, n = 48, halfKm = 60): CityLightField | null {
  const key = `${lat.toFixed(2)}|${lon.toFixed(2)}|${n}|${halfKm}`;
  return prehydratedFieldCache.get(key) ?? null;
}

/** 프리하이드레이션된 캐시에서 광해 등급(LightPollutionEstimate)을 즉시 조회합니다. */
export function getPrehydratedLightPollution(lat: number, lon: number): LightPollutionEstimate | null {
  const f = getPrehydratedCityLightField(lat, lon);
  if (!f) return null;
  return {
    local: f.local,
    walker: f.walker,
    skyGlow: f.skyGlow,
    pollution: f.pollution,
    magLimit: f.magLimit,
  };
}

function putLru<T>(cache: WeakMap<NightLights, Map<string, T>>, m: NightLights, key: string, val: T): T {
  let map = cache.get(m);
  if (!map) { map = new Map(); cache.set(m, map); }
  map.delete(key);
  map.set(key, val);
  while (map.size > MAP_CACHE_MAX) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest); else break;
  }
  return val;
}

function getLru<T>(cache: WeakMap<NightLights, Map<string, T>>, m: NightLights, key: string): T | null {
  const map = cache.get(m);
  if (!map) return null;
  const hit = map.get(key);
  if (!hit) return null;
  map.delete(key);
  map.set(key, hit);
  return hit;
}

function computeWalkerStats(m: NightLights, lat: number, lon: number): WalkerStats {
  const key = `${lat.toFixed(2)}|${lon.toFixed(2)}`;
  const cached = getLru(walkerCache, m, key);
  if (cached) return cached;

  const kmLat = (Math.PI * R_KM) / 180;
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const kmLon = kmLat * cosLat;
  const az = new Float64Array(36);
  const span = 3.0, step = 0.1;
  let walker = 0;

  for (let dy = -span; dy <= span + 1e-9; dy += step) {
    for (let dx = -span / cosLat; dx <= span / cosLat + 1e-9; dx += step) {
      const la = lat + dy, lo = lon + dx;
      const L = lightAt(m, la, lo);
      if (L <= 1e-4) continue;
      const cosLa = Math.cos((la * Math.PI) / 180);
      const yk = dy * kmLat, xk = dx * kmLat * cosLa;
      const d = Math.hypot(xk, yk);
      if (d < 10 || d > 300) continue;
      const area = kmLat * step * kmLat * step * cosLa;
      // 하층 대기 수평 소광(L_ext ≈ 45 km): 먼 도시(50~300 km)일수록 산란광이 대기 통과 중 지수 감쇠
      const c = L * area * Math.pow(d, -2.5) * Math.exp(-d / 45);
      const b = Math.floor((((Math.atan2(xk, yk) * 180) / Math.PI + 360) % 360) / 10) % 36;
      az[b] += c;
      walker += c;
    }
  }

  for (let pass = 0; pass < 2; pass++) {
    const t = az.slice();
    for (let i = 0; i < 36; i++) {
      az[i] = (t[(i + 34) % 36] + 4 * t[(i + 35) % 36] + 6 * t[i] + 4 * t[(i + 1) % 36] + t[(i + 2) % 36]) / 16;
    }
  }
  const mean = walker / 36;
  const floor = Math.max(mean * 0.15, 1e-9);
  const azGain = new Float32Array(36);
  for (let i = 0; i < 36; i++) {
    azGain[i] = Math.min(2.4, Math.max(0.2, (az[i] + floor) / (mean + floor)));
  }

  const local = blurredLightAt(m, lat, lon, kmLat, kmLon);
  const combined = 0.65 * Math.max(0, local / CITY_REF_LOCAL) + 0.35 * Math.max(0, walker / CITY_REF_WALKER);
  const skyGlow = Math.min(1, Math.max(0, combined));
  const pollution = Math.min(1, Math.max(0, Math.log1p(40 * combined) / Math.log(41)));
  const magLimit = Math.max(3.0, Math.min(6.5, 6.5 - 3.5 * pollution));

  return putLru(walkerCache, m, key, { azGain, local, walker, skyGlow, pollution, magLimit });
}

/**
 * 밤 불빛 지도만으로 관측점의 광해 지수·추정 한계 등급(3.0~6.5)을 빠르게 계산합니다(48×48 구름 격자 생략).
 */
export function estimateLightPollution(m: NightLights, lat: number, lon: number): LightPollutionEstimate {
  const pre = getPrehydratedLightPollution(lat, lon);
  if (pre) return pre;
  if (!m.data || m.data.length === 0) {
    return { local: 0, walker: 0, skyGlow: 0, pollution: 0, magLimit: 6.5 };
  }
  const { local, walker, skyGlow, pollution, magLimit } = computeWalkerStats(m, lat, lon);
  return { local, walker, skyGlow, pollution, magLimit };
}

export function cityLightField(m: NightLights, lat: number, lon: number, n = 48, halfKm = 60): CityLightField {
  const key = `${lat.toFixed(2)}|${lon.toFixed(2)}|${n}|${halfKm}`;
  const pre = prehydratedFieldCache.get(key);
  if (pre) return pre;
  if (!m.data || m.data.length === 0) {
    return {
      azGain: new Float32Array(36).fill(1),
      patch: new Float32Array(n * n),
      n,
      halfKm,
      maxPatch: 0,
      local: 0,
      walker: 0,
      skyGlow: 0,
      pollution: 0,
      magLimit: 6.5,
    };
  }
  const cached = getLru(fieldCache, m, key);
  if (cached) return cached;

  const stats = computeWalkerStats(m, lat, lon);
  const kmLat = (Math.PI * R_KM) / 180;
  const kmLon = kmLat * Math.max(0.2, Math.cos((lat * Math.PI) / 180));

  // 구름 밑면 배율: 자기 위치로 나누지 않고 표준 도시 밝기(CITY_REF_LOCAL) 대비 절대 비율로 산출.
  // 빛이 없는 시골/바다 위 구름은 0, 인근 도시 상공 ±60km 구름은 그 도시 밝기만큼 비춤.
  const patch = new Float32Array(n * n);
  let maxPatch = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const yk = -halfKm + ((j + 0.5) / n) * 2 * halfKm;
    const xk = -halfKm + ((i + 0.5) / n) * 2 * halfKm;
    const val = Math.min(1.25, Math.max(0, blurredLightAt(m, lat + yk / kmLat, lon + xk / kmLon, kmLat, kmLon) / CITY_REF_LOCAL));
    patch[j * n + i] = val;
    if (val > maxPatch) maxPatch = val;
  }

  const built: CityLightField = {
    azGain: stats.azGain,
    patch,
    n,
    halfKm,
    maxPatch,
    local: stats.local,
    walker: stats.walker,
    skyGlow: stats.skyGlow,
    pollution: stats.pollution,
    magLimit: stats.magLimit,
  };
  prehydratedFieldCache.set(key, built);
  try { cityFieldPersister?.(key, built); } catch { /* ignore persistence errors */ }
  return putLru(fieldCache, m, key, built);
}

/**
 * azGain[36](10° 방위 칸)에서 주 도심 방향 수평 벡터(Three.js 월드 좌표 +X=동, -Z=북)를 추출한다.
 */
export function cityGlowDirection(azGain: Float32Array): { x: number; z: number } {
  let sx = 0;
  let sz = 0;
  for (let i = 0; i < 36; i++) {
    const azRad = ((i + 0.5) * 10 * Math.PI) / 180;
    const w = Math.max(0, azGain[i] - 0.2);
    sx += w * Math.sin(azRad);
    sz += w * -Math.cos(azRad);
  }
  const len = Math.hypot(sx, sz);
  if (len < 1e-4) return { x: 0, z: -1 };
  return { x: sx / len, z: sz / len };
}
