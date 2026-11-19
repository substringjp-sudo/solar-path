/**
 * buildingTiles.ts — 관측자 반경 1 km 이내 건물 폴리곤 조회 · 공통 높이 추정 · 단일 병합 기하 생성.
 *
 * - 1차 소스: OpenFreeMap(OpenMapTiles) z=14 MVT 벡터 타일(`mvtTiles.ts`, CDN 고속 응답 · `render_height`/`render_min_height`).
 * - 예비 소스: OpenFreeMap 실패 시 Overpass API (`way`/`relation` building) 폴백.
 * - 외부 라이브러리 없이 순수 Ear-clipping 삼각분할과 벽면/옥상 정점 병합을 수행합니다.
 * - 각 정점은 `(eastM, southM, heightOffsetM)` 와 건물 중심 지반 좌표 `aGroundPos(centerE, centerS)` 를 가져
 *   경사지에서도 옥상이 수평을 유지하고 지형 DEM 위에 정확히 안착합니다.
 */
import * as THREE from 'three';
import {
  decodeMvtTile,
  extractOuterRings,
  fetchMvtTileRaw,
  MAX_RENDER_HEIGHT_M,
  ringSignedArea,
  tileListForRadius,
  tilePointToLonLat,
} from './mvtTiles';
import { createPickIndexBuilder, type BuildingPickIndex } from './buildingPick';

export const BUILDING_RADIUS_M = 1000;
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const CACHE_MAX = 12;
const WALL_SUBDIV_M = 18;
export const SKIRT_DEPTH_M = 5.0;
/** 외벽 창문 칸 간격 (층고·열 피치 3.2m; 내부 실제 유리창은 약 1.6m × 1.4m) */
export const WINDOW_CELL_M = 3.2;

export interface OsmBuildingPoint {
  lat: number;
  lon: number;
}

export interface OsmBuildingElement {
  id?: number;
  tags?: Record<string, string | undefined>;
  geometry?: OsmBuildingPoint[];
}

export interface BuildingMeshData {
  /** 건물마다 발자국 고리·지붕 높이·벽 아랫단을 적은 고르기용 색인(`utils/buildingPick.ts`). 기하와 같은 반복문에서 만들어 건물 수가 같습니다. */
  pick?: BuildingPickIndex;
  /** (eastM, heightOffsetM, southM) — THREE.BufferGeometry position 규약용으로 (eastM, heightOffsetM, southM) 배치 */
  positions: Float32Array;
  normals: Float32Array;
  /** 각 정점이 속한 건물의 지반 중심 (centerEastM, centerSouthM) */
  groundPos: Float32Array;
  /** 외벽 창문 격자 좌표 (wallU, wallV, cols, rows) — 지붕은 (-1, -1, 0, 0) */
  wallCoords: Float32Array;
  buildingCount: number;
  vertexCount: number;
}

const DEFAULT_HEIGHT_BY_TYPE: Record<string, number> = {
  apartments: 24,
  residential: 18,
  dormitory: 18,
  hotel: 24,
  office: 18,
  commercial: 15,
  hospital: 20,
  university: 15,
  school: 12,
  public: 12,
  civic: 12,
  government: 15,
  tower: 40,
  industrial: 10,
  warehouse: 10,
  retail: 8,
  supermarket: 8,
  church: 14,
  cathedral: 22,
  temple: 11,
  shrine: 8,
  house: 6.5,
  detached: 6.5,
  semidetached_house: 6.5,
  terrace: 7.5,
  bungalow: 5,
  farm: 6,
  cabin: 4.5,
  hut: 4,
  garage: 3.2,
  garages: 3.2,
  carport: 3.0,
  shed: 3.0,
  greenhouse: 3.5,
  kiosk: 3.2,
  roof: 4.5,
  train_station: 12,
  transportation: 10,
  stadium: 20,
};

function parseLengthM(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(',', '.');
  const m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*(m|meter|meters|ft|feet|')?$/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (!Number.isFinite(val) || val <= 0) return null;
  const meters = m[2] === 'ft' || m[2] === 'feet' || m[2] === "'" ? val * 0.3048 : val;
  return Math.min(MAX_RENDER_HEIGHT_M, Math.max(2, meters));
}

/**
 * OSM 태그(`height` → `building:levels` → `building=*` 분류 기본값)로 건물 높이(m) 추정.
 */
export function estimateBuildingHeightM(tags?: Record<string, string | undefined>): number {
  if (!tags) return 9;
  const explicit = parseLengthM(tags.height) ?? parseLengthM(tags['building:height']);
  if (explicit != null) return explicit;

  const levelsRaw = tags['building:levels'] ?? tags.levels;
  if (levelsRaw) {
    const lv = parseFloat(levelsRaw.trim());
    if (Number.isFinite(lv) && lv > 0) {
      const roofLv = parseFloat((tags['roof:levels'] ?? '0').trim());
      const extraRoof = Number.isFinite(roofLv) && roofLv > 0 ? roofLv * 2.2 : 0;
      return Math.min(350, Math.max(3.5, lv * 3.2 + extraRoof));
    }
  }

  const kind = (tags.building ?? 'yes').trim().toLowerCase();
  return DEFAULT_HEIGHT_BY_TYPE[kind] ?? 9;
}

export function estimateBuildingMinHeightM(tags?: Record<string, string | undefined>): number {
  if (!tags) return 0;
  const minH = parseLengthM(tags.min_height) ?? parseLengthM(tags['building:min_height']);
  if (minH != null) return minH;
  const minLvRaw = tags['building:min_level'];
  if (minLvRaw) {
    const lv = parseFloat(minLvRaw.trim());
    if (Number.isFinite(lv) && lv > 0) return Math.min(200, lv * 3.2);
  }
  return 0;
}

/** 2D 다각형 부호 면적 (양수 = (x=동, z=남) 평면 기준 반시계 방향) */
function signedAreaXZ(pts: { x: number; z: number }[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a * 0.5;
}

function pointInTriXZ(
  px: number, pz: number,
  ax: number, az: number, bx: number, bz: number, cx: number, cz: number,
): boolean {
  const c1 = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
  const c2 = (cx - bx) * (pz - bz) - (cz - bz) * (px - bx);
  const c3 = (ax - cx) * (pz - cz) - (az - cz) * (px - cx);
  return (c1 >= -1e-7 && c2 >= -1e-7 && c3 >= -1e-7) || (c1 <= 1e-7 && c2 <= 1e-7 && c3 <= 1e-7);
}

/**
 * 단순 다각형(오목 포함) Ear-clipping 삼각분할. `pts` 는 중복 끝점이 제거된 정점 목록.
 */
export function triangulatePolygonXZ(pts: { x: number; z: number }[]): number[] {
  const n = pts.length;
  if (n < 3) return [];
  if (n === 3) return [0, 1, 2];

  const ccw = signedAreaXZ(pts) >= 0;
  const idx = ccw ? Array.from({ length: n }, (_, i) => i) : Array.from({ length: n }, (_, i) => n - 1 - i);
  const tris: number[] = [];
  let guard = n * n;

  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    const m = idx.length;
    for (let k = 0; k < m; k++) {
      const iPrev = idx[(k - 1 + m) % m];
      const iCur = idx[k];
      const iNext = idx[(k + 1) % m];
      const a = pts[iPrev], b = pts[iCur], c = pts[iNext];
      const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
      if (cross <= 1e-8) continue;

      let inside = false;
      for (let t = 0; t < m; t++) {
        const vi = idx[t];
        if (vi === iPrev || vi === iCur || vi === iNext) continue;
        const p = pts[vi];
        if (pointInTriXZ(p.x, p.z, a.x, a.z, b.x, b.z, c.x, c.z)) { inside = true; break; }
      }
      if (inside) continue;

      tris.push(iPrev, iCur, iNext);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
  return tris;
}

/** 긴 외벽 변을 일정 간격으로 나눠 투영 반경(ringRadius) 곡률 왜곡을 줄입니다. */
function subdivideFootprintXZ(pts: { x: number; z: number }[], maxSegM = WALL_SUBDIV_M): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = len > maxSegM ? Math.min(8, Math.ceil(len / maxSegM)) : 1;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

/**
 * OSM 건물 목록을 단일 병합 버퍼(`BuildingMeshData`)로 변환합니다.
 */
export function buildMergedBuildingGeometry(
  elements: OsmBuildingElement[],
  centerLat: number,
  centerLon: number,
  maxRadiusM = BUILDING_RADIUS_M,
): BuildingMeshData | null {
  const mPerDegLat = 110574.0;
  const mPerDegLon = 111320.0 * Math.cos((centerLat * Math.PI) / 180);
  const maxR2 = maxRadiusM * maxRadiusM;

  const posOut: number[] = [];
  const normOut: number[] = [];
  const gndOut: number[] = [];
  const winOut: number[] = [];
  const pickBuilder = createPickIndexBuilder();
  let buildingCount = 0;

  const pushTri = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number,
    gx: number, gz: number,
    ua: number, va: number,
    ub: number, vb: number,
    uc: number, vc: number,
    cols: number, rows: number,
  ) => {
    posOut.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    normOut.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    gndOut.push(gx, gz, gx, gz, gx, gz);
    winOut.push(ua, va, cols, rows, ub, vb, cols, rows, uc, vc, cols, rows);
  };

  for (const el of elements) {
    const geom = el.geometry;
    if (!geom || geom.length < 3) continue;

    // 1. 위경도 -> (동 x, 남 z) 미터 + 중복 종점/너무 가까운 점 제거
    const rawPts: { x: number; z: number }[] = [];
    for (let i = 0; i < geom.length; i++) {
      const p = geom[i];
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
      const x = (p.lon - centerLon) * mPerDegLon;
      const z = -(p.lat - centerLat) * mPerDegLat; // +x=동, +z=남
      if (rawPts.length > 0) {
        const prev = rawPts[rawPts.length - 1];
        if (Math.hypot(x - prev.x, z - prev.z) < 0.4) continue;
      }
      rawPts.push({ x, z });
    }
    if (rawPts.length >= 3) {
      const first = rawPts[0], last = rawPts[rawPts.length - 1];
      if (Math.hypot(last.x - first.x, last.z - first.z) < 0.4) rawPts.pop();
    }
    if (rawPts.length < 3) continue;

    // 2. 건물 무게중심 & 반경/관측점 바로 위(내부 2m 안쪽) 제외 검사
    let cx = 0, cz = 0;
    for (const p of rawPts) { cx += p.x; cz += p.z; }
    cx /= rawPts.length;
    cz /= rawPts.length;
    if (cx * cx + cz * cz > maxR2) continue;
    // 자기 바로 발밑(< 3m) 또는 관측점을 둘러싼 건물 내부 가림 방지
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of rawPts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    if (cx * cx + cz * cz < 9 || (minX <= 2.5 && maxX >= -2.5 && minZ <= 2.5 && maxZ >= -2.5)) continue;

    const topH = estimateBuildingHeightM(el.tags);
    const minH = estimateBuildingMinHeightM(el.tags);
    if (topH <= minH + 0.5) continue;
    const baseH = minH > 0.2 ? minH : -SKIRT_DEPTH_M;

    const ccw = signedAreaXZ(rawPts) >= 0;
    const oriented = ccw ? rawPts : [...rawPts].reverse();
    const ring = subdivideFootprintXZ(oriented);
    const roofTris = triangulatePolygonXZ(oriented);
    if (roofTris.length < 3) continue;

    // 3. 지붕 (삼각분할, 법선 +Y) — (x=동, y=지반대비높이, z=남)
    // (x=동, z=남) 평면 위쪽(-Y 시계/반시계 방향)에서 +Y 위를 보도록 와인딩 정렬
    for (let t = 0; t < roofTris.length; t += 3) {
      const a = oriented[roofTris[t]];
      const b = oriented[roofTris[t + 1]];
      const c = oriented[roofTris[t + 2]];
      pushTri(a.x, topH, a.z, c.x, topH, c.z, b.x, topH, b.z, 0, 1, 0, cx, cz, -1, -1, -1, -1, -1, -1, 0, 0);
    }

    // 4. 외벽 쿼드 (ring 은 +x=동, +z=남 기준 반시계이므로 바깥 법선은 (+dz, 0, -dx))
    let wallPerimM = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const eLen = Math.hypot(b.x - a.x, b.z - a.z);
      if (eLen >= 0.2) wallPerimM += eLen;
    }
    const winBaseH = minH > 0.2 ? minH : 0;
    const winCols = Math.floor(wallPerimM / WINDOW_CELL_M);
    const winRows = Math.floor(Math.max(0, topH - winBaseH) / WINDOW_CELL_M);
    const vBot = baseH - winBaseH;
    const vTop = topH - winBaseH;
    let uAcc = 0;

    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const ex = b.x - a.x, ez = b.z - a.z;
      const eLen = Math.hypot(ex, ez);
      if (eLen < 0.2) continue;
      const nx = ez / eLen, nz = -ex / eLen;
      const u0 = uAcc;
      const u1 = uAcc + eLen;
      uAcc = u1;
      pushTri(a.x, baseH, a.z, a.x, topH, a.z, b.x, topH, b.z, nx, 0, nz, cx, cz, u0, vBot, u0, vTop, u1, vTop, winCols, winRows);
      pushTri(a.x, baseH, a.z, b.x, topH, b.z, b.x, baseH, b.z, nx, 0, nz, cx, cz, u0, vBot, u1, vTop, u1, vBot, winCols, winRows);
    }
    pickBuilder.add(cx, cz, topH, baseH, oriented);
    buildingCount++;
  }

  if (buildingCount === 0 || posOut.length === 0) return null;
  return {
    pick: pickBuilder.finish(),
    positions: new Float32Array(posOut),
    normals: new Float32Array(normOut),
    groundPos: new Float32Array(gndOut),
    wallCoords: new Float32Array(winOut),
    buildingCount,
    vertexCount: posOut.length / 3,
  };
}

/** `BuildingMeshData` -> Three.js `BufferGeometry` 래퍼 */
export function createBuildingThreeGeometry(data: BuildingMeshData): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geo.setAttribute('aGroundPos', new THREE.BufferAttribute(data.groundPos, 2));
  geo.setAttribute('aWallCoord', new THREE.BufferAttribute(data.wallCoords, 4));
  return geo;
}

const buildingCache = new Map<string, BuildingMeshData | null>();
function cacheKey(lat: number, lon: number, radiusM: number): string {
  return `${lat.toFixed(3)}|${lon.toFixed(3)}|${Math.round(radiusM)}`;
}

const BUILDING_MVT_LAYERS = new Set(['building']);

function ringCenterTile(ring: { x: number; y: number }[]): { cx: number; cy: number } {
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < ring.length; i++) {
    sx += ring[i].x;
    sy += ring[i].y;
  }
  return { cx: sx / ring.length, cy: sy / ring.length };
}

async function fetchBuildingsFromMvt(
  lat: number,
  lon: number,
  radiusM: number,
  signal: AbortSignal,
): Promise<OsmBuildingElement[]> {
  const tiles = tileListForRadius(lat, lon, radiusM, 14);
  const results = await Promise.all(
    tiles.map(async (tc) => {
      try {
        const raw = await fetchMvtTileRaw(tc, { signal });
        const layers = decodeMvtTile(raw, BUILDING_MVT_LAYERS);
        return { tc, bld: layers.building ?? null };
      } catch {
        return null;
      }
    }),
  );
  const okTiles = results.filter((r): r is NonNullable<typeof r> => r !== null);
  if (okTiles.length === 0) throw new Error('MVT building tiles unavailable');

  const elements: OsmBuildingElement[] = [];
  for (const { tc, bld } of okTiles) {
    if (!bld) continue;
    for (const f of bld.features) {
      if (f.type !== 3) continue;
      const rawH = typeof f.props.render_height === 'number' ? f.props.render_height : 9;
      const h = Math.max(3.5, Math.min(MAX_RENDER_HEIGHT_M, rawH));
      const minH = typeof f.props.render_min_height === 'number' ? Math.max(0, f.props.render_min_height) : 0;
      for (const ring of extractOuterRings(f.rings)) {
        if (ring.length < 3 || Math.abs(ringSignedArea(ring)) < 1) continue;
        // 타일 버퍼 영역에 걸친 중복 폴리곤은 중심이 속한 타일 1곳에서만 생성
        const { cx, cy } = ringCenterTile(ring);
        if (cx < 0 || cx >= bld.extent || cy < 0 || cy >= bld.extent) continue;
        elements.push({
          tags: minH > 0.2 ? { height: h.toFixed(2), min_height: minH.toFixed(2) } : { height: h.toFixed(2) },
          geometry: ring.map((pt) => tilePointToLonLat(tc.x, tc.y, tc.z, pt.x, pt.y, bld.extent)),
        });
      }
    }
  }
  return elements;
}

async function fetchBuildingsFromOverpass(
  lat: number,
  lon: number,
  radiusM: number,
  signal: AbortSignal,
): Promise<OsmBuildingElement[]> {
  const query = `[out:json][timeout:10];(way["building"](around:${Math.round(radiusM)},${lat.toFixed(5)},${lon.toFixed(5)});relation["building"](around:${Math.round(radiusM)},${lat.toFixed(5)},${lon.toFixed(5)}););out tags geom;`;
  for (const base of OVERPASS_URLS) {
    if (signal.aborted) break;
    try {
      const res = await fetch(`${base}?data=${encodeURIComponent(query)}`, { signal });
      if (!res.ok) continue;
      const json = await res.json();
      const rawEls: any[] = Array.isArray(json?.elements) ? json.elements : [];
      const out: OsmBuildingElement[] = [];
      for (const el of rawEls) {
        if (Array.isArray(el?.geometry)) {
          out.push(el);
        } else if (el?.type === 'relation' && Array.isArray(el.members)) {
          for (const m of el.members) {
            if (m?.role === 'outer' && Array.isArray(m.geometry)) {
              out.push({ id: el.id, tags: el.tags, geometry: m.geometry });
            }
          }
        }
      }
      return out;
    } catch {
      // 다음 미러 시도
    }
  }
  throw new Error('Overpass building fetch failed');
}

/**
 * 관측 위치 주변 반경 1 km 건물을 OpenFreeMap MVT(1차) / Overpass(예비)에서 조회해 병합 기하를 반환합니다.
 * 네트워크 실패 시에는 `null`을 캐시하지 않고 예외를 던져 호출부에서 재시도할 수 있게 합니다.
 */
export async function fetchNearbyBuildings(
  lat: number,
  lon: number,
  opts: { radiusM?: number; signal?: AbortSignal } = {},
): Promise<BuildingMeshData | null> {
  const radiusM = opts.radiusM ?? BUILDING_RADIUS_M;
  const key = cacheKey(lat, lon, radiusM);
  if (buildingCache.has(key)) {
    const hit = buildingCache.get(key)!;
    buildingCache.delete(key);
    buildingCache.set(key, hit);
    return hit;
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12_000);
  const onAbort = () => ctl.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    let elements: OsmBuildingElement[];
    try {
      elements = await fetchBuildingsFromMvt(lat, lon, radiusM, ctl.signal);
    } catch (mvtErr) {
      if (ctl.signal.aborted) throw mvtErr;
      elements = await fetchBuildingsFromOverpass(lat, lon, radiusM, ctl.signal);
    }
    const data = buildMergedBuildingGeometry(elements, lat, lon, radiusM);
    buildingCache.set(key, data);
    while (buildingCache.size > CACHE_MAX) {
      const oldest = buildingCache.keys().next().value;
      if (oldest !== undefined) buildingCache.delete(oldest);
      else break;
    }
    return data;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
