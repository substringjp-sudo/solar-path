/**
 * mvtTiles.ts — OpenFreeMap(OpenMapTiles) MVT(.pbf) 벡터 타일 디코더 및 도시 토지피복 래스터라이저.
 *
 * - 외부 라이브러리(pbf 등) 없이 순수 TypeScript + 기존 `fflate` 만으로 MVT protobuf 를 해석합니다.
 * - `wantedLayers` 로 관심 레이어(`building`, `landuse`, `landcover`, `park`)만 선별 파싱해 모바일에서도 빠르게 동작합니다.
 */
import { gunzipSync } from 'fflate';

/**
 * 지도 자료 건물 높이(`render_height`)의 상한(m). 오타 같은 터무니없는 값을 막는 안전장치입니다. 지금까지 가장 높은 건물이 828 m(부르즈 할리파)라
 * 상한은 그보다 조금 높게 둡니다. 예전에는 400 m 로 잘라 롯데월드타워(555 m)도 400 m 로 그려지고 "꼭대기에 달 걸기" 같은 계산이 135 m 낮게 나왔습니다.
 */
export const MAX_RENDER_HEIGHT_M = 900;

export interface MvtRingPoint {
  x: number;
  y: number;
}

export interface MvtFeature {
  type: number; // 1=Point, 2=LineString, 3=Polygon
  props: Record<string, string | number | boolean>;
  rings: MvtRingPoint[][];
}

export interface MvtLayer {
  name: string;
  extent: number;
  features: MvtFeature[];
}

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

const PLANET_TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const FALLBACK_TILE_TEMPLATE = 'https://tiles.openfreemap.org/planet/20261101_080013_pt/{z}/{x}/{y}.pbf';
const TILE_TIMEOUT_MS = 9000;
const RAW_CACHE_MAX = 24;

let cachedTemplatePromise: Promise<string> | null = null;
const rawTileCache = new Map<string, Uint8Array>();

const textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
function decodeUtf8(bytes: Uint8Array, start: number, end: number): string {
  const slice = bytes.subarray(start, end);
  if (textDecoder) return textDecoder.decode(slice);
  let out = '';
  for (let i = 0; i < slice.length; i++) out += String.fromCharCode(slice[i]);
  return out;
}

function readVarint(b: Uint8Array, st: { p: number }): number {
  let val = 0;
  let mult = 1;
  while (st.p < b.length) {
    const byte = b[st.p++];
    val += (byte & 0x7f) * mult;
    if ((byte & 0x80) === 0) return val;
    mult *= 128;
  }
  return val;
}

function zigzagDecode(n: number): number {
  return n % 2 === 1 ? -(n + 1) / 2 : n / 2;
}

function skipField(b: Uint8Array, st: { p: number }, wt: number): void {
  if (wt === 0) readVarint(b, st);
  else if (wt === 1) st.p += 8;
  else if (wt === 2) st.p += readVarint(b, st);
  else if (wt === 5) st.p += 4;
}

function parseValue(b: Uint8Array, end: number, st: { p: number }): string | number | boolean {
  let out: string | number | boolean = '';
  while (st.p < end) {
    const tag = readVarint(b, st);
    const fn = Math.floor(tag / 8);
    const wt = tag & 7;
    if (fn === 1 && wt === 2) {
      const len = readVarint(b, st);
      out = decodeUtf8(b, st.p, st.p + len);
      st.p += len;
    } else if (fn === 2 && wt === 5) {
      out = new DataView(b.buffer, b.byteOffset + st.p, 4).getFloat32(0, true);
      st.p += 4;
    } else if (fn === 3 && wt === 1) {
      out = new DataView(b.buffer, b.byteOffset + st.p, 8).getFloat64(0, true);
      st.p += 8;
    } else if ((fn === 4 || fn === 5) && wt === 0) {
      out = readVarint(b, st);
    } else if (fn === 6 && wt === 0) {
      out = zigzagDecode(readVarint(b, st));
    } else if (fn === 7 && wt === 0) {
      out = readVarint(b, st) !== 0;
    } else {
      skipField(b, st, wt);
    }
  }
  return out;
}

function decodeGeometryRings(geomInts: number[]): MvtRingPoint[][] {
  const rings: MvtRingPoint[][] = [];
  let ring: MvtRingPoint[] | null = null;
  let cx = 0;
  let cy = 0;
  let i = 0;
  while (i < geomInts.length) {
    const cmdInt = geomInts[i++];
    const cmd = cmdInt & 7;
    const count = Math.floor(cmdInt / 8);
    if (cmd === 1 || cmd === 2) {
      for (let k = 0; k < count && i + 1 < geomInts.length; k++) {
        cx += zigzagDecode(geomInts[i++]);
        cy += zigzagDecode(geomInts[i++]);
        if (cmd === 1) {
          if (ring && ring.length >= 2) rings.push(ring);
          ring = [{ x: cx, y: cy }];
        } else if (ring) {
          ring.push({ x: cx, y: cy });
        }
      }
    } else if (cmd === 7) {
      if (ring && ring.length >= 3) {
        rings.push(ring);
        ring = null;
      }
    }
  }
  if (ring && ring.length >= 2) rings.push(ring);
  return rings;
}

function parseLayer(
  b: Uint8Array,
  start: number,
  end: number,
  wantedLayers?: Set<string>,
): MvtLayer | null {
  // 레이어 이름을 먼저 훑거나, 필드를 수집해 원치 않는 대용량 레이어(poi 등)는 feature 파싱을 건너뜀
  const st = { p: start };
  let name = '';
  let extent = 4096;
  const keys: string[] = [];
  const values: (string | number | boolean)[] = [];
  const featureSlices: [number, number][] = [];

  while (st.p < end) {
    const tag = readVarint(b, st);
    const fn = Math.floor(tag / 8);
    const wt = tag & 7;
    if (fn === 1 && wt === 2) {
      const len = readVarint(b, st);
      name = decodeUtf8(b, st.p, st.p + len);
      st.p += len;
      if (wantedLayers && !wantedLayers.has(name)) {
        st.p = end;
        return null;
      }
    } else if (fn === 2 && wt === 2) {
      const len = readVarint(b, st);
      featureSlices.push([st.p, st.p + len]);
      st.p += len;
    } else if (fn === 3 && wt === 2) {
      const len = readVarint(b, st);
      keys.push(decodeUtf8(b, st.p, st.p + len));
      st.p += len;
    } else if (fn === 4 && wt === 2) {
      const len = readVarint(b, st);
      const vEnd = st.p + len;
      values.push(parseValue(b, vEnd, st));
      st.p = vEnd;
    } else if (fn === 5 && wt === 0) {
      extent = readVarint(b, st) || 4096;
    } else {
      skipField(b, st, wt);
    }
  }

  if (!name || (wantedLayers && !wantedLayers.has(name))) return null;

  const features: MvtFeature[] = [];
  for (let f = 0; f < featureSlices.length; f++) {
    const [fStart, fEnd] = featureSlices[f];
    const fst = { p: fStart };
    let type = 0;
    const tags: number[] = [];
    const geomInts: number[] = [];

    while (fst.p < fEnd) {
      const tag = readVarint(b, fst);
      const fn = Math.floor(tag / 8);
      const wt = tag & 7;
      if (fn === 2 && wt === 2) {
        const len = readVarint(b, fst);
        const pEnd = fst.p + len;
        while (fst.p < pEnd) tags.push(readVarint(b, fst));
      } else if (fn === 3 && wt === 0) {
        type = readVarint(b, fst);
      } else if (fn === 4 && wt === 2) {
        const len = readVarint(b, fst);
        const pEnd = fst.p + len;
        while (fst.p < pEnd) geomInts.push(readVarint(b, fst));
      } else {
        skipField(b, fst, wt);
      }
    }

    const props: Record<string, string | number | boolean> = {};
    for (let i = 0; i + 1 < tags.length; i += 2) {
      const k = keys[tags[i]];
      const v = values[tags[i + 1]];
      if (k !== undefined && v !== undefined) props[k] = v;
    }

    const rings = decodeGeometryRings(geomInts);
    if (rings.length > 0) features.push({ type, props, rings });
  }

  return { name, extent, features };
}

/**
 * MVT(.pbf, 필요시 gzip 해제) 바이트 배열을 레이어 맵으로 디코드합니다.
 */
export function decodeMvtTile(
  rawBytes: Uint8Array,
  wantedLayers?: Set<string>,
): Record<string, MvtLayer> {
  const bytes =
    rawBytes.length >= 2 && rawBytes[0] === 0x1f && rawBytes[1] === 0x8b
      ? gunzipSync(rawBytes)
      : rawBytes;
  const st = { p: 0 };
  const layers: Record<string, MvtLayer> = {};
  while (st.p < bytes.length) {
    const tag = readVarint(bytes, st);
    const fn = Math.floor(tag / 8);
    const wt = tag & 7;
    if (fn === 3 && wt === 2) {
      const len = readVarint(bytes, st);
      const end = Math.min(bytes.length, st.p + len);
      const layer = parseLayer(bytes, st.p, end, wantedLayers);
      if (layer) layers[layer.name] = layer;
      st.p = end;
    } else {
      skipField(bytes, st, wt);
    }
  }
  return layers;
}

/** 2D Shoelace 부호 면적 (Y-down 타일 좌표 기준 양수 = 외곽선 CW) */
export function ringSignedArea(pts: MvtRingPoint[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

/** 폴리곤 피처의 외곽 링만 추립니다(중정/구멍 링 제외). */
export function extractOuterRings(rings: MvtRingPoint[][]): MvtRingPoint[][] {
  if (rings.length <= 1) return rings;
  const outers = rings.filter((r) => ringSignedArea(r) > 0);
  return outers.length > 0 ? outers : [rings[0]];
}

export function lonLatToTileXY(lat: number, lon: number, z: number): TileCoord {
  const n = 1 << z;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const x = Math.max(0, Math.min(n - 1, Math.floor(((lon + 180) / 360) * n)));
  const y = Math.max(
    0,
    Math.min(n - 1, Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)),
  );
  return { z, x, y };
}

export function tileListForRadius(lat: number, lon: number, radiusM: number, z: number): TileCoord[] {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const tl = lonLatToTileXY(lat + dLat, lon - dLon, z);
  const br = lonLatToTileXY(lat - dLat, lon + dLon, z);
  const out: TileCoord[] = [];
  for (let ty = tl.y; ty <= br.y; ty++) {
    for (let tx = tl.x; tx <= br.x; tx++) {
      out.push({ z, x: tx, y: ty });
    }
  }
  return out;
}

/** 타일 내부 좌표 (u, v ∈ [0, extent]) -> 위경도 변환 */
export function tilePointToLonLat(
  tx: number,
  ty: number,
  z: number,
  u: number,
  v: number,
  extent: number,
): { lat: number; lon: number } {
  const n = 1 << z;
  const lon = ((tx + u / extent) / n) * 360 - 180;
  const mercN = Math.PI - (2 * Math.PI * (ty + v / extent)) / n;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(mercN) - Math.exp(-mercN)));
  return { lat, lon };
}

async function getTileUrlTemplate(): Promise<string> {
  if (!cachedTemplatePromise) {
    cachedTemplatePromise = (async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 4500);
      try {
        const res = await fetch(PLANET_TILEJSON_URL, { signal: ctl.signal });
        if (!res.ok) return FALLBACK_TILE_TEMPLATE;
        const json = await res.json();
        const t = Array.isArray(json?.tiles) ? json.tiles[0] : null;
        return typeof t === 'string' && t.includes('{z}') ? t : FALLBACK_TILE_TEMPLATE;
      } catch {
        return FALLBACK_TILE_TEMPLATE;
      } finally {
        clearTimeout(timer);
      }
    })();
  }
  return cachedTemplatePromise;
}

/**
 * 바이너리 응답 바이트를 안전하게 수신합니다.
 * React Native에서는 whatwg-fetch(Blob -> FileReader.readAsDataURL) 경로 대신
 * XMLHttpRequest responseType='arraybuffer'를 직접 사용해 네이티브 base64 디코드 경로를 탑니다.
 */
async function fetchBinaryBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  if (signal.aborted) throw new Error('MVT aborted');
  const isReactNative =
    typeof navigator !== 'undefined' &&
    (navigator as { product?: string }).product === 'ReactNative';
  if (isReactNative && typeof XMLHttpRequest !== 'undefined') {
    return new Promise<Uint8Array>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let settled = false;
      const cleanup = () => signal.removeEventListener('abort', onAbort);
      const finish = (cb: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        cb();
      };
      const onAbort = () => {
        try { xhr.abort(); } catch { /* noop */ }
        finish(() => reject(new Error('MVT aborted')));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      xhr.open('GET', url, true);
      xhr.responseType = 'arraybuffer';
      xhr.timeout = TILE_TIMEOUT_MS;
      xhr.onload = () => {
        finish(() => {
          const buf = xhr.response as ArrayBuffer | null | undefined;
          if (xhr.status >= 200 && xhr.status < 300 && buf && typeof buf.byteLength === 'number') {
            resolve(new Uint8Array(buf));
          } else {
            reject(new Error(`MVT HTTP ${xhr.status || 0}`));
          }
        });
      };
      xhr.onerror = () => finish(() => reject(new Error('MVT XHR network error')));
      xhr.ontimeout = () => finish(() => reject(new Error('MVT XHR timeout')));
      xhr.send();
    });
  }

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`MVT HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * 단일 OpenFreeMap `.pbf` 타일을 가져옵니다(메모리 LRU 캐시, 실패 시 null 또는 throw).
 * `cache: false` 면 캐시에 **넣지 않습니다**(있으면 읽습니다). 먼 건물처럼 한 번에 수십 장을 받는 쪽이 24 장짜리 캐시에서
 * 가까운 건물·도시 마스크가 쓰는 타일을 밀어내지 않게.
 */
export async function fetchMvtTileRaw(
  tile: TileCoord,
  opts: { signal?: AbortSignal; cache?: boolean } = {},
): Promise<Uint8Array> {
  const key = `${tile.z}/${tile.x}/${tile.y}`;
  const hit = rawTileCache.get(key);
  if (hit) {
    rawTileCache.delete(key);
    rawTileCache.set(key, hit);
    return hit;
  }

  const tpl = await getTileUrlTemplate();
  const url = tpl
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y));

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TILE_TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const bytes = await fetchBinaryBytes(url, ctl.signal);
    if (opts.cache !== false) {
      rawTileCache.set(key, bytes);
      while (rawTileCache.size > RAW_CACHE_MAX) {
        const oldest = rawTileCache.keys().next().value;
        if (oldest !== undefined) rawTileCache.delete(oldest);
        else break;
      }
    }
    return bytes;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** 다각형 하나를 래스터 버퍼(`size×size`, 범위 `±halfM`)에 스캔라인 채움 */
function fillPolygonXZ(
  buf: Uint8Array,
  size: number,
  halfM: number,
  pts: { x: number; z: number }[],
  value: number,
): void {
  const n = pts.length;
  if (n < 3) return;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    if (pts[i].z < minZ) minZ = pts[i].z;
    if (pts[i].z > maxZ) maxZ = pts[i].z;
  }
  const scale = size / (2 * halfM);
  const row0 = Math.max(0, Math.floor((minZ + halfM) * scale));
  const row1 = Math.min(size - 1, Math.ceil((maxZ + halfM) * scale));
  const xs: number[] = [];

  for (let row = row0; row <= row1; row++) {
    const z = -halfM + ((row + 0.5) / size) * 2 * halfM;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const zi = pts[i].z;
      const zj = pts[j].z;
      if ((zi > z) !== (zj > z)) {
        const x = pts[i].x + ((z - zi) / (zj - zi)) * (pts[j].x - pts[i].x);
        xs.push(x);
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const col0 = Math.max(0, Math.floor((xs[k] + halfM) * scale));
      const col1 = Math.min(size - 1, Math.floor((xs[k + 1] + halfM) * scale));
      const base = row * size;
      for (let col = col0; col <= col1; col++) buf[base + col] = value;
    }
  }
}

const URBAN_LANDUSE = new Set([
  'residential', 'commercial', 'industrial', 'retail', 'railway',
  'construction', 'education', 'hospital', 'university', 'school',
  'military', 'harbour', 'port', 'garages', 'brownfield',
]);
const NATURAL_LANDUSE = new Set([
  'park', 'forest', 'grass', 'meadow', 'farmland', 'farmyard', 'orchard',
  'vineyard', 'cemetery', 'recreation_ground', 'village_green', 'allotments',
  'reservoir', 'basin', 'conservation', 'nature_reserve', 'wetland',
]);
const NATURAL_LANDCOVER = new Set([
  'wood', 'forest', 'grass', 'wetland', 'sand', 'glacier', 'farmland',
]);

export interface UrbanMaskResult {
  size: number;
  halfM: number;
  /** 0=자연/비도시, 255=도시·거주지 포장 지반 (행=+Z 남쪽, 열=+X 동쪽) */
  data: Uint8Array;
  /**
   * 2026-11-18 포장 지도(관측자 둘레 ±paveHalfM, paveSize²) — 칸마다 [시멘트, 아스팔트] 0~255 두 바이트(행=+Z 남쪽, 열=+X 동쪽).
   * 시멘트 = 건물 둘레 PAVE_BUILDING_APRON_M + 도로 가장자리(인도), 아스팔트 = 도로 폭(종류별 ROAD_WIDTH_M). 없으면 undefined.
   */
  pave?: { size: number; halfM: number; data: Uint8Array; lamp?: Uint8Array };
  /** 2026-11-18 큰 도로 가로등 자리(동 x, 남 z, m) 쌍. 관측자 둘레 ±PAVE_HALF_M. */
  lamps?: Float32Array;
  /** 건물 덮개(0/255, 관측자 둘레 ±halfM, 512칸 ≈ 12.5 m). 고도의 건물 높이 깎기(demBuildingFlatten.ts)에 씁니다. */
  bld?: { size: number; halfM: number; data: Uint8Array };
  /**
   * 2026-11-19 건물 발자국 바깥 고리(동 x, 남 z, m 쌍을 이어 붙인 것, 닫는 점 없음). 관측자 둘레 ±FOOTPRINT_MAX_M 안, 너무 작은 것은 뺌.
   * 건물마다 바닥을 한 높이로 맞추는 데 씁니다(demBuildingFlatten.flattenFootprints).
   */
  footprints?: Float32Array[];
  /** 물(바다·호수·강, 0/255, 관측자 둘레 ±halfM, size²). 해발 0m 매립지/인공섬과 내륙 수면을 가르는 데 씁니다. */
  water?: Uint8Array;
  /** 고해상도 물 마스크(0~255, ±paveHalfM, paveSize²). 지형 위 호수·하천·운하 경계에 씁니다. */
  waterHi?: { size: number; halfM: number; data: Uint8Array };
  /**
   * 받지 못한 타일 수. 타일 하나가 늦거나 실패해도 나머지로 마스크를 만들기 때문에(전부 실패해야 null), 0 보다 크면 그 타일 자리의
   * 물·건물·도로가 빠진 **일부 마스크**입니다. 서 있을 자리 찾기가 "강·호수를 거르지 못했다"고 알리는 데 씁니다(2026-11-19).
   */
  failedTiles?: number;
}

/** 도로 종류(OpenMapTiles transportation class) → 차로 폭(m). 없는 종류(path·track·rail 등)는 그리지 않음. */
export const ROAD_WIDTH_M: Record<string, number> = {
  motorway: 24, trunk: 20, primary: 16, secondary: 12, tertiary: 10, minor: 7, service: 5,
};
/** 도로 양옆 인도·갓길(시멘트) 폭(m) */
export const ROAD_SIDEWALK_M = 4;
/** 건물 둘레 시멘트 마당 폭(m) */
export const PAVE_BUILDING_APRON_M = 12;
export const PAVE_HALF_M = 1600;
export const PAVE_SIZE = 1024;
/** 가로등을 세우는 큰 도로 종류. */
export const LAMP_ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary']);
/** 가로등 간격(m, 한쪽 기준). 넓은 도로(폭 16 m 이상)는 양쪽에, 좁은 도로는 지그재그로. */
export const LAMP_SPACING_M = 34;
/** 빛 웅덩이 반지름(m) — 가로등 높이 9 m 안팎의 바닥 조도 퍼짐. */
export const LAMP_POOL_R_M = 13;
export const LAMP_MAX = 9000;
/** 건물 덮개 격자 한 변 칸 수(±3200 m 에서 12.5 m 칸). */
export const BLD_COVER_SIZE = 512;
/** 발자국을 모으는 범위(m, 관측자 둘레) — 고도 패치가 덮는 안쪽만 있으면 됩니다. */
export const FOOTPRINT_MAX_M = 1700;
/** 이보다 작은 발자국(m², 대략)은 모으지 않습니다 — 창고 문짝·정자 같은 것. */
export const FOOTPRINT_MIN_AREA_M2 = 12;

/** 선분 둘레 반지름 r(m) 안의 칸을 value 로(최댓값). buf 는 stride 2 의 채널 ch. */
function stampSegment(buf: Uint8Array, size: number, halfM: number, ch: number,
  a: { x: number; z: number }, b: { x: number; z: number }, rM: number, value: number): void {
  const scale = size / (2 * halfM);
  const ax = (a.x + halfM) * scale, az = (a.z + halfM) * scale, bx = (b.x + halfM) * scale, bz = (b.z + halfM) * scale;
  const r = rM * scale;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1)), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx) + r + 1));
  const z0 = Math.max(0, Math.floor(Math.min(az, bz) - r - 1)), z1 = Math.min(size - 1, Math.ceil(Math.max(az, bz) + r + 1));
  if (x0 > x1 || z0 > z1) return;
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  for (let zz = z0; zz <= z1; zz++) {
    const pz = zz + 0.5;
    for (let xx = x0; xx <= x1; xx++) {
      const px = xx + 0.5;
      let t = L2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px - (ax + t * dx), ez = pz - (az + t * dz);
      const d = Math.sqrt(ex * ex + ez * ez);
      // 가장자리 1칸은 부드럽게(안티에일리어싱)
      const cov = d <= r - 0.5 ? 1 : d >= r + 0.5 ? 0 : r + 0.5 - d;
      if (cov <= 0) continue;
      const o = (zz * size + xx) * 2 + ch, v = Math.round(value * cov);
      if (v > buf[o]) buf[o] = v;
    }
  }
}

function stampSegmentMono(buf: Uint8Array, size: number, halfM: number,
  a: { x: number; z: number }, b: { x: number; z: number }, rM: number, value: number): void {
  const scale = size / (2 * halfM);
  const ax = (a.x + halfM) * scale, az = (a.z + halfM) * scale, bx = (b.x + halfM) * scale, bz = (b.z + halfM) * scale;
  const r = rM * scale;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1)), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx) + r + 1));
  const z0 = Math.max(0, Math.floor(Math.min(az, bz) - r - 1)), z1 = Math.min(size - 1, Math.ceil(Math.max(az, bz) + r + 1));
  if (x0 > x1 || z0 > z1) return;
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  for (let zz = z0; zz <= z1; zz++) {
    const pz = zz + 0.5;
    for (let xx = x0; xx <= x1; xx++) {
      const px = xx + 0.5;
      let t = L2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px - (ax + t * dx), ez = pz - (az + t * dz);
      const d = Math.sqrt(ex * ex + ez * ez);
      const cov = d <= r - 0.5 ? 1 : d >= r + 0.5 ? 0 : r + 0.5 - d;
      if (cov <= 0) continue;
      const o = zz * size + xx, v = Math.round(value * cov);
      if (v > buf[o]) buf[o] = v;
    }
  }
}

const URBAN_LAYERS = new Set(['landuse', 'landcover', 'park', 'building', 'transportation', 'water', 'waterway', 'aeroway']);

/**
 * 관측자 반경 `halfM`(기본 3200m) 내 OpenFreeMap z=13 타일의 토지이용/건물 분포를 래스터화해
 * 시가지(회색 콘크리트/아스팔트)와 자연 녹지·산지를 구분하는 256×256 마스크를 생성합니다.
 */
export async function fetchUrbanMask(
  lat: number,
  lon: number,
  opts: { halfM?: number; size?: number; signal?: AbortSignal } = {},
): Promise<UrbanMaskResult | null> {
  const halfM = opts.halfM ?? 3200;
  const size = opts.size ?? 256;
  const z = 13;
  const tiles = tileListForRadius(lat, lon, halfM, z);
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180));

  const decoded = await Promise.all(
    tiles.map(async (tc) => {
      try {
        const raw = await fetchMvtTileRaw(tc, { signal: opts.signal });
        return { tc, layers: decodeMvtTile(raw, URBAN_LAYERS) };
      } catch {
        return null;
      }
    }),
  );
  if (opts.signal?.aborted) return null;
  const okTiles = decoded.filter((t): t is NonNullable<typeof t> => t !== null);
  if (okTiles.length === 0) return null;

  const grid = new Uint8Array(size * size);
  const bldCover = new Uint8Array(BLD_COVER_SIZE * BLD_COVER_SIZE);
  const footprints: Float32Array[] = [];
  const toLocal = (tc: TileCoord, u: number, v: number, ext: number) => {
    const ll = tilePointToLonLat(tc.x, tc.y, tc.z, u, v, ext);
    return {
      x: (ll.lon - lon) * mPerDegLon,
      z: -(ll.lat - lat) * mPerDegLat,
    };
  };

  for (const { tc, layers } of okTiles) {
    // 1) 도시 토지이용(주거·상업·공업 등) 채우기
    const lu = layers.landuse;
    if (lu) {
      for (const f of lu.features) {
        if (f.type !== 3) continue;
        const cls = String(f.props.class ?? '').toLowerCase();
        if (!URBAN_LANDUSE.has(cls)) continue;
        for (const r of extractOuterRings(f.rings)) {
          fillPolygonXZ(grid, size, halfM, r.map((p) => toLocal(tc, p.x, p.y, lu.extent)), 235);
        }
      }
    }

    // 2) 공원·산림·녹지 덮어 비우기 (도시 내부 남산/공원 보존)
    const lc = layers.landcover;
    if (lc) {
      for (const f of lc.features) {
        if (f.type !== 3) continue;
        const cls = String(f.props.class ?? '').toLowerCase();
        if (!NATURAL_LANDCOVER.has(cls)) continue;
        for (const r of extractOuterRings(f.rings)) {
          fillPolygonXZ(grid, size, halfM, r.map((p) => toLocal(tc, p.x, p.y, lc.extent)), 0);
        }
      }
    }
    if (lu) {
      for (const f of lu.features) {
        if (f.type !== 3) continue;
        const cls = String(f.props.class ?? '').toLowerCase();
        if (!NATURAL_LANDUSE.has(cls)) continue;
        for (const r of extractOuterRings(f.rings)) {
          fillPolygonXZ(grid, size, halfM, r.map((p) => toLocal(tc, p.x, p.y, lu.extent)), 0);
        }
      }
    }
    const pk = layers.park;
    if (pk) {
      for (const f of pk.features) {
        if (f.type !== 3) continue;
        for (const r of extractOuterRings(f.rings)) {
          fillPolygonXZ(grid, size, halfM, r.map((p) => toLocal(tc, p.x, p.y, pk.extent)), 0);
        }
      }
    }

    // 3) 건물 footprint 위는 항상 도시 바닥
    const bld = layers.building;
    if (bld) {
      for (const f of bld.features) {
        if (f.type !== 3) continue;
        for (const r of extractOuterRings(f.rings)) {
          const pts = r.map((p) => toLocal(tc, p.x, p.y, bld.extent));
          fillPolygonXZ(grid, size, halfM, pts, 255);
          fillPolygonXZ(bldCover, BLD_COVER_SIZE, halfM, pts, 255);
          if (pts.length >= 3) {
            let sx = 0, sz = 0, area2 = 0;
            for (let k = 0; k < pts.length; k++) {
              const a = pts[k], b = pts[(k + 1) % pts.length];
              sx += a.x; sz += a.z;
              area2 += a.x * b.z - b.x * a.z;
            }
            const cx = sx / pts.length, cz = sz / pts.length;
            if (Math.abs(area2) / 2 >= FOOTPRINT_MIN_AREA_M2 && Math.abs(cx) <= FOOTPRINT_MAX_M && Math.abs(cz) <= FOOTPRINT_MAX_M) {
              const fp = new Float32Array(pts.length * 2);
              for (let k = 0; k < pts.length; k++) { fp[2 * k] = pts[k].x; fp[2 * k + 1] = pts[k].z; }
              footprints.push(fp);
            }
          }
        }
      }
    }
  }

  // 2026-11-18 포장 지도: 건물 둘레 시멘트 + 도로(가장자리 시멘트, 가운데 아스팔트). 흙이 보이지 않고 도로 느낌이 나게(사용자 제안).
  const pSize = PAVE_SIZE, pHalf = PAVE_HALF_M;
  const pave = new Uint8Array(pSize * pSize * 2);
  const lampPool = new Uint8Array(pSize * pSize);
  const lampXZ: number[] = [];
  {
    const bGrid = new Uint8Array(pSize * pSize);
    for (const { tc, layers } of okTiles) {
      const bld = layers.building;
      if (bld) {
        for (const f of bld.features) {
          if (f.type !== 3) continue;
          for (const r of extractOuterRings(f.rings)) fillPolygonXZ(bGrid, pSize, pHalf, r.map((p) => toLocal(tc, p.x, p.y, bld.extent)), 255);
        }
      }
    }
    // 건물 둘레 마당: 원판 팽창(분리 가능한 최댓값 두 번 = 정사각형이라, 거리장으로 원판). 반지름 PAVE_BUILDING_APRON_M.
    const rA = PAVE_BUILDING_APRON_M * pSize / (2 * pHalf);
    const R = Math.ceil(rA);
    const offs: [number, number, number][] = [];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= rA + 0.5) offs.push([dx, dy, d <= rA - 0.5 ? 255 : Math.round(255 * (rA + 0.5 - d))]);
    }
    for (let y = 0; y < pSize; y++) for (let x = 0; x < pSize; x++) {
      if (bGrid[y * pSize + x] < 128) continue;
      for (const [dx, dy, v] of offs) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= pSize || yy >= pSize) continue;
        const o = (yy * pSize + xx) * 2;
        if (v > pave[o]) pave[o] = v;
      }
    }
    for (const { tc, layers } of okTiles) {
      const tr = layers.transportation;
      if (!tr) continue;
      for (const f of tr.features) {
        if (f.type !== 2) continue;
        const cls = String(f.props.class ?? '').toLowerCase();
        const w = ROAD_WIDTH_M[cls];
        if (!w) continue;
        if (String(f.props.brunnel ?? '') === 'tunnel') continue;
        const lit = LAMP_ROAD_CLASSES.has(cls);
        for (const line of f.rings) {
          const pts = line.map((p) => toLocal(tc, p.x, p.y, tr.extent));
          let carry = 0;   // 앞 마디에서 남은 거리 — 마디가 짧아도 간격이 이어지게
          let side = 1;
          for (let i = 1; i < pts.length; i++) {
            stampSegment(pave, pSize, pHalf, 0, pts[i - 1], pts[i], w / 2 + ROAD_SIDEWALK_M, 255);
            stampSegment(pave, pSize, pHalf, 1, pts[i - 1], pts[i], w / 2, 255);
            if (!lit) continue;
            // 2026-11-18 가로등(사용자 제안): 큰 도로 가장자리(차도 끝 안쪽 0.5 m)에 LAMP_SPACING_M 간격.
            //   지도 도로 폭(ROAD_WIDTH_M)이 실제보다 좁을 때가 많아 차도 바깥에 두면 건물 안에 서서 벽에 가려졌음.
            const a = pts[i - 1], b = pts[i];
            const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
            if (len < 1e-3) continue;
            const nx = -dz / len, nz = dx / len, off = Math.max(1, w / 2 - 0.5);
            for (let t = LAMP_SPACING_M - carry; t <= len; t += LAMP_SPACING_M) {
              const cx = a.x + (dx * t) / len, cz = a.z + (dz * t) / len;
              const put = (sgn: number) => {
                const x = cx + nx * off * sgn, z = cz + nz * off * sgn;
                if (Math.abs(x) < pHalf && Math.abs(z) < pHalf && lampXZ.length < LAMP_MAX * 2) lampXZ.push(x, z);
              };
              if (w >= 16) { put(1); put(-1); } else { put(side); side = -side; }
            }
            carry = (carry + len) % LAMP_SPACING_M;
          }
        }
      }
    }
    // 빛 웅덩이: 가로등마다 반지름 LAMP_POOL_R_M 의 둥근 감쇠(가운데 255), 겹치면 최댓값.
    {
      const sc = pSize / (2 * pHalf);
      const rPx = LAMP_POOL_R_M * sc, R = Math.ceil(rPx);
      for (let k = 0; k < lampXZ.length; k += 2) {
        const cx = (lampXZ[k] + pHalf) * sc, cy = (lampXZ[k + 1] + pHalf) * sc;
        const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(pSize - 1, Math.ceil(cx + R));
        const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(pSize - 1, Math.ceil(cy + R));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / rPx;
          if (d >= 1) continue;
          const v = Math.round(255 * (1 - d * d) * (1 - d * d));
          const o = y * pSize + x;
          if (v > lampPool[o]) lampPool[o] = v;
        }
      }
    }
  }

  // 물(바다·호수·강·하천) + 공항(활주로/계류장) 래스터화 — 해발 0m 매립지 침수 방지 및 내륙 호수·하천 표현
  const waterGrid = new Uint8Array(size * size);
  const waterHi = new Uint8Array(pSize * pSize);
  const WATERWAY_HALF_M: Record<string, number> = {
    river: 18, canal: 10, stream: 3.5, drain: 2.2, ditch: 2.0,
  };
  for (const { tc, layers } of okTiles) {
    const wt = layers.water;
    if (wt) {
      for (const f of wt.features) {
        if (f.type !== 3) continue;
        for (const r of extractOuterRings(f.rings)) {
          const pts = r.map((p) => toLocal(tc, p.x, p.y, wt.extent));
          fillPolygonXZ(waterGrid, size, halfM, pts, 255);
          fillPolygonXZ(waterHi, pSize, pHalf, pts, 255);
        }
      }
    }
    const ww = layers.waterway;
    if (ww) {
      for (const f of ww.features) {
        if (f.type !== 2) continue;
        const br = String(f.props.brunnel ?? '');
        if (br === 'tunnel' || br === 'culvert') continue;
        const cls = String(f.props.class ?? '').toLowerCase();
        const rM = WATERWAY_HALF_M[cls] ?? 4;
        for (const line of f.rings) {
          const pts = line.map((p) => toLocal(tc, p.x, p.y, ww.extent));
          for (let i = 1; i < pts.length; i++) {
            stampSegmentMono(waterHi, pSize, pHalf, pts[i - 1], pts[i], rM, 255);
            stampSegmentMono(waterGrid, size, halfM, pts[i - 1], pts[i], Math.max(rM, 14), 255);
          }
        }
      }
    }
    const aero = layers.aeroway;
    if (aero) {
      for (const f of aero.features) {
        const cls = String(f.props.class ?? '').toLowerCase();
        const isRunway = cls === 'runway';
        if (f.type === 3) {
          for (const r of extractOuterRings(f.rings)) {
            const pts = r.map((p) => toLocal(tc, p.x, p.y, aero.extent));
            fillPolygonXZ(grid, size, halfM, pts, 235);
            fillPolygonXZ(waterGrid, size, halfM, pts, 0);
            fillPolygonXZ(waterHi, pSize, pHalf, pts, 0);
            if (isRunway || cls === 'taxiway' || cls === 'apron') {
              const ch = isRunway ? 1 : 0;
              const tmp = new Uint8Array(pSize * pSize);
              fillPolygonXZ(tmp, pSize, pHalf, pts, 255);
              for (let i = 0; i < pSize * pSize; i++) {
                if (tmp[i] > pave[i * 2 + ch]) pave[i * 2 + ch] = tmp[i];
              }
            }
          }
        } else if (f.type === 2) {
          const rM = isRunway ? 22.5 : cls === 'taxiway' ? 9 : 0;
          if (rM > 0) {
            const ch = isRunway ? 1 : 0;
            for (const line of f.rings) {
              const pts = line.map((p) => toLocal(tc, p.x, p.y, aero.extent));
              for (let i = 1; i < pts.length; i++) {
                stampSegment(pave, pSize, pHalf, ch, pts[i - 1], pts[i], rM, 255);
                stampSegmentMono(waterHi, pSize, pHalf, pts[i - 1], pts[i], rM, 0);
              }
            }
          }
        }
      }
    }
  }

  // 경계 부드럽게 (3×3 가벼운 블러 1회 — 약 25m 전환)
  const smooth = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0;
      let w = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.max(0, Math.min(size - 1, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.max(0, Math.min(size - 1, x + dx));
          const wt = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
          acc += grid[yy * size + xx] * wt;
          w += wt;
        }
      }
      smooth[y * size + x] = Math.round(acc / w);
    }
  }

  return {
    size,
    halfM,
    data: smooth,
    pave: { size: pSize, halfM: pHalf, data: pave, lamp: lampPool }, lamps: Float32Array.from(lampXZ),
    bld: { size: BLD_COVER_SIZE, halfM, data: bldCover },
    footprints,
    water: waterGrid,
    waterHi: { size: pSize, halfM: pHalf, data: waterHi },
    failedTiles: tiles.length - okTiles.length,
  };
}
