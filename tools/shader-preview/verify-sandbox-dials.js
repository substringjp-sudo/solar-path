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

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
