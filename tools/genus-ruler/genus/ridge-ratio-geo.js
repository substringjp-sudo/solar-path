/**
 * 해 쪽 능선 아래 ÷ 위 화면 밝기 비 — 능선 줄을 **DEM 으로** 찾습니다(§128, RULER-terrain-lit.md T3).
 * verify-ridge-silhouette 와 같은 정의: 카메라 방위 265° · 시선 0° · 세로 시야 24°, 능선 아래 3~8줄(땅) ÷ 위 3~8줄(하늘),
 * 표시값(8비트) 휘도, 하늘 쪽이 20 미만인 열은 뺌. 능선 줄은 줌 12 DEM 의 참 능선(곡률 낙차, 눈높이 1.6m)을 화면 줄로 옮긴 뒤
 * ±6줄 안에서 밝기가 가장 크게 바뀌는 경계로 다듬습니다(능선이 하늘보다 어둡든 밝든 같은 자리를 잡음).
 *
 *   node tools/genus-ruler/genus/ridge-ratio-geo.js 그림.png [W H]   (web-repro 화면 그림, 기본 390×600)
 */
const path = require('path');
const J = require('/home/user/solar-path/node_modules/jimp-compact');
const D = require('../../shader-preview/dem-cpu');
const { PREVIEW } = require('../../shader-preview/paths');

const LAT = 36.0209, LON = 136.2894, SUN_AZ = 265, EYE_M = 1.6, FOV = 24, R_EARTH = 6371000;
function trueSkyline() {
  const ref = D.makeCpuDem({ demDir: path.join(PREVIEW, 'ref12-fukui'), zoom: 12, lat: LAT, lon: LON });
  const near = D.makeCpuDem({ demDir: path.join(PREVIEW, 'dem-fukui'), zoom: D.demZoomForRadius(3000, LAT, 3), lat: LAT, lon: LON });
  const h0 = near.elevAtGround(0, 0) + EYE_M;
  return (azDeg) => {
    const a = azDeg * Math.PI / 180;
    let best = -90;
    for (let d = 200; d <= 45000; d += 30) {
      const h = ref.elevAtGround(Math.sin(a) * d, -Math.cos(a) * d);
      if (h === null) break;
      best = Math.max(best, Math.atan2(h - h0 - d * d / (2 * R_EARTH), d) * 180 / Math.PI);
    }
    return best;
  };
}
(async () => {
  const [file, Ws = '390', Hs = '600'] = process.argv.slice(2);
  const im = await J.read(file); const { width: W, height: H, data } = im.bitmap;
  const lum = (x, y) => { const o = (y * W + x) * 4; return 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]; };
  const sky = trueSkyline(), tv = Math.tan(FOV * Math.PI / 360), th = tv * W / H;
  const rs = [], rowsCpu = [], rowsUsed = [];
  for (let x = 6; x < W - 6; x++) {
    const u = ((x + 0.5) / W) * 2 - 1, dAz = Math.atan(u * th);
    const e = sky(SUN_AZ + dAz * 180 / Math.PI);
    const v = Math.tan(e * Math.PI / 180) / (Math.cos(dAz) * tv);
    const r0 = Math.round((1 - v) / 2 * H);
    if (r0 < 20 || r0 > H - 20) continue;
    // ±6줄에서 3줄 평균 위·아래 차가 가장 큰 경계.
    let best = r0, bd = -1;
    for (let r = r0 - 6; r <= r0 + 6; r++) {
      let a = 0, b = 0; for (let k = 1; k <= 3; k++) { a += lum(x, r - k); b += lum(x, r + k - 1); }
      const dd = Math.abs(a - b); if (dd > bd) { bd = dd; best = r; }
    }
    let s = 0, t = 0; for (let k = 3; k <= 8; k++) { s += lum(x, best - k); t += lum(x, best + k); }
    s /= 6; t /= 6; if (s < 20) continue;
    rs.push(t / s); rowsCpu.push(r0); rowsUsed.push(best - r0);
  }
  rs.sort((a, b) => a - b); rowsUsed.sort((a, b) => a - b);
  const q = (a, p) => a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(3) : null;
  console.log(path.basename(file), JSON.stringify({ 열: rs.length, 중앙: q(rs, 0.5), 하위25: q(rs, 0.25), 상위75: q(rs, 0.75), 상위90: q(rs, 0.9), 경계_참능선차_중앙: q(rowsUsed, 0.5) }));
})();
