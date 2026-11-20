/**
 * **02 예보** — 16일 해 쪽 줄 자료로 날마다 일출 · 일몰 판정(`src/utils/sunForecast.ts`).
 *
 * ## ⚠ 재기 전에 정한 문턱 (2026-10-25, 화면보다 먼저 박았습니다)
 *
 * - **P0 방위**: 서울 · 오슬로 · 시드니, 2026-10-25 부터 16일 — 날마다 일출 · 일몰 방위가 그쪽 두 방위 사이에
 *   들고, 두 방위 간격은 60° 이하.
 * - **P1 요청**: 33점(관측점 + 2쪽 × 2방위 × 링 거리 8), 첫 점이 관측점, `forecast_days=16` · 링과 같은 모델 ·
 *   `timezone=auto`.
 * - **P2 링과 같다**: 거리로만 달라지는 구름 마당이면, 같은 날 일몰 판정이 16일 자료와 링에서 같다(점수 차 0,
 *   가장 붉을 때 같음). 링을 넘기면(`ringFor`) 그날은 출처가 `ring`.
 * - **P3 예보 없음**: 관측점 운량이 7일째부터 비면(null), 그 뒤 출몰은 점수 · 판정 · 출처가 모두 null 이고
 *   앞쪽 출몰은 모두 점수가 있다. 맑음으로 지어내지 않는다.
 * - **P4 쪽을 섞지 않는다**: 일몰 쪽 줄만 저층 95 % 면, 자료가 있는 모든 날 일몰 점수 < 일출 점수.
 * - **P5 가장 좋은 때**: 지난 출몰과 7일 너머(`low`)는 고르지 않고, 남은 것 중 점수가 가장 높은 것.
 * - **P6 시간**: 16일 × 2 출몰 판정이 Node 에서 300 ms 이하(기기는 몇 배 느리다고 보고 잡은 값).
 * - **P7 이유 문장**(2026-11-19, 01 하늘 카드와 02 예보 강조 카드가 씁니다): 점수가 있는 출몰은 `description` 이 비어 있지 않은 글이고 예측의 것과 같으며,
 *   예보 없는 출몰은 null. 가장 붉을 때 카드의 문장이 판정과 따로 놀지 않게 합니다.
 * - **P8 날 수**: `days` 를 주면 그만큼만 셉니다(3 이면 오늘 포함 3 날). 안 주면 16일.
 * - **P9 "왜 좋은가요"**(2026-11-20, 02 예보 머리 카드의 단추가 여는 계산 과정, `scoreInputFor`):
 *     (a) 같은 자료 · 같은 칸이면 입력의 예측 점수 · 가장 붉을 때 · 출몰 시각 · 쪽이 02 칸(`buildForecastDays`)과 같다. 16일 예보로 센 칸(내일 일몰 · 내일 일출)과
 *         링으로 센 칸(오늘 일몰) 모두.
 *     (b) 그 입력으로 만든 계산 과정 카드(`buildSunsetScoreCards`)의 맨 끝 점수가 칸의 점수와 같고, 점수 카드의 글이 `${판정} ${Math.round(점수)}` 로 칸에 보이는 정수와 같다.
 *     (c) 링은 관측점(거리 0)과 해 쪽 줄(방위 0 · 거리 > 0)을 가지고, 해 쪽 줄의 점 수는 `RING_DISTANCES_KM` 길이와 같다.
 *     (d) 칸을 센 자료가 아니면 null: 받은 시간 밖의 출몰(7일째부터 빈 자료), 그날을 안 덮는 링(오늘 링으로 내일 칸), 빈 배열 · null · undefined. 없는 값을 지어내지 않는다.
 *     (f) 링과 해 방위가 그 시각(가장 붉을 때)의 것이다: 구름이 방위뿐 아니라 시각에도 따라 달라지는 자료 — 일몰 쪽 두 방위 가운데 앞 방위는 저층이 17시에 90 % 에서 18시에 30 % 로,
 *         뒤 방위는 17시 60 % 에서 18시 0 % 로(둘 다 한 시간에 60 점씩 직선으로 줄어듦) — 에서, 입력의 해 쪽 줄 첫 고리의 저층 값이 **다른 구현(SunCalc 1.9.0)** 의 가장 붉을 때 해 방위로
 *         두 방위를 각도 비율 t 로 보간하고 시각 비율 f(17시 기준)로 시간 보간한 기대 (1−t)·(90−60f) + t·(60−60f) = 90 − 30t − 60f 와 1.0 안으로 같고, 입력의 해 방위가 SunCalc 값과 0.2° 안이다.
 *         이 검사가 "출몰 시각으로 잘못 읽는 것"(방위든 링이든)을 잡을 수 있으려면 출몰 시각으로 읽은 기대와 가장 붉을 때의 기대가 3 이상 달라야 한다 — 같으면 검사가 못 쓰이므로 실패로 친다.
 *         (첫 시도는 앞 방위 90→30, 뒤 방위 0→60 으로 했는데 t≈0.58 에서 두 방위의 시간 변화가 서로 상쇄돼 분별력이 1.33 에 그쳤습니다(기준 3 미달). 기준은 그대로 두고 둘이 같은 쪽으로 줄도록 자료를 바꿨습니다.)
 *     (g) 관측 높이도 칸과 같다: 1500 m 로 센 칸의 점수와 같은 높이로 만든 입력의 점수가 같고, 이 점수는 10 m 로 센 점수와 다르다(다르지 않으면 높이를 빠뜨려도 못 잡으므로 실패로 친다).
 *     (e) 앱 연결(소스 정규식): 훅의 `inputFor` 가 칸의 `source` 로 자료를 고르고(`ring` 이면 그날 링, 아니면 16일 예보) `source` 가 없으면 null 이다. 02 예보 머리 카드에 단추가 둘이고
 *         "왜 좋은가요" 는 `setWhy(focusEvent)`, 모달은 `initialTopic="score"` · 주제에 별 보기가 없고 `getScoreInput` 이 `inputFor(why)`, 단추 글은 `isGoodOrBetter` 로 정한다.
 *         계산 과정 틀은 `topics` 를 안 주면 주제 칩 넷을 모두 보인다.
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-sun-forecast.js
 */
// 앱의 `timeMs` 는 시각 문자열을 기기 현지시로 읽습니다 — 관측지와 같은 시간대로 둡니다.
process.env.TZ = 'Asia/Seoul';
const path = require('path');
const { PREVIEW } = require('./paths');

globalThis.__DEV__ = false;
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const U = (m) => import('file://' + path.join(PREVIEW, 'app', 'utils', m));
  const F = await U('sunForecast.js');
  const SP = await U('solarPosition.js');
  const W = await U('weather.js');

  const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
  const now = new Date('2026-10-25T09:00:00+09:00');
  const TZ = 9, LAT = 37.28, LON = 126.57;

  // ── P0 방위
  const sites = [['서울', 37.5, 127.0, 9], ['오슬로', 59.9, 10.75, 1], ['시드니', -33.9, 151.2, 11]];
  const p0 = sites.map(([name, la, lo, tz]) => {
    const noons = F.localNoons(now, tz, 16);
    const b = F.sideBearings(la, lo, noons);
    let inside = true, width = 0;
    for (const side of ['sunrise', 'sunset']) {
      const [x, y] = b[side];
      width = Math.max(width, Math.abs(wrap(y - x)));
      for (const n of noons) {
        const at = SP.sunTimes(new Date(n), la, lo)[side];
        const az = SP.sunPosition(at, la, lo).azimuth * 180 / Math.PI + 180;
        if (!(wrap(az - x) >= 0 && wrap(y - az) >= 0)) inside = false;
      }
    }
    return { name, inside, width, b };
  });
  ok(p0.every(s => s.inside && s.width <= 60),
     `P0 출몰 방위가 두 방위 사이 — ${p0.map(s => `${s.name} 일출 ${s.b.sunrise.map(v => v.toFixed(1)).join('~')} · 일몰 ${s.b.sunset.map(v => v.toFixed(1)).join('~')} (폭 ≤ ${s.width.toFixed(1)}°)`).join(' / ')}`);

  // ── P1 요청
  const bearings = F.sideBearings(LAT, LON, F.localNoons(now, TZ, 16));
  const pts = F.forecastPoints(LAT, LON, bearings);
  const url = F.sunForecastUrl(pts);
  const nLat = new URL(url).searchParams.get('latitude').split(',').length;
  ok(pts.length === 33 && nLat === 33 && pts[0].dist === 0 && pts[0].lat === LAT && /forecast_days=16/.test(url) &&
     /models=ecmwf_ifs025,icon_seamless/.test(url) && /timezone=auto/.test(url),
     `P1 요청 ${pts.length}점 · 위도 ${nLat}개 · 첫 점 관측점 · forecast_days=16 · 링 모델 · timezone=auto`);

  // ── 합성 자료
  const HOURS = 16 * 24;
  const t0 = new Date('2026-10-25T00:00:00+09:00').getTime();
  const pad = (n) => String(n).padStart(2, '0');
  const localStr = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`; };
  const times = Array.from({ length: HOURS }, (_, h) => localStr(t0 + h * 3600e3));
  /** field(dist, side) → {low, mid, high}; nullAfterH: 관측점이 이 시각부터 빔 */
  const response = (field, nullAfterH = Infinity) => pts.map((p) => {
    const side = p.dist === 0 ? null : (bearings.sunrise.includes(p.az) ? 'sunrise' : 'sunset');
    const c = field(p.dist, side);
    const col = (v) => times.map((_, h) => (p.dist === 0 && h >= nullAfterH ? null : v));
    return { hourly: { time: times, cloud_cover_low: col(c.low), cloud_cover_mid: col(c.mid), cloud_cover_high: col(c.high), relative_humidity_2m: times.map(() => 60) } };
  });
  const OBS = { low: 0, mid: 40, high: 20 };
  const byDist = (d) => (d === 0 ? OBS : { low: Math.min(90, d / 5), mid: 30 + d / 20, high: 25 });
  const fc = F.pathFromResponse(pts, response((d) => byDist(d)));

  // 같은 마당의 그날 링(앱 링과 같은 모양, 24시간)
  const NEAR = [0, 60, 120, 180, -120, -60], FAR = [0, 30, 60, 90, 120, 150, 180, -150, -120, -90, -60, -30];
  const dayTimes = times.slice(0, 24);
  const mkRing = (field) => {
    const pt = (distance, azimuthOffset, c) => ({
      distance, azimuthOffset, source: 'standard',
      hourly: {
        time: dayTimes, timeMs: dayTimes.map(t => new Date(t).getTime()),
        low: dayTimes.map(() => c.low), mid: dayTimes.map(() => c.mid), high: dayTimes.map(() => c.high),
        humidity: distance === 0 ? dayTimes.map(() => 60) : undefined,
      },
    });
    const out = [pt(0, 0, OBS)];
    for (const d of W.RING_DISTANCES_KM) for (const az of (d === 5 ? NEAR : FAR)) out.push(pt(d, az, field(d)));
    for (const p of out.filter(p => p.azimuthOffset === 180)) out.push({ ...p, azimuthOffset: -180 });
    return out;
  };
  const ring = mkRing(byDist);

  // ── P2 링과 같다
  const today = SP.sunTimes(new Date(F.localNoons(now, TZ, 1)[0]), LAT, LON).sunset;
  const vf = F.eventVerdict(fc, today, 'sunset', LAT, LON, 10);
  const vr = F.eventVerdict(ring, today, 'sunset', LAT, LON, 10);
  const daysWithRing = F.buildForecastDays({
    latitude: LAT, longitude: LON, now, tzHours: TZ, observerElevM: 10, forecast: fc,
    ringFor: (at) => (at.getTime() - t0 < 24 * 3600e3 ? ring : null),
  });
  const d0 = daysWithRing[0].sunset, d1 = daysWithRing[1].sunset;
  ok(vf && vr && vf.score === vr.score && vf.time.getTime() === vr.time.getTime() && d0.source === 'ring' && d0.score === vr.score && d1.source === 'forecast',
     `P2 오늘 일몰 16일 ${vf?.score} @${vf?.time.toTimeString().slice(0, 5)} = 링 ${vr?.score} @${vr?.time.toTimeString().slice(0, 5)} · 오늘 출처 ${d0.source} · 내일 ${d1.source}`);

  // ── P3 예보 없음
  const nullAfter = 6 * 24;
  const fcHole = F.pathFromResponse(pts, response((d) => byDist(d), nullAfter));
  const daysHole = F.buildForecastDays({ latitude: LAT, longitude: LON, now, tzHours: TZ, observerElevM: 10, forecast: fcHole });
  const evs = daysHole.flatMap(d => [d.sunrise, d.sunset]).filter(Boolean);
  const cut = t0 + nullAfter * 3600e3;
  const late = evs.filter(e => e.at.getTime() >= cut), early = evs.filter(e => e.at.getTime() + 31 * 60e3 < cut);
  ok(late.length > 0 && late.every(e => e.score == null && e.quality == null && e.source == null) && early.every(e => e.score != null),
     `P3 7일째부터 빈 자료 — 뒤 ${late.length}개 출몰 모두 예보 없음 · 앞 ${early.length}개 모두 점수 있음`);

  // ── P7 이유 문장
  const withScore = evs.filter(e => e.score != null), noScore = evs.filter(e => e.score == null);
  ok(withScore.length > 0 && withScore.every(e => typeof e.description === 'string' && e.description.length > 0) && noScore.every(e => e.description === null),
     `P7 점수 있는 ${withScore.length}개 출몰은 이유 문장이 있고 예보 없는 ${noScore.length}개는 null`);
  const vSame = F.eventVerdict(fc, today, 'sunset', LAT, LON, 10);
  ok(!!vSame && d0.description === vSame.prediction.description, `P7 오늘 일몰의 이유 문장이 예측의 것과 같다 ("${String(d0.description).slice(0, 36)}…")`);

  // ── P8 날 수
  const days3 = F.buildForecastDays({ latitude: LAT, longitude: LON, now, tzHours: TZ, observerElevM: 10, forecast: fc, days: 3 });
  const days16 = F.buildForecastDays({ latitude: LAT, longitude: LON, now, tzHours: TZ, observerElevM: 10, forecast: fc });
  ok(days3.length === 3 && days16.length === 16 && days3.every((d, i) => d.noonMs === days16[i].noonMs && d.sunset?.score === days16[i].sunset?.score), `P8 days 3 → ${days3.length}날, 기본 ${days16.length}날, 앞 3날은 같은 값`);

  // ── P4 쪽을 섞지 않는다
  const fcWest = F.pathFromResponse(pts, response((d, side) => (d === 0 ? OBS : side === 'sunset' ? { low: 95, mid: 0, high: 0 } : { low: 0, mid: 0, high: 0 })));
  const daysWest = F.buildForecastDays({ latitude: LAT, longitude: LON, now, tzHours: TZ, observerElevM: 10, forecast: fcWest });
  const pairs = daysWest.filter(d => d.sunrise?.score != null && d.sunset?.score != null);
  ok(pairs.length >= 14 && pairs.every(d => d.sunset.score < d.sunrise.score),
     `P4 일몰 쪽만 막힘 — ${pairs.length}일 모두 일몰 < 일출 (예: ${pairs[0]?.sunset.score} < ${pairs[0]?.sunrise.score})`);

  // ── P5 가장 좋은 때
  const fake = (side, atMs, score, tier) => ({ side, at: new Date(atMs), peakAt: new Date(atMs), score, quality: 'Fair', tier, source: 'forecast' });
  const nowMs = now.getTime();
  const days5 = [
    { noonMs: 0, sunrise: fake('sunrise', nowMs - 3600e3, 99, 'past'), sunset: fake('sunset', nowMs + 8 * 3600e3, 40, 'high') },
    { noonMs: 1, sunrise: fake('sunrise', nowMs + 30 * 3600e3, 70, 'high'), sunset: fake('sunset', nowMs + 100 * 3600e3, 72, 'medium') },
    { noonMs: 2, sunrise: fake('sunrise', nowMs + 200 * 3600e3, 95, 'low'), sunset: null },
  ];
  const best = F.bestUpcoming(days5, now);
  ok(best && best.score === 72 && best.side === 'sunset', `P5 지난 99 · 7일 너머 95 는 빼고 72(${best?.side}) 를 고름`);

  // ── P6 시간
  const t1 = process.hrtime.bigint();
  const daysPerf = F.buildForecastDays({ latitude: LAT, longitude: LON, now, tzHours: TZ, observerElevM: 10, forecast: fc });
  const ms = Number(process.hrtime.bigint() - t1) / 1e6;
  const nEv = daysPerf.flatMap(d => [d.sunrise, d.sunset]).filter(e => e?.score != null).length;
  ok(ms <= 300, `P6 16일 × 2 판정(${nEv}개 출몰) ${ms.toFixed(0)} ms ≤ 300`);

  // ── P9 "왜 좋은가요"
  {
    const C = await U('calcSteps.js');
    const fs = require('fs');
    const { REPO_ROOT } = require('./paths');
    const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const cardsOf = (inp) => C.buildSunsetScoreCards({ ...inp, language: 'ko', fmtTime: hhmm, qualityWord: (q) => q });
    const cases = [
      ['오늘 일몰(링)', ring, daysWithRing[0].sunset, 'ring'],
      ['내일 일몰(16일 예보)', fc, daysWithRing[1].sunset, 'forecast'],
      ['내일 일출(16일 예보)', fc, daysWithRing[1].sunrise, 'forecast'],
    ];
    for (const [name, pth, ev, src] of cases) {
      const inp = F.scoreInputFor(pth, ev.at, ev.side, LAT, LON, 10);
      ok(!!inp && ev.source === src && inp.prediction.score === ev.score && inp.time.getTime() === ev.peakAt.getTime() && inp.eventMs === ev.at.getTime() && inp.kind === ev.side,
         `P9a ${name}: 칸(출처 ${ev.source}, 점수 ${ev.score?.toFixed(2)}, 가장 붉을 때 ${hhmm(ev.peakAt.getTime())})와 입력의 점수 · 시각 · 쪽이 같다`);
      const cr = inp ? cardsOf(inp) : null;
      const sc = cr?.cards.find(c => c.id === 'score');
      ok(!!cr && cr.score === ev.score && !!sc && sc.result === `${ev.quality} ${Math.round(ev.score)}`,
         `P9b ${name}: 계산 과정 맨 끝 점수 ${cr?.score?.toFixed(2)} = 칸 ${ev.score?.toFixed(2)}, 점수 카드 "${sc?.result}" = "${ev.quality} ${Math.round(ev.score)}"`);
    }
    const inpR = F.scoreInputFor(ring, daysWithRing[0].sunset.at, 'sunset', LAT, LON, 10);
    const sunLine = inpR.ring.filter(p => p.distance > 0 && p.azimuthOffset === 0);
    ok(inpR.ring.some(p => p.distance === 0) && sunLine.length === W.RING_DISTANCES_KM.length && sunLine.every((p, i, a) => i === 0 || p.distance > a[i - 1].distance),
       `P9c 링: 관측점 있음 · 해 쪽 줄 ${sunLine.length}점(= 거리 ${W.RING_DISTANCES_KM.length}개), 거리 오름차순`);
    const lateEv = late[0];
    ok(F.scoreInputFor(fcHole, lateEv.at, lateEv.side, LAT, LON, 10) === null && F.scoreInputFor(ring, daysWithRing[1].sunset.at, 'sunset', LAT, LON, 10) === null &&
       F.scoreInputFor([], lateEv.at, 'sunset', LAT, LON) === null && F.scoreInputFor(null, lateEv.at, 'sunset', LAT, LON) === null && F.scoreInputFor(undefined, lateEv.at, 'sunset', LAT, LON) === null,
       'P9d 자료가 없는 시각(7일째부터 빈 자료) · 그날을 안 덮는 링(오늘 링으로 내일 칸) · 빈 배열 · null · undefined 는 모두 null');

    // (f) 방위와 시각에 따라 구름이 다른 자료: 일몰 쪽 앞 방위 저층 17시 90 % → 18시 30 %, 뒤 방위 17시 60 % → 18시 0 %(직선). 해 쪽 줄 값이 해 방위와 시각으로 정해지므로 잘못 읽으면 값이 달라집니다.
    {
      const SunCalc = require('suncalc');
      const [b0, b1] = bearings.sunset;
      const ramp = (H) => Math.max(0, Math.min(1, H - 17));
      const hourOf = (h) => new Date(t0 + h * 3600e3).getHours();
      const respAz = pts.map((p) => {
        const lowAt = (h) => (p.dist === 0 ? 0 : p.az === b0 ? 90 - 60 * ramp(hourOf(h)) : p.az === b1 ? 60 - 60 * ramp(hourOf(h)) : 0);
        return { hourly: { time: times, cloud_cover_low: times.map((_, h) => lowAt(h)), cloud_cover_mid: times.map(() => (p.dist === 0 ? 40 : 0)), cloud_cover_high: times.map(() => (p.dist === 0 ? 20 : 30)), relative_humidity_2m: times.map(() => 60) } };
      });
      const fcAz = F.pathFromResponse(pts, respAz);
      const dAz = F.buildForecastDays({ latitude: LAT, longitude: LON, now, tzHours: TZ, observerElevM: 10, forecast: fcAz });
      const ev = dAz[1].sunset;
      const inp = F.scoreInputFor(fcAz, ev.at, 'sunset', LAT, LON, 10);
      const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
      const deg = (ms) => SunCalc.getPosition(new Date(ms), LAT, LON).azimuth * 180 / Math.PI + 180;
      const date17 = new Date(ev.at); date17.setHours(17, 0, 0, 0);
      const expectAt = (ms) => {
        const t = wrap180(deg(ms) - b0) / wrap180(b1 - b0);
        const f = Math.max(0, Math.min(1, (ms - date17.getTime()) / 3600e3));
        return { t, f, low: (1 - t) * (90 - 60 * f) + t * (60 - 60 * f) };
      };
      const ePeak = expectAt(inp.time.getTime()), eEvent = expectAt(ev.at.getTime());
      const first = inp.ring.find(q => q.distance === W.RING_DISTANCES_KM[0] && q.azimuthOffset === 0);
      const gapMin = Math.abs(inp.time.getTime() - ev.at.getTime()) / 60e3;
      ok(ePeak.t > 0 && ePeak.t < 1 && Math.abs(first.low - ePeak.low) <= 1.0 && Math.abs(wrap180(inp.sunAzDeg - deg(inp.time.getTime()))) <= 0.2,
         `P9f 가장 붉을 때(출몰과 ${gapMin.toFixed(0)}분 차)의 해 방위 ${inp.sunAzDeg.toFixed(2)}° (SunCalc ${deg(inp.time.getTime()).toFixed(2)}°) · 해 쪽 첫 고리 저층 ${first.low.toFixed(2)} = 기대 ${ePeak.low.toFixed(2)} (t=${ePeak.t.toFixed(3)}, f=${ePeak.f.toFixed(3)})`);
      ok(Math.abs(eEvent.low - ePeak.low) > 3, `P9f 검사의 분별력: 출몰 시각으로 읽으면 기대 ${eEvent.low.toFixed(2)} 로 가장 붉을 때의 ${ePeak.low.toFixed(2)} 와 ${Math.abs(eEvent.low - ePeak.low).toFixed(2)} 차(> 3)`);
    }

    // (g) 관측 높이: 1500 m 로 센 칸과 같은 높이로 만든 입력의 점수가 같고, 10 m 점수와는 다르다.
    {
      const h1500 = F.buildForecastDays({ latitude: LAT, longitude: LON, now, tzHours: TZ, observerElevM: 1500, forecast: fc })[1].sunset;
      const h10 = F.buildForecastDays({ latitude: LAT, longitude: LON, now, tzHours: TZ, observerElevM: 10, forecast: fc })[1].sunset;
      const inp = F.scoreInputFor(fc, h1500.at, 'sunset', LAT, LON, 1500);
      ok(!!inp && inp.prediction.score === h1500.score && h1500.score !== h10.score,
         `P9g 관측 높이: 1500 m 칸 ${h1500.score?.toFixed(2)} = 같은 높이 입력 ${inp?.prediction.score.toFixed(2)}, 10 m 점수 ${h10.score?.toFixed(2)} 와는 다르다`);
    }

    const read = (...pp) => fs.readFileSync(path.join(REPO_ROOT, 'src', ...pp), 'utf8');
    const hook = read('hooks', 'useForecastDays.ts');
    const scr = read('components', 'ForecastScreen', 'ForecastScreen.tsx');
    const calc = read('components', 'CalcSteps', 'CalcStepsModal.tsx');
    const inputFor = (hook.match(/const inputFor = useCallback\([\s\S]*?\}, \[[^\]]*\]\);/) || [''])[0];
    ok(/if \(lat == null \|\| lon == null \|\| !ev\.source\) return null;/.test(inputFor) && /scoreInputFor\(ev\.source === 'ring' \? ringFor\(ev\.at\) : forecast, ev\.at, ev\.side, lat, lon, elev\)/.test(inputFor) &&
       /return \{ days, forecast, load, get, now, inputFor \};/.test(hook),
       'P9e 훅: inputFor 가 칸의 source 로 자료(링 또는 16일 예보)를 고르고 source 가 없으면 null, 반환에 포함');
    const modal = (scr.match(/<CalcStepsModal[\s\S]*?\/>/) || [''])[0];
    const btns = (scr.match(/<View style=\{styles\.focusBtns\}>[\s\S]*?<\/View>\s*<\/View>/) || [''])[0];
    ok((btns.match(/<PressScale/g) || []).length === 2 && /onPress=\{\(\) => open\(focusEvent\)\}/.test(btns) && /onPress=\{\(\) => setWhy\(focusEvent\)\}/.test(btns) &&
       /initialTopic="score"/.test(modal) && /topics=\{\['score', 'sunrise', 'sunset'\]\}/.test(modal) && !/stars/.test(modal) && /getScoreInput=\{\(\) => \(why \? inputFor\(why\) : null\)\}/.test(modal) &&
       /visible=\{why != null\}/.test(modal) && /isGoodOrBetter\(q\)\s*\?\s*L3\(language, '왜 좋은가요'/.test(scr),
       'P9e 02 예보: 머리 카드 단추 둘(하늘 보기 · 왜 좋은가요→setWhy), 모달 score 주제 · 별 보기 없음 · getScoreInput=inputFor(why), 좋음 이상만 "왜 좋은가요"');
    ok(/const shows = \(t: CalcTopic\) => !topics \|\| topics\.includes\(t\);/.test(calc) && ['score', 'sunrise', 'sunset', 'stars'].every(t => new RegExp(`\\{shows\\('${t}'\\) && <Chip`).test(calc)),
       'P9e 계산 과정 틀: topics 를 안 주면 주제 칩 넷 모두, 주면 그 주제만');
    ok(['Overcast', 'Muted', 'Fair'].every(q => !F.isGoodOrBetter(q)) && ['Great', 'Epic'].every(q => F.isGoodOrBetter(q)) && !F.isGoodOrBetter(null) && !F.isGoodOrBetter(undefined),
       'P9e 단추 글의 기준 isGoodOrBetter: 좋음 · 훌륭함만 true, 보통 이하와 null 은 false');
  }

  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
