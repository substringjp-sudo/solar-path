/**
 * **날씨에 따른 굴절 계수(`src/utils/refractionK.ts`)와 k 를 받는 곡률 함수(`earth.ts` · `horizon.ts`)가 맞는가** — 순수 계산 판정. 브라우저 · 네트워크 불필요.
 * 계획 문서 6.1 "날씨에 따른 정밀 굴절"의 계산 바탕입니다. 이 판정이 보는 것은 **계산 식과 k 를 넘기는 길**뿐이고, 앱이 날씨 자료(기온 단면)를 받아 쓰는 연결과 설정 스위치는 아직 없습니다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 식(측지학의 대기 굴절 계수, Gaylord · Bomford): **k = 503 · (P / T²) · (0.0343 + dT/dh)** — P 는 기압(hPa), T 는 기온(K), dT/dh 는 기온 감률(K/m, 위로 갈수록 식으면 음수).
 *   표준 대기(1013.25 hPa, 288.15 K, dT/dh = −0.0065)에서 k = 503 × 1013.25 ÷ 288.15² × 0.0278 = 0.17064(손계산). 흔히 쓰는 k = 0.13(평균) · 1/7 = 0.1429 보다 조금 크다 — 표준 대기 값이고, 앱의 기본(1/7)은 그대로 둔다.
 * 함수 `refractionKFromWeather({ tC, pHpa, lapseKPerM })` → k. 입력이 유한한 수가 아니거나 T ≤ 0 K · P ≤ 0 이면 기본 `REFRACTION_K`(1/7). 결과는 [−0.2, 0.6] 로 자른다(식이 극단 입력에서 덕트 · 하강 같은 영역으로 가는 것을 막는 안전 범위).
 *   손계산: 역전층(+0.02 K/m) k = 503 × 1013.25 ÷ 288.15² × (0.0343 + 0.02) = 0.33331 · 지표가 뜨거운 날(−0.03) 0.02639 · 감률 −0.0343 에서 0 · 겨울 찬 날(1030 hPa, 263.15 K, −0.0065) 0.20799 · 감률 −0.1 은 −0.403 → −0.2 로 잘림 · 감률 +0.2 는 1.438 → 0.6 으로 잘림.
 * 함수 `lapseRate(tLowC, tHighC, dzM)` = (tHigh − tLow) ÷ dz (K/m). dz ≤ 0 이거나 유한하지 않으면 null. 손계산: (10 − 14) ÷ (180 − 2) = −0.022472.
 * earth.ts: `effectiveRadiusM(k)` = R ÷ (1 − k)(기본 인자 `REFRACTION_K` 이면 기존 `EARTH_RADIUS_EFFECTIVE_M` 과 같음). `curvatureDropM(d, k?)` · `seaHorizonDipDeg(h, k?)` · `seaHorizonDistM(h, k?)` 는 선택 인자 k 를 받고, 안 주면 지금까지와 똑같다(7/6 R).
 *   손계산(R = 6 371 000 m): 유효 반지름 k = 0.17064 → 7 681 868.09 m. 낙차 40 km: 기본 107.631 m · k = 0.17064 104.141 m · k = 0 125.569 m · k = 0.33331 83.717 m. 수평선 내림각 눈높이 100 m: 기본 0.29721° · k = 0.17064 0.29235° · k = 0 0.32102°. 수평선 거리 100 m: 기본 38 556.0 m · 0.17064 39 196.6 m · 0 35 695.9 m.
 * horizon.ts: `buildHorizonProfile(sample, eyeM, { refractionK })` 가 그 k 로 낙차를 뺀다. 눈높이 10 m, 40 km 밖이 전부 300 m 인 고원: 스카이라인 앙각 = atan2(300 − 10 − 낙차(40 km), 40 km). 손계산: 기본 0.26122° · k = 0.17064 0.26622° · k = 0 0.23553° · k = 0.33331 0.29548°. 허용 ±0.002°(표본 걸음이 최대 125 m 라 가장 가까운 표본이 40 km 에서 ≤ 125 m 뒤, 그 차이는 0.0018°). 옵션을 안 주면 기본과 같다.
 */
const path = require('path');
const { PREVIEW } = require('./paths');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

(async () => {
  const imp = (f) => import('file://' + path.join(PREVIEW, 'app', 'utils', f)).catch(() => null);
  const K = await imp('refractionK.js');
  const E = await imp('earth.js');
  const H = await imp('horizon.js');
  const kw = (tC, pHpa, g) => (K && K.refractionKFromWeather ? K.refractionKFromWeather({ tC, pHpa, lapseKPerM: g }) : NaN);

  console.log('[1] 굴절 계수 식(손계산)');
  ok(near(kw(15, 1013.25, -0.0065), 0.17064, 1e-4), '표준 대기 k = 0.17064');
  ok(near(kw(15, 1013.25, 0.02), 0.33331, 1e-4), '역전층 k = 0.33331');
  ok(near(kw(15, 1013.25, -0.03), 0.02639, 1e-4), '지표가 뜨거운 날 k = 0.02639');
  ok(near(kw(15, 1013.25, -0.0343), 0, 1e-4), '감률 −0.0343 에서 k = 0');
  ok(near(kw(-10, 1030, -0.0065), 0.20799, 1e-4), '겨울 찬 날(1030 hPa, −10 °C) k = 0.20799');
  ok(kw(15, 1013.25, -0.1) === -0.2 && kw(15, 1013.25, 0.2) === 0.6, '극단은 [−0.2, 0.6] 으로 자른다');
  const def = 1 / 7;
  ok(near(kw(NaN, 1013, -0.0065), def, 1e-12) && near(kw(15, NaN, -0.0065), def, 1e-12) && near(kw(15, 1013, NaN), def, 1e-12) && near(kw(-273.15, 1013, -0.0065), def, 1e-12) && near(kw(15, 0, -0.0065), def, 1e-12), '틀린 입력은 기본 1/7');

  console.log('\n[2] 감률');
  const L = K && K.lapseRate;
  ok(!!L && near(L(14, 10, 178), -0.022472, 1e-5) && near(L(14, 10, 178), (10 - 14) / (180 - 2), 1e-12) && L(14, 10, 0) === null && L(14, 10, -5) === null && L(NaN, 10, 100) === null, '(10−14)/(180−2) = −0.022472, 높이차가 0 이하 · 숫자 아님이면 null');

  console.log('\n[3] earth.ts 의 k 인자');
  const R = 6371000;
  ok(!!E && near(E.effectiveRadiusM(0.17064444), 7681868.09, 1) && near(E.effectiveRadiusM(), E.EARTH_RADIUS_EFFECTIVE_M, 1e-6) && near(E.effectiveRadiusM(1 / 7), R / (1 - 1 / 7), 1e-6), '유효 반지름 k=0.17064 → 7 681 868 m, 기본 = 7/6 R');
  const kStd = 0.17064444, kInv = 0.3333091;
  ok(near(E.curvatureDropM(40000), 107.631, 0.01) && near(E.curvatureDropM(40000, kStd), 104.141, 0.01) && near(E.curvatureDropM(40000, 0), 125.569, 0.01) && near(E.curvatureDropM(40000, kInv), 83.717, 0.01), '낙차 40 km: 기본 107.631 · 0.17064 104.141 · 0 125.569 · 0.33331 83.717');
  ok(near(E.seaHorizonDipDeg(100), 0.29721, 1e-4) && near(E.seaHorizonDipDeg(100, kStd), 0.29235, 1e-4) && near(E.seaHorizonDipDeg(100, 0), 0.32102, 1e-4), '수평선 내림각 100 m: 기본 0.29721 · 0.17064 0.29235 · 0 0.32102');
  ok(near(E.seaHorizonDistM(100), 38556.0, 0.5) && near(E.seaHorizonDistM(100, kStd), 39196.6, 0.5) && near(E.seaHorizonDistM(100, 0), 35695.9, 0.5), '수평선 거리 100 m: 기본 38 556.0 · 0.17064 39 196.6 · 0 35 695.9');

  console.log('\n[4] horizon.ts 가 k 를 쓴다');
  const plateau = (e, s) => (Math.hypot(e, s) >= 40000 ? 300 : 0);
  const sky = (opts) => { const p = H.buildHorizonProfile(plateau, 10, { maxDistM: 41000, ...opts }); return H.skylineAngleDeg(p, 0); };
  ok(near(sky({}), 0.26122, 0.002) && near(sky({ refractionK: 1 / 7 }), 0.26122, 0.002), '옵션 없음 = k 1/7: 0.26122°');
  ok(near(sky({ refractionK: kStd }), 0.26622, 0.002), 'k = 0.17064: 0.26622°');
  ok(near(sky({ refractionK: 0 }), 0.23553, 0.002), 'k = 0: 0.23553°');
  ok(near(sky({ refractionK: kInv }), 0.29548, 0.002), 'k = 0.33331: 0.29548°');

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
