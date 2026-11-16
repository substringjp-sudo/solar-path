/**
 * 스토어 지형 캐시에서 **이 자리에 맞는 지형**을 고릅니다.
 *
 * ## 왜 순수 함수로 빼는가
 *
 * `SkyScene3D` 는 산줄기를 이렇게 만듭니다:
 *
 * ```ts
 * const bandAngles = simRef.current?.terrain?.bandAngles;
 * const bandDist   = simRef.current?.terrain?.bandDistancesKm;
 * if (bandAngles && bandDist && bandAngles.length > 0) { createTerrainBands(...) }
 * ```
 *
 * 곧 `sim.terrain` 에 **`bandAngles` 가 실려 있어야만** 산이 그려집니다.
 * `SunCamera` 는 예전에 `terrain: { observerElevation: 50 }` 만 넘겼습니다.
 * 그 문이 늘 닫혀 있었으므로 **AR 시뮬레이터와 촬영 썸네일에는 산이 한 번도
 * 안 나왔습니다.** 조건이 눈에 안 띄는 곳에 있어서 놓치기 쉬웠으므로,
 * 고른 결과가 그 문을 여는지 **판정에서 직접 확인**하려고 빼냅니다.
 */

/** 산줄기를 그리는 데 필요한 최소한의 모양. */
export interface TerrainLike {
  panoramicAngles?: number[];
  bandAngles?: number[] | number[][];
  bandDistancesKm?: number[];
  waterFrac?: number[];
  observerElevation?: number;
  minAz?: number;
  maxAz?: number;
  isFallback?: boolean;
  [k: string]: unknown;
}

export interface TerrainCacheEntry {
  latitude: number;
  longitude: number;
  data: TerrainLike;
}

/** 위경도 허용 오차(도). `SkyScreen` 이 쓰는 값과 같습니다. */
export const TERRAIN_MATCH_DEG = 0.05;

/**
 * `SkyScene3D` 가 이 지형으로 산줄기를 그릴 수 있는가 — 씬의 조건과 **같은 식**.
 * 하네스가 이것을 직접 물어봅니다.
 */
export const canDrawTerrainBands = (t: TerrainLike | null | undefined): boolean =>
  !!t && Array.isArray(t.bandAngles) && Array.isArray(t.bandDistancesKm) && t.bandAngles.length > 0;

/** 캐시에서 이 자리의 지형을 고릅니다. 없으면 `null`. */
export function pickTerrainForLocation(
  cache: readonly TerrainCacheEntry[] | null | undefined,
  lat: number,
  lon: number,
  tolDeg = TERRAIN_MATCH_DEG,
): TerrainLike | null {
  if (!cache || cache.length === 0) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const hit = cache.find(
    c => Math.abs(c.latitude - lat) <= tolDeg && Math.abs(c.longitude - lon) <= tolDeg,
  );
  return hit?.data ?? null;
}

/** 지형을 못 고를 때 쓰는 최소 모양. 산은 안 그려집니다(그릴 자료가 없으니까). */
export const fallbackTerrain = (observerElevation = 50): TerrainLike => ({ observerElevation });

/**
 * 지형 프로필(`panoramicAngles`)에서 방위각 `azDeg` 방향의 지평선/능선 앙각(°)을 보간합니다.
 * 자료가 없거나 fallback 이면 평평한 지평선 `0°` 를 돌려줍니다.
 */
export function terrainHorizonDegAtAz(
  terrain: TerrainLike | null | undefined,
  azDeg: number,
): number {
  const angles = terrain?.panoramicAngles;
  if (!terrain || terrain.isFallback || !Array.isArray(angles) || angles.length === 0) {
    return 0;
  }
  const minAz = typeof terrain.minAz === 'number' && Number.isFinite(terrain.minAz) ? terrain.minAz : 0;
  const maxAz = typeof terrain.maxAz === 'number' && Number.isFinite(terrain.maxAz) ? terrain.maxAz : 360;
  const span = maxAz - minAz;
  if (span <= 0 || angles.length === 1) return Math.max(0, angles[0] ?? 0);

  const normAz = (((azDeg - minAz) % 360) + 360) % 360;
  const frac = Math.max(0, Math.min(1, normAz / span));
  const idx = frac * (angles.length - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(i0 + 1, angles.length - 1);
  const f = idx - i0;
  return Math.max(0, (angles[i0] ?? 0) * (1 - f) + (angles[i1] ?? 0) * f);
}

/**
 * 태양 원반의 윗가장자리 겉보기 고도가 지평선·산 능선 위로 보이는지 판정합니다.
 * 땅 아래로 완전히 사라져 안 보이는 순간 `false` 가 되어 카메라 추적을 멈추는 데 씁니다.
 */
export function isSunVisibleAboveHorizon(
  sunApparentElevDeg: number,
  sunDiscRadiusDeg: number,
  horizonDeg: number,
  sunMeshVisible = true,
): boolean {
  if (!sunMeshVisible) return false;
  return sunApparentElevDeg + Math.max(0, sunDiscRadiusDeg) > horizonDeg;
}
