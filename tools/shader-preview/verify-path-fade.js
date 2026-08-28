/**
 * **궤적 리본이 실제 태양·달 원반을 가리지 않는다** 합격 판정.
 *
 * 리본은 그 순간의 실제 위치를 지나므로 "지금"에 해당하는 지점(dt=0)에서
 * 원반과 정확히 겹칩니다. `CelestialPathMesh.ts` 의 근접 마스크가 그
 * 지점 부근을 투명하게 지우고, 원반에서 멀어지면(≥6°) 다시 완전히
 * 보이게 합니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-path-fade.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-path-fade.js
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
  const p = await b.newPage({ viewport: { width: 1560, height: 460 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(`${ORIGIN}/path-fade.html`);
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

  console.log('\n== 원반 중심에서 리본이 사라지는가 ==');
  for (const r of stats.결과) {
    console.log(`  ${r.대상} (고도 ${r.고도}°)  마스크없음 ${r.리본_마스크없음}  →  마스크적용 ${r.리본_마스크적용}`);
    // "마스크없음"이 실제로 원반을 가릴 만큼 짙어야, 마스크가 그것을
    // 지운다는 주장이 뭔가를 증명한 것이 됩니다.
    ok(r.리본_마스크없음 > 30,
      `${r.대상}: 마스크 없이는 원반 자리를 실제로 덮음 (${r.리본_마스크없음})`);
    ok(r.리본_마스크적용 < 5,
      `${r.대상}: 마스크를 걸면 원반 중심이 거의 완전히 비워짐 (${r.리본_마스크적용})`);
  }

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
