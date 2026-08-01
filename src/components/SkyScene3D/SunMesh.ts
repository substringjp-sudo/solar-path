/**
 * SunMesh.ts
 *
 * 태양 원반. 색은 하늘과 **같은 대기 파라미터**로 감쇠한 직달광에서 나옵니다.
 *
 * Why: 이전 구현은 3° 반경 단색 원에 AdditiveBlending을 얹어 halo를 흉내냈습니다.
 * 가장자리가 딱 잘린 밝은 원반이 되어 글로우로 보이지 않았고, 하늘색과 별개로
 * 계산되어 노을 때 색이 따로 놀았습니다.
 *
 * 이제 halo 메시가 없습니다. 태양 주변 글로우는 스카이돔 셰이더의 Mie 위상함수에서
 * 자연히 나옵니다(전방산란 피크). 물리적으로도 그게 맞고, 하늘과 태양이 항상
 * 같은 혼탁도를 공유하므로 미세먼지가 많으면 글로우가 넓게 퍼지는 것까지 재현됩니다.
 */
import * as THREE from 'three';
import { sunDiskColor, type AtmosphereParams } from '../../utils/atmosphere';

/** 태양 시직경 약 0.53° → 반경 0.267° */
const SUN_ANGULAR_RADIUS_DEG = 0.267;
const SUN_DISTANCE = 450;
/** 원반이 너무 작아 안 보이지 않도록 살짝 키웁니다(시각적 가독성). */
const VISUAL_SCALE = 2.4;

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform vec3  uColor;      // 대기 감쇠를 거친 직달광 (linear)
uniform float uIntensity;  // 원반 밝기 배율
varying vec2 vUv;

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  // 원 바깥은 버리고, 가장자리는 한 픽셀 정도만 부드럽게 (대기 번짐은 하늘이 담당)
  float d = length(vUv - 0.5) * 2.0;
  float alpha = 1.0 - smoothstep(0.86, 1.0, d);
  if (alpha <= 0.001) discard;

  // 하늘과 같은 톤매핑을 써야 원반이 하늘에서 떠 보이지 않습니다.
  vec3 col = 1.0 - exp(-uColor * uIntensity);

  gl_FragColor = vec4(toSrgb(col), alpha);
}
`;

export interface SunHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

export function createSun(): SunHandle {
  const radius =
    SUN_DISTANCE * Math.tan((SUN_ANGULAR_RADIUS_DEG * Math.PI) / 180) * VISUAL_SCALE;

  const geometry = new THREE.PlaneGeometry(radius * 2, radius * 2);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uIntensity: { value: 14.0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sunDisk';
  mesh.renderOrder = 0; // 하늘(-1) 위, 구름(1) 아래
  mesh.frustumCulled = false;

  return { mesh, material };
}

/**
 * 태양 위치와 색을 갱신합니다.
 * 색은 sunDiskColor() → directBeamRGB()로, 하늘과 같은 β·Ångström을 씁니다.
 */
export function updateSun(
  handle: SunHandle,
  sunAltDeg: number,
  sunAzDeg: number,
  params: AtmosphereParams
): void {
  const altRad = (sunAltDeg * Math.PI) / 180;
  const azRad = (sunAzDeg * Math.PI) / 180;

  handle.mesh.position.set(
    SUN_DISTANCE * Math.cos(altRad) * Math.sin(azRad),
    SUN_DISTANCE * Math.sin(altRad),
    -SUN_DISTANCE * Math.cos(altRad) * Math.cos(azRad)
  );
  handle.mesh.lookAt(0, 0, 0);

  const c = sunDiskColor(sunAltDeg, params);
  (handle.material.uniforms.uColor.value as THREE.Color).setRGB(c.r, c.g, c.b);

  // 대기 굴절로 지평선 아래 약 -0.6°까지 보입니다.
  handle.mesh.visible = sunAltDeg > -0.9;
}
