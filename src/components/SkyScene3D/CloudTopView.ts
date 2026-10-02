/**
 * CloudTopView.ts — **3D 하늘이 그리는 구름을 위에서 본 한 장** (§120 B).
 *
 * 지구본 위 "시뮬레이션 보기" 층입니다. 레이더 칸(§120 A)은 자료가 아는 만큼만
 * 칠하고, 이 층은 하늘 탭이 **실제로 그리는 구름장**을 내려다봅니다.
 *
 * ## 무엇이 같고 무엇이 다른가
 *
 * 같은 것 — 하늘 탭과 **따로 짜지 않습니다**:
 *  - 예보 보간: `getInterpolatedWeather` → `WeatherFan` (하늘 타임라인과 같은 길).
 *  - 구름 모양: 슬랩 셰이더의 `slab_layer_thickness`·잡음·상수(`CLOUD_SLAB_GLSL`,
 *    `substituteSlabConstants`). 군집 항도 슬랩과 같은 식입니다.
 *  - 바람 이류: 같은 층별 바람(`resolveLayerWinds`), 같은 `driftHours`(UTC 하루 경과 시간).
 *  - 운량장 굽기: 같은 제곱근 사상(`bakeCoverageData`).
 *
 * 다른 것 — 시선이 위에서 아래로 곧게 내려옵니다:
 *  - ⚠ **운량장에 하늘 쪽의 방향 잡음을 안 섞습니다.** 하늘 탭은 `buildSkyColumns` 가
 *    방위 × 고도 격자의 표본마다 잡음을 한 번 더 섞어 U자 분포(맑거나 덮이거나)를
 *    만듭니다. 올려다볼 때는 방향마다 값이 하나라 그게 맞지만, 그 표본은 멀어질수록
 *    방위 간격이 수십 km 로 벌어져 **위에서 보면 관측점에서 뻗는 방사형 줄**로
 *    드러났습니다(처음 판에서 잰 그림). 그래서 운량장은 예보 보간 그대로 굽고,
 *    구름의 생김새는 셰이더의 지상 좌표 모양장에 맡깁니다.
 *  - 발자국(화소 하나가 덮는 땅)이 화면 크기에서 옵니다. 192화소로 720km 면 3.75km 라
 *    저층(셀 2km)의 잔무늬는 슬랩의 같은 규칙(`det`)으로 녹고 굵은 장만 남습니다.
 *    하늘에서 먼 저층이 뭉개지는 것과 **같은 이유, 같은 식**입니다.
 *  - 빛: 위에서 본 구름 윗면은 대체로 희므로 조명은 셈하지 않습니다. 층마다 옅은 색만
 *    다르게 두고, 불투명도는 연직 광학두께(두께 × 층 광학 배율)에서 냅니다.
 *
 * ## ⚠ 이 그림이 아는 것
 *
 * 예보 격자는 약 25km, 둘레 고리의 바깥 간격은 180km 남짓입니다. 그보다 잔 무늬는
 * **하늘 탭이 그리는 모양 그대로의 지어낸 무늬**입니다. 화면에 "시뮬레이션" 이라고
 * 적어 두는 까닭입니다.
 */
import * as THREE from 'three';
import {
  CLOUD_SLAB_GLSL, substituteSlabConstants, IDENTITY_COVER_REMAP, bakeCoverageData, coverageFromSamples, SLAB_TEX, SLAB_RANGE_KM,
} from './CloudSlab';
import { makeTuningUniforms } from '../../utils/atmosphere';
import {
  resolveLayerWinds, WeatherFan, LAYER_ALTITUDE_KM, buildSkyColumns,
  PLACEHOLDER_WIND_SPEED_KMH, PLACEHOLDER_WIND_BEARING_DEG,
} from '../../utils/skyColumn';
import { getInterpolatedWeather, type CloudPathData, type LayerWinds } from '../../utils/weather';

/** 한 변 화소. 720km 를 192칸 — 3.75km/px, 예보 격자(25km)보다 일곱 배 촘촘합니다. */
export const TOP_VIEW_SIZE = 192;

export interface TopViewInput {
  /** 운량장 자료(RGBA: 저·중·상·확신도). `bakeCoverageData` 로 구운 것. */
  cover: Uint8Array;
  genus: Uint8Array;
  winds: LayerWinds;
  driftHours: number;
  /** 층 높이(km, 저·중·상) — 권운 줄무늬의 시어가 씁니다. */
  layerAltKm: [number, number, number];
}

/**
 * 고리 자료와 시각에서 하늘 탭과 같은 운량장을 만듭니다. 순수 함수라 GL 없이 부릅니다.
 * 자료가 모자라면 null.
 */
export function buildTopViewInput(
  ring: CloudPathData[] | null | undefined,
  timeMs: number,
  /** 'skyColumns' 는 판정의 **대조**용 — 하늘 탭의 방향 잡음 운량장(방사형 줄이 나던 것). */
  opts: { coverage?: 'forecast' | 'skyColumns' } = {},
): TopViewInput | null {
  if (!ring || ring.length < 2) return null;
  const weather = getInterpolatedWeather(ring, new Date(timeMs));
  const obs = weather.find(w => (w.distance ?? 0) === 0) ?? weather[0];
  const fan = new WeatherFan(weather as any, 0);
  if (!fan.hasData) return null;
  const winds = resolveLayerWinds(obs).winds;
  const driftHours = ((timeMs / 60000) % 1440) / 60;
  const cover = new Uint8Array(SLAB_TEX * SLAB_TEX * 4);
  const genus = new Uint8Array(SLAB_TEX * SLAB_TEX * 4);
  if (opts.coverage === 'skyColumns') {
    const samples = buildSkyColumns({
      fan, driftMinutes: driftHours * 60,
      windSpeedKmh: PLACEHOLDER_WIND_SPEED_KMH, windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
      layerWinds: winds,
    });
    bakeCoverageData(cover, genus, SLAB_TEX, SLAB_RANGE_KM, coverageFromSamples(samples as any));
  } else
  // 예보 보간 그대로 — 위 머리말의 "방향 잡음을 안 섞는" 까닭.
  bakeCoverageData(cover, genus, SLAB_TEX, SLAB_RANGE_KM, (az, d) => {
    const { data, confidence } = fan.sample(az, d);
    if (!data) return { low: 0, mid: 0, high: 0, confidence: 0 };
    return { low: (data.low ?? 0) / 100, mid: (data.mid ?? 0) / 100, high: (data.high ?? 0) / 100, confidence };
  });
  // 층 높이는 하늘 탭이 예보 단면이 없을 때 쓰는 기본값입니다(권운 줄무늬의 시어만 씁니다).
  return { cover, genus, winds, driftHours,
    layerAltKm: [LAYER_ALTITUDE_KM.low, LAYER_ALTITUDE_KM.mid, LAYER_ALTITUDE_KM.high] };
}

const VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uCoverTex;
uniform float uRangeKm;
uniform float uDriftHours;
uniform float uPixelKm;
uniform float uClusterAmt, uClusterMul;
uniform float uMesoMode;
uniform vec3  uMesoMean, uMesoSig;   // x 저 · y 중 · z 상
${CLOUD_SLAB_GLSL}
// ── 위에서 본 덩어리(§120.10) ────────────────────────────────────────────────
// 하늘의 셀(저 2 · 중 4.2 · 상 9km)은 올려다볼 때 구름 한 송이 크기라, 720km 원반에서는 잔
// 점이 됩니다(사용자: "입자가 너무 잘고 구름 레이더와 비슷하지가 않아"). 위성·레이더 그림의
// 구름은 수십 km 덩어리로 뭉쳐 있으므로, 위에서 볼 때는 **덩어리 규모의 모양장**으로 면적을
// 가르고 하늘 셀 크기의 잡음은 덩어리 안의 결로만 씁니다. 면적은 여전히 운량을 따릅니다(백분위
// 문턱, 아래 uMesoMean/uMesoSig 를 판정이 역산).
float top_meso(int L, vec2 kmN, float cover, vec2 windNorm, float cellKm, float seed, float det){
  float cellM = L == 0 ? 55.0 : (L == 1 ? 40.0 : 30.0);
  vec2 p = kmN / cellM;
  // 상층은 바람 축으로 2:1 — 권운이 줄지어 늘어서는 결.
  if (L == 0) p = vec2(dot(p, windNorm) * 0.5, dot(p, vec2(-windNorm.y, windNorm.x)));
  // 좌표를 잡음으로 한 번 휩니다(domain warp). 값 잡음은 등고선이 마름모로 각지는데, 휘면
  // 위성 사진의 구름처럼 굽고 말린 윤곽이 됩니다.
  vec2 w = vec2(slab_fbm(p * 0.5 + 13.1, 2), slab_fbm(p * 0.5 + 47.7, 2)) - 0.5;
  p += w * 1.6;
  // 3옥타브 — 가장 잔 결이 셀의 1/4(저층 7.5km)이라 화소(3.75km)에서 부서지지 않습니다.
  float f = slab_fbm(p + seed * 3.1, 3);
  float mu = L == 0 ? uMesoMean.z : (L == 1 ? uMesoMean.y : uMesoMean.x);
  float sg = L == 0 ? uMesoSig.z : (L == 1 ? uMesoSig.y : uMesoSig.x);
  float q = 1.0 / (1.0 + exp(-1.702 * (f - mu) / max(0.02, sg)));
  float t = clamp((q - (1.0 - cover)) / max(0.05, cover), 0.0, 1.0);
  // 가장자리는 부드럽게, 속은 짙게 — 레이더 그림의 덩어리처럼.
  float dens = smoothstep(0.0, 0.8, t);
  dens = mix(dens, 1.0, smoothstep(0.90, 1.0, cover));
  // 덩어리 안의 결 — 하늘과 같은 셀 크기의 잡음(평균 1 근처, 진폭 작게). 하늘과 같은 발자국
  // 규칙(det)으로 화소보다 잔 결은 끕니다 — 저층(셀 2km)은 3.75km 화소에서 각진 얼룩이 됐습니다.
  float fine = mix(0.5, slab_fbm(kmN / cellKm + seed + 5.1, 2), det);
  float depth = L == 0 ? 1.4 : (L == 1 ? 3.5 : 5.0);
  return dens * depth * (0.88 + 0.24 * fine);
}
void main(){
  // vUv.y = 0 이 **북**입니다 — readPixels 첫 줄이 그림의 맨 윗줄이 되게.
  vec2 q = vec2(vUv.x * 2.0 - 1.0, 1.0 - vUv.y * 2.0);
  // 슬랩 좌표: x = 동, y(= 월드 z) = 남.
  vec2 km = vec2(q.x, -q.y) * uRangeKm;
  if (length(km) > uRangeKm) { gl_FragColor = vec4(0.0); return; }
  vec4 cv = texture2D(uCoverTex, slab_coverUv(km, uRangeKm));
  float conf = cv.a;
  float trans = 1.0;
  vec3 col = vec3(0.0);
  // 위에서 보므로 상층부터 덮습니다.
  for (int L = 0; L < 3; L++){
    float cover = L == 0 ? cv.b : (L == 1 ? cv.g : cv.r);
    if (cover < 0.005) continue;
    float cellKm = L == 0 ? CELL_HIGH : (L == 1 ? CELL_MID : CELL_LOW);
    float tauK   = L == 0 ? TAUK_HIGH : (L == 1 ? TAUK_MID : TAUK_LOW);
    float seed   = float(L) * 31.7;
    vec2  wind   = L == 0 ? uWindHigh : (L == 1 ? uWindMid : uWindLow);
    vec2  windNorm = length(wind) > 1e-3 ? normalize(wind) : vec2(1.0, 0.0);
    vec2  kmN = km + wind * uDriftHours;
    // 슬랩과 같은 발자국 규칙 — 해상 못 하는 잔무늬는 녹입니다.
    float det = 1.0 - smoothstep(0.45, 2.0, uPixelKm / cellKm);
    float detCoarse = 1.0 - smoothstep(3.0, 9.0, uPixelKm / cellKm);
    float billowAmt = det * (1.0 - smoothstep(0.4, 2.0, length(km) / cellKm));
    float cluster = mix(1.0,
      0.55 + 0.9 * slab_fbm(kmN / max(1e-3, cellKm * uClusterMul) + 71.3, 3),
      uClusterAmt);
    float thick, tau;
    if (uMesoMode > 0.5) {
      tau = top_meso(L, kmN, cover, windNorm, cellKm, seed, det);
      thick = tau / tauK;
    } else {
      thick = slab_layer_thickness(L, kmN, cover, cellKm, conf, seed, windNorm, det, detCoarse, billowAmt, cluster);
      tau = thick * tauK;
    }
    if (tau <= 0.0) continue;
    float a = 1.0 - exp(-tau);
    // 층마다 색을 달리했더니 조각보처럼 보였습니다. 흰 구름 하나로, 농담은 불투명도가 냅니다
    // (상층만 아주 옅게 푸른 기 — 얇은 권운).
    vec3 c = L == 0 ? vec3(0.93, 0.96, 1.00) : vec3(1.0);
    c *= 0.90 + 0.10 * smoothstep(0.3, 3.0, tau);
    col += trans * a * c;
    trans *= 1.0 - a;
  }
  float alpha = 1.0 - trans;
  gl_FragColor = alpha > 1e-4 ? vec4(col / alpha, alpha) : vec4(0.0);
}
`;

export interface CloudTopViewHandle {
  /** 그 입력으로 한 장을 그리고 RGBA(맨 윗줄이 북)를 돌려줍니다. */
  render(renderer: THREE.WebGLRenderer, input: TopViewInput): Uint8Array;
  dispose(): void;
  size: number;
  rangeKm: number;
}

/**
 * 위에서 본 그림의 **면적 문턱 유효값**(층별 모양장 중심·폭 비율).
 *
 * 슬랩의 `SHAPE_MEAN`·`SHAPE_SIG_RATIO` 는 "예보 운량 = 화면 면적" 이 되게 **올려다본
 * 하늘(고도 45°)** 에서 역산한 유효값입니다 — 비스듬한 시선, 층마다 1~3 겹의 수직 걸음,
 * 발자국이 거기 다 묻혀 있습니다. 위에서 곧게 내려다보면 그 셋이 달라 그대로 쓰면
 * 면적이 어긋났습니다(잰 값: 저층 0.74 → 0.50, 중층 0.24 → 0.55).
 *
 * 그래서 **모양장(잡음·자리)은 그대로** 두고, 면적을 운량에 맞추는 문턱만 같은 방법
 * (build-cloud-top-view 의 역산)으로 위에서 본 눈금에 다시 잽니다. 구름은 같은 자리에
 * 있고, 얼마나 덮는지만 예보를 따릅니다.
 */
//
// 역산(τ ≥ 0.16 면적, 반경 150km, 예보 20~65%)을 되풀이해 수렴시킨 값입니다. 하늘 쪽 값에서
// 시작하면 저층 −0.24, 중층 +0.34 까지 어긋났습니다. 2×2 평균(아래 SS)을 넣자 다시 +0.20 까지
// 벌어져(판정이 잡음) 한 번 더 역산했고, 네 번째에 모두 0.02 안입니다.
//   층     하늘(45°)        위에서
//   저층   0.597 · 0.654    0.539 · 1.103   ← 잔무늬가 녹아(det 0) 굵은 장만 남음
//   중층   0.377 · 0.652    0.544 · 0.721   ← 수직 두 걸음·비스듬한 시선이 빠짐
//   상층   0.515 · 0.986    0.527 · 0.936
// ⚠ 이 값은 화소 크기(TOP_VIEW_SIZE · SLAB_RANGE_KM), 2×2 평균, 운량장 굽는 법(예보 보간
//   그대로)에 묶입니다. 하나라도 바꾸면 build-cloud-top-view 로 다시 잽니다.
export const TOP_VIEW_SHAPE_MEAN: Record<'low' | 'mid' | 'high', number> = { low: 0.5391, mid: 0.5443, high: 0.5274 };
export const TOP_VIEW_SHAPE_SIG_RATIO: Record<'low' | 'mid' | 'high', number> = { low: 1.1032, mid: 0.7213, high: 0.9361 };
/**
 * 덩어리 모양장(§120.10)의 면적 문턱 — 중심·폭. 판정(build-cloud-top-view)이 역산합니다.
 * fbm 명목값(0.5 · 0.1)에서 시작해 예보와 면적이 0.03 안으로 수렴했습니다(첫 판에서 상층
 * −0.33 까지 어긋남). 덩어리 모양(셀·옥타브·가장자리)을 바꾸면 다시 잽니다 — 첫 덩어리 판은
 * 15km 상관이 0.41 로 아직 잘아(판정 5) 셀을 키우고 옥타브를 줄였고, 윤곽이 마름모로 각져
 * 좌표 휨을 넣은 뒤 다시 쟀습니다.
 */
// 2026-10-02 다시 잼: 잡음 해시를 바꿔(CloudSlab slab_hash21 — 예전 해시는 x 50칸 주기) 모양장 통계가 달라져
// 상층 면적이 0.28 까지 어긋났습니다. 같은 역산을 세 번 되풀이해 예보 20~75% 에서 모두 ±0.04 안입니다.
export const TOP_VIEW_MESO_MEAN: Record<'low' | 'mid' | 'high', number> = { low: 0.4708, mid: 0.4776, high: 0.3433 };
export const TOP_VIEW_MESO_SIG: Record<'low' | 'mid' | 'high', number> = { low: 0.1848, mid: 0.1809, high: 0.1127 };
/** 하늘(슬랩)의 값 — 판정의 대조용. */
export const SKY_SHAPE_MEAN = { low: 0.597, mid: 0.377, high: 0.515 };
export const SKY_SHAPE_SIG_RATIO = { low: 0.654, mid: 0.652, high: 0.986 };

export function createCloudTopView(
  size = TOP_VIEW_SIZE,
  opts: {
    shapeMean?: Record<'low' | 'mid' | 'high', number>;
    shapeSigRatio?: Record<'low' | 'mid' | 'high', number>;
    /** 'sky' 는 판정의 대조용 — 하늘 셀 모양장 그대로(잔 점이 나던 것). */
    mode?: 'meso' | 'sky';
    mesoMean?: Record<'low' | 'mid' | 'high', number>;
    mesoSig?: Record<'low' | 'mid' | 'high', number>;
  } = {},
): CloudTopViewHandle {
  const coverTex = new THREE.DataTexture(new Uint8Array(SLAB_TEX * SLAB_TEX * 4), SLAB_TEX, SLAB_TEX, THREE.RGBAFormat);
  coverTex.minFilter = THREE.LinearFilter;
  coverTex.magFilter = THREE.LinearFilter;
  const tuning = makeTuningUniforms();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...tuning,
      uCoverTex: { value: coverTex },
      uRangeKm: { value: SLAB_RANGE_KM },
      uDriftHours: { value: 0 },
      uPixelKm: { value: (2 * SLAB_RANGE_KM) / size },
      // 슬랩 재질의 기본값과 같게(CloudSlab.createCloudSlab).
      uMesoMode: { value: opts.mode === 'sky' ? 0 : 1 },
      uMesoMean: { value: new THREE.Vector3(
        (opts.mesoMean ?? TOP_VIEW_MESO_MEAN).low, (opts.mesoMean ?? TOP_VIEW_MESO_MEAN).mid, (opts.mesoMean ?? TOP_VIEW_MESO_MEAN).high) },
      uMesoSig: { value: new THREE.Vector3(
        (opts.mesoSig ?? TOP_VIEW_MESO_SIG).low, (opts.mesoSig ?? TOP_VIEW_MESO_SIG).mid, (opts.mesoSig ?? TOP_VIEW_MESO_SIG).high) },
      uClusterAmt: { value: 0.7 },
      uClusterMul: { value: 3.0 },
      uShapeMode: { value: 1 },
      uShapeDepth: { value: 1.2 },
      uShapeEdge: { value: 0.70 },
      uShapeSigma: { value: 0.16 },
      uFbmRot: { value: 1 },
      uLayerAltKm: { value: new THREE.Vector3(1.5, 4.5, 9.0) },
      uWindLow: { value: new THREE.Vector2() },
      uWindMid: { value: new THREE.Vector2() },
      uWindHigh: { value: new THREE.Vector2() },
      uObserverAltKm: { value: 0 },
      uLowDeckKm: { value: new THREE.Vector2(-1, -1) },
    },
    vertexShader: VERT,
    fragmentShader: substituteSlabConstants(FRAG, {
      shapeMean: opts.shapeMean ?? TOP_VIEW_SHAPE_MEAN,
      shapeSigRatio: opts.shapeSigRatio ?? TOP_VIEW_SHAPE_SIG_RATIO,
      // 위에서 본 면적은 자기 눈금(TOP_VIEW_SHAPE_*)으로 맞췄습니다 — 하늘 시야용 역표는 쓰지 않습니다.
      coverRemap: IDENTITY_COVER_REMAP,
    }),
    depthTest: false, depthWrite: false, transparent: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // ⚠ 두 배로 그려 2×2 평균으로 줄입니다. 발자국 규칙(det)은 **내놓는 화소**(3.75km) 기준인데,
  //   중층(셀 4.2km)은 그 크기에서 잔 옥타브가 아직 반쯤 살아 있어 한 화소에 한 표본이면
  //   자글자글한 점(앨리어싱)으로 나왔습니다. 하늘도 같은 규칙이지만 거기선 화소가 훨씬 잘아
  //   드러나지 않습니다.
  const SS = 2;
  const big = size * SS;
  const target = new THREE.WebGLRenderTarget(big, big, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, generateMipmaps: false,
  });
  const raw = new Uint8Array(big * big * 4);
  const out = new Uint8Array(size * size * 4);
  const u = material.uniforms;
  // 방위 → 슬랩 좌표(X=동, Z=남). 미는 방향은 **불어오는 쪽**(CloudSlab.updateCloudSlab 과 같음).
  const setWind = (v: THREE.Vector2, w: { speedKmh: number; bearingDeg: number }) => {
    const rad = (w.bearingDeg * Math.PI) / 180;
    v.set(w.speedKmh * Math.sin(rad), -w.speedKmh * Math.cos(rad));
  };

  return {
    size,
    rangeKm: SLAB_RANGE_KM,
    render(renderer, input) {
      (coverTex.image.data as Uint8Array).set(input.cover);
      coverTex.needsUpdate = true;
      setWind(u.uWindLow.value, input.winds.low);
      setWind(u.uWindMid.value, input.winds.mid);
      setWind(u.uWindHigh.value, input.winds.high);
      u.uDriftHours.value = input.driftHours;
      (u.uLayerAltKm.value as THREE.Vector3).set(...input.layerAltKm);
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(target, 0, 0, big, big, raw);
      renderer.setRenderTarget(prev);
      // 2×2 평균 — 알파를 곱한 색으로 섞고 다시 나눕니다(곧은 알파 PNG 로 내보냄).
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
          const k = ((y * SS + dy) * big + (x * SS + dx)) * 4;
          const al = raw[k + 3];
          r += raw[k] * al; g += raw[k + 1] * al; b += raw[k + 2] * al; a += al;
        }
        const o = (y * size + x) * 4;
        out[o] = a > 0 ? Math.round(r / a) : 0;
        out[o + 1] = a > 0 ? Math.round(g / a) : 0;
        out[o + 2] = a > 0 ? Math.round(b / a) : 0;
        out[o + 3] = Math.round(a / (SS * SS));
      }
      return out;
    },
    dispose() {
      target.dispose();
      material.dispose();
      quad.geometry.dispose();
      coverTex.dispose();
    },
  };
}
