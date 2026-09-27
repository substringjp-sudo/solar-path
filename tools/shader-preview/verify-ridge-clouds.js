/**
 * **구름이 산을 덮는가** 판정 (§116). `build-ridge-clouds.js` 의 짝.
 *
 * 산 화소 = 구름 없는 그림에서 지형을 켰다 끈 차가 6 넘는 화소. 열마다 맨 위 산 화소가 산등성이.
 * 열마다 그 방위의 산등성이(DEM 으로 구한 가장 높이 보이는 지점)가 구름 밑면보다 60m 넘게 높으면 "위",
 * 60m 넘게 낮으면 "아래", 그 사이는 빼고 셉니다.
 *
 * ⚠ 처음 자(시선 255.5° 하나, "산등성이는 밑면보다 높다" 전제)는 틀린 전제였습니다 — DEM 으로 재 보니 그
 *   방위의 가까운 산등성이는 1.0~1.1km 로 밑면 1.06km 와 거의 같았습니다(새 코드 0.085 로 FAIL). 문턱은
 *   그대로 두고, 전제를 DEM 으로 열마다 가르게 바꾸고 산이 확실히 높은 시선 둘(330°·45°)을 더했습니다.
 *
 * 자. "구름 없음 대비 한 채널이라도 8 넘게 바뀐 화소" 비율:
 *  - 밑면보다 높은 산등성이 띠(산등성이에서 아래로 6화소): 새 코드 ≥ 0.6 — 구름에 덮인다.
 *  - 대조: 같은 띠에서 옛 동작은 ≤ 0.1 — 산이 구름 앞으로 나왔다.
 *  - 밑면보다 낮은 산등성이 띠: 새 코드 ≤ 0.2 — 구름 밑의 산은 보인다.
 *  - 산기슭 띠(시선 고도 0~0.8°): 새 코드 ≤ 0.2.
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN, PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  await p.goto(ORIGIN + '/ridge-clouds.html' + (process.env.RIDGE_SOFT ? '?soft=' + process.env.RIDGE_SOFT : ''), { timeout: 600000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 600000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const st = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();
  ok(!/ERR/.test(title) && st, `컴파일·예외 없음 (${title}${errs.length ? ' — ' + errs[0] : ''})`);
  if (!st) { console.log('FAILURES'); process.exit(1); }
  const { W, H, FOVY, VIEW_EL, views } = st;
  const D2R = Math.PI / 180, tanV = Math.tan(FOVY * D2R / 2), tanH = tanV * W / H;
  const cfg = JSON.parse(fs.readFileSync(path.join(PREVIEW, 'ridge-clouds.json'), 'utf8'));
  const { makeCpuDem } = require('./dem-cpu');
  const dem = makeCpuDem({ demDir: path.join(PREVIEW, cfg.DIR), zoom: cfg.zoomFar, lat: cfg.LAT, lon: cfg.LON });
  const ridgeH = (az) => { let best = { a: -9, h: 0 };
    for (let d = 200; d < 50000; d += 100) { const h = dem.elevAtGround(d * Math.sin(az * D2R), -d * Math.cos(az * D2R)); if (h == null) continue;
      const a = Math.atan2(h - cfg.eyeM - d * d / 12742000, d); if (a > best.a) best = { a, h }; } return best.h; };
  const baseM = cfg.baseKm * 1000;
  const px = (a, i) => [a[i * 4], a[i * 4 + 1], a[i * 4 + 2]];
  const dmax = (a, c, i) => { const x = px(a, i), y = px(c, i); return Math.max(Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]), Math.abs(x[2] - y[2])); };
  const acc = { up: { n: 0, nw: 0, od: 0 }, dn: { n: 0, nw: 0 }, foot: { n: 0, nw: 0 } };
  for (const { az, out } of views) {
    const isT = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) isT[i] = dmax(out.none, out.noterrain, i) > 6 ? 1 : 0;
    const ch = (i, m) => dmax(out[m], out.none, i) > 8;
    let colsUp = 0, colsDn = 0;
    for (let x = 0; x < W; x++) {
      let top = -1;
      for (let y = H - 1; y >= 0; y--) if (isT[y * W + x]) { top = y; break; }
      if (top < 0) continue;
      const colAz = az + Math.atan(tanH * ((2 * (x + 0.5) / W) - 1)) / D2R;
      const h = ridgeH(colAz);
      const cls = h > baseM + 60 ? 'up' : (h < baseM - 60 ? 'dn' : null);
      if (cls === 'up') colsUp++; else if (cls === 'dn') colsDn++;
      for (let y = top; y > top - 6 && y >= 0; y--) { const i = y * W + x; if (!isT[i] || !cls) continue;
        acc[cls].n++; if (ch(i, 'new')) acc[cls].nw++; if (cls === 'up' && ch(i, 'old')) acc.up.od++; }
      for (let y = 0; y < top - 6; y++) { const i = y * W + x;
        const elev = Math.atan(tanV * ((2 * (y + 0.5) / H) - 1)) / D2R + VIEW_EL;
        if (elev >= 0 && elev <= 0.8 && isT[i]) { acc.foot.n++; if (ch(i, 'new')) acc.foot.nw++; } }
    }
    console.log(`  시선 ${az}°: 산등성이 위 ${colsUp}열 · 아래 ${colsDn}열 · uRidgeClouds ${out.flagNew}`);
  }
  const r = (a, b) => b ? a / b : NaN;
  const upNew = r(acc.up.nw, acc.up.n), upOld = r(acc.up.od, acc.up.n), dnNew = r(acc.dn.nw, acc.dn.n), ftNew = r(acc.foot.nw, acc.foot.n);
  console.log(`\n  바뀐 비율                        새      옛\n  밑면보다 높은 산등성이 (${acc.up.n})  ${upNew.toFixed(3)}  ${upOld.toFixed(3)}\n  밑면보다 낮은 산등성이 (${acc.dn.n})  ${dnNew.toFixed(3)}\n  산기슭 (${acc.foot.n})                 ${ftNew.toFixed(3)}\n`);
  ok(acc.up.n > 100 && acc.dn.n > 50 && acc.foot.n > 50, `자가 잴 화소가 있다 (위 ${acc.up.n} · 아래 ${acc.dn.n} · 산기슭 ${acc.foot.n})`);
  ok(upNew >= 0.6, `밑면보다 높은 산등성이는 구름에 덮인다 (${upNew.toFixed(3)} ≥ 0.6)`);
  ok(upOld <= 0.1, `대조: 옛 동작은 산이 구름 앞으로 나온다 (${upOld.toFixed(3)} ≤ 0.1)`);
  ok(dnNew <= 0.2, `밑면보다 낮은 산등성이는 보인다 (${dnNew.toFixed(3)} ≤ 0.2)`);
  ok(ftNew <= 0.2, `산기슭은 보인다 (${ftNew.toFixed(3)} ≤ 0.2)`);

  const sheet = new PNG({ width: W * 3 + 12, height: H * views.length + 6 * (views.length - 1) }); sheet.data.fill(255);
  views.forEach(({ out }, v) => ['none', 'old', 'new'].forEach((k, n) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = ((H - 1 - y) * W + x) * 4, q = ((v * (H + 6) + y) * sheet.width + n * (W + 6) + x) * 4;
    for (let c = 0; c < 3; c++) sheet.data[q + c] = out[k][s + c]; sheet.data[q + 3] = 255; } }));
  fs.writeFileSync(path.join(PREVIEW, '..', 'ridge-clouds-sheet.png'), PNG.sync.write(sheet));
  console.log('\n접촉 인화: .harness/ridge-clouds-sheet.png (줄마다 시선 255.5° · 330° · 45°, 왼쪽 구름 없음 · 가운데 옛 동작 · 오른쪽 새 코드)');
  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
