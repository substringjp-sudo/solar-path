#!/usr/bin/env node
/**
 * flow-core-test.mjs — WP1 흐름 핵(src/components/VolumetricProbe/cloudFlow.ts)의 단위 테스트(문서 §130).
 *
 * esbuild 로 cloudFlow.ts 를 CJS 로 묶어(three.js 없이) 돌립니다:
 *   node tools/genus-ruler/flow/flow-core-test.mjs [--out=<dir>]
 * 검사: (1) fft2 왕복 (2) Poisson 잔차 (3) 라벨맵 면적 보존·변위 상한 (4) quantileHist == 정렬 분위수 (5) 결정론(두 번 실행,
 * yield 를 다르게 끊어 소비) (6) 주기 이음새 (7) 시간 (8) sc 비슷한 템플릿의 연기 장면 → f/d PNG + T2/T3 통계.
 * 종류별 템플릿(cloudGenus.ts)은 **가져오지 않습니다** — 주기 Voronoi + fbm 을 여기서 씁니다.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const SRC = path.join(ROOT, 'src/components/VolumetricProbe/cloudFlow.ts');
const argOut = process.argv.find(a => a.startsWith('--out='))?.slice(6);
const OUT = argOut ?? '/tmp/claude-0/-home-user-solar-path/827aa702-2f52-52c8-9fe8-e45a3ff14759/scratchpad/impl1/wp1';
fs.mkdirSync(OUT, { recursive: true });
const BUNDLE = path.join(OUT, 'cloudFlow.cjs');
execFileSync('npx', ['esbuild', SRC, '--bundle', '--format=cjs', '--platform=node', `--outfile=${BUNDLE}`, '--log-level=warning'], { cwd: ROOT, stdio: 'inherit' });
if (/from\s*["']three["']|require\(["']three["']\)/.test(fs.readFileSync(BUNDLE, 'utf8'))) throw new Error('bundle pulls in three.js — cloudFlow.ts must stay pure');
const require = createRequire(import.meta.url);
const F = require(BUNDLE);
const { PNG } = require(path.join(ROOT, 'node_modules/pngjs'));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`); };
const now = () => Number(process.hrtime.bigint()) / 1e6;
const TWO_PI = 2 * Math.PI;
const mulberry = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = (r) => { const u = Math.max(1e-12, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * v); };
const bytesOf = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const sortQuantile = (arr, q) => { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };
const TILE_KM = 24;

// ───── (1) fft2 왕복 ─────
for (const n of [64, 128]) {
  const r = mulberry(11 + n), re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) { re[i] = r() * 2 - 1; im[i] = r() * 2 - 1; }
  const re0 = Float64Array.from(re), im0 = Float64Array.from(im);
  F.fft2(re, im, n, false); F.fft2(re, im, n, true);
  let err = 0; for (let i = 0; i < n * n; i++) err = Math.max(err, Math.abs(re[i] - re0[i]), Math.abs(im[i] - im0[i]));
  check(`T1 fft2 round-trip n=${n}`, err < 1e-9, `max|Δ| = ${err.toExponential(2)}`);
  // Parseval: Σ|x|² = (1/n²) Σ|X|²  (forward only)
  const re1 = Float64Array.from(re0), im1 = Float64Array.from(im0); F.fft2(re1, im1, n, false);
  let e0 = 0, e1 = 0; for (let i = 0; i < n * n; i++) { e0 += re0[i] ** 2 + im0[i] ** 2; e1 += re1[i] ** 2 + im1[i] ** 2; }
  check(`T1 fft2 Parseval n=${n}`, Math.abs(e1 / (n * n) / e0 - 1) < 1e-12, `ratio−1 = ${(e1 / (n * n) / e0 - 1).toExponential(2)}`);
}

// ───── (2) Poisson: ∇²ψ = ζ (스펙트럼 라플라시안으로 검산), 속도 발산 0 ─────
for (const n of [64, 128]) {
  const L = TILE_KM * 1000, r = mulberry(5 + n), zeta = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) zeta[i] = gauss(r) * 1e-3;
  let m = 0; for (let i = 0; i < n * n; i++) m += zeta[i]; m /= n * n;
  const psi = new Float32Array(n * n); F.poissonSolve(zeta, n, TILE_KM, psi);
  const re = new Float64Array(n * n), im = new Float64Array(n * n); for (let i = 0; i < n * n; i++) re[i] = psi[i];
  F.fft2(re, im, n, false);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const kx = i <= n / 2 ? i : i - n, ky = j <= n / 2 ? j : j - n, kk = (TWO_PI * Math.hypot(kx, ky) / L) ** 2;
    re[j * n + i] *= -kk; im[j * n + i] *= -kk;
  }
  F.fft2(re, im, n, true);
  let maxRes = 0, rms = 0; for (let i = 0; i < n * n; i++) { maxRes = Math.max(maxRes, Math.abs(re[i] - (zeta[i] - m))); rms += (zeta[i] - m) ** 2; }
  rms = Math.sqrt(rms / (n * n));
  check(`T2 Poisson residual n=${n}`, maxRes / rms < 1e-3, `max|∇²ψ−ζ|/rms(ζ) = ${(maxRes / rms).toExponential(2)}`);
  const U = new Float32Array(n * n), V = new Float32Array(n * n); F.velocityFromPsi(psi, n, TILE_KM, U, V);
  const dx = L / n; let maxDiv = 0, urms = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const ip = (i + 1) % n, im_ = (i + n - 1) % n, jp = (j + 1) % n, jm = (j + n - 1) % n;
    maxDiv = Math.max(maxDiv, Math.abs((U[j * n + ip] - U[j * n + im_] + V[jp * n + i] - V[jm * n + i]) / (2 * dx)));
    urms += U[j * n + i] ** 2 + V[j * n + i] ** 2;
  }
  urms = Math.sqrt(urms / (n * n));
  check(`T2 velocity divergence-free n=${n}`, maxDiv * dx / urms < 1e-5, `max|div|·dx/rms|u| = ${(maxDiv * dx / urms).toExponential(2)}`);
}

// ───── 공통: 핵 실행(동기) ─────
function runCore(p, consume) {
  const core = F.newFlowCore(p.n);
  const g = F.flowCoreSteps(p, TILE_KM, core);
  const t0 = now(); let yields = 0;
  if (consume) consume(g); else for (const _ of g) yields++;
  core.ms = now() - t0; core.yields = yields;
  return core;
}
const P64 = { ...F.FLOW_DEFAULTS };
const P128 = { ...F.FLOW_DEFAULTS, n: 128 };

// ───── (3) 라벨맵: 평균 det J = 1 ± 1e-2, max|D| ≤ steps·umax·dt ─────
for (const p of [P64, P128]) {
  const c = runCore(p), n = c.n, L = TILE_KM * 1000, h = 1 / n;
  let sumDet = 0, minDet = Infinity, maxD = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const ip = (i + 1) % n, im_ = (i + n - 1) % n, jp = (j + 1) % n, jm = (j + n - 1) % n;
    const dxu = (c.dx[j * n + ip] - c.dx[j * n + im_]) / (2 * h), dxv = (c.dx[jp * n + i] - c.dx[jm * n + i]) / (2 * h);
    const dyu = (c.dy[j * n + ip] - c.dy[j * n + im_]) / (2 * h), dyv = (c.dy[jp * n + i] - c.dy[jm * n + i]) / (2 * h);
    const det = (1 - dxu) * (1 - dyv) - dxv * dyu;
    sumDet += det; minDet = Math.min(minDet, det);
    maxD = Math.max(maxD, Math.hypot(c.dx[j * n + i], c.dy[j * n + i]));
  }
  const meanDet = sumDet / (n * n), dt = p.hours * 3600 / p.steps, bound = p.steps * c.umax * dt / L;
  check(`T3 label-map mean det J n=${n}`, Math.abs(meanDet - 1) < 1e-2, `mean det = ${meanDet.toFixed(5)}, min det = ${minDet.toFixed(3)}`);
  check(`T3 max|D| ≤ steps·cfl·dx n=${n}`, maxD <= bound * (1 + 1e-6), `max|D| = ${(maxD * TILE_KM).toFixed(2)} km ≤ ${(bound * TILE_KM).toFixed(2)} km; umax ${c.umax.toFixed(2)} m/s, cfl ${c.cfl.toFixed(2)}, yields ${c.yields}`);
  check(`T3 min det J > 0 (no fold) n=${n}`, minDet > 0, `min det = ${minDet.toFixed(3)}`);
  let m = 0, s = 0; for (let i = 0; i < n * n; i++) m += c.q0[i]; m /= n * n; for (let i = 0; i < n * n; i++) s += (c.q0[i] - m) ** 2; s = Math.sqrt(s / (n * n));
  let mz = 0, sz = 0; for (let i = 0; i < n * n; i++) mz += c.z0n[i]; mz /= n * n; for (let i = 0; i < n * n; i++) sz += (c.z0n[i] - mz) ** 2; sz = Math.sqrt(sz / (n * n));
  check(`T3 q0/z0n standardized n=${n}`, Math.abs(m) < 1e-3 && Math.abs(s - 1) < 1e-3 && Math.abs(mz) < 1e-3 && Math.abs(sz - 1) < 1e-3, `q0 mean ${m.toExponential(1)} std ${s.toFixed(4)}; z0n mean ${mz.toExponential(1)} std ${sz.toFixed(4)}`);
  let corr = 0; for (let i = 0; i < n * n; i++) corr += c.q0[i] * c.z0n[i]; corr /= n * n;
  check(`T3 corr(q0, ζ̂₀) ≈ qCorr n=${n}`, Math.abs(corr - p.qCorr) < 0.12, `corr = ${corr.toFixed(3)} (qCorr ${p.qCorr})`);
}

// ───── (4) quantileHist == 정렬 분위수(비트 동일) ─────
{
  const N = 512 * 512, r = mulberry(99), dists = {
    uniform: () => r(),
    gaussian: () => gauss(r),
    'zeros60%': () => (r() < 0.6 ? 0 : Math.abs(gauss(r))),
    heavyTail: () => (-Math.log(Math.max(1e-12, r()))) ** 3,
    integerTies: () => Math.round(gauss(r) * 3),
    constant: () => 0.25,
    bimodalDup: () => (r() < 0.5 ? 1 : 2) + (r() < 0.1 ? r() * 1e-6 : 0),
  };
  let all = true, worst = '';
  for (const [name, gen] of Object.entries(dists)) {
    const f = new Float32Array(N); for (let i = 0; i < N; i++) f[i] = gen();
    for (const q of [0.03, 0.5, 0.808, 0.997, 0, 1]) {
      const a = F.quantileHist(f, q), b = sortQuantile(f, q);
      if (!Object.is(a, b)) { all = false; worst += ` ${name}@${q}: ${a} vs ${b};`; }
    }
  }
  check('T4 quantileHist == sort quantile (7 dists × 6 q, bit-exact)', all, worst || 'all identical');
  const f = new Float32Array(N); for (let i = 0; i < N; i++) f[i] = gauss(r);
  let t0 = now(); for (let k = 0; k < 5; k++) F.quantileHist(f, 0.77); const tH = (now() - t0) / 5;
  t0 = now(); for (let k = 0; k < 5; k++) sortQuantile(f, 0.77); const tS = (now() - t0) / 5;
  console.log(`      quantileHist ${tH.toFixed(1)} ms vs sort ${tS.toFixed(1)} ms (512²)`);
}

// ───── (6) 주기 이음새 + 템플릿 랩 ─────
const TS = 256;
function scTemplate(TS, tileKm, seed, cellKm = 1.8, gap = 0.35) {
  // 주기 Voronoi(지터 격자) 닫힌 셀 + fbm 덩어리 — cloudGenus.sc 를 흉내낸 단순판(가져오지 않음).
  const n = Math.max(2, Math.round(tileKm / cellKm)), r = mulberry(seed), sx = new Float32Array(n * n), sy = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { sx[j * n + i] = (i + 0.5 + (r() - 0.5) * 0.9) / n; sy[j * n + i] = (j + 0.5 + (r() - 0.5) * 0.9) / n; }
  const noise = (m, s) => { const rr = mulberry(s), g = new Float32Array(m * m).map(() => rr()); return (u, v) => F.bilinearPeriodic(g, m, u + 0.5 / m, v + 0.5 / m); };
  const octs = [noise(8, seed + 1), noise(16, seed + 2), noise(32, seed + 3)];
  const fbm = (u, v) => (octs[0](u, v) * 0.5 + octs[1](u, v) * 0.25 + octs[2](u, v) * 0.125) / 0.875;
  const wrapD = (a, b) => { let d = a - b; d -= Math.round(d); return d; };
  const T = new Float32Array(TS * TS);
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const u = (x + 0.5) / TS, v = (y + 0.5) / TS, ci = Math.floor(u * n), cj = Math.floor(v * n);
    let d1 = Infinity, d2 = Infinity;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const k = (((cj + dj) % n + n) % n) * n + (((ci + di) % n + n) % n);
      const d = Math.hypot(wrapD(u, sx[k]), wrapD(v, sy[k])) * n;
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    const wall = Math.min(1, Math.max(0, (d2 - d1) / gap)), sm = wall * wall * (3 - 2 * wall);
    T[y * TS + x] = sm * (0.6 + 0.4 * fbm(u, v)) + 0.3 * fbm(u * 0.5, v * 0.5);
  }
  return T;
}
const T = scTemplate(TS, TILE_KM, 1007);
F.normalizeTemplate(T);
{
  let m = 0, s = 0; for (let i = 0; i < TS * TS; i++) m += T[i]; m /= TS * TS; for (let i = 0; i < TS * TS; i++) s += (T[i] - m) ** 2; s = Math.sqrt(s / (TS * TS));
  check('T6 normalizeTemplate zero-mean unit-std', Math.abs(m) < 1e-5 && Math.abs(s - 1) < 1e-5, `mean ${m.toExponential(1)} std ${s.toFixed(6)}`);
  let wrapErr = 0;
  const rr = mulberry(3);
  for (let k = 0; k < 2000; k++) {
    const u = rr() * 3 - 1.5, v = rr() * 3 - 1.5, a = F.bilinearPeriodic(T, TS, u, v), b = F.bilinearPeriodic(T, TS, u + 2, v - 3), c = F.bilinearPeriodic(T, TS, u - 1, v + 1);
    wrapErr = Math.max(wrapErr, Math.abs(a - b), Math.abs(a - c));
  }
  const e1 = Math.abs(F.bilinearPeriodic(T, TS, -0.001, 0.37) - F.bilinearPeriodic(T, TS, 0.999, 0.37));
  check('T6 bilinearPeriodic wraps at fractional coords', wrapErr < 1e-9 && e1 < 1e-9, `max|Δ| = ${wrapErr.toExponential(2)}, seam ${e1.toExponential(2)}`);
  // 셀 중심에서 격자값과 일치
  let cErr = 0; for (let k = 0; k < 500; k++) { const i = Math.floor(rr() * TS), j = Math.floor(rr() * TS); cErr = Math.max(cErr, Math.abs(F.bilinearPeriodic(T, TS, (i + 0.5) / TS, (j + 0.5) / TS) - T[j * TS + i])); }
  check('T6 bilinearPeriodic cell-centre exact', cErr < 1e-6, `max|Δ| = ${cErr.toExponential(2)}`);
}
const S = 512;
const core64 = runCore(P64);
const wSc = F.flowLayerWeightsOf({ shearU: 80, shearV: 0, flowSeed: 7 }, 'sc', TILE_KM, 1.5, 4.5);
function compose(core, w, consume) {
  const f = new Float32Array(S * S), g = F.flowComposeSteps(core, T, TS, S, w, f);
  const t0 = now(); let yields = 0;
  if (consume) consume(g); else for (const _ of g) yields++;
  return { f, ms: now() - t0, yields };
}
{
  const { f, yields } = compose(core64, wSc);
  let seamX = 0, nearX = 0, seamY = 0, nearY = 0;
  for (let y = 0; y < S; y++) { seamX += Math.abs(f[y * S] - f[y * S + S - 1]); nearX += Math.abs(f[y * S] - f[y * S + 1]); }
  for (let x = 0; x < S; x++) { seamY += Math.abs(f[x] - f[(S - 1) * S + x]); nearY += Math.abs(f[x] - f[S + x]); }
  check('T6 compose periodic seam (x and y)', seamX / nearX < 1.5 && seamY / nearY < 1.5, `|f(0)−f(S−1)| / |f(0)−f(1)|: x ${(seamX / nearX).toFixed(3)}, y ${(seamY / nearY).toFixed(3)}; yields ${yields}`);
  check('T6 compose yields every 8 rows', yields === S / 8, `${yields} (expected ${S / 8})`);
  // 전단파 파수: shear 동쪽, λ 8 km → k = (3, 0); 발단 S = 80/3.6/3 = 7.4 m/s/km → 진폭 wW 0.3 전부
  check('T6 waveVectorFor / onset', wSc.waveK[0] === 3 && wSc.waveK[1] === 0 && Math.abs(wSc.wW - 0.3) < 1e-9, `waveK [${wSc.waveK}], wW ${wSc.wW.toFixed(3)}, lag ${wSc.lag}, wQ/wZ/wT ${wSc.wQ}/${wSc.wZ}/${wSc.wT}`);
  const w0 = F.flowLayerWeightsOf({}, 'sc', TILE_KM, 1.5, 4.5);
  check('T6 no shear → wave off, k fallback', w0.wW === 0 && w0.waveK[0] === 0 && w0.waveK[1] === 1, `wW ${w0.wW}, waveK [${w0.waveK}]`);
  const kv = F.waveVectorFor(3, 4, 3, 24), kd = F.waveVectorFor(-1, 0, 8, 24);
  check('T6 waveVectorFor diagonal / negative', kv[0] === 5 && kv[1] === 6 && kd[0] === -3 && kd[1] === 0, `[${kv}] [${kd}]`);
}

// ───── (5) 결정론: 두 번 실행 바이트 동일, 다른 끊기(비동기 + 사이에 다른 작업) 동일 ─────
{
  const a = runCore(P64), b = runCore(P64);
  const sameCore = Buffer.compare(bytesOf(a.dx), bytesOf(b.dx)) === 0 && Buffer.compare(bytesOf(a.dy), bytesOf(b.dy)) === 0 &&
    Buffer.compare(bytesOf(a.q0), bytesOf(b.q0)) === 0 && Buffer.compare(bytesOf(a.z0n), bytesOf(b.z0n)) === 0 && a.umax === b.umax;
  check('T5 core determinism (two runs identical bytes)', sameCore);
  const chunked = await (async () => {
    const core = F.newFlowCore(64), g = F.flowCoreSteps(P64, TILE_KM, core); let k = 0;
    for (;;) { const r = g.next(); if (r.done) break; if (++k % 3 === 0) { await new Promise(res => setImmediate(res)); compose(a, wSc); } }
    return core;
  })();
  check('T5 core determinism (yields consumed async, other work between)', Buffer.compare(bytesOf(a.dx), bytesOf(chunked.dx)) === 0 && Buffer.compare(bytesOf(a.dy), bytesOf(chunked.dy)) === 0 && a.umax === chunked.umax);
  const fa = compose(a, wSc).f, fb = compose(b, wSc).f;
  const fc = await (async () => {
    const f = new Float32Array(S * S), g = F.flowComposeSteps(a, T, TS, S, wSc, f); let k = 0;
    for (;;) { const r = g.next(); if (r.done) break; if (++k % 5 === 0) await new Promise(res => setImmediate(res)); }
    return f;
  })();
  check('T5 compose determinism (sync twice, async chunked)', Buffer.compare(bytesOf(fa), bytesOf(fb)) === 0 && Buffer.compare(bytesOf(fa), bytesOf(fc)) === 0);
  const c128a = runCore(P128), c128b = runCore(P128);
  check('T5 core determinism n=128', Buffer.compare(bytesOf(c128a.dx), bytesOf(c128b.dx)) === 0 && Buffer.compare(bytesOf(c128a.dy), bytesOf(c128b.dy)) === 0, `yields ${c128a.yields}`);
  const sA = F.flowSeedOf(36.5679, 136.6774, new Date('2026-10-03T03:00:00Z')), sB = F.flowSeedOf(36.5679, 136.6774, new Date('2026-10-03T09:00:00Z')),
    sC = F.flowSeedOf(36.5679, 136.6774, new Date('2026-10-04T03:00:00Z')), sD = F.flowSeedOf(35.0, 136.6774, new Date('2026-10-03T03:00:00Z'));
  check('T5 flowSeedOf: same place+day equal, next day / other place differ', sA === sB && sA !== sC && sA !== sD && sA > 0, `${sA} ${sB} ${sC} ${sD}`);
}

// ───── (7) 시간 ─────
{
  const med = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
  const t64 = [], t128 = [], tc = [];
  for (let k = 0; k < 7; k++) t64.push(runCore(P64).ms);
  for (let k = 0; k < 3; k++) t128.push(runCore(P128).ms);
  for (let k = 0; k < 7; k++) tc.push(compose(core64, wSc).ms);
  const t64m = med(t64), t128m = med(t128), tcm = med(tc);
  check('T7 core N=64/20 steps ≤ 70 ms', t64m <= 70, `median ${t64m.toFixed(1)} ms (min ${Math.min(...t64).toFixed(1)})`);
  check('T7 compose 512² ≤ 80 ms', tcm <= 80, `median ${tcm.toFixed(1)} ms (min ${Math.min(...tc).toFixed(1)})`);
  console.log(`      core N=128/20: median ${t128m.toFixed(1)} ms (min ${Math.min(...t128).toFixed(1)}); cfl64 ${core64.cfl.toFixed(2)} umax ${core64.umax.toFixed(2)} m/s`);
}

// ───── (8) 연기 장면: sc 가중 → th/top → d → PNG + T2/T3 통계 ─────
function tileStats(d, S, tileKm) {
  const pxKm = tileKm / S, m = new Uint8Array(S * S); let nz = 0;
  for (let i = 0; i < S * S; i++) if (d[i] > 0) { m[i] = 1; nz++; }
  // 4-연결 조각(비주기, tile.py 와 같이 가장자리에 닿은 조각도 셈), 면적 ≥ 4 px
  const lab = new Int32Array(S * S).fill(-1), areas = [], stack = new Int32Array(S * S);
  for (let s0 = 0; s0 < S * S; s0++) {
    if (!m[s0] || lab[s0] >= 0) continue;
    const id = areas.length; let sp = 0, area = 0; stack[sp++] = s0; lab[s0] = id;
    while (sp) {
      const c = stack[--sp]; area++; const y = (c / S) | 0, x = c - y * S;
      const nb = [x > 0 ? c - 1 : -1, x < S - 1 ? c + 1 : -1, y > 0 ? c - S : -1, y < S - 1 ? c + S : -1];
      for (const q of nb) if (q >= 0 && m[q] && lab[q] < 0) { lab[q] = id; stack[sp++] = q; }
    }
    areas.push(area);
  }
  const ok = areas.filter(a => a >= 4).map(a => a * pxKm * pxKm), sum = ok.reduce((a, b) => a + b, 0), mean = sum / Math.max(1, ok.length);
  const sd = Math.sqrt(ok.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, ok.length));
  const hist = new Array(10).fill(0); let thin = 0, sat = 0;
  for (let i = 0; i < S * S; i++) if (m[i]) { const v = d[i]; hist[Math.min(9, Math.floor(v * 10))]++; if (v < 0.2) thin++; if (v >= 0.99) sat++; }
  let H = 0; for (const h of hist) if (h > 0) { const p = h / nz; H -= p * Math.log2(p); }
  return { areaTop: nz / (S * S), nPer100km2: ok.length / (tileKm * tileKm) * 100, largestFrac: ok.length ? Math.max(...ok) / sum : NaN, areaCV: ok.length ? sd / mean : NaN,
    dEntropyBits: H, thinFrac: thin / nz, satFrac: sat / nz };
}
function writePng(name, S, gray) {
  const png = new PNG({ width: S, height: S, colorType: 0 });
  for (let i = 0; i < S * S; i++) { const g = Math.max(0, Math.min(255, Math.round(gray[i]))); png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = g; png.data[i * 4 + 3] = 255; }
  fs.writeFileSync(path.join(OUT, name), PNG.sync.write(png));
}
// ───── T4b rankNormalize: 면적 = 운량, f 순서 보존, 순위 히스토그램 균일(gamma 1), gamma 2 의 중앙 0.25
{
  const n = 512 * 512, f = new Float32Array(n);
  let s = 5; const r = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < n; i++) { const u = r(); f[i] = Math.pow(u, 3) * (1 + 0.1 * r()); }
  const th = F.quantileHist(f, 0.7), d1 = new Float32Array(n), d2 = new Float32Array(n);
  F.rankNormalize(f, th, 1.0, d1); F.rankNormalize(f, th, 2.0, d2);
  let nz = 0, viol = 0; const hist = new Array(10).fill(0); const vals = [];
  for (let i = 0; i < n; i++) if (d1[i] > 0) { nz++; hist[Math.min(9, Math.floor(d1[i] * 10))]++; vals.push(d2[i]); }
  for (let k = 0; k < 20000; k++) { const a = (k * 7919) % n, b = (k * 104729 + 13) % n; if (d1[a] > 0 && d1[b] > 0 && f[a] !== f[b] && ((f[a] < f[b]) !== (d1[a] < d1[b]))) viol++; }
  const hmax = Math.max(...hist.map(h => Math.abs(h / nz * 10 - 1)));
  vals.sort((a, b) => a - b); const p50 = vals[Math.floor(vals.length / 2)];
  check('T4b rankNormalize area == cover', Math.abs(nz / n - 0.3) < 1e-3, `area ${(nz / n).toFixed(4)}`);
  check('T4b rankNormalize monotone in f', viol === 0, `violations ${viol}`);
  check('T4b rankNormalize uniform rank (gamma 1)', hmax < 0.03, `max |bin/expected − 1| = ${hmax.toFixed(4)}`);
  check('T4b rankNormalize gamma 2 median ≈ 0.25', Math.abs(p50 - 0.25) < 0.01, `p50 ${p50.toFixed(3)}`);
}

{
  const { f } = compose(core64, wSc);
  const lo = F.quantileHist(f, 0.001), hi = F.quantileHist(f, 0.999);
  writePng('smoke_sc_f.png', S, Float32Array.from(f, v => 255 * (v - lo) / (hi - lo)));
  const Tpng = new Float32Array(S * S); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) Tpng[y * S + x] = 128 + 60 * F.bilinearPeriodic(T, TS, (x + 0.5) / S, (y + 0.5) / S);
  writePng('smoke_sc_template.png', S, Tpng);
  const Dpng = new Float32Array(S * S); let dmax = 0; for (let i = 0; i < 64 * 64; i++) dmax = Math.max(dmax, Math.hypot(core64.dx[i], core64.dy[i]));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) Dpng[y * S + x] = 255 * Math.hypot(F.bilinearPeriodic(core64.dx, 64, (x + 0.5) / S, (y + 0.5) / S), F.bilinearPeriodic(core64.dy, 64, (x + 0.5) / S, (y + 0.5) / S)) / dmax;
  writePng('smoke_D.png', S, Dpng);
  const statsOut = {};
  for (const cover of [0.23, 0.5, 0.85]) {
    const th = F.quantileHist(f, 1 - cover), top = F.quantileHist(f, 0.997), d = new Float32Array(S * S), bytes = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) { const v = f[i] > th ? Math.min(1, Math.max(1 / 255, (f[i] - th) / Math.max(1e-6, top - th))) : 0; bytes[i] = Math.round(v * 255); d[i] = bytes[i] / 255; }
    const st = tileStats(d, S, TILE_KM);
    statsOut[`sc${Math.round(cover * 100)}`] = st;
    writePng(`smoke_sc${Math.round(cover * 100)}_d.png`, S, bytes);
    const areaOk = Math.abs(st.areaTop - cover) <= 2 / (S * S) + 1e-9;
    check(`T8 smoke sc${Math.round(cover * 100)} area(d>0) == cover`, areaOk, `area ${st.areaTop.toFixed(5)} vs ${cover}; pieces/100km² ${st.nPer100km2.toFixed(1)}, largestFrac ${st.largestFrac.toFixed(3)}, areaCV ${st.areaCV.toFixed(2)}, dEntropy ${st.dEntropyBits.toFixed(2)} bit, thinFrac ${st.thinFrac.toFixed(3)}, satFrac ${st.satFrac.toFixed(4)}`);
  }
  fs.writeFileSync(path.join(OUT, 'smoke-stats.json'), JSON.stringify({ params: P64, weights: wSc, stats: statsOut, dmaxKm: dmax * TILE_KM, umax: core64.umax, cfl: core64.cfl }, null, 1));
  console.log(`      PNGs + smoke-stats.json → ${OUT}  (max|D| ${(dmax * TILE_KM).toFixed(2)} km)`);
}

const nFail = results.filter(r => !r.ok).length;
console.log(`\n${results.length - nFail}/${results.length} passed${nFail ? ` — ${nFail} FAILED` : ''}`);
process.exit(nFail ? 1 : 0);
