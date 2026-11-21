/**
 * **접었다 펼치는 아래 막대의 단계 계산과 화면 요소 겹침 판정** — `src/utils/dockStages.ts` · `src/utils/layoutOverlap.ts`. 브라우저 · 네트워크 불필요.
 * (목업 "4차 b": 평소에는 접혀 있고, 누르거나 위로 밀면 한 단계, 더 밀면 끝까지 펼쳐지는 애플 카메라식 아래 막대. 손잡이를 눌러도 같은 단계로 넘어간다.)
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 단계는 세 개: 'min'(접힘) · 'mid'(펼침) · 'full'(전체). 밀기 값은 손가락이 움직인 거리 dy(px)와 속도 vy(px/s), **위로 가는 쪽이 음수**.
 *
 *  1. `STAGES` = ['min', 'mid', 'full'].
 *  2. 손잡이를 누르면(`tapNext`) 다음 단계, 끝에서는 처음으로: min → mid → full → min.
 *  3. `expand` · `collapse`는 한 단계씩이고 끝에서 더 가지 않는다: expand(full) = full, collapse(min) = min, expand(min) = mid, collapse(full) = mid.
 *  4. 밀기(`dragStage(단계, dy, vy)`):
 *     - 방향: |dy| ≥ 40 이면 dy 의 부호(위 = 펼침, 아래 = 접힘). |dy| < 40 이고 |vy| ≥ 600 이면 vy 의 부호. 둘 다 못 미치면 그대로.
 *     - 크기: |dy| ≥ 160 또는 |vy| ≥ 1800 이면 두 단계, 아니면 한 단계. 끝에서 더 가지 않는다.
 *     - 예: (min, −50, 0) → mid, (min, −200, 0) → full, (min, −39, −599) → min, (min, −39, −600) → mid, (min, −40, 0) → mid, (mid, 60, 0) → min, (full, −300, 0) → full,
 *       (full, 200, 0) → min, (mid, −10, −1800) → full(한 단계로 충분), (min, −10, −1800) → full(두 단계), 숫자가 아닌 값이 있으면 그대로.
 *     - dy 가 40 이상으로 한쪽이면 vy 가 반대여도 dy 를 따른다: (min, −50, +900) → mid.
 *  5. 막대 높이(`dockHeights(화면 높이)`, px, 정수): min = 232. mid = 화면의 55 % 와 432 중 작은 값, 단 min + 96 보다 작아지면 min + 96. full = 화면의 78 % (반올림), 단 mid + 96 보다 작아지면 mid + 96.
 *     화면 844 → { min 232, mid 432, full 658 }, 700 → { 232, 385, 546 }(0.55 · 700 = 385), 500 → { 232, 328, 424 }(mid 는 275 라서 328 로 올림, full 은 390 이라서 424 로 올림).
 *     400 ~ 1200 어느 화면에서도 min < mid < full. 숫자가 아니거나 0 이하면 844 로 본다.
 *  6. 겹침(`overlaps(a, b)`): 두 사각형({ x, y, w, h })이 가로 · 세로 모두 0.5 px 넘게 겹치면 참. 맞닿기만 하면(겹침 0) 거짓, 0.3 px 겹침도 거짓(반올림 오차).
 *     (0,0,10,10) · (10,0,10,10) → 거짓, (0,0,10,10) · (9,0,10,10) → 참, (0,0,10,10) · (9.7,0,10,10) → 거짓, 완전히 포함되는 것은 참.
 *  7. `findOverlaps(목록)`: 목록의 각 항목은 { id, rect, parent? }. 겹치는 쌍을 [앞 id, 뒤 id] 로 목록 순서대로 모두 돌려준다. 부모와 자식(직접 부모 · 조상 모두) 쌍은 겹쳐도 세지 않는다.
 *     A 가 B 의 부모이고 C 가 B 와 겹치면 [B, C] 하나. A · C 는 서로 안 겹치면 없다. 겹치는 것이 없으면 빈 목록.
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-dock-stages.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const J = JSON.stringify;

(async () => {
  let D = null, O = null;
  try { D = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'dockStages.js')); } catch { D = null; }
  try { O = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'layoutOverlap.js')); } catch { O = null; }
  ok(!!D && typeof D.dragStage === 'function' && typeof D.dockHeights === 'function' && typeof D.tapNext === 'function', 'dockStages 가 있다');
  ok(!!O && typeof O.overlaps === 'function' && typeof O.findOverlaps === 'function', 'layoutOverlap 이 있다');
  if (!D || typeof D.dragStage !== 'function' || !O || typeof O.overlaps !== 'function') { console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); }

  console.log('\n[1~3] 단계');
  ok(J(D.STAGES) === J(['min', 'mid', 'full']), 'STAGES');
  ok(D.tapNext('min') === 'mid' && D.tapNext('mid') === 'full' && D.tapNext('full') === 'min', '손잡이: min → mid → full → min');
  ok(D.expand('full') === 'full' && D.collapse('min') === 'min' && D.expand('min') === 'mid' && D.collapse('full') === 'mid', 'expand · collapse 한 단계씩, 끝에서 멈춘다');

  console.log('\n[4] 밀기');
  const d = D.dragStage;
  ok(d('min', -50, 0) === 'mid' && d('min', -200, 0) === 'full' && d('min', -39, -599) === 'min' && d('min', -39, -600) === 'mid' && d('min', -40, 0) === 'mid', '위로: 50 → mid, 200 → full, 경계 39/599 못 미침, 600 · 40 경계 포함');
  ok(d('mid', 60, 0) === 'min' && d('full', -300, 0) === 'full' && d('full', 200, 0) === 'min', '아래로 접힘, 끝에서 멈춤, 두 단계');
  ok(d('mid', -10, -1800) === 'full' && d('min', -10, -1800) === 'full', '빠른 속도: mid → full, min → full(두 단계)');
  ok(d('min', -50, 900) === 'mid', 'dy 가 40 이상이면 vy 가 반대여도 dy 를 따른다');
  ok(d('min', NaN, 0) === 'min' && d('mid', -50, NaN) === 'mid' && d('mid', 0, 0) === 'mid', '숫자가 아니거나 움직임이 없으면 그대로');

  console.log('\n[5] 높이');
  ok(J(D.dockHeights(844)) === J({ min: 232, mid: 432, full: 658 }) && J(D.dockHeights(700)) === J({ min: 232, mid: 385, full: 546 }) && J(D.dockHeights(500)) === J({ min: 232, mid: 328, full: 424 }), `844 · 700 · 500: ${J(D.dockHeights(844))} ${J(D.dockHeights(700))} ${J(D.dockHeights(500))}`);
  let ordered = true; for (let h = 400; h <= 1200; h++) { const x = D.dockHeights(h); if (!(x.min < x.mid && x.mid < x.full)) ordered = false; }
  ok(ordered, '400 ~ 1200 어느 화면에서도 min < mid < full');
  ok(J(D.dockHeights(NaN)) === J(D.dockHeights(844)) && J(D.dockHeights(0)) === J(D.dockHeights(844)) && J(D.dockHeights(-5)) === J(D.dockHeights(844)), '숫자가 아니거나 0 이하면 844 로 본다');

  console.log('\n[6] 겹침');
  const R = (x, y, w, h) => ({ x, y, w, h });
  ok(O.overlaps(R(0, 0, 10, 10), R(10, 0, 10, 10)) === false && O.overlaps(R(0, 0, 10, 10), R(9, 0, 10, 10)) === true && O.overlaps(R(0, 0, 10, 10), R(9.7, 0, 10, 10)) === false && O.overlaps(R(0, 0, 10, 10), R(2, 2, 3, 3)) === true, '맞닿음 거짓 · 1px 참 · 0.3px 거짓 · 포함 참');
  ok(O.overlaps(R(0, 0, 10, 10), R(0, 20, 10, 10)) === false && O.overlaps(R(0, 0, 10, 10), R(20, 0, 10, 10)) === false, '떨어져 있으면 거짓');

  console.log('\n[7] findOverlaps');
  const items2 = [{ id: 'A', rect: R(0, 0, 100, 100) }, { id: 'B', rect: R(10, 10, 30, 30), parent: 'A' }, { id: 'C', rect: R(30, 30, 30, 30), parent: 'A' }];
  ok(J(O.findOverlaps(items2)) === J([['B', 'C']]), '부모(A)와의 겹침은 세지 않고 B · C 만');
  ok(J(O.findOverlaps([{ id: 'A', rect: R(0, 0, 10, 10) }, { id: 'B', rect: R(20, 0, 10, 10) }])) === J([]), '겹침 없으면 빈 목록');
  const deep = [{ id: 'A', rect: R(0, 0, 100, 100) }, { id: 'B', rect: R(5, 5, 50, 50), parent: 'A' }, { id: 'C', rect: R(10, 10, 20, 20), parent: 'B' }];
  ok(J(O.findOverlaps(deep)) === J([]), '조상도 세지 않는다(C 는 B 와 A 모두의 자손)');

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
