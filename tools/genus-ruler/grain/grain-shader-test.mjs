#!/usr/bin/env node
/**
 * grain-shader-test.mjs — RULER-grain §8.2 손잡이(기본 끔)의 셰이더 글자 시험(GPU 없이, node). RULER-grain G0a·G0f·§12.
 *   node tools/genus-ruler/grain/grain-shader-test.mjs [--base cf42e33] [--work DIR] [--out inject-table.json]
 *
 * 측정 번들의 커밋(--base, 기본 cf42e33 = 동결 커밋 — 측정 번들 f50991e0… 은 이 깨끗한 트리를 묶은 것)의 src·entry.ts 를 git 에서 꺼내고,
 * 지금 트리와 함께 node 꾸러미(esbuild cjs)로 묶어 **앱의 createVolumetricScene 을 그대로** 돌립니다. 렌더러는 가짜(GL 호출 없음 — 효과 합성기가
 * 묻는 크기·문맥 속성만)이고 대기 표는 빈 미리 계산 표라, 셰이더 글자·균일변수·define·층 값까지만 봅니다(그리지 않음).
 * 잡 순서는 하네스 entry.ts 와 같습니다: setOptions(앱 기본 + JOB_BASE_OPTIONS + 잡 옵션) → setQuality → setResolutionScale(0.5) → setScene.
 * 장면·팔 옵션은 동결 잡 목록(jobs-grain.json)의 상태 잡 `<팔>__cu35_e5__s__dev__state` 그대로.
 *
 *  A. 끄면 그대로(G0a): 손잡이 기본값의 구름·그림자 패스 글자 = 측정 번들 글자(low·medium·high) · 균일변수 이름·define 같음 ·
 *     capture.ts stateHash(frame·camera 빼고) 같음 · 켰다 끄면 글자·균일변수 목록이 원래대로.
 *  B. 켠 글자: 앵커마다 정확히 한 번 패치 · 구름 패스 전용(E1b·E2b·E4·E3b 페이드)은 그림자 패스 그대로 · E3 은 두 패스 · 괄호 균형.
 *  C. E1b: marchClouds 의 세 `rayDistance +=` 자리(층 사이·빈 날씨·구름 안) 모두 직전 증분 저장, 되감기는 저장한 증분, 첫 표본은 rayNearFar.x 에서의 거리.
 *  D. TS 상수(0.7906·0.0785·0.35·0.797·50·8·150·600·0.0566) = RULER-grain §1 글자 = GLSL 글자(0.0566 은 균일변수 값 + radians()).
 *  E. 살아 있는 글자 = inject(base)(주입 함수를 §8.2 순서로 합성) · 상태 해시 차이 ⊆ grain.py G0_ALLOWED 이고 비어 있지 않음(G0e 예측).
 *  F. 비용 변형(capture.ts applyCostPatch — 동결)이 모든 팔의 구름 글자에 걸림(앵커 6 개 정확히 한 번), E2b 는 실제 fetch 만 셈.
 *  G. E3c: 층 densityScale × debugDensityMul 정확히(셰이더·균일변수 이름 그대로) · E3b 균일변수 값 · 앵커 훼손·중복 → throw.
 * 출력: inject(base) 해시 표(G0f) — 팔마다 구름·그림자 `fnv:길이`(capture.ts shaderHash 와 같은 꼴)와 sha256. --out 이면 JSON.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'cf42e33');
const WORK = path.resolve(arg('--work', path.join(ROOT, '.harness/shader-id/grain')));
const OUT = arg('--out', null);
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const fnv = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const fnvLen = s => fnv(s) + ':' + s.length;   // capture.ts shaderHash 와 같은 꼴
const count = (s, a) => s.split(a).length - 1;

// ───── 측정 번들 트리(src·entry.ts) ─────
const BASE_TREE = path.join(WORK, 'base');
fs.rmSync(BASE_TREE, { recursive: true, force: true });
fs.mkdirSync(BASE_TREE, { recursive: true });
execFileSync('bash', ['-c', `git -C "${ROOT}" archive "${BASE}" src | tar -x -C "${BASE_TREE}"`]);
const baseEntry = execFileSync('git', ['-C', ROOT, 'show', `${BASE}:tools/genus-ruler/volsky/entry.ts`], { encoding: 'utf8' });
const jobBaseOf = src => {
  const m = src.match(/const JOB_BASE_OPTIONS: Partial<VolumetricOptions> = \{([\s\S]*?)\n {4}\};/);
  if (!m) throw new Error('JOB_BASE_OPTIONS not found');
  return new Function('return ({' + m[1] + '\n});')();
};
const JOB_BASE = { base: jobBaseOf(baseEntry), cur: jobBaseOf(read('tools/genus-ruler/volsky/entry.ts')) };

// ───── 장면·팔(동결 잡 목록의 상태 잡) ─────
const jobs = JSON.parse(read('tools/genus-ruler/grain/jobs-grain.json'));
const stateJobs = jobs.filter(j => j.grain && j.grain.mode === 'state' && /__cu35_e5__s__dev__state$/.test(j.name));
const KNOB_ARMS = ['E1b', 'E2b', 'E2c', 'E3', 'E3b', 'E3c', 'E4'];
const jobOf = a => { const j = stateJobs.find(x => x.arm === a); if (!j) throw new Error('state job missing: ' + a); return j; };
const C0 = jobOf('C0');
const KNOBS = { E1b: { refine: 1 }, E2b: { sunLowpass: 1 }, E2c: { sunLowpass: 1 }, E3: { erode: 1 }, E3b: { erode: 2 }, E3c: {}, E4: { jitter: 1 } };
const QUALITIES = ['low', 'medium', 'high'];
const ALL_ON = { refineOnHit: 1, sunLowpass: 1, erodeCentered: 2, jitterMode: 1 };

// ───── node 꾸러미: 가짜 렌더러로 createVolumetricScene → 잡 순서대로 → 글자·균일변수·define·상태 해시 ─────
const DUMP = (tree, extra) => `
import fs from 'node:fs';
import { Vector2 } from 'three';
import { createVolumetricScene, DEFAULT_VOLUMETRIC_OPTIONS } from '${tree}/src/components/VolumetricProbe/volumetricScene';
import { stateHash, applyCostPatch } from '${ROOT}/tools/genus-ruler/grain/capture';
${extra.imports ?? ''}
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const W = 390, H = 584;
const gl = { getContextAttributes: () => ({ alpha: false }), getExtension: () => null, getParameter: () => 0 };
const renderer: any = { getSize: (v: Vector2) => v.set(W, H), getDrawingBufferSize: (v: Vector2) => v.set(W, H), getPixelRatio: () => 1,
  getContext: () => gl, outputColorSpace: 'srgb-linear', autoClear: true, toneMappingExposure: 1 };
(async () => {
  const vol: any = await createVolumetricScene(renderer, W, H, { genus: true, celestial: false, precomputed: {} as never });
  const c: any = vol.debug.clouds;
  const res: any = { runs: {} };
  for (const run of cfg.runs) {
    // entry.ts __job 과 같은 순서(grain 잡: 앱 기본 전부 + 하네스 기본 + 잡 옵션).
    vol.setOptions({ ...DEFAULT_VOLUMETRIC_OPTIONS, ...cfg.jobBase, celestial: false, ...(run.options ?? {}) }, false);
    c.skyLightScale = 1; c.groundBounceScale = 1;
    vol.setQuality(run.quality);
    vol.setResolutionScale(0.5);
    let error = null;
    try { vol.setScene({ ...cfg.input, date: new Date(cfg.input.date) }); } catch (e: any) { error = String(e && e.message || e); }
    vol.setTerrainDistance(null);
    const m = c.cloudsPass.currentMaterial, s = c.shadowPass.currentMaterial;
    let cost = null;
    try { const t = applyCostPatch(m.fragmentShader); cost = { ok: true, sunShapeCounted: t.includes('  if (gSunLowpass == 0) {\\n  float shape = texture(shapeTexture, shapePosition).r;\\n  ++gCostShape;') }; }
    catch (e: any) { cost = { ok: false, error: String(e && e.message || e) }; }
    res.runs[run.tag] = { error, clouds: m.fragmentShader, shadow: s.fragmentShader, cu: Object.keys(m.uniforms).sort(), su: Object.keys(s.uniforms).sort(),
      cd: JSON.stringify(Object.entries(m.defines).sort()), sd: JSON.stringify(Object.entries(s.defines).sort()),
      state: stateHash(vol), layers: c.cloudLayers.map((l: any) => l.densityScale), erodePixelAngle: m.uniforms.erodePixelAngle ? m.uniforms.erodePixelAngle.value : null,
      shadowHasErodePixelAngle: 'erodePixelAngle' in s.uniforms, cost };
  }
  ${extra.body ?? ''}
  fs.writeFileSync(process.argv[3], JSON.stringify(res));
})().catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
`;
const NEW_EXTRA = {
  imports: `import * as G from '${ROOT}/src/components/VolumetricProbe/cloudGenus';`,
  body: `
  // inject(base): 측정 번들 글자에 주입 함수를 §8.2 순서로(erode → refine → sunLowpass → jitter; 그림자 패스는 erode 만, 페이드 없음).
  const base = JSON.parse(fs.readFileSync(cfg.baseFile, 'utf8')).runs['C0_low'];
  const inj = (k: any) => ({
    clouds: G.injectGrainJitter(G.injectGrainSunLowpass(G.injectGrainRefine(G.injectGrainErode(base.clouds, k.erode ?? 0, true), k.refine ?? 0), k.sunLowpass ?? 0), k.jitter ?? 0),
    shadow: G.injectGrainErode(base.shadow, k.erode ?? 0, false),
  });
  res.inject = {};
  for (const [arm, k] of Object.entries(cfg.knobs)) res.inject[arm] = inj(k);
  res.inject.ALL = inj({ refine: 1, sunLowpass: 1, erode: 2, jitter: 1 });
  res.K = G.GRAIN_KNOB;
  // 구름 패스 전용 주입은 그림자 글자(판별 줄 없음)를 refreshVariant 가 건너뜀 — 주입 함수 자체는 앵커가 없으면 throw.
  const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
  const bc = base.clouds;
  res.throwChecks = {
    refineOnShadowThrows: throws(() => G.injectGrainRefine(base.shadow, 1)),
    refineMissing: throws(() => G.injectGrainRefine(bc.replace(G.GRAIN_REFINE_HIT, '    if (media.extinction >= minExtinction) {'), 1)),
    refineDup: throws(() => G.injectGrainRefine(bc.replace(G.GRAIN_REFINE_INIT, G.GRAIN_REFINE_INIT + '\\n' + G.GRAIN_REFINE_INIT), 1)),
    sunMissing: throws(() => G.injectGrainSunLowpass(bc.replace(G.GRAIN_SUN_END, '  }\\n  return opticalDepth;'), 1)),
    sunDup: throws(() => G.injectGrainSunLowpass(bc + '\\n' + G.GRAIN_SUN_SHAPE, 1)),
    erodeMissing: throws(() => G.injectGrainErode(bc.replace(G.GRAIN_ERODE_ANCHOR, '  density = mix(remapClamped(density, vec4(0.0), vec4(1.0)),'), 1, true)),
    erodeShadowMissing: throws(() => G.injectGrainErode(base.shadow.replace(G.GRAIN_ERODE_ANCHOR, ''), 2, false)),
    jitterMissing: throws(() => G.injectGrainJitter(bc.replace(G.GRAIN_JITTER_ANCHOR, '  float stbn = 0.5;'), 1)),
    offNeverThrows: !throws(() => [G.injectGrainErode('x', 0, true), G.injectGrainRefine('x', 0), G.injectGrainSunLowpass('x', 0), G.injectGrainJitter('x', 0)]),
  };
  res.anchors = { erode: G.GRAIN_ERODE_ANCHOR, init: G.GRAIN_REFINE_INIT, gap: G.GRAIN_REFINE_GAP, empty: G.GRAIN_REFINE_EMPTY, hit: G.GRAIN_REFINE_HIT, cloud: G.GRAIN_REFINE_CLOUD,
    sunShape: G.GRAIN_SUN_SHAPE, sunSample: G.GRAIN_SUN_SAMPLE, sunEnd: G.GRAIN_SUN_END, jitter: G.GRAIN_JITTER_ANCHOR };
`,
};
function runDump(tag, tree, extra, cfg) {
  const ts = path.join(WORK, `dump-${tag}.ts`), cjs = path.join(WORK, `dump-${tag}.cjs`), cfgF = path.join(WORK, `cfg-${tag}.json`), out = path.join(WORK, `out-${tag}.json`);
  fs.writeFileSync(ts, DUMP(tree, extra));
  fs.writeFileSync(cfgF, JSON.stringify(cfg));
  // 측정 트리가 저장소 밖(--work)이어도 three 등을 찾도록 NODE_PATH(esbuild 가 읽음).
  execFileSync('npx', ['esbuild', ts, '--bundle', '--format=cjs', '--platform=node', '--define:__DEV__=false', '--define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY="1"', `--outfile=${cjs}`, '--log-level=error'],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') } });
  execFileSync('node', [cjs, cfgF, out], { stdio: 'inherit' });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}
const input = C0.input;
const B = runDump('base', BASE_TREE, {}, { input, jobBase: JOB_BASE.base, runs: QUALITIES.map(q => ({ tag: 'C0_' + q, quality: q, options: {} })) });
const runs = [
  ...QUALITIES.map(q => ({ tag: 'C0_' + q, quality: q, options: C0.options ?? {} })),
  ...KNOB_ARMS.map(a => ({ tag: a, quality: 'low', options: jobOf(a).options ?? {} })),
  ...QUALITIES.map(q => ({ tag: 'ALL_' + q, quality: q, options: ALL_ON })),
  { tag: 'OFF_AGAIN', quality: 'low', options: {} },
  { tag: 'E3b_px03', quality: 'low', options: { erodeCentered: 2, erodePixelAngleDeg: 0.03 } },
  { tag: 'C0_after', quality: 'low', options: {} },
];
const N = runDump('cur', ROOT, NEW_EXTRA, { input, jobBase: JOB_BASE.cur, runs, knobs: KNOBS, baseFile: path.join(WORK, 'out-base.json') });

// ───── 판정 ─────
const results = [];
const check = (name, ok, d) => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d != null ? '  ' + d : ''}`); };
const R = N.runs, b0 = B.runs.C0_low;
for (const r of Object.values(R)) if (r.error) check('setScene 오류 없음', false, r.error);

// A. 끄면 그대로
console.log(`— A. 끄면 그대로(측정 번들 트리 ${BASE} 대 지금 트리, 손잡이 기본값)`);
const offSha = {};
for (const q of QUALITIES) {
  const b = B.runs['C0_' + q], n = R['C0_' + q];
  offSha[q] = { baseClouds: sha(b.clouds), offClouds: sha(n.clouds), baseShadow: sha(b.shadow), offShadow: sha(n.shadow) };
  check(`${q}: 구름 패스 글자 = 측정 번들`, b.clouds === n.clouds, `sha256 ${sha(n.clouds).slice(0, 16)}… (${n.clouds.length} 자)`);
  check(`${q}: 그림자 패스 글자 = 측정 번들`, b.shadow === n.shadow, `sha256 ${sha(n.shadow).slice(0, 16)}… (${n.shadow.length} 자)`);
  check(`${q}: 균일변수 이름(구름 ${n.cu.length}·그림자 ${n.su.length})·define 같음`, b.cu.join() === n.cu.join() && b.su.join() === n.su.join() && b.cd === n.cd && b.sd === n.sd);
}
const STATE_SKIP = new Set(['frame', 'camera']);
function stateDiff(a, b) {   // grain.py state_diff 와 같은 규칙
  const d = new Set();
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (STATE_SKIP.has(k) || k.endsWith('.uniforms')) continue;
    const va = a[k], vb = b[k];
    if (k.endsWith('.perUniform')) {
      const tag = k.split('.')[0];
      for (const u of new Set([...Object.keys(va ?? {}), ...Object.keys(vb ?? {})])) if ((va ?? {})[u] !== (vb ?? {})[u]) d.add(tag + '.perUniform:' + u);
    } else if (JSON.stringify(va) !== JSON.stringify(vb)) d.add(k);
  }
  return [...d].sort();
}
for (const q of QUALITIES) {
  const d = stateDiff(B.runs['C0_' + q].state, R['C0_' + q].state);
  check(`${q}: 상태 해시(capture.ts stateHash, frame·camera 빼고) = 측정 번들`, d.length === 0, d.join(', '));
}
check('켰다(전부) 끄면 글자·균일변수 이름·층 값이 원래대로', R.OFF_AGAIN.clouds === b0.clouds && R.OFF_AGAIN.shadow === b0.shadow && R.OFF_AGAIN.cu.join() === b0.cu.join()
  && R.OFF_AGAIN.su.join() === b0.su.join() && JSON.stringify(R.OFF_AGAIN.layers) === JSON.stringify(b0.layers) && R.C0_after.clouds === b0.clouds && R.C0_after.cu.join() === b0.cu.join());
check('품질 단계는 글자를 바꾸지 않음(low = medium = high, 두 패스)', QUALITIES.every(q => B.runs['C0_' + q].clouds === b0.clouds && B.runs['C0_' + q].shadow === b0.shadow));

// B. 켠 글자 — 앵커마다 정확히 한 번
console.log('— B. 켠 글자');
const A = N.anchors;
const bc = b0.clouds, bs = b0.shadow;
const anchorBase = { erode: [bc, bs], init: [bc], gap: [bc], empty: [bc], hit: [bc], cloud: [bc], sunShape: [bc], sunSample: [bc], sunEnd: [bc], jitter: [bc] };
check('앵커 10 개가 측정 번들 구름 글자에 정확히 한 번(erode 는 그림자 글자에도 한 번)', Object.entries(anchorBase).every(([k, ts]) => ts.every(t => count(t, A[k]) === 1)),
  Object.entries(anchorBase).map(([k, ts]) => k + '=' + ts.map(t => count(t, A[k])).join('/')).join(' '));
const t = { E1b: R.E1b.clouds, E2b: R.E2b.clouds, E3: R.E3.clouds, E3b: R.E3b.clouds, E4: R.E4.clouds, ALL: R.ALL_low.clouds };
// 바꿔 끼운 앵커는 0 번, 뒤에 덧붙인 앵커(원문 줄을 남김)는 1 번, 새 표지는 1 번.
check('E1b: 층 사이·빈 날씨·구름 안 블록 바뀜(원문 0) · 초기화·적중 앵커 1 번 · 표지 1 번',
  count(t.E1b, A.gap) === 0 && count(t.E1b, A.empty) === 0 && count(t.E1b, A.cloud) === 0 && count(t.E1b, A.init) === 1 && count(t.E1b, A.hit) === 1
  && count(t.E1b, 'if (gRefState == 0 && media.extinction > minExtinction) {') === 1 && count(t.E1b, 'float gRefInc = rayDistance;') === 1 && count(t.E1b, 'gRefCount++;') === 3);
check('E2b: 모양 fetch 줄은 글자 그대로 1 번(분기 안) · 표지 선언·설정·되돌림 각 1 번 · marchOpticalDepth 표본 블록 바뀜',
  count(t.E2b, A.sunShape) === 1 && count(t.E2b, 'int gSunLowpass = 0;') === 1 && count(t.E2b, 'gSunLowpass = i >= 1 ? 1 : 0;') === 1 && count(t.E2b, '  gSunLowpass = 0;') === 1
  && count(t.E2b, A.sunSample) === 0 && count(t.E2b, A.sunEnd) === 0 && count(t.E2b, '  if (gSunLowpass == 0) {\n' + A.sunShape + '\n  gShapeLp = shape;\n  }\n  float shape = gShapeLp;') === 1);
check('E3: 문턱 remap 첫 인자만 바뀜(두 패스, 원문 0 · 새 줄 1 · S7 둘째 인자·genusFlow 그대로)',
  [R.E3.clouds, R.E3.shadow].every(x => count(x, A.erode) === 0 && count(x, '  density = mix(density * clamp(vec4(1.0) + 0.35 * shapeAmounts * ((shape - 0.7906) / 0.0785), vec4(0.0), vec4(2.0)),\n                density * clamp(vec4(1.0) + gErodeAmt * (2.0 * shape - 1.0), vec4(0.0), vec4(2.0)),\n                genusFlow);') === 1));
check('E3b: 구름 패스 = 페이드 곱 + 균일변수 선언 1 + footM 1(1차 표본 앞), 그림자 패스 = E3 글자(페이드 없음)',
  count(R.E3b.clouds, 'gErodeK * shapeAmounts') === 1 && count(R.E3b.clouds, 'uniform float erodePixelAngle;') === 1 && count(R.E3b.clouds, 'gErodeFootM = (rayNearFar.x + rayDistance) * radians(erodePixelAngle)') === 1
  && count(R.E3b.clouds, '    gErodeFootM = (rayNearFar.x + rayDistance) * radians(erodePixelAngle) / max(abs(dot(rayDirection, normalize(position))), 0.05);   // RULER-grain E3b\n    MediaSample media = sampleMedia(weather, position, uv, mipLevel, jitter, sampleCount);') === 1
  && R.E3b.shadow === R.E3.shadow && !R.E3b.shadow.includes('erodePixelAngle'));
check('E4: 구름 패스 지터 줄만 바뀜(원문 0 · 새 줄 1), 그림자 패스 getSTBN 그대로',
  count(t.E4, A.jitter) === 0 && count(t.E4, '  float stbn = fract(interleavedGradientNoise(gl_FragCoord.xy) + 0.61803398875 * float(frame % 64));') === 1 && count(R.E4.shadow, A.jitter) === 1);
check('구름 패스 전용(E1b·E2b·E2c·E4)은 그림자 글자 그대로', ['E1b', 'E2b', 'E2c', 'E4'].every(a => R[a].shadow === bs));
check('E3c 는 셰이더 글자 그대로(두 패스)', R.E3c.clouds === bc && R.E3c.shadow === bs);
check('전부 켬(E1b+E2b+E3b+E4) 한 글자에 모두 들어감 · 품질 단계와 무관', ['gRefState == 0 &&', 'gSunLowpass = i >= 1', 'gErodeK * shapeAmounts', 'fract(interleavedGradientNoise'].every(s => count(t.ALL, s) === 1)
  && QUALITIES.every(q => R['ALL_' + q].clouds === t.ALL && R['ALL_' + q].shadow === R.ALL_low.shadow));
// 주석을 뺀 글자에서(takram 원문 주석에 짝 없는 괄호가 있음) 중괄호·괄호가 맞는지 — 컴파일 전 1차 검사.
const code = s => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const balOf = (s, o, c) => { let d = 0; for (const ch of code(s)) { if (ch === o) d++; else if (ch === c) d--; if (d < 0) return false; } return d === 0; };
const balanced = s => balOf(s, '{', '}') && balOf(s, '(', ')');
check('켠 글자 중괄호·괄호 균형(주석 뺀 글자, 모든 팔, 두 패스)', balanced(bc) && balanced(bs) && [...KNOB_ARMS.map(a => R[a]), R.ALL_low].every(r => balanced(r.clouds) && balanced(r.shadow)));
check('새 이름(gRef*·gSunLowpass·gShapeLp·gErode*·erodePixelAngle)은 측정 번들 글자에 없음', !/gRef|gSunLowpass|gShapeLp|gErode(FootM|K)|erodePixelAngle/.test(bc + bs));

// C. E1b 세 rayDistance += 자리
console.log('— C. E1b 직전 증분');
const bodyOf = (s, head) => { const i = s.indexOf(head); const j = s.indexOf('\n}\n', i); return s.slice(i, j + 2); };
const mcB = bodyOf(bc, 'vec4 marchClouds('), mcE = bodyOf(t.E1b, 'vec4 marchClouds(');
// 문장만(줄 머리) — 주석 속 글자는 세지 않음.
const incB = [...mcB.matchAll(/^\s*rayDistance \+= ([^;]+);/gm)].map(m => m[1]);
const stmtE = [...mcE.matchAll(/^\s*rayDistance \+= ([^;]+);/gm)].map(m => m[1]);
const lines = mcE.split('\n');
const stored = [];
lines.forEach((l, i) => { if (l.trim() === 'rayDistance += gRefInc;') { const prev = lines[i - 1].trim().match(/^gRefInc = ([^;]+);$/); stored.push(prev ? prev[1] : null); } });
check('측정 번들 marchClouds 의 rayDistance += 는 3 자리(층 사이·빈 날씨·구름 안)', incB.length === 3 && incB[0] === incB[1] && incB[0] === 'mix(stepSize, maxStepSize, min(1.0, mipLevel))' && incB[2] === 'stepSize', incB.join(' | '));
check('E1b: 세 자리 모두 gRefInc = (원래 증분); rayDistance += gRefInc; — 순서·식 같음', stored.length === 3 && stored.every((x, i) => x === incB[i]), stored.join(' | '));
check('E1b: 그 밖의 rayDistance += 는 정제 걸음(gRefH) 3 자리뿐', stmtE.length === 6 && stmtE.filter(x => x === 'gRefInc').length === 3 && stmtE.filter(x => x === 'gRefH').length === 3, stmtE.join(' | '));
check('E1b: 되감기 = 저장한 증분, 첫 정제 표본 = h·jitter, 정제 보폭 h = max(50, Δ/8), 상한 8, 복귀 = 저장한 stepSize',
  count(mcE, 'rayDistance = rayDistance - gRefInc + gRefH * jitter;') === 1 && count(mcE, 'gRefH = max(50.0, gRefInc / 8.0);') === 1
  && count(mcE, 'if (gRefCount >= 8 || rayDistance >= gRefEnd) { gRefState = 2; stepSize = gRefStep; }') === 3 && count(mcE, 'gRefStep = stepSize;\n      stepSize = gRefH;') === 1);
check('E1b: 첫 표본의 Δ = rayNearFar.x 에서 그 표본까지(초기 rayDistance)', count(mcE, '  float rayDistance = stepSize * jitter * 2.0;\n') === 1 && mcE.indexOf('float gRefInc = rayDistance;') > mcE.indexOf('float rayDistance = stepSize * jitter * 2.0;'));
check('E1b: 정제 표본도 같은 for 반복(반복 상한에 셈) — 반복 머리·종료 줄 그대로', count(mcE, '  for (int i = 0; i < maxIterationCount; ++i) {\n    if (rayDistance > maxRayDistance) {\n      break; // Termination\n    }\n') === 1);
check('E1b: marchShadowLength 의 rayDistance += stepSize 는 그대로', count(t.E1b, '    rayDistance += stepSize;') === 1 && count(bc, '    rayDistance += stepSize;') === 2);

// D. 상수
console.log('— D. 상수(TS = 자 = GLSL)');
const RULER = read('tools/genus-ruler/grain/RULER-grain.md');
const K = N.K;
const want = { erodeMean: 0.7906, erodeSd: 0.0785, erodeK: 0.35, sunLowpassShape: 0.797, refineMinStepM: 50, refineMaxSamples: 8, fade0: 150, fade1: 600, devicePixelAngleDeg: 0.0566 };
const tsv = { erodeMean: K.erodeMean, erodeSd: K.erodeSd, erodeK: K.erodeK, sunLowpassShape: K.sunLowpassShape, refineMinStepM: K.refineMinStepM, refineMaxSamples: K.refineMaxSamples,
  fade0: K.erodeFadeM[0], fade1: K.erodeFadeM[1], devicePixelAngleDeg: K.devicePixelAngleDeg };
check('TS GRAIN_KNOB = 자의 수치 9 개', Object.keys(want).every(k => tsv[k] === want[k]), JSON.stringify(tsv));
const rulerHas = ['(s − 0.7906)/0.0785', 'k = 0.35', 'shape = 0.797', 'h = max(50 m, Δ/8)', '최대 8 표본', 'smoothstep(150, 600, footM)', '0.0566°', '0.61803398875·float(frame % 64)'];
check('자(RULER-grain §1) 글자에 같은 수치', rulerHas.every(s => RULER.includes(s)), rulerHas.filter(s => !RULER.includes(s)).join(' / '));
const glslHas = [[t.E3, '((shape - 0.7906) / 0.0785)'], [t.E3, '0.35 * shapeAmounts'], [t.E3b, 'float gErodeK = 0.35 * (1.0 - smoothstep(150.0, 600.0, gErodeFootM));'],
  [t.E2b, 'float gShapeLp = 0.797;'], [t.E1b, 'gRefH = max(50.0, gRefInc / 8.0);'], [t.E1b, 'gRefCount >= 8 ||'], [t.E4, '0.61803398875 * float(frame % 64)']];
check('GLSL 글자에 같은 수치(0.7906·0.0785·0.35·150·600·0.797·50·8·0.618…·64)', glslHas.every(([s, x]) => s.includes(x)), glslHas.filter(([s, x]) => !s.includes(x)).map(([, x]) => x).join(' / '));
check('E3b 균일변수 erodePixelAngle(°) = 0.0566(기본 null) · 옵션 0.03 이면 0.03 · GLSL 은 radians() · 구름 패스에만',
  R.E3b.erodePixelAngle === 0.0566 && R.E3b_px03.erodePixelAngle === 0.03 && R.ALL_low.erodePixelAngle === 0.0566 && t.E3b.includes('radians(erodePixelAngle)') && !R.E3b.shadowHasErodePixelAngle);

// E. inject(base) = 살아 있는 글자 · 상태 해시 차이 ⊆ G0_ALLOWED
console.log('— E. inject(base)·G0e 예측');
for (const a of [...KNOB_ARMS, 'ALL']) {
  const live = a === 'ALL' ? R.ALL_low : R[a], inj = N.inject[a];
  check(`${a}: 살아 있는 글자 = inject(측정 번들 글자)(두 패스)`, live.clouds === inj.clouds && live.shadow === inj.shadow);
}
const g0src = read('tools/genus-ruler/grain/grain.py');
const g0block = g0src.slice(g0src.indexOf('G0_ALLOWED = {'), g0src.indexOf('}\n', g0src.indexOf('G0_ALLOWED = {')) + 2);
const G0_ALLOWED = Object.fromEntries([...g0block.matchAll(/'([^']+)': \{([^}]*)\}/g)].map(m => [m[1], [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1])]));
const c0s = R.C0_low.state;
for (const a of KNOB_ARMS) {
  const d = stateDiff(c0s, R[a].state), allow = G0_ALLOWED[a] ?? [];
  check(`${a}: 상태 해시 차이 ⊆ G0_ALLOWED 이고 비어 있지 않음`, d.length > 0 && d.every(x => allow.includes(x)), `[${d.join(', ')}] ⊆ [${allow.join(', ')}]`);
}
check('E3c: 층 densityScale = C0 × 0.2(정확히), 균일변수 이름 그대로', R.E3c.layers.length === R.C0_low.layers.length && R.E3c.layers.every((v, i) => v === R.C0_low.layers[i] * 0.2) && R.E3c.cu.join() === b0.cu.join(),
  JSON.stringify(R.C0_low.layers) + ' → ' + JSON.stringify(R.E3c.layers));
check('E3b 만 균일변수 하나(erodePixelAngle, 구름 패스) 늘고 나머지 팔은 이름 목록 그대로', KNOB_ARMS.every(a => (a === 'E3b' ? R[a].cu.join() === [...b0.cu, 'erodePixelAngle'].sort().join() : R[a].cu.join() === b0.cu.join()) && R[a].su.join() === b0.su.join()));

// F. 비용 변형
console.log('— F. 비용 변형(capture.ts applyCostPatch)');
for (const tag of ['C0_low', ...KNOB_ARMS, 'ALL_low']) check(`${tag}: 비용 변형 앵커 6 개 정확히 한 번`, R[tag].cost.ok, R[tag].cost.error ?? '');
check('E2b·E2c: 모양 fetch 셈(++gCostShape)이 gSunLowpass 분기 안(실제 fetch 만)', R.E2b.cost.sunShapeCounted && R.E2c.cost.sunShapeCounted && R.ALL_low.cost.sunShapeCounted);

// G. throw
console.log('— G. 앵커 훼손');
const T = N.throwChecks;
check('앵커가 없거나 둘이면 throw(refine·sunLowpass·erode 두 패스·jitter), 끈 주입은 앵커와 무관', Object.values(T).every(Boolean), JSON.stringify(T));

// ───── inject(base) 해시 표(G0f) ─────
const table = { base: BASE, measurementText: { clouds: { fnv: fnvLen(bc), sha256: sha(bc) }, shadow: { fnv: fnvLen(bs), sha256: sha(bs) } }, offSha256: offSha, arms: {} };
for (const a of ['C0', ...KNOB_ARMS]) {
  const x = a === 'C0' ? { clouds: bc, shadow: bs } : N.inject[a];
  table.arms[a] = { clouds: fnvLen(x.clouds), shadow: fnvLen(x.shadow), cloudsSha256: sha(x.clouds), shadowSha256: sha(x.shadow) };
}
console.log('\ninject(base) 해시 표(G0f — 살아 있는 meta.shaderHash.clouds·shadow 와 견줌):');
for (const [a, h] of Object.entries(table.arms)) console.log(`  ${a.padEnd(4)} clouds ${h.clouds.padEnd(18)} shadow ${h.shadow.padEnd(17)} sha256 ${h.cloudsSha256.slice(0, 12)}… / ${h.shadowSha256.slice(0, 12)}…`);
if (OUT) { fs.writeFileSync(OUT, JSON.stringify(table, null, 1)); console.log('→ ' + OUT); }
const pass = results.filter(Boolean).length;
console.log(`\ngrain-shader-test: ${pass} passed, ${results.length - pass} failed`);
process.exit(pass === results.length ? 0 : 1);
