/**
 * **박명광선** 합격 판정 (`src/components/SkyScene3D/SceneComposer.ts`).
 *
 * 이 효과는 빛을 더하지 않고 **그늘을 곱합니다**. 교과서식(밝은 부분을
 * 방사형으로 흐려 더하기)은 이 파이프라인이 톤매핑 뒤(LDR)라 포화만
 * 늘렸습니다 — 이방성 1.075 → 0.991, 포화 6.1% → 12.9%. 그래서 뒤집었고,
 * 그 뒤집은 성질을 여기서 잠급니다.
 *
 * 세 가지를 단언합니다.
 *
 *  - **방향이 생겼는가.** 이방성(태양 둘레 고리에서 접선/지름 밝기변화)이
 *    올라가야 합니다. 그냥 어두워진 것은 이 값이 안 움직입니다.
 *  - **포화가 늘지 않았는가.** 곱하기라 늘 리 없지만, 누가 다시 더하기로
 *    바꾸면 여기서 걸립니다.
 *  - **게이트 두 개.** 해가 높을 때와 밤에는 화면이 **한 픽셀도** 달라지면
 *    안 됩니다. 이름 그대로 박명의 현상이고, 해가 6° 위로 오르면 그늘이
 *    태양 둘레를 통째로 덮어 어두운 비네팅과 고리 자국이 됩니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-godray-sweep.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-godray.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}

const DEFAULT_STRENGTH = 0.35;

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 2810, height: 520 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(`${ORIGIN}/godray-sweep.html`);
  await p.waitForTimeout(25000);

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

  const rows = stats.낮 || [];
  const off = rows.find(r => r.세기 === 0);
  const on = rows.find(r => r.세기 === DEFAULT_STRENGTH);
  if (!off || !on) {
    console.log(`\nFAILURES — 세기 0 / ${DEFAULT_STRENGTH} 칸이 없습니다.`);
    process.exit(1);
  }

  console.log('\n== 태양 화면 좌표 ==');
  const [ux, uy] = stats.태양화면좌표 || [];
  console.log(`  ${ux}, ${uy}`);
  // 투영이 틀리면 그늘이 엉뚱한 점에서 뻗는데, 화면만 봐서는 "좀 이상한
  // 그늘"로 보일 뿐 원인을 짚기 어렵습니다. 좌표부터 잠급니다.
  ok(ux > 0.3 && ux < 0.7 && uy > 0.1 && uy < 0.9,
    `태양이 화면 안으로 투영됨 (${ux}, ${uy})`);

  console.log('\n== 노을 — 방향이 생겼는가 ==');
  console.log(`  이방성 ${off.이방성} → ${on.이방성}`);
  console.log(`  포화   ${off.포화}% → ${on.포화}%`);
  console.log(`  최대 픽셀 변화 ${on.최대변화}`);
  ok(on.이방성차 > 0.01, `이방성이 올라감 (+${on.이방성차})`);
  ok(on.포화차 <= 0, `포화가 늘지 않음 (${on.포화차})`);
  // 곱하기로 뒤집은 이유가 이것입니다. 더하기로 되돌리면 여기가 무너집니다.
  ok(on.최대변화 > 15, `화면에 실제로 보이는 크기의 변화 (${on.최대변화}단계)`);
  const 단조 = rows.every((r, i) => i === 0 || r.이방성 >= rows[i - 1].이방성 - 1e-9);
  ok(단조, `세기를 올리면 이방성이 단조 증가 (${rows.map(r => r.이방성).join(' → ')})`);

  console.log('\n== 게이트 — 박명 밖에서는 아무것도 하지 않는가 ==');
  console.log(`  해 높을 때 광선세기 ${stats.높은해.광선세기}  픽셀최대차 ${stats.높은해.픽셀최대차}`);
  console.log(`  밤        광선세기 ${stats.밤.광선세기}  픽셀최대차 ${stats.밤.픽셀최대차}`);
  ok(stats.높은해.광선세기 === 0, `해가 높으면 광선이 꺼짐 (${stats.높은해.광선세기})`);
  ok(stats.높은해.픽셀최대차 === 0, `해가 높으면 화면이 그대로 (${stats.높은해.픽셀최대차})`);
  ok(stats.밤.광선세기 === 0, `밤에는 광선이 꺼짐 (${stats.밤.광선세기})`);
  // 별은 점이라 조금만 번져도 티가 나고, 달은 밝아서 끌려오기 쉽습니다.
  ok(stats.밤.픽셀최대차 === 0, `밤에는 별·달이 한 픽셀도 안 움직임 (${stats.밤.픽셀최대차})`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
