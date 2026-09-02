/**
 * **노을 대비** 합격 판정 — `sunset-gap.html` 을 잽니다.
 *
 * 왜 필요한가: `verify-cloud-slab.js` 의 채도만으로는 이 그림이 안 지켜집니다.
 * 실제로 채도가 통과하는 동안 명암폭이 124 → 28 로 4.4배 무너졌고, 그게
 * "지평선쪽만 빛나고, 구름 틈으로 하늘이 보이고, 반대편에 그림자가 지는"
 * 세 가지가 사라진 정체였습니다. 셋 다 **대비** 현상이라 평균 채도에
 * 안 잡힙니다.
 *
 * 그래서 지표 셋을 씁니다:
 *  - 세로기울기 = 천정 밝기 ÷ 지평선 바로 위 밝기. 작을수록 지평선만 탑니다.
 *  - 명암폭 = 하늘 화소 휘도의 p90 - p10.
 *  - 색상변화 = 색 있는 화소의 색상각 원형 표준편차.
 *
 * 기준선은 PR #14 슬랩(사용자가 "감동했다"고 한 그림)을 같은 페이지에서
 * 같이 그려 둔 값입니다 — 절대 숫자가 아니라 **그 그림과의 거리**로 봅니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-sunset-gap.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-sunset-gap.js
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
  const p = await b.newPage({ viewport: { width: 1400, height: 760 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(`${ORIGIN}/sunset-gap.html`);
  await p.waitForTimeout(40000);
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

  console.log('\n== 지평선만 타는가 (세로기울기 = 천정 ÷ 지평선) ==');
  for (const 알트 of [0, -3]) {
    const 기준 = at(알트, 'PR #14');
    const 지금 = at(알트, '수정 후');
    console.log(`  태양 ${알트}°  PR #14 ${기준.세로기울기}  →  지금 ${지금.세로기울기}`);
    // 1.0 = 하늘이 고르게 밝음(노을이 아니라 밝은 흐린 날). 고치기 전에는
    // 0.967 / 0.847 이었습니다.
    ok(지금.세로기울기 < 0.80, `태양 ${알트}° 천정이 지평선보다 뚜렷이 어둡다 (${지금.세로기울기})`);
  }

  console.log('\n== 틈과 그림자가 살아 있는가 (명암폭) ==');
  for (const [알트, 바닥] of [[0, 80], [-3, 90]]) {
    const 기준 = at(알트, 'PR #14');
    const 지금 = at(알트, '수정 후');
    console.log(`  태양 ${알트}°  PR #14 ${기준.명암폭}  →  지금 ${지금.명암폭}`);
    // 고치기 전: 30.5 / 63.0.
    ok(지금.명암폭 > 바닥, `태양 ${알트}° 명암폭이 살아 있다 (${지금.명암폭} > ${바닥})`);
  }

  console.log('\n== 여러 색이 한 화면에 있는가 (색상변화) ==');
  {
    const 기준 = at(-3, 'PR #14'), 지금 = at(-3, '수정 후');
    console.log(`  태양 -3°  PR #14 ${기준.색상변화}°  →  지금 ${지금.색상변화}°`);
    // "은은하게 보라색으로 물들고" 는 평균 채도가 아니라 분홍·보라·파랑이
    // 같이 있는 것입니다. 고치기 전 37.9°.
    ok(지금.색상변화 > 50, `태양 -3° 분홍·보라·파랑이 같이 있다 (${지금.색상변화}°)`);
  }

  console.log('\n== 체적 스텝 수 — 두 지표가 반대로 움직인다 ==');
  for (const 알트 of [0, -3]) {
    const 하나 = at(알트, '수정 후');
    const 셋 = at(알트, '3스텝');
    console.log(`  태양 ${알트}°  1스텝 명암폭 ${하나.명암폭} 기울기 ${하나.세로기울기}` +
                `   |   3스텝 명암폭 ${셋.명암폭} 기울기 ${셋.세로기울기}`);
    // ⚠ **한 번 뒤집혔다가 다시 돌아온 자리**입니다. 이력을 남겨 둡니다.
    //
    // (1) 처음엔 "1스텝이 3스텝보다 명암폭이 크다"였습니다. 그때는 비스듬
    //     경로 항이 없어 지평선 구름이 천정과 같은 광학두께였고, 스텝을
    //     나눠 봐야 같은 값을 세 번 겹치는 셈이라 틈만 메웠습니다.
    // (2) 비스듬 경로를 넣자 명암폭 관계가 뒤집혔습니다 (95.8 → 107.8).
    //     지평선 광학두께가 최대 38배로 커지니 그걸 나눌 값어치가 생긴 것입니다.
    // (3) 그런데 **세로기울기는 크게 나빠집니다** (0.667 → 0.846). 하늘이
    //     다시 고르게 밝아집니다.
    //
    // 그래서 지표를 명암폭이 아니라 **세로기울기**로 바꿔 답니다. 그것이
    // "지평선쪽만 빛나면서" 를 직접 재는 값이고 계획 1절이 첫 번째로 꼽은
    // 광학이라, 명암폭 12% 와 바꿀 것이 아닙니다.
    ok(하나.세로기울기 < 셋.세로기울기 * 0.9,
      `태양 ${알트}° 1스텝이 지평선 집중이 강하다 (${하나.세로기울기} vs ${셋.세로기울기})`);
  }

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
