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
 * ## 그리고: 물가의 구멍을 해수면 한쪽 겹침으로 닫습니다
 *
 * 바닷가에서 원반이 이기던 4,821화소는 **지형과 해수면 사이의 구멍**이었습니다.
 * 지형은 정점에서 보간한 vElevM 로, 해수면은 프래그먼트마다 DEM 에서 직접
 * 읽은 값으로 같은 0 등고선을 각자 계산합니다. 표본이 다르니 어긋나고,
 * 어긋난 화소는 양쪽 다 버립니다.
 *
 * 해수면을 뭍 쪽으로 조금 넘겨 그리면(uShoreOverlapM) 1m 로 이미 다 닫힙니다.
 *
 * ⚠ **반대로 지형을 물 쪽으로 넘기면 안 됩니다.** Terrarium 이 먼바다를
 * 정확히 0 으로 자르므로 문턱을 조금만 내려도 그 고원이 통째로 뭍으로
 * 그려집니다 — −3m 로 해 봤다가 물 맨위가 −0.05° 에서 −0.48° 로 잘렸고
 * verify-coastline 6개 · verify-inland 1개가 걸렸습니다. 겹침은 한쪽뿐입니다.
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
  const K = (site, ov) => r[site + ' 겹침' + ov + 'm'];
  console.log('\n== 원반이 이기는 화소 · 물가 겹침 폭별 ==');
  for (const [k, v] of Object.entries(r))
    console.log(`  ${k.padEnd(18)} 원반 ${String(v.원반화소).padStart(7)}`
      + ` · 거짓 띠 ${String(v.거짓띠).padStart(7)}°`
      + ` · 원반끄면구멍 ${String(v.구멍화소).padStart(7)}`
      + ` · 뭍 ${String(v.뭍화소).padStart(7)} · 물 ${String(v.물화소).padStart(7)}`);

  console.log('\n== 자가 스스로를 속이지 않는가 ==');
  //
  // ⚠ 지면이 안 그려졌으면 "원반이 안 보인다" 는 그냥 하네스 결함입니다
  //   (원반 판정에서 실제로 그렇게 속은 적이 있습니다).
  ok(Object.values(r).every(v => v.뭍화소 + v.물화소 > 0.3 * 1048576),
    `모든 경우에서 지면이 화면의 30% 넘게 찍혔다`);
  ok(K('바닷가', 0).원반화소 > 1000,
    `겹침 0 에서 바닷가에 구멍이 있다 — 자가 눈멀지 않았다 (${K('바닷가', 0).원반화소}화소)`);

  console.log('\n== 해수면 한쪽 겹침이 그 구멍을 닫는가 ==');
  for (const ov of [1, 3, 10])
    ok(K('바닷가', ov).원반화소 === 0,
      `겹침 ${ov}m 에서 바닷가 구멍이 정확히 0 (${K('바닷가', 0).원반화소} → ${K('바닷가', ov).원반화소})`);

  console.log('\n== 대조: 물이 뭍으로 번지지 않는가 ==');
  //
  // 구멍만 보면 "물을 사방에 깔기" 가 만점을 받습니다. 내륙(발밑 70.7m)에서
  // 물 화소가 안 늘어야 합니다 — 10m 를 줘도 그대로여야 합니다.
  for (const ov of [1, 3, 10])
    ok(K('내륙', ov).물화소 === K('내륙', 0).물화소,
      `내륙에서 겹침 ${ov}m 이 물을 안 늘린다 (${K('내륙', 0).물화소} = ${K('내륙', ov).물화소})`);

  console.log('\n== 원반을 꺼도 하늘에 구멍이 안 나는가 ==');
  //
  // 이것이 **원반을 끌 수 있는가** 를 가르는 자입니다. 위의 원반화소는
  // "원반이 이겼다" 만 세므로, 원반을 껐을 때 그 자리를 지형·해수면이
  // 받아 주는지는 말해 주지 않습니다. 여기서는 원반을 끈 장면에서
  // **지평선(−처짐) 아래인데 아무것도 안 그려진** 화소를 셉니다.
  //
  // ⚠ 자가 눈멀지 않았는지 먼저 봅니다 — DEM 이 없으면 원반이 지면의
  //   전부이므로 구멍이 화면을 가득 채워야 합니다. 앱이 원반을 DEM 이
  //   있을 때만 끄는 이유가 바로 이것입니다.
  ok(r['DEM 없음'].구멍화소 > 100000,
    `대조: DEM 이 없으면 원반을 끈 자리가 통째로 구멍 (${r['DEM 없음'].구멍화소}화소)`
    + ` — 그래서 앱은 DEM 이 있을 때만 원반을 끈다`);
  ok(K('바닷가', 0).구멍화소 > 1000,
    `대조: 겹침 0 에서는 물가에도 구멍이 남는다 (${K('바닷가', 0).구멍화소}화소)`);

  const 앱겹침 = 3;   // TerrainField/SeaPlane 의 uShoreOverlapM 기본값
  for (const k of ['바닷가', '내륙'])
    ok(K(k, 앱겹침).구멍화소 <= 10,
      `${k} 는 원반을 꺼도 구멍이 사실상 없다 (${K(k, 앱겹침).구멍화소}화소)`);

  // ⚠ **남은 한계 — 산꼭대기.** 455m 에서 진짜 수평선은 76km 인데 해수면
  //   격자가 60km 에서 끝납니다 (−0.706° 대 −0.686°, 0.02° 띠). 그 띠가
  //   구멍으로 남습니다. 100만 화소 중 0.2% 미만이고, 원반을 켜 두면
  //   대신 0.495° 짜리 거짓 지평선이 생기므로 끄는 쪽이 낫습니다.
  //
  //   ⚠ SEA_FAR_M 을 60km → 200km 로 늘려 봤지만 **더 나빠졌습니다**
  //   (1,134 → 1,785화소). 같은 고리 수(SEA_RINGS)를 200km 에 펴면 수평선
  //   언저리의 고리 간격이 벌어져 새 틈이 생깁니다. 거리가 아니라 고리
  //   배분 문제라 60km 로 되돌렸습니다. 고치려면 고리를 수평선 쪽에 더
  //   촘촘히 몰아야 합니다.
  //
  //   ⚠ 이 A/B 를 재확인하다가 **stage-esm 을 빠뜨려** 세 번 연속 같은 값
  //   (1,785)을 얻고 "거리는 무관하다" 로 뒤집을 뻔했습니다. 하네스는
  //   `.harness/preview/app/` 사본을 읽습니다 — 앱 상수를 만졌으면
  //   stage-esm 부터 돌리십시오. 겹침 10m 면 773화소까지 줄지만, 겹침을
  //   넓히는 데는 다른 대가가 있어 3m 를 그대로 둡니다.
  ok(K('산꼭대기', 앱겹침).구멍화소 < 3000,
    `산꼭대기에 남는 구멍은 화면의 0.3% 미만 (${K('산꼭대기', 앱겹침).구멍화소}화소`
    + ` = ${(K('산꼭대기', 앱겹침).구멍화소 / 1048576 * 100).toFixed(3)}%)`);
  ok(K('산꼭대기', 앱겹침).구멍화소 > 0,
    `⚠ 다만 0 은 아니다 — 해수면이 60km 에서 끝나 수평선(76km) 에 못 닿는다`
    + ` (${K('산꼭대기', 앱겹침).구멍화소}화소, 아직 안 고침)`);

  console.log('\n== 원반 테두리가 고도를 안 따라간다 (아직 안 고침) ==');
  const 자리 = ['바닷가', '내륙', '산꼭대기'];
  const 테두리 = 자리.map(k => K(k, 0).원반테두리);
  const 폭 = Math.max(...테두리) - Math.min(...테두리);
  ok(폭 <= 0.05,
    `발밑 고도가 1m~456m 로 달라져도 원반 테두리가 같다 — setGroundHorizon 이 무력하다`
    + ` (${테두리.map(v => v.toFixed(3) + '°').join(' / ')}, 폭 ${폭.toFixed(3)}°)`);
  ok(K('산꼭대기', 0).거짓띠 >= 0.3,
    `그래서 산꼭대기에서 하늘 ${K('산꼭대기', 0).거짓띠}° 를 지면으로 칠한다`);
  ok(K('산꼭대기', 3).거짓띠 === K('산꼭대기', 0).거짓띠,
    `⚠ 이건 겹침으로 안 없어진다 — 다른 결함이다 (${K('산꼭대기', 3).거짓띠}°)`);
  ok(K('바닷가', 0).거짓띠 === 0,
    `해수면 관측지에서는 거짓 띠가 없다 (${K('바닷가', 0).거짓띠}°)`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
