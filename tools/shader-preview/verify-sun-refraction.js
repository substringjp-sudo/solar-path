/**
 * **해가 바다 수평선에 숨는 순간 = 앱이 알리는 일몰** 판정 (2026-10-02). `build-sun-refraction.js` 의 짝.
 *
 * 자(렌더를 재기 전에 정함):
 *  1. 겉보기 고도에 놓은 원반의 마지막 화소가 사라지는 시각이 앱의 일몰(기하 −0.833°)과 ±45초 안.
 *     폭: Sæmundsson(−0.83° 에서 37′)과 관례 34′ 의 차 약 19초 + 눈 1.6m 의 수평선 내려앉음 약 14초 + 표본 5초.
 *  2. 대조: 기하 고도에 놓으면 그보다 **2분 넘게 먼저** 사라진다 — 이 자가 굴절을 본다.
 *  3. 대조: 5분 전에는 원반이 화면에 있다(화소 > 20).
 *
 * 첫 측정(2026-10-02): 후쿠이 10월 +25초 · 제주 6월 +30초 · 북위 54° 12월 **+50초(자 1 실패)**. 기하 대조는
 * −165 · −180 · −295초. 실패는 자를 **초**로 세운 탓입니다 — 같은 각도 어긋남(약 0.09°)이 해가 비스듬히 천천히
 * 지는 고위도 겨울에는 50초가 됩니다. 문턱은 재기 전에 정한 그대로 두고 알려진 한계로 남깁니다.
 *
 * 사용: node tools/shader-preview/stage-esm.js && node tools/shader-preview/build-sun-refraction.js
 *       node tools/shader-preview/verify-sun-refraction.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  await p.goto(ORIGIN + '/sun-refraction.html', { waitUntil: 'commit', timeout: 120000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 600000, polling: 500 });
  const st = await p.evaluate(() => window.__stats), errs = await p.evaluate(() => window.__errors);
  await b.close();
  ok(errs.length === 0 && st && st.glError === 0, `셰이더·GL 오류 없음 (${errs[0] || 'gl ' + (st && st.glError)})`);
  if (!st) process.exit(1);
  for (const r of st.out) {
    console.log(`\n== ${r.name} (일몰 ${r.sunset}) — 마지막으로 보인 때: 겉보기 ${r.겉보기.마지막보임초}초 · 기하 ${r.기하.마지막보임초}초`);
    ok(r.겉보기.시작화소 > 20, `5분 전에는 원반이 보인다 (${r.겉보기.시작화소} 화소)`);
    ok(r.겉보기.마지막보임초 != null && Math.abs(r.겉보기.마지막보임초) <= 45, `겉보기: 원반이 일몰 ±45초 안에 숨는다 (${r.겉보기.마지막보임초}초)`);
    ok(r.기하.마지막보임초 != null && r.기하.마지막보임초 <= -120, `대조: 기하 고도면 2분 넘게 먼저 숨는다 (${r.기하.마지막보임초}초)`);
  }
  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — pass ${pass} / fail ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
