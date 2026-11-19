/**
 * **먼 건물 받기가 한도를 지키고 보이는 건물만 남기는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * `src/utils/farBuildingsLoad.ts` 를 **가짜 타일**로 돌립니다(`loadTile` 을 바꿔 끼움). 가짜 타일은 한 장에 8×8 건물 격자와
 * 몇 가지 함정(중심이 타일 밖인 중복 폴리곤, 높이 없음, 점 피처, 면적 0 링)을 넣고 한 장을 30 만 바이트로 칩니다.
 * 세계는 verify-far-buildings.js 와 같은 합성 산(동쪽 6 km, 440 m)입니다. 자는 느린 정답(곧은 선 걷기).
 *
 * 먼저 정한 줄:
 *  1. 후보 — 8×8 + 높이 없음 1(기본 9 m) = 65 채가 후보, 중복·점·면적 0 은 빠진다. 후보 위치가 타일 격자 좌표와 1 m 안.
 *  2. 받기 — 방위 범위 안의 계획 타일을 모두 받고(실패 0), 바이트 합이 타일 수 × 30 만. 남은 건물은 모두 정답으로도 0.07° 이상,
 *     거리 1~15 km 안, 방위 범위 안 타일에서만.
 *  3. 이어 받기 — 같은 맵을 주고 다시 부르면 0 장 받고, 방위 범위를 넓히면 새 타일만 받는다.
 *  4. 한도 — maxBytes 5 장 분이면 truncated, 받은 장 수가 5 + 동시 작업 3 이하(진행 중이던 몫).
 *  5. 실패 — 일부 타일이 던져도 나머지로 계속, failed 가 던진 수와 같다.
 *  6. 취소 — signal 이 서면 던지지 않고 그때까지의 맵을 돌려준다.
 *  7. 합치기 — picksToElements 는 큰 것부터 cap 채, 높이 태그·링이 맞고, 지면에서 뜬 부분(min_height)만 태그를 단다.
 *  8. 기하 잇기 — concatBuildingMeshData 가 길이·개수를 더하고 한쪽이 비면 다른 쪽을 그대로 돌려준다.
 *  9. 진행 — onProgress 의 tilesDone 이 늘기만 하고 마지막이 받을 타일 수.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-far-load.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const RAD = Math.PI / 180;

(async () => {
  const L = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'farBuildingsLoad.js'));
  const F = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'farBuildings.js'));
  const M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'mvtTiles.js'));
  const E = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'earth.js'));
  const drop = E.curvatureDropM;

  const LAT0 = 37.5, LON0 = 127.0, EYE = 41.6, TILE_BYTES = 300000;
  const mountain = (e, s) => 40 + 400 * Math.exp(-((e - 6000) ** 2) / (2 * 1200 ** 2)) * Math.exp(-(s ** 2) / (2 * 4000 ** 2));
  const truthVisible = (e, s, Hm) => {
    const D = Math.hypot(e, s);
    let m = -90;
    for (let d = 20; d < D - 1; d += 20) m = Math.max(m, Math.atan2(mountain(e * d / D, s * d / D) - EYE - drop(d), d) / RAD);
    const g = mountain(e, s);
    const top = Math.atan2(g + Hm - EYE - drop(D), D) / RAD, base = Math.atan2(g - EYE - drop(D), D) / RAD;
    return top - Math.max(base, m);
  };

  // 가짜 타일: 8×8 격자(칸 512, 건물 한 변 ±60)
  const ring = (cx, cy, r) => {
    const pts = [{ x: cx - r, y: cy - r }, { x: cx + r, y: cy - r }, { x: cx + r, y: cy + r }, { x: cx - r, y: cy + r }];
    return M.ringSignedArea(pts) > 0 ? pts : pts.reverse();
  };
  const heightOf = (tc, i, j) => 4 + ((tc.x * 31 + tc.y * 17 + i * 7 + j * 13) % 97) * 3;   // 4 ~ 295 m
  const fakeLayer = (tc) => {
    const features = [];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      features.push({ type: 3, props: { render_height: heightOf(tc, i, j), ...(i === 3 && j === 3 ? { render_min_height: 20 } : {}) }, rings: [ring(256 + i * 512, 256 + j * 512, 60)] });
    }
    features.push({ type: 3, props: {}, rings: [ring(2000, 2000, 50)] });                       // 높이 없음 → 9 m
    features.push({ type: 3, props: { render_height: 100 }, rings: [ring(-100, 2000, 50)] });   // 중심이 타일 밖 → 중복이라 빠짐
    features.push({ type: 1, props: { render_height: 100 }, rings: [[{ x: 10, y: 10 }]] });      // 점
    features.push({ type: 3, props: { render_height: 100 }, rings: [[{ x: 5, y: 5 }, { x: 5.5, y: 5 }, { x: 5, y: 5.5 }]] }); // 면적 0.125 < 1
    return { name: 'building', extent: 4096, features };
  };
  const loadFake = (failIf) => async (tc, signal) => {
    await new Promise(r => setTimeout(r, 1));
    if (failIf && failIf(tc)) throw new Error('fake network failure');
    return { layer: fakeLayer(tc), bytes: TILE_BYTES };
  };

  console.log('\n[1] 후보');
  {
    const tc = { z: 14, x: 13972, y: 6346 };
    const c = L.candidatesFromLayer(tc, fakeLayer(tc));
    ok(c.length === 65, `후보 ${c.length} 채 = 격자 64 + 높이 없음 1 (중복·점·면적 0 은 빠짐)`);
    const dflt = c.find(x => x.heightM === 9);
    ok(!!dflt, '높이 없음은 기본 9 m');
    const withMin = c.find(x => x.minHeightM === 20);
    ok(!!withMin, 'render_min_height 는 minHeightM 으로 이어진다');
    // 격자 (i=0,j=0) 중심 (256,256) 의 위경도가 타일 좌표 변환과 1 m 안
    const first = c[0];
    const exp = M.tilePointToLonLat(tc.x, tc.y, tc.z, 256, 256, 4096);
    const [de, ds] = F.lonLatToEastSouth(exp.lat, exp.lon, first.lat, first.lon);
    ok(Math.hypot(de, ds) < 1, `후보 위치가 타일 좌표 변환과 1 m 안 (${Math.hypot(de, ds).toFixed(3)} m)`);
    ok(first.ring.length === 4, '링 꼭짓점 4 개');
    // 높이 상한: 롯데월드타워(555 m)가 400 m 로 잘리지 않고, 터무니없는 값(5000 m)은 상한(M.MAX_RENDER_HEIGHT_M)에서 멈춘다. 계획의 최대 건물 높이와 같은 값.
    const ringAt = (cx, cy) => [{ x: cx - 40, y: cy - 40 }, { x: cx + 40, y: cy - 40 }, { x: cx + 40, y: cy + 40 }, { x: cx - 40, y: cy + 40 }];
    const tall = L.candidatesFromLayer(tc, { extent: 4096, features: [
      { type: 3, props: { render_height: 555 }, rings: [ringAt(2000, 2000)] },
      { type: 3, props: { render_height: 5000 }, rings: [ringAt(2600, 2000)] },
    ] });
    ok(tall.length === 2 && tall[0].heightM === 555, `555 m 는 그대로 (${tall[0] && tall[0].heightM} m)`);
    ok(tall[1].heightM === M.MAX_RENDER_HEIGHT_M && M.MAX_RENDER_HEIGHT_M >= 828, `5000 m 는 상한 ${M.MAX_RENDER_HEIGHT_M} m 에서 멈추고, 상한은 세계에서 가장 높은 건물(828 m)보다 낮지 않다`);
    ok(F.FAR_H_CAP_M === M.MAX_RENDER_HEIGHT_M, `타일 거르기의 가장 높은 건물(${F.FAR_H_CAP_M} m)이 읽기 상한과 같다`);
  }

  const SECTOR = { azDeg: 270, halfWidthDeg: 20 };
  console.log('\n[2] 받기');
  let tilesMap;
  {
    const prog = [];
    const r = await L.loadFarBuildings({ lat: LAT0, lon: LON0, eyeM: EYE, sample: mountain, sector: SECTOR, loadTile: loadFake(), onProgress: p => prog.push(p.tilesDone), maxBytes: 1e12 });
    tilesMap = r.tiles;
    ok(r.plan.tiles.length > 5 && r.fetched === r.plan.tiles.length && r.failed === 0 && !r.truncated, `계획 ${r.plan.tiles.length} 장을 모두 받음 (실패 ${r.failed}, truncated ${r.truncated})`);
    ok(r.bytes === r.fetched * TILE_BYTES, `바이트 합 ${r.bytes} = ${r.fetched} × ${TILE_BYTES}`);
    let bad = 0, n = 0, outRange = 0;
    for (const t of r.tiles.values()) for (const p of t.picks) {
      const [e, s] = F.lonLatToEastSouth(LAT0, LON0, p.item.lat, p.item.lon);
      const d = Math.hypot(e, s);
      if (d < F.FAR_INNER_M || d > F.FAR_OUTER_M) outRange++;
      if (truthVisible(e, s, p.item.heightM) < F.FAR_MIN_VISIBLE_DEG - 0.05) bad++;
      n++;
    }
    ok(n > 50 && bad === 0 && outRange === 0, `남은 ${n} 건물이 모두 정답으로도 0.07° 이상, 거리 1~15 km 안 (어긋남 ${bad}, 범위 밖 ${outRange})`);
    const ordered = prog.every((v, i) => i === 0 || v >= prog[i - 1]) && prog[prog.length - 1] === r.plan.tiles.length;
    ok(ordered, `진행 알림이 늘기만 하고 마지막이 ${r.plan.tiles.length} 장 (${prog.length} 번)`);
  }

  console.log('\n[3] 이어 받기');
  {
    const before = tilesMap.size;
    const r2 = await L.loadFarBuildings({ lat: LAT0, lon: LON0, eyeM: EYE, sample: mountain, sector: SECTOR, loadTile: loadFake(), existing: tilesMap, maxBytes: 1e12 });
    ok(r2.fetched === 0 && r2.tiles === tilesMap && tilesMap.size === before, '같은 방위로 다시 부르면 0 장 받고 같은 맵을 돌려준다');
    const r3 = await L.loadFarBuildings({ lat: LAT0, lon: LON0, eyeM: EYE, sample: mountain, sector: { azDeg: 270, halfWidthDeg: 60 }, loadTile: loadFake(), existing: tilesMap, maxBytes: 1e12 });
    ok(r3.fetched > 0 && tilesMap.size === before + r3.fetched, `방위를 넓히면 새 타일만 받는다 (+${r3.fetched} 장, 맵 ${tilesMap.size})`);
  }

  console.log('\n[4] 한도');
  {
    const r = await L.loadFarBuildings({ lat: LAT0, lon: LON0, eyeM: EYE, sample: mountain, sector: { azDeg: 270, halfWidthDeg: 60 }, loadTile: loadFake(), maxBytes: 5 * TILE_BYTES });
    ok(r.truncated && r.fetched >= 5 && r.fetched <= 8 && r.fetched < r.plan.tiles.length, `바이트 5 장 분 한도 → truncated, 받은 장 수 ${r.fetched} (5 ~ 5+3), 계획 ${r.plan.tiles.length}`);
    const few = await L.loadFarBuildings({ lat: LAT0, lon: LON0, eyeM: EYE, sample: mountain, sector: { azDeg: 270, halfWidthDeg: 60 }, loadTile: loadFake(), maxTiles: 4, maxBytes: 1e12 });
    ok(few.plan.tiles.length === 4 && few.fetched === 4, 'maxTiles 4 면 4 장만 계획하고 받는다');
  }

  console.log('\n[5] 실패');
  {
    const failIf = (tc) => tc.x % 3 === 0;
    const r = await L.loadFarBuildings({ lat: LAT0, lon: LON0, eyeM: EYE, sample: mountain, sector: SECTOR, loadTile: loadFake(failIf), maxBytes: 1e12 });
    const expectFail = r.plan.tiles.filter(failIf).length;
    ok(expectFail > 0 && r.failed === expectFail && r.fetched === r.plan.tiles.length - expectFail, `던진 ${expectFail} 장은 건너뛰고 나머지 ${r.fetched} 장은 받는다 (failed ${r.failed})`);
  }

  console.log('\n[6] 취소');
  {
    const ctl = new AbortController();
    let n = 0;
    const slow = async (tc, signal) => { if (++n === 3) ctl.abort(); await new Promise(r => setTimeout(r, 2)); return { layer: fakeLayer(tc), bytes: TILE_BYTES }; };
    let threw = false, r;
    try { r = await L.loadFarBuildings({ lat: LAT0, lon: LON0, eyeM: EYE, sample: mountain, sector: { azDeg: 270, halfWidthDeg: 60 }, loadTile: slow, signal: ctl.signal, maxBytes: 1e12 }); } catch { threw = true; }
    ok(!threw && r && r.fetched < r.plan.tiles.length, `취소해도 던지지 않고 그때까지(${r ? r.fetched : '?'}/${r ? r.plan.tiles.length : '?'})를 돌려준다`);
  }

  console.log('\n[7] 합치기');
  {
    const els = L.picksToElements(tilesMap.values(), 40);
    const all = [...tilesMap.values()].flatMap(t => t.picks);
    ok(els.length === Math.min(40, all.length), `cap 40 을 지킨다 (${els.length})`);
    const top = [...all].sort((a, b) => b.visibleDeg - a.visibleDeg).slice(0, 40);
    ok(els.every((el, i) => el.tags.height === top[i].item.heightM.toFixed(2) && el.geometry === top[i].item.ring), '큰 것부터, 높이 태그와 링이 맞다');
    const withMin = L.picksToElements([{ key: 'x', bytes: 0, picks: [{ item: { lat: 0, lon: 0, heightM: 50, minHeightM: 20, ring: [] }, distM: 5000, azDeg: 0, visibleDeg: 1 }, { item: { lat: 0, lon: 0, heightM: 30, minHeightM: 0, ring: [] }, distM: 5000, azDeg: 0, visibleDeg: 0.5 }] }]);
    ok(withMin[0].tags.min_height === '20.00' && withMin[1].tags.min_height === undefined, 'min_height 는 0.2 m 넘을 때만 태그');
  }

  console.log('\n[8] 기하 잇기');
  {
    const mk = (n) => ({ positions: new Float32Array(n * 3), normals: new Float32Array(n * 3), groundPos: new Float32Array(n * 2), wallCoords: new Float32Array(n * 4), buildingCount: n / 3, vertexCount: n });
    const a = mk(9), b = mk(6);
    const c = L.concatBuildingMeshData(a, b);
    ok(c.vertexCount === 15 && c.positions.length === 45 && c.groundPos.length === 30 && c.wallCoords.length === 60 && c.buildingCount === 5, '정점·건물 수와 네 배열 길이가 더해진다');
    ok(L.concatBuildingMeshData(null, b) === b && L.concatBuildingMeshData(a, null) === a && L.concatBuildingMeshData(null, null) === null, '한쪽이 비면 다른 쪽을 그대로');
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
