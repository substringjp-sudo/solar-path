/**
 * **바다와 윤슬** 합격 판정 (docs/GROUND_PLAN.md 4·5단계).
 *
 * 물이 강력한 이유는 알베도가 낮은데(0.06) **정반사 방향에서만 아주 높다**는
 * 대비입니다. 그래서 한 방향만 봐서는 안 됩니다 — 태양 쪽에 기둥이 서는가,
 * **그리고 반대쪽은 어두운가.** 둘 다 봐야 "물 전체를 밝게 칠했다"와 구분됩니다.
 *
 * 풍속 의존(Cox-Munk σ² = 0.003 + 0.00512·U)은 이 모형의 유일한 관측 가능한
 * 결과이므로, 그게 실제로 걸렸는지 보는 가장 직접적인 검사입니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-water-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-water.js
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
  const p = await b.newPage({ viewport: { width: 1700, height: 400 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto('http://localhost:8123/water.html');
  await p.waitForTimeout(14000);

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

  console.log('\n== 4단계: 바다 수평선 ==');
  console.log(`  관측 고도 30m → 내려앉음 ${stats.수평선내려앉음}°`);
  // dip = acos(R/(R+h)). 30m 에서 0.176°.
  ok(Math.abs(stats.수평선내려앉음 - 0.176) < 0.01,
    `수평선 각도가 관측 고도에서 나옴 (${stats.수평선내려앉음}° ≈ 0.176°)`);

  console.log('\n== 물의 밝기 ==');
  const m = stats.수면평균;
  console.log(`  육지 ${m.육지}  바다(태양 쪽) ${m.바다약}  바다(반대쪽) ${m.반대쪽}`);
  ok(m.바다약 > m.육지 * 1.3,
    `태양 쪽 물이 육지보다 밝음 — 하늘을 비춤 (${m.바다약} > ${m.육지})`);
  // 여기가 핵심입니다. 이게 없으면 "물을 그냥 밝게 칠했다"와 구분이 안 됩니다.
  ok(m.반대쪽 < m.육지,
    `태양 반대쪽 물은 육지보다 **어두움** — 알베도 0.06 (${m.반대쪽} < ${m.육지})`);

  console.log('\n== 5단계: 윤슬 (Cox-Munk) ==');
  const g = stats.윤슬;
  const deg = (w) => (w * stats.화각).toFixed(1);
  console.log(`  바람 2m/s  폭 ${g.바다약.폭} (${deg(g.바다약.폭)}°)  봉우리 +${g.바다약.봉우리}`);
  console.log(`  바람 8m/s  폭 ${g.바다강.폭} (${deg(g.바다강.폭)}°)  봉우리 +${g.바다강.봉우리}`);
  console.log(`  반대쪽     폭 ${g.반대쪽.폭}  봉우리 +${g.반대쪽.봉우리}`);

  ok(g.바다약.봉우리 > 20,
    `태양 방위에 기둥이 섬 (바닥보다 +${g.바다약.봉우리})`);
  // ⚠ 반대쪽은 **봉우리가 아니라 폭**으로 봅니다.
  //
  // 예전에는 봉우리 < 5 였습니다. 그때는 수면 반사가 mix(0.10, 0.35, Fv) 로
  // 0.35 에서 잘려 있어 하늘 기울기가 화면에 거의 안 나왔기 때문에 그 문턱이
  // 성립했습니다. 프레넬을 물리대로 되돌리자(스침각에서 Fv → 1) 수면이
  // 하늘을 제대로 비추기 시작했고, 태양 반대쪽 화면 안에서도 하늘이
  // 후방산란 쪽으로 밝아지는 만큼 **넓은 기울기**가 생깁니다.
  //
  // 그게 윤슬이 아니라는 것은 항을 갈라 확인했습니다 — 반대쪽 봉우리 +24.9
  // 중 하늘반사가 +22.5, 윤슬은 +0.7, 수체는 +0.7 입니다. 기둥이 아닙니다.
  //
  // 기둥인지 아닌지를 실제로 가르는 것은 **폭**입니다(태양 쪽 1.8°·9.1°,
  // 반대쪽 0°). 그리고 태양 쪽 봉우리가 반대쪽보다 높아야 한다는 것도
  // 같이 봅니다 — 둘이면 "물 전체를 밝게 칠했다"와 구분됩니다.
  ok(g.반대쪽.폭 < 0.02,
    `반대쪽에는 기둥이 없음 — 폭 ${(g.반대쪽.폭 * stats.화각).toFixed(1)}°`);
  ok(g.바다약.봉우리 > g.반대쪽.봉우리,
    `태양 쪽 봉우리가 반대쪽보다 높음 (+${g.바다약.봉우리} > +${g.반대쪽.봉우리})`);
  // σ = sqrt(0.003 + 0.00512·U) → 2m/s에서 0.114 rad, 8m/s에서 0.21 rad.
  // 폭이 대략 그 비(1.8배)만큼 넓어져야 합니다.
  ok(g.바다강.폭 > g.바다약.폭 * 1.5,
    `풍속을 올리면 윤슬이 넓어짐 (${deg(g.바다약.폭)}° → ${deg(g.바다강.폭)}°)`);

  // ⚠ **봉우리 높이로는 판정하지 않습니다.** 선형에서는 약풍이 더 뾰족해야
  // 하지만(p_max = 1/πσ²), 화면에서는 반대로 나옵니다 — ACES 톤 곡선이 좁고
  // 밝은 봉우리를 더 세게 압축하고, 약풍 윤슬은 고도 방향으로도 좁아
  // 세로 평균에서 더 희석되기 때문입니다. 실측 +40.1 vs +54.5.
  // 폭은 그 두 효과에 안 휘둘립니다.

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
