/**
 * **거리대별 능선과 대기 투시** (docs/GROUND_PLAN.md 3단계).
 *
 * 두 가지를 봅니다.
 *
 * 1. **지형이 화면에 나오는가.** 예전 지형 링은 `side: THREE.FrontSide` 였고,
 *    이 링은 관측자를 둘러싼 원통이라 항상 안쪽에서 봅니다. 감김 방향상
 *    안쪽이 뒷면이라 **통째로 컬링돼 한 번도 안 나왔습니다.** 검은 배경에
 *    지형만 그려 픽셀을 세면 0이었습니다. 지면 원반이 그리기 순서 때문에
 *    안 보이던 것과 같은 종류라, 같은 방식(단독으로 그려 세기)으로 막습니다.
 *
 * 2. **먼 능선일수록 하늘색에 가까운가.** 이게 3단계의 주장 전부입니다.
 *    거리대를 하나씩만 그린 컷과 하늘만 그린 컷의 색 차이를 재면 그대로
 *    검증됩니다 — 멀수록 차이가 작아야 합니다.
 *
 * ⚠ 지평선 **위만** 재야 합니다. 띠는 셋 다 지평선 아래까지 내려오므로 전체를
 * 재면 지평선 아래가 측정을 지배해 거리 순서가 거꾸로 나옵니다 (실측: 그렇게
 * 하면 40km가 가장 대비 높음).
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-terrain-ab-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-terrain-bands.js
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
  const p = await b.newPage({ viewport: { width: 1400, height: 460 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto('http://localhost:8123/terrain-ab.html');
  await p.waitForTimeout(15000);

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

  console.log('\n== 입력 지형 ==');
  console.log('  거리대별 최고각:',
    stats.거리대별입력최고각.map(x => `${x.거리km}km ${x.최고각}°`).join('  '));
  // 각도가 아니라 높이에서 나와야 합니다. 40km에 8°(=6.3km 산) 같은 값이
  // 들어가면 대기 투시 검사가 의미를 잃습니다.
  const far = stats.거리대별입력최고각.find(x => x.거리km === 40);
  ok(far && far.최고각 < 4,
    `먼 거리대 각도가 물리적임 (40km에서 ${far.최고각}° — 1600m 산이 2.3°)`);

  console.log('\n== 지형이 실제로 그려지는가 ==');
  console.log(`  검은 배경에 지형만 — 출하 ${stats.검은배경_출하만_픽셀}px, ` +
    `컬링 고침 ${stats.검은배경_예전만_픽셀}px, 지금 ${stats.검은배경_지금만_픽셀}px`);
  ok(stats.검은배경_출하만_픽셀 === 0,
    `출하 상태(FrontSide)는 실제로 0픽셀 — 한 번도 안 보였음을 재현`);
  ok(stats.검은배경_지금만_픽셀 > 10000,
    `지금은 그려짐 (${stats.검은배경_지금만_픽셀}px)`);

  console.log('\n== 대기 투시 — 멀수록 하늘색에 가까움 ==');
  const byDist = [...stats.거리대별_하늘대비].sort((a, b) => a.거리km - b.거리km);
  for (const x of byDist) {
    console.log(`  ${String(x.거리km).padStart(3)}km  하늘 대비 ${String(x.평균대비).padStart(6)}  (${x.픽셀}px)`);
  }
  ok(byDist.every(x => x.픽셀 > 500),
    `거리대마다 잴 만큼 픽셀이 있음 (최소 ${Math.min(...byDist.map(x => x.픽셀))}px)`);

  // 핵심 단언: 단조 감소.
  let monotone = true;
  for (let i = 1; i < byDist.length; i++) {
    if (byDist[i].평균대비 >= byDist[i - 1].평균대비) monotone = false;
  }
  ok(monotone,
    `거리가 멀수록 대비가 작아짐 (${byDist.map(x => x.평균대비).join(' → ')})`);

  const near = byDist[0].평균대비, farC = byDist[byDist.length - 1].평균대비;
  ok(near > farC * 3,
    `가까운 능선이 먼 능선보다 3배 이상 뚜렷 (${(near / Math.max(0.1, farC)).toFixed(1)}배)`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
