/**
 * **먼 산이 제 뒤 하늘색으로 잦아드는가** 합격 판정. `build-haze.js` 의 짝.
 *
 * 실기 보고(새벽 06:46, 해 쪽을 봄): "앞쪽의 산이 원인불명으로 파랗고 밝게
 * 보여져."
 *
 * 공기원근은 먼 것을 **그 방향의 하늘색**으로 끌고 갑니다. 그러니 아주 멀면
 * 지형과 그 뒤 하늘의 색조가 만나야 합니다. 그런데 새 지형은 방위 여섯 곳을
 * 평균한 **한 값**을 하늘 전체에 썼습니다. 새벽 해 쪽 지평선은 주황, 반대쪽은
 * 파랑인데 그 둘을 섞은 값을 양쪽에 다 발랐던 것입니다.
 *
 * 재 보면 옛 방식에서 해 쪽 지형의 색조(파랑/빨강)가 **1.099**, 그 뒤 하늘은
 * **0.900** 이었습니다. 연무는 하늘 쪽으로 섞는 것이므로 지형이 하늘보다
 * **더 파랄 수는 없습니다** — 그 자체로 결함입니다.
 *
 * ⚠ 옛 능선 띠는 이미 방향별 하늘색(hazeAt)을 쓰고 있었습니다. 새 지형만
 * 뒤처져 있었고, 두 표현이 만나는 자리에서 색이 갈렸을 것입니다.
 *
 * ## 대조
 *
 * **가까운 지형은 하늘색을 안 따라가야 합니다.** 해 반대쪽 산은 몇 km 라
 * 투과율이 1 에 가깝고, 제 흙색(색조 0.62)이 그대로 보여야 맞습니다.
 * "전부 하늘색으로 칠하기" 가 통과하지 못하게 이걸 같이 봅니다.
 *
 * 사용: node tools/shader-preview/build-haze.js
 *       node tools/shader-preview/verify-haze.js
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
  await p.goto(ORIGIN + '/haze.html', { timeout: 300000 });
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
  const 옛 = stats.결과['옛 평균 한 값'], 새 = stats.결과['방향별 하늘색'];

  for (const [k, v] of [['옛 평균 한 값', 옛], ['방향별 하늘색', 새]]) {
    console.log(`\n== ${k} ==`);
    for (const [az, r] of Object.entries(v.방위))
      console.log(`  ${az.padEnd(8)} 하늘 색조 ${r.하늘색조.toFixed(3)} | 지형 색조 ${r.지형색조.toFixed(3)}`
        + ` | 어긋남 ${r.색조어긋남}`);
  }

  console.log('\n== 판정 ==');
  const 옛해 = 옛.방위['해 쪽'], 새해 = 새.방위['해 쪽'];
  ok(!!옛해 && !!새해, '해 쪽 방위에서 하늘·지형 경계를 찾았다');

  // ① 결함 자체 — 연무가 지형을 제 뒤 하늘보다 **더 파랗게** 만들었습니다.
  ok(옛해.지형색조 > 옛해.하늘색조 + 0.1,
    `옛 방식은 해 쪽 지형이 뒤 하늘보다 더 파랬다 (지형 ${옛해.지형색조} > 하늘 ${옛해.하늘색조})`);
  ok(새해.지형색조 <= 새해.하늘색조 + 0.05,
    `이제는 안 그렇다 (지형 ${새해.지형색조} ≤ 하늘 ${새해.하늘색조} + 0.05)`);

  // ② 얼마나 가까워졌나.
  ok(새해.색조어긋남 <= 0.05,
    `해 쪽에서 먼 산이 뒤 하늘색으로 잦아든다 (색조 어긋남 ${새해.색조어긋남} ≤ 0.05)`);
  ok(새해.색조어긋남 < 0.25 * 옛해.색조어긋남,
    `옛 방식보다 크게 나아졌다 (${옛해.색조어긋남} → ${새해.색조어긋남})`);

  // ③ 대조 — 가까운 지형까지 하늘색으로 칠하면 안 됩니다.
  const 새반대 = 새.방위['해 반대'];
  ok(!!새반대 && 새반대.색조어긋남 >= 0.15,
    `대조: 가까운 지형은 제 흙색을 지킨다 (해 반대 어긋남 ${새반대 ? 새반대.색조어긋남 : 'n/a'} ≥ 0.15)`);
  ok(!!새반대 && 새반대.지형색조 < 0.8,
    `대조: 그 색이 실제로 따뜻하다 (색조 ${새반대 ? 새반대.지형색조 : 'n/a'} < 0.8)`);

  // ④ 대조 — 하늘 자체는 안 건드렸습니다.
  const 하늘같음 = Object.keys(새.방위).every(k =>
    옛.방위[k] && Math.abs(새.방위[k].하늘색조 - 옛.방위[k].하늘색조) < 0.05);
  ok(하늘같음, '대조: 하늘돔은 두 방식에서 같다 — 바뀐 것은 지형뿐');

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
