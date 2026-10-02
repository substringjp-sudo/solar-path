/**
 * **해 쪽 능선은 제 뒤 하늘보다 어둡다** (2026-10-02) — 판정. `build-ridge-silhouette.js` 의 짝.
 *
 * 과녁(사용자 사진, 후쿠이 2026-10-02): 해 쪽 능선 아래 ÷ 위 화면 밝기 비 17:28 중앙값 0.52 · 17:31 0.56
 * (사분위 0.48~0.60). 능선은 22~26km 밖 단잔 산지입니다.
 *
 * 자(렌더를 재기 전에 정함):
 *  1. 지금: 해 고도 1° · 해 쪽 능선 비 중앙값 0.25 ~ 0.75 — 하늘보다 뚜렷이 어둡되 새카맣게 죽지는 않는다.
 *  2. 지금: 상위 90% 도 1.0 이하 — 먼 산은 제 뒤 하늘보다 밝아지지 않는다.
 *  3. 대조: 예전(연무도 지면 노출·순응을 먹음)은 중앙값 0.9 이상 — 이 자가 그 증상을 본다.
 *     ("지금"은 연무의 노출 고침 + 산 그림자 둘 다. 노출만 고친 판은 참고로 찍기만 합니다 — 후쿠이 지형에서
 *      0.798 로 1 을 못 넘겨 그것만으로는 모자랐습니다.)
 *  4. 능선 높이: 해 방위 ±4° 에서 앱 능선 − 참 능선(줌 12 · 곡률 낙차)의 중앙값이 ±0.10° 안 —
 *     해가 제 시각에 산 뒤로 숨는다. (앱의 광역 패치는 줌 9 라 CPU 로 같은 식을 돌리면 0.05° 안팎 낮습니다.)
 *
 * 처음 판(도곡동 타일 · 가장 큰 밝기 낙차를 능선으로)에서는 3 이 0.77 로 떨어졌습니다. 자의 문턱은 그대로
 * 두고 **재는 자리와 능선 찾는 법**을 고쳤습니다 — 빌더 머리말.
 *
 * 사용: node tools/shader-preview/stage-esm.js && node tools/shader-preview/build-ridge-silhouette.js
 *       node tools/shader-preview/verify-ridge-silhouette.js
 */
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN, PREVIEW } = require('./paths');
const D = require('./dem-cpu');

const LAT = 36.0209, LON = 136.2894, SUN_AZ = 265, EYE_M = 1.6;
const R_EARTH = 6371000;

/** 참 능선: 줌 12 · 30m 걸음 · 45km 까지 고도각 최댓값. 낙차는 앱과 같이 d²/2R (굴절 없음). */
function trueSkyline() {
  const ref = D.makeCpuDem({ demDir: path.join(PREVIEW, 'ref12-fukui'), zoom: 12, lat: LAT, lon: LON });
  const near = D.makeCpuDem({ demDir: path.join(PREVIEW, 'dem-fukui'), zoom: D.demZoomForRadius(3000, LAT, 3), lat: LAT, lon: LON });
  const h0 = near.elevAtGround(0, 0) + EYE_M;
  return (azDeg) => {
    const a = azDeg * Math.PI / 180;
    let best = -90;
    for (let d = 200; d <= 45000; d += 30) {
      const h = ref.elevAtGround(Math.sin(a) * d, -Math.cos(a) * d);
      if (h === null) break;
      best = Math.max(best, Math.atan2(h - h0 - d * d / (2 * R_EARTH), d) * 180 / Math.PI);
    }
    return best;
  };
}

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  await p.goto(ORIGIN + '/ridge-silhouette.html', { waitUntil: 'commit', timeout: 120000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 300000, polling: 500 });
  const st = await p.evaluate(() => window.__stats), errs = await p.evaluate(() => window.__errors);
  await b.close();
  ok(errs.length === 0 && st && st.glError === 0, `셰이더·GL 오류 없음 (${errs[0] || 'gl ' + (st && st.glError)})`);
  if (!st) process.exit(1);
  const { 예전, 노출만, 지금, 능선 } = st.out;
  console.log(`      지면 노출 ${st.out.exposure} · 사진(후쿠이 17:28·17:31) 중앙값 0.52·0.56`);
  console.log(`      예전 ${JSON.stringify(예전)}`);
  console.log(`      노출만(참고) ${JSON.stringify(노출만)}`);
  console.log(`      지금 ${JSON.stringify(지금)}`);
  ok(지금.열 >= 30, `능선을 찾았다 (${지금.열}열)`);
  ok(지금.중앙 >= 0.25 && 지금.중앙 <= 0.75, `해 쪽 능선이 하늘보다 뚜렷이 어둡다 — 비 중앙값 0.25~0.75 (${지금.중앙})`);
  ok(지금.상위90 <= 1.0, `먼 산이 제 뒤 하늘보다 밝지 않다 — 상위 90% ${지금.상위90} ≤ 1.0`);
  ok(예전.중앙 >= 0.9, `대조: 예전 방식은 해 쪽 능선이 하늘만큼 밝다 (${예전.중앙} ≥ 0.9)`);

  const truth = trueSkyline();
  const diffs = 능선.filter(([az]) => Math.abs(az - SUN_AZ) <= 4).map(([az, el]) => el - truth(az)).sort((a, c) => a - c);
  const med = diffs.length ? diffs[Math.floor(diffs.length / 2)] : NaN;
  const at = (az) => { const q = 능선.reduce((m, r) => Math.abs(r[0] - az) < Math.abs(m[0] - az) ? r : m, 능선[0]); return `${q[0]}° 앱 ${q[1].toFixed(2)}° · 참 ${truth(q[0]).toFixed(2)}°`; };
  console.log(`      능선 높이 (${diffs.length}열): ${at(SUN_AZ - 3)} | ${at(SUN_AZ)} | ${at(SUN_AZ + 3)}`);
  console.log(`      앱 − 참: 하위10 ${diffs[Math.floor(diffs.length * 0.1)]?.toFixed(3)} · 중앙 ${med.toFixed(3)} · 상위90 ${diffs[Math.floor(diffs.length * 0.9)]?.toFixed(3)}`);
  ok(diffs.length >= 20 && Math.abs(med) <= 0.10, `능선 높이가 참값과 맞다 — 중앙 차 ${med.toFixed(3)}° (±0.10° 안)`);
  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — pass ${pass} / fail ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
