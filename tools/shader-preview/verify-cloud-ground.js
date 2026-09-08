/**
 * **구름 그림자가 땅에 지는가** 합격 판정. `build-cloud-ground.js` 의 짝.
 *
 * 넣기 전에는 그림자가 **구름끼리**(상층 → 중층)만 있었습니다
 * (`verify-cloud-shadow.js`). 땅은 구름이 하늘 어디에 있든 늘 같은 직달광을
 * 받았고, 실기에서 "구름의 그림자도 땅에 안보여" 로 잡혔습니다.
 *
 * 두 층위를 다 봅니다: **지도의 기하**(순수 JS)와 **화면까지 닿는가**(렌더).
 * 지도만 맞고 셰이더에 안 물리면 사용자에게는 아무 일도 안 일어납니다.
 *
 * 사용: node tools/shader-preview/build-cloud-ground.js
 *       node tools/shader-preview/verify-cloud-ground.js
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
  await p.goto(ORIGIN + '/cloud-ground.html', { timeout: 240000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null,
    { timeout: 240000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0, `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats || !stats.결과 || !stats.결과.지도) {
    console.log('\nFAILURES — __stats.결과 가 없습니다.'); process.exit(1);
  }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);
  const r = stats.결과;

  console.log('\n== 지도 (관측자 발밑 = 1 로 맞춘 상대 투과율) ==');
  for (const k of ['맑음', '온통흐림', '한덩이'])
    console.log(`  ${k}: 평균 ${r.지도[k].평균} · 표준편차 ${r.지도[k].표준편차}`);
  console.log(`\n== 기하 (저층 1.5km · 해 ${20}° → 어긋남 ${r.기하.예상어긋남}m, 태양 반대쪽) ==`);
  console.log(`  그늘 무게중심 동 ${r.지도.한덩이무게중심.동}m · 남 ${r.지도.한덩이무게중심.남}m`
    + ` (예상 동 ${r.기하.예상동} · 남 ${r.기하.예상남})`);
  console.log(`  해 방위 뒤집기: 남 ${r.방위대조.앞.남}m → ${r.방위대조.뒤.남}m`);
  console.log(`  해 20° → 12°: 남 ${r.고도대조.해20.남}m → ${r.고도대조.해12.남}m`
    + ` (예상 ${-r.고도대조.예상20} → ${-r.고도대조.예상12})`);
  console.log('\n== 화면 (평지 1km 위 · DEM 없음 → 지형 그림자는 정의상 0) ==');
  for (const k of Object.keys(r.화면))
    console.log(`  ${k}: 평균 ${r.화면[k].평균} · 표준편차 ${r.화면[k].표준편차}`);

  console.log('\n== 판정 ==');

  // ── 지도 ──────────────────────────────────────────────────────────────────
  ok(r.지도.맑음.표준편차 <= 0.001, `맑은 하늘은 지도가 평평하다 (σ ${r.지도.맑음.표준편차})`);
  ok(r.지도.온통흐림.표준편차 <= 0.001,
    `대조: 온통 흐려도 지도는 평평하다 — 운량을 두 번 세지 않는다 (σ ${r.지도.온통흐림.표준편차})`);
  ok(Math.abs(r.지도.온통흐림.평균 - 1) <= 0.02,
    `그때 평균이 1 이다 — 전체 어두움은 다른 데서 처리한다 (${r.지도.온통흐림.평균})`);
  ok(r.지도.한덩이.표준편차 >= 0.02,
    `구름 한 덩이는 지도에 무늬를 남긴다 (σ ${r.지도.한덩이.표준편차} ≥ 0.02)`);

  // ── 기하: 그늘은 H/tan(고도) 만큼 태양 반대쪽 ────────────────────────────
  const g = r.지도.한덩이무게중심;
  const dist = Math.hypot(g.동 - r.기하.예상동, g.남 - r.기하.예상남);
  ok(dist <= 250,
    `그늘이 예상한 자리에 진다 (어긋남 ${dist.toFixed(0)}m ≤ 250m = 지도 한 화소)`);
  ok(Math.sign(r.방위대조.앞.남) === -Math.sign(r.방위대조.뒤.남)
     && r.방위대조.뒤.화소 > 0,
    `대조: 해 방위를 180° 돌리면 그늘이 반대쪽으로 간다 (${r.방위대조.앞.남} → ${r.방위대조.뒤.남})`);
  const d12 = Math.abs(r.고도대조.해12.남 - (-r.고도대조.예상12));
  ok(Math.abs(r.고도대조.해12.남) > Math.abs(r.고도대조.해20.남) && d12 <= 250,
    `대조: 해가 낮을수록 그늘이 멀어진다 — 예상과 ${d12.toFixed(0)}m 차 (≤ 250m)`);

  // ── 화면까지 닿는가 ──────────────────────────────────────────────────────
  ok(r.화면.맑음.표준편차 <= 0.5, `맑으면 땅이 고르다 (σ ${r.화면.맑음.표준편차})`);
  ok(r.화면.온통흐림.표준편차 <= 0.5,
    `대조: 온통 흐려도 땅은 고르다 (σ ${r.화면.온통흐림.표준편차})`);
  ok(r.화면.한덩이.표준편차 >= 5,
    `구름 한 덩이가 땅을 얼룩지게 한다 (σ ${r.화면.한덩이.표준편차} ≥ 5)`);
  ok(r.화면.한덩이.평균 < r.화면.맑음.평균 - 5,
    `그 자리가 실제로 어둡다 (${r.화면.한덩이.평균} < ${r.화면.맑음.평균} − 5)`);
  ok(Math.abs(r.화면.한덩이_끔.평균 - r.화면.맑음.평균) <= 0.5
     && r.화면.한덩이_끔.표준편차 <= 0.5,
    `대조: uCloudShadow 를 끄면 그대로 돌아온다 (평균 ${r.화면.한덩이_끔.평균}, σ ${r.화면.한덩이_끔.표준편차})`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
