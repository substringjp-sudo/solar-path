/**
 * 화면을 눌러 대상 고르기 (2026-11-19, docs/SANDBOX_MODE_PLAN.md 3.2) — 눈에서 누른 방향으로 쏜 시선이 **처음 닿는 지형이나 건물**.
 *
 * 순서: ① 지형에 닿는 거리를 구한다 ② 그보다 가까운 건물이 있으면 건물(벽·지붕) ③ 없으면 지형(먼 곳은 가까운 봉우리로 붙임).
 * 먼(400 m 밖) 대상은 손끝이 화면에서 몇 픽셀 어긋나도 잡히도록, 정확히 닿는 건물이 없을 때 누른 점 둘레 `tolDeg`
 * 안의 시선을 8방향 × 3겹으로 더 쏘아 가장 가까운 건물을 잡습니다(10 km 밖 탑은 폭이 화면에서 몇 픽셀뿐입니다).
 * 단 누른 곳이 400 m 안의 땅이면 이 여유를 쓰지 않습니다(발밑을 눌렀는데 먼 건물이 잡히면 안 됩니다).
 *
 * 건물을 잡으면 누른 자리(`hitPoint`)와 꼭대기(`topPoint`, 지붕 한가운데)를 둘 다 담고, 먼 건물(400 m 밖)은 꼭대기를 기본 대상 점으로 씁니다.
 * 지형을 잡을 때의 "먼 대상은 가까운 봉우리로 붙임"과 같은 규칙입니다.
 */
import {
  rayHitTerrain, climbToPeak, targetPointAt,
  type HeightSampler, type PickedTarget, type BuildingInfo,
} from './demPick';
import { rayHitBuildings, roofCenter, footprintDimsM, type BuildingPickIndex, type BuildingHit } from './buildingPick';

const RAD = Math.PI / 180;
/** 이보다 먼 대상은 봉우리/꼭대기로 붙이고, 손끝 여유를 씁니다. */
export const FAR_PICK_M = 400;
/** 지형과 건물 닿는 거리가 이 안이면 건물이 앞에 있는 것으로 봅니다(DEM 칸 크기 몫). */
const TERRAIN_TIE_M = 12;

export interface PickArgs {
  sample: HeightSampler;
  eyeM: number;
  azDeg: number;
  elDeg: number;
  buildings?: BuildingPickIndex | null;
  /** 손끝 여유(°, 화면 픽셀 × 픽셀당 각). 0 이면 정확히 닿은 것만. */
  tolDeg?: number;
  toLatLon?: (eastM: number, southM: number) => { latitude: number; longitude: number } | null;
}

/** 정확히 닿는 건물이 없을 때, 누른 점 둘레의 시선에서 가장 가까운(누른 점에서 각이 가까운) 먼 건물. */
function fuzzyFarBuilding(a: PickArgs, idx: BuildingPickIndex): BuildingHit | null {
  const tol = a.tolDeg ?? 0;
  if (!(tol > 0)) return null;
  const cosEl = Math.max(0.2, Math.cos(a.elDeg * RAD));
  let best: BuildingHit | null = null;
  let bestR = Infinity;
  for (const f of [1 / 3, 2 / 3, 1]) {
    const r = f * tol;
    for (let k = 0; k < 8; k++) {
      const ph = k * 45 * RAD;
      const az = a.azDeg + (r * Math.cos(ph)) / cosEl;
      const el = a.elDeg + r * Math.sin(ph);
      const th = rayHitTerrain(a.sample, a.eyeM, az, el);
      const h = rayHitBuildings(idx, a.sample, a.eyeM, az, el, { maxDistM: th ? th.distM + TERRAIN_TIE_M : 40000, minDistM: FAR_PICK_M });
      if (h && (r < bestR - 1e-9 || (Math.abs(r - bestR) <= 1e-9 && best && h.distM < best.distM))) { best = h; bestR = r; }
    }
  }
  return best;
}

function buildingTarget(a: PickArgs, idx: BuildingPickIndex, hit: BuildingHit): PickedTarget {
  const hitPoint = targetPointAt(a.sample, a.eyeM, hit.eastM, hit.southM, hit.elevM, a.toLatLon);
  const rc = roofCenter(idx, hit.index);
  const topPoint = targetPointAt(a.sample, a.eyeM, rc.x, rc.z, hit.topElevM, a.toLatLon);
  const dims = footprintDimsM(idx, hit.index);
  const snapped = hit.distM > FAR_PICK_M;
  const info: BuildingInfo = {
    heightM: idx.topH[hit.index],
    baseElevM: hit.baseElevM,
    topElevM: hit.topElevM,
    longM: dims.longM,
    shortM: dims.shortM,
    snapped,
    hitPoint,
    topPoint,
  };
  return { kind: 'building', ...(snapped ? topPoint : hitPoint), eyeElevM: a.eyeM, building: info };
}

/** 누른 방향(방위 azDeg, 앙각 elDeg)에서 처음 닿는 대상. 하늘·바다·자료 밖이면 null. */
export function pickTargetAt(a: PickArgs): PickedTarget | null {
  const { sample, eyeM, azDeg, elDeg } = a;
  const th = rayHitTerrain(sample, eyeM, azDeg, elDeg);
  const idx = a.buildings && a.buildings.count > 0 ? a.buildings : null;
  if (idx) {
    let bh = rayHitBuildings(idx, sample, eyeM, azDeg, elDeg, { maxDistM: th ? th.distM + TERRAIN_TIE_M : 40000 });
    if (!bh && (!th || th.distM > FAR_PICK_M)) bh = fuzzyFarBuilding(a, idx);
    if (bh) return buildingTarget(a, idx, bh);
  }
  if (!th) return null;
  let { eastM, southM, elevM } = th;
  // 먼 대상은 가까운 봉우리 꼭대기로 붙입니다(산을 눌렀는데 비탈 한가운데가 잡히지 않게). 가까운 땅은 누른 자리 그대로.
  if (th.distM > FAR_PICK_M) {
    const pk = climbToPeak(sample, eastM, southM, { maxR: Math.min(250, th.distM * 0.05) });
    if (pk) { eastM = pk.eastM; southM = pk.southM; elevM = pk.elevM; }
  }
  return { kind: 'terrain', ...targetPointAt(sample, eyeM, eastM, southM, elevM, a.toLatLon), eyeElevM: eyeM };
}
