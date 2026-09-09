/**
 * **옛 지면 원반을 지워도 되는가** 합격 판정. `build-disc-need.js` 의 짝.
 *
 * 물음: "일단 옛 원반은 없애도 되지 않을까?"
 *
 * ## 답: 평소엔 거의 안 보이지만, 지우면 안 됩니다
 *
 * DEM 이 실린 세 자리에서 원반이 이기는 화소는 전체의 1% 아래입니다
 * (내륙 0.02% · 바닷가 0.05% · 높은곳 0.81%). 화면을 만드는 것은 이제
 * 근거리 지형 · 먼 지형 · 해수면입니다.
 *
 * 그런데 **DEM 이 없으면 원반이 지면의 70%** 입니다. 타일을 받기 전, 못
 * 받았을 때, 자료가 없는 자리 — 그때 원반이 유일한 지면입니다. 그러니
 * 원반은 "죽은 코드"가 아니라 **대비책**이고, 지우는 대신 그 자리에
 * 못 박아 두는 것이 맞습니다.
 *
 * ⚠ 예전 `verify-handoff.js` 는 **하늘 구멍**만 봤고 원반을 통째로 빼도
 * 구멍이 0 이었습니다 — 그 자로는 이 물음에 답할 수 없습니다. 여기서는
 * 원반을 껐다 켠 두 장의 차이 화소를 직접 셉니다.
 *
 * ⚠ 하네스가 스스로를 속인 적이 있습니다: 카메라를 원반과 같은 높이(y=0)에
 * 뒀더니 원반이 모로 서서 한 화소도 안 잡혔고, "원반이 안 보인다"가 그냥
 * 결함이었습니다. 그래서 아래 **지면 화소 > 0** 단언을 먼저 겁니다.
 *
 * 사용: node tools/shader-preview/build-disc-need.js
 *       node tools/shader-preview/verify-disc-need.js
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
  await p.goto(ORIGIN + '/disc-need.html', { timeout: 300000 });
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
  const 없음 = r['DEM 없음'];

  console.log('\n== 원반이 이기는 화소 (16장 합계) ==');
  for (const k of [...자리, 'DEM 없음']) {
    const v = r[k];
    if (!v) continue;
    console.log(`  ${k.padEnd(8)} 원반 ${String(v.원반화소).padStart(7)}`
      + ` · 지면 ${String(v.지면화소).padStart(7)} / ${v.총화소}`
      + ` · ${String(v.비율).padStart(6)}% · 최악 한 장 ${v.최악한장}`);
  }

  console.log('\n== 하네스가 실제로 지면을 그렸는가 ==');
  for (const k of [...자리, 'DEM 없음']) {
    ok(r[k] && r[k].지면화소 > 0.2 * r[k].총화소,
      `${k}: 지면이 화면의 20% 넘게 찍혔다 (${r[k] ? r[k].지면화소 : '없음'})`);
  }

  console.log('\n== DEM 이 있을 때 — 원반은 거의 안 보인다 ==');
  for (const k of 자리) {
    ok(r[k].비율 <= 1.0, `${k}: 원반이 화면의 1% 이하 (${r[k].비율}%)`);
  }
  const 최악 = Math.max(...자리.map(k => r[k].최악한장));
  ok(최악 <= 0.05 * (r['내륙'].총화소 / 16),
    `가장 나쁜 한 장도 그 장의 5% 이하 (${최악} 화소)`);

  console.log('\n== 그런데 DEM 이 없으면 원반이 지면의 전부다 ==');
  ok(없음.비율 >= 50, `DEM 없이는 원반이 화면의 절반 넘게 칠한다 (${없음.비율}%)`);
  const 최대있음 = Math.max(...자리.map(k => r[k].원반화소));
  ok(없음.원반화소 >= 20 * 최대있음,
    `DEM 없을 때가 있을 때보다 스무 배 넘게 많다 (${없음.원반화소} 대 ${최대있음})`);

  console.log('\n== 그래도 완전히 0 은 아니다 — 아직 틈을 메우고 있다 ==');
  ok(자리.some(k => r[k].원반화소 > 0),
    `DEM 이 있어도 원반이 이기는 화소가 남아 있다`
    + ` (${자리.map(k => k + ' ' + r[k].원반화소).join(' · ')})`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
