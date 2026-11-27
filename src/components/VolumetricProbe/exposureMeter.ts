/**
 * 화면 전체 휘도 측광(시뮬레이션 모드 자동 노출).
 *
 * 해 고도만으로 정한 노출 표(`autoExposure`)는 맑은 하늘을 위로 20° 보는 사진으로 맞춘 값이라, 땅을 내려다보는 시선처럼
 * 하늘보다 어두운 화면에서는 해가 지평선에 닿을수록 화면이 도리어 밝아졌다(2026-11-27 맥북 실측: 해 4° → 0° 에서 평균 0.04 → 0.16).
 * 카메라처럼 **지금 그린 화면의 평균 휘도(평균)** 를 재서 표 노출을 보정한다.
 *
 *  - 그린 결과 텍스처(톤맵 뒤 · 선형)를 16×16 으로 줄이며 칸마다 8×8 점의 선형 휘도(1 로 묶음)를 평균해 sqrt 로 부호화 → 8 비트 값 → 다음 프레임에 읽기.
 *  - 평균 휘도 m 이 목표 범위 [LO, HI] 밖이면 가장자리 T 로 노출 보정 g = (T/m)^STRENGTH 를 [GAIN_MIN, GAIN_MAX] 로 묶는다(표가 기준, 측광은 ±2 EV 안 보정).
 *  - 읽을 때마다 보정을 시정수 TAU_SEC 로 부드럽게 따라가게 한다(카메라 순응).
 */
import {
  ClampToEdgeWrapping, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial,
  UnsignedByteType, WebGLRenderTarget,
  type Texture, type WebGLRenderer,
} from 'three';

export const METER_N = 16;
export const METER_TAPS = 8;
/**
 * 목표 평균 휘도 범위(선형, 0..1). 범위 안이면 표 노출 그대로, 밖이면 범위 가장자리로 끌어옴.
 * 맥북 실측(table 노출, 선형 평균): 한낮 맑은 하늘 시선 0.29 · 해 20° 쯤 0.13 · 해 4° 0.10 · 땅 내려다보기 해 4° 0.04 → 지평선 0.16 → 해 −3° 0.01.
 * 아래쪽(0.1)은 오후 땅 시선이 어두워지다 해 지평선에서 갑자기 튀는 걸 막고, 위쪽(0.25)은 한낮을 건드리지 않으려 높게 둠.
 */
export const METER_LUM_LO = 0.1;
export const METER_LUM_HI = 0.25;
/** 읽은 값이 없을 때의 기본값(범위 중간 근처). */
export const METER_TARGET_LUM = 0.15;
/** 보정 세기(0 = 표 그대로, 1 = 목표에 완전히 맞춤). */
export const METER_STRENGTH = 0.8;
export const METER_GAIN_MIN = 0.25;
export const METER_GAIN_MAX = 4;
/** 순응 시정수(초). */
export const METER_TAU_SEC = 0.9;


/** 순수 함수 — 칸마다 sqrt(평균 선형 휘도) 로 부호화된 8 비트 값 → 화면 평균 선형 휘도(0..1). */
export function meterLumOf(codes: ArrayLike<number>, stride = 4): number {
  let s = 0, n = 0;
  for (let i = 0; i < codes.length; i += stride) { const v = codes[i] / 255; s += v * v; n++; }   // 칸 값은 sqrt(평균 휘도)
  return n === 0 ? METER_TARGET_LUM : s / n;
}

/** 순수 함수 — 측정 휘도 → 목표 보정 배율(제한 포함). */
export function meterTargetGain(lum: number, lo = METER_LUM_LO, hi = METER_LUM_HI, strength = METER_STRENGTH): number {
  const want = Math.max(lo, Math.min(hi, lum));
  const g = Math.pow(want / Math.max(1e-5, lum), strength);
  return Math.max(METER_GAIN_MIN, Math.min(METER_GAIN_MAX, g));
}

/** 순수 함수 — 로그 영역에서 시정수로 따라가기(배율이라 로그가 자연스러움). */
export function meterSmooth(cur: number, tgt: number, dtSec: number, tau = METER_TAU_SEC): number {
  const a = 1 - Math.exp(-Math.max(0, dtSec) / Math.max(1e-3, tau));
  return Math.exp(Math.log(cur) + (Math.log(tgt) - Math.log(cur)) * a);
}

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FRAG = [
  'precision highp float;',
  'varying vec2 vUv;',
  'uniform sampler2D tSrc;',
  `const float N = ${METER_N}.0;`,
  `const float TAPS = ${METER_TAPS}.0;`,
  'void main(){',
  '  vec2 cell = floor(vUv * N);',
  '  float acc = 0.0;',
  `  for (int j = 0; j < ${METER_TAPS}; j++) {`,
  `    for (int i = 0; i < ${METER_TAPS}; i++) {`,
  '      vec2 uv = (cell + (vec2(float(i), float(j)) + 0.5) / TAPS) / N;',
  '      vec3 c = max(texture2D(tSrc, uv).rgb, vec3(0.0));',
  // 하늘 합성 텍스처는 톤맵까지 끝난 선형 값(부호화는 합성기가 마지막에). 해 원반 같은 아주 밝은 점이 평균을 끌지 않게 1 로 묶음.
  '      vec3 lin = c;',
  '      acc += clamp(dot(lin, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);',
  '    }',
  '  }',
  '  float v = sqrt(acc / (TAPS * TAPS));',
  '  gl_FragColor = vec4(v, v, v, 1.0);',
  '}',
].join('\n');

export interface ExposureMeter {
  /** 지난 프레임에 그린 줄이기 결과를 읽고, 매 `every` 프레임마다 새로 그림. 결과는 `lastLum()`. */
  measure(renderer: WebGLRenderer, src: Texture): void;
  /** 가장 최근 읽은 화면 평균 휘도(선형). 아직 없으면 null. */
  lastLum(): number | null;
  /** 읽기가 새로 들어왔는지(호출하면 표시를 지움). */
  takeFresh(): boolean;
  reset(): void;
  dispose(): void;
}

export function createExposureMeter(every = 8): ExposureMeter {
  const rt = new WebGLRenderTarget(METER_N, METER_N, {
    type: UnsignedByteType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter,
    depthBuffer: false, stencilBuffer: false, wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping,
  });
  const mat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { tSrc: { value: null } }, depthTest: false, depthWrite: false });
  const quad = new Mesh(new PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new Scene(); scene.add(quad);
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const buf = new Uint8Array(METER_N * METER_N * 4);
  let frame = 0, drawn = false, lum: number | null = null, fresh = false;
  return {
    measure(renderer, src) {
      // 지난 프레임에 그려 둔 16×16 을 이번 프레임 처음에 읽습니다(동기 읽기이지만 GPU 가 이미 끝낸 뒤라 멈춤이 거의 없음).
      // 비동기 읽기(readRenderTargetPixelsAsync)는 맥북 Chrome(ANGLE Metal)에서 0 만 돌려줘 쓰지 않습니다.
      if (drawn) {
        renderer.readRenderTargetPixels(rt, 0, 0, METER_N, METER_N, buf);
        drawn = false;
        lum = meterLumOf(buf); fresh = true;
      }
      if ((frame++ % every) !== 0) return;
      const prevT = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
      mat.uniforms.tSrc.value = src;
      renderer.setRenderTarget(rt); renderer.autoClear = false;
      renderer.render(scene, cam);
      renderer.setRenderTarget(prevT); renderer.autoClear = prevAuto;
      drawn = true;
    },
    lastLum: () => lum,
    takeFresh: () => { const f = fresh; fresh = false; return f; },
    reset() { lum = null; fresh = false; drawn = false; },
    dispose() { rt.dispose(); mat.dispose(); (quad.geometry as PlaneGeometry).dispose(); },
  };
}
