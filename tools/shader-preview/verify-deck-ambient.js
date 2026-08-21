/**
 * 3단계 합격 판정 (docs/CLOUD_TEXTURE_PLAN.md).
 *
 * 정점 속성(aAmbientUp/aAmbientDown)이 VERT→FRAG로 실제로 배선됐는지는
 * JS 콜백만 불러서는 알 수 없습니다. 여기서는 `CloudDeck.ts`를 그대로
 * 임포트해 씬을 만들고, 태양 쪽과 반대쪽으로 카메라를 돌려 **렌더된 화면
 * 평균색**을 비교합니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-deck-ambient-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-deck-ambient.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1000, height: 520 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto('http://localhost:8123/deck-ambient.html');
  await p.waitForTimeout(8000);

  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0,
    `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/SHADER_ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats) {
    console.log('\nFAILURES — __stats 가 없습니다.');
    process.exit(1);
  }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);

  console.log('\n== 방향별 환경광 ==');
  console.log('  태양 쪽  rgb(%d,%d,%d)  R/B=%s',
    stats.태양쪽.r.toFixed(0), stats.태양쪽.g.toFixed(0), stats.태양쪽.b.toFixed(0),
    stats.태양쪽RB.toFixed(3));
  console.log('  반대쪽  rgb(%d,%d,%d)  R/B=%s',
    stats.반대쪽.r.toFixed(0), stats.반대쪽.g.toFixed(0), stats.반대쪽.b.toFixed(0),
    stats.반대쪽RB.toFixed(3));

  const ratio = stats.태양쪽RB / stats.반대쪽RB;
  console.log('  태양쪽 R/B ÷ 반대쪽 R/B = %s', ratio.toFixed(3));
  ok(stats.태양쪽RB > stats.반대쪽RB,
    '태양 쪽이 반대쪽보다 붉음 (R/B 더 큼)');
  ok(ratio >= 1.05,
    `방향차가 뚜렷함 — 최소 5% 이상 (실측 ${((ratio - 1) * 100).toFixed(1)}%)`);
  // 예전(층당 uniform 하나)에는 이 비율이 정확히 1.000이었습니다 —
  // 360° 덱 전체가 같은 색이었으니까요.
  ok(Math.abs(ratio - 1) > 0.02,
    '예전(방향 무관 uniform)이었다면 1.000이었을 비율이 벌어짐');

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
