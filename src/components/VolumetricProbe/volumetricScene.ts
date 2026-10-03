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
}

/** 사용자 QR 기록에서 가져온 세 장면. */
export const VOLUMETRIC_PRESETS: VolumetricPreset[] = [
  { key: 'kz1029', label: '가나자와 10:29', lat: 36.5679, lon: 136.6774, heightM: 103, iso: '2026-10-03T01:29:00Z',
    az: 161.6, el: 13.9, fov: 60, cover: [0.3, 0, 0], altKm: [1.5, 4.5, 10], exposure: 10 },
  { key: 'fk1728', label: '후쿠이 17:28', lat: 36.0209, lon: 136.2894, heightM: 23, iso: '2026-10-02T08:28:00Z',
    az: 265, el: 12, fov: 60, cover: [0, 0.6, 0], altKm: [1.5, 7.0, 10], exposure: 30 },
  { key: 'fk1747', label: '후쿠이 17:47 잔광', lat: 36.0209, lon: 136.2894, heightM: 23, iso: '2026-10-02T08:47:00Z',
    az: 255, el: 20, fov: 60, cover: [0, 0.6, 0], altKm: [1.5, 7.0, 10], exposure: 100 },
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
function tileableFbm(size: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  const hash = (x: number, y: number, p: number) => {
    const s = Math.sin((((x % p) + p) % p) * 127.1 + (((y % p) + p) % p) * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  let amp = 0.5, total = 0;
  for (let o = 0, period = 16; o < 4; o++, period *= 2, amp *= 0.5) {
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
function makeWeather(cover: [number, number, number]): DataTexture {
  const N = 256;
  const noise = tileableFbm(N, 1.7);
  const order = Array.from(noise.keys()).sort((a, b) => noise[a] - noise[b]);
  const rank = new Float32Array(noise.length);
  order.forEach((idx, r) => { rank[idx] = r / (order.length - 1); });
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    for (let k = 0; k < 3; k++) {
      const c = cover[k];
      const v = c <= 0 ? 0 : 0.5 + (rank[i] - (1 - c)) * 2;
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

export interface VolumetricScene {
  camera: Camera;
  setPreset(p: VolumetricPreset): void;
  setQuality(q: VolumetricQuality): void;
  setResolutionScale(s: number): void;
  render(deltaSec: number): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

/**
 * 장면을 만듭니다. 대기 표 생성이 끝날 때까지 기다립니다(실패하면 throw — float 렌더 타깃을 못 쓰는 기기).
 */
export async function createVolumetricScene(renderer: WebGLRenderer, width: number, height: number): Promise<VolumetricScene> {
  const camera = new PerspectiveCamera(60, width / height, 1, 1e7);
  const scene = new Scene();

  const aerial = new AerialPerspectiveEffect(camera);
  aerial.sky = true;
  aerial.sunLight = false;
  aerial.skyLight = false;

  const clouds = new CloudsEffect(camera);
  clouds.qualityPreset = 'low';
  // 셰이더: 밀도 = remap(mix(날씨, 1, w), 1 − coverage·h, … + w). 층 가운데에서 날씨 0.5 가 문턱 →
  // coverage = 0.5·(1 − w).
  const CFW = 0.6;
  clouds.coverage = 0.5 * (1 - CFW);
  clouds.events.addEventListener('change', () => {
    aerial.overlay = clouds.atmosphereOverlay;
    aerial.shadow = clouds.atmosphereShadow;
    aerial.shadowLength = clouds.atmosphereShadowLength;
  });
  clouds.shapeTexture = new CloudShape();
  clouds.shapeDetailTexture = new CloudShapeDetail();
  clouds.turbulenceTexture = new Turbulence();
  clouds.stbnTexture = makeWhiteNoise3D();

  const generator = new PrecomputedTexturesGenerator(renderer);
  await generator.update();
  Object.assign(aerial, generator.textures);
  Object.assign(clouds, generator.textures);

  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera, clouds, aerial));
  composer.addPass(new EffectPass(camera, toneMapping));
  composer.setSize(width, height);

  let weather: DataTexture | null = null;
  const sun = new Vector3();

  const setPreset = (p: VolumetricPreset) => {
    const position = new Geodetic(radians(p.lon), radians(p.lat), p.heightM).toECEF();
    const worldToECEF = Ellipsoid.WGS84.getNorthUpEastFrame(position, new Matrix4());
    aerial.worldToECEFMatrix.copy(worldToECEF);
    clouds.worldToECEFMatrix.copy(worldToECEF);

    camera.fov = p.fov;
    camera.position.set(0, 2, 0);
    const az = radians(p.az), el = radians(p.el);
    // 장면 좌표는 북·위·동(NUE).
    camera.lookAt(Math.cos(el) * Math.cos(az), 2 + Math.sin(el), Math.cos(el) * Math.sin(az));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    getSunDirectionECEF(new Date(p.iso), sun);
    aerial.sunDirection.copy(sun);
    clouds.sunDirection.copy(sun);
    // 해가 지평선 근처면 층 그림자 지도(BSM)가 NaN 을 내 화면이 통째로 검어집니다(웹 시제품에서 해 1.1° 에서 확인).
    // 구름 자신의 그늘은 해 쪽 2차 행진이 따로 셉니다.
    const local = sun.clone().transformDirection(worldToECEF.clone().invert());
    const sunAltDeg = (Math.asin(Math.max(-1, Math.min(1, local.y))) * 180) / Math.PI;
    const shadow = sunAltDeg > 3;

    clouds.cloudLayers.length = 0;
    clouds.cloudLayers.push(
      new CloudLayer({ channel: 'r', altitude: p.altKm[0] * 1000, height: 1200, coverageFilterWidth: CFW, shadow }),
      new CloudLayer({ channel: 'g', altitude: p.altKm[1] * 1000, height: 900, coverageFilterWidth: CFW, shadow }),
      new CloudLayer({ channel: 'b', altitude: p.altKm[2] * 1000, height: 400, densityScale: 0.003, shapeAmount: 0.4,
        shapeDetailAmount: 0, coverageFilterWidth: CFW }),
      // 셰이더가 늘 4층을 받습니다 — 빈 층.
      new CloudLayer({ channel: 'a', altitude: 0, height: 0, densityScale: 0 }),
    );
    weather?.dispose();
    weather = makeWeather(p.cover);
    clouds.localWeatherTexture = weather;
    renderer.toneMappingExposure = p.exposure;
  };

  return {
    camera,
    setPreset,
    setQuality: q => { clouds.qualityPreset = q; },
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
