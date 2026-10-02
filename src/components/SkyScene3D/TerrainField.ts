/**
 * **지형 높이장 메시** — 실루엣을 자료가 정하게 합니다 (docs/COASTLINE_PLAN.md 2단계).
 *
 * 1단계에서 진짜 높이장(`utils/demTiles.ts`)이 생겼습니다. 여기서 그걸
 * **기하**로 바꿉니다. 지금까지 지면은 평평한 원반이었고 능선은 31방위짜리
 * 빌보드 띠였습니다 — 방위 해상도가 12° 라 곶도 만도 섬도 못 그립니다.
 *
 * ## 왜 미터 평면이 아니라 **각도 격자**인가
 *
 * 이 씬은 반경 500 짜리 돔에 **각도**로 그립니다. 구름도 능선 띠도 나침반도
 * 천체도 전부 그 규약 위에 있습니다. 여기에만 미터 좌표계를 들이면 3km 지점이
 * 돔(500) 밖으로 나가 깊이 순서가 통째로 깨집니다.
 *
 * 그래서 격자를 **시선 구면 위**에 놓습니다. 지상 거리 d, 고도 h 인 점은
 *
 *     낙차   = d² / 2R          (지구 곡률)
 *     고도각 = atan2(h − 눈높이 − 낙차, d)
 *
 * 로 **실제로 보이는 각도**에 놓입니다. 눈높이가 식 안에 들어가므로 관측
 * 고도도 여기서 자동으로 반영됩니다.
 *
 * ## 가림(occlusion)은 반경이 정합니다
 *
 * 모든 정점을 같은 반경에 놓으면 가까운 능선과 먼 산이 같은 깊이라 z-fighting
 * 이 납니다. 대신 반경을 **거리의 단조 증가 함수**로 둡니다. 카메라가 메시
 * 원점에 있으므로 깊이 = 반경이고, 따라서
 *
 *     가까운 것이 항상 앞  ⇔  d 가 작으면 R 도 작다
 *
 * 가 공짜로 성립합니다. 반경은 오직 **깊이 순서**만 나르고, 보이는 자리는
 * 전부 위의 고도각이 정합니다.
 *
 * ⚠ 그래서 이 메시는 **카메라 위치에 원점을 두어야** 합니다. 원점이 씬
 * 원점에 있으면 눈높이 1.6 만큼 어긋나, 가장 가까운 고리에서 각도가 0.9°
 * 까지 틀립니다. `updateTerrainFieldEye` 로 매 프레임 맞춥니다.
 */
import * as THREE from 'three';
import { DEM_GLSL, demGlsl, makeDemUniforms, type DemPatch } from '../../utils/demTiles';
import {
  ATMOSPHERE_GLSL, GROUND_DISPLAY_GLSL, makeTuningUniforms,
} from '../../utils/atmosphere';
import {
  CLOUD_SHADOW_GLSL, CLOUD_SHADOW_HALF_M, createOpenSkyShadowTexture,
} from '../../utils/cloudShadowMap';
import { LAYER_TERRAIN_DIST, TERRAIN_DIST_GLSL } from './SceneComposer';
import {
  EARTH_RADIUS_M, FIELD_NEAR_M, FIELD_FAR_M,
  GROUND_PROJECT_GLSL, TERRAIN_NOISE_GLSL,
  createConcentricGeometry, ringDistanceM, ringRadius,
} from './groundProjection';

export { FIELD_NEAR_M, FIELD_FAR_M };

/**
 * 고리 수 × 살 수.
 *
 * 살(방위)이 실루엣을 정합니다 — 256 이면 1.41°, 지금 띠의 12° 보다
 * 8.5배 촘촘합니다. 고리는 로그 간격이라 가까울수록 촘촘합니다.
 */
// 발밑 24 + 바깥 128. 발밑 고리를 바깥에서 빼내면 먼 쪽 실루엣이 나빠집니다
// (최대오차 0.119° → 0.161°). 새로 덮는 구간이므로 **더합니다**.
export const FIELD_RINGS = 152;
export const FIELD_SPOKES = 256;

/**
 * 고리 k 의 지상 거리 (m). 판정(`verify-terrain-field.js`)의 CPU 참조도
 * **같은 거리**를 씁니다 — 안 그러면 표본 간격 차이를 결함으로 잘못 읽습니다.
 */
export function fieldRingDistanceM(k: number, rings: number = FIELD_RINGS): number {
  return ringDistanceM(k, rings, FIELD_FAR_M);
}

/** 동심원 격자. 배치와 규약은 `groundProjection.ts` 에 있습니다. */
export function createFieldGeometry(
  rings: number = FIELD_RINGS,
  spokes: number = FIELD_SPOKES,
  farM: number = FIELD_FAR_M,
  nearM?: number,
): THREE.BufferGeometry {
  return createConcentricGeometry(rings, spokes, farM, nearM);
}

/**
 * **먼 지형** 격자의 범위 (m).
 *
 * 3km 밖은 오랫동안 옛 31방위 능선 띠가 맡았습니다. 그 띠는 방위마다
 * **5·15·40km 딱 세 점**만 보므로 진짜 봉우리를 대부분 놓칩니다 — 도곡동에서
 * 재 보니 먼 산이 최대 **3.26° 낮게** 깔렸습니다(`verify-far-terrain.js`).
 * 그러면 3km 안의 앞산만 제 높이로 서서, 앞산이 실제보다 우뚝해 보입니다.
 * 실기에서 "산의 높이나 기울기가 조금 과장돼 보인다"고 한 것이 이것입니다.
 *
 * 여기서 같은 높이장 방식을 3km 밖으로 잇습니다. 성긴 패치(줌 9, 화소 약
 * 243m)를 쓰므로 봉우리가 조금 깎이지만, 12° 간격 세 점보다는 비교가 안 되게
 * 낫습니다.
 */
export const FAR_FIELD_NEAR_M = FIELD_FAR_M;
export const FAR_FIELD_FAR_M = 55000;
export const FAR_FIELD_RINGS = 96;

/** 격자 정점을 실제로 보이는 각도에 놓는 버텍스 셰이더. */
export const FIELD_VERT = /* glsl */ `
precision highp float;
${DEM_GLSL}
${demGlsl('demEye')}
${demGlsl('demFar')}
${GROUND_PROJECT_GLSL}
uniform float uObsElevM;    // DEM 이 없을 때만 쓰는 발밑 고도 (m)
uniform float uEyeHeightM;  // 발밑에서 눈까지 (m)
varying float vDistM;
varying float vElevM;
varying vec3  vNormal;
varying vec2  vGround;   // 지상 좌표 (동, 남) m — 그림자 레이마치가 씁니다
varying vec3  vViewDir;  // 눈(메시 원점)에서 이 점으로 — 연무 색이 씁니다
varying float vSlantM;   // §117 눈에서 이 점까지 직선 거리(m) — 지형 거리 판이 씁니다

/**
 * 관측자 **발밑** 고도 — 반드시 DEM 자신이 정합니다.
 *
 * ⚠ 여기에 바깥에서 받은 고도(Open-Meteo 등)를 쓰면 안 됩니다. 자료가 서로
 * 몇 m 만 달라도 눈이 그려지는 면에서 떠오르거나 파묻히고, 가장 가까운
 * 고리(12m)에서는 5m 차이가 **22°** 로 벌어집니다. 실제로 판정을 처음
 * 돌렸을 때 바깥 고도 0m 를 믿었다가 DEM 이 말하는 42m 에 파묻혀 지평선각이
 * 72° 로 나왔습니다.
 *
 * ⚠ **해수면(SeaPlane)도 같은 값을 씁니다.** 눈높이가 어긋나면 해안선이
 * 두 면의 교선이 아니게 됩니다.
 */
float groundAtEye() {
  // ⚠ 먼 지형 격자는 **성긴** 패치로 그리는데, 발밑 고도까지 성긴 것으로
  // 읽으면 안 됩니다. 같은 자리가 줌 13 에서 70.7m, 줌 9 에서 59.8m —
  // 3km 이음매에서 10.9m 는 0.21° 의 층계입니다. 그래서 발밑만은 늘
  // **촘촘한** 패치(demEye)로 짚습니다. 근거리 격자는 이 자리에 자기
  // 패치를 그대로 넣으므로 예전과 같은 값입니다.
  if (uDemEyeValid > 0.5) return demEye_elevationAt(vec2(0.0));
  return uDemValid > 0.5 ? dem_elevationAt(vec2(0.0)) : uObsElevM;
}

/**
 * **촘촘한 패치와 성긴 패치를 하나의 높이장으로 잇습니다.**
 *
 * 예전에는 격자가 둘이었습니다 — 근거리(0.6m~3km, 줌 13)와 먼 지형
 * (3km~55km, 줌 9). 3km 에서 **두 메시가 딱 맞닿았고**, 그 자리가 서로 다른
 * 자료로 그려진 하드 이음매였습니다.
 *
 * 이제 한 격자가 거리에 따라 자료를 **섞어** 읽습니다. 촘촘한 패치가
 * 보장하는 반지름(dem_probeRadiusM, 줌 13 블록 3 에서 3,816m)의 안쪽
 * 4분의 3 까지는 촘촘한 것만 쓰고, 거기서 가장자리까지 부드럽게 넘깁니다.
 * 이음매가 선이 아니라 띠가 되므로 층계가 안 생깁니다.
 *
 * ⚠ 성긴 패치에만 despike 가 필요합니다 — 저줌 타일의 R 채널 결함이
 *   첨탑으로 서기 때문입니다. 촘촘한 쪽은 그대로 둡니다(진짜 능선이 깎임).
 *
 * ⚠ 성긴 패치가 없으면(uDemFarValid = 0) **예전 한 장짜리 경로 그대로**
 *   입니다. 근거리 격자와 먼 지형 격자를 따로 만들던 방식이 계속 돕니다.
 */
uniform float uBlendInner;   // 촘촘→성김 넘기기를 시작하는 반지름 비율

float tf_fineWeight(vec2 g) {
  if (uDemValid < 0.5) return 0.0;
  float rp = dem_probeRadiusM();
  return 1.0 - smoothstep(rp * uBlendInner, rp * 0.98, length(g));
}

float fieldElev(vec2 g) {
  bool hasFine = uDemValid > 0.5;
  bool hasFar = uDemFarValid > 0.5;
  if (!hasFine && !hasFar) return uObsElevM;
  if (!hasFar) return dem_elevationDespiked(g);
  if (!hasFine) return demFar_elevationDespiked(g);
  float w = tf_fineWeight(g);
  if (w <= 0.001) return demFar_elevationDespiked(g);
  if (w >= 0.999) return dem_elevationDespiked(g);
  return mix(demFar_elevationDespiked(g), dem_elevationDespiked(g), w);
}

void main() {
  vec2  g = vec2(position.x, position.z);   // (동, 남) m
  float r = position.y;                     // 깊이 순서용 반경
  float d = max(length(g), 0.001);

  float h = fieldElev(g);
  vElevM = h;
  vDistM = d;
  vGround = g;

  // 법선은 실제 지상 간격으로 낸 유한차분입니다. 고리 간격에 비례해 떨어져야
  // 가까이서 너무 잘고 멀리서 너무 뭉개지는 것을 피합니다.
  float e = max(8.0, d * 0.03);
  float hx = fieldElev(g + vec2(e, 0.0)) - fieldElev(g - vec2(e, 0.0));
  float hz = fieldElev(g + vec2(0.0, e)) - fieldElev(g - vec2(0.0, e));
  // (동, 남) 평면에서의 기울기 → 씬 좌표 법선 (+x 동, +z 남, +y 위)
  vNormal = normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));

  float eyeElevM = groundAtEye() + uEyeHeightM;
  vec3 p = gp_project(g, h, eyeElevM, r);
  // §117 — 화면 자리는 각도로 놓지만(p 는 미터가 아님) 구름과 견줄 거리는 미터로 따로 냅니다.
  // 곡률 강하를 빼 구름 슬랩의 구면 교차와 같은 기하로 둡니다.
  float dzM = h - eyeElevM - d * d / (2.0 * 6371000.0);
  vSlantM = sqrt(d * d + dzM * dzM);
  // ⚠ 눈은 메시 원점에 있으므로 p 자체가 "눈에서 이 점으로" 입니다
  //   (SeaPlane 과 같은 규약). 카메라의 world Y 를 여기서 읽으면 안 됩니다.
  vViewDir = normalize(p);

  // ⚠ 가장자리를 알파로 흐리지 **않습니다.** 예전에는 바깥 고리를 페이드로
  //   넘겼는데, 해수면(4단계)이 생긴 지금 그러면 물가의 땅이 하늘로 사라져
  //   구멍이 남습니다. 격자는 자기 끝까지 불투명하고, 그 너머는 바다가
  //   이어받습니다.
  vec4 wp = modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/**
 * 2단계에서는 **실루엣이 맞는가**가 판정입니다. 그래서 칠은 자료를 읽을 수
 * 있을 만큼만 합니다 — 조도 × 알베도에 램버트, 그리고 물은 해수면 아래로
 * 표시만 해 둡니다(진짜 물은 4단계에서 별도의 면으로 옵니다).
 */
/**
 * 땅색 — **조도 × 알베도**, 그 위에 경사·조간대·공기원근.
 *
 * ## 왜 한 가지 색으로는 안 되나
 *
 * 지금까지 지면은 알베도 하나(0.22, 0.17, 0.13)로 통째로 칠했습니다. 그러면
 * 실루엣이 아무리 정확해도 **판지 오려 붙인 것**처럼 보입니다. 자료에서
 * 공짜로 나오는 단서가 둘 있습니다.
 *
 * ### 1. 경사
 *
 * 지형 채색의 표준 수법입니다 — 완만한 곳은 흙이 남고 풀이 자라며, 급한
 * 사면은 씻겨 **암반이 드러납니다.** 법선의 y 하나로 나옵니다.
 *
 * 실측 알베도: 숲 0.12 · 마른 풀 0.23 · 흙 0.17 · 암반 0.20~0.25 ·
 * 마른 모래 0.35~0.40. 그래서 급사면은 **밝고 덜 붉게**, 완사면은 **어둡고
 * 따뜻하게** 기울입니다.
 *
 * ### 2. 조간대 (젖은 모래)
 *
 * 젖은 모래는 마른 모래보다 알베도가 **절반쯤**입니다. 물이 알갱이 사이를
 * 채우면 밖으로 산란돼 나올 빛이 내부 전반사로 되돌아가기 때문입니다.
 * 색만 바꾸면 안 되고 **어두워져야** 맞습니다.
 *
 * 폭은 거리가 아니라 **고도**로 잽니다. 그러면 완만한 모래밭은 띠가 넓고
 * 절벽은 좁은 것이 저절로 나옵니다 — 4·5단계 판정이 그걸 확인합니다.
 *
 * ## 공기원근
 *
 * 노을에는 지면을 **수 km 의 대기를 통해** 봅니다. 먼 곶이 납작한 청회색
 * 실루엣이 되는 것이 사진에서 가장 눈에 띄는 특징이고, 이게 없으면 원경이
 * 앞과 똑같은 색으로 서서 깊이가 죽습니다.
 *
 *     보이는 색 = 지면색 · T(d) + 그쪽 하늘빛 · (1 − T(d))
 *
 * 예전 능선 띠는 거리대 **세 개**에만 이걸 걸었습니다. 높이장은 화소마다
 * 진짜 거리가 있으므로 **연속으로** 겁니다.
 */
/** 구운 능선 꼭대기 높이(눈 위 m)의 범위 ±. 16비트(R·G)에 담아 0.125m 간격입니다. */
const SUN_SHADOW_RANGE_M = 4096;

export const FIELD_FRAG = /* glsl */ `
precision highp float;
const float SUN_RADIUS_RAD = 0.00463;   // 해 원반 각반경 0.265° — 아래 산 그림자의 반그림자와 같은 값
${ATMOSPHERE_GLSL}
${GROUND_DISPLAY_GLSL}
${DEM_GLSL}
${demGlsl('demFar')}
${CLOUD_SHADOW_GLSL}
${TERRAIN_NOISE_GLSL}
uniform float uBlendInner;    // 촘촘→성김 넘기기를 시작하는 반지름 비율
uniform float uShoreOverlapM; // 물가에서 겹쳐 그릴 폭 (m). 0 이면 예전처럼 딱 맞닿음
uniform float uBicubicNormal; // 1 이면 법선을 3차 B-스플라인으로 (①)
uniform float uDetail;        // 자료 아래 규모 결의 세기, 0 이면 끔 (②)
                              // 기본 0.10 — 세기를 훑어 **평균 밝기가 5% 넘게
                              // 안 움직이는** 가장 큰 값으로 잡았습니다. 법선을
                              // 세게 흔들면 ndl 이 0 에서 잘려 화면이 통째로
                              // 어두워집니다(0.6 이면 평균 109 → 77).
uniform float uHurst;         // 그 결의 허스트 지수 — 자료에서 잰 값
uniform vec3  uSurfaceIrr;    // 수평면이 받는 조도 (하늘 + 직달)
uniform vec3  uSunRadiance;
uniform float uSunAzRad;
uniform float uSunAltRad;
uniform float uSunAltDeg;
uniform vec3  uAlbedo;
uniform float uExposure;
uniform float uSaturation;
uniform vec3  uHazeRadiance;  // 방위 평균 지평선 하늘빛 — 대비책일 뿐입니다
uniform float uOzoneDU;
uniform float uHazeDirectional;  // 0 이면 옛 평균 한 값 (A/B 판정용)
uniform float uHazeSkyScale;     // 1 = 연무를 하늘과 같은 노출로(아래 공기원근 주석) · 0 = 예전 (A/B 판정용)
uniform sampler2D uSunShadowTex; // 해 방위의 지평선 능선(꼭대기 높이·거리) — bakeSunShadow 가 굽습니다
uniform float uSunShadowValid;   // 1 = 위 텍스처를 지금 해·지형으로 구웠음
uniform float uHazeShadow;       // 1 = 연무 단일산란에 산 그림자 · 0 = 예전 (A/B 판정용)
uniform float uAerial;        // 0 이면 공기원근 끔 (기하 판정용)
uniform float uWetBandM;      // 조간대 폭 (m 단위 **고도**)
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;
uniform float uShadow;        // 0 이면 드리운 그림자를 끕니다 (대조 판정용)
varying float vDistM;
varying float vElevM;
varying vec3  vNormal;
varying vec2  vGround;
varying vec3  vViewDir;
varying float vSlantM;
${TERRAIN_DIST_GLSL}

/**
 * 이 점에서 **태양 쪽 지평선각** (rad).
 *
 * 램버트(ndl)만으로는 **제 사면이 해를 등졌는가**밖에 못 봅니다. 산이 그
 * 뒤 땅에 드리우는 그림자는 다른 질문입니다 — "여기서 해를 보면 뭔가가
 * 가리고 있는가". 그건 태양 쪽으로 지형을 훑어야 답이 나옵니다.
 *
 * 간격은 로그입니다. 가까운 둔덕도 놓치지 않으면서(6m 부터) DEM 패치
 * 끝(약 3.5km)까지 닿아야 하는데, 등간격으로 그러려면 표본이 수백 개
 * 필요합니다. 낮은 해의 그림자는 길어서(300m 봉우리 · 해 5° → 3.4km)
 * 이 거리가 그냥 여유가 아니라 필요한 값입니다.
 *
 * ⚠ 자료 밖으로 나가면 **거기서 멈춥니다.** 가장자리 값이 늘어난 것을
 * 지형으로 읽으면 패치 경계에 가짜 그림자 벽이 생깁니다.
 */
float terrainHorizonAngle(vec2 g0, float h0, vec2 sunHoriz) {
  float best = -1.5;
  // 첫 걸음은 **화소 한 칸**입니다. 그보다 잘게 떼면 같은 화소를 여러 번
  // 읽을 뿐이고, 성긴 패치(먼 지형)에서는 걸음이 너무 짧아 닿는 거리가
  // 모자랍니다.
  // 한 격자가 두 해상도를 걸치므로 걸음도 그 자리의 화소로 잡습니다.
  float spanFar = uDemFarValid > 0.5 ? uDemFarSpanM : uDemSpanM;
  float t = max(6.0, min(uDemSpanM, spanFar) / 256.0);
  for (int i = 0; i < 36; i++) {
    vec2 g = g0 + sunHoriz * t;
    float inFine = uDemValid > 0.5 ? dem_inside(g) : 0.0;
    float inFar = uDemFarValid > 0.5 ? demFar_inside(g) : 0.0;
    if (inFine < 0.5 && inFar < 0.5) break;
    float h = inFine > 0.5 ? dem_elevationAt(g) : demFar_elevationDespiked(g);
    best = max(best, atan(h - h0, t));
    t *= 1.2;
  }
  return best;
}

/** 구운 해 쪽 능선 — x = 꼭대기의 눈 위 높이(m), y = 수평 거리(m). 인코딩은 SUN_SHADOW_BAKE_FRAG. */
vec2 sunRidgeZD() {
  vec4 t = texture2D(uSunShadowTex, vec2(0.5, 0.5));
  float v = (floor(t.r * 255.0 + 0.5) * 256.0 + floor(t.g * 255.0 + 0.5)) / 65535.0;
  float d = floor(t.b * 255.0 + 0.5) * 256.0 + floor(t.a * 255.0 + 0.5);
  return vec2(v * ${SUN_SHADOW_RANGE_M.toFixed(1)} * 2.0 - ${SUN_SHADOW_RANGE_M.toFixed(1)}, d);
}

/** 해 원반 가운데보다 m(rad) 높은 수평선 위로 보이는 원반의 몫 — 원의 활꼴 넓이. */
float sunDiscAbove(float m) {
  float x = clamp(m / SUN_RADIUS_RAD, -1.0, 1.0);
  return (acos(x) - x * sqrt(1.0 - x * x)) / 3.14159265;
}

/**
 * **눈에서 이 점까지의 공기 가운데 햇빛을 받는 몫** — 연무의 단일산란에 곱합니다.
 *
 * 해가 능선 뒤로 넘어가면 눈과 그 능선 사이의 공기가 통째로 산 그림자에 듭니다. 그러면 해 쪽 하늘을
 * 밝히는 앞방향 산란(해 둘레의 밝은 무리)을 그 공기는 못 받고, 능선은 제 뒤 하늘보다 확실히 어둡게
 * 섭니다 — 후쿠이 2026-10-02 17:31 사진에서 능선 아래/위 밝기 비 0.52~0.56, 능선 색조(파랑/빨강)
 * 1.06 대 하늘 0.58 (그늘 속 공기는 파란 하늘빛만 받습니다).
 *
 * 모형: 해 방위의 지평선을 만드는 능선(sunRidgeZD — 높이 z, 거리 D) 하나가 해 방향과 직각으로 길게
 * 놓여 있다고 봅니다. 시선 위의 점(수평 거리 s, 높이 s·tan(시선 고도), 해 쪽 성분 u = s·cos(방위차))에서
 * 그 꼭대기를 올려다본 각과 해 원반을 견줘 보이는 원반의 몫을 냅니다(u ≥ D 면 능선 너머라 1).
 * 시선을 **연무에 같은 몫씩 보태는** 여덟 토막으로 나눠 그 가운데서 잰 몫을 평균합니다.
 */
vec3 hazeLitWeight(vec3 dir, float distM) {
  if (uHazeShadow < 0.5 || uSunShadowValid < 0.5) return vec3(1.0);
  float hl = length(dir.xz);
  if (hl < 1e-4) return vec3(1.0);
  vec2 sunH = vec2(sin(uSunAzRad), -cos(uSunAzRad));
  float cosDphi = dot(dir.xz / hl, sunH);
  float te = dir.y / hl;
  vec2 zd = sunRidgeZD();
  // 투과율은 거리에 지수로 줄므로 T(s) = T(d)^(s/d) — 같은 몫 토막의 경계를 바로 풉니다.
  float Td = dot(vec3(0.2126, 0.7152, 0.0722),
    atm_aerialTransmittance(distM / 1000.0, 0.0, uBeta, uAngstrom, uElevScale));
  float lnTd = log(clamp(Td, 1e-4, 0.9999));
  float w = 0.0;
  for (int i = 0; i < 8; i++) {
    float q = (float(i) + 0.5) / 8.0;
    float sM = distM * log(1.0 - q * (1.0 - exp(lnTd))) / lnTd;
    float u = sM * cosDphi;
    float f = 1.0;
    if (u < zd.y) {
      float crest = atan(zd.x - sM * te, max(1.0, zd.y - u));
      f = sunDiscAbove(crest - uSunAltRad);
    }
    w += f;
  }
  return vec3(w / 8.0);
}

void main() {
  // ⚠ **해수면 아래는 그리지 않습니다.** 거기서 보이는 것은 땅이 아니라
  //    물이고, 물은 SeaPlane 이 그립니다.
  //
  //    이걸 안 하면 Terrarium 이 **먼바다를 정확히 0 으로 자른다**는 성질에
  //    걸립니다 (조사 때 표본 1024개 중 406개가 정확히 0). 그러면 지면
  //    메시가 해수면과 **똑같은 높이**에 면을 깔고, 깊이 동률에서 지면이
  //    이겨서 먼바다가 통째로 뭍으로 그려집니다. 실측: 맨 위 물이 이론
  //    −0.053° 대신 평균 −0.48° (약 320m 앞)에서 잘렸습니다.
  //
  //    알려진 한계: 고도가 정확히 0m 인 **간척지·갯벌**도 물로 읽힙니다.
  //    자료가 그 둘을 구분해 주지 않습니다.
  //
  // ⚠ **자료가 있을 때만** 자릅니다. DEM 을 못 받으면 대비책 지면이 고도 0 인
  //    평평한 판인데, 조건 없이 자르면 그 판이 통째로 사라져 지면이 아예 안
  //    그려집니다 (판정의 평판 대조가 0/1536 으로 잡았습니다).
  // ⚠ 물가를 **매끄럽게 한 고도**(중앙+대각선 다섯 점 평균)로 가르는 것도
  //   해 봤습니다. 실기의 "상자 모양으로 각진 경계"를 노린 것이었는데, 재 보니
  //   경계의 각짐(2차 차분)이 **오히려 나빠졌습니다** (그때 잰 값으로
  //   1.774 → 1.945; 해수면 겹침 뒤로 눈금이 내려가 지금은 1.349 → 1.551
  //   이지만 방향은 같습니다 — COASTLINE_PLAN 10.5절).
  //   (예전엔 2.286 → 2.571 로 적혀 있었습니다. 그 값을 낸 자가 줄마다
  //   경계를 하나만 세어 표본이 29~37줄뿐이었고, 지금은 모든 경계를 세어
  //   176~254줄입니다 — tools/shader-preview/verify-shore-sdf.js.)
  //   섞어도 등고선이 다른 화소 모서리로 옮겨갈 뿐이었습니다. 그래서 뺐습니다.
  // ⚠ 물가의 겹침은 **해수면 쪽에만** 줍니다. 여기는 0 그대로입니다.
  //
  //   지형은 정점에서 보간한 vElevM 로, 해수면은 프래그먼트마다 DEM 에서
  //   직접 읽은 값으로 같은 0 등고선을 각자 계산합니다. 표본이 다르니
  //   어긋나고, 어긋난 화소는 양쪽 다 버려 **구멍**이 됩니다(바닷가에서
  //   4,821화소 — 지금은 옛 원반이 메우고 있었습니다).
  //
  //   그래서 해수면을 뭍 쪽으로 조금 넘겨 그립니다(SeaPlane 의
  //   uShoreOverlapM). 반대로 **지형을 물 쪽으로 넘기면 안 됩니다** —
  //   Terrarium 이 먼바다를 정확히 0 으로 자르므로, 문턱을 조금만 내려도
  //   그 고원(근거리 패치의 38~41%)이 통째로 뭍으로 그려집니다. 실제로
  //   −3m 로 해 봤다가 물 맨위가 −0.05° 에서 −0.48° 로 잘렸고
  //   verify-coastline 6개 · verify-inland 1개가 걸렸습니다.
  if (uDemValid > 0.5 && vElevM <= 0.0) discard;
#ifdef TERRAIN_DIST_OUT
  // §117 지형 거리 판 — 색 대신 눈에서 이 점까지 거리(km)를 적습니다.
  gl_FragColor = terrainDistEncode(vSlantM / 1000.0);
  return;
#endif

  // ── 법선 ────────────────────────────────────────────────────────────────
  //
  // ① 텍셀 규모의 법선을 **프래그먼트에서** 3차 B-스플라인으로 다시 냅니다.
  //    정점에서 낸 것을 보간하면 살 간격(2km 에서 49m, 3km 에서 74m)이
  //    자료(15.14m)보다 성겨 법선이 모자라고, 이중선형은 C0 라 텍셀마다
  //    꺾입니다. 자세한 것은 demTiles.ts 의 dem_gradientBicubic 주석.
  //
  // ⚠ 높이는 안 건드립니다 — 실루엣은 정점이 정한 그대로입니다.
  //
  // ⚠ 먼 지형(despike 켬)에는 안 겁니다. 튀는 화소를 걷어내는 일이 표본
  //   열여섯 개마다 붙으면 너무 비싸고, 3km 밖은 연무에 잠겨 면의 결이
  //   보이지도 않습니다.
  vec3 n = normalize(vNormal);
  vec2 texGrad = vec2(0.0);
  // 세배 법선은 **촘촘한 패치가 맡는 자리**에만 겁니다. 성긴 쪽은 despike 가
  // 필요한데 표본 열여섯 개마다 그걸 붙이면 너무 비싸고, 3km 밖은 연무에
  // 잠겨 면의 결이 보이지도 않습니다.
  float fineW = uDemValid > 0.5 ? 1.0 - smoothstep(dem_probeRadiusM() * uBlendInner,
                                                   dem_probeRadiusM() * 0.98,
                                                   length(vGround)) : 0.0;
  if (uBicubicNormal > 0.5 && uDemValid > 0.5 && uDemDespike < 0.5 && fineW > 0.5) {
    texGrad = dem_gradientBicubic(vGround);
    n = normalize(vec3(-texGrad.x, 1.0, -texGrad.y));
  } else {
    // 정점 법선에서 기울기를 되찾습니다 (아래 ② 의 세기가 이것에 비례).
    float ny0 = max(n.y, 1e-3);
    texGrad = vec2(-n.x, -n.z) / ny0;
  }

  // ② **자료 아래 규모의 결** — 있는 것을 흉내내는 것이 아니라, 자료가
  //    말해 준 법칙을 이어 씁니다.
  //
  //    거리별 RMS 고도차를 재 보니 15m~485m 다섯 옥타브에서 거듭제곱
  //    법칙이 R² = 0.996 으로 깨끗합니다 — 허스트 지수 H = 0.84(마니산) ·
  //    0.80(도곡동). 그러면 파장 L 에서의 기울기는
  //
  //        slope(L) = slope(L0) · (L / L0)^(H − 1)
  //
  //    이고, L0 는 자료가 아는 가장 작은 규모(텍셀 두 칸)입니다. 진폭을
  //    취향으로 고르지 않고 **그 자리의 기울기에 비례**시키므로, 갯벌은
  //    거의 0 이고 산은 제 값을 받습니다.
  //
  // ⚠ 법선만 흔듭니다. 높이에 더하면 진짜 능선 자리에 허구가 섞이고
  //   실루엣이 바뀝니다.
  //
  // ⚠ 화면 화소보다 잔 옥타브는 결이 아니라 **에일리어싱**입니다. 거리에
  //   따라 잔 옥타브를 끕니다 — 밉맵과 같은 이치.
  if (uDetail > 0.0 && uDemValid > 0.5) {
    float texelM = max(1.0, uDemSpanM / 256.0);
    float L0 = 2.0 * texelM;                 // 자료가 아는 가장 짧은 파장
    float s0 = length(texGrad);              // 그 자리의 텍셀 규모 기울기
    float pixM = max(0.05, vDistM * 0.0015); // 화면 한 화소가 덮는 지상 거리
    vec2 g = vGround;
    vec2 add = vec2(0.0);
    float L = L0;
    for (int o = 0; o < 4; o++) {
      L *= 0.5;
      // 화소보다 잔 옥타브는 매끄럽게 꺼집니다 (딱 끊으면 띠가 집니다).
      float vis = smoothstep(1.0, 3.0, L / pixM);
      if (vis > 0.001) {
        float amp = s0 * pow(L / L0, uHurst - 1.0) * vis;
        float e = L * 0.25;
        float c = tn_noise(g / L);
        add += amp * vec2(tn_noise((g + vec2(e, 0.0)) / L) - c,
                          tn_noise((g + vec2(0.0, e)) / L) - c) * 2.0;
      }
    }
    vec2 gd = texGrad + add * uDetail;
    n = normalize(vec3(-gd.x, 1.0, -gd.y));
  }

  vec3 sun = vec3(cos(uSunAltRad) * sin(uSunAzRad),
                  sin(uSunAltRad),
                 -cos(uSunAltRad) * cos(uSunAzRad));
  float ndl = max(0.0, dot(n, sun));

  // ── 산이 드리우는 그림자 ────────────────────────────────────────────────
  //
  // 태양 쪽 지평선각이 태양 고도보다 높으면 이 점은 그늘입니다. 경계는
  // **태양 원반**만큼 흐립니다 — 각반경 0.265° 라 그만큼이 반그림자입니다.
  //
  // ⚠ 깎는 것은 **직달 몫뿐**입니다. 그늘진 사면도 하늘은 그대로 봅니다.
  // 조도에서 통째로 빼면 그늘이 새까매지는데, 실제 그늘은 하늘빛을 받아
  // 푸르스름합니다.
  float shade = 0.0;
  if (uShadow > 0.5 && uDemValid > 0.5) {
    vec2 sunHoriz = vec2(sun.x, sun.z);
    float sl = length(sunHoriz);
    if (sl > 1e-4) {
      float hz = terrainHorizonAngle(vGround, vElevM, sunHoriz / sl);
      shade = smoothstep(uSunAltRad - 0.00463, uSunAltRad + 0.00463, hz);
    }
  }
  ndl *= 1.0 - shade;

  // ── 구름이 드리우는 그림자 ──────────────────────────────────────────────
  // 지상 좌표별 직달 투과율을 구운 지도에서 읽습니다 (utils/cloudShadowMap).
  // 여기서도 깎는 것은 직달뿐입니다 — 구름 그늘도 하늘은 봅니다.
  ndl *= cloudShadowAt(vGround);

  // ── 경사: 급하면 암반(밝고 회색), 완만하면 흙·수풀(어둡고 따뜻) ──────────
  //
  // ⚠ 경사는 **기울기(rise/run = tanθ)** 로 재야 합니다. 흔히 쓰는
  //   1 − n.y 는 전혀 다른 값입니다 — 작은 각에서 θ²/2 라서, 기울기 0.21
  //   (12°) 인 사면도 0.022 밖에 안 됩니다. 그걸 기울기 기준 문턱
  //   (0.10~0.50) 에 넣으면 **이 항이 통째로 죽습니다.** 실제로 그렇게 짰다가
  //   화소 11,366 개의 색조가 0.5918 **하나로 고정**돼 나왔습니다.
  //   땅이 판지처럼 보이던 원인이 이것입니다.
  float ny = max(n.y, 1e-3);
  float slope = sqrt(max(0.0, 1.0 - ny * ny)) / ny;   // = tanθ
  vec3 albRock = uAlbedo * vec3(1.10, 1.18, 1.32);
  vec3 albSoil = uAlbedo * vec3(1.00, 0.90, 0.76);
  vec3 alb = mix(albSoil, albRock, smoothstep(0.10, 0.50, slope));

  // ── 조간대: 젖은 모래는 마른 것의 절반쯤 밝기 ────────────────────────────
  // 폭을 **고도**로 재므로 완만한 모래밭은 넓고 절벽은 좁습니다.
  float wet = uDemValid > 0.5
    ? 1.0 - smoothstep(0.0, max(0.05, uWetBandM), vElevM) : 0.0;
  alb = mix(alb, alb * 0.52, wet);

  // ── 조도 × 알베도 ────────────────────────────────────────────────────────
  //
  // ⚠ 여기에 천공률(그 점이 보는 하늘의 몫)을 넣어 봤습니다. 물리로는 맞지만
  // 재 보니 **음영이 오히려 줄었습니다**(σ 1.192 → 0.618) — 급한 사면을
  // 밝게 하는 위의 암반 알베도와 정확히 반대로 작용해 서로를 지웁니다.
  // 근거 없이 남기지 않고 뺐습니다. 자세한 것은 tools/shader-preview/
  // build-relief.js 주석에 있습니다.
  // ⚠ **직달을 두 번 세고 있었습니다.** uSurfaceIrr 에는 이미 수평면이 받는
  // 직달 몫(beam·sin(고도)/π)이 들어 있는데, 거기에 uSunRadiance·ndl 을 또
  // 더했습니다. 그러면 사면의 향과 **무관한** 직달 받침이 깔려, 해를 등진
  // 면도 마주한 면과 같은 몫을 먼저 받습니다. 산에 입체감이 없던 두 원인
  // 가운데 하나가 이것입니다 (다른 하나는 직달 눈금 자체였습니다 —
  // atmosphere.ts 의 SOLAR_BEAM_SCALE 주석).
  //
  // 받침을 빼고 그 자리에 **제 각도의 몫**을 넣습니다. 평평하고 위를 보는
  // 면은 ndl = sin(고도) 라 값이 정확히 같고, 기울어진 곳만 달라집니다.
  float sunUp = max(0.0, sin(uSunAltRad));
  vec3 skyIrr = max(vec3(0.0), uSurfaceIrr - uSunRadiance * sunUp / 3.14159265);
  vec3 col = alb * (skyIrr + uSunRadiance * ndl / 3.14159265);

  // ── 공기원근 ─────────────────────────────────────────────────────────────
  //
  // ⚠ 연무의 끝색은 **그 방향의 하늘**이어야 합니다. 예전에는 방위 여섯 곳의
  // 평균 한 값(uHazeRadiance)을 하늘 전체에 썼습니다. 그러면 새벽에 해 쪽
  // 산이 **반대쪽 하늘색**을 뒤집어씁니다 — 뒤의 하늘은 주황인데 산만
  // 푸르스름해지는 것이고, 실기에서 "앞산이 원인불명으로 파랗다"고 한
  // 자리가 그쪽이었습니다. 옛 능선 띠는 이미 방향별 하늘색(hazeAt)을
  // 쓰고 있었으니, 새 지형만 뒤처져 있었던 셈입니다.
  if (uAerial > 0.5) {
    vec3 T = atm_aerialTransmittance(vDistM / 1000.0, 0.0,
                                     uBeta, uAngstrom, uElevScale);
    vec3 haze = uHazeRadiance;
    if (uHazeDirectional > 0.5) {
      vec3 dir = normalize(vViewDir);
      vec3 L = vec3(cos(uSunAltRad) * sin(uSunAzRad), sin(uSunAltRad),
                   -cos(uSunAltRad) * cos(uSunAzRad));
      float elevDeg = degrees(asin(clamp(dir.y, -1.0, 1.0)));
      float cosG = clamp(dot(dir, L), -1.0, 1.0);
      // 지평선 아래를 보는 화소도 있으므로 하늘 모형에는 0.5° 를 하한으로
      // 넣습니다 — 그 아래로는 하늘이 정의되지 않습니다.
      // 산 그림자 속 공기는 해에서 곧장 오는 단일산란을 못 받습니다(hazeLitWeight).
      haze = atm_skyRadianceLit(max(0.5, elevDeg), cosG, uSunAltDeg,
        max(0.001, uBeta), max(0.1, uAngstrom), max(0.1, uElevScale), max(50.0, uOzoneDU),
        hazeLitWeight(dir, vDistM));
      haze = max(haze, vec3(0.0));
    }
    // ⚠ (2026-10-02) 연무는 **하늘빛**이라 하늘과 같은 노출로 보여야 합니다. 예전에는 섞은 뒤 통째로
    //   지면 노출(uExposure)과 땅용 눈 순응(atm_groundEyeAdapt, 해 1° 에서 ×2.8)을 먹어, 해 쪽 먼 산이
    //   **제 뒤 하늘보다 밝게** 빛났습니다 — 후쿠이 2026-10-02 17:31, 능선 아래/위 밝기 비 1.0 대 사진 0.52~0.56.
    //   멀리 있는 산은 하늘에 잦아들 뿐 하늘보다 밝아질 수 없습니다. 물의 되비침(SeaPlane)이 같은 까닭으로
    //   이 배수를 미리 나누고 있습니다. 표면 몫(조도 × 알베도)은 예전 그대로 노출·순응을 받습니다.
    float hazeScale = uHazeSkyScale > 0.5 ? 1.0 / max(1e-4, uExposure * atm_groundEyeAdapt(uSunAltDeg)) : 1.0;
    col = col * T + haze * (1.0 - T) * hazeScale;
  }

  gl_FragColor = vec4(atm_display_ground(col * uExposure, uSaturation, uSunAltDeg), 1.0);
}
`;

/**
 * **해 쪽 지평선을 만드는 능선** — 한 화소짜리 굽기 (2026-10-02).
 *
 * 눈에서 해 방위로 지형을 훑어 고도각이 가장 큰 점(곡률 낙차 포함)을 찾고, 그 꼭대기의 **눈 위 높이
 * z** 와 **수평 거리 D** 를 굽습니다. 지형 셰이더의 hazeLitWeight 가 시선 위의 점마다 이 꼭대기를
 * 올려다본 각과 해 원반을 견줘, 그 점의 공기가 햇빛을 얼마나 받는지 냅니다.
 *
 * ⚠ 가림물은 **각도**로 고릅니다. 처음엔 "능선 꼭대기에서 해 고도각으로 내려온 그림자 경계가 눈 자리에서
 *   지나는 높이(z − D·tan(해 고도))"가 가장 큰 점을 골랐는데, 해가 능선들보다 넉넉히 높으면 그 값을
 *   **눈 바로 옆 땅**(눈높이만큼 아래, 수십 m)이 차지해 시선이 그 너머 전부 그늘로 계산됐습니다(도곡동 해 3°).
 *   반대로 먼 능선이 해를 반쯤 가려도 옆 땅이 이겨 그 능선을 놓칩니다. 해가 보이느냐는 각의 문제입니다.
 *
 * 눈 하나에 값 하나라 화소마다 훑으면 낭비입니다(휴대폰에서 화소당 수십 번 더 DEM 을 읽게 됩니다).
 * 그래서 해 방위·지형·눈높이가 바뀔 때만 이 패스를 한 번 그립니다 — 해 고도와는 무관합니다.
 * 걸음은 가까이 20m 에서 멀리 150m(성긴 패치 화소의 절반쯤)까지 — 24km 능선 꼭대기를 놓치지 않을 만큼.
 *
 * 인코딩: (z + 범위) / (2·범위) 를 16비트로 R(윗바이트)·G(아랫바이트), D(m)를 16비트로 B·A.
 */
const SUN_SHADOW_BAKE_VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const SUN_SHADOW_BAKE_FRAG = /* glsl */ `
precision highp float;
${DEM_GLSL}
${demGlsl('demEye')}
${demGlsl('demFar')}
uniform float uObsElevM;
uniform float uEyeHeightM;
uniform float uSunAzRad;

float bakeGroundAtEye() {
  if (uDemEyeValid > 0.5) return demEye_elevationAt(vec2(0.0));
  return uDemValid > 0.5 ? dem_elevationAt(vec2(0.0)) : uObsElevM;
}

void main() {
  float eye = bakeGroundAtEye() + uEyeHeightM;
  vec2 sunH = vec2(sin(uSunAzRad), -cos(uSunAzRad));
  float bestTan = -1.0e9;
  float zc = -${SUN_SHADOW_RANGE_M.toFixed(1)};
  float dOcc = 0.0;
  float t = 20.0;
  for (int i = 0; i < 800; i++) {
    vec2 g = sunH * t;
    float inFine = uDemValid > 0.5 ? dem_inside(g) : 0.0;
    float inFar = uDemFarValid > 0.5 ? demFar_inside(g) : 0.0;
    if (inFine < 0.5 && inFar < 0.5) break;
    float h = inFine > 0.5 ? dem_elevationAt(g) : demFar_elevationDespiked(g);
    float z = h - eye - t * t / (2.0 * 6371000.0);
    if (z / t > bestTan) { bestTan = z / t; zc = z; dOcc = t; }
    t += clamp(t * 0.006, 20.0, 150.0);
  }
  float v = floor(clamp((zc + ${SUN_SHADOW_RANGE_M.toFixed(1)}) / ${(2 * SUN_SHADOW_RANGE_M).toFixed(1)}, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(v / 256.0);
  float w = floor(clamp(dOcc, 0.0, 65535.0) + 0.5);    // 능선까지 m (1m 간격)
  float whi = floor(w / 256.0);
  gl_FragColor = vec4(hi / 255.0, (v - hi * 256.0) / 255.0, whi / 255.0, (w - whi * 256.0) / 255.0);
}
`;

export interface TerrainFieldHandle {
  mesh: THREE.Mesh;
  /** §117 지형 거리 판의 쌍둥이 메시(`LAYER_TERRAIN_DIST`). 씬에 넣으면 합성기가 거리 판에 그립니다. */
  distMesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** DEM 패치를 갈아 끼웁니다. null 이면 평평하게 물러납니다. */
  /** 둘째는 **발밑 고도용**, 셋째는 **성긴(먼 거리)** 패치입니다. 안 주면 그대로 둡니다. */
  setPatch: (
    patch: DemPatch | null,
    eyePatch?: DemPatch | null,
    farPatch?: DemPatch | null,
  ) => void;
  /**
   * 해 방위의 지평선 능선을 굽습니다(SUN_SHADOW_BAKE_FRAG). 해 방위(uSunAzRad)·지형·눈높이가
   * 그대로면 아무것도 안 합니다 — 매 프레임 불러도 됩니다. 그리기 전에 부릅니다.
   */
  bakeSunShadow: (renderer: THREE.WebGLRenderer) => void;
  dispose: () => void;
}

export function createTerrainField(opts: {
  patch?: DemPatch | null;
  /**
   * **발밑 고도만** 이 패치로 짚습니다. 먼 지형 격자가 성긴 패치로 그릴 때
   * 눈높이가 어긋나 이음매에 층계가 생기는 것을 막습니다 (groundAtEye 참고).
   * 안 주면 `patch` 자신이 정합니다 — 근거리 격자의 예전 동작 그대로입니다.
   */
  eyePatch?: DemPatch | null;
  /** DEM 이 없을 때만 쓰이는 대비책. 있으면 DEM 이 정합니다. */
  observerElevM?: number;
  eyeHeightM?: number;
  albedo?: { r: number; g: number; b: number };
  rings?: number;
  spokes?: number;
  /** 격자 안쪽·바깥쪽 거리 (m). 먼 지형 격자가 3km~55km 로 씁니다. */
  nearM?: number;
  farM?: number;
  /**
   * 튀는 화소를 걷어냅니다. **성긴 패치(먼 지형)에서만** 켭니다 — 저줌
   * Terrarium 타일의 R 채널 결함이 첨탑으로 서는 것을 막습니다
   * (demTiles.ts 의 dem_elevationDespiked 참고).
   */
  despike?: boolean;
  /**
   * **성긴 패치** (줌 9, 60km). 주면 이 격자 하나가 발밑부터 55km 까지
   * 맡습니다 — 촘촘한 패치가 보장하는 반지름 안쪽은 촘촘한 것으로, 밖은
   * 이것으로, 사이는 섞어서. 안 주면 예전대로 한 장만 씁니다.
   */
  farPatch?: DemPatch | null;
}): TerrainFieldHandle {
  const alb = opts.albedo ?? { r: 0.22, g: 0.17, b: 0.13 };
  // 성긴 패치는 **늘** 튀는 화소를 걷어냅니다. 저줌 Terrarium 타일의 R 채널
  // 결함이 8.96° 짜리 첨탑으로 서는 것을 막습니다(계획서 8.1절). 촘촘한
  // 패치에는 걸지 않습니다 — 진짜 능선이 깎입니다.
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...makeDemUniforms(opts.patch ?? null),
      ...makeDemUniforms(opts.eyePatch ?? null, 'demEye'),
      ...makeDemUniforms(opts.farPatch ?? null, 'demFar'),
      uDemFarDespike: { value: 1 },
      // 0.30 은 훑어서 고른 값입니다. 섞는 구간에서 **가짜 기울기가 w'(r)·Δh
      // 로 생깁니다** — 촘촘한 패치(줌 13)와 성긴 패치(줌 9)가 같은 자리를
      // 10.9m 다르게 읽으므로, 폭이 좁으면 w' 이 커져 그 어긋남이 한 자리에
      // 몰립니다. 0.75 면 이음매 각짐이 0.84 → 1.35 (최대 5.1 → 8.8) 로
      // 나빠집니다.
      //
      // ⚠ 넓힌다고 **좋아지지는 않습니다.** 0.30 에서 두 격자와 비슷합니다
      //   (평균 0.838 대 0.818, 최대 5.13 대 5.02). 합치는 값은 이음매
      //   품질이 아니라 **메시가 하나가 되는 것**입니다 — 자료 경계가
      //   구조적으로 사라지고 드로우 콜이 줄어듭니다.
      //   (처음에 "−56%" 로 읽었는데 그건 자가 얇아서(한 방위 12줄) 난
      //   착시였습니다. 지금 자는 방위 넷 × 108줄이고 재현됩니다.)
      uBlendInner: { value: 0.30 },
      // 3m 는 어림이 아니라 **어긋남의 크기**에서 나옵니다. 지형은 정점에서,
      // 해수면은 프래그먼트에서 같은 0 등고선을 계산하므로 어긋남은 대략
      // "살 간격의 절반 × 물가 기울기" 입니다 — 물가가 흔한 1~3km 에서
      // 살 간격이 25~74m, 물가 기울기가 1:31(대부도에서 잰 값)이라 0.4~1.2m
      // 입니다. 재 보니 1m 로 이미 구멍이 다 닫히므로(4,821 → 0) 여유를
      // 두어 3m 로 잡습니다. 10m 를 줘도 내륙에 물이 안 번집니다(물화소 불변).
      uShoreOverlapM: { value: 3 },
      uObsElevM: { value: opts.observerElevM ?? 0 },
      uEyeHeightM: { value: opts.eyeHeightM ?? 1.6 },
      uBicubicNormal: { value: 1 },
      uDetail: { value: 0.10 },
      uHurst: { value: 0.82 },
      uSurfaceIrr: { value: new THREE.Vector3(0.05, 0.06, 0.08) },
      uSunRadiance: { value: new THREE.Vector3(0, 0, 0) },
      uSunAzRad: { value: 0 },
      uSunAltRad: { value: 0.5 },
      uSunAltDeg: { value: 30 },
      uAlbedo: { value: new THREE.Vector3(alb.r, alb.g, alb.b) },
      uExposure: { value: 1.0 },
      uSaturation: { value: 1.0 },
      // 지평선 부근 하늘빛(선형). 공기원근이 먼 지형을 여기로 끌고 갑니다.
      uHazeRadiance: { value: new THREE.Vector3(0.05, 0.06, 0.09) },
      uOzoneDU: { value: 330 },
      uHazeDirectional: { value: 1.0 },
      uHazeSkyScale: { value: 1.0 },
      uSunShadowTex: { value: null as THREE.Texture | null },
      uSunShadowValid: { value: 0.0 },
      uHazeShadow: { value: 1.0 },
      uAerial: { value: 1.0 },
      uShadow: { value: 1.0 },
      uDemDespike: { value: opts.despike ? 1 : 0 },
      uCloudShadowTex: { value: createOpenSkyShadowTexture() },
      uCloudShadowHalfM: { value: CLOUD_SHADOW_HALF_M },
      uCloudShadow: { value: 1.0 },
      // 조간대 폭 — **고도** 기준. 조수간만 1~2m 인 서해안 기준.
      uWetBandM: { value: 1.2 },
      uBeta: { value: 0.08 },
      uAngstrom: { value: 1.3 },
      uElevScale: { value: 1.0 },
      ...makeTuningUniforms(),
    },
    vertexShader: FIELD_VERT,
    fragmentShader: FIELD_FRAG,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
  });

  const mesh = new THREE.Mesh(
    createFieldGeometry(opts.rings ?? FIELD_RINGS, opts.spokes ?? FIELD_SPOKES,
                        opts.farM ?? FIELD_FAR_M, opts.nearM),
    material,
  );
  mesh.name = 'terrainField';
  mesh.frustumCulled = false;

  // §117 — 지형 거리 판의 쌍둥이. 기하와 uniform(같은 객체)을 나눠 쓰고 조각 셰이더만 거리를 적습니다.
  // 자식으로 달지 않습니다 — `assignLayer` 가 자손까지 한 층으로 덮어씁니다. 부르는 쪽이 씬에 넣고
  // `LAYER_TERRAIN_DIST` 에 둡니다(여기서 이미 그 층으로 둡니다).
  const distMaterial = material.clone();
  distMaterial.uniforms = material.uniforms;
  distMaterial.defines = { ...(material.defines ?? {}), TERRAIN_DIST_OUT: 1 };
  distMaterial.transparent = false;
  distMaterial.blending = THREE.NoBlending;
  const distMesh = new THREE.Mesh(mesh.geometry, distMaterial);
  distMesh.name = 'terrainFieldDist';
  distMesh.frustumCulled = false;
  distMesh.layers.set(LAYER_TERRAIN_DIST);

  // 해 방위의 지평선 능선 — 한 화소짜리 굽기(SUN_SHADOW_BAKE_FRAG). uniform 은 격자와 **같은 객체**를
  // 나눠 써서 setPatch·해 갱신이 그대로 따라옵니다(굽기 셰이더는 uSunShadowTex 를 선언하지 않으므로
  // 제 출력을 읽는 되먹임이 없습니다).
  const shadowRT = new THREE.WebGLRenderTarget(1, 1, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
  material.uniforms.uSunShadowTex.value = shadowRT.texture;
  const bakeMaterial = new THREE.ShaderMaterial({
    uniforms: material.uniforms,
    vertexShader: SUN_SHADOW_BAKE_VERT,
    fragmentShader: SUN_SHADOW_BAKE_FRAG,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  const bakeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bakeMaterial);
  bakeQuad.frustumCulled = false;
  const bakeScene = new THREE.Scene();
  bakeScene.add(bakeQuad);
  const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let bakedKey = '';
  let patchSerial = 0;

  return {
    mesh,
    distMesh,
    material,
    bakeSunShadow: (renderer) => {
      const u = material.uniforms;
      const hasDem = u.uDemValid?.value > 0.5 || u.uDemFarValid?.value > 0.5;
      if (!hasDem) { u.uSunShadowValid.value = 0; bakedKey = ''; return; }
      // 해 **방위**가 0.0017° 움직이면 다시 굽습니다 — 한 화소라 값이 거의 들지 않습니다. 해 고도와는 무관합니다.
      const q = (x: number) => Math.round(x / 3e-5);
      const key = `${patchSerial}|${q(u.uSunAzRad.value)}|${u.uEyeHeightM.value}`;
      if (key === bakedKey) return;
      const prev = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(shadowRT);
      renderer.render(bakeScene, bakeCam);
      renderer.setRenderTarget(prev);
      renderer.autoClear = prevAuto;
      u.uSunShadowValid.value = 1;
      bakedKey = key;
    },
    setPatch: (patch, eyePatch, farPatch) => {
      patchSerial++;
      const put = (u: Record<string, { value: unknown }>) => {
        Object.entries(u).forEach(([k, v]) => {
          if (material.uniforms[k]) material.uniforms[k].value = v.value;
        });
      };
      // ⚠ makeDemUniforms 는 despike 를 0 으로 되돌립니다 — 격자가 만들어질
      // 때 정한 값을 지키려고 여기서 다시 씌웁니다.
      const despike = material.uniforms.uDemDespike?.value;
      put(makeDemUniforms(patch));
      if (material.uniforms.uDemDespike) material.uniforms.uDemDespike.value = despike;
      if (eyePatch !== undefined) put(makeDemUniforms(eyePatch, 'demEye'));
      if (farPatch !== undefined) {
        put(makeDemUniforms(farPatch, 'demFar'));
        if (material.uniforms.uDemFarDespike) material.uniforms.uDemFarDespike.value = 1;
      }
    },
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
      distMaterial.dispose();
      bakeQuad.geometry.dispose();
      bakeMaterial.dispose();
      shadowRT.dispose();
    },
  };
}

/**
 * ⚠ 메시 원점을 **눈**에 맞춥니다. 매 프레임 카메라가 움직이면 같이 옮겨야
 * 각도가 안 어긋납니다 (씬 원점에 두면 가장 가까운 고리에서 0.9° 틀립니다).
 *
 * ⚠ **Y(세로)는 카메라를 따라가지 않고 항상 0 입니다.** 이 씬의 카메라
 * `camera.position.y` 는 실제 미터가 아니라 화면단위 dip 트릭 값입니다
 * (지면 원반을 기울여 수평선 침강을 흉내 내던 예전 방식 — `TerrainRing.
 * setGroundHorizon`). 이 메시는 눈높이를 이미 **미터** 단위로
 * (`uEyeHeightM` + DEM 고도) 셰이더 안에서 정확히 계산하므로, 카메라의
 * Y 를 메시 위치에도 더하면 **두 셈법이 겹쳐 이중으로 셉니다** — 예를
 * 들어 카메라가 화면단위로 −17 만큼 내려가 있으면 지형 전체가 그만큼
 * 한 번 더 가라앉아 보입니다. 그래서 X/Z(수평 이동, 지금은 항상 0)만
 * 따라가고 Y 는 고정합니다.
 */
export function updateTerrainFieldEye(
  handle: TerrainFieldHandle,
  camera: THREE.Camera,
): void {
  // ⚠ **Y 도 따라가야 합니다.** 이 격자의 정점은 버텍스 셰이더가 눈에서 본
  // 진짜 고도각으로 놓고, 그 각의 기준점이 **메시 원점**입니다. 카메라가
  // 원점에서 벗어나 있으면 그 각이 그대로 화면에 나오지 않습니다.
  //
  // 예전에는 Y 를 0 으로 두었습니다 — "카메라 Y 는 실제 미터가 아니라 옛
  // 원반용 dip 트릭 값이니 따라가지 않는다" 는 이유였는데, 트릭 값이든
  // 아니든 **시차는 생깁니다.** 재 보니 하늘금이 이만큼 어긋났습니다:
  //
  //   해수면 관측지 (카메라 +1.26) : 0.13°~0.36° **아래로**
  //   마니산 350m  (카메라 −3.43) : 0.51°~0.90° **위로**
  //
  // 부호가 관측지 고도에 따라 뒤집히고, 방위마다 크기가 다릅니다(하늘금이
  // 걸리는 거리가 달라 고리 반경이 다르기 때문). 그래서 전체를 한 값으로
  // 보정할 수도 없는, 하늘금의 **모양**을 바꾸는 어긋남입니다.
  //
  // ⚠ 하네스가 이걸 못 잡은 이유: 거의 모두 카메라를 (0,0,0) 에 둡니다.
  //   verify-eye-origin.js 가 일부러 높이를 바꿔 가며 봅니다.
  handle.mesh.position.copy(camera.position);
  // §117 쌍둥이도 같은 자리·같은 보임(DEM 이 오기 전엔 격자를 숨깁니다 — 거리 판에도 없어야 합니다).
  // 하네스 몇은 바다 판 손잡이도 이 함수로 옮기는데, 그쪽엔 쌍둥이가 없습니다.
  if (handle.distMesh) {
    handle.distMesh.position.copy(camera.position);
    handle.distMesh.visible = handle.mesh.visible;
  }
}

/**
 * 어느 방위의 **지평선 각도**(도) — 그 방위에서 가장 높이 보이는 지형.
 *
 * 셰이더와 **같은 식**입니다. 판정이 이걸 CPU 로 다시 구해 화면에서 잰
 * 실루엣과 견줍니다. 여기서 쓰는 고도 표본은 호출부가 넘깁니다(앱은 DEM
 * 텍스처를, 판정은 PNG 를 직접 푼 값을 씁니다) — 그래야 두 구현이
 * 진짜로 독립입니다.
 */
export function horizonAngleDeg(
  azRad: number,
  elevAt: (east: number, south: number) => number,
  opts: { eyeHeightM: number; rings?: number },
): number {
  const rings = opts.rings ?? FIELD_RINGS;
  // ⚠ 지상 좌표는 (동, **남**) 입니다. 방위 A 는 북에서 시계방향이므로
  //   동 = sin A, 남 = −cos A. 부호를 놓치면 180° − A 의 거울상을 읽습니다.
  // ⚠ 발밑도 **같은 자료**에서 읽습니다 — 셰이더의 `groundAtEye` 와 같은 규약.
  const eye = elevAt(0, 0) + opts.eyeHeightM;
  let best = -Infinity;
  for (let k = 0; k < rings; k++) {
    const d = fieldRingDistanceM(k, rings);
    const h = elevAt(Math.sin(azRad) * d, -Math.cos(azRad) * d);
    const drop = (d * d) / (2 * EARTH_RADIUS_M);
    const a = Math.atan2(h - eye - drop, d);
    if (a > best) best = a;
  }
  return (best * 180) / Math.PI;
}
