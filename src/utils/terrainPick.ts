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
  bandAngles?: number[];
  bandDistancesKm?: number[];
  waterFrac?: number[];
  observerElevation?: number;
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
