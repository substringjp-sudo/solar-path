/**
 * §178 앱 조명 결함 고침 합격 판정 — 브라우저 없음. esbuild 로 앱의 createVolumetricScene 을 묶어 **가짜 렌더러**(GL 호출 없음)로 돌리고,
 * 셰이더 글자·층 그림자 상태를 봅니다(그리지 않음). 조도 보간은 앱 15 파장 조도 표(fixtures/irradiance-app15.json)로 CPU 에서 잽니다.
 *   node tools/shader-preview/verify-lighting-fixes.js [--base 08a9c4d] [--work DIR]
 * 임시 출력은 os.tmpdir()(TMPDIR) 아래 새 폴더(--work 로 바꿈). 비교 기준 트리(--base, 기본 08a9c4d = 고치기 직전 커밋)는 git archive 로 꺼냅니다.
 *
 *  [a] 묶기: 지금 트리와 기준 트리를 같은 하네스로 각각 묶어 돌림(같은 장면·옵션·품질 low/medium/high).
 *  [b] 셰이더 글자: 두 옵션을 끄면 구름 패스 조각·정점·그림자 패스·대기 효과(합치기 전·EffectPass 가 합친 뒤) 글자가 기준 트리와 바이트 같음 ·
 *      켜면 앵커마다 정확히 한 번(표지 '§178 …' 수) · 켠 글자 = 기준 글자에 주입 함수를 건 것 · 실행 중 켜고 끄기가 원래 글자로 돌아감 ·
 *      종류 변형(확산 2·얼음 무리·grain 손잡이)과 함께여도 한 번.
 *  [c] 그림자 드리움(g2): 층 구성 다섯 가지 × 시간 이동(낮 → 박명 → 낮, 해 12° 위로 넘기, 박명 재구축) 마다 setDate 상태 = 그 시각에 새로 만든 장면의
 *      상태(층별 shadow·마스크·shadowTopHeight·shadowBottomHeight). 드리우는 층이 없으면 꼭대기·밑 0. 기준 트리는 결함을 재현(10.4 km).
 *  [d] 조도 μs 로그 보간(이웃 텍셀 비 가중): GLSL 을 그대로 옮긴 CPU 함수 vs 예전 선형, 앱 15 파장 표 · 세밀 기준 표(μs 8 배 · 산란 표 μs 4 배로
 *      다시 계산). 문턱은 이 파일에 고정(검토: 시험받는 모듈에서 읽지 않음) — 해 ≥ +1° 는 예전 선형과 같음(≤ 1e−9) · 모든 띠에서 보간 오차·출렁임이
 *      예전보다 나쁘지 않음 · 깊은 박명 과밝음·출렁임 5 배 이상 줄어듦 · 절점·가장자리·0·음수·half-float(+ FTZ 는 보고만).
 *  [e] 산란 자르기: 켠 셰이더 글자의 합성 줄을 채널별 식으로 계산 — 음수 산란 → 0 기여, 양수 그대로; 끈 글자는 음수가 그대로 빠짐.
 *  [f] 적대 시나리오(§178 검토 adv.ts 에서 옮김): 빠른 무작위 시간 이동 · 12° 경계 ±1 ms · 층 구성 바꾸기 · 비동기 재구축 경쟁·취소 · 품질 바꾸기 ·
 *      실행 중 토글(손 recompile 없는 사건 길) · 재질 version · 대기 효과 꼭대기 · 두 인스턴스.
 */
const path = require('path'); const os = require('os'); const fs = require('fs'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const BASE_REV = arg('--base', '08a9c4d');
const WORK = arg('--work', null) ? path.resolve(arg('--work')) : fs.mkdtempSync(path.join(os.tmpdir(), 'lightfix-'));
fs.mkdirSync(WORK, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const count = (s, a) => s.split(a).length - 1;
const fmt = (x, d = 4) => (x == null || !Number.isFinite(x) ? String(x) : x.toFixed(d));

// ───────────────────────── [a] 하네스(두 트리 공통) ─────────────────────────
const JST = s => s + '+09:00';
const T = {   // 후쿠이 P1 10/02 — 해 고도는 엔진값(§177 defects.json): 15:00 29.6° · 17:00 6.8° · 18:22 −9.8° · 06:40 9.1° · 06:58 12.7° · 07:10 15.0° · 16:15 15.6° · 16:40 10.7° · 16:45 9.7°
  day: JST('2026-10-02T15:00:00'), eve: JST('2026-10-02T17:00:00'), tw: JST('2026-10-02T18:22:21'),
  m0640: JST('2026-10-02T06:40:00'), m0658: JST('2026-10-02T06:58:00'), m0710: JST('2026-10-02T07:10:00'),
  e1615: JST('2026-10-02T16:15:00'), e1640: JST('2026-10-02T16:40:00'), e1645: JST('2026-10-02T16:45:00'),
};
const CONFIGS = {
  lowOnly: [{ genus: 'sc', cover: 0.45, baseKm: 1.5, thicknessM: 750, band: 'low', opts: { seed: 4242 } }, { genus: null, cover: 0, baseKm: 4.5, band: 'mid' }, { genus: null, cover: 0, baseKm: 10.0, band: 'high' }],
  withCi: [{ genus: 'sc', cover: 0.45, baseKm: 1.5, thicknessM: 750, band: 'low', opts: { seed: 4242 } }, { genus: null, cover: 0, baseKm: 4.5, band: 'mid' }, { genus: 'ci', cover: 0.3, baseKm: 9.0, band: 'high', opts: { seed: 77 } }],
  plainHigh: [{ genus: 'cu', cover: 0.3, baseKm: 1.2, band: 'low', opts: { seed: 11 } }, { genus: 'ac', cover: 0.4, baseKm: 4.0, band: 'mid', opts: { seed: 5 } }, { genus: null, cover: 0.3, baseKm: 9.5, band: 'high' }],
  allCover0: [{ genus: null, cover: 0, baseKm: 1.5, band: 'low' }, { genus: null, cover: 0, baseKm: 4.5, band: 'mid' }, { genus: null, cover: 0, baseKm: 10.0, band: 'high' }],
  highOnly: [{ genus: null, cover: 0.4, baseKm: 10.0, band: 'high' }],
  four: [{ genus: 'sc', cover: 0.45, baseKm: 1.5, thicknessM: 750, band: 'low', opts: { seed: 4242 } }, { genus: 'ac', cover: 0.4, baseKm: 4.0, band: 'mid', opts: { seed: 5 } }, { genus: null, cover: 0, baseKm: 7.5, band: 'high' }, { genus: 'ci', cover: 0.3, baseKm: 9.0, band: 'high', opts: { seed: 77 } }],
};
const SEQS = {
  dayTwDay: [['scene', T.day], ['date', T.eve], ['date', T.tw], ['date', T.day], ['date', T.e1615]],
  upCross12: [['scene', T.m0640], ['date', T.m0658], ['date', T.m0710]],
  twRebuild: [['scene', T.day], ['date', T.tw], ['scene', T.tw], ['date', T.day]],
  eveUpDown: [['scene', T.e1645], ['date', T.e1615], ['date', T.e1640], ['date', T.e1615]],
};
const LAT = 36.046, LON = 136.278;
const SCENE = { lat: LAT, lon: LON, heightM: 23, az: 272, el: 10, fov: 60 };
const VARIANTS = { diffuse: 2, iceHalo: true, refineOnHit: 1, jitterMode: 1, erodeCentered: 2, sunLowpass: 1 };
const OFF = { clampInscatter: false, irradianceLogMu: false };
const ON = { clampInscatter: true, irradianceLogMu: true };   // 앱 길(SkyScene3D·VolumetricProbe)이 넘기는 값 — DEFAULT_VOLUMETRIC_OPTIONS 는 끔(§178 검토)
const TEXT_RUNS = [
  ...['low', 'medium', 'high'].flatMap(q => [{ tag: q + '_off', quality: q, options: OFF }, { tag: q + '_on', quality: q, options: ON }]),
  { tag: 'low_default', quality: 'low', options: {} },   // 옵션을 안 넘기는 하네스 길(동결 grain·tsun 꾸러미) = 고치기 전 글자
  { tag: 'low_clamp', quality: 'low', options: { clampInscatter: true, irradianceLogMu: false } },
  { tag: 'low_logmu', quality: 'low', options: { clampInscatter: false, irradianceLogMu: true } },
  { tag: 'low_var_off', quality: 'low', options: { ...VARIANTS, ...OFF } },
  { tag: 'low_var_on', quality: 'low', options: { ...VARIANTS, ...ON } },
  { tag: 'low_toggle', quality: 'low', options: ON, toggle: true },   // 켠 채 만들고 → 끔(reapply) → 켬
];

const HARNESS = (tree, isCur) => `
import fs from 'node:fs';
import path from 'node:path';
import { Vector2 } from 'three';
import { EffectComposer } from 'postprocessing';
import { createVolumetricScene, DEFAULT_VOLUMETRIC_OPTIONS } from '${tree}/src/components/VolumetricProbe/volumetricScene';
${isCur ? `import * as LF from '${tree}/src/components/VolumetricProbe/lightingFix';` : ''}
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];
const W = 390, H = 584;
const gl = { getContextAttributes: () => ({ alpha: false }), getExtension: () => null, getParameter: () => 0 };
const renderer: any = { getSize: (v: Vector2) => v.set(W, H), getDrawingBufferSize: (v: Vector2) => v.set(W, H), getPixelRatio: () => 1,
  getContext: () => gl, outputColorSpace: 'srgb-linear', autoClear: true, toneMappingExposure: 1, capabilities: { logarithmicDepthBuffer: false, isWebGL2: true } };
const passes: any[] = [];
const origAdd = (EffectComposer.prototype as any).addPass;
(EffectComposer.prototype as any).addPass = function (p: any, i?: number) { passes.push(p); return origAdd.call(this, p, i); };
const fakeTex = { isTexture: true } as any;
const mk = async (options: any, quality: string) => {
  passes.length = 0;
  const v: any = await createVolumetricScene(renderer, W, H, { genus: true, celestial: false, precomputed: {} as never });
  const ps = passes.slice();
  v.setOptions({ ...DEFAULT_VOLUMETRIC_OPTIONS, genus: true, celestial: false, macro: 1, ...options }, false);   // 하늘 화면(SkyScene3D) 길
  v.setQuality(quality);
  v.setResolutionScale(0.5);
  return { v, ps };
};
const inp = (iso: string, layers: any[]) => ({ ...cfg.scene, date: new Date(iso), layers });
const aerialOf = (ps: any[]) => { for (const p of ps) for (const e of (p.effects ?? [])) if (typeof e.getFragmentShader === 'function' && e.getFragmentShader().includes('volBaseImage')) return { pass: p, effect: e }; return null; };
const dumpTexts = (tag: string, v: any, ps: any[]) => {
  const c = v.debug.clouds, a = aerialOf(ps)!;
  let merged = '';
  try { a.pass.recompile(); merged = a.pass.fullscreenMaterial.fragmentShader; } catch (e: any) { merged = 'ERR ' + (e && e.message); }
  const t: Record<string, string> = { cloudsFrag: c.cloudsPass.currentMaterial.fragmentShader, cloudsVert: c.cloudsPass.currentMaterial.vertexShader,
    shadowFrag: c.shadowPass.currentMaterial.fragmentShader, shadowVert: c.shadowPass.currentMaterial.vertexShader, aerial: a.effect.getFragmentShader(), merged };
  for (const [k, s] of Object.entries(t)) fs.writeFileSync(path.join(OUT, tag + '.' + k + '.glsl'), s);
};
const snap = (v: any) => {
  const c = v.debug.clouds;
  c.updateSharedUniforms(0);   // takram Ht — 매 프레임 update 가 하는 층 균일변수 포장
  const lu = c.layerUniforms;
  return { sunAlt: +(v.lastScene()?.sunAltDeg ?? NaN).toFixed(3), shadows: c.cloudLayers.map((l: any) => !!l.shadow), heights: c.cloudLayers.map((l: any) => [l.altitude, l.height]),
    top: lu.shadowTopHeight.value, bottom: lu.shadowBottomHeight.value, mask: lu.shadowLayerMask.value.toArray(),
    cloudPassTop: c.cloudsPass.currentMaterial.uniforms.shadowTopHeight.value, shadowPassMask: c.shadowPass.currentMaterial.uniforms.shadowLayerMask.value.toArray() };
};

// ───── [f] 적대 시나리오 — 상태 = 그 시각에 새로 만든 장면, 글자 표지 = 지금 플래그 ─────
const castKey = (s: any) => JSON.stringify([s.shadows, s.mask, s.top, s.bottom, s.cloudPassTop]);
const M_CL = '§178 clampInscatter', M_LM = '§178 irradianceLogMu';
const nOf = (s: string, t: string) => s.split(t).length - 1;
const marksOf = (v: any, ps: any[]) => {   // 손 recompile 없이(앱 길)
  const c = v.debug.clouds, a = aerialOf(ps)!;
  const t = { f: c.cloudsPass.currentMaterial.fragmentShader, vt: c.cloudsPass.currentMaterial.vertexShader, a: a.effect.getFragmentShader(), m: a.pass.fullscreenMaterial.fragmentShader, s: c.shadowPass.currentMaterial.fragmentShader };
  return [nOf(t.f, M_CL), nOf(t.f, M_LM), nOf(t.vt, M_LM), nOf(t.a, M_CL), nOf(t.a, M_LM), nOf(t.m, M_CL), nOf(t.m, M_LM), nOf(t.s, '§178')].join('');
};
const want = (c: boolean, g: boolean) => [+c, +g, +g, +c, +g, +c, +g, 0].join('');
async function adversarial(cfg: any) {
  const out: any[] = [];
  const rec = (ok: boolean, name: string, detail?: unknown) => out.push({ ok, name, detail: ok ? undefined : detail });
  const L = cfg.configs, ON = cfg.on;
  const J = (s: string) => new Date(s + '+09:00');
  const DAY = J('2026-10-02T15:00:00'), TW = J('2026-10-02T18:22:21'), M0640 = J('2026-10-02T06:40:00');
  const cache = new Map<string, any>();
  const fresh = async (d: Date, layers: any[], options: any = ON, quality = 'low') => {
    const k = d.toISOString() + JSON.stringify(layers) + JSON.stringify(options) + quality;
    if (!cache.has(k)) { const f = await mk(options, quality); f.v.setScene(inp(d.toISOString(), layers)); cache.set(k, snap(f.v)); }
    return cache.get(k);
  };
  const probe = (await mk(ON, 'low')).v; probe.setScene(inp(DAY.toISOString(), L.lowOnly));
  const sunAt = (d: Date) => { probe.setDate(d); return probe.lastScene().sunAltDeg as number; };
  // A 빠른 시간 이동(씨앗 고정 무작위 setDate, 아침·저녁 — 12° 를 여러 번 오르내림)
  let rng = 12345; const rnd = () => ((rng = (rng * 1103515245 + 12345) >>> 0) / 4294967296);
  for (const cname of ['four', 'withCi', 'lowOnly', 'highOnly']) {
    const layers = L[cname], fDay = await fresh(DAY, layers), fTw = await fresh(TW, layers);
    const { v } = await mk(ON, 'low'); v.setScene(inp(M0640.toISOString(), layers));
    let bad: any = null;
    for (let k = 0; k < 120 && !bad; k++) {
      const t = rnd() < 0.5 ? J('2026-10-02T05:30:00').getTime() + rnd() * 3 * 3600e3 : J('2026-10-02T15:00:00').getTime() + rnd() * 3.5 * 3600e3;
      v.setDate(new Date(Math.round(t)));
      const s = snap(v);
      if (castKey(s) !== castKey(s.sunAlt > 12 ? fDay : fTw)) bad = { k, sun: s.sunAlt, got: castKey(s) };
    }
    rec(!bad, 'A ' + (cname) + ': 무작위 setDate 120 번 — 매번 새 장면 상태와 같음', bad);
  }
  // B 해 고도 12° 경계(1 ms 까지 이분) 양쪽
  {
    let lo = J('2026-10-02T06:40:00').getTime(), hi = J('2026-10-02T07:10:00').getTime();
    while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (sunAt(new Date(m)) > 12) hi = m; else lo = m; }
    const dLo = new Date(lo), dHi = new Date(hi);
    for (const cname of ['four', 'withCi']) {
      const layers = L[cname], fLo = await fresh(dLo, layers), fHi = await fresh(dHi, layers);
      const { v } = await mk(ON, 'low');
      v.setScene(inp(dLo.toISOString(), layers)); const a = snap(v);
      v.setDate(dHi); const b = snap(v); v.setDate(dLo); const c = snap(v);
      const { v: w } = await mk(ON, 'low'); w.setScene(inp(dHi.toISOString(), layers)); w.setDate(dLo); const e = snap(w);
      rec([a, c, e].every(x => castKey(x) === castKey(fLo)) && castKey(b) === castKey(fHi),
        'B ' + (cname) + ': 12° ±1 ms (' + (sunAt(dLo).toFixed(7)) + '° | ' + (sunAt(dHi).toFixed(7)) + '°) 양쪽이 새 장면과 같음', { a: a.top, b: b.top, c: c.top, e: e.top, fLo: fLo.top, fHi: fHi.top });
    }
  }
  // C 층 구성을 applyScene 사이에 바꿈(빈 목록 포함)
  {
    const sets: Record<string, any[]> = { ...L, empty: [] };
    const pairs: [string, string, Date, Date][] = [['four', 'highOnly', DAY, TW], ['four', 'lowOnly', TW, DAY], ['highOnly', 'four', TW, DAY], ['four', 'empty', DAY, TW], ['empty', 'four', TW, DAY], ['withCi', 'allCover0', TW, DAY]];
    for (const [a, b, d1, d2] of pairs) {
      const { v } = await mk(ON, 'low');
      v.setScene(inp(d1.toISOString(), sets[a])); v.setDate(d2); v.setScene(inp(d2.toISOString(), sets[b]));
      const s1 = snap(v), f1 = await fresh(d2, sets[b]);
      v.setDate(d1); const s2 = snap(v), f2 = await fresh(d1, sets[b]);
      rec(castKey(s1) === castKey(f1) && castKey(s2) === castKey(f2), 'C 층 ' + (a) + ' → ' + (b) + ' 뒤 시간 이동 = 새 장면', { s1: castKey(s1), f1: castKey(f1), s2: castKey(s2), f2: castKey(f2) });
    }
  }
  // G 비동기 재구축 중 시간 이동 · 동기 setScene 이 비동기를 취소
  {
    const { v } = await mk(ON, 'low');
    v.setScene(inp(DAY.toISOString(), L.highOnly));
    const nl = L.four.map((l: any, i: number) => ({ ...l, opts: l.opts ? { ...l.opts, seed: 900 + i } : undefined }));
    const pr = v.setSceneAsync(inp(M0640.toISOString(), nl));
    v.setDate(TW); const m1 = snap(v); v.setDate(DAY); const m2 = snap(v);
    const r1 = await pr; v.setDate(DAY); const s2 = snap(v);
    const fHD = await fresh(DAY, L.highOnly), fHT = await fresh(TW, L.highOnly), fN = await fresh(DAY, nl);
    rec(castKey(m1) === castKey(fHT) && castKey(m2) === castKey(fHD), 'G 비동기 재구축을 기다리는 동안 시간 이동은 옛 층·옛 자격', { m1: castKey(m1), m2: castKey(m2) });
    rec(r1 !== false && castKey(s2) === castKey(fN), 'G 비동기 재구축 뒤 낮 = 새 장면', { r1, s2: castKey(s2), fN: castKey(fN) });
    const pr2 = v.setSceneAsync(inp(DAY.toISOString(), nl.map((l: any) => ({ ...l, opts: l.opts ? { ...l.opts, seed: (l.opts.seed ?? 0) + 1 } : undefined }))));
    v.setScene(inp(DAY.toISOString(), L.highOnly));
    const r2 = await pr2; v.setDate(TW); v.setDate(DAY);
    rec(r2 === false && castKey(snap(v)) === castKey(fHD), 'G 취소된 비동기 결과의 자격이 새지 않음', { r2 });
  }
  // H 품질 바꾸기 — 주입 한 번씩, 정점 글자·그림자 상태 그대로
  {
    const { v, ps } = await mk(ON, 'low'); v.setScene(inp(DAY.toISOString(), L.four));
    const vt0 = v.debug.clouds.cloudsPass.currentMaterial.vertexShader, s0 = castKey(snap(v));
    for (const q of ['high', 'medium', 'low', 'high']) {
      v.setQuality(q);
      rec(marksOf(v, ps) === want(true, true) && v.debug.clouds.cloudsPass.currentMaterial.vertexShader === vt0 && castKey(snap(v)) === s0, 'H setQuality(' + (q) + ') — 표지 ' + (marksOf(v, ps)) + ', 정점 글자·그림자 상태 그대로');
    }
  }
  // I 실행 중 두 옵션 네 조합(손 recompile 없이 합친 효과 글자가 따라옴) · 재질 version · 다른 변형과 순서
  for (const reapply of [false, true]) {
    const { v, ps } = await mk(ON, 'low'); v.setScene(inp(DAY.toISOString(), L.four));
    for (const [c, g] of [[false, false], [true, false], [false, true], [true, true]] as [boolean, boolean][]) {
      v.setOptions({ clampInscatter: c, irradianceLogMu: g }, reapply);
      rec(marksOf(v, ps) === want(c, g), 'I reapply=' + (reapply) + ' → clamp ' + (c) + ' · logμ ' + (g) + ': 표지 ' + (marksOf(v, ps)) + ' (기대 ' + (want(c, g)) + ', 손 recompile 없음)');
    }
  }
  {
    const { v } = await mk(ON, 'low'); v.setScene(inp(DAY.toISOString(), L.four));
    const ver = () => v.debug.clouds.cloudsPass.currentMaterial.version as number;
    const v0 = ver(); v.setOptions({ clampInscatter: false }, false); const v1 = ver(); v.setOptions({ irradianceLogMu: false }, false); const v2 = ver(); v.setOptions({ irradianceLogMu: false }, false); const v3 = ver();
    rec(v1 > v0 && v2 > v1 && v3 === v2, 'I 재질 version: 실제로 바꿀 때만 오름 (' + (v0) + ' → ' + (v1) + ' → ' + (v2) + ' → ' + (v3) + ')');
    const VAR = cfg.variants;
    const A = await mk({ ...VAR, ...ON }, 'low'); A.v.setScene(inp(DAY.toISOString(), L.four));
    const B = await mk(cfg.off, 'low'); B.v.setScene(inp(DAY.toISOString(), L.four)); B.v.setOptions({ ...VAR }, true); B.v.setOptions(ON, false);
    const fA = A.v.debug.clouds.cloudsPass.currentMaterial, fB = B.v.debug.clouds.cloudsPass.currentMaterial;
    rec(fA.fragmentShader === fB.fragmentShader && fA.vertexShader === fB.vertexShader, 'I 변형(확산 2·얼음 무리·grain) + 고침: 켜는 순서와 무관하게 같은 글자');
    const C = await createVolumetricScene(renderer, W, H, { genus: true, celestial: false, precomputed: {} as never, ...ON } as any);
    C.setScene(inp(DAY.toISOString(), L.four) as any);
    rec((C as any).debug.clouds.cloudsPass.currentMaterial.fragmentShader.includes(M_LM) && (C as any).debug.clouds.cloudsPass.currentMaterial.vertexShader.includes(M_LM), 'I 만들 때 옵션으로 켬(VolumetricProbe 길) — 구름 조각·정점 글자에 표지');
  }
  // J 대기 효과가 받는 shadowTopHeight — 낮 > 0 → 박명 0 → 낮 같은 값
  {
    const { v, ps } = await mk(ON, 'low'); v.setScene(inp(DAY.toISOString(), L.four));
    const c = v.debug.clouds, a = aerialOf(ps)!;
    const step = () => { c.updateSharedUniforms(0); c.updateAtmosphereComposition(); a.effect.updateShadow?.(); return a.effect.uniforms.get('shadowTopHeight')?.value; };
    const d0 = step(); v.setDate(TW); const d1 = step(); v.setDate(DAY); const d2 = step();
    rec(d0 > 0 && d1 === 0 && d2 === d0, 'J 대기 효과 shadowTopHeight 낮 ' + (d0) + ' → 박명 ' + (d1) + ' → 낮 ' + (d2));
  }
  // M 두 인스턴스(메인·카메라 화면) — 한쪽을 꺼도 다른 쪽 그대로
  {
    const A = await mk(ON, 'low'); A.v.setScene(inp(DAY.toISOString(), L.four));
    const B = await mk(ON, 'low'); B.v.setScene(inp(DAY.toISOString(), L.four));
    A.v.setOptions(cfg.off, false);
    rec(marksOf(A.v, A.ps) === want(false, false) && marksOf(B.v, B.ps) === want(true, true), 'M 두 인스턴스 독립');
  }
  return out;
}
(async () => {
  const res: any = { runs: {}, cast: {}, fresh: {} };
  if (${isCur}) res.lf = { LOG_MU_FLOOR: (LF as any).LOG_MU_FLOOR, LOG_MU_RAMP_LO: (LF as any).LOG_MU_RAMP_LO, LOG_MU_RAMP_HI: (LF as any).LOG_MU_RAMP_HI, IRRADIANCE_ANCHOR: (LF as any).IRRADIANCE_ANCHOR,
    INSCATTER_CLOUDS_ANCHOR: (LF as any).INSCATTER_CLOUDS_ANCHOR, INSCATTER_AERIAL_ANCHOR: (LF as any).INSCATTER_AERIAL_ANCHOR, defaults: { clampInscatter: (DEFAULT_VOLUMETRIC_OPTIONS as any).clampInscatter, irradianceLogMu: (DEFAULT_VOLUMETRIC_OPTIONS as any).irradianceLogMu } };
  // [b] 글자
  for (const run of cfg.textRuns) {
    const { v, ps } = await mk(run.options, run.quality);
    v.setScene(inp(cfg.textIso, cfg.textLayers));
    v.setTerrainDistance(fakeTex, fakeTex, fakeTex, 0.03, fakeTex);
    if (!run.toggle) { dumpTexts(run.tag, v, ps); res.runs[run.tag] = true; continue; }
    dumpTexts(run.tag + '_a', v, ps);
    // 앱 길: setFragmentShader → 'change' 사건 → EffectPass 가 스스로 다시 합침. 손으로 recompile 하기 전 글자를 따로 남김(§178 검토: 사건 길 시험).
    const mergedNow = () => aerialOf(ps)!.pass.fullscreenMaterial.fragmentShader;
    v.setOptions({ clampInscatter: false, irradianceLogMu: false }, true); fs.writeFileSync(path.join(OUT, run.tag + '_b.mergedNoRc.glsl'), mergedNow()); dumpTexts(run.tag + '_b', v, ps);
    v.setOptions({ clampInscatter: true, irradianceLogMu: true }, true); fs.writeFileSync(path.join(OUT, run.tag + '_c.mergedNoRc.glsl'), mergedNow()); dumpTexts(run.tag + '_c', v, ps);
    res.runs[run.tag] = true;
  }
  // 주입 함수를 기준 글자에 건 기대 글자(지금 트리만)
  if (${isCur} && cfg.baseTexts) {
    res.expect = {};
    for (const tag of Object.keys(cfg.expectFrom)) {
      const [baseTag, flags] = cfg.expectFrom[tag];
      const rd = (k: string) => fs.readFileSync(path.join(cfg.baseTexts, baseTag + '.' + k + '.glsl'), 'utf8');
      res.expect[tag] = {
        cloudsFrag: (LF as any).applyLightingFixClouds(rd('cloudsFrag'), flags) === fs.readFileSync(path.join(OUT, tag + '.cloudsFrag.glsl'), 'utf8'),
        cloudsVert: (LF as any).applyLightingFixCloudsVertex(rd('cloudsVert'), flags) === fs.readFileSync(path.join(OUT, tag + '.cloudsVert.glsl'), 'utf8'),
        aerial: (LF as any).applyLightingFixAerial(rd('aerial'), flags) === fs.readFileSync(path.join(OUT, tag + '.aerial.glsl'), 'utf8'),
      };
    }
    const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
    res.anchorGuards = { cloudsMissing: throws(() => (LF as any).injectInscatterClampClouds('x', true)), aerialMissing: throws(() => (LF as any).injectInscatterClampAerial('x', true)),
      irrMissing: throws(() => (LF as any).injectIrradianceLogMu('x', true)), irrTwice: throws(() => (LF as any).injectIrradianceLogMu((LF as any).IRRADIANCE_ANCHOR + (LF as any).IRRADIANCE_ANCHOR, true)),
      offNeverThrows: !throws(() => [(LF as any).injectInscatterClampClouds('x', false), (LF as any).injectInscatterClampAerial('x', false), (LF as any).injectIrradianceLogMu('x', false)]) };
  }
  // [c] 그림자 드리움: 시간 이동 상태 vs 그 시각에 새로 만든 장면
  for (const [cname, layers] of Object.entries(cfg.configs) as [string, any[]][]) {
    for (const [sname, seq] of Object.entries(cfg.seqs) as [string, any[]][]) {
      const { v } = await mk(cfg.on, 'low');
      const steps: any[] = [];
      for (const [op, iso] of seq) {
        if (op === 'scene') v.setScene(inp(iso, layers)); else v.setDate(new Date(iso));
        steps.push({ op, iso, ...snap(v) });
      }
      res.cast[cname + '/' + sname] = steps;
      for (const [, iso] of seq) {
        const k = cname + '@' + iso;
        if (res.fresh[k]) continue;
        const f = await mk(cfg.on, 'low');
        f.v.setScene(inp(iso, layers));
        res.fresh[k] = snap(f.v);
      }
    }
  }
  // [f] 적대 시나리오(§178 검토 adv.ts 에서 옮김) — 지금 트리만
  if (${isCur}) res.adv = await adversarial(cfg);
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(res));
})().catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
`;

function runTree(tag, tree, isCur, extraCfg) {
  const dir = path.join(WORK, tag); fs.mkdirSync(dir, { recursive: true });
  const ts = path.join(WORK, `harness-${tag}.ts`), cjs = path.join(WORK, `harness-${tag}.cjs`), cfgF = path.join(WORK, `cfg-${tag}.json`);
  fs.writeFileSync(ts, HARNESS(tree, isCur));
  fs.writeFileSync(cfgF, JSON.stringify({ scene: SCENE, textIso: T.day, textLayers: CONFIGS.four, textRuns: TEXT_RUNS, configs: CONFIGS, seqs: SEQS, on: ON, off: OFF, variants: VARIANTS, ...extraCfg }));
  // 기준 트리가 저장소 밖(WORK)이어도 three 등을 찾도록 NODE_PATH(esbuild 가 읽음) — grain-shader-test 와 같은 방식.
  execFileSync('npx', ['esbuild', ts, '--bundle', '--format=cjs', '--platform=node', '--define:__DEV__=false', '--define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY="1"', `--outfile=${cjs}`, '--log-level=error'],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') } });
  execFileSync('node', [cjs, cfgF, dir], { stdio: 'inherit' });
  return { dir, res: JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')) };
}
const rd = (dir, tag, k) => fs.readFileSync(path.join(dir, `${tag}.${k}.glsl`), 'utf8');

// ───────────────────────── [d] 조도 보간 CPU 이식 ─────────────────────────
/** IEEE half 로 반올림(아정규 포함, 0 으로 떨어짐) — half-float 표 경로. ftz = 아정규도 0(그렇게 쓰는 GPU — 보고만). */
function toHalf(x, ftz = false) {
  if (!Number.isFinite(x) || x === 0) return x;
  const s = Math.sign(x), a = Math.abs(x);
  if (a < 2 ** -24 / 2) return 0 * s;
  if (a < 2 ** -14) return ftz ? 0 * s : s * Math.round(a / 2 ** -24) * 2 ** -24;   // 아정규 간격 2^-24
  const e = Math.floor(Math.log2(a)), q = 2 ** (e - 10);
  return s * Math.min(65504, Math.round(a / q) * q);
}
/** 텍스처 한 줄(r 행 j)의 μs 축 표. I = Float64Array [rows][W][3]. */
function makeTable(arr, rows, W) { return { arr, rows, W, at: (j, i, c) => arr[(j * W + i) * 3 + c] }; }
/** Bruneton GetTextureCoordFromUnitRange. */
const coord = (x, n) => 0.5 / n + x * (1 - 1 / n);
/** 하드웨어 쌍선형(ClampToEdge) — 예전 GetIrradiance 그대로. */
function fetchLinear(T, xr, mu) {
  const u = coord(mu * 0.5 + 0.5, T.W), v = coord(xr, T.rows);
  return bilinear(T, u, v);
}
function bilinear(T, u, v) {
  const fx = u * T.W - 0.5, fy = v * T.rows - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const cx = i => Math.max(0, Math.min(T.W - 1, i)), cy = j => Math.max(0, Math.min(T.rows - 1, j));
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = T.at(cy(y0), cx(x0), c) * (1 - ax) + T.at(cy(y0), cx(x0 + 1), c) * ax;
    const b = T.at(cy(y0 + 1), cx(x0), c) * (1 - ax) + T.at(cy(y0 + 1), cx(x0 + 1), c) * ax;
    out[c] = a * (1 - ay) + b * ay;
  }
  return out;
}
/** 이 파일에 고정한 상수 — lightingFix.ts 값과 같아야 함(아래에서 대조). 시험받는 모듈의 값을 그대로 믿지 않음(§178 검토). */
const PIN = { FLOOR: 1e-30, RAMP_LO: Math.LN2, RAMP_HI: 2 * Math.LN2, DAY_FROM_DEG: 1, DAY_EXACT: 1e-9, HORIZON_TOL: 0.025, NO_WORSE: 0.002 };
/**
 * §178 GLSL(lightingFix.ts IRRADIANCE_LOG_MU)을 줄 그대로 옮김 — 두 텍셀 가운데 fetch(r 축만 하드웨어 선형) + log 보간 +
 * 채널별 log 가중(|ln B/A| 가 RAMP_LO..RAMP_HI 에서 0 → 1, 0·음수 이웃 채널은 0). mode 'pure' = 가중 없는 log(검토 전 판, 비교용).
 */
function fetchLogMu(T, xr, mu, FLOOR, mode = 'gated', ramp = [PIN.RAMP_LO, PIN.RAMP_HI]) {
  const uvx = coord(mu * 0.5 + 0.5, T.W), uvy = coord(xr, T.rows);
  const irrW = T.W;   // float(IRRADIANCE_TEXTURE_WIDTH)
  const irrX = Math.min(Math.max(uvx * irrW - 0.5, 0), irrW - 1);
  const irrI = Math.min(Math.floor(irrX), irrW - 2);
  const irrF = irrX - irrI;
  const A = bilinear(T, (irrI + 0.5) / irrW, uvy), B = bilinear(T, (irrI + 1.5) / irrW, uvy);
  return [0, 1, 2].map(c => {
    const lin = A[c] * (1 - irrF) + B[c] * irrF;
    const la = Math.log(Math.max(A[c], FLOOR)), lb = Math.log(Math.max(B[c], FLOOR));
    const lg = Math.exp(la * (1 - irrF) + lb * irrF);
    const pos = Math.min(A[c], B[c]) >= FLOOR ? 1 : 0;   // GLSL step(edge, x) = x >= edge
    const w = mode === 'pure' ? 1 : Math.min(1, Math.max(0, (Math.abs(lb - la) - ramp[0]) / (ramp[1] - ramp[0])));
    const use = pos * w;
    return lin * (1 - use) + lg * use;
  });
}
const Yof = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const muOf = deg => Math.sin(deg * Math.PI / 180);

function checkIrradiance(lf, curOnFrag) {
  console.log('\n[d] 조도 표 μs 로그 보간(이웃 텍셀 비 가중) — 앱 15 파장 표(CPU 로 다시 만든 것, fixtures/irradiance-app15.json)');
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'irradiance-app15.json'), 'utf8'));
  const f32 = b64 => { const b = Buffer.from(b64, 'base64'); return Float64Array.from(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)); };
  const C = makeTable(f32(fx.coarse), fx.coarseShape[0], fx.coarseShape[1]);
  const Fn = makeTable(f32(fx.fine), fx.fineShape[0], fx.fineShape[1]);   // 기준: μs 505 절점(64 칸 절점 포함) · r 행 0..3 (0·4·8·12 km)
  const FLOOR = PIN.FLOOR;
  ok(lf.LOG_MU_FLOOR === PIN.FLOOR && Math.abs(lf.LOG_MU_RAMP_LO - PIN.RAMP_LO) < 1e-12 && Math.abs(lf.LOG_MU_RAMP_HI - PIN.RAMP_HI) < 1e-12,
    `lightingFix 상수 = 이 파일의 고정값 (하한 ${lf.LOG_MU_FLOOR} · 램프 ${fmt(lf.LOG_MU_RAMP_LO, 6)}..${fmt(lf.LOG_MU_RAMP_HI, 6)} = ln2..ln4)`);
  // GLSL 과 이식의 대조: 이식이 기대는 줄이 구름 패스 글자에 그대로 있는지
  const F = FLOOR.toExponential(), RLO = PIN.RAMP_LO.toFixed(7), RW = (PIN.RAMP_HI - PIN.RAMP_LO).toFixed(7);
  for (const line of ['float irrW = float(IRRADIANCE_TEXTURE_WIDTH);', 'float irrX = clamp(uv.x * irrW - 0.5, 0.0, irrW - 1.0);', 'float irrI = min(floor(irrX), irrW - 2.0);', 'float irrF = irrX - irrI;',
    'vec3 irrA = texture(irradiance_texture, vec2((irrI + 0.5) / irrW, uv.y)).rgb;', 'vec3 irrB = texture(irradiance_texture, vec2((irrI + 1.5) / irrW, uv.y)).rgb;',
    `vec3 irrLa = log(max(irrA, vec3(${F})));`, `vec3 irrLb = log(max(irrB, vec3(${F})));`, 'vec3 irrLog = exp(mix(irrLa, irrLb, irrF));',
    `vec3 irrUseLog = step(vec3(${F}), min(irrA, irrB)) * clamp((abs(irrLb - irrLa) - ${RLO}) / ${RW}, 0.0, 1.0);`,
    'return IrradianceSpectrum(mix(mix(irrA, irrB, irrF), irrLog, irrUseLog));']) {
    ok(count(curOnFrag, line) === 1, `이식 대조: GLSL 줄 한 번 — ${line.slice(0, 72)}`);
  }
  const xrRow = j => j / (C.rows - 1);           // 행 j 의 텍셀 가운데(x_r) — r 축 보간 없이
  function rowFine(j, mu) {                       // 세밀 표 행 j, 505 절점 사이 log 선형(절점 간격 0.23° — 기준의 잔차는 아래에 따로 잼)
    const x = mu * 0.5 + 0.5, t = x * (Fn.W - 1), i = Math.min(Math.floor(t), Fn.W - 2), f = t - i;
    return [0, 1, 2].map(c => { const a = Fn.at(j, i, c), b = Fn.at(j, i + 1, c); return a > FLOOR && b > FLOOR ? Math.exp(Math.log(a) * (1 - f) + Math.log(b) * f) : a * (1 - f) + b * f; });
  }
  // (1) 절점·가장자리·연속
  {
    let nodeErr = 0, edgeErr = 0, jump = 0;
    for (let j = 0; j < C.rows; j++) {
      for (let i = 0; i < C.W; i++) {
        const mu = Math.max(-1, Math.min(1, 2 * (i / (C.W - 1)) - 1));
        const L = fetchLogMu(C, xrRow(j), mu, FLOOR);
        for (let c = 0; c < 3; c++) nodeErr = Math.max(nodeErr, Math.abs(L[c] - C.at(j, i, c)) / Math.max(1e-30, Math.abs(C.at(j, i, c))));
      }
      for (const mu of [-1, 1]) { const L = fetchLogMu(C, xrRow(j), mu, FLOOR), O = fetchLinear(C, xrRow(j), mu); for (let c = 0; c < 3; c++) edgeErr = Math.max(edgeErr, Math.abs(L[c] - O[c]) / Math.max(1e-30, Math.abs(O[c]))); }
      for (let i = 1; i < C.W - 1; i++) {   // 절점 양옆 ±1e-7(μs) — 가중치가 바뀌어도 값이 이어짐
        const mu = 2 * (i / (C.W - 1)) - 1;
        const a = fetchLogMu(C, xrRow(j), mu - 1e-7, FLOOR), b = fetchLogMu(C, xrRow(j), mu + 1e-7, FLOOR);
        for (let c = 0; c < 3; c++) { const s = Math.max(1e-20, Math.abs(a[c]) + Math.abs(b[c])); jump = Math.max(jump, Math.abs(a[c] - b[c]) / s); }
      }
    }
    ok(nodeErr < 1e-9, `절점(텍셀 가운데)에서 표 값 그대로 (최대 상대 ${nodeErr.toExponential(2)})`);
    ok(edgeErr < 1e-12, `가장자리 μs = ±1 은 예전 값과 같음 (${edgeErr.toExponential(2)})`);
    ok(jump < 1e-4, `절점 양옆이 이어짐 — 최대 상대 차 ${jump.toExponential(2)} (μs ±1e-7)`);
  }
  // (2) 낮: 해 ≥ +1° 는 예전 선형과 같은 식(이웃 비 < 2 배 → 가중 0) · 0..+5° 의 선형 대비 변화. 행 0..15 와 행 사이(구름 높이 1.5·2.25·5.4·9.8 km), 0.05° 걸음
  {
    let worstDay = 0, atDay = null, worstHz = 0, atHz = null, worstPure = 0;
    const hs = [...Array.from({ length: C.rows }, (_, j) => j * 4), 1.5, 2.25, 5.4, 9.8];
    for (const h of hs) for (let e = 0; e <= 90.0001; e += 0.05) {
      const xr = h / 60, mu = muOf(e);
      const L = fetchLinear(C, xr, mu), G = fetchLogMu(C, xr, mu, FLOOR), P = fetchLogMu(C, xr, mu, FLOOR, 'pure');
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(G[c] / L[c] - 1);
        if (e >= PIN.DAY_FROM_DEG - 1e-9) { if (d > worstDay) { worstDay = d; atDay = { h, e: +e.toFixed(2), c }; } }
        else if (d > worstHz) { worstHz = d; atHz = { h, e: +e.toFixed(2), c }; }
        if (e >= 5) worstPure = Math.max(worstPure, Math.abs(P[c] / L[c] - 1));
      }
    }
    ok(worstDay <= PIN.DAY_EXACT, `낮(해 ≥ ${PIN.DAY_FROM_DEG}°): 예전 선형과 같음 — 채널별 최대 상대 차 ${worstDay.toExponential(2)} ≤ ${PIN.DAY_EXACT} (가장 큰 곳 h ${atDay && atDay.h} km · 해 ${atDay && atDay.e}°) [computed]`);
    ok(worstHz <= PIN.HORIZON_TOL, `해 0..${PIN.DAY_FROM_DEG}°: 선형 대비 최대 변화 ${fmt(worstHz * 100, 2)} % ≤ ${PIN.HORIZON_TOL * 100} % (h ${atHz && atHz.h} km · 해 ${atHz && atHz.e}° · ${atHz && 'RGB'[atHz.c]}) [computed]`);
    console.log(`      참고: 가중 없는 log(검토 전 판)는 해 ≥ 5° 에서도 ${fmt(worstPure * 100, 3)} % 바꿨음 [computed]`);
  }
  // (3) 표에 적힌 해 고도별 값(지면 행 0) — 예전/새/기준
  {
    console.log('      해(°)   예전/기준 Y   새/기준 Y   새/예전 Y   예전 R/B ÷ 기준   새 R/B ÷ 기준');
    for (const e of [30, 10, 2, 0, -3, -6, -9.4]) {
      const mu = muOf(e), L = fetchLinear(C, 0, mu), G = fetchLogMu(C, 0, mu, FLOOR), R = rowFine(0, mu);
      const rb = v => v[0] / v[2];
      console.log(`      ${String(e).padStart(5)}   ${fmt(Yof(L) / Yof(R))}       ${fmt(Yof(G) / Yof(R))}     ${fmt(Yof(G) / Yof(L))}     ${fmt(rb(L) / rb(R))}           ${fmt(rb(G) / rb(R))}`);
    }
  }
  // (4) 띠별 보간 오차·출렁임 — 기준(fine)은 산란 표 μs 축을 4 배(128 칸)로 다시 계산한 것이라 앱 절점 자체의 치우침(앱 산란 표 32 칸 — 보간과 무관한 다른 오차)이
  //     함께 들어 있음. 그래서 절점 치우침 b_k = 앱 절점 Y ÷ 기준 절점 Y 를 따로 재고, 보간만의 오차 q(e) = E(e) ÷ (기준(e) · b(e)) 를 봄
  //     (b(e) = 이웃 두 절점 치우침의 log 선형 — 절점에서 q = 1). 0.05° 걸음, 행 0..3(0·4·8·12 km).
  {
    const rows = [0, 1, 2, 3];
    const node = (T, j, i, step) => Yof([0, 1, 2].map(c => T.at(j, i * step, c)));
    const biasAt = (j, i) => node(C, j, i, 1) / node(Fn, j, i, 8);
    const bInterp = (j, mu) => {
      const x = (mu * 0.5 + 0.5) * (C.W - 1), i = Math.min(Math.floor(x), C.W - 2), f = x - i;
      return Math.exp(Math.log(biasAt(j, i)) * (1 - f) + Math.log(biasAt(j, i + 1)) * f);
    };
    const bMax = (j, mu) => { const x = (mu * 0.5 + 0.5) * (C.W - 1), i = Math.min(Math.floor(x), C.W - 2); return Math.max(biasAt(j, i), biasAt(j, i + 1)); };
    const lin = (j, mu) => fetchLinear(C, xrRow(j), mu), lg = (j, mu) => fetchLogMu(C, xrRow(j), mu, FLOOR), pure = (j, mu) => fetchLogMu(C, xrRow(j), mu, FLOOR, 'pure');
    const stats = (lo, hi, fn) => {
      let rmn = Infinity, rmx = 0, qmn = Infinity, qmx = 0, over = 0, pp = 0, bmx = 0;
      for (const j of rows) {
        const qs = [];
        for (let k = 0; lo + k * 0.05 <= hi + 1e-9; k++) {
          const e = lo + k * 0.05, mu = muOf(e), R = Yof(rowFine(j, mu)), E = Yof(fn(j, mu));
          if (!(R > 1e-12)) continue;
          const r = E / R, q = r / bInterp(j, mu);
          rmn = Math.min(rmn, r); rmx = Math.max(rmx, r); qmn = Math.min(qmn, q); qmx = Math.max(qmx, q); qs.push(q);
          over = Math.max(over, r / bMax(j, mu)); bmx = Math.max(bmx, bMax(j, mu));
        }
        const win = 37;   // 37 × 0.05° = 1.85° ≈ μs 한 칸(2/63)
        for (let k = 0; k + win <= qs.length; k += 5) { const w = qs.slice(k, k + win); pp = Math.max(pp, Math.max(...w) / Math.min(...w) - 1); }
      }
      return { rmn, rmx, qmn, qmx, over, pp, bmx, dev: Math.max(qmx - 1, 1 - qmn) };
    };
    console.log('      절점 치우침 b(지면 행, 해 −10.1·−8.2·−6.4·−4.6·−2.7·−0.9°): ' + [26, 27, 28, 29, 30, 31].map(i => fmt(biasAt(0, i), 3)).join(' · ') + ' — 앱 산란 표(μs 32 칸)의 몫, 이 고침 밖 [computed]');
    for (const [lo, hi] of [[-10, -6], [-6, -3], [-3, 0], [0, 2], [2, 5], [5, 10]]) {
      const a = stats(lo, hi, lin), b = stats(lo, hi, lg), p = stats(lo, hi, pure);
      console.log(`      해 ${lo}..${hi}°: E/기준 예전 ${fmt(a.rmn, 3)}..${fmt(a.rmx, 3)} · 새 ${fmt(b.rmn, 3)}..${fmt(b.rmx, 3)} (절점 치우침 최대 ${fmt(a.bmx, 3)}) | 보간만 q 예전 ${fmt(a.qmn, 3)}..${fmt(a.qmx, 3)} · 새 ${fmt(b.qmn, 3)}..${fmt(b.qmx, 3)} (가중 없는 log ${fmt(p.qmn, 3)}..${fmt(p.qmx, 3)}) | 1.85° 창 출렁임 예전 ${fmt(a.pp * 100, 1)} % · 새 ${fmt(b.pp * 100, 1)} % (가중 없는 log ${fmt(p.pp * 100, 1)} %)`);
      const L = cfgTw[`${lo}..${hi}`];
      // 모든 띠: 예전보다 나쁘지 않음(보간 오차의 최대 |q − 1| · 출렁임 — 여유 PIN.NO_WORSE)
      ok(b.dev <= a.dev + PIN.NO_WORSE && b.pp <= a.pp + PIN.NO_WORSE, `해 ${lo}..${hi}°: 예전보다 나쁘지 않음 — 최대 |q − 1| ${fmt(a.dev * 100, 1)} → ${fmt(b.dev * 100, 1)} % · 출렁임 ${fmt(a.pp * 100, 1)} → ${fmt(b.pp * 100, 1)} % [computed]`);
      if (!L) continue;
      if (L.overMax != null) ok(b.over <= L.overMax && a.over > L.overMax, `해 ${lo}..${hi}°: 과밝음(E ÷ 기준 ÷ 이웃 절점 치우침의 큰 쪽) 최대 ${fmt(a.over, 3)} → ${fmt(b.over, 3)} (≤ ${L.overMax}) [computed]`);
      ok(b.qmx <= L.qMax && b.qmn >= L.qMin, `해 ${lo}..${hi}°: 보간만의 오차 q ${fmt(a.qmn, 3)}..${fmt(a.qmx, 3)} → ${fmt(b.qmn, 3)}..${fmt(b.qmx, 3)} (허용 ${L.qMin}..${L.qMax}) [computed]`);
      ok(b.pp * L.ppGain <= a.pp, `해 ${lo}..${hi}°: μs 한 칸 주기 출렁임 ${fmt(a.pp * 100, 1)} % → ${fmt(b.pp * 100, 1)} % (${L.ppGain} 배 이상 줄어듦) [computed]`);
    }
  }
  // (5) 0·음수·half-float(+ FTZ 보고)
  {
    const syn = new Float64Array(2 * 4 * 3);
    const vals = [[1e-3, 1e-3, 1e-3], [0, 2e-3, -1e-15], [4e-3, 4e-3, 4e-3], [8e-3, 8e-3, 8e-3]];
    for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) for (let c = 0; c < 3; c++) syn[(j * 4 + i) * 3 + c] = vals[i][c];
    const S = makeTable(syn, 2, 4);
    let finite = true, zeroLin = true;
    for (let k = 0; k <= 200; k++) {
      const mu = -1 + k / 100, G = fetchLogMu(S, 0, mu, FLOOR), L = fetchLinear(S, 0, mu);
      if (!G.every(Number.isFinite)) finite = false;
      const x = coord(mu * 0.5 + 0.5, 4) * 4 - 0.5;
      if (x > 0 && x < 2) for (const c of [0, 2]) if (Math.abs(G[c] - L[c]) > 1e-18) zeroLin = false;   // 0·음수 이웃 채널은 선형 그대로
    }
    ok(finite, '0·음수 텍셀이 있어도 NaN·Inf 없음');
    ok(zeroLin, '0·음수 이웃이 있는 채널(R 0, B −1e−15)은 예전 선형과 같은 값');
    const H = makeTable(C.arr.map(x => toHalf(x)), C.rows, C.W);
    let hFinite = true, hWorstTw = 0, hDay = 0;
    for (let e = -14; e <= 90; e += 0.05) {
      const mu = muOf(e), G = fetchLogMu(H, 0, mu, FLOOR), L = fetchLinear(H, 0, mu), R = rowFine(0, mu);
      if (!G.every(Number.isFinite)) hFinite = false;
      if (e >= PIN.DAY_FROM_DEG) for (let c = 0; c < 3; c++) hDay = Math.max(hDay, Math.abs(G[c] / L[c] - 1));
      if (e >= -10 && e <= 0 && Yof(R) > 1e-12) hWorstTw = Math.max(hWorstTw, Yof(G) / Yof(R));
    }
    ok(hFinite, 'half-float 표(아정규·0 포함, 해 −14..90°): NaN·Inf 없음');
    ok(hDay <= PIN.DAY_EXACT, `half-float 표 낮(해 ≥ ${PIN.DAY_FROM_DEG}°) 예전 선형과 같음 (${hDay.toExponential(2)})`);
    console.log(`      half-float 표 해 −10..0° 새/기준 Y 최대 ${fmt(hWorstTw, 3)} (half 양자화 포함)`);
    // FTZ(아정규를 0 으로 쓰는 GPU) — 보고만: 해 ≤ −10° 텍셀이 0 이 되어 −10..−8° 는 예전·새 모두 표 정밀도 한계(이 고침 전부터) [estimate: 기기마다]
    const Z = makeTable(C.arr.map(x => toHalf(x, true)), C.rows, C.W);
    let zOld = [Infinity, 0], zNew = [Infinity, 0], zFinite = true;
    for (let e = -10; e <= -8; e += 0.05) {
      const mu = muOf(e), R = Yof(rowFine(0, mu)), o = Yof(fetchLinear(Z, 0, mu)) / R, n = Yof(fetchLogMu(Z, 0, mu, FLOOR)) / R;
      if (!Number.isFinite(n)) zFinite = false;
      zOld = [Math.min(zOld[0], o), Math.max(zOld[1], o)]; zNew = [Math.min(zNew[0], n), Math.max(zNew[1], n)];
    }
    ok(zFinite, 'half-float + FTZ 표: NaN·Inf 없음');
    console.log(`      [보고만] half-float + FTZ 표 해 −10..−8° Y/기준: 예전 ${fmt(zOld[0], 3)}..${fmt(zOld[1], 3)} · 새 ${fmt(zNew[0], 3)}..${fmt(zNew[1], 3)} — 아정규를 버리는 GPU 에서는 표 정밀도 한계(고침 전부터) [computed]`);
  }
  // (6) 기준 표 자체의 잔차: 505 절점 사이 log 보간 vs 선형(기준이 보간 방식에 기대지 않는지)
  {
    let d = 0;
    for (const j of [0, 1, 2, 3]) for (let e = -10; e <= 5; e += 0.05) {
      const mu = muOf(e), x = mu * 0.5 + 0.5, t = x * (Fn.W - 1), i = Math.min(Math.floor(t), Fn.W - 2), f = t - i;
      const R = rowFine(j, mu), Ll = [0, 1, 2].map(c => Fn.at(j, i, c) * (1 - f) + Fn.at(j, i + 1, c) * f);
      if (Yof(R) > 1e-12) d = Math.max(d, Math.abs(Yof(Ll) / Yof(R) - 1));
    }
    console.log(`      기준 표 절점 사이 보간 방식 차(선형 vs log, 해 −10..5°) 최대 ${fmt(d * 100, 2)} % — 기준의 보간 잔차 [computed]`);
  }
}
/**
 * 띠별 문턱(명세에서 — 측정값에 맞춰 고르지 않음, §178 검토): 모든 띠는 위 (4) 의 "예전보다 나쁘지 않음"을 따로 봄.
 * 깊은 박명(−10..−3°)은 결함 자체(1.3~1.95 배 과밝음 · 1.83° 출렁임)를 고침의 목표로: 보간 오차 ±10 % 안, 과밝음 문턱 아래(예전은 넘음),
 * 출렁임 5 배 이상 줄어듦. 지평선 띠(−3..+2°)는 "예전보다 나쁘지 않음" + 출렁임이 줄어듦(ppGain 1). ≥ +2° 는 예전과 같은 식이라 (2)·(4) 로 충분.
 */
const cfgTw = {
  '-10..-6': { overMax: 1.10, qMin: 0.90, qMax: 1.10, ppGain: 5 },
  '-6..-3': { overMax: 1.05, qMin: 0.90, qMax: 1.10, ppGain: 5 },
  '-3..0': { overMax: null, qMin: 0.90, qMax: 1.10, ppGain: 1 },
  '0..2': { overMax: null, qMin: 0.95, qMax: 1.05, ppGain: 1 },
};

// ───────────────────────── 실행 ─────────────────────────
(async () => {
  console.log(`[a] 묶기 — 지금 트리와 기준 트리(${BASE_REV})를 같은 하네스로 (작업 폴더 ${WORK})`);
  const BASE_TREE = path.join(WORK, 'base-tree');
  fs.rmSync(BASE_TREE, { recursive: true, force: true }); fs.mkdirSync(BASE_TREE, { recursive: true });
  execFileSync('bash', ['-c', `git -C "${ROOT}" archive "${BASE_REV}" src | tar -x -C "${BASE_TREE}"`]);
  const B = runTree('base', BASE_TREE, false, {});
  const expectFrom = {
    low_on: ['low_off', { clampInscatter: true, irradianceLogMu: true }], medium_on: ['medium_off', { clampInscatter: true, irradianceLogMu: true }], high_on: ['high_off', { clampInscatter: true, irradianceLogMu: true }],
    low_clamp: ['low_off', { clampInscatter: true, irradianceLogMu: false }], low_logmu: ['low_off', { clampInscatter: false, irradianceLogMu: true }],
    low_var_on: ['low_var_off', { clampInscatter: true, irradianceLogMu: true }],
  };
  const Cu = runTree('cur', ROOT, true, { baseTexts: B.dir, expectFrom });
  ok(true, 'esbuild 묶기·가짜 렌더러 실행(두 트리)');
  const lf = Cu.res.lf;
  ok(lf.defaults.clampInscatter === false && lf.defaults.irradianceLogMu === false, 'DEFAULT_VOLUMETRIC_OPTIONS: clampInscatter·irradianceLogMu 기본 끔(하네스 관례 — 동결 grain·tsun 꾸러미는 고치기 전 글자)');
  // 앱 길의 배선(정적): 사용자 승인 "앱에서 기본 켬"은 여기서 지켜집니다 — `!!` 로 바뀌면 모든 사용자에게 꺼짐(§178 검토).
  {
    const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
    const sky = src('src/components/SkyScene3D/SkyScene3D.tsx'), store = src('src/store/useCelestialStore.ts'), dev = src('src/components/SkyScreen/DevTuningPanel.tsx'), probe = src('src/components/VolumetricProbe/VolumetricProbe.tsx');
    ok(count(sky, 'clampInscatter: volSet.volumetricClampInscatter ?? true') === 1 && count(sky, 'irradianceLogMu: volSet.volumetricIrradianceLogMu ?? true') === 1, 'SkyScene3D setOptions: 두 플래그를 `?? true` 로 넘김');
    ok(count(sky, '${volSet.volumetricClampInscatter ?? true ? 1 : 0}') === 1 && count(sky, '${volSet.volumetricIrradianceLogMu ?? true ? 1 : 0}') === 1, 'SkyScene3D qKey: 두 플래그가 키에 들어감(칩을 바꾸면 다시 겁니다)');
    const dflt = sky.slice(sky.indexOf('export const DEFAULT_SKY_SETTINGS'), sky.indexOf('};', sky.indexOf('export const DEFAULT_SKY_SETTINGS')));
    ok(/volumetricClampInscatter: true/.test(dflt) && /volumetricIrradianceLogMu: true/.test(dflt), 'DEFAULT_SKY_SETTINGS: 두 플래그 true');
    ok(count(store, 'volumetricClampInscatter: true,') === 1 && count(store, 'volumetricIrradianceLogMu: true,') === 1, '스토어 skySettings 기본: 두 플래그 true');
    ok(count(dev, 's.skySettings.volumetricClampInscatter ?? true') === 1 && count(dev, 's.skySettings.volumetricIrradianceLogMu ?? true') === 1, '개발 패널 CLAMP·LOGμ 칩: `?? true` 로 읽음');
    ok(/createVolumetricScene\(renderer, w, h, \{[^}]*clampInscatter: true, irradianceLogMu: true[^}]*\}\)/.test(probe), 'VolumetricProbe: 만들 때 두 플래그 true');
  }

  console.log('\n[b] 셰이더 글자');
  const KINDS = ['cloudsFrag', 'cloudsVert', 'shadowFrag', 'shadowVert', 'aerial', 'merged'];
  for (const q of ['low', 'medium', 'high']) {
    const same = KINDS.filter(k => rd(Cu.dir, q + '_off', k) === rd(B.dir, q + '_off', k));
    ok(same.length === KINDS.length, `${q}: 둘 다 끄면 ${KINDS.join('·')} 글자가 기준 트리와 바이트 같음 (${same.length}/${KINDS.length}${same.length < KINDS.length ? ' — 다름: ' + KINDS.filter(k => !same.includes(k)).join(',') : ''})`);
    ok(!rd(Cu.dir, q + '_off', 'merged').startsWith('ERR'), `${q}: EffectPass 합친 글자를 얻음`);
  }
  ok(KINDS.every(k => rd(Cu.dir, 'low_var_off', k) === rd(B.dir, 'low_var_off', k)), '종류 변형(확산 2·얼음 무리·grain 손잡이) + 둘 다 끔 = 기준 트리 글자');
  ok(KINDS.every(k => rd(Cu.dir, 'low_default', k) === rd(B.dir, 'low_off', k)), '옵션을 안 넘김(DEFAULT_VOLUMETRIC_OPTIONS — 동결 하네스 길) = 기준 트리 글자');
  const M_CL = '§178 clampInscatter', M_LM = '§178 irradianceLogMu';
  const expectCounts = { low_on: [1, 1], medium_on: [1, 1], high_on: [1, 1], low_clamp: [1, 0], low_logmu: [0, 1], low_var_on: [1, 1] };
  for (const [tag, [cl, lm]] of Object.entries(expectCounts)) {
    const t = Object.fromEntries(KINDS.map(k => [k, rd(Cu.dir, tag, k)]));
    const got = { cfC: count(t.cloudsFrag, M_CL), cfL: count(t.cloudsFrag, M_LM), cvC: count(t.cloudsVert, M_CL), cvL: count(t.cloudsVert, M_LM),
      aC: count(t.aerial, M_CL), aL: count(t.aerial, M_LM), mC: count(t.merged, M_CL), mL: count(t.merged, M_LM), sh: count(t.shadowFrag + t.shadowVert, '§178') };
    ok(got.cfC === cl && got.cfL === lm && got.cvC === 0 && got.cvL === lm && got.aC === cl && got.aL === lm && got.mC === cl && got.mL === lm && got.sh === 0,
      `${tag}: 표지 수 구름 조각 ${got.cfC}/${got.cfL} · 구름 정점 ${got.cvC}/${got.cvL} · 대기 효과 ${got.aC}/${got.aL} · 합친 효과 ${got.mC}/${got.mL} · 그림자 패스 ${got.sh} (기대 ${cl}/${lm}, 정점 0/${lm}, 그림자 0)`);
    if (lm) ok(count(t.cloudsFrag, lf.IRRADIANCE_ANCHOR) === 0 && count(t.cloudsVert, lf.IRRADIANCE_ANCHOR) === 0 && count(t.aerial, lf.IRRADIANCE_ANCHOR) === 0, `${tag}: GetIrradiance 원래 몸통이 남지 않음`);
    if (lm) ok(/float\((e\d+)IRRADIANCE_TEXTURE_WIDTH\);/.test(t.merged) && /vec2\(\(irrI \+ 0\.5\) \/ irrW, uv\.y\)/.test(t.merged) && /texture\(e\d+Irradiance_texture, vec2\(\(irrI/.test(t.merged) && !/float\(IRRADIANCE_TEXTURE_WIDTH\)/.test(t.merged) && !/textureSize\([^)]*rradiance_texture/.test(t.merged),
      `${tag}: 합친 효과에서 조도 표·폭 상수 이름이 효과 접두어로 함께 바뀜(e1IRRADIANCE_TEXTURE_WIDTH · e1Irradiance_texture, textureSize 없음)`);
    if (lm) ok(['cloudsFrag', 'cloudsVert', 'aerial'].every(k => count(t[k], 'float irrW = float(IRRADIANCE_TEXTURE_WIDTH);') === 1 && !/textureSize\([^)]*rradiance_texture/.test(t[k])), `${tag}: 폭은 uv 를 만든 IRRADIANCE_TEXTURE_WIDTH(구름 조각·정점·대기 효과)`);
    const ex = Cu.res.expect && Cu.res.expect[tag];
    ok(ex && ex.cloudsFrag && ex.cloudsVert && ex.aerial, `${tag}: 켠 글자 = 기준 글자에 주입 함수를 건 것(앵커 자리 외 바이트 같음) — 조각 ${ex && ex.cloudsFrag} · 정점 ${ex && ex.cloudsVert} · 효과 ${ex && ex.aerial}`);
  }
  const g = Cu.res.anchorGuards;
  ok(g.cloudsMissing && g.aerialMissing && g.irrMissing && g.irrTwice && g.offNeverThrows, `앵커가 없거나 두 번이면 throw, 끄면 throw 없음 (${JSON.stringify(g)})`);
  ok(KINDS.every(k => rd(Cu.dir, 'low_toggle_a', k) === rd(Cu.dir, 'low_on', k)), '실행 중 켜고 끄기: 처음(켬) = low_on');
  ok(KINDS.every(k => rd(Cu.dir, 'low_toggle_b', k) === rd(Cu.dir, 'low_off', k)), '실행 중 끔 → low_off 와 바이트 같음(대기 효과·합친 글자 포함)');
  ok(KINDS.every(k => rd(Cu.dir, 'low_toggle_c', k) === rd(Cu.dir, 'low_on', k)), '다시 켬 → low_on 과 바이트 같음');
  ok(rd(Cu.dir, 'low_toggle_b', 'mergedNoRc') === rd(Cu.dir, 'low_off', 'merged') && rd(Cu.dir, 'low_toggle_c', 'mergedNoRc') === rd(Cu.dir, 'low_on', 'merged'),
    '사건 길(손 recompile 없이): 끄고 켤 때 EffectPass 가 스스로 다시 합친 글자 = low_off · low_on 합친 글자');

  console.log('\n[c] 그림자 드리움(g2) — setDate 상태 = 그 시각에 새로 만든 장면');
  const sameSnap = (a, b) => JSON.stringify([a.shadows, a.mask, a.top, a.bottom]) === JSON.stringify([b.shadows, b.mask, b.top, b.bottom]);
  for (const [key, steps] of Object.entries(Cu.res.cast)) {
    const [cname] = key.split('/');
    const bad = steps.filter(s => !sameSnap(s, Cu.res.fresh[cname + '@' + s.iso]));
    const zeroOk = steps.every(s => s.shadows.some((x, i) => x && s.heights[i][1] > 0) || (s.top === 0 && s.bottom === 0));
    const shared = steps.every(s => s.cloudPassTop === s.top && JSON.stringify(s.shadowPassMask) === JSON.stringify(s.mask));
    const desc = steps.map(s => `${s.op}@${s.sunAlt}°→top ${s.top}`).join(' · ');
    ok(bad.length === 0 && zeroOk && shared, `${key}: ${desc}${bad.length ? ' — 새 장면과 다름: ' + bad.map(s => s.op + '@' + s.sunAlt + ' ' + JSON.stringify([s.shadows, s.top]) + ' vs ' + JSON.stringify([Cu.res.fresh[cname + '@' + s.iso].shadows, Cu.res.fresh[cname + '@' + s.iso].top])).join('; ') : ''}${zeroOk ? '' : ' — 드리우는 층 없는데 꼭대기 ≠ 0'}`);
  }
  const fr = (c, iso) => Cu.res.fresh[c + '@' + iso];
  ok(fr('lowOnly', T.day).top === 5400 && fr('lowOnly', T.m0658).top === 5400, `저층만(운량 0 중층 포함): 낮 꼭대기 5400 m(중층 4.5 + 0.9 km — 운량 0 중층은 applyScene 규칙대로 드리움) [from doc §177.6]`);
  ok(fr('withCi', T.day).top === 9800 && fr('withCi', T.day).shadows[2] === true, `종류 권운 층은 설계상 드리움(g3 — 바꾸지 않음): 낮 꼭대기 9800 m`);
  ok(fr('highOnly', T.day).top === 0 && fr('highOnly', T.day).shadows.every(x => !x), '종류 없는 상층만: 낮에도 드리우는 층 없음 → 꼭대기 0');
  const b2 = B.res.cast['lowOnly/upCross12'][1], c2 = Cu.res.cast['lowOnly/upCross12'][1];
  ok(b2.top === 10400 && c2.top === 5400, `해 12° 위로 넘기(06:40 → 06:58, ${c2.sunAlt}°): 기준 트리 꼭대기 ${b2.top} m(결함 재현) → 지금 ${c2.top} m`);
  const b3 = B.res.cast['lowOnly/twRebuild'][2], c3 = Cu.res.cast['lowOnly/twRebuild'][2];
  ok(b3.top === 5400 && c3.top === 0, `낮에 만든 뒤 박명 재구축: 기준 트리 꼭대기 ${b3.top} m(낡은 값) → 지금 ${c3.top} m`);
  const b4 = B.res.cast['four/dayTwDay'][3], c4 = Cu.res.cast['four/dayTwDay'][3];
  console.log(`      네 층(sc·ac·종류 없는 상층 운량 0·ci) 낮 → 박명 → 낮: 기준 트리 shadow ${JSON.stringify(b4.shadows)} top ${b4.top} · 지금 ${JSON.stringify(c4.shadows)} top ${c4.top}`);

  console.log('\n[e] 산란 자르기 — 켠 글자의 합성 줄을 채널마다 계산');
  {
    const lineOf = (s, re) => { const m = s.match(re); return m ? m[0] : null; };
    const evalLine = (expr, vars) => {   // 채널별(성분끼리 연산뿐) — vec3(0.0) → 0, max → Math.max
      let js = expr.replace(/vec3\(0\.0\)/g, '0').replace(/\bmax\(/g, 'Math.max(');
      for (const [k, v] of Object.entries(vars)) js = js.split(k).join('(' + v + ')');
      return Function('"use strict"; return (' + js + ');')();
    };
    const onC = lineOf(rd(Cu.dir, 'low_on', 'cloudsFrag'), /color\.rgb = color\.rgb \* transmittance \+ [^;]*;/);
    const offC = lineOf(rd(Cu.dir, 'low_off', 'cloudsFrag'), /color\.rgb = color\.rgb \* transmittance \+ [^;]*;/);
    const onA = lineOf(rd(Cu.dir, 'low_on', 'aerial'), /radiance = radiance \+ [^;]*inscatter[^;]*;/);
    const offA = lineOf(rd(Cu.dir, 'low_off', 'aerial'), /radiance = radiance \+ [^;]*inscatter[^;]*;/);
    const rhs = l => l.slice(l.indexOf('=') + 1, -1);
    const S = [-0.17, 0.05, -1e-3], Tt = [0.6, 0.7, 0.8], Cc = [0.3, 0.2, 0.1], A = 0.9;
    const cl = c => evalLine(rhs(onC), { 'color.rgb': Cc[c], 'color.a': A, transmittance: Tt[c], inscatter: S[c] });
    const co = c => evalLine(rhs(offC), { 'color.rgb': Cc[c], 'color.a': A, transmittance: Tt[c], inscatter: S[c] });
    ok(Math.abs(cl(0) - Cc[0] * Tt[0]) < 1e-15 && Math.abs(cl(2) - Cc[2] * Tt[2]) < 1e-15, `구름 패스: 음수 산란(−0.17, −1e−3) 기여 0 → ${fmt(cl(0), 5)}, ${fmt(cl(2), 5)}`);
    ok(Math.abs(cl(1) - (Cc[1] * Tt[1] + S[1] * A)) < 1e-15, `구름 패스: 양수 산란(0.05) 그대로 → ${fmt(cl(1), 5)}`);
    ok(co(0) < Cc[0] * Tt[0] - 0.1, `끈 글자: 음수 산란이 그대로 빠짐(${fmt(co(0), 5)} < ${fmt(Cc[0] * Tt[0], 5)}) — 고치기 전 동작`);
    const al = c => evalLine(rhs(onA), { radiance: Cc[c], inscatter: S[c] }), ao = c => evalLine(rhs(offA), { radiance: Cc[c], inscatter: S[c] });
    ok(al(0) === Cc[0] && al(2) === Cc[2] && Math.abs(al(1) - (Cc[1] + S[1])) < 1e-15, `대기 효과(지형 빛 판): 음수 → 0, 양수 그대로 (${[0, 1, 2].map(c => fmt(al(c), 4)).join(', ')})`);
    ok(ao(0) < 0.2, '끈 대기 효과: 음수 그대로(고치기 전 동작)');
  }

  console.log('\n[f] 적대 시나리오(§178 검토에서 옮김 — 빠른 시간 이동 · 12° 경계 ±1 ms · 층 구성 바꾸기 · 비동기 경쟁 · 품질 바꾸기 · 실행 중 토글(사건 길) · 대기 효과 꼭대기 · 두 인스턴스)');
  for (const r of Cu.res.adv) ok(r.ok, r.name + (r.ok ? '' : ' — ' + JSON.stringify(r.detail)));

  checkIrradiance(lf, rd(Cu.dir, 'low_on', 'cloudsFrag'));

  console.log(`\n${pass}/${pass + fail} 통과`);
  if (!arg('--work', null)) fs.rmSync(WORK, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
