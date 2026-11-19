/**
 * **먼 건물 가시성이 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * `src/utils/farBuildings.ts`(지평선 프로필 · 타일 고르기 · 건물 고르기)를 **합성 산**에 대어 봅니다.
 * 자는 따로 짠 느린 정답 — 눈에서 건물까지 곧은 선을 20 m 걸음으로 걸으며 땅의 앙각 최댓값을 직접 잰 것 —
 * 입니다. 프로필은 방위 1° · 거리 250 m 칸으로 줄인 것이라, 정답과 **보수적으로만**(보이는 쪽으로만) 어긋나야 합니다.
 * "보이는데 가렸다"가 건물을 잃는 쪽이라 이쪽이 핵심입니다.
 *
 * 먼저 정한 줄:
 *  (지평선 프로필 자체의 정확도는 verify-skyline.js 가 지킵니다. 여기서는 그 위의 건물·타일 판단을 봅니다.)
 *  2. 가림 — 440 m 산 뒤 9 km 의 100 m 건물은 안 보인다. 꼭대기 앙각이 산마루 앙각(3.78°)을 넘는 900 m 는 보이고 보이는 각이
 *     정답과 0.05° 안(600 m 는 산마루와 같은 앙각이라 문턱 위에 서 있어 시험하지 않습니다). 평지 9 km 의 100 m 건물은
 *     보이는 각높이가 atan(100/9000)=0.64° 근처(곡률 낙차 안쪽 0.03°). 정답과 비교해 "프로필이 가렸는데 정답은 보임(0.05° 넘게)" 이 0 건.
 *  3. 크기 — 평지 12 km 의 3 m 건물은 보이는 각이 0.12° 미만이라 고르기에서 빠지고, 80 m 는 남는다.
 *  4. 타일 — 산 뒤 타일은 걸러지고(hidden > 0), 평지 타일은 남는다. 가까운 건물 읽기와 겹치는 타일도 남는다(그 읽기는
 *     1 km 밖 건물을 버리므로). 걸러진 타일마다 9×9 점에 600 m 건물을 세워 정답으로 재도 모두 0.12° + 0.05° 아래
 *     (= 잃은 타일 0). 가까운 순, maxTiles 한도.
 *  4b. 방위 범위(sector) — 보는 방향 ± 반폭만 받는다: 계획이 전체의 부분집합이고 훨씬 적으며, 반대쪽 타일은 없다.
 *  5. 고르기 — 큰 것부터 정렬, 한도(maxBuildings) 지킴, 거리 범위 밖 제외, 뽑힌 것은 정답으로도 0.12° − 0.05° 이상,
 *     버려진(범위 안) 것은 정답으로 0.12° + 0.05° 미만 또는 한도 때문.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-far-buildings.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const RAD = Math.PI / 180;

(async () => {
  const F = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'farBuildings.js'));
  const HZ = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'horizon.js'));
  const E = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'earth.js'));
  const drop = E.curvatureDropM;

  const LAT0 = 37.5, LON0 = 127.0, EYE_GROUND = 40, EYE = EYE_GROUND + 1.6;
  // 합성 산: 평지 40 m 위에 동쪽 6 km 에 440 m 산 덩어리(가우스, 동서 폭 1.2 km, 남북 폭 4 km)
  const mountain = (e, s) => 40 + 400 * Math.exp(-((e - 6000) ** 2) / (2 * 1200 ** 2)) * Math.exp(-(s ** 2) / (2 * 4000 ** 2));
  // 얇은 능선: 동쪽 3 km, 두께 100 m, 높이 150 m, 남북 ±1 km
  const wall = (e, s) => 40 + (Math.abs(e - 3000) < 50 && Math.abs(s) < 1000 ? 150 : 0);
  const eastSouth = (az, d) => [Math.sin(az * RAD) * d, -Math.cos(az * RAD) * d];

  // 느린 정답: 눈에서 (e,s) 까지 곧은 선을 걸으며 땅 앙각 최대(건물 바로 앞까지) — 지금 구현과 코드를 나누지 않습니다.
  const truthOcc = (h, e, s) => {
    const D = Math.hypot(e, s);
    let m = -90;
    for (let d = 20; d < D - 1; d += 20) {
      const g = h(e * d / D, s * d / D);
      if (g != null) m = Math.max(m, Math.atan2(g - EYE - drop(d), d) / RAD);
    }
    return m;
  };
  const truthVisible = (h, e, s, H) => {
    const D = Math.hypot(e, s), g = h(e, s);
    const top = Math.atan2(g + H - EYE - drop(D), D) / RAD, base = Math.atan2(g - EYE - drop(D), D) / RAD;
    return top - Math.max(base, truthOcc(h, e, s));
  };

  const prof = HZ.buildHorizonProfile(mountain, EYE);
  const profWall = HZ.buildHorizonProfile(wall, EYE);

  // ── [2] 가림 ───────────────────────────────────────────────────────────
  console.log('\n[2] 가림');
  {
    const [eE, sE] = eastSouth(90, 9000), [eW, sW] = eastSouth(270, 9000);
    const gE = mountain(eE, sE), gW = mountain(eW, sW);
    const v100E = F.visibleAngleDeg(prof, 90, 9000, gE, 100);
    const v900E = F.visibleAngleDeg(prof, 90, 9000, gE, 900);
    const t900E = truthVisible(mountain, eE, sE, 900);
    const v100W = F.visibleAngleDeg(prof, 270, 9000, gW, 100);
    ok(v100E <= 0, `산 뒤 9 km 의 100 m 건물은 안 보인다 (보이는 각 ${v100E.toFixed(3)}°)`);
    ok(v900E > 0.5 && Math.abs(v900E - t900E) < 0.05, `산 뒤 9 km 의 900 m 건물은 보인다 (${v900E.toFixed(3)}°, 정답 ${t900E.toFixed(3)}°)`);
    const flat = Math.atan2(100, 9000) / RAD;
    ok(Math.abs(v100W - flat) < 0.03, `평지 9 km 의 100 m 건물 보이는 각 ${v100W.toFixed(3)}° ≈ atan(100/9000) = ${flat.toFixed(3)}°`);
    // 정답과 견줘 "프로필은 가렸는데 정답은 보임" 이 없어야 한다
    let lost = 0, n = 0;
    for (let az = 40; az <= 140; az += 5) {
      for (const d of [2000, 5000, 7000, 9000, 12000, 15000]) {
        for (const H of [30, 100, 250, 600]) {
          const [e, s] = eastSouth(az, d), g = mountain(e, s);
          const p = F.visibleAngleDeg(prof, az, d, g, H), t = truthVisible(mountain, e, s, H);
          if (p <= 0 && t > 0.05) lost++;
          n++;
        }
      }
    }
    ok(lost === 0, `${n} 건물 중 "프로필이 가렸는데 정답은 0.05° 넘게 보임" 이 ${lost} 건`);
    // 얇은 능선(방위 칸보다 좁은 가림)에서도 같은 판정
    let lostW = 0, nW = 0;
    for (let az = 60; az <= 120; az += 3) {
      for (const d of [4000, 6000, 9000]) {
        for (const H of [20, 60, 150]) {
          const [e, s] = eastSouth(az, d), g = wall(e, s);
          const p = F.visibleAngleDeg(profWall, az, d, g, H), t = truthVisible(wall, e, s, H);
          if (p <= 0 && t > 0.05) lostW++;
          nW++;
        }
      }
    }
    ok(lostW === 0, `얇은 능선 ${nW} 건물 중 놓침 ${lostW} 건`);
  }

  // ── [3] 크기 ───────────────────────────────────────────────────────────
  console.log('\n[3] 크기');
  {
    const items = [];
    const mk = (az, d, H, id) => { const [e, s] = eastSouth(az, d); const lat = LAT0 - s / 110574, lon = LON0 + e / (111320 * Math.cos(LAT0 * RAD)); return { lat, lon, heightM: H, ring: [], id }; };
    items.push(mk(270, 12000, 3, 'tiny'), mk(270, 12000, 80, 'mid'), mk(270, 500, 20, 'inner'), mk(270, 16000, 200, 'outer'));
    const picks = F.selectVisibleFar(prof, mountain, LAT0, LON0, items);
    const ids = picks.map(p => p.item.id);
    ok(!ids.includes('tiny'), '평지 12 km 의 3 m 건물은 빠진다');
    ok(ids.includes('mid'), '평지 12 km 의 80 m 건물은 남는다');
    ok(!ids.includes('inner') && !ids.includes('outer'), '거리 범위(1 ~ 15 km) 밖은 빠진다');
  }

  // ── [4] 타일 ───────────────────────────────────────────────────────────
  console.log('\n[4] 타일');
  {
    const M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'mvtTiles.js'));
    const plan = F.planFarTiles(prof, mountain, LAT0, LON0);
    const all = F.planFarTiles(prof, mountain, LAT0, LON0, { maxTiles: 100000 });
    console.log(`      후보 ${all.considered} · 가려져 거름 ${all.hidden} · 받을 것 ${all.tiles.length} (한도 적용 ${plan.tiles.length})`);
    ok(all.hidden > 0, `산 뒤 타일이 걸러진다 (${all.hidden})`);
    ok(all.tiles.length > 0 && all.tiles.length < all.considered, '평지 타일은 남고 일부만 거른다');
    ok(plan.tiles.length <= 150, `한도 150 을 지킨다 (${plan.tiles.length})`);
    const few = F.planFarTiles(prof, mountain, LAT0, LON0, { maxTiles: 10 });
    ok(few.tiles.length === 10, 'maxTiles 10 이면 10 개');
    ok(few.tiles.every((t, i) => t.x === all.tiles[i].x && t.y === all.tiles[i].y), '한도로 자르면 가까운 순 앞쪽이 남는다(전체 목록의 앞 10 개와 같다)');

    {
      const sec = F.planFarTiles(prof, mountain, LAT0, LON0, { maxTiles: 100000, sector: { azDeg: 270, halfWidthDeg: 20 } });
      const allSet = new Set(all.tiles.map(t => `${t.x},${t.y}`));
      ok(sec.tiles.length > 0 && sec.tiles.every(t => allSet.has(`${t.x},${t.y}`)), `방위 범위(서쪽 ±20°) 계획은 전체 계획의 부분집합 (${sec.tiles.length} ⊂ ${all.tiles.length})`);
      ok(sec.tiles.length < all.tiles.length * 0.4, `받는 타일이 전체의 40% 아래로 준다 (${sec.tiles.length}/${all.tiles.length})`);
      const east = sec.tiles.filter(t => {
        const c = M.tilePointToLonLat(t.x, t.y, t.z, 0.5, 0.5, 1);
        const [e, s] = F.lonLatToEastSouth(LAT0, LON0, c.lat, c.lon);
        return Math.hypot(e, s) > 6000 && F.angDiffDeg(Math.atan2(e, -s) / RAD, 90) < 30;
      });
      ok(east.length === 0, '반대쪽(동쪽) 먼 타일은 없다');
    }

    // 걸러진 타일을 정답으로 점검: 타일 안 9×9 점에 600 m 건물을 세워도 0.12° + 0.05° 아래여야 한다
    const keep = new Set(all.tiles.map(t => `${t.x},${t.y}`));
    const nearKeys = new Set(M.tileListForRadius(LAT0, LON0, 1000, 14).map(t => `${t.x},${t.y}`));
    ok([...nearKeys].some(k => keep.has(k)), '가까운 건물 읽기와 겹치는 타일도 남는다(그 읽기가 버린 1 km 밖 건물을 받으려고)');
    let lostTiles = 0, checked = 0, worstHidden = -Infinity;
    for (const t of M.tileListForRadius(LAT0, LON0, F.FAR_OUTER_M, 14)) {
      const key = `${t.x},${t.y}`;
      if (keep.has(key)) continue;
      const nw = M.tilePointToLonLat(t.x, t.y, t.z, 0, 0, 1), se = M.tilePointToLonLat(t.x, t.y, t.z, 1, 1, 1);
      let best = -Infinity, anyIn = false;
      for (let iy = 0; iy < 9; iy++) for (let ix = 0; ix < 9; ix++) {
        const lat = nw.lat + (se.lat - nw.lat) * (iy + 0.5) / 9, lon = nw.lon + (se.lon - nw.lon) * (ix + 0.5) / 9;
        const [e, s] = F.lonLatToEastSouth(LAT0, LON0, lat, lon);
        const d = Math.hypot(e, s);
        if (d < F.FAR_INNER_M || d > F.FAR_OUTER_M) continue;
        anyIn = true;
        best = Math.max(best, truthVisible(mountain, e, s, F.FAR_H_CAP_M));
      }
      if (!anyIn) continue;
      checked++;
      worstHidden = Math.max(worstHidden, best);
      if (best >= F.FAR_MIN_VISIBLE_DEG + 0.05) lostTiles++;
    }
    console.log(`      걸러진 타일 ${checked}장을 9×9 점으로 재점검 — 가장 보이는 점 ${worstHidden.toFixed(3)}°`);
    ok(lostTiles === 0, `걸러진 타일 중 정답으로 보이는 곳이 있는 타일 ${lostTiles} 장`);
  }

  // ── [5] 고르기 ─────────────────────────────────────────────────────────
  console.log('\n[5] 고르기');
  {
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const items = [];
    for (let i = 0; i < 4000; i++) {
      const az = rnd() * 360, d = 500 + rnd() * 16500, H = 4 + Math.pow(rnd(), 3) * 300;
      const [e, s] = eastSouth(az, d);
      items.push({ lat: LAT0 - s / 110574, lon: LON0 + e / (111320 * Math.cos(LAT0 * RAD)), heightM: H, ring: [] });
    }
    const picks = F.selectVisibleFar(prof, mountain, LAT0, LON0, items, { maxBuildings: 200 });
    const sorted = picks.every((p, i) => i === 0 || picks[i - 1].visibleDeg >= p.visibleDeg);
    ok(sorted && picks.length <= 200, `큰 것부터 정렬, 한도 200 을 지킨다 (${picks.length})`);
    ok(picks.every(p => p.distM >= F.FAR_INNER_M && p.distM <= F.FAR_OUTER_M), '모두 거리 범위(1 ~ 15 km) 안');
    const all = F.selectVisibleFar(prof, mountain, LAT0, LON0, items, { maxBuildings: 100000 });
    const inTruthBad = all.filter(p => truthVisible(mountain, ...F.lonLatToEastSouth(LAT0, LON0, p.item.lat, p.item.lon), p.item.heightM) < F.FAR_MIN_VISIBLE_DEG - 0.05).length;
    ok(inTruthBad === 0, `뽑힌 ${all.length} 건물이 모두 정답으로도 0.07° 이상 (${inTruthBad} 건 어긋남)`);
    const chosen = new Set(all.map(p => p.item));
    let wrongDrop = 0;
    for (const it of items) {
      const [e, s] = F.lonLatToEastSouth(LAT0, LON0, it.lat, it.lon);
      const d = Math.hypot(e, s);
      if (chosen.has(it) || d < F.FAR_INNER_M || d > F.FAR_OUTER_M) continue;
      if (truthVisible(mountain, e, s, it.heightM) >= F.FAR_MIN_VISIBLE_DEG + 0.05) wrongDrop++;
    }
    ok(wrongDrop === 0, `범위 안에서 버려진 건물 중 정답으로 0.17° 넘게 보이는 것 ${wrongDrop} 건`);
  }

  // ── [7] 안쪽 반지름 ────────────────────────────────────────────────────
  console.log('\n[7] 가까운 건물 읽기와 맞물림');
  {
    const src = require('fs').readFileSync(path.join(__dirname, '..', '..', 'src', 'utils', 'buildingTiles.ts'), 'utf8');
    const m = src.match(/export const BUILDING_RADIUS_M = (\d+)/);
    ok(!!m && Number(m[1]) === F.FAR_INNER_M, `FAR_INNER_M(${F.FAR_INNER_M}) = BUILDING_RADIUS_M(${m ? m[1] : '?'}) — 사이에 빈 띠도 겹침도 없다`);
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
