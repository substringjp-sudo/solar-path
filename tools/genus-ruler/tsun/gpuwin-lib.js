/**
 * §180 GPU 창(gpu-window.sh)의 순수 함수 + 작은 명령 줄 — 브라우저·Playwright 없음. gpuwin-test.js 가 node 에서 시험합니다.
 *
 *  - 지킴(guard): RULER-grain 과정·주인 없는 SwiftShader GPU 과정이 없을 때까지 기다림/한 번 봄. pgrep 은 GW_PGREP(가짜 pgrep 시험용)로 바꿀 수 있음.
 *    자기·조상·--exclude-pid(창 표지 과정)는 뺌. §180 검토 9: 명령 줄 전체가 아니라 argv(/proc/<pid>/cmdline)의 대본이 eval-grain.sh·run-grain.js·
 *    volsky/run.js 인 과정만 grain(도구 셸·감시 고리·less 같은 거짓 양성 없앰) — 태그 단 다른 tsun 덩어리도 충돌.
 *  - 시간 어림(estimate): manifest.json 의 잡별 sim 목록으로 run-tsun 받아들임 규칙을 흉내(페이지마다 대기 생성 7.5~12 분 · 덩어리마다 다시 컴파일 ·
 *    감시 시간 손실 · 멈춤), REF 문 갈래(막힘·통과·relax)의 최소~최대(§180 검토 6). B0 결정(decisions.json)이 있으면 잰 값 한 갈래.
 *  - 표지(marker): 단계마다 <OUT>/steps/<id>.json — status·inputSha. 같은 inputSha 의 done·blocked(·done-failures·timeout·stalled)면 건너뜀(이어 돌리기).
 *  - B0 결정(decide-b0): REF·REF100 한 그리기(프레임 0 = 컴파일 뺌) > 10 s → 그 팔 막힘(strict, 가위 대체 경로 구현 안 됨) 또는 기록만(relax),
 *    감시 시간 배율 ≥ 1(REF·REF100 따로), 대기 생성까지 넣어 덩어리에 들어가는지(§180 검토 2·3·7).
 *  - 박명 출렁임(pulsing): 시간 이동 계열 ln Y 에서 국소 2차 맞춤을 빼고 남은 것의 띠별 rms·봉우리 간격 — irradianceLogMu 켬/끔 비교.
 *  - 출력 경로 점검(paths-ok): .harness/ · tools/genus-ruler/grain/ · 동결 후보 tsun 파일 아래에는 쓰지 않음(realpath 도 — §180 검토 13).
 *  - 낡은 것 치우기: /tmp/run-tsun.lock(죽은·다른 부팅·재사용 pid — 검토 1) · 죽은 창의 표지 과정(검토 5).
 *
 *   node gpuwin-lib.js guard --once|--wait [--max-wait-min N] [--poll-s S] [--stable K] [--exclude-pid P]
 *       종료 0 = 비었음 · 10 = 돌고 있음(--once) · 75 = 기다림 한도 · 2 = pgrep 오류(닫힌 쪽)
 *   node gpuwin-lib.js ancestors-ok [--pid P]                  → 0 / 2(조상 명령 줄에 grain 무늬 — 자식이 모두 거부할 것)
 *   node gpuwin-lib.js lock-clean --lock F · hold-clean
 *   node gpuwin-lib.js estimate --manifest M [--decisions D] [--chunk-min 55] [--ref-gate strict|relax] [--json OUT]
 *   node gpuwin-lib.js input-sha FILE...                       → sha256(파일 이름 + 내용 …)
 *   node gpuwin-lib.js marker-ok --marker F --input-sha S [--retry] [--retry-watchdog]   → 종료 0 = 건너뜀 · 1 = 돌림
 *   node gpuwin-lib.js marker-write --marker F --id ID --status S --input-sha S [--rc N] [--started ISO] [--chunks N] [--note T]
 *   node gpuwin-lib.js marker-status --marker F --input-sha S · any-rendered --dir STEPS
 *   node gpuwin-lib.js count-done --dir D --jobs F             → 정리된 잡 수(captureOk meta + watchdog.txt — 덩어리 진전 판단)
 *   node gpuwin-lib.js decide-b0 --dir D --out F [--chunk-min 55] [--ref-gate strict|relax]
 *   node gpuwin-lib.js paths-ok PATH...                        → 종료 0 / 2(금지 경로)
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const L = require('./run-tsun-lib');

const REPO = path.resolve(__dirname, '..', '..', '..');
/** 창 표지 과정의 이름 — eval-grain.sh guard_concurrent(pgrep -f 'genus-ruler/volsky/run.js')가 단계 사이에도 이 창을 보게(ruler-delta B2 의 태그와 같은 생각). */
const HOLD_NAME = 'gpu-window-hold genus-ruler/volsky/run.js';
/** 덩어리 한도(분) — 과제 조건 '덩어리 ≤ 60 분'. run-tsun --max-min 은 이보다 작게(브라우저 닫기·결과 합치기 여유). */
const CHUNK_MAX_MIN = 60;
const CHUNK_DEFAULT_MIN = 55;

// ───── 지킴 ─────
/** 감싸개(exec 하거나 자식을 띄우는 명령)·해석기 — 명령 줄의 '대본' 자리를 찾을 때 건너뜀(§180 검토 9). */
const WRAPPERS = new Set(['nice', 'nohup', 'setsid', 'timeout', 'env', 'stdbuf', 'ionice', 'chrt', 'taskset', 'time']);
const INTERPRETERS = new Set(['node', 'nodejs', 'bash', 'sh', 'dash', 'zsh', 'ksh']);
const base = s => String(s).split('/').pop();
/**
 * argv 의 대본(감싸개·VAR=값·해석기와 그 깃발 다음 첫 글자). `bash -c '…'`·`node -e '…'` 처럼 글자를 바로 돌리는 셸은 null —
 * 그 글자가 eval-grain.sh 를 부르면 그 자식이 따로 보임(마지막 명령이면 bash 가 exec 해 argv 가 bash eval-grain.sh 가 됨).
 */
function scriptOf(argv) {
  let i = 0;
  const isAssign = t => /^[A-Za-z_][A-Za-z0-9_]*=/.test(t);
  for (;;) {
    if (i >= argv.length) return null;
    if (isAssign(argv[i])) { i++; continue; }
    if (WRAPPERS.has(base(argv[i]))) { i++; while (i < argv.length && (argv[i].startsWith('-') || /^\d+(\.\d+)?[smhd]?$/.test(argv[i]) || isAssign(argv[i]))) i++; continue; }
    break;
  }
  if (INTERPRETERS.has(base(argv[i]))) {
    i++;
    while (i < argv.length && argv[i].startsWith('-')) { if (/^-(c|e|p|-eval|-print)$/.test(argv[i])) return null; i++; }
  }
  return i < argv.length ? argv[i] : null;
}
/**
 * §180 검토 9: 이 과정이 '진짜' RULER-grain 실행인지 — 명령 줄 전체에 글자가 들어 있기만 한 과정(도구 셸의 bash -c '… eval-grain.sh …',
 * `until ! pgrep -f eval-grain.sh` 감시 고리, less·tail·grep)은 아님. 대본 basename 이 eval-grain.sh · run-grain.js 이거나 …/volsky/run.js 이면 grain.
 * 맨 run.js(volsky 폴더에서 cd 하고 부름)는 cwd 를 보고, 못 읽으면 grain 으로(닫힌 쪽). 태그를 단 다른 tsun 덩어리(run-tsun.js · lighting-render-check.js
 * + --guard-tag)는 'tsun chunk'. 그 밖은 null.
 */
function classifyArgv(argv, cwdOf = () => null) {
  const sc = scriptOf(argv);
  if (!sc) return null;
  const b = base(sc);
  if (b === 'eval-grain.sh' || b === 'run-grain.js' || /(^|\/)volsky\/run\.js$/.test(sc)) return 'RULER-grain';
  if (b === 'run.js' && !sc.includes('/')) { const cwd = cwdOf(); if (cwd == null || /volsky$/.test(cwd)) return 'RULER-grain'; }
  if ((b === 'run-tsun.js' || b === 'lighting-render-check.js') && argv.includes(L.GUARD_TAG)) return 'tsun chunk (tagged)';
  return null;
}
/** /proc/<pid>/cmdline(NUL 로 나뉜 argv) — 못 읽으면 null. */
function procArgv(pid) { try { const t = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); return t ? t.replace(/\0$/, '').split('\0') : null; } catch { return null; } }
function procCwd(pid) { try { return fs.readlinkSync(`/proc/${pid}/cwd`); } catch { return null; } }
/**
 * pgrep -af 출력에서 창과 겹치면 안 되는 과정. 자기·조상(명령 줄과 무관 — 이 지킴은 창 실행기 쪽에서만 부름)·exclude(창 표지)는 뺌.
 * §180 검토 9: argv 는 /proc/<pid>/cmdline 에서(가짜 pgrep 시험 — opts.argvOf null — 이거나 과정이 이미 끝났으면 pgrep 줄을 빈칸으로 나눔).
 * @param {string} grainOut pgrep -af GRAIN_PATTERN @param {string} gpuOut pgrep -af SWIFTSHADER_GPU_PATTERN @param {number[]} exclude
 * @param {{argvOf?: ((pid:number)=>string[]|null)|null, cwdOf?: (pid:number)=>string|null}} [opts]
 */
function guardConflicts(grainOut, gpuOut, exclude, opts = {}) {
  const ex = new Set(exclude.map(Number));
  const argvOf = opts.argvOf === undefined ? procArgv : opts.argvOf, cwdOf = opts.cwdOf ?? procCwd;
  const parse = s => String(s || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/^(\d+)\s+(.*)$/); return m ? { pid: Number(m[1]), cmd: m[2] } : null; }).filter(Boolean);
  const g = parse(grainOut).filter(p => !ex.has(p.pid) && !p.cmd.startsWith('gpu-window-hold')).map(p => {
    const av = (argvOf && argvOf(p.pid)) || p.cmd.split(/\s+/);
    return { ...p, why: classifyArgv(av, () => cwdOf(p.pid)) };
  }).filter(p => p.why);
  const s = parse(gpuOut).filter(p => !ex.has(p.pid)).map(p => ({ ...p, why: 'SwiftShader GPU process' }));
  return [...g, ...s];
}
/** pgrep 한 번(없음 = 빈 글자, 오류 = throw — 닫힌 쪽). GW_PGREP 로 바꿈(시험). */
function pgrepAf(pattern, env = process.env) {
  const bin = env.GW_PGREP || 'pgrep';
  try { return execFileSync(bin, ['-af', pattern], { encoding: 'utf8' }); } catch (e) { if (e.status === 1) return ''; throw new Error(`pgrep failed (${bin}): ${e.message}`); }
}
function guardOnce(exclude, env = process.env) {
  const anc = L.ancestorsOf(process.pid);
  // 가짜 pgrep(시험)의 pid 는 진짜 과정이 아님 — /proc 을 읽지 않고 pgrep 줄로
  return guardConflicts(pgrepAf(L.GRAIN_PATTERN, env), pgrepAf(L.SWIFTSHADER_GPU_PATTERN, env), [...anc, ...exclude], env.GW_PGREP ? { argvOf: null, cwdOf: () => '/x/volsky' } : {});
}
/**
 * §180 검토 1·9: 조상 중 명령 줄에 grain 무늬가 든 과정(`bash -c "eval-grain.sh c0; gpu-window.sh run"` 처럼 이어 띄움, 또는 그런 글자가 든 도구 셸).
 * run-tsun·lighting-render-check 의 자기 지킴은 run-tsun 이 아닌 조상을 빼지 않으므로 모든 자식이 거부(2)함 — 창 시작 때 미리 알림.
 */
function grainAncestors(pid = process.pid, readCmd = p => { const a = procArgv(p); return a ? a.join(' ') : null; }) {
  const re = new RegExp(L.GRAIN_PATTERN);
  return L.ancestorsOf(pid).slice(1).map(p => ({ pid: p, cmd: readCmd(p) })).filter(p => p.cmd && re.test(p.cmd) && !p.cmd.startsWith('gpu-window-hold'));
}
/**
 * §180 검토 1: 낡은 tsun 잠금(/tmp/run-tsun.lock — /tmp 는 다시 켜도 남음) 치우기. 쥔 pid 가 죽었거나, 다른 부팅이거나, 살아 있어도 그 명령 줄이
 * run-tsun · lighting-render-check 가 아니면(pid 재사용) 지움. 지우면 이유, 그대로면 null.
 */
function staleTsunLock(file, o = {}) {
  const alive = o.alive ?? (p => { try { process.kill(p, 0); return true; } catch (e) { return e.code === 'EPERM'; } });
  const cmdOf = o.cmdOf ?? (p => { const a = procArgv(p); return a ? a.join(' ') : null; });
  const boot = o.bootId !== undefined ? o.bootId : L.bootId();
  let held;
  try { held = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; held = null; }
  let why = null;
  if (!held || !Number.isFinite(held.pid)) {
    let age = Infinity; try { age = Date.now() - fs.statSync(file).mtimeMs; } catch { return null; }
    if (age >= 10000) why = 'unreadable lock';
  } else if (held.bootId && boot && held.bootId !== boot) why = `lock from another boot (${String(held.bootId).slice(0, 8)})`;
  else if (!alive(held.pid)) why = `pid ${held.pid} is dead`;
  else { const c = cmdOf(held.pid); if (c == null || !/run-tsun|lighting-render-check/.test(c)) why = `pid ${held.pid} is alive but is not a tsun chunk (${String(c).slice(0, 80)}) — pid reused`; }
  if (why) { try { fs.unlinkSync(file); } catch { /* 없음 */ } }
  return why;
}
/** §180 검토 5: 죽은 창이 남긴 표지 과정(부모가 gpu-window.sh 가 아님)을 끝냄 — 창 잠금(flock) 전에. 끝낸 pid 목록. */
function staleHolds(o = {}) {
  const pg = o.pgrep ?? (() => { try { return execFileSync('pgrep', ['-f', '^gpu-window-hold '], { encoding: 'utf8' }); } catch (e) { if (e.status === 1) return ''; throw e; } });
  const ppidOf = o.ppidOf ?? (p => { try { const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8'); return Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]); } catch { return null; } });
  const cmdOf = o.cmdOf ?? (p => { const a = procArgv(p); return a ? a.join(' ') : null; });
  const kill = o.kill ?? (p => { try { process.kill(p, 'SIGTERM'); } catch { /* 없음 */ } });
  const out = [];
  for (const p of String(pg()).split('\n').map(Number).filter(n => n > 0)) {
    const pp = ppidOf(p), c = pp ? cmdOf(pp) : null;
    if (c && /gpu-window\.sh/.test(c)) continue;   // 살아 있는 창의 표지
    kill(p); out.push(p);
  }
  return out;
}

// ───── 시간 어림 — 잡마다 run-tsun 받아들임 규칙을 흉내(§180 검토 6: 대기 생성·덩어리마다 다시 컴파일·감시 시간 손실·REF 막힘 갈래) ─────
// 근거(분): 대기 생성 7.5~12 [measured, .harness/volsky-grain/out/c0.log atmosphere ms 449599~717781] · grain bytecheck 잡 30~60 s(390×584, 16 프레임) [measured] ·
// 첫 컴파일 0.8~1.2 [measured, compile*.log] · REF 단위 2~15 [estimate, design v2.1 §7] · 화소·품질 배율 [estimate].
const EST = {
  img: [0.4, 1.0], img_f1: [0.05, 0.2],
  t: [0.45, 1.2], t_f1: [0.1, 0.3], t_dbg: [0.2, 0.5], t_dbg_f1: [0.05, 0.2],
  ref: [2, 15], ref_f1: [0.2, 1.5], ref_dbg: [0.5, 3.75], ref_dbg_f1: [0.15, 1],
  ref100: [4, 30], ref100_f1: [0.4, 3], ref100_dbg: [1, 7.5], ref100_dbg_f1: [0.3, 2],
  cost: [0.3, 0.7],
};
const ATMOS_MIN = [7.5, 12];            // [measured] 페이지마다 대기 생성
const PAGE_START = [8, 12.5];           // 대기 생성 + 브라우저·번들 띄우기(검토 6: 예전 3~5 는 대기 생성을 빠뜨림)
const PAGE_END_MIN = 1;                 // 브라우저 닫기(≤ 60 s)·결과 합치기·node 시작
/** 잡 점검(gpuwin-check)·B0 결정이 덩어리 첫 잡 앞에 깔고 보는 지난 시간 = 대기 생성 위 끝(검토 2: 예전 점검은 0 으로 봐 REF100 멈춤을 놓침). */
const ATMOS_ADMIT_MIN = ATMOS_MIN[1];
const COMPILE = [1, 2.5];               // 새 프로그램 하나(low) — medium ×1.5 · high ×2, 페이지마다
const COMPILE_MUL = { low: 1, medium: 1.5, high: 2 };
const QUALITY_MUL = { low: 1, medium: 1.75, high: 3 };
/** REF 한 그리기 10 s × 16 프레임 = 2.67 분/단위 — 이보다 느리면 엄격한 문(GW_REF_GATE=strict)에서 막힘(가위 대체 경로 없음). */
const REF_DRAW_LIMIT_MS = 10000;
const REF_STRICT_MAX_UNIT_MIN = (REF_DRAW_LIMIT_MS * 16) / 60000;
/** REF 를 쓰는 파일과 문·배율 종류(gpu-window.sh STEPS 깃발과 같음). */
const REF_FILES = { 'b0-floor.json': 'ref', 'b0-floor-ref100.json': 'ref100', 'b2-ref.json': 'ref', 'b2-refval.json': 'ref' };
/** 조명·WP7 단계(lighting-render-check.js — 페이지 하나씩, --max-min 58). fn = entry-gpuwin 단계 · patch = 인자 덮어쓰기(§180 검토 4: 60 분을 넘을 수 있는 단계를 나눔).
 *  est = 대기 생성 뺀 분 [estimate: 400×300 low 1~2 s/프레임, 1000×750 low 6~12 s, high 18~37 s, high 컴파일 2~5 분]. */
const LIGHT_STAGES = {
  L1compile: { fn: 'L1compile', W: 400, H: 300, est: [10, 25] },
  'L2deck-low': { fn: 'L2deck', W: 1000, H: 750, est: [8, 18], patch: { qualities: ['low'], flags: ['off', 'logmu', 'on'] } },
  'L2deck-high': { fn: 'L2deck', W: 1000, H: 750, est: [14, 30], patch: { qualities: ['high'], flags: ['off', 'on'] } },
  L3twilight: { fn: 'L3twilight', W: 400, H: 300, est: [10, 20] },
  L4sunset: { fn: 'L4sunset', W: 400, H: 300, est: [5, 12] },
  'L5cross12-low': { fn: 'L5cross12', W: 400, H: 300, est: [10, 22], patch: { qualities: ['low'] } },
  'L5cross12-medium': { fn: 'L5cross12', W: 400, H: 300, est: [16, 35], patch: { qualities: ['medium'] } },
  'L6frametime-a': { fn: 'L6frametime', W: 400, H: 300, est: [15, 33], patch: { order: ['off', 'clamp', 'logmu', 'on', 'on', 'logmu', 'clamp', 'off'], warm: 4, timed: 12 } },
  'L6frametime-b': { fn: 'L6frametime', W: 400, H: 300, est: [15, 33], patch: { order: ['off', 'clamp', 'logmu', 'on', 'on', 'logmu', 'clamp', 'off'], warm: 4, timed: 12 } },
  W7atlas: { fn: 'W7atlas', W: 400, H: 300, est: [6, 15] },
};
const LIGHT_MAX_MIN = 58;               // 검토 4: 58 + 브라우저 닫기 ≤ 1 분 = 60 분 안

/** REF 계열 어림을 단위 분 m(REF)·m100(REF100)으로(진단 = ¼, 1 프레임 = 1/16 + 여유). */
function refTable(mLo, mHi, m100Lo = 2 * mLo, m100Hi = 2 * mHi) {
  const T = JSON.parse(JSON.stringify(EST));
  T.ref = [mLo, mHi]; T.ref_dbg = [mLo / 4, mHi / 4]; T.ref_f1 = [mLo / 16 + 0.1, mHi / 16 * 1.5 + 0.2]; T.ref_dbg_f1 = T.ref_f1.slice();
  T.ref100 = [m100Lo, m100Hi]; T.ref100_dbg = [m100Lo / 4, m100Hi / 4]; T.ref100_f1 = [m100Lo / 16 + 0.1, m100Hi / 16 * 1.5 + 0.2]; T.ref100_dbg_f1 = T.ref100_f1.slice();
  return T;
}
/** B0 결정(decisions.json)으로 REF 계열 어림을 잰 값으로(ref = m, ref100 = 잰 값 또는 2m). */
function estTable(decisions) {
  if (decisions && Number.isFinite(decisions.refUnitMin)) {
    const m = decisions.refUnitMin, m100 = Number.isFinite(decisions.ref100UnitMin) ? decisions.ref100UnitMin : 2 * m;
    return refTable(m, m * 1.25, m100, m100 * 1.25);
  }
  return JSON.parse(JSON.stringify(EST));
}
/**
 * 잡 파일 하나를 run-tsun 처럼 흉내: 덩어리마다 페이지 시작(대기 생성) → 잡마다 '지난 시간 + 감시 시간 ≤ 한도'면 시작 · 이 페이지에서 처음 보는
 * 프로그램 종류면 컴파일 · 걸린 시간 > 감시 시간이면 감시 시간에 걸림(그 잡은 잃고 덩어리 끝) · 끝난(잡 또는 감시) 수가 늘지 않은 덩어리 둘 → 멈춤(gpu-window.sh 규칙).
 * jobs = manifest 의 sim 목록(gpuwin-jobs.py: {n, k, c, q, W, H, g, wd, o}). side 0 = 낮음 · 1 = 높음.
 */
function simulateFile(jobs, { side, table, scale = 1, chunkMin = CHUNK_DEFAULT_MIN }) {
  const A = PAGE_START[side], comp = COMPILE[side];
  let todo = jobs.slice(), min = 0, chunks = 0, stall = 0, resolved = 0, done = 0;
  const lost = [];
  while (todo.length) {
    chunks++;
    let t = A, k = 0;
    const seen = new Set(), r0 = resolved;
    while (todo.length) {
      const j = todo[0];
      const wdMin = L.watchdogMs({ name: j.n, options: j.o || {}, watchdogMin: j.wd ?? undefined }, scale, { W: j.W, H: j.H, first: k === 0 }) / 60000;
      if (!L.startsWithinChunk(t, wdMin * 60000, chunkMin)) break;
      const e = table[j.k]; if (!e) throw new Error('estimate: unknown job kind ' + j.k);
      const q = j.q || 'low', px = j.g ? 1 : Math.max(1, (j.W * j.H) / (400 * 300));
      let d = e[side] * (QUALITY_MUL[q] || 1) * px;
      if (!seen.has(j.c)) { seen.add(j.c); d += comp * (COMPILE_MUL[q] || 1); }
      todo.shift(); k++; resolved++;
      if (d > wdMin) { t += wdMin; lost.push(j.n); break; }
      t += d; done++;
    }
    min += t + PAGE_END_MIN;
    if (resolved === r0) { if (++stall >= 2) return { chunks, min, done, lost, stalled: todo.length }; } else stall = 0;
  }
  return { chunks, min, done, lost, stalled: 0 };
}
/** 갈래 하나(REF 단위 분 m — 낮음·높음 쪽)의 B0 결정 흉내(decideFromUnits 와 같은 규칙). */
function branchDecision(m, gate, chunkMin) {
  const m100 = 2 * m;
  return decideFromUnits({ unitMin: m, drawMaxMs: (m * 60000) / 16 }, { unitMin: m100, drawMaxMs: (m100 * 60000) / 16 }, chunkMin, { gate });
}
/**
 * 전체 어림. decisions(B0 뒤)가 있으면 갈래 하나(잰 값), 없으면 갈래 셋 — strict: 'REF 막힘'(REF > 2.67 분/단위, 가장 그럴듯) · 'REF 통과'(≤ 2.67) ·
 * relax: REF 2~15 — 전체 낮음 = 갈래 낮음의 최소, 높음 = 갈래 높음의 최대(검토 6). manifest.files[*].sim 이 있어야 함(gpuwin-jobs.py).
 */
function estimateAll(manifest, decisions = null, chunkMin = CHUNK_DEFAULT_MIN, o = {}) {
  const gate = o.gate || (decisions && decisions.gate) || 'strict';
  const lightRows = Object.entries(LIGHT_STAGES).map(([k, s]) => ({ step: k, kind: 'page', chunks: [1, 1], total: [s.est[0] + PAGE_START[0] + PAGE_END_MIN, s.est[1] + PAGE_START[1] + PAGE_END_MIN] }));
  const branches = decisions ? [{ name: 'measured', m: [decisions.refUnitMin ?? 15, (decisions.refUnitMin ?? 15) * 1.25], dec: [decisions, decisions] }]
    : gate === 'relax' ? [{ name: 'relax (REF 2–15 min/unit runs)', m: [2, 15] }]
      : [{ name: `REF blocked (strict, REF > ${REF_STRICT_MAX_UNIT_MIN.toFixed(2)} min/unit — likely)`, m: [REF_STRICT_MAX_UNIT_MIN + 0.01, 15] },
        { name: `REF allowed (strict, REF ≤ ${REF_STRICT_MAX_UNIT_MIN.toFixed(2)} min/unit)`, m: [2, REF_STRICT_MAX_UNIT_MIN] }];
  const out = [];
  for (const br of branches) {
    const rows = lightRows.map(r => ({ ...r, total: r.total.slice() }));
    const decs = br.dec ?? [0, 1].map(sd => branchDecision(br.m[sd], gate, chunkMin));
    const tables = decisions ? [estTable(decisions), estTable(decisions)] : [0, 1].map(sd => refTable(br.m[sd], br.m[sd]));
    for (const [fn, info] of Object.entries(manifest.files)) {
      if (!info.n) continue;
      if (!Array.isArray(info.sim)) throw new Error(`estimate: manifest has no sim list for ${fn} — re-run gpuwin-jobs.py`);
      const rk = REF_FILES[fn], row = { step: fn, kind: 'run-tsun', total: [0, 0], chunks: [0, 0], lost: [0, 0], stalled: [0, 0], blocked: [false, false] };
      for (const sd of [0, 1]) {
        const d = decs[sd];
        // 표에는 [낮음, 높음] 쪽이 같은 갈래 값 — 시뮬은 side 로 고름
        const tbl = tables[sd];
        if (rk && (rk === 'ref100' ? d.ref100Blocked : d.refBlocked)) { row.blocked[sd] = true; continue; }
        const scale = rk === 'ref100' ? (d.ref100WatchdogScale ?? 1) : rk ? (d.watchdogScale ?? 1) : 1;
        const r = simulateFile(info.sim, { side: sd, table: tbl, scale, chunkMin });
        row.total[sd] = r.min; row.chunks[sd] = r.chunks; row.lost[sd] = r.lost.length; row.stalled[sd] = r.stalled;
      }
      if (row.blocked[0] && row.blocked[1]) row.kind = 'blocked';
      rows.push(row);
    }
    const sum = rows.reduce((a, r) => [a[0] + r.total[0], a[1] + r.total[1]], [0, 0]);
    const ch = rows.reduce((a, r) => [a[0] + r.chunks[0], a[1] + r.chunks[1]], [0, 0]);
    out.push({ name: br.name, refUnitMin: br.m, rows, totalMin: sum, totalH: sum.map(x => x / 60), pages: ch,
      lost: rows.reduce((a, r) => a + (r.lost ? r.lost[1] : 0), 0), stalledFiles: rows.filter(r => r.stalled && (r.stalled[0] || r.stalled[1])).map(r => r.step) });
  }
  const totalMin = [Math.min(...out.map(b => b.totalMin[0])), Math.max(...out.map(b => b.totalMin[1]))];
  const pages = [Math.min(...out.map(b => b.pages[0])), Math.max(...out.map(b => b.pages[1]))];
  const items14 = out.map(b => b.rows.filter(r => !/^b2-/.test(r.step)).reduce((a, r) => [a[0] + r.total[0], a[1] + r.total[1]], [0, 0]));
  return { gate, chunkMin, refMeasured: !!decisions, branches: out, rows: out[0].rows, totalMin, totalH: totalMin.map(x => x / 60), chunks: pages,
    items1to4Min: [Math.min(...items14.map(x => x[0])), Math.max(...items14.map(x => x[1]))],
    model: { pageStartMin: PAGE_START, atmosMin: ATMOS_MIN, pageEndMin: PAGE_END_MIN, compileMin: COMPILE, qualityMul: QUALITY_MUL, refStrictMaxUnitMin: +REF_STRICT_MAX_UNIT_MIN.toFixed(3) } };
}

// ───── 표지 ─────
function inputSha(files) {
  const h = crypto.createHash('sha256');
  for (const f of files) { h.update(path.basename(f) + '\0'); h.update(fs.existsSync(f) ? fs.readFileSync(f) : Buffer.from('<missing>')); h.update('\0'); }
  return h.digest('hex');
}
function readMarker(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
/**
 * 건너뛸지: done(또는 done-failures — 잡 실패는 post 가 판단)·blocked 이고 같은 입력. §180 검토 2·4: timeout(조명 단계 60 분)·stalled(덩어리 둘이 진전 없음)도
 * 같은 입력이면 다시 돌려도 같은 손실이라 건너뜀 — 다시 하려면 GW_RETRY_FAILED=1(retry) · GW_RETRY_WATCHDOG=1 은 done-failures 를 다시(retryWatchdog).
 */
function markerMatches(m, sha, o = {}) {
  if (!m || m.inputSha !== sha) return false;
  if (m.status === 'done' || m.status === 'blocked') return true;
  if (m.status === 'done-failures') return !o.retryWatchdog;
  if (m.status === 'timeout' || m.status === 'stalled') return !o.retry;
  return false;
}
function writeMarker(f, m) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify({ ...m, writtenAt: new Date().toISOString() }, null, 1)); fs.renameSync(f + '.tmp', f);
}
/**
 * run-tsun 출력 폴더에서 '정리된' 잡 수 — captureOk 인 <잡>.meta.json + 감시 시간에 걸려 다음 덩어리가 건너뛰는 <잡>.watchdog.txt(§180 검토 3: 첫 잡이
 * 감시 시간에 걸린 덩어리도 진전 — 예전에는 진전 없음으로 세어 둘이면 '멈춤').
 */
function countDone(dir, jobs) {
  let n = 0;
  for (const j of jobs) {
    let ok = false;
    try { const m = JSON.parse(fs.readFileSync(path.join(dir, j.name + '.meta.json'), 'utf8')); ok = m.captureOk === true; } catch { /* 없음 */ }
    if (ok || fs.existsSync(path.join(dir, j.name + '.watchdog.txt'))) n++;
  }
  return n;
}
/** 잡 이름 — 같은 폴더 manifest.json 의 sim 목록이 있으면 그것(130 MB 잡 파일을 덩어리마다 parse 하지 않게), 없으면 잡 파일. */
function jobNames(file) {
  try { const man = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'manifest.json'), 'utf8')); const e = man.files[path.basename(file)]; if (e && Array.isArray(e.sim) && e.sha256 === sha256File(file)) return e.sim.map(j => ({ name: j.n })); } catch { /* 아래 */ }
  return JSON.parse(fs.readFileSync(file, 'utf8')).map(j => ({ name: j.name }));
}
function sha256File(f) { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); }

// ───── B0 결정 ─────
/** B0 시간 잡 meta → 단위 시간. 프레임 0 은 첫 컴파일이 들어가 그리기 시간에서 뺌(페이지 첫 잡). */
function unitOfMeta(m) {
  if (!m || !m.frameMs || !Array.isArray(m.frameMs.all) || m.frameMs.all.length < 2) return null;
  const all = m.frameMs.all.map(Number), rest = all.slice(1), frames = all.length;
  const drawMax = Math.max(...rest), sumRest = rest.reduce((a, b) => a + b, 0);
  return { frames, frame0Ms: all[0], drawMaxMs: drawMax, unitMin: (sumRest * frames / rest.length) / 60000, wallMin: (m.wallMsOuter ?? m.wallMs ?? NaN) / 60000 };
}
/** 잡 파일의 REF·REF100 명시 감시 시간(gpuwin-jobs.py) — 배율 기준. */
const REF_WD_MIN = 25, REF100_WD_MIN = 30;
/**
 * B0 결정(단위 시간에서). §180 검토 2·3·7:
 *  - 감시 시간 배율 ≥ 1(잰 REF 가 빨라도 기본 25·8·30·16 분을 줄이지 않음 — 줄이면 컴파일 여유가 사라져 잡을 잃음), ≤ 2.
 *    REF 파일(b0-floor·b2-ref·b2-refval) = max(1, 1.6 × REF 단위 / 25) · REF100 파일(b0-floor-ref100) = max(1, 1.6 × REF100 단위 / 30)(따로).
 *  - 들어감: 감시 시간 × 배율 + 첫 잡 5 분 + 대기 생성 12 분 ≤ 덩어리(예전에는 대기 생성을 빼서 REF100 이 멈춤).
 *  - 문(gate): strict(기본, ruler-delta B2) = 한 그리기 > 10 s 면 그 팔 막힘(가위 타일 대체 경로 구현 안 됨) — REF 와 REF100 을 따로 봄.
 *    relax(GW_REF_GATE=relax, 사용자 결정 때만) = 막지 않고 그리기 시간만 적음(맥락 손실 = 잡 실패, run-tsun rc 6 이 기록).
 *  - REF100 이 B0 시간에서 30 분 감시 시간에 걸렸으면(o.ref100WatchdogHit) REF100 = 30 분/단위 넘음 → 한 그리기 > 10 s · REF100 막힘.
 */
function decideFromUnits(r, r100, chunkMin = CHUNK_DEFAULT_MIN, o = {}) {
  const gate = o.gate === 'relax' ? 'relax' : 'strict';
  const atmos = o.atmosMin ?? ATMOS_ADMIT_MIN, first = L.FIRST_JOB_EXTRA_MIN;
  const out = { gate, ref: r, ref100: r100, refUnitMin: r ? r.unitMin : null, ref100UnitMin: r100 ? r100.unitMin : null, chunkMin, admitOverheadMin: first + atmos, reasons: [] };
  if (!r) {
    out.refBlocked = true; out.ref100Blocked = true; out.scissorNeeded = null;
    out.reasons.push(o.refWatchdogHit ? 'REF hit its watchdog in the B0 timing step (> 25+5 min/unit)' : 'no REF timing meta (B0 time step failed)');
    return out;
  }
  const refSlow = r.drawMaxMs > REF_DRAW_LIMIT_MS;
  const r100Slow = r100 ? r100.drawMaxMs > REF_DRAW_LIMIT_MS : !!o.ref100WatchdogHit;
  out.scissorNeeded = refSlow || r100Slow;
  const clamp = x => Math.min(2, Math.max(1, x));
  const m100 = r100 ? r100.unitMin : 2 * r.unitMin;   // REF100 meta 가 없으면 2 × REF 로 어림
  out.watchdogScale = +clamp(1.6 * r.unitMin / REF_WD_MIN).toFixed(3);
  out.ref100WatchdogScale = +clamp(1.6 * m100 / REF100_WD_MIN).toFixed(3);
  out.refWatchdogMin = REF_WD_MIN * out.watchdogScale; out.ref100WatchdogMin = REF100_WD_MIN * out.ref100WatchdogScale;
  out.refBlocked = false; out.ref100Blocked = false;
  if (refSlow) {
    if (gate === 'strict') { out.refBlocked = true; out.reasons.push(`REF draw ${Math.round(r.drawMaxMs)} ms > 10 s — scissor-tiled REF fallback needed (not implemented, entry-tsun 하네스 17)`); }
    else out.reasons.push(`REF draw ${Math.round(r.drawMaxMs)} ms > 10 s but GW_REF_GATE=relax — REF runs; per-draw time recorded, context loss = job failure`);
  }
  if (o.ref100WatchdogHit && !r100) { out.ref100Blocked = true; out.reasons.push(`REF100 hit its ${REF100_WD_MIN}-min watchdog in the B0 timing step — REF100 > ${REF100_WD_MIN} min/unit`); }
  else if (r100Slow) {
    if (gate === 'strict') { out.ref100Blocked = true; out.reasons.push(`REF100 draw ${Math.round(r100.drawMaxMs)} ms > 10 s — scissor fallback needed (not implemented)`); }
    else out.reasons.push(`REF100 draw ${Math.round(r100.drawMaxMs)} ms > 10 s but GW_REF_GATE=relax — REF100 runs`);
  }
  if (out.refWatchdogMin + first + atmos > chunkMin) { out.refBlocked = true; out.reasons.push(`REF watchdog ${out.refWatchdogMin.toFixed(1)} + first-job ${first} + atmosphere ${atmos} > chunk ${chunkMin} min`); }
  if (out.ref100WatchdogMin + first + atmos > chunkMin) { out.ref100Blocked = true; out.reasons.push(`REF100 watchdog ${out.ref100WatchdogMin.toFixed(1)} + first-job ${first} + atmosphere ${atmos} > chunk ${chunkMin} min`); }
  if (out.refBlocked) out.ref100Blocked = true;   // REF100 짝(Floor_T 'REF100 vs REF')은 REF 가 있어야 뜻이 있음
  return out;
}
/** B0 시간 meta 둘 → 결정(decideFromUnits). o: {gate, ref100WatchdogHit, refWatchdogHit}. */
function decideB0(refMeta, ref100Meta, chunkMin = CHUNK_DEFAULT_MIN, o = {}) {
  return decideFromUnits(unitOfMeta(refMeta), unitOfMeta(ref100Meta), chunkMin, o);
}

// ───── 박명 출렁임 ─────
/** 가중 없는 국소 2차 맞춤 잔차(ln Y). series = [{e, Y}](e = 해 고도 °). halfWin 안 점이 5 개 미만이면 null. */
function quadResiduals(series, halfWin = 1.5) {
  const s = series.filter(p => Number.isFinite(p.Y) && p.Y > 0).slice().sort((a, b) => a.e - b.e);
  return s.map(p => {
    const nb = s.filter(q => Math.abs(q.e - p.e) <= halfWin);
    if (nb.length < 5) return { e: p.e, r: null };
    // 최소제곱 [1, x, x²] (x = e − e0)
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
    for (const q of nb) { const x = q.e - p.e, b = [1, x, x * x], y = Math.log(q.Y); for (let i = 0; i < 3; i++) { v[i] += b[i] * y; for (let j = 0; j < 3; j++) M[i][j] += b[i] * b[j]; } }
    const c = solve3(M, v);
    return { e: p.e, r: c ? Math.log(p.Y) - c[0] : null };
  });
}
function solve3(A, b) {
  const m = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i; for (let k = i + 1; k < 3; k++) if (Math.abs(m[k][i]) > Math.abs(m[p][i])) p = k;
    if (Math.abs(m[p][i]) < 1e-300) return null;
    [m[i], m[p]] = [m[p], m[i]];
    for (let k = 0; k < 3; k++) if (k !== i) { const f = m[k][i] / m[i][i]; for (let j = i; j < 4; j++) m[k][j] -= f * m[i][j]; }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}
/** 띠별 출렁임: rms·봉우리 간격(p2p) of 잔차 ln Y, 이웃 걸음 사이 최대 |Δr|. bands = [[lo, hi], …]. */
function pulsing(series, bands, halfWin = 1.5) {
  const res = quadResiduals(series, halfWin);
  return bands.map(([lo, hi]) => {
    const r = res.filter(p => p.e >= lo && p.e <= hi && p.r != null);
    if (r.length < 3) return { band: [lo, hi], n: r.length, rms: null, p2p: null, maxStep: null };
    const rms = Math.sqrt(r.reduce((a, p) => a + p.r * p.r, 0) / r.length);
    const p2p = Math.max(...r.map(p => p.r)) - Math.min(...r.map(p => p.r));
    let maxStep = 0; for (let i = 1; i < r.length; i++) maxStep = Math.max(maxStep, Math.abs(r[i].r - r[i - 1].r));
    return { band: [lo, hi], n: r.length, rms, p2p, maxStep, p2pRatio: Math.exp(p2p) };
  });
}

// ───── 출력 경로 ─────
const FROZEN_TSUN = ['RULER-tsun.md', 'tsun_photo.py', 'tsun-photo.json', 'tsun-geo.json', 'scenes-tsun.json', 'sun-tsun.cjs', 'sun-tsun.json', 'make-jobs-tsun.py', 'tsun-baseline.json', 'tsun-test.py']
  .map(f => path.join(REPO, 'tools/genus-ruler/tsun', f));
/** 있는 가장 긴 앞부분을 realpath 로 풀고 나머지를 붙임(§180 검토 13: GW_ROOT 아래 심볼릭 링크로 .harness/ 에 쓰지 않게). */
function realish(p) {
  let a = path.resolve(p);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync(a), ...rest.reverse()); } catch { /* 없음 */ }
    const d = path.dirname(a); if (d === a) return path.join(a, ...rest.reverse());
    rest.push(path.basename(a)); a = d;
  }
}
/** 쓰기 금지 경로면 이유, 괜찮으면 null. 글자 경로와 풀린 경로 둘 다 봄. */
function forbiddenPath(p) { return forbiddenPath1(path.resolve(p)) || forbiddenPath1(realish(p)); }
function forbiddenPath1(a) {
  const inside = d => a === d || a.startsWith(d + path.sep);
  if (inside(path.join(REPO, '.harness'))) return '.harness/ (RULER-grain·volsky 번들·출력)';
  if (inside(path.join(REPO, 'tools/genus-ruler/grain'))) return 'tools/genus-ruler/grain/ (RULER-grain 동결)';
  if (inside(path.join(REPO, 'tools/genus-ruler/volsky'))) return 'tools/genus-ruler/volsky/ (동결 entry·capture)';
  if (FROZEN_TSUN.includes(a)) return 'RULER-tsun 동결 후보 파일';
  if (inside(path.join(REPO, 'src'))) return 'src/ (앱 소스)';
  return null;
}

module.exports = { HOLD_NAME, CHUNK_MAX_MIN, CHUNK_DEFAULT_MIN, EST, PAGE_START, ATMOS_MIN, ATMOS_ADMIT_MIN, PAGE_END_MIN, LIGHT_STAGES, LIGHT_MAX_MIN, REF_FILES, REF_STRICT_MAX_UNIT_MIN,
  scriptOf, classifyArgv, guardConflicts, pgrepAf, guardOnce, grainAncestors, staleTsunLock, staleHolds,
  refTable, estTable, simulateFile, estimateAll, inputSha, readMarker, markerMatches, writeMarker, countDone, jobNames,
  unitOfMeta, decideFromUnits, decideB0, quadResiduals, pulsing, forbiddenPath, FROZEN_TSUN };

// ───── 명령 줄 ─────
if (require.main === module) {
  const argv = process.argv.slice(2), cmd = argv[0];
  const get = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
  const all = k => argv.reduce((a, x, i) => (x === k && i + 1 < argv.length ? [...a, argv[i + 1]] : a), []);
  const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const writeAtomic = (f, text) => { fs.writeFileSync(f + '.tmp', text); fs.renameSync(f + '.tmp', f); };
  try {
    if (cmd === 'guard') {
      const exclude = all('--exclude-pid').map(Number).filter(n => n > 0);
      const wait = argv.includes('--wait');
      const maxWaitMin = Number(get('--max-wait-min', '720')), pollS = Number(get('--poll-s', '60')), stable = Number(get('--stable', '1'));
      if (!(maxWaitMin >= 0) || !(pollS > 0) || !(Number.isInteger(stable) && stable >= 1)) { console.error('guard: bad --max-wait-min/--poll-s/--stable'); process.exit(2); }
      const t0 = Date.now();
      let n = 0, clear = 0;
      for (;;) {
        const c = guardOnce(exclude);
        // --stable k: k 번 연달아 비어야 끝(이어 부르는 grain 명령 사이 틈을 '빔'으로 읽지 않게) — --once 는 한 번만 봄
        if (!c.length && (!wait || ++clear >= stable)) { console.log(`guard: clear${n ? ` after ${((Date.now() - t0) / 60000).toFixed(1)} min` : ''}${wait ? ` (stable ×${stable})` : ''}`); process.exit(0); }
        if (!c.length) { sleep(pollS * 1000); continue; }
        clear = 0;
        if (!wait) { console.log('guard: busy\n' + c.map(p => `  ${p.pid} [${p.why}] ${p.cmd.slice(0, 160)}`).join('\n')); process.exit(10); }
        if ((Date.now() - t0) / 60000 >= maxWaitMin) { console.log(`guard: still busy after ${maxWaitMin} min — giving up\n` + c.map(p => `  ${p.pid} [${p.why}] ${p.cmd.slice(0, 160)}`).join('\n')); process.exit(75); }
        if (n++ % 10 === 0) console.log(`guard: waiting (${new Date().toISOString()}) for ${c.length} process(es): ${c.map(p => p.pid + ' [' + p.why + '] ' + p.cmd.slice(0, 80)).join(' | ')}`);
        sleep(pollS * 1000);
      }
    } else if (cmd === 'ancestors-ok') {
      // §180 검토 1·9: 조상 명령 줄에 grain 무늬 → 모든 자식이 거부할 것 — 종료 2
      const bad = grainAncestors(Number(get('--pid', String(process.ppid))));
      if (bad.length) { console.error('gpu-window: an ancestor process command line matches the RULER-grain pattern, so every run-tsun/lighting child would refuse:\n' + bad.map(p => `  ${p.pid} ${p.cmd.slice(0, 160)}`).join('\n') + '\nLaunch the window standalone: setsid nohup tools/genus-ruler/tsun/gpu-window.sh run > <log> 2>&1 < /dev/null &'); process.exit(2); }
    } else if (cmd === 'lock-clean') {
      const why = staleTsunLock(get('--lock'));
      console.log(why ? `lock-clean: removed ${get('--lock')} — ${why}` : `lock-clean: ${get('--lock')} absent or held by a live tsun chunk`);
    } else if (cmd === 'hold-clean') {
      const k = staleHolds();
      if (k.length) console.log('hold-clean: stopped stale gpu-window-hold marker(s) ' + k.join(' '));
    } else if (cmd === 'estimate') {
      const man = JSON.parse(fs.readFileSync(get('--manifest'), 'utf8'));
      const dec = get('--decisions') && fs.existsSync(get('--decisions')) ? JSON.parse(fs.readFileSync(get('--decisions'), 'utf8')) : null;
      const e = estimateAll(man, dec, Number(get('--chunk-min', String(CHUNK_DEFAULT_MIN))), { gate: get('--ref-gate') || undefined });
      const f = x => x.toFixed(0);
      console.log(`time estimate (machine min; per page: atmosphere ${ATMOS_MIN.join('–')} min + start, close ${PAGE_END_MIN} min; chunks ≤ ${e.chunkMin} min; REF gate ${e.gate})`);
      for (const b of e.branches) {
        console.log(`  branch: ${b.name}  →  ${b.totalMin.map(f).join('–')} min = ${b.totalH.map(x => x.toFixed(1)).join('–')} h, ${b.pages.join('–')} pages${b.lost ? `, ${b.lost} job(s) lost to watchdogs (high side)` : ''}${b.stalledFiles.length ? `, STALLED ${b.stalledFiles.join(' ')}` : ''}`);
        for (const r of b.rows) console.log(`    ${r.step.padEnd(22)} ${String(r.chunks.join('–')).padStart(7)} pages   ${r.kind === 'blocked' ? 'blocked' : r.total.map(f).join('–') + ' min'}${r.blocked && (r.blocked[0] || r.blocked[1]) && r.kind !== 'blocked' ? ' (blocked on one side)' : ''}${r.lost && r.lost[1] ? ` lost ${r.lost[1]}` : ''}${r.stalled && r.stalled[1] ? ` STALLED ${r.stalled[1]}` : ''}`);
      }
      console.log(`TOTAL ${e.totalMin.map(f).join('–')} min = ${e.totalH.map(x => x.toFixed(1)).join('–')} h (${e.chunks.join('–')} pages; items 1–4 alone ${e.items1to4Min.map(x => (x / 60).toFixed(1)).join('–')} h)`);
      if (get('--json')) writeAtomic(get('--json'), JSON.stringify(e, null, 1));
    } else if (cmd === 'input-sha') {
      console.log(inputSha(argv.slice(1)));
    } else if (cmd === 'marker-ok') {
      process.exit(markerMatches(readMarker(get('--marker')), get('--input-sha'), { retry: argv.includes('--retry'), retryWatchdog: argv.includes('--retry-watchdog') }) ? 0 : 1);
    } else if (cmd === 'marker-write') {
      const extra = get('--extra') ? JSON.parse(get('--extra')) : {};
      writeMarker(get('--marker'), { id: get('--id'), status: get('--status'), inputSha: get('--input-sha'), rc: get('--rc') != null ? Number(get('--rc')) : null,
        startedAt: get('--started'), chunks: get('--chunks') != null ? Number(get('--chunks')) : null, note: get('--note'), ...extra });
    } else if (cmd === 'marker-status') {
      const m = readMarker(get('--marker')); console.log(m && m.inputSha === get('--input-sha') ? m.status : '');
    } else if (cmd === 'any-rendered') {
      // 이 OUT 에서 렌더가 시작된 단계 표지가 있는지(번들 고정 판단 — §180 검토 8)
      const d = get('--dir'); let n = 0;
      try { for (const f of fs.readdirSync(d).filter(x => x.endsWith('.json'))) { const m = readMarker(path.join(d, f)); if (m && !['blocked', 'refused'].includes(m.status) && m.id !== 'B0decide') n++; } } catch { /* 없음 */ }
      process.exit(n ? 0 : 1);
    } else if (cmd === 'count-done') {
      console.log(countDone(get('--dir'), jobNames(get('--jobs'))));
    } else if (cmd === 'decide-b0') {
      const d = get('--dir'), rd = f => { try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch { return null; } };
      const ex = f => fs.existsSync(path.join(d, f));
      const okMeta = m => (m && m.captureOk === true ? m : null);
      const out = decideB0(okMeta(rd('REF__RA1_s1.1_V1.meta.json')), okMeta(rd('REF100__RA1_s1.1_V1.meta.json')), Number(get('--chunk-min', String(CHUNK_DEFAULT_MIN))),
        { gate: get('--ref-gate', 'strict'), refWatchdogHit: ex('REF__RA1_s1.1_V1.watchdog.txt'), ref100WatchdogHit: ex('REF100__RA1_s1.1_V1.watchdog.txt') });
      // §180 검토 10: 결정이 같으면 파일을 다시 쓰지 않음(decidedAt 이 바뀌어 REF 단계 입력 sha 가 바뀌지 않게) · 임시 파일 + 이름 바꾸기
      const f = get('--out'), prev = (() => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } })();
      const strip = o => { const { decidedAt, ...rest } = o || {}; return JSON.stringify(rest); };
      if (!prev || strip(prev) !== strip(JSON.parse(JSON.stringify(out)))) writeAtomic(f, JSON.stringify({ ...out, decidedAt: new Date().toISOString() }, null, 1));
      console.log(JSON.stringify(out));
    } else if (cmd === 'paths-ok') {
      const bad = argv.slice(1).map(p => [p, forbiddenPath(p)]).filter(x => x[1]);
      if (bad.length) { console.error('forbidden output path(s):\n' + bad.map(([p, w]) => `  ${p} — ${w}`).join('\n')); process.exit(2); }
    } else {
      console.error('usage: gpuwin-lib.js guard|ancestors-ok|lock-clean|hold-clean|estimate|input-sha|marker-ok|marker-write|marker-status|any-rendered|count-done|decide-b0|paths-ok …'); process.exit(2);
    }
  } catch (e) { console.error('gpuwin-lib: ' + (e && e.message || e)); process.exit(2); }
}
