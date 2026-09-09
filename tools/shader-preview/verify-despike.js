/**
 * **바다 한복판에 첨탑이 서지 않는가** 합격 판정. `build-despike.js` 의 짝.
 *
 * 저줌 Terrarium 타일에는 R 채널이 어긋난 **화소 한 폭짜리 줄**이 있습니다.
 * 대부도 서쪽 6.6km 바다에서 이웃이 전부 0~31m 인데 한 열만 R = 128 →
 * 125·134 로 튀어 −648m·+1572m 이 되고, 화면에 고도각 **8.96°** 짜리 첨탑이
 * 섰습니다. R 한 단계가 곧 256m 이므로 결함은 반드시 그만큼 어긋나고,
 * 실제 지형은 화소 한 칸(243m)에서 200m 를 못 뜁니다 — 그 사이에 문턱을
 * 둡니다.
 *
 * 이 판정의 핵심은 **대조**입니다. "높은 것을 다 깎기" 는 첫 시험을
 * 통과하지만 도곡동에서 바로 걸립니다 — 거기 179° 의 3.90° 짜리 산은
 * 진짜라서 걷어내기를 켜도 **한 치도 안 움직여야** 합니다.
 *
 * ⚠ 판정을 처음 짤 때 15° 간격 스물넷을 좁은 화각으로 가운데 열만 읽었더니
 * 걷어내기를 켜나 끄나 같은 값이 나왔습니다. 결함이 280° 에 있는데 격자에는
 * 270·285 뿐이라 **첨탑이 화면 밖**이었던 것입니다. 지금은 방위를 겹쳐 가며
 * 훑고 화면 전체에서 최댓값을 찾습니다.
 *
 * 사용: node tools/shader-preview/build-despike.js
 *       node tools/shader-preview/verify-despike.js
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
  await p.goto(ORIGIN + '/despike.html', { timeout: 300000 });
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

  for (const k of Object.keys(r)) {
    const v = r[k];
    console.log(`\n== ${k} (발밑 ${v.발밑}m) — 360° 중 가장 높이 잡힌 지면 ==`);
    console.log(`  CPU 원본  ${v.원본최대}° @${v.원본방위}°   ·  CPU 걷어냄 ${v.참조최대}° @${v.참조방위}°`);
    console.log(`  화면 끔   ${v.끔.최대}° @${v.끔.방위}°   ·  화면 켬   ${v.켬.최대}° @${v.켬.방위}°`);
  }

  console.log('\n== 판정 ==');
  const 대 = r.대부도, 도 = r.도곡동;

  ok(대.끔.최대 >= 5,
    `대부도: 걷어내기를 끄면 첨탑이 실제로 보인다 (${대.끔.최대}° ≥ 5° — 이게 없으면 판정이 눈먼 것)`);
  ok(대.켬.최대 <= 2.5,
    `대부도: 켜면 첨탑이 사라진다 (${대.켬.최대}° ≤ 2.5°)`);
  ok(Math.abs(대.켬.최대 - 대.참조최대) <= 0.3,
    `대부도: 남은 최댓값이 성한 자료가 말하는 값과 맞는다 (${대.켬.최대}° 대 ${대.참조최대}°)`);

  // 대조 — 진짜 산은 한 치도 안 움직여야 합니다.
  ok(Math.abs(도.켬.최대 - 도.끔.최대) <= 0.05,
    `대조: 도곡동의 진짜 산은 그대로다 (끔 ${도.끔.최대}° · 켬 ${도.켬.최대}°, 차 ≤ 0.05°)`);
  ok(도.원본최대 === 도.참조최대,
    `대조: 그 산은 자료에서도 안 깎인다 (원본 ${도.원본최대}° = 걷어냄 ${도.참조최대}°)`);
  ok(Math.abs(도.켬.최대 - 도.참조최대) <= 0.3,
    `대조: 화면 값도 참조와 맞는다 (${도.켬.최대}° 대 ${도.참조최대}°)`);
  ok(Math.abs(도.켬.방위 - 도.참조방위) <= 3,
    `대조: 그 산이 있는 방위도 맞는다 (${도.켬.방위}° 대 ${도.참조방위}°)`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
