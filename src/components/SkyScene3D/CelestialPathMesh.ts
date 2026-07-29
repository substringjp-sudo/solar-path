/**
 * CelestialPathMesh.ts
 * 
 * 하루 24시간 동안의 태양 및 달의 이동 궤적(Arc)과
 * 태양 고도/방위각에 따른 관측자 바닥 그림자(Ground Shadow)를 3D로 렌더링하는 유틸리티.
 */
import * as THREE from 'three';
import { getSunPath, getMoonPath } from '../../utils/celestial';

const PATH_RADIUS = 440; // 스카이돔(500) 내부

export interface CelestialPathsGroup {
  sunPathLine: THREE.Line;
  moonPathLine: THREE.Line;
  groundShadowMesh: THREE.Mesh;
  containerGroup: THREE.Group;
}

/**
 * 궤적 Line 및 지표면 그림자 3D 메쉬 생성
 */
export function createCelestialPathsGroup(): CelestialPathsGroup {
  const containerGroup = new THREE.Group();
  containerGroup.name = 'celestialPathsGroup';

  // 1. 태양 궤적 (황금빛 가이드 궤적)
  const sunPathGeo = new THREE.BufferGeometry();
  const sunPathMat = new THREE.LineBasicMaterial({
    color: 0xffaa00,
    transparent: true,
    opacity: 0.6,
    linewidth: 2,
  });
  const sunPathLine = new THREE.Line(sunPathGeo, sunPathMat);
  sunPathLine.name = 'sunPathLine';
  containerGroup.add(sunPathLine);

  // 2. 달 궤적 (은백색/푸른빛 가이드 궤적)
  const moonPathGeo = new THREE.BufferGeometry();
  const moonPathMat = new THREE.LineBasicMaterial({
    color: 0x88ccff,
    transparent: true,
    opacity: 0.45,
    linewidth: 1.5,
  });
  const moonPathLine = new THREE.Line(moonPathGeo, moonPathMat);
  moonPathLine.name = 'moonPathLine';
  containerGroup.add(moonPathLine);

  // 3. 관측자 기준 지표면 그림자 (Ground Shadow)
  // 관측자 반대 방향으로 늘어나는 타원형 바닥 그림자
  const shadowGeo = new THREE.PlaneGeometry(12, 40);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x020308,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const groundShadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  groundShadowMesh.name = 'groundShadowMesh';
  groundShadowMesh.rotation.x = -Math.PI / 2; // 바닥에 평평하게 눕힘
  groundShadowMesh.position.y = -1; // 지평선 약간 바닥
  containerGroup.add(groundShadowMesh);

  return {
    sunPathLine,
    moonPathLine,
    groundShadowMesh,
    containerGroup,
  };
}

/**
 * 궤적 Arc 및 지표면 그림자 실시간 업데이트
 */
export function updateCelestialPaths(
  paths: CelestialPathsGroup,
  date: Date,
  lat: number,
  lng: number,
  sunAltitude: number,
  sunAzimuth: number
): void {
  // 1. 태양 궤적 (Sun Path Arc)
  const sunPoints = getSunPath(date, lat, lng);
  const sunPosArray = new Float32Array(sunPoints.length * 3);
  sunPoints.forEach((pt, i) => {
    const altRad = (pt.altitude * Math.PI) / 180;
    const azRad = (pt.azimuth * Math.PI) / 180;
    sunPosArray[i * 3] = PATH_RADIUS * Math.cos(altRad) * Math.sin(azRad);
    sunPosArray[i * 3 + 1] = PATH_RADIUS * Math.sin(altRad);
    sunPosArray[i * 3 + 2] = -PATH_RADIUS * Math.cos(altRad) * Math.cos(azRad);
  });
  paths.sunPathLine.geometry.setAttribute('position', new THREE.BufferAttribute(sunPosArray, 3));
  paths.sunPathLine.geometry.attributes.position.needsUpdate = true;

  // 2. 달 궤적 (Moon Path Arc)
  const moonPoints = getMoonPath(date, lat, lng);
  const moonPosArray = new Float32Array(moonPoints.length * 3);
  moonPoints.forEach((pt, i) => {
    const altRad = (pt.altitude * Math.PI) / 180;
    const azRad = (pt.azimuth * Math.PI) / 180;
    moonPosArray[i * 3] = PATH_RADIUS * Math.cos(altRad) * Math.sin(azRad);
    moonPosArray[i * 3 + 1] = PATH_RADIUS * Math.sin(altRad);
    moonPosArray[i * 3 + 2] = -PATH_RADIUS * Math.cos(altRad) * Math.cos(azRad);
  });
  paths.moonPathLine.geometry.setAttribute('position', new THREE.BufferAttribute(moonPosArray, 3));
  paths.moonPathLine.geometry.attributes.position.needsUpdate = true;

  // 3. 관측자 그림자 (Ground Shadow)
  // 태양이 지평선 위에 있을 때 (sunAltitude > -1.0) 그림자 투영
  if (sunAltitude > -1.0) {
    paths.groundShadowMesh.visible = true;
    
    // 그림자 연장 길이: 태양 고도가 낮을수록 그림자가 길어짐
    const shadowLength = Math.max(10, Math.min(120, 25 / Math.tan(Math.max(0.08, (sunAltitude * Math.PI) / 180))));
    paths.groundShadowMesh.scale.set(1.0, shadowLength / 40, 1.0);

    // 그림자 방향: 태양 방위각(sunAzimuth)의 정확히 반대 방향(+180°)
    const shadowAzRad = ((sunAzimuth + 180) * Math.PI) / 180;
    const offsetX = (shadowLength / 2) * Math.sin(shadowAzRad);
    const offsetZ = -(shadowLength / 2) * Math.cos(shadowAzRad);

    paths.groundShadowMesh.position.set(offsetX, -1.2, offsetZ);
    paths.groundShadowMesh.rotation.z = -shadowAzRad;

    // 태양 고도에 따른 그림자 흐려짐
    const shadowMat = paths.groundShadowMesh.material as THREE.MeshBasicMaterial;
    shadowMat.opacity = Math.max(0.15, Math.min(0.65, 0.7 - sunAltitude / 90));
  } else {
    paths.groundShadowMesh.visible = false;
  }
}
