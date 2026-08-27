/**
 * **황혼에 층이 시간차를 두고 꺼지는가** 합격 판정
 * (docs/CLOUD_VARIETY_PLAN.md 6단계).
 *
 * 이 단계는 **새로 만든 것이 없습니다.** `beamAtAltitude`가 이미 고도별
 * 수평선 내려앉음 `acos(R/(R+h))` 를 태양 고도에 더하고 있고
 * (저 1.5km +1.25° / 중 4.5km +2.16° / 상 10km +3.21°), 게다가 높은 구름은
 * 머리 위 대기가 얇아 같은 태양 고도에서도 훨씬 밝습니다.
 *
 * 그래서 여기서 하는 일은 **그게 실제로 화면에 나오는지 재는 것**입니다.
 * 안 나왔다면 원인을 찾아야 했고, 나왔다면 그 사실을 못으로 박아 둡니다 —
 * 앞으로 조명 경로를 건드릴 때 이 성질이 깨지면 여기서 걸립니다.
 *
 * 층마다 다른 두 층을 숨기고 잽니다. 겹쳐 놓으면 화면에 보이는 것이
 * 어느 층인지 알 수 없습니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-twilight-layers-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-twilight-layers.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1750, height: 400 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto('http://localhost:8123/twilight-layers.html');
  await p.waitForTimeout(16000);

  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0,
    `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/SHADER_ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats) {
    console.log('\nFAILURES — __stats 가 없습니다.');
    process.exit(1);
  }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);

  const R = stats.결과;
  console.log('\n== 층별 밝기와 붉은기 ==');
  console.log('   태양      상층 10km          중층 4.5km          저층 1.5km');
  for (const r of R) {
    const f = (L) => `${String(r[L].밝기).padStart(6)} (R/B ${r[L].붉은기.toFixed(2)})`;
    console.log(`  ${String(r.태양고도).padStart(4)}°  ${f('high')}  ${f('mid')}  ${f('low')}`);
  }

  // ── 순서 ────────────────────────────────────────────────────────────────
  ok(R.every(r => r.high.밝기 >= r.mid.밝기 && r.mid.밝기 >= r.low.밝기),
    `언제나 상층 ≥ 중층 ≥ 저층 — 높을수록 오래 빛을 받음`);

  const 처음 = R[0], 마지막 = R[R.length - 1];
  const 비 = (r) => r.high.밝기 / Math.max(0.1, r.low.밝기);
  console.log(`\n  상층/저층 밝기비  태양 ${처음.태양고도}° 에서 ${비(처음).toFixed(2)}` +
    `  →  ${마지막.태양고도}° 에서 ${비(마지막) > 100 ? '∞ (저층 소등)' : 비(마지막).toFixed(2)}`);
  ok(비(처음) < 2.5, `해가 떠 있을 때는 층 차이가 작음 (${비(처음).toFixed(2)})`);
  ok(비(마지막) > 8, `깊은 황혼에는 층이 크게 갈림 (${비(마지막) > 100 ? '저층 소등' : 비(마지막).toFixed(2)})`);

  // ── 아래부터 꺼진다 ─────────────────────────────────────────────────────
  // 이게 사진 ④ 입니다 — 저층은 이미 지구 그림자, 중·상층만 붉게 남음.
  // ⚠ 문턱이 2에서 6으로 올라갔습니다. 느슨하게 푼 것이 아니라 **재는
  // 대상이 바뀌었습니다** — 이제 각 층은 지상이 아니라 자기 고도에서 본
  // 하늘을 주변광으로 받습니다. 1.5km 저층에게 태양은 지평선 내려앉음만큼
  // (+1.25°) 더 높으니, 같은 -9°에도 주변광이 완전한 검정은 아닙니다.
  // 6/255 = 2.4% — 화면에서는 여전히 꺼진 것으로 보입니다.
  ok(마지막.low.밝기 < 6, `가장 깊은 황혼에 저층은 꺼짐 (${마지막.low.밝기})`);
  ok(마지막.low.밝기 < 마지막.high.밝기 * 0.05,
    `그 시각 저층은 상층의 5% 미만 (${(마지막.low.밝기 / 마지막.high.밝기 * 100).toFixed(1)}%)`);
  ok(마지막.high.밝기 > 30, `그때도 상층은 남아 있음 (${마지막.high.밝기})`);

  // ── 붉은기의 봉우리가 층마다 다른 시각에 온다 ────────────────────────────
  //
  // 직달광이 끊기기 **직전**이 가장 붉습니다 (대기 경로가 가장 길어서).
  // 끊기는 시각이 층마다 다르므로 봉우리 시각도 달라야 합니다. 이게 없으면
  // "높은 층이 그냥 늘 더 밝다"와 구분되지 않습니다.
  const peakAt = (L) => {
    let best = -1, bestV = -1;
    for (const r of R) if (r[L].붉은기 > bestV) { bestV = r[L].붉은기; best = r.태양고도; }
    return { alt: best, v: bestV };
  };
  const pL = peakAt('low'), pM = peakAt('mid'), pH = peakAt('high');
  console.log(`\n  붉은기 봉우리  저층 ${pL.alt}° (${pL.v.toFixed(2)})` +
    `  중층 ${pM.alt}° (${pM.v.toFixed(2)})  상층 ${pH.alt}° (${pH.v.toFixed(2)})`);
  ok(pH.alt < pM.alt || pH.alt < pL.alt,
    `가장 붉은 순간이 위로 올라감 — 저 ${pL.alt}° → 상 ${pH.alt}°`);
  /**
   * ⚠ 예전에는 `pM.v > 2 && pH.v > 2` 라는 **절대** R/B 문턱이었습니다.
   * 그 문턱은 아래 초록 치우침 결함이 만든 값이었습니다 — 청색이 부당하게
   * 깎여 있으니 R/B가 저절로 커졌던 것입니다(중층 3.83). 흡수를 고쳐
   * 청색이 제자리로 오자 그 문턱을 못 넘게 됐고, 그건 **회귀가 아니라
   * 결함이 사라진 것**입니다.
   *
   * 그래서 절대값 대신 **자기 자신과 비교**합니다. 각 층은 직달광이
   * 끊기기 직전에, 이미 그늘에 든 깊은 황혼(-6°)의 자기 색보다 뚜렷하게
   * 따뜻해야 합니다. 이건 청색 절대 수준에 기대지 않습니다.
   */
  const 깊은황혼 = R.find(r => r.태양고도 === -6) || R[R.length - 1];
  const warmUp = (L, pk) => pk.v - 깊은황혼[L].붉은기;
  console.log(`  -6° 대비 따뜻해진 폭  중층 +${warmUp('mid', pM).toFixed(2)}` +
    `  상층 +${warmUp('high', pH).toFixed(2)}`);
  ok(warmUp('mid', pM) > 0.5 && warmUp('high', pH) > 0.15,
    `중·상층이 깊은 황혼보다 뚜렷이 따뜻해짐 ` +
    `(+${warmUp('mid', pM).toFixed(2)}, +${warmUp('high', pH).toFixed(2)})`);

  // ── 초록 치우침 — **고쳤으므로 이제 못을 박습니다** ──────────────────
  //
  // 오랫동안 여기는 "알려진 결함"으로 찍기만 하고 단언하지 않았습니다.
  // 그때 값을 문턱으로 박으면 결함이 규격이 되기 때문이었습니다.
  //
  // 원인은 셋이었고 전부 흡수·경로 쪽이었습니다.
  //
  //  - **시선 방향 오존 경로가 없었음.** 오존은 태양 경로에만 걸려 있었는데,
  //    지평선을 볼 때 눈까지 오는 빛도 오존층을 거의 접선으로 지납니다.
  //  - **박명 조명이 언제까지나 지표를 스치는 붉은 빛이었음.** 실제로는
  //    그림자가 오르면 조명이 얇은 상층 공기를 지나 들어오고, 오존층(22km)만
  //    그대로 통과합니다. 그 비대칭이 박명 하늘을 파랗게 만듭니다.
  //  - **구름이 지상의 하늘을 주변광으로 받았음.** 10km 권운이 보는 하늘은
  //    지평선이 3.2° 내려앉은 다른 하늘입니다.
  //
  // 셋을 고친 뒤 (-6°): 저층 3.58 → 0.92, 중층 1.46 → 1.05.
  console.log('\n== 초록 치우침 (2G/(R+B), 1.0 = 중립) ==');
  for (const r of R) {
    const g = (L) => r[L].초록.toFixed(2);
    const mark = Math.max(r.low.초록, r.mid.초록) > 1.3 ? '  ←' : '';
    console.log(`  ${String(r.태양고도).padStart(4)}°  상 ${g('high')}  중 ${g('mid')}  저 ${g('low')}${mark}`);
  }
  // 층이 아직 빛을 받고 있는 동안만 봅니다. 완전히 꺼진 층(밝기 < 5)은
  // 색이 밤하늘 바닥값이라 비율이 의미가 없습니다.
  let 최대치우침 = 0, 최대설명 = '';
  for (const r of R) {
    for (const L of ['high', 'mid', 'low']) {
      if (r[L].밝기 < 5) continue;
      const d = Math.abs(r[L].초록 - 1);
      if (d > 최대치우침) { 최대치우침 = d; 최대설명 = `${r.태양고도}° ${L} ${r[L].초록.toFixed(2)}`; }
    }
  }
  console.log(`  중립에서 가장 멀리 간 지점: ${최대설명} (편차 ${최대치우침.toFixed(2)})`);
  ok(최대치우침 < 0.25,
    `어느 층·어느 시각에도 초록/자홍으로 치우치지 않음 (최대 편차 ${최대치우침.toFixed(2)}, ${최대설명})`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
