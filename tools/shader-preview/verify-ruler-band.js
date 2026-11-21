/**
 * **시간 자 위 노을 점수 띠의 계산이 맞는가** — `src/utils/timeRuler.ts` 의 `rulerBand`. 브라우저 · 네트워크 불필요.
 * (목업 "4차 b": 자 위에 시간대별 점수가 색 띠로 깔려 좋은 때가 먼저 보인다. 점수는 `scoreSeries` 의 표본(10분 간격)을 그대로 쓴다.)
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 기준 시각 C = 2026-11-21 17:04 KST(Date.UTC(2026, 10, 21, 8, 4)), 폭 390, 한 시간 72 px → 10분 12 px, 가운데 x = 195.
 *
 *  1. `rulerBand(표본 목록, 가운데 시각, 폭 = 390, 시간당 px = 72)` → [{ x0, x1, alpha }] (x0 < x1, x 오름차순). 표본은 { t(ms), score(0~100 | null) }.
 *     이웃한 두 표본이 모두 점수가 있을 때만 그 사이 한 칸을 만들고, 알파 = 두 점수의 평균 / 100 (1 을 넘지 않음). 평균이 0 이하이면 칸을 만들지 않는다. 한쪽이라도 null 이면 그 칸은 없다(없는 값을 메우지 않음).
 *  2. x = 폭/2 + (표본 시각 − 가운데 시각)(분)/60 · 시간당 px. 칸은 0 ~ 폭으로 자르고(걸친 칸은 잘림), 완전히 밖이면 뺀다.
 *  3. 예: 표본 (C, 50) · (C+10분, 100) · (C+20분, null) → 한 칸 { x0 195, x1 207, alpha 0.75 }. (C, 0) · (C+10분, 0) → 칸 없음. (C, 100) · (C+10분, 100) → { 195, 207, 1 }.
 *     (C − 3시간, 40) · (C − 3시간 + 10분, 60) · (C − 3시간 + 20분, 80): x 는 −21 · −9 · 3 → 첫 칸(−21 ~ −9)은 완전히 밖이라 빠지고 둘째 칸(−9 ~ 3)은 { 0, 3, 0.7 } 로 잘린다. 오른쪽: (C + 2시간 55분, 100) · (C + 3시간 5분, 100)은 x 405 · 417 로 둘 다 폭 390 밖이라 빠지고, (C + 2시간 40분, 100) · (C + 2시간 50분, 100)은 x 387 · 399 라서 { 387, 390, 1 } 로 잘린다.
시간당 px 를 36 으로 주면 (C, 100) · (C + 10분, 100) → { 195, 201, 1 }(10분 6 px), 폭 200 이면 가운데가 100 이라(시간당 72 px) { 100, 112, 1 }.
 *  4. 표본이 시간순이 아니어도 시각순으로 본다(앞뒤가 바뀐 표본 (C+10분, 100) · (C, 50) → { 195, 207, 0.75 }). 표본이 둘 미만이거나 숫자가 아닌 값(가운데 시각 · 폭 · 시간당 px, 표본의 t)이 있으면 빈 목록.
 *  5. 칸 수: 표본 열 개(10분 간격, 모두 점수 있음, 모두 화면 안)이면 아홉 칸이고 x 가 이어진다(앞 칸의 x1 = 뒷 칸의 x0).
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-ruler-band.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const J = JSON.stringify;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const C = Date.UTC(2026, 10, 21, 8, 4), MIN = 60000;
const P = (dMin, score) => ({ t: C + dMin * MIN, score });
const same = (segs, want) => segs.length === want.length && segs.every((s, i) => near(s.x0, want[i][0]) && near(s.x1, want[i][1]) && near(s.alpha, want[i][2]));

(async () => {
  let R = null;
  try { R = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'timeRuler.js')); } catch { R = null; }
  ok(!!R && typeof R.rulerBand === 'function', 'rulerBand 가 있다');
  if (!R || typeof R.rulerBand !== 'function') { console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); }
  const B = (pts) => R.rulerBand(pts, C);

  console.log('\n[1~3] 칸');
  ok(same(B([P(0, 50), P(10, 100), P(20, null)]), [[195, 207, 0.75]]), '(50, 100, null) → 한 칸 0.75');
  ok(B([P(0, 0), P(10, 0)]).length === 0 && same(B([P(0, 100), P(10, 100)]), [[195, 207, 1]]), '0 · 0 은 칸 없음, 100 · 100 → 알파 1');
  ok(same(B([P(-180, 40), P(-170, 60), P(-160, 80)]), [[0, 3, 0.7]]), '왼쪽으로 걸친 칸은 0 에서 잘리고 완전히 밖인 칸은 빠진다');
  ok(B([P(175, 100), P(185, 100)]).length === 0 && same(B([P(160, 100), P(170, 100)]), [[387, 390, 1]]), '오른쪽: 완전히 밖은 빠지고 걸친 칸은 폭에서 잘린다');
  ok(same(B([P(0, 50), P(10, null), P(20, 90)]), []), 'null 이 끼면 양옆 칸이 없다(메우지 않음)');
  ok(same(B([P(0, 150), P(10, 150)]), [[195, 207, 1]]), '알파는 1 을 넘지 않는다');

  ok(same(R.rulerBand([P(0, 100), P(10, 100)], C, 390, 36), [[195, 201, 1]]) && same(R.rulerBand([P(0, 100), P(10, 100)], C, 200), [[100, 112, 1]]), '시간당 px · 폭을 바꿀 수 있다(36 → 6 px, 폭 200 → 가운데 100)');
  console.log('\n[4~5] 순서 · 잘못된 입력 · 이어짐');
  ok(same(B([P(10, 100), P(0, 50)]), [[195, 207, 0.75]]), '시각 순이 아니어도 시각 순으로 본다');
  ok(B([P(0, 50)]).length === 0 && B([]).length === 0 && R.rulerBand([P(0, 1), { t: NaN, score: 5 }], C).length === 0 && R.rulerBand([P(0, 5), P(10, 5)], NaN).length === 0 && R.rulerBand([P(0, 5), P(10, 5)], C, 390, 0).length === 0, '표본 둘 미만 · 숫자가 아닌 값 → 빈 목록');
  const ten = Array.from({ length: 10 }, (_, i) => P(i * 10 - 45, 60));
  const segs = B(ten);
  ok(segs.length === 9 && segs.every((s, i) => i === 0 || near(segs[i - 1].x1, s.x0)) && segs.every(s => s.x0 < s.x1), '표본 열 개 → 아홉 칸이 이어진다');
  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n통과 — pass ${pass}`);
  process.exit(fail ? 1 : 0);
})();
