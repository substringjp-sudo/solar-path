/**
 * **연속 이동 조이스틱의 구동기와 건물 받기 막대가 맞는가** — `src/utils/joystickDriver.ts` · `src/utils/loadProgress.ts`. 브라우저 · 네트워크 불필요.
 *
 * 1단계(`joystickMotion.ts`)는 "프레임 하나"의 계산(속도 곡선 · 부드러운 가감속 · 시선 기준 회전)이었습니다. 3단계 화면은 그것을 **프레임마다 이어 붙여** 눈을 옮기고,
 * 손을 놓아 속도가 가라앉으면 위치를 **한 번만** 확정(커밋)합니다. 그 이어 붙이기(구동기)와, 멈춘 뒤 건물을 받는 동안의 진행 막대를 여기서 박습니다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20, 구현보다 먼저 박았습니다)
 *
 * 독립 기준: 시간 상수 τ = 0.3 초, 모드 최고 속도 걷기 2 · 자전거 8 · 차 25 · 비행 120 m/s(사용자 승인, 계획 문서 12.2), 위도 1° = 111,320 m 와 경도 1° = 111,320·cos φ m(`geoMove.ts` 머리글의 값).
 * 아래 숫자는 모듈의 상수가 아니라 이 기준에서 손으로 푼 값입니다. 모듈의 상수는 맨 끝 [0] 에서 이 기준과 같은지만 봅니다.
 *
 *  1. 쉬는 중: 손잡이를 안 잡았고 눈도 안 옮기는 중이면 아무것도 안 한다(눈 null, 확정 null, done null, 속도 0, 상태 그대로).
 *  2. 밀어서 출발(해석해): 걷기, 끝까지, 동쪽으로 10 초 → 간 거리 V·(t − τ·(1 − e^(−t/τ))) = 2·(10 − 0.3) = 19.4 m(상대오차 1e-6)이고 위도는 그대로(1e-6 m), 속도는 2 m/s(1e-6).
 *     밀고 있는 동안은 프레임마다 눈이 있고(moving 참) 확정은 한 번도 안 나온다.
 *  3. 프레임 간격 무관: 같은 밀기를 간격 1/120 · 1/60 · 1/30 · 1/10 초와 들쭉날쭉한 간격으로 4 초 돌려도 끝 자리가 1e-4 m 안에서 같다
 *     (걸음마다 경도를 −180~180 으로 맞추는 반올림 ≈1.2e-8 m 가 쌓이는 한계: 480 걸음 × 1.2e-8 = 6 µm). 들쭉날쭉한 간격은 모두 0.1 초 이하다 — 더 긴 프레임은 [10] 대로 0.1 초로 잘리므로 이 기준의 대상이 아니다
 *     (처음 돌릴 때 마지막 간격이 0.2 초까지 나오도록 만든 시험 자료가 이 조건을 어겨 0.17 m 어긋났고, 자료를 고쳤습니다. 기준은 그대로입니다).
 *  4. 속도 곡선이 이어졌다: 정상 상태 속력 = 모드 최고 × mag² — 걷기 mag 1 → 2, 자전거 1 → 8, 차 0.5 → 6.25, 비행 0.5 → 30 m/s(1e-6).
 *  5. 손을 놓으면 미끄러져 멈추고 **한 번만** 확정: 차 끝까지 5 초 밀고 놓는다. 확정은 정확히 한 번, 놓은 지 112 ± 1 프레임째(속도가 0.05 m/s 아래로 내려가는 때:
 *     25·e^(−k/18) < 0.05 ⇒ k > 18·ln 500 = 111.86)이고 그 전 프레임에는 없다. 확정한 자리는 마지막에 장면에 준 눈과 같다. 확정 뒤 상태는 쉬는 중이고 더는 아무것도 안 나온다.
 *     운동량 항등식: 원점에서 확정한 자리까지의 거리 = V·T − τ·(멈춘 때 속도)(1e-4 m, V = 25 m/s · T = 5 초 · 손을 놓은 프레임에서 목표가 0 이 되므로 손을 뗀 뒤 적분이 닫힌다).
 *     그래서 124.98 m 초과 125 m 미만 — "누른 시간 × 목표 속도만큼 간 자리에서 멈춘다", 남는 미끄러짐은 0.05·τ = 1.5 cm 안쪽.
 *  6. 약한 밀기: 걷기에서 데드존 바로 밖(mag 0.1 → 목표 0.02 m/s, 멈춤 기준 0.05 미만)을 3 초 쥐고 있으면 확정이 안 나오고(쥐고 있는 동안은 속도가 작아도 멈춘 게 아니다),
 *     놓는 첫 프레임에 한 번 확정된다(움직인 거리 0.0543 m ≥ 1 cm). 손잡이를 잡았지만 안 민 것(mag 0)이나 0.2 초만 약하게 민 것(움직임 0.0012 m < 1 cm)은 놓으면 확정 없이 끝난다(done = 'cancel').
 *  7. 미끄러지는 중 다시 밀기: 자전거 2 초 밀고, 0.3 초 놓았다가, 다시 2 초 밀고, 놓는다 → 확정은 맨 끝에 한 번. 프레임 사이에 눈이 뒤로 가거나 튀지 않는다(프레임당 이동 ≤ 8 m/s × dt, 동쪽 좌표 비감소).
 *     다시 민 첫 프레임의 속도는 그 앞 프레임 속도 × e^(−dt/τ) 이상(손을 뗀 곡선 밑으로 안 떨어진다 = 속도를 0 으로 되돌리지 않는다). 시작점 기록(startOrigin)은 처음 값 그대로.
 *  8. 시선을 따라 방향이 돈다: 시선 기준(view), 방위 0° 에서 앞으로 5 초 밀다가 방위가 90° 로 바뀌고 3 초 더 밀면 속도 방향이 동쪽(89.95° ~ 90.05°, 손으로 푼 값 89.9974°)이다.
 *     나침반 기준(compass)이면 방위가 바뀌어도 계속 북쪽(동 성분 1e-12 안). 방위를 모르면(null · NaN) 시선 기준을 골라도 나침반 기준으로 움직인다(북쪽).
 *  9. 모드를 바꿔도 부드럽다: 걷기로 5 초 밀다 비행으로 바꾸면 첫 프레임 속도가 2 이상, 2 + (120 − 2)(1 − e^(−dt/τ)) = 8.377 이하(튀지 않음)고 3 초 뒤에는 120·(1 − 1e-4) 이상.
 * 10. 프레임이 길게 끊겨도(탭 전환 등) 순간이동하지 않는다: 비행 끝까지 정지에서 5 초짜리 한 프레임 = 0.1 초짜리 한 프레임(눈 · 속도 1e-9)이고 그 거리는 손으로 푼 값
 *     120·(0.1 − 0.3·(1 − e^(−1/3))) = 1.7951 m(1e-3). 간격이 NaN · 음수 · 무한대면 눈은 제자리(원점에서 1e-9° 안)고 속도는 0.
 * 11. 바깥에서 위치가 바뀌면 움직임을 접는다: 이동 중에 원점(저장된 위치)이 1e-4° 달라지면 확정 없이 끝나고(done = 'cancel', 눈 null, 상태 쉬는 중), 1e-10° 달라진 것(반올림)은 무시하고 계속한다.
 *     그 뒤 다시 밀면 새 원점에서 출발한다(startOrigin = 새 원점, 첫 눈이 새 원점에서 1 m 안).
 * 12. 스크린리더 한 동작(`nudgeTo`): 거리 = 모드 최고 속도 × 5 초 — 걷기 10 · 자전거 40 · 차 125 · 비행 600 m(1e-6 m). 나침반 북쪽은 위도만, 동쪽은 경도만 바뀐다.
 *     동쪽(90°)을 보고 "앞"은 동쪽, "오른쪽"은 남쪽. 방위를 모르면(null) 시선 기준이어도 나침반 기준. 손잡이를 안 민 방향(0, 0)이면 제자리.
 * 13. 읽음 갱신 간격(`readoutDue`): 처음(null)이면 참, 99 ms 뒤 거짓, 100 ms 뒤 참, 강제면 참, 시계가 거꾸로 가거나 NaN 이면 참(멈춰 버리지 않게).
 * 14. 건물 받기 막대(`loadPercent` · `loadBar`): 5/8 → 62(내림, 시안의 "건물 62 %"), 1/3 → 33, 0/4 → 0, 받는 중에는 4/4 도 99(끝났다는 신호는 phase 가 idle 이 될 때), 7/4 → 99, 음수 → 0,
 *     전체를 모르거나 0 이면(total ≤ 0)·NaN 이면 null(퍼센트 없이 "주변 불러오는 중"만, 막대는 비율 null). idle 이면 막대 없음(null). retry 면 "건물을 못 받았어요" · "다시 시도해요", 비율 null.
 *     한국어 글이 시안과 같다: 제목 "주변 불러오는 중", 옆 글 "건물 62 %", 비율 0.62. 영어 · 일본어에도 숫자 62 가 들어 있고 서로 다르다.
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-joystick-driver.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));

const RAD = Math.PI / 180;
const TAU = 0.3;
const MAXV = { walk: 2, bike: 8, car: 25, fly: 120 };
const M_PER_DEG = 111320; // geoMove.ts 머리글: 위도 1° = 111,320 m, 경도 1° = 111,320·cos φ m
const ORIGIN = { latitude: 37.5665, longitude: 126.978 };
const OFF = { active: false, east: 0, north: 0, mag: 0 };
const PUSH = (east, north, mag = 1) => ({ active: true, east, north, mag });
const offs = (p, o = ORIGIN) => ({ east: (p.longitude - o.longitude) * M_PER_DEG * Math.cos(o.latitude * RAD), north: (p.latitude - o.latitude) * M_PER_DEG });
const dist = (p, o = ORIGIN) => { const d = offs(p, o); return Math.hypot(d.east, d.north); };
const ramp = (V, t) => V * (t - TAU * (1 - Math.exp(-t / TAU)));   // 정지에서 끝까지 민 t 초 동안 간 거리(해석해)
const inp = (stick, mode = 'walk', ref = 'compass', headingDeg = null) => ({ stick, mode, ref, headingDeg });

(async () => {
  const U = (m) => import('file://' + path.join(PREVIEW, 'app', 'utils', m));
  let D = null, L = null;
  try { D = await U('joystickDriver.js'); } catch { D = null; }
  try { L = await U('loadProgress.js'); } catch { L = null; }
  ok(!!D && typeof D.advance === 'function' && typeof D.nudgeTo === 'function' && typeof D.readoutDue === 'function' && !!D.IDLE, 'joystickDriver 가 있다');
  ok(!!L && typeof L.loadPercent === 'function' && typeof L.loadBar === 'function', 'loadProgress 가 있다');
  if (!D || typeof D.advance !== 'function' || !L || typeof L.loadPercent !== 'function') { console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); }

  /** `frames` 프레임을 돌립니다. input(i, state) 이 그 프레임의 입력, dt 는 숫자나 (i) => 숫자. */
  const sim = ({ state = D.IDLE, origin = ORIGIN, frames, dt = 1 / 60, input }) => {
    const steps = [];
    for (let i = 0; i < frames; i++) {
      const r = D.advance(state, typeof dt === 'function' ? dt(i) : dt, input(i, state), origin);
      steps.push(r);
      state = r.state;
    }
    return { steps, state };
  };
  /** done 이 나올 때까지(최대 maxFrames) 돌립니다. */
  const until = ({ state, origin = ORIGIN, dt = 1 / 60, input, maxFrames = 2000 }) => {
    const steps = [];
    for (let i = 0; i < maxFrames; i++) {
      const r = D.advance(state, dt, input(i, state), origin);
      steps.push(r);
      state = r.state;
      if (r.done) break;
    }
    return { steps, state };
  };
  const lastEye = (steps) => { for (let i = steps.length - 1; i >= 0; i--) if (steps[i].eye) return steps[i].eye; return null; };

  // ── 1 쉬는 중
  console.log('\n[1] 쉬는 중');
  {
    const r = D.advance(D.IDLE, 1 / 60, inp(OFF), ORIGIN);
    ok(r.eye === null && r.commit === null && r.done === null && r.moving === false && r.speed === 0, '손잡이를 안 잡고 눈도 안 옮기면 눈 · 확정 · done 이 없고 속도 0');
    ok(r.state.eye === null && r.state.v.east === 0 && r.state.v.north === 0 && r.state.startOrigin === null, '상태도 그대로(쉬는 중)');
    const many = sim({ frames: 200, input: () => inp(OFF) });
    ok(many.steps.every(s => s.eye === null && s.commit === null && s.done === null), '200 프레임 내내 아무것도 안 나온다');
  }

  // ── 2 밀어서 출발(해석해)
  console.log('\n[2] 밀어서 출발(해석해)');
  {
    const run = sim({ frames: 600, input: () => inp(PUSH(1, 0), 'walk') });
    const last = run.steps[599];
    const d = offs(last.eye);
    ok(rel(d.east, ramp(2, 10)) < 1e-6, `동쪽으로 ${d.east.toFixed(4)} m = 해석해 ${ramp(2, 10).toFixed(4)} m(V·(t − τ(1 − e^(−t/τ))))`);
    ok(Math.abs(d.north) < 1e-6, `위도는 그대로(북쪽 ${d.north.toExponential(1)} m)`);
    ok(near(last.speed, 2, 1e-6), `속도 ${last.speed.toFixed(7)} m/s → 2`);
    ok(run.steps.every(s => s.eye !== null && s.moving === true && s.commit === null && s.done === null), '밀고 있는 동안 프레임마다 눈이 있고 확정 · done 은 한 번도 없다');
    ok(near(run.state.startOrigin.latitude, ORIGIN.latitude, 1e-12) && near(run.state.startOrigin.longitude, ORIGIN.longitude, 1e-12), '출발한 원점이 기록된다');
  }

  // ── 3 프레임 간격 무관
  console.log('\n[3] 프레임 간격 무관');
  {
    const T = 4;
    const ends = [1 / 120, 1 / 60, 1 / 30, 1 / 10].map(dt => {
      const n = Math.round(T / dt);
      return lastEye(sim({ frames: n, dt, input: () => inp(PUSH(1, 0), 'walk') }).steps);
    });
    const ref = ends[1];
    const worst = Math.max(...ends.map(e => dist(e, ref)));
    ok(worst < 1e-4, `간격 1/120 · 1/60 · 1/30 · 1/10 초: 끝 자리 최대 차 ${worst.toExponential(2)} m`);
    ok(rel(offs(ref).east, ramp(2, T)) < 1e-6, `끝 자리 ${offs(ref).east.toFixed(5)} m = 해석해 ${ramp(2, T).toFixed(5)} m`);
    let s = 0x2468ace1; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); };
    // 간격은 모두 0.1 초 이하(그보다 긴 프레임은 [10] 대로 0.1 초로 잘리므로 이 검사의 대상이 아니다).
    const jit = []; let sum = 0; while (sum < T - 0.1) { const d = 0.004 + rnd() * 0.05; jit.push(d); sum += d; } jit.push(T - sum);
    const e = lastEye(sim({ frames: jit.length, dt: (i) => jit[i], input: () => inp(PUSH(1, 0), 'walk') }).steps);
    ok(dist(e, ref) < 1e-4, `들쭉날쭉한 간격 ${jit.length} 번도 같다(차 ${dist(e, ref).toExponential(2)} m)`);
  }

  // ── 4 속도 곡선
  console.log('\n[4] 속도 곡선');
  {
    const cases = [['walk', 1, 2], ['bike', 1, 8], ['car', 0.5, 6.25], ['fly', 0.5, 30]];
    for (const [mode, mag, want] of cases) {
      const r = sim({ frames: 60 * 8, input: () => inp(PUSH(0, 1, mag), mode) }).steps.at(-1);
      ok(near(r.speed, want, 1e-6), `${mode} mag ${mag}: 속력 ${r.speed.toFixed(6)} m/s → ${want}`);
    }
  }

  // ── 5 손을 놓으면 미끄러져 멈추고 한 번만 확정
  console.log('\n[5] 손을 놓으면 미끄러져 멈추고 한 번만 확정');
  {
    const hold = sim({ frames: 300, input: () => inp(PUSH(1, 0), 'car') });
    const rest = until({ state: hold.state, input: () => inp(OFF, 'car') });
    const commits = rest.steps.filter(s => s.commit);
    const k = rest.steps.findIndex(s => s.done === 'commit') + 1;
    ok(commits.length === 1 && rest.steps.filter(s => s.done).length === 1, `확정은 정확히 한 번(${commits.length}) 나오고 done 도 한 번`);
    ok(Math.abs(k - 112) <= 1, `놓은 지 ${k} 프레임째에 확정(기대 112 ± 1, 속도가 0.05 m/s 아래로 내려가는 때)`);
    ok(rest.steps.slice(0, k - 1).every(s => s.commit === null && s.moving === true && s.eye !== null), '그 전 프레임에는 확정이 없고 계속 움직이는 중');
    const fin = rest.steps[k - 1];
    ok(fin.commit && fin.eye && fin.commit.latitude === fin.eye.latitude && fin.commit.longitude === fin.eye.longitude, '확정한 자리 = 그 프레임에 장면에 준 눈');
    const prevEye = rest.steps[k - 2].eye;
    ok(dist(fin.eye, prevEye) < 25 / 60 + 1e-9, '마지막 프레임도 튀지 않는다(이동 ≤ 25 m/s × dt)');
    ok(fin.moving === false && rest.state.eye === null && rest.state.startOrigin === null && rest.state.v.east === 0 && rest.state.v.north === 0, '확정 뒤 상태는 쉬는 중');
    const after = sim({ state: rest.state, frames: 120, input: () => inp(OFF, 'car') });
    ok(after.steps.every(s => s.eye === null && s.commit === null && s.done === null), '확정 뒤에는 더 아무것도 안 나온다(두 번째 확정 없음)');
    const d = dist(fin.commit);
    ok(near(d, 25 * 5 - TAU * fin.speed, 1e-4), `운동량 항등식: 간 거리 ${d.toFixed(5)} m = V·T − τ·(멈춘 때 속도 ${fin.speed.toFixed(5)}) = ${(125 - TAU * fin.speed).toFixed(5)} m`);
    ok(d > 124.98 && d < 125, `누른 시간 × 목표 속도 = 125 m 에서 남은 미끄러짐 ${(125 - d).toFixed(4)} m(< 1.5 cm)만큼 못 미친 자리`);
  }

  // ── 6 약한 밀기
  console.log('\n[6] 약한 밀기');
  {
    const hold = sim({ frames: 180, input: () => inp(PUSH(1, 0, 0.1), 'walk') });
    ok(hold.steps.every(s => s.commit === null && s.done === null && s.moving === true), '목표 0.02 m/s(멈춤 기준 0.05 미만)로 3 초 쥐어도 확정이 안 나온다');
    const rest = until({ state: hold.state, input: () => inp(OFF, 'walk') });
    ok(rest.steps.length === 1 && rest.steps[0].done === 'commit' && rest.steps[0].commit !== null, '놓는 첫 프레임에 한 번 확정된다');
    const d = dist(rest.steps[0].commit);
    ok(d >= 0.01 && near(d, 0.06 - TAU * rest.steps[0].speed, 1e-5), `움직인 거리 ${d.toFixed(4)} m(≥ 1 cm, 항등식 V·T − τ·v = ${(0.06 - TAU * rest.steps[0].speed).toFixed(4)})`);
    const zero = sim({ frames: 60, input: () => inp(PUSH(0, 0, 0), 'walk') });
    const zr = until({ state: zero.state, input: () => inp(OFF, 'walk') });
    ok(zero.steps.every(s => s.commit === null && s.eye !== null) && zr.steps.at(-1).done === 'cancel' && zr.steps.every(s => s.commit === null), '손잡이를 잡았지만 안 밀면(mag 0) 놓아도 확정 없이 끝난다(cancel)');
    const brief = sim({ frames: 12, input: () => inp(PUSH(1, 0, 0.1), 'walk') });
    const br = until({ state: brief.state, input: () => inp(OFF, 'walk') });
    ok(br.steps.at(-1).done === 'cancel' && br.steps.every(s => s.commit === null), `0.2 초만 약하게 민 것(밀고 있던 동안 움직임 ${dist(lastEye(brief.steps)).toFixed(4)} m < 1 cm)은 확정 없이 끝난다`);
    ok(br.steps.at(-1).eye === null, '확정 없이 끝나는 프레임에는 눈을 새로 주지 않는다(호스트가 눈을 거둔다)');
  }

  // ── 7 미끄러지는 중 다시 밀기
  console.log('\n[7] 미끄러지는 중 다시 밀기');
  {
    const a = sim({ frames: 120, input: () => inp(PUSH(1, 0), 'bike') });
    const b = sim({ state: a.state, frames: 18, input: () => inp(OFF, 'bike') });
    const c = sim({ state: b.state, frames: 120, input: () => inp(PUSH(1, 0), 'bike') });
    const d = until({ state: c.state, input: () => inp(OFF, 'bike') });
    const all = [...a.steps, ...b.steps, ...c.steps, ...d.steps];
    ok(all.filter(s => s.commit).length === 1 && all.at(-1).done === 'commit' && all.slice(0, -1).every(s => !s.done), '확정은 맨 끝에 한 번만');
    let maxJump = 0, back = 0, prev = null;
    for (const s of all) { if (s.eye) { if (prev) { maxJump = Math.max(maxJump, dist(s.eye, prev)); back = Math.min(back, offs(s.eye).east - offs(prev).east); } prev = s.eye; } }
    ok(maxJump <= 8 / 60 + 1e-9, `프레임 사이 최대 이동 ${maxJump.toFixed(5)} m ≤ 8 m/s × 1/60`);
    ok(back >= -1e-6, '동쪽 좌표가 줄어든 적이 없다(되돌아가지 않는다)');
    const before = b.steps.at(-1).speed, first = c.steps[0].speed;
    ok(first >= before * Math.exp(-1 / 60 / TAU) - 1e-9, `다시 민 첫 프레임 속도 ${first.toFixed(4)} ≥ 앞 속도 ${before.toFixed(4)} × e^(−dt/τ) = ${(before * Math.exp(-1 / 60 / TAU)).toFixed(4)}`);
    ok(near(c.state.startOrigin.latitude, ORIGIN.latitude, 1e-12) && near(c.state.startOrigin.longitude, ORIGIN.longitude, 1e-12), '시작점 기록은 처음 값 그대로(다시 밀어도 갈아 끼우지 않는다)');
  }

  // ── 8 시선을 따라 방향이 돈다
  console.log('\n[8] 시선을 따라 방향이 돈다');
  {
    const ang = (v) => (Math.atan2(v.east, v.north) / RAD + 360) % 360;
    const one = (ref, h2) => {
      const a = sim({ frames: 300, input: () => inp(PUSH(0, 1), 'walk', ref, 0) });
      return sim({ state: a.state, frames: 180, input: () => inp(PUSH(0, 1), 'walk', ref, h2) });
    };
    const view = one('view', 90);
    const A = ang(view.state.v);
    ok(A > 89.95 && A < 90.05, `시선 기준: 방위가 0° → 90° 로 바뀌고 3 초 뒤 속도 방향 ${A.toFixed(4)}°(손으로 푼 값 89.9974°)`);
    const comp = one('compass', 90);
    ok(Math.abs(comp.state.v.east) < 1e-12 && comp.state.v.north > 1.99, `나침반 기준: 방위가 바뀌어도 계속 북쪽(동 성분 ${comp.state.v.east.toExponential(1)})`);
    const nul = sim({ frames: 300, input: () => inp(PUSH(0, 1), 'walk', 'view', null) });
    const nan = sim({ frames: 300, input: () => inp(PUSH(0, 1), 'walk', 'view', NaN) });
    ok(Math.abs(nul.state.v.east) < 1e-12 && nul.state.v.north > 1.99 && Math.abs(nan.state.v.east) < 1e-12 && nan.state.v.north > 1.99, '방위를 모르면(null · NaN) 시선 기준을 골라도 북쪽으로 간다');
  }

  // ── 9 모드를 바꿔도 부드럽다
  console.log('\n[9] 모드를 바꿔도 부드럽다');
  {
    const a = sim({ frames: 300, input: () => inp(PUSH(0, 1), 'walk') });
    const v0 = a.steps.at(-1).speed;
    const b = sim({ state: a.state, frames: 180, input: () => inp(PUSH(0, 1), 'fly') });
    const first = b.steps[0].speed, bound = v0 + (120 - v0) * (1 - Math.exp(-1 / 60 / TAU));
    ok(first >= v0 - 1e-9 && first <= bound + 1e-9, `비행으로 바꾼 첫 프레임 속도 ${first.toFixed(4)} ∈ [${v0.toFixed(4)}, ${bound.toFixed(4)}](튀지 않는다)`);
    ok(b.steps.at(-1).speed >= 120 * (1 - 1e-4), `3 초 뒤 ${b.steps.at(-1).speed.toFixed(3)} m/s ≥ 119.988`);
  }

  // ── 10 프레임이 길게 끊겨도
  console.log('\n[10] 프레임이 길게 끊겨도');
  {
    const long = D.advance(D.IDLE, 5, inp(PUSH(0, 1), 'fly'), ORIGIN);
    const short = D.advance(D.IDLE, 0.1, inp(PUSH(0, 1), 'fly'), ORIGIN);
    ok(dist(long.eye, short.eye) < 1e-9 && near(long.speed, short.speed, 1e-9), '5 초짜리 한 프레임 = 0.1 초짜리 한 프레임(눈 · 속도)');
    const want = 120 * (0.1 - 0.3 * (1 - Math.exp(-1 / 3)));
    ok(near(dist(long.eye), want, 1e-3) && near(want, 1.7951, 1e-4), `그 거리 ${dist(long.eye).toFixed(4)} m = 손으로 푼 값 1.7951 m`);
    const bad = [NaN, -1, 0, Infinity].map(dt => D.advance(D.IDLE, dt, inp(PUSH(0, 1), 'fly'), ORIGIN));
    ok(bad.every(r => dist(r.eye) < 1e-6 && Math.abs(r.eye.latitude - ORIGIN.latitude) < 1e-9 && Math.abs(r.eye.longitude - ORIGIN.longitude) < 1e-9 && r.speed === 0 && r.moving === true),
       '간격이 NaN · 음수 · 0 · 무한대면 눈은 제자리고 속도는 0(손잡이는 잡고 있는 중)');
  }

  // ── 11 바깥에서 위치가 바뀌면
  console.log('\n[11] 바깥에서 위치가 바뀌면');
  {
    const a = sim({ frames: 60, input: () => inp(PUSH(1, 0), 'car') });
    const moved = { latitude: ORIGIN.latitude + 1e-4, longitude: ORIGIN.longitude };
    const r = D.advance(a.state, 1 / 60, inp(PUSH(1, 0), 'car'), moved);
    ok(r.done === 'cancel' && r.commit === null && r.eye === null && r.moving === false, '이동 중에 원점이 1e-4° 달라지면 확정 없이 접는다(cancel, 눈 null)');
    ok(r.state.eye === null && r.state.startOrigin === null && r.state.v.east === 0 && r.state.v.north === 0, '상태는 쉬는 중으로 돌아간다');
    const tiny = { latitude: ORIGIN.latitude + 1e-10, longitude: ORIGIN.longitude - 1e-10 };
    const t = D.advance(a.state, 1 / 60, inp(PUSH(1, 0), 'car'), tiny);
    ok(t.done === null && t.eye !== null && t.moving === true, '1e-10° 달라진 것(반올림)은 무시하고 계속한다');
    const n = D.advance(r.state, 1 / 60, inp(PUSH(1, 0), 'car'), moved);
    ok(n.eye !== null && near(n.state.startOrigin.latitude, moved.latitude, 1e-12) && dist(n.eye, moved) < 1, '그 뒤 다시 밀면 새 원점에서 출발한다');
  }

  // ── 12 스크린리더 한 동작
  console.log('\n[12] 스크린리더 한 동작');
  {
    const NORTH = { east: 0, north: 1 }, EAST = { east: 1, north: 0 };
    let worst = 0;
    for (const [mode, d] of [['walk', 10], ['bike', 40], ['car', 125], ['fly', 600]]) {
      const p = D.nudgeTo(ORIGIN, NORTH, mode, 'compass', null);
      const q = offs(p);
      worst = Math.max(worst, Math.abs(q.north - d), Math.abs(q.east));
      const e = offs(D.nudgeTo(ORIGIN, EAST, mode, 'compass', null));
      worst = Math.max(worst, Math.abs(e.east - d), Math.abs(e.north));
    }
    ok(worst < 1e-6, `걷기 10 · 자전거 40 · 차 125 · 비행 600 m, 북쪽은 위도만 · 동쪽은 경도만(최대 오차 ${worst.toExponential(1)} m)`);
    const fwd = offs(D.nudgeTo(ORIGIN, NORTH, 'bike', 'view', 90)), rgt = offs(D.nudgeTo(ORIGIN, EAST, 'bike', 'view', 90));
    ok(near(fwd.east, 40, 1e-6) && Math.abs(fwd.north) < 1e-6, '동쪽(90°)을 보고 "앞"으로 → 동쪽 40 m');
    ok(near(rgt.north, -40, 1e-6) && Math.abs(rgt.east) < 1e-6, '동쪽(90°)을 보고 "오른쪽"으로 → 남쪽 40 m');
    const unk = offs(D.nudgeTo(ORIGIN, NORTH, 'bike', 'view', null));
    ok(near(unk.north, 40, 1e-6) && Math.abs(unk.east) < 1e-6, '방위를 모르면 시선 기준이어도 북쪽');
    const none = D.nudgeTo(ORIGIN, { east: 0, north: 0 }, 'car', 'compass', null);
    ok(dist(none) < 1e-9, '손잡이를 안 민 방향(0, 0)이면 제자리');
  }

  // ── 13 읽음 갱신 간격
  console.log('\n[13] 읽음 갱신 간격');
  {
    ok(D.readoutDue(null, 1000, false) === true, '처음(null)이면 참');
    ok(D.readoutDue(1000, 1099, false) === false && D.readoutDue(1000, 1100, false) === true, '99 ms 뒤 거짓, 100 ms 뒤 참');
    ok(D.readoutDue(1000, 1001, true) === true, '강제면 참');
    ok(D.readoutDue(1000, 900, false) === true && D.readoutDue(1000, NaN, false) === true, '시계가 거꾸로 가거나 NaN 이면 참(멈춰 버리지 않게)');
  }

  // ── 14 건물 받기 막대
  console.log('\n[14] 건물 받기 막대');
  {
    const P = (done, total, phase = 'loading') => ({ phase, done, total });
    ok(L.loadPercent(P(5, 8)) === 62 && L.loadPercent(P(1, 3)) === 33 && L.loadPercent(P(0, 4)) === 0, '5/8 → 62(내림), 1/3 → 33, 0/4 → 0');
    ok(L.loadPercent(P(4, 4)) === 99 && L.loadPercent(P(7, 4)) === 99 && L.loadPercent(P(-2, 4)) === 0, '받는 중에는 4/4 · 7/4 도 99, 음수는 0');
    ok(L.loadPercent(P(1, 0)) === null && L.loadPercent(P(NaN, 4)) === null && L.loadPercent(P(1, NaN)) === null && L.loadPercent(P(0, -3)) === null, '전체를 모르거나(0 · 음수 · NaN) 값이 NaN 이면 null');
    ok(L.loadPercent(P(3, 4, 'idle')) === null && L.loadPercent(P(3, 4, 'retry')) === null && L.loadPercent(null) === null, 'idle · retry · null 은 퍼센트 없음');
    const ko = L.loadBar(P(5, 8), 'ko');
    ok(ko && ko.title === '주변 불러오는 중' && ko.detail === '건물 62 %' && near(ko.fraction, 0.62, 1e-12) && ko.tone === 'loading', `한국어: "${ko && ko.title}" · "${ko && ko.detail}" · 비율 ${ko && ko.fraction}`);
    const ind = L.loadBar(P(0, 0), 'ko');
    ok(ind && ind.title === '주변 불러오는 중' && ind.detail === null && ind.fraction === null, '전체를 모르면 제목만(막대는 비율 없음)');
    const rt = L.loadBar(P(0, 0, 'retry'), 'ko');
    ok(rt && rt.title === '건물을 못 받았어요' && rt.detail === '다시 시도해요' && rt.fraction === null && rt.tone === 'retry', '실패하면 "건물을 못 받았어요" · "다시 시도해요"');
    ok(L.loadBar(P(3, 4, 'idle'), 'ko') === null && L.loadBar(null, 'ko') === null && L.loadBar(undefined, 'ko') === null, 'idle · null 이면 막대 없음');
    const en = L.loadBar(P(5, 8), 'en'), ja = L.loadBar(P(5, 8), 'ja');
    ok(en && ja && `${en.title}${en.detail}`.includes('62') && `${ja.title}${ja.detail}`.includes('62') && en.title !== ja.title && en.title !== ko.title && ja.title !== ko.title, '영어 · 일본어에도 62 가 들어 있고 서로 다르다');
  }

  // ── 0 상수
  console.log('\n[0] 상수가 기준과 같다');
  {
    ok(D.STOP_SPEED_MPS === 0.05 && D.MAX_FRAME_S === 0.1 && D.NUDGE_S === 5 && D.READOUT_MS === 100 && D.COMMIT_MIN_M === 0.01, `멈춤 ${D.STOP_SPEED_MPS} m/s · 프레임 상한 ${D.MAX_FRAME_S} 초 · 한 동작 ${D.NUDGE_S} 초 · 읽음 ${D.READOUT_MS} ms · 확정 최소 ${D.COMMIT_MIN_M} m`);
  }

  console.log(`\n${fail ? '실패 있음' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  // 구현이 틀려서 검사 도중 예외가 나도(널 눈을 읽는 등) 실패로 세고 요약을 남깁니다.
  fail++;
  console.log('  FAIL: 예외 — ' + (e && e.message));
  console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`);
  process.exit(1);
});
