// 구름 밝은 쪽(p90)·어두운 쪽(p10) ÷ 맑은 하늘 중앙값 — 사진과 렌더를 같은 마스크로.
const J = require('/home/user/solar-path/node_modules/jimp-compact'); const fs = require('fs');
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const q = (a, f) => { const s = Float64Array.from(a).sort(); return s[Math.floor(f * (s.length - 1))]; };
async function ratio(file, top) {
  const im = await J.read(file); im.crop(0, 0, im.bitmap.width, Math.floor(im.bitmap.height * top)).resize(320, J.AUTO);
  const d = im.bitmap.data, N = d.length / 4, L = [], nr = [];
  for (let i = 0; i < N; i++) { const r = lin(d[i * 4]), g = lin(d[i * 4 + 1]), b = lin(d[i * 4 + 2]); L.push(0.2126 * r + 0.7152 * g + 0.0722 * b); nr.push((b - r) / Math.max(1e-6, b + r)); }
  const p95 = q(nr, 0.95); if (p95 < 0.15) return null;
  const C = [], S = []; for (let i = 0; i < N; i++) (nr[i] < 0.5 * p95 ? C : S).push(L[i]);
  if (C.length < 300 || S.length < 300) return null;
  let clip = 0, nc = 0; for (let i = 0; i < N; i++) if (nr[i] < 0.5 * p95) { nc++; if (d[i * 4] >= 250 && d[i * 4 + 1] >= 250 && d[i * 4 + 2] >= 250) clip++; }
  const sky = q(S, 0.5); return [q(C, 0.9) / sky, q(C, 0.1) / sky, clip / nc];
}
(async () => {
  if (process.argv[2] === 'photos') {
    const S = JSON.parse(fs.readFileSync('selection.json', 'utf8'));
    const out = {};
    for (const g of ['Cu', 'AcCc', 'Ci', 'StSc']) { const hi = [], lo = [], cl = [];
      for (const [idx, frac] of Object.entries(S[g])) { const r = await ratio(`thumbs/${g}/${String(idx).padStart(3, '0')}.jpg`, Math.min(1, frac) * 0.97); if (r) { hi.push(r[0]); lo.push(r[1]); cl.push(r[2]); } }
      const Q3 = a => [.25, .5, .75].map(f => +q(a, f).toFixed(3));
      out[g] = { n: hi.length, bright: Q3(hi), dark: Q3(lo), clip: Q3(cl) };
      console.log(g, JSON.stringify(out[g])); }
    fs.writeFileSync('photo-display-ruler.json', JSON.stringify(out, null, 1));
  } else for (const f of process.argv.slice(2)) { const r = await ratio(f, 0.78); console.log(f.split('/').pop(), r ? r.map(v => v.toFixed(3)).join(' / ') : '—'); }
})();
