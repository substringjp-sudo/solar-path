/**
 * Skydome.ts
 *
 * 360° 물리 기반 하늘. 프래그먼트 셰이더에서 픽셀 단위로 대기 산란을 계산합니다.
 *
 * Why: 이전 구현은 정점 1,225개마다 CPU에서 회귀 근사(getApproximatedSkyColor)를
 * 돌려 vertex color로 칠했습니다. 그래서
 *   - 삼각형 하나가 7.5°×4°라 Gouraud 보간 밴딩이 보이고
 *   - 시간 슬라이더를 움직일 때마다 2만 번 넘는 곱셈이 JS에서 돌아 렉이 걸렸으며
 *   - 회귀 근사가 극단 구간에서 외삽하며 채도가 터졌습니다.
 *
 * 이제 색은 전부 GPU 프래그먼트에서 나오므로 정점 수를 줄여도 되고(48×24 → 32×16),
 * CPU는 uniform 몇 개만 갱신합니다. 밴딩은 디더로 잡습니다.
 *
 * 태양 주변 글로우는 별도 halo 메시가 아니라 Mie 위상함수에서 자연히 나옵니다.
 */
import * as THREE from 'three';
import { ATMOSPHERE_GLSL, type AtmosphereParams } from '../../utils/atmosphere';

const SPHERE_H_SEGMENTS = 32;
const SPHERE_V_SEGMENTS = 16;
const SPHERE_RADIUS = 500;

const VERT = `
varying vec3 vWorldDir;

void main() {
  // 구면 위치가 곧 시선 방향 (카메라는 원점에 있음)
  vWorldDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
precision highp float;

${ATMOSPHERE_GLSL}

uniform vec3  uSunDir;      // 정규화된 태양 방향 (월드)
uniform float uSunAltDeg;
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;
uniform float uOzoneDU;
uniform float uSaturation;  // 아트 디렉션용 채도 보정

varying vec3 vWorldDir;

// 그라데이션 밴딩 제거용 미세 디더 (±1/255 미만)
float dither(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec3 dir = normalize(vWorldDir);

  // 시선 고도각
  float viewElevDeg = degrees(asin(clamp(dir.y, -1.0, 1.0)));
  // 태양과의 각거리 코사인
  float cosGamma = clamp(dot(dir, uSunDir), -1.0, 1.0);

  vec3 col = atm_skyRadiance(
    viewElevDeg, cosGamma, uSunAltDeg,
    uBeta, uAngstrom, uElevScale, uOzoneDU
  );

  // 물리 복사휘도 → 화면 색 (노출 → ACES → 채도 → 대비 → sRGB)
  col = atm_display(col, uSaturation, uSunAltDeg);

  // 넓은 면적의 완만한 그라데이션에서 생기는 밴딩 제거
  col += (dither(gl_FragCoord.xy) - 0.5) / 255.0;

  gl_FragColor = vec4(col, 1.0);
}
`;

export interface SkydomeHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

/**
 * 스카이돔 생성. 색은 전부 프래그먼트에서 계산되므로 정점 수는 형상 유지에만 필요합니다.
 */
export function createSkydome(): SkydomeHandle {
  const geometry = new THREE.SphereGeometry(
    SPHERE_RADIUS,
    SPHERE_H_SEGMENTS,
    SPHERE_V_SEGMENTS
  );

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0, 0.5, -1).normalize() },
      uSunAltDeg: { value: 30 },
      uBeta: { value: 0.08 },
      uAngstrom: { value: 1.3 },
      uElevScale: { value: 1.0 },
      uOzoneDU: { value: 330 },
      uSaturation: { value: 1.0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    // 구 안쪽에서 보므로 뒷면을 그립니다.
    // (이전처럼 scale(-1,1,1)로 뒤집으면 씬이 좌우 반전되어 동/서가 바뀝니다.)
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'skydome';
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;

  return { mesh, material };
}

/**
 * 대기 상태와 태양 위치를 uniform으로 반영합니다.
 * 정점 버퍼를 건드리지 않으므로 매 프레임 호출해도 비용이 거의 없습니다.
 *
 * @param sunAltDeg 태양 고도 (도)
 * @param sunAzDeg  태양 방위각 (도, N=0, E=90)
 */
export function updateSkydome(
  handle: SkydomeHandle,
  sunAltDeg: number,
  sunAzDeg: number,
  params: AtmosphereParams,
  saturation: number = 1.0
): void {
  const u = handle.material.uniforms;

  const altRad = (sunAltDeg * Math.PI) / 180;
  const azRad = (sunAzDeg * Math.PI) / 180;
  // Three.js 좌표계: Y=up, -Z=North, X=East
  (u.uSunDir.value as THREE.Vector3).set(
    Math.cos(altRad) * Math.sin(azRad),
    Math.sin(altRad),
    -Math.cos(altRad) * Math.cos(azRad)
  );

  u.uSunAltDeg.value = sunAltDeg;
  u.uBeta.value = params.betaMie;
  u.uAngstrom.value = params.angstrom;
  u.uElevScale.value = params.elevScale;
  u.uOzoneDU.value = params.ozoneDU;
  u.uSaturation.value = saturation;
}
