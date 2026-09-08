/**
 * **DEM 타일이 진짜 고도를 주는가** 합격 판정 (docs/COASTLINE_PLAN.md 1단계).
 *
 * 지금까지 지형은 31방위 × 3거리 = 93점짜리 실루엣이었습니다. 해안선을
 * 그리려면 진짜 높이장이 있어야 하고, 높이장은 **좌표가 맞아야** 쓸모가
 * 있습니다. 한 타일 어긋난 높이장은 안 어긋난 것보다 나쁩니다 — 그럴듯한
 * 산이 엉뚱한 방위에 서기 때문입니다.
 *
 * ## 참조를 둘 씁니다
 *
 * ① **CPU 로 직접 푼 같은 타일.** 빌드 스크립트가 Node 에서 PNG 를 풀어
 *    경위도→전역 타일화소→쌍선형→Terrarium 을 **독립 구현**합니다. 셰이더
 *    쪽은 지상m→블록좌표→UV→텍스처 쌍선형→디코드로 전혀 다른 길을 가므로,
 *    둘이 맞으면 합성 배치·UV·색공간이 전부 맞는 것입니다. 같은 자료이니
 *    문턱은 **0 에 붙습니다**.
 *
 * ② **Open-Meteo elevation API.** 완전히 다른 DEM 입니다. 봉우리에서 20m 씩
 *    갈리는 게 정상이라(우리 115m ↔ 저쪽 137m — Terrarium 을 z13/14/15
 *    최근접으로 따로 확인해도 114/116/115 로 우리 쪽이 맞습니다) 여기서는
 *    **상관과 치우침**만 봅니다. 이걸 엄격한 기준으로 쓰면 남의 자료 차이를
 *    우리 결함으로 읽게 됩니다.
 *
 * ## 문턱은 재서 정했습니다
 *
 * 표본 좌표를 일부러 어긋내고 Open-Meteo 와의 상관이 얼마나 무너지는지
 * 쟀습니다 (줌 13, 타일 한 변 3894m):
 *
 *     어긋남        상관     중앙오차  최대오차
 *     없음         0.9687      2.5m    21.7m
 *     남 +0.03타일 0.8300      4.2m    60.7m   (117m)
 *     남 +0.1타일  0.6101      7.4m   104.9m   (389m)
 *     남 +0.25타일 0.0281     14.6m   112.6m
 *     남북 반사     0.2850      8.2m   115.8m
 *     한 타일 어긋 −0.12~0.08  9~14m  125~137m
 *
 * 중앙오차는 2.5 → 4.2 밖에 안 움직여 무디고, **평행이동에는 상관이
 * 날카롭습니다**. 그래서 0.90 을 문턱으로 잡습니다 — 117m 어긋남부터 잡힙니다.
 *
 * ## ①과 ②는 서로 못 대신합니다
 *
 * 합성 뒤집기를 **일부러 되살려** 확인했습니다. 관측자 타일이 블록 정중앙에
 * 있으므로 뒤집기는 표본 무게중심에 대한 **반사**가 되고, 그러면 자료 전체의
 * 분포가 거의 안 변합니다:
 *
 *     뒤집기 되살림:  상관 0.9118 (통과!) · 치우침 −2.82m (통과!)
 *                     CPU 최대오차 42.11m  ← 이것만 잡았습니다
 *
 * 즉 ②만 있으면 이 결함을 **놓칩니다**. 반대로 평행이동은 ②가 잘 잡습니다.
 * 둘 다 있어야 합니다.
 *
 * 그리고 ① 에서도 **중앙**이 아니라 **최대**가 일하는 값입니다. 반사는 가운데
 * 표본을 안 건드리므로 중앙오차는 뒤집힌 채로도 0m 였습니다.
 *
 * ## 이 판정이 실제로 잡은 것
 *
 *  · 합성할 때 타일 줄을 위아래로 뒤집어 놓아 블록 y 가 반사됨 → 최대 137m
 *  · 2×2 블록이면 관측자에서 한 타일 남는다고 잘못 알아 표본이 가장자리로
 *    뭉개짐 (보장되는 여유는 (한 변 − 1) / 2 타일) → 최대 50.6m
 *
 * 준비:
 *   node tools/shader-preview/build-dem-check.js
 *   node tools/shader-preview/stage-esm.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-dem.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

/** 빌드 스크립트와 같은 값이어야 합니다 (표본 반경). */
const RADIUS_M = 3000;

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1220, height: 800 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/dem-check.html', { timeout: 80000 });
  await p.waitForTimeout(12000);

  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0,
    `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats || !stats.결과) {
    console.log('\nFAILURES — __stats.결과 가 없습니다. 타일을 못 받았을 수 있습니다.');
    process.exit(1);
  }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);

  const r = stats.결과;

  console.log('\n== 블록 기하 ==');
  console.log(`  줌 ${r.zoom} · 타일 한 변 ${r.tileSpanM}m · 블록 ${r.블록}×${r.블록}`);
  ok(r.블록 % 2 === 1, `블록 한 변이 홀수 — 관측자 타일이 정중앙 (${r.블록})`);
  const marginM = ((r.블록 - 1) / 2) * r.tileSpanM;
  console.log(`  가장자리까지 여유 ${marginM.toFixed(0)}m`);
  ok(marginM >= RADIUS_M,
    `표본 반경 ${RADIUS_M}m 가 블록 안 (여유 ${marginM.toFixed(0)}m)`);
  ok(r.덮임 === 1, `타일이 하나도 안 빠짐 (덮임 ${r.덮임})`);
  // 관측자는 가운데 타일 안에 있어야 합니다.
  const half = (r.블록 - 1) / 2;
  ok(r.관측자U >= half && r.관측자U <= half + 1 &&
     r.관측자V >= half && r.관측자V <= half + 1,
    `관측자가 가운데 타일 안 (${r.관측자U}, ${r.관측자V})`);

  console.log('\n== ① 같은 자료 — 셰이더 대 CPU 디코드 ==');
  console.log(`  표본 ${r.표본}점 · 중앙 ${r.CPU중앙오차}m · 최대 ${r.CPU최대오차}m`);
  // 읽어들이는 값은 8비트 세 채널로 다시 싸서 돌아오므로 양자화가 ~0.004m
  // 남습니다. 그 이상 벌어지면 배치나 UV 가 어긋난 것입니다.
  // ⚠ 일하는 값은 **최대**입니다. 반사형 결함은 가운데를 안 건드려서
  //   중앙오차가 0m 인 채로 통과합니다 (위 대조 실험 참고).
  ok(r.CPU중앙오차 <= 0.05, `중앙오차가 양자화 수준 (${r.CPU중앙오차}m ≤ 0.05m)`);
  ok(r.CPU최대오차 <= 0.1, `최대오차도 양자화 수준 (${r.CPU최대오차}m ≤ 0.1m)`);

  console.log('\n== ② 다른 자료 — 셰이더 대 Open-Meteo ==');
  console.log(`  상관 ${r.참조상관} · 치우침 ${r.참조치우침}m · 중앙 ${r.참조중앙오차}m · 최대 ${r.참조최대오차}m`);
  // 위 표 참고: 0.03타일(117m) 어긋나면 0.83 으로 떨어집니다.
  ok(r.참조상관 >= 0.90, `좌표가 맞음 — 상관 ${r.참조상관} ≥ 0.90`);
  ok(Math.abs(r.참조치우침) <= 5,
    `해수면 기준이 맞음 — 치우침 ${r.참조치우침}m (|·| ≤ 5m)`);

  console.log('\n== 해안선의 재료 ==');
  console.log(`  바다(참조 0m) 평균 ${r.바다평균}m · 뭍(참조 ≥20m) 평균 ${r.뭍평균}m`);
  ok(r.뭍평균 - r.바다평균 >= 20,
    `물과 뭍이 갈림 (차 ${(r.뭍평균 - r.바다평균).toFixed(1)}m ≥ 20m)`);
  ok(Math.abs(r.바다평균) <= 5, `바다가 해수면 근처 (${r.바다평균}m)`);
  const spread = r.화면범위[1] - r.화면범위[0];
  ok(spread >= 50, `높이장이 상수가 아님 (폭 ${spread.toFixed(1)}m ≥ 50m)`);

  // run-all.js 가 이 문구에서 통과 수를 뽑습니다 — 형식을 지킵니다.
  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
