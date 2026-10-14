/**
 * **하늘 → 상공 → 지도 → 구 줌이 끊기지 않는가** 판정. 브라우저가 필요 없습니다.
 *
 * 무엇을 왜 하는지는 `src/utils/zoomContinuum.ts` 머리말에 있습니다.
 *
 * 1. 넘기는 점에서 3D 내려다본 땅 폭 = 지도 폭(예전: 지도가 2.6 배 확대된 채 시작).
 * 2. 고도·지도 폭이 진행도에 대해 연속·단조, 로그 속도도 넘기는 점에서 이어짐.
 * 3. 진행도 끝에서 지도 폭 180°, 구 반지름이 화면에 맞는 크기 근처.
 * 4. 화면 위쪽 벡터가 시선과 수직이고 프레임 사이에 튀지 않음(예전: −85° 에서 방위각만큼 회전).
 * 5. 지도 폭 ↔ 진행도 역함수, 관측점 귀환이 넘기는 점에서 정확히 관측점.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-zoom-continuum.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const Z = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'zoomContinuum.js'));
  const M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'mapProjection.js'));
  const CASES = [
    { name: '서울 세로폰', lat: 37.5, aspect: 390 / 844 },
    { name: '적도 세로폰', lat: 0, aspect: 390 / 844 },
    { name: '오슬로 태블릿 가로', lat: 59.9, aspect: 1194 / 834 },
    { name: '남반구 -34° 세로', lat: -34, aspect: 0.5 },
  ];

  console.log('\n[1] 넘기는 점에서 3D 땅 폭 = 지도 폭');
  for (const c of CASES) {
    const pose = Z.cameraPoseForProgress(Z.P_HANDOFF, 13, 200, c.lat, c.aspect);
    const w3d = Z.footprintWidthKm(pose.altitudeM, pose.fovDeg, c.aspect);
    const wMap = Z.lonDeltaForProgress(Z.P_HANDOFF, c.lat, c.aspect) * 111.32 * Math.cos(c.lat * Math.PI / 180);
    ok(Math.abs(w3d / wMap - 1) < 1e-6 && Math.abs(pose.elevDeg + 90) < 1e-9 && Math.abs(pose.fovDeg - 90) < 1e-9,
      `${c.name}: 3D ${w3d.toFixed(2)} km · 지도 ${wMap.toFixed(2)} km · 시선 ${pose.elevDeg}° · 시야각 ${pose.fovDeg}°`);
    // 겹치는 구간 내내 같아야 함(3D 는 이미 내려다보는 중)
    let worst = 0;
    for (let p = Z.P_FADE_START; p <= Z.P_HANDOFF; p += 0.002) {
      const q = Z.cameraPoseForProgress(p, 13, 200, c.lat, c.aspect);
      const a = Z.footprintWidthKm(q.altitudeM, q.fovDeg, c.aspect);
      const b = Z.lonDeltaForProgress(p, c.lat, c.aspect) * 111.32 * Math.cos(c.lat * Math.PI / 180);
      worst = Math.max(worst, Math.abs(a / b - 1));
      if (Math.abs(q.elevDeg + 90) > 1e-9 || Math.abs(q.azDeg) > 1e-9 && Math.abs(q.azDeg - 360) > 1e-9) worst = Infinity;
    }
    ok(worst < 1e-6, `${c.name}: 겹치는 동안(${Z.P_FADE_START}~${Z.P_HANDOFF}) 내려다보기·북쪽 위·폭 일치 (최대 차 ${worst.toExponential(1)})`);
  }

  console.log('\n[2] 연속·단조·속도 이어짐');
  for (const c of CASES) {
    let mono = true, maxJump = 0, prevA = 0, prevD = 0;
    const h = 1e-4;
    for (let p = 0; p <= Z.P_MAX + 1e-9; p += h) {
      const a = Z.altitudeForProgress(p, c.lat, c.aspect);
      if (a < prevA - 1e-9) mono = false;
      if (prevA > 0) maxJump = Math.max(maxJump, Math.abs(Math.log(a / prevA)));
      prevA = a;
      if (p >= Z.P_FADE_START) {
        const d = Z.lonDeltaForProgress(p, c.lat, c.aspect);
        if (d < prevD - 1e-12) mono = false;
        prevD = d;
      }
    }
    ok(mono && maxJump < 0.01, `${c.name}: 고도·지도 폭 단조, 한 걸음(${h}) 최대 로그 변화 ${maxJump.toFixed(4)}`);
    const e = 1e-5, ph = Z.P_HANDOFF;
    const sL = (Math.log(Z.altitudeForProgress(ph, c.lat, c.aspect)) - Math.log(Z.altitudeForProgress(ph - e, c.lat, c.aspect))) / e;
    const sR = (Math.log(Z.altitudeForProgress(ph + e, c.lat, c.aspect)) - Math.log(Z.altitudeForProgress(ph, c.lat, c.aspect))) / e;
    ok(Math.abs(sL / sR - 1) < 0.01, `${c.name}: 넘기는 점 로그 줌 속도 왼쪽 ${sL.toFixed(2)} · 오른쪽 ${sR.toFixed(2)}`);
    ok(Math.abs(Z.altitudeForProgress(Z.P_HANDOFF, c.lat, c.aspect) - 20000) < 1e-6
      && Math.abs(Z.altitudeForProgress(1.0, c.lat, c.aspect) - 1.6) < 1e-12, `${c.name}: 1.6 m(진행도 1) → 20 km(넘기는 점)`);
  }
  // 옛 끊김 처리 버그 재발 방지 — 진행도 하나에 고도 하나
  ok(Z.altitudeForProgress(1.2, 37.5, 0.46) === Z.cameraPoseForProgress(1.2, 13, 0, 37.5, 0.46).altitudeM, '카메라 고도 = 고도 함수(한 곳에서만 계산)');

  console.log('\n[3] 끝: 지도 폭 180°, 구 반지름');
  for (const c of CASES) {
    const d = Z.lonDeltaForProgress(Z.P_MAX, c.lat, c.aspect);
    const W = 390, H = W / c.aspect;
    const R = M.globeRadiusForDelta(c.lat, d, W);
    ok(Math.abs(d - 180) < 1e-6, `${c.name}: 진행도 ${Z.P_MAX} → ${d.toFixed(3)}°, 구 반지름 ${R.toFixed(0)} px (화면 맞춤 ${M.globeFitRadius(W, H).toFixed(0)} px)`);
    const dg = M.deltaForStretch(c.lat, M.GLOBE_STRETCH, 1 / c.aspect);
    if (dg !== null) {
      const pg = Z.progressForLonDelta(dg, c.lat, c.aspect);
      ok(pg > Z.P_HANDOFF && pg < Z.P_MAX, `${c.name}: 구로 넘어가는 폭 ${dg.toFixed(1)}° = 진행도 ${pg.toFixed(2)} (지도 구간 안)`);
    }
  }

  console.log('\n[4] 화면 위쪽 벡터');
  {
    let worstDot = 0, worstStep = 0;
    for (const az of [0, 45, 135, 200, 359]) {
      let prev = null;
      for (let p = 0.9; p <= Z.P_HANDOFF; p += 0.0005) {
        const q = Z.cameraPoseForProgress(p, 13, az, 37.5, 0.46);
        const e = q.elevDeg * Math.PI / 180, a = q.azDeg * Math.PI / 180;
        const f = [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
        const u = q.up;
        worstDot = Math.max(worstDot, Math.abs(f[0] * u[0] + f[1] * u[1] + f[2] * u[2]), Math.abs(Math.hypot(...u) - 1));
        if (prev) worstStep = Math.max(worstStep, Math.hypot(u[0] - prev[0], u[1] - prev[1], u[2] - prev[2]));
        prev = u;
      }
      const end = Z.cameraPoseForProgress(Z.P_TILT_END, 13, az, 37.5, 0.46).up;
      if (Math.hypot(end[0], end[1], end[2] + 1) > 1e-9) worstDot = Infinity;
    }
    ok(worstDot < 1e-9, `위쪽 ⟂ 시선, 길이 1, 내려다보기 끝에서 북쪽(−Z) (최대 오차 ${worstDot.toExponential(1)})`);
    ok(worstStep < 0.02, `진행도 0.0005 걸음마다 위쪽 벡터 변화 ≤ ${worstStep.toFixed(4)} (예전 −85° 에서는 한 걸음에 최대 2)`);
    // 방위 섞임은 짧은 쪽으로(350° → 0° 는 10° 만 돔)
    const mid = Z.cameraPoseForProgress((1 + Z.P_TILT_END) / 2, 13, 350, 37.5, 0.46).azDeg;
    ok(mid > 350 || mid < 1, `방위 350° 는 짧은 쪽(+10°)으로 북쪽에 맞춤 (중간 ${mid.toFixed(1)}°)`);
  }

  console.log('\n[5] 역함수·관측점 귀환');
  for (const c of CASES) {
    let worst = 0;
    for (let p = Z.P_HANDOFF; p <= Z.P_MAX; p += 0.01) {
      worst = Math.max(worst, Math.abs(Z.progressForLonDelta(Z.lonDeltaForProgress(p, c.lat, c.aspect), c.lat, c.aspect) - p));
    }
    ok(worst < 1e-9, `${c.name}: 진행도 → 폭 → 진행도 왕복 오차 ${worst.toExponential(1)}`);
  }
  {
    const home = { latitude: 37.5, longitude: 179.5 };
    let c = { latitude: 30, longitude: -175 };
    let p = 2.0;
    while (p > Z.P_HANDOFF - 0.05) { const n = p - 0.013; c = Z.homeCenterStep(c, home, p, n); p = n; }
    ok(Math.abs(c.latitude - home.latitude) < 1e-9 && Math.abs(Z.wrap180(c.longitude - home.longitude)) < 1e-9,
      `줌인하며 넘기는 점까지 관측점으로 귀환(날짜변경선 건너기 포함): ${c.latitude.toFixed(3)}, ${c.longitude.toFixed(3)}`);
    const same = Z.homeCenterStep({ latitude: 1, longitude: 2 }, home, 1.6, 1.7);
    ok(same.latitude === 1 && same.longitude === 2, '줌아웃에서는 지도 한가운데를 건드리지 않음');
  }

  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exit(fail ? 1 : 0);
})();
