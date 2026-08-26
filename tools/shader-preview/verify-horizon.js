/**
 * **지평선 아래가 하늘이 아니라 땅인가** (docs/GROUND_PLAN.md 1단계).
 *
 * 오래 눈치채지 못했던 종류의 버그라 검사를 남깁니다: 지면 원반이 매 프레임
 * 색까지 갱신되는데 **한 픽셀도 화면에 안 나오고** 있었습니다. 그리기 순서
 * 때문입니다 — 지면(renderOrder −2)이 먼저 깊이 없이 그려지고, 스카이돔이
 * `depthTest: false`로 전체 구를 칠하며 덮었습니다.
 *
 * 셰이더 식이나 renderOrder 숫자를 읽어 검산하면 이런 건 안 잡힙니다.
 * 씬에서 **요소를 빼 보고 화면이 바뀌는지** 봐야 합니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-horizon-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-horizon.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}

const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1500, height: 420 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto('http://localhost:8123/horizon.html');
  await p.waitForTimeout(12000);

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

  console.log('\n== 고도대별 색 ==');
  const f = v => v ? `rgb(${String(v.r).padStart(3)},${String(v.g).padStart(3)},${String(v.b).padStart(3)})` : '—';
  console.log('  고도대       전부              태양쪽지면        반대쪽지면');
  for (const band of stats.고도대) {
    console.log(`  ${band.고도대.padEnd(10)} ${f(band.전부)}  ${f(band.지면_태양쪽)}  ${f(band.지면_반대쪽)}`);
  }

  console.log('\n== 1단계: 지평선 아래가 하늘이 아님 ==');
  const d = stats.지면원반을_빼도_바뀌는_최대픽셀차;
  console.log(`  지면 원반을 빼도 바뀌는 최대 픽셀차: ${d}`);
  // 고치기 전은 **1** 이었습니다 — 지면이 아예 안 보이고 있었습니다.
  ok(d > 40, `지면 원반이 실제로 화면에 나옴 (최대 픽셀차 ${d} > 40, 고치기 전 1)`);

  const at = deg => stats.고도대.find(x => x.고도대 === deg);
  const 하늘 = at('0~2°').전부;
  const 아래 = at('-6~-2°').전부;
  const 더아래 = at('-30~-15°').전부;

  ok(lum(아래) < lum(하늘),
    `지평선 아래가 위보다 어두움 (${lum(아래).toFixed(0)} < ${lum(하늘).toFixed(0)})`);

  const sat = c => (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) /
    Math.max(1, Math.max(c.r, c.g, c.b));
  console.log(`  지평선 아래 채도 ${(sat(아래) * 100).toFixed(0)}% (하늘이었을 때 47%)`);
  ok(sat(아래) < 0.25,
    `지평선 아래가 금빛 하늘이 아님 (채도 ${(sat(아래) * 100).toFixed(0)}% < 25%)`);

  console.log('\n== 2단계: 밝기가 알베도에서 나옴 ==');
  const ratio = lum(아래) / lum(하늘);
  console.log(`  지면 / 하늘 휘도비 = ${(ratio * 100).toFixed(0)}%`);
  // 아래쪽은 알베도(≈0.2)에 국소 순응 보정을 곱한 만큼입니다. 양쪽 다
  // 막습니다 — 너무 낮으면 검은 띠, 너무 높으면 "땅이 하늘만큼 밝다"는
  // 원래 문제로 되돌아갑니다.
  ok(ratio > 0.12, `검은 띠가 아님 (${(ratio * 100).toFixed(0)}% > 12%)`);
  ok(ratio < 0.50, `땅이 하늘만큼 밝지 않음 (${(ratio * 100).toFixed(0)}% < 50%)`);

  // 발밑으로 갈수록 어두워져야 합니다 (자기 그림자 + 주변 가림).
  ok(lum(더아래) < lum(아래),
    `발밑으로 갈수록 어두움 (${lum(더아래).toFixed(0)} < ${lum(아래).toFixed(0)})`);

  // 방위별 전방산란 광택. 지면이 램버시안이면 이 비가 1이 되고, 그러면
  // 방향에 무관한 한 색이라 회색 판때기로 보입니다.
  const sun쪽 = at('-6~-2°').지면_태양쪽;
  const 반대 = at('-6~-2°').지면_반대쪽;
  const sheen = lum(sun쪽) / Math.max(1, lum(반대));
  console.log(`  태양 쪽 / 반대쪽 = ${sheen.toFixed(2)}배`);
  ok(sheen > 1.25,
    `태양 쪽 지면이 더 밝음 — 표면으로 읽히는 방향 단서 (${sheen.toFixed(2)}배 > 1.25)`);
  ok(sheen < 3.0,
    `광택이 그라데이션을 지배하지 않음 (${sheen.toFixed(2)}배 < 3.0)`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
