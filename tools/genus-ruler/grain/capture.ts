/**
 * RULER-grain 하네스 캡처(§10 동결 대상) — entry.ts 의 잡에 `grain` 필드가 **있을 때만** 쓰입니다. 없으면 entry.ts 는 예전 길 그대로
 * (이 모듈의 restore/applyNoiseSeed 는 앞 잡이 grain 잡이 아니면 아무것도 하지 않음 → 옛 잡 화소 동일; RULER-grain G0d·§8.1).
 *
 * 모드
 *  - capture   : frame0 리셋 → 데움 warm + 창 window 프레임. 창 프레임마다
 *                (a) 1/4 해상도 구름 패스 출력(cloudsPass.currentRenderTarget, 반정밀도, 해석 전)을 Bayer 위치로 구름 버퍼 격자에 흩어
 *                    텍셀마다 표본 4 개의 휘도·알파 평균·표준편차(σs 의 입력) — 톤·노출·업스케일 클리핑·잡음 제거 앞의 장면 선형 값.
 *                (b) 합성기 출력(톤 뒤 표시 선형, 반정밀도)과 그것을 SceneComposer `skyDenoise` 같은 글자로 거른 값(float)을 읽어
 *                    화소마다 ln(Ld + 0.01) 평균·분산, 앞·뒤 반 창 평균 Ld, 포화 횟수, 원 알파 평균, 원 RGBA 평균(PNG).
 *                (c) 창 안 정지 화면(stills) 의 잡음 제거 휘도 Ld(f16) 와, pngStills 는 8비트 PNG(원 경로 — 옛 자와 같은 관행) + captureOk 대조.
 *  - reference : temporalUpscale 끔 + resolve temporalAlpha 1(잡 JSON 이 걸어야 함 — 아니면 throw). n 프레임(ss×ss 층화 화소 오프셋,
 *                camera.setViewOffset, 구름 텍셀 ±0.5) 원 출력 평균을 앞·뒤 반으로 따로 누적 → 평균·반쪽 각각 skyDenoise.
 *                capFrames > 0 이면 끝에 비용 변형으로 그 프레임 수만큼 그려 반복 상한 텍셀 표지(capMask).
 *  - cost      : 비용 변형(DEBUG_SHOW_SAMPLE_COUNT + 전역 셈, 아래 COST_PATCH)으로 frames 프레임 → 텍셀마다 1차 날씨 x · 모양 fetch y ·
 *                2차(해·땅 행진) 걸음 z · 반복 상한 표지 cap.
 *  - state     : 그리지 않고 상태 해시만.
 * 파일은 run-grain.js 가 노출한 window.__grainWrite(잡, 파일, base64, append) 로 씁니다. 배열은 위가 0 인 행 순서(PNG 와 같음).
 */
import {
  DataTexture, FloatType, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, WebGLRenderTarget,
  type PerspectiveCamera, type Texture, type WebGLRenderer,
} from 'three';
import { DEFAULT_VOLUMETRIC_OPTIONS, type VolumetricOptions } from '../../../src/components/VolumetricProbe/volumetricScene';
import * as C from './capture-core';

export type GrainJob = {
  mode: 'capture' | 'reference' | 'cost' | 'state';
  /** CloudsEffect.frame 를 이 값으로 리셋(update 가 먼저 ++ 하므로 첫 렌더 프레임 = frame0 + 1). 기본 0. */
  frame0?: number;
  /** 백색 잡음 3D 텍스처 LCG 씨앗(기본 12345 = 앱). 다른 잡음 실현(A/A). */
  noiseSeed?: number;
  warm?: number; window?: number; stills?: number[];
  /** full = F-dev·H-dev(정지 화면 Ld·창 평균 Ld 저장) · lite = F-std */
  store?: 'full' | 'lite';
  pngStills?: number[];
  /** 위에서부터 캔버스 높이 비율 [y0, y1) 만 누적·저장(H-dev). */
  crop?: [number, number];
  n?: number; ss?: number; capFrames?: number;
  frames?: number;
};

type Vol = {
  debug: { clouds: unknown };
  camera: unknown;
  renderToTexture(dt: number): Texture;
  resolutionScale(): number;
  lastScene(): { sunAltDeg: number; exposure: number } | null;
};
type Ctx = { renderer: WebGLRenderer; vol: Vol; W: number; H: number; show: (tex: Texture, mode: number) => string };
type AnyRec = Record<string, unknown>;

/** SceneComposer.ts CATMULL_GLSL · DENOISE_GLSL 의 **글자 그대로** 사본(capture-test.mjs 가 원문과 대조). 앱 파일은 고치지 않습니다. */
export const CATMULL_GLSL_COPY = `
uniform float uCatmull;   // 0 이면 이중선형 — 하네스가 기준선을 재는 스위치
vec4 catmullRom(sampler2D tex, vec2 uv, vec2 texSize){
  if (uCatmull < 0.5) return max(vec4(0.0), texture2D(tex, uv));
  vec2 samplePos = uv * texSize;
  vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
  vec2 f = samplePos - texPos1;

  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);

  vec2 w12 = w1 + w2;
  vec2 off12 = w2 / w12;

  vec2 p0  = (texPos1 - 1.0) / texSize;
  vec2 p3  = (texPos1 + 2.0) / texSize;
  vec2 p12 = (texPos1 + off12) / texSize;

  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  float wa = w12.x * w0.y;  acc += texture2D(tex, vec2(p12.x, p0.y))  * wa; wsum += wa;
  float wb = w0.x  * w12.y; acc += texture2D(tex, vec2(p0.x,  p12.y)) * wb; wsum += wb;
  float wc = w12.x * w12.y; acc += texture2D(tex, vec2(p12.x, p12.y)) * wc; wsum += wc;
  float wd = w3.x  * w12.y; acc += texture2D(tex, vec2(p3.x,  p12.y)) * wd; wsum += wd;
  float we = w12.x * w3.y;  acc += texture2D(tex, vec2(p12.x, p3.y))  * we; wsum += we;

  return max(vec4(0.0), acc / max(1e-4, wsum));
}
`;
export const DENOISE_GLSL_COPY = `
uniform float uDenoise;
vec4 skyDenoise(sampler2D tex, vec2 uv, vec2 texSize){
  if (uDenoise < 0.5) return catmullRom(tex, uv, texSize);
  vec2 p = uv * texSize - 0.5;
  vec2 i0 = floor(p + 0.5);                 // 가장 가까운 텍셀
  vec4 c0 = texture2D(tex, (i0 + 0.5) / texSize);
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 ij = i0 + vec2(float(i), float(j));
    vec4 s = texture2D(tex, (ij + 0.5) / texSize);
    vec2 d = ij - p;                           // 표본 위치까지의 거리(텍셀)
    float da = s.a - c0.a, dc = length(s.rgb - c0.rgb);
    float w = exp(-dot(d, d) * 0.7) * exp(-da * da * 22.0) * exp(-dc * dc * 35.0);
    acc += s * w; wsum += w;
  }
  return max(vec4(0.0), acc / max(1e-4, wsum));
}
`;

/**
 * 비용 변형(RULER-grain §2.4) — 하네스만, cost·reference(capFrames) 잡에서만. 앵커는 살아 있는 구름 패스 글자에서 **정확히 한 번** 나와야 하고
 * 아니면 throw(조용히 엉뚱한 셈이 되지 않게). 다음 잡 시작(restore)에서 글자·define 을 되돌립니다(setScene 의 refreshVariant 도 base 로 되돌림).
 * 출력: R = 1차 날씨 표본 x(takram sampleCount.x), G = 모양 fetch 전부(1차 + 2차, 두 sampleMedia 오버로드 모두), B = 2차 행진 걸음
 * (marchOpticalDepth — 해·땅; 걸음마다 날씨 1 + 모양 1), A = 1차 행진이 반복 상한에서 끝남(T > minTransmittance, 광선 안) 0/1.
 */
export const COST_PATCH: [string, string][] = [
  ['MediaSample sampleMedia(', 'int gCostShape = 0;\nint gCostSun = 0;\nint gCostIter = 0;\nfloat gCostCap = 0.0;\nMediaSample sampleMedia('],
  ['float shape = texture(shapeTexture, shapePosition).r;', 'float shape = texture(shapeTexture, shapePosition).r;\n  ++gCostShape;'],
  ['    MediaSample media = sampleMedia(weather, position, uv, mipLevel, jitter);\n    opticalDepth += media.extinction * stepSize;',
    '    ++gCostSun;\n    MediaSample media = sampleMedia(weather, position, uv, mipLevel, jitter);\n    opticalDepth += media.extinction * stepSize;'],
  ['  for (int i = 0; i < maxIterationCount; ++i) {\n    if (rayDistance > maxRayDistance) {\n      break; // Termination\n    }\n',
    '  for (int i = 0; i < maxIterationCount; ++i) {\n    if (rayDistance > maxRayDistance) {\n      break; // Termination\n    }\n    gCostIter = i + 1;\n'],
  ['  frontDepth = transmittanceSum > 0.0 ? weightedDistanceSum / transmittanceSum : -1.0;',
    '  gCostCap = (gCostIter == maxIterationCount && transmittanceIntegral > minTransmittance && rayDistance <= maxRayDistance) ? 1.0 : 0.0;\n  frontDepth = transmittanceSum > 0.0 ? weightedDistanceSum / transmittanceSum : -1.0;'],
  ['outputColor = vec4(vec3(sampleCount) / vec3(500.0, 5.0, 5.0), 1.0);', 'outputColor = vec4(float(sampleCount.x), float(gCostShape), float(gCostSun), gCostCap);'],
];
export function applyCostPatch(text: string): string {
  let t = text;
  for (const [a, b] of COST_PATCH) {
    const n = t.split(a).length - 1;
    if (n !== 1) throw new Error('grain cost patch: anchor count ' + n + ' for: ' + a.slice(0, 60));
    t = t.replace(a, () => b);
  }
  return t;
}

/** takram 이 cloudLayers 에서 매 프레임 다시 채우는 층 균일변수 — grain 잡의 material 덮어쓰기로는 걸리지 않으므로 금지(RULER-grain §1.5 절차 M7). */
export const REPACKED_LAYER_UNIFORMS = ['minLayerHeights', 'maxLayerHeights', 'minIntervalHeights', 'maxIntervalHeights', 'densityScales', 'shapeAmounts',
  'shapeDetailAmounts', 'weatherExponents', 'shapeAlteringBiases', 'coverageFilterWidths', 'densityProfile'];
export function checkGrainMaterial(material: AnyRec | undefined): void {
  for (const k of Object.keys(material ?? {})) if (REPACKED_LAYER_UNIFORMS.includes(k)) throw new Error('grain job: material.' + k + ' is repacked from cloudLayers every frame (void arm)');
}

/** grain 잡의 옵션 기본값: 앱 기본값 전부(DEFAULT_VOLUMETRIC_OPTIONS — 새 손잡이도 기본 0 으로 자동 포함) 위에 하네스 기본(JOB_BASE_OPTIONS) — 앞 잡 옵션이 새지 않음(절차 B2). */
export function grainBaseOptions(jobBase: Partial<VolumetricOptions>, celestial: boolean): Partial<VolumetricOptions> {
  const o = { ...DEFAULT_VOLUMETRIC_OPTIONS, ...jobBase, celestial } as Partial<VolumetricOptions> & AnyRec;
  for (const k of Object.keys(DEFAULT_VOLUMETRIC_OPTIONS)) if (!(k in o)) throw new Error('grain base options missing ' + k);
  return o;
}

let curSeed = 12345;
/** 잡마다 부름(grain 이 아니어도): 원하는 씨앗(없으면 12345)이 지금 텍스처와 다를 때만 다시 채움 — grain 잡이 없는 페이지에서는 아무것도 안 함. */
export function applyNoiseSeed(vol: Vol, seed: number | undefined): void {
  const want = seed ?? 12345;
  if (want === curSeed) return;
  const tex = (vol.debug.clouds as { stbnTexture: { image: { data: Uint8Array }; needsUpdate: boolean } }).stbnTexture;
  C.fillWhiteNoise(tex.image.data, want);
  tex.needsUpdate = true;
  curSeed = want;
}

let costRestore: { mat: { fragmentShader: string; defines: AnyRec; needsUpdate: boolean }; text: string; patched: string; hadDefine: boolean } | null = null;
let viewOffsetSet = false;
/** 잡 시작마다 부름: 앞 grain 잡이 남긴 비용 변형·화소 오프셋을 되돌림(없으면 아무것도 안 함). */
export function restoreGrainState(vol: Vol): void {
  if (costRestore) {
    const r = costRestore; costRestore = null;
    if (r.mat.fragmentShader === r.patched) r.mat.fragmentShader = r.text;
    if (!r.hadDefine) delete r.mat.defines.DEBUG_SHOW_SAMPLE_COUNT;
    r.mat.needsUpdate = true;
  }
  if (viewOffsetSet) { (vol.camera as PerspectiveCamera).clearViewOffset(); viewOffsetSet = false; }
}

// ───────── 상태 해시(G0e·G0f; state-hash.js 보다 넓음: define·해석 재질·해상도·업스케일·그림자 크기·프레임·잡음 텍스처) ─────────
function flat(v: unknown): string {
  if (v == null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return String(v);
  if (Array.isArray(v)) return '[' + v.map(flat).join(',') + ']';
  const o = v as AnyRec & { toArray?: () => number[]; elements?: number[]; isTexture?: boolean; image?: { data?: ArrayLike<number>; width?: number; height?: number; depth?: number } };
  if (typeof o.toArray === 'function') return 'T' + JSON.stringify(o.toArray());
  if (o.elements) return 'M' + JSON.stringify(Array.from(o.elements));
  if (o.isTexture) {
    const d = o.image && o.image.data;
    if (d && d.length) { let h = 2166136261; for (let i = 0; i < d.length; i++) { h ^= d[i] & 0xff; h = Math.imul(h, 16777619) >>> 0; } return 'tex' + d.length + ':' + h; }
    return 'tex-gpu';
  }
  return 'obj:' + Object.keys(o).length;
}
export function stateHash(vol: Vol): AnyRec {
  const c = vol.debug.clouds as AnyRec & { cloudsPass: AnyRec; shadowPass: AnyRec; cloudLayers: AnyRec[]; shadow: AnyRec };
  const out: AnyRec = {};
  const mats: [string, AnyRec][] = [['clouds', c.cloudsPass.currentMaterial as AnyRec], ['shadow', (c.shadowPass as AnyRec).currentMaterial as AnyRec],
    ['resolve', c.cloudsPass.resolveMaterial as AnyRec], ['shadowResolve', ((c.shadowPass as AnyRec).resolveMaterial ?? null) as AnyRec]];
  for (const [tag, m] of mats) {
    if (!m) continue;
    const fs = String(m.fragmentShader ?? '');
    out[tag + '.shader'] = C.fnv(fs) + ':' + fs.length;
    out[tag + '.defines'] = C.fnv(JSON.stringify(Object.entries((m.defines ?? {}) as AnyRec).sort())) ;
    const u = (m.uniforms ?? {}) as Record<string, { value: unknown }>;
    let h = 2166136261; const per: AnyRec = {};
    for (const k of Object.keys(u).sort()) { const s = k + '=' + flat(u[k].value); per[k] = C.fnv(s); h = C.fnv(s, h); }
    out[tag + '.uniforms'] = h + ':' + Object.keys(u).length;
    out[tag + '.perUniform'] = per;
  }
  out.layers = C.fnv(JSON.stringify((c.cloudLayers ?? []).map((l: AnyRec) => [l.channel, l.altitude, l.height, l.densityScale, l.shapeAmount, l.shapeDetailAmount, l.weatherExponent, l.shapeAlteringBias, l.coverageFilterWidth, l.shadow,
    l.densityProfile && [(l.densityProfile as AnyRec).expTerm, (l.densityProfile as AnyRec).exponent, (l.densityProfile as AnyRec).linearTerm, (l.densityProfile as AnyRec).constantTerm]])));
  out.weather = flat(c.localWeatherTexture);
  out.stbn = flat(c.stbnTexture);
  out.resolutionScale = c.resolutionScale;
  out.temporalUpscale = c.temporalUpscale;
  const sh = c.shadow as AnyRec & { mapSize?: { x: number; y: number } };
  out.shadow = [sh.cascadeCount, sh.mapSize ? sh.mapSize.x + 'x' + sh.mapSize.y : null, sh.maxFar ?? null, sh.splitMode ?? null, sh.splitLambda ?? null].join('|');
  out.frame = c.frame;
  const cam = vol.camera as PerspectiveCamera;
  out.camera = [cam.fov, cam.aspect, cam.view ? cam.view.enabled : false].join('|');
  return out;
}
function shaderHash(vol: Vol): AnyRec {
  const c = vol.debug.clouds as { cloudsPass: { currentMaterial: { fragmentShader: string; defines: AnyRec } }; shadowPass: { currentMaterial: { fragmentShader: string; defines: AnyRec } } };
  return {
    clouds: C.fnv(c.cloudsPass.currentMaterial.fragmentShader) + ':' + c.cloudsPass.currentMaterial.fragmentShader.length,
    shadow: C.fnv(c.shadowPass.currentMaterial.fragmentShader) + ':' + c.shadowPass.currentMaterial.fragmentShader.length,
    cloudsDefines: JSON.stringify(Object.entries(c.cloudsPass.currentMaterial.defines ?? {}).sort()),
  };
}

// ───────── GPU 보조(잡음 제거 패스·float 읽기) ─────────
type Gpu = { scene: Scene; cam: OrthographicCamera; mat: ShaderMaterial; rt: WebGLRenderTarget | null; w: number; h: number };
let GPU: Gpu | null = null;
function gpu(W: number, H: number): Gpu {
  if (!GPU) {
    const mat = new ShaderMaterial({
      uniforms: { uTex: { value: null }, uTexSize: { value: [1, 1] }, uCatmull: { value: 1 }, uDenoise: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'precision highp float;\nuniform sampler2D uTex;\nuniform vec2 uTexSize;\nvarying vec2 vUv;\n' + CATMULL_GLSL_COPY + DENOISE_GLSL_COPY
        + 'void main(){ gl_FragColor = skyDenoise(uTex, vUv, uTexSize); }',
      depthTest: false, depthWrite: false,
    });
    const scene = new Scene(); const q = new Mesh(new PlaneGeometry(2, 2), mat); q.frustumCulled = false; scene.add(q);
    GPU = { scene, cam: new OrthographicCamera(-1, 1, 1, -1, 0, 1), mat, rt: null, w: 0, h: 0 };
  }
  if (!GPU.rt || GPU.w !== W || GPU.h !== H) {
    GPU.rt?.dispose();
    GPU.rt = new WebGLRenderTarget(W, H, { type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
    GPU.w = W; GPU.h = H;
  }
  return GPU;
}
type ReadState = { errors: number[] };
function glCheck(renderer: WebGLRenderer, st: ReadState): void { const e = renderer.getContext().getError(); if (e) st.errors.push(e); }
/** skyDenoise(tex) → float RGBA(행 gy0..gy0+gh, GL 순서). texSize = 텍스처 자체 크기(기기와 같음: 볼륨 텍스처 = 드로잉 버퍼 크기). */
function denoiseRead(ctx: Ctx, tex: Texture, gy0: number, gh: number, out: Float32Array, st: ReadState): void {
  const { renderer, W, H } = ctx, g = gpu(W, H);
  g.mat.uniforms.uTex.value = tex; g.mat.uniforms.uTexSize.value = [W, H];
  const prevRT = renderer.getRenderTarget(), prevClear = renderer.autoClear;
  renderer.setRenderTarget(g.rt); renderer.autoClear = false; renderer.render(g.scene, g.cam);
  renderer.setRenderTarget(prevRT); renderer.autoClear = prevClear;
  renderer.readRenderTargetPixels(g.rt as WebGLRenderTarget, 0, gy0, W, gh, out);
  glCheck(renderer, st);
}
function readHalfRT(renderer: WebGLRenderer, rt: WebGLRenderTarget, x: number, y: number, w: number, h: number, u16: Uint16Array, out: Float32Array, st: ReadState): void {
  renderer.readRenderTargetPixels(rt, x, y, w, h, u16, undefined, 0);
  glCheck(renderer, st);
  const lut = C.halfLut();
  for (let i = 0; i < w * h * 4; i++) out[i] = lut[u16[i]];
}

async function writeFile(job: string, file: string, bytes: Uint8Array): Promise<void> {
  const w = (window as unknown as { __grainWrite?: (j: string, f: string, b64: string, append: boolean) => Promise<void> }).__grainWrite;
  if (!w) throw new Error('grain: window.__grainWrite missing (use grain/run-grain.js)');
  const CH = 6 * 1024 * 1024;
  if (bytes.length === 0) { await w(job, file, '', false); return; }
  for (let o = 0; o < bytes.length; o += CH) await w(job, file, C.toBase64(bytes.subarray(o, Math.min(bytes.length, o + CH))), o > 0);
}
const bytesOf = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
async function writePng(job: string, file: string, dataUrl: string): Promise<void> {
  const w = (window as unknown as { __grainWrite?: (j: string, f: string, b64: string, append: boolean) => Promise<void> }).__grainWrite;
  if (!w) throw new Error('grain: window.__grainWrite missing');
  await w(job, file, dataUrl.split(',')[1], false);
}
/** float RGBA(GL 순서, 전체 캔버스 W×H) 를 sRGB 8비트 PNG 둘(rgb·알파)로 — entry.ts 의 show 와 같은 부호화. */
async function pngOfFloat(ctx: Ctx, job: string, base: string, rgba: Float32Array): Promise<void> {
  const t = new DataTexture(rgba, ctx.W, ctx.H, RGBAFormat, FloatType); t.minFilter = t.magFilter = NearestFilter; t.needsUpdate = true;
  const prev = ctx.renderer.autoClear;
  await writePng(job, base + '.png', ctx.show(t, 0));
  await writePng(job, base + '.alpha.png', ctx.show(t, 1));
  ctx.renderer.autoClear = prev;
  t.dispose();
}
const syncMs = (renderer: WebGLRenderer) => { const gl = renderer.getContext(); const p = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); return performance.now(); };

// ───────── 잡 ─────────
export async function runGrain(ctx: Ctx, job: AnyRec & { name: string; grain: GrainJob }): Promise<AnyRec> {
  const { renderer, vol, W, H } = ctx;
  const g = job.grain;
  const clouds = vol.debug.clouds as AnyRec & { cloudsPass: AnyRec & { currentRenderTarget: WebGLRenderTarget; historyRenderTarget: WebGLRenderTarget; resolveMaterial: { uniforms: Record<string, { value: number }> }; currentMaterial: { fragmentShader: string; defines: AnyRec; needsUpdate: boolean } }; frame: number; temporalUpscale: boolean; resolutionScale: number };
  const cp = clouds.cloudsPass;
  const st: ReadState = { errors: [] };
  renderer.getContext().getError();   // 앞 잡의 남은 오류 비움
  const meta: AnyRec = {
    name: job.name, mode: g.mode, W, H, grain: g, temporalUpscale: clouds.temporalUpscale, resolutionScale: vol.resolutionScale(), quality: job.quality ?? 'low',
    options: job.options ?? null, material: job.material ?? null, resolve: job.resolve ?? null, clouds: job.clouds ?? null, input: job.input, noiseSeed: g.noiseSeed ?? 12345,
  };
  if (g.mode === 'state') { meta.stateHash = stateHash(vol); return meta; }
  const frame0 = g.frame0 ?? 0;
  const cy0 = Math.floor((g.crop?.[0] ?? 0) * H), cy1 = Math.ceil((g.crop?.[1] ?? 1) * H);
  const gy0 = H - cy1, gh = cy1 - cy0;                          // GL 행
  const ts = performance.now();

  if (g.mode === 'cost') {
    const mat = cp.currentMaterial;
    const text = mat.fragmentShader, patched = applyCostPatch(text), hadDefine = 'DEBUG_SHOW_SAMPLE_COUNT' in mat.defines;
    mat.fragmentShader = patched; mat.defines.DEBUG_SHOW_SAMPLE_COUNT = '1'; mat.needsUpdate = true;
    costRestore = { mat, text, patched, hadDefine };
    meta.shaderHash = shaderHash(vol);
  }
  clouds.frame = frame0;
  meta.frame0 = frame0; meta.firstFrame = frame0 + 1;
  const cur = cp.currentRenderTarget, lw = cur.width, lh = cur.height;
  const cw = cp.historyRenderTarget.width, chh = cp.historyRenderTarget.height;
  const ccy0 = Math.floor(cy0 * chh / H), ccy1 = Math.ceil(cy1 * chh / H), cgy0 = chh - ccy1, cgh = ccy1 - ccy0;
  meta.cloudGrid = { cw, ch: chh, lw, lh, cropRows: [ccy0, ccy1] }; meta.canvasCropRows = [cy0, cy1];
  const u16c = new Uint16Array(lw * lh * 4), fc = new Float32Array(lw * lh * 4);

  if (g.mode === 'cost') {
    const frames = g.frames ?? 16, nT = cw * chh;
    const sx = new Float64Array(nT), sy = new Float64Array(nT), sz = new Float64Array(nT), sc = new Float64Array(nT), n = new Uint16Array(nT);
    for (let i = 0; i < frames; i++) {
      vol.renderToTexture(1 / 60);
      const f = clouds.frame;
      readHalfRT(renderer, cur, 0, 0, lw, lh, u16c, fc, st);
      if (clouds.temporalUpscale) {
        const [bx, by] = C.bayerPos(f % 16);
        for (let Y = 0; Y < lh; Y++) { const y = 4 * Y + by; if (y >= chh) continue; for (let X = 0; X < lw; X++) { const x = 4 * X + bx; if (x >= cw) continue; const k = (Y * lw + X) * 4, j = y * cw + x; sx[j] += fc[k]; sy[j] += fc[k + 1]; sz[j] += fc[k + 2]; sc[j] += fc[k + 3]; n[j]++; } }
      } else {
        for (let j = 0; j < nT; j++) { const k = j * 4; sx[j] += fc[k]; sy[j] += fc[k + 1]; sz[j] += fc[k + 2]; sc[j] += fc[k + 3]; n[j]++; }
      }
    }
    meta.lastFrame = clouds.frame; meta.wallMs = syncMs(renderer) - ts;
    const out = new Float32Array(cw * cgh * 4); let tx = 0, ty = 0, tz = 0, tc = 0, nn = 0;
    for (let yy = 0; yy < cgh; yy++) for (let x = 0; x < cw; x++) {
      const j = (cgy0 + yy) * cw + x, o = (yy * cw + x) * 4, m = n[j] || NaN;
      out[o] = sx[j] / m; out[o + 1] = sy[j] / m; out[o + 2] = sz[j] / m; out[o + 3] = sc[j] / m;
      if (n[j]) { tx += sx[j]; ty += sy[j]; tz += sz[j]; tc += sc[j]; nn += n[j]; }
    }
    meta.cost = { x: tx / nn, y: ty / nn, z: tz / nn, capFrac: tc / nn, fetch: (tx + ty + tz) / nn, samples: nn };
    await writeFile(job.name, 'cost.f16', bytesOf(C.encodeHalfArray(C.flipRows(out, cw, cgh, 4))));
    meta.glErrors = st.errors; meta.captureOk = st.errors.length === 0;
    return meta;
  }

  const nP = W * gh;
  const u16d = new Uint16Array(nP * 4), raw = new Float32Array(nP * 4), dn = new Float32Array(nP * 4);

  if (g.mode === 'reference') {
    if (clouds.temporalUpscale) throw new Error('grain reference: options.temporalUpscale must be false');
    if (cp.resolveMaterial.uniforms.temporalAlpha.value !== 1) throw new Error('grain reference: resolve.temporalAlpha must be 1');
    const n = g.n ?? 32, ss = g.ss ?? 4, res = vol.resolutionScale();
    if (n % (2 * ss * ss) !== 0) throw new Error('grain reference: n must be a multiple of 2·ss² (two full stratum cycles)');
    const cam = vol.camera as PerspectiveCamera;
    const A = new Float64Array(nP * 4), B = new Float64Array(nP * 4);
    const offs: [number, number][] = [];
    try {
      for (let k = 0; k < n; k++) {
        const [dx, dy] = C.stratumOffset(k, ss, res); offs.push([dx, dy]);
        cam.setViewOffset(W, H, dx, dy, W, H); viewOffsetSet = true;
        const tex = vol.renderToTexture(1 / 60);
        readHalfRT(renderer, (tex as unknown as { renderTarget: WebGLRenderTarget }).renderTarget, 0, gy0, W, gh, u16d, raw, st);
        const acc = k < n / 2 ? A : B;
        for (let i = 0; i < nP * 4; i++) acc[i] += raw[i];
      }
    } finally { cam.clearViewOffset(); viewOffsetSet = false; }
    meta.lastFrame = clouds.frame; meta.wallMs = syncMs(renderer) - ts; meta.strata = { n, ss, offsetsCanvasPx: offs.slice(0, ss * ss) };
    const half = n / 2;
    const full = new Float32Array(W * H * 4);
    const outs: Record<string, Float32Array> = {};
    for (const [tag, src, div] of [['ref', null, n], ['refA', A, half], ['refB', B, half]] as [string, Float64Array | null, number][]) {
      full.fill(0);
      for (let i = 0; i < nP * 4; i++) full[gy0 * W * 4 + i] = (src ? src[i] : A[i] + B[i]) / div;
      const t = new DataTexture(full, W, H, RGBAFormat, FloatType); t.minFilter = t.magFilter = NearestFilter; t.needsUpdate = true;
      denoiseRead(ctx, t, gy0, gh, dn, st);
      const Ld = new Float32Array(nP), Al = new Float32Array(nP);
      for (let p = 0; p < nP; p++) { Ld[p] = C.lum(dn[p * 4], dn[p * 4 + 1], dn[p * 4 + 2]); Al[p] = full[gy0 * W * 4 + p * 4 + 3]; }
      outs[tag + '.Ld.f32'] = C.flipRows(Ld, W, gh, 1);
      outs[tag + '.A.f32'] = C.flipRows(Al, W, gh, 1);
      if (tag === 'ref') await pngOfFloat(ctx, job.name, 'ref', full.slice());
      t.dispose();
    }
    for (const [f, a] of Object.entries(outs)) await writeFile(job.name, f, bytesOf(a));
    if ((g.capFrames ?? 0) > 0) {
      const mat = cp.currentMaterial;
      const text = mat.fragmentShader, patched = applyCostPatch(text), hadDefine = 'DEBUG_SHOW_SAMPLE_COUNT' in mat.defines;
      mat.fragmentShader = patched; mat.defines.DEBUG_SHOW_SAMPLE_COUNT = '1'; mat.needsUpdate = true;
      costRestore = { mat, text, patched, hadDefine };
      const cap = new Uint8Array(cw * chh); let capN = 0;
      const u16f = new Uint16Array(cw * chh * 4), ff = new Float32Array(cw * chh * 4);
      for (let i = 0; i < (g.capFrames ?? 0); i++) {
        vol.renderToTexture(1 / 60);
        readHalfRT(renderer, cur, 0, 0, cw, chh, u16f, ff, st);
        for (let j = 0; j < cw * chh; j++) if (ff[j * 4 + 3] > 0.5) cap[j] = 1;
      }
      const capC = new Uint8Array(cw * cgh);
      for (let yy = 0; yy < cgh; yy++) for (let x = 0; x < cw; x++) { capC[yy * cw + x] = cap[(cgy0 + yy) * cw + x] * 255; capN += cap[(cgy0 + yy) * cw + x]; }
      meta.capFrac = capN / (cw * cgh);
      await writeFile(job.name, 'capMask.u8', C.flipRows(capC, cw, cgh, 1));
    }
    meta.shaderHash = shaderHash(vol); meta.stateHash = stateHash(vol);
    meta.glErrors = st.errors; meta.captureOk = st.errors.length === 0;
    return meta;
  }

  // ── capture ──
  const warm = g.warm ?? 16, win = g.window ?? 64, stills = g.stills ?? [7, 23, 39, 55], pngStills = new Set(g.pngStills ?? []), full = (g.store ?? 'lite') === 'full';
  if (win % 16 !== 0) throw new Error('grain capture: window must be a multiple of 16');
  const nT = cw * chh;
  const sY = new Float64Array(nT), sY2 = new Float64Array(nT), sA = new Float64Array(nT), sA2 = new Float64Array(nT), nS = new Uint16Array(nT);
  const sR = new Float64Array(nP * 4);            // 원 RGBA 합(창 평균 PNG·알파)
  const sLn = new Float64Array(nP), sLn2 = new Float64Array(nP), sL1 = new Float64Array(nP), sL2 = new Float64Array(nP);
  const satAll = new Uint16Array(nP), clipAny = new Uint16Array(nP);
  const stillLd: Float32Array[] = [];
  const pngOk: AnyRec[] = [];
  const gl = renderer.getContext();
  for (let i = 0; i < warm + win; i++) {
    const tex = vol.renderToTexture(1 / 60);
    if (i < warm) continue;
    const t = i - warm, f = clouds.frame;
    readHalfRT(renderer, cur, 0, 0, lw, lh, u16c, fc, st);
    C.scatterQuarter(fc, lw, lh, f, cw, chh, sY, sY2, sA, sA2, nS);
    readHalfRT(renderer, (tex as unknown as { renderTarget: WebGLRenderTarget }).renderTarget, 0, gy0, W, gh, u16d, raw, st);
    denoiseRead(ctx, tex, gy0, gh, dn, st);
    const first = t < win / 2;
    for (let p = 0; p < nP; p++) {
      const k = p * 4;
      sR[k] += raw[k]; sR[k + 1] += raw[k + 1]; sR[k + 2] += raw[k + 2]; sR[k + 3] += raw[k + 3];
      const L = C.lum(dn[k], dn[k + 1], dn[k + 2]), ln = Math.log(Math.max(0, L) + 0.01);
      sLn[p] += ln; sLn2[p] += ln * ln;
      if (first) sL1[p] += L; else sL2[p] += L;
      const a = dn[k] >= 0.98, b = dn[k + 1] >= 0.98, c = dn[k + 2] >= 0.98;
      if (a && b && c) satAll[p]++;
      if (a || b || c) clipAny[p]++;
    }
    const si = stills.indexOf(t);
    if (si >= 0) {
      if (full) { const Ld = new Float32Array(nP); for (let p = 0; p < nP; p++) Ld[p] = C.lum(dn[p * 4], dn[p * 4 + 1], dn[p * 4 + 2]); stillLd[si] = Ld; }
      if (pngStills.has(si)) {
        const prev = renderer.autoClear;
        const rgbUrl = ctx.show(tex, 0);
        // captureOk: 캔버스(8비트, 위 blit 의 sRGB 부호화) 와 float 원 값의 부호화가 1 단계 안(≥ 99.9 %).
        const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let bad = 0;
        for (let p = 0; p < nP; p++) for (let c = 0; c < 3; c++) { const e = Math.round(255 * C.linearToSrgb(raw[p * 4 + c])); if (Math.abs(e - px[(gy0 * W + p) * 4 + c]) > 1) bad++; }
        const alphaUrl = ctx.show(tex, 1);
        renderer.autoClear = prev;
        await writePng(job.name, 'still' + si + '.png', rgbUrl);
        await writePng(job.name, 'still' + si + '.alpha.png', alphaUrl);
        pngOk.push({ still: si, badFrac: bad / (nP * 3) });
      }
    }
  }
  meta.lastFrame = clouds.frame; meta.wallMs = syncMs(renderer) - ts;
  meta.stillsRenderedFrame = stills.map(s => frame0 + 1 + warm + s);
  // 표본 수 점검: 창이 16 의 배수면 모든 텍셀이 정확히 window/16 개.
  let n4 = 0; const want = win / 16;
  for (let yy = 0; yy < cgh; yy++) for (let x = 0; x < cw; x++) if (nS[(cgy0 + yy) * cw + x] === want) n4++;
  meta.sampFullFrac = n4 / (cw * cgh);
  // σs 입력(구름 격자, 위가 0): [meanY, stdY, meanA, stdA] f16
  const samp = new Float32Array(cw * cgh * 4);
  for (let yy = 0; yy < cgh; yy++) for (let x = 0; x < cw; x++) {
    const j = (cgy0 + yy) * cw + x, o = (yy * cw + x) * 4;
    const [mY, sdY] = C.meanStd(sY[j], sY2[j], nS[j]), [mA, sdA] = C.meanStd(sA[j], sA2[j], nS[j]);
    samp[o] = mY; samp[o + 1] = sdY; samp[o + 2] = mA; samp[o + 3] = sdA;
  }
  await writeFile(job.name, 'samp.f16', bytesOf(C.encodeHalfArray(C.flipRows(samp, cw, cgh, 4))));
  const lnStd = new Float32Array(nP), drift = new Float32Array(nP), meanA = new Float32Array(nP), flags = new Uint8Array(nP * 2), meanLd = new Float32Array(nP);
  for (let p = 0; p < nP; p++) {
    const m = sLn[p] / win; lnStd[p] = Math.sqrt(Math.max(0, sLn2[p] / win - m * m) * win / (win - 1));
    const m1 = sL1[p] / (win / 2), m2 = sL2[p] / (win / 2);
    drift[p] = Math.log(Math.max(0, m1) + 0.01) - Math.log(Math.max(0, m2) + 0.01);
    meanLd[p] = (sL1[p] + sL2[p]) / win;
    meanA[p] = sR[p * 4 + 3] / win;
    flags[p * 2] = Math.round(255 * satAll[p] / win); flags[p * 2 + 1] = Math.round(255 * clipAny[p] / win);
  }
  await writeFile(job.name, 'lnStd.f16', bytesOf(C.encodeHalfArray(C.flipRows(lnStd, W, gh, 1))));
  await writeFile(job.name, 'drift.f16', bytesOf(C.encodeHalfArray(C.flipRows(drift, W, gh, 1))));
  await writeFile(job.name, 'meanA.f16', bytesOf(C.encodeHalfArray(C.flipRows(meanA, W, gh, 1))));
  await writeFile(job.name, 'flags.u8', C.flipRows(flags, W, gh, 2));
  if (full) {
    await writeFile(job.name, 'meanLd.f32', bytesOf(C.flipRows(meanLd, W, gh, 1)));
    for (let k = 0; k < stillLd.length; k++) if (stillLd[k]) await writeFile(job.name, 'still' + k + '.Ld.f16', bytesOf(C.encodeHalfArray(C.flipRows(stillLd[k], W, gh, 1))));
  }
  // 창 평균(원 경로) PNG — 사진 기준 가드(G5·G6)·면적(G1)·밝기(G2)의 입력.
  const meanRGBA = new Float32Array(W * H * 4);
  for (let i = 0; i < nP * 4; i++) meanRGBA[gy0 * W * 4 + i] = sR[i] / win;
  await pngOfFloat(ctx, job.name, 'mean', meanRGBA);
  meta.pngStills = pngOk;
  meta.captureOk = st.errors.length === 0 && meta.sampFullFrac === 1 && pngOk.every(r => (r.badFrac as number) <= 0.001);
  meta.glErrors = st.errors;
  meta.shaderHash = shaderHash(vol); meta.stateHash = stateHash(vol);
  meta.lastScene = vol.lastScene();
  return meta;
}
