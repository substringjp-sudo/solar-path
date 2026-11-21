/**
 * **카메라 노출 추천 칸(`src/utils/exposureAdvice.ts`)과 자동 시작 카운트다운(`src/utils/autoStart.ts`)이 맞는가** — 순수 계산 판정.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 이 칸들은 **추천**이지 카메라를 조종하지 않습니다(expo-camera 는 사진 모드의 ISO · 셔터 · WB 를 못 정함). 화면에도 "추천 · 맑은 하늘 기준 어림"이라고 적습니다.
 *
 * A. `adviseExposure(해 고도°, { handheld = true })` — 맑은 하늘 밝기는 `exposureCurve.sceneLux`(−12° 0.01 · −6° 3.4 · 0° 400 · +10° 10000 lux, 로그 직선)를 씁니다.
 *    EV100 = log2(lux ÷ 2.5)(입사광 노출계 상수 C = 250), 폰 조리개 N = 1.8 고정, ISO 100 일 때 셔터 t0 = N² ÷ 2^EV100. 손에 들면 셔터가 1/30 초보다 느려지지 않게 ISO 를 올린다:
 *    필요 ISO = 100 × t0 × 30, 보이는 ISO 는 {100,125,160,200,250,320,400,500,640,800,1000,1250,1600,2000,2500,3200} 중 **필요한 값 이상인 가장 작은 것**(100 아래면 100, 3200 넘으면 3200).
 *    그 ISO 로 다시 셔터 t = t0 × 100 ÷ ISO, 보이는 셔터는 1/3 단 표준값 중 **로그로 가장 가까운 것**. 단계: t ≤ 1/30 'ok', 1/30 < t ≤ 1 s 'tripod'(삼각대), 1 s 초과 'astro'(천체 탭 권장).
 *    손계산(위 식 그대로 손으로 계산, 노드로 다시 확인): 고도 +10° → 10000 lux, EV 11.966, t0 = 1/1235 → ISO 100 · 1/1250 · ok. +5° → 2000 lux, EV 9.644, t0 = 1/247 → ISO 100 · 1/250 · ok.
 *    +2.5° → 894.4 lux, EV 8.483, t0 = 1/110.4 → ISO 100 · 1/100 · ok. 0° → 400 lux, EV 7.322, t0 = 1/49.4 → ISO 100 · 1/50 · ok.
 *    −3° → 36.88 lux, EV 3.883, t0 = 0.2196 s, 필요 ISO 659 → 800, t = 0.2196 × 100 ÷ 800 = 0.02745 s = 1/36.4 → 1/40 · ok.
 *    −6° → 3.4 lux, EV 0.444, t0 = 2.382 s, 필요 ISO 7147 → 3200, t = 0.0744 s = 1/13.4 → 1/13 · tripod. −9° → 0.184 lux, t0 = 43.9 s, ISO 3200 에서 t = 1.373 s → 1.3 s · astro.
 *    `handheld: false`(삼각대) 이면 ISO 100 고정, t = t0(셔터는 표준값으로 가장 가까운 것): 0° → 1/50 · ISO 100 · ok, −6° → 2.38 s → 2.5 s · astro(1 s 넘음), −3° → 0.2196 s → 1/5 · ok(처음에 1/4 로 적었으나 로그로 0.2196 은 1/5(0.2, 차 0.093)가 1/4(차 0.130)보다 가까워 손계산을 고침; 1/30 이 아니라 1 s 까지 ok 로 본다 — 삼각대는 느린 셔터가 괜찮음).
 *    숫자가 아닌 고도 → null.
 *    WB 추천(설계 값 — 물리 값 아님, 노을에 WB 를 자동에 두면 붉은 색이 눌리는 일이 흔해서 고정을 권하는 통념): 고도 ≥ 6° 'auto', −6° ≤ 고도 < 6° 'daylight'(일광 고정), 고도 < −6° 'night'(야간 4000K).
 *    글: 셔터 "1/50" · 1 초 이상 "2.5s", ISO "ISO 100", WB 한국어 "자동" · "일광 고정" · "야간 4000K".

 *    셔터를 표준값에 맞추는 기준은 **로그**(1/100 s = 0.01 과 1/125 s = 0.008 의 중간은 √(0.01 × 0.008) = 0.008944): 고도 +2.53° → 903.5 lux, t0 = 8.1 ÷ lux = 0.008965 s 는 로그로는 1/100 에 가깝고(선형 중간 0.009 라면 1/125) → '1/100'.
 *    `shutterLabel(1)` = "1s", `shutterLabel(0.5)` = "1/2", `shutterLabel(2.5)` = "2.5s".
 *    (알려진 한계: ISO 를 `>=` 로 고르는 경계와 1 초 정각 'astro' 경계는 값이 표준값에 정확히 걸릴 때만 달라져 연속 값 판정으로는 못 가립니다 — 동치 변이로 기록.)
 *
 * B. `autoStartState(장면 시각 ms, 지금 ms)` = { kind: 'now' } (장면 시각이 이미 지났거나 같음, 숫자가 아님) | { kind: 'wait', remainingMs, text } (0 < 남은 ≤ 2 시간) | { kind: 'far' } (2 시간 초과).
 *    text = `T−` + 남은 초를 **올림**한 값: 1 시간 미만 "mm:ss", 1 시간 이상 "h:mm:ss". 400 s → "T−06:40", 3600 s → "T−1:00:00", 0.5 s → "T−00:01", 7199.2 s → "T−1:59:60"이 아니라 올림 7200 → "T−2:00:00".
 *    `autoStartDue(예약 시각 ms, 지금 ms)` = 예약 시각 ≤ 지금(참). 예약이 null · NaN 이면 거짓.
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };

(async () => {
  let A = null, S = null;
  try { A = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'exposureAdvice.js')); } catch { A = null; }
  try { S = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'autoStart.js')); } catch { S = null; }
  const adv = (a, o) => (A && A.adviseExposure ? A.adviseExposure(a, o) : null);

  console.log('\n[A] adviseExposure 손들기');
  const row = (a, iso, sh, lvl) => { const r = adv(a); return !!r && r.iso === iso && r.shutterText === sh && r.level === lvl; };
  ok(row(10, 100, '1/1250', 'ok'), '+10°: ISO 100 · 1/1250');
  ok(row(5, 100, '1/250', 'ok'), '+5°: ISO 100 · 1/250');
  ok(row(2.5, 100, '1/100', 'ok'), '+2.5°: ISO 100 · 1/100');
  ok(row(0, 100, '1/50', 'ok'), '0°: ISO 100 · 1/50');
  ok(row(-3, 800, '1/40', 'ok'), '−3°: ISO 800 · 1/40(필요 659 → 800)');
  ok(row(-6, 3200, '1/13', 'tripod'), '−6°: ISO 3200 · 1/13 · 삼각대');
  ok(row(-9, 3200, '1.3s', 'astro'), '−9°: ISO 3200 · 1.3s · 천체 탭');
  const e0 = adv(0);
  ok(!!e0 && Math.abs(e0.ev100 - 7.322) < 0.01 && adv(NaN) === null && adv(undefined) === null, 'EV100 7.322(0°), 숫자가 아니면 null');

  ok(row(2.53, 100, '1/100', 'ok'), '+2.53°: 로그로 가까운 1/100(선형이면 1/125)');
  const sl = A && A.shutterLabel ? [A.shutterLabel(1), A.shutterLabel(0.5), A.shutterLabel(2.5)] : [];
  ok(sl[0] === '1s' && sl[1] === '1/2' && sl[2] === '2.5s', '셔터 글: 1s · 1/2 · 2.5s');

  console.log('\n[A] adviseExposure 삼각대');
  const tri = (a) => adv(a, { handheld: false });
  const t0 = tri(0), t6 = tri(-6), t3 = tri(-3);
  ok(!!t0 && t0.iso === 100 && t0.shutterText === '1/50' && t0.level === 'ok', '삼각대 0°: ISO 100 · 1/50');
  ok(!!t6 && t6.iso === 100 && t6.shutterText === '2.5s' && t6.level === 'astro', '삼각대 −6°: 2.5s · 천체 탭');
  ok(!!t3 && t3.iso === 100 && t3.shutterText === '1/5' && t3.level === 'ok', '삼각대 −3°: 1/5 · ok');

  console.log('\n[A] WB');
  const wb = (a) => { const r = adv(a); return r ? r.wb : null; };
  ok(wb(6) === 'auto' && wb(20) === 'auto' && wb(5.99) === 'daylight' && wb(-6) === 'daylight' && wb(-6.01) === 'night' && wb(-20) === 'night', 'WB: ≥6 자동 · [−6, 6) 일광 고정 · <−6 야간');
  const L = A && A.wbLabel ? [A.wbLabel('auto', 'ko'), A.wbLabel('daylight', 'ko'), A.wbLabel('night', 'ko')] : [];
  ok(L[0] === '자동' && L[1] === '일광 고정' && L[2] === '야간 4000K', 'WB 글(한국어)');

  console.log('\n[B] autoStartState');
  const st = (scene, now) => (S && S.autoStartState ? S.autoStartState(scene, now) : null);
  const w = st(1_400_000, 1_000_000);
  ok(!!w && w.kind === 'wait' && w.text === 'T−06:40' && w.remainingMs === 400_000, '400 s → "T−06:40"');
  const w2 = st(3_600_000, 0);
  ok(!!w2 && w2.kind === 'wait' && w2.text === 'T−1:00:00', '3600 s → "T−1:00:00"');
  const w3 = st(500, 0);
  ok(!!w3 && w3.kind === 'wait' && w3.text === 'T−00:01', '0.5 s → 올림 "T−00:01"');
  const w4 = st(7_199_200, 0);
  ok(!!w4 && w4.kind === 'wait' && w4.text === 'T−2:00:00', '7199.2 s → 올림 "T−2:00:00"');
  ok(st(7_200_001, 0) && st(7_200_001, 0).kind === 'far' && st(7_200_000, 0) && st(7_200_000, 0).kind === 'wait', '2 시간 초과는 far, 2 시간 정각은 wait');
  const k = (a, b) => { const r = st(a, b); return r ? r.kind : null; };
  ok(k(1000, 1000) === 'now' && k(500, 1000) === 'now' && k(NaN, 0) === 'now' && k(undefined, 0) === 'now', '지났거나 같거나 숫자가 아니면 now');

  console.log('\n[B] autoStartDue');
  const due = (a, n) => (S && S.autoStartDue ? S.autoStartDue(a, n) : 'none');
  ok(due(1000, 999) === false && due(1000, 1000) === true && due(1000, 1001) === true && due(null, 5) === false && due(NaN, 5) === false, '예약 시각 ≤ 지금이면 참, 예약이 없으면 거짓');

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
