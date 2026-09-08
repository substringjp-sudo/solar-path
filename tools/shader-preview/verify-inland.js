/**
 * **내륙에서 물이 보이는가** 합격 판정. `build-inland.js` 의 짝.
 *
 * - 내륙(도곡동, 해발 70m): 해수면 메쉬가 이긴 화소가 **0** 이어야 합니다.
 * - 바닷가(대부도 서안, 해발 1.2m): 그 화소가 **여전히 있어야** 합니다.
 * - 높은 바닷가(마니산 정상, 해발 456m): 바다가 **크게** 남아야 합니다.
 *
 * 대조 둘이 다 필요합니다. 하나만 두면 가짜 해법이 통과합니다 —
 * "바다를 통째로 지우기"는 낮은 바닷가가 잡고, "3km 격자 가장자리 한 점만
 * 보고 잇기"는 높은 바닷가가 잡습니다(마니산에서는 바다가 거의 다 3km
 * 밖이라 그 방식이면 통째로 사라집니다).
 *
 * ## 화소 수가 왜 이렇게 작나 — 기준을 여기에 맞춰 둡니다
 *
 * 눈높이 2.8m 에서 바다는 **거의 옆에서** 보입니다. 물가가 360m 밖이면
 * 물이 차지하는 각은 `atan(2.8/360) − dip` ≈ 0.39° 뿐입니다. 화각 70°·512행
 * 이면 세 행쯤입니다. 그래서 "화면의 5%" 같은 기준은 물리적으로 불가능하고,
 * 그걸 기준으로 삼으면 판정이 아니라 소원이 됩니다. 대신 **눈높이에 따라
 * 다른 기대치**를 씁니다: 낮은 바닷가는 "있기만 하면", 높은 바닷가는
 * "크게".
 *
 * 사용: node tools/shader-preview/build-inland.js
 *       node tools/shader-preview/verify-inland.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1000, height: 800 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/inland.html', { timeout: 180000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null,
    { timeout: 180000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0, `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats || !stats.결과) { console.log('\nFAILURES — __stats.결과 가 없습니다.'); process.exit(1); }
  const r = stats.결과;

  for (const k of ['내륙', '바닷가', '높은바닷가']) {
    const s = r[k];
    if (!s) { fail++; console.log(`  FAIL: ${k} 결과 없음`); continue; }
    const pct = (100 * s.총화소 / s.전체화소).toFixed(3);
    console.log(`\n== ${k} (발밑 ${s.발밑}m) ==`);
    console.log(`  해수면 화소 ${s.총화소}/${s.전체화소} (${pct}%) · 최대 물 띠 ${s.최대띠}°`);
    console.log('  방위별: ' + s.방위.map(v => `${v.화소}화소 ${v.아래}~${v.위}°`).join(' | '));
    console.log(`  (옛 원반을 뺀 같은 장면: ${s.원반없이_총화소}화소 · 띠 ${s.원반없이_최대띠}°)`);
  }

  console.log('\n== 판정 ==');
  const 내륙 = r.내륙, 바닷가 = r.바닷가, 높은 = r.높은바닷가;
  ok(내륙.총화소 === 0, `내륙에는 물이 한 화소도 없다 (${내륙.총화소})`);
  ok(내륙.최대띠 === 0, `내륙 물 띠 폭 0° (${내륙.최대띠}°)`);
  // 아래 둘이 대조입니다 — 없으면 "바다 지우기"가 만점을 받습니다.
  ok(바닷가.총화소 >= 400,
    `대조 ①: 낮은 바닷가에는 바다가 남는다 (${바닷가.총화소}화소 ≥ 400)`);
  ok(바닷가.방위.some((v) => v.위 >= -0.2),
    `대조 ①: 그 바다가 수평선까지 닿는다 (맨위 ${Math.max(...바닷가.방위.map(v => v.위))}° ≥ −0.2°)`);
  // 8,000 은 "화면의 몇 %" 가 아니라 **재 본 값 사이**에서 고른 선입니다:
  // 원반이 새 메시를 덮던 때가 1,328화소, 고친 뒤가 14,740화소였습니다.
  ok(높은.총화소 >= 8000,
    `대조 ②: 높은 바닷가는 바다가 크게 남는다 (${높은.총화소}화소 ≥ 8000)`);
  ok(높은.최대띠 >= 3.0, `대조 ②: 그 바다가 세로로 넓다 (${높은.최대띠}° ≥ 3°)`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
