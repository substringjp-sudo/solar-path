/**
 * **구름이 받는 직달은 구름 높이(해면 기준)에서** (§118) — 판정.
 *
 * 먼저 정한 줄:
 *  1. 같은 층(해면 기준 높이)의 직달 표는 관측자 고도(0 · 545 · 760 · 1600m)와 **무관**하다 — 표 값이
 *     한 칸도 다르지 않다.
 *  2. 그 표는 층 높이에서 푼 광선 적분(beamGrazing)과 같다 — 8비트 한 칸 안.
 *  3. 구름 속 안개의 직달은 **관측자 자리**의 직달(beamAtAltitude(해, 0))이다 — 상대 오차 1e-5 안.
 *  대조: 이 자가 층 높이 0.76km(스와 해발) 차이를 본다 — 해 0° 에서 표가 2칸 넘게 다르다.
 *
 * 사용: node tools/shader-preview/build-cloud-beam-height.js
 *       node tools/shader-preview/verify-cloud-beam-height.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(`${ORIGIN}/cloud-beam-height.html`, { waitUntil: 'commit' });
  await p.waitForFunction(() => document.title.startsWith('DONE'), null, { timeout: 120000 });
  const stats = await p.evaluate(() => window.__stats);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  ok(pageErrors.length === 0 && errs.length === 0, `페이지 오류 없음 ${[...pageErrors, ...errs][0] || ''}`);
  if (!stats) { console.log('\nFAILURES — __stats 가 없습니다.'); process.exit(1); }
  const { R } = stats;
  const LN = ['상층 7.5km', '중층 2.5km', '저층 1.2km'];

  console.log('\n== 1. 관측자 고도가 층 직달 표에 새지 않는가 (관측 0m 대비 최대 칸 차) ==');
  for (const obsM of [545, 760, 1600]) {
    const cs = R.cases.filter(c => c.obsM === obsM);
    for (let r = 0; r < 3; r++) {
      const worst = Math.max(...cs.map(c => c.rowDiff[r]));
      console.log(`  관측 ${String(obsM).padStart(4)}m · ${LN[r]}: 해 ${cs.map(c => c.sun + '° ' + c.rowDiff[r]).join(' · ')}`);
      ok(worst === 0, `관측 ${obsM}m · ${LN[r]} — 직달 표가 관측 0m 와 같다 (최대 ${worst}칸)`);
    }
  }

  console.log('\n== 2. 표 = 층 높이(해면 기준)에서 푼 광선 적분 ==');
  for (let r = 0; r < 3; r++) {
    const per = [0, 545, 760, 1600].map(o => Math.max(...R.cases.filter(c => c.obsM === o).map(c => c.anchorDiff[r])));
    console.log(`  ${LN[r]}: 관측 0 · 545 · 760 · 1600m → 최대 ${per.join(' · ')}칸`);
    const worst = Math.max(...per);
    ok(worst <= 1, `${LN[r]} — 모든 관측 고도·해 고도에서 한 칸 안 (최대 ${worst}칸)`);
  }

  console.log('\n== 3. 구름 속 안개의 직달 = 관측자 자리의 직달 ==');
  for (const obsM of [0, 545, 760, 1600]) {
    const cs = R.cases.filter(c => c.obsM === obsM && c.sun > 0);
    const worst = Math.max(...cs.map(c => c.fogRel));
    ok(cs.every(c => c.fogOn), `관측 ${obsM}m — 안개가 켜졌다`);
    ok(worst < 1e-5, `관측 ${obsM}m — 안개 직달 상대 오차 ${worst.toExponential(1)} < 1e-5`);
  }

  console.log('\n== 대조: 층 높이 0.76km 차이를 이 자가 보는가 (해 0°, 관측 0m) ==');
  console.log(`  줄별 최대 칸 차: ${R.control.map((v, r) => LN[r] + ' ' + v).join(' · ')}`);
  ok(Math.min(...R.control) > 2, `세 줄 모두 2칸 넘게 다르다 (최소 ${Math.min(...R.control)}칸)`);

  console.log('\n참고 — 예전 셈(관측 고도 + 층 높이)이 층 높이 대비 몇 배였나 (휘도, R/B 옳은값→예전값)');
  for (const e of R.effect) {
    console.log(`  관측 ${String(e.obsM).padStart(4)}m · 층 ${e.km}km · 해 ${String(e.sun).padStart(2)}°: ${e.ratio ?? '-'}배  (R/B ${e.rbRight ?? '-'} → ${e.rbOld ?? '-'})`);
  }

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
