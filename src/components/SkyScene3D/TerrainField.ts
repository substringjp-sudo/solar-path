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
import {
  EARTH_RADIUS_M, FIELD_NEAR_M, FIELD_FAR_M,
  GROUND_PROJECT_GLSL, createConcentricGeometry, ringDistanceM, ringRadius,
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
${GROUND_PROJECT_GLSL}
uniform float uObsElevM;    // DEM 이 없을 때만 쓰는 발밑 고도 (m)
uniform float uEyeHeightM;  // 발밑에서 눈까지 (m)
varying float vDistM;
varying float vElevM;
varying vec3  vNormal;
varying vec2  vGround;   // 지상 좌표 (동, 남) m — 그림자 레이마치가 씁니다

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

/** 그 지상 좌표의 고도 (m). 자료가 없으면 발밑 높이로 평평하게. */
float fieldElev(vec2 g) {
  return uDemValid > 0.5 ? dem_elevationDespiked(g) : uObsElevM;
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

  vec3 p = gp_project(g, h, groundAtEye() + uEyeHeightM, r);

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
export const FIELD_FRAG = /* glsl */ `
precision highp float;
${ATMOSPHERE_GLSL}
${GROUND_DISPLAY_GLSL}
${DEM_GLSL}
${CLOUD_SHADOW_GLSL}
uniform vec3  uSurfaceIrr;    // 수평면이 받는 조도 (하늘 + 직달)
uniform vec3  uSunRadiance;
uniform float uSunAzRad;
uniform float uSunAltRad;
uniform float uSunAltDeg;
uniform vec3  uAlbedo;
uniform float uExposure;
uniform float uSaturation;
uniform vec3  uHazeRadiance;  // 지평선 부근 하늘빛 (선형) — 공기원근의 끝값
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
  float t = max(6.0, uDemSpanM / 256.0);
  for (int i = 0; i < 36; i++) {
    vec2 g = g0 + sunHoriz * t;
    if (dem_inside(g) < 0.5) break;
    float h = dem_elevationAt(g);
    best = max(best, atan(h - h0, t));
    t *= 1.2;
  }
  return best;
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
  if (uDemValid > 0.5 && vElevM <= 0.0) discard;

  vec3 n = normalize(vNormal);
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
  // 하늘 몫은 등방이라 각도가 없고, 직달 몫만 방향을 탑니다.
  vec3 col = alb * (uSurfaceIrr + uSunRadiance * ndl);

  // ── 공기원근 ─────────────────────────────────────────────────────────────
  if (uAerial > 0.5) {
    vec3 T = atm_aerialTransmittance(vDistM / 1000.0, 0.0,
                                     uBeta, uAngstrom, uElevScale);
    col = col * T + uHazeRadiance * (1.0 - T);
  }

  gl_FragColor = vec4(atm_display_ground(col * uExposure, uSaturation, uSunAltDeg), 1.0);
}
`;

export interface TerrainFieldHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** DEM 패치를 갈아 끼웁니다. `null` 이면 평평하게 물러납니다. */
  /** 둘째 인자는 **발밑 고도용** 패치입니다. 안 주면 그대로 둡니다. */
  setPatch: (patch: DemPatch | null, eyePatch?: DemPatch | null) => void;
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
}): TerrainFieldHandle {
  const alb = opts.albedo ?? { r: 0.22, g: 0.17, b: 0.13 };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...makeDemUniforms(opts.patch ?? null),
      ...makeDemUniforms(opts.eyePatch ?? null, 'demEye'),
      uObsElevM: { value: opts.observerElevM ?? 0 },
      uEyeHeightM: { value: opts.eyeHeightM ?? 1.6 },
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

  return {
    mesh,
    material,
    setPatch: (patch, eyePatch) => {
      const put = (u: Record<string, { value: unknown }>) => {
        Object.entries(u).forEach(([k, v]) => {
          if (material.uniforms[k]) material.uniforms[k].value = v.value;
        });
      };
      // ⚠ makeDemUniforms 는 uDemDespike 를 0 으로 되돌립니다 — 격자가
      // 만들어질 때 정한 값을 지키려고 여기서 다시 씌웁니다.
      const despike = material.uniforms.uDemDespike?.value;
      put(makeDemUniforms(patch));
      if (material.uniforms.uDemDespike) material.uniforms.uDemDespike.value = despike;
      if (eyePatch !== undefined) put(makeDemUniforms(eyePatch, 'demEye'));
    },
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
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
  handle.mesh.position.set(camera.position.x, 0, camera.position.z);
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
