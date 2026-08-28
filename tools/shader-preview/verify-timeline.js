/**
 * 사전 계산 타임라인 검증.
 *
 * 핵심 질문은 하나입니다 — **미리 계산해 두고 보간한 결과가, 그 자리에서
 * 직접 푼 결과와 같은가.** 다르면 "빠르지만 다른 하늘"이 되어 버립니다.
 */
global.__DEV__ = false;
const TLB = '/tmp/tlbuild';
const S = require(TLB + '/skyColumn.js');
const W = require(TLB + '/weather.js');
const A = require(TLB + '/atmosphere.js');
const P = require(TLB + '/cloudPresets.js');
const T = require(TLB + '/skyTimeline.js');
const SunCalc = require('suncalc');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

// ── 링을 흉내낸 하루치 예보 (네트워크 없이) ────────────────────────────────
const RING_AZ = [0, 30, 60, 90, 120, 150, 180, -150, -120, -90, -60, -30];
const RING_D = [10, 30, 70, 130, 200, 280, 380];
const LAT = 37.5, LON = 127.0;
const base = new Date(2026, 7, 3, 0, 0, 0).getTime();
const tm = Array.from({ length: 25 }, (_, i) => base + i * 3600000);

// 시간에 따라 확실히 변하는 계열이어야 보간 검증이 의미가 있습니다.
const ser = seed => ({
  time: tm.map(t => new Date(t).toISOString()),
  timeMs: tm,
  low: tm.map((_, i) => 20 + 60 * Math.abs(Math.sin((i + seed) / 3.7))),
  mid: tm.map((_, i) => 15 + 50 * Math.abs(Math.cos((i + seed) / 4.3))),
  high: tm.map((_, i) => 30 + 45 * Math.abs(Math.sin((i + seed) / 5.1))),
});
const ring = [{
  distance: 0, azimuthOffset: 0, source: 'standard',
  hourly: {
    ...ser(0),
    visibility: tm.map(() => 25000),
    humidity: tm.map(() => 62),
    precipitation: tm.map(() => 0),
    directNormalIrradiance: tm.map(() => 500),
  },
}];
RING_AZ.forEach((az, ai) => {
  for (const d of RING_D) {
    ring.push({ distance: d, azimuthOffset: az, source: 'standard', hourly: ser(ai * 0.7 + d / 200) });
  }
});
for (const p of ring.filter(p => p.azimuthOffset === 180)) ring.push({ ...p, azimuthOffset: -180 });

/** 타임라인 없이 그 자리에서 직접 푸는 경로 (기존 동작) */
function solveDirect(tMs, driftMinutes) {
  const t = new Date(tMs);
  const w = W.getInterpolatedWeather(ring, t);
  const obs = w.find(x => (x.distance ?? 0) === 0) ?? w[0];
  const sp = SunCalc.getPosition(t, LAT, LON);
  const sunAlt = (sp.altitude * 180) / Math.PI;
  const sunAz = (sp.azimuth * 180) / Math.PI + 180;
  const samples = S.buildSkyColumns({
    fan: new S.WeatherFan(w, 0), driftMinutes, windSpeedKmh: 22, windBearingDeg: 260,
    // ⚠ 타임라인과 **같은 방식**으로 바람을 풀어야 합니다. 여기만 스칼라
    // 대용값으로 두면 층별 이류가 갈라져(대용값은 층마다 속도가 다릅니다)
    // 키프레임에서조차 운량이 안 맞고, 그게 "보간이 틀렸다"로 보고됩니다 —
    // 실제로 한 번 그렇게 걸렸습니다. 이 합성 링에는 바람 성분이 없으므로
    // 양쪽 다 PLACEHOLDER_LAYER_WINDS 로 내려앉는 것이 정답입니다.
    layerWinds: S.resolveLayerWinds(obs).winds,
  });
  const optics = S.solveColumnOptics(samples, sunAz, sunAlt, L => P.representativeTauForObserver(L, obs));
  return { samples, optics, sunAlt, sunAz };
}

// buildSkyTimeline은 네트워크를 타므로, fetch를 링으로 대체합니다.
W.fetchDayWeatherRing = async () => ring;

(async () => {
  const STEP = 5;
  const tl = await T.buildSkyTimeline({
    latitude: LAT, longitude: LON, date: new Date(base + 12 * 3600000),
    observerElevM: 0, stepMinutes: STEP,
  });

  console.log('== 타임라인 구조 ==');
  ok(tl.frames.length === 289, `키프레임 ${tl.frames.length}개 (24h / 5분 + 1)`);
  ok(tl.layout.length === 576, `방향 격자 ${tl.layout.length}개 (3층 × 24방위 × 8고도)`);
  ok(tl.frames.every(f => f.cover.length === 576), '모든 키프레임의 운량 길이가 격자와 일치');
  ok(tl.stepMinutes === STEP, `간격 ${tl.stepMinutes}분`);
  const bytes = tl.frames.length * 576 * 4;
  console.log(`  메모리 ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  ok(bytes < 4 * 1024 * 1024, '메모리 4MB 미만');

  console.log('\n== 키프레임에서는 직접 계산과 정확히 일치해야 함 ==');
  // 키프레임 시각을 그대로 읽으면 보간이 없으므로 완전히 같아야 합니다.
  for (const idx of [0, 60, 144, 200, 288]) {
    const f = tl.frames[idx];
    const direct = solveDirect(f.tMs, idx * STEP);
    const s = T.sampleTimeline(tl, f.tMs);
    let maxCoverErr = 0;
    for (let k = 0; k < 576; k++) {
      maxCoverErr = Math.max(maxCoverErr, Math.abs(s.samples[k].cover - direct.samples[k].cover));
    }
    const dAlt = Math.abs(s.sunAltDeg - direct.sunAlt);
    const dBeam = Math.abs(s.optics.beamFactor.low - direct.optics.beamFactor.low);
    ok(maxCoverErr < 1e-6, `#${idx} 운량 일치 (최대 오차 ${maxCoverErr.toExponential(1)})`);
    ok(dAlt < 1e-9, `#${idx} 태양 고도 일치`);
    ok(dBeam < 1e-9, `#${idx} 층별 직달 배율 일치 (오차 ${dBeam.toExponential(1)})`);
  }

  console.log('\n== 키프레임 사이 보간 ==');
  // 두 키프레임 중간을 읽으면 양쪽 값 사이에 있어야 합니다 (오버슈트 없음).
  let between = 0, overshoot = 0;
  for (let idx = 0; idx < 288; idx += 17) {
    const a = tl.frames[idx], b = tl.frames[idx + 1];
    const mid = T.sampleTimeline(tl, (a.tMs + b.tMs) / 2);
    for (let k = 0; k < 576; k++) {
      const lo = Math.min(a.cover[k], b.cover[k]);
      const hi = Math.max(a.cover[k], b.cover[k]);
      const v = mid.samples[k].cover;
      if (v >= lo - 1e-9 && v <= hi + 1e-9) between++; else overshoot++;
    }
  }
  ok(overshoot === 0, `보간값이 항상 양 끝 사이 (검사 ${between + overshoot}개, 이탈 ${overshoot}개)`);

  console.log('\n== 보간 오차 (직접 계산 대비) ==');
  // 중간 시각의 보간값이 그 시각을 직접 푼 값과 얼마나 다른가.
  // 완전히 같을 수는 없습니다 — 노이즈 이류가 비선형이기 때문입니다.
  // 눈에 띄지 않을 정도(수 %p)인지만 봅니다.
  let sumErr = 0, maxErr = 0, n = 0;
  const 층합 = { low: 0, mid: 0, high: 0 };
  const 층수 = { low: 0, mid: 0, high: 0 };
  let skyMeanErr = 0, clearErr = 0, frames = 0;
  for (let idx = 10; idx < 280; idx += 23) {
    const a = tl.frames[idx], b = tl.frames[idx + 1];
    const midMs = (a.tMs + b.tMs) / 2;
    const interp = T.sampleTimeline(tl, midMs);
    const direct = solveDirect(midMs, idx * STEP + STEP / 2);
    let mi = 0, md = 0, ci = 0, cd = 0;
    for (let k = 0; k < 576; k++) {
      const vi = interp.samples[k].cover, vd = direct.samples[k].cover;
      sumErr += Math.abs(vi - vd); maxErr = Math.max(maxErr, Math.abs(vi - vd)); n++;
      // 층별로도 쌓습니다 — 층마다 바람이 다르므로 "어느 층에서 왔는가"가
      // 곧 원인 진단입니다. 뭉친 평균 하나로는 못 가립니다.
      const LK = tl.layout[k].layer;
      층합[LK] += Math.abs(vi - vd); 층수[LK]++;
      mi += vi; md += vd;
      if (vi < 0.10) ci++;
      if (vd < 0.10) cd++;
    }
    skyMeanErr += Math.abs(mi - md) / 576;
    clearErr += Math.abs(ci - cd) / 576;
    frames++;
  }
  skyMeanErr /= frames;
  clearErr /= frames;
  const meanErr = sumErr / n;
  console.log(`  방향별 평균 ${(meanErr * 100).toFixed(2)}%p, 최대 ${(maxErr * 100).toFixed(2)}%p`);
  const 층오차 = {};
  for (const L of ['low', 'mid', 'high']) 층오차[L] = 층합[L] / Math.max(1, 층수[L]);
  console.log(`  층별 평균  low ${(층오차.low * 100).toFixed(2)}%p  ` +
    `mid ${(층오차.mid * 100).toFixed(2)}%p  high ${(층오차.high * 100).toFixed(2)}%p`);
  console.log(`  하늘 평균 차이 ${(skyMeanErr * 100).toFixed(3)}%p, 맑음비율 차이 ${(clearErr * 100).toFixed(2)}%p`);

  // **방향별 일치는 여기서 옳은 지표가 아닙니다.**
  //
  // 운량장이 U자가 된 뒤로 한 방향이 두 키프레임 사이에 0 ↔ 1을 오갑니다.
  // 보간은 그 사이를 지나가고 직접 계산은 뛰므로 방향별 차이가 커집니다
  // (평균 4.9%p, 최대 56%p). 둘 다 틀린 게 아니라 **서로 다른 그럴듯한
  // 하늘**입니다 — 예전엔 모든 방향이 0.5 근처에 뭉쳐 있어서 이 차이가
  // 드러나지 않았을 뿐입니다.
  //
  // 실제로 지켜야 하는 것은 (a) 예보값인 하늘 평균과 (b) 분포 모양입니다.
  // 그 둘을 재고, 방향별로는 "완전히 딴 하늘은 아니다" 수준만 봅니다.
  ok(skyMeanErr < 0.01,
    `하늘 평균이 보존됨 — 1%p 미만 (${(skyMeanErr * 100).toFixed(3)}%p)`);
  ok(clearErr < 0.10,
    `분포 모양이 보존됨 — 맑은 방향 비율 차이 10%p 미만 (${(clearErr * 100).toFixed(2)}%p)`);
  // 방향별 오차는 **층별로** 봅니다. 뭉친 평균 하나는 층별 바람이 들어온
  // 뒤로 의미를 잃었습니다 — 어느 층이 움직여 올라간 건지 안 보입니다.
  //
  // 측정된 기준선 (5분 간격, 대용 바람 22 / 37 / 75 km/h):
  //
  //   층    셀 크기   키프레임 사이 이동   방향별 오차
  //   low    2.0km      1.8km (0.92셀)      15.9%p
  //   mid    4.2km      3.1km (0.74셀)      12.2%p
  //   high   9.0km      6.2km (0.69셀)       9.1%p
  //
  // 셀 대비 이동거리에 거의 비례합니다. **low 가 가장 큽니다** — 상층이
  // 세 배 빠른데도 셀이 4.5배 커서 상대 이동은 오히려 작습니다. 층별 바람을
  // 넣기 전 mid/high 는 7.9 / 2.2%p 였고, 늘어난 몫은 정확히 속도비
  // (×1.7, ×3.4)만큼입니다 — 새 결함이 아니라 더 빨라진 이류의 대가입니다.
  //
  // 정말 지켜야 하는 것은 위 두 단언(하늘 평균 · 분포 모양)이고 둘 다
  // 예산의 1/4 안입니다. 여기서는 "어느 층도 딴 하늘로 튀지 않는다" 수준의
  // 상한만 둡니다. 바람이 안 바뀌었는데 어느 층이 올라가면 그건 진짜입니다.
  for (const L of ['low', 'mid', 'high']) {
    ok(층오차[L] < 0.20,
      `${L} 층이 딴 하늘로 튀지 않음 — 20%p 미만 (${(층오차[L] * 100).toFixed(2)}%p)`);
  }

  console.log('\n== 하루 전체 연속성 (튐 없음) ==');
  // 1분 간격으로 훑어 인접 시각 사이에 큰 점프가 없어야 합니다.
  let maxJump = 0, jumpAt = 0;
  let prev = null;
  for (let m = 0; m <= 1440; m += 1) {
    const s = T.sampleTimeline(tl, base + m * 60000);
    let mean = 0;
    for (let k = 0; k < 576; k++) mean += s.samples[k].cover;
    mean /= 576;
    if (prev !== null && Math.abs(mean - prev) > maxJump) {
      maxJump = Math.abs(mean - prev); jumpAt = m;
    }
    prev = mean;
  }
  console.log(`  1분 간격 최대 변화 ${(maxJump * 100).toFixed(3)}%p (${Math.floor(jumpAt / 60)}시 ${jumpAt % 60}분)`);
  ok(maxJump < 0.01, `분당 변화 1%p 미만 — 스크럽 시 튀지 않음`);

  console.log('\n== 태양 방위 이음매 (0/360) ==');
  // 방위는 359° → 1° 로 넘어갈 때 최단호로 가야 합니다.
  let azJump = 0;
  prev = null;
  for (let m = 0; m <= 1440; m += 1) {
    const s = T.sampleTimeline(tl, base + m * 60000);
    if (prev !== null) {
      const d = Math.abs(((s.sunAzDeg - prev + 540) % 360) - 180);
      azJump = Math.max(azJump, d);
    }
    prev = s.sunAzDeg;
  }
  ok(azJump < 2, `분당 방위 변화 ${azJump.toFixed(3)}° — 이음매에서 뒤집히지 않음`);

  console.log('\n== 범위 밖 시각 ==');
  const before = T.sampleTimeline(tl, base - 3600000);
  const after = T.sampleTimeline(tl, base + 30 * 3600000);
  ok(before !== null && after !== null, '범위 밖도 null이 아니라 양 끝으로 클램프');
  ok(Math.abs(before.sunAltDeg - tl.frames[0].sunAltDeg) < 1e-9, '시작 이전은 첫 키프레임');
  ok(Math.abs(after.sunAltDeg - tl.frames[tl.frames.length - 1].sunAltDeg) < 1e-9, '끝 이후는 마지막 키프레임');

  console.log('\n== 재사용 판정 ==');
  const d0 = new Date(base + 12 * 3600000);
  ok(T.isTimelineUsable(tl, LAT, LON, d0), '같은 날 같은 장소 → 재사용');
  ok(!T.isTimelineUsable(tl, LAT, LON, new Date(base + 36 * 3600000)), '다음 날 → 폐기');
  ok(!T.isTimelineUsable(tl, LAT + 1.0, LON, d0), '110km 떨어진 곳 → 폐기');
  ok(T.isTimelineUsable(tl, LAT + 0.05, LON, d0), '5km 이동 → 재사용');
  ok(!T.isTimelineUsable(null, LAT, LON, d0), 'null → 사용 불가');

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — pass ${pass} / fail ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
