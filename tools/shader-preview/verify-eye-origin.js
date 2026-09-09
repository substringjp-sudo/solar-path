/**
 * **눈이 메시 원점에 있는가** 합격 판정. `build-eye-origin.js` 의 짝.
 *
 * ## 무엇을 못 박나
 *
 * 지형 격자는 실좌표가 아니라 **각도**로 놓입니다 (`gp_project`). 그 각의
 * 기준점이 메시 원점이므로, 카메라가 원점에서 벗어나면 계산한 각이 화면에
 * 그대로 안 나옵니다. 시선을 그대로 두고 눈만 올렸다 내리면 화면은 **한
 * 화소도** 안 변해야 합니다.
 *
 * 옛 방식(메시 Y=0 고정)에서는 이렇게 어긋났습니다:
 *
 *   해수면 관측지 (카메라 +1.26) : 하늘금 0.13°~0.36° **아래로**
 *   350m 관측지  (카메라 −3.43) : 하늘금 0.51°~0.90° **위로**
 *
 * 관측지 고도에 따라 **부호가 뒤집히고** 방위마다 크기가 다릅니다 — 하늘금이
 * 걸리는 거리가 달라 고리 반경이 다르기 때문입니다. 한 값으로 보정할 수 없는,
 * 하늘금의 **모양**을 바꾸는 어긋남입니다.
 *
 * ⚠ 다른 하네스는 이걸 못 잡습니다 — 거의 모두 카메라를 (0,0,0) 에 둡니다.
 * 그래서 이 자가 따로 필요합니다.
 *
 * 사용: node tools/shader-preview/build-eye-origin.js
 *       node tools/shader-preview/verify-eye-origin.js
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
  const p = await b.newPage({ viewport: { width: 960, height: 760 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/eye-origin.html', { timeout: 300000 });
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
  console.log('\n== 카메라만 올렸다 내렸을 때 하늘금이 움직인 각 ==');
  for (const [site, rows] of Object.entries(r)) {
    console.log(`  ${site}`);
    for (const [k, v] of Object.entries(rows))
      console.log(`    ${k.padEnd(22)} 최대 ${String(v.최대절대).padStart(7)}°`
        + `  (방위 ${v.방위45} / ${v.방위135} / ${v.방위225} / ${v.방위315}`
        + ` · 발밑구멍 ${v.발밑구멍})`);
  }

  console.log('\n== 자가 점검: 이 자가 어긋남을 실제로 볼 수 있는가 ==');
  //
  // ⚠ 이게 먼저입니다. 대조군이 안 걸리면 아래 "0 이다" 는 아무 뜻이 없습니다
  //   — 앞서 발밑을 "가장 위 불투명 화소" 로 쟀을 때 화면이 통째로 땅이라
  //   0 이 나왔고, 그건 차이가 없어서가 아니라 자가 포화한 것이었습니다.
  const legacy = [];
  for (const rows of Object.values(r))
    for (const [k, v] of Object.entries(rows)) if (/옛 방식/.test(k)) legacy.push(v.최대절대);
  ok(legacy.length >= 2, `대조군을 실제로 쟀다 (${legacy.length}가지)`);
  ok(legacy.every(v => v >= 0.1),
    `옛 방식은 눈높이에 따라 지형이 움직인다 — 자가 눈이 멀지 않았다`
    + ` (${legacy.map(v => v.toFixed(3) + '°').join(' · ')})`);

  console.log('\n== 지금은 눈높이와 무관해야 한다 ==');
  for (const [site, rows] of Object.entries(r))
    for (const [k, v] of Object.entries(rows)) {
      if (/옛 방식/.test(k)) continue;
      ok(v.최대절대 <= 0.01,
        `${site} · ${k.replace(' · 지금', '')}: 지형이 안 움직인다 (최대 ${v.최대절대}° ≤ 0.01°)`);
    }

  console.log('\n== 부호가 뒤집히는 것까지 못 박는다 ==');
  //
  // 해수면 관측지는 카메라가 원점 **위**(+1.26), 350m 관측지는 **아래**(−3.43)라
  // 옛 방식의 어긋남은 방향이 반대여야 합니다. 한 방향으로만 나면 원인이
  // 시차가 아니라 다른 것입니다.
  for (const [site, rows] of Object.entries(r)) {
    const lo = rows['해수면 관측지 · 옛 방식'], hi = rows['350m 관측지 · 옛 방식'];
    if (!lo || !hi) continue;
    ok(lo.방위45 < 0 && hi.방위45 > 0,
      `${site}: 눈이 위면 하늘금이 내려가고 아래면 올라간다`
      + ` (${lo.방위45}° / +${hi.방위45}°)`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
