/**
 * **예보 운량 = 하늘 평균 화면 면적** 판정 (2026-10-01). `build-cover-area-avg.js` 의 짝.
 *
 * 자(재기 전에 정함):
 *  - 층마다(저·중·상), 예보 10 · 25 · 50 · 75 · 90% 에서 하늘 평균 면적(광학두께 ≥ 0.16, `verify-layer-elev` 와
 *    같은 문턱)이 예보와 ±0.06 안. 평균은 방위 4(45·135·225·315°) × 고도 3(20·45·70°) × 홀수 흐름 시각 12 —
 *    **맞추기에 쓰지 않은** 방위·시각입니다(`fit-cover-area-avg.js` 는 짝수 시각 · 0/90/180/270° 로 맞춤).
 *    ⚠ 처음에는 맞추기 0·12시, 확인 6·18시였습니다. 두 시각으로는 느린 항의 평균이 안 잡혀(저층 25% 가
 *    0.29 대 0.51) 표본을 넓혔습니다 — 문턱 ±0.06 은 그대로입니다.
 *  - 예보가 늘면 면적도 는다(단조).
 *  - 코드에 든 상수 그대로(덮어쓰기 없음)를 잽니다.
 *
 * 사용: node tools/shader-preview/stage-esm.js && node tools/shader-preview/build-cover-area-avg.js
 *       node tools/shader-preview/verify-cover-area-avg.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const COVERS = [0.1, 0.25, 0.5, 0.75, 0.9];
const TOL = 0.06;

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  await p.goto(`${ORIGIN}/cover-area-avg.html?drifts=1,3,5,7,9,11,13,15,17,19,21,23&azs=45,135,225,315&covers=${COVERS.join(',')}`, { timeout: 600000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 3600000, polling: 1000 });
  const errs = await p.evaluate(() => window.__errors);
  const out = await p.evaluate(() => window.__out);
  const glErr = await p.evaluate(() => window.__glError);
  await b.close();
  ok(errs.length === 0 && glErr === 0, `셰이더·GL 오류 없음 (${errs[0] || 'gl ' + glErr})`);
  if (!out) { console.log('FAILURES — 결과 없음'); process.exit(1); }
  console.log('\n  층    ' + COVERS.map(c => ('예보' + c).padStart(9)).join(''));
  for (const L of ['low', 'mid', 'high']) {
    const a = COVERS.map(c => out.find(o => o.layer === L && o.cover === c).area016);
    console.log(`  ${L.padEnd(5)} ` + a.map(x => x.toFixed(3).padStart(9)).join(''));
    const worst = Math.max(...a.map((x, i) => Math.abs(x - COVERS[i])));
    ok(worst <= TOL, `${L}: 하늘 평균 면적이 예보 ±${TOL} 안 (최대 어긋남 ${worst.toFixed(3)})`);
    ok(a.every((x, i) => i === 0 || x > a[i - 1]), `${L}: 단조 증가`);
  }
  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — pass ${pass} / fail ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
