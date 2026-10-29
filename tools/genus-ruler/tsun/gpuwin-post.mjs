/**
 * §180 GPU 창 결과 정리(브라우저 없음 — 렌더 출력·meta 만 읽음). gpu-window.sh 가 단계 뒤에 부르고, 끝에 summary 로 한 JSON 에 모읍니다.
 * **판정 아님**: 기대값과의 대조를 'pass / fail / na' 로 적을 뿐 자(RULER-tsun) 판정·채택은 없음(판정 회차 없음, 2026-10-28 사용자 결정).
 *
 *   (모든 명령에 --jobs DIR — gpu-window.sh 의 잡 폴더 <GW_ROOT>/jobs, 기본 OUT/../jobs)
 *   node gpuwin-post.mjs light   --out OUT     §178: L1~L6 단계 JSON → reports/light.json
 *   node gpuwin-post.mjs b1      --out OUT     B1: 컴파일·링크·활성 샘플러·균일변수 vec4·T 글자 = C0ps 글자(해 30°)·진단 2~7 거부·아틀라스 결정성
 *   node gpuwin-post.mjs b0      --out OUT     B0: 비용(F_cloud T/C0ps 중앙 ≤ 1.15) · 비용 A/A · REF 시간 결정(decisions.json) · 바닥 페이지 상태
 *   node gpuwin-post.mjs b2      --out OUT     B2: R-A_T(ra-t.mjs unit, f16) 단위·가족 요약 · Floor_T · REF 검증 (i)(tsun_photo.py ra, 읽기만)
 *   node gpuwin-post.mjs w7      --out OUT     WP7: P1 아틀라스 읽기 대조 · P2 G-A(막힘: tsunDebug 5 없음) · P3 합성 덮개(T1/C0ps 덮개 Y, T 진단)
 *   node gpuwin-post.mjs summary --out OUT [--estimate F]   → OUT/gpu-window-summary.json(단계 표지 + 위 보고 + 어림)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '..', '..', '..');

const argv = process.argv.slice(2), cmd = argv[0];
const get = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = get('--out');
if (!OUT) { console.error('usage: gpuwin-post.mjs light|b1|b0|b2|w7|summary --out OUT'); process.exit(2); }
const R = path.join(OUT, 'reports');
fs.mkdirSync(R, { recursive: true });
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJ = (f, o) => { fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 1)); fs.renameSync(f + '.tmp', f); console.log('wrote', f); };
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const verdict = c => (c === null || c === undefined ? 'na' : c ? 'pass' : 'fail');
/** run-tsun 출력 폴더의 잡 상태: meta(captureOk) / error.txt / watchdog.txt / 없음. */
function jobState(dir, name) {
  const m = readJ(path.join(dir, name + '.meta.json'));
  if (m && m.captureOk === true) return { state: 'ok', meta: m };
  const err = fs.existsSync(path.join(dir, name + '.error.txt')) ? fs.readFileSync(path.join(dir, name + '.error.txt'), 'utf8').slice(0, 600) : null;
  if (fs.existsSync(path.join(dir, name + '.watchdog.txt'))) return { state: 'watchdog', error: err };
  return err ? { state: 'error', error: err } : { state: 'missing' };
}
const jobsOf = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
const JOBSD = get('--jobs', path.join(OUT, '..', 'jobs'));
const J = f => path.join(JOBSD, f);
let PNG = null;
const png = f => { if (!PNG) PNG = require(path.join(REPO, 'node_modules/pngjs')).PNG; const p = PNG.sync.read(fs.readFileSync(f)); return { d: p.data, W: p.width, H: p.height }; };
const lin = c => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
/** 그림 PNG + 알파 PNG → 구름 화소(α ≥ 0.5)의 표시 선형 Y 평균·수. */
function cloudY(base) {
  if (!fs.existsSync(base + '.png') || !fs.existsSync(base + '.alpha.png')) return null;
  const c = png(base + '.png'), a = png(base + '.alpha.png');
  let s = 0, n = 0;
  for (let i = 0; i < c.W * c.H; i++) { if (a.d[i * 4] < 128) continue; s += 0.2126 * lin(c.d[i * 4]) + 0.7152 * lin(c.d[i * 4 + 1]) + 0.0722 * lin(c.d[i * 4 + 2]); n++; }
  return { meanY: n ? s / n : null, n };
}

function cmdLight() {
  const D = path.join(OUT, 'L'), st = n => readJ(path.join(D, n + '.json'));
  const rep = { note: '§178 렌더 확인 — 기대값 대조(판정 아님)', stages: {} };
  const L1 = st('L1compile');
  if (L1) {
    const runs = L1.result.runs;
    rep.stages.L1compile = { ok: L1.ok, verdict: verdict(L1.ok && runs.every(r => r.ok) && runs.filter(r => r.flags === 'on').every(r => r.marks.clamp >= 1 && r.marks.logmu >= 1) && runs.filter(r => r.flags === 'off').every(r => r.marks.clamp === 0 && r.marks.logmu === 0)),
      runs: runs.map(r => ({ q: r.quality, flags: r.flags, ok: r.ok, marks: r.marks, newPrograms: r.newPrograms, frameMs: r.frameMs })) };
  }
  const L2 = st('L2deck');
  if (L2) {
    const by = {}; for (const r of L2.result.runs) (by[r.quality] ??= {})[r.flags] = r;
    rep.stages.L2deck = { ok: L2.ok, perQuality: Object.fromEntries(Object.entries(by).map(([q, f]) => {
      const on = f.on?.rt?.deck6_10, off = f.off?.rt?.deck6_10;
      const notBlack = on && on.n > 0 ? on.fracNeg === 0 && on.min >= -1e-3 : null;
      return [q, { sunAltDeg: f.on?.sunAltDeg, deckTexels: on?.n, rtY: { off: off && { min: off.min, median: off.median, fracNeg: off.fracNeg }, logmu: f.logmu?.rt?.deck6_10 && { min: f.logmu.rt.deck6_10.min, median: f.logmu.rt.deck6_10.median, fracNeg: f.logmu.rt.deck6_10.fracNeg }, on: on && { min: on.min, median: on.median, fracNeg: on.fracNeg } },
        display: { off: f.off?.display, on: f.on?.display }, defectReproducedWhenOff: off ? off.fracNeg > 0 : null, verdictNotBlack: verdict(notBlack),
        displayNotDarker: verdict(f.on?.display?.medianY != null && f.off?.display?.medianY != null ? f.on.display.medianY >= f.off.display.medianY : null) }];
    })) };
  }
  for (const n of ['L3twilight', 'L4sunset']) {
    const s = st(n); if (!s) continue;
    const pc = s.result.pulsing?.clamp ?? [], po = s.result.pulsing?.on ?? [];
    rep.stages[n] = { ok: s.ok, bands: pc.map((b, i) => ({ band: b.band, rmsLogmuOff: b.rms, rmsLogmuOn: po[i]?.rms, p2pRatioOff: b.p2pRatio, p2pRatioOn: po[i]?.p2pRatio, reduction: b.rms && po[i]?.rms != null ? b.rms / Math.max(po[i].rms, 1e-12) : null })),
      verdictNotWorse: verdict(pc.length ? pc.every((b, i) => po[i]?.rms == null || b.rms == null || po[i].rms <= b.rms * 1.05) : null) };
  }
  const L5 = st('L5cross12');
  if (L5) rep.stages.L5cross12 = { ok: L5.ok, runs: L5.result.runs.map(r => ({ q: r.quality, config: r.config, rows: r.rows.map(x => ({ time: x.time, sun: +x.sunAltDeg.toFixed(2),
    shadowTop: { fixed: x.fixed?.top, preFix: x.preFix?.top, fresh: x.fresh?.top }, Y: { fixed: x.fixed?.Y?.mean, preFix: x.preFix?.Y?.mean, fresh: x.fresh?.Y?.mean },
    ratioFixedOverPreFix: x.ratioFixedOverPreFix, ratioFixedOverFresh: x.ratioFixedOverFresh, fixedEqualsFreshTop: x.fixed?.top === x.fresh?.top })) })) };
  const L6 = st('L6frametime');
  if (L6) rep.stages.L6frametime = { ok: L6.ok, medianMs: L6.result.medianMs, deltaVsOff: L6.result.deltaVsOff, expectation: '≤ 1~2 % [estimate §178.6]; SwiftShader CPU timings are noisy (ABBA ×2)' };
  rep.missing = ['L1compile', 'L2deck', 'L3twilight', 'L4sunset', 'L5cross12', 'L6frametime'].filter(n => !st(n));
  writeJ(path.join(R, 'light.json'), rep);
}

function cmdB1() {
  const rep = { note: 'B1 — 모든 T_sun 변형 컴파일·링크(품질마다 한 페이지)', perQuality: {} };
  for (const q of ['low', 'medium', 'high']) {
    const dir = path.join(OUT, 'B1-' + q), jobs = jobsOf(J(`b1-${q}.json`));
    const rows = jobs.map(j => { const s = jobState(dir, j.name); const m = s.meta; return { name: j.name, arm: j.arm, dbg: j.options.tsunDebug, state: s.state, error: s.error,
      samplers: m?.cloudSamplers ? { active: m.cloudSamplers.active, staticExpected: m.cloudSamplers.staticExpected, maxTextures: m.cloudSamplers.maxTextures } : null,
      uniformVectors: m?.uniformVectors ?? null, shaderClouds: m?.shaderHash?.clouds ?? null, injected: m?.tsun?.injected ?? null }; });
    const hs = n => rows.find(r => r.name === `B1${q[0]}__${n}__HS_RA1_s30_V1`);
    const c0 = hs('C0ps');
    const base = rows.find(r => r.name === `B1${q[0]}__C0ps__RA1_s1.1_V1`);
    const uvMax = Math.max(...rows.map(r => r.uniformVectors?.vectors ?? -Infinity));
    rep.perQuality[q] = { jobs: rows.length, ok: rows.filter(r => r.state === 'ok').length, failed: rows.filter(r => r.state !== 'ok').map(r => ({ name: r.name, state: r.state, error: r.error })),
      textAbove12EqualsC0ps: verdict(c0 && c0.shaderClouds ? ['T1', 'T1A'].every(a => hs(a)?.shaderClouds === c0.shaderClouds) : null),
      samplers: rows.filter(r => r.samplers).map(r => ({ name: r.name, ...r.samplers })),
      uniformVectors: { maxActiveVectors: Number.isFinite(uvMax) ? uvMax : null, C0psVectors: base?.uniformVectors?.vectors ?? null,
        maxFragment: rows.find(r => r.uniformVectors)?.uniformVectors?.maxFragment ?? null, webgl2MinFragment: 224,
        perJob: rows.filter(r => r.uniformVectors).map(r => ({ name: r.name, vectors: r.uniformVectors.vectors, deltaVsC0ps: base?.uniformVectors ? r.uniformVectors.vectors - base.uniformVectors.vectors : null })) },
      samplerWithinLimit: verdict(rows.some(r => r.samplers) ? rows.every(r => !r.samplers || r.samplers.maxTextures == null || r.samplers.active <= r.samplers.maxTextures) : null),
      samplerWithinWebgl2Min16: verdict(rows.some(r => r.samplers) ? rows.every(r => !r.samplers || r.samplers.active <= 16) : null) };
    rep.perQuality[q].verdictCompile = verdict(rows.length ? rows.every(r => r.state === 'ok') : null);
  }
  const rj = jobsOf(J('b1-refuse.json')), rd = path.join(OUT, 'B1-refuse');
  const refusals = rj.map(j => { const s = jobState(rd, j.name); return { name: j.name, dbg: j.options.tsunDebug, state: s.state, refusedAsExpected: s.state === 'error' && /not implemented/.test(s.error || '') }; });
  rep.debugRefusals = { rows: refusals, verdict: verdict(refusals.length ? refusals.every(r => r.refusedAsExpected) : null), note: 'tsunDebug 2~7 = 이 묶음에 셰이더 없음(TSUN_IMPLEMENTED) — 잡 실패(error.txt)가 기대값' };
  const dd = path.join(OUT, 'B1-det'), dj = jobsOf(J('b1-det.json')).map(j => jobState(dd, j.name));
  const shas = dj.map(s => s.meta?.tsun?.atlas?.sha ?? null);
  rep.atlasDeterminism = { shas, verdict: verdict(shas.length === 2 && shas.every(Boolean) ? shas[0] === shas[1] : null), note: 'ruler-delta E2: 같은 T1 잡 둘 → 같은 아틀라스 sha(tsunSync 1)' };
  writeJ(path.join(R, 'b1.json'), rep);
}

function cmdB0() {
  const rep = { note: 'B0 — 비용·REF 시간·바닥 페이지(판정 아님)' };
  const dec = readJ(path.join(OUT, 'decisions.json'));
  rep.refTiming = dec ?? { missing: true };
  const cd = path.join(OUT, 'B0-cost'), cj = jobsOf(J('b0-cost.json'));
  const F = {}; const fails = [];
  for (const j of cj) {
    const s = jobState(cd, j.name);
    if (s.state !== 'ok' || !s.meta.cost) { fails.push({ name: j.name, state: s.state }); continue; }
    const unit = j.name.slice(j.arm.length + 2);
    (F[unit] ??= {})[j.arm] = { fetch: s.meta.cost.fetch, fetchTsun: s.meta.cost.fetchTsun, nTsun: s.meta.cost.nTsun, capFrac: s.meta.cost.capFrac, overflow: s.meta.cost.overflow };
  }
  const ratios = arm => Object.entries(F).filter(([, v]) => v[arm] && v.C0ps).map(([u, v]) => ({ unit: u, below12: !/_e(20|45)_/.test(u), r: v[arm].fetchTsun / v.C0ps.fetchTsun }));
  rep.cost = { cap: 1.15, definition: 'F_cloud = x + y + z + n_tsun (+ n_archLUT) per texel, ratio to C0ps on the same unit; median over units (ruler-delta F8)', failedJobs: fails };
  for (const arm of ['T1', 'T2', 'T1A']) {
    const rs = ratios(arm), below = rs.filter(r => r.below12);
    rep.cost[arm] = { units: rs.length, medianAll: median(rs.map(r => r.r)), medianBelow12: median(below.map(r => r.r)), max: rs.length ? Math.max(...rs.map(r => r.r)) : null,
      above12AllOne: rs.filter(r => !r.below12).every(r => Math.abs(r.r - 1) < 1e-9) || null, verdictMedianBelow12: verdict(below.length ? median(below.map(r => r.r)) <= 1.15 : null), perUnit: rs };
  }
  const aa = ['b0-costaa-1', 'b0-costaa-2'].map(f => { const j = jobsOf(J(f + '.json'))[0]; return j ? jobState(path.join(OUT, 'B0-' + f.slice(3)), j.name).meta?.cost ?? null : null; });
  rep.costAA = { a: aa[0], b: aa[1], verdict: verdict(aa[0] && aa[1] ? ['x', 'y', 'z', 'nTsun'].every(k => aa[0][k] === aa[1][k]) && aa[0].nTsun === 0 : null), note: 'ruler-delta E2: decoded x·y·z·n_tsun identical, n_tsun 0 on C0' };
  const fd = path.join(OUT, 'B0-floor'), fj = jobsOf(J('b0-floor.json'));
  rep.floorPage = fj.map(j => { const s = jobState(fd, j.name); return { name: j.name, state: s.state, wallMin: s.meta ? s.meta.wallMsOuter / 60000 : null }; });
  rep.scissorDecision = dec ? { scissorNeeded: dec.scissorNeeded, refDrawMaxMs: dec.ref?.drawMaxMs, ref100DrawMaxMs: dec.ref100?.drawMaxMs, refBlocked: dec.refBlocked, reasons: dec.reasons } : null;
  writeJ(path.join(R, 'b0.json'), rep);
}

function raT(cDir, cName, rDir, rName, cImgDir, cImg, rImgDir, rImg) {
  const f = (d, n, s) => path.join(d, n + s);
  const need = [f(cDir, cName, '.debug.f16'), f(cDir, cName, '.meta.json'), f(rDir, rName, '.debug.f16'), f(rDir, rName, '.meta.json'), f(cImgDir, cImg, '.alpha.png'), f(rImgDir, rImg, '.alpha.png')];
  const miss = need.filter(x => !fs.existsSync(x));
  if (miss.length) return { missing: miss.map(x => path.basename(x)) };
  try {
    const out = execFileSync('node', [path.join(HERE, 'ra-t.mjs'), 'unit', '--cand-f16', need[0], '--cand-meta', need[1], '--ref-f16', need[2], '--ref-meta', need[3], '--cand-alpha', need[4], '--ref-alpha', need[5]], { encoding: 'utf8', maxBuffer: 64 << 20 });
    return JSON.parse(out.trim().split('\n').pop());
  } catch (e) { return { error: String(e.message).slice(0, 400) }; }
}
function cmdB2() {
  const rep = { note: 'B2 — R-A_T(보고만, U1 미정) · REF 검증 (i)(보고)' };
  const T = path.join(OUT, 'B2'), B0F = path.join(OUT, 'B0-floor');
  const units = [...new Set(jobsOf(J('b2-ref.json')).map(j => j.unit))];
  const per = [];
  for (const u of units) for (const c of ['T1', 'T2']) {
    const r = raT(T, `${c}__${u}__dbg1`, T, `REF__${u}__dbg1`, T, `${c}__${u}`, T, `REF__${u}`);
    per.push({ unit: u, family: u.split('_')[0], cand: c, ...summ(r) });
  }
  function summ(r) {
    if (!r || r.missing || r.error) return { status: r?.missing ? 'missing' : 'error', detail: r?.missing ?? r?.error };
    const e = r.byEps || {};
    return { status: r.degenerate ? 'degenerate' : 'ok', n_inf: r.n_inf, byEps: Object.fromEntries(Object.entries(e).map(([k, v]) => [k, { b_T: v.b_T, e_T: v.e_T, p75_T: v.p75_T }])), refFlag: r.refFlag };
  }
  rep.raT = per;
  const fam = {};
  for (const r of per) { if (r.status !== 'ok') continue; const k = r.family + '/' + r.cand; (fam[k] ??= []).push(r); }
  rep.raTFamilies = Object.fromEntries(Object.entries(fam).map(([k, rs]) => [k, Object.fromEntries(['0.01', '0.03', '0.1'].map(eps => [eps, { n: rs.length, median_b_T: median(rs.map(r => r.byEps?.[eps]?.b_T)), median_e_T: median(rs.map(r => r.byEps?.[eps]?.e_T)) }]))]));
  // Floor_T: REF 진단 A/A(바닥 페이지 B vs B2 페이지 A) · REF100 진단 vs REF 진단(같은 페이지 B)
  const floorUnits = [...new Set(jobsOf(J('b0-floor.json')).filter(j => j.arm === 'REF100').map(j => j.unit))];
  const fl = [];
  for (const u of floorUnits) {
    fl.push({ unit: u, kind: 'REF A/A', ...summ(raT(B0F, `REF__${u}__dbg1`, T, `REF__${u}__dbg1`, B0F, `REF__${u}`, T, `REF__${u}`)) });
    fl.push({ unit: u, kind: 'REF100 vs REF', ...summ(raT(B0F, `REF100__${u}__dbg1`, B0F, `REF__${u}__dbg1`, B0F, `REF100__${u}`, B0F, `REF__${u}`)) });
  }
  rep.floorT = { rows: fl, byEps: Object.fromEntries(['0.01', '0.03', '0.1'].map(eps => [eps, ['b_T', 'e_T', 'p75_T'].reduce((a, k) => ({ ...a, [k]: Math.max(...fl.filter(r => r.status === 'ok').map(r => Math.abs(r.byEps?.[eps]?.[k] ?? NaN)).filter(Number.isFinite), -Infinity) }), {})])) };
  // REF 검증 (i): REF_val vs C0, HS 45·30·15° — tsun_photo.py ra(동결 후보, 읽기만)
  const hs = [...new Set(jobsOf(J('b2-refval.json')).map(j => j.unit))];
  rep.refValidation = hs.map(u => {
    const a = path.join(T, `REFval__${u}.png`), b = path.join(T, `C0__${u}.png`);
    if (!fs.existsSync(a) || !fs.existsSync(b)) return { unit: u, status: 'missing' };
    try { return { unit: u, status: 'ok', ra: JSON.parse(execFileSync('python3', ['-I', path.join(HERE, 'tsun_photo.py'), 'ra', a, b], { encoding: 'utf8', maxBuffer: 64 << 20 }).trim().split('\n').pop()) }; }
    catch (e) { return { unit: u, status: 'error', detail: String(e.message).slice(0, 300) }; }
  });
  rep.counts = { raTUnits: per.length, raTok: per.filter(r => r.status === 'ok').length, degenerate: per.filter(r => r.status === 'degenerate').length, missing: per.filter(r => r.status === 'missing').length };
  writeJ(path.join(R, 'b2.json'), rep);
}

function cmdW7() {
  const rep = { note: 'WP7 GPU 일치(보고)' };
  const a = readJ(path.join(OUT, 'L', 'W7atlas.json'));
  rep.P1atlas = a ? { ok: a.ok, tolerance: a.result.tolerance, note: a.result.note, rows: a.result.results.map(r => ({ unit: r.unit, arm: r.arm, skipped: r.skipped, samples: r.samples, fail: r.fail, maxAbs: r.probes ? Math.max(...r.probes.map(p => p.maxAbs)) : null, atlasSha: r.atlasSha })),
    verdict: verdict(a.result.results.some(r => r.samples) ? a.result.results.every(r => r.skipped || r.fail === 0) : null) } : { missing: true };
  rep.P2GA = { status: 'blocked', reason: 'G-A needs shader debug E_arch (tsunDebug 5); this bundle implements tsunDebug 0|1 only (cloudTsun TSUN_IMPLEMENTED) — the CPU side (archcpu ↔ archQuad U5b) passed in §179' };
  const E = path.join(OUT, 'W7-emu'), T = path.join(OUT, 'B2');
  rep.P3emu = jobsOf(J('w7-emu.json')).map(j => {
    const u = j.unit, c = cloudY(path.join(E, `C0ps__${u}`)), t = cloudY(path.join(T, `T1__${u}`));
    const dm = readJ(path.join(T, `T1__${u}__dbg1.meta.json`)), rm = readJ(path.join(T, `REF__${u}__dbg1.meta.json`));
    return { unit: u, C0psY: c?.meanY ?? null, T1Y: t?.meanY ?? null, ratioT1overC0ps: c?.meanY && t?.meanY != null ? t.meanY / c.meanY : null, T1debugMeanMip: dm?.debug?.meanMip ?? null, REFdebugCovered: rm?.debug?.covered ?? null,
      note: 'emulator (arch/emu.py · p3light/emulate.py) comparison is a CPU step after the window' };
  });
  writeJ(path.join(R, 'w7.json'), rep);
}

function cmdSummary() {
  const steps = {};
  const sd = path.join(OUT, 'steps');
  if (fs.existsSync(sd)) for (const f of fs.readdirSync(sd).filter(f => f.endsWith('.json')).sort()) steps[f.replace(/\.json$/, '')] = readJ(path.join(sd, f));
  const est = get('--estimate') ? readJ(get('--estimate')) : null;
  const sum = { note: '§180 GPU 창 요약 — 단계 표지 + 보고(판정 아님). 다시 돌리면 끝난 단계는 건너뜀.', updatedAt: new Date().toISOString(), out: OUT,
    run: readJ(path.join(OUT, 'run.json')), estimate: est && { totalMin: est.totalMin, totalH: est.totalH, chunks: est.chunks, refMeasured: est.refMeasured },
    steps, reports: Object.fromEntries(['light', 'b1', 'w7', 'b0', 'b2'].map(k => [k, readJ(path.join(R, k + '.json'))])), decisions: readJ(path.join(OUT, 'decisions.json')) };
  writeJ(path.join(OUT, 'gpu-window-summary.json'), sum);
}

({ light: cmdLight, b1: cmdB1, b0: cmdB0, b2: cmdB2, w7: cmdW7, summary: cmdSummary }[cmd] ?? (() => { console.error('unknown command ' + cmd); process.exit(2); }))();
