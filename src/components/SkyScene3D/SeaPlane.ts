/**
 * **해수면 — 따로 있는 면** (docs/COASTLINE_PLAN.md 4단계).
 *
 * 해안선을 마스크로 그리는 대신, 물을 **진짜 면**으로 두고 땅과 만나게
 * 합니다. 그러면 만·곶·섬이 따로 손대지 않아도 제 모양으로 나옵니다.
 * 방위 해상도 12° 라는 한계 자체가 사라집니다 — 30m 격자가 정하니까요.
 *
 * ## 땅과 **같은 투영**을 씁니다
 *
 * `groundProjection.ts` 의 `gp_project` 하나를 양쪽이 씁니다. 44절에서 지면과
 * 구름이 서로 다른 지평선을 쓰다가 0.79° 짜리 띠가 벌어진 적이 있습니다.
 * 눈높이도 **DEM 이 정한 같은 값**을 씁니다 — 어긋나면 해안선이 교선이
 * 아니게 됩니다.
 *
 * ## 왜 지면 격자보다 훨씬 멀리 가는가
 *
 * 지면 격자는 3km 에서 끝나는데, 눈높이 43.6m 의 진짜 수평선은 **23.6km**
 * 밖입니다. 2단계 판정에서 그 사이 **0.634°** 가 안 덮이는 것을 쟀습니다.
 * 바다가 그 자리를 이어받아야 물 위에 하늘이 새지 않습니다.
 *
 * ## 수평선 너머는 접습니다
 *
 * 구면에서 눈높이 h 의 수평선 거리는 `sqrt(2Rh)` 이고, 그 지점의 고도각이
 * 정확히 `−dip` 입니다. 그보다 먼 바다는 **안 보입니다.** 포물선 근사를
 * 그대로 두면 각이 다시 내려가 면이 접히므로, 거리를 수평선 거리로
 * 잘라 정점을 수평선 위에 모읍니다.
 */
import * as THREE from 'three';
import { DEM_GLSL, demGlsl, makeDemUniforms, type DemPatch } from '../../utils/demTiles';
import {
  GROUND_PROJECT_GLSL, createConcentricGeometry, seaHorizonDistM,
} from './groundProjection';
import {
  ATMOSPHERE_GLSL, GROUND_DISPLAY_GLSL, makeTuningUniforms,
} from '../../utils/atmosphere';
import {
  CLOUD_SHADOW_GLSL, CLOUD_SHADOW_HALF_M, createOpenSkyShadowTexture,
} from '../../utils/cloudShadowMap';

/**
 * 바다 격자가 뻗는 거리 (m).
 *
 * 눈높이 1.6m 면 수평선이 4.5km, 100m 산이면 35.7km 입니다. 셰이더가 실제
 * 수평선 거리로 자르므로 여기는 **넉넉하게** 잡으면 됩니다.
 */
export const SEA_FAR_M = 60000;

export const SEA_RINGS = 96;
export const SEA_SPOKES = 256;

/**
 * **물이 있는지 없는지**만 가리는 성긴 높이장의 반경 (m).
 *
 * 수심·포말을 재는 촘촘한 패치는 3km 에서 끝납니다. 그 밖을 "모르니까 물"
 * 로 두었더니 **내륙 한복판에도 수평선까지 바다가 깔렸습니다** — 서울
 * 도곡동(해발 70m)에서 사방에 물이 고여 보인다는 실기 보고가 그것입니다.
 * 물 마스크는 30m 가 필요 없으므로(3km 밖의 바다는 수평선 근처 1° 안으로
 * 눌립니다) 같은 3×3 블록을 **훨씬 낮은 줌**으로 받아 60km 를 덮습니다 —
 * 줌 9, 화소 약 243m, 타일 아홉 장.
 */
export const SEA_MASK_RADIUS_M = 60000;

export const SEA_VERT = /* glsl */ `
precision highp float;
${DEM_GLSL}
${demGlsl('seaMask')}
${GROUND_PROJECT_GLSL}
uniform float uObsElevM;
uniform float uEyeHeightM;
varying float vDistM;
varying float vDepthM;   // 수심 (m) — 물가 표현의 재료 (5단계)
varying float vWater;    // 1 = 물, 0 = 뭍 (프래그먼트에서 버립니다)
varying vec3  vGround;
// 눈(메시 원점)에서 이 점으로 가는 단위 방향. 하늘 되비침의 거울 방향을
// 여기서 뒤집어 씁니다 (프래그먼트 셰이더 주석 참고).
varying vec3  vViewDir;

/** ⚠ TerrainField 의 groundAtEye 와 **같은 식**이어야 합니다. */
float groundAtEye() {
  return uDemValid > 0.5 ? dem_elevationAt(vec2(0.0)) : uObsElevM;
}

void main() {
  vec2  g = vec2(position.x, position.z);
  float r = position.y;
  float eye = groundAtEye() + uEyeHeightM;

  // 수평선 너머는 안 보입니다 — 거리를 잘라 정점을 수평선에 모읍니다.
  float dHor = sqrt(2.0 * GP_R_EARTH * max(eye, 0.01));
  float d = length(g);
  vec2 gc = d > dHor ? g * (dHor / max(d, 1e-4)) : g;

  vDistM = min(d, dHor);

  // ── 수심 ────────────────────────────────────────────────────────────────
  // ⚠ 여기에 함정이 둘 있고 **둘 다 "0 을 0m 로 믿는 것"** 입니다.
  //
  //  ① 패치 **밖**을 0 으로 두면 수심 0m, 즉 온 바다가 물가가 되어 포말이
  //     수평선까지 깔립니다.
  //  ② 패치 **안**이라도 Terrarium 은 **먼바다를 정확히 0 으로 자릅니다**
  //     (조사 때 표본 1024개 중 406개가 정확히 0). 그걸 0m 로 믿으면 바닥이
  //     그대로 다 비치고 포말이 1 이 되어, 만 전체가 밝은 모래펄로 그려집니다.
  //
  // 그래서 **모르는 곳은 깊다**고 둡니다. 쌍선형 보간 덕에 물가 근처는 0 이
  // 아닌 작은 값이 나오므로, 정확히 0 인 곳만 "자료 없음"으로 갈립니다.
  float hs = dem_elevationAt(gc);
  bool known = uDemValid > 0.5 && dem_inside(gc) > 0.5 && hs < 0.0;
  vDepthM = known ? -hs : 999.0;
  vGround = vec3(gc.x, 0.0, gc.y);

  // ── 여기가 물이긴 한가 ──────────────────────────────────────────────────
  // 수심(위)은 **물빛**만 정합니다. 물이 **있는지**는 따로 물어야 합니다.
  // 예전에는 안 물었고, 그래서 해수면이 방위를 가리지 않고 수평선까지
  // 깔렸습니다. 3km 안에서는 지형 격자가 가려 주니 안 보였지만, 그 밖에는
  // 가려 줄 것이 없어 **내륙에서도 사방에 물 띠**가 났습니다(0.46°).
  //
  // ⚠ **촘촘한 것이 먼저** 입니다. 성긴 마스크를 앞에 두었더니 물가가
  // 통째로 죽었습니다 — 화소 한 칸이 243m 라 해안선이 뭍 쪽으로 뭉개지고,
  // 바닷가에 선 관측자의 발밑 물이 전부 뭍으로 읽혔습니다(대조 판정에서
  // 727화소 → 128화소). 그래서 3km 안은 30m 자료가 정하고, 성긴 마스크는
  // **그 밖에서만** 말합니다. 둘 다 없으면 예전처럼 전부 물 — 높이장이
  // 아예 없을 때의 평판 대체는 그대로 둡니다.
  float hm =
      (uDemValid > 0.5 && dem_inside(gc) > 0.5) ? dem_elevationAt(gc)
    : (uSeaMaskValid > 0.5)                     ? seaMask_elevationExtended(gc)
    : (uDemValid > 0.5)                         ? dem_elevationExtended(gc)
    :                                             -1.0;
  vWater = hm <= 0.0 ? 1.0 : 0.0;

  // 해수면 고도는 0 — 정의상 이것이 기준면입니다.
  vec3 p = gp_project(gc, 0.0, eye, r);
  // ⚠ 눈은 메시 원점(로컬 좌표계 원점)에 있습니다 — p 자체가 이미 "눈에서
  //   이 점으로"인 방향이라, normalize(p) 가 바로 시선 방향입니다. 카메라의
  //   실제 world Y(구 화면단위 dip 트릭 값)를 여기서 다시 읽으면 안
  //   됩니다 — 그러면 물리 눈높이(uEyeHeightM, 미터)와 화면단위 트릭이
  //   섞여 이중으로 셉니다.
  vViewDir = normalize(p);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/**
 * 물빛 — **수심**과 **프레넬**에서 물가가 전부 따라옵니다 (5단계 + 3단계 연결).
 *
 * 49절에서 물빛을 조도 × 알베도로, 진짜 프레넬로 되돌렸습니다. 그때 고친
 * 로직(`TerrainRing.ts` 의 물 갈래)이 이 씬에는 아직 없었으므로, 여기서
 * **그 물리를 그대로 옮겨** 옵니다 — 옮기지 않으면 새 지형에 씬을 연결하는
 * 순간 노을에 하늘을 비추던 물이 다시 상수색 평면으로 되돌아갑니다.
 *
 * | 보이는 것 | 수심/각도에서 |
 * |---|---|
 * | 얕은 물의 청록 | 흡수 `exp(−k·2d)` — 붉은빛이 먼저 먹힙니다 |
 * | 바닥이 비침 | 같은 투과율로 바닥 알베도가 올라옵니다 |
 * | 물가 포말 띠 | 수심 < `uFoamDepthM` — 거리가 아니라 수심으로 재므로 폭이 경사를 따릅니다 |
 * | **노을 하늘이 비침 · 발밑은 짙은 청록** | `waterFresnel(cosV)` — 스치는 각(지평선 쪽)일수록 하늘이 이깁니다 |
 *
 * ## 시선 방향은 `vViewDir` 하나로 풉니다
 *
 * 거울 방향은 시선을 평균면(법선 = 수직) 기준으로 뒤집은 것뿐입니다 —
 * `reflect(dir,(0,1,0)) = (dir.x, −dir.y, dir.z)`. `vViewDir` 는 이미
 * "눈에서 이 점으로"인 단위벡터(버텍스 셰이더의 `normalize(p)`)라 그대로
 * 씁니다. **카메라의 world Y 는 여기서 절대 다시 읽지 않습니다** — 그건
 * 화면단위 dip 트릭 값이라, 물리 눈높이(미터)와 섞이면 이중으로 셉니다.
 *
 * ## 윤슬 — Cox-Munk 가 폭을 정합니다
 *
 * 프레넬 × 하늘만 있으면 태양 둘레가 통째로 뭉근하게 밝아질 뿐 **좁고
 * 반짝이는 길**이 안 생깁니다. 실기에서 "파도 진폭이 어마어마하게 큰지
 * 윤슬 폭이 너무 넓어 물 같지 않다"는 말이 나온 것이 이것입니다 —
 * 재 보니 밝은 길의 반높이 폭이 43~68°, 봉우리 대비는 겨우 1.06~1.19배
 * 였고, 풍속을 1 → 8 m/s 로 올려도 **꿈쩍도 안 했습니다**(항이 아예
 * 없었으니 당연합니다).
 *
 * 평균면(법선 수직) 기준으로 반각 벡터 H 를 세우면, 그 화소가 태양을 눈에
 * 보내려면 수면 조각이 얼마나 기울어야 하는지를 `H.y` 가 그대로 말해
 * 줍니다. Cox-Munk 의 경사 확률밀도
 *
 *     p = exp(−tan²θ / σ²) / (π σ² cos⁴θ),   σ² = 0.003 + 0.00512·U
 *
 * 를 그대로 씁니다 — **폭을 정하는 것은 이 σ 하나** 입니다. `TerrainRing`
 * 에서 여기에 풍속과 무관한 고정 로브를 얹었다가 폭이 29.8° 에 붙박여
 * 움직이지 않은 적이 있어, 여기서는 아예 얹지 않습니다.
 */
export const SEA_FRAG = /* glsl */ `
precision highp float;
${ATMOSPHERE_GLSL}
${GROUND_DISPLAY_GLSL}
${CLOUD_SHADOW_GLSL}
uniform vec3  uSurfaceIrr;
uniform vec3  uSunRadiance;
uniform float uSunAzRad;
uniform float uSunAltRad;
uniform vec3  uWaterAlbedo;
uniform vec3  uBedAlbedo;     // 바닥(모래·펄) 알베도
uniform float uFoamDepthM;
uniform float uExposure;
uniform float uSaturation;
uniform float uSunAltDeg;
uniform vec3  uHazeRadiance;
uniform float uAerial;
uniform float uFresnel;       // 0 이면 하늘 되비침을 끕니다 (기하 판정용)
uniform float uSlopeVar;      // Cox-Munk 파면 경사 분산 σ² = 0.003 + 0.00512·U
uniform float uGlitter;       // 0 이면 윤슬을 끕니다 (대조 판정용)
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;
uniform float uOzoneDU;
varying float vDistM;
varying float vDepthM;
varying float vWater;
varying vec3  vGround;
varying vec3  vViewDir;

/** 청정 해수 흡수계수 (1/m). 붉은빛이 먼저 먹힙니다. */
const vec3 SEA_ABSORB = vec3(0.45, 0.09, 0.035);

/** 프레넬 반사율 (Schlick, 물 n=1.33 → F0 = 0.02). TerrainRing.ts 와 같은 식. */
float waterFresnel(float cosTheta) {
  float f = pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
  return 0.02 + 0.98 * f;
}

void main() {
  // ⚠ 되비침(하늘·태양)은 **거울에 비친 것**이라, 어두운 흙바닥을 살리려고
  // 둔 지면용 눈 순응(최대 3배)을 그대로 먹으면 안 됩니다. 먹였더니 물이
  // **제가 비추는 하늘보다 1.20배 밝아졌습니다** — 프레넬 반사율이 1 이하인
  // 거울에서는 있을 수 없는 일입니다. 화면 전체가 톤 곡선 꼭대기(220~255)에
  // 눌려, 윤슬을 얹어도 폭이 한 도도 안 움직였습니다.
  //
  // atm_display_ground 가 곱할 그 배수를 되비침에서만 미리 나눠, 되비침이
  // 하늘과 **같은 노출**로 표시되게 합니다. 수체·바닥·포말은 조도 × 알베도
  // 라 지면과 같은 것이므로 그대로 둡니다.
  float eyeAdapt = atm_groundEyeAdapt(uSunAltDeg);

  // 물이 아닌 곳에는 아무것도 안 그립니다 — 먼저 그린 옛 지면 원반이
  // 그 자리를 그대로 이어받습니다. 삼각형이 물가를 걸치면 0.5 등고선이
  // 경계가 되고, 그건 땅 격자가 vElevM <= 0 에서 버리는 자리와 같습니다.
  if (vWater < 0.5) discard;

  // 왕복 경로라 수심의 두 배를 지납니다.
  vec3 thru = exp(-SEA_ABSORB * 2.0 * clamp(vDepthM, 0.0, 40.0));

  // 수체가 되돌리는 몫 + 바닥이 비치는 몫. 둘 다 조도 × 알베도입니다.
  vec3 body = uSurfaceIrr * (uWaterAlbedo + uBedAlbedo * thru);

  // ── 하늘 되비침 (프레넬) ─────────────────────────────────────────────────
  //
  // ⚠ uFresnel 로 끌 수 있습니다. 4단계 판정(verify-coastline.js)은
  // 화소를 R/B 우열로 땅/물을 가르는 **기하** 시험이라, 이 항을 켜 두면
  // 지평선 쪽 물이 하늘색(스치는 각 → Fv→1)으로 넘어가 파랑이 죽고 측정이
  // 무너집니다(다중 전환 측정이 986 → 821 로 떨어졌습니다). 색을 보는
  // 판정에서만 켭니다.
  vec3 col = body;
  if (uFresnel > 0.5) {
    vec3 dir = normalize(vViewDir);
    vec3 L = vec3(cos(uSunAltRad) * sin(uSunAzRad), sin(uSunAltRad),
                 -cos(uSunAltRad) * cos(uSunAzRad));
    // 평균면(법선 수직) 기준 거울 방향 — y 성분만 뒤집습니다.
    vec3 mirrorDir = vec3(dir.x, -dir.y, dir.z);
    float mirrorElevDeg = degrees(asin(clamp(mirrorDir.y, -1.0, 1.0)));
    float cosG = clamp(dot(mirrorDir, L), -1.0, 1.0);
    vec3 skyRefl = atm_skyRadiance(max(1.0, mirrorElevDeg), cosG, uSunAltDeg,
      max(0.001, uBeta), max(0.1, uAngstrom), max(0.1, uElevScale), max(50.0, uOzoneDU));
    // 바닥값은 가드이지 기여가 아닙니다 — 하늘 복사휘도가 이상할 때만
    // 검게 죽는 것을 막습니다 (49절: 상수를 깔면 태양 반대쪽 물이
    // 육지보다 밝아지는 결함이 났습니다).
    float sunWarmth = smoothstep(-2.0, 12.0, uSunAltDeg);
    vec3 skyFallback = uSurfaceIrr * 0.05 * mix(vec3(1.2, 0.8, 0.6), vec3(0.7, 0.95, 1.4), sunWarmth);
    skyRefl = clamp(max(skyFallback, skyRefl), vec3(0.0), vec3(12.0));

    // 반사와 수체의 몫은 프레넬이 정합니다 — 발밑(cosV↑)은 수체, 지평선
    // 쪽(cosV↓)은 하늘이 이깁니다. 그 대비가 물을 물로 보이게 합니다.
    float cosV = max(0.02, -dir.y);
    float Fv = waterFresnel(cosV);
    col = mix(body, skyRefl / eyeAdapt, Fv);
  }

  // ── 윤슬 (Cox-Munk) ─────────────────────────────────────────────────────
  //
  // ⚠ p 는 경사의 **확률분포**이므로 평균면(수직) 기준으로 재야 합니다.
  // 흔들린 법선에 대고 재면 같은 파도를 두 번 세는 셈입니다.
  if (uGlitter > 0.5) {
    vec3 dir = normalize(vViewDir);
    vec3 V = -dir;                       // 수면 → 눈
    vec3 L = vec3(cos(uSunAltRad) * sin(uSunAzRad), sin(uSunAltRad),
                 -cos(uSunAltRad) * cos(uSunAzRad));
    vec3 H = normalize(V + L + vec3(1e-5, 1e-4, 1e-5));
    float cosN = max(H.y, 1e-3);
    float tan2 = max(0.0, 1.0 - cosN * cosN) / (cosN * cosN);
    float sv = max(1e-3, uSlopeVar);
    float p = exp(-clamp(tan2 / sv, 0.0, 50.0)) / (3.14159265 * sv * pow(cosN, 4.0));
    p = clamp(p, 0.0, 220.0);
    float cosVg = max(0.02, V.y);
    float Fg = waterFresnel(clamp(dot(V, H), 0.0, 1.0));
    // ⚠ 상한을 8 로 두면 윤슬이 **아예 안 보입니다.** 태양 쪽 하늘 되비침이
    // 이미 4 쯤이라 2배도 못 되고, 그 자리는 톤 곡선이 거의 평평해 화면에서
    // 251 → 255 로 끝납니다. 되비친 태양은 되비친 하늘보다 자릿수로 밝은
    // 것이 물리이므로, 잘리는 자리를 훨씬 위로 올립니다. 폭은 여전히 σ
    // 하나가 정합니다 — 상한은 봉우리 높이만 건드립니다.
    // 윤슬은 **직달광**입니다 — 구름이 가리면 같이 죽습니다. 그래야 구름이
    // 지나갈 때 물 위의 빛줄기가 함께 흐려집니다.
    vec3 glitter = uSunRadiance * cloudShadowAt(vGround.xz) * Fg
                 * (p / max(1.0, 4.0 * cosVg)) * 3.0;
    col += clamp(glitter, vec3(0.0), vec3(60.0)) / eyeAdapt;
  }

  // 포말 — 수심으로 재므로 폭이 지형 경사를 따릅니다. 프레넬보다 위에 얹어
  // 거품은 반사와 무관하게 항상 보이게 합니다.
  float foam = 1.0 - smoothstep(0.0, max(0.02, uFoamDepthM), vDepthM);
  col = mix(col, uSurfaceIrr * vec3(0.70, 0.71, 0.72), foam);

  if (uAerial > 0.5) {
    vec3 T = atm_aerialTransmittance(vDistM / 1000.0, 0.0,
                                     uBeta, uAngstrom, uElevScale);
    col = col * T + uHazeRadiance * (1.0 - T);
  }

  gl_FragColor = vec4(atm_display_ground(col * uExposure, uSaturation, uSunAltDeg), 1.0);
}
`;

export interface SeaPlaneHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /**
   * 높이장을 갈아 끼웁니다. 둘째 인자는 **물 마스크**(성긴 60km 패치)이고,
   * 안 주면 예전 값을 그대로 둡니다.
   */
  setPatch: (patch: DemPatch | null, maskPatch?: DemPatch | null) => void;
  dispose: () => void;
}

export function createSeaPlane(opts: {
  patch?: DemPatch | null;
  /** 물이 있는 자리를 가리는 성긴 높이장 (`SEA_MASK_RADIUS_M` 반경). */
  maskPatch?: DemPatch | null;
  observerElevM?: number;
  eyeHeightM?: number;
  waterAlbedo?: { r: number; g: number; b: number };
  rings?: number;
  spokes?: number;
} = {}): SeaPlaneHandle {
  const a = opts.waterAlbedo ?? { r: 0.005, g: 0.038, b: 0.055 };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...makeDemUniforms(opts.patch ?? null),
      ...makeDemUniforms(opts.maskPatch ?? null, 'seaMask'),
      uObsElevM: { value: opts.observerElevM ?? 0 },
      uEyeHeightM: { value: opts.eyeHeightM ?? 1.6 },
      uSurfaceIrr: { value: new THREE.Vector3(0.05, 0.06, 0.08) },
      uSunRadiance: { value: new THREE.Vector3(0, 0, 0) },
      uSunAzRad: { value: 0 },
      uSunAltRad: { value: 0.5 },
      uWaterAlbedo: { value: new THREE.Vector3(a.r, a.g, a.b) },
      // 서해안 갯벌·모래 바닥. 얕은 데서만 보입니다.
      uBedAlbedo: { value: new THREE.Vector3(0.26, 0.22, 0.17) },
      // 부서지는 자리 — 수심 0.5m 안쪽.
      uFoamDepthM: { value: 0.5 },
      uExposure: { value: 1.0 },
      uSaturation: { value: 1.0 },
      uSunAltDeg: { value: 30 },
      uHazeRadiance: { value: new THREE.Vector3(0.05, 0.06, 0.09) },
      uAerial: { value: 1.0 },
      uFresnel: { value: 1.0 },
      uCloudShadowTex: { value: createOpenSkyShadowTexture() },
      uCloudShadowHalfM: { value: CLOUD_SHADOW_HALF_M },
      uCloudShadow: { value: 1.0 },
      // Cox & Munk (1954). 바람이 0 이어도 잔물결이 있어 0.003 이 바닥입니다.
      uSlopeVar: { value: 0.003 + 0.00512 * 5.5 },
      uGlitter: { value: 1.0 },
      uBeta: { value: 0.08 },
      uAngstrom: { value: 1.3 },
      uElevScale: { value: 1.0 },
      uOzoneDU: { value: 330 },
      ...makeTuningUniforms(),
    },
    vertexShader: SEA_VERT,
    fragmentShader: SEA_FRAG,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
    // 해수면 고도(0)에서 땅과 정확히 겹칩니다 — 물가가 반짝이지 않게
    // 바다를 아주 살짝 뒤로 밉니다. 땅의 가장자리가 해안선입니다.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  const mesh = new THREE.Mesh(
    createConcentricGeometry(
      opts.rings ?? SEA_RINGS, opts.spokes ?? SEA_SPOKES, SEA_FAR_M),
    material,
  );
  mesh.name = 'seaPlane';
  mesh.frustumCulled = false;

  return {
    mesh,
    material,
    setPatch: (patch, maskPatch) => {
      const put = (u: Record<string, { value: unknown }>) => {
        Object.entries(u).forEach(([k, v]) => {
          if (material.uniforms[k]) material.uniforms[k].value = v.value;
        });
      };
      put(makeDemUniforms(patch));
      if (maskPatch !== undefined) put(makeDemUniforms(maskPatch, 'seaMask'));
    },
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * 지면 격자와 **같이** 눈에 맞춥니다. 하나만 옮기면 교선이 어긋납니다.
 *
 * ⚠ Y 는 0 으로 고정합니다 — `TerrainField.updateTerrainFieldEye` 와 같은
 * 이유입니다. 카메라의 `position.y` 는 이 씬에서 화면단위 dip 트릭 값이라
 * (실제 미터가 아님), 메시에 그대로 더하면 셰이더가 이미 미터로 계산한
 * 눈높이와 겹쳐 이중으로 셉니다.
 */
export function updateSeaPlaneEye(handle: SeaPlaneHandle, camera: THREE.Camera): void {
  handle.mesh.position.set(camera.position.x, 0, camera.position.z);
}

/** 눈높이에서 수평선까지의 지상 거리 (m) — 판정이 같이 씁니다. */
export { seaHorizonDistM };
