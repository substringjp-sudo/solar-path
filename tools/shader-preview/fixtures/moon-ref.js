#!/usr/bin/env node
/**
 * 달 위치·출몰과 "해·달 걸기" 탐색의 **바깥 자** — astronomy-engine 으로 표를 만들어 옆의
 * moon-ref.json · align-ref.json 에 둡니다.
 *
 * 앱의 달(src/utils/moonPosition.ts, Meeus 47 장 주기항)과 탐색(src/utils/alignSearch.ts)을 앱 밖의
 * 구현에 대어 보려는 것입니다. astronomy-engine 은 달의 겉보기 위치를 약 1′ 안으로 냅니다
 * (장동·광행차·관측지 시차 포함). 굴절은 'normal'(표준 대기) 옵션으로 따로 얻고, 기하 고도도 함께 적습니다.
 * 이 모듈은 `@takram/three-atmosphere` 가 끌고 오는 의존이라 `node_modules` 에 있습니다 — 앱 번들에는
 * 들어가지 않고, **이 표를 만들 때만** 씁니다.
 *
 * 이 표는 커밋해 둡니다. 판정(verify-moon-position.js · verify-align-search.js)이 어떤 천문 라이브러리도
 * 없이 돌게 하려는 것이고, 다시 만들 일은 장소·시각을 바꿀 때뿐입니다:
 *
 *     node tools/shader-preview/fixtures/moon-ref.js
 *
 * 관측지 해발은 0 으로 둡니다: astronomy-engine 의 출몰은 해발을 쓰지 않는 평평한 수평선을 가정합니다.
 */
const fs = require('fs');
const path = require('path');
const A = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'astronomy-engine'));

const HERE = __dirname;
const R = Math.PI / 180;

const PLACES = [
  ['fukui', 36.0209, 136.2894], ['seoul', 37.5665, 126.978], ['tokyo', 35.6762, 139.6503],
  ['london', 51.5072, -0.1276], ['sydney', -33.8688, 151.2093], ['quito', -0.1807, -78.4678],
  ['reykjavik', 64.1466, -21.9426], ['honolulu', 21.3069, -157.8583],
];
const DATES = ['2026-01-15', '2026-03-20', '2026-06-21', '2026-09-23', '2026-10-02', '2026-12-21'];
const HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];

const round = (x, n) => Math.round(x * 10 ** n) / 10 ** n;

function sky(body, ms, obs, refraction) {
  const d = new Date(ms);
  const eq = A.Equator(body, d, obs, true, true);
  const h = A.Horizon(d, obs, eq.ra, eq.dec, refraction);
  return { az: h.azimuth, alt: h.altitude };
}
const sep = (a1, e1, a2, e2) => {
  const c = Math.sin(e1 * R) * Math.sin(e2 * R) + Math.cos(e1 * R) * Math.cos(e2 * R) * Math.cos((a1 - a2) * R);
  return Math.acos(Math.max(-1, Math.min(1, c))) / R;
};

// ── 1. 위치 표 ────────────────────────────────────────────────────────────
const positions = [];
for (const [place, lat, lon] of PLACES) {
  const obs = new A.Observer(lat, lon, 0);
  for (const day of DATES) {
    for (const hh of HOURS) {
      const ms = Date.parse(day + 'T00:00:00Z') + hh * 3600e3;
      const app = sky('Moon', ms, obs, 'normal');
      const geo = sky('Moon', ms, obs, undefined);
      positions.push({ place, lat, lon, iso: new Date(ms).toISOString(), altDeg: round(app.alt, 5), altGeoDeg: round(geo.alt, 5), azDeg: round(app.az, 5) });
    }
  }
}

// ── 2. 월출·월몰 — 그날 00:00Z 부터 24 시간 안의 첫 월출·월몰(앱의 moonRiseSet 과 같은 창) ──
const events = [];
for (const [place, lat, lon] of PLACES) {
  const obs = new A.Observer(lat, lon, 0);
  for (const day of DATES) {
    for (const add of [0, 1]) {
      const start = Date.parse(day + 'T00:00:00Z') + add * 86400e3;
      const rise = A.SearchRiseSet('Moon', obs, +1, new Date(start), 1);
      const set = A.SearchRiseSet('Moon', obs, -1, new Date(start), 1);
      const inWin = (r) => (r && r.date.getTime() < start + 86400e3 ? r.date.toISOString() : null);
      events.push({ place, lat, lon, startIso: new Date(start).toISOString(), riseIso: inWin(rise), setIso: inWin(set) });
    }
  }
}

// 시차(최대 0.95°)와 굴절이 가장 큰 곳은 지평선 근처입니다. 격자 표본은 그곳을 드물게 밟으므로(고도 3° 밑이 16점뿐이었습니다),
// 월출·월몰 둘레 −40·−20·0·+20·+40 분을 따로 더합니다(네 번에 한 번).
events.forEach((e, i) => {
  if (i % 4 !== 0) return;
  const obs = new A.Observer(e.lat, e.lon, 0);
  for (const iso of [e.riseIso, e.setIso]) {
    if (!iso) continue;
    for (const dm of [-40, -20, 0, 20, 40]) {
      const ms = Date.parse(iso) + dm * 60e3;
      const app = sky('Moon', ms, obs, 'normal');
      const geo = sky('Moon', ms, obs, undefined);
      positions.push({ place: e.place, lat: e.lat, lon: e.lon, iso: new Date(ms).toISOString(), altDeg: round(app.alt, 5), altGeoDeg: round(geo.alt, 5), azDeg: round(app.az, 5) });
    }
  }
});

fs.writeFileSync(path.join(HERE, 'moon-ref.json'), JSON.stringify({
  source: `astronomy-engine ${require(path.join(__dirname, '..', '..', '..', 'node_modules', 'astronomy-engine', 'package.json')).version} — Equator(ofdate, aberration) + Horizon('normal' | 굴절 없음), 해발 0`,
  generated: 'node tools/shader-preview/fixtures/moon-ref.js',
  positions,
  events,
}, null, 0) + '\n');
console.log(`moon-ref.json: ${positions.length} 점(격자 576 + 출몰 둘레), ${events.length} 일 출몰`);

// ── 3. 걸기 탐색의 정답 — 1 분 격자로 훑어 허용 반경 안에 든 구간마다 가장 가까운 순간 ──
const CASES = [
  { place: 'seoul', lat: 37.5665, lon: 126.978, body: 'Moon', target: { azDeg: 250, elDeg: 10 }, epsDeg: 2, days: 300 },
  { place: 'seoul', lat: 37.5665, lon: 126.978, body: 'Moon', target: { azDeg: 120, elDeg: 3 }, epsDeg: 2, days: 300 },
  { place: 'seoul', lat: 37.5665, lon: 126.978, body: 'Sun', target: { azDeg: 250, elDeg: 10 }, epsDeg: 2, days: 300 },
  { place: 'seoul', lat: 37.5665, lon: 126.978, body: 'Sun', target: { azDeg: 120, elDeg: 3 }, epsDeg: 1, days: 300 },
  { place: 'reykjavik', lat: 64.1466, lon: -21.9426, body: 'Sun', target: { azDeg: 200, elDeg: 5 }, epsDeg: 1, days: 300 },
  { place: 'sydney', lat: -33.8688, lon: 151.2093, body: 'Moon', target: { azDeg: 30, elDeg: 20 }, epsDeg: 1.5, days: 300 },
  { place: 'quito', lat: -0.1807, lon: -78.4678, body: 'Moon', target: { azDeg: 90, elDeg: 40 }, epsDeg: 1, days: 300 },
  { place: 'tokyo', lat: 35.6762, lon: 139.6503, body: 'Sun', target: { azDeg: 270, elDeg: 0.5 }, epsDeg: 0.5, days: 300 },
];
const FROM = Date.parse('2026-11-19T00:00:00Z');
const aligns = [];
for (const c of CASES) {
  const obs = new A.Observer(c.lat, c.lon, 0);
  const dist = (ms) => { const s = sky(c.body, ms, obs, 'normal'); return sep(s.az, s.alt, c.target.azDeg, c.target.elDeg); };
  const end = FROM + c.days * 86400e3;
  const runs = [];
  let cur = null;
  for (let t = FROM; t < end; t += 60e3) {
    const d = dist(t);
    if (d <= c.epsDeg) { if (!cur || d < cur.d) cur = { t, d }; }
    else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  const refined = [];
  for (const r of runs) {
    let lo = r.t - 60e3, hi = r.t + 60e3;
    const phi = (Math.sqrt(5) - 1) / 2;
    let x1 = hi - phi * (hi - lo), x2 = lo + phi * (hi - lo), f1 = dist(x1), f2 = dist(x2);
    for (let i = 0; i < 30; i++) {
      if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - phi * (hi - lo); f1 = dist(x1); }
      else { lo = x1; x1 = x2; f1 = f2; x2 = lo + phi * (hi - lo); f2 = dist(x2); }
    }
    const tb = (lo + hi) / 2;
    const s = sky(c.body, tb, obs, 'normal');
    if (s.alt > -2) refined.push({ iso: new Date(tb).toISOString(), sepDeg: round(dist(tb), 5) });
  }
  aligns.push({ ...c, body: c.body.toLowerCase(), fromIso: new Date(FROM).toISOString(), runs: refined });
  console.log(`  ${c.place} ${c.body} az${c.target.azDeg} el${c.target.elDeg} ε${c.epsDeg}°: ${refined.length} 접근`);
}
fs.writeFileSync(path.join(HERE, 'align-ref.json'), JSON.stringify({
  source: 'astronomy-engine — 1 분 격자 + 황금분할 정제(겉보기 고도 > −2° 인 접근만)',
  generated: 'node tools/shader-preview/fixtures/moon-ref.js',
  cases: aligns,
}, null, 0) + '\n');
console.log(`align-ref.json: ${aligns.length} 건`);
