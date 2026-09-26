/**
 * **구름 속** 합격 판정 (§93). `build-cloud-fog.js` 의 짝.
 *
 * ## 자
 *
 * - **단면 → 덩어리.** 반값 규칙(`lowDeck` 과 같음)으로 밑면·윗면이 나온다.
 * - **멀리 못 본다.** 구름 속 지평선 위 시선은 불투명(알파 > 0.97).
 * - **발밑은 보인다.** −30° 아래(눈높이 1.6m → 땅까지 2~9m)는 거의 투명(< 0.15).
 * - **깊이.** 윗면 가까이가 밑면 가까이보다 밝다 — 2-stream 내부 평균복사가 깊이에
 *   따라 선형으로 줄어듭니다. 에너지가 위에서 들어오니 방향이 이것밖에 없습니다.
 * - **가시거리.** 3.9/β 가 구름 속 가시거리의 관측 범위(수십~수백 m) 안.
 *   β 는 층의 소광 TAUK 그대로라, 이 자는 새 상수를 고르지 않았다는 확인입니다.
 *
 * 밑면 바로 아래(구름 밖)에서 올려다본 구름의 밝기는 **참고로만** 찍습니다 — 그쪽은
 * 두께장의 무늬를 타서 평평한 덩어리와 값이 같을 까닭이 없습니다.
 *
 * ## 대조
 *
 * - 안개를 null 로 끈 것 · 아예 안 부른 것 · 관측자가 덩어리 밖인 것 — 셋이 바이트 동일.
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
  await p.goto(ORIGIN + '/cloud-fog.html', { timeout: 600000 });
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
  console.log('\n표');
  console.log('  경우       알파    알파최소  선형휘도   표시     표시편차');
  for (const k of Object.keys(R)) {
    const r = R[k];
    console.log(`  ${k.padEnd(9)} ${f3(r.알파).padStart(6)}  ${f3(r.알파최소).padStart(6)}   ${f3(r.선형).padStart(7)}  ${f3(r.표시).padStart(7)}  ${f3(r.표시편차).padStart(7)}`);
  }

  console.log('\n== 단면 → 덩어리 ==');
  const run = st.run;
  ok(run && Math.abs(run.cover - 1) < 1e-6, `1.6km 운량 ${run && f3(run.cover)} = 1`);
  ok(run && Math.abs(run.baseKm - 1.2895) < 0.002 && Math.abs(run.topKm - 2.295) < 0.002,
    `밑면 ${run && f3(run.baseKm)} · 윗면 ${run && f3(run.topKm)} km (반값 규칙: 1.290 · 2.295)`);
  ok(st.runAt.under === null, `밑면 아래 1.2km 는 구름 밖 (null)`);

  console.log('\n== 구름 속 ==');
  // ⚠ 처음엔 화면 전체의 최소를 봤습니다. 세로 40° 수평 화면의 아래 절반은 눈높이 1.6m 에서
  //   몇 m 앞 땅이라 **보여야 맞는** 자리입니다(바로 아래 단언). 지평선 위만 봅니다.
  ok(R.fogH.위알파최소 > 0.97, `지평선 위 시선은 불투명 (알파 최소 ${f3(R.fogH.위알파최소)} > 0.97)`);
  ok(R.fogDn.알파 < 0.15, `발밑 땅은 보인다 (−30° 알파 평균 ${f3(R.fogDn.알파)} < 0.15)`);
  ok(R.top.선형 > R.bot.선형, `윗면 가까이가 밑면 가까이보다 밝다 (${f3(R.bot.선형)} → ${f3(R.top.선형)})`);
  const vis = 3.9 / st.beta * 1000;
  ok(vis >= 30 && vis <= 500, `가시거리 3.9/β = ${vis.toFixed(0)} m ∈ [30, 500]`);
  console.log(`  참고: 밑면 아래서 올려다본 구름 선형 ${f3(R.under.선형)} · 밑면 바로 위 안개 ${f3(R.bot.선형)}`);

  console.log('\n== 대조 ==');
  const same = (a, c) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) d++; return d; };
  ok(same(R.offNull.바이트, R.offNever.바이트) === 0, `null 로 끈 것 = 안 부른 것 (다른 바이트 ${same(R.offNull.바이트, R.offNever.바이트)})`);
  ok(same(R.outside.바이트, R.offNever.바이트) === 0, `관측자가 덩어리 밖이면 안개 없음 (다른 바이트 ${same(R.outside.바이트, R.offNever.바이트)})`);
  ok(same(R.fogH.바이트, R.offNever.바이트) > 1000, `켜면 실제로 바뀐다 (다른 바이트 ${same(R.fogH.바이트, R.offNever.바이트)})`);

  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
