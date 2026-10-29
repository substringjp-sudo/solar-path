/**
 * §179 T_sun 셰이더 주입(cloudTsun.ts · WP0 + WP4) 합격 판정 — 브라우저 없음(RULER-grain C0 렌더와 함께 돌아도 됨: GPU·Chromium 안 씀).
 * esbuild 로 앱의 createVolumetricScene 을 묶어 **가짜 렌더러**(GL 호출 없음)로 돌리고 셰이더 글자·균일변수·define 만 봅니다(그리지 않음) —
 * verify-lighting-fixes.js 와 같은 방식.
 *   node tools/shader-preview/verify-tsun-shader.js [--base e0f93f2] [--work DIR]
 * 임시 출력은 os.tmpdir()(TMPDIR) 아래 새 폴더(--work 로 바꿈). 비교 기준 트리(--base, 기본 e0f93f2 = §179 전 마지막 커밋)는 git archive 로 꺼냅니다.
 * §179 검토 반영(회귀 2): 처음 판의 기본 HEAD 는 이제 §179 스냅샷 — 기준 트리에 cloudTsun.ts 가 있으면 멈춤(종료 2).
 *
 *  [byte] 끄면 그대로: tsun 0(옵션을 안 넘김 · TSUN_OPTIONS_OFF 를 명시) — 구름 조각·정점·그림자 조각·정점·대기 효과·EffectPass 합친 글자 ·
 *         두 재질의 균일변수 이름 **과 값** · define · 효과 값(ACCURATE·층·해상도) · 만든 텍스처 수가 기준 트리와 바이트 같음.
 *         low·medium·high × 낮 29.6°·박명 6.8°·깊은 박명 −9.8° × 변형 19(없음 · §178 고침 · 확산 1·2·3·9 · debugLightFloors · 얼음 · 얼음+가루 끔 ·
 *         물리+물리 얼음 · 뼈대 1·3 · grain 전부 · erode 1 + 화소각 · debugDensityMul · C0ps · macro 0 · shadowMinSunDeg 90 · 모두), 거시 고리 입력 켬 ·
 *         setDate 쓸기(낮 → 17:40 → −9.8° → 박명 → 낮, 앱 setOptions 키·품질 바꿈) · SkyScene3D·VolumetricProbe 길 흉내(검토 회귀 3 — rev-byte.js 를 옮김).
 *  [bundle] 앱 묶음(volumetricScene.ts 축소, three·postprocessing·takram 밖)에 하네스 글자(구축기·셰이더 글자)가 없음, 크기 차 기록(검토 회귀 1).
 *  [U0a] 정적 활성 샘플러 수(만든 글자를 define 으로 전처리 → main 에서 닿는 함수의 texture 계열 호출 — §177.6 h samplers.py 를 옮김):
 *         낮 끈 상태 low 12 · medium 13 · high 15 [§177.6 h], C0ps 박명 = TSUN_CLOUD_SAMPLERS, T 켬 = 그 + 1(더한 것은 gTsunTex 하나), 그림자 패스 그대로.
 *  [U0b] MAX_TEXTURE_IMAGE_UNITS 보다 많으면 throw(만들 때 · setOptions · setQuality — 상태를 안 바꿈), 모르면 16 으로 봄, readCapabilities 가 읽음.
 *  [U4a] 표지·앵커 수: 품질 3 × 얼음 2 × 확산 0·1 × grain 손잡이 7 가지 × T·아치 — 구름 조각 주입점마다 정확히 한 번, 그림자 조각 0 번,
 *         gMarchDir 선언 하나, 세는 줄 하나, 비용 변형(capture.ts applyCostPatch, 동결 — 앵커 6 개 정확히 한 번)이 걸림 · grain 표지 그대로.
 *  [U4b] 손잡이를 끄면(실행 중 tsun 1 → 0, 박명 → 낮) 글자·균일변수가 C0ps 와 같음.
 *  [U4c] 끄면 gTsun…·gArch… 균일변수 없음 · 텍스처를 새로 만들지 않음(three 텍스처 id 셈) · 아틀라스를 걸어도 끈 재질은 그대로.
 *  [U4d] diffuse ≥ 2 + tsun → throw (만들 때·setOptions), 다른 점검(값 범위·의존·REF/진단 미구현·genus).
 *  [U4e] gTsunOn = 0 가지(else)에 원래 thru 줄이 글자 그대로.
 *  [U4g] T 팔의 해 > 12° 글자 = C0ps 글자(구름·그림자·정점·균일변수·define), 낮 → 박명 → 낮 왕복.
 *  [atlas] setTsunAtlas: 균일변수 값 · 옵션/장면 불일치 throw · 옵션을 바꾸면 무효(gTsunOn 0) · applyScene 이 버림 · 아치 무게 w(θ).
 *  [glsl] u_true(gTsunPath)를 주입 글자에서 그대로 옮겨(GLSL → JS) 5 m 무차별 적분과 대조, 괄호 균형, 선언 전 사용 없음(도움 함수 순서) ·
 *         조각 보간(gTsunSliceTau·gTsunPathW·gTsunGL4·gTsunLam)과 τ_c 표(gTsunCondAt)를 글자에서 옮겨 CPU 거울(tsunAtlas.ts)과 대조(§179 검토 반영) ·
 *         아치 옥타브 정적 단언.
 */
const path = require('path'); const os = require('os'); const fs = require('fs'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const PRE179 = 'e0f93f2';
const BASE_REV = arg('--base', PRE179);
const WORK = arg('--work', null) ? path.resolve(arg('--work')) : fs.mkdtempSync(path.join(os.tmpdir(), 'tsun-shader-'));
fs.mkdirSync(WORK, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const count = (s, a) => s.split(a).length - 1;

const JST = s => s + '+09:00';
const T = { day: JST('2026-10-02T15:00:00'), tw: JST('2026-10-02T17:00:00'), deep: JST('2026-10-02T18:22:21'), gh: JST('2026-10-02T17:40:00') };   // 후쿠이 P1: 29.6° · 6.8° · −9.8° (§178 defects) · 17:40
const LAYERS = [{ genus: 'sc', cover: 0.45, baseKm: 1.5, thicknessM: 750, band: 'low', opts: { seed: 4242 } }, { genus: 'ac', cover: 0.4, baseKm: 4.0, band: 'mid', opts: { seed: 5 } }, { genus: null, cover: 0, baseKm: 7.5, band: 'high' }, { genus: 'ci', cover: 0.3, baseKm: 9.0, band: 'high', opts: { seed: 77 } }];
const SCENE = { lat: 36.046, lon: 136.278, heightM: 23, az: 272, el: 10, fov: 60 };
const GRAIN_ALL = { refineOnHit: 1, sunLowpass: 1, erodeCentered: 2, jitterMode: 1 };
const VARIANTS = {
  plain: {}, fix178: { clampInscatter: true, irradianceLogMu: true }, diff1: { diffuse: 1 }, diff2: { diffuse: 2 }, diff3: { diffuse: 3 }, diff9: { diffuse: 9 },
  floors: { debugLightFloors: [0.1, 0.2] }, ice: { iceHalo: true }, icePow: { iceHalo: true, icePowderOff: true }, phys: { physics: true, physicsIce: true },
  skel1: { skeleton: 1 }, skel3: { skeleton: 3 }, grain: GRAIN_ALL, erode1: { erodeCentered: 1, erodePixelAngleDeg: 0.03 }, dmul: { debugDensityMul: 0.2 },
  c0ps: { accurateSunBelowDeg: 12 }, macro0: { macro: 0 }, smd90: { shadowMinSunDeg: 90 },
  all: { clampInscatter: true, irradianceLogMu: true, diffuse: 1, iceHalo: true, accurateSunBelowDeg: 12, ...GRAIN_ALL },
};
// 거시 고리 입력(검토 회귀 3 — rev-byte.js 와 같은 고리) — 끈 길 비교에만
const RING = Array.from({ length: 24 }, (_, i) => ({ distance: 30 + (i % 4) * 60, azimuthOffset: i * 15, cover: 0.2 + 0.6 * ((i * 7) % 10) / 10 }));
const OFF_RUNS = [];
for (const q of ['low', 'medium', 'high']) for (const t of ['day', 'tw', 'deep']) for (const [vn, vo] of Object.entries(VARIANTS)) OFF_RUNS.push({ tag: `${q}_${t}_${vn}`, quality: q, iso: T[t], options: vo });
const KINDS = ['cloudsFrag', 'cloudsVert', 'shadowFrag', 'shadowVert', 'aerial', 'merged', 'uniforms', 'uniformValues', 'defines', 'effect'];
/** setDate 쓸기·앱 길 흉내 dump 이름(두 트리 같은 길 — 검토 회귀 3). */
const EXTRA_TAGS = [
  ...['low', 'high'].flatMap(q => [...['day', 'gh', 'deep', 'tw', 'day2'].map((k, i) => `sweep_${q}_${i}${k}`), `sweepC_${q}`]),
  ...['low', 'medium', 'high'].flatMap(q => ['day', 'tw', 'deep'].flatMap(t => [`app_${q}_${t}`, `probe_${q}_${t}`])),
];

const HARNESS = (tree, isCur) => `
import fs from 'node:fs';
import path from 'node:path';
import { DataTexture, FloatType, RGBAFormat, Texture, Vector2 } from 'three';
import { EffectComposer } from 'postprocessing';
import { createVolumetricScene, DEFAULT_VOLUMETRIC_OPTIONS${isCur ? ', readCapabilities' : ''} } from '${tree}/src/components/VolumetricProbe/volumetricScene';
${isCur ? `import * as TS from '${tree}/src/components/VolumetricProbe/cloudTsunShader';
import { applyCostPatch } from '${ROOT}/tools/genus-ruler/grain/capture';
TS.installTsunShader();   // §179 검토 반영(회귀 1): 셰이더 글자는 하네스·시험만 검` : ''}
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];
const W = 390, H = 584;
const gl = { getContextAttributes: () => ({ alpha: false }), getExtension: () => null, getParameter: () => 0 };
const mkRenderer = (maxTextures?: number): any => ({ getSize: (v: Vector2) => v.set(W, H), getDrawingBufferSize: (v: Vector2) => v.set(W, H), getPixelRatio: () => 1,
  getContext: () => gl, outputColorSpace: 'srgb-linear', autoClear: true, toneMappingExposure: 1,
  capabilities: { logarithmicDepthBuffer: false, isWebGL2: true, ...(maxTextures != null ? { maxTextures } : {}) } });
const passes: any[] = [];
const origAdd = (EffectComposer.prototype as any).addPass;
(EffectComposer.prototype as any).addPass = function (p: any, i?: number) { passes.push(p); return origAdd.call(this, p, i); };
const fakeTex = { isTexture: true } as any;
const BASEOPT = { genus: true, celestial: false, macro: 1 };
const mk = async (options: any, quality: string, maxTextures?: number, createOpts: any = {}) => {
  passes.length = 0;
  const v: any = await createVolumetricScene(mkRenderer(maxTextures), W, H, { genus: true, celestial: false, precomputed: {} as never, ...createOpts });
  const ps = passes.slice();
  v.setOptions({ ...DEFAULT_VOLUMETRIC_OPTIONS, ...BASEOPT, ...options }, false);   // 하네스·하늘 화면 길
  v.setQuality(quality);
  v.setResolutionScale(0.5);
  return { v, ps };
};
const inp = (iso: string) => ({ ...cfg.scene, date: new Date(iso), layers: cfg.layers });
const inpRing = (iso: string, ring = true) => ({ ...cfg.scene, date: new Date(iso), layers: cfg.layers, ...(ring ? { macro: { low: cfg.ring, mid: cfg.ring, high: cfg.ring } } : {}) });
/** 텍스처 id 기준(길마다 장면을 만들기 전에 잼 — 두 트리의 다른 시험이 사이에 만든 텍스처 수가 달라도 같은 값). */
let ID_BASE = 0;
const markIds = () => { ID_BASE = new Texture().id; return ID_BASE; };
/** 균일변수 값 직렬화(검토 회귀 3 — rev-byte.js ser): 벡터·행렬은 배열, 텍스처는 (id − 길 기준)·형. */
const ser = (x: any, d = 0): any => {
  if (x == null || typeof x !== 'object') return typeof x === 'number' && !Number.isFinite(x) ? String(x) : x;
  if (x.isTexture) return 'tex#' + (x.id - ID_BASE) + ':' + (x.constructor && x.constructor.name);
  if (x.isVector2 || x.isVector3 || x.isVector4 || x.isColor || x.isQuaternion) return (x.toArray ? x.toArray() : [x.x, x.y, x.z, x.w]);
  if (x.isMatrix3 || x.isMatrix4) return x.elements.slice();
  if (ArrayBuffer.isView(x)) return 'typed' + (x as any).length;
  if (Array.isArray(x)) return x.map(e => ser(e, d + 1));
  if (d > 3) return '[obj]';
  const o: any = {}; for (const k of Object.keys(x).sort()) { if (typeof x[k] === 'function') continue; o[k] = ser(x[k], d + 1); } return o;
};
const aerialOf = (ps: any[]) => { for (const p of ps) for (const e of (p.effects ?? [])) if (typeof e.getFragmentShader === 'function' && e.getFragmentShader().includes('volBaseImage')) return { pass: p, effect: e }; return null; };
const texts = (v: any, ps: any[], merged = true) => {
  const c = v.debug.clouds, a = aerialOf(ps);
  let m = '';
  if (merged && a) { try { a.pass.recompile(); m = a.pass.fullscreenMaterial.fragmentShader; } catch (e: any) { m = 'ERR ' + (e && e.message); } }
  const cm = c.cloudsPass.currentMaterial, sm = c.shadowPass.currentMaterial;
  const uv = (mat: any) => { const o: any = {}; for (const k of Object.keys(mat.uniforms).sort()) o[k] = ser(mat.uniforms[k].value); return o; };
  return { cloudsFrag: cm.fragmentShader, cloudsVert: cm.vertexShader, shadowFrag: sm.fragmentShader, shadowVert: sm.vertexShader, aerial: a ? a.effect.getFragmentShader() : '', merged: m,
    uniforms: JSON.stringify([Object.keys(cm.uniforms).sort(), Object.keys(sm.uniforms).sort()]), defines: JSON.stringify([cm.defines, sm.defines]),
    uniformValues: JSON.stringify([uv(cm), uv(sm)]),
    effect: JSON.stringify(ser({ acc: c.clouds?.accurateSunSkyLight, layers: c.cloudLayers?.map((l: any) => ({ a: l.altitude, h: l.height, d: l.densityScale, s: l.shadow })), res: c.resolutionScale })) };
};
const dump = (tag: string, t: Record<string, string>) => { for (const [k, s] of Object.entries(t)) fs.writeFileSync(path.join(OUT, tag + '.' + k + '.glsl'), s); };
const meta = (v: any) => { const c = v.debug.clouds; return { cascades: c.shadow.cascadeCount, cloudDefines: { ...c.cloudsPass.currentMaterial.defines }, shadowDefines: { ...c.shadowPass.currentMaterial.defines } }; };
const throwsMsg = (f: () => unknown): string | null => { try { f(); return null; } catch (e: any) { return String(e && e.message || e); } };
const athrowsMsg = async (f: () => Promise<unknown>): Promise<string | null> => { try { await f(); return null; } catch (e: any) { return String(e && e.message || e); } };

${isCur ? `
const T_KEYS = ['tsun', 'tsunN', 'tsunRangeKm', 'archLight', 'archNoT', 'tsunRef', 'tsunRefStepM', 'tsunDebug', 'tsunSync'];
const texId = () => new Texture().id;   // three 텍스처 id 는 전역 증가 — 사이의 증가 = 만든 텍스처 수(+1, 이 셈 자신)
/** 시험용 아틀라스(부른 쪽이 만든 텍스처) */
const fakeAtlas = (v: any, o: any = {}) => {
  const n = o.n ?? 128, blocks = o.blocks ?? 2, arch = !!o.arch;
  const rows = (TS as any).tsunAtlasRows(arch);
  const tex = new DataTexture(new Float32Array(n * blocks * n * rows * 4), n * blocks, n * rows, RGBAFormat, FloatType);
  return { texture: tex, n, blocks, laneBlock: o.laneBlock ?? [0, 1, -1, -1], centerKm: [1.5, -2.0], rowAxisEN: [Math.cos(0.3), Math.sin(0.3)], halfKm: 104,
    rangeKm: o.rangeKm ?? 400, arch, tauCond: Array.from({ length: (TS as any).TSUN_COND_LEN }, (_, k) => 0.01 * k), prof: Array.from({ length: (TS as any).TSUN_PROF_N * 4 }, (_, k) => 0.1 * k),
    sceneSerial: o.serial ?? v.tsunSceneSerial(), meta: { builder: 'test' } };
};
async function curTests(res: any) {
  const M = TS.TSUN_MARKS;
  const c = (s: string, a: string) => s.split(a).length - 1;
  const marksOf = (t: any, arch: boolean) => {
    const f = t.cloudsFrag, s = t.shadowFrag;
    return {
      decl: c(f, M.decl), declArch: c(f, M.declArch), helpers: c(f, M.helpers), helpersArch: c(f, M.helpersArch),
      i0: c(f, M.i0), i1: c(f, M.i1), i2: c(f, M.i2), it: c(f, M.it), i4: c(f, M.i4),
      marchDirDecl: c(f, 'vec3 gMarchDir ='), countLine: c(f, TS.TSUN_COUNT_LINE), thruLine: c(f, TS.TSUN_IT_ANCHOR),
      elseThru: c(f, '        } else {\\n' + TS.TSUN_IT_ANCHOR + '\\n        }'), marchArg: c(f, '        position,\\n        gMarchDir,'),
      shadowAny: c(s, TS.TSUN_MARK), shadowVertAny: c(t.shadowVert, TS.TSUN_MARK), vertAny: c(t.cloudsVert, TS.TSUN_MARK),
      grainRefine: c(f, '// RULER-grain E1b'), cost: (() => { try { applyCostPatch(f); return true; } catch (e: any) { return String(e.message); } })(),
    };
  };
  const want = (arch: boolean) => ({ decl: 1, declArch: +arch, helpers: 1, helpersArch: +arch, i0: +arch, i1: +arch, i2: 1, it: 1, i4: +arch, marchDirDecl: 1, countLine: 1, thruLine: 1, elseThru: 1, marchArg: +arch, shadowAny: 0, shadowVertAny: 0, vertAny: 0 });
  res.marksWant = { t: want(false), a: want(true) };
  // ── U4a: 품질 × 얼음 × 확산 0·1 × grain 손잡이 × T·아치 (한 장면에 setOptions 로 바꿔 가며 — 박명)
  const GRAINS: Record<string, any> = { off: { refineOnHit: 0, sunLowpass: 0, erodeCentered: 0, jitterMode: 0 }, refine: { refineOnHit: 1 }, sunLow: { sunLowpass: 1 }, erode1: { erodeCentered: 1 }, erode2: { erodeCentered: 2 }, jitter: { jitterMode: 1 }, all: cfg.grainAll };
  res.u4a = [];
  for (const q of ['low', 'medium', 'high']) {
    const { v } = await mk({ accurateSunBelowDeg: 12 }, q);
    v.setScene(inp(cfg.iso.tw));
    for (const ice of [false, true]) for (const diffuse of [0, 1]) for (const [gn, go] of Object.entries(GRAINS)) for (const arch of [0, 1]) {
      v.setOptions({ ...GRAINS.off, ...go, iceHalo: ice, diffuse, tsun: 1, archLight: arch }, true);
      const t = texts(v, [], false);
      res.u4a.push({ q, ice, diffuse, grain: gn, arch, got: marksOf(t, !!arch), info: v.tsunInfo() });
      if (q === 'low' && !ice && !diffuse && gn === 'off') dump('on_low_' + (arch ? 'a' : 't'), t);
    }
  }
  // ── 켠 글자 dump(U0a 용, 품질마다 T·아치) + 같은 장면 C0ps 글자
  res.onMeta = {};
  for (const q of ['low', 'medium', 'high']) for (const arch of [0, 1]) {
    const { v, ps } = await mk({ accurateSunBelowDeg: 12, tsun: 1, archLight: arch }, q);
    v.setScene(inp(cfg.iso.tw)); v.setTerrainDistance(fakeTex, fakeTex, fakeTex, 0.03, fakeTex);
    dump('on_' + q + '_' + (arch ? 'a' : 't') + '_tw', texts(v, ps)); res.onMeta[q + '_' + arch] = meta(v);
  }
  // ── U4g: T 팔 낮 = C0ps 낮, 낮 → 박명 → 낮 왕복(아치 포함), 박명 C0ps 와 정점·대기·합친 글자 같음
  res.u4g = {};
  for (const arch of [0, 1]) {
    const A = await mk({ accurateSunBelowDeg: 12, tsun: 1, archLight: arch }, 'low'); A.v.setScene(inp(cfg.iso.day)); A.v.setTerrainDistance(fakeTex, fakeTex, fakeTex, 0.03, fakeTex);
    const B = await mk({ accurateSunBelowDeg: 12 }, 'low'); B.v.setScene(inp(cfg.iso.day)); B.v.setTerrainDistance(fakeTex, fakeTex, fakeTex, 0.03, fakeTex);
    const tA = texts(A.v, A.ps), tB = texts(B.v, B.ps);
    A.v.setDate(new Date(cfg.iso.tw)); B.v.setDate(new Date(cfg.iso.tw));
    const tA2 = texts(A.v, A.ps), tB2 = texts(B.v, B.ps);
    A.v.setDate(new Date(cfg.iso.day)); B.v.setDate(new Date(cfg.iso.day));
    const tA3 = texts(A.v, A.ps);
    const keys = ['cloudsFrag', 'cloudsVert', 'shadowFrag', 'shadowVert', 'aerial', 'merged', 'uniforms', 'defines'];
    res.u4g[arch] = {
      dayEq: keys.filter(k => (tA as any)[k] !== (tB as any)[k]), backEq: keys.filter(k => (tA3 as any)[k] !== (tB as any)[k]),
      twDiff: keys.filter(k => (tA2 as any)[k] !== (tB2 as any)[k]), infoDay: A.v.tsunInfo(), infoTw: null as any,
    };
    A.v.setDate(new Date(cfg.iso.tw)); res.u4g[arch].infoTw = A.v.tsunInfo();
  }
  // ── U4b: 실행 중 끄기(tsun 1 → 0) = C0ps
  {
    const A = await mk({ accurateSunBelowDeg: 12, tsun: 1, archLight: 1 }, 'low'); A.v.setScene(inp(cfg.iso.tw));
    const B = await mk({ accurateSunBelowDeg: 12 }, 'low'); B.v.setScene(inp(cfg.iso.tw));
    A.v.setTsunAtlas(fakeAtlas(A.v, { arch: true }));
    A.v.setOptions({ tsun: 0, archLight: 0 }, false);
    const tA = texts(A.v, [], false), tB = texts(B.v, [], false);
    res.u4bToggle = ['cloudsFrag', 'cloudsVert', 'shadowFrag', 'uniforms', 'defines'].filter(k => (tA as any)[k] !== (tB as any)[k]);
  }
  // ── U4c: 끈 재질 균일변수·텍스처 수
  {
    const names = (v: any) => [...Object.keys(v.debug.clouds.cloudsPass.currentMaterial.uniforms), ...Object.keys(v.debug.clouds.shadowPass.currentMaterial.uniforms)].filter(k => /^g(Tsun|Arch)/.test(k));
    const id0 = texId(); const A = await mk({}, 'low'); A.v.setScene(inp(cfg.iso.tw)); A.v.setDate(new Date(cfg.iso.deep)); const id1 = texId();
    const B = await mk({ tsun: 1, archLight: 1 }, 'low'); B.v.setScene(inp(cfg.iso.tw)); B.v.setDate(new Date(cfg.iso.deep)); const id2 = texId();
    const offAtlas = await mk({}, 'low'); offAtlas.v.setScene(inp(cfg.iso.tw)); const fa = fakeAtlas(offAtlas.v); offAtlas.v.setTsunAtlas(fa);
    res.u4c = { offNames: names(A.v), onNames: names(B.v), texOff: id1 - id0, texOn: id2 - id1, offAtlasNames: names(offAtlas.v), offAtlasInfo: offAtlas.v.tsunInfo() };
  }
  // ── U4d·점검
  {
    const L = (o: any) => throwsMsg(() => (TS as any).validateTsunOptions({ ...(TS as any).TSUN_OPTIONS_OFF, genus: true, diffuse: 0, ...o }));
    res.u4d = {
      diff2Create: await athrowsMsg(async () => { const r = await mk({ tsun: 1, diffuse: 2 }, 'low'); }),
      diff2Opts: await (async () => { const { v } = await mk({ tsun: 1 }, 'low'); const m = throwsMsg(() => v.setOptions({ diffuse: 2 }, false)); return { m, kept: v.tsunInfo().enabled }; })(),
      diff2OptsCreate: await athrowsMsg(async () => { await createVolumetricScene(mkRenderer(), W, H, { genus: true, celestial: false, precomputed: {} as never, tsun: 1, diffuse: 2 } as any); }),
      diff3: L({ tsun: 1, diffuse: 3 }), diff9: L({ tsun: 1, diffuse: 9 }), diff1: L({ tsun: 1, diffuse: 1 }), diff2Off: L({ tsun: 0, diffuse: 2 }),
      archNoTsun: L({ archLight: 1 }), noTNoArch: L({ tsun: 1, archNoT: 1 }), badTsun: L({ tsun: 2 }), badTsunStr: L({ tsun: '1' }), badN: L({ tsun: 1, tsunN: 64 }),
      badRange: L({ tsun: 1, tsunRangeKm: 0 }), badRangeNaN: L({ tsun: 1, tsunRangeKm: NaN }), badStep: L({ tsunRefStepM: -1 }), badSync: L({ tsunSync: 1 }),
      refNotImpl: L({ tsunRef: 1, tsunDebug: 6 }), refAndT: L({ tsun: 1, tsunRef: 1 }), dbgNotImpl: L({ tsun: 1, tsunDebug: 7 }), /* §179 WP6·WP8: tsunRef 1·2 · tsunDebug 1 은 구현됨 — 미구현은 진단 2~7(verify-tsun-ref.js) */ dbg1NoT: L({ tsunDebug: 1 }), dbgArchNoArch: L({ tsun: 1, tsunDebug: 3 }),
      noGenus: L({ tsun: 1, genus: false }), okT: L({ tsun: 1 }), okA: L({ tsun: 1, archLight: 1 }), okH0: L({ tsun: 1, archLight: 1, archNoT: 1 }), okT2: L({ tsun: 1, tsunN: 256 }),
      okOff: L({}),
    };
  }
  // ── U0b: 샘플러 한도
  {
    const cnt = (TS as any).TSUN_CLOUD_SAMPLERS;
    const at = async (q: string, lim: number | undefined) => await athrowsMsg(async () => { await mk({ tsun: 1 }, q, lim); });
    res.u0b = {
      table: cnt,
      lowAtCount: await at('low', cnt.low), lowAtCount1: await at('low', cnt.low + 1),
      medAtCount: await at('medium', cnt.medium), medAtCount1: await at('medium', cnt.medium + 1),
      highAt15: await at('high', 15), highAt16: await at('high', 16), highUnknown: await at('high', undefined),
      createThrows: await athrowsMsg(async () => { await createVolumetricScene(mkRenderer(cnt.low), W, H, { genus: true, celestial: false, precomputed: {} as never, tsun: 1 } as any); }),
      quality: await (async () => { const { v } = await mk({ tsun: 1 }, 'low', 15); const m = throwsMsg(() => v.setQuality('high')); const keptLow = v.tsunInfo().samplers;
        const q2 = throwsMsg(() => v.setQuality('medium')); return { m, keptLow, mediumOk: q2, samplers: v.tsunInfo().samplers }; })(),
      offAt4: await athrowsMsg(async () => { await mk({}, 'high', 4); }),
      caps: (() => { const g: any = { getSupportedExtensions: () => [], getExtension: () => null, RENDERER: 1, VERSION: 2, MAX_3D_TEXTURE_SIZE: 3, MAX_TEXTURE_IMAGE_UNITS: 4,
        getParameter: (k: number) => ({ 1: 'fake', 2: 'WebGL 2.0', 3: 2048, 4: 16 } as any)[k] }; return readCapabilities(g); })(),
    };
  }
  // ── 아틀라스
  {
    const { v } = await mk({ accurateSunBelowDeg: 12, tsun: 1, archLight: 1 }, 'low'); v.setScene(inp(cfg.iso.deep));
    const u = () => v.debug.clouds.cloudsPass.currentMaterial.uniforms;
    const before = { on: u().gTsunOn?.value, info: v.tsunInfo() };
    const a = fakeAtlas(v, { arch: true });
    v.setTsunAtlas(a);
    const vals = { on: u().gTsunOn.value, tex: u().gTsunTex.value === a.texture, frame: u().gTsunFrame.value.toArray(), lane: u().gTsunLaneBlock.value.toArray(), epoch: u().gTsunEpoch.value.toArray(),
      cond0: u().gTsunCond.value[0].toArray(), cond8: u().gTsunCond.value[8].toArray(), condN: u().gTsunCond.value.length, prof16: u().gTsunProf.value[16].toArray(), profN: u().gTsunProf.value.length,
      archW: u().gArchW.value, archNoT: u().gArchNoT.value, info: v.tsunInfo() };
    const errs = {
      wrongN: throwsMsg(() => v.setTsunAtlas(fakeAtlas(v, { arch: true, n: 256 }))), wrongSerial: throwsMsg(() => v.setTsunAtlas(fakeAtlas(v, { arch: true, serial: -5 }))),
      wrongRange: throwsMsg(() => v.setTsunAtlas(fakeAtlas(v, { arch: true, rangeKm: 300 }))), noArch: throwsMsg(() => v.setTsunAtlas(fakeAtlas(v, { arch: false }))),
      badLane: throwsMsg(() => v.setTsunAtlas(fakeAtlas(v, { arch: true, laneBlock: [0, 2, -1, -1] }))),
    };
    const afterErrs = { on: u().gTsunOn.value, tex: u().gTsunTex.value === a.texture };
    v.setDate(new Date(cfg.iso.tw)); const twArch = { archW: u().gArchW.value, info: v.tsunInfo() };
    v.setDate(new Date(cfg.iso.deep));
    v.setOptions({ tsunN: 256 }, false); const stale = { on: u().gTsunOn.value, info: v.tsunInfo() };
    v.setOptions({ tsunN: 128 }, false); const back = { on: u().gTsunOn.value };
    v.setScene(inp(cfg.iso.deep)); const dropped = { on: u().gTsunOn.value, info: v.tsunInfo(), oldThrows: throwsMsg(() => v.setTsunAtlas(a)) };
    res.atlas = { before, vals, errs, afterErrs, twArch, stale, back, dropped, archWeight: [(TS as any).archWeight(0), (TS as any).archWeight(-1), (TS as any).archWeight(-1.5), (TS as any).archWeight(-2), (TS as any).archWeight(-9)] };
  }
  // ── 주입 함수 앵커 가드
  {
    const base = fs.readFileSync(path.join(OUT, 'on_low_t.cloudsFrag.glsl'), 'utf8');
    const shadow = fs.readFileSync(path.join(OUT, 'on_low_t.shadowFrag.glsl'), 'utf8');
    res.guards = {
      shadowThrows: throwsMsg(() => (TS as any).injectTsun(shadow, { arch: false })),
      missingIT: throwsMsg(() => (TS as any).injectTsun(base.split(TS.TSUN_IT_ANCHOR).join('// x'), { arch: false })),
    };
  }
  res.defaults = T_KEYS.map(k => [k, (DEFAULT_VOLUMETRIC_OPTIONS as any)[k]]);
  res.consts = { anchorsT: [TS.TSUN_DECL_ANCHOR, TS.TSUN_HELPER_ANCHOR, TS.TSUN_I2_ANCHOR, TS.TSUN_IT_ANCHOR], anchorsA: [TS.TSUN_I0_ANCHOR, TS.TSUN_I1_ANCHOR, TS.TSUN_I4_ANCHOR],
    samplers: (TS as any).TSUN_CLOUD_SAMPLERS, slices: (TS as any).TSUN_SLICE_HF, countLine: TS.TSUN_COUNT_LINE, itAnchor: TS.TSUN_IT_ANCHOR,
    profN: (TS as any).TSUN_PROF_N, condLen: (TS as any).TSUN_COND_LEN };
}
` : ''}
(async () => {
  const res: any = { runs: {}, meta: {}, ids: {} };
  const tid = () => new Texture().id;   // three 텍스처 id 는 전역 증가 — 사이의 증가 = 만든 텍스처 수(+1)
  for (const run of cfg.offRuns) {
    const id0 = markIds();
    const { v, ps } = await mk(run.options, run.quality);
    v.setScene(inpRing(run.iso)); v.setTerrainDistance(fakeTex, fakeTex, fakeTex, 0.03, fakeTex);
    dump(run.tag, texts(v, ps)); res.meta[run.tag] = meta(v);
    res.ids[run.tag] = tid() - id0;
    ${isCur ? `// 같은 길에 T_sun 손잡이를 끈 값으로 명시(하네스 잡이 모든 새 손잡이를 줌 — ruler-delta A1)
    if (run.quality !== 'medium') { markIds(); const e = await mk({ ...run.options, ...(TS as any).TSUN_OPTIONS_OFF }, run.quality); e.v.setScene(inpRing(run.iso)); e.v.setTerrainDistance(fakeTex, fakeTex, fakeTex, 0.03, fakeTex); dump(run.tag + '_explicit', texts(e.v, e.ps)); }` : ''}
  }
  // U0a 원본(거시 고리 없이 — §177.6 h 의 12/13/15 와 같은 조건)
  for (const q of ['low', 'medium', 'high']) for (const [t, o] of [['day', {}], ['tw_c0ps', { accurateSunBelowDeg: 12 }]] as [string, any][]) {
    const { v, ps } = await mk(o, q); v.setScene(inp(t === 'day' ? cfg.iso.day : cfg.iso.tw)); v.setTerrainDistance(fakeTex, fakeTex, fakeTex, 0.03, fakeTex);
    dump('u0a_' + q + '_' + t, texts(v, ps)); res.meta['u0a_' + q + '_' + t] = meta(v);
  }
  // 검토 회귀 3: setDate 쓸기(낮 → 17:40 → −9.8° → 박명 → 낮) · 앱 setOptions 키(reapply false) · 품질 바꿈 — 한 장면, low·high
  const APP_KEYS = { flow: false, flowUv: false, physics: false, physicsIce: false, macro: 1, morph: false, clampInscatter: true, irradianceLogMu: true };
  for (const q of ['low', 'high']) {
    markIds();
    const { v, ps } = await mk({ accurateSunBelowDeg: 12 }, q);
    v.setScene(inpRing(cfg.iso.day)); v.setTerrainDistance(fakeTex, fakeTex, fakeTex, 0.03, fakeTex);
    let i = 0; for (const k of ['day', 'gh', 'deep', 'tw', 'day2']) { v.setDate(new Date(cfg.iso[k === 'day2' ? 'day' : k])); dump('sweep_' + q + '_' + (i++) + k, texts(v, ps)); }
    v.setOptions(APP_KEYS, false); v.setQuality('medium'); v.setQuality(q);
    dump('sweepC_' + q, texts(v, ps));
  }
  // 검토 회귀 3: 앱 길 흉내 — SkyScene3D(만들기 {genus, celestial false} + 그 setOptions 키만, 하네스 옵션 없음) · VolumetricProbe(만들기 옵션만)
  for (const q of ['low', 'medium', 'high']) for (const t of ['day', 'tw', 'deep']) {
    passes.length = 0;
    const id0 = markIds();
    const a: any = await createVolumetricScene(mkRenderer(), W, H, { genus: true, celestial: false, precomputed: {} as never });
    const pa = passes.slice();
    a.setQuality(q); a.setOptions(APP_KEYS, false);
    a.setScene(inpRing(cfg.iso[t])); a.setTerrainDistance(fakeTex, fakeTex, fakeTex, 0.03, fakeTex); a.setOptions(APP_KEYS, false);
    dump('app_' + q + '_' + t, texts(a, pa)); res.ids['app_' + q + '_' + t] = tid() - id0;
    passes.length = 0;
    markIds();
    const b: any = await createVolumetricScene(mkRenderer(), W, H, { genus: true, clampInscatter: true, irradianceLogMu: true, precomputed: {} as never } as any);
    const pb = passes.slice();
    b.setQuality(q); b.setScene(inpRing(cfg.iso[t], false));
    dump('probe_' + q + '_' + t, texts(b, pb));
  }
  ${isCur ? 'await curTests(res);' : ''}
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(res));
})().catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
`;

function runTree(tag, tree, isCur) {
  const dir = path.join(WORK, tag); fs.mkdirSync(dir, { recursive: true });
  const ts = path.join(WORK, `harness-${tag}.ts`), cjs = path.join(WORK, `harness-${tag}.cjs`), cfgF = path.join(WORK, `cfg-${tag}.json`);
  fs.writeFileSync(ts, HARNESS(tree, isCur));
  fs.writeFileSync(cfgF, JSON.stringify({ scene: SCENE, layers: LAYERS, iso: T, offRuns: OFF_RUNS, grainAll: GRAIN_ALL, ring: RING }));
  execFileSync('npx', ['esbuild', ts, '--bundle', '--format=cjs', '--platform=node', '--define:__DEV__=false', '--define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY="1"', `--outfile=${cjs}`, '--log-level=error'],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') } });
  execFileSync('node', [cjs, cfgF, dir], { stdio: 'inherit' });
  return { dir, res: JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')) };
}
const rd = (dir, tag, k) => fs.readFileSync(path.join(dir, `${tag}.${k}.glsl`), 'utf8');

// ───────────────────────── U0a 정적 샘플러 분석(§177.6 h samplers.py 를 옮김) ─────────────────────────
const TEXF = new Set(['texture', 'textureLod', 'texelFetch', 'texelFetchOffset', 'textureSize', 'textureGrad', 'textureOffset', 'textureLodOffset', 'texture2D', 'texture3D', 'textureProj', 'textureGather', 'texture2DLodEXT', 'textureQueryLod']);
const KW = new Set(['if', 'for', 'while', 'return', 'switch', 'else', 'do']);
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
function evalCond(expr, defs) {
  let e = expr.replace(/defined\s*\(\s*(\w+)\s*\)/g, (_, n) => (n in defs ? '1' : '0')).replace(/defined\s+(\w+)/g, (_, n) => (n in defs ? '1' : '0'));
  e = e.replace(/\b[A-Za-z_]\w*\b/g, n => { const v = defs[n]; if (v == null) return '0'; return Number.isFinite(Number(v)) ? String(Number(v)) : '1'; });
  try { return !!Function('"use strict"; return (' + e + ');')(); } catch { return true; }
}
function preprocess(src, defines) {
  const defs = { ...defines, UNROLLED_LOOP_INDEX: '0' }, aliases = {}, out = [], stack = [];
  let active = true;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#')) {
      const m = t.match(/^#\s*(\w+)\s*(.*)$/); const d = m ? m[1] : '', rest = m ? m[2] : '';
      if (d === 'ifdef' || d === 'ifndef' || d === 'if') {
        const c = d === 'ifdef' ? rest.split(/\s+/)[0] in defs : d === 'ifndef' ? !(rest.split(/\s+/)[0] in defs) : evalCond(rest, defs);
        stack.push([active, active && c]); active = active && c;
      } else if (d === 'elif') { const [parent, taken] = stack[stack.length - 1]; const c = parent && !taken && evalCond(rest, defs); stack[stack.length - 1] = [parent, taken || c]; active = c; }
      else if (d === 'else') { const [parent, taken] = stack[stack.length - 1]; active = parent && !taken; stack[stack.length - 1] = [parent, true]; }
      else if (d === 'endif') { active = stack.pop()[0]; }
      else if (d === 'define' && active) {
        const mm = rest.match(/^(\w+)(\([^)]*\))?\s*(.*)$/);
        if (mm) { defs[mm[1]] = mm[3] || '1'; if (!mm[2] && /^[A-Za-z_]\w*$/.test(mm[3] || '')) aliases[mm[1]] = mm[3]; }
      } else if (d === 'undef' && active) delete defs[rest.split(/\s+/)[0]];
      continue;
    }
    if (active) out.push(line);
  }
  let txt = out.join('\n');
  for (let i = 0; i < 3; i++) txt = txt.replace(/\b[A-Za-z_]\w*\b/g, n => aliases[n] ?? n);
  return txt;
}
function splitArgs(s) { const args = []; let depth = 0, cur = ''; for (const ch of s) { if ('(['.includes(ch)) depth++; else if (')]'.includes(ch)) depth--; if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) args.push(cur.trim()); return args; }
function callsIn(body) {
  const res = []; const re = /\b([A-Za-z_]\w*)\s*\(/g; let m;
  while ((m = re.exec(body))) {
    const name = m[1]; if (KW.has(name)) continue;
    let j = m.index + m[0].length, depth = 1; const i = j;
    while (j < body.length && depth) { if (body[j] === '(') depth++; else if (body[j] === ')') depth--; j++; }
    res.push([name, splitArgs(body.slice(i, j - 1))]);
  }
  return res;
}
function parseFuncs(txt) {
  const funcs = {}; const n = txt.length; let pos = 0;
  while (pos < n) {
    if (txt[pos] === '{') {
      const head = txt.slice(Math.max(0, pos - 600), pos + 1);
      const pat = /([A-Za-z_][\w\s[\]]*?)\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*\{/g; let m = null, mm;
      while ((mm = pat.exec(head))) if (mm.index + mm[0].length === head.length) m = mm;
      let d = 1, j = pos + 1;
      while (j < n && d) { if (txt[j] === '{') d++; else if (txt[j] === '}') d--; j++; }
      if (m && !KW.has(m[2]) && !m[1].trim().endsWith('struct')) {
        const params = splitArgs(m[3]).map(p => (p.match(/[A-Za-z_]\w*/g) || [])).filter(t => t.length && !(t.length === 1 && t[0] === 'void')).map(t => t[t.length - 1]);
        (funcs[m[2]] = funcs[m[2]] || []).push([params, txt.slice(pos + 1, j - 1)]);
      }
      pos = j; continue;
    }
    pos++;
  }
  return funcs;
}
function activeSamplers(src, defines) {
  const txt = preprocess(stripComments(src), defines);
  const samplers = [...txt.matchAll(/uniform\s+(?:(?:lowp|mediump|highp)\s+)?(sampler\w+)\s+(\w+)\s*;/g)].map(m => m[2]);
  const sset = new Set(samplers), funcs = parseFuncs(txt);
  const used = new Map(); for (const [f, ovs] of Object.entries(funcs)) ovs.forEach((_, k) => used.set(f + '#' + k, new Set()));
  const root = a => { const m = a.match(/^\s*([A-Za-z_]\w*)\s*$/); return m ? m[1] : null; };
  const targets = (name, args) => { let tgt = []; if (TEXF.has(name) && args.length) tgt = [args[0]]; else if (funcs[name]) funcs[name].forEach(([pp], kk) => { if (pp.length === args.length) for (const ix of used.get(name + '#' + kk)) tgt.push(args[ix]); }); return tgt; };
  let changed = true;
  while (changed) {
    changed = false;
    for (const [f, ovs] of Object.entries(funcs)) ovs.forEach(([params, body], k) => {
      const u = used.get(f + '#' + k);
      for (const [name, args] of callsIn(body)) for (const a of targets(name, args)) { const r = root(a); if (r && params.includes(r)) { const ix = params.indexOf(r); if (!u.has(ix)) { u.add(ix); changed = true; } } }
    });
  }
  const reach = new Set(), st = ['main'];
  while (st.length) { const f = st.pop(); if (reach.has(f) || !funcs[f]) continue; reach.add(f); for (const [, body] of funcs[f]) for (const [name] of callsIn(body)) if (funcs[name] && !reach.has(name)) st.push(name); }
  const active = new Set();
  for (const f of reach) for (const [, body] of funcs[f]) for (const [name, args] of callsIn(body)) for (const a of targets(name, args)) { const r = root(a); if (r && sset.has(r)) active.add(r); }
  return { declared: [...sset].sort(), active: [...active].sort() };
}
/** samplers.py 와 같은 실행 시 define(onBeforeRender·생성기가 더하는 것). */
const runtimeDefines = (d, q, cascades, isShadow) => {
  const o = { ...d };
  if (isShadow) { o.CASCADE_COUNT = String(cascades); return o; }
  o.POWDER = '1'; o.HAS_HIGHER_ORDER_SCATTERING_TEXTURE = '1'; if (q !== 'low') o.GROUND_BOUNCE = '1'; o.SHADOW_CASCADE_COUNT = String(cascades);
  return o;
};

// ───────────────────────── [glsl] u_true 를 GLSL 글자에서 옮김 ─────────────────────────
function glslFn(src, name) {
  const i = src.indexOf('float ' + name + '(');
  if (i < 0) return null;
  let j = src.indexOf('{', i), d = 1, k = j + 1;
  while (d && k < src.length) { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; }
  return src.slice(i, k);
}
/** 머리 글자(형 포함)로 GLSL 함수 하나. */
function glslFnHead(src, head) {
  const i = src.indexOf(head);
  if (i < 0) return null;
  let j = src.indexOf('{', i), d = 1, k = j + 1;
  while (d && k < src.length) { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; }
  return src.slice(i, k);
}
/** §179 검토 반영: 조각 보간 도움 함수용 작은 GLSL → JS(스칼라 레인 하나 — vecN 은 배열 + 성분 접근자, dot = 곱). */
function glslToJs(src) {
  let s = src.replace(/\/\/[^\n]*/g, '');
  s = s.replace(/^(?:float|int|vec2|vec3|vec4|void)\s+(\w+)\s*\(([^)]*)\)\s*\{/gm, (_, n, ps) => `function ${n}(${ps.split(',').map(p => p.trim().split(/\s+/).pop()).filter(Boolean).join(', ')}) {`);
  s = s.replace(/\bconst\s+(?:float|int|vec2|vec3|vec4)\s+/g, 'const ');
  s = s.replace(/\b(?:float|int|vec2|vec3|vec4|bool)\s+(?=[A-Za-z_]\w*\s*(?:=|,|;))/g, 'let ');
  s = s.replace(/\bfloat\(/g, 'Number(').replace(/\bint\(/g, 'Math.trunc(');
  s = s.replace(/(?<![\w.])(max|min|sqrt|abs|floor|pow)\(/g, 'Math.$1(');
  if (/\b(float|vec[234]|int)\b(?!\()/.test(s.replace(/function \w+\([^)]*\)/g, ''))) throw new Error('GLSL 형이 남음: ' + s.match(/.{0,40}\b(float|vec[234]|int)\b.{0,40}/)[0]);
  return s;
}
function toJs(fn, consts) {
  let s = fn.replace(/^float\s+(\w+)\s*\(([^)]*)\)/, (_, n, ps) => `(function ${n}(${ps.split(',').map(p => p.trim().split(/\s+/).pop()).join(', ')})`);
  s = s.replace(/\bfloat\s+/g, 'let ').replace(/\b(sqrt|max|min|abs)\(/g, 'Math.$1(');
  for (const [k, v] of Object.entries(consts)) s = s.replace(new RegExp('\\b' + k + '\\b', 'g'), String(v));
  return eval(s + ')');
}
const BRUTE_DS = 0.002;   // km — 경계마다 ≤ ds/2 오차
function bruteInLayer(h0, sinE, hb, ht, D, R, ds = BRUTE_DS) {
  const r0 = R + h0, cosE = Math.sqrt(1 - sinE * sinE); let len = 0;
  for (let s = ds / 2; s < D; s += ds) { const x = s * cosE, z = r0 + s * sinE; const h = Math.hypot(x, z) - R; if (h >= hb && h <= ht) len += ds; }
  return len;
}
/** 주석을 뺀 글자의 괄호 균형(takram 원문 주석에 짝 없는 괄호가 있음). */
const balanced = s => { let p = 0, b = 0, c = 0; for (const ch of stripComments(s)) { if (ch === '(') p++; else if (ch === ')') p--; else if (ch === '{') b++; else if (ch === '}') b--; else if (ch === '[') c++; else if (ch === ']') c--; if (p < 0 || b < 0 || c < 0) return false; } return p === 0 && b === 0 && c === 0; };

// ───────────────────────── 실행 ─────────────────────────
(async () => {
  console.log(`[a] 묶기 — 지금 트리와 기준 트리(${BASE_REV})를 같은 하네스로 (작업 폴더 ${WORK})`);
  const BASE_TREE = path.join(WORK, 'base-tree');
  fs.rmSync(BASE_TREE, { recursive: true, force: true }); fs.mkdirSync(BASE_TREE, { recursive: true });
  execFileSync('bash', ['-c', `git -C "${ROOT}" archive "${BASE_REV}" src | tar -x -C "${BASE_TREE}"`]);
  // 검토 회귀 2: 기준 트리가 §179 를 품으면 '끈 = §179 전' 비교가 뜻이 없음 — 멈춤
  if (fs.existsSync(path.join(BASE_TREE, 'src/components/VolumetricProbe/cloudTsun.ts'))) { console.error(`기준 트리 ${BASE_REV} 에 cloudTsun.ts 가 있음 — §179 전 커밋(${PRE179})을 쓰세요`); process.exit(2); }
  const B = runTree('base', BASE_TREE, false);
  const Cu = runTree('cur', ROOT, true);
  ok(true, 'esbuild 묶기·가짜 렌더러 실행(두 트리)');
  const R = Cu.res;

  console.log('\n[byte] 끄면 그대로 — 기준 트리와 바이트 비교');
  let nSame = 0, nAll = 0; const diffs = [];
  for (const run of OFF_RUNS) {
    for (const k of KINDS) { nAll++; if (rd(Cu.dir, run.tag, k) === rd(B.dir, run.tag, k)) nSame++; else diffs.push(run.tag + '.' + k); }
    if (run.quality !== 'medium') for (const k of KINDS) { nAll++; if (rd(Cu.dir, run.tag + '_explicit', k) === rd(B.dir, run.tag, k)) nSame++; else diffs.push(run.tag + '_explicit.' + k); }
  }
  ok(nSame === nAll && nAll > 0, `옵션 안 넘김·TSUN_OPTIONS_OFF 명시: ${OFF_RUNS.length} 길(품질 3 × 낮·박명·깊은 박명 × 변형 ${Object.keys(VARIANTS).length}, 거시 고리 켬) × ${KINDS.join('·')} — ${nSame}/${nAll} 같음${diffs.length ? ' — 다름: ' + diffs.slice(0, 8).join(', ') : ''}`);
  {
    const ed = [];
    for (const tag of EXTRA_TAGS) for (const k of KINDS) if (rd(Cu.dir, tag, k) !== rd(B.dir, tag, k)) ed.push(tag + '.' + k);
    ok(ed.length === 0, `setDate 쓸기(low·high, 낮 → 17:40 → −9.8° → 박명 → 낮 · 앱 setOptions 키 · 품질 바꿈) · SkyScene3D·VolumetricProbe 길 흉내(품질 3 × 시각 3): ${EXTRA_TAGS.length} 덤프 × ${KINDS.length} = 기준 트리` + (ed.length ? ' — 다름: ' + ed.slice(0, 8).join(', ') : ''));
    const idDiff = Object.keys(B.res.ids).filter(k => B.res.ids[k] !== Cu.res.ids[k]);
    ok(idDiff.length === 0 && Object.keys(B.res.ids).length === OFF_RUNS.length + 9, `만든 텍스처 수(three id 증가)가 기준 트리와 같음 — ${Object.keys(B.res.ids).length} 길` + (idDiff.length ? ' — 다름 ' + idDiff.slice(0, 6).join(',') : ''));
    const hits = [...OFF_RUNS.map(r => r.tag), ...EXTRA_TAGS].filter(tag => KINDS.some(k => /§179|gTsun|gArch|gMarchDir/.test(rd(Cu.dir, tag, k))));
    ok(hits.length === 0, '끈 길의 어느 덤프(글자·균일변수 이름·값·define)에도 §179·gTsun·gArch·gMarchDir 없음' + (hits.length ? ' — ' + hits.slice(0, 5).join(',') : ''));
  }
  ok(!rd(Cu.dir, 'low_tw_plain', 'merged').startsWith('ERR') && rd(Cu.dir, 'low_tw_plain', 'merged').length > 1000, 'EffectPass 합친 글자를 얻음(비교가 비지 않음)');
  ok(OFF_RUNS.every(r => count(rd(Cu.dir, r.tag, 'cloudsFrag'), '§179') === 0 && count(rd(Cu.dir, r.tag, 'shadowFrag'), '§179') === 0), '끈 글자에 §179 표지 없음');
  ok(R.defaults.every(([k, v]) => ({ tsun: 0, tsunN: 128, tsunRangeKm: 400, archLight: 0, archNoT: 0, tsunRef: 0, tsunRefStepM: 200, tsunDebug: 0, tsunSync: false })[k] === v), 'DEFAULT_VOLUMETRIC_OPTIONS: T_sun 손잡이 모두 끔 ' + JSON.stringify(R.defaults));
  {   // 앱이 넘기지 않음(정적) — SkyScene3D·VolumetricProbe·스토어·개발 패널에 손잡이 이름이 없음
    const files = ['src/components/SkyScene3D/SkyScene3D.tsx', 'src/components/VolumetricProbe/VolumetricProbe.tsx', 'src/store/useCelestialStore.ts', 'src/components/SkyScreen/DevTuningPanel.tsx'];
    const hits = files.filter(f => fs.existsSync(path.join(ROOT, f)) && /\b(tsun|tsunN|archLight|archNoT|tsunRef|tsunDebug|tsunSync|setTsunAtlas)\b/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    ok(hits.length === 0, '앱 길(SkyScene3D·VolumetricProbe·스토어·개발 패널)이 T_sun 손잡이를 넘기지 않음' + (hits.length ? ' — 있음: ' + hits.join(', ') : ''));
  }

  console.log('\n[U0a] 정적 활성 샘플러 수');
  const cnt = {};
  for (const q of ['low', 'medium', 'high']) {
    const m = B.res.meta[`u0a_${q}_day`];
    const day = activeSamplers(rd(B.dir, `u0a_${q}_day`, 'cloudsFrag'), runtimeDefines(m.cloudDefines, q, m.cascades, false));
    const mc = Cu.res.meta[`u0a_${q}_tw_c0ps`];
    const c0ps = activeSamplers(rd(Cu.dir, `u0a_${q}_tw_c0ps`, 'cloudsFrag'), runtimeDefines(mc.cloudDefines, q, mc.cascades, false));
    const sh0 = activeSamplers(rd(Cu.dir, `u0a_${q}_tw_c0ps`, 'shadowFrag'), runtimeDefines(mc.shadowDefines, q, mc.cascades, true));
    const out = { day: day.active.length, c0ps: c0ps.active.length };
    for (const a of ['t', 'a']) {
      const mo = R.onMeta[q + '_' + (a === 'a' ? 1 : 0)];
      const on = activeSamplers(rd(Cu.dir, `on_${q}_${a}_tw`, 'cloudsFrag'), runtimeDefines(mo.cloudDefines, q, mo.cascades, false));
      const sh = activeSamplers(rd(Cu.dir, `on_${q}_${a}_tw`, 'shadowFrag'), runtimeDefines(mo.shadowDefines, q, mo.cascades, true));
      const extra = on.active.filter(x => !c0ps.active.includes(x)), lost = c0ps.active.filter(x => !on.active.includes(x));
      out[a] = on.active.length;
      ok(on.active.length === R.consts.samplers[q] + 1 && extra.join() === 'gTsunTex' && lost.length === 0, `${q} ${a === 'a' ? '아치' : 'T'} 켬(박명): ${on.active.length} = TSUN_CLOUD_SAMPLERS ${R.consts.samplers[q]} + 1 (더한 것 ${extra.join(',') || '없음'}${lost.length ? ', 빠진 것 ' + lost.join(',') : ''})`);
      ok(sh.active.join() === sh0.active.join(), `${q} ${a === 'a' ? '아치' : 'T'}: 그림자 패스 샘플러 그대로 (${sh.active.length})`);
    }
    cnt[q] = out;
    ok(day.active.length === { low: 12, medium: 13, high: 15 }[q], `${q} 낮 끈 상태 ${day.active.length} (§177.6 h: 12/13/15) — ${day.active.join(',')}`);
    ok(c0ps.active.length === R.consts.samplers[q], `${q} C0ps 박명(ACCURATE 켬) ${c0ps.active.length} = TSUN_CLOUD_SAMPLERS ${R.consts.samplers[q]}`);
  }
  console.log('   샘플러 수 ' + JSON.stringify(cnt));

  console.log('\n[U0b] 샘플러 한도');
  const u0b = R.u0b;
  ok(u0b.lowAtCount && /MAX_TEXTURE_IMAGE_UNITS is 13/.test(u0b.lowAtCount) && u0b.lowAtCount1 === null, `low: 한도 ${u0b.table.low} → throw · ${u0b.table.low + 1} → 됨 (${(u0b.lowAtCount || '').slice(0, 90)})`);
  ok(u0b.medAtCount && u0b.medAtCount1 === null, `medium: 한도 ${u0b.table.medium} → throw · ${u0b.table.medium + 1} → 됨`);
  ok(u0b.highAt15 && u0b.highAt16 === null && u0b.highUnknown === null, 'high: 15 → throw · 16 → 됨 · 한도 모름(가짜 렌더러) → WebGL2 최소 16 으로 봄');
  ok(!!u0b.createThrows, '만들 때 옵션 tsun 1 + 한도 초과 → throw');
  ok(!!u0b.quality.m && u0b.quality.keptLow && u0b.quality.keptLow.count === u0b.table.low + 1 && u0b.quality.mediumOk === null && u0b.quality.samplers && u0b.quality.samplers.count === u0b.table.medium + 1,
    `setQuality('high')(한도 15) → throw(low 그대로 ${JSON.stringify(u0b.quality.keptLow)}), 그다음 medium 은 됨 — ${JSON.stringify(u0b.quality.samplers)}`);
  ok(u0b.offAt4 === null, 'tsun 0 이면 한도와 무관(한도 4 로도 만들어짐)');
  ok(u0b.caps.maxTextureImageUnits === 16, 'readCapabilities: MAX_TEXTURE_IMAGE_UNITS 를 maxTextureImageUnits 로 읽음 (' + u0b.caps.maxTextureImageUnits + ')');

  console.log('\n[U4a] 표지·앵커 수 (품질 × 얼음 × 확산 0·1 × grain 7 × T·아치)');
  {
    const bad = [];
    for (const r of R.u4a) {
      const w = R.marksWant[r.arch ? 'a' : 't'];
      const miss = Object.entries(w).filter(([k, v]) => r.got[k] !== v).map(([k]) => `${k}=${r.got[k]}`);
      if (r.got.cost !== true) miss.push('cost:' + r.got.cost);
      if (r.grain === 'refine' || r.grain === 'all') { if (r.got.grainRefine < 1) miss.push('grain refine 표지 없음'); }
      if (!r.info.injected) miss.push('injected false');
      if (miss.length) bad.push(`${r.q}/ice${+r.ice}/d${r.diffuse}/${r.grain}/${r.arch ? 'A' : 'T'}: ${miss.join(' ')}`);
    }
    ok(bad.length === 0 && R.u4a.length === 3 * 2 * 2 * 7 * 2, `${R.u4a.length} 조합 — 구름 조각 주입점마다 1(아치 I-0·I-1·I-4 는 아치 팔만), 그림자 조각·정점 0, gMarchDir 선언 1, 세는 줄 1, 비용 변형 걸림${bad.length ? ' — ' + bad.slice(0, 6).join(' | ') : ''}`);
  }
  {
    const g = R.guards;
    ok(!!g.shadowThrows && !!g.missingIT, `앵커가 없으면 throw(그림자 패스 글자 · thru 줄 없음): ${(g.shadowThrows || '').slice(0, 60)}`);
  }

  console.log('\n[U4b·U4c] 끄기·균일변수·텍스처');
  ok(R.u4bToggle.length === 0, '실행 중 tsun 1(아치·아틀라스) → 0: 구름 조각·정점·그림자·균일변수·define = C0ps' + (R.u4bToggle.length ? ' — 다름 ' + R.u4bToggle.join(',') : ''));
  ok(R.u4c.offNames.length === 0 && R.u4c.offAtlasNames.length === 0, '끄면 두 재질에 gTsun…·gArch… 균일변수 없음(아틀라스를 걸어도)');
  ok(R.u4c.onNames.sort().join() === ['gArchNoT', 'gArchW', 'gTsunCond', 'gTsunEpoch', 'gTsunFrame', 'gTsunLaneBlock', 'gTsunOn', 'gTsunProf', 'gTsunTex'].join(), '켜면(아치) 구름 패스에 균일변수 9 개(§179 검토 반영 gTsunProf 더함) ' + JSON.stringify(R.u4c.onNames));
  ok(R.u4c.texOff === R.u4c.texOn, `텍스처를 새로 만들지 않음 — 같은 길에서 만든 텍스처 수 끔 ${R.u4c.texOff - 1} · 켬 ${R.u4c.texOn - 1}`);
  ok(R.u4c.offAtlasInfo.atlasValid === false && R.u4c.offAtlasInfo.injected === false, 'tsun 0 에 아틀라스를 걸어도 무효·글자 없음');

  console.log('\n[U4d] 옵션 점검');
  {
    const d = R.u4d, thr = k => typeof d[k] === 'string', none = k => d[k] === null;
    ok(thr('diff2Create') && thr('diff2OptsCreate') && thr('diff3') && thr('diff9') && !!d.diff2Opts.m && d.diff2Opts.kept === true, 'diffuse ≥ 2 + tsun → throw(만들 때·setOptions, 실패한 setOptions 는 옵션을 안 바꿈) — ' + String(d.diff2OptsCreate).slice(0, 80));
    ok(none('diff1') && none('diff2Off'), 'diffuse 1 + tsun 은 됨 · tsun 0 이면 diffuse 2 됨');
    const must = ['archNoTsun', 'noTNoArch', 'badTsun', 'badTsunStr', 'badN', 'badRange', 'badRangeNaN', 'badStep', 'badSync', 'refNotImpl', 'refAndT', 'dbgNotImpl', 'dbg1NoT', 'dbgArchNoArch', 'noGenus'];
    ok(must.every(thr), '값 범위·의존·미구현(REF·진단)·genus 없음 → throw: ' + must.filter(k => !thr(k)).join(',') || 'all');
    ok(['okT', 'okA', 'okH0', 'okT2', 'okOff'].every(none), '팔 T1·T2·T1A·H0·끔은 통과');
  }

  console.log('\n[U4e] gTsunOn = 0 가지');
  {
    const t = rd(Cu.dir, 'on_low_t', 'cloudsFrag');
    const i = t.indexOf('        if (gTsunOn > 0.5) {\n          vec4 gTsunTauBelow');
    const e = t.indexOf('        } else {\n' + R.consts.itAnchor + '\n        }', i);
    ok(i > 0 && e > i && count(t, R.consts.itAnchor) === 1, 'I-T: `if (gTsunOn > 0.5) { V10b } else { <원래 thru 줄 글자 그대로> }` — 원래 줄 1 번, else 가지 안');
    const i2 = t.indexOf('      if (gTsunOn > 0.5 && max(sunIrradiance.r');
    ok(i2 > 0 && t.indexOf('vec3 gTsunIrrUncut = sunIrradiance;') < i2 && t.indexOf('sunIrradiance *= exp(-gTsunTau);') > i2, 'I-2: gTsunOn = 0 이면 sunIrradiance·thru 가 손대지 않은 값(곱하기는 gTsunOn 가지 안)');
  }

  console.log('\n[U4g] 해 > 12° = C0ps 글자');
  for (const a of ['0', '1']) {
    const g = R.u4g[a];
    ok(g.dayEq.length === 0 && g.backEq.length === 0 && g.infoDay.injected === false, `${a === '1' ? '아치' : 'T'} 팔 낮 글자·균일변수·define = C0ps 낮, 박명 다녀와도 같음${g.dayEq.length || g.backEq.length ? ' — 다름 ' + [...g.dayEq, ...g.backEq].join(',') : ''}`);
    ok(g.twDiff.join() === 'cloudsFrag,uniforms' && g.infoTw.injected === true, `${a === '1' ? '아치' : 'T'} 팔 박명: 구름 조각·균일변수만 C0ps 와 다름(정점·그림자·대기·합친 효과·define 같음) — ${g.twDiff.join(',')}`);
  }

  console.log('\n[atlas] setTsunAtlas');
  {
    const A = R.atlas;
    ok(A.before.on === 0 && A.before.info.atlasValid === false && A.before.info.reason === 'no atlas', '걸기 전: gTsunOn 0(아틀라스 없음 = C0ps 빛)');
    const fr = A.vals.frame;
    ok(A.vals.on === 1 && A.vals.tex && Math.abs(fr[0] - Math.cos(0.3)) < 1e-6 && Math.abs(fr[2] - 104) < 1e-9 && Math.abs(fr[3] - 208 / 128) < 1e-9 && A.vals.lane.join() === '0,1,-1,-1' && A.vals.epoch.join() === '1.5,-2,400,0'
      && Math.abs(A.vals.cond0[3] - 0.03) < 1e-9 && Math.abs(A.vals.cond8[0] - 0.32) < 1e-9 && A.vals.condN === 21 && A.vals.profN === 17 && Math.abs(A.vals.prof16[3] - 6.7) < 1e-9 && A.vals.archNoT === 0 && A.vals.info.atlasValid,
      `값: gTsunOn 1 · 텍스처 · 틀 ${fr.map(x => +x.toFixed(4))} · 레인 ${A.vals.lane} · 에포크 ${A.vals.epoch} · τ_c 순서(21 vec4) · λ̂ 단면(17 vec4)`);
    ok(Math.abs(A.vals.archW - 1) < 1e-12 && Math.abs(A.twArch.archW) < 1e-12 && A.twArch.info.belowShadow === true, `아치 무게 w(θ): 해 −9.8° → ${A.vals.archW} · 해 6.8° → ${A.twArch.archW}`);
    const aw = A.archWeight;
    ok(aw[0] === 0 && aw[1] === 0 && Math.abs(aw[2] - 0.5) < 1e-12 && aw[3] === 1 && aw[4] === 1, 'archWeight = smoothstep(−1°, −2°, θ): 0 / 0 / 0.5 / 1 / 1');
    ok(Object.values(A.errs).every(x => typeof x === 'string') && A.afterErrs.on === 1 && A.afterErrs.tex, '맞지 않는 아틀라스(n·장면 번호·거리·아치 블록·레인 블록) → throw, 걸린 것은 그대로');
    ok(A.stale.on === 0 && A.stale.info.atlasValid === false && /n 128 != tsunN 256/.test(A.stale.info.reason) && A.back.on === 1, '아틀라스를 건 뒤 tsunN 을 바꾸면 무효(gTsunOn 0, 이유 기록), 되돌리면 다시 유효');
    ok(A.dropped.on === 0 && /no atlas/.test(A.dropped.info.reason) && typeof A.dropped.oldThrows === 'string', 'setScene(applyScene)이 아틀라스를 버리고, 옛 장면 아틀라스는 다시 걸 수 없음');
  }

  console.log('\n[glsl] 주입 글자 자체');
  for (const a of ['t', 'a']) {
    const t = rd(Cu.dir, `on_low_${a}`, 'cloudsFrag');
    ok(balanced(t), `${a === 'a' ? '아치' : 'T'}: 괄호 () {} [] 균형(주석 뺌)`);
    const pos = n => t.indexOf(n);
    const order = ['float gTsunPath(', 'float gTsunLam(', 'float gTsunGL4(', 'float gTsunPathW(', 'vec2 gTsunUvOf(', 'float gTsunSliceTau(', 'vec4 gTsunCondAt(', 'vec4 gTsunEddDiff(', 'float gTsunReach(', 'vec4 marchClouds('];
    const orderA = ['float gArchVis(', 'float gArchDip(', 'vec3 gArchRowAxis(', 'vec3 gArchDirMid(', 'void gArchFill(', 'vec4 marchClouds('];
    const inc = arr => arr.every((n, i) => pos(n) > 0 && (i === 0 || pos(arr[i - 1]) < pos(n)));
    ok(inc(order) && (a === 't' || (inc(orderA) && pos('float phaseFunction(') < pos('void gArchFill(') && pos('GetSkyLuminance(') < pos('void gArchFill(')))
      && pos('uniform float gTsunOn;') < pos('float gTsunPath(') && pos('vec2 getGlobeUv(') < pos('vec2 gTsunUvOf('), `${a === 'a' ? '아치' : 'T'}: 선언(출력 뒤) → 도움 함수(getGlobeUv·phaseFunction 뒤, marchClouds 앞) 순서`);
    ok(pos('layout(location = 0) out vec4 outputColor;') < pos('uniform float gTsunOn;') && pos('uniform float gTsunOn;') < pos('void main()'), `${a === 'a' ? '아치' : 'T'}: 균일변수 선언이 출력 선언 바로 뒤·main 앞`);
  }
  {
    const t = rd(Cu.dir, 'on_low_t', 'cloudsFrag');
    const fn = glslFn(t, 'gTsunPath');
    const Rkm = 6360;
    let worst = 0, n = 0;
    try {
      const js = toJs(fn, { bottomRadius: Rkm * 1000 });
      for (const [hb, ht] of [[1.0, 2.0], [1.5, 2.25], [3.0, 3.4], [7.0, 9.0]]) for (const eDeg of [1.108, 0.3, 0.0, -0.25, -0.5, -1.0, -1.5, 5, 12]) for (const f of [0.02, 0.35, 0.68, 1.0, -0.3, 1.2]) {
        const h0 = hb + f * (ht - hb), sinE = Math.sin(eDeg * Math.PI / 180);
        const g = js(h0, sinE, hb, ht, 400), b = bruteInLayer(h0, sinE, hb, ht, 400, Rkm);
        if (b > 0.1 || g > 0.1) { worst = Math.max(worst, Math.abs(g - b) / (4 * BRUTE_DS + 1e-4 * b)); n++; }
      }
      ok(n > 50 && worst <= 1, `u_true(gTsunPath, 주입 글자에서 옮김) vs ${BRUTE_DS * 1000} m 무차별 적분: ${n} 경우, |차| / (경계 4 개 × 보폭 + 1e-4·길이) 최대 ${worst.toFixed(3)} ≤ 1 (층 4 · 해 −1.5..+12° · 층 안·밑·위 시작)`);
    } catch (e) { ok(false, 'gTsunPath 옮기기 실패: ' + e.message); }
  }

  // §179 검토 반영: 조각 보간·τ_c 표를 글자에서 옮겨 CPU 거울(tsunAtlas.ts)과 대조 — 셰이더 = 거울이어야 U2g·U4h 가 셰이더를 잰 것
  {
    const t = rd(Cu.dir, 'on_low_t', 'cloudsFrag');
    try {
      const cjs = path.join(WORK, 'tsunAtlas-mirror.cjs');
      execFileSync('npx', ['esbuild', path.join(ROOT, 'src/components/VolumetricProbe/tsunAtlas.ts'), '--bundle', '--format=cjs', '--platform=node', `--outfile=${cjs}`, '--log-level=error'], { cwd: ROOT, stdio: 'inherit' });
      const TA = require(cjs);
      const fns = ['float gTsunPath(', 'float gTsunLam(', 'float gTsunGL4(', 'float gTsunPathW(', 'float gTsunSliceTau(', 'vec3 gTsunTent(', 'vec4 gTsunCondAt('].map(h => { const f = glslFnHead(t, h); if (!f) throw new Error('no ' + h); return f; });
      const js = glslToJs(fns.join('\n'));
      const V = (...a) => { const o = a.slice(); Object.assign(o, { get x() { return o[0]; }, get y() { return o[1]; }, get z() { return o[2]; }, get w() { return o[3]; } });
        Object.defineProperty(o, 'xy', { get: () => V(o[0], o[1]) }); Object.defineProperty(o, 'yz', { get: () => V(o[1], o[2]) }); Object.defineProperty(o, 'zw', { get: () => V(o[2], o[3]) }); return o; };
      const env = { mix: (a, b, k) => a + (b - a) * k, clamp: (x, a, b) => Math.min(Math.max(x, a), b), dot: (a, b) => a * b, vec2: V, vec3: V, vec4: V, bottomRadius: 6360e3 };
      const mkG = (prof, cond) => new Function(...Object.keys(env), 'gTsunProf', 'gTsunCond', js + '\nreturn { gTsunSliceTau, gTsunCondAt, gTsunPathW };')(...Object.values(env), prof, cond);
      const rr = (() => { let q = 12345; return () => { q = (q * 1103515245 + 12345) % 2147483648; return q / 2147483648; }; })();
      let worstS = 0, worstC = 0, worstW = 0, nS = 0;
      for (let rep = 0; rep < 40; rep++) {
        const NP = R.consts.profN, NC = R.consts.condLen;
        const prof4 = new Array(NP * 4).fill(0), cond4 = new Array(NC).fill(0);
        for (let k = 0; k < NP; k++) prof4[k * 4] = Math.max(0, 0.2 + 2 * Math.sin(k * 0.7 + rep) ** 2);
        for (let k = 0; k < NC / 4; k++) cond4[k * 4] = 3 * rr();
        const G = mkG(Array.from({ length: NP }, (_, k) => prof4[k * 4]), Array.from({ length: NC / 4 }, (_, k) => cond4[k * 4]));
        for (let q = 0; q < 25; q++) {
          const hb = 0.5 + 6 * rr(), ht = hb + 0.3 + 2.5 * rr(), he = hb + (ht - hb) * (-0.05 + 1.1 * rr()), sinE = Math.sin((-1.5 + 14 * rr()) * Math.PI / 180);
          const tex = [5 * rr(), 4 * rr(), 3 * rr(), 2 * rr()];
          const a = G.gTsunSliceTau(V(...tex), he, hb, ht, sinE, 400, 1), b = TA.tsunSliceTauCpu(tex, he, hb, ht, sinE, 400, 6360, prof4, 0);
          worstS = Math.max(worstS, Math.abs(a - b) / Math.max(1e-6, Math.abs(b))); nS++;
          const w1 = G.gTsunPathW(he, sinE, hb, ht, 400, 1), w2 = TA.tsunPathWKm(he, sinE, hb, ht, 400, 6360, prof4, 0);
          worstW = Math.max(worstW, Math.abs(w1 - w2) / Math.max(1e-6, Math.abs(w2)));
          const hf = -0.1 + 1.2 * rr(), reach = 1.4 * rr();
          worstC = Math.max(worstC, Math.abs(G.gTsunCondAt(hf, reach) - TA.tsunCondAtCpu(cond4, Math.min(1, Math.max(0, hf)), reach, 0)));
        }
      }
      ok(nS === 1000 && worstS < 1e-9 && worstW < 1e-9 && worstC < 1e-9, `조각 보간(gTsunSliceTau·gTsunPathW·gTsunGL4·gTsunLam)·τ_c(gTsunCondAt) 글자 = CPU 거울(tsunSliceTauCpu·tsunPathWKm·tsunCondAtCpu): ${nS} 경우 상대 최대 ${worstS.toExponential(1)} · W ${worstW.toExponential(1)} · τ_c ${worstC.toExponential(1)}`);
    } catch (e) { ok(false, '조각 보간·τ_c 글자 옮기기 실패: ' + e.message); }
    const ta = rd(Cu.dir, 'on_low_a', 'cloudsFrag');
    ok(count(ta, '#if defined(MULTI_SCATTERING_OCTAVES) && MULTI_SCATTERING_OCTAVES != 8') === 1 && count(ta, '#error T_sun arch octave count 8') === 1 && /"MULTI_SCATTERING_OCTAVES":"8"/.test(rd(Cu.dir, 'on_low_a_tw', 'defines')),
      '아치 옥타브 정적 단언(#if … #error, 검토 물리 12) 한 번 · 구름 패스 define MULTI_SCATTERING_OCTAVES 8');
  }

  console.log('\n[bundle] 앱 묶음에 하네스 글자가 없음(검토 회귀 1)');
  {
    const out = {};
    for (const [tag, tree] of [['base', BASE_TREE], ['cur', ROOT]]) {
      const f = path.join(WORK, `vs-${tag}.js`);
      execFileSync('npx', ['esbuild', 'src/components/VolumetricProbe/volumetricScene.ts', '--bundle', '--minify', '--format=esm', '--external:three', '--external:postprocessing', '--external:@takram/*', '--define:__DEV__=false', `--outfile=${f}`, '--log-level=error'],
        { cwd: tree, stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') } });
      out[tag] = fs.readFileSync(f, 'utf8');
    }
    const harness = ['gTsunRefMarch', 'LP3-fixture', 'gTsunSliceTau', 'gArchFill', 'tsunLineTau', '§179 I-2'].filter(x => out.cur.includes(x));
    ok(harness.length === 0, `축소 묶음(volumetricScene.ts, three·postprocessing·takram 밖)에 구축기·셰이더 글자 없음 — ${out.base.length} → ${out.cur.length} B (+${out.cur.length - out.base.length} B [measured]: 옵션 점검·균일변수·주입 등록만)` + (harness.length ? ' — 있음: ' + harness.join(',') : ''));
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} pass / ${fail} fail (작업 폴더 ${WORK})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
