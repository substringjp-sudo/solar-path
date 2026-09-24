/**
 * **두 층 사이의 빛** 합격 판정. `build-two-deck.js` 의 짝.
 *
 * ## 자 — 에너지 경계
 *
 * 윗층이 100% 덮으면 아래 덱에 닿는 빛은 **윗층을 지나거나 윗층에서 되튄 것뿐**
 * 입니다. 아래 덱은 그 빛의 R(< 1) 만 되돌리므로 그 윗면은 윗층 밑면보다 밝을 수
 * 없습니다 — 선형 휘도 비 < 1.
 *
 * 고치기 전은 해 0.5° 에 표시 비 1.52 로 **이 경계를 어겼습니다.** 윗층을 전혀
 * 몰라 열린 하늘과 해를 온전히 받았기 때문입니다.
 *
 * ## 사진은 참고로만
 *
 * 사용자 사진(2026-09-21 17:32, 두 층 사이)의 비는 0.96 입니다. 휴대폰 HDR 합성이
 * 어두운 곳을 끌어올려 비를 1 쪽으로 누르므로 **값을 맞추지 않고** 찍기만 합니다.
 * (§86 에서 이 값과의 로그 거리로 고친 것을 되돌렸는데, 그 판단이 틀렸습니다 — §88.)
 *
 * ## 대조
 *
 * - 윗층 0% 면 층 사이 빛 켬·끔이 **바이트 단위로 같다** — 윗층이 없으면 아무 일도 없다.
 * - 윗층 100% 에서 끔은 예전(1.52)을 재현한다 — 스위치가 실제로 그 항을 끈다.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const PHOTO_SUNSET = 0.96;

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage();
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/two-deck.html', { timeout: 600000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 600000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const st = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0 && !/ERR/.test(title), `컴파일·예외 없음 (${title}${errs.length ? ' — ' + errs[0] : ''})`);
  if (!st) { console.log('FAILURES — __stats 없음'); process.exit(1); }
  ok(st.glError === 0, `glGetError == 0 (${st.glError})`);

  const R = st.R, suns = [0.5, 5, 20, 45];
  const g = (s, m, i) => R[`${s}/${m}/${i}`];

  console.log('\n표 — 아래 덱 윗면 ÷ 위 덱 밑면 (위 덱 100%)');
  console.log('   해     표시(켬)  표시(끔)   선형(켬)  선형(끔)   직달몫(켬/끔)');
  for (const s of suns) {
    const on = g(s, 1, 1), off = g(s, 1, 0);
    console.log(`  ${String(s).padStart(4)}°   ${(on.표시_아래 / on.표시_위).toFixed(3).padStart(6)}   ${(off.표시_아래 / off.표시_위).toFixed(3).padStart(6)}`
      + `    ${(on.선형_아래 / on.선형_위).toFixed(3).padStart(6)}   ${(off.선형_아래 / off.선형_위).toFixed(3).padStart(6)}`
      + `    ${on.직달_아래.toFixed(3)}/${off.직달_아래.toFixed(3)}`);
  }

  console.log('\n== 대조 ==');
  for (const s of suns) {
    const a = g(s, 0, 1).바이트, c = g(s, 0, 0).바이트;
    let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) diff++;
    ok(diff === 0 && g(s, 0, 1).표시_아래 > 0.05,
      `해 ${s}°: 윗층 0% 면 켬·끔이 바이트 단위로 같다 (다른 바이트 ${diff}, 아래 덱 ${g(s, 0, 1).표시_아래.toFixed(3)})`);
  }
  const off05 = g(0.5, 1, 0);
  ok(off05.표시_아래 / off05.표시_위 > 1.3, `끔은 예전을 재현한다 — 해 0.5° 표시 비 ${(off05.표시_아래 / off05.표시_위).toFixed(2)} (예전 1.52)`);

  console.log('\n== 에너지 경계 — 윗층 100% 밑의 아래 덱 윗면은 윗층 밑면보다 어둡다 ==');
  for (const s of suns) {
    const on = g(s, 1, 1), off = g(s, 1, 0);
    ok(on.선형_아래 / on.선형_위 < 1, `해 ${s}°: 선형 비 ${(on.선형_아래 / on.선형_위).toFixed(3)} < 1`);
    ok(on.선형_아래 < off.선형_아래, `해 ${s}°: 윗층이 있으면 아래 덱이 어두워진다 (${off.선형_아래.toFixed(3)} → ${on.선형_아래.toFixed(3)})`);
    ok(on.직달_아래 < 0.01, `해 ${s}°: 윗층 100% 밑에는 직달이 없다 (${on.직달_아래.toFixed(3)})`);
  }
  // 되튐: 아래 덱이 있으면 위 덱 밑면이 밝아진다(바닥이 땅이 아니라 구름).
  const upOn = g(20, 1, 1).선형_위, upOff = g(20, 1, 0).선형_위;
  ok(upOn > upOff, `아래가 운해면 위 덱 밑면이 밝아진다 (해 20°: ${upOff.toFixed(3)} → ${upOn.toFixed(3)})`);

  console.log('\n참고 — 사진(해질녘 두 층 사이) 표시 비 ' + PHOTO_SUNSET
    + ` · 렌더 해 0.5° 표시 비 ${(g(0.5, 1, 1).표시_아래 / g(0.5, 1, 1).표시_위).toFixed(2)}`
    + ' (휴대폰 HDR 이 1 쪽으로 누르므로 값은 맞추지 않습니다)');

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
