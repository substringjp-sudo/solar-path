/**
 * **눈에서 본 땅 스카이라인이 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * `src/utils/horizon.ts`(지평선 프로필 · 스카이라인)를 **합성 산**에 대어 봅니다. 자는 따로 짠 느린 정답 —
 * 눈에서 곧은 선을 20 m 걸음으로 걸으며 땅의 앙각 최댓값을 직접 잰 것 — 입니다. 프로필은 방위 1° · 거리 250 m 칸으로 줄인 것이라,
 * 건물 가림(`occluderAngleDeg`)은 정답과 **보수적으로만**(보이는 쪽으로만) 어긋나야 하고, 스카이라인은 사실대로 맞아야 합니다.
 *
 * 먼저 정한 줄:
 *  1. 가림 앙각 — 프로필은 방위 칸 셋 중 가장 낮은 값을 씁니다(보수적 정의). 정답도 "±1° 의 정답 셋 중 가장 낮은 것"으로 잡아
 *     0.03° 안(거리 250 m 칸의 몫). 평지는 0.02° 안. 어느 쪽이든 그 방위의 정답보다 0.01° 넘게 높으면(= 덜 보이게 어긋나면) 실패.
 *  2. 스카이라인 — 방위가 칸 사이(예: 82.5°)여도 정답의 전 거리 최대와 0.05° 안(칸 사이를 선형으로 이은 몫: 산 가장자리 기울기
 *     0.09°/° 의 절반). 정답은 15 km 안에서 잰 것입니다.
 *  3. 스카이라인 ≥ 가림 앙각 — 같은 방위에서 거리를 늘리면 가림 앙각은 줄지 않는다(누적 최대).
 *  4. 모서리 — 방위 359.5° 는 359°·0° 칸 사이, 땅 자료가 아예 없으면 NO_TERRAIN, 자료가 일부 없어도 값이 나온다.
 *  5. 빠르다 — 40 km 프로필이 1.5 초 안(앱이 눈 높이를 바꿀 때마다 다시 계산하므로).
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-skyline.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const RAD = Math.PI / 180;

(async () => {
  const H = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'horizon.js'));
  const E = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'earth.js'));
  const drop = E.curvatureDropM;
  const EYE = 41.6;
  // 합성 산: 평지 40 m 위에 동쪽 6 km 에 440 m 산 덩어리(가우스, 동서 폭 1.2 km, 남북 폭 4 km)
  const mountain = (e, s) => 40 + 400 * Math.exp(-((e - 6000) ** 2) / (2 * 1200 ** 2)) * Math.exp(-(s ** 2) / (2 * 4000 ** 2));
  const eastSouth = (az, d) => [Math.sin(az * RAD) * d, -Math.cos(az * RAD) * d];
  const truthOcc = (h, e, s) => {
    const D = Math.hypot(e, s);
    let m = -90;
    for (let d = 20; d < D - 1; d += 20) {
      const g = h(e * d / D, s * d / D);
      if (g != null) m = Math.max(m, Math.atan2(g - EYE - drop(d), d) / RAD);
    }
    return m;
  };
  const truthSkyline = (h, az, maxD = 15000) => { const [e, s] = eastSouth(az, maxD + 20); return truthOcc(h, e, s); };

  const prof = H.buildHorizonProfile(mountain, EYE);

  console.log('\n[1] 가림 앙각 — 느린 정답과 견줌');
  {
    let worstEast = 0, worstFlat = 0, tooHigh = 0, n = 0;
    for (const az of [60, 75, 90, 105, 120]) for (const d of [7000, 9000, 12000, 14500]) {
      const [e, s] = eastSouth(az, d);
      const t = truthOcc(mountain, e, s), p = H.occluderAngleDeg(prof, az, d);
      const t3 = Math.min(...[-1, 0, 1].map(da => { const [e2, s2] = eastSouth(az + da, d); return truthOcc(mountain, e2, s2); }));
      worstEast = Math.max(worstEast, Math.abs(p - t3));
      if (p > t + 0.01) tooHigh++;
      n++;
    }
    for (const az of [180, 225, 270, 315, 0]) for (const d of [3000, 9000, 14500]) {
      const [e, s] = eastSouth(az, d);
      const t = truthOcc(mountain, e, s), p = H.occluderAngleDeg(prof, az, d);
      worstFlat = Math.max(worstFlat, Math.abs(p - t));
      if (p > t + 0.01) tooHigh++;
      n++;
    }
    console.log(`      ${n}점 — 산 쪽 최대 ${worstEast.toFixed(4)}° · 평지 최대 ${worstFlat.toFixed(4)}° · 정답보다 높은 점 ${tooHigh}`);
    ok(worstEast < 0.03, `산 뒤 가림 앙각이 "±1° 중 가장 낮은 정답"과 0.03° 안 (${worstEast.toFixed(4)}°)`);
    ok(worstFlat < 0.02, `평지 가림 앙각이 정답과 0.02° 안 (${worstFlat.toFixed(4)}°)`);
    ok(tooHigh === 0, `정답보다 0.01° 넘게 높게(덜 보이게) 어긋난 점이 없다 (${tooHigh})`);
  }

  console.log('\n[2] 스카이라인 — 칸 사이 방위까지');
  {
    let worst = 0, worstAt = 0, n = 0;
    for (let az = 40; az <= 140; az += 2.5) {
      const t = truthSkyline(mountain, az), p = H.skylineAngleDeg(prof, az);
      const d = Math.abs(p - t);
      if (d > worst) { worst = d; worstAt = az; }
      n++;
    }
    let worstFlat = 0;
    for (const az of [180, 200.5, 233.3, 270, 300.7, 350]) worstFlat = Math.max(worstFlat, Math.abs(H.skylineAngleDeg(prof, az) - truthSkyline(mountain, az)));
    console.log(`      산 쪽 ${n}점 최대 ${worst.toFixed(4)}° (방위 ${worstAt}°) · 평지 최대 ${worstFlat.toFixed(4)}°`);
    ok(worst < 0.05, `스카이라인이 정답과 0.05° 안 (${worst.toFixed(4)}°)`);
    ok(worstFlat < 0.02, `평지 스카이라인이 정답과 0.02° 안 (${worstFlat.toFixed(4)}°)`);
    const east = H.skylineAngleDeg(prof, 90), south = H.skylineAngleDeg(prof, 180);
    ok(east > 3.5 && east < 4.0 && south < 0, `산 쪽 스카이라인 ${east.toFixed(2)}° (산마루 앙각 3.78° 근처), 평지는 수평 아래 ${south.toFixed(3)}°`);
  }

  console.log('\n[3] 누적 최대');
  {
    let bad = 0, n = 0;
    for (const az of [0, 45, 90, 135, 180, 270]) {
      let prev = -91;
      for (let d = 500; d <= 14500; d += 500) {
        const v = H.occluderAngleDeg(prof, az, d);
        if (v < prev - 1e-6) bad++;
        prev = v; n++;
      }
      if (H.skylineAngleDeg(prof, az) < prev - 0.05) bad++;
    }
    ok(bad === 0, `거리를 늘려도 가림 앙각이 줄지 않고 스카이라인이 그 위다 (${n} 점, 위반 ${bad})`);
  }

  console.log('\n[4] 모서리');
  {
    const a = H.skylineAngleDeg(prof, 359.5), lo = H.skylineAngleDeg(prof, 359), hi = H.skylineAngleDeg(prof, 0);
    ok(a >= Math.min(lo, hi) - 1e-6 && a <= Math.max(lo, hi) + 1e-6, `방위 359.5° 는 359°·0° 칸 사이 (${a.toFixed(4)} ∈ [${Math.min(lo, hi).toFixed(4)}, ${Math.max(lo, hi).toFixed(4)}])`);
    const none = H.buildHorizonProfile(() => null, EYE);
    ok(H.skylineAngleDeg(none, 90) === H.NO_TERRAIN && H.occluderAngleDeg(none, 90, 9000) === H.NO_TERRAIN, '자료가 아예 없으면 NO_TERRAIN');
    const hole = H.buildHorizonProfile((e, s) => (e > 2000 && e < 4000 ? null : 40), EYE);
    ok(Number.isFinite(H.skylineAngleDeg(hole, 90)) && H.skylineAngleDeg(hole, 90) > -90, '자료가 일부 없어도(구멍) 값이 나온다');
    ok(H.occluderAngleDeg(prof, 90, 200) === H.NO_TERRAIN, '250 m 보다 가까우면 가림 없음');
  }

  console.log('\n[5] 속도');
  {
    const t = Date.now();
    H.buildHorizonProfile(mountain, EYE, { maxDistM: 40000 });
    const ms = Date.now() - t;
    ok(ms < 1500, `40 km 프로필 ${ms} ms < 1500 ms`);
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
