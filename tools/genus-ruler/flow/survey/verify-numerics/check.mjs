// Adversarial numeric checks for the "cheap numerical methods" candidates, against the real cloudFlow core.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../verify-turb/cloudFlow.cjs');
const now = () => Number(process.hrtime.bigint()) / 1e6;
const TWO_PI = 2 * Math.PI;

function runCore(p) {
  const core = F.newFlowCore(p.n);
  const t0 = now(); const it = F.flowCoreSteps(p, 24, core); while (!it.next().done) {}
  core.ms = now() - t0; return core;
}
function radialSpec(A, n) {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) re[i] = A[i];
  F.fft2(re, im, n, false);
  const P = new Float64Array(n), C = new Int32Array(n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const kx = i <= n / 2 ? i : i - n, ky = j <= n / 2 ? j : j - n, k = Math.round(Math.sqrt(kx * kx + ky * ky));
    if (k < n / 2) { P[k] += re[j * n + i] ** 2 + im[j * n + i] ** 2; C[k]++; }
  }
  return P; // shell power (not normalised)
}
function strainStats(core) {
  const n = core.n, DX = core.dx, DY = core.dy;
  let smax = 0, sSum = 0, detMin = 1e9, detMax = -1e9, detSum = 0;
  const ss = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const ip = (i + 1) % n, im = (i + n - 1) % n, jp = (j + 1) % n, jm = (j + n - 1) % n;
    const h = 2 / n;
    const dDxdx = (DX[j * n + ip] - DX[j * n + im]) / h, dDxdy = (DX[jp * n + i] - DX[jm * n + i]) / h;
    const dDydx = (DY[j * n + ip] - DY[j * n + im]) / h, dDydy = (DY[jp * n + i] - DY[jm * n + i]) / h;
    const Jxx = 1 - dDxdx, Jxy = -dDxdy, Jyx = -dDydx, Jyy = 1 - dDydy;
    const det = Jxx * Jyy - Jxy * Jyx;
    // singular values of J
    const a = Jxx * Jxx + Jxy * Jxy + Jyx * Jyx + Jyy * Jyy, b = det;
    const s1 = Math.sqrt(Math.max(0, (a + Math.sqrt(Math.max(0, a * a - 4 * b * b))) / 2));
    const s2 = Math.abs(b) / Math.max(1e-9, s1);
    const s = s1 / Math.max(1e-9, s2);
    ss.push(s); if (s > smax) smax = s; sSum += s;
    if (det < detMin) detMin = det; if (det > detMax) detMax = det; detSum += det;
  }
  ss.sort((x, y) => x - y);
  const q = (p) => ss[Math.floor(p * (ss.length - 1))];
  return { sMed: q(0.5), s90: q(0.9), sMax: smax, detMin, detMax, detMean: detSum / (n * n) };
}
function maxDisp(core) { let m = 0; for (let i = 0; i < core.dx.length; i++) m = Math.max(m, Math.hypot(core.dx[i], core.dy[i])); return m; }

// ── 1. step regime: 20×90 s psiEvery 2 (today) vs 10×180 s psiEvery 1 vs 40×45 s psiEvery 4
console.log('== 1. step regime (seed 7, 1007, 2007) ==');
for (const seed of [7, 1007, 2007]) {
  const base = runCore({ ...F.FLOW_DEFAULTS, seed });
  const big = runCore({ ...F.FLOW_DEFAULTS, seed, steps: 10, psiEvery: 1 });
  const many = runCore({ ...F.FLOW_DEFAULTS, seed, steps: 40, psiEvery: 4 });
  const n = base.n;
  const rms = (a, b) => { let s = 0, t = 0; for (let i = 0; i < a.dx.length; i++) { s += (a.dx[i] - b.dx[i]) ** 2 + (a.dy[i] - b.dy[i]) ** 2; t += a.dx[i] ** 2 + a.dy[i] ** 2; } return Math.sqrt(s / t); };
  const Pb = radialSpec(base.dx, n), Pg = radialSpec(big.dx, n), Pm = radialSpec(many.dx, n);
  const band = (P, a, b) => { let s = 0; for (let k = a; k <= b; k++) s += P[k]; return s; };
  console.log(`seed ${seed}: ms base ${base.ms.toFixed(1)} big ${big.ms.toFixed(1)} many ${many.ms.toFixed(1)} | relRMS(D big-base) ${rms(base, big).toFixed(3)} (many-base) ${rms(base, many).toFixed(3)} | maxDisp km base ${(maxDisp(base) * 24).toFixed(2)} big ${(maxDisp(big) * 24).toFixed(2)}`);
  console.log(`   D power ratio big/base: k1-4 ${(band(Pg, 1, 4) / band(Pb, 1, 4)).toFixed(3)} k5-8 ${(band(Pg, 5, 8) / band(Pb, 5, 8)).toFixed(3)} k9-16 ${(band(Pg, 9, 16) / band(Pb, 9, 16)).toFixed(3)} k17-31 ${(band(Pg, 17, 31) / band(Pb, 17, 31)).toFixed(3)}; many/base k9-16 ${(band(Pm, 9, 16) / band(Pb, 9, 16)).toFixed(3)}`);
  console.log(`   D band fractions (base): k1-4 ${(band(Pb, 1, 4) / band(Pb, 1, 31)).toFixed(3)} k5-8 ${(band(Pb, 5, 8) / band(Pb, 1, 31)).toFixed(3)} k9-16 ${(band(Pb, 9, 16) / band(Pb, 1, 31)).toExponential(2)} k17-31 ${(band(Pb, 17, 31) / band(Pb, 1, 31)).toExponential(2)}`);
  const sb = strainStats(base), sg = strainStats(big);
  console.log(`   strain base: sMed ${sb.sMed.toFixed(2)} s90 ${sb.s90.toFixed(2)} sMax ${sb.sMax.toFixed(2)} det [${sb.detMin.toFixed(3)}, ${sb.detMax.toFixed(3)}] mean ${sb.detMean.toFixed(4)} | big: sMed ${sg.sMed.toFixed(2)} s90 ${sg.s90.toFixed(2)} sMax ${sg.sMax.toFixed(2)} det [${sg.detMin.toFixed(3)}, ${sg.detMax.toFixed(3)}] cfl ${big.cfl.toFixed(2)}`);
}
// hours sweep for the distortion gate calibration
console.log('== 1b. strain vs hours (seed 7, 20 steps psiEvery 2) ==');
for (const hours of [0.3, 0.5, 0.7, 1.0]) { const c = runCore({ ...F.FLOW_DEFAULTS, seed: 7, hours }); const s = strainStats(c); console.log(`hours ${hours}: sMed ${s.sMed.toFixed(2)} s90 ${s.s90.toFixed(2)} sMax ${s.sMax.toFixed(2)} det [${s.detMin.toFixed(2)}, ${s.detMax.toFixed(2)}] maxDisp ${(maxDisp(c) * 24).toFixed(1)} km`); }
for (const vrms of [1, 3]) { const c = runCore({ ...F.FLOW_DEFAULTS, seed: 7, vrms }); const s = strainStats(c); console.log(`vrms ${vrms}: sMed ${s.sMed.toFixed(2)} s90 ${s.s90.toFixed(2)} sMax ${s.sMax.toFixed(2)}`); }

// ── 2. spectral zero-pad upsampling of D (64→128, 64→256) vs bilinear; effect on composed f and on d bytes
console.log('== 2. spectral upsampling of D / q0 / z0 ==');
function upsample(A, n, m) { // band-limited zero-pad, returns Float32Array m×m
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) re[i] = A[i];
  F.fft2(re, im, n, false);
  const RE = new Float64Array(m * m), IM = new Float64Array(m * m), sc = (m * m) / (n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const kx = i <= n / 2 ? i : i - n, ky = j <= n / 2 ? j : j - n;
    if (Math.abs(kx) === n / 2 || Math.abs(ky) === n / 2) continue; // drop Nyquist
    const I = ((kx % m) + m) % m, J = ((ky % m) + m) % m;
    RE[J * m + I] = re[j * n + i] * sc; IM[J * m + I] = im[j * n + i] * sc;
  }
  F.fft2(RE, IM, m, true);
  const out = new Float32Array(m * m); for (let i = 0; i < m * m; i++) out[i] = RE[i]; return out;
}
// periodic cellular template with sharp-ish cells (stand-in for sc template), 256^2
function makeTemplate(TS, seed) {
  let s = seed; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const K = 60, cx = [], cy = []; for (let k = 0; k < K; k++) { cx.push(rnd()); cy.push(rnd()); }
  const T = new Float32Array(TS * TS);
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const u = (x + 0.5) / TS, v = (y + 0.5) / TS; let d1 = 9, d2 = 9;
    for (let k = 0; k < K; k++) { let dx = Math.abs(u - cx[k]), dy = Math.abs(v - cy[k]); dx = Math.min(dx, 1 - dx); dy = Math.min(dy, 1 - dy); const d = Math.sqrt(dx * dx + dy * dy); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
    T[y * TS + x] = Math.max(0, 1 - d1 / 0.09) ** 1.5 + 0.3 * (d2 - d1) / 0.09;
  }
  F.normalizeTemplate(T); return T;
}
function composeWith(core, T, TS, S, w, DXs, DYs, Q0s, Z0s, ns) { // same formula as flowComposeSteps but with substitutable grids
  const f = new Float32Array(S * S);
  for (let y = 0; y < S; y++) { const v = (y + 0.5) / S; for (let x = 0; x < S; x++) { const u = (x + 0.5) / S;
    const dX = F.bilinearPeriodic(DXs, ns.d, u, v), dY = F.bilinearPeriodic(DYs, ns.d, u, v), X = u - dX, Y = v - dY;
    let val = w.wQ * F.bilinearPeriodic(Q0s, ns.q, X, Y) + w.wZ * F.bilinearPeriodic(Z0s, ns.q, X, Y);
    if (w.wT) val += w.wT * F.bilinearPeriodic(T, TS, u - w.lag * dX, v - w.lag * dY);
    if (w.wW) val += w.wW * Math.cos(TWO_PI * (w.waveK[0] * X + w.waveK[1] * Y) + w.wavePhase);
    f[y * S + x] = val; } }
  return f;
}
function toBytes(f, cover) { const S2 = f.length, th = F.quantileHist(f, 1 - cover), dd = new Float32Array(S2); F.rankNormalize(f, th, 2.0, dd); const b = new Uint8Array(S2); for (let i = 0; i < S2; i++) b[i] = dd[i] > 0 ? Math.max(1, Math.round(dd[i] * 255)) : 0; return b; }
function byteDiff(a, b) { let n = 0, big = 0, maskDiff = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) n++; if (d > 2) big++; if ((a[i] > 0) !== (b[i] > 0)) maskDiff++; } return { frac: n / a.length, bigFrac: big / a.length, maskFrac: maskDiff / a.length }; }
function slope(P, S, tileKm, lamLoKm, lamHiKm) { // radial log-log slope of shell power between wavelengths
  const kLo = tileKm / lamHiKm, kHi = tileKm / lamLoKm; let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let k = Math.ceil(kLo); k <= Math.floor(kHi) && k < S / 2; k++) { if (P[k] <= 0) continue; const x = Math.log(k), y = Math.log(P[k] / (2 * Math.PI * k)); sx += x; sy += y; sxx += x * x; sxy += x * y; n++; }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}
const S = 512, TS = 256, T = makeTemplate(TS, 99);
const wsc = { wQ: 1.0, wZ: 0.4, wT: 0.4, lag: 0.4, wW: 0, waveK: [0, 1], wavePhase: 0 };
for (const seed of [7, 1007]) {
  const core = runCore({ ...F.FLOW_DEFAULTS, seed });
  const n = core.n;
  const t0 = now(); const D128x = upsample(core.dx, n, 128), D128y = upsample(core.dy, n, 128); const tUp128 = now() - t0;
  const t1 = now(); const D256x = upsample(core.dx, n, 256), D256y = upsample(core.dy, n, 256); const tUp256 = now() - t1;
  const Q256 = upsample(core.q0, n, 256), Z256 = upsample(core.z0n, n, 256);
  const Q128 = upsample(core.q0, n, 128), Z128 = upsample(core.z0n, n, 128);
  // "truth": 256 everywhere
  const fRef = composeWith(core, T, TS, S, wsc, D256x, D256y, Q256, Z256, { d: 256, q: 256 });
  const fNow = composeWith(core, T, TS, S, wsc, core.dx, core.dy, core.q0, core.z0n, { d: 64, q: 64 });
  const fD128 = composeWith(core, T, TS, S, wsc, D128x, D128y, Q128, Z128, { d: 128, q: 128 });
  const fDonly = composeWith(core, T, TS, S, wsc, D256x, D256y, core.q0, core.z0n, { d: 256, q: 64 });
  const fQonly = composeWith(core, T, TS, S, wsc, core.dx, core.dy, Q256, Z256, { d: 64, q: 256 });
  const sd = (a) => { let m = 0; for (const v of a) m += v; m /= a.length; let s = 0; for (const v of a) s += (v - m) ** 2; return Math.sqrt(s / a.length); };
  const relErr = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length) / sd(b); };
  console.log(`seed ${seed}: upsample ms 64->128 pair ${tUp128.toFixed(1)}  64->256 pair ${tUp256.toFixed(1)}; relRMS(f) now-vs-256 ${relErr(fNow, fRef).toFixed(4)}  D128/Q128 ${relErr(fD128, fRef).toFixed(4)}  D256 only ${relErr(fDonly, fRef).toFixed(4)}  Q256 only ${relErr(fQonly, fRef).toFixed(4)}`);
  for (const cover of [0.25, 0.85]) {
    const bRef = toBytes(fRef, cover), bNow = toBytes(fNow, cover), b128 = toBytes(fD128, cover), bDo = toBytes(fDonly, cover);
    const d1 = byteDiff(bNow, bRef), d2 = byteDiff(b128, bRef), d3 = byteDiff(bDo, bRef);
    console.log(`   cover ${cover}: bytes differing now-vs-256 ${(d1.frac * 100).toFixed(1)}% (>2: ${(d1.bigFrac * 100).toFixed(1)}%, mask ${(d1.maskFrac * 100).toFixed(2)}%) | 128-vs-256 ${(d2.frac * 100).toFixed(1)}% (>2: ${(d2.bigFrac * 100).toFixed(1)}%, mask ${(d2.maskFrac * 100).toFixed(2)}%) | D256only-vs-256 ${(d3.frac * 100).toFixed(1)}% (mask ${(d3.maskFrac * 100).toFixed(2)}%)`);
    // facet signature: spectral slope of d 0.14-0.5 km and 0.5-6 km
    const dF = (b) => { const a = new Float32Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b[i] / 255; return a; };
    const Pn = radialSpec(dF(bNow), S), Pr = radialSpec(dF(bRef), S);
    console.log(`   slope 0.14-0.5 km: now ${slope(Pn, S, 24, 0.14, 0.5).toFixed(2)} 256 ${slope(Pr, S, 24, 0.14, 0.5).toFixed(2)} | slope 0.5-6 km: now ${slope(Pn, S, 24, 0.5, 6).toFixed(2)} 256 ${slope(Pr, S, 24, 0.5, 6).toFixed(2)}`);
    // kink energy: second difference of d along x, averaged at 64-grid cell boundaries vs interior columns
    const b = bNow; let kb = 0, ki = 0, nb = 0, ni = 0;
    for (let y = 0; y < S; y++) for (let x = 1; x < S - 1; x++) { const v = Math.abs(b[y * S + x + 1] - 2 * b[y * S + x] + b[y * S + x - 1]); if (((x + 0.5) * 64 / S) % 1 < 0.126 || ((x + 0.5) * 64 / S) % 1 > 0.874) { kb += v; nb++; } else { ki += v; ni++; } }
    const b2 = bRef; let kb2 = 0, ki2 = 0, nb2 = 0, ni2 = 0;
    for (let y = 0; y < S; y++) for (let x = 1; x < S - 1; x++) { const v = Math.abs(b2[y * S + x + 1] - 2 * b2[y * S + x] + b2[y * S + x - 1]); if (((x + 0.5) * 64 / S) % 1 < 0.126 || ((x + 0.5) * 64 / S) % 1 > 0.874) { kb2 += v; nb2++; } else { ki2 += v; ni2++; } }
    console.log(`   2nd-difference |d''| at 64-cell boundaries / interior: now ${((kb / nb) / (ki / ni)).toFixed(3)}  256 ${((kb2 / nb2) / (ki2 / ni2)).toFixed(3)}  (1.0 = no grid-aligned kinks)`);
  }
  // ── 3. two-grid compose: smooth part g at 128^2 (bilinear up), template at 512^2, D from 128 spectral
  {
    const g = new Float32Array(128 * 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { const u = (x + 0.5) / 128, v = (y + 0.5) / 128; const dX = D128x[y * 128 + x], dY = D128y[y * 128 + x], X = u - dX, Y = v - dY; g[y * 128 + x] = wsc.wQ * F.bilinearPeriodic(Q128, 128, X, Y) + wsc.wZ * F.bilinearPeriodic(Z128, 128, X, Y); }
    const f2 = new Float32Array(S * S);
    const t2 = now();
    for (let y = 0; y < S; y++) { const v = (y + 0.5) / S; for (let x = 0; x < S; x++) { const u = (x + 0.5) / S; const dX = F.bilinearPeriodic(D128x, 128, u, v), dY = F.bilinearPeriodic(D128y, 128, u, v); f2[y * S + x] = F.bilinearPeriodic(g, 128, u, v) + wsc.wT * F.bilinearPeriodic(T, TS, u - wsc.lag * dX, v - wsc.lag * dY); } }
    const tTwo = now() - t2;
    const t3 = now(); composeWith(core, T, TS, S, wsc, D128x, D128y, Q128, Z128, { d: 128, q: 128 }); const tFull = now() - t3;
    console.log(`   two-grid compose (4 bilinear/texel, no packing): ${tTwo.toFixed(1)} ms vs full 5-bilinear at 128 grids ${tFull.toFixed(1)} ms; relRMS(f) two-grid vs D128 full ${relErr(f2, fD128).toFixed(4)} vs 256 ref ${relErr(f2, fRef).toFixed(4)}`);
    for (const cover of [0.25, 0.85]) { const d = byteDiff(toBytes(f2, cover), toBytes(fD128, cover)); console.log(`   cover ${cover}: two-grid vs full(128) bytes differing ${(d.frac * 100).toFixed(1)}% (>2: ${(d.bigFrac * 100).toFixed(2)}%, mask ${(d.maskFrac * 100).toFixed(2)}%)`); }
  }
}
// ── 4. screened Poisson: velocity energy per shell with and without 1/Ld^2, after vrms renormalisation
console.log('== 4. screened Poisson (equivalent barotropic) ==');
{
  const n = 64, L = 24000, p = { ...F.FLOW_DEFAULTS, seed: 7 };
  // regenerate psi0 spectrum as flowCoreSteps does (same rng)
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = (r) => { const u = Math.max(1e-12, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * v); };
  const r = rng(p.seed * 7919 + 13), wang = (p.windDeg * Math.PI) / 180, wx = Math.sin(wang), wy = Math.cos(wang);
  const shellZ = new Float64Array(n); // |zeta_k|^2 per shell
  const modes = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const kx = i <= n / 2 ? i : i - n, ky = j <= n / 2 ? j : j - n, k = Math.sqrt(kx * kx + ky * ky); if (k < 1 || k > p.kmax) continue; if (ky < 0 || (ky === 0 && kx < 0)) continue; const khat = (kx * wx + ky * wy) / k; const amp = Math.pow(k, -p.specPow) * gauss(r) / (1 + p.aniso * khat * khat); r(); const kk = (TWO_PI * k / L) ** 2; modes.push({ k, zeta2: (kk * amp) ** 2, kk }); }
  for (const Ld of [Infinity, 8000, 6000, 3000]) {
    const E = new Float64Array(10); let tot = 0;
    for (const m of modes) { const psi2 = m.zeta2 / (m.kk + (Ld === Infinity ? 0 : 1 / (Ld * Ld))) ** 2; const u2 = m.kk * psi2; E[Math.round(m.k)] += u2; tot += u2; }
    console.log(`Ld ${Ld === Infinity ? 'inf' : Ld / 1000 + ' km'}: velocity energy fraction k=1 ${(E[1] / tot).toFixed(3)} k=2 ${(E[2] / tot).toFixed(3)} k=3-4 ${((E[3] + E[4]) / tot).toFixed(3)} k=5-8 ${((E[5] + E[6] + E[7] + E[8]) / tot).toFixed(3)} (after vrms renormalisation)`);
  }
  for (const sp of [2.5, 2.0, 1.5]) {
    const E = new Float64Array(10); let tot = 0;
    for (const m of modes) { const u2 = m.kk * (m.zeta2 / m.kk ** 2) * Math.pow(m.k, 2 * (2.5 - sp)); E[Math.round(m.k)] += u2; tot += u2; }
    console.log(`specPow ${sp} (no screening): k=1 ${(E[1] / tot).toFixed(3)} k=2 ${(E[2] / tot).toFixed(3)} k=3-4 ${((E[3] + E[4]) / tot).toFixed(3)} k=5-8 ${((E[5] + E[6] + E[7] + E[8]) / tot).toFixed(3)}`);
  }
  // q0 variance share at k=1,2 (the trough) with qPow 2, kq 12
  let tq = 0; const Eq = new Float64Array(14);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const kx = i <= n / 2 ? i : i - n, ky = j <= n / 2 ? j : j - n, k = Math.sqrt(kx * kx + ky * ky); if (k < 1 || k > 12) continue; const v = Math.pow(k, -2 * p.qPow); Eq[Math.round(k)] += v; tq += v; }
  console.log(`q0 (qPow 2, kq 12) expected variance share: k=1 ${(Eq[1] / tq).toFixed(3)} k=2 ${(Eq[2] / tq).toFixed(3)} k>=3 ${(1 - (Eq[1] + Eq[2]) / tq).toFixed(3)}`);
}
// ── 5. Lamb-Oseen blob: self-rotation in 0.5 h, and its footprint in standardised z0n
console.log('== 5. vortex blob arithmetic ==');
{
  const rKm = 2, Gamma = 2 * Math.PI * rKm * 1000 * 2.5 / (1 - Math.exp(-1.12 * 1.12)); // peak u_theta 2.5 m/s near r~1.12 r_m
  const uth = (rr) => Gamma / (2 * Math.PI * rr) * (1 - Math.exp(-(rr * rr) / (rKm * 1000) ** 2));
  for (const rr of [500, 1000, 2000, 4000, 8000]) console.log(`r ${rr} m: u ${uth(rr).toFixed(2)} m/s, rotation in 0.5 h ${(uth(rr) * 1800 / rr * 180 / Math.PI).toFixed(0)} deg`);
  console.log(`blob peak zeta = Gamma/(pi r^2) = ${(Gamma / (Math.PI * (rKm * 1000) ** 2)).toExponential(2)} 1/s; spectral zeta rms for vrms 2 m/s at k~4..8: ~${(2 * TWO_PI * 6 / 24000).toExponential(2)} 1/s`);
}
