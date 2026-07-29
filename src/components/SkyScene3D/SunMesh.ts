/**
 * SunMesh.ts
 *
 * Why: 태양 디스크 + 글로우 효과. directBeamRGB()로 정확한 태양 색상을 계산하고,
 * 추가 halo 원으로 일출/일몰의 특징적인 글로우를 표현합니다.
 * 쉐이딩 없이 flat 스타일.
 */
import * as THREE from 'three';
import { directBeamRGB, clamp01, type RGB } from '../../utils/sunsetPhysics';

const SUN_ANGULAR_RADIUS = 0.267; // 태양 시직경 ~0.534°, 반경 ~0.267°
const SUN_DISTANCE = 450; // 스카이돔(500) 안쪽

/**
 * 태양 디스크 + 글로우 halo를 포함하는 Group을 생성합니다.
 */
export function createSunGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sunGroup';

  // 태양 디스크 (실제 크기)
  const sunGeometry = new THREE.CircleGeometry(SUN_DISTANCE * Math.tan(SUN_ANGULAR_RADIUS * Math.PI / 180), 32);
  const sunMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: false,
    depthWrite: false,
  });
  const sunDisk = new THREE.Mesh(sunGeometry, sunMaterial);
  sunDisk.name = 'sunDisk';
  group.add(sunDisk);

  // 글로우 halo (투명한 큰 원)
  const haloGeometry = new THREE.CircleGeometry(SUN_DISTANCE * Math.tan(3 * Math.PI / 180), 48);
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: 0xffaa44,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(haloGeometry, haloMaterial);
  halo.name = 'sunHalo';
  halo.position.z = -0.1; // 디스크 뒤에 위치
  group.add(halo);

  return group;
}

/**
 * sRGB → linear 변환 (directBeamRGB의 결과를 Three.js Color에 맞게)
 */
function linearToSrgb(c: number): number {
  const x = clamp01(c);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/**
 * 태양의 위치와 색상을 업데이트합니다.
 *
 * @param sunGroup createSunGroup()으로 생성된 그룹
 * @param sunAltDeg 태양 고도 (도)
 * @param sunAzDeg 태양 방위각 (도, N=0)
 * @param observerElevM 관측자 고도 (m)
 * @param latitude 위도
 * @param aerosolBeta 에어로졸 β값
 * @param dayOfYear 연중 일수
 */
export function updateSunPosition(
  sunGroup: THREE.Group,
  sunAltDeg: number,
  sunAzDeg: number,
  observerElevM: number = 0,
  latitude: number = 37.5,
  aerosolBeta: number = 0.08,
  dayOfYear: number = 172
): void {
  // 태양 고도/방위 → 3D 위치 변환
  const altRad = (sunAltDeg * Math.PI) / 180;
  const azRad = (sunAzDeg * Math.PI) / 180;

  // Three.js 좌표계: Y=up, -Z=North → sunAz=0=North, 90=East
  const x = SUN_DISTANCE * Math.cos(altRad) * Math.sin(azRad);
  const y = SUN_DISTANCE * Math.sin(altRad);
  const z = -SUN_DISTANCE * Math.cos(altRad) * Math.cos(azRad);

  sunGroup.position.set(x, y, z);

  // 항상 카메라(원점)를 향하도록
  sunGroup.lookAt(0, 0, 0);

  // 태양 색상 계산 (물리 기반)
  const beamRGB: RGB = directBeamRGB(sunAltDeg, observerElevM, latitude, aerosolBeta, dayOfYear);
  
  // 디스크 색상 업데이트
  const sunDisk = sunGroup.getObjectByName('sunDisk') as THREE.Mesh;
  if (sunDisk) {
    const mat = sunDisk.material as THREE.MeshBasicMaterial;
    mat.color.setRGB(linearToSrgb(beamRGB.r), linearToSrgb(beamRGB.g), linearToSrgb(beamRGB.b));
    
    // 지평선 아래 → 숨김
    sunDisk.visible = sunAltDeg > -2;
  }

  // 글로우 halo 색상 및 투명도
  const halo = sunGroup.getObjectByName('sunHalo') as THREE.Mesh;
  if (halo) {
    const mat = halo.material as THREE.MeshBasicMaterial;
    // 낮은 고도에서 더 강한 글로우
    const glowIntensity = sunAltDeg < 10
      ? clamp01(0.15 + (10 - sunAltDeg) * 0.04)
      : 0.08;
    mat.opacity = glowIntensity;
    mat.color.setRGB(
      linearToSrgb(beamRGB.r * 0.9),
      linearToSrgb(beamRGB.g * 0.7),
      linearToSrgb(beamRGB.b * 0.4)
    );
    halo.visible = sunAltDeg > -6;
  }
}
