// Does fracInt_H(ln eps) keep multifractal intermittency? Compare kurtosis / top-1% area clustering of
// phi_ln = pyr(Gamma)  vs  phi_eps = pyr(exp(Gamma))  on 256^2, H = 0.3, 8 octaves, sigma 0.37.
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = (r) => { const u = Math.max(1e-12, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function octave(S, k, seed, out, sigma) { const r = rng(seed), g = new Float32Array(k * k); for (let i = 0; i < k * k; i++) g[i] = gauss(r);
  for (let y = 0; y < S; y++) { const v = (y + 0.5) / S * k - 0.5; let y0 = Math.floor(v); const fy = v - y0; y0 = ((y0 % k) + k) % k; const y1 = (y0 + 1) % k;
    for (let x = 0; x < S; x++) { const u = (x + 0.5) / S * k - 0.5; let x0 = Math.floor(u); const fx = u - x0; x0 = ((x0 % k) + k) % k; const x1 = (x0 + 1) % k;
      const a = g[y0 * k + x0], b = g[y0 * k + x1], c = g[y1 * k + x0], d = g[y1 * k + x1]; const ab = a + (b - a) * fx; out[y * S + x] += sigma * (ab + (c + (d - c) * fx - ab) * fy); } } }
function blurDown(P, n) { const k = [1/16, 4/16, 6/16, 4/16, 1/16]; const t = new Float32Array(n*n), b = new Float32Array(n*n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let s = 0; for (let i = -2; i <= 2; i++) s += k[i+2] * P[y*n + ((x+i+n)%n)]; t[y*n+x] = s; } for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let s = 0; for (let i = -2; i <= 2; i++) s += k[i+2] * t[((y+i+n)%n)*n + x]; b[y*n+x] = s; } const h = n>>1, D = new Float32Array(h*h); for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) D[y*h+x] = b[(2*y)*n + 2*x]; return { b, D }; }
function up(D, h, n, out, w) { for (let y = 0; y < n; y++) { const v = (y+0.5)/n*h - 0.5; let y0 = Math.floor(v); const fy = v-y0; y0 = ((y0%h)+h)%h; const y1 = (y0+1)%h; for (let x = 0; x < n; x++) { const u = (x+0.5)/n*h - 0.5; let x0 = Math.floor(u); const fx = u-x0; x0 = ((x0%h)+h)%h; const x1 = (x0+1)%h; const a = D[y0*h+x0], b = D[y0*h+x1], c = D[y1*h+x0], d = D[y1*h+x1]; const ab = a+(b-a)*fx; out[y*n+x] += w*(ab + (c+(d-c)*fx-ab)*fy); } } }
function lapPyr(P0, S, H, levels) { const out = new Float32Array(S*S); let P = P0, n = S; for (let l = 0; l < levels; l++) { const { b, D } = blurDown(P, n); const L = new Float32Array(n*n); for (let i = 0; i < n*n; i++) L[i] = P[i]-b[i]; up(L, n, S, out, Math.pow(2, H*l)); P = D; n >>= 1; } up(P, n, S, out, Math.pow(2, H*levels)); return out; }
function stdz(F) { let m = 0; for (const v of F) m += v; m /= F.length; let s = 0; for (const v of F) s += (v-m)**2; s = Math.sqrt(s/F.length); return F.map(v => (v-m)/s); }
function kurt(F) { let s4 = 0; for (const v of F) s4 += v**4; return s4/F.length; }
function skew(F) { let s3 = 0; for (const v of F) s3 += v**3; return s3/F.length; }
// clustering of the top 25% (cover 0.25): largest connected piece fraction (4-conn, periodic ignored)
function largestFrac(F, S, cover) { const s = Float32Array.from(F).sort(); const th = s[Math.floor((1-cover)*(S*S-1))]; const m = new Uint8Array(S*S); let tot = 0; for (let i = 0; i < S*S; i++) if (F[i] > th) { m[i] = 1; tot++; } const seen = new Uint8Array(S*S); let best = 0, n = 0; const st = new Int32Array(S*S); for (let i = 0; i < S*S; i++) { if (!m[i] || seen[i]) continue; let sp = 0, cnt = 0; st[sp++] = i; seen[i] = 1; n++; while (sp) { const j = st[--sp]; cnt++; const x = j % S, y = (j/S)|0; for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const xx = x+dx, yy = y+dy; if (xx<0||yy<0||xx>=S||yy>=S) continue; const q = yy*S+xx; if (m[q] && !seen[q]) { seen[q] = 1; st[sp++] = q; } } } if (cnt > best) best = cnt; } return { largestFrac: (best/tot).toFixed(3), pieces: n }; }
const S = 256;
for (const seed of [11, 23]) {
  const G = new Float32Array(S*S); let s2 = 0; for (let l = 1; l <= 8; l++) { const sg = l === 1 ? 0.185 : 0.37; octave(S, 1<<l, seed+l, G, sg); s2 += sg*sg; }
  const E = G.map(g => Math.exp(g - s2/2));
  const phiLn = stdz(lapPyr(G, S, 0.3, 5)), phiEps = stdz(lapPyr(E, S, 0.3, 5)), phiH0 = stdz(E);
  // Gaussian k^-1.3-ish reference = pyr of white
  const Wn = new Float32Array(S*S); const r = rng(seed*3); for (let i = 0; i < S*S; i++) Wn[i] = gauss(r); const phiG = stdz(lapPyr(Wn, S, 0.3, 5));
  console.log(`seed ${seed}: kurtosis  pyr(lnEps)=${kurt(phiLn).toFixed(2)}  pyr(eps)=${kurt(phiEps).toFixed(2)}  eps(H=0)=${kurt(phiH0).toFixed(2)}  pyr(white)=${kurt(phiG).toFixed(2)}  | skew pyr(eps)=${skew(phiEps).toFixed(2)}`);
  for (const c of [0.25, 0.5]) console.log(`   cover ${c}: pyr(lnEps)`, largestFrac(phiLn, S, c), ' pyr(eps)', largestFrac(phiEps, S, c), ' eps H=0', largestFrac(phiH0, S, c));
}
