/**
 * **산이 제 뒤 땅에 그림자를 드리우는가** 합격 판정.
 * `build-terrain-shadow.js` 의 짝.
 *
 * 넣기 전에는 지면 조명이 램버트 `ndl` 하나였습니다 — 그건 "제 사면이 해를
 * 등졌는가"만 답합니다. 산이 그 뒤 땅을 가리는지는 아무도 묻지 않았고,
 * 그래서 그림자 화소가 **0** 이었습니다.
 *
 * 면적만 보면 "어디든 어둡게 칠하기"가 만점을 받으므로 대조를 넷 답니다:
 * 해를 올리면 사라질 것, 해 방위를 돌리면 자리가 바뀔 것, 평평한 땅에는
 * 안 생길 것, 그늘이 새까맣지 않을 것(하늘 몫은 남아야 합니다).
 *
 * 사용: node tools/shader-preview/build-terrain-shadow.js
 *       node tools/shader-preview/verify-terrain-shadow.js
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
  await p.goto(ORIGIN + '/terrain-shadow.html', { timeout: 240000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null,
    { timeout: 240000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0, `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats || !stats.결과 || !stats.결과.고도훑기) {
    console.log('\nFAILURES — __stats.결과 가 없습니다.'); process.exit(1);
  }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);
  const r = stats.결과;

  console.log('\n== 해 고도별 그늘 ==');
  for (const s of r.고도훑기)
    console.log(`  해 ${String(s.고도).padStart(2)}° · 그늘 ${s.그늘화소}/${s.지면화소} (${s.그늘비율}%)`
      + ` · 그늘 밝기 ${s.그늘평균밝기} vs 양지 ${s.양지평균밝기}`);
  console.log(`\n== 대조 ==`);
  console.log(`  해 방위 뒤집기: ${r.방위대조.앞} vs ${r.방위대조.뒤}화소 · 겹침(IoU) ${r.방위대조.IoU}`);
  console.log(`  평판(DEM 없음): 그늘 ${r.평판.그늘화소}/${r.평판.지면화소}화소`);

  console.log('\n== 판정 ==');
  const low = r.고도훑기[0], high = r.고도훑기[r.고도훑기.length - 1];

  ok(low.그늘비율 >= 3, `낮은 해에 그늘이 실제로 진다 (해 ${low.고도}° 에서 ${low.그늘비율}% ≥ 3%)`);

  const ratios = r.고도훑기.map(s => s.그늘비율);
  ok(ratios.every((v, i) => i === 0 || v <= ratios[i - 1]),
    `대조 ①: 해가 높아질수록 그늘이 줄어든다 (${ratios.join('% → ')}%)`);
  ok(high.그늘화소 === 0,
    `대조 ①: 해가 머리 위(${high.고도}°)면 가리는 것이 없다 (${high.그늘화소}화소)`);

  ok(r.방위대조.IoU <= 0.25,
    `대조 ②: 해 방위를 180° 돌리면 그늘 자리가 바뀐다 (IoU ${r.방위대조.IoU} ≤ 0.25)`);
  ok(r.방위대조.앞 > 0 && r.방위대조.뒤 > 0,
    `대조 ②: 두 방위 모두 그늘이 있다 (${r.방위대조.앞}, ${r.방위대조.뒤}화소)`);

  ok(r.평판.그늘화소 === 0 && r.평판.지면화소 > 1000,
    `대조 ③: 평평한 땅에는 그늘이 없다 (${r.평판.그늘화소}/${r.평판.지면화소}화소)`);

  // 대조 ④ — 그늘도 하늘은 봅니다. 새까매지면 직달이 아니라 조도를 깎은 것.
  const dark = r.고도훑기.filter(s => s.그늘화소 > 100);
  ok(dark.every(s => s.그늘평균밝기 >= 20),
    `대조 ④: 그늘이 새까맣지 않다 — 하늘 몫이 남는다 (${dark.map(s => s.그늘평균밝기).join(', ')} ≥ 20)`);
  ok(dark.every(s => s.그늘평균밝기 <= 0.6 * s.양지평균밝기),
    `그래도 뚜렷이 어둡다 (${dark.map(s => (s.그늘평균밝기 / s.양지평균밝기).toFixed(2)).join(', ')} ≤ 0.6)`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
