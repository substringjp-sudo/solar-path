/**
 * GnomonShadow.ts
 *
 * NOTE: 사용자 요청으로 gnomon(기둥) 및 그림자 렌더링이 비활성화되었습니다.
 * 하위 호환성을 위해 인터페이스는 유지하되 빈 그룹만 반환합니다.
 */
import * as THREE from 'three';

export interface GnomonHandle {
  group: THREE.Group;
  poleMesh: THREE.Mesh;
  shadowMesh: THREE.Mesh;
}

/**
 * 비활성화된 gnomon — 빈 visible=false 그룹만 반환합니다.
 */
export function createGnomonShadow(): GnomonHandle {
  const group = new THREE.Group();
  group.name = 'gnomonShadowGroup';
  group.visible = false;

  // 더미 mesh (씬에 추가되지 않음)
  const dummy = new THREE.Mesh();
  dummy.visible = false;

  return { group, poleMesh: dummy, shadowMesh: dummy };
}

/**
 * No-op: gnomon 비활성화로 업데이트도 생략합니다.
 */
export function updateGnomonShadow(
  _handle: GnomonHandle,
  _sunAltitude: number,
  _sunAzimuth: number,
  _overcast: number = 0
): void {
  // intentionally empty
}
