/**
 * **옛 능선 띠를 지워도 되는가** 합격 판정. `build-bands-need.js` 의 짝.
 *
 * ## 답: DEM 이 있으면 사실상 아무것도 안 그립니다
 *
 * 띠만 껐다 켠 두 장의 차이 화소를 셌습니다(세 자리 × 여덟 방위 × 두
 * 내려본각, 지평선 언저리 −3°/+3°). 지형각은 앱과 **같은 식**으로 DEM 에서
 * 직접 냈으므로 띠에 유리한 조건입니다.
 *
 *     내륙(도곡동)   174 화소  0.007%
 *     바닷가(대부도)    0 화소  0%
 *     높은 곳(마니산)   0 화소  0%
 *     DEM 없음     10,846 화소  0.46%
 *
 * 먼 지형 격자(3~55km)가 같은 자리를 훨씬 촘촘히 그리기 때문입니다 — 띠는
 * 방위마다 5·15·40km 딱 세 점만 보고, 격자는 96 고리 × 256 살입니다.
 *
 * ## 그래서 지우지 않고 **끕니다**
 *
 * DEM 이 없을 때는 띠가 유일한 능선 실루엣입니다(0.46%). 게다가 띠의 자료원은
 * DEM 타일(AWS)이 아니라 고도 API 라, 한쪽이 죽어도 다른 쪽은 살아 있을 수
 * 있습니다. 원반에서 배운 것과 같습니다 — 죽은 코드가 아니라 **대비책**이므로
 * 지우는 대신 DEM 이 실리면 끕니다.
 *
 * 사용: node tools/shader-preview/build-bands-need.js
 *       node tools/shader-preview/verify-bands-need.js
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
  const p = await b.newPage({ viewport: { width: 960, height: 760 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/bands-need.html', { timeout: 300000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null,
    { timeout: 300000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0, `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats || !stats.결과) { console.log('\nFAILURES — __stats.결과 가 없습니다.'); process.exit(1); }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);

  const r = stats.결과;
  const 자리 = ['내륙', '바닷가', '높은곳'];
  console.log('\n== 띠가 이기는 화소 (16장 합계) ==');
  for (const k of [...자리, 'DEM 없음']) {
    const v = r[k]; if (!v) continue;
    console.log(`  ${k.padEnd(8)} 띠 ${String(v.띠화소).padStart(7)}`
      + ` · 지면 ${String(v.지면화소).padStart(8)} / ${v.총화소}`
      + ` · ${String(v.비율).padStart(6)}% · 최악 한 장 ${v.최악한장}`);
  }

  console.log('\n== 하네스가 실제로 지면을 그렸는가 ==');
  //
  // ⚠ 이게 먼저입니다. 지면이 안 그려졌으면 "띠가 안 보인다" 는 그냥
  //   하네스 결함입니다 (원반 판정에서 실제로 그렇게 속은 적이 있습니다).
  for (const k of [...자리, 'DEM 없음'])
    ok(r[k] && r[k].지면화소 > 0.3 * r[k].총화소,
      `${k}: 지면이 화면의 30% 넘게 찍혔다 (${r[k] ? r[k].지면화소 : '없음'})`);

  console.log('\n== DEM 이 있으면 띠는 사실상 없는 것과 같다 ==');
  for (const k of 자리)
    ok(r[k].비율 <= 0.02, `${k}: 띠가 화면의 0.02% 이하 (${r[k].비율}%, ${r[k].띠화소}화소)`);
  ok(자리.filter(k => r[k].띠화소 === 0).length >= 2,
    `세 자리 중 둘 이상은 정확히 0 화소`
    + ` (${자리.map(k => k + ' ' + r[k].띠화소).join(' · ')})`);

  console.log('\n== 그래도 DEM 이 없을 때는 남는다 — 그래서 지우지 않고 끕니다 ==');
  const 없음 = r['DEM 없음'];
  const 최대있음 = Math.max(...자리.map(k => r[k].띠화소));
  ok(없음.띠화소 >= 20 * Math.max(1, 최대있음),
    `DEM 없을 때가 있을 때보다 스무 배 넘게 많다 (${없음.띠화소} 대 ${최대있음})`);
  ok(없음.띠화소 > 1000,
    `DEM 없이는 띠가 유일한 능선 실루엣이다 (${없음.띠화소}화소, 최악 한 장 ${없음.최악한장})`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
