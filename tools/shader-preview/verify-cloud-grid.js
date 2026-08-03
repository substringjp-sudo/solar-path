/**
 * 강화 구름 격자 어댑터 검증.
 *
 * 확인하는 것:
 *  1. 격자가 `WeatherFan` → `buildSkyColumns` 를 통과하며 운량을 보존하는가
 *  2. 기본 팬(±20°)보다 실측 신뢰 영역이 실제로 넓어지는가
 *  3. 격자 중심 방위와 현재 태양 방위가 어긋나도 구조가 회전하지 않는가
 *  4. 관측점 앵커가 붙어 머리 위가 10km 밖 값으로 채워지지 않는가
 *  5. 시간축 재보간이 작동하는가 (격자가 fetch 시각에 얼어붙지 않는가)
 */
global.__DEV__ = false;
const S = require('/tmp/skybuild/skyColumn.js');
const G = require('/tmp/skybuild/cloudGrid.js');
const AD = require('/tmp/skybuild/cloudGridAdapter.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

const AZ_OFFSETS = [-30, -20, -10, 0, 10, 20, 30];
const DIST_RINGS = [10, 20, 35, 55, 80, 120, 170, 230, 300, 380];
const T0 = new Date('2026-08-03T10:00:00Z');

/** 실제 fetchCloudGrid 산출물과 같은 모양의 격자를 만듭니다. */
function makeGrid(azCenter, coverFn, hourlySeries) {
  const points = [];
  for (const azOffset of AZ_OFFSETS) {
    for (const distance of DIST_RINGS) {
      const c = coverFn(azOffset, distance);
      points.push({
        latitude: 37.5, longitude: 127, distance,
        bearing: (azCenter + azOffset + 360) % 360,
        azOffset, low: c.low, mid: c.mid, high: c.high,
        hourly: hourlySeries ? hourlySeries(azOffset, distance) : undefined,
      });
    }
  }
  return { points, timestamp: Date.now(), azCenter, observerLat: 37.5, observerLon: 127 };
}

/** 기본 팬(5레이 × 7고리, ±20°) */
function makeStandardFan(low, mid, high, opts = {}) {
  const out = [{ distance: 0, azimuthOffset: 0, low, mid, high, ...opts }];
  for (const off of [-20, -10, 0, 10, 20])
    for (const d of [10, 30, 70, 130, 200, 280, 380])
      out.push({ distance: d, azimuthOffset: off, low, mid, high, ...opts });
  return out;
}

const columns = (fanSamples, sunAz) => S.buildSkyColumns({
  fan: new S.WeatherFan(fanSamples, sunAz),
  driftMinutes: 0, windSpeedKmh: 20, windBearingDeg: 260,
});

// ── 1. 운량 보존 ───────────────────────────────────────────────────────────
console.log('== 격자 → 하늘 운량 보존 ==');
for (const cover of [0, 20, 45, 70, 100]) {
  const grid = makeGrid(270, () => ({ low: cover, mid: 0, high: 0 }));
  const fan = AD.cloudGridToFan({
    grid, time: T0, sunAzimuthDeg: 270,
    baseline: [{ distance: 0, azimuthOffset: 0, low: cover, mid: 0, high: 0, humidity: 60 }],
  });
  const m = S.layerMeanCover(columns(fan, 270), 'low');
  const err = Math.abs(m - cover / 100);
  ok(err < 0.05, `입력 ${String(cover).padStart(3)}% → 하늘 평균 ${(m * 100).toFixed(1)}% (오차 ${(err * 100).toFixed(1)}%p)`);
}

// ── 2. 실측 신뢰 영역이 넓어지는가 ──────────────────────────────────────────
console.log('\n== 실측 신뢰 영역 (기본 팬 대비) ==');
{
  const baseline = makeStandardFan(50, 0, 0, { humidity: 60 });
  const grid = makeGrid(270, () => ({ low: 50, mid: 0, high: 0 }));
  const gridFan = AD.cloudGridToFan({ grid, time: T0, sunAzimuthDeg: 270, baseline });

  const confFrac = samples => {
    const low = samples.filter(s => s.layer === 'low');
    return low.filter(s => s.confidence > 0.99).length / low.length;
  };
  const stdFrac = confFrac(columns(baseline, 270));
  const gridFrac = confFrac(columns(gridFan, 270));

  console.log(`  기본 팬 ±20°: 하늘의 ${(stdFrac * 100).toFixed(1)}% 가 실측`);
  console.log(`  강화 격자 ±30°: 하늘의 ${(gridFrac * 100).toFixed(1)}% 가 실측`);
  ok(gridFrac > stdFrac, `실측 영역 확대 (${(stdFrac * 100).toFixed(1)}% → ${(gridFrac * 100).toFixed(1)}%)`);
  // ±30/±20 = 1.5배. 방위 24스텝(15° 간격)이라 정확히 1.5는 아니지만 근처여야 합니다.
  const ratio = gridFrac / Math.max(1e-6, stdFrac);
  ok(ratio > 1.2 && ratio < 1.9, `확대 비율 ${ratio.toFixed(2)}배 (기대 ~1.5)`);

  ok(new Set(gridFan.map(s => s.azimuthOffset)).size === 7, '레이 7개 유지 (관측점 앵커가 레이를 늘리지 않음)');
  ok(gridFan.filter(s => s.distance === 0).length === 7, '레이마다 0km 앵커 1개');
}

// ── 3. 방위 어긋남 보정 ────────────────────────────────────────────────────
console.log('\n== 격자 중심과 태양 방위가 어긋날 때 ==');
{
  // 서쪽(오프셋 0) 절반만 흐리고 동쪽 절반은 맑은 격자.
  const grid = makeGrid(270, azOff => ({ low: azOff < 0 ? 90 : 5, mid: 0, high: 0 }));
  const baseline = [{ distance: 0, azimuthOffset: 0, low: 45, mid: 0, high: 0, humidity: 60 }];

  // 격자는 방위 270°에서 받았는데 지금 태양은 258°.
  const shifted = AD.cloudGridToFan({ grid, time: T0, sunAzimuthDeg: 258, baseline });
  const aligned = AD.cloudGridToFan({ grid, time: T0, sunAzimuthDeg: 270, baseline });

  // 보정이 맞으면 두 경우의 **절대 방위** 운량 분포가 같아야 합니다.
  const profile = (fan, sunAz) => {
    const cols = columns(fan, sunAz).filter(s => s.layer === 'low');
    const byAz = new Map();
    for (const s of cols) {
      const k = Math.round(s.azimuthDeg);
      byAz.set(k, (byAz.get(k) ?? 0) + s.cover);
    }
    return byAz;
  };
  const pA = profile(aligned, 270);
  const pB = profile(shifted, 258);
  let maxDiff = 0;
  for (const [az, v] of pA) maxDiff = Math.max(maxDiff, Math.abs(v - (pB.get(az) ?? 0)) / 8);
  console.log(`  절대 방위별 운량 최대 차이: ${(maxDiff * 100).toFixed(1)}%p`);
  ok(maxDiff < 0.12, `방위 12° 어긋나도 구조가 제자리 (최대 ${(maxDiff * 100).toFixed(1)}%p)`);

  // 보정을 빼면 어떻게 되는지 — 대조군.
  const naive = grid.points.map(p => ({
    low: p.low, mid: p.mid, high: p.high, distance: p.distance, azimuthOffset: p.azOffset,
  }));
  const pN = profile(naive, 258);
  let naiveDiff = 0;
  for (const [az, v] of pA) naiveDiff = Math.max(naiveDiff, Math.abs(v - (pN.get(az) ?? 0)) / 8);
  console.log(`  (대조군) 보정 없이: 최대 ${(naiveDiff * 100).toFixed(1)}%p`);
  ok(naiveDiff > maxDiff, '보정이 실제로 일을 한다 (대조군보다 오차가 작다)');

  ok(AD.isGridUsable(grid, 258), '방위 12° 차이는 사용 가능');
  ok(!AD.isGridUsable(grid, 210), '방위 60° 차이는 폐기하고 기본 팬으로');
  ok(!AD.isGridUsable(null, 270), 'null 격자는 사용 불가');
}

// ── 4. 관측점 앵커 ─────────────────────────────────────────────────────────
console.log('\n== 관측점 앵커 (머리 위) ==');
{
  // 관측점은 맑고 10km 밖은 흐림. 앵커가 없으면 머리 위가 흐려집니다.
  const grid = makeGrid(270, () => ({ low: 95, mid: 0, high: 0 }));
  const baseline = [{ distance: 0, azimuthOffset: 0, low: 0, mid: 0, high: 0, humidity: 40, directNormalIrradiance: 800 }];

  const withAnchor = AD.cloudGridToFan({ grid, time: T0, sunAzimuthDeg: 270, baseline });
  const withoutAnchor = AD.cloudGridToFan({ grid, time: T0, sunAzimuthDeg: 270 });

  const zenith = fan => {
    // 저층 1.5km 기준 고도각 45° 이상 = 관측점 반경 1.5km 안
    const cols = columns(fan, 270).filter(s => s.layer === 'low' && s.elevationDeg > 45);
    return cols.reduce((a, b) => a + b.cover, 0) / cols.length;
  };
  const zA = zenith(withAnchor), zB = zenith(withoutAnchor);
  console.log(`  머리 위 운량 — 앵커 있음 ${(zA * 100).toFixed(1)}% / 없음 ${(zB * 100).toFixed(1)}%`);
  ok(zA < zB - 0.3, `앵커가 머리 위를 관측점 값으로 되돌림 (${(zB * 100).toFixed(0)}% → ${(zA * 100).toFixed(0)}%)`);

  // 부가 관측값이 살아남아야 preset/DNI 물리가 작동합니다.
  const obs = new S.WeatherFan(withAnchor, 270).observerData();
  ok(obs?.directNormalIrradiance === 800, `DNI 보존 (${obs?.directNormalIrradiance})`);
  ok(obs?.humidity === 40, `습도 보존 (${obs?.humidity})`);
}

// ── 5. 시간축 재보간 ───────────────────────────────────────────────────────
console.log('\n== 시간축 재보간 ==');
{
  const base = Date.UTC(2026, 7, 3, 0, 0, 0);
  const timeMs = Array.from({ length: 24 }, (_, i) => base + i * 3600_000);
  // 0시 0% → 23시 92% 로 선형 증가하는 계열
  const series = () => ({
    timeMs,
    low: timeMs.map((_, i) => (i / 23) * 92),
    mid: timeMs.map(() => 0),
    high: timeMs.map(() => 0),
  });
  const grid = makeGrid(270, () => ({ low: 46, mid: 0, high: 0 }), series);

  for (const [hour, expect] of [[0, 0], [6, 24], [12, 48], [23, 92]]) {
    const pts = G.interpolateCloudGrid(grid, new Date(base + hour * 3600_000));
    const got = pts[0].low;
    ok(Math.abs(got - expect) < 1.5, `${String(hour).padStart(2)}시 → ${got.toFixed(1)}% (기대 ${expect}%)`);
  }
  // 30분은 두 시각 사이 중간값이어야 합니다.
  const half = G.interpolateCloudGrid(grid, new Date(base + 6.5 * 3600_000))[0].low;
  ok(Math.abs(half - 26) < 1.5, `06:30 → ${half.toFixed(1)}% (시간 사이 보간)`);

  // hourly 없는 옛 캐시는 스냅샷 유지
  const stale = makeGrid(270, () => ({ low: 46, mid: 0, high: 0 }));
  ok(G.interpolateCloudGrid(stale, new Date(base))[0].low === 46, 'hourly 없으면 스냅샷 유지 (옛 캐시 호환)');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — pass ${pass} / fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
