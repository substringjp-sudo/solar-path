/**
 * **천정 꽃잎 — 폰 GPU 식 asin 에 흔들리지 않는가** 판정 (§114). `build-gpu-asin.js` 의 짝.
 *
 * 자(재기 전에 정함): 같은 장면을 정확한 asin 과 폰 GPU 식 asin 으로 그린 두 화면의 평균 절대차(0~255).
 *  - 새 식: ≤ 0.5 — asin 이 부정확해도 그림이 안 바뀐다.
 *  - 대조: 옛 식은 ≥ 3 — 자가 결함(꽃잎)을 본다.
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
  await p.goto(ORIGIN + '/gpu-asin.html', { timeout: 600000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 600000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const st = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();
  ok(!/ERR/.test(title) && st, `컴파일·예외 없음 (${title}${errs.length ? ' — ' + errs[0] : ''})`);
  if (!st) { console.log('FAILURES'); process.exit(1); }
  const S = Object.fromEntries(st.shots.map(s => [s.key, s.px]));
  const mad = (a, b) => { let t = 0, n = 0; for (let i = 0; i < a.length; i += 4) { t += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3; } return t / n; };
  const dNew = mad(S.newExact, S.newGpu), dOld = mad(S.oldExact, S.oldGpu);
  ok(dNew <= 0.5, `새 식: GPU 식 asin 이어도 그림이 같다 (평균 절대차 ${dNew.toFixed(3)} ≤ 0.5)`);
  ok(dOld >= 3, `대조: 옛 식은 GPU 식 asin 에서 꽃잎이 난다 (평균 절대차 ${dOld.toFixed(3)} ≥ 3)`);
  const { TW, TH } = st, sheet = new PNG({ width: TW * 2 + 6, height: TH * 2 + 6 }); sheet.data.fill(255);
  ['oldExact', 'oldGpu', 'newExact', 'newGpu'].forEach((k, n) => { const ox = (n % 2) * (TW + 6), oy = Math.floor(n / 2) * (TH + 6), px = S[k];
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) { const s = ((TH - 1 - y) * TW + x) * 4, q = ((oy + y) * sheet.width + ox + x) * 4; for (let c = 0; c < 3; c++) sheet.data[q + c] = px[s + c]; sheet.data[q + 3] = 255; } });
  fs.writeFileSync(path.join(PREVIEW, '..', 'gpu-asin-sheet.png'), PNG.sync.write(sheet));
  console.log('\n접촉 인화: .harness/gpu-asin-sheet.png (위 옛 식 · 아래 새 식, 왼쪽 정확한 asin · 오른쪽 GPU 식)');
  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
