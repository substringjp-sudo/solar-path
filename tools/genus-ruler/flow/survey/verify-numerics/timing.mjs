import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../verify-turb/cloudFlow.cjs');
const now = () => Number(process.hrtime.bigint()) / 1e6;
const TWO_PI = 2 * Math.PI;
const minOf = (fn, reps = 7) => { let m = 1e9; for (let r = 0; r < reps; r++) { const t = now(); fn(); m = Math.min(m, now() - t); } return m; };
const run = (p) => { const c = F.newFlowCore(p.n); const it = F.flowCoreSteps(p, 24, c); while (!it.next().done) {} return c; };
for (const seed of [7, 1007]) {
  const base = minOf(() => run({ ...F.FLOW_DEFAULTS, seed })), big = minOf(() => run({ ...F.FLOW_DEFAULTS, seed, steps: 10, psiEvery: 1 }));
  const rk = minOf(() => run({ ...F.FLOW_DEFAULTS, seed, steps: 6, psiEvery: 1 }));
  console.log(`core seed ${seed}: 20x90 psi2 ${base.toFixed(1)} ms | 10x180 psi1 ${big.toFixed(1)} ms | 6x300 psi1 (midpoint) ${rk.toFixed(1)} ms`);
}
// compose variants
const core = run({ ...F.FLOW_DEFAULTS, seed: 7 });
const S = 512, TS = 256, T = new Float32Array(TS * TS).map(() => Math.random()); F.normalizeTemplate(T);
const w = { wQ: 1, wZ: 0.4, wT: 0.4, lag: 0.4, wW: 0.3, waveK: [3, 0], wavePhase: 0.3 };
const f = new Float32Array(S * S);
const tA = minOf(() => { const it = F.flowComposeSteps(core, T, TS, S, w, f); while (!it.next().done) {} }, 5);
// inlined, shared-weight compose on the 64 grid (same math, no function calls for the 64-grid fetches)
const n = core.n, DX = core.dx, DY = core.dy, Q0 = core.q0, Z0 = core.z0n;
function composeInlined() {
  for (let y = 0; y < S; y++) { const v = (y + 0.5) / S; const yy = v * n - 0.5; let y0 = Math.floor(yy); const fy = yy - y0; y0 = ((y0 % n) + n) % n; const y1 = (y0 + 1) % n;
    for (let x = 0; x < S; x++) { const u = (x + 0.5) / S; const xx = u * n - 0.5; let x0 = Math.floor(xx); const fx = xx - x0; x0 = ((x0 % n) + n) % n; const x1 = (x0 + 1) % n;
      const i00 = y0 * n + x0, i01 = y0 * n + x1, i10 = y1 * n + x0, i11 = y1 * n + x1;
      const w00 = (1 - fx) * (1 - fy), w01 = fx * (1 - fy), w10 = (1 - fx) * fy, w11 = fx * fy;
      const dX = DX[i00] * w00 + DX[i01] * w01 + DX[i10] * w10 + DX[i11] * w11, dY = DY[i00] * w00 + DY[i01] * w01 + DY[i10] * w10 + DY[i11] * w11;
      const X = u - dX, Y = v - dY;
      // second shared-weight fetch at X,Y for Q0 and Z0
      const ax = (X - Math.floor(X)) * n - 0.5, ay = (Y - Math.floor(Y)) * n - 0.5; let ax0 = Math.floor(ax), ay0 = Math.floor(ay); const gx = ax - ax0, gy = ay - ay0; ax0 = ((ax0 % n) + n) % n; ay0 = ((ay0 % n) + n) % n; const ax1 = (ax0 + 1) % n, ay1 = (ay0 + 1) % n;
      const j00 = ay0 * n + ax0, j01 = ay0 * n + ax1, j10 = ay1 * n + ax0, j11 = ay1 * n + ax1;
      const v00 = (1 - gx) * (1 - gy), v01 = gx * (1 - gy), v10 = (1 - gx) * gy, v11 = gx * gy;
      let val = w.wQ * (Q0[j00] * v00 + Q0[j01] * v01 + Q0[j10] * v10 + Q0[j11] * v11) + w.wZ * (Z0[j00] * v00 + Z0[j01] * v01 + Z0[j10] * v10 + Z0[j11] * v11);
      val += w.wT * F.bilinearPeriodic(T, TS, u - w.lag * dX, v - w.lag * dY);
      val += w.wW * Math.cos(TWO_PI * (w.waveK[0] * X + w.waveK[1] * Y) + w.wavePhase);
      f[y * S + x] = val; } }
}
const tB = minOf(composeInlined, 5);
// two-grid: g on 128 (includes wave), D on 64, T at 512 — 4 function-call bilinears per texel
const g = new Float32Array(128 * 128);
function twoGrid() {
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { const u = (x + 0.5) / 128, v = (y + 0.5) / 128; const dX = F.bilinearPeriodic(DX, n, u, v), dY = F.bilinearPeriodic(DY, n, u, v), X = u - dX, Y = v - dY; g[y * 128 + x] = w.wQ * F.bilinearPeriodic(Q0, n, X, Y) + w.wZ * F.bilinearPeriodic(Z0, n, X, Y) + w.wW * Math.cos(TWO_PI * (w.waveK[0] * X + w.waveK[1] * Y) + w.wavePhase); }
  for (let y = 0; y < S; y++) { const v = (y + 0.5) / S; for (let x = 0; x < S; x++) { const u = (x + 0.5) / S; const dX = F.bilinearPeriodic(DX, n, u, v), dY = F.bilinearPeriodic(DY, n, u, v); f[y * S + x] = F.bilinearPeriodic(g, 128, u, v) + w.wT * F.bilinearPeriodic(T, TS, u - w.lag * dX, v - w.lag * dY); } }
}
const tC = minOf(twoGrid, 5);
console.log(`compose 512^2: as-is (5 calls + cos) ${tA.toFixed(1)} ms | inlined shared-weight, same grids ${tB.toFixed(1)} ms | two-grid (4 calls) ${tC.toFixed(1)} ms`);
// J / stretch check cost at 64^2
function strainCheck() { let acc = 0; const h = 2 / n; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const ip = (i + 1) % n, im = (i + n - 1) % n, jp = (j + 1) % n, jm = (j + n - 1) % n; const Jxx = 1 - (DX[j * n + ip] - DX[j * n + im]) / h, Jxy = -(DX[jp * n + i] - DX[jm * n + i]) / h, Jyx = -(DY[j * n + ip] - DY[j * n + im]) / h, Jyy = 1 - (DY[jp * n + i] - DY[jm * n + i]) / h; const det = Jxx * Jyy - Jxy * Jyx, a = Jxx * Jxx + Jxy * Jxy + Jyx * Jyx + Jyy * Jyy; const s1 = Math.sqrt(Math.max(0, (a + Math.sqrt(Math.max(0, a * a - 4 * det * det))) / 2)); acc += s1 * s1 / Math.max(1e-9, Math.abs(det)); } return acc; }
console.log(`strain/det check at 64^2: ${minOf(strainCheck, 20).toFixed(3)} ms per check`);
