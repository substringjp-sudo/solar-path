/**
 * `build-terrain-occlusion.js` 의 결과를 판정합니다.
 * 무엇을 왜 재는지는 그 파일 머리말에 있습니다.
 *
 * 사용: node tools/shader-preview/build-terrain-occlusion.js
 *       node tools/shader-preview/verify-terrain-occlusion.js
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
  const p = await b.newPage({ viewport: { width: 1000, height: 800 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/terrain-occlusion.html', { timeout: 300000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 300000 });
  const R = JSON.parse(await p.$eval('#out', el => el.textContent));
  await b.close();

  console.log(`\n  ${R.site} 발밑 ${R.obsM}m · 지평선 −${R.dipDeg}° · 화각 ${R.FOVY}° · 방위 ${R.AZ}°`);
  console.log(`  능선 꼭대기 ${R.ridgeTopDeg}°\n`);

  ok(pageErrors.length === 0 && (R.errors || []).length === 0,
     `페이지 오류 없음 ${JSON.stringify([...(R.errors || []), ...pageErrors]).slice(0, 120)}`);
  ok(R.glError === 0, `glGetError == 0 (${R.glError})`);

  console.log('\n[1] 자가 지형을 보고 있는가 (양성·양방향 대조)');
  ok(R.terrainSeen > 500,
     `지형을 끄면 ${R.terrainSeen}화소가 달라진다 — 자가 지형을 본다`);
  ok(R.sameTwice === 0,
     `같은 조건 두 번은 완전히 같다 (${R.sameTwice}화소) — 렌더 순서 탓이 아니다`);

  console.log('\n[2] 먼 지형이 가까운 지형을 뚫고 나오는가  ← 사용자 1번 "반투명한 계곡"');
  console.log(`      가까운 지형이 덮은 화소 ${R.far.nearCovered} 중 뚫린 것: ${R.far.leak}`);
  ok(R.far.nearCovered > 300, `양성 대조: 가까운 지형이 덮은 자리가 충분하다 (${R.far.nearCovered}화소)`);
  ok(R.far.leak === 0, `먼 지형이 가까운 지형을 안 뚫는다 (${R.far.leak}화소)`);

  console.log('\n[2b] 밴드 × 태양 네 조합 — 추론 대신 직접');
  const g = R.grid;
  console.log(`      밴드O 태양X ${g.bandsOn_sunOff}   밴드O 태양O ${g.bandsOn_sunOn}`);
  console.log(`      밴드X 태양X ${g.bandsOff_sunOff}   밴드X 태양O ${g.bandsOff_sunOn}`);
  ok(g.bandsOn_sunOff > 20 && g.bandsOff_sunOff < 20,
     `양성 대조: 밴드가 그 자리를 칠하고 있다 (${g.bandsOn_sunOff} 대 ${g.bandsOff_sunOff})`);
  ok(Math.abs(g.bandsOn_sunOn - g.bandsOn_sunOff) < 5,
     `산이 태양을 가린다 — 태양을 켜도 산 밝기 그대로 (${g.bandsOn_sunOff} → ${g.bandsOn_sunOn})`);

  console.log('\n[3] 태양이 능선에 가려지는가  ← 사용자 1번 "해가 산보다 위에"');
  const lo = R.sunBelowRidge, hi = R.sunAboveRidge;
  console.log(`      능선 아래 태양 ${lo.altDeg.toFixed(2)}° → 평균 +${lo.meanDelta} · 최대 +${lo.peakDelta}`);
  console.log(`      능선 위   태양 ${hi.altDeg.toFixed(2)}° → 평균 +${hi.meanDelta} · 최대 +${hi.peakDelta}`);
  ok(hi.peakDelta > 20, `양성 대조: 능선 **위** 태양은 화면을 밝힌다 (최대 +${hi.peakDelta})`);
  ok(lo.peakDelta < 5, `능선 **아래** 태양은 씬 안에서 가려진다 (최대 +${lo.peakDelta})`);

  console.log('\n[4] 후처리가 태양을 지형 위로 번지게 하는가');
  const f = (o) => `평균 ${o.mean} · 최대 ${o.peak} · 화면변화 ${o.anyChanged}화소 (광선세기 ${o.rayGain})`;
  console.log(`      끔        ${f(R.postOff)}`);
  console.log(`      블룸만    ${f(R.postBloom)}`);
  console.log(`      광선만    ${f(R.postRays)}`);
  ok(R.postOff.n > 300, `양성 대조: 지형 화소를 충분히 잡았다 (${R.postOff.n}화소)`);

  // ⚠ 공허한 통과를 막는 양성 대조 셋. 이게 없어서 첫 판이 광선 세기 0 으로
  //   "안 샌다" 를 통과시켰습니다.
  ok(R.postRays.rayGain > 0,
     `양성 대조: 박명광선이 정말 켜져 있다 (세기 ${R.postRays.rayGain})`);
  ok(R.postBloom.anyChanged > 50,
     `양성 대조: 블룸이 화면을 실제로 바꾼다 (${R.postBloom.anyChanged}화소)`);
  ok(R.postRays.anyChanged > 50,
     `양성 대조: 광선이 화면을 실제로 바꾼다 (${R.postRays.anyChanged}화소)`);

  ok(R.postOff.peak < 5, `후처리를 끄면 지형이 안 밝아진다 (최대 +${R.postOff.peak})`);
  ok(R.postBloom.peak < 5, `블룸이 지형 위로 안 샌다 (최대 +${R.postBloom.peak})`);
  ok(R.postRays.peak < 5, `박명광선이 지형 위로 안 샌다 (최대 +${R.postRays.peak})`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
