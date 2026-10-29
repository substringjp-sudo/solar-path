/**
 * §180 L7irrprobe 마른 시험 — **브라우저·Playwright 를 띄우지 않음**, gpu-window.sh run·lighting-render-check.js·run-tsun.js·eval-grain.sh 를 돌리지 않음,
 * .harness/ 와 GPU 창 출력(GW_ROOT/out)을 건드리지 않음. 임시 파일은 --work(기본 scratchpad/irrprobe/test-*) 아래.
 *   nice -n 19 node tools/genus-ruler/tsun/gpuwin-irrtest.js [--work DIR] [--patch <l7-patch.diff>] [--no-harness]
 *  [1] 인자: parseArgs(태그 없음·--max-min 범위·모르는 인자·.harness/ 출력 거부·명령) · 번들 보증(bundleProblem) · 실행기 --dry(가짜 pgrep: 빔 → 0, GPU 과정 → 2,
 *      태그 없음 → 2) · 열쇠가 인자·고정표에 따라 바뀜 · estimate.
 *  [2] 지킴: guardProblems(가짜 pgrep 줄) — grain·태그 과정·SwiftShader GPU 과정 거부, 자기 실행기 줄은 뺌. 창의 guardConflicts 가 이 실행기를 grain 으로 보지 않음.
 *  [3] 셰이더 글자(가짜 렌더러로 앱 createVolumetricScene 을 묶어 돌림 — verify-lighting-fixes.js 와 같은 방식, GL 호출 없음): 구름 패스 끔/켬 글자의
 *      대기 앞부분 자르기 · 켬 = injectIrradianceLogMu(끔) · 정점 셰이더 GetIrradiance 같음 · 탐침 글자 정적 점검(괄호·main·출력·#if 짝) ·
 *      탐침 이름 충돌 없음 · 앞부분이 뒤에서 선언되는 균일변수를 쓰지 않음 · three 조각(#include <…>) 모두 풀림 · 재질 defines·균일변수 이름 ·
 *      three RawShaderMaterial(GLSL3) 이 출력 선언을 덧붙이지 않음 · entry-gpuwin JOB_BASE_OPTIONS 와 같은 글자.
 *  [4] CPU: verify-lighting-fixes.js 의 이식(글자를 잘라 평가 — 그 파일은 돌리지 않음)과 같은 값 · 합성 표(지수 꼴 박명 + 완만한 낮)에서 절점·낮 같음·연속 ·
 *      분석 끝까지(같은 값 → 차 0, 8 비트 가중치 흉내 → 차 ~1e−3 [estimate 확인], 고정표를 GPU 표 자리에 → 출렁임·과밝음이 verify 의 CPU 결과와 같은 쪽) ·
 *      산란 자르기 분석(합성) · analyze 명령(합성 원값 파일).
 *  [5] 패치(--patch): 지금 파일에 깨끗이 걸리는지(patch --dry-run) · 사본에 걸어 bash -n · node --check · STEPS·입력 sha 줄 · 가짜 트리에서 GW_DRY=1 run(L7 만)·plan
 *      (가짜 pgrep, 시험 잠금, GW_HOLD=0 — 진짜 창의 잠금·표지·출력과 따로).
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');
const P = require('./gpuwin-irrprobe');
const C = require('./gpuwin-irrcpu');
const G = require('./gpuwin-lib');
const L = require('./run-tsun-lib');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SCR = '/tmp/claude-0/-home-user-solar-path/827aa702-2f52-52c8-9fe8-e45a3ff14759/scratchpad';
const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const WORK = arg('--work') ? path.resolve(arg('--work')) : fs.mkdtempSync(path.join(SCR, 'irrprobe', 'test-'));
fs.mkdirSync(WORK, { recursive: true });
const PATCH = arg('--patch');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const fmt = (x, d = 3) => (x == null || !Number.isFinite(x) ? String(x) : Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(d));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const run = (cmd, args, env = {}, opt = {}) => spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env }, timeout: opt.timeout ?? 600000, cwd: opt.cwd ?? REPO, maxBuffer: 256 << 20 });
const RUNNER = path.join(__dirname, 'gpuwin-irrprobe.js');

// 가짜 pgrep(gpuwin-test.js 와 같은 방식): FAKE_PGREP_DIR 의 grain.txt·gpu.txt 를 찍음
const FAKE = path.join(WORK, 'fake-pgrep.sh');
fs.writeFileSync(FAKE, '#!/bin/sh\nD=$FAKE_PGREP_DIR\ncase "$2" in\n  *swiftshader*) f="$D/gpu.txt" ;;\n  *) f="$D/grain.txt" ;;\nesac\n[ -s "$f" ] || exit 1\ncat "$f"\n');
fs.chmodSync(FAKE, 0o755);
const fakeDir = name => { const d = path.join(WORK, 'pg-' + name); fs.mkdirSync(d, { recursive: true }); return d; };

// ───────────────────────── [1] 인자·번들·--dry ─────────────────────────
console.log('[1] 인자·번들·실행기 --dry');
const TAG = L.GUARD_TAG;
{
  const base = ['run', '--guard-tag', TAG, '--root', path.join(WORK, 'bundle'), '--scenes', path.join(WORK, 'scenes.json'), '--out', path.join(WORK, 'out')];
  const a = P.parseArgs(base);
  ok(!a.error && a.cmd === 'run' && a.maxMin === G.LIGHT_MAX_MIN && a.lock === (process.env.TSUN_LOCK || '/tmp/run-tsun.lock') && a.fixture === P.DEFAULT_FIXTURE, `기본 인자: max-min ${a.maxMin} · lock ${a.lock} · fixture 기본`);
  ok(!P.parseArgs(base.slice(1)).error, '명령 생략 = run');
  ok(P.parseArgs(['run', '--root', 'x', '--scenes', 'y', '--out', path.join(WORK, 'o')]).code === 2, '--guard-tag 없음 → 2');
  ok(P.parseArgs([...base, '--max-min', '61']).code === 2 && P.parseArgs([...base, '--max-min', '0']).code === 2, '--max-min (0, 60] 밖 → 2');
  ok(P.parseArgs([...base, '--bogus']).code === 2, '모르는 인자 → 2');
  ok(P.parseArgs([...base, '--max-min']).code === 2, '값 없는 --max-min → 2');
  ok(P.parseArgs(['run', '--guard-tag', TAG, '--root', 'x', '--scenes', 'y', '--out', path.join(REPO, '.harness', 'x')]).code === 2, '.harness/ 아래 출력 거부');
  ok(P.parseArgs(['run', '--guard-tag', TAG, '--root', path.join(REPO, 'src', 'x'), '--scenes', 'y', '--out', path.join(WORK, 'o')]).code === 2, 'src/ 아래 번들 폴더 거부');
  ok(P.parseArgs(['build', '--root', path.join(REPO, '.harness', 'b')]).code === 2 && !P.parseArgs(['build', '--root', path.join(WORK, 'b')]).error, 'build: .harness/ 거부 · 작업 폴더 허용');
  ok(P.parseArgs(['analyze']).code === 2 && !P.parseArgs(['analyze', '--raw', 'r.json']).error, 'analyze: --raw 필요');
  ok(P.parseArgs(['frobnicate']).code === 2, '모르는 명령 → 2');
}
// 가짜 번들(app.js + 보증 bundle.json)·장면
const BUN = path.join(WORK, 'bundle'); fs.mkdirSync(BUN, { recursive: true });
fs.writeFileSync(path.join(BUN, 'app.js'), '// fake bundle for dry tests\n');
const writeInfo = o => fs.writeFileSync(path.join(BUN, 'bundle.json'), JSON.stringify({ bundleSha256: sha(fs.readFileSync(path.join(BUN, 'app.js'))), again: 'x', same: true, esbuild: 'x', gitHead: 'x', dirtyFiles: 0, entry: P.ENTRY, ...o }));
writeInfo({});
const realScenes = path.join(SCR, 'gpuwin', 'jobs', 'light-scenes.json');   // 읽기만
const SCN = path.join(WORK, 'scenes.json');
if (fs.existsSync(realScenes)) fs.copyFileSync(realScenes, SCN);
else fs.writeFileSync(SCN, JSON.stringify({ P1B: { input: { lat: 36.046, lon: 136.278, heightM: 13, az: 275.3, el: 8.45, fov: 58.3, date: '2026-10-02T09:22:21.793Z', layers: [] }, options: {} } }));
{
  ok(P.bundleProblem(BUN, false) === null, '번들 보증 통과(같은 sha · entry)');
  writeInfo({ dirtyFiles: 3 });
  ok(/dirty/.test(P.bundleProblem(BUN, false) || '') && P.bundleProblem(BUN, true) === null, '더러운 트리 번들: --allow-dirty 없으면 거부');
  writeInfo({ bundleSha256: 'deadbeef' });
  ok(/vouch/.test(P.bundleProblem(BUN, true) || ''), 'sha 가 다르면 거부');
  writeInfo({ entry: 'tools/genus-ruler/tsun/entry-gpuwin.ts' });
  ok(/entry/.test(P.bundleProblem(BUN, true) || ''), '다른 entry 의 번들 거부(조명 번들을 잘못 가리킴)');
  writeInfo({});
  ok(/no bundle/.test(P.bundleProblem(path.join(WORK, 'nope'), true) || ''), 'app.js 없음 → 거부');
}
{
  const OUTD = path.join(WORK, 'out');
  const args = ['run', '--guard-tag', TAG, '--root', BUN, '--scenes', SCN, '--out', OUTD, '--lock', path.join(WORK, 'tsun.lock'), '--dry'];
  const clear = fakeDir('clear');
  const r0 = run('node', [RUNNER, ...args], { GW_PGREP: FAKE, FAKE_PGREP_DIR: clear });
  let j = null; try { j = JSON.parse(r0.stdout.trim().split('\n').pop()); } catch { /* 아래 */ }
  ok(r0.status === 0 && j && j.dry === true && j.grid.n === 441 && j.grid.heights.join() === '0,2,5,7.4' && j.grid.aerial.join() === '80,60', `--dry(빔) → 0 · 격자 ${j && j.grid.n} × ${j && j.grid.heights} · 산란 ${j && j.grid.aerial} · 어림 ${j && j.estimateMin.map(x => x.toFixed(1)).join('–')} 분`);
  ok(!fs.existsSync(OUTD) && !fs.existsSync(path.join(WORK, 'tsun.lock')), '--dry: 출력 폴더·잠금을 만들지 않음');
  const gpu = fakeDir('gpu'); fs.writeFileSync(path.join(gpu, 'gpu.txt'), '4242 /opt/pw-browsers/chromium-1194/chrome-linux/chrome --type=gpu-process --use-angle=swiftshader\n');
  const r1 = run('node', [RUNNER, ...args], { GW_PGREP: FAKE, FAKE_PGREP_DIR: gpu });
  ok(r1.status === 2 && /SwiftShader GPU process/.test(r1.stderr), 'SwiftShader GPU 과정이 있으면 거부(2)');
  const gr = fakeDir('grain'); fs.writeFileSync(path.join(gr, 'grain.txt'), '5151 bash tools/genus-ruler/grain/eval-grain.sh c0\n');
  const r2 = run('node', [RUNNER, ...args], { GW_PGREP: FAKE, FAKE_PGREP_DIR: gr });
  ok(r2.status === 2 && /RULER-grain/.test(r2.stderr), 'RULER-grain 과정이 있으면 거부(2)');
  const r3 = run('node', [RUNNER, ...args.filter((x, i) => !(x === '--guard-tag' || args[i - 1] === '--guard-tag'))], { GW_PGREP: FAKE, FAKE_PGREP_DIR: clear });
  ok(r3.status === 2 && /guard-tag/.test(r3.stderr), '태그 없이 → 2');
  const r4 = run('node', [RUNNER, 'estimate']);
  let e = null; try { e = JSON.parse(r4.stdout); } catch { /* */ }
  ok(r4.status === 0 && e && e.estimateMin[0] >= 9 && e.estimateMin[1] <= 30, `estimate: ${e && e.estimateMin.map(x => x.toFixed(1)).join('–')} 분(페이지 하나 — 대기 ${G.ATMOS_MIN.join('–')} + 장면 컴파일 + 탐침 < 2)`);
  // 열쇠
  const S = JSON.parse(fs.readFileSync(SCN, 'utf8')), pr = P.probeParams(S);
  const k0 = P.keyOf({ bundleSha: 'a', scenesSha: 'b', selfSha: 'c', cpuSha: 'd', fixtureSha: 'e', params: pr });
  ok(k0 !== P.keyOf({ bundleSha: 'a', scenesSha: 'b', selfSha: 'c', cpuSha: 'd', fixtureSha: 'E', params: pr }) && k0 !== P.keyOf({ bundleSha: 'a', scenesSha: 'b', selfSha: 'c', cpuSha: 'd', fixtureSha: 'e', params: { ...pr, heightsKm: [0] } }),
    '열쇠가 고정표·인자에 따라 바뀜');
  ok(pr.mus.every((m, i) => m === Math.fround(Math.sin(pr.es[i] * Math.PI / 180))) && Math.abs(pr.es[52] + 9.4) < 1e-9 && pr.es[0] === -12 && pr.es[440] === 10, 'μs = float32 sin(e) · e[52] = −9.4° · −12..+10°');
  // §180 검토: build --if-changed — 같은 바이트면 app.js·bundle.json 을 그대로(입력 sha 유지), 다르면 바꿈
  const IR = path.join(WORK, 'ifc'), mkNext = (txt, tag) => { const n = path.join(IR, '.next'); fs.mkdirSync(n, { recursive: true }); fs.writeFileSync(path.join(n, 'app.js'), txt); fs.writeFileSync(path.join(n, 'bundle.json'), JSON.stringify({ tag })); return n; };
  const i1 = P.installIfChanged(IR, mkNext('A', 1)), bj1 = fs.readFileSync(path.join(IR, 'bundle.json'), 'utf8');
  const i2 = P.installIfChanged(IR, mkNext('A', 2)), bj2 = fs.readFileSync(path.join(IR, 'bundle.json'), 'utf8');
  const i3 = P.installIfChanged(IR, mkNext('B', 3)), bj3 = fs.readFileSync(path.join(IR, 'bundle.json'), 'utf8');
  ok(i1.replaced && !i2.replaced && bj2 === bj1 && i3.replaced && /"tag":3/.test(bj3) && fs.readFileSync(path.join(IR, 'app.js'), 'utf8') === 'B' && !fs.existsSync(path.join(IR, '.next')),
    '§180 검토: build --if-changed — 없으면 놓음 · 같은 바이트면 bundle.json 까지 그대로 · 다르면 바꿈 · .next 지움');
  ok(P.parseArgs(['build', '--root', path.join(WORK, 'b'), '--if-changed']).ifChanged === true, 'build --if-changed 인자');
}

// ───────────────────────── [2] 지킴 ─────────────────────────
console.log('[2] 지킴');
{
  const pgOf = (grain, gpu) => pat => (/swiftshader/.test(pat) ? gpu : grain);
  ok(P.guardProblems(pgOf('', '')).length === 0, '빔 → 통과');
  ok(P.guardProblems(pgOf('777 node tools/genus-ruler/tsun/lighting-render-check.js --guard-tag genus-ruler/volsky/run.js --stage L5cross12-low', '')).length === 1, '태그 단 조명 단계가 돌면 거부');
  ok(P.guardProblems(pgOf('778 nice -n 19 node tools/genus-ruler/tsun/gpuwin-irrprobe.js run --guard-tag genus-ruler/volsky/run.js', '')).length === 0, '이 실행기 줄은 뺌(자기)');
  ok(P.guardProblems(pgOf('', '9 chrome --type=gpu-process --use-angle=swiftshader')).length === 1, 'SwiftShader GPU 과정 거부');
  // 창의 지킴(gpuwin-lib guardConflicts — classifyArgv)은 이 실행기를 grain 으로 보지 않음(시험 중에 진짜 창을 멈추지 않음) — 동결 eval-grain 은 태그로 봄
  const c = G.guardConflicts('779 node /x/tools/genus-ruler/tsun/gpuwin-irrprobe.js run --guard-tag genus-ruler/volsky/run.js --dry', '', [], { argvOf: null, cwdOf: () => '/x' });
  ok(c.length === 0, '창 guardConflicts: gpuwin-irrprobe(태그) 는 충돌 아님 → 마른 시험이 돌던 창을 세우지 않음');
  ok(new RegExp(L.GRAIN_PATTERN).test('node gpuwin-irrprobe.js run --guard-tag genus-ruler/volsky/run.js'), '태그 줄이 GRAIN_PATTERN 에 걸림 → 동결 eval-grain.sh guard_concurrent 가 탐침 페이지를 봄');
}

// ───────────────────────── [3] 셰이더 글자(가짜 렌더러) ─────────────────────────
console.log('[3] 셰이더 글자 — 앱 createVolumetricScene(가짜 렌더러) 구름 패스 글자 → 탐침 조립');
const HARNESS = `
import fs from 'node:fs';
import path from 'node:path';
import { Vector2, ShaderChunk } from 'three';
import { createVolumetricScene, type VolumetricOptions } from '${REPO}/src/components/VolumetricProbe/volumetricScene';
import { grainBaseOptions } from '${REPO}/tools/genus-ruler/grain/capture';
import { injectIrradianceLogMu, INSCATTER_CLOUDS_ANCHOR } from '${REPO}/src/components/VolumetricProbe/lightingFix';
import * as S from '${REPO}/tools/genus-ruler/tsun/gpuwin-irrshader';
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];
const W = 400, H = 300;
const gl = { getContextAttributes: () => ({ alpha: false }), getExtension: () => null, getParameter: () => 0 };
const renderer: any = { getSize: (v: Vector2) => v.set(W, H), getDrawingBufferSize: (v: Vector2) => v.set(W, H), getPixelRatio: () => 1,
  getContext: () => gl, outputColorSpace: 'srgb-linear', autoClear: true, toneMappingExposure: 1, capabilities: { logarithmicDepthBuffer: false, isWebGL2: true } };
const JOB_BASE_OPTIONS: Partial<VolumetricOptions> = cfg.jobBase;
const count = (s: string, a: string) => s.split(a).length - 1;
(async () => {
  const res: any = { checks: {} };
  const v: any = await createVolumetricScene(renderer, W, H, { genus: true, celestial: false, precomputed: {} as never });
  v.setOptions({ ...grainBaseOptions(JOB_BASE_OPTIONS, false), ...cfg.scene.options, clampInscatter: true, irradianceLogMu: true }, false);
  v.setQuality('low'); v.setResolutionScale(0.5);
  v.setScene({ ...cfg.scene.input, date: new Date(cfg.scene.input.date) });
  const m = v.debug.clouds.cloudsPass.currentMaterial;
  const fragOn = m.fragmentShader, vertOn = m.vertexShader;
  v.setOptions({ clampInscatter: false, irradianceLogMu: false }, false);
  const fragOff = m.fragmentShader, vertOff = m.vertexShader;
  v.setOptions({ clampInscatter: true, irradianceLogMu: true }, false);
  res.backOn = m.fragmentShader === fragOn;
  fs.writeFileSync(path.join(OUT, 'cloud.on.frag'), fragOn); fs.writeFileSync(path.join(OUT, 'cloud.off.frag'), fragOff);
  const preOff = S.cutAtmospherePrefix(fragOff), preOn = S.cutAtmospherePrefix(fragOn);
  res.pair = S.checkPrefixPair(preOff, preOn);
  const fnOf = (s: string) => S.functionText(s, S.GET_IRRADIANCE_SIG);
  res.vertexSame = { off: fnOf(vertOff) === fnOf(preOff), on: fnOf(vertOn) === fnOf(preOn) };
  res.getIrrOnEqualsInjected = fnOf(preOn) === fnOf(injectIrradianceLogMu(preOff, true)) && count(fnOf(preOn) ?? '', '§178 irradianceLogMu') === 1;
  res.prefixBytes = [preOff.length, preOn.length, fragOn.length];
  const frags: Record<string, string> = { table: S.tableProbeFragment(preOff), irrOld: S.irrProbeFragment(preOff), irrNew: S.irrProbeFragment(preOn),
    aerialRaw: S.aerialProbeFragment(preOn, 'raw'), aerialOff: S.aerialProbeFragment(preOn, 'off'), aerialOn: S.aerialProbeFragment(preOn, 'on'), aerialSky: S.aerialProbeFragment(preOn, 'sky') };
  res.static = Object.fromEntries(Object.entries(frags).map(([k, s]) => [k, S.staticCheck(s)]));
  for (const [k, s] of Object.entries(frags)) fs.writeFileSync(path.join(OUT, 'probe.' + k + '.frag'), s);
  // #if 짝(앞부분 + 탐침): #if/#ifdef/#ifndef 수 = #endif 수
  const cond = (s: string) => [(s.match(/^\\s*#\\s*if(n?def)?\\b/gm) ?? []).length, (s.match(/^\\s*#\\s*endif\\b/gm) ?? []).length];
  res.cond = Object.fromEntries(Object.entries(frags).map(([k, s]) => [k, cond(s)]));
  // 탐침 이름이 앞부분(과 three common)에 없음
  const names = ['probeMu', 'probeH', 'probeEnd', 'probeCam', 'probeSun', 'probeChan', 'probeOut', 'probeValue', 'probeAerial', 'PROBE_PACK'];
  const resolve = (s: string, depth = 0): string => s.replace(/^[ \\t]*#include +<([\\w\\d./]+)>/gm, (_m: string, n: string) => { const c = (ShaderChunk as any)[n]; if (c == null) return '#include <MISSING ' + n + '>'; return depth > 8 ? c : resolve(c, depth + 1); });
  const preRes = resolve(preOn);
  res.unresolvedIncludes = (preRes.match(/#include[^\\n]*/g) ?? []);
  res.collisions = names.filter(n => new RegExp('\\\\b' + n + '\\\\b').test(preRes));
  // 앞부분이 자른 뒤에서 선언되는 균일변수·in 변수를 쓰는지(쓰면 컴파일 오류)
  const after = fragOn.slice(fragOn.indexOf(S.PREFIX_END) + S.PREFIX_END.length);
  const declAfter = [...after.matchAll(/^\\s*(?:uniform|in|flat in)\\s+(?:highp\\s+|mediump\\s+|lowp\\s+)?\\w+\\s+(\\w+)/gm)].map(x => x[1]);
  // 주석을 지우고, 앞부분에서 함수 인자·지역 변수로 선언된 이름(가림)은 뺌 — 남은 이름이 진짜 '앞에서 씀'
  const preNc = preOn.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').replace(/\\/\\/[^\\n]*/g, '');
  res.usedBeforeDecl = declAfter.filter(n => new RegExp('\\\\b' + n + '\\\\b').test(preNc) && !new RegExp('\\\\b(?!return\\\\b)[A-Za-z_]\\\\w*\\\\s+' + n + '\\\\s*[,)=;\\\\[]').test(preNc));
  res.shadowedInPrefix = declAfter.filter(n => new RegExp('\\\\b' + n + '\\\\b').test(preNc) && !res.usedBeforeDecl.includes(n));
  res.quoteIncludes = (preOn.match(/#include\\s+"[^"]*"/g) ?? []);
  // 재질 defines·균일변수
  res.defines = { IRRADIANCE_TEXTURE_WIDTH: m.defines.IRRADIANCE_TEXTURE_WIDTH, IRRADIANCE_TEXTURE_HEIGHT: m.defines.IRRADIANCE_TEXTURE_HEIGHT, METER_TO_LENGTH_UNIT: m.defines.METER_TO_LENGTH_UNIT,
    HAS_HIGHER_ORDER: 'HAS_HIGHER_ORDER_SCATTERING_TEXTURE' in m.defines, COMBINED: 'COMBINED_SCATTERING_TEXTURES' in m.defines };
  res.uniforms = ['ATMOSPHERE', 'irradiance_texture', 'transmittance_texture', 'scattering_texture', 'single_mie_scattering_texture', 'higher_order_scattering_texture',
    'SUN_SPECTRAL_RADIANCE_TO_LUMINANCE', 'SKY_SPECTRAL_RADIANCE_TO_LUMINANCE', 'worldToECEFMatrix', 'altitudeCorrection', 'sunDirection', 'cameraPosition', 'bottomRadius'].filter(k => !(k in m.uniforms));
  res.glsl3 = m.glslVersion; res.isRaw = !!m.isRawShaderMaterial;
  res.aerialMarks = { on: count(frags.aerialOn, '§178 clampInscatter'), off: count(frags.aerialOff, INSCATTER_CLOUDS_ANCHOR), offClamp: count(frags.aerialOff, '§178 clampInscatter') };
  res.aerialTemplate = { off: S.aerialTemplateCheck(fragOff), on: S.aerialTemplateCheck(fragOn) };
  res.atm = { bottom: m.uniforms.ATMOSPHERE.value.bottom_radius, top: m.uniforms.ATMOSPHERE.value.top_radius };
  res.layers = v.debug.clouds.cloudLayers.map((l: any) => [l.altitude, l.height]);
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(res, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
`;
const entryGpuwin = fs.readFileSync(path.join(__dirname, 'entry-gpuwin.ts'), 'utf8'), entryIrr = fs.readFileSync(path.join(__dirname, 'gpuwin-irrentry.ts'), 'utf8');
const jobBaseText = s => { const i = s.indexOf('const JOB_BASE_OPTIONS'); return i < 0 ? null : s.slice(s.indexOf('{', i), s.indexOf('};', i) + 1); };
{
  // 자르기 점검: 함수 인자 'out vec4 x,' 는 통과, 전역 'layout(...) out vec4 y;' 는 거부(앞부분에 main 출력이 섞이면 탐침 출력과 겹침)
  const tsIn = path.join(WORK, 'irrshader-only.ts'), cjsOut = path.join(WORK, 'irrshader-only.cjs');
  fs.writeFileSync(tsIn, fs.readFileSync(path.join(__dirname, 'gpuwin-irrshader.ts'), 'utf8').replace(/^import .*lightingFix';$/m, 'const INSCATTER_CLOUDS_ANCHOR = "  color.rgb = color.rgb * transmittance + inscatter * color.a;", IRRADIANCE_ANCHOR = "x", injectInscatterClampClouds = (s: string, on: boolean) => s, injectIrradianceLogMu = (s: string, on: boolean) => s;'));
  run('npx', ['esbuild', tsIn, '--format=cjs', '--platform=node', `--outfile=${cjsOut}`, '--log-level=error']);
  const SH = fs.readFileSync(cjsOut, 'utf8');
  const M = {}; Function('module', 'exports', SH)(M, M.exports = {});
  const mkPre = mid => ['precision highp float;', 'uniform AtmosphereParameters ATMOSPHERE;', 'uniform sampler2D irradiance_texture;', 'IrradianceSpectrum GetIrradiance(int a) { return vec3(0.0); }', mid,
    '#define GetSkyRadiance GetSkyLuminance', '#define GetSkyRadianceToPoint GetSkyLuminanceToPoint', M.exports.PREFIX_END, 'void main() {}'].join('\n');
  let e1 = null, e2 = null, e3 = null;
  try { M.exports.cutAtmospherePrefix(mkPre('void f(\n  out vec4 intersection1,\n  out vec4 intersection2\n) {}')); } catch (e) { e1 = e.message; }
  try { M.exports.cutAtmospherePrefix(mkPre('layout(location = 0) out vec4 outputColor;')); } catch (e) { e2 = e.message; }
  try { M.exports.cutAtmospherePrefix(mkPre('') + '\n' + M.exports.PREFIX_END); } catch (e) { e3 = e.message; }
  ok(e1 === null && /fragment output/.test(e2 || '') && /marker count 2/.test(e3 || ''), `자르기 점검: 함수 인자 out 통과 · 전역 출력 거부 · 끝 표지 두 번 거부 (${e1} | ${e2} | ${e3})`);
}
ok(jobBaseText(entryGpuwin) !== null && jobBaseText(entryGpuwin) === jobBaseText(entryIrr), 'JOB_BASE_OPTIONS 글자가 entry-gpuwin.ts 와 같음');
ok(/createVolumetricScene\(renderer, W, H, \{ genus: true, celestial: false, spectral: true, effectiveTransmittance: true \}\)/.test(entryIrr) &&
  /createVolumetricScene\(renderer, W, H, \{ genus: true, celestial: false, spectral: true, effectiveTransmittance: true \}\)/.test(entryGpuwin), '장면 만들기 인자가 entry-gpuwin 과 같음(15 파장 · 유효 투과율)');
{
  // three: RawShaderMaterial + GLSL3 이면 출력 선언·gl_FragColor 정의를 붙이지 않음(탐침이 자기 out 을 선언)
  const wp = fs.readFileSync(path.join(REPO, 'node_modules/three/src/renderers/webgl/WebGLProgram.js'), 'utf8');
  const rawBranch = wp.slice(wp.indexOf('if ( parameters.isRawShaderMaterial )'), wp.indexOf('} else {', wp.indexOf('if ( parameters.isRawShaderMaterial )')));
  ok(rawBranch.length > 0 && !/pc_fragColor/.test(rawBranch) && /customDefines/.test(rawBranch), 'three WebGLProgram: Raw 가지는 defines 만(출력 선언 없음)');
  ok(/#version 300 es/.test(wp) && /resolveIncludes\( fragmentShader \)/.test(wp), 'three: GLSL3 이면 #version 300 es · 조각 글자의 #include <…> 를 Raw 에도 풂');
}
if (!process.argv.includes('--no-harness')) {
  const hd = path.join(WORK, 'harness'); fs.mkdirSync(hd, { recursive: true });
  const ts = path.join(hd, 'h.ts'), cjs = path.join(hd, 'h.cjs');
  fs.writeFileSync(ts, HARNESS);
  const S = JSON.parse(fs.readFileSync(SCN, 'utf8'));
  // JOB_BASE_OPTIONS(글자 → 값): entry 의 객체 글자를 JSON 으로
  const jb = Function('return ' + jobBaseText(entryIrr))();
  fs.writeFileSync(path.join(hd, 'cfg.json'), JSON.stringify({ scene: { input: S.P1B.input, options: S.P1B.options }, jobBase: jb }));
  const b = run('npx', ['esbuild', ts, '--bundle', '--format=cjs', '--platform=node', '--define:__DEV__=false', '--define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY="1"', `--outfile=${cjs}`, '--log-level=error'], {}, { timeout: 600000 });
  ok(b.status === 0, '하네스 묶기' + (b.status ? ' — ' + b.stderr.slice(0, 600) : ''));
  const h = b.status === 0 ? run('node', [cjs, path.join(hd, 'cfg.json'), hd], {}, { timeout: 600000 }) : { status: 1, stderr: 'not built' };
  ok(h.status === 0, '가짜 렌더러로 P1B 장면 만들고 글자 꺼냄' + (h.status ? ' — ' + String(h.stderr).slice(0, 800) : ''));
  let R = null; try { R = JSON.parse(fs.readFileSync(path.join(hd, 'result.json'), 'utf8')); } catch { /* */ }
  if (R) {
    ok(R.backOn, '끔 → 켬 setOptions 가 글자를 되돌림');
    ok(R.pair.offHasAnchor && R.pair.offMarks === 0, '끔 앞부분: GetIrradiance 가 takram 원문(앵커 한 번, §178 표지 없음)');
    ok(R.pair.onEqualsInjected && R.pair.onMarks === 1, '켬 앞부분 = injectIrradianceLogMu(끔 앞부분) — 다른 차이 없음');
    ok(R.getIrrOnEqualsInjected, '켬 GetIrradiance 몸통 = 앱 주입 글자(§178 irradianceLogMu 한 번)');
    ok(R.vertexSame.off && R.vertexSame.on, '구름 패스 정점 셰이더의 GetIrradiance = 조각 앞부분의 것(끔·켬)');
    ok(Object.values(R.static).every(x => x.length === 0), '탐침 글자 7 개 정적 점검(괄호·main 하나·probeValue 하나·출력 하나·표지) ' + JSON.stringify(R.static));
    ok(Object.values(R.cond).every(([a, b2]) => a === b2), '#if/#ifdef/#ifndef = #endif 짝 ' + JSON.stringify(R.cond.table));
    ok(R.collisions.length === 0, '탐침 이름이 앞부분·three 조각과 겹치지 않음 ' + JSON.stringify(R.collisions));
    ok(R.unresolvedIncludes.length === 0 && R.quoteIncludes.length === 0, 'three 조각 #include <…> 모두 풀림 · "…" include 는 이미 풀린 글자 ' + JSON.stringify(R.unresolvedIncludes.concat(R.quoteIncludes)).slice(0, 200));
    ok(R.usedBeforeDecl.length === 0, '앞부분이 자른 뒤에 선언되는 균일변수·in 을 쓰지 않음 ' + JSON.stringify(R.usedBeforeDecl).slice(0, 300));
    ok(Number(R.defines.IRRADIANCE_TEXTURE_WIDTH) === 64 && Number(R.defines.IRRADIANCE_TEXTURE_HEIGHT) === 16 && Math.abs(Number(R.defines.METER_TO_LENGTH_UNIT) - 0.001) < 1e-9,
      `재질 defines: 조도 표 ${R.defines.IRRADIANCE_TEXTURE_WIDTH}×${R.defines.IRRADIANCE_TEXTURE_HEIGHT} · METER_TO_LENGTH_UNIT ${R.defines.METER_TO_LENGTH_UNIT} · 고차 산란 표 ${R.defines.HAS_HIGHER_ORDER} · 합친 표 ${R.defines.COMBINED}`);
    ok(R.uniforms.length === 0, '재질 균일변수에 탐침이 쓰는 이름이 모두 있음 ' + JSON.stringify(R.uniforms));
    ok(R.glsl3 === '300 es' && R.isRaw, `구름 재질: RawShaderMaterial · GLSL3(${R.glsl3}) — 탐침도 같은 꼴`);
    ok(R.aerialMarks.on === 1 && R.aerialMarks.off === 1 && R.aerialMarks.offClamp === 0, '산란 탐침: 켬 = §178 clampInscatter 줄 한 번 · 끔 = 원문 합성 줄');
    ok(R.aerialTemplate && R.aerialTemplate.off.found && R.aerialTemplate.off.same && R.aerialTemplate.on.found && !R.aerialTemplate.on.same,
      '§180 검토: 산란 탐침 몸통 = 구름 패스 applyAerialPerspective(끔 글자 — 이름·그림자 0·probeSun 만 바꿈), 켬 글자와는 다름(점검이 차이를 봄) ' + JSON.stringify(R.aerialTemplate));
    ok(Math.abs(R.atm.bottom - 6360) < 1e-6 && Math.abs(R.atm.top - 6420) < 1e-6, `ATMOSPHERE 반지름 ${R.atm.bottom}..${R.atm.top} km(고정표 행 4 km = 60/15)`);
    ok(R.layers.some(([a, h2]) => Math.abs(a - 7400) < 300 && h2 > 0), 'P1B 층에 7.4 km 덮개 ' + JSON.stringify(R.layers));
    console.log(`      앞부분 ${R.prefixBytes[0]} / ${R.prefixBytes[1]} 자(구름 조각 ${R.prefixBytes[2]} 자) · 탐침 글자 ${hd}/probe.*.frag`);
  }
}

// ───────────────────────── [4] CPU 이식·분석 ─────────────────────────
console.log('[4] CPU 이식·분석(합성 표·고정표)');
const fxRaw = JSON.parse(fs.readFileSync(P.DEFAULT_FIXTURE, 'utf8'));
const FX = C.loadFixture(fxRaw);
{
  // verify-lighting-fixes.js 의 이식 글자(돌리지 않고 함수만 잘라 평가)
  const vsrc = fs.readFileSync(path.join(REPO, 'tools/shader-preview/verify-lighting-fixes.js'), 'utf8');
  const cut = vsrc.slice(vsrc.indexOf('function toHalf('), vsrc.indexOf('const Yof = c =>'));
  const V = Function(cut + '\nreturn { makeTable, fetchLinear, fetchLogMu, PIN };')();
  const T3 = V.makeTable(FX.coarse.arr, FX.coarse.H, FX.coarse.W);
  ok(V.PIN.FLOOR === C.PIN.FLOOR && V.PIN.RAMP_LO === C.PIN.RAMP_LO && V.PIN.RAMP_HI === C.PIN.RAMP_HI, '고정 상수(하한·램프)가 verify-lighting-fixes.js 와 같음');
  let dOld = 0, dNew = 0;
  const atm = { bottom: 6360, top: 6420, W: 64, H: 16 };
  for (const h of [0, 2, 5, 7.4, 13]) for (const e of C.eGrid()) {
    const mu = C.muOf(e), [u, v] = C.uvOf(atm, h, mu, false);
    const a = C.irrOldUv(FX.coarse, u, v), b = V.fetchLinear(T3, h / 60, mu), c = C.irrNewUv(FX.coarse, u, v), d = V.fetchLogMu(T3, h / 60, mu, V.PIN.FLOOR);
    for (let ch = 0; ch < 3; ch++) { dOld = Math.max(dOld, Math.abs(a[ch] - b[ch]) / Math.max(1e-30, Math.abs(b[ch]))); dNew = Math.max(dNew, Math.abs(c[ch] - d[ch]) / Math.max(1e-30, Math.abs(d[ch]))); }
  }
  ok(dOld < 1e-12 && dNew < 1e-12, `CPU 이식 = verify-lighting-fixes.js 이식(float64 uv): 예전 ${dOld.toExponential(1)} · 새 ${dNew.toExponential(1)}`);
  // float32 uv 흉내의 몫
  let d32 = 0;
  for (const h of [0, 2, 5, 7.4]) for (const e of C.eGrid()) { const mu = C.muOf(e), a = C.irrPort.new(FX.coarse, atm, h, mu), [u, v] = C.uvOf(atm, h, mu, false), b = C.irrNewUv(FX.coarse, u, v); for (let ch = 0; ch < 3; ch++) d32 = Math.max(d32, Math.abs(a[ch] - b[ch]) / Math.max(1e-30, Math.abs(b[ch]))); }
  ok(d32 < 1e-3, `float32 uv 흉내 vs float64 uv: 최대 상대 ${d32.toExponential(2)} (< 1e−3 — GPU 대조의 기준선)`);
}
/** 합성 표: 행 j 는 r 감쇠, 열 i 는 μs — 박명(μ<0)은 칸마다 10 배씩 줄고 낮은 완만. RGBA(stride 4) Float32. */
function synthTable(W = 64, H = 16) {
  const a = new Float32Array(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const mu = 2 * i / (W - 1) - 1, base = mu >= 0 ? 0.05 + 0.3 * mu : 0.05 * Math.pow(10, mu * (W - 1) / 2);
    for (let c = 0; c < 3; c++) a[(j * W + i) * 4 + c] = base * (1 - 0.01 * j) * [1.1, 1, 0.8][c];
    a[(j * W + i) * 4 + 3] = 1;
  }
  return a;
}
/** 8 비트 가중치 흉내(하드웨어 필터 가중치를 1/256 로 자름 — 기기마다 다름 [estimate]). */
function bilinearQ(T, u, v, q = 256) {
  const fx = u * T.W - 0.5, fy = v * T.H - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = Math.round((fx - x0) * q) / q, ay = Math.round((fy - y0) * q) / q;
  const cx = i => Math.max(0, Math.min(T.W - 1, i)), cy = j => Math.max(0, Math.min(T.H - 1, j));
  return [0, 1, 2].map(c => { const a = T.at(cy(y0), cx(x0), c) * (1 - ax) + T.at(cy(y0), cx(x0 + 1), c) * ax, b = T.at(cy(y0 + 1), cx(x0), c) * (1 - ax) + T.at(cy(y0 + 1), cx(x0 + 1), c) * ax; return a * (1 - ay) + b * ay; });
}
function newWithQ(T, u, v) {   // irrNewUv 와 같은 식, fetch 만 8 비트 가중치
  const irrW = T.W, irrX = Math.min(Math.max(u * irrW - 0.5, 0), irrW - 1), irrI = Math.min(Math.floor(irrX), irrW - 2), irrF = irrX - irrI;
  const A = bilinearQ(T, (irrI + 0.5) / irrW, v), B = bilinearQ(T, (irrI + 1.5) / irrW, v);
  return [0, 1, 2].map(c => { const lin = A[c] * (1 - irrF) + B[c] * irrF, la = Math.log(Math.max(A[c], 1e-30)), lb = Math.log(Math.max(B[c], 1e-30)), lg = Math.exp(la * (1 - irrF) + lb * irrF);
    const pos = Math.min(A[c], B[c]) >= 1e-30 ? 1 : 0, w = Math.min(1, Math.max(0, (Math.abs(lb - la) - Math.LN2) / Math.LN2)); return lin * (1 - pos * w) + lg * pos * w; });
}
/** 원값 꾸러미 만들기: table(RGBA) + irr(old/new) = fn(T, atm, h, mu). */
function mkRaw(tableArr, fnOld, fnNew, atm = { bottom: 6360, top: 6420, W: 64, H: 16 }) {
  const p = C.DEFAULT_PARAMS, es = C.eGrid(p), mus = es.map(C.muOf), hs = p.heightsKm, T = C.makeTable(tableArr, atm.W, atm.H, 4), N = es.length;
  const irr = { old: new Float32Array(N * hs.length * 4), new: new Float32Array(N * hs.length * 4) };
  for (let j = 0; j < hs.length; j++) for (let i = 0; i < N; i++) {
    const o = fnOld(T, atm, hs[j], mus[i]), n = fnNew(T, atm, hs[j], mus[i]), k = (j * N + i) * 4;
    for (let c = 0; c < 3; c++) { irr.old[k + c] = o[c]; irr.new[k + c] = n[c]; } irr.old[k + 3] = irr.new[k + 3] = 1;
  }
  return { atm, heightsKm: hs, es, mus, table: Array.from(tableArr), irr: { old: Array.from(irr.old), new: Array.from(irr.new) } };
}
{
  const atm = { bottom: 6360, top: 6420, W: 64, H: 16 };
  const syn = synthTable(), Ts = C.makeTable(syn, 64, 16, 4);
  // 절점·낮·연속
  let node = 0, day = 0, jump = 0;
  for (const h of [0, 5]) for (let i = 1; i < 63; i++) {
    const mu = 2 * i / 63 - 1, [, v] = C.uvOf(atm, h, mu, false), u = (i + 0.5) / 64;
    const n = C.irrNewUv(Ts, u, v), o = C.irrOldUv(Ts, u, v);
    for (let c = 0; c < 3; c++) node = Math.max(node, Math.abs(n[c] - o[c]) / o[c]);
    const a = C.irrNewUv(Ts, u - 1e-7, v), b = C.irrNewUv(Ts, u + 1e-7, v); for (let c = 0; c < 3; c++) jump = Math.max(jump, Math.abs(a[c] - b[c]) / (a[c] + b[c]));
  }
  for (const h of [0, 2, 5, 7.4]) for (const e of C.eGrid()) if (e >= 1) { const mu = C.muOf(e), o = C.irrPort.old(Ts, atm, h, mu), n = C.irrPort.new(Ts, atm, h, mu); for (let c = 0; c < 3; c++) day = Math.max(day, Math.abs(n[c] / o[c] - 1)); }
  ok(node < 1e-6, `합성 표: 텍셀 가운데에서 새 = 예전 = 표 값 (${node.toExponential(1)})`);
  ok(day < 1e-12, `합성 표: 해 ≥ +1°(이웃 비 < 2) 새 = 예전 (${day.toExponential(1)})`);
  ok(jump < 1e-4, `합성 표: 텍셀 가운데 양옆 ±1e−7 연속 (${jump.toExponential(1)})`);
  // 분석 끝까지: 같은 식 → 차 0
  const raw0 = mkRaw(syn, C.irrPort.old, C.irrPort.new);
  const A0 = C.analyzeIrr(raw0, FX);
  ok(A0.gpuVsCpu.old.maxRel <= 2 ** -23 && A0.gpuVsCpu.new.maxRel <= 2 ** -23 && A0.gpuVsCpu.old.n > 4000, `분석: 같은 식이면 GPU−CPU 차 = float32 반올림만 (예전 ${fmt(A0.gpuVsCpu.old.maxRel)} · 새 ${fmt(A0.gpuVsCpu.new.maxRel)} ≤ 2^−23, 표본 ${A0.gpuVsCpu.old.n}/변형) — RGBA32F 읽기의 바닥`);
  // 8 비트 가중치 흉내 → 차가 나타남(크기 = 기대 범위의 근거)
  const rawQ = mkRaw(syn, (T, a, h, mu) => { const [u, v] = C.uvOf(a, h, mu); return bilinearQ(T, u, v); }, (T, a, h, mu) => { const [u, v] = C.uvOf(a, h, mu); return newWithQ(T, u, v); });
  const AQ = C.analyzeIrr(rawQ, FX);
  ok(AQ.gpuVsCpu.old.maxRel > 1e-4 && AQ.gpuVsCpu.old.maxRel < 0.05 && AQ.gpuVsCpu.worst !== null, `분석: 8 비트 필터 가중치 흉내 → GPU−CPU 최대 상대 예전 ${fmt(AQ.gpuVsCpu.old.maxRel)} · 새 ${fmt(AQ.gpuVsCpu.new.maxRel)} (p99 ${fmt(AQ.gpuVsCpu.old.p99Rel)}) — 박명 이웃 비 10 배에서 [estimate 확인]`);
  // §180 검토: 필터 가중치 모형 맞춤 — 8 비트 흉내면 8bit-round 가, 같은 식이면 float 이 가장 맞고, 그 모형에서 남는 차는 float 반올림 수준
  ok(AQ.filterFit && AQ.filterFit.best.model === '8bit-round' && Math.max(AQ.filterFit.best.old, AQ.filterFit.best.new) < 1e-6 && A0.filterFit.best.model === 'float',
    `§180 검토: 필터 모형 맞춤 — 8 비트 흉내 → ${AQ.filterFit && AQ.filterFit.best.model} (남는 차 ${AQ.filterFit && fmt(Math.max(AQ.filterFit.best.old, AQ.filterFit.best.new))}) · 같은 식 → ${A0.filterFit && A0.filterFit.best.model}`);
  // §180 검토: 건전성 — 읽기가 비면(모두 0) GPU−이식 비교가 비어 통과처럼 보이던 것을 실패로
  const rawZ = mkRaw(new Float32Array(64 * 16 * 4), C.irrPort.old, C.irrPort.new);
  const AZ = C.analyzeIrr(rawZ, FX), sz = C.sanity(rawZ, AZ), s0 = C.sanity(raw0, A0);
  ok(AZ.gpuVsCpu.old.n === 0 && sz.length >= 3 && s0.length === 0, `§180 검토: 빈 읽기(표·조도 0) → 건전성 문제 ${sz.length} 개(${sz.slice(0, 2).join(' | ')}) · 정상 원값 → 0 개`);
  const goodChecks = { prefixOnEqualsInjectedOff: true, prefixOffIsTakramOriginal: true, prefixOnMarked: true, vertexSameGetIrradiance: true, aerialTemplateSame: true, packReadbackBitExact: null, spectral: true };
  ok(P.gateProblems(goodChecks, []).length === 0 && P.gateProblems({ ...goodChecks, spectral: false }, []).length === 1 && P.gateProblems({ ...goodChecks, packReadbackBitExact: false }, []).length === 1
    && P.gateProblems(goodChecks, sz).length === sz.length && P.gateProblems({ ...goodChecks, prefixOnEqualsInjectedOff: undefined }, []).length === 1,
    '§180 검토: ok 문 — 글자 점검(켬 = 주입(끔)·정점 같음·산란 몸통 같음)·15 파장·비트 포장 읽기·건전성 중 하나라도 어긋나면 ok 아님');
  // 고정표를 GPU 표 자리에(RGBA 로) — verify 의 CPU 결과와 같은 쪽: 깊은 박명 출렁임·과밝음이 줄어듦
  const fxRGBA = new Float32Array(64 * 16 * 4); for (let k = 0; k < 64 * 16; k++) { for (let c = 0; c < 3; c++) fxRGBA[k * 4 + c] = FX.coarse.arr[k * 3 + c]; fxRGBA[k * 4 + 3] = 1; }
  const rawF = mkRaw(fxRGBA, C.irrPort.old, C.irrPort.new);
  const AF = C.analyzeIrr(rawF, FX);
  const h0 = AF.perHeight.find(r => r.hKm === 0), b610 = h0.pulsingGain.find(b => b.band[0] === -10), b63 = h0.pulsingGain.find(b => b.band[0] === -6);
  ok(b610.old > 5 * b610.new && b63.old > 5 * b63.new, `고정표 = GPU 표 가정, 지면: 1.8° 창 출렁임 −10..−6° ${fmt((Math.exp(b610.old) - 1) * 100, 1)} → ${fmt((Math.exp(b610.new) - 1) * 100, 1)} % · −6..−3° ${fmt((Math.exp(b63.old) - 1) * 100, 1)} → ${fmt((Math.exp(b63.new) - 1) * 100, 1)} % (≥ 5 배 줄어듦 — verify (d)(4) 와 같은 쪽)`);
  const at0 = h0.variants.old.ref.at, at1 = h0.variants.new.ref.at;
  ok(at0.e === -9.4 && at0.r > at1.r && at1.q < 1.1, `해 −9.4° 지면: E/기준 ${fmt(at0.r)} → ${fmt(at1.r)} · 보간만 q ${fmt(at0.q)} → ${fmt(at1.q)} · 과밝음(÷ 큰 절점 치우침) ${fmt(at0.over)} → ${fmt(at1.over)}`);
  for (const r of AF.perHeight) { const b = r.pulsingGain.find(x => x.band[0] === -10); console.log(`      h ${r.hKm} km: −10..−6° 출렁임 ${fmt((Math.exp(b.old) - 1) * 100, 1)} → ${fmt((Math.exp(b.new) - 1) * 100, 1)} % · −9.4° q ${fmt(r.variants.old.ref.at.q)} → ${fmt(r.variants.new.ref.at.q)} · 맞춤 잔차 p2p(−10..−6) ${fmt(r.variants.old.fitPulsing[1].p2p)} → ${fmt(r.variants.new.fitPulsing[1].p2p)}`); }
  ok(AF.perHeight.every(r => r.pulsingGain && r.variants.new.ref.bands.every(b => b.n > 0)), '높이 0·2·5·7.4 km 모두 기준(세밀 행 r 선형) 있음');
  ok(AF.dayNewVsOld.cpuMaxRel < 1e-9, `고정표: 해 ≥ +1° 새 = 예전 (CPU ${AF.dayNewVsOld.cpuMaxRel.toExponential(1)})`);
  const TV = C.tableVsFixture(rawF, FX);
  ok(TV.maxRelTwilight === 0 && TV.maxRelDay === 0 && TV.medianRatio === 1, 'GPU 표 vs 고정표: 같은 표면 차 0 · 비 1');
  // 기준 없음(고정표 못 읽음) → 보고만
  const AN = C.analyzeIrr(raw0, null);
  ok(AN.notes.length === 1 && AN.perHeight.every(r => typeof r.ref === 'string' && r.variants.old.fitPulsing.length === 7), '고정표 없음: 기준 지표 건너뜀 · 맞춤 잔차 지표만');
  // 0 · 음수 텍셀이 있어도 분석이 깨지지 않음
  const synZ = synthTable(); for (let i = 0; i < 20; i++) synZ[i * 4] = 0; synZ[4 * 25 + 2] = -1e-15;
  let threw = null; try { C.analyzeIrr(mkRaw(synZ, C.irrPort.old, C.irrPort.new), FX); } catch (e) { threw = e.message; }
  ok(threw === null, '0·음수 텍셀이 있는 표에서도 분석이 끝까지(NaN 은 셈에서 빠짐)');
  // 산란 자르기 분석(합성)
  const gw = 10, gh = 8, n = gw * gh, rawA = new Array(n * 4).fill(0), off = new Array(n * 4).fill(0), on = new Array(n * 4).fill(0), sky = new Array(n * 4).fill(0), el = [], hit = [];
  for (let k = 0; k < n; k++) {
    const e = 4 + 12 * (Math.floor(k / gw) / (gh - 1)); el.push(e); hit.push(k % gw === 0 ? 0 : 1);
    const val = e < 10 ? -0.01 * (10 - e) : 0.02, rgbv = [val, val * 0.9, val * 1.2];
    for (let c = 0; c < 3; c++) { rawA[k * 4 + c] = rgbv[c]; off[k * 4 + c] = rgbv[c]; on[k * 4 + c] = Math.max(rgbv[c], 0); sky[k * 4 + c] = 0.1; }
    rawA[k * 4 + 3] = 0.8;
  }
  const AA = C.analyzeAerial({ gw, gh, el, hit, raw: rawA, off, on, sky });
  const a610 = AA.bands[0];
  ok(AA.nHit === n - gh && AA.offEqualsRawMaxRel === 0 && AA.onEqualsMaxRawZeroMaxRel === 0 && a610.fracNegY > 0 && a610.onMinChannel >= 0 && a610.rawOverSky.min < 0,
    `산란 분석(합성): 맞은 선 ${AA.nHit} · 6~10° 음수 비율 ${fmt(a610.fracNegY)} · 켬 최솟값 ${a610.onMinChannel} · raw/맑은 하늘 최소 ${fmt(a610.rawOverSky.min)}`);
  // analyze 명령(합성 원값 파일, 브라우저 없음)
  const rf = path.join(WORK, 'raw-synth.json'), jf = path.join(WORK, 'raw-synth.analysis.json');
  fs.writeFileSync(rf, JSON.stringify({ ...rawF, aerial: { gw, gh, el, hit, raw: rawA, off, on, sky } }));
  const ra = run('node', [RUNNER, 'analyze', '--raw', rf, '--json', jf]);
  let AJ = null; try { AJ = JSON.parse(fs.readFileSync(jf, 'utf8')); } catch { /* */ }
  ok(ra.status === 0 && AJ && AJ.irr && AJ.aerial && AJ.tableVsFixture && /GPU vs CPU-port/.test(ra.stdout), 'analyze 명령: 원값 파일 → 지표 JSON · 요약 줄');
  console.log(ra.stdout.split('\n').filter(Boolean).map(s => '      ' + s).join('\n'));
}

// ───────────────────────── [5] 패치(창이 끝난 뒤 걸 것) ─────────────────────────
if (PATCH) {
  console.log('[5] 패치 ' + PATCH);
  const pr = run('patch', ['-p1', '--dry-run', '-i', PATCH]);
  ok(pr.status === 0, '지금 파일에 깨끗이 걸림(patch --dry-run) ' + (pr.status ? pr.stdout + pr.stderr : ''));
  // 가짜 트리: tools/genus-ruler/tsun/ 의 모든 파일을 심볼릭 링크로, gpu-window.sh·gpuwin-post.mjs 만 패치한 사본 — ROOT 는 git 이 아님(더러운 트리 판단 = 빔)
  const FT = path.join(WORK, 'faketree'), FD = path.join(FT, 'tools/genus-ruler/tsun');
  fs.mkdirSync(FD, { recursive: true });
  // 패치가 고치는 파일은 사본(심볼릭 링크로 두면 patch 가 진짜 파일을 건드릴 수 있음) — '+++ b/…' 줄에서
  const touched = [...fs.readFileSync(PATCH, 'utf8').matchAll(/^\+\+\+ b\/(\S+)/gm)].map(m => m[1]);
  ok(touched.length >= 2 && touched.every(t => t.startsWith('tools/genus-ruler/tsun/') && !/lighting-render-check|entry-gpuwin|gpuwin-lib\.js/.test(t)),
    '패치가 고치는 파일: ' + touched.map(t => path.basename(t)).join(' · ') + ' — lighting-render-check.js · entry-gpuwin.ts · gpuwin-lib.js(L1~L6 입력 sha) 아님');
  const touchedBase = touched.map(t => path.basename(t));
  for (const f of fs.readdirSync(__dirname)) { const s = path.join(__dirname, f); if (fs.statSync(s).isFile() && !touchedBase.includes(f)) fs.symlinkSync(s, path.join(FD, f)); }
  fs.mkdirSync(path.join(FT, 'tools/shader-preview/fixtures'), { recursive: true }); fs.symlinkSync(P.DEFAULT_FIXTURE, path.join(FT, 'tools/shader-preview/fixtures/irradiance-app15.json'));
  const before = Object.fromEntries(touchedBase.map(f => [f, sha(fs.readFileSync(path.join(__dirname, f)))]));
  for (const f of touchedBase) fs.copyFileSync(path.join(__dirname, f), path.join(FD, f));
  const ap = run('patch', ['-p1', '-i', PATCH], {}, { cwd: FT });
  ok(ap.status === 0 && touchedBase.every(f => sha(fs.readFileSync(path.join(__dirname, f))) === before[f]), '가짜 트리 사본에 패치 걸기 · 진짜 파일은 그대로');
  if (touchedBase.includes('gpuwin-test.js')) ok(run('node', ['--check', path.join(FD, 'gpuwin-test.js')]).status === 0 && /'L6frametime-b', 'L7irrprobe', 'post light'/.test(fs.readFileSync(path.join(FD, 'gpuwin-test.js'), 'utf8')), '패치한 gpuwin-test.js: node --check · 단계 순서에 L7irrprobe');
  const SHP = path.join(FD, 'gpu-window.sh'), shTxt = fs.readFileSync(SHP, 'utf8'), shOld = fs.readFileSync(path.join(__dirname, 'gpu-window.sh'), 'utf8');
  ok(run('bash', ['-n', SHP]).status === 0 && run('node', ['--check', path.join(FD, 'gpuwin-post.mjs')]).status === 0, '패치한 gpu-window.sh bash -n · gpuwin-post.mjs node --check');
  const stepsOf = t => (t.slice(t.indexOf('STEPS=('), t.indexOf('\n)', t.indexOf('STEPS=('))).match(/"[^"]+"/g) || []);
  const sNew = stepsOf(shTxt), sOld = stepsOf(shOld);
  ok(sNew.length === sOld.length + 1 && sNew.filter(x => x !== '"L7irrprobe|light|L7irrprobe"').join() === sOld.join() && sNew.indexOf('"L7irrprobe|light|L7irrprobe"') === sNew.indexOf('"post-light|post|light"') - 1,
    'STEPS: L7irrprobe 하나만 더함(L6frametime-b 뒤 · post-light 앞), 다른 단계 그대로');
  const oldSha = 'sha=$($LIB input-sha "$BL/app.js" "$BL/bundle.json" "$JOBS/light-scenes.json" "$HERE/lighting-render-check.js" "$HERE/gpuwin-lib.js")';
  ok(shTxt.includes(oldSha) && shOld.includes(oldSha), 'L1~L6 입력 sha 줄이 바이트 그대로(끝난 표지 유효 — L1~L3 다시 안 돎)');
  ok(/irr_cmd\(\)/.test(shTxt) && /gpuwin-irrprobe\.js run --guard-tag \$TAG/.test(shTxt) && /--lock \$TL/.test(shTxt), 'L7 명령: 같은 태그·잠금(/tmp/run-tsun.lock)·--max-min');
  // 패치한 사본으로 plan · GW_DRY=1 run(L7 만) — 시험 GW_ROOT·잠금·가짜 pgrep·GW_HOLD=0
  const GR = path.join(WORK, 'gwroot'), JD = path.join(GR, 'jobs');
  fs.mkdirSync(JD, { recursive: true });
  const realJobs = path.join(SCR, 'gpuwin', 'jobs');
  for (const f of ['manifest.json', 'light-scenes.json']) if (fs.existsSync(path.join(realJobs, f))) fs.copyFileSync(path.join(realJobs, f), path.join(JD, f));
  for (const d of ['bundle-tsun', 'bundle-light', 'check']) fs.mkdirSync(path.join(GR, d), { recursive: true });
  fs.writeFileSync(path.join(GR, 'bundle-tsun', 'app.js'), '//'); fs.writeFileSync(path.join(GR, 'bundle-light', 'app.js'), '//'); fs.writeFileSync(path.join(GR, 'check', 'gpuwin-check.cjs'), '//');
  // prep 표지: 가짜 트리(git 아님)의 tree_sha = 빈 입력의 sha256 — prep 이 '최신'으로 보게
  const emptySha = sha('');
  G.writeMarker(path.join(GR, 'prep.json'), { id: 'prep', status: 'done', inputSha: emptySha, rc: 0 });
  const env = { GW_ROOT: GR, GW_OUT: path.join(GR, 'out'), GW_LOCK: path.join(WORK, 'gw.lock'), TSUN_LOCK: path.join(WORK, 'tsun2.lock'), GW_PGREP: FAKE, FAKE_PGREP_DIR: fakeDir('clear2'),
    GW_HOLD: '0', GW_DRY: '1', GW_MAX_WAIT_MIN: '1', GW_POLL_S: '1', GW_STABLE: '1', GW_STEPS: 'L7irrprobe,post-light' };
  const pl = run('bash', [SHP, 'plan'], env, { cwd: FT });
  const l7 = (pl.stdout.split('\n').find(l => l.startsWith('L7irrprobe: ')) || '');
  ok(pl.status === 0 && /gpuwin-irrprobe\.js run --guard-tag genus-ruler\/volsky\/run\.js --root \S+\/bundle-irr --scenes \S+\/jobs\/light-scenes\.json --out \S+\/out\/L --max-min 58 --lock \S+tsun2\.lock --fixture \S+irradiance-app15\.json/.test(l7) && /\[estimate \d+–\d+ min\]/.test(l7),
    'plan: L7irrprobe 줄 ' + l7.slice(0, 260));
  const dr = run('bash', [SHP, 'run'], env, { cwd: FT, timeout: 300000 });
  const glog = (() => { try { return fs.readFileSync(path.join(GR, 'out', 'logs', 'gpu-window.log'), 'utf8'); } catch { return ''; } })();
  const dl = (() => { try { return fs.readFileSync(path.join(GR, 'out', 'logs', 'L7irrprobe.log'), 'utf8'); } catch { return ''; } })();
  ok(dr.status === 0 && /\[dry\] L7irrprobe: would build \S+ \(--if-changed\)/.test(glog) && /L1compile: not selected/.test(glog) && /\[dry\] post light/.test(glog) && /\[dry\] exit 0/.test(glog),
    `GW_DRY=1 GW_STEPS=L7irrprobe,post-light run: 다른 단계 '선택 안 됨' · L7 번들 묶기 예고 · post light · 종료 ${dr.status}`);
  const cmdLine = (dl.match(/^\[dry\] (.*gpuwin-irrprobe\.js .*)$/m) || [])[1] || '';
  const parts = cmdLine.trim().split(/\s+/), ri = parts.findIndex(x => /gpuwin-irrprobe\.js$/.test(x));
  const pa = ri > 0 ? P.parseArgs(parts.slice(ri + 1)) : { error: 'no line' };
  ok(ri > 0 && parts.slice(0, ri - 1).join(' ') === 'nice -n 19' && !pa.error && pa.cmd === 'run' && pa.guardTag === TAG && pa.maxMin === 58 && /bundle-irr$/.test(pa.root),
    'dry 가 찍은 L7 명령 줄을 실행기 parseArgs 로 풀면 통과(nice -n 19 · 태그 · 58 분 · bundle-irr) ' + (pa.error || ''));
  ok(!fs.existsSync(path.join(GR, 'bundle-irr')), 'dry: 번들을 실제로 묶지 않음');
  // 패치한 post: L7 출력이 있으면 light 보고에 들어감(합성 출력)
  const LD = path.join(GR, 'out', 'L'); fs.mkdirSync(LD, { recursive: true });
  const AFX = P.analyzeAll(JSON.parse(fs.readFileSync(path.join(WORK, 'raw-synth.json'), 'utf8')), P.DEFAULT_FIXTURE);
  fs.writeFileSync(path.join(LD, 'L7irrprobe.json'), JSON.stringify({ stage: 'L7irrprobe', ok: true, result: { readback: 'float32' }, checks: { x: true }, analysis: AFX }));
  const po = run('node', [path.join(FD, 'gpuwin-post.mjs'), 'light', '--out', path.join(GR, 'out'), '--jobs', JD]);
  let LR = null; try { LR = JSON.parse(fs.readFileSync(path.join(GR, 'out', 'reports', 'light.json'), 'utf8')); } catch { /* */ }
  const s7 = LR && LR.stages && LR.stages.L7irrprobe;
  ok(po.status === 0 && s7 && s7.verdictGpuMatchesPort === 'pass' && s7.verdictDeepTwilightPulsingDown === 'pass' && s7.verdictClampNotNegative === 'pass' && s7.defectReproducedWhenOff === true && LR.missing.length === 6,
    `패치한 post light: L7 보고(${s7 && [s7.verdictGpuMatchesPort, s7.verdictDeepTwilightPulsingDown, s7.verdictClampNotNegative].join('/')}) · missing 은 L1~L6 그대로`);
  ok(s7 && s7.verdictGpuMatchesPortUnderFilterModel === 'pass' && s7.filterFit && Array.isArray(s7.sanity), `§180 검토: post 에 필터 모형 맞춤(${s7 && s7.filterFit && s7.filterFit.best.model}) · 건전성 목록`);
  // §180 검토: 빈 읽기의 L7 출력 → GPU−이식 판정이 pass 가 아니라 na
  const rawZ5 = mkRaw(new Float32Array(64 * 16 * 4), C.irrPort.old, C.irrPort.new);
  fs.writeFileSync(path.join(LD, 'L7irrprobe.json'), JSON.stringify({ stage: 'L7irrprobe', ok: false, result: { readback: 'float32' }, checks: {}, analysis: P.analyzeAll(rawZ5, P.DEFAULT_FIXTURE) }));
  run('node', [path.join(FD, 'gpuwin-post.mjs'), 'light', '--out', path.join(GR, 'out'), '--jobs', JD]);
  let LZ = null; try { LZ = JSON.parse(fs.readFileSync(path.join(GR, 'out', 'reports', 'light.json'), 'utf8')); } catch { /* */ }
  const z7 = LZ && LZ.stages && LZ.stages.L7irrprobe;
  ok(z7 && z7.verdictGpuMatchesPort === 'na' && z7.ok === false && z7.sanity.length > 0, `§180 검토: 빈 읽기 → post GPU−이식 판정 ${z7 && z7.verdictGpuMatchesPort}(통과 아님) · 건전성 ${z7 && z7.sanity.length} 개`);
} else console.log('[5] 패치 — --patch 없음, 건너뜀');

console.log(`\n${pass} passed, ${fail} failed (work ${WORK})`);
process.exit(fail ? 1 : 0);
