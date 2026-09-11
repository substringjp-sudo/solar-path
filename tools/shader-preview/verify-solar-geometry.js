/**
 * **등치선과 태양경로가 같은 기하인가** 합격 판정. 브라우저가 필요 없습니다.
 *
 * 무엇을 왜 하는지는 `src/utils/solarGeometry.ts` 머리말에 있습니다.
 *
 * ## 이 자가 순환하지 않는 이유
 *
 * 모듈은 등고도선 방위를 `태양방위 + 90°` 로 **씁니다**. 그걸 그대로 견주면
 * 항등식을 주장만 하고 재지는 않습니다. 그래서 여기서는 **고도장의 수치
 * 기울기**로 등고도선 방위를 따로 구해 견줍니다 — 모듈이 틀리면 걸립니다.
 *
 * 태양 방위도 마찬가지입니다. 앱의 `getSunPosition` 은 **SunCalc**(별도 구현)
 * 이고, 직하점은 NOAA 저정밀도 식입니다. 둘은 독립이므로 견주는 뜻이 있습니다.
 *
 * ## ⚠ 방위 잔차는 **조건수를 되돌리고** 봅니다
 *
 * 어떤 점으로의 방위는 그 점이나 그 **대척점**에 가까우면 정의가 무뎌집니다.
 * 증폭률이 `1/sin(각거리)` 라, 직하점에서 13° 나 167° 인 자리에서는 4.4배로
 * 부풀어 오릅니다. 실제로 재니 `잔차 × sin(각거리)` 가 56표본 전부에서
 * **0.175~0.213°** 로 일정했습니다(원시 잔차는 0.29°~0.92°). 남은 것은 전부
 * 저정밀 식의 위치 오차가 기하적으로 증폭된 것이지 결함이 아닙니다.
 *
 * 그래서 문턱을 푸는 대신 **증폭을 되돌려** 봅니다. 이렇게 해도 실제 결함은
 * 잡힙니다 — 아래 경사각 결함은 위치 오차 자체가 1.27° 였습니다.
 *
 * ## ⚠ 이 자가 첫 판에 잡은 것
 *
 * `celestial.ts` 의 황도경사각이 **365배 빠르게 줄고** 있었습니다. 감소율
 * 0.0130042° 는 **율리우스 세기당**인데 코드가 그것을 **하루마다** 빼고
 * 있었습니다(`0.000130043 * d`). 2026년(d≈9,750)이면 경사각이 23.44° 가
 * 아니라 22.17° 라, 하지 적위가 **1.27°** 어긋났습니다 — 지도의 등치선이
 * 위도로 약 140km 밀리고 해마다 0.13° 씩 더 밀리던 값입니다. 고친 뒤
 * 하지 잔차 1.28° → **0.003°**.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-solar-geometry.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

const PLACES = [
  ['서울', 37.5665, 126.978], ['시드니', -33.8688, 151.2093],
  ['런던', 51.5072, -0.1276], ['나이로비', -1.2921, 36.8219],
  ['레이캬비크', 64.1466, -21.9426], ['키토', -0.1807, -78.4678],
  ['부에노스아이레스', -34.6037, -58.3816], ['호놀룰루', 21.3069, -157.8583],
];
const TIMES = [
  '2026-09-11T00:00:00Z', '2026-09-11T06:00:00Z', '2026-09-11T12:00:00Z',
  '2026-09-11T18:00:00Z', '2026-03-20T15:00:00Z', '2026-06-21T03:00:00Z',
  '2026-12-21T21:00:00Z',
];

(async () => {
  const G = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'solarGeometry.js'));
  const C = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'celestial.js'));
  const {
    angularDistanceDeg, bearingDeg, isoAltitudeBearingDeg, sunAltitudeFromSubsolar,
    lineRayAngleDeg, getSunFan, isIsolineScale, sunriseSpreadMinutes,
    LOCAL_CROSSOVER_DELTA_DEG, destinationPoint, buildSunOverlay,
  } = G;
  const { getSubsolarPoint, getSunPosition } = C;

  // ── [1] 태양 방위 == 직하점으로의 방위 ───────────────────────────────
  //    왼쪽은 SunCalc, 오른쪽은 NOAA 직하점. **독립된 두 구현**입니다.
  console.log('\n[1] 태양 방위 = 직하점으로의 대권 방위 (SunCalc vs NOAA)');
  {
    let raw = 0, rawAt = '', corr = 0, corrAt = '', maxAmp = 0;
    for (const iso of TIMES) {
      const d = new Date(iso);
      const s = getSubsolarPoint(d);
      for (const [n, la, lo] of PLACES) {
        const az = getSunPosition(d, la, lo).azimuth;
        const br = bearingDeg(la, lo, s.latitude, s.longitude);
        let diff = (((az - br) % 360) + 360) % 360;
        if (diff > 180) diff -= 360;
        diff = Math.abs(diff);
        const dist = angularDistanceDeg(la, lo, s.latitude, s.longitude);
        const sinD = Math.sin(dist * Math.PI / 180);
        if (diff > raw) { raw = diff; rawAt = `${n} ${iso} 거리 ${dist.toFixed(0)}°`; }
        if (diff * sinD > corr) { corr = diff * sinD; corrAt = `${n} ${iso}`; }
        if (1 / sinD > maxAmp) maxAmp = 1 / sinD;
      }
    }
    console.log(`      표본 ${TIMES.length * PLACES.length}개 · 원시 잔차 최대 ${raw.toFixed(3)}° (${rawAt})`);
    console.log(`      증폭 되돌린 잔차 최대 ${corr.toFixed(3)}° · 최대 증폭 ${maxAmp.toFixed(1)}배`);
    ok(corr < 0.25, `두 독립 구현의 위치가 맞는다 — 증폭 되돌린 잔차 ${corr.toFixed(3)}° < 0.25° (${corrAt})`);
    ok(maxAmp > 3, `표본에 조건이 나쁜 자리가 들어 있다 (최대 ${maxAmp.toFixed(1)}배) — 되돌림이 공허하지 않다`);
  }

  // ── [2] 고도 = 90 − 각거리 ──────────────────────────────────────────
  console.log('\n[2] 고도 = 90° − 직하점까지의 각거리');
  {
    let worst = 0;
    for (const iso of TIMES) {
      const d = new Date(iso);
      for (const [, la, lo] of PLACES) {
        // SunCalc 은 대기굴절을 안 넣은 기하 고도를 줍니다 — 바로 견줄 수 있습니다.
        const diff = Math.abs(getSunPosition(d, la, lo).altitude - sunAltitudeFromSubsolar(d, la, lo));
        if (diff > worst) worst = diff;
      }
    }
    console.log(`      최대 잔차 ${worst.toFixed(4)}°`);
    ok(worst < 0.25, `각거리로 낸 고도가 SunCalc 과 맞는다 (${worst.toFixed(4)}° < 0.25°)`);
  }

  // ── [3] ⚠ 직교를 **재서** 확인합니다 (수치 기울기) ────────────────────
  console.log('\n[3] 등고도선 ⟂ 태양 방위 — 고도장의 수치 기울기로 잰다');
  {
    /** 고도가 오르는 방향의 방위를 유한차분으로 냅니다. */
    // ⚠ 남북·동서에 **같은** 반지름을 써야 합니다. 처음에 타원체 상수를
    //   섞어 썼더니(남북 110.54 / 동서 111.32 km/°) 기울기가 0.198° 회전해,
    //   모듈이 틀린 것처럼 보였습니다. 고도장은 구면이라 단위가 약분됩니다.
    //   고친 뒤 모듈과의 잔차가 0.198° → 0.0000° 가 됐습니다.
    const gradBearing = (d, la, lo) => {
      const e = 0.01;
      const dN = (sunAltitudeFromSubsolar(d, la + e, lo) - sunAltitudeFromSubsolar(d, la - e, lo)) / (2 * e);
      const dE = (sunAltitudeFromSubsolar(d, la, lo + e) - sunAltitudeFromSubsolar(d, la, lo - e))
               / (2 * e * Math.cos(la * Math.PI / 180));
      return (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360;
    };
    let worst = 0, n = 0, worstAt = '';
    for (const iso of TIMES) {
      const d = new Date(iso);
      for (const [nm, la, lo] of PLACES) {
        // 극 근처는 유한차분이 무너집니다 — 그건 자의 한계지 모듈의 결함이 아닙니다.
        if (Math.abs(la) > 66) continue;
        const measured = (gradBearing(d, la, lo) + 90) % 180;   // 잰 등고도선
        const fromModule = isoAltitudeBearingDeg(d, la, lo);     // 모듈이 쓰는 값
        let diff = Math.abs((((measured - fromModule) % 180) + 180) % 180);
        diff = Math.min(diff, 180 - diff);
        if (diff > worst) { worst = diff; worstAt = `${nm} ${iso}`; }
        n++;
      }
    }
    console.log(`      표본 ${n}개 · 최대 잔차 ${worst.toFixed(3)}° (${worstAt})`);
    ok(worst < 0.01, `모듈의 해석해가 수치 기울기와 **정확히** 맞는다 (${worst.toFixed(4)}° < 0.01°)`);

    // 그리고 그것이 태양 방위와 직교하는가 — 잰 값으로 확인합니다.
    let worstPerp = 0, worstPerpCorr = 0;
    for (const iso of TIMES) {
      const d = new Date(iso);
      const s = getSubsolarPoint(d);
      for (const [, la, lo] of PLACES) {
        if (Math.abs(la) > 66) continue;
        const measured = (gradBearing(d, la, lo) + 90) % 180;
        const az = getSunPosition(d, la, lo).azimuth;
        const off = Math.abs(lineRayAngleDeg(measured, az) - 90);
        const sinD = Math.sin(angularDistanceDeg(la, lo, s.latitude, s.longitude) * Math.PI / 180);
        if (off > worstPerp) worstPerp = off;
        if (off * sinD > worstPerpCorr) worstPerpCorr = off * sinD;
      }
    }
    console.log(`      잰 등고도선과 태양 방위: 90° 에서 원시 최대 ${worstPerp.toFixed(3)}° · 되돌려 ${worstPerpCorr.toFixed(3)}°`);
    ok(worstPerpCorr < 0.25, `잰 등고도선이 태양 방위와 직교한다 (되돌린 ${worstPerpCorr.toFixed(3)}° < 0.25°)`);
  }

  // ── [4] ⚠ 음성 대조 — 틀린 구현이면 걸리는가 ─────────────────────────
  //    위 판정이 무엇이든 통과시키는 자가 아님을 보입니다.
  console.log('\n[4] 음성 대조 — 일부러 틀린 값은 걸리는가');
  {
    const d = new Date('2026-09-11T06:00:00Z');
    const la = 37.5665, lo = 126.978;
    const right = isoAltitudeBearingDeg(d, la, lo);
    const az = getSunPosition(d, la, lo).azimuth;
    ok(Math.abs(lineRayAngleDeg(right, az) - 90) < 0.5, `바른 값은 직교로 읽힌다`);
    ok(Math.abs(lineRayAngleDeg((right + 30) % 180, az) - 90) > 5,
       `30° 틀어 놓으면 직교가 깨진다 — 자가 아무거나 통과시키지 않는다`);
    ok(Math.abs(lineRayAngleDeg(az % 180, az) - 90) > 80,
       `방위를 그대로 등고도선이라 하면 0° 로 읽힌다 (평행 — 90° 에서 멀다)`);
  }

  // ── [5] 문턱의 근거 — 화면 안 일출 시각이 얼마나 벌어지나 ──────────────
  console.log('\n[5] 등치선이 죽는 축척 — 고른 게 아니라 잰 값인가');
  {
    const d = new Date('2026-09-11T00:00:00Z');
    const la = 37.4863, lo = 127.0443;
    const ISOLINE_STEP_MIN = 30;             // 앱이 그 아래에서 쓰는 간격
    const rows = [5, 2, 1, 0.5, 0.2, 0.1];
    const got = {};
    for (const dlt of rows) {
      const m = sunriseSpreadMinutes(d, la, lo, dlt);
      got[dlt] = m;
      console.log(`      화면 폭 ${String(dlt).padStart(4)}° (${String(Math.round(dlt * 111)).padStart(4)}km) → 일출 시각 차 ${m === null ? '—' : m.toFixed(0) + '분'}`);
    }
    ok(got[5] > ISOLINE_STEP_MIN * 0.6,
       `5° 에서는 등치선이 살아 있다 (${got[5].toFixed(0)}분)`);
    ok(got[LOCAL_CROSSOVER_DELTA_DEG] < ISOLINE_STEP_MIN,
       `문턱 ${LOCAL_CROSSOVER_DELTA_DEG}° 에서 간격(${ISOLINE_STEP_MIN}분)보다 작아진다 (${got[1].toFixed(0)}분)`);
    ok(got[0.1] < 1, `0.1° 에서는 화면 전체가 1분 안쪽이다 (${got[0.1].toFixed(2)}분)`);
    // 단조 — 좁힐수록 반드시 줄어야 합니다.
    let mono = true;
    for (let i = 1; i < rows.length; i++) if (got[rows[i]] > got[rows[i - 1]]) mono = false;
    ok(mono, `좁힐수록 시각 차가 단조로 줄어든다`);
  }

  // ── [6] 축척 문 — 씬과 판정이 같은 함수를 본다 ───────────────────────
  console.log('\n[6] 축척 문');
  {
    ok(isIsolineScale(60) === true, `60° 는 등치선 축척`);
    ok(isIsolineScale(LOCAL_CROSSOVER_DELTA_DEG) === true, `문턱 자신은 등치선 쪽에 든다`);
    ok(isIsolineScale(0.5) === false, `0.5° 는 태양 방위 축척`);
    ok(isIsolineScale(0.02) === false, `0.02° 는 태양 방위 축척`);
  }

  // ── [7] 태양 부채 ───────────────────────────────────────────────────
  console.log('\n[7] 지도에 얹을 태양 방위 부채');
  {
    const d = new Date('2026-09-11T09:00:00Z');   // 서울 18시
    const f = getSunFan(d, 37.4863, 127.0443);
    console.log(`      서울 9/11 — 일출 ${f.riseAz?.toFixed(1)}° · 지금 ${f.nowAz.toFixed(1)}°(고도 ${f.nowAlt.toFixed(1)}°) · 일몰 ${f.setAz?.toFixed(1)}°`);
    ok(f.riseAz !== null && f.setAz !== null, `보통 위도에서는 일출·일몰 방위가 나온다`);
    ok(f.riseAz > 60 && f.riseAz < 120, `9월 서울 일출은 동쪽 근처 (${f.riseAz.toFixed(1)}°)`);
    ok(f.setAz > 240 && f.setAz < 300, `9월 서울 일몰은 서쪽 근처 (${f.setAz.toFixed(1)}°)`);
    ok(Math.abs(f.nowAz - getSunPosition(d, 37.4863, 127.0443).azimuth) < 1e-9,
       `지금 방위가 앱의 태양 위치와 같은 값이다`);

    // ⚠ 백야 — 일출·일몰이 없어도 죽지 않아야 합니다.
    const polar = getSunFan(new Date('2026-06-21T12:00:00Z'), 78.0, 15.0);
    console.log(`      스발바르 하지 — 일출 ${polar.riseAz} · 일몰 ${polar.setAz} · 지금 ${polar.nowAz.toFixed(1)}°(고도 ${polar.nowAlt.toFixed(1)}°)`);
    ok(polar.riseAz === null && polar.setAz === null, `백야에서는 일출·일몰이 null`);
    ok(Number.isFinite(polar.nowAz) && polar.nowAlt > 0, `그래도 지금 방위·고도는 나온다 — 화살표는 그릴 수 있다`);
  }

  // ── [8] 목적점 ─────────────────────────────────────────────────────
  console.log('\n[8] 방위·거리로 간 점');
  {
    let worstD = 0, worstB = 0;
    for (const [, la, lo] of PLACES) {
      for (const br of [0, 37, 90, 175, 268, 359]) {
        for (const dist of [0.01, 0.5, 10, 80]) {
          const p = destinationPoint(la, lo, br, dist);
          worstD = Math.max(worstD, Math.abs(angularDistanceDeg(la, lo, p.latitude, p.longitude) - dist));
          let db = Math.abs(((bearingDeg(la, lo, p.latitude, p.longitude) - br) % 360 + 360) % 360);
          if (db > 180) db = 360 - db;
          worstB = Math.max(worstB, db);
        }
      }
    }
    console.log(`      왕복 — 거리 오차 최대 ${worstD.toExponential(1)}° · 방위 오차 최대 ${worstB.toExponential(1)}°`);
    ok(worstD < 1e-9, `간 거리가 요청한 거리와 같다`);
    ok(worstB < 1e-9, `간 방향이 요청한 방위와 같다`);
  }

  // ── [9] 지도 오버레이 ──────────────────────────────────────────────
  console.log('\n[9] 지도에 얹을 오버레이');
  {
    const d = new Date('2026-09-11T09:00:00Z');
    const la = 37.4863, lo = 127.0443;

    ok(buildSunOverlay(d, la, lo, 60) === null, `넓은 축척(60°)에서는 안 그린다`);
    ok(buildSunOverlay(d, la, lo, LOCAL_CROSSOVER_DELTA_DEG) === null, `문턱 자신도 안 그린다`);
    const ov = buildSunOverlay(d, la, lo, 0.3);
    ok(ov !== null, `0.3° 에서는 그린다`);

    // 등고도선 위의 점들이 **정말로 같은 고도**인가 — 이게 이 선의 정의입니다.
    const altHere = sunAltitudeFromSubsolar(d, la, lo);
    let worstAlt = 0;
    for (const p of ov.isoLine) {
      worstAlt = Math.max(worstAlt, Math.abs(sunAltitudeFromSubsolar(d, p.latitude, p.longitude) - altHere));
    }
    console.log(`      등고도선 16점의 고도 편차 최대 ${worstAlt.toExponential(1)}° (중심 고도 ${altHere.toFixed(2)}°)`);
    ok(worstAlt < 1e-9, `등고도선 위 모든 점의 고도가 같다 — 이름값을 한다`);

    // ⚠ 대조 — 직선 측지선으로 근사했다면 얼마나 어긋났을까.
    //    이 값이 0 이면 "제대로 그렸다" 는 말이 공허합니다.
    const isoB = isoAltitudeBearingDeg(d, la, lo);
    let worstNaive = 0;
    for (const f of [-1, 1]) {
      const p = destinationPoint(la, lo, isoB + (f < 0 ? 180 : 0), ov.spanDeg);
      worstNaive = Math.max(worstNaive, Math.abs(sunAltitudeFromSubsolar(d, p.latitude, p.longitude) - altHere));
    }
    console.log(`      직선으로 근사했다면 끝점 고도가 ${worstNaive.toExponential(1)}° 어긋남 (0.3° 화면)`);
    const wide = buildSunOverlay(d, la, lo, 0.99);
    let worstNaiveWide = 0;
    for (const f of [-1, 1]) {
      const p = destinationPoint(la, lo, isoB + (f < 0 ? 180 : 0), wide.spanDeg);
      worstNaiveWide = Math.max(worstNaiveWide, Math.abs(sunAltitudeFromSubsolar(d, p.latitude, p.longitude) - altHere));
    }
    console.log(`      같은 근사를 0.99° 화면에 쓰면 ${worstNaiveWide.toExponential(1)}° 어긋남`);
    ok(worstNaiveWide > worstAlt * 10 || worstNaiveWide > 1e-6,
       `직선 근사는 실제로 어긋난다 — 소원으로 그린 것이 공허하지 않다`);

    // 반직선의 방위가 부채 값과 같은가.
    const rayB = bearingDeg(la, lo, ov.nowRay[1].latitude, ov.nowRay[1].longitude);
    ok(Math.abs(rayB - ov.fan.nowAz) < 1e-6, `지금 방향 반직선이 태양 방위를 가리킨다`);
    ok(ov.riseRay && ov.setRay, `보통 위도에서는 일출·일몰 반직선이 있다`);

    // 길이가 화면 폭을 따라가는가.
    const a = buildSunOverlay(d, la, lo, 0.2), b = buildSunOverlay(d, la, lo, 0.8);
    ok(b.spanDeg > a.spanDeg * 3, `화면이 넓어지면 선도 길어진다 (${a.spanDeg.toFixed(3)}° → ${b.spanDeg.toFixed(3)}°)`);

    // ⚠ 백야 — 반직선 둘이 없어도 화살표와 등고도선은 나와야 합니다.
    const polar = buildSunOverlay(new Date('2026-06-21T12:00:00Z'), 78, 15, 0.3);
    ok(polar !== null && polar.riseRay === null && polar.setRay === null,
       `백야에서는 일출·일몰 반직선이 없다`);
    ok(polar.isoLine.length > 2 && Number.isFinite(polar.nowRay[1].latitude),
       `그래도 등고도선과 지금 방향은 그려진다`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
