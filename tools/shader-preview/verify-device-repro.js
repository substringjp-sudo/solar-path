/**
 * **실기기 조건** 합격 판정 — `device-repro.html` 을 잽니다.
 *
 * 왜 따로 필요한가: `verify-cloud-slab.js` 는 FOV 62°, 시선 고도 14°,
 * 태양 +8~-3° 만 봅니다. 실기기 캡처는 **FOV 120°, 천정 포함, 태양 -42°**
 * 였고 거기서 그림이 무너졌는데도 그 판정은 8/8 통과했습니다. 사각지대를
 * 못으로 박습니다 — 입력은 화면 QR 에서 디코드한 실측값입니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-device-repro.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-device-repro.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(`${ORIGIN}/device-repro.html`);
  await p.waitForTimeout(26000);
  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0, `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/SHADER_ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats) { console.log('\nFAILURES — __stats 가 없습니다.'); process.exit(1); }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);

  const R = stats.결과;
  const at = (화면, 조건) => R.find(r => r.화면 === 화면 && r.조건.startsWith(조건));

  console.log('\n== 한밤중이 밤처럼 보이는가 ==');
  for (const 화면 of ['23:59 · FOV120', '22:40 · FOV60']) {
    const 청정 = at(화면, '도시광 0 ');
    const 도시 = at(화면, '도시광 1.00');
    console.log(`  ${화면}  청정 R/B ${청정.RB} 휘도 ${청정.평균휘도}` +
                `  |  대도시 R/B ${도시.RB} 휘도 ${도시.평균휘도}`);
    // 광공해가 없으면 밤하늘은 파랗습니다. R/B 가 1을 넘으면 주황입니다.
    ok(청정.RB < 0.55, `${화면} 청정 하늘은 파랗다 (R/B ${청정.RB})`);
    // 도시광을 최대로 켜도 **금색이 되면 안 됩니다.** 예전 값에서는 1.59 였고,
    // 그게 실기기 화면이 한밤중에 금빛이던 이유입니다.
    ok(도시.RB < 1.10, `${화면} 대도시에서도 금색이 아니다 (R/B ${도시.RB})`);
    // 한밤중 화면이 대낮(태양 +25°, 휘도 약 145)만큼 밝으면 안 됩니다.
    ok(도시.평균휘도 < 130, `${화면} 한밤중이 대낮만큼 밝지 않다 (${도시.평균휘도})`);
  }

  console.log('\n== 지평선·천정에 인공 무늬가 서지 않는가 ==');
  const 최대격자 = Math.max(...R.map(r => r.격자성));
  const 최악 = R.find(r => r.격자성 === 최대격자);
  for (const r of R) console.log(`  ${r.화면.padEnd(16)} ${r.조건.padEnd(18)} 격자성 ${r.격자성}`);
  // 1.0 = 등방. 화소 발자국이 노이즈 셀을 넘어서는 지평선 근처에서 앨리어싱이
  // 나면 축 방향 기울기가 몰려 1을 크게 넘습니다.
  ok(최대격자 < 1.06, `어느 조건에서도 축 정렬 무늬가 없다 (최대 ${최대격자} @ ${최악.화면}/${최악.조건})`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
