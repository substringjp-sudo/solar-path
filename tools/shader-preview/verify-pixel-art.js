/**
 * **도트 모드** 합격 판정 (§97). `build-pixel-art.js` 의 짝.
 *
 * - 내부 크기가 세로 64줄(가로는 화면비대로)이다.
 * - 화면이 4×4 네모 덩어리로만 되어 있다 — 덩어리 안의 모든 화소가 같은 색(최근접 확대).
 * - 같은 그림이다 — 같은 장면을 64×64 캔버스에 그린 것과 덩어리마다 같은 색(2 안).
 * - 다시 끄면 처음과 바이트 단위로 같다(도트 모드가 흔적을 남기지 않음).
 * - 대조: 도트를 끈 화면은 4×4 덩어리가 **아니다**(자가 헛돌지 않음).
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage();
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/pixel-art.html', { timeout: 600000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 600000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const st = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0 && !/ERR/.test(title), `컴파일·예외 없음 (${title}${errs.length ? ' — ' + errs[0] : ''})`);
  if (!st) { console.log('FAILURES — __stats 없음'); process.exit(1); }
  ok(st.glError === 0, `glGetError == 0 (${st.glError})`);

  const { W, H, ROWS, R } = st;
  const k = H / ROWS;
  console.log('\n== 도트 ==');
  ok(R.size.height === ROWS && R.size.width === Math.round(W * ROWS / H), `내부 크기 ${R.size.width}×${R.size.height}`);
  ok(R.sizeOff.width === W && R.sizeOff.height === H, `끄면 화면 크기로 돌아온다 (${R.sizeOff.width}×${R.sizeOff.height})`);
  const blocky = (img) => {
    let bad = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const bx = Math.floor(x / k) * k, by = Math.floor(y / k) * k;
      const i = (y * W + x) * 4, j = (by * W + bx) * 4;
      if (img[i] !== img[j] || img[i + 1] !== img[j + 1] || img[i + 2] !== img[j + 2]) bad++;
    }
    return bad;
  };
  const badPix = blocky(R.pix), badOff = blocky(R.off1);
  ok(badPix === 0, `도트 화면은 ${k}×${k} 덩어리로만 되어 있다 (어긋난 화소 ${badPix})`);
  ok(badOff > W * H * 0.2, `대조: 도트를 끈 화면은 덩어리가 아니다 (어긋난 화소 ${badOff})`);
  // ⚠ 처음엔 "평균 색이 채널마다 3 안" 이었는데 4.3 으로 걸렸습니다. 구름·해·블룸을 다 끄고 하늘만
  //   그려도 같은 4 가 나옵니다 — 64줄로 표본하면 해 옆 지평선의 밝고 가파른 경사를 거칠게 집습니다.
  //   도트가 **다르게** 그리는 게 아니라 **거칠게** 그리는 것이라, 덩어리마다 견줘 같은 그림인지 봅니다.
  const mean = (img) => { const m = [0, 0, 0]; for (let i = 0; i < img.length; i += 4) for (let c = 0; c < 3; c++) m[c] += img[i + c]; return m.map(v => v / (W * H)); };
  const a = mean(R.off1), c = mean(R.pix);
  console.log(`  평균 색 끔 ${a.map(v => v.toFixed(1)).join(',')} · 도트 ${c.map(v => v.toFixed(1)).join(',')}`);
  const lum = (img, i) => 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2];
  const X = [], Y = [];
  for (let by = 0; by < H; by += k) for (let bx = 0; bx < W; bx += k) {
    let s = 0;
    for (let y = by; y < by + k; y++) for (let x = bx; x < bx + k; x++) s += lum(R.off1, (y * W + x) * 4);
    X.push(s / (k * k)); Y.push(lum(R.pix, (by * W + bx) * 4));
  }
  const mx = X.reduce((p, v) => p + v, 0) / X.length, my = Y.reduce((p, v) => p + v, 0) / Y.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < X.length; i++) { sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) ** 2; syy += (Y[i] - my) ** 2; }
  const corr = sxy / Math.sqrt(sxx * syy);
  // ⚠ 상관 0.95 는 재기 전에 정한 문턱이었고 0.914 로 걸렸습니다. 원해상도를 덩어리로 평균 낸
  //   그림과 **작게 그린** 그림은 원래 다릅니다(구름 잔무늬를 화소 크기에 맞춰 뭉개는 방식). 그래서
  //   도트 모드가 약속하는 것 — "64×64 에 그린 것을 네모로 키운 것" — 을 직접 잽니다. 상관은 찍기만.
  console.log(`  참고: 원해상도 덩어리 평균과의 휘도 상관 ${corr.toFixed(3)}`);
  const cw = W * ROWS / H;
  let mism = 0, maxd = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < cw; x++) {
    const i = (y * cw + x) * 4, j = ((y * k) * W + x * k) * 4;
    const dd = Math.max(Math.abs(R.ref64[i] - R.pix[j]), Math.abs(R.ref64[i + 1] - R.pix[j + 1]), Math.abs(R.ref64[i + 2] - R.pix[j + 2]));
    maxd = Math.max(maxd, dd); if (dd > 2) mism++;
  }
  ok(mism === 0, `64×64 캔버스에 그린 것과 같다 (2 넘게 다른 칸 ${mism}/${cw * ROWS}, 최대 차 ${maxd})`);
  let d = 0; for (let i = 0; i < R.off1.length; i++) if (R.off1[i] !== R.off2[i]) d++;
  ok(d === 0, `다시 끄면 처음과 바이트 단위로 같다 (다른 바이트 ${d})`);

  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
