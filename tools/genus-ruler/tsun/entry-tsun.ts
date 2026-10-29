/**
 * §179 RULER-tsun 측정 하네스(entry-tsun, WP8 — ruler-delta B1, RULER-tsun §5.0 ①) — **하네스 전용**. 앱의 volumetricScene.ts 를 그대로 묶어
 * 브라우저(SwiftShader Chromium)에서 그립니다. volsky/entry.ts(RULER-grain §10 동결)는 건드리지 않고 그 길을 옮겨 아래를 더했습니다.
 *
 *  - 잡 점검(tsun-harness.ts): 모르는 옵션 키 throw(grain checkGrainOptions) · **새 손잡이 9 개를 잡마다 명시**(ruler-delta A1) · 잡 필드 허용 목록 ·
 *    잡 종류 image / debug(tsunDebug 1) / cost(grain.mode 'cost').
 *  - 잡마다 되돌림: 옵션 = 앱 기본값 전부 + 하네스 기본(JOB_BASE_OPTIONS, volsky 와 같음) + 잡 값(앞 잡 손잡이가 새지 않음) · CloudsEffect.frame = 0 ·
 *    톤 = 처음 값(진단 잡은 LINEAR = NoToneMapping, 노출 1) · 하늘빛·지면 반사 배율 1 · 앞 잡 비용 변형 되돌림 ·
 *    shadowTopHeight = 새 applyScene 뒤 앱 값(드리우는 층이 없으면 0 — takram Ht() 는 이때 지우지 않음, defects g) ·
 *    quality low 에서 GROUND_BOUNCE define 이 켜져 있으면 throw(takram 의 define 걸림: high 잡 뒤 low 잡이 지면 반사를 물려받음 —
 *    tw1734·tw1746(high)은 따로 된 페이지에, ruler-delta F4; run-tsun.js 가 한 잡 파일 안 품질 섞기를 거부).
 *  - T 팔: 고정표(WP1 tsun-fixture.json·.bin)를 시작 때 읽어 sha256 대조 → 잡마다 setScene 뒤 tsun-build.ts 가 한 번 동기 구축(tsunSync). 해 ≤ shadowMinSunDeg 이면
 *    tsunInfo().injected·atlasValid 가 참이어야 렌더(아니면 throw — 아틀라스 없는 T 팔 = C0ps 빛, 빈 팔). REF 팔은 injected 만.
 *    샘플러 한도 거부(WP0)는 setOptions·setQuality 의 throw 가 그대로 잡 실패.
 *  - 진단 잡(tsunDebug 1, R-A_T): 구름 패스 출력(해석 전 1/4 해상도 RT, 반정밀도)을 프레임마다 읽어 Bayer 자리로 흩어 텍셀마다 Σ(Σw·T)·Σ(Σw) —
 *    RULER-grain 비용 모드와 같은 길(그림 경로의 대기·안개·톤을 거치지 않음, cloudTsun D13). 결과 `<잡>.debug.png`(R = √T, G = Σw, B = 값 있음) ·
 *    `<잡>.debug.f16`(구름 격자, 위가 0 인 행: T · Σw · 빛 받는 표본의 평균 mip · 그린 횟수 n — §179 검토 반영 하네스 11·물리 5).
 *  - 비용 잡: 동결 COST_PATCH + T_sun 셈(applyTsunCostPatch) → 텍셀마다 x·y·z·cap·n_tsun(프레임마다 A 해독 뒤 평균) · `<잡>.cost.f16`.
 *  - meta(§5.0 ①·ruler-delta B1): layers · elevProbe · scene(노출·해 고도) · shaderHash · stateHash · toneMapping · frames · belowShadow · tsunInfo
 *    (아틀라스 sha·구축 ms·구축기·고정표 sha) · 그리기 시간(동기, 프레임마다 — REF 한 그리기 > 10 s 면 B2 대체 경로) · GL 오류 · 맥락 손실.
 *  - §179 검토 반영(2026-10-29):
 *    · 하네스 1: 셰이더 컴파일·링크 실패(renderer.debug.onShaderError · info.programs 의 diagnostics.runnable false)와 GL 오류는 잡 실패 —
 *      __job 이 throw(파일을 돌려주지 않음), captureOk = GL 오류 없음 · 맥락 손실 없음 · 셰이더 오류 없음.
 *    · 회귀 1·하네스 7: 아틀라스는 여기서(tsun-build.ts) setScene 뒤에 한 번 지음 — 앱 묶음에 구축기·셰이더 글자가 없음(installTsunShader).
 *    · 회귀 4: 구름 패스 프로그램의 실제 활성 샘플러 수(ACTIVE_UNIFORMS)를 기록하고 정적 수 + 1(T·아치) / 정적 수(REF) 를 넘으면 throw.
 *    · 하네스 4: REF 팔은 해와 무관하게 글자가 들어가야 함(아니면 throw). 하네스 9: 비용 셈 줄 수를 팔과 대조. 하네스 10: 비용 A 넘침 셈.
 *    · 물리 5: 진단 출력 A = Σw·mip — meta.debug.meanMip, debug.f16 채널 2 = 빛 받는 표본의 무게 평균 mip(창마다 R-A_T 기록).
 *    · B2 의 'REF 한 그리기 > 10 s 면 4 타일 가위 그리기' 대체 경로는 **구현하지 않음**(결정, 하네스 17): B0 의 REF 시간 잡이 먼저 프레임마다
 *      그리기 시간(frameMs)을 재고, 10 s 를 넘으면 B2 전에 이 길을 더함 — 그 전에는 REF 잡이 맥락 손실로 끝날 수 있음(그때 덩어리가 끝나고 결과는 버림).
 *
 * 묶기·돌리기: run-tsun.sh(build·run) · run-tsun.js 머리말. 출력은 run-tsun.js 가 씀(이 파일은 돌려주기만).
 */
import { Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector3, WebGLRenderer, type PerspectiveCamera, type Texture, type WebGLRenderTarget } from 'three';
import { PrecomputedTexturesLoader } from '@takram/three-atmosphere';
import { ToneMappingMode } from 'postprocessing';
import { autoExposure, createVolumetricScene, type VolumetricOptions, type VolumetricQuality, type VolumetricSceneInput } from '../../../src/components/VolumetricProbe/volumetricScene';
import { sunPosition } from '../../../src/utils/solarPosition';
import { parseTsunFixture, type TsunFixture, type TsunFixtureHeader } from '../../../src/components/VolumetricProbe/tsunFixture';
import { sha256Hex } from '../../../src/components/VolumetricProbe/tsunAtlas';
import { installTsunShader, TSUN_CLOUD_SAMPLERS, TSUN_EXTRA_SAMPLERS } from '../../../src/components/VolumetricProbe/cloudTsunShader';
import { applyCostPatch, applyNoiseSeed, checkGrainOptions, grainBaseOptions, stateHash } from '../grain/capture';
import * as C from '../grain/capture-core';
import { applyTsunCostPatch, checkTsunJob, debugPngRgba, debugTexels, decodeCostA, expectedTsunCostCounts, expectInjected, TSUN_KNOB_SEMANTICS } from './tsun-harness';
import { buildTsunAtlasForJob, dropTsunAtlas, newTsunBuildState } from './tsun-build';

// §179 검토 반영(회귀 1): T_sun 셰이더 글자는 하네스만 묶음 — cloudTsun.ts 의 주입 등록에 겁니다(앱은 이 줄이 없어 T_sun 을 켜면 throw).
installTsunShader();

type AnyRec = Record<string, unknown>;
type Job = {
  name: string;
  input: Omit<VolumetricSceneInput, 'date'> & { date: string };
  frames?: number; timedN?: number; quality?: VolumetricQuality; res?: number; out?: 'rgb' | 'alpha' | 'both';
  options: Partial<VolumetricOptions> & AnyRec; exposureScale?: number; W?: number; H?: number;
  grain?: { mode: 'cost'; frame0?: number; frames?: number; noiseSeed?: number };
};

const errors: string[] = [];
window.addEventListener('error', e => errors.push(String(e.message)));
/** §179 하네스 1: 셰이더 컴파일·링크 실패(three 는 onShaderError 가 있으면 console.error 대신 이것을 부름). 잡마다 길이를 보고 늘었으면 잡 실패. */
const shaderErrors: string[] = [];
const Q = new URLSearchParams(location.search);
const W = Number(Q.get('w') ?? 400), H = Number(Q.get('h') ?? 300);
const canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
document.body.style.margin = '0';
document.body.appendChild(canvas);
/** WebGL 맥락 손실 = 잡 실패(ruler-delta B2 — 같은 덩어리 안에서 다시 하지 않음, run-tsun.js 가 덩어리를 끝냄). */
let ctxLost = false;
canvas.addEventListener('webglcontextlost', () => { ctxLost = true; errors.push('webglcontextlost'); });
const renderer = new WebGLRenderer({ canvas, antialias: false, depth: false, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.debug.checkShaderErrors = true;
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  const log = `program: ${gl.getProgramInfoLog(program) ?? ''} | vertex: ${gl.getShaderInfoLog(vs) ?? ''} | fragment: ${gl.getShaderInfoLog(fs) ?? ''}`;
  shaderErrors.push(log.slice(0, 4000));
};
/** info.programs 중 링크 실패로 표시된 것(diagnostics.runnable false) — onShaderError 와 같은 사실을 다른 길로. */
const brokenPrograms = (): string[] => ((renderer.info as unknown as { programs?: { name?: string; diagnostics?: { runnable: boolean; programLog: string } }[] }).programs ?? [])
  .filter(p => p.diagnostics && p.diagnostics.runnable === false).map(p => `${p.name ?? '?'}: ${p.diagnostics!.programLog.slice(0, 400)}`);
/** WebGL2 샘플러 형(ACTIVE_UNIFORMS 의 type). */
const SAMPLER_TYPES = new Set([0x8b5e, 0x8b5f, 0x8b60, 0x8b62, 0x8dc1, 0x8dc4, 0x8dc5, 0x8dca, 0x8dcb, 0x8dcc, 0x8dcf, 0x8dd2, 0x8dd3, 0x8dd4, 0x8dd7]);
/** §179 회귀 4: 재질의 지금 프로그램에서 활성 샘플러 수(배열은 크기만큼) — 정적 분석(TSUN_CLOUD_SAMPLERS)이 아닌 드라이버의 값. */
const activeSamplers = (mat: object): { count: number; names: string[] } | null => {
  const prog = (renderer.properties.get(mat) as { currentProgram?: { program?: WebGLProgram } } | undefined)?.currentProgram?.program;
  if (!prog) return null;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const n = Number(gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) ?? 0), names: string[] = [];
  let count = 0;
  for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(prog, i); if (u && SAMPLER_TYPES.has(u.type)) { count += u.size; names.push(u.name); } }
  return { count, names: names.sort() };
};
/** 균일변수 형 → vec4 칸 수(묶지 않은 위쪽 어림: 스칼라·vec2·vec3 도 한 칸, matN 은 N 칸, matNxM 은 N 칸). 샘플러는 칸을 쓰지 않음. */
const UNIFORM_SLOTS: Record<number, number> = { 0x8b5a: 2, 0x8b5b: 3, 0x8b5c: 4, 0x8b65: 2, 0x8b66: 2, 0x8b67: 3, 0x8b68: 3, 0x8b69: 4, 0x8b6a: 4 };
/**
 * §180 B1(GPU 창): 프로그램의 활성 균일변수 vec4 칸(기본 블록만 — UBO 멤버 뺌, 배열은 크기만큼)과 드라이버 한도(MAX_FRAGMENT/VERTEX_UNIFORM_VECTORS).
 * ACTIVE_UNIFORMS 는 정점·조각 두 단계를 합친 목록이라 조각 쪽의 **위쪽 어림**(구름 패스 정점 셰이더는 작음). WebGL2 최소 한도 224(조각)·256(정점).
 */
const activeUniformVectors = (mat: object): { vectors: number; uniforms: number; maxFragment: number; maxVertex: number; webgl2MinFragment: number } | null => {
  const prog = (renderer.properties.get(mat) as { currentProgram?: { program?: WebGLProgram } } | undefined)?.currentProgram?.program;
  if (!prog) return null;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const n = Number(gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) ?? 0);
  const idx = Array.from({ length: n }, (_, i) => i);
  const blocks = n ? (gl.getActiveUniforms(prog, idx, gl.UNIFORM_BLOCK_INDEX) as number[]) : [];
  let vectors = 0, uniforms = 0;
  for (let i = 0; i < n; i++) {
    const u = gl.getActiveUniform(prog, i);
    if (!u || SAMPLER_TYPES.has(u.type) || (blocks[i] ?? -1) !== -1) continue;
    uniforms++; vectors += (UNIFORM_SLOTS[u.type] ?? 1) * u.size;
  }
  return { vectors, uniforms, maxFragment: Number(gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)), maxVertex: Number(gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS)), webgl2MinFragment: 224 };
};

// 표시 복사(volsky entry 와 같은 부호화: 선형 rgb → sRGB, 알파 → 회색).
const blitScene = new Scene();
const blitCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
const blitMat = new ShaderMaterial({
  uniforms: { uTex: { value: null }, uMode: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'precision highp float; uniform sampler2D uTex; uniform float uMode; varying vec2 vUv;'
    + 'vec3 enc(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }'
    + 'void main(){ vec4 t = texture2D(uTex, vUv); gl_FragColor = uMode > 0.5 ? vec4(vec3(clamp(t.a, 0.0, 1.0)), 1.0) : vec4(enc(t.rgb), 1.0); }',
  depthTest: false, depthWrite: false,
});
const quad = new Mesh(new PlaneGeometry(2, 2), blitMat);
quad.frustumCulled = false;
blitScene.add(quad);
const show = (tex: Texture, mode: number) => {
  blitMat.uniforms.uTex.value = tex; blitMat.uniforms.uMode.value = mode;
  renderer.setRenderTarget(null); renderer.autoClear = true;
  renderer.render(blitScene, blitCam);
  return canvas.toDataURL('image/png');
};
/** 8비트 RGBA(위가 0) → PNG data URL(2D 캔버스 — GL 을 거치지 않음). */
const pngOf = (rgba: Uint8ClampedArray, w: number, h: number) => {
  const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
  const g = c2.getContext('2d'); if (!g) throw new Error('entry-tsun: no 2d context');
  g.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return c2.toDataURL('image/png');
};
/** GPU 를 기다린 뒤 시각(기본 프레임 버퍼 1 화소 동기 읽기 — capture.ts syncMs 와 같은 길). */
const syncNow = () => {
  const prev = renderer.getRenderTarget(); renderer.setRenderTarget(null);
  const gl = renderer.getContext(); const p = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
  renderer.setRenderTarget(prev); return performance.now();
};
const bytesOf = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const fnvHash = (s: string) => C.fnv(s) + ':' + s.length;

(async () => {
  try {
    const t0 = performance.now();
    const precomputed = Q.get('atmos') === 'load'
      ? await new Promise<Record<string, unknown>>((res, rej) => new PrecomputedTexturesLoader({ format: 'binary' }).setType(renderer).load('assets', t => res(t as unknown as Record<string, unknown>), undefined, rej))
      : undefined;
    const vol = await createVolumetricScene(renderer, W, H, {
      genus: true, celestial: Q.get('celestial') === '1', precomputed,
      spectral: Q.get('spectral') !== '0', effectiveTransmittance: Q.get('efft') !== '0',
    });
    const win = window as unknown as AnyRec;
    win.__spectral = vol.spectral;
    win.__atmosMs = performance.now() - t0;
    const clouds = vol.debug.clouds as unknown as AnyRec & {
      frame: number; temporalUpscale: boolean; skyLightScale: number; groundBounceScale: number;
      cloudLayers: { altitude: number; height: number; densityScale: number; shadow: boolean }[];
      layerUniforms: { shadowTopHeight: { value: number }; shadowBottomHeight: { value: number } };
      cloudsPass: { currentRenderTarget: WebGLRenderTarget; historyRenderTarget: WebGLRenderTarget; currentMaterial: { fragmentShader: string; defines: AnyRec; needsUpdate: boolean; uniforms: Record<string, { value: unknown }> } };
      shadowPass: { currentMaterial: { fragmentShader: string; uniforms: Record<string, { value: unknown }> } };
    };
    const toneDefault = vol.debug.toneMapping.mode;

    // ── WP1 고정표(T 팔 동기 구축) — run-tsun.js 가 /tsun-fixture/ 로 내줌. 없거나 sha 가 다르면 기록만 하고 T 잡에서 throw.
    let fixtureSha: string | null = null, fixtureError: string | null = null, fixture: TsunFixture | null = null;
    try {
      const hr = await fetch('tsun-fixture/tsun-fixture.json');
      if (!hr.ok) throw new Error('header HTTP ' + hr.status);
      const header = (await hr.json()) as TsunFixtureHeader;
      const br = await fetch('tsun-fixture/tsun-fixture.bin');
      if (!br.ok) throw new Error('bin HTTP ' + br.status);
      const bytes = new Uint8Array(await br.arrayBuffer());
      const sha = sha256Hex(bytes);
      if (sha !== header.binSha256 || bytes.length !== header.binBytes) throw new Error(`fixture sha/bytes mismatch: ${sha.slice(0, 16)} ${bytes.length} vs header ${String(header.binSha256).slice(0, 16)} ${header.binBytes}`);
      fixture = parseTsunFixture(header, bytes);
      fixtureSha = sha;
    } catch (e) { fixtureError = String((e as Error)?.message ?? e); }
    win.__fixture = { sha: fixtureSha, error: fixtureError };
    /** §179 하네스 구축 상태(페이지마다) — 잡마다 setScene 뒤 한 번 짓고, 다음 잡 시작에 풀고 버림. */
    const build = newTsunBuildState();

    /** 잡이 안 준 옵션의 하네스 기본값(volsky entry.ts JOB_BASE_OPTIONS 와 같은 값 — 그 파일은 동결이라 옮겨 씀). 새 손잡이는 grainBaseOptions 가 앱 기본값(끔)으로. */
    const JOB_BASE_OPTIONS: Partial<VolumetricOptions> = {
      genus: true, coverRemap: true, weatherLod: null, shadowMinSunDeg: 12, sunMarch: [6, 250, 1.6], accurateSunBelowDeg: null, maxRayKm: null,
      flow: false, flowDensity: true, flowUv: false, flowN: 64, flowSteps: 20, flowHours: 0.5, flowVrms: 2, flowPsiEvery: 2,
      flowQMode: 0, flowQN: 128, flowQH: 0.5, flowS90: 0, flowCamCell: true, physics: false, physicsIce: false, iceHalo: false, icePowderOff: false, debugLightFloors: null, diffuse: 0, skeleton: 0, skeletonTiltScale: 1, profileBase: null, macroGrad: false,
    };
    /** 앞 잡의 비용 변형(글자·define) — 잡 시작마다 되돌림. */
    let costRestore: { text: string; patched: string; hadDefine: boolean } | null = null;
    const restoreCost = () => {
      if (!costRestore) return;
      const m = clouds.cloudsPass.currentMaterial, r = costRestore; costRestore = null;
      if (m.fragmentShader === r.patched) m.fragmentShader = r.text;
      if (!r.hadDefine) delete m.defines.DEBUG_SHOW_SAMPLE_COUNT;
      m.needsUpdate = true;
    };
    const shaderHash = () => ({
      clouds: fnvHash(clouds.cloudsPass.currentMaterial.fragmentShader), shadow: fnvHash(clouds.shadowPass.currentMaterial.fragmentShader),
      cloudsDefines: JSON.stringify(Object.entries(clouds.cloudsPass.currentMaterial.defines ?? {}).sort()),
    });
    const groundBounceOn = () => clouds.cloudsPass.currentMaterial.defines.GROUND_BOUNCE != null;
    /** 1/4 해상도 구름 패스 RT 한 프레임 읽기(반정밀도 → float). */
    const readCur = (u16: Uint16Array, out: Float32Array, glErr: (number | string)[], tag: string) => {
      const rt = clouds.cloudsPass.currentRenderTarget, gl = renderer.getContext();
      let e = gl.getError(); if (e) glErr.push('pre-' + tag + ':' + e);
      renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, u16 as never, undefined, 0);
      e = gl.getError(); if (e) glErr.push(tag + ':' + e);
      const lut = C.halfLut();
      for (let i = 0; i < out.length; i++) out[i] = lut[u16[i]];
    };

    win.__job = async (job: Job) => {
      const kind = checkTsunJob(job as unknown as AnyRec);
      restoreCost();
      checkGrainOptions(job.options);
      if (ctxLost) throw new Error('entry-tsun: WebGL context was lost on this page — no retry within the chunk (ruler-delta B2)');
      renderer.getContext().getError();
      const shaderErr0 = shaderErrors.length;
      dropTsunAtlas(vol, build);   // 앞 잡의 아틀라스(이 하네스 소유) — 옵션을 바꾸기 전에 풀어 setOptions 가 낡은 아틀라스를 다시 점검하지 않게
      const input = { ...job.input, date: new Date(job.input.date) } as VolumetricSceneInput;
      const sunAltDeg0 = (sunPosition(input.date, input.lat, input.lon).altitude * 180) / Math.PI;
      if (kind === 'debug') input.exposure = 1;   // ruler-delta B1: 진단 잡 노출 1(진단 값은 해석 전 RT 에서 읽으므로 실제로는 무관 — 기록용)
      else if (job.exposureScale != null && job.exposureScale !== 1) input.exposure = (input.exposure ?? autoExposure(sunAltDeg0)) * job.exposureScale;
      // 새 손잡이 전체 되돌림 = 앱 기본값 전부(끔) 위에 하네스 기본, 그 위에 잡 값(잡은 9 개를 모두 명시 — checkTsunJob).
      vol.setOptions({ ...grainBaseOptions(JOB_BASE_OPTIONS, Q.get('celestial') === '1'), ...job.options }, false);
      vol.debug.toneMapping.mode = kind === 'debug' ? ToneMappingMode.LINEAR : toneDefault;
      clouds.skyLightScale = 1;
      clouds.groundBounceScale = 1;
      const quality = job.quality ?? 'low';
      vol.setQuality(quality);
      // takram define 걸림(ruler-delta F4): GROUND_BOUNCE 는 한 번 켜지면 가루(POWDER)가 켜진 동안 꺼지지 않음 — low 잡에서 켜져 있으면 앞 high 잡이 남긴 것.
      if (quality === 'low' && groundBounceOn()) throw new Error('entry-tsun: GROUND_BOUNCE is latched on in quality low (an earlier medium/high job on this page) — run high jobs on their own page');
      applyNoiseSeed(vol as never, job.grain?.noiseSeed);
      vol.setResolutionScale(job.res ?? 0.5);
      vol.setScene(input);
      vol.setTerrainDistance(null);
      // shadowTopHeight: 드리우는 층이 있으면 takram 이 매 프레임 층에서 다시 셈(새 값), 없으면 앱(§178 g2 applyCastMask)이 0 — 여기서 다시 0 으로(낡은 값 방지).
      const casting = clouds.cloudLayers.some(l => l.shadow && l.height > 0);
      const shadowTopBefore = clouds.layerUniforms.shadowTopHeight.value;
      if (!casting) { clouds.layerUniforms.shadowTopHeight.value = 0; clouds.layerUniforms.shadowBottomHeight.value = 0; }
      const o = job.options as AnyRec;
      // §179 하네스 구축(잡마다 한 번 — 장면·옵션이 다 걸린 뒤). 짓지 않으면 이유만 남고 T 팔은 아래에서 throw.
      const tb0 = performance.now();
      const built = buildTsunAtlasForJob(vol, fixture, o, build);
      const buildMsOuter = performance.now() - tb0;
      const info0 = vol.tsunInfo();
      const wantText = expectInjected(o, info0.belowShadow);
      if (wantText && !info0.injected) throw new Error(`entry-tsun: ${job.name} expects T_sun/REF text (REF: always; T: below shadowMinSunDeg) but none is injected`);
      if (Number(o.tsunRef ?? 0) !== 0 && !info0.injected) throw new Error(`entry-tsun: ${job.name} REF arm without REF text — void arm (D12)`);
      if (o.tsun === 1 && wantText && !info0.atlasValid) throw new Error(`entry-tsun: ${job.name} T arm without a valid atlas (${info0.reason ?? ''} / ${build.reason ?? ''}; fixture ${fixtureError ?? 'ok'}) — would render C0ps light`);
      if (kind === 'debug' && !info0.injected) throw new Error(`entry-tsun: ${job.name} debug job but no T_sun/REF text (sun above shadowMinSunDeg?)`);
      clouds.frame = 0;   // 잡마다 프레임 0 에서(§5.0 ①)
      const frames = kind === 'cost' ? (job.grain?.frames ?? 16) : (job.frames ?? (kind === 'debug' ? 4 : 16));
      const glErr: (number | string)[] = [];
      const meta: AnyRec = {
        name: job.name, kind, W, H, quality, res: vol.resolutionScale(), frames, frame0: 0, temporalUpscale: clouds.temporalUpscale,
        input: { ...job.input, macro: (job.input as AnyRec).macro ? '(macro)' : undefined }, options: job.options,
        tsunKnobs: { v: TSUN_KNOB_SEMANTICS, ...Object.fromEntries(['tsun', 'tsunN', 'tsunRangeKm', 'archLight', 'archNoT', 'tsunRef', 'tsunRefStepM', 'tsunDebug', 'tsunSync'].map(k => [k, o[k]])) },
        toneMapping: vol.debug.toneMapping.mode, toneMappingName: kind === 'debug' ? 'postprocessing ToneMappingMode.LINEAR (진단 값은 해석 전 RT 에서 읽어 무관)' : 'app default', exposureForced: kind === 'debug' ? 1 : null,
        shadowTop: { casting, before: shadowTopBefore, reset: !casting }, fixture: { sha: fixtureSha, error: fixtureError },
      };
      if (kind === 'cost') {
        const m = clouds.cloudsPass.currentMaterial;
        const text = m.fragmentShader, hadDefine = 'DEBUG_SHOW_SAMPLE_COUNT' in m.defines;
        const tp = applyTsunCostPatch(applyCostPatch(text));
        // 하네스 9: 렌더하는 묶음에서 셈 줄 수 = 팔·글자 상태(ruler-delta B1 '모든 앵커 수 == 1')
        const wantCounts = expectedTsunCostCounts(o, info0.injected);
        if (tp.counts.tsun !== wantCounts.tsun || tp.counts.archFetch !== wantCounts.archFetch || tp.counts.archLut !== wantCounts.archLut) {
          throw new Error(`entry-tsun: ${job.name} cost count lines ${JSON.stringify(tp.counts)} != expected ${JSON.stringify(wantCounts)} (text renamed?)`);
        }
        m.fragmentShader = tp.text; m.defines.DEBUG_SHOW_SAMPLE_COUNT = '1'; m.needsUpdate = true;
        costRestore = { text, patched: tp.text, hadDefine };
        meta.costCounts = tp.counts;
      }
      meta.shaderHash = shaderHash();
      meta.stateHash = stateHash(vol as never);
      const cur = clouds.cloudsPass.currentRenderTarget, hist = clouds.cloudsPass.historyRenderTarget;
      const lw = cur.width, lh = cur.height, cw = hist.width, ch = hist.height;
      meta.cloudGrid = { cw, ch, lw, lh };
      const u16 = new Uint16Array(lw * lh * 4), fc = new Float32Array(lw * lh * 4);
      const nT = cw * ch;
      const acc = kind === 'image' ? null : { s: [new Float64Array(nT), new Float64Array(nT), new Float64Array(nT), new Float64Array(nT), new Float64Array(nT)], n: new Uint16Array(nT), overflow: 0 };
      const frameMs: number[] = [];
      let tex: Texture | null = null;
      const ts = syncNow();
      let tPrev = ts;
      for (let i = 0; i < frames; i++) {
        tex = vol.renderToTexture(1 / 60);
        const tNow = syncNow(); frameMs.push(tNow - tPrev); tPrev = tNow;
        if (i === 0 && quality === 'low' && groundBounceOn()) throw new Error('entry-tsun: GROUND_BOUNCE turned on in quality low after the first frame');
        if (i === 0) {
          // 하네스 1: 첫 프레임에서 모든 프로그램이 컴파일·링크됨 — 실패면 잡 실패(빈·낡은 구름 항을 OK 로 쓰지 않게)
          const broken = brokenPrograms();
          if (shaderErrors.length > shaderErr0 || broken.length) throw new Error(`entry-tsun: ${job.name} shader compile/link failed — ${[...shaderErrors.slice(shaderErr0), ...broken].join(' || ').slice(0, 3000)}`);
          // 회귀 4: 실제 활성 샘플러 수(구름 패스) — T·아치 글자 = 정적 + 1, REF 글자 = 정적, 그 밖은 기록만
          const sm = activeSamplers(clouds.cloudsPass.currentMaterial);
          const maxT = (renderer.capabilities as unknown as { maxTextures?: number }).maxTextures ?? null;
          const expect = info0.injected ? TSUN_CLOUD_SAMPLERS[quality] + (o.tsun === 1 ? TSUN_EXTRA_SAMPLERS : 0) : null;
          meta.cloudSamplers = { active: sm?.count ?? null, names: sm?.names ?? null, staticExpected: expect, equal: sm && expect != null ? sm.count === expect : null, maxTextures: maxT };
          // §180 B1: 균일변수 vec4 예산(기록만 — 판단은 gpuwin-post.mjs b1: 같은 품질 C0ps 대비 증가분·WebGL2 최소 224 대비)
          meta.uniformVectors = activeUniformVectors(clouds.cloudsPass.currentMaterial);
          if (sm && expect != null && sm.count > expect) throw new Error(`entry-tsun: ${job.name} cloud pass has ${sm.count} active samplers > static count ${expect} (TSUN_CLOUD_SAMPLERS stale?)`);
          if (sm && maxT != null && sm.count > maxT) throw new Error(`entry-tsun: ${job.name} cloud pass ${sm.count} samplers > MAX_TEXTURE_IMAGE_UNITS ${maxT}`);
        }
        if (!acc) continue;
        readCur(u16, fc, glErr, 'cur' + i);
        const f = clouds.frame;
        const put = (k: number, j: number) => {
          if (kind === 'debug') { acc.s[0][j] += fc[k + 2]; acc.s[1][j] += fc[k + 1]; acc.s[2][j] += fc[k + 3]; }   // B Σw·T · G Σw · A Σw·mip
          else {
            const d = decodeCostA(fc[k + 3]);
            if (d.overflow) { acc.overflow++; return; }   // 하네스 10: cap 비트를 잃은 텍셀은 평균에서 빼고 셈
            acc.s[0][j] += fc[k]; acc.s[1][j] += fc[k + 1]; acc.s[2][j] += fc[k + 2]; acc.s[3][j] += d.cap; acc.s[4][j] += d.n;
          }
          acc.n[j]++;
        };
        if (clouds.temporalUpscale) {
          const [bx, by] = C.bayerPos(f % 16);
          for (let Y = 0; Y < lh; Y++) { const y = 4 * Y + by; if (y >= ch) continue; for (let X = 0; X < lw; X++) { const x = 4 * X + bx; if (x >= cw) continue; put((Y * lw + X) * 4, y * cw + x); } }
        } else {
          for (let j = 0; j < nT; j++) put(j * 4, j);
        }
      }
      meta.wallMs = syncNow() - ts; meta.lastFrame = clouds.frame;
      const sorted = frameMs.slice().sort((a, b) => a - b);
      meta.frameMs = { max: sorted[sorted.length - 1], median: sorted[Math.floor(sorted.length / 2)], all: frameMs.map(x => Math.round(x)) };
      const tn = Math.min(job.timedN ?? 4, frameMs.length);
      meta.ms = tn ? frameMs.slice(-tn).reduce((a, b) => a + b, 0) / tn : null;
      meta.groundBounce = groundBounceOn();
      const info = vol.tsunInfo();
      meta.tsun = {
        belowShadow: info.belowShadow, injected: info.injected, ref: info.ref, debug: info.debug, atlasValid: info.atlasValid, reason: info.reason,
        built, buildReason: build.reason, builds: build.builds, buildMsOuter, samplers: info.samplers, archW: info.archW,
        atlas: info.atlasMeta ? { sha: info.atlasMeta.sha, buildMs: info.atlasMeta.buildMs, builder: info.atlasMeta.builder, fixtureSha: info.atlasMeta.fixtureSha, K: info.atlasMeta.K, earthShadowFrac: info.atlasMeta.earthShadowFrac, warnings: info.atlasMeta.warnings } : null,
      };
      meta.belowShadow = info.belowShadow;
      meta.scene = vol.lastScene();
      meta.sunAltDeg = (vol.lastScene() as AnyRec | null)?.sunAltDeg ?? sunAltDeg0;
      meta.layers = clouds.cloudLayers.map(l => [l.altitude, l.height, l.densityScale, l.shadow]);
      {
        const camP = vol.camera as PerspectiveCamera, vv = new Vector3(), elevProbe: number[][] = [];
        for (const fx of [0.5, 0.0]) for (const fy of [0, 0.25, 0.5, 0.75, 1]) {
          const x = Math.min(W - 1, Math.floor(fx * W)), y = Math.min(H - 1, Math.floor(fy * H));
          vv.set(((x + 0.5) / W) * 2 - 1, ((y + 0.5) / H) * 2 - 1, 0.5).unproject(camP).sub(camP.position).normalize();
          elevProbe.push([x, y, (Math.asin(vv.y) * 180) / Math.PI]);
        }
        meta.elevProbe = elevProbe;
      }
      const files: Record<string, string> = {};
      if (kind === 'debug' && acc) {
        const d = debugTexels(acc.s[0], acc.s[1], acc.n, cw, ch, acc.s[2]);
        let sm = 0, sw = 0;
        for (let j = 0; j < nT; j++) if (Number.isFinite(d.mip[j]) && d.W[j] > 0) { sm += d.mip[j] * d.W[j]; sw += d.W[j]; }
        meta.debug = { covered: d.covered, meanMip: sw > 0 ? sm / sw : null, grid: [cw, ch],
          encoding: 'png: R = round(255·sqrt(T)), G = round(255·min(1, Σw)), B = 255 값 있음(Σw > 0) / 0 없음; T = Σ(Σw·T)/Σ(Σw) (cloudTsun D13). f16(구름 격자 cw×ch, 위가 0): T · Σw(그린 프레임 평균) · 빛 받는 표본의 무게 평균 mip · 그린 횟수 n(0 = 4×4 칸 이웃으로 채움)' };
        files['debug.png'] = pngOf(debugPngRgba(d.T, d.W, cw, ch, W, H), W, H);
        const f16 = new Float32Array(nT * 4);
        for (let j = 0; j < nT; j++) { f16[j * 4] = d.T[j]; f16[j * 4 + 1] = d.W[j]; f16[j * 4 + 2] = d.mip[j]; f16[j * 4 + 3] = acc.n[j]; }
        files['debug.f16'] = 'data:application/octet-stream;base64,' + C.toBase64(bytesOf(C.encodeHalfArray(C.flipRows(f16, cw, ch, 4))));
      } else if (kind === 'cost' && acc) {
        const out = new Float32Array(nT * 4); let tx = 0, ty = 0, tz = 0, tc = 0, tt = 0, nn = 0;
        for (let j = 0; j < nT; j++) {
          const m = acc.n[j] || NaN;
          out[j * 4] = acc.s[0][j] / m; out[j * 4 + 1] = acc.s[1][j] / m; out[j * 4 + 2] = acc.s[2][j] / m; out[j * 4 + 3] = acc.s[4][j] / m;
          if (acc.n[j]) { tx += acc.s[0][j]; ty += acc.s[1][j]; tz += acc.s[2][j]; tc += acc.s[3][j]; tt += acc.s[4][j]; nn += acc.n[j]; }
        }
        meta.cost = { x: tx / nn, y: ty / nn, z: tz / nn, capFrac: tc / nn, nTsun: tt / nn, fetch: (tx + ty + tz) / nn, fetchTsun: (tx + ty + tz + tt) / nn, samples: nn, overflow: acc.overflow,
          channels: 'cost-tsun.f16 = x · y · z · n_tsun (텍셀 평균, 위가 0); cap 은 capFrac 로만 — grain 의 cost.f16(채널 3 = cap)과 다른 이름(하네스 18)' };
        files['cost-tsun.f16'] = 'data:application/octet-stream;base64,' + C.toBase64(bytesOf(C.encodeHalfArray(C.flipRows(out, cw, ch, 4))));
      } else {
        const o2 = job.out ?? 'both';
        if (o2 === 'rgb' || o2 === 'both') files['png'] = show(tex as Texture, 0);
        if (o2 === 'alpha' || o2 === 'both') files['alpha.png'] = show(tex as Texture, 1);
      }
      meta.glErrors = glErr; meta.glError = renderer.getContext().getError(); meta.ctxLost = ctxLost;
      meta.shaderErrors = shaderErrors.slice(shaderErr0);
      // 하네스 1: 늦게 드러난 셰이더 오류(프레임 중 다시 만든 프로그램)도 잡 실패
      const brokenEnd = brokenPrograms();
      if (shaderErrors.length > shaderErr0 || brokenEnd.length) throw new Error(`entry-tsun: ${job.name} shader compile/link failed during frames — ${[...shaderErrors.slice(shaderErr0), ...brokenEnd].join(' || ').slice(0, 3000)}`);
      meta.captureOk = glErr.length === 0 && !ctxLost && meta.glError === 0;
      return { meta, files };
    };
  } catch (e) { errors.push('예외: ' + ((e as Error)?.stack ?? e)); }
  (window as unknown as AnyRec).__errors = errors;
  document.title = 'READY::' + (errors.length ? 'ERR' : 'OK');
})();
