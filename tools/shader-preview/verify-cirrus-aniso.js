/**
 * 6단계 합격 판정 (docs/CLOUD_TEXTURE_PLAN.md).
 *
 * 권운 조각이 바람 방향으로 길쭉해졌는지를 **렌더된 픽셀**에서 확인합니다.
 * 셰이더 식을 옮겨 적어 검산하면 배선이 끊겨 있어도 통과하므로,
 * `CloudDeck.ts`를 그대로 임포트해 만든 씬을 읽습니다.
 *
 * 판정:
 *  - 권운: 바람을 90° 돌리면 화면 방향별 기울기 비(Gx/Gy)가 크게 뒤집힌다.
 *  - 권적운(등방, cellAspect = 1): 같은 회전에도 비가 거의 그대로다.
 *    (대조군 — 없으면 "회전했더니 뭔가 달라졌다"가 이방성 때문인지
 *     그냥 다른 무늬가 걸린 것인지 구분할 수 없습니다.)
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-cirrus-aniso-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-cirrus-aniso.js
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
  const p = await b.newPage({ viewport: { width: 840, height: 840 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto('http://localhost:8123/cirrus-aniso.html');
  await p.waitForTimeout(12000);

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

  console.log('\n== 프리셋 종횡비 ==');
  console.log('  권운 cellAspect = %s, 권적운 cellAspect = %s',
    stats.프리셋.권운, stats.프리셋.권적운);
  // 위쪽 한계가 있는 이유: 이 배율은 무늬의 **모든 옥타브**에 한꺼번에
  // 걸립니다. 낙하줄 하나의 물리 비율 20을 그대로 주면 낱개 줄뿐 아니라
  // 줄이 모여 이루는 큰 덩어리까지 20배로 늘어나 필라멘트가 아니라
  // 끊기지 않는 블라인드가 됩니다 (종횡비 훑기 렌더에서 6부터 리본).
  // 그래서 "1보다 크다"만으로는 부족하고 위쪽도 막아야 합니다.
  ok(stats.프리셋.권운 > 1 && stats.프리셋.권운 <= 5,
    `권운이 이방성이되 블라인드가 되진 않음 (1 < aspect ${stats.프리셋.권운} ≤ 5)`);
  ok(stats.프리셋.권적운 === 1, `권적운이 등방 대조군 (aspect ${stats.프리셋.권적운})`);

  const show = (name, s) => {
    console.log('  %s  바람 0°: Gx=%s Gy=%s 비=%s (운량 %s)',
      name, s.바람0.Gx.toFixed(5), s.바람0.Gy.toFixed(5),
      s.바람0.비.toFixed(3), s.바람0.운량.toFixed(3));
    console.log('  %s  바람 90°: Gx=%s Gy=%s 비=%s (운량 %s)',
      name, s.바람90.Gx.toFixed(5), s.바람90.Gy.toFixed(5),
      s.바람90.비.toFixed(3), s.바람90.운량.toFixed(3));
    console.log('  %s  비의비 = %s', name, s.비의비.toFixed(3));
  };

  console.log('\n== 권운 (이방성) ==');
  show('권운', stats.권운);
  console.log('\n== 권적운 (등방 대조군) ==');
  show('권적운', stats.권적운);

  // 무늬가 아예 안 걸리면 기울기가 0에 수렴해 비가 아무 의미 없어집니다.
  // 실제로 결이 보이는지 먼저 확인합니다.
  const 결있음 = stats.권운.바람0.Gx > 1e-3 && stats.권운.바람0.Gy > 1e-3;
  ok(결있음, '권운 컷에 실제로 무늬가 보임 (기울기 > 1e-3)');
  ok(stats.권운.바람0.운량 > 0.05 && stats.권운.바람0.운량 < 0.95,
    `권운 화면 운량이 포화되지 않음 (${stats.권운.바람0.운량.toFixed(3)})`);

  console.log('\n== 판정 ==');
  const cir = stats.권운.비의비;
  const cc = stats.권적운.비의비;
  // 비의비가 1에서 얼마나 벌어졌나 — 1보다 크든 작든 같은 크기로 봅니다.
  const 권운흔들림 = Math.max(cir, 1 / cir);
  const 권적운흔들림 = Math.max(cc, 1 / cc);
  console.log('  권운 흔들림 ×%s, 권적운 흔들림 ×%s',
    권운흔들림.toFixed(3), 권적운흔들림.toFixed(3));

  ok(권운흔들림 >= 1.5,
    `권운은 바람을 90° 돌리면 결 방향이 바뀜 (×${권운흔들림.toFixed(2)} ≥ 1.5)`);
  ok(권적운흔들림 <= 1.15,
    `권적운(등방)은 바람에 무반응 (×${권적운흔들림.toFixed(3)} ≤ 1.15)`);
  ok(권운흔들림 > 권적운흔들림 * 1.5,
    '권운의 방향 반응이 등방 대조군보다 뚜렷함');

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
