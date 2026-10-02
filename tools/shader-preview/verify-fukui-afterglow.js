/**
 * **후쿠이 2026-10-02 17:00** — 위성 보정이 서쪽 바다 위에 저층운을 만들어 내던 사례를 판정으로 못 박습니다.
 *
 * ## 사례
 *
 * 후쿠이(36.0209N 136.2894E). 3~6km(700~500hPa)는 상대습도 1~6% 로 바싹 말랐고, 400hPa(약 7.4km)
 * 에만 습도 37~55% 의 얇은 층이 있어 고적운·권적운판이 생겼습니다. 공기는 아주 깨끗했고(AOD
 * 0.065~0.08, PM2.5 4~6), 해가 진 뒤 붉게 타오르는 잔광이 났습니다.
 *
 * 그 층을 구름으로 낸 모델은 없었습니다(17시: JMA 머리 위 중층 9~12% · ECMWF 맑음 · ICON 상층 58% ·
 * GFS 상층 45%). 관측점 위 얇은 구름이 일사를 조금 깎았고, 위성 보정은 그것을 "예보가 너무 맑다" 로
 * 읽어 그 편향을 해 경로 **전 구간의 저층까지** 더했습니다 — 서쪽 바다 위 저층 26~46%, 점수 22~27
 * (Muted), Complex, pathClarity 0.32~0.44.
 *
 * ## 자료 (`fixtures/fukui-2026-10-02.json`)
 *
 * 앱의 `fetchSunsetWeather` 가 **실제로 보내는 요청 그대로**(팬 · 층 바람/단면 · 대기질 · 위성)의 응답을
 * 2026-10-02 밤(JST)에 기록했습니다(`--capture`). 시계는 17:30 JST 로 고정해 두었고, 위성은 그 시각에
 * 있었을 관측까지만(16:00, 약 1.5시간 지연) 남기고 뒤는 null 로 지웠습니다. 기기 시간대는 일본입니다.
 *
 * ⚠ 예보는 **기록한 시각의 예보 API 값**(그날 실행들을 이어 붙인 것)이라 17시에 앱이 받은 실행과 꼭
 * 같지는 않습니다. 단일 실행 API 는 이 환경에서 한도 초과로 막혀 있었습니다. 17시 관측점 모델값은
 * 위 보고와 같습니다(ECMWF 총 7 · ICON 상층 58).
 *
 * ## ⚠ 재기 전에 정한 문턱 — 측정(`measure-bias-distance.js`)과 고침보다 먼저 박았습니다(2026-10-02)
 *
 * - **F0 자료가 사례를 담는다**: 관측점 마지막 유효 관측 16:00, 편향 > 0("예보가 맑다"), 17시는
 *   앞선 1시간.
 * - **F1 음성 대조**: 옛 방식(층마다 같은 편향, 거리 무관)을 이 자료에 걸면, 17시 서쪽 경로 35점 중
 *   모델 저층 < 5% 인 **모든** 점의 저층이 ≥ 20% 가 된다 — 보고(26~46%)를 재현하는지.
 * - **F2a**: 앱으로 받은 17시 서쪽 경로 35점 중 모델 저층 < 5% 인 점은 보정 저층 ≤ 모델 + 1%p.
 * - **F2b**: 17시 서쪽 경로 35점 **모두** 보정 저층 ≤ 모델 + 5%p.
 * - **F3 관측점 지킴**: 관측점 총운량은 지금처럼 `applyBias(모델, 편향, 앞선 시간)` 그대로(차 < 1e-6).
 *
 * 점수·Complex·pathClarity 는 참고로만 찍습니다 — 그 층을 낸 모델이 없었으므로 보정이 맞힐 수 있는
 * 것이 아닙니다. 이 판정이 묻는 것은 **만들어 낸 저층이 사라지는가** 입니다.
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-fukui-afterglow.js
 *   node tools/shader-preview/verify-fukui-afterglow.js --capture   # 자료를 다시 받습니다(네트워크)
 */
// 기기 시간대 — 앱의 `timeMs` 는 시각 문자열을 **기기 현지시**로 읽습니다(`localDate.ts` 머리말).
// 관측지와 같은 시간대여야 앞선 시간이 맞습니다. 다른 무엇보다 먼저 정합니다.
process.env.TZ = 'Asia/Tokyo';

const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const APP = path.join(PREVIEW, 'app', 'utils');
const FIXTURE = path.join(__dirname, 'fixtures', 'fukui-2026-10-02.json');
const LAT = 36.0209, LON = 136.2894;
const AT = new Date('2026-10-02T17:00:00+09:00');
/** 앱이 이 하늘을 받았다고 보는 시각 — 16:00 관측(15~16시 평균)이 막 들어온 뒤. */
const NOW = Date.parse('2026-10-02T17:30:00+09:00');
const LAST_OBS = '2026-10-02T16:00';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  PASS: ${m}`); } else { fail++; console.log(`  FAIL: ${m}`); } };

/** URL 로 어느 요청인지 가립니다 — 변수 목록이 바뀌어도 흔들리지 않게 호스트·점 수로만. */
const kindOf = (url) => {
  if (url.includes('satellite-api.')) return 'satellite';
  if (url.includes('air-quality-api.')) return 'air';
  if (url.includes('api.open-meteo.com/v1/forecast')) {
    const lat = /latitude=([^&]+)/.exec(url)?.[1] ?? '';
    if (lat.includes(',')) return 'fan';
    return /wind_speed_/.test(url) ? 'winds' : 'other';
  }
  return 'other';
};

async function loadWeather(tag) {
  // 모듈 캐시(일몰·위성·바람 Map)가 실행마다 따로 있어야 합니다 — 쿼리로 다른 인스턴스를 받습니다.
  return import('file://' + path.join(APP, 'weather.js') + `?${tag}`);
}

function withClock(fn) {
  const realNow = Date.now;
  Date.now = () => NOW;
  return fn().finally(() => { Date.now = realNow; });
}

async function capture() {
  const W = await loadWeather('capture');
  const C = await import('file://' + path.join(APP, 'celestial.js'));
  const az = C.getSunPosition(AT, LAT, LON).azimuth;
  const rec = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const r = await realFetch(url, opts);
    const text = await r.text();
    rec[kindOf(String(url))] = { url: String(url), status: r.status, body: JSON.parse(text) };
    return new Response(text, { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  globalThis.__DEV__ = false;
  await withClock(() => W.fetchSunsetWeather(LAT, LON, az, false, AT));
  globalThis.fetch = realFetch;
  // 위성: 앱이 17:30 에 볼 수 있었던 관측(16:00)까지만 남깁니다.
  const sh = rec.satellite.body.hourly;
  sh.shortwave_radiation = sh.shortwave_radiation.map((v, i) => (sh.time[i] > LAST_OBS ? null : v));
  const out = {
    note: '후쿠이 2026-10-02 17:00 사례 — verify-fukui-afterglow.js 머리말 참고. 앱 fetchSunsetWeather 의 요청 그대로 기록.',
    capturedAt: new Date().toISOString(),
    clock: new Date(NOW).toISOString(),
    sunAzimuthDeg: az,
    responses: rec,
  };
  fs.writeFileSync(FIXTURE, JSON.stringify(out));
  console.log(`기록: ${path.relative(process.cwd(), FIXTURE)} (${(fs.statSync(FIXTURE).size / 1024).toFixed(0)} KB) — ${Object.keys(rec).join(', ')}`);
}

/** 자료로 응답하는 가짜 fetch. `satellite` 를 끄면 위성 요청이 실패합니다(보정 없음). */
function fakeFetch(fx, { satellite }) {
  return async (url) => {
    const k = kindOf(String(url));
    const r = fx.responses[k];
    if (!r || (k === 'satellite' && !satellite)) return new Response('{"error":true,"reason":"fixture: off"}', { status: 503 });
    return new Response(JSON.stringify(r.body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

async function run(tag, fx, satellite) {
  const W = await loadWeather(tag);
  const realFetch = globalThis.fetch, realWarn = console.warn;
  globalThis.fetch = fakeFetch(fx, { satellite });
  console.warn = () => {};
  try {
    const pd = await withClock(() => W.fetchSunsetWeather(LAT, LON, fx.sunAzimuthDeg, false, AT));
    // 같은 모듈의 위성 캐시에서 **방금 앱이 쓴 그 편향**을 다시 꺼냅니다(관측점 자료는 캐시 열쇠 검사용).
    const sat = satellite ? await withClock(() => W.fetchSatelliteBias(LAT, LON, AT, pd[0].hourly)) : null;
    return { W, path: pd, sat };
  } finally {
    globalThis.fetch = realFetch; console.warn = realWarn;
  }
}

(async () => {
  if (new Date('2026-10-02T17:00').getTime() !== AT.getTime()) {
    console.error('기기 시간대를 일본으로 못 맞췄습니다 — TZ=Asia/Tokyo 로 실행하세요');
    process.exit(1);
  }
  globalThis.__DEV__ = false;
  if (process.argv.includes('--capture')) { await capture(); return; }
  if (!fs.existsSync(FIXTURE)) { console.error(`자료가 없습니다: ${FIXTURE} (--capture)`); process.exit(1); }
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const S = await import('file://' + path.join(APP, 'satelliteBias.js'));
  const P = await import('file://' + path.join(APP, 'sunsetPhysics.js'));
  const C = await import('file://' + path.join(APP, 'celestial.js'));

  const raw = await run('raw', fx, false);
  const app = await run('app', fx, true);
  // 편향은 앱의 그 함수에서 받습니다. 위 `run` 의 두 번째 호출은 캐시에서 같은 값을 돌려줍니다.
  const sat = app.sat;
  const at = '2026-10-02T17:00';
  const iAt = raw.path[0].hourly.time.indexOf(at);
  const lead = (raw.path[0].hourly.timeMs[iAt] - sat.observedUntilMs) / 3600_000;

  console.log(`자료: ${path.basename(FIXTURE)} · 기록 ${fx.capturedAt} · 태양 방위 ${fx.sunAzimuthDeg.toFixed(1)}°`);
  console.log(`위성 편향 ${sat.biasTau?.toFixed(4)} τ · 마지막 관측 ${new Date(sat.observedUntilMs).toISOString()} · 17시 앞선 ${lead.toFixed(2)}h (감쇠 ${S.dampingForLead(lead).toFixed(3)})\n`);

  // 옛 방식 — 층마다 같은 편향, 거리 무관(고치기 전 `applyBiasToPath`). 음성 대조라서 여기 옮겨 적습니다.
  const old = raw.path.map(p => {
    const h = p.hourly, o = { ...h, low: [...h.low], mid: [...h.mid], high: [...h.high], total: h.total ? [...h.total] : undefined };
    for (let i = 0; i < h.timeMs.length; i++) {
      const L = (h.timeMs[i] - sat.observedUntilMs) / 3600_000;
      o.low[i] = S.applyBias(h.low[i] ?? 0, sat.biasTau, L);
      o.mid[i] = S.applyBias(h.mid[i] ?? 0, sat.biasTau, L);
      o.high[i] = S.applyBias(h.high[i] ?? 0, sat.biasTau, L);
      if (o.total && o.total[i] != null) o.total[i] = S.applyBias(h.total[i], sat.biasTau, L);
    }
    return { ...p, hourly: o };
  });

  const v = (pd, k, j) => pd.hourly[k][j];
  console.log('  17시 서쪽 경로 — 저층 % (모델 → 옛 방식 → 앱)');
  const offs = [-20, -10, 0, 10, 20], dists = [10, 30, 70, 130, 200, 280, 380];
  console.log('          ' + dists.map(d => String(d + 'km').padStart(15)).join(''));
  for (const a of offs) {
    const cells = dists.map(d => {
      const k = raw.path.findIndex(p => p.distance === d && p.azimuthOffset === a);
      return `${v(raw.path[k], 'low', iAt).toFixed(0)}→${v(old[k], 'low', iAt).toFixed(0)}→${v(app.path[k], 'low', iAt).toFixed(0)}`.padStart(15);
    });
    console.log(`  ${String(a).padStart(4)}°  ${cells.join('')}`);
  }
  const o0 = raw.path[0];
  console.log(`  관측점 모델 저/중/상/총 ${['low', 'mid', 'high', 'total'].map(k => v(o0, k, iAt).toFixed(0)).join('/')}` +
    ` → 옛 ${['low', 'mid', 'high', 'total'].map(k => v(old[0], k, iAt).toFixed(0)).join('/')}` +
    ` → 앱 ${['low', 'mid', 'high', 'total'].map(k => v(app.path[0], k, iAt).toFixed(0)).join('/')}\n`);

  // 참고: 점수 — 앱이 예측 카드에 쓰는 그 함수.
  const sunAlt = C.getSunPosition(AT, LAT, LON).altitude;
  const doy = Math.floor((AT.getTime() - Date.parse('2026-01-01T00:00:00+09:00')) / 86400e3) + 1;
  for (const [name, pd] of [['모델', raw.path], ['옛 방식', old], ['앱', app.path]]) {
    const obs = app.W.getInterpolatedWeather(pd, AT)[0];
    const pr = P.predictSunset(pd, AT, sunAlt, obs.visibility, obs.humidity, LAT, 0, doy);
    console.log(`  (참고) ${name.padEnd(6)} 점수 ${String(pr.score).padStart(3)} ${pr.quality.padEnd(8)} ${pr.cloudLabel.padEnd(8)} pathClarity ${pr.factors.pathClarity.toFixed(2)}`);
  }
  console.log('');

  const pathIdx = raw.path.map((p, k) => k).filter(k => raw.path[k].distance > 0);
  const thin = pathIdx.filter(k => v(raw.path[k], 'low', iAt) < 5);

  ok(sat.biasTau != null && sat.biasTau > 0 && new Date(sat.observedUntilMs).getTime() === Date.parse(LAST_OBS + ':00+09:00') && Math.abs(lead - 1) < 1e-9,
     `F0 자료가 사례를 담는다 — 마지막 관측 16:00 · 편향 ${sat.biasTau?.toFixed(4)} > 0 · 앞선 ${lead.toFixed(2)}h`);
  ok(pathIdx.length === 35 && thin.length > 0 && thin.every(k => v(old[k], 'low', iAt) >= 20),
     `F1 음성 대조 — 옛 방식이면 모델 저층 < 5% 인 ${thin.length}점이 모두 ≥ 20% ` +
     `(최소 ${Math.min(...thin.map(k => v(old[k], 'low', iAt))).toFixed(0)}%, 경로 최대 ${Math.max(...pathIdx.map(k => v(old[k], 'low', iAt))).toFixed(0)}%)`);
  const upThin = Math.max(...thin.map(k => v(app.path[k], 'low', iAt) - v(raw.path[k], 'low', iAt)));
  ok(upThin <= 1, `F2a 모델 저층 < 5% 인 ${thin.length}점: 앱 저층 ≤ 모델 + 1%p (최대 +${upThin.toFixed(2)})`);
  const upAll = Math.max(...pathIdx.map(k => v(app.path[k], 'low', iAt) - v(raw.path[k], 'low', iAt)));
  ok(upAll <= 5, `F2b 서쪽 경로 35점 모두: 앱 저층 ≤ 모델 + 5%p (최대 +${upAll.toFixed(2)})`);
  const want = S.applyBias(v(raw.path[0], 'total', iAt), sat.biasTau, lead);
  ok(Math.abs(v(app.path[0], 'total', iAt) - want) < 1e-6,
     `F3 관측점 총운량 보정은 그대로 — ${v(raw.path[0], 'total', iAt).toFixed(1)}% → ${v(app.path[0], 'total', iAt).toFixed(2)}% (지금 식 ${want.toFixed(2)}%)`);

  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
