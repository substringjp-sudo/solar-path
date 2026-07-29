/**
 * Skydome.ts
 * 
 * Why: 기존 sunsetPhysics.ts의 skyColorAtDirection()이 임의의 하늘 방향에 대한
 * 색상을 이미 물리적으로 계산하므로, 이를 구체 내면의 vertex color로 매핑하면
 * 360° 전방향 물리 기반 하늘을 구현할 수 있음.
 *
 * 쉐이딩 없이 vertex color만 사용하는 flat 스타일.
 */
import * as THREE from 'three';
import { getApproximatedSkyColor, clamp01, type RGB } from '../../utils/sunsetPhysics';

const SPHERE_H_SEGMENTS = 48; // 수평 분할 (방위각)
const SPHERE_V_SEGMENTS = 24; // 수직 분할 (고도)
const SPHERE_RADIUS = 500;

/**
 * 스카이돔 mesh 생성 (구체 내면)
 * MeshBasicMaterial + vertexColors = 쉐이딩 없이 물리 기반 색상 직접 표시
 */
export function createSkydome(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(
    SPHERE_RADIUS,
    SPHERE_H_SEGMENTS,
    SPHERE_V_SEGMENTS,
    0,               // phiStart
    Math.PI * 2,     // phiLength (full 360°)
    0,               // thetaStart
    Math.PI * 0.55   // thetaLength — 지평선 약간 아래까지만 (하반구 불필요)
  );

  // 내면이 보이도록 법선 반전
  geometry.scale(-1, 1, 1);

  // vertex color 초기화 (검은색)
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.FrontSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'skydome';
  mesh.renderOrder = -1; // 항상 뒤에 그려짐
  
  return mesh;
}

/**
 * sRGB → linear 역변환 (sunsetPhysics가 linear light로 반환하므로
 * Three.js의 sRGB color space에 맞춰 변환)
 */
function linearToSrgb(c: number): number {
  const x = clamp01(c);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/**
 * 스카이돔의 vertex color를 현재 태양 위치와 대기 조건으로 업데이트합니다.
 * geometry 재생성 없이 color attribute만 갱신 → 매 프레임 호출 가능.
 *
 * @param mesh createSkydome()으로 생성된 mesh
 * @param sunAltDeg 태양 고도 (도)
 * @param sunAzDeg 태양 방위각 (도, N=0)
 * @param beta 에어로졸 터비디티
 * @param pathClarity 광선 투과율 (0=흐림, 1=맑음)
 */
export function updateSkydomeColors(
  mesh: THREE.Mesh,
  sunAltDeg: number,
  sunAzDeg: number,
  beta: number,
  pathClarity: number
): void {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const posAttr = geometry.attributes.position;
  const colorAttr = geometry.attributes.color as THREE.BufferAttribute;
  const count = posAttr.count;

  for (let i = 0; i < count; i++) {
    // vertex 위치에서 방향 벡터 계산 (구체 표면 → 방위/고도)
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);

    // Three.js 좌표계: Y=up, Z=forward(South), X=right(East)
    // 고도: atan2(y, √(x²+z²))
    const hDist = Math.sqrt(x * x + z * z);
    const elevDeg = Math.atan2(y, hDist) * (180 / Math.PI);
    
    // 방위각: atan2(x, -z) — North=+Z에서 반전
    // 구체가 scale(-1,1,1)로 뒤집혀 있으므로 x 부호 반전
    const azDeg = ((Math.atan2(-x, -z) * (180 / Math.PI)) + 360) % 360;

    // 태양과의 각거리(γ) 계산
    const thetaRad = (Math.max(elevDeg, 0.05) * Math.PI) / 180;
    const sunAltRad = (sunAltDeg * Math.PI) / 180;
    const azDiffRad = ((azDeg - sunAzDeg) * Math.PI) / 180;
    
    const cosGamma = Math.sin(thetaRad) * Math.sin(sunAltRad) +
                     Math.cos(thetaRad) * Math.cos(sunAltRad) * Math.cos(azDiffRad);
    const cosGammaClamped = Math.max(-1.0, Math.min(1.0, cosGamma));
    const gammaDeg = Math.acos(cosGammaClamped) * (180 / Math.PI);

    // 물리 기반 색상 계산 (기존 엔진 그대로 활용)
    const rgb: RGB = getApproximatedSkyColor(
      Math.max(elevDeg, 0.05),
      gammaDeg,
      sunAltDeg,
      beta,
      pathClarity
    );

    // linear → sRGB 변환 후 버퍼에 기록
    colorAttr.setXYZ(i, linearToSrgb(rgb.r), linearToSrgb(rgb.g), linearToSrgb(rgb.b));
  }

  colorAttr.needsUpdate = true;
}
