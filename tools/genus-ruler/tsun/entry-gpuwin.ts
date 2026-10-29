/**
 * §180 GPU 창 확인 페이지(entry-gpuwin) — **하네스 전용**. lighting-render-check.js 가 이 번들(gpu-window.sh 가 HEAD 에서 자기 폴더로 묶음 —
 * .harness/ 아님)을 SwiftShader Chromium 한 페이지에 띄우고 window.__stage(이름, 인자) 를 한 번 부릅니다. 페이지 하나 = 단계 하나(≤ 60 분).
 *
 * 단계(§178 조명 고침의 렌더 확인 — 앱 길처럼 clampInscatter·irradianceLogMu 를 켜고 끔. 후보 손잡이(T·아치) 없음):
 *  - L1compile  : low·medium·high × 두 고침 끔/켬 — 모든 프로그램 컴파일·링크(onShaderError·info.programs), 구름 패스 글자의 '§178 …' 표지 수.
 *  - L2deck     : P1B(후쿠이 10/02 18:22:21 JST, 해 −9.84°, ac 0.75 · 7.4 km 덮개) low·high × {둘 다 끔, LOGμ 만, 둘 다 켬} —
 *                 구름 패스 출력(1/4 해상도 RT, 톤 앞)의 덮개 텍셀 Y(시선 고도 6~10° · 5~15°, α ≥ 0.5): 음수 비율·최솟값·중앙값,
 *                 표시 화면(톤 뒤 8비트)의 덮개 중앙 휘도·검은 화소 비율. 기대: CLAMP 켬이면 RT Y ≥ 0(반정밀도 오차 안), 표시가 끔보다 검지 않음.
 *  - L3twilight : 같은 장면에서 setDate 로 해 −10..0°(0.2° 걸음, 바람 표류 시각 고정 — 구름 모양이 그대로) × irradianceLogMu 끔/켬(CLAMP 켬) —
 *                 걸음마다 구름 RT 평균 Y(4 프레임). 출렁임은 node 쪽(gpuwin-lib pulsing)에서 국소 2차 맞춤 잔차로.
 *  - L4sunset   : 같은 식으로 해 0..+5°.
 *  - L5cross12  : 후쿠이 아침 06:40(해 9.1°)에 장면 → setDate 로 12° 를 위로 넘김(06:58·07:04·07:10·07:16·07:22) × 저층만 / 권운 함께 × low·medium:
 *                 (a) 지금 코드(§178 g2 castEligible) (b) 고치기 전 흉내(setDate 뒤 모든 층 shadow = 참 — e0f93f2^ 의 `layer.shadow !== undefined`)
 *                 (c) 그 시각에 새로 만든 장면 — 셋의 shadowTopHeight·층별 shadow·구름 RT 평균 Y(저층 텍셀).
 *  - L6frametime: high · RA1_s4_V1(균일 ac 덮개, 해 4°) — {끔, CLAMP, LOGμ, 둘 다} 를 ABBA 두 번, 설정마다 데움 6 + 잰 24 프레임(동기 시각).
 *  - W7atlas    : WP7-P1 — RA 합성 단위에서 T1·T1A(·T2) 아틀라스를 짓고(tsun-build 와 같은 길) 64×64 격자 점마다 GPU 읽기(gTsunUvOf 와 같은 식 +
 *                 하드웨어 선형 필터)와 CPU 거울 tsunAtlasSampleCpu(half) 를 대조: |Δτ| ≤ 1e-3·τ + 1e-3 [design v2 §8 WP7].
 *                 셰이더의 getGlobeUv(구면 → 평면) 단계는 이 탐침에 없음(평면 km 를 바로 넣음) — 그 단계는 B2 R-A_T 가 잼.
 * 셰이더 오류·GL 오류·맥락 손실은 단계 결과의 errors 에(단계 실패 판단은 node 쪽).
 */
import { FloatType, GLSL3, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, Vector3, Vector4, WebGLRenderer, WebGLRenderTarget, type PerspectiveCamera, type Texture, type WebGLRenderTarget as RT } from 'three';
import { createVolumetricScene, type VolumetricOptions, type VolumetricQuality, type VolumetricSceneInput } from '../../../src/components/VolumetricProbe/volumetricScene';
import { sunPosition } from '../../../src/utils/solarPosition';
import { parseTsunFixture, type TsunFixture, type TsunFixtureHeader } from '../../../src/components/VolumetricProbe/tsunFixture';
import { buildTsunAtlasData, makeTsunAtlas, sha256Hex, tsunAtlasSampleCpu, tsunLawsFromFixture } from '../../../src/components/VolumetricProbe/tsunAtlas';
import { installTsunShader } from '../../../src/components/VolumetricProbe/cloudTsunShader';
import { grainBaseOptions } from '../grain/capture';
import * as C from '../grain/capture-core';

installTsunShader();   // W7atlas 의 tsun 옵션 검증(주입기 없으면 setOptions 가 throw) — 하네스 번들만

type AnyRec = Record<string, unknown>;
type In = Omit<VolumetricSceneInput, 'date'> & { date: string };
const errors: string[] = [];
window.addEventListener('error', e => errors.push(String(e.message)));
const shaderErrors: string[] = [];
const Q = new URLSearchParams(location.search);
const W = Number(Q.get('w') ?? 400), H = Number(Q.get('h') ?? 300);
const canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
document.body.style.margin = '0';
document.body.appendChild(canvas);
let ctxLost = false;
canvas.addEventListener('webglcontextlost', () => { ctxLost = true; errors.push('webglcontextlost'); });
const renderer = new WebGLRenderer({ canvas, antialias: false, depth: false, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.debug.checkShaderErrors = true;
renderer.debug.onShaderError = (gl, program, vs, fs) => { shaderErrors.push(`program: ${gl.getProgramInfoLog(program) ?? ''} | fragment: ${(gl.getShaderInfoLog(fs) ?? '').slice(0, 2000)} | vertex: ${(gl.getShaderInfoLog(vs) ?? '').slice(0, 500)}`); };
const brokenPrograms = (): string[] => ((renderer.info as unknown as { programs?: { name?: string; diagnostics?: { runnable: boolean; programLog: string } }[] }).programs ?? [])
  .filter(p => p.diagnostics && p.diagnostics.runnable === false).map(p => `${p.name ?? '?'}: ${p.diagnostics!.programLog.slice(0, 400)}`);
const programCount = () => ((renderer.info as unknown as { programs?: unknown[] }).programs ?? []).length;

// 표시 복사(entry-tsun 과 같은 부호화: 선형 → sRGB, 알파 → 회색)
const blitScene = new Scene(), blitCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
const blitMat = new ShaderMaterial({
  uniforms: { uTex: { value: null }, uMode: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'precision highp float; uniform sampler2D uTex; uniform float uMode; varying vec2 vUv;'
    + 'vec3 enc(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }'
    + 'void main(){ vec4 t = texture2D(uTex, vUv); gl_FragColor = uMode > 0.5 ? vec4(vec3(clamp(t.a, 0.0, 1.0)), 1.0) : vec4(enc(t.rgb), 1.0); }',
  depthTest: false, depthWrite: false,
});
const quad = new Mesh(new PlaneGeometry(2, 2), blitMat); quad.frustumCulled = false; blitScene.add(quad);
/** 표시 화면 한 장(8비트 RGBA, GL 행 순서 = 아래가 0) + PNG. */
const showRead = (tex: Texture, mode: number): { px: Uint8Array; png: string } => {
  blitMat.uniforms.uTex.value = tex; blitMat.uniforms.uMode.value = mode;
  renderer.setRenderTarget(null); renderer.autoClear = true; renderer.render(blitScene, blitCam);
  const gl = renderer.getContext(), px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return { px, png: canvas.toDataURL('image/png') };
};
const syncNow = () => {
  const prev = renderer.getRenderTarget(); renderer.setRenderTarget(null);
  const gl = renderer.getContext(); const p = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
  renderer.setRenderTarget(prev); return performance.now();
};
const median = (a: number[]) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const quant = (a: number[], q: number) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };
const lumaLin = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const srgbToLin = (c: number) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const jst = (s: string) => new Date(s + '+09:00');

/** volsky entry JOB_BASE_OPTIONS 와 같은 값(entry-tsun 과 같음) — 앱 기본값 전부 위에. 조명 두 고침은 단계가 명시. */
const JOB_BASE_OPTIONS: Partial<VolumetricOptions> = {
  genus: true, coverRemap: true, weatherLod: null, shadowMinSunDeg: 12, sunMarch: [6, 250, 1.6], accurateSunBelowDeg: null, maxRayKm: null,
  flow: false, flowDensity: true, flowUv: false, flowN: 64, flowSteps: 20, flowHours: 0.5, flowVrms: 2, flowPsiEvery: 2,
  flowQMode: 0, flowQN: 128, flowQH: 0.5, flowS90: 0, flowCamCell: true, physics: false, physicsIce: false, iceHalo: false, icePowderOff: false, debugLightFloors: null, diffuse: 0, skeleton: 0, skeletonTiltScale: 1, profileBase: null, macroGrad: false,
};
const FLAGS: Record<string, { clampInscatter: boolean; irradianceLogMu: boolean }> = {
  off: { clampInscatter: false, irradianceLogMu: false }, clamp: { clampInscatter: true, irradianceLogMu: false },
  logmu: { clampInscatter: false, irradianceLogMu: true }, on: { clampInscatter: true, irradianceLogMu: true },
};

(async () => {
  try {
    const t0 = performance.now();
    const vol = await createVolumetricScene(renderer, W, H, { genus: true, celestial: false, spectral: true, effectiveTransmittance: true });
    const win = window as unknown as AnyRec;
    win.__atmosMs = performance.now() - t0;
    const clouds = vol.debug.clouds as unknown as AnyRec & {
      frame: number; skyLightScale: number; groundBounceScale: number;
      cloudLayers: { altitude: number; height: number; shadow: boolean }[];
      layerUniforms: { shadowTopHeight: { value: number }; shadowBottomHeight: { value: number } };
      cloudsPass: { currentRenderTarget: RT; currentMaterial: { fragmentShader: string; defines: AnyRec } };
    };

    // ── 공통 ──
    const setup = (input: In, opts: AnyRec, quality: VolumetricQuality, res = 0.5) => {
      vol.setOptions({ ...grainBaseOptions(JOB_BASE_OPTIONS, false), ...opts } as Partial<VolumetricOptions>, false);
      clouds.skyLightScale = 1; clouds.groundBounceScale = 1;
      vol.setQuality(quality);
      vol.setResolutionScale(res);
      vol.setScene({ ...input, date: new Date(input.date) } as VolumetricSceneInput);
      vol.setTerrainDistance(null);
      clouds.frame = 0;
    };
    const cam = () => vol.camera as PerspectiveCamera;
    const vv = new Vector3();
    /** 화면 uv(0~1, 아래가 0) → 시선 고도(°). */
    const elevAt = (u: number, v: number) => { vv.set(u * 2 - 1, v * 2 - 1, 0.5).unproject(cam()).sub(cam().position).normalize(); return (Math.asin(vv.y) * 180) / Math.PI; };
    /** 구름 패스 출력(1/4 해상도, 톤 앞) 한 프레임 → 텍셀마다 [Y, α, 고도]. */
    const readCloudRt = () => {
      const rt = clouds.cloudsPass.currentRenderTarget, lw = rt.width, lh = rt.height, gl = renderer.getContext();
      const u16 = new Uint16Array(lw * lh * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, lw, lh, u16 as never, undefined, 0);
      const e = gl.getError(); if (e) errors.push('readCloudRt GL ' + e);
      const lut = C.halfLut(), out: { Y: number; a: number; el: number }[] = [];
      for (let Y = 0; Y < lh; Y++) for (let X = 0; X < lw; X++) {
        const k = (Y * lw + X) * 4;
        out.push({ Y: lumaLin(lut[u16[k]], lut[u16[k + 1]], lut[u16[k + 2]]), a: lut[u16[k + 3]], el: elevAt((X + 0.5) / lw, (Y + 0.5) / lh) });
      }
      return out;
    };
    const statsY = (ys: number[]) => ({ n: ys.length, mean: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null, median: median(ys), p05: quant(ys, 0.05), min: ys.length ? Math.min(...ys) : null, fracNeg: ys.length ? ys.filter(y => y < 0).length / ys.length : null });
    /** n 프레임 그리고 마지막 k 프레임의 구름 RT 텍셀을 모음(+ 마지막 표시 텍스처). 첫 프레임 뒤 셰이더 오류 점검. */
    const frames = (n: number, k: number) => {
      const texels: { Y: number; a: number; el: number }[] = [], ms: number[] = [];
      let tex: Texture | null = null, tPrev = syncNow();
      const e0 = shaderErrors.length;
      for (let i = 0; i < n; i++) {
        tex = vol.renderToTexture(1 / 60);
        const t = syncNow(); ms.push(t - tPrev); tPrev = t;
        if (i >= n - k) texels.push(...readCloudRt());
      }
      const errs = [...shaderErrors.slice(e0), ...brokenPrograms()];
      return { texels, tex: tex as Texture, ms, shaderErrors: errs };
    };
    const shadowState = () => ({ top: clouds.layerUniforms.shadowTopHeight.value, bottom: clouds.layerUniforms.shadowBottomHeight.value, layerShadow: clouds.cloudLayers.map(l => l.shadow), layers: clouds.cloudLayers.map(l => [l.altitude, l.height]) });
    const sunAltOf = (d: Date, lat: number, lon: number) => (sunPosition(d, lat, lon).altitude * 180) / Math.PI;
    /** 저녁(해가 지는 쪽) 해 고도 e 의 시각 — [t0, t1] 에서 고도가 줄어드는 구간을 이분. */
    const dateForAlt = (e: number, lat: number, lon: number, t0: Date, t1: Date) => {
      let a = t0.getTime(), b = t1.getTime();
      for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (sunAltOf(new Date(m), lat, lon) > e) a = m; else b = m; }
      return new Date((a + b) / 2);
    };
    let fixture: TsunFixture | null = null, fixtureSha: string | null = null;
    const loadFixture = async () => {
      if (fixture) return;
      const header = (await (await fetch('tsun-fixture/tsun-fixture.json')).json()) as TsunFixtureHeader;
      const bytes = new Uint8Array(await (await fetch('tsun-fixture/tsun-fixture.bin')).arrayBuffer());
      const sha = sha256Hex(bytes);
      if (sha !== header.binSha256) throw new Error('fixture sha mismatch ' + sha.slice(0, 16));
      fixture = parseTsunFixture(header, bytes); fixtureSha = sha;
    };

    const stages: Record<string, (p: AnyRec) => Promise<AnyRec>> = {
      // ── L1 컴파일·링크 ──
      async L1compile(p) {
        const sc = p.scene as { input: In; options: AnyRec };
        const out: AnyRec[] = [];
        for (const q of ['low', 'medium', 'high'] as VolumetricQuality[]) for (const fl of ['off', 'on']) {
          const before = programCount();
          setup(sc.input, { ...sc.options, ...FLAGS[fl] }, q);
          const f = frames(2, 1);
          const txt = clouds.cloudsPass.currentMaterial.fragmentShader;
          out.push({ quality: q, flags: fl, ok: f.shaderErrors.length === 0 && !ctxLost, shaderErrors: f.shaderErrors, programs: programCount(), newPrograms: programCount() - before,
            marks: { clamp: txt.split('§178 clampInscatter').length - 1, logmu: txt.split('§178 irradianceLogMu').length - 1 }, frameMs: f.ms.map(Math.round), groundBounce: 'GROUND_BOUNCE' in clouds.cloudsPass.currentMaterial.defines });
        }
        return { runs: out };
      },
      // ── L2 깊은 박명 높은 덮개 ──
      async L2deck(p) {
        const sc = p.scene as { input: In; options: AnyRec };
        const runs: AnyRec[] = [], pngs: Record<string, string> = {};
        for (const q of (p.qualities as VolumetricQuality[])) for (const fl of ['off', 'logmu', 'on']) {
          setup(sc.input, { ...sc.options, ...FLAGS[fl] }, q);
          const f = frames(Number(p.frames ?? 16), 4);
          const band = (lo: number, hi: number) => statsY(f.texels.filter(t => t.a >= 0.5 && t.el >= lo && t.el <= hi).map(t => t.Y));
          const disp = showRead(f.tex, 0), alpha = showRead(f.tex, 1);
          const dl: number[] = []; let black = 0;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const k = (y * W + x) * 4; if (alpha.px[k] < 128) continue;
            const el = elevAt((x + 0.5) / W, (y + 0.5) / H); if (el < 6 || el > 10) continue;
            const Y = lumaLin(srgbToLin(disp.px[k]), srgbToLin(disp.px[k + 1]), srgbToLin(disp.px[k + 2])); dl.push(Y);
            if (disp.px[k] < 2 && disp.px[k + 1] < 2 && disp.px[k + 2] < 2) black++;
          }
          const tag = `${q}_${fl}`;
          pngs[tag + '.png'] = disp.png; pngs[tag + '.alpha.png'] = alpha.png;
          runs.push({ quality: q, flags: fl, sunAltDeg: vol.lastScene()?.sunAltDeg ?? null, exposure: vol.lastScene()?.exposure ?? null, shaderErrors: f.shaderErrors,
            rt: { deck6_10: band(6, 10), deck5_15: band(5, 15), all: statsY(f.texels.filter(t => t.a >= 0.5).map(t => t.Y)) },
            display: { n: dl.length, medianY: median(dl), meanY: dl.length ? dl.reduce((a, b) => a + b, 0) / dl.length : null, fracBlack: dl.length ? black / dl.length : null } });
        }
        return { runs, pngs };
      },
      // ── L3·L4 시간 이동 출렁임 ──
      async scrub(p) {
        const sc = p.scene as { input: In; options: AnyRec };
        const lat = Number(sc.input.lat), lon = Number(sc.input.lon);
        const t0 = new Date(String(p.searchFrom)), t1 = new Date(String(p.searchTo));
        const es: number[] = [];
        for (let e = Number(p.from); e <= Number(p.to) + 1e-9; e += Number(p.step)) es.push(+e.toFixed(4));
        const dates = es.map(e => dateForAlt(e, lat, lon, t0, t1));
        const series: AnyRec = {};
        for (const fl of ['clamp', 'on']) {   // LOGμ 끔(CLAMP 만) vs 둘 다 켬 — 앱 길은 둘 다 켬
          setup({ ...sc.input, date: dates[0].toISOString() }, { ...sc.options, ...FLAGS[fl] }, 'low');
          const drift = dates[0].getTime() / 1000;   // 바람 표류 시각 고정(§155) — 구름 모양이 걸음마다 같게
          frames(6, 0);
          const pts: AnyRec[] = [];
          for (let i = 0; i < es.length; i++) {
            vol.setDate(dates[i], drift);
            frames(1, 0);   // 해 방향이 바뀐 첫 프레임 버림
            const f = frames(4, 4);
            const cl = f.texels.filter(t => t.a >= 0.5).map(t => t.Y);
            pts.push({ e: es[i], date: dates[i].toISOString(), sunAltRenderer: vol.lastScene()?.sunAltDeg ?? null, Y: cl.length ? cl.reduce((a, b) => a + b, 0) / cl.length : null, n: cl.length, errs: f.shaderErrors.length });
          }
          series[fl] = pts;
        }
        return { series, bands: p.bands };
      },
      // ── L5 해 12° 위로 넘기 ──
      async L5cross12(p) {
        const fk = p.fukui as AnyRec, cfgs = p.configs as Record<string, unknown[]>;
        const T0 = jst('2026-10-02T06:40:00'), times = ['06:58:00', '07:04:00', '07:10:00', '07:16:00', '07:22:00'].map(s => jst('2026-10-02T' + s));
        const drift = T0.getTime() / 1000, nF = Number(p.frames ?? 16);
        const inputAt = (d: Date, layers: unknown[]) => ({ ...fk, date: d.toISOString(), layers }) as unknown as In;
        const lowY = (f: ReturnType<typeof frames>) => { const ys = f.texels.filter(t => t.a >= 0.5).map(t => t.Y); return { n: ys.length, mean: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null, median: median(ys) }; };
        const out: AnyRec[] = [];
        for (const q of (p.qualities as VolumetricQuality[])) for (const [cname, layers] of Object.entries(cfgs)) {
          const opts = { ...FLAGS.on, maxRayKm: 100 };
          const rows: AnyRec[] = times.map(d => ({ time: d.toISOString(), sunAltDeg: sunAltOf(d, Number(fk.lat), Number(fk.lon)) }));
          // (a) 지금 코드
          setup(inputAt(T0, layers), opts, q); vol.setDate(T0, drift); frames(4, 0);
          times.forEach((d, i) => { vol.setDate(d, drift); clouds.frame = 0; const f = frames(nF, 4); rows[i].fixed = { ...shadowState(), Y: lowY(f), errs: f.shaderErrors.length }; });
          // (b) 고치기 전 흉내: setDate 뒤 모든 층 shadow = (해 > shadowMinSunDeg)
          setup(inputAt(T0, layers), opts, q); vol.setDate(T0, drift); frames(4, 0);
          times.forEach((d, i) => {
            vol.setDate(d, drift);
            const on = sunAltOf(d, Number(fk.lat), Number(fk.lon)) > 12;
            clouds.cloudLayers.forEach(l => { l.shadow = on; });
            clouds.frame = 0; const f = frames(nF, 4); rows[i].preFix = { ...shadowState(), Y: lowY(f), errs: f.shaderErrors.length };
          });
          // (c) 그 시각에 새로 만든 장면(같은 표류 시각)
          times.forEach((d, i) => { setup(inputAt(d, layers), opts, q); vol.setDate(d, drift); clouds.frame = 0; const f = frames(nF, 4); rows[i].fresh = { ...shadowState(), Y: lowY(f), errs: f.shaderErrors.length }; });
          for (const r of rows as { fixed: { Y: { mean: number | null } }; preFix: { Y: { mean: number | null } }; fresh: { Y: { mean: number | null } } }[]) {
            const a = r.fixed.Y.mean, b = r.preFix.Y.mean, c = r.fresh.Y.mean;
            (r as AnyRec).ratioFixedOverPreFix = a != null && b ? a / b : null;
            (r as AnyRec).ratioFixedOverFresh = a != null && c ? a / c : null;
          }
          out.push({ quality: q, config: cname, rows });
        }
        return { runs: out };
      },
      // ── L6 프레임 시간(high) ──
      async L6frametime(p) {
        const sc = p.scene as { input: In; options: AnyRec };
        const order = ['off', 'clamp', 'logmu', 'on', 'on', 'logmu', 'clamp', 'off', 'off', 'clamp', 'logmu', 'on', 'on', 'logmu', 'clamp', 'off'];
        const nWarm = Number(p.warm ?? 6), nTimed = Number(p.timed ?? 24);
        const per: Record<string, number[]> = { off: [], clamp: [], logmu: [], on: [] };
        const log: AnyRec[] = [];
        setup(sc.input, { ...sc.options, ...FLAGS.off }, 'high');
        for (const fl of order) {
          vol.setOptions(FLAGS[fl], false);
          const w = frames(nWarm, 0), t = frames(nTimed, 0);
          per[fl].push(...t.ms);
          log.push({ flags: fl, warmMs: w.ms.map(Math.round), median: median(t.ms), errs: w.shaderErrors.length + t.shaderErrors.length });
        }
        const med = Object.fromEntries(Object.entries(per).map(([k, v]) => [k, median(v)])) as Record<string, number | null>;
        const delta = (k: string) => (med[k] != null && med.off ? med[k]! / med.off - 1 : null);
        return { medianMs: med, deltaVsOff: { clamp: delta('clamp'), logmu: delta('logmu'), on: delta('on') }, blocks: log, quality: 'high', canvas: [W, H] };
      },
      // ── WP7-P1 아틀라스 읽기 대조 ──
      async W7atlas(p) {
        await loadFixture();
        const units = p.units as Record<string, { input: In; options: AnyRec }>, arms = p.arms as Record<string, AnyRec>;
        const N = 64;
        const rt = new WebGLRenderTarget(N, N, { type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
        // gTsunUvOf(cloudTsunShader.ts) 와 같은 식 — 다른 점은 입력이 평면 km(getGlobeUv 단계 없음). gpuwin-test.js 가 두 글자의 식 줄을 대조함.
        const probe = new ShaderMaterial({
          glslVersion: GLSL3,
          uniforms: { gTsunTex: { value: null }, gTsunFrame: { value: null }, gTsunEpoch: { value: null }, uGrid: { value: null }, uBlk: { value: 0 }, uRow: { value: 0 } },
          vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader: [
            'precision highp float; precision highp sampler2D;',
            'uniform sampler2D gTsunTex; uniform vec4 gTsunFrame; uniform vec4 gTsunEpoch; uniform vec4 uGrid; uniform float uBlk; uniform float uRow;',
            'out vec4 outColor;',
            'vec2 probeUvOf(const vec2 planarKm, const float blk, const float row) {',
            '  vec2 km = planarKm - gTsunEpoch.xy;',
            '  vec2 ax = gTsunFrame.xy;',
            '  vec2 g = (vec2(dot(km, ax), dot(km, vec2(-ax.y, ax.x))) + gTsunFrame.z) / gTsunFrame.w;',
            '  float n = floor(2.0 * gTsunFrame.z / gTsunFrame.w + 0.5);',
            '  g = clamp(g, vec2(0.5), vec2(n - 0.5));',
            '  vec2 sz = vec2(textureSize(gTsunTex, 0));',
            '  return vec2(blk * n + g.x, row * n + g.y) / sz;',
            '}',
            'void main(){ vec2 ij = floor(gl_FragCoord.xy); outColor = textureLod(gTsunTex, probeUvOf(uGrid.xy + (ij + 0.5) * uGrid.zw, uBlk, uRow), 0.0); }',
          ].join('\n'),
          depthTest: false, depthWrite: false,
        });
        const pScene = new Scene(), pQuad = new Mesh(new PlaneGeometry(2, 2), probe); pQuad.frustumCulled = false; pScene.add(pQuad);
        const buf = new Float32Array(N * N * 4);
        const results: AnyRec[] = [];
        for (const [uname, u] of Object.entries(units)) for (const [aname, arm] of Object.entries(arms)) {
          if (aname === 'T2' && !uname.startsWith('RA1_')) continue;   // T2(N 256)는 한 단위만
          setup(u.input, { ...u.options, ...arm, tsunDebug: 0 }, 'low');
          const info = vol.tsunInfo();
          if (!info.injected) { results.push({ unit: uname, arm: aname, skipped: 'no T text (sun above shadowMinSunDeg?)', info }); continue; }
          const input = vol.tsunBuildInput();
          if (!input) { results.push({ unit: uname, arm: aname, skipped: 'no build input' }); continue; }
          const lw = tsunLawsFromFixture(fixture!, input);
          const data = buildTsunAtlasData(input, lw.laws, { fixtureSha: fixtureSha ?? undefined });
          const atlas = makeTsunAtlas(data, vol.tsunSceneSerial());
          const rows = data.arch ? 5 : 1, step = (2.1 * data.halfKm) / N;
          probe.uniforms.gTsunTex.value = atlas.texture;
          probe.uniforms.gTsunFrame.value = new Vector4(data.rowAxisEN[0], data.rowAxisEN[1], data.halfKm, (2 * data.halfKm) / data.n);
          probe.uniforms.gTsunEpoch.value = new Vector4(data.centerKm[0], data.centerKm[1], data.rangeKm, 0);
          probe.uniforms.uGrid.value = new Vector4(data.centerKm[0] - 1.05 * data.halfKm, data.centerKm[1] - 1.05 * data.halfKm, step, step);
          const per: AnyRec[] = [];
          for (let blk = 0; blk < data.blocks; blk++) for (let row = 0; row < rows; row++) {
            probe.uniforms.uBlk.value = blk; probe.uniforms.uRow.value = row;
            renderer.setRenderTarget(rt); renderer.render(pScene, blitCam); renderer.setRenderTarget(null);
            renderer.readRenderTargetPixels(rt, 0, 0, N, N, buf);
            let n = 0, fail = 0, maxExcess = -Infinity, maxAbs = 0; const d: number[] = [];
            for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
              const x = data.centerKm[0] - 1.05 * data.halfKm + (i + 0.5) * step, y = data.centerKm[1] - 1.05 * data.halfKm + (j + 0.5) * step;
              const c = tsunAtlasSampleCpu(data, x, y, blk, row, true);
              for (let ch = 0; ch < 4; ch++) {
                const g = buf[(j * N + i) * 4 + ch], dd = Math.abs(g - c[ch]), tol = 1e-3 * Math.abs(c[ch]) + 1e-3;
                n++; d.push(dd); maxAbs = Math.max(maxAbs, dd); maxExcess = Math.max(maxExcess, dd - tol); if (dd > tol) fail++;
              }
            }
            per.push({ blk, row, n, fail, maxAbs, p95: quant(d, 0.95), maxExcess });
          }
          results.push({ unit: uname, arm: aname, atlasSha: data.sha, n: data.n, blocks: data.blocks, halfKm: data.halfKm, arch: data.arch, buildMs: data.meta.buildMs, probes: per,
            fail: per.reduce((a, r) => a + Number(r.fail), 0), samples: per.reduce((a, r) => a + Number(r.n), 0), sunAltDeg: vol.lastScene()?.sunAltDeg ?? null });
          atlas.texture.dispose();
        }
        rt.dispose(); probe.dispose();
        return { results, fixtureSha, tolerance: '|dtau| <= 1e-3*tau + 1e-3 per channel (design v2 §8 WP7-P1)', note: 'planar-km probe: getGlobeUv stage not exercised' };
      },
    };

    win.__stage = async (name: string, params: AnyRec) => {
      const fn = name === 'L3twilight' || name === 'L4sunset' ? stages.scrub : stages[name];
      if (!fn) throw new Error('entry-gpuwin: unknown stage ' + name);
      const e0 = errors.length, s0 = shaderErrors.length, ts = performance.now();
      const result = await fn(params);
      const gl = renderer.getContext();
      return { stage: name, result, wallMs: performance.now() - ts, errors: errors.slice(e0), shaderErrors: shaderErrors.slice(s0), brokenPrograms: brokenPrograms(), glError: gl.getError(), ctxLost, canvas: [W, H] };
    };
  } catch (e) { errors.push('예외: ' + ((e as Error)?.stack ?? e)); }
  (window as unknown as AnyRec).__errors = errors;
  document.title = 'READY::' + (errors.length ? 'ERR' : 'OK');
})();
