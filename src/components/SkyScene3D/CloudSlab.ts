/**
 * 구름 — **껍질이 아니라 슬랩**. 전체화면 패스 하나로 그립니다.
 *
 * `docs/SKY_REBUILD_PLAN.md` 가 대체하려는 것이 `CloudDeck.ts`(구면 껍질 +
 * 극좌표 격자)와 `CloudField.ts`(빌보드)입니다. 하늘돔·별·태양·지형·달은
 * 그대로 두고 **구름 표현만** 바꿉니다.
 *
 * ## 왜 이 구조인가
 *
 * 화면 픽셀 → 방향 → 지상거리 → 월드 (x, z). 그게 전부입니다.
 * 덱 기하도 정점 보간도 (방위, 고도) 격자도 없습니다. 그래서:
 *
 *  - **천정 특이점이 없습니다.** 극좌표가 없으므로 극도 없습니다.
 *    지상거리 투영은 천정에서 선형으로 0에 수렴합니다 (d/Δ = 고도).
 *  - **지평선 타일 격자가 없습니다.** 노이즈를 월드 좌표로 읽으므로
 *    반복 주기가 화면 주파수로 올라오지 않습니다.
 *  - **구름에 두께가 있습니다.** 알파가 `1 - exp(-τ)` 에서 나오므로
 *    가장자리는 저절로 얇고, 얇으면 빛이 투과해 빛납니다.
 *
 * ## 문턱을 쓰지 않는 것이 핵심입니다
 *
 * 예전 덱은 셀 값을 문턱으로 **잘라** 알파를 만들었습니다. 그러면 두께가
 * 0 아니면 1이라, 노을에서 사람들이 보는 것 — 가장자리가 핑크로 빛나는
 * 구름, 그늘져 실루엣이 된 구름 — 이 원리적으로 생기지 않습니다.
 * 재보니 주변광이 구름 밝기의 88~99%를 차지했고 출력 채도가 0.04~0.12
 * 였습니다 (계획 4절).
 *
 * 두께로 읽으면 그 셋이 한 번에 나옵니다. 프로토타입에서 같은 조건의
 * 채도가 0.12 → 0.66 이었습니다.
 *
 * ## 운량장은 지상 2D 텍스처입니다
 *
 * 예보를 (방위, 고도) 격자가 아니라 **지상 평면**에 굽습니다. 그러면
 * 운량과 노이즈가 같은 투영을 지나는 같은 종류의 함수가 됩니다.
 *
 * ⚠ 반지름 방향을 **제곱근으로** 굽습니다. 선형이면 ±360km를 128텍셀로
 * 나눠 5.6km/텍셀이 되는데, 정작 위쪽 하늘을 만드는 2~12km 근방이 두어
 * 텍셀밖에 못 받습니다. 제곱근이면 중심 근처가 1km/텍셀, 가장자리가
 * 11km/텍셀 — 예보 모델 격자(2~11km)와 그대로 맞습니다.
 */
import * as THREE from 'three';
import { beamGrazing } from '../../utils/grazingRay';
import {
  makeTuningUniforms, moonLight, beamAtAltitude, hemiSkyRadiance, NIGHT_SKY, SOLAR_BEAM_SCALE, type AtmosphereParams,
} from '../../utils/atmosphere';
import { LAYER_ALTITUDE_KM, type LayerKey } from '../../utils/skyColumn';
import type { LayerWinds } from '../../utils/weather';
import type { RGB } from '../../utils/sunsetPhysics';
import { lowLayerGenus } from '../../utils/cloudPresets';
import { LAYER_BAND_KM } from '../../utils/cloudProfile';
// ⚠ 지평선은 **지면과 같은 함수**로 구합니다. 식을 복사해 두면 한쪽만
// 바뀌었을 때 그 차이가 그대로 하늘이 비치는 띠가 됩니다.
import { seaHorizonDipDeg } from './TerrainRing';
import { makeDemUniforms, type DemPatch } from '../../utils/demTiles';

/** 운량장이 덮는 반경 (km). 상층 지평선(357km)을 담습니다. */
export const SLAB_RANGE_KM = 360;
/** §105 직달 표: 해 고도 ±BEAM_LUT_SPAN° 를 BEAM_LUT_N 칸에. 360km 끝에서 ±3.2° 이므로 넉넉히 4°. */
/**
 * 직달 투과율 → 이 셰이더의 직달 항(§104·§106). 하늘빛이 **복사휘도**(조도/π)로 들어오므로
 * 직달도 조도/π 로 맞춥니다: SOLAR_BEAM_SCALE(투과율 → 하늘 눈금의 조도) ÷ π.
 * ⚠ 처음(§104)엔 π 를 빠뜨려 직달이 π 배 셌습니다 — 노을에 해 받은 구름이 레몬색으로 포화했습니다
 *   (사진 대조 원색 화소 13% 대 사진 0.9%). 지면(TerrainRing)은 처음부터 sin/π 로 맞춰 왔습니다.
 */
const BEAM_TO_SLAB = SOLAR_BEAM_SCALE / Math.PI;
/** 운량장 텍스처 한 변. 제곱근 사상이라 중심 근처가 촘촘합니다. */
export const SLAB_TEX = 128;

/** 층별 노이즈 셀 크기 (km) — 저층 적운은 덩어리가 크고, 고층 권운은 섬세한 필라멘트. (층간 거리감 부각을 위해 격차를 늘림) */
const CELL_KM: Record<LayerKey, number> = { low: 2.0, mid: 4.2, high: 9.0 };
/** §117 — 지형 거리 판이 없을 때 묶어 두는 흰 1×1(= 지형 없음). */
const NO_TERRAIN_DIST_TEX = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
})();
/** §116 — 관측자 위 층 밑면이 이만큼(km) 안에 있으면 산이 그 구름을 뚫을 수 있다고 봅니다(일본 알프스 3km급 제외). */
const RIDGE_CLOUD_REACH_KM = 2.5;
/** 층별 두께 → 광학두께 배율. 두꺼운 저층일수록 큽니다. */
const TAU_K: Record<LayerKey, number> = { low: 15.0, mid: 8.0, high: 2.8 };

/**
 * 모양장의 **실제** 중심과 폭 — 층마다 다릅니다.
 *
 * 41절의 백분위 문턱은 모양장이 `N(0.5, uShapeSigma)` 라고 **가정**하고
 * `P(q > 1-cover) = cover` 를 항등식으로 만듭니다. 그런데 그 가정이 세
 * 층에 다 맞지는 않습니다. `build-layer-elev.js` 로 예보 운량 → 화면 면적
 * 사상을 재고(광학두께 자료 출구를 써서 조명과 무관하게) 로지스틱-정규
 * 모형으로 역산하면:
 *
 *   층    유효 중심   유효 폭    가정
 *   저층    0.597     0.105     0.5 · 0.16
 *   중층    0.377     0.104     0.5 · 0.16
 *   상층    0.515     0.158     0.5 · 0.16
 *
 * ⚠ 두 번 돌려 수렴시킨 값입니다. 한 번 넣고 다시 재면 사상이 달라지므로
 * (문턱이 바뀌면 표본도 바뀝니다) 그 새 곡선으로 다시 역산했습니다.
 *
 * 그래서 사상이 이렇게 어긋났습니다 (고도 45°, 왼쪽이 예보):
 *
 *   예보    10%    25%    50%    75%    90%
 *   저층   0.140  0.500  0.818  0.942  0.991   ← 과하게 덮음
 *   중층   0.001  0.010  0.125  0.340  0.561   ← 턱없이 모자람
 *   상층   0.095  0.336  0.600  0.759  0.907   ← 대체로 맞음
 *
 * 실기 보고 "하늘이 구름으로 가득 찼는데 너무 텅빈 구름만 있어" 의 정체가
 * 중층 줄입니다 — 그날 아침은 양떼구름(중층) 하늘이었고 예보는 33% 였는데,
 * 위 사상이면 화면에는 3~5% 밖에 안 나옵니다. 같은 보고에서 "고층부 구름은
 * 괜찮아 보인다" 고 한 것도 상층 줄과 맞습니다.
 *
 * ⚠ 이 값들은 모양장의 **참 모멘트가 아니라 유효값**입니다 — 군집(cluster)
 * 처럼 운량을 흔드는 항과 문턱 뒤의 두께 곡선까지 다 이 두 수에 묻혀
 * 들어갑니다. 그래도 고치려는 것이 바로 "예보가 화면 면적이 되는가" 이므로
 * 유효값이 맞는 눈금입니다. 값을 바꾸면 `verify-layer-elev.js` 가 웁니다.
 *
 * ⚠ **위 표는 한 자리(방위 200° · 고도 45° · 흐름 0시)에서 잰 값이었습니다** (2026-10-01 다시 맞춤).
 *   모양장에는 수십 km 규모의 느린 항(굵은 폴백·군집·물결)이 있어, 시야가 덮는 땅 몇 km 는 그 자리 운을
 *   그대로 탑니다. 하늘 전체(방위 8 × 고도 3 × 흐름 시각)로 평균하니 위 값으로는 이랬습니다:
 *
 *     예보    10%    25%    50%    75%    90%
 *     저층   0.054  0.152  0.302  0.471    —     ← 모자람(0.6배)
 *     중층   0.417  0.610  0.752  0.844    —     ← 2.4~4배 과함
 *     상층   0.044  0.147  0.359  0.638    —     ← 모자람
 *
 *   사용자(도코나메 밤, 중층 20%): "구름이 꽤 보이게 그렸는데 … 눈에는 거의 안 보여" — 중층 20% 가 화면
 *   50~90% 구름이 된 것이 이 줄입니다. 예전 보고("양떼구름 33% 인데 텅 빈 하늘")를 그 한 자리에서
 *   고치면서 하늘 평균으로는 반대쪽으로 넘어간 것입니다.
 *
 *   `fit-cover-area-avg.js` 로 짝수 흐름 시각 12 × 방위 0/90/180/270 평균에 맞췄고(두 번 고침), 확인은
 *   맞추기에 안 쓴 홀수 시각 × 방위 45/135/225/315 로 `verify-cover-area-avg.js` 가 합니다.
 *   (처음 두 시각만으로 맞춘 값은 확인에서 저층 25% → 0.51 로 무너졌습니다 — 느린 항의 평균이 안 잡혔습니다.)
 */
const SHAPE_MEAN: Record<LayerKey, number> = { low: 0.5012, mid: 0.4742, high: 0.4181 };
/** 위 폭 ÷ uShapeSigma 기본값(0.16). uShapeSigma 를 바꿔도 비율은 유지됩니다. */
const SHAPE_SIG_RATIO: Record<LayerKey, number> = { low: 0.9446, mid: 1.0569, high: 1.0893 };

/**
 * **예보 운량 → 문턱에 넣는 운량** 역표 (2026-10-02). 마디 `COVER_KNOTS`(예보) 마다 넣을 값, 사이는 직선.
 *
 * 위 두 수(중심·폭)는 곡선 모양을 못 바꿉니다 — 맞춘 뒤에도 하늘 평균 면적이 가운데서 불룩했습니다
 * (중층 예보 50% → 0.615, 70% → 0.814; 저층 90% → 0.908 뒤 95% 에서 밀폐로 1.0 으로 뜀). 그래서 그
 * 곡선 A(c) 를 짝수 흐름 시각 × 방위 8 × 고도 3 의 **하늘 화소**로 재고(`fit-cover-remap.js`) 거꾸로
 * 뒤집어 넣습니다: 넣는 값 R(예보) = A⁻¹(예보). 이 값이 문턱(cvEff)과 흐린 날 밀폐 둘 다에 들어갑니다 —
 * 잰 A 가 그 둘을 다 거친 값이므로.
 *
 * 위에서 본 구름(`CloudTopView`)은 자기 눈금(TOP_VIEW_SHAPE_*)으로 따로 맞췄으므로 항등 표를 씁니다.
 */
export const COVER_KNOTS = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1];
export const IDENTITY_COVER_REMAP: Record<LayerKey, number[]> = { low: COVER_KNOTS, mid: COVER_KNOTS, high: COVER_KNOTS };
// fit-cover-remap.js (자리 96 개 중 짝수 48 — 자리마다 흐름 k 시간 · 바람 방위 250°+k·137.5° — × 방위 4 × 고도 3,
// 하늘 화소) — 맞춘 자리에서 마디 0.1~0.8 이 ±0.005 안, 0.9 는 0.88~0.91. 확인은 verify-cover-area-avg(홀수 48 자리).
// 상층이 가장 많이 깎입니다(예보 50% → 0.38): 고도 20° 쪽 먼 하늘에서 권운이 비스듬히 겹쳐 보여 면적이 늘어납니다.
const COVER_REMAP: Record<LayerKey, number[]> = {
  low:  [0, 0.0839, 0.1317, 0.2291, 0.3358, 0.4424, 0.5443, 0.6414, 0.7344, 0.8231, 0.9055, 0.9077, 1],
  mid:  [0, 0.0896, 0.1335, 0.2185, 0.3088, 0.3985, 0.4868, 0.5782, 0.6782, 0.796, 0.9062, 0.9081, 1],
  high: [0, 0.0638, 0.0977, 0.1651, 0.2351, 0.3082, 0.3817, 0.4689, 0.564, 0.6703, 0.7952, 0.8876, 1],
};

/** 조각 선형 역표를 GLSL 함수로 펼칩니다(배열 색인 없이 — GLSL ES 1.0 에서도 돕니다). */
function coverRemapGlsl(remap: Record<LayerKey, number[]>): string {
  const K = COVER_KNOTS;
  const fn = (name: string, v: number[]) => {
    if (v.length !== K.length) throw new Error(`cover remap ${name}: ${v.length} values for ${K.length} knots`);
    let s = `float ${name}(float c){\n  c = clamp(c, 0.0, 1.0);\n`;
    for (let i = 1; i < K.length; i++) {
      const seg = `mix(${v[i - 1].toFixed(4)}, ${v[i].toFixed(4)}, (c - ${K[i - 1].toFixed(4)}) / ${(K[i] - K[i - 1]).toFixed(4)})`;
      s += i < K.length - 1 ? `  if (c < ${K[i].toFixed(4)}) return ${seg};\n` : `  return ${seg};\n`;
    }
    return s + '}\n';
  };
  return fn('slab_remapLow', remap.low) + fn('slab_remapMid', remap.mid) + fn('slab_remapHigh', remap.high)
    + 'float slab_coverRemap(int layer, float c){ return layer == 0 ? slab_remapHigh(c) : (layer == 1 ? slab_remapMid(c) : slab_remapLow(c)); }\n';
}

/**
 * 셰이더 소스의 층별 상수 자리(CELL_* · TAUK_* · SHAPE_*)를 값으로 바꿉니다. 구름 슬랩과
 * **위에서 본 구름**(§120 `CloudTopView`)이 같은 값을 쓰게 하려고 한 곳에 둡니다 — 둘이 다른
 * 셀 크기를 쓰면 지도와 하늘이 다른 구름을 그립니다.
 */
export function substituteSlabConstants(
  src: string,
  v: {
    cell?: Record<LayerKey, number>; tau?: Record<LayerKey, number>;
    shapeMean?: Record<LayerKey, number>; shapeSigRatio?: Record<LayerKey, number>;
    coverRemap?: Record<LayerKey, number[]>;
  } = {},
): string {
  const cell = v.cell ?? CELL_KM, tau = v.tau ?? TAU_K;
  const shapeMean = v.shapeMean ?? SHAPE_MEAN, shapeSigRatio = v.shapeSigRatio ?? SHAPE_SIG_RATIO;
  return src
    .replace(/SLAB_COVER_REMAP_FNS/g, coverRemapGlsl(v.coverRemap ?? COVER_REMAP))
    .replace(/CELL_LOW/g, cell.low.toFixed(2))
    .replace(/CELL_MID/g, cell.mid.toFixed(2))
    .replace(/CELL_HIGH/g, cell.high.toFixed(2))
    .replace(/TAUK_LOW/g, tau.low.toFixed(2))
    .replace(/TAUK_MID/g, tau.mid.toFixed(2))
    .replace(/TAUK_HIGH/g, tau.high.toFixed(2))
    .replace(/SHAPE_MEAN_LOW/g, shapeMean.low.toFixed(4))
    .replace(/SHAPE_MEAN_MID/g, shapeMean.mid.toFixed(4))
    .replace(/SHAPE_MEAN_HIGH/g, shapeMean.high.toFixed(4))
    .replace(/SHAPE_SIGR_LOW/g, shapeSigRatio.low.toFixed(4))
    .replace(/SHAPE_SIGR_MID/g, shapeSigRatio.mid.toFixed(4))
    .replace(/SHAPE_SIGR_HIGH/g, shapeSigRatio.high.toFixed(4));
}

import {
  BEAM_LUT_N, BEAM_LUT_SPAN, HORIZON_BINS, HORIZON_LO_DEG, HORIZON_SPAN_DEG,
  CLOUD_SLAB_GLSL, SLAB_VERT, HORIZON_BAKE_FRAG, SLAB_FRAG,
} from './CloudSlabShaders';
export { BEAM_LUT_N, BEAM_LUT_SPAN, HORIZON_BINS, CLOUD_SLAB_GLSL };

export interface CloudSlabHandle {
  mesh: THREE.Mesh;
  meshBelow: THREE.Mesh;
  setSplitPasses: (on: boolean) => void;
  material: THREE.ShaderMaterial;
  coverTex: THREE.DataTexture;
  genusTex: THREE.DataTexture;
  rangeKm: number;
  setLayerAltitudesKm: (lowKm: number, midKm: number, highKm: number) => void;
  setLowDeckKm: (baseKm: number | null | undefined, topKm: number | null | undefined) => void;
  setLayerTauScale: (low: number, mid: number, high: number) => void;
  setInCloud: (c: { cover: number; baseKm: number; topKm: number } | null) => void;
  setTerrainDistance: (tex: THREE.Texture | null) => void;
  setDemPatches: (patch: DemPatch | null, farPatch: DemPatch | null, renderer?: THREE.WebGLRenderer) => void;
  setBandHorizon: (
    bandAngles: number[][] | null | undefined, distancesKm: number[] | null | undefined,
    maxVisualDeg: number, seaDipDeg: number,
  ) => void;
  dispose: () => void;
}

export function createCloudSlab(opts: {
  rangeKm?: number;
  texSize?: number;
  cellKm?: Partial<Record<LayerKey, number>>;
  tauK?: Partial<Record<LayerKey, number>>;
  shapeMean?: Partial<Record<LayerKey, number>>;
  shapeSigRatio?: Partial<Record<LayerKey, number>>;
  coverRemap?: Partial<Record<LayerKey, number[]>>;
} = {}): CloudSlabHandle {
  const rangeKm = opts.rangeKm ?? SLAB_RANGE_KM;
  const size = opts.texSize ?? SLAB_TEX;
  const cell = { ...CELL_KM, ...(opts.cellKm ?? {}) };
  const tau = { ...TAU_K, ...(opts.tauK ?? {}) };
  const shapeMean = { ...SHAPE_MEAN, ...(opts.shapeMean ?? {}) };
  const shapeSigRatio = { ...SHAPE_SIG_RATIO, ...(opts.shapeSigRatio ?? {}) };

  const data = new Uint8Array(size * size * 4);
  const coverTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  coverTex.minFilter = THREE.LinearFilter;
  coverTex.magFilter = THREE.LinearFilter;
  coverTex.wrapS = THREE.ClampToEdgeWrapping;
  coverTex.wrapT = THREE.ClampToEdgeWrapping;
  coverTex.needsUpdate = true;

  // coverTex와 같은 크기·같은 sqrt 매핑(slab_coverUv)을 씁니다 — 같은
  // 방향의 조회가 두 텍스처에서 같은 텍셀을 가리켜야 근거리 볼륨의 운량과
  // 운형이 서로 어긋나지 않습니다.
  const genusData = new Uint8Array(size * size * 4);
  const genusTex = new THREE.DataTexture(genusData, size, size, THREE.RGBAFormat);
  genusTex.minFilter = THREE.LinearFilter;
  genusTex.magFilter = THREE.LinearFilter;
  genusTex.wrapS = THREE.ClampToEdgeWrapping;
  genusTex.wrapT = THREE.ClampToEdgeWrapping;
  genusTex.needsUpdate = true;

  // §105 직달 표 — updateCloudSlab 이 해가 움직일 때만 다시 굽습니다.
  const beamLutData = new Uint8Array(BEAM_LUT_N * 3 * 4);
  const beamLut = new THREE.DataTexture(beamLutData, BEAM_LUT_N, 3, THREE.RGBAFormat);
  beamLut.minFilter = THREE.LinearFilter;
  beamLut.magFilter = THREE.LinearFilter;
  beamLut.wrapS = THREE.ClampToEdgeWrapping;
  beamLut.wrapT = THREE.ClampToEdgeWrapping;
  beamLut.needsUpdate = true;

  // ⚠ ALT_* 는 더 이상 치환하지 않습니다 — uLayerAltKm uniform 입니다.
  const coverRemap = { ...COVER_REMAP, ...(opts.coverRemap ?? {}) };
  const frag = substituteSlabConstants(SLAB_FRAG, { cell, tau, shapeMean, shapeSigRatio, coverRemap });

  let horizonTarget: THREE.WebGLRenderTarget | null = null;
  let bandTex: THREE.DataTexture | null = null;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...makeTuningUniforms(),
      uRes: { value: new THREE.Vector2(1, 1) },
      // 샘플러는 늘 묶어 둡니다(안 묶인 sampler2D 는 기기에 따라 경고·검정). 흰 1×1 = "지형 없음".
      uTerrainDist: { value: NO_TERRAIN_DIST_TEX },
      uTerrainDistValid: { value: 0 },
      uInvViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uHorizonSinE: { value: 0 },
      uObserverAltKm: { value: 0 },
      uLowDeckKm: { value: new THREE.Vector2(-1, -1) },
      uTauScale: { value: new THREE.Vector3(1, 1, 1) },
      // §83 지형 가림 — 패치는 setDemPatches 로 받습니다. 없으면 꺼진 것과 같습니다.
      ...makeDemUniforms(null),
      ...makeDemUniforms(null, 'demFar'),
      uTerrainOcclude: { value: 1 },
      uTerrainOccludeSky: { value: 1 },
      uHorizonTex: { value: null },
      uHorizonValid: { value: 0 },
      // §88 — 층 사이의 빛. 켭니다: 에너지 경계를 지키고(verify-two-deck), 앞으로 흩은
      // 햇빛을 릴리프에 방향째 씌운 뒤 사진 대조가 끈 것과 같은 34/37 입니다(§88.5).
      uInterLayer: { value: 1 },
      uBandTex: { value: null },
      uBandValid: { value: 0 },
      uEyeHeightM: { value: 1.6 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunAltDeg: { value: 0 },
      uSunAzDeg: { value: 0 },
      uDispSunAltDeg: { value: 0 },
      uLightGain: { value: 1 },
      uSkyAdd: { value: new THREE.Vector3(0, 0, 0) },
      uFogBeta: { value: 0 },
      uPassMode: { value: 0 },
      uRidgeClouds: { value: 0 },
      uFogBaseKm: { value: -1 },
      uFogTopKm: { value: -1 },
      uFogBeam: { value: new THREE.Vector3(0, 0, 0) },
      uCityLight: { value: 1.0 },
      uBeamLow: { value: new THREE.Vector3(1, 1, 1) },
      uBeamMid: { value: new THREE.Vector3(1, 1, 1) },
      uBeamHigh: { value: new THREE.Vector3(1, 1, 1) },
      uCoverTex: { value: coverTex },
      uBeamLUT: { value: beamLut },
      uBeamLUTGain: { value: 0 },
      uRangeKm: { value: rangeKm },
      uBeta: { value: 0.08 },
      uAngstrom: { value: 1.3 },
      uElevScale: { value: 1 },
      uOzoneDU: { value: 330 },
      uWindLow: { value: new THREE.Vector2() },
      uWindMid: { value: new THREE.Vector2() },
      uWindHigh: { value: new THREE.Vector2() },
      uDriftHours: { value: 0 },
      uPixelAngleRad: { value: 0.001 },
      uAerialScale: { value: 1 },
      uMultiScatter: { value: 1 },
      // 수직 체적 스텝 기본값 1 — 두 지표가 서로 반대로 움직여서 고른 값.
      //
      // 비스듬 경로 항을 넣자 3스텝이 명암폭에서는 앞섰습니다. 지평선
      // 광학두께가 최대 38배로 커지므로 그걸 나눠야 윗면·밑면 구조가
      // 살아나기 때문입니다. 그런데 **세로기울기는 크게 나빠집니다**:
      //
      //   태양 0°   1스텝  명암폭 95.8   세로기울기 0.667
      //             3스텝  명암폭 107.8  세로기울기 0.846
      //
      // 세로기울기는 "지평선쪽만 빛나면서" 를 직접 재는 값이고, 사용자가
      // 처음 감동했다고 꼽은 세 가지 중 첫 번째입니다 (계획 1절). 명암폭
      // 12% 를 얻자고 하늘이 다시 고르게 밝아지는 것은 남는 장사가
      // 아닙니다. 구조는 남겨 뒀으니 되살리려면 이 값만 올리면 됩니다.
      uVolSteps: { value: 1 },
      uCloudDiffThru: { value: 1 },
      uSaturation: { value: 1 },
      uGenusTex: { value: genusTex },
      // 근거리 볼륨 (계획 27·33·35절). **기본은 끔입니다.**
      //
      // ⚠ 켜고 A/B(build-nf-seam-check.js)로 재보니 지평선 바로 위에
      // 회색 얼룩 띠가 생겼습니다 — 노을의 따뜻한 지평선과 위쪽 차가운
      // 구름 사이에 있어야 할 자리가 탁한 회색으로 뭉갭니다. 사용자가
      // "어두운 부분과 밝은 부분의 경계가 이상하다"고 짚은 것이 이것으로
      // 보이고, 회귀(34.4절: sunset-gap·photo-match)도 이 방향입니다.
      // 원인을 아직 못 갈랐습니다(35절) — 갈라질 때까지 예전에 검증된
      // 껍질 그대로 나가는 쪽이 낫습니다. 코드·유니폼은 그대로 두었으니
      // `nfEnabled:true` 로 언제든 다시 켜서 이어 갈 수 있습니다.
      uNfEnable: { value: 0 },
      uNfCapKm: { value: 22 },
      uNfViewSteps: { value: 28 },
      uNfShadowSteps: { value: 5 },
      // ── 구름 밝기의 바닥 셋 (계획 36절) ────────────────────────────
      //
      // 사용자가 실기기에서 "맑은 날인데 구름이 너무 어둡다" 고 짚었고,
      // 같은 순간 QR·사진으로 재니 **구름이 자기가 가린 하늘보다 어두웠습니다**
      // (구름밝기비 0.76~0.95, 1 을 넘어야 정상). 셋 다 구름을 흡수체처럼
      // 다루던 값이라 비흡수 산란체 쪽으로 옮겼습니다.
      //
      // ⚠ **주변광 바닥(amb)은 0.26 그대로 둡니다.** 셋 중 구름을 가장 크게
      // 밝히지만(+0.077), 그늘진 구름까지 같이 들어 올려 노을 실루엣을
      // 지웁니다 — 0.35 로만 올려도 verify-sunset-gap 의 태양 -3° 명암폭이
      // 88.4 로 문턱(90) 아래로 떨어집니다. 반대로 직달 쪽 둘(lit·ph)은
      // 햇빛 받는 면만 밝히므로 빛/그늘 대비가 보존됩니다.
      //
      // 캐노니컬 판정으로 고른 값입니다(내 훑기 습작의 노을 장면이 판정과
      // 달라 한 번 거짓말했습니다 — 36.4절):
      //
      //   구름밝기비 0.814 → 0.895 (화면 48°) · 0.760 → 0.945 (옆 90°)
      //   어두운쪽채도 0.359 → 0.415 (사진 0.44)
      //   노을 명암폭 92.2 → 103.3 (오히려 좋아짐) · 네 단언 모두 통과
      uCloudLitFloor: { value: 0.45 },
      uCloudAmbFloor: { value: 0.26 },
      uCloudPhaseFloor: { value: 0.90 },
      // 40절 — 0 이면 예전 삼항 합, 1 이면 보존산란 2-stream 슬랩 해.
      uCloudModel: { value: 1 },
      uCloudAsym: { value: 0.85 },      // 물방울 비대칭 인자 g (유사변환용)
      uCloudAniso: { value: 0.45 },     // 절단 후 잔여 비등방
      uCloudAnisoW: { value: 0.35 },
      uCloudGroundAlb: { value: 0.15 }, // 지면 알베도 (육지)
      uCloudSideLit: { value: 0.25 },   // 노멀이 못 담는 잔여 직달광
      uCloudFaceUp: { value: 0.65 },    // 높이장 노멀이 과소평가하는 옆면 보정
      // 41절 — 0 이면 예전(면적·두께가 같이 운량에 비례), 1 이면 문턱형.
      uShapeMode: { value: 1 },
      uShapeDepth: { value: 1.2 },      // 구름 한가운데의 광학 두께 배수
      uShapeEdge: { value: 0.70 },      // 가장자리 단면 (작을수록 칼같이 섬)
      uShapeSigma: { value: 0.16 },     // 모양장(빠른 잡음)의 표준편차
      // 층 높이(km). 밑값은 예전에 박아 쓰던 상수이고, 예보 단면이 오면
      // `setLayerAltitudesKm` 으로 덮습니다(utils/cloudProfile.ts).
      uLayerAltKm: { value: new THREE.Vector3(
        LAYER_ALTITUDE_KM.low, LAYER_ALTITUDE_KM.mid, LAYER_ALTITUDE_KM.high) },
      uFbmRot: { value: 1 },            // 41절 — fbm 옥타브 회전
      // 구름 군집 (계획 37절). 규모는 셀의 3배 — 저층 6km 입니다.
      // ⚠ 셀×7(14km)로는 **아무 일도 안 일어납니다.** 한 화면 안에서
      // 너무 천천히 변해 군집으로 안 보입니다(먼 하늘 구름각크기
      // 5.88° 그대로). 셀×3 에서 8.83° 로 커집니다.
      uClusterAmt: { value: 0.7 },
      uClusterMul: { value: 3.0 },
      // 구름을 비추는 아래쪽 하늘을 어느 고도에서 뜨는가 (계획 38절).
      uAmbDownDeg: { value: 12.0 },
      uDataOut: { value: 0 },
    },
    vertexShader: SLAB_VERT,
    fragmentShader: frag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // 합성기의 구름 버퍼는 **미리곱** 형태를 기대합니다. 색을 이미
    // 알파로 곱해 내보내므로 src 계수가 One 입니다.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });

  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'cloudSlab';
  // 두 번째 판 — 재질을 복제하되 uniform 항목은 **같은 객체**를 가리킵니다(세터들이 .value 만
  // 바꾸므로 한쪽을 고치면 양쪽에 들어갑니다). uPassMode 만 따로 둡니다.
  const materialBelow = material.clone();
  materialBelow.uniforms = { ...material.uniforms, uPassMode: { value: 2 } };
  materialBelow.depthTest = false;
  const meshBelow = new THREE.Mesh(geometry, materialBelow);
  meshBelow.frustumCulled = false;
  meshBelow.name = 'cloudSlabBelow';
  meshBelow.visible = false;

  return {
    mesh,
    meshBelow,
    setSplitPasses: (on: boolean) => {
      material.uniforms.uPassMode.value = on ? 1 : 0;
      // 나눠 그릴 때만 하늘 구름 판이 지형 깊이에 가려집니다(위 VERT 주석). 기본은 예전 그대로.
      material.depthTest = on;
      material.needsUpdate = true;
    },
    material,
    coverTex,
    genusTex,
    rangeKm,
    setLayerAltitudesKm: (lowKm, midKm, highKm) => {
      // 터무니없는 값이 오면 무시합니다 — 0 이나 음수가 들어가면 셰이더의
      // 고도 계산이 통째로 무너집니다.
      const okv = (v: number) => Number.isFinite(v) && v > 0.05 && v < 25;
      if (!okv(lowKm) || !okv(midKm) || !okv(highKm)) return;
      (material.uniforms.uLayerAltKm.value as THREE.Vector3).set(lowKm, midKm, highKm);
    },
    setDemPatches: (patch, farPatch, renderer) => {
      const put = (u: Record<string, { value: unknown }>) => {
        Object.entries(u).forEach(([k, v]) => {
          if (material.uniforms[k]) material.uniforms[k].value = v.value;
        });
      };
      put(makeDemUniforms(patch));
      put(makeDemUniforms(farPatch, 'demFar'));
      // 성긴 패치만 첨탑을 걷어냅니다 — TerrainField.setPatch 와 같은 규약.
      material.uniforms.uDemFarDespike.value = farPatch ? 1 : 0;
      // §84 지평선 굽기. 렌더러가 없거나 패치가 없으면 굽지 않고, 셰이더는 다 걷습니다.
      horizonTarget?.dispose();
      horizonTarget = null;
      material.uniforms.uHorizonValid.value = 0;
      material.uniforms.uHorizonTex.value = null;
      if (renderer && (patch || farPatch)) {
        horizonTarget = bakeHorizon(renderer, material.uniforms);
        material.uniforms.uHorizonTex.value = horizonTarget.texture;
        material.uniforms.uHorizonValid.value = 1;
      }
    },
    setBandHorizon: (bandAngles, distancesKm, maxVisualDeg, seaDipDeg) => {
      bandTex?.dispose();
      bandTex = null;
      material.uniforms.uBandValid.value = 0;
      material.uniforms.uBandTex.value = null;
      if (!bandAngles || !distancesKm || bandAngles.length === 0) return;
      bandTex = bakeBandHorizon(bandAngles, distancesKm, maxVisualDeg, seaDipDeg);
      material.uniforms.uBandTex.value = bandTex;
      material.uniforms.uBandValid.value = 1;
    },
    setLowDeckKm: (baseKm, topKm) => {
      // 모르면(null·NaN·뒤집힘) (-1,-1) — 셰이더가 §81 그대로 갑니다.
      const v = material.uniforms.uLowDeckKm.value as THREE.Vector2;
      const ok = baseKm != null && topKm != null && Number.isFinite(baseKm)
        && Number.isFinite(topKm) && topKm > baseKm && baseKm >= 0 && topKm < 6;
      if (ok) v.set(baseKm as number, topKm as number); else v.set(-1, -1);
    },
    setLayerTauScale: (low, mid, high) => {
      const ok = (x: number) => (Number.isFinite(x) && x > 0 ? x : 1);
      (material.uniforms.uTauScale.value as THREE.Vector3).set(ok(high), ok(mid), ok(low));
    },
    setTerrainDistance: (tex) => {
      material.uniforms.uTerrainDist.value = tex ?? NO_TERRAIN_DIST_TEX;
      material.uniforms.uTerrainDistValid.value = tex ? 1 : 0;
    },
    setInCloud: (c) => {
      const un = material.uniforms;
      const ok = !!c && Number.isFinite(c.cover) && c.cover > 0 && Number.isFinite(c.baseKm)
        && Number.isFinite(c.topKm) && c.topKm > c.baseKm;
      if (!ok) { un.uFogBeta.value = 0; un.uFogBaseKm.value = -1; un.uFogTopKm.value = -1; return; }
      const midKm = (c!.baseKm + c!.topKm) / 2;
      const tauK = midKm < LAYER_BAND_KM.lowTop ? tau.low : (midKm < LAYER_BAND_KM.midTop ? tau.mid : tau.high);
      un.uFogBeta.value = Math.min(1, c!.cover) * tauK;
      un.uFogBaseKm.value = c!.baseKm;
      un.uFogTopKm.value = c!.topKm;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
      materialBelow.dispose();
      coverTex.dispose();
      genusTex.dispose();
      beamLut.dispose();
      horizonTarget?.dispose();
      bandTex?.dispose();
    },
  };
}

/** 16비트 고도각 부호화 — HORIZON_BAKE_FRAG 와 같은 눈금. */
function encodeHorizonDeg(deg: number): [number, number] {
  const v = Math.round(Math.min(1, Math.max(0,
    (deg - Number(HORIZON_LO_DEG)) / Number(HORIZON_SPAN_DEG))) * 65535);
  return [v >> 8, v & 255];
}

/**
 * 능선 밴드의 **밴드 메시와 같은** 실루엣을 방위 칸마다 굽습니다(§87).
 * `TerrainRing.createTerrainBands` 의 보간(72분할, 분할점마다 각도 선형 보간,
 * 그 사이 선형)과 산 판정(수평선 침강 + 0.005°)을 그대로 따릅니다.
 */
export function bandHorizonAt(
  angles: number[], azDeg: number, maxVisualDeg: number, seaDipDeg: number,
): number | null {
  const SEG = 72;
  const vertex = (s: number) => {
    const azFrac = (((s % SEG) + SEG) % SEG) / SEG;
    const idx = azFrac * (angles.length - 1);
    const i0 = Math.floor(idx), i1 = Math.min(i0 + 1, angles.length - 1);
    const f = idx - i0;
    const raw = angles[i0] * (1 - f) + angles[i1] * f;
    return raw > -seaDipDeg + 0.005 ? Math.min(raw, maxVisualDeg) : null;
  };
  const x = (((azDeg % 360) + 360) % 360) / 360 * SEG;
  const s0 = Math.floor(x), t = x - s0;
  const a = vertex(s0), b = vertex(s0 + 1);
  if (a == null && b == null) return null;
  // 한쪽만 산이면 메시의 그 변은 수평선에서 산꼭대기로 선형으로 오릅니다.
  const lo = -seaDipDeg;
  const v = (a ?? lo) * (1 - t) + (b ?? lo) * t;
  return v > lo + 0.005 ? v : null;
}

function bakeBandHorizon(
  bandAngles: number[][], distancesKm: number[], maxVisualDeg: number, seaDipDeg: number,
): THREE.DataTexture {
  const rows = 3;
  const data = new Uint8Array(HORIZON_BINS * rows * 4);
  for (let j = 0; j < Math.min(rows, bandAngles.length); j++) {
    const angles = bandAngles[j];
    const dKm = distancesKm[j] ?? 0;
    if (!angles || angles.length === 0 || !(dKm > 0)) continue;
    for (let i = 0; i < HORIZON_BINS; i++) {
      const deg = bandHorizonAt(angles, (i + 0.5) / HORIZON_BINS * 360, maxVisualDeg, seaDipDeg);
      if (deg == null) continue;
      const [hi, lo] = encodeHorizonDeg(deg);
      const o = (j * HORIZON_BINS + i) * 4;
      data[o] = hi; data[o + 1] = lo;
      data[o + 2] = Math.min(255, Math.round(dKm * 2.5));   // 0~102km
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, HORIZON_BINS, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 지형 지평선을 한 줄 렌더 타깃에 굽습니다(§84). 구름 재질의 DEM 유니폼을
 * **그대로 공유**합니다 — 다른 높이를 보면 건너뛰면 안 되는 화소를 건너뜁니다.
 */
function bakeHorizon(
  renderer: THREE.WebGLRenderer,
  src: Record<string, THREE.IUniform>,
): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(HORIZON_BINS, 1, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, generateMipmaps: false,
  });
  target.texture.wrapS = THREE.RepeatWrapping;
  const uniforms: Record<string, THREE.IUniform> = {};
  for (const k of Object.keys(src)) {
    if (k.startsWith('uDem') || k === 'uEyeHeightM') uniforms[k] = src[k];
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: HORIZON_BAKE_FRAG,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  quad.geometry.dispose();
  mat.dispose();
  return target;
}

/** 운량장을 굽는 데 필요한 것 — 방위·거리로 층 운량과 확신도를 답하는 함수. */
export interface CoverageSource {
  (azimuthDeg: number, distanceKm: number): {
    low: number; mid: number; high: number; confidence: number;
    /**
     * 저층 운형 — 0(적운형)~1(층운형), 근거리 볼륨이 씁니다(계획 33절).
     * 생략하면 0(적운형)으로 굽습니다 — 이 함수를 직접 구현한 예전
     * 호출부(하네스 습작들)가 이 값 없이도 그대로 컴파일·실행되게
     * 하려는 것입니다.
     */
    lowGenus?: number;
  };
}

/**
 * 운량장을 다시 굽습니다. **매 프레임 부르면 안 됩니다** — 128×128 이면
 * 16,384 회 조회라 수십 ms 가 듭니다. 기상이나 시각이 바뀔 때만 부르세요.
 *
 * 운형장(`genusTex`)도 같은 루프에서 같이 굽습니다 — 조회를 두 번 하면
 * 16,384 회가 배로 늡니다.
 */
export function bakeCloudSlabCoverage(handle: CloudSlabHandle, src: CoverageSource): void {
  bakeCoverageData(
    handle.coverTex.image.data as Uint8Array, handle.genusTex.image.data as Uint8Array,
    handle.coverTex.image.width as number, handle.rangeKm, src,
  );
  handle.coverTex.needsUpdate = true;
  handle.genusTex.needsUpdate = true;
}

/**
 * 운량장·운형장 자료를 굽습니다(제곱근 사상, `slab_coverUv` 의 역). 슬랩과 위에서 본
 * 구름(§120)이 **같은 굽기**를 쓰게 따로 뺐습니다.
 */
export function bakeCoverageData(
  data: Uint8Array, genusData: Uint8Array, size: number, R: number, src: CoverageSource,
): void {
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      // uv → 제곱근 사상의 역: r = |p|, d = R·r²
      const px = ((i + 0.5) / size) * 2 - 1;
      const py = ((j + 0.5) / size) * 2 - 1;
      const r = Math.hypot(px, py);
      const k = (j * size + i) * 4;
      if (r > 1) {
        data[k] = data[k + 1] = data[k + 2] = data[k + 3] = 0;
        genusData[k] = genusData[k + 1] = genusData[k + 2] = 0; genusData[k + 3] = 255;
        continue;
      }
      const d = R * r * r;
      const az = r < 1e-6 ? 0 : (Math.atan2(px / r, -py / r) * 180) / Math.PI;
      const c = src((az + 360) % 360, d);
      data[k] = Math.max(0, Math.min(255, c.low * 255));
      data[k + 1] = Math.max(0, Math.min(255, c.mid * 255));
      data[k + 2] = Math.max(0, Math.min(255, c.high * 255));
      data[k + 3] = Math.max(0, Math.min(255, c.confidence * 255));
      const g = Math.max(0, Math.min(255, (c.lowGenus ?? 0) * 255));
      genusData[k] = g; genusData[k + 1] = g; genusData[k + 2] = g; genusData[k + 3] = 255;
    }
  }
}

export interface CloudSlabUpdate {
  camera: THREE.Camera;
  widthPx: number;
  heightPx: number;
  sunDir: THREE.Vector3;
  sunAltDeg: number;
  sunAzDeg: number;
  moonDir?: THREE.Vector3;
  moonAltDeg?: number;
  moonIllum?: number;
  /**
   * 지상 도시 불빛의 세기 (0~1). 구름 밑면을 주황으로 물들입니다.
   *
   * `boolean` 도 받습니다(예전 호출부 호환) — `true` 는 1.0 입니다. 다만
   * 이건 켜짐/꺼짐이 아니라 **그 장소가 얼마나 밝은가**이므로, 앱은
   * 광공해 설정(`starMagLimit`)에서 끌어와 넘깁니다.
   */
  cityLight?: boolean | number;
  /** 층 고도(km)에서 본 직달광. `beamAtAltitude` 를 그대로 넘기세요. */
  beamFor: (altKm: number) => RGB;
  atmosphere: AtmosphereParams;
  /**
   * 층별 바람. `buildSkyColumns` 에 넘긴 것과 **같은 값**이어야 합니다 —
   * 갈라지면 운량장과 잔무늬가 서로 다른 방향으로 흐릅니다.
   */
  layerWinds: LayerWinds;
  /**
   * 이류 기준 경과 시간 (시간). `cloudPlacement` 의 `driftMinutes / 60` 을
   * 그대로 주세요 — 같은 기준을 써야 두 층위가 함께 움직입니다.
   */
  driftHours: number;
  saturation?: number;
  /** 대기 원근감 세기 (기본 1). 노을 색 변화를 얼마나 덮는지 조절합니다. */
  aerialScale?: number;
  /** 다중산란 세기 (기본 1). 그림자를 얼마나 메우는지 조절합니다. */
  multiScatter?: number;
  /** 수직 체적 스텝 수 상한 (기본 1). 올리면 층을 여러 겹으로 나눕니다. */
  volSteps?: number;
  /**
   * 근거리 볼륨 켬/끔 (기본 **끔** — 계획 35절, 노을 경계에 회색 얼룩
   * 띠가 생기는 결함을 원인을 갈라내기 전까지는 예전 껍질로 갑니다).
   * `true`로 켜면 A/B 비교나 이어지는 수정 작업에 씁니다.
   */
  nfEnabled?: boolean;
  /** 근거리 볼륨이 담당하는 수평 반경 (km, 기본 22 — 계획 33절에서 검증한 값). */
  nfCapKm?: number;
  /** 근거리 볼륨 시선 스텝 수 상한 (기본 28, 최대 48). 내리면 가벼워집니다. */
  nfViewSteps?: number;
  /** 근거리 볼륨 그림자 스텝 수 상한 (기본 5, 최대 8). */
  nfShadowSteps?: number;
  /** 두꺼운 표본의 직달광 바닥 (기본 0.70). 올리면 햇빛 받는 구름면이 밝아집니다. */
  cloudLitFloor?: number;
  /** 구름이 받는 하늘 확산광의 바닥 (기본 0.55). 올리면 구름 전체가 밝아집니다. */
  cloudAmbFloor?: number;
  /** 구름 위상함수의 바닥 (기본 0.90). 올리면 옆에서 본 구름이 밝아집니다. */
  cloudPhaseFloor?: number;
  /** 40절 — 'twoStream' 이면 보존산란 슬랩 해, 'legacy' 면 예전 삼항 합. */
  cloudModel?: 'legacy' | 'twoStream';
  cloudAsym?: number;
  cloudAniso?: number;
  cloudAnisoW?: number;
  cloudGroundAlb?: number;
  cloudSideLit?: number;
  cloudFaceUp?: number;
  /** 41절 — 'threshold' 면 면적은 운량이·두께는 물리가 정합니다. */
  cloudShape?: 'legacy' | 'threshold';
  shapeDepth?: number;
  shapeEdge?: number;
  shapeSigma?: number;
  fbmRotate?: boolean;
  /** 구름 군집 세기 (0 = 없음). 셀보다 큰 규모의 덩어리를 만듭니다. */
  clusterAmt?: number;
  /** 군집 규모 = 셀 크기 × 이 값 (기본 3 → 저층 6km). */
  clusterMul?: number;
  /** 구름을 비추는 아래쪽 하늘의 표본 고도 (기본 12°). 낮출수록 노을빛을 받습니다. */
  ambDownDeg?: number;
  /** 43절 — 0 보통 · 1 표시색+알파 · 2 (두께, 층, 태양비, 알파). 스타일 보드용. */
  dataOut?: number;
  visible: boolean;
}

/** 매 프레임 부르는 쪽. 카메라와 태양만 갱신하므로 값쌉니다. */
export function updateCloudSlab(handle: CloudSlabHandle, u: CloudSlabUpdate): void {
  handle.mesh.visible = u.visible;
  handle.meshBelow.visible = false;
  if (!u.visible) return;
  const uni = handle.material.uniforms;

  (uni.uRes.value as THREE.Vector2).set(u.widthPx, u.heightPx);
  u.camera.updateMatrixWorld();
  // 화면 → 세계. 광선 복원에 씁니다.
  (uni.uInvViewProj.value as THREE.Matrix4)
    .multiplyMatrices(u.camera.projectionMatrix, u.camera.matrixWorldInverse)
    .invert();
  (uni.uCamPos.value as THREE.Vector3).setFromMatrixPosition(u.camera.matrixWorld);
  // 지면(TerrainRing 의 setGroundHorizon)과 **같은 식**으로 지평선을 구합니다.
  // 둘이 어긋나면 그 차이가 그대로 하늘이 비치는 띠가 됩니다.
  uni.uHorizonSinE.value = -Math.sin(
    (seaHorizonDipDeg(u.atmosphere.observerElevM ?? 0) * Math.PI) / 180,
  );
  // 관측자 해발 고도 — 구름층 위에 서 있는지를 셰이더가 알아야 합니다(운해).
  uni.uObserverAltKm.value = Math.max(0, u.atmosphere.observerElevM ?? 0) / 1000;

  // ── 광원 고르기 (§92) ────────────────────────────────────────────────
  // 셰이더는 광원 하나만 계산합니다. 박명과 달빛 중 하늘을 더 밝히는 쪽을 넣고,
  // 달이면 햇빛과 **같은 식**에 이득만 곱합니다(달빛은 햇빛을 되비춘 것).
  const ml = u.moonDir && u.moonAltDeg !== undefined && u.moonIllum !== undefined
    ? moonLight(u.sunAltDeg, u.moonAltDeg, u.moonIllum, u.atmosphere)
    : { gain: 0, useMoon: false };
  // ⚠ (2026-10-02) 위 기준(하늘을 더 밝히는 쪽)만으로는 항해박명에 뜬 보름달이 버려졌습니다. 해 −8.5° 면 구름
  //   높이(≤ 7.5km)는 지구 그림자 안이라(그림자 높이 ≈ 70km) 해의 **직달은 구름에 0** 인데, 박명 하늘이 달빛
  //   하늘보다 밝다는 이유로 해를 골라 고도 13.5° 보름달의 직달까지 버렸습니다. 하늘돔은 둘 다 그리므로
  //   달빛 받은 구름이 맑은 하늘보다 어두웠습니다(마쓰모토 18:11 — 맑음 28.2 · 중층 61% 만 20.2,
  //   verify-night-cloudy). 그래서 **맨 위 층에 닿는 직달**을 견줘 달이 더 크면 달을 광원으로 씁니다.
  const moonUp = ml.gain > 0 && !!u.moonDir && u.moonAltDeg !== undefined;
  let lightByMoon = ml.useMoon && moonUp;
  const topKm = (uni.uLayerAltKm.value as THREE.Vector3).z;
  if (!lightByMoon && moonUp && u.sunAltDeg < 0) {
    const key = [u.sunAltDeg.toFixed(2), u.moonAltDeg!.toFixed(2), topKm.toFixed(3), ml.gain.toFixed(6),
      u.atmosphere.betaMie, u.atmosphere.ozoneDU, u.atmosphere.dayOfYear].join('|');
    const memo = handle as unknown as { _moonPick?: { key: string; moon: boolean } };
    if (!memo._moonPick || memo._moonPick.key !== key) {
      const lw = (c: RGB) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      const sunTop = lw(beamGrazing(u.sunAltDeg, topKm, u.atmosphere));
      const moonTop = lw(beamGrazing(u.moonAltDeg!, topKm, u.atmosphere)) * ml.gain;
      memo._moonPick = { key, moon: moonTop > sunTop };
    }
    lightByMoon = memo._moonPick.moon;
  }
  const lightAlt = lightByMoon ? u.moonAltDeg! : u.sunAltDeg;
  (uni.uSunDir.value as THREE.Vector3).copy(lightByMoon ? u.moonDir! : u.sunDir).normalize();
  uni.uSunAltDeg.value = lightAlt;
  uni.uSunAzDeg.value = u.sunAzDeg;
  uni.uDispSunAltDeg.value = u.sunAltDeg;
  uni.uLightGain.value = lightByMoon ? ml.gain : 1;
  // 달이 광원이면 하늘빛 = 달빛 하늘 × 이득 + 바닥. 그 바닥을 **박명 하늘(반구 평균)** 로 올립니다 — 해가 진
  // 직후에는 박명 하늘이 밤하늘 바닥보다 훨씬 밝고, 직달 대신 달을 골랐다고 그 환경광까지 버리면 안 됩니다.
  // 깊은 밤에는 박명 하늘 = 바닥이라 예전과 같습니다(방향은 잃습니다 — 반구 평균).
  let add = { r: 0, g: 0, b: 0 };
  if (lightByMoon) {
    const memo = handle as unknown as { _twiAmb?: { key: string; c: RGB } };
    const key = [u.sunAltDeg.toFixed(2), u.atmosphere.betaMie, u.atmosphere.ozoneDU, u.atmosphere.elevScale].join('|');
    if (!memo._twiAmb || memo._twiAmb.key !== key) memo._twiAmb = { key, c: hemiSkyRadiance(u.sunAltDeg, u.atmosphere) };
    const tw = memo._twiAmb.c;
    add = { r: Math.max(NIGHT_SKY.r, tw.r), g: Math.max(NIGHT_SKY.g, tw.g), b: Math.max(NIGHT_SKY.b, tw.b) };
  }
  (uni.uSkyAdd.value as THREE.Vector3).set(add.r, add.g, add.b);
  uni.uCityLight.value =
    typeof u.cityLight === 'number' ? Math.max(0, Math.min(1, u.cityLight))
      : u.cityLight === false ? 0.0 : 1.0;

  // ⚠ 셰이더가 쓰는 높이와 **같은 값**이어야 합니다. 예전에는 여기만 상수를
  //   보고 있어서, 높이를 바꾸면 빛줄기 색만 옛 높이로 남았을 것입니다.
  const alt = uni.uLayerAltKm.value as THREE.Vector3;
  // ── 직달을 하늘빛과 같은 눈금으로 (§104) ──────────────────────────────
  //
  // `beamFor`(= beamAtAltitude)는 대기 밖 햇빛을 1 로 둔 **투과율**이고, 셰이더의 하늘빛
  // (atm_skyRadiance)은 산란에 skyExposure(22)를 곱한 복사휘도입니다. 그대로 더하면 하늘빛이
  // 스무 배 넘게 셉니다 — 맑은 날 수평면 확산 비율이 해 60° 에서 0.75(맑은 하늘 모형 약 0.11),
  // 해쪽 구름 옆면의 직달 몫이 해 +5° 에도 2% 였습니다. 그래서 노을 구름이 붉은 직달이 아니라
  // 하늘빛으로 칠해졌고, 해쪽 먼 구름이 직달을 막아도(§103) 화면이 거의 안 바뀌었습니다.
  // 지형이 먼저 찾아 쓰던 같은 눈금(SOLAR_BEAM_SCALE, 맑은 하늘 직달/확산 비에서 역산)을
  // 씁니다. 달빛도 같은 식이라 같이 곱합니다(하늘빛 쪽도 같은 skyExposure 를 탑니다).
  const beamOf = (km: number): RGB => {
    const b = lightByMoon ? beamAtAltitude(lightAlt, km, u.atmosphere) : u.beamFor(km);
    const k = BEAM_TO_SLAB * (lightByMoon ? ml.gain : 1);
    return { r: b.r * k, g: b.g * k, b: b.b * k };
  };
  const bl = beamOf(alt.x);
  const bm = beamOf(alt.y);
  const bh = beamOf(alt.z);
  (uni.uBeamLow.value as THREE.Vector3).set(bl.r, bl.g, bl.b);
  (uni.uBeamMid.value as THREE.Vector3).set(bm.r, bm.g, bm.b);
  (uni.uBeamHigh.value as THREE.Vector3).set(bh.r, bh.g, bh.b);
  // §105 — 자리마다 다른 해 고도의 직달 표. 해(또는 달)가 0.01° 넘게 움직였거나 층 높이·대기가
  // 바뀌었을 때만 다시 굽습니다(층당 64번 beamAtAltitude). 호출부가 넘긴 beamFor 를 존중하려고
  // d=0 에서 beamFor 와 같아지게 채널별 비를 곱합니다(보통은 1).
  {
    const lutTex = uni.uBeamLUT.value as THREE.DataTexture;
    const key = [lightAlt.toFixed(2), alt.x.toFixed(3), alt.y.toFixed(3), alt.z.toFixed(3),
      bl.r.toFixed(6), bm.r.toFixed(6), bh.r.toFixed(6), u.atmosphere.betaMie, u.atmosphere.elevScale,
      u.atmosphere.observerElevM ?? 0].join('|');
    if ((lutTex.userData as any).key !== key) {
      (lutTex.userData as any).key = key;
      const d = lutTex.image.data as Uint8Array;
      const rows: [number, RGB][] = [[alt.z, bh], [alt.y, bm], [alt.x, bl]];   // 행 0 상층 · 1 중층 · 2 저층
      const enc = (v: number) => (v < 2 ** -16 ? 0 : Math.max(1, Math.min(255, Math.round((Math.log2(v) + 16) / 16 * 255))));
      // §106 — 표는 광선 적분(grazingRay)으로. 높이는 **층 높이 그대로**(해면 기준)입니다.
      // ⚠ §118 — 예전에는 `관측 고도 + 층 높이` 에서 적분했습니다. 층 높이(uLayerAltKm)는 예보 기압면의
      //   지오퍼텐셜 높이라 이미 해면 기준이고, 셰이더도 관측자 해발 고도와 같은 틀로 교점을 풉니다
      //   (slab_sphereIntersect 의 A·B). 그래서 해발 760m(스와)의 1.2km 구름을 1.96km 에서 비췄습니다 —
      //   해 0° 에 1.75배, 해 −1° 에 3.2배 밝고 덜 붉었습니다(해발 0 에서는 차이 없음).
      // 호출부 beamFor 가 표준 식(beamAtAltitude)에서 벗어난 만큼(보통 1)은 채널별로 그대로 곱합니다.
      // beamFor 와 beamAtAltitude 는 **같은 인자**로 부르므로 이 비는 높이 틀과 무관합니다.
      rows.forEach(([km, b0], row) => {
        const ref = beamAtAltitude(lightAlt, km, u.atmosphere);
        const k = BEAM_TO_SLAB * (lightByMoon ? ml.gain : 1);
        const ratio = (c: 'r' | 'g' | 'b') => (ref[c] > 1e-9 ? b0[c] / (ref[c] * k) : 1);
        const rr = ratio('r'), rg = ratio('g'), rb = ratio('b');
        for (let i = 0; i < BEAM_LUT_N; i++) {
          const dDeg = -BEAM_LUT_SPAN + (2 * BEAM_LUT_SPAN * i) / (BEAM_LUT_N - 1);
          const b = beamGrazing(lightAlt + dDeg, km, u.atmosphere);
          const o = (row * BEAM_LUT_N + i) * 4;
          d[o] = enc(b.r * rr); d[o + 1] = enc(b.g * rg); d[o + 2] = enc(b.b * rb);
          d[o + 3] = Math.max(0, Math.min(255, Math.round(b.refrDeg / 2 * 255)));
        }
      });
      lutTex.needsUpdate = true;
    }
    uni.uBeamLUTGain.value = BEAM_TO_SLAB * (lightByMoon ? ml.gain : 1);
  }
  // 두 번째 판(§96)은 그릴 것이 있을 때만 켭니다 — 관측자 아래 층이 있거나 구름 속일 때.
  // "아래" 는 셰이더와 같은 식: 저층은 덱 윗면(모르면 층 높이), 중·상층은 층 높이.
  if (uni.uPassMode.value > 0.5) {
    const obsKm = uni.uObserverAltKm.value as number;
    const lowDeck = uni.uLowDeckKm.value as THREE.Vector2;
    const lowSurf = lowDeck.y > 0 ? Math.max(lowDeck.y, alt.x) : alt.x;
    const fogOn = (uni.uFogBeta.value as number) > 0
      && obsKm > (uni.uFogBaseKm.value as number) && obsKm < (uni.uFogTopKm.value as number);
    // §116 — 지형(DEM)이 있고, 관측자 위 층 가운데 밑면이 관측자보다 2.5km 안에 있는 층이 있으면 산이 그
    // 구름을 뚫고 올라갈 수 있습니다. 그때만 산 앞 구름을 두 번째 판으로 넘깁니다.
    const demOn = (uni.uDemValid.value as number) > 0.5 || (uni.uDemFarValid.value as number) > 0.5;
    const basesAbove = [alt.x, alt.y, alt.z].filter(h => h > obsKm);
    const ridgeClouds = demOn && (uni.uTerrainOccludeSky.value as number) > 0.5
      && basesAbove.some(h => h - obsKm < RIDGE_CLOUD_REACH_KM);
    uni.uRidgeClouds.value = ridgeClouds ? 1 : 0;
    handle.meshBelow.visible = fogOn || ridgeClouds || obsKm > lowSurf || obsKm > alt.y || obsKm > alt.z;
  }
  // 구름 속 안개가 받는 직달광 — 관측자 자리에서(§93). 안개가 꺼져 있으면 안 구합니다.
  // ⚠ §118 — beamFor(h) 의 h 는 **관측자 위 높이**입니다(지면 = 0, 곧 beamAtAltitude(해, 0) 이 관측자
  //   자리). 예전에는 관측자 해발 고도를 넘겨 그 두 배 높이에서 비췄습니다(해발 1600m 산 위 안개를
  //   3200m 에서 — 해 30° 에 43% 밝게).
  if ((uni.uFogBeta.value as number) > 0) {
    const bf = beamOf(0);
    (uni.uFogBeam.value as THREE.Vector3).set(bf.r, bf.g, bf.b);
  }

  uni.uBeta.value = u.atmosphere.betaMie;
  uni.uAngstrom.value = u.atmosphere.angstrom;
  uni.uElevScale.value = u.atmosphere.elevScale;
  uni.uOzoneDU.value = u.atmosphere.ozoneDU;
  // 방위 → 월드 XZ. 이 장면은 X=동, Z=−북 이므로 북 성분의 부호가 뒤집힙니다.
  // 미는 방향은 **불어오는 쪽**입니다 (skyColumn.ts `driftOf` 주석과 같은 이유).
  const setWind = (v: THREE.Vector2, w: { speedKmh: number; bearingDeg: number }) => {
    const rad = (w.bearingDeg * Math.PI) / 180;
    v.set(w.speedKmh * Math.sin(rad), -w.speedKmh * Math.cos(rad));
  };
  setWind(uni.uWindLow.value as THREE.Vector2, u.layerWinds.low);
  setWind(uni.uWindMid.value as THREE.Vector2, u.layerWinds.mid);
  setWind(uni.uWindHigh.value as THREE.Vector2, u.layerWinds.high);
  uni.uDriftHours.value = u.driftHours;
  // 화소 하나의 각크기. 잔무늬를 어디서부터 평균으로 녹일지 정하는 값입니다.
  // 원근 카메라가 아니면 보수적으로 넓게 잡아 앨리어싱 쪽으로 기울지 않게 합니다.
  const persp = u.camera as THREE.PerspectiveCamera;
  const fovDeg = typeof persp.fov === 'number' ? persp.fov : 60;
  uni.uPixelAngleRad.value = ((fovDeg * Math.PI) / 180) / Math.max(1, u.heightPx);
  uni.uSaturation.value = u.saturation ?? 1;
  uni.uAerialScale.value = u.aerialScale ?? 1;
  uni.uMultiScatter.value = u.multiScatter ?? 1;
  uni.uVolSteps.value = u.volSteps ?? 1;
  // 기본 끔 — 재질 기본값과 같은 이유(위 uNfEnable 주석, 계획 35절).
  uni.uNfEnable.value = u.nfEnabled === true ? 1 : 0;
  uni.uNfCapKm.value = u.nfCapKm ?? 22;
  uni.uNfViewSteps.value = u.nfViewSteps ?? 28;
  uni.uNfShadowSteps.value = u.nfShadowSteps ?? 5;
  uni.uCloudLitFloor.value = u.cloudLitFloor ?? 0.45;
  uni.uCloudAmbFloor.value = u.cloudAmbFloor ?? 0.26;
  uni.uCloudPhaseFloor.value = u.cloudPhaseFloor ?? 0.90;
  uni.uCloudModel.value = u.cloudModel === 'legacy' ? 0 : 1;
  uni.uCloudAsym.value = u.cloudAsym ?? 0.85;
  uni.uCloudAniso.value = u.cloudAniso ?? 0.45;
  uni.uCloudAnisoW.value = u.cloudAnisoW ?? 0.35;
  uni.uCloudGroundAlb.value = u.cloudGroundAlb ?? 0.15;
  uni.uCloudSideLit.value = u.cloudSideLit ?? 0.25;
  uni.uCloudFaceUp.value = u.cloudFaceUp ?? 0.65;
  uni.uShapeMode.value = u.cloudShape === 'legacy' ? 0 : 1;
  uni.uShapeDepth.value = u.shapeDepth ?? 1.2;
  uni.uShapeEdge.value = u.shapeEdge ?? 0.70;
  uni.uShapeSigma.value = u.shapeSigma ?? 0.16;
  uni.uFbmRot.value = u.fbmRotate === false ? 0 : 1;
  uni.uClusterAmt.value = u.clusterAmt ?? 0.7;
  uni.uClusterMul.value = u.clusterMul ?? 3.0;
  // ── 아래쪽 주변광 표본 고도는 **태양을 따라 내려갑니다** (계획 38절) ──
  //
  // 낮에는 12°가 맞습니다(태양 0°에서도 그 고도가 따뜻함 +0.756). 그런데
  // 해가 지면 따뜻한 띠가 0~6°로 얇게 내려앉아 12°는 이미 파랗습니다
  // (태양 -3°에서 -0.325). 저층 구름은 그 시각 직달광이 0.0006 까지 죽어
  // 이 표본만으로 칠해지므로, 12°를 고집하면 노을 구름이 남색이 됩니다.
  //
  // 고정 6°로도 고쳐지지만 낮까지 같이 바뀝니다. 태양 고도를 따라가면
  // **낮은 손대지 않고** 박명만 고칠 수 있습니다.
  const _ss = (e0: number, e1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  uni.uAmbDownDeg.value = u.ambDownDeg ?? (12.0 - 8.0 * _ss(6, -4, u.sunAltDeg));
  uni.uDataOut.value = u.dataOut ?? 0;
}

/**
 * 이미 풀린 하늘 기둥(`LayerSample[]`)에서 운량장 원천을 만듭니다.
 *
 * 앱의 타임라인은 팬을 들고 있지 않고 재구성된 기둥만 넘겨줍니다. 그래서
 * (방위, 거리)로 이중선형 조회하는 원천을 여기서 만듭니다.
 *
 * ⚠ **천정 부챗살의 정체가 여기 있었습니다(§101).** 예전 주석은 "직교 좌표
 * 텍스처에 구우니 중심 텍셀이 하나라 바람개비가 사라진다" 고 적었지만 틀렸습니다.
 * 텍셀마다 `src(방위, 거리)` 를 부르므로, 맨 안쪽 고리보다 가까운 텍셀은 거리
 * 클램프로 **그 방위의** 고리 값을 받았습니다. 기둥의 맨 윗 고도는 69.6°(8단
 * 등입체각)라 그 고리가 상층 4.1km·중층 1.7km 에 있고, 그 안쪽 — 고도 70° 위
 * 하늘 전체 — 에서 24방위의 서로 다른 값이 천정 한 점으로 모였습니다.
 *
 * 이제 맨 안쪽 고리 안에서는 **공간 해상도를 그 고리의 것으로 고정**합니다:
 * 거리 d 에서 방위 창을 (d0/d − 1) 표본 폭으로 넓혀 평균합니다(d0 = 고리 거리). 고리에서는
 * 창 0(그 값 그대로, 이음매 없음), d0/25 안쪽에서는 한 바퀴 전체 평균 — 천정에서 한 값이 됩니다.
 * 그 사이의 무늬 폭은 고리의 표본 간격(상층 약 1km)을 유지하고 중심으로 좁아지지
 * 않습니다.
 */

export function coverageFromSamples(
  samples: {
    layer: LayerKey; azimuthDeg: number; distanceKm: number; cover: number; confidence: number;
    /** 저층 운형 판정 입력 (계획 33절) — `LayerSample`이 이미 들고 있는 값입니다. */
    precipMmH?: number; humidityPct?: number; lowPct?: number; highPct?: number;
  }[],
  /** nearKm: 관측자 둘레 평면 평활의 반경(§113, 기본 12). 0 이면 끕니다 — 판정의 옛 조회 대조용. */
  opts: { nearKm?: number } = {}
): CoverageSource {
  type Row = { az: number[]; dist: number[]; cover: Float32Array; conf: Float32Array; genus?: Float32Array };
  const byLayer: Record<string, Row> = {};

  for (const key of ['low', 'mid', 'high'] as LayerKey[]) {
    const mine = samples.filter(s => s.layer === key);
    if (mine.length === 0) continue;
    const az = Array.from(new Set(mine.map(s => s.azimuthDeg))).sort((a, b) => a - b);
    const dist = Array.from(new Set(mine.map(s => s.distanceKm))).sort((a, b) => a - b);
    const cover = new Float32Array(az.length * dist.length);
    const conf = new Float32Array(az.length * dist.length);
    // 저층만 운형이 필요합니다(근거리 볼륨이 저층만 담당). 방향마다 다른
    // 씨앗을 줘 문턱 경계 판정(적운/층적운)이 모든 방위에서 똑같이 튀지
    // 않게 합니다 — CloudDeck 등 다른 곳의 방향별 씨앗과 같은 관례입니다.
    const genus = key === 'low' ? new Float32Array(az.length * dist.length) : undefined;
    const ai = new Map(az.map((v, i) => [v, i]));
    const di = new Map(dist.map((v, i) => [v, i]));
    for (const s of mine) {
      const i = ai.get(s.azimuthDeg)!, j = di.get(s.distanceKm)!;
      const idx = j * az.length + i;
      cover[idx] = s.cover;
      conf[idx] = s.confidence;
      if (genus) {
        const seed = ((Math.sin(s.azimuthDeg * 12.9898 + s.distanceKm * 0.037 + 17.3) * 43758.5453) % 1 + 1) % 1;
        genus[idx] = lowLayerGenus(
          s.cover,
          { precipitation: s.precipMmH, humidity: s.humidityPct, lowPct: s.lowPct ?? s.cover * 100, highPct: s.highPct ?? 0 },
          seed
        );
      }
    }
    byLayer[key] = { az, dist, cover, conf, genus };
  }

  const lookup = (row: Row | undefined, azDeg: number, distKm: number) => {
    if (!row) return { c: 0, f: 0, g: 0 };
    const { az, dist, cover, conf, genus } = row;
    const nA = az.length;
    // 방위는 360°에서 되감깁니다.
    let a0 = 0;
    while (a0 < nA - 1 && az[a0 + 1] <= azDeg) a0++;
    const a1 = (a0 + 1) % nA;
    const spanA = (az[a1] - az[a0] + 360) % 360 || 360 / nA;
    const tA = Math.max(0, Math.min(1, ((azDeg - az[a0] + 360) % 360) / spanA));
    // 거리는 클램프합니다 — 표본 밖은 가장 가까운 고리의 값입니다.
    let d0 = 0;
    while (d0 < dist.length - 2 && dist[d0 + 1] < distKm) d0++;
    const d1 = Math.min(dist.length - 1, d0 + 1);
    const spanD = Math.max(1e-6, dist[d1] - dist[d0]);
    const tD = Math.max(0, Math.min(1, (distKm - dist[d0]) / spanD));
    const at = (arr: Float32Array, ia: number, id: number) => arr[id * nA + ia];
    // 맨 안쪽 고리보다 가까우면 그 고리를 방위로 평균합니다(위 머리말, §101).
    const dIn = dist[0];
    if (distKm < dIn && nA > 1) {
      // 창 폭(표본 수). 고리에서 0(그 값 그대로 — 이음매 없음), 안으로 갈수록 넓어집니다.
      const width = distKm > 1e-9 ? dIn / distKm - 1 : Infinity;
      const ring = (arr: Float32Array) => {
        if (width >= nA) {
          let acc = 0;
          for (let i = 0; i < nA; i++) acc += arr[i];
          return acc / nA;
        }
        // 고리 값을 방위로 선형 보간한 주기 함수를 [u - w/2, u + w/2] 에서 평균합니다.
        const u = a0 + tA;
        const steps = Math.max(2, Math.ceil(width * 4));
        let acc = 0;
        for (let k = 0; k <= steps; k++) {
          const x = u - width / 2 + (width * k) / steps;
          const f = Math.floor(x);
          const i0 = ((f % nA) + nA) % nA, i1 = (i0 + 1) % nA;
          const t = x - f;
          const v = arr[i0] * (1 - t) + arr[i1] * t;
          acc += (k === 0 || k === steps ? 0.5 : 1) * v;
        }
        return acc / steps;
      };
      return { c: ring(cover), f: ring(conf), g: genus ? ring(genus) : 0 };
    }
    const mix = (arr: Float32Array) =>
      (at(arr, a0, d0) * (1 - tA) + at(arr, a1, d0) * tA) * (1 - tD) +
      (at(arr, a0, d1) * (1 - tA) + at(arr, a1, d1) * tA) * tD;
    return { c: mix(cover), f: mix(conf), g: genus ? mix(genus) : 0 };
  };

  // ── 관측자 둘레는 평면에서 매끄럽게 (§113) ─────────────────────────────
  //
  // 기둥은 방위 24칸 × 고도 8단이라, 위 조회는 **부채꼴을 이어 붙인 장**입니다. 칸 사이의 방위
  // 보간 경계가 관측자 한 점으로 모여, 운량장 자체가 관측자를 중심으로 한 부챗살입니다(맨 안쪽
  // 고리 안만 평균하는 §101 로는 그 바깥 부채꼴이 그대로 남음). 층이 높으면 그 중심이 천정의
  // 작은 점이라 희미했지만, 운해 속 산 위(마쓰모토 785m, 저층 밑면 1.06km — 눈 위 275m)에서는
  // 올려다본 화면 전체가 반경 0.2km 안을 보게 되어 화면 가득 꽃잎이 됐습니다(2026-09-27 QR).
  //
  // 관측자 둘레 NEAR_KM 안에서는 **기둥 표본점들을 평면 가우스(σ = NEAR_SIGMA_KM)로 가중 평균**한
  // 값을 씁니다(나다라야–왓슨: 가중치 합으로 나누므로 안쪽 고리의 표본이 촘촘해도 치우치지 않음).
  // 예보 격자는 수 km 간격이라 그보다 잔 운량 무늬는 보간이 만든 것이지 예보가 아닙니다 — 잔
  // 무늬는 셰이더의 노이즈가 맡습니다. 바깥으로 가면서 원래 값으로 이어 붙입니다(이음매 없음).
  // ⚠ 처음엔 위 조회 결과(부채꼴 장)를 격자로 떠서 흐렸는데, 한가운데 뾰족점이 표본 간격마다
  //   복제돼 격자 무늬가 남았습니다. 흐리는 대상은 장이 아니라 **표본점**이어야 합니다.
  // 반경 12km(안쪽 6km 는 평활 그대로). 예보 부채꼴의 첫 고리가 10km 라 그 안쪽의 방위 차는 전부
  // 보간입니다. 처음 8km 로 두었을 때 5km 원이 넘어가는 구간에 걸려 부채꼴이 0.26~0.29 배 남았습니다.
  const NEAR_KM = opts.nearKm ?? 12, NEAR_SIGMA_KM = 2;
  const REACH_KM = NEAR_KM + 3 * NEAR_SIGMA_KM;
  type Pt = { x: number; y: number; c: number; f: number; g: number };
  const nearPts: Record<string, Pt[]> = {};
  for (const [key, row] of Object.entries(byLayer)) {
    const list: Pt[] = [];
    row.dist.forEach((d, j) => {
      if (d > REACH_KM) return;
      row.az.forEach((azDeg, i) => {
        const a = (azDeg * Math.PI) / 180, idx = j * row.az.length + i;
        list.push({ x: d * Math.sin(a), y: d * Math.cos(a), c: row.cover[idx], f: row.conf[idx], g: row.genus ? row.genus[idx] : 0 });
      });
    });
    nearPts[key] = list;
  }
  const smooth = (key: string, x0: number, y0: number, fallback: { c: number; f: number; g: number }) => {
    const pts = nearPts[key];
    if (!pts || pts.length === 0) return fallback;
    let w = 0, c = 0, f = 0, g = 0;
    for (const p of pts) {
      const dx = p.x - x0, dy = p.y - y0;
      const k = Math.exp(-(dx * dx + dy * dy) / (2 * NEAR_SIGMA_KM * NEAR_SIGMA_KM));
      w += k; c += k * p.c; f += k * p.f; g += k * p.g;
    }
    return w > 1e-9 ? { c: c / w, f: f / w, g: g / w } : fallback;
  };
  return (azimuthDeg: number, distanceKm: number) => {
    const lo0 = lookup(byLayer.low, azimuthDeg, distanceKm);
    const mi0 = lookup(byLayer.mid, azimuthDeg, distanceKm);
    const hi0 = lookup(byLayer.high, azimuthDeg, distanceKm);
    let lo = lo0, mi = mi0, hi = hi0;
    if (distanceKm < NEAR_KM) {
      const a = (azimuthDeg * Math.PI) / 180;
      const x0 = distanceKm * Math.sin(a), y0 = distanceKm * Math.cos(a);   // 동, 북
      // 안쪽 절반은 매끈한 값 그대로, 거기서 NEAR_KM 까지 원래 값으로 넘어갑니다.
      const u = Math.min(1, Math.max(0, (distanceKm - NEAR_KM / 2) / (NEAR_KM / 2)));
      const t = u * u * (3 - 2 * u);
      const blend = (sm: { c: number; f: number; g: number }, o: { c: number; f: number; g: number }) => ({
        c: sm.c * (1 - t) + o.c * t, f: sm.f * (1 - t) + o.f * t, g: sm.g * (1 - t) + o.g * t,
      });
      lo = blend(smooth('low', x0, y0, lo0), lo0);
      mi = blend(smooth('mid', x0, y0, mi0), mi0);
      hi = blend(smooth('high', x0, y0, hi0), hi0);
    }
    return {
      low: lo.c, mid: mi.c, high: hi.c,
      confidence: Math.max(lo.f, mi.f, hi.f),
      lowGenus: lo.g,
    };
  };
}
