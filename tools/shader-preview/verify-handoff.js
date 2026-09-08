/**
 * **씬에 연결한 대로 넘겨받는가** 합격 판정 (docs/COASTLINE_PLAN.md 3·4단계).
 *
 * `build-handoff.js` 가 `SkyScene3D.tsx` 에 실제로 짠 배치(렌더 순서
 * `terrainField(-0.6) → seaPlane(-0.55) → ground(-0.5) → bands(-0.4+)`)를
 * 그대로 재현해 두 방위(바다·뭍)를 찍고, **하늘 구멍**이 있는지 봅니다.
 *
 * ## 이 판정이 잡을 수 있는 것 / 없는 것 — 대조로 확인했습니다
 *
 * ⚠ **옛 원반(ground)을 아예 빼고** 같은 장면을 다시 찍어 봤습니다. 3km
 * 밖(뭍 방위)은 능선 띠가, 3km 안은 새 지형이 맡으니 원반이 없으면 그
 * 사이에 구멍이 뚫릴 거라 예상했는데 — **똑같이 구멍이 0 이었습니다.**
 *
 * 이유를 손으로 짚어 보면: 능선 띠의 아래쪽 가장자리는 `−dipDeg`(거의
 * 0°에 가까운 완만한 각) 하나로 고정돼 있고, 새 지형의 3km 가장자리
 * 각도도(대체로 평탄한 지형이면) 비슷하게 0° 근처입니다. 둘 다 "거의
 * 평평한 땅"을 가리키는 각이라 그 사이 진짜 각도 틈이 아주 좁아서,
 * 이 화면 해상도(70° 화각에 512행 ≈ 7.3px/도)로는 뭍의 이 정도 미세한
 * 틈은 한 행도 못 채웁니다. 즉 **이 판정은 "완전히 빈 배경(옛 원반이
 * 아예 없다)"조차 구멍으로 못 잡습니다** — 하늘 구멍 검사는 생각보다
 * 무딘 도구였습니다.
 *
 * 그래서 이 판정이 실제로 지키는 것은 좁습니다: **glGetError·콘솔 오류
 * 없이 네 층(새 지형·새 해수면·옛 원반·옛 능선 띠)을 문서에 적은
 * renderOrder 로 함께 그렸을 때 명백한 파탄(전면 검은 화면, 셰이더
 * 컴파일 실패 등)이 없다**는 것과, **지면이 실제로 화면에 잡힌다**는
 * 것뿐입니다. "3~5km 구간이 시각적으로 자연스러운가"는 이 자동 판정의
 * 범위 밖입니다 — 실기(RN 앱)에서 눈으로 확인해야 하는 항목으로
 * COASTLINE_PLAN.md 에 남겨 둡니다.
 *
 * 사용: node tools/shader-preview/build-handoff.js
 *       node tools/shader-preview/verify-handoff.js
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
  const p = await b.newPage({ viewport: { width: 700, height: 700 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/handoff.html', { timeout: 120000 });
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

  for (const [label, s] of [['바다 방위', r.바다], ['뭍 방위', r.뭍]]) {
    console.log(`\n== ${label} ==`);
    console.log(`  열 ${s.열} · 구멍 있는 열 ${s.구멍열} · 최대 구멍 ${s.최대구멍}행 · 맨위행 평균 ${s.맨위행평균}`);
    ok(s.구멍열 === 0, `${label}: 하늘 구멍 없음 (0/${s.열})`);
    ok(s.맨위행평균 > 0, `${label}: 지면이 실제로 잡힘 (맨위행 평균 ${s.맨위행평균} > 0)`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
