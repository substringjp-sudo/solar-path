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
import { LAYER_TERRAIN_DIST, LAYER_TERRAIN_LIT, TERRAIN_DIST_GLSL } from './SceneComposer';
import { LIT2_ENCODE_GLSL, bindTerrainLook, makeTerrainLookUniforms } from './terrainLook';

/**
 * 바다 격자가 뻗는 거리 (m).
 *
 * 눈높이 1.6m 면 수평선이 4.5km, 100m 산이면 35.7km 입니다. 셰이더가 실제
 * 수평선 거리로 자르므로 여기는 **넉넉하게** 잡으면 됩니다.
 *
 * ⚠ **다만 "넉넉하게" 를 여기 숫자 하나로 올리면 안 됩니다.** 산꼭대기처럼
 * 눈높이가 이 값의 진짜 수평선 거리보다 낮은 자리에서 격자가 수평선에
 * 못 닿아 하늘 구멍이 남는데, 이 상수를 200km 로 올려 봤더니 (구멍화소로
 * 재면) **오히려 나빠졌습니다**(1,134 → 1,785화소, verify-disc-horizon) —
 * 아래 고정 고리 수(SEA_RINGS)가 12m~200km 전체에 다시 퍼지며 60km 언저리
 * (물가 판정이 재는 자리)의 밀도까지 옅어졌기 때문입니다. 수평선에 닿아야
 * 하는 자리는 SEA_TAIL_* 로 따로 늘립니다 — 아래 참고.
 */
export const SEA_FAR_M = 60000;

export const SEA_RINGS = 96;
export const SEA_SPOKES = 256;

/**
 * **산꼭대기 수평선 구멍을 막는 꼬리 고리** (disc-horizon 12절).
 *
 * `SEA_FAR_M`(60km)은 해수면 관측지 기준으로 잡은 값이라, 눈높이가 그보다
 * 높은 자리(예: 455m 산꼭대기, 진짜 수평선 76km)에서는 격자가 수평선에
 * 못 미칩니다. 정점 셰이더가 관측자의 진짜 수평선(`dHor = sqrt(2Rh)`) 보다
 * 먼 정점을 그 위로 접으므로, 격자가 `dHor` 를 **넘기만** 하면 발밑 고도와
 * 무관하게 수평선에서 정확히 만납니다.
 *
 * `SEA_FAR_M` 자체를 늘리는 대신(위 ⚠) `createConcentricGeometry` 의 `tail`
 * 로 60km **이후에만** 로그 고리를 추가합니다 — 0~60km 구간의 기존 96개
 * 고리는 하나도 안 옮기므로 물가 각짐(verify-shore-sdf · shorepatch)에는
 * 영향이 없습니다.
 *
 * ⚠ **`구멍화소` 총합으로는 이 꼬리의 효과가 안 보입니다.** 산꼭대기의
 * 1,134화소 중 74% 는 수평선과 무관한 별개 결함(16~22km 밖의 복잡한 실제
 * 해안선을 근거리·광역 격자가 다르게 근사)이라, 꼬리를 넣어도 총합은 그대로
 * 1,134입니다. **수평선-도달만 따로** 재면(물이 확실한 방위 하나에서 진짜
 * 수평선까지 남는 틈 — build-disc-horizon.js 의 `수평선틈`) 0.0208° →
 * **0.0052°** 로, 화소 한 칸 폭(0.0078°)보다 좁아집니다. verify-disc-horizon
 * 에 이 틈을 직접 못 박아 뒀습니다.
 *
 * 90km 는 눈높이 `90000² / (2R) ≈ 636m` 까지의 수평선을 덮습니다 —
 * 한라산·지리산·설악산 같은 고봉을 빼면 국내 대부분의 능선·전망대를
 * 포괄합니다. 그 이상은 다음에 필요할 때 늘립니다.
 */
export const SEA_TAIL_FAR_M = 90000;
export const SEA_TAIL_RINGS = 16;

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
uniform float uShoreLegacy;   // 1 이면 옛 물가 규칙 (판정이 A/B 로 씁니다)
uniform float uShoreOverlapM; // 물가에서 겹쳐 그릴 폭 (m)
varying float vDistM;
varying float vDepthM;   // 수심 (m) — 물가 표현의 재료 (5단계)
varying float vWater;    // 1 = 물, 0 = 뭍 (프래그먼트에서 버립니다)
varying float vBedSlope; // 바닥 기울기 (rise/run) — 포말 폭을 정합니다
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

  // ── 수심, 그리고 "이 0 을 믿어도 되는가" ─────────────────────────────────
  //
  // Terrarium 은 먼바다를 **정확히 0** 으로 자릅니다. 대부도 근거리 자료는
  // 38.55% 가 정확히 0 이고, 10.21% 가 −0.5~0 입니다.
  //
  // ⚠ **이건 근거리(줌 13) 이야기입니다.** 광역 마스크 패치(줌 9)를 같은
  //   자로 재 보니 정확히 0 은 0.08% 뿐이고 43.87% 가 음수, 가장 깊은 곳이
  //   −648m — **수심이 들어 있습니다.** 낮은 줌의 바다는 육지 전용 SRTM 이
  //   아니라 해저 지형 자료에서 오기 때문입니다. 그래서 아래 "고원이라
  //   못 믿는다" 논리는 근거리에서만 필요하고, 마스크 쪽에서는 0 이하가
  //   그냥 바다입니다 (COASTLINE_PLAN 11.5절).
  //
  // 옛 규칙은 "정확히 0 = 모르는 곳 = 999m" 였습니다. 값 하나로 가르니
  // 화소 한 칸 차이로 수심이 999m 와 0.2m 를 오가고, 갯벌이 「깊은 바다 ·
  // 흰 포말 · 갈색 뭍」 격자무늬가 됐습니다.
  //
  // 가르는 **재료**를 바꿉니다: 잘린 먼바다는 값이 0 일 뿐 아니라 **기울기가
  // 0 인 고원**입니다. 반대로 진짜 얕은 바닥은 기울어져 있습니다. 그러니
  // 바닥 기울기로 "이 값을 믿을 만한가"를 정합니다 — 연속이라 격자무늬가
  // 안 생기고, **거리와 무관**합니다.
  //
  // ⚠ 두 가지를 먼저 시도했다가 판정에 걸렸습니다.
  //   ① "반경 150m 안에 뭍이 있으면 얕다" → 5단계에서 없앤 **거리 고리**를
  //      다시 들여온 것이라 물빛이 거리를 따라갔습니다(변동 69.44%).
  //   ② "값이 0 에 가까울수록 못 믿는다" → 진짜 얕은 물까지 깊게 만들어
  //      **얕을수록 밝다**가 뒤집혔습니다(0.488배).
  float tx = max(8.0, uDemSpanM / 256.0);
  float bx = dem_elevationAt(gc + vec2(tx, 0.0)) - dem_elevationAt(gc - vec2(tx, 0.0));
  float bz = dem_elevationAt(gc + vec2(0.0, tx)) - dem_elevationAt(gc - vec2(0.0, tx));
  bool inside = uDemValid > 0.5 && dem_inside(gc) > 0.5;
  vBedSlope = inside ? length(vec2(bx, bz)) / (2.0 * tx) : 0.0;

  // 기울기 0 인 고원이면 0(못 믿음), 조금이라도 기울어져 있으면 1(믿음).
  // 문턱 0.002 는 화소 한 칸(15m)에 3cm — 자료의 눈금(1/256m)보다 크고
  // 진짜 갯벌 기울기(약 0.0005~)보다 작은 자리입니다.
  float trust = smoothstep(0.0, 0.002, vBedSlope);
  // 먼바다는 30m 로 둡니다 — 흡수가 다 먹는 깊이라 999 와 같은 값이면서
  // 섞을 때 얌전합니다(999 와 섞으면 경계에서 수백 m 가 튑니다).
  if (uShoreLegacy > 0.5) {
    vDepthM = (inside && hs < 0.0) ? -hs : 999.0;
    vBedSlope = 1.0;   // 옛 규칙에는 기울기 개념이 없었습니다
  } else {
    vDepthM = inside ? mix(30.0, max(0.0, -hs), trust) : 30.0;
  }

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
  // ⚠ 지형과 **조금 겹치게** 이어 그립니다(uShoreOverlapM) — TerrainField 의
  //   같은 이름 주석 참고. 뭍 쪽으로 조금 넘어가도 그 자리에는 지형이 위에
  //   그려지므로 보이지 않고, 두 면이 어긋나 생기던 구멍만 없어집니다.
  vWater = hm <= uShoreOverlapM ? 1.0 : 0.0;

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
${DEM_GLSL}
${TERRAIN_DIST_GLSL}
${ATMOSPHERE_GLSL}
${GROUND_DISPLAY_GLSL}
${CLOUD_SHADOW_GLSL}
uniform vec3  uSurfaceIrr;
uniform vec3  uSunRadiance;
uniform float uSunAzRad;
uniform float uSunAltRad;
uniform vec3  uMoonRadiance;
uniform float uMoonAzRad;
uniform float uMoonAltRad;
uniform vec3  uWaterAlbedo;
uniform vec3  uBedAlbedo;     // 바닥(모래·펄) 알베도
uniform float uFoamDepthM;
uniform float uExposure;
uniform float uSaturation;
uniform float uSunAltDeg;
uniform vec3  uHazeRadiance;
uniform float uAerial;
uniform float uFresnel;       // 0 이면 하늘 되비침을 끕니다 (기하 판정용)
uniform float uShoreOverlapM;  // 물가에서 겹쳐 그릴 폭 (m)
uniform float uShoreLegacy;    // 1 이면 옛 물가 규칙 (정점 셰이더와 같은 값)
uniform float uShoreMode;      // §156 수심·포말 — 0 정점 보간(예전) · 1 화소마다 자료에서 (TerrainField 와 같은 값)
uniform float uSlopeVar;      // Cox-Munk 파면 경사 분산 σ² = 0.003 + 0.00512·U
uniform float uGlitter;       // 0 이면 윤슬을 끕니다 (대조 판정용)
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;
uniform float uOzoneDU;
uniform float uLookFill;      // §156 구름을 뚫은 햇빛 몫(terrainLook.ts) — 지형과 같은 값
#ifdef SEA_LIT_OUT
layout(location = 1) out highp vec4 pc_fragColor1;
${LIT2_ENCODE_GLSL}
#endif
varying float vDistM;
varying float vDepthM;
varying float vWater;
varying float vBedSlope;
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
#ifdef SEA_DIST_OUT
  // §129 지형 거리 판에 바다도 적습니다 — B = 1 이 "바다" 표시(볼륨 하늘이 이 화소에 하늘 되비침을 칠함).
  vec4 seaDist = terrainDistEncode(vDistM / 1000.0);
  seaDist.b = 1.0;
  gl_FragColor = seaDist;
  return;
#endif
  // §156 **수심·바닥 기울기(포말)는 화소마다 자료에서 읽습니다** — 어디를 그릴지(위)는 그대로 두고 칠하는 값만.
  //   정점(격자 살 간격 25~74m)에서 읽은 값을 보간하면 포말·바닥 비침이 **삼각형 모양 그대로의 얼룩**이 됩니다(못 안의 흰 판·
  //   파란 상자). dem_shoreField 의 B-스플라인 흐린 고도(수심)·기울기(포말 폭)는 15m 자료 그대로 C2 로 이어집니다.
  //   물가에서 어디를 그릴지까지 화소마다 가르는 것은 해 봤다가 접었습니다 — 지형 지오메트리와 어긋나 구멍이 납니다
  //   (TerrainField 의 같은 주석 · COASTLINE_PLAN 13절).
  float depthM = vDepthM;
  float bedSlope = vBedSlope;
  if (uShoreMode > 0.5 && uDemValid > 0.5 && dem_inside(vGround.xz) > 0.5) {
    float hbS; vec2 grS;
    float hsS = dem_shoreField(vGround.xz, hbS, grS);
    // 정점 셰이더의 식(위 main 의 수심 주석)과 같은 뜻입니다.
    bedSlope = length(grS);
    float trust = smoothstep(0.0, 0.002, bedSlope);
    if (uShoreLegacy > 0.5) { depthM = hsS < 0.0 ? -hsS : 999.0; bedSlope = 1.0; }
    else depthM = mix(30.0, max(0.0, -hsS), trust);
  }

  // 왕복 경로라 수심의 두 배를 지납니다.
  vec3 thru = exp(-SEA_ABSORB * 2.0 * clamp(depthM, 0.0, 40.0));

#ifdef SEA_LIT_OUT
  // §129 볼륨 하늘 — 색 대신 수체·바닥·포말의 알베도(rgb)와 구름 그림자(a, 직달 몫). 하늘 되비침(프레넬)·윤슬·
  // 대기 원근·노출은 takram 이 하늘과 같은 값으로 계산합니다(이전 대기 모형의 되비침은 박명에 하늘과 다른 색이었음).
  {
    float fd = max(0.02, uFoamDepthM);
    float fg = clamp(40.0 / (fd / max(bedSlope, 1e-5)), 0.0, 1.0);
    float fm = (1.0 - smoothstep(0.0, fd, depthM)) * fg;
    float seaCloudT = cloudShadowAt(vGround.xz);
    // §156 알베도는 sqrt 로 적습니다(지형과 같은 규약 — TerrainField 주석). 하늘빛 몫 1(열린 바다) · 젖음 0(바다는 자기 되비침이 있음).
    gl_FragColor = vec4(sqrt(clamp(mix(uWaterAlbedo + uBedAlbedo * thru, vec3(0.70, 0.71, 0.72), fm), 0.0, 1.0)), seaCloudT);
    pc_fragColor1 = lit2Encode(1.0, 0.0, (1.0 - seaCloudT) * uLookFill, 1.0 - seaCloudT);
    return;
  }
#endif

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

    // 달빛 윤슬 (Moonlight Cox-Munk glitter)
    float moonUp = max(0.0, sin(uMoonAltRad));
    if (moonUp > 0.0 && length(uMoonRadiance) > 1e-4) {
      vec3 Lm = vec3(cos(uMoonAltRad) * sin(uMoonAzRad), sin(uMoonAltRad),
                    -cos(uMoonAltRad) * cos(uMoonAzRad));
      vec3 Hm = normalize(V + Lm + vec3(1e-5, 1e-4, 1e-5));
      float cosNm = max(Hm.y, 1e-3);
      float tan2m = max(0.0, 1.0 - cosNm * cosNm) / (cosNm * cosNm);
      float pm = exp(-clamp(tan2m / sv, 0.0, 50.0)) / (3.14159265 * sv * pow(cosNm, 4.0));
      pm = clamp(pm, 0.0, 220.0);
      float Fgm = waterFresnel(clamp(dot(V, Hm), 0.0, 1.0));
      vec3 moonGlitter = uMoonRadiance * cloudShadowAt(vGround.xz) * Fgm
                       * (pm / max(1.0, 4.0 * cosVg)) * 3.0;
      col += clamp(moonGlitter, vec3(0.0), vec3(60.0)) / eyeAdapt;
    }
  }

  // ── 포말 ────────────────────────────────────────────────────────────────
  //
  // 파도가 부서지는 곳, 곧 수심이 파고에 견줄 만큼 얕은 자리입니다. 그런데
  // **수심만으로 재면 갯벌이 통째로 하얘집니다.** 바닥이 1/1000 로 완만하면
  // 수심 0.5m 인 띠가 500m 나 되기 때문입니다(대부도 근거리 자료의 10.21%가
  // 그 띠 안에 듭니다).
  //
  // 같은 파도 에너지가 넓게 퍼지면 옅어집니다. 부서지는 띠의 폭은
  // 수심 나누기 기울기라, 그 폭이 넓을수록 세기를 그만큼 나눕니다 —
  // 기준 폭 40m 는 잔파도의 쇄파대 폭입니다. 가파른 해변(기울기 0.05)이면
  // 띠가 10m 라 그대로 1, 갯벌(0.0005)이면 1000m 라 0.04 로 잦아듭니다.
  float foamDepth = max(0.02, uFoamDepthM);
  float surfWidthM = foamDepth / max(bedSlope, 1e-5);
  float foamGain = clamp(40.0 / surfWidthM, 0.0, 1.0);
  float foam = (1.0 - smoothstep(0.0, foamDepth, depthM)) * foamGain;
  col = mix(col, uSurfaceIrr * vec3(0.70, 0.71, 0.72), foam);

  if (uAerial > 0.5) {
    vec3 T = atm_aerialTransmittance(vDistM / 1000.0, 0.0,
                                     uBeta, uAngstrom, uElevScale);
    // 연무는 하늘빛 — 되비침과 같이 지면 노출·순응을 미리 나눕니다(TerrainField 공기원근 주석, 2026-10-02).
    col = col * T + uHazeRadiance * (1.0 - T) / max(1e-4, uExposure * eyeAdapt);
  }

  gl_FragColor = vec4(atm_display_ground(col * uExposure, uSaturation, uSunAltDeg), 1.0);
}
`;

export interface SeaPlaneHandle {
  mesh: THREE.Mesh;
  /** §129 볼륨 하늘용 쌍둥이 — 거리 판(바다 표시 B=1)·빛 판(알베도·구름 그림자). 보임은 격자를 따라갑니다. */
  distMesh: THREE.Mesh;
  litMesh: THREE.Mesh;
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
      uMoonRadiance: { value: new THREE.Vector3(0, 0, 0) },
      uMoonAzRad: { value: 0 },
      uMoonAltRad: { value: 0 },
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
      uShoreLegacy: { value: 0.0 },
      uCloudShadowTex: { value: createOpenSkyShadowTexture() },
      uCloudShadowHalfM: { value: CLOUD_SHADOW_HALF_M },
      uCloudShadow: { value: 1.0 },
      // Cox & Munk (1954). 바람이 0 이어도 잔물결이 있어 0.003 이 바닥입니다.
      uSlopeVar: { value: 0.003 + 0.00512 * 5.5 },
      // TerrainField 의 같은 이름 유니폼과 **같은 값**이어야 합니다.
      uShoreOverlapM: { value: 3 },
      uShoreMode: { value: 1 },
      uGlitter: { value: 1.0 },
      uBeta: { value: 0.08 },
      uAngstrom: { value: 1.3 },
      uElevScale: { value: 1.0 },
      uOzoneDU: { value: 330 },
      ...makeTerrainLookUniforms(),
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

  const unbindLook = bindTerrainLook(material.uniforms);

  const mesh = new THREE.Mesh(
    createConcentricGeometry(
      opts.rings ?? SEA_RINGS, opts.spokes ?? SEA_SPOKES, SEA_FAR_M,
      undefined, { rings: SEA_TAIL_RINGS, farM: SEA_TAIL_FAR_M }),
    material,
  );
  mesh.name = 'seaPlane';
  mesh.frustumCulled = false;
  // §129 쌍둥이 — 균일변수는 격자와 같은 객체(지형 TerrainField 와 같은 방식).
  const twin = (define: string, layer: number, name: string) => {
    const m = material.clone();
    m.uniforms = material.uniforms;
    m.defines = { ...(material.defines ?? {}), [define]: 1 };
    m.transparent = false;
    m.blending = THREE.NoBlending;
    const t = new THREE.Mesh(mesh.geometry, m);
    t.name = name; t.frustumCulled = false; t.layers.set(layer); t.visible = false;
    return t;
  };
  const distMesh = twin('SEA_DIST_OUT', LAYER_TERRAIN_DIST, 'seaPlaneDist');
  const litMesh = twin('SEA_LIT_OUT', LAYER_TERRAIN_LIT, 'seaPlaneLit');

  return {
    mesh,
    distMesh,
    litMesh,
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
      (distMesh.material as THREE.Material).dispose();
      (litMesh.material as THREE.Material).dispose();
      unbindLook();
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
  // 지형 격자와 **같은 규약**입니다 — 눈이 메시 원점에 있어야 버텍스가
  // 계산한 고도각이 화면에 그대로 나옵니다. 어긋나면 물가가 두 면의
  // 교선이 아니게 됩니다. 자세한 것은 updateTerrainFieldEye 주석.
  handle.mesh.position.copy(camera.position);
  for (const t of [handle.distMesh, handle.litMesh]) {
    if (!t) continue;   // 하네스 몇은 쌍둥이 없는 손잡이를 넘김
    t.position.copy(camera.position);
    t.visible = handle.mesh.visible;
  }
}

/** 눈높이에서 수평선까지의 지상 거리 (m) — 판정이 같이 씁니다. */
export { seaHorizonDistM };
