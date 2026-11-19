/**
 * **달 위치·출몰이 하늘과 맞는가** — 판정. 브라우저가 필요 없습니다.
 *
 * 앱의 달(`src/utils/moonPosition.ts`, Meeus 47 장 주기항 + 관측지 시차 + 굴절)을 앱 밖의 자,
 * astronomy-engine 표(`fixtures/moon-ref.json`, 만드는 법은 옆의 `moon-ref.js`)에 댑니다.
 *
 * 먼저 정한 줄:
 *  1. 위치 — 표 576점에서 겉보기 위치가 0.01° 안(달 반지름 0.26° 의 4%), 기하 고도도 0.01° 안.
 *     (겉보기 고도 −1° 밑은 굴절 끝처리가 달라 기하 고도로만 견줍니다.)
 *  2. 지평 근처 표본이 충분하다 — 시차(최대 0.95°)가 큰 고도 3° 밑이 20점 넘게 1 에 들어 있다.
 *  3. 출몰 — 96일의 월출·월몰이 astronomy-engine 과 **각으로** 0.08° 안. 문턱의 근거: 엔진은 기하 고도
 *     −(34′ + 반지름) 를, 앱은 하늘에 그리는 Sæmundsson 굴절(그 고도에서 37′)을 씁니다. 3′ = 0.05° 의 정의 차이와
 *     0.03° 의 여유. 시각 차는 그 순간 달 고도가 변하는 빠르기를 곱해 각으로 바꿉니다(고위도에서 같은 각이
 *     몇 배 시간으로 부풀기 때문).
 *  4. 출몰은 **같은 위치 함수의 근** — 월출·월몰 시각에 겉보기 고도 + 반지름 = 0 ± 0.002°, 월출은 오르는 중.
 *     3D 달과 앱이 알리는 월출이 정의상 같은 순간이라는 뜻입니다.
 *  5. 달 굴절은 해의 굴절(`sunsetPhysics.getApparentAltitude`)과 같은 식 — 해와 달이 같은 곳에 걸리는지 판정할 때
 *     두 굴절이 다르면 지평 근처에서 밀립니다.
 *  6. 모양은 SunCalc 과 같다 — 방위 남쪽 0 서쪽 +, 고도는 굴절 포함. 옛 식의 오차(≲ 3.5°) 안에서 일치(부호·180° 뒤집힘 방지).
 *  7. 지심 거리가 근지점·원지점(356,000 ~ 407,000 km) 안, 겉보기 반지름이 0.259° 근처.
 *  8. 마지막 결과 캐시가 다른 시각을 오염시키지 않는다(A → B → A).
 *
 * 대조(옛 SunCalc 은 걸려야 합니다 — 자가 공허하지 않다는 증거):
 *  A. SunCalc.getMoonPosition 은 1 의 문턱을 100배 넘게 어긋난다(최대 3° 대).
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-moon-position.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const RAD = Math.PI / 180;
const sep = (a1, e1, a2, e2) => {
  const c = Math.sin(e1 * RAD) * Math.sin(e2 * RAD) + Math.cos(e1 * RAD) * Math.cos(e2 * RAD) * Math.cos((a1 - a2) * RAD);
  return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
};

(async () => {
  const MP = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'moonPosition.js'));
  const SP = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'sunsetPhysics.js'));
  const SunCalc = require(path.join(__dirname, '..', '..', 'node_modules', 'suncalc'));
  const REF = require('./fixtures/moon-ref.json');
  console.log(`  자: ${REF.source}`);

  // ── [1][2] 위치 ──────────────────────────────────────────────────────
  console.log('\n[1] 위치 — astronomy-engine 표와 견줌');
  let worstApp = 0, worstAppAt = '', worstGeo = 0, worstGeoAt = '', nApp = 0, nLow = 0, worstSC = 0, worstShape = 0, worstShapeAt = '', nShape = 0;
  let minDist = Infinity, maxDist = 0;
  for (const r of REF.positions) {
    const d = new Date(r.iso);
    const p = MP.getMoonPositionPrecise(d, r.lat, r.lon, 0);
    const alt = p.altitude / RAD, az = p.azimuth / RAD + 180;
    const geo = Math.abs(p.geometricAltitude / RAD - r.altGeoDeg);
    if (geo > worstGeo) { worstGeo = geo; worstGeoAt = `${r.place} ${r.iso}`; }
    minDist = Math.min(minDist, p.distance); maxDist = Math.max(maxDist, p.distance);
    if (r.altDeg > -1) {
      const e = sep(az, alt, r.azDeg, r.altDeg);
      if (e > worstApp) { worstApp = e; worstAppAt = `${r.place} ${r.iso}`; }
      nApp++;
      if (r.altDeg < 3) nLow++;
    }
    if (r.altDeg > 5) {
      const sc = SunCalc.getMoonPosition(d, r.lat, r.lon);
      worstSC = Math.max(worstSC, sep(sc.azimuth / RAD + 180, sc.altitude / RAD, r.azDeg, r.altDeg));
      // 모양: 방위·고도 각각이 옛 식의 오차 안에서 일치
      const dAz = Math.abs((((az - (sc.azimuth / RAD + 180)) % 360) + 540) % 360 - 180);
      const dAlt = Math.abs(alt - sc.altitude / RAD);
      const w = Math.max(dAz * Math.cos(r.altDeg * RAD), dAlt);
      if (w > worstShape) { worstShape = w; worstShapeAt = `${r.place} ${r.iso}`; }
      nShape++;
    }
  }
  console.log(`      겉보기 ${nApp}점 — 최대 ${worstApp.toFixed(4)}° (${worstAppAt}) · 기하 고도 ${REF.positions.length}점 최대 ${worstGeo.toFixed(4)}° (${worstGeoAt})`);
  console.log(`      대조 SunCalc: 최대 ${worstSC.toFixed(3)}°`);
  ok(worstApp < 0.01, `겉보기 위치가 0.01° 안 (${worstApp.toFixed(4)}°)`);
  ok(worstGeo < 0.01, `기하 고도가 0.01° 안 (${worstGeo.toFixed(4)}°)`);
  ok(worstSC > 1, `대조 A — SunCalc 은 걸린다 (${worstSC.toFixed(2)}° > 1°)`);
  console.log('\n[2] 시차가 큰 지평 근처 표본');
  ok(nLow > 20, `고도 3° 밑 표본 ${nLow}점 (> 20)`);

  // ── [3][4] 출몰 ──────────────────────────────────────────────────────
  console.log('\n[3] 월출·월몰 — astronomy-engine 과 견줌');
  {
    let worstDeg = 0, worstAt = '', n = 0, missing = 0, extra = 0, worstRoot = 0, risingBad = 0, nRise = 0;
    for (const e of REF.events) {
      const start = Date.parse(e.startIso);
      const M = MP.moonRiseSet(start, e.lat, e.lon, 24, 0);
      const altAt = (ms) => { const q = MP.getMoonPositionPrecise(new Date(ms), e.lat, e.lon, 0); return { alt: q.altitude / RAD, sd: MP.moonSemidiameterDeg(q.distance) }; };
      for (const [k, ref, mine] of [['rise', e.riseIso, M.rise], ['set', e.setIso, M.set]]) {
        if (ref && mine) {
          const tRef = Date.parse(ref);
          const rate = Math.abs(altAt(tRef + 30e3).alt - altAt(tRef - 30e3).alt) / 60;   // °/초
          const deg = Math.abs(mine.getTime() - tRef) / 1000 * rate;
          if (deg > worstDeg) { worstDeg = deg; worstAt = `${e.place} ${k} ${ref}`; }
          n++;
        } else if (ref && !mine) {
          // 창 가장자리 10분 안이면 눈금 차이로 봅니다
          const edge = Math.min(Math.abs(Date.parse(ref) - start), Math.abs(start + 86400e3 - Date.parse(ref)));
          if (edge > 600e3) missing++;
        } else if (!ref && mine) {
          const edge = Math.min(Math.abs(mine.getTime() - start), Math.abs(start + 86400e3 - mine.getTime()));
          if (edge > 600e3) extra++;
        }
        if (mine) {
          const a = altAt(mine.getTime());
          worstRoot = Math.max(worstRoot, Math.abs(a.alt + a.sd));
          if (k === 'rise') { nRise++; if (!(altAt(mine.getTime() + 60e3).alt > a.alt)) risingBad++; }
        }
      }
    }
    console.log(`      ${n}쌍 — 최대 ${worstDeg.toFixed(4)}° (${worstAt}) · 엔진에만/앱에만 있는 출몰 ${missing}/${extra}`);
    ok(worstDeg < 0.08, `출몰이 각으로 0.08° 안 (${worstDeg.toFixed(4)}°)`);
    ok(missing === 0 && extra === 0, `엔진에만 있거나 앱에만 있는 출몰이 없다 (${missing}/${extra})`);
    console.log('\n[4] 출몰은 같은 위치 함수의 근');
    ok(worstRoot < 0.002, `출몰 시각에 겉보기 고도 + 반지름 = 0 ± 0.002° (최대 ${worstRoot.toFixed(5)}°)`);
    ok(risingBad === 0 && nRise > 40, `월출 ${nRise}건은 모두 오르는 중`);
  }

  // ── [5] 굴절 ─────────────────────────────────────────────────────────
  console.log('\n[5] 달 굴절 = 해 굴절');
  {
    let worst = 0;
    for (let h = -8; h <= 90; h += 0.37) worst = Math.max(worst, Math.abs(MP.refractionDeg(h) - (SP.getApparentAltitude(h) - h)));
    ok(worst < 1e-9, `−8° ~ 90° 에서 sunsetPhysics.getApparentAltitude 와 같다 (최대 차 ${worst.toExponential(1)}°)`);
  }

  // ── [6][7][8] 모양·거리·캐시 ────────────────────────────────────────────
  console.log('\n[6] SunCalc 과 같은 모양');
  ok(worstShape < 4, `고도 5° 위 ${nShape}점에서 방위·고도가 옛 식과 4° 안 (최대 ${worstShape.toFixed(2)}°, ${worstShapeAt})`);
  console.log('\n[7] 거리·반지름');
  ok(minDist > 356000 && maxDist < 407000, `지심 거리 ${minDist.toFixed(0)} ~ ${maxDist.toFixed(0)} km 가 근지점·원지점 안`);
  const sd = MP.moonSemidiameterDeg(384400);
  ok(Math.abs(sd - 0.2593) < 0.001, `평균 거리의 겉보기 반지름 ${sd.toFixed(4)}° ≈ 0.259°`);
  console.log('\n[8] 캐시');
  {
    const A = new Date('2026-11-19T12:00:00Z'), B = new Date('2026-11-27T03:00:00Z');
    const a1 = MP.getMoonPositionPrecise(A, 37.5, 127, 0);
    const b1 = MP.getMoonPositionPrecise(B, 37.5, 127, 0);
    const a2 = MP.getMoonPositionPrecise(A, 37.5, 127, 0);
    ok(a1.altitude === a2.altitude && a1.azimuth === a2.azimuth && a1.altitude !== b1.altitude, 'A → B → A 가 같은 A 를 낸다');
    const g = MP.moonGeocentric(A);
    ok(MP.moonGeocentric(A) === g, '같은 시각 두 번째 호출은 캐시를 돌려준다');
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
