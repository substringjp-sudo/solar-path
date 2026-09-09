/**
 * **두 격자를 하나로 합쳐도 되는가** 합격 판정. `build-unified-field.js` 의 짝.
 *
 * ## 답: 됩니다. 다만 이음매가 **좋아지지는 않고 비슷합니다.**
 *
 *     구성            실루엣 절대중앙   이음매 평균   이음매 최대
 *     두 격자              0.0872        0.818        5.022
 *     한 격자 폭 0.30      0.0872        0.838        5.126
 *     한 격자 폭 0.75      0.0830        1.349        8.845
 *
 * 얻는 것은 이음매 품질이 아니라 **구조**입니다 — 메시가 하나가 되어 자료
 * 경계가 사라지고 드로우 콜이 줄며, 실루엣 정확도는 동률입니다.
 *
 * ⚠ 처음에는 "이음매 −56%" 로 읽었습니다. 그건 자가 얇아서(한 방위 12줄)
 * 난 착시였고, 같은 구성의 기준선이 실행마다 0.39 ↔ 0.24 로 흔들렸습니다.
 * 방위 넷 × 108줄로 두껍게 하니 재현되고, 이득도 사라졌습니다.
 *
 * 섞는 구간에서 **가짜 기울기가 w'(r)·Δh 로 생깁니다.** 촘촘한 패치(줌 13)와
 * 성긴 패치(줌 9)는 같은 자리를 10.9m 다르게 읽으므로, 폭이 좁으면 w' 이
 * 커져 그 어긋남이 한 자리에 몰립니다. 넓게 펴면 사라집니다.
 *
 * ⚠ 이음매 자를 처음엔 눈높이 1.6m 로 쟀습니다. 그러면 3km 지면이
 * 내려본각 0.03° 라 **한 줄도 안 잡혀** "이음매 0" 이 나왔습니다 — 차이가
 * 없어서가 아니라 자가 포화한 것입니다(구름 그림자 하네스에서 똑같이
 * 밟았습니다). 300m 탑에서 봅니다. 그래서 **쓴 줄 수를 먼저 단언합니다.**
 *
 * ⚠ 평균만 보면 "한 줄짜리 뾰족한 계단" 과 "여러 줄에 걸친 완만한 휨" 을
 * 구분 못 합니다. 이음매는 전자이므로 최댓값을 함께 봅니다.
 *
 * 사용: node tools/shader-preview/build-unified-field.js
 *       node tools/shader-preview/verify-unified-field.js
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
  const p = await b.newPage({ viewport: { width: 900, height: 700 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/unified-field.html', { timeout: 300000 });
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
  console.log('\n== 도곡동 · 실루엣 72방위 · 이음매는 300m 탑에서 ==');
  for (const [k, v] of Object.entries(r))
    console.log(`  ${k.padEnd(14)} 메시 ${v.메시} · 삼각형 ${String(v.삼각형).padStart(7)}`
      + ` · 실루엣 치우침 ${String(v.실루엣치우침).padStart(8)} 절대중앙 ${String(v.실루엣절대중앙값).padStart(7)}`
      + ` · 이음매 평균 ${String(v.이음매각짐).padStart(7)} 최대 ${String(v.이음매최대).padStart(7)} (${v.줄}줄)`);

  const 둘 = r['두 격자'], 하나 = r['한 격자 폭0.3'];
  const 좁 = r['한 격자 폭0.2'], 넓 = r['한 격자 폭0.75'];

  console.log('\n== 자가 이음매를 실제로 볼 수 있는가 ==');
  // ⚠ 얇으면 결론이 실행마다 뒤집힙니다 — 한 방위 12줄로 쟀을 때 같은
  //   구성의 기준선이 0.39 ↔ 0.24 였습니다.
  ok(Object.values(r).every(v => v.줄 >= 100),
    `모든 경우에서 이음매 띠에 100줄 이상 잡혔다 (${Object.values(r).map(v => v.줄).join(' · ')})`);
  ok(둘.이음매최대 > 1.0,
    `두 격자에는 잴 만한 이음매가 있다 — 자가 눈멀지 않았다 (최대 ${둘.이음매최대})`);

  console.log('\n== 합쳐도 실루엣이 안 나빠지는가 ==');
  ok(하나.메시 === 1 && 둘.메시 === 2, `메시가 둘에서 하나로 (${둘.메시} → ${하나.메시})`);
  ok(하나.실루엣절대중앙값 <= 둘.실루엣절대중앙값 + 0.005,
    `실루엣 절대중앙값이 안 나빠졌다 (${둘.실루엣절대중앙값} → ${하나.실루엣절대중앙값})`);
  ok(Math.abs(하나.실루엣치우침 - 둘.실루엣치우침) <= 0.05,
    `치우침도 크게 안 움직였다 (${둘.실루엣치우침} → ${하나.실루엣치우침})`);
  ok(하나.표본 === 둘.표본 && 하나.표본 >= 60,
    `두 경우가 같은 방위 수로 견줬다 (${둘.표본} · ${하나.표본})`);

  console.log('\n== 이음매가 나빠지지 않는가 ==');
  //
  // "좋아진다" 가 아니라 "안 나빠진다" 입니다. 합치는 값은 이음매 품질이
  // 아니라 구조이므로, 여기서는 대가를 치르지 않았다는 것만 확인합니다.
  ok(하나.이음매각짐 <= 둘.이음매각짐 * 1.10,
    `이음매 평균이 안 나빠졌다 (${둘.이음매각짐} → ${하나.이음매각짐})`);
  ok(하나.이음매최대 <= 둘.이음매최대 * 1.10,
    `가장 나쁜 한 줄도 안 나빠졌다 (${둘.이음매최대} → ${하나.이음매최대})`);

  console.log('\n== 섞는 폭이 왜 넓어야 하는가 ==');
  //
  // 좁히면 w'(r) 이 커져 두 자료의 어긋남(~10.9m)이 한 자리에 몰립니다.
  // 이 대조가 없으면 0.30 이 그냥 손으로 고른 값처럼 보입니다.
  ok(넓.이음매최대 > 하나.이음매최대,
    `폭을 좁히면(0.75) 이음매가 나빠진다 — 가짜 기울기가 몰린다`
    + ` (${하나.이음매최대} → ${넓.이음매최대})`);
  ok(하나.이음매최대 <= 좁.이음매최대,
    `0.30 이 0.20 보다 최댓값이 낮다 (${하나.이음매최대} vs ${좁.이음매최대})`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
