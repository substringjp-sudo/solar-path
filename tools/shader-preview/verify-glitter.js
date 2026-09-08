/**
 * **윤슬이 물처럼 좁은가** 합격 판정. `build-glitter.js` 의 짝.
 *
 * 고치기 전에 잰 값(같은 하네스):
 *
 *   밝은 길 반높이 폭   43 ~ 68°   ← 화면 통째로 재면
 *   봉우리 대비          1.06 ~ 1.19배
 *   풍속 1 → 8 m/s      폭 변화 **0** (항이 아예 없었음)
 *   물 / 제가 비추는 하늘  **1.148 ~ 1.196배**  ← 거울이 원본보다 밝음
 *
 * 마지막 줄이 진짜 결함입니다. 프레넬 반사율은 1 이하이므로 잔잔한 수면은
 * 제가 비추는 하늘보다 밝을 수 없습니다. 원인은 물빛을 `atm_display_ground`
 * 로 표시한 것이었습니다 — 그 함수에는 **어두운 흙바닥을 살리려는** 눈
 * 순응(해가 낮으면 최대 3배)이 들어 있는데, 거울에 비친 하늘까지 그 배수를
 * 먹었습니다. 그래서 태양 쪽 수면이 통째로 톤 곡선 천장(220~255)에 눌렸고,
 * 그 위에는 어떤 윤슬을 얹어도 **한 도도 안 움직였습니다.**
 *
 * 사용: node tools/shader-preview/build-glitter.js
 *       node tools/shader-preview/verify-glitter.js
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
  const p = await b.newPage({ viewport: { width: 900, height: 700 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/glitter.html', { timeout: 180000 });
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
  ok(stats.유니폼있음.uSlopeVar && stats.유니폼있음.uGlitter,
    `해수면이 Cox-Munk 유니폼을 갖는다 (${JSON.stringify(stats.유니폼있음)})`);

  const winds = stats.바람;
  const r = stats.결과;
  const bandsOf = (u) => Object.keys(r['U' + u]).map(Number).sort((a, c) => a - c);

  for (const u of winds) {
    const row = bandsOf(u).map(bd => {
      const x = r['U' + u][bd];
      return `${bd}°: 폭 ${x.윤슬.폭}° 봉 ${x.윤슬.봉우리}`;
    });
    console.log(`\n== U=${u}m/s (σ² = ${(0.003 + 0.00512 * u).toFixed(4)}) ==`);
    console.log('  ' + row.join(' | '));
    console.log('  물/제가비추는하늘: ' + bandsOf(u).map(bd =>
      `${bd}°:${r['U' + u][bd].물하늘비}@${r['U' + u][bd].물하늘비방위}°`).join(' '));
  }

  console.log('\n== 판정 ==');

  // ① 거울은 제 원본보다 밝을 수 없습니다 (윤슬을 끈 순수 되비침으로 잽니다).
  let worst = 0, worstWhere = '';
  for (const u of winds) for (const bd of bandsOf(u)) {
    const x = r['U' + u][bd];
    if (x.물하늘비 > worst) { worst = x.물하늘비; worstWhere = `U${u} ${bd}° 방위${x.물하늘비방위}°`; }
  }
  ok(worst <= 1.02, `물은 제가 비추는 하늘보다 밝지 않다 (최대 ${worst.toFixed(3)}배 @ ${worstWhere} ≤ 1.02)`);

  // ② 윤슬이 실제로 있습니다 — 폭만 보면 "윤슬 지우기"가 만점입니다.
  const peaks = bandsOf(winds[0]).map(bd => r['U' + winds[0]][bd].윤슬.봉우리);
  ok(peaks.every(v => v >= 2), `윤슬이 실제로 얹힌다 (띠별 봉우리 ${peaks.join(', ')} ≥ 2)`);

  // ③ 좁습니다. 고치기 전 넓은 얼룩이 43~68° 였습니다.
  const w1 = bandsOf(winds[0]).map(bd => r['U' + winds[0]][bd].윤슬.폭);
  ok(Math.max(...w1) <= 10,
    `약풍(U=${winds[0]})에서 좁다 (최대 ${Math.max(...w1)}° ≤ 10°, 고치기 전 43~68°)`);

  // ④ 폭을 정하는 것이 σ 하나여야 합니다 — 풍속과 함께 커져야 합니다.
  const lo = winds[0], hi = winds[winds.length - 1];
  const grew = bandsOf(lo).filter(bd => r['U' + hi][bd].윤슬.폭 > r['U' + lo][bd].윤슬.폭);
  ok(grew.length === bandsOf(lo).length,
    `풍속이 폭을 정한다 — U ${lo}→${hi} 에서 모든 띠가 넓어짐 (${grew.length}/${bandsOf(lo).length})`);
  const tot = winds.map(u => bandsOf(u).reduce((a, bd) => a + r['U' + u][bd].윤슬.폭, 0));
  ok(tot.every((v, i) => i === 0 || v > tot[i - 1]),
    `그 커짐이 단조 (${tot.map(v => v.toFixed(1)).join(' → ')})`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
