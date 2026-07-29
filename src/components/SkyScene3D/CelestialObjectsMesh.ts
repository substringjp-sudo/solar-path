/**
 * CelestialObjectsMesh.ts
 * 
 * 주요 항성(Stars), 은하수(Milky Way), 5대 행성(Planets)을 3D 공간 상에 렌더링하는 유틸리티.
 */
import * as THREE from 'three';
import { BRIGHT_STARS_DATA } from '../../utils/celestialStarsData';
import { PLANETS_METADATA, getPlanetEquatorialCoord } from '../../utils/celestialPlanets';
import { equatorialToHorizontal } from '../../utils/celestialCoords';
import { MILKY_WAY_EQUATOR_NODES } from '../../utils/celestialMilkyWayData';

const CELESTIAL_SPHERE_RADIUS = 470; // 스카이돔(500) 내부

export interface CelestialObjectsGroup {
  starsPoints: THREE.Points;
  planetsGroup: THREE.Group;
  milkyWayPoints: THREE.Points;
  containerGroup: THREE.Group;
}

/**
 * 별, 행성, 은하수를 렌더링하기 위한 3D 객체 그룹 생성
 */
export function createCelestialObjectsGroup(): CelestialObjectsGroup {
  const containerGroup = new THREE.Group();
  containerGroup.name = 'celestialObjectsGroup';

  // 1. 주요 항성들 (THREE.Points)
  const starCount = BRIGHT_STARS_DATA.length;
  const starPositions = new Float32Array(starCount * 3);
  const starColors = new Float32Array(starCount * 3);

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

  const starMat = new THREE.PointsMaterial({
    size: 4.0,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const starsPoints = new THREE.Points(starGeo, starMat);
  starsPoints.name = 'starsPoints';
  containerGroup.add(starsPoints);

  // 2. 은하수 파티클 (Milky Way Points)
  const mwCount = MILKY_WAY_EQUATOR_NODES.length;
  const mwPositions = new Float32Array(mwCount * 3);
  const mwColors = new Float32Array(mwCount * 3);

  const mwGeo = new THREE.BufferGeometry();
  mwGeo.setAttribute('position', new THREE.BufferAttribute(mwPositions, 3));
  mwGeo.setAttribute('color', new THREE.BufferAttribute(mwColors, 3));

  const mwMat = new THREE.PointsMaterial({
    size: 6.0,
    vertexColors: true,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const milkyWayPoints = new THREE.Points(mwGeo, mwMat);
  milkyWayPoints.name = 'milkyWayPoints';
  containerGroup.add(milkyWayPoints);

  // 3. 행성들 그룹 (수성, 금성, 화성, 목성, 토성)
  const planetsGroup = new THREE.Group();
  planetsGroup.name = 'planetsGroup';

  Object.values(PLANETS_METADATA).forEach(p => {
    const pGeo = new THREE.CircleGeometry(3.5, 16);
    let pColor = 0xffffff;
    if (p.key === 'venus') pColor = 0xffea88;
    else if (p.key === 'mars') pColor = 0xff6644;
    else if (p.key === 'jupiter') pColor = 0xffddaa;
    else if (p.key === 'saturn') pColor = 0xeecc88;

    const pMat = new THREE.MeshBasicMaterial({ color: pColor, depthWrite: false });
    const pMesh = new THREE.Mesh(pGeo, pMat);
    pMesh.name = `planet_${p.key}`;
    planetsGroup.add(pMesh);
  });
  containerGroup.add(planetsGroup);

  return {
    starsPoints,
    planetsGroup,
    milkyWayPoints,
    containerGroup,
  };
}

/**
 * 실시간 별, 행성, 은하수의 3D 위치 및 밝기 업데이트
 */
export function updateCelestialObjects(
  objects: CelestialObjectsGroup,
  date: Date,
  lat: number,
  lng: number,
  sunAltitude: number
): void {
  const dayFade = Math.max(0, 1.0 - (sunAltitude + 4) / 10);
  const isNight = sunAltitude < -2;

  // 1. 별(Stars) 좌표 업데이트
  const starGeo = objects.starsPoints.geometry as THREE.BufferGeometry;
  const starPosAttr = starGeo.attributes.position as THREE.BufferAttribute;
  const starColAttr = starGeo.attributes.color as THREE.BufferAttribute;

  BRIGHT_STARS_DATA.forEach((star, idx) => {
    const hor = equatorialToHorizontal({ raHours: star.raHours, decDeg: star.decDeg }, lat, lng, date);
    const altRad = (hor.altitudeDeg * Math.PI) / 180;
    const azRad = (hor.azimuthDeg * Math.PI) / 180;

    const x = CELESTIAL_SPHERE_RADIUS * Math.cos(altRad) * Math.sin(azRad);
    const y = CELESTIAL_SPHERE_RADIUS * Math.sin(altRad);
    const z = -CELESTIAL_SPHERE_RADIUS * Math.cos(altRad) * Math.cos(azRad);

    starPosAttr.setXYZ(idx, x, y, z);

    const magFactor = Math.max(0.15, 1.0 - (star.magnitude + 1.5) / 5.0);
    const opacity = hor.altitudeDeg > 0 ? magFactor * dayFade : 0;

    starColAttr.setXYZ(idx, opacity, opacity, opacity * 1.1);
  });
  starPosAttr.needsUpdate = true;
  starColAttr.needsUpdate = true;
  objects.starsPoints.visible = dayFade > 0.05;

  // 2. 은하수(Milky Way) 좌표 업데이트
  const mwGeo = objects.milkyWayPoints.geometry as THREE.BufferGeometry;
  const mwPosAttr = mwGeo.attributes.position as THREE.BufferAttribute;
  const mwColAttr = mwGeo.attributes.color as THREE.BufferAttribute;

  MILKY_WAY_EQUATOR_NODES.forEach((node, idx) => {
    const hor = equatorialToHorizontal({ raHours: node.raHours, decDeg: node.decDeg }, lat, lng, date);
    const altRad = (hor.altitudeDeg * Math.PI) / 180;
    const azRad = (hor.azimuthDeg * Math.PI) / 180;

    const x = CELESTIAL_SPHERE_RADIUS * Math.cos(altRad) * Math.sin(azRad);
    const y = CELESTIAL_SPHERE_RADIUS * Math.sin(altRad);
    const z = -CELESTIAL_SPHERE_RADIUS * Math.cos(altRad) * Math.cos(azRad);

    mwPosAttr.setXYZ(idx, x, y, z);

    const opacity = hor.altitudeDeg > 0 ? 0.4 * dayFade : 0;
    mwColAttr.setXYZ(idx, opacity * 0.7, opacity * 0.8, opacity);
  });
  mwPosAttr.needsUpdate = true;
  mwColAttr.needsUpdate = true;
  objects.milkyWayPoints.visible = isNight;

  // 3. 행성들(Planets) 좌표 업데이트
  Object.values(PLANETS_METADATA).forEach(p => {
    const pMesh = objects.planetsGroup.getObjectByName(`planet_${p.key}`) as THREE.Mesh;
    if (pMesh) {
      const eq = getPlanetEquatorialCoord(p.key, date);
      const hor = equatorialToHorizontal(eq, lat, lng, date);

      const altRad = (hor.altitudeDeg * Math.PI) / 180;
      const azRad = (hor.azimuthDeg * Math.PI) / 180;

      const x = CELESTIAL_SPHERE_RADIUS * Math.cos(altRad) * Math.sin(azRad);
      const y = CELESTIAL_SPHERE_RADIUS * Math.sin(altRad);
      const z = -CELESTIAL_SPHERE_RADIUS * Math.cos(altRad) * Math.cos(azRad);

      pMesh.position.set(x, y, z);
      pMesh.lookAt(0, 0, 0);

      pMesh.visible = hor.altitudeDeg > -2 && sunAltitude < 15;
    }
  });
}
