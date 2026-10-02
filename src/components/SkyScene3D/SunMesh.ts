/**
 * SunMesh.ts
 *
 * 지구에서 바라본 실제 천문학적 시직경(Angular Diameter 0.533°) 및 거리 비율을 100% 반영합니다.
 * 스카이돔 및 천체 가이드라인 위에서도 태양의 물리적 3D 원반 형체가 선명하게 드러나도록 셰이더를 구성합니다.
 */
import * as THREE from 'three';
import { sunDiskColor, ATMOSPHERE_GLSL, type AtmosphereParams, makeTuningUniforms } from '../../utils/atmosphere';

/**
 * 실제 각반지름 0.267°(시직경 0.533°).
 *
 * ⚠ (2026-10-02) 한동안 "사람 눈 체감 착시"라며 1.08°(실제의 4배)였습니다. 그러면 해가 능선 뒤로
 *   넘어간 뒤에도 원반 윗부분이 0.8° 넘게 능선 위로 남습니다 — 후쿠이 2026-10-02 17:31 사진에서는
 *   해가 능선 뒤로 숨었는데(실제 위 끝 1.39° 대 능선 1.25°) 앱에는 커다란 노란 반원이 능선 위에
 *   앉아 있었습니다("해를 제대로 가리지 못해"). 판정 sunrise-strip 도 같은 까닭을 적어 두었습니다.
 *   해 둘레의 번짐은 원반을 키워서가 아니라 하늘의 Mie 전방산란과 블룸이 냅니다.
 */
const SUN_ANGULAR_RADIUS_DEG = 0.267;
const SUN_DISTANCE = 490;

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
precision highp float;

${ATMOSPHERE_GLSL}

uniform vec3  uColor;      // 대기 감쇠를 거친 직달광 (linear)
uniform float uIntensity;  // 원반 밝기 배율
uniform float uSunAltDeg;  // 눈 순응 노출 — 하늘·구름과 공유
uniform float uSaturation;
uniform float uOcclusion; // 태양 방향 구름 기둥 투과율 (1 = 맑음)
varying vec2 vUv;

void main() {
  // 중심으로부터의 2D 반경 거리
  vec2 st = (vUv - 0.5) * 2.0;
  float d = length(st);
  if (d > 1.0) discard;

  // ── 구름에 의한 차폐 ────────────────────────────────────────────────────
  // uOcclusion = 태양 방향 구름 기둥의 투과율 T.
  //   T > 0.7  : 원반 그대로
  //   0.1~0.7  : 다중산란이 각을 퍼뜨려 흐리고 넓어짐 ("물먹은 해")
  //   T < 0.1  : 원반 소멸
  // 이전에는 SunMesh가 구름의 존재를 전혀 몰라서 8/8 난층운 뒤에서도
  // 태양이 그대로 타올랐습니다.
  float T = clamp(uOcclusion, 0.0, 1.0);

  // 퍼짐: 투과율이 낮을수록 원반 경계가 뭉개집니다.
  float spread = 1.0 - smoothstep(0.08, 0.75, T);
  float rimEdge = mix(0.88, 0.05, spread);
  float rim = smoothstep(1.0, rimEdge, d);
  float core = smoothstep(rimEdge, 0.0, d);

  // 중심부를 더 밝게 (주연감광의 반대 — 원반 중심이 가장 밝습니다)
  vec3 radiance = uColor * uIntensity * (1.0 + core * 0.7) * T;

  // 완전히 가려지면 아무것도 그리지 않습니다.
  float alpha = rim * smoothstep(0.015, 0.12, T);
  if (alpha <= 0.002) discard;

  // 하늘·구름과 같은 톤매핑. 태양만 다른 곡선을 쓰면 박명에 노출이 어긋나
  // 하늘은 밝은데 원반은 회색으로 죽는 식이 됩니다.
  // 태양 원반은 채도 바닥을 끕니다 — 사진에서도 원반은 하얗게 날아갑니다(atmosphere atm_chromaFloor).
  gl_FragColor = vec4(atm_displayCore(radiance, uSaturation, uSunAltDeg, false), alpha);
}
`;

export interface SunHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  dispose: () => void;
}

export function createSun(): SunHandle {
  // 실제 물리 시직경(0.533°) 기반 원반 반지름 계산
  const radius = SUN_DISTANCE * Math.tan((SUN_ANGULAR_RADIUS_DEG * Math.PI) / 180);

  const geometry = new THREE.PlaneGeometry(radius * 2, radius * 2);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...makeTuningUniforms(),
      uColor: { value: new THREE.Color(1, 1, 1) },
      uIntensity: { value: 16.0 },
      uSunAltDeg: { value: 30.0 },
      uSaturation: { value: 1.0 },
      uOcclusion: { value: 1.0 },
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
  // 지면(-0.5) 및 지형(-0.4)보다 **뒤**에 그려야 일출/일몰 시 땅 뒤에서 솟아오릅니다.
  // 스카이돔(-1)보다는 위에, 지면/지형 및 구름(1~2)보다는 뒤에 그립니다.
  mesh.renderOrder = -0.55;
  mesh.frustumCulled = false;

  return {
    mesh,
    material,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * 태양 위치와 색을 갱신합니다.
 */
export function updateSun(
  handle: SunHandle,
  sunAltDeg: number,
  sunAzDeg: number,
  params: AtmosphereParams,
  /** 태양 방향 구름 기둥의 투과율 (1 = 구름 없음) */
  occlusion: number = 1
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
  const u = handle.material.uniforms;
  (u.uColor.value as THREE.Color).setRGB(c.r, c.g, c.b);
  u.uSunAltDeg.value = sunAltDeg;
  u.uOcclusion.value = Math.max(0, Math.min(1, occlusion));

  // 대기 굴절로 지평선 아래 약 -0.9°까지 보입니다.
  handle.mesh.visible = sunAltDeg > -0.9;
}
