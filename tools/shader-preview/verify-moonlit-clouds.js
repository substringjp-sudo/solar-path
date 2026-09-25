/**
 * **달빛 구름** 합격 판정 (§92). `build-moonlit-clouds.js` 의 짝.
 *
 * ## 자 — 달빛은 햇빛이다
 *
 * 달 아래 구름 ÷ 그 뒤 하늘(선형 휘도)은, 해를 달 자리에 둔 낮의 같은 비와 같아야
 * 합니다. 밤에는 하늘에 바닥(대기광·별빛)이 더해지므로 비가 조금 낮을 수는 있어도
 * 높을 수는 없습니다 — [0.5, 1.15] 배로 봅니다. 이 비는 달빛 이득과 무관합니다.
 *
 * 고치기 전은 구름에 박힌 상수 달빛(보름에 대낮 하늘과 맞먹음)과 달빛 없는 하늘
 * 때문에 이 비가 수십 배로 벌어졌습니다 — 사용자 화면의 "기괴하게 빛나는 구름".
 *
 * ## 대조
 *
 * - 달이 없으면(조도 0) · 달이 지면(−30°) 두 화면이 바이트 단위로 같다.
 * - 낮에는 달이 떠 있든 없든 바이트 단위로 같다.
 * - 보름달 밤은 달 없는 밤보다 밝고, 해 −8° 박명보다는 어둡다.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const f3 = v => (v == null ? '—' : Number(v).toPrecision(3));

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage();
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/moonlit-clouds.html', { timeout: 600000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 600000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const st = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0 && !/ERR/.test(title), `컴파일·예외 없음 (${title}${errs.length ? ' — ' + errs[0] : ''})`);
  if (!st) { console.log('FAILURES — __stats 없음'); process.exit(1); }
  ok(st.glError === 0, `glGetError == 0 (${st.glError})`);

  const R = st.R;
  console.log('\n표 — 구름 ÷ 그 뒤 하늘 (선형, 불투명 구름 화소)');
  console.log('  경우       중앙     10%      90%     구름화소  표시(구름)  표시(틈)  표시(전체)  이득      달모드');
  for (const k of Object.keys(R)) {
    const r = R[k];
    console.log(`  ${k.padEnd(8)} ${f3(r.비_중앙).padStart(7)} ${f3(r.비_10).padStart(7)} ${f3(r.비_90).padStart(7)}`
      + `  ${String(r.구름화소).padStart(7)}   ${f3(r.표시_구름).padStart(7)}   ${f3(r.표시_틈).padStart(7)}   ${f3(r.표시_전체).padStart(7)}`
      + `   ${f3(r.이득).padStart(7)}   ${r.달모드}`);
  }
  if (st.anchor) console.log(`\n닻: 보름달 하늘 ${f3(st.anchor.달하늘)} · 박명 목표 ${f3(st.anchor.목표)} · K ${f3(st.anchor.K)}`);

  console.log('\n== 자 — 달 아래 구름 ÷ 하늘 = 해를 달 자리에 둔 낮의 비 ==');
  ok(R.night.구름화소 > 2000 && R.ref.구름화소 > 2000, `잴 구름이 있다 (밤 ${R.night.구름화소} · 낮 ${R.ref.구름화소})`);
  const k = R.night.비_중앙 / R.ref.비_중앙;
  ok(k >= 0.5 && k <= 1.15, `중앙 비 ${f3(R.night.비_중앙)} ÷ 낮 ${f3(R.ref.비_중앙)} = ${f3(k)} ∈ [0.5, 1.15]`);
  const k90 = R.night.비_90 / R.ref.비_90;
  ok(k90 >= 0.5 && k90 <= 1.15, `90% 비 ${f3(R.night.비_90)} ÷ 낮 ${f3(R.ref.비_90)} = ${f3(k90)} ∈ [0.5, 1.15]`);

  console.log('\n== 밝기 ==');
  ok(R.nightGap.틈화소 > 2000, `잴 틈이 있다 (${R.nightGap.틈화소} 화소)`);
  ok(R.nightGap.표시_틈 > R.noMoonGap.표시_틈 * 1.2, `보름달 밤의 하늘 틈이 달 없는 밤보다 밝다 (${f3(R.noMoonGap.표시_틈)} → ${f3(R.nightGap.표시_틈)})`);
  ok(R.night.표시_전체 < R.twi.표시_전체, `보름달 밤 전체가 해 −8° 박명보다 어둡다 (${f3(R.night.표시_전체)} < ${f3(R.twi.표시_전체)})`);
  if (st.anchor) ok(Math.abs(st.anchor.달하늘 / st.anchor.목표 - 1) < 1e-6, `보름달 하늘이 닻(해 ${-10.5}° 하늘)과 같다`);
  else ok(false, '달빛 이득 함수가 없다 (moonLight)');

  console.log('\n== 대조 ==');
  const same = (a, c) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) d++; return d; };
  const dNo = same(R.noMoon.바이트, R.moonSet.바이트);
  ok(dNo === 0, `달 조도 0 과 달이 진 밤이 바이트 단위로 같다 (다른 바이트 ${dNo})`);
  const dDay = same(R.dayMoon.바이트, R.dayNo.바이트);
  ok(dDay === 0, `낮에는 달이 떠 있어도 바이트 단위로 같다 (다른 바이트 ${dDay})`);

  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
