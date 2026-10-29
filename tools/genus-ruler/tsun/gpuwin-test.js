/**
 * §180 GPU 창 준비물 시험 — **브라우저·Playwright 를 띄우지 않음**, run-tsun.js·run-grain.js·eval-grain.sh 를 돌리지 않음, .harness/ 를 건드리지 않음.
 *   node tools/genus-ruler/tsun/gpuwin-test.js [--root GW_ROOT] [--pin]   (GW_ROOT 기본 scratchpad/gpuwin — `gpu-window.sh prep` 을 먼저: 번들·잡·점검기)
 *   --pin: 번들 고정 시험(§180 검토 8 — 번들을 네 번 다시 묶고 잡을 다시 만듦, 몇 분)
 * 무엇:
 *  [1] 잡 펼침: manifest 수·종류 · 모든 잡 손잡이 9 개 · 후보 손잡이(tsun 1)는 합성 단위(RA·HS·grain 비용 입력)에만 · 진단 이름 · 감시 시간이 덩어리에 들어감
 *      · gpuwin-check.cjs(entry-tsun checkTsunJob·validateTsunOptions 같은 함수) 통과 · 진단 2~7 이 'not implemented' 로 거부됨
 *  [2] 인자: gpu-window.sh plan 의 run-tsun 줄을 run-tsun-lib parseArgs 로 · lighting-render-check.js --dry(가짜 pgrep) · 잘못된 인자 거부
 *  [3] 지킴: 가짜 pgrep 으로 guard --once/--wait/--stable/한도/pgrep 오류 · 표지 과정 빼기 · lighting-render-check 자기 지킴 ·
 *      gpu-window.sh run(GW_DRY=1)의 처음 기다림 한도(75)·단계 사이 grain 등장(75)·예산(76)·GW_UNTIL(76)·전체 흐름 순서 · exec -a 표지 방식
 *  [4] 출력 경로: .harness/ · grain · src · 동결 후보 파일 아래 거부, plan 의 모든 출력 폴더가 GW_ROOT 아래
 *  [5] 표지(이어 돌리기) · [6] B0 결정 · [7] 출렁임 지표 · [8] 시간 어림 · [9] WP7 탐침 uv 식 = 셰이더 gTsunUvOf 식 · [10] 번들 bundle.json(같은 sha 두 번)
 *  §180 검토 반영 시험: [3] 자식 거부(rc 2)에서 멈춤 · argv 지킴(거짓 양성) · 조상 grain 줄 거부 · 신호(TERM)에 바로 멈춤 · 창 잠금 fd 가 자식에 새지 않음 ·
 *  낡은 tsun 잠금·표지 치우기 · [11] 번들 고정(--pin)
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const G = require('./gpuwin-lib');
const L = require('./run-tsun-lib');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SCR = '/tmp/claude-0/-home-user-solar-path/827aa702-2f52-52c8-9fe8-e45a3ff14759/scratchpad';
const ai = process.argv.indexOf('--root'), PIN = process.argv.includes('--pin');
const GW_ROOT = ai > 0 ? path.resolve(process.argv[ai + 1]) : path.join(SCR, 'gpuwin');
const JOBS = path.join(GW_ROOT, 'jobs');
const T0 = fs.mkdtempSync(path.join(GW_ROOT, 'test-'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const run = (cmd, args, env = {}, opt = {}) => spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env }, timeout: opt.timeout ?? 600000, cwd: REPO, maxBuffer: 256 << 20 });
const SH = path.join(__dirname, 'gpu-window.sh');

// ── 가짜 pgrep: $2 = 무늬. FAKE_PGREP_DIR 의 grain.txt·gpu.txt 내용을 찍음 · count(부른 수) · busy_until N(N 번째까지 바쁨) · busy_after N(N 번째부터 바쁨) · fail(종료 3)
const FAKE = path.join(T0, 'fake-pgrep.sh');
fs.writeFileSync(FAKE, `#!/bin/sh
D=$FAKE_PGREP_DIR
[ -f "$D/fail" ] && exit 3
case "$2" in
  *swiftshader*) f="$D/gpu.txt" ;;
  *) f="$D/grain.txt"; n=$(cat "$D/count" 2>/dev/null || echo 0); n=$((n + 1)); echo $n > "$D/count"
     if [ -f "$D/busy_until" ] && [ $n -le $(cat "$D/busy_until") ]; then echo "4242 bash tools/genus-ruler/grain/eval-grain.sh c0"; exit 0; fi
     if [ -f "$D/busy_after" ] && [ $n -ge $(cat "$D/busy_after") ]; then echo "4343 node tools/genus-ruler/grain/run-grain.js --atmos gen r.json out 390 584"; exit 0; fi ;;
esac
[ -s "$f" ] && { cat "$f"; exit 0; }
exit 1
`);
fs.chmodSync(FAKE, 0o755);
const fakeDir = name => { const d = path.join(T0, 'pg-' + name); fs.mkdirSync(d, { recursive: true }); return d; };
const fenv = (d, extra = {}) => ({ GW_PGREP: FAKE, FAKE_PGREP_DIR: d, ...extra });

console.log('[1] 잡 펼침');
{
  const man = JSON.parse(fs.readFileSync(path.join(JOBS, 'manifest.json'), 'utf8'));
  const want = { 'b1-low.json': 20, 'b1-medium.json': 20, 'b1-high.json': 20, 'b1-refuse.json': 6, 'b1-det.json': 2, 'w7-emu.json': 6, 'b0-time.json': 2, 'b0-cost.json': 118,
    'b0-costaa-1.json': 1, 'b0-costaa-2.json': 1, 'b0-floor.json': 13, 'b0-floor-ref100.json': 8, 'b2-t.json': 136, 'b2-ref.json': 68, 'b2-refval.json': 24 };
  ok(Object.entries(want).every(([f, n]) => man.files[f] && man.files[f].n === n), 'manifest 잡 수 = 설계 목록(B1 20×3 · 거부 6 · 결정성 2 · WP7 6 · B0 시간 2 · 비용 118+1+1 · 바닥 13 + REF100 8 · B2 136+68+24)');
  const KN = ['tsun', 'tsunN', 'tsunRangeKm', 'archLight', 'archNoT', 'tsunRef', 'tsunRefStepM', 'tsunDebug', 'tsunSync'];
  let all = [], badKnob = [], photoT = [], badDbgName = [], wdNoFit = [], noLightFlags = [], noSlack = [], simBad = [];
  const QM = { low: 1, medium: 1.5, high: 2 };
  for (const f of Object.keys(want)) {
    const js = JSON.parse(fs.readFileSync(path.join(JOBS, f), 'utf8'));
    const sim = man.files[f].sim || [];
    if (sim.length !== js.length || sim.some((x, i) => x.n !== js[i].name || x.wd !== js[i].watchdogMin)) simBad.push(f);
    for (const j of js) {
      all.push(j);
      if (j.options.clampInscatter !== false || j.options.irradianceLogMu !== false) noLightFlags.push(j.name);
      if (!f.startsWith('b1-') && !(j.watchdogMin >= 8 * QM[j.quality || 'low'])) noSlack.push(j.name);
      if (!KN.every(k => k in j.options)) badKnob.push(j.name);
      const unit = String(j.unit ?? j.layer ?? '');
      if ((j.options.tsun === 1 || j.options.archLight) && !(/^(RA\d|HS_|AS_)/.test(unit) || (j.grain && j.layer))) photoT.push(j.name);
      if (j.options.tsunDebug && !new RegExp('__dbg' + j.options.tsunDebug + '$').test(j.name)) badDbgName.push(j.name);
      const W = j.canvas ? j.canvas[0] : j.W, H = j.canvas ? j.canvas[1] : j.H;
      if (!L.startsWithinChunk(G.ATMOS_ADMIT_MIN, L.watchdogMs(j, 1, { W, H, first: true }), 55)) wdNoFit.push(j.name);
    }
  }
  ok(badKnob.length === 0, `모든 잡(${all.length})이 새 손잡이 9 개 명시 (빠짐 ${badKnob.length})`);
  ok(photoT.length === 0, `후보 손잡이(tsun·archLight)는 합성 단위에만 — 사진 장면 잡 ${photoT.length}`);
  ok(!all.some(j => /P[123]B|P[123]A|tw17|DEV_/.test(j.name)), '잡 이름에 사진 장면(P1B·P2B·P3B·tw·DEV) 없음');
  ok(badDbgName.length === 0, '진단 잡 이름 = <…>__dbg<k>');
  ok(wdNoFit.length === 0, `모든 잡이 새 55 분 덩어리의 첫 잡으로 시작 가능(대기 생성 ${G.ATMOS_ADMIT_MIN} 분 + 감시 시간 + 첫 잡 5 분 — 검토 2) — 안 되는 잡 ${wdNoFit.length} ${wdNoFit.slice(0, 2).join(' ')}`);
  ok(noSlack.length === 0, `B1 밖 모든 잡에 컴파일 여유 watchdogMin ≥ 8 × 품질 배율(검토 3: 덩어리마다 다시 컴파일) — 빠짐 ${noSlack.length}`);
  {
    const t = JSON.parse(fs.readFileSync(path.join(JOBS, 'b0-time.json'), 'utf8')), f100 = JSON.parse(fs.readFileSync(path.join(JOBS, 'b0-floor-ref100.json'), 'utf8'));
    const r100 = [...t, ...f100].filter(j => j.options.tsunRefStepM === 100);
    ok(r100.length === 9 && r100.every(j => j.watchdogMin === (j.options.tsunDebug ? 16 : 30)) && !JSON.parse(fs.readFileSync(path.join(JOBS, 'b0-floor.json'), 'utf8')).some(j => j.options.tsunRefStepM === 100),
      'REF100 감시 시간 명시 그림 30 · 진단 16 분(검토 2: 기본 50 분은 대기 생성 뒤 55 분 덩어리에 못 들어감) · REF100 은 따로 된 파일 b0-floor-ref100');
  }
  ok(noLightFlags.length === 0, `모든 T_sun 잡에 clampInscatter·irradianceLogMu = false 명시(검토 11, F6 기준선) — 빠짐 ${noLightFlags.length}`);
  ok(simBad.length === 0, `manifest sim 목록(시간 어림·count-done)이 잡 파일과 이름·감시 시간까지 같음 — 다름 ${simBad.join(' ')}`);
  const light = JSON.parse(fs.readFileSync(path.join(JOBS, 'light-scenes.json'), 'utf8'));
  ok(light.P1B.input.date === '2026-10-02T09:22:21.793Z' && light.P1B.input.layers[2].genus === 'ac' && light.P1B.input.layers[2].baseKm === 7.4 && Array.isArray(light.P1B.input.macro?.high ?? light.P1B.input.macro?.layers ?? light.P1B.input.macro),
    'light-scenes P1B = 후쿠이 18:22:21 JST · ac 7.4 km 덮개 · 거시 고리 재생성');
  ok(!('tsun' in light.P1B.options) && Object.keys(light.wp7Units).every(u => /^RA\d/.test(u)), '§178 장면에 후보 손잡이 없음 · WP7 아틀라스 단위는 RA 합성 단위만');
  const chk = run('node', [path.join(GW_ROOT, 'check', 'gpuwin-check.cjs'), '--jobs', JOBS, '--chunk-min', '55']);
  const cj = (() => { try { return JSON.parse(chk.stdout.trim().split('\n').pop()); } catch { return null; } })();
  ok(chk.status === 0 && cj && cj.ok, `gpuwin-check(checkTsunJob · validateTsunOptions · 품질 섞기 · 같은 이름 · 감시 시간) 통과 ${cj ? cj.nProblems + ' problems' : chk.stderr.slice(0, 200)}`);
  ok(cj && cj.summary['b1-refuse.json'].refused === 6, '진단 2~7 여섯 잡 모두 validateTsunOptions 가 \'not implemented\' 로 거부(브라우저에서도 잡 실패가 기대값)');
}

console.log('[2] 인자');
const plan = run('bash', [SH, 'plan'], { GW_ROOT, GW_OUT: path.join(T0, 'out-plan') });
ok(plan.status === 0, 'gpu-window.sh plan 종료 0' + (plan.status ? ' — ' + plan.stderr.slice(0, 300) : ''));
const planLines = plan.stdout.split('\n').filter(l => /^[A-Za-z0-9-]+: /.test(l));
{
  const tsunLines = planLines.filter(l => /\/run-tsun\.js /.test(l));
  ok(tsunLines.length === 15, `run-tsun 단계 15 개(B1×5 · W7emu · B0×6 · B2×3) — ${tsunLines.length}`);
  let bad = [];
  for (const l of tsunLines) {
    const toks = l.split(/\s+/).slice(l.split(/\s+/).indexOf(path.join(__dirname, 'run-tsun.js')) + 1).filter(Boolean).map(t => (/^<B0/.test(t) ? '1.5' : t)).filter(t => !/^\[.*\]$/.test(t));
    try {
      const a = L.parseArgs(toks, {});
      const jf = JSON.parse(fs.readFileSync(a.jobsFile, 'utf8'));
      const c = jf[0].canvas || [jf[0].W, jf[0].H];
      if (a.guardTag !== L.GUARD_TAG || !(a.maxMin <= 60) || a.atmos !== 'gen' || a.W !== c[0] || a.H !== c[1] || a.root !== path.join(GW_ROOT, 'bundle-tsun') || a.lock !== '/tmp/run-tsun.lock') bad.push(l.slice(0, 60) + ' fields');
    } catch (e) { bad.push(l.slice(0, 60) + ' ' + e.message); }
  }
  ok(bad.length === 0, 'run-tsun 줄마다 parseArgs 통과 · 태그 · --max-min ≤ 60 · 캔버스 = 잡 파일 · 번들 = GW_ROOT/bundle-tsun · 잠금 /tmp/run-tsun.lock ' + bad.slice(0, 3).join(' | '));
  ok(planLines.some(l => /^B0floor: .*--watchdog-scale <B0> /.test(l)) && planLines.some(l => /^B0floor100: .*--watchdog-scale <B0-100> /.test(l)) && planLines.some(l => /^B2ref: .*--watchdog-scale/.test(l)) && !planLines.some(l => /^B2t: .*--watchdog-scale/.test(l)),
    '감시 시간 배율(B0 결정)은 REF 파일(B0floor·B2ref·B2refval)과 REF100 파일(B0floor100, 따로 된 배율)에만 — 후보 쪽(B2t)은 기본');
  ok(run('bash', [SH, 'plan'], { GW_ROOT, GW_OUT: path.join(T0, 'out-plan61'), GW_CHUNK_MIN: '61' }).status === 2, 'gpu-window.sh: GW_CHUNK_MIN 61 거부(덩어리 ≤ 60 분 — run-tsun-lib 자체 상한은 120)');
  const lightLines = planLines.filter(l => /lighting-render-check\.js/.test(l));
  ok(lightLines.length === 10 && lightLines.every(l => / --max-min 58 /.test(l)), `조명·WP7 단계 10 개(L2·L5·L6 은 페이지 둘 — 검토 4), 모두 --max-min 58 — ${lightLines.length}`);
  const d = fakeDir('clear');
  let dryOk = 0, outs = [];
  for (const l of lightLines) {
    const toks = l.split(/\s+/).filter(Boolean); const k = toks.indexOf(path.join(__dirname, 'lighting-render-check.js'));   // 깨끗한 트리면 끝 빈칸(빈 DIRTY_FLAG)
    const r = run('node', [...toks.slice(k), '--dry'], fenv(d));
    try { const j = JSON.parse(r.stdout.trim().split('\n').pop()); if (r.status === 0 && j.dry) { dryOk++; outs.push(j.out); } } catch { /* 실패 */ }
  }
  ok(dryOk === 10, `lighting-render-check --dry 열 단계(브라우저 없음) 종료 0 — ${dryOk}`);
  {
    const lrc0 = path.join(__dirname, 'lighting-render-check.js'), dd = d => JSON.parse(run('node', [lrc0, '--guard-tag', L.GUARD_TAG, '--stage', d, '--root', path.join(GW_ROOT, 'bundle-light'), '--scenes', path.join(JOBS, 'light-scenes.json'), '--out', path.join(T0, 'L'), '--allow-dirty', '--dry'], fenv(fakeDir('clear'))).stdout.trim().split('\n').pop());
    const a = dd('L2deck-high'), b = dd('L6frametime-a'), c = dd('L5cross12-medium');
    ok(a.fn === 'L2deck' && a.patch.qualities.join() === 'high' && a.patch.flags.join() === 'off,on' && b.fn === 'L6frametime' && b.patch.order.length === 8 && b.patch.timed === 12 && c.patch.qualities.join() === 'medium' && a.maxMin === 58,
      '나눈 단계 → entry-gpuwin 단계 이름 + 인자 덮어쓰기(L2deck-high = high × 끔·켬 · L6frametime-a = ABBA 8 블록 데움 4 잰 12 · L5cross12-medium) · 기본 --max-min 58');
    const en = fs.readFileSync(path.join(__dirname, 'entry-gpuwin.ts'), 'utf8');
    ok(/p\.flags as string\[\] \| undefined/.test(en) && /p\.order as string\[\] \| undefined/.test(en), 'entry-gpuwin 이 flags(L2deck)·order(L6frametime) 인자를 받음');
  }
  const lrc = path.join(__dirname, 'lighting-render-check.js'), base = ['--stage', 'L2deck', '--root', path.join(GW_ROOT, 'bundle-light'), '--scenes', path.join(JOBS, 'light-scenes.json'), '--out', path.join(T0, 'L'), '--allow-dirty', '--dry'];
  ok(run('node', [lrc, ...base], fenv(d)).status === 2, 'lighting-render-check: --guard-tag 없으면 거부(2)');
  ok(run('node', [lrc, '--guard-tag', L.GUARD_TAG, ...base, '--max-min', '61'], fenv(d)).status === 2, 'lighting-render-check: --max-min 61 거부');
  ok(run('node', [lrc, '--guard-tag', L.GUARD_TAG, ...base.map(t => (t === 'L2deck' ? 'L9' : t))], fenv(d)).status === 2, 'lighting-render-check: 모르는 단계 거부');
  ok(run('node', [lrc, '--guard-tag', L.GUARD_TAG, ...base.map(t => (t === path.join(T0, 'L') ? path.join(REPO, '.harness/volsky-tsun/L') : t))], fenv(d)).status === 2, 'lighting-render-check: .harness/ 아래 출력 거부');
  ok(run('node', [lrc, '--guard-tag', L.GUARD_TAG, ...base.filter(t => t !== '--allow-dirty')], fenv(d)).status === 2, 'lighting-render-check: 더러운 트리 번들은 --allow-dirty 없이 거부');
  globalThis.__lightOuts = outs;
}

console.log('[3] 지킴(가짜 pgrep)');
{
  const lib = path.join(__dirname, 'gpuwin-lib.js');
  const g = (d, args) => run('node', [lib, 'guard', ...args], fenv(d), { timeout: 60000 });
  const d0 = fakeDir('g0');
  ok(g(d0, ['--once']).status === 0, 'grain 없음 → --once 0');
  const d1 = fakeDir('g1'); fs.writeFileSync(path.join(d1, 'grain.txt'), '777 bash tools/genus-ruler/grain/eval-grain.sh c0\n');
  ok(g(d1, ['--once']).status === 10, 'eval-grain.sh 보임 → --once 10');
  const d2 = fakeDir('g2'); fs.writeFileSync(path.join(d2, 'grain.txt'), '888 gpu-window-hold genus-ruler/volsky/run.js (tsun GPU window)\n');
  ok(g(d2, ['--once']).status === 0, '창 표지 과정(gpu-window-hold …)은 지킴에서 뺌');
  const d2b = fakeDir('g2b'); fs.writeFileSync(path.join(d2b, 'grain.txt'), '889 node x/run-tsun.js --guard-tag genus-ruler/volsky/run.js j o 400 300\n');
  ok(g(d2b, ['--once']).status === 10 && g(d2b, ['--once', '--exclude-pid', '889']).status === 0, '다른 tsun 덩어리(태그)는 충돌 · --exclude-pid 로만 뺌');
  const d3 = fakeDir('g3'); fs.writeFileSync(path.join(d3, 'gpu.txt'), '555 /opt/pw-browsers/chromium --type=gpu-process --use-angle=swiftshader\n');
  ok(g(d3, ['--once']).status === 10, '주인 없는 SwiftShader GPU 과정 → 10');
  const d4 = fakeDir('g4'); fs.writeFileSync(path.join(d4, 'busy_until'), '3');
  const r4 = g(d4, ['--wait', '--poll-s', '0.05', '--stable', '2', '--max-wait-min', '1']);
  ok(r4.status === 0 && Number(fs.readFileSync(path.join(d4, 'count'), 'utf8')) === 5, `--wait: 세 번 바쁨 → 두 번 연달아 빔(stable 2) 뒤 0 (pgrep ${fs.readFileSync(path.join(d4, 'count'), 'utf8').trim()} 번)`);
  ok(g(d1, ['--wait', '--poll-s', '0.05', '--max-wait-min', '0.002']).status === 75, '--wait 한도 넘으면 75');
  const d5 = fakeDir('g5'); fs.writeFileSync(path.join(d5, 'fail'), '');
  ok(g(d5, ['--once']).status === 2, 'pgrep 오류 → 2(닫힌 쪽)');
  // lighting-render-check 자기 지킴
  const l0 = (globalThis.__lightOuts || [])[0];
  const lrc = path.join(__dirname, 'lighting-render-check.js');
  const lr = run('node', [lrc, '--guard-tag', L.GUARD_TAG, '--stage', 'L1compile', '--root', path.join(GW_ROOT, 'bundle-light'), '--scenes', path.join(JOBS, 'light-scenes.json'), '--out', path.join(T0, 'L'), '--allow-dirty', '--dry'], fenv(d1));
  ok(lr.status === 2 && /RULER-grain/.test(lr.stderr), 'lighting-render-check: grain 과정이 보이면 브라우저 전에 거부(2)');
  // exec -a 표지 방식(시험용 다른 이름 — 진짜 표지 이름은 돌고 있는 grain 의 eval-grain.sh 가 볼 수 있어 시험에서 띄우지 않음)
  const hb = run('bash', ['-c', 'bash -c "exec -a \\"xyz-gpuwin-selftest-hold marker\\" sleep 3" & p=$!; sleep 0.3; tr "\\0" " " < /proc/$p/cmdline; kill $p']);
  ok(/^xyz-gpuwin-selftest-hold marker 3/.test(hb.stdout), 'exec -a 로 띄운 표지 과정의 명령 줄 = 표지 이름(pgrep -f 가 봄): ' + JSON.stringify(hb.stdout.slice(0, 60)));
  ok(G.HOLD_NAME.includes(L.GUARD_TAG) && fs.readFileSync(SH, 'utf8').includes('HOLD_NAME="gpu-window-hold $TAG'), '표지 이름에 eval-grain.sh guard_concurrent 무늬(genus-ruler/volsky/run.js)가 들어감');
  // gpu-window.sh run (GW_DRY=1) — 브라우저 명령은 찍기만
  const dry = (name, extra, d) => run('bash', [SH, 'run'], { GW_ROOT, GW_OUT: path.join(T0, 'out-' + name), GW_DRY: '1', GW_HOLD: '0', GW_POLL_S: '0.05', GW_STABLE: '2', GW_LOCK: path.join(T0, name + '.lock'), ...fenv(d), ...extra }, { timeout: 600000 });
  const r6 = dry('busy', { GW_MAX_WAIT_MIN: '0.003' }, d1);
  ok(r6.status === 75 && !fs.existsSync(path.join(T0, 'out-busy', 'run.json')), 'run: grain 이 계속 돌면 기다림 한도 뒤 75, 아무 단계도 시작 안 함');
  const dOk = fakeDir('flow');
  const r7 = dry('flow', {}, dOk);
  const logf = path.join(T0, 'out-flow', 'logs', 'gpu-window.log');
  const dl = fs.existsSync(logf) ? fs.readFileSync(logf, 'utf8').split('\n').filter(l => /\[dry\] (nice|post|decide)/.test(l)) : [];
  const order = dl.map(l => (l.match(/--stage (\S+)/) || l.match(/jobs\/(\S+\.json)/) || l.match(/\[dry\] (post \S+|decide-b0)/) || [])[1]).filter(Boolean);
  const wantOrder = ['L1compile', 'L2deck-low', 'L2deck-high', 'L3twilight', 'L4sunset', 'L5cross12-low', 'L5cross12-medium', 'L6frametime-a', 'L6frametime-b', 'post light',
    'b1-low.json', 'b1-medium.json', 'b1-high.json', 'b1-refuse.json', 'b1-det.json', 'post b1',
    'W7atlas', 'w7-emu.json', 'b0-time.json', 'decide-b0', 'b0-cost.json', 'b0-costaa-1.json', 'b0-costaa-2.json', 'b0-floor.json', 'b0-floor-ref100.json', 'post b0', 'b2-t.json', 'b2-ref.json', 'b2-refval.json', 'post b2', 'post w7'];
  ok(r7.status === 0 && JSON.stringify(order) === JSON.stringify(wantOrder), `run(DRY): 지킴 → 준비(최신이면 건너뜀) → 31 단계가 정해진 순서로 (${order.length}) ${r7.status ? r7.stderr.slice(-300) : JSON.stringify(order).slice(0, 200)}`);
  ok(!fs.existsSync(path.join(T0, 'out-flow', 'L')) && !fs.readdirSync(path.join(T0, 'out-flow')).some(f => /^B[0-2]/.test(f) && fs.readdirSync(path.join(T0, 'out-flow', f)).some(x => /\.png$|\.meta\.json$/.test(x))), 'run(DRY): 렌더 출력 없음(브라우저 안 띄움)');
  const d8 = fakeDir('mid'); fs.writeFileSync(path.join(d8, 'busy_after'), '6');
  const r8 = dry('mid', {}, d8);
  ok(r8.status === 75 && /appeared between steps/.test(fs.readFileSync(path.join(T0, 'out-mid', 'logs', 'gpu-window.log'), 'utf8')), 'run(DRY): 단계 사이에 grain 이 나타나면 멈춤 75(GW_ON_GRAIN=stop)');
  const r9 = dry('budget', { GW_BUDGET_MIN: '30' }, fakeDir('budget'));
  ok(r9.status === 76, 'run(DRY): 예산(30 분 < 첫 단계 60 분) → 76');
  const r10 = dry('until', { GW_UNTIL: new Date(Date.now() + 20 * 60000).toISOString() }, fakeDir('until'));
  ok(r10.status === 76, 'run(DRY): GW_UNTIL 20 분 뒤 → 60 분 단계를 시작하지 않고 76');
  const r11 = dry('chunks', { GW_DRY_RC: '3', GW_STEPS: 'B1det' }, fakeDir('chunks'));
  const l11 = fs.readFileSync(path.join(T0, 'out-chunks', 'logs', 'gpu-window.log'), 'utf8');
  ok(r11.status === 0 && (l11.match(/\[dry\] nice/g) || []).length === 3 && /B1det: dry-chunks/.test(l11), 'run(DRY): 남은 잡(rc 3) → 덩어리 되풀이(시험 세 번에서 멈춤) · GW_STEPS 로 한 단계만');
  ok(run('bash', [SH, 'run'], { GW_ROOT, GW_OUT: path.join(T0, 'out-lock'), GW_DRY: '1', GW_LOCK: '/dev/null/x' }).status !== 0, '잠금 파일을 못 만들면 시작 안 함');
  // §180 검토 1: 자식 거부(rc 2)는 창을 멈춤(예전: 21 단계를 'refused' 로 지나 종료 0)
  const r12 = dry('rc2', { GW_DRY_RC: '2' }, fakeDir('rc2'));
  const l12 = fs.readFileSync(path.join(T0, 'out-rc2', 'logs', 'gpu-window.log'), 'utf8');
  ok(r12.status === 2 && (l12.match(/\[dry\] nice/g) || []).length === 1 && /L1compile refused \(rc 2\)/.test(l12) && /\[dry\] marker L1compile → refused/.test(l12), 'run(DRY): 첫 자식이 거부(rc 2)하면 표지 refused 를 쓰고 종료 2(다음 단계로 가지 않음)');
  const r12b = dry('rc2t', { GW_DRY_RC: '2', GW_STEPS: 'B1det' }, fakeDir('rc2t'));
  ok(r12b.status === 2 && /B1det refused/.test(fs.readFileSync(path.join(T0, 'out-rc2t', 'logs', 'gpu-window.log'), 'utf8')), 'run(DRY): run-tsun 단계 거부도 종료 2');
  // §180 검토 9: 조상 명령 줄에 grain 무늬(이어 띄움) → 시작 전에 거부
  const r13 = run('bash', ['-c', `bash ${SH} run; rc=$?; : eval-grain.sh; exit $rc`], { GW_ROOT, GW_OUT: path.join(T0, 'out-anc'), GW_DRY: '1', GW_HOLD: '0', GW_POLL_S: '0.05', GW_LOCK: path.join(T0, 'anc.lock'), ...fenv(fakeDir('anc')) });
  ok(r13.status === 2 && /ancestor process command line matches/.test(fs.readFileSync(path.join(T0, 'out-anc', 'logs', 'gpu-window.log'), 'utf8')), 'run: 지킴 기다림 뒤에도 살아 있는 조상 셸의 명령 줄에 grain 무늬가 있으면(자식이 모두 거부할 것) 단계 전에 종료 2 — setsid nohup 안내');
  // 신호: 처음 지킴 기다림 중 TERM → 바로 130(예전: 앞에서 도는 pgrep 기다림이 끝날 때까지 덫이 미뤄짐)
  {
    const dT = fakeDir('term'); fs.writeFileSync(path.join(dT, 'grain.txt'), '777 bash tools/genus-ruler/grain/eval-grain.sh c0\n');
    const env = { ...process.env, GW_ROOT, GW_OUT: path.join(T0, 'out-term'), GW_DRY: '1', GW_HOLD: '0', GW_POLL_S: '0.2', GW_MAX_WAIT_MIN: '30', GW_LOCK: path.join(T0, 'term.lock'), ...fenv(dT) };
    const t0 = Date.now();
    const r = spawnSync('bash', ['-c', `bash ${SH} run & p=$!; sleep 2; kill -TERM $p; wait $p; echo rc=$?`], { encoding: 'utf8', env, cwd: REPO, timeout: 120000 });
    const secs = (Date.now() - t0) / 1000;
    ok(/rc=130/.test(r.stdout) && secs < 20 && /interrupted by TERM/.test(fs.readFileSync(path.join(T0, 'out-term', 'logs', 'gpu-window.log'), 'utf8')), `run: 지킴 기다림 중 TERM → ${secs.toFixed(1)} s 만에 130 (자식 지킴 과정도 끝냄) ${r.stdout.trim().slice(-40)}`);
    const left = spawnSync('pgrep', ['-f', `max-wait-min 30 --poll-s 0.2`], { encoding: 'utf8' });
    ok(!left.stdout.trim(), '신호 뒤 지킴 과정이 남지 않음');
  }
  // §180 검토 5: 창 잠금(fd 9)이 자식·표지에 새지 않음 — gpu-window.sh 와 같은 줄로 띄운 표지가 살아 있어도, 실행기가 kill -9 되면 잠금이 풀림
  {
    const lk = path.join(T0, 'fd9.lock'), sh = path.join(T0, 'fd9.sh');
    fs.writeFileSync(sh, `exec 9>"${lk}"; flock -n 9 || exit 3\nbash -c "exec -a xyz-gpuwin-fd9-selftest sleep 30" 9>&- </dev/null >/dev/null 2>&1 &\necho $! > "${T0}/fd9.pid"; sleep 0.3; kill -9 $$\n`);
    spawnSync('bash', [sh]);
    const free = spawnSync('flock', ['-n', lk, 'true']).status === 0;
    const mp = Number(fs.readFileSync(path.join(T0, 'fd9.pid'), 'utf8')); let alive = false; try { process.kill(mp, 0); alive = true; } catch { /* 없음 */ }
    try { process.kill(mp, 'SIGKILL'); } catch { /* 없음 */ }
    const src = fs.readFileSync(SH, 'utf8');
    ok(free && alive && /sleep 4200" 9>&- /.test(src) && /"\$@" 9>&- <\/dev\/null/.test(src), `실행기가 kill -9 돼도 표지(살아 있음 ${alive})가 잠금을 쥐지 않음(flock -n 성공 ${free}) · gpu-window.sh 표지·자식 줄에 9>&-`);
  }
  // §180 검토 9: argv 지킴 — 명령 줄에 글자만 든 과정은 grain 이 아님
  {
    const P = (pid, argv, cwd = null) => ({ line: `${pid} ${argv.join(' ')}`, argv, cwd });
    const ps = [P(11, ['/bin/bash', '-c', 'cd x && tail -f .harness/volsky-grain/out/c0.log; pgrep -f eval-grain.sh']), P(12, ['less', 'tools/genus-ruler/grain/eval-grain.sh']),
      P(13, ['bash', '-c', 'until ! pgrep -f eval-grain.sh; do sleep 60; done']), P(14, ['grep', '-n', 'run-grain.js', 'x']),
      P(21, ['bash', 'tools/genus-ruler/grain/eval-grain.sh', 'c0']), P(22, ['/bin/bash', '/home/user/solar-path/tools/genus-ruler/grain/eval-grain.sh', 'r1']),
      P(23, ['node', '/home/user/solar-path/tools/genus-ruler/grain/run-grain.js', '--atmos', 'gen', 'j', 'o', '390', '584']), P(24, ['nice', '-n', '19', 'node', 'tools/genus-ruler/volsky/run.js', 'j', 'o']),
      P(25, ['node', 'run.js', 'j'], '/home/user/solar-path/tools/genus-ruler/volsky'), P(26, ['node', 'run.js', 'j'], '/home/user/other'),
      P(27, ['node', '/x/tools/genus-ruler/tsun/run-tsun.js', '--guard-tag', 'genus-ruler/volsky/run.js', 'j', 'o', '400', '300']), P(28, ['env', 'A=1', 'timeout', '3600', 'node', 'x/run-grain.js'])];
    const by = Object.fromEntries(ps.map(p => [p.line.split(' ')[0], p]));
    const c = G.guardConflicts(ps.map(p => p.line).join('\n'), '', [], { argvOf: pid => by[pid].argv, cwdOf: pid => by[pid].cwd });
    ok(c.map(p => p.pid).join() === '21,22,23,24,25,27,28' && c.find(p => p.pid === 27).why === 'tsun chunk (tagged)',
      `argv 지킴: 도구 셸 bash -c · less · 감시 고리 · grep · 다른 폴더의 run.js 는 grain 아님 / eval-grain.sh · run-grain.js · volsky run.js(cd 해서 부른 것 포함, 감싸개 nice·env·timeout 뒤)·태그 단 tsun 덩어리는 충돌 — ${c.map(p => p.pid).join()}`);
  }
  // §180 검토 1·5: 낡은 tsun 잠금 · 죽은 창의 표지
  {
    const lf = path.join(T0, 'tl.lock'), w = o => fs.writeFileSync(lf, JSON.stringify(o));
    w({ pid: 4242, bootId: 'B' }); const a = G.staleTsunLock(lf, { alive: () => false, bootId: 'B' });
    w({ pid: 4242, bootId: 'A' }); const b = G.staleTsunLock(lf, { alive: () => true, cmdOf: () => 'node run-tsun.js', bootId: 'B' });
    w({ pid: 4242, bootId: 'B' }); const c = G.staleTsunLock(lf, { alive: () => true, cmdOf: () => '/usr/bin/python3 something', bootId: 'B' });
    w({ pid: 4242, bootId: 'B' }); const d = G.staleTsunLock(lf, { alive: () => true, cmdOf: () => 'nice -n 19 node /x/run-tsun.js --guard-tag …', bootId: 'B' }); const dKept = fs.existsSync(lf);
    ok(/dead/.test(a) && /another boot/.test(b) && /pid reused/.test(c) && d === null && dKept, 'lock-clean: 죽은 pid · 다른 부팅 · 살아 있지만 tsun 이 아닌 pid(재사용) 잠금은 지움, 살아 있는 run-tsun 잠금은 둠');
    const lf2 = path.join(T0, 'tl2.lock');
    const l1 = L.acquireLock(lf2, { pid: 4242, alive: () => true, bootId: 'OLD' });
    const l2 = L.acquireLock(lf2, { pid: 4343, alive: () => true, bootId: 'NEW' });
    ok(l2.stale && l2.stale.pid === 4242 && JSON.parse(fs.readFileSync(lf2, 'utf8')).bootId === 'NEW', 'run-tsun-lib acquireLock: 다른 부팅의 잠금은 pid 가 살아 있어도 낡음(bootId 기록)'); l2.release(); void l1;
    const killed = [];
    const k = G.staleHolds({ pgrep: () => '501\n502\n', ppidOf: p => (p === 501 ? 1 : 900), cmdOf: p => (p === 900 ? 'bash tools/genus-ruler/tsun/gpu-window.sh run' : 'systemd'), kill: p => killed.push(p) });
    ok(k.join() === '501' && killed.join() === '501', 'hold-clean: 부모가 gpu-window.sh 가 아닌 표지(죽은 창)만 끝냄 — 살아 있는 창의 표지는 둠');
  }
}

console.log('[4] 출력 경로');
{
  const ln = path.join(T0, 'link-to-harness'); try { fs.symlinkSync(path.join(REPO, '.harness'), ln); } catch { /* 있음 */ }
  ok(!!G.forbiddenPath(path.join(ln, 'gpuwin', 'out')) && !G.forbiddenPath(path.join(T0, 'plain', 'out')), 'forbiddenPath: GW_ROOT 아래 심볼릭 링크로 .harness/ 에 닿는 경로도 거부(realpath — 검토 13)');
  fs.unlinkSync(ln);
  ok(G.forbiddenPath(path.join(REPO, '.harness/volsky-grain/out')) && G.forbiddenPath(path.join(REPO, 'tools/genus-ruler/grain/x')) && G.forbiddenPath(path.join(REPO, 'tools/genus-ruler/tsun/scenes-tsun.json'))
    && G.forbiddenPath(path.join(REPO, 'src/x')) && !G.forbiddenPath(path.join(GW_ROOT, 'out')), 'forbiddenPath: .harness · grain · 동결 후보 · src 거부, scratchpad 허용');
  const bad = path.join(REPO, '.harness', 'gpuwin-should-not-exist');
  const r = run('bash', [SH, 'plan'], { GW_ROOT, GW_OUT: bad });
  ok(r.status === 2 && !fs.existsSync(bad), 'gpu-window.sh: GW_OUT 이 .harness/ 아래면 거부, 폴더도 만들지 않음');
  const outs = [];
  for (const l of planLines) {
    const t = l.split(/\s+/);
    const i = t.indexOf('--out'); if (i > 0) outs.push(t[i + 1]);
    const k = t.indexOf(path.join(__dirname, 'run-tsun.js')); if (k > 0) { const a = L.parseArgs(t.slice(k + 1).map(x => (/^<B0/.test(x) ? '1' : x)).filter(x => !/^\[.*\]$/.test(x))); outs.push(a.outDir, a.root); }
  }
  ok(outs.length >= 30 && outs.every(o => o.startsWith(GW_ROOT + '/') && !G.forbiddenPath(o)), `plan 의 모든 출력·번들 폴더(${outs.length})가 GW_ROOT 아래`);
}

console.log('[5] 표지');
{
  const f = path.join(T0, 'm', 'x.json');
  ok(!G.markerMatches(G.readMarker(f), 'a'), '표지 없음 → 다시 돌림');
  G.writeMarker(f, { id: 'x', status: 'done', inputSha: 'a' });
  ok(G.markerMatches(G.readMarker(f), 'a') && !G.markerMatches(G.readMarker(f), 'b'), 'done + 같은 입력 → 건너뜀, 입력이 바뀌면 다시');
  G.writeMarker(f, { id: 'x', status: 'partial', inputSha: 'a' });
  ok(!G.markerMatches(G.readMarker(f), 'a'), 'partial·failed·refused → 다시 돌림(run-tsun 이 끝난 잡은 meta sha 로 건너뜀)');
  const mm = st => G.markerMatches({ status: st, inputSha: 'a' }, 'a');
  ok(mm('timeout') && mm('stalled') && !G.markerMatches({ status: 'timeout', inputSha: 'a' }, 'a', { retry: true }) && mm('done-failures') && !G.markerMatches({ status: 'done-failures', inputSha: 'a' }, 'a', { retryWatchdog: true }),
    '같은 입력의 timeout·stalled 는 건너뜀(이어 돌릴 때마다 같은 60 분을 잃지 않게 — 검토 2·4) · GW_RETRY_FAILED·GW_RETRY_WATCHDOG 로 다시');
  {
    const dir = path.join(T0, 'cd'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.meta.json'), JSON.stringify({ captureOk: true })); fs.writeFileSync(path.join(dir, 'b.watchdog.txt'), 'x'); fs.writeFileSync(path.join(dir, 'c.error.txt'), 'x');
    ok(G.countDone(dir, [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }]) === 2, 'count-done: 끝난 잡 + 감시 시간에 걸려 건너뛰는 잡 = 진전(첫 잡이 감시 시간에 걸린 덩어리를 멈춤으로 세지 않음 — 검토 3)');
  }
  const a = path.join(T0, 'in1'); fs.writeFileSync(a, 'x');
  const s1 = G.inputSha([a]); fs.writeFileSync(a, 'y');
  ok(s1 !== G.inputSha([a]), 'input-sha 는 내용에 따라 바뀜');
}

console.log('[6] B0 결정');
{
  const meta = (f0, f, n = 16) => ({ frameMs: { all: [f0, ...Array(n - 1).fill(f)] }, wallMsOuter: f0 + f * (n - 1) });
  const a = G.decideB0(meta(60000, 8000), meta(60000, 9000), 55);
  ok(!a.scissorNeeded && Math.abs(a.refUnitMin - 8000 * 16 / 60000) < 1e-9 && a.watchdogScale === 1 && a.ref100WatchdogScale === 1 && !a.refBlocked && !a.ref100Blocked,
    `REF 8 s/그리기: 단위 ${a.refUnitMin.toFixed(2)} 분 · 배율 ${a.watchdogScale}(≥ 1 — 빠른 REF 가 감시 시간·컴파일 여유를 줄이지 않음, 검토 3) · 가위 불필요(첫 프레임 60 s 는 컴파일이라 뺌)`);
  const b = G.decideB0(meta(5000, 12000), meta(5000, 20000), 55);
  ok(b.scissorNeeded && b.refBlocked && b.ref100Blocked && b.gate === 'strict', 'REF 한 그리기 12 s > 10 s → 가위 대체 경로 필요(구현 안 됨) → REF·REF100 막힘(strict)');
  const b2 = G.decideB0(meta(5000, 12000), meta(5000, 20000), 55, { gate: 'relax' });
  ok(b2.scissorNeeded && !b2.refBlocked && !b2.ref100Blocked && /relax/.test(b2.reasons.join()), 'GW_REF_GATE=relax: > 10 s 여도 막지 않고 이유만 적음(사용자 결정 때만)');
  const b3 = G.decideB0(meta(5000, 9000), meta(5000, 18000), 55);
  ok(!b3.refBlocked && b3.ref100Blocked, 'REF 9 s 통과 · REF100 18 s → REF100 만 막힘(따로 봄)');
  const c = G.decideB0(meta(5000, 9000), meta(5000, 9900, 400), 55);
  ok(!c.scissorNeeded && !c.refBlocked && c.ref100Blocked && c.ref100WatchdogScale === 2 && c.watchdogScale === 1, `REF 9 s 통과 · REF100 단위 ${c.ref100UnitMin.toFixed(0)} 분 → REF100 배율 상한 2, 30×2 + 5 + 대기 12 > 55 분이라 REF100 만 막힘 · REF 배율 1`);
  const e = G.decideFromUnits({ unitMin: 25, drawMaxMs: 9000 }, null, 55, { gate: 'relax' });
  ok(e.refBlocked && /atmosphere 12/.test(e.reasons.join()), `REF 감시 시간 × 배율 + 첫 잡 5 + 대기 생성 12 > 55 → 막힘(검토 2: 대기 생성을 넣어 셈) — ${e.watchdogScale}`);
  const h = G.decideB0(meta(5000, 2000), null, 55, { ref100WatchdogHit: true });
  ok(!h.refBlocked && h.ref100Blocked && h.scissorNeeded && /30-min watchdog/.test(h.reasons.join()), 'B0 시간에서 REF100 이 30 분 감시 시간에 걸림 → REF100 막힘·한 그리기 > 10 s 로 적음');
  ok(G.decideB0(null, null).refBlocked === true && G.decideB0(null, null).ref100Blocked === true, 'B0 시간 meta 없음 → REF·REF100 막힘');
  // decide-b0 명령: 같은 결정이면 파일을 다시 쓰지 않음(검토 10)
  {
    const d = path.join(T0, 'b0t'); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'REF__RA1_s1.1_V1.meta.json'), JSON.stringify({ captureOk: true, ...meta(60000, 8000) }));
    const of = path.join(T0, 'dec.json'), lib = path.join(__dirname, 'gpuwin-lib.js');
    run('node', [lib, 'decide-b0', '--dir', d, '--out', of]); const t1 = fs.readFileSync(of, 'utf8');
    run('node', [lib, 'decide-b0', '--dir', d, '--out', of]); const t2 = fs.readFileSync(of, 'utf8');
    run('node', [lib, 'decide-b0', '--dir', d, '--out', of, '--ref-gate', 'relax']); const t3 = fs.readFileSync(of, 'utf8');
    ok(t1 === t2 && t1 !== t3 && JSON.parse(t3).gate === 'relax' && !fs.existsSync(of + '.tmp'), 'decide-b0: 같은 결정이면 decisions.json 그대로(decidedAt 이 REF 단계 입력 sha 를 바꾸지 않음) · 문이 바뀌면 새로 · 임시 파일 + 이름 바꾸기');
  }
}

console.log('[7] 출렁임 지표');
{
  const smooth = [], wavy = [];
  for (let e = -10; e <= 0.0001; e += 0.2) { const base = Math.exp(0.9 * e); smooth.push({ e, Y: base }); wavy.push({ e, Y: base * Math.exp(0.1 * Math.sin((2 * Math.PI * e) / 1.83)) }); }
  const ps = G.pulsing(smooth, [[-10, -6], [-6, -3]]), pw = G.pulsing(wavy, [[-10, -6], [-6, -3]]);
  ok(ps.every(b => b.rms < 1e-9) && pw.every(b => b.rms > 0.02), `지수 추세만이면 잔차 0, 1.83° 주기 ±10 % 출렁임이면 rms ${pw.map(b => b.rms.toFixed(3)).join('/')}`);
  ok(G.pulsing([{ e: 0, Y: 1 }, { e: 1, Y: 1 }], [[0, 1]])[0].rms === null, '점이 모자라면 null');
}

console.log('[8] 시간 어림');
{
  const man = JSON.parse(fs.readFileSync(path.join(JOBS, 'manifest.json'), 'utf8'));
  const e = G.estimateAll(man, null, 55);
  const dec2 = G.decideFromUnits({ unitMin: 2.2, drawMaxMs: 8250 }, { unitMin: 4.4, drawMaxMs: 16500 }, 55);
  const e2 = G.estimateAll(man, { ...dec2 }, 55), e3 = G.estimateAll(man, { refUnitMin: 3, refBlocked: true, ref100Blocked: true }, 55), er = G.estimateAll(man, null, 55, { gate: 'relax' });
  ok(e.totalMin[0] > 0 && e.totalMin[1] > e.totalMin[0] && e.rows.length === 25 && e.branches.length === 2, `어림(strict, 갈래 둘) ${e.totalH.map(x => x.toFixed(1)).join('–')} h, 페이지 ${e.chunks.join('–')} — ${e.branches.map(b => b.name.split(' (')[0] + ' ' + b.totalH.map(x => x.toFixed(1)).join('–')).join(' · ')}`);
  ok(e.branches.every(b => !b.stalledFiles.length) && e.branches.every(b => b.rows.every(r => !r.lost || r.lost[1] === 0)), '어림 흉내: 어느 갈래·쪽에서도 멈춘 파일·감시 시간에 잃는 잡 없음(검토 2·3 고친 뒤)');
  ok(e.totalMin[1] === Math.max(...e.branches.map(b => b.totalMin[1])) && e.totalMin[0] === Math.min(...e.branches.map(b => b.totalMin[0])), '전체 = 갈래 낮음의 최소 ~ 갈래 높음의 최대(검토 6)');
  ok(e.rows.filter(r => r.kind === 'page').every(r => r.total[0] >= G.PAGE_START[0]) && G.PAGE_START[0] >= G.ATMOS_MIN[0], '조명 페이지 어림에도 페이지 시작(대기 생성 7.5~12 분) 포함');
  ok(e2.refMeasured && e2.branches.length === 1 && !e2.rows.find(r => r.step === 'b2-ref.json').blocked[1] && e2.rows.find(r => r.step === 'b0-floor-ref100.json').kind === 'blocked', `B0 에서 REF 2.2 분/단위(8.3 s/그리기)를 재면 한 갈래 — REF 는 돌고 REF100(16.5 s)은 막힘 (${e2.totalH.map(x => x.toFixed(1)).join('–')} h)`);
  ok(e3.rows.filter(r => r.kind === 'blocked').length === 4, 'REF 막힘이면 b0-floor·b0-floor-ref100·b2-ref·b2-refval 은 어림에서 빠짐');
  ok(er.branches.length === 1 && er.totalMin[1] > e.totalMin[1], `relax 문(REF 2~15 분 모두 돎)은 높은 끝이 더 큼 ${er.totalH.map(x => x.toFixed(1)).join('–')} h`);
}

console.log('[9] WP7 탐침 uv 식 = 셰이더 gTsunUvOf');
{
  const sh = fs.readFileSync(path.join(REPO, 'src/components/VolumetricProbe/cloudTsunShader.ts'), 'utf8');
  const en = fs.readFileSync(path.join(__dirname, 'entry-gpuwin.ts'), 'utf8');
  const body = (src, head) => { const i = src.indexOf(head); const lines = src.slice(i).split('\n').slice(1, 9).map(l => l.replace(/^\s*'|',?\s*$/g, '').trim()); return lines.slice(1, lines.indexOf('}')); };
  const a = body(sh, "'vec2 gTsunUvOf(const vec3 p, const float blk, const float row) {'"), b = body(en, "'vec2 probeUvOf(const vec2 planarKm, const float blk, const float row) {'");
  ok(a.length === 6 && JSON.stringify(a) === JSON.stringify(b), '탐침의 ax·g·n·clamp·sz·return 여섯 줄이 셰이더와 글자까지 같음(첫 줄 km 만 다름 — 구면 → 평면 단계 없음)');
}

console.log('[10] 번들');
{
  const bt = JSON.parse(fs.readFileSync(path.join(GW_ROOT, 'bundle-tsun', 'bundle.json'), 'utf8')), bl = JSON.parse(fs.readFileSync(path.join(GW_ROOT, 'bundle-light', 'bundle.json'), 'utf8'));
  ok(bt.same === true && bl.same === true, `두 번 묶어 같은 sha — tsun ${bt.bundleSha256.slice(0, 12)} · light ${bl.bundleSha256.slice(0, 12)} (HEAD ${bt.gitHead.slice(0, 7)}, 더러운 파일 ${bt.dirtyFiles})`);
  const tsunJs = fs.readFileSync(path.join(GW_ROOT, 'bundle-tsun', 'app.js'), 'utf8');
  ok(/MAX_FRAGMENT_UNIFORM_VECTORS/.test(tsunJs) && /uniformVectors/.test(tsunJs), 'tsun 번들에 §180 균일변수 vec4 기록(B1)이 들어감');
  ok(!path.join(GW_ROOT, 'bundle-tsun').startsWith(path.join(REPO, '.harness')), '번들 폴더는 .harness/ 밖(GW_ROOT)');
}

if (PIN) {
  console.log('[11] 번들 고정(--pin)');
  // 시험 GW_ROOT: 번들·점검기는 복사, 잡은 진짜 폴더로 링크(같은 바이트로 다시 만들어짐). 렌더가 시작된 표지 + 다른 트리 sha 의 준비 표지 → prep 이 다시 묶어 비교.
  const PR = path.join(T0, 'pinroot'), PO = path.join(PR, 'out');
  fs.mkdirSync(path.join(PO, 'steps'), { recursive: true });
  for (const d of ['bundle-tsun', 'bundle-light', 'check']) fs.cpSync(path.join(GW_ROOT, d), path.join(PR, d), { recursive: true });
  fs.symlinkSync(JOBS, path.join(PR, 'jobs'));
  G.writeMarker(path.join(PR, 'prep.json'), { id: 'prep', status: 'done', inputSha: 'not-this-tree' });
  G.writeMarker(path.join(PO, 'steps', 'L1compile.json'), { id: 'L1compile', status: 'done', inputSha: 'x' });
  const bj0 = fs.readFileSync(path.join(PR, 'bundle-tsun', 'bundle.json'), 'utf8');
  const pa = run('bash', [SH, 'prep'], { GW_ROOT: PR, GW_OUT: PO, GW_LOCK: path.join(T0, 'pin.lock') }, { timeout: 900000 });
  const lg = fs.readFileSync(path.join(PO, 'logs', 'gpu-window.log'), 'utf8');
  ok(pa.status === 0 && /byte-identical to the pinned ones/.test(lg) && fs.readFileSync(path.join(PR, 'bundle-tsun', 'bundle.json'), 'utf8') === bj0, `prep: 트리가 바뀌어도 다시 묶은 app.js 가 같으면 고정 번들(bundle.json 째) 그대로 — 끝난 단계 입력 sha 가 안 바뀜 ${pa.status}`);
  fs.appendFileSync(path.join(PR, 'bundle-light', 'app.js'), '\n// pinned-but-different\n');
  G.writeMarker(path.join(PR, 'prep.json'), { id: 'prep', status: 'done', inputSha: 'not-this-tree-2' });
  const pb = run('bash', [SH, 'prep'], { GW_ROOT: PR, GW_OUT: PO, GW_LOCK: path.join(T0, 'pin.lock') }, { timeout: 900000 });
  ok(pb.status === 2 && /the bundle would change/.test(fs.readFileSync(path.join(PO, 'logs', 'gpu-window.log'), 'utf8')), 'prep: 렌더가 시작된 뒤 번들이 바뀌면 거부(2) — GW_REBUILD=1 이나 새 GW_OUT 으로만');
  fs.unlinkSync(path.join(PR, 'jobs'));
}

fs.rmSync(T0, { recursive: true, force: true });
console.log(fail ? `FAILURES ${fail} / ${pass + fail}` : `ALL PASS ${pass}`);
process.exit(fail ? 1 : 0);
