/**
 * 조각별 **입체 음영** 합격 판정.
 *
 * 셰이더 식을 옮겨 적어 검산하면 uniform 배선이 끊겨 있어도(uCellReliefUv가
 * undefined → NaN) 통과하므로, `CloudDeck.ts`를 그대로 임포트해 만든 씬의
 * 픽셀을 읽습니다.
 *
 * 세기 상수를 끄고 켤 손잡이가 없어 **차등 검사**로 잽니다 — 자세한 설명은
 * build-cell-relief-preview.js 머리말.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-cell-relief-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-cell-relief.js
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
  await p.goto('http://localhost:8123/cell-relief.html');
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

  const show = (name, s) => {
    console.log('  %s  태양 5°:  국소편차 %s (%d점, 운량 %s)', name,
      s.낮은태양.국소편차.toFixed(4), s.낮은태양.표본, s.낮은태양.운량.toFixed(3));
    console.log('  %s  태양 70°: 국소편차 %s (%d점, 운량 %s)', name,
      s.높은태양.국소편차.toFixed(4), s.높은태양.표본, s.높은태양.운량.toFixed(3));
    console.log('  %s  비 = %s', name, s.비.toFixed(3));
  };

  console.log('\n== 프리셋 ==');
  ok(stats.프리셋.고적운 > 0, `고적운은 조각이 있음 (cellStrength ${stats.프리셋.고적운})`);
  ok(stats.프리셋.층운 === 0, `층운은 조각이 없는 대조군 (cellStrength ${stats.프리셋.층운})`);

  console.log('\n== 고적운 (조각 있음) ==');
  show('고적운', stats.고적운);
  console.log('\n== 층운 (대조군, 조각 없음) ==');
  show('층운', stats.층운);

  // 표본이 없으면 비가 아무 의미 없습니다. 실제로 구름 픽셀을 봤는지 먼저.
  ok(stats.고적운.낮은태양.표본 > 500 && stats.고적운.높은태양.표본 > 500,
    `고적운 컷에 불투명한 구름 픽셀이 충분함 (${stats.고적운.낮은태양.표본}/${stats.고적운.높은태양.표본}점)`);
  // 대조군에도 표본이 있어야 비교가 성립합니다. (문턱이 높으면 층운이
  // 한 점도 안 잡혀 비가 0/0이 되고, 아래 비교가 거저 통과합니다.)
  ok(stats.층운.낮은태양.표본 > 500 && stats.층운.높은태양.표본 > 500,
    `층운 대조군에도 표본이 있음 (${stats.층운.낮은태양.표본}/${stats.층운.높은태양.표본}점)`);
  ok(stats.고적운.낮은태양.국소편차 > 1e-4,
    `조각 안에 실제로 밝기 굴곡이 있음 (${stats.고적운.낮은태양.국소편차.toFixed(4)})`);

  console.log('\n== 판정 ==');
  // 입체감은 낮은 태양에서 (0.30+0.55) / (0.30) ≈ 2.8배로 스케일됩니다.
  // 노을빛·광학 차이가 섞이므로 그보다 낮게 잡되, 대조군보다는 확실히 커야
  // 합니다.
  ok(stats.고적운.비 > 1.3,
    `고적운은 태양이 낮을수록 조각 대비가 커짐 (×${stats.고적운.비.toFixed(2)} > 1.3)`);
  ok(stats.고적운.비 > stats.층운.비 * 1.2,
    `그 증가가 조각 때문임 — 층운 대조군(×${stats.층운.비.toFixed(2)})보다 뚜렷 (고적운 ×${stats.고적운.비.toFixed(2)})`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
