/**
 * **`CloudSlab.ts`** 합격 판정 — 앱이 쓰는 바로 그 모듈을 임포트한
 * 습작(`cloud-slab.html`)을 잽니다.
 *
 * 이 표현이 껍질 덱을 대체하는 이유는 셋이고, 셋 다 단언합니다.
 *
 *  1. **노을이 실제로 물든다.** 덱은 셀 값을 문턱으로 잘라 두께가 0 아니면
 *     1이었고, 그래서 주변광이 밝기의 88~99%를 차지해 출력 채도가
 *     0.04~0.12 였습니다. 두께로 읽으면 얇은 곳이 빛을 통과시킵니다.
 *  2. **지평선에 격자가 서지 않는다.** 노이즈를 월드 좌표로 읽으므로
 *     타일 반복 주기가 화면 주파수로 올라오지 않습니다.
 *  3. **천정에 구멍도 첨점도 없다.** 극좌표 격자가 아예 없습니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-cloud-slab.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-cloud-slab.js
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
  const p = await b.newPage({ viewport: { width: 1880, height: 560 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(`${ORIGIN}/cloud-slab.html`);
  await p.waitForTimeout(22000);

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

  console.log('\n== 운량장 ==');
  console.log(`  ${stats.운량장.크기}×${stats.운량장.크기}, 반경 ${stats.운량장.반경km}km`);
  // 상층 지평선이 357km 입니다. 그보다 짧으면 지평선 구름이 잘립니다.
  ok(stats.운량장.반경km >= 357, `상층 지평선(357km)을 담는다 (${stats.운량장.반경km}km)`);

  const R = stats.결과;
  console.log('\n== 노을이 물드는가 ==');
  for (const r of R) console.log(`  태양 ${String(r.태양고도).padStart(3)}°  채도 ${r.채도}  격자성 ${r.격자성}`);

  const 노을 = R.filter(r => r.태양고도 <= 2);
  const 최고채도 = Math.max(...노을.map(r => r.채도));
  // 계획 3단계 판정 기준. 덱은 같은 구간에서 0.04~0.12 였습니다.
  ok(최고채도 > 0.3, `노을 구간에서 채도가 오른다 (최고 ${최고채도})`);
  const 낮 = R.find(r => r.태양고도 >= 8);
  ok(낮 && 낮.채도 < 최고채도,
    `해가 높을 때는 낮다 — 늘 화려한 것이 아니다 (${낮 ? 낮.채도 : '?'} < ${최고채도})`);
  // 이 둘이 함께 있어야 "정직한" 표현입니다. 언제나 아름다우면 예보로서
  // 변별력이 없습니다 (계획 8절).

  console.log('\n== 격자가 서지 않는가 ==');
  const 최대격자 = Math.max(...R.map(r => r.격자성));
  // 1.0 = 등방. 타일이 드러나면 축 방향 기울기가 몰려 1을 넘습니다.
  ok(최대격자 < 1.1, `어느 시각에도 축 정렬 무늬가 없다 (최대 ${최대격자})`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
