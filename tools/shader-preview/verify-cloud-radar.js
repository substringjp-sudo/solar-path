/**
 * **구름 레이더가 자료가 아는 만큼만 그리는가** 합격 판정. 브라우저가 필요 없습니다.
 *
 * 무엇을 왜 하는지는 `src/utils/cloudRadar.ts` 머리말에 있습니다.
 *
 * ## 이 자가 지키려는 것
 *
 * 레이더 그림은 **실제보다 많이 아는 것처럼 보이기 쉽습니다.** 고리 바깥에서
 * 이웃 점 사이가 183km 인데 매끈하게 칠하면 1km 급 관측처럼 읽힙니다.
 * 그래서 여기서는 세 가지를 못 박습니다:
 *
 *  1. **자료 밖을 안 칠한다** — 모든 칸이 반경 380km 원반 안에 있다.
 *  2. **자료의 해상도 그대로 그린다** — 칸 수가 고리 구조와 정확히 맞는다.
 *  3. **보이는 구간이 잰 값과 맞는다** — 위아래 문턱이 측정에서 나온 값이다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-cloud-radar.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

const LAT = 37.4863, LON = 127.0443;
const RAD = Math.PI / 180, DEG = 180 / Math.PI, EARTH = 6371;
const ang = (la1, lo1, la2, lo2) => {
  const p1 = la1 * RAD, p2 = la2 * RAD, dl = (lo2 - lo1) * RAD;
  return Math.acos(Math.max(-1, Math.min(1,
    Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl)))) * EARTH;
};

/** 고리 자료를 흉내 냅니다 — 앱이 주는 모양 그대로. */
function fakeRing(coverAt) {
  const RING_AZ = [0, 30, 60, 90, 120, 150, 180, -150, -120, -90, -60, -30];
  const NEAR = [0, 60, 120, 180, -120, -60];
  const RINGS = [[5, NEAR], [10, RING_AZ], [30, RING_AZ], [70, RING_AZ],
                 [130, RING_AZ], [200, RING_AZ], [280, RING_AZ], [380, RING_AZ]];
  const t0 = Date.UTC(2026, 8, 11, 0, 0, 0);
  const mk = (dist, az) => {
    const timeMs = [], total = [];
    for (let h = 0; h < 24; h++) { timeMs.push(t0 + h * 3600e3); total.push(coverAt(dist, az, h)); }
    return {
      distance: dist, azimuthOffset: az, low: 0, mid: 0, high: 0,
      hourly: { time: [], timeMs, low: total.map(() => 0), mid: total.map(() => 0), high: total.map(() => 0), total },
    };
  };
  const out = [mk(0, 0)];
  for (const [d, azs] of RINGS) for (const az of azs) out.push(mk(d, az));
  return out;
}

(async () => {
  const M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'cloudRadar.js'));
  const {
    buildRadarFrame, isRadarScale, radarColor, kmPerLonDeg,
    RADAR_MIN_VIEW_KM, RADAR_MAX_VIEW_KM, RADAR_RADIUS_KM, RADAR_RINGS_KM,
  } = M;

  const T = Date.UTC(2026, 8, 11, 6, 0, 0);
  // 동쪽이 흐리고 서쪽이 맑은 하늘 — 방향을 가리는지 보려고 일부러 비대칭입니다.
  const ring = fakeRing((dist, az) => {
    const east = Math.sin(az * RAD);
    return Math.max(0, Math.min(100, 50 + 45 * east * Math.min(1, dist / 200)));
  });

  // ── [1] 보이는 구간 ────────────────────────────────────────────────
  console.log('\n[1] 보이는 축척 구간 — 잰 값에서 나온 문턱인가');
  {
    const kmPer = kmPerLonDeg(LAT);
    const loDeg = RADAR_MIN_VIEW_KM / kmPer, hiDeg = RADAR_MAX_VIEW_KM / kmPer;
    console.log(`      문턱 ${RADAR_MIN_VIEW_KM}km ~ ${RADAR_MAX_VIEW_KM}km`);
    console.log(`      위도 ${LAT}° 에서는 ${loDeg.toFixed(2)}° ~ ${hiDeg.toFixed(2)}°`);
    ok(!isRadarScale(0.1, LAT), `0.1° 는 안 그린다 — 예보 격자(약 25km)라 화면이 평평하다`);
    ok(isRadarScale(0.3, LAT), `0.3° 는 그린다`);
    ok(isRadarScale(3, LAT), `3° 는 그린다`);
    ok(!isRadarScale(10, LAT), `10° 는 안 그린다 — 원반이 화면을 못 덮는다`);
    // ⚠ 위도에 따라 달라져야 합니다. 처음에 6.8° 로 박아 뒀다가 여기 걸렸습니다.
    console.log(`      같은 8.0° 가 — 도곡동(37.5°N): ${isRadarScale(8, LAT) ? '그림' : '안 그림'}`
              + ` · 적도: ${isRadarScale(8, 0) ? '그림' : '안 그림'}`
              + ` · 60°N: ${isRadarScale(8, 60) ? '그림' : '안 그림'}`);
    ok(isRadarScale(8, LAT) && !isRadarScale(8, 0) && isRadarScale(8, 60),
       `같은 도수라도 위도에 따라 갈린다 — 문턱이 km 이지 도가 아니다`);
    ok(Math.abs(hiDeg * kmPer - 2 * RADAR_RADIUS_KM) < 1,
       `위 문턱이 원반 지름 그대로다 (${(hiDeg * kmPer).toFixed(0)}km)`);
    ok(buildRadarFrame(ring, LAT, LON, T, 0.1) === null, `구간 밖이면 아무것도 안 만든다`);
    ok(buildRadarFrame(null, LAT, LON, T, 3) === null, `자료가 없으면 null`);
    ok(buildRadarFrame([], LAT, LON, T, 3) === null, `빈 자료면 null`);
  }

  const frame = buildRadarFrame(ring, LAT, LON, T, 3);

  // ── [2] ⚠ 자료 밖을 안 칠하는가 ────────────────────────────────────
  console.log('\n[2] 자료 밖을 안 칠하는가');
  {
    let worst = 0;
    for (const c of frame.cells) {
      for (const p of c.polygon) worst = Math.max(worst, ang(LAT, LON, p.latitude, p.longitude));
    }
    console.log(`      칸 ${frame.cells.length}개 · 가장 먼 꼭짓점 ${worst.toFixed(1)}km (자료 한계 ${RADAR_RADIUS_KM}km)`);
    ok(worst <= RADAR_RADIUS_KM + 1, `모든 칸이 원반 안에 있다`);
    let edgeWorst = 0;
    for (const p of frame.edge) edgeWorst = Math.max(edgeWorst, Math.abs(ang(LAT, LON, p.latitude, p.longitude) - RADAR_RADIUS_KM));
    ok(edgeWorst < 1, `원반 테두리가 자료 한계 위에 있다 (오차 ${edgeWorst.toFixed(2)}km)`);
  }

  // ── [3] ⚠ 자료의 해상도 그대로 그리는가 ───────────────────────────
  console.log('\n[3] 자료가 가진 해상도 그대로인가');
  {
    const expected = (RADAR_RINGS_KM.length - 1) * (360 / 30);
    console.log(`      고리 ${RADAR_RINGS_KM.length - 1}단 × 방위 12 = ${expected}칸 · 실제 ${frame.cells.length}칸`);
    ok(frame.cells.length === expected, `칸 수가 고리 구조와 정확히 같다 — 없는 해상도를 만들지 않는다`);
    console.log(`      가장 바깥 칸의 방위 폭 ${frame.outerSpacingKm.toFixed(0)}km`);
    ok(frame.outerSpacingKm > 150,
       `바깥 칸이 실제로 거칠다 (${frame.outerSpacingKm.toFixed(0)}km) — 화면에 적어 숨기지 않는다`);
  }

  // ── [4] 방향을 실제로 가리는가 ────────────────────────────────────
  console.log('\n[4] 동쪽이 흐린 하늘을 동쪽이 흐리다고 그리는가');
  {
    const far = frame.cells.filter(c => c.outerKm >= 280);
    const eastOf = (c) => {
      const p = c.polygon[2];
      return p.longitude > LON;
    };
    const east = far.filter(eastOf), west = far.filter(c => !eastOf(c));
    const avg = a => a.reduce((s, c) => s + c.coverPct, 0) / a.length;
    console.log(`      바깥 칸 — 동쪽 ${avg(east).toFixed(0)}% · 서쪽 ${avg(west).toFixed(0)}%`);
    ok(avg(east) > avg(west) + 30, `동쪽이 실제로 더 흐리게 나온다`);

    // ⚠ 음성 대조 — 균일한 하늘이면 방향 차가 없어야 합니다.
    const flat = buildRadarFrame(fakeRing(() => 60), LAT, LON, T, 3);
    const spread = Math.max(...flat.cells.map(c => c.coverPct)) - Math.min(...flat.cells.map(c => c.coverPct));
    ok(spread < 0.01, `균일한 하늘은 균일하게 나온다 (편차 ${spread.toFixed(3)}%p) — 무늬를 지어내지 않는다`);
  }

  // ── [5] 색 ────────────────────────────────────────────────────────
  console.log('\n[5] 운량 → 색');
  {
    const alphaOf = s => Number(s.match(/,\s*([\d.]+)\)$/)[1]);
    const a0 = alphaOf(radarColor(0)), a50 = alphaOf(radarColor(50)), a100 = alphaOf(radarColor(100));
    console.log(`      투명도 0% ${a0} · 50% ${a50} · 100% ${a100}`);
    ok(a0 < a50 && a50 < a100, `흐릴수록 진해진다`);
    ok(a0 < 0.2, `맑으면 지도가 비쳐 보인다 (${a0})`);
    ok(radarColor(0) !== radarColor(100), `양 끝 색이 다르다`);
    // 비 레이더로 오해할 초록/빨강을 안 씁니다 — 구름이지 비가 아닙니다.
    const m = radarColor(100).match(/rgba\((\d+), (\d+), (\d+)/);
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    ok(Math.abs(r - g) < 40 && Math.abs(g - b) < 40,
       `짙은 쪽이 무채색에 가깝다 (${r},${g},${b}) — 비 레이더로 안 읽히게`);
  }

  // ── [6] 시각이 실제로 바뀌는가 ────────────────────────────────────
  console.log('\n[6] 시각을 바꾸면 그림이 바뀌는가');
  {
    const moving = fakeRing((dist, az, h) => {
      const east = Math.sin(az * RAD);
      return Math.max(0, Math.min(100, 50 + 45 * east * Math.min(1, dist / 200) * (h < 12 ? 1 : -1)));
    });
    const am = buildRadarFrame(moving, LAT, LON, Date.UTC(2026, 8, 11, 6), 3);
    const pm = buildRadarFrame(moving, LAT, LON, Date.UTC(2026, 8, 11, 18), 3);
    let diff = 0;
    for (let i = 0; i < am.cells.length; i++) diff = Math.max(diff, Math.abs(am.cells[i].coverPct - pm.cells[i].coverPct));
    console.log(`      06시와 18시 사이 최대 차 ${diff.toFixed(0)}%p`);
    ok(diff > 30, `시각을 바꾸면 그림이 실제로 바뀐다`);
    ok(am.timeMs !== pm.timeMs, `프레임이 제 시각을 기억한다`);
  }

  // ── [9] 구 위의 레이더 (§120) ─────────────────────────────────────
  //    평면 지도의 위 문턱(화면 폭 760km)은 "원반이 화면을 못 덮으면 섬만 뜬다"
  //    였습니다. 구에서는 그 섬이 보여야 할 것이라, 원반이 몇 px 인가로 정합니다.
  console.log('\n[9] 구 위의 레이더 — 원반 크기로 켜고, 칸은 평면과 같고, 구면에서 안팎이 맞는가');
  {
    const { isGlobeRadarScale, radarDiskPx, GLOBE_RADAR_MIN_PX } = M;
    const fitR = 0.42 * 362;                        // 구 둘레가 다 보이는 반지름(390px 폰)
    console.log(`      원반 반지름: 구 전체(R ${fitR.toFixed(0)}) ${radarDiskPx(fitR).toFixed(1)}px · R 300 ${radarDiskPx(300).toFixed(1)}px · R 800 ${radarDiskPx(800).toFixed(1)}px`);
    ok(!isGlobeRadarScale(fitR), `구 전체가 보일 때는 안 그린다 — 원반이 ${GLOBE_RADAR_MIN_PX}px 보다 작다`);
    ok(isGlobeRadarScale(300) && isGlobeRadarScale(800), `확대한 구에서는 그린다`);
    const bigDelta = 40;                            // 구 축척 — 평면 문턱(760km) 한참 밖
    ok(buildRadarFrame(ring, LAT, LON, T, bigDelta) === null, `대조: 같은 축척을 평면 규칙으로 물으면 안 그린다`);
    const g = buildRadarFrame(ring, LAT, LON, T, bigDelta, { globeRadiusPx: 400 });
    const flat = buildRadarFrame(ring, LAT, LON, T, 3);
    ok(g && flat && g.cells.length === flat.cells.length
      && g.cells.every((c, i) => c.coverPct === flat.cells[i].coverPct),
      `구에서도 평면과 같은 칸·같은 값이다 (${g ? g.cells.length : 0}칸)`);
    ok(buildRadarFrame(ring, LAT, LON, T, bigDelta, { globeRadiusPx: fitR }) === null, `구 전체 축척이면 구 규칙으로도 null`);

    // ⚠ d3 는 구면 다각형을 감긴 방향으로 안팎을 가립니다. 반대로 감기면 칸이
    //   아니라 칸을 뺀 지구 전체가 칠해집니다 — 구 그리기(`MapGlobe`)가 넓이로
    //   가려 뒤집는 까닭을 여기서 잽니다.
    const d3 = await import('file://' + path.join(__dirname, '..', '..', 'node_modules', 'd3-geo', 'src', 'index.js'));
    const diskSr = 2 * Math.PI * (1 - Math.cos(RADAR_RADIUS_KM / EARTH));
    let inside = 0, flipped = 0, worst = 0;
    for (const c of g.cells) {
      const ring2 = c.polygon.map(q => [q.longitude, q.latitude]);
      ring2.push(ring2[0].slice());
      let a = d3.geoArea({ type: 'Polygon', coordinates: [ring2] });
      if (a > 2 * Math.PI) { flipped++; ring2.reverse(); a = d3.geoArea({ type: 'Polygon', coordinates: [ring2] }); } else inside++;
      worst = Math.max(worst, a / diskSr);
    }
    console.log(`      칸 감긴 방향: 그대로 ${inside} · 뒤집음 ${flipped} — 뒤집은 뒤 가장 큰 칸 = 원반의 ${(worst * 100).toFixed(1)}%`);
    ok(worst < 0.1, `뒤집은 뒤 모든 칸이 원반의 10% 안이다 (지구 전체가 칠해지는 칸이 없다)`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
