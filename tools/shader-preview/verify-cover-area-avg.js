/**
 * **예보 운량 = 하늘 평균 화면 면적** 판정 (2026-10-01). `build-cover-area-avg.js` 의 짝.
 *
 * 자(재기 전에 정함):
 *  - 층마다(저·중·상), 예보 10 · 25 · 50 · 75 · 90% 에서 하늘 평균 면적(광학두께 ≥ 0.16, `verify-layer-elev` 와
 *    같은 문턱)이 예보와 ±0.06 안. 평균은 방위 8 × 고도 3(20·45·70°) × 홀수 흐름 시각 12 — **맞추기에 쓰지 않은**
 *    시각입니다(`fit-cover-area-avg.js` 는 짝수 시각으로 맞춤).
 *    ⚠ 두 번째 판은 방위도 나눴습니다(맞추기 0/90/180/270, 확인 45/135/…). 상층이 0.17 어긋났는데, 권운 줄무늬가
 *    바람에 누워 방위마다 면적이 실제로 달라서입니다 — 앱은 모든 방위를 보므로 방위는 다 쓰고 시각으로만 나눕니다.
 *    ⚠ 처음에는 맞추기 0·12시, 확인 6·18시였습니다. 두 시각으로는 느린 항의 평균이 안 잡혀(저층 25% 가
 *    0.29 대 0.51) 표본을 넓혔습니다 — 문턱 ±0.06 은 그대로입니다.
 *  - 예보가 늘면 면적도 는다(단조).
 *  - 코드에 든 상수 그대로(덮어쓰기 없음)를 잽니다.
 *  ⚠ 2026-10-02 자 고침(문턱은 그대로): 면적의 분모를 **하늘 화소**(지평선 위)로 바꿨습니다. 전에는 화면 전체로
 *    나눠, 고도 20° 시야 아래쪽(땅)까지 분모에 들어가 운량 0.95·0.99 가 세 층 모두 0.938 에서 멈췄습니다.
 *    예보 운량은 하늘의 몇 할입니다. 이 고침 뒤 CloudSlab `COVER_REMAP`(역표)을 짝수 시각으로 맞췄습니다.
 *  ⚠ 2026-10-02 표본 고침(문턱은 그대로): 흐름 시각 12 개로는 평균이 안 잡혔습니다 — 짝수 시각으로 맞춘 역표가
 *    맞춘 시각에서는 소수 셋째 자리까지 맞고 홀수 시각에서 상층 0.14 넘쳤습니다. 천정 쪽 시야는 구름 칸 몇 개만 보여
 *    시각마다 0.06~0.95 로 흔들리고, 바람 한 줄 위의 자리들은 잡음 격자 주기(해시가 x 50칸)와 겹쳐 독립이
 *    아니었습니다. 이제 자리 96 개(흐름 k 시간 · 바람 방위 250°+k·137.5°) 중 **홀수 48 개**로 확인합니다
 *    (맞추기는 짝수 48 개, 방위 4 · 고도 3).
 *  - 자리마다의 면적(자리별 하늘 평균)은 **참고로 찍기만** 합니다 — 실제 하늘도 예보 칸 안에서 시각마다
 *    달라 문턱을 둘 근거가 아직 없습니다.
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
  await p.goto(`${ORIGIN}/cover-area-avg.html?pos=96&set=odd&azs=0,90,180,270&covers=${COVERS.join(',')}`, { waitUntil: 'commit', timeout: 600000 });
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
    const sp = COVERS.map(c => out.find(o => o.layer === L && o.cover === c).drift || []);
    console.log(`        자리별 범위 ` + sp.map(d => d.length ? `${Math.min(...d).toFixed(2)}~${Math.max(...d).toFixed(2)}` : '—').map(x => x.padStart(9)).join(''));
    const worst = Math.max(...a.map((x, i) => Math.abs(x - COVERS[i])));
    ok(worst <= TOL, `${L}: 하늘 평균 면적이 예보 ±${TOL} 안 (최대 어긋남 ${worst.toFixed(3)})`);
    ok(a.every((x, i) => i === 0 || x > a[i - 1]), `${L}: 단조 증가`);
  }
  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — pass ${pass} / fail ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
