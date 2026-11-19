/**
 * **별 보기 계산 과정의 입력(`starTonight.ts`)이 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * 앱이 해·달 위치에 쓰는 구현(`solarPosition.ts` · `moonPosition.ts`)과 **다른 구현**(SunCalc 1.9.0, node_modules)을 기준으로 삼습니다.
 * 별 보기 카드가 "달이 지는 시각" 이나 "해 고도" 를 틀리게 말하면 카드 전체가 거짓말이 되므로 입력을 따로 대어 봅니다.
 * (밝은 비율만은 앱도 SunCalc 을 쓰므로 "같은 값이 전해지는가" 를 보는 연결 확인입니다.)
 *
 * 먼저 정한 줄(돌려 보기 전):
 *  1. 별을 볼 시각 `starTimeFor`
 *     a. 해가 지평선 아래 12° 보다 깊은 시각(서울 2026-12-22 00:00)은 넘긴 시각 그대로.
 *     b. 낮 12시·해 진 시각이면 그날 저녁 SunCalc `night`(해 −18°) + 30분과 2분 안으로 같다(NOAA 식과 SunCalc 식의 차이 한계). 서울과 시드니.
 *     c. 항해 박명 사이: 해 −12° 보다 깊은 쪽(nauticalDusk + 10분)은 그대로, 얕은 쪽(nauticalDusk − 10분)은 night + 30분.
 *     d. 천문 박명이 없는 날(북위 65°, 하지): 남중 + 12시간이고, 그 시각 해 고도가 그 밤 10분 걸음 최솟값과 0.05° 안, 최솟값은 −18° 보다 높다.
 *  2. 입력 `starArgsFor` (서울 2026-12-21 12시, 상현~보름 사이의 달)
 *     a. timeMs = starTimeFor. weatherAt 은 **별 보는 시각**으로 불린다(받은 날짜가 아니라).
 *     b. 해 고도가 SunCalc 값과 0.15° 안.
 *     c. 달 고도가 SunCalc 값과 1.4° 안(달 시차 최대 0.95° + SunCalc 달 위치 오차 ≈0.3° 에 여유).
 *     d. 달 밝은 비율이 SunCalc 값과 정확히 같다.
 *     e. 달이 떠 있으면 moonSetMs > timeMs 이고, 그 시각 정밀 달 고도가 −0.5° ± 0.25°, 2분 전은 −0.5° 위, 2분 뒤는 아래. SunCalc 달 지는 시각과 15분 안.
 *     f. sunAltAtMoonSetDeg 가 SunCalc 해 고도와 0.15° 안.
 *     g. 날씨: 예보가 null 이면 cloudKnown=false · cloudPct=0 · 연무 항목 모두 null. 값이 있으면 그대로 전달, 없는 항목은 null(지어내지 않는다).
 *     h. 12월 31일 가운데 별 보는 시각에 달이 −5° 아래인 날이 있고, 그날은 moonSetMs=null · sunAltAtMoonSetDeg=undefined.
 *     i. 달이 해 뜬 뒤(해 고도 −12° 보다 높을 때)에 지는 날이 12월에 있고, 그날 sunAltAtMoonSetDeg 가 −12° 보다 높게 전해진다.
 *  3. 글 — NaN · undefined · Infinity 가 입력 값 어디에도 없다.
 *  4. 날씨 고르기(SkyScreen 이 부르는 두 함수)
 *     a. `hourlyCovers`: 시각 [1000, 2000, 3000] 에 대해 1000 · 2500 · 3000 은 덮고, 999 · 3001 · NaN 은 안 덮는다. undefined · null · 빈 목록은 안 덮는다.
 *     b. `starWeatherOf`: 총운량이 있으면 그것(층보다 작아도 모델의 값), 없으면 층의 최댓값(하한), 층이 일부만 있으면 있는 것의 최댓값,
 *        구름 값이 하나도 없으면 null(맑다고 세지 않는다), null 입력은 null, 0~100 밖은 자른다, 연무 항목은 그대로(없으면 null).
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-star-tonight.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');
const SunCalc = require('suncalc');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const DEG = 180 / Math.PI;
const min = (ms) => ms / 60e3;
const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');

(async () => {
  const S = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'starTonight.js'));
  const M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'moonPosition.js'));
  const T = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'solarPosition.js'));

  const lat = 37.5665, lon = 126.978, elev = 38;
  const sunAltSC = (ms, la = lat, lo = lon) => SunCalc.getPosition(new Date(ms), la, lo).altitude * DEG;
  const moonAltSC = (ms) => SunCalc.getMoonPosition(new Date(ms), lat, lon).altitude * DEG;
  const moonAltApp = (ms) => M.getMoonPositionPrecise(new Date(ms), lat, lon, elev).altitude * DEG;

  // ── 1. 별을 볼 시각 ───────────────────────────────────────────────────────
  console.log('\n[1] 별을 볼 시각');
  {
    const dark = new Date('2026-12-21T15:00:00Z');   // 서울 12-22 00:00
    ok(S.starTimeFor(dark, lat, lon).getTime() === dark.getTime(), `이미 어두운 밤(해 ${sunAltSC(dark.getTime()).toFixed(0)}°)은 그대로: ${kst(dark.getTime())}`);

    for (const [name, la, lo, noonISO] of [['서울', lat, lon, '2026-12-21T03:00:00Z'], ['시드니', -33.8688, 151.2093, '2026-06-21T02:00:00Z']]) {
      const noon = new Date(noonISO);
      const want = SunCalc.getTimes(noon, la, lo).night.getTime() + 30 * 60e3;
      const got = S.starTimeFor(noon, la, lo).getTime();
      ok(Math.abs(min(got - want)) <= 2, `${name} 낮 12시 → 저녁 night + 30분: 앱 ${new Date(got).toISOString().slice(11, 16)}Z / SunCalc ${new Date(want).toISOString().slice(11, 16)}Z (차 ${min(got - want).toFixed(2)}분)`);
      const sunset = SunCalc.getTimes(noon, la, lo).sunset;
      const got2 = S.starTimeFor(sunset, la, lo).getTime();
      ok(Math.abs(min(got2 - want)) <= 2, `${name} 해 진 시각에서 열어도 같은 시각(저녁 줄에서 들어올 때): 차 ${min(got2 - want).toFixed(2)}분`);
      const altBefore = T.sunPosition(new Date(got - 30 * 60e3), la, lo).altitude * DEG;
      ok(Math.abs(altBefore + 18) < 0.1, `${name} 30분 전의 해 고도 ${altBefore.toFixed(2)}° = −18° 에서 0.1° 안`);
    }

    const noon = new Date('2026-12-21T03:00:00Z');
    const nd = T.sunTimes(noon, lat, lon).nauticalDusk.getTime();
    const deep = new Date(nd + 10 * 60e3), shallow = new Date(nd - 10 * 60e3);
    const night30 = SunCalc.getTimes(noon, lat, lon).night.getTime() + 30 * 60e3;
    ok(S.starTimeFor(deep, lat, lon).getTime() === deep.getTime(), `항해 박명 + 10분(해 ${sunAltSC(deep.getTime()).toFixed(1)}°)은 그대로`);
    ok(Math.abs(min(S.starTimeFor(shallow, lat, lon).getTime() - night30)) <= 2, `항해 박명 − 10분(해 ${sunAltSC(shallow.getTime()).toFixed(1)}°)은 night + 30분으로`);

    // 천문 박명이 없는 날
    const la = 65, lo = 25.5;   // 오울루 부근
    const day = new Date('2026-06-21T10:00:00Z');
    const tm = T.sunTimes(day, la, lo);
    const got = S.starTimeFor(day, la, lo);
    ok(!Number.isFinite(tm.night.getTime()), `북위 65° 하지에는 night 이 없다(Invalid Date)`);
    ok(Math.abs(got.getTime() - (tm.solarNoon.getTime() + 12 * 3600e3)) < 1000, `없으면 남중 + 12시간: ${new Date(got.getTime()).toISOString().slice(11, 16)}Z`);
    let minAlt = 99;
    for (let t = tm.solarNoon.getTime() + 6 * 3600e3; t <= tm.solarNoon.getTime() + 18 * 3600e3; t += 10 * 60e3) minAlt = Math.min(minAlt, T.sunPosition(new Date(t), la, lo).altitude * DEG);
    const altGot = T.sunPosition(got, la, lo).altitude * DEG;
    ok(altGot - minAlt < 0.05, `그 시각 해 고도 ${altGot.toFixed(2)}° 가 그 밤 최솟값 ${minAlt.toFixed(2)}° 와 0.05° 안`);
    ok(minAlt > -18, `최솟값 ${minAlt.toFixed(2)}° 가 −18° 보다 높다(밤이 안 된다)`);
  }

  // ── 2. 입력 ───────────────────────────────────────────────────────────────
  console.log('\n[2] 입력');
  const noon = new Date('2026-12-21T03:00:00Z');
  const calls = [];
  const wx = { cloudPct: 30, humidityPct: 62, aod550: 0.18, visibilityM: 20000, pm25: 14 };
  const a = S.starArgsFor({ date: noon, lat, lon, elevM: elev, weatherAt: (w) => { calls.push(w.getTime()); return wx; }, lightPollutionMag: 3.6 });
  const when = S.starTimeFor(noon, lat, lon).getTime();
  ok(a.timeMs === when, `timeMs = starTimeFor (${kst(a.timeMs)} KST)`);
  ok(calls.length === 1 && calls[0] === when, `weatherAt 은 별 보는 시각으로 한 번 불린다(받은 시각 ${kst(calls[0])} KST)`);
  const sSC = sunAltSC(when);
  ok(Math.abs(a.input.sunAltDeg - sSC) < 0.15, `해 고도 앱 ${a.input.sunAltDeg.toFixed(2)}° / SunCalc ${sSC.toFixed(2)}°`);
  const mSC = moonAltSC(when);
  ok(Math.abs(a.input.moonAltDeg - mSC) < 1.4, `달 고도 앱 ${a.input.moonAltDeg.toFixed(2)}° / SunCalc ${mSC.toFixed(2)}° (차 ${(a.input.moonAltDeg - mSC).toFixed(2)}°)`);
  ok(a.input.moonIllum === SunCalc.getMoonIllumination(new Date(when)).fraction, `달 밝은 비율 ${(a.input.moonIllum * 100).toFixed(0)} % 가 그대로 전해진다`);
  ok(a.input.moonAltDeg > 0, `이 장면은 달이 떠 있다(${a.input.moonAltDeg.toFixed(1)}°) — 아래 달 지는 시각 시험의 전제`);

  if (a.moonSetMs != null) {
    const ms = a.moonSetMs;
    ok(ms > a.timeMs, `달 지는 시각이 별 보는 시각 뒤: ${kst(ms)} KST`);
    const alt = moonAltApp(ms);
    ok(Math.abs(alt + 0.5) <= 0.25, `그 시각 정밀 달 고도 ${alt.toFixed(2)}° (기준 −0.5° ± 0.25°)`);
    ok(moonAltApp(ms - 2 * 60e3) > -0.5 && moonAltApp(ms + 2 * 60e3) < -0.5, `2분 전 ${moonAltApp(ms - 120e3).toFixed(2)}° 는 −0.5° 위, 2분 뒤 ${moonAltApp(ms + 120e3).toFixed(2)}° 는 아래`);
    const set = SunCalc.getMoonTimes(new Date(Date.UTC(2026, 11, 21)), lat, lon, true).set;
    ok(set && Math.abs(min(ms - set.getTime())) <= 15, `SunCalc 달 지는 시각 ${set ? kst(set.getTime()) : '없음'} KST 와 15분 안(차 ${set ? min(ms - set.getTime()).toFixed(1) : '-'}분)`);
    ok(a.sunAltAtMoonSetDeg != null && Math.abs(a.sunAltAtMoonSetDeg - sunAltSC(ms)) < 0.15, `달 질 때 해 고도 ${a.sunAltAtMoonSetDeg?.toFixed(2)}° / SunCalc ${sunAltSC(ms).toFixed(2)}°`);
  } else {
    ok(false, '달이 떠 있는데 moonSetMs 가 null');
  }

  ok(a.cloudKnown === true && a.input.cloudPct === 30, '예보가 있으면 cloudKnown=true, 운량 30 % 그대로');
  ok(a.input.lightPollutionMag === 3.6 && a.input.aod550 === 0.18 && a.input.visibilityM === 20000 && a.input.humidityPct === 62 && a.input.pm25 === 14, '빛 지도 한계와 연무 항목(AOD · 시정 · 습도 · PM2.5)이 그대로 전해진다');
  const none = S.starArgsFor({ date: noon, lat, lon, weatherAt: () => null, lightPollutionMag: null });
  ok(none.cloudKnown === false && none.input.cloudPct === 0, '예보가 없으면 cloudKnown=false, 운량 0(카드는 "모름")');
  ok(none.input.aod550 === null && none.input.visibilityM === null && none.input.humidityPct === null && none.input.pm25 === null && none.input.lightPollutionMag === null, '예보·빛 지도가 없으면 연무·빛 공해 항목은 모두 null(지어내지 않는다)');
  const partial = S.starArgsFor({ date: noon, lat, lon, weatherAt: () => ({ cloudPct: 10, visibilityM: 8000 }), lightPollutionMag: 5 });
  ok(partial.input.aod550 === null && partial.input.visibilityM === 8000 && partial.input.humidityPct === null, '일부만 있으면 있는 것만 전해지고 나머지는 null');
  const nan = S.starArgsFor({ date: noon, lat, lon, weatherAt: () => ({ cloudPct: NaN }), lightPollutionMag: 4 });
  ok(nan.cloudKnown === false && nan.input.cloudPct === 0, '운량이 NaN 이면 모르는 것으로 센다');

  // 달이 없는 밤 · 달이 해 뜬 뒤에 지는 날 — 12월 한 달 훑기
  let noMoon = null, lateSet = null, scanned = 0;
  for (let d = 1; d <= 31; d++) {
    const date = new Date(Date.UTC(2026, 11, d, 3));
    const r = S.starArgsFor({ date, lat, lon, elevM: elev, weatherAt: () => null, lightPollutionMag: null });
    scanned++;
    if (!noMoon && r.input.moonAltDeg < -5) noMoon = { d, r };
    if (!lateSet && r.moonSetMs != null && r.sunAltAtMoonSetDeg > -12) lateSet = { d, r };
  }
  ok(!!noMoon, `12월 중 별 보는 시각에 달이 −5° 아래인 날이 있다(${noMoon ? `12/${noMoon.d} 달 ${noMoon.r.input.moonAltDeg.toFixed(0)}°` : '없음'})`);
  if (noMoon) ok(noMoon.r.moonSetMs === null && noMoon.r.sunAltAtMoonSetDeg === undefined, '그날은 달 지는 시각을 찾지 않는다(null · undefined)');
  ok(!!lateSet, `12월 중 달이 해 뜬 뒤에 지는 날이 있다(${lateSet ? `12/${lateSet.d} ${kst(lateSet.r.moonSetMs)} KST 해 ${lateSet.r.sunAltAtMoonSetDeg.toFixed(0)}°` : '없음'})`);
  if (lateSet) {
    const sAlt = sunAltSC(lateSet.r.moonSetMs);
    ok(Math.abs(lateSet.r.sunAltAtMoonSetDeg - sAlt) < 0.15 && lateSet.r.sunAltAtMoonSetDeg > -12, `그날 달 질 때 해 고도 앱 ${lateSet.r.sunAltAtMoonSetDeg.toFixed(2)}° / SunCalc ${sAlt.toFixed(2)}°`);
  }

  // ── 3. 글 ─────────────────────────────────────────────────────────────────
  console.log('\n[3] 값');
  const bad = [a, none, partial, nan].filter(x => /NaN|Infinity/.test(JSON.stringify(x)));
  ok(bad.length === 0, '입력 값 어디에도 NaN · Infinity 가 없다');

  // ── 4. 날씨 고르기 ────────────────────────────────────────────────────────
  console.log('\n[4] 날씨 고르기');
  {
    const ts = [1000, 2000, 3000];
    ok(S.hourlyCovers(ts, 1000) && S.hourlyCovers(ts, 2500) && S.hourlyCovers(ts, 3000), '시각 범위 안(처음 · 가운데 · 끝)은 덮는다');
    ok(!S.hourlyCovers(ts, 999) && !S.hourlyCovers(ts, 3001) && !S.hourlyCovers(ts, NaN), '범위 밖과 NaN 은 덮지 않는다');
    ok(!S.hourlyCovers(undefined, 2000) && !S.hourlyCovers(null, 2000) && !S.hourlyCovers([], 2000), 'undefined · null · 빈 목록은 덮지 않는다');
    ok(S.hourlyCovers(new Float64Array([5, 6]), 5.5), '형식 있는 배열도 받는다');

    const a1 = S.starWeatherOf({ low: 10, mid: 40, high: 20, total: 30, humidity: 61, aod550: 0.2, visibility: 18000, pm25: 12 });
    ok(a1.cloudPct === 30 && a1.humidityPct === 61 && a1.aod550 === 0.2 && a1.visibilityM === 18000 && a1.pm25 === 12, '총운량이 있으면 층보다 작아도 총운량(30) · 연무 항목 그대로');
    ok(S.starWeatherOf({ low: 10, mid: 40, high: 20 }).cloudPct === 40, '총운량이 없으면 층의 최댓값(40)');
    ok(S.starWeatherOf({ low: 10, high: 25 }).cloudPct === 25, '층이 일부만 있으면 있는 것의 최댓값(25)');
    ok(S.starWeatherOf({ low: 10, mid: 40, high: 20, total: NaN }).cloudPct === 40, '총운량이 NaN 이면 층으로');
    const none = S.starWeatherOf({});
    ok(none.cloudPct === null && none.humidityPct === null && none.aod550 === null && none.visibilityM === null && none.pm25 === null, '구름 값이 하나도 없으면 모름(null) — 맑다고 세지 않는다');
    ok(S.starWeatherOf(null) === null && S.starWeatherOf(undefined) === null, 'null · undefined 입력은 null');
    ok(S.starWeatherOf({ total: 130 }).cloudPct === 100 && S.starWeatherOf({ total: -5 }).cloudPct === 0, '0~100 밖은 자른다');
    const viaArgs = S.starArgsFor({ date: new Date('2026-12-21T03:00:00Z'), lat, lon, weatherAt: () => S.starWeatherOf({}), lightPollutionMag: 5 });
    ok(viaArgs.cloudKnown === false && viaArgs.input.cloudPct === 0, '구름 값이 없는 날씨가 starArgsFor 를 거치면 "모름"');
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
