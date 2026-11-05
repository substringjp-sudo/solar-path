#!/usr/bin/env node
/**
 * g1-test.mjs — G1 기준 도구의 시험(S3-design.md §8, 자 L748·L862). 자의 기준을 바꾸지 않고, 도구가 그 기준을 제대로 재는지만 봅니다.
 *
 *   node tools/genus-ruler/oro/g1/g1-test.mjs [--only ID[,ID…]] [--baseline <g1-baseline.json>]
 *
 * 한 시험이 한 줄: `ID PASS|FAIL|SKIP key=value…`. exit 0 iff FAIL 없음(SKIP 은 통과가 아님).
 * --baseline: BASELINE·CONTAM 이 볼 파일(기본 tools/genus-ruler/oro/g1-baseline.json; 임시 측정은 .harness/oro/g1/ 아래).
 * "G1 build note N" = S3-design.md '### G1 baseline tooling' 아래 N 번(같은 번호가 oro.py 쪽에도 있음).
 *   MD5-ALLOW  g1-md5 가 허용 목록만 씀: 가짜 trueGrid·cover·empty 와 허용 밖 키를 바꾼 inputs 사본으로 출력 같음, 허용 키 하나를
 *              바꾸면 그 밴드만 달라짐(음성 대조), 두 번 따로 돌려 바이트 같음, fs 감사(읽은 파일·쓴 파일·명령), 금지 경로 거절.
 *   MD5-CROSS  실제 a 조각: oro-inputs 장면 수(121 + 확장) × 3, 모드 1 base md5 = oro-base 가 쓴 .harness/oro/base/<scene>__closest__<band>.f32 의 md5
 *              (같은 허용 목록 길·같은 B 번들), cover = base(noise false), macro 번들 = oro-base B 번들(Q-45), state 배열 = re·im;
 *              closest 고리 점이 12 개 미만인 밴드(확장 은행 osaka·sapporo 2026-10-31)는 a·aMode2 가 null 이고 oro-base 도 B null(그 밴드만).
 *   MD5-CHAIN  모드 2: 걸음마다 md5 가 다름(사슬이 실제로 걸음), 첫 장 ≠ 1 걸음; 사슬 번들로 다시 잰 모드 1 = B 번들 모드 1.
 *   JOBS       잡 파일을 다시 만들면 바이트 같음; 잡 넷·이름·G1 옵션; 고리 입력 = oro-inputs closest 고리(비트 같음); B0_app·P0_seoul
 *              의 나머지는 원래 잡 그대로; 산악 둘 = kanazawa 처음 두 날짜, dev, A1 ✓(oro-apply); 대조 잡 = 원래 잡; 감사.
 *   QKEY       qKey 식 꺼내기: 손으로 계산한 문자열과 같음, 식이 둘이면 거절.
 *   LIVE       g1-live 두 번(따로) 출력 바이트 같음, 검사 통과; 가로채기 음성 대조(남은 타이머·진짜 망 시도·D6 꼴 요청을 잡음).
 *   CALLSITES  정적 호출 자리(G1 build note 17): 작업 트리 = d 조각, 알려진 자리; src 사본(.ts/.tsx 만)에 한 줄씩 바꾼 변이 —
 *              실행 경로 밖의 요청(SkyScene3D fetch·이름 없는 weather 적재기·지형 요청 더함·volumetricScene WebSocket·liveScene 의
 *              닿지 않는 export)은 자리가 늘고, 실행 경로 안의 옵션 문(fetchDayWeatherRing 마지막 인자·buildLiveScene 적재기)은 그대로;
 *              runPath 가 세 요청 뿌리에 OPTIONS 를 마지막 인자로 넘김.
 *   RENDER     b 조각: A/A, 키 실행 = run1, 대조 = merge-aa.json, chromium 판·깃발 = merge-aa.json, 잡마다 키 하나, 부하 지킴 통과;
 *              호출 기록(G1 build note 19 fix G1-REC): invocation·stepRuns 다섯 단계, 한 호출, render-attempts.jsonl 에 exit 0 과 같은
 *              md5 로 있음, mismatches[] 마당 갖춤·aa/keysMatchRun1/controlMatchesMergeAA 와 맞음; 일꾼 1 개 고정(fix G1-DET).
 *   LOADGUARD  부하 지킴(G1 build note 19): 남의 CPU 프로세스(바쁜 고리)가 돌 때 g1-render --wait-idle 0 이 그리지 않고 exit 3, 그
 *              호출이 render-attempts.jsonl 에 exit 3 으로 남음; 조각 b 의 부하 기록을 바꾼 사본으로 g1-baseline 이 쓰지 않음;
 *              --final 은 status.final 이 아니면 쓰지 않음(G1 build note 20).
 *   INVOCATION 호출 id(G1 build note 19 fix G1-REC): control 이 다른 호출 id 인 b 사본은 status.renderSingleInvocation 거짓, --final
 *              이 거절(NOT-FINAL renderSingleInvocation); 호출 기록 없는 사본은 아예 거절; md5 하나를 고친 사본은 renderInvocationLogged
 *              거짓; status.renderAttempts 에 이 b 를 만든 호출(그 호출이 시작한 커밋 포함); 합성 기록으로 attemptsAtCommit(커밋들·
 *              끊긴 시도·b 호출 뒤의 시도 뺌·다른 커밋 뺌·어긋남 한 줄).
 *              (S3-design G1 build note 19 fix G1-REC 의 시험 6: control 이 다른 호출인 b 는 --final 이 거절, 어긋남 마당은 MISMATCH·RENDER.)
 *   MISMATCH   어긋남 재기(fix G1-REC): 거르개 0~4 를 모두 쓴 합성 PNG 풀기, 화소 수·상자·단계·채널; 합성 작업 폴더에서 characterise
 *              (aa·control, 기록과 다른 PNG 는 decoded 거짓); 실제 b 의 mismatches[] 마당; g1-baseline status.mismatches 요약.
 *   BASELINE   g1-baseline.json(--baseline): §8 꼴의 키와 G1 build note 19·20 의 status 마당, 장면(121 + 확장) × 3(고리 점 12 개 미만 밴드는 null), 15 걸음,
 *              조각에서 다시 모으면 바이트 같음.
 *   CONTAM     저장소에 gate-oro-*.json·judge.lock(.1) 없음, 조각·잡 파일·기준 파일·render-attempts.jsonl 에 MODIS 키(trueGrid·empty) 없음.
 */
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { createRequire } from 'node:module';
import {
  BANDS3, G1_HARNESS, ROOT, canonicalJson, extractQKey, md5, pickRingInputs, resolveCommit, ringPoints, sha256,
} from './g1-lib.mjs';
import { ATTEMPTS_FILE, INVOCATION_RE, appendAttempt, attemptsAtCommit, invocationCommits, invocationLogged, newInvocationId, readAttempts } from './g1-attempts.mjs';
import { decodePng, encodePng, mismatchSummary, pngDiff, validMismatch } from './g1-png.mjs';
import { characterise } from './g1-render.mjs';

const G = path.join(ROOT, 'tools/genus-ruler/oro/g1');
const INPUTS = path.join(ROOT, 'tools/genus-ruler/oro/oro-inputs.json');
const PARTS = path.join(G1_HARNESS, 'parts');
const TMP = path.join(G1_HARNESS, 'test-tmp');
const argOf = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const only = argOf('--only') ? new Set(argOf('--only').split(',')) : null;
const BASELINE_FILE = path.resolve(argOf('--baseline') ?? path.join(ROOT, 'tools/genus-ruler/oro/g1-baseline.json'));
const STEPS5 = ['build', 'run1', 'run2', 'control', 'keys'], RENDER4 = ['run1', 'run2', 'control', 'keys'], PINNED = ['run1', 'run2', 'keys'];
/** oro-inputs.json 의 장면 수(121 + 확장; §8 "121 (+ ext)"). 장면 이름만 셈. */
const nScenes = () => Object.keys(JSON.parse(fs.readFileSync(INPUTS, 'utf8')).scenes).length;
/** (a) 에서 null 이어야 할 밴드 `<scene>.<band>`: closest 고리의 유한한 점이 12 개 미만(앱 규칙 pts.length >= 12, Q-31; g1-md5 와 oro-base 가
 *  그 밴드를 null 로 둠). 확장 은행의 시각 끝 장면(osaka·sapporo 2026-10-31)이 그렇습니다. 고리 배열만 읽음(pickRingInputs). */
const nullBandsExpected = () => {
  const rings = pickRingInputs('g1-test', JSON.parse(fs.readFileSync(INPUTS, 'utf8')));
  const out = new Set();
  for (const sc of Object.keys(rings)) for (const b of BANDS3) if (!ringPoints(rings[sc], b)) out.add(`${sc}.${b}`);
  return out;
};
/** a·aMode2(·aMode2Init) 꼴: null 이어야 할 밴드는 셋 다 null, 나머지는 md5 들과 15 걸음. */
const aShapeOk = (X, sc, b, nulls) => (nulls.has(`${sc}.${b}`)
  ? X.a[sc][b] === null && X.aMode2[sc][b] === null && (!X.aMode2Init || X.aMode2Init[sc][b] === null)
  : !!X.a[sc][b] && typeof X.a[sc][b].cover === 'string' && !!X.a[sc][b].state && Array.isArray(X.aMode2[sc][b]) && X.aMode2[sc][b].length === 15);
const results = [];
const fmt = v => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v);

class Checks {
  constructor() { this.fails = []; this.kv = {}; this.skip = null; }
  ok(c, name) { if (!c) this.fails.push(name); return !!c; }
}
async function test(id, fn) {
  if (only && !only.has(id)) return;
  const ck = new Checks();
  try { await fn(ck); } catch (e) { ck.fails.push(`exception:${String((e && e.message) || e).slice(0, 120)}`); }
  const status = ck.skip ? 'SKIP' : ck.fails.length ? 'FAIL' : 'PASS';
  const kv = Object.entries(ck.kv).map(([k, v]) => `${k}=${fmt(v)}`).join(' ');
  const line = `${id} ${status} ${kv}${ck.fails.length ? ' failed=' + ck.fails.slice(0, 6).join(',') : ''}${ck.skip ? ' why=' + ck.skip : ''}`;
  results.push(status); console.log(line);
}
const fresh = d => { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); return d; };
const rdJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const node = (args, env) => cp.spawnSync('node', args, { cwd: ROOT, encoding: 'utf8', env: env ?? process.env, maxBuffer: 1 << 26 });

// ── fs 감사(oro-test.py G8a 의 FS_AUDIT_CJS 와 같은 꼴) ──
const FS_AUDIT_CJS = `'use strict';
const fs = require('fs'), cp = require('child_process'), path = require('path');
const LOG = process.env.G1_FS_AUDIT;
const LOGFD = fs.openSync(LOG, 'a');                    // 감싸기 전에 연 fd 에 writeSync 로만 적음(writeFileSync·appendFileSync 는 안에서 fs.openSync 를 부름)
const log = rec => fs.writeSync(LOGFD, JSON.stringify(rec) + '\\n');
const pathOf = p => typeof p === 'number' ? null : path.resolve(p instanceof URL ? p.pathname : String(p));
const wrapFs = (obj, names, tag) => {
  for (const fn of names) {
    const orig = obj[fn];
    if (typeof orig !== 'function') continue;
    obj[fn] = function (p, ...rest) {
      const flag = (fn === 'openSync' || fn === 'open') ? (typeof rest[0] === 'string' ? rest[0] : 'r')
        : (rest[0] && typeof rest[0] === 'object' && rest[0].flag) || null;
      log({ kind: 'fs', fn: tag + fn, path: pathOf(p), fd: typeof p === 'number', flag });
      return orig.call(this, p, ...rest);
    };
  }
};
wrapFs(fs, ['readFileSync', 'openSync', 'readFile', 'open', 'createReadStream', 'existsSync', 'readdirSync', 'statSync',
            'lstatSync', 'accessSync', 'opendirSync', 'writeFileSync', 'mkdirSync', 'rmSync'], '');
wrapFs(fs.promises, ['readFile', 'open', 'readdir', 'stat'], 'promises.');
for (const fn of ['execFileSync', 'execFile', 'spawnSync', 'spawn', 'execSync', 'exec', 'fork']) {
  const orig = cp[fn];
  cp[fn] = function (cmd, ...rest) {
    const args = Array.isArray(rest[0]) ? rest[0].map(String) : [];
    const opts = (Array.isArray(rest[0]) ? rest[1] : rest[0]) || {};
    log({ kind: 'cp', fn, cmd: String(cmd), args, cwd: opts.cwd ? path.resolve(String(opts.cwd)) : process.cwd() });
    return orig.call(this, cmd, ...rest);
  };
}
`;
function audited(script, args, dir) {
  const js = path.join(dir, 'fs-audit.cjs'), logf = path.join(dir, `audit-${path.basename(script)}.jsonl`);
  fs.writeFileSync(js, FS_AUDIT_CJS); fs.writeFileSync(logf, '');
  const r = node(['--require', js, script, ...args], { ...process.env, G1_FS_AUDIT: logf });
  const recs = fs.readFileSync(logf, 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x));
  return { r, recs };
}
const FORBID = /(\/\.harness\/macro\/|\/\.harness\/oro\/sat-|\/\.harness\/regime\/sat|\.png$|sat-quartiles|\/ring\/gate-|ringtruth-results|\/scratchpad\/restore\/|judge\.lock|gate-oro-|\/ring\/nwp\/|\/sounding[^/]*\.json$)/;
function classify(recs) {
  const reads = new Set(), writes = new Set(), cmds = [], bad = [];
  for (const r of recs) {
    if (r.kind === 'cp') { cmds.push(r); continue; }
    if (!r.path) continue;
    const p = r.path;
    if (FORBID.test(p)) bad.push(p);
    if (['readFileSync', 'readFile', 'createReadStream', 'promises.readFile'].includes(r.fn)) reads.add(p);
    else if (['openSync', 'open', 'promises.open'].includes(r.fn)) ((r.flag || 'r')[0] === 'r' ? reads : writes).add(p);
    else if (['writeFileSync', 'mkdirSync', 'rmSync'].includes(r.fn)) writes.add(p);
  }
  return { reads, writes, cmds, bad };
}

// ── 가짜 MODIS 키·허용 밖 키 ──
function injectFake(doc) {
  let k = 1;
  const rnd = () => { k = (Math.imul(k, 1103515245) + 12345) >>> 0; return k / 4294967296; };
  const tg = Buffer.from(Array.from({ length: 65536 }, () => Math.floor(rnd() * 256))).toString('base64');
  const fake = () => ({ trueGrid: tg, cover: rnd(), empty: rnd() });
  Object.assign(doc, fake());
  for (const sc of Object.values(doc.scenes)) {
    Object.assign(sc, fake());
    sc.ringGeom.cover = Array.from({ length: 91 }, rnd);
    sc.ring = sc.ringGeom.dist.map((d, i) => ({ dist: d, az: sc.ringGeom.az[i], cover: rnd() }));
    sc.zRef = 1234.5; sc.lat += 0.5;                                   // 허용 밖(모드 1·2 에 안 쓰임)
    for (const [t, e] of Object.entries(sc.times)) {
      Object.assign(e, fake());
      e.snd = { fake: rnd() }; e.bSha256 = { low: 'f'.repeat(64) };
      for (const [b, bd] of Object.entries(e.ring)) {
        bd.cover = Array.from({ length: 91 }, rnd);
        if (t !== 'closest' || b === 'total') {                       // 다른 시각·총운량 밴드는 값까지 바꿈
          const v = new Float64Array(91).fill(0.5); bd.f64 = Buffer.from(v.buffer).toString('base64'); bd.nullIdx = [];
        }
      }
    }
  }
  return doc;
}

// ───────────────────────── 시험 ─────────────────────────
await test('MD5-ALLOW', async ck => {
  if (!fs.existsSync(INPUTS)) { ck.skip = 'no oro-inputs.json'; return; }
  const d = fresh(path.join(TMP, 'md5-allow'));
  const raw = fs.readFileSync(INPUTS);
  const doc = JSON.parse(raw.toString('utf8'));
  const sc3 = Object.keys(doc.scenes).sort().slice(0, 3);
  const pOrig = path.join(d, 'inputs-orig.json'), pFake = path.join(d, 'inputs-fake.json'), pMut = path.join(d, 'inputs-mut.json');
  fs.writeFileSync(pOrig, raw);
  fs.writeFileSync(pFake, canonicalJson(injectFake(JSON.parse(raw.toString('utf8')))));
  const mut = JSON.parse(raw.toString('utf8'));
  { const bd = mut.scenes[sc3[0]].times.closest.ring.low; const v = new Float64Array(Uint8Array.from(Buffer.from(bd.f64, 'base64')).buffer);
    v[40] = v[40] > 0.5 ? v[40] - 0.25 : v[40] + 0.25; bd.f64 = Buffer.from(v.buffer).toString('base64'); }
  fs.writeFileSync(pMut, canonicalJson(mut));
  const run = (p, tag) => { const o = path.join(d, `out-${tag}.json`); const r = node([path.join(G, 'g1-md5.mjs'), '--inputs', p, '--scenes', sc3.join(','), '--out', o]); return { r, o }; };
  const A = run(pOrig, 'orig'), A2 = run(pOrig, 'orig2'), F = run(pFake, 'fake'), M = run(pMut, 'mut');
  for (const [t, x] of Object.entries({ A, A2, F, M })) if (!ck.ok(x.r.status === 0, `run-${t}`)) { ck.kv.stderr = (x.r.stderr || '').trim().split('\n').pop()?.slice(0, 100); return; }
  const a = rdJson(A.o), f = rdJson(F.o), m = rdJson(M.o);
  ck.ok(fs.readFileSync(A.o).equals(fs.readFileSync(A2.o)), 'deterministic');
  ck.ok(a.inputs.oroInputsSha256 !== f.inputs.oroInputsSha256, 'fakeFileDiffers');
  ck.ok(a.inputs.ringInputsSha256 === f.inputs.ringInputsSha256, 'ringHashSame');
  for (const k of ['a', 'aMode2', 'aMode2Init', 'bundles']) ck.ok(JSON.stringify(a[k]) === JSON.stringify(f[k]), `fakeSame:${k}`);
  // 음성 대조: 허용 키(closest low 의 점 하나)를 바꾸면 그 장면의 low 만 달라짐
  const s0 = sc3[0];
  ck.ok(JSON.stringify(m.a[s0].low) !== JSON.stringify(a.a[s0].low) && m.aMode2[s0].low.every((x, i) => x !== a.aMode2[s0].low[i]), 'mutChangesBand');
  ck.ok(JSON.stringify(m.a[s0].mid) === JSON.stringify(a.a[s0].mid) && JSON.stringify(m.a[sc3[1]]) === JSON.stringify(a.a[sc3[1]]), 'mutOnlyThatBand');
  // 감사
  const oc = path.join(d, 'out-audit.json');
  const { r, recs } = audited(path.join(G, 'g1-md5.mjs'), ['--inputs', pFake, '--scenes', sc3.join(','), '--out', oc], d);
  if (!ck.ok(r.status === 0, 'run-audit')) return;
  ck.ok(fs.readFileSync(oc).equals(fs.readFileSync(F.o)), 'auditSame');
  const { reads, writes, cmds, bad } = classify(recs);
  const commit = a.commit;
  const bdirs = ['macro', 'chain'].map(k => path.join(G1_HARNESS, 'bundle', k, commit));
  const own = p => p === oc || bdirs.some(b => p === b || p.startsWith(b + path.sep)) || p === path.dirname(oc);
  const allowedReads = new Set([pFake, ...bdirs.map(b => path.join(b, 'macro.cjs')), path.join(G, 'g1-md5.mjs'), path.join(G, 'g1-lib.mjs')]);
  const extraReads = [...reads].filter(p => !allowedReads.has(p));
  const extraWrites = [...writes].filter(p => !own(p));
  ck.ok(!bad.length, 'forbiddenPath'); ck.ok(!extraReads.length, 'extraReads'); ck.ok(!extraWrites.length, 'extraWrites');
  ck.ok(reads.has(pFake) && bdirs.every(b => reads.has(path.join(b, 'macro.cjs'))), 'expectedReads');
  const want = [['git', ['rev-parse', '--quiet', '--verify', 'HEAD^{commit}'], ROOT]];
  for (const b of bdirs) {
    want.push(['git', ['show', `${commit}:src/utils/macroField.ts`], ROOT], ['git', ['show', `${commit}:src/components/VolumetricProbe/cloudFlow.ts`], ROOT]);
    want.push(['npx', ['--yes', 'esbuild@0.28.2', '--version'], b], ['npx', ['--yes', 'esbuild@0.28.2', 'entry.ts', '--bundle', '--format=cjs', '--platform=node', '--outfile=macro.cjs', '--log-level=warning'], b]);
  }
  const got = cmds.map(c => [c.cmd, c.args, c.cwd]);
  ck.ok(JSON.stringify(got) === JSON.stringify(want), 'commands');
  ck.kv = { ...ck.kv, scenes: sc3.length, reads: reads.size, writes: writes.size, cmds: got.length, extra: extraReads.length + extraWrites.length, forbidden: bad.length };
  // 금지 경로 인자는 아무것도 열지 않고 거절(exit 2)
  const forb = [path.join(ROOT, '.harness/macro/sat/x.json'), path.join(ROOT, '.harness/oro/sat-ext/y.json'), path.join(ROOT, 'tools/genus-ruler/macro/sat-quartiles.json')];
  let refused = 0;
  for (const p of forb) {
    const x = audited(path.join(G, 'g1-md5.mjs'), ['--inputs', p, '--out', path.join(d, 'never.json')], d);
    const touched = x.recs.some(q => q.path === p);
    if (x.r.status === 2 && /path refused/.test(x.r.stderr) && !touched && !fs.existsSync(path.join(d, 'never.json'))) refused++;
  }
  ck.ok(refused === forb.length, 'forbiddenArgRefused');
  ck.kv.refused = refused;
});

await test('MD5-CROSS', async ck => {
  const af = path.join(PARTS, 'a.json');
  if (!fs.existsSync(af)) { ck.skip = 'no a.json part'; return; }
  const A = rdJson(af);
  const names = Object.keys(A.a).sort();
  const nSc = nScenes(), nulls = nullBandsExpected();
  ck.ok(names.length === nSc && A.inputs.scenes === nSc && names.every(s => BANDS3.every(b => aShapeOk(A, s, b, nulls))), 'shapeScenesx3x15');
  const live = names.flatMap(s => BANDS3.filter(b => !nulls.has(`${s}.${b}`)).map(b => [s, b]));
  const head = resolveCommit('g1-test', 'HEAD');
  ck.ok(A.commit === head || cp.spawnSync('git', ['diff', '--quiet', A.commit, head, '--', 'src', 'tools/genus-ruler/volsky'], { cwd: ROOT }).status === 0, 'commitAppSameAsHEAD');
  ck.ok(A.inputs.oroInputsSha256 === sha256(fs.readFileSync(INPUTS)), 'inputsSha');
  ck.ok(JSON.stringify(A.defs.stateArrayTypes) === JSON.stringify({ im: 'Float64Array', re: 'Float64Array' }), 'stateArraysReIm');
  let coverEqBase = 0;
  for (const [s, b] of live) if (A.a[s][b]?.cover === A.a[s][b]?.base) coverEqBase++;
  ck.ok(coverEqBase === live.length, 'coverEqualsBaseNoNoise');
  const baseDir = path.join(ROOT, '.harness/oro/base');
  if (!fs.existsSync(path.join(baseDir, 'index.json'))) { ck.skip = 'no .harness/oro/base'; return; }
  const idx = rdJson(path.join(baseDir, 'index.json'));
  ck.ok(idx.bundleSha256 === A.bundles.macro.sha256, 'q45BundleSame');
  let same = 0, diff = 0, missing = 0, nullBoth = 0;
  for (const [s, b] of live) {
    const f = path.join(baseDir, `${s}__closest__${b}.f32`);
    if (!fs.existsSync(f)) { missing++; continue; }
    if (md5(fs.readFileSync(f)) === A.a[s][b]?.base) same++; else diff++;
  }
  // null 밴드는 oro-base 도 B null(index 의 closest 항목 null, .f32 없음)
  for (const k of nulls) {
    const [s, b] = [k.slice(0, k.lastIndexOf('.')), k.slice(k.lastIndexOf('.') + 1)];
    if (idx.entries?.[s]?.closest?.[b] === null && !fs.existsSync(path.join(baseDir, `${s}__closest__${b}.f32`))) nullBoth++;
  }
  ck.ok(same === live.length && diff === 0 && missing === 0 && nullBoth === nulls.size, 'baseMd5EqualsOroBase');
  ck.kv = { scenes: names.length, bands: live.length, nullBands: nulls.size, same, diff, missing, nullBoth, coverEqBase };
});

await test('MD5-CHAIN', async ck => {
  const af = path.join(PARTS, 'a.json');
  if (!fs.existsSync(af)) { ck.skip = 'no a.json part'; return; }
  const A = rdJson(af);
  let allDistinct = 0, initDiff = 0, total = 0, nNull = 0;
  for (const s of Object.keys(A.aMode2)) for (const b of BANDS3) {
    const ch = A.aMode2[s][b];
    if (ch === null) { nNull++; continue; }          // 고리 점 12 개 미만(MD5-CROSS 가 그 자리를 봄)
    total++;
    if (new Set(ch).size === ch.length) allDistinct++;
    if (A.aMode2Init[s][b] !== ch[0] && !ch.includes(A.aMode2Init[s][b])) initDiff++;
  }
  ck.ok(allDistinct === total && initDiff === total, 'chainSteps');
  // 사슬 번들로 다시 잰 모드 1 = a(B 번들) — 앞 두 장면
  const req = createRequire(import.meta.url);
  const MC = req(path.join(G1_HARNESS, 'bundle', 'chain', A.commit, 'macro.cjs'));
  const scenes = pickRingInputs('g1-test', rdJson(INPUTS));
  let eq = 0, n = 0;
  for (const s of Object.keys(scenes).sort().slice(0, 2)) for (const b of BANDS3) {
    const pts = ringPoints(scenes[s], b);
    if (!pts) continue;
    const f = MC.buildMacroField(MC.samplesFromRing(pts.map(p => ({ ...p, cover: p.cover * 100 }))), { n: 128, cellKm: 6, noise: false }, null);
    const by = x => md5(Buffer.from(x.buffer, x.byteOffset, x.byteLength));
    n++; if (by(f.base) === A.a[s][b].base && by(f.lambdaRes) === A.a[s][b].lambdaRes && by(f.state.re) === A.a[s][b].state.re && by(f.state.im) === A.a[s][b].state.im) eq++;
  }
  ck.ok(eq === n && n > 0 && total > 0, 'chainBundleMode1Same');
  ck.kv = { bands: total, nullBands: nNull, distinct: allDistinct, initDiff, mode1Same: `${eq}/${n}` };
});

await test('JOBS', async ck => {
  const jf = path.join(G, 'jobs-g1.json');
  if (!fs.existsSync(jf)) { ck.skip = 'no jobs-g1.json'; return; }
  const d = fresh(path.join(TMP, 'jobs'));
  const o2 = path.join(d, 'jobs.json'), c2 = path.join(d, 'control.json');
  const { r, recs } = audited(path.join(G, 'g1-jobs.mjs'), ['--inputs', INPUTS, '--out', o2, '--control', c2], d);
  if (!ck.ok(r.status === 0, 'run')) return;
  ck.ok(fs.readFileSync(o2).equals(fs.readFileSync(jf)), 'regenSame');
  const { reads, bad } = classify(recs);
  const allowed = new Set([INPUTS, path.join(ROOT, 'tools/genus-ruler/shape/jobs-overcast.json'), path.join(ROOT, 'tools/genus-ruler/flow/jobs-phys-guards.json'),
    path.join(G, 'g1-jobs.mjs'), path.join(G, 'g1-lib.mjs')]);
  ck.ok(!bad.length && [...reads].every(p => allowed.has(p)), 'auditReads');
  const jobs = rdJson(jf);
  const names = jobs.map(j => j.name);
  ck.ok(JSON.stringify(names) === JSON.stringify(['B0_app', 'P0_seoul', 'M_kanazawa_2026-09-01', 'M_kanazawa_2026-09-05']), 'names');
  ck.ok(jobs.every(j => j.options && j.options.macro === 1 && j.options.macroN === 128 && j.options.macroOro === 0 && j.options.regime === 0), 'g1Options');
  const scenes = pickRingInputs('g1-test', rdJson(INPUTS), true);
  const want = { B0_app: 'seoul_2026-10-15', P0_seoul: 'seoul_2026-10-11', 'M_kanazawa_2026-09-01': 'kanazawa_2026-09-01', 'M_kanazawa_2026-09-05': 'kanazawa_2026-09-05' };
  let ringOk = 0;
  for (const j of jobs) {
    const s = scenes[want[j.name]];
    const okBand = b => { const pts = j.input.macro[b]; return pts.length === 91 && pts.every((p, i) => p.distance === s.dist[i] && p.azimuthOffset === s.az[i] && Object.is(p.cover, s.ring[b][i])); };
    if (BANDS3.every(okBand)) ringOk++;
  }
  ck.ok(ringOk === 4, 'ringBitExact');
  // 서울 고리 장면 = closest 시각이 잡 시각에 가장 가까운 서울 장면
  const seoul = Object.keys(scenes).filter(k => scenes[k].site === 'seoul');
  const nearest = iso => seoul.slice().sort((x, y) => Math.abs(Date.parse(scenes[x].utc) - Date.parse(iso)) - Math.abs(Date.parse(scenes[y].utc) - Date.parse(iso)) || (x < y ? -1 : 1))[0];
  ck.ok(nearest(jobs[0].input.date) === want.B0_app && nearest(jobs[1].input.date) === want.P0_seoul, 'nearestSeoul');
  const origs = { B0_app: rdJson(path.join(ROOT, 'tools/genus-ruler/shape/jobs-overcast.json')).find(x => x.name === 'B0_app'),
    P0_seoul: rdJson(path.join(ROOT, 'tools/genus-ruler/flow/jobs-phys-guards.json')).find(x => x.name === 'P0_seoul') };
  let restSame = 0;
  for (const n of ['B0_app', 'P0_seoul']) {
    const j = JSON.parse(JSON.stringify(jobs.find(x => x.name === n))), og = origs[n];
    delete j.input.macro;
    const oo = { ...(og.options ?? {}) }, jo = { ...j.options };
    const optsOk = Object.entries(oo).every(([k, v]) => jo[k] === v);
    delete j.options; const og2 = JSON.parse(JSON.stringify(og)); delete og2.options;
    if (optsOk && canonicalJson(j) === canonicalJson(og2)) restSame++;
  }
  ck.ok(restSame === 2, 'restAsOriginal');
  const apply = rdJson(path.join(ROOT, 'tools/genus-ruler/oro/oro-apply.json')).scenes;
  const kz = Object.keys(scenes).filter(k => scenes[k].site === 'kanazawa').sort().slice(0, 2);
  ck.ok(JSON.stringify(kz) === JSON.stringify(['kanazawa_2026-09-01', 'kanazawa_2026-09-05']) && kz.every(k => apply[k].A1.ok === true && apply[k].group === 'dev'), 'mountainA1Dev');
  const ctl = rdJson(c2);
  ck.ok(canonicalJson(ctl) === canonicalJson([origs.B0_app, origs.P0_seoul]), 'controlIsOriginal');
  ck.kv = { jobs: jobs.length, ringOk, restSame, reads: reads.size };
});

await test('QKEY', async ck => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/SkyScene3D/SkyScene3D.tsx'), 'utf8');
  const e = extractQKey(src);
  ck.ok(e.fn({}) === 'low|0.5|0|0|0|0|1|0|1|1', 'defaults');
  ck.ok(e.fn({ volumetricQuality: 'high', volumetricRes: 1, volumetricFlow: true, volumetricMacro: 2, volumetricClampInscatter: false, volumetricMacroOro: 0, volumetricRegime: 0 }) === 'high|1|1|0|0|0|2|0|0|1', 'handValue');
  let refused = false;
  try { extractQKey(src + '\n            const qKey = `${q}`;\n'); } catch { refused = true; }
  ck.ok(refused, 'twoTemplatesRefused');
  ck.kv = { template: e.template.length, q: e.qExpr };
});

await test('LIVE', async ck => {
  const d = fresh(path.join(TMP, 'live'));
  const r1 = node([path.join(G, 'g1-live.mjs'), '--out', path.join(d, 'd1.json')]);
  const r2 = node([path.join(G, 'g1-live.mjs'), '--out', path.join(d, 'd2.json')]);
  ck.ok(r1.status === 0 && r2.status === 0, 'checksPass');
  if (r1.status !== 0) ck.kv.out = (r1.stdout || '').split('\n').filter(l => l.startsWith('FAIL')).join(';').slice(0, 160);
  if (!fs.existsSync(path.join(d, 'd1.json')) || !fs.existsSync(path.join(d, 'd2.json'))) return;
  ck.ok(fs.readFileSync(path.join(d, 'd1.json')).equals(fs.readFileSync(path.join(d, 'd2.json'))), 'deterministic');
  const D = rdJson(path.join(d, 'd1.json'));
  const pd = path.join(PARTS, 'd.json');
  if (fs.existsSync(pd)) ck.ok(fs.readFileSync(pd).equals(fs.readFileSync(path.join(d, 'd1.json'))), 'partSame');
  const hosts = D.requests.map(q => new URL(q.url).hostname);
  ck.ok(D.requests.length === 7 && hosts.filter(h => h === 'api.open-meteo.com').length === 4, 'requestSet');
  // 감사 자체의 감도: 감사 훅이 읽기를 실제로 적는지(허용 밖 파일 하나를 읽는 작은 스크립트)
  {
    const probe = path.join(d, 'probe.cjs');
    fs.writeFileSync(probe, `require('fs').readFileSync(${JSON.stringify(path.join(ROOT, 'package.json'))});\n`);
    const { recs } = audited(probe, [], d);
    ck.ok(classify(recs).reads.has(path.join(ROOT, 'package.json')), 'auditSensitive');
  }
  // 음성 대조: 가로채기가 남은 타이머·진짜 망·D6 꼴 요청을 실제로 잡는지
  const code = `import { installIntercepts, isD6D14 } from ${JSON.stringify(path.join(G, 'g1-live.mjs'))};
const { log, pending, restore } = installIntercepts(0);
setTimeout(() => {}, 1000); const h = setTimeout(() => {}, 1000); clearTimeout(h); setInterval(() => {}, 1000);
await fetch('https://api.open-meteo.com/v1/forecast?latitude=1&longitude=2&hourly=wind_speed_925hPa,shortwave_radiation&start_date=2026-10-15&end_date=2026-10-15');
let threw = 0; try { (await import('node:https')).default.request('https://example.com'); } catch { threw = 1; }
const out = { pending: pending.size, created: log.timers.setTimeout + log.timers.setInterval, cleared: log.timers.cleared, requests: log.requests.length, real: log.realNetwork.length, threw,
  d6: isD6D14(log.requests[0].url), sat: isD6D14('https://satellite-api.open-meteo.com/v1/archive?latitude=1&longitude=2&hourly=shortwave_radiation'),
  base: isD6D14('https://api.open-meteo.com/v1/forecast?latitude=1&longitude=2&hourly=wind_speed_850hPa,cloud_cover_low') };
restore(); console.log(JSON.stringify(out)); process.exit(0);`;
  const n = cp.spawnSync('node', ['--input-type=module', '-e', code], { cwd: ROOT, encoding: 'utf8' });
  let neg = null; try { neg = JSON.parse(n.stdout.trim().split('\n').pop()); } catch { /* */ }
  ck.ok(neg && neg.pending === 2 && neg.created === 3 && neg.cleared === 1 && neg.requests === 1 && neg.real === 1 && neg.threw === 1 && neg.d6 === true && neg.sat === false && neg.base === false, 'negativeControl');
  ck.kv = { requests: D.requests.length, rebuilds: D.rebuilds, timers: D.timers, pendingAtEnd: D.timersDetail.pendingAtEnd, neg: neg ? `${neg.pending}/${neg.real}/${neg.d6}` : 'none' };
});

await test('CALLSITES', async ck => {
  const live = await import(path.join(G, 'g1-live.mjs'));
  const base = live.scanCallSites(ROOT);
  ck.ok(Object.keys(base.info.parseDiagnostics).length === 0 && base.sites.length > 0 && JSON.stringify(base.sites) === JSON.stringify([...base.sites].sort()), 'parsedSorted');
  const pd = path.join(PARTS, 'd.json');
  if (fs.existsSync(pd)) ck.ok(JSON.stringify(rdJson(pd).callSites) === JSON.stringify(base.sites), 'partSame');
  const want = ['src/components/SkyScreen/SkyScreen.tsx:fetchDayWeatherRing', 'src/components/SkyScreen/SkyScreen.tsx:fetchWeatherCanary',
    'src/components/SkyScene3D/SkyScene3D.tsx:fetchNearestMetar', 'src/components/SkyScene3D/SkyScene3D.tsx:fetchDayWeatherRing', 'src/store/useCelestialStore.ts:fetch'];
  ck.ok(want.every(w => base.sites.includes(w)) && !base.sites.some(x => x.startsWith('src/utils/weather.ts:fetchDayWeatherRing:')), 'knownSites');
  // 변이: src 의 .ts/.tsx 만 사본으로(저장소는 건드리지 않음)
  const SKY = 'src/components/SkyScene3D/SkyScene3D.tsx', W = 'src/utils/weather.ts', LV = 'src/components/VolumetricProbe/liveScene.ts';
  const PULL = '    pull();\n    const id = setInterval(pull, 10 * 60_000);';
  const HEAD = 'export function buildLiveScene(a: LiveSceneArgs): LiveScene {\n';
  const LOADER = "\nexport const loadOroObs = async (lat: number, lon: number) => {\n  const r = await fetchWithTimeout(`https://x.invalid/?latitude=${lat}&longitude=${lon}`, {}, 8000);\n  return r.ok ? r.json() : null;\n};\n";
  const CANARY = '\nexport const fetchWeatherCanary = async (';
  const RING = '  nowMs?: number\n): Promise<CloudPathData[]> => {\n';
  const MUT = {
    skyFetch: [[[SKY, PULL, '    pull();\n    void fetch(`https://x.invalid/?wind_speed_700hPa`).catch(() => null);\n    const id = setInterval(pull, 10 * 60_000);']], ['src/components/SkyScene3D/SkyScene3D.tsx:fetch']],
    skyLoader: [[[W, CANARY, LOADER + CANARY], [SKY, "import { fetchDayWeatherRing, type CloudPathData } from '../../utils/weather';", "import { fetchDayWeatherRing, loadOroObs, type CloudPathData } from '../../utils/weather';"],
      [SKY, PULL, '    pull();\n    void loadOroObs(metarLat, metarLon).catch(() => null);\n    const id = setInterval(pull, 10 * 60_000);']],
    ['src/components/SkyScene3D/SkyScene3D.tsx:loadOroObs', 'src/utils/weather.ts:loadOroObs:fetchWithTimeout']],
    terrainExtra: [[[W, '      const response = await fetchWithTimeout(url, {}, 6000);', '      void fetchWithTimeout(url + "&x=1", {}, 6000);\n      const response = await fetchWithTimeout(url, {}, 6000);']],
      ['src/utils/weather.ts:fetchTerrainProfile:fetchWithTimeout']],
    volWebSocket: [[['src/components/VolumetricProbe/volumetricScene.ts', 'export const LOW_MIN_STEP_M = 50;', 'export const LOW_MIN_STEP_M = 50;\nexport const oroWs = (u: string) => new WebSocket(u);']],
      ['src/components/VolumetricProbe/volumetricScene.ts:WebSocket']],
    liveOutOfTree: [[[LV, 'export const CB_TOP_KM = 10;', 'export const CB_TOP_KM = 10;\nexport function oroPing(lat: number) { void fetch(`https://x.invalid/?${lat}`).catch(() => null); }']],
      ['src/components/VolumetricProbe/liveScene.ts:oroPing:fetch']],
    ringGatedOk: [[[W, CANARY, LOADER + CANARY], [W, RING, '  nowMs?: number,\n  oro?: { macroOro?: number; regime?: number },\n): Promise<CloudPathData[]> => {\n  if (oro?.macroOro || oro?.regime) void loadOroObs(lat, lon).catch(() => null);\n']], []],
    liveLoaderOk: [[[W, CANARY, LOADER + CANARY], [LV, 'import { getInterpolatedWeather, PROFILE_LEVELS,', 'import { getInterpolatedWeather, loadOroObs, PROFILE_LEVELS,'],
      [LV, HEAD, HEAD + '  if ((a as any).macroOro || (a as any).regime) void loadOroObs(a.lat, a.lon).catch(() => null);\n']], []],
  };
  const root = path.join(TMP, 'callsites');
  let asExpected = 0;
  const bad = [];
  for (const [name, [patches, added]] of Object.entries(MUT)) {
    const r = fresh(path.join(root, name));
    const copy = (src, dst) => { for (const e of fs.readdirSync(src, { withFileTypes: true })) { const a = path.join(src, e.name), b = path.join(dst, e.name);
      if (e.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copy(a, b); } else if (/\.(ts|tsx)$/.test(e.name)) fs.copyFileSync(a, b); } };
    fs.mkdirSync(path.join(r, 'src'), { recursive: true }); copy(path.join(ROOT, 'src'), path.join(r, 'src'));
    let anchored = true;
    for (const [rel, a, b] of patches) {
      const f = path.join(r, rel), t = fs.readFileSync(f, 'utf8');
      if (t.split(a).length !== 2) { anchored = false; break; }
      fs.writeFileSync(f, t.replace(a, b));
    }
    const got = anchored ? live.scanCallSites(r) : null;
    const want2 = [...base.sites, ...added].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    if (got && Object.keys(got.info.parseDiagnostics).length === 0 && JSON.stringify(got.sites) === JSON.stringify(want2)) asExpected++; else bad.push(name);
    fs.rmSync(r, { recursive: true, force: true });
  }
  ck.ok(asExpected === Object.keys(MUT).length, `mutants:${bad.join('+')}`);
  // runPath 가 세 요청 뿌리에 OPTIONS 를 마지막 인자로 넘기는지(가짜 모듈)
  const calls = {};
  const rec = name => (...args) => { (calls[name] ??= []).push(args); return name === 'fetchDayWeatherRing' ? Promise.resolve([]) : Promise.resolve(null); };
  const L = { fetchWeatherCanary: rec('fetchWeatherCanary'), fetchDayWeatherRing: rec('fetchDayWeatherRing'), fetchNearestMetar: rec('fetchNearestMetar'),
    getInterpolatedWeather: () => [], volSceneKey: () => 'k', buildLiveScene: a => { (calls.buildLiveScene ??= []).push([a]); return { input: { layers: [], macro: {} } }; } };
  await live.runPath(L, () => 'q');
  const isOpt = x => JSON.stringify(x) === JSON.stringify(live.OPTIONS);
  const c = calls;
  ck.ok(c.fetchWeatherCanary?.[0]?.length === 5 && isOpt(c.fetchWeatherCanary[0][4])
    && c.fetchDayWeatherRing?.[0]?.length === 7 && c.fetchDayWeatherRing[0][5] === undefined && isOpt(c.fetchDayWeatherRing[0][6])
    && c.fetchNearestMetar?.[0]?.length === 4 && isOpt(c.fetchNearestMetar[0][3])
    && c.buildLiveScene?.[0]?.[0]?.macroOro === 0 && c.buildLiveScene[0][0].regime === 0, 'optionsPassed');
  ck.kv = { sites: base.sites.length, files: base.info.files, mutants: `${asExpected}/${Object.keys(MUT).length}`, parser: base.info.parser };
});

await test('RENDER', async ck => {
  const bf = path.join(PARTS, 'b.json');
  if (!fs.existsSync(bf)) { ck.skip = 'no b.json part'; return; }
  const B = rdJson(bf);
  if (!B.run1 || !B.run2 || !B.keys || !B.control) { ck.skip = 'render steps incomplete'; return; }
  const aa = rdJson(path.join(ROOT, 'tools/genus-ruler/oro/merge-aa.json'));
  ck.ok(B.aa === true, 'aa'); ck.ok(B.keysMatchRun1 === true, 'keysRunSame'); ck.ok(B.macroOnAllJobs === true, 'macroOn');
  ck.ok(Object.values(B.run1GlError ?? {}).every(v => v === 0) && Object.keys(B.run1GlError ?? {}).length === 4, 'glError0'); ck.ok(B.controlMatchesMergeAA === true, 'controlMergeAA');
  ck.ok(B.controlBundleMd5MatchesMergeAA === true, 'bundleMd5MergeAA');
  const L = B.load ?? {};
  ck.ok(B.renderUnloaded === true && ['run1', 'run2', 'control', 'keys'].every(st => L[st] && L[st].before[0] < 1.0 && L[st].heavy.length === 0 && L[st].during.foreignCores < 0.5), 'unloaded');
  ck.ok(B.versions.chromium === aa.chromium && JSON.stringify(B.versions.chromiumFlags) === JSON.stringify(aa.chromiumFlags) && B.versions.esbuild === aa.esbuild, 'versionsMergeAA');
  const jobs = rdJson(path.join(G, 'jobs-g1.json'));
  ck.ok(B.jobsFileSha256 === sha256(fs.readFileSync(path.join(G, 'jobs-g1.json'))), 'jobsFile');
  let oneKey = 0;
  const keys = new Set();
  for (const j of jobs) {
    const k = B.keys[j.name];
    let parsed = null; try { parsed = JSON.parse(k.weatherKey); } catch { /* */ }
    if (k && k.nKeySets >= 1 && Array.isArray(parsed) && parsed[parsed.length - 1] === 256) oneKey++;
    keys.add(k && k.weatherKey);
  }
  ck.ok(oneKey === jobs.length, 'oneKeyPerJob');
  ck.ok(keys.size === jobs.length, 'keysDistinct');
  const rgb = new Set(jobs.map(j => B.run1[j.name].rgb));
  ck.ok(rgb.size === jobs.length, 'rendersDistinct');
  // 호출 기록(fix G1-REC): 다섯 단계 모두 한 g1-render 호출, 그 호출이 기록 파일에 exit 0·같은 md5 로 있음
  const SR = B.stepRuns ?? {};
  ck.ok(!!B.invocation && INVOCATION_RE.test(B.invocation.id ?? '') && STEPS5.every(st => SR[st] && INVOCATION_RE.test(SR[st].invocation ?? '') && SR[st].start <= SR[st].end), 'invocationRecord');
  ck.ok(B.singleInvocation === true && STEPS5.every(st => SR[st]?.invocation === B.invocation?.id), 'singleInvocation');
  ck.ok(invocationLogged(B, readAttempts().recs, RENDER4), 'attemptLogged');
  // 어긋남 재기: 마당 갖춤, 판정 깃발과 맞음(깃발 참 ⇔ 그 종류의 어긋남 없음)
  const mm = Array.isArray(B.mismatches) ? B.mismatches : null, nk = k => (mm ?? []).filter(m => m.kind === k).length;
  ck.ok(!!mm && mm.every(validMismatch) && (B.aa === true) === (nk('aa') === 0) && (B.keysMatchRun1 === true) === (nk('keys') === 0)
    && (B.controlMatchesMergeAA === true) === (nk('control') === 0), 'mismatchesConsistent');
  // 일꾼 1 개 고정(fix G1-DET): run1·run2·keys 만, 사본 chrome 은 원본과 같은 inode
  const ss = B.versions.swiftshader;
  ck.ok(!!ss && ss.threads === 1 && ss.sameInode === true && JSON.stringify(ss.steps) === JSON.stringify(PINNED) && PINNED.every(st => L[st]?.during?.swiftshaderWorkers === 1), 'pinnedSingleWorker');
  ck.kv = { jobs: jobs.length, oneKey, aaDiff: (B.aaDiff ?? []).join('+') || 'none', mismatches: mm ? mm.length : '-', invocation: B.invocation?.id ?? '-', chromium: JSON.stringify(B.versions.chromium),
    load1: Math.max(...['run1', 'run2', 'control', 'keys'].map(st => L[st]?.before?.[0] ?? 99)), foreign: Math.max(...['run1', 'run2', 'control', 'keys'].map(st => L[st]?.during?.foreignCores ?? 99)) };
});

// 실제 조각으로 test-tmp 에서 g1-baseline 을 돌리는 고정물(LOADGUARD·INVOCATION·MISMATCH): a·d 는 그대로, b 는 mut 로 고친 사본.
// 부하·호출과 무관한 b 의 판정(A/A·키 실행·대조·거시 격자)이 실제 조각에서 거짓이면 사본에서만 참으로 두고 forced 로 밝힘
// (그 판정은 실제 조각에서 RENDER 가 봄).
const OTHER_FLAGS = ['aa', 'keysMatchRun1', 'controlMatchesMergeAA', 'controlBundleMd5MatchesMergeAA', 'macroOnAllJobs'];
const partsReady = () => ['a.json', 'b.json', 'd.json'].every(f => fs.existsSync(path.join(PARTS, f)));
function assembleCopy(d, tag, B0, mut, extra = []) {
  const forced = OTHER_FLAGS.filter(k => B0[k] !== true);
  const pd = fresh(path.join(d, `parts-${tag}`));
  for (const f of ['a.json', 'd.json']) fs.copyFileSync(path.join(PARTS, f), path.join(pd, f));
  const B = JSON.parse(JSON.stringify(B0)); for (const k of forced) B[k] = true; mut(B); fs.writeFileSync(path.join(pd, 'b.json'), canonicalJson(B));
  const o2 = path.join(d, `g1-baseline-${tag}.json`); fs.rmSync(o2, { force: true });
  const r = node([path.join(G, 'g1-baseline.mjs'), '--parts', pd, '--jobs', path.join(G, 'jobs-g1.json'), '--inputs', INPUTS, '--out', o2, ...extra]);
  return { r, wrote: fs.existsSync(o2), o2, forced };
}

await test('LOADGUARD', async ck => {
  const d = fresh(path.join(TMP, 'loadguard'));
  // 1. 남의 CPU 프로세스: g1-render 의 자손이 아닌 바쁜 고리(이 시험의 자식) — ps pcpu ≈ 100
  const hog = cp.spawn('node', ['-e', 'const t = Date.now(); while (Date.now() - t < 60000) {}'], { stdio: 'ignore' });
  try {
    cp.spawnSync('sleep', ['1.5']);
    const out = path.join(d, 'b.json'), work = path.join(d, 'work'), ctl = path.join(d, 'control.json');
    fs.writeFileSync(ctl, '[]\n');
    const r = node([path.join(G, 'g1-render.mjs'), '--jobs', path.join(G, 'jobs-g1.json'), '--control', ctl, '--out', out,
      '--work', work, '--steps', 'run1', '--wait-idle', '0']);
    ck.ok(r.status === 3 && /run1: container not idle/.test(r.stderr) && /node\(\d+\)/.test(r.stderr), 'renderRefusedUnderLoad');
    ck.ok(!fs.existsSync(path.join(work, 'run1')) && !fs.existsSync(out), 'nothingRendered');
    // 거절된 호출도 render-attempts.jsonl 에 남음(fix G1-REC): 이 out 의 마지막 start 와 그 end(exit 3, 끝낸 단계 없음)
    const { recs } = readAttempts();
    const outRel = path.relative(ROOT, out).split(path.sep).join('/');   // g1-render 는 저장소 안의 경로를 뿌리 기준으로 적음
    const st = recs.filter(x => x.event === 'start' && x.out === outRel).pop();
    const en = st && recs.find(x => x.event === 'end' && x.invocation === st.invocation);
    ck.ok(!!st && !!en && en.exitCode === 3 && en.completed.length === 0 && /container not idle/.test(en.error ?? ''), 'refusalLogged');
    ck.kv.renderExit = r.status;
  } finally { hog.kill('SIGKILL'); }
  // 2. g1-baseline: 부하 기록이 어긋난 b 사본이면 쓰지 않음; --final 은 final 이 아니면 쓰지 않음
  if (!partsReady()) { ck.skip = 'no parts'; return; }
  const B0 = rdJson(path.join(PARTS, 'b.json'));
  if (!B0.load) { ck.skip = 'b.json without load record'; return; }
  // 이 시험은 부하 지킴과 --final 만 봄(assembleCopy 의 forced)
  const forced = OTHER_FLAGS.filter(k => B0[k] !== true);
  const assemble = (tag, mut, extra = []) => assembleCopy(d, tag, B0, mut, extra);
  const same = assemble('same', () => {});
  ck.ok(same.r.status === 0 && same.wrote, 'unchangedWrites');
  const loaded = assemble('loaded', B => { B.load.run2.before[0] = 1.5; });
  ck.ok(loaded.r.status === 1 && !loaded.wrote && /render step started under load/.test(loaded.r.stderr), 'loadedBeforeRefused');
  const busy = assemble('busy', B => { B.load.keys.during.foreignCores = 0.9; });
  ck.ok(busy.r.status === 1 && !busy.wrote && /used ≥ 0.5 core/.test(busy.r.stderr), 'foreignDuringRefused');
  const missing = assemble('missing', B => { delete B.load.control; });
  ck.ok(missing.r.status === 1 && !missing.wrote && /render load record missing for control/.test(missing.r.stderr), 'missingStepRefused');
  const X = same.wrote ? rdJson(same.o2) : null;
  const fin = assemble('final', () => {}, ['--final']);
  if (X && X.status.final === false) ck.ok(fin.r.status === 1 && !fin.wrote && X.status.notFinal.every(k => fin.r.stderr.includes(`NOT-FINAL ${k}`)), 'finalRefused');
  else ck.ok(X && fin.r.status === 0 && fin.wrote && fs.readFileSync(fin.o2).equals(fs.readFileSync(same.o2)), 'finalWrites');
  ck.kv = { ...ck.kv, forced: forced.join('+') || 'none', final: X ? X.status.final : '-', notFinal: X ? X.status.notFinal.join('+') || 'none' : '-' };
});

await test('INVOCATION', async ck => {
  const d = fresh(path.join(TMP, 'invocation'));
  // 0. 합성 기록으로 attemptsAtCommit(조각 없이도 돎): 커밋 X 의 앞 시도(control 어긋남), 커밋 Y 에서 b 를 만든 호출, SIGKILL 로 끝 줄이
  //    없는 시도(Y), 다른 커밋 Z 의 시도, b 를 만든 호출이 끝난 뒤의 시도(X) — 앞 셋만 들고(기록 차례), 쓴 호출은 b 의 것 하나
  const synth = path.join(d, 'attempts-synth.jsonl');
  const sid = (pid, t) => newInvocationId(pid, new Date(Date.parse('2026-11-05T00:00:00.000Z') + t * 1000));
  const [iP, iB, iK, iZ, iR] = [sid(11, 0), sid(22, 10), sid(33, 20), sid(44, 30), sid(55, 90)];
  const mmCtl = { kind: 'control', job: 'P0_seoul', channel: 'rgb', a: { source: 'mergeAA', md5: 'a'.repeat(32) }, b: { source: 'control', md5: 'b'.repeat(32) },
    decoded: true, reason: null, width: 390, height: 584, pixels: 5, bbox: { row: [549, 552], col: [257, 261] }, maxLevel: 1, channels: ['r', 'g', 'b'], channelPixels: { r: 2, g: 1, b: 2 } };
  const st = (id, commit, out, steps) => ({ event: 'start', invocation: id, commit, out, steps });
  const en = (id, exitCode, completed, mismatches = []) => ({ event: 'end', invocation: id, exitCode, signal: null, completed: completed.map(step => ({ step })), md5: {}, mismatches });
  for (const r of [st(iP, 'X', 'p/b.json', STEPS5), en(iP, 0, STEPS5, [mmCtl]), st(iB, 'Y', 'p/b.json', STEPS5), st(iK, 'Y', 'q/b.json', ['run1']),
    st(iZ, 'Z', 'p/b.json', STEPS5), en(iZ, 0, STEPS5), en(iB, 0, STEPS5), st(iR, 'X', 'p/b.json', ['run1']), en(iR, 3, [])]) appendAttempt(r, synth);
  const sr = readAttempts(synth).recs;
  const SA = attemptsAtCommit(sr, ['X', ...invocationCommits(sr, [iB])], [iB], 'p/b.json');
  ck.ok(JSON.stringify(invocationCommits(sr, [iB])) === '["Y"]' && JSON.stringify(SA.commits) === '["X","Y"]'
    && JSON.stringify(SA.attempts.map(a => [a.id, a.commit, a.exit, a.usedForThisBaseline])) === JSON.stringify([[iP, 'X', 0, false], [iB, 'Y', 0, true], [iK, 'Y', null, false]])
    && SA.n === 3 && SA.samePart === 2 && SA.rendered === 2 && SA.withMismatch === 1 && SA.upToInvocationLogged === true
    && JSON.stringify(SA.attempts[0].mismatches) === JSON.stringify(['control P0_seoul.rgb mergeAA/control 5 px rows 549-552 cols 257-261 max 1 ch rgb']), 'attemptsSynthetic');
  // 같은 기록에서 b 의 커밋만 주면(조각이 X 에서 잼) b 를 만든 호출이 빠짐 — g1-baseline 이 b 호출의 커밋을 더하는 까닭
  ck.ok(!attemptsAtCommit(sr, 'X', [iB], 'p/b.json').attempts.some(a => a.usedForThisBaseline), 'attemptsNeedRenderCommit');
  if (!partsReady()) { ck.skip = 'no parts'; return; }
  const B0 = rdJson(path.join(PARTS, 'b.json'));
  if (!B0.invocation || !B0.stepRuns) { ck.skip = 'b.json without invocation record (g1-render before fix G1-REC)'; return; }
  const id0 = B0.invocation.id;
  // id 꼴: <pid>-<시작 ISO>-<무작위 8 자>, pid·startedAt 과 맞음
  const m = INVOCATION_RE.exec(id0 ?? '');
  ck.ok(!!m && Number(m[1]) === B0.invocation.pid && m[2] === B0.invocation.startedAt, 'idForm');
  const single = B0.singleInvocation === true;
  // 1. 고치지 않은 사본: 실제 b 와 같은 판정
  const same = assembleCopy(d, 'same', B0, () => {});
  const X = same.wrote ? rdJson(same.o2) : null;
  ck.ok(same.r.status === 0 && !!X && X.status.renderSingleInvocation === single && X.status.notFinal.includes('renderSingleInvocation') === !single
    && JSON.stringify(X.status.renderInvocations) === JSON.stringify(B0.invocations), 'sameCopy');
  // 2. control 만 다른 호출 id(--steps control 로 다시 그린 b 꼴): 표시되고 --final 이 거절
  const other = `${process.pid}-${new Date().toISOString()}-0badc0de`;
  const mixCtl = B => { B.stepRuns.control.invocation = other; };
  const mixed = assembleCopy(d, 'mixed', B0, mixCtl);
  const XM = mixed.wrote ? rdJson(mixed.o2) : null;
  ck.ok(mixed.r.status === 0 && !!XM && XM.status.renderSingleInvocation === false && XM.status.final === false && XM.status.notFinal.includes('renderSingleInvocation')
    && XM.status.renderInvocations.includes(other) && XM.status.renderInvocations.includes(id0), 'mixedMarked');
  const mixedFinal = assembleCopy(d, 'mixed-final', B0, mixCtl, ['--final']);
  ck.ok(mixedFinal.r.status === 1 && !mixedFinal.wrote && /NOT-FINAL renderSingleInvocation/.test(mixedFinal.r.stderr), 'mixedControlRefusedFinal');
  const sameFinal = assembleCopy(d, 'same-final', B0, () => {}, ['--final']);
  ck.ok(/NOT-FINAL renderSingleInvocation/.test(sameFinal.r.stderr) === !single, 'sameFinalInvocationLine');
  // 3. 호출 기록이 없는 b(fix G1-REC 앞의 g1-render): 아예 쓰지 않음
  const none = assembleCopy(d, 'none', B0, B => { delete B.invocation; delete B.stepRuns; });
  ck.ok(none.r.status === 1 && !none.wrote && /no invocation record/.test(none.r.stderr), 'noRecordRefused');
  const noCtl = assembleCopy(d, 'no-control', B0, B => { delete B.stepRuns.control; });
  ck.ok(noCtl.r.status === 1 && !noCtl.wrote && /no invocation record for control/.test(noCtl.r.stderr), 'noControlRecordRefused');
  // 4. md5 하나를 고친 사본은 기록과 맞지 않음
  const edited = assembleCopy(d, 'edited', B0, B => { const n = Object.keys(B.control)[0]; B.control[n].rgb = 'f'.repeat(32); });
  const XE = edited.wrote ? rdJson(edited.o2) : null;
  ck.ok(!!XE && XE.status.renderInvocationLogged === false && XE.status.notFinal.includes('renderInvocationLogged'), 'editedMd5NotLogged');
  // 5. status.renderAttempts: 이 b 를 만든 호출이 exit 0 으로 들어 있음
  const RA = X?.status?.renderAttempts;
  ck.ok(!!RA && RA.upToInvocationLogged === true && RA.n === RA.attempts.length && RA.attempts.some(a => a.id === id0 && a.usedForThisBaseline && a.exit === 0 && a.completed === STEPS5.join(',') && a.commit === B0.invocation.commit)
    && RA.commits.includes(X.commit) && RA.commits.includes(B0.invocation.commit), 'attemptsListed');
  ck.kv = { invocation: id0, single, attempts: RA ? RA.n : '-', samePart: RA ? RA.samePart : '-', rendered: RA ? RA.rendered : '-' };
});

await test('MISMATCH', async ck => {
  const d = fresh(path.join(TMP, 'mismatch'));
  // 1. 합성 PNG(23 × 17 RGBA, 줄마다 거르개 0~4): 풀면 표본이 같고, 세 화소를 바꾼 짝의 차이가 손으로 센 값과 같음
  const W = 23, H = 17, base = new Uint8Array(W * H * 4);
  let k = 7; for (let i = 0; i < base.length; i++) { k = (Math.imul(k, 1103515245) + 12345) >>> 0; base[i] = k >>> 24; }
  const alt = Uint8Array.from(base);
  const bump = (y, x, c, dv) => { const i = (y * W + x) * 4 + c; alt[i] = base[i] < 128 ? base[i] + dv : base[i] - dv; };
  bump(5, 7, 2, 1); bump(6, 9, 1, 1); bump(12, 3, 3, 2);
  const pa = encodePng(W, H, 6, base), pb = encodePng(W, H, 6, alt);
  const A = decodePng(pa), Bm = decodePng(pb);
  ck.ok(Buffer.from(A.samples).equals(Buffer.from(base)) && Buffer.from(Bm.samples).equals(Buffer.from(alt)), 'decodeFilters0to4');
  const df = pngDiff(A, Bm);
  ck.ok(df.comparable && df.pixels === 3 && JSON.stringify(df.bbox) === JSON.stringify({ row: [5, 12], col: [3, 9] }) && df.maxLevel === 2
    && df.channels.join('') === 'gba' && JSON.stringify(df.channelPixels) === JSON.stringify({ g: 1, b: 1, a: 1 }), 'diffFields');
  ck.ok(pngDiff(A, decodePng(encodePng(W, H, 6, base))).pixels === 0 && pngDiff(A, decodePng(encodePng(W, H - 1, 6, base.subarray(0, W * (H - 1) * 4)))).comparable === false, 'sameZeroSizeRefused');
  // 2. characterise: 합성 작업 폴더(run1·run2·keys·control)와 merge-aa 사본 폴더
  const work = fresh(path.join(d, 'work')), refDir = fresh(path.join(d, 'ref'));
  const put = (step, n, ch, buf) => { fs.mkdirSync(path.join(work, step), { recursive: true }); fs.writeFileSync(path.join(work, step, ch === 'rgb' ? `${n}.png` : `${n}.alpha.png`), buf); };
  for (const [st, rgbBuf] of [['run1', pa], ['run2', pb], ['keys', pa]]) { put(st, 'J', 'rgb', rgbBuf); put(st, 'J', 'alpha', pa); }
  put('control', 'C', 'rgb', pb); put('control', 'C', 'alpha', pa);
  fs.writeFileSync(path.join(refDir, `${md5(pa)}.png`), pa);
  const mk = (r, a) => ({ rgb: md5(r), alpha: md5(a) });
  const res = { run1: { J: mk(pa, pa) }, run2: { J: mk(pb, pa) }, keys: { J: mk(pa, pa) }, control: { C: mk(pb, pa) } };
  const ref = { C: { rgb: md5(pa), alpha: md5(pa) } };
  const out = characterise(res, work, ['J'], ['C'], ref, refDir);
  const want = ['aa J.rgb run1/run2 3 px rows 5-12 cols 3-9 max 2 ch gba', 'control C.rgb mergeAA/control 3 px rows 5-12 cols 3-9 max 2 ch gba'];
  ck.ok(out.length === 2 && out.every(validMismatch) && JSON.stringify(out.map(mismatchSummary)) === JSON.stringify(want), 'characteriseSynthetic');
  // 기록된 md5 가 디스크의 PNG 가 아니면(앞 호출의 단계를 덮어 그림 등) 풀지 않고 까닭을 적음; 맞은편 사본이 없으면 마찬가지
  const stale = characterise({ ...res, run2: { J: { rgb: 'e'.repeat(32), alpha: md5(pa) } } }, work, ['J'], ['C'], { C: { rgb: 'd'.repeat(32), alpha: md5(pa) } }, refDir);
  ck.ok(stale.length === 2 && stale.every(validMismatch) && stale.every(x => x.decoded === false) && /not the recorded md5/.test(stale[0].reason) && /mergeAA PNG not on disk/.test(stale[1].reason), 'undecodedWithReason');
  ck.kv = { synthetic: out.length };
  // 3. 실제 b 조각: mismatches[] 의 모든 칸이 마당을 갖춤(RENDER 가 깃발과 맞는지 봄)
  if (!partsReady()) { ck.skip = 'no parts'; return; }
  const B0 = rdJson(path.join(PARTS, 'b.json'));
  if (!Array.isArray(B0.mismatches)) { ck.fails.push('realPartHasMismatches'); return; }
  ck.ok(B0.mismatches.every(validMismatch), 'realPartFields');
  // 4. g1-baseline status.mismatches = b 의 mismatches 한 줄 요약(정렬)
  const asm = assembleCopy(d, 'summary', B0, B => { B.mismatches = [...B.mismatches, ...out]; });
  const X = asm.wrote ? rdJson(asm.o2) : null;
  const wantS = [...B0.mismatches, ...out].map(mismatchSummary).sort();
  ck.ok(!!X && JSON.stringify(X.status.mismatches) === JSON.stringify(wantS), 'baselineSummary');
  const bad = assembleCopy(d, 'malformed', B0, B => { B.mismatches = [{ kind: 'aa', job: 'P0_seoul' }]; });
  ck.ok(bad.r.status === 1 && !bad.wrote && /no mismatch characterisation/.test(bad.r.stderr), 'malformedRefused');
  ck.kv = { ...ck.kv, real: B0.mismatches.length, realSummary: B0.mismatches.map(mismatchSummary).join(' | ') || 'none' };
});

await test('BASELINE', async ck => {
  const bf = BASELINE_FILE;
  if (!fs.existsSync(bf)) { ck.skip = `no ${path.relative(ROOT, bf)}`; return; }
  const X = rdJson(bf);
  const has = (o, p) => p.split('.').reduce((a, k) => (a && Object.prototype.hasOwnProperty.call(a, k) ? a[k] : undefined), o) !== undefined;
  const keys = ['schema', 'commit', 'mergedCommit', 'bundles.macro.sha256', 'bundles.macro.esbuild', 'bundles.harness.sha256', 'bundles.harness.build',
    'versions.node', 'versions.esbuild', 'versions.chromium', 'versions.chromiumPath', 'versions.chromiumFlags', 'inputs.oroInputsSha256',
    'a', 'aMode2', 'b.aa', 'b.jobs', 'c', 'd.requests', 'd.rebuilds', 'd.timers', 'd.callSites', 'status.final', 'status.notFinal',
    'status.g1ToolsCommitted', 'status.renderUnloaded', 'versions.swiftshader', 'status.renderInvocations', 'status.renderAttempts', 'status.mismatches',
    'status.renderSingleInvocation', 'status.renderInvocationLogged', 'status.renderPinnedSingleWorker'];
  const missing = keys.filter(k => !has(X, k));
  ck.ok(!missing.length && X.schema === 'g1-baseline/1' && X.mergedCommit === '115fbe2' && X.bundles.macro.esbuild === '0.28.2', 'schemaKeys');
  const sc = Object.keys(X.a);
  const nSc = nScenes(), nulls = nullBandsExpected();
  ck.ok(sc.length === nSc && X.inputs.scenes === nSc && sc.every(s => BANDS3.every(b => aShapeOk(X, s, b, nulls))), 'aScenesx3');
  const jn = Object.keys(X.b.jobs);
  ck.ok(jn.length === 4 && jn.every(n => /^[0-9a-f]{32}$/.test(X.b.jobs[n].rgb) && /^[0-9a-f]{32}$/.test(X.b.jobs[n].alpha) && X.b.jobs[n].options.macro === 1 && X.b.jobs[n].options.macroN === 128), 'bJobs');
  ck.ok(jn.every(n => X.c[n] && typeof X.c[n].weatherKey === 'string' && typeof X.c[n].qKey === 'string'), 'cJobs');
  const head = resolveCommit('g1-test', 'HEAD');
  const appSame = X.commit === head || cp.spawnSync('git', ['diff', '--quiet', X.commit, head, '--', 'src', 'tools/genus-ruler/volsky'], { cwd: ROOT }).status === 0;
  ck.ok(X.b.aa === true && X.b.macroOnAllJobs === true && X.d.d6d14Requests === 0 && appSame && X.status.appUnchangedSinceMerge === true, 'values');
  // G1 build note 19·20 의 status 마당: 호출·시도·어긋남 요약
  const RA = X.status.renderAttempts;
  ck.ok(Array.isArray(X.status.renderInvocations) && X.status.renderInvocations.length >= 1 && Array.isArray(X.status.mismatches) && !!RA && RA.n === RA.attempts.length
    && X.status.renderInvocations.every(id => RA.attempts.some(a => a.id === id && a.usedForThisBaseline)), 'statusRecords');
  // 조각에서 다시 모으면 바이트 같음
  const d = fresh(path.join(TMP, 'baseline'));
  const o2 = path.join(d, 'g1-baseline.json');
  const r = node([path.join(G, 'g1-baseline.mjs'), '--parts', PARTS, '--jobs', path.join(G, 'jobs-g1.json'), '--inputs', INPUTS, '--out', o2]);
  ck.ok(r.status === 0 && fs.existsSync(o2) && fs.readFileSync(o2).equals(fs.readFileSync(bf)), 'reassembleSame');
  ck.kv = { file: path.relative(ROOT, bf), missing: missing.length, scenes: sc.length, nullBands: nulls.size, jobs: jn.length, final: X.status.final, notFinal: (X.status.notFinal ?? []).join('+') || 'none',
    attempts: RA ? RA.n : '-', sha256: sha256(fs.readFileSync(bf)).slice(0, 12) };
});

await test('CONTAM', async ck => {
  const oroDir = path.join(ROOT, 'tools/genus-ruler/oro');
  const bad = fs.readdirSync(oroDir).filter(f => /^gate-oro-.*\.json$/.test(f) || /^judge\.lock(\.1)?$/.test(f));
  ck.ok(!bad.length, 'noGateNoLock');
  const files = [...new Set([path.join(G, 'jobs-g1.json'), ...['a.json', 'b.json', 'd.json'].map(f => path.join(PARTS, f)), path.join(oroDir, 'g1-baseline.json'), BASELINE_FILE, ATTEMPTS_FILE])].filter(f => fs.existsSync(f));
  const hit = files.filter(f => /"(trueGrid|empty)"\s*:/.test(fs.readFileSync(f, 'utf8')));
  ck.ok(!hit.length, 'noModisKeys');
  ck.kv = { files: files.length, gate: bad.length, hits: hit.length };
});

const fails = results.filter(s => s === 'FAIL').length;
console.log(`SUMMARY pass ${results.filter(s => s === 'PASS').length} fail ${fails} skip ${results.filter(s => s === 'SKIP').length}`);
process.exit(fails ? 1 : 0);
