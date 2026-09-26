/**
 * **흐린 보름밤에 하늘이 새카맣고 땅이 하얗던 것** 판정. `build-night-cloudy.js` 의 짝.
 *
 * 자(재기 전에 정함):
 *  - 밤(18:11 · 23:59): 하늘 평균 밝기 ≥ 25 — 달빛 받은 구름이 보인다(검지 않다).
 *  - 밤: 지면 평균 밝기 ≤ 160 이고 하늘의 1.5배 이하 — 땅이 하얗게 타지 않는다.
 *  - 마쓰모토 관측 고도(운량 15~19%)에서 안개를 켜지 않는다.
 * 대조: 옛 동작(옛 판정 · 옛 달빛 상수)은 위 자에 걸린다 — 자가 이 증상을 본다.
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
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/night-cloudy.html', { timeout: 600000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 600000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const st = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();
  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0 && !/ERR/.test(title), `컴파일·예외 없음 (${title}${errs.length ? ' — ' + errs[0] : ''})`);
  if (!st) { console.log('FAILURES — __stats 없음'); process.exit(1); }
  ok(st.glError === 0, `glGetError == 0 (${st.glError})`);
  const { W, H, out } = st;
  console.log('\n  동작  장면         안개(운량)   하늘 밝기  지면 밝기');
  for (const o of out) console.log(`  ${o.mode.padEnd(4)}  ${o.name.padEnd(10)}  ${o.fog ? '켬(' + o.fogCover + ')' : '끔     '}   ${o.skyL.toFixed(1).padStart(7)}  ${o.groundL.toFixed(1).padStart(7)}`);
  // 접촉 인화: 위 줄 옛 동작, 아래 줄 고친 동작
  const n = out.length / 2, sheet = new PNG({ width: W * n, height: H * 2 });
  out.forEach((o, k) => {
    const ox = (k % n) * W, oy = Math.floor(k / n) * H;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3, q = ((oy + y) * sheet.width + ox + x) * 4; sheet.data[q] = o.img[i]; sheet.data[q + 1] = o.img[i + 1]; sheet.data[q + 2] = o.img[i + 2]; sheet.data[q + 3] = 255; }
  });
  fs.writeFileSync(path.join(PREVIEW, '..', 'night-cloudy-sheet.png'), PNG.sync.write(sheet));

  const nightNew = out.filter(o => o.mode === 'new' && !/16:49/.test(o.name));
  const nightOld = out.filter(o => o.mode === 'old' && !/16:49/.test(o.name));
  const good = (o) => o.skyL >= 25 && o.groundL <= 160 && o.groundL <= 1.5 * o.skyL;
  console.log('\n== 고친 동작 ==');
  for (const o of nightNew) {
    ok(o.skyL >= 25, `${o.name}: 하늘이 검지 않다 (${o.skyL.toFixed(1)} ≥ 25)`);
    ok(o.groundL <= 160 && o.groundL <= 1.5 * o.skyL, `${o.name}: 땅이 하얗게 타지 않는다 (${o.groundL.toFixed(1)} ≤ 160, 하늘의 ${(o.groundL / o.skyL).toFixed(2)}배 ≤ 1.5)`);
  }
  ok(out.filter(o => o.mode === 'new').every(o => !o.fog), '마쓰모토 545m 에서 안개를 켜지 않는다');
  console.log('\n== 대조 (옛 동작은 자에 걸린다) ==');
  ok(nightOld.every(o => !good(o)), `옛 동작의 밤 장면은 모두 자에 걸린다 (${nightOld.map(o => `${o.name} 하늘 ${o.skyL.toFixed(0)}·지면 ${o.groundL.toFixed(0)}`).join(' / ')})`);
  ok(out.filter(o => o.mode === 'old').every(o => o.fog), '옛 판정은 세 장면 모두 안개를 켰다');
  console.log(`\n접촉 인화: .harness/night-cloudy-sheet.png (위 옛 동작 · 아래 고친 동작)`);
  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
