/**
 * **별 보기 조건(맨눈 한계등급)이 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * `src/utils/starVisibility.ts` 는 하늘 밝기에서 맨눈으로 보이는 가장 어두운 별의 등급을 냅니다(박명 · 달빛 · 빛 공해 · 연무, 구름은 가려지는 몫).
 * 식은 문헌의 것이라 다음 길로 견줍니다: 식을 여기서 따로 다시 짜기, 알려진 기준점, 물리적으로 말이 되는 범위와 단조성,
 * 단계별 줄어든 등급의 합이 처음과 끝의 차와 같은지(결과가 순서에 안 기대는 것), 달 지는 시각을 0.5 초 걸음 독립 탐색과 대조.
 *
 * 먼저 정한 줄(실행 전):
 *  1. 변환: 자연 암천 SB = nelmToSb(6.5) 가 다시 6.5 등급. 왕복이 맞고, 하늘이 밝을수록 한계등급이 낮다.
 *     기준점(Unihedron SQM ↔ 맨눈 한계 대응표의 대략값, ±0.1): SB 21.0 → 6.1, 20.0 → 5.5, 19.0 → 4.8, 18.0 → 4.0.
 *     nanoLambert: SB 21.733 → 약 69.3 nL(식 그대로), 왕복.
 *  2. 대기 질량: X(0°)=1, X(45°)=1.387, X(60°)=1.890, X(75°)=3.096.
 *  3. 달빛(Krisciunas & Schaefer): 식을 여기서 다시 짜 같은 값. 달이 지평선 아래면 정확히 0. 보름달 고도 50° 일 때 달빛을 더한 천정 하늘이
 *     17.5~19.0 등급/arcsec² (실제 보름달 밤 하늘). 반달(밝은 비율 0.5)은 보름달보다 위상 항으로 10.9 배(10^(0.4·(0.026·90 + 4e−9·90⁴)))
 *     어둡다. 삭은 보름의 1% 미만. 보름달 밝기는 고도 10° < 30° < 60° 로 커진다.
 *  4. 박명: 깊이 6° → 11.5, 12° → 17.5, 9° → 14.5(보간), 16.5° → 20.62, 18° 이상 null, 해가 떠 있으면 5.
 *  5. 연무: k(AOD 없음) = k(0.05) = 0.20, k(0.25) = 0.4172, 큰 AOD 는 1.5 에서 멈춤. 시정 → AOD: 24 km 0.2265, 50 km 0.0994, 10 km 0.5688, 1 km 는 2 에서 멈춤.
 *  6. 단계: 깨끗한 하늘은 6.5 로 줄어든 것 없음. 빛 공해만 5.3 이면 한계 5.3(줄어든 −1.2). 연무만 AOD 0.25 면 −0.3258. 달만 보름 근처(0.99, 50°)는 −2.6~−2.0.
 *     단계별 줄어든 등급의 합 = 마지막 − 6.5 (아무 입력에서나 1e−9). 마지막 값은 밝기를 한 번에 합산하는 독립 식과 같다.
 *  7. 구름: 운량은 한계등급을 안 바꾸고 판정만(20% 이하 좋음 · 50% 이하 보통 · 그 위 나쁨, 경계는 아래쪽 포함), 가려지지 않는 몫 = 1 − 운량.
 *  8. 단조: 달이 밝을수록 · 빛 공해가 클수록 · AOD 가 클수록 · 해가 높을수록 한계등급이 낮아진다. 어떤 입력에서도 0~6.5 안.
 *  9. 달 지는 시각: 합성 고도 곡선은 해석해와 1 분 안, 이미 졌거나 시간 안에 안 지면 null, 실제 달(서울)은 0.5 초 걸음 독립 탐색과 1 분 안.
 * 10. 달 없는 한계등급은 달 고도 −10° 와 같고, 달이 떠 있을 때보다 낮지 않다. 보이는 정도 구간 경계 6 · 5 · 4 · 3.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-star-visibility.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

(async () => {
  const S = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'starVisibility.js'));
  const M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'moonPosition.js'));

  // 독립 식(여기서 따로 짠다)
  const nelmRef = (sb) => 7.93 - 5 * Math.log10(10 ** (4.316 - sb / 5) + 1);
  const nlRef = (sb) => 34.08 * Math.exp(20.7233 - 0.92104 * sb);
  const sbRef = (nl) => (20.7233 - Math.log(nl / 34.08)) / 0.92104;
  const xRef = (z) => (1 - 0.96 * Math.sin(z * D2R) ** 2) ** -0.5;
  const moonRef = (alphaDeg, altDeg, k) => {
    if (altDeg <= 0) return 0;
    const Z = 90 - altDeg, rho = Z, c = Math.cos(rho * D2R);
    const f = 10 ** 5.36 * (1.06 + c * c) + 10 ** (6.15 - rho / 40);
    const a = Math.abs(alphaDeg);
    const ist = 10 ** (-0.4 * (3.84 + 0.026 * a + 4e-9 * a ** 4));
    return f * ist * 10 ** (-0.4 * k * xRef(Z)) * (1 - 10 ** (-0.4 * k * xRef(0)));
  };

  // ── [1] 변환 ──
  console.log('\n[1] 한계등급 ↔ 하늘 밝기');
  {
    ok(near(S.sbToNelm(S.SKY_NATURAL_SB), 6.5, 1e-9) && near(S.SKY_NATURAL_SB, 21.733, 0.001), `자연 암천 SB ${S.SKY_NATURAL_SB.toFixed(4)} 는 6.5 등급`);
    let worst = 0;
    for (let sb = 17; sb <= 22.5; sb += 0.25) worst = Math.max(worst, Math.abs(S.sbToNelm(S.nelmToSb(S.sbToNelm(sb))) - S.sbToNelm(sb)), Math.abs(S.nelmToSb(S.sbToNelm(sb)) - sb));
    ok(worst < 1e-9, `왕복 오차 최대 ${worst.toExponential(1)}`);
    ok([17, 18, 19, 20, 21, 22].every((sb, i, a) => i === 0 || S.sbToNelm(sb) > S.sbToNelm(a[i - 1])), '하늘이 어두울수록(SB 가 클수록) 한계등급이 높다');
    const anchors = [[21.0, 6.1], [20.0, 5.5], [19.0, 4.8], [18.0, 4.0]];
    ok(anchors.every(([sb, n]) => near(S.sbToNelm(sb), n, 0.1)), `기준점(Unihedron 대응표 대략값 ±0.1): ${anchors.map(([sb]) => `${sb}→${S.sbToNelm(sb).toFixed(2)}`).join(' ')}`);
    ok(near(S.sbToNelm(21.0), nelmRef(21.0), 1e-12) && near(S.sbToNelm(18.0), nelmRef(18.0), 1e-12), '구현이 따로 짠 식과 같다');
    ok(near(S.sbToNl(S.SKY_NATURAL_SB), nlRef(S.SKY_NATURAL_SB), 1e-9) && near(S.sbToNl(S.SKY_NATURAL_SB), 69.3, 0.3), `자연 하늘 ${S.sbToNl(S.SKY_NATURAL_SB).toFixed(1)} nL (식 그대로, 약 69.3)`);
    ok(near(S.nlToSb(S.sbToNl(19.37)), 19.37, 1e-9) && near(S.nlToSb(1503), sbRef(1503), 1e-12), 'nanoLambert 왕복');
  }

  // ── [2] 대기 질량 ──
  console.log('\n[2] 대기 질량');
  {
    ok(near(S.airmass(0), 1, 1e-12) && near(S.airmass(45), 1.387, 0.001) && near(S.airmass(60), 1.890, 0.001) && near(S.airmass(75), 3.096, 0.001), `X(0)=${S.airmass(0)}, X(45)=${S.airmass(45).toFixed(3)}, X(60)=${S.airmass(60).toFixed(3)}, X(75)=${S.airmass(75).toFixed(3)}`);
  }

  // ── [3] 달빛 ──
  console.log('\n[3] 달빛');
  {
    const k = 0.2;
    const cases = [[0, 50], [8, 50], [42, 41], [90, 30], [90, 60], [120, 20], [180, 70]];
    ok(cases.every(([a, h]) => near(S.moonSkyBrightnessNl(a, h, k) / moonRef(a, h, k), 1, 1e-12)), '구현이 따로 짠 Krisciunas & Schaefer 식과 같다(위상각 · 고도 7 곳)');
    ok(S.moonSkyBrightnessNl(0, 0, k) === 0 && S.moonSkyBrightnessNl(0, -5, k) === 0 && S.moonSkyBrightnessNl(0, -0.001, k) === 0, '달이 지평선 아래(고도 ≤ 0)면 정확히 0');
    const bNat = S.sbToNl(S.SKY_NATURAL_SB);
    const sbFull = sbRef(bNat + S.moonSkyBrightnessNl(0, 50, k));
    ok(sbFull > 17.5 && sbFull < 19.0, `보름달 고도 50°: 달빛을 더한 천정 하늘 ${sbFull.toFixed(2)} 등급/arcsec² (17.5~19.0)`);
    const ratio = S.moonSkyBrightnessNl(0, 50, k) / S.moonSkyBrightnessNl(90, 50, k);
    const wantRatio = 10 ** (0.4 * (0.026 * 90 + 4e-9 * 90 ** 4));
    ok(near(ratio, wantRatio, 1e-9) && near(ratio, 10.9, 0.2), `보름달 대 반달(위상각 90°): ${ratio.toFixed(2)} 배 (위상 항 ${wantRatio.toFixed(2)})`);
    ok(S.moonSkyBrightnessNl(180, 50, k) < 0.01 * S.moonSkyBrightnessNl(0, 50, k), '삭은 보름의 1% 미만');
    ok(S.moonSkyBrightnessNl(0, 10, k) < S.moonSkyBrightnessNl(0, 30, k) && S.moonSkyBrightnessNl(0, 30, k) < S.moonSkyBrightnessNl(0, 60, k), '보름달 밝기는 달이 높을수록 커진다(10° < 30° < 60°)');
    ok(near(S.phaseAngleDeg(1), 0, 1e-9) && near(S.phaseAngleDeg(0), 180, 1e-9) && near(S.phaseAngleDeg(0.5), 90, 1e-9) && near(S.phaseAngleDeg(0.87), Math.acos(0.74) * R2D, 1e-9), '밝은 비율 → 위상각: 1 → 0°, 0 → 180°, 0.5 → 90°');
  }

  // ── [4] 박명 ──
  console.log('\n[4] 박명 하늘');
  {
    ok(near(S.twilightSb(-6), 11.5, 1e-9) && near(S.twilightSb(-12), 17.5, 1e-9) && near(S.twilightSb(-9), 14.5, 1e-9) && near(S.twilightSb(-16.5), 19.5 + (S.SKY_NATURAL_SB - 19.5) * 0.5, 1e-9), `깊이 6° ${S.twilightSb(-6)} · 12° ${S.twilightSb(-12)} · 9° ${S.twilightSb(-9)} · 16.5° ${S.twilightSb(-16.5).toFixed(2)}`);
    ok(S.twilightSb(-18) === null && S.twilightSb(-30) === null && S.twilightSb(-17.999) !== null, '깊이 18° 이상은 null(어두운 밤), 17.999° 는 아직 박명');
    ok(S.twilightSb(0) === 5 && S.twilightSb(20) === 5, '해가 떠 있으면 5');
    let mono = true; for (let d = 0; d + 0.5 < 18; d += 0.5) if (S.twilightSb(-d - 0.5) < S.twilightSb(-d)) mono = false;
    ok(mono, '해가 내려갈수록 하늘이 어두워진다(깊이 0~17.5°, SB 단조 증가)');
  }

  // ── [5] 연무 ──
  console.log('\n[5] 연무');
  {
    ok(S.extinctionK(null) === 0.2 && S.extinctionK(undefined) === 0.2 && S.extinctionK(0.05) === 0.2 && S.extinctionK(0.01) === 0.2, 'AOD 없음 · 0.05 이하는 맑은 날 0.20');
    ok(near(S.extinctionK(0.25), 0.2 + 1.086 * 0.2, 1e-12) && S.extinctionK(5) === 1.5, `AOD 0.25 → ${S.extinctionK(0.25).toFixed(4)}, 큰 값은 1.5 에서 멈춤`);
    ok(near(S.aodFromVisibility(24000), (3.912 / 24 - 0.012) * 1.5, 1e-12) && near(S.aodFromVisibility(24000), 0.2265, 0.0005) && near(S.aodFromVisibility(50000), 0.0994, 0.0005) && near(S.aodFromVisibility(10000), 0.5688, 0.0005) && S.aodFromVisibility(1000) === 2, '시정 → AOD: 24 km 0.2265 · 50 km 0.0994 · 10 km 0.5688 · 1 km 는 2 에서 멈춤');
  }

  // ── [6] 단계와 합 ──
  console.log('\n[6] 한계등급과 단계');
  {
    const dark = { cloudPct: 0, sunAltDeg: -30, moonAltDeg: -20, moonIllum: 0, lightPollutionMag: 6.5, aod550: 0.05 };
    const r0 = S.starLimit(dark);
    ok(near(r0.limitMag, 6.5, 1e-9) && r0.twilight === null && r0.moon.deltaMag === 0 && r0.light.deltaMag === 0 && Math.abs(r0.haze.deltaMag) < 1e-12 && r0.keyStep === null, `깨끗한 하늘 ${r0.limitMag.toFixed(3)}: 단계 모두 0, 짚을 단계 없음`);
    const rl = S.starLimit({ ...dark, lightPollutionMag: 5.3 });
    ok(near(rl.limitMag, 5.3, 1e-6) && near(rl.light.deltaMag, -1.2, 1e-6) && rl.keyStep === 'light', `빛 공해만(지도 5.3): 한계 ${rl.limitMag.toFixed(3)}, 줄어든 ${rl.light.deltaMag.toFixed(3)}`);
    const rh = S.starLimit({ ...dark, aod550: 0.25 });
    ok(near(rh.haze.deltaMag, -(0.2 + 1.086 * 0.2 - 0.2) * 1.5, 1e-9) && near(rh.haze.deltaMag, -0.3258, 0.0005) && rh.keyStep === 'haze' && rh.haze.aodSource === 'aod', `연무만(AOD 0.25): ${rh.haze.deltaMag.toFixed(4)} 등급`);
    const rv = S.starLimit({ ...dark, aod550: undefined, visibilityM: 24000 });
    ok(rv.haze.aodSource === 'visibility' && near(rv.haze.aod, 0.2265, 0.0005), '연무 자료가 시정뿐이면 시정으로 어림하고 그렇다고 표시');
    const rn = S.starLimit({ ...dark, aod550: null, visibilityM: null });
    ok(rn.haze.aodSource === 'none' && rn.haze.deltaMag === 0 && rn.haze.aod === null, '연무 자료가 없으면 맑은 대기로 가정(줄어든 것 0)하고 그렇다고 표시');
    const rm = S.starLimit({ ...dark, moonAltDeg: 50, moonIllum: 0.99 });
    ok(rm.moon.deltaMag > -2.6 && rm.moon.deltaMag < -2.0 && rm.keyStep === 'moon' && rm.moon.up, `보름달(0.99) 고도 50°: 줄어든 ${rm.moon.deltaMag.toFixed(2)} 등급 (−2.6~−2.0)`);
    // 달 한 곳을 독립 식으로: 보름 근처 0.87, 고도 41°, AOD 0.05(k 0.2)
    const bNat = nlRef(S.SKY_NATURAL_SB);
    const wantMoon = nelmRef(sbRef(bNat + moonRef(Math.acos(2 * 0.87 - 1) * R2D, 41, 0.2))) - 6.5;
    const r87 = S.starLimit({ ...dark, moonAltDeg: 41, moonIllum: 0.87 });
    ok(near(r87.moon.deltaMag, wantMoon, 1e-9), `독립 식으로 구한 달 0.87 · 41° 의 줄어든 등급 ${wantMoon.toFixed(3)} = 구현 ${r87.moon.deltaMag.toFixed(3)}`);

    // 합 = 마지막 − 6.5, 한 번에 합산한 값과 같다(아무 입력에서나)
    let sumWorst = 0, oneShotWorst = 0, rangeOk = true;
    const rnd = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    for (let n = 0; n < 400; n++) {
      const inp = { cloudPct: rnd() * 100, sunAltDeg: -40 + rnd() * 45, moonAltDeg: -20 + rnd() * 80, moonIllum: rnd(), lightPollutionMag: rnd() < 0.2 ? null : 3 + rnd() * 3.5, aod550: rnd() < 0.3 ? null : rnd() * 1.2, visibilityM: rnd() < 0.5 ? 2000 + rnd() * 48000 : null };
      const r = S.starLimit(inp);
      const sum = (r.twilight ? r.twilight.deltaMag : 0) + r.moon.deltaMag + r.light.deltaMag + r.haze.deltaMag;
      sumWorst = Math.max(sumWorst, Math.abs(sum - (r.limitMag - r.startMag)));
      // 한 번에: 밝기를 독립 식으로 합산
      const k = S.extinctionK(inp.aod550 != null ? inp.aod550 : inp.visibilityM != null ? S.aodFromVisibility(inp.visibilityM) : null);
      const tw = S.twilightSb(inp.sunAltDeg);
      let B = nlRef(S.SKY_NATURAL_SB) + (tw == null ? 0 : Math.max(0, nlRef(tw) - nlRef(S.SKY_NATURAL_SB)));
      B += moonRef(Math.acos(Math.max(-1, Math.min(1, 2 * inp.moonIllum - 1))) * R2D, inp.moonAltDeg, k);
      if (inp.lightPollutionMag != null && inp.lightPollutionMag < 6.5) B += Math.max(0, nlRef(S.nelmToSb(Math.max(1, inp.lightPollutionMag))) - nlRef(S.SKY_NATURAL_SB));
      const oneShot = Math.max(0, Math.min(6.5, nelmRef(sbRef(B)) - (k - 0.2) * 1.5));
      oneShotWorst = Math.max(oneShotWorst, Math.abs(oneShot - r.limitMag));
      if (!(r.limitMag >= 0 && r.limitMag <= 6.5)) rangeOk = false;
    }
    ok(sumWorst < 1e-9, `단계별 줄어든 등급의 합 = 마지막 − 6.5: 무작위 400 개 최대 오차 ${sumWorst.toExponential(1)}`);
    ok(oneShotWorst < 1e-9, `마지막 값 = 밝기를 한 번에 합산한 독립 식(순서에 안 기댐): 최대 오차 ${oneShotWorst.toExponential(1)}`);
    ok(rangeOk, '어떤 입력에서도 한계등급이 0~6.5 안');
  }

  // ── [7] 구름 ──
  console.log('\n[7] 구름');
  {
    const base = { cloudPct: 0, sunAltDeg: -30, moonAltDeg: 30, moonIllum: 0.5, lightPollutionMag: 5.5, aod550: 0.2 };
    const a = S.starLimit(base), b = S.starLimit({ ...base, cloudPct: 100 });
    ok(a.limitMag === b.limitMag && a.cloud.rating === 'good' && b.cloud.rating === 'bad' && a.cloud.clearFraction === 1 && b.cloud.clearFraction === 0, '운량은 한계등급을 안 바꾸고 판정과 가려지지 않는 몫만 바꾼다');
    ok(S.cloudRating(20) === 'good' && S.cloudRating(20.01) === 'fair' && S.cloudRating(50) === 'fair' && S.cloudRating(50.01) === 'bad' && S.cloudRating(0) === 'good', '경계: 20% 좋음 · 20.01% 보통 · 50% 보통 · 50.01% 나쁨');
    ok(near(S.starLimit({ ...base, cloudPct: 37 }).cloud.clearFraction, 0.63, 1e-12), '가려지지 않는 몫 = 1 − 운량');
  }

  // ── [8] 박명과 단조 ──
  console.log('\n[8] 박명 · 단조');
  {
    const base = { cloudPct: 0, sunAltDeg: -30, moonAltDeg: -20, moonIllum: 0.5, lightPollutionMag: 5.5, aod550: 0.1 };
    const tw = S.starLimit({ ...base, sunAltDeg: -9 });
    ok(tw.twilight && tw.twilight.deltaMag < -4 && tw.limitMag < 1.5 && tw.keyStep === 'twilight', `해 −9°: 박명이 한계를 ${tw.limitMag.toFixed(2)} 등급까지 깎는다(박명 줄어든 ${tw.twilight.deltaMag.toFixed(2)})`);
    const wantTw17 = nelmRef(sbRef(nlRef(S.SKY_NATURAL_SB) + (nlRef(S.twilightSb(-17)) - nlRef(S.SKY_NATURAL_SB)))) - 6.5;
    ok(near(S.starLimit({ ...base, sunAltDeg: -17 }).twilight.deltaMag, wantTw17, 1e-9) && S.starLimit({ ...base, sunAltDeg: -18.5 }).twilight === null, `해 −17° 의 박명 줄어든 ${wantTw17.toFixed(3)}(독립 식), −18.5° 는 박명 단계 없음`);
    const mono = (f, vals) => { let prev = Infinity; for (const v of vals) { const m = f(v); if (m > prev + 1e-12) return false; prev = m; } return true; };
    ok(mono(v => S.starLimit({ ...base, moonAltDeg: 45, moonIllum: v }).limitMag, [0, 0.1, 0.3, 0.5, 0.8, 1]), '달이 밝을수록(0→1) 한계등급이 낮아진다');
    ok(mono(v => S.starLimit({ ...base, lightPollutionMag: v }).limitMag, [6.5, 6, 5, 4, 3.5, 3]), '빛 공해가 클수록(지도 6.5 → 3.0) 한계등급이 낮아진다');
    ok(mono(v => S.starLimit({ ...base, aod550: v }).limitMag, [0.05, 0.1, 0.3, 0.6, 1, 1.6]), 'AOD 가 클수록 한계등급이 낮아진다');
    ok(mono(v => S.starLimit({ ...base, sunAltDeg: v }).limitMag, [-30, -19, -16, -12, -8, -4, 0]), '해가 높을수록 한계등급이 낮아진다');
    ok(S.starLimit({ cloudPct: 0, sunAltDeg: -3, moonAltDeg: 60, moonIllum: 1, lightPollutionMag: 3, aod550: 2 }).limitMag >= 0, '모든 것이 나빠도 한계등급은 0 아래로 안 간다');
  }

  // ── [9] 달 지는 시각 ──
  console.log('\n[9] 달 지는 시각');
  {
    const t0 = Date.parse('2026-11-24T10:00:00Z'), H = 3600e3;
    const alt = (ms) => 30 * Math.cos((2 * Math.PI * (ms - t0)) / (24 * H));
    const want = t0 + (Math.acos(-0.5 / 30) / (2 * Math.PI / 24)) * H;
    const got = S.findMoonSet(t0, alt);
    ok(got !== null && Math.abs(got - want) <= 60e3, `합성 곡선: 찾은 ${(got - t0) / H} h, 해석해 ${((want - t0) / H).toFixed(4)} h (1 분 안)`);
    ok(S.findMoonSet(t0 + 8 * H, alt) === null, '이미 지평선 아래면 null');
    ok(S.findMoonSet(t0, alt, 4) === null, '정해진 시간(4 시간) 안에 안 지면 null');
    // 실제 달(서울): 0.5 초 걸음 독립 탐색
    const LAT = 37.5665, LON = 126.978;
    const real = (ms) => M.getMoonPositionPrecise(new Date(ms), LAT, LON, 0).altitude * R2D;
    // 달이 5° 넘게 떠 있는 첫 시각을 1 시간 걸음으로 3 일 안에서 찾는다(같은 시각만 보면 그 시각에 달이 아직 안 떴을 수 있다)
    let found = null;
    for (let ms = Date.parse('2026-11-24T00:00:00Z'); ms < Date.parse('2026-11-27T00:00:00Z') && found === null; ms += H) if (real(ms) > 5) found = ms;
    ok(found !== null, `달이 떠 있는 출발 시각을 찾았다(${found !== null ? new Date(found).toISOString().slice(0, 16) : '없음'}Z)`);
    const gs = S.findMoonSet(found, real);
    let brute = null;
    for (let ms = found; ms < found + 16 * H; ms += 30e3) if (real(ms) <= -0.5) { brute = ms; break; }
    ok(gs !== null && brute !== null && Math.abs(gs - brute) <= 60e3, `실제 달: 찾은 ${new Date(gs).toISOString().slice(11, 16)}Z, 30 초 걸음 독립 탐색 ${new Date(brute).toISOString().slice(11, 16)}Z (1 분 안)`);
  }

  // ── [10] 달 없는 한계와 구간 ──
  console.log('\n[10] 달 없는 한계, 구간');
  {
    const inp = { cloudPct: 10, sunAltDeg: -30, moonAltDeg: 40, moonIllum: 0.87, lightPollutionMag: 5.3, aod550: 0.25 };
    const nm = S.limitWithoutMoon(inp);
    ok(nm === S.starLimit({ ...inp, moonAltDeg: -10 }).limitMag && nm > S.starLimit(inp).limitMag, `달 없는 한계 ${nm.toFixed(2)} 는 달이 떠 있을 때 ${S.starLimit(inp).limitMag.toFixed(2)} 보다 높다`);
    ok(S.limitWithoutMoon({ ...inp, moonAltDeg: -20 }) === S.starLimit({ ...inp, moonAltDeg: -20 }).limitMag, '달이 이미 없으면 같다');
    ok(S.seeLevel(6) === 'darkest' && S.seeLevel(5.99) === 'milkyway' && S.seeLevel(5) === 'milkyway' && S.seeLevel(4.99) === 'constellations' && S.seeLevel(4) === 'constellations' && S.seeLevel(3.99) === 'bright' && S.seeLevel(3) === 'bright' && S.seeLevel(2.99) === 'few', '보이는 정도 구간 경계: 6 · 5 · 4 · 3');
  }

  console.log(`\n${fail === 0 ? '모두 통과' : '실패 있음'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
