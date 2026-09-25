/**
 * **해 뜨는 능선 위의 트인 띠** 합격 판정 (§94). `build-sunrise-strip.js` 의 짝.
 *
 * 앱과 같은 합성기·층 배정으로 요네자와 2026-09-25 05:48(해 2.85°, 중층 90 · 상층 95%)을
 * 그립니다. 해는 그려진 능선(3.28°) **아래**입니다.
 *
 * ## 자
 *
 * - **해가 안 보인다.** 해를 껐다 켜서 한 채널이라도 8 넘게 바뀌는 화소가 0.
 *   고치기 전 328화소 — 두 원인이 겹쳤습니다:
 *     ① 저해상도 합성 경로가 하늘 → 구름 → MID 순서인데 해·달·별이 MID 에 있어
 *        **구름 위에** 그려졌습니다(그 자리 구름 τ > 40 인데도). 원반은 실제의 4배
 *        (반지름 1.08°)라 능선 아래 해의 윗부분이 능선 위로 나왔습니다.
 *     ② 구름은 **자료 능선**(연속 DEM)에서 잘리는데 산은 **격자 꼭짓점**으로 그려져
 *        더 낮았습니다. 그 틈에는 구름도 산도 없었습니다.
 * - **트인 띠가 없다.** 그려진 능선 위에서, 지형 가림을 끄면 구름(알파 > 0.5)인데
 *   켜면 비는(< 0.1) 화소가 0. 고치기 전 484화소 · 211열 · 최대 0.35°.
 *
 * ## 대조
 *
 * - 구름을 끄면 해가 보인다 — 자가 해를 보고 있다(원반은 능선 위로 나오므로).
 * - 그려진 능선이 해보다 높다 — "해가 능선 아래" 라는 전제가 이 자리에서 성립한다.
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
  const p = await b.newPage();
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/sunrise-strip.html', { timeout: 600000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 600000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const st = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  const noCloudLit = await p.evaluate(() => {
    // ⚠ 처음엔 "구름 끔·해 켬" 을 "구름 켬·해 끔" 과 견줘 구름 차이까지 44,720 화소를 셌습니다.
    //   구름을 끈 채 해만 껐다 켭니다.
    const a = window.__imageNoCloud, n = window.__imageNoCloudNoSun;
    if (!a || !n) return null;
    let c = 0;
    for (let i = 0; i < a.length; i += 4)
      if (Math.max(Math.abs(a[i] - n[i]), Math.abs(a[i + 1] - n[i + 1]), Math.abs(a[i + 2] - n[i + 2])) > 8) c++;
    return c;
  });
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0 && !/ERR/.test(title), `컴파일·예외 없음 (${title}${errs.length ? ' — ' + errs[0] : ''})`);
  if (!st) { console.log('FAILURES — __stats 없음'); process.exit(1); }
  ok(st.glError === 0, `glGetError == 0 (${st.glError})`);

  console.log('\n== 전제 ==');
  ok(st.해.그려진능선 > st.해.해고도, `그려진 능선 ${st.해.그려진능선.toFixed(2)}° > 해 ${st.해.해고도}°`);
  ok(noCloudLit > 50, `구름을 끄면 해가 보인다 (${noCloudLit} 화소) — 자가 해를 본다`);

  console.log('\n== 자 ==');
  ok(st.태양화소 === 0, `흐린 하늘에서 해가 안 보인다 (해가 밝힌 화소 ${st.태양화소})`);
  ok(st.띠화소 === 0, `그려진 능선 위에 구름이 잘린 트인 띠가 없다 (${st.띠화소} 화소 · ${st.띠열} 열 · 최대 ${st.띠높이_최대.toFixed(2)}°)`);

  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
