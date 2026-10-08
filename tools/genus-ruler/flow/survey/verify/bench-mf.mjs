// Cost + effect checks for the multifractal candidates on our grid (node; Hermes ~5-10x slower).
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = (r) => { const u = Math.max(1e-12, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function bench(name, fn, reps = 3) { fn(); let best = 1e9; for (let i = 0; i < reps; i++) { const t = performance.now(); fn(); best = Math.min(best, performance.now() - t); } console.log(name.padEnd(60), best.toFixed(1), 'ms'); return best; }
// value-noise octave: block gaussians at k=2^l, bilinear periodic to S^2
function octave(S, k, seed, out, sigma) {
  const r = rng(seed), g = new Float32Array(k * k); for (let i = 0; i < k * k; i++) g[i] = gauss(r);
  for (let y = 0; y < S; y++) { const v = (y + 0.5) / S * k - 0.5; let y0 = Math.floor(v); const fy = v - y0; y0 = ((y0 % k) + k) % k; const y1 = (y0 + 1) % k;
    for (let x = 0; x < S; x++) { const u = (x + 0.5) / S * k - 0.5; let x0 = Math.floor(u); const fx = u - x0; x0 = ((x0 % k) + k) % k; const x1 = (x0 + 1) % k;
      const a = g[y0 * k + x0], b = g[y0 * k + x1], c = g[y1 * k + x0], d = g[y1 * k + x1]; const ab = a + (b - a) * fx; out[y * S + x] += sigma * (ab + (c + (d - c) * fx - ab) * fy); } }
}
function cascade(S, sigma, nOct, seed) { const G = new Float32Array(S * S); let s2 = 0; for (let l = 1; l <= nOct; l++) { const sg = l === 1 ? 0.5 * sigma : sigma; octave(S, 1 << l, seed + l, G, sg); s2 += sg * sg; } for (let i = 0; i < S * S; i++) G[i] = Math.exp(G[i] - s2 / 2); return G; }
// stats
function stats(F) { let m = 0; for (const v of F) m += v; m /= F.length; const s = Float32Array.from(F).sort(); const q = (p) => s[Math.floor(p * (s.length - 1))]; let lv = []; for (const v of F) lv.push(Math.log(v)); lv.sort((a, b) => a - b); const lq = (p) => lv[Math.floor(p * (lv.length - 1))]; return { mean: m.toFixed(3), p90p10: (q(.9) / q(.1)).toFixed(2), lnIQR: (lq(.75) - lq(.25)).toFixed(3), max_mean: (q(1) / m).toFixed(1) }; }
for (const S of [256, 512]) {
  let G; bench(`lognormal cascade ${S}^2, 8 octaves (candidate 1)`, () => { G = cascade(S, 0.37, 8, 11); });
  console.log('   stats C1=0.1:', stats(G)); 
}
// Laplacian pyramid 5 levels at 256^2 (candidate 2)
function blurDown(P, n) { const k = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16]; const t = new Float32Array(n * n), b = new Float32Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let s = 0; for (let i = -2; i <= 2; i++) s += k[i + 2] * P[y * n + ((x + i + n) % n)]; t[y * n + x] = s; } for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let s = 0; for (let i = -2; i <= 2; i++) s += k[i + 2] * t[((y + i + n) % n) * n + x]; b[y * n + x] = s; } const h = n >> 1, D = new Float32Array(h * h); for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) D[y * h + x] = b[(2 * y) * n + 2 * x]; return { b, D }; }
function up(D, h, n, out, w) { for (let y = 0; y < n; y++) { const v = (y + 0.5) / n * h - 0.5; let y0 = Math.floor(v); const fy = v - y0; y0 = ((y0 % h) + h) % h; const y1 = (y0 + 1) % h; for (let x = 0; x < n; x++) { const u = (x + 0.5) / n * h - 0.5; let x0 = Math.floor(u); const fx = u - x0; x0 = ((x0 % h) + h) % h; const x1 = (x0 + 1) % h; const a = D[y0 * h + x0], b = D[y0 * h + x1], c = D[y1 * h + x0], d = D[y1 * h + x1]; const ab = a + (b - a) * fx; out[y * n + x] += w * (ab + (c + (d - c) * fx - ab) * fy); } } }
function lapPyr(P0, S, H, levels) { const out = new Float32Array(S * S); let P = P0, n = S; for (let l = 0; l < levels; l++) { const { b, D } = blurDown(P, n); const L = new Float32Array(n * n); for (let i = 0; i < n * n; i++) L[i] = P[i] - b[i]; up(L, n, S, out, Math.pow(2, H * l)); P = D; n >>= 1; } up(P, n, S, out, Math.pow(2, H * levels)); return out; }
for (const S of [256, 512]) { const P0 = new Float32Array(S * S); const r = rng(3); for (let i = 0; i < S * S; i++) P0[i] = gauss(r); bench(`Laplacian pyramid 5 lvl ${S}^2 (candidate 2)`, () => lapPyr(P0, S, 0.3, 5)); }
// Bounded cascade 2-D at 256^2 (candidate 3): block transfers + interpolation per level
function bounded(S, H, p, seed) { const r = rng(seed); let F = new Float32Array([1]); let n = 1; const levels = Math.log2(S); for (let i = 1; i <= levels; i++) { const W = (1 - 2 * p) / Math.pow(2, H * (i - 1)); const m = n * 2, G = new Float32Array(m * m); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = F[y * n + x]; const sx = r() < 0.5 ? 1 : -1, sy = r() < 0.5 ? 1 : -1; G[(2 * y) * m + 2 * x] = v * (1 + sx * W) * (1 + sy * W); G[(2 * y) * m + 2 * x + 1] = v * (1 - sx * W) * (1 + sy * W); G[(2 * y + 1) * m + 2 * x] = v * (1 + sx * W) * (1 - sy * W); G[(2 * y + 1) * m + 2 * x + 1] = v * (1 - sx * W) * (1 - sy * W); } F = G; n = m; } return F; }
let B; bench('bounded cascade 256^2 no interp (candidate 3)', () => { B = bounded(256, 1 / 3, 0.3, 5); }); console.log('   stats:', stats(B));
bench('bounded cascade 512^2 no interp', () => bounded(512, 1 / 3, 0.3, 5));
// p-model 256^2
function pmodel(S, p, seed) { const r = rng(seed); let F = new Float32Array([1]); let n = 1; const levels = Math.log2(S); for (let i = 1; i <= levels; i++) { const m = n * 2, G = new Float32Array(m * m); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = F[y * n + x]; const wx = r() < 0.5 ? p : 1 - p, wy = r() < 0.5 ? p : 1 - p; G[(2 * y) * m + 2 * x] = v * 4 * wx * wy; G[(2 * y) * m + 2 * x + 1] = v * 4 * (1 - wx) * wy; G[(2 * y + 1) * m + 2 * x] = v * 4 * wx * (1 - wy); G[(2 * y + 1) * m + 2 * x + 1] = v * 4 * (1 - wx) * (1 - wy); } F = G; n = m; } return F; }
let PM; bench('p-model 256^2 (candidate 4)', () => { PM = pmodel(256, 0.7, 5); }); console.log('   stats p=0.7 8 oct:', stats(PM));
// CMS stable sampler (candidate 5)
function cms(alpha, beta, r) { const V = (r() - 0.5) * Math.PI, W = -Math.log(Math.max(1e-12, r())); const B = Math.atan(beta * Math.tan(Math.PI * alpha / 2)) / alpha; const S = Math.pow(1 + beta * beta * Math.tan(Math.PI * alpha / 2) ** 2, 1 / (2 * alpha)); return S * Math.sin(alpha * (V + B)) / Math.pow(Math.cos(V), 1 / alpha) * Math.pow(Math.cos(V - alpha * (V + B)) / W, (1 - alpha) / alpha); }
bench('CMS 87k samples (candidate 5)', () => { const r = rng(9); let s = 0; for (let i = 0; i < 87000; i++) s += cms(1.7, -1, r); return s; });
{ const r = rng(9); const xs = []; for (let i = 0; i < 100000; i++) xs.push(cms(1.7, -1, r)); xs.sort((a, b) => a - b); console.log('   CMS alpha1.7 beta-1 quantiles p0.1/p50/p99/p99.9/max:', [0.001, 0.5, 0.99, 0.999, 0.99999].map(q => xs[Math.floor(q * (xs.length - 1))].toFixed(2)).join(' ')); }
// erfinv per cloud texel (candidate 8)
function erfinv(x) { const a = 0.147; const ln = Math.log(1 - x * x); const t = 2 / (Math.PI * a) + ln / 2; return Math.sign(x) * Math.sqrt(Math.sqrt(t * t - ln / a) - t); }
bench('erfinv+exp 262k (candidate 8)', () => { let s = 0; for (let i = 0; i < 262144; i++) { const u = (i + 0.5) / 262144; s += Math.min(1, Math.exp(0.5 * (erfinv(2 * u - 1) * Math.SQRT2 - 1.64))); } return s; });
{ const n = 262144; let thin = 0, sat = 0; const sig = 0.6, zTop = 1.64; for (let i = 0; i < n; i++) { const u = (i + 0.5) / n; const d = Math.min(1, Math.exp(sig * (erfinv(2 * u - 1) * Math.SQRT2 - zTop))); if (d < 0.2) thin++; if (d >= 0.99) sat++; } console.log(`   lognormal d sigma=0.6 top=0.95: thinFrac ${(thin / n).toFixed(3)} satFrac ${(sat / n).toFixed(3)}`); }
{ const n = 262144; let thin = 0; for (let i = 0; i < n; i++) { const u = (i + 0.5) / n; if (Math.pow(u, 2) < 0.2) thin++; } console.log(`   rank^2 today: thinFrac ${(thin / n).toFixed(3)}`); }
// FFT 128^2, 256^2 from bench.js numbers reused
