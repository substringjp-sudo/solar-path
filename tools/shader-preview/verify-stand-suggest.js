/**
 * **추천 규칙 · 순위 · 예보 표시가 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * `src/utils/standSuggest.ts` 는 고른 대상에서 어울리는 주제, 크기 선택, 필요 거리와 렌즈, 구름 예보 상태, 후보 순위를 냅니다.
 * 손으로 정한 값(점수 표, 경계 %)을 여기서 다시 적어 견주고, 독립적인 길(수치 풀이, 완전 탐색)로 구한 값과도 맞춥니다.
 *
 * 먼저 정한 줄(실행 전):
 *  1. 주제: 높이 ≥ 60 m 이고 높이 ≥ 짧은 변 × 1.5 인 건물만 "높고 좁음" → 달·해 + 은하수·북극성(준비 중). 경계값(60 m, 비 1.5)은 포함, 59 m 와 비 1.25 는 제외.
 *     낮거나 넓은 건물, 땅은 달·해만. 달·해는 ready, 나머지는 not ready.
 *  2. 크기: 건물은 꼭대기 50 m + 전체 높이(60 m 이하면 전체만), 땅은 50 m · 200 m.
 *  3. 거리와 렌즈: 50 m → 5.51 km, 555 m → 61.2 km, 비율 0.5 → 두 배. 렌즈는 "원반 = 짧은 변(24 mm)의 1/3" 이 되는 f 를 이분법으로 따로 풀어
 *     닫힌 식과 0.5 mm 안에서 맞고, 0.52° 면 약 880 mm(목업의 "약 900 mm 환산 이상" 과 같은 값).
 *  4. 예보: 총운량이 있으면 그것, 없으면 세 층의 최대, 하나라도 비면 null. 시각 사이는 1 차 보간. 25% 이하 맑음, 60% 이하 보통, 그 위 많음(경계 포함은 아래쪽).
 *     앞뒤 값이 null 이거나 범위 밖이거나 자료가 없으면 "모름". 모름에 맑음을 지어내지 않는다.
 *  5. 점수: 달 = (illum<5% → 0, 아니면 0.2+0.8·illum) × 하늘(해 떠 있음 0.45 · 황혼 1 · 깊은 밤 0.85) × 예보(맑음 1 · 모름 0.65 · 보통 0.6 · 많음 0.15).
 *     해 = 하늘(≤8° 1 · ≤20° 0.75 · ≤40° 0.5 · 그 위 0.3, 지평선 −0.9° 아래 0) × 예보. 가려진 자리는 기본 제외, 포함하면 ×0.1.
 *     점수 ≥ 0.5 이고 보이면 추천. 순서는 점수 내림차순(0.02 안이면 이른 날짜), 날짜순 정렬은 날짜 오름차순.
 *  6. 뜨는/지는/높음: 고도 20° 위면 높음, 아니면 3 분 뒤가 더 높으면 뜨는 중. 독립 길: 좌우 1 분 차분의 부호.
 *  7. 대상 점: 건물은 "누른 곳"을 골라도 지붕 한가운데(topPoint), 땅은 고른 점. 위경도를 모르면 질의 없음.
 *  8. 통합: 평지에서 찾기 → 묶기 → 순위. 점수가 내림차순이고, 가려진 것·안 보이는 달이 없고, 추천 표시가 점수와 같다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-stand-suggest.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const R2D = 180 / Math.PI, D2R = Math.PI / 180;

(async () => {
  const U = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'standSuggest.js'));
  const F = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'standFinder.js'));
  const A = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'alignSearch.js'));
  const SunCalc = (await import('suncalc')).default ?? (await import('suncalc'));

  const LAT = 37.5126, LON = 127.1026;
  const pt = (e, s, el, extra = {}) => ({ azDeg: 0, elDeg: 0, distM: Math.hypot(e, s), elevM: el, eastM: e, southM: s, latitude: LAT, longitude: LON, visible: true, marginM: 10, ...extra });
  const building = (h, shortM, snapped = true) => ({
    kind: 'building', ...pt(100, -50, 20 + h / 2, { latitude: 37.5100, longitude: 127.1000 }), eyeElevM: 12,
    building: { heightM: h, baseElevM: 20, topElevM: 20 + h, longM: shortM * 1.1, shortM, snapped,
      hitPoint: pt(100, -50, 20 + h / 2, { latitude: 37.5100, longitude: 127.1000 }),
      topPoint: pt(120, -60, 20 + h, { latitude: LAT, longitude: LON }) },
  });
  const terrain = (extra = {}) => ({ kind: 'terrain', ...pt(500, -300, 400), eyeElevM: 12, ...extra });

  // ── [1] 주제 ──
  console.log('\n[1] 주제 규칙');
  {
    const ids = (t) => U.themesFor(t).map(x => x.id).join(',');
    ok(ids(building(555, 70)) === 'moonOnTop,sunOnTop,milkyBehind,polarisTrails', `높고 좁은 건물(555 m, 70 m): ${ids(building(555, 70))}`);
    const th = U.themesFor(building(555, 70));
    ok(th.map(x => x.ready).join() === 'true,true,false,false' && th.map(x => x.body).join() === 'moon,sun,,', '달·해만 ready, 천체는 달·해, 나머지는 준비 중');
    ok(ids(building(20, 60)) === 'moonOnTop,sunOnTop', '낮은 건물(20 m)은 달·해만');
    ok(ids(building(100, 200)) === 'moonOnTop,sunOnTop', '높이가 100 m 라도 폭 200 m(비 0.5)면 달·해만');
    ok(U.isTallNarrow(building(60, 40)), '경계: 60 m, 짧은 변 40 m(비 1.5) 는 높고 좁음');
    ok(!U.isTallNarrow(building(59, 20)), '경계: 59 m 는 제외');
    ok(!U.isTallNarrow(building(100, 80)), '경계: 비 1.25 는 제외');
    ok(ids(terrain()) === 'moonOnTop,sunOnTop', '땅은 달·해만');
  }

  // ── [2] 크기 ──
  console.log('\n[2] 크기 선택');
  {
    const s = (t) => U.sizeChoices(t).map(c => `${c.id}:${Math.round(c.lengthM)}`).join(',');
    ok(s(building(555, 70)) === 'top50:50,whole:555', `555 m 건물: ${s(building(555, 70))}`);
    ok(s(building(61, 30)) === 'top50:50,whole:61', `61 m 건물: ${s(building(61, 30))}`);
    ok(s(building(60, 30)) === 'whole:60', `60 m 건물은 전체만: ${s(building(60, 30))}`);
    ok(s(building(30, 30)) === 'whole:30', '30 m 건물은 전체만');
    ok(s(terrain()) === 'top50:50,top200:200', `땅: ${s(terrain())}`);
  }

  // ── [3] 거리와 렌즈 ──
  console.log('\n[3] 필요 거리와 렌즈');
  {
    ok(near(U.neededDistanceKm(50), 5.51, 0.05), `꼭대기 50 m: ${U.neededDistanceKm(50).toFixed(2)} km (5.51)`);
    ok(near(U.neededDistanceKm(555), 61.2, 0.6), `전체 555 m: ${U.neededDistanceKm(555).toFixed(1)} km (61.2)`);
    ok(near(U.neededDistanceKm(50, 0.5) / U.neededDistanceKm(50), 2, 0.01), '비율 0.5 는 두 배 멀리');
    // 독립: 원반(0.52°)이 짧은 변(24 mm)의 1/3 이 되는 f 를 이분법으로 푼다
    const want = 3 * 0.52;
    let lo = 100, hi = 5000;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; const fov = 2 * Math.atan(12 / mid) * R2D; if (fov > want) lo = mid; else hi = mid; }
    const fSolved = (lo + hi) / 2;
    ok(near(U.neededFocalMm(), fSolved, 0.5), `렌즈: 닫힌 식 ${U.neededFocalMm().toFixed(1)} mm = 수치 풀이 ${fSolved.toFixed(1)} mm`);
    ok(near(U.neededFocalMm(), 880, 8) && Math.round(U.neededFocalMm() / 50) * 50 === 900, '0.52° 면 약 880 mm, 50 mm 단위로 900 mm (목업과 같은 값)');
    ok(U.neededFocalMm(0.56) < U.neededFocalMm(0.49), '원반이 클수록(가까운 달) 필요한 렌즈는 짧아진다');
  }

  // ── [4] 예보 ──
  console.log('\n[4] 구름 예보');
  {
    const H = 3600e3, t0 = Date.parse('2026-11-20T00:00:00Z');
    const times = [0, 1, 2, 3, 4].map(i => t0 + i * H);
    const o = U.outlookFromHourly({ timeMs: times, total: [10, 50, 25, null, 80], low: [0, 0, 0, 90, 0], mid: [0, 0, 0, 20, 0], high: [0, 0, 0, 40, 0] });
    ok(JSON.stringify(o.cloudPct) === JSON.stringify([10, 50, 25, 90, 80]), `총운량 우선, 비면 세 층 최대(90): ${JSON.stringify(o.cloudPct)}`);
    const o2 = U.outlookFromHourly({ timeMs: times.slice(0, 2), total: [null, undefined], low: [10, 10], mid: [20, undefined], high: [30, 30] });
    ok(o2.cloudPct[0] === 30 && o2.cloudPct[1] === null, '총운량이 없고 한 층이 비면 null');
    const st = (ms) => U.forecastAt(o, ms).state;
    ok(st(times[0]) === 'clear' && st(times[1]) === 'partly' && st(times[4]) === 'cloudy', '10% 맑음 · 50% 보통 · 80% 많음');
    const mid = U.forecastAt(o, t0 + 0.5 * H);
    ok(near(mid.cloudPct, 30, 1e-9) && mid.state === 'partly', `10% 와 50% 사이 한가운데는 30% 보통 (${mid.cloudPct})`);
    const edge = (a, b, f) => U.forecastAt(U.outlookFromHourly({ timeMs: [t0, t0 + H], total: [a, b] }), t0 + f * H);
    ok(edge(25, 25, 0.3).state === 'clear' && edge(25.01, 25.01, 0.3).state === 'partly', '경계 25% 는 맑음, 25.01% 는 보통');
    ok(edge(60, 60, 0.3).state === 'partly' && edge(60.01, 60.01, 0.3).state === 'cloudy', '경계 60% 는 보통, 60.01% 는 많음');
    ok(st(times[2] + 0.5 * H) === 'partly' && U.forecastAt(o, times[2] + 0.5 * H).cloudPct === 57.5 && st(times[3] + 0.5 * H) === 'cloudy', '25% 와 90% 사이는 57.5% 보통, 90% 와 80% 사이는 많음');
    const holes = U.outlookFromHourly({ timeMs: times.slice(0, 3), total: [10, null, 30] });
    const hs = (f) => U.forecastAt(holes, t0 + f * H).state;
    ok(hs(0) === 'clear' && hs(0.5) === 'unknown' && hs(1) === 'unknown' && hs(1.5) === 'unknown' && hs(2) === 'partly', `빈 시각(null): 정각의 값은 쓰고(10% 맑음, 30% 보통) 빈 값에 닿는 구간은 모름 — ${[0, 0.5, 1, 1.5, 2].map(hs).join(', ')}`);
    ok(U.forecastAt(o, t0 - 1).state === 'unknown' && U.forecastAt(o, times[4] + 1).state === 'unknown', '범위 밖은 모름');
    ok(U.forecastAt(null, t0).state === 'unknown' && U.forecastAt({ timeMs: [], cloudPct: [] }, t0).state === 'unknown' && U.forecastAt(null, t0).cloudPct === null, '자료가 없으면 모름, 구름 값도 null');
    ok(U.forecastAt(o, times[4]).state === 'cloudy', '마지막 시각 정확히는 값이 있다');
  }

  // ── [5] 점수 · 순위 ──
  console.log('\n[5] 점수와 순위');
  {
    const FROM = Date.parse('2026-11-20T09:00:00Z');
    const outlook = U.outlookFromHourly({ timeMs: Array.from({ length: 48 }, (_, i) => FROM + i * 3600e3), total: Array.from({ length: 48 }, (_, i) => (i < 24 ? 10 : 80)) });
    let n = 0;
    const hit = (o) => ({ body: 'moon', timeMs: FROM + (n++ % 10 + 1) * 3 * 3600e3, eastM: 0, southM: 0, latitude: null, longitude: null, groundElevM: 12, distM: 5500, azDeg: 120, altDeg: 5, diskDeg: 0.52, elDeg: 5, errDeg: 0.01, illum: 0.99, sunAltDeg: -8, visible: true, onWater: false, ...o });
    const grp = (h) => ({ best: h, count: 1, hits: [h] });
    const opt = { body: 'moon', latitude: LAT, longitude: LON, elevM: 575, outlook, searchFromMs: FROM };
    const T = (h) => FROM + h * 3600e3;
    const gA = grp(hit({ timeMs: T(2), illum: 0.99, sunAltDeg: -8 }));                 // 보름 · 황혼 · 맑음
    const gB = grp(hit({ timeMs: T(4), illum: 0.5, sunAltDeg: -8 }));                  // 반달
    const gC = grp(hit({ timeMs: T(6), illum: 0.02, sunAltDeg: -8 }));                 // 삭 → 제외
    const gD = grp(hit({ timeMs: T(8), illum: 0.99, sunAltDeg: 10 }));                 // 낮
    const gE = grp(hit({ timeMs: T(30), illum: 0.99, sunAltDeg: -8 }));                // 80% 구름
    const gF = grp(hit({ timeMs: T(12), illum: 0.99, sunAltDeg: -8, visible: false })); // 가려짐
    const gG = grp(hit({ timeMs: T(100), illum: 0.99, sunAltDeg: -8 }));               // 예보 밖
    const gH = grp(hit({ timeMs: T(14), illum: 0.99, sunAltDeg: -20 }));               // 깊은 밤
    const all = [gA, gB, gC, gD, gE, gF, gG, gH];
    const ranked = U.rankStands(all, opt);
    const want = new Map([[gA, 0.2 + 0.8 * 0.99], [gB, (0.2 + 0.8 * 0.5)], [gD, (0.2 + 0.8 * 0.99) * 0.45], [gE, (0.2 + 0.8 * 0.99) * 0.15], [gG, (0.2 + 0.8 * 0.99) * 0.65], [gH, (0.2 + 0.8 * 0.99) * 0.85]]);
    ok(ranked.length === 6, `후보 6 개(삭·가려진 것 제외): ${ranked.length}`);
    for (const [g, s] of want) {
      const c = ranked.find(r => r.group === g);
      ok(c && near(c.score, s, 1e-9), `점수 ${s.toFixed(4)} 기대, 실제 ${c ? c.score.toFixed(4) : '없음'} (illum ${g.best.illum}, 해 ${g.best.sunAltDeg}°, +${Math.round((g.best.timeMs - FROM) / 3600e3)} h)`);
    }
    const order = ranked.map(r => all.indexOf(r.group)).join(',');
    // 기대 순서는 위에서 손으로 계산한 점수를 내림차순으로 세운 것(손으로 순서를 따로 적지 않는다): A .992 · H .843 · G .645 · B .600 · D .446 · E .149
    const wantOrder = [...want.entries()].sort((x, y) => y[1] - x[1]).map(([g]) => all.indexOf(g)).join(',');
    ok(order === wantOrder && order === '0,7,6,1,3,4', `순서(번호): ${order} = 점수 내림차순 ${wantOrder}`);
    ok(ranked.map(r => r.recommended).join() === 'true,true,true,true,false,false', `추천 표시: ${ranked.map(r => r.recommended).join()} (0.5 이상만)`);
    ok(ranked.find(r => r.group === gA).forecast.state === 'clear' && ranked.find(r => r.group === gE).forecast.state === 'cloudy' && ranked.find(r => r.group === gG).forecast.state === 'unknown', '예보 상태: 맑음 · 많음 · 모름');
    ok(ranked.find(r => r.group === gA).sky === 'twilight' && ranked.find(r => r.group === gD).sky === 'day' && ranked.find(r => r.group === gH).sky === 'night', '하늘: 황혼 · 낮 · 밤');
    ok(ranked.find(r => r.group === gA).days === 0 && ranked.find(r => r.group === gG).days === 4, `며칠 뒤: 0 일, 4 일 (+100 h → ${ranked.find(r => r.group === gG).days})`);
    const withHidden = U.rankStands(all, { ...opt, includeHidden: true });
    const f = withHidden.find(r => r.group === gF);
    ok(withHidden.length === 7 && f && near(f.score, (0.2 + 0.8 * 0.99) * 0.1, 1e-9) && !f.recommended && withHidden[withHidden.length - 1].group === gF, `가려진 자리 포함: 점수 ×0.1(${f && f.score.toFixed(4)}), 맨 뒤, 추천 아님`);
    const byDate = U.sortStands(ranked, 'date');
    ok(byDate.every((c, i) => i === 0 || c.hit.timeMs >= byDate[i - 1].hit.timeMs), '날짜순 정렬은 오름차순');
    // 비슷한 점수(0.02 안)면 이른 날짜
    const t1 = grp(hit({ timeMs: T(20), illum: 0.99, sunAltDeg: -8 })), t2 = grp(hit({ timeMs: T(3), illum: 0.985, sunAltDeg: -8 }));
    const tie = U.rankStands([t1, t2], opt);
    ok(tie[0].group === t2, '점수 차 0.02 안이면 이른 날짜가 앞(0.99 와 0.985)');

    // 해
    const sunOpt = { ...opt, body: 'sun' };
    const sg = (alt, sunAlt = alt, extra = {}) => grp(hit({ body: 'sun', altDeg: alt, sunAltDeg: sunAlt, illum: undefined, timeMs: T(2), ...extra }));
    const sc = (alt) => { const r = U.rankStands([sg(alt)], sunOpt); return r.length ? r[0].score : 0; };
    ok(sc(3) === 1 && sc(8) === 1 && sc(15) === 0.75 && sc(20) === 0.75 && sc(30) === 0.5 && sc(40) === 0.5 && sc(60) === 0.3, `해 고도별 점수: 3°=${sc(3)} 8°=${sc(8)} 15°=${sc(15)} 20°=${sc(20)} 30°=${sc(30)} 40°=${sc(40)} 60°=${sc(60)}`);
    ok(sc(-0.5) === 1 && sc(-1.2) === 0, '해: −0.5° 는 그대로, −1.2° 는 지평선 아래라 후보 아님');
    ok(U.rankStands([sg(3)], sunOpt)[0].moon === undefined, '해는 달 정보가 없다');
  }

  // ── [6] 뜨는/지는/높음 · 달 모양 ──
  console.log('\n[6] 뜨는/지는, 달 모양');
  {
    // 독립: 좌우 1 분 차분으로 고도 기울기를 구해 뜨는 중 / 지는 중을 가린다.
    const alt = (ms) => A.bodySky('moon', ms, LAT, LON, 575).altDeg;
    let rise = null, set = null, high = null;
    for (let ms = Date.parse('2026-12-01T00:00:00Z'); ms < Date.parse('2026-12-20T00:00:00Z') && !(rise && set && high); ms += 20 * 60e3) {
      const a = alt(ms), slope = alt(ms + 60e3) - alt(ms - 60e3);
      if (!rise && a > 3 && a < 8 && slope > 0) rise = ms;
      if (!set && a > 3 && a < 8 && slope < 0) set = ms;
      if (!high && a > 40) high = ms;
    }
    ok(rise && set && high, '시험에 쓸 뜨는 · 지는 · 높은 순간을 찾았다');
    const ph = (ms) => U.eventPhase('moon', ms, LAT, LON, 575, alt(ms));
    ok(ph(rise) === 'rising' && ph(set) === 'setting' && ph(high) === 'high', `뜨는 중 ${ph(rise)}, 지는 중 ${ph(set)}, 높음 ${ph(high)}`);
    // 달 모양: SunCalc 위상 0.25 · 0.5 · 0.75 인 때를 찾아 견준다
    const findPhase = (target) => { let best = null; for (let ms = Date.parse('2026-12-01T00:00:00Z'); ms < Date.parse('2027-01-05T00:00:00Z'); ms += 3600e3) { const p = SunCalc.getMoonIllumination(new Date(ms)).phase; const d = Math.abs(p - target); if (!best || d < best.d) best = { ms, d }; } return best.ms; };
    const FROM = Date.parse('2026-12-01T00:00:00Z');
    const shapeAt = (ms) => {
      const h = { body: 'moon', timeMs: ms, eastM: 0, southM: 0, latitude: null, longitude: null, groundElevM: 12, distM: 5500, azDeg: 120, altDeg: 5, diskDeg: 0.52, elDeg: 5, errDeg: 0.01, sunAltDeg: -8, visible: true, onWater: false };
      return U.rankStands([{ best: h, count: 1, hits: [h] }], { body: 'moon', latitude: LAT, longitude: LON, elevM: 575, searchFromMs: FROM })[0].moon;
    };
    const q1 = shapeAt(findPhase(0.25)), fu = shapeAt(findPhase(0.5)), q3 = shapeAt(findPhase(0.75));
    ok(q1.waxing && q1.shape === 'quarter' && near(q1.illum, 0.5, 0.05), `위상 0.25: 차오름, 반달, 밝기 ${q1.illum.toFixed(2)}`);
    ok(fu.shape === 'full' && fu.illum > 0.97, `위상 0.5: 보름달 ${fu.illum.toFixed(3)}`);
    ok(!q3.waxing && q3.shape === 'quarter', '위상 0.75: 기울어짐, 반달');
    ok(U.moonShape(0.03) === 'new' && U.moonShape(0.031) === 'crescent' && U.moonShape(0.39) === 'crescent' && U.moonShape(0.4) === 'quarter' && U.moonShape(0.6) === 'quarter' && U.moonShape(0.61) === 'gibbous' && U.moonShape(0.969) === 'gibbous' && U.moonShape(0.97) === 'full', '모양 경계: 3% · 40% · 60% · 97%');
    ok(U.skyKind(0.1) === 'day' && U.skyKind(0) === 'twilight' && U.skyKind(-11.9) === 'twilight' && U.skyKind(-12) === 'night', '하늘 경계: 0° · −12°');
  }

  // ── [7] 대상 점과 질의 ──
  console.log('\n[7] 대상 점과 질의');
  {
    const g = () => 12, w = () => false, origin = { latitude: LAT, longitude: LON };
    const b = building(555, 70, false);   // 누른 곳을 대상으로 한 상태
    const q = U.standQueryFor({ target: b, body: 'moon', sizeM: 50, fromMs: 1e12, days: 90, origin, ground: g, isWater: w });
    ok(q && q.target.elevM === 575 && q.targetXZ.eastM === 120 && q.targetXZ.southM === -60 && q.target.latitude === LAT, `건물은 "누른 곳"이어도 지붕 한가운데(해발 ${q && q.target.elevM}, 동 ${q && q.targetXZ.eastM}, 남 ${q && q.targetXZ.southM})`);
    ok(q.ground === g && q.isWater === w && q.origin === origin && q.sizeM === 50 && q.days === 90 && q.body === 'moon', '표본기 · 물 · 틀 원점 · 크기 · 기간이 그대로 실린다');
    const tq = U.standQueryFor({ target: terrain(), body: 'sun', sizeM: 200, fromMs: 1e12, days: 30, origin, ground: g });
    ok(tq && tq.target.elevM === 400 && tq.targetXZ.eastM === 500 && tq.targetXZ.southM === -300, '땅은 고른 점 그대로');
    ok(U.standQueryFor({ target: terrain({ latitude: null, longitude: null }), body: 'moon', sizeM: 50, fromMs: 1, days: 1, origin, ground: g }) === null, '위경도를 모르면 질의 없음');
    ok(U.suggestTargetPoint(building(100, 20, true)).elevM === 120, '건물 대상 점의 해발은 지붕(20 + 100)');
  }

  // ── [8] 통합 ──
  console.log('\n[8] 평지에서 찾기 → 묶기 → 순위');
  {
    const FROM = Date.parse('2026-11-19T00:00:00Z');
    const q = U.standQueryFor({ target: terrain({ latitude: LAT, longitude: LON, elevM: 575, eastM: 0, southM: 0 }), body: 'moon', sizeM: 50, fromMs: FROM, days: 90, origin: { latitude: LAT, longitude: LON }, ground: () => 12, isWater: () => false });
    const hits = await F.findStandPoints(q);
    const groups = F.groupStandHits(hits);
    const outlook = U.outlookFromHourly({ timeMs: Array.from({ length: 24 * 14 }, (_, i) => FROM + i * 3600e3), total: Array.from({ length: 24 * 14 }, (_, i) => ((i / 24) | 0) % 3 === 0 ? 10 : 70) });
    const ranked = U.rankStands(groups, { body: 'moon', latitude: LAT, longitude: LON, elevM: 575, outlook, searchFromMs: FROM });
    // 뜨는 쪽 · 지는 쪽이 하루 하나씩이고 6 시간 넘게 떨어져 있어 묶어도 줄지 않는다. 순위에서는 삭(밝기 5% 미만)만 빠진다 — 독립 길: SunCalc 로 센 개수.
    const notNew = hits.filter(h => SunCalc.getMoonIllumination(new Date(h.timeMs)).fraction >= 0.05).length;
    ok(groups.length === hits.length && ranked.length === notNew && notNew < hits.length, `90 일: 후보 ${hits.length} = 묶음 ${groups.length}, 순위 ${ranked.length} = 삭이 아닌 후보 ${notNew}`);
    ok(ranked.every((c, i) => i === 0 || c.score <= ranked[i - 1].score + 1e-9 || Math.abs(c.score - ranked[i - 1].score) <= 0.02), '점수 내림차순(0.02 안은 날짜로 갈림)');
    ok(ranked.every(c => c.hit.visible && c.moon && c.moon.illum >= 0.05), '모두 보이고 삭(5% 미만)이 없다');
    ok(ranked.every(c => c.recommended === (c.score >= 0.5)), '추천 표시가 점수와 같다');
    const lastOutlookMs = FROM + (24 * 14 - 1) * 3600e3;   // 위 자료의 마지막 시각(335 시간째)
    ok(ranked.every(c => (c.forecast.state === 'unknown') === (c.hit.timeMs > lastOutlookMs || c.hit.timeMs < FROM)), '예보 자료가 있는 14 일 안은 맑음·보통·많음, 그 밖은 모름');
    const top = ranked.slice(0, 5);
    ok(top.every(c => c.forecast.state !== 'cloudy' && c.moon.illum > 0.5), `위 5 곳은 구름 많음이 아니고 반달보다 밝다 (${top.map(c => `${c.moon.illum.toFixed(2)}/${c.forecast.state}`).join(', ')})`);
    const rec = ranked.filter(c => c.recommended).length;
    ok(rec > 0 && rec < ranked.length, `추천 ${rec} 곳은 전체 ${ranked.length} 곳의 일부`);

    // 날마다 하나씩이라 목록을 거른다: 같은 쪽(뜨는/지는)에서 2 일 안의 것은 건너뛰고, 뜨는 쪽과 지는 쪽은 따로
    const picks = U.pickDistinct(ranked, 12, 2);
    const closePair = picks.some((a, i) => picks.some((b, j) => j > i && a.phase === b.phase && Math.abs(a.hit.timeMs - b.hit.timeMs) < 2 * 86400e3));
    ok(picks.length === 12 && !closePair && picks.every((c, i) => c === ranked.find(r => r === c) && (i === 0 || ranked.indexOf(c) > ranked.indexOf(picks[i - 1]))), `12 곳을 고르고, 같은 쪽 2 일 안은 없고, 순위 순서 그대로 (${picks.map(c => c.phase[0]).join('')})`);
    ok(picks.some(c => c.phase === 'rising') && picks.some(c => c.phase === 'setting'), '뜨는 쪽과 지는 쪽이 둘 다 들어 있다');
    // 탐욕 성질: 건너뛴 것은 모두, 이미 고른 같은 쪽·2 일 안의 더 높거나 같은 점수가 있었다(목록이 다 차기 전까지)
    const idx12 = ranked.indexOf(picks[picks.length - 1]);
    const skippedOk = ranked.slice(0, idx12).filter(c => !picks.includes(c)).every(c => picks.some(p => p.phase === c.phase && Math.abs(p.hit.timeMs - c.hit.timeMs) < 2 * 86400e3 && ranked.indexOf(p) < ranked.indexOf(c)));
    ok(skippedOk, '건너뛴 후보는 모두 더 높은 순위의 같은 쪽 가까운 날 후보가 있었기 때문이다');
    const syn = (days, phase, score) => ({ phase, score, hit: { timeMs: FROM + days * 86400e3 } });
    const sp = U.pickDistinct([syn(10, 'rising', 0.9), syn(11, 'rising', 0.8), syn(11, 'setting', 0.7), syn(12, 'rising', 0.6), syn(13.5, 'rising', 0.5)], 10, 2);
    ok(sp.map(c => `${(c.hit.timeMs - FROM) / 86400e3}${c.phase[0]}`).join() === '10r,11s,12r', `합성: 10일 뜨는 · 11일 뜨는(1일 차라 제외) · 11일 지는(다른 쪽이라 포함) · 12일 뜨는(정확히 2일 차라 포함) · 13.5일 뜨는(12일과 1.5일 차라 제외) → ${sp.map(c => `${(c.hit.timeMs - FROM) / 86400e3}${c.phase[0]}`).join()}`);
    ok(U.pickDistinct([syn(1, 'rising', 1), syn(5, 'rising', 0.9), syn(9, 'rising', 0.8)], 2, 2).length === 2, '개수 상한을 지킨다');
  }

  console.log(`\n${fail === 0 ? '모두 통과' : '실패 있음'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
