#!/usr/bin/env node
/**
 * g1-test.mjs — G1 기준 도구의 시험(S3-design.md §8, 자 L748·L862). 자의 기준을 바꾸지 않고, 도구가 그 기준을 제대로 재는지만 봅니다.
 *
 *   node tools/genus-ruler/oro/g1/g1-test.mjs [--only ID[,ID…]]
 *
 * 한 시험이 한 줄: `ID PASS|FAIL|SKIP key=value…`. exit 0 iff FAIL 없음(SKIP 은 통과가 아님).
 *   MD5-ALLOW  g1-md5 가 허용 목록만 씀: 가짜 trueGrid·cover·empty 와 허용 밖 키를 바꾼 inputs 사본으로 출력 같음, 허용 키 하나를
 *              바꾸면 그 밴드만 달라짐(음성 대조), 두 번 따로 돌려 바이트 같음, fs 감사(읽은 파일·쓴 파일·명령), 금지 경로 거절.
 *   MD5-CROSS  실제 a 조각: 121 × 3, 모드 1 base md5 = oro-base 가 쓴 .harness/oro/base/<scene>__closest__<band>.f32 의 md5
 *              (같은 허용 목록 길·같은 B 번들), cover = base(noise false), macro 번들 = oro-base B 번들(Q-45), state 배열 = re·im.
 *   MD5-CHAIN  모드 2: 걸음마다 md5 가 다름(사슬이 실제로 걸음), 첫 장 ≠ 1 걸음; 사슬 번들로 다시 잰 모드 1 = B 번들 모드 1.
 *   JOBS       잡 파일을 다시 만들면 바이트 같음; 잡 넷·이름·G1 옵션; 고리 입력 = oro-inputs closest 고리(비트 같음); B0_app·P0_seoul
 *              의 나머지는 원래 잡 그대로; 산악 둘 = kanazawa 처음 두 날짜, dev, A1 ✓(oro-apply); 대조 잡 = 원래 잡; 감사.
 *   QKEY       qKey 식 꺼내기: 손으로 계산한 문자열과 같음, 식이 둘이면 거절.
 *   LIVE       g1-live 두 번(따로) 출력 바이트 같음, 검사 통과; 가로채기 음성 대조(남은 타이머·진짜 망 시도·D6 꼴 요청을 잡음).
 *   RENDER     b 조각: A/A, 키 실행 = run1, 대조 = merge-aa.json, chromium 판·깃발 = merge-aa.json, 잡마다 키 하나.
 *   BASELINE   g1-baseline.json: §8 꼴의 키, 장면 121 × 3, 15 걸음, 조각에서 다시 모으면 바이트 같음.
 *   CONTAM     저장소에 gate-oro-*.json·judge.lock(.1) 없음, 조각·잡 파일에 MODIS 키(trueGrid·empty) 없음.
 */
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { createRequire } from 'node:module';
import {
  BANDS3, G1_HARNESS, ROOT, canonicalJson, extractQKey, md5, pickRingInputs, resolveCommit, ringPoints, sha256,
} from './g1-lib.mjs';

const G = path.join(ROOT, 'tools/genus-ruler/oro/g1');
const INPUTS = path.join(ROOT, 'tools/genus-ruler/oro/oro-inputs.json');
const PARTS = path.join(G1_HARNESS, 'parts');
const TMP = path.join(G1_HARNESS, 'test-tmp');
const only = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? new Set(process.argv[i + 1].split(',')) : null; })();
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
  ck.ok(names.length === 121 && names.every(s => BANDS3.every(b => A.a[s][b] && A.aMode2[s][b] && A.aMode2[s][b].length === 15)), 'shape121x3x15');
  ck.ok(A.commit === resolveCommit('g1-test', 'HEAD'), 'commitHEAD');
  ck.ok(A.inputs.oroInputsSha256 === sha256(fs.readFileSync(INPUTS)), 'inputsSha');
  ck.ok(JSON.stringify(A.defs.stateArrayTypes) === JSON.stringify({ im: 'Float64Array', re: 'Float64Array' }), 'stateArraysReIm');
  let coverEqBase = 0;
  for (const s of names) for (const b of BANDS3) if (A.a[s][b].cover === A.a[s][b].base) coverEqBase++;
  ck.ok(coverEqBase === names.length * 3, 'coverEqualsBaseNoNoise');
  const baseDir = path.join(ROOT, '.harness/oro/base');
  if (!fs.existsSync(path.join(baseDir, 'index.json'))) { ck.skip = 'no .harness/oro/base'; return; }
  const idx = rdJson(path.join(baseDir, 'index.json'));
  ck.ok(idx.bundleSha256 === A.bundles.macro.sha256, 'q45BundleSame');
  let same = 0, diff = 0, missing = 0;
  for (const s of names) for (const b of BANDS3) {
    const f = path.join(baseDir, `${s}__closest__${b}.f32`);
    if (!fs.existsSync(f)) { missing++; continue; }
    if (md5(fs.readFileSync(f)) === A.a[s][b].base) same++; else diff++;
  }
  ck.ok(same === names.length * 3 && diff === 0 && missing === 0, 'baseMd5EqualsOroBase');
  ck.kv = { scenes: names.length, same, diff, missing, coverEqBase };
});

await test('MD5-CHAIN', async ck => {
  const af = path.join(PARTS, 'a.json');
  if (!fs.existsSync(af)) { ck.skip = 'no a.json part'; return; }
  const A = rdJson(af);
  let allDistinct = 0, initDiff = 0, total = 0;
  for (const s of Object.keys(A.aMode2)) for (const b of BANDS3) {
    const ch = A.aMode2[s][b]; total++;
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
    const f = MC.buildMacroField(MC.samplesFromRing(pts.map(p => ({ ...p, cover: p.cover * 100 }))), { n: 128, cellKm: 6, noise: false }, null);
    const by = x => md5(Buffer.from(x.buffer, x.byteOffset, x.byteLength));
    n++; if (by(f.base) === A.a[s][b].base && by(f.lambdaRes) === A.a[s][b].lambdaRes && by(f.state.re) === A.a[s][b].state.re && by(f.state.im) === A.a[s][b].state.im) eq++;
  }
  ck.ok(eq === n, 'chainBundleMode1Same');
  ck.kv = { bands: total, distinct: allDistinct, initDiff, mode1Same: `${eq}/${n}` };
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

await test('RENDER', async ck => {
  const bf = path.join(PARTS, 'b.json');
  if (!fs.existsSync(bf)) { ck.skip = 'no b.json part'; return; }
  const B = rdJson(bf);
  if (!B.run1 || !B.run2 || !B.keys || !B.control) { ck.skip = 'render steps incomplete'; return; }
  const aa = rdJson(path.join(ROOT, 'tools/genus-ruler/oro/merge-aa.json'));
  ck.ok(B.aa === true, 'aa'); ck.ok(B.keysMatchRun1 === true, 'keysRunSame'); ck.ok(B.macroOnAllJobs === true, 'macroOn');
  ck.ok(Object.values(B.run1GlError ?? {}).every(v => v === 0) && Object.keys(B.run1GlError ?? {}).length === 4, 'glError0'); ck.ok(B.controlMatchesMergeAA === true, 'controlMergeAA');
  ck.ok(B.controlBundleMd5MatchesMergeAA === true, 'bundleMd5MergeAA');
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
  ck.kv = { jobs: jobs.length, oneKey, chromium: JSON.stringify(B.versions.chromium) };
});

await test('BASELINE', async ck => {
  const bf = path.join(ROOT, 'tools/genus-ruler/oro/g1-baseline.json');
  if (!fs.existsSync(bf)) { ck.skip = 'no g1-baseline.json'; return; }
  const X = rdJson(bf);
  const has = (o, p) => p.split('.').reduce((a, k) => (a && Object.prototype.hasOwnProperty.call(a, k) ? a[k] : undefined), o) !== undefined;
  const keys = ['schema', 'commit', 'mergedCommit', 'bundles.macro.sha256', 'bundles.macro.esbuild', 'bundles.harness.sha256', 'bundles.harness.build',
    'versions.node', 'versions.esbuild', 'versions.chromium', 'versions.chromiumPath', 'versions.chromiumFlags', 'inputs.oroInputsSha256',
    'a', 'aMode2', 'b.aa', 'b.jobs', 'c', 'd.requests', 'd.rebuilds', 'd.timers'];
  const missing = keys.filter(k => !has(X, k));
  ck.ok(!missing.length && X.schema === 'g1-baseline/1' && X.mergedCommit === '115fbe2' && X.bundles.macro.esbuild === '0.28.2', 'schemaKeys');
  const sc = Object.keys(X.a);
  ck.ok(sc.length === 121 && sc.every(s => BANDS3.every(b => X.a[s][b] && typeof X.a[s][b].cover === 'string' && X.a[s][b].state && X.aMode2[s][b].length === 15)), 'a121x3');
  const jn = Object.keys(X.b.jobs);
  ck.ok(jn.length === 4 && jn.every(n => /^[0-9a-f]{32}$/.test(X.b.jobs[n].rgb) && /^[0-9a-f]{32}$/.test(X.b.jobs[n].alpha) && X.b.jobs[n].options.macro === 1 && X.b.jobs[n].options.macroN === 128), 'bJobs');
  ck.ok(jn.every(n => X.c[n] && typeof X.c[n].weatherKey === 'string' && typeof X.c[n].qKey === 'string'), 'cJobs');
  ck.ok(X.b.aa === true && X.d.d6d14Requests === 0 && X.commit === resolveCommit('g1-test', 'HEAD'), 'values');
  // 조각에서 다시 모으면 바이트 같음
  const d = fresh(path.join(TMP, 'baseline'));
  const o2 = path.join(d, 'g1-baseline.json');
  const r = node([path.join(G, 'g1-baseline.mjs'), '--parts', PARTS, '--jobs', path.join(G, 'jobs-g1.json'), '--inputs', INPUTS, '--out', o2]);
  ck.ok(r.status === 0 && fs.existsSync(o2) && fs.readFileSync(o2).equals(fs.readFileSync(bf)), 'reassembleSame');
  ck.kv = { missing: missing.length, scenes: sc.length, jobs: jn.length, sha256: sha256(fs.readFileSync(bf)).slice(0, 12) };
});

await test('CONTAM', async ck => {
  const oroDir = path.join(ROOT, 'tools/genus-ruler/oro');
  const bad = fs.readdirSync(oroDir).filter(f => /^gate-oro-.*\.json$/.test(f) || /^judge\.lock(\.1)?$/.test(f));
  ck.ok(!bad.length, 'noGateNoLock');
  const files = [path.join(G, 'jobs-g1.json'), ...['a.json', 'b.json', 'd.json'].map(f => path.join(PARTS, f)), path.join(oroDir, 'g1-baseline.json')].filter(f => fs.existsSync(f));
  const hit = files.filter(f => /"(trueGrid|empty)"\s*:/.test(fs.readFileSync(f, 'utf8')));
  ck.ok(!hit.length, 'noModisKeys');
  ck.kv = { files: files.length, gate: bad.length, hits: hit.length };
});

const fails = results.filter(s => s === 'FAIL').length;
console.log(`SUMMARY pass ${results.filter(s => s === 'PASS').length} fail ${fails} skip ${results.filter(s => s === 'SKIP').length}`);
process.exit(fails ? 1 : 0);
