/**
 * 먼 건물 받기 (2026-11-19, docs/SANDBOX_MODE_PLAN.md 6.3) — `farBuildings.ts` 의 계획대로 타일을 받아, 보이는 건물만 남깁니다.
 *
 * 한 번에 받는 양을 세 겹으로 묶습니다. 도심 z14 타일은 한 장이 0.2~0.8 MB(서울 표본)라 사방을 다 받으면 수십 MB 이기 때문입니다.
 *  1. 방위 범위(`sector`): 보는 방향 ± 반폭의 타일만 계획합니다.
 *  2. 타일 수 한도(`maxTiles`)와 바이트 한도(`maxBytes`): 가까운 타일부터 받다가 한도에 닿으면 멈추고 `truncated` 로 알립니다.
 *  3. 타일마다 보이는 건물만 남기고(`perTileCap`), 합칠 때 큰 것부터 `FAR_MAX_BUILDINGS` 채까지.
 *
 * 타일은 받자마자 디코드해 후보만 남기고 바이트는 버립니다(공용 타일 캐시에도 넣지 않습니다). 한 번 읽은 타일은 호출 사이에
 * `existing` 맵으로 이어 받아 다시 받지 않습니다. 네트워크는 `loadTile` 로 바꿔 끼울 수 있어 시험이 가짜 타일로 돕니다.
 */
import {
  decodeMvtTile,
  extractOuterRings,
  fetchMvtTileRaw,
  MAX_RENDER_HEIGHT_M,
  ringSignedArea,
  tilePointToLonLat,
  type MvtLayer,
  type TileCoord,
} from './mvtTiles';
import type { HeightSampler } from './demPick';
import { buildHorizonProfile, type HorizonProfile } from './horizon';
import type { BuildingMeshData, OsmBuildingElement } from './buildingTiles';
import { concatPickIndex } from './buildingPick';
import {
  FAR_MAX_BUILDINGS,
  FAR_MAX_TILES,
  planFarTiles,
  selectVisibleFar,
  type FarCandidate,
  type FarPick,
  type FarTilePlan,
} from './farBuildings';

/** 한 번 부를 때 받는 바이트 한도(압축 전 타일 크기 합). 도심 타일 0.4 MB 기준 약 60 장. */
export const FAR_MAX_BYTES = 24 * 1024 * 1024;
/** 타일 하나에서 남기는 건물 수(보이는 각높이가 큰 순). */
export const FAR_PER_TILE_CAP = 600;
const CONCURRENCY = 4;
const BUILDING_LAYER = new Set(['building']);

/** 한 타일을 읽은 결과 — 보이는 건물만. */
export interface FarTileData {
  key: string;
  picks: Array<FarPick<FarBuildingCandidate>>;
  /** 받은 바이트(0 = 시험용 가짜 타일) */
  bytes: number;
}

export interface FarBuildingCandidate extends FarCandidate {
  minHeightM: number;
}

const tileKey = (t: TileCoord) => `${t.z}/${t.x}/${t.y}`;

/** 타일의 building 레이어 → 후보(바깥 링 하나가 건물 하나). 가까운 건물 읽기와 같은 높이 규칙·중복 규칙을 씁니다. */
export function candidatesFromLayer(tc: TileCoord, layer: MvtLayer): FarBuildingCandidate[] {
  const out: FarBuildingCandidate[] = [];
  const ext = layer.extent;
  for (const f of layer.features) {
    if (f.type !== 3) continue;
    const rawH = typeof f.props.render_height === 'number' ? f.props.render_height : 9;
    const h = Math.max(3.5, Math.min(MAX_RENDER_HEIGHT_M, rawH));
    const minH = typeof f.props.render_min_height === 'number' ? Math.max(0, f.props.render_min_height) : 0;
    for (const ring of extractOuterRings(f.rings)) {
      if (ring.length < 3 || Math.abs(ringSignedArea(ring)) < 1) continue;
      let sx = 0, sy = 0;
      for (const p of ring) { sx += p.x; sy += p.y; }
      const cx = sx / ring.length, cy = sy / ring.length;
      // 타일 버퍼 영역에 걸친 중복 폴리곤은 중심이 속한 타일 1곳에서만 (가까운 건물 읽기와 같은 규칙)
      if (cx < 0 || cx >= ext || cy < 0 || cy >= ext) continue;
      const c = tilePointToLonLat(tc.x, tc.y, tc.z, cx, cy, ext);
      out.push({
        lat: c.lat, lon: c.lon, heightM: h, minHeightM: minH,
        ring: ring.map(p => tilePointToLonLat(tc.x, tc.y, tc.z, p.x, p.y, ext)),
      });
    }
  }
  return out;
}

export type LoadTileFn = (tc: TileCoord, signal?: AbortSignal) => Promise<{ layer: MvtLayer | null; bytes: number }>;

/** 기본 타일 읽기: 네트워크에서 받아 building 레이어만 디코드(공용 캐시에는 넣지 않음). */
export const loadTileFromNetwork: LoadTileFn = async (tc, signal) => {
  const raw = await fetchMvtTileRaw(tc, { signal, cache: false });
  const layers = decodeMvtTile(raw, BUILDING_LAYER);
  return { layer: layers.building ?? null, bytes: raw.length };
};

export interface FarLoadArgs {
  lat: number;
  lon: number;
  eyeM: number;
  sample: HeightSampler;
  profile?: HorizonProfile;
  /** 보는 방향 ± 반폭(°). 없으면 사방(비쌈). */
  sector?: { azDeg: number; halfWidthDeg: number };
  /** 이미 읽은 타일(이어 받기). 이 맵에 새로 읽은 타일이 더해집니다. */
  existing?: Map<string, FarTileData>;
  signal?: AbortSignal;
  maxTiles?: number;
  maxBytes?: number;
  perTileCap?: number;
  loadTile?: LoadTileFn;
  onProgress?: (p: { tilesDone: number; tilesTotal: number; bytes: number }) => void;
}

export interface FarLoadResult {
  /** 이번까지 읽은 모든 타일(existing 포함) */
  tiles: Map<string, FarTileData>;
  plan: FarTilePlan;
  /** 이번 호출에서 받은 바이트·타일 수·실패 수 */
  bytes: number;
  fetched: number;
  failed: number;
  /** 바이트 한도에 닿아 계획한 타일을 다 못 받았다 */
  truncated: boolean;
}

/**
 * 보는 방향의 먼 타일을 계획하고 받아 보이는 건물만 남깁니다. 실패한 타일은 건너뛰고 `failed` 로 셉니다(나머지는 씁니다).
 * 취소(signal)하면 지금까지 받은 것을 돌려줍니다.
 */
export async function loadFarBuildings(args: FarLoadArgs): Promise<FarLoadResult> {
  const { lat, lon, eyeM, sample, signal } = args;
  const profile = args.profile ?? buildHorizonProfile(sample, eyeM);
  const tiles = args.existing ?? new Map<string, FarTileData>();
  const loadTile = args.loadTile ?? loadTileFromNetwork;
  const maxBytes = args.maxBytes ?? FAR_MAX_BYTES;
  const perTileCap = args.perTileCap ?? FAR_PER_TILE_CAP;
  const plan = planFarTiles(profile, sample, lat, lon, { sector: args.sector, maxTiles: args.maxTiles ?? FAR_MAX_TILES });
  const todo = plan.tiles.filter(t => !tiles.has(tileKey(t)));
  let next = 0, done = 0, bytes = 0, fetched = 0, failed = 0, truncated = false;

  const worker = async () => {
    for (;;) {
      if (signal?.aborted) return;
      if (bytes >= maxBytes) { truncated = true; return; }
      const i = next++;
      if (i >= todo.length) return;
      const tc = todo[i];
      try {
        const { layer, bytes: b } = await loadTile(tc, signal);
        bytes += b;
        if (signal?.aborted) return;
        const cands = layer ? candidatesFromLayer(tc, layer) : [];
        const picks = selectVisibleFar(profile, sample, lat, lon, cands, { maxBuildings: perTileCap });
        tiles.set(tileKey(tc), { key: tileKey(tc), picks, bytes: b });
        fetched++;
      } catch {
        if (signal?.aborted) return;
        failed++;
      }
      done++;
      args.onProgress?.({ tilesDone: done, tilesTotal: todo.length, bytes });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, todo.length)) }, worker));
  if (next < todo.length && bytes >= maxBytes) truncated = true;
  return { tiles, plan, bytes, fetched, failed, truncated };
}

/** 읽은 타일들의 보이는 건물을 큰 것부터 `cap` 채까지 건물 요소로 바꿉니다(병합 기하의 입력). */
export function picksToElements(tiles: Iterable<FarTileData>, cap = FAR_MAX_BUILDINGS): OsmBuildingElement[] {
  const all: Array<FarPick<FarBuildingCandidate>> = [];
  for (const t of tiles) for (const p of t.picks) all.push(p);
  all.sort((a, b) => b.visibleDeg - a.visibleDeg);
  const keep = all.length > cap ? all.slice(0, cap) : all;
  return keep.map(p => ({
    tags: p.item.minHeightM > 0.2
      ? { height: p.item.heightM.toFixed(2), min_height: p.item.minHeightM.toFixed(2) }
      : { height: p.item.heightM.toFixed(2) },
    geometry: p.item.ring,
  }));
}

/**
 * 병합 기하 둘을 하나로 잇습니다(같은 중심 위경도로 만든 것끼리). 가까운 건물에 먼 건물을 붙일 때 씁니다.
 * 둘 중 하나가 비면 다른 쪽을 그대로 돌려줍니다.
 */
export function concatBuildingMeshData(a: BuildingMeshData | null, b: BuildingMeshData | null): BuildingMeshData | null {
  if (!a || a.vertexCount === 0) return b;
  if (!b || b.vertexCount === 0) return a;
  const cat = (x: Float32Array, y: Float32Array) => { const o = new Float32Array(x.length + y.length); o.set(x, 0); o.set(y, x.length); return o; };
  const sa = a.styles ?? new Float32Array(a.vertexCount);
  const sb = b.styles ?? new Float32Array(b.vertexCount);
  return {
    pick: concatPickIndex(a.pick, b.pick),
    positions: cat(a.positions, b.positions),
    normals: cat(a.normals, b.normals),
    groundPos: cat(a.groundPos, b.groundPos),
    wallCoords: cat(a.wallCoords, b.wallCoords),
    styles: cat(sa, sb),
    buildingCount: a.buildingCount + b.buildingCount,
    vertexCount: a.vertexCount + b.vertexCount,
  };
}
