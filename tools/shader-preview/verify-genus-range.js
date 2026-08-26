/**
 * **덱이 운형을 구분해 그리는가** 합격 판정 (docs/CLOUD_VARIETY_PLAN.md 0·1단계).
 *
 * 두 가지를 따로 봅니다.
 *
 *  (A) **표현 폭** — 10종의 광학을 하나씩 먹였을 때 화면이 실제로 달라지는가.
 *      달라지지 않는다면 운형을 방향마다 배분해 봐야 소용이 없으므로,
 *      2단계에 들어가기 전에 먼저 확인해야 할 전제입니다.
 *
 *  (B) **1단계: 중·상층이 폴백에서 빠져나왔는가** — 빌보드를 적운·적란운으로
 *      제한한 뒤로 mid/high 층에는 빌보드가 하나도 없어서, 덱이 언제나
 *      상수 폴백 τ=25 / 그늘 0.5 를 받고 있었습니다. 권운(τ=3)이 τ=25로
 *      그려지면 해가 비치는 구름이 아니라 회색 판이 됩니다.
 *
 * 알파는 검정·흰 두 배경으로 두 번 그려 분리하고, **알파 0.5 이상인 픽셀만**
 * 골라 밝기를 잽니다 — 빈 하늘이 섞이면 운량 차이가 밝기 차이로 둔갑합니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-genus-range-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-genus-range.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

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
  const p = await b.newPage({ viewport: { width: 1600, height: 820 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto('http://localhost:8123/genus-range.html');
  await p.waitForTimeout(16000);

  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0,
    `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/SHADER_ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats) {
    console.log('\nFAILURES — __stats 가 없습니다.');
    process.exit(1);
  }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);

  console.log('\n== (A) 10종의 표현 폭 ==');
  const G = stats.표현폭;
  for (const g of G) {
    console.log(`  ${g.name.padEnd(14)} τ${String(g.tau).padStart(5)}  밝기 ${g.밝기}  결 ${g.결}`);
  }
  const brights = G.map(g => g.밝기);
  const 결s = G.map(g => g.결);
  const bMax = Math.max(...brights), bMin = Math.min(...brights);
  const tMax = Math.max(...결s), tMin = Math.min(...결s);
  console.log(`  밝기 폭 ${bMin} ~ ${bMax} (×${(bMax / bMin).toFixed(2)})`);
  console.log(`  결   폭 ${tMin} ~ ${tMax} (×${(tMax / tMin).toFixed(2)})`);

  // 이게 안 되면 2단계(방향별 운형)는 의미가 없습니다.
  ok(bMax / bMin >= 2.0, `밝기가 운형에 따라 2배 이상 갈림 (×${(bMax / bMin).toFixed(2)})`);
  ok(tMax / tMin >= 2.5, `결도 갈림 — 광학뿐 아니라 모양도 다름 (×${(tMax / tMin).toFixed(2)})`);
  // 가장 얇은 것과 가장 두꺼운 것의 순서가 물리와 맞아야 합니다.
  const ci = G.find(g => g.name === 'Cirrus');
  const cb = G.find(g => g.name === 'Cumulonimbus');
  ok(ci.밝기 > cb.밝기 * 2,
    `권운이 적란운보다 2배 이상 밝음 (${ci.밝기} vs ${cb.밝기})`);

  console.log('\n== (B) 1단계: 상층 폴백 제거 ==');
  const 도감 = stats.도감권운, 폴백 = stats.현재폴백;
  console.log(`  같은 권운 무늬, τ·그늘만 다름 — 도감 ${도감.밝기} / 옛 폴백 ${폴백.밝기}`);
  // 폴백이 실제로 손해였다는 것부터 확인합니다. 차이가 없다면 1단계는
  // 고칠 값어치가 없었다는 뜻이고, 그것도 알아야 할 사실입니다.
  ok(도감.밝기 - 폴백.밝기 > 20,
    `폴백 τ=25 는 권운을 ${(도감.밝기 - 폴백.밝기).toFixed(1)} 어둡게 만들었음`);

  console.log('\n  지금 앱이 관측 기상에서 보내는 값:');
  const A = stats.앱경로;
  for (const a of A) {
    console.log(`    ${a.라벨}  →  ${a.name.padEnd(14)} τ${String(a.tau).padStart(5)}  밝기 ${a.밝기}  결 ${a.결}`);
  }
  const high = A.filter(a => a.layer === 'high');
  const low = A.filter(a => a.layer === 'low');
  // 폴백이면 179 대입니다. 도감이면 205 이상입니다.
  ok(high.every(a => a.밝기 > 200),
    `상층이 폴백(179대)이 아니라 도감값으로 그려짐 (${high.map(a => a.밝기).join(', ')})`);
  ok(high.every(a => a.tau < 8),
    `상층 τ가 상층 도감 범위 (${high.map(a => a.tau).join(', ')} < 8)`);
  const hMean = high.reduce((s, a) => s + a.밝기, 0) / high.length;
  const lMean = low.reduce((s, a) => s + a.밝기, 0) / low.length;
  ok(hMean - lMean > 40,
    `층이 실제로 갈림 — 상층 ${hMean.toFixed(1)} vs 저층 ${lMean.toFixed(1)}`);

  // ── 2단계가 왜 필요한지 기록 ─────────────────────────────────────────────
  //
  // 층 **안에서는** 거의 안 갈립니다. 관측점 운량 하나가 층 대표 운형을
  // 정하고, 그 하나가 360° 전체에 걸리기 때문입니다. 이 숫자가 2단계의
  // 출발선입니다 — 방향별 운형이 들어가면 여기가 벌어져야 합니다.
  const 층내폭 = (arr) => Math.max(...arr.map(a => a.밝기)) - Math.min(...arr.map(a => a.밝기));
  console.log('\n  한 층 안의 밝기 폭 (2단계 출발선):');
  console.log(`    상층 ${층내폭(high).toFixed(1)}   중층 ${층내폭(A.filter(a => a.layer === 'mid')).toFixed(1)}   저층 ${층내폭(low).toFixed(1)}`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
