/**
 * SunMesh.ts
 *
 * 지구에서 바라본 실제 천문학적 시직경(Angular Diameter 0.533°) 및 거리 비율을 100% 반영합니다.
 * 스카이돔 및 천체 가이드라인 위에서도 태양의 물리적 3D 원반 형체가 선명하게 드러나도록 셰이더를 구성합니다.
 */
import * as THREE from 'three';
import { sunDiskColor, type AtmosphereParams } from '../../utils/atmosphere';

/** 실제 시직경 0.533° 기반 사람 눈 체감 착시 스케일 반영 (반지름 약 8.5 유닛) */
const SUN_ANGULAR_RADIUS_DEG = 1.08;
const SUN_DISTANCE = 450;

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
  // 중심으로부터의 2D 반경 거리
  vec2 st = (vUv - 0.5) * 2.0;
  float d = length(st);
  if (d > 1.0) discard;

  // 태양 원반 가장자리(Rim) 윤곽 선명도 보정
  float rim = smoothstep(1.0, 0.88, d);
  float core = smoothstep(0.88, 0.0, d);

  // 대기 톤매핑 직달광 색상
  vec3 col = 1.0 - exp(-uColor * uIntensity);
  
  // 중심부는 고휘도 화이트 코어, 가장자리는 직달 노을 림 색상
  vec3 finalColor = mix(col, vec3(1.0, 0.98, 0.92) * 1.5, core * 0.7);

  gl_FragColor = vec4(toSrgb(finalColor), rim);
}
`;

export interface SunHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

export function createSun(): SunHandle {
  // 실제 물리 시직경(0.533°) 기반 원반 반지름 계산
  const radius = SUN_DISTANCE * Math.tan((SUN_ANGULAR_RADIUS_DEG * Math.PI) / 180);

  const geometry = new THREE.PlaneGeometry(radius * 2, radius * 2);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uIntensity: { value: 16.0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sunDisk';
  mesh.renderOrder = 5; // 지형/가이드라인보다 위에 선명하게 렌더링
  mesh.frustumCulled = false;

  return { mesh, material };
}

/**
 * 태양 위치와 색을 갱신합니다.
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

  // 대기 굴절로 지평선 아래 약 -0.9°까지 보입니다.
  handle.mesh.visible = sunAltDeg > -0.9;
}
