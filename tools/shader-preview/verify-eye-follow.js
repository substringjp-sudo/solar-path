/**
 * **지형이 눈을 따라가는 기하가 맞는가** — `src/utils/demGeometry.ts`. 브라우저 · 네트워크 불필요.
 *
 * 연속 이동 조이스틱 2단계(docs/SANDBOX_MODE_PLAN.md 12.2)의 바탕입니다. 지형 · 바다 셰이더는 눈의 자리를 "블록 안 소수 타일 좌표"(`uDemObs`)로 받습니다.
 * 그동안 이 값은 높이장 조각을 받을 때만 정해져서(경위도 소수점 셋째 자리, 약 100 m 칸이 바뀔 때) 그 사이에는 눈이 움직여도 지형이 따라오지 않다가
 * 칸이 바뀌는 순간 한꺼번에 건너뛰었습니다. 이제 눈의 경위도로 이 좌표를 **프레임마다** 다시 구합니다. 그 계산과 "받아 둔 블록이 아직 눈 둘레를 덮는가" 를 여기서 박습니다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20, 구현보다 먼저 박았습니다)
 *
 *  1. **타일 좌표(독립 값)**: 서울(37.5665°N, 126.978°E)의 줌 13 소수 타일 좌표와 몇몇 기준점이 **다른 식**(`asinh(tan φ)`)으로 센 값과 1e-9 안으로 같다.
 *     기준점: (경도 0, 위도 0) 줌 1 → (1, 1), (경도 −180, 위도 85.0511287798) 줌 3 → (0, 0) ± 1e-6, 그리고 줌이 1 늘면 좌표가 정확히 2 배.
 *  2. **원래 자리**: 블록의 원점을 눈이 있는 타일의 한 칸 위·왼쪽(= 관측자 타일이 정중앙인 3×3)으로 잡았을 때 `observerTileUV` 가 (1 이상 2 미만, 1 이상 2 미만) 이고
 *     그 값이 소수 타일 좌표에서 원점 정수를 뺀 것과 같다.
 *  3. **동쪽으로 d m**: u 가 d/타일지상거리 만큼 늘고 v 는 그대로다. d = 1 · 10 · 100 · 500 · 1000 · 2000 m, 위도 37.5665 · 60 · −33.9 에서 상대오차 1e-5 안.
 *     (`offsetLatLon` 은 위도 1° 를 111,320 m 로, 타일은 지구 둘레 40,075,016.686 m 를 360° 로 나눈 111,319.49 m 로 셉니다. 둘의 차 4.6e-6 이 한계입니다.)
 *  4. **북쪽으로 d m**: v 가 −d/타일지상거리 만큼 줄고(타일 y 는 남쪽으로 커진다) u 는 그대로다. 메르카토르는 1차 근사라 오차가 2·(d/지구반지름)·tan φ 안이어야 한다
 *     (d ≤ 2000 m, 위 세 위도에서; 위도 60° 에서 약 1.1e-3).
 *  5. **눈 옮기기**: `moveObserver` 가 패치의 `observerU/V` 를 `observerTileUV` 값으로 고치고 같은 값을 돌려준다. 두 번 해도 같고, 원래 경위도로 되돌리면 처음 값이 1e-9 안으로 돌아온다.
 *  6. **블록이 덮는가**(`blockCovers`): 줌 13, 3×3, 서울에서 눈이 블록 중앙에 있으면 반경이 1.5 타일(약 5.9 km) 이하일 때만 참이다. 눈이 중앙에서 동쪽으로 e, 북쪽으로 n 미터 벗어나면
 *     반경 + |e| 와 반경 + |n| 이 모두 (1.5 − 여유) 타일 이하일 때만 참이다(독립으로 미터 식을 세워 견준다). 여유(`marginTiles`)를 주면 그만큼 엄격하다. 블록 밖이거나 NaN 이면 거짓이다.
 *  8. **가운데 타일 밖으로 나가는 때**(`denseRadiusM`): 촘촘한 패치가 어느 방향으로도 보장하는 반지름은 셰이더의 `dem_probeRadiusM` 과 같은 식 0.98 × (한 변 − 1)/2 × 타일 지상 거리
 *     (3×3 이면 0.98 타일)이다. 그 반지름으로 `blockCovers` 를 물으면, 눈이 가운데 타일 안(u, v 가 [1, 2))이거나 그 둘레 0.02 타일 안이면 참이고, 0.05 타일 넘게 벗어나면 거짓이다
 *     (눈이 가운데 타일을 벗어나면 새 블록을 받아야 한다는 기준 — 그보다 늦으면 3~3.8 km 의 이음매 고리에서 가장자리 화소가 늘어납니다).
 *  7. **끊김 없음**: 눈이 동쪽으로 1 km 를 2 m 걸음으로 가는 동안 `observerTileUV` 가 걸음마다 2 m 에 해당하는 만큼(타일 단위 2/지상거리 ± 1 %)씩 단조롭게 변하고,
 *     어떤 걸음도 100 m 에 해당하는 크기로 건너뛰지 않는다(옛 방식은 약 100 m 칸이 바뀔 때 한꺼번에 건넜습니다).
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-eye-follow.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  const U = (m) => import('file://' + path.join(PREVIEW, 'app', 'utils', m));
  const G0 = await U('geoMove.js');
  let G = null;
  try { G = await U('demGeometry.js'); } catch { G = null; }
  ok(!!G && typeof G.observerTileUV === 'function' && typeof G.blockCovers === 'function' && typeof G.moveObserver === 'function', 'demGeometry 가 있다');
  if (!G || typeof G.observerTileUV !== 'function') { console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); }

  const RAD = Math.PI / 180;
  // 독립 식: 슬리피 맵의 y 를 asinh(tan φ) 로 센다(구현은 log(tan φ + sec φ)).
  const tileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
  const tileY = (lat, z) => ((1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2) * 2 ** z;
  const SPAN = (z, lat) => (40075016.686 * Math.cos(lat * RAD)) / 2 ** z;

  // ── 1 타일 좌표
  console.log('\n[1] 타일 좌표');
  {
    const t = G.lonLatToTileFloat(126.978, 37.5665, 13);
    ok(near(t.x, tileX(126.978, 13), 1e-9) && near(t.y, tileY(37.5665, 13), 1e-9), `서울 줌 13: (${t.x.toFixed(5)}, ${t.y.toFixed(5)}) = 독립 식 (${tileX(126.978, 13).toFixed(5)}, ${tileY(37.5665, 13).toFixed(5)})`);
    const o = G.lonLatToTileFloat(0, 0, 1), c = G.lonLatToTileFloat(-180, 85.0511287798, 3);
    ok(near(o.x, 1, 1e-12) && near(o.y, 1, 1e-12) && near(c.x, 0, 1e-12) && near(c.y, 0, 1e-6), `기준점: (0, 0) 줌 1 → (${o.x}, ${o.y}), (−180, 85.0511) 줌 3 → (${c.x}, ${c.y.toExponential(1)})`);
    const a = G.lonLatToTileFloat(126.978, 37.5665, 12), b = G.lonLatToTileFloat(126.978, 37.5665, 13);
    ok(near(b.x, a.x * 2, 1e-9) && near(b.y, a.y * 2, 1e-9), '줌이 1 늘면 좌표가 정확히 2 배');
    ok(near(G.tileSpanMetres(13, 37.5665), SPAN(13, 37.5665), 1e-6), `타일 한 장의 지상 거리 ${G.tileSpanMetres(13, 37.5665).toFixed(1)} m = 독립 식`);
  }

  // ── 블록 만들기: 눈이 있는 타일이 정중앙인 3×3
  const mkPatch = (lat, lon, z = 13) => {
    const t = G.lonLatToTileFloat(lon, lat, z);
    const originTileX = Math.floor(t.x) - 1, originTileY = Math.floor(t.y) - 1;
    return { zoom: z, originTileX, originTileY, blockTiles: 3, tileSpanM: G.tileSpanMetres(z, lat), observerU: t.x - originTileX, observerV: t.y - originTileY };
  };

  // ── 2 원래 자리
  console.log('\n[2] 원래 자리');
  {
    const LAT = 37.5665, LON = 126.978;
    const p = mkPatch(LAT, LON);
    const o = G.observerTileUV(p, LAT, LON);
    ok(o.u >= 1 && o.u < 2 && o.v >= 1 && o.v < 2 && near(o.u, tileX(LON, 13) - p.originTileX, 1e-9) && near(o.v, tileY(LAT, 13) - p.originTileY, 1e-9),
      `관측자 타일이 정중앙인 블록에서 (${o.u.toFixed(4)}, ${o.v.toFixed(4)}) 는 [1, 2) 안이고 독립 식과 같다`);
  }

  // ── 3 · 4 동쪽 · 북쪽으로 d m
  console.log('\n[3·4] 동쪽 · 북쪽으로 d m');
  for (const LAT of [37.5665, 60, -33.9]) {
    const LON = 126.978;
    const p = mkPatch(LAT, LON), span = p.tileSpanM;
    const base = G.observerTileUV(p, LAT, LON);
    let worstE = 0, worstN = 0, uMoved = 0, vMoved = 0;
    for (const d of [1, 10, 100, 500, 1000, 2000]) {
      const e = G0.offsetLatLon(LAT, LON, d, 0), n = G0.offsetLatLon(LAT, LON, 0, d);
      const ue = G.observerTileUV(p, e.latitude, e.longitude), un = G.observerTileUV(p, n.latitude, n.longitude);
      worstE = Math.max(worstE, Math.abs((ue.u - base.u) / (d / span) - 1));
      worstN = Math.max(worstN, Math.abs((un.v - base.v) / (-d / span) - 1));
      uMoved = Math.max(uMoved, Math.abs(un.u - base.u)); vMoved = Math.max(vMoved, Math.abs(ue.v - base.v));
    }
    const tolN = 2 * (2000 / 6378137) * Math.abs(Math.tan(LAT * RAD)) + 1e-5;
    ok(worstE < 1e-5 && vMoved < 1e-9, `위도 ${LAT}: 동쪽으로 d m 가면 u 가 d/${span.toFixed(0)} 만큼(최대 상대오차 ${worstE.toExponential(1)}), v 는 그대로(${vMoved.toExponential(1)})`);
    ok(worstN < tolN && uMoved < 1e-9, `위도 ${LAT}: 북쪽으로 d m 가면 v 가 −d/${span.toFixed(0)} 만큼(최대 상대오차 ${worstN.toExponential(1)} < ${tolN.toExponential(1)}), u 는 그대로(${uMoved.toExponential(1)})`);
  }

  // ── 5 눈 옮기기
  console.log('\n[5] 눈 옮기기');
  {
    const LAT = 37.5665, LON = 126.978;
    const p = mkPatch(LAT, LON);
    const orig = { u: p.observerU, v: p.observerV };
    const to = G0.offsetLatLon(LAT, LON, 321, -123);
    const r = G.moveObserver(p, to.latitude, to.longitude);
    const expect = G.observerTileUV(p, to.latitude, to.longitude);
    const again = G.moveObserver(p, to.latitude, to.longitude);
    ok(p.observerU === expect.u && p.observerV === expect.v && r.u === expect.u && r.v === expect.v && again.u === r.u && again.v === r.v, 'moveObserver 가 observerU/V 를 고치고 같은 값을 돌려준다(두 번 해도 같다)');
    G.moveObserver(p, LAT, LON);
    ok(near(p.observerU, orig.u, 1e-9) && near(p.observerV, orig.v, 1e-9), `원래 경위도로 되돌리면 처음 값으로 돌아온다(차 ${Math.max(Math.abs(p.observerU - orig.u), Math.abs(p.observerV - orig.v)).toExponential(1)})`);
  }

  // ── 6 블록이 덮는가
  console.log('\n[6] 블록이 덮는가');
  {
    const LAT = 37.5665, LON = 126.978;
    const p = mkPatch(LAT, LON), span = p.tileSpanM;
    // 블록 중앙(경위도) = 눈이 있는 타일의 중심
    const cu = 1.5, cv = 1.5;
    const cT = { x: p.originTileX + cu, y: p.originTileY + cv };
    const lonC = (cT.x / 2 ** p.zoom) * 360 - 180;
    const latC = Math.atan(Math.sinh(Math.PI * (1 - (2 * cT.y) / 2 ** p.zoom))) / RAD;
    const at = (eM, nM) => G0.offsetLatLon(latC, lonC, eM, nM);
    // 독립 기댓값(미터 식): 반경 r 과 중앙에서 벗어난 e, n 에 대해 r + |e| 와 r + |n| 이 (1.5 − 여유) 타일 이하
    const exp = (r, eM, nM, margin) => r + Math.abs(eM) <= (1.5 - margin) * span && r + Math.abs(nM) <= (1.5 - margin) * span;
    const cases = [
      [3000, 0, 0, 0], [5800, 0, 0, 0], [5950, 0, 0, 0], [3000, 1000, 0, 0], [3000, 2800, 0, 0], [3000, 0, -2800, 0],
      [3000, 0, 0, 0.1], [3000, 1000, 0, 0.1], [3000, 1500, 0, 0.1], [3000, 2300, 0, 0.1], [3816, 0, 0, 0],
      // 여유가 있어야만 거짓이 되는 곳(여유 없이는 참): 이것이 없으면 여유를 무시해도 못 잡습니다
      [3000, 2600, 0, 0.1], [3000, 0, -2600, 0.1], [5600, 0, 0, 0.1], [3000, 2000, 0, 0.3],
    ];
    // 경계에 걸리는 경우는 부동소수 · 평면 근사 오차(수 m)를 피하려고 정확히 걸치는 칸은 시험하지 않는다
    const bad = [];
    for (const [r, e, n, m] of cases) {
      const margin = (1.5 * span - r - Math.max(Math.abs(e), Math.abs(n)) - m * span);
      if (Math.abs(margin) < 15) continue;                   // 15 m 안쪽으로 걸치면 건너뜀
      const pos = at(e, n);
      const got = G.blockCovers(p, pos.latitude, pos.longitude, r, m);
      if (got !== exp(r, e, n, m)) bad.push(`r=${r} e=${e} n=${n} m=${m} 기대 ${exp(r, e, n, m)} 실제 ${got}`);
    }
    ok(bad.length === 0, `블록 중앙에서 동 · 북으로 벗어난 ${cases.length} 곳에서 독립 미터 식과 같다${bad.length ? ' — ' + bad.slice(0, 2).join(' / ') : ''}`);
    const out = at(span * 2, 0), far = at(0, -span * 3);
    ok(!G.blockCovers(p, out.latitude, out.longitude, 100, 0) && !G.blockCovers(p, far.latitude, far.longitude, 100, 0), '블록 밖(동쪽 2 타일, 남쪽 3 타일)이면 반경이 작아도 거짓');
    ok(!G.blockCovers(p, NaN, LON, 100) && !G.blockCovers(p, LAT, Infinity, 100) && !G.blockCovers(p, LAT, LON, NaN), '위도 · 경도 · 반경이 NaN 이거나 무한대면 거짓');
  }

  // ── 7 끊김 없음
  console.log('\n[7] 끊김 없음');
  {
    const LAT = 37.5665, LON = 126.978;
    const p = mkPatch(LAT, LON), span = p.tileSpanM;
    const step = 2, per = step / span;
    let prev = null, worst = 0, minStep = Infinity, maxStep = 0, mono = true;
    for (let d = 0; d <= 1000; d += step) {
      const pos = G0.offsetLatLon(LAT, LON, d, 0);
      const o = G.observerTileUV(p, pos.latitude, pos.longitude);
      if (prev) { const du = o.u - prev.u; if (du <= 0) mono = false; minStep = Math.min(minStep, du); maxStep = Math.max(maxStep, du); worst = Math.max(worst, Math.abs(du / per - 1)); }
      prev = o;
    }
    ok(mono && worst < 0.01 && maxStep < 100 / span, `1 km 를 2 m 걸음(${(1000 / step) | 0}걸음)으로: 걸음마다 u 가 늘고(단조) 한 걸음 변화가 ${(minStep * span).toFixed(2)} ~ ${(maxStep * span).toFixed(2)} m 에 해당(기대 ${step} ± 1 %), 100 m 로 건너뛰지 않는다`);
  }

  // ── 8 가운데 타일 밖으로 나가는 때
  console.log('\n[8] 가운데 타일 밖으로 나가는 때');
  {
    const LAT = 37.5665, LON = 126.978;
    const p = mkPatch(LAT, LON), span = p.tileSpanM;
    ok(typeof G.denseRadiusM === 'function' && near(G.denseRadiusM(p), 0.98 * 0.5 * (3 - 1) * span, 1e-9), `촘촘한 패치가 보장하는 반지름 = 0.98 × 한 타일 = ${G.denseRadiusM ? G.denseRadiusM(p).toFixed(1) : '—'} m`);
    if (typeof G.denseRadiusM === 'function') {
      const R = G.denseRadiusM(p);
      // 블록 안 좌표 (u, v) 에 눈을 두려면 경위도로 거꾸로 푼다(독립 역변환)
      const at = (u, v) => {
        const x = p.originTileX + u, y = p.originTileY + v, n = 2 ** p.zoom;
        return { lon: (x / n) * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / RAD };
      };
      const covers = (u, v) => { const q = at(u, v); return G.blockCovers(p, q.lat, q.lon, R, 0); };
      ok(covers(1.5, 1.5) && covers(1.0, 1.0) && covers(1.99, 1.99) && covers(0.99, 1.5) && covers(2.01, 1.5) && covers(1.5, 0.99) && covers(1.5, 2.01),
         '가운데 타일 안과 그 둘레 0.01 타일 안(왼 · 오른 · 위 · 아래)은 참');
      ok(!covers(0.95, 1.5) && !covers(2.05, 1.5) && !covers(1.5, 0.95) && !covers(1.5, 2.05) && !covers(0.5, 0.5),
         '0.05 타일 넘게 벗어나면(왼 · 오른 · 위 · 아래, 대각선 멀리) 거짓');
    }
  }

  console.log(`\n${fail === 0 ? '모두 통과' : '실패 있음'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
