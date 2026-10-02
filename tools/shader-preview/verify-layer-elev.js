/**
 * **예보 운량 → 화면 면적** 합격 판정. `build-layer-elev.js` 의 짝.
 *
 * 실기 보고: "하늘이 구름으로 가득 찼는데 너무 텅빈 구름만 있어."
 * 그리고 같은 보고에서 "고층부 구름은 괜찮아 보인다."
 *
 * ## 무엇이 틀렸었나
 *
 * 41절의 백분위 문턱은 모양장이 `N(0.5, uShapeSigma)` 라고 **가정**하고
 * `P(q > 1-cover) = cover` 를 항등식으로 만듭니다. 세 층에 그 한 가정을
 * 똑같이 썼는데, 재 보면 층마다 다릅니다:
 *
 *   층    유효 중심   유효 폭
 *   저층    0.597     0.105
 *   중층    0.377     0.104
 *   상층    0.515     0.158   ← 여기만 가정(0.5 · 0.16)과 맞음
 *
 * 그래서 사상이 이렇게 어긋났습니다 (고도 45°):
 *
 *   예보     10%    25%    50%    75%    90%
 *   저층    0.140  0.500  0.818  0.942  0.991
 *   중층    0.001  0.010  0.125  0.340  0.561   ← 텅 빈 하늘
 *   상층    0.095  0.336  0.600  0.759  0.907   ← 괜찮아 보였던 층
 *
 * 사용자가 "상층은 괜찮은데" 라고 한 것이 셋째 줄과 그대로 맞습니다.
 *
 * ## 고친 뒤
 *
 *   저층    0.088  0.250  0.532  0.774  0.902
 *   중층    0.078  0.256  0.511  0.721  0.843
 *   상층    0.079  0.292  0.572  0.741  0.876
 *
 * ## 이 자에 대해
 *
 * ⚠ **밝기 차로 재면 안 됩니다.** 처음에는 구름 없는 화면과의 밝기 차로
 * 면적을 냈는데, 태양 고도·방위만 바꿔 같은 것을 재니 중층이 0.776 과
 * 0.216 을 오갔습니다. 그 자는 "구름이 있나"가 아니라 "하늘과 밝기 차가
 * 나나"를 재고 있었습니다. 그래서 51절의 고도 표는 못 씁니다.
 *
 * 지금은 셰이더의 43절 자료 출구(`dataOut: 2`)를 씁니다 — R 채널이
 * `min(tauAcc, 40)/40` 이라 조명과 무관한 **광학두께**입니다.
 *
 * ⚠ 하늘돔을 장면에서 뺐습니다. 구름 없는 화소는 슬랩 알파가 0 이라 뒤가
 * 비쳐 **하늘의 빨강을 τ 로 읽습니다** — 처음에 그래서 운량 0 대조가
 * τ 34 를 냈고, 그 자가검증이 잡아 줬습니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/build-layer-elev.js
 * 사용: node tools/shader-preview/verify-layer-elev.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const NAME = { low: '저층', mid: '중층', high: '상층' };

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/layer-elev.html', { timeout: 600000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null,
    { timeout: 600000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0, `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats || !stats.결과 || !stats.사상) { console.log('\nFAILURES — __stats 가 모자랍니다.'); process.exit(1); }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);

  const R = stats.결과, M = stats.사상;
  const elevKeys = Object.keys(R.low).filter(k => !k.endsWith('_운량0'));

  console.log('\n== 자가 검증 — 운량 0 이면 광학두께가 0 인가 ==');
  //
  // ⚠ 이 줄이 없으면 하늘돔의 빨강을 τ 로 읽어도 모릅니다. 실제로 한 번
  //   그렇게 재서 운량 0 대조가 τ 34 를 냈습니다.
  let worst = 0;
  for (const L of Object.keys(R)) for (const k of elevKeys) {
    const z = R[L][k + '_운량0'];
    worst = Math.max(worst, z.평균τ, z.최대τ);
  }
  ok(worst < 0.2, `구름이 없으면 τ 가 0 이다 (최악 ${worst.toFixed(3)})`);

  console.log('\n== 예보 운량 → 화면 면적 (고도 45°) ==');
  const covs = Object.keys(M.low);
  const want = covs.map(k => parseInt(k.replace('운량', ''), 10) / 100);
  console.log('  약속   ' + want.map(w => w.toFixed(3).padStart(8)).join(''));
  for (const L of ['low', 'mid', 'high'])
    console.log(`  ${NAME[L]}   ` + covs.map(k => M[L][k].면적τ016.toFixed(3).padStart(8)).join(''));

  // ⚠ (2026-10-02) **"예보 = 면적" 약속은 여기서 재지 않습니다** — 위 표는 참고로만 찍습니다.
  //   이 판은 한 자리(방위 200° · 고도 45° · 흐름 0시)만 봅니다. 모양장에는 수십 km 규모의 느린 항이 있어
  //   시야가 덮는 땅 몇 km 는 그 자리 운을 그대로 탑니다. 같은 코드가 이 자리에서 중층 25% → 0.015,
  //   하늘 평균으로는 0.29 였습니다. 이 자리로 맞춘 예전 상수는 하늘 평균으로 중층 25% → 0.61(2.4배)이었고,
  //   그게 도코나메 밤하늘에 구름이 과하던 원인이었습니다. 약속(±0.06)과 "고치기 전으로 돌아가면 운다"는
  //   이제 `verify-cover-area-avg.js`(방위 8 × 고도 3 × 흐름 12시각 평균, 맞추기에 안 쓴 시각)가 맡습니다 —
  //   예전 상수로 돌아가면 거기서 중층 25% → 0.65 로 걸립니다.
  console.log('  (참고 — 한 자리 값. 판정은 verify-cover-area-avg.js)');

  console.log('\n== 사상이 단조인가 — 예보가 늘면 면적도 늘어야 합니다 ==');
  for (const L of ['low', 'mid', 'high']) {
    const v = covs.map(k => M[L][k].면적τ016);
    ok(v.every((x, i) => i === 0 || x > v[i - 1]), `${NAME[L]} 단조 증가 (${v.map(x=>x.toFixed(2)).join(' → ')})`);
  }

  console.log('\n== 시선 고도 (균일 운량 50%) ==');
  for (const L of ['low', 'mid', 'high'])
    console.log(`  ${NAME[L]}  ` + elevKeys.map(k => R[L][k].면적τ016.toFixed(3).padStart(8)).join(''));
  //
  // ⚠ 상층은 아직 위를 볼수록 줍니다(고도30 0.589 → 고도85 0.262). 고친 것은
  //   운량 사상이지 고도 의존이 아닙니다. 과장하지 않고 그대로 못 박습니다.
  const 상비 = R.high['고도85'].면적τ016 / Math.max(1e-6, R.high['고도30'].면적τ016);
  ok(상비 < 0.6,
    `⚠ 상층은 아직 위를 볼수록 준다 (고도85/고도30 = ${상비.toFixed(2)}) — 안 고친 것`);
  const 저비 = R.low['고도85'].면적τ016 / Math.max(1e-6, R.low['고도30'].면적τ016);
  ok(저비 > 0.8, `저층은 고도에 따라 안 준다 (${저비.toFixed(2)})`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
