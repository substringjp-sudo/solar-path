/**
 * **노을 무렵 해쪽 먼 구름이 낮은 햇빛을 가리는가** 판정 (§103). `build-twilight-glow.js` 의 짝.
 *
 * 자(재기 전에 정함):
 * 판정은 side 시선(해쪽 지평선 가까이, 30km 안의 구름만)으로 합니다 — build 머리말 참고.
 *  - 양성 대조: 구름 화소가 충분하다(≥ 2,000), 먼 구름이 직달 몫을 실제로 절반 넘게 줄인다.
 *  - 태양 −1°: 해쪽 먼 곳이 구름이면 같은 가까운 저층이 **눈에 띄게** 어둡다(≤ 0.85배).
 *  - 태양 −9°: 참고로만 찍습니다(직달이 이미 0 이라 먼 구름과 무관해야 합니다 — 0.95~1.05배).
 *  - 태양 +5°(해가 이 층에서 보임): 먼 구름이 있어도 거의 같다(0.95~1.05배) — 직달이
 *    지배하는 낮·노을에는 손대지 않는다.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/twilight-glow.html', { timeout: 300000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 300000, polling: 250 }).catch(() => {});
  const title = await p.title();
  const st = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();
  ok(pageErrors.length === 0 && !/ERR/.test(title), `컴파일·예외 없음 (${title}${errs.length ? ' — ' + errs[0] : ''})`);
  if (!st) { console.log('FAILURES — __stats 없음'); process.exit(1); }
  for (const view of ['up', 'side']) for (const a of ['-1', '5', '-9']) { const o = st.out[view][a];
    console.log(`  [${view}] 태양 ${a}°: 먼 곳 맑음 ${o.clearFar.toFixed(1)} (직달 ${(o.sunFracClear * 100).toFixed(1)}%) · 먼 곳 구름 ${o.cloudyFar.toFixed(1)} (직달 ${(o.sunFracCloudy * 100).toFixed(1)}%) · ${o.n} 화소`); }
  const S = st.out.side, n1 = S['-1'], p5 = S['5'], n9 = S['-9'];
  ok(n1.n >= 2000 && p5.n >= 2000, `양성 대조: 구름 화소가 충분하다 (${n1.n} · ${p5.n})`);
  ok(n1.sunFracClear > 2 * n1.sunFracCloudy, `양성 대조: 먼 구름이 실제로 직달을 막는다 (직달 몫 ${(n1.sunFracClear * 100).toFixed(1)}% → ${(n1.sunFracCloudy * 100).toFixed(1)}%)`);
  const r1 = n1.cloudyFar / Math.max(1e-6, n1.clearFar), r5 = p5.cloudyFar / Math.max(1e-6, p5.clearFar), r9 = n9.cloudyFar / Math.max(1e-6, n9.clearFar);
  ok(r1 <= 0.85, `노을 빛(−1°): 해쪽 먼 구름이 있으면 해쪽 저층이 어둡다 (${r1.toFixed(3)} ≤ 0.85)`);
  ok(r9 >= 0.95 && r9 <= 1.05, `지구 그림자(−9°): 먼 구름과 무관하다 (${r9.toFixed(3)}, 0.95~1.05)`);
  ok(r5 >= 0.95 && r5 <= 1.05, `해가 떠 있을 때(+5°): 먼 구름이 있어도 거의 같다 (${r5.toFixed(3)}, 0.95~1.05)`);
  // ⚠ §104 에서 "해 +5° 해쪽 구름의 직달 몫 ≥ 50%" 를 재기 전에 넣었다가 뺐습니다. 해쪽을 보면
  //   보이는 면은 **해를 등진 면**이라 직달이 적은 것이 맞습니다 — 전제가 틀린 자였습니다.
  //   직달 몫은 위에 찍어만 둡니다. 눈금 자체는 verify-light-units 가 봅니다.
  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
