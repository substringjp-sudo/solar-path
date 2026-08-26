/**
 * **구름이 구름에 드리우는 그림자** 합격 판정
 * (docs/CLOUD_VARIETY_PLAN.md 4단계).
 *
 * 중층 운량을 어디나 45%로 같게 두고 **상층만** 서쪽 절반을 덮습니다.
 * 중층 운량이 같으니 화면 차이는 오직 "위에 뭐가 있느냐"에서 옵니다.
 *
 * 두 번 렌더합니다 — 관측점 수직 기둥에서 구한 배율 하나를 하늘 전체에
 * 곱하는 예전 경로, 그리고 방향마다 다시 푸는 4단계 경로.
 *
 * ⚠ **저층으로 재면 안 됩니다.** 저층은 고도 1.5km라 보이는 지상 범위가
 * 25km쯤인데, 상층(10km)까지의 그늘 displacement가 태양 25°에서 이미
 * 20km입니다. 화면 왼쪽 끝과 오른쪽 끝이 거의 같은 지점의 상층을 보게 되어
 * 좌우가 갈리지 않습니다 (실측 동−서 3.5). 중층(4.5km)은 보이는 범위 70km에
 * displacement 10km라 그늘 경계가 화면 안을 지납니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-cloud-shadow-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-cloud-shadow.js
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
  await p.goto('http://localhost:8123/cloud-shadow.html');
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

  console.log('\n== 배율 자체 ==');
  const S = stats.배율;
  console.log(`  방향별 ${S.최소} ~ ${S.최대} (평균 ${S.평균})   전역 하나였을 때 ${S.전역}`);
  ok(S.최소 < 0.1, `완전히 그늘인 방향이 있음 (${S.최소})`);
  ok(S.최대 > 0.9, `전혀 안 가린 방향도 있음 (${S.최대})`);
  // 전역 값 하나로는 이 폭을 표현할 방법이 없습니다 — 그게 4단계의 요점입니다.
  ok(S.최대 / Math.max(1e-4, S.최소) > 20,
    `한 하늘 안에서 직달광이 ${(S.최대 / S.최소).toFixed(0)}배 차이`);

  const 이전 = stats.기둥하나, 이후 = stats.방향별;
  console.log('\n== 화면 ==');
  console.log(`  기둥 하나  서(위에 상층) ${이전.서쪽.밝기}  동(위가 빔) ${이전.동쪽.밝기}`);
  console.log(`  방향별     서(위에 상층) ${이후.서쪽.밝기}  동(위가 빔) ${이후.동쪽.밝기}`);

  // 통제: 중층 운량은 두 경로가 같아야 합니다. 다르면 그림자가 아니라
  // 구름 양이 바뀐 것이고, 그건 4단계가 할 일이 아닙니다.
  const dW = Math.abs(이전.서쪽.운량 - 이후.서쪽.운량);
  const dE = Math.abs(이전.동쪽.운량 - 이후.동쪽.운량);
  ok(dW < 0.005 && dE < 0.005,
    `중층 운량은 두 경로가 동일 (≤${(Math.max(dW, dE) * 100).toFixed(2)}%p)`);

  const 전 = 이전.동쪽.밝기 - 이전.서쪽.밝기;
  const 후 = 이후.동쪽.밝기 - 이후.서쪽.밝기;
  console.log(`  동 − 서 밝기차 ${전.toFixed(1)} → ${후.toFixed(1)}`);
  ok(Math.abs(전) < 5, `기둥 하나로는 좌우가 갈리지 않음 (${전.toFixed(1)})`);
  ok(후 > 10, `이제 위가 빈 쪽이 밝음 (${후.toFixed(1)})`);

  // **어느 쪽이 움직였는가.** 전역 배율은 서쪽(가려진 쪽)에 맞춰져 있었으므로,
  // 고쳐진 것은 "동쪽이 억울하게 어두웠던 것"입니다. 부호까지 봐야
  // "구름이 그림자를 드리운다"와 "그냥 한쪽을 어둡게 칠했다"가 구분됩니다.
  const 동변화 = 이후.동쪽.밝기 - 이전.동쪽.밝기;
  const 서변화 = 이후.서쪽.밝기 - 이전.서쪽.밝기;
  console.log(`  같은 방향의 변화 — 동 ${동변화 > 0 ? '+' : ''}${동변화.toFixed(1)}, 서 ${서변화 > 0 ? '+' : ''}${서변화.toFixed(1)}`);
  ok(동변화 > 10, `위가 빈 동쪽이 밝아짐 (${동변화.toFixed(1)})`);
  ok(Math.abs(서변화) < 6, `위가 덮인 서쪽은 그대로 (${서변화.toFixed(1)})`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
