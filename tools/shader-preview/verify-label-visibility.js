/**
 * **3D 라벨이 "지금 맨눈에 보이는 것" 만 가리키는가** (2026-09-30) — 판정. 브라우저가 필요 없습니다.
 *
 * 사용자: "낮에는 행성이 안보이는데 라벨 보이는게 번거롭고 달도 낮에 보일때만 보여졌으면 좋겠어."
 * 예전: 행성은 지평선 위면, 달은 화면 안이면(지평선 아래여도) 라벨을 띄웠습니다.
 *
 * 먼저 정한 줄(서울, 2026년 9~10월, 한 시간 간격 실제 천체력):
 *  1. 해가 떠 있는(고도 > 0°) 시각에는 행성 라벨이 **하나도** 없다.
 *  2. 대조군 — 밤에는 행성 라벨이 실제로 나온다(규칙이 전부 막아 버리지 않았는지). 한 달 중 밤 시각의
 *     절반 이상에서 적어도 하나.
 *  3. 달 라벨은 달이 지평선 아래일 때 **한 번도** 나오지 않는다.
 *  4. 대조군 — 낮달: 상현 무렵 오후에는 달 라벨이 나온다(낮이라고 전부 숨기지 않는다).
 *  5. 삭 전후 이틀의 낮(해 옆의 가는 달)에는 달 라벨이 나오지 않는다.
 *  6. 은하수 라벨은 해가 −15° 위일 때 나오지 않는다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-label-visibility.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const V = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'labelVisibility.js'));
  const { getCalculatedPlanets } = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'celestialPlanets.js'));
  const SunCalc = require(path.join(__dirname, '..', '..', 'node_modules', 'suncalc'));
  const LAT = 37.4863, LON = 127.0443, D = 180 / Math.PI;
  const start = Date.UTC(2026, 8, 1), end = Date.UTC(2026, 9, 31);

  const sepDeg = (a1, h1, a2, h2) => {
    const c = Math.sin(h1) * Math.sin(h2) + Math.cos(h1) * Math.cos(h2) * Math.cos(a1 - a2);
    return Math.acos(Math.max(-1, Math.min(1, c))) * D;
  };

  let dayHours = 0, dayPlanet = 0, nightHours = 0, nightWithPlanet = 0;
  let moonBelowShown = 0, moonDayShownQuarter = 0, quarterAfternoons = 0, newMoonDayShown = 0, mwBright = 0;
  for (let t = start; t < end; t += 3600e3) {
    const d = new Date(t);
    const sun = SunCalc.getPosition(d, LAT, LON), moon = SunCalc.getMoonPosition(d, LAT, LON);
    const sunAlt = sun.altitude * D, moonAlt = moon.altitude * D;
    const ill = SunCalc.getMoonIllumination(d);
    const sep = sepDeg(sun.azimuth, sun.altitude, moon.azimuth, moon.altitude);
    const planets = getCalculatedPlanets(LAT, LON, d).filter(p => ['venus', 'jupiter', 'saturn'].includes(p.key));
    const shownPlanets = planets.filter(p => V.planetLabelVisible(p.key, p.altitude, sunAlt));
    if (sunAlt > 0) { dayHours++; if (shownPlanets.length) dayPlanet++; }
    if (sunAlt < -12) { nightHours++; if (shownPlanets.length) nightWithPlanet++; }
    const moonShown = V.moonLabelVisible({ moonAltDeg: moonAlt, sunAltDeg: sunAlt, illum: ill.fraction, sepDeg: sep });
    if (moonAlt < 0 && moonShown) moonBelowShown++;
    // 상현(phase≈0.25) ±2일의 오후(현지 14~17시, 해 떠 있음, 달 20° 이상)
    const localH = (d.getUTCHours() + 9) % 24;
    if (Math.abs(ill.phase - 0.25) < 0.07 && localH >= 14 && localH <= 17 && sunAlt > 5 && moonAlt > 20) {
      quarterAfternoons++; if (moonShown) moonDayShownQuarter++;
    }
    if ((ill.phase < 0.07 || ill.phase > 0.93) && sunAlt > 5 && moonShown) newMoonDayShown++;
    // 은하수 중심(궁수자리 A* 근처, 적경 266.4°, 적위 −29°)의 고도
    const lst = (SunCalc.getPosition(d, LAT, LON), null);
    const jd = t / 864e5 + 2440587.5, gmst = (280.46061837 + 360.98564736629 * (jd - 2451545)) % 360;
    const ha = ((gmst + LON - 266.4) % 360) / D, dec = -29 / D, la = LAT / D;
    const mwAlt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) * D;
    if (V.milkyWayLabelVisible(mwAlt, sunAlt) && sunAlt > -15) mwBright++;
  }

  console.log(`\n  낮 ${dayHours}시각 · 밤 ${nightHours}시각 · 상현 오후 표본 ${quarterAfternoons}`);
  console.log('\n[1] 낮에는 행성 라벨이 없다');
  ok(dayPlanet === 0, `해가 떠 있는 ${dayHours}시각 중 행성 라벨이 나온 시각 ${dayPlanet}`);
  console.log('\n[2] 대조군 — 밤에는 행성 라벨이 나온다');
  ok(nightHours > 0 && nightWithPlanet / nightHours >= 0.5, `밤 ${nightHours}시각 중 ${nightWithPlanet}시각(${Math.round(100 * nightWithPlanet / nightHours)}%)에 행성 라벨`);
  console.log('\n[3] 지평선 아래 달에는 라벨이 없다');
  ok(moonBelowShown === 0, `지평선 아래인데 라벨이 나온 시각 ${moonBelowShown}`);
  console.log('\n[4] 대조군 — 상현 무렵 오후의 낮달은 라벨이 나온다');
  ok(quarterAfternoons > 0 && moonDayShownQuarter === quarterAfternoons, `상현 오후 ${quarterAfternoons}시각 중 ${moonDayShownQuarter}시각에 달 라벨`);
  console.log('\n[5] 삭 전후 낮의 가는 달은 라벨이 없다');
  ok(newMoonDayShown === 0, `삭 무렵 낮에 달 라벨이 나온 시각 ${newMoonDayShown}`);
  console.log('\n[6] 은하수 라벨은 해 −15° 위에서 나오지 않는다');
  ok(mwBright === 0, `박명 중 은하수 라벨 ${mwBright}`);

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
