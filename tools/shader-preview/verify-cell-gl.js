/**
 * 셀 텍스처의 **GL 경로**를 검증합니다 (docs/CLOUD_TEXTURE_PLAN.md 1단계).
 *
 * `verify-cell-field.js`는 JS 배열만 봅니다. 그런데 1단계의 핵심 주장은
 * "축소해도 운량이 유지된다"이고, 그건 GPU가 우리 밉 체인을 실제로 쓰고
 * 삼선형 필터 보정이 맞을 때만 참입니다. 여기가 그걸 확인하는 자리입니다.
 *
 * 실제로 이 검사가 하나 잡았습니다: 레벨별 평활화만으로는 부족하고,
 * **필터가 업로드 이후에 분포를 다시 좁힙니다**(운량 0.15에서 -11.29%p).
 * `cell_threshold()`의 수축 보정이 그걸 되돌립니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-cell-gl-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-cell-gl.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

// 앱에서 실제로 일어나는 축소 범위. 시선 고도 8° 부근이 텍셀/픽셀 약 11이고,
// 그보다 아래는 대기 투시(계획 §3-E)가 구름을 지워 버립니다.
const REALISTIC_MAX_TPP = 12;
const BUDGET_REALISTIC = 0.02;  // ±2%p — 1단계 합격 기준
const BUDGET_EXTREME = 0.03;    // 지평선 극단은 ±3%p 까지 봐줍니다

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
  const p = await b.newPage({ viewport: { width: 1220, height: 900 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto('http://localhost:8123/cell-gl.html');
  await p.waitForTimeout(9000);

  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0, `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/SHADER_ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats) {
    console.log('\nFAILURES — __stats 가 없습니다. 페이지가 끝까지 실행되지 않았습니다.');
    process.exit(1);
  }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);

  console.log('\n== 밉 체인이 실제로 쓰이는가 ==');
  // 밉을 안 쓰면 축소해도 분포가 안 좁아집니다. 좁아졌다 = 필터가 돌았다.
  const sHigh = stats.수축률['32'].s;
  const sLow = stats.수축률['1'].s;
  ok(sLow > 0.95, `확대 쪽은 분포가 그대로 (s=${sLow})`);
  ok(sHigh < 0.85, `축소 쪽은 필터가 분포를 좁힘 (s=${sHigh})`);
  // 레벨별 평활화가 없으면 s가 계속 0으로 수렴합니다. 0.7 부근에서 멈추는 것이
  // 레벨마다 다시 편 것이 일하고 있다는 증거입니다.
  ok(sHigh > 0.6, `레벨별 재평활이 s를 붙잡고 있음 (s=${sHigh} > 0.6)`);

  console.log('\n== 운량 보존 (보정 후) ==');
  console.log('운량 │ 텍셀/픽셀 │  보정전 │  보정후 │ 예산 │ 판정');
  let worstReal = 0;
  let overBudget = 0;
  for (const r of stats.표) {
    const extreme = r.텍셀당픽셀 > REALISTIC_MAX_TPP;
    const budget = extreme ? BUDGET_EXTREME : BUDGET_REALISTIC;
    const err = Math.abs(r.보정후오차pp) / 100;
    if (!extreme) worstReal = Math.max(worstReal, err);
    const good = err <= budget;
    if (!good) overBudget++;
    console.log('%s │ %s │ %s%%p │ %s%%p │ %s%%p │ %s',
      r.운량.toFixed(2), String(r.텍셀당픽셀).padStart(9),
      (r.보정전오차pp >= 0 ? '+' : '') + r.보정전오차pp.toFixed(2).padStart(5),
      (r.보정후오차pp >= 0 ? '+' : '') + r.보정후오차pp.toFixed(2).padStart(5),
      (budget * 100).toFixed(0).padStart(3),
      good ? 'ok' : '초과');
  }
  ok(overBudget === 0, `모든 조건이 예산 안 (초과 ${overBudget}개)`);
  ok(worstReal <= BUDGET_REALISTIC,
    `실사용 범위(텍셀/픽셀 ≤ ${REALISTIC_MAX_TPP}) 오차 ≤ 2%p (최대 ${(worstReal * 100).toFixed(2)}%p)`);

  console.log('\n== 보정이 실제로 일하는가 ==');
  const worstBefore = Math.max(...stats.표.map(r => Math.abs(r.보정전오차pp))) / 100;
  const worstAfter = Math.max(...stats.표.map(r => Math.abs(r.보정후오차pp))) / 100;
  console.log('  보정 전 최악 %s%%p → 보정 후 %s%%p',
    (worstBefore * 100).toFixed(2), (worstAfter * 100).toFixed(2));
  ok(worstAfter < worstBefore * 0.6,
    `보정이 최악 오차를 절반 아래로 (${(worstBefore * 100).toFixed(2)} → ${(worstAfter * 100).toFixed(2)}%p)`);

  console.log('\n== 두 번 뽑기 (타일 반복 억제) ==');
  const worstOne = Math.max(...stats.표.map(r => Math.abs(r.한번뽑기오차pp))) / 100;
  console.log('  한 번 뽑기 최악 %s%%p · 두 번 뽑기 최악 %s%%p',
    (worstOne * 100).toFixed(2), (worstAfter * 100).toFixed(2));
  // 두 번 뽑아 섞으면 삼각분포가 되는데, 재평활을 빠뜨리면 여기서 크게 틀립니다.
  ok(worstAfter <= worstOne + 0.005,
    `삼각→균등 재평활이 운량 보장을 지킴 (${(worstAfter * 100).toFixed(2)}%p)`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
