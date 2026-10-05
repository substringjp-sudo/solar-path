// §127 노출 자 — 맑은 하늘(구름 아닌 푸른 화소) 휘도의 중앙값. 사진과 렌더를 **같은 함수**로 잽니다.
// 마스크는 skyratio.js 와 같음: 정규화 청색도 nr = (B−R)/(B+R) 의 95분위가 0.15 이상인 그림에서 nr ≥ 0.5·p95 인 화소.
//   node exposure-ruler.js photos            → photo-exposure-ruler.json (사진 385장, .harness/genus/…)
//   node exposure-ruler.js render top f1 f2… → 파일마다 하늘 중앙 휘도(선형)·표시값 (top = 위에서 잴 비율)
const J = require('/home/user/solar-path/node_modules/jimp-compact'); const fs = require('fs'); const path = require('path');
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const enc = l => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
const q = (a, f) => { const s = Float64Array.from(a).sort(); return s[Math.floor(f * (s.length - 1))]; };
async function skyMedian(file, top) {
  const im = await J.read(file); im.crop(0, 0, im.bitmap.width, Math.max(1, Math.floor(im.bitmap.height * top))).resize(320, J.AUTO);
  const d = im.bitmap.data, N = d.length / 4, L = [], nr = [];
  for (let i = 0; i < N; i++) { const r = lin(d[i * 4]), g = lin(d[i * 4 + 1]), b = lin(d[i * 4 + 2]); L.push(0.2126 * r + 0.7152 * g + 0.0722 * b); nr.push((b - r) / Math.max(1e-6, b + r)); }
  const p95 = q(nr, 0.95); if (p95 < 0.15) return null;
  const S = []; for (let i = 0; i < N; i++) if (nr[i] >= 0.5 * p95) S.push(L[i]);
  if (S.length < 300) return null;
  const m = q(S, 0.5); return { L: m, V: enc(m), n: S.length };
}
module.exports = { skyMedian };
if (require.main === module) (async () => {
  if (process.argv[2] === 'photos') {
    const R = '/home/user/solar-path/tools/genus-ruler', H = '/home/user/solar-path/.harness/genus';
    const sets = [['genus', 'genus/selection.json'], ['genus2', 'genus2/selection2.json']];
    const all = [], per = {};
    for (const [name, sel] of sets) {
      const S = JSON.parse(fs.readFileSync(path.join(R, sel), 'utf8'));
      for (const [g, m] of Object.entries(S)) for (const [idx, frac] of Object.entries(m)) {
        const f = path.join(H, name, 'thumbs', g, String(idx).padStart(3, '0') + '.jpg');
        if (!fs.existsSync(f)) continue;
        const r = await skyMedian(f, Math.min(1, frac) * 0.97); if (!r) continue;
        all.push(r.L); (per[g] = per[g] || []).push(r.L);
      }
    }
    const Q3 = a => [.25, .5, .75].map(f => +q(a, f).toFixed(4));
    const out = { n: all.length, L: Q3(all), V: Q3(all).map(l => +enc(l).toFixed(1)), perGenus: Object.fromEntries(Object.entries(per).map(([g, a]) => [g, { n: a.length, L: Q3(a) }])) };
    console.log(JSON.stringify(out, null, 1));
    fs.writeFileSync(path.join(__dirname, 'photo-exposure-ruler.json'), JSON.stringify(out, null, 1));
  } else if (process.argv[2] === 'render') {
    const top = +process.argv[3];
    for (const f of process.argv.slice(4)) { const r = await skyMedian(f, top); console.log(path.basename(f), r ? `L ${r.L.toFixed(4)} V ${r.V.toFixed(1)} n ${r.n}` : '—'); }
  }
})();
