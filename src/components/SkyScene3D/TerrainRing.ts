/**
 * TerrainRing.ts
 *
 * Why: 기존 panoramicAngles (360° 지형 프로필)를 3D 원통형 geometry로 변환하고,
 * 지평선 하단을 메우는 3D 땅(Ground Plane) 및 지평선 방위(Compass) 표시 라인 그룹을 생성합니다.
 */
import * as THREE from 'three';
import { clamp01 } from '../../utils/sunsetPhysics';
import { seaHorizonDipDeg as earthSeaHorizonDipDeg } from '../../utils/earth';
import { ATMOSPHERE_GLSL, GROUND_DISPLAY_GLSL, makeTuningUniforms } from '../../utils/atmosphere';

/**
 * 지표 알베도 — 지면이 받은 빛 중 되쏘는 비율.
 *
 * 지적대로 **대지는 햇빛을 그렇게 반사하지 않습니다.** 이 낮은 값이 곧
 * "땅은 하늘보다 훨씬 어둡다"는 결론이고, 예전 화면이 부자연스러웠던 이유가
 * 그 반대였기 때문입니다.
 *
 * | 지표 | 알베도 |
 * |---|---|
 * | 숲 | 0.12 |
 * | 도시 (아스팔트·콘크리트 혼합) | 0.15 |
 * | 풀·농지 | 0.23 |
 * | 눈 | 0.75 |
 *
 * 관측점의 지표 종류를 알 방법이 없으므로 도시와 초지 사이의 대표값을 씁니다.
 *
 * 색은 **따뜻한 쪽(흙·마른 풀·아스팔트)** 으로 기울입니다. 이유가 있습니다:
 * 해 질 녘 수평면이 받는 빛은 대부분 **천정 쪽 파란 하늘**에서 옵니다
 * (직달광은 스치는 각이라 약합니다). 알베도까지 중립이면 결과가 푸르뎅뎅한
 * 회색이 되고, 초록으로 두면 이끼색이 됩니다 — 렌더로 확인한 사항입니다.
 */
export const GROUND_ALBEDO = { r: 0.22, g: 0.17, b: 0.13 };

/**
 * **수체(water body) 알베도** — 물속으로 들어갔다 되돌아 나오는 몫.
 *
 * 물은 가시광에서 알베도가 0.02~0.06 로 아주 낮고, 붉은빛은 몇 m 안에
 * 흡수돼 청록만 되돌아옵니다. 그래서 물은 **어둡고**, 밝아 보이는 것은
 * 거의 전부 **표면 반사**(하늘·태양)입니다.
 *
 * ⚠ 예전에는 이 항이 `oceanBodyColor * 1.5` 라는 **상수 발광**이었습니다
 * (에메랄드 0.6 / 코발트 1.1 수준). 조도와 무관하니 한밤에도 바다가
 * 보라색으로 빛나고, 이미 톤 곡선 꼭대기라 윤슬이 얹힐 자리가 없었습니다.
 * 실측: 태양 반대쪽 물 238.8 대 육지 119 — 물이 육지보다 **두 배 밝고**
 * 태양 쪽(212.2)보다도 밝았습니다. 윤슬 폭은 두 풍속 모두 0 이었습니다.
 *
 * 땅과 **같은 식**(조도 × 알베도)으로 바꿉니다. 그러면 낮·노을·밤이
 * 저절로 맞습니다 — 둘 다 같은 하늘빛에서 나오기 때문입니다.
 */
export const WATER_BODY_ALBEDO = { r: 0.005, g: 0.038, b: 0.055 };

/**
 * 지면에만 거는 국소 순응 배율. 물리가 아니라 **표시** 선택입니다 —
 * 자세한 근거는 `GROUND_FRAG`의 "국소 순응" 주석.
 *
 * 렌더로 훑어 고른 값입니다 (태양 고도 4°, 하늘 휘도 253 기준):
 *
 *   ×1.0  지면 15 (하늘의 6%)   검은 띠
 *   ×1.8  지면 68 (27%)
 *   ×2.2  지면 80 (32%)         ← 채택
 *   ×3.2  지면 113 (45%)
 *   ×6.0  지면 163 (64%)        땅이 하늘만큼 밝아짐
 */
export const GROUND_EXPOSURE = 2.2;

/**
 * 능선 각도 상한.
 *
 * 예전 값 8°는 관측점에서 5km 떨어진 **700m 산까지**밖에 못 담습니다.
 * 설악(1708m)이 5km 앞이면 18.9°, 2000m면 21.8°입니다. 25°면 국내 어떤
 * 산도 잘리지 않습니다.
 */
export const TERRAIN_MAX_ANGLE_DEG = 25;

const TERRAIN_RING_RADIUS = 480; // 스카이돔(500) 바로 안쪽
const TERRAIN_SEGMENTS = 72;     // 5° 간격으로 충분히 부드러운 실루엣

/**
 * panoramicAngles 배열로부터 360° 지형 링 메시를 생성합니다.
 */
export function createTerrainRing(
  panoramicAngles: number[],
  maxVisualAngle: number = 8
): THREE.Mesh {
  const angleCount = panoramicAngles.length;
  if (angleCount === 0) {
    return new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ visible: false })
    );
  }

  const vertexCount = TERRAIN_SEGMENTS * 2;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices: number[] = [];

  for (let i = 0; i < TERRAIN_SEGMENTS; i++) {
    const azFrac = i / TERRAIN_SEGMENTS;
    const azRad = azFrac * Math.PI * 2;

    const angleIdx = azFrac * (angleCount - 1);
    const idx0 = Math.floor(angleIdx);
    const idx1 = Math.min(idx0 + 1, angleCount - 1);
    const frac = angleIdx - idx0;
    const terrainAngleDeg = panoramicAngles[idx0] * (1 - frac) + panoramicAngles[idx1] * frac;

    const terrainElevRad = (Math.min(terrainAngleDeg, maxVisualAngle) * Math.PI) / 180;
    const baseElevRad = (-2 * Math.PI) / 180;

    const dirX = Math.sin(azRad);
    const dirZ = -Math.cos(azRad); // Three.js: -Z = North

    const bIdx = i * 2;
    positions[bIdx * 3] = dirX * TERRAIN_RING_RADIUS * Math.cos(baseElevRad);
    positions[bIdx * 3 + 1] = TERRAIN_RING_RADIUS * Math.sin(baseElevRad);
    positions[bIdx * 3 + 2] = dirZ * TERRAIN_RING_RADIUS * Math.cos(baseElevRad);

    const tIdx = i * 2 + 1;
    positions[tIdx * 3] = dirX * TERRAIN_RING_RADIUS * Math.cos(terrainElevRad);
    positions[tIdx * 3 + 1] = TERRAIN_RING_RADIUS * Math.sin(terrainElevRad);
    positions[tIdx * 3 + 2] = dirZ * TERRAIN_RING_RADIUS * Math.cos(terrainElevRad);

    colors[bIdx * 3] = 0.05; colors[bIdx * 3 + 1] = 0.06; colors[bIdx * 3 + 2] = 0.08;
    colors[tIdx * 3] = 0.08; colors[tIdx * 3 + 1] = 0.09; colors[tIdx * 3 + 2] = 0.11;

    const nextI = (i + 1) % TERRAIN_SEGMENTS;
    const b0 = i * 2, t0 = i * 2 + 1;
    const b1 = nextI * 2, t1 = nextI * 2 + 1;
    indices.push(b0, t0, b1);
    indices.push(b1, t0, t1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    // ⚠ 예전에는 `FrontSide` 였고, 그래서 **한 번도 화면에 안 나왔습니다.**
    // 이 링은 관측자를 둘러싼 원통이라 항상 **안쪽에서** 봅니다. 그런데 감김
    // 방향상 안쪽이 뒷면이라 통째로 컬링됐습니다 (검은 배경에 지형만 그려
    // 세어 보니 0픽셀). 지면 원반이 그리기 순서 때문에 안 보이던 것과 같은
    // 종류의 버그입니다 — 둘 다 코드를 읽어서는 안 잡히고, 씬에서 빼 보거나
    // 단독으로 그려 봐야 드러납니다.
    side: THREE.DoubleSide,
    depthWrite: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrainRing';
  mesh.renderOrder = 0;
  
  return mesh;
}

const BAND_VERT = `
precision highp float;
attribute float aElevDeg;
attribute vec3  aHaze;      // 이 방위 지평선 하늘색 (연무)
varying float vElevDeg;
varying vec3 vDir;
varying vec3 vHaze;
void main() {
  vElevDeg = aElevDeg;
  vHaze = aHaze;
  vDir = normalize(position);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const BAND_FRAG = `
precision highp float;

${ATMOSPHERE_GLSL}

uniform vec3  uTerrainRadiance;  // 이 능선이 되쏘는 복사휘도 (선형)
uniform float uDistanceKm;       // 이 거리대까지의 거리
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;
uniform float uSunAltDeg;
uniform float uSaturation;
uniform float uExposure;

varying float vElevDeg;
varying vec3  vDir;
varying vec3  vHaze;

/**
 * 지형/대지 전용 표시 파이프라인.
 * 하늘 전용 하단 절단(DISP_CONTR)으로 인한 블랙 크러시를 방지하고
 * 황혼/야간에도 산과 대지의 입체적 실루엣과 계조를 보존합니다.
 */
${GROUND_DISPLAY_GLSL}

void main() {
  // ── 거리별 대기 투시 ────────────────────────────────────────────────────
  vec3 T = atm_aerialTransmittance(uDistanceKm, 0.0, uBeta, uAngstrom, uElevScale);
  // 능선 위쪽(하늘에 가까운 쪽)이 조금 밝습니다 — 사면이 하늘을 더 봅니다. 이 기울기는 **사면 몫**에만 겁니다.
  // ⚠ (2026-10-02) 연무(vHaze, 그 방향 하늘빛)는 땅용 눈 순응을 미리 나눠 하늘과 같은 노출로 둡니다 — 예전에는
  //   섞은 뒤 통째로 순응(해 1° 에서 ×2.8)과 위 기울기(최대 ×1.12)를 먹어, 해 쪽 먼 능선이 제 뒤 하늘보다
  //   밝았습니다(TerrainField 공기원근 주석).
  vec3 surf = uTerrainRadiance * uExposure * (0.82 + 0.30 * smoothstep(-2.0, 6.0, vElevDeg));
  vec3 col = surf * T + vHaze * (1.0 - T) / max(1e-4, atm_groundEyeAdapt(uSunAltDeg));

  gl_FragColor = vec4(atm_display_ground(col, uSaturation, uSunAltDeg), 1.0);
}
`;

const GROUND_VERT = `
precision highp float;
varying vec3 vWorld;
void main() {
  // ⚠ 원반은 rotation.x = -PI/2 와 position.y = -8 을 갖습니다. 스카이돔처럼
  // 변환이 없는 메시의 VERT를 흉내 내어 gl_Position 에서 modelMatrix를
  // 빼먹으면, 원반이 회전 전(수직면) 자리에 그려져 지평선 아래가 통째로
  // 비어 버립니다. 둘 다 같은 월드 좌표를 써야 합니다.
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const GROUND_FRAG = `
precision highp float;

${ATMOSPHERE_GLSL}

// 물 알베도(0.06) 나누기 지표 알베도(약 0.19). uGroundRadiance 가 이미 지표
// 알베도를 먹었으므로, 물의 몸체색은 이 비율만 더 곱하면 됩니다.
#define WATER_ALBEDO_REL 0.32

uniform vec3  uGroundRadiance;  // 지면이 되쏘는 복사휘도 (선형, 하늘과 같은 단위)
uniform float uSunAzRad;
uniform float uSunAltDeg;
uniform float uSaturation;
uniform float uSheen;           // 태양 쪽 전방산란 광택 세기
uniform float uExposure;        // 국소 순응 보정 (아래 주석)

// ── 밤 대지 조명 & 달빛 산란 ───────────────────────────────────────────────
uniform vec3  uMoonRadiance;    // 달빛 조도 (밤에 달이 비출 때)
uniform float uMoonAzRad;
uniform float uMoonAltRad;
uniform float uNightFactor;     // 밤 비율 (0: 낮, 1: 밤)

// ── 2D 수역 마스크 (해안선, 만, 반도, 강, 호수) ────────────────────────────
uniform sampler2D uWaterTex2D;  // 2D 수역 마스크 (0=육지, 1=수면)
uniform vec3 uSurfaceIrr;       // 수면에 닿는 조도 (하늘+직달, E/pi. 알베도 곱하기 전)
uniform float uHasWater;        // 0이면 물 경로를 통째로 건너뜁니다
uniform vec3  uSunRadiance;     // 지면 고도에서의 직달광 (선형)
uniform float uSunAltRad;
uniform float uSlopeVar;        // Cox-Munk 파면 경사 분산 σ²
// 물이 되비출 하늘을 셰이더 안에서 직접 계산합니다 (atm_skyRadiance).
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;
uniform float uOzoneDU;

varying vec3 vWorld;

// ── 대지 및 바다 전용 표시 파이프라인 (Anti-Black-Crush & Scotopic Adaptation) ──
${GROUND_DISPLAY_GLSL}

/**
 * 프레넬 반사율 (Schlick, 물 n=1.33 → F0 = 0.02).
 */
// 수체 알베도 (JS 의 WATER_BODY_ALBEDO 와 같은 값). 가시광 0.02~0.06.
const vec3 WATER_BODY_ALB = vec3(0.005, 0.038, 0.055);
// 거품(흰 물)의 알베도. 공기를 머금어 높습니다.
const float FOAM_ALB = 0.70;

float waterFresnel(float cosTheta) {
  float f = pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
  return 0.02 + 0.98 * f;
}

// ── 거친 흙땅 및 자갈 질감 해시 노이즈 ──────────────────────────────────
float groundHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float groundNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(groundHash(i + vec2(0.0, 0.0)), groundHash(i + vec2(1.0, 0.0)), u.x),
    mix(groundHash(i + vec2(0.0, 1.0)), groundHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  // 관측자 눈높이는 지면 위 160cm에 있습니다.
  vec3 eyePos = vec3(0.0, vWorld.y + 1.6, 0.0);
  vec3 dir = normalize(vWorld - eyePos);
  float sinDown = clamp(-dir.y, 0.0, 1.0);   // 아래를 볼수록 1에 가까움
  float grazing = clamp(1.0 - sinDown, 0.0, 1.0);

  // ── 거친 흙땅/모래사장 고밀도 마이크로 재질 (Micro-Detail Soil & Sand) ────────
  float groundDist = length(vWorld.xz);
  float distFade = smoothstep(80.0, 4.0, groundDist); // 근거리일수록 마이크로 디테일 선명화

  // 4단계 멀티스케일 프랙탈 노이즈 (매크로 흙무늬 + 중간 자갈 + 미세 모래알)
  float n1 = groundNoise(vWorld.xz * 0.20);
  float n2 = groundNoise(vWorld.xz * 1.25);
  float n3 = groundNoise(vWorld.xz * 4.8);
  float n4 = groundNoise(vWorld.xz * 16.0) * distFade; // 발밑 5cm급 초미세 모래알

  // 입체적 요철 법선 범프 (Normal Bump)
  float eps = 0.08;
  float nH1 = groundNoise(vWorld.xz * 1.25 + vec2(eps, 0.0));
  float nH2 = groundNoise(vWorld.xz * 1.25 + vec2(0.0, eps));
  float nH3 = groundNoise(vWorld.xz * 4.8 + vec2(eps, 0.0));
  float nH4 = groundNoise(vWorld.xz * 4.8 + vec2(0.0, eps));
  vec2 soilGrad = (vec2(nH1, nH2) - n2) * 0.65 + (vec2(nH3, nH4) - n3) * 0.45 * distFade;
  vec3 soilNormal = normalize(vec3(-soilGrad.x, 1.0, -soilGrad.y));

  // 태양 직달광 방향 벡터
  vec3 L = vec3(cos(uSunAltRad) * sin(uSunAzRad),
                sin(uSunAltRad),
                -cos(uSunAltRad) * cos(uSunAzRad));
  float soilSunDiff = max(0.45, dot(soilNormal, L));

  // 모래·자갈·황토 유기적 색상 블렌딩 (풍부하고 입체적인 대지 색감)
  vec3 sandBright = vec3(1.18, 1.08, 0.90);
  vec3 gravelTone = vec3(0.90, 0.82, 0.70);
  vec3 darkSoil   = vec3(0.68, 0.58, 0.46);
  vec3 soilBlend  = mix(sandBright, gravelTone, n1 * 0.65 + n2 * 0.35);
  soilBlend       = mix(soilBlend, darkSoil, n3 * 0.45);
  float soilRoughness = mix(0.82, 1.28, n3 * 0.6 + n4 * 0.4);

  // ── 방위별 전방산란 광택 ────────────────────────────────────────────────
  float az = atan(dir.x, -dir.z);
  float dAz = cos(az - uSunAzRad);            // 태양 쪽 +1, 반대쪽 -1
  float sheen = uSheen * 0.32 * max(0.0, dAz) * pow(grazing, 2.2);

  // ── 밤 대지 조명 (달빛 전방산란 + 밤하늘 대기광 산란) ─────────────────────
  // ⚠ 밤빛 상수는 **표시 단계의 순응을 지납니다.**
  //
  // 밤에는 DISP_EXPO 0.62 × adapt(최대 16) × eyeAdapt(최대 3) ×
  // GROUND_EXPOSURE 2.2 = 약 65배가 걸립니다. 그래서 이 상수 0.02~0.035
  // 하나만으로 화면이 1.1 이 되어 **지평선 아래가 통째로 하얘졌습니다**
  // (실측: 태양 -14°에서 육지도 바다도 흰색).
  //
  // 이 값은 "밤에 이 정도로 보였으면" 하는 **표시 밝기**로 고른 것이므로,
  // 순응이 곱해질 몫만큼 미리 나눠 둡니다. 그러면 의도한 밝기는 그대로고
  // 날아가지만 않습니다. (달빛 uMoonRadiance 는 진짜 물리값이라 그대로
  // 두고 순응이 올리게 둡니다 — 그게 순응의 존재 이유입니다.)
  //
  // ⚠ **그 표시 밝기 상수(대기광 0.020~0.035 ÷ 순응)는 뺐습니다.** 하늘이 대비 곡선에 잘려 새카맣던
  //   동안에는 이것 덕에 밤 지면이 보였지만, 지면은 이미 uGroundRadiance(하늘 평균 × 반사율, 밤하늘
  //   바닥 포함)로 물리 조도를 받습니다 — 이중으로 더해 반사율 0.2 인 땅이 박명·밤하늘보다 두 배
  //   밝게 떴습니다(마쓰모토 2026-09-26, verify-night-cloudy). 산 격자(TerrainField)는 원래 이런
  //   상수 없이 물리값만 씁니다. 달빛도 다른 빛과 같은 반사율을 받습니다 — 예전 (0.28,0.25,0.20)×2.8
  //   은 반사율의 3.6배였습니다.
  float dMoonAz = cos(az - uMoonAzRad);
  float moonSheen = max(0.0, dMoonAz) * pow(grazing, 2.0) * 0.75;
  vec3 moonScatter = uMoonRadiance * (1.0 + moonSheen);
  vec3 nightGround = moonScatter * vec3(0.22, 0.17, 0.13);

  // ⚠ **절대 복사휘도 바닥을 깔면 안 됩니다.**
  //
  // 예전에는 max(vec3(0.035, 0.040, 0.050), uGroundRadiance) 였습니다.
  // "지면이 새까매지지 않게" 하려는 것이었는데, 밤에는 순응이 통째로
  // 65배(DISP_EXPO 0.62 × adapt 16 × eyeAdapt 3 × GROUND_EXPOSURE 2.2)라
  // 그 바닥 하나만으로 0.04 × 65 = 2.6 이 되어 **화면이 하얗게 날아갑니다.**
  // 실측: 태양 -14°에서 지평선 아래가 육지도 바다도 전부 흰색이었습니다.
  //
  // 검게 죽는 것을 막는 일은 표시 단계의 minGlow 가 이미 합니다 — 그쪽은
  // 순응을 **지난 뒤** 걸리므로 밤이든 낮이든 같은 밝기로 바닥을 깝니다.
  // 여기서는 물리값을 그대로 쓰고, 밤빛은 아래 nightGround 가 맡습니다.
  vec3 groundLight = max(vec3(0.0), uGroundRadiance);
  vec3 col = (groundLight * soilSunDiff * soilBlend * (1.0 + sheen) + nightGround) * uExposure * soilRoughness;

  // ── 2D 수면 (청명한 에메랄드-사파이어 수체광, 4-옥타브 파도, 찬란한 황금빛 윤슬) ───────
  if (uHasWater > 0.5) {
    vec2 waterUV = clamp((vWorld.xz / (475.0 * 2.0)) + 0.5, 0.0, 1.0);
    float rawWaterMask = texture2D(uWaterTex2D, waterUV).r;
    float waterMask = smoothstep(0.005, 0.12, rawWaterMask);

    if (waterMask > 0.001) {
      vec3 V = -dir;

      // ── 4-옥타브 프랙탈 해양 파도 (밭고랑 줄무늬 제거) ───────────────────
      vec2 pW = vWorld.xz * 0.14;
      // 1. 주 파도 (바람 방향 25도, 파장 약 7m)
      float w1 = sin(dot(pW, vec2(0.906, 0.423)) * 2.4 + groundNoise(pW * 0.6) * 1.8) * 0.5 + 0.5;
      // 2. 보조 파도 (방향 -35도, 파장 약 4.5m)
      float w2 = sin(dot(pW, vec2(0.819, -0.573)) * 3.8) * 0.5 + 0.5;
      // 3. 횡방향 잔물결 (방향 75도, 파장 약 2.2m)
      float w3 = sin(dot(pW, vec2(0.258, 0.965)) * 6.5) * 0.5 + 0.5;
      // 4. 고주파 마이크로 리플 (근거리 잔물결)
      float w4 = groundNoise(vWorld.xz * 1.6);

      // Trochoidal 피크 (골은 넓고 둥글며, 봉우리는 뾰족한 비대칭 해양 파형)
      float waveElev = pow(max(0.0, w1 * 0.44 + w2 * 0.32 + w3 * 0.16 + w4 * 0.08), 1.35);

      // 거리 기반 파도 세기 감쇠
      float waveStrength = mix(0.25, 0.06, smoothstep(4.0, 300.0, groundDist));
      vec2 waveGrad = vec2(
        (cos(dot(pW, vec2(0.906, 0.423)) * 2.4) * 0.906 * 0.44 +
         cos(dot(pW, vec2(0.819, -0.573)) * 3.8) * 0.819 * 0.32 +
         cos(dot(pW, vec2(0.258, 0.965)) * 6.5) * 0.258 * 0.16) * waveStrength * 2.2,
        (cos(dot(pW, vec2(0.906, 0.423)) * 2.4) * 0.423 * 0.44 -
         cos(dot(pW, vec2(0.819, -0.573)) * 3.8) * 0.573 * 0.32 +
         cos(dot(pW, vec2(0.258, 0.965)) * 6.5) * 0.965 * 0.16) * waveStrength * 2.2
      );
      vec3 waveNormal = normalize(vec3(waveGrad.x, 1.0, waveGrad.y));

      // ── 면적형 파도 윤슬 (Wave Glitter Carpet) ────────────────────────
      vec3 H = normalize(V + L + vec3(1e-5, 1e-4, 1e-5));
      // ⚠ Cox-Munk 의 p 는 경사의 **확률분포**입니다 — 그러니 이미 흔들린
      // waveNormal 이 아니라 **평균면(수직)** 기준으로 재야 합니다. 흔들린
      // 법선에 대고 재면 같은 파도를 두 번 세는 셈이고, 실제로 그래서
      // 반사각을 맞추는 화소가 거의 없어 윤슬이 안 섰습니다(봉우리 +4.6).
      //
      // H 는 시선과 태양의 반각 벡터이므로, 그 화소가 태양을 눈으로 보내려면
      // 수면 조각이 얼마나 기울어야 하는지를 H.y 가 그대로 말해 줍니다.
      float cosN = max(H.y, 1e-3);
      float tan2 = max(0.0, 1.0 - cosN * cosN) / (cosN * cosN);
      float slopeVarClamped = max(1e-3, uSlopeVar);
      float p = exp(-clamp(tan2 / slopeVarClamped, 0.0, 50.0))
              / (3.14159265 * slopeVarClamped * pow(cosN, 4.0));
      p = clamp(p, 0.0, 220.0);

      vec3 waveRefl = reflect(-L, waveNormal);
      float waveGlint = pow(max(0.0, dot(waveRefl, V)), 24.0);

      float cosV = max(0.02, dot(V, waveNormal));
      float F = waterFresnel(clamp(dot(V, H), 0.0, 1.0));

      // ── 찬란한 태양 윤슬 카펫 (Sunlight Glitter Path - 안정화 수식) ──────────────────
      vec3 sunReflIdeal = reflect(-L, vec3(0.0, 1.0, 0.0));
      float sunAlign = max(0.0, dot(V, sunReflIdeal));
      float specDenom = max(1.0, 4.0 * cosV);
      // ── 윤슬의 폭은 **Cox-Munk 가 정합니다** ──────────────────────────
      //
      // ⚠ 예전에는 여기에 풍속과 무관한 고정 로브가 둘 얹혀 있었습니다:
      // pow(sunAlign, 6.0)*1.8 (반각 27°) 과 waveGlint = pow(...,24)*2.5.
      // 그 둘이 물리항 p 를 덮어, 풍속을 2 → 8 m/s 로 올려도 윤슬 폭이
      // 29.8° 에서 꿈쩍하지 않았습니다 — 27° 는 정확히 sunAlign^6 의 반각
      // 입니다. 이 모형에서 관측 가능한 유일한 결과가 풍속 의존인데 그것을
      // 가리고 있었던 것입니다.
      //
      // p 는 경사 확률밀도라 폭이 σ = sqrt(0.003 + 0.00512·U) 로 정해집니다
      // (2m/s 0.115, 8m/s 0.210 rad). 그것만 남기고, 잔물결 반짝임은 결을
      // 주는 정도로만 조금 섞습니다.
      //
      // ⚠ clamp 상한도 올렸습니다. 30 에서 자르면 약풍의 뾰족한 봉우리가
      // 평평한 고원이 되어 오히려 **넓어 보입니다** — 폭 차이를 지우는
      // 또 하나의 길입니다.
      float microSpec = (p + waveGlint * 0.30) / specDenom;
      vec3 glitter = uSunRadiance * F * microSpec * 3.0;
      glitter = clamp(glitter, vec3(0.0), vec3(8.0));

      // ── 수체 고유광 = **조도 × 물 알베도** ────────────────────────────
      //
      // 예전에는 여기가 상수 발광이었습니다(에메랄드 0.70 / 코발트 0.72 를
      // 1.5배). 조도와 무관하니 한밤에도 바다가 빛났고, 이미 톤 곡선
      // 꼭대기라 윤슬이 얹힐 자리가 없었습니다. 땅과 같은 식으로 바꿉니다 —
      // uWaterBody 는 JS 에서 하늘·직달 조도에 WATER_BODY_ALBEDO 를 곱해
      // 넘긴 값이라, 낮·노을·밤이 저절로 따라옵니다.
      //
      // 남은 두 색은 **색조 배수**입니다(밝기가 아니라 색만). 얕은 물은
      // 바닥이 되쏘아 초록끼가 돌고, 깊은 물은 붉은빛이 더 먹혀 파랗습니다.
      vec3 shallowTint = vec3(0.75, 1.20, 1.05);
      vec3 deepTint    = vec3(0.35, 0.85, 1.35);
      float depthMix   = smoothstep(3.0, 100.0, groundDist);
      float sunWarmth  = smoothstep(-2.0, 12.0, uSunAltDeg);
      vec3 body = uSurfaceIrr * WATER_BODY_ALB * mix(shallowTint, deepTint, depthMix);

      // ── 파도 법선 기반 하늘 되비침 ─────────────────────────────────────
      vec3 mirrorDir = normalize(reflect(dir, waveNormal) + vec3(0.0, 1e-4, 0.0));
      float mirrorElev = max(1.0, degrees(asin(clamp(mirrorDir.y, 0.0, 1.0))));
      float cosG = clamp(dot(mirrorDir, L), -1.0, 1.0);
      vec3 skyRefl = atm_skyRadiance(mirrorElev, cosG, uSunAltDeg,
                                     max(0.001, uBeta), max(0.1, uAngstrom), max(0.1, uElevScale), max(50.0, uOzoneDU));
      // ⚠ 바닥값도 **조도에 비례**해야 합니다. 상수 0.2 를 깔면 한밤에도
      // 수면이 그만큼 빛납니다. 하늘 복사휘도가 이상할 때를 막는 것이
      // 목적이므로, 그 자리의 조도에 맞춘 값으로 깝니다.
      // 바닥은 **가드**이지 기여가 아닙니다. 조도의 0.8배를 깔았더니 반사가
      // 어디서나 그만큼 밝아져, 태양 반대쪽 수면이 육지보다 밝아졌습니다
      // (실측 125.1 대 119). 하늘 복사휘도가 이상할 때 검게 죽는 것만
      // 막으면 되므로 아주 작게 깝니다.
      vec3 skyFallback = uSurfaceIrr * 0.05 * mix(vec3(1.2, 0.8, 0.6), vec3(0.7, 0.95, 1.4), sunWarmth);
      skyRefl = clamp(max(skyFallback, skyRefl), vec3(0.0), vec3(12.0));

      // ── 반사와 수체의 몫은 **프레넬이 정합니다** ──────────────────────
      //
      // ⚠ 예전에는 mix(0.10, 0.35, Fv) 로 반사를 0.35 에서 잘랐습니다
      // ("에메랄드 색이 65% 이상 주도하도록"). 그런데 물이 하늘을 비추는
      // 정도는 취향이 아니라 **보는 각도**가 정합니다. 지평선 쪽 수면은
      // 스침각이라 Fv → 1 이고, 그래서 먼 바다가 하늘색으로 빛납니다.
      // 발밑을 내려다보면 Fv → 0.02 라 어두운 청록이 보입니다. 그 대비가
      // 물을 물로 보이게 하는 전부인데, 0.35 로 자르면 둘 다 잃습니다.
      float Fv = waterFresnel(cosV);
      vec3 waterCol = mix(body, skyRefl, Fv);

      // ── 파도 피크 하얀 포말 ────────────────────────────────────────────
      //
      // ⚠ 거품도 **조도 × 알베도**입니다. 예전에는 상수 0.35 를 그냥 더했고,
      // 수체가 상수 발광이던 시절에는 그 안에 묻혀 안 보였습니다. 수체를
      // 물리로 되돌리자 이 항이 근거리 수면을 통째로 덮었습니다 — 발밑이
      // 가장 밝고 수평선 아래가 어두운, 뒤집힌 그림이 됐습니다.
      //
      // 거품은 공기를 머금은 흰 물이라 알베도가 0.6~0.8 로 높습니다. 그
      // 대비가 곧 파도의 결이므로 항은 남기되, 밝기는 조도가 정합니다.
      float foam = smoothstep(0.70, 0.95, waveElev) * (0.6 + 0.4 * groundNoise(vWorld.xz * 6.0)) * 0.35;
      waterCol += uSurfaceIrr * FOAM_ALB * vec3(0.98, 0.99, 1.0) * foam;

      // 밤바다 달빛 반사 보조
      if (uNightFactor > 0.01) {
        vec3 moonL = vec3(cos(uMoonAltRad) * sin(uMoonAzRad),
                          sin(uMoonAltRad),
                          -cos(uMoonAltRad) * cos(uMoonAzRad));
        vec3 moonRefl = reflect(-moonL, waveNormal);
        float moonGlint = pow(max(0.0, dot(moonRefl, V)), 20.0);
        waterCol += uMoonRadiance * moonGlint * 1.2;
      }

      // ── 해변 젖은 모래(Wet Sand) 및 부드러운 해안선 블렌딩 ─────────────────
      vec3 wetSand = col * 0.45;
      col = mix(col, wetSand, smoothstep(0.001, 0.40, waterMask));

      vec3 wet = clamp(waterCol + glitter, vec3(0.0), vec3(40.0));
      col = mix(col, wet, waterMask);
    }
  }

  // ── 대지와 바다의 로컬 표시 파이프라인 (Anti-Black-Crush & Scotopic Adaptation) ──
  vec3 dispCol = atm_display_ground(col, uSaturation, uSunAltDeg);

  gl_FragColor = vec4(dispCol, 1.0);
}
`;

/**
 * 방위별 수역 비율을 가로 한 줄짜리 텍스처로 굽습니다.
 *
 * uniform 배열을 동적 인덱스로 읽는 것은 GLSL ES 1.0에서 보장되지 않으므로
 * 텍스처를 씁니다 (텍스처 조회는 언제나 동적 인덱싱이 됩니다).
 *
 * `RepeatWrapping` + 선형 보간이라 방위 0°/360° 이음매가 자연히 이어지고,
 * 해안선이 계단이 아니라 부드러운 경계로 나옵니다.
 */
export function makeWaterTexture(waterFrac: number[] | null): THREE.DataTexture {
  const N = 64;
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    let v = 0;
    if (waterFrac && waterFrac.length > 0) {
      // 방위 i/N 에 해당하는 입력 표본을 선형 보간합니다.
      const t = (i / N) * waterFrac.length;
      const a = Math.floor(t) % waterFrac.length;
      const b = (a + 1) % waterFrac.length;
      const f = t - Math.floor(t);
      v = waterFrac[a] * (1 - f) + waterFrac[b] * f;
    }
    const b8 = Math.round(Math.max(0, Math.min(1, v)) * 255);
    data[i * 4] = b8; data[i * 4 + 1] = b8; data[i * 4 + 2] = b8; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 관측 고도에서 **바다 수평선**의 내려앉음(dip)을 구합니다 (도).
 *
 *     dip = acos(R / (R + h))
 *
 * 30m에서 0.176°, 100m에서 0.32°. 지형선과 달리 수평선은 완벽하게 평평하고
 * 이 각도 하나로 정해집니다 — 그래서 물은 "없는 걸 안 만들어도 되는" 지표면
 * 입니다.
 */
export function seaHorizonDipDeg(observerElevM: number): number {
  // ⚠ 지구는 utils/earth.ts 한 곳에서만 정의합니다. 여기와 지형각(weather.ts),
  //   지면·해수면 메시(groundProjection.ts)가 **같은 지구**를 써야 합니다 —
  //   44절에서 지면과 구름이 갈라져 0.79° 띠가 벌어진 적이 있습니다.
  return earthSeaHorizonDipDeg(observerElevM);
}

/**
 * 지면 원반을 **바다 수평선 각도에 맞춰** 내립니다.
 *
 * 원반 가장자리가 곧 보이는 지평선입니다. 예전에는 y = −8 (가장자리 −0.95°)
 * 로 고정이었는데, 실제 30m 관측점의 수평선은 −0.176° 입니다 — 5배 아래로
 * 내려가 있었습니다. 육지에서는 지형이 가려 안 보이지만 바다에서는 바로
 * 드러납니다.
 */
export function setGroundHorizon(mesh: THREE.Mesh, observerElevM: number): void {
  const dip = seaHorizonDipDeg(observerElevM);
  mesh.position.y = -TERRAIN_RING_RADIUS * Math.tan((dip * Math.PI) / 180);
}

/** 거리대 하나에 해당하는 능선 링 */
export interface TerrainBand {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  distanceKm: number;
}

export interface TerrainBandsHandle {
  group: THREE.Group;
  bands: TerrainBand[];
  dispose: () => void;
}

/**
 * **거리대별 능선 링**을 만듭니다 (docs/GROUND_PLAN.md 3단계).
 *
 * 예전 `createTerrainRing`은 세 거리(5·15·40km)의 지형각을 **최댓값 하나로
 * 뭉개** 띠 하나로 그렸습니다. 그러면 "가까운 언덕 뒤에 먼 산"이라는 정보가
 * 사라지고, 대기 투시를 걸 대상도 없어집니다 — 화면에 깊이가 안 생깁니다.
 *
 * 여기서는 거리대마다 링을 하나씩 만들고 **먼 것부터** 그립니다. 가까운
 * 능선이 먼 능선을 가리므로(화가 알고리즘) 겹침이 그대로 나타납니다.
 *
 * @param bandAngles     `[거리대][방위]` 지형각 (도)
 * @param distancesKm    각 거리대의 거리
 */
export function createTerrainBands(
  bandAngles: number[][],
  distancesKm: number[],
  maxVisualAngle: number = TERRAIN_MAX_ANGLE_DEG,
  waterFrac?: number[] | null,
  observerElevM: number = 50
): TerrainBandsHandle {
  const group = new THREE.Group();
  group.name = 'terrainBands';
  const bands: TerrainBand[] = [];

  // 관측자 해발 고도에 따른 바다 수평선 침강각 (도, 음수)
  const dipDeg = seaHorizonDipDeg(observerElevM);

  // 먼 거리대를 먼저 그립니다. renderOrder가 클수록 나중이므로 가까울수록 큽니다.
  const order = distancesKm
    .map((d, i) => ({ d, i }))
    .sort((a, b) => b.d - a.d);

  order.forEach(({ d, i }, rank) => {
    const angles = bandAngles[i];
    if (!angles || angles.length === 0) return;

    const vertexCount = TERRAIN_SEGMENTS * 2;
    const positions = new Float32Array(vertexCount * 3);
    const elevAttr = new Float32Array(vertexCount);
    const hazeAttr = new Float32Array(vertexCount * 3);
    const indices: number[] = [];

    for (let s = 0; s < TERRAIN_SEGMENTS; s++) {
      const azFrac = s / TERRAIN_SEGMENTS;
      const azRad = azFrac * Math.PI * 2;

      const angleIdx = azFrac * (angles.length - 1);
      const i0 = Math.floor(angleIdx);
      const i1 = Math.min(i0 + 1, angles.length - 1);
      const f = angleIdx - i0;
      const raw = angles[i0] * (1 - f) + angles[i1] * f;

      // 산 능선 고도각 처리:
      // 관측자 해발 고도에 따른 바다 수평선 침강각(-dipDeg)보다 위로 솟아오른 실제 산 지형만 메쉬를 만듭니다.
      // 바다 방위이거나 수평선 아래인 지형(raw <= -dipDeg + 0.005)은 topDeg = botDeg = -dipDeg로 높이를 0으로 두어
      // 발밑부터 수평선까지 펼쳐지는 바다 수면(푸른 물과 윤슬)을 가리는 회색 벽이 생기지 않도록 합니다.
      const hasMountain = raw > (-dipDeg + 0.005);
      const topDeg = hasMountain ? Math.min(raw, maxVisualAngle) : -dipDeg;
      const botDeg = -dipDeg; // 산의 기슭은 지평선/수면(-dipDeg)과 빈틈없이 밀착됩니다.

      const dirX = Math.sin(azRad);
      const dirZ = -Math.cos(azRad);

      // 거리대마다 반지름을 조금씩 달리해 z-fighting을 피합니다.
      const R = TERRAIN_RING_RADIUS - rank * 3;

      const put = (vi: number, deg: number) => {
        const e = (deg * Math.PI) / 180;
        positions[vi * 3] = dirX * R * Math.cos(e);
        positions[vi * 3 + 1] = R * Math.sin(e);
        positions[vi * 3 + 2] = dirZ * R * Math.cos(e);
        elevAttr[vi] = deg;
      };
      put(s * 2, botDeg);
      put(s * 2 + 1, topDeg);

      // 연무 버퍼 어트리뷰트(aHaze) 기본값 초기화 (첫 프레임에서 검은색 잔상 방지)
      hazeAttr[s * 2 * 3] = 0.20;
      hazeAttr[s * 2 * 3 + 1] = 0.28;
      hazeAttr[s * 2 * 3 + 2] = 0.42;
      hazeAttr[(s * 2 + 1) * 3] = 0.20;
      hazeAttr[(s * 2 + 1) * 3 + 1] = 0.28;
      hazeAttr[(s * 2 + 1) * 3 + 2] = 0.42;

      const n = (s + 1) % TERRAIN_SEGMENTS;
      indices.push(s * 2, s * 2 + 1, n * 2);
      indices.push(n * 2, s * 2 + 1, n * 2 + 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aElevDeg', new THREE.BufferAttribute(elevAttr, 1));
    geometry.setAttribute('aHaze', new THREE.BufferAttribute(hazeAttr, 3));
    geometry.setIndex(indices);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...makeTuningUniforms(),
        uTerrainRadiance: { value: new THREE.Vector3(0.02, 0.018, 0.014) },
        uDistanceKm: { value: d },
        uBeta: { value: 0.08 },
        uAngstrom: { value: 1.3 },
        uElevScale: { value: 1.0 },
        uSunAltDeg: { value: 30 },
        uSaturation: { value: 1.0 },
        uExposure: { value: GROUND_EXPOSURE },
      },
      vertexShader: BAND_VERT,
      fragmentShader: BAND_FRAG,
      // 안쪽에서 보는 원통이라 감김 방향에 기대지 않습니다 (위 주석 참고).
      side: THREE.DoubleSide,
      depthWrite: true,
      depthTest: true,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `terrainBand_${d}km`;
    // 지면 원반(−0.5)보다 뒤(화면 앞쪽), 천체 궤적(-0.2)보다 뒤. 먼 거리대일수록 먼저.
    mesh.renderOrder = -0.4 + rank * 0.05;
    group.add(mesh);
    bands.push({ mesh, material, distanceKm: d });
  });

  return {
    group,
    bands,
    dispose: () => {
      for (const b of bands) {
        b.mesh.geometry.dispose();
        b.material.dispose();
      }
    },
  };
}

/**
 * 거리대별 능선의 색을 갱신합니다. 지면 원반과 **같은 조도 × 알베도**를 쓰되,
 * 능선은 사면이라 하늘을 조금 덜 봅니다.
 */
export function updateTerrainBands(
  handle: TerrainBandsHandle,
  sunAltitude: number,
  opts: {
    skyMean: { r: number; g: number; b: number };
    /**
     * **방위·고도별** 하늘색 (연무). 먼 능선이 자기 뒤 하늘에 잠깁니다.
     *
     * 고도까지 받는 이유: 고정 고도(예: 1°)에서 뽑으면 능선 꼭대기가 조금
     * 높은 띠가 자기 뒤 하늘보다 밝게 칠해집니다. 실측에서 40km 띠가 15km
     * 띠보다 대비가 커지는 역전이 그래서 생겼습니다.
     */
    hazeAt: (azimuthDeg: number, elevDeg: number) => { r: number; g: number; b: number };
    beam?: { r: number; g: number; b: number };
    sunTransmittance?: number;
    betaMie: number;
    angstrom: number;
    elevScale: number;
    saturation?: number;
  }
): void {
  const sunT = clamp01(opts.sunTransmittance ?? 1);
  const sinAlt = Math.max(0, Math.sin((sunAltitude * Math.PI) / 180));
  const beam = opts.beam ?? { r: 0, g: 0, b: 0 };
  const direct = (sinAlt * sunT) / Math.PI;

  // 능선은 수평면이 아니라 사면이라 하늘을 덜 봅니다 (하늘 가림 ≈ 0.72).
  const SKY_VIEW = 0.72;
  const r = (opts.skyMean.r * SKY_VIEW + beam.r * direct) * GROUND_ALBEDO.r;
  const g = (opts.skyMean.g * SKY_VIEW + beam.g * direct) * GROUND_ALBEDO.g;
  const b = (opts.skyMean.b * SKY_VIEW + beam.b * direct) * GROUND_ALBEDO.b;

  for (const band of handle.bands) {
    const u = band.material.uniforms;
    (u.uTerrainRadiance.value as THREE.Vector3).set(r, g, b);

    // 방위별 연무를 정점 속성에 씁니다. 정점은 방위 s 마다 2개(아래/위)입니다.
    const hz = band.mesh.geometry.getAttribute('aHaze') as THREE.BufferAttribute;
    const el = band.mesh.geometry.getAttribute('aElevDeg') as THREE.BufferAttribute;
    for (let s = 0; s < TERRAIN_SEGMENTS; s++) {
      const az = (s / TERRAIN_SEGMENTS) * 360;
      // 능선 꼭대기 바로 뒤 하늘을 씁니다. 아래쪽 정점은 -30°라 하늘이
      // 없으므로 같은 값을 넣습니다 (거기는 어차피 앞 띠에 가려집니다).
      const topDeg = Math.max(0.3, el.getX(s * 2 + 1));
      const h = opts.hazeAt(az, topDeg);
      hz.setXYZ(s * 2, h.r, h.g, h.b);
      hz.setXYZ(s * 2 + 1, h.r, h.g, h.b);
    }
    hz.needsUpdate = true;
    u.uBeta.value = opts.betaMie;
    u.uAngstrom.value = opts.angstrom;
    u.uElevScale.value = opts.elevScale;
    u.uSunAltDeg.value = sunAltitude;
    u.uSaturation.value = (opts.saturation ?? 1.0) * 0.55;
  }
}

/**
 * 1x1 기본 육지 마스크 2D 텍스처를 생성합니다.
 */
export function createDummyWaterMask2D(): THREE.DataTexture {
  const data = new Uint8Array(4);
  data[0] = 0; data[1] = 0; data[2] = 0; data[3] = 255;
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/**
 * 지평선 발 아래 전체를 덮는 3D 대지(Ground Plane) 원반 Mesh를 생성합니다.
 */
export function createGroundPlane(): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(TERRAIN_RING_RADIUS, 64);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...makeTuningUniforms(),
      // 지면이 되쏘는 복사휘도 (선형). 하늘과 **같은 단위**입니다.
      uGroundRadiance: { value: new THREE.Vector3(0.02, 0.019, 0.015) },
      uSunAzRad: { value: 0 },
      uSunAltDeg: { value: 30 },
      uSaturation: { value: 1.0 },
      uSheen: { value: 0.0 },
      uExposure: { value: 1.0 },
      uWaterTex2D: { value: createDummyWaterMask2D() },
      uSurfaceIrr: { value: new THREE.Vector3(0.05, 0.06, 0.08) },
      uHasWater: { value: 0.0 },
      uSunRadiance: { value: new THREE.Vector3(0, 0, 0) },
      uSunAltRad: { value: 0.5 },
      uSlopeVar: { value: 0.03 },
      uBeta: { value: 0.08 },
      uAngstrom: { value: 1.3 },
      uElevScale: { value: 1.0 },
      uOzoneDU: { value: 330 },
      uMoonRadiance: { value: new THREE.Vector3(0, 0, 0) },
      uMoonAzRad: { value: 0 },
      uMoonAltRad: { value: 0 },
      uNightFactor: { value: 0.0 },
    },
    vertexShader: GROUND_VERT,
    fragmentShader: GROUND_FRAG,
    side: THREE.DoubleSide,
    depthWrite: false, // 산 능선 메쉬를 가리지 않도록 깊이 기록을 끕니다.
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: 3,
    polygonOffsetUnits: 3,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'groundPlane';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.5; // 발밑 바로 아래 배치하여 산 능선 및 바다 링과 z-fighting 차단
  // ── renderOrder: 스카이돔(−1) 뒤, 지형 링(-0.4 ~ -0.3) 앞 ──────────────────────
  mesh.renderOrder = -0.5;

  return mesh;
}

/**
 * 3D 씬 내부에 지평선 방위 링과 N, E, S, W 방위 표시 선 및 포인트를 생성하는 그룹을 만듭니다.
 */
export function createCompassGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'compassGroup';

  // 1. 방위 링 (Circle Line)
  const ringRadius = 475;
  const ringPoints: THREE.Vector3[] = [];
  const segments = 72;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    ringPoints.push(new THREE.Vector3(Math.sin(theta) * ringRadius, 0.2, -Math.cos(theta) * ringRadius));
  }
  const ringGeom = new THREE.BufferGeometry().setFromPoints(ringPoints);
  const ringMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.35,
  });
  const ringLine = new THREE.Line(ringGeom, ringMat);
  group.add(ringLine);

  // 2. 주요 방위축 십자선 (N-S, E-W)
  const axisPoints: THREE.Vector3[] = [
    // N - S (Z축)
    new THREE.Vector3(0, 0.2, -ringRadius),
    new THREE.Vector3(0, 0.2, ringRadius),
    // E - W (X축)
    new THREE.Vector3(-ringRadius, 0.2, 0),
    new THREE.Vector3(ringRadius, 0.2, 0),
  ];
  const axisGeom = new THREE.BufferGeometry().setFromPoints(axisPoints);
  const axisMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.2,
  });
  const axisLines = new THREE.LineSegments(axisGeom, axisMat);
  group.add(axisLines);

  // 3. 주요 8방위 노치 마커 (Points)
  const markerPositions: number[] = [];
  const markerColors: number[] = [];
  const directions = [
    { name: 'N', az: 0, main: true },
    { name: 'NE', az: 45, main: false },
    { name: 'E', az: 90, main: true },
    { name: 'SE', az: 135, main: false },
    { name: 'S', az: 180, main: true },
    { name: 'SW', az: 225, main: false },
    { name: 'W', az: 270, main: true },
    { name: 'NW', az: 315, main: false },
  ];

  directions.forEach(dir => {
    const rad = (dir.az * Math.PI) / 180;
    const x = Math.sin(rad) * ringRadius;
    const z = -Math.cos(rad) * ringRadius;
    markerPositions.push(x, 0.5, z);

    if (dir.name === 'N') {
      // 북쪽(N)은 붉은색 강렬한 마커
      markerColors.push(0.94, 0.25, 0.37);
    } else if (dir.main) {
      // 동, 남, 서는 연푸른색
      markerColors.push(0.22, 0.74, 0.97);
    } else {
      // 보조 방위는 은은한 백색
      markerColors.push(0.6, 0.7, 0.8);
    }
  });

  const markerGeom = new THREE.BufferGeometry();
  markerGeom.setAttribute('position', new THREE.Float32BufferAttribute(markerPositions, 3));
  markerGeom.setAttribute('color', new THREE.Float32BufferAttribute(markerColors, 3));

  const markerMat = new THREE.PointsMaterial({
    size: 10,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
  });
  const markers = new THREE.Points(markerGeom, markerMat);
  group.add(markers);

  return group;
}

const tempSunDir = new THREE.Vector3();
const tempNormal = new THREE.Vector3();

export function disposeTerrainRing(mesh: THREE.Mesh): void {
  mesh.geometry?.dispose();
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach(m => m.dispose());
  } else {
    (mesh.material as THREE.Material)?.dispose();
  }
}

export function disposeGroundPlane(mesh: THREE.Mesh): void {
  mesh.geometry?.dispose();
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach(m => m.dispose());
  } else {
    (mesh.material as THREE.Material)?.dispose();
  }
}

export function disposeCompassGroup(group: THREE.Group): void {
  group.traverse(child => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.LineSegments || child instanceof THREE.Points) {
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        (child.material as THREE.Material)?.dispose();
      }
    }
  });
}

/**
 * 지형 및 지면 색상을 태양 고도, 방위각, 날씨에 따라 입체 음영(Hillshading)으로 업데이트합니다.
 */
export function updateTerrainColors(
  mesh: THREE.Mesh,
  sunAltitude: number,
  sunAzimuth: number = 180,
  overcast: number = 0,
  dustIntensity: number = 0
): void {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const colorAttr = geometry.attributes.color as THREE.BufferAttribute;
  if (!colorAttr) return;

  const t = clamp01((sunAltitude + 6) / 14);

  const sunsetGlowFactor = Math.max(0, 1.0 - (overcast * 1.3 + dustIntensity * 0.9)) *
    (1.0 - Math.pow(Math.abs(t - 0.4) / 0.4, 2));
  const glow = clamp01(sunsetGlowFactor);

  // 태양 입사광 단위 벡터 L
  const altRad = (sunAltitude * Math.PI) / 180;
  const azRad = (sunAzimuth * Math.PI) / 180;
  tempSunDir.set(
    Math.sin(azRad) * Math.cos(altRad),
    Math.sin(altRad),
    -Math.cos(azRad) * Math.cos(altRad)
  ).normalize();

  const nightBase = { r: 0.04, g: 0.05, b: 0.10 };
  const dayBase = { r: 0.16, g: 0.22, b: 0.17 };
  const goldenBase = { r: 0.28, g: 0.14, b: 0.08 };

  const nightTop = { r: 0.07, g: 0.08, b: 0.15 };
  const dayTop = { r: 0.28, g: 0.26, b: 0.22 };
  const goldenTop = { r: 0.42, g: 0.20, b: 0.12 };

  const severity = Math.max(overcast, dustIntensity);
  const grayR = 0.15, grayG = 0.16, grayB = 0.17;

  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

  const count = colorAttr.count; // TERRAIN_SEGMENTS * 2
  const segments = count / 2;

  for (let i = 0; i < segments; i++) {
    // 세그먼트별 지형 법선 벡터 N (지평선 원통 세그먼트 방향)
    const segAz = (i / segments) * Math.PI * 2;
    tempNormal.set(Math.sin(segAz), 0.1, -Math.cos(segAz)).normalize();

    // 태양 입사각 내적 N dot L (입체 음영 요인)
    const dot = Math.max(-0.4, Math.min(1.0, tempNormal.dot(tempSunDir)));
    const hillshade = (dot + 0.4) / 1.4; // 0 ~ 1 범위로 정규화

    const bIdx = i * 2;
    const tIdx = i * 2 + 1;

    // 하단/상단 기본 색상
    const baseB = { r: lerp(nightBase.r, dayBase.r, t), g: lerp(nightBase.g, dayBase.g, t), b: lerp(nightBase.b, dayBase.b, t) };
    const baseT = { r: lerp(nightTop.r, dayTop.r, t), g: lerp(nightTop.g, dayTop.g, t), b: lerp(nightTop.b, dayTop.b, t) };

    // 음영(Hillshading) 반영: 양지는 밝고 구릿빛, 음지는 딥블루 그림자
    const shadeFactor = 0.4 + hillshade * 0.75;
    baseB.r *= shadeFactor; baseB.g *= shadeFactor; baseB.b *= shadeFactor;
    baseT.r *= shadeFactor; baseT.g *= shadeFactor; baseT.b *= shadeFactor;

    if (glow > 0.05) {
      baseT.r = lerp(baseT.r, goldenTop.r * hillshade, glow * 0.7);
      baseT.g = lerp(baseT.g, goldenTop.g * hillshade, glow * 0.7);
      baseT.b = lerp(baseT.b, goldenTop.b * hillshade, glow * 0.7);
    }

    if (severity > 0.1) {
      baseB.r = lerp(baseB.r, grayR, severity * 0.7);
      baseB.g = lerp(baseB.g, grayG, severity * 0.7);
      baseB.b = lerp(baseB.b, grayB, severity * 0.7);
      baseT.r = lerp(baseT.r, grayR, severity * 0.7);
      baseT.g = lerp(baseT.g, grayG, severity * 0.7);
      baseT.b = lerp(baseT.b, grayB, severity * 0.7);
    }

    colorAttr.setXYZ(bIdx, baseB.r, baseB.g, baseB.b);
    colorAttr.setXYZ(tIdx, baseT.r, baseT.g, baseT.b);
  }

  colorAttr.needsUpdate = true;
}

/**
 * 지면 원반의 밝기를 **조도 × 알베도**로 계산합니다.
 *
 * 예전에는 `nightG` / `dayG` / `goldenG` 상수를 태양 고도로 섞었습니다.
 * 근거가 없었고, 무엇보다 지면이 `MeshBasicMaterial`이라 하늘과 **다른 축**에
 * 있었습니다 — 하늘만 `atm_display`(톤매핑 + 눈 순응)를 통과했으니 두 밝기를
 * 비교할 방법이 아예 없었고, 그래서 상수를 손으로 맞출 수밖에 없었습니다.
 *
 * 이제 둘 다 선형 복사휘도로 계산해 같은 `atm_display`를 통과합니다.
 *
 *     지면 휘도 = (하늘에서 온 조도 + 직달 조도) × 알베도 / π
 *
 * 하늘 조도는 반구 평균 복사휘도 `L̄` 에서 `E = π·L̄` 이므로,
 * 나눗셈이 상쇄되어 `L̄ × 알베도` 가 됩니다. 직달 쪽만 `/π` 가 남습니다.
 *
 * **결과적으로 지면은 하늘보다 알베도 배(≈0.2)만큼 어둡습니다.** 이게 실제
 * 모습이고, 예전에 지평선 아래가 하늘보다 밝았던 것이 거꾸로였습니다.
 */
export function updateGroundColors(
  mesh: THREE.Mesh,
  sunAltitude: number,
  overcast: number = 0,
  opts?: {
    /** 반구 평균 하늘 복사휘도 (선형). 없으면 태양 고도로 근사합니다. */
    skyMean?: { r: number; g: number; b: number };
    /** 지면 고도에서의 직달광 (선형, `beamAtAltitude(alt, 0, atm)`). */
    beam?: { r: number; g: number; b: number };
    /** 구름을 통과한 직달광 비율 (0~1). */
    sunTransmittance?: number;
    sunAzimuthDeg?: number;
    saturation?: number;
    /** 2D 수역 마스크 (해안선·만·반도 + 강·호수). createWaterMask2DTexture로 구운 것을 넘깁니다. */
    waterTex2D?: THREE.DataTexture | null;
    /** 하위 호환용 방위별 수역 텍스처 */
    waterTex?: THREE.DataTexture | null;
    /** 대기 파라미터 — 물이 되비출 하늘을 셰이더 안에서 직접 계산합니다. */
    betaMie?: number;
    angstrom?: number;
    elevScale?: number;
    ozoneDU?: number;
    /** 10m 고도 풍속 (m/s). 윤슬 폭이 이걸로 정해집니다. */
    windSpeedMs?: number;
    /** 달 고도, 방위각 및 위상 (밤 대지 조명용) */
    moonAltitudeDeg?: number;
    moonAzimuthDeg?: number;
    moonFraction?: number;
    /**
     * 달빛이 지면에 주는 조도/π (선형 RGB) — 하늘·구름과 **같은 달빛**(§92, `moonLight` 이득 ×
     * "해를 달 자리에 둔 낮" 의 지면 조도). 없으면 달빛을 안 씁니다.
     */
    moonIrradiance?: { r: number; g: number; b: number } | null;
  }
): void {
  const mat = mesh.material as THREE.ShaderMaterial;
  if (!mat?.uniforms?.uGroundRadiance) return;
  const u = mat.uniforms;

  const sunT = clamp01(opts?.sunTransmittance ?? 1 - overcast);
  const sinAlt = Math.max(0, Math.sin((sunAltitude * Math.PI) / 180));

  // 하늘 조도. 실측값이 없으면 태양 고도에 따른 대략적인 반구 평균으로
  // 대신합니다 (호출부가 값을 넘기면 그쪽이 항상 우선입니다).
  const sky = opts?.skyMean ?? fallbackSkyMean(sunAltitude);
  const beam = opts?.beam ?? { r: 0, g: 0, b: 0 };

  // E_sky/π = L̄  이므로 하늘 항은 알베도만 곱하면 됩니다.
  // 직달 항은 수평면 조도이므로 sin(고도)를 곱하고 π로 나눕니다.
  const direct = (sinAlt * sunT) / Math.PI;
  const r = sky.r * GROUND_ALBEDO.r + beam.r * direct * GROUND_ALBEDO.r;
  const g = sky.g * GROUND_ALBEDO.g + beam.g * direct * GROUND_ALBEDO.g;
  const b = sky.b * GROUND_ALBEDO.b + beam.b * direct * GROUND_ALBEDO.b;

  (u.uGroundRadiance.value as THREE.Vector3).set(r, g, b);
  // 수면에 닿는 **조도**를 알베도 곱하기 전 상태로 넘깁니다. 수체·거품·
  // 하늘 되비침이 전부 이 하나에서 나오므로, 낮·노을·밤이 따로 손대지
  // 않아도 맞습니다.
  if (u.uSurfaceIrr) {
    (u.uSurfaceIrr.value as THREE.Vector3).set(
      sky.r + beam.r * direct,
      sky.g + beam.g * direct,
      sky.b + beam.b * direct,
    );
  }
  u.uSunAltDeg.value = sunAltitude;
  u.uSunAzRad.value = ((opts?.sunAzimuthDeg ?? 180) * Math.PI) / 180;
  // 지면 채도는 하늘보다 낮춥니다.
  u.uSaturation.value = (opts?.saturation ?? 1.0) * 0.55;

  // 전방산란 광택은 직달광이 있을 때만 의미가 있습니다.
  const lowSun = clamp01(1 - Math.abs(sunAltitude) / 25);
  u.uSheen.value = 0.75 * sunT * lowSun * clamp01(sunAltitude / 3 + 1);

  // 국소 순응 배율
  u.uExposure.value = GROUND_EXPOSURE;

  // ── 밤 대지 조명 & 달빛 산란 (Night Factor & Moonlight) ───────────────────
  // 태양 고도가 0도 아래로 내려갈수록 밤 인자가 1에 가까워집니다.
  const nightFactor = clamp01((-sunAltitude) / 12);
  if (u.uNightFactor) {
    u.uNightFactor.value = nightFactor;
  }

  const moonAltDeg = opts?.moonAltitudeDeg ?? -90;
  const moonAzDeg = opts?.moonAzimuthDeg ?? 180;
  const moonFrac = opts?.moonFraction ?? 0;
  const moonSinAlt = Math.max(0, Math.sin((moonAltDeg * Math.PI) / 180));

  // ⚠ 예전에는 `고도 사인 × (0.038·위상 + 0.006)` 의 **가짜 상수**(보름 고도 54° 에서 0.036)였습니다.
  //   §92 에서 하늘·구름의 달빛을 물리값(이득 약 0.002)으로 바꾸면서 여기만 남았고, 밤하늘보다 열 배
  //   넘게 밝은 지면에 밤 순응(§95)이 곱해져 **땅이 하얗게** 탔습니다(마쓰모토, 2026-09-26 23:59).
  //   이제 호출부가 하늘·구름과 같은 식으로 구한 값을 받습니다.
  void moonFrac;
  if (u.uMoonRadiance) {
    const m = opts?.moonIrradiance;
    if (nightFactor > 0.01 && moonSinAlt > 0 && m) {
      (u.uMoonRadiance.value as THREE.Vector3).set(m.r, m.g, m.b);
    } else {
      (u.uMoonRadiance.value as THREE.Vector3).set(0, 0, 0);
    }
  }

  if (u.uMoonAzRad) {
    u.uMoonAzRad.value = (moonAzDeg * Math.PI) / 180;
  }
  if (u.uMoonAltRad) {
    u.uMoonAltRad.value = (moonAltDeg * Math.PI) / 180;
  }

  // ── 물 ────────────────────────────────────────────────────────────────
  const wTex = opts?.waterTex2D ?? opts?.waterTex;
  if (wTex && u.uWaterTex2D) {
    u.uWaterTex2D.value = wTex;
    u.uHasWater.value = 1.0;
  } else if (u.uHasWater) {
    u.uHasWater.value = 0.0;
  }
  const bm = opts?.beam ?? { r: 0, g: 0, b: 0 };
  (u.uSunRadiance.value as THREE.Vector3).set(bm.r * sunT, bm.g * sunT, bm.b * sunT);
  u.uSunAltRad.value = (sunAltitude * Math.PI) / 180;
  u.uBeta.value = opts?.betaMie ?? 0.08;
  u.uAngstrom.value = opts?.angstrom ?? 1.3;
  u.uElevScale.value = opts?.elevScale ?? 1.0;
  u.uOzoneDU.value = opts?.ozoneDU ?? 330;
  // Cox & Munk (1954). 풍속이 0이어도 잔물결이 있어 0.003이 바닥입니다.
  u.uSlopeVar.value = 0.003 + 0.00512 * Math.max(0, opts?.windSpeedMs ?? 5.5);
}

/**
 * 호출부가 실제 하늘 값을 못 넘길 때 쓰는 반구 평균 근사.
 * 맑은 하늘의 대략적인 밝기 곡선일 뿐이고, 실측이 있으면 항상 그쪽을 씁니다.
 */
function fallbackSkyMean(sunAltDeg: number): { r: number; g: number; b: number } {
  const day = clamp01((sunAltDeg + 6) / 14);
  const night = 0.006;
  const noon = 0.55;
  const s = night + (noon - night) * day * day;
  return { r: s * 0.85, g: s * 0.95, b: s * 1.15 };
}
