/**
 * §179 RULER-tsun 실행기(run-tsun.js)의 순수 함수 — 브라우저·Playwright 없음. verify-tsun-ref.js 가 node 에서 시험합니다(실행기 자체는 시험에서 돌리지 않음).
 *  - 자기 지킴(ruler-delta B2): 돌고 있는 RULER-grain 과정(eval-grain.sh · run-grain.js · genus-ruler/volsky/run.js)이 있으면 시작하지 않음.
 *    `--guard-tag genus-ruler/volsky/run.js` 로 띄운 이 실행기 자신·조상(nice·sh)은 뺌 — 그 태그 덕에 동결 eval-grain.sh 의 guard_concurrent(pgrep -f)가
 *    고치지 않고도 돌고 있는 tsun 덩어리를 봄.
 *  - 잠금 파일(기본 /tmp/run-tsun.lock, 덩어리 내내): 살아 있는 pid 가 쥐고 있으면 거부, 죽은 pid 의 잠금은 기록하고 치움.
 *  - 감시 시간(ruler-delta B2 시작값): REF 25 분 · REF100 50 분 · REF 진단 8 분 · 그 밖 2 분, × --watchdog-scale(B0 시간 재기 뒤 다시 정함).
 *  - 한 잡 파일 안 품질 섞기 거부(takram GROUND_BOUNCE define 걸림 — high 잡은 따로 된 페이지, ruler-delta F4).
 *  - §179 검토 반영(하네스 2·3·8·13·14·16, 2026-10-29): --guard-tag 필수(없으면 거부) · 인자 점검(모르는 깃발·W/H·--max-min (0, 120]·배율 > 0 ·
 *    atmos gen|load 아니면 거부) · 덩어리 한도 = '지난 시간 + 다음 잡 감시 시간 > 한도면 시작하지 않음' · 감시 시간(REF 진단은 보폭 비 ×,
 *    화소 수 비 ×, 페이지 첫 잡은 컴파일 여유 +5 분) · 조상은 명령 줄에 run-tsun 이 있을 때만 뺌 · 잠금은 임시 파일 + link(내용째 원자적으로),
 *    읽을 수 없는 10 초 미만 잠금은 쥔 것으로 봄 · 주인 없는 SwiftShader GPU 과정도 충돌 · 한 잡 파일 안 같은 이름 거부.
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
  const ids = selfAndAncestors.map(Number), self = ids[0], anc = new Set(ids);
  // 하네스 14(b): 조상이라도 명령 줄이 run-tsun 이 아니면(진짜 grain 감싸개) 빼지 않음 — 자기 자신(pgrep 이 볼 때의 node)만 무조건 뺌
  return String(pgrepOut || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(\d+)\s+(.*)$/);
    return m ? { pid: Number(m[1]), cmd: m[2] } : null;
  }).filter(p => p && !(p.pid === self || (anc.has(p.pid) && /run-tsun/.test(p.cmd))));
}
/** 하네스 14(d): 주인 없는(또는 남의) SwiftShader GPU 과정 무늬 — 시작 때는 아직 자식이 없으므로 보이면 모두 남의 것. */
const SWIFTSHADER_GPU_PATTERN = 'type=gpu-process.*use-angle=swiftshader';
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
  const nowMs = o.nowMs ?? (() => Date.now());
  const body = JSON.stringify({ pid, started: (o.now ?? (() => new Date().toISOString()))() });
  let stale = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    // 하네스 14(c): 내용을 다 쓴 임시 파일을 link 로 걸어 '빈 잠금' 순간이 없게(openSync('wx') 뒤 writeSync 사이의 경합)
    const tmp = `${file}.${pid}.${attempt}.tmp`;
    fs.writeFileSync(tmp, body);
    try {
      fs.linkSync(tmp, file);
      fs.unlinkSync(tmp);
      return { stale, release: () => { try { const cur = JSON.parse(fs.readFileSync(file, 'utf8')); if (cur.pid === pid) fs.unlinkSync(file); } catch { /* 없음 */ } } };
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* 없음 */ }
      if (e.code !== 'EEXIST') throw e;
      let held = null;
      try { held = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { held = null; }
      if (held && Number.isFinite(held.pid) && alive(held.pid)) throw new Error(`run-tsun: lock ${file} is held by live pid ${held.pid} (since ${held.started}) — one tsun chunk at a time`);
      if (!held) {
        // 읽을 수 없는 잠금: 10 초 안에 만들어진 것은 다른 과정이 쓰는 중으로 보고 거부(옛 판의 openSync 경합 대비), 그보다 오래면 낡음
        let age = Infinity; try { age = nowMs() - fs.statSync(file).mtimeMs; } catch { /* 없음 */ }
        if (age < 10000) throw new Error(`run-tsun: lock ${file} is unreadable and ${Math.round(age)} ms old — treated as held`);
      }
      stale = held ?? { unreadable: true }; fs.unlinkSync(file);
    }
  }
  throw new Error('run-tsun: could not acquire lock ' + file);
}

/** 첫 잡 컴파일 여유(분) — 페이지의 첫 잡은 SwiftShader 가 큰 T·아치 프로그램을 처음 컴파일함(하네스 8b). */
const FIRST_JOB_EXTRA_MIN = 5;
/**
 * 감시 시간(ms) — 잡 watchdogMin(유한한 수 > 0 이어야, 아니면 throw — 하네스 8d)이 있으면 그것, 아니면 ruler-delta B2 시작값:
 * REF 25 분 · REF100 50 분 · REF 진단 8 분 × (200 / 보폭)(하네스 8a: REF100 진단 16 분) · 그 밖 2 분 × 화소 수 비(W·H / 400·300, 하네스 8b).
 * 모두 × scale, 페이지 첫 잡은 + 5 분, 2 분 아래로는 안 감. W·H 는 이 호출의 캔버스.
 */
function watchdogMs(job, scale = 1, opt = {}) {
  if (!(Number.isFinite(scale) && scale > 0)) throw new Error('run-tsun: watchdog scale must be a finite number > 0, got ' + scale);
  const o = job.options || {};
  const px = Math.max(1, ((opt.W || 400) * (opt.H || 300)) / (400 * 300));
  let min;
  if (job.watchdogMin != null) {
    if (!(typeof job.watchdogMin === 'number' && Number.isFinite(job.watchdogMin) && job.watchdogMin > 0)) throw new Error(`run-tsun: job ${job.name} watchdogMin must be a finite number > 0, got ${JSON.stringify(job.watchdogMin)}`);
    min = job.watchdogMin;
  } else if (o.tsunRef && o.tsunDebug) min = 8 * Math.max(1, 200 / Math.max(1, Number(o.tsunRefStepM) || 200));
  else if (o.tsunRef && Number(o.tsunRefStepM) <= 100) min = 50;
  else if (o.tsunRef) min = 25;
  else min = 2 * px;
  return (Math.max(2, min * scale) + (opt.first ? FIRST_JOB_EXTRA_MIN : 0)) * 60000;
}

/** 한 잡 파일 안 품질이 섞였으면 그 목록(빈 배열 = 괜찮음). */
function mixedQualities(jobs) {
  const q = [...new Set(jobs.map(j => j.quality || 'low'))];
  return q.length > 1 ? q : [];
}
/** 하네스 16: 한 잡 파일 안 같은 이름(출력·meta 가 서로 덮어 이어 그리기가 번갈아 됨) — 그 이름 목록. */
function duplicateNames(jobs) {
  const seen = new Set(), dup = new Set();
  for (const j of jobs) { const n = String(j && j.name); if (seen.has(n)) dup.add(n); seen.add(n); }
  return [...dup];
}

/** 덩어리 한도(분)의 위 끝 — ruler-delta B2 '덩어리 ≤ 2 시간'. */
const MAX_CHUNK_MIN = 120;
/**
 * 명령 줄: --guard-tag X [--max-min N] [--lock F] [--atmos load|gen] [--root DIR] [--watchdog-scale s] [--retry-watchdog] [--allow-dirty] jobs out W H [gen|load]
 * 하네스 3·13: 잘못된 값·모르는 깃발은 throw(부르는 쪽이 종료 코드 2) — 처음 판은 NaN 한도가 '한도 없음'이 되고 W 'abc' 가 아무것도 안 하고 0 으로 끝났음.
 */
function parseArgs(argv, env = {}) {
  const a = argv.slice();
  const VALUED = ['--guard-tag', '--max-min', '--lock', '--atmos', '--root', '--watchdog-scale'], FLAGS = ['--retry-watchdog', '--allow-dirty'];
  const take = (k, d) => { const i = a.indexOf(k); if (i < 0) return d; if (i + 1 >= a.length || a[i + 1].startsWith('--')) throw new Error(`run-tsun: ${k} needs a value`); const v = a[i + 1]; a.splice(i, 2); return v; };
  const flag = k => { const i = a.indexOf(k); if (i < 0) return false; a.splice(i, 1); return true; };
  const guardTag = take('--guard-tag', null);
  const maxMinRaw = take('--max-min', '110');
  const lock = take('--lock', env.TSUN_LOCK || '/tmp/run-tsun.lock');
  let atmos = take('--atmos', null);
  const root = take('--root', env.VROOT || '.harness/volsky-tsun');
  const wsRaw = take('--watchdog-scale', '1');
  const retryWatchdog = flag('--retry-watchdog'), allowDirty = flag('--allow-dirty');
  const unknown = a.filter(x => x.startsWith('--'));
  if (unknown.length) throw new Error(`run-tsun: unknown flag(s) ${unknown.join(' ')} (known: ${[...VALUED, ...FLAGS].join(' ')})`);
  const [jobsFile, outDir, Wr = '400', Hr = '300', pos5, ...extra] = a;
  if (extra.length) throw new Error('run-tsun: too many positional arguments: ' + extra.join(' '));
  const maxMin = Number(maxMinRaw), watchdogScale = Number(wsRaw);
  if (!(Number.isFinite(maxMin) && maxMin > 0 && maxMin <= MAX_CHUNK_MIN)) throw new Error(`run-tsun: --max-min must be in (0, ${MAX_CHUNK_MIN}], got ${maxMinRaw}`);
  if (!(Number.isFinite(watchdogScale) && watchdogScale > 0)) throw new Error(`run-tsun: --watchdog-scale must be a finite number > 0, got ${wsRaw}`);
  const W = Number(Wr), H = Number(Hr);
  if (!(Number.isInteger(W) && W > 0 && Number.isInteger(H) && H > 0)) throw new Error(`run-tsun: W H must be positive integers, got ${Wr} ${Hr}`);
  if (pos5 != null && pos5 !== 'gen' && pos5 !== 'load') throw new Error(`run-tsun: 5th argument must be gen|load, got ${pos5}`);
  if (!atmos) atmos = pos5 === 'load' ? 'load' : 'gen';
  if (atmos !== 'gen' && atmos !== 'load') throw new Error(`run-tsun: --atmos must be gen|load, got ${atmos}`);
  return { guardTag, maxMin, lock, atmos, root, watchdogScale, retryWatchdog, allowDirty, jobsFile, outDir, W, H };
}
/** 하네스 3: 이 잡을 시작해도 되는지 — 지난 시간 + 이 잡의 감시 시간이 한도를 넘으면 시작하지 않음(분). */
function startsWithinChunk(elapsedMin, jobWatchdogMs, maxMin) {
  return elapsedMin + jobWatchdogMs / 60000 <= maxMin;
}

module.exports = { GRAIN_PATTERN, GUARD_TAG, SWIFTSHADER_GPU_PATTERN, FIRST_JOB_EXTRA_MIN, MAX_CHUNK_MIN, conflictingProcesses, ancestorsOf, acquireLock, watchdogMs, mixedQualities, duplicateNames, parseArgs, startsWithinChunk };
