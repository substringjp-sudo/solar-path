/**
 * §179 RULER-tsun 실행기(run-tsun.js)의 순수 함수 — 브라우저·Playwright 없음. verify-tsun-ref.js 가 node 에서 시험합니다(실행기 자체는 시험에서 돌리지 않음).
 *  - 자기 지킴(ruler-delta B2): 돌고 있는 RULER-grain 과정(eval-grain.sh · run-grain.js · genus-ruler/volsky/run.js)이 있으면 시작하지 않음.
 *    `--guard-tag genus-ruler/volsky/run.js` 로 띄운 이 실행기 자신·조상(nice·sh)은 뺌 — 그 태그 덕에 동결 eval-grain.sh 의 guard_concurrent(pgrep -f)가
 *    고치지 않고도 돌고 있는 tsun 덩어리를 봄.
 *  - 잠금 파일(기본 /tmp/run-tsun.lock, 덩어리 내내): 살아 있는 pid 가 쥐고 있으면 거부, 죽은 pid 의 잠금은 기록하고 치움.
 *  - 감시 시간(ruler-delta B2 시작값): REF 25 분 · REF100 50 분 · REF 진단 8 분 · 그 밖 2 분, × --watchdog-scale(B0 시간 재기 뒤 다시 정함).
 *  - 한 잡 파일 안 품질 섞기 거부(takram GROUND_BOUNCE define 걸림 — high 잡은 따로 된 페이지, ruler-delta F4).
 */
'use strict';
const fs = require('fs');

/** 동결 RULER-grain 실행 과정의 pgrep -f 무늬(ruler-delta B2). */
const GRAIN_PATTERN = 'run-grain.js|eval-grain.sh|genus-ruler/volsky/run.js';
/** 이 실행기가 명령 줄에 붙이는 표지(동결 eval-grain.sh guard_concurrent 가 이것을 봄). */
const GUARD_TAG = 'genus-ruler/volsky/run.js';

/**
 * `pgrep -af` 출력(줄마다 "pid 명령 줄")에서 충돌 과정만 고름 — 자신·조상 pid 는 뺌. 순수 함수(ancestors 는 부른 쪽이 /proc 에서 셈).
 * @param {string} pgrepOut @param {number[]} selfAndAncestors @returns {{pid:number, cmd:string}[]}
 */
function conflictingProcesses(pgrepOut, selfAndAncestors) {
  const skip = new Set(selfAndAncestors.map(Number));
  return String(pgrepOut || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(\d+)\s+(.*)$/);
    return m ? { pid: Number(m[1]), cmd: m[2] } : null;
  }).filter(p => p && !skip.has(p.pid));
}
/** 자신과 조상 pid(/proc/<pid>/stat 의 넷째 칸 = ppid). /proc 이 없으면 자신만. */
function ancestorsOf(pid, readFile = f => fs.readFileSync(f, 'utf8')) {
  const out = [pid];
  let p = pid;
  for (let k = 0; k < 64 && p > 1; k++) {
    let st;
    try { st = readFile(`/proc/${p}/stat`); } catch { break; }
    const rest = st.slice(st.lastIndexOf(')') + 2).split(' ');   // comm 에 공백·괄호가 있을 수 있음
    const pp = Number(rest[1]);
    if (!(pp > 0) || out.includes(pp)) break;
    out.push(pp); p = pp;
  }
  return out;
}

/**
 * 잠금 얻기. 이미 있으면: 그 pid 가 살아 있으면 throw, 죽었으면 치우고 다시(기록 stale). 돌려주는 release() 는 자기 잠금만 지움.
 * @param {string} file @param {{pid?:number, alive?:(pid:number)=>boolean, now?:()=>string}} [o]
 */
function acquireLock(file, o = {}) {
  const pid = o.pid ?? process.pid;
  const alive = o.alive ?? (p => { try { process.kill(p, 0); return true; } catch (e) { return e.code === 'EPERM'; } });
  const body = JSON.stringify({ pid, started: (o.now ?? (() => new Date().toISOString()))() });
  let stale = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx'); fs.writeSync(fd, body); fs.closeSync(fd);
      return { stale, release: () => { try { const cur = JSON.parse(fs.readFileSync(file, 'utf8')); if (cur.pid === pid) fs.unlinkSync(file); } catch { /* 없음 */ } } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let held = null;
      try { held = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { held = null; }
      if (held && Number.isFinite(held.pid) && alive(held.pid)) throw new Error(`run-tsun: lock ${file} is held by live pid ${held.pid} (since ${held.started}) — one tsun chunk at a time`);
      stale = held; fs.unlinkSync(file);
    }
  }
  throw new Error('run-tsun: could not acquire lock ' + file);
}

/** 감시 시간(ms) — 잡 watchdogMin 이 있으면 그것, 아니면 ruler-delta B2 시작값 × scale, 그리고 2 분 아래로는 안 감. */
function watchdogMs(job, scale = 1) {
  const o = job.options || {};
  let min;
  if (Number.isFinite(job.watchdogMin)) min = job.watchdogMin;
  else if (o.tsunRef && o.tsunDebug) min = 8;
  else if (o.tsunRef && Number(o.tsunRefStepM) <= 100) min = 50;
  else if (o.tsunRef) min = 25;
  else min = 2;
  return Math.max(2, min * scale) * 60000;
}

/** 한 잡 파일 안 품질이 섞였으면 그 목록(빈 배열 = 괜찮음). */
function mixedQualities(jobs) {
  const q = [...new Set(jobs.map(j => j.quality || 'low'))];
  return q.length > 1 ? q : [];
}

/** 명령 줄: [--guard-tag X] [--max-min N] [--lock F] [--atmos load|gen] [--root DIR] [--watchdog-scale s] jobs out W H [gen|load] */
function parseArgs(argv, env = {}) {
  const a = argv.slice();
  const take = (k, d) => { const i = a.indexOf(k); if (i < 0) return d; const v = a[i + 1]; a.splice(i, 2); return v; };
  const guardTag = take('--guard-tag', null);
  const maxMin = Number(take('--max-min', '110'));
  const lock = take('--lock', env.TSUN_LOCK || '/tmp/run-tsun.lock');
  let atmos = take('--atmos', null);
  const root = take('--root', env.VROOT || '.harness/volsky-tsun');
  const watchdogScale = Number(take('--watchdog-scale', '1'));
  const [jobsFile, outDir, W = '400', H = '300', pos5] = a;
  if (!atmos) atmos = pos5 === 'load' ? 'load' : 'gen';
  return { guardTag, maxMin, lock, atmos, root, watchdogScale, jobsFile, outDir, W: Number(W), H: Number(H) };
}

module.exports = { GRAIN_PATTERN, GUARD_TAG, conflictingProcesses, ancestorsOf, acquireLock, watchdogMs, mixedQualities, parseArgs };
