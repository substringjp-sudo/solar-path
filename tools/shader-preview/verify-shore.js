/**
 * **수심이 물가를 만드는가 · 땅색이 판지가 아닌가** (COASTLINE_PLAN 5단계).
 *
 * 4단계에서 땅/물 경계가 자료가 말하는 자리에 있음을 99.23% 로 확인했습니다.
 * 5단계는 **색**입니다.
 *
 * ## 자리는 CPU 가 말하고, 색만 화면에서 잽니다
 *
 * 화소가 무엇인지는 CPU 광선행진이 정합니다(거리·종류·고도/수심·경사).
 * 기하는 이미 검증됐으므로 여기서는 그 자리의 **색**만 봅니다. 색으로
 * 종류를 되짚으면 순환논법입니다.
 *
 * ## 이 판정이 잡은 결함 넷
 *
 * **1. `slope = 1 − n.y` 는 기울기가 아닙니다.** 흔히 쓰는 축약인데 작은
 * 각에서 θ²/2 라서, 기울기 0.21(12°) 인 사면도 0.022 밖에 안 됩니다. 그걸
 * 기울기 기준 문턱(0.10~0.50)에 넣었더니 **경사 항이 통째로 죽어** 화소
 * 11,366 개의 색조가 **0.5918 하나로 고정**됐습니다. 땅이 판지처럼 보이던
 * 원인이 이것입니다. `tanθ = sqrt(1−n.y²)/n.y` 로 고친 뒤 상관 0.79.
 *
 * **2. Terrarium 의 0 을 0m 수심으로 믿음.** 먼바다가 정확히 0 으로 잘려
 * 있어(1024개 중 406개), 그걸 수심 0m 로 읽으면 바닥이 다 비치고 포말이
 * 1 이 되어 **만 전체가 밝은 모래펄**로 그려집니다. "모르는 곳은 깊다"로
 * 고쳤습니다. 4단계의 함정과 같은 부류가 다른 자리에서 또 나왔습니다.
 *
 * **3. 표시 하한(minGlow)이 음영을 통째로 먹음.** 조도를 낮게 두면 지면이
 * `atm_display_ground` 의 최소 밝기에 눌려 경사도 젖은 모래도 전부 같은 색이
 * 됩니다(젖음 54.26 대 마름 57.21 — 사실상 같음). 조도를 현실적인 낮 값으로
 * 올리자 90.94 대 121.93 으로 갈렸습니다. **어두운 장면에서는 땅의 음영이
 * 원리적으로 안 보인다**는 뜻이라 기억해 둘 값입니다.
 *
 * **4. 판정 자신의 상하 반전.** `readRenderTargetPixels` 는 아래에서 위로
 * 오는데 접근자를 `(H−1−y)` 로 뒤집어, **위아래가 뒤집힌 그림**과 견주고
 * 있었습니다. 증상은 "가장 얕은 물이 가장 어둡다"였습니다. 그래서 대조 ⓪
 * (실루엣 등록)을 넣었습니다 — 색과 무관하게 자리만 봅니다.
 *
 * ## 문턱을 정하며 버린 지표들
 *
 * 처음엔 "포말 폭"을 화면에서 문턱으로 골라 재려 했습니다. 두 번 실패했습니다:
 *
 * - **화소로 재면** 거리가 1/d² 로 섞여, 경사와의 상관이 +0.40 — 물리와
 *   **반대 부호**로 나왔습니다.
 * - **미터로 고쳐도** 밝기 문턱이 고르는 등수심선이 제멋대로라 상관이 0.
 *
 * 그래서 문턱을 쓰지 않는 쪽으로 바꿨습니다. 핵심 주장은 "물가의 모습이
 * **수심의 함수**"이므로, 수심으로 묶으면 밝기가 크게 변하고 **같은 수심
 * 안에서 거리로 묶으면 안 변해야** 합니다. 그 대비가 판정입니다
 * (수심 16% 대 거리 0.3%).
 *
 * ## 이 관측점의 한계 (판정이 못 가리는 것)
 *
 * 서해안 갯벌이라 **보이는 물이 전부 수심 1m 미만**입니다. 깊은 물의 색
 * (흡수 `exp(−k·2d)` 로 청록이 남는 것)은 여기서 확인할 수 없습니다.
 * 수심 1m 이상 표본이 생기면 그때 문턱을 걸어야 합니다.
 *
 * 준비: node tools/shader-preview/build-shore.js && stage-esm.js
 * 사용: node tools/shader-preview/verify-shore.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}
const bin = (arr, lo, hi) => arr.find(b => b.수심 && b.수심[0] === lo && b.수심[1] === hi);

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/shore.html', { timeout: 180000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null,
    { timeout: 180000, polling: 500 }).catch(() => {});

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

  console.log('\n== 대조 ⓪ 등록 (색과 무관하게 자리만) ==');
  console.log(`  열 ${r.등록.열} · 실루엣 차 중앙 ${r.등록.실루엣차중앙}px · 최대 ${r.등록.실루엣차최대}px`);
  // 이게 안 맞으면 아래 모든 색 측정이 엉뚱한 화소를 본 것입니다.
  ok(r.등록.실루엣차최대 <= 2,
    `CPU 화소 지도와 화면이 같은 자리 (최대 ${r.등록.실루엣차최대}px ≤ 2px)`);

  console.log('\n== 물빛이 수심을 따르는가 ==');
  r.수심응답.filter(x => x.n > 0).forEach(x =>
    console.log(`  수심 ${x.수심[0]}~${x.수심[1]}m  밝기 ${x.밝기}  (n=${x.n})`));
  const 얕1 = bin(r.수심응답, 0, 0.25), 얕2 = bin(r.수심응답, 0.25, 0.5);
  const 깊 = bin(r.수심응답, 0.5, 1);
  ok(얕1.n > 500 && 깊.n > 500, `수심대 표본이 충분 (${얕1.n} / ${깊.n})`);
  const 얕은평균 = (얕1.밝기 * 얕1.n + 얕2.밝기 * 얕2.n) / (얕1.n + 얕2.n);
  const 수심비 = 얕은평균 / 깊.밝기;
  console.log(`  얕은 물(<0.5m) ${얕은평균.toFixed(2)} 대 0.5~1m ${깊.밝기} → ${수심비.toFixed(3)}배`);
  ok(수심비 >= 1.08, `얕을수록 밝음 (${수심비.toFixed(3)}배 ≥ 1.08)`);

  console.log('\n== 대조: 같은 수심에서 **거리**로 묶으면 안 변하는가 ==');
  const 거 = r.거리대조.filter(x => x.n > 200);
  거.forEach(x => console.log(`  거리 ${x.거리[0]}~${x.거리[1]}m  밝기 ${x.밝기}  (n=${x.n})`));
  ok(거.length >= 2, `거리대 표본이 둘 이상 (${거.length})`);
  const 거폭 = Math.max(...거.map(x => x.밝기)) - Math.min(...거.map(x => x.밝기));
  const 거평균 = 거.reduce((a, x) => a + x.밝기, 0) / 거.length;
  const 거변동 = 거폭 / 거평균;
  console.log(`  거리에 따른 변동 ${(거변동 * 100).toFixed(2)}% (수심 응답은 ${((수심비 - 1) * 100).toFixed(1)}%)`);
  // 거리로는 거의 안 변해야 "거리가 아니라 수심으로 잰다"가 성립합니다.
  ok(거변동 <= 0.05, `거리로는 거의 안 변함 (${(거변동 * 100).toFixed(2)}% ≤ 5%)`);
  ok(거변동 * 3 < (수심비 - 1), `수심 응답이 거리 변동보다 훨씬 큼`);

  console.log('\n== 띠 폭 = 수심문턱 / 경사 (자료 쪽 성질) ==');
  console.log(`  열 ${r.띠폭.열} · 폭 대 1/경사 상관 ${r.띠폭.상관_폭대역경사}`);
  console.log(`  평균 ${r.띠폭.평균폭m}m · 범위 ${r.띠폭.폭범위m[0]}~${r.띠폭.폭범위m[1]}m`);
  ok(r.띠폭.상관_폭대역경사 !== null && r.띠폭.상관_폭대역경사 >= 0.3,
    `폭이 1/경사를 따름 (${r.띠폭.상관_폭대역경사} ≥ 0.3)`);

  console.log('\n== 경사가 땅색을 바꾸는가 ==');
  const a = r.경사알베도;
  console.log(`  표본 ${a.표본} · 경사 ${a.경사범위[0]}~${a.경사범위[1]} · 색조 ${a.색조범위[0]}~${a.색조범위[1]}`);
  console.log(`  완만한 1/4 ${a.색조_완만} · 급한 1/4 ${a.색조_급함} · 상관 ${a.상관} (귀무 ${a.귀무})`);
  // 색조가 한 값으로 고정되면 경사 항이 죽은 것입니다 (윗주석 결함 1).
  ok(a.색조범위[1] - a.색조범위[0] >= 0.02,
    `땅색이 한 값이 아님 (색조 폭 ${(a.색조범위[1] - a.색조범위[0]).toFixed(4)} ≥ 0.02)`);
  ok(a.상관 !== null && a.상관 >= 0.5, `급사면이 암반 쪽으로 감 (상관 ${a.상관} ≥ 0.5)`);
  ok(Math.abs(a.귀무) <= 0.05, `뒤섞은 경사와는 무상관 — 귀무 대조 (${a.귀무})`);
  ok(a.색조_급함 > a.색조_완만, `급한 쪽이 덜 붉음 (${a.색조_급함} > ${a.색조_완만})`);

  console.log('\n== 젖은 모래 ==');
  const w = r.젖은모래;
  const 비 = w.젖음 / w.마름;
  console.log(`  조간대(고도<1m) ${w.젖음} (n=${w.젖음n}) 대 마른 땅(2~6m) ${w.마름} (n=${w.마름n}) → ${비.toFixed(3)}배`);
  ok(w.젖음n > 500 && w.마름n > 200, `표본이 충분 (${w.젖음n} / ${w.마름n})`);
  ok(비 <= 0.9, `젖은 쪽이 어두움 (${비.toFixed(3)}배 ≤ 0.9)`);
  ok(비 >= 0.3, `너무 어둡지는 않음 (${비.toFixed(3)}배 ≥ 0.3)`);

  console.log('\n== 공기원근 ==');
  const 맑 = r.공기원근.맑은날.filter(x => x.n > 100);
  const 뿌 = r.공기원근.뿌연날.filter(x => x.n > 100);
  맑.forEach((x, i) => console.log(
    `  ${x.구간[0]}~${x.구간[1]}m  맑은날 ${x.차}  뿌연날 ${뿌[i].차}  (n=${x.n})`));
  // ⚠ 3km 안에서 맑은 날 효과는 원래 작습니다. 중요한 것은 (a) 거리가 멀수록
  //    커지고 (b) 대기 변수 β 에 물려 있는가 입니다.
  ok(맑[맑.length - 1].차 > 맑[0].차, `멀수록 커짐 (${맑[0].차} → ${맑[맑.length - 1].차})`);
  ok(뿌.every((x, i) => x.차 >= 맑[i].차), `β 에 물려 있음 — 뿌연 날이 모든 거리대에서 큼`);
  ok(뿌[뿌.length - 1].차 >= 5,
    `뿌연 날 원경에서 뚜렷 (${뿌[뿌.length - 1].차} ≥ 5/255)`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
