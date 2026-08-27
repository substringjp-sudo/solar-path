/**
 * **블룸** 합격 판정 (`src/components/SkyScene3D/SceneComposer.ts`).
 *
 * 블룸은 "밝은 곳만 번지게" 하는 효과입니다. 그래서 두 가지를 **동시에**
 * 단언해야 합니다:
 *
 *  - 밝은 곳이 실제로 올라갔는가 (안 올라갔으면 그냥 안 걸린 것)
 *  - 어두운 곳은 그대로인가 (같이 올라갔으면 그건 번짐이 아니라
 *    **화면을 통째로 밝게 칠한 것**입니다 — 문턱이 새는 상태)
 *
 * 하나만 보면 이 둘이 구분되지 않습니다. 평균 밝기만 재던 초안이 정확히
 * 그 함정이었습니다.
 *
 * ⚠ **포화**도 함께 봅니다. 상위 백분위만 보면 센 쪽이 언제나 "더 좋아"
 * 보입니다 — 250으로 붙어버린 픽셀도 상위10을 올리기 때문입니다. 하지만
 * 그 영역의 구름 구조는 흰색으로 뭉개져 사라집니다. 기본 세기는 포화를
 * 묶는 지점으로 골랐고, 그 선택이 나중에 조용히 뒤집히지 않게 잠급니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-bloom-sweep.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-bloom.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}

// 앱이 실제로 쓰는 기본 세기. 훑기 패널 중 이 칸을 기준으로 단언합니다.
const DEFAULT_STRENGTH = 0.35;

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1704, height: 460 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(`${ORIGIN}/bloom-sweep.html`);
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

  const rows = stats.결과 || [];
  const off = rows.find(r => r.세기 === 0);
  const on = rows.find(r => r.세기 === DEFAULT_STRENGTH);
  if (!off || !on) {
    console.log(`\nFAILURES — 세기 0 / ${DEFAULT_STRENGTH} 칸이 없습니다.`);
    process.exit(1);
  }

  console.log('\n== 기본 세기가 하는 일 ==');
  console.log(`  하위10 ${off.하위10} → ${on.하위10}`);
  console.log(`  상위10 ${off.상위10} → ${on.상위10}`);
  console.log(`  포화   ${off.포화}% → ${on.포화}%`);
  ok(on.상위10차 > 8, `밝은 곳이 실제로 올라감 (상위10 +${on.상위10차})`);
  ok(Math.abs(on.하위10차) < 2, `어두운 곳은 거의 그대로 (하위10 ${on.하위10차 >= 0 ? '+' : ''}${on.하위10차})`);
  // 이 둘의 **비**가 "밝은 곳만"의 정의입니다. 문턱이 새면 1에 가까워집니다.
  const 선택도 = on.상위10차 / Math.max(0.1, Math.abs(on.하위10차));
  ok(선택도 > 5, `번짐이 밝은 쪽에 쏠려 있음 (상위10차 / 하위10차 = ${선택도.toFixed(1)}배)`);

  console.log('\n== 대가 — 포화 ==');
  ok(off.포화 < 1, `블룸 없이는 포화가 거의 없음 (${off.포화}%)`);
  ok(on.포화 < 5, `기본 세기의 포화가 묶여 있음 (${on.포화}%)`);
  // 세기를 올리면 포화가 늘어난다는 것 자체를 단언합니다. 늘지 않는다면
  // 블룸이 톤매핑 뒤가 아니라 엉뚱한 곳에 걸려 있다는 뜻입니다.
  const 센칸 = rows.filter(r => r.세기 > DEFAULT_STRENGTH).sort((a, b) => a.세기 - b.세기);
  ok(센칸.length > 0 && 센칸.every((r, i) => r.포화 > (i === 0 ? on.포화 : 센칸[i - 1].포화)),
    `세기를 올리면 포화가 단조 증가 (${[on, ...센칸].map(r => r.포화 + '%').join(' → ')})`);
  ok(센칸.length > 0 && 센칸[센칸.length - 1].포화 > on.포화 * 2,
    `기본 세기가 실제로 절제된 선택 (가장 센 칸 포화 ${센칸[센칸.length - 1].포화}%)`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
