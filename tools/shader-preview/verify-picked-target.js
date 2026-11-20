/**
 * **고른 대상을 기억했다가 새 눈 기준으로 다시 만드는 길이 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * `src/utils/pickedTarget.ts` 는 고른 대상의 위경도를 기억하고(`targetPointOf`), 눈 위치가 바뀐 뒤 같은 대상을 새 눈 기준으로 다시 만듭니다
 * (`rebuildPicked`). 저장한 장면을 열 때 쓰는 길입니다. 이 두 함수의 검사는 추천 화면을 뺄 때(2026-11-20) `verify-stand-suggest.js` 의
 * [7] · [7b] 에서 그대로 옮겨 왔고, 기준은 바꾸지 않았습니다(`targetPointOf` 가 위경도를 모를 때 null 인지 보는 줄 하나만 더했습니다).
 *
 * 먼저 정한 줄(실행 전):
 *  1. 대상 점: 건물은 "누른 곳" 을 골랐어도 지붕 한가운데(topPoint), 땅은 고른 점. 위경도를 모르면 null.
 *  2. 다시 만들기: 건물은 꼭대기를 대상 점으로(snapped), 높이 · 해발 · 발자국은 그대로, 높이각은 새 거리로 독립 계산과 1e-9° 안에서 맞는다.
 *     방위 · 앙각 · 거리 · 가림 · 눈 해발은 새 점의 것. 땅은 건물 정보 없이 새 점 그대로. 건물이라 했는데 건물 정보가 없으면 땅으로 물러난다.
 *  3. 위경도 ↔ 틀 좌표: `localOffsetM` 은 `offsetLatLon` 의 거꾸로 — 왕복 오차 0.01 m 안, 날짜변경선을 넘어도 맞는다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-picked-target.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const R2D = 180 / Math.PI;

(async () => {
  const U = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'pickedTarget.js'));

  const LAT = 37.5126, LON = 127.1026;
  const pt = (e, s, el, extra = {}) => ({ azDeg: 0, elDeg: 0, distM: Math.hypot(e, s), elevM: el, eastM: e, southM: s, latitude: LAT, longitude: LON, visible: true, marginM: 10, ...extra });
  const building = (h, shortM, snapped = true) => ({
    kind: 'building', ...pt(100, -50, 20 + h / 2, { latitude: 37.5100, longitude: 127.1000 }), eyeElevM: 12,
    building: { heightM: h, baseElevM: 20, topElevM: 20 + h, longM: shortM * 1.1, shortM, snapped,
      hitPoint: pt(100, -50, 20 + h / 2, { latitude: 37.5100, longitude: 127.1000 }),
      topPoint: pt(120, -60, 20 + h, { latitude: LAT, longitude: LON }) },
  });
  const terrain = (extra = {}) => ({ kind: 'terrain', ...pt(500, -300, 400), eyeElevM: 12, ...extra });

  // ── [1] 대상 점 ──
  console.log('\n[1] 대상 점');
  {
    const b = building(555, 70, false);   // 누른 곳을 대상으로 한 상태
    const p = U.targetPointOf(b);
    ok(p && p.elevM === 575 && p.eastM === 120 && p.southM === -60 && p.latitude === LAT, `건물은 "누른 곳"이어도 지붕 한가운데(해발 ${p && p.elevM}, 동 ${p && p.eastM}, 남 ${p && p.southM})`);
    const t = U.targetPointOf(terrain());
    ok(t && t.elevM === 400 && t.eastM === 500 && t.southM === -300, '땅은 고른 점 그대로');
    ok(U.targetPointOf(terrain({ latitude: null, longitude: null })) === null, '위경도를 모르면 null');
    ok(U.targetPointOf(building(100, 20, true)).elevM === 120, '건물 대상 점의 해발은 지붕(20 + 100)');
  }

  // ── [2] 자리를 옮긴 뒤 대상 다시 만들기 ──
  console.log('\n[2] 옮긴 뒤 같은 대상을 새 눈 기준으로');
  {
    const G = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'geoMove.js'));
    const E = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'earth.js'));
    let worst = 0;
    for (const [e, n] of [[0, 0], [1234, -567], [-30000, 45000], [61000, 61000], [-61000, -20000]]) {
      const p = G.offsetLatLon(37.5, 127, e, n);
      const b = G.localOffsetM({ latitude: 37.5, longitude: 127 }, p.latitude, p.longitude);
      worst = Math.max(worst, Math.hypot(b.eastM - e, b.northM - n));
    }
    const wp = G.offsetLatLon(37.5, 179.9, 20000, 0), wb = G.localOffsetM({ latitude: 37.5, longitude: 179.9 }, wp.latitude, wp.longitude);
    ok(worst < 0.01 && Math.abs(wb.eastM - 20000) < 0.01 && wp.longitude < 0, `localOffsetM 는 offsetLatLon 의 거꾸로: 왕복 오차 최대 ${worst.toExponential(1)} m, 날짜변경선을 넘어도 맞는다(경도 ${wp.longitude.toFixed(3)}, 동쪽 ${wb.eastM.toFixed(2)} m)`);

    const b0 = building(555, 11, false).building;
    const tp = pt(-8000, 2000, 575, { azDeg: 284, elDeg: 0.2, distM: 8246, visible: false, marginM: -12, eyeElevM: 21.6 });
    const r = U.rebuildPicked('building', b0, tp);
    const el = (z) => Math.atan2(z - 21.6 - E.curvatureDropM(8246), 8246) * R2D;
    const wantH = el(b0.topElevM) - el(b0.baseElevM);
    ok(r.kind === 'building' && r.building.snapped === true && r.building.topPoint === tp && r.building.hitPoint === tp, '건물: 꼭대기를 대상 점으로(snapped), 두 점이 새 점');
    ok(r.building.heightM === 555 && r.building.baseElevM === 20 && r.building.topElevM === 575 && r.building.shortM === 11 && r.building.longM === b0.longM, '건물의 높이 · 해발 · 발자국은 그대로');
    ok(near(r.building.angularHeightDeg, wantH, 1e-9), `높이각은 새 거리(8.2 km)로 다시 센다: ${r.building.angularHeightDeg.toFixed(4)}° (독립 계산 ${wantH.toFixed(4)}°)`);
    ok(r.azDeg === 284 && r.elDeg === 0.2 && r.distM === 8246 && r.visible === false && r.marginM === -12 && r.eyeElevM === 21.6 && r.elevM === 575, '방위 · 앙각 · 거리 · 가림 · 눈 해발은 새 점의 것');
    const rt = U.rebuildPicked('terrain', undefined, tp);
    ok(rt.kind === 'terrain' && rt.building === undefined && rt.azDeg === 284 && rt.eyeElevM === 21.6, '땅은 건물 정보 없이 새 점 그대로');
    ok(U.rebuildPicked('building', undefined, tp).kind === 'terrain', '건물이라 했는데 건물 정보가 없으면 땅으로 물러난다');
  }

  console.log(`\n${fail === 0 ? '모두 통과' : '실패 있음'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
