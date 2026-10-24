/**
 * **DEM 에서 굽는 하늘 보임(AO)이 맞는가** 합격 판정 (§156 — `terrainAmbient.ts`). `build-terrain-ambient.js` 의 짝.
 *
 * 하늘빛 몫 맵이 틀리면 화면의 형태 단서가 거꾸로 됩니다. 그런데 맵은 **어디서도 눈으로 확인되지 않습니다** —
 * 지형 셰이더 안에서 한 번 곱해질 뿐이라, 좌표나 방향 규약이 틀려도 "그럴듯하게 어두운" 그림이 나옵니다.
 * 그래서 맵 화소를 CPU 가 따로 구한 값과 견주고, **대조**를 둡니다: 같은 CPU 식을 동·남을 바꿔 읽은 값은 셰이더와
 * 크게 어긋나야 합니다(어긋나지 않으면 이 자가 눈먼 것 — 표본이 방향에 둔감한 평지뿐이라는 뜻).
 *
 * 준비: node tools/shader-preview/build-terrain-ambient.js
 *       node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/verify-terrain-ambient.js
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
  const p = await b.newPage({ viewport: { width: 700, height: 300 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/terrain-ambient.html', { timeout: 120000, waitUntil: 'commit' });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 900000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0, `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건${errs.length ? ' — ' + errs[0].slice(0, 200) : ''})`);
  if (!stats || !stats.결과) { console.log('\nFAILURES — __stats.결과 가 없습니다.'); process.exit(1); }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);
  const r = stats.결과;
  ok(Object.keys(r).length === 2, `두 곳을 다 쟀다 (${Object.keys(r).join(', ')})`);

  for (const [k, v] of Object.entries(r)) {
    console.log(`\n== ${k} == (맵 ${v.size}², 굽기 ${v.굽기ms}ms, 표본 ${v.표본})`);
    console.log(`  V   평균오차 ${v.V평균오차} · 최대오차 ${v.V최대오차}   | 볼록도 평균 ${v.볼록평균오차} · 최대 ${v.볼록최대오차}`);
    console.log(`  가려진 곳(V<0.9) 개수 GPU ${v.GPU_V작은개수} · CPU ${v.CPU_V작은개수}   V 최소 GPU ${v.GPU_V최소} · CPU ${v.CPU_V최소}`);
    console.log(`  대조(동·남을 바꿔 읽은 CPU 값) 평균오차 ${v.대조평균오차}`);
    ok(v.ok === true && v.again === true, `${k}: 굽고, 같은 패치로 다시 부르면 그대로 쓴다`);
    // 8비트 출력(1/255 = 0.004) + 쌍선형 부동소수 차이 안쪽이어야 합니다.
    ok(v.V평균오차 <= 0.004, `${k}: 하늘 보임이 CPU 참조와 같다 (평균오차 ${v.V평균오차} ≤ 0.004)`);
    ok(v.V최대오차 <= 0.02, `${k}: 최악의 화소도 맞다 (최대오차 ${v.V최대오차} ≤ 0.02)`);
    ok(v.볼록평균오차 <= 0.006, `${k}: 볼록도도 맞다 (평균오차 ${v.볼록평균오차} ≤ 0.006)`);
    ok(v.평지일치, `${k}: 사방이 트인 평지(CPU V > 0.995)는 GPU 도 트였다고 한다`);
    // 기복이 있는 곳(CPU 가 가려진 곳을 20개 넘게 찾음)에서만 가림·대조를 따집니다 — 평지 대조군(대부도)은 가려진 곳이
    // 아예 없어, 방향에 둔감한 표본뿐이라 대조가 무의미합니다. 거기서는 GPU 도 가려진 곳을 지어내지 않는 것만 봅니다.
    const relief = v.CPU_V작은개수 >= 20;
    ok(Math.abs(v.GPU_V작은개수 - v.CPU_V작은개수) <= 3,
      `${k}: 하늘이 가려진 곳의 수가 같다 (GPU ${v.GPU_V작은개수} 대 CPU ${v.CPU_V작은개수}, 차 ≤ 3)`);
    if (relief) {
      // 대조 — 이 자가 방향을 가리는지.
      ok(v.대조평균오차 >= 5 * Math.max(v.V평균오차, 0.002),
        `${k}: 대조 — 동·남을 바꾸면 크게 어긋난다 (${v.대조평균오차} ≥ ${(5 * Math.max(v.V평균오차, 0.002)).toFixed(4)}) — 자가 눈멀지 않았다`);
    } else {
      console.log(`  (기복 없는 대조군 — 가려진 곳 ${v.CPU_V작은개수}개라 방향 대조는 건너뜁니다)`);
    }
  }

  ok(Object.values(r).some(v => v.CPU_V작은개수 >= 20), `기복 있는 곳이 하나 이상 있다 — 가림·방향 대조를 실제로 쟀다`);
  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
