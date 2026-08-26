/**
 * **방향별 기상이 운형까지 가는가** 합격 판정
 * (docs/CLOUD_VARIETY_PLAN.md 3단계).
 *
 * 저층 운량을 **어디나 80%로 같게** 두고 서쪽에만 비를 줍니다. 운량이 같으니
 * 화면 차이는 오직 강수에서 옵니다 — 이 통제가 없으면 "구름이 더 많아서
 * 어두운 것"과 구분되지 않습니다. 실제로 이 하네스의 가장 중요한 단언은
 * 밝기 차이가 아니라 **운량이 안 바뀌었다**는 쪽입니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-rain-split-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-rain-split.js
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
  const p = await b.newPage({ viewport: { width: 1200, height: 520 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto('http://localhost:8123/rain-split.html');
  await p.waitForTimeout(14000);

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

  console.log('\n== 강수가 방향별로 실려 왔는가 ==');
  const J = stats.판정;
  console.log(`  ${J.방향수}방향  강수 ${J.강수최소} ~ ${J.강수최대} mm/h`);
  console.log(`  운형 ${JSON.stringify(J.분포)}`);
  // 이게 0이면 강수가 팬에서 표본까지 오지 않은 것이고, 아래 밝기 차이는
  // 전부 우연입니다.
  ok(J.강수최대 > 1.0,
    `방향별 강수가 표본까지 도달 (최대 ${J.강수최대} mm/h)`);
  ok(J.강수최소 < 0.1,
    `반대쪽은 여전히 0 — 관측점 값으로 뭉개지지 않음 (${J.강수최소})`);
  const ns = J.분포.Nimbostratus ?? 0;
  ok(ns > 30 && ns < J.방향수 * 0.7,
    `비 오는 쪽만 난층운 (${ns}/${J.방향수}방향)`);

  const 관측점 = stats.관측점, 방향별 = stats.방향별;
  console.log('\n== 화면 ==');
  console.log(`  관측점 값  서(비) ${관측점.서쪽.밝기}  동(맑음) ${관측점.동쪽.밝기}`);
  console.log(`  방향별     서(비) ${방향별.서쪽.밝기}  동(맑음) ${방향별.동쪽.밝기}`);

  // ── 통제: 운량은 바뀌면 안 됩니다 ────────────────────────────────────
  const dW = Math.abs(관측점.서쪽.운량 - 방향별.서쪽.운량);
  const dE = Math.abs(관측점.동쪽.운량 - 방향별.동쪽.운량);
  console.log(`  운량 변화 — 서 ${(dW * 100).toFixed(2)}%p, 동 ${(dE * 100).toFixed(2)}%p`);
  ok(dW < 0.02 && dE < 0.02,
    `운형이 바뀌어도 예보 운량은 그대로 (≤${(Math.max(dW, dE) * 100).toFixed(2)}%p)`);

  // 관측점 값만 쓰면 양쪽이 같은 운형이라 밝기가 거의 안 갈립니다.
  // (남는 차이는 운량 차 — 서 59% vs 동 66%.)
  const 이전차 = 관측점.동쪽.밝기 - 관측점.서쪽.밝기;
  const 이후차 = 방향별.동쪽.밝기 - 방향별.서쪽.밝기;
  console.log(`  동 − 서 밝기차 ${이전차.toFixed(1)} → ${이후차.toFixed(1)}`);
  ok(Math.abs(이전차) < 12,
    `이전에는 비가 와도 화면이 갈리지 않았음 (${이전차.toFixed(1)})`);
  ok(이후차 > 15,
    `이제 비 오는 쪽이 뚜렷이 어두움 (${이후차.toFixed(1)})`);

  // 어두워진 쪽이 실제로 **비 오는 쪽**이어야 합니다. 부호를 안 보면
  // "어딘가 갈렸다"까지만 말할 수 있습니다.
  const 서변화 = 관측점.서쪽.밝기 - 방향별.서쪽.밝기;
  const 동변화 = 관측점.동쪽.밝기 - 방향별.동쪽.밝기;
  console.log(`  같은 방향의 변화 — 서 ${서변화.toFixed(1)} 어두워짐, 동 ${동변화.toFixed(1)}`);
  ok(서변화 > 25, `비 오는 서쪽이 난층운으로 내려앉음 (${서변화.toFixed(1)})`);
  ok(Math.abs(동변화) < 8, `맑은 동쪽은 거의 그대로 (${동변화.toFixed(1)})`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
