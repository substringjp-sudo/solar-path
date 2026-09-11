/**
 * **나침반 값을 카메라 기준으로 옮기는가** 합격 판정. 브라우저가 필요 없습니다.
 *
 * 결함(사용자 보고): "지면에 수평하게 놓으면 동서남북이 잘 맞는데 수직으로 들면
 * 안 맞는다. 랜덤이 아니라 거의 항상 동쪽을 봐도 남서쪽만 본다."
 *
 * 원인: `watchHeadingAsync` 가 주는 방위는 Android `getOrientation()[0]` 그대로라
 * **기기 상단 모서리(+Y)** 의 방위입니다(expo-location/LocationModule.kt 확인).
 * 카메라가 지평선 **위**를 보게 젖히면 상단 모서리가 뒤로 넘어가 180° 뒤집힙니다.
 * 자이로 쪽(카메라 전방)은 안 뒤집히므로 융합이 서로 다른 것을 섞습니다.
 *
 * 이 판정은 **참 자세를 만들고 → Android 분해를 그대로 흉내 내고 → expo 가
 * 돌려줄 값으로 되돌려** 옛 길과 새 길을 나란히 돌립니다.
 *
 * 사용: node tools/shader-preview/verify-device-pose.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const D = Math.PI / 180, R2D = 180 / Math.PI;
const diff = (x, y) => (x - y + 540) % 360 - 180;

/** W3C: R = Rz(a)Rx(b)Ry(g). 열이 기기축, 월드 X=동 Y=북 Z=상. */
function W3C(a, b, g) {
  const sa=Math.sin(a),ca=Math.cos(a),sb=Math.sin(b),cb=Math.cos(b),sg=Math.sin(g),cg=Math.cos(g);
  return [
    [ca*cg-sa*sb*sg, -sa*cb, ca*sg+sa*sb*cg],
    [sa*cg+ca*sb*sg,  ca*cb, sa*sg-ca*sb*cg],
    [-cb*sg,          sb,    cb*cg         ],
  ];
}
/** Android SensorManager.getOrientation — pitch 가 ±90° 로 갇힌다. */
function androidOrientation(R) {
  return {
    azimuth: Math.atan2(R[0][1], R[1][1]),
    pitch:   Math.asin(Math.max(-1, Math.min(1, -R[2][1]))),
    roll:    Math.atan2(-R[2][0], R[2][2]),
  };
}
/** 참 자세 → 기기가 실제로 앱에 건네는 것들. */
function sensorsFor(aDeg, bDeg, gDeg) {
  const Rt = W3C(aDeg*D, bDeg*D, gDeg*D);
  const o = androidOrientation(Rt);
  const f = [-Rt[0][2], -Rt[1][2], -Rt[2][2]];
  return {
    expo: { alpha: -o.azimuth, beta: -o.pitch, gamma: o.roll },   // DeviceMotion.rotation
    compass: ((o.azimuth * R2D) % 360 + 360) % 360,               // watchHeadingAsync
    trueCamAz: ((Math.atan2(f[0], f[1]) * R2D) + 360) % 360,
    trueCamElev: Math.asin(Math.max(-1, Math.min(1, f[2]))) * R2D,
  };
}

(async () => {
  const { poseFromRotation, compassToCameraHeading } = await import(
    'file://' + path.join(PREVIEW, 'app', 'utils', 'devicePose.js'));

  console.log('\n[1] 자이로(카메라 전방)는 원래 멀쩡했다 — 규약 가설을 죽인다');
  {
    let worst = 0;
    for (let a = 0; a < 360; a += 15)
      for (let b = 0; b <= 175; b += 5)
        for (const g of [-60, -20, 0, 20, 60]) {
          const s = sensorsFor(a, b, g);
          const p = poseFromRotation(s.expo.alpha, s.expo.beta, s.expo.gamma);
          if (p.camHoriz < 0.05) continue;             // 천정·바닥은 방위가 무의미
          worst = Math.max(worst, Math.abs(diff(p.camAzDeg, s.trueCamAz)));
        }
    ok(worst < 0.01, `expo→행렬 왕복이 충실하다 (최대 오차 ${worst.toFixed(4)}°)`);
    console.log('      → Android 가 pitch 를 ±90° 로 가둬 다른 가지를 골라도 행렬은 같습니다.');
  }

  console.log('\n[2] 결함 재현 — 나침반은 지평선을 넘는 순간 180° 뒤집힌다');
  {
    const below = sensorsFor(-90, 89, 0);    // 카메라 앙각 −1°
    const above = sensorsFor(-90, 91, 0);    // 카메라 앙각 +1°
    ok(Math.abs(diff(below.compass, below.trueCamAz)) < 0.5,
       `지평선 아래(앙각 ${below.trueCamElev.toFixed(0)}°)에서는 나침반이 맞는다 (${below.compass.toFixed(1)}°)`);
    ok(Math.abs(Math.abs(diff(above.compass, above.trueCamAz)) - 180) < 0.5,
       `지평선 위(앙각 ${above.trueCamElev.toFixed(0)}°)에서는 **180° 뒤집힌다** (${above.compass.toFixed(1)}° 대 참 ${above.trueCamAz.toFixed(1)}°)`);
    const flat = sensorsFor(-90, 5, 0);
    ok(Math.abs(diff(flat.compass, flat.trueCamAz)) < 0.5,
       `눕히면(앙각 ${flat.trueCamElev.toFixed(0)}°) 맞는다 — "수평하게 놓으면 잘 맞는다"`);
  }

  console.log('\n[3] 고친 뒤 — 옮긴 나침반이 참 카메라 방위와 맞는가');
  {
    let worstNew = 0, worstOld = 0, nNew = 0, nOldBad = 0, total = 0;
    for (let a = 0; a < 360; a += 15)
      for (let b = 5; b <= 175; b += 5)
        for (const g of [-45, -15, 0, 15, 45]) {
          const s = sensorsFor(a, b, g);
          const p = poseFromRotation(s.expo.alpha, s.expo.beta, s.expo.gamma);
          const conv = compassToCameraHeading(s.compass, p);
          if (conv === null) continue;
          total++;
          worstNew = Math.max(worstNew, Math.abs(diff(conv, s.trueCamAz)));
          nNew++;
          const oldErr = Math.abs(diff(s.compass, s.trueCamAz));
          worstOld = Math.max(worstOld, oldErr);
          if (oldErr > 5) nOldBad++;
        }
    ok(worstNew < 0.01, `새 길: ${nNew}개 자세 전부 참값과 맞는다 (최대 오차 ${worstNew.toFixed(4)}°)`);
    ok(worstOld > 170, `옛 길: 같은 자세에서 최대 ${worstOld.toFixed(1)}° 틀린다`);
    ok(nOldBad > total * 0.3,
       `옛 길이 5° 넘게 틀리는 자세가 ${nOldBad}/${total} (${(nOldBad/total*100).toFixed(0)}%)`);
  }

  console.log('\n[4] 세우면 나침반 자체가 특이점 — 안 쓴다');
  {
    const upright = sensorsFor(-90, 90, 0);
    const p = poseFromRotation(upright.expo.alpha, upright.expo.beta, upright.expo.gamma);
    ok(p.topHoriz < 0.05, `정확히 세우면 상단 모서리 수평 길이가 ${p.topHoriz.toFixed(3)} — 0/0 이다`);
    ok(compassToCameraHeading(upright.compass, p) === null, '그런 표본은 null 로 물린다');
    const tilted = sensorsFor(-90, 70, 0);
    const p2 = poseFromRotation(tilted.expo.alpha, tilted.expo.beta, tilted.expo.gamma);
    ok(compassToCameraHeading(tilted.compass, p2) !== null, '충분히 기울면 다시 쓴다');
  }

  console.log('\n[5] 대조 — 눕힌 자세에서는 새 길이 옛 길과 같은 값을 낸다');
  {
    let same = 0, n = 0;
    for (let a = 0; a < 360; a += 15) {
      const s = sensorsFor(a, 25, 0);        // 카메라가 아래를 봄 = 옛 길도 맞던 구간
      const p = poseFromRotation(s.expo.alpha, s.expo.beta, s.expo.gamma);
      const conv = compassToCameraHeading(s.compass, p);
      if (conv === null) continue;
      n++;
      if (Math.abs(diff(conv, s.compass)) < 0.01) same++;
    }
    ok(n > 0 && same === n, `옛 길이 맞던 ${n}개 자세에서 새 길이 값을 안 바꾼다 — 엉뚱한 데를 안 건드린다`);
  }

  console.log('\n[6] 기울여 들면(roll) 옛 길은 지평선 아래에서도 틀린다');
  {
    const s = sensorsFor(-90, 60, 40);       // 카메라는 아래를 보지만 40° 기울임
    const p = poseFromRotation(s.expo.alpha, s.expo.beta, s.expo.gamma);
    const conv = compassToCameraHeading(s.compass, p);
    const oldErr = Math.abs(diff(s.compass, s.trueCamAz));
    ok(oldErr > 5, `옛 길 오차 ${oldErr.toFixed(1)}° — 기울기만으로도 어긋난다`);
    ok(conv !== null && Math.abs(diff(conv, s.trueCamAz)) < 0.01, '새 길은 기울여도 맞는다');
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
