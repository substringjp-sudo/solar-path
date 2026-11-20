/**
 * 고른 대상(`PickedTarget`)을 위경도로 기억했다가, 눈 위치가 바뀐 뒤 새 눈 기준으로 다시 만드는 순수 계산.
 *
 * 자리를 옮기면 고른 대상은 옛 눈 기준(방위 · 앙각 · 거리 · 가림)이라 지워집니다. 그래서 옮기기 전에 대상의 위경도와 해발을 기억해 두고,
 * 새 자리의 지형이 오면 장면이 그 점을 새 눈에서 본 값(`SkyScene3DHandle.targetFromLatLon`)으로 돌려주며,
 * 그 값으로 같은 종류의 대상을 다시 만듭니다. 저장한 장면을 열 때가 이 길을 씁니다(docs/SANDBOX_MODE_PLAN.md 12.3).
 *
 * 2026-11-20 추천 화면을 뺄 때 `standSuggest.ts` 에서 이 둘만 옮겨 왔습니다(함수 이름만 `suggestTargetPoint` → `targetPointOf`).
 */
import { apparentHeightDeg, type BuildingInfo, type PickedTarget, type TargetPoint } from './demPick';

/**
 * 기억해 둘 대상 점. 건물은 "꼭대기" 를 대상으로 하므로 누른 곳이어도 지붕 한가운데(`topPoint`), 땅은 고른 점 그대로.
 * 위경도를 모르면 null(기억할 수 없음).
 */
export function targetPointOf(t: PickedTarget): (TargetPoint & { latitude: number; longitude: number }) | null {
  const p: TargetPoint = t.kind === 'building' && t.building ? t.building.topPoint : t;
  return p.latitude != null && p.longitude != null ? (p as TargetPoint & { latitude: number; longitude: number }) : null;
}

/**
 * 옮긴 뒤 같은 대상을 새 자리 기준으로 다시 만듭니다.
 * `tp` 는 새 눈에서 본 그 점(방위 · 앙각 · 거리 · 가림). 건물은 꼭대기를 대상 점으로 삼아(지붕 한가운데 = 누른 곳) 높이각만 새 거리로 다시 셉니다.
 */
export function rebuildPicked(kind: PickedTarget['kind'], building: BuildingInfo | undefined, tp: TargetPoint & { eyeElevM: number }): PickedTarget {
  if (kind === 'building' && building) {
    return {
      kind: 'building',
      ...tp,
      building: { ...building, topPoint: tp, hitPoint: tp, snapped: true, angularHeightDeg: apparentHeightDeg(tp.eyeElevM, tp.distM, building.baseElevM, building.topElevM) },
    };
  }
  return { kind: 'terrain', ...tp };
}
