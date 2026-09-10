/**
 * **스냅샷 검은 화면** 합격 판정. `build-snapshot-layers.js` 의 짝.
 *
 * 실기 보고: "3d 시뮬레이션 예측도 여전히 안보이고 검은색으로만 나와."
 *
 * ## 못 박는 것
 *
 * 이 장면의 객체는 전부 레이어 1~4 에 있고 **레이어 0 에는 아무것도
 * 없습니다.** three.js 카메라의 기본 마스크는 레이어 0 하나뿐이므로,
 * 컴포저를 안 거치고 `renderer.render(scene, camera)` 를 부르면
 * **아무것도 안 그려집니다.** 남는 것은 지우기색(검정)입니다.
 *
 * 잰 값:
 *
 *   직접(기본 마스크)   평균밝기   0.00   검은화소  100%
 *   레이어 다 켬        평균밝기 197.36   검은화소    0%
 *   다시 기본 마스크    평균밝기   0.00   검은화소  100%
 *
 * 셋째 줄이 대조입니다 — 레이어 말고 아무것도 안 바꿨는데 그림이 갔다
 * 왔다 하므로, 원인이 레이어 마스크 하나로 좁혀집니다.
 *
 * ⚠ **이 판정은 앱의 고침을 직접 재지 않습니다.** 고침은 스냅샷을
 * `composer.render(...)` 로 그리게 바꾼 것이고, `SkyScene3D.tsx` 는
 * `stage-esm.js` 목록에 없어(하네스는 `.ts` 모듈만 씁니다) 여기서 실행할
 * 수 없습니다. 여기서 지키는 것은 **기전**입니다 — 레이어 마스크를 안
 * 맞추고 그리면 검은 화면이 나온다는 사실. 컴포저가 레이어를 켠다는 것은
 * `SceneComposer.ts` 의 `camera.layers.set(...)` 호출로 코드에서
 * 확인됩니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/build-snapshot-layers.js
 * 사용: node tools/shader-preview/verify-snapshot-layers.js
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
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/snapshot-layers.html', { timeout: 300000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null,
    { timeout: 300000, polling: 500 }).catch(() => {});
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
  console.log('\n== 잰 값 ==');
  for (const k of Object.keys(r))
    console.log(`  ${k.padEnd(20)} 평균밝기 ${String(r[k].평균밝기).padStart(7)}   검은화소 ${(r[k].검은화소비*100).toFixed(1)}%`);

  console.log('\n== 기본 마스크로 직접 그리면 검다 (실기 증상) ==');
  ok(r.직접_기본마스크.평균밝기 < 0.5,
    `직접 그리기는 완전히 검다 (평균밝기 ${r.직접_기본마스크.평균밝기})`);
  ok(r.직접_기본마스크.검은화소비 > 0.999,
    `화소가 하나도 안 그려졌다 (검은화소 ${(r.직접_기본마스크.검은화소비*100).toFixed(1)}%)`);

  console.log('\n== 레이어만 켜면 그림이 돌아온다 (원인을 좁히는 대조) ==');
  ok(r.레이어_다켬.평균밝기 > 100,
    `레이어를 다 켜면 밝다 (평균밝기 ${r.레이어_다켬.평균밝기})`);
  ok(r.레이어_다켬.검은화소비 < 0.01,
    `검은 화소가 사라진다 (${(r.레이어_다켬.검은화소비*100).toFixed(1)}%)`);

  console.log('\n== 되돌리면 다시 검다 — 한 방향 우연이 아니다 ==');
  //
  // ⚠ 이 줄이 없으면 "레이어를 켜서 밝아졌다"가 아니라 "두 번째 렌더라
  //   밝아졌다"일 수도 있습니다. 세 번째로 되돌려 다시 검어지는 것을 봐야
  //   원인이 레이어 하나로 좁혀집니다.
  ok(r.다시_기본마스크.평균밝기 < 0.5,
    `마스크를 되돌리면 다시 검다 (평균밝기 ${r.다시_기본마스크.평균밝기})`);
  ok(Math.abs(r.다시_기본마스크.평균밝기 - r.직접_기본마스크.평균밝기) < 0.5,
    `첫 번째와 세 번째가 같다 — 순서가 아니라 마스크가 정한다`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
