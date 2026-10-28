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
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import { EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { AerialPerspectiveEffect, PrecomputedTexturesGenerator, getSunDirectionECEF } from '@takram/three-atmosphere';
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
import { flowCamCellOffsetKm, flowCoverIn, genusCoverIn, genusEnvelope, genusLayerShape, makeGenusWeather, makeGenusWeatherAsync, mergeFlowOpts, morphCoverIn, morphShapeOpts, patchGenusShader, planFlowScene, setGenusFrame, setGenusDiffuse, setGenusLightFloors, setGenusPhysics, setGenusSkeleton, setGenusUniforms, setGrainKnobs, type GenusKey, type GenusLayer, type GenusParams, GENUS } from './cloudGenus';
import { morphParamsOf } from './cloudMorph';
import type { FlowSceneParams } from './cloudFlow';
import { iceLaneHand, layerPhysics, type LayerPhysics, type ThermoInput } from './cloudPhysics';
import { skeletonOf, type SkeletonGenus } from './cloudSkeleton';
import { patchFlowShader, setFlowUniforms, setGenusDrift, setSkeletonTilt } from './cloudFlowShader';
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
  /** §136 물리(physics 켬)일 때의 밑면(km, 해발) — 적운류 = 지면 + 응결고도. 물리가 꺼져 있으면 쓰지 않습니다. */
  physBaseKm?: number;
}
export interface VolumetricSceneInput {
  lat: number; lon: number; heightM: number;
  date: Date;
  /** 시선 방위·고도·세로 시야(도) */
  az: number; el: number; fov: number;
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
}
export interface MacroRingPoint { distance: number; azimuthOffset: number; cover: number }

/**
 * §146 연무. 높이 H=1.5 km 로 지수 감쇠하는 에어로졸 층의 시선 광학두께로 하늘·구름·지형을 뿌옇게 합니다.
 * aod: 550nm 광학두께(배경 초과분) · alpha: Ångström 지수(클수록 푸른빛을 더 산란 — 초미세먼지) ·
 * g: 비대칭도(클수록 해 쪽으로 앞산란 — 조대 먼지) · omega: 단일 산란 반사율.
 */
export interface HazeInput { aod: number; alpha: number; g: number; omega: number }
export const HAZE_SCALE_HEIGHT_KM = 1.5;

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
  [50, 5.8], [30, 7.2], [15, 8.0], [8, 9.4], [3, 16.1], [1.1, 30], [-2.7, 100], [-8, 1000],
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
  { key: 'kz1029', label: '가나자와 10:29', lat: 36.5679, lon: 136.6774, heightM: 103, iso: '2026-10-03T01:29:00Z',
    az: 161.6, el: 13.9, fov: 60, cover: [0.3, 0, 0], altKm: [1.5, 4.5, 10], exposure: 10, genus: ['cu', null, null] },
  { key: 'fk1728', label: '후쿠이 17:28', lat: 36.0209, lon: 136.2894, heightM: 23, iso: '2026-10-02T08:28:00Z',
    az: 265, el: 12, fov: 60, cover: [0, 0.6, 0], altKm: [1.5, 7.0, 10], exposure: 30, genus: [null, null, null] },
  { key: 'fk1747', label: '후쿠이 17:47 잔광', lat: 36.0209, lon: 136.2894, heightM: 23, iso: '2026-10-02T08:47:00Z',
    az: 255, el: 20, fov: 60, cover: [0, 0.6, 0], altKm: [1.5, 7.0, 10], exposure: 100, genus: [null, null, null] },
];

export interface GLCapabilities {
  renderer: string;
  version: string;
  max3DTextureSize: number;
  colorBufferFloat: boolean;
  colorBufferHalfFloat: boolean;
  floatLinear: boolean;
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

/** STBN 대신 백색 잡음 — 1MB 자산을 싣지 않으려고. */
function makeWhiteNoise3D(): Data3DTexture {
  const n = STBN_TEXTURE_WIDTH * STBN_TEXTURE_HEIGHT * STBN_TEXTURE_DEPTH;
  const data = new Uint8Array(n);
  let s = 12345;
  for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; data[i] = s >>> 24; }
  const t = new Data3DTexture(data, STBN_TEXTURE_WIDTH, STBN_TEXTURE_HEIGHT, STBN_TEXTURE_DEPTH);
  t.format = RedFormat; t.type = UnsignedByteType;
  t.minFilter = NearestFilter; t.magFilter = NearestFilter;
  t.wrapS = t.wrapT = t.wrapR = RepeatWrapping;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** 종류별 모형의 날씨 텍스처 한 장이 덮는 길이(km). 512 칸이면 47m/칸. */
const GENUS_TILE_KM = 24;

/** 시험용 손잡이 — 기본값은 기기 시험판 그대로. */
export interface VolumetricOptions {
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
  diffuse: 0 | 1 | 2 | 3 | 9;
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
}
export const DEFAULT_VOLUMETRIC_OPTIONS: VolumetricOptions = { weatherPeriod: 16, weatherRamp: 2, shadowMinSunDeg: 12, bufferType: 'half', frame: 'local', shadowMaxFar: null, atmosphereShadow: true, temporalUpscale: true, shadowTemporal: true, sunMarch: [6, 250, 1.6], genus: false, celestial: true, weatherLod: null, accurateSunBelowDeg: null, maxRayKm: 100, coverRemap: true, flow: false, flowDensity: true, flowUv: false, flowN: 64, flowSteps: 20, flowHours: 0.5, flowVrms: 2, flowPsiEvery: 2, flowQMode: 0, flowQN: 128, flowQH: 0.5, flowS90: 0, flowCamCell: false, physics: false, physicsIce: false, iceHalo: false, icePowderOff: false, debugLightFloors: null, diffuse: 0, skeleton: 0, skeletonTiltScale: 1, profileBase: null, macro: 0, macroN: 128, macroGrad: false, morph: false, refineOnHit: 0, sunLowpass: 0, erodeCentered: 0, erodePixelAngleDeg: null, jitterMode: 0, debugDensityMul: 1 };

export interface VolumetricScene {
  camera: Camera;
  setPreset(p: VolumetricPreset): void;
  /** 일반 장면 입력(§126). setPreset 은 이것의 얇은 포장입니다. 날씨 텍스처를 만들므로(캐시에 없으면) 층이 바뀔 때만 부릅니다. */
  setScene(input: VolumetricSceneInput): void;
  /**
   * §127 setScene 의 비동기판 — 날씨를 잘라 만드는 동안 이전 장면을 계속 그립니다(폰에서 JS 를 1초 넘게 막지 않게).
   * 더 새 setScene/setSceneAsync 가 오면 버려지고 false. isFast 가 참이면 드래그 중 S=128 초고속 모드로 생성합니다.
   */
  setSceneAsync(input: VolumetricSceneInput, isFast?: boolean): Promise<boolean>;
  /** 진행 중인 setSceneAsync 생성을 즉시 취소합니다(슬라이더 조작 완료 직후 등). */
  cancelAsync?(): void;
  /** 시선 및 고도만 바꿉니다(매 프레임 싸게). */
  setView(az: number, el: number, fov: number, altitudeM?: number): void;
  /** 시각만 바꿉니다(해 방향·노출·바람 드리프트). driftSec 는 §155 바람 드리프트 시각(초), 없으면 date. */
  setDate(date: Date, driftSec?: number): void;
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
  /** §136 진단: 마지막 장면의 층별 물리 값(β·τ·얼음·무리·가루) — 물리가 꺼져 있으면 null */
  physicsInfo(): (LayerPhysics | null)[] | null;
  /** 진단용 — 하네스에서만 씁니다. */
  debug: { clouds: CloudsEffect; toneMapping: ToneMappingEffect };
  /** §128 대기 표가 파장 15개(분광 휘도)인지 — false 면 takram 3파장. */
  readonly spectral: boolean;
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
  const applySunLight = () => {
    const want = baseAccurate || (opt.accurateSunBelowDeg != null && lastSunAltForLight < opt.accurateSunBelowDeg);
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
  const applyMaxRay = () => { clouds.clouds.maxRayDistance = opt.maxRayKm != null ? opt.maxRayKm * 1000 : baseMaxRay; };
  const applySunMarch = () => {
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
  };
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
    src = src.replace(shLen, shLen + '\n  shadowLength = max(shadowLength, volTerrainShadowKm(normalize(vRayDirection), 1e9));');
    src = src.replace(head, [
      'uniform sampler2D terrainDist;', 'uniform float terrainDistOn;', 'uniform float cloudAlphaOut;',
      'uniform sampler2D terrainLit;', 'uniform sampler2D terrainLit2;', 'uniform float terrainLitOn;',
      'uniform sampler2D sunRidgeTex;', 'uniform float sunRidgeOn;', 'uniform float seaSlopeVar;',
      'float volTerrainLitHit = 0.0;',
      TERRAIN_DIST_GLSL, SUN_RIDGE_DECODE_GLSL,
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
      head.replace('void mainImage(', 'void volBaseImage('),
    ].join('\n'));
    src = src.replace(skyA, [
      // 구름이 없으면(겹칠 층이 아직 없음) 불투명도 0 — 아래 HAS_OVERLAY 가 있으면 그 알파로 바뀝니다.
      'outputColor.a = cloudAlphaOut > 0.5 ? 0.0 : 1.0;',
      '    if (terrainDistOn > 0.5) {',
      '      float vtKm = terrainDistDecodeKm(texture(terrainDist, uv));',
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
      '          vtSky = mix(vtSky, vec3(dot(vtSky, vec3(0.2126, 0.7152, 0.0722))), 0.75 * vtL2.a);',
      '          vec3 vtRad;',
      '          if (texture(terrainDist, uv).b > 0.5) {',
      // 바다(SeaPlane 쌍둥이, B=1): 수체·바닥·포말 = 알베도 × 수평면 조도(직달 × 구름 그림자), 하늘 되비침 = 거울 방향의
      // takram 하늘(물 n=1.33 Schlick 프레넬), 윤슬 = Cox-Munk(파면 경사 분산 seaSlopeVar) × 해 조도 × 구름 그림자.
      '            float cosV = max(0.02, -dot(rayDirection, vtUp));',
      '            float F = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);',
      '            vec3 tRefl;',
      '            vec3 refl = GetSkyRadiance(vtP, reflect(rayDirection, vtUp), 0.0, sunDirection, tRefl);',
      '            float vtSunH = max(0.0, dot(vtUp, sunDirection));',
      '            vec3 body = vtAlb * (1.0 / 3.14159265) * (vtSun * vtSunH * (vtLit.a + vtFill) + vtSky);',
      '            vec3 V = -rayDirection;',
      '            vec3 Hh = normalize(V + sunDirection);',
      '            float cosN = max(dot(Hh, vtUp), 1e-3);',
      '            float tan2 = max(0.0, 1.0 - cosN * cosN) / (cosN * cosN);',
      '            float sv = max(1e-3, seaSlopeVar);',
      '            float pg = min(exp(-min(tan2 / sv, 50.0)) / (3.14159265 * sv * pow(cosN, 4.0)), 220.0);',
      '            float Fg = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, Hh), 0.0, 1.0), 5.0);',
      '            vec3 glint = vtSun * vtLit.a * Fg * pg / (4.0 * cosV);',
      '            vtRad = mix(body, refl, F) + glint;',
      '          } else {',
      '            // 해 직달(Lambert × 산·구름 그림자) + 하늘빛과 구름을 뚫은 확산 햇빛(수평면 몫) × 하늘 보임·사면 방향.',
      '            float vtSunH = max(0.0, dot(vtUp, sunDirection));',
      '            vtRad = vtAlb * albedoScale * (1.0 / 3.14159265) * (vtSun * vtLit.a + (vtSky + vtSun * vtSunH * vtFill) * vtAmb);',
      // 젖은 갯벌·모래: 스치는 각일수록 하늘을 비춥니다(물 n=1.33 Schlick — 바다와 같은 식). 물 쪽 되비침과 한 줄로 이어집니다.
      '            if (vtWet > 0.004) {',
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
      '              vtRad += vtSun * min(vtLit.a / max(vtSunH, 0.05), 1.0) * wFg * wPg / (4.0 * wCosV) * vtWet * 0.5;',
      '            }',
      '          }',
      '          #if defined(TRANSMITTANCE) || defined(INSCATTER)',
      '          applyTransmittanceInscatter(vtP, min(shadowLength, vtKm), vtRad);',
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
      '', 'uniform float hazeOn;', 'uniform vec4 hazeP;   // aod, alpha, g, omega',
      'void mainImage(const vec4 inputColor, const vec2 uv, out vec4 outputColor) {',
      '  volBaseImage(inputColor, uv, outputColor);',
      '  if (hazeOn < 0.5) return;',
      '  vec3 hRd = normalize(vRayDirection);',
      '  vec3 hUp = normalize(vCameraPosition);',
      '  float hSin = max(abs(dot(hRd, hUp)), 0.03);',
      '  float hKm = 1e9;',
      '  if (terrainDistOn > 0.5) { float k = terrainDistDecodeKm(texture(terrainDist, uv)); if (k < 1e8) hKm = k; }',
      `  float hH = ${HAZE_SCALE_HEIGHT_KM.toFixed(2)};`,
      // 시선을 따라 쌓인 광학두께 = AOD ∫exp(-h/H)ds/H ≈ AOD/sinθ · (1 − exp(−d·sinθ/H))
      '  float hTau = hazeP.x / hSin * (1.0 - exp(-min(hKm, 1e4) * hSin / hH));',
      '  vec3 hTv = hTau * pow(vec3(640.0, 550.0, 460.0) / 550.0, vec3(-hazeP.y));',
      '  vec3 hT = exp(-hTv);',
      '  vec3 hSkyE;',
      '  vec3 hSunE = GetSunAndSkyIrradiance(vCameraPosition, sunDirection, sunDirection, hSkyE);',
      '  float hCos = dot(hRd, normalize(sunDirection));',
      '  float hG = hazeP.z;',
      '  float hPh = (1.0 - hG * hG) / (12.5663706 * pow(max(1.0 + hG * hG - 2.0 * hG * hCos, 1e-3), 1.5));',
      // 실제 에어로졸은 옆·뒤 산란이 HG 한 덩어리보다 큽니다 → 등방 35% 섞음. 하늘 조도 항은 두꺼울수록 다중산란으로 채워 /π 에 가깝게.
      '  hPh = mix(hPh, 0.0795775, 0.35);',
      '  vec3 hL = hazeP.w * (hSunE * hPh + hSkyE * mix(0.1591549, 0.3183099, 1.0 - exp(-hazeP.x * 2.0)));',
      '  outputColor.rgb = outputColor.rgb * hT + hL * (vec3(1.0) - hT);',
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
    fx.uniforms.set('seaSlopeVar', new Uniform(0.03));
    fx.setFragmentShader(src);
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
  // §130 흐름 모형 셰이더(연속 밀도·층별 fetch) — 종류 패치 직후, 두 패스 모두. 레인이 0 이면 화소 단위로 이전과 같습니다.
  patchFlowShader(clouds.cloudsPass.currentMaterial as never);
  patchFlowShader(clouds.shadowPass.currentMaterial as never);
  patchMacroShader(clouds.cloudsPass.currentMaterial as never);
  patchMacroShader(clouds.shadowPass.currentMaterial as never);
  const genusMats = [clouds.cloudsPass.currentMaterial, clouds.shadowPass.currentMaterial] as never[];
  const baseWeatherRepeat = clouds.localWeatherRepeat.clone();
  clouds.shapeTexture = new CloudShape();
  clouds.shapeDetailTexture = new CloudShapeDetail();
  clouds.turbulenceTexture = new Turbulence();
  clouds.stbnTexture = makeWhiteNoise3D();

  // 대기 표: 기기 GPU 에서 만듭니다(자산 25MB 를 싣지 않으려고). 하네스는 takram 의 미리 만든 표를 넘겨 비교할 수 있습니다.
  const generator = options.precomputed ? null : new PrecomputedTexturesGenerator(renderer);
  if (generator && spectral && !patchSpectralGenerator(generator, { effectiveTransmittance: options.effectiveTransmittance ?? true })) {
    spectral = false;
    atmosphereParams.skyRadianceToRelativeLuminance.copy(renderAtmosphere(false).skyRadianceToRelativeLuminance);
    console.warn('[volumetric] takram 표 생성기 내부가 달라 3파장 표로 만듭니다');
  }
  if (generator) await generator.update();
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
  } | null = null;
  const MACRO_STEP_SEC = 60;
  const disposeMacro = () => {
    if (!macro) return;
    macro.texA.dispose(); if (macro.texB !== macro.texA) macro.texB.dispose(); macro.lut.dispose();
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
  /** 띠 표본의 150 km 안 상위 분위수(p75) — 타일 운량을 이만큼 올려 잡아 셰이더 문턱이 깎을 여지를 둡니다. */
  const macroTileCover = (pts: MacroRingPoint[] | undefined, cover: number) => {
    if (!pts || pts.length < 12) return cover;
    const near = pts.filter(q => q.distance <= 150).map(q => Math.min(1, Math.max(0, q.cover))).sort((a, b) => a - b);
    if (near.length < 6) return cover;
    return Math.max(cover, near[Math.min(near.length - 1, Math.floor(near.length * 0.75))]);
  };
  /** §155 하늘 화면이 준 드리프트 시각(초) — `setDate` 의 두 번째 인자. 없으면 씬 시각. */
  let driftSecOverride: number | null = null;
  /** §131 K 가 고른 관측점 오프셋(km) — 진단·하네스 출력용 */
  let lastCamKm: [number, number] | null = null;
  /** §136 마지막 장면의 층별 물리 값(진단·하네스 출력용) — 물리가 꺼져 있으면 null */
  let lastPhysics: (LayerPhysics | null)[] | null = null;
  const sun = new Vector3();

  let lastInput: VolumetricSceneInput | null = null;
  let last: { sunAltDeg: number; exposure: number } | null = null;
  let curPos = new Vector3(), curNue = new Matrix4();
  let lastShadow: boolean | null = null;
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
      camera.position.copy(position).addScaledVector(up, alt);
      // 직하향 탑다운(레이더 뷰)일 때 up 벡터가 dir과 평행해지는 짐벌락 방지 -> 지도 북쪽을 화면 위로 정렬
      if (Math.sin(el) < -0.98) {
        camera.up.copy(north);
      } else {
        camera.up.copy(up);
      }
      camera.lookAt(camera.position.clone().add(dir));
    } else {
      // 장면 좌표는 북·위·동(NUE).
      worldToECEF = nue;
      camera.position.set(0, alt, 0);
      if (Math.sin(el) < -0.98) {
        camera.up.set(1, 0, 0); // 북쪽(X축)
      } else {
        camera.up.set(0, 1, 0);
      }
      camera.lookAt(Math.cos(el) * Math.cos(az), alt + Math.sin(el), Math.cos(el) * Math.sin(az));
    }
    aerial.worldToECEFMatrix.copy(worldToECEF);
    clouds.worldToECEFMatrix.copy(worldToECEF);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    updateLod();
  };
  const sunAltAt = (date: Date) => {
    getSunDirectionECEF(date, sun);
    const local = sun.clone().transformDirection(curNue.clone().invert());
    return (Math.asin(Math.max(-1, Math.min(1, local.y))) * 180) / Math.PI;
  };
  // §127 날씨 텍스처 캐시 — 날씨는 층(종류·운량·손잡이)만으로 정해지고 시각·시선과 무관합니다. 시간 막대를 앞뒤로
  // 움직이거나 그림자 지도 문턱(해 12°)을 넘나들 때마다 CPU 로 다시 만들던 것(적운 512² 크롬 1.3초)을 건너뜁니다.
  // 운량은 1% 눈금으로 묶습니다(예보 보간값의 소수점 차이로 다시 만들지 않게).
  const weatherCache = new Map<string, DataTexture>();
  const WEATHER_CACHE_SIZE = 8;
  const bandOfInput = (L: VolumetricLayerInput): MacroBand => L.band ?? (L.baseKm >= 7 ? 'high' : L.baseKm >= 2 ? 'mid' : 'low');
  const weatherPlan = (p: VolumetricSceneInput, isFast = false) => {
    const S = isFast ? 128 : 256;
    const quantStep = isFast ? 0.05 : 0.01;
    const quantCover = (c: number) => Math.round(Math.max(0, Math.min(1, c)) / quantStep) * quantStep;
    const inputs = p.layers.slice(0, 4).map(L => (opt.macro > 0 && p.macro ? { ...L, cover: macroTileCover(p.macro[bandOfInput(L)], L.cover) } : L));
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
      const above = inputs.slice(i + 1).find(o => o.baseKm > L.baseKm);
      const shearDzKm = Math.max(0.5, (above?.baseKm ?? L.baseKm + 3) - L.baseKm);
      return mergeFlowOpts({ genus: L.genus, cover: flowCoverIn(L.genus, qc), opts: { ...L.opts, shearDzKm } });
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
    const key = JSON.stringify([useGenus, gl, plain, useGenus ? (flow ? ['flow', flow] : 0) : [opt.weatherPeriod, opt.weatherRamp], S]);
    return { inputs, gl, useGenus, plain, key, flow, S };
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
  /** 날씨가 준비된 뒤 장면을 한 번에 겁니다(층·종류 균일변수·날씨·노출). */
  const applyScene = (p: VolumetricSceneInput, plan: WeatherPlan, tex: DataTexture) => {
    lastInput = p;
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

    clouds.cloudLayers.length = 0;
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
      if (!L) { clouds.cloudLayers.push(new CloudLayer({ channel: CH[i], altitude: 0, height: 0, densityScale: 0 })); continue; }
      const g = useGenus ? gl[i] : null;
      const shape = g ? genusLayerShape(g, flowDens) : bandShape(bandOf(L));
      if (L.thicknessM) shape.height = L.thicknessM;
      // §139 뼈대(K0h·K1·K2): 층 밑면·두께는 뼈대 값이 최종(예보 덱 두께·physBaseKm 보다 우선). 뚜껑 층은 밀도 단면 평평(밑면이 가장 옅지 않게).
      const skg = g?.opts?.skeleton ?? g?.opts?.skelGeom;
      if (skg) shape.height = skg.heightM;
      // 상층(권운류)은 얇고 멀어 층 그림자 지도를 쓰지 않습니다(이전과 같음).
      const layerShadow = bandOf(L) === 'high' && !g ? undefined : shadow;
      // §136 물리: 종류 층의 소광·세로 단면을 기온·기압에서(cloudPhysics). 꺼져 있으면 CloudLayer 에 아무것도 더하지 않습니다(이전과 같은 바이트).
      const physRaw = g && opt.physics ? layerPhysics(g.genus, (L.physBaseKm ?? L.baseKm) * 1000, shape.height ?? 0, p.thermo, genusEnvelope(g)) : null;
      // 입력이 깨져(NaN) 값이 유한하지 않으면 그 층은 손값 그대로 — 구름이 조용히 사라지지 않게.
      const phys = physRaw && Number.isFinite(physRaw.betaTop) && physRaw.betaTop >= 0 && physRaw.profile.every(Number.isFinite) ? physRaw : null;
      physLanes[i] = phys;
      const altitude = skg ? skg.baseM : (phys && L.physBaseKm != null ? L.physBaseKm : L.baseKm) * 1000;
      const physShape = phys ? { densityScale: phys.betaTop, densityProfile: { expTerm: phys.profile[0], exponent: phys.profile[1], linearTerm: phys.profile[2], constantTerm: phys.profile[3] } }
        : g?.opts?.skeleton?.mode === 3 ? { densityProfile: { expTerm: 0, exponent: 0, linearTerm: 0, constantTerm: 1 } }
        : g && (opt.profileBase ?? g.opts?.profileBase ?? GENUS[g.genus].profileBase) != null
          ? { densityProfile: { expTerm: 0, exponent: 0, linearTerm: 1 - (opt.profileBase ?? g.opts?.profileBase ?? GENUS[g.genus].profileBase)!, constantTerm: (opt.profileBase ?? g.opts?.profileBase ?? GENUS[g.genus].profileBase)! } }
        : {};
      const layer = new CloudLayer({ channel: CH[i], altitude, ...shape, ...physShape, coverageFilterWidth: CFW, shadow: layerShadow });
      // RULER-grain E3c 진단: 층 소광 배율(균일변수가 아니라 층 값 — takram 이 매 프레임 재포장해도 남음). 기본 1 이면 손대지 않음.
      if (opt.debugDensityMul !== 1) layer.densityScale *= opt.debugDensityMul;
      clouds.cloudLayers.push(layer);
    }
    lastPhysics = physLanes.some(Boolean) ? physLanes : null;
    // §136·§137 얼음 레인: physics+physicsIce 면 물리 값, 아니면 iceHalo·icePowderOff 의 손값 레인(얼음 종류 층만), 둘 다 아니면 없음.
    const physIce = opt.physics && opt.physicsIce;
    const handIce = !physIce && (opt.iceHalo || opt.icePowderOff);
    const iceLanes = physIce ? physLanes
      : handIce ? [0, 1, 2, 3].map(i => (useGenus && gl[i] ? iceLaneHand(gl[i]!.genus, { halo: opt.iceHalo, powderOff: opt.icePowderOff }) : null))
      : [];
    const iceOn = physIce || handIce;
    // RULER-grain §8.2 셰이더 손잡이 — 종류 모형 여부와 무관하게 두 재질 모두(구름 패스 전용 손잡이는 그림자 패스에서 아무것도 안 함).
    const grainKnobs = { refine: opt.refineOnHit ? 1 : 0, sunLowpass: opt.sunLowpass ? 1 : 0, erode: opt.erodeCentered === 2 ? 2 : opt.erodeCentered ? 1 : 0, jitter: opt.jitterMode ? 1 : 0 } as const;
    for (const m of genusMats) setGrainKnobs(m, grainKnobs, opt.erodePixelAngleDeg);
    if (useGenus) {
      // §124: 층마다 종류별 무늬·단면. 종류가 없는 층은 기본 잡음을 같은 텍스처의 다른 채널에 둡니다.
      const north = new Vector3(), up = new Vector3(), east = new Vector3();
      nue.extractBasis(north, up, east);
      clouds.localWeatherRepeat.setScalar(1);
      // §131 K: 관측점을 국소 운량 ≈ 전역 운량인 칸으로(타일 바이트는 그대로). 장면 입력이 오프셋을 주면 그것이 우선.
      const camKm = plan.flow && opt.flowCamCell && !p.weatherOffsetKm ? flowCamCellOffsetKm(tex.image.data as Uint8Array, tex.image.width, gl, GENUS_TILE_KM) : null;
      lastCamKm = camKm;
      const driftSec = driftSecOverride ?? p.date.getTime() / 1000;
      for (const m of genusMats) {
        setGenusUniforms(m, gl);
        setGenusSkeleton(m, gl, opt.skeleton >= 2);
        setGenusPhysics(m, iceLanes, iceOn);
        setGenusLightFloors(m, opt.debugLightFloors);
        setGenusDiffuse(m, opt.diffuse);
        setFlowUniforms(m, gl, { density: flowDens, uv: flowUv, macroGrad: opt.macroGrad }, GENUS_TILE_KM);
        setGenusDrift(m, gl, driftSec, GENUS_TILE_KM);
        // 거시 격자는 표본 시각(장면 시각)에 자리가 맞으므로 그때부터 흐른 시간만큼만(km, 감싸지 않음)
        setMacroDrift(m, gl, driftSec - p.date.getTime() / 1000);
        if (opt.skeleton === 3) setSkeletonTilt(m, gl, opt.skeletonTiltScale);   // 드리프트 뒤(드리프트 0 으로 덮음)
        const [ox, oy] = p.weatherOffsetKm ?? camKm ?? [0, 0];
        const origin = position.clone().addScaledVector(east, -ox * 1000).addScaledVector(north, -oy * 1000);
        setGenusFrame(m, { origin, east, north, tileM: GENUS_TILE_KM * 1000 });
      }
      // §156 거시 운량 격자 — 띠마다 고리 표본 → 격자(Barnes [+ 잡음]) → 텍스처, 타일 바이트 히스토그램 → 레인별 문턱 표.
      disposeMacro();
      if (opt.macro > 0 && p.macro) {
        const samples: Partial<Record<MacroBand, MacroSample[]>> = {};
        for (const b of ['low', 'mid', 'high'] as MacroBand[]) {
          const pts = p.macro[b];
          if (pts && pts.length >= 12) samples[b] = samplesFromRing(pts.map(q => ({ distance: q.distance, azimuthOffset: q.azimuthOffset, cover: q.cover * 100 })));
        }
        if (Object.keys(samples).length) {
          const n = opt.macroN, extentKm = 768;
          const laneBand = [0, 1, 2, 3].map(i => (inputs[i] ? bandOfInput(inputs[i]) : null));
          const m: NonNullable<typeof macro> = { samples, states: {}, fields: {}, texA: null as unknown as DataTexture, texB: null as unknown as DataTexture, lut: null as unknown as DataTexture, laneBand, n, extentKm, lastSec: driftSecOverride };
          const tex0 = macroBuildFields(m, opt.macro === 2);
          m.texA = tex0; m.texB = tex0;
          const S = tex.image.width;
          m.lut = makeMacroLutTexture([0, 1, 2, 3].map(i => (inputs[i] && laneBand[i] && samples[laneBand[i]!] ? macroThresholdTable(tex.image.data as Uint8Array, S, i) : null)));
          macro = m;
          for (const mm of genusMats) setMacroUniforms(mm, { texA: m.texA, texB: m.texB, mix: 0, extentKm, laneBand, lut: m.lut });
        }
      }
      if (!macro) for (const mm of genusMats) setMacroUniforms(mm, null);
    } else {
      disposeMacro();
      for (const mm of genusMats) setMacroUniforms(mm, null);
      clouds.localWeatherRepeat.copy(baseWeatherRepeat);
      for (const m of genusMats) { setGenusUniforms(m, []); setGenusSkeleton(m, [], false); setGenusPhysics(m, [], false); setGenusLightFloors(m, opt.debugLightFloors); setGenusDiffuse(m, opt.diffuse); setFlowUniforms(m, [], { density: false, uv: false }, GENUS_TILE_KM); setGenusFrame(m, null); }
    }
    weather = tex;
    clouds.localWeatherTexture = tex;
    genLayers = gl; genDate = p.date; genUv = flowUv;
    const exposure = p.exposure ?? autoExposure(sunAltDeg);
    applyHaze(p.haze);
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
  const setSceneAsync = async (p: VolumetricSceneInput, isFast = false): Promise<boolean> => {
    const my = ++sceneToken;
    const plan = weatherPlan(p, isFast);
    let tex = cacheGet(plan.key);
    if (!tex) {
      const t0 = Date.now();
      tex = plan.useGenus
        ? await makeGenusWeatherAsync(plan.gl, plan.S, GENUS_TILE_KM, 7, plan.plain, 16, () => my !== sceneToken || disposed, plan.flow)
        : makeWeather(plan.plain, opt);
      if (!tex) return false;
      if (my !== sceneToken || disposed) { tex.dispose(); return false; }
      weatherMs = Date.now() - t0;
      cachePut(plan.key, tex);
    }
    if (my !== sceneToken || disposed) return false;
    applyScene(p, plan, tex);
    return true;
  };
  let disposed = false;
  const setPreset = (p: VolumetricPreset) => setScene(presetToInput(p));
  const setView = (az: number, el: number, fov: number, altitudeM?: number) => {
    if (!lastInput) return;
    lastInput = { ...lastInput, az, el, fov, altitudeM: altitudeM !== undefined ? altitudeM : lastInput.altitudeM };
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
      // 구름 레이어의 그림자 플래그만 안전하게 갱신합니다.
      for (const layer of clouds.cloudLayers) {
        if (layer && (layer as any).shadow !== undefined) {
          (layer as any).shadow = lastShadow;
        }
      }
    }
    aerial.sunDirection.copy(sun);
    clouds.sunDirection.copy(sun);
    lastSunAltForLight = sunAltDeg;
    applySunLight();
    // §130 C3 층별 바람 드리프트 — 두 재질 모두(빠뜨리면 해 > 12° 의 층 그림자가 시간이 가며 구름에서 떨어집니다).
    if (genLayers) {
      const driftSec = driftSecOverride ?? date.getTime() / 1000;
      const macroSec = driftSec - (genDate ?? date).getTime() / 1000;
      for (const m of genusMats) { setGenusDrift(m, genLayers, driftSec, GENUS_TILE_KM); setMacroDrift(m, genLayers, macroSec); }
      // §156 거시 격자 시간 걸음(AR(1)) — 1 분마다 새 장을 B 에, 이전 B 를 A 로; 그 사이는 mix 로 섞습니다. 잡음 없는 모드(1)는 걸음이 없습니다.
      if (macro && opt.macro === 2) {
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
    }
    const exposure = lastInput.exposure ?? autoExposure(sunAltDeg);
    applyHaze(lastInput.haze);
    renderer.toneMappingExposure = exposure;
    last = { sunAltDeg, exposure };
  };

  return {
    debug: { clouds, toneMapping },
    spectral,
    weatherMs: () => weatherMs,
    flowInfo: () => {
      const st = (weather?.userData as { flow?: { s90?: number; hoursUsed?: number } } | undefined)?.flow;
      return { s90: st?.s90 ?? null, hoursUsed: st?.hoursUsed ?? null, camKm: lastCamKm };
    },
    physicsInfo: () => lastPhysics,
    camera,
    setPreset,
    setScene,
    setSceneAsync,
    cancelAsync: () => {
      sceneToken++;
    },
    setView,
    setDate,
    lastScene: () => last,
    // 품질 단계가 2차 행진 값을 덮어쓰므로 다시 겁니다.
    setQuality: q => {
      // §169 takram 품질 단계는 resolutionScale 까지 1 로 덮어씁니다. 하늘 화면은 해상도를 품질 다음에 다시 걸지 않아
      // (자동 조절기가 값이 그대로면 null) 기기가 설정 0.5 대신 1.0 으로 그렸습니다 — 하네스는 품질 뒤에 해상도를 걸어 0.5.
      const res = clouds.resolutionScale;
      clouds.qualityPreset = q;
      clouds.resolutionScale = res;
      // §140 low 프리셋의 1차 행진 최소 보폭 100 m 는 모양 잡음(수백 m 주기)을 성기게 떠서 텍셀마다 투과율이 3~4 텍셀 덩어리로 흔들립니다
      // (기기 캡처의 흰 점·알갱이; 하네스 low 렌더 알파 편차 0.0070 → 0.0044, medium 0.0045). 보폭만 medium 과 같은 50 m 로 — 반복 수 200·종료 투과율 0.1 은 그대로.
      if (q === 'low') clouds.clouds.minStepSize = LOW_MIN_STEP_M;
      baseMaxRay = clouds.clouds.maxRayDistance;
      applyMaxRay();
      baseAccurate = clouds.clouds.accurateSunSkyLight;
      applySunLight();
      baseMarch.n = clouds.clouds.maxIterationCountToSun;
      baseMarch.step = clouds.clouds.minSecondaryStepSize;
      baseMarch.scale = clouds.clouds.secondaryStepScale;
      applySunMarch();
    },
    setOptions: (o, reapply = true) => {
      Object.assign(opt, o);
      applySunMarch();
      updateLod();
      clouds.temporalUpscale = opt.temporalUpscale;
      clouds.shadow.temporalPass = opt.shadowTemporal;
      applySunLight();
      applyMaxRay();
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
    setSize: (w, h) => {
      camera.aspect = w / h; camera.updateProjectionMatrix();
      composer.setSize(w, h);
      viewH = h; updateLod();
    },
    dispose: () => {
      disposeMacro();
      disposed = true;
      composer.dispose();
      clouds.dispose();
      aerial.dispose();
      generator?.dispose();
      for (const t of weatherCache.values()) t.dispose();
      weatherCache.clear();
    },
  };
}
