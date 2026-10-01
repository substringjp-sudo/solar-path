/**
 * **에어로졸(CAMS AOD)이 노을 예측에 제대로 들어가는가** (2026-10-01) — 판정. 브라우저가 필요 없습니다.
 *
 * 사용자: "1번 에어로졸부터 붙여줘" — 하늘이 얼마나 뿌연지를 시정 대신 대기질 모델(CAMS)의 에어로졸
 * 광학두께로 잡습니다. 먼저 정한 줄:
 *  1. **자료가 없으면 예전과 똑같다.** AOD 가 없을 때 `aerosolBeta` 는 예전 시정 식과 비트 단위로 같고,
 *     `predictSunset` 결과도 AOD 칸이 아예 없는 자료와 null 인 자료가 같다.
 *  2. **척도가 이어진다.** 보정 표본(24개 도시 · 7일 · 6시간 간격, fixtures/aerosol-calibration.json)에서
 *     AOD 로 낸 β 와 시정으로 낸 β 의 비 중앙값이 1 ± 0.10. 앱의 β 는 사진에 맞춘 척도라
 *     (sunsetPhysics `AER_COLUMN_KM` 주석) 평균적인 날은 예전처럼 그려져야 합니다.
 *  3. **방향이 맞다.** AOD 가 늘면 β 가 늘고, 고도 1° 해의 직달광은 어두워지고 붉어지며(G/R ↓),
 *     천정 하늘은 덜 파래진다(B/R ↓).
 *     ⚠ 처음 돌렸을 때 천정 항목이 실패했습니다: 2D 그라데이션 모델(`skyColorAtDirection`)은 β 0.05 아래에서
 *     천정 색이 평평합니다(탁해짐 보정이 β 0.05 부터 걸림 — 이번 변경 전부터의 성질). 기준은 그대로 두고,
 *     사용자가 보는 3D 하늘(`atmosphere.skyRadiance`) 항목을 [3b] 로 **덧붙여** 따로 잽니다.
 *  4. **황사 낀 날은 맑은 날보다 노을 점수가 낮다** — 구름·시각이 같고 AOD 만 0.10 vs 1.20.
 *  5. **먼지가 많으면 Ångström 지수가 내려간다**(3D 하늘). 먼지 비중 0 → 1.3, 1 → 0.4. 먼지 자료가 없으면
 *     예전 값 그대로.
 *  6. **자료 붙이기**: 대기질 시각 축이 날씨와 길이가 달라도 시각 문자열로 맞춘다. 빈 시각은 지어내지 않는다
 *     (보간 결과 undefined).
 *  7. **알림 문구**: 먼지 81µg/m³(한국 PM10 '나쁨' 하한) 이상이면 황사, PM2.5 36µg/m³('나쁨' 하한) 이상이면
 *     미세먼지를 알린다. 깨끗하면 아무것도 붙이지 않는다. 영어·일본어에는 한글이 없다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-aerosol.js
 */
const path = require('path');
const fs = require('fs');
const { PREVIEW } = require('./paths');

globalThis.__DEV__ = false;
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const U = (m) => import('file://' + path.join(PREVIEW, 'app', 'utils', m));
  const SP = await U('sunsetPhysics.js');
  const AT = await U('atmosphere.js');
  const W = await U('weather.js');
  const AQ = await U('airQuality.js');

  // 예전 시정 식(이번 변경 전 sunsetPhysics.aerosolBeta 그대로 옮김) — 1번의 기준.
  const hygro = (rh) => (rh <= 80 ? 1 : Math.pow((100 - Math.min(99, rh)) / 20, -0.6));
  const oldBeta = (v, rh) => {
    const has = v != null && v > 0;
    const visKm = has ? v / 1000 : 27;
    let b = Math.max(0.02, 3.912 / visKm - 0.012) * 0.30;
    if (!has && rh != null) b *= hygro(rh);
    return Math.max(0.012, Math.min(0.6, b));
  };

  // 합성 경로 자료: 관측점 + 해 쪽 중심선 두 점. 시각 축 3시간.
  const T0 = Date.UTC(2026, 9, 1, 8, 0);
  const times = [0, 1, 2].map(h => new Date(T0 + h * 3600e3).toISOString().slice(0, 16));
  const mk = (dist, cloud, extra = {}) => ({
    distance: dist, azimuthOffset: 0, source: 'standard',
    hourly: {
      time: times, timeMs: times.map(t => new Date(t + 'Z').getTime()),
      low: [cloud.low, cloud.low, cloud.low], mid: [cloud.mid, cloud.mid, cloud.mid], high: [cloud.high, cloud.high, cloud.high],
      visibility: dist === 0 ? [24000, 24000, 24000] : undefined,
      humidity: dist === 0 ? [60, 60, 60] : undefined,
      ...extra,
    },
  });
  const path0 = (cloud, aq) => [mk(0, cloud, aq), mk(50, cloud), mk(100, cloud)];
  const at = new Date(T0 + 3600e3);
  const predict = (pd, alt = 0.5) => SP.predictSunset(pd, at, alt, 24000, 60, 37.5, 0, 274);

  console.log('\n[1] 자료가 없으면 예전과 똑같다');
  {
    let same = 0, n = 0;
    for (const v of [undefined, 500, 2000, 8000, 15000, 22000, 40000, 74000, 120000]) {
      for (const rh of [undefined, 40, 85, 97]) { n++; if (SP.aerosolBeta(v, rh) === oldBeta(v, rh) && SP.aerosolBeta(v, rh, undefined) === oldBeta(v, rh)) same++; }
    }
    console.log(`      ${same}/${n} 조합이 예전 식과 같음`);
    ok(same === n, 'AOD 없을 때 aerosolBeta = 예전 시정 식 (비트 단위)');
    const cloud = { low: 5, mid: 40, high: 30 };
    const a = JSON.stringify(predict(path0(cloud, {})));
    const b = JSON.stringify(predict(path0(cloud, { aod550: [null, null, null] })));
    ok(a === b, 'AOD 칸이 없는 자료와 null 인 자료의 예측이 같다');
  }

  console.log('\n[2] 척도가 이어진다 — 보정 표본에서 β(AOD)/β(시정) 중앙값 1 ± 0.10');
  {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'aerosol-calibration.json'), 'utf8'));
    // 시정 식이 바닥·천장에 붙은 시각, 안개(시정 2km 미만)·습한 시각(RH 90% 이상)은 에어로졸 척도 비교에서 뺍니다
    // (시정이 에어로졸이 아니라 물방울을 재는 때입니다).
    const use = fx.rows.filter(([, , v, rh]) => v >= 2000 && rh < 90).map(([, , v, , aod]) => [oldBeta(v), SP.aerosolBeta(v, 50, aod)])
      .filter(([bv]) => bv > 0.0121 && bv < 0.6);
    const r = use.map(([bv, ba]) => ba / bv).sort((x, y) => x - y);
    const med = r[Math.floor(r.length / 2)];
    console.log(`      표본 ${use.length}시각 · 비 중앙값 ${med.toFixed(3)} (p25 ${r[Math.floor(r.length * 0.25)].toFixed(2)}, p75 ${r[Math.floor(r.length * 0.75)].toFixed(2)})`);
    ok(use.length >= 300 && Math.abs(med - 1) <= 0.10, '평균적인 날은 예전 척도 그대로');
  }

  console.log('\n[3] 방향 — AOD ↑ → β ↑, 해 직달광 어둡고 붉게, 천정 덜 파랗게');
  {
    const aods = [0.03, 0.1, 0.3, 0.6, 1.2, 2.5];
    const betas = aods.map(a => SP.aerosolBeta(24000, 60, a));
    const beams = betas.map(b => SP.directBeamRGB(1, 0, 37.5, b, 274));
    const zen = betas.map(b => SP.skyColorAtDirection(80, 90, 10, b, 1));
    console.log('      β    ' + betas.map(b => b.toFixed(3)).join(' '));
    console.log('      직달 G/R ' + beams.map(c => (c.g / c.r).toFixed(3)).join(' ') + ' · 세기 R ' + beams.map(c => c.r.toFixed(3)).join(' '));
    console.log('      천정 B/R ' + zen.map(c => (c.b / c.r).toFixed(3)).join(' '));
    const nonDec = (a) => a.every((x, i) => i === 0 || x >= a[i - 1]);
    const dec = (a) => a.every((x, i) => i === 0 || x < a[i - 1]);
    ok(nonDec(betas) && betas[5] > betas[0], 'β 가 AOD 와 함께 는다');
    ok(dec(beams.map(c => c.r)) && dec(beams.map(c => c.g / c.r)), '고도 1° 직달광: 어두워지고(R ↓) 붉어진다(G/R ↓)');
    ok(dec(zen.map(c => c.b / c.r)), '천정 하늘이 덜 파래진다(B/R ↓)');
  }

  console.log('\n[3b] 3D 하늘 천정 — AOD ↑ → B/R ↓ (덧붙인 항목, [3] 주석)');
  {
    const aods = [0.03, 0.1, 0.3, 0.6, 1.2, 2.5];
    const br = aods.map(a => {
      const p = AT.makeAtmosphereParams({ visibilityM: 24000, humidityPct: 60, aod550: a, latitude: 37.5, dayOfYear: 274 });
      const z = AT.skyRadiance(80, 90, 10, p);
      return z.b / z.r;
    });
    console.log('      3D 천정 B/R ' + br.map(x => x.toFixed(3)).join(' '));
    ok(br.every((x, i) => i === 0 || x < br[i - 1]), '3D 천정 하늘이 AOD 와 함께 덜 파래진다');
  }

  console.log('\n[4] 황사 낀 날은 맑은 날보다 노을 점수가 낮다 (구름 같음, AOD 0.10 vs 1.20)');
  {
    const cloud = { low: 5, mid: 40, high: 30 };
    const clean = predict(path0(cloud, { aod550: [0.1, 0.1, 0.1] }));
    const dusty = predict(path0(cloud, { aod550: [1.2, 1.2, 1.2] }));
    console.log(`      맑음 점수 ${clean.score} (${clean.quality}, β ${clean.factors.aerosolBeta.toFixed(3)}) · 황사 점수 ${dusty.score} (${dusty.quality}, β ${dusty.factors.aerosolBeta.toFixed(3)})`);
    ok(dusty.factors.aerosolBeta > clean.factors.aerosolBeta, '예측이 실제로 AOD 를 쓴다(β 가 다르다)');
    ok(dusty.score < clean.score && dusty.quality !== 'Epic', '황사 쪽 점수가 낮고 Epic 이 아니다');
  }

  console.log('\n[5] 먼지가 많으면 Ångström 지수가 내려간다');
  {
    const base = { visibilityM: 24000, humidityPct: 60, latitude: 37.5 };
    const none = AT.makeAtmosphereParams(base);
    const noDust = AT.makeAtmosphereParams({ ...base, aod550: 0.3, dustUgM3: 0, pm10: 40 });
    const allDust = AT.makeAtmosphereParams({ ...base, aod550: 0.3, dustUgM3: 200, pm10: 200 });
    const halfDust = AT.makeAtmosphereParams({ ...base, aod550: 0.3, dustUgM3: 50, pm10: 100 });
    console.log(`      자료 없음 ${none.angstrom.toFixed(2)} · 먼지 0% ${noDust.angstrom.toFixed(2)} · 50% ${halfDust.angstrom.toFixed(2)} · 100% ${allDust.angstrom.toFixed(2)}`);
    ok(Math.abs(none.angstrom - 1.3) < 1e-9 && Math.abs(noDust.angstrom - 1.3) < 1e-9, '먼지가 없거나 자료가 없으면 1.3');
    ok(Math.abs(allDust.angstrom - 0.4) < 1e-9 && halfDust.angstrom < 1.3 && halfDust.angstrom > 0.4, '먼지뿐이면 0.4, 반이면 그 사이');
    ok(Math.abs(noDust.betaMie - SP.aerosolBeta(24000, 60, 0.3)) < 1e-9, '3D 하늘의 β 도 예측과 같은 AOD 식');
  }

  console.log('\n[6] 자료 붙이기 — 시각 문자열로 맞추고, 빈 시각은 지어내지 않는다');
  {
    const hourly = { time: times.slice(), timeMs: times.map(t => new Date(t + 'Z').getTime()), low: [0, 0, 0], mid: [0, 0, 0], high: [0, 0, 0] };
    // 대기질은 앞 시각이 빠지고 뒤에 하나 더 있는 축
    W.attachAirQuality(hourly, { time: [times[1], times[2], '2099-01-01T00:00'], aod550: [0.4, 0.5, 9], dust: [10, 20, 9], pm25: [5, 6, 9], pm10: [30, 40, 9] });
    console.log(`      aod ${JSON.stringify(hourly.aod550)} dust ${JSON.stringify(hourly.dust)}`);
    ok(hourly.aod550[0] == null && hourly.aod550[1] === 0.4 && hourly.aod550[2] === 0.5, 'AOD 가 시각대로 붙고, 없는 시각은 빈칸');
    const pd = [{ distance: 0, azimuthOffset: 0, source: 'standard', hourly }];
    const early = W.getInterpolatedWeather(pd, new Date(hourly.timeMs[0] + 600e3))[0];
    const mid = W.getInterpolatedWeather(pd, new Date(hourly.timeMs[1] + 1800e3))[0];
    console.log(`      빈 시각 보간 aod=${early.aod550} · 30분 뒤 aod=${mid.aod550?.toFixed(3)} dust=${mid.dust?.toFixed(1)}`);
    ok(early.aod550 === undefined, '빈 시각을 보간하면 undefined(가짜 값 없음)');
    ok(Math.abs(mid.aod550 - 0.45) < 1e-9 && Math.abs(mid.dust - 15) < 1e-9, '있는 시각 사이는 선형 보간');
  }

  console.log('\n[7] 알림 문구 — 황사·미세먼지만, 깨끗하면 빈칸');
  {
    const dust = AQ.airQualityNote({ dust: 120, pm25: 20 }, 'ko');
    const pm = AQ.airQualityNote({ dust: 10, pm25: 50 }, 'ko');
    const clean = AQ.airQualityNote({ dust: 10, pm25: 10 }, 'ko');
    const edgeD = AQ.airQualityNote({ dust: 80.9, pm25: 35.9 }, 'ko');
    const unk = AQ.airQualityNote({}, 'ko');
    console.log(`      황사 "${dust}" · 미세먼지 "${pm}" · 깨끗 "${clean}" · 경계 바로 아래 "${edgeD}" · 모름 "${unk}"`);
    ok(/황사/.test(dust) && /미세먼지/.test(pm), '황사·미세먼지를 알린다');
    ok(clean === '' && edgeD === '' && unk === '', '깨끗하거나 기준 아래거나 모르면 아무것도 안 붙인다');
    const en = [AQ.airQualityNote({ dust: 120 }, 'en'), AQ.airQualityNote({ pm25: 50 }, 'en')];
    const ja = [AQ.airQualityNote({ dust: 120 }, 'ja'), AQ.airQualityNote({ pm25: 50 }, 'ja')];
    console.log(`      en ${JSON.stringify(en)} · ja ${JSON.stringify(ja)}`);
    ok([...en, ...ja].every(s => s && !/[가-힣]/.test(s)), '영어·일본어 문구가 있고 한글이 없다');
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — pass ${pass} / fail ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
