/**
 * **먼 산이 제 높이로 그려지는가** 합격 판정. `build-far-terrain.js` 의 짝.
 *
 * 실기 보고는 "산의 높이나 기울기가 실제보다 조금 과장돼 보여" 였습니다.
 * 재 보니 앞산이 커진 게 아니라 **뒷산이 주저앉아** 있었습니다 — 3km 밖을
 * 맡던 옛 능선 띠가 방위마다 5·15·40km 딱 세 점만 봐서 진짜 봉우리를
 * 대부분 놓쳤기 때문입니다. 3km 안은 진짜 높이장이라 제 높이로 서니,
 * 앞산만 우뚝하고 뒤는 납작한 그림이 됩니다.
 *
 * 도곡동 24방위, 참조는 앱과 **같은 자료**(3km 안은 줌 13, 밖은 줌 10)에서
 * 방위마다 30m~40km 를 훑은 고도각 최댓값:
 *
 *                     치우침    절대중앙값    최대
 *   옛 능선 띠만      −0.346°     0.298°     3.258°  ← 남쪽 3.99° 가 0.73° 로
 *   먼 지형 격자      −0.003°     0.080°     0.588°
 *
 * ⚠ 참조를 만들 때 함정이 하나 있었습니다. 처음엔 전부 성긴 DEM(화소 121m)
 * 으로 참조를 만들었는데 화면의 3km 안은 촘촘한 DEM(화소 15m)으로 그립니다.
 * 성긴 쪽은 봉우리를 깎으므로(같은 자리 발밑 59.8m 대 70.7m) 그 차이가
 * 통째로 "결함"으로 나왔습니다 — 남서쪽 +4.4°. **자료 차이를 우리 결함으로
 * 읽는** 전형적인 함정이라, 참조를 앱과 같은 자료로 맞춰야 합니다.
 *
 * 사용: node tools/shader-preview/build-far-terrain.js
 *       node tools/shader-preview/verify-far-terrain.js
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
  const p = await b.newPage({ viewport: { width: 960, height: 760 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/far-terrain.html', { timeout: 240000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null,
    { timeout: 240000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0, `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats || !stats.결과) { console.log('\nFAILURES — __stats.결과 가 없습니다.'); process.exit(1); }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);
  const r = stats.결과;

  console.log('\n== 방위별 실루엣 (참조 → 측정, 차) ==');
  for (let i = 0; i < r.참조.length; i++) {
    const m = r.측정[i];
    const d = m === null ? null : m - r.참조[i];
    console.log(`  ${String(i * (360 / r.방위수)).padStart(3)}°`
      + ` ${r.참조[i].toFixed(3).padStart(7)} → ${m === null ? '  없음' : m.toFixed(3).padStart(7)}`
      + (d === null ? '' : `  ${(d >= 0 ? '+' : '') + d.toFixed(3)}`));
  }
  console.log(`\n  치우침 ${r.치우침}° · 절대중앙값 ${r.절대중앙값}° · 최대 ${r.최대}°`);

  console.log('\n== 판정 ==');
  ok(r.잰방위 === r.방위수, `모든 방위에서 지면이 잡힌다 (${r.잰방위}/${r.방위수})`);
  // 아래 셋은 "옛 능선 띠만" 일 때의 값(−0.346 / 0.298 / 3.258) 과
  // "먼 지형 격자" 일 때의 값(−0.003 / 0.080 / 0.588) **사이**에서 골랐습니다.
  ok(Math.abs(r.치우침) <= 0.10,
    `실루엣이 치우쳐 있지 않다 (${r.치우침}° · |·| ≤ 0.10°, 띠만 쓰면 −0.346°)`);
  ok(r.절대중앙값 <= 0.15,
    `방위 절반이 0.15° 안에 든다 (${r.절대중앙값}°, 띠만 쓰면 0.298°)`);
  ok(r.최대 <= 0.80,
    `가장 나쁜 방위도 0.80° 안 (${r.최대}°, 띠만 쓰면 3.258° — 남쪽 산 하나가 통째로 사라졌습니다)`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
