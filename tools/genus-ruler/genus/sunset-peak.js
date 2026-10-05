// §122.2 '가장 붉은 곳의 색' — 땅선 위, 선형 휘도 > 0.08, 세 채널 < 250 인 화소 중 R/B 상위 20% 의 G/R·B/R 중앙값(표시값).
//   node sunset-peak.js <땅선 비율(위에서)> f1.png f2.png …   → 파일마다 G/R B/R, 끝에 전체 중앙값
const J = require('/home/user/solar-path/node_modules/jimp-compact');
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const med = a => { const s = Float64Array.from(a).sort(); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
async function peak(file, ground) {
  const im = await J.read(file); const { width: W, height: H, data: d } = im.bitmap; const yMax = Math.floor(H * ground);
  const px = [];
  for (let y = 0; y < yMax; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
    if (r >= 250 || g >= 250 || b >= 250) continue;
    if (0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) <= 0.08) continue;
    px.push([r / Math.max(1, b), g / Math.max(1, r), b / Math.max(1, r)]);
  }
  if (px.length < 20) return null;
  px.sort((a, b) => b[0] - a[0]);
  const top = px.slice(0, Math.max(1, Math.floor(px.length * 0.2)));
  return { gr: med(top.map(p => p[1])), br: med(top.map(p => p[2])), n: px.length };
}
module.exports = { peak };
if (require.main === module) (async () => {
  const ground = +process.argv[2]; const gr = [], br = [];
  for (const f of process.argv.slice(3)) { const r = await peak(f, ground); console.log(f.split('/').pop(), r ? `G/R ${r.gr.toFixed(3)} B/R ${r.br.toFixed(3)} n ${r.n}` : '—'); if (r) { gr.push(r.gr); br.push(r.br); } }
  console.log(`median G/R ${med(gr).toFixed(3)} B/R ${med(br).toFixed(3)}`);
})();
