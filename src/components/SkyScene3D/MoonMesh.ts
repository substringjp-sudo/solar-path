/**
 * MoonMesh.ts
 * 
 * 3D 스카이씬 상에 달 디스크 및 위상(Phase)을 렌더링하는 메쉬 유틸리티.
 */
import * as THREE from 'three';
import SunCalc from 'suncalc';
import { getMoonPosition } from '../../utils/celestial';

const MOON_DISTANCE = 450; // 스카이돔(500) 내부
const MOON_ANGULAR_RADIUS = 0.25; // 달 시직경 약 0.5° (반지름 0.25°)

/**
 * 달 메쉬 그룹 생성 (달 디스크 + 위상 차광 오버레이)
 */
export function createMoonGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'moonGroup';

  // 1. 달 기본 표면 디스크 (밝은 웜화이트 / 에쉬그레이)
  const radius = MOON_DISTANCE * Math.tan((MOON_ANGULAR_RADIUS * Math.PI) / 180);
  const moonGeo = new THREE.CircleGeometry(radius, 32);
  const moonMat = new THREE.MeshBasicMaterial({
    color: 0xdedede,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const moonDisk = new THREE.Mesh(moonGeo, moonMat);
  moonDisk.name = 'moonDisk';
  group.add(moonDisk);

  // 2. 달 위상 차광용 섀도우 오버레이 디스크
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x050814,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const moonShadow = new THREE.Mesh(moonGeo, shadowMat);
  moonShadow.name = 'moonShadow';
  moonShadow.position.z = 0.05; // 디스크 약간 앞
  group.add(moonShadow);

  return group;
}

/**
 * 실시간 달 위치 및 위상(Illumination) 업데이트
 */
export function updateMoonPosition(
  moonGroup: THREE.Group,
  date: Date,
  lat: number,
  lng: number
): void {
  const moonPos = getMoonPosition(date, lat, lng);
  const moonIllum = SunCalc.getMoonIllumination(date);

  const altRad = (moonPos.altitude * Math.PI) / 180;
  const azRad = (moonPos.azimuth * Math.PI) / 180;

  // 3D 구면 좌표계 변환 (Y=up, -Z=North, X=East)
  const x = MOON_DISTANCE * Math.cos(altRad) * Math.sin(azRad);
  const y = MOON_DISTANCE * Math.sin(altRad);
  const z = -MOON_DISTANCE * Math.cos(altRad) * Math.cos(azRad);

  moonGroup.position.set(x, y, z);
  moonGroup.lookAt(0, 0, 0);

  // 달 고도가 -5도 이하이면 가림
  moonGroup.visible = moonPos.altitude > -5;

  // 위상 반영 (fraction 0=신월, 0.5=상현/하현, 1.0=보름달)
  const moonShadow = moonGroup.getObjectByName('moonShadow') as THREE.Mesh;
  if (moonShadow) {
    const illum = moonIllum.fraction; // 0 ~ 1
    // 위상에 따라 섀도우 오버레이의 scaleX 또는 position 오프셋 조절
    const mat = moonShadow.material as THREE.MeshBasicMaterial;
    mat.opacity = Math.max(0, 0.9 - illum * 0.9);
    
    // 달의 각도(angle)에 맞춰 차광 오프셋 이동
    const shadowXOffset = (0.5 - illum) * 0.8;
    moonShadow.position.x = shadowXOffset;
  }
}
