/**
 * volumetricScene.ts — **볼륨 구름 시험판** (2026-10-03, 문서 §123).
 *
 * 지금 하늘은 층마다 두께 한 장을 그리는 2.5D 판(CloudSlab)이라 아래에서 본 "흰 꼭대기·잿빛 밑동"을 원리적으로
 * 못 그립니다(§122, 가나자와 10/03). 업계 표준인 미리 계산한 대기(Bruneton) + 볼륨 레이마칭 구름을
 * three.js 로 구현한 takram three-geospatial 을 **휴대폰(expo-gl)에서** 돌릴 수 있는지 재려는 판입니다.
 *
 * 앱 용량을 늘리지 않으려고 자산 파일을 싣지 않습니다:
 *  - 대기 표(25MB)는 기기 GPU 에서 PrecomputedTexturesGenerator 로 만듭니다 — float 렌더 타깃이 되는지가
 *    그 자체로 시험입니다.
 *  - 구름 모양·잔모양·난류는 takram 의 절차 텍스처로, 지역 날씨는 여기서 잡음으로 만듭니다.
 *  - 시공간 청색 잡음(STBN, 1MB)은 백색 잡음으로 대신합니다(조금 더 거칩니다).
 *
 * 하네스(웹)와 앱이 같은 이 파일을 씁니다.
 */
import {
  Camera,
  ClampToEdgeWrapping,
  DataUtils,
  Texture,
  Data3DTexture,
  DataTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  NearestFilter,
  NoColorSpace,
  PerspectiveCamera,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  Uniform,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import { EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import {
  cityLightField,
  CITY_REF_LOCAL,
  getPrehydratedCityLightField,
  type CityLightField,
  type NightLights,
} from '../../utils/cityLightMap';
import { getMoonPositionPrecise } from '../../utils/moonPosition';
import { seaHorizonDipDeg } from '../../utils/earth';
import { AerialPerspectiveEffect, PrecomputedTexturesGenerator, getAltitudeCorrectionOffset, getMoonDirectionECEF, getSunDirectionECEF } from '@takram/three-atmosphere';
import { CloudLayer, CloudShape, CloudShapeDetail, CloudsEffect, Turbulence } from '@takram/three-clouds';
import {
  Ellipsoid,
  Geodetic,
  radians,
  STBN_TEXTURE_DEPTH,
  STBN_TEXTURE_HEIGHT,
  STBN_TEXTURE_WIDTH,
} from '@takram/three-geospatial';
import { patchSpectralGenerator, renderAtmosphere } from './spectralAtmosphere';
import { patchSunMarchLite, setGenusLight } from './cloudGenus';
import { patchMultiScatterCache, flowCamCellOffsetKm, flowCoverIn, genusCoverIn, genusEnvelope, genusLayerShape, makeGenusWeather, makeGenusWeatherAsync, mergeFlowOpts, morphCoverIn, morphShapeOpts, patchGenusShader, planFlowScene, setGenusFrame, setGenusDiffuse, setGenusLightFloors, setGenusPhysics, setGenusSkeleton, setGenusUniforms, setGrainKnobs, setLightingFix, setTsunShader, setTsunUniforms, type GenusKey, type GenusLayer, type GenusParams, GENUS } from './cloudGenus';
import { morphParamsOf } from './cloudMorph';
import { buildFarCoverGrids, buildFarSunMap, patchFarSunShader, setFarSunUniforms, type FarCoverGrids, type FarSunMap } from './farSun';
import { cellLanes, patchCellShader, setCellUniforms } from './cloudCells';
import { PREWARM_SLICE_MS } from '../../utils/sliderSettle';
import { EDGE_ROUGH_DEFAULT, patchEdgeShader, setEdgePixelRad, setEdgeRough } from './cloudEdge';
/**
 * §25.9 렌더가 구름 속 밀도를 남기는 몫(구름이 덮은 화소의 머리 위 기둥 τ 중앙값 ÷ 미세물리 tauRendered).
 * 하네스 측정(2026-11-26, 미세물리 · 흐름 · 세포 · 가장자리 거칠기 켬, 운량 0.6, 밀도 0.03 배 선형 구간):
 * 층적운 0.41, 고적운 0.38, 적운 0.20(대류 종류는 같은 값). 판 구름(st · as · ns)은 깎기가 약해 1.
 * 보정 배율은 1/남는 몫, 최대 2.5(적운 4.9 배는 탑이 과하게 짙어짐).
 */
export const PHYS_RENDER_KEEP: Partial<Record<string, number>> = { sc: 0.41, ac: 0.38, cu: 0.2, cg: 0.2, cb: 0.2 };
export function physRenderComp(genus: string): number {
  const k = PHYS_RENDER_KEEP[genus];
  return k ? Math.min(2.5, 1 / k) : 1;
}
/** §25.8 먼 거리 가림 지도가 시작하는 거리(km) — 해 쪽 추적은 지도가 켜지면 여기까지만 걷습니다. */
export const FAR_NEAR_KM = 12;
/** 해 쪽 추적 거리 상한(m) — 지도가 꺼져 있을 때. */
const SUN_MARCH_MAX_M = 40000;
import { BILLOW_DEFAULT, patchBillowShader, setBillowUniforms, type BillowParams } from './cloudBillow';
import { bakeWaveField, bakeWaveFieldAsync, patchWaveShader, setWaveDrift, setWaveUniforms, type WaveField, type WaveParams } from './cloudWave';
import { applyLightingFixAerial, applyLightingFixCloudsVertex, type LightingFixFlags } from './lightingFix';
import { archWeight, checkTsunSamplerBudget, TSUN_OPTIONS_OFF, tsunUniformValues, validateTsunAtlas, validateTsunOptions, type TsunAtlas, type TsunOptions } from './cloudTsun';
// §179 검토 반영(회귀 1): 구축기(tsunAtlas.ts)는 하네스(tools/genus-ruler/tsun/tsun-build.ts)만 부름 — 앱 묶음에는 형만(지워지는 import type).
import type { TsunBuildInput, TsunLaneInput } from './tsunAtlas';
import { GENUS_FLOW, type FlowSceneParams } from './cloudFlow';
import { iceLaneHand, layerPhysics, particleOpticalLane, type LayerPhysics, type ThermoInput } from './cloudPhysics';
import { skeletonOf, type SkeletonGenus } from './cloudSkeleton';
import { flowParam, patchFlowShader, setFlowUniforms, setGenusDrift, setGenusLife, setSkeletonTilt, GENUS_LS_AMT, GENUS_SHEET_B_GLSL } from './cloudFlowShader';
import { makeMacroLutTexture, makeMacroTexture, macroThresholdTable, patchMacroShader, setMacroDrift, setMacroMix, setMacroUniforms } from './macroShader';
import { buildMacroField, samplesFromRing, stepMacroState, type MacroField, type MacroSample, type MacroState } from '../../utils/macroField';
import { TERRAIN_DIST_GLSL } from '../SkyScene3D/SceneComposer';
import { SUN_RIDGE_DECODE_GLSL } from '../SkyScene3D/TerrainField';
import { LIT2_AMB_RANGE } from '../SkyScene3D/terrainLook';

export type VolumetricQuality = 'low' | 'medium' | 'high';
/** §140 low 프리셋 1차 행진 최소 보폭(m) — takram 기본 100 은 알갱이가 생김. */
export const LOW_MIN_STEP_M = 50;

export interface VolumetricPreset {
  key: string;
  label: string;
  lat: number;
  lon: number;
  heightM: number;
  iso: string;
  /** 시선 방위·고도·세로 시야(도) */
  az: number;
  el: number;
  fov: number;
  /** 층별 입력 운량 0~1 (저·중·상) — 예보 운량을 화면 면적으로 옮기는 보정은 아직 없습니다. */
  cover: [number, number, number];
  /** 층 밑면 높이(km) */
  altKm: [number, number, number];
  /** 노출(손으로 정함 — 자동 노출은 다음 단계) */
  exposure: number;
  /**
   * 층별 구름 종류(§124) — 종류별 모형을 켰을 때만 씁니다. 하나도 없으면 takram 기본으로 그립니다.
   * 후쿠이 두 장면(고적운, 7km·노을)은 비워 둡니다: 잔 조각(간격 350m)이 먼 거리에서 화소보다 작아져
   * 밉맵 평균이 문턱 아래로 떨어지고 반짝이만 남았습니다(§124.4) — 고칠 때까지 기본.
   */
  genus: [GenusKey | null, GenusKey | null, GenusKey | null];
}

/**
 * §126 일반 장면 입력 — 프리셋 대신 관측점·시각·예보 층으로 그립니다. 앱 하늘 화면이 넘길 형식입니다.
 * 층은 최대 4개(셰이더 채널 r·g·b·a). genus 가 null 인 층은 takram 기본 잡음으로 그립니다.
 */
export interface VolumetricLayerInput {
  genus: GenusKey | null;
  /** 아래에서 본 덮인 면적 비율 0~1 */
  cover: number;
  /** 밑면 높이(km, 해발) */
  baseKm: number;
  /** 두께(m). 없으면 종류 기본값(§124 GENUS.height), 종류가 없으면 층 띠 기본값 */
  thicknessM?: number;
  /** 층 띠(저·중·상) — 종류 없는 층의 두께·밀도와 그림자 지도 사용 여부를 정합니다. 없으면 밑면 높이로 가릅니다. */
  band?: 'low' | 'mid' | 'high';
  /** 종류 손잡이 덮어쓰기(씨앗·바람 방향 등) */
  opts?: Partial<GenusParams>;
  /** 장면 시각까지 바람에 밀려간 거리(동·북 km) — 그날 지방 자정부터 시간별 바람 적분(liveScene). 날씨 캐시 키에 들어가지 않음. 없으면 0. */
  driftKm?: [number, number];
  /** §136 물리(physics 켬)일 때의 밑면(km, 해발) — 적운류 = 지면 + 응결고도. 물리가 꺼져 있으면 쓰지 않습니다. */
  physBaseKm?: number;
}
export interface VolumetricSceneInput {
  lat: number; lon: number; heightM: number;
  date: Date;
  /** 시선 방위·고도·세로 시야(도) */
  az: number; el: number; fov: number;
  /** 카메라 전방 축 기준 기울기(도, 양수=시계방향). 적도의 추적 시뮬레이션용. */
  rollDeg?: number;
  /** 카메라 고도(m). 기본값은 지상 눈높이 2m */
  altitudeM?: number;
  layers: VolumetricLayerInput[];
  /** 노출. 없으면 해 고도로 정합니다(autoExposure). */
  exposure?: number;
  /** 종류 무늬의 원점을 관측점에서 동·북으로 옮김(km) — 큰 세포(적란운) 안에 서 있지 않게 장면을 고를 때 */
  weatherOffsetKm?: [number, number];
  /** §136 열역학 입력(지상 기온·이슬점·기압면 단면). 없으면 물리는 표준대기로 물러납니다. */
  thermo?: ThermoInput;
  /** §146 에어로졸(미세먼지·연무) 추가 흐림 — 대기 표에 없는 만큼(배경 AOD 초과분)만. 없으면 끔. */
  haze?: HazeInput;
  /**
   * §156 거시 운량 격자 입력 — 관측점 둘레 고리 예보(거리 km·방위 북 0° 시계방향·운량 0~1)를 층 띠마다. 옵션 `macro` 가 0 이면 무시.
   * 타일 운량은 그 띠 표본의 상위 분위수(150 km 안)로 올려 잡고, 셰이더가 자리마다 문턱으로 깎습니다(macroShader).
   */
  macro?: Partial<Record<'low' | 'mid' | 'high', MacroRingPoint[]>>;
  /** 다음 키프레임 시각의 거시 운량 격자 입력 — `macro` 와 `macroNext` 사이를 `macroSpanMs` 구간에서 부드럽게 보간합니다. */
  macroNext?: Partial<Record<'low' | 'mid' | 'high', MacroRingPoint[]>>;
  /** 거시 운량 격자 보간 구간 [시작 ms, 끝 ms] */
  macroSpanMs?: [number, number];
  /** 하루 전체(또는 다중 시간대) 띠별 타일 기준 운량 상한 — 정시 경계에서 2D 베이스 타일이 불필요하게 재합성되지 않도록 고정합니다. */
  tileCoverEnvelope?: Partial<Record<'low' | 'mid' | 'high', number>>;
}
export interface MacroRingPoint { distance: number; azimuthOffset: number; cover: number }

/**
 * §146 연무. 높이 H=1.5 km 로 지수 감쇠하는 에어로졸 층의 시선 광학두께로 하늘·구름·지형을 뿌옇게 합니다.
 * aod: 550nm 광학두께(배경 초과분) · alpha: Ångström 지수(클수록 푸른빛을 더 산란 — 초미세먼지) ·
 * g: 비대칭도(클수록 해 쪽으로 앞산란 — 조대 먼지) · omega: 단일 산란 반사율.
 */
export interface HazeInput { aod: number; alpha: number; g: number; omega: number }
export const HAZE_SCALE_HEIGHT_KM = 1.5;
/** 구름 자기 그림자 반폭(m) — 해 쪽으로 본 구름 앞 공기가 그 구름 그늘에 드는 길이 R/sinθ 의 R(2026-11-18). 층적운·적운 덩어리 반폭 정도. */
export const CLOUD_OWN_SHADOW_R_M = 1500;

/**
 * 해 고도 → 노출(§127 E2-3, 자 `tools/genus-ruler/genus/RULER-exposure.md`).
 *
 * 해 3° 위: 사진 312장의 맑은 하늘 휘도 중앙값(L 0.187, 사분위 0.112~0.280 — 카메라가 하늘을 약 18% 회색에 놓음)이
 * 되는 노출을 해 고도마다 잰 값(가나자와, 적운 30%, 시선 20°, 해 방위 +10·−80·−170° 의 중앙값, 하늘 화면과 같은
 * 텍스처 → sRGB 부호화 길). 이전 잠정값(해 20° 위 모두 10, 3° 약 27)은 해 50° 에서 L 0.349, 15° 0.326, 8° 0.403,
 * 3° 0.336 으로 사분위 위(너무 밝음)였습니다.
 * 해 3° 아래: 사진 자가 없어 사용자 사진 세 장면의 손 노출(1.1° → 30, −2.7° → 100)을 그대로 둡니다.
 * 밤은 1000 에서 멈춥니다.
 */
export const AUTO_EXPOSURE_POINTS: [number, number][] = [
  [50, 5.8], [30, 7.2], [15, 8.0], [8, 9.4], [3, 16.1], [1.1, 30], [0.0, 85], [-0.8, 130], [-2.7, 220], [-5.0, 950], [-8.0, 2400],
];
export function autoExposure(sunAltDeg: number): number {
  const pts = AUTO_EXPOSURE_POINTS;
  if (sunAltDeg >= pts[0][0]) return pts[0][1];
  if (sunAltDeg <= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a0, e0] = pts[i], [a1, e1] = pts[i + 1];
    if (sunAltDeg <= a0 && sunAltDeg >= a1) return Math.exp(Math.log(e0) + ((Math.log(e1) - Math.log(e0)) * (a0 - sunAltDeg)) / (a0 - a1));
  }
  return pts[0][1];
}

export function presetToInput(p: VolumetricPreset): VolumetricSceneInput {
  return {
    lat: p.lat, lon: p.lon, heightM: p.heightM, date: new Date(p.iso), az: p.az, el: p.el, fov: p.fov, exposure: p.exposure,
    layers: ([0, 1, 2] as const).map(i => ({ genus: p.genus[i], cover: p.cover[i], baseKm: p.altKm[i], band: (['low', 'mid', 'high'] as const)[i] })),
  };
}

/** 사용자 QR 기록에서 가져온 세 장면. */
export const VOLUMETRIC_PRESETS: VolumetricPreset[] = [
  {
    key: 'kz1029', label: '가나자와 10:29', lat: 36.5679, lon: 136.6774, heightM: 103, iso: '2026-10-03T01:29:00Z',
    az: 161.6, el: 13.9, fov: 60, cover: [0.3, 0, 0], altKm: [1.5, 4.5, 10], exposure: 10, genus: ['cu', null, null]
  },
  {
    key: 'fk1728', label: '후쿠이 17:28', lat: 36.0209, lon: 136.2894, heightM: 23, iso: '2026-10-02T08:28:00Z',
    az: 265, el: 12, fov: 60, cover: [0, 0.6, 0], altKm: [1.5, 7.0, 10], exposure: 30, genus: [null, null, null]
  },
  {
    key: 'fk1747', label: '후쿠이 17:47 잔광', lat: 36.0209, lon: 136.2894, heightM: 23, iso: '2026-10-02T08:47:00Z',
    az: 255, el: 20, fov: 60, cover: [0, 0.6, 0], altKm: [1.5, 7.0, 10], exposure: 100, genus: [null, null, null]
  },
];

export interface GLCapabilities {
  renderer: string;
  version: string;
  max3DTextureSize: number;
  colorBufferFloat: boolean;
  colorBufferHalfFloat: boolean;
  floatLinear: boolean;
  /** §179 WP0 조각 셰이더 텍스처 단위 수(MAX_TEXTURE_IMAGE_UNITS, WebGL2 최소 16) — T_sun 이 샘플러 하나를 더함(cloudTsun.ts checkTsunSamplerBudget). */
  maxTextureImageUnits: number;
}

export function readCapabilities(gl: WebGL2RenderingContext): GLCapabilities {
  const exts = gl.getSupportedExtensions() ?? [];
  const has = (n: string) => exts.includes(n);
  let rendererName = String(gl.getParameter(gl.RENDERER) ?? '?');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
  if (dbg) rendererName = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? rendererName);
  return {
    renderer: rendererName,
    version: String(gl.getParameter(gl.VERSION) ?? '?'),
    max3DTextureSize: Number(gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) ?? 0),
    colorBufferFloat: has('EXT_color_buffer_float'),
    colorBufferHalfFloat: has('EXT_color_buffer_half_float') || has('EXT_color_buffer_float'),
    floatLinear: has('OES_texture_float_linear'),
    // §179 검토 반영(회귀 5): 상수가 없는 GL 흉내(expo-gl 등)에서 getParameter(undefined) 가 INVALID_ENUM 을 남기지 않게 GL 값(0x8872)으로.
    maxTextureImageUnits: Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS ?? 0x8872) ?? 0),
  };
}

/** 0~1 반복 가능한 값 잡음 fbm (CPU, 256²). */
function tileableFbm(size: number, seed: number, basePeriod: number): Float32Array {
  const out = new Float32Array(size * size);
  const hash = (x: number, y: number, p: number) => {
    const s = Math.sin((((x % p) + p) % p) * 127.1 + (((y % p) + p) % p) * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  let amp = 0.5, total = 0;
  for (let o = 0, period = basePeriod; o < 4 && period <= size / 2; o++, period *= 2, amp *= 0.5) {
    total += amp;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = (x / size) * period, fy = (y / size) * period;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(fx - x0), ty = smooth(fy - y0);
      const a = hash(x0, y0, period), b = hash(x0 + 1, y0, period), c = hash(x0, y0 + 1, period), d = hash(x0 + 1, y0 + 1, period);
      out[y * size + x] += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/**
 * 지역 날씨: 층마다 같은 잡음장을 쓰고 문턱만 입력 운량으로 옮깁니다. 잡음을 **순위**(0~1 고른 분포)로 바꾼 뒤,
 * 셰이더 문턱(층 가운데 0.5)을 순위 1 − 운량 에 맞추고 그 위를 가파르게(×2) 올려 덩어리 속이 차게 합니다.
 * (fbm 값 그대로 쓰면 값이 가운데에 몰려 문턱 위가 옅은 막이 됩니다 — 웹 하네스에서 구름이 거의 안 보였음.)
 */
function makeWeather(cover: number[], o: VolumetricOptions): DataTexture {
  const N = 256;
  const noise = tileableFbm(N, 1.7, o.weatherPeriod);
  const order = Array.from(noise.keys()).sort((a, b) => noise[a] - noise[b]);
  const rank = new Float32Array(noise.length);
  order.forEach((idx, r) => { rank[idx] = r / (order.length - 1); });
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    for (let k = 0; k < 4; k++) {
      const c = cover[k] ?? 0;
      const v = c <= 0 ? 0 : 0.5 + (rank[i] - (1 - c)) * o.weatherRamp;
      data[i * 4 + k] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
  }
  const t = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearFilter; t.magFilter = LinearFilter;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * 1MB 외부 자산 없이 절차적으로 생성하는 시공간 블루 노이즈(STBN, Spatiotemporal Blue Noise).
 * 공간(x, y): Interleaved Gradient Noise + 3×3 주기적 고주파 반발(void-and-cluster 근사) + 순위 정규화로 균일 분포 보장.
 * 시간/깊이(z): 황금비(Golden Ratio φ⁻¹ ≈ 0.6180339887) 저불일치 수열 + 공간 순환 이동으로 프레임 간 수렴 속도를 극대화.
 */
let cachedStbnBytes: Uint8Array | null = null;
function makeWhiteNoise3D(): Data3DTexture {
  const W = STBN_TEXTURE_WIDTH, H = STBN_TEXTURE_HEIGHT, D = STBN_TEXTURE_DEPTH;
  if (!cachedStbnBytes) {
    const n2d = W * H;
    const base = new Float32Array(n2d);
    const refined = new Float32Array(n2d);
    let s = 12345;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const ign = (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1;
        base[y * W + x] = (ign + (s >>> 8) / 16777216 * 0.35) % 1;
      }
    }
    const wMask = W - 1, hMask = H - 1;
    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? base : refined;
      const dst = pass === 0 ? refined : base;
      for (let y = 0; y < H; y++) {
        const ym = ((y - 1) & hMask) * W, y0 = y * W, yp = ((y + 1) & hMask) * W;
        for (let x = 0; x < W; x++) {
          const xm = (x - 1) & wMask, xp = (x + 1) & wMask;
          const c = src[y0 + x];
          let push = 0;
          const nb = [
            src[ym + xm], src[ym + x], src[ym + xp],
            src[y0 + xm], src[y0 + xp],
            src[yp + xm], src[yp + x], src[yp + xp],
          ];
          for (let k = 0; k < 8; k++) {
            let d = c - nb[k];
            if (d > 0.5) d -= 1;
            else if (d < -0.5) d += 1;
            const wt = (k & 1) === 1 ? 0.14 : 0.07;
            push += (d >= 0 ? 0.5 - d : -0.5 - d) * wt;
          }
          let v = (c + push * 0.45) % 1;
          if (v < 0) v += 1;
          dst[y0 + x] = v;
        }
      }
    }
    const order = new Uint32Array(n2d);
    for (let i = 0; i < n2d; i++) order[i] = i;
    order.sort((a, b) => base[a] - base[b]);
    const rank2d = new Float32Array(n2d);
    const invN = 1 / n2d;
    for (let r = 0; r < n2d; r++) rank2d[order[r]] = (r + 0.5) * invN;

    const data = new Uint8Array(n2d * D);
    const PHI = 0.6180339887498949;
    for (let z = 0; z < D; z++) {
      const zOff = z * n2d;
      const zShift = (z * PHI) % 1;
      const sx = (z * 17) & wMask, sy = (z * 29) & hMask;
      for (let y = 0; y < H; y++) {
        const syRow = ((y + sy) & hMask) * W;
        const dstRow = zOff + y * W;
        for (let x = 0; x < W; x++) {
          const u0 = rank2d[syRow + ((x + sx) & wMask)];
          const u = (u0 + zShift) % 1;
          data[dstRow + x] = Math.min(255, (u * 256) | 0);
        }
      }
    }
    cachedStbnBytes = data;
  }
  const t = new Data3DTexture(cachedStbnBytes, W, H, D);
  t.format = RedFormat; t.type = UnsignedByteType;
  t.minFilter = NearestFilter; t.magFilter = NearestFilter;
  t.wrapS = t.wrapT = t.wrapR = RepeatWrapping;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * 렌더러(WebGL 컨텍스트)별 15파장 대기 산란 LUT(Transmittance / Scattering / Irradiance) 캐시.
 * 대기 물리 상수는 불변이므로 같은 WebGLRenderer 내에서는 최초 1회만 GPU 셰이더 적분을 수행하고 이후 즉시 재사용합니다.
 */
const atmosGeneratorCache = new WeakMap<
  WebGLRenderer,
  Map<string, { generator: PrecomputedTexturesGenerator; spectral: boolean }>
>();
const cloudNoiseCache = new WeakMap<
  WebGLRenderer,
  { shape: CloudShape; shapeDetail: CloudShapeDetail; turbulence: Turbulence; stbn: Data3DTexture }
>();

/** 종류별 모형의 날씨 텍스처 한 장이 덮는 길이(km). 512 칸이면 47m/칸. */
const GENUS_TILE_KM = 24;

/** 시험용 손잡이 — 기본값은 기기 시험판 그대로. */
export interface VolumetricOptions extends TsunOptions {
  /** 날씨 잡음의 가장 굵은 주기(256 칸 타일 한 장에 몇 번). 클수록 구름 덩어리가 잘다. */
  weatherPeriod: number;
  /** 문턱 위 경사 — 클수록 덩어리 속이 고르게 찬다. */
  weatherRamp: number;
  /** 층 그림자 지도를 켜는 해 고도 하한(°). */
  /**
   * 층 그림자 지도(BSM)를 켜는 해 고도 하한(°). 웹 하네스(SwiftShader)에서는 해 7° 아래에서 NaN 으로 구름이
   * 사라졌습니다(12.7° 는 정상) — 기기 GPU 에서도 그런지는 시험 화면의 "그림자 지도 켜기"로 봅니다.
   */
  shadowMinSunDeg: number;
  /** 합성 버퍼 형식 — 'half' | 'float'. */
  bufferType: 'half' | 'float';
  /** 장면 좌표 — 'local'(관측점 북·위·동 + worldToECEF) | 'ecef'(takram 기본: 카메라를 ECEF 에 둠). */
  frame: 'local' | 'ecef';
  /** 그림자 지도가 덮는 최대 거리(m) — null 이면 takram 기본(카메라 far × farScale). */
  shadowMaxFar: number | null;
  /** 구름 그림자를 대기(빛줄기·그림자 길이)에 넘길지. */
  atmosphereShadow: boolean;
  /** 시간 업스케일(1/16 화소씩). 끄면 매 프레임 전 화소를 행진합니다. */
  temporalUpscale: boolean;
  /** 그림자 지도의 시간 필터(TAA). */
  shadowTemporal: boolean;
  /**
   * 해 쪽 2차 행진 — takram 기본(걸음 2번 · 첫 걸음 100m · ×2 → 300m 안쪽)은 큰 그늘을 그림자 지도에 맡깁니다.
   * 그림자 지도 없이도 덩어리 그늘이 나도록 수 km 를 걷게 합니다(걸음 수 · 첫 걸음 m · 걸음 배율).
   */
  sunMarch: [number, number, number] | null;
  /**
   * 구름 종류별 형태 모형(§124, cloudGenus.ts). 끄면 takram 기본(같은 잡음을 운량 문턱으로 자름) — 시험 화면에서
   * 둘을 번갈아 봅니다.
   */
  genus: boolean;
  /** takram 이 해·달 원반을 그릴지. 하늘 화면(§126.7)은 앱의 해·달 메시를 쓰므로 끕니다. */
  celestial: boolean;
  /**
   * §127 C5 종류 날씨의 거리 밉 단계. takram 은 지상 카메라에서 날씨 텍스처를 사실상 밉 0 으로 읽어(높이 비례로 끔)
   * 먼 고적운(간격 350m)이 화소보다 작아지면 반짝이만 남았습니다(§124.5). 켜면 표본까지 거리 × 화소 각 ÷ 시선의 층 기울기로
   * 밉 단계를 정해 먼 곳은 평균 덮임이 됩니다. 값은 밉 치우침(log2) — null 이면 끔.
   */
  weatherLod: number | null;
  /**
   * §127 G4c — 해가 이 고도(°)보다 낮으면 품질 단계와 무관하게 구름 표본마다 해·하늘빛을 셉니다(takram
   * accurateSunSkyLight). low·medium 은 이것을 끄고 **관측점 바로 위** 층 높이의 빛을 모든 구름에 씁니다 — 해가 관측점
   * 지평선 아래로 가면 해 쪽 먼 구름(아직 햇빛을 받음)까지 어두운 적갈색이 됐습니다. null 이면 품질 단계 그대로.
   */
  accurateSunBelowDeg: number | null;
  /**
   * §127 G4c — 구름 행진 최대 거리(km). 품질 low 는 100km 에서 끊습니다. 해 진 뒤 빛을 받는 구름은 대개 서쪽 지평선
   * 근처 100~300km 에 있습니다(권운 9km 는 150km 에서 고도 약 2.8°). null 이면 품질 단계 그대로.
   */
  maxRayKm: number | null;
  /** §127 종류별 운량 → 화면 면적 역표(`GENUS_COVER_REMAP`)를 쓸지 — 하네스가 고치기 전과 견줄 때만 끕니다. */
  coverRemap: boolean;
  /**
   * §130 대기 흐름 구름 모형(cloudFlow.ts) — 날씨 원시장을 "정적 도형의 합집합" 대신 **한 2-D 순압 와도 흐름이 변형한
   * 종류별 템플릿 + 대규모 수분장 + 전단파**로 만듭니다. 운량 분위수 문턱은 그대로(위에서 본 면적 = 운량). 기본 끔 —
   * 자(RULER-flow)와 운량 역표 재맞춤을 통과하면 켭니다. 비교 플래그이며 날씨 캐시 키에 들어갑니다.
   */
  flow: boolean;
  /** §130 C2 — 흐름 층의 연속 밀도(LWP 돔·d^0.5·낮춘 소광·부드러운 침식·광학두께 AO 대리값). flow 가 켜졌을 때만. */
  flowDensity: boolean;
  /** §130 C3 — 층별 바람 드리프트·전단 기울임 fetch(날씨 표본마다 fetch 4번). 기기 frameMs(+15 % 이하)를 잰 뒤 정합니다. */
  flowUv: boolean;
  /** §130 흐름 핵: 격자(64 | 128) · 반라그랑주 걸음 수 · 의사시간(h, 0.7 넘으면 대리석 무늬) · 에디 rms 속도(m/s) · Poisson 갱신 간격. */
  flowN: 64 | 128;
  flowSteps: number;
  flowHours: number;
  flowVrms: number;
  flowPsiEvery: number;
  /**
   * §131 수분장 q₀: 0 = 1회차 가우스(64², H 1), 1 = 가우스 분수 적분(flowQN², H = flowQH), 2 = 로그정규 캐스케이드 + 분수 적분
   * (RULER-flow2 Q1·Q2). 날씨 캐시 키에 들어갑니다.
   */
  flowQMode: 0 | 1 | 2;
  flowQN: 64 | 128;
  flowQH: number;
  /** §131 변형 게이트: > 0 이면 라벨맵 왜곡 s90 이 이 값에 닿을 때까지(0.25~1.2 h) 굴림(RULER-flow2 R2). 0 = 끔 */
  flowS90: number;
  /** §131 카메라 칸 조건화: 관측점을 국소 운량 ≈ 전역 운량인 칸 아래로(weatherOffsetKm 이 없을 때만, 타일 바이트 불변). RULER-flow2 K 통과로
   *  흐름 경로의 기본(flow 가 꺼져 있으면 아무 일도 하지 않음). */
  flowCamCell: boolean;
  /**
   * §136 구름 미세물리 1단계(cloudPhysics.ts) — 종류 층의 소광을 기온·기압에서 센 β(층 꼭대기)로, 세로 단면을 단열 h^(2/3)(얼음 층은
   * 평평)으로 바꾸고, 장면 입력의 physBaseKm(적운류 응결고도 밑면)을 씁니다. 날씨 텍스처는 그대로(층 값·균일변수만 바뀜).
   * 자: tools/genus-ruler/flow/RULER-physics.md(P1).
   */
  physics: boolean;
  /** §136 P2 — physics 위에 얼음 층 22°·46° 무리(구름 패스 첫 산란 차수)와 얇은 층 가루 효과 끔. physics 가 켜졌을 때만. */
  physicsIce: boolean;
  /**
   * §25.9 미세물리 렌더 보정: 날씨 무늬 · 모양 잡음 · 깎기가 구름 속 밀도를 평균으로 깎는 몫(PHYS_RENDER_KEEP)을 되돌려
   * 구름이 덮은 곳의 기둥 τ 중앙값이 미세물리 tauRendered 가 되게 합니다. physics 가 켜졌을 때만. 기본 켬.
   */
  physicsRenderComp: boolean;
  /**
   * §137 H1 — **물리 없이**(소광·단면은 손값) 얼음 종류(ci·cs·모루) 층에만 22°·46° 무리. 무리 상수는 physicsIce 와 같음. physics+physicsIce 가 켜져 있으면 그쪽이 우선.
   * 얼음 층이 없는 장면은 켜 두어도 셰이더·균일변수가 끈 것과 같음.
   */
  iceHalo: boolean;
  /** §137 H2 — 얼음 층(ci·cs)의 가루 효과 끔만(무리 없음). 가루 끔과 무리를 따로 재려고 나눔. */
  icePowderOff: boolean;
  /** §137 D1 진단 전용 — 조명 바닥값 [하늘빛 가림 0.35, 다중 산란 0.28] 치환. null = 끔(기본, 셰이더 글자 그대로). 기본값을 바꾸는 용도가 아님. */
  debugLightFloors: [number, number] | null;
  /**
   * §138 구름 속 확산광(RULER-physics3). 0 = 끔(기본, 셰이더 글자 그대로) · 1 = L1 thru 의 τ_up 을 기둥 광학두께로 · 2 = L2 두-흐름 확산장이 thru 를 대체 ·
   * 3 = L3 L2 + 하늘빛 항을 기둥 τ 로 감쇠(ao·바닥값 은퇴). 구름 패스에만 삽입하고, 0 이면 삽입 전 원문으로 되돌립니다.
   */
  diffuse: 0 | 1 | 2 | 3 | 4 | 9;
  /**
   * §139 구름 뼈대(cloudSkeleton.ts, RULER-shape). 0 = 끔(기본 — 날씨 바이트·셰이더 글자 그대로) · 1 = K0h 대조군(옛 무늬, 층 밑면·두께만 뼈대) ·
   * 2 = K1 뼈대(열기둥 자리·폭·깊이·뚜껑 단면·봉투 거리 밀도) · 3 = K2 = K1 + 전단 기울기(흐름 S4 fetch 레인) · 4 = K3 = K1 + 열기둥별 변이(세기·종·생애 단계·비대칭,
   * 스커트 없음 — cloudSkeleton.VARY). cu·cg·sc 층만, flow 와 함께 쓰면 throw.
   */
  skeleton: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** §156 거시 운량 격자: 0 끔 · 1 Barnes 만(RULER-macro 후보 B) · 2 스펙트럼 잡음까지(V). 입력 `macro` 가 있어야 켜집니다. */
  macro: 0 | 1 | 2;
  /** 거시 격자 변(2 의 거듭제곱). 768 km 를 덮으므로 128 = 6 km 칸. */
  macroN: number;
  /**
   * §171 옛 거시 기울기(§132 두 수: 100 km 당 동·북 운량 변화율을 셰이더에서 타일 운량에 곱함). 기본 끔(사용자 결정 2026-10-28) —
   * §156 거시 격자가 같은 일을 자리별로 하므로 그 위에 겹쳐 걸리던 것. 켜면 이전과 같은 바이트(비교용).
   */
  macroGrad: boolean;
  /** §139 진단 전용 — K2 전단 기울기 배율(기본 1). 자의 후보가 아니라 fetch 레인 단위 확인용. */
  skeletonTiltScale: number;
  /** §141 진단: 모든 종류 층의 밀도 단면 밑면 값을 이 값으로(null 이면 종류별 GENUS.profileBase 또는 takram 0.25). */
  profileBase: number | null;
  /**
   * 연속 형태 생성기(cloudMorph) — 저층(band low, 적란운 제외)의 무늬를 종류 프리셋 대신 예보 연속량(대류성·얼음·바람·전단)으로 만듭니다.
   * 기본 끔(끄면 날씨 바이트 그대로). flow·skeleton 이 켜져 있으면 그쪽이 우선이고 morph 는 쓰지 않습니다(앱 화면이 throw 로 깨지지 않게).
   */
  morph: boolean;
  /** 뭉게구름(cu·cg·cb)·층적운(sc) 표면 혹 깎기(cloudBillow, docs/WAVE_FIELD_DESIGN.md §8). 해 쪽 추적은 부르는 쪽이 촘촘히 겁니다(BILLOW_SUN_MARCH). */
  billow: boolean;
  /** 고적운·층적운 세포 무늬(cloudCells, 계획 §24.11) — 흐름 모형 위에서만. 기본 켬. */
  cells: boolean;
  /** 구름 가장자리 기본 거칠기(cloudEdge, 계획 §26) — 구름 문턱을 fBm 으로 흔드는 세기(날씨 값 단위, 0 = 끔). 모든 종류 공통. */
  edgeRough: number;
  /**
   * 구름 빛(계획 문서 §25). 'physical' = 해 쪽 직선 추적을 구름층 꼭대기까지(고도 문턱 없음) · 운량으로 판 확산 섞기 · 그늘 하늘빛을 위쪽 기둥 두께로.
   * 구름 자기 그늘에 그림자 지도를 쓰지 않으므로, 빛줄기가 꺼진 품질(low)에서는 그림자 지도 패스를 건너뜁니다. 'legacy' = 예전(takram 짧은 행진 + 그림자 지도).
   * 종류 모형(genus)이 켜져 있을 때만 의미가 있습니다.
   */
  cloudLight: 'physical' | 'legacy';
  /** 노을 3단계: 먼 거리 햇빛 가림 지도(farSun.ts). 해 10° 아래 · 장면에 고리(macro) 있을 때만. */
  farSun: boolean;
  /** 구름 아래 공기 그늘 싼 근사(low·medium, 빛줄기 없을 때). 기본 켬. */
  cloudAirShade: boolean;
  /** 밤 달빛(2026-11-13): 해가 −10° 아래이고 달이 떠 있으면 빛 방향·세기를 달로 바꿈(구름·하늘·그림자 모두 같은 길) */
  moonLight: boolean;
  /**
   * RULER-grain §8.2 알갱이 손잡이(전부 기본 끔 — 끄면 셰이더 글자·균일변수·층 값이 측정 번들과 같음, cloudGenus.ts `setGrainKnobs`).
   * E1b — 1차 행진에서 광선당 한 번, 첫 적중 표본을 직전 증분 Δ 만큼 되감아 h = max(50 m, Δ/8) 보폭으로 최대 8 표본 다시 걷기(구름 패스).
   */
  refineOnHit: 0 | 1;
  /** E2b — 해 쪽 행진(marchOpticalDepth)의 i ≥ 1 표본은 모양 텍스처 대신 shape = 0.797(구름 패스, 표지는 함수 뒤 되돌림). */
  sunLowpass: 0 | 1;
  /** E3(1) — 모양 침식을 평균 보존 곱 d·clamp(1 + e·0.35·(s − 0.7906)/0.0785, 0, 2)(두 패스) · E3b(2) — E3 + 구름 패스 화소 발자국 페이드(150~600 m). */
  erodeCentered: 0 | 1 | 2;
  /** E3b 화소 각(°) — null 이면 기기 가운데 텍셀 0.0566°(모든 틀 같음). 균일변수 `erodePixelAngle`(erodeCentered 2 일 때만 있음). */
  erodePixelAngleDeg: number | null;
  /** E4 — 1차 행진 지터를 IGN + 0.618·(frame % 64) 로(구름 패스만, 그림자 패스는 백색 잡음 그대로). */
  jitterMode: 0 | 1;
  /** E3c 진단 전용 — setScene 의 층 CloudLayer.densityScale 에 곱함(기본 1 = 손대지 않음). 채택 대상 아님. */
  debugDensityMul: number;
  /**
   * 시간 업스케일에서 새 표본의 무게(2026-11-26, 알갱이 잡음). takram 은 이번 프레임에 그린 화소를 이력 없이 그대로 써서(1 = takram)
   * 화소마다 표본 하나(행진 지터 잡음)가 그대로 남습니다. < 1 이면 같은 화소의 이력(재투영 · 분산 자르기)과 섞어 표본을 평균합니다.
   */
  cloudAccum: number;
  /**
   * §178 (e) 대기 원근 산란(GetSkyRadianceToPoint)을 0 에서 자름 — 구름 패스와 대기 효과(지형 빛 판) 둘 다. 깊은 박명(해 ≲ −9°)에 낮은 고도의
   * 높은 덮개가 음수 산란으로 검게 그려지던 결함(§177.6). 끄면 셰이더 글자가 고치기 전과 같음(A/B 용).
   * 여기 기본값은 끔(하네스 관례: 동결된 grain·tsun 꾸러미가 새 손잡이를 기본 0 으로 받음) — 앱은 SkyScene3D·VolumetricProbe 가 켜서 넘깁니다(사용자 승인 기본 켬).
   */
  clampInscatter: boolean;
  /**
   * §178 (f) GetIrradiance 의 μs 축을 로그 선형으로 읽음(lightingFix.ts) — 구름 패스 정점·조각, 대기 효과. 박명 하늘빛이 1.3~1.95 배 밝고 1.83° 주기로
   * 출렁이던 결함(§177.6). 이웃 텍셀 비로 log 가중(2 배 이하 선형 · 4 배 이상 log). 끄면 셰이더 글자가 고치기 전과 같음(A/B 용).
   * 기본값은 clampInscatter 와 같이 여기서는 끔, 앱 길에서 켬.
   */
  irradianceLogMu: boolean;
  /** 앱 런타임 전용: 맑음↔흐림 전환마다 genusPhysOn 셰이더 코드가 재컴파일되지 않도록 상시 적재하고 유니폼(0/1)만 토글합니다. 하네스 기본은 false. */
  keepIceShaderLoaded: boolean;
  // §179 T_sun·아치 빛 손잡이(tsun·tsunN·tsunRangeKm·archLight·archNoT·tsunRef·tsunRefStepM·tsunDebug·tsunSync)는 cloudTsun.ts TsunOptions —
  // 하네스 전용, 기본 끔(TSUN_OPTIONS_OFF), 앱은 넘기지 않음. 끄면 셰이더 글자·균일변수·텍스처가 이 손잡이가 없던 트리와 같음.
}
/** 시간 업스케일 누적 — 새 표본 무게(`cloudAccum`). 0.25 ≈ 최근 표본 ~7 개 평균. */
export const CLOUD_ACCUM_DEFAULT = 0.25;
export const DEFAULT_VOLUMETRIC_OPTIONS: VolumetricOptions = { weatherPeriod: 16, weatherRamp: 2, shadowMinSunDeg: 12, bufferType: 'half', frame: 'local', shadowMaxFar: null, atmosphereShadow: true, temporalUpscale: true, shadowTemporal: true, sunMarch: [6, 250, 1.6], genus: false, celestial: true, weatherLod: null, accurateSunBelowDeg: null, maxRayKm: 100, coverRemap: true, flow: false, flowDensity: true, flowUv: false, flowN: 64, flowSteps: 20, flowHours: 0.5, flowVrms: 2, flowPsiEvery: 2, flowQMode: 0, flowQN: 128, flowQH: 0.5, flowS90: 0, flowCamCell: false, physics: false, physicsIce: false, physicsRenderComp: true, iceHalo: false, icePowderOff: false, debugLightFloors: null, diffuse: 0, skeleton: 0, skeletonTiltScale: 1, profileBase: null, macro: 0, macroN: 128, macroGrad: false, morph: false, billow: false, cells: true, edgeRough: EDGE_ROUGH_DEFAULT, cloudLight: 'physical', farSun: true, cloudAirShade: true, moonLight: true, refineOnHit: 0, sunLowpass: 0, erodeCentered: 0, erodePixelAngleDeg: null, jitterMode: 0, debugDensityMul: 1, cloudAccum: CLOUD_ACCUM_DEFAULT, clampInscatter: false, irradianceLogMu: false, keepIceShaderLoaded: false, ...TSUN_OPTIONS_OFF };

export interface VolumetricScene {
  camera: Camera;
  setPreset(p: VolumetricPreset): void;
  /** 일반 장면 입력(§126). setPreset 은 이것의 얇은 포장입니다. 날씨 텍스처를 만들므로(캐시에 없으면) 층이 바뀔 때만 부릅니다. */
  setScene(input: VolumetricSceneInput): void;
  /**
   * §127 setScene 의 비동기판 — 날씨를 잘라 만드는 동안 이전 장면을 계속 그립니다(폰에서 JS 를 1초 넘게 막지 않게).
   * 더 새 setScene/setSceneAsync 가 오면 버려지고 false. isFast 가 참이면 드래그 중 S=128 초고속 모드로 생성합니다.
   */
  setSceneAsync(input: VolumetricSceneInput, isFast?: boolean, sliceMs?: number): Promise<boolean>;
  /** 해당 장면의 날씨·파동 텍스처가 이미 캐시에 있어 0ms 동기 전환 가능한지 확인합니다. */
  hasCachedScene?(input: VolumetricSceneInput, isFast?: boolean): boolean;
  /** 날짜/날씨 변경 시 하루치 여러 시간대(24h)의 날씨·파동 텍스처를 미리 구워 캐시에 적재합니다. */
  prewarmScenesAsync?(
    inputs: VolumetricSceneInput[],
    shouldAbort?: () => boolean,
    onProgress?: (done: number, total: number) => void,
    shouldPause?: () => boolean,
    /** 끄는(상호작용) 동안에도 굽기 — 조각을 PREWARM_SLICE_MS.interacting 으로 짧게. 기본 거짓(예전처럼 멈춤). */
    allowWhileInteracting?: boolean,
  ): Promise<number>;
  /** 진행 중인 setSceneAsync 생성을 즉시 취소합니다(슬라이더 조작 완료 직후 등). */
  cancelAsync?(): void;
  /** 시선 및 고도만 바꿉니다(매 프레임 싸게). */
  /** offsetYFrac: 화면 중심을 세로로 옮긴 몫(three 카메라 setViewOffset 과 같은 값, −0.45~0.45). 하늘 화면 카메라와 맞춰야 구름·해/달 빛이 겹침. */
  setView(az: number, el: number, fov: number, altitudeM?: number, rollDeg?: number, offsetYFrac?: number): void;
  /**
   * 눈이 장면 원점(관측 위치)에서 가로로 떨어진 거리(m, 북 · 동) — 연속 이동 조이스틱이 눈을 옮기는 동안 구름 · 대기 카메라도 같이 옮깁니다.
   * 장면(구름 층)은 원점 기준 그대로라, 눈이 가면 구름이 그만큼 시차로 움직입니다. 값이 같으면 아무것도 안 합니다.
   */
  setEyeOffset?(northM: number, eastM: number): void;
  /** 시각만 바꿉니다(해 방향·노출·바람 드리프트). driftSec 는 §155 바람 드리프트 시각(초), 없으면 date. */
  setDate(date: Date, driftSec?: number): void;
  /** 2D 베이스 타일 재생성 없이 연속 보간된 층 높이·두께·밀도·연무·거시 격자 키프레임을 부드럽게 갱신합니다. */
  updateContinuousScene?(input: VolumetricSceneInput): void;
  /** 도시 불빛 세기 0~1(광공해 설정: 6.5 등급 0 ~ 3 등급 1). 매 프레임 불러도 됨(값이 같으면 아무것도 안 함). */
  setCityLight(v: number): void;
  /** 개발자 튜닝 노출 배율(기본 1.0). 매 프레임 불러도 됨(값이 같으면 아무것도 안 함). */
  setExposureScale(s: number): void;
  /** 장노출 시 지형·건물 도시광 과노출 억제 배율(pow(gain, 0.65)/gain). */
  setCityTerrainExpScale?(s: number): void;
  /** 장노출 다중 스텝 누적 중 16프레임 TAA 잔상 고정(temporalUpscale)을 잠시 끄고 매 스텝 구름 이동을 즉시 반영합니다. */
  setAccumulating?(active: boolean): void;
  /** 밤 불빛 지도(cityLightMap.ts). 있으면 도시 쪽 지평선·도심 위 구름만 더 밝게. null 이면 고르게. */
  setCityMap(m: NightLights | null): void;
  /**
   * 화면 대신 텍스처로 그립니다(§126.7 — 하늘 화면 합성기가 하늘 층으로 씁니다). 반환 텍스처는 다음 호출까지 유효.
   * rgb 는 톤매핑 뒤 **선형** 색(하늘 + 구름 — 화면에 낼 때 sRGB 로 부호화해야 함, §127: §126.8 은 이것을 빠뜨려
   * 하늘 화면이 어둡고 채도가 높았음), **알파는 구름 불투명도**(1 − 투과율) — 합성기가 천체를 구름 뒤로 보내고
   * 지형 앞 구름을 다시 얹는 데 씁니다. 지형 거리 판을 넘겼으면 지형 화소의 하늘은 검게(지형 앞 구름만) 그립니다.
   */
  renderToTexture(deltaSec: number): Texture;
  /**
   * §127 지형 거리 판(SceneComposer.terrainDistanceTexture, 원해상도·log2 거리 부호화). 주면 구름 행진이 지형에서
   * 멈춰 산 뒤 구름이 사라지고, 지형 화소의 하늘을 검게 남깁니다. **같은 프레임**의 판이어야 시선을 돌릴 때 능선이
   * 밀리지 않습니다(SceneComposer.prepareTerrainDistance 를 먼저 부름). null 이면 지형을 모름(예전처럼 구름은 늘 지형 뒤).
   * lit(§129, SceneComposer.terrainLitTexture — 알베도·햇빛 몫)을 주면 지형 화소를 검게 비우는 대신 takram 의 해·하늘 조도와
   * 대기 원근으로 칠하고 알파 1 로 냅니다(합성기의 지형 앞 덮기가 지형을 통째로 바꿈).
   */
  setTerrainDistance(tex: Texture | null, lit?: Texture | null, sunRidge?: Texture | null, seaSlopeVar?: number, lit2?: Texture | null): void;
  /** 마지막으로 그린 장면의 해 고도(°)와 쓴 노출 — 시험 화면 표시용. */
  lastScene(): { sunAltDeg: number; exposure: number } | null;
  /** 품질 단계를 겁니다. 구름 해상도 배율은 바꾸지 않습니다(§169 — 해상도는 setResolutionScale 몫). */
  setQuality(q: VolumetricQuality): void;
  /** 상호작용 중(드래그/줌) 레이마칭 보폭·2차 해 행진을 낮춰 응답성을 높이고, 떼면 원복합니다. */
  setInteracting?(active: boolean, deferFarSun?: boolean): void;
  setResolutionScale(s: number): void;
  /** §169 지금 실제로 쓰는 구름 해상도 배율(takram resolutionScale) — 성능 표시용. */
  resolutionScale(): number;
  /** 손잡이를 바꾸고 지금 장면에 다시 겁니다. */
  /** 옵션을 바꿉니다. reapply=false 면 장면을 다시 걸지 않습니다(호출자가 setSceneAsync 로 다시 만듦 — §130 흐름 날씨는 동기로 만들면 수 초 멈춤). */
  setOptions(o: Partial<VolumetricOptions>, reapply?: boolean): void;
  render(deltaSec: number): void;
  setSize(width: number, height: number): void;
  dispose(): void;
  /** 마지막 날씨 텍스처 생성 시간(ms). */
  weatherMs(): number;
  /** §131 진단: 흐름 핵의 왜곡 s90·실제 의사시간(h), 카메라 칸 오프셋(km) — 흐름이 꺼졌으면 null 들 */
  flowInfo(): { s90: number | null; hoursUsed: number | null; camKm: [number, number] | null };
  /** 파동 합성 장 진단(굽는 시간·문턱·잰 운량) — 꺼져 있으면 null */
  waveInfo(): Record<string, number> | null;
  /** 먼 거리 햇빛 가림 진단 */
  farInfo(): Record<string, number> | null;
  /** 구름 아래 공기 그늘 비율(0~1) */
  airShade(): number;
  cityInfo(): { artCd: number; baseCd: number; adaptCd: number; timeF: number } | null;
  /** §136 진단: 마지막 장면의 층별 물리 값(β·τ·얼음·무리·가루) — 물리가 꺼져 있으면 null */
  physicsInfo(): (LayerPhysics | null)[] | null;
  /**
   * §179 T_sun 아틀라스를 겁니다(하네스 전용 — 구축기 WP2 의 출력, 형식은 cloudTsun.ts TsunAtlas). null 이면 '아틀라스 없음'(gTsunOn 0 = C0ps 빛).
   * 옵션(tsunN·tsunRangeKm·archLight)·지금 장면(tsunSceneSerial)과 안 맞으면 throw. 텍스처는 부른 쪽이 소유(dispose 하지 않음). applyScene 은 아틀라스를 버림.
   */
  setTsunAtlas(atlas: TsunAtlas | null): void;
  /** §179 지금 장면 번호 — applyScene 마다 1 씩 오름. 아틀라스는 이 값을 sceneSerial 로 들고 와야 함. */
  tsunSceneSerial(): number;
  /** §179 T_sun 상태(하네스 meta·렌더 전 확인용). */
  tsunInfo(): TsunInfo;
  /**
   * §179 하네스 구축(tools/genus-ruler/tsun/tsun-build.ts)이 받을 입력 — 지금 장면의 종류 틀·해·레인·거시 격자. 종류 장면이 아니면 null.
   * (§179 검토 반영 회귀 1: 처음 판의 자동 동기 구축 setTsunFixture 는 앱 묶음에 구축기를 실었음(+51 KB 축소 [measured]) — 하네스로 옮김.)
   */
  tsunBuildInput(): TsunBuildInput | null;
  /** 진단용 — 하네스에서만 씁니다. */
  debug: { clouds: CloudsEffect; toneMapping: ToneMappingEffect };
  /** §128 대기 표가 파장 15개(분광 휘도)인지 — false 면 takram 3파장. */
  readonly spectral: boolean;
}

/** §179 T_sun 상태(tsunInfo) — injected = 글자가 들어감(tsun 1 · 해 ≤ shadowMinSunDeg), atlasValid = gTsunOn 1. */
export interface TsunInfo {
  enabled: boolean; injected: boolean; arch: boolean; belowShadow: boolean | null; atlasValid: boolean; reason: string | null;
  /** §179 WP6·WP8 기준 팔(0 · 1 REF_v2 · 2 REF_val)·진단(0 · 1 D-1) — injected 는 T 팔 또는 REF 팔의 글자가 들어간 상태. */
  ref: number; debug: number;
  archW: number; samplers: { count: number; limit: number; limitKnown: boolean } | null; sceneSerial: number;
  atlasMeta: TsunAtlas['meta'] | null;
}

/**
 * 장면을 만듭니다. 대기 표 생성이 끝날 때까지 기다립니다(실패하면 throw — float 렌더 타깃을 못 쓰는 기기).
 */
export async function createVolumetricScene(
  renderer: WebGLRenderer, width: number, height: number,
  options: Partial<VolumetricOptions> & {
    /** 하네스 전용 — 미리 만든 대기 표(takram PrecomputedTexturesLoader). 없으면 기기에서 만듭니다. */
    precomputed?: Record<string, unknown>;
    /**
     * §128 대기 표를 파장 15개로(Bruneton 의 휘도 미리 계산). 3파장 표는 박명 하늘이 자주색이 됩니다(spectralAtmosphere.ts).
     * 기본 켬. 미리 만든 표(`precomputed`, takram 자산 = 3파장)를 넘기면 끕니다.
     */
    spectral?: boolean;
    /**
     * §128 해 직달빛·대기 원근 투과율을 태양 분광 × 등색 함수 가중 평균으로(기본 켬). 끄면 원 모형처럼 680·550·440nm 인데,
     * 휘도 표에서 그 투과율을 빼는 대기 원근이 먼 구름 아래 지평선을 청록색으로 남깁니다.
     */
    effectiveTransmittance?: boolean;
  } = {},
): Promise<VolumetricScene> {
  // ⚠ expo-gl(React Native) 대응:
  // three.js의 readRenderTargetPixelsAsync는 WebGL2 PBO를 사용해 gl.readPixels(..., 0) 및 fenceSync를 호출합니다.
  // expo-gl은 PBO offset 인자(ARG(6) Object 기대)와 fenceSync를 지원하지 않아 JSI에서
  // "Value is a number, expected an object" 예외가 발생합니다.
  // takram 대기 생성기의 CPU 픽셀 데이터(userData.imageData)는 GPU 셰이더 샘플러를 쓰는
  // CloudsEffect/AerialPerspectiveEffect에서 전혀 쓰이지 않으므로, 버퍼를 즉시 반환하여 통과시킵니다.
  if (renderer.readRenderTargetPixelsAsync) {
    renderer.readRenderTargetPixelsAsync = async function (
      _rt: unknown, _x: number, _y: number, _w: number, _h: number, buffer: any,
    ) {
      return buffer;
    };
  }
  const opt: VolumetricOptions = { ...DEFAULT_VOLUMETRIC_OPTIONS, ...options };
  // §179 T_sun 손잡이 점검(정해진 값·의존 — 하네스가 잘못 준 팔이 조용히 C0 이 되지 않게).
  validateTsunOptions(opt);
  /** §178 조명 결함 고침 플래그(lightingFix.ts) — 옵션에서 읽음. */
  const lightingFlags = (): LightingFixFlags => ({ clampInscatter: !!opt.clampInscatter, irradianceLogMu: !!opt.irradianceLogMu });
  const baseMarch = { n: 0, step: 0, scale: 0 };
  const camera = new PerspectiveCamera(60, width / height, 1, 1e7);
  const scene = new Scene();

  // §128 분광 표면 하늘 환산 상수가 683(상대)입니다 — 표를 만들기 전에 효과를 만들므로 여기서 정하고, 생성기 패치가
  // 실패하면 아래에서 3파장 값으로 되돌립니다(균일변수가 이 Vector3 를 그대로 가리킴).
  let spectral = !options.precomputed && (options.spectral ?? true);
  const atmosphereParams = renderAtmosphere(spectral);
  const aerial = new AerialPerspectiveEffect(camera, undefined, atmosphereParams);
  aerial.sky = true;
  aerial.sun = opt.celestial;
  aerial.moon = opt.celestial;
  aerial.sunLight = false;
  aerial.skyLight = false;

  const clouds = new CloudsEffect(camera, undefined, atmosphereParams);
  clouds.qualityPreset = 'low';
  /** 품질 단계가 정한 accurateSunSkyLight — 해가 낮을 때 켰다가 되돌릴 값. */
  let baseAccurate = clouds.clouds.accurateSunSkyLight;
  let lastSunAltForLight = 90;
  /** §179 지금 품질 단계(T_sun 샘플러 한도 점검용) — setQuality 가 바꿈. */
  let curQuality: VolumetricQuality = 'low';
  const applySunLight = () => {
    // §179 T_sun 은 해 ≤ shadowMinSunDeg(그림자 지도 꺼짐과 같은 한 불리언 — v2.1 eng m3)에서 표본별 해·하늘빛을 강제합니다(설계 v2 §4.2). 끄면 이전 식과 같은 값.
    // §179 WP6 REF(tsunRef)도 같은 조건으로 강제(팔은 accurateSunBelowDeg 90 을 명시하므로 같은 값 — 빠뜨린 잡이 해 조도 길을 바꾸지 않게).
    const want = baseAccurate || (opt.accurateSunBelowDeg != null && lastSunAltForLight < opt.accurateSunBelowDeg) || ((opt.tsun === 1 || opt.tsunRef !== 0) && !(lastSunAltForLight > opt.shadowMinSunDeg));
    if (clouds.clouds.accurateSunSkyLight !== want) clouds.clouds.accurateSunSkyLight = want;   // 셰이더 정의가 바뀌어 한 번 다시 컴파일
  };
  baseMarch.n = clouds.clouds.maxIterationCountToSun;
  baseMarch.step = clouds.clouds.minSecondaryStepSize;
  baseMarch.scale = clouds.clouds.secondaryStepScale;
  // (아래 applySunMarch 가 품질 단계 뒤에 2차 행진 값을 다시 겁니다.)
  if (opt.shadowMaxFar != null) clouds.shadow.maxFar = opt.shadowMaxFar;
  clouds.temporalUpscale = opt.temporalUpscale;
  clouds.shadow.temporalPass = opt.shadowTemporal;
  let baseMaxRay = clouds.clouds.maxRayDistance;
  const applyMaxRay = () => {
    clouds.clouds.maxRayDistance = opt.maxRayKm != null ? opt.maxRayKm * 1000 : baseMaxRay;
    const fc = (aerial as unknown as { uniforms?: Map<string, Uniform> }).uniforms?.get('farCutKm');
    if (fc) fc.value = clouds.clouds.maxRayDistance / 1000;
  };
  let isInteracting = false;
  let baseMinStepSize = clouds.clouds.minStepSize;
  let baseMaxIter = clouds.clouds.maxIterationCount;
  let lastViewElDeg = 14;
  let lastViewAltM = 2;
  /**
   * 천정/고고도 적응형 1차 광선 행진 수 조절(Horizon-Adaptive Step Budget):
   * 지평선 부근(el <= 20°)은 광선이 구름 슬랩을 수십 km 비스듬히 통과하므로 baseMaxIter 100% 유지.
   * 고고도/천정(el > 25°)은 구름 슬랩(두께 1~2km)을 수직에 가깝게 통과해 조기 탈출하므로 상한을 70%까지 줄이고,
   * 상공 줌아웃(lastViewAltM > 180m) 및 드래그/스크러빙(isInteracting) 중에는 보폭과 행진 횟수를 낮춰 GPU 프레임 드랍을 방어합니다.
   */
  let isAccumulating = false;
  let savedAccumResScale: number | null = null;
  let activeBillowOn = false;
  const syncBillowInteractionUniform = () => {
    for (const m of [clouds.cloudsPass.currentMaterial, clouds.shadowPass.currentMaterial]) {
      const u = (m as unknown as { uniforms?: Record<string, { value: unknown }> }).uniforms;
      if (u?.billowOn) u.billowOn.value = !isInteracting && activeBillowOn ? 1 : 0;
    }
  };
  const applyPrimaryMarch = () => {
    const elAbs = Math.abs(lastViewElDeg);
    const elScale = elAbs <= 20 ? 1.0 : Math.max(0.68, 1.0 - ((elAbs - 20) / 70) * 0.32);
    const altScale = lastViewAltM <= 180 ? 1.0 : Math.max(0.55, 1.0 - Math.min(1, Math.log(lastViewAltM / 180) / Math.log(12000 / 180)) * 0.45);
    const interactScale = isInteracting ? 0.58 : 1.0;
    const accumScale = isAccumulating ? 0.48 : 1.0;
    clouds.clouds.maxIterationCount = Math.max(40, Math.round(baseMaxIter * elScale * altScale * interactScale * accumScale));
  };
  /** §25 물리 빛이 켜졌는가(종류 모형 필요). 켜지면 takram 의 짧은 해 쪽 행진은 0 걸음(셰이더의 genusMarchSun 이 대신). */
  const physLight = () => opt.cloudLight === 'physical' && opt.genus;
  const applySunMarch = () => {
    if (physLight()) { clouds.clouds.maxIterationCountToSun = 0; return; }
    if (!opt.sunMarch) {
      if (baseMarch.n > 0) {   // 품질 단계 기본값으로 되돌림
        clouds.clouds.maxIterationCountToSun = baseMarch.n;
        clouds.clouds.minSecondaryStepSize = baseMarch.step;
        clouds.clouds.secondaryStepScale = baseMarch.scale;
      }
      return;
    }
    clouds.clouds.maxIterationCountToSun = opt.sunMarch[0];
    clouds.clouds.minSecondaryStepSize = opt.sunMarch[1];
    clouds.clouds.secondaryStepScale = opt.sunMarch[2];
  };
  const applyInteractionLod = () => {
    const highAlt = lastViewAltM > 250;
    if (isInteracting || highAlt) {
      const stepScale = isInteracting && highAlt ? 2.1 : highAlt ? 1.5 : 1.6;
      clouds.clouds.minStepSize = Math.round(baseMinStepSize * stepScale);
      const targetSunSteps = opt.sunMarch ? opt.sunMarch[0] : (baseMarch.n || 6);
      clouds.clouds.maxIterationCountToSun = physLight() ? 0 : Math.max(3, Math.round(targetSunSteps * (isInteracting ? 0.5 : 0.75)));
    } else {
      clouds.clouds.minStepSize = baseMinStepSize;
      applySunMarch();
    }
    syncBillowInteractionUniform();
    applyPrimaryMarch();
    applyCloudLight();
  };
  applySunMarch();
  applyMaxRay();
  // 셰이더: 밀도 = remap(mix(날씨, 1, w), 1 − coverage·h, … + w). 층 가운데에서 날씨 0.5 가 문턱 →
  // coverage = 0.5·(1 − w).
  const CFW = 0.6;
  clouds.coverage = 0.5 * (1 - CFW);
  clouds.events.addEventListener('change', () => {
    aerial.overlay = clouds.atmosphereOverlay;
    aerial.shadow = opt.atmosphereShadow ? clouds.atmosphereShadow : null;
    aerial.shadowLength = opt.atmosphereShadow ? clouds.atmosphereShadowLength : null;
  });
  // ⚠ takram 0.7.6 의 NaN (2026-10-03) — 해가 낮을 때(웹 하네스에서 해 7° 아래) 그림자 지도·구름 패스가 드물게
  //   NaN 을 내고, 시간 필터(그림자 TAA·구름 시간 업스케일)가 그것을 프레임마다 번지게 해 **화면 전체가 검어졌습니다.**
  //   하나는 찾았습니다: 그림자 광선이 구름층을 수백 km 지나 첫 표본에서 투과율이 0 이 되면 앞면 깊이가
  //   가중거리합 / 투과율합 = 0/0. 나머지까지 찾는 대신 두 패스의 출력에서 NaN·무한대를 0 으로 막습니다.
  //   이 그림자 지도를 끄면(처음 판) 구름의 큰 그늘이 통째로 사라져 노을 구름이 납작했습니다 — 해 쪽 2차 행진은
  //   300m 안쪽만 봅니다(사용자: "노을질 때 구름이 두께감이 전혀 없는데").
  {
    const patch = (mat: { fragmentShader: string; needsUpdate: boolean }, pairs: [string, string][]) => {
      let src = mat.fragmentShader;
      for (const [from, to] of pairs) if (src.includes(from)) src = src.replace(from, to);
      if (src !== mat.fragmentShader) { mat.fragmentShader = src; mat.needsUpdate = true; }
    };
    const clean4 = (v: string) => `((any(isnan(${v})) || any(isinf(${v}))) ? vec4(0.0) : ${v})`;
    const clean3 = (v: string) => `((any(isnan(${v})) || any(isinf(${v}))) ? vec3(0.0) : ${v})`;
    patch(clouds.shadowPass.currentMaterial, [
      ['float frontDepth = min(weightedDistanceSum / transmittanceSum, maxRayDistance);',
        'float frontDepth = transmittanceSum > 0.0 ? min(weightedDistanceSum / transmittanceSum, maxRayDistance) : min(rayDistance, maxRayDistance);'],
      ['outputColor = color;', `outputColor = ${clean4('color')};`],
    ]);
    patch(clouds.cloudsPass.currentMaterial, [
      ['outputColor = color;', `outputColor = ${clean4('color')};`],
      ['outputDepthVelocity = depthVelocity;', `outputDepthVelocity = ${clean3('depthVelocity')};`],
      ['outputShadowLength = shadowLength * METER_TO_LENGTH_UNIT;',
        'outputShadowLength = (isnan(shadowLength) || isinf(shadowLength)) ? 0.0 : shadowLength * METER_TO_LENGTH_UNIT;'],
    ]);
    // §127 시간 필터의 이력도 막습니다. 그림자 지도의 시간 필터(TAA)가 해 방향이 크게 바뀐 뒤(장면 전환·시간 막대를
    // 빠르게 넘김) 이력과 섞으며 NaN 을 냈고, 그것이 이력에 남아 **구름이 영구히 사라졌습니다**(웹 하네스: 해 30° → 50°
    // 장면 전환 두 번째 뒤 알파 0, 그림자 지도나 그 시간 필터 하나만 꺼도 사라지지 않음). 섞은 값이 유한하지 않으면 이번
    // 표본(이미 막은 값)으로 물러납니다 — 이력이 한 프레임에 깨끗해집니다.
    const finite4 = (v: string, fallback: string) => `((any(isnan(${v})) || any(isinf(${v}))) ? ${fallback} : ${v})`;
    patch(clouds.shadowPass.resolveMaterial as unknown as { fragmentShader: string; needsUpdate: boolean }, [
      ['  outputColor = mix(clippedHistory, current, temporalAlpha);',
        `  outputColor = mix(clippedHistory, current, temporalAlpha);\n  outputColor = ${finite4('outputColor', clean4('current'))};`],
    ]);
    patch(clouds.cloudsPass.resolveMaterial as unknown as { fragmentShader: string; needsUpdate: boolean }, [
      ['  outputColor = mix(clippedColor, currentColor, temporalAlpha);',
        `  outputColor = mix(clippedColor, currentColor, temporalAlpha);\n  outputColor = ${finite4('outputColor', clean4('currentColor'))};`],
    ]);
    // 2026-11-26 알갱이 잡음 — 시간 업스케일이 이번 프레임에 그린 화소를 이력 없이 그대로 씁니다(takram: "without any accumulation").
    // 1/16 업스케일 × 구름 배율 0.5 에서 화소마다 표본이 16 프레임에 하나라, 하늘 화면이 정착 후 그리기를 멈추면 표본 1 개의
    // 행진 지터 잡음이 그대로 굳습니다(기기 낮 10시 화면). 같은 화소의 재투영 이력(분산 자르기로 유령 막음)과 무게 cloudAccum 으로 섞습니다.
    {
      const rm = clouds.cloudsPass.resolveMaterial as unknown as { fragmentShader: string; uniforms: Record<string, { value: unknown }>; needsUpdate: boolean };
      const from = '    // Use the texel just rendered without any accumulation.\n    outputColor = currentColor;';
      const decl = 'uniform float temporalAlpha;';
      for (const a of [from, decl]) if (!rm.fragmentShader.includes(a)) throw new Error('volumetricScene: resolve accum anchor missing — ' + a.trim().slice(0, 40));
      rm.fragmentShader = rm.fragmentShader.replace(decl, decl + '\nuniform float cloudAccum;').replace(from, [
        '    outputColor = currentColor;',
        '    if (cloudAccum < 1.0) {',
        '      vec2 aPrevUv = vUv - getClosestFragment(lowResCoord).gb;',
        '      if (all(greaterThanEqual(aPrevUv, vec2(0.0))) && all(lessThanEqual(aPrevUv, vec2(1.0)))) {',
        '        vec4 aHist = varianceClipping(colorBuffer, vUv, currentColor, texture(colorHistoryBuffer, aPrevUv), varianceGamma);',
        '        vec4 aMix = mix(aHist, currentColor, cloudAccum);',
        `        outputColor = ${finite4('aMix', clean4('currentColor'))};`,
        '      }',
        '    }',
      ].join('\n'));
      rm.uniforms.cloudAccum = { value: 1 };
      rm.needsUpdate = true;
    }
  }
  // §127 지형 거리 — 구름 패스가 장면 깊이 대신 하늘 화면의 지형 거리 판을 읽습니다. takram 의 RenderPass 장면은
  // 비어 있어 원래 깊이는 늘 "없음"이었으므로 바꿔도 지형이 없을 때는 같습니다.
  {
    const mat = clouds.cloudsPass.currentMaterial as unknown as { fragmentShader: string; uniforms: Record<string, { value: unknown }>; needsUpdate: boolean };
    const from = [
      'float getRayDistanceToScene(const vec3 rayDirection, out float viewZ) {',
      '  float depth = readDepthValue(depthBuffer, vUv * targetUvScale + temporalJitter);',
    ].join('\n');
    if (!mat.fragmentShader.includes(from)) throw new Error('volumetricScene: clouds depth anchor missing');
    mat.fragmentShader = mat.fragmentShader.replace(from, [
      'uniform sampler2D terrainDistBuffer;',
      'uniform float terrainDistOn;',
      TERRAIN_DIST_GLSL,
      'float getRayDistanceToScene(const vec3 rayDirection, out float viewZ) {',
      '  if (terrainDistOn > 0.5) {',
      '    float tkm = terrainDistDecodeKm(texture(terrainDistBuffer, vUv * targetUvScale + temporalJitter));',
      '    viewZ = 0.0;',
      '    if (tkm > 1e8) return 0.0;',
      '    viewZ = -tkm * 1000.0 * dot(rayDirection, vCameraDirection);',
      '    return tkm * 1000.0;',
      '  }',
      '  float depth = readDepthValue(depthBuffer, vUv * targetUvScale + temporalJitter);',
    ].join('\n'));
    mat.uniforms.terrainDistBuffer = { value: null };
    mat.uniforms.terrainDistOn = { value: 0 };
    mat.needsUpdate = true;
  }
  // §127 C5 종류 날씨의 거리 밉(weatherLod). 구름 패스만 — 그림자 패스는 해 쪽에서 내려다보므로 takram 그대로.
  {
    const mat = clouds.cloudsPass.currentMaterial as unknown as { fragmentShader: string; uniforms: Record<string, { value: unknown }>; needsUpdate: boolean };
    const from = '    float mipLevel = log2(max(1.0, rayStartTexelsPerPixel + rayDistance * 1e-5));';
    if (!mat.fragmentShader.includes(from)) throw new Error('volumetricScene: clouds mip anchor missing');
    mat.fragmentShader = mat.fragmentShader.replace(from, [
      from,
      '    if (weatherLodOn > 0.5) {',
      '      // 화소 발자국(m) = 카메라에서 거리 × 화소 각 ÷ 층에 대한 시선 기울기(스치듯 볼수록 길어짐), 날씨 한 칸(m)으로 나눔.',
      '      float sinEl = max(abs(dot(rayDirection, normalize(position))), 0.05);',
      '      float footM = (rayNearFar.x + rayDistance) * weatherPixelAngle / sinEl;',
      '      mipLevel = max(0.0, log2(max(1e-3, footM / weatherTexelM)) + weatherLodBias);',
      '    }',
    ].join('\n'));
    const decl = 'uniform float mipLevelScale;';
    if (!mat.fragmentShader.includes(decl)) throw new Error('volumetricScene: clouds mipLevelScale anchor missing');
    mat.fragmentShader = mat.fragmentShader.replace(decl, decl + '\nuniform float weatherLodOn;\nuniform float weatherPixelAngle;\nuniform float weatherTexelM;\nuniform float weatherLodBias;');
    mat.uniforms.weatherLodOn = { value: 0 };
    mat.uniforms.weatherPixelAngle = { value: 0.003 };
    mat.uniforms.weatherTexelM = { value: (GENUS_TILE_KM * 1000) / 512 };
    mat.uniforms.weatherLodBias = { value: 0 };
    mat.needsUpdate = true;
  }
  const lodUniforms = (clouds.cloudsPass.currentMaterial as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms;
  let viewH = height;
  /** 화소 각(라디안) = 세로 시야 ÷ 구름 버퍼 높이(화면 × 구름 해상도 배율). 시간 업스케일은 여러 프레임에 걸쳐 이 격자를 채웁니다. */
  const updateLod = () => {
    lodUniforms.weatherLodOn.value = opt.weatherLod != null && opt.genus ? 1 : 0;
    lodUniforms.weatherLodBias.value = opt.weatherLod ?? 0;
    lodUniforms.weatherPixelAngle.value = radians(camera.fov) / Math.max(1, viewH * clouds.resolutionScale);
    setEdgePixelRad(clouds.cloudsPass.currentMaterial as never, lodUniforms.weatherPixelAngle.value as number);
  };
  /** §178 대기 효과의 고치기 전 글자(앱 패치까지 넣은 것) — clampInscatter·irradianceLogMu 를 켜고 끌 때 여기서 다시 만듭니다. */
  let aerialBase = '';
  // §127 하늘 텍스처의 알파 = 구름 불투명도, 지형 화소의 하늘은 검게. (aerial 은 아래 EffectPass 를 만들기 전에 고쳐야
  // 합니다 — EffectPass 가 효과 셰이더를 합쳐 컴파일합니다. 균일변수 이름은 EffectPass 가 접두어를 붙여 맞춥니다.)
  {
    const fx = aerial as unknown as { getFragmentShader(): string; setFragmentShader(s: string): void; uniforms: Map<string, Uniform> };
    let src = fx.getFragmentShader();
    const skyA = 'outputColor.a = 1.0;\n    #else // SKY';
    const ovl = '    #ifdef HAS_OVERLAY\n    outputColor.rgb = outputColor.rgb * (1.0 - overlay.a) + overlay.rgb;\n    #endif // HAS_OVERLAY\n    return;';
    const head = 'void mainImage(const vec4 inputColor, const vec2 uv, out vec4 outputColor) {';
    const shLen = '  #ifdef HAS_SHADOW_LENGTH\n  shadowLength = texture(shadowLengthBuffer, uv).r;\n  #endif // HAS_SHADOW_LENGTH';
    for (const a of [skyA, ovl, head, shLen]) if (!src.includes(a)) throw new Error('volumetricScene: aerial anchor missing — ' + a.slice(0, 30));
    // §129 해가 능선 뒤로 넘어가면 눈 쪽 공기는 산 그림자 속 — 하늘·지형 화소 모두 그 구간의 산란을 뺍니다(능선 위 하늘도 같은 그늘을 지남).
    src = src.replace(shLen, shLen + '\n  shadowLength = max(shadowLength, volTerrainShadowKm(normalize(vRayDirection), 1e9));'
      // 구름 아래 공기 그늘(빛줄기 계산이 없는 low·medium 의 싼 근사): 눈에서 구름 꼭대기 높이까지의 시선 길이 × 운량 가림 비율만큼을
      // 그늘 구간으로 둡니다. high(HAS_SHADOW_LENGTH)는 takram 빛줄기가 맡으므로 건너뜀. 흐린 날 해 둘레의 밝은 원 원인(2026-11-12 진단).
      + '\n  #ifndef HAS_SHADOW_LENGTH\n  shadowLength = max(shadowLength, volCloudAirKm(normalize(vRayDirection), uv));\n  #endif');
    src = src.replace(head, [
      'uniform sampler2D terrainDist;', 'uniform float terrainDistOn;', 'uniform float cloudAlphaOut;',
      'uniform sampler2D terrainLit;', 'uniform sampler2D terrainLit2;', 'uniform float terrainLitOn;',
      'uniform sampler2D sunRidgeTex;', 'uniform float sunRidgeOn;', 'uniform float seaSlopeVar;',
      'float volTerrainLitHit = 0.0;',
      TERRAIN_DIST_GLSL, SUN_RIDGE_DECODE_GLSL,
      // 구름 아래 공기 그늘 길이(km): 지형·지평선 시선만 — 지형까지(앱 지형 거리 텍스처) 또는 100 km 상한 × 그늘 비율.
      'uniform float cloudAirShade;', 'uniform float cloudAirTopKm;', 'uniform float farAirShade;', 'uniform float cloudSkyT;',
      'uniform float hazeOn;', 'uniform float cloudAirBaseKm;', 'uniform vec4 hazeP;   // aod, alpha, g, omega',
      // 2D 원거리 구름 껍질·바다 구름 반사 공용: 구름 밑면 산란 + 구름까지 공중 산란(감쇠·채도 보정 포함).
      'vec3 volEvalCloudShell(vec3 startP, vec3 dir, float distKm, float block) {',
      '  vec3 hit = startP + dir * distKm;',
      '  vec3 hitUp = normalize(hit);',
      '  vec3 skyE;',
      '  vec3 sunE = GetSunAndSkyIrradiance(hit, hitUp, sunDirection, skyE);',
      '  float sunH = max(0.0, dot(hitUp, sunDirection));',
      '  vec3 cloud = (skyE + sunE * sunH * cloudSkyT * (1.0 - 0.75 * farAirShade)) * 0.14;',
      '  float cloudL = dot(cloud, vec3(0.2126, 0.7152, 0.0722));',
      '  cloud = mix(cloud, vec3(cloudL), 0.7 * block);',
      '  vec3 t;',
      '  float shKm = block * min(distKm, 350.0);',
      '  vec3 inScat = max(GetSkyRadianceToPoint(startP, hit, shKm, sunDirection, t), vec3(0.0));',
      '  float inL = dot(inScat, vec3(0.2126, 0.7152, 0.0722));',
      '  float shFrac = clamp(shKm / max(distKm, 0.01), 0.0, 1.0);',
      '  inScat = mix(inScat, mix(vec3(inL), inScat, 0.3), block) * mix(1.0, mix(max(0.50, cloudSkyT), 1.0, shFrac), block);',
      '  return cloud * t + inScat;',
      '}',
      'uniform sampler2D farWeatherTex;', 'uniform float farWeatherOn;',
      'uniform sampler2D farMacroTex;', 'uniform sampler2D farMacroTexB;', 'uniform float farMacroMix;', 'uniform sampler2D farMacroLut;', 'uniform float farMacroOn;', 'uniform float farMacroExtentKm;',
      'uniform mat4 farWeatherMask;', 'uniform mat4 farMacroMask;',
      'uniform vec3 farOriginKm;', 'uniform vec3 farEast;', 'uniform vec3 farNorth;', 'uniform float farTileKm;',
      'uniform vec4 farBaseKm;', 'uniform vec4 farThickKm;', 'uniform vec4 farTauV;', 'uniform vec4 farDensPow;', 'uniform vec4 farIce;', 'uniform vec4 farCoverFb;',
      'uniform vec4 farDriftU;', 'uniform vec4 farDriftV;', 'uniform vec4 farDriftKmU;', 'uniform vec4 farDriftKmV;', 'uniform float farLsAmt;', 'uniform vec4 farLife;', 'uniform float farLifeW;', 'uniform vec4 farMacroDriftU;', 'uniform vec4 farMacroDriftV;', 'uniform vec4 farLutCol;',
      'uniform vec3 farCityUp;', 'uniform float farCutKm;',
      // 100km 너머 단일 구름 층 2D 평면 투영 + 원고리 격자 적층 (높은 층→낮은 층 순)
      // 2026-11-18 큰 무늬(비주기): 파장 55·89·144 km 사인 셋을 서로 다른 방향으로 — 24 km 타일 반복을 깹니다. 0..1.
      ...GENUS_SHEET_B_GLSL,
      'float farLsField(const vec2 pKm) {',
      '  float a = sin(dot(pKm, vec2(0.8090, 0.5878)) * (6.2831853 / 55.0) + 1.3);',
      '  float b = sin(dot(pKm, vec2(-0.3420, 0.9397)) * (6.2831853 / 89.0) + 4.1);',
      '  float c = sin(dot(pKm, vec2(0.9945, -0.1045)) * (6.2831853 / 144.0) + 2.7);',
      '  return 0.5 + 0.5 * (0.45 * a + 0.33 * b + 0.22 * c);',
      '}',
      'void volEvalFarLayer(',
      '  const vec3 camPosKm, const vec3 rayDir, const float rCam,',
      '  const float baseKm, const float thickKm, const float tauV, const float densPow, const float isIce, const float coverFb,',
      '  const vec4 wMask, const vec4 mMask, const vec2 wDrift, const vec2 mDrift, const vec2 dKm, const float lutCol,',
      '  inout vec3 accRgb, inout float accAlpha, inout float firstHitKm',
      ') {',
      '  if (baseKm < -0.5 || tauV <= 1e-4) return;',
      '  float fRe = 6360.0;',
      '  float rMid = fRe + baseKm + 0.5 * thickKm;',
      '  float b = dot(camPosKm, rayDir);',
      '  float c = (rCam - rMid) * (rCam + rMid);',
      '  float disc = b * b - c;',
      '  if (disc <= 0.0) return;',
      '  float d = -b + sqrt(disc);',
      '  float dCut = max(50.0, farCutKm);',
      '  float cutFade = smoothstep(dCut - 8.0, dCut + 12.0, d) * (1.0 - smoothstep(325.0, 385.0, d));',
      '  if (cutFade <= 0.005) return;',
      '  vec3 hit = camPosKm + rayDir * d;',
      '  vec3 hitUp = normalize(hit);',
      '  float dens = coverFb;',
      '  vec2 wUv = vec2(0.0);',
      '  if (farWeatherOn > 0.5) {',
      '    vec3 dRel = hit - farOriginKm;',
      '    vec2 planeKm = vec2(dot(dRel, farEast), dot(dRel, farNorth));',
      '    wUv = planeKm / max(farTileKm, 0.5) + wDrift;',
      '    float fA = dot(texture(farWeatherTex, wUv + farLife.xy), wMask);',
      '    float fB = farLifeW > 0.0 ? dot(texture(farWeatherTex, wUv + farLife.zw), wMask) : fA;',
      // 100 km 너머 원거리에서도 포화 보존 혼합(genusSheetMix)과 고운량 테두리 감마 완화·과포화 바닥을 동일하게 적용해 지평선 비구름 구멍을 막습니다.
      '    dens = farLifeW > 0.0 ? genusSheetMix(vec4(fA), vec4(fB), vec4(farLifeW)).x : fA;',
      '    float farFl = smoothstep(0.78, 0.98, coverFb) * 0.34;',
      '    if (farLsAmt > 0.0) dens = pow(clamp(dens, 0.0, 1.0), exp(-farLsAmt * (1.0 - 0.65 * farFl) * 0.75 * (2.0 * farLsField(planeKm + dKm) - 1.0)));',
      '    if (farMacroOn > 0.5) {',
      '      vec2 mUv = (planeKm + mDrift) / max(farMacroExtentKm, 1.0) + 0.5;',
      '      float mCov = (mUv.x < 0.0 || mUv.x > 1.0 || mUv.y < 0.0 || mUv.y > 1.0) ? 1.0 : dot(mix(texture(farMacroTex, mUv), texture(farMacroTexB, mUv), farMacroMix), mMask);',
      '      if (lutCol >= -0.5) {',
      '        vec4 sVec = texture(farMacroLut, vec2((mCov * 63.0 + 0.5) / 64.0, 0.5));',
      '        float gMS = lutCol < 0.5 ? sVec.x : lutCol < 1.5 ? sVec.y : lutCol < 2.5 ? sVec.z : sVec.w;',
      '        dens = clamp((dens - gMS) / max(1.0 - gMS, 1e-3), 0.0, 1.0);',
      '        dens = pow(dens, mix(1.0, 1.85, clamp(gMS * 1.25, 0.0, 1.0) * (1.0 - smoothstep(0.72, 0.96, mCov))));',
      '      } else {',
      '        dens *= mCov;',
      '      }',
      '    }',
      '    if (dens > 0.005) dens = mix(farFl, 1.0, dens);',
      '  }',
      '  if (dens <= 0.005) return;',
      '  dens = pow(dens, clamp(densPow, 0.35, 2.2));',
      '  float sinEl = max(abs(dot(rayDir, hitUp)), 0.10);',
      '  float tauRay = tauV * dens * min(5.5, 1.0 / sinEl);',
      '  float alpha = (1.0 - exp(-tauRay)) * cutFade;',
      '  if (alpha <= 0.005) return;',
      '  vec3 skyE;',
      '  vec3 sunE = GetSunAndSkyIrradiance(hit, hitUp, sunDirection, skyE);',
      '  float sunLit = smoothstep(-0.062, 0.045, dot(hitUp, sunDirection));',
      '  float cosS = dot(rayDir, sunDirection);',
      '  float gP = isIce > 0.5 ? 0.65 : 0.45;',
      '  float phF = (1.0 - gP * gP) / (12.5663706 * pow(max(1.0 + gP * gP - 2.0 * gP * cosS, 1e-2), 1.5));',
      '  float ph = mix(0.0795775, phF, 0.55);',
      '  float ms = exp(-min(tauRay * 0.25, 2.5));',
      '  float backlit = cosS > 0.0 ? exp(-0.42 * tauRay * cosS * cosS) : 1.0;',
      '  vec3 sunTerm = sunE * sunLit * mix(0.03, ph, ms * backlit) * (1.0 - 0.6 * farAirShade);',
      '  vec3 skyTerm = skyE * (1.0 / 12.5663706) * mix(0.65, 1.0, ms);',
      '  vec3 cloudLit = (sunTerm + skyTerm) * (0.7 + 0.3 * ms) + farCityUp * 0.35;',
      '  float fSunL = dot(sunE, vec3(0.2126, 0.7152, 0.0722));',
      '  vec3 fSunChroma = sunE / max(fSunL, 1e-6);',
      '  float fRedness = clamp((fSunChroma.r - fSunChroma.b - 0.25) * 0.75, 0.0, 1.0) * sunLit;',
      '  float fRim = ms * (1.0 - ms) * 4.0 * pow(max(0.0, cosS), 1.3);',
      '  cloudLit += sunE * (fRim * fRedness * 0.28 * (1.0 - 0.5 * farAirShade));',
      '  vec3 fWarmChroma = mix(vec3(1.0), clamp(vec3(fSunChroma.r * 0.85, fSunChroma.g * 0.90, max(fSunChroma.b, 0.80)), 0.70, 1.38), fRedness * (0.40 + 0.35 * max(0.0, cosS)));',
      '  cloudLit *= fWarmChroma;',
      '  accRgb = mix(accRgb, cloudLit, alpha);',
      '  accAlpha = 1.0 - (1.0 - accAlpha) * (1.0 - alpha);',
      '  firstHitKm = firstHitKm <= 0.0 ? d : min(firstHitKm, d);',
      '}',
      'void volHazeIrradiance(vec3 pos, vec3 upDir, vec3 sunDir, out vec3 outSunE, out vec3 outSkyE) {',
      '  vec3 unusedSky;',
      '  GetSunAndSkyIrradiance(pos, upDir, sunDir, outSkyE);',
      '  outSunE = GetSunAndSkyIrradiance(pos, sunDir, sunDir, unusedSky);',
      '  float shade = clamp(max(cloudAirShade, farAirShade), 0.0, 1.0);',
      '  outSunE *= 1.0 - shade;',
      '  outSkyE = mix(outSkyE, vec3(dot(outSkyE, vec3(0.2126, 0.7152, 0.0722))), 0.75 * shade) * mix(1.0, max(0.55, cloudSkyT), shade);',
      '}',
      'void volEvalHaze(vec3 dir, vec3 upDir, vec3 sunDir, vec3 sunE, vec3 skyE, float endU, out vec3 outT, out vec3 outL) {',
      '  float sinV = max(abs(dot(dir, upDir)), 0.03);',
      '  float cosS = dot(dir, sunDir);',
      '  float g = hazeP.z;',
      '  float phBody = (1.0 - g * g) / (12.5663706 * pow(max(1.0 + g * g - 2.0 * g * cosS, 1e-3), 1.5));',
      '  float gFwd = min(0.96, g + 0.25);',
      '  float phFwd = (1.0 - gFwd * gFwd) / (12.5663706 * pow(max(1.0 + gFwd * gFwd - 2.0 * gFwd * cosS, 1e-3), 1.5));',
      '  float ph = mix(0.88 * phBody + 0.12 * phFwd, 0.0795775, 0.25);',
      '  vec3 tau0 = hazeP.x * pow(vec3(640.0, 550.0, 460.0) / 550.0, vec3(-hazeP.y));',
      '  float muS = max(dot(sunDir, upDir), 0.02);',
      '  vec3 a = tau0 * (1.0 / muS - 1.0 / sinV);',
      '  vec3 e0 = tau0 / sinV * exp(-tau0 / sinV);',
      '  vec3 safeA = mix(a, vec3(1e-4), step(abs(a), vec3(1e-4)));',
      '  vec3 intG = mix((exp(-a * endU) - exp(-a)) / safeA, vec3(1.0 - endU) * exp(-a * 0.5 * (1.0 + endU)), step(abs(a), vec3(1e-4)));',
      '  outT = exp(-tau0 / sinV * (1.0 - endU));',
      '  vec3 skyL = skyE * mix(0.1591549, 0.3183099, 1.0 - exp(-hazeP.x * 2.0));',
      '  outL = hazeP.w * (sunE * ph * e0 * intG + skyL * (vec3(1.0) - outT));',
      '}',
      'float volCloudAirKm(vec3 rayDir, vec2 uv) {',
      '  if (cloudAirShade <= 0.0 && farAirShade <= 0.0) return 0.0;',
      '  float sinT = dot(rayDir, normalize(vCameraPosition));',
      '  float effShade = max(cloudAirShade, farAirShade);',
      // 광역 구름 덮개가 사방을 닫을수록(effShade·1-cloudSkyT -> 1) 구름 꼭대기 아래 대류권 하부 공기 기둥(cloudAirTopKm)도 직사광 그늘에 들어갑니다.
      // 조각구름 날(effShade < 0.68)에는 0 이 되어 구름 사이 맑은 파란 하늘을 그대로 유지합니다.
      '  if (sinT > 0.02) {',
      '    float canopy = smoothstep(0.68, 0.94, max(effShade, 1.0 - cloudSkyT));',
      '    return canopy * canopy * effShade * min(max(cloudAirTopKm, 1.5) / max(sinT, 0.06), 80.0);',
      '  }',
      '  if (terrainDistOn < 0.5) return 0.0;',
      '  float k = terrainDistDecodeKm(texture(terrainDist, uv));',
      '  if (k >= 1e8) return 0.0;',
      '  return effShade * min(k, 350.0);',
      '}',
      // §129 해 쪽 능선 그림자 속 공기의 길이(km) — 눈에서 시작하는 그늘 구간(Bruneton shadow_length 의 뜻과 같음).
      // 능선 하나(눈 위 높이 z, 해 방위로 거리 D)가 해 방향과 직각으로 길게 놓였다고 보고(지형 셰이더 hazeLitWeight 와 같은 모형),
      // 시선 위 점(거리 s)이 능선 꼭대기 너머로 해를 보는 조건 tanα·(D − u) > z − h 를 s 에 대해 풉니다(u = s·cosθ·cosΔφ, h = s·sinθ).
      'float volTerrainShadowKm(vec3 rayDir, float maxKm) {',
      '  if (sunRidgeOn < 0.5) return 0.0;',
      '  vec2 zd = sunRidgeZDFrom(sunRidgeTex) * 1e-3;',
      // 능선이 눈보다 낮으면(바다 지평선 — 곡률 낙차뿐) 지형 그림자는 없습니다. 지구 그림자는 takram 이 이미 셉니다.
      '  if (zd.x <= 0.0 || zd.y <= 0.0) return 0.0;',
      '  vec3 up = normalize(vCameraPosition);',
      '  float sinT = dot(rayDir, up), cosT = sqrt(max(0.0, 1.0 - sinT * sinT));',
      '  float sinA = dot(sunDirection, up), tanA = sinA / sqrt(max(1e-6, 1.0 - sinA * sinA));',
      '  vec3 hr = rayDir - up * sinT, hs = sunDirection - up * sinA;',
      '  float cosP = (length(hr) > 1e-5 && length(hs) > 1e-5) ? dot(normalize(hr), normalize(hs)) : 0.0;',
      '  float K = tanA * zd.y - zd.x;',
      '  if (K > 0.0) return 0.0;',
      '  float c = tanA * cosT * cosP - sinT;',
      '  float sLit = c < -1e-6 ? K / c : 1e9;',
      '  float sBeyond = cosP * cosT > 1e-4 ? zd.y / (cosT * cosP) : 1e9;',
      // 해가 지평선 아래 2° 로 내려가면 지구 그림자에 맡깁니다(그 아래는 능선 너머 공기도 이미 그늘 — 두 번 빼지 않게).
      '  return clamp(min(sLit, sBeyond), 0.0, maxKm) * smoothstep(-0.035, 0.0, sinA);',
      '}',
      'uniform vec3 cityTerrainIrr;',
      'uniform vec3 cityUplightIrr;',
      'uniform vec3 cityAir;',
      'uniform float cityAirOn;',
      'uniform float nightDark;',
      'uniform float cityAz[36];',
      'uniform float cityAzOn;',
      'uniform vec3 cityNorth;',
      'uniform vec3 cityEast;',
      'float volCityAzGain(vec3 rd) {',
      '  if (cityAzOn < 0.5) return 1.0;',
      '  float cA = mod(degrees(atan(dot(rd, cityEast), dot(rd, cityNorth))) + 360.0, 360.0) / 10.0 - 0.5;',
      '  int cI = int(floor(cA)); float cU = cA - floor(cA);',
      '  return mix(cityAz[(cI + 36) % 36], cityAz[(cI + 37) % 36], cU);',
      '}',
      head.replace('void mainImage(', 'void volBaseImage('),
    ].join('\n'));
    src = src.replace(skyA, [
      // 구름이 없으면(겹칠 층이 아직 없음) 불투명도 0 — 아래 HAS_OVERLAY 가 있으면 그 알파로 바뀝니다.
      'outputColor.a = cloudAlphaOut > 0.5 ? 0.0 : 1.0;',
      '    if (terrainDistOn > 0.5) {',
      '      vec4 vtDistRaw = texture(terrainDist, uv);',
      '      float vtKm = terrainDistDecodeKm(vtDistRaw);',
      '      if (vtKm < 1e8) {',
      '        outputColor.rgb = vec3(0.0);',
      // §129 지형 빛 판: 알베도(rgb)·햇빛 몫(a) 위에 takram 의 해·하늘 조도와 대기 원근을 하늘과 같은 값으로 입힙니다.
      // 하늘 조도는 수평면(위를 봄) 몫, 해는 원반을 마주한 조도 × 지형 셰이더의 ndl·그림자. 지형은 불투명(알파 1).
      '        if (terrainLitOn > 0.5) {',
      '          vec4 vtLit = texture(terrainLit, uv);',
      // §157 지형 빛 판은 출력이 둘: 0 = sqrt(알베도)·해 몫, 1 = 하늘빛 몫(AO·반구)·젖음·구름을 뚫은 햇빛(terrainLook.ts).
      '          vec3 vtAlb = vtLit.rgb * vtLit.rgb;',
      '          vec4 vtL2 = texture(terrainLit2, uv);',
      `          float vtAmb = vtL2.r * ${LIT2_AMB_RANGE.toFixed(2)}, vtWet = vtL2.g, vtFill = vtL2.b;`,
      '          vec3 vtP = vCameraPosition + rayDirection * vtKm;',
      '          vec3 vtUp = normalize(vtP);',
      '          vec3 vtSky, vtSkyUnused;',
      '          GetSunAndSkyIrradiance(vtP, vtUp, sunDirection, vtSky);',
      '          vec3 vtSun = GetSunAndSkyIrradiance(vtP, sunDirection, sunDirection, vtSkyUnused);',
      // 구름 그늘 아래의 하늘빛은 파랗지 않습니다 — takram 은 맑은 하늘의 파란 조도만 알아서, 두꺼운 구름 밑 땅이 청록으로 기울었습니다.
      // 구름낌(vtL2.a)만큼 하늘빛을 같은 휘도의 중성으로 섞습니다.
      '          vtSky = mix(vtSky, vec3(dot(vtSky, vec3(0.2126, 0.7152, 0.0722))), 0.75 * max(vtL2.a, cloudAirShade));',
      '          vec3 vtRad;',
      '          if (vtDistRaw.b > 0.5) {',
      // 바다(SeaPlane 쌍둥이, B=1): 수체·바닥·포말 = 알베도 × 수평면 조도(직달 × 구름 그림자),
      // 하늘 되비침 = 맑음(takram) → 구름 덮개(volEvalCloudShell) + 입사 경로 연무(volEvalHaze), 윤슬 = 구름 가림 감쇠.
      '            float cosV = max(0.02, -dot(rayDirection, vtUp));',
      '            float F = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);',
      '            vec3 reflDir = reflect(rayDirection, vtUp);',
      '            vec3 nSun = normalize(sunDirection);',
      '            vec3 tRefl;',
      '            vec3 refl = GetSkyRadiance(vtP, reflDir, 0.0, sunDirection, tRefl);',
      '            float seaSunBlock = clamp(max(cloudAirShade, farAirShade), 0.0, 1.0);',
      '            float seaOvercast = clamp(max(vtL2.a, max(cloudAirShade, farAirShade)), 0.0, 1.0);',
      '            if (seaSunBlock > 0.01) {',
      '              vec3 sunHor = sunDirection - vtUp * dot(sunDirection, vtUp);',
      '              float sunHorL = length(sunHor);',
      '              if (sunHorL > 1e-3) {',
      '                vec3 perpDir = normalize(cross(vtUp, sunHor / sunHorL));',
      '                vec3 reflHor = reflDir - vtUp * dot(reflDir, vtUp);',
      '                vec3 sideDir = normalize(perpDir * length(reflHor) + vtUp * dot(reflDir, vtUp));',
      '                vec3 tSide;',
      '                vec3 sideRefl = GetSkyRadiance(vtP, sideDir, 0.0, sunDirection, tSide);',
      '                float glareMask = smoothstep(0.35, 0.96, dot(reflDir, nSun));',
      '                refl = mix(refl, sideRefl, seaSunBlock * glareMask);',
      '              }',
      '            }',
      '            float sunElevSin = dot(vtUp, nSun);',
      '            vec3 clearRefl = mix(refl, vec3(dot(refl, vec3(0.2126, 0.7152, 0.0722))), 0.75 * seaOvercast);',
      '            clearRefl *= mix(1.0, mix(0.45, 0.85, clamp(cloudSkyT, 0.0, 1.0)), seaOvercast);',
      '            float dRefl = 1e4;',
      '            if (seaOvercast > 0.01 && cloudAirBaseKm < 45.0) {',
      '              float zCamV = max(0.0, length(vCameraPosition) - 6360.0);',
      '              float zVt = max(0.0, length(vtP) - 6360.0);',
      '              float reflBaseKm = clamp(cloudAirBaseKm + zCamV - zVt, 0.2, 20.0);',
      '              dRefl = clamp((sqrt(cosV * cosV + 2.0 * reflBaseKm / 6360.0) - cosV) * 6360.0, 0.2, 250.0);',
      '              vec3 reflStart = length(vtP) < 6360.002 ? vtUp * 6360.002 : vtP;',
      '              vec3 cloudRefl = volEvalCloudShell(reflStart, reflDir, dRefl, seaSunBlock);',
      '              refl = mix(clearRefl, cloudRefl, seaOvercast);',
      '            } else {',
      '              refl = clearRefl;',
      '            }',
      '            if (hazeOn > 0.5) {',
      '              vec3 rSunE, rSkyE, rT, rL;',
      '              volHazeIrradiance(vtP, vtUp, nSun, rSunE, rSkyE);',
      `              float uClR = exp(-min(dRefl, 1e4) * max(cosV, 0.03) / ${HAZE_SCALE_HEIGHT_KM.toFixed(2)});`,
      '              float uRefl = cloudAirBaseKm < 45.0 ? mix(0.0, uClR, seaOvercast) : 0.0;',
      '              volEvalHaze(reflDir, vtUp, nSun, rSunE, rSkyE, uRefl, rT, rL);',
      '              refl = refl * rT + rL;',
      '            }',
      '            float vtSunH = max(0.0, sunElevSin);',
      '            float seaDirectSun = vtLit.a * (1.0 - seaSunBlock);',
      '            vec3 body = vtAlb * (1.0 / 3.14159265) * (vtSun * vtSunH * (seaDirectSun + vtFill * (1.0 - seaSunBlock)) + vtSky);',
      '            vec3 V = -rayDirection;',
      '            vec3 Hh = normalize(V + nSun);',
      '            float cosN = max(dot(Hh, vtUp), 1e-3);',
      '            float tan2 = max(0.0, 1.0 - cosN * cosN) / (cosN * cosN);',
      '            float sv = clamp(seaSlopeVar, 1e-3, 0.025);',
      '            float pg = min(exp(-min(tan2 / sv, 50.0)) / (3.14159265 * sv * pow(cosN, 4.0)), 220.0);',
      '            float Fg = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, Hh), 0.0, 1.0), 5.0);',
      // 해가 뜨기 전(지평선 아래)에는 윤슬을 끄고, 구름이 두꺼울수록 직달 윤슬을 비선형으로 감쇠합니다.
      '            float sunVisSea = smoothstep(-0.005, 0.02, sunElevSin);',
      '            float nearFade = smoothstep(0.45, 0.08, cosV) * smoothstep(0.04, 0.30, vtKm);',
      '            vec3 glint = vtSun * (vtLit.a * pow(1.0 - seaSunBlock, 2.5)) * Fg * pg / (4.0 * cosV) * 0.65 * nearFade * sunVisSea;',
      '            vtRad = mix(body, refl, F) + glint;',
      '          } else {',
      '            // 해 직달(Lambert × 산·구름 그림자) + 하늘빛과 구름을 뚫은 확산 햇빛(수평면 몫) × 하늘 보임·사면 방향.',
      '            float vtSunH = max(0.0, dot(vtUp, sunDirection));',
      '            float isBld = (vtDistRaw.b > 0.25 && vtDistRaw.b <= 0.5) ? 1.0 : 0.0;',
      '            // 건물은 vtWet(lit2.g)에 실제 벽면 정규화 높이(0.02..0.90, 옥상 0.98)를 담아 전달합니다.',
      '            float isWall = isBld * (1.0 - step(0.94, vtWet));',
      '            float wallH = isBld > 0.5 ? clamp((vtWet - 0.02) / 0.88, 0.0, 1.0) : 0.0;',
      '            // 1) 지면 접촉 수직 AO (낮·박명 건물 하단 접지부 부드러운 협곡 그늘)',
      '            float contactAo = mix(1.0, mix(0.62, 1.0, smoothstep(0.0, 0.42, wallH)), isWall);',
      '            // 2) Townscaper 스타일: 상부 차가운 하늘 반구광(coolSky) + 하부 따뜻한 지면 반사광(warmBounce) 색온도 분리',
      '            vec3 coolSky = vtSky * mix(vec3(1.0), vec3(0.90, 0.96, 1.10), isWall * wallH);',
      '            vec3 warmBounce = (vtSky * 0.24 + vtSun * vtSunH * 0.16) * vec3(1.18, 0.98, 0.76) * (1.0 - 0.70 * wallH) * isWall;',
      '            vtRad = vtAlb * albedoScale * (1.0 / 3.14159265) * (vtSun * vtLit.a + ((coolSky + vtSun * vtSunH * vtFill) * vtAmb + warmBounce) * contactAo);',
      // 야간 스카이글로우 간접광: 암부 대비를 유지하면서 밝은 방향 건물 외벽은 은은하게 드러냄
      '            vtRad += vtAlb * albedoScale * cityTerrainIrr * (0.04 + 0.96 * pow(clamp(vtAmb, 0.0, 1.5), 1.35)) * contactAo;',
      // 3) Dystopika·Mapbox 스타일: 도심 지상 반사광 + 건물 하단 거리광 쿠션(streetCushion) + 옥상 파라펫 단차(roofCoping)
      '            if (isBld > 0.5) {',
      '              float streetCushion = exp(-wallH * 2.6) * 0.90;',
      '              float wallUplight = mix(0.48, 1.18, wallH) + streetCushion;',
      '              float roofCoping = 1.0 + 0.18 * smoothstep(0.86, 0.98, wallH) * isWall;',
      '              vtRad *= roofCoping;',
      '              vtRad += vtAlb * albedoScale * cityUplightIrr * wallUplight * isWall;',
      '            }',
      // 4) Sky·Firewatch 스타일: 역광·박명 스치는 프레넬 림라이트 (건물 상단 모서리·산 능선이 볼륨 하늘빛에 자연스럽게 녹아듦)
      '            float cosVS = clamp(dot(rayDirection, sunDirection), 0.0, 1.0);',
      '            float rimMask = isBld > 0.5',
      '              ? smoothstep(0.35, 0.95, wallH) * (0.35 + 0.65 * clamp(vtAmb, 0.0, 1.2))',
      '              : smoothstep(0.62, 0.96, vtAmb) * smoothstep(0.08, 0.45, vtKm);',
      '            vec3 rimLight = (vtSun * 0.07 + vtSky * 0.30 + cityTerrainIrr * 0.35) * pow(cosVS, 2.2) * rimMask;',
      '            vtRad += vtAlb * albedoScale * rimLight;',
      // 젖은 갯벌·모래: 건물이 아닌 실제 지형(isBld < 0.5)에서만 스치는 각 하늘 되비침 적용
      '            if (isBld < 0.5 && vtWet > 0.004) {',
      '              float wCosV = max(0.02, -dot(rayDirection, vtUp));',
      '              float wF = 0.02 + 0.98 * pow(1.0 - wCosV, 5.0);',
      '              vec3 wT;',
      '              vec3 wRefl = GetSkyRadiance(vtP, reflect(rayDirection, vtUp), 0.0, sunDirection, wT);',
      '              vtRad = mix(vtRad, wRefl, clamp(wF * vtWet, 0.0, 1.0));',
      // 해의 되비침(윤슬): 젖은 갯벌은 바다보다 거칠어(경사 분산 0.035) 해 둘레로 넓게 번집니다. 직달 몫에서 Lambert 를 뺀
      // 산·구름 그림자 몫만 씁니다(평지 가정 — a = ndl·그림자, ndl = sin(해 고도)).
      '              vec3 wV = -rayDirection;',
      '              vec3 wH = normalize(wV + sunDirection);',
      '              float wCosN = max(dot(wH, vtUp), 1e-3);',
      '              float wTan2 = max(0.0, 1.0 - wCosN * wCosN) / (wCosN * wCosN);',
      '              float wPg = min(exp(-min(wTan2 / 0.035, 50.0)) / (3.14159265 * 0.035 * pow(wCosN, 4.0)), 220.0);',
      '              float wFg = 0.02 + 0.98 * pow(1.0 - clamp(dot(wV, wH), 0.0, 1.0), 5.0);',
      '              float wetSunT = vtLit.a * (1.0 - clamp(max(cloudAirShade, farAirShade), 0.0, 1.0));',
      '              vtRad += vtSun * min(wetSunT / max(vtSunH, 0.05), 1.0) * wFg * wPg / (4.0 * wCosV) * vtWet * 0.5;',
      '            }',
      '          }',
      '          #if defined(TRANSMITTANCE) || defined(INSCATTER)',
      '          vec3 vtT;',
      '          vec3 vtIn = max(GetSkyRadianceToPoint(vCameraPosition, vtP, min(shadowLength, vtKm), sunDirection, vtT), vec3(0.0));',
      // 구름층이 지평선 빛을 가릴 때 지형 앞 공기 원근의 푸른 채도는 줄이되, 투과 감쇠(vtT)와 흐린 날 확산 안개(vtIn)는 유지해 먼 산이 검게 죽지 않고 서서히 희미해지게 합니다.
      '          float vtAirBlock = max(cloudAirShade, farAirShade);',
      '          if (vtAirBlock > 0.01) {',
      '            float vtInL = dot(vtIn, vec3(0.2126, 0.7152, 0.0722));',
      '            float vtShFrac = clamp(min(shadowLength, vtKm) / max(vtKm, 0.01), 0.0, 1.0);',
      '            float vtDiffFloor = mix(max(0.50, cloudSkyT), 1.0, vtShFrac);',
      '            vtIn = mix(vtIn, mix(vec3(vtInL), vtIn, 0.35), vtAirBlock) * mix(1.0, vtDiffFloor, vtAirBlock);',
      '          }',
      '          #ifdef TRANSMITTANCE',
      '          vtRad *= vtT;',
      '          #endif',
      '          #ifdef INSCATTER',
      '          vtRad += vtIn;',
      '          vtRad += cityTerrainIrr * (0.018 * volCityAzGain(rayDirection) * (1.0 - exp(-vtKm * 0.12)));',
      '          #endif',
      '          #endif',
      '          outputColor.rgb = vtRad;',
      '          outputColor.a = 1.0;',
      '          volTerrainLitHit = 1.0;',
      '        }',
      '      }',
      '    }',
      '    #else // SKY',
    ].join('\n'));
    src = src.replace(ovl, [
      '    #ifdef HAS_OVERLAY',
      '    outputColor.rgb = outputColor.rgb * (1.0 - overlay.a) + overlay.rgb;',
      '    if (cloudAlphaOut > 0.5) outputColor.a = max(overlay.a, volTerrainLitHit);',
      '    #endif // HAS_OVERLAY',
      '    return;',
    ].join('\n'));
    // §146 연무: 원래 mainImage 를 volBaseImage 로 바꿔 두고, 끝에 감싸는 mainImage 를 붙입니다(원본 함수가 셰이더의 마지막이어야 함).
    if (!src.trimEnd().endsWith('}')) throw new Error('volumetricScene: aerial 끝 모양이 달라 연무를 붙일 수 없음');
    src += [
      '',
      'void mainImage(const vec4 inputColor, const vec2 uv, out vec4 outputColor) {',
      '  volBaseImage(inputColor, uv, outputColor);',
      // 100km 너머 2D 평면·원고리 덱 원근 투영: 3D 레이마칭이 100km에서 끊긴 뒤 지평선까지 이어지는 층을 높은 층→낮은 층 순으로 적층합니다.
      '  float fCloudAlpha = 0.0;',
      '  vec3 fCloudRgb = vec3(0.0);',
      '  float fCloudDist = 0.0;',
      '  {',
      '    vec3 fRd = normalize(vRayDirection);',
      '    vec3 fUp = normalize(vCameraPosition);',
      '    float fSin = dot(fRd, fUp);',
      '    float rCam = length(vCameraPosition);',
      '    vec4 fOv = vec4(0.0);',
      '    #ifdef HAS_OVERLAY',
      '    fOv = texture(overlayBuffer, uv);',
      '    #endif',
      '    float fTer = 0.0;',
      '    if (terrainDistOn > 0.5) { float k = terrainDistDecodeKm(texture(terrainDist, uv)); if (k < 1e8) fTer = 1.0; }',
      // 광역 두꺼운 구름 덮개(비구름·전천 흐림) 아래에서는 구름의 얇은 틈 너머 배경 대기도 직달 레일리 코발트블루 대신 상층 확산 투과광(cloudSkyT)으로 감쇠·중성화됩니다.
      '    float skyCanopy = smoothstep(0.68, 0.94, max(max(cloudAirShade, farAirShade), 1.0 - cloudSkyT)) * clamp(1.0 - cloudSkyT, 0.0, 1.0);',
      '    if (skyCanopy > 0.005 && fTer < 0.5 && fOv.a < 0.999) {',
      '      vec3 bgOnly = max(outputColor.rgb - fOv.rgb, vec3(0.0));',
      '      float bgL = dot(bgOnly, vec3(0.2126, 0.7152, 0.0722));',
      '      float bgBlue = clamp((bgOnly.b - bgOnly.r) / max(bgL, 1e-5), 0.0, 1.0);',
      '      vec3 greyBg = mix(bgOnly, vec3(bgL) * vec3(0.96, 0.98, 1.02), clamp(skyCanopy * (0.65 + 0.35 * bgBlue), 0.0, 0.88));',
      '      greyBg *= mix(1.0, clamp(cloudSkyT * 1.45, 0.38, 0.88), skyCanopy * 0.65);',
      '      outputColor.rgb = fOv.rgb + greyBg;',
      '    }',
      '    if (fTer < 0.5 && fOv.a < 0.995 && farBaseKm.x >= -0.5) {',
      '      vec3 accRgb = vec3(0.0);',
      '      float accA = 0.0;',
      '      float firstHit = 0.0;',
      '      volEvalFarLayer(vCameraPosition, fRd, rCam, farBaseKm.x, farThickKm.x, farTauV.x, farDensPow.x, farIce.x, farCoverFb.x, farWeatherMask[0], farMacroMask[0], vec2(farDriftU.x, farDriftV.x), vec2(farMacroDriftU.x, farMacroDriftV.x), vec2(farDriftKmU.x, farDriftKmV.x), farLutCol.x, accRgb, accA, firstHit);',
      '      volEvalFarLayer(vCameraPosition, fRd, rCam, farBaseKm.y, farThickKm.y, farTauV.y, farDensPow.y, farIce.y, farCoverFb.y, farWeatherMask[1], farMacroMask[1], vec2(farDriftU.y, farDriftV.y), vec2(farMacroDriftU.y, farMacroDriftV.y), vec2(farDriftKmU.y, farDriftKmV.y), farLutCol.y, accRgb, accA, firstHit);',
      '      volEvalFarLayer(vCameraPosition, fRd, rCam, farBaseKm.z, farThickKm.z, farTauV.z, farDensPow.z, farIce.z, farCoverFb.z, farWeatherMask[2], farMacroMask[2], vec2(farDriftU.z, farDriftV.z), vec2(farMacroDriftU.z, farMacroDriftV.z), vec2(farDriftKmU.z, farDriftKmV.z), farLutCol.z, accRgb, accA, firstHit);',
      '      volEvalFarLayer(vCameraPosition, fRd, rCam, farBaseKm.w, farThickKm.w, farTauV.w, farDensPow.w, farIce.w, farCoverFb.w, farWeatherMask[3], farMacroMask[3], vec2(farDriftU.w, farDriftV.w), vec2(farMacroDriftU.w, farMacroDriftV.w), vec2(farDriftKmU.w, farDriftKmV.w), farLutCol.w, accRgb, accA, firstHit);',
      '      float visA = accA * (1.0 - fOv.a);',
      '      if (visA > 0.004) {',
      // 4개 층을 먼저 알파 합성한 뒤 대표 적중 거리(firstHit)에서 대기 원근(GetSkyRadianceToPoint)을 딱 1번만 계산합니다(4회 → 1회).
      '        float fCosS = dot(fRd, sunDirection);',
      '        float fOwnShade = fCosS > 0.0 ? accA * smoothstep(0.0, 0.65, fCosS) : 0.0;',
      '        float effAirShade = clamp(max(max(cloudAirShade, farAirShade), fOwnShade), 0.0, 1.0);',
      '        float shKm = effAirShade * min(firstHit, 350.0);',
      '        vec3 tAtm;',
      '        vec3 inAtm = max(GetSkyRadianceToPoint(vCameraPosition, vCameraPosition + fRd * firstHit, shKm, sunDirection, tAtm), vec3(0.0));',
      '        if (effAirShade > 0.01) {',
      '          float inL = dot(inAtm, vec3(0.2126, 0.7152, 0.0722));',
      '          float inBlue = clamp((inAtm.b - inAtm.r) / max(inL, 1e-5), 0.0, 1.0);',
      '          inAtm = mix(inAtm, vec3(inL), 0.55 * effAirShade * (0.4 + 0.6 * inBlue)) * mix(1.0, max(0.35, cloudSkyT), 0.65 * fOwnShade);',
      '        }',
      '        accRgb = accRgb * tAtm + inAtm;',
      '        vec3 skyVis = max(outputColor.rgb - fOv.rgb, vec3(0.0));',
      '        outputColor.rgb = fOv.rgb + skyVis * (1.0 - accA) + accRgb * (1.0 - fOv.a);',
      '        fCloudAlpha = visA;',
      '        fCloudRgb = accRgb * (1.0 - fOv.a);',
      '        fCloudDist = firstHit;',
      '        if (cloudAlphaOut > 0.5) outputColor.a = max(outputColor.a, clamp(fOv.a + visA, 0.0, 1.0));',
      '      }',
      '    }',
      '  }',
      // 도시 불빛 하늘(2026-11-13): 맑은 하늘 화소에 지평선 쪽이 밝은 인공 하늘빛. 구름·지형 화소는 뺌(구름 밑면은 구름 패스가 비춤).
      '  if (cityAirOn > 0.5) {',
      '    vec3 cRd = normalize(vRayDirection);',
      '    float cSin = dot(cRd, normalize(vCameraPosition));',
      '    vec4 cOv = vec4(0.0);',
      '    #ifdef HAS_OVERLAY',
      '    cOv = texture(overlayBuffer, uv);',
      '    #endif',
      '    float cTer = 0.0;',
      '    if (terrainDistOn > 0.5) { float k = terrainDistDecodeKm(texture(terrainDist, uv)); if (k < 1e8) cTer = 1.0; }',
      '    float cG = min(1.35, pow(0.85 / (max(cSin, 0.0) + 0.16), 0.65));',
      // 밤 불빛 지도: 방위 10° 칸 세기를 지평선에서 쓰고 천정 부근에서만 완만히 섞음.
      '    if (cityAzOn > 0.5) {',
      '      float cA = mod(degrees(atan(dot(cRd, cityEast), dot(cRd, cityNorth))) + 360.0, 360.0) / 10.0 - 0.5;',
      '      int cI = int(floor(cA)); float cU = cA - floor(cA);',
      '      float cAz = mix(cityAz[(cI + 36) % 36], cityAz[(cI + 37) % 36], cU);',
      '      cG *= mix(cAz, 1.0, smoothstep(0.25, 0.85, cSin));',
      '    }',
      '    outputColor.rgb += cityAir * cG * (1.0 - cOv.a) * (1.0 - fCloudAlpha) * (1.0 - cTer) * step(-0.02, cSin);',
      '  }',
      '  if (hazeOn < 0.5) return;',
      '  vec3 hRd = normalize(vRayDirection);',
      '  vec3 hUp = normalize(vCameraPosition);',
      '  vec3 hNSun = normalize(sunDirection);',
      '  float hS = dot(hRd, hUp);',
      '  float hSin = max(abs(hS), 0.03);',
      '  float hKm = 1e9;',
      '  if (terrainDistOn > 0.5) { float k = terrainDistDecodeKm(texture(terrainDist, uv)); if (k < 1e8) hKm = k; }',
      `  float hH = ${HAZE_SCALE_HEIGHT_KM.toFixed(2)};`,
      // 2026-11-13 단일 산란을 지수 분포 연무층에서 직접 적분: 햇빛도 그 점까지 연무에 깎임(e^(−τ0·u/μs), u = e^(−h/H)).
      // 하강 시선(고산→바다)은 저층의 짙은 연무를 반영해 downScale로 환산하고, 구름은 2D 띠 거리(fCloudDist)까지 적분해 지평선 단차를 없앱니다.
      '  float zCam = max(0.0, length(vCameraPosition) - 6360.0);',
      '  float zTgt = hKm < 1e8 ? max(0.0, length(vCameraPosition + hRd * hKm) - 6360.0) : zCam;',
      '  float dzDown = clamp(zCam - zTgt, 0.0, 4.0);',
      '  float downScale = dzDown > 1e-3 ? (exp(dzDown / hH) - 1.0) / (dzDown / hH) : 1.0;',
      '  float hUBg = exp(-min(hKm * downScale, 1e4) * hSin / hH);',
      '  float dBaseCl = cloudAirBaseKm < 45.0 ? (sqrt(max(0.0, hS * hS + 2.0 * max(cloudAirBaseKm, 0.05) / 6360.0)) - hS) * 6360.0 : 1e4;',
      '  float dClHorizon = max(dBaseCl, smoothstep(0.04, -0.01, hS) * 100.0);',
      '  float hClKm = mix(dClHorizon, max(dClHorizon, fCloudDist), fCloudAlpha);',
      '  float hUCl = exp(-min(hClKm, 1e4) * hSin / hH);',
      '  vec3 hSunE, hSkyE, hTBg, hLBg, hTCl, hLCl;',
      '  volHazeIrradiance(vCameraPosition, hUp, hNSun, hSunE, hSkyE);',
      '  volEvalHaze(hRd, hUp, hNSun, hSunE, hSkyE, hUBg, hTBg, hLBg);',
      '  vec4 hOv = vec4(0.0);',
      '  #ifdef HAS_OVERLAY',
      '  hOv = texture(overlayBuffer, uv);',
      '  #endif',
      '  vec3 hClPart = hOv.rgb + fCloudRgb;',
      '  float hClCov = clamp(hOv.a + fCloudAlpha, 0.0, 1.0);',
      // 2026-11-18 구름 앞 연무 자기 그림자: 3D 구름(hOv.a)과 2D 원거리 구름(fCloudAlpha)을 합친 전체 불투명도(hClCov)를 반영하고,
      // 일몰 직전 낮은 태양 고도에서는 구름 꼭대기(cloudAirTopKm)가 앞쪽 연무층에 긴 그림자(cloudAirTopKm / sin(태양고도))를 드리우도록 확장합니다.
      '  float hCosS = dot(hRd, hNSun);',
      '  float hSinSun = max(0.025, dot(hUp, hNSun));',
      `  float hShadowSpanKm = max(${(CLOUD_OWN_SHADOW_R_M / 1000).toFixed(2)} / sqrt(max(1e-4, 1.0 - hCosS * hCosS)), max(cloudAirTopKm, 1.5) / hSinSun * smoothstep(0.0, 0.75, hCosS));`,
      '  float hOwnFrac = hCosS > 0.0 ? clamp(hShadowSpanKm / max(hClKm, 0.01), 0.0, 1.0) * hClCov : 0.0;',
      '  volEvalHaze(hRd, hUp, hNSun, hSunE * (1.0 - hOwnFrac), hSkyE, hUCl, hTCl, hLCl);',
      '  vec3 hBgPart = max(outputColor.rgb - hClPart, vec3(0.0));',
      '  float nDim = 1.0 - 0.72 * clamp(nightDark, 0.0, 1.0);',
      '  outputColor.rgb = hBgPart * hTBg * nDim + hClPart * hTCl + ((1.0 - hClCov) * hLBg + hClCov * hLCl) * nDim;',
      '}',
    ].join('\n');
    fx.uniforms.set('hazeOn', new Uniform(0));
    fx.uniforms.set('hazeP', new Uniform(new Vector4(0, 1, 0.7, 0.95)));
    fx.uniforms.set('terrainDist', new Uniform(null));
    fx.uniforms.set('terrainDistOn', new Uniform(0));
    fx.uniforms.set('cloudAlphaOut', new Uniform(0));
    fx.uniforms.set('terrainLit', new Uniform(null));
    fx.uniforms.set('terrainLit2', new Uniform(null));
    fx.uniforms.set('terrainLitOn', new Uniform(0));
    fx.uniforms.set('sunRidgeTex', new Uniform(null));
    fx.uniforms.set('sunRidgeOn', new Uniform(0));
    fx.uniforms.set('cloudAirShade', new Uniform(0));
    fx.uniforms.set('cloudAirTopKm', new Uniform(2));
    fx.uniforms.set('farAirShade', new Uniform(0));
    fx.uniforms.set('cloudAirBaseKm', new Uniform(50));
    fx.uniforms.set('cityAir', new Uniform(new Vector3()));
    fx.uniforms.set('cityTerrainIrr', new Uniform(new Vector3()));
    fx.uniforms.set('cityUplightIrr', new Uniform(new Vector3()));
    fx.uniforms.set('cityAirOn', new Uniform(0));
    fx.uniforms.set('nightDark', new Uniform(0));
    fx.uniforms.set('cloudSkyT', new Uniform(1));
    fx.uniforms.set('cityAz', new Uniform(new Array(36).fill(1)));
    fx.uniforms.set('cityAzOn', new Uniform(0));
    fx.uniforms.set('cityNorth', new Uniform(new Vector3(1, 0, 0)));
    fx.uniforms.set('cityEast', new Uniform(new Vector3(0, 0, 1)));
    fx.uniforms.set('seaSlopeVar', new Uniform(0.03));
    fx.uniforms.set('farWeatherTex', new Uniform(null));
    fx.uniforms.set('farWeatherOn', new Uniform(0));
    fx.uniforms.set('farMacroTex', new Uniform(null));
    fx.uniforms.set('farMacroTexB', new Uniform(null));
    fx.uniforms.set('farMacroMix', new Uniform(0));
    fx.uniforms.set('farMacroLut', new Uniform(null));
    fx.uniforms.set('farMacroOn', new Uniform(0));
    fx.uniforms.set('farMacroExtentKm', new Uniform(768));
    fx.uniforms.set('farWeatherMask', new Uniform(new Matrix4()));
    fx.uniforms.set('farMacroMask', new Uniform(new Matrix4()));
    fx.uniforms.set('farOriginKm', new Uniform(new Vector3()));
    fx.uniforms.set('farEast', new Uniform(new Vector3(1, 0, 0)));
    fx.uniforms.set('farNorth', new Uniform(new Vector3(0, 1, 0)));
    fx.uniforms.set('farTileKm', new Uniform(GENUS_TILE_KM));
    fx.uniforms.set('farBaseKm', new Uniform(new Vector4(-1, -1, -1, -1)));
    fx.uniforms.set('farThickKm', new Uniform(new Vector4()));
    fx.uniforms.set('farTauV', new Uniform(new Vector4()));
    fx.uniforms.set('farDensPow', new Uniform(new Vector4(0.7, 0.7, 0.7, 0.7)));
    fx.uniforms.set('farIce', new Uniform(new Vector4()));
    fx.uniforms.set('farCoverFb', new Uniform(new Vector4()));
    fx.uniforms.set('farDriftU', new Uniform(new Vector4()));
    fx.uniforms.set('farDriftKmU', new Uniform(new Vector4()));
    fx.uniforms.set('farDriftKmV', new Uniform(new Vector4()));
    fx.uniforms.set('farLsAmt', new Uniform(GENUS_LS_AMT));
    fx.uniforms.set('farLife', new Uniform(new Vector4()));
    fx.uniforms.set('farLifeW', new Uniform(0));
    fx.uniforms.set('farDriftV', new Uniform(new Vector4()));
    fx.uniforms.set('farMacroDriftU', new Uniform(new Vector4()));
    fx.uniforms.set('farMacroDriftV', new Uniform(new Vector4()));
    fx.uniforms.set('farLutCol', new Uniform(new Vector4(-1, -1, -1, -1)));
    fx.uniforms.set('farCityUp', new Uniform(new Vector3()));
    fx.uniforms.set('farCutKm', new Uniform(opt.maxRayKm != null ? opt.maxRayKm : baseMaxRay / 1000));
    aerialBase = src;
    fx.setFragmentShader(applyLightingFixAerial(src, lightingFlags()));
  }
  const setTerrainDistance = (tex: Texture | null, lit: Texture | null = null, ridge: Texture | null = null, seaSlope = 0.03, lit2: Texture | null = null) => {
    const cu = (clouds.cloudsPass.currentMaterial as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms;
    cu.terrainDistBuffer.value = tex;
    cu.terrainDistOn.value = tex ? 1 : 0;
    const au = (aerial as unknown as { uniforms: Map<string, Uniform> }).uniforms;
    au.get('terrainDist')!.value = tex;
    au.get('terrainDistOn')!.value = tex ? 1 : 0;
    au.get('terrainLit')!.value = tex ? lit : null;
    au.get('terrainLit2')!.value = tex ? lit2 : null;
    // 둘째 출력이 없으면(옛 호출) 지형 빛 판을 끕니다 — 하늘빛 몫을 모르면 알베도를 제대로 못 칠합니다.
    au.get('terrainLitOn')!.value = tex && lit && lit2 ? 1 : 0;
    au.get('sunRidgeTex')!.value = ridge;
    au.get('sunRidgeOn')!.value = tex && lit && ridge ? 1 : 0;
    au.get('seaSlopeVar')!.value = seaSlope;
  };
  /** 구름 아래 공기 그늘(싼 근사): 층마다 운량 × 종류별 불투명도로 햇빛이 공기에 닿는 비율 T 를 곱하고, 그늘 비율 1 − T 와 가장 높은 구름 꼭대기를 넘김. */
  const AIR_OPACITY: Record<string, number> = { cu: 0.9, cg: 0.95, cb: 1, sc: 0.85, st: 0.95, ns: 1, ac: 0.6, as: 0.85, ci: 0.1, cs: 0.3, cbanvil: 0.8 };
  const applyCloudAir = (p: VolumetricSceneInput) => {
    const au = (aerial as unknown as { uniforms: Map<string, Uniform> }).uniforms;
    let T = 1, top = 0, base = 50, baseW = 0, baseSum = 0, gapW = 0, gapSum = 0;
    for (const L of p.layers) {
      if (!L || !(L.cover > 0)) continue;
      const baseOp = L.genus ? AIR_OPACITY[L.genus] ?? 0.7 : 0.7;
      const dsOp = L.genus === 'ci' || L.genus === 'cs'
        ? 1 - Math.exp(-((L.opts?.densityScale ?? GENUS[L.genus].densityScale) * (L.thicknessM ?? GENUS[L.genus].height) * 0.04))
        : 0;
      const effOp = Math.min(1, Math.max(baseOp, dsOp));
      const o = Math.min(1, L.cover) * effOp;
      if (o <= 0.02) continue;
      T *= 1 - o;
      top = Math.max(top, L.baseKm + (L.thicknessM ?? 1000) / 1000);
      base = Math.min(base, L.baseKm);
      baseSum += L.baseKm * o;
      baseW += o;
      const sg = (L.opts as { sunGap?: number } | undefined)?.sunGap;
      if (typeof sg === 'number' && Number.isFinite(sg)) { gapSum += sg * o; gapW += o; }
    }
    const avgGap = gapW > 0 ? Math.min(1, Math.max(0, gapSum / gapW)) : 0;
    const gapEase = T > 0.25 ? 1 - 0.35 * avgGap * Math.min(1, (T - 0.25) / 0.45) : 1;
    const shade = (1 - T) * gapEase;
    const repBase = baseW > 0 ? baseSum / baseW : base;
    au.get('cloudAirShade')!.value = opt.cloudAirShade ? shade : 0;
    // 구름 패스 연무는 빛줄기(SHADOW_LENGTH)가 켜진 high 에서는 그 값이 맡으므로 0.
    lastAirShadeC = opt.cloudAirShade && !aerial.shadowLength ? shade : 0;
    (clouds.cloudsPass.currentMaterial as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms.cloudAirShadeC.value = Math.max(lastAirShadeC, farAirShadeV);
    au.get('cloudAirTopKm')!.value = Math.max(0.2, top - (p.heightM ?? 0) / 1000);
    // 연무를 구름 앞까지만 셀 때 쓰는 불투명도 가중 대표 밑면(눈 위 km). 구름이 없으면 50(= 연무층 전체).
    au.get('cloudAirBaseKm')!.value = base >= 50 ? 50 : Math.max(0.05, repBase - (p.heightM ?? 0) / 1000 - (p.altitudeM ?? 0) / 1000);
    lastAirShade = opt.cloudAirShade ? shade : 0;
  };
  const applyHaze = (h: HazeInput | undefined) => {
    const au = (aerial as unknown as { uniforms: Map<string, Uniform> }).uniforms;
    const on = !!h && h.aod > 0.005;
    au.get('hazeOn')!.value = on ? 1 : 0;
    if (on && h) (au.get('hazeP')!.value as Vector4).set(h.aod, h.alpha, h.g, h.omega);
  };
  const setCloudAlphaOut = (on: boolean) => {
    (aerial as unknown as { uniforms: Map<string, Uniform> }).uniforms.get('cloudAlphaOut')!.value = on ? 1 : 0;
  };
  // §124 종류별 모형 패치 — 늘 걸어 두고 층별 genusOn 으로 켭니다(끄면 takram 그대로).
  patchGenusShader(clouds.cloudsPass.currentMaterial as never);
  patchGenusShader(clouds.shadowPass.currentMaterial as never);
  // 위키 optimization-review A2 · A3: 다중 산란 위상을 화소마다 한 번, 감쇠 exp 를 제곱으로(같은 값).
  patchMultiScatterCache(clouds.cloudsPass.currentMaterial as never);
  // §130 흐름 모형 셰이더(연속 밀도·층별 fetch) — 종류 패치 직후, 두 패스 모두. 레인이 0 이면 화소 단위로 이전과 같습니다.
  patchFlowShader(clouds.cloudsPass.currentMaterial as never);
  patchFlowShader(clouds.shadowPass.currentMaterial as never);
  // 고적운·층적운 세포 무늬 — 흐름 패치 직후(그 문장 앞에 끼움). 레인 세기 0 이면 날씨 값 그대로.
  patchCellShader(clouds.cloudsPass.currentMaterial as never);
  patchCellShader(clouds.shadowPass.currentMaterial as never);
  // §26 가장자리 거칠기 — 세포 다음(세포 경계까지 거칠게), 같은 문장 앞.
  patchEdgeShader(clouds.cloudsPass.currentMaterial as never);
  patchEdgeShader(clouds.shadowPass.currentMaterial as never);
  patchMacroShader(clouds.cloudsPass.currentMaterial as never);
  patchMacroShader(clouds.shadowPass.currentMaterial as never);
  // 파동 합성 장(하네스 시제품, docs/WAVE_FIELD_DESIGN.md) — 층 opts.wave 가 있을 때만 켬. 종류 패치 뒤(genusOrigin 사용).
  patchWaveShader(clouds.cloudsPass.currentMaterial as never);
  patchWaveShader(clouds.shadowPass.currentMaterial as never);
  // 뭉게구름 표면 혹(하네스 시제품, 층 opts.billow 가 있을 때만) — 종류 패치 뒤.
  patchBillowShader(clouds.cloudsPass.currentMaterial as never);
  patchBillowShader(clouds.shadowPass.currentMaterial as never);
  // 해 쪽 추적 전용 가벼운 날씨 읽기(진단) — 모든 패치 뒤.
  patchSunMarchLite(clouds.cloudsPass.currentMaterial as never);
  {
    const sp = clouds.shadowPass as unknown as { update: (r: unknown, f: number, d: number) => void };
    const orig = sp.update.bind(sp);
    // §25 물리 빛에서 그림자 지도를 읽는 곳은 빛줄기(SHADOW_LENGTH)뿐 — 빛줄기가 꺼진 품질이면 패스를 건너뜀.
    sp.update = (r, f, d) => { if (!(physLight() && !clouds.lightShafts)) orig(r, f, d); };
  }
  patchSunMarchLite(clouds.shadowPass.currentMaterial as never);
  // 먼 거리 햇빛 가림(노을 3단계, 구름 패스만, 기본 꺼짐).
  patchFarSunShader(clouds.cloudsPass.currentMaterial as never);
  // 구름 패스 연무(takram HAZE)도 빛줄기가 없으면 구름 아래 공기를 햇빛 받는 것으로 셉니다 — 같은 그늘 비율을 곱함(흐린 날 해 둘레 밝은 원, 2026-11-12).
  {
    const cm = clouds.cloudsPass.currentMaterial as unknown as { fragmentShader: string; uniforms: Record<string, { value: unknown }>; needsUpdate: boolean };
    const hz = '  vec3 inscatter = sunIrradiance * phaseFunction(cosTheta) * shadowTransmittance;';
    const hd = '#ifdef HAZE\n\nvec4 approximateHaze(';
    if (!cm.fragmentShader.includes(hz) || !cm.fragmentShader.includes(hd)) throw new Error('volumetricScene: cloud haze anchor missing');
    const ap = '      applyAerialPerspective(cameraPosition, frontPosition, shadowLength, color);';
    if (!cm.fragmentShader.includes(ap)) throw new Error('volumetricScene: cloud aerial anchor missing');
    cm.fragmentShader = cm.fragmentShader.replace(hd, 'uniform float cloudAirShadeC;\nuniform float cloudSkyTC;\n' + hd)
      .replace(hz, [
        '  float ownHazeShade = cosTheta > 0.0 ? clamp(1.0 - exp(-opticalDepth), 0.0, 1.0) * smoothstep(0.0, 0.7, cosTheta) : 0.0;',
        '  vec3 inscatter = sunIrradiance * (1.0 - max(cloudAirShadeC, ownHazeShade)) * phaseFunction(cosTheta) * shadowTransmittance;',
      ].join('\n'))
      // 불투명 구름 화소의 공기 원근은 구름 패스가 직접 더함(대기 효과는 겹쳐 그리지 않음) — 눈~구름 앞면 구간의 그 비율을 그늘로.
      // 2026-11-13 구름 앞 공기의 하늘빛: 구름층이 하늘을 덮었으면 그 공기는 맑은 하늘의 푸른 산란빛이 아니라 구름층을 지나온 회색빛(투과 T 배)만 받음
      //   — 덮인 만큼(cloudAirShadeC) 채도를 70 % 빼고 T 쪽으로 줄임. 해 막힌 비 오는 해 질 녘에 지평선 띠·먼 구름층이 진한 남색이던 것.
      .replace(ap, [
        '      {',
        '        vec3 cT;',
        // 2026-11-18 구름 자기 그림자: 해 가까이 보이는 구름 앞 공기는 그 구름에 해가 가려 있습니다(그 점에서 해 쪽으로 가는 빛이
        // 바로 그 구름을 지남). 시선과 해의 각 θ 에서 구름 반폭 R 이면 구름 앞 R/sinθ 구간이 그늘이며, 낮은 태양 고도에서는 구름 높이(zClM)가
        // 앞쪽 대기 기둥에 zClM/sin(태양고도) 길이의 긴 그림자를 드리웁니다.
        '        float cCosS = dot(rayDirection, sunDirection);',
        '        float cDistM = length(frontPosition - cameraPosition);',
        '        vec3 cUp = normalize(frontPosition);',
        '        float cSinSun = max(0.025, dot(cUp, sunDirection));',
        '        float cZClM = max(1500.0, length(frontPosition) - length(cameraPosition));',
        `        float cSpanM = max(${CLOUD_OWN_SHADOW_R_M.toFixed(1)} / sqrt(max(1e-4, 1.0 - cCosS * cCosS)), (cZClM / cSinSun) * smoothstep(0.0, 0.75, cCosS));`,
        '        float cOwn = cCosS > 0.0 ? min(cDistM, cSpanM) * color.a : 0.0;',
        '        float cEffShade = max(cloudAirShadeC, cDistM > 1.0 ? clamp(cOwn / cDistM, 0.0, 1.0) * smoothstep(0.0, 0.65, cCosS) : 0.0);',
        '        vec3 cIn = GetSkyRadianceToPoint(cameraPosition * METER_TO_LENGTH_UNIT, frontPosition * METER_TO_LENGTH_UNIT, max(shadowLength, cOwn) * METER_TO_LENGTH_UNIT, sunDirection, cT);',
        '        float cL = dot(cIn, vec3(0.2126, 0.7152, 0.0722));',
        '        float cBlueExcess = clamp((cIn.b - cIn.r) / max(cL, 1e-5), 0.0, 1.0);',
        '        cIn = mix(cIn, vec3(cL), 0.7 * cEffShade * cBlueExcess) * mix(1.0, max(0.35, cloudSkyTC), cEffShade);',
        '        color.rgb = color.rgb * cT + cIn * color.a;',
        '      }',
      ].join('\n'));
    cm.uniforms.cloudAirShadeC = { value: 0 };
    cm.uniforms.cloudSkyTC = { value: 1 };
    // 도시 불빛 구름 밑면(2026-11-13): 땅에서 올라온 빛이 구름 밑면을 비춤 — 밑면에서 가장 밝고 구름 속으로 e^(−(1−g)·τ_밑에서) 로 줄어듦,
    // 높을수록 퍼져 약해짐 e^(−(h − 1 km)/4 km). cityUp 은 1 km 두꺼운 밑면이 보일 휘도(렌더 단위).
    const fin = '      // Finally multiply by scattering.';
    if (!cm.fragmentShader.includes(fin)) throw new Error('volumetricScene: cloud city anchor missing');
    cm.fragmentShader = cm.fragmentShader.replace('vec4 getLayerDensity', [
      'uniform vec3 cityUp;', 'uniform sampler2D cityTex;', 'uniform float cityTexOn;', 'uniform float cityExtentM;', 'uniform vec2 cityShiftM;',
      '// 밤 불빛 지도의 구름 밑면 배율(관측점 = 1)',
      'float cityF(vec3 position) {',
      '  if (cityTexOn < 0.5) return 1.0;',
      '  vec3 d = position - genusOrigin;',
      '  // genusOrigin 은 날씨 어긋남(ox, oy)만큼 관측점에서 옮겨져 있음 → 되돌려 관측점 중심으로',
      '  return texture(cityTex, (vec2(dot(d, genusEast), dot(d, genusNorth)) - cityShiftM) / cityExtentM + 0.5).r;',
      '}',
      'vec4 getLayerDensity',
    ].join('\n'))
      .replace(fin, '      radiance += cityUp * cityF(position) * exp(-0.15 * media.extinction * dot(weather.heightFraction * max(maxLayerHeights - minLayerHeights, vec4(1.0)), media.weight)) * exp(-(max(height, 0.0) - 1000.0) / 4000.0);\n' + fin);
    cm.uniforms.cityUp = { value: new Vector3() };
    cm.uniforms.cityTex = { value: null };
    cm.uniforms.cityTexOn = { value: 0 };
    cm.uniforms.cityExtentM = { value: 120000 };
    cm.uniforms.cityShiftM = { value: new Vector2() };
    cm.needsUpdate = true;
  }
  let farCover: { ringSig: number; draft: boolean; grids: FarCoverGrids } | null = null;
  let farMap: { key: string; ringSig: number; altDeg: number; azDeg: number; draft: boolean; map: FarSunMap } | null = null;
  /** 먼 구름 가림의 관측점 공기 그늘(1 − T_air) — 대기 패스(열린 하늘·연무·구름 너머 하늘)와 구름 패스 공기 원근에 곱함. */
  let farAirShadeV = 0;
  const setFarAirShade = (v: number) => {
    farAirShadeV = Math.min(1, Math.max(0, v));
    (aerial as unknown as { uniforms: Map<string, Uniform> }).uniforms.get('farAirShade')!.value = farAirShadeV;
    const cu = (clouds.cloudsPass.currentMaterial as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms;
    cu.cloudAirShadeC.value = Math.max(lastAirShadeC, farAirShadeV);
  };
  let lastAirShadeC = 0;
  // §25.8 해 쪽 추적 거리 상한 — 먼 거리 가림 지도가 켜지면 그 지도가 FAR_NEAR_KM 너머를 맡으므로 추적은 거기까지만(그늘 두 번 셈 방지).
  const setSunMaxM = (m: number) => { for (const mat of [clouds.cloudsPass.currentMaterial, clouds.shadowPass.currentMaterial]) { const u = (mat as unknown as { uniforms: Record<string, { value: number }> }).uniforms.genusSunMaxM; if (u) u.value = m; } };
  const applyFarSun = (p: VolumetricSceneInput, sunAltDeg: number) => {
    const cm = clouds.cloudsPass.currentMaterial as never;
    if (!opt.farSun || !p.macro || sunAltDeg > 10) { setFarSunUniforms(cm, null, [0, 1, 2, 2]); lastFarInfo = null; setFarAirShade(0); setSunMaxM(SUN_MARCH_MAX_M); return; }
    const ls = p.layers.slice(0, 4);
    const bandRange = (b: 'low' | 'mid' | 'high', d: [number, number]): [number, number] => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < ls.length; i++) {
        const x = ls[i];
        if (x && x.band === b && (x.cover ?? 0) > 0) {
          if (x.baseKm < lo) lo = x.baseKm;
          const top = x.baseKm + (x.thicknessM ?? 1000) / 1000;
          if (top > hi) hi = top;
        }
      }
      return lo <= hi ? [lo, hi] : d;
    };
    const bands = { low: bandRange('low', [0.8, 2.5]), mid: bandRange('mid', [2.5, 6]), high: bandRange('high', [7, 11]) };
    const sl = sun.clone().transformDirection(curNue.clone().invert());   // 국소 북(x)·위(y)·동(z)
    const sunAz = ((Math.atan2(sl.z, sl.x) * 180) / Math.PI + 360) % 360;
    // 고리 운량 전체의 간단한 지문(점 순서·운량) — 첫 점만 보면 해 쪽만 다른 두 장면이 같은 지도를 썼음(1차 하네스).
    let ringSig = 0;
    for (const b of ['low', 'mid', 'high'] as const) {
      const arr = p.macro[b];
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const q = arr[i];
        ringSig = (ringSig * 31 + Math.round(q.cover * 100) * (i + 1) + Math.round(q.distance) + Math.round(q.azimuthOffset) * 7) % 1000000007;
      }
    }
    const draft = isInteracting;
    const azQ = draft ? Math.round(sunAz / 3) : Math.round(sunAz * 5);
    const altQ = draft ? Math.round(sunAltDeg / 1.5) : Math.round(sunAltDeg * 10);
    const key = `${bands.low[0].toFixed(2)},${bands.low[1].toFixed(2)}|${bands.mid[0].toFixed(2)},${bands.mid[1].toFixed(2)}|${bands.high[0].toFixed(2)},${bands.high[1].toFixed(2)}|${azQ}|${altQ}|${ringSig}|${draft ? 1 : 0}`;
    const reuseFullDuringDraft = draft && farMap && !farMap.draft && farMap.ringSig === ringSig
      && Math.abs(farMap.altDeg - sunAltDeg) < 1.2 && Math.abs(farMap.azDeg - sunAz) < 2.5;
    if (!farMap || (farMap.key !== key && !reuseFullDuringDraft)) {
      if (!farCover || farCover.ringSig !== ringSig || (!draft && farCover.draft)) {
        farCover = { ringSig, draft, grids: buildFarCoverGrids(p.macro, undefined, 300, 420, draft ? 40 : 96) };
      }
      farMap?.map.tex.dispose();
      const map = buildFarSunMap(
        { ring: p.macro, bands, sunAzDeg: sunAz, sunAltDeg },
        draft ? 24 : 32,
        300,
        FAR_NEAR_KM,
        420,
        draft ? 12 : 8,
        farCover.grids,
      );
      farMap = { key, ringSig, altDeg: sunAltDeg, azDeg: sunAz, draft, map };
    }
    const ch = ls.map(x => (x?.band === 'mid' ? 1 : x?.band === 'high' ? 2 : 0));
    while (ch.length < 4) ch.push(0);
    setFarSunUniforms(cm, farMap.map, ch as [number, number, number, number]);
    setSunMaxM(FAR_NEAR_KM * 1000);
    lastFarInfo = { ms: farMap.map.ms, tLow: farMap.map.meanT[0], tMid: farMap.map.meanT[1], tHigh: farMap.map.meanT[2], tAir: farMap.map.meanT[3], tAirHere: farMap.map.centerT[3] };
    // 일몰 후(태양 고도 < −0.5°) 및 고도 10° 접근 시 부드럽게 감쇠해 farSun 온/오프 경계 단차를 없앱니다.
    const airSunWeight = Math.min(1, Math.max(0, (sunAltDeg + 0.5) / 1.3));
    const farSunFade = Math.min(1, Math.max(0, (10 - sunAltDeg) / 2.0));
    setFarAirShade((1 - farMap.map.centerT[3]) * airSunWeight * farSunFade);
  };
  const waveCacheMap = new Map<string, WaveField>();
  // WEATHER_CACHE_SIZE(32) 와 크기를 맞춰 24시간 프리워밍 중 파동 텍스처가 먼저 축출되지 않도록 함
  const WAVE_CACHE_SIZE = 32;
  let activeWaveField: WaveField | null = null;
  const waveCacheGet = (key: string): WaveField | null => {
    const f = waveCacheMap.get(key);
    if (f) { waveCacheMap.delete(key); waveCacheMap.set(key, f); }
    return f ?? null;
  };
  const waveCachePut = (key: string, field: WaveField) => {
    const prev = waveCacheMap.get(key);
    if (prev && prev !== field && prev !== activeWaveField) prev.tex.dispose();
    waveCacheMap.set(key, field);
    for (const [k, old] of waveCacheMap) {
      if (waveCacheMap.size <= WAVE_CACHE_SIZE) break;
      if (old === activeWaveField || k === key) continue;
      waveCacheMap.delete(k);
      old.tex.dispose();
    }
  };
  const genusMats = [clouds.cloudsPass.currentMaterial, clouds.shadowPass.currentMaterial] as never[];
  /** §25 물리 빛 균일변수. 끌기 중에는 해 쪽 걸음을 6 으로. */
  function applyCloudLight(): void {
    // 그늘 하늘빛(skyPhys): 2026-11-25 단위 오류(takram 하늘 조도 = 평면 × 2π)를 고쳐 다시 켬(계획 문서 §25.5 · §25.6).
    const light = physLight() ? { sunTopN: isInteracting ? 6 : 8, skyPhys: true, deck: true } : null;
    for (const m of genusMats) setGenusLight(m, light);
    // §26 가장자리 거칠기(종류 모형이 켜진 경우만 — 끄면 takram 그대로).
    for (const m of genusMats) setEdgeRough(m as never, opt.genus ? opt.edgeRough : 0);
    const rmU = (clouds.cloudsPass.resolveMaterial as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms;
    if (rmU.cloudAccum) rmU.cloudAccum.value = Math.max(0.02, Math.min(1, opt.cloudAccum));
  }
  applyCloudLight();
  // §178 조명 결함 고침 — 구름 패스 조각 셰이더는 cloudGenus 변형(setLightingFix, 원문 기억)이, 정점 셰이더와 대기 효과는 여기서 붙든 원문에서
  // 다시 만듭니다. 끄면 세 글자 모두 고치기 전과 바이트가 같습니다(verify-lighting-fixes.js).
  const cloudVert = clouds.cloudsPass.currentMaterial as unknown as { vertexShader: string; needsUpdate: boolean };
  const cloudVertBase = cloudVert.vertexShader;
  const aerialFx = aerial as unknown as { getFragmentShader(): string; setFragmentShader(s: string): void };
  const applyLightingFix = () => {
    const f = lightingFlags();
    setLightingFix(clouds.cloudsPass.currentMaterial as never, f);
    const vs = applyLightingFixCloudsVertex(cloudVertBase, f);
    if (cloudVert.vertexShader !== vs) { cloudVert.vertexShader = vs; cloudVert.needsUpdate = true; }
    const fs = applyLightingFixAerial(aerialBase, f);
    if (aerialFx.getFragmentShader() !== fs) aerialFx.setFragmentShader(fs);   // EffectPass 가 change 사건으로 다시 합칩니다
  };
  applyLightingFix();
  if (opt.keepIceShaderLoaded) {
    for (const m of genusMats) setGenusPhysics(m, [], false, true);
  }
  // §179 T_sun(하네스 전용, 기본 끔) — 구름 패스 재질만. 글자는 tsun 1 이고 해 ≤ shadowMinSunDeg(lastShadow === false)일 때만 들어갑니다(v2.1 eng m2:
  // 위에서는 C0ps 글자와 바이트 같음). 아틀라스는 setTsunAtlas 로 받고, 없거나 옵션과 안 맞으면 gTsunOn 0(= C0ps 빛) — 하네스가 tsunInfo 로 확인.
  let tsunAtlas: TsunAtlas | null = null;
  let tsunAtlasValid = false;
  let tsunReason: string | null = null;
  let tsunSamplers: { count: number; limit: number; limitKnown: boolean } | null = null;
  let tsunArchW = 0;
  /** applyScene 마다 1 씩 — 다른 장면에서 지은 아틀라스를 걸지 않게(cloudTsun.ts D11). */
  let sceneSerial = 0;
  /** §173 관측점의 종류 평면 좌표(km) = weatherOffsetKm ?? camKm ?? 0 — 아틀라스 중심(하네스 구축 입력). */
  let tsunObsKm: [number, number] = [0, 0];
  const maxTextureUnits = () => (renderer.capabilities as unknown as { maxTextures?: number } | undefined)?.maxTextures;
  const applyTsun = () => {
    const mat = clouds.cloudsPass.currentMaterial as never;
    if (opt.tsun !== 1 && opt.tsunRef !== 0) {
      // §179 WP6 REF 팔(REF_v2·REF_val): 아틀라스·텍스처·샘플러 없음 — gTsunOn 1, 무차별 행진 보폭·끝은 균일변수. 글자는 T 팔과 같은 불리언(해 ≤ shadowMinSunDeg).
      tsunSamplers = null; tsunAtlasValid = false; tsunReason = null; tsunArchW = 0;
      setTsunUniforms(mat, tsunUniformValues(null, 0, 0, { stepM: opt.tsunRefStepM, rangeKm: opt.tsunRangeKm }));
      setTsunShader(mat, lastShadow === false ? { arch: false, ref: opt.tsunRef, debug: opt.tsunDebug === 1 ? 1 : 0 } : null);
      return;
    }
    if (opt.tsun !== 1) {
      tsunSamplers = null; tsunAtlasValid = false; tsunReason = 'tsun 0'; tsunArchW = 0;
      setTsunShader(mat, null);
      return;
    }
    // WP0: 정적 샘플러 수 + 1 > MAX_TEXTURE_IMAGE_UNITS 면 throw(하네스 — 조용히 끄지 않음).
    tsunSamplers = checkTsunSamplerBudget(curQuality, maxTextureUnits());
    let atlas = tsunAtlas;
    tsunReason = atlas ? null : 'no atlas';
    if (atlas) {
      try { validateTsunAtlas(atlas, opt, sceneSerial); } catch (e) { atlas = null; tsunReason = (e as Error).message; }
    }
    tsunAtlasValid = !!atlas;
    tsunArchW = opt.archLight === 1 ? archWeight(lastSunAltForLight) : 0;
    setTsunUniforms(mat, tsunUniformValues(atlas, tsunArchW, opt.archNoT));   // 값 먼저 — 글자를 넣을 때 이 값으로 균일변수를 만듦
    setTsunShader(mat, lastShadow === false ? { arch: opt.archLight === 1, ...(opt.tsunDebug === 1 ? { debug: 1 as const } : {}) } : null);
  };
  const baseWeatherRepeat = clouds.localWeatherRepeat.clone();
  let cachedNoise = cloudNoiseCache.get(renderer);
  if (!cachedNoise) {
    const shape = new CloudShape();
    await new Promise(r => setTimeout(r, 0));
    const shapeDetail = new CloudShapeDetail();
    const turbulence = new Turbulence();
    const stbn = makeWhiteNoise3D();
    await new Promise(r => setTimeout(r, 0));
    cachedNoise = { shape, shapeDetail, turbulence, stbn };
    cloudNoiseCache.set(renderer, cachedNoise);
  }
  clouds.shapeTexture = cachedNoise.shape;
  clouds.shapeDetailTexture = cachedNoise.shapeDetail;
  clouds.turbulenceTexture = cachedNoise.turbulence;
  clouds.stbnTexture = cachedNoise.stbn;

  // 대기 표: 기기 GPU 에서 만듭니다(자산 25MB 를 싣지 않으려고). 하네스는 takram 의 미리 만든 표를 넘겨 비교할 수 있습니다.
  let generator: PrecomputedTexturesGenerator | null = null;
  if (!options.precomputed) {
    const effTrans = options.effectiveTransmittance ?? true;
    const cacheKey = `${spectral ? '15w' : '3w'}_${effTrans ? '1' : '0'}`;
    let mapForRenderer = atmosGeneratorCache.get(renderer);
    if (!mapForRenderer) {
      mapForRenderer = new Map();
      atmosGeneratorCache.set(renderer, mapForRenderer);
    }
    const cached = mapForRenderer.get(cacheKey);
    if (cached) {
      generator = cached.generator;
      if (!cached.spectral && spectral) {
        spectral = false;
        atmosphereParams.skyRadianceToRelativeLuminance.copy(renderAtmosphere(false).skyRadianceToRelativeLuminance);
      }
    } else {
      generator = new PrecomputedTexturesGenerator(renderer);
      if (spectral && !patchSpectralGenerator(generator, { effectiveTransmittance: effTrans })) {
        spectral = false;
        atmosphereParams.skyRadianceToRelativeLuminance.copy(renderAtmosphere(false).skyRadianceToRelativeLuminance);
        console.warn('[volumetric] takram 표 생성기 내부가 달라 3파장 표로 만듭니다');
      }
      await generator.update();
      mapForRenderer.set(cacheKey, { generator, spectral });
    }
  }
  const atmosTextures = options.precomputed ?? generator!.textures;
  Object.assign(aerial, atmosTextures);
  Object.assign(clouds, atmosTextures);

  // 표시 곡선(§125): 사진 밝기비 자에서 AgX 1/4 · ACES 2/4 · Neutral 2/4, 노을 '가장 붉은 곳의 색'에서
  // AgX 3/4 · ACES 3/4 · Neutral 1/4 → ACES. AgX 는 햇빛 받은 구름을 하늘의 4.2배 → 2.4배로 눌렀습니다.
  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const composer = new EffectComposer(renderer, { frameBufferType: opt.bufferType === 'float' ? FloatType : HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera, clouds, aerial));
  const tonePass = new EffectPass(camera, toneMapping);
  composer.addPass(tonePass);
  composer.setSize(width, height);

  let weather: DataTexture | null = null;
  /** 마지막 날씨 생성 시간(ms) — 시험 화면 표시용. */
  let weatherMs = 0;
  // §130 C3 층별 드리프트 — 장면을 건 층·시각(setDate 가 경과 시간만큼 uv 를 밈).
  let genLayers: (GenusLayer | null)[] = [], genDate: Date | null = null, genUv = false;
  /**
   * §156 거시 격자 상태 — 띠마다 표본·잡음 상태·장, 텍스처 두 장(A 이전 → B 지금, 1 분에 한 번 갈아 끼우며 mix 로 섞음), 문턱 표.
   */
  type MacroBand = 'low' | 'mid' | 'high';
  let macro: {
    samples: Partial<Record<MacroBand, MacroSample[]>>; states: Partial<Record<MacroBand, MacroState>>; fields: Partial<Record<MacroBand, MacroField>>;
    texA: DataTexture; texB: DataTexture; lut: DataTexture; laneBand: Array<MacroBand | null>; n: number; extentKm: number;
    lastSec: number | null;
    spanMs?: [number, number];
    cachedTex?: boolean;
  } | null = null;
  const MACRO_STEP_SEC = 60;
  const macroTexCache = new Map<string, DataTexture>();
  const MACRO_TEX_CACHE_MAX = 16;
  const macroRingSamplesOf = (ring?: Partial<Record<MacroBand, MacroRingPoint[]>>): Partial<Record<MacroBand, MacroSample[]>> => {
    const samples: Partial<Record<MacroBand, MacroSample[]>> = {};
    if (!ring) return samples;
    for (const b of ['low', 'mid', 'high'] as MacroBand[]) {
      const pts = ring[b];
      if (pts && pts.length >= 12) samples[b] = samplesFromRing(pts.map(q => ({ distance: q.distance, azimuthOffset: q.azimuthOffset, cover: q.cover * 100 })));
    }
    return samples;
  };
  const getOrBuildCachedMacroTex = (samples: Partial<Record<MacroBand, MacroSample[]>>, n: number, extentKm: number): DataTexture => {
    const effN = isInteracting ? Math.min(n, 64) : n;
    let sig = `${effN}|${extentKm}`;
    for (const b of ['low', 'mid', 'high'] as MacroBand[]) {
      const sm = samples[b];
      sig += `|${b}:`;
      if (sm) for (let i = 0; i < sm.length; i++) sig += `${Math.round(sm[i].cover * 1000)},`;
    }
    const hit = macroTexCache.get(sig);
    if (hit) {
      macroTexCache.delete(sig);
      macroTexCache.set(sig, hit);
      return hit;
    }
    const fields: Partial<Record<MacroBand, Float32Array>> = {};
    for (const b of ['low', 'mid', 'high'] as MacroBand[]) {
      const sm = samples[b];
      if (!sm) continue;
      fields[b] = buildMacroField(sm, { n: effN, cellKm: extentKm / effN, noise: false }, null).cover;
    }
    const tex = makeMacroTexture(effN, { low: fields.low, mid: fields.mid, high: fields.high });
    macroTexCache.set(sig, tex);
    for (const [k, old] of macroTexCache) {
      if (macroTexCache.size <= MACRO_TEX_CACHE_MAX) break;
      if (macro && (old === macro.texA || old === macro.texB)) continue;
      macroTexCache.delete(k);
      old.dispose();
    }
    return tex;
  };
  const macroMixAt = (date: Date, spanMs?: [number, number]): number => {
    if (!spanMs) return 0;
    const [t0, t1] = spanMs;
    if (!(t1 > t0)) return 0;
    return Math.min(1, Math.max(0, (date.getTime() - t0) / (t1 - t0)));
  };
  const disposeMacro = () => {
    if (!macro) return;
    if (!macro.cachedTex) {
      macro.texA.dispose();
      if (macro.texB !== macro.texA) macro.texB.dispose();
    }
    macro.lut.dispose();
    macro = null;
  };
  const macroBuildFields = (m: NonNullable<typeof macro>, noise: boolean) => {
    for (const b of ['low', 'mid', 'high'] as MacroBand[]) {
      const sm = m.samples[b]; if (!sm) continue;
      const fld = buildMacroField(sm, { n: m.n, cellKm: m.extentKm / m.n, noise }, m.states[b] ?? null);
      m.fields[b] = fld; m.states[b] = fld.state;
    }
    return makeMacroTexture(m.n, { low: m.fields.low?.cover, mid: m.fields.mid?.cover, high: m.fields.high?.cover });
  };
  /**
   * 띠 표본의 상위 분위수 — 타일 운량을 이만큼 올려 잡아 셰이더 문턱이 깎을 여지를 둡니다(문턱은 타일 운량 위로는 못 올림).
   * 150 km 안 p75 에 더해 2026-11-19 테두리 덱(50~385 km) 몫으로 400 km 안 p90 — 서울 일출에서 동쪽 70~130 km 저층 47~76 % 가
   * 관측점 운량(11 %)짜리 타일에 막혀 지평선에 거의 안 그려졌음.
   */
  const macroTileCover = (pts: MacroRingPoint[] | undefined, cover: number, nextPts?: MacroRingPoint[], envCover?: number) => {
    if (envCover != null && envCover > 0) return Math.max(cover, envCover);
    const calc = (arr: MacroRingPoint[] | undefined) => {
      if (!arr || arr.length < 12) return cover;
      const pick = (maxKm: number, q: number) => {
        const v = arr.filter(x => x.distance <= maxKm).map(x => Math.min(1, Math.max(0, x.cover))).sort((a, b) => a - b);
        return v.length < 6 ? 0 : v[Math.min(v.length - 1, Math.floor(v.length * q))];
      };
      return Math.max(cover, pick(150, 0.75), pick(400, 0.9));
    };
    return Math.max(calc(pts), nextPts ? calc(nextPts) : 0);
  };
  /** §155 하늘 화면이 준 드리프트 시각(초) — `setDate` 의 두 번째 인자. 없으면 씬 시각. */
  let driftSecOverride: number | null = null;
  /** §131 K 가 고른 관측점 오프셋(km) — 진단·하네스 출력용 */
  let lastCamKm: [number, number] | null = null;
  let lastWaveInfo: Record<string, number> | null = null;
  let lastFarInfo: Record<string, number> | null = null;
  let lastAirShade = 0;
  /** §136 마지막 장면의 층별 물리 값(진단·하네스 출력용) — 물리가 꺼져 있으면 null */
  let lastPhysics: (LayerPhysics | null)[] | null = null;
  const sun = new Vector3();

  let lastInput: VolumetricSceneInput | null = null;
  let last: { sunAltDeg: number; exposure: number } | null = null;
  let curPos = new Vector3(), curNue = new Matrix4();
  let lastShadow: boolean | null = null;
  /**
   * §178 g2 — applyScene 이 정한 층별 그림자 지도(BSM) 드리움 자격(해 고도와 무관: 종류 없는 상층·빈 채널은 false). setDate 가 해 12° 를 넘을 때
   * 이것만 다시 겁니다 — 예전에는 `layer.shadow !== undefined`(CloudLayer.shadow 기본 false 라 늘 참)로 모든 층을 켜서, 다시 만들지 않고 해가 12° 를
   * 위로 넘으면 운량 0·상층·빈 채널까지 드리워 그림자 지도 꼭대기가 5.4 → 10.4 km 로 뛰고 low 25 걸음 행진이 저층을 놓쳤습니다(§177.6).
   * 기록: 자격은 applyScene 규칙 그대로라 운량 0 인 중·저층은 여전히 드리우고(꼭대기 5.4 km — 빈 BSM 비용뿐), 종류 권운 층도 설계상 드리웁니다
   * (g3, 꼭대기 9.8 km — 바꾸지 않음). 이 마스크·꼭대기 0 은 clampInscatter·irradianceLogMu 와 달리 스위치가 없습니다.
   */
  let castEligible: boolean[] = [];
  const layerU = (clouds as unknown as { layerUniforms: { shadowTopHeight: Uniform<number>; shadowBottomHeight: Uniform<number> } }).layerUniforms;
  /** 자격 × 해 고도 조건으로 층 그림자를 겁니다. 아무 층도 드리우지 않으면 그림자 지도 꼭대기·밑을 0 으로 — takram(Ht)은 이때 꼭대기를 지우지 않아 낡은 값이 남았습니다. */
  const applyCastMask = (on: boolean) => {
    let any = false;
    clouds.cloudLayers.forEach((layer, i) => { const c = on && !!castEligible[i]; layer.shadow = c; if (c && layer.height > 0) any = true; });
    if (!any) { layerU.shadowTopHeight.value = 0; layerU.shadowBottomHeight.value = 0; }
  };
  const rollAxis = new Vector3();
  const applyRollToUp = (fwd: Vector3, rollDeg?: number) => {
    if (!rollDeg || Math.abs(rollDeg) <= 1e-4) return;
    rollAxis.copy(fwd).normalize();
    camera.up.applyAxisAngle(rollAxis, radians(rollDeg));
  };
  const placeCamera = (p: VolumetricSceneInput) => {
    const az = radians(p.az), el = radians(p.el);
    const position = curPos, nue = curNue;
    camera.fov = p.fov;
    const alt = p.altitudeM ?? 2;
    let worldToECEF: Matrix4;
    if (opt.frame === 'ecef') {
      // takram 기본: 장면 좌표 = ECEF. 카메라를 관측점에 두고, 위쪽을 그 자리의 연직으로.
      worldToECEF = new Matrix4();
      const north = new Vector3(), up = new Vector3(), east = new Vector3();
      nue.extractBasis(north, up, east);
      const dir = north.clone().multiplyScalar(Math.cos(el) * Math.cos(az))
        .addScaledVector(up, Math.sin(el)).addScaledVector(east, Math.cos(el) * Math.sin(az));
      camera.position.copy(position).addScaledVector(up, alt).addScaledVector(north, eyeNorthM).addScaledVector(east, eyeEastM);
      // 직하향 탑다운(레이더 뷰)일 때 up 벡터가 dir과 평행해지는 짐벌락 방지 -> 지도 북쪽을 화면 위로 정렬
      if (Math.sin(el) < -0.98) {
        camera.up.copy(north);
      } else {
        camera.up.copy(up);
      }
      applyRollToUp(dir, p.rollDeg);
      camera.lookAt(camera.position.clone().add(dir));
    } else {
      // 장면 좌표는 북·위·동(NUE).
      worldToECEF = nue;
      camera.position.set(eyeNorthM, alt, eyeEastM);
      if (Math.sin(el) < -0.98) {
        camera.up.set(1, 0, 0); // 북쪽(X축)
      } else {
        camera.up.set(0, 1, 0);
      }
      const dirLocal = new Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
      applyRollToUp(dirLocal, p.rollDeg);
      camera.lookAt(eyeNorthM + dirLocal.x, alt + dirLocal.y, eyeEastM + dirLocal.z);
    }
    aerial.worldToECEFMatrix.copy(worldToECEF);
    clouds.worldToECEFMatrix.copy(worldToECEF);
    // 2026-11-18 하늘 화면 카메라의 화면 중심 이동(setViewOffset)을 똑같이 — 빠지면 구름·해/달 빛무리 층이 천체 표시와 위아래로 어긋남(사용자 보고).
    if (Math.abs(viewOffsetYFrac) > 1e-4) camera.setViewOffset(1000, 1000, 0, viewOffsetYFrac * 1000, 1000, 1000);
    else if (camera.view?.enabled) camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const prevHighAlt = lastViewAltM > 250;
    lastViewElDeg = p.el;
    lastViewAltM = alt;
    if ((lastViewAltM > 250) !== prevHighAlt) {
      applyInteractionLod();
    } else {
      applyPrimaryMarch();
    }
    updateLod();
  };
  /**
   * 빛의 방향·고도(°). 기본은 해. 밤(해 −10° 아래)에 달이 떠 있으면 달(2026-11-13 달빛): 달빛은 햇빛을 반사한 빛이라 스펙트럼이 거의 같고
   * 세기만 다름 — 같은 대기·구름 계산에 방향만 달로 두고 노출을 그 세기만큼 올림(moonGain). 해 원반은 달 자리에 둥근 달로 그려짐(위상 모양은 없음).
   *   세기 = 2.5·10⁻⁶(보름달/해, 14 등급) × 10^(−0.4·(0.026α + 4·10⁻⁹α⁴)), α = 위상각 ≈ 180° − 이각(Allen).
   */
  const moonVec = new Vector3();
  let moonGain = 0;   // 0 이면 해가 빛, 아니면 달빛 세기(해 대비)
  const altOf = (v: Vector3) => {
    const local = v.clone().transformDirection(curNue.clone().invert());
    return (Math.asin(Math.max(-1, Math.min(1, local.y))) * 180) / Math.PI;
  };
  let lastTrueSunAlt = 90;
  let moonBlend = 0;
  let rawMoonGain = 0;
  let rawMoonAlt = -90;
  const MOON_SKY_COLOR = new Vector3(0.0075, 0.0120, 0.0235);
  const MOON_TERRAIN_COLOR = new Vector3(0.0065, 0.0098, 0.0175);
  const MOON_CLOUD_COLOR = new Vector3(0.0120, 0.0160, 0.0240);
  const TWILIGHT_SKY_COLOR = new Vector3(0.0045, 0.0078, 0.0165);
  const TWILIGHT_TERRAIN_COLOR = new Vector3(0.0038, 0.0062, 0.0125);
  const TWILIGHT_CLOUD_COLOR = new Vector3(0.0060, 0.0090, 0.0160);
  const sunAltAt = (date: Date) => {
    getSunDirectionECEF(date, sun);
    const sunAlt = altOf(sun);
    lastTrueSunAlt = sunAlt;
    moonGain = 0;
    moonBlend = 0;
    rawMoonGain = 0;
    rawMoonAlt = -90;
    // 시민박명(-6°)과 항해박명(-11.5°) 동안에도 달이 떠 있으면 잔류 달빛을 추적해
    // -11.5° 광원 전환 경계에서 하늘·구름·건물 조도가 뚝 떨어지지 않고 연속 이어지게 합니다.
    if (opt.moonLight && sunAlt < -4.0) {
      const obsElevM = lastInput ? Math.max(0, (lastInput.heightM ?? 0) + (lastInput.altitudeM ?? 2)) : 0;
      if (lastInput) {
        const mp = getMoonPositionPrecise(date, lastInput.lat, lastInput.lon, obsElevM);
        const mAlt = mp.altitude;
        const mAz = mp.azimuth + Math.PI;
        moonVec.set(
          Math.cos(mAlt) * Math.cos(mAz),
          Math.sin(mAlt),
          Math.cos(mAlt) * Math.sin(mAz),
        ).transformDirection(curNue).normalize();
      } else {
        getMoonDirectionECEF(date, moonVec);
      }
      const moonAlt = altOf(moonVec);
      const horizonDipDeg = seaHorizonDipDeg(obsElevM);
      const elong = (Math.acos(Math.max(-1, Math.min(1, sun.dot(moonVec)))) * 180) / Math.PI;
      const a = 180 - elong;
      const gain = 2.5e-6 * Math.pow(10, -0.4 * (0.026 * a + 4e-9 * a ** 4));
      // 초승달(위상각 140° 넘음, 보름의 2 % 아래)이나 지평선 아래 달은 쓰지 않음.
      if (moonAlt > -(horizonDipDeg + 0.8) && a < 140) {
        rawMoonGain = gain;
        rawMoonAlt = moonAlt;
        if (sunAlt < -11.5) {
          sun.copy(moonVec);
          moonGain = gain;
          const bt = Math.max(0, Math.min(1, (-11.5 - sunAlt) / 2.0));
          moonBlend = bt * bt * (3 - 2 * bt);
          return moonAlt;
        }
      }
    }
    return sunAlt;
  };
  /**
   * 달빛 노출. 렌더는 달 방향에서 햇빛 세기 그대로 빛을 계산하므로 실제 휘도는 그 × moonGain. 눈이 밤에 맞춰진 노출 = 낮 노출 ÷ 보름 세기 × MOON_DIM
   * 이라 화면에 곱할 값은 낮 노출 × MOON_DIM × (moonGain / 보름 세기)^½.
   * 1차 하네스: 1/64·위상 그대로면 보름도 거의 검고 반달(보름의 1/10)은 완전히 검었음 → 보름 −3 단(1/8), 위상은 제곱근(눈이 위상에도 적응; 반달 ≈ −1.7 단 더).
   */
  const MOON_FULL = 2.5e-6;
  const MOON_DIM = 0.065;
  const moonExposureOf = (mAlt: number, mGain: number, cityA: number) => {
    if (mGain <= 0) return 0;
    const La = MOONLIT_CLOUD_CD * (mGain / MOON_FULL) + cityA;
    const moonAltT = Math.max(0, Math.min(1, (mAlt + 0.5) / 12.0));
    const moonAltDim = 0.22 + 0.78 * moonAltT * moonAltT * (3 - 2 * moonAltT);
    return autoExposure(Math.max(15, mAlt)) * MOON_DIM * moonAltDim * (mGain / MOON_FULL) * Math.sqrt(MOONLIT_CLOUD_CD / Math.max(La, 1e-4));
  };
  /**
   * 도시 불빛(2026-11-13). 광공해 설정 c(0~1, 6.5 → 3 등급) → 한계 등급 m = 6.5 − 3.5c → 천정 밝기 SQM ≈ 14.5 + 1.08m(mag/arcsec²)
   * → 인공 천정 휘도 L_art = 10.8만·(10^(−0.4·SQM) − 10^(−0.4·21.6)) cd/m²(도심 3 등급 ≈ 0.009). 낮고 두꺼운 구름 밑면은 그 약 8 배
   * (흐린 도시 밤이 맑은 밤보다 수 배 밝음 — 구름이 땅 빛을 되돌림). 밤 10 시부터 불이 꺼지며 줄어듦(새벽 2~5 시 0.6, 6 시 반까지 0.8).
   * 렌더 단위 = 휘도 × 4.3·10⁻⁶ ÷ g(빛이 해면 1, 달이면 달빛 세기) — 낮 노출 7.2 가 맑은 하늘(약 6000 cd/m²)을 0.19 로 보이는 것에서.
   */
  const CD_TO_RENDER = 4.3e-6;
  const MOONLIT_CLOUD_CD = 0.056;   // 보름달이 비춘 구름 휘도(0.25 lux × 0.7 / π)
  const CITY_COLOR = new Vector3(1.22, 0.96, 0.70);   // 흰빛에 가까운 호박색(휘도 1) — 옛 슬랩 §13-D 색
  let cityLight = 0;
  let cityTerrainExpScale = 1;
  let cityMap: NightLights | null = null;
  let cityField: { key: string; f: CityLightField; tex: DataTexture } | null = null;
  const applyCityMap = (p: VolumetricSceneInput) => {
    const au = (aerial as unknown as { uniforms: Map<string, Uniform> }).uniforms;
    const cu = (clouds.cloudsPass.currentMaterial as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms;
    const preField = !cityMap ? getPrehydratedCityLightField(p.lat, p.lon) : null;
    if (!cityMap && !preField) { au.get('cityAzOn')!.value = 0; cu.cityTexOn.value = 0; return; }
    const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
    if (!cityField || cityField.key !== key) {
      cityField?.tex.dispose();
      const f = preField ?? cityLightField(cityMap!, p.lat, p.lon);
      const half = new Uint16Array(f.n * f.n);
      for (let i = 0; i < half.length; i++) half[i] = DataUtils.toHalfFloat(f.patch[i]);
      const tex = new DataTexture(half, f.n, f.n, RedFormat, HalfFloatType);
      tex.minFilter = LinearFilter; tex.magFilter = LinearFilter; tex.wrapS = ClampToEdgeWrapping; tex.wrapT = ClampToEdgeWrapping; tex.needsUpdate = true;
      cityField = { key, f, tex };
    }
    const az = au.get('cityAz')!.value as number[];
    for (let i = 0; i < 36; i++) az[i] = cityField.f.azGain[i];
    au.get('cityAzOn')!.value = 1;
    const e = curNue.elements;
    (au.get('cityNorth')!.value as Vector3).set(e[0], e[1], e[2]).normalize();
    (au.get('cityEast')!.value as Vector3).set(e[8], e[9], e[10]).normalize();
    cu.cityTex.value = cityField.tex;
    cu.cityTexOn.value = 1;
    cu.cityExtentM.value = cityField.f.halfKm * 2000;
    (cu.cityShiftM.value as Vector2).set(tsunObsKm[0] * 1000, tsunObsKm[1] * 1000);
  };
  let cityState: { artCd: number; baseCd: number; adaptCd: number; timeF: number } | null = null;
  const cityTimeF = (date: Date, lonDeg: number) => {
    const h = ((date.getUTCHours() + date.getUTCMinutes() / 60 + lonDeg / 15) % 24 + 24) % 24;
    if (h >= 22) return 1.0 - 0.32 * (h - 22) / 2;
    if (h < 2) return 0.68 - 0.33 * (h / 2);
    if (h < 5) return 0.35;
    if (h < 7) return 0.35 + 0.40 * (h - 5) / 2;
    if (h < 18) return 0.75;
    return 0.75 + 0.25 * (h - 18) / 4;
  };
  const updateCity = (p: VolumetricSceneInput | null, date: Date) => {
    const au = (aerial as unknown as { uniforms: Map<string, Uniform> }).uniforms;
    const cu = (clouds.cloudsPass.currentMaterial as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms;
    if (!p) {
      cityState = null; au.get('cityAirOn')!.value = 0; (au.get('cityTerrainIrr')!.value as Vector3).set(0, 0, 0); (au.get('cityUplightIrr')!.value as Vector3).set(0, 0, 0); (cu.cityUp.value as Vector3).set(0, 0, 0); (au.get('farCityUp')!.value as Vector3).set(0, 0, 0); return;
    }
    const hasCity = cityLight > 0.01;
    if (hasCity) applyCityMap(p);
    else { au.get('cityAzOn')!.value = 0; cu.cityTexOn.value = 0; }
    const f = hasCity ? (cityField?.f ?? null) : null;
    const cityActive = hasCity && (!f || f.skyGlow > 1e-4 || f.maxPatch > 1e-4);
    const m = 6.5 - 3.5 * cityLight, sqm = 14.5 + 1.08 * m;
    const timeF = cityTimeF(date, p.lon);
    const peakArtCd = cityActive ? Math.max(0, 10.8e4 * (Math.pow(10, -0.4 * sqm) - Math.pow(10, -0.4 * 21.6))) : 0;
    const refArtCd = peakArtCd * timeF;
    const refBaseCd = 8 * refArtCd;
    const glowScale = cityActive ? (f ? f.skyGlow : 1) : 0;
    const cloudLocalScale = cityActive ? (f ? Math.min(1.25, Math.max(0, f.local / CITY_REF_LOCAL)) : 1) : 0;
    const artCd = refArtCd * glowScale;
    const baseCd = refBaseCd * cloudLocalScale;
    const low = p.layers.filter(L => L && L.cover > 0 && (L.band ?? (L.baseKm < 2 ? 'low' : 'mid')) === 'low').reduce((a, L) => Math.max(a, Math.min(1, L.cover)), 0);
    // 암순응 기준 휘도(adaptCd)는 시간대(timeF)를 빼고 지역 피크 기준으로 고정해, 심야 소등이 노출 상승에 의해 상쇄되지 않게 함
    const peakLocalArt = peakArtCd * glowScale;
    const peakLocalBase = 8 * peakArtCd * cloudLocalScale;
    const adaptCd = peakLocalArt + (peakLocalBase - peakLocalArt) * low;
    cityState = cityActive ? { artCd, baseCd, adaptCd, timeF } : null;
    const cloudBounce = 1 + 0.65 * low;
    // 도시 하늘빛(cityAir)·구름 밑면(cityUp, farCityUp)·지표면 간접광(cityTerrainIrr, cityUplightIrr) 모두
    // 해 −12° / −11.5° 문턱에서 스케일(g)이 뛰거나 fp16 언더플로(0)로 꺼지지 않도록 현재 노출(curExpBase) 역수 비율로 통일합니다.
    const sunsetT = Math.max(0, Math.min(1, (2.0 - lastTrueSunAlt) / 8.0));
    const sunsetFade = sunsetT * sunsetT * (3 - 2 * sunsetT);
    const nightExpBase = autoExposure(45) * MOON_DIM * 0.65 * Math.sqrt(MOONLIT_CLOUD_CD / Math.max(adaptCd, 0.0012));
    const curExpBase = Math.max(1e-4, baseExposureFor(lastSunAltForLight, p));
    const terrainIrrScale = ((nightExpBase / MOON_FULL) * sunsetFade) / curExpBase;
    // 해 −13.5° → −11.5° 구간에서 달 광원(LUT)이 태양 광원으로 넘어갈 때 사라지는 달빛 산란·조도와
    // 항해박명(−12.5° → −5.0°, 60km 대기표 그림자 공백)의 여명 하늘·지면 조도를 연속으로 이어받아
    // 일출 전 어느 1분 구간에서도 밝기가 역전(어두워짐)되지 않고 단조 증가하게 합니다.
    const fullMoonExp = moonExposureOf(rawMoonAlt, rawMoonGain, adaptCd);
    const dawnMoonFadeT = Math.max(0, Math.min(1, (-4.0 - lastTrueSunAlt) / 3.5));
    const dawnMoonFade = dawnMoonFadeT * dawnMoonFadeT * (3 - 2 * dawnMoonFadeT);
    const lunarTransfer = rawMoonGain > 0
      ? (moonGain > 0 ? 1 - Math.max(0.02, moonBlend) : dawnMoonFade)
      : 0;
    const lunarScale = (lunarTransfer * fullMoonExp) / curExpBase;
    const twRiseT = Math.max(0, Math.min(1, (lastTrueSunAlt + 12.5) / 5.5));
    const twRise = twRiseT * twRiseT * (3 - 2 * twRiseT);
    const twFadeT = Math.max(0, Math.min(1, (-5.0 - lastTrueSunAlt) / 2.8));
    const twFade = twFadeT * twFadeT * (3 - 2 * twFadeT);
    const skyDeckAtten = Math.max(0.22, lastDeckT);
    const twilightScale = (twRise * twFade * skyDeckAtten) / curExpBase;

    // 3D 구름 밑면은 cityTex(patch = 절대 도시 비율)가 자리마다 곱해주므로 3등급 기준 refBaseCd 를 넘깁니다.
    (cu.cityUp.value as Vector3)
      .copy(CITY_COLOR).multiplyScalar(refBaseCd * CD_TO_RENDER * terrainIrrScale)
      .addScaledVector(MOON_CLOUD_COLOR, lunarScale)
      .addScaledVector(TWILIGHT_CLOUD_COLOR, twilightScale);
    (au.get('farCityUp')!.value as Vector3)
      .copy(CITY_COLOR).multiplyScalar(refBaseCd * glowScale * CD_TO_RENDER * terrainIrrScale)
      .addScaledVector(MOON_CLOUD_COLOR, lunarScale)
      .addScaledVector(TWILIGHT_CLOUD_COLOR, twilightScale);
    (au.get('cityAir')!.value as Vector3)
      .copy(CITY_COLOR).multiplyScalar(artCd * CD_TO_RENDER * terrainIrrScale)
      .addScaledVector(MOON_SKY_COLOR, lunarScale * skyDeckAtten)
      .addScaledVector(TWILIGHT_SKY_COLOR, twilightScale);
    // 전역 간접광은 산 실루엣을 살리는 수준(artCd * 10.5)으로 유지하고, 도심 건물 외벽은 국소 지상 광량(local^1.45)으로 분리해 대도시/시골 대비를 구현
    (au.get('cityTerrainIrr')!.value as Vector3)
      .copy(CITY_COLOR).multiplyScalar(artCd * 10.5 * CD_TO_RENDER * cloudBounce * cityTerrainExpScale * terrainIrrScale)
      .addScaledVector(MOON_TERRAIN_COLOR, lunarScale * skyDeckAtten * cityTerrainExpScale)
      .addScaledVector(TWILIGHT_TERRAIN_COLOR, twilightScale * cityTerrainExpScale);
    const localUplightCd = refArtCd * Math.pow(Math.max(0, cloudLocalScale), 1.45);
    (au.get('cityUplightIrr')!.value as Vector3).copy(CITY_COLOR).multiplyScalar(localUplightCd * 42.0 * CD_TO_RENDER * cloudBounce * cityTerrainExpScale * terrainIrrScale);
    au.get('cityAirOn')!.value = (glowScale > 1e-4 || lunarScale > 1e-7 || twilightScale > 1e-7) ? 1 : 0;
  };
  /**
   * 노출. 해: 해 고도 표. 밤(달 또는 도시 불빛): 눈이 맞춘 휘도 L_a(달빛 구름 + 도시)로 낮 노출 × MOON_DIM × (g/보름)·√(0.056/L_a)
   * — 달만이면 위의 달빛 식과 같음. 달 없이 도시만이면 해 −12° 아래에서 보름 세기 눈금으로(도시 빛은 −12° → −14° 에서 켜짐).
   */
  /**
   * 흐린 날 노출 보정(2026-11-13). 노출 표는 맑은 하늘에 맞춘 것. 구름층 아래 하늘 휘도 ∝ 확산 투과율 T × 맑은 날 수평면 일사,
   * 맑은 하늘 휘도 ∝ 그 일사의 확산 몫 f(해 고도: 높으면 약 0.12, 지평선에서 1 에 가까움). 비 R = T/f 가 1 보다 작으면(해가 낮은 흐린 날)
   * 눈·카메라처럼 R^−0.7 만큼(최대 4 배) 밝힘. 한낮(τ 21: T 0.30, f 0.12 → R 2.5)은 그대로 — 위성 일사로 맞춘 흐린 날 밝기를 건드리지 않음.
   * 신발타 11월 2일 16:32(해 1.2°, 비) 재현: 구름층 20/255(맑은 하늘 120~190) → 약 4 배.
   * T = Π(1 − 운량·(1 − T_종류)), 파동 장(흐린 날 채우기)은 그 기둥 τ 로 T = 1/(1 + 0.75·0.15·τ).
   */
  const TD_GENUS: Record<string, number> = { ns: 0.12, cb: 0.08, cbanvil: 0.3, cg: 0.3, st: 0.3, as: 0.35, sc: 0.45, cu: 0.5, ac: 0.6, cs: 0.8, ci: 0.9 };
  let lastDeckT = 1;
  const overcastGain = (p: VolumetricSceneInput, sunAlt: number) => {
    let T = 1;
    p.layers.forEach((L, i) => {
      if (!L || !L.genus || !(L.cover > 0)) return;
      const tau = i === 0 && (L.opts as { wave?: unknown } | undefined)?.wave ? lastWaveInfo?.tauUsed : undefined;
      const td = tau != null && Number.isFinite(tau) ? 1 / (1 + 0.1125 * tau) : TD_GENUS[L.genus] ?? 0.5;
      T *= 1 - Math.min(1, L.cover) * (1 - td);
    });
    lastDeckT = T;
    (aerial as unknown as { uniforms: Map<string, Uniform> }).uniforms.get('cloudSkyT')!.value = Math.max(0.05, T);
    (clouds.cloudsPass.currentMaterial as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms.cloudSkyTC.value = Math.max(0.05, T);
    const f = Math.min(1, 0.12 + 0.88 * Math.exp(-Math.max(0, sunAlt) / 6));
    const R = T / f;
    const rawGain = R >= 1 ? 1 : Math.min(4, Math.pow(R, -0.7));
    const fadeT = Math.max(0, Math.min(1, (sunAlt + 8) / 4));
    const fade = fadeT * fadeT * (3 - 2 * fadeT);
    return 1 + (rawGain - 1) * fade;
  };
  let exposureScale = 1;
  const baseExposureFor = (lightAlt: number, p: VolumetricSceneInput) => {
    if (p.exposure != null) return p.exposure;
    const cityA = cityState?.adaptCd ?? 0;
    const nightDarkVal = rawMoonGain > 0
      ? Math.max(0, Math.min(1, (-11 - lastTrueSunAlt) / 6)) * (1 - 0.75 * Math.min(1, rawMoonGain / MOON_FULL))
      : Math.max(0, Math.min(1, (-11 - lastTrueSunAlt) / 6));
    ((aerial as unknown as { uniforms: Map<string, Uniform> }).uniforms.get('nightDark')!).value = nightDarkVal;
    if (moonGain > 0) {
      const moonExp = moonExposureOf(lightAlt, moonGain, cityA);
      // 해 -13.5° -> -11.5° 구간에서 달 LUT 기여를 moonBlend(1 -> 0.02)로 서서히 줄이고,
      // 줄어든 몫(1 - moonBlend)은 updateCity의 노출 보정 균일변수가 이어받아 -11.5° 전환 단차를 완전히 없앱니다.
      overcastGain(p, lastTrueSunAlt);   // cloudSkyT 균일변수 갱신 부수효과 유지
      return moonExp * Math.max(0.02, moonBlend);
    }
    const base = autoExposure(lightAlt) * overcastGain(p, lastTrueSunAlt);
    if (lastTrueSunAlt >= -10) return base;
    // 해 -10° -> -17° 구간(일몰 수십 분 뒤)까지 하늘·건물이 보이다가 한밤중에는 산속 포함 깊은 밤 노출로 부드럽게 수렴
    const nightBlend = Math.min(1, (-10 - lastTrueSunAlt) / 7);
    const nightExp = autoExposure(45) * MOON_DIM * 0.65 * Math.sqrt(MOONLIT_CLOUD_CD / Math.max(cityA, 0.0012));
    return base * (1 - nightBlend) + nightExp * nightBlend;
  };
  const exposureFor = (lightAlt: number, p: VolumetricSceneInput) => {
    const scale = Math.max(0.1, Math.min(8, exposureScale));
    return baseExposureFor(lightAlt, p) * scale;
  };
  // §127 날씨 텍스처 캐시 — 날씨는 층(종류·운량·손잡이)만으로 정해지고 시각·시선과 무관합니다. 시간 막대를 앞뒤로
  // 움직이거나 그림자 지도 문턱(해 12°)을 넘나들 때마다 CPU 로 다시 만들던 것(적운 512² 크롬 1.3초)을 건너뜁니다.
  // 운량은 1% 눈금으로 묶습니다(예보 보간값의 소수점 차이로 다시 만들지 않게).
  const weatherCache = new Map<string, DataTexture>();
  // 세포 무늬 레인: 흐름 모형일 때만. 운량은 예보 운량(흐린 날 보호), 두께는 입력 두께 또는 종류 기본값.
  const cellLanesOf = (gl: (GenusLayer | null)[], p: VolumetricSceneInput) => (opt.cells && opt.flow
    ? cellLanes(gl, [0, 1, 2, 3].map(i => p.layers[i]?.cover ?? 1), [0, 1, 2, 3].map(i => p.layers[i]?.thicknessM ?? (gl[i] ? GENUS[gl[i]!.genus].height : 500)))
    : null);
  const WEATHER_CACHE_SIZE = 32;
  const bandOfInput = (L: VolumetricLayerInput): MacroBand => L.band ?? (L.baseKm >= 7 ? 'high' : L.baseKm >= 2 ? 'mid' : 'low');
  const weatherPlan = (p: VolumetricSceneInput, isFast = false) => {
    const S = isFast ? 128 : 256;
    const quantStep = isFast ? 0.05 : 0.01;
    const quantCover = (c: number) => Math.round(Math.max(0, Math.min(1, c)) / quantStep) * quantStep;
    const inputs = p.layers.slice(0, 4).map(L => {
      const b = bandOfInput(L);
      return opt.macro > 0 && p.macro ? { ...L, cover: macroTileCover(p.macro[b], L.cover, p.macroNext?.[b], p.tileCoverEnvelope?.[b]) } : L;
    });
    const useFlow = opt.flow && opt.genus;
    const useMorph = opt.morph && opt.genus && !useFlow && !opt.skeleton;
    const gl: (GenusLayer | null)[] = inputs.map((L, i) => {
      if (!L.genus || !(L.cover > 0)) return null;
      const qc = quantCover(L.cover);
      if (useMorph && bandOfInput(L) === 'low' && L.genus !== 'cb' && L.genus !== 'cbanvil') {
        const above = inputs.slice(i + 1).find(o => o.baseKm > L.baseKm);
        const m = morphParamsOf({ ...L.opts, baseKm: L.baseKm, thicknessM: L.thicknessM ?? GENUS[L.genus].height, shearDzKm: Math.max(0.5, (above?.baseKm ?? L.baseKm + 3) - L.baseKm) }, p.thermo ?? null);
        return { genus: L.genus, cover: opt.coverRemap ? morphCoverIn(m, qc) : qc, opts: { ...L.opts, ...morphShapeOpts(m), morph: m } };
      }
      if (!useFlow) return { genus: L.genus, cover: opt.coverRemap ? genusCoverIn(L.genus, qc) : qc, opts: L.opts };
      // §130 흐름 층: 종류별 흐름 기본값(GENUS_FLOW)을 opts 에 합치고(캐시 키에 자동 포함) 운량 역표는 흐름용(항등으로 시작 —
      // 가산 장은 0 인 곳이 없어 chamfer 스커트가 안 생기므로 §127 표가 맞지 않음). 전단은 바로 위 층까지의 고도 차로 잽니다.
      // 고운량 흐림(0.80→0.96)에서는 덩어리가 이어진 시트가 되므로 가장자리 깎기(flowCarve)를 0으로 줄여 파란 틈이 파이지 않게 합니다.
      const above = inputs.slice(i + 1).find(o => o.baseKm > L.baseKm);
      const shearDzKm = L.opts?.shearDzKm ?? Math.max(0.5, (above?.baseKm ?? L.baseKm + 3) - L.baseKm);
      const merged = mergeFlowOpts({ genus: L.genus, cover: flowCoverIn(L.genus, qc), opts: { ...L.opts, shearDzKm } });
      const origCover = quantCover(p.layers[i]?.cover ?? L.cover);
      const rawCarve = (merged.opts as { flowCarve?: number } | undefined)?.flowCarve;
      if (typeof rawCarve === 'number' && rawCarve > 0 && origCover > 0.8) {
        const carveScale = Math.max(0, Math.min(1, (0.96 - origCover) / 0.16));
        merged.opts = { ...merged.opts, flowCarve: Math.round(rawCarve * carveScale * 100) / 100 };
      }
      if (origCover > 0.82 && L.genus !== 'ci') {
        const tFl = Math.min(1, (origCover - 0.82) / 0.16);
        const autoFl = Math.round(tFl * tFl * (3 - 2 * tFl) * 0.32 * 20) / 20;
        const curFl = (merged.opts as { flowFloor?: number } | undefined)?.flowFloor ?? 0;
        if (autoFl > curFl) merged.opts = { ...merged.opts, flowFloor: autoFl };
      }
      return merged;
    });
    // §139 뼈대: cu·cg·sc 층의 자리·폭·깊이·층 높이를 열역학에서(cloudSkeleton). 1 = 층 높이만(K0h), 2·3 = 뼈대(원 운량, 역표 건너뜀). opts 에 넣어 캐시 키에 포함.
    const skel = opt.genus ? opt.skeleton : 0;
    if (skel && useFlow) throw new Error('volumetricScene: skeleton 과 flow 는 함께 쓸 수 없습니다');
    if (skel) {
      for (let i = 0; i < gl.length; i++) {
        const G = gl[i], L = inputs[i];
        if (!G || !(G.genus === 'cu' || G.genus === 'cg' || G.genus === 'sc')) continue;
        const genus = G.genus as SkeletonGenus;
        const sk = skeletonOf({ genus, cover: quantCover(L.cover), baseKm: L.baseKm, thicknessM: L.thicknessM }, p.thermo ?? null, GENUS_TILE_KM, G.opts?.seed ?? 7 + i * 1000, { vary: skel === 4, k4: skel === 5, k5: skel === 6 });
        gl[i] = skel === 1
          ? { ...G, opts: { ...G.opts, skelGeom: { baseM: sk.baseM, heightM: sk.heightM } } }
          : { genus, cover: quantCover(L.cover), opts: { ...G.opts, skeleton: sk, ...(genus === 'sc' ? { mode: 3, domePow: 0.5 } : {}) } };
      }
    }
    const useGenus = opt.genus && gl.some(Boolean);
    const plain = useGenus ? inputs.map((L, i) => (gl[i] ? 0 : quantCover(L.cover))) : [0, 1, 2, 3].map(i => inputs[i]?.cover ?? 0);
    // §130 흐름 핵은 장면당 하나(모든 층이 같은 변위 지도를 공유 → 같은 골에 sc·ac 가 정렬) — planFlowScene(cloudGenus.ts).
    const flow: FlowSceneParams | null = useFlow ? planFlowScene(gl, { n: opt.flowN, steps: opt.flowSteps, hours: opt.flowHours, vrms: opt.flowVrms, psiEvery: opt.flowPsiEvery, qMode: opt.flowQMode, qN: opt.flowQN, qH: opt.flowQH, s90: opt.flowS90 }) : null;
    const glForKey = gl.map((g, i) => {
      if (!g || !g.opts) return g;
      // 레인 0이 wave 3D 장을 쓰면 2D 날씨 R 채널이 고정 255로 채워지므로 cover/opts 변동과 무관하게 2D 날씨 캐시를 재사용합니다.
      if (i === 0 && (g.opts as { wave?: unknown }).wave) return { waveChannel: true };
      const {
        beamTransmittance: _bt,
        sunGap: _sg,
        macroGradX: _gx,
        macroGradY: _gy,
        wave: _wv,
        billow: _bl,
        skelGeom: _sk,
        densityScale: _ds,
        ao: _ao,
        thru: _th,
        base: _bs,
        top: _tp,
        edge: _ed,
        spectralSigmaKm: _ssk,
        flowLifeSec: _fls,
        haloWeight: _hw,
        powderWeight: _pw,
        effectiveG: _eg,
        tileGenus: _tg,
        flowCoreWindU: _fcu,
        flowCoreWindV: _fcv,
        flowCoreAniso: _fca,
        flowMode: _fm,
        flowTop: _ft,
        flowEdge: _fe,
        flowTilt: _fti,
        densPow: _fd,
        flowErode: _fer,
        flowCarve: _fc,
        flowGrain: _fg,
        flowWisp: _fw,
        flowFloor: _ffl,
        ...restOpts
      } = g.opts as Record<string, unknown>;
      if (useFlow) delete restOpts.spacingKm;
      const keyGenus = (typeof _tg === 'string' && _tg ? _tg : g.genus) as GenusKey;
      return { genus: keyGenus, cover: g.cover, opts: restOpts };
    });
    const flowNeeded = !!flow && gl.some((g, i) => !!g && g.cover > 0 && !(i === 0 && (g.opts as { wave?: unknown }).wave) && ((g.opts?.flow ?? 0) > 0));
    const hasFlowCore = !!flow && gl.some((g, i) => !!g && g.cover > 0 && !(i === 0 && (g.opts as { wave?: unknown }).wave) && ((g.opts?.flow ?? 0) > 0) && !((g.opts?.flowLaminar ?? 0) > 0));
    const texFlow = flowNeeded ? flow : null;
    const key = JSON.stringify([useGenus, glForKey, plain, useGenus ? (texFlow ? (hasFlowCore ? ['flow', texFlow] : 'laminar') : 0) : [opt.weatherPeriod, opt.weatherRamp], S]);
    return { inputs, gl, useGenus, plain, key, flow: texFlow, S };
  };
  type WeatherPlan = ReturnType<typeof weatherPlan>;
  const cacheGet = (key: string) => {
    const t = weatherCache.get(key);
    if (t) { weatherCache.delete(key); weatherCache.set(key, t); }   // 최근 사용을 뒤로
    return t ?? null;
  };
  const cachePut = (key: string, t: DataTexture) => {
    weatherCache.set(key, t);
    for (const [k, old] of weatherCache) {
      if (weatherCache.size <= WEATHER_CACHE_SIZE) break;
      if (old === weather) continue;   // 지금 쓰는 것은 버리지 않음
      weatherCache.delete(k); old.dispose();
    }
  };
  let sceneToken = 0;
  /*
   * 바람 드리프트(2026-11-13): 장면 시각까지 밀려간 거리는 층의 driftKm(그날 지방 자정부터 시간별 바람 적분), 그 뒤는 지금 바람 × 흐른 시간.
   * 예전에는 1970 년부터의 초(약 1.8·10⁹)에 지금 바람을 곱해 타일 소수부만 남겨, 바람이 5 km/h 만 달라도 구름 자리가 아무 데로나 튐 —
   * 시간 막대 미리보기와 손을 뗀 뒤 장면이 전혀 다른 배치로 보이던 원인. 적분이면 시각이 바뀔 때 이동이 이어짐.
   */
  let farSortedLanes: number[] = [-1, -1, -1, -1];
  const syncFar2DDrift = () => {
    const au = (aerial as unknown as { uniforms?: Map<string, Uniform> }).uniforms;
    if (!au) return;
    const cu = (clouds.cloudsPass.currentMaterial as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms;
    const gdu = cu.genusDriftU?.value as Vector4 | undefined;
    const gdv = cu.genusDriftV?.value as Vector4 | undefined;
    const mdu = cu.genusMacroDriftU?.value as Vector4 | undefined;
    const mdv = cu.genusMacroDriftV?.value as Vector4 | undefined;
    const pick = (v: Vector4 | undefined, i: number) =>
      !v || i < 0 ? 0 : i === 0 ? v.x : i === 1 ? v.y : i === 2 ? v.z : v.w;
    const s = farSortedLanes;
    (au.get('farDriftU')!.value as Vector4).set(pick(gdu, s[0]), pick(gdu, s[1]), pick(gdu, s[2]), pick(gdu, s[3]));
    (au.get('farDriftV')!.value as Vector4).set(pick(gdv, s[0]), pick(gdv, s[1]), pick(gdv, s[2]), pick(gdv, s[3]));
    const kdu = cu.genusDriftKmU?.value as Vector4 | undefined, kdv = cu.genusDriftKmV?.value as Vector4 | undefined;
    if (cu.genusLife) { (au.get('farLife')!.value as Vector4).copy(cu.genusLife.value as Vector4); au.get('farLifeW')!.value = cu.genusLifeW.value as number; }
    (au.get('farDriftKmU')!.value as Vector4).set(pick(kdu, s[0]), pick(kdu, s[1]), pick(kdu, s[2]), pick(kdu, s[3]));
    (au.get('farDriftKmV')!.value as Vector4).set(pick(kdv, s[0]), pick(kdv, s[1]), pick(kdv, s[2]), pick(kdv, s[3]));
    (au.get('farMacroDriftU')!.value as Vector4).set(pick(mdu, s[0]), pick(mdu, s[1]), pick(mdu, s[2]), pick(mdu, s[3]));
    (au.get('farMacroDriftV')!.value as Vector4).set(pick(mdv, s[0]), pick(mdv, s[1]), pick(mdv, s[2]), pick(mdv, s[3]));
    au.get('farMacroTex')!.value = macro ? macro.texA : null;
    au.get('farMacroTexB')!.value = macro ? macro.texB : null;
    au.get('farMacroMix')!.value = (cu.genusMacroMix?.value as number | undefined) ?? 0;
    au.get('farMacroLut')!.value = macro ? macro.lut : null;
    au.get('farMacroOn')!.value = macro ? 1 : 0;
    au.get('farMacroExtentKm')!.value = macro ? macro.extentKm : 768;
  };
  const applyFar2DState = (plan: WeatherPlan, tex: DataTexture, nue: Matrix4, position: Vector3) => {
    const au = (aerial as unknown as { uniforms?: Map<string, Uniform> }).uniforms;
    if (!au) return;
    const north = new Vector3(), up = new Vector3(), east = new Vector3();
    nue.extractBasis(north, up, east);
    const altCorr = getAltitudeCorrectionOffset(position, atmosphereParams.bottomRadius, Ellipsoid.WGS84, new Vector3());
    const [ox, oy] = plan.useGenus ? tsunObsKm : [0, 0];
    const origin = position.clone().add(altCorr).addScaledVector(east, -ox * 1000).addScaledVector(north, -oy * 1000);
    (au.get('farOriginKm')!.value as Vector3).copy(origin).multiplyScalar(0.001);
    (au.get('farEast')!.value as Vector3).copy(east).normalize();
    (au.get('farNorth')!.value as Vector3).copy(north).normalize();
    au.get('farTileKm')!.value = GENUS_TILE_KM;
    au.get('farWeatherTex')!.value = plan.useGenus ? tex : null;
    au.get('farWeatherOn')!.value = plan.useGenus ? 1 : 0;
    au.get('farCutKm')!.value = clouds.clouds.maxRayDistance / 1000;

    type FarSlot = {
      lane: number; baseKm: number; thickKm: number; tauV: number;
      densPow: number; isIce: number; coverFb: number; lutCol: number; macroRow: number;
    };
    const active: FarSlot[] = [];
    for (let i = 0; i < 4; i++) {
      const cl = clouds.cloudLayers[i];
      const inp = plan.inputs[i];
      if (!cl || !inp || cl.height <= 0 || cl.densityScale <= 0 || !(inp.cover > 0)) continue;
      const g = plan.useGenus ? plan.gl[i] : null;
      const baseKm = cl.altitude / 1000;
      const thickKm = cl.height / 1000;
      const tauV = Math.min(8, 0.04 * cl.densityScale * cl.height);
      const densPow = g ? (plan.flow && flowParam(g, 'flow', 0) > 0 ? flowParam(g, 'densPow', 0.7) : (GENUS[g.genus]?.domePow ?? 0.7)) : 0.7;
      const isIce = g && (g.genus === 'ci' || g.genus === 'cs' || g.genus === 'cbanvil') ? 1 : (!g && bandOfInput(inp) === 'high' ? 1 : 0);
      const band = macro?.laneBand[i] ?? null;
      const hasBandMacro = !!(macro && band && macro.samples[band]);
      const macroRow = hasBandMacro ? (band === 'low' ? 0 : band === 'mid' ? 1 : 2) : -1;
      active.push({ lane: i, baseKm, thickKm, tauV, densPow, isIce, coverFb: inp.cover, lutCol: hasBandMacro ? i : -1, macroRow });
    }
    // 높은 층 → 낮은 층(원→근) 내림차순 정렬: 반투명 적층 순서 보장
    active.sort((a, b) => b.baseKm - a.baseKm);

    const bV = [-1, -1, -1, -1], tV = [0, 0, 0, 0], tau = [0, 0, 0, 0], dp = [0.7, 0.7, 0.7, 0.7], ice = [0, 0, 0, 0], fb = [0, 0, 0, 0], lut = [-1, -1, -1, -1];
    const wMask = (au.get('farWeatherMask')!.value as Matrix4).elements; wMask.fill(0);
    const mMask = (au.get('farMacroMask')!.value as Matrix4).elements; mMask.fill(0);
    farSortedLanes = [-1, -1, -1, -1];
    for (let s = 0; s < active.length && s < 4; s++) {
      const x = active[s];
      farSortedLanes[s] = x.lane;
      bV[s] = x.baseKm; tV[s] = x.thickKm; tau[s] = x.tauV; dp[s] = x.densPow; ice[s] = x.isIce; fb[s] = x.coverFb; lut[s] = x.lutCol;
      wMask[s * 4 + x.lane] = 1;
      if (x.macroRow >= 0) mMask[s * 4 + x.macroRow] = 1;
      else mMask[s * 4 + 3] = 1;
    }
    (au.get('farBaseKm')!.value as Vector4).set(bV[0], bV[1], bV[2], bV[3]);
    (au.get('farThickKm')!.value as Vector4).set(tV[0], tV[1], tV[2], tV[3]);
    (au.get('farTauV')!.value as Vector4).set(tau[0], tau[1], tau[2], tau[3]);
    (au.get('farDensPow')!.value as Vector4).set(dp[0], dp[1], dp[2], dp[3]);
    (au.get('farIce')!.value as Vector4).set(ice[0], ice[1], ice[2], ice[3]);
    (au.get('farCoverFb')!.value as Vector4).set(fb[0], fb[1], fb[2], fb[3]);
    (au.get('farLutCol')!.value as Vector4).set(lut[0], lut[1], lut[2], lut[3]);
    syncFar2DDrift();
  };
  /** 날씨가 준비된 뒤 장면을 한 번에 겁니다(층·종류 균일변수·날씨·노출). */
  const applyScene = (p: VolumetricSceneInput, plan: WeatherPlan, tex: DataTexture) => {
    lastInput = p;
    // §179 새 장면 — 아틀라스 틀(종류 원점)·운량장이 바뀌므로 걸린 아틀라스를 버립니다(하네스는 setScene 뒤에 짓고 겁니다).
    sceneSerial++;
    tsunAtlas = null;   // 텍스처는 부른 쪽(하네스) 소유
    const position = new Geodetic(radians(p.lon), radians(p.lat), p.heightM).toECEF();
    const nue = Ellipsoid.WGS84.getNorthUpEastFrame(position, new Matrix4());
    curPos = position; curNue = nue;
    placeCamera(p);

    // 해가 지평선 근처면 층 그림자 지도(BSM)가 NaN 을 내 화면이 통째로 검어집니다(웹 시제품에서 해 1.1° 에서 확인).
    // 구름 자신의 그늘은 해 쪽 2차 행진이 따로 셉니다.
    const sunAltDeg = sunAltAt(p.date);
    aerial.sunDirection.copy(sun);
    clouds.sunDirection.copy(sun);
    const shadow = sunAltDeg > opt.shadowMinSunDeg;
    lastShadow = shadow;
    lastSunAltForLight = sunAltDeg;
    applySunLight();

    // RULER-grain §8.2 손잡이 값 점검(층을 지우기 전에 throw) — 정해진 값만: '2'·true·3 같은 값이 조용히 다른 팔(E3b → E3 등)이 되지 않게,
    // E3c 층 배율은 유한한 0 이상 수만(null·NaN 이 층 소광을 조용히 0·NaN 으로 만들지 않게).
    const knobOf = <T extends number>(k: 'refineOnHit' | 'sunLowpass' | 'erodeCentered' | 'jitterMode', allowed: readonly T[]): T => {
      const x = opt[k] as unknown;
      if (!allowed.includes(x as T)) throw new Error('volumetricScene: ' + k + ' must be one of ' + allowed.join('/') + ', got ' + JSON.stringify(x));
      return x as T;
    };
    const grainKnobs = { refine: knobOf('refineOnHit', [0, 1] as const), sunLowpass: knobOf('sunLowpass', [0, 1] as const), erode: knobOf('erodeCentered', [0, 1, 2] as const), jitter: knobOf('jitterMode', [0, 1] as const) };
    const densityMul = opt.debugDensityMul;
    if (typeof densityMul !== 'number' || !Number.isFinite(densityMul) || densityMul < 0) throw new Error('volumetricScene: debugDensityMul must be a finite number >= 0, got ' + densityMul);
    clouds.cloudLayers.length = 0;
    const eligible: boolean[] = [];
    // 층 4개(채널 r·g·b·a). 입력이 모자라면 빈 층으로 채웁니다 — 셰이더는 늘 4층을 받습니다.
    const CH = ['r', 'g', 'b', 'a'] as const;
    const { inputs, gl, useGenus } = plan;
    const flowDens = !!plan.flow && opt.flowDensity, flowUv = !!plan.flow && opt.flowUv;
    const physLanes: (LayerPhysics | null)[] = [null, null, null, null];
    // 종류 없는 층의 두께·밀도: 층 띠(없으면 밑면 높이)로 저·중·상을 가릅니다(이전 프리셋 값과 같음).
    const bandOf = (L: VolumetricLayerInput) => L.band ?? (L.baseKm >= 7 ? 'high' : L.baseKm >= 2 ? 'mid' : 'low');
    const bandShape = (b: 'low' | 'mid' | 'high') => (b === 'high' ? { height: 400, densityScale: 0.003, shapeAmount: 0.4, shapeDetailAmount: 0 }
      : b === 'mid' ? { height: 900 } : { height: 1200 });
    for (let i = 0; i < 4; i++) {
      const L = inputs[i];
      // 입력이 없는 채널만 빈 층. 운량 0 인 층도 층 높이는 그대로 둡니다 — 층 높이 범위가 하늘빛 보간·행진 구간에 들어갑니다.
      if (!L) { eligible.push(false); clouds.cloudLayers.push(new CloudLayer({ channel: CH[i], altitude: 0, height: 0, densityScale: 0 })); continue; }
      const g = useGenus ? gl[i] : null;
      const shape = g ? genusLayerShape(g, flowDens) : bandShape(bandOf(L));
      if (L.thicknessM) shape.height = L.thicknessM;
      // §139 뼈대(K0h·K1·K2): 층 밑면·두께는 뼈대 값이 최종(예보 덱 두께·physBaseKm 보다 우선). 뚜껑 층은 밀도 단면 평평(밑면이 가장 옅지 않게).
      const skg = g?.opts?.skeleton ?? g?.opts?.skelGeom;
      if (skg) shape.height = skg.heightM;
      // 상층(권운류)은 얇고 멀어 층 그림자 지도를 쓰지 않습니다(이전과 같음). 종류 권운 층은 설계상 드리움(§177.6 g3 — 그대로 둠).
      const canCast = !(bandOf(L) === 'high' && !g);
      eligible.push(canCast);
      const layerShadow = canCast ? shadow : undefined;
      // §136 물리: 종류 층의 소광·세로 단면을 기온·기압에서(cloudPhysics). 꺼져 있으면 CloudLayer 에 아무것도 더하지 않습니다(이전과 같은 바이트).
      const physRaw = g && opt.physics ? layerPhysics(g.genus, (L.physBaseKm ?? L.baseKm) * 1000, shape.height ?? 0, p.thermo, genusEnvelope(g)) : null;
      // 입력이 깨져(NaN) 값이 유한하지 않으면 그 층은 손값 그대로 — 구름이 조용히 사라지지 않게.
      const phys = physRaw && Number.isFinite(physRaw.betaTop) && physRaw.betaTop >= 0 && physRaw.profile.every(Number.isFinite) ? physRaw : null;
      physLanes[i] = phys;
      const altitude = skg ? skg.baseM : (phys && L.physBaseKm != null ? L.physBaseKm : L.baseKm) * 1000;
      const physShape = phys ? { densityScale: phys.betaTop * (opt.physicsRenderComp ? physRenderComp(g!.genus) : 1), densityProfile: { expTerm: phys.profile[0], exponent: phys.profile[1], linearTerm: phys.profile[2], constantTerm: phys.profile[3] } }
        : g?.opts?.skeleton?.mode === 3 ? { densityProfile: { expTerm: 0, exponent: 0, linearTerm: 0, constantTerm: 1 } }
          : g && (opt.profileBase ?? g.opts?.profileBase ?? GENUS[g.genus].profileBase) != null
            ? { densityProfile: { expTerm: 0, exponent: 0, linearTerm: 1 - (opt.profileBase ?? g.opts?.profileBase ?? GENUS[g.genus].profileBase)!, constantTerm: (opt.profileBase ?? g.opts?.profileBase ?? GENUS[g.genus].profileBase)! } }
            : {};
      const layer = new CloudLayer({ channel: CH[i], altitude, ...shape, ...physShape, coverageFilterWidth: CFW, shadow: layerShadow });
      // RULER-grain E3c 진단: 층 소광 배율(균일변수가 아니라 층 값 — takram 이 매 프레임 재포장해도 남음). 기본 1 이면 손대지 않음.
      if (densityMul !== 1) layer.densityScale *= densityMul;
      clouds.cloudLayers.push(layer);
    }
    lastPhysics = physLanes.some(Boolean) ? physLanes : null;
    // §178 g2 자격을 기억하고(setDate 가 다시 씀) 같은 규칙으로 한 번 겁니다 — 층 값은 위 생성자와 같고, 드리우는 층이 없으면 꼭대기를 0 으로.
    castEligible = eligible;
    applyCastMask(shadow);
    // §136·§137 얼음·입자 광학 레인: physics+physicsIce 면 물리 값, 아니면 입자 물리 광학 레인(particleOpticalLane) 또는 손값 레인.
    const physIce = opt.physics && opt.physicsIce;
    const handIce = !physIce && (opt.iceHalo || opt.icePowderOff);
    const iceLanes = physIce ? physLanes
      : [0, 1, 2, 3].map(i => (useGenus && gl[i]
        ? particleOpticalLane(
          gl[i]!.genus,
          gl[i]!.opts as { haloWeight?: number; powderWeight?: number } | undefined,
          handIce ? { halo: opt.iceHalo, powderOff: opt.icePowderOff } : undefined,
        )
        : null));
    const iceOn = physIce || handIce || iceLanes.some(Boolean);
    // RULER-grain §8.2 셰이더 손잡이 — 종류 모형 여부와 무관하게 두 재질 모두(구름 패스 전용 손잡이는 그림자 패스에서 아무것도 안 함).
    for (const m of genusMats) setGrainKnobs(m, grainKnobs, opt.erodePixelAngleDeg);
    applyLightingFix();
    applyTsun();
    if (useGenus) {
      // §124: 층마다 종류별 무늬·단면. 종류가 없는 층은 기본 잡음을 같은 텍스처의 다른 채널에 둡니다.
      const north = new Vector3(), up = new Vector3(), east = new Vector3();
      nue.extractBasis(north, up, east);
      clouds.localWeatherRepeat.setScalar(1);
      // §131 K: 관측점을 국소 운량 ≈ 전역 운량인 칸으로(타일 바이트는 그대로). 장면 입력이 오프셋을 주면 그것이 우선.
      const camKm = plan.flow && opt.flowCamCell && !p.weatherOffsetKm ? flowCamCellOffsetKm(tex.image.data as Uint8Array, tex.image.width, gl, GENUS_TILE_KM) : null;
      lastCamKm = camKm;
      // §173 takram 은 광선을 '고도 보정' 공간(ECEF + altitudeCorrection, 타원체 → 구)에서 걷습니다. 날씨 좌표 원점도 같은 공간에 둬야
      // 관측점이 무늬 원점에 놓입니다 — 보정 벡터의 북쪽 성분이 위도 36° 에서 ~20 km 라, 예전에는 거시 격자(고리 자료)가 그만큼 남쪽에 그려졌습니다.
      const altCorr = getAltitudeCorrectionOffset(position, atmosphereParams.bottomRadius, Ellipsoid.WGS84, new Vector3());
      const driftSec = driftSecOverride ?? p.date.getTime() / 1000;
      for (const m of genusMats) {
        setGenusUniforms(m, gl);
        setGenusSkeleton(m, gl, opt.skeleton >= 2);
        setGenusPhysics(m, iceLanes, iceOn, opt.keepIceShaderLoaded);
        setGenusLightFloors(m, opt.debugLightFloors);
        setGenusDiffuse(m, opt.diffuse);
        setFlowUniforms(m, gl, { density: flowDens, uv: flowUv, macroGrad: opt.macroGrad }, GENUS_TILE_KM);
        setCellUniforms(m, cellLanesOf(gl, p));
        setGenusDrift(m, gl, driftSec - p.date.getTime() / 1000, GENUS_TILE_KM, p.layers.slice(0, 4).map(L => L?.driftKm));
        setGenusLife(m, driftSec, gl);
        setWaveDrift(m, gl[0] ? flowParam(gl[0], 'windU', 0) : 0, gl[0] ? flowParam(gl[0], 'windV', 0) : 0, driftSec - p.date.getTime() / 1000, p.layers[0]?.driftKm);
        // 거시 격자는 표본 시각(장면 시각)에 자리가 맞으므로 그때부터 흐른 시간만큼만(km, 감싸지 않음)
        setMacroDrift(m, gl, driftSec - p.date.getTime() / 1000);
        if (opt.skeleton === 3) setSkeletonTilt(m, gl, opt.skeletonTiltScale);   // 드리프트 뒤(드리프트 0 으로 덮음)
        const [ox, oy] = p.weatherOffsetKm ?? camKm ?? [0, 0];
        tsunObsKm = [ox, oy];   // §179 WP2 아틀라스 중심(종류 평면 km)
        const origin = position.clone().add(altCorr).addScaledVector(east, -ox * 1000).addScaledVector(north, -oy * 1000);
        setGenusFrame(m, { origin, east, north, tileM: GENUS_TILE_KM * 1000 });
      }
      {
        const wp = (gl[0]?.opts as { wave?: WaveParams } | undefined)?.wave;
        if (wp) {
          const key = waveKey(wp);
          let wf = waveCacheGet(key);
          if (!wf) {
            wf = bakeWaveField(wp);
            waveCachePut(key, wf);
          }
          activeWaveField = wf;
          // 2026-11-12 관측 일사 맞춤: 기둥 τ = densityScale × 레인 높이 × colMean 이 tauTarget 이 되게 레인 0 의 densityScale 을 바꿈(구름·그림자 패스 공용 층).
          const L0 = clouds.cloudLayers[0];
          const tauModel = L0 ? L0.densityScale * L0.height * wf.colMean : 0;
          let tauUsed = tauModel;
          if (L0 && wp.tauTarget && wp.tauTarget > 0 && tauModel > 0) { L0.densityScale *= wp.tauTarget / tauModel; tauUsed = wp.tauTarget; }
          lastWaveInfo = { bakeMs: wf.bakeMs, tau: wf.tau, ...wf.stats, colMean: wf.colMean, tauModel, tauUsed };
        } else {
          activeWaveField = null;
          lastWaveInfo = null;
        }
        for (const m of genusMats) setWaveUniforms(m, wp ? activeWaveField : null, wp?.baseM ?? 0, wp?.thickM ?? 1000);
        const bp = gl.map(L => (L?.opts as { billow?: BillowParams } | undefined)?.billow
          ?? (opt.billow && L && (L.genus === 'cu' || L.genus === 'cg' || L.genus === 'cb') ? BILLOW_DEFAULT : null));   // 2026-11-13 sc 뺌: 둥근 혹이 매끈한 덩어리에 종기처럼 붙음 — 층적운 결은 흐름 깎기(flowCarve·flowGrain)가 맡음
        const bFirst = bp.find(x => x) ?? null;
        const bLanes = bp.map(x => (x ? 1 : 0));
        activeBillowOn = !!bFirst && bLanes.some(x => x > 0);
        for (const m of genusMats) setBillowUniforms(m, bFirst, bLanes);
        syncBillowInteractionUniform();
        applyFarSun(p, sunAltDeg);
      }
      // §156 거시 운량 격자 — 띠마다 고리 표본 → 격자(Barnes [+ 잡음]) → 텍스처, 타일 바이트 히스토그램 → 레인별 문턱 표.
      const getCachedMacroTable = (t: DataTexture, S: number, ch: number) => {
        const ud = (t.userData ?? (t.userData = {})) as { macroTables?: (Float32Array | null)[] };
        if (!ud.macroTables) ud.macroTables = [null, null, null, null];
        if (!ud.macroTables[ch]) ud.macroTables[ch] = macroThresholdTable(t.image.data as Uint8Array, S, ch);
        return ud.macroTables[ch];
      };
      if (opt.macro > 0 && p.macro) {
        const laneBand = [0, 1, 2, 3].map(i => (inputs[i] ? bandOfInput(inputs[i]) : null));
        const S = tex.image.width;
        disposeMacro();
        const samples = macroRingSamplesOf(p.macro);
        const samplesNext = p.macroNext ? macroRingSamplesOf(p.macroNext) : {};
        if (Object.keys(samples).length) {
          const n = opt.macroN, extentKm = 768;
          const useCachedDual = opt.macro === 1;
          const m: NonNullable<typeof macro> = {
            samples, states: {}, fields: {},
            texA: null as unknown as DataTexture, texB: null as unknown as DataTexture, lut: null as unknown as DataTexture,
            laneBand, n, extentKm, lastSec: driftSecOverride,
            spanMs: p.macroSpanMs,
            cachedTex: useCachedDual,
          };
          if (useCachedDual) {
            m.texA = getOrBuildCachedMacroTex(samples, n, extentKm);
            m.texB = Object.keys(samplesNext).length ? getOrBuildCachedMacroTex(samplesNext, n, extentKm) : m.texA;
          } else {
            const tex0 = macroBuildFields(m, opt.macro === 2);
            m.texA = tex0; m.texB = tex0;
          }
          m.lut = makeMacroLutTexture([0, 1, 2, 3].map(i => (inputs[i] && laneBand[i] && samples[laneBand[i]!] ? getCachedMacroTable(tex, S, i) : null)));
          macro = m;
          const initMix = useCachedDual ? macroMixAt(p.date, p.macroSpanMs) : 0;
          for (const mm of genusMats) setMacroUniforms(mm, { texA: m.texA, texB: m.texB, mix: initMix, extentKm, laneBand, lut: m.lut });
        }
      } else {
        disposeMacro();
      }
      if (!macro) for (const mm of genusMats) setMacroUniforms(mm, null);
    } else {
      disposeMacro();
      for (const mm of genusMats) setMacroUniforms(mm, null);
      clouds.localWeatherRepeat.copy(baseWeatherRepeat);
      for (const m of genusMats) setWaveUniforms(m, null);
      activeBillowOn = false;
      for (const m of genusMats) setBillowUniforms(m, null, []);
      for (const m of genusMats) { setGenusUniforms(m, []); setGenusSkeleton(m, [], false); setGenusPhysics(m, [], false, opt.keepIceShaderLoaded); setGenusLightFloors(m, opt.debugLightFloors); setGenusDiffuse(m, opt.diffuse); setFlowUniforms(m, [], { density: false, uv: false }, GENUS_TILE_KM); setCellUniforms(m, null); setGenusFrame(m, null); }
    }
    weather = tex;
    clouds.localWeatherTexture = tex;
    genLayers = gl; genDate = p.date; genUv = flowUv;
    applyFar2DState(plan, tex, nue, position);
    updateCity(p, p.date);
    const exposure = exposureFor(sunAltDeg, p);
    applyHaze(p.haze);
    applyCloudAir(p);
    renderer.toneMappingExposure = exposure;
    last = { sunAltDeg, exposure };
  };
  const setScene = (p: VolumetricSceneInput) => {
    sceneToken++;   // 진행 중인 비동기 생성은 버립니다
    const plan = weatherPlan(p, false);
    let tex = cacheGet(plan.key);
    if (!tex) {
      const t0 = Date.now();
      tex = plan.useGenus ? makeGenusWeather(plan.gl, plan.S, GENUS_TILE_KM, 7, plan.plain, plan.flow) : makeWeather(plan.plain, opt);
      weatherMs = Date.now() - t0;
      cachePut(plan.key, tex);
    }
    applyScene(p, plan, tex);
  };
  /**
   * §127 하늘 화면용 — 날씨를 잘라 만들고(그동안 이전 장면을 계속 그림) 다 되면 장면을 바꿉니다. 더 새 호출이 오면
   * 이전 것은 버려지고 false 를 돌려줍니다. 날씨가 캐시에 있으면 곧바로 바꿉니다.
   * isFast 가 참이면 드래그 중 S=128 초고속 모드(30~50ms)로 생성합니다.
   */
  const setSceneAsync = async (p: VolumetricSceneInput, isFast = false, sliceMs = 12): Promise<boolean> => {
    const my = ++sceneToken;
    const plan = weatherPlan(p, isFast);
    let tex = cacheGet(plan.key);
    if (!tex) {
      const t0 = Date.now();
      tex = plan.useGenus
        ? await makeGenusWeatherAsync(plan.gl, plan.S, GENUS_TILE_KM, 7, plan.plain, sliceMs, () => my !== sceneToken || disposed, plan.flow, 0)
        : makeWeather(plan.plain, opt);
      if (!tex) return false;
      if (my !== sceneToken || disposed) { tex.dispose(); return false; }
      weatherMs = Date.now() - t0;
      cachePut(plan.key, tex);
    }
    if (my !== sceneToken || disposed) return false;
    // 파동 장(흐린 날 채우기 등)은 굽는 데 수 초 — 여기서 조각내 미리 구워 두면 applyScene 이 캐시를 씁니다.
    const wp = (plan.gl?.[0]?.opts as { wave?: WaveParams } | undefined)?.wave;
    if (wp) {
      const key = waveKey(wp);
      if (!waveCacheGet(key)) {
        const t0 = Date.now();
        const field = await bakeWaveFieldAsync(wp, () => my !== sceneToken || disposed, sliceMs, 0);
        if (!field) return false;
        if (my !== sceneToken || disposed) { field.tex.dispose(); return false; }
        waveCachePut(key, field);
        weatherMs += Date.now() - t0;
      }
    }
    applyScene(p, plan, tex);
    return true;
  };
  const hasCachedScene = (p: VolumetricSceneInput, isFast = false): boolean => {
    const plan = weatherPlan(p, isFast);
    if (!weatherCache.has(plan.key)) return false;
    const wp = (plan.gl?.[0]?.opts as { wave?: WaveParams } | undefined)?.wave;
    if (wp && !waveCacheMap.has(waveKey(wp))) return false;
    return true;
  };
  const prewarmScenesAsync = async (
    inputs: VolumetricSceneInput[],
    shouldAbort?: () => boolean,
    onProgress?: (done: number, total: number) => void,
    shouldPause?: () => boolean,
    allowWhileInteracting = false,
  ): Promise<number> => {
    let doneCount = 0;
    const total = inputs.length;
    const seenKeys = new Set<string>();
    const seenWaveKeys = new Set<string>();
    const isPaused = () => (isInteracting && !allowWhileInteracting) || !!shouldPause?.();
    const sliceNow = () => (isInteracting ? PREWARM_SLICE_MS.interacting : PREWARM_SLICE_MS.idle);
    for (let idx = 0; idx < inputs.length; idx++) {
      const p = inputs[idx];
      while (isPaused() && !shouldAbort?.() && !disposed) {
        await new Promise(r => setTimeout(r, 80));
      }
      if (shouldAbort?.() || disposed) return doneCount;
      const plan = weatherPlan(p, false);
      let didWork = false;
      if (!seenKeys.has(plan.key)) {
        seenKeys.add(plan.key);
        const tex = cacheGet(plan.key);
        if (!tex) {
          didWork = true;
          const bakedTex = plan.useGenus
            ? await makeGenusWeatherAsync(plan.gl, plan.S, GENUS_TILE_KM, 7, plan.plain, sliceNow, () => !!shouldAbort?.() || disposed, plan.flow, 0, isPaused)
            : makeWeather(plan.plain, opt);
          if (!bakedTex || shouldAbort?.() || disposed) {
            bakedTex?.dispose();
            return doneCount;
          }
          cachePut(plan.key, bakedTex);
        }
      }
      const wp = (plan.gl?.[0]?.opts as { wave?: WaveParams } | undefined)?.wave;
      if (wp) {
        const wKey = waveKey(wp);
        if (!seenWaveKeys.has(wKey)) {
          seenWaveKeys.add(wKey);
          if (!waveCacheGet(wKey)) {
            didWork = true;
            const field = await bakeWaveFieldAsync(wp, () => !!shouldAbort?.() || disposed, PREWARM_SLICE_MS.interacting, 0, isPaused);
            if (!field || shouldAbort?.() || disposed) {
              field?.tex.dispose();
              return doneCount;
            }
            waveCachePut(wKey, field);
          }
        }
      }
      if (didWork) {
        await new Promise(r => setTimeout(r, 0));
      }
      doneCount++;
      onProgress?.(idx + 1, total);
    }
    return doneCount;
  };
  let disposed = false;
  const setPreset = (p: VolumetricPreset) => setScene(presetToInput(p));
  /** 파동 장 캐시 키 — tauTarget 은 굽기에 안 쓰므로 뺌(일사가 바뀌어도 다시 굽지 않음). */
  function waveKey(wp: WaveParams): string { return JSON.stringify({ ...wp, tauTarget: undefined }); }
  let viewOffsetYFrac = 0;
  /** 눈의 가로 자리(m, 북 · 동) — `setEyeOffset`. */
  let eyeNorthM = 0, eyeEastM = 0;
  const setView = (az: number, el: number, fov: number, altitudeM?: number, rollDeg?: number, offsetYFrac?: number) => {
    if (offsetYFrac !== undefined && Number.isFinite(offsetYFrac)) viewOffsetYFrac = Math.max(-0.45, Math.min(0.45, offsetYFrac));
    if (!lastInput) return;
    lastInput = {
      ...lastInput,
      az,
      el,
      fov,
      rollDeg: rollDeg !== undefined ? rollDeg : lastInput.rollDeg,
      altitudeM: altitudeM !== undefined ? altitudeM : lastInput.altitudeM,
    };
    placeCamera(lastInput);
  };
  /**
   * §155 드리프트 시계 — 하늘 화면이 씬 시각과 따로 주는 바람 드리프트 시각(초). 시각을 고정해 둔(SIM) 동안에도 구름이 실제 시간으로
   * 흘러가게, 부르는 쪽이 "씬 시각 + 그 시각을 고른 뒤 흐른 실제 시간" 을 넘깁니다. 없으면 씬 시각(하네스 렌더는 그대로 결정적).
   */
  const setDate = (date: Date, driftSec?: number) => {
    driftSecOverride = driftSec ?? null;
    if (!lastInput) return;
    lastInput = { ...lastInput, date };
    const sunAltDeg = sunAltAt(date);
    if ((sunAltDeg > opt.shadowMinSunDeg) !== lastShadow) {
      lastShadow = sunAltDeg > opt.shadowMinSunDeg;
      // 씬 전체를 동기 재생성(makeGenusWeather)하면 슬라이더 드래그 중 ANR이 발생하므로
      // 구름 레이어의 그림자 플래그만 안전하게 갱신합니다 — §178 g2: applyScene 이 정한 자격(castEligible)만.
      applyCastMask(lastShadow);
    }
    aerial.sunDirection.copy(sun);
    clouds.sunDirection.copy(sun);
    lastSunAltForLight = sunAltDeg;
    applySunLight();
    if (opt.farSun && lastInput) applyFarSun(lastInput, sunAltDeg);
    // §179 T_sun: 해 12° 건넘에 글자 넣기·빼기, 아치 무게 w(θ) 갱신(끄면 아무것도 안 함).
    if (opt.tsun === 1 || opt.tsunRef !== 0) applyTsun();
    // §130 C3 층별 바람 드리프트 — 두 재질 모두(빠뜨리면 해 > 12° 의 층 그림자가 시간이 가며 구름에서 떨어집니다).
    if (genLayers) {
      const driftSec = driftSecOverride ?? date.getTime() / 1000;
      // macroSpanMs 가 있으면 거시 격자는 이미 date 시각으로 오일러 보간되어 있으므로 실제 경과 드리프트(driftSec - date)만 밀어 정시 점프를 없앱니다.
      const macroRefSec = (macro?.spanMs ? date : (genDate ?? date)).getTime() / 1000;
      const macroSec = driftSec - macroRefSec;
      const w0 = genLayers[0];
      const wu0 = w0 ? flowParam(w0, 'windU', 0) : 0;
      const wv0 = w0 ? flowParam(w0, 'windV', 0) : 0;
      for (const m of genusMats) { setGenusLife(m, driftSec, genLayers); setGenusDrift(m, genLayers, driftSec - (genDate ?? date).getTime() / 1000, GENUS_TILE_KM, lastInput.layers.slice(0, 4).map(L => L?.driftKm)); setWaveDrift(m, wu0, wv0, driftSec - (genDate ?? date).getTime() / 1000, lastInput.layers[0]?.driftKm); setMacroDrift(m, genLayers, macroSec); }
      if (macro && opt.macro === 1 && macro.spanMs) {
        const mix = macroMixAt(date, macro.spanMs);
        for (const m of genusMats) setMacroMix(m, mix);
      } else if (macro && opt.macro === 2) {
        // §156 거시 격자 시간 걸음(AR(1)) — 1 분마다 새 장을 B 에, 이전 B 를 A 로; 그 사이는 mix 로 섞습니다.
        if (macro.lastSec == null) macro.lastSec = driftSec;
        const elapsed = driftSec - macro.lastSec;
        if (elapsed >= MACRO_STEP_SEC || elapsed < 0) {
          const dt = Math.min(3600, Math.max(0, elapsed));
          for (const b of ['low', 'mid', 'high'] as MacroBand[]) { const st = macro.states[b]; if (st) stepMacroState(st, dt); }
          const next = macroBuildFields(macro, true);
          if (macro.texA !== macro.texB) macro.texA.dispose();
          macro.texA = macro.texB; macro.texB = next; macro.lastSec = driftSec;
          for (const m of genusMats) setMacroUniforms(m, { texA: macro.texA, texB: macro.texB, mix: 0, extentKm: macro.extentKm, laneBand: macro.laneBand, lut: macro.lut });
        } else {
          for (const m of genusMats) setMacroMix(m, elapsed / MACRO_STEP_SEC);
        }
      }
      syncFar2DDrift();
    }
    updateCity(lastInput, date);
    const exposure = exposureFor(sunAltDeg, lastInput);
    applyHaze(lastInput.haze);
    applyCloudAir(lastInput);
    renderer.toneMappingExposure = exposure;
    last = { sunAltDeg, exposure };
  };
  const updateContinuousScene = (cont: VolumetricSceneInput) => {
    if (!lastInput || !weather) return;
    const densityMul = opt.debugDensityMul;
    const flowDens = !!opt.flow && opt.genus && opt.flowDensity;
    const bandOf = (L: VolumetricLayerInput) => L.band ?? (L.baseKm >= 7 ? 'high' : L.baseKm >= 2 ? 'mid' : 'low');
    const bandShape = (b: 'low' | 'mid' | 'high') => (b === 'high' ? { height: 400, densityScale: 0.003 } : b === 'mid' ? { height: 900, densityScale: 0.015 } : { height: 1200, densityScale: 0.02 });
    for (let i = 0; i < 4; i++) {
      const cl = clouds.cloudLayers[i];
      const cL = cont.layers[i];
      const g = genLayers[i];
      if (!cl || !cL) continue;
      if (g && cL.genus) {
        const origCover = Math.max(0, Math.min(1, cL.cover));
        let nextOpts = { ...g.opts, ...cL.opts };
        const rawCarve = (cL.opts as { flowCarve?: number } | undefined)?.flowCarve
          ?? (GENUS_FLOW[cL.genus] as { flowCarve?: number } | undefined)?.flowCarve
          ?? (nextOpts as { flowCarve?: number }).flowCarve;
        if (typeof rawCarve === 'number' && rawCarve > 0 && origCover > 0.8) {
          const carveScale = Math.max(0, Math.min(1, (0.96 - origCover) / 0.16));
          nextOpts = { ...nextOpts, flowCarve: Math.round(rawCarve * carveScale * 100) / 100 };
        } else if (typeof rawCarve === 'number') {
          nextOpts = { ...nextOpts, flowCarve: rawCarve };
        }
        if (origCover > 0.82 && cL.genus !== 'ci') {
          const tFl = Math.min(1, (origCover - 0.82) / 0.16);
          const autoFl = Math.round(tFl * tFl * (3 - 2 * tFl) * 0.32 * 20) / 20;
          const curFl = (nextOpts as { flowFloor?: number }).flowFloor ?? 0;
          if (autoFl > curFl) nextOpts = { ...nextOpts, flowFloor: autoFl };
        }
        genLayers[i] = { ...g, genus: cL.genus, opts: nextOpts };
      }
      const shape = g ? genusLayerShape(genLayers[i]!, flowDens) : bandShape(bandOf(cL));
      const height = cL.thicknessM ?? shape.height ?? cl.height;
      cl.altitude = cL.baseKm * 1000;
      cl.height = height;
      if (!activeWaveField || i > 0) {
        const ds = (cL.opts?.densityScale ?? shape.densityScale ?? cl.densityScale) * densityMul;
        if (Number.isFinite(ds) && ds >= 0) cl.densityScale = ds;
      }
    }
    if (genLayers.some(Boolean)) {
      const physIce = opt.physics && opt.physicsIce;
      const handIce = !physIce && (opt.iceHalo || opt.icePowderOff);
      const contIceLanes = physIce && lastPhysics ? lastPhysics
        : [0, 1, 2, 3].map(i => (genLayers[i]
          ? particleOpticalLane(
            genLayers[i]!.genus,
            genLayers[i]!.opts as { haloWeight?: number; powderWeight?: number } | undefined,
            handIce ? { halo: opt.iceHalo, powderOff: opt.icePowderOff } : undefined,
          )
          : null));
      const contIceOn = physIce || handIce || contIceLanes.some(Boolean);
      for (const m of genusMats) {
        setGenusUniforms(m, genLayers);
        setGenusPhysics(m, contIceLanes, contIceOn, opt.keepIceShaderLoaded);
        setGenusDiffuse(m, opt.diffuse);
        setFlowUniforms(m, genLayers, { density: flowDens, uv: genUv, macroGrad: opt.macroGrad }, GENUS_TILE_KM);
        setCellUniforms(m, cellLanesOf(genLayers, cont));
      }
    }
    if (macro && opt.macro === 1 && cont.macro) {
      const spanChanged = !macro.spanMs || !cont.macroSpanMs || macro.spanMs[0] !== cont.macroSpanMs[0] || macro.spanMs[1] !== cont.macroSpanMs[1];
      if (spanChanged) {
        const smA = macroRingSamplesOf(cont.macro);
        const smB = cont.macroNext ? macroRingSamplesOf(cont.macroNext) : {};
        if (Object.keys(smA).length) {
          macro.samples = smA;
          macro.texA = getOrBuildCachedMacroTex(smA, macro.n, macro.extentKm);
          macro.texB = Object.keys(smB).length ? getOrBuildCachedMacroTex(smB, macro.n, macro.extentKm) : macro.texA;
          macro.spanMs = cont.macroSpanMs;
          const mix = macroMixAt(cont.date, macro.spanMs);
          for (const mm of genusMats) setMacroUniforms(mm, { texA: macro.texA, texB: macro.texB, mix, extentKm: macro.extentKm, laneBand: macro.laneBand, lut: macro.lut });
        }
      }
    }
    genDate = cont.date;
    lastInput = {
      ...lastInput,
      date: cont.date,
      layers: cont.layers,
      haze: cont.haze,
      thermo: cont.thermo ?? lastInput.thermo,
      macro: cont.macro ?? lastInput.macro,
      macroNext: cont.macroNext ?? lastInput.macroNext,
      macroSpanMs: cont.macroSpanMs ?? lastInput.macroSpanMs,
      tileCoverEnvelope: cont.tileCoverEnvelope ?? lastInput.tileCoverEnvelope,
    };
    if (opt.farSun) applyFarSun(lastInput, lastSunAltForLight);
    applyHaze(lastInput.haze);
    applyCloudAir(lastInput);
  };

  /**
   * §179 WP2 구축기 입력 — 셰이더가 쓰는 값 그대로 읽음: 종류 평면 틀(genusOrigin·East·North·TileM 균일변수, §173 보정 원점), 해(clouds.sunDirection),
   * 층 높이(CloudLayer altitude·height = minLayerHeights·maxLayerHeights), 타일 운량(makeGenusWeather 입력 = 고정표 운량축), 거시 격자 바이트·mix·이류
   * (genusMacroMix·DriftU/V 균일변수). halfKm = maxRayKm + 4(설계 v2 §4.3, 없으면 400 으로 자름 — tsunAtlas 결정 A6).
   */
  const tsunBuildInputOf = (): TsunBuildInput | null => {
    const mat = clouds.cloudsPass.currentMaterial as unknown as { uniforms: Record<string, { value: unknown } | undefined> };
    const U = mat.uniforms;
    if (!(U.genusPlanar && (U.genusPlanar.value as number) > 0.5)) return null;
    const v3 = (k: string): [number, number, number] => { const v = U[k]!.value as Vector3; return [v.x, v.y, v.z]; };
    const warnings: string[] = [];
    let maxRay = opt.maxRayKm;
    if (maxRay == null) { maxRay = Math.min(400, baseMaxRay / 1000); warnings.push(`maxRayKm null — halfKm from takram maxRayDistance capped at 400 km (${maxRay} km)`); }
    const dU = U.genusMacroDriftU?.value as Vector4 | undefined, dV = U.genusMacroDriftV?.value as Vector4 | undefined;
    const mixU = (U.genusMacroMix?.value as number | undefined) ?? 0;
    const lanes: (TsunLaneInput | null)[] = [0, 1, 2, 3].map(i => {
      const g = genLayers[i], layer = clouds.cloudLayers[i];
      if (!g || !layer || !(layer.height > 0) || !(layer.densityScale > 0)) return null;
      const band = macro?.laneBand[i] ?? null;
      const comp = (v: Vector4 | undefined) => (v ? [v.x, v.y, v.z, v.w][i] : 0);
      return {
        genus: g.genus, tileCover: g.cover, baseKm: layer.altitude / 1000, topKm: (layer.altitude + layer.height) / 1000, densityScale: layer.densityScale,
        macro: macro && band ? {
          n: macro.n, extentKm: macro.extentKm, dataA: macro.texA.image.data as Uint8Array, dataB: macro.texB === macro.texA ? null : (macro.texB.image.data as Uint8Array),
          mix: mixU, channel: (band === 'low' ? 0 : band === 'mid' ? 1 : 2) as 0 | 1 | 2, driftKm: [comp(dU), comp(dV)] as [number, number],
        } : null,
      };
    });
    return {
      frame: { originM: v3('genusOrigin'), eastM: v3('genusEast'), northM: v3('genusNorth'), tileM: U.genusTileM!.value as number },
      centerKm: [tsunObsKm[0], tsunObsKm[1]], sunDir: [clouds.sunDirection.x, clouds.sunDirection.y, clouds.sunDirection.z],
      bottomRadiusKm: atmosphereParams.bottomRadius / 1000, n: opt.tsunN, halfKm: maxRay + 4, rangeKm: opt.tsunRangeKm, arch: opt.archLight === 1, lanes, warnings,
    };
  };
  // §179 만들 때 tsun 1 이면 샘플러 한도를 여기서 점검(장면 전이라 글자는 아직 넣지 않음). 끄면 아무것도 안 함.
  applyTsun();
  return {
    debug: { clouds, toneMapping },
    spectral,
    weatherMs: () => weatherMs,
    waveInfo: () => lastWaveInfo,
    farInfo: () => lastFarInfo,
    airShade: () => lastAirShade,
    cityInfo: () => cityState,
    setCityMap: (m: NightLights | null) => {
      cityMap = m;
      cityField?.tex.dispose(); cityField = null;
      if (lastInput) {
        lastSunAltForLight = sunAltAt(lastInput.date);
        updateCity(lastInput, lastInput.date);
        const exposure = exposureFor(lastSunAltForLight, lastInput);
        renderer.toneMappingExposure = exposure;
        last = { sunAltDeg: lastSunAltForLight, exposure };
      }
    },
    setCityLight: (v: number) => {
      const c = Math.max(0, Math.min(1, v));
      if (Math.abs(c - cityLight) < 1e-3) return;
      cityLight = c;
      if (!lastInput) return;
      const d = lastInput.date;
      lastSunAltForLight = sunAltAt(d);
      updateCity(lastInput, d);
      const exposure = exposureFor(lastSunAltForLight, lastInput);
      renderer.toneMappingExposure = exposure;
      last = { sunAltDeg: lastSunAltForLight, exposure };
    },
    setCityTerrainExpScale: (s: number) => {
      const next = Number.isFinite(s) ? Math.max(0.1, Math.min(2, s)) : 1;
      if (Math.abs(next - cityTerrainExpScale) < 1e-3) return;
      cityTerrainExpScale = next;
      if (lastInput) updateCity(lastInput, lastInput.date);
    },
    setAccumulating: (active: boolean) => {
      if (isAccumulating === active) return;
      isAccumulating = active;
      if (active) {
        savedAccumResScale = clouds.resolutionScale;
        clouds.resolutionScale = Math.min(savedAccumResScale, 0.28);
        clouds.clouds.minStepSize = Math.max(baseMinStepSize, 120);
        clouds.clouds.maxIterationCountToSun = Math.min(opt.sunMarch?.[0] ?? baseMarch.n ?? 6, 4);
      } else {
        if (savedAccumResScale !== null) {
          clouds.resolutionScale = savedAccumResScale;
          savedAccumResScale = null;
        }
        clouds.clouds.minStepSize = baseMinStepSize;
        applySunMarch();
      }
      clouds.temporalUpscale = active ? false : opt.temporalUpscale;
      clouds.shadow.temporalPass = active ? false : opt.shadowTemporal;
      applyPrimaryMarch();
      updateLod();
    },
    setExposureScale: (s: number) => {
      const next = Number.isFinite(s) ? Math.max(0.1, Math.min(8, s)) : 1;
      if (Math.abs(next - exposureScale) < 1e-4) return;
      exposureScale = next;
      if (!lastInput) return;
      const exposure = exposureFor(lastSunAltForLight, lastInput);
      renderer.toneMappingExposure = exposure;
      last = { sunAltDeg: lastSunAltForLight, exposure };
    },
    flowInfo: () => {
      const st = (weather?.userData as { flow?: { s90?: number; hoursUsed?: number } } | undefined)?.flow;
      return { s90: st?.s90 ?? null, hoursUsed: st?.hoursUsed ?? null, camKm: lastCamKm };
    },
    physicsInfo: () => lastPhysics,
    camera,
    setPreset,
    setScene,
    setSceneAsync,
    hasCachedScene,
    prewarmScenesAsync,
    cancelAsync: () => {
      sceneToken++;
    },
    setView,
    setEyeOffset: (northM: number, eastM: number) => {
      const n = Number.isFinite(northM) ? northM : 0, e = Number.isFinite(eastM) ? eastM : 0;
      if (n === eyeNorthM && e === eyeEastM) return;
      eyeNorthM = n; eyeEastM = e;
      if (lastInput) placeCamera(lastInput);
    },
    setDate,
    updateContinuousScene,
    lastScene: () => last,
    // 품질 단계가 2차 행진 값을 덮어쓰므로 다시 겁니다.
    setQuality: q => {
      // §179 T_sun 이 켜져 있으면 새 단계의 샘플러 한도를 바꾸기 전에 점검(넘으면 throw — 상태를 바꾸지 않음).
      if (opt.tsun === 1) checkTsunSamplerBudget(q, maxTextureUnits());
      curQuality = q;
      // §169 takram 품질 단계는 resolutionScale 까지 1 로 덮어씁니다. 하늘 화면은 해상도를 품질 다음에 다시 걸지 않아
      // (자동 조절기가 값이 그대로면 null) 기기가 설정 0.5 대신 1.0 으로 그렸습니다 — 하네스는 품질 뒤에 해상도를 걸어 0.5.
      const res = clouds.resolutionScale;
      clouds.qualityPreset = q;
      clouds.resolutionScale = res;
      // §140 low 프리셋의 1차 행진 최소 보폭 100 m 는 모양 잡음(수백 m 주기)을 성기게 떠서 텍셀마다 투과율이 3~4 텍셀 덩어리로 흔들립니다
      // (기기 캡처의 흰 점·알갱이; 하네스 low 렌더 알파 편차 0.0070 → 0.0044, medium 0.0045). 보폭만 medium 과 같은 50 m 로 — 반복 수 200·종료 투과율 0.1 은 그대로.
      if (q === 'low') clouds.clouds.minStepSize = LOW_MIN_STEP_M;
      baseMinStepSize = clouds.clouds.minStepSize;
      baseMaxIter = clouds.clouds.maxIterationCount;
      baseMaxRay = clouds.clouds.maxRayDistance;
      applyMaxRay();
      baseAccurate = clouds.clouds.accurateSunSkyLight;
      applySunLight();
      baseMarch.n = clouds.clouds.maxIterationCountToSun;
      baseMarch.step = clouds.clouds.minSecondaryStepSize;
      baseMarch.scale = clouds.clouds.secondaryStepScale;
      applySunMarch();
      applyPrimaryMarch();
      if (isInteracting) applyInteractionLod();
      applyTsun();
    },
    setInteracting: (active, deferFarSun = false) => {
      if (isInteracting === active) return;
      isInteracting = active;
      applyInteractionLod();
      if (!active && !deferFarSun) {
        if (opt.farSun && lastInput && farMap?.draft) {
          applyFarSun(lastInput, lastSunAltForLight);
        }
        if (macro && opt.macro === 1 && lastInput?.macro && macro.texA.image.width < macro.n) {
          const smA = macroRingSamplesOf(lastInput.macro);
          const smB = lastInput.macroNext ? macroRingSamplesOf(lastInput.macroNext) : {};
          if (Object.keys(smA).length) {
            macro.texA = getOrBuildCachedMacroTex(smA, macro.n, macro.extentKm);
            macro.texB = Object.keys(smB).length ? getOrBuildCachedMacroTex(smB, macro.n, macro.extentKm) : macro.texA;
            const mix = macroMixAt(lastInput.date, macro.spanMs);
            for (const mm of genusMats) setMacroUniforms(mm, { texA: macro.texA, texB: macro.texB, mix, extentKm: macro.extentKm, laneBand: macro.laneBand, lut: macro.lut });
            syncFar2DDrift();
          }
        }
      }
    },
    setOptions: (o, reapply = true) => {
      // §179 합친 값으로 먼저 점검 — throw 하면 옵션을 바꾸지 않음. 하늘 화면은 매 프레임 부르므로 T_sun 이 꺼져 있고 관련 키(T_sun 손잡이·genus·diffuse)를
      // 건드리지 않으면 건너뜀(이미 점검한 값 그대로).
      if (opt.tsun === 1 || opt.tsunRef !== 0 || Object.keys(o).some(k => k in TSUN_OPTIONS_OFF || k === 'genus' || k === 'diffuse')) {
        const next = { ...opt, ...o } as VolumetricOptions;
        validateTsunOptions(next);
        if (next.tsun === 1) checkTsunSamplerBudget(curQuality, maxTextureUnits());
      }
      Object.assign(opt, o);
      applySunMarch();
      applyCloudLight();
      if (isInteracting) applyInteractionLod();
      updateLod();
      clouds.temporalUpscale = opt.temporalUpscale;
      clouds.shadow.temporalPass = opt.shadowTemporal;
      applySunLight();
      applyMaxRay();
      applyLightingFix();
      if (opt.keepIceShaderLoaded && !lastInput) {
        const initGrain = { refine: opt.refineOnHit, sunLowpass: opt.sunLowpass, erode: opt.erodeCentered, jitter: opt.jitterMode };
        for (const m of genusMats) {
          setGrainKnobs(m, initGrain, opt.erodePixelAngleDeg);
          setGenusDiffuse(m, opt.diffuse);
          setGenusPhysics(m, [], false, true);
        }
      }
      applyTsun();
      // §130 하늘 화면은 reapply=false 로 부르고 제 키를 비워 setSceneAsync 로 다시 만듭니다(흐름 날씨를 동기로 만들면 수 초 멈춤).
      if (lastInput && reapply) setScene(lastInput);
    },
    setResolutionScale: s => { clouds.resolutionScale = s; updateLod(); },
    resolutionScale: () => clouds.resolutionScale,
    render: dt => { tonePass.renderToScreen = true; setCloudAlphaOut(false); composer.render(dt); },
    // 마지막 패스를 화면 대신 출력 버퍼로 — 패스가 끝나면 버퍼가 바뀌어 결과는 inputBuffer 에 있습니다(postprocessing 6).
    // postprocessing 은 렌더러의 autoClear 를 끕니다 — 하늘 화면 합성기는 제 몫을 스스로 정하지만, 다른 직접 그리기
    // 경로(스냅샷 등)가 놀라지 않게 되돌립니다.
    renderToTexture: dt => {
      const prevAutoClear = renderer.autoClear;
      tonePass.renderToScreen = false; setCloudAlphaOut(true); composer.render(dt);
      renderer.autoClear = prevAutoClear;
      return (composer.inputBuffer as unknown as { texture: Texture }).texture;
    },
    setTerrainDistance,
    setTsunAtlas: atlas => {
      if (atlas) validateTsunAtlas(atlas, opt, sceneSerial);
      tsunAtlas = atlas;   // 텍스처는 부른 쪽 소유(dispose 하지 않음)
      applyTsun();
    },
    tsunBuildInput: () => tsunBuildInputOf(),
    tsunSceneSerial: () => sceneSerial,
    tsunInfo: () => ({
      enabled: opt.tsun === 1, injected: (opt.tsun === 1 || opt.tsunRef !== 0) && lastShadow === false, arch: opt.archLight === 1,
      ref: opt.tsunRef, debug: opt.tsunDebug,
      belowShadow: lastShadow === null ? null : !lastShadow, atlasValid: opt.tsun === 1 && tsunAtlasValid, reason: tsunReason,
      archW: tsunArchW, samplers: tsunSamplers, sceneSerial, atlasMeta: tsunAtlas?.meta ?? null,
    }),
    setSize: (w, h) => {
      camera.aspect = w / h; camera.updateProjectionMatrix();
      composer.setSize(w, h);
      viewH = h; updateLod();
    },
    dispose: () => {
      disposeMacro();
      farMap?.map.tex.dispose(); farMap = null; farCover = null;
      tsunAtlas = null;   // §179 아틀라스 텍스처는 부른 쪽 소유(dispose 하지 않음)
      disposed = true;
      composer.dispose();
      clouds.dispose();
      aerial.dispose();
      // generator 는 atmosGeneratorCache (WeakMap<WebGLRenderer, ...>) 에 공유 캐시되어 재사용되므로 여기서 dispose 하지 않습니다.
      for (const t of weatherCache.values()) t.dispose();
      weatherCache.clear();
      for (const f of waveCacheMap.values()) f.tex.dispose();
      waveCacheMap.clear();
      activeWaveField = null;
    },
  };
}
