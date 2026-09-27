/**
 * **층별 바람 이류** 합격 판정 — `wind-drift.html` 을 잽니다.
 *
 * 왜 이걸 재는가: 바람은 "값이 들어왔다"로는 검증이 안 됩니다. 파이프가
 * 어딘가에서 끊겨도 uniform 은 조용히 0으로 남고 그림은 멀쩡해 보입니다.
 * 그래서 **픽셀이 실제로 얼마나, 어느 쪽으로 움직였는지**를 잽니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-wind-drift.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-wind-drift.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

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
  const p = await b.newPage({ viewport: { width: 1740, height: 520 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  // 모든 판을 load 전에 그리므로(module 스크립트) 판이 늘면 load 가 늦습니다.
  await p.goto(`${ORIGIN}/wind-drift.html`, { timeout: 180000 });
  await p.waitForTimeout(30000);

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

  const R = stats.결과;

  console.log('\n== 무풍이면 시간이 흘러도 그대로인가 ==');
  console.log(`  무풍 1시간 뒤 평균 휘도차 ${R.무풍_1시간_차이}`);
  ok(R.무풍_1시간_차이 === 0,
    `속도 0이면 이류도 0 (${R.무풍_1시간_차이})`);

  console.log('\n== uniform 이 그 층에만 걸리는가 ==');
  const X = R.층교차, F = R.층흐름 || {};
  for (const k of Object.keys(X)) console.log(`  ${k.padEnd(20)} 모양+흐름 ${X[k]}  흐름 ${F[k]}`);
  // §109 — 상층 모양은 시어(상층풍 − 중층풍)를 따르므로 중층풍이 상층 **모양**을 바꾸는 것은 설계입니다.
  // 그 한 칸만 "모양" 에서 빼고, 모든 칸의 **흐름**(같은 바람에서 시간만 흘린 차)은 0 이어야 합니다.
  const SHEAR = 'high운량_mid풍';
  for (const L of ['low', 'mid', 'high']) {
    ok(X[`${L}운량_${L}풍`] > 0.5,
      `${L} 층 바람이 ${L} 층을 움직인다 (${X[`${L}운량_${L}풍`]})`);
    for (const O of ['low', 'mid', 'high']) {
      if (O === L) continue;
      const k = `${L}운량_${O}풍`;
      // 다른 층 바람은 이 층 구름을 **한 픽셀도** 흘리지 않아야 합니다.
      // 여기가 새면 세 uniform 이 사실상 하나로 묶여 있다는 뜻입니다.
      ok(F[k] === 0, `${O} 층 바람은 ${L} 층을 흘리지 않는다 (${F[k]})`);
      if (k !== SHEAR) ok(X[k] === 0, `${O} 층 바람은 ${L} 층 모양도 안 바꾼다 (${X[k]})`);
    }
  }
  console.log(`  참고 — §109 시어: 중층풍만 불면 상층 줄무늬 모양이 바뀐다 (${X[SHEAR]})`);

  console.log('\n== 이동량이 풍속에 비례하는가 ==');
  const M = R.이동px;
  console.log(`  서풍 10 / 20 / 40 km/h → ${M.서풍10} / ${M.서풍20} / ${M.서풍40} px`);
  console.log(`  비율 20:10 = ${R.속도비['20대10']},  40:10 = ${R.속도비['40대10']}`);
  ok(Math.abs(M.서풍10) > 4, `가장 약한 바람도 측정 가능한 크기 (${M.서풍10}px)`);
  // ±12% — 화면 세로 방향으로 지상 거리가 조금씩 달라지므로 완전한 강체
  // 평행이동은 아닙니다. 그 폭이 이 정도입니다.
  // §117.5 — 80줄 띠를 한 값으로 뭉친 비는 참고로만 둡니다. 그 띠 안에서 이동량이 1.6배 달라
  // 대비가 센 행 쪽으로 끌립니다(조명만 바뀐 §104 에서 4.21 → 5.29, 띠별 이동은 그대로).
  // 문턱은 그대로 두고 좁은 두 띠에서 각각 잽니다.
  console.log(`  참고 — 80줄 한 값: 20:10 = ${R.속도비['20대10']}, 40:10 = ${R.속도비['40대10']}`);
  const NB = R.좁은띠속도비 || {};
  ok(Object.keys(NB).length === 2, `좁은 띠 두 개를 쟀다 (${Object.keys(NB).length})`);
  for (const k of Object.keys(NB)) {
    const b = NB[k];
    console.log(`  ${k}: 10 / 20 / 40 km/h → ${b.px.join(' / ')} px`);
    ok(Math.abs(b['20대10'] - 2) < 0.24, `${k}: 두 배 바람은 두 배 이동 (${b['20대10']})`);
    ok(Math.abs(b['40대10'] - 4) < 0.48, `${k}: 네 배 바람은 네 배 이동 (${b['40대10']})`);
  }

  console.log('\n== 이동 방향이 맞는가 ==');
  console.log(`  서풍 20 → ${M.서풍20}px,  동풍 20 → ${M.동풍20}px`);
  // 북쪽을 보고 있으므로 화면 오른쪽이 동쪽입니다. 서풍(방위 270° =
  // 서쪽에서 불어옴)이면 구름은 동쪽 = 오른쪽으로 흘러야 합니다.
  ok(M.서풍20 > 0, `서풍이면 구름이 동쪽(오른쪽)으로 흐른다 (${M.서풍20}px)`);
  ok(M.동풍20 < 0, `동풍이면 반대로 흐른다 (${M.동풍20}px)`);
  ok(Math.abs(M.서풍20 + M.동풍20) < Math.abs(M.서풍20) * 0.2,
    `같은 속도면 크기가 같다 (${M.서풍20} vs ${M.동풍20})`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
