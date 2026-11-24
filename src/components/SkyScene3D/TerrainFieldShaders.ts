/**
 * TerrainFieldShaders.ts — 지형 높이장(정점 · 프래그먼트 · 산 능선 · 그림자 사전 굽기) GLSL 셰이더 모듈.
 */
import { DEM_GLSL, demGlsl } from '../../utils/demTiles';
import { ATMOSPHERE_GLSL, GROUND_DISPLAY_GLSL } from '../../utils/atmosphere';
import { CLOUD_SHADOW_GLSL } from '../../utils/cloudShadowMap';
import { TERRAIN_DIST_GLSL } from './SceneComposer';
import { LIT2_ENCODE_GLSL } from './terrainLook';
import { EARTH_RADIUS_EFFECTIVE_M_GLSL, GROUND_PROJECT_GLSL, TERRAIN_NOISE_GLSL } from './groundProjection';
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
uniform float uDepthOnly;    // 1 이면 깊이만 기록(볼륨 하늘 시 LAYER_MID 용) — 정점 법선 생략
uniform float uAmbValid;     // 1 이면 프래그먼트가 uAmbTex 에서 B-spline 기울기를 읽음
uniform float uBicubicNormal;

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

// 법선 차분용 빠른 고도 조회 (성긴 패치 despike 생략 — 정점 높이 h 자체는 fieldElev 로 despike 유지)
float fieldElevFast(vec2 g) {
  bool hasFine = uDemValid > 0.5;
  bool hasFar = uDemFarValid > 0.5;
  if (!hasFine && !hasFar) return uObsElevM;
  if (!hasFar) return dem_elevationAt(g);
  if (!hasFine) return demFar_elevationAt(g);
  float w = tf_fineWeight(g);
  if (w <= 0.001) return demFar_elevationAt(g);
  if (w >= 0.999) return dem_elevationAt(g);
  return mix(demFar_elevationAt(g), dem_elevationAt(g), w);
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
  // 거리 판(TERRAIN_DIST_OUT) 및 깊이 전용 패스(uDepthOnly), 그리고 프래그먼트가 구운 B-spline 법선을 덮어쓰는 구간은 DEM 4회 조회를 건너뜁니다.
#ifdef TERRAIN_DIST_OUT
  vNormal = vec3(0.0, 1.0, 0.0);
#else
#ifndef TERRAIN_LIT_OUT
  if (uDepthOnly > 0.5) {
    vNormal = vec3(0.0, 1.0, 0.0);
  } else
#endif
  if (uAmbValid > 0.5 && uBicubicNormal > 0.5 && uDemValid > 0.5 && uDemDespike < 0.5 && tf_fineWeight(g) > 0.65) {
    vNormal = vec3(0.0, 1.0, 0.0);
  } else
  {
    float e = max(8.0, d * 0.03);
    float hx = fieldElevFast(g + vec2(e, 0.0)) - fieldElevFast(g - vec2(e, 0.0));
    float hz = fieldElevFast(g + vec2(0.0, e)) - fieldElevFast(g - vec2(0.0, e));
    // (동, 남) 평면에서의 기울기 → 씬 좌표 법선 (+x 동, +z 남, +y 위)
    vNormal = normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));
  }
#endif

  float eyeElevM = groundAtEye() + uEyeHeightM;
  vec3 p = gp_project(g, h, eyeElevM, r);
  // §117 — 화면 자리는 각도로 놓지만(p 는 미터가 아님) 구름과 견줄 거리는 미터로 따로 냅니다.
  // 곡률 강하를 빼 구름 슬랩의 구면 교차와 같은 기하로 둡니다.
  float dzM = h - eyeElevM - d * d / (2.0 * ${EARTH_RADIUS_EFFECTIVE_M_GLSL});
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
export const SUN_SHADOW_RANGE_M = 4096;
/**
 * §129 해 쪽 능선 굽기(SUN_SHADOW_BAKE_FRAG 한 화소)를 다른 셰이더가 읽는 함수 — 지형 셰이더의 sunRidgeZD 와 같은 부호화.
 * 볼륨 하늘(takram 대기 원근)이 지형 그림자 속 공기의 길이를 구하는 데 씁니다. 반환: (눈 위 꼭대기 높이 m, 수평 거리 m).
 */
export const SUN_RIDGE_DECODE_GLSL = /* glsl */ `
vec2 sunRidgeZDFrom(sampler2D t0) {
  vec4 t = texture(t0, vec2(0.5, 0.5));
  float v = (floor(t.r * 255.0 + 0.5) * 256.0 + floor(t.g * 255.0 + 0.5)) / 65535.0;
  float d = floor(t.b * 255.0 + 0.5) * 256.0 + floor(t.a * 255.0 + 0.5);
  return vec2(v * ${SUN_SHADOW_RANGE_M.toFixed(1)} * 2.0 - ${SUN_SHADOW_RANGE_M.toFixed(1)}, d);
}
`;

// 36걸음 지평선 각도 계산 — FIELD_FRAG 와 256×256 그림자 사전 굽기(TERRAIN_SHADE_BAKE_FRAG)가 공유합니다.
const TERRAIN_HORIZON_GLSL = /* glsl */ `
float terrainHorizonAngle(vec2 g0, float h0, vec2 sunHoriz) {
  float best = -1.5;
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
`;

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
uniform float uDepthOnly;     // 1 이면 깊이만 기록(볼륨 하늘 시 LAYER_MID 용) — 조명·노이즈 조기 종료
uniform float uShoreOverlapM; // 물가에서 겹쳐 그릴 폭 (m). 0 이면 예전처럼 딱 맞닿음
uniform float uShoreMode;     // §157 물가 근처 칠 — 0 정점 보간(예전) · 1 화소마다 자료에서 (SeaPlane 과 같은 값)
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
uniform vec3  uMoonRadiance;
uniform float uMoonAzRad;
uniform float uMoonAltRad;
uniform vec3  uAlbedo;
uniform vec3  uLitAlbedo;     // §129 볼륨 하늘(지형 빛 판)에서 쓰는 알베도 — 흙·암반·물가 비율은 uAlbedo 대비로 그대로
uniform float uExposure;
// 진단(개발용 칩 '지형 대기 진단'): 대기 안 입힌 원래 지형 화소를 분홍으로 — 볼륨 하늘이 덮지 못한 자리가 드러남.
uniform float uDiagRaw;
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
// §157 볼륨 하늘 경로의 땅 보임새(terrainLook.ts) — 지형 빛 판의 둘째 출력에만 쓰입니다.
uniform sampler2D uAmbTex;    // terrainAmbient.ts 가 DEM 에서 구운 하늘 보임(R)·볼록도(G)·기울기(B,A) — dem_uv 좌표
uniform float uAmbValid;
uniform sampler2D uBakedShadeTex; // TERRAIN_SHADE_BAKE_FRAG 가 구운 해(R)·달(G) 산 그림자 — dem_uv 좌표
uniform float uBakedShadeValid;
uniform float uLookAo;
uniform float uLookHemi;
uniform float uLookAmbGain;
uniform float uLookFill;
uniform float uLookSheen;
uniform float uLookMottle;
uniform float uLookMicro;
uniform sampler2D uUrbanTex;
uniform float uUrbanValid;
uniform float uUrbanHalfM;
uniform sampler2D uPaveTex;
uniform float uPaveValid;
uniform float uPaveHalfM;
uniform vec2  uUrbanEyeOffset;
uniform vec2  uNoiseEyeOffset;
// 포장 지도(R 시멘트, G 아스팔트, B 고해상도 물)를 읽습니다. 범위 밖과 가장자리는 0 으로 줄입니다.
vec2 paveRaw(vec2 g) {
  // (켜짐 값 없이 읽습니다. 지도가 없을 때 묶인 빈 텍스처는 0 입니다.)
  vec2 pUv = (g + uUrbanEyeOffset + uPaveHalfM) / max(1.0, 2.0 * uPaveHalfM);
  if (pUv.x <= 0.0 || pUv.x >= 1.0 || pUv.y <= 0.0 || pUv.y >= 1.0) return vec2(0.0);
  float edge = 1.0 - smoothstep(0.85, 0.99, max(abs(pUv.x * 2.0 - 1.0), abs(pUv.y * 2.0 - 1.0)));
  return texture2D(uPaveTex, pUv).rg * edge;
}
// 2026-11-18 가로등 빛 웅덩이(포장 텍스처 A — R 시멘트, G 아스팔트, B 고해상도 물). 0..1.
float paveLamp(vec2 g) {
  if (uPaveValid < 0.5) return 0.0;
  vec2 pUv = (g + uUrbanEyeOffset + uPaveHalfM) / max(1.0, 2.0 * uPaveHalfM);
  if (pUv.x <= 0.0 || pUv.x >= 1.0 || pUv.y <= 0.0 || pUv.y >= 1.0) return 0.0;
  return texture2D(uPaveTex, pUv).a;
}
uniform float uLampGlow;
uniform vec3  uLampColor;
float waterHiRaw(vec2 g) {
  if (uPaveValid < 0.5) return 0.0;
  vec2 pUv = (g + uUrbanEyeOffset + uPaveHalfM) / max(1.0, 2.0 * uPaveHalfM);
  if (pUv.x <= 0.0 || pUv.x >= 1.0 || pUv.y <= 0.0 || pUv.y >= 1.0) return 0.0;
  float edge = 1.0 - smoothstep(0.85, 0.99, max(abs(pUv.x * 2.0 - 1.0), abs(pUv.y * 2.0 - 1.0)));
  return texture2D(uPaveTex, pUv).b * edge;
}
uniform float uFarUrban;
uniform float uCityTerrainGain;
uniform vec2  uCityDirXZ;
uniform sampler2D uCityPatchTex;
uniform float uCityPatchValid;
uniform float uCityPatchHalfM;
uniform float uCityPatchScale;
uniform float uCityTimeScale;
varying float vDistM;
varying float vElevM;
varying vec3  vNormal;
varying vec2  vGround;
varying vec3  vViewDir;
varying float vSlantM;
${TERRAIN_DIST_GLSL}
#ifdef TERRAIN_LIT_OUT
// 지형 빛 판은 출력이 셋입니다(MRT×3) — 0: sqrt(알베도) · 해 몫, 1: 하늘빛 몫 · 젖음 · 구름 투과 (LIT2_ENCODE_GLSL), 2: 지형 거리(terrainDistEncode).
layout(location = 1) out highp vec4 pc_fragColor1;
layout(location = 2) out highp vec4 pc_fragColor2;
${LIT2_ENCODE_GLSL}
#endif

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
${TERRAIN_HORIZON_GLSL}

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
#ifdef TERRAIN_LAMP_OUT
  // 2026-11-18 가로등 빛 웅덩이 — 지형 위에 더하기로 얹습니다(창문 불빛과 같은 방식). 밤에만(uLampGlow).
  {
    float pool = paveLamp(vGround);
    if (pool < 0.004 || uLampGlow < 0.001) discard;
    vec3 T = atm_aerialTransmittance(vDistM / 1000.0, 0.0, uBeta, uAngstrom, uElevScale);
    float fade = 1.0 - smoothstep(1350.0, 1580.0, vDistM);
    gl_FragColor = vec4(uLampColor * (pool * pool) * uLampGlow * T * fade, 1.0);
    return;
  }
#endif
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
  //   지형은 정점에서 보간한 vElevM 로, 해수면은 **자기 격자의** 정점에서 읽은 고도(vWater)로
  //   같은 0 등고선을 각자 계산합니다. 두 격자의 정점이 다르니
  //   어긋나고, 어긋난 화소는 양쪽 다 버려 **구멍**이 됩니다(바닷가에서
  //   4,821화소 — 지금은 옛 원반이 메우고 있었습니다).
  //
  //   그래서 해수면을 뭍 쪽으로 조금 넘겨 그립니다(SeaPlane 의
  //   uShoreOverlapM). 반대로 **지형을 물 쪽으로 넘기면 안 됩니다** —
  //   Terrarium 이 먼바다를 정확히 0 으로 자르므로, 문턱을 조금만 내려도
  //   그 고원(근거리 패치의 38~41%)이 통째로 뭍으로 그려집니다. 실제로
  //   −3m 로 해 봤다가 물 맨위가 −0.05° 에서 −0.48° 로 잘렸고
  //   verify-coastline 6개 · verify-inland 1개가 걸렸습니다.
  //
  // 화면 화소 발자국(m): 2x2 쿼드 미분이 discard 경계에서 깨지지 않게 먼저 잽니다. 발밑(3mm)까지 풀리도록 하한을 낮춤.
  // ⚠ 두 경로 모두에서 선언합니다 — 포장 경계 샤프닝(pvSharp)이 원래 경로에서도 씁니다(볼륨 전용으로 두면 원래 경로 셰이더가 컴파일되지 않음).
  float pixG = max(0.003, 0.5 * length(fwidth(vGround)));
  vec2 wGround = vGround + uNoiseEyeOffset;
  // 광역 외해 연결 마스크가 있으면 바다와 단절된 내륙 0m 이하 저지대는 잘라내지 않고 육지로 남깁니다.
  bool isSeaZone =
      uDemFarSeaValid > 0.5 ? (demFar_seaAt(vGround) > 0.5)
    : uDemSeaValid > 0.5    ? (dem_seaAt(vGround) > 0.5)
    :                         true;
  float mvtWaterHere = -1.0;
  if (uUrbanValid > 0.5) {
    vec2 wUv = (vGround + uUrbanEyeOffset + uUrbanHalfM) / max(1.0, 2.0 * uUrbanHalfM);
    if (wUv.x > 0.02 && wUv.x < 0.98 && wUv.y > 0.02 && wUv.y < 0.98) {
      mvtWaterHere = texture2D(uUrbanTex, wUv).g;
    }
  }
  bool mvtDryLand = mvtWaterHere >= 0.0 && mvtWaterHere < 0.25;
  if (uDemValid > 0.5 && isSeaZone && !mvtDryLand && vElevM <= 0.0) discard;
#ifdef TERRAIN_DIST_OUT
  // §117 지형 거리 판 — 색 대신 눈에서 이 점까지 거리(km)를 적습니다.
  gl_FragColor = terrainDistEncode(vSlantM / 1000.0);
  return;
#endif
#ifndef TERRAIN_LIT_OUT
  if (uDepthOnly > 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
#endif
  //
  // §157 **물가 근처의 고도는 화소마다 자료에서 다시 읽습니다 — 어디를 버릴지(위)는 그대로 두고, 칠하는 값만.**
  //   젖은 띠·마른 띠·물가의 하늘 되비침·산 그림자의 출발 높이가 정점 고도(격자 살 간격 25~74m)를 삼각형 안에서 보간한
  //   값이라 경계가 삼각형 모양 얼룩이 됐습니다. dem_shoreField 의 B-스플라인으로 흐린 고도(C2)를 쓰면 15m 자료 그대로,
  //   화소 계단 없이 이어집니다. 버리는 자리를 화소마다 가르는 것은 **해 봤다가 접었습니다** — 정점 고도(지오메트리)와
  //   버리는 규칙이 어긋나, 낮은 눈높이의 스치는 시선에서 지형이 버린 자리를 해수면이 못 덮는 가는 구멍이 납니다
  //   (disc-horizon 바닷가 0 → 134~184화소, 방위 225° 한 줄. COASTLINE_PLAN 13절).
  //   정점 고도가 높은 곳(12m 넘게 올라간 삼각형)은 읽지 않습니다 — 젖은·마른 띠는 해발 5m 아래에만 있으므로 읽기를 아낍니다.
  //   despike 를 켠 패치는 성긴 자료(243m)라 흐리지 않습니다.
  float elevF = vElevM;   // 물가 근처의 칠에 쓰는 고도
  if (uShoreMode > 0.5 && uDemValid > 0.5 && uDemDespike < 0.5 && vElevM < 12.0 && dem_inside(vGround) > 0.5) {
    float hbS; vec2 grS;
    elevF = dem_shoreField(vGround, hbS, grS);
  }

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
  vec4 ambSample = vec4(0.93, 0.5, 0.5, 0.5);
  bool hasAmbSample = uAmbValid > 0.5;
  if (hasAmbSample) {
    ambSample = texture2D(uAmbTex, dem_uv(vGround));
  }
  // 세배 법선은 **촘촘한 패치가 맡는 자리**에만 겁니다. uAmbTex 가 유효하면 B, A 에 구운
  // 16-tap B-스플라인 기울기를 읽어 화소당 16회 DEM 텍셀 읽기를 생략합니다.
  float fineW = uDemValid > 0.5 ? 1.0 - smoothstep(dem_probeRadiusM() * uBlendInner,
                                                   dem_probeRadiusM() * 0.98,
                                                   length(vGround)) : 0.0;
  if (uBicubicNormal > 0.5 && uDemValid > 0.5 && uDemDespike < 0.5 && fineW > 0.5) {
    if (hasAmbSample) {
      vec2 encG = ambSample.ba * 2.0 - 1.0;
      texGrad = sign(encG) * encG * encG * 4.0;
    } else {
      texGrad = dem_gradientBicubic(vGround);
    }
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
    vec2 g = wGround;
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
  // 알베도·젖음을 가르는 경사는 **자료의 기울기**여야 합니다 — 아래 미세 기복이 섞인 법선으로 재면 평평한 벌판에
  // 암반 색이 얼룩지고 젖은 갯벌의 되비침이 꺼집니다. (미세 기복을 안 쓰는 경로에서는 n 과 같은 값입니다.)
  vec3 nMacro = n;
  float ny = max(nMacro.y, 1e-3);
  float slope = sqrt(max(0.0, 1.0 - ny * ny)) / ny;   // = tanθ
  // 2026-11-18 포장된 곳(±1.6 km, 광폭 선형 SDF): 0.5 등고선이 정확한 도로·인도 경계입니다.
  // 쌍선형 보간된 선형 SDF 에 화면 미분(fwidth / pixG) 폭만큼만 안티에일리어싱을 걸어
  // 3.125 m 텍셀 격자의 물결(Scalloping) 없이 대각선 도로 경계를 칼날처럼 곧은 직선으로 복원합니다.
  vec2 pvN = paveRaw(vGround);
  float paveSlopeW = (1.0 - smoothstep(2.5, 4.0, slope)) * (1.0 - ((uDemValid > 0.5 && isSeaZone) ? 1.0 - smoothstep(0.0, max(0.05, uWetBandM), elevF) : 0.0));
  // SDF 1단위 = 2 * PAVE_SDF_HALF_PX(2.75) * 3.125m ≈ 17.19m. 화면 1.2 픽셀 폭만큼만 부드럽게 전환.
  float pvAa = clamp(pixG * 0.075, 0.008, 0.11);
  float paveC = smoothstep(0.5 - pvAa, 0.5 + pvAa, pvN.r) * paveSlopeW;
  float paveA = smoothstep(0.5 - pvAa, 0.5 + pvAa, pvN.g) * paveSlopeW;
  float paveAny = max(paveC, paveA);
  // 차도(paveA)와 인도(paveC) 경계(pvN.g ≈ 0.5)에 얇은 연석(curb) 음영선을 넣어 도로 경계 품질을 높입니다.
  float curbW = max(pvAa * 1.35, 0.018);
  float curbLine = paveC * (1.0 - smoothstep(0.0, curbW, abs(pvN.g - 0.5)));
  float paveN = paveAny;
  // 도심 고도 자료(SRTM 계열)에는 건물 높이가 섞여 평지가 기울어 나오지만 도로·인도 노면은 수평에 가깝습니다.
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.95 * paveAny));
#ifdef TERRAIN_LIT_OUT
  // §157 **미세 기복 + 초근접(cm~dm) 지표 디테일** — 자료(15m)가 모르는 요철과 발밑(0.6~95m)의 풀·자갈·암반 질감.
  //
  // 95m 밖 원거리 산에서는 nearW = 0 이 되어 기존과 동일한 법선·색감을 유지하고, 발밑 구간에서만 회전/워핑된
  // C2 Gradient Noise + 3x3 Cellular 자갈/풀 뭉치 노이즈를 pixG 발자국에 맞춰 안티에일리어싱 페이드 인 합니다.
  float nearW = 1.0 - smoothstep(25.0, 95.0, vDistM);
  float wetM = (uDemValid > 0.5 && isSeaZone) ? 1.0 - smoothstep(0.0, max(0.05, uWetBandM), elevF) : 0.0;
  float detailH = 0.5;
  float detailRockH = 0.5;
  float detailGrain = 0.5;
  float detailCellId = 0.5;
  float rockCrack = 0.0;
  vec2 nearWarp = vec2(0.0);
  {
    float pmm = max(0.05, vDistM * 0.0015);
    vec2 wp = wGround;
    if (nearW > 0.001) {
      nearWarp = vec2(tn_gnoise(wGround / 11.0 + 1.3), tn_gnoise(wGround / 11.0 + 7.9)) - 0.5;
      wp += nearWarp * (1.2 * nearW);
    }
    vec2 gm = vec2(0.0);
    float Lm = 4.0;
    mat2 rot = mat2(1.0, 0.0, 0.0, 1.0);
    for (int o = 0; o < 4; o++) {
      float vis = smoothstep(1.0, 3.0, Lm / pmm);
      if (vis > 0.001) {
        float A = uLookMicro * 0.12 * (1.0 - 0.7 * wetM) * vis;
        float e = Lm * 0.25;
        vec2 oOff = vec2(3.7 + float(o) * 5.3, 1.9 + float(o) * 2.7);
        vec2 baseP = (rot * wp) / Lm + oOff;
        float c = tn_gnoise(baseP);
        vec2 gradL = vec2(tn_gnoise(baseP + rot[0] * (e / Lm)) - c,
                          tn_gnoise(baseP + rot[1] * (e / Lm)) - c);
        gm += A * 4.0 * gradL;
      }
      Lm *= 0.5;
      rot = TN_ROT * rot;
    }
    if (nearW > 0.001) {
      vec2 nq = wGround + nearWarp * 0.55;
      vec2 nq1 = TN_ROT * nq;
      vec2 nq2 = TN_ROT * nq1;
      float vis30 = smoothstep(1.0, 3.0, 0.30 / pixG);
      float vis11 = smoothstep(1.0, 3.0, 0.11 / pixG);
      float vis04 = smoothstep(1.0, 3.0, 0.04 / pixG);
      float raw30 = vis30 > 0.001 ? tn_gnoise(nq / 0.30 + vec2(4.2, 8.7)) : 0.5;
      float raw11 = vis11 > 0.001 ? tn_gnoise(nq1 / 0.11 + vec2(12.1, 3.4)) : 0.5;
      float raw04 = vis04 > 0.001 ? tn_gnoise(nq2 / 0.04 + vec2(19.5, 6.2)) : 0.5;
      float n30 = mix(0.5, raw30, vis30);
      float n11 = mix(0.5, raw11, vis11);
      float n04 = mix(0.5, raw04, vis04);
      vec2 cvC = vec2(0.0);
      vec2 cvF = vec2(0.0);
      vec3 cC = vis30 > 0.001 ? tn_cell(nq / 0.38 + vec2(2.7, 5.1), cvC) : vec3(0.5, 0.25, 0.5);
      vec3 cF = vis11 > 0.001 ? tn_cell(nq1 / 0.11 + vec2(9.3, 1.8), cvF) : vec3(0.5, 0.25, 0.5);
      float clumpH = mix(0.5, smoothstep(0.0, 0.22, cC.y) * mix(0.68, 1.0, cC.z), vis30);
      float pebbleH = mix(0.5, smoothstep(0.0, 0.24, cF.y) * mix(0.62, 1.0, cF.z), vis11);
      float fbmFine = 0.5 + (n30 - 0.5) * 0.45 + (n11 - 0.5) * 0.35 + (n04 - 0.5) * 0.25;
      detailGrain = clamp(fbmFine, 0.0, 1.0);
      detailH = clamp(mix(fbmFine, 0.55 * fbmFine + 0.25 * clumpH + 0.20 * pebbleH - 0.05, 0.85), 0.0, 1.0);
      detailRockH = clamp(0.45 * fbmFine + 0.55 * mix(0.5, smoothstep(0.02, 0.26, cC.y) * mix(0.7, 1.0, cC.z), vis30) - 0.05, 0.0, 1.0);
      rockCrack = mix(0.0, 1.0 - smoothstep(0.0, 0.11, cC.y), vis30) + 0.45 * mix(0.0, 1.0 - smoothstep(0.0, 0.10, cF.y), vis11);
      detailCellId = mix(0.5, cF.z, vis11);
      float microWet = nearW * uLookMicro * (1.0 - 0.8 * wetM);
      if (microWet > 0.001) {
        gm += cvC * (0.42 * vis30 * microWet);
        vec2 cvFw = vec2(dot(TN_ROT[0], cvF), dot(TN_ROT[1], cvF));
        gm += cvFw * (0.55 * vis11 * microWet);
        if (vis11 > 0.001) {
          float e1 = 0.025;
          vec2 o1 = vec2(12.1, 3.4);
          vec2 g1 = vec2(
            tn_gnoise((nq1 + TN_ROT[0] * e1) / 0.11 + o1) - raw11,
            tn_gnoise((nq1 + TN_ROT[1] * e1) / 0.11 + o1) - raw11
          ) * (0.11 / e1);
          gm += g1 * (0.28 * vis11 * microWet);
        }
        if (vis04 > 0.001) {
          float e2 = 0.010;
          vec2 o2 = vec2(19.5, 6.2);
          vec2 rot20 = TN_ROT * TN_ROT[0];
          vec2 rot21 = TN_ROT * TN_ROT[1];
          vec2 g2 = vec2(
            tn_gnoise((nq2 + rot20 * e2) / 0.04 + o2) - raw04,
            tn_gnoise((nq2 + rot21 * e2) / 0.04 + o2) - raw04
          ) * (0.04 / e2);
          gm += g2 * (0.22 * vis04 * microWet);
        }
      }
    }
    // 포장 도로·인도 위는 38cm/11cm 풀·자갈 세포 법선 요철(gm)을 완전히 제거해 매끄러운 아스팔트 노면이 되게 합니다.
    vec2 g0 = vec2(-n.x, -n.z) / max(n.y, 1e-3) + gm * (1.0 - paveAny);
    n = normalize(vec3(-g0.x, 1.0, -g0.y));
  }
#endif

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
  float moonShade = 0.0;
  bool useBakedShade = uBakedShadeValid > 0.5 && uShadow > 0.5 && uDemValid > 0.5 && dem_inside(vGround) > 0.5;
  vec4 bakedHzSample = vec4(0.0);
  if (useBakedShade) {
    bakedHzSample = texture2D(uBakedShadeTex, dem_uv(vGround));
    float hzSun = -0.10 + (bakedHzSample.r + bakedHzSample.g) * 0.60;
    shade = smoothstep(uSunAltRad - 0.00463, uSunAltRad + 0.00463, hzSun);
  } else if (uShadow > 0.5 && uDemValid > 0.5) {
    vec2 sunHoriz = vec2(sun.x, sun.z);
    float sl = length(sunHoriz);
    if (sl > 1e-4) {
      float hz = terrainHorizonAngle(vGround, elevF, sunHoriz / sl);
      shade = smoothstep(uSunAltRad - 0.00463, uSunAltRad + 0.00463, hz);
    }
  }
  // 도심 DEM의 미세 고도 둔덕이 평평한 도로 한가운데에 구불구불한 가짜 언덕 그림자를 드리우지 않도록 억제합니다.
  shade *= 1.0 - 0.85 * paveAny;
  ndl *= 1.0 - shade;

  // ── 구름이 드리우는 그림자 ──────────────────────────────────────────────
  // 지상 좌표별 직달 투과율을 구운 지도에서 읽습니다 (utils/cloudShadowMap).
  // 여기서도 깎는 것은 직달뿐입니다 — 구름 그늘도 하늘은 봅니다.
  float cloudT = cloudShadowAt(vGround);   // 직달 투과율 — 구름 그늘이면 0 쪽
  ndl *= cloudT;

  // ── 달빛 입체 음영 및 산 그림자 ──────────────────────────────────────────
  vec3 moon = vec3(cos(uMoonAltRad) * sin(uMoonAzRad),
                   sin(uMoonAltRad),
                  -cos(uMoonAltRad) * cos(uMoonAzRad));
  float moonUp = max(0.0, sin(uMoonAltRad));
  float ndlMoon = max(0.0, dot(n, moon));
  if (useBakedShade) {
    if (moonUp > 0.0 && length(uMoonRadiance) > 1e-4) {
      float hzMoon = -0.10 + (bakedHzSample.b + bakedHzSample.a) * 0.60;
      moonShade = smoothstep(uMoonAltRad - 0.00463, uMoonAltRad + 0.00463, hzMoon);
    }
  } else if (uShadow > 0.5 && uDemValid > 0.5 && moonUp > 0.0 && length(uMoonRadiance) > 1e-4) {
    vec2 moonHoriz = vec2(moon.x, moon.z);
    float ml = length(moonHoriz);
    if (ml > 1e-4) {
      float hzMoon = terrainHorizonAngle(vGround, elevF, moonHoriz / ml);
      moonShade = smoothstep(uMoonAltRad - 0.00463, uMoonAltRad + 0.00463, hzMoon);
    }
  }
  moonShade *= 1.0 - 0.85 * paveAny;
  ndlMoon *= 1.0 - moonShade;
  ndlMoon *= cloudT;

  // ── 경사: 급하면 암반(밝고 회색), 완만하면 흙·수풀(어둡고 따뜻) ──────────
  //
  // ⚠ 경사는 **기울기(rise/run = tanθ)** 로 재야 합니다. 흔히 쓰는
  //   1 − n.y 는 전혀 다른 값입니다 — 작은 각에서 θ²/2 라서, 기울기 0.21
  //   (12°) 인 사면도 0.022 밖에 안 됩니다. 그걸 기울기 기준 문턱
  //   (0.10~0.50) 에 넣으면 **이 항이 통째로 죽습니다.** 실제로 그렇게 짰다가
  //   화소 11,366 개의 색조가 0.5918 **하나로 고정**돼 나왔습니다.
  //   땅이 판지처럼 보이던 원인이 이것입니다.
  float rockMask = smoothstep(0.10, 0.50, slope);
  vec3 albRock = uAlbedo * vec3(1.10, 1.18, 1.32);
  vec3 albSoil = uAlbedo * vec3(1.00, 0.90, 0.76);
  vec3 alb = mix(albSoil, albRock, rockMask);

  // ── 조간대: 젖은 모래는 마른 것의 절반쯤 밝기 ────────────────────────────
  // 폭을 **고도**로 재므로 완만한 모래밭은 넓고 절벽은 좁습니다.
  float wet = (uDemValid > 0.5 && isSeaZone)
    ? 1.0 - smoothstep(0.0, max(0.05, uWetBandM), elevF) : 0.0;
  alb = mix(alb, alb * 0.52, wet);

  // ── 도시·거주지 포장 지반(회색 콘크리트/아스팔트) ────────────────────────
  // MVT 토지이용 마스크(±3km)가 있으면 구역별로, 밖이나 로드 전엔 불빛 지도(uFarUrban)로 보조합니다.
  float urbanRaw = clamp(uFarUrban * 0.65, 0.0, 1.0);
  float urbanMapW = 0.0;   // 토지이용 지도가 이 자리를 덮는 정도
  if (uUrbanValid > 0.5) {
    vec2 uUv = (vGround + uUrbanEyeOffset + uUrbanHalfM) / max(1.0, 2.0 * uUrbanHalfM);
    float inBox = step(0.0, uUv.x) * step(uUv.x, 1.0) * step(0.0, uUv.y) * step(uUv.y, 1.0);
    if (inBox > 0.5) {
      float edgeFade = 1.0 - smoothstep(0.82, 0.99, max(abs(uUv.x * 2.0 - 1.0), abs(uUv.y * 2.0 - 1.0)));
      float mapUrban = texture2D(uUrbanTex, uUv).r;
      urbanRaw = mix(urbanRaw, mapUrban, edgeFade);
      urbanMapW = edgeFade;
    }
  }
  // 경사로 도시 지반을 끄는 제한은 불빛 지도로 짐작할 때만 빡빡하게 씁니다. 토지이용 지도가 도시라고 하면
  // 도심 고도 자료의 건물 요철(tan 1~2)에 지지 않게 절벽 수준까지 둡니다.
  float urbanSlopeGuard = 1.0 - smoothstep(mix(0.16, 1.5, urbanMapW), mix(0.38, 3.0, urbanMapW), slope);
  float urbanMask = clamp(urbanRaw * urbanSlopeGuard * (1.0 - wet), 0.0, 1.0);
  vec3 albUrban = vec3(dot(uAlbedo, vec3(0.30, 0.59, 0.11)));
  alb = mix(alb, albUrban, urbanMask);
  // 건물 둘레·도로 인도는 밝은 시멘트, 차도는 차가운 암회색 아스팔트, 그 사이에는 연석(curbLine) 음영을 둡니다.
  vec3 albConcrete = albUrban * vec3(1.75, 1.72, 1.66) * (1.0 - 0.25 * curbLine);
  vec3 albAsphalt = albUrban * vec3(0.46, 0.48, 0.54);
  alb = mix(mix(alb, albConcrete, paveC), albAsphalt, paveA);
  float waterRaw = max(waterHiRaw(vGround), max(0.0, mvtWaterHere));
  waterRaw *= (1.0 - smoothstep(0.45, 0.75, paveAny)) * (1.0 - smoothstep(0.8, 1.8, slope));
  float waterMix = smoothstep(0.25, 0.65, waterRaw);

#ifdef TERRAIN_LIT_OUT
  // §129 볼륨 하늘 — 색 대신 **알베도(선형)와 햇빛 몫**을 적습니다. §157 부터 둘째 출력에 하늘빛 몫·젖음·구름 투과를 더합니다.
  //
  // ⚠ 알베도는 **sqrt 로 적습니다.** 땅 알베도가 0.05 안팎이라 8비트에 선형으로 담으면 단계가 값의 8% 입니다 —
  //   어두운 땅이 층지고 흙·암반·젖은 물가의 비율 차이(×0.52~×1.3)가 정수 몇 칸으로 뭉개졌습니다. 볼륨 하늘의 대기 효과가
  //   제곱해서 읽습니다(volumetricScene.ts 의 vtAlb).
  float sunLum = dot(uSunRadiance, vec3(0.2126, 0.7152, 0.0722));
  float surfLum = dot(uSurfaceIrr, vec3(0.2126, 0.7152, 0.0722));
  float moonLum = dot(uMoonRadiance, vec3(0.2126, 0.7152, 0.0722));
  float moonShare = moonLum / max(max(sunLum, surfLum) + moonLum, 1e-6);
  float litFactor = clamp(mix(ndl, ndlMoon, moonShare), 0.0, 1.0);
  float rockMaskHi = nearW > 0.001 ? mix(rockMask, tn_hblend(rockMask, detailH, detailRockH), nearW) : rockMask;
  if (nearW > 0.001) {
    alb = mix(albSoil, albRock, rockMaskHi);
    alb = mix(alb, alb * 0.52, wet);
    alb = mix(alb, albUrban, urbanMask);
    alb = mix(mix(alb, albConcrete, paveC), albAsphalt, paveA);
  }

  // ── 알베도 얼룩 + 초근접 입자감 ─────────────────────────────────────────
  // 원거리 3겹은 기존과 같이 유지해 산 풍경을 보존하고, 중간·근거리 옥타브는 회전/Gradient Noise + 0.13m/0.04m
  // 2겹을 추가해 발밑(0.6~95m)의 흐린 얼룩을 자갈·풀·토양 알갱이로 쪼갭니다.
  float mot = 0.0;
  {
    float Lc = 120.0, ampC = 0.35;
    vec2 mg = wGround;
    for (int o = 0; o < 8; o++) {
      float vis = smoothstep(1.0, 3.0, Lc / pixG);
      if (o >= 6) vis *= nearW;
      if (vis > 0.001) {
        float nVal = o < 3 ? tn_noise(wGround / Lc + 17.3 * float(o))
                           : tn_gnoise(mg / Lc + vec2(17.3, 11.7) * float(o));
        mot += (nVal - 0.5) * ampC * vis;
      }
      Lc *= 0.32;
      ampC = min(0.5, ampC * 1.16);
      mg = TN_ROT * mg;
    }
  }
  float slopeFlat = 1.0 - smoothstep(0.03, 0.18, slope);
  float slopeFlat0 = 1.0 - smoothstep(0.35, 0.8, slope);   // 군락은 급사면(암반)만 아니면 어디서나
  float convex = 0.5, aoV = 1.0;
  if (hasAmbSample) {
    float rp = dem_probeRadiusM();
    float fadeAmb = 1.0 - smoothstep(rp * 0.6, rp * 0.97, length(vGround));   // 촘촘한 패치 밖은 평균값으로
    aoV = mix(0.93, ambSample.r, fadeAmb);
    convex = mix(0.5, ambSample.g, fadeAmb);
  }
  vec3 albL = alb;
  albL *= 1.0 + uLookMottle * mix(mix(vec3(0.50, 0.34, -0.12), vec3(0.15, 0.15, 0.15), urbanMask), vec3(0.03), paveAny) * mot;   // 도시 지반은 무채색 콘크리트 농담
  // 군락: 근거리에서는 Height-Based Blending 으로 큰 패치(46m·9.5m·23m) 경계를 자잘한 풀·자갈·틈새로 쪼갭니다.
  vec2 patchG = wGround + nearWarp * (1.2 * nearW);
  float shrub = clamp(smoothstep(0.58, 0.64, tn_noise(patchG / 46.0 + 9.1)) * smoothstep(1.0, 3.0, 46.0 / pixG)
                    + smoothstep(0.62, 0.68, tn_noise(patchG / 9.5 + 23.7)) * smoothstep(1.0, 3.0, 9.5 / pixG) * 0.7, 0.0, 1.0);
  float bare = smoothstep(0.62, 0.68, tn_noise(patchG / 23.0 + 51.3)) * smoothstep(1.0, 3.0, 23.0 / pixG);
  if (nearW > 0.001) {
    shrub = mix(shrub, tn_hblend(shrub, detailH * 0.85, detailGrain), nearW);
    bare = mix(bare, tn_hblend(bare, detailH, detailRockH), nearW);
  }
  float natVeg = slopeFlat0 * (1.0 - urbanMask * 0.85) * (1.0 - paveAny);
  albL = mix(albL, albL * vec3(0.70, 0.80, 0.62), shrub * 0.8 * uLookMottle * natVeg);
  albL = mix(albL, albL * vec3(1.38, 1.20, 0.95), bare * 0.7 * uLookMottle * natVeg);
  if (nearW > 0.001) {
    float dryNear = nearW * (1.0 - wet);
    float soilMicro = (detailCellId - 0.5) * 0.06 + (detailGrain - 0.5) * 0.28;
    float tuftTip = mix(0.86, 1.14, detailH);
    float rockFissure = 1.0 - 0.10 * clamp(rockCrack, 0.0, 1.0);
    float rockSpeck = 1.0 + 0.16 * (detailCellId - 0.5);
    float grassMod = mix(mix(1.0 + soilMicro, tuftTip, shrub * 0.75), 1.0 + soilMicro * 0.65, urbanMask);
    grassMod = mix(grassMod, 1.0 + (detailGrain - 0.5) * 0.05, paveAny);   // 포장: 매우 고운 아스팔트 입자만
    float grainFactor = mix(grassMod, rockFissure * rockSpeck, rockMaskHi * (1.0 - paveAny));
    albL *= mix(1.0, grainFactor, dryNear * clamp(uLookMottle, 0.0, 1.2));
  }
  albL *= 1.0 + uLookMottle * 0.25 * (convex - 0.5) * (1.0 - 0.85 * paveAny);          // 둔덕은 조금 밝게(마르고 트임), 움푹은 어둡게
  // 갯벌 윗자락·방조제 밑은 마르고 밝습니다 — 젖은 아랫자락(×0.52, 위)과 이어져 물가에서 땅으로 가는 **그라데이션**이 생깁니다.
  float dryBand = smoothstep(0.9, 1.8, elevF) * (1.0 - smoothstep(2.5, 5.0, elevF)) * slopeFlat * (1.0 - paveAny);
  albL = mix(albL, albL * vec3(1.45, 1.38, 1.22), dryBand * 0.55 * uLookMottle);

  // ── 방안 C: 근거리 Micro Cavity AO + Oren-Nayar 거칠기 음영 ──────────────
  // 풀·자갈·바위 틈새에 하늘빛/직달 미세 차폐를 걸고, 건조 지표에 거친 표면 음영과 약한 광물 반짝임을 더합니다.
  // 평균 밝기는 보존(0.5 전후 대칭 보정)해 기존 노출·색감 교정(VOLUMETRIC_TERRAIN_ALBEDO)이 틀어지지 않게 합니다.
  float microStrength = nearW * (1.0 - wet) * (0.40 + 0.60 * uLookMicro) * (1.0 - paveAny);
  float crackOcc = clamp(rockCrack * 0.55 * mix(0.4, 1.0, rockMaskHi), 0.0, 0.45);
  float microAo = mix(1.0, clamp(mix(0.76, 1.16, detailH) - crackOcc * 0.20, 0.60, 1.14), microStrength);
  float microDirect = mix(1.0, clamp(mix(0.80, 1.16, detailH) - crackOcc * 0.16, 0.64, 1.14), microStrength);
  float litOut = litFactor * microDirect;
  if (nearW > 0.001 && (1.0 - wet) > 0.01 && litFactor > 0.001) {
    vec3 V = -normalize(vViewDir);
    float ndv = clamp(dot(n, V), 0.02, 1.0);
    float ndlRaw = max(dot(n, sun), 0.0);
    if (ndlRaw > 0.001) {
      float sigma = mix(0.52, 0.78, rockMaskHi);
      float s2 = sigma * sigma;
      float onA = 1.0 - 0.5 * s2 / (s2 + 0.33);
      float onB = 0.45 * s2 / (s2 + 0.09);
      vec3 vp = V - n * ndv;
      vec3 lp = sun - n * ndlRaw;
      float vv = dot(vp, vp);
      float ll = dot(lp, lp);
      float cosAz = (vv > 1e-6 && ll > 1e-6) ? dot(vp, lp) * inversesqrt(vv * ll) : 0.0;
      float sinMax = sqrt(max(0.0, 1.0 - min(ndv, ndlRaw) * min(ndv, ndlRaw)));
      float tanMin = sqrt(max(0.0, 1.0 - max(ndv, ndlRaw) * max(ndv, ndlRaw))) / max(max(ndv, ndlRaw), 0.05);
      float orenRaw = onA + onB * max(0.0, cosAz) * sinMax * tanMin;
      float oren = clamp(orenRaw / max(onA + 0.18 * onB, 0.72), 0.78, 1.22);
      vec3 H = normalize(V + sun);
      float dryGrit = mix(0.25, 1.0, rockMaskHi) * (1.0 - 0.75 * shrub) * (0.4 + 0.6 * detailCellId);
      float microSpec = pow(max(0.0, dot(n, H)), mix(20.0, 44.0, rockMaskHi)) * 0.14 * dryGrit * (1.0 - shade) * cloudT;
      float dryWeight = nearW * (1.0 - wet) * (1.0 - 0.92 * paveAny);
      litOut = clamp(litOut * mix(1.0, oren, dryWeight) + microSpec * dryWeight, 0.0, 1.0);
    }
  }

  // ── 하늘빛 몫: 지평선 가림(AO) × 사면 방향(반구) × Micro Cavity AO ────────
  // 수평면이 받는 하늘 조도(takram) 에 곱합니다. 직달이 구름에 가려진 날 땅의 형태를 보여 주는 것은 이것뿐입니다.
  // 야간에는 사면 방위(uCityDirXZ 기준)와 능선 볼록도(convex) 차이를 더해 달이 없는 밤에도 산 능선·계곡 음영이 살도록 합니다.
  float nightAzW = smoothstep(2.0, -6.0, uSunAltDeg) * smoothstep(0.05, 0.35, slope) * (1.0 - paveAny);
  vec2 cDirT = normalize(uCityDirXZ + vec2(1e-5));
  vec2 cPerpT = vec2(-cDirT.y, cDirT.x);
  vec2 nHorizT = normalize(vec2(n.x, n.z) + vec2(1e-5));
  float terrainAzWrap = 1.0 + nightAzW * (0.34 * dot(nHorizT, cDirT) + 0.12 * dot(nHorizT, cPerpT));
  float ridgeOcc = 1.0 + 0.28 * (convex - 0.5) * (1.0 - paveAny);
  float amb = mix(1.0, aoV, uLookAo) * mix(1.0, 0.5 + 0.5 * n.y, uLookHemi) * uLookAmbGain * microAo * ridgeOcc * terrainAzWrap;
  // 구름 그늘의 땅에 닿는 **구름을 뚫은 햇빛**(확산) — 직달 투과가 막힌 만큼.
  // 구름을 뚫은 햇빛은 **해 쪽이 밝은 넓은 빛**입니다(해 둘레가 가장 밝은 구름 밑면) — 랩 램버트로 사면의 향을 보여 줍니다.
  // 평지의 값으로 나눠 평평한 벌판의 밝기는 그대로 둡니다.
  float fillGeo = clamp((dot(n, sun) + 0.6) / 1.6, 0.0, 1.0);
  float fillFlat = clamp((sin(uSunAltRad) + 0.6) / 1.6, 0.05, 1.0);
  float fill = (1.0 - cloudT) * uLookFill * clamp(fillGeo / fillFlat, 0.0, 2.0);
  // 젖은 면의 하늘 되비침: 갯벌(wet) 중 평평한 곳, 덩어리로 얼룩(고인 물 자리).
  float sheen = wet * slopeFlat * mix(0.5, 1.0, tn_noise(wGround / 23.0 + 7.1)) * uLookSheen;

  vec3 natLitAlb = albL * (uLitAlbedo / max(uAlbedo, vec3(1e-4)));
  float urbLumaScale = clamp(dot(albL, vec3(0.30, 0.59, 0.11)) / max(dot(uAlbedo, vec3(0.30, 0.59, 0.11)), 1e-4), 0.70, 1.30);
  vec3 urbLitAlb = vec3(0.056, 0.058, 0.062) * urbLumaScale;
  // 포장은 도시 평균 회색(urbLitAlb, 밝기 ±30% 로 묶임)을 거치지 않고 제 색을 씁니다.
  // 풀밭 0.05 안팎에 견줘 인도(시멘트)는 밝은 회백색, 차도(아스팔트)는 차가운 암회색이며 연석(curbLine)으로 경계를 또렷이 가릅니다.
  float paveGrain = 1.0 + 0.04 * mot + (nearW > 0.001 ? (detailGrain - 0.5) * 0.06 * nearW : 0.0);
  vec3 concreteLit = vec3(0.092, 0.091, 0.088) * paveGrain * (1.0 - 0.28 * curbLine);
  vec3 asphaltLit = vec3(0.023, 0.025, 0.029) * paveGrain;
  vec3 outLitAlb = mix(natLitAlb, urbLitAlb, urbanMask);
  outLitAlb = mix(mix(outLitAlb, concreteLit, paveC), asphaltLit, paveA);
  outLitAlb = mix(outLitAlb, vec3(0.012, 0.042, 0.056), waterMix);
  amb = mix(amb, 1.0, waterMix);
  sheen = mix(sheen, 0.0, waterMix);
  gl_FragColor = vec4(sqrt(clamp(outLitAlb, 0.0, 1.0)), litOut);
  pc_fragColor1 = lit2Encode(amb, sheen, fill, 1.0 - cloudT);
  vec4 distOut = terrainDistEncode(vSlantM / 1000.0);
  if (waterMix > 0.5) distOut.b = 1.0;
  pc_fragColor2 = distOut;
  return;
#endif

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
  vec3 directFlat = (uSunRadiance * sunUp + uMoonRadiance * moonUp) / 3.14159265;
  vec3 skyIrr = max(vec3(0.0), uSurfaceIrr - directFlat);
  vec3 directLit = (uSunRadiance * ndl + uMoonRadiance * ndlMoon) / 3.14159265;
  vec3 col = alb * (skyIrr + directLit);
  if (waterMix > 0.01) {
    vec3 wV = normalize(vViewDir);
    float fres = 0.02 + 0.98 * pow(1.0 - clamp(abs(wV.y), 0.0, 1.0), 5.0);
    vec3 wBody = vec3(0.012, 0.042, 0.056) * uSurfaceIrr;
    vec3 wRefl = uHazeRadiance * fres;
    col = mix(col, wBody + wRefl, waterMix);
  }

  // ── 달빛 반사광 (Moon Specular Sheen) ──────────────────────────────────
  // 달을 향한 사면 및 젖은 모래/암반의 스펙큘러 하이라이트
  if (moonUp > 0.0 && length(uMoonRadiance) > 1e-4) {
    vec3 V = -normalize(vViewDir);
    vec3 H = normalize(V + moon);
    float ndh = max(0.0, dot(n, H));
    float specPower = mix(16.0, 48.0, wet + 0.5 * smoothstep(0.15, 0.5, slope));
    float spec = pow(ndh, specPower) * (1.0 - moonShade) * cloudShadowAt(vGround);
    float f0 = mix(0.04, 0.15, wet);
    col += uMoonRadiance * spec * f0 * 1.5;
  }

  // ── 지역 빛지도 기반 야간 지형 스카이글로우 간접 반사 ──────────────────
  if (uCityTerrainGain > 1e-5) {
    float cSlope = 0.12 + 0.88 * max(0.0, dot(normalize(vec2(n.x, n.z) + vec2(1e-5)), normalize(uCityDirXZ + vec2(1e-5))));
    col += alb * vec3(1.00, 0.787, 0.573) * (uCityTerrainGain * cSlope * (0.40 + 0.60 * clamp(n.y, 0.0, 1.0)));
  }

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
  if (uDiagRaw > 0.5) gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
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
export const SUN_SHADOW_BAKE_VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
export const SUN_SHADOW_BAKE_FRAG = /* glsl */ `
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
    float z = h - eye - t * t / (2.0 * ${EARTH_RADIUS_EFFECTIVE_M_GLSL});
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

// 256×256 산 그림자 사전 굽기(해: R, 달: G) — dem_uv 좌표계로 굽고, uBakedShadeTex 는 선언하지 않아 되먹임을 피합니다.
export const SHADE_MAP_SIZE = 256;
export const TERRAIN_SHADE_BAKE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
export const TERRAIN_SHADE_BAKE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
${DEM_GLSL}
${demGlsl('demFar')}
${TERRAIN_HORIZON_GLSL}
uniform float uShadow;
uniform float uSunAzRad;
uniform float uSunAltRad;
uniform float uMoonAzRad;
uniform float uMoonAltRad;
uniform vec3  uMoonRadiance;

vec2 encodeHz(float hz) {
  return vec2(
    clamp((hz + 0.10) / 0.60, 0.0, 1.0),
    clamp((hz - 0.50) / 0.60, 0.0, 1.0)
  );
}

void main() {
  if (uShadow < 0.5 || uDemValid < 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec2 g0 = (vUv * uDemBlock - uDemObs) * uDemSpanM;
  float h0 = dem_elevationAt(g0);
  vec2 sunDir2D = vec2(sin(uSunAzRad), -cos(uSunAzRad));
  float hzSun = terrainHorizonAngle(g0, h0, sunDir2D);
  float hzMoon = -0.10;
  if (uMoonAltRad > 0.0 && length(uMoonRadiance) > 1e-4) {
    vec2 moonDir2D = vec2(sin(uMoonAzRad), -cos(uMoonAzRad));
    hzMoon = terrainHorizonAngle(g0, h0, moonDir2D);
  }
  gl_FragColor = vec4(encodeHz(hzSun), encodeHz(hzMoon));
}
`;

/**
 * §129 볼륨 하늘에서 지형 빛 판이 쓰는 알베도(선형). takram 의 물리 조명(해·하늘 조도 × 같은 노출 · ACES)을 받으므로
 * 이전 대기 모형의 표시 곡선에 맞춘 값(흙 0.22, 0.17, 0.13)이 아니라 실제 땅의 가시광 알베도여야 합니다 —
 * tools/genus-ruler/genus/RULER-terrain-lit.md(Commons 사진 260장의 땅/하늘 밝기·색) 2회차 A4 — 두 낮 장면 땅/하늘 0.52·0.32
 * (사진 사분위 0.10~0.53), G/R 1.06, B/R 0.74. 이전 값은 낮 땅이 하늘의 1.8배로 마른 흙처럼 빛났습니다. 하네스가 고르려고 바꿀 수 있게 객체로 둡니다.
 */
