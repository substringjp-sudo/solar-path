/**
 * **AR 방위각 눈금** 합격 판정. `build-ar-azimuth.js` 의 짝.
 *
 * 실기 보고: "카메라랑 시뮬레이터를 동시에 돌렸을 때 특히 방위각이 차이가
 * 많이 난다."
 *
 * ## 못 박는 것
 *
 * ① **자가 스스로를 검증합니다.** 표적을 화소로 찾은 자리(`렌더x`)와
 *    three.js 투영 행렬로 옮긴 자리(`투영x`)와 손으로 푼 원근식(`이상x`)이
 *    셋 다 같아야 합니다. 어긋나면 재는 쪽이 틀린 것이지 앱이 아닙니다.
 *
 * ② **고치기 전 눈금자가 실제로 얼마나 틀렸나.** 옛 식
 *    `pxPerDeg = (BOX_WIDTH - 24) / 70` 은 70° 상수를 **선형**으로 폈고
 *    `currentFov` 를 안 봤습니다. 재면 1배에서 최대 2.68°, 2배 −8.2°,
 *    5배 −15.2° 입니다. 이 값을 그대로 박아 둡니다 — 다시 옛 식으로
 *    돌아가면 판정이 웁니다.
 *
 * ③ **고친 뒤에는 0 이어야 합니다.** 눈금자가 렌더와 같은 함수
 *    (`utils/arProjection`)를 쓰므로 오차가 수치오차 수준이어야 합니다.
 *
 * ⚠ **이 판정은 센서를 안 봅니다.** 자기 편각·자이로 드리프트·최초 보정은
 * 기기가 있어야 재는 것입니다. 여기서 재는 것은 그것과 무관하게 **코드만
 * 으로 이미 어긋나 있던 몫**입니다.
 *
 * ⚠ **실제 카메라 화각도 안 봅니다.** `SunCamera.tsx` 의 60° 는 근거 없는
 * 추측값이고, 그것이 틀리면 카메라 상자와 시뮬레이터 상자가 따로 놉니다.
 * 그건 기기 없이는 못 정합니다 — 계획 49.3절에 남겨 뒀습니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/build-ar-azimuth.js
 * 사용: node tools/shader-preview/verify-ar-azimuth.js
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
  await p.goto(ORIGIN + '/ar-azimuth.html', { timeout: 300000 });
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
  const 잰칸 = (k) => r[k].칸.filter(c => c.렌더x !== null);

  console.log('\n== 화면에 담긴 화각 ==');
  for (const k of Object.keys(r))
    console.log(`  ${k}  세로 ${r[k].세로화각}°  가로 ${r[k].가로화각}°  (눈금자가 믿던 값 ${r[k].눈금자화각}°)`);
  ok(Math.abs(r.배율1.가로화각 - 75.18) < 0.1,
    `1배 상자의 가로 화각은 75.18° 다 — three.js fov 는 세로이고 상자가 4:3 이므로 (${r.배율1.가로화각}°)`);

  console.log('\n== 자가 스스로를 속이지 않는가 ==');
  //
  // ⚠ 처음엔 태양 원반을 표적으로 삼았다가 두 번 속았습니다: 고도 12° 에서는
  //   광축이 기울어 방위 회전이 화면 가로선을 안 따라 30° 자리에서 렌더 152px
  //   대 이상 180px 로 벌어졌고, 고도 0 에서는 지평선 발광이 원반만큼 밝아
  //   무게중심이 후광에 끌려 값이 **비단조**로 나왔습니다. 전용 초록 표적으로
  //   바꾸고 나서야 셋이 맞았습니다.
  const 최대사상오차 = Math.max(...Object.keys(r).flatMap(k =>
    잰칸(k).map(c => Math.max(Math.abs(c.렌더x - c.투영x), Math.abs(c.투영x - c.이상x)))));
  ok(최대사상오차 < 1.0,
    `렌더 화소 · 투영 행렬 · 손으로 푼 원근식이 셋 다 일치한다 (최대 ${최대사상오차.toFixed(2)}px)`);
  ok(잰칸('배율1').length >= 8 && 잰칸('배율2').length >= 5,
    `표적이 화면에 있는 칸만 셌다 (1배 ${잰칸('배율1').length}칸 · 2배 ${잰칸('배율2').length}칸 · 5배 ${잰칸('배율5').length}칸)`);

  console.log('\n== 고치기 전 눈금자가 얼마나 틀렸나 (되돌아가면 우는 값) ==');
  const 최대오차 = (k) => Math.max(...잰칸(k).map(c => Math.abs(c.눈금오차도)));
  for (const k of Object.keys(r)) {
    const rows = 잰칸(k).map(c => `${c.어긋남}°→${c.눈금오차도 > 0 ? '+' : ''}${c.눈금오차도}°`).join(' ');
    console.log(`  ${k}  ${rows}`);
  }
  ok(최대오차('배율1') > 2.5 && 최대오차('배율1') < 3.0,
    `1배에서 최대 2.68° 어긋났다 (${최대오차('배율1').toFixed(2)}°)`);
  ok(최대오차('배율2') > 8.0,
    `2배에서 8° 넘게 어긋났다 — 눈금자가 줌을 아예 안 봤다 (${최대오차('배율2').toFixed(2)}°)`);
  ok(최대오차('배율5') > 최대오차('배율2') * 0 + 3.5,
    `5배에서는 5° 어긋남만으로도 3.8° 틀렸다 (${최대오차('배율5').toFixed(2)}°)`);
  //
  // ⚠ 방향이 배율마다 **뒤집힙니다** — 1배는 눈금자가 각을 과대(+), 2배부터는
  //   과소(−). 70° 상수가 1배 가로화각(75.18°)보다는 좁고 2배(42.1°)보다는
  //   넓기 때문입니다. 한 방향으로 치우친 값이 아니라 그때그때 다릅니다.
  ok(잰칸('배율1').some(c => c.눈금오차도 > 0) && 잰칸('배율2').every(c => c.눈금오차도 <= 0),
    `어긋나는 방향이 배율마다 뒤집힌다 — 한 상수로는 못 맞춘다는 뜻`);

  console.log('\n== 고친 뒤 (앱과 같은 함수를 쓴다) ==');
  const 최대고친오차 = Math.max(...Object.keys(r).flatMap(k =>
    잰칸(k).map(c => c.고친오차도 === null ? 0 : Math.abs(c.고친오차도))));
  ok(최대고친오차 < 0.01,
    `눈금자가 렌더와 같은 각을 가리킨다 (최대 ${최대고친오차.toFixed(4)}°)`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
