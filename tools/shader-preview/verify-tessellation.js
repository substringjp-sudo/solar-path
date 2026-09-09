/**
 * **격자를 더 잘게 나누면 지형이 부드러워지는가** 합격 판정.
 * `build-tessellation.js` 의 짝.
 *
 * 물음: "지형 폴리곤을 테셀레이션해서 좀 부드럽고 완만하게 만드는건 안되나?"
 *
 * ## 답: 방향이 반대이고, 어차피 거의 안 변합니다
 *
 * 근거리 격자(152×256)의 간격을 줌 13 DEM 화소(15.1m)와 견주면 **500m 밖
 * 에서는 격자가 자료보다 성깁니다** — 2km 에서 5.7배, 3km 에서 8.5배.
 * 그러니 더 잘게 나누면 지금 놓치던 굴곡이 되살아나 **더 우툴두툴해집니다.**
 * 부드럽게 하려면 오히려 반대로 가야 합니다.
 *
 * 그런데 재 보면 삼각형을 **16배**(77,312 → 1,243,136)로 늘려도 화면이
 * 거의 안 변합니다. 실루엣 정확도는 제자리이고 밝기의 퍼짐은 0.7% 늘 뿐
 * 입니다. **격자가 병목이 아니기 때문**입니다.
 *
 * 병목은 조명입니다. 같은 격자에서 직달/확산 비만 물리값으로 바꾸면 σ 가
 * 29% 오릅니다 — 삼각형 16배가 준 것의 마흔 배입니다.
 *
 * ⚠ WebGL2 에는 테셀레이션·지오메트리 셰이더 단계가 **없습니다.** 정점을
 * CPU 에서 더 만드는 수밖에 없고, 비용이 그대로 정점 수로 옵니다.
 *
 * 이 판정은 그 결론을 못 박습니다 — 누군가 "삼각형을 늘려 입체감을 살리자"
 * 로 되돌아가면 여기서 걸립니다.
 *
 * 사용: node tools/shader-preview/build-tessellation.js
 *       node tools/shader-preview/verify-tessellation.js
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
  await p.goto(ORIGIN + '/tessellation.html', { timeout: 300000 });
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
  const keys = Object.keys(r);
  const 낮 = r[keys[0]], 높 = r[keys[keys.length - 1]];

  console.log('\n== 격자 밀도별 (마니산 정상) ==');
  for (const k of keys) {
    const v = r[k];
    console.log(`  ${k.padEnd(10)} 삼각형 ${String(v.삼각형).padStart(9)}`
      + ` · 실루엣 치우침 ${v.실루엣치우침} 절대중앙 ${v.실루엣절대중앙값}`
      + ` · σ 옛눈금 ${v.옛눈금.표준편차} 물리눈금 ${v.물리눈금.표준편차}`);
  }

  console.log('\n== 판정 ==');
  ok(높.삼각형 >= 15 * 낮.삼각형,
    `삼각형을 열여섯 배로 늘려 봤다 (${낮.삼각형} → ${높.삼각형})`);

  // ① 그래도 화면이 거의 안 변합니다 — 격자가 병목이 아닙니다.
  const σ늘음 = (높.옛눈금.표준편차 - 낮.옛눈금.표준편차) / 낮.옛눈금.표준편차;
  ok(Math.abs(σ늘음) <= 0.05,
    `그래도 음영의 퍼짐이 거의 그대로 (${낮.옛눈금.표준편차} → ${높.옛눈금.표준편차},`
    + ` ${(100 * σ늘음).toFixed(1)}%)`);
  ok(높.실루엣절대중앙값 >= 낮.실루엣절대중앙값 - 0.05,
    `실루엣 정확도도 안 좋아짐 (${낮.실루엣절대중앙값}° → ${높.실루엣절대중앙값}°)`);

  // ② 같은 격자에서 조명만 바꾸면 훨씬 크게 변합니다 — 병목은 여기입니다.
  const σ조명 = (낮.물리눈금.표준편차 - 낮.옛눈금.표준편차) / 낮.옛눈금.표준편차;
  ok(σ조명 >= 0.20,
    `같은 격자에서 직달/확산 비만 물리값으로 바꾸면 크게 변함`
    + ` (${낮.옛눈금.표준편차} → ${낮.물리눈금.표준편차}, +${(100 * σ조명).toFixed(1)}%)`);
  ok(σ조명 > 4 * Math.abs(σ늘음),
    `조명이 격자보다 훨씬 크게 좌우한다 (조명 +${(100 * σ조명).toFixed(1)}%`
    + ` 대 격자 ${(100 * σ늘음).toFixed(1)}%)`);

  // ③ 잔결은 조금 살아납니다 — "아무 효과도 없다"는 과장이 아니게.
  ok(높.옛눈금.이웃차이 > 낮.옛눈금.이웃차이,
    `잔결(이웃 화소 차이)은 조금 살아난다 (${낮.옛눈금.이웃차이} → ${높.옛눈금.이웃차이})`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
