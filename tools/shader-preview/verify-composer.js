/**
 * **분리 해상도 합성** 합격 판정 (`src/components/SkyScene3D/SceneComposer.ts`).
 *
 * 이 합성의 존재 이유는 **둘을 동시에** 얻는 것입니다:
 *  - 구름 덱은 저해상도로 그려 잔 파편을 뭉치고
 *  - 별은 원해상도를 그대로 지킨다
 *
 * 그래서 둘 다 단언합니다. 하나만 보면 "구름이 뭉갰다"와 "화면 전체를
 * 흐리게 했다"가 구분되지 않습니다.
 *
 * ⚠ 두 질문을 **다른 화면에서** 잽니다. 처음에 별과 구름을 한 화면에 놓고
 * 위쪽 띠에서 상위 픽셀을 뽑았는데, 그 띠에 밝은 구름이 걸려 있으면 재는
 * 것이 별인지 구름인지 알 수 없습니다. 별은 덱을 숨긴 화면에서만 잽니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-composer-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-composer.js
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
  const p = await b.newPage({ viewport: { width: 1930, height: 540 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto('http://localhost:8123/composer.html');
  await p.waitForTimeout(20000);

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

  console.log('\n== 버퍼 ==');
  console.log(`  화면 ${stats.화면}  저해상도 버퍼 ${stats.저해상도버퍼}`);
  const [sw, sh] = stats.저해상도버퍼.split('×').map(Number);
  const [fw, fh] = stats.화면.split('×').map(Number);
  ok(Math.abs(sw * 2 - fw) <= 2 && Math.abs(sh * 2 - fh) <= 2,
    `저해상도 버퍼가 실제로 절반 (${sw}×${sh} vs ${fw}×${fh})`);

  console.log('\n== 구름 — 뭉쳤는가 ==');
  const c = stats.구름;
  console.log(`  경계밀도 ${c.직접}% → ${c.합성}%  (${(c.감소율 * 100).toFixed(1)}% 감소)`);
  ok(c.직접 > 3, `기준선에 실제로 잔 경계가 많음 (${c.직접}%)`);
  ok(c.감소율 > 0.3, `합성이 경계를 크게 줄임 (${(c.감소율 * 100).toFixed(1)}%)`);
  // ⚠ 이 지표는 쌍선형 확대만으로도 내려갑니다(이웃 픽셀 차가 구조적으로
  // 작아지므로). "뭉쳤다"의 방향을 확인하는 용도이지, 감소율 자체를
  // 파편 감소량으로 읽으면 안 됩니다. 파편 개수 기준의 수치는
  // `build-scale-sweep.js`의 알파 문턱 지표(×2에서 26% 감소)를 보세요.

  console.log('\n== 별 — 지켜졌는가 (덱 숨김) ==');
  const s = stats.별;
  console.log(`  상위평균 ${s.직접.상위평균} → ${s.합성.상위평균}`);
  console.log(`  배경중앙 ${s.직접.배경중앙} → ${s.합성.배경중앙}`);
  console.log(`  대비     ${s.직접.대비} → ${s.합성.대비}`);
  const dTop = Math.abs(s.합성.상위평균 - s.직접.상위평균) / Math.max(1, s.직접.상위평균);
  const dCon = Math.abs(s.합성.대비 - s.직접.대비) / Math.max(1, s.직접.대비);
  ok(dTop < 0.01, `별 봉우리가 유지됨 (${(dTop * 100).toFixed(2)}% 차이)`);
  ok(dCon < 0.02, `별 대비가 유지됨 (${(dCon * 100).toFixed(2)}% 차이)`);
  // 이게 이 합성의 존재 이유입니다. 화면 전체를 낮췄다면 여기서 떨어집니다.
  ok(s.합성.대비 > 30, `별이 배경에서 실제로 떠 있음 (대비 ${s.합성.대비})`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
