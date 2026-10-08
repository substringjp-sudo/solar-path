// Phasor wave for W: (A) kernel-sum cost as proposed (128^2, 16 kernels per lambda^2), (B) spectral variant: complex narrow-band RPN -> atan2.
// Also count dislocations (phase singularities) vs bandwidth, and write PGMs.
import { writeFileSync } from 'node:fs';
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
let seed = 777; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const now = () => Number(process.hrtime.bigint())/1e6;
const pgm = (name, a, n) => { let lo=Infinity, hi=-Infinity; for (const v of a) { if (v<lo) lo=v; if (v>hi) hi=v; } const b = Buffer.alloc(n*n); for (let i=0;i<n*n;i++) b[i] = Math.round(255*(a[i]-lo)/(hi-lo||1)); writeFileSync(name, Buffer.concat([Buffer.from(`P5\n${n} ${n}\n255\n`), b])); };
// (A) kernel sum, as proposed: kernels per lambda^2 = 16, truncation radius 1.5 lambda, periodic.
for (const [n, lamKm] of [[64, 8], [128, 8], [128, 3]]) {
  const lam = lamKm/24; const cells = Math.round(1/lam); const K = cells*cells*16; const kx=[], ky=[], kdx=[], kdy=[], kph=[];
  for (let i = 0; i < K; i++) { kx.push(rnd()); ky.push(rnd()); const th = (rnd()-0.5)*(20*Math.PI/180); kdx.push(Math.cos(th)); kdy.push(Math.sin(th)); kph.push(rnd()*TWO_PI); }
  const a = 1/(0.5*lam); const rcut = 1.5*lam; const Phi = new Float32Array(n*n);
  const t0 = now(); let evals = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = (i+0.5)/n, y = (j+0.5)/n; let sr = 0, si = 0;
    for (let k = 0; k < K; k++) { let dx = x-kx[k]; dx -= Math.round(dx); let dy = y-ky[k]; dy -= Math.round(dy); const r2 = dx*dx+dy*dy; if (r2 > rcut*rcut) continue; evals++;
      const w = Math.exp(-Math.PI*a*a*r2), ph = TWO_PI*(kdx[k]*dx + kdy[k]*dy)/lam + kph[k]; sr += w*Math.cos(ph); si += w*Math.sin(ph); }
    Phi[j*n+i] = Math.atan2(si, sr); }
  console.log(`(A) kernel-sum phasor n=${n} lambda=${lamKm}km K=${K} evals/texel=${(evals/(n*n)).toFixed(0)} -> ${(now()-t0).toFixed(1)} ms node`);
  if (n === 128 && lamKm === 8) pgm('phasorA_128_8km.pgm', Float32Array.from(Phi, v => Math.cos(v)), n);
}
// (B) spectral phasor: complex Gaussian field with spectrum = Gaussian blob at +k_w only (non-Hermitian) -> phase.
function spectral(n, kw, bw, name) {
  const n2 = n*n, re = new Float64Array(n2), im = new Float64Array(n2);
  const t0 = now();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const kx = i <= n/2 ? i : i-n, ky = j <= n/2 ? j : j-n; const d2 = (kx-kw[0])**2 + (ky-kw[1])**2; const amp = Math.exp(-d2/(2*bw*bw)); if (amp < 1e-4) continue; const ph = rnd()*TWO_PI; re[j*n+i] = amp*Math.cos(ph); im[j*n+i] = amp*Math.sin(ph); }
  fft2(re, im, n, true);
  const Phi = new Float32Array(n2); for (let i = 0; i < n2; i++) Phi[i] = Math.atan2(im[i], re[i]);
  const ms = now()-t0;
  // dislocations: count plaquettes where phase winds by +-2pi
  let disl = 0; const wrap = (d) => d - TWO_PI*Math.round(d/TWO_PI);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const p = (jj, ii) => Phi[((jj+n)%n)*n + (ii+n)%n]; const s = wrap(p(j,i+1)-p(j,i)) + wrap(p(j+1,i+1)-p(j,i+1)) + wrap(p(j+1,i)-p(j+1,i+1)) + wrap(p(j,i)-p(j+1,i)); if (Math.abs(s) > Math.PI) disl++; }
  console.log(`(B) spectral phasor n=${n} k_w=(${kw}) bw=${bw} -> ${ms.toFixed(2)} ms node, dislocations/tile=${disl}, per wavelength^2=${(disl/(kw[0]**2+kw[1]**2)).toFixed(2)}`);
  if (name) pgm(name, Float32Array.from(Phi, v => Math.cos(v)), n);
}
spectral(64, [3, 0], 0.3, 'phasorB_64_bw0.3.pgm');
spectral(64, [3, 0], 0.6, 'phasorB_64_bw0.6.pgm');
spectral(64, [3, 0], 1.0, 'phasorB_64_bw1.0.pgm');
spectral(128, [8, 0], 0.8, 'phasorB_128_k8_bw0.8.pgm');
spectral(128, [8, 0], 1.6, 'phasorB_128_k8_bw1.6.pgm');
