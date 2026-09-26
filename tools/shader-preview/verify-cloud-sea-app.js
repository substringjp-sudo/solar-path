/**
 * **운해가 앱 화면에서 보이는가** 합격 판정 (§96). `build-cloud-sea-app.js` 의 짝.
 *
 * ## 자
 *
 * 슬랩만 그렸을 때 운해가 있어야 할 지평선 아래 화소(슬랩의 DEM 가림이 가까운 사면은 이미
 * 뺌) 중, 앱과 같은 합성 화면에서 구름을 껐다 켜면 바뀌는 비율 — 두 경로 모두 0.9 이상.
 *
 * 고치기 전 저해상도 경로는 산을 구름 **뒤에** 그려 이 비율이 거의 0 이었습니다(운해가 지형
 * 격자에 통째로 덮임). 한 번에 그리는 경로는 구름이 산 위라 멀쩡했습니다.
 *
 * ## 대조
 *
 * - 보여야 할 운해 화소가 충분하다(각 경로 2,000 이상) — 자가 운해를 본다.
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
  await p.goto(ORIGIN + '/cloud-sea-app.html', { timeout: 600000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 600000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const st = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0 && !/ERR/.test(title), `컴파일·예외 없음 (${title}${errs.length ? ' — ' + errs[0] : ''})`);
  if (!st) { console.log('FAILURES — __stats 없음'); process.exit(1); }
  ok(st.glError === 0, `glGetError == 0 (${st.glError})`);
  console.log(`  두 번에 나눠 그리기: ${st.R.split ? '켬' : '없음(옛 코드)'}`);

  for (const k of ['배율2', '배율1']) {
    const r = st.R[k];
    console.log(`\n== ${k === '배율2' ? '저해상도 경로(배율 2)' : '한 번에 그리는 경로(배율 1)'} ==`);
    ok(r.보여야할 >= 2000, `보여야 할 운해 화소가 충분하다 (${r.보여야할})`);
    const f = r.보여야할 ? r.보임 / r.보여야할 : 0;
    ok(f >= 0.9, `운해가 보인다 (${r.보임}/${r.보여야할} = ${(f * 100).toFixed(1)}%)`);
  }

  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
