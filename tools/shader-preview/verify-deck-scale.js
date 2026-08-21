/**
 * 2·4단계 합격 판정 (docs/CLOUD_TEXTURE_PLAN.md).
 *
 * 1단계는 무늬를 굽기만 했고 조각 각크기는 42.4° 그대로였습니다. 2단계는
 * 그 무늬를 **지상거리 투영**으로 하늘에 붙여 각크기를 실제 고적운 범위로
 * 내리는 일입니다. 4단계는 지평선 부근의 임의 알파 페이드(horizonFade)를
 * **대기 투시**로 바꿔, 2단계가 남긴 지평선 대(0~10°) 운량 결손을 줄입니다.
 *
 * 셰이더 식을 옮겨 적어 재면 안 됩니다 — `CloudDeck.ts`를 그대로 임포트해
 * 씬을 만들고 **렌더된 픽셀**에서 잽니다. 알파는 검정·흰 두 배경으로 두 번
 * 그려 정확히 분리합니다 (색 문턱으로 재면 반투명 가장자리가 섞여 운량이
 * 과소 계상됩니다 — 처음에 그렇게 재서 0.39가 0.25로 나왔습니다).
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-deck-scale-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-deck-scale.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

// WMO 고적운 정의: 구성 요소가 1~5° (고도 30° 이상에서 관측했을 때).
const WMO_AC_MIN = 1.0;
const WMO_AC_MAX = 5.0;
// 운량 보장. 지평선 페이드가 먹는 0~10° 대는 4단계 몫이라 제외합니다.
const COVER_BUDGET = 0.02;

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
  const p = await b.newPage({ viewport: { width: 1220, height: 900 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto('http://localhost:8123/deck-scale.html');
  await p.waitForTimeout(20000);

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
    console.log('\nFAILURES — __stats 가 없습니다. 페이지가 끝까지 실행되지 않았습니다.');
    process.exit(1);
  }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);

  const target = stats.목표운량;

  console.log('\n== 조각 각크기 (WMO 고적운 1~5°) ==');
  console.log('시선고도 │  주기 │ 조각 │ 판정');
  // WMO 기준이 "고도 30° 이상 관측"이므로 그 구간에서 봅니다.
  const wmoCuts = stats.컷.filter(c => c.시선고도 >= 30 && c.조각각크기 !== null);
  let inRange = 0;
  for (const c of stats.컷) {
    const e = c.조각각크기;
    const applies = c.시선고도 >= 30 && e !== null;
    const good = applies && e >= WMO_AC_MIN && e <= WMO_AC_MAX;
    if (good) inRange++;
    console.log('%s° │ %s │ %s │ %s',
      String(c.시선고도).padStart(7),
      (c.주기각크기 !== null ? c.주기각크기.toFixed(2) + '°' : '—').padStart(6),
      (e !== null ? e.toFixed(2) + '°' : '—').padStart(6),
      applies ? (good ? 'ok' : '범위 밖') : '기준 밖 (고도 30° 미만)');
  }
  ok(wmoCuts.length > 0 && inRange === wmoCuts.length,
    `고도 30° 이상 모든 컷이 WMO 범위 (${inRange}/${wmoCuts.length})`);

  console.log('\n== 원근 단축 ==');
  // 2단계의 핵심 주장. 예전 투영은 고도에 무관하게 같은 크기였습니다.
  const at = (el) => stats.컷.find(c => c.시선고도 === el);
  const hi = at(60) || at(45);
  const lo = at(20) || at(12);
  console.log('  시선 %d° 조각 %s°  vs  시선 %d° 조각 %s°',
    hi.시선고도, hi.조각각크기, lo.시선고도, lo.조각각크기);
  ok(hi.조각각크기 > lo.조각각크기 * 1.3,
    `낮은 고도에서 조각이 더 작음 (${(hi.조각각크기 / lo.조각각크기).toFixed(2)}배)`);

  console.log('\n== 운량 보존 (입체각 가중) ==');
  //
  // **픽셀 가중으로 재면 안 됩니다.** 카메라를 천정 쪽에 오래 두면 천정이
  // 과대 반영되어 답이 달라집니다. 고도대 [lo,hi]가 반구에서 차지하는 몫은
  // sin(hi) - sin(lo) 이므로 그걸로 가중합니다.
  const up = stats.입체각가중운량_고도10이상;
  const all = stats.입체각가중운량;
  console.log('  고도 10° 이상 : %s (%s%%p)', up.toFixed(4),
    ((up - target) * 100).toFixed(2));
  console.log('  지평선 포함   : %s (%s%%p)', all.toFixed(4),
    ((all - target) * 100).toFixed(2));
  ok(Math.abs(up - target) <= COVER_BUDGET,
    `고도 10° 이상 운량 오차 ≤ 2%p (${((up - target) * 100).toFixed(2)}%p)`);

  console.log('\n== 고도대별 ==');
  for (const bnd of stats.고도대) {
    if (bnd.운량 === null) continue;
    const d = (bnd.운량 - target) * 100;
    console.log('  %s │ %s │ %s%%p%s',
      bnd.고도대.padStart(8), bnd.운량.toFixed(4),
      (d >= 0 ? '+' : '') + d.toFixed(2).padStart(6),
      bnd.고도대 === '0~10°' ? '  ← 4단계: 대기 투시로 대체 (예전 -28.29%p)' : '');
  }
  // 4단계 이전에는 이 대가 -28.29%p였습니다(horizonFade가 알파를 임의로
  // 죽였기 때문). 대기 투시로 바꾸면 알파는 운량 그대로 두고 색만 바뀌므로
  // 크게 좁혀져야 합니다 — 측정: -8.28%p.
  //
  // 0으로 완전히 닫히지는 않습니다. 남은 오차는 극단적으로 낮은 시선(1.5°
  // 근처)에서 uCellTexSize·uPixelAngleRad·d로 구한 texelsPerPixel이 밉 보정
  // (cell_threshold)을 실측 검증한 범위(1~44, build-cell-gl-preview.js)를
  // 넘어서기 때문으로 보입니다 — 더 좁히려면 그 보정을 더 넓은 범위에서
  // 다시 측정해야 합니다. 4단계의 몫(임의 페이드 제거)은 끝났다고 보고,
  // 이 잔차는 밉 보정 쪽 후속 과제로 남깁니다.
  const horizonBand = stats.고도대.find(x => x.고도대 === '0~10°');
  const horizonErr = horizonBand ? Math.abs(horizonBand.운량 - target) : 1;
  ok(horizonBand && horizonErr <= 0.12,
    `지평선 대 오차가 크게 좁혀짐 (-28.29%p → ${(horizonErr * 100).toFixed(2)}%p, 예산 12%p)`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
