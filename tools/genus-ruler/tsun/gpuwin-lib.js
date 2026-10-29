/**
 * §180 GPU 창(gpu-window.sh)의 순수 함수 + 작은 명령 줄 — 브라우저·Playwright 없음. gpuwin-test.js 가 node 에서 시험합니다.
 *
 *  - 지킴(guard): RULER-grain 과정(run-tsun-lib GRAIN_PATTERN)·주인 없는 SwiftShader GPU 과정이 없을 때까지 기다림/한 번 봄.
 *    pgrep 은 GW_PGREP(가짜 pgrep 시험용)로 바꿀 수 있음. 자기·조상·--exclude-pid(창 표지 과정)는 뺌.
 *  - 시간 어림(estimate): manifest.json(gpuwin-jobs.py)의 잡 종류별 수 × 종류별 분(낮음·높음) + 페이지 시작·프로그램 컴파일 + 덩어리 나눔.
 *    B0 시간 결정(decisions.json)이 있으면 REF 계열을 잰 값으로 바꿔 다시 어림.
 *  - 표지(marker): 단계마다 <OUT>/steps/<id>.json — status·inputSha. 같은 inputSha 의 done 이면 건너뜀(이어 돌리기).
 *  - B0 결정(decide-b0): REF 한 그리기(프레임 0 = 컴파일 뺌) > 10 s → 가위 타일 대체 경로 필요(구현 안 됨 → B2 REF 막힘),
 *    감시 시간 배율 = 1.6 × 잰 REF 단위 시간 / 25 분(ruler-delta B2 '1.6 × measured unit time'), REF100 이 60 분 덩어리에 들어가는지.
 *  - 박명 출렁임(pulsing): 시간 이동 계열 ln Y 에서 국소 2차 맞춤을 빼고 남은 것의 띠별 rms·봉우리 간격 — irradianceLogMu 켬/끔 비교.
 *  - 출력 경로 점검(paths-ok): .harness/ · tools/genus-ruler/grain/ · 동결 후보 tsun 파일 아래에는 쓰지 않음.
 *
 *   node gpuwin-lib.js guard --once|--wait [--max-wait-min N] [--poll-s S] [--stable K] [--exclude-pid P]
 *       종료 0 = 비었음 · 10 = 돌고 있음(--once) · 75 = 기다림 한도 · 2 = pgrep 오류(닫힌 쪽)
 *   node gpuwin-lib.js estimate --manifest M [--decisions D] [--chunk-min 55] [--json OUT]
 *   node gpuwin-lib.js input-sha FILE...                       → sha256(파일 이름 + 내용 …)
 *   node gpuwin-lib.js marker-ok --marker F --input-sha S      → 종료 0 = done 이고 같은 입력(건너뜀) · 1 = 아님
 *   node gpuwin-lib.js marker-write --marker F --id ID --status S --input-sha S [--rc N] [--started ISO] [--chunks N] [--note T]
 *   node gpuwin-lib.js count-done --dir D --jobs F             → 잡 파일 중 <잡>.meta.json(captureOk) 이 있는 수(덩어리 진전 판단)
 *   node gpuwin-lib.js decide-b0 --dir D --out F [--chunk-min 55]
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
/**
 * pgrep -af 출력에서 창과 겹치면 안 되는 과정. 자기·조상(명령 줄과 무관 — 이 지킴은 창 실행기 쪽에서만 부름)·exclude(창 표지)는 뺌.
 * @param {string} grainOut pgrep -af GRAIN_PATTERN @param {string} gpuOut pgrep -af SWIFTSHADER_GPU_PATTERN @param {number[]} exclude
 */
function guardConflicts(grainOut, gpuOut, exclude) {
  const ex = new Set(exclude.map(Number));
  const parse = s => String(s || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/^(\d+)\s+(.*)$/); return m ? { pid: Number(m[1]), cmd: m[2] } : null; }).filter(Boolean);
  const g = parse(grainOut).filter(p => !ex.has(p.pid) && !p.cmd.startsWith('gpu-window-hold')).map(p => ({ ...p, why: 'RULER-grain' }));
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
  return guardConflicts(pgrepAf(L.GRAIN_PATTERN, env), pgrepAf(L.SWIFTSHADER_GPU_PATTERN, env), [...anc, ...exclude]);
}

// ───── 시간 어림(분, [낮음, 높음]) — 400×300 low 기준(cost 는 390×584 기준). 근거: grain bytecheck 잡 30~60 s(390×584, 16 프레임) [measured],
// 대기 표 1.5~3.2 분·첫 컴파일 0.8~1.2 분 [measured, compile*.log], REF 단위 2~15 분 [estimate, design v2.1 §7]. ─────
const EST = {
  img: [0.4, 1.0], img_f1: [0.05, 0.2],
  t: [0.45, 1.2], t_f1: [0.1, 0.3], t_dbg: [0.2, 0.5], t_dbg_f1: [0.05, 0.2],
  ref: [2, 15], ref_f1: [0.2, 1.5], ref_dbg: [0.5, 3.75], ref_dbg_f1: [0.15, 1],
  ref100: [4, 30], ref100_f1: [0.4, 3], ref100_dbg: [1, 7.5], ref100_dbg_f1: [0.3, 2],
  cost: [0.3, 0.7],
};
const PAGE_START = [3, 5];              // 대기 표 + 첫 프로그램
const COMPILE = [1, 2.5];               // 새 프로그램 하나(low) — medium ×1.5 · high ×2
const QUALITY_MUL = { low: 1, medium: 1.75, high: 3 };
/** 파일마다 새 프로그램 수 어림(팔 글자 종류) — manifest 의 kinds 로는 모자라 잡 파일을 직접 볼 때만(estimateFile 의 programs). */
const PROGRAMS_DEFAULT = { 'b1-low.json': 12, 'b1-medium.json': 12, 'b1-high.json': 12, 'b1-refuse.json': 0, 'b1-det.json': 1, 'w7-emu.json': 1, 'b0-time.json': 2,
  'b0-cost.json': 5, 'b0-costaa-1.json': 1, 'b0-costaa-2.json': 1, 'b0-floor.json': 5, 'b2-t.json': 3, 'b2-ref.json': 2, 'b2-refval.json': 2 };
/** 조명·WP7 단계(lighting-render-check.js — 페이지 하나씩, 각 ≤ 60 분). 캔버스·어림(분). */
const LIGHT_STAGES = {
  L1compile: { W: 400, H: 300, est: [10, 25] },
  L2deck: { W: 1000, H: 750, est: [15, 45] },
  L3twilight: { W: 400, H: 300, est: [6, 20] },
  L4sunset: { W: 400, H: 300, est: [5, 15] },
  L5cross12: { W: 400, H: 300, est: [10, 30] },
  L6frametime: { W: 400, H: 300, est: [12, 35] },
  W7atlas: { W: 400, H: 300, est: [6, 15] },
};

/** B0 결정(decisions.json)으로 REF 계열 어림을 잰 값으로(ref = m, ref100 = 2m, 진단 = ¼). */
function estTable(decisions) {
  const T = JSON.parse(JSON.stringify(EST));
  if (decisions && Number.isFinite(decisions.refUnitMin)) {
    const m = decisions.refUnitMin, m100 = Number.isFinite(decisions.ref100UnitMin) ? decisions.ref100UnitMin : 2 * m;
    T.ref = [m, m * 1.25]; T.ref_dbg = [m / 4, m / 4 * 1.25]; T.ref_f1 = [m / 16 + 0.1, m / 16 * 1.5 + 0.2]; T.ref_dbg_f1 = [m / 16 + 0.1, m / 16 * 1.5 + 0.2];
    T.ref100 = [m100, m100 * 1.25]; T.ref100_dbg = [m100 / 4, m100 / 4 * 1.25]; T.ref100_f1 = [m100 / 16 + 0.1, m100 / 16 * 1.5 + 0.2]; T.ref100_dbg_f1 = T.ref100_f1;
  }
  return T;
}
/** 잡 파일 하나의 어림 — 렌더 분(종류 × 수 × 품질 배율 × 화소 배율) + 컴파일, 덩어리 수(덩어리마다 페이지 시작). */
function estimateFile(fn, info, table, chunkMin = CHUNK_DEFAULT_MIN) {
  const qm = QUALITY_MUL[info.quality || 'low'] || 1;
  const px = info.kinds && info.kinds.cost ? 1 : Math.max(1, (info.W * info.H) / (400 * 300));
  let lo = 0, hi = 0;
  for (const [k, n] of Object.entries(info.kinds || {})) { const e = table[k]; if (!e) throw new Error('estimate: unknown job kind ' + k); lo += n * e[0] * qm * px; hi += n * e[1] * qm * px; }
  const progs = PROGRAMS_DEFAULT[fn] ?? 2;
  const cm = info.quality === 'high' ? 2 : info.quality === 'medium' ? 1.5 : 1;
  lo += progs * COMPILE[0] * cm; hi += progs * COMPILE[1] * cm;
  const usable = Math.max(5, chunkMin - PAGE_START[1]);
  const chunks = [Math.max(1, Math.ceil(lo / usable)), Math.max(1, Math.ceil(hi / usable))];
  return { fn, render: [lo, hi], chunks, total: [lo + chunks[0] * PAGE_START[0], hi + chunks[1] * PAGE_START[1]] };
}
/** 전체 어림 — 단계 순서(gpu-window.sh STEPS 와 같은 열쇠). */
function estimateAll(manifest, decisions = null, chunkMin = CHUNK_DEFAULT_MIN) {
  const table = estTable(decisions);
  const rows = [];
  for (const [k, s] of Object.entries(LIGHT_STAGES)) rows.push({ step: k, kind: 'page', total: s.est.slice(), chunks: [1, 1] });
  for (const [fn, info] of Object.entries(manifest.files)) {
    if (!info.n) continue;
    if (decisions && decisions.refBlocked && /^b2-ref(val)?\.json$/.test(fn)) { rows.push({ step: fn, kind: 'blocked', total: [0, 0], chunks: [0, 0] }); continue; }
    const e = estimateFile(fn, info, table, chunkMin);
    rows.push({ step: fn, kind: 'run-tsun', total: e.total, chunks: e.chunks, render: e.render });
  }
  const sum = rows.reduce((a, r) => [a[0] + r.total[0], a[1] + r.total[1]], [0, 0]);
  const chunks = rows.reduce((a, r) => [a[0] + r.chunks[0], a[1] + r.chunks[1]], [0, 0]);
  return { rows, totalMin: sum, totalH: sum.map(x => x / 60), chunks, chunkMin, refMeasured: !!(decisions && Number.isFinite(decisions.refUnitMin)) };
}

// ───── 표지 ─────
function inputSha(files) {
  const h = crypto.createHash('sha256');
  for (const f of files) { h.update(path.basename(f) + '\0'); h.update(fs.existsSync(f) ? fs.readFileSync(f) : Buffer.from('<missing>')); h.update('\0'); }
  return h.digest('hex');
}
function readMarker(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
/** 건너뛸지: done(또는 done-failures — 잡 실패는 post 가 판단, 다시 돌리려면 표지를 지움)이고 같은 입력. */
function markerMatches(m, sha) { return !!m && (m.status === 'done' || m.status === 'done-failures' || m.status === 'blocked') && m.inputSha === sha; }
function writeMarker(f, m) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify({ ...m, writtenAt: new Date().toISOString() }, null, 1)); fs.renameSync(f + '.tmp', f);
}
/** run-tsun 출력 폴더에서 끝난 잡 수(captureOk 인 <잡>.meta.json) — 덩어리 진전(멈춤) 판단. */
function countDone(dir, jobs) {
  let n = 0;
  for (const j of jobs) { try { const m = JSON.parse(fs.readFileSync(path.join(dir, j.name + '.meta.json'), 'utf8')); if (m.captureOk === true) n++; } catch { /* 없음 */ } }
  return n;
}
/** 잡 이름만 빠르게(큰 잡 파일 — 고리가 든 130 MB — 전체를 객체로 만들지 않으려 했으나 JSON 구조가 단순해 그냥 parse). */
function jobNames(file) { return JSON.parse(fs.readFileSync(file, 'utf8')).map(j => ({ name: j.name })); }

// ───── B0 결정 ─────
/**
 * B0 시간 잡 meta(REF·REF100 한 단위) → 결정. 프레임 0 은 첫 컴파일이 들어가 그리기 시간에서 뺌(페이지 첫 잡).
 * scissorNeeded = REF 한 그리기 > 10 s(ruler-delta B2 대체 경로 조건 — entry-tsun 에 구현 안 됨 → B2 REF 막힘).
 * 감시 시간 배율 = max(1.6 × REF 단위 분 / 25, 1.6 × REF100 단위 분 / 50), [0.1, 2] 로 자름. REF100 감시 시간(50 × 배율) + 첫 잡 여유 5 분이
 * 덩어리 한도를 넘으면 REF100 은 이 덩어리 크기로 못 돎(ref100Blocked).
 */
function decideB0(refMeta, ref100Meta, chunkMin = CHUNK_DEFAULT_MIN) {
  const unit = m => {
    if (!m || !m.frameMs || !Array.isArray(m.frameMs.all) || m.frameMs.all.length < 2) return null;
    const all = m.frameMs.all.map(Number), rest = all.slice(1), frames = all.length;
    const drawMax = Math.max(...rest), sumRest = rest.reduce((a, b) => a + b, 0);
    return { frames, frame0Ms: all[0], drawMaxMs: drawMax, unitMin: (sumRest * frames / rest.length) / 60000, wallMin: (m.wallMsOuter ?? m.wallMs ?? NaN) / 60000 };
  };
  const r = unit(refMeta), r100 = unit(ref100Meta);
  const out = { ref: r, ref100: r100, refUnitMin: r ? r.unitMin : null, ref100UnitMin: r100 ? r100.unitMin : null, chunkMin, reasons: [] };
  if (!r) { out.refBlocked = true; out.scissorNeeded = null; out.reasons.push('no REF timing meta (B0 time step failed)'); return out; }
  out.scissorNeeded = r.drawMaxMs > 10000 || (r100 ? r100.drawMaxMs > 10000 : false);
  let scale = Math.max(1.6 * r.unitMin / 25, r100 ? 1.6 * r100.unitMin / 50 : 0);
  scale = Math.min(2, Math.max(0.1, scale));
  out.watchdogScale = +scale.toFixed(3);
  out.refWatchdogMin = Math.max(2, 25 * scale); out.ref100WatchdogMin = Math.max(2, 50 * scale);
  out.refBlocked = false; out.ref100Blocked = false;
  if (out.scissorNeeded) { out.refBlocked = true; out.ref100Blocked = true; out.reasons.push(`REF draw ${Math.round(Math.max(r.drawMaxMs, r100 ? r100.drawMaxMs : 0))} ms > 10 s — scissor-tiled REF fallback needed (not implemented, entry-tsun 하네스 17)`); }
  if (out.refWatchdogMin + L.FIRST_JOB_EXTRA_MIN > chunkMin) { out.refBlocked = true; out.reasons.push(`REF watchdog ${out.refWatchdogMin.toFixed(1)} min + first-job ${L.FIRST_JOB_EXTRA_MIN} > chunk ${chunkMin} min`); }
  if (out.ref100WatchdogMin + L.FIRST_JOB_EXTRA_MIN > chunkMin) { out.ref100Blocked = true; out.reasons.push(`REF100 watchdog ${out.ref100WatchdogMin.toFixed(1)} min + first-job ${L.FIRST_JOB_EXTRA_MIN} > chunk ${chunkMin} min`); }
  return out;
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
/** 쓰기 금지 경로면 이유, 괜찮으면 null. */
function forbiddenPath(p) {
  const a = path.resolve(p);
  const inside = d => a === d || a.startsWith(d + path.sep);
  if (inside(path.join(REPO, '.harness'))) return '.harness/ (RULER-grain·volsky 번들·출력)';
  if (inside(path.join(REPO, 'tools/genus-ruler/grain'))) return 'tools/genus-ruler/grain/ (RULER-grain 동결)';
  if (inside(path.join(REPO, 'tools/genus-ruler/volsky'))) return 'tools/genus-ruler/volsky/ (동결 entry·capture)';
  if (FROZEN_TSUN.includes(a)) return 'RULER-tsun 동결 후보 파일';
  if (inside(path.join(REPO, 'src'))) return 'src/ (앱 소스)';
  return null;
}

module.exports = { HOLD_NAME, CHUNK_MAX_MIN, CHUNK_DEFAULT_MIN, EST, PAGE_START, LIGHT_STAGES, guardConflicts, pgrepAf, guardOnce, estTable, estimateFile, estimateAll,
  inputSha, readMarker, markerMatches, writeMarker, countDone, jobNames, decideB0, quadResiduals, pulsing, forbiddenPath, FROZEN_TSUN };

// ───── 명령 줄 ─────
if (require.main === module) {
  const argv = process.argv.slice(2), cmd = argv[0];
  const get = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
  const all = k => argv.reduce((a, x, i) => (x === k && i + 1 < argv.length ? [...a, argv[i + 1]] : a), []);
  const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
        if (n++ % 10 === 0) console.log(`guard: waiting (${new Date().toISOString()}) for ${c.length} process(es): ${c.map(p => p.pid + ' ' + p.cmd.slice(0, 80)).join(' | ')}`);
        sleep(pollS * 1000);
      }
    } else if (cmd === 'estimate') {
      const man = JSON.parse(fs.readFileSync(get('--manifest'), 'utf8'));
      const dec = get('--decisions') && fs.existsSync(get('--decisions')) ? JSON.parse(fs.readFileSync(get('--decisions'), 'utf8')) : null;
      const e = estimateAll(man, dec, Number(get('--chunk-min', String(CHUNK_DEFAULT_MIN))));
      console.log(`step                      chunks     machine min (low–high)${e.refMeasured ? '   [REF from B0 timing]' : '   [REF 2–15 min/unit estimate]'}`);
      for (const r of e.rows) console.log(`${r.step.padEnd(24)} ${String(r.chunks.join('–')).padStart(7)}   ${r.kind === 'blocked' ? 'blocked' : r.total.map(x => x.toFixed(0)).join('–')}`);
      console.log(`TOTAL                    ${String(e.chunks.join('–')).padStart(7)}   ${e.totalMin.map(x => x.toFixed(0)).join('–')} min = ${e.totalH.map(x => x.toFixed(1)).join('–')} h (chunks ≤ ${e.chunkMin} min)`);
      if (get('--json')) fs.writeFileSync(get('--json'), JSON.stringify(e, null, 1));
    } else if (cmd === 'input-sha') {
      console.log(inputSha(argv.slice(1)));
    } else if (cmd === 'marker-ok') {
      process.exit(markerMatches(readMarker(get('--marker')), get('--input-sha')) ? 0 : 1);
    } else if (cmd === 'marker-write') {
      const extra = get('--extra') ? JSON.parse(get('--extra')) : {};
      writeMarker(get('--marker'), { id: get('--id'), status: get('--status'), inputSha: get('--input-sha'), rc: get('--rc') != null ? Number(get('--rc')) : null,
        startedAt: get('--started'), chunks: get('--chunks') != null ? Number(get('--chunks')) : null, note: get('--note'), ...extra });
    } else if (cmd === 'count-done') {
      console.log(countDone(get('--dir'), jobNames(get('--jobs'))));
    } else if (cmd === 'decide-b0') {
      const d = get('--dir'), rd = f => { try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch { return null; } };
      const out = decideB0(rd('REF__RA1_s1.1_V1.meta.json'), rd('REF100__RA1_s1.1_V1.meta.json'), Number(get('--chunk-min', String(CHUNK_DEFAULT_MIN))));
      fs.writeFileSync(get('--out'), JSON.stringify({ ...out, decidedAt: new Date().toISOString() }, null, 1));
      console.log(JSON.stringify(out));
    } else if (cmd === 'paths-ok') {
      const bad = argv.slice(1).map(p => [p, forbiddenPath(p)]).filter(x => x[1]);
      if (bad.length) { console.error('forbidden output path(s):\n' + bad.map(([p, w]) => `  ${p} — ${w}`).join('\n')); process.exit(2); }
    } else {
      console.error('usage: gpuwin-lib.js guard|estimate|input-sha|marker-ok|marker-write|count-done|decide-b0|paths-ok …'); process.exit(2);
    }
  } catch (e) { console.error('gpuwin-lib: ' + (e && e.message || e)); process.exit(2); }
}
