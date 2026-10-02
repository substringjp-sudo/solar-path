/**
 * **하늘 시트의 이벤트가 계산에서 나오는가** (점검 2026-09-29) — 판정. 브라우저가 필요 없습니다.
 *
 * 예전 목록은 고정 문구였습니다: 늘 "훌륭한 일몰 · 추천 95점", 보름에도 "은하수 관측 적기",
 * 일출·일몰을 모르면 06:12 · 19:35 같은 지어낸 시각. 먼저 정한 줄:
 *  1. 출몰 시각을 모르면 그 줄을 **안 띄운다**(지어낸 시각 없음).
 *  2. 은하수는 보름 무렵(2026-09-26)엔 없고, 그믐 무렵(2026-10-10)엔 있다.
 *  3. 초승달은 저녁(해진 뒤)에, 그믐달은 새벽(해뜨기 전)에만 뜬다 — 각 항목 시각이 일몰 뒤/일출 앞.
 *  4. 노을 점수는 예측이 있을 때만 붙고, 없으면 "날씨를 받으면" 문구다.
 *  5. 영어·일본어 목록에 한글이 한 글자도 없다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-sky-events.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const { buildSkyEvents } = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'skyEvents.js'));
  const SunCalc = (await import('file://' + path.join(PREVIEW, 'app', 'vendor', 'suncalc.js')).catch(() => null))?.default
    ?? require(path.join(__dirname, '..', '..', 'node_modules', 'suncalc'));
  // 해 출몰은 앱이 넘기는 것과 같은 태양력에서 (celestial.getCelestialEvents → solarPosition.sunTimes).
  const { sunTimes } = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'solarPosition.js'));
  const LAT = 37.4863, LON = 127.0443;
  const at = (iso) => new Date(iso);
  const evOf = (d) => { const t = sunTimes(d, LAT, LON), m = SunCalc.getMoonTimes(d, LAT, LON); return { sunrise: t.sunrise, sunset: t.sunset, moonrise: m.rise, moonset: m.set }; };
  const run = (iso, extra = {}) => { const d = at(iso); return buildSkyEvents({ date: d, latitude: LAT, longitude: LON, events: evOf(d), language: 'ko', ...extra }); };
  const show = (L) => L.map(e => `${e.id}@${e.time.toISOString().slice(11, 16)}`).join(' ');

  console.log('\n[1] 모르는 시각은 안 띄운다');
  {
    const L = buildSkyEvents({ date: at('2026-09-29T03:00:00Z'), latitude: LAT, longitude: LON, events: null, language: 'ko' });
    console.log('      출몰 없음 → ' + show(L));
    ok(!L.some(e => /sunrise|sunset|moon(rise|set)|crescent/.test(e.id)), `출몰·가는 달 줄이 없다`);
    ok(L.every(e => !isNaN(e.time.getTime())), `모든 줄의 시각이 실제 값이다`);
  }

  console.log('\n[2] 은하수 — 보름엔 없고 그믐엔 있다');
  {
    const full = run('2026-09-26T03:00:00Z'), newm = run('2026-10-10T03:00:00Z');
    console.log('      보름 무렵 → ' + show(full.filter(e => e.category === 'featured')));
    console.log('      그믐 무렵 → ' + show(newm.filter(e => e.category === 'featured')));
    ok(!full.some(e => e.id === 'f_milkyway'), `보름 무렵(9/26)엔 은하수 줄이 없다`);
    ok(newm.some(e => e.id === 'f_milkyway'), `그믐 무렵(10/10)엔 은하수 줄이 있다`);
  }

  console.log('\n[3] 가는 달 — 초승달은 저녁, 그믐달은 새벽');
  {
    let eve = 0, morn = 0, wrong = 0;
    for (let k = 0; k < 60; k++) {
      const d = new Date(Date.UTC(2026, 9, 1 + k, 3));
      const ev = evOf(d);
      for (const e of run(d.toISOString())) {
        if (e.id !== 'f_crescent') continue;
        const evening = e.time > ev.sunset, morning = e.time < ev.sunrise;
        if (evening) eve++; else if (morning) morn++; else wrong++;
      }
    }
    console.log(`      60일 동안: 저녁 ${eve} · 새벽 ${morn} · 한낮(틀림) ${wrong}`);
    ok(eve > 0 && morn > 0, `저녁 초승달과 새벽 그믐달이 둘 다 나온다`);
    ok(wrong === 0, `한낮에 뜨는 가는 달 줄이 없다`);
  }

  console.log('\n[4] 노을 점수는 예측이 있을 때만');
  {
    const none = run('2026-09-29T03:00:00Z');
    const withP = run('2026-09-29T03:00:00Z', { sunsetPrediction: { score: 72.4, quality: 'Great' } });
    const s0 = none.find(e => e.id === 'f_sunset'), s1 = withP.find(e => e.id === 'f_sunset');
    console.log(`      예측 없음: "${s0.title}" ${s0.badge ?? '(점수 없음)'} — ${s0.description}`);
    console.log(`      예측 있음: "${s1.title}" ${s1.badge}`);
    ok(!s0.badge && /날씨/.test(s0.description), `예측이 없으면 점수가 없고 "날씨를 받으면" 이다`);
    ok(s1.badge === '72점' && /좋은 노을/.test(s1.title), `예측이 있으면 품질과 점수가 붙는다`);
    ok(!none.concat(withP).some(e => /95점|90점|훌륭한/.test(e.title + (e.badge ?? ''))), `예전 고정 문구(훌륭한 · 95점 · 90점)가 없다`);
  }

  console.log('\n[5] 영어·일본어에 한글이 없다');
  for (const lang of ['en', 'ja']) {
    const L = run('2026-10-12T03:00:00Z', { language: lang, sunsetPrediction: { score: 50, quality: 'Fair' } });
    const txt = L.map(e => e.title + ' ' + e.description + ' ' + (e.badge ?? '')).join(' | ');
    console.log(`      ${lang}: ${txt.slice(0, 160)}…`);
    ok(!/[가-힣]/.test(txt), `${lang} 목록에 한글이 없다`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
