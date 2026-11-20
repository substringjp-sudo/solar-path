/**
 * **비행 모드 눈 높이와 "여기로 가기"(부드러운 이동)의 순수 계산이 맞는가** — `src/utils/flightAssist.ts`. 브라우저 · 네트워크 불필요.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20, 구현보다 먼저 박았습니다)
 * 독립 기준: 눈 높이 칩 5 개(1.6 · 10 · 30 · 100 · 300 m, `sandboxDials.EYE_TICKS`), 위도 1° = 111,320 m 와 경도 1° = 111,320·cos φ m.
 * 부드러운 걸음은 5 차 smootherstep s(u) = 10u³ − 15u⁴ + 6u⁵(양 끝에서 속도 0 · 가속 0 이라 출발과 도착이 뚝 끊기지 않는다).
 *
 *  1. 비행 눈 높이 `FLY_EYE_M` = 100 m(칩 중 하나이고 범위 안).
 *  2. `eyeForMode(from, to, eyeH, stash)` = { eyeH, stash }:
 *     - 비행이 아닌 모드 → 비행: 눈이 100 m 미만이면 100 m 로 올리고 원래 높이를 stash 에 기억(1.6 → 100, stash 1.6). 이미 100 m 이상이면 그대로(150 → 150, stash null: 되돌릴 것이 없다).
 *     - 비행 → 다른 모드: stash 가 있고 눈이 아직 정확히 100 m(내가 손대지 않았다)면 stash 로 되돌린다(100 → 1.6, stash null). 그동안 사용자가 눈 높이를 바꿨으면(30) 그대로 두고 stash 만 비운다.
 *     - 비행 → 비행, 비비행 → 비비행: 아무것도 안 바뀐다(눈 · stash 그대로, stash 가 있어도).
 *     - 눈이 숫자가 아니면(NaN) 비행으로 갈 때 100 m, 그 밖에는 눈을 그대로 돌려준다(NaN 을 퍼뜨리지 않으려 비행 진입에서만 100 으로).
 *     - 걷다가 비행(1.6 → 100) 후 자전거(→ 1.6) 후 다시 비행(→ 100, stash 1.6)이 돈다.
 *  3. `glidePlan(from, to)` = { distM, durationS } | null: 거리 d(m) = 평면 근사. d < 0.01 m 면 null(갈 필요 없음). 시간 = d/150 를 1 초 이상 8 초 이하로 자른다 —
 *     30 m → 1 초, 150 m → 1 초, 300 m → 2 초, 600 m → 4 초, 1200 m → 8 초, 5000 m → 8 초, 0.5 m → 1 초(위경도 왕복의 부동소수 오차 1e-6 초 안). 좌표가 숫자가 아니면 null.
 *  4. `glideAt(from, to, u)`: u = 지난 시간 / 전체(0 ~ 1)의 자리. 출발점에서 도착점까지 **직선**(동 · 북 변위)을 따라 s(u) 만큼. u ≤ 0 · NaN 이면 출발점, u ≥ 1 이면 도착점(1e-9°).
 *     u = 0.5 에서 s = 0.5 라 정확히 한가운데(변위 1e-6 m). 진행 거리 = 전체 × s(u)(상대 1e-6). u = 0.01 의 진행 비율 = 9.8506e-6(1e-9). 진행은 u 에 따라 줄지 않는다(0.01 간격으로 훑어서 본다).
 *     도착점이 날짜변경선 건너편이어도(경도 179.9999 → −179.9999) 짧은 쪽으로 간다(0.2 m 만 간다).
 *  5. 한 걸음씩(`glideAt(.., t/duration)`)을 60 fps 로 이어 가도 끝 걸음이 도착점이다.
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-fly-glide.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, t) => Math.abs(a - b) <= t;
const RAD = Math.PI / 180, MPD = 111320;
const A = { latitude: 37.5665, longitude: 126.978 };
const east = (m, o = A) => ({ latitude: o.latitude, longitude: o.longitude + m / (MPD * Math.cos(o.latitude * RAD)) });
const north = (m, o = A) => ({ latitude: o.latitude + m / MPD, longitude: o.longitude });
const off = (p, o = A) => ({ e: (p.longitude - o.longitude) * MPD * Math.cos(o.latitude * RAD), n: (p.latitude - o.latitude) * MPD });
const s5 = (u) => 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5;

(async () => {
  let F = null;
  try { F = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'flightAssist.js')); } catch { F = null; }
  ok(!!F && typeof F.eyeForMode === 'function' && typeof F.glidePlan === 'function' && typeof F.glideAt === 'function', 'flightAssist 가 있다');
  if (!F || typeof F.eyeForMode !== 'function') { console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); }

  console.log('\n[1~2] 비행 눈 높이');
  ok(F.FLY_EYE_M === 100, 'FLY_EYE_M = 100');
  const E = F.eyeForMode;
  let r = E('walk', 'fly', 1.6, null);
  ok(r.eyeH === 100 && r.stash === 1.6, '걷기 → 비행: 1.6 → 100, stash 1.6');
  r = E('walk', 'fly', 150, null);
  ok(r.eyeH === 150 && r.stash === null, '이미 높으면 그대로, stash 없음');
  r = E('fly', 'walk', 100, 1.6);
  ok(r.eyeH === 1.6 && r.stash === null, '비행 → 걷기: 손대지 않았으면 1.6 으로 되돌린다');
  r = E('fly', 'car', 30, 1.6);
  ok(r.eyeH === 30 && r.stash === null, '그동안 30 으로 바꿨으면 그대로 두고 stash 만 비운다');
  r = E('fly', 'fly', 100, 1.6);
  ok(r.eyeH === 100 && r.stash === 1.6, '비행 → 비행: 그대로');
  r = E('walk', 'bike', 10, 5);
  ok(r.eyeH === 10 && r.stash === 5, '비비행 → 비비행: 그대로(stash 도)');
  r = E('walk', 'fly', NaN, null);
  ok(r.eyeH === 100 && r.stash === null, '눈이 NaN 이면 비행 진입에서 100');
  r = E('walk', 'fly', 1.6, null); const r2 = E('fly', 'bike', r.eyeH, r.stash); const r3 = E('bike', 'fly', r2.eyeH, r2.stash);
  ok(r2.eyeH === 1.6 && r3.eyeH === 100 && r3.stash === 1.6, '걷기 → 비행 → 자전거 → 비행이 돈다');

  console.log('\n[3] glidePlan');
  const dur = (m) => { const p = F.glidePlan(A, north(m)); return p ? p.durationS : null; };
  ok(near(dur(30), 1, 1e-9) && near(dur(150), 1, 1e-6) && near(dur(300), 2, 1e-6) && near(dur(600), 4, 1e-6) && near(dur(1200), 8, 1e-6) && near(dur(5000), 8, 1e-9) && near(dur(0.5), 1, 1e-9), `시간 30→1 150→1 300→2 600→4 1200→8 5000→8 0.5→1: ${[30, 150, 300, 600, 1200, 5000, 0.5].map(dur).join(' ')}`);
  ok(F.glidePlan(A, { ...A }) === null && F.glidePlan(A, north(0.005)) === null, '0.01 m 미만이면 null');
  ok(near(F.glidePlan(A, north(300)).distM, 300, 1e-3) && near(F.glidePlan(A, east(300)).distM, 300, 1e-3), '거리가 300 m(동 · 북)');
  ok(F.glidePlan(A, { latitude: NaN, longitude: 1 }) === null && F.glidePlan({ latitude: 1, longitude: Infinity }, A) === null, '숫자가 아니면 null');

  console.log('\n[4~5] glideAt');
  const to = { latitude: A.latitude + 600 / MPD, longitude: A.longitude + 800 / (MPD * Math.cos(A.latitude * RAD)) }; // 동 800, 북 600 → 1000 m
  const g = (u) => F.glideAt(A, to, u);
  ok(near(g(0).latitude, A.latitude, 1e-12) && near(g(-1).longitude, A.longitude, 1e-12) && near(g(NaN).latitude, A.latitude, 1e-12), 'u ≤ 0 · NaN 은 출발점');
  ok(near(g(1).latitude, to.latitude, 1e-9) && near(g(2).longitude, to.longitude, 1e-9), 'u ≥ 1 은 도착점');
  const mid = off(g(0.5));
  ok(near(mid.e, 400, 1e-6) && near(mid.n, 300, 1e-6), `한가운데 = 동 400 · 북 300 (${mid.e.toFixed(6)}, ${mid.n.toFixed(6)})`);
  let okAll = true, prev = -1, lineOk = true;
  for (let i = 0; i <= 100; i++) {
    const u = i / 100, o = off(g(u)), d = Math.hypot(o.e, o.n);
    if (Math.abs(d - 1000 * s5(u)) > 1e-3 + 1e-6 * 1000) okAll = false;
    if (d < prev - 1e-9) okAll = false;
    prev = d;
    if (Math.abs(o.e * 0.6 - o.n * 0.8) > 1e-6) lineOk = false;   // 동:북 = 4:3 의 직선 위
  }
  ok(okAll, '진행 거리 = 1000 · s(u), 줄지 않는다');
  ok(lineOk, '내내 같은 직선 위(동:북 = 4:3)');
  const o01 = off(g(0.01)); ok(near(Math.hypot(o01.e, o01.n) / 1000, 9.8506e-6, 1e-9), `u = 0.01 진행 비율 9.8506e-6 (${(Math.hypot(o01.e, o01.n) / 1000).toExponential(4)})`);
  const w = F.glideAt({ latitude: 0, longitude: 179.9999 }, { latitude: 0, longitude: -179.9999 }, 0.5);
  ok(Math.abs(Math.abs(w.longitude) - 180) < 1e-4, `날짜변경선 건너편은 짧은 쪽으로(중간 경도 ${w.longitude})`);
  const plan = F.glidePlan(A, to); let p = A;
  for (let t = 0; t <= plan.durationS + 1 / 60; t += 1 / 60) p = F.glideAt(A, to, t / plan.durationS);
  ok(near(p.latitude, to.latitude, 1e-9) && near(p.longitude, to.longitude, 1e-9), '60 fps 로 이어 가도 끝은 도착점');

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
