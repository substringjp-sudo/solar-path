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
  UnsignedByteType,
  Vector3,
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
import { genusLayerShape, makeGenusWeather, patchGenusShader, setGenusFrame, setGenusUniforms, type GenusKey, type GenusLayer } from './cloudGenus';

export type VolumetricQuality = 'low' | 'medium' | 'high';

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
function makeWeather(cover: [number, number, number], o: VolumetricOptions): DataTexture {
  const N = 256;
  const noise = tileableFbm(N, 1.7, o.weatherPeriod);
  const order = Array.from(noise.keys()).sort((a, b) => noise[a] - noise[b]);
  const rank = new Float32Array(noise.length);
  order.forEach((idx, r) => { rank[idx] = r / (order.length - 1); });
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    for (let k = 0; k < 3; k++) {
      const c = cover[k];
      const v = c <= 0 ? 0 : 0.5 + (rank[i] - (1 - c)) * o.weatherRamp;
      data[i * 4 + k] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
    data[i * 4 + 3] = 0;
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
}
export const DEFAULT_VOLUMETRIC_OPTIONS: VolumetricOptions = { weatherPeriod: 16, weatherRamp: 2, shadowMinSunDeg: 12, bufferType: 'half', frame: 'local', shadowMaxFar: null, atmosphereShadow: true, temporalUpscale: true, shadowTemporal: true, sunMarch: [6, 250, 1.6], genus: false };

export interface VolumetricScene {
  camera: Camera;
  setPreset(p: VolumetricPreset): void;
  setQuality(q: VolumetricQuality): void;
  setResolutionScale(s: number): void;
  /** 손잡이를 바꾸고 지금 장면에 다시 겁니다. */
  setOptions(o: Partial<VolumetricOptions>): void;
  render(deltaSec: number): void;
  setSize(width: number, height: number): void;
  dispose(): void;
  /** 마지막 날씨 텍스처 생성 시간(ms). */
  weatherMs(): number;
  /** 진단용 — 하네스에서만 씁니다. */
  debug: { clouds: CloudsEffect };
}

/**
 * 장면을 만듭니다. 대기 표 생성이 끝날 때까지 기다립니다(실패하면 throw — float 렌더 타깃을 못 쓰는 기기).
 */
export async function createVolumetricScene(
  renderer: WebGLRenderer, width: number, height: number,
  options: Partial<VolumetricOptions> = {},
): Promise<VolumetricScene> {
  const opt: VolumetricOptions = { ...DEFAULT_VOLUMETRIC_OPTIONS, ...options };
  const baseMarch = { n: 0, step: 0, scale: 0 };
  const camera = new PerspectiveCamera(60, width / height, 1, 1e7);
  const scene = new Scene();

  const aerial = new AerialPerspectiveEffect(camera);
  aerial.sky = true;
  aerial.sunLight = false;
  aerial.skyLight = false;

  const clouds = new CloudsEffect(camera);
  clouds.qualityPreset = 'low';
  baseMarch.n = clouds.clouds.maxIterationCountToSun;
  baseMarch.step = clouds.clouds.minSecondaryStepSize;
  baseMarch.scale = clouds.clouds.secondaryStepScale;
  // (아래 applySunMarch 가 품질 단계 뒤에 2차 행진 값을 다시 겁니다.)
  if (opt.shadowMaxFar != null) clouds.shadow.maxFar = opt.shadowMaxFar;
  clouds.temporalUpscale = opt.temporalUpscale;
  clouds.shadow.temporalPass = opt.shadowTemporal;
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
  }
  // §124 종류별 모형 패치 — 늘 걸어 두고 층별 genusOn 으로 켭니다(끄면 takram 그대로).
  patchGenusShader(clouds.cloudsPass.currentMaterial as never);
  patchGenusShader(clouds.shadowPass.currentMaterial as never);
  const genusMats = [clouds.cloudsPass.currentMaterial, clouds.shadowPass.currentMaterial] as never[];
  const baseWeatherRepeat = clouds.localWeatherRepeat.clone();
  clouds.shapeTexture = new CloudShape();
  clouds.shapeDetailTexture = new CloudShapeDetail();
  clouds.turbulenceTexture = new Turbulence();
  clouds.stbnTexture = makeWhiteNoise3D();

  const generator = new PrecomputedTexturesGenerator(renderer);
  await generator.update();
  Object.assign(aerial, generator.textures);
  Object.assign(clouds, generator.textures);

  // 표시 곡선(§125): 사진 밝기비 자에서 AgX 1/4 · ACES 2/4 · Neutral 2/4, 노을 '가장 붉은 곳의 색'에서
  // AgX 3/4 · ACES 3/4 · Neutral 1/4 → ACES. AgX 는 햇빛 받은 구름을 하늘의 4.2배 → 2.4배로 눌렀습니다.
  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const composer = new EffectComposer(renderer, { frameBufferType: opt.bufferType === 'float' ? FloatType : HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera, clouds, aerial));
  composer.addPass(new EffectPass(camera, toneMapping));
  composer.setSize(width, height);

  let weather: DataTexture | null = null;
  /** 마지막 날씨 생성 시간(ms) — 시험 화면 표시용. */
  let weatherMs = 0;
  const sun = new Vector3();

  let lastPreset: VolumetricPreset | null = null;
  const setPreset = (p: VolumetricPreset) => {
    lastPreset = p;
    const position = new Geodetic(radians(p.lon), radians(p.lat), p.heightM).toECEF();
    const nue = Ellipsoid.WGS84.getNorthUpEastFrame(position, new Matrix4());
    const az = radians(p.az), el = radians(p.el);
    camera.fov = p.fov;
    let worldToECEF: Matrix4;
    if (opt.frame === 'ecef') {
      // takram 기본: 장면 좌표 = ECEF. 카메라를 관측점에 두고, 위쪽을 그 자리의 연직으로.
      worldToECEF = new Matrix4();
      const north = new Vector3(), up = new Vector3(), east = new Vector3();
      nue.extractBasis(north, up, east);
      const dir = north.clone().multiplyScalar(Math.cos(el) * Math.cos(az))
        .addScaledVector(up, Math.sin(el)).addScaledVector(east, Math.cos(el) * Math.sin(az));
      camera.position.copy(position).addScaledVector(up, 2);
      camera.up.copy(up);
      camera.lookAt(camera.position.clone().add(dir));
    } else {
      // 장면 좌표는 북·위·동(NUE).
      worldToECEF = nue;
      camera.position.set(0, 2, 0);
      camera.up.set(0, 1, 0);
      camera.lookAt(Math.cos(el) * Math.cos(az), 2 + Math.sin(el), Math.cos(el) * Math.sin(az));
    }
    aerial.worldToECEFMatrix.copy(worldToECEF);
    clouds.worldToECEFMatrix.copy(worldToECEF);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    getSunDirectionECEF(new Date(p.iso), sun);
    aerial.sunDirection.copy(sun);
    clouds.sunDirection.copy(sun);
    // 해가 지평선 근처면 층 그림자 지도(BSM)가 NaN 을 내 화면이 통째로 검어집니다(웹 시제품에서 해 1.1° 에서 확인).
    // 구름 자신의 그늘은 해 쪽 2차 행진이 따로 셉니다.
    const local = sun.clone().transformDirection(nue.clone().invert());
    const sunAltDeg = (Math.asin(Math.max(-1, Math.min(1, local.y))) * 180) / Math.PI;
    const shadow = sunAltDeg > opt.shadowMinSunDeg;

    clouds.cloudLayers.length = 0;
    weather?.dispose();
    const t0 = Date.now();
    const gl: (GenusLayer | null)[] = p.genus.map((g, i) => (g && p.cover[i] > 0 ? { genus: g, cover: p.cover[i] } : null));
    if (opt.genus && gl.some(Boolean)) {
      // §124: 층마다 종류별 무늬·단면. 종류가 없는 층은 비웁니다.
      const shape = (i: number, d: { height: number; densityScale?: number; shapeAmount?: number; shapeDetailAmount?: number }) =>
        (gl[i] ? genusLayerShape(gl[i] as GenusLayer) : d);
      clouds.cloudLayers.push(
        new CloudLayer({ channel: 'r', altitude: p.altKm[0] * 1000, ...shape(0, { height: 1200 }), coverageFilterWidth: CFW, shadow }),
        new CloudLayer({ channel: 'g', altitude: p.altKm[1] * 1000, ...shape(1, { height: 900 }), coverageFilterWidth: CFW, shadow }),
        new CloudLayer({ channel: 'b', altitude: p.altKm[2] * 1000, ...shape(2, { height: 400, densityScale: 0.003, shapeAmount: 0.4, shapeDetailAmount: 0 }),
          coverageFilterWidth: CFW, shadow: gl[2] ? shadow : undefined }),
        new CloudLayer({ channel: 'a', altitude: 0, height: 0, densityScale: 0 }),
      );
      weather = makeGenusWeather(gl, 512, GENUS_TILE_KM);
      const north = new Vector3(), up = new Vector3(), east = new Vector3();
      nue.extractBasis(north, up, east);
      clouds.localWeatherRepeat.setScalar(1);
      for (const m of genusMats) {
        setGenusUniforms(m, gl);
        setGenusFrame(m, { origin: position, east, north, tileM: GENUS_TILE_KM * 1000 });
      }
    } else {
      clouds.cloudLayers.push(
        new CloudLayer({ channel: 'r', altitude: p.altKm[0] * 1000, height: 1200, coverageFilterWidth: CFW, shadow }),
        new CloudLayer({ channel: 'g', altitude: p.altKm[1] * 1000, height: 900, coverageFilterWidth: CFW, shadow }),
        new CloudLayer({ channel: 'b', altitude: p.altKm[2] * 1000, height: 400, densityScale: 0.003, shapeAmount: 0.4,
          shapeDetailAmount: 0, coverageFilterWidth: CFW }),
        // 셰이더가 늘 4층을 받습니다 — 빈 층.
        new CloudLayer({ channel: 'a', altitude: 0, height: 0, densityScale: 0 }),
      );
      weather = makeWeather(p.cover, opt);
      clouds.localWeatherRepeat.copy(baseWeatherRepeat);
      for (const m of genusMats) { setGenusUniforms(m, []); setGenusFrame(m, null); }
    }
    weatherMs = Date.now() - t0;
    clouds.localWeatherTexture = weather;
    renderer.toneMappingExposure = p.exposure;
  };

  return {
    debug: { clouds },
    weatherMs: () => weatherMs,
    camera,
    setPreset,
    // 품질 단계가 2차 행진 값을 덮어쓰므로 다시 겁니다.
    setQuality: q => {
      clouds.qualityPreset = q;
      baseMarch.n = clouds.clouds.maxIterationCountToSun;
      baseMarch.step = clouds.clouds.minSecondaryStepSize;
      baseMarch.scale = clouds.clouds.secondaryStepScale;
      applySunMarch();
    },
    setOptions: o => {
      Object.assign(opt, o);
      applySunMarch();
      if (lastPreset) setPreset(lastPreset);
    },
    setResolutionScale: s => { clouds.resolutionScale = s; },
    render: dt => composer.render(dt),
    setSize: (w, h) => {
      camera.aspect = w / h; camera.updateProjectionMatrix();
      composer.setSize(w, h);
    },
    dispose: () => {
      composer.dispose();
      clouds.dispose();
      aerial.dispose();
      generator.dispose();
      weather?.dispose();
    },
  };
}
