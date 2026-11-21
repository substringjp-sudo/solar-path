/**
 * **타임랩스 "예측 노출 곡선"(`src/utils/exposureCurve.ts`)이 맞는가** — 순수 계산 판정. 브라우저 · 네트워크 불필요.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 해 고도(°)에서 맑은 하늘의 바깥 밝기(lux)를 어림하고, 시작 장면 대비 몇 **단(stop)** 어두워지거나 밝아지는지를 곡선으로 그립니다.
 * 밝기 기준표(널리 인용되는 어림값, 맑은 하늘 · 해가 보일 때만 의미가 있음. 구름 · 지형 · 고도는 **반영하지 않습니다** — 화면에도 "맑은 하늘 기준 어림"이라고 적습니다):
 *   고도 −12° → 0.01 lux, −6°(시민 박명 끝) → 3.4 lux, 0°(일몰 · 일출) → 400 lux, +10° → 10000 lux. 이 사이는 **고도에 대해 로그 직선**(lux 의 로그가 직선으로 이어짐), 양 끝 밖은 끝값으로 자릅니다.
 *
 *  1. `sceneLux(고도)`: 기준점에서 그 값 그대로(0 → 400, −6 → 3.4, −12 → 0.01, 10 → 10000). 두 기준점 한가운데는 기하평균
 *     (−3° → √(400 × 3.4) = 36.88, +5° → √(400 × 10000) = 2000, −9° → √(3.4 × 0.01) = 0.1844). 끝 밖은 자름(−30° → 0.01, 60° → 10000). 숫자가 아니면 null.
 *  2. `exposureStops(고도 목록)`: 첫 값을 0 으로 한 단 수 = log2(lux ÷ 첫 lux). [0, −6] → [0, log2(3.4 ÷ 400) = −6.879], [−6, 0] → [0, +6.879], [10, 0] → [0, log2(400 ÷ 10000) = −4.644].
 *     한 단 = 밝기 두 배라서 [0, −3, −6] 은 기하평균 때문에 가운데가 정확히 끝의 절반(−3.439). 숫자가 아닌 값은 그 자리만 null(이웃 값으로 메우지 않음). 첫 값이 null 이면 전부 null. 빈 목록 → 빈 목록.
 *  3. `exposureSummary(단 목록)` = { total(마지막 − 첫, 유효한 마지막 값 기준), min, max } 또는 유효한 값이 둘 미만이면 null. [0, −3.4, −6.9] → total −6.9.
 *  4. `exposureLine(단 목록, 폭, 높이)`: 점 글자 "x,y x,y …". x 는 0 ~ 폭을 균등(목록 길이 n 이면 i × 폭 ÷ (n − 1)), y 는 가장 밝은 값이 0(위), 가장 어두운 값이 높이(아래). 값이 모두 같으면 가운데(높이 ÷ 2). null 은 건너뜀. 점이 둘 미만이면 빈 글자.
 *     [0, −5, −10], 폭 100, 높이 20 → "0,0 50,10 100,20".
 *  5. 실제 해 위치로(서울 2026-11-21, SunCalc 일몰 시각 기준 −20 ~ +40분): 처음에서 끝까지 **약 11.5 단 어두워지고**(−11.5 ± 0.5), 중간에 한 번도 밝아지지 않음(단조 감소).
 *     손계산: SunCalc 고도는 −20분 +2.50°, 일몰 −1.07°, +40분 −8.44°. lux(+2.5°) = 400 × 25^0.25 = 894.4, lux(−8.44°) = exp(ln 0.01 + 0.5933 × ln(340)) = 0.3176 → log2(0.3176 ÷ 894.4) = −11.46.
 *     (처음에는 "6 ~ 10 단"이라고 어림해 적었는데 −20 ~ +40분 사이에 해가 약 11° 내려가 틀린 어림이었습니다. SunCalc 고도로 손계산한 위 값으로 고쳤고, 앱 식이 아닌 기준표 사이 직선에서 나온 값입니다.)
 */
const path = require('path');
const fs = require('fs');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const near = (a, b, t = 0.01) => typeof a === 'number' && Math.abs(a - b) <= t;

(async () => {
  let X = null;
  try { X = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'exposureCurve.js')); } catch { X = null; }
  console.log('\n[1] sceneLux');
  const lux = (a) => (X && X.sceneLux ? X.sceneLux(a) : 'none');
  ok(near(lux(0), 400, 1e-6) && near(lux(-6), 3.4, 1e-6) && near(lux(-12), 0.01, 1e-9) && near(lux(10), 10000, 1e-6), '기준점 그 값');
  ok(near(lux(-3), Math.sqrt(400 * 3.4), 1e-6) && near(lux(5), 2000, 1e-6) && near(lux(-9), Math.sqrt(3.4 * 0.01), 1e-6), '두 기준점 한가운데는 기하평균');
  ok(near(lux(-30), 0.01, 1e-9) && near(lux(60), 10000, 1e-6), '끝 밖은 자름');
  ok(lux(NaN) === null && lux(undefined) === null && lux('x') === null, '숫자가 아니면 null');

  console.log('\n[2] exposureStops');
  const st = (a) => (X && X.exposureStops ? X.exposureStops(a) : 'none');
  const s1 = st([0, -6]);
  ok(Array.isArray(s1) && s1[0] === 0 && near(s1[1], Math.log2(3.4 / 400), 1e-6) && near(s1[1], -6.879, 0.001), '[0, −6] → [0, −6.879]');
  const s2 = st([-6, 0]);
  ok(Array.isArray(s2) && near(s2[1], 6.879, 0.001), '[−6, 0] → [0, +6.879]');
  const s3 = st([10, 0]);
  ok(Array.isArray(s3) && near(s3[1], -4.644, 0.001), '[10, 0] → −4.644');
  const s4 = st([0, -3, -6]);
  ok(Array.isArray(s4) && near(s4[1], s4[2] / 2, 1e-9) && near(s4[1], -3.439, 0.001), '가운데는 끝의 절반(기하평균)');
  const s5 = st([0, NaN, -6]);
  ok(Array.isArray(s5) && s5[1] === null && near(s5[2], -6.879, 0.001), '숫자가 아닌 값은 그 자리만 null');
  const s6 = st([NaN, 0, -6]);
  ok(Array.isArray(s6) && s6.length === 3 && s6.every((v) => v === null), '첫 값이 null 이면 전부 null');
  ok(Array.isArray(st([])) && st([]).length === 0, '빈 목록');

  console.log('\n[3] exposureSummary');
  const sm = (a) => (X && X.exposureSummary ? X.exposureSummary(a) : 'none');
  const m1 = sm([0, -3.4, -6.9]);
  ok(m1 && m1 !== 'none' && near(m1.total, -6.9, 1e-9) && m1.min === -6.9 && m1.max === 0, '[0, −3.4, −6.9] → total −6.9, min −6.9, max 0');
  const m2 = sm([0, -2, null]);
  ok(m2 && m2 !== 'none' && m2.total === -2, '끝이 null 이면 유효한 마지막 값 기준');
  ok(sm([0]) === null && sm([]) === null && sm([null, null]) === null, '유효한 값이 둘 미만이면 null');

  console.log('\n[4] exposureLine');
  const ln = (a, w, h) => (X && X.exposureLine ? X.exposureLine(a, w, h) : 'none');
  ok(ln([0, -5, -10], 100, 20) === '0,0 50,10 100,20', '[0, −5, −10], 100 × 20 → "0,0 50,10 100,20"');
  ok(ln([0, 0, 0], 100, 20) === '0,10 50,10 100,10', '값이 모두 같으면 가운데');
  ok(ln([0, null, -10], 100, 20) === '0,0 100,20', 'null 은 건너뜀(x 는 자리 그대로)');
  ok(ln([0], 100, 20) === '' && ln([], 100, 20) === '', '점이 둘 미만이면 빈 글자');

  console.log('\n[5] 실제 해 위치');
  {
    const SunCalc = require('suncalc');
    const lat = 37.5665, lon = 126.978;
    const ss = SunCalc.getTimes(new Date('2026-11-21T12:00:00+09:00'), lat, lon).sunset.getTime();
    const sun = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'celestial.js')).catch(() => null);
    const getAlt = sun && sun.getSunPosition ? (ms) => sun.getSunPosition(new Date(ms), lat, lon).altitude : null;
    ok(!!getAlt, '앱의 해 위치 함수를 읽음');
    if (getAlt && X && X.exposureStops) {
      const alts = []; for (let m = -20; m <= 40; m += 2) alts.push(getAlt(ss + m * 60000));
      const stops = X.exposureStops(alts);
      const total = stops[stops.length - 1];
      let mono = true; for (let i = 1; i < stops.length; i++) if (stops[i] > stops[i - 1] + 1e-9) mono = false;
      ok(Math.abs(total - (-11.46)) <= 0.5, `일몰 −20 ~ +40분: 끝에서 ${total.toFixed(2)} 단(−11.46 ± 0.5 이어야)`);
      ok(mono, '중간에 밝아지지 않음(단조 감소)');
    } else { ok(false, '곡선 계산을 못 부름'); ok(false, '단조'); }
  }

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
