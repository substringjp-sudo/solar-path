/**
 * 야간 장노출 구름 방해 예측 + 서브셔터 추천 검증 (2026-11-16).
 *
 * 사용:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/verify-astro-forecast.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) {
    pass++;
    console.log('  PASS: ' + label);
  } else {
    fail++;
    console.log('  FAIL: ' + label);
  }
};

(async () => {
  const AF = await import('file://' + path.join(PREVIEW, 'app/utils/astroForecast.js'));

  console.log('\n[1] 지향 방향 → 천구 적위(Declination) 변환');
  const decNorthPole = AF.horizonToDeclinationDeg(37.56, 0, 37.56);
  const decEquator = AF.horizonToDeclinationDeg(37.56, 180, 90 - 37.56);
  ok(Math.abs(decNorthPole - 90) < 0.05, `서울 북극성 고도(37.56°) 지향 적위 ≈ +90° (${decNorthPole.toFixed(2)}°)`);
  ok(Math.abs(decEquator) < 0.05, `서울 남쪽 천구 적도(el=52.44°) 적위 ≈ 0° (${decEquator.toFixed(2)}°)`);

  console.log('\n[2] 고정 삼각대 서브셔터 상한 (NPF/픽셀 궤적 vs 500 룰)');
  const wideEq = AF.recommendedSubExposureSec({
    focal35mm: 24,
    latitudeDeg: 37.56,
    azDeg: 180,
    elDeg: 52.44,
    maxTrailPx: 1.5,
  });
  const teleEq = AF.recommendedSubExposureSec({
    focal35mm: 50,
    latitudeDeg: 37.56,
    azDeg: 180,
    elDeg: 52.44,
    maxTrailPx: 1.5,
  });
  const polarView = AF.recommendedSubExposureSec({
    focal35mm: 24,
    latitudeDeg: 37.56,
    azDeg: 0,
    elDeg: 40,
    maxTrailPx: 1.5,
    deviceMaxExposureSec: 30,
  });
  ok(
    wideEq.pinpointSec > 4 && wideEq.pinpointSec < wideEq.rule500Sec,
    `24mm 적도 점상 셔터(${wideEq.pinpointSec}s) < 500룰(${wideEq.rule500Sec}s)`,
  );
  ok(
    teleEq.pinpointSec < wideEq.pinpointSec * 0.6,
    `50mm 망원은 24mm 광각보다 셔터 상한이 짧음 (${teleEq.pinpointSec}s vs ${wideEq.pinpointSec}s)`,
  );
  ok(
    polarView.pinpointSec > wideEq.pinpointSec * 3 && polarView.recommendedSec <= 30,
    `북극 근처는 일주운동이 느려 더 긴 서브셔터 허용 + 기기 상한 클램프 (${polarView.pinpointSec}s → ${polarView.recommendedSec}s)`,
  );
  const trail10m = wideEq.trailDegAtExposure(600);
  ok(Math.abs(trail10m - 2.507) < 0.03, `10분(600초) 노출 적도 별 궤적 ≈ 2.51° (${trail10m.toFixed(3)}°)`);

  console.log('\n[3] SkyTimeline 기반 구름 유입 · 별 방해 창 예측');
  const T0 = Date.UTC(2026, 10, 16, 14, 0); // UTC 14:00 (KST 23:00)
  const layout = [];
  for (const layer of ['low', 'mid', 'high']) {
    for (let az = 0; az < 360; az += 30) {
      for (const el of [15, 35, 60]) {
        layout.push({ layer, azimuthDeg: az, elevationDeg: el, distanceKm: 10, confidence: 1 });
      }
    }
  }
  const stepMinutes = 2;
  const frames = [];
  for (let i = 0; i <= 15; i++) {
    const mins = i * stepMinutes;
    const n = layout.length;
    const cover = new Float32Array(n);
    const precipQ = new Uint8Array(n);
    const humidityQ = new Uint8Array(n).fill(50);
    const highPctQ = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const L = layout[k];
      const inNorth = L.azimuthDeg <= 45 || L.azimuthDeg >= 315;
      // 시작 시 맑음 → 6분 후부터 북쪽 하늘에 저층운(80%) 급격히 유입, 남쪽은 계속 맑음
      if (inNorth && L.layer === 'low' && mins >= 6) {
        cover[k] = Math.min(0.85, (mins - 4) * 0.25);
      } else if (L.layer === 'high') {
        cover[k] = 0.08;
        highPctQ[k] = 8;
      }
    }
    frames.push({
      tMs: T0 + mins * 60_000,
      sunAltDeg: -50,
      sunAzDeg: 350,
      moonAltDeg: -30,
      moonAzDeg: 180,
      cover,
      precipQ,
      humidityQ,
      highPctQ,
      beamHigh: 1,
      beamMid: 1,
      beamLow: 1,
      diffHigh: 0,
      diffMid: 0,
      diffLow: 0,
      sunTransmittance: 1,
      diffuseToGround: 0,
      halo: 0,
      obs: undefined,
      atmosphere: { betaMie: 0.08, angstrom: 1.3, elevScale: 1, ozoneDu: 300 },
    });
  }

  const timeline = {
    dateKey: '2026-11-16',
    latitude: 37.56,
    longitude: 126.98,
    stepMinutes,
    startMs: T0,
    endMs: T0 + 30 * 60_000,
    layout,
    frames,
    dayMeanCover: { low: 0.1, mid: 0, high: 0.08 },
    builtAtMs: T0,
  };

  const layerWinds = {
    low: { speedKmh: 25, bearingDeg: 270 },
    mid: { speedKmh: 40, bearingDeg: 270 },
    high: { speedKmh: 75, bearingDeg: 270 },
  };

  const north10m = AF.analyzeAstroWindow({
    timeline,
    view: { azDeg: 0, elDeg: 35, hfovDeg: 65, vfovDeg: 50 },
    startMs: T0,
    exposureSec: 600,
    lookaheadMin: 30,
    blockThresholdPct: 25,
    layerWinds,
  });
  const south10m = AF.analyzeAstroWindow({
    timeline,
    view: { azDeg: 180, elDeg: 35, hfovDeg: 65, vfovDeg: 50 },
    startMs: T0,
    exposureSec: 600,
    lookaheadMin: 30,
    blockThresholdPct: 25,
    layerWinds,
  });

  ok(
    north10m.hasData &&
      north10m.firstInterferenceMin !== null &&
      north10m.firstInterferenceMin >= 4 &&
      north10m.firstInterferenceMin <= 7,
    `북쪽 10분 노출 중 4~7분대 구름 유입 시점 포착 (${north10m.firstInterferenceMin}분 후 방해)`,
  );
  ok(
    north10m.worstLayer === 'low' && north10m.interferenceRisk === 'high',
    `저층운 유입 시 worstLayer=${north10m.worstLayer}, risk=${north10m.interferenceRisk}`,
  );
  ok(
    south10m.firstInterferenceMin === null &&
      south10m.interferenceRisk === 'low' &&
      south10m.exposurePeakBlockPct < 10,
    `같은 시각 남쪽 방향은 맑은 창 유지 (${south10m.exposurePeakBlockPct}% peak, risk=${south10m.interferenceRisk})`,
  );
  ok(
    north10m.cloudSweepDegDuringExposure !== null && north10m.cloudSweepDegDuringExposure > 30,
    `저층운 25km/h 10분 이동 시야 스침 각도 계산 (${north10m.cloudSweepDegDuringExposure}°)`,
  );

  // 상층 권운 vs 하층운 차폐 가중 비교 (같은 80%라도 하층운이 별을 훨씬 강하게 가림)
  const makeUniformTl = (layerName, pct) => ({
    ...timeline,
    frames: timeline.frames.slice(0, 3).map((fr, idx) => {
      const c = new Float32Array(layout.length);
      for (let k = 0; k < layout.length; k++) if (layout[k].layer === layerName) c[k] = pct;
      return { ...fr, tMs: T0 + idx * stepMinutes * 60_000, cover: c };
    }),
  });
  const low80 = AF.analyzeAstroWindow({
    timeline: makeUniformTl('low', 0.8),
    view: { azDeg: 90, elDeg: 40, hfovDeg: 60, vfovDeg: 45 },
    startMs: T0,
    exposureSec: 240,
    lookaheadMin: 4,
  });
  const high80 = AF.analyzeAstroWindow({
    timeline: makeUniformTl('high', 0.8),
    view: { azDeg: 90, elDeg: 40, hfovDeg: 60, vfovDeg: 45 },
    startMs: T0,
    exposureSec: 240,
    lookaheadMin: 4,
  });
  ok(
    low80.exposureMeanBlockPct > high80.exposureMeanBlockPct + 35,
    `같은 80% 운량이어도 저층운(${low80.exposureMeanBlockPct}%) > 상층 권운(${high80.exposureMeanBlockPct}%)`,
  );

  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
})();
