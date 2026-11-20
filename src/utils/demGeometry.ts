/**
 * demGeometry.ts — 높이장 패치(DEM 블록)의 **순수 기하**: 경위도 ↔ 타일 좌표, 타일의 지상 거리, 눈이 블록 안 어디에 있는가.
 *
 * `demTiles.ts` 에서 꺼냈습니다. 그쪽은 THREE 와 타일 캐시(expo 파일 시스템)를 끌고 와서 일반 Node 판정이 불러올 수 없고,
 * 이 계산은 판정이 독립 식으로 따로 견주어야 하기 때문입니다(`tools/shader-preview/verify-eye-follow.js`).
 *
 * ## 눈을 프레임마다 따라가기 (연속 이동 조이스틱 2단계, docs/SANDBOX_MODE_PLAN.md 12.2)
 *
 * 지형 · 바다 셰이더는 눈의 자리를 "블록 안 소수 타일 좌표"(`uDemObs`)로 받습니다. 예전에는 이 값을 조각을 받을 때만 정했습니다(경위도
 * 소수점 셋째 자리, 약 100 m 칸이 바뀔 때). 그래서 그 사이에 눈이 움직여도 지형이 따라오지 않다가 칸이 바뀌는 순간 한꺼번에 건너뛰었습니다.
 * `observerTileUV` 는 같은 블록에서 **눈의 현재 경위도**에 대한 이 좌표를 구하므로, 프레임마다 불러 `uDemObs` 를 옮기면 지형이 부드럽게 따라옵니다.
 * 받아 둔 블록이 눈 둘레 반경을 더는 못 덮게 되기 전에 새 블록을 받아야 하는데, 그 판단이 `blockCovers` 입니다.
 */

/** 적도 둘레 (m). Web Mercator 의 기준입니다. */
export const EARTH_CIRCUMFERENCE_M = 40075016.686;

/**
 * 경위도 → **소수** 타일 좌표 (표준 slippy map 식).
 *
 * 정수부가 타일 번호, 소수부가 그 타일 안에서의 위치입니다.
 */
export function lonLatToTileFloat(
  lon: number,
  lat: number,
  z: number,
): { x: number; y: number } {
  const n = Math.pow(2, z);
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y:
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      n,
  };
}

/**
 * 그 위도에서 타일 한 장이 덮는 **지상** 거리 (m).
 *
 * Web Mercator 는 등각사상이라 위도가 높을수록 같은 타일이 좁은 땅을 덮습니다
 * (cos φ 배). 이걸 빼먹으면 지형이 남북으로 늘어납니다.
 */
export function tileSpanMetres(z: number, lat: number): number {
  return (
    (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z)
  );
}

/** 블록(받아 둔 타일 묶음)의 자리를 정하는 값. `DemPatch` 의 일부입니다. */
export interface BlockGeometry {
  zoom: number;
  /** 블록 왼쪽 위 **정수** 타일 좌표 */
  originTileX: number;
  originTileY: number;
  /** 블록 한 변의 타일 수 */
  blockTiles: number;
  /** 타일 한 장이 덮는 지상 거리 (m) */
  tileSpanM: number;
}

/** 눈의 자리를 들고 있는 블록. `DemPatch` 가 이 모양입니다. */
export interface ObservedBlock extends BlockGeometry {
  observerU: number;
  observerV: number;
}

/**
 * 눈에서 **어느 방향으로도 보장되는** 블록 안쪽 반지름(m). 셰이더의 `dem_probeRadiusM` 과 **같은 식**입니다 —
 * 관측자 타일이 정중앙 한 칸을 차지하므로 여유는 (한 변 − 1) / 2 타일이고, 가장자리 화소가 늘어나는 것을 피하려고 2 % 안쪽으로 잡습니다.
 * 눈이 이 반지름을 못 덮는 자리로 가면(곧 가운데 타일을 벗어나면) 새 블록을 받아야 합니다.
 */
export const denseRadiusM = (block: Pick<BlockGeometry, 'blockTiles' | 'tileSpanM'>): number =>
  0.98 * 0.5 * (block.blockTiles - 1) * block.tileSpanM;

/**
 * 이 블록에서 본 (lat, lon) 의 소수 타일 좌표(블록 원점 기준, 0 ~ blockTiles). 패치를 받을 때 `observerU/V` 를 정한 식과 같습니다.
 */
export function observerTileUV(block: BlockGeometry, lat: number, lon: number): { u: number; v: number } {
  const t = lonLatToTileFloat(lon, lat, block.zoom);
  return { u: t.x - block.originTileX, v: t.y - block.originTileY };
}

/**
 * 눈을 (lat, lon) 으로 옮깁니다: 블록의 `observerU/V` 를 고치고 그 값을 돌려줍니다. 유니폼을 꽂는 쪽(`setObserver`)과
 * CPU 쪽 읽기(고르기 · 땅 프로필)가 같은 값을 보게 하려고 한 곳에서 합니다.
 */
export function moveObserver(block: ObservedBlock, lat: number, lon: number): { u: number; v: number } {
  const o = observerTileUV(block, lat, lon);
  block.observerU = o.u;
  block.observerV = o.v;
  return o;
}

/**
 * 눈이 (lat, lon) 에 있을 때 이 블록이 반경 `radiusM` 를 덮는가. 블록 가장자리에서 `marginTiles` 타일 안쪽까지만 믿습니다 —
 * 걸어서는 넉넉하지만 비행(120 m/s)에서는 새 블록을 받는 동안 가장자리를 넘지 않게 여유를 둡니다.
 * 위도 · 경도 · 반경이 유한한 수가 아니면 거짓입니다.
 */
export function blockCovers(block: BlockGeometry, lat: number, lon: number, radiusM: number, marginTiles = 0): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusM)) return false;
  const { u, v } = observerTileUV(block, lat, lon);
  const r = radiusM / block.tileSpanM;
  const lo = marginTiles + r;
  const hi = block.blockTiles - marginTiles - r;
  return u >= lo && u <= hi && v >= lo && v <= hi;
}
