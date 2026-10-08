// Adversarial numeric check for the FTLE / det J / screened-inversion / vortex-merging claims on the REAL core.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('./cloudFlow.cjs');
const now = () => Number(process.hrtime.bigint()) / 1e6;

function runCore(p) {
  const out = F.newFlowCore(p.n);
  const it = F.flowCoreSteps(p, 24, out);
  while (!it.next().done) {}
  return out;
}
function quant(a, q) { const s = Float32Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; }

for (const seed of [7, 11, 23, 101]) {
  const p = { ...F.FLOW_DEFAULTS, seed };
  const c = runCore(p), n = c.n, h = 1 / n, T = p.hours * 3600;
  const t0 = now();
  const sig = new Float32Array(n * n), det = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const ip = (i + 1) % n, im = (i + n - 1) % n, jp = (j + 1) % n, jm = (j + n - 1) % n;
    const dxu = (c.dx[j * n + ip] - c.dx[j * n + im]) / (2 * h), dxv = (c.dx[jp * n + i] - c.dx[jm * n + i]) / (2 * h);
    const dyu = (c.dy[j * n + ip] - c.dy[j * n + im]) / (2 * h), dyv = (c.dy[jp * n + i] - c.dy[jm * n + i]) / (2 * h);
    // F = grad X = I - grad D
    const a = 1 - dxu, b = -dxv, cc = -dyu, d = 1 - dyv;
    const C11 = a * a + cc * cc, C12 = a * b + cc * d, C22 = b * b + d * d;
    const lam = ((C11 + C22) + Math.sqrt((C11 - C22) ** 2 + 4 * C12 * C12)) / 2;
    sig[j * n + i] = 0.5 * Math.log(Math.max(lam, 1e-9)) / T;
    det[j * n + i] = a * d - b * cc;
  }
  const t1 = now();
  // ridge: sigma above 88% quantile; count connected components and mean length (4-conn, periodic)
  const thr = quant(sig, 0.88);
  const lab = new Int32Array(n * n).fill(-1); let comps = 0; const sizes = [];
  for (let s = 0; s < n * n; s++) {
    if (sig[s] <= thr || lab[s] >= 0) continue;
    const st = [s]; lab[s] = comps; let sz = 0;
    while (st.length) { const k = st.pop(); sz++; const i = k % n, j = (k / n) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = (((j + dj) % n + n) % n) * n + (((i + di) % n + n) % n); if (sig[q] > thr && lab[q] < 0) { lab[q] = comps; st.push(q); } } }
    sizes.push(sz); comps++;
  }
  sizes.sort((x, y) => y - x);
  const lamMax = Math.exp(2 * quant(sig, 0.999) * T), lamMed = Math.exp(2 * quant(sig, 0.5) * T), lam88 = Math.exp(2 * thr * T);
  // correlation of det(gradX) with q0(X)-style term? just report det quantiles and its correlation with sigma
  let m1 = 0, m2 = 0, s1 = 0, s2 = 0, cv = 0; for (let k = 0; k < n * n; k++) { m1 += det[k]; m2 += sig[k]; } m1 /= n * n; m2 /= n * n;
  for (let k = 0; k < n * n; k++) { s1 += (det[k] - m1) ** 2; s2 += (sig[k] - m2) ** 2; cv += (det[k] - m1) * (sig[k] - m2); }
  const corr = cv / Math.sqrt(s1 * s2);
  console.log(`seed ${seed}: FTLE 64^2 ${(t1 - t0).toFixed(2)} ms | sqrt(lam) median ${Math.sqrt(lamMed).toFixed(2)} q88 ${Math.sqrt(lam88).toFixed(2)} q99.9 ${Math.sqrt(lamMax).toFixed(2)} | det(gradX) q1 ${quant(det, .01).toFixed(2)} q50 ${quant(det, .5).toFixed(2)} q99 ${quant(det, .99).toFixed(2)} | ridge comps ${comps} largest ${sizes[0]} cells (${(sizes[0] / (0.12 * n * n) * 100).toFixed(0)}% of ridge area) top3 ${sizes.slice(0, 3)} | corr(det,sigma) ${corr.toFixed(2)} | umax ${c.umax.toFixed(2)} cfl ${c.cfl.toFixed(2)}`);
}

// Vortex-pair co-rotation time at our rms (merging feasibility in 0.5 h)
{
  const u = 2, R = 3000, Gamma = 2 * Math.PI * R * u;
  for (const d of [6000, 10000]) console.log(`co-rotation period of a like-signed pair, R=${R / 1000}km u=${u}m/s, d=${d / 1000}km: ${(2 * Math.PI * Math.PI * d * d / Gamma / 3600).toFixed(1)} h`);
}
// Screened Poisson at L_R = 6 km on a 24 km tile: relative attenuation per |k|
{
  const L = 24000, LR = 6000;
  for (const k of [1, 2, 4, 8]) { const kk = (2 * Math.PI * k / L) ** 2; console.log(`screened k=${k}: psi factor ${(kk / (kk + 1 / LR ** 2)).toFixed(3)}`); }
}
// Timing of a 512^2 bilinear fetch of a 64^2 field (compose-style) to cost the "+1 field term" candidates
{
  const n = 64, S = 512, A = new Float32Array(n * n).map(() => Math.random()), out = new Float32Array(S * S);
  const t0 = now();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) out[y * S + x] = F.bilinearPeriodic(A, n, (x + 0.5) / S, (y + 0.5) / S);
  const t1 = now();
  let s = 0; for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) s += Math.cos(6.28 * (x * 3 + y * 2) / S - 0.4 * Math.sin(6.28 * (x * 3 + y * 2) / S));
  const t2 = now();
  console.log(`512^2 one bilinear fetch of 64^2 field: ${(t1 - t0).toFixed(1)} ms (node); 512^2 cos(theta - a sin theta): ${(t2 - t1).toFixed(1)} ms (node)`);
}
