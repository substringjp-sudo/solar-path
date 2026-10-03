// 사진 지표가 구름 종류를 가르는지(신호가 있는지) — 한 장씩 빼고 가장 가까운 종류 중앙값으로 분류.
const D = require('./photo-genus-metrics.json');
const keys = (process.argv[2] || 'cloudFrac,shadeRange,coarseFrac,coherence,edgeSharp,baseTop').split(',');
const G = Object.keys(D);
const med = a => { a = a.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : NaN; };
const iqr = a => { a = a.filter(Number.isFinite).sort((x, y) => x - y); return a[Math.floor(.75 * (a.length - 1))] - a[Math.floor(.25 * (a.length - 1))]; };
const all = G.flatMap(g => D[g]);
const sc = Object.fromEntries(keys.map(k => [k, iqr(all.map(r => r[k])) || 1]));
const conf = Object.fromEntries(G.map(g => [g, Object.fromEntries(G.map(h => [h, 0]))]));
for (const g of G) D[g].forEach((r, i) => {
  const cent = Object.fromEntries(G.map(h => [h, Object.fromEntries(keys.map(k => [k, med(D[h].filter((_, j) => !(h === g && j === i)).map(x => x[k]))]))]));
  let best = null, bd = 1e9;
  for (const h of G) { let d = 0, n = 0; for (const k of keys) { if (!Number.isFinite(r[k])) continue; d += ((r[k] - cent[h][k]) / sc[k]) ** 2; n++; } d /= Math.max(1, n); if (d < bd) { bd = d; best = h; } }
  conf[g][best]++;
});
let ok = 0, tot = 0; for (const g of G) { ok += conf[g][g]; tot += D[g].length; }
console.log('keys', keys.join(','), 'LOO 정확도', (ok / tot).toFixed(2), '(우연 ≈ 0.25)'); console.table(conf);
