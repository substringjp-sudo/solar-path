const TWO_PI = 2*Math.PI;
function fft1(re, im, off, stride, n, inverse) {
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { const a = off + i*stride, b = off + j*stride; let t = re[a]; re[a] = re[b]; re[b] = t; t = im[a]; im[a] = im[b]; im[b] = t; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = (inverse ? TWO_PI : -TWO_PI)/len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < half; j++) { const a = off+(i+j)*stride, b = off+(i+j+half)*stride;
      const xr = re[b]*cr - im[b]*ci, xi = re[b]*ci + im[b]*cr; re[b] = re[a]-xr; im[b] = im[a]-xi; re[a] += xr; im[a] += xi; const t = cr*wr - ci*wi; ci = cr*wi + ci*wr; cr = t; } } }
  if (inverse) for (let i = 0; i < n; i++) { re[off+i*stride] /= n; im[off+i*stride] /= n; }
}
function fft2(re, im, n, inv) { for (let y = 0; y < n; y++) fft1(re, im, y*n, 1, n, inv); for (let x = 0; x < n; x++) fft1(re, im, x, n, n, inv); }
function bench(name, fn, reps=3) { fn(); let best = 1e9; for (let r = 0; r < reps; r++) { const t = performance.now(); fn(); best = Math.min(best, performance.now()-t); } console.log(name.padEnd(44), best.toFixed(1), 'ms'); }
for (const n of [64, 128, 256, 512]) { const re = new Float64Array(n*n), im = new Float64Array(n*n); for (let i = 0; i < n*n; i++) re[i] = Math.random();
  bench(`fft2 ${n}^2 (one complex transform)`, () => fft2(re, im, n, false)); }
// rank matching: argsort of 512^2 Float32 via typed index sort
const N = 512*512; const f = new Float32Array(N); for (let i = 0; i < N; i++) f[i] = Math.random();
bench('argsort 512^2 (Uint32 idx .sort cmp)', () => { const idx = new Uint32Array(N); for (let i = 0; i < N; i++) idx[i] = i; idx.sort((a,b) => f[a]-f[b]); });
bench('argsort 256^2', () => { const M = 256*256; const idx = new Uint32Array(M); for (let i = 0; i < M; i++) idx[i] = i; idx.sort((a,b) => f[a]-f[b]); });
// histogram rank (4096 bins) remap LUT 512^2
bench('hist-rank remap 512^2 (4096 bins)', () => { const bins = 4096, h = new Uint32Array(bins); let mn = 1e9, mx = -1e9; for (let i = 0; i < N; i++) { if (f[i] < mn) mn = f[i]; if (f[i] > mx) mx = f[i]; }
  const sc = (bins-1)/(mx-mn); for (let i = 0; i < N; i++) h[Math.floor((f[i]-mn)*sc)]++; const cdf = new Float32Array(bins); let c = 0; for (let b = 0; b < bins; b++) { c += h[b]; cdf[b] = c/N; }
  const out = new Float32Array(N); for (let i = 0; i < N; i++) out[i] = Math.exp(1.2 * cdf[Math.floor((f[i]-mn)*sc)]); });
// separable 5-tap gaussian blur 512^2 (one pyramid level)
bench('separable 5-tap blur 512^2', () => { const W = 512, tmp = new Float32Array(N), out = new Float32Array(N); const k = [1/16, 4/16, 6/16, 4/16, 1/16];
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { let s = 0; for (let t = -2; t <= 2; t++) s += k[t+2]*f[y*W + ((x+t+W)&(W-1))]; tmp[y*W+x] = s; }
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { let s = 0; for (let t = -2; t <= 2; t++) s += k[t+2]*tmp[((y+t+W)&(W-1))*W + x]; out[y*W+x] = s; } });
// bilinear upsample 128->512 periodic
bench('bilinear upsample 128^2 -> 512^2', () => { const n = 128, out = new Float32Array(N); for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) { const u = (x+0.5)/512*n-0.5, v = (y+0.5)/512*n-0.5; const x0 = Math.floor(u), y0 = Math.floor(v), fx = u-x0, fy = v-y0; const a = f[((y0&127)*n)+(x0&127)], b = f[((y0&127)*n)+((x0+1)&127)], c = f[(((y0+1)&127)*n)+(x0&127)], d = f[(((y0+1)&127)*n)+((x0+1)&127)]; const ab = a+(b-a)*fx; out[y*512+x] = ab + (c+(d-c)*fx-ab)*fy; } });
