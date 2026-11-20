/**
 * **샌드박스 세로 막대와 조이스틱의 계산(`sandboxDials.ts`)이 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * 막대가 엉뚱한 값을 장면에 넘기면 눈 높이·줌이 손가락과 따로 놀고, 조이스틱 방향이 틀리면 북쪽으로 밀었는데 다른 데로 갑니다.
 * 기준값은 코드의 식을 되풀이하지 않고 **손으로 푼 값**(기하 평균, 나침반 방위의 사인·코사인, 반올림 경계)과 앱의 **소스에 적힌 값**입니다.
 *
 * 먼저 정한 줄(돌려 보기 전):
 *  1. 로그 눈금: 최솟값 → 0, 최댓값 → 1(정확). 왕복(값 → t → 값, t → 값 → t)이 1e-9 안. 기하 평균 √(min·max) 가 t = 0.5(눈 높이 21.909 m, 줌 4.472×).
 *     범위 밖은 자른다. 값이 커질수록 t 가 커진다(단조).
 *  2. 눈금 붙이기: 눈금에서 t 로 0.03 벗어난 값은 그 눈금 값으로, 0.04 벗어난 값은 그대로(경계 3.5 %). 눈금 사이 한가운데(줌 2 와 5 사이 √10)는 안 붙는다.
 *  3. 반올림: 눈 높이 1.64→1.6 · 9.96→10 · 31.4→31 · 99.6→100 · 103→105 · 297.4→295, 줌 1.04→1 · 7.26→7.3 · 12.3→12.5 · 19.8→20. 글 "1.6 m" · "10 m" · "300 m" · "20×" · "7.3×" · "1×".
 *  4. 세로: 막대 위(y=0)가 t=1, 아래가 0, 가운데가 0.5, 범위 밖은 자름. yFromT 는 tFromY 의 거꾸로.
 *  5. 조이스틱(손잡이 이동 반지름 30): 8 나침반 방위(0° 북 … 315°)로 민 방향이 east = sin θ, north = cos θ 와 1e-12 안. 데드존: 반지름의 0.267 은 안 움직임, 0.3 은 움직임.
 *     밀린 정도: 끝까지 1, 데드존 경계 0, 반지름의 2 배는 1. 간격 mag 0 → 450 ms, 1 → 120 ms, 0.5 → 285 ms. 손잡이 자르기: 안은 그대로, 밖은 같은 방향으로 반지름.
 *     한 걸음 이동량의 크기가 걸음 크기와 같다(100 m 걸음, 45° → 70.7 m 씩). 반지름 0 · NaN 은 안 움직임.
 *  5b. 스크린리더 한 눈금: stepToTick(눈 높이 10, 위) = 30, 아래 = 1.6, 사이 값 12 는 위 30 · 아래 10, 끝에서는 그대로(1.6 아래 → 1.6, 300 위 → 300), 줌 7.3 은 위 10 · 아래 5.
 *  6. 앱 소스와 맞춤: `ZOOM_RANGE.max` = `SkyScene3D.TELE_MAX`, 눈 높이 눈금 = `SandboxPanel.EYE_HEIGHT_CHOICES_M`(처음과 끝은 범위), 줌 눈금 = 예전 망원 단추 1 · 2 · 5 · 10 · 20.
 *  7. 시선 읽음 줄(2026-11-20): `fmtAz` 는 0 이상 360 미만 한 자리 — 128.44 → "128.4", 128.46 → "128.5", 359.94 → "359.9", 359.96 · 360 · −0.04 → "0.0", −10 → "350.0", 725 → "5.0", NaN → "—".
 *     `fmtEl` 은 한 자리, 음수만 부호 — 6.94 → "6.9", −3.24 → "-3.2", −0.04 → "0.0"(-0.0 아님), 90 → "90.0", NaN → "—".
 *     `viewDiffers`: 이전이 없으면(null) 새 값이 있어야 다름, 둘 다 null 이면 같음, 새 값이 null 이고 이전이 있으면 다름. 방위는 한 바퀴를 돌아 잰다 — 359.99 와 0.01 은 0.02° 차라 같음(0.05° 기준),
 *     0.04° 차는 같고 0.06° 차는 다름. 앙각 0.04 차는 같고 0.06 차는 다름.
 *  8. 시선 기준 이동 `rotateByView`(손잡이 위 = 보는 방향, 오른쪽 = 시선의 오른쪽; 손으로 푼 값): 북(0°)을 보면 위 → (동 0, 북 1) · 오른쪽 → (1, 0), 동(90°)을 보면 위 → (1, 0) · 오른쪽 → (0, −1),
 *     남(180°)을 보면 위 → (0, −1) · 오른쪽 → (−1, 0), 서(270°)를 보면 위 → (−1, 0) · 오른쪽 → (0, 1), 북동(45°)을 보면 위 → (√½, √½) · 오른쪽 → (√½, −√½). 모두 1e-12 안.
 *     길이는 그대로(임의의 각 1000 개에서 |결과| = |입력| 가 1e-9 안). 360° 를 더해도 같다. 손잡이를 8 방향으로 민 걸음(`stepMove`)을 시선 기준으로 돌려도 걸음 크기가 걸음 크기와 같다.
 *  9. 앱 연결(소스 정규식): (a) `SandboxPanel` 이 `getView` 를 읽음 줄(`ViewReadout`)에 넘기고 (b) 시선 기준일 때만 `rotateByView(…, 시선 방위)` 로 돌려 `onMove` 에 넘기며 시선이 없으면(null) 그대로 넘긴다
 *     (c) 시선 기준 토글의 초기값은 꺼짐(북 기준, 예전 동작) (d) `SkyScreen` 이 장면의 `getRenderState()` 의 `view` 를 `getView` 로 넘긴다 (e) 시선 기준에서는 조이스틱 글이 앞 · 오른쪽 · 뒤 · 왼쪽으로 바뀐다.
 *     (e) 의 첫 정규식은 코드가 `relative ? L3(…)` 모양이라고 잘못 짐작해 실제 모양(`relative ? [ {…} ] : [ {…} ]` 배열 둘)에 맞게 고쳤습니다. 기준(시선 기준일 때만 글이 바뀌고, 아닐 때는 북 · 동 · 남 · 서)은 그대로입니다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-sandbox-dials.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW, REPO_ROOT } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, e) => Math.abs(a - b) <= e;
const RAD = Math.PI / 180;

(async () => {
  const D = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'sandboxDials.js'));
  const E = D.EYE_RANGE, Z = D.ZOOM_RANGE;

  console.log('\n[1] 로그 눈금');
  {
    ok(D.valueToT(E.min, E) === 0 && D.valueToT(E.max, E) === 1 && D.valueToT(Z.min, Z) === 0 && D.valueToT(Z.max, Z) === 1, '최솟값 → 0, 최댓값 → 1');
    ok(D.tToValue(0, E) === E.min && near(D.tToValue(1, E), E.max, 1e-9) && D.tToValue(0, Z) === Z.min && near(D.tToValue(1, Z), Z.max, 1e-9), 't=0 → 최솟값, t=1 → 최댓값');
    let worst = 0;
    for (const v of [1.6, 5, 10, 31, 100, 250, 300]) worst = Math.max(worst, Math.abs(D.tToValue(D.valueToT(v, E), E) - v));
    for (const t of [0, 0.1, 0.37, 0.5, 0.88, 1]) worst = Math.max(worst, Math.abs(D.valueToT(D.tToValue(t, Z), Z) - t));
    ok(worst < 1e-9, `왕복 최대 차 ${worst.toExponential(2)}`);
    const gmE = Math.sqrt(1.6 * 300), gmZ = Math.sqrt(20);
    ok(near(gmE, 21.909, 0.001) && near(D.valueToT(gmE, E), 0.5, 1e-12) && near(D.valueToT(gmZ, Z), 0.5, 1e-12) && near(D.tToValue(0.5, Z), 4.472, 0.001), `기하 평균 ${gmE.toFixed(3)} m · ${gmZ.toFixed(3)}× 가 t = 0.5`);
    ok(D.valueToT(0.5, E) === 0 && D.valueToT(1000, E) === 1 && D.tToValue(-1, E) === E.min && near(D.tToValue(2, E), E.max, 1e-9), '범위 밖은 자른다');
    let mono = true;
    for (let i = 1; i <= 100; i++) if (!(D.valueToT(E.min + i, E) >= D.valueToT(E.min + i - 1, E))) mono = false;
    ok(mono, '값이 커질수록 t 가 커진다(단조)');
  }

  console.log('\n[2] 눈금 붙이기');
  {
    const cases = [['눈 높이', E, D.EYE_TICKS], ['줌', Z, D.ZOOM_TICKS]];
    for (const [name, R, ticks] of cases) {
      let inOk = 0, outOk = 0, n = 0;
      for (const k of ticks) {
        const t = D.valueToT(k, R);
        const sgn = t > 0.5 ? -1 : 1;
        const vin = D.tToValue(t + sgn * 0.03, R), vout = D.tToValue(t + sgn * 0.04, R);
        n++;
        if (D.snapValue(vin, R, ticks) === k) inOk++;
        if (D.snapValue(vout, R, ticks) === vout) outOk++;
      }
      ok(inOk === n && outOk === n, `${name}: 눈금 ${n} 개 모두 0.03 안은 붙고(${inOk}) 0.04 밖은 그대로(${outOk})`);
    }
    const mid = Math.sqrt(2 * 5);
    ok(D.snapValue(mid, Z, D.ZOOM_TICKS) === mid, `줌 2 와 5 사이 ${mid.toFixed(2)}× 는 안 붙는다`);
    ok(D.snapValue(1.6, E, D.EYE_TICKS) === 1.6 && D.snapValue(300, E, D.EYE_TICKS) === 300, '눈금 값 자체는 그대로');
  }

  console.log('\n[3] 반올림과 글');
  {
    const eye = [[1.64, 1.6], [9.96, 10], [31.4, 31], [99.6, 100], [103, 105], [297.4, 295], [300, 300]];
    ok(eye.every(([v, w]) => D.roundEye(v) === w), `눈 높이 반올림: ${eye.map(([v]) => `${v}→${D.roundEye(v)}`).join(' ')}`);
    const zm = [[1.04, 1], [7.26, 7.3], [12.3, 12.5], [19.8, 20]];
    ok(zm.every(([v, w]) => D.roundZoom(v) === w), `줌 반올림: ${zm.map(([v]) => `${v}→${D.roundZoom(v)}`).join(' ')}`);
    ok(D.fmtEye(1.6) === '1.6 m' && D.fmtEye(10) === '10 m' && D.fmtEye(31) === '31 m' && D.fmtEye(300) === '300 m', '눈 높이 글');
    ok(D.fmtZoom(20) === '20×' && D.fmtZoom(7.3) === '7.3×' && D.fmtZoom(1) === '1×', '줌 글');
  }

  console.log('\n[4] 세로 좌표');
  {
    ok(D.tFromY(0, 150) === 1 && D.tFromY(150, 150) === 0 && D.tFromY(75, 150) === 0.5 && D.tFromY(-10, 150) === 1 && D.tFromY(200, 150) === 0, '위 1 · 아래 0 · 가운데 0.5 · 범위 밖은 자름');
    let w = 0; for (const t of [0, 0.2, 0.5, 0.9, 1]) w = Math.max(w, Math.abs(D.tFromY(D.yFromT(t, 150), 150) - t));
    ok(w < 1e-12, `yFromT 는 tFromY 의 거꾸로(최대 차 ${w.toExponential(1)})`);
  }

  console.log('\n[5] 조이스틱');
  {
    const R = 30;
    let worst = 0;
    for (let b = 0; b < 360; b += 45) {
      const dx = Math.sin(b * RAD) * 25, dy = -Math.cos(b * RAD) * 25;
      const s = D.stickState(dx, dy, R);
      worst = Math.max(worst, Math.abs(s.east - Math.sin(b * RAD)), Math.abs(s.north - Math.cos(b * RAD)));
      if (!s.active) worst = 99;
    }
    ok(worst < 1e-12, `8 방위로 민 방향이 east = sin · north = cos 와 같다(최대 차 ${worst.toExponential(1)})`);
    ok(!D.stickState(8, 0, R).active && D.stickState(9, 0, R).active, `데드존: 0.267 은 안 움직이고(${D.stickState(8, 0, R).active}) 0.3 은 움직인다(${D.stickState(9, 0, R).active})`);
    ok(near(D.stickState(R, 0, R).mag, 1, 1e-12) && near(D.stickState(R * 2, 0, R).mag, 1, 1e-12) && D.stickState(R * D.STICK_DEADZONE + 1e-9, 0, R).mag < 1e-6, '밀린 정도: 끝 1 · 반지름의 2 배도 1 · 데드존 경계 0');
    ok(D.stickIntervalMs(0) === 450 && D.stickIntervalMs(1) === 120 && D.stickIntervalMs(0.5) === 285 && D.stickIntervalMs(5) === 120 && D.stickIntervalMs(-1) === 450, '간격 450 · 120 · 285 ms, 범위 밖은 자름');
    const c = D.clampKnob(15, 0, R), o = D.clampKnob(60, 80, R);
    ok(c.x === 15 && c.y === 0 && near(Math.hypot(o.x, o.y), R, 1e-9) && near(o.x / o.y, 60 / 80, 1e-12), `손잡이 자르기: 안 ${c.x},${c.y} · 밖 반지름 ${Math.hypot(o.x, o.y).toFixed(3)} (방향 그대로)`);
    const d45 = D.stepMove(D.stickState(Math.sin(45 * RAD) * 25, -Math.cos(45 * RAD) * 25, R), 100);
    ok(near(d45.eastM, 70.711, 0.001) && near(d45.northM, 70.711, 0.001) && near(Math.hypot(d45.eastM, d45.northM), 100, 1e-9), `100 m 걸음, 북동 → ${d45.eastM.toFixed(1)} m 동, ${d45.northM.toFixed(1)} m 북 (크기 100)`);
    const none = D.stepMove(D.stickState(0, 0, R), 100);
    ok(none.eastM === 0 && none.northM === 0 && !D.stickState(5, 5, 0).active && !D.stickState(NaN, 3, R).active, '가운데 · 반지름 0 · NaN 은 안 움직인다');
  }

  console.log('\n[5b] 스크린리더 한 눈금');
  {
    const e = D.EYE_TICKS, z = D.ZOOM_TICKS;
    ok(D.stepToTick(10, e, 1) === 30 && D.stepToTick(10, e, -1) === 1.6 && D.stepToTick(12, e, 1) === 30 && D.stepToTick(12, e, -1) === 10, `눈 높이 10 → 위 ${D.stepToTick(10, e, 1)} · 아래 ${D.stepToTick(10, e, -1)}, 12 → 위 ${D.stepToTick(12, e, 1)} · 아래 ${D.stepToTick(12, e, -1)}`);
    ok(D.stepToTick(1.6, e, -1) === 1.6 && D.stepToTick(300, e, 1) === 300 && D.stepToTick(1, z, -1) === 1 && D.stepToTick(20, z, 1) === 20, '끝에서는 그대로');
    ok(D.stepToTick(7.3, z, 1) === 10 && D.stepToTick(7.3, z, -1) === 5, `줌 7.3 → 위 ${D.stepToTick(7.3, z, 1)} · 아래 ${D.stepToTick(7.3, z, -1)}`);
  }

  console.log('\n[6] 앱 소스와 맞춤');
  {
    const tele = /export const TELE_MAX\s*=\s*(\d+)/.exec(fs.readFileSync(path.join(REPO_ROOT, 'src', 'components', 'SkyScene3D', 'SkyScene3D.tsx'), 'utf8'));
    ok(!!tele && +tele[1] === D.ZOOM_RANGE.max, `줌 최댓값 ${D.ZOOM_RANGE.max} = 장면의 TELE_MAX ${tele && tele[1]}`);
    const eyeSrc = /EYE_HEIGHT_CHOICES_M\s*=\s*\[([^\]]*)\]/.exec(fs.readFileSync(path.join(REPO_ROOT, 'src', 'components', 'SkyScreen', 'SandboxPanel.tsx'), 'utf8'));
    const choices = eyeSrc ? eyeSrc[1].split(',').map(x => parseFloat(x)).filter(Number.isFinite) : [];
    ok(choices.join() === D.EYE_TICKS.join() && choices[0] === D.EYE_RANGE.min && choices[choices.length - 1] === D.EYE_RANGE.max, `눈 높이 눈금 ${choices.join(' · ')} = 칩 목록, 처음·끝 = 범위`);
    ok(D.ZOOM_TICKS.join() === '1,2,5,10,20' && D.ZOOM_TICKS[0] === D.ZOOM_RANGE.min && D.ZOOM_TICKS[4] === D.ZOOM_RANGE.max, '줌 눈금 1 · 2 · 5 · 10 · 20 = 예전 망원 단추, 처음·끝 = 범위');
  }

  console.log('\n[7] 시선 읽음 줄');
  {
    const az = [[128.44, '128.4'], [128.46, '128.5'], [359.94, '359.9'], [359.96, '0.0'], [360, '0.0'], [-0.04, '0.0'], [-10, '350.0'], [725, '5.0'], [0, '0.0'], [NaN, '—']];
    const bad = az.filter(([v, e]) => D.fmtAz(v) !== e).map(([v, e]) => `${v}→${D.fmtAz(v)}(기대 ${e})`);
    ok(bad.length === 0, `fmtAz ${az.length} 경우${bad.length ? ' 어긋남: ' + bad.join(', ') : ''}`);
    const el = [[6.94, '6.9'], [-3.24, '-3.2'], [-0.04, '0.0'], [90, '90.0'], [0, '0.0'], [-45, '-45.0'], [NaN, '—']];
    const bad2 = el.filter(([v, e]) => D.fmtEl(v) !== e).map(([v, e]) => `${v}→${D.fmtEl(v)}(기대 ${e})`);
    ok(bad2.length === 0, `fmtEl ${el.length} 경우${bad2.length ? ' 어긋남: ' + bad2.join(', ') : ''}`);
    const V = (az, el) => ({ az, el });
    ok(D.viewDiffers(null, V(1, 1)) === true && D.viewDiffers(null, null) === false && D.viewDiffers(V(1, 1), null) === true && D.viewDiffers(V(1, 1), V(1, 1)) === false,
       'viewDiffers: null 처리(없다가 생김 · 둘 다 없음 · 있다가 없어짐 · 같은 값)');
    ok(D.viewDiffers(V(359.99, 0), V(0.01, 0)) === false && D.viewDiffers(V(10, 0), V(10.04, 0)) === false && D.viewDiffers(V(10, 0), V(10.06, 0)) === true &&
       D.viewDiffers(V(10, 5), V(10, 5.04)) === false && D.viewDiffers(V(10, 5), V(10, 5.06)) === true && D.viewDiffers(V(0, 0), V(359.9, 0)) === true,
       'viewDiffers: 방위는 한 바퀴를 돌아 잼(359.99↔0.01 같음), 0.04° 는 같고 0.06° 는 다름(방위 · 앙각 모두)');
  }

  console.log('\n[8] 시선 기준 이동');
  {
    const s2 = Math.SQRT1_2;
    const cases = [
      [0, '위', 0, 1, 0, 1], [0, '오른쪽', 1, 0, 1, 0],
      [90, '위', 0, 1, 1, 0], [90, '오른쪽', 1, 0, 0, -1],
      [180, '위', 0, 1, 0, -1], [180, '오른쪽', 1, 0, -1, 0],
      [270, '위', 0, 1, -1, 0], [270, '오른쪽', 1, 0, 0, 1],
      [45, '위', 0, 1, s2, s2], [45, '오른쪽', 1, 0, s2, -s2],
    ];
    let worst = 0; const wrong = [];
    for (const [a, name, e, n, ee, nn] of cases) {
      const r = D.rotateByView(e, n, a);
      const d = Math.max(Math.abs(r.eastM - ee), Math.abs(r.northM - nn));
      worst = Math.max(worst, d);
      if (d > 1e-12) wrong.push(`${a}° ${name} → (${r.eastM.toFixed(3)}, ${r.northM.toFixed(3)}) 기대 (${ee.toFixed(3)}, ${nn.toFixed(3)})`);
    }
    ok(wrong.length === 0, `시선 기준: 북 · 동 · 남 · 서 · 북동을 볼 때 위 · 오른쪽 ${cases.length} 경우, 최대 차 ${worst.toExponential(2)}${wrong.length ? ' ' + wrong.join('; ') : ''}`);
    let lenWorst = 0, seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    for (let i = 0; i < 1000; i++) {
      const e = (rnd() - 0.5) * 200, n = (rnd() - 0.5) * 200, a = rnd() * 720 - 360;
      const r = D.rotateByView(e, n, a);
      lenWorst = Math.max(lenWorst, Math.abs(Math.hypot(r.eastM, r.northM) - Math.hypot(e, n)));
    }
    ok(lenWorst < 1e-9, `길이 보존: 임의 1000 개에서 최대 차 ${lenWorst.toExponential(2)}`);
    const r1 = D.rotateByView(30, -70, 33), r2 = D.rotateByView(30, -70, 393);
    ok(near(r1.eastM, r2.eastM, 1e-9) && near(r1.northM, r2.northM, 1e-9), '360° 를 더해도 같다');
    let stepWorst = 0;
    for (let k = 0; k < 8; k++) {
      const st = D.stickState(30 * Math.sin(k * 45 * RAD), -30 * Math.cos(k * 45 * RAD), 30);
      const m = D.stepMove(st, 100);
      const r = D.rotateByView(m.eastM, m.northM, 37.5 * k + 11);
      stepWorst = Math.max(stepWorst, Math.abs(Math.hypot(r.eastM, r.northM) - 100));
    }
    ok(stepWorst < 1e-9, `손잡이를 8 방향으로 민 100 m 걸음을 돌려도 걸음 크기 100 m (최대 차 ${stepWorst.toExponential(2)})`);
  }

  console.log('\n[9] 앱 연결 (소스)');
  {
    const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, 'src', ...p), 'utf8');
    const panel = read('components', 'SkyScreen', 'SandboxPanel.tsx');
    const dials = read('components', 'SkyScreen', 'SandboxDials.tsx');
    const sky = read('components', 'SkyScreen', 'SkyScreen.tsx');
    ok(/<ViewReadout[^>]*getView=\{getView\}/.test(panel) && /getView\?: \(\) => ViewAzEl \| null;/.test(panel), '(a) SandboxPanel 이 getView 를 읽음 줄 ViewReadout 에 넘긴다');
    const mv = (panel.match(/const move = \([^)]*\) => \{[\s\S]*?\n  \};/) || [''])[0];
    ok(/const v = rel \? getView\?\.\(\) : null;/.test(mv) && /v \? rotateByView\(eastM, northM, v\.az\) : \{ eastM, northM \}/.test(mv) && /onMove\(m\.eastM, m\.northM\)/.test(mv),
       '(b) 시선 기준일 때만 rotateByView(…, 시선 방위)로 돌려 onMove 에 넘기고, 시선이 없으면 그대로');
    ok(/const \[rel, setRel\] = React\.useState\(false\);/.test(panel), '(c) 시선 기준 토글의 처음 값은 꺼짐(북 기준, 예전 동작)');
    ok(/getView=\{\(\) => sceneRef\.current\?\.getRenderState\?\.\(\)\?\.view \?\? null\}/.test(sky), '(d) SkyScreen 이 장면의 getRenderState().view 를 getView 로 넘긴다');
    const dirsSrc = (dials.match(/const dirs: [^=]*= relative \? \[([\s\S]*?)\] : \[([\s\S]*?)\];/) || ['', '', '']);
    const relBlock = dirsSrc[1], northBlock = dirsSrc[2];
    ok(/relative\?: boolean;/.test(dials) && ['앞으로', '오른쪽으로', '뒤로', '왼쪽으로'].every(w => relBlock.includes(w)) && !/북쪽으로|동쪽으로|남쪽으로|서쪽으로/.test(relBlock) &&
       ['북쪽으로', '동쪽으로', '남쪽으로', '서쪽으로'].every(w => northBlock.includes(w)) && /<MoveStick[^>]*relative=\{rel\}/.test(panel),
       '(e) 시선 기준에서는 조이스틱 글이 앞 · 오른쪽 · 뒤 · 왼쪽으로, 아닐 때는 북 · 동 · 남 · 서');
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
