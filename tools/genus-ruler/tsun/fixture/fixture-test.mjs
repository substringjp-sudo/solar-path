#!/usr/bin/env node
/**
 * fixture-test.mjs — §179 WP1 고정표 단위 시험(design v2 §8 U1a~U1d, v2.1 §8 U1b′·U1e·U1f). CPU 만, 렌더 없음.
 *
 *   nice -n 19 node tools/genus-ruler/tsun/fixture/fixture-test.mjs [--fixture=<dir>] [--tmp=<dir>] [--u1c=<dirA>,<dirB>]
 *
 * 법칙 쪽은 src/components/VolumetricProbe/tsunFixture.ts(빌더가 쓸 평가기)를 esbuild 로 묶어 부르고, 무차별 쪽은 같은 C 핵(tsunfix.c)을
 * **다른 씨앗·행 1024**로, 격자 밖 값(운량 = 장면의 역표 운량, hf 0.13/0.37/0.62/0.88, 방위 = 사진·RA 해 방위)에서 돌립니다.
 * 그래서 U1b 는 표 보간(c·hf·φ)과 표본 잡음만 잽니다(같은 밀도 복제 — 렌더러와의 차이는 WP7/R-A_T 몫).
 *
 * U1a (보고 — v2.1 §8 이 U1b′ 로 대체): 맑은 시작 자유 경로 P(τ(0,l) < 0.105) 의 국소 비율이 4·8·16 km 에서 5 % 안(지수 법칙).
 * U1b (관문): |ln(⟨T⟩_brute / T_law)| ≤ ln 1.25, T_brute ≥ 0.01, 8 방위(P1·P2·P3 + RA +8·+4·+1.1·−1.0·−2.5°), L 2~20 km.
 * U1c (관문, --u1c 가 있을 때): 두 번 만든 표의 bin·json 바이트가 같음(sha256).
 * U1d (보고): 모양 잡음 없는 바이트만의 λ₁₀ ÷ 침식한 λ₁₀ (설계 예상 sc ×1.8).
 * U1e (관문): 구름 안 시작 도달 0.25/0.5/1.1 km 뒤 L 2/5/10 km 의 τ: 무차별(σ 가중) 대 τ_x(L) + τ_c(L), |Δτ| ≤ 0.3 (T_brute ≥ 0.01).
 *      τ_c 는 방위(360° — 해 쪽 방향 그대로; 조건부 창은 뒤집기 대칭이 아님)·L 별 표(tauCPhi — 빌더가 해 방위로 읽음)로 판정.
 *      방위 평균 L 별(tauCL)·설계의 상수(tauC, 균일 변수 표 형태)·τ_c 없음·뒤집힌 방위(φ + 180°)로 읽은 τ_c·몬테카를로 바닥은
 *      같은 점에서 보고(§179 결정).
 * U1f (보고): mip 1 ÷ mip 0 의 λ₁₀·τ(5 km)·τ(10 km).
 * U1g (관문, §179 검토 반영 물리 6): 기운 직선(관측 기둥 hf 0.02/0.35/0.68 · 해 0.3/1.1/4/8°)에서 무차별 ⟨T⟩(tsunslope.c — tsunfix.c 를 포함한 같은
 *      밀도 복제) 대 LP3 법칙 값(tsunAtlas.ts tsunLineTau, 성장 곡선 G(Λ; c_eff, hf_eff)) |ln| ≤ ln 1.25 (T ≥ 0.01).
 * 덧붙임(보고): 거시 문턱 근사(타일 C₀ 0.9 를 문턱으로 c 까지 깎은 장 대 c 로 만든 장) · 레인 대체(다른 실현) 오차.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import * as F from './fixture-lib.mjs';

const FIX = path.resolve(F.argOf('fixture', F.HERE));
const TMP = F.tmpDir(F.argOf('tmp'));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok === null ? 'REPORT' : ok ? 'PASS' : 'FAIL'}  ${name}  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); };

// ───── U1c: 두 번 만든 표 비교(다른 시험보다 먼저 — 표를 읽지 않음) ─────
const u1c = F.argOf('u1c');
if (u1c) {
  const [a, b] = u1c.split(',').map(p => path.resolve(p));
  const h = (d, f) => F.sha256(fs.readFileSync(path.join(d, f)));
  const binA = h(a, 'tsun-fixture.bin'), binB = h(b, 'tsun-fixture.bin'), jsA = h(a, 'tsun-fixture.json'), jsB = h(b, 'tsun-fixture.json');
  check('U1c byte-identical twice', binA === binB && jsA === jsB, { bin: [binA, binB], json: [jsA, jsB] });
}

// ───── 표 읽기 ─────
const header = JSON.parse(fs.readFileSync(path.join(FIX, 'tsun-fixture.json'), 'utf8'));
const bytes = fs.readFileSync(path.join(FIX, 'tsun-fixture.bin'));
if (F.sha256(bytes) !== header.binSha256) throw new Error('tsun-fixture.bin sha256 이 머리말과 다름');
const tsBundle = path.join(TMP, 'tsunFixture.cjs');
execFileSync('npx', ['esbuild', path.join(F.ROOT, 'src/components/VolumetricProbe/tsunFixture.ts'), '--bundle', '--format=cjs', '--platform=node',
  `--outfile=${tsBundle}`, '--log-level=warning'], { cwd: F.ROOT, stdio: 'inherit' });
const require = createRequire(import.meta.url);
const X = require(tsBundle);
const fx = X.parseTsunFixture(header, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
const { G } = F.loadApp(TMP, header.provenance.srcRev);

// ───── 시험 칸 ─────
const AZ = { P1: 272.6585, P2: 268.972, P3: 263.3732, 'RA+8': 258.4065, 'RA+4': 261.3188, 'RA+1.1': 263.3783, 'RA-1.0': 264.8527, 'RA-2.5': 265.8986 };
const HF_T = [0.13, 0.37, 0.62, 0.88];
// 장면(scenes-tsun.json)의 예보 운량 → 앱 역표(genusCoverIn) — 표 격자 밖 운량
const SCENES = [
  { name: 'P3B sc', genus: 'sc', lane: 0, cover: G.genusCoverIn('sc', 0.45) },
  { name: 'P2B sc', genus: 'sc', lane: 0, cover: G.genusCoverIn('sc', 0.75) },
  { name: 'P2B ac', genus: 'ac', lane: 1, cover: G.genusCoverIn('ac', 0.5) },
  { name: 'P3B/RA1 ac', genus: 'ac', lane: 1, cover: G.genusCoverIn('ac', 0.85) },
  { name: 'P1B ac', genus: 'ac', lane: 2, cover: G.genusCoverIn('ac', 0.75) },
  { name: 'P1B cu', genus: 'cu', lane: 0, cover: G.genusCoverIn('cu', 0.5) },
  { name: 'RA4 ci', genus: 'ci', lane: 2, cover: G.genusCoverIn('ci', 0.6) },
  { name: 'P1CF ns', genus: 'ns', lane: 1, cover: G.genusCoverIn('ns', 1.0) },
  { name: 'RA5 sc', genus: 'sc', lane: 0, cover: G.genusCoverIn('sc', 0.6) },
].filter(s => header.entries.some(E => E.genus === s.genus && E.lane === s.lane));
// 무차별 기준: 행 1024(R2 점 집합 — T ≈ 0.01~0.03 에서 ln 표준편차 ≤ 0.05 [measured, 씨앗 12]). FLOOR 는 표와 같은 표본 설정의
// 독립 무차별 — 법칙 없이 "표 표본 잡음만으로" U1b 를 넘는 비율(몬테카를로 바닥, 보고).
const TEST_PARAM = { ...F.BUILD_PARAM, rows: 1024, lattice: 2 }; // R2 — 황금비 격자는 행 수에 따라 공명(tsunfix.c 머리말)
const FLOOR_PARAM = { ...F.BUILD_PARAM };
const TEST_SEED = 0x7e57a179n;

const tiles = [], cells = [];
const tileOf = new Map();
const addTile = (key, make) => { if (!tileOf.has(key)) { tiles.push(make()); tileOf.set(key, tiles.length - 1); } return tileOf.get(key); };
SCENES.forEach((s, si) => {
  s.prof = F.genusProfile(G, s.genus);
  const E = F.ENTRIES.find(e => e.genus === s.genus && e.lane === s.lane);
  s.opts = E?.opts;
  s.tile = addTile(`${si}`, () => F.tileBytes(G, s.genus, s.lane, s.cover, s.opts));
  HF_T.forEach((hf, hi) => Object.entries(AZ).forEach(([an, az], ai) => {
    cells.push({ kind: 'main', si, hf, an, az, tile: s.tile, prof: s.prof, phi: az, seed: F.cellSeed(TEST_SEED, si, hi, ai) });
  }));
  // U1d(모양 잡음 없음)·U1f(mip 1): P3 방위, hf 0.37/0.62
  for (const hf of [0.37, 0.62]) {
    cells.push({ kind: 'raw', si, hf, an: 'P3', tile: s.tile, prof: s.prof, shapeAmount: 0, phi: AZ.P3, seed: F.cellSeed(TEST_SEED, 100 + si, hf) });
    cells.push({ kind: 'ero', si, hf, an: 'P3', tile: s.tile, prof: s.prof, phi: AZ.P3, seed: F.cellSeed(TEST_SEED, 100 + si, hf) });
    cells.push({ kind: 'mip1', si, hf, an: 'P3', tile: s.tile, prof: s.prof, mip: 1, phi: AZ.P3, seed: F.cellSeed(TEST_SEED, 100 + si, hf) });
  }
});
// 거시 문턱 근사: 타일 C₀ = 역표(0.9) 를 macroThresholdTable 로 c 까지 깎음 — c 로 만든 장(P3B sc, P2B ac)과 비교
for (const si of [0, 2]) {
  const s = SCENES[si];
  if (!s) continue;
  const c0 = G.genusCoverIn(s.genus, 0.9);
  const base = F.tileBytes(G, s.genus, s.lane, c0, s.opts);
  const rgba = new Uint8Array(256 * 256 * 4);
  for (let i = 0; i < 65536; i++) rgba[i * 4 + s.lane] = base[i];
  const lut = G.macroThresholdTable(rgba, 256, s.lane);
  // 셰이더: genusMacroLut 는 64 칸 RGBA8 선형 — c 를 칸 좌표로 읽어 이웃 두 칸 바이트를 선형 보간
  const xq = s.cover * 63, i0 = Math.floor(xq), t = xq - i0;
  const b0 = Math.round(Math.min(1, Math.max(0, lut[i0])) * 255), b1 = Math.round(Math.min(1, Math.max(0, lut[Math.min(63, i0 + 1)])) * 255);
  const sThr = (b0 * (1 - t) + b1 * t) / 255;
  const ti = addTile(`macro${si}`, () => base);
  for (const hf of [0.37, 0.62]) {
    cells.push({ kind: 'macro', si, hf, an: 'P3', tile: ti, prof: s.prof, macroS: sThr, phi: AZ.P3, seed: F.cellSeed(TEST_SEED, 200 + si, hf), c0, sThr });
  }
}
const tilesPath = path.join(TMP, 'tiles-test.bin');
fs.writeFileSync(tilesPath, Buffer.concat(tiles));
const exe = F.compileCore(TMP);
const t0 = Date.now();
const recs = await F.runCore(exe, tilesPath, F.planText(TEST_PARAM, cells), path.join(TMP, 'cells-test.f64'));
console.log(`무차별 ${cells.length} 칸 ${((Date.now() - t0) / 1000).toFixed(1)} s (rows ${TEST_PARAM.rows}, start ${TEST_PARAM.startStep} km)`);
cells.forEach((c, i) => { c.rec = recs[i]; });
const mainCells = cells.filter(c => c.kind === 'main');
const t1 = Date.now();
const floorRecs = await F.runCore(exe, tilesPath, F.planText(FLOOR_PARAM, mainCells.map(c => ({ ...c, seed: F.cellSeed(TEST_SEED ^ 0xf100n, c.si, c.hf, c.az) }))), path.join(TMP, 'cells-floor.f64'));
mainCells.forEach((c, i) => { c.floor = floorRecs[i]; });
console.log(`바닥(표 설정) ${mainCells.length} 칸 ${((Date.now() - t1) / 1000).toFixed(1)} s`);

const Li = l => F.L_GRID.indexOf(l);
const lamOfRec = r => { // 표와 같은 λ₁₀ 규칙
  for (let l = F.L_GRID.length - 1; l >= 0; l--) {
    if (F.L_GRID[l] > 10) continue;
    const t = -Math.log(Math.max(r.meanT[l], 1e-300));
    if (t <= Math.log(1e4) || l === 0) return t / F.L_GRID[l];
  }
  return 0;
};
const entryOf = s => X.tsunFixtureEntry(fx, s.genus, s.lane);

// ───── U1b ─────
const U1B_L = [2, 3, 5, 7, 10, 14, 20], LIM = Math.log(1.25);
{
  let n = 0, bad = 0, worst = { v: 0 };
  const perAz = {}, perScene = {};
  for (const c of cells.filter(c => c.kind === 'main')) {
    const s = SCENES[c.si], e = entryOf(s);
    for (const L of U1B_L) {
      const Tb = c.rec.meanT[Li(L)];
      if (!(Tb >= 0.01)) continue;
      const Tl = Math.exp(-X.tsunLawTau(fx, e, L, s.cover, c.hf, c.az));
      const d = Math.log(Tb / Tl);
      n++;
      perAz[c.an] = Math.max(perAz[c.an] ?? 0, Math.abs(d));
      const ps = (perScene[s.name] ??= { n: 0, fail: 0, maxAbsLn: 0 });
      ps.n++; ps.maxAbsLn = +Math.max(ps.maxAbsLn, Math.abs(d)).toFixed(4);
      if (Math.abs(d) > LIM) { bad++; ps.fail++; }
      if (Math.abs(d) > Math.abs(worst.v)) worst = { v: +d.toFixed(4), scene: s.name, hf: c.hf, az: c.an, L, Tb: +Tb.toFixed(4), Tlaw: +Tl.toFixed(4) };
    }
  }
  // T 띠별 실패와 몬테카를로 바닥(표 설정의 독립 무차별 대 기준 무차별 — 법칙·보간 없이 표본 잡음만)
  const bands = [[0.01, 0.03], [0.03, 0.1], [0.1, 1.01]];
  const band = bands.map(([a, b]) => ({ T: `${a}–${b > 1 ? 1 : b}`, n: 0, fail: 0, floorFail: 0, floorN: 0 }));
  for (const c of mainCells) {
    const s = SCENES[c.si], e = entryOf(s);
    for (const L of U1B_L) {
      const Tb = c.rec.meanT[Li(L)];
      if (!(Tb >= 0.01)) continue;
      const bi = bands.findIndex(([a, b]) => Tb >= a && Tb < b);
      const d = Math.log(Tb / Math.exp(-X.tsunLawTau(fx, e, L, s.cover, c.hf, c.az)));
      band[bi].n++; if (Math.abs(d) > LIM) band[bi].fail++;
      const Tf = c.floor.meanT[Li(L)];
      band[bi].floorN++; if (!(Tf > 0) || Math.abs(Math.log(Tb / Tf)) > LIM) band[bi].floorFail++;
    }
  }
  check('U1b law vs brute |ln(Tb/Tlaw)| ≤ ln1.25 (T ≥ 0.01, 8 azimuths, L 2–20 km)', n > 0 && bad === 0,
    { points: n, fail: bad, maxAbsLn: worst.v, worst, byTBand: band, perScene, maxPerAzimuth: Object.fromEntries(Object.entries(perAz).map(([k, v]) => [k, +v.toFixed(4)])) });
}

// ───── G 와 법칙의 일치(평가기 자기 점검): 균일 수평선이면 G(λ₁₀·L) = τ_x(L) ─────
{
  let mx = 0, n = 0;
  for (const c of cells.filter(c => c.kind === 'main')) {
    const s = SCENES[c.si], e = entryOf(s);
    const lam = X.tsunLambda10(fx, e, s.cover, c.hf, c.az);
    for (const L of U1B_L) { n++; mx = Math.max(mx, Math.abs(X.tsunCurveOfGrowth(fx, e, lam * L, s.cover, c.hf, c.az) - X.tsunLawTau(fx, e, L, s.cover, c.hf, c.az))); }
  }
  check('G(λ₁₀·L) equals the homogeneous law τ(L) (evaluator self-check, |Δτ| ≤ 1e-6)', mx <= 1e-6, { points: n, maxAbs: mx });
}

// ───── U1e ─────
// 관문은 L 별 τ_c(tauCL — 셰이더가 u_true 로 읽는 형태), 설계의 상수 τ_c 는 같은 점에서 보고. 바닥 = 표 설정 무차별 대 기준 무차별(법칙 없음).
{
  const RE = [0.25, 0.5, 1.1], LE = [2, 5, 10];
  const acc = () => ({ n: 0, fail: 0, worst: { v: 0 } });
  const A = { P: acc(), L: acc(), C: acc(), none: acc(), flip: acc(), floor: acc() };
  const add = (a, d, info) => { a.n++; if (Math.abs(d) > 0.3) a.fail++; if (Math.abs(d) > Math.abs(a.worst.v)) a.worst = { v: +d.toFixed(4), ...info }; };
  for (const c of mainCells) {
    const s = SCENES[c.si], e = entryOf(s), r = c.rec, f = c.floor;
    if (!(r.sumW > 0)) continue;
    for (const reach of RE) for (const L of LE) {
      const ri = F.REACH_GRID.indexOf(reach), cl = F.CONDL_KM.indexOf(L), nCL = F.CONDL_IDX.length;
      const Tb = r.sumWT[ri * nCL + cl] / r.sumW;
      if (!(Tb >= 0.01)) continue;
      const tauB = -Math.log(Tb), law = X.tsunLawTau(fx, e, L, s.cover, c.hf, c.az);
      const info = { scene: s.name, hf: c.hf, az: c.an, reach, L, tauBrute: +tauB.toFixed(3) };
      add(A.P, tauB - (law + X.tsunTauCond(fx, e, s.cover, c.hf, reach, L, c.az)), info);
      add(A.L, tauB - (law + X.tsunTauCond(fx, e, s.cover, c.hf, reach, L)), info);
      add(A.C, tauB - (law + X.tsunTauCond(fx, e, s.cover, c.hf, reach)), info);
      add(A.none, tauB - law, info);
      add(A.flip, tauB - (law + X.tsunTauCond(fx, e, s.cover, c.hf, reach, L, c.az + 180)), info); // 처음 판의 mod 180 접기에 해당
      if (f.sumW > 0) { const Tf = f.sumWT[ri * nCL + cl] / f.sumW; add(A.floor, Tf > 0 ? tauB + Math.log(Tf) : 99, info); }
    }
  }
  const pack = a => ({ points: a.n, fail: a.fail, maxAbs: a.worst.v, worst: a.worst });
  check('U1e in-cloud start τ beyond reach (0.25/0.5/1.1 km, L 2/5/10 km) |Δτ| ≤ 0.3 — azimuth- and L-resolved τ_c', A.P.n > 0 && A.P.fail === 0,
    { ...pack(A.P), azimuthAveragedL: pack(A.L), constantTauC: pack(A.C), withoutTauC: pack(A.none), reversedAzimuth: pack(A.flip), monteCarloFloor: pack(A.floor) });
}

// ───── U1g: 기운 직선(§179 검토 반영 물리 6) ─────
// 무차별(tsunslope.c — tsunfix.c 를 #include 한 같은 밀도 복제)로 관측 기둥에서 hf 0.02/0.35/0.68 · 해 고도 0.3/1.1/4/8° · P3 방위의 곧은 구면 선이
// 자기 레인을 벗어날 때까지의 ⟨T⟩ 를 재고, LP3 법칙(tsunAtlas.ts tsunLineTau — 아틀라스와 같은 핵, 균일 운량)과 견줌. 관문 |ln(⟨T⟩/T_law)| ≤ ln 1.25
// (T ≥ 0.01, U1b 와 같은 허용폭). 레인 두께: P3B sc 0.527 · ac 1.0 km [from doc, scenes-tsun P3B], cu 1.5 · ns 3.0 km [estimate].
{
  const slopeExe = path.join(TMP, 'tsunslope');
  execFileSync('gcc', ['-O2', '-ffp-contract=off', '-std=gnu11', '-o', slopeExe, path.join(F.HERE, 'tsunslope.c'), '-lm'], { stdio: 'inherit' });
  const taBundle = path.join(TMP, 'tsunAtlas.cjs');
  execFileSync('npx', ['esbuild', path.join(F.ROOT, 'src/components/VolumetricProbe/tsunAtlas.ts'), '--bundle', '--format=cjs', '--platform=node', `--outfile=${taBundle}`, '--log-level=warning'], { cwd: F.ROOT, stdio: 'inherit' });
  const TA = require(taBundle);
  const GEO = { 'P3B sc': [1.736, 0.527], 'P3B/RA1 ac': [2.822, 1.0], 'P1B cu': [1.0, 1.5], 'P1CF ns': [0.8, 3.0] };
  const ES = [0.3, 1.1, 4, 8], HF0 = [0.02, 0.35, 0.68], PHI = AZ.P3, Rkm = 6360;
  const sc = SCENES.map((s, si) => ({ s, si })).filter(({ s }) => GEO[s.name]);
  const SP = { S: 256, tileKm: 24, ds: 0.05, rows: 256, starts: 16, startStep: 3.0 };
  const cellsG = [];
  for (const { s, si } of sc) for (const hf0 of HF0) for (const e of ES) cellsG.push({ s, si, hf0, e, base: GEO[s.name][0], top: GEO[s.name][0] + GEO[s.name][1], seed: F.cellSeed(TEST_SEED ^ 0x51e7n, si, hf0, e) });
  const plan = [`SLOPE ${SP.S} ${SP.tileKm} ${SP.ds} ${SP.rows} ${SP.starts} ${SP.startStep} ${F.BUILD_PARAM.lat} ${F.BUILD_PARAM.lon}`, `CELLS ${cellsG.length}`,
    ...cellsG.map(c => [c.s.tile, 0, -1, c.s.prof.mode, c.s.prof.base, c.s.prof.top, c.s.prof.edge, c.s.prof.densityScale, c.s.prof.shapeAmount, c.s.prof.profLin, c.s.prof.profConst,
      c.hf0, PHI, c.e, c.base, c.top, c.seed].join(' '))].join('\n') + '\n';
  const planPath = path.join(TMP, 'slope.plan.txt'), outPath = path.join(TMP, 'slope.f64');
  fs.writeFileSync(planPath, plan);
  const tg = Date.now();
  execFileSync('nice', ['-n', '19', slopeExe, tilesPath, F.SHAPE_BIN, planPath, outPath], { stdio: 'inherit' });
  const buf = fs.readFileSync(outPath), f64 = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
  console.log(`기운 직선 무차별 ${cellsG.length} 칸 ${((Date.now() - tg) / 1000).toFixed(1)} s (선 ${SP.rows} × 시작 ${SP.starts})`);
  let n = 0, bad = 0, worst = { v: 0 };
  const perScene = {}, rows = [];
  cellsG.forEach((c, i) => {
    const Tb = f64[i * 5 + 1], len = f64[i * 5 + 3];
    // LP3 법칙: 균일 운량(타일 운량) 레인 하나 — 관측 기둥(0, 0)에서 같은 방위·고도의 해
    const az = PHI * Math.PI / 180, er = c.e * Math.PI / 180;
    const lanes = [null, null, null, null]; lanes[c.s.lane] = { genus: c.s.genus, tileCover: c.s.cover, baseKm: c.base, topKm: c.top, macro: null };
    const input = { frame: { originM: [0, 0, Rkm * 1000], eastM: [1, 0, 0], northM: [0, 1, 0], tileM: 24000 }, centerKm: [0, 0],
      sunDir: [Math.cos(er) * Math.sin(az), Math.cos(er) * Math.cos(az), Math.sin(er)], bottomRadiusKm: Rkm, n: 16, halfKm: 20, rangeKm: 400, arch: false, lanes };
    const { laws } = TA.tsunLawsFromFixture(fx, input);
    const tauLaw = TA.tsunLineTau(input, laws, 0, 0, c.base + c.hf0 * (c.top - c.base)).perLane[c.s.lane];
    const Tl = Math.exp(-tauLaw);
    const ps = (perScene[c.s.name] ??= { n: 0, fail: 0, maxAbsLn: 0 });
    rows.push(`${c.s.name} hf ${c.hf0} e ${c.e}°: T ${Tb.toFixed(4)} vs ${Tl.toFixed(4)} (길이 ${len.toFixed(1)} km)`);
    if (!(Tb >= 0.01)) return;
    const d = Math.log(Tb / Tl);
    n++; ps.n++; ps.maxAbsLn = +Math.max(ps.maxAbsLn, Math.abs(d)).toFixed(4);
    if (Math.abs(d) > LIM) { bad++; ps.fail++; }
    if (Math.abs(d) > Math.abs(worst.v)) worst = { v: +d.toFixed(4), scene: c.s.name, hf0: c.hf0, e: c.e, Tb: +Tb.toFixed(4), Tlaw: +Tl.toFixed(4), lenKm: +len.toFixed(2) };
  });
  check('U1g sloped lines: brute ⟨T⟩ vs LP3 law (curve of growth on Λ) |ln| ≤ ln1.25 (T ≥ 0.01, hf0 0.02/0.35/0.68 × e 0.3/1.1/4/8°, P3 azimuth)', n > 0 && bad === 0,
    { points: n, fail: bad, maxAbsLn: worst.v, worst, perScene });
  console.log('  ' + rows.join('\n  '));
}

// ───── U1a (보고) ─────
{
  const rows = [];
  let ok = 0, na = 0, tot = 0;
  for (const c of cells.filter(c => c.kind === 'main')) {
    const r = c.rec;
    tot++;
    const P = r.okF.map(v => v / Math.max(1, r.nClear));
    const counts = r.okF;
    if (!(counts[3] >= 30)) { na++; continue; }
    const rate = (a, b) => Math.log(P[a] / P[b]) / (F.FREE_KM[b] - F.FREE_KM[a]);
    const r4 = rate(0, 1), r8 = rate(1, 2), r16 = rate(2, 3);
    const spread = Math.max(r4, r8, r16) / Math.min(r4, r8, r16);
    if (spread <= 1.05) ok++;
    rows.push({ scene: SCENES[c.si].name, hf: c.hf, az: c.an, r4: +r4.toFixed(4), r8: +r8.toFixed(4), r16: +r16.toFixed(4), maxOverMin: +spread.toFixed(3) });
  }
  rows.sort((a, b) => b.maxOverMin - a.maxOverMin);
  const med = rows.length ? rows[Math.floor(rows.length / 2)].maxOverMin : null;
  check('U1a exponential free path (rate at 4/8/16 km within 5 %) [report — v2.1 §8 replaced by U1b′]', null,
    { evaluable: rows.length, withinFivePct: ok, notEvaluable: na, of: tot, medianMaxOverMin: med, worst: rows.slice(0, 3) });
  results.at(-1).rows = rows;
}

// ───── U1d·U1f·거시 문턱·레인 대체 (보고) ─────
{
  const by = (k, si, hf) => cells.find(c => c.kind === k && c.si === si && c.hf === hf);
  const u1d = [], u1f = [];
  SCENES.forEach((s, si) => {
    for (const hf of [0.37, 0.62]) {
      const raw = by('raw', si, hf), ero = by('ero', si, hf), m1 = by('mip1', si, hf);
      const lr = lamOfRec(raw.rec), le = lamOfRec(ero.rec), lm = lamOfRec(m1.rec);
      u1d.push({ scene: s.name, hf, lamRaw: +lr.toFixed(4), lamEroded: +le.toFixed(4), ratio: le > 0 ? +(lr / le).toFixed(3) : null });
      const t = (r, L) => -Math.log(Math.max(r.meanT[Li(L)], 1e-300));
      u1f.push({ scene: s.name, hf, lamRatio: le > 0 ? +(lm / le).toFixed(3) : null, tau5Ratio: t(ero.rec, 5) > 0 ? +(t(m1.rec, 5) / t(ero.rec, 5)).toFixed(3) : null,
        tau10Ratio: t(ero.rec, 10) > 0 ? +(t(m1.rec, 10) / t(ero.rec, 10)).toFixed(3) : null });
    }
  });
  check('U1d byte-only / eroded λ₁₀ (P3 azimuth) [report; design expects ×1.8 sc]', null, u1d);
  check('U1f mip-1 / mip-0 λ₁₀ and τ(5, 10 km) (P3 azimuth) [report]', null, u1f);
  const mac = [];
  for (const c of cells.filter(c => c.kind === 'macro')) {
    const s = SCENES[c.si], nat = by('ero', c.si, c.hf);
    const t = (r, L) => -Math.log(Math.max(r.meanT[Li(L)], 1e-300));
    mac.push({ scene: s.name, hf: c.hf, tileC0: +c.c0.toFixed(3), threshold: +c.sThr.toFixed(4), target: +s.cover.toFixed(3),
      lamMacro: +lamOfRec(c.rec).toFixed(4), lamNative: +lamOfRec(nat.rec).toFixed(4),
      lnT5: +(t(nat.rec, 5) - t(c.rec, 5)).toFixed(3), lnT10: +(t(nat.rec, 10) - t(c.rec, 10)).toFixed(3) });
  }
  check('macro-threshold field vs native-cover field (cover axis decision) [report]', null, mac);
  // 레인 대체: P1B ac(레인 2)를 레인 1 항목으로 읽었을 때의 U1b 지표
  const s5 = SCENES.findIndex(s => s.genus === 'ac' && s.lane === 2), e1 = header.entries.findIndex(E => E.genus === 'ac' && E.lane === 1);
  if (s5 >= 0 && e1 >= 0) {
    let mx = 0, n = 0, bad = 0;
    for (const c of cells.filter(c => c.kind === 'main' && c.si === s5)) for (const L of U1B_L) {
      const Tb = c.rec.meanT[Li(L)];
      if (!(Tb >= 0.01)) continue;
      const d = Math.abs(Math.log(Tb / Math.exp(-X.tsunLawTau(fx, e1, L, SCENES[s5].cover, c.hf, c.az))));
      n++; mx = Math.max(mx, d); if (d > LIM) bad++;
    }
    check('lane fallback: P1B ac (lane 2) read from the ac@1 entry [report]', null, { points: n, overLn125: bad, maxAbsLn: +mx.toFixed(4) });
  }
}

const out = path.join(TMP, 'fixture-test.json');
fs.writeFileSync(out, JSON.stringify({ fixture: { dir: FIX, binSha256: header.binSha256, partial: header.partial ?? null }, results }, null, 1));
const gates = results.filter(r => r.ok !== null);
console.log(`\n관문 ${gates.filter(r => r.ok).length}/${gates.length} 통과 — 기록 ${out}`);
process.exit(gates.every(r => r.ok) ? 0 : 1);
