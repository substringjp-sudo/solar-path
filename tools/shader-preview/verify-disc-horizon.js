/**
 * **옛 원반이 수평선 위를 지면으로 칠하는가** 합격 판정.
 * `build-disc-horizon.js` 의 짝.
 *
 * ## 결함 — setGroundHorizon 이 스스로를 지웁니다
 *
 * `setGroundHorizon` 은 원반을 `-480·tan(수평선 처짐)` 으로 내립니다. 그런데
 * 앱은 카메라도 `groundY + 1.6` 으로 같이 내리므로 둘의 상대 높이가 늘 1.6 —
 * 원반 테두리는 **관측지 고도와 무관하게 −0.191°** 에 고정됩니다.
 *
 * 진짜 수평선은 고도와 함께 처집니다. 그 사이가 **하늘인데 원반이 지면으로
 * 칠하는 띠** 입니다. 지형·해수면 격자는 55/60km 에서 끝나 그보다 아래를
 * 덮으므로 이 띠를 가려 주지 못합니다.
 *
 * 이 판정은 고치기 전의 값을 못 박습니다 — 고도가 높을수록 띠가 넓어지는
 * 것까지. 원반을 DEM 이 있을 때 끄거나 테두리를 진짜 처짐에 맞추면 이 값이
 * 0 으로 가야 하고, 그때 이 판정을 뒤집으면 됩니다.
 *
 * 사용: node tools/shader-preview/build-disc-horizon.js
 *       node tools/shader-preview/verify-disc-horizon.js
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
  await p.goto(ORIGIN + '/disc-horizon.html', { timeout: 300000 });
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
  const 자리 = ['바닷가', '내륙', '산꼭대기'];
  console.log('\n== 원반이 칠하는 가장 높은 자리 대 진짜 수평선 ==');
  for (const k of [...자리, 'DEM 없음']) {
    const v = r[k]; if (!v) continue;
    console.log(`  ${k.padEnd(8)} 발밑 ${String(v.발밑고도).padStart(7)}m`
      + ` · 수평선 −${v.수평선처짐}° · 원반 테두리 ${String(v.원반테두리).padStart(8)}°`
      + ` · 원반이 이긴 위끝 ${String(v.원반위끝).padStart(8)}°`
      + ` · 거짓 띠 ${String(v.거짓띠).padStart(7)}° · 화소 ${v.원반화소}`);
  }

  console.log('\n== 자가 점검 ==');
  ok(자리.every(k => r[k] && r[k].원반화소 > 0),
    `세 자리 모두 원반이 이기는 화소가 있다 — 자가 눈이 멀지 않았다`
    + ` (${자리.map(k => r[k].원반화소).join(' · ')})`);
  ok(r['DEM 없음'] && r['DEM 없음'].원반화소 > 10 * r['바닷가'].원반화소,
    `대조: DEM 이 없으면 비교가 안 되게 많다`
    + ` (${r['DEM 없음'].원반화소} 대 ${r['바닷가'].원반화소})`);

  console.log('\n== 결함: 테두리가 고도를 안 따라간다 ==');
  //
  // 테두리가 세 자리에서 **거의 같아야** 결함입니다 — 발밑 고도가 1m 에서
  // 456m 로 사백 배 달라지는데도 같은 각이라면, setGroundHorizon 이 카메라와
  // 서로 지워 아무 일도 안 한다는 뜻입니다.
  //
  // ⚠ 이 값은 **원반만 그려** 잽니다. 처음에는 "원반이 이긴 화소의 위끝" 을
  //   테두리로 읽었는데, 그건 테두리가 아니라 지형이 안 덮은 자리라
  //   사방이 뭍인 내륙에서 −0.739° 가 나와 판정이 헛돌았습니다.
  const 테두리 = 자리.map(k => r[k].원반테두리);
  const 폭 = Math.max(...테두리) - Math.min(...테두리);
  ok(폭 <= 0.05,
    `발밑 고도가 1m~456m 로 달라져도 원반 테두리가 같다 — setGroundHorizon 이 무력하다`
    + ` (${테두리.map(v => v.toFixed(3) + '°').join(' / ')}, 폭 ${폭.toFixed(3)}°)`);
  ok(Math.abs(테두리[2] - 테두리[0]) <= 0.05 && r['산꼭대기'].수평선처짐 > 10 * r['바닷가'].수평선처짐,
    `그동안 진짜 수평선은 열세 배 처졌다`
    + ` (−${r['바닷가'].수평선처짐}° → −${r['산꼭대기'].수평선처짐}°)`);

  console.log('\n== 결함: 높은 곳일수록 하늘을 넓게 덮는다 ==');
  const 바다 = r['바닷가'], 산 = r['산꼭대기'];
  ok(바다.거짓띠 <= 0.1,
    `해수면 관측지에서는 거의 없다 (${바다.거짓띠}° ≤ 0.1°)`);
  ok(산.거짓띠 >= 0.3,
    `산꼭대기에서는 하늘 ${산.거짓띠}° 를 지면으로 칠한다 (≥ 0.3°)`);
  ok(산.거짓띠 > 3 * Math.max(0.01, 바다.거짓띠),
    `고도가 높을수록 넓어진다 (바닷가 ${바다.거짓띠}° → 산꼭대기 ${산.거짓띠}°)`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
