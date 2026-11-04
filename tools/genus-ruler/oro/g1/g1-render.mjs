#!/usr/bin/env node
/**
 * g1-render.mjs — G1(b) 하네스 렌더와 G1(c) 날씨 키(자 L748, S3-design.md §8 (b)(c)).
 *
 *   node tools/genus-ruler/oro/g1/g1-render.mjs --jobs tools/genus-ruler/oro/g1/jobs-g1.json --control <jobs-control.json>
 *        --out <b.json> [--work .harness/oro/g1/render] [--steps build,run1,run2,control,keys] [--wait-idle <s>=900]
 *
 * 차례(같은 컨테이너에서 하나씩):
 *   build    bash tools/genus-ruler/volsky/build.sh(기본 출력 .harness/volsky/app.js) → 하네스 번들 sha256·md5
 *   run1/2   node tools/genus-ruler/volsky/run.js <jobs> <work>/runN 390 584 gen — 같은 코드 두 번(A/A), PNG md5
 *   control  같은 명령으로 원래 B0_app·P0_seoul(옵션·고리 없음)을 그려 oro/merge-aa.json 의 합친 뒤 md5 와 견줌(환경 확인)
 *   keys     node tools/genus-ruler/oro/g1/g1-keys.cjs — 앱이 만든 날씨 키, 그리고 그 실행의 PNG md5(run1 과 같아야 함)
 * 판(versions): node, esbuild(build.sh 의 고정 판), chromium(run.js 의 executablePath 와 --version), 깃발(run.js 소스).
 * 부하 지킴(build note 19): run1·run2·control·keys 는 그리기 전에 컨테이너가 놀고 있어야 합니다 — os.loadavg()[0] < 1.0 이고
 *   `ps -eo pid,pcpu,comm` 에서 이 도구·그 조상·ps 밖의 어떤 프로세스도 pcpu ≥ 50 이 아님. 아니면 5 s 마다 다시 보며 --wait-idle 초까지
 *   기다리고(앞 단계의 chromium 이 올린 1 분 부하가 내려가는 데 1~2 분), 그래도 아니면 exit 3(그리지 않음; 0 이면 바로 거절).
 *   그리는 동안에는 1 s 마다 /proc 을 읽어 이 도구의 자손이 아닌 프로세스의 CPU(foreignCores = (전체 바쁨 − 우리 나무) / 벽시계)를 잽니다.
 *   res.load[step] = {before: os.loadavg(), cpus, waitedSec, heavy, during: {wallSec, busyCores, ourCores, foreignCores, foreignPeakCores,
 *   foreignTop}}. g1-baseline.mjs 는 네 단계 모두 before[0] < 1.0·heavy 없음·foreignCores < 0.5 가 아니면 쓰지 않습니다.
 * 출력(--out): 키 정렬 JSON. 표준 출력은 단계·md5·수만.
 */
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import os from 'node:os';
import { ROOT, canonicalJson, die as die0, forbiddenPath, gitPorcelain, md5, parseArgs, resolveCommit, sha256 } from './g1-lib.mjs';

const TOOL = 'g1-render';
const die = (m, c) => die0(TOOL, m, c);
const W = '390', H = '584';
const STEPS_ALL = ['build', 'run1', 'run2', 'control', 'keys'];
const RENDER_STEPS = ['run1', 'run2', 'control', 'keys'];
export const LOAD_MAX = 1.0, PROC_PCPU_MAX = 50, FOREIGN_CORES_MAX = 0.5, POLL_SEC = 5;

function runLogged(cmd, args, log) {
  const fd = fs.openSync(log, 'w');
  const r = cp.spawnSync(cmd, args, { cwd: ROOT, stdio: ['ignore', fd, fd], maxBuffer: 1 << 26 });
  fs.closeSync(fd);
  return r.status;
}

// ── 부하 지킴 ──
const sleepMs = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** 이 도구의 조상 pid(g1-run.sh 의 bash 등 — 이 도구를 기다리는 중이라 ps 의 평생 pcpu 가 지금 부하가 아님). */
function ancestors() {
  const out = new Set();
  for (let pid = process.ppid; pid > 1 && !out.has(pid);) {
    out.add(pid);
    let st; try { st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); } catch { break; }
    pid = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]);
  }
  return out;
}
/** ps 로 본 다른 프로세스 가운데 pcpu ≥ PROC_PCPU_MAX 인 것(이 도구·그 조상·ps 자신은 뺌). ps 의 pcpu 는 평생 평균(cputime/elapsed). */
export function heavyProcesses() {
  const r = cp.spawnSync('ps', ['-eo', 'pid=,pcpu=,comm='], { encoding: 'utf8' });
  if (r.status !== 0) die('ps -eo pid,pcpu,comm failed', 3);
  const out = [], anc = ancestors();
  for (const line of r.stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+([0-9.]+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]), pcpu = Number(m[2]);
    if (pid === process.pid || pid === r.pid || anc.has(pid)) continue;
    if (pcpu >= PROC_PCPU_MAX) out.push({ pid, pcpu, comm: m[3] });
  }
  return out;
}
/** 그리기 전: 놀고 있을 때까지 waitSec 초까지 기다림. 아니면 exit 3. */
export function idleGate(step, waitSec) {
  const t0 = Date.now();
  for (;;) {
    const before = os.loadavg(), heavy = heavyProcesses();
    if (before[0] < LOAD_MAX && heavy.length === 0) return { before, cpus: os.cpus().length, waitedSec: Math.round((Date.now() - t0) / 1000), heavy };
    if ((Date.now() - t0) / 1000 >= waitSec) {
      const hv = heavy.map(h => `${h.comm}(${h.pid}) ${h.pcpu}%`).join(', ');
      die(`${step}: container not idle after ${waitSec} s (loadavg ${before.map(x => x.toFixed(2)).join(' ')} on ${os.cpus().length} cpus; need < ${LOAD_MAX}${hv ? `; processes ≥ ${PROC_PCPU_MAX} % CPU: ${hv}` : ''}) — refused`, 3);
    }
    sleepMs(POLL_SEC * 1000);
  }
}
let HZ = null;
function procSnapshot() {
  if (HZ === null) HZ = Number(cp.execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim()) || 100;
  const cpu = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  const busy = cpu[0] + cpu[1] + cpu[2] + cpu[5] + cpu[6];       // user nice system irq softirq(guest 는 user 안; iowait·steal 뺌)
  const procs = new Map();
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    let st; try { st = fs.readFileSync(`/proc/${d}/stat`, 'utf8'); } catch { continue; }
    const close = st.lastIndexOf(')'), f = st.slice(close + 2).split(' ');
    procs.set(Number(d), { ppid: Number(f[1]), t: Number(f[11]) + Number(f[12]), comm: st.slice(st.indexOf('(') + 1, close) });
  }
  return { busy, procs, ms: Date.now() };
}
/** 그리는 동안: 이 도구의 자손(한 번이라도 자손이었던 pid)을 뺀 CPU. */
class ForeignMonitor {
  constructor() {
    this.ours = new Set([process.pid]); this.base = new Map(); this.last = new Map(); this.comms = new Map(); this.peak = 0;
    this.s0 = this.prev = procSnapshot();
    for (const [pid, p] of this.s0.procs) { this.base.set(pid, p.t); this.last.set(pid, p.t); this.comms.set(pid, p.comm); }
    this.markOurs(this.s0); this.prevOur = this.ourTicks();
  }
  markOurs(s) {
    const kids = new Map();
    for (const [pid, p] of s.procs) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(pid); }
    const stack = [...this.ours];
    while (stack.length) for (const c of kids.get(stack.pop()) ?? []) if (!this.ours.has(c)) { this.ours.add(c); stack.push(c); }
  }
  ourTicks() { let t = 0; for (const pid of this.ours) t += (this.last.get(pid) ?? 0) - (this.base.get(pid) ?? 0); return t; }
  sample(final = false) {
    const s = procSnapshot();
    this.markOurs(s);
    // 처음 보는 pid 는 이 단계 안에서 태어난 것(카운터가 0 에서 시작)
    for (const [pid, p] of s.procs) { if (!this.base.has(pid)) this.base.set(pid, 0); this.last.set(pid, p.t); this.comms.set(pid, p.comm); }
    const our = this.ourTicks(), dt = (s.ms - this.prev.ms) / 1000;
    // 끝 표본은 자식이 끝나며 잃는 틱(재지 못한 마지막 몫)이 '남의 것' 으로 보여 봉우리에서 뺌(봉우리는 참고값)
    if (dt > 0 && !final) this.peak = Math.max(this.peak, ((s.busy - this.prev.busy) - (our - this.prevOur)) / HZ / dt);
    this.prev = s; this.prevOur = our;
  }
  result() {
    this.sample(true);
    const wall = (this.prev.ms - this.s0.ms) / 1000, our = this.ourTicks(), busy = this.prev.busy - this.s0.busy;
    const foreign = [...this.last].filter(([pid]) => !this.ours.has(pid)).map(([pid, t]) => ({ comm: this.comms.get(pid) ?? '?', ticks: t - (this.base.get(pid) ?? 0) }))
      .filter(x => x.ticks > 0).sort((a, b) => b.ticks - a.ticks || (a.comm < b.comm ? -1 : 1)).slice(0, 3);
    const r3 = x => Math.round(x * 1000) / 1000;
    return { wallSec: Math.round(wall), busyCores: r3(busy / HZ / wall), ourCores: r3(our / HZ / wall), foreignCores: r3(Math.max(0, busy - our) / HZ / wall),
      foreignPeakCores: r3(this.peak), foreignTop: foreign.map(x => ({ comm: x.comm, cores: r3(x.ticks / HZ / wall) })) };
  }
}
/** runLogged 와 같되, 도는 동안 1 s 마다 ForeignMonitor 를 표본함. */
export function runMonitored(cmd, args, log) {
  return new Promise(resolve => {
    const fd = fs.openSync(log, 'w');
    const mon = new ForeignMonitor();
    const child = cp.spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', fd, fd] });
    const iv = setInterval(() => mon.sample(), 1000);
    child.on('exit', code => { clearInterval(iv); fs.closeSync(fd); resolve({ status: code, during: mon.result() }); });
  });
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

async function main() {
  const o = parseArgs(TOOL, process.argv.slice(2), { '--jobs': true, '--control': true, '--out': true, '--work': true, '--steps': true, '--wait-idle': true });
  if (!o['--jobs'] || !o['--control'] || !o['--out']) die('--jobs, --control and --out are required');
  for (const k of ['--jobs', '--control', '--out', '--work']) if (o[k] && forbiddenPath(o[k])) die(`${k}: path refused`);
  const work = path.resolve(o['--work'] ?? path.join(ROOT, '.harness/oro/g1/render'));
  const steps = o['--steps'] ? o['--steps'].split(',') : STEPS_ALL;
  for (const s of steps) if (!STEPS_ALL.includes(s)) die(`unknown step ${s}`);
  const waitIdle = o['--wait-idle'] === undefined ? 900 : Number(o['--wait-idle']);
  if (!Number.isInteger(waitIdle) || waitIdle < 0) die('--wait-idle: a whole number of seconds ≥ 0');
  fs.mkdirSync(work, { recursive: true });
  const outPath = path.resolve(o['--out']);
  const prev = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
  const res = { ...prev };
  const jobs = JSON.parse(fs.readFileSync(path.resolve(o['--jobs']), 'utf8'));
  const ctl = JSON.parse(fs.readFileSync(path.resolve(o['--control']), 'utf8'));
  const names = jobs.map(j => j.name), cnames = ctl.map(j => j.name);
  res.jobsFileSha256 = sha256(fs.readFileSync(path.resolve(o['--jobs'])));
  // 묶음은 작업 트리에서 만들므로(build.sh) src·volsky 가 깨끗해야 그 커밋의 앱 코드입니다.
  const dirty = gitPorcelain(['src', 'tools/genus-ruler/volsky']);
  if (dirty.length) die(`src or tools/genus-ruler/volsky has uncommitted changes (${dirty.length})`, 2);
  if (steps.includes('build')) res.commit = resolveCommit(TOOL, 'HEAD');
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
    // 부하 지킴: 그리는 단계는 놀고 있는 컨테이너에서만 시작(build note 19). 기록은 단계가 끝나야 남음(거절이면 b.json 의 그 단계는 그대로).
    const gate = RENDER_STEPS.includes(step) ? idleGate(step, waitIdle) : null;
    if (gate) console.log(`IDLE ${step} loadavg ${gate.before.map(x => x.toFixed(2)).join(' ')} waited ${gate.waitedSec} s`);
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
      const { status: rc, during } = await runMonitored('node', ['tools/genus-ruler/volsky/run.js', jf, dir, W, H, 'gen'], log);
      if (rc !== 0) die(`run.js ${step} exit ${rc}`, 3);
      res.load = { ...(res.load ?? {}), [step]: { ...gate, during } };
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
      const { status: rc, during } = await runMonitored('node', ['tools/genus-ruler/oro/g1/g1-keys.cjs', path.resolve(o['--jobs']), dir, kj, W, H], log);
      if (rc !== 0) die(`g1-keys exit ${rc}`, 3);
      res.load = { ...(res.load ?? {}), keys: { ...gate, during } };
      const k = JSON.parse(fs.readFileSync(kj, 'utf8'));
      res.keys = k.jobs;
      res.keysBundle = res.harnessBundle.sha256;
    }
    const ld = res.load?.[step]?.during;
    console.log(`STEP ${step} ${Math.round((Date.now() - t0) / 1000)} s${ld && gate ? ` foreignCores ${ld.foreignCores} (peak ${ld.foreignPeakCores})` : ''}`);
    save();
  }
  // A/A 와 일치 점검(있는 단계만)
  if (res.run1MacroOn) res.macroOnAllJobs = names.every(n => res.run1MacroOn[n] === true && (!res.run2MacroOn || res.run2MacroOn[n] === true));
  if (res.run1 && res.run2) {
    res.aa = names.every(n => res.run1[n].rgb && res.run1[n].alpha && res.run1[n].rgb === res.run2[n].rgb && res.run1[n].alpha === res.run2[n].alpha);
    res.aaDiff = names.flatMap(n => ['rgb', 'alpha'].filter(k => res.run1[n][k] !== res.run2[n][k]).map(k => `${n}.${k}`));
  }
  // 부하 지킴 요약(네 그리기 단계가 모두 기록돼 있을 때만 참)
  res.renderUnloaded = RENDER_STEPS.every(s => {
    const l = res.load?.[s];
    return !!l && l.before[0] < LOAD_MAX && Array.isArray(l.heavy) && l.heavy.length === 0 && !!l.during && l.during.foreignCores < FOREIGN_CORES_MAX;
  });
  if (res.run1 && res.keys) res.keysMatchRun1 = names.every(n => res.keys[n] && res.keys[n].rgb === res.run1[n].rgb && res.keys[n].alpha === res.run1[n].alpha);
  if (res.control) {
    const aa = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/genus-ruler/oro/merge-aa.json'), 'utf8'));
    const ref = aa.post && aa.post.run1;
    res.controlMatchesMergeAA = !!ref && cnames.every(n => res.control[n].rgb === ref[`${n}.png`] && res.control[n].alpha === ref[`${n}.alpha.png`]);
    res.controlBundleMd5MatchesMergeAA = !!aa.post && res.harnessBundle.md5 === aa.post.bundleMd5;
  }
  save();
  console.log(`DONE unloaded ${res.renderUnloaded} aa ${res.aa ?? '-'} keysMatchRun1 ${res.keysMatchRun1 ?? '-'} control ${res.controlMatchesMergeAA ?? '-'} bundleMd5=mergeAA ${res.controlBundleMd5MatchesMergeAA ?? '-'}`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(new URL(import.meta.url).pathname)) await main();
