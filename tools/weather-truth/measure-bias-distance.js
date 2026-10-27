/**
 * 관측점 **한 곳**에서 낸 위성 편향을 **멀리 떨어진 경로 점**에 적용하면 그 점의 예보가 나아지나 —
 * 거리 감쇠와 층 배분을 재는 자.
 *
 * ## 왜 (2026-10-02 후쿠이)
 *
 * `weather.ts` 의 `fetchSatelliteBias` 는 관측점 1점의 위성 일사와 그 시각 예보 총운량을 견줘 τ 편향
 * 하나를 내고, `applyBiasToPath` 가 그 하나를 **해 경로의 모든 점(최대 380km)** 의 저·중·상·총운량에
 * **똑같이** 겁니다. `satelliteBias.ts` 머리말의 −32% 는 **관측점 자신**에서 잰 것이라, 380km 밖에도
 * 듣는지는 잰 적이 없습니다.
 *
 * 후쿠이(36.0209N 136.2894E) 10-02 17시: 관측점 위 얇은 고적운·권적운판(400hPa)이 일사를 조금
 * 깎았고, 보정은 그것을 "예보가 너무 맑다" 로 읽어 서쪽 바다 위 **저층**에 26~46% 를 만들었습니다.
 * 그 하늘은 실제로 맑고 깨끗했고(AOD 0.07), 해가 진 뒤 붉게 타올랐습니다.
 *
 * ## 자 (README 의 τ 규약 그대로)
 *
 * - 관측: `satellite_radiation_seamless` 시간별 일사 ÷ Haurwitz 맑은하늘(**창평균**,
 *   `satelliteBias.clearSkyGHIMean`) ÷ 그 점의 맑은하늘 배율 → τ.
 * - 배율: 네 모델(ecmwf·icon·jma·gfs)이 모두 맑다(총운량 ≤ 20%)고 한 시각의 τ 평균(8개 미만이면
 *   τ 상위 5%) — `verify-cloud-forecast.js` · `verify-lead-time.js` 와 같습니다. **점마다** 냅니다.
 * - 쓰는 시각: 창평균 맑은하늘 ≥ `MIN_CLEAR_GHI`(앱 문턱, 태양고도 약 15°).
 * - 예보: 앱이 섞는 둘(ecmwf_ifs025 · icon_seamless)의 산술평균(`modelBlend.ts` 와 같음).
 *   모델 운량은 τ = 1 − 0.75·(N/100)^3.4 로 바꿔 **τ 끼리** 뺍니다.
 *
 * ## 편향 — 앱 절차 그대로
 *
 * 관측점 O 의 시각 t0 에서 `estimateBias`(앱 모듈)로 냅니다. 배율은 앱처럼 **직전 7일 + 그날**의
 * τ 상위 5% (표본 20 미만이거나 0.6 이하면 편향 없음). 경로 점 P 의 시각 t = t0 + L 에 **앞선 시간
 * L(시간)** 의 감쇠(`dampingForLead`)를 곱해 겁니다 — 앱의 `applyBiasToPath` 와 같은 규약입니다.
 * L = 0 은 같은 시각입니다(공간만 옮긴 값). 관측점 자신의 L = 0 은 자기 자신을 맞히는 셈이라 뺍니다.
 *
 * 경로 점은 관측점에서 **서(270°)·동(90°)** 으로 25 · 50 · 100 · 200 · 400km — 일몰·일출 경로입니다.
 *
 * ## 층 배분 — "그리는 층"의 기둥으로 잽니다
 *
 * 위성은 층을 못 가립니다(README "못 재는 것"). 그래서 층별 운량 대신, 앱이 **그리는 세 층을 겹친
 * 기둥**(무작위 겹침 1 − Π(1 − cᵢ), §60 에서 층으로 총량을 내는 방식 중 가장 맞았던 것)을 τ 로 바꿔
 * 위성과 견줍니다. 견주는 배분 방식:
 *
 * - `N`    보정 없음
 * - `A0`   지금 앱 — 층마다 같은 편향(`applyBias`), 거리 무관
 * - `Ad`   층마다 같은 편향, 거리 감쇠만
 * - `Pall` **비례**: 기둥 τ 가 정확히 Δτ 만큼 옮도록 세 층에 같은 배수 k 를 곱함(0% 층은 0% 그대로)
 * - `P`    `Pall` + **맑은 기둥은 손대지 않음**: 그리는 기둥이 20% 이하(README 의 "맑음" 줄)면
 *          층을 그대로 둡니다.
 *
 * `P` 의 맑은 기둥 규칙이 왜 있나 — Kasten-Czeplak 의 역함수는 맑은 쪽에서 기울기가 무한대입니다.
 * τ 0.007(일사 0.7%, 위성 잡음보다 작음)이 운량 0 → 25% 입니다. 후쿠이 10-02 16시의 편향은 +0.013
 * 이었고, 17시(앞선 1시간, 감쇠 0.535)에 Δτ 0.007 이 됐습니다. 비례만으로는 저층 1%·상층 1% 인
 * 맑은 기둥이 k ≈ 12 를 받아 **1% → 12%** 가 됩니다 — 0 을 만드는 것만 막고 흔적을 부풀립니다.
 * 맑은 기둥에는 다시 키울 구름 구조가 없고, 위성 τ 는 빠진 구름이 어느 층인지 말하지 못합니다.
 * (총운량 `total` 의 보정은 그대로 둡니다 — 관측점의 −32% 를 잰 양이 그것입니다.)
 *
 * "가장 습한 기압면에 넣기" 는 넣지 않았습니다. 후쿠이 10-02 16시 관측점 단면(best_match)에서 상대
 * 습도가 가장 높은 면은 **850hPa 73%(경계층)** 였고, 실제 구름이 있던 400hPa 는 35% 였습니다.
 * 그 규칙은 이 사례에서 구름을 다시 **저층**에 넣습니다.
 *
 * ## ⚠ 재기 전에 정한 규칙 — 이 파일을 처음 커밋할 때 박았습니다(2026-10-02)
 *
 * 수치는 모두 τ 평균절대오차 ×100 입니다. 칸 = (거리 d, 앞선 시간 L).
 *
 * - **D1 해로움**: 지금 방식(감쇠 없음)이 칸 (d, L) 에서 보정 후 > 보정 전 이면 그 칸에서 해롭다.
 *   d ∈ {25, 50, 100, 200, 400} × L ∈ {0, 1, 2, 3} 를 전부 보고합니다.
 * - **D2 감쇠 길이**: w(d) = exp(−d / Ld), Ld ∈ {25, 50, 75, 100, 150, 200, 300, 500, 1000, ∞}km.
 *   목적 = 위 20칸 MAE 의 단순 평균. 가장 작은 Ld 를 고르되, 최솟값과 0.02 안이면 **짧은 쪽**.
 * - **D3 해 안 끼침**: 고른 Ld 로 모든 칸이 보정 후 ≤ 보정 전 + 0.05 여야 합니다. 어기는 칸이 있으면
 *   어기는 가장 가까운 거리부터 w = 0 (자르기)으로 두고 다시 봅니다.
 * - **D4 관측점 지킴**: 관측점(d = 0)은 w = 1 이라 총운량 보정이 지금 코드와 **같아야** 합니다
 *   (L = 1·2·3, 표본마다 차이 < 1e-9).
 * - **A1 저층 만들기 금지**: `P` 는 모델 저층이 0 인 표본에서 보정 저층이 0 보다 크면 안 됩니다(0건).
 * - **A2 관측점 그림**: 관측점(L = 1·2·3 묶음)에서 `P` 의 기둥 MAE < `N`(그리는 하늘도 여전히
 *   나아짐), 그리고 ≤ `A0`(지금보다 나쁘지 않음).
 * - **A3 경로 그림**: d ∈ {25…400} 마다(L = 0~3 묶음) `P` 의 기둥 MAE ≤ `N` + 0.05.
 *
 * 그리고 후쿠이 판정(`tools/shader-preview/verify-fukui-afterglow.js`)의 문턱도 이때 정했습니다 —
 * 그쪽 머리말에 있습니다(§166 에서 그 판정과 부채꼴 요청을 지움, git 이력 참조. 앱은 지금 이 보정을 쓰지 않습니다).
 *
 * ## ⚠ 2판 — 후쿠이 F2b 가 실패해서 바꾼 것 (이것도 재기 전에 정함, 2026-10-02)
 *
 * 1판 결과(D4·A1~A3 통과, Ld = 500km)로 앱을 고쳤더니 후쿠이 F2b 가 실패했습니다: 70km 정중앙 점
 * (저층 16 · 상층 5, 그리는 기둥 20.2%)이 20% 줄 **바로 위**라 배수 1.5 를 받아 저층 16 → 24%
 * (+7.7, 문턱 +5). 줄 아래는 지켰지만 줄 바로 위에서도 K-C 기울기가 얕아 같은 부풀림이 납니다 —
 * 단단한 줄은 그 띠를 옮길 뿐입니다. 판정 문턱은 **그대로 두고** 배분을 바꿉니다.
 *
 * `PG`: 줄 대신 **위성이 그 운량을 가려낼 수 있는 만큼만** 층에 겁니다.
 *
 *     g(T) = s² / (s² + r²),   s = dτ/dT = 0.75 · 3.4 · T^2.4  (T = 그리는 기둥, 0~1),   r = σ_τ / σ_c
 *
 * 모델 운량의 불확실성이 σ_c, 위성 τ 의 잡음이 σ_τ 일 때 선형 가우스 추정에서 **관측이 차지하는 몫**
 * 입니다. 맑은 쪽은 s → 0 이라 g → 0, 흐린 쪽은 g → 1. 층에 거는 τ 는 g · Δτ 이고 나머지는 `Pall`
 * 과 같습니다(20% 줄 없음). 이러면 τ 를 Δτ 옮길 때 그리는 기둥이 움직이는 양이 **어디서나 Δτ/(2r)
 * 을 넘지 않습니다**(s = r 에서 최대).
 *
 * - **σ_τ 는 잽니다**: 네 모델이 모두 맑다(총운량 ≤ 20%)고 한 시각의 위성 τ(배율로 나눈 날값, 1 로
 *   자르지 않음)의 흩어짐 — 중앙값 절대편차 × 1.4826. 배율 출처가 "합의" 인 점만, 모든 점을 묶어서.
 * - **σ_c = 0.25 는 정합니다**: 위성으로는 맑은 쪽 운량 오차를 잴 수 없습니다. 이 자의 보정 전 τ
 *   오차(약 0.14)를 운량 50~60% 의 K-C 기울기(0.48~0.75)로 나눈 크기(0.19~0.29)의 가운데입니다.
 *
 * 규칙(1판 것과 같은 문턱):
 *
 * - **A1~A3** 을 `PG` 에도 그대로 겁니다.
 * - **A4**: 관측점(+1~3h)에서 `PG` 가 `P` 의 이득(N − P)을 **80% 이상** 지킨다 — 줄을 매끄럽게
 *   바꾼 값이 관측점 그림의 이득을 크게 깎으면 안 됩니다.
 * - 후쿠이 판정 F0~F3 의 문턱은 바꾸지 않습니다.
 *
 * ## 사용
 *
 *   node tools/shader-preview/stage-esm.js
 *   node tools/weather-truth/measure-bias-distance.js [일수=30] [끝날짜 YYYY-MM-DD = 어제]
 *
 * `WEATHER_TRUTH_CACHE=<디렉터리>` 를 주면 응답을 거기 둡니다(같은 기간을 다시 잴 때 재요청 없음).
 * 판정이 아니라 **재는 자**입니다 — 종료 코드는 자료를 못 받았을 때만 1 입니다.
 * 못 재는 것은 README 와 같습니다(낮만, 미 대륙 없음, 얇은 상층운은 거의 안 보임).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PREVIEW } = require('../shader-preview/paths');

const APP = path.join(PREVIEW, 'app', 'utils');
const DAYS = Number(process.argv[2] || 30);
const END_ARG = process.argv[3];
const CACHE = process.env.WEATHER_TRUTH_CACHE || '';

const PLACES = [
  { name: '서울 도곡동', lat: 37.4863, lon: 127.0443 },
  { name: '강원 인제', lat: 38.0695, lon: 128.1704 },
  { name: '제주 서귀포', lat: 33.2541, lon: 126.5601 },
  { name: '일본 요네자와', lat: 37.9222, lon: 140.1168 },
  { name: '일본 도쿄', lat: 35.6812, lon: 139.7671 },
  { name: '일본 후쿠이', lat: 36.0209, lon: 136.2894 },
  { name: '독일 뮌헨', lat: 48.1372, lon: 11.5756 },
  { name: '영국 런던', lat: 51.5072, lon: -0.1276 },
  { name: '스페인 세비야', lat: 37.3891, lon: -5.9845 },
  { name: '몽골 울란바토르', lat: 47.8864, lon: 106.9057 },
  { name: '케냐 나이로비', lat: -1.2921, lon: 36.8219 },
  { name: '호주 시드니', lat: -33.8688, lon: 151.2093 },
];
const DISTS = [25, 50, 100, 200, 400];
const BEARINGS = [{ key: 'W', deg: 270 }, { key: 'E', deg: 90 }];
const LEADS = [0, 1, 2, 3];
const LD_GRID = [25, 50, 75, 100, 150, 200, 300, 500, 1000, Infinity];
/** README 의 "맑음" 줄 — 총운량 ≤ 20%. `P` 의 맑은 기둥 규칙도 이 줄을 씁니다. */
const CLEAR_PCT = 20;
/** 2판 `PG` — 모델 운량의 불확실성(운량 비율). 머리말 "2판" 에서 정했습니다. */
const SIGMA_C = 0.25;
const BLEND = ['ecmwf_ifs025', 'icon_seamless'];
const CONSENSUS = ['ecmwf_ifs025', 'icon_seamless', 'jma_seamless', 'gfs_seamless'];
/** 앱의 위성 요청 창 — 직전 7일 + 그날 (`weather.ts` SCALE_DAYS). */
const SCALE_DAYS = 7;

const iso = d => d.toISOString().slice(0, 10);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const pad = (s, n) => String(s).padStart(n);
const f1 = x => (Number.isFinite(x) ? x.toFixed(2) : '  -  ');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url) {
  const key = CACHE ? path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + '.json') : '';
  if (key && fs.existsSync(key)) return JSON.parse(fs.readFileSync(key, 'utf8'));
  for (let t = 0; t < 5; t++) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        const j = await r.json();
        if (j && !j.error) {
          if (key) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(key, JSON.stringify(j)); }
          return j;
        }
        console.log(`    응답 오류: ${j?.reason ?? '?'}`);
        return null;
      }
      if (r.status === 429) { await sleep(8000 * (t + 1)); continue; }
      console.log(`    HTTP ${r.status}`);
      return null;
    } catch (e) { await sleep(3000 * (t + 1)); }
  }
  return null;
}

/** 무작위 겹침으로 세 층을 한 기둥으로 (%). */
const ro = (l, m, h) => 100 * (1 - (1 - l / 100) * (1 - m / 100) * (1 - h / 100));

(async () => {
  const S = await import('file://' + path.join(APP, 'satelliteBias.js'));
  const C = await import('file://' + path.join(APP, 'celestial.js'));
  const W = await import('file://' + path.join(APP, 'weather.js'));
  const { clearSkyGHIMean, tauFromCover, coverFromTau, estimateBias, applyBias, dampingForLead, MIN_CLEAR_GHI } = S;
  const { getSunPosition } = C;
  const { calculateDestination } = W;

  /**
   * `Pall`/`P` 배분 — 세 층에 같은 배수 k 를 곱해 **그리는 기둥의 τ 가 정확히 dTau 만큼** 옮게 합니다.
   * 0% 층은 몇 배를 해도 0% 입니다. 층은 100% 에서 멈춥니다.
   * `keepClear` 면 그리는 기둥이 CLEAR_PCT 이하일 때 손대지 않습니다.
   */
  function allocate(l, m, h, dTau, keepClear) {
    const T0 = ro(l, m, h);
    if (!(Math.abs(dTau) > 0)) return [l, m, h];
    if (keepClear && T0 <= CLEAR_PCT) return [l, m, h];
    if (T0 <= 0) return [l, m, h];
    const target = Math.min(1, Math.max(0.25, tauFromCover(T0) - dTau));
    const at = k => [Math.min(100, k * l), Math.min(100, k * m), Math.min(100, k * h)];
    const tauAt = k => { const [a, b, c] = at(k); return tauFromCover(ro(a, b, c)); };
    let lo, hi;
    if (dTau > 0) {
      // 가장 큰 층이 100% 가 되면 기둥도 100%(τ 0.25)라 어떤 목표에도 닿습니다. 그 너머로 k 를 키우면
      // 작은 층만 부풀립니다 — 처음 판은 여기서 가장 **작은** 층 기준(100/min)으로 멈춰, 목표가 τ 0.25
      // 일 때 흔적뿐인 저층까지 100% 로 올렸습니다(τ 는 같아 오차 표는 그대로, 부풀림 집계만 틀림).
      lo = 1; hi = 100 / Math.max(l, m, h);
    } else {
      lo = 0; hi = 1;
      if (tauAt(0) <= target) return at(0);
    }
    for (let it = 0; it < 60; it++) {
      const k = (lo + hi) / 2;
      // τ 는 k 가 커질수록 줄어듭니다.
      if (tauAt(k) > target) lo = k; else hi = k;
    }
    return at((lo + hi) / 2);
  }

  const end = END_ARG ? new Date(END_ARG + 'T00:00:00Z') : new Date(Date.now() - 24 * 3600e3);
  const start = new Date(end.getTime() - (DAYS - 1) * 86400e3);
  const satStart = new Date(start.getTime() - (SCALE_DAYS + 1) * 86400e3);
  const startMs = Date.parse(iso(start) + 'T00:00:00Z');
  console.log(`관측 ${iso(start)} ~ ${iso(end)} (${DAYS}일) · 배율용 위성은 ${iso(satStart)} 부터 · 창평균 맑은하늘 ≥ ${MIN_CLEAR_GHI} W/m²`);
  console.log(`τ 평균절대오차 ×100 (낮을수록 좋음). 칸 = (거리, 앞선 시간)\n`);

  // 누적기 ─ 총운량(τ 규약): [d][L][Ld 지수] , before 따로
  const dKeys = [0, ...DISTS];
  const cell = () => ({ n: 0, before: 0, cur: 0, ld: LD_GRID.map(() => 0) });
  const T = Object.fromEntries(dKeys.map(d => [d, Object.fromEntries(LEADS.map(L => [L, cell()]))]));
  const perPlace = [];
  let obsIdentityMaxDiff = 0, obsIdentityN = 0;
  /** 층 배분 평가에 다시 쓸 표본 — 감쇠 길이를 고른 뒤에 돌립니다. */
  const layerSamples = [];
  /** 2판 σ_τ — 네 모델이 모두 맑다고 한 시각의 τ 날값 − 1 (배율 출처가 "합의" 인 점만). */
  const clearResid = [];

  for (const P of PLACES) {
    const pts = [{ d: 0, dir: 'O', lat: P.lat, lon: P.lon }];
    for (const b of BEARINGS) for (const d of DISTS) {
      const q = calculateDestination(P.lat, P.lon, d, b.deg);
      pts.push({ d, dir: b.key, lat: q.latitude, lon: q.longitude });
    }
    const lats = pts.map(p => p.lat.toFixed(4)).join(','), lons = pts.map(p => p.lon.toFixed(4)).join(',');
    const sat = await getJson(`https://satellite-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}` +
      `&hourly=shortwave_radiation&models=satellite_radiation_seamless&start_date=${iso(satStart)}&end_date=${iso(end)}&timezone=GMT`);
    const fc = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
      `&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high&models=${CONSENSUS.join(',')}` +
      `&start_date=${iso(start)}&end_date=${iso(end)}&timezone=GMT`);
    const satA = Array.isArray(sat) ? sat : sat ? [sat] : [];
    const fcA = Array.isArray(fc) ? fc : fc ? [fc] : [];
    if (satA.length !== pts.length || fcA.length !== pts.length) {
      console.log(`  ${P.name.padEnd(10)} 자료 없음(위성 범위 밖이거나 요청 실패)`);
      continue;
    }

    // 점마다 시각별 자료를 정리합니다.
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      const cosZAt = ms => Math.sin((getSunPosition(new Date(ms), p.lat, p.lon).altitude * Math.PI) / 180);
      const sh = satA[k].hourly, fh = fcA[k].hourly;
      // 위성 범위 밖(서반구)은 일사가 전부 null 입니다 — 아래 표본 수 검사가 걸러 냅니다.
      if (!sh || !fh) { p.bad = true; continue; }
      p.obs = new Map();                                     // ms → { sw, cs, raw }
      for (let i = 0; i < sh.time.length; i++) {
        const sw = sh.shortwave_radiation[i];
        if (sw == null || !Number.isFinite(sw)) continue;
        const ms = Date.parse(sh.time[i] + 'Z');
        const cs = clearSkyGHIMean(ms, cosZAt);
        if (cs < MIN_CLEAR_GHI) continue;
        p.obs.set(ms, { sw, cs, raw: sw / cs });
      }
      p.fc = new Map();                                      // ms → { total, low, mid, high, allTot[] }
      const bl = (base, i) => {
        const v = BLEND.map(m => fh[`${base}_${m}`]?.[i]).filter(x => x != null && Number.isFinite(x));
        return v.length ? mean(v) : null;
      };
      for (let i = 0; i < fh.time.length; i++) {
        const ms = Date.parse(fh.time[i] + 'Z');
        const total = bl('cloud_cover', i), low = bl('cloud_cover_low', i), mid = bl('cloud_cover_mid', i), high = bl('cloud_cover_high', i);
        const allTot = CONSENSUS.map(m => fh[`cloud_cover_${m}`]?.[i]);
        p.fc.set(ms, { total, low, mid, high, allTot });
      }
      // 맑은하늘 배율 — README 규약(30일, 점마다).
      const clearRaw = [], allRaw = [];
      for (const [ms, o] of p.obs) {
        if (ms < startMs) continue;
        const f = p.fc.get(ms);
        if (!f) continue;
        allRaw.push(o.raw);
        if (f.allTot.every(v => v != null) && Math.max(...f.allTot) <= 20) clearRaw.push(o.raw);
      }
      if (allRaw.length < 50) { p.bad = true; continue; }
      if (clearRaw.length >= 8) {
        p.scale = mean(clearRaw); p.scaleSrc = '합의';
        for (const x of clearRaw) clearResid.push(x / p.scale - 1);
      }
      else { const s2 = allRaw.slice().sort((a, b) => a - b); p.scale = s2[Math.floor(0.95 * (s2.length - 1))]; p.scaleSrc = '상위5%'; }
    }
    const O = pts[0];
    if (O.bad) { console.log(`  ${P.name.padEnd(10)} 관측점 자료 부족`); continue; }

    // 관측점의 편향 — 앱 절차(직전 7일 + 그날의 τ 상위 5%, estimateBias).
    const tzH = Math.round(P.lon / 15);                       // 현지 자정 근사(배율 창의 시작만 정함)
    const obsSorted = [...O.obs.entries()].sort((a, b) => a[0] - b[0]);
    const biasAt = new Map();
    for (const [ms, o] of obsSorted) {
      if (ms < startMs) continue;
      const f = O.fc.get(ms);
      if (!f || f.total == null) continue;
      const localDay = Math.floor((ms + tzH * 3600e3) / 86400e3);
      const winStart = (localDay - SCALE_DAYS) * 86400e3 - tzH * 3600e3;
      const raws = obsSorted.filter(([t]) => t >= winStart && t <= ms).map(([, x]) => x.raw).sort((a, b) => a - b);
      if (raws.length < 20) continue;
      const scale = raws[Math.floor(0.95 * (raws.length - 1))];
      if (!(scale > 0.6)) continue;
      const b = estimateBias([{ forecastCoverPct: f.total, observedGHI: o.sw, clearSkyGHI: o.cs }], scale);
      if (b != null) biasAt.set(ms, b);
    }

    const placeRow = { name: P.name, n: 0, biasN: biasAt.size, scales: pts.filter(p => !p.bad).map(p => `${p.dir}${p.d}:${p.scale.toFixed(2)}${p.scaleSrc === '합의' ? '' : '*'}`),
      cells: Object.fromEntries([100, 400].map(d => [d, { n: 0, before: 0, cur: 0, ld: LD_GRID.map(() => 0) }])) };
    for (const p of pts) {
      if (p.bad) continue;
      for (const [ms, o] of p.obs) {
        if (ms < startMs) continue;
        const f = p.fc.get(ms);
        if (!f || f.total == null || f.low == null || f.mid == null || f.high == null) continue;
        const tSat = Math.min(1, Math.max(0, o.raw / p.scale));
        for (const L of LEADS) {
          if (p.d === 0 && L === 0) continue;               // 자기 자신을 맞히는 칸
          const b = biasAt.get(ms - L * 3600e3);
          if (b == null) continue;
          const c = T[p.d][L];
          c.n++;
          const eBefore = Math.abs(tauFromCover(f.total) - tSat);
          const cur = applyBias(f.total, b, L);
          const eCur = Math.abs(tauFromCover(cur) - tSat);
          c.before += eBefore; c.cur += eCur;
          LD_GRID.forEach((Ld, j) => {
            const w = Number.isFinite(Ld) ? Math.exp(-p.d / Ld) : 1;
            const v = applyBias(f.total, b * w, L);
            c.ld[j] += Math.abs(tauFromCover(v) - tSat);
            if (L === 1 && placeRow.cells[p.d]) placeRow.cells[p.d].ld[j] += Math.abs(tauFromCover(v) - tSat);
            if (p.d === 0) {                                // D4: 관측점은 지금 코드와 같아야 합니다
              obsIdentityMaxDiff = Math.max(obsIdentityMaxDiff, Math.abs(v - cur));
              obsIdentityN++;
            }
          });
          layerSamples.push({ place: P.name, d: p.d, L, b, tSat, low: f.low, mid: f.mid, high: f.high });
          if (L === 1 && placeRow.cells[p.d]) {
            placeRow.cells[p.d].n++; placeRow.cells[p.d].before += eBefore; placeRow.cells[p.d].cur += eCur;
          }
          placeRow.n++;
        }
      }
    }
    perPlace.push(placeRow);
    console.log(`  ${P.name.padEnd(10)} 표본 ${pad(placeRow.n, 6)} · 편향 낸 시각 ${pad(biasAt.size, 4)} · 배율 ${placeRow.scales.join(' ')}`);
    await sleep(1200);
  }
  if (!perPlace.length) { console.log('자료를 하나도 못 받았습니다'); process.exit(1); }
  console.log('  (* = 합의 시각이 8개 미만이라 τ 상위 5% 를 쓴 배율)');

  // ── D1 ─────────────────────────────────────────────────────────────
  const m = (c, x) => (c.n ? (x / c.n) * 100 : NaN);
  console.log('\n[D1] 지금 방식(감쇠 없음): 보정 전 → 후 (변화%)  — + 면 해롭습니다');
  console.log('   거리    ' + LEADS.map(L => pad(`+${L}h`, 29)).join(''));
  const harm = [];
  for (const d of dKeys) {
    const row = LEADS.map(L => {
      const c = T[d][L];
      if (!c.n) return pad('-', 29);
      const b = m(c, c.before), a = m(c, c.cur), ch = ((a - b) / b) * 100;
      if (d > 0 && a > b) harm.push(`${d}km+${L}h`);
      return pad(`${f1(b)} → ${f1(a)} (${ch >= 0 ? '+' : ''}${ch.toFixed(0)}%) n${c.n}`, 29);
    }).join('');
    console.log(`   ${pad(d === 0 ? '관측점' : d + 'km', 6)}  ${row}`);
  }
  console.log(`   해로운 칸: ${harm.length ? harm.join(', ') : '없음'}`);

  // ── D2 ─────────────────────────────────────────────────────────────
  console.log('\n[D2] 감쇠 길이 Ld 별 목적(20칸 MAE 평균) — 관측점은 목적에 안 들어갑니다');
  const J = LD_GRID.map((Ld, j) => {
    const vals = [];
    for (const d of DISTS) for (const L of LEADS) { const c = T[d][L]; if (c.n) vals.push(m(c, c.ld[j])); }
    return mean(vals);
  });
  const Jbefore = mean(DISTS.flatMap(d => LEADS.map(L => m(T[d][L], T[d][L].before))).filter(Number.isFinite));
  console.log(`   보정 안 함(w=0)   ${f1(Jbefore)}`);
  LD_GRID.forEach((Ld, j) => console.log(`   Ld ${pad(Number.isFinite(Ld) ? Ld + 'km' : '∞ (지금)', 9)}   ${f1(J[j])}`));
  const jMin = Math.min(...J);
  const pick = LD_GRID.findIndex((_, j) => J[j] <= jMin + 0.02);   // 격자가 짧은 쪽부터라 첫 것이 가장 짧음
  const LdStar = LD_GRID[pick];
  console.log(`   → 고른 Ld = ${Number.isFinite(LdStar) ? LdStar + 'km' : '∞'} (목적 ${f1(J[pick])}, 최솟값 ${f1(jMin)})`);

  // ── D3 ─────────────────────────────────────────────────────────────
  console.log('\n[D3] 고른 Ld 로 칸마다 보정 후 ≤ 보정 전 + 0.05 인가');
  let cutKm = Infinity;
  for (const d of DISTS) {
    const parts = LEADS.map(L => {
      const c = T[d][L]; if (!c.n) return '   -   ';
      const b = m(c, c.before), a = m(c, c.ld[pick]);
      const okc = a <= b + 0.05;
      if (!okc && d < cutKm) cutKm = d;
      return `${f1(b)}→${f1(a)}${okc ? ' ' : '✗'}`;
    });
    console.log(`   ${pad(d + 'km', 6)}  ${parts.join('   ')}`);
  }
  console.log(Number.isFinite(cutKm) ? `   → 어긴 칸이 있습니다: ${cutKm}km 부터 w = 0 으로 자릅니다` : '   → 모든 칸 통과 — 자르지 않습니다');
  const wOf = d => (d >= cutKm ? 0 : Number.isFinite(LdStar) ? Math.exp(-d / LdStar) : 1);

  // ── D4 ─────────────────────────────────────────────────────────────
  console.log(`\n[D4] 관측점 총운량 보정이 지금 코드와 같은가 — 최대 차이 ${obsIdentityMaxDiff.toExponential(1)} (표본 ${obsIdentityN})`);
  console.log(`   ${obsIdentityMaxDiff < 1e-9 ? 'PASS' : 'FAIL'}: 관측점에서 감쇠는 아무것도 안 바꿉니다`);
  for (const L of [1, 2, 3]) {
    const c = T[0][L];
    if (c.n) console.log(`   관측점 +${L}h  ${f1(m(c, c.before))} → ${f1(m(c, c.cur))} (${(((c.cur - c.before) / c.before) * 100).toFixed(0)}%)  n=${c.n}`);
  }

  // ── A: 층 배분 ─────────────────────────────────────────────────────
  console.log(`\n[A] 층 배분 — 그리는 세 층을 겹친 기둥(무작위 겹침)의 τ 오차, 감쇠는 위에서 고른 것`);
  // 2판: 위성 τ 잡음을 재고, 그것으로 "가려낼 수 있는 몫" g 를 정합니다(머리말 "2판").
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const m0 = med(clearResid);
  const sigmaTau = 1.4826 * med(clearResid.map(x => Math.abs(x - m0)));
  const R = sigmaTau / SIGMA_C;
  const gain = T => { const s = 0.75 * 3.4 * Math.pow(Math.max(0, T) / 100, 2.4); return (s * s) / (s * s + R * R); };
  console.log(`   [2판] 위성 τ 잡음 σ_τ = ${sigmaTau.toFixed(4)} (맑은 시각 ${clearResid.length}개, 중앙 ${m0.toFixed(4)}) · σ_c = ${SIGMA_C}` +
    ` → r = ${R.toFixed(4)} · g(10/20/30/40/60%) = ${[10, 20, 30, 40, 60].map(T => gain(T).toFixed(2)).join('/')}` +
    ` · Δτ 0.01 이 기둥을 움직이는 최대 ${(0.01 / (2 * R) * 100).toFixed(1)}%p`);
  const meth = ['N', 'A0', 'Ad', 'Pall', 'P', 'PG'];
  const acc = Object.fromEntries(dKeys.map(d => [d, Object.fromEntries(meth.map(k => [k, { n: 0, e: 0, eObsLead: 0, nObsLead: 0 }]))]));
  const inv = Object.fromEntries(meth.map(k => [k, { zeroN: 0, zeroMade: 0, thinN: 0, thinMade: 0, maxUp: 0 }]));
  for (const s of layerSamples) {
    const d = s.d, damp = dampingForLead(s.L), w = wOf(d);
    const per = (b) => [applyBias(s.low, b, s.L), applyBias(s.mid, b, s.L), applyBias(s.high, b, s.L)];
    const out = {
      N: [s.low, s.mid, s.high],
      A0: per(s.b),
      Ad: per(s.b * w),
      Pall: allocate(s.low, s.mid, s.high, s.b * w * damp, false),
      P: allocate(s.low, s.mid, s.high, s.b * w * damp, true),
      PG: allocate(s.low, s.mid, s.high, s.b * w * damp * gain(ro(s.low, s.mid, s.high)), false),
    };
    for (const k of meth) {
      const [l, mm, h] = out[k];
      const e = Math.abs(tauFromCover(ro(l, mm, h)) - s.tSat);
      const a = acc[d][k];
      a.n++; a.e += e;
      if (d === 0 && s.L >= 1) { a.nObsLead++; a.eObsLead += e; }
      const I = inv[k];
      if (s.low === 0) { I.zeroN++; if (l > 0) I.zeroMade++; }
      if (s.low <= 1) { I.thinN++; if (l >= 10) I.thinMade++; }
      if (s.low < 5) I.maxUp = Math.max(I.maxUp, l - s.low);
    }
  }
  console.log('   거리      ' + meth.map(k => pad(k, 8)).join('') + '   n');
  for (const d of dKeys) {
    const row = meth.map(k => pad(f1(acc[d][k].n ? (acc[d][k].e / acc[d][k].n) * 100 : NaN), 8)).join('');
    console.log(`   ${pad(d === 0 ? '관측점' : d + 'km', 6)}  ${row}   ${acc[d].N.n}`);
  }
  const obsM = k => (acc[0][k].eObsLead / acc[0][k].nObsLead) * 100;
  console.log(`   관측점(+1~3h): ` + meth.map(k => `${k} ${f1(obsM(k))}`).join(' · '));
  console.log('\n   저층을 만드나 — 모델 저층 0 → 보정 저층 > 0 / 모델 저층 ≤ 1% → 보정 저층 ≥ 10% / 모델 저층 < 5% 에서 최대 증가');
  for (const k of meth) {
    const I = inv[k];
    console.log(`   ${k.padEnd(5)} ${pad(I.zeroMade, 6)} / ${I.zeroN} (${((I.zeroMade / Math.max(1, I.zeroN)) * 100).toFixed(1)}%)   ${pad(I.thinMade, 6)} / ${I.thinN} (${((I.thinMade / Math.max(1, I.thinN)) * 100).toFixed(1)}%)   +${I.maxUp.toFixed(1)}%p`);
  }
  // 앱이 정말 이것을 돌리는가 — 앱의 `correctCloudAt` 을 같은 표본에 걸어 이 자의 PG 식(앱 상수로)과 견줍니다.
  // 자는 τ 로, 앱은 운량으로 이분 탐색합니다 — 차이는 부동소수 수준이어야 합니다.
  if (typeof S.correctCloudAt === 'function') {
    const Rapp = S.SAT_TAU_NOISE / S.MODEL_COVER_SIGMA;
    const gApp = T => { const s = 0.75 * 3.4 * Math.pow(Math.max(0, T) / 100, 2.4); return (s * s) / (s * s + Rapp * Rapp); };
    let maxDiff = 0;
    for (const s of layerSamples) {
      const w = Math.exp(-s.d / S.BIAS_DECAY_KM);
      const want = allocate(s.low, s.mid, s.high, s.b * w * dampingForLead(s.L) * gApp(ro(s.low, s.mid, s.high)), false);
      const got = S.correctCloudAt({ low: s.low, mid: s.mid, high: s.high, total: null }, s.b, s.L, s.d);
      maxDiff = Math.max(maxDiff, Math.abs(got.low - want[0]), Math.abs(got.mid - want[1]), Math.abs(got.high - want[2]));
    }
    console.log(`   [앱] correctCloudAt 대 이 자의 PG(앱 상수) — 층 최대 차이 ${maxDiff.toExponential(1)}%p (표본 ${layerSamples.length})` +
      ` · 앱 상수 Ld ${S.BIAS_DECAY_KM}km(이번 ${Number.isFinite(LdStar) ? LdStar : '∞'}) · σ_τ ${S.SAT_TAU_NOISE}(이번 ${sigmaTau.toFixed(4)})`);
  }
  const keep = (obsM('N') - obsM('P')) / (obsM('N') - obsM('Pall'));
  console.log(`   맑은 기둥 규칙이 남긴 관측점 이득: ${(keep * 100).toFixed(0)}% (Pall 대비, 참고)`);

  // ── 재기 전에 정한 규칙 ────────────────────────────────────────────
  console.log('\n[규칙] 재기 전에 정한 것');
  const verdict = (c, msg) => console.log(`   ${c ? 'PASS' : 'FAIL'}: ${msg}`);
  verdict(obsIdentityMaxDiff < 1e-9, 'D4 관측점 총운량 보정이 지금과 같다');
  verdict(inv.P.zeroMade === 0, `A1 P 는 모델 저층 0 인 곳에 저층을 안 만든다 (${inv.P.zeroMade}건)`);
  verdict(obsM('P') < obsM('N'), `A2 관측점에서 P(${f1(obsM('P'))}) < N(${f1(obsM('N'))}) — 그리는 하늘도 나아진다`);
  verdict(obsM('P') <= obsM('A0'), `A2 관측점에서 P(${f1(obsM('P'))}) ≤ A0(${f1(obsM('A0'))}) — 지금보다 나쁘지 않다`);
  for (const d of DISTS) {
    const p = (acc[d].P.e / acc[d].P.n) * 100, n0 = (acc[d].N.e / acc[d].N.n) * 100;
    verdict(p <= n0 + 0.05, `A3 ${d}km 에서 P(${f1(p)}) ≤ N(${f1(n0)}) + 0.05`);
  }
  console.log('   ── 2판 PG');
  verdict(inv.PG.zeroMade === 0, `A1 PG 는 모델 저층 0 인 곳에 저층을 안 만든다 (${inv.PG.zeroMade}건)`);
  verdict(obsM('PG') < obsM('N'), `A2 관측점에서 PG(${f1(obsM('PG'))}) < N(${f1(obsM('N'))})`);
  verdict(obsM('PG') <= obsM('A0'), `A2 관측점에서 PG(${f1(obsM('PG'))}) ≤ A0(${f1(obsM('A0'))})`);
  for (const d of DISTS) {
    const p = (acc[d].PG.e / acc[d].PG.n) * 100, n0 = (acc[d].N.e / acc[d].N.n) * 100;
    verdict(p <= n0 + 0.05, `A3 ${d}km 에서 PG(${f1(p)}) ≤ N(${f1(n0)}) + 0.05`);
  }
  const kept = (obsM('N') - obsM('PG')) / (obsM('N') - obsM('P'));
  verdict(kept >= 0.8, `A4 관측점에서 PG 가 P 의 이득을 ${(kept * 100).toFixed(0)}% 지킨다 (≥ 80%)`);

  // (참고) 감쇠 길이는 총운량으로 골랐습니다. 그리는 기둥(P)으로 골랐다면 어디였을지 — 판단에는 안 씁니다.
  console.log('\n[참고] PG 를 감쇠 길이별로 — 그리는 기둥 τ 오차, 거리 25~400km × 앞선 0~3h 칸 평균');
  {
    const sum = LD_GRID.map(() => ({})), cnt = LD_GRID.map(() => ({}));
    for (const s of layerSamples) {
      if (s.d === 0) continue;
      const key = `${s.d}|${s.L}`;
      LD_GRID.forEach((Ld, j) => {
        const w = Number.isFinite(Ld) ? Math.exp(-s.d / Ld) : 1;
        const [l, mm, h] = allocate(s.low, s.mid, s.high, s.b * w * dampingForLead(s.L) * gain(ro(s.low, s.mid, s.high)), false);
        sum[j][key] = (sum[j][key] ?? 0) + Math.abs(tauFromCover(ro(l, mm, h)) - s.tSat);
        cnt[j][key] = (cnt[j][key] ?? 0) + 1;
      });
    }
    LD_GRID.forEach((Ld, j) => {
      const cells = Object.keys(sum[j]).map(k => (sum[j][k] / cnt[j][k]) * 100);
      console.log(`   Ld ${pad(Number.isFinite(Ld) ? Ld + 'km' : '∞', 7)}   ${f1(mean(cells))}`);
    });
  }

  console.log(`\n[장소별] 앞선 1시간 · 총운량 τ 오차 — 보정 전 → 감쇠 없이 / 고른 감쇠(Ld ${Number.isFinite(LdStar) ? LdStar + 'km' : '∞'})`);
  for (const r of perPlace) {
    const s = d => {
      const c = r.cells[d];
      if (!c.n) return '-';
      const b = (c.before / c.n) * 100, a = (c.cur / c.n) * 100, k = (c.ld[pick] / c.n) * 100;
      return `${f1(b)} → ${f1(a)}${a > b ? '✗' : ' '} / ${f1(k)}${k > b ? '✗' : ' '}`;
    };
    console.log(`   ${r.name.padEnd(10)} 100km ${s(100).padEnd(24)} 400km ${s(400)}`);
  }
  console.log('   (✗ = 보정 전보다 나쁨)');
})().catch(e => { console.error('ERR', e); process.exit(1); });
