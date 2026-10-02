/**
 * **해에서 멀어질수록 하늘 채도가 어떻게 변하는가 — 사진에서** (2026-10-02). 렌더 쪽 짝은
 * `tools/shader-preview/build-sun-angle-sat.js` · `verify-sun-angle-sat.js`.
 *
 * 참고 사진(`.harness/photoref`, EXIF 35mm 환산 초점거리로 화각을 아는 130장) 가운데 **해가 화면에 찍힌**
 * 사진만 씁니다. 해 후보 = 세 채널이 모두 248 이상인 화소의 가장 큰 연결 덩어리(작고 둥근 것). 하얗게
 * 날아간 구름도 같은 조건에 걸려, 후보 19장을 눈으로 보고 해가 확실한 6장만 남겼습니다(아래 PICK —
 * 같은 장면 두 장 중 한 장, 구름 가장자리인지 모를 한 장은 뺐습니다).
 *
 * 화소마다 해와의 각: 핀홀 · 긴 변의 화각 = EXIF 화각. 각 구간마다 HSV 채도의 중앙값. 날아간 화소(세 채널
 * ≥ 245)·너무 어두운 화소(최대 < 25)는 뺍니다. 땅: 'sky' 는 사진 manifest 의 하늘 비율 위만, 'above' 는
 * 해보다 위만(해가 지평선에 걸린 노을).
 *
 * 사용: node tools/photo-ref/measure-sun-angle.js   → .harness/photoref/sun-angle.json
 */
const fs = require('fs');
const path = require('path');
const jpeg = require(path.join(__dirname, '../qr-report/node_modules/jpeg-js'));

const DIR = path.join(__dirname, '../../.harness/photoref');
const PICK = { 'c027.jpg': 'sky', 'c042.jpg': 'sky', 'c044.jpg': 'sky', 'c071.jpg': 'above', 'c100.jpg': 'above', 'c170.jpg': 'sky' };
const BINS = [[3, 8], [8, 14], [14, 20], [20, 28], [28, 36], [36, 46]];
const meta = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(DIR, 'screened.json'), 'utf8')).map(x => [x.file, x]));

function findSun(d, W, H) {
  const k = Math.max(1, Math.round(Math.max(W, H) / 400)), w = Math.floor(W / k), h = Math.floor(H / k);
  const hot = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let mn = 255; for (let yy = 0; yy < k; yy++) for (let xx = 0; xx < k; xx++) { const i = ((y * k + yy) * W + x * k + xx) * 4; mn = Math.min(mn, d[i], d[i + 1], d[i + 2]); }
    hot[y * w + x] = mn >= 248 ? 1 : 0;
  }
  const lab = new Int32Array(w * h).fill(-1); let best = null;
  for (let i = 0; i < w * h; i++) if (hot[i] && lab[i] < 0) {
    const st = [i]; lab[i] = 1; let n = 0, sx = 0, sy = 0;
    while (st.length) { const q = st.pop(), x = q % w, y = (q / w) | 0; n++; sx += x; sy += y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const qq = Y * w + X; if (hot[qq] && lab[qq] < 0) { lab[qq] = 1; st.push(qq); } } }
    if (!best || n > best.n) best = { n, x: (sx / n + 0.5) * k, y: (sy / n + 0.5) * k };
  }
  return best;
}

const res = {};
for (const [f, mode] of Object.entries(PICK)) {
  const m = meta[f];
  const img = jpeg.decode(fs.readFileSync(path.join(DIR, 'raw', f)), { useTArray: true, maxMemoryUsageInMB: 1024 });
  const W = img.width, H = img.height, sun = findSun(img.data, W, H);
  const fpx = (Math.max(W, H) / 2) / Math.tan(m.fovDeg / 2 * Math.PI / 180);
  const dir = (x, y) => { const v = [x - W / 2, y - H / 2, fpx]; const n = Math.hypot(...v); return v.map(c => c / n); };
  const ds = dir(sun.x, sun.y), step = Math.max(1, Math.round(Math.max(W, H) / 600));
  const acc = BINS.map(() => []);
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
    if (mode === 'sky' && y > m.sky * H) continue;
    if (mode === 'above' && y > sun.y - 0.02 * H) continue;
    const i = (y * W + x) * 4, r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    if (Math.min(r, g, b) >= 245 || Math.max(r, g, b) < 25) continue;
    const dd = dir(x, y), ang = Math.acos(Math.min(1, dd[0] * ds[0] + dd[1] * ds[1] + dd[2] * ds[2])) * 180 / Math.PI;
    const bi = BINS.findIndex(([a, c]) => ang >= a && ang < c); if (bi < 0) continue;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); acc[bi].push(mx > 0 ? (mx - mn) / mx : 0);
  }
  const med = a => { if (a.length < 200) return null; const s = [...a].sort((p, q) => p - q); return +s[Math.floor(s.length / 2)].toFixed(3); };
  res[f] = { tag: m.tag, title: m.title, fovDeg: m.fovDeg, sun: { x: +(sun.x / W).toFixed(3), y: +(sun.y / H).toFixed(3) }, prof: acc.map(med) };
  console.log(f, m.tag.padEnd(12), res[f].prof.map(v => v == null ? '  —  ' : v.toFixed(3)).join('  '));
}
fs.writeFileSync(path.join(DIR, 'sun-angle.json'), JSON.stringify({ bins: BINS, photos: res }, null, 1));
console.log('→ .harness/photoref/sun-angle.json');
