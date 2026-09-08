/**
 * **하늘 되비침(프레넬)이 붙었는가** 합격 판정 — 3번(씬 연결) 부수 작업.
 *
 * 2·4·5단계의 지형/해수면을 실제 앱 씬에 연결하는 작업 중, 49절에서 고친
 * 물빛(프레넬로 하늘을 비추는 것)이 새 `SeaPlane.ts` 에는 아직 없다는 것을
 * 발견했습니다. 없이 연결하면 씬을 바꾸는 순간 노을에도 물이 상수색
 * 평면으로 되돌아가는 **퇴보**입니다. 그래서 `waterFresnel` + `atm_
 * skyRadiance` 를 옮겨 붙이고, 그 항만 DEM 없이 고립시켜 여기서 잽니다.
 *
 * `patch: null` 로 두면 수심·바닥비침·포말이 전부 꺼져(모두 999/모름),
 * 물빛이 `mix(body, skyRefl, Fv(cosV))` 하나로만 정해집니다. `body`
 * 는 상수라 미리 압니다.
 *
 * ## 잡은 결함 — 판정 자신의 것
 *
 * 처음에 "해쪽" 대 "반대" 샷을 만들 때 **카메라 방위와 태양 방위를 같이**
 * 돌렸습니다. 그러면 카메라가 어느 쪽을 보든 태양도 그쪽에 있어 거울
 * 방향이 항상 태양을 정면으로 보는 기하가 되고, 두 샷이 **완전히 똑같이**
 * 나왔습니다(방위 대비 0). 태양은 한 자리에 고정하고 카메라만 돌려야
 * 거울 방향의 태양 정렬(cosG)이 실제로 갈립니다.
 *
 * 사용: node tools/shader-preview/build-sea-reflect.js
 *       node tools/shader-preview/verify-sea-reflect.js
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
  const p = await b.newPage({ viewport: { width: 700, height: 600 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/sea-reflect.html', { timeout: 120000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null,
    { timeout: 120000, polling: 500 }).catch(() => {});

  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0, `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats || !stats.결과) { console.log('\nFAILURES — __stats.결과 가 없습니다.'); process.exit(1); }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);
  const r = stats.결과;

  console.log('\n== 대조: uFresnel 을 끄면 상수색이어야 함 ==');
  console.log(`  body 평균 ${r.body평균} · 변동폭 ${r.body변동폭}`);
  // uFresnel=0 이면 col=body 하나뿐 — 시야각과 무관하게 상수여야 합니다.
  ok(r.body변동폭 <= 3, `끄면 시야각과 무관 (변동폭 ${r.body변동폭} ≤ 3)`);

  console.log('\n== Fv 가 클수록(스치는 각) body 에서 멀어지는가 ==');
  console.log(`  표본 ${r.표본} · 낮은 Fv 평균 |켬−끔| ${r.낮은Fv평균편차} · 높은 Fv 평균 ${r.높은Fv평균편차}`);
  console.log(`  Fv 오름차순으로 편차가 5 이상 거꾸로 튄 횟수 ${r.역전횟수}`);
  ok(r.낮은Fv평균편차 <= 5, `발밑(낮은 Fv)은 거의 body 그대로 (${r.낮은Fv평균편차} ≤ 5)`);
  ok(r.높은Fv평균편차 >= 50, `수평선 쪽(높은 Fv)은 body 에서 크게 벗어남 (${r.높은Fv평균편차} ≥ 50)`);
  ok(r.높은Fv평균편차 > r.낮은Fv평균편차 * 5,
    `되비침이 실제로 Fv 를 따라감 (${r.높은Fv평균편차} ≫ ${r.낮은Fv평균편차})`);
  ok(r.역전횟수 <= r.표본 * 0.05,
    `대체로 단조 — 역전이 5% 안 (${r.역전횟수}/${r.표본})`);

  console.log('\n== 태양 방위 정렬 (cosG) — 해쪽이 반대보다 밝아야 함 ==');
  const az = r.방위별;
  console.log(`  Fv>0.5 표본 ${az.length}개`);
  az.slice(0, 5).forEach(a => console.log(`  fv=${a.fv}  해쪽 ${a.해쪽}  반대 ${a.반대}`));
  ok(az.length >= 5, `표본이 충분 (${az.length}개)`);
  const 해쪽밝음 = az.filter(a => a.해쪽 > a.반대).length;
  ok(해쪽밝음 === az.length,
    `모든 표본에서 태양 쪽을 볼 때가 더 밝음 (${해쪽밝음}/${az.length})`);
  const meanGap = az.reduce((s, a) => s + (a.해쪽 - a.반대), 0) / az.length;
  ok(meanGap >= 10, `방위 대비가 실제로 있음 (평균 차 ${meanGap.toFixed(1)} ≥ 10)`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
