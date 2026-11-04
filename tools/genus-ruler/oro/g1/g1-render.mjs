#!/usr/bin/env node
/**
 * g1-render.mjs — G1(b) 하네스 렌더와 G1(c) 날씨 키(자 L748, S3-design.md §8 (b)(c)).
 *
 *   node tools/genus-ruler/oro/g1/g1-render.mjs --jobs tools/genus-ruler/oro/g1/jobs-g1.json --control <jobs-control.json>
 *        --out <b.json> [--work .harness/oro/g1/render] [--steps build,run1,run2,control,keys]
 *
 * 차례(같은 컨테이너에서 하나씩):
 *   build    bash tools/genus-ruler/volsky/build.sh(기본 출력 .harness/volsky/app.js) → 하네스 번들 sha256·md5
 *   run1/2   node tools/genus-ruler/volsky/run.js <jobs> <work>/runN 390 584 gen — 같은 코드 두 번(A/A), PNG md5
 *   control  같은 명령으로 원래 B0_app·P0_seoul(옵션·고리 없음)을 그려 oro/merge-aa.json 의 합친 뒤 md5 와 견줌(환경 확인)
 *   keys     node tools/genus-ruler/oro/g1/g1-keys.cjs — 앱이 만든 날씨 키, 그리고 그 실행의 PNG md5(run1 과 같아야 함)
 * 판(versions): node, esbuild(build.sh 의 고정 판), chromium(run.js 의 executablePath 와 --version), 깃발(run.js 소스).
 * 출력(--out): 키 정렬 JSON. 표준 출력은 단계·md5·수만.
 */
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { ROOT, canonicalJson, die as die0, forbiddenPath, md5, parseArgs, sha256 } from './g1-lib.mjs';

const TOOL = 'g1-render';
const die = (m, c) => die0(TOOL, m, c);
const W = '390', H = '584';
const STEPS_ALL = ['build', 'run1', 'run2', 'control', 'keys'];

function runLogged(cmd, args, log) {
  const fd = fs.openSync(log, 'w');
  const r = cp.spawnSync(cmd, args, { cwd: ROOT, stdio: ['ignore', fd, fd], maxBuffer: 1 << 26 });
  fs.closeSync(fd);
  return r.status;
}
function pngMd5(dir, names) {
  const o = {};
  for (const n of names) {
    const f = { rgb: path.join(dir, `${n}.png`), alpha: path.join(dir, `${n}.alpha.png`) };
    o[n] = {};
    for (const [k, p] of Object.entries(f)) o[n][k] = fs.existsSync(p) ? md5(fs.readFileSync(p)) : null;
  }
  return o;
}
function runJsLaunch() {
  const src = fs.readFileSync(path.join(ROOT, 'tools/genus-ruler/volsky/run.js'), 'utf8');
  const ex = src.match(/executablePath:\s*'([^']+)'/), ar = src.match(/args:\s*(\[[^\]]*\])/);
  if (!ex || !ar) die('run.js: launch options not found', 3);
  return { executablePath: ex[1], args: JSON.parse(ar[1].replace(/'/g, '"')) };
}
function buildShEsbuild() {
  const m = fs.readFileSync(path.join(ROOT, 'tools/genus-ruler/volsky/build.sh'), 'utf8').match(/esbuild@([0-9.]+)/);
  return m ? m[1] : null;
}

function main() {
  const o = parseArgs(TOOL, process.argv.slice(2), { '--jobs': true, '--control': true, '--out': true, '--work': true, '--steps': true });
  if (!o['--jobs'] || !o['--control'] || !o['--out']) die('--jobs, --control and --out are required');
  for (const k of ['--jobs', '--control', '--out', '--work']) if (o[k] && forbiddenPath(o[k])) die(`${k}: path refused`);
  const work = path.resolve(o['--work'] ?? path.join(ROOT, '.harness/oro/g1/render'));
  const steps = o['--steps'] ? o['--steps'].split(',') : STEPS_ALL;
  for (const s of steps) if (!STEPS_ALL.includes(s)) die(`unknown step ${s}`);
  fs.mkdirSync(work, { recursive: true });
  const outPath = path.resolve(o['--out']);
  const prev = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
  const res = { ...prev };
  const jobs = JSON.parse(fs.readFileSync(path.resolve(o['--jobs']), 'utf8'));
  const ctl = JSON.parse(fs.readFileSync(path.resolve(o['--control']), 'utf8'));
  const names = jobs.map(j => j.name), cnames = ctl.map(j => j.name);
  res.jobsFileSha256 = sha256(fs.readFileSync(path.resolve(o['--jobs'])));
  res.jobOptions = Object.fromEntries(jobs.map(j => [j.name, j.options ?? {}]));
  const L = runJsLaunch();
  const chromiumVersion = cp.execFileSync(L.executablePath, ['--version'], { encoding: 'utf8' }).trim();
  res.versions = {
    node: process.version, esbuild: buildShEsbuild(), chromium: chromiumVersion,
    chromiumPath: L.executablePath, chromiumRealPath: fs.realpathSync(L.executablePath), chromiumFlags: L.args,
  };
  const save = () => { fs.mkdirSync(path.dirname(outPath), { recursive: true }); fs.writeFileSync(outPath, canonicalJson(res)); };
  for (const step of steps) {
    const log = path.join(work, `${step}.log`);
    const t0 = Date.now();
    if (step === 'build') {
      const rc = runLogged('bash', ['tools/genus-ruler/volsky/build.sh'], log);
      if (rc !== 0) die(`build.sh exit ${rc}`, 3);
      const app = fs.readFileSync(path.join(ROOT, '.harness/volsky/app.js'));
      res.harnessBundle = { sha256: sha256(app), md5: md5(app), build: 'tools/genus-ruler/volsky/build.sh', out: '.harness/volsky/app.js' };
    } else if (step === 'run1' || step === 'run2' || step === 'control') {
      if (!res.harnessBundle) die('run the build step first', 3);
      const app = fs.readFileSync(path.join(ROOT, '.harness/volsky/app.js'));
      if (sha256(app) !== res.harnessBundle.sha256) die('.harness/volsky/app.js changed since the build step', 3);
      const dir = path.join(work, step);
      fs.rmSync(dir, { recursive: true, force: true });
      const jf = step === 'control' ? path.resolve(o['--control']) : path.resolve(o['--jobs']);
      const rc = runLogged('node', ['tools/genus-ruler/volsky/run.js', jf, dir, W, H, 'gen'], log);
      if (rc !== 0) die(`run.js ${step} exit ${rc}`, 3);
      res[step] = pngMd5(dir, step === 'control' ? cnames : names);
      res[`${step}Bundle`] = res.harnessBundle.sha256;
      // 거시 격자가 실제로 걸렸는지(G1 잡의 전제 macro: 1) — run.js 의 results.json 균일변수 덤프에서 genusMacroTexOn
      const rj = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
      res[`${step}MacroOn`] = Object.fromEntries(Object.entries(rj).map(([n, v]) => [n, v?.uvLane?.clouds?.genusMacroTexOn === 1 && v?.uvLane?.shadow?.genusMacroTexOn === 1]));
      res[`${step}GlError`] = Object.fromEntries(Object.entries(rj).map(([n, v]) => [n, v?.glError ?? null]));
    } else if (step === 'keys') {
      if (!res.harnessBundle) die('run the build step first', 3);
      const dir = path.join(work, 'keys');
      fs.rmSync(dir, { recursive: true, force: true });
      const kj = path.join(work, 'keys.json');
      const rc = runLogged('node', ['tools/genus-ruler/oro/g1/g1-keys.cjs', path.resolve(o['--jobs']), dir, kj, W, H], log);
      if (rc !== 0) die(`g1-keys exit ${rc}`, 3);
      const k = JSON.parse(fs.readFileSync(kj, 'utf8'));
      res.keys = k.jobs;
      res.keysBundle = res.harnessBundle.sha256;
    }
    console.log(`STEP ${step} ${Math.round((Date.now() - t0) / 1000)} s`);
    save();
  }
  // A/A 와 일치 점검(있는 단계만)
  if (res.run1MacroOn) res.macroOnAllJobs = names.every(n => res.run1MacroOn[n] === true && (!res.run2MacroOn || res.run2MacroOn[n] === true));
  if (res.run1 && res.run2) res.aa = names.every(n => res.run1[n].rgb && res.run1[n].alpha && res.run1[n].rgb === res.run2[n].rgb && res.run1[n].alpha === res.run2[n].alpha);
  if (res.run1 && res.keys) res.keysMatchRun1 = names.every(n => res.keys[n] && res.keys[n].rgb === res.run1[n].rgb && res.keys[n].alpha === res.run1[n].alpha);
  if (res.control) {
    const aa = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/genus-ruler/oro/merge-aa.json'), 'utf8'));
    const ref = aa.post && aa.post.run1;
    res.controlMatchesMergeAA = !!ref && cnames.every(n => res.control[n].rgb === ref[`${n}.png`] && res.control[n].alpha === ref[`${n}.alpha.png`]);
    res.controlBundleMd5MatchesMergeAA = !!aa.post && res.harnessBundle.md5 === aa.post.bundleMd5;
  }
  save();
  console.log(`DONE aa ${res.aa ?? '-'} keysMatchRun1 ${res.keysMatchRun1 ?? '-'} control ${res.controlMatchesMergeAA ?? '-'} bundleMd5=mergeAA ${res.controlBundleMd5MatchesMergeAA ?? '-'}`);
}

main();
