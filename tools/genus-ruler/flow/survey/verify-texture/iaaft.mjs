// IAAFT on q0 at N=64/128: time per iteration, convergence of spectrum + histogram, and how much skew survives qCorr mix + template sum.
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
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => Math.sqrt(-2*Math.log(Math.max(1e-12, rnd()))) * Math.cos(TWO_PI*rnd());
const stats = (a) => { const n=a.length; let m=0; for (const v of a) m+=v; m/=n; let s=0,s3=0,s4=0; for (const v of a){const d=v-m; s+=d*d; s3+=d*d*d; s4+=d*d*d*d;} s/=n; return {sd:Math.sqrt(s), skew:s3/n/Math.pow(s,1.5), kurt:s4/n/(s*s)-3}; };
const now = () => Number(process.hrtime.bigint())/1e6;
for (const n of [64, 128]) {
  const n2 = n*n, kq = n === 64 ? 12 : 24, qPow = 2.0;
  // target amplitude table and target sorted histogram (lognormal sigma=1, standardized)
  const amp = new Float64Array(n2);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const kx = i <= n/2 ? i : i-n, ky = j <= n/2 ? j : j-n, k = Math.hypot(kx, ky); amp[j*n+i] = (k >= 1 && k <= kq) ? Math.pow(k, -qPow) : 0; }
  const target = new Float64Array(n2); for (let i = 0; i < n2; i++) target[i] = Math.exp(1.0*gauss()); target.sort();
  // start: RPN
  const re = new Float64Array(n2), im = new Float64Array(n2);
  for (let i = 0; i < n2; i++) { const ph = rnd()*TWO_PI; re[i] = amp[i]*Math.cos(ph); im[i] = amp[i]*Math.sin(ph); }
  fft2(re, im, n, true); const x = new Float64Array(n2); for (let i = 0; i < n2; i++) x[i] = re[i];
  const idx = new Uint32Array(n2);
  const specErr = () => { for (let i = 0; i < n2; i++) { re[i] = x[i]; im[i] = 0; } fft2(re, im, n, false); let e=0, t=0; for (let i = 0; i < n2; i++) { const a = Math.hypot(re[i], im[i]), ta = amp[i]*n2*0; } 
    // relative error on radial amplitude profile (compare normalized profiles)
    let sa=0, st=0; for (let i = 0; i < n2; i++) { sa += Math.hypot(re[i], im[i]); st += amp[i]; }
    for (let i = 0; i < n2; i++) { const a = Math.hypot(re[i], im[i])/sa, b = amp[i]/st; e += Math.abs(a-b); t += b; } return e/t; };
  const t0 = now(); let msIt = 0;
  for (let it = 0; it < 10; it++) {
    const ta = now();
    // (ii) rank remap to target histogram
    for (let i = 0; i < n2; i++) idx[i] = i; idx.sort((a, b) => x[a] - x[b]);
    for (let r = 0; r < n2; r++) x[idx[r]] = target[r];
    // (i) impose amplitude, keep phase
    for (let i = 0; i < n2; i++) { re[i] = x[i]; im[i] = 0; } fft2(re, im, n, false);
    for (let i = 0; i < n2; i++) { const a = Math.hypot(re[i], im[i]); if (a > 1e-12) { re[i] *= amp[i]/a; im[i] *= amp[i]/a; } else { re[i] = amp[i]; im[i] = 0; } }
    fft2(re, im, n, true); for (let i = 0; i < n2; i++) x[i] = re[i];
    msIt = now() - ta;
    if (it === 0 || it === 4 || it === 9) { const s = stats(x); console.log(`n=${n} it=${it+1} specErr(after hist step)=${specErr().toFixed(3)} skew=${s.skew.toFixed(2)} kurt=${s.kurt.toFixed(2)} (target skew ${stats(target).skew.toFixed(2)}) it ms=${msIt.toFixed(2)}`); }
  }
  console.log(`n=${n} 10 iterations total ${(now()-t0).toFixed(1)} ms`);
  // survival of skew after qCorr=0.5 mix with a Gaussian z0n and after + 0.4*T (standardized Gaussian template) at 512 via bilinear (approximate: same grid)
  const z = new Float64Array(n2); for (let i = 0; i < n2; i++) z[i] = gauss();
  const sx = stats(x); const q = new Float64Array(n2); for (let i = 0; i < n2; i++) q[i] = 0.5*z[i] + Math.sqrt(0.75)*(x[i]-0)/sx.sd;
  const T = new Float64Array(n2); for (let i = 0; i < n2; i++) T[i] = gauss();
  const f = new Float64Array(n2); for (let i = 0; i < n2; i++) f[i] = 1.0*q[i] + 0.4*z[i] + 0.4*T[i];
  console.log(`n=${n} skew: q0 ${sx.skew.toFixed(2)} -> after qCorr 0.5 mix ${stats(q).skew.toFixed(2)} -> f (wQ1,wZ.4,wT.4) ${stats(f).skew.toFixed(2)} ; mix order swapped (IAAFT after mix) would keep ${sx.skew.toFixed(2)}`);
}
