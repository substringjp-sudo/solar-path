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
  ok(마지막.low.밝기 < 2, `가장 깊은 황혼에 저층은 꺼짐 (${마지막.low.밝기})`);
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
  ok(pM.v > 2 && pH.v > 2,
    `중·상층이 실제로 붉어짐 (${pM.v.toFixed(2)}, ${pH.v.toFixed(2)})`);

  // ── ⚠ 알려진 결함: 깊은 황혼의 초록 치우침 ────────────────────────────
  //
  // 단언하지 않습니다. 지금 값을 문턱으로 박으면 **결함을 규격으로 굳히는**
  // 셈이기 때문입니다. 대신 매번 찍어서 눈에 띄게 둡니다.
  //
  // 황혼 하늘은 오존 Chappuis 흡수(초록~노랑 대역)가 걷어내 파랑/보라가
  // 됩니다. 그 흡수가 구름 환경광 경로에 빠져 있으면 초록이 남습니다.
  console.log('\n== ⚠ 알려진 결함 — 초록 치우침 (2G/(R+B), 1.0 = 중립) ==');
  for (const r of R) {
    const g = (L) => r[L].초록.toFixed(2);
    const mark = Math.max(r.low.초록, r.mid.초록) > 1.3 ? '  ←' : '';
    console.log(`  ${String(r.태양고도).padStart(4)}°  상 ${g('high')}  중 ${g('mid')}  저 ${g('low')}${mark}`);
  }
  console.log('  깊은 황혼에서 저·중층이 초록으로 뜹니다 (오존 Chappuis 흡수 누락 의심).');
  console.log('  단언하지 않습니다 — 지금 값을 문턱으로 박으면 결함이 규격이 됩니다.');

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
