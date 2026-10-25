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

  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
