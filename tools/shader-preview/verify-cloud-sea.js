/**
 * **운해** 합격 판정. `build-cloud-sea.js` 의 짝.
 *
 * 관측자가 저층 위에 있으면 구름이 **아래**에 깔리고 위에는 없어야 합니다.
 * 관측자가 층 아래(해발 0, 또는 층을 2.5km 로 올린 경우)면 예전 그대로
 * 위에만 있어야 합니다.
 *
 * 판(60° 시야)은 **한쪽 반구에만 걸치는** 것만 씁니다:
 *   고도 −60 → −90°~−30°,  고도 −30 → −60°~0°,  고도 +30 → 0°~+60°
 * 나머지(−10, −3, +10)는 수평선을 가로질러 둘이 섞이므로 표로만 찍습니다.
 *
 * 가장자리는 좁은 시야 단면으로 봅니다. 예측은 `cloudDeck.deckHorizonDipDeg`
 * (관측 1.6km · 층 1.2km → −0.642°)이고, 바다 수평선(−1.284°)과 **달라야**
 * 합니다 — 같으면 운해가 아니라 "지평선 아래 버리기를 조금 내린 것" 입니다.
 *
 * ⚠ 되돌림 대조: 셰이더 패치를 빼고 돌리면 [운해] 줄이 전부 깨져야 합니다
 *   (측정: 패치 전 산1600_층1.2 고도−60 면적 0). 이 자가 공허하지 않다는
 *   근거입니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/build-cloud-sea.js
 * 사용: node tools/shader-preview/verify-cloud-sea.js
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
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/cloud-sea.html', { timeout: 600000 });
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
  if (!stats || !stats.결과 || !stats.단면) { console.log('\nFAILURES — __stats 가 모자랍니다.'); process.exit(1); }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);

  const R = stats.결과, X = stats.단면, P = stats.예측;
  const A = (c, e) => R[c]['고도' + e].면적;

  console.log('\n표 — 화면 면적(τ ≥ 0.16)');
  const elevs = Object.keys(R['지상_층1.2']);
  console.log('  ' + ''.padEnd(14) + elevs.map(k => k.replace('고도', '').padStart(7)).join(''));
  for (const c of Object.keys(R))
    console.log('  ' + c.padEnd(14) + elevs.map(k => R[c][k].면적.toFixed(3).padStart(7)).join(''));

  console.log('\n== 자가 검증 — 운량 0 이면 어디서도 τ 가 0 ==');
  const z = Math.max(...elevs.map(k => R['산1600_운량0'][k].평균τ),
    ...X['산1600_운량0'].map(r => r.frac));
  ok(z === 0, `운량 0 대조 (최대 ${z})`);

  console.log('\n== 지상 관측 — 예전과 같아야 합니다 ==');
  ok(A('지상_층1.2', -60) === 0 && A('지상_층1.2', -30) === 0,
    `아래를 보면 구름이 없다 (−60 ${A('지상_층1.2', -60)} · −30 ${A('지상_층1.2', -30)})`);
  ok(A('지상_층1.2', 30) > 0.3, `위를 보면 구름이 있다 (+30 ${A('지상_층1.2', 30)})`);
  const g아래 = Math.max(...X['지상_층1.2'].filter(r => r.elev < -0.05).map(r => r.frac));
  ok(g아래 === 0, `수평선 아래 단면이 비어 있다 (최대 ${g아래})`);

  console.log('\n== [운해] 관측 1,600m · 저층 1.2km ==');
  ok(A('산1600_층1.2', -60) > 0.6, `발밑이 구름으로 덮인다 (−60 ${A('산1600_층1.2', -60)})`);
  ok(A('산1600_층1.2', -30) > 0.5, `내려다보면 구름 바닥 (−30 ${A('산1600_층1.2', -30)})`);
  ok(A('산1600_층1.2', 30) === 0, `머리 위에는 그 구름이 없다 (+30 ${A('산1600_층1.2', 30)})`);

  const rows = X['산1600_층1.2'];
  const dense = rows.filter(r => r.frac >= 0.5);
  const edge = dense.length ? Math.max(...dense.map(r => r.elev)) : NaN;
  const 위 = Math.max(...rows.filter(r => r.elev > P.가장자리 + 0.15).map(r => r.frac));
  console.log(`  단면: 구름이 끝나는 고도 ${edge.toFixed(3)}° · 예측 ${P.가장자리.toFixed(3)}° · 바다 수평선 ${P.바다수평선.toFixed(3)}°`);
  ok(Math.abs(edge - P.가장자리) <= 0.2,
    `가장자리가 예측과 맞는다 (차 ${(edge - P.가장자리).toFixed(3)}°, 허용 0.2°)`);
  ok(위 === 0, `가장자리 0.15° 위로는 비어 있다 (최대 ${위})`);
  ok(edge > P.바다수평선 + 0.4,
    `가장자리가 바다 수평선과 다르다 — 지평선 버리기를 내린 게 아니다`);

  console.log('\n== 관측 1,600m · 저층 2.5km — 층이 머리 위 ==');
  ok(A('산1600_층2.5', -60) === 0, `발밑에 구름이 없다 (−60 ${A('산1600_층2.5', -60)})`);
  ok(A('산1600_층2.5', 30) > 0.3, `위를 보면 구름이 있다 (+30 ${A('산1600_층2.5', 30)})`);
  // 층이 위에 있으면 예전처럼 **바다 수평선까지** 내려옵니다(지형이 앞을 가림).
  const h아래 = X['산1600_층2.5'].filter(r => r.elev < P.바다수평선 - 0.05).map(r => r.frac);
  ok(Math.max(...h아래) === 0, `바다 수평선 아래는 비어 있다 (최대 ${Math.max(...h아래)})`);

  console.log('\n== §82 덱 윗면 — 단면이 준 윗면을 위에서 보는가 ==');
  {
    const rows14 = X['산1600_덱1.0-1.4'];
    const d14 = rows14.filter(r => r.frac >= 0.5);
    const edge14 = d14.length ? Math.max(...d14.map(r => r.elev)) : NaN;
    console.log(`  단면(덱 윗면 1.4km): 끝 ${edge14.toFixed(3)}° · 예측 ${P.가장자리_덱14.toFixed(3)}° · (윗면 모를 때 ${edge.toFixed(3)}°)`);
    ok(Math.abs(edge14 - P.가장자리_덱14) <= 0.2,
      `가장자리가 윗면 1.4km 의 예측을 따른다 (차 ${(edge14 - P.가장자리_덱14).toFixed(3)}°)`);
    // 자가 공허 점검 — 두 예측이 허용폭보다 멀어야 이 줄이 뜻이 있습니다.
    ok(Math.abs(P.가장자리_덱14 - P.가장자리) > 0.15,
      `두 예측이 구별된다 (${P.가장자리_덱14.toFixed(3)} vs ${P.가장자리.toFixed(3)})`);
    ok(edge14 > edge + 0.1, `윗면을 알면 가장자리가 올라간다 (${edge.toFixed(3)} → ${edge14.toFixed(3)})`);
    ok(A('산1600_덱1.0-1.4', -60) > 0.6 && A('산1600_덱1.0-1.4', 30) === 0,
      `여전히 운해 — 아래 ${A('산1600_덱1.0-1.4', -60)} · 위 ${A('산1600_덱1.0-1.4', 30)}`);

    // 관측자가 덱 **속**(0.8 < 1.6 ≤ 1.8): §81 은 hBase(1.2)를 넘었다고 운해로 그렸다.
    ok(A('산1600_덱0.8-1.8', -60) === 0,
      `덱 속이면 발밑 운해를 그리지 않는다 (−60 ${A('산1600_덱0.8-1.8', -60)}, §81 이면 ${A('산1600_층1.2', -60)})`);
    ok(A('산1600_덱0.8-1.8', 30) > 0.3,
      `덱 속이면 위에 구름이 있다 (+30 ${A('산1600_덱0.8-1.8', 30)})`);

    // 지상 관측은 덱 값과 **바이트 단위로** 같아야 합니다 — 온 하늘 조정이 그 판에 있음.
    const same = Object.keys(R['지상_층1.2']).every(k =>
      R['지상_층1.2'][k].면적 === R['지상_덱1.0-1.4'][k].면적 && R['지상_층1.2'][k].평균τ === R['지상_덱1.0-1.4'][k].평균τ);
    ok(same, '지상에서는 덱 값을 줘도 여섯 판이 똑같다');
  }

  console.log('\n== 조명 — 위에서 본 윗면이 아래에서 본 밑면보다 밝은가 (운해 여덟 자리 평균) ==');
  //
  // 방향만 봅니다. 두꺼운 층운은 위에서 반사(R), 아래에서 투과(Tr)라 윗면이
  // 밝아야 합니다. ⚠ 측정된 차는 5~9% 로 **작습니다** — 실제 운해 윗면은
  // 훨씬 더 눈부십니다. 몇 배여야 하는지는 사진과 대조한 적이 없어 문턱을
  // 두지 않고, 차가 작다는 사실을 그대로 적어 둡니다(§81).
  // ⚠ §118 — 한 자리가 아니라 **여덟 자리 평균**으로 봅니다(build 의 POS 주석). 한 자리 값은 참고로
  //   찍습니다. 또 이 덱의 연직 광학두께(시선τ × |sin 시선|)는 10~12 라, 램버트 2-흐름으로는 반사와
  //   투과가 비슷한 경계입니다(τ 13 을 넘어야 반사가 큽니다). 이 줄은 물리 증명이 아니라 방향 확인입니다.
  const Lt = stats.조명;
  if (!Lt) { ok(false, '조명 측정이 없다'); }
  else for (const k of Object.keys(Lt)) {
    const m = Lt[k], base = m['밑면_지상+30'], t30 = m['윗면_산-30'], t60 = m['윗면_산-60'];
    console.log(`  ${k}: 밑면 ${base.휘도} · 윗면(−30) ${t30.휘도} · 윗면(−60) ${t60.휘도}`);
    if (base.한자리) console.log(`    참고 — 예전 한 자리: 밑면 ${base.한자리.휘도} · 윗면(−30) ${t30.한자리.휘도} · 윗면(−60) ${t60.한자리.휘도}`);
    if (base.자리별) console.log(`    자리별 밑면 ${base.자리별.join(' ')} | 윗면(−60) ${t60.자리별.join(' ')}`);
    if (base.시선τ != null) console.log(`    시선 광학두께: 밑면 ${base.시선τ} · 윗면(−30) ${t30.시선τ} · 윗면(−60) ${t60.시선τ}`);
    ok(base.화소 > 1000 && t30.화소 > 1000 && t60.화소 > 1000, `${k}: 구름 화소가 충분하다`);
    ok(t30.휘도 > base.휘도 && t60.휘도 > base.휘도, `${k}: 윗면이 밑면보다 밝다`);
    ok(t30.포화 < 0.01 && t60.포화 < 0.01, `${k}: 윗면이 하얗게 타지 않는다 (${t30.포화} · ${t60.포화})`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
