/**
 * §179 WP6(REF_v2·REF_val) · D-1 진단(R-A_T) · WP8(entry-tsun·run-tsun) 합격 판정 — 브라우저 없음(RULER-grain C0 렌더와 함께 돌아도 됨: GPU·Chromium 안 씀,
 * run-tsun.js 도 돌리지 않음 — 그 순수 함수 run-tsun-lib.js 만 시험).
 * esbuild 로 앱의 createVolumetricScene 을 묶어 가짜 렌더러(GL 호출 없음)로 셰이더 글자·균일변수·define 만 봅니다(verify-tsun-shader.js 와 같은 방식).
 *   node tools/shader-preview/verify-tsun-ref.js [--base 0928318] [--work DIR]
 * 임시 출력은 os.tmpdir() 아래 새 폴더(--work 로 바꿈) — .harness/ 는 쓰지 않음.
 *
 *  [U6a] 균일 판 탐침: 주입 글자에서 꺼낸 gTsunRefMarch 를 줄마다 고정한 CPU 거울(글자가 바뀌면 실패)로 돌려 T = exp(−τ) 가
 *        exp(−σ·Δh / sin θ) 의 5 % 안(θ 5·10·20·45°, τ 0.3·1·2, 보폭 200·100 m, 지터 16 층 평균) + 땅·꼭대기 위·끝 거리·걸음 상한.
 *  [U6b] REF_v2 와 T 팔(T1·T1A)이 같은 V10b 글자: I-T 블록 · gTsunEddDiff · gTsunReach · gTsunLaneSel 바이트 같음, REF_val 은 I-T 없음(thru 줄 그대로).
 *  [U6c] 모든 팔(C0ps·T1·T2·T1A·H0·REF·REF100·REF_val) × tsunDebug 0·1 × 품질 3 × 얼음 × 확산 0·1 × grain 끔·전부 — 동결 COST_PATCH 앵커 6 개가
 *        정확히 한 번(applyCostPatch 성공) + T_sun 셈(applyTsunCostPatch) 성공·셈 줄 수(T 1 · 아치 1·1 · REF·C0ps 0).
 *  [U6d] REF_v2·REF100·REF_val 의 gTsunRefMarch 글자 같음(보폭은 균일변수).
 *  [REF] 글자 구조(아틀라스·샘플러 없음, BSM 안 읽음 — 해 ≤ shadowMinSunDeg 90) · 균일변수 값 · 텍스처 새로 안 만듦 · ACCURATE 강제 · 옵션 점검 ·
 *        shadowMinSunDeg 12 면 해 > 12° 에서 글자 없음(tsunInfo 로 보임).
 *  [D-1] 진단 표지 수 · 진단 글자에서 D-1 줄을 빼면 tsunDebug 0 글자와 바이트 같음 · 진단 부호화(채우기·PNG·mip) ↔ ra-t 해독 왕복 · ra-t 합성 시험.
 *  [reach] gTsunReach(주입 글자에서 옮김) = jitter 없는 Σ 걸음(§179 검토 물리 3), 걸음 0 → 0, takram 행진 추정의 jitter 기댓값과 같은 끝.
 *  [base] C0ps 글자 = §179 전 트리(--base, 기본 e0f93f2 — 그 트리에 cloudTsun.ts 가 있으면 멈춤, 검토 회귀 2).
 *  [WP8] tsun-harness(잡 점검·팔 불변식·비용 해독·넘침) · run-tsun-lib(자기 지킴 걸러내기·조상·잠금·감시 시간·품질 섞기·같은 이름·인자·덩어리 한도) ·
 *        run-tsun.sh build 두 번 = 같은 sha · 동결 파일(grain/**·volsky entry·capture*·RULER-tsun 동결 후보 자료)이 §179 전(e0f93f2)부터 바뀌지 않음
 *        (git diff e0f93f2 — 스냅샷 커밋 안의 고침도 봄 — 와 작업 트리).
 */
const path = require('path'); const os = require('os'); const fs = require('fs'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
// 기준 트리 = §179 전 마지막 커밋(e0f93f2 '§178 …'). §179 검토 반영(회귀 2): 처음 판의 기본 0928318 은 §179 스냅샷이었음 — 기준 트리에
// cloudTsun.ts 가 있으면(§179 가 섞인 트리) 시험을 멈춤. 동결 파일 점검도 이 커밋부터의 git diff.
const PRE179 = 'e0f93f2';
const BASE_REV = arg('--base', PRE179);
const WORK = arg('--work', null) ? path.resolve(arg('--work')) : fs.mkdtempSync(path.join(os.tmpdir(), 'tsun-ref-'));
fs.mkdirSync(WORK, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const count = (s, a) => s.split(a).length - 1;
const R_IT_ANCHOR = '        radiance += sunIrradiance * RECIPROCAL_PI4 * dot(gThru, media.weight);';

const JST = s => s + '+09:00';
const T = { day: JST('2026-10-02T15:00:00'), tw: JST('2026-10-02T17:00:00'), deep: JST('2026-10-02T18:22:21') };   // 후쿠이 P1: 29.6° · 6.8° · −9.8°
const LAYERS = [{ genus: 'sc', cover: 0.45, baseKm: 1.5, thicknessM: 750, band: 'low', opts: { seed: 4242 } }, { genus: 'ac', cover: 0.4, baseKm: 4.0, band: 'mid', opts: { seed: 5 } }, { genus: null, cover: 0, baseKm: 7.5, band: 'high' }, { genus: 'ci', cover: 0.3, baseKm: 9.0, band: 'high', opts: { seed: 77 } }];
const SCENE = { lat: 36.046, lon: 136.278, heightM: 23, az: 272, el: 10, fov: 60 };
const OFF = { tsun: 0, tsunN: 128, tsunRangeKm: 400, archLight: 0, archNoT: 0, tsunRef: 0, tsunRefStepM: 200, tsunDebug: 0, tsunSync: false };
// 닫힌 팔(ruler-delta A1) — 새 손잡이 9 개 모두 명시.
const ARMS = {
  C0ps: { ...OFF, accurateSunBelowDeg: 12 },
  T1: { ...OFF, accurateSunBelowDeg: 12, tsun: 1, tsunSync: true },
  T2: { ...OFF, accurateSunBelowDeg: 12, tsun: 1, tsunN: 256, tsunSync: true },
  T1A: { ...OFF, accurateSunBelowDeg: 12, tsun: 1, archLight: 1, tsunSync: true },
  H0: { ...OFF, accurateSunBelowDeg: 12, tsun: 1, archLight: 1, archNoT: 1, tsunSync: true },
  REF: { ...OFF, accurateSunBelowDeg: 90, shadowMinSunDeg: 90, tsunRef: 1 },
  REF100: { ...OFF, accurateSunBelowDeg: 90, shadowMinSunDeg: 90, tsunRef: 1, tsunRefStepM: 100 },
  REF_val: { ...OFF, accurateSunBelowDeg: 90, shadowMinSunDeg: 90, tsunRef: 2 },
};

const HARNESS = (tree, isCur) => `
import fs from 'node:fs';
import path from 'node:path';
import { Texture, Vector2 } from 'three';
import { EffectComposer } from 'postprocessing';
import { createVolumetricScene, DEFAULT_VOLUMETRIC_OPTIONS } from '${tree}/src/components/VolumetricProbe/volumetricScene';
${isCur ? `import * as TS from '${tree}/src/components/VolumetricProbe/cloudTsunShader';
import { applyCostPatch } from '${ROOT}/tools/genus-ruler/grain/capture';
import * as HX from '${ROOT}/tools/genus-ruler/tsun/tsun-harness';
import * as RAT from '${ROOT}/tools/genus-ruler/tsun/ra-t.mjs';
TS.installTsunShader();   // §179 검토 반영(회귀 1): 셰이더 글자는 하네스·시험만 검` : ''}
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];
const W = 390, H = 584;
const gl = { getContextAttributes: () => ({ alpha: false }), getExtension: () => null, getParameter: () => 0 };
const mkRenderer = (): any => ({ getSize: (v: Vector2) => v.set(W, H), getDrawingBufferSize: (v: Vector2) => v.set(W, H), getPixelRatio: () => 1,
  getContext: () => gl, outputColorSpace: 'srgb-linear', autoClear: true, toneMappingExposure: 1, capabilities: { logarithmicDepthBuffer: false, isWebGL2: true } });
const passes: any[] = [];
const origAdd = (EffectComposer.prototype as any).addPass;
(EffectComposer.prototype as any).addPass = function (p: any, i?: number) { passes.push(p); return origAdd.call(this, p, i); };
const BASEOPT = { genus: true, celestial: false, macro: 1 };
const mk = async (options: any, quality: string) => {
  passes.length = 0;
  const v: any = await createVolumetricScene(mkRenderer(), W, H, { genus: true, celestial: false, precomputed: {} as never });
  v.setOptions({ ...DEFAULT_VOLUMETRIC_OPTIONS, ...BASEOPT, ...options }, false);
  v.setQuality(quality);
  v.setResolutionScale(0.5);
  return v;
};
const inp = (iso: string) => ({ ...cfg.scene, date: new Date(iso), layers: cfg.layers });
const texts = (v: any) => {
  const cm = v.debug.clouds.cloudsPass.currentMaterial, sm = v.debug.clouds.shadowPass.currentMaterial;
  return { cloudsFrag: cm.fragmentShader, shadowFrag: sm.fragmentShader, uniforms: JSON.stringify([Object.keys(cm.uniforms).sort(), Object.keys(sm.uniforms).sort()]), defines: JSON.stringify([cm.defines, sm.defines]) };
};
const dump = (tag: string, t: Record<string, string>) => { for (const [k, s] of Object.entries(t)) fs.writeFileSync(path.join(OUT, tag + '.' + k + '.glsl'), s); };
const throwsMsg = (f: () => unknown): string | null => { try { f(); return null; } catch (e: any) { return String(e && e.message || e); } };

${isCur ? `
const texId = () => new Texture().id;
async function curTests(res: any) {
  const M = TS.TSUN_MARKS;
  const c = (s: string, a: string) => s.split(a).length - 1;
  // ── 팔 글자(낮은 품질·변형 없음, 박명·깊은 박명·낮)
  res.info = {}; res.uni = {}; res.defs = {};
  for (const [an, ao] of Object.entries(cfg.arms) as [string, any][]) for (const dbg of [0, 1]) {
    if (dbg && an === 'C0ps') continue;
    for (const t of ['tw', 'deep', 'day']) {
      const v = await mk({ ...ao, tsunDebug: dbg }, 'low');
      v.setScene(inp(cfg.iso[t]));
      const tag = an + (dbg ? '_dbg' : '') + '_' + t;
      dump(tag, texts(v));
      res.info[tag] = v.tsunInfo();
      const u = v.debug.clouds.cloudsPass.currentMaterial.uniforms;
      res.uni[tag] = { on: u.gTsunOn?.value ?? null, ref: u.gTsunRef ? u.gTsunRef.value.toArray() : null, tex: !!u.gTsunTex };
      res.defs[tag] = { ...v.debug.clouds.cloudsPass.currentMaterial.defines };
    }
  }
  // ── U6c: 팔 × 진단 × 품질 × 얼음 × 확산 × grain
  const GR = { off: { refineOnHit: 0, sunLowpass: 0, erodeCentered: 0, jitterMode: 0 }, all: { refineOnHit: 1, sunLowpass: 1, erodeCentered: 2, jitterMode: 1 } };
  res.u6c = [];
  for (const q of ['low', 'medium', 'high']) {
    for (const [an, ao] of Object.entries(cfg.arms) as [string, any][]) {
      const v = await mk({ ...ao }, q);
      v.setScene(inp(cfg.iso.tw));
      for (const dbg of [0, 1]) for (const ice of [false, true]) for (const diffuse of [0, 1]) for (const [gn, go] of Object.entries(GR)) {
        if (dbg && an === 'C0ps') continue;
        v.setOptions({ ...go, iceHalo: ice, diffuse, tsunDebug: dbg }, true);
        const f = v.debug.clouds.cloudsPass.currentMaterial.fragmentShader;
        let cost: any = true, tcost: any = null;
        try { const p = applyCostPatch(f); const r = HX.applyTsunCostPatch(p); tcost = r.counts;
          // 패치 뒤 출력 줄·선언 줄 수
          tcost.out = c(r.text, HX.COST_OUT_LINE_TSUN); tcost.decl = c(r.text, 'int gCostTsun = 0;');
        } catch (e: any) { cost = String(e.message); }
        res.u6c.push({ q, arm: an, dbg, ice, diffuse, grain: gn, cost, tcost, info: v.tsunInfo(),
          marks: { dDecl: c(f, M.dDecl), dAcc: c(f, M.dAcc), dOut: c(f, M.dOut), i2: c(f, M.i2), it: c(f, M.it), refMarch: c(f, TS.TSUN_REF_MARCH_HEAD), marchDir: c(f, 'vec3 gMarchDir ='),
            grainRefine: c(f, '// RULER-grain E1b'), shadowAny: c(v.debug.clouds.shadowPass.currentMaterial.fragmentShader, '§179') } });
      }
    }
  }
  // ── REF: 해 > 12° 에서 shadowMinSunDeg 12 면 글자 없음(D12), 텍스처 수
  {
    const v = await mk({ ...cfg.arms.REF, shadowMinSunDeg: 12, accurateSunBelowDeg: 12 }, 'low'); v.setScene(inp(cfg.iso.day));
    res.ref12day = { info: v.tsunInfo(), has: c(v.debug.clouds.cloudsPass.currentMaterial.fragmentShader, '§179') };
    v.setDate(new Date(cfg.iso.tw)); res.ref12tw = { info: v.tsunInfo(), has: c(v.debug.clouds.cloudsPass.currentMaterial.fragmentShader, M.i2ref) };
    // ACCURATE 강제: accurateSunBelowDeg null 이어도 REF 팔(해 ≤ 90°)이면 켬
    const w = await mk({ ...cfg.arms.REF, accurateSunBelowDeg: null }, 'low'); w.setScene(inp(cfg.iso.day));
    res.refAccurate = 'ACCURATE_SUN_SKY_LIGHT' in w.debug.clouds.cloudsPass.currentMaterial.defines;
    const c0 = await mk({ ...cfg.arms.C0ps, accurateSunBelowDeg: null }, 'low'); c0.setScene(inp(cfg.iso.day));
    res.c0Accurate = 'ACCURATE_SUN_SKY_LIGHT' in c0.debug.clouds.cloudsPass.currentMaterial.defines;
    const id0 = texId(); const a = await mk({ ...cfg.arms.C0ps }, 'low'); a.setScene(inp(cfg.iso.tw)); const id1 = texId();
    const b = await mk({ ...cfg.arms.REF }, 'low'); b.setScene(inp(cfg.iso.tw)); const id2 = texId();
    res.refTex = { off: id1 - id0, ref: id2 - id1 };
    // 실행 중 REF → 끔 = C0ps 글자
    b.setOptions({ ...cfg.arms.C0ps, shadowMinSunDeg: 90, accurateSunBelowDeg: 90 }, false);
    const d = await mk({ ...cfg.arms.C0ps, shadowMinSunDeg: 90, accurateSunBelowDeg: 90 }, 'low'); d.setScene(inp(cfg.iso.tw));
    res.refToggle = ['cloudsFrag', 'shadowFrag', 'uniforms', 'defines'].filter(k => (texts(b) as any)[k] !== (texts(d) as any)[k]);
  }
  // ── 옵션 점검
  {
    const L = (o: any) => throwsMsg(() => (TS as any).validateTsunOptions({ ...(TS as any).TSUN_OPTIONS_OFF, genus: true, diffuse: 0, ...o }));
    res.valid = { ref1: L({ tsunRef: 1 }), ref2: L({ tsunRef: 2 }), ref3: L({ tsunRef: 3 }), refT: L({ tsun: 1, tsunRef: 1 }), refDiff2: L({ tsunRef: 1, diffuse: 2 }), refArch: L({ tsunRef: 1, archLight: 1 }),
      refNoGenus: L({ tsunRef: 1, genus: false }), refStep0: L({ tsunRef: 1, tsunRefStepM: 0 }), dbg1T: L({ tsun: 1, tsunDebug: 1 }), dbg1R: L({ tsunRef: 2, tsunDebug: 1 }), dbg1None: L({ tsunDebug: 1 }),
      dbg6: L({ tsun: 1, tsunDebug: 6 }), dbg7: L({ tsunDebug: 7 }), dbg2: L({ tsun: 1, archLight: 1, tsunDebug: 2 }) };
  }
  // ── WP8 tsun-harness
  {
    const job = (o: any, extra: any = {}) => ({ name: 'j1', input: { date: '2026-10-02T17:00:00+09:00' }, options: o, ...extra });
    const knobs = { ...(TS as any).TSUN_OPTIONS_OFF };
    const tArm = { ...knobs, tsun: 1, tsunSync: true, accurateSunBelowDeg: 12 }, refArm = { ...knobs, tsunRef: 1, shadowMinSunDeg: 90, accurateSunBelowDeg: 90 };
    const miss = { ...knobs }; delete (miss as any).tsunSync;
    const T = (j: any) => throwsMsg(() => HX.checkTsunJob(j));
    res.hx = {
      img: T(job(knobs)), imgKind: HX.checkTsunJob(job(knobs)),
      dbgKind: HX.checkTsunJob(job({ ...tArm, tsunDebug: 1 }, { name: 'T1__u1__dbg1' })), costKind: HX.checkTsunJob(job(knobs, { grain: { mode: 'cost', frames: 16 }, set: 'cost', arm: 'C0', canvas: [390, 584] })),
      tKind: HX.checkTsunJob(job(tArm)), refKind: HX.checkTsunJob(job(refArm, { name: 'REF__u1' })),
      missing: T(job(miss)), noOpts: T({ name: 'x', input: {} } as any),
      unknownField: T(job(knobs, { material: { minStepSize: 1 } })), badName: T({ ...job(knobs), name: 'a/b' } as any),
      grainCapture: T(job(knobs, { grain: { mode: 'capture' } })), costDbg: T(job({ ...tArm, tsunDebug: 1 }, { name: 'x__dbg1', grain: { mode: 'cost' } })),
      // §179 검토 반영(하네스 4·12·13·16)
      refNo90: T(job({ ...knobs, tsunRef: 1 })), refAcc12: T(job({ ...refArm, accurateSunBelowDeg: 12 })), tNoAcc: T(job({ ...tArm, accurateSunBelowDeg: null })), tNoSync: T(job({ ...tArm, tsunSync: false })),
      tSmd90: T(job({ ...tArm, shadowMinSunDeg: 90 })), retiredArm: T(job(knobs, { arm: 'T1A1' })), retiredName: T(job(knobs, { name: 'T1A2__u3' })),
      frames0: T(job(knobs, { frames: 0 })), framesBig: T(job(knobs, { frames: 1e9 })), res7: T(job(knobs, { res: 7 })), noInput: T({ name: 'x', options: knobs } as any), badDate: T(job(knobs, { input: { date: 'x' } })),
      frame0: T(job(knobs, { grain: { mode: 'cost', frame0: 3 } })), crop: T(job(knobs, { grain: { mode: 'cost', crop: [0, 0, 8, 8] } })),
      dbgName: T(job({ ...tArm, tsunDebug: 1 }, { name: 'T1__u1' })), imgDbgName: T(job(knobs, { name: 'x__dbg1' })),
      decode: [0, 1, 2, 3, 2046, 2047, 0.5, 2049, 2050, 4000].map(a => HX.decodeCostA(a)),
      expect: [HX.expectInjected({ tsun: 1 }, true), HX.expectInjected({ tsun: 1 }, false), HX.expectInjected({ tsunRef: 2 }, true), HX.expectInjected({ tsunRef: 2 }, false), HX.expectInjected({ tsun: 0, tsunRef: 0 }, true)],
      counts: [HX.expectedTsunCostCounts({ tsun: 1 }, true), HX.expectedTsunCostCounts({ tsun: 1, archLight: 1 }, true), HX.expectedTsunCostCounts({ tsun: 1, archLight: 1 }, false), HX.expectedTsunCostCounts({ tsunRef: 1 }, true)],
      keys: HX.TSUN_KNOB_KEYS, sem: HX.TSUN_KNOB_SEMANTICS,
    };
    // 비용 패치 앵커 가드: 출력 줄이 없으면 throw · 아치 줄만 있으면 throw
    const t1 = fs.readFileSync(path.join(OUT, 'T1A_tw.cloudsFrag.glsl'), 'utf8');
    res.hx.noPatchThrows = throwsMsg(() => HX.applyTsunCostPatch(t1));
    res.hx.archOnlyThrows = throwsMsg(() => HX.applyTsunCostPatch(applyCostPatch(t1).split(TS.TSUN_COUNT_LINE).join('// x')));
    // 진단 텍셀: 4 프레임 Bayer(1/4 덮음) → 칸 채우기 → PNG → ra-t 해독
    const cw = 40, ch = 28, nT = cw * ch, sB = new Float64Array(nT), sG = new Float64Array(nT), sA = new Float64Array(nT), n = new Uint16Array(nT);
    const Ttrue = (x: number, y: number) => 0.02 + 0.9 * (x / cw) * (1 - y / ch);
    for (let f = 1; f <= 4; f++) { const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; const idx = BAY.indexOf(f % 16); const bx = idx % 4, by = Math.floor(idx / 4);
      for (let Y = 0; Y < ch / 4; Y++) for (let X = 0; X < cw / 4; X++) { const x = 4 * X + bx, y = 4 * Y + by; if (x >= cw || y >= ch) continue; const j = y * cw + x; const w = 0.6; sG[j] += w; sB[j] += w * Ttrue(x, y); sA[j] += w * 1.25; n[j]++; } }
    const d = HX.debugTexels(sB, sG, n, cw, ch, sA);
    let maxErr = 0, nan = 0; for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const t = d.T[y * cw + x]; if (!Number.isFinite(t)) { nan++; continue; } maxErr = Math.max(maxErr, Math.abs(t - Ttrue(x, y))); }
    const Wc = 80, Hc = 56, png = HX.debugPngRgba(d.T, d.W, cw, ch, Wc, Hc), dec = (RAT as any).decodeDebugRgba(png, Wc, Hc);
    let maxRt = 0; for (let y = 0; y < Hc; y++) for (let x = 0; x < Wc; x++) { const tx = Math.floor((x + 0.5) * cw / Wc), tyTop = Math.floor((y + 0.5) * ch / Hc); const t = d.T[(ch - 1 - tyTop) * cw + tx]; maxRt = Math.max(maxRt, Math.abs(dec[y * Wc + x] - t) / (2 * Math.sqrt(t) / 255 + 1e-9)); }
    const zero = HX.debugTexels(new Float64Array(16), new Float64Array(16), new Uint16Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 4, 4);
    let mipErr = 0; for (let j = 0; j < nT; j++) if (Number.isFinite(d.mip[j])) mipErr = Math.max(mipErr, Math.abs(d.mip[j] - 1.25));
    res.dbgEnc = { covered: d.covered, maxErrBlock: maxErr, nan, roundTrip: maxRt, zeroW: Number.isNaN(zero.T[0]) && Number.isNaN(zero.T[5]), g: png[1], b: png[2], mipErr };
    res.rat = (RAT as any).selftest();
  }
}
` : ''}
(async () => {
  const res: any = {};
  // 기준 트리(§179 전)와 같은 길: C0ps 박명·깊은 박명·낮 글자 — [base] 가 바이트 비교(새 손잡이를 끈 값으로 명시해도 §179 전 글자).
  for (const t of ['tw', 'deep', 'day']) {
    const v = await mk(cfg.arms.C0ps, 'low'); v.setScene(inp(cfg.iso[t])); dump('C0ps_base_' + t, texts(v));
  }
  ${isCur ? 'await curTests(res);' : ''}
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(res));
})().catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
`;

function runTree(tag, tree, isCur) {
  const dir = path.join(WORK, tag); fs.mkdirSync(dir, { recursive: true });
  const ts = path.join(WORK, `harness-${tag}.ts`), cjs = path.join(WORK, `harness-${tag}.cjs`), cfgF = path.join(WORK, `cfg-${tag}.json`);
  fs.writeFileSync(ts, HARNESS(tree, isCur));
  fs.writeFileSync(cfgF, JSON.stringify({ scene: SCENE, layers: LAYERS, iso: T, arms: ARMS }));
  execFileSync('npx', ['esbuild', ts, '--bundle', '--format=cjs', '--platform=node', '--define:__DEV__=false', '--define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY="1"', `--outfile=${cjs}`, '--log-level=error'],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') } });
  execFileSync('node', [cjs, cfgF, dir], { stdio: 'inherit' });
  return { dir, res: JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')) };
}
const rd = (dir, tag, k) => fs.readFileSync(path.join(dir, `${tag}.${k}.glsl`), 'utf8');
/** GLSL 함수 하나(머리 글자부터 짝 맞는 } 까지). */
function glslFn(src, head) {
  const i = src.indexOf(head); if (i < 0) return null;
  let j = src.indexOf('{', i), d = 1, k = j + 1;
  while (d && k < src.length) { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; }
  return src.slice(i, k);
}
/** I-T 블록(표지 줄부터 else 가지 닫는 줄까지). */
function itBlock(src) {
  const i = src.indexOf('        // §179 I-T V10b'); if (i < 0) return null;
  const e = src.indexOf('\n        }\n', src.indexOf('        } else {', i));
  return e < 0 ? null : src.slice(i, e + 10);
}

// ───────────── U6a CPU 거울: gTsunRefMarch 의 줄마다 대응(글자가 바뀌면 실패 — 거울도 같이 고쳐야 함) ─────────────
const MIRROR = [
  ['float gTsunRefMarch(const vec3 p0, const vec3 dir, const float stepM, const float rangeM, const float mipLevel, const float jitter) {', 'function gTsunRefMarch(p0, dir, stepM, rangeM, mipLevel, jitter) {'],
  ['vec4 gTsunTops = maxLayerHeights * step(vec4(1e-9), densityScales);', 'let gTsunTops = { x: maxLayerHeights.x * (densityScales.x >= 1e-9 ? 1 : 0), y: maxLayerHeights.y * (densityScales.y >= 1e-9 ? 1 : 0), z: maxLayerHeights.z * (densityScales.z >= 1e-9 ? 1 : 0), w: maxLayerHeights.w * (densityScales.w >= 1e-9 ? 1 : 0) };'],
  ['float gTsunHTop = max(max(gTsunTops.x, gTsunTops.y), max(gTsunTops.z, gTsunTops.w));', 'let gTsunHTop = Math.max(Math.max(gTsunTops.x, gTsunTops.y), Math.max(gTsunTops.z, gTsunTops.w));'],
  ['int gTsunN = min(int(ceil(rangeM / stepM)), 4096);', 'let gTsunN = Math.min(Math.trunc(Math.ceil(rangeM / stepM)), 4096);'],
  ['float gTsunTau = 0.0;', 'let gTsunTau = 0.0;'],
  ['for (int gTsunI = 0; gTsunI < gTsunN; ++gTsunI) {', 'for (let gTsunI = 0; gTsunI < gTsunN; ++gTsunI) { STATS.steps++;'],
  ['vec3 gTsunP = p0 + dir * ((float(gTsunI) + jitter) * stepM);', 'let gTsunP = vadd(p0, vmul(dir, (gTsunI + jitter) * stepM));'],
  ['float gTsunH = length(gTsunP) - bottomRadius;', 'let gTsunH = vlen(gTsunP) - bottomRadius;'],
  ['if (gTsunH < 0.0) break;', 'if (gTsunH < 0.0) { STATS.ground++; break; }'],
  ['if (gTsunH > gTsunHTop && dot(gTsunP, dir) > 0.0) break;', 'if (gTsunH > gTsunHTop && vdot(gTsunP, dir) > 0.0) { STATS.top++; break; }'],
  ['vec2 gTsunUv = getGlobeUv(gTsunP);', 'let gTsunUv = getGlobeUv(gTsunP);'],
  ['WeatherSample gTsunWs = sampleWeather(gTsunUv, gTsunH, mipLevel);', 'let gTsunWs = sampleWeather(gTsunUv, gTsunH, mipLevel);'],
  ['if (!any(greaterThan(gTsunWs.density, vec4(minDensity)))) continue;', 'if (!(Math.max(...gTsunWs.density) > minDensity)) continue;'],
  ['MediaSample gTsunMs = sampleMedia(gTsunWs, gTsunP, gTsunUv, mipLevel, jitter);', 'let gTsunMs = sampleMedia(gTsunWs, gTsunP, gTsunUv, mipLevel, jitter); STATS.media++;'],
  ['gTsunTau += gTsunMs.extinction * stepM;', 'gTsunTau += gTsunMs.extinction * stepM;'],
  ['}', '}'],
  ['return gTsunTau;', 'return gTsunTau;'],
];
function mirrorOf(fn) {
  const map = new Map(MIRROR);
  const lines = fn.split('\n').map(l => l.trim()).filter(Boolean);
  const bad = lines.filter(l => !map.has(l));
  if (bad.length) throw new Error('gTsunRefMarch 글자가 거울과 다름: ' + bad.slice(0, 3).join(' | '));
  return lines.map(l => map.get(l)).join('\n');
}
function slabEnv({ R = 6360e3, hb, ht, sigma, minDensity = 1e-5, emptyTop = 0 }) {
  const STATS = { steps: 0, ground: 0, top: 0, media: 0 };
  // 레인 1 = 밀도 0(densityScales 0) 인 빈 레인 — 꼭대기 emptyTop(앱이 남겨 두는 7.5~11 km)이 행진 끝을 늘리지 않아야 함(검토 물리 11)
  const env = {
    STATS, bottomRadius: R, minDensity, maxLayerHeights: { x: ht, y: emptyTop, z: 0, w: 0 }, densityScales: { x: 1, y: 0, z: 0, w: 0 },
    vadd: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], vmul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], vlen: a => Math.hypot(a[0], a[1], a[2]), vdot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    getGlobeUv: p => p,
    sampleWeather: (uv, h) => ({ density: [h >= hb && h <= ht ? 0.5 : 0, 0, 0, 0] }),
    sampleMedia: ws => ({ extinction: ws.density[0] > 0 ? sigma : 0 }),
  };
  return env;
}
/** 구면 껍질 [hb, ht](m) 안에 머무는 길이(m) — 높이 h0 에서 사인 sinE 로 D 까지 곧은 선(cloudTsun gTsunPath 와 같은 닫힌 꼴, 독립 구현). */
function shellPath(h0, sinE, hb, ht, D, R) {
  const r0 = R + h0, b = r0 * sinE;
  const seg = rr => { const disc = b * b + rr * rr - r0 * r0; if (disc <= 0) return 0; const q = Math.sqrt(disc); return Math.max(0, Math.min(-b + q, D) - Math.max(-b - q, 0)); };
  return Math.max(0, seg(R + ht) - seg(R + hb));
}
function runMirror(js, env, args) {
  const f = new Function(...Object.keys(env), js + '\nreturn gTsunRefMarch;')(...Object.values(env));
  return f(...args);
}

// ───────────────────────── 실행 ─────────────────────────
(async () => {
  console.log(`[a] 묶기 — 지금 트리와 기준 트리(${BASE_REV}) (작업 폴더 ${WORK})`);
  const BASE_TREE = path.join(WORK, 'base-tree');
  fs.rmSync(BASE_TREE, { recursive: true, force: true }); fs.mkdirSync(BASE_TREE, { recursive: true });
  execFileSync('bash', ['-c', `git -C "${ROOT}" archive "${BASE_REV}" src | tar -x -C "${BASE_TREE}"`]);
  // 검토 회귀 2: 기준 트리가 §179 를 품으면 '끈 = §179 전' 비교가 뜻이 없음 — 멈춤
  if (fs.existsSync(path.join(BASE_TREE, 'src/components/VolumetricProbe/cloudTsun.ts'))) { console.error(`기준 트리 ${BASE_REV} 에 cloudTsun.ts 가 있음 — §179 전 커밋(${PRE179})을 쓰세요`); process.exit(2); }
  const B = runTree('base', BASE_TREE, false);
  const Cu = runTree('cur', ROOT, true);
  ok(true, 'esbuild 묶기·가짜 렌더러 실행(두 트리)');
  const R = Cu.res;

  console.log(`\n[base] C0ps 글자 = §179 전 트리(${BASE_REV})`);
  {
    const same = ['tw', 'deep', 'day'].map(t => ['cloudsFrag', 'shadowFrag', 'uniforms', 'defines'].filter(k => rd(Cu.dir, 'C0ps_base_' + t, k) !== rd(B.dir, 'C0ps_base_' + t, k)).map(k => t + '.' + k)).flat();
    ok(same.length === 0, `C0ps(새 손잡이 9 개를 끈 값으로 명시) 박명·깊은 박명·낮: 구름·그림자 글자·균일변수 이름·define = ${BASE_REV}` + (same.length ? ' — 다름 ' + same.join(',') : ''));
  }

  console.log('\n[reach] 2차 행진 끝 = jitter 없는 Σ 걸음(검토 물리 3)');
  {
    const fn = glslFn(rd(Cu.dir, 'T1_tw', 'cloudsFrag'), 'float gTsunReach(');
    let gr = null;
    try {
      const js = fn.replace(/^float gTsunReach\(const float mipLevel, const float jitter, const float sunRayDistance\) \{/, 'function gTsunReach(mipLevel, jitter, sunRayDistance) {')
        .replace('int n = int(max(0.0, remap(mipLevel, 0.0, 1.0, float(maxIterationCountToSun + 1), 1.0) - jitter));', 'let n = Math.trunc(Math.max(0.0, remap(mipLevel, 0.0, 1.0, maxIterationCountToSun + 1, 1.0) - jitter));')
        .replace('float s0 = minSecondaryStepSize / float(max(n, 1));', 'let s0 = minSecondaryStepSize / Math.max(n, 1);')
        .replace('return n > 0 ? sunRayDistance + s0 * pow(secondaryStepScale, float(n - 1)) - s0 * jitter : 0.0;', 'return n > 0 ? sunRayDistance + s0 * Math.pow(secondaryStepScale, n - 1) - s0 * jitter : 0.0;');
      if (/float|int |pow\(|vec/.test(js.replace(/Math\.pow/g, ''))) throw new Error('gTsunReach 글자가 거울과 다름: ' + fn.slice(0, 200));
      gr = (env) => new Function(...Object.keys(env), js + '\nreturn gTsunReach;')(...Object.values(env));
    } catch (e) { ok(false, String(e.message)); }
    if (gr) {
      // takram marchOpticalDepth 의 걸음(셰이더와 같은 식)으로 sunRayDistance 를 만들고, 끝 = Σ 걸음인지 · 고른 σ 의 추정 기댓값 = σ·끝인지
      const s0m = 250, scale = 1.6, maxN = 6, remap = (x, a, b, c, d) => c + (x - a) * (d - c) / (b - a);
      const f = gr({ remap, maxIterationCountToSun: maxN, minSecondaryStepSize: s0m, secondaryStepScale: scale });
      let worst = 0, worstMC = 0, zero = null; const rows = [];
      for (const mip of [0, 0.3, 0.6, 0.85, 0.99]) {
        let mcSum = 0, mcN = 0, reachN = null;
        for (let k = 0; k < 64; k++) {
          const jitter = (k + 0.5) / 64;
          const n = Math.trunc(Math.max(0, remap(mip, 0, 1, maxN + 1, 1) - jitter));
          if (n === 0) { zero = f(mip, jitter, NaN); continue; }
          let step = s0m / n, next = step * jitter, rd2 = 0, tau = 0;
          for (let i = 0; i < n; i++) { rd2 = next; tau += 1e-3 * step; next += step; step *= scale; }
          const exact = (s0m / n) * (Math.pow(scale, n) - 1) / (scale - 1);
          const got = f(mip, jitter, rd2);
          worst = Math.max(worst, Math.abs(got - exact) / exact);
          if (reachN === null) reachN = n;
          mcSum += tau / (1e-3 * got); mcN++;
        }
        if (mcN) { worstMC = Math.max(worstMC, Math.abs(mcSum / mcN - 1)); rows.push(`mip ${mip}: ${mcN} 지터`); }
      }
      ok(worst < 1e-12, `gTsunReach(주입 글자에서 옮김) = Σ_k step_k = s0·(scale^n − 1)/(scale − 1)(jitter 와 무관) — 최대 상대 차 ${worst.toExponential(2)}`);
      ok(worstMC < 1e-12 && (zero === 0 || zero === null), `고른 σ: takram 2차 행진 τ = σ × 끝(지터마다 — 처음 판은 s0·jitter 만큼 길었음) · 걸음 0 이면 0(sunRayDistance 를 읽지 않음, NaN 을 넘겨도 ${zero})`);
    }
  }

  console.log('\n[REF] 글자 구조·균일변수·상태');
  {
    const ref = rd(Cu.dir, 'REF_tw', 'cloudsFrag'), val = rd(Cu.dir, 'REF_val_tw', 'cloudsFrag'), c0 = rd(Cu.dir, 'C0ps_tw', 'cloudsFrag');
    const samplers = s => [...s.matchAll(/uniform\s+(?:\w+\s+)?sampler\w+\s+(\w+)\s*;/g)].map(m => m[1]).sort().join();
    ok(samplers(ref) === samplers(c0) && samplers(val) === samplers(c0) && !/gTsunTex/.test(ref + val), 'REF_v2·REF_val: 샘플러 선언이 C0ps 와 같음(gTsunTex 없음 — WP0 한도 무관)');
    ok(count(ref, 'uniform float gTsunOn;') === 1 && count(ref, 'uniform vec4 gTsunRef;') === 1 && !/uniform\s+\w+\s+gTsun(Frame|LaneBlock|Epoch|Cond)/.test(ref + val) && !/gArch/.test(ref + val), 'REF 균일변수 = gTsunOn · gTsunRef 뿐(아틀라스·아치 없음)');
    ok(count(ref, 'sunIrradiance *= exp(-gTsunTau);') === 1 && count(ref, 'gTsunRefMarch(gTsunEnd, sunDirection, gTsunRef.x, gTsunRef.y, 0.0, jitter)') === 1 && count(ref, 'gTsunRefMarch(gTsunTopP, sunDirection, gTsunRef.z, gTsunRef.y, 0.0, jitter)') === 1 && count(ref, 'opticalDepth += gTsun') === 0
      && count(ref, 'mix(minLayerHeights, maxLayerHeights, gTsunMu0 >= 0.0 ? 1.0 : 0.02)') === 1,
      'REF_v2: p_end 너머 무차별 τ(mip 0 — 검토 물리 5)를 sunIrradiance 에 Beer · T_top 은 레인 꼭대기(μ0 < 0 이면 hf 0.02 — 검토 물리 7)에서 gTsunRef.z 보폭 · opticalDepth 에 안 더함');
    ok(count(val, 'gTsunRef.x, gTsunRef.y, 0.0, jitter);') === 1 && count(ref + val, 'gTsunRef.y, mipLevel, jitter)') === 0, 'REF_val 도 mip 0(같은 행진 함수, 부르는 인자만)');
    ok(count(val, 'opticalDepth += gTsunTauV;') === 1 && count(val, '§179 I-T') === 0 && count(val, R_IT_ANCHOR) === 1 && count(val, 'sunIrradiance *=') === 0, 'REF_val: τ 를 opticalDepth 에(옥타브·역광) · I-T 없음 · thru 줄 그대로 · sunIrradiance 안 바꿈');
    const i2 = ref.indexOf('// §179 I-2 REF_v2'), ms = ref.indexOf('      vec3 radiance = sunIrradiance * approximateMultipleScattering(opticalDepth, cosTheta);'), bsm = ref.indexOf('opticalDepth += sampleShadowOpticalDepth(');
    ok(i2 > bsm && ms > i2, 'REF I-2 는 BSM 줄 뒤 · MS 줄 앞(2차 행진 [0, reach] 그대로 쓰고 그 끝에서 시작)');
    ok(R.info.REF_day.injected && R.info.REF_tw.injected && R.info.REF_deep.injected && R.info.REF_day.belowShadow === true && R.info.REF_day.ref === 1 && !R.info.REF_day.atlasValid, 'REF(shadowMinSunDeg 90): 낮·박명·깊은 박명 모두 글자 있음(BSM 꺼짐) · tsunInfo ref 1 · 아틀라스 없음');
    ok(R.ref12day.info.injected === false && R.ref12day.has === 0 && R.ref12tw.info.injected === true && R.ref12tw.has === 1, 'D12: REF 손잡이 + shadowMinSunDeg 12 면 해 29.6° 에서 글자 없음(injected false — entry-tsun 이 거부), 6.8° 에서 있음');
    const u = R.uni;
    ok(u.REF_tw.on === 1 && u.REF_tw.ref.join() === '200,400000,1000,0' && u.REF100_tw.ref.join() === '100,400000,1000,0' && !u.REF_tw.tex && u.REF_val_tw.on === 1, `균일변수: gTsunOn 1 · gTsunRef ${u.REF_tw.ref} · REF100 ${u.REF100_tw.ref} · 텍스처 균일변수 없음`);
    ok(R.refAccurate === true && R.c0Accurate === false, 'REF 팔은 accurateSunBelowDeg 를 안 줘도 해 ≤ shadowMinSunDeg 에서 ACCURATE_SUN_SKY_LIGHT(C0ps 같은 조건은 낮에 꺼짐)');
    ok(R.refTex.off === R.refTex.ref, `REF 는 텍스처를 새로 만들지 않음(만든 수 C0ps ${R.refTex.off - 1} · REF ${R.refTex.ref - 1})`);
    ok(R.refToggle.length === 0, '실행 중 REF → 끔: 구름·그림자 글자·균일변수·define = 같은 옵션의 새 장면' + (R.refToggle.length ? ' — 다름 ' + R.refToggle.join(',') : ''));
    const v = R.valid, thr = k => typeof v[k] === 'string', none = k => v[k] === null;
    ok(['ref1', 'ref2', 'dbg1T', 'dbg1R'].every(none), 'tsunRef 1·2 · tsunDebug 1(T·REF) 통과(구현됨)');
    ok(['ref3', 'refT', 'refDiff2', 'refArch', 'refNoGenus', 'refStep0', 'dbg1None', 'dbg6', 'dbg7', 'dbg2'].every(thr), 'throw: tsunRef 3 · tsun+tsunRef · REF+diffuse 2 · REF+archLight · genus 없음 · 보폭 0 · 진단 1 혼자 · 진단 6·7·2(미구현) — ' + String(v.dbg6).slice(0, 70));
  }

  console.log('\n[U6a] 균일 판 탐침(CPU 거울)');
  {
    const fn = glslFn(rd(Cu.dir, 'REF_tw', 'cloudsFrag'), 'float gTsunRefMarch(');
    let js = null;
    try { js = mirrorOf(fn); ok(true, `gTsunRefMarch ${fn.split('\n').length} 줄이 거울 표와 줄마다 같음`); } catch (e) { ok(false, e.message); }
    if (js) {
      const R0 = 6360e3, hb = 1000, ht = 1500, dh = ht - hb, h0 = 800;
      let worst = 0, worstJ = 0, worstTau = 0, n = 0, nGate = 0; const rows = [], coarse = [];
      for (const thDeg of [5, 10, 20, 45]) for (const tau0 of [0.3, 1, 2]) for (const step of [200, 100]) {
        const th = thDeg * Math.PI / 180, sigma = tau0 * Math.sin(th) / dh;
        const env = slabEnv({ R: R0, hb, ht, sigma });
        const p0 = [0, 0, R0 + h0], dir = [Math.cos(th), 0, Math.sin(th)];
        let sT = 0, sTau = 0, jmax = 0;
        const J = 16;
        for (let k = 0; k < J; k++) { const tau = runMirror(js, env, [p0, dir, step, 400e3, 0, (k + 0.5) / J]); sT += Math.exp(-tau); sTau += tau; jmax = Math.max(jmax, Math.abs(Math.exp(-tau) / Math.exp(-tau0) - 1)); }
        const Tm = sT / J, rel = Math.abs(Tm / Math.exp(-tau0) - 1), stepsAcross = dh / Math.sin(th) / step;
        // 층화 지터 16 칸: 판 경계 둘 × 칸 반 폭(step/J/2)이 이산화 한계 — |평균 τ − σ·L| / (σ·step/J) ≤ 1 이면 치우침 없음.
        worstTau = Math.max(worstTau, Math.abs(sTau / J - sigma * shellPath(h0, Math.sin(th), hb, ht, 400e3, R0)) / (sigma * step / J)); n++;
        // 문 = 판을 가로지르는 걸음 ≥ 5(그보다 성기면 지터 평균 T 가 젠센 치우침 — 보고만, 판 탐침 기하 조건으로 남김)
        if (stepsAcross >= 5) { worst = Math.max(worst, rel); worstJ = Math.max(worstJ, jmax); nGate++; } else coarse.push(`${thDeg}°/τ${tau0}/${step} m(${stepsAcross.toFixed(1)} 걸음) ${(rel * 100).toFixed(1)} %`);
        rows.push(`${thDeg}°/τ${tau0}/${step}m ${(rel * 100).toFixed(2)}%`);
      }
      ok(n === 24 && nGate >= 18 && worst <= 0.05, `REF T(지터 16 층 평균) vs exp(−σΔh/sinθ): 판을 ≥ 5 걸음에 가로지르는 ${nGate}/${n} 경우 최대 상대 차 ${(worst * 100).toFixed(2)} % ≤ 5 % [computed] (지터 하나 최대 ${(worstJ * 100).toFixed(1)} % — 보고)`);
      ok(worstTau <= 1, `지터 평균 τ − σ × 구면 위 판 안 경로(닫힌 꼴): 모든 ${n} 경우 ≤ 경계 둘 × 지터 칸 반 폭(σ·보폭/16) — 최대 ${worstTau.toFixed(3)} × 한계(치우침 없는 적분; 평면 식과의 차는 지구 곡률, 성긴 경우의 T 차는 exp 의 젠센 치우침)`);
      console.log('     ' + rows.join(' · '));
      console.log('     보고(< 5 걸음, 문 밖): ' + (coarse.join(' · ') || '없음'));
      // 걸음·끝 조건
      const th5 = 5 * Math.PI / 180, dir5 = [Math.cos(th5), 0, Math.sin(th5)], p0 = [0, 0, R0 + h0];
      const e1 = slabEnv({ R: R0, hb, ht, sigma: 1e-4 }); runMirror(js, e1, [p0, dir5, 200, 400e3, 0, 0.5]);
      const sTop = ((ht - h0) / Math.sin(th5)) / 200;
      ok(e1.STATS.top === 1 && e1.STATS.steps <= Math.ceil(sTop) + 2 && e1.STATS.steps >= Math.floor(sTop), `해 5°: 꼭대기 ${ht} m 위로 올라가면 끝 — ${e1.STATS.steps} 걸음(2000 아님, 기대 ≈ ${sTop.toFixed(1)})`);
      const thm = -3 * Math.PI / 180, dirm = [Math.cos(thm), 0, Math.sin(thm)];
      const e2 = slabEnv({ R: R0, hb: 0, ht: 600, sigma: 1e-4 }); const tg = runMirror(js, e2, [p0, dirm, 200, 400e3, 0, 0.5]);
      const sG = (h0 / Math.sin(-thm)) / 200;
      ok(e2.STATS.ground === 1 && Math.abs(e2.STATS.steps - sG) < 3 && Number.isFinite(tg), `해 −3°: 땅에 닿으면 끝(R3) — ${e2.STATS.steps} 걸음(평면 근사 ${sG.toFixed(1)}), τ ${tg.toFixed(3)}`);
      const e3 = slabEnv({ R: R0, hb: 2000, ht: 2500, sigma: 1e-3 }); const tr = runMirror(js, e3, [p0, dir5, 200, 2000, 0, 0.5]);
      ok(tr === 0 && e3.STATS.steps === 10, `끝 거리 2 km 앞에 판이 없으면 τ 0 · 걸음 ceil(2000/200) = ${e3.STATS.steps}`);
      const e4 = slabEnv({ R: R0, hb: 0, ht: 30000, sigma: 0 }); runMirror(js, e4, [[0, 0, R0 + 100], [1, 0, 0], 100, 400e3, 0, 0.5]);
      const e5 = slabEnv({ R: R0, hb: 0, ht: 30000, sigma: 0 }); runMirror(js, e5, [[0, 0, R0 + 100], [1, 0, 0], 50, 400e3, 0, 0.5]);
      ok(e4.STATS.steps === 4000 && e5.STATS.steps === 4096, `걸음 상한: REF100 400 km = ${e4.STATS.steps}(≤ 4096) · 50 m 는 ${e5.STATS.steps} 에서 자름(R2)`);
      const e6 = slabEnv({ R: R0, hb, ht, sigma: 1e-3 }); runMirror(js, e6, [p0, dir5, 200, 400e3, 0, 0.5]);
      ok(e6.STATS.media < e6.STATS.steps && e6.STATS.media > 0, `빈 날씨(밀도 ≤ minDensity)는 sampleMedia 를 건너뜀(R1): 걸음 ${e6.STATS.steps} 중 모양 표본 ${e6.STATS.media}`);
      const e7 = slabEnv({ R: R0, hb, ht, sigma: 1e-4, emptyTop: 11000 }); const t7 = runMirror(js, e7, [p0, dir5, 200, 400e3, 0, 0.5]);
      const e8 = slabEnv({ R: R0, hb, ht, sigma: 1e-4 }); const t8 = runMirror(js, e8, [p0, dir5, 200, 400e3, 0, 0.5]);
      ok(e7.STATS.top === 1 && e7.STATS.steps === e8.STATS.steps && t7 === t8, `밀도 0 레인(densityScales 0)의 11 km 꼭대기는 끝을 늘리지 않음(검토 물리 11) — 걸음 ${e7.STATS.steps} = ${e8.STATS.steps}, τ 같음`);
    }
  }

  console.log('\n[U6b] REF_v2 와 T 팔이 같은 V10b 글자');
  {
    const ref = rd(Cu.dir, 'REF_tw', 'cloudsFrag'), t1 = rd(Cu.dir, 'T1_tw', 'cloudsFrag'), ta = rd(Cu.dir, 'T1A_tw', 'cloudsFrag'), rdbg = rd(Cu.dir, 'REF_dbg_tw', 'cloudsFrag');
    const a = itBlock(ref), b = itBlock(t1), c = itBlock(ta);
    ok(!!a && a.length > 400 && a === b && a === c && itBlock(rdbg) === a, `I-T 블록(V10b mix · Eddington · T_top · |μ0|/π · else 원래 줄) 바이트 같음 — REF_v2 · T1 · T1A · REF_v2 진단 (${a ? a.length : 0} 자)`);
    for (const fn of ['vec4 gTsunEddDiff(', 'float gTsunReach(', 'vec4 gTsunLaneSel(']) {
      const x = glslFn(ref, fn), y = glslFn(t1, fn);
      ok(!!x && x === y, `${fn.replace('(', '')} 함수 글자 같음 (${x ? x.length : 0} 자)`);
    }
    const pre = s => { const i = s.indexOf('      vec3 gTsunIrrUncut = sunIrradiance;'); return s.slice(i, s.indexOf('      if (gTsunOn > 0.5 && max(sunIrradiance', i)); };
    ok(pre(ref) === pre(t1) && pre(ref).length > 50, 'I-2 머리(gTsunIrrUncut·gTsunTtop·gTsunW·gTsunMu0 선언) 같음 — V10b 가 읽는 값의 뜻이 같음');
  }

  console.log('\n[U6d] REF_v2·REF100·REF_val 행진 함수 글자');
  {
    const f = tag => glslFn(rd(Cu.dir, tag, 'cloudsFrag'), 'float gTsunRefMarch(');
    const a = f('REF_tw'), b = f('REF100_tw'), c = f('REF_val_tw'), d = f('REF_val_dbg_tw');
    ok(!!a && a === b && a === c && a === d && count(rd(Cu.dir, 'REF_val_tw', 'cloudsFrag'), 'float gTsunRefMarch(') === 1, `gTsunRefMarch 바이트 같음(REF·REF100·REF_val·REF_val 진단, ${a ? a.length : 0} 자) · 한 번 정의`);
    ok(rd(Cu.dir, 'REF_tw', 'cloudsFrag') === rd(Cu.dir, 'REF100_tw', 'cloudsFrag'), 'REF 와 REF100 은 글자 전체가 같음(보폭은 균일변수 gTsunRef.x)');
  }

  console.log('\n[U6c] 동결 COST_PATCH 앵커 6 개 · T_sun 셈');
  {
    const bad = [];
    for (const r of R.u6c) {
      const miss = [];
      if (r.cost !== true) miss.push('cost:' + r.cost);
      const isT = r.arm.startsWith('T') || r.arm === 'H0', isA = r.arm === 'T1A' || r.arm === 'H0', isR = r.arm.startsWith('REF');
      if (r.tcost) {
        const want = { tsun: isT ? 1 : 0, archFetch: isA ? 1 : 0, archLut: isA ? 1 : 0, out: 1, decl: 1 };
        for (const [k, v] of Object.entries(want)) if (r.tcost[k] !== v) miss.push(`${k}=${r.tcost[k]}`);
      }
      const m = r.marks;
      const wantD = r.dbg ? 1 : 0;
      if (m.dDecl !== wantD || m.dAcc !== wantD || m.dOut !== wantD) miss.push(`D-1 ${m.dDecl}/${m.dAcc}/${m.dOut}`);
      if ((isT || isR) && m.i2 !== 1) miss.push('i2=' + m.i2);
      if (m.it !== ((isT || r.arm === 'REF' || r.arm === 'REF100') ? 1 : 0)) miss.push('it=' + m.it);
      if (m.refMarch !== (isR ? 1 : 0)) miss.push('refMarch=' + m.refMarch);
      if (m.marchDir !== ((isT || r.arm === 'REF' || r.arm === 'REF100') ? 1 : 0)) miss.push('gMarchDir=' + m.marchDir);
      if (r.grain === 'all' && m.grainRefine < 1) miss.push('grain 표지 없음');
      if (m.shadowAny !== 0) miss.push('shadow §179=' + m.shadowAny);
      if ((isT || isR) && !r.info.injected) miss.push('injected false');
      if (miss.length) bad.push(`${r.q}/${r.arm}/d${r.dbg}/ice${+r.ice}/f${r.diffuse}/${r.grain}: ${miss.join(' ')}`);
    }
    const nArms = Object.keys(ARMS).length;
    ok(bad.length === 0 && R.u6c.length === 3 * (nArms * 2 - 1) * 8, `${R.u6c.length} 조합(품질 3 × 팔 ${nArms} × 진단 0·1 × 얼음 × 확산 0·1 × grain 끔·전부): COST_PATCH 앵커 6 개 1 번 · T_sun 셈(T 1 · 아치 +1·+1 · REF·C0ps 0) · 출력·선언 줄 1 · D-1 표지 · gMarchDir 1 · 그림자 패스 0${bad.length ? ' — ' + bad.slice(0, 5).join(' | ') : ''}`);
    const h = R.hx;
    ok(typeof h.noPatchThrows === 'string' && typeof h.archOnlyThrows === 'string', 'T_sun 셈 앵커 가드: COST_PATCH 안 건 글자 → throw · 아치 줄만 있고 세는 줄 없음 → throw');
    const dec = h.decode.map(d => [d.cap, d.n].join('/')).join(' ');
    ok(dec.startsWith('0/0 1/0 0/1 1/1 0/1023 1/1023') && h.decode[6].cap == null && !h.decode[6].overflow && h.decode.slice(7).every(d => d.overflow && d.cap == null),
      `A 해독 cap = A mod 2, n = floor(A/2): ${dec}(정수 아니면 NaN · 2047 넘으면 overflow — 검토 하네스 10)`);
    ok(JSON.stringify(h.counts) === JSON.stringify([{ tsun: 1, archFetch: 0, archLut: 0 }, { tsun: 1, archFetch: 1, archLut: 1 }, { tsun: 0, archFetch: 0, archLut: 0 }, { tsun: 0, archFetch: 0, archLut: 0 }]), '셈 줄 기대(검토 하네스 9): T 1 · 아치 1·1 · 글자 없음 0 · REF 0');
  }

  console.log('\n[D-1] 진단(R-A_T)');
  {
    // §179 검토 반영: T 글자는 물리 고침으로 바뀌었으므로(처음 판의 '0928318 WP4 글자와 같음'은 이제 뜻이 없음) — 진단 글자에서 D-1 줄을 빼면
    // tsunDebug 0 글자와 바이트 같음(진단 주입이 다른 글자를 건드리지 않음)을 봄.
    const stripD = s => {
      const a = s.indexOf('      // §179 D-1 진단 누적'), b = s.indexOf('      radianceIntegral += transmittanceIntegral * scatteringIntegral;');
      const t = a >= 0 && b > a ? s.slice(0, a) + s.slice(b) : s;   // 누적 블록(닫는 } 포함)을 통째로
      return t.split('\n').filter(l => !/§179 D-1|gTsunDbg/.test(l)).join('\n');
    };
    const noD = (tag0, tagD) => stripD(rd(Cu.dir, tagD, 'cloudsFrag')) === stripD(rd(Cu.dir, tag0, 'cloudsFrag'));
    ok(['T1', 'T1A', 'H0', 'REF', 'REF_val'].every(a => noD(a + '_tw', a + '_dbg_tw')), '진단 글자 − D-1 줄 = tsunDebug 0 글자(T1·T1A·H0·REF·REF_val 박명) — 진단 주입은 D-1 줄만 더함');
    const d = rd(Cu.dir, 'T1_dbg_tw', 'cloudsFrag'), r = rd(Cu.dir, 'REF_dbg_tw', 'cloudsFrag');
    const acc = d.indexOf('// §179 D-1 진단 누적'), integ = d.indexOf('      radianceIntegral += transmittanceIntegral * scatteringIntegral;'), trans = d.indexOf('      float transmittance = exp(-media.extinction * stepSize);');
    ok(acc > trans && integ > acc && count(d, 'float gTsunDbgWi = transmittanceIntegral * (1.0 - transmittance);') === 1, 'D-1 누적: 적분 줄 바로 앞, wᵢ = T_앞·(1 − e^(−σΔs)) (transmittance 선언 뒤)');
    const OUTL = '  outputColor = ((any(isnan(color)) || any(isinf(color))) ? vec4(0.0) : color);';
    const out = d.lastIndexOf('outputColor = vec4(sqrt(clamp(gTsunDbgWT / max(gTsunDbgW, 1e-6), 0.0, 1.0)), gTsunDbgW, gTsunDbgWT, gTsunDbgWM);'), last = d.lastIndexOf(OUTL);
    ok(out > last && last > 0 && count(d, OUTL) === 1 && d.indexOf('outputDepthVelocity = ((any(isnan(depthVelocity))', out) > out && count(d, 'gTsunDbgWM += gTsunDbgWi * mipLevel;') === 1,
      'D-1 출력: main 마지막 색 쓰기(NaN 가드 줄) 뒤에 R √T̄ · G Σw · B Σw·T · A Σw·mip(검토 물리 5)');
    ok(count(d, 'gTsunDbgT = exp(-gTsunTau);') === 1 && count(d, 'gTsunDbgT = 1.0;') === 1 && count(r, 'gTsunDbgT = exp(-gTsunTau);') === 1 && count(rd(Cu.dir, 'REF_val_dbg_tw', 'cloudsFrag'), 'gTsunDbgT = exp(-gTsunTauV);') === 1,
      'T_beyond: T 팔 exp(−τ_atlas)(블록 없는 레인 1) · REF_v2 exp(−τ_brute) · REF_val exp(−τ_brute)');
    ok(R.info.T1_dbg_tw.debug === 1 && R.info.T1_tw.debug === 0, 'tsunInfo().debug 기록');
    const e = R.dbgEnc;
    ok(Math.abs(e.covered - 0.25) < 1e-9 && e.nan === 0 && e.maxErrBlock < 0.35 && e.roundTrip <= 1.01 && e.zeroW && e.g === Math.round(255 * 0.6) && e.b === 255 && e.mipErr < 1e-9,
      `진단 텍셀: 4 프레임 Bayer 덮음 ${e.covered} → 칸 채우기(값 없음 0, 칸 안 최대 차 ${e.maxErrBlock.toFixed(3)} — 4×4 칸 평균) · PNG ↔ ra-t 해독 ≤ 1 단계(${e.roundTrip.toFixed(2)}) · Σw = 0 → NaN · G = Σw · 평균 mip = ΣA/ΣG`);
    const rt = R.rat.filter(x => !x.ok);
    ok(rt.length === 0 && R.rat.length >= 12, `ra-t 합성 시험(창 격자·퇴화 규칙·양쪽·부호화·바닥·D3 열) ${R.rat.length - rt.length}/${R.rat.length}${rt.length ? ' — ' + rt.map(x => x.m).join(' | ') : ''}`);
  }

  console.log('\n[WP8] entry-tsun 순수 함수 · run-tsun-lib · 빌드 두 번');
  {
    const h = R.hx;
    ok(h.img === null && h.imgKind === 'image' && h.dbgKind === 'debug' && h.costKind === 'cost' && h.tKind === 'image' && h.refKind === 'image', '잡 종류: 그림 · 진단(tsunDebug 1, 이름 __dbg1) · 비용(grain.mode cost — RULER-grain 기록 필드 허용) · T 팔 · REF 팔');
    ok([h.missing, h.noOpts, h.unknownField, h.badName, h.grainCapture, h.costDbg].every(x => typeof x === 'string') && /tsunSync/.test(h.missing), '거부: 새 손잡이 하나 빠짐(A1) · 옵션 없음 · 모르는 잡 필드(material) · 이름 · grain capture 모드 · 비용 + 진단 — ' + String(h.missing).slice(0, 80));
    const thr = ['refNo90', 'refAcc12', 'tNoAcc', 'tNoSync', 'tSmd90', 'retiredArm', 'retiredName', 'frames0', 'framesBig', 'res7', 'noInput', 'badDate', 'frame0', 'crop', 'dbgName', 'imgDbgName'];
    ok(thr.every(k => typeof h[k] === 'string') && /shadowMinSunDeg 90/.test(h.refNo90) && /retired/.test(h.retiredArm), '거부(검토 하네스 4·12·13·16): REF 가 shadowMinSunDeg·accurateSunBelowDeg 90 아님 · T 팔이 C0ps + tsunSync 아님 · 옛 팔 T1A1/T1A2 · frames 0·1e9 · res 7 · input·date 없음 · grain.frame0 3 · crop · 진단 이름 __dbg1 아님 · 그림 잡이 __dbg 이름 — '
      + thr.filter(k => typeof h[k] !== 'string').join(',') + ' ' + String(h.refNo90).slice(0, 80));
    ok(h.keys.length === 9 && h.expect.join() === 'true,false,true,true,false' && h.sem === 'v2.1-r1', '새 손잡이 9 개 · 글자 기대(T 는 해 ≤ shadowMinSunDeg 에서만, REF 는 늘 — 검토 하네스 4) · 손잡이 뜻 판 기록');
    const LIB = require(path.join(ROOT, 'tools/genus-ruler/tsun/run-tsun-lib.js'));
    const pg = '100 node tools/genus-ruler/tsun/run-tsun.js --guard-tag genus-ruler/volsky/run.js j.json o 400 300\n200 bash tools/genus-ruler/grain/eval-grain.sh c0\n300 node tools/genus-ruler/grain/run-grain.js --atmos gen x\n';
    const cf = LIB.conflictingProcesses(pg, [100, 99]);
    const pg2 = '100 node run-tsun.js --guard-tag genus-ruler/volsky/run.js\n99 sh tools/genus-ruler/tsun/run-tsun.sh run b j o 400 300\n98 bash tools/genus-ruler/grain/eval-grain.sh c0 (wrapper)\n';
    const cf2 = LIB.conflictingProcesses(pg2, [100, 99, 98]);
    ok(cf.map(p => p.pid).join() === '200,300' && LIB.conflictingProcesses('100 x\n', [100]).length === 0 && LIB.conflictingProcesses('', [1]).length === 0 && cf2.map(p => p.pid).join() === '98',
      '자기 지킴: 자신·run-tsun 조상은 빼고 eval-grain.sh · run-grain.js 를 충돌로 — 조상이라도 grain 감싸개(명령 줄에 run-tsun 없음)는 충돌(검토 하네스 14b)');
    ok(LIB.SWIFTSHADER_GPU_PATTERN === 'type=gpu-process.*use-angle=swiftshader' && new RegExp(LIB.SWIFTSHADER_GPU_PATTERN).test('chrome --type=gpu-process --no-sandbox --use-angle=swiftshader --use-gl=angle'), '주인 없는 SwiftShader GPU 과정 무늬(검토 하네스 14d)');
    const fake = { '/proc/300/stat': '300 (node (x)) S 200 1 1', '/proc/200/stat': '200 (sh) S 1 1 1' };
    ok(LIB.ancestorsOf(300, f => { if (!(f in fake)) throw new Error('no'); return fake[f]; }).join() === '300,200,1', '조상: /proc/<pid>/stat 의 ppid 를 따라감(괄호 든 comm 처리)');
    ok(LIB.GRAIN_PATTERN === 'run-grain.js|eval-grain.sh|genus-ruler/volsky/run.js' && LIB.GUARD_TAG === 'genus-ruler/volsky/run.js', 'pgrep 무늬·표지 = ruler-delta B2 글자 그대로');
    const lf = path.join(WORK, 'lock-test.lock');
    fs.rmSync(lf, { force: true });
    const l1 = LIB.acquireLock(lf, { pid: 4242, alive: () => true });
    let second = null; try { LIB.acquireLock(lf, { pid: 4343, alive: p => p === 4242 }); } catch (e) { second = e.message; }
    const l3 = LIB.acquireLock(lf, { pid: 4444, alive: () => false });
    const held = JSON.parse(fs.readFileSync(lf, 'utf8')).pid;
    l1.release(); const still = fs.existsSync(lf); l3.release();
    ok(second && /held by live pid 4242/.test(second) && l3.stale && l3.stale.pid === 4242 && held === 4444 && still && !fs.existsSync(lf), '잠금: 살아 있는 pid 가 쥐면 거부 · 죽은 pid 의 잠금은 치우고 기록 · release 는 자기 잠금만 지움');
    // 검토 하네스 14c: 읽을 수 없는(빈) 잠금 — 10 초 안이면 쥔 것으로, 오래면 낡음
    fs.writeFileSync(lf, '');
    let young = null; try { LIB.acquireLock(lf, { pid: 5151, alive: () => false }); } catch (e) { young = e.message; }
    const lOld = LIB.acquireLock(lf, { pid: 5252, alive: () => false, nowMs: () => Date.now() + 60000 });
    ok(young && /unreadable/.test(young) && lOld.stale && lOld.stale.unreadable === true && JSON.parse(fs.readFileSync(lf, 'utf8')).pid === 5252 && fs.readdirSync(WORK).filter(f => /lock-test\.lock\..*\.tmp$/.test(f)).length === 0,
      '잠금: 빈 잠금은 10 초 안이면 거부(경합) · 그보다 오래면 낡음으로 치움 · 임시 파일 남기지 않음(임시 + link 로 내용째 원자적)');
    lOld.release();
    const wd = (j, o) => LIB.watchdogMs(j, 1, o) / 60000;
    const wdThrow = f => { try { f(); return null; } catch (e) { return e.message; } };
    ok(wd({ options: { tsunRef: 1, tsunRefStepM: 200 } }) === 25 && wd({ options: { tsunRef: 1, tsunRefStepM: 100 } }) === 50 && wd({ options: { tsunRef: 1, tsunDebug: 1, tsunRefStepM: 200 } }) === 8 && wd({ options: { tsunRef: 1, tsunDebug: 1, tsunRefStepM: 100 } }) === 16
      && wd({ options: { tsun: 1 } }) === 2 && wd({ options: { tsun: 1 } }, { W: 1000, H: 750 }) === 12.5 && wd({ options: {} }, { first: true }) === 2 + LIB.FIRST_JOB_EXTRA_MIN && wd({ options: {}, watchdogMin: 7 }) === 7 && LIB.watchdogMs({ options: {} }, 0.1) / 60000 === 2
      && typeof wdThrow(() => LIB.watchdogMs({ name: 'x', options: {}, watchdogMin: '30' })) === 'string' && typeof wdThrow(() => LIB.watchdogMs({ options: {} }, NaN)) === 'string',
      '감시 시간(검토 하네스 8): REF 25 · REF100 50 · REF 진단 8 × 200/보폭(REF100 진단 16) · 그 밖 2 분 × 화소 비(1000×750 → 12.5) · 페이지 첫 잡 + 5 · 잡 watchdogMin · 2 분 아래로 안 감 · 글자 watchdogMin·NaN 배율 거부');
    ok(LIB.mixedQualities([{ quality: 'low' }, {}]).length === 0 && LIB.mixedQualities([{ quality: 'high' }, { quality: 'low' }]).join() === 'high,low', '한 잡 파일 품질 섞기 거부(GROUND_BOUNCE 걸림, F4)');
    ok(LIB.duplicateNames([{ name: 'a' }, { name: 'b' }, { name: 'a' }]).join() === 'a' && LIB.duplicateNames([{ name: 'a' }, { name: 'b' }]).length === 0, '한 잡 파일 같은 이름 거부(검토 하네스 16)');
    ok(LIB.startsWithinChunk(100, 2 * 60000, 110) && !LIB.startsWithinChunk(100, 25 * 60000, 110) && !LIB.startsWithinChunk(109, 2 * 60000, 110), '덩어리 한도(검토 하네스 3): 지난 시간 + 다음 잡 감시 시간 > 한도면 시작 안 함(100 분 + REF 25 분 → 멈춤)');
    const pa = LIB.parseArgs(['--guard-tag', 'genus-ruler/volsky/run.js', 'j.json', 'o', '400', '300', 'gen'], { VROOT: '/x/b' });
    const pb = LIB.parseArgs(['j.json', 'o', '390', '520', 'load'], {});
    ok(pa.guardTag === 'genus-ruler/volsky/run.js' && pa.root === '/x/b' && pa.W === 400 && pa.atmos === 'gen' && pa.maxMin === 110 && pa.lock === '/tmp/run-tsun.lock' && pb.atmos === 'load' && pb.root === '.harness/volsky-tsun' && pb.H === 520 && pb.guardTag === null,
      '인자: jobs out W H gen, VROOT · --guard-tag · 기본 덩어리 110 분 · 잠금 /tmp/run-tsun.lock(표지 없음은 run-tsun.js 가 거부)');
    const pbad = a => wdThrow(() => LIB.parseArgs(a, {}));
    const bads = { maxNaN: ['--max-min', 'abc', 'j', 'o', '400', '300'], max0: ['--max-min', '0', 'j', 'o', '400', '300'], max200: ['--max-min', '200', 'j', 'o', '400', '300'], maxTrail: ['j', 'o', '400', '300', '--max-min'],
      w4oo: ['j', 'o', '4OO', '300'], unknown: ['--maxmin', '30', 'j', 'o', '400', '300'], atmos: ['--atmos', 'lod', 'j', 'o', '400', '300'], pos5: ['j', 'o', '400', '300', 'lod'], scale: ['--watchdog-scale', 'x', 'j', 'o', '400', '300'], extra: ['j', 'o', '400', '300', 'gen', 'zz'] };
    const notThrown = Object.entries(bads).filter(([, a]) => typeof pbad(a) !== 'string').map(([k]) => k);
    ok(notThrown.length === 0, '인자 점검(검토 하네스 3·13): --max-min abc·0·200·끝에 값 없음 · W 4OO · 모르는 깃발 · atmos lod · 다섯째 인자 · 배율 x · 남는 인자 → 거부' + (notThrown.length ? ' — 안 거부: ' + notThrown.join(',') : ''));
    // run-tsun.js 는 돌리지 않음 — 글자만: 자기 지킴이 브라우저보다 먼저, 감시·맥락 손실 종료 코드
    const rs = fs.readFileSync(path.join(ROOT, 'tools/genus-ruler/tsun/run-tsun.js'), 'utf8');
    ok(rs.indexOf('conflictingProcesses') < rs.indexOf("require('/opt/node22/lib/node_modules/playwright')") && rs.indexOf('acquireLock') < rs.indexOf('chromium.launch') && /code = 5/.test(rs) && /code = 6/.test(rs) && /process\.on\('exit', release\)/.test(rs),
      'run-tsun.js(글자): 자기 지킴·잠금이 Playwright require·Chromium 띄우기보다 먼저 · 감시 넘김 5 · 맥락 손실 6 · 끝날 때 잠금 풂');
    ok(/args\.guardTag !== L\.GUARD_TAG\) \{ console\.error/.test(rs) && rs.indexOf('args.guardTag !== L.GUARD_TAG') < rs.indexOf('acquireLock') && /captureOk !== true/.test(rs) && /mm\.captureOk === true/.test(rs) && /fixtureSha256 === FIXTURE_SHA/.test(rs)
      && /startsWithinChunk/.test(rs) && /watchdog\.txt/.test(rs) && /duplicateNames/.test(rs) && /bundle\.json/.test(rs) && /results\.json/.test(rs) && /PLAYWRIGHT_VERSION/.test(rs) && /SWIFTSHADER_GPU_PATTERN/.test(rs) && /clearOutputs\(job\)/.test(rs),
      'run-tsun.js(글자, 검토 하네스 2·3·5·6·8·14·15·16): 표지 없으면 거부 · 실패 잡은 그림·meta 안 씀·옛 출력 지움 · 이어 그리기는 captureOk·고정표 sha 까지 · 다음 잡 감시 시간으로 한도 · 감시 표지 · 같은 이름 · bundle.json · results.json · playwright 판 · SwiftShader 과정');
    const es = fs.readFileSync(path.join(ROOT, 'tools/genus-ruler/tsun/entry-tsun.ts'), 'utf8');
    ok(/clouds\.frame = 0/.test(es) && /GROUND_BOUNCE is latched/.test(es) && /shadowTopHeight\.value = 0/.test(es) && /ToneMappingMode\.LINEAR/.test(es) && /applyTsunCostPatch\(applyCostPatch\(text\)\)/.test(es) && /atlasValid/.test(es) && /sha256Hex\(bytes\)/.test(es),
      'entry-tsun(글자): 프레임 0 · GROUND_BOUNCE 걸림 throw · shadowTopHeight 되돌림 · 진단 LINEAR · 동결 COST_PATCH 위 T_sun 셈 · 아틀라스 유효 확인 · 고정표 sha 대조');
    ok(/onShaderError/.test(es) && /brokenPrograms\(\)/.test(es) && /shader compile\/link failed/.test(es) && /meta\.glError === 0/.test(es) && /installTsunShader\(\)/.test(es) && /buildTsunAtlasForJob/.test(es) && /activeSamplers\(clouds\.cloudsPass\.currentMaterial\)/.test(es)
      && /expectedTsunCostCounts/.test(es) && /REF arm without REF text/.test(es) && /cost-tsun\.f16/.test(es) && /acc\.overflow/.test(es),
      'entry-tsun(글자, 검토 하네스 1·4·7·9·10·18 · 회귀 1·4): 셰이더 오류 = 잡 실패 · captureOk 에 glError · 셰이더 글자 설치 · 잡마다 한 번 구축 · 실제 활성 샘플러 · 셈 줄 대조 · REF 글자 없으면 throw · cost-tsun.f16 · 넘침 셈');
    // 빌드 두 번(.harness 아님)
    const bdir = path.join(WORK, 'bundle');
    fs.rmSync(bdir, { recursive: true, force: true });
    let bj = null;
    try { execFileSync('sh', [path.join(ROOT, 'tools/genus-ruler/tsun/run-tsun.sh'), 'build', bdir], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] }); bj = JSON.parse(fs.readFileSync(path.join(bdir, 'bundle.json'), 'utf8')); } catch (e) { bj = { err: String(e.message) }; }
    const size = bj && bj.same ? fs.statSync(path.join(bdir, 'app.js')).size : 0;
    ok(bj && bj.same === true && /^[0-9a-f]{64}$/.test(bj.bundleSha256) && size > 100000, `run-tsun.sh build: 두 번 묶어 sha 같음 ${bj && bj.bundleSha256 ? bj.bundleSha256.slice(0, 16) : JSON.stringify(bj)} (${(size / 1e6).toFixed(2)} MB, esbuild ${bj && bj.esbuild}) → ${bdir}`);
    const app = size ? fs.readFileSync(path.join(bdir, 'app.js'), 'utf8') : '';
    ok(app.includes('I-2 REF_v2') && app.includes('float gTsunRefMarch(') && app.includes('D-1') && app.includes('READY::'), '번들에 REF 글자·진단·entry 가 들어감');
    // 동결 파일
    const frozen = ['tools/genus-ruler/grain', 'tools/genus-ruler/volsky/entry.ts', 'tools/genus-ruler/volsky/capture.ts', 'tools/genus-ruler/tsun/RULER-tsun.md', 'tools/genus-ruler/tsun/tsun_photo.py', 'tools/genus-ruler/tsun/tsun-photo.json', 'tools/genus-ruler/tsun/tsun-geo.json',
      'tools/genus-ruler/tsun/scenes-tsun.json', 'tools/genus-ruler/tsun/sun-tsun.cjs', 'tools/genus-ruler/tsun/sun-tsun.json', 'tools/genus-ruler/tsun/make-jobs-tsun.py', 'tools/genus-ruler/tsun/tsun-baseline.json', 'tools/genus-ruler/tsun/tsun-test.py'];
    const st = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', ...frozen], { encoding: 'utf8' }).trim();
    // 검토 회귀 2: 스냅샷 커밋 안의 고침도 보게 §179 전 커밋부터의 차
    const df = execFileSync('git', ['-C', ROOT, 'diff', '--name-only', PRE179, '--', ...frozen, 'tools/genus-ruler/volsky/capture-core.ts', 'tools/genus-ruler/volsky/run.js', 'docs'], { encoding: 'utf8' }).trim();
    ok(st === '' && df === '', `동결 파일(grain/** · volsky entry·capture* · RULER-tsun 동결 후보 자료 · docs) 작업 트리 그대로 · ${PRE179} 부터 커밋된 고침 없음` + (st || df ? ' — ' + (st + '\n' + df).trim().split('\n').slice(0, 4).join(', ') : ''));
    const appFiles = ['src/components/SkyScene3D/SkyScene3D.tsx', 'src/components/VolumetricProbe/VolumetricProbe.tsx', 'src/store/useCelestialStore.ts', 'src/components/SkyScreen/DevTuningPanel.tsx'];
    const hits = appFiles.filter(f => fs.existsSync(path.join(ROOT, f)) && /\b(tsunRef|tsunDebug|tsunRefStepM|entry-tsun|tsun-harness)\b/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    ok(hits.length === 0, '앱 길이 REF·진단 손잡이를 넘기지 않음' + (hits.length ? ' — ' + hits.join(', ') : ''));
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} pass / ${fail} fail (작업 폴더 ${WORK})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
