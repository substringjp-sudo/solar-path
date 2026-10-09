// HPB on a structured (non-Gaussian) cloud-like field: how much of the blend zone becomes Gaussian mush?
// Field: thresholded/ranked sum of a few low-k modes + Voronoi-ish cells (as in our f); Gaussianize; blend 3 random offsets with hex weights; compare kurtosis/skew of gradient magnitude and edge sharpness in blend zone vs vertex zone.
let seed = 99; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const n = 256; const n2 = n*n;
// structured field: deformed cells (sharp-edged) + low-k trough
const pts = []; for (let i = 0; i < 60; i++) pts.push([rnd(), rnd()]);
const f = new Float32Array(n2);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = (i+0.5)/n, y = (j+0.5)/n; let d1 = 9, d2 = 9; for (const p of pts) { let dx = x-p[0]; dx -= Math.round(dx); let dy = y-p[1]; dy -= Math.round(dy); const d = Math.hypot(dx, dy); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  f[j*n+i] = (d2 - d1)*8 + 0.8*Math.cos(2*Math.PI*(x + 0.3*y)) ; }
// Gaussianize by rank
const idx = new Uint32Array(n2); for (let i = 0; i < n2; i++) idx[i] = i; idx.sort((a,b) => f[a]-f[b]);
const g = new Float32Array(n2); const erfinv = (p) => { const a = 0.147; const ln = Math.log(1-p*p); const t = 2/(Math.PI*a) + ln/2; return Math.sign(p)*Math.sqrt(Math.sqrt(t*t - ln/a) - t); };
for (let r = 0; r < n2; r++) g[idx[r]] = Math.SQRT2*erfinv(2*(r+0.5)/n2 - 1);
const tex = (u, v) => { const x = ((u%1)+1)%1*n, y = ((v%1)+1)%1*n; const x0 = Math.floor(x), y0 = Math.floor(y), fx = x-x0, fy = y-y0; const at = (ii, jj) => g[((jj%n+n)%n)*n + (ii%n+n)%n]; const a = at(x0,y0), b = at(x0+1,y0), c = at(x0,y0+1), d = at(x0+1,y0+1); const ab = a+(b-a)*fx; return ab + (c+(d-c)*fx-ab)*fy; };
// hex tiling (Heitz-Neyret): triangle grid of scale s (cell = 1/3 tile ~ 8 km), 3 vertices, barycentric weights ^ p
const S = 3; const hash = (i, j) => { let h = (i*374761393 + j*668265263) >>> 0; h = (h ^ (h >>> 13)) * 1274126177 >>> 0; return [(h & 0xffff)/65536, ((h >>> 16) & 0xffff)/65536]; };
function hpb(u, v, p) { // simple triangular lattice
  const skew = [[1, 0], [-0.5, Math.sqrt(3)/2]]; const x = u*S, y = v*S; // skew the grid
  const X = x - y/Math.sqrt(3), Y = y*2/Math.sqrt(3); const bx = Math.floor(X), by = Math.floor(Y); const fx = X-bx, fy = Y-by;
  let v1, v2, v3, w1, w2, w3; if (fx + fy < 1) { v1=[bx,by]; v2=[bx+1,by]; v3=[bx,by+1]; w1=1-fx-fy; w2=fx; w3=fy; } else { v1=[bx+1,by+1]; v2=[bx,by+1]; v3=[bx+1,by]; w1=fx+fy-1; w2=1-fx; w3=1-fy; }
  const ws = [w1,w2,w3].map(w => Math.pow(w, p)); const vs = [v1,v2,v3]; let acc = 0, sw2 = 0; const mean = 0;
  for (let k = 0; k < 3; k++) { const o = hash(vs[k][0], vs[k][1]); acc += ws[k]*tex(u + o[0], v + o[1]); sw2 += ws[k]*ws[k]; }
  return { val: acc/Math.sqrt(sw2), wmax: Math.max(w1,w2,w3) };
}
for (const p of [1, 4, 8]) {
  const out = new Float32Array(n2), wm = new Float32Array(n2);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const r = hpb((i+0.5)/n, (j+0.5)/n, p); out[j*n+i] = r.val; wm[j*n+i] = r.wmax; }
  // measure "edginess": kurtosis of gradient magnitude, in vertex zone (wmax>0.8) vs blend zone (wmax<0.5), vs original g
  const gradKurt = (A, mask) => { const gm = []; for (let j = 1; j < n-1; j++) for (let i = 1; i < n-1; i++) { if (mask && !mask(j*n+i)) continue; const gx = A[j*n+i+1]-A[j*n+i-1], gy = A[(j+1)*n+i]-A[(j-1)*n+i]; gm.push(Math.hypot(gx, gy)); } let m=0; for (const v of gm) m+=v; m/=gm.length; let s2=0,s4=0; for (const v of gm){const d=v-m; s2+=d*d; s4+=d*d*d*d;} s2/=gm.length; s4/=gm.length; return { kurt: s4/(s2*s2)-3, meanGrad: m, n: gm.length }; };
  const o = gradKurt(g), vz = gradKurt(out, i => wm[i] > 0.8), bz = gradKurt(out, i => wm[i] < 0.5);
  const fracBlend = wm.filter(w => w < 0.5).length/n2;
  console.log(`p=${p}: original grad-kurt ${o.kurt.toFixed(1)} meanGrad ${o.meanGrad.toFixed(3)} | vertex zone (wmax>0.8, ${(wm.filter(w=>w>0.8).length/n2*100).toFixed(0)}% of plane) kurt ${vz.kurt.toFixed(1)} meanGrad ${vz.meanGrad.toFixed(3)} | blend zone (wmax<0.5, ${(fracBlend*100).toFixed(0)}%) kurt ${bz.kurt.toFixed(1)} meanGrad ${bz.meanGrad.toFixed(3)}`);
}
