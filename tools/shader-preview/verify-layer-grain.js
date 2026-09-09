/**
 * **층별 무늬 방향** 합격 판정. `build-layer-grain.js` 의 짝.
 *
 * 실기 보고: "낮은 층의 구름 방향이랑 높은 층의 구름 방향이 너무 눈에 띄게
 * 차이가 나. 현실은 이정도는 아니었거든."
 *
 * ## 잰 것 (바람 방위 0·45·90°, 세 층에 **같은** 바람)
 *
 * | 층 | 바람 0° | 바람 45° | 바람 90° |
 * |---|---|---|---|
 * | 상층 | 48.7° · 결집 0.744 | 130.8° · 0.651 | 172.5° · 0.499 |
 * | 중층(고치기 전) | 23.6° · 0.336 | **23.6°** | **23.6°** |
 * | 저층 | 10.7° · 0.287 | **10.7°** | **10.7°** |
 *
 * 상층만 바람을 따라 돌고 중·저층은 나침반에 붙박여 있었습니다. 원인은
 * `slab_layer_thickness` 가 층마다 다른 규약을 쓰기 때문입니다 — 상층은
 * 지상 좌표를 바람 축으로 회전하는데, 중층 물결은 월드 XZ 에서 바로 세고
 * (`sin(p.x*1.8 + p.y*1.2)`), 저층은 아예 등방입니다.
 *
 * ## 고친 것과 안 고친 것
 *
 * 중층 물결을 바람 축으로 옮겼습니다. **다만 효과는 작습니다** — 물결은
 * 파장 12km 인데 이 시선(고도각 42°, 화각 55°)에서는 한 주기도 화면에 안
 * 들어오고, 게다가 물결은 모양장이 아니라 **운량**을 미는 느린 항이라
 * 무늬 방향에 실리는 비중이 작습니다. 스윙이 9° 남짓입니다. 과장하지
 * 않고 그대로 못 박습니다.
 *
 * **진짜 큰 격차는 방향이 아니라 결집도입니다** — 상층 0.74 대 저층 0.29.
 * 상층만 종횡비 5.71:1 (바람축 0.28 · 가로축 1.6) 로 뚜렷한 줄무늬이고
 * 나머지는 사실상 등방이라, 눈에는 "두 층이 서로 아무 상관 없는 그림"
 * 으로 읽힙니다. ⚠ 이 값은 **아직 훑어본 적이 없습니다.** 참고로 옛
 * CloudDeck 은 같은 성질을 훑어 4 를 골랐고(cloudPresets.ts 의 cellAspect
 * 주석), 슬랩의 5.71 은 그 검증을 안 거쳤습니다. 줄이는 것은 그림 판단이라
 * 사용자 눈을 거쳐야 합니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/build-layer-grain.js
 * 사용: node tools/shader-preview/verify-layer-grain.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

/** 각도 차 (0~90°, 무늬 축은 180° 주기라 90°가 최대). */
const axisGap = (a, b) => { let d = Math.abs(a - b) % 180; return d > 90 ? 180 - d : d; };

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/layer-grain.html', { timeout: 300000 });
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
  const W = ['바람0', '바람45', '바람90'];
  console.log('\n== 층별 무늬 (바람 0·45·90°, 세 층에 같은 바람) ==');
  for (const L of ['상층', '중층', '저층'])
    console.log(`  ${L}  ` + W.map(w => `${String(r[L][w].주방향).padStart(6)}° 결집 ${r[L][w].결집도}`).join(' · '));

  console.log('\n== 자가 스스로를 속이지 않는가 ==');
  //
  // ⚠ 무늬가 없으면 주방향은 난수입니다. 결집도가 바닥이 아닌 것부터 봅니다.
  ok(['상층', '중층', '저층'].every(L => W.every(w => r[L][w].결집도 > 0.1)),
    `모든 층에서 무늬가 실제로 잡혔다 (결집도 최소 `
    + `${Math.min(...['상층','중층','저층'].flatMap(L => W.map(w => r[L][w].결집도))).toFixed(3)})`);

  console.log('\n== 상층은 바람을 따라 돈다 ==');
  const 상스윙 = Math.max(axisGap(r.상층.바람0.주방향, r.상층.바람45.주방향),
                          axisGap(r.상층.바람45.주방향, r.상층.바람90.주방향));
  ok(상스윙 > 30,
    `바람을 45° 돌리면 상층 무늬도 크게 돈다 (${상스윙.toFixed(1)}°)`
    + ` — ${r.상층.바람0.주방향}° → ${r.상층.바람45.주방향}° → ${r.상층.바람90.주방향}°`);

  console.log('\n== 중층이 더 이상 나침반에 붙박이지 않는다 (고친 것) ==');
  //
  // 고치기 전에는 세 바람에서 주방향이 **완전히 같은 값**(23.6°)이었습니다.
  // 물결을 바람 축으로 옮겼으므로 이제 값이 갈려야 합니다.
  const 중값 = W.map(w => r.중층[w].주방향);
  ok(new Set(중값).size > 1,
    `바람을 돌리면 중층 무늬도 움직인다 — 고치기 전에는 셋이 똑같았다 (${중값.join('° / ')}°)`);
  // ⚠ 다만 크지 않습니다. 물결은 파장 12km 의 **느린 항**(운량을 밂)이라
  //   무늬 방향에 실리는 비중이 작습니다. 부풀리지 않고 그대로 적습니다.
  const 중스윙 = Math.max(axisGap(중값[0], 중값[1]), axisGap(중값[1], 중값[2]));
  ok(중스윙 < 30,
    `⚠ 다만 스윙이 작다 — 물결은 운량을 미는 느린 항이라 비중이 작다 (${중스윙.toFixed(1)}°)`);

  console.log('\n== 남은 격차 — 방향이 아니라 결집도 (아직 안 고침) ==');
  //
  // 상층만 종횡비 5.71:1 이라 줄무늬가 뚜렷하고 나머지는 사실상 등방입니다.
  // 실기에서 "두 층 방향 차가 과하다"고 읽히는 것의 대부분이 이 격차입니다.
  const 상결 = Math.max(...W.map(w => r.상층[w].결집도));
  const 저결 = Math.max(...W.map(w => r.저층[w].결집도));
  ok(상결 > 저결 * 1.8,
    `⚠ 상층이 저층보다 훨씬 줄무늬답다 (${상결} 대 ${저결}, ${(상결 / 저결).toFixed(2)}배)`
    + ` — 줄이려면 그림 판단이 필요해 아직 안 건드렸다`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
