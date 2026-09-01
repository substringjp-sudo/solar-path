/**
 * **앱 그림이 하네스 그림과 같은가** 판정 — `app-vs-harness.html`.
 *
 * 지금까지 모든 튜닝은 하네스 그림 위에서 했습니다. 그런데 하네스는
 * 원해상도로 곧장 그리고, 앱은 하늘·구름을 저해상도 버퍼에 그린 뒤
 * 확대하며 블룸·박명광선·디더를 얹습니다. 그 차이를 못으로 박습니다.
 *
 * 재보니 갈리는 것은 **선명도 하나뿐**이었습니다 — 색·휘도·채도는 배율과
 * 후처리에 관계없이 소수점까지 같습니다. 그래서 단언도 그렇게 나눕니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-app-vs-harness.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-app-vs-harness.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1300, height: 1300 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(`${ORIGIN}/app-vs-harness.html`);
  await p.waitForTimeout(95000);
  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0, `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/SHADER_ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats) { console.log('\nFAILURES — __stats 가 없습니다.'); process.exit(1); }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);

  const R = stats.결과;
  const at = (알트, 조건) => R.find(r => r.태양고도 === 알트 && r.조건.startsWith(조건));
  const SUNS = [25, 2, 0, -3];

  console.log('\n== 후처리가 색을 바꾸지 않는가 ==');
  for (const 알트 of SUNS) {
    const h = at(알트, '하네스'), a = at(알트, '앱 배율 2');
    const d휘 = Math.abs(a.평균휘도 - h.평균휘도) / Math.max(1, h.평균휘도);
    const d채 = Math.abs(a.채도 - h.채도);
    console.log(`  태양 ${String(알트).padStart(3)}°  휘도 ${h.평균휘도} → ${a.평균휘도}` +
                `   채도 ${h.채도} → ${a.채도}   색상 ${h.색상각}° → ${a.색상각}°`);
    // 블룸이 밝은 곳을 조금 들어 올리므로 휘도는 3%까지 봐 줍니다.
    ok(d휘 < 0.03, `태양 ${알트}° 휘도가 유지된다 (${(100 * d휘).toFixed(1)}%)`);
    ok(d채 < 0.01, `태양 ${알트}° 채도가 유지된다 (${d채.toFixed(3)})`);
  }

  console.log('\n== 배율 1이면 하네스와 같은 선명도인가 ==');
  for (const 알트 of SUNS) {
    const h = at(알트, '하네스'), one = at(알트, '배율 1');
    const 비 = one.세부 / h.세부;
    console.log(`  태양 ${String(알트).padStart(3)}°  세부 ${h.세부} → ${one.세부}  (${(100 * 비).toFixed(0)}%)`);
    ok(비 > 0.95, `태양 ${알트}° 배율 1은 하네스와 같다 (${(100 * 비).toFixed(0)}%)`);
  }

  console.log('\n== 배율 2에서도 재구성 필터가 일하는가 ==');
  for (const 알트 of SUNS) {
    const h = at(알트, '하네스'), two = at(알트, '앱 배율 2');
    const 비 = two.세부 / h.세부;
    console.log(`  태양 ${String(알트).padStart(3)}°  세부 ${h.세부} → ${two.세부}  (${(100 * 비).toFixed(0)}%)`);
    // 이중선형이던 시절은 70~71% 였습니다. Catmull-Rom 5탭으로 77~81%.
    // 이 단언이 깨지면 재구성 필터가 이중선형으로 되돌아간 것입니다.
    ok(비 > 0.75, `태양 ${알트}° 배율 2도 이중선형보다 낫다 (${(100 * 비).toFixed(0)}%)`);
  }

  console.log('\n== 배율을 바꾼 직후 프레임이 멀쩡한가 ==');
  // 앱은 프레임 시간을 보고 배율을 실시간으로 바꿉니다. 렌더 타깃을 다시
  // 만드는 그 프레임이 검게 나오면 화면이 깜빡입니다.
  for (const t of stats.전환) {
    console.log(`  ${t.전환.padEnd(8)} 평균차 ${t.평균차}  (휘도 ${t.직후휘도} / ${t.안정휘도})`);
    ok(t.평균차 < 1.0, `${t.전환} 전환 직후가 안정 상태와 같다 (평균차 ${t.평균차})`);
    ok(t.직후휘도 > 10, `${t.전환} 전환 직후가 검지 않다 (휘도 ${t.직후휘도})`);
  }

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
