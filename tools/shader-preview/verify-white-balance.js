/**
 * **카메라 화이트밸런스 표** 판정 (§89). 브라우저가 필요 없습니다.
 *
 * `atmosphere.ts` 의 `WB_GAINS` 는 셰이더에 상수로 박힌 표입니다. 이 판이 같은
 * 대기 모형에서 표를 **다시 뽑아** 견줍니다 — 모형을 고치고 표를 안 고치면
 * 여기서 깨집니다.
 *
 *   광원 = 수평면에 내리는 직달(beam·sin h) + 하늘 반구(∫L sin e cos e)
 *   이득 = (태양 30° 의 광원 색) ÷ (이 태양의 광원 색), 휘도 보존
 *
 * 지키는 것:
 *   1. 표가 모형과 같다(각 성분 ±0.003)
 *   2. 30° 에서 정확히 1 — 낮 장면(판정들이 쓰는 30·40°)이 안 바뀐다
 *   3. 휘도를 보존한다 — 색만 옮기고 밝기는 안 건드린다
 *   4. 박명(−6°)은 파랑을 걷는다(b 이득 < 0.6) — 표가 공허하지 않다
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/verify-white-balance.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const A = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'atmosphere.js'));
  const { WB_GAINS, WB_SUN_MIN_DEG, WB_STEP_DEG } = A;
  const p = A.makeAtmosphereParams({ latitude: 37.5, observerElevM: 30, dayOfYear: 240, humidityPct: 65, visibilityM: 25000 });
  const D = Math.PI / 180;
  const illum = (sun) => {
    const beam = sun > 0 ? A.beamAtAltitude(sun, 0, p) : { r: 0, g: 0, b: 0 };
    const s = Math.max(0, Math.sin(sun * D));
    let r = 0, g = 0, b = 0, w = 0;
    for (let e = 1; e < 90; e += 2) for (let az = 0; az < 360; az += 10) {
      const cg = Math.sin(e * D) * Math.sin(sun * D) + Math.cos(e * D) * Math.cos(sun * D) * Math.cos(az * D);
      const L = A.skyRadiance(e, Math.acos(Math.max(-1, Math.min(1, cg))) / D, sun, p, 0);
      const wt = Math.sin(e * D) * Math.cos(e * D);
      r += L.r * wt; g += L.g * wt; b += L.b * wt; w += wt;
    }
    return { r: beam.r * s + r / w, g: beam.g * s + g / w, b: beam.b * s + b / w };
  };
  const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const norm = c => { const l = lum(c); return { r: c.r / l, g: c.g / l, b: c.b / l }; };
  const ref = norm(illum(30));

  console.log('\n[1] 표가 대기 모형과 같은가');
  let worst = 0, worstAt = null;
  WB_GAINS.forEach((row, i) => {
    const sun = WB_SUN_MIN_DEG + i * WB_STEP_DEG;
    const c = norm(illum(sun));
    const g = { r: ref.r / c.r, g: ref.g / c.g, b: ref.b / c.b };
    const l = lum(g);
    const want = [g.r / l, g.g / l, g.b / l];
    const d = Math.max(...want.map((v, k) => Math.abs(v - row[k])));
    if (d > worst) { worst = d; worstAt = sun; }
  });
  ok(worst <= 0.003, `최대 어긋남 ${worst.toFixed(4)} (태양 ${worstAt}°) ≤ 0.003`);

  console.log('\n[2] 30° 에서 1');
  const last = WB_GAINS[WB_GAINS.length - 1];
  ok(WB_SUN_MIN_DEG + (WB_GAINS.length - 1) * WB_STEP_DEG === 30, '표의 끝이 30° 다');
  ok(last.every(v => v === 1), `30° 이득이 정확히 (1,1,1) (${last.join(', ')})`);

  console.log('\n[3] 휘도 보존');
  const lw = WB_GAINS.map(g => Math.abs(0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2] - 1));
  ok(Math.max(...lw) < 0.002, `모든 칸에서 |휘도 − 1| < 0.002 (최대 ${Math.max(...lw).toFixed(4)})`);

  console.log('\n[4] 박명은 파랑을 걷는다');
  const i6 = (-6 - WB_SUN_MIN_DEG) / WB_STEP_DEG;
  ok(WB_GAINS[i6][2] < 0.6 && WB_GAINS[i6][0] > 1.3, `−6° 이득 (${WB_GAINS[i6].join(', ')}) — 빨강 올리고 파랑 내림`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
