/**
 * 야간 다중 프레임 지구 자전 역투영 · 별 미세 정합 · 구름 프레임 탈락 검증 (2026-11-16).
 *
 * 사용:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/verify-astro-stack.js
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

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function renderSyntheticSkyLuma(opts) {
  const { width, height, stars, bgBase, bgSlope, horizonY, noiseSigma, rng } = opts;
  const img = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = bgBase + bgSlope * (y / height);
      if (horizonY != null && y >= horizonY) {
        // 지평선 아래 건물 창문 가짜 점광원 (별 검출이 지평선 마스크로 걸러내는지 검증)
        if ((x === 60 && y === horizonY + 15) || (x === 150 && y === horizonY + 20)) v = 220;
        else v = 12;
      } else {
        for (const s of stars) {
          const dx = x - s.x;
          const dy = y - s.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 25) v += s.amp * Math.exp(-d2 / (2 * 0.85 * 0.85));
        }
      }
      // 근사 가우시안 노이즈 (Box-Muller 1회)
      const u1 = Math.max(1e-6, rng());
      const u2 = rng();
      const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      img[y * width + x] = Math.max(0, v + noiseSigma * g);
    }
  }
  return img;
}

(async () => {
  const ST = await import('file://' + path.join(PREVIEW, 'app/utils/astroStackMath.js'));
  const AR = await import('file://' + path.join(PREVIEW, 'app/utils/arVision.js'));
  const CC = await import('file://' + path.join(PREVIEW, 'app/utils/celestialCoords.js'));

  const lat = 37.5665;
  const lon = 126.978;
  const t0 = new Date(Date.UTC(2026, 10, 16, 14, 0, 0));
  const t10m = new Date(t0.getTime() + 600_000);
  const t60m = new Date(t0.getTime() + 3600_000);

  const att0 = { yawDeg: 215, pitchDeg: 35, rollDeg: 4.5 };
  const intrinsics = AR.intrinsicsFromHfov(1920, 1440, 66);

  console.log('\n[1] 3D 추적 자세(computeTrackedAttitudeAt) 불변성 — +10분 · +60분');
  const eqStars = [
    { raHours: 0.8, decDeg: 18 },
    { raHours: 1.5, decDeg: 25 },
    { raHours: 23.8, decDeg: 10 },
    { raHours: 1.1, decDeg: 40 },
    { raHours: 2.2, decDeg: -5 },
  ];

  const eqToPixel = (eq, date, att) => {
    const raRad = (eq.raHours / 24) * Math.PI * 2;
    const decRad = (eq.decDeg * Math.PI) / 180;
    const eqVec = [
      Math.cos(decRad) * Math.cos(raRad),
      Math.cos(decRad) * Math.sin(raRad),
      Math.sin(decRad),
    ];
    const enuMat = ST.equToEnuMatrix(date, lat, lon);
    const enu = ST.mat3MulVec(enuMat, eqVec);
    return AR.project(enu, att, intrinsics);
  };

  // equToEnuMatrix 가 celestialCoords.equatorialToHorizontal (0.01° 반올림) 과 일치하는지도 교차 검증
  let maxCrossDeg = 0;
  for (const s of eqStars) {
    const hz = CC.equatorialToHorizontal(s, lat, lon, t0);
    const raRad = (s.raHours / 24) * Math.PI * 2;
    const decRad = (s.decDeg * Math.PI) / 180;
    const enu = ST.mat3MulVec(ST.equToEnuMatrix(t0, lat, lon), [
      Math.cos(decRad) * Math.cos(raRad),
      Math.cos(decRad) * Math.sin(raRad),
      Math.sin(decRad),
    ]);
    const azMat = ((Math.atan2(enu[0], enu[1]) * 180) / Math.PI + 360) % 360;
    const elMat = (Math.asin(Math.max(-1, Math.min(1, enu[2]))) * 180) / Math.PI;
    const dAz = Math.abs((((azMat - hz.azimuthDeg + 540) % 360) - 180));
    const dEl = Math.abs(elMat - hz.altitudeDeg);
    maxCrossDeg = Math.max(maxCrossDeg, dAz, dEl);
  }
  ok(maxCrossDeg <= 0.011, `equToEnuMatrix ↔ celestialCoords 교차 오차 <= 0.01° (${maxCrossDeg.toFixed(5)}°)`);

  // 시야 안에 있는 별 고르기 (동/남서 방향)
  const visibleStars = [];
  for (let ra = 0; ra < 24; ra += 0.25) {
    for (let dec = -30; dec <= 75; dec += 5) {
      const p0 = eqToPixel({ raHours: ra, decDeg: dec }, t0, att0);
      if (p0 && p0.x > 100 && p0.x < 1820 && p0.y > 100 && p0.y < 1340) {
        visibleStars.push({ raHours: ra, decDeg: dec, p0 });
      }
      if (visibleStars.length >= 16) break;
    }
    if (visibleStars.length >= 16) break;
  }

  let fixedDriftPx10m = 0;
  let trackedErrPx10m = 0;
  let trackedErrPx60m = 0;
  const att10m = ST.computeTrackedAttitudeAt(att0, t0, t10m, lat, lon);
  const att60m = ST.computeTrackedAttitudeAt(att0, t0, t60m, lat, lon);

  for (const s of visibleStars) {
    const pFixed10m = eqToPixel(s, t10m, att0);
    const pTrack10m = eqToPixel(s, t10m, att10m);
    const pTrack60m = eqToPixel(s, t60m, att60m);
    if (pFixed10m) fixedDriftPx10m = Math.max(fixedDriftPx10m, Math.hypot(pFixed10m.x - s.p0.x, pFixed10m.y - s.p0.y));
    if (pTrack10m) trackedErrPx10m = Math.max(trackedErrPx10m, Math.hypot(pTrack10m.x - s.p0.x, pTrack10m.y - s.p0.y));
    if (pTrack60m) trackedErrPx60m = Math.max(trackedErrPx60m, Math.hypot(pTrack60m.x - s.p0.x, pTrack60m.y - s.p0.y));
  }

  ok(fixedDriftPx10m > 40, `고정 삼각대 10분 노출 시 별이 크게 흐름 (최대 ${fixedDriftPx10m.toFixed(1)}px)`);
  ok(trackedErrPx10m < 1e-4, `적도의 추적 10분 시 모든 별이 원래 픽셀 유지 (${trackedErrPx10m.toExponential(2)}px)`);
  ok(trackedErrPx60m < 1e-4, `적도의 추적 60분 시에도 모든 별이 원래 픽셀 유지 (${trackedErrPx60m.toExponential(2)}px)`);

  console.log('\n[2] 천구 3×3 역투영 호모그래피(computeCelestialHomographyPx) 정확도');
  const attKDrifted = { yawDeg: att0.yawDeg + 0.4, pitchDeg: att0.pitchDeg - 0.3, rollDeg: att0.rollDeg + 0.7 };
  const h0ToK = ST.computeCelestialHomographyPx({
    t0,
    tk: t10m,
    latitudeDeg: lat,
    longitudeDeg: lon,
    attitude0: att0,
    attitudeK: attKDrifted,
    intrinsics0: intrinsics,
  });
  const hInv = ST.mat3Inv(h0ToK);
  const hUv = ST.homographyPxToUv(h0ToK, intrinsics.width, intrinsics.height);

  let maxFwdErr = 0;
  let maxInvErr = 0;
  let maxUvErr = 0;
  for (const s of visibleStars) {
    const pkTrue = eqToPixel(s, t10m, attKDrifted);
    const pkPred = ST.applyHomography2D(h0ToK, s.p0.x, s.p0.y);
    const p0Rec = pkTrue ? ST.applyHomography2D(hInv, pkTrue.x, pkTrue.y) : null;
    const uvPred = ST.applyHomography2D(hUv, s.p0.x / intrinsics.width, s.p0.y / intrinsics.height);
    if (pkTrue && pkPred && p0Rec && uvPred) {
      maxFwdErr = Math.max(maxFwdErr, Math.hypot(pkPred.x - pkTrue.x, pkPred.y - pkTrue.y));
      maxInvErr = Math.max(maxInvErr, Math.hypot(p0Rec.x - s.p0.x, p0Rec.y - s.p0.y));
      maxUvErr = Math.max(maxUvErr, Math.hypot(uvPred.x * intrinsics.width - pkTrue.x, uvPred.y * intrinsics.height - pkTrue.y));
    }
  }
  ok(maxFwdErr < 1e-4, `호모그래피 정투영 오차 < 0.0001px (${maxFwdErr.toExponential(2)}px)`);
  ok(maxInvErr < 1e-4, `호모그래피 역투영 복원 오차 < 0.0001px (${maxInvErr.toExponential(2)}px)`);
  ok(maxUvErr < 1e-4, `정규화 UV 호모그래피 해상도 독립성 일치 (${maxUvErr.toExponential(2)}px)`);

  console.log('\n[3] 별 검출 · 지평선 마스크 · 미세 정합 · 구름 프레임 탈락 · 누적 SNR 향상');
  const tw = 240;
  const th = 180;
  const horizonY = 138;
  const skyMask = new Float32Array(tw).fill(horizonY - 4);
  const thumbIntr = AR.intrinsicsFromHfov(tw, th, 66);

  const rng = mulberry32(42);
  const refCatalog = [];
  for (let i = 0; i < 18; i++) {
    refCatalog.push({
      x: 20 + rng() * (tw - 40),
      y: 16 + rng() * (horizonY - 30),
      amp: 55 + rng() * 110,
    });
  }

  const refLuma = renderSyntheticSkyLuma({
    width: tw,
    height: th,
    stars: refCatalog,
    bgBase: 22,
    bgSlope: 18,
    horizonY,
    noiseSigma: 2.2,
    rng,
  });
  const refStars = ST.detectStarPeaks({ luma: refLuma, width: tw, height: th, skyLimitY: skyMask, maxStars: 30 });
  const refMed = ST.medianSkyBrightness(refLuma, tw, th, skyMask);

  const pickedGroundStar = refStars.some((p) => p.y >= horizonY - 4);
  ok(!pickedGroundStar, `지평선 마스크가 땅 위 밝은 건물 불빛을 별 후보에서 배제 (${refStars.length}개 별 검출)`);
  ok(refStars.length >= 14, `노이즈+은하수 기울기 속에서 기준 별 14개 이상 검출 (${refStars.length}개)`);

  // 프레임 k: 지구 자전(천구) + 나침반/자이로 잔차 오차(dx=+4.2px, dy=-3.1px, rot=+1.15°)
  const priorPx = ST.computeCelestialHomographyPx({
    t0,
    tk: t10m,
    latitudeDeg: lat,
    longitudeDeg: lon,
    attitude0: { yawDeg: 215, pitchDeg: 35, rollDeg: 0 },
    intrinsics0: thumbIntr,
  });
  const rotInjected = (1.15 * Math.PI) / 180;
  const cx = tw / 2;
  const cy = th / 2;
  const injectDx = 4.2;
  const injectDy = -3.1;

  const frameKStarsTrue = [];
  for (const r of refCatalog) {
    // r -> prior -> small injected error
    const pk = ST.applyHomography2D(priorPx, r.x, r.y);
    if (!pk) continue;
    const rx = pk.x - cx;
    const ry = pk.y - cy;
    const fx = cx + Math.cos(rotInjected) * rx - Math.sin(rotInjected) * ry + injectDx;
    const fy = cy + Math.sin(rotInjected) * rx + Math.cos(rotInjected) * ry + injectDy;
    frameKStarsTrue.push({ x: fx, y: fy, amp: r.amp });
  }

  const kLuma = renderSyntheticSkyLuma({
    width: tw,
    height: th,
    stars: frameKStarsTrue,
    bgBase: 22,
    bgSlope: 18,
    horizonY,
    noiseSigma: 2.2,
    rng,
  });
  const kStars = ST.detectStarPeaks({ luma: kLuma, width: tw, height: th, skyLimitY: skyMask, maxStars: 30 });
  const kMed = ST.medianSkyBrightness(kLuma, tw, th, skyMask);

  const aligned = ST.estimateResidualAlignment({
    priorPx0ToK: priorPx,
    refStars,
    frameStars: kStars,
    width: tw,
    height: th,
    searchRadiusPx: 14,
  });

  // 실제 정답 매핑(H_true = Error * prior) 대비 복원 오차 확인
  const alignInv = ST.mat3Inv(aligned.homographyPx0ToK);
  let recoveredTrueErr = 0;
  let countRec = 0;
  for (let i = 0; i < refCatalog.length; i++) {
    const r = refCatalog[i];
    const fk = frameKStarsTrue[i];
    if (!fk) continue;
    const back = ST.applyHomography2D(alignInv, fk.x, fk.y);
    if (back) {
      recoveredTrueErr += Math.hypot(back.x - r.x, back.y - r.y);
      countRec++;
    }
  }
  const avgRecoveredErr = recoveredTrueErr / Math.max(1, countRec);
  ok(
    avgRecoveredErr < 0.35 && Math.abs(aligned.residualRotDeg - 1.15) < 0.25,
    `주입된 자전+센서 오차(4.2px,-3.1px,+1.15°)를 0.35px 이하로 역정합 (평균 ${avgRecoveredErr.toFixed(3)}px, 회전 추정 ${aligned.residualRotDeg}°)` ,
  );

  const qClear = ST.evaluateFrameQuality({
    refStars,
    refSkyMedian: refMed,
    frameStars: kStars,
    frameSkyMedian: kMed,
    alignment: aligned,
  });
  ok(qClear.accepted && qClear.weight >= 0.7, `맑은 프레임 채택 (accepted=${qClear.accepted}, weight=${qClear.weight})`);

  // 구름 통과 프레임 시뮬레이션 (별이 85% 사라지고 배경이 도시광 반사로 상승)
  const cloudyLuma = renderSyntheticSkyLuma({
    width: tw,
    height: th,
    stars: frameKStarsTrue.slice(0, 2).map((s) => ({ ...s, amp: s.amp * 0.4 })),
    bgBase: 58,
    bgSlope: 25,
    horizonY,
    noiseSigma: 3.5,
    rng,
  });
  const cloudyStars = ST.detectStarPeaks({ luma: cloudyLuma, width: tw, height: th, skyLimitY: skyMask, maxStars: 30 });
  const cloudyMed = ST.medianSkyBrightness(cloudyLuma, tw, th, skyMask);
  const cloudyAlign = ST.estimateResidualAlignment({
    priorPx0ToK: priorPx,
    refStars,
    frameStars: cloudyStars,
    width: tw,
    height: th,
    searchRadiusPx: 14,
  });
  const qCloudy = ST.evaluateFrameQuality({
    refStars,
    refSkyMedian: refMed,
    frameStars: cloudyStars,
    frameSkyMedian: cloudyMed,
    alignment: cloudyAlign,
  });
  ok(!qCloudy.accepted && qCloudy.weight === 0 && qCloudy.reason === 'cloud_blocked',
    `구름 통과 프레임 자동 탈락 (${qCloudy.reason}, weight=${qCloudy.weight})`,
  );

  // 16프레임 선형 누적 시 배경 노이즈 σ가 √16 ≈ 4배 가까이 감소하는지 확인
  const singleNoiseSamples = [];
  const stackAcc = new Float32Array(tw * th);
  const stackFrames = 16;
  for (let f = 0; f < stackFrames; f++) {
    const sub = renderSyntheticSkyLuma({
      width: tw,
      height: th,
      stars: [{ x: 120, y: 60, amp: 8.5 }], // 단일 프레임에서는 노이즈(σ=3.5)에 파묻히는 희미한 별
      bgBase: 25,
      bgSlope: 0,
      horizonY: null,
      noiseSigma: 3.5,
      rng,
    });
    if (f === 0) {
      for (let x = 20; x < 100; x++) singleNoiseSamples.push(sub[40 * tw + x]);
    }
    for (let i = 0; i < sub.length; i++) stackAcc[i] += sub[i] / stackFrames;
  }
  const stdOf = (arr) => {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
  };
  const stackNoiseSamples = [];
  for (let x = 20; x < 100; x++) stackNoiseSamples.push(stackAcc[40 * tw + x]);
  const sigmaSingle = stdOf(singleNoiseSamples);
  const sigmaStack = stdOf(stackNoiseSamples);
  const snrGain = sigmaSingle / Math.max(1e-6, sigmaStack);
  const faintStarPeakStacked = stackAcc[60 * tw + 120] - 25;
  ok(
    snrGain > 3.0 && faintStarPeakStacked > 5 * sigmaStack,
    `16장 누적 시 노이즈 σ ${sigmaSingle.toFixed(2)} → ${sigmaStack.toFixed(2)} (${snrGain.toFixed(1)}× 개선, 희미한 별 SNR ${(faintStarPeakStacked / sigmaStack).toFixed(1)}σ)`,
  );

  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
})();
