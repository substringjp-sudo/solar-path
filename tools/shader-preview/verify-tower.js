/**
 * **수직 발달 — 다양한 크기** 합격 판정 (docs/CLOUD_VARIETY_PLAN.md 5단계).
 *
 * 예전에는 빌보드 각크기가 상수였습니다 — 저층 14° × 0.75~1.25, 즉 10.5~17.5°
 * (`BILLBOARD_ANGULAR_DEG`, 코드에서 확인 가능한 사실입니다). 40km 밖 적운과
 * 5km 앞 적운이 화면에서 같은 크기였다는 뜻입니다. 그리고 적운 템플릿 다섯
 * 개가 전부 가로가 긴 판(종횡비 2.3~5.6)이라 솟은 탑이 나올 방법이 없었습니다.
 *
 * 세 가지를 봅니다:
 *
 *  1. **밑면** — 응결고도(Espy)에서 나오는가. 습도가 다르면 달라지고,
 *     **같은 하늘 안에서는 하나**여야 합니다 (적운 밑면이 나란한 이유).
 *  2. **크기** — 같은 하늘 안에서 거리에 따라 갈리는가.
 *  3. **모양** — 대류가 강하면 세로로 긴 실루엣이 나오는가.
 *
 * 세로 조명 기울기는 **태양이 구름보다 위에 있을 때만** 생깁니다. 태양이
 * 구름과 같은 고도이고 카메라가 태양 방위를 보면 역광이라 기울기가 없는
 * 것이 맞습니다 — 그래서 두 태양 고도를 다 재고 **둘 다** 확인합니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-tower-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-tower.js
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
  const p = await b.newPage({ viewport: { width: 1650, height: 520 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto('http://localhost:8123/tower.html');
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

  const 약 = stats.약한대류, 강 = stats.강한대류, 높 = stats.강한대류_높은태양;
  const gA = 약.기하, gB = 강.기하;
  if (!gA || !gB) {
    console.log('\nFAILURES — 빌보드가 하나도 안 나왔습니다.');
    process.exit(1);
  }

  console.log('\n== 밑면 — 응결고도 ==');
  console.log(`  약한 대류(습도 55%) ${gA.밑면고도.최소}~${gA.밑면고도.최대} km`);
  console.log(`  강한 대류(습도 88%) ${gB.밑면고도.최소}~${gB.밑면고도.최대} km`);
  // Espy: LCL[km] ≈ (100 − RH)/40 → 55% 에서 1.125, 88% 에서 0.30
  ok(Math.abs(gA.밑면고도.최소 - 1.125) < 0.02,
    `습도 55% → 밑면 1.125km (Espy)`);
  ok(Math.abs(gB.밑면고도.최소 - 0.30) < 0.02,
    `습도 88% → 밑면 0.30km — 습할수록 낮게`);
  // **한 하늘 안에서는 하나.** 이게 적운 밑면이 자로 그은 듯 나란한 이유입니다.
  ok(gA.밑면고도.최대 - gA.밑면고도.최소 < 1e-6 &&
     gB.밑면고도.최대 - gB.밑면고도.최소 < 1e-6,
    `같은 하늘의 밑면은 방향이 달라도 하나 — 평평한 밑면`);

  console.log('\n== 크기 — 거리에 따라 갈리는가 ==');
  const 폭 = (g) => g.각크기.최대 / Math.max(0.01, g.각크기.최소);
  console.log(`  약한 대류 ${gA.각크기.최소}~${gA.각크기.최대}° (×${폭(gA).toFixed(1)})`);
  console.log(`  강한 대류 ${gB.각크기.최소}~${gB.각크기.최대}° (×${폭(gB).toFixed(1)})`);
  // 예전 상수 배치는 10.5~17.5°, 즉 ×1.67 이었습니다.
  ok(폭(gA) > 5,
    `한 하늘 안에서 각크기가 ${폭(gA).toFixed(1)}배 갈림 (예전 상수 배치는 ×1.67)`);
  ok(gA.각크기.최대 <= 40.001 && gB.각크기.최대 <= 40.001,
    `상한을 넘지 않음 — 빌보드 한 장이 화면을 덮지 않음`);

  console.log('\n== 모양 — 대류가 강하면 솟는가 ==');
  console.log(`  종횡비 중앙  약한 ${gA.종횡비.중앙}  강한 ${gB.종횡비.중앙}`);
  console.log(`  운정 고도    약한 ${gA.운정고도.최소}~${gA.운정고도.최대} km  강한 ${gB.운정고도.최소}~${gB.운정고도.최대} km`);
  ok(gA.종횡비.중앙 > 2,
    `약한 대류는 넓적함 (종횡비 ${gA.종횡비.중앙})`);
  ok(gB.종횡비.중앙 < 1,
    `강한 대류는 **세로로 김** — 탑형 실루엣 (종횡비 ${gB.종횡비.중앙})`);
  ok(gB.운정고도.최소 > gA.운정고도.최대,
    `운정이 실제로 자람 (${gA.운정고도.최대} → ${gB.운정고도.최소} km)`);

  console.log('\n== 세로 조명 기울기 ==');
  console.log(`  태양 18° (역광) 꼭대기/밑동 ${강.세로대비}`);
  console.log(`  태양 45°        꼭대기/밑동 ${높.세로대비}`);
  ok(높.세로대비 > 1.10,
    `태양이 위에 있으면 꼭대기가 밝음 (${높.세로대비})`);
  // 역광에서 기울기가 없는 것이 **맞습니다.** 이걸 확인하지 않으면
  // "어쨌든 위가 밝다"는 상수 효과와 구분되지 않습니다.
  ok(강.세로대비 < 1.05,
    `역광에서는 기울기가 없음 — 조명 축이 태양을 따라감 (${강.세로대비})`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
