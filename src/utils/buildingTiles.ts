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
  /** 건물 타입별 외장 스타일 ID (0=아파트/주거, 1=오피스/커튼월, 2=상가/벽돌·석재, 3=창고/산업) */
  styles?: Float32Array;
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
 * 건물 태그(OSM `building=*`)와 높이·바닥면적을 바탕으로 외장 스타일 ID를 결정합니다.
 * - 0: 아파트·주거 (아이보리/미색/연회색 도장 + 펀치드 윈도우)
 * - 1: 오피스·상업/타워 (짙은 청회색 커튼월 유리 + 알루미늄 멀리언 + 강한 하늘 반사)
 * - 2: 저층 상가·벽돌/석재·공공/종교 (따뜻한 벽돌/테라코타/사암 + 1층 쇼윈도)
 * - 3: 산업·창고·부속시설 (짙은 슬레이트/금속 패널 + 창문 최소)
 */
function classifyBuildingStyle(
  tags: Record<string, string | undefined> | undefined,
  topH: number,
  areaM2: number,
  cx: number,
  cz: number,
): number {
  const kind = (tags?.building ?? '').trim().toLowerCase();
  if (kind && kind !== 'yes') {
    if (
      kind === 'apartments' || kind === 'residential' || kind === 'dormitory' ||
      kind === 'house' || kind === 'detached' || kind === 'semidetached_house' ||
      kind === 'terrace' || kind === 'bungalow' || kind === 'cabin' || kind === 'hut'
    ) return 0;
    if (
      kind === 'office' || kind === 'commercial' || kind === 'hotel' ||
      kind === 'hospital' || kind === 'university' || kind === 'government' ||
      kind === 'tower' || kind === 'train_station' || kind === 'transportation'
    ) return 1;
    if (
      kind === 'retail' || kind === 'supermarket' || kind === 'school' ||
      kind === 'public' || kind === 'civic' || kind === 'church' ||
      kind === 'cathedral' || kind === 'temple' || kind === 'shrine' || kind === 'stadium'
    ) return 2;
    if (
      kind === 'industrial' || kind === 'warehouse' || kind === 'garage' ||
      kind === 'garages' || kind === 'carport' || kind === 'shed' ||
      kind === 'farm' || kind === 'greenhouse' || kind === 'kiosk' || kind === 'roof'
    ) return 3;
  }

  // MVT 타일 등 building=* 태그가 생략된 경우 높이 + 바닥면적 + 위치 씨앗으로 합리적 분류
  const h = Math.abs(Math.sin(cx * 0.137 + cz * 0.293) * 43758.5453) % 1;
  if (topH <= 11.5 && areaM2 >= 900) return 3; // 넓고 낮은 창고/물류/대형시설
  if (topH >= 38) return h < 0.62 ? 1 : 0;      // 초고층: 오피스 커튼월 62% / 초고층 주상복합·아파트 38%
  if (topH >= 22) return h < 0.34 ? 1 : 0;      // 고층: 아파트 66% / 오피스 34%
  if (topH >= 12) return h < 0.72 ? 0 : (h < 0.88 ? 2 : 1); // 중층: 주거·아파트 위주 + 일부 상가/오피스
  if (areaM2 < 140) return h < 0.65 ? 0 : 2;    // 소형 단독/근린상가
  return h < 0.48 ? 2 : 0;                      // 저층 상가(벽돌/석재)와 다세대 혼합
}

type RoofShape = 'flat' | 'gabled' | 'hipped' | 'pyramidal' | 'dome' | 'skillion';

function classifyRoofShape(
  tags: Record<string, string | undefined> | undefined,
  styleId: number,
  topH: number,
  areaM2: number,
  cx: number,
  cz: number,
): RoofShape {
  const rs = (tags?.['roof:shape'] ?? '').trim().toLowerCase();
  if (rs === 'gabled' || rs === 'half-hipped') return 'gabled';
  if (rs === 'hipped' || rs === 'mansard') return 'hipped';
  if (rs === 'pyramidal' || rs === 'cone' || rs === 'onion') return 'pyramidal';
  if (rs === 'dome' || rs === 'round') return 'dome';
  if (rs === 'skillion') return 'skillion';
  if (rs === 'flat') return 'flat';

  const kind = (tags?.building ?? '').trim().toLowerCase();
  if (kind === 'church' || kind === 'cathedral') return 'pyramidal';
  if (kind === 'temple' || kind === 'shrine') return 'hipped';

  const h = Math.abs(Math.sin(cx * 0.271 + cz * 0.193 + 1.7) * 43758.5453) % 1;
  if (styleId === 0 && topH <= 9.5 && areaM2 < 240) {
    if (h < 0.62) return 'gabled';
    if (h < 0.84) return 'hipped';
    return 'flat';
  }
  if (styleId === 2 && topH <= 12.5 && areaM2 < 450) {
    if (h < 0.26) return 'gabled';
    if (h < 0.42) return 'hipped';
    return 'flat';
  }
  if (styleId === 3 && topH <= 11.5 && areaM2 >= 220) {
    return h < 0.50 ? 'gabled' : 'flat';
  }
  return 'flat';
}

function isStarShapedCCW(pts: { x: number; z: number }[], cx: number, cz: number): boolean {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const cross = (b.x - a.x) * (cz - a.z) - (b.z - a.z) * (cx - a.x);
    if (cross <= 0.01) return false;
  }
  return true;
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
  const styleOut: number[] = [];
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
    styleId: number,
  ) => {
    posOut.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    normOut.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    gndOut.push(gx, gz, gx, gz, gx, gz);
    winOut.push(ua, va, cols, rows, ub, vb, cols, rows, uc, vc, cols, rows);
    styleOut.push(styleId, styleId, styleId);
  };

  /** (x=동, y=높이, z=남) 지붕 삼각형 — 법선이 항상 +Y 위를 향하도록 자동 와인딩 */
  const pushRoofTri = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cxP: number, cyP: number, czP: number,
    gx: number, gz: number,
    styleId: number,
  ) => {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cxP - ax, vy = cyP - ay, vz = czP - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) return;
    nx /= len; ny /= len; nz /= len;
    if (ny < 0) {
      pushTri(ax, ay, az, cxP, cyP, czP, bx, by, bz, -nx, -ny, -nz, gx, gz, -1, -1, -1, -1, -1, -1, 0, 0, styleId);
    } else {
      pushTri(ax, ay, az, bx, by, bz, cxP, cyP, czP, nx, ny, nz, gx, gz, -1, -1, -1, -1, -1, -1, 0, 0, styleId);
    }
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

    const rawArea = signedAreaXZ(rawPts);
    const ccw = rawArea >= 0;
    const areaM2 = Math.abs(rawArea);
    const styleId = classifyBuildingStyle(el.tags, topH, areaM2, cx, cz);
    const oriented = ccw ? rawPts : [...rawPts].reverse();
    const ring = subdivideFootprintXZ(oriented);
    const roofTris = triangulatePolygonXZ(oriented);
    if (roofTris.length < 3) continue;

    let roofShape = classifyRoofShape(el.tags, styleId, topH, areaM2, cx, cz);
    const span = Math.min(maxX - minX, maxZ - minZ);
    const explicitRoofH = parseLengthM(el.tags?.['roof:height']);
    let ridgeH = explicitRoofH ?? (
      roofShape === 'dome'
        ? Math.min(5.2, Math.max(1.8, span * 0.30))
        : roofShape === 'skillion'
          ? Math.min(2.6, Math.max(1.0, span * 0.16))
          : styleId === 3
            ? Math.min(2.2, Math.max(1.1, span * 0.11))
            : Math.min(3.6, Math.max(1.3, span * 0.24))
    );
    if (topH - minH < 2.2) roofShape = 'flat';
    const eaveH = roofShape === 'flat' ? topH : Math.max(minH + 0.6, topH - ridgeH * 0.40);
    const peakH = eaveH + ridgeH;

    const starOk = roofShape !== 'flat' && roofShape !== 'skillion' ? isStarShapedCCW(oriented, cx, cz) : false;
    if (roofShape === 'gabled' && oriented.length !== 4) {
      roofShape = starOk ? 'hipped' : 'flat';
    } else if ((roofShape === 'hipped' || roofShape === 'pyramidal' || roofShape === 'dome') && !starOk) {
      roofShape = 'flat';
    }

    // 3. 지붕 기하 생성 (flat / gabled / hipped / pyramidal / dome / skillion)
    let skillionHeightAt: ((x: number, z: number) => number) | null = null;
    if (roofShape === 'skillion') {
      let cxx = 0, czz = 0, cxz = 0;
      for (const p of oriented) {
        const dx = p.x - cx, dz = p.z - cz;
        cxx += dx * dx; czz += dz * dz; cxz += dx * dz;
      }
      const theta = 0.5 * Math.atan2(2 * cxz, cxx - czz);
      const vx = -Math.sin(theta), vz = Math.cos(theta);
      let vMin = Infinity, vMax = -Infinity;
      for (const p of oriented) {
        const pv = (p.x - cx) * vx + (p.z - cz) * vz;
        if (pv < vMin) vMin = pv;
        if (pv > vMax) vMax = pv;
      }
      const vSpan = Math.max(0.5, vMax - vMin);
      skillionHeightAt = (x: number, z: number) => eaveH + ridgeH * (((x - cx) * vx + (z - cz) * vz - vMin) / vSpan);
      for (let t = 0; t < roofTris.length; t += 3) {
        const a = oriented[roofTris[t]];
        const b = oriented[roofTris[t + 1]];
        const c = oriented[roofTris[t + 2]];
        pushRoofTri(a.x, skillionHeightAt(a.x, a.z), a.z, c.x, skillionHeightAt(c.x, c.z), c.z, b.x, skillionHeightAt(b.x, b.z), b.z, cx, cz, styleId);
      }
    } else if (roofShape === 'gabled' && oriented.length === 4) {
      const e01 = Math.hypot(oriented[1].x - oriented[0].x, oriented[1].z - oriented[0].z)
        + Math.hypot(oriented[3].x - oriented[2].x, oriented[3].z - oriented[2].z);
      const e12 = Math.hypot(oriented[2].x - oriented[1].x, oriented[2].z - oriented[1].z)
        + Math.hypot(oriented[0].x - oriented[3].x, oriented[0].z - oriented[3].z);
      let shift = e12 < e01 ? 1 : 0;
      if ((el.tags?.['roof:orientation'] ?? '').trim().toLowerCase() === 'across') shift = 1 - shift;
      const p0 = oriented[shift % 4];
      const p1 = oriented[(shift + 1) % 4];
      const p2 = oriented[(shift + 2) % 4];
      const p3 = oriented[(shift + 3) % 4];
      const m0 = { x: (p0.x + p1.x) * 0.5, z: (p0.z + p1.z) * 0.5 };
      const m1 = { x: (p2.x + p3.x) * 0.5, z: (p2.z + p3.z) * 0.5 };
      pushRoofTri(p1.x, eaveH, p1.z, p2.x, eaveH, p2.z, m1.x, peakH, m1.z, cx, cz, styleId);
      pushRoofTri(p1.x, eaveH, p1.z, m1.x, peakH, m1.z, m0.x, peakH, m0.z, cx, cz, styleId);
      pushRoofTri(p3.x, eaveH, p3.z, p0.x, eaveH, p0.z, m0.x, peakH, m0.z, cx, cz, styleId);
      pushRoofTri(p3.x, eaveH, p3.z, m0.x, peakH, m0.z, m1.x, peakH, m1.z, cx, cz, styleId);
    } else if (roofShape === 'dome') {
      const midH = eaveH + ridgeH * 0.78;
      const ring55 = oriented.map(p => ({ x: cx + (p.x - cx) * 0.55, z: cz + (p.z - cz) * 0.55 }));
      for (let i = 0; i < oriented.length; i++) {
        const j = (i + 1) % oriented.length;
        const a = oriented[i], b = oriented[j], a2 = ring55[i], b2 = ring55[j];
        pushRoofTri(a.x, eaveH, a.z, b2.x, midH, b2.z, b.x, eaveH, b.z, cx, cz, styleId);
        pushRoofTri(a.x, eaveH, a.z, a2.x, midH, a2.z, b2.x, midH, b2.z, cx, cz, styleId);
        pushRoofTri(a2.x, midH, a2.z, cx, peakH, cz, b2.x, midH, b2.z, cx, cz, styleId);
      }
    } else if (roofShape === 'hipped' || roofShape === 'pyramidal') {
      for (let i = 0; i < oriented.length; i++) {
        const a = oriented[i], b = oriented[(i + 1) % oriented.length];
        pushRoofTri(a.x, eaveH, a.z, cx, peakH, cz, b.x, eaveH, b.z, cx, cz, styleId);
      }
    } else {
      for (let t = 0; t < roofTris.length; t += 3) {
        const a = oriented[roofTris[t]];
        const b = oriented[roofTris[t + 1]];
        const c = oriented[roofTris[t + 2]];
        pushTri(a.x, eaveH, a.z, c.x, eaveH, c.z, b.x, eaveH, b.z, 0, 1, 0, cx, cz, -1, -1, -1, -1, -1, -1, 0, 0, styleId);
      }
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
    const winRows = Math.floor(Math.max(0, eaveH - winBaseH) / WINDOW_CELL_M);
    const vBot = baseH - winBaseH;
    const vEave = eaveH - winBaseH;
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
      const hA = skillionHeightAt ? skillionHeightAt(a.x, a.z) : eaveH;
      const hB = skillionHeightAt ? skillionHeightAt(b.x, b.z) : eaveH;
      const vTopA = hA - winBaseH;
      const vTopB = hB - winBaseH;
      pushTri(a.x, baseH, a.z, a.x, hA, a.z, b.x, hB, b.z, nx, 0, nz, cx, cz, u0, vBot, u0, vTopA, u1, vTopB, winCols, winRows, styleId);
      pushTri(a.x, baseH, a.z, b.x, hB, b.z, b.x, baseH, b.z, nx, 0, nz, cx, cz, u0, vBot, u1, vTopB, u1, vBot, winCols, winRows, styleId);
    }

    // 박공(gabled) 양 끝 벽면 삼각형 마감 (벽면 재질과 동일하게 연결)
    if (roofShape === 'gabled' && oriented.length === 4) {
      const e01 = Math.hypot(oriented[1].x - oriented[0].x, oriented[1].z - oriented[0].z)
        + Math.hypot(oriented[3].x - oriented[2].x, oriented[3].z - oriented[2].z);
      const e12 = Math.hypot(oriented[2].x - oriented[1].x, oriented[2].z - oriented[1].z)
        + Math.hypot(oriented[0].x - oriented[3].x, oriented[0].z - oriented[3].z);
      let shift = e12 < e01 ? 1 : 0;
      if ((el.tags?.['roof:orientation'] ?? '').trim().toLowerCase() === 'across') shift = 1 - shift;
      const p0 = oriented[shift % 4];
      const p1 = oriented[(shift + 1) % 4];
      const p2 = oriented[(shift + 2) % 4];
      const p3 = oriented[(shift + 3) % 4];
      const emitGableCap = (ga: { x: number; z: number }, gb: { x: number; z: number }) => {
        const gex = gb.x - ga.x, gez = gb.z - ga.z;
        const gLen = Math.hypot(gex, gez);
        if (gLen < 0.2) return;
        const gnx = gez / gLen, gnz = -gex / gLen;
        const mx = (ga.x + gb.x) * 0.5, mz = (ga.z + gb.z) * 0.5;
        pushTri(ga.x, eaveH, ga.z, mx, peakH, mz, gb.x, eaveH, gb.z, gnx, 0, gnz, cx, cz, 0, vEave, gLen * 0.5, peakH - winBaseH, gLen, vEave, winCols, winRows, styleId);
      };
      emitGableCap(p0, p1);
      emitGableCap(p2, p3);
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
    styles: new Float32Array(styleOut),
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
  geo.setAttribute('aStyle', new THREE.BufferAttribute(data.styles ?? new Float32Array(data.vertexCount), 1));
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

/** 건물 받기 진행: 끝난 타일 수와 받을 타일 수. `total` 이 0 이면 전체를 모르는 것입니다(예비 경로로 한 번에 받는 중). */
export interface BuildingFetchProgress {
  done: number;
  total: number;
}

async function fetchBuildingsFromMvt(
  lat: number,
  lon: number,
  radiusM: number,
  signal: AbortSignal,
  onProgress?: (p: BuildingFetchProgress) => void,
): Promise<OsmBuildingElement[]> {
  const tiles = tileListForRadius(lat, lon, radiusM, 14);
  let done = 0;
  onProgress?.({ done, total: tiles.length });
  const results = await Promise.all(
    tiles.map(async (tc) => {
      try {
        const raw = await fetchMvtTileRaw(tc, { signal });
        const layers = decodeMvtTile(raw, BUILDING_MVT_LAYERS);
        return { tc, bld: layers.building ?? null };
      } catch {
        return null;
      } finally {
        done += 1;
        onProgress?.({ done, total: tiles.length });
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
      const bClass = typeof f.props.building === 'string'
        ? f.props.building
        : typeof f.props.class === 'string'
          ? f.props.class
          : typeof f.props.type === 'string'
            ? f.props.type
            : undefined;
      const rShape = typeof f.props['roof:shape'] === 'string'
        ? f.props['roof:shape']
        : typeof f.props.roof_shape === 'string'
          ? f.props.roof_shape
          : undefined;
      const rHeight = typeof f.props['roof:height'] === 'number'
        ? String(f.props['roof:height'])
        : typeof f.props['roof:height'] === 'string'
          ? f.props['roof:height']
          : typeof f.props.roof_height === 'number'
            ? String(f.props.roof_height)
            : undefined;
      for (const ring of extractOuterRings(f.rings)) {
        if (ring.length < 3 || Math.abs(ringSignedArea(ring)) < 1) continue;
        // 타일 버퍼 영역에 걸친 중복 폴리곤은 중심이 속한 타일 1곳에서만 생성
        const { cx, cy } = ringCenterTile(ring);
        if (cx < 0 || cx >= bld.extent || cy < 0 || cy >= bld.extent) continue;
        const tags: Record<string, string | undefined> = { height: h.toFixed(2) };
        if (minH > 0.2) tags.min_height = minH.toFixed(2);
        if (bClass) tags.building = bClass;
        if (rShape) tags['roof:shape'] = rShape;
        if (rHeight) tags['roof:height'] = rHeight;
        elements.push({
          tags,
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
 * `onProgress` 는 타일이 하나 끝날 때마다 불립니다(샌드박스의 "주변 불러오는 중 · 건물 62 %" 막대). 캐시에 있으면 한 번도 안 불립니다.
 */
export async function fetchNearbyBuildings(
  lat: number,
  lon: number,
  opts: { radiusM?: number; signal?: AbortSignal; onProgress?: (p: BuildingFetchProgress) => void } = {},
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
      elements = await fetchBuildingsFromMvt(lat, lon, radiusM, ctl.signal, opts.onProgress);
    } catch (mvtErr) {
      if (ctl.signal.aborted) throw mvtErr;
      opts.onProgress?.({ done: 0, total: 0 });   // 예비 경로는 한 번에 받으므로 전체를 모릅니다
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
