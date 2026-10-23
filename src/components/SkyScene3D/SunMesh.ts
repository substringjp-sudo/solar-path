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
/** §151 판 반지름 = 원반 반지름의 이 배수(둘레빛·눈부심 막이 들어갈 자리) */
const SUN_HALO_RADII = 10;

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
// §151 가시성(sunVisibility.ts): 둘레빛/원반 · 눈부심 계수(r⁻² 꼬리) · 경계 흐림 · 판 반지름(원반 반지름 배)
uniform float uAureole;
uniform float uGlare;
uniform float uBlur;
uniform float uHalo;
// §152 분광 모형: 최댓값 1 정규화 색(uColor)에 곱할 표시 단계 목표 밝기. 0 이면 옛 경로(uColor·uIntensity).
uniform float uPeak;
varying vec2 vUv;

void main() {
  // 판 가운데로부터 반경(0~1)과, 원반 반지름을 1 로 한 반경 r
  vec2 st = (vUv - 0.5) * 2.0;
  float d = length(st);
  if (d > 1.0) discard;
  float r = d * uHalo;

  // ── 구름에 의한 차폐 ────────────────────────────────────────────────────
  // uOcclusion = 태양 방향 구름 기둥의 투과율 T.
  //   T > 0.7  : 원반 그대로
  //   0.1~0.7  : 다중산란이 각을 퍼뜨려 흐리고 넓어짐 ("물먹은 해")
  //   T < 0.1  : 원반 소멸
  float T = clamp(uOcclusion, 0.0, 1.0);
  float spread = 1.0 - smoothstep(0.08, 0.75, T);
  // 경계 흐림: 구름 번짐 + 연무 앞산란(§151 uBlur)
  float soft = max(spread, uBlur);
  float edgeW = mix(0.04, 0.7, soft);
  float disc = 1.0 - smoothstep(1.0 - edgeW, 1.0 + edgeW * 0.6, r);

  // 둘레빛(앞산란 L ∝ P(θ) ≈ θ^-1.3)과 눈 안 산란 눈부심 막(Stiles–Holladay ∝ θ^-2) — 판 가장자리에서 0 으로.
  float fade = 1.0 - smoothstep(0.55, 1.0, d);
  float rr = max(r, 1.0);
  float aur = uAureole * pow(1.0 / rr, 1.3) * fade;
  float glare = uGlare / (rr * rr) * fade;
  float halo = aur + glare;

  // 중심부를 더 밝게 (주연감광의 반대 — 원반 중심이 가장 밝습니다)
  float core = smoothstep(0.85, 0.0, r);
  float total = disc * (1.0 + core * 0.7) + (1.0 - disc) * halo;
  vec3 radiance = uColor * uIntensity * total * T;
  if (uPeak > 0.0) {
    // §152 표시 단계(노출·순응·카메라 화이트밸런스)가 곱해져도 원반이 제 색을 지키도록 그 곱을 미리 나눕니다.
    // (화이트밸런스는 광원 색을 지우는데, 원반은 광원 그 자체라 지우면 낮은 해가 하얗게 떠 버립니다.)
    // 중심 가중은 분광 경로에서 작게(주연감광 약 1.1~1.2배) — 크게 두면 낮은 해의 초록 채널이 중심에서 먼저 밝아져 노래집니다.
    float totalP = disc * (1.0 + core * 0.15) + (1.0 - disc) * halo;
    vec3 hdrTarget = uColor * uPeak * totalP * T;
    radiance = hdrTarget / (DISP_EXPO * atm_adaptation(uSunAltDeg) * atm_whiteBalance(uSunAltDeg));
  }

  // 완전히 가려지면 아무것도 그리지 않습니다. 둘레 번짐은 원반이 보이는 만큼만(T 가 아주 작으면 사라짐).
  float vis = smoothstep(0.015, 0.12, T);
  float alpha = clamp(max(disc, min(halo * 3.0, 0.85)), 0.0, 1.0) * vis;
  if (alpha <= 0.002) discard;

  gl_FragColor = vec4(atm_displayCore(radiance, uSaturation, uSunAltDeg, false), alpha);
}
`;

export interface SunHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  dispose: () => void;
}

/**
 * 화면에 보이는 태양 반지름(화면 세로의 몇 분의 몇)을 정하면 그에 맞는 시야각 반지름과 배율을 돌려줍니다.
 * 앱 하늘은 세로 시야 60~130° 로 그려 실제 눈이 받는 각보다 훨씬 넓습니다 — 실제 크기(0.267°)로 그리면 폰 화면에서 지름 3~6px 점이라
 * 눈으로 보는 태양보다 훨씬 작습니다. 실제 크기에 머무는 건 시야가 좁을 때(≈ 30° 이하)뿐입니다.
 * 지평선 가까이(고도 < 6°)는 능선·바다에 가려지는 정확도가 중요해 실제 크기로 돌아옵니다(§141 이전 1.08° 시절 문제).
 */
export const SUN_SCREEN_RADIUS_FRAC = 0.009;
export function sunDisplayScale(fovDeg: number, placeAltDeg: number): { scale: number; radiusDeg: number } {
  const half = Math.tan((fovDeg * Math.PI) / 360);
  const wantDeg = (Math.atan(SUN_SCREEN_RADIUS_FRAC * 2 * half) * 180) / Math.PI;
  const k = Math.min(1, Math.max(0, (placeAltDeg - 1) / 5));
  const scale = 1 + (Math.max(1, wantDeg / SUN_ANGULAR_RADIUS_DEG) - 1) * k;
  return { scale, radiusDeg: SUN_ANGULAR_RADIUS_DEG * scale };
}

export function createSun(): SunHandle {
  // 실제 물리 시직경(0.533°) 기반 원반 반지름 계산
  const radius = SUN_DISTANCE * Math.tan((SUN_ANGULAR_RADIUS_DEG * Math.PI) / 180);

  const geometry = new THREE.PlaneGeometry(radius * 2 * SUN_HALO_RADII, radius * 2 * SUN_HALO_RADII);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...makeTuningUniforms(),
      uColor: { value: new THREE.Color(1, 1, 1) },
      uIntensity: { value: 16.0 },
      uSunAltDeg: { value: 30.0 },
      uSaturation: { value: 1.0 },
      uOcclusion: { value: 1.0 },
      uAureole: { value: 0 },
      uGlare: { value: 0 },
      uBlur: { value: 0 },
      uHalo: { value: SUN_HALO_RADII },
      uPeak: { value: 0 },
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
 *
 * `sunAltDeg` 는 **기하 고도**입니다(색·표시 노출이 씁니다 — `directBeamRGB` 가 굴절을 안에서 셉니다).
 * 원반을 놓는 자리는 `placeAltDeg`(보통 겉보기 고도, `getApparentAltitude`)입니다. 안 주면 기하 고도에
 * 놓습니다(하네스들의 예전 동작).
 */
export function updateSun(
  handle: SunHandle,
  sunAltDeg: number,
  sunAzDeg: number,
  params: AtmosphereParams,
  /** 태양 방향 구름 기둥의 투과율 (1 = 구름 없음) */
  occlusion: number = 1,
  placeAltDeg: number = sunAltDeg,
  /** 보이는 크기 배율(1 = 실제 0.267°). 화면이 눈에 주는 시야각보다 훨씬 넓게 그려질 때 키움. */
  displayScale: number = 1,
  /** §151 가시성(둘레빛·눈부심·경계 흐림). 없으면 예전처럼 깨끗한 원반. */
  vis?: { aureoleRel: number; glareGain: number; edgeBlur: number; rgb?: { r: number; g: number; b: number }; displayPeak?: number }
): void {
  const altRad = (placeAltDeg * Math.PI) / 180;
  const azRad = (sunAzDeg * Math.PI) / 180;

  handle.mesh.position.set(
    SUN_DISTANCE * Math.cos(altRad) * Math.sin(azRad),
    SUN_DISTANCE * Math.sin(altRad),
    -SUN_DISTANCE * Math.cos(altRad) * Math.cos(azRad)
  );
  handle.mesh.lookAt(0, 0, 0);
  handle.mesh.scale.setScalar(Math.max(1, displayScale));

  const c = sunDiskColor(sunAltDeg, params);
  const u = handle.material.uniforms;
  (u.uColor.value as THREE.Color).setRGB(c.r, c.g, c.b);
  // §152 분광 색(있으면 옛 β 모형 색 대신) — 최댓값 1 정규화 + 표시 목표 밝기
  if (vis?.rgb && vis.displayPeak) {
    (u.uColor.value as THREE.Color).setRGB(vis.rgb.r, vis.rgb.g, vis.rgb.b);
    u.uPeak.value = vis.displayPeak;
  } else u.uPeak.value = 0;
  u.uSunAltDeg.value = sunAltDeg;
  u.uOcclusion.value = Math.max(0, Math.min(1, occlusion));
  u.uAureole.value = vis ? vis.aureoleRel : 0;
  u.uGlare.value = vis ? vis.glareGain : 0;
  u.uBlur.value = vis ? vis.edgeBlur : 0;

  // 겉보기 위 끝이 해수면 수평선(높은 산 위에서도 약 −1°)보다 한참 아래면 끕니다. 그 사이는 땅·바다가 가립니다.
  handle.mesh.visible = placeAltDeg > -1.5;
}
