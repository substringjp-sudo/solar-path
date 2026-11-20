/**
 * **연속 이동 조이스틱의 이동 엔진이 맞는가** — `src/utils/joystickMotion.ts`. 브라우저 · 네트워크 불필요. 장면은 건드리지 않습니다.
 *
 * 승인된 규칙(docs/SANDBOX_MODE_PLAN.md 12.2, 사용자 2026-11-20): 조이스틱은 손잡이를 민 정도로 속도를 **연속으로** 정하고(순간이동 없음),
 * 속도는 0.3 초 안팎으로 부드럽게 바뀌며, 방향은 시선 기준이 기본입니다. 이 판정은 그 규칙을 값으로 박습니다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20, 구현보다 먼저 박았습니다)
 *
 *  1. **속도 곡선**: 중심 둘레 28 % 의 데드존을 뺀 나머지를 0~1 로 바꿔 제곱하고 모드의 최고 속도를 곱한다.
 *     모드와 최고 속도는 걷기 2 · 자전거 8 · 차 25 · 비행 120 m/s. 손잡이가 중심에서 반지름의 비율 m 만큼 밀렸을 때(`stickState` 가 낸 상태로)
 *       m ≤ 0.28 이면 0, m = 1 이면 최고 속도, m = 0.64(데드존 바깥 한가운데)면 최고 속도의 1/4, m > 1(끝을 넘어 밀어도)이면 최고 속도로 자르고,
 *       m 이 늘 때 속도가 줄지 않으며(0.001 간격 전 구간), 0.28 을 넘기면 늘 0 보다 크다. 기댓값은 이 규칙 글에서 독립으로 센 값이다(구현의 식을 되부르지 않는다).
 *  2. **방향**: 손잡이 축에서 속도의 방향은 민 방향(화면 오른쪽 +, 위 +)과 같다: 아무 각 24곳에서 `atan2` 가 1e-9 안으로 같다. 데드존 안이면 (0, 0).
 *  3. **부드러운 가감속**: 목표 속도 V 로 정지에서 출발하면 τ = 0.3 초에 V 의 1 − 1/e (63.2 %), 0.9 초에 1 − e⁻³ (95.0 %), 1.5 초에 99.3 % 이상이다(각 ±0.05 %p).
 *     손을 떼면(목표 0) 같은 꼴로 줄어 0.3 초에 36.8 % 가 남는다. 어느 때도 목표를 넘지 않는다(오버슈트 없음).
 *  4. **프레임 간격에 무관한 이동량**: 목표가 일정할 때 2 초 동안 간 거리는 프레임 간격(1/10 · 1/24 · 1/30 · 1/60 · 1/144 초, 그리고 들쭉날쭉한 간격으로 합이 2 초)에 상관없이
 *     닫힌 식 V·T − V·τ·(1 − e^(−T/τ)) 와 상대오차 1e-9 안으로 같다. 손을 뗀 뒤(목표 0, 처음 속도 v0)는 v0·τ·(1 − e^(−T/τ)).
 *     (프레임마다 속도에 dt 를 곱해 더하는 단순한 방법은 간격이 클수록 어긋난다 — 이 검사가 그것을 잡을 수 있으려면 1/10 초에서 단순한 방법과 닫힌 식이 0.5 % 이상 달라야 한다.
 *      같으면 검사가 못 쓰이므로 실패로 친다.)
 *  5. **시선 기준 회전**: 시선 방위 h(북 0, 동쪽으로 늘어남)에서 손잡이 "앞"은 (동, 북) = (sin h, cos h), "오른쪽"은 (cos h, −sin h) 로 간다. h = 0 · 45 · 90 · 180 · 270 에서
 *     독립으로 센 값과 같고, 나침반 기준이면 h 와 무관하게 손잡이 위가 북, 오른쪽이 동이다. 회전은 속력을 바꾸지 않는다(1e-12).
 *  6. **먼 곳은 이 조이스틱으로 가지 않는다**: 비행 최고 속도로 정지에서 10 km 를 가는 데 걸리는 시간이 10000/120 + 0.3 = 83.63 초(±0.5)이다(계획 문서의 "약 80 초").
 *  7. **엉뚱한 입력**: 프레임 간격이 0 이하이거나 NaN 이면 움직이지 않고 속도도 그대로, 손잡이 상태가 NaN 이면 목표 0, 비활성이면 목표 0.
 *  8. **속도 글**: 9.95 m/s 미만은 소수 한 자리("1.2 m/s", "0.0 m/s"), 그 이상은 정수("84 m/s", "10 m/s"), 음수나 NaN 은 "0.0 m/s".
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-joystick-motion.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  const U = (m) => import('file://' + path.join(PREVIEW, 'app', 'utils', m));
  const S = await U('sandboxDials.js');
  let J = null;
  try { J = await U('joystickMotion.js'); } catch { J = null; }
  ok(!!J && typeof J.targetVelocity === 'function' && typeof J.stepMotion === 'function' && typeof J.toWorld === 'function', 'joystickMotion 이 있다');
  if (!J || typeof J.targetVelocity !== 'function') { console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); }

  const MAX = { walk: 2, bike: 8, car: 25, fly: 120 };
  const TRAVEL = 29;     // 손잡이가 갈 수 있는 반지름(px) — 앱의 값과 같을 필요는 없고 비율만 봅니다.
  // 손잡이를 (m 비율, 각도) 만큼 밀었을 때의 상태. 각도는 화면 기준(오른쪽 0°, 위 90°).
  const push = (m, angDeg = 90) => {
    const a = (angDeg * Math.PI) / 180;
    return S.stickState(m * TRAVEL * Math.cos(a), -m * TRAVEL * Math.sin(a), TRAVEL);   // 화면 y 는 아래가 +
  };
  const speedOfPush = (mode, m, ang = 90) => { const v = J.targetVelocity(push(m, ang), mode); return Math.hypot(v.east, v.north); };
  // 독립 기댓값: 규칙 글 그대로(데드존 28 % 를 빼고 0~1 로 늘려 제곱, 최고 속도를 곱한다)
  const expectSpeed = (mode, m) => { const mm = Math.min(1, m); return mm <= 0.28 ? 0 : MAX[mode] * ((mm - 0.28) / 0.72) ** 2; };

  // ── 1 속도 곡선
  console.log('\n[1] 속도 곡선');
  ok(S.STICK_DEADZONE === 0.28 && J.MODE_MAX_SPEED_MPS.walk === 2 && J.MODE_MAX_SPEED_MPS.bike === 8 && J.MODE_MAX_SPEED_MPS.car === 25 && J.MODE_MAX_SPEED_MPS.fly === 120, '데드존 0.28, 최고 속도 걷기 2 · 자전거 8 · 차 25 · 비행 120');
  for (const mode of Object.keys(MAX)) {
    const pts = [0, 0.1, 0.27, 0.28, 0.3, 0.5, 0.64, 0.8, 1, 1.5];
    const bad = pts.filter(m => !near(speedOfPush(mode, m), expectSpeed(mode, m), 1e-9));
    ok(bad.length === 0, `${mode}: m = ${pts.join(' · ')} 에서 규칙 글의 기댓값과 같다${bad.length ? ' — 어긋남 ' + bad.join(',') : ''}`);
    ok(near(speedOfPush(mode, 1), MAX[mode], 1e-9) && near(speedOfPush(mode, 0.64), MAX[mode] / 4, 1e-9) && near(speedOfPush(mode, 1.5), MAX[mode], 1e-9) && speedOfPush(mode, 0.28) === 0, `${mode}: m=1 최고 속도 ${MAX[mode]}, m=0.64 는 1/4, m=1.5 도 최고 속도, m=0.28 은 0`);
  }
  {
    let prev = -1, mono = true, firstPositive = null;
    for (let i = 0; i <= 1000; i++) {
      const m = i / 1000, v = speedOfPush('car', m);
      if (v < prev - 1e-12) mono = false;
      if (m > 0.28 && v <= 0 && firstPositive === null) firstPositive = m;
      prev = v;
    }
    ok(mono && firstPositive === null, `속도가 밀수록 줄지 않고(0.001 간격 전 구간) 0.28 을 넘기면 늘 0 보다 크다${firstPositive != null ? ` — m=${firstPositive} 에서 0` : ''}`);
  }

  // ── 2 방향
  console.log('\n[2] 방향');
  {
    let worst = 0;
    for (let k = 0; k < 24; k++) {
      const ang = k * 15 + 7;
      const v = J.targetVelocity(push(0.8, ang), 'bike');
      const a = Math.atan2(v.north, v.east) * 180 / Math.PI;
      worst = Math.max(worst, Math.abs((((a - ang) % 360) + 540) % 360 - 180));
    }
    ok(worst < 1e-7, `손잡이를 민 각 24곳에서 속도의 방향이 같다(최대 오차 ${worst.toExponential(1)}°)`);
    const z = J.targetVelocity(push(0.2, 30), 'fly');
    ok(z.east === 0 && z.north === 0, '데드존 안(m=0.2)이면 (0, 0)');
  }

  // ── 3 부드러운 가감속
  console.log('\n[3] 부드러운 가감속');
  const TAU = 0.3;
  const run = (v0, target, seconds, dt) => {
    let v = { ...v0 }, t = 0, dE = 0, dN = 0, maxOver = -Infinity;
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      const r = J.stepMotion(v, target, dt);
      v = r.v; dE += r.dEast; dN += r.dNorth; t += dt;
      maxOver = Math.max(maxOver, Math.hypot(v.east, v.north) - Math.hypot(target.east, target.north));
    }
    return { v, dE, dN, maxOver };
  };
  {
    const V = { east: 6, north: 8 }, sp = 10;     // 속력 10
    const at = (sec) => Math.hypot(...Object.values(run({ east: 0, north: 0 }, V, sec, 1 / 60).v)) / sp;
    ok(near(at(0.3), 1 - Math.exp(-1), 5e-4) && near(at(0.9), 1 - Math.exp(-3), 5e-4) && at(1.5) >= 0.993, `정지에서 출발: 0.3 초 ${(at(0.3) * 100).toFixed(2)} % (기대 63.21), 0.9 초 ${(at(0.9) * 100).toFixed(2)} % (기대 95.02), 1.5 초 ${(at(1.5) * 100).toFixed(2)} %`);
    const rel = Math.hypot(...Object.values(run(V, { east: 0, north: 0 }, 0.3, 1 / 60).v)) / sp;
    ok(near(rel, Math.exp(-1), 5e-4), `손을 떼면 0.3 초에 ${(rel * 100).toFixed(2)} % 가 남는다(기대 36.79)`);
    const over = run({ east: 0, north: 0 }, V, 3, 1 / 60).maxOver;
    ok(over <= 1e-12, `목표를 넘지 않는다(최대 초과 ${over.toExponential(1)})`);
    const dirKept = (() => { const r = run({ east: 0, north: 0 }, V, 0.5, 1 / 60).v; return near(Math.atan2(r.north, r.east), Math.atan2(8, 6), 1e-9); })();
    ok(dirKept, '가속하는 동안 방향이 목표 방향 그대로다(옆으로 휘지 않는다)');
  }

  // ── 4 프레임 간격에 무관한 이동량
  console.log('\n[4] 프레임 간격에 무관한 이동량');
  {
    const V = { east: 0, north: 25 }, T = 2;
    const closed = V.north * T - V.north * TAU * (1 - Math.exp(-T / TAU));
    const relErr = (a, b) => Math.abs(a - b) / Math.abs(b);
    const dts = [1 / 10, 1 / 24, 1 / 30, 1 / 60, 1 / 144];
    const errs = dts.map(dt => relErr(run({ east: 0, north: 0 }, V, T, dt).dN, closed));
    ok(errs.every(e => e < 1e-9), `정지에서 출발 2 초: 간격 1/10 · 1/24 · 1/30 · 1/60 · 1/144 모두 닫힌 식 ${closed.toFixed(4)} m 와 같다(최대 상대오차 ${Math.max(...errs).toExponential(1)})`);
    // 들쭉날쭉한 간격(합 2 초)
    let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const jit = []; let sum = 0; while (sum < T - 0.2) { const d = 0.005 + rnd() * 0.06; jit.push(d); sum += d; } jit.push(T - sum);
    let v = { east: 0, north: 0 }, dN = 0;
    for (const d of jit) { const r = J.stepMotion(v, V, d); v = r.v; dN += r.dNorth; }
    ok(relErr(dN, closed) < 1e-9, `들쭉날쭉한 간격 ${jit.length}번(합 ${jit.reduce((a, b) => a + b, 0).toFixed(3)} 초)도 같다(상대오차 ${relErr(dN, closed).toExponential(1)})`);
    // 손을 뗀 뒤
    const v0 = { east: 0, north: 25 }, closedRel = v0.north * TAU * (1 - Math.exp(-T / TAU));
    const errsRel = dts.map(dt => relErr(run(v0, { east: 0, north: 0 }, T, dt).dN, closedRel));
    ok(errsRel.every(e => e < 1e-9), `손을 뗀 뒤 2 초: 모든 간격에서 v0·τ·(1 − e^(−T/τ)) = ${closedRel.toFixed(4)} m 와 같다(최대 상대오차 ${Math.max(...errsRel).toExponential(1)})`);
    // 검사의 분별력: 단순히 속도 × dt 를 더하면 1/10 초에서 닫힌 식과 0.5 % 이상 달라야 한다
    let vv = 0, naive = 0;
    for (let i = 0; i < 20; i++) { vv += (V.north - vv) * (1 - Math.exp(-0.1 / TAU)); naive += vv * 0.1; }
    ok(relErr(naive, closed) > 0.005, `검사의 분별력: 단순한 방법(속도 × dt)은 1/10 초에서 닫힌 식과 ${(relErr(naive, closed) * 100).toFixed(1)} % 어긋난다(> 0.5 %)`);
  }

  // ── 5 시선 기준 회전
  console.log('\n[5] 시선 기준 회전');
  {
    const rad = (d) => (d * Math.PI) / 180;
    let worst = 0, speedDrift = 0;
    for (const h of [0, 45, 90, 180, 270]) {
      const fwd = J.toWorld({ east: 0, north: 1 }, h, 'view');
      const rgt = J.toWorld({ east: 1, north: 0 }, h, 'view');
      worst = Math.max(worst, Math.abs(fwd.east - Math.sin(rad(h))), Math.abs(fwd.north - Math.cos(rad(h))), Math.abs(rgt.east - Math.cos(rad(h))), Math.abs(rgt.north + Math.sin(rad(h))));
      const w = J.toWorld({ east: 3, north: 4 }, h, 'view');
      speedDrift = Math.max(speedDrift, Math.abs(Math.hypot(w.east, w.north) - 5));
    }
    ok(worst < 1e-12, `시선 방위 0 · 45 · 90 · 180 · 270 에서 앞 = (sin h, cos h), 오른쪽 = (cos h, −sin h) (최대 오차 ${worst.toExponential(1)})`);
    ok(speedDrift < 1e-12, `회전이 속력을 바꾸지 않는다(최대 ${speedDrift.toExponential(1)} m/s)`);
    const e90 = J.toWorld({ east: 0, north: 1 }, 90, 'view'), s90 = J.toWorld({ east: 1, north: 0 }, 90, 'view');
    ok(near(e90.east, 1, 1e-12) && near(e90.north, 0, 1e-12) && near(s90.east, 0, 1e-12) && near(s90.north, -1, 1e-12), '동쪽을 보고 위로 밀면 동쪽으로, 오른쪽으로 밀면 남쪽으로 간다');
    const c = [0, 90, 213].map(h => J.toWorld({ east: 2, north: 5 }, h, 'compass'));
    ok(c.every(w => w.east === 2 && w.north === 5), '나침반 기준이면 시선과 무관하게 위가 북, 오른쪽이 동이다');
  }

  // ── 6 먼 곳은 이 조이스틱으로 가지 않는다
  console.log('\n[6] 먼 곳');
  {
    const V = { east: 0, north: MAX.fly };
    let v = { east: 0, north: 0 }, d = 0, t = 0; const dt = 1 / 60;
    while (d < 10000 && t < 300) { const r = J.stepMotion(v, V, dt); v = r.v; d += r.dNorth; t += dt; }
    ok(near(t, 10000 / 120 + TAU, 0.5), `비행 최고 속도로 10 km 를 가는 데 ${t.toFixed(2)} 초(기대 ${(10000 / 120 + TAU).toFixed(2)} ± 0.5, 계획 문서의 "약 80 초")`);
  }

  // ── 7 엉뚱한 입력
  console.log('\n[7] 엉뚱한 입력');
  {
    const v0 = { east: 3, north: 4 };
    const bad = [0, -0.5, NaN, Infinity].map(dt => J.stepMotion(v0, { east: 9, north: 9 }, dt));
    ok(bad.every(r => r.dEast === 0 && r.dNorth === 0 && r.v.east === 3 && r.v.north === 4), '프레임 간격이 0 · 음수 · NaN · 무한대면 움직이지 않고 속도도 그대로');
    const nan = J.targetVelocity({ active: true, east: NaN, north: NaN, mag: NaN }, 'car');
    const off = J.targetVelocity({ active: false, east: 1, north: 0, mag: 1 }, 'car');
    ok(nan.east === 0 && nan.north === 0 && off.east === 0 && off.north === 0, '손잡이 상태가 NaN 이거나 비활성이면 목표 속도 0');
    const r = J.stepMotion({ east: NaN, north: 2 }, { east: 1, north: 1 }, 0.1);
    ok(Number.isFinite(r.v.east) && Number.isFinite(r.dEast), '현재 속도가 NaN 으로 들어와도 결과는 유한하다');
  }

  // ── 8 속도 글
  console.log('\n[8] 속도 글');
  {
    const f = J.formatSpeed;
    ok(f(1.2) === '1.2 m/s' && f(0) === '0.0 m/s' && f(84.4) === '84 m/s' && f(9.94) === '9.9 m/s' && f(9.95) === '10 m/s' && f(120) === '120 m/s' && f(-3) === '0.0 m/s' && f(NaN) === '0.0 m/s',
       `속도 글: ${[1.2, 0, 84.4, 9.94, 9.95, 120, -3, NaN].map(x => f(x)).join(' · ')}`);
  }

  console.log(`\n${fail === 0 ? '모두 통과' : '실패 있음'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
