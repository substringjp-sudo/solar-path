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
varying vec4 vClip;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.xyz += cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
  vClip = gl_Position;
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
uniform float uRotRad;
uniform float uZoomDetail;
// 볼륨 하늘이 켜져 있으면 그 텍스처(볼륨 하늘 renderToTexture)의 알파 = 화소마다 구름(과 지형) 불투명도.
// 해 판은 볼륨 하늘을 깐 **뒤** 그 위에 그려지므로, 이것으로 화소마다 가리지 않으면 해가 구름 앞에 뜹니다.
uniform sampler2D uCloudAlphaTex;
uniform float uCloudAlphaOn;
varying vec2 vUv;
varying vec4 vClip;

float sunHash3(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float sunNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = sunHash3(i);
  float n100 = sunHash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = sunHash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = sunHash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = sunHash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = sunHash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = sunHash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = sunHash3(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

float sunSpotMask(vec3 p, vec3 center, float rad) {
  float d = length(p - center) / rad;
  if (d > 2.2) return 0.0;
  vec3 t = normalize(cross(abs(center.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), center));
  vec3 b = cross(center, t);
  float ang = atan(dot(p - center, b), dot(p - center, t));
  float fibril = 0.86 + 0.24 * sin(ang * 14.0 + sunNoise3(p * 42.0) * 3.0);
  float dw = d * fibril;
  float umbra = 1.0 - smoothstep(0.28, 0.56, dw);
  float penumbra = (1.0 - smoothstep(0.65, 1.25, dw)) * 0.52;
  return clamp(max(umbra * 0.86, penumbra), 0.0, 0.86);
}

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
  if (uCloudAlphaOn > 0.5) {
    // 이 화소 시선의 구름 불투명도 → 투과율. 하늘 전체 하나의 값(1 − 운량) 대신 해 앞에 실제로 있는 구름만 가립니다.
    vec2 suv = vClip.xy / vClip.w * 0.5 + 0.5;
    T = clamp(1.0 - texture2D(uCloudAlphaTex, suv).a, 0.0, 1.0);
  }
  float spread = 1.0 - smoothstep(0.08, 0.75, T);
  // 경계 흐림: 구름 번짐 + 연무 앞산란(§151 uBlur)
  float soft = max(spread, uBlur);
  float edgeW = mix(0.04, 0.7, soft);
  float disc = 1.0 - smoothstep(1.0 - edgeW, 1.0 + edgeW * 0.6, r);

  // 둘레빛과 눈부심 (매끄러운 방사형 감쇠)
  // 판 가장자리(d=1)에서 부드럽게 0으로 수렴하는 2차 연속 감쇠 (0.55 잘림 단차 제거)
  float fade = clamp(1.0 - d * d, 0.0, 1.0);
  fade = fade * fade;

  // r=1(원반 경계)에서 과도하게 튀지 않도록 스케일 조정 (연속성 보장)
  // 중심(r=0)부터 원반 바깥(r>1)까지 연속적으로 감쇠
  float aur = (uAureole * 0.35) * pow(1.0 / (r * 0.8 + 0.2), 1.25) * fade;
  float glare = (uGlare * 0.15) / (r * r + 1.0) * fade;
  float halo = aur + glare;

  // 중심부를 더 밝게 (원반 중심 주연감광 + 고배율 줌 시 쌀알무늬·백반·흑점)
  float core = smoothstep(1.0, 0.0, r);
  float discRadiance = 1.0 + core * 0.4;
  vec3 surfaceTint = vec3(1.0);
  float spotDark = 1.0;

  if (r < 1.0 && uZoomDetail > 0.005) {
    float mu = sqrt(max(0.0, 1.0 - r * r));
    // 1) 물리적 주연감광 (Limb Darkening: 중심 1.0 -> 가장자리 ~0.42) + 가장자리 적색화
    float limbDark = 1.0 - 0.56 * (1.0 - mu) - 0.18 * (1.0 - mu) * (1.0 - mu);
    surfaceTint *= mix(vec3(1.0), vec3(1.04, 0.82 - 0.14 * (1.0 - mu), 0.58 - 0.18 * (1.0 - mu)), uZoomDetail * 0.85);

    // 2) 태양 자전(약 27.28일 주기) 적용된 광구 3D 단위벡터
    float cs = cos(uRotRad), sn = sin(uRotRad);
    vec3 sBase = vec3(st.x * uHalo, st.y * uHalo, mu);
    vec3 sRot = vec3(sBase.x * cs + sBase.z * sn, sBase.y, -sBase.x * sn + sBase.z * cs);

    // 3) 쌀알무늬 (Solar Granulation) + 가장자리 백반 (Faculae)
    float g1 = 1.0 - abs(sunNoise3(sRot * 36.0) - 0.5) * 2.0;
    float g2 = 1.0 - abs(sunNoise3(sRot * 78.0 + 4.3) - 0.5) * 2.0;
    float gran = 1.0 + ((g1 * 0.6 + g2 * 0.4) - 0.62) * 0.18 * uZoomDetail;
    float facNoise = sunNoise3(sRot * 14.0 + 2.1);
    float faculae = smoothstep(0.66, 0.92, facNoise) * (1.0 - mu) * 0.28 * uZoomDetail;

    // 4) 적도 ±10~28° 흑점 군 (Umbra + Penumbra)
    float spot = 0.0;
    spot = max(spot, sunSpotMask(sRot, normalize(vec3( 0.26,  0.24,  0.93)), 0.042));
    spot = max(spot, sunSpotMask(sRot, normalize(vec3( 0.34,  0.21,  0.92)), 0.024));
    spot = max(spot, sunSpotMask(sRot, normalize(vec3(-0.42, -0.28,  0.86)), 0.036));
    spot = max(spot, sunSpotMask(sRot, normalize(vec3(-0.35, -0.31,  0.88)), 0.019));
    spot = max(spot, sunSpotMask(sRot, normalize(vec3( 0.68, -0.22, -0.70)), 0.038));
    spot = max(spot, sunSpotMask(sRot, normalize(vec3(-0.75,  0.25, -0.61)), 0.034));

    spotDark = 1.0 - spot * uZoomDetail;
    discRadiance = mix(discRadiance, limbDark * gran + faculae, uZoomDetail);
  }

  float total = disc * discRadiance * spotDark + halo;
  vec3 radiance = uColor * surfaceTint * uIntensity * total * T;
  if (uPeak > 0.0) {
    // 줌인 시 포화를 살짝 눌러 흑점·주연감광·쌀알무늬가 하얗게 날아가지 않게 함
    float detailGain = mix(1.0, 0.28, uZoomDetail);
    float totalP = disc * mix(1.0 + core * 0.15, discRadiance * spotDark, uZoomDetail) + halo * mix(1.0, 0.45, uZoomDetail);
    vec3 hdrTarget = uColor * surfaceTint * uPeak * detailGain * totalP * T;
    radiance = hdrTarget / (DISP_EXPO * atm_adaptation(uSunAltDeg) * atm_whiteBalance(uSunAltDeg));
  }

  // 완전히 가려지면 아무것도 그리지 않습니다. 둘레 번짐은 원반이 보이는 만큼만.
  float vis = smoothstep(0.015, 0.12, T);

  // 헤일로 영역의 알파는 강도에 비례하여 부드럽게 감쇠 (0.85 하드 클램핑 제거 -> 노란 링 제거)
  float haloAlpha = clamp(halo * 0.8, 0.0, 0.9) * fade;
  float alpha = clamp(max(disc, haloAlpha), 0.0, 1.0) * vis;
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
 * 해·달 모두 카메라 화각(FOV)과 1:1로 비교할 수 있도록 화면 비율 보정 없이 순수 물리 각반지름(0.267°)을 사용합니다.
 */
export function sunDisplayScale(_fovDeg?: number, _placeAltDeg?: number): { scale: number; radiusDeg: number } {
  return { scale: 1, radiusDeg: SUN_ANGULAR_RADIUS_DEG };
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
      uRotRad: { value: 0 },
      uZoomDetail: { value: 0 },
      uCloudAlphaTex: { value: null },
      uCloudAlphaOn: { value: 0 },
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
  vis?: { aureoleRel: number; glareGain: number; edgeBlur: number; rgb?: { r: number; g: number; b: number }; displayPeak?: number },
  /** 고배율 줌 시 주연감광·흑점(자전)·쌀알무늬 표현용 옵션 */
  detail?: { fovDeg?: number; dateMs?: number }
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
  if (detail?.dateMs != null && Number.isFinite(detail.dateMs)) {
    u.uRotRad.value = ((detail.dateMs / 86400_000) * Math.PI * 2) / 27.2753;
  }
  if (detail?.fovDeg != null && Number.isFinite(detail.fovDeg)) {
    const t = Math.max(0, Math.min(1, (18 - detail.fovDeg) / 14));
    u.uZoomDetail.value = t * t * (3 - 2 * t);
  } else {
    u.uZoomDetail.value = 0;
  }

  // 겉보기 위 끝이 해수면 수평선(높은 산·전망대 수평선 낙차까지 감안해 약 −4.5°)보다 한참 아래면 끕니다. 그 사이는 땅·바다가 가립니다.
  handle.mesh.visible = placeAltDeg > -4.5;
}

/**
 * 볼륨 하늘 텍스처(알파 = 화소마다 구름·지형 불투명도)를 해 판에 겁니다. null 이면 예전처럼 `occlusion` 값 하나로 가립니다.
 * 해 판은 볼륨 하늘을 배경으로 깐 뒤 그 위에 그려지므로, 이것이 없으면 두꺼운 구름 앞에도 원반과 빛무리가 뜹니다.
 */
export function setSunCloudAlpha(handle: SunHandle, tex: THREE.Texture | null): void {
  const u = handle.material.uniforms;
  u.uCloudAlphaTex.value = tex;
  u.uCloudAlphaOn.value = tex ? 1 : 0;
}
