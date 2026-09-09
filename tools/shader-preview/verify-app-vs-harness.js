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
  // ⚠ 이 판정만 goto 에 타임아웃을 안 걸고 기본값(30초)을 쓰고 있었습니다.
  //   페이지가 load 까지 38초가 걸리므로 **판정이 열리기도 전에 죽습니다.**
  //   기능이 쌓이며 페이지가 무거워져 그 선을 넘은 것이고, 넘은 뒤로는
  //   "무엇이 틀렸다"가 아니라 스택 트레이스만 남아 원인이 안 보였습니다.
  //   나머지 판정이 다 쓰는 방식(긴 타임아웃 + DONE:: 기다리기)으로 맞춥니다
  //   — 고정 95초 잠들기도 없애므로 일찍 끝나면 그만큼 빨라집니다.
  await p.goto(`${ORIGIN}/app-vs-harness.html`, { timeout: 300000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null,
    { timeout: 300000, polling: 500 }).catch(() => {});
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
  // ⚠ `startsWith` 로 고르면 '배율 1' 이 **'배율 1.5' 를 먼저** 잡습니다
  //    (CASES 순서상 1.5 가 앞). 처음 이 판정을 돌렸을 때 배율 1 자리에
  //    1.5 의 숫자(87%)가 들어와 거짓 실패가 났습니다. 정확히 일치시킵니다.
  const at = (알트, 조건) => R.find(r => r.태양고도 === 알트 && r.조건 === 조건);
  const SUNS = [25, 2, 0, -3];

  console.log('\n== 후처리가 색을 바꾸지 않는가 ==');
  for (const 알트 of SUNS) {
    const h = at(알트, '하네스(원해상도)'), a = at(알트, '앱 배율 2 (현행)');
    const d휘 = Math.abs(a.평균휘도 - h.평균휘도) / Math.max(1, h.평균휘도);
    const d채 = Math.abs(a.채도 - h.채도);
    console.log(`  태양 ${String(알트).padStart(3)}°  휘도 ${h.평균휘도} → ${a.평균휘도}` +
                `   채도 ${h.채도} → ${a.채도}   색상 ${h.색상각}° → ${a.색상각}°`);
    // 블룸이 밝은 곳을 들어 올리므로 휘도는 조금 오릅니다 — 그게 블룸이
    // 하는 일입니다. 한낮(+25°)이 가장 밝아 그 효과도 가장 크고(3.0%),
    // 노을·박명은 0.1~0.4% 입니다. 4%를 넘으면 그건 블룸이 아니라
    // 합성 경로가 색을 바꾸고 있다는 뜻입니다.
    ok(d휘 < 0.04, `태양 ${알트}° 휘도가 유지된다 (${(100 * d휘).toFixed(1)}%)`);
    ok(d채 < 0.01, `태양 ${알트}° 채도가 유지된다 (${d채.toFixed(3)})`);
  }

  console.log('\n== 배율 1이면 하네스와 같은 선명도인가 ==');
  for (const 알트 of SUNS) {
    const h = at(알트, '하네스(원해상도)'), one = at(알트, '배율 1 (합성만)');
    const 비 = one.세부 / h.세부;
    console.log(`  태양 ${String(알트).padStart(3)}°  세부 ${h.세부} → ${one.세부}  (${(100 * 비).toFixed(0)}%)`);
    ok(비 > 0.95, `태양 ${알트}° 배율 1은 하네스와 같다 (${(100 * 비).toFixed(0)}%)`);
  }

  console.log('\n== 배율 2에서도 재구성 필터가 일하는가 ==');
  for (const 알트 of SUNS) {
    const h = at(알트, '하네스(원해상도)'), two = at(알트, '앱 배율 2 (현행)');
    const 비 = two.세부 / h.세부;
    console.log(`  태양 ${String(알트).padStart(3)}°  세부 ${h.세부} → ${two.세부}  (${(100 * 비).toFixed(0)}%)`);
    // 절대값(75~80%)은 셰이더의 주파수 성분이 바뀔 때마다 움직입니다 —
    // 경사 광로를 넣자 지평선 쪽 세부가 늘어 -3° 칸이 78%에서 75%로
    // 내려갔습니다. 그건 회귀가 아닙니다. 지켜야 하는 것은 **재구성
    // 필터가 아직 카트멀롬이라는 것** 하나뿐이라, 같은 프레임에서 잰
    // 이중선형과 견줍니다. 상수가 없으니 낡을 것도 없습니다.
    const bi = at(알트, '배율 2 이중선형');
    const 이득 = two.세부 / bi.세부;
    console.log(`      이중선형 ${bi.세부} → 카트멀롬 ${two.세부}  (+${(100 * (이득 - 1)).toFixed(0)}%)`);
    ok(이득 > 1.04, `태양 ${알트}° 배율 2가 이중선형보다 세부를 살린다 (+${(100 * (이득 - 1)).toFixed(0)}%)`);
    ok(비 > 0.65, `태양 ${알트}° 배율 2가 하네스 세부를 크게 잃지 않는다 (${(100 * 비).toFixed(0)}%)`);
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
