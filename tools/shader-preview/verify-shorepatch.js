/**
 * **물가가 화소마다 엉키지 않는가** 합격 판정. `build-shorepatch.js` 의 짝.
 *
 * 실기 보고(대부도): "물가와 바닷가가 엉켜서 보여", "바닷가와 땅 사이 경계에
 * 이상하게 상자 모양으로 각진 모양이 발생해."
 *
 * ## 자료가 이렇게 생겼습니다
 *
 * 대부도 근거리 DEM(줌 13, 화소 15m) 58만 화소: 물 h<−0.5 가 2.43%,
 * −0.5<h<0 이 **10.21%**, **정확히 0 이 38.55%**, 0<h<0.5 가 9.04%.
 * Terrarium 이 먼바다를 정확히 0 으로 자르기 때문입니다.
 *
 * 옛 규칙은 "정확히 0 = 모르는 곳 = 999m 깊이" 였습니다. 그러면 갯벌에서
 * 화소 한 칸 차이로 수심이 999m 와 0.2m 를 오가고, 화면에는 「깊은 바다 ·
 * 흰 포말 · 갈색 뭍」이 격자무늬로 찍힙니다.
 *
 * ## 고친 것
 *
 * ① **얕은 물은 뭍 근처에만 있습니다.** 반경 150m 안에 뭍이 있으면 실제
 *    수심을, 없으면 먼바다로 봅니다. 150m 규모로 변하므로 화소 단위로
 *    안 튑니다.
 * ② **포말은 바닥 기울기가 정합니다.** 부서지는 띠의 폭은 수심 나누기
 *    기울기이고, 같은 에너지가 넓게 퍼지면 옅어집니다. 갯벌(기울기 0.0005)
 *    이면 띠가 1km 라 거의 안 보이고, 가파른 해변이면 그대로 섭니다.
 *
 * ## 아직 못 고친 것 — 경계의 각짐
 *
 * 경계의 2차 차분은 **1.634 그대로**입니다. 매끄럽게 한 고도로 물가를
 * 갈라 봤지만 1.945 로 **오히려 나빠져** 뺐습니다. 자료의 38.55% 가 정확히
 * 0 인 고원이라 0 등고선이 곡선이 아니라 고원의 가장자리, 곧 화소 모서리
 * 입니다. 섞어도 등고선이 다른 모서리로 옮겨갈 뿐입니다. 자료를 바꾸거나
 * 물가를 화소 아래 해상도로 다시 세우지 않으면 남습니다.
 *
 * ⚠ **자를 나중에 두껍게 고쳤습니다.** 예전에는 줄마다 경계를 **하나만**
 * 세어 384줄 중 29~37줄만 썼고, 그 표본으로는 결론이 격자 밀도에 따라
 * 뒤집혔습니다. 지금은 모든 경계를 세어 176~254줄입니다. 그래서 예전에 적혀
 * 있던 2.286 · 2.571 이 위 값으로 바뀌었습니다 — 화면이 달라진 것이 아니라
 * 자가 달라진 것입니다.
 *
 * 사용: node tools/shader-preview/build-shorepatch.js
 *       node tools/shader-preview/verify-shorepatch.js
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
  await p.goto(ORIGIN + '/shorepatch.html', { timeout: 300000 });
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
  const 옛 = stats.결과.옛규칙, 지금 = stats.결과.지금;

  console.log('\n== 대부도 갯벌 (30m 전망대에서 서쪽) ==');
  for (const [k, v] of [['옛 규칙', 옛], ['지금', 지금]])
    console.log(`  ${k.padEnd(7)} 뭍 ${v.뭍} · 포말 ${v.포말} (${v.포말비율}%) · 물 ${v.물}`
      + ` · 줄당 갈래 뒤집힘 ${v.줄당뒤집힘} (최악 ${v.최악줄}) · 경계 각짐 ${v.경계각짐}`);

  console.log('\n== 판정 ==');
  ok(지금.줄당뒤집힘 <= 0.6 * 옛.줄당뒤집힘,
    `물가가 덜 엉킨다 — 줄당 갈래 뒤집힘 ${옛.줄당뒤집힘} → ${지금.줄당뒤집힘} (0.6배 이하)`);
  ok(지금.포말비율 <= 0.6 * 옛.포말비율,
    `갯벌의 흰 판이 줄었다 — 포말 ${옛.포말비율}% → ${지금.포말비율}%`);

  // 대조 — "포말을 다 지우기"와 "바다를 다 지우기"가 통과하지 못하게.
  ok(지금.포말 >= 1000,
    `대조: 그래도 포말은 남는다 (${지금.포말}화소 ≥ 1000) — 다 지우면 안 됩니다`);
  ok(지금.물 >= 옛.물,
    `대조: 물이 줄지 않았다 (${옛.물} → ${지금.물}) — 포말이던 자리가 얕은 물이 된 것`);
  ok(지금.뭍 === 옛.뭍,
    `대조: 뭍은 그대로다 (${옛.뭍} = ${지금.뭍}) — 해안선 자체는 안 옮겼습니다`);

  // 아직 못 고친 것을 못 박아 둡니다 — 나중에 누가 고치면 이 줄이 먼저 깨집니다.
  ok(Math.abs(지금.경계각짐 - 옛.경계각짐) < 0.01,
    `경계의 각짐은 그대로 (${지금.경계각짐}) — 자료가 정확히 0 인 고원이라 남아 있습니다`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
