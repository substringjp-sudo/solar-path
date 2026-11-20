/**
 * **학습 페이지 "오늘" 구역의 시간대별 점수가 맞는가** — `src/utils/dayScoreSeries.ts`. 브라우저 · 네트워크 불필요.
 *
 * 이 함수는 01 하늘 시트의 그래프(`SkyScreen` 의 `scoreGraph`)와 **같은 식**을 순수 함수로 꺼낸 것입니다: 출몰 둘레 9시간 창을 10분 간격으로 훑어
 * 각 시각의 노을 예측 점수를 답니다. 학습 페이지가 고른 날(16일 중 아무 날)의 그래프를 그리려고 만들었습니다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20, 구현보다 먼저 박았습니다)
 *
 *  1. **같은 식**: 그래프의 점수는 앱이 한 시각의 노을 점수를 내는 함수(`scenePrediction`)를 **그 시각에** 부른 값이다.
 *       (a) 표본 시각마다(받은 자료 범위 안 · 노을 범위 안) 그래프 점수 = 같은 시각의 `scenePrediction` 점수(0~100 으로 자름), 오차 1e-9. 그런 표본이 두 쪽 모두 5개 이상.
 *           이 비교는 독립 구현이 아니라 앱이 쓰는 같은 함수를 부릅니다 — 그래프가 그 함수를 올바른 인수(시각 · 해 고도 · 해 방위+180° · 그 시각의 관측점 보간값 · 위도 · 관측 높이)로
 *           부르는지를 봅니다. 함수 자체의 옳음은 다른 판정이 따로 봅니다.
 *       (b) 판정(`eventVerdict`)도 같은 함수에서 나온다: 판정 시각에서 같은 함수를 부른 점수가 판정 점수와 같다(1e-9). 그래서 그래프와 판정은 같은 시각에서 같은 값을 준다.
 *     이 검사가 쓸모 있으려면 점수가 시각마다 실제로 달라야 한다 — 창 안 점수 있는 점의 최댓값과 최솟값 차가 10 이상이어야 한다(아니면 실패로 친다).
 *     (첫 시도는 그래프의 최댓값을 판정 점수와 3점 안으로 비교했는데 일출에서 4점 차로 실패했습니다. 판정 탐색 범위(일몰 −15 ~ +30분, 일출 −30 ~ +15분)로 좁힌 두 번째 시도도 실패했습니다.
 *      원인을 재 보니 점수가 시각에 대해 매끄럽지 않았습니다 — 판정 시각 둘레 30초 간격 점수가 일몰 26 · 26 · 25 · 24 · 23 · 22 · 26 · 25 …, 일출 34 · 28 · 30 · 31 · 32 · 33 · 36 으로 30초 사이에
 *      최대 6점이 뛰는 톱니였고, 표본 간격을 1분까지 줄여도 두 격자의 최댓값이 2~5점 어긋났습니다. 그래서 서로 다른 시각의 최댓값을 견주는 기준은 성립하지 않습니다.
 *      기준을 풀어 맞춘 것이 아니라 같은 시각끼리 견주도록 바꿨습니다.)
 *  2. **창**: 돌려준 창은 `scoreWindow(출몰 시각, 쪽, tz)` 와 같고(fromMs · toMs), 점은 10분 간격이며 첫 점이 창의 시작, 마지막 점이 창의 끝, 시각은 오름차순이다.
 *  3. **노을이 생길 수 없는 높이는 0**: 해 고도가 노을 범위(−8° ~ 15°, `canGlow`) 밖인 점은 자료가 있든 없든 점수 **0**(null 아님)이고,
 *     범위 안인 점은 0 ~ 100 이다. 낮에도 · 한밤에도 0 이 되는 점이 실제로 있어야 한다(없으면 검사가 못 쓰이므로 실패로 친다).
 *  4. **가장자리 값을 지어내지 않는다**: 관측점 시간 배열이 일몰 직후에 끝나는 자료에서, 받은 범위 밖이고 노을 범위 안인 점은 **null**(마지막 값을 늘려 쓰지 않는다),
 *     범위 안인 점은 숫자. 두 부류가 모두 실제로 있어야 한다.
 *  5. **자료 없음**: path 가 null · undefined · 빈 배열이면 null, `at` 이 잘못된 날짜(NaN)이면 null.
 *  6. **받은 범위가 창을 비껴가는 날**: 받은 자료가 창 전체를 비껴가면 노을 범위 안 점은 모두 null(자료 없음), 범위 밖 점은 0 이다. `hasAnyScore` 는 null 이 아닌 값을 점수로 보므로
 *     0 도 점수이고, 그래서 이 경우에도 결과는 있다(01 하늘의 원래 그래프와 같은 규칙). `null` 은 path 자체가 없을 때만 돌려준다 — 앱은 판정 칸에 자료가 없으면 이 함수를 부르지 않는다.
 *  7. **쪽을 섞지 않는다**: 같은 하루의 일몰 창과 일출 창은 서로 다르고(fromMs 가 다름), 일몰 창의 최댓값은 일몰 판정과, 일출 창의 최댓값은 일출 판정과 맞는다(1번을 두 쪽 모두에서).
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-day-score-series.js
 */
process.env.TZ = 'Asia/Seoul';
const path = require('path');
const { PREVIEW } = require('./paths');

globalThis.__DEV__ = false;
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const U = (m) => import('file://' + path.join(PREVIEW, 'app', 'utils', m));
  const F = await U('sunForecast.js');
  const S = await U('scoreSeries.js');
  const SP = await U('solarPosition.js');
  let D = null;
  try { D = await U('dayScoreSeries.js'); } catch { D = null; }
  ok(!!D && typeof D.dayScoreSeries === 'function', 'dayScoreSeries 가 있다');
  if (!D || typeof D.dayScoreSeries !== 'function') { console.log(`\nFAILURES — pass ${pass} / fail ${fail}`); process.exit(1); }

  const now = new Date('2026-10-25T09:00:00+09:00');
  const TZ = 9, LAT = 37.28, LON = 126.57, ELEV = 1500;   // 높이를 빠뜨려도 점수가 달라지도록 산 위(1500 m)로 둡니다
  const bearings = F.sideBearings(LAT, LON, F.localNoons(now, TZ, 16));
  const pts = F.forecastPoints(LAT, LON, bearings);
  const t0 = new Date('2026-10-25T00:00:00+09:00').getTime();
  const pad = (n) => String(n).padStart(2, '0');
  const localStr = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`; };
  // 날마다 · 시각마다 달라지는 구름(점수가 한 값으로 납작해지면 "같은 식" 검사가 못 쓰입니다)
  const mkTimes = (hours) => Array.from({ length: hours }, (_, h) => localStr(t0 + h * 3600e3));
  const wave = (h, ph) => 0.5 + 0.5 * Math.sin((h + ph) / 5.3);
  // 방위(일출 쪽 · 일몰 쪽)에 따라서도 다르게: 해 방위를 잘못 읽으면(예: +180° 빠짐) 반대쪽 줄을 읽어 점수가 달라지게 합니다.
  // 습도는 높게(92 %): 관측점 보간값(`obs`)을 빠뜨리면 점수가 달라지게 합니다.
  const response = (hours, nullFrom = Infinity) => {
    const times = mkTimes(hours);
    return pts.map((p) => {
      const col = (f) => times.map((_, h) => (p.dist === 0 && h >= nullFrom ? null : Math.round(f(h))));
      const k = p.dist === 0 ? 0 : Math.min(1, p.dist / 380);
      const sunrise = p.dist !== 0 && bearings.sunrise.includes(p.az);
      return { hourly: {
        time: times,
        cloud_cover_low: col((h) => (sunrise ? 70 : 8) + 25 * wave(h, 0) * (0.3 + 0.7 * k)),
        cloud_cover_mid: col((h) => 10 + 60 * wave(h, 7)),
        cloud_cover_high: col((h) => (sunrise ? 20 : 15) + 70 * wave(h, 13)),
        relative_humidity_2m: times.map(() => 92),
      } };
    });
  };
  const fc = F.pathFromResponse(pts, response(16 * 24));
  const noonTomorrow = F.localNoons(now, TZ, 2)[1];
  const sunAt = (side) => SP.sunTimes(new Date(noonTomorrow), LAT, LON)[side];
  const maxOf = (pp) => Math.max(...pp.filter(p => p.score != null).map(p => p.score));
  const minOf = (pp) => Math.min(...pp.filter(p => p.score != null && p.score > 0).map(p => p.score));

  // ── 1 · 7 같은 식 · 쪽을 섞지 않는다
  const DEG = 180 / Math.PI;
  const SPN = await U('scenePrediction.js');
  const W = await U('weather.js');
  /** 앱(01 하늘)이 한 시각의 점수를 내는 방식 그대로 — `SkyScreen` 의 predictionAt. */
  const ref = (path, t, elev = ELEV) => {
    const sp = SP.sunPosition(t, LAT, LON);
    const p = SPN.scenePrediction({ pathData: path, time: t, sunAltDeg: sp.altitude * DEG, sunAzDeg: sp.azimuth * DEG + 180, obs: W.getInterpolatedWeather(path, t)[0], latitude: LAT, observerElevM: elev });
    return p ? Math.max(0, Math.min(100, p.score)) : null;
  };
  const res = {};
  for (const side of ['sunset', 'sunrise']) {
    const at = sunAt(side);
    const v = F.eventVerdict(fc, at, side, LAT, LON, ELEV);
    const r = D.dayScoreSeries(fc, at, side, LAT, LON, TZ, ELEV);
    res[side] = r;
    let n = 0, maxErr = 0;
    for (const p of (r?.points ?? [])) {
      const t = new Date(p.t);
      const alt = SP.sunPosition(t, LAT, LON).altitude * DEG;
      if (!S.canGlow(alt) || !F.hasDataAt(fc, t)) continue;
      const e = ref(fc, t);
      n++; maxErr = Math.max(maxErr, e == null || p.score == null ? Infinity : Math.abs(p.score - e));
    }
    ok(!!r && n >= 5 && maxErr < 1e-9, `1a ${side}: 자료 안 · 노을 범위 안 표본 ${n}개가 같은 시각 scenePrediction 점수와 같다(최대 오차 ${maxErr.toExponential(1)})`);
    const vRef = v ? ref(fc, v.time) : null;
    ok(!!v && vRef != null && Math.abs(vRef - v.prediction.score) < 1e-9, `1b ${side}: 판정 점수 ${v?.prediction.score.toFixed(1)} = 판정 시각(${v?.time.toTimeString().slice(0, 8)})의 같은 함수 점수 ${vRef?.toFixed(1)}`);
    const spread = r ? maxOf(r.points) - minOf(r.points) : 0;
    ok(spread >= 10, `1 ${side} 검사의 분별력: 창 안 점수의 폭 ${spread.toFixed(1)} ≥ 10(납작하면 못 쓰입니다)`);
  }
  ok(!!res.sunset && !!res.sunrise && res.sunset.win.fromMs !== res.sunrise.win.fromMs && res.sunset.win.fromMs > res.sunrise.win.fromMs,
     `7 일몰 창과 일출 창이 다르고 일몰 창이 뒤다 (${new Date(res.sunrise?.win.fromMs ?? 0).toTimeString().slice(0, 5)} / ${new Date(res.sunset?.win.fromMs ?? 0).toTimeString().slice(0, 5)})`);

  // ── 2 창
  {
    const at = sunAt('sunset');
    const w = S.scoreWindow(at.getTime(), 'sunset', TZ);
    const r = res.sunset;
    const ts = r.points.map(p => p.t);
    const stepsOk = ts.every((t, i) => i === 0 || t - ts[i - 1] === 10 * 60e3);
    ok(r.win.fromMs === w.fromMs && r.win.toMs === w.toMs && ts[0] === w.fromMs && ts[ts.length - 1] === w.toMs && stepsOk,
       `2 창이 scoreWindow 와 같고 점은 10분 간격(${ts.length}개), 첫 점 = 창 시작 · 끝 점 = 창 끝`);
  }

  // ── 3 노을이 생길 수 없는 높이는 0
  {
    const at = sunAt('sunset');
    const r = res.sunset;
    let zeros = 0, inRange = 0, bad = [];
    for (const p of r.points) {
      const alt = SP.sunPosition(new Date(p.t), LAT, LON).altitude * 180 / Math.PI;
      if (!S.canGlow(alt)) { if (p.score !== 0) bad.push(`${new Date(p.t).toTimeString().slice(0, 5)} 고도 ${alt.toFixed(1)}° 점수 ${p.score}`); else zeros++; }
      else { inRange++; if (!(p.score != null && p.score >= 0 && p.score <= 100)) bad.push(`${new Date(p.t).toTimeString().slice(0, 5)} 범위 안인데 ${p.score}`); }
    }
    ok(bad.length === 0 && zeros > 0 && inRange > 0, `3 노을 범위 밖 ${zeros}점은 모두 0, 범위 안 ${inRange}점은 0~100${bad.length ? ': ' + bad.slice(0, 2).join(' / ') : ''}`);
    // 자료가 없는 곳에서도 범위 밖은 0 (null 이 아니라)
    const short = F.pathFromResponse(pts, response(8)); // 첫날 07시까지만
    const rr = D.dayScoreSeries(short, at, 'sunset', LAT, LON, TZ, ELEV);
    const dayPts = rr ? rr.points.filter(p => !S.canGlow(SP.sunPosition(new Date(p.t), LAT, LON).altitude * 180 / Math.PI)) : [];
    ok(!!rr && dayPts.length > 0 && dayPts.every(p => p.score === 0), `3 자료가 없는 날에도 노을 범위 밖은 0 (${dayPts.length}점)`);
  }

  // ── 4 가장자리 값을 지어내지 않는다 (관측점 자료가 일몰 직후에 끝남)
  {
    const sunset = sunAt('sunset');
    const endH = Math.floor((sunset.getTime() + 25 * 60e3 - t0) / 3600e3);          // 일몰 25분 뒤가 속한 시각까지
    const cut = F.pathFromResponse(pts, response(endH + 1));                          // endH 시 정각이 마지막 자료
    const times = cut[0].hourly.timeMs;
    const lastMs = times[times.length - 1];
    const r = D.dayScoreSeries(cut, sunset, 'sunset', LAT, LON, TZ, ELEV);
    const glowIn = r ? r.points.filter(p => S.canGlow(SP.sunPosition(new Date(p.t), LAT, LON).altitude * 180 / Math.PI)) : [];
    const inside = glowIn.filter(p => p.t >= times[0] && p.t <= lastMs), outside = glowIn.filter(p => p.t > lastMs);
    ok(!!r && inside.length > 0 && outside.length > 0 && inside.every(p => typeof p.score === 'number') && outside.every(p => p.score === null),
       `4 받은 범위 안 ${inside.length}점은 숫자, 밖 ${outside.length}점은 null(마지막 값을 늘려 쓰지 않는다)`);
  }

  // ── 5 자료 없음
  {
    const at = sunAt('sunset');
    ok(D.dayScoreSeries(null, at, 'sunset', LAT, LON, TZ, ELEV) === null && D.dayScoreSeries(undefined, at, 'sunset', LAT, LON, TZ, ELEV) === null && D.dayScoreSeries([], at, 'sunset', LAT, LON, TZ, ELEV) === null &&
       D.dayScoreSeries(fc, new Date(NaN), 'sunset', LAT, LON, TZ, ELEV) === null,
       '5 path 가 null · undefined · 빈 배열이거나 날짜가 NaN 이면 null');
  }

  // ── 6 받은 범위가 창을 비껴가면: 0 인 점만 있어도 결과는 있고(0 은 점수), null 은 path 가 없을 때뿐
  {
    const far = new Date(sunAt('sunset').getTime() + 10 * 24 * 3600e3);              // 받은 자료는 첫 2일뿐
    const two = F.pathFromResponse(pts, response(48));
    const r = D.dayScoreSeries(two, far, 'sunset', LAT, LON, TZ, ELEV);
    const glowPts = r ? r.points.filter(p => S.canGlow(SP.sunPosition(new Date(p.t), LAT, LON).altitude * 180 / Math.PI)) : [];
    ok(!!r && glowPts.length > 0 && glowPts.every(p => p.score === null) && r.points.some(p => p.score === 0),
       `6 자료 밖의 날: 노을 범위 안 ${glowPts.length}점은 모두 null, 범위 밖은 0 — 0 이 점수라 결과는 있다`);
  }

  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
