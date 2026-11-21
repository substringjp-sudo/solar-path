/**
 * **모드 줄(셔터 아래, 좌우로 밀어 고르는 줄)의 순수 계산이 맞는가** — `src/utils/modeStrip.ts`. 브라우저 · 네트워크 불필요.
 * (목업 "5차: 모드 줄". 사용자 결정 2026-11-21: 시뮬레이션이 앱의 시작, 샌드박스는 자유 비행·넓은 날짜·무거운 계산, 노을은 모드가 아니라 사진에 합침,
 *  시뮬레이션 · 샌드박스 · 촬영 모드로 들어가면 먼저 사진 모드로 가고 보던 방향이 촬영 가이드가 된다.)
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 모드 키: 'simulation' · 'sandbox' · 'photo' · 'astro' · 'timelapse' · 'event'. 밀기 값은 손가락이 움직인 거리 dx(px)와 속도 vx(px/s), **왼쪽으로 가는 쪽이 음수**(왼쪽으로 밀면 다음 모드가 가운데로 온다).
 *
 *  1. `modeList(이벤트 있음)`: 거짓 · 생략 → [simulation, sandbox, photo, astro, timelapse]. 참 → 맨 끝에 event 가 붙는다(월식 같은 날에만). 노을 모드는 없다(어떤 키에도 sunset · normal 이 없다).
 *  2. `isCamera(모드)`: simulation · sandbox 는 거짓, 나머지는 참. `captureKeyFor(모드)`(기존 촬영 모드 키로 옮김): photo → 'normal', astro → 'astro', timelapse → 'timelapse', event → 'event', simulation · sandbox → null.
 *  3. 이름 `modeName(모드, 언어)`: 한국어 시뮬레이션 · 샌드박스 · 사진 · 천체 · 타임랩스 · 이벤트. 영어 Simulation · Sandbox · Photo · Astro · Timelapse · Event. 일본어 シミュレーション · サンドボックス · 写真 · 天体 · タイムラプス · イベント. 세 언어가 모드마다 서로 다르다.
 *  4. `stepBy(목록, 지금, 칸 수)`: 목록에서 칸 수만큼(음수는 뒤로) 옮기고 양 끝에서 멈춘다(끝에서 처음으로 돌아가지 않는다). 지금이 목록에 없으면 첫 모드(simulation)에서 센다. 칸 수가 숫자가 아니면 0.
 *  5. 들어가는 규칙 `landing(이전, 목표)`: 이전이 카메라가 아니고(시뮬레이션 · 샌드박스) 목표가 카메라 쪽인데 photo 가 아니면 photo 에 내린다. 그 밖에는 목표 그대로.
 *     (simulation, astro) → photo, (sandbox, timelapse) → photo, (sandbox, photo) → photo, (photo, astro) → astro, (astro, sandbox) → sandbox, (astro, timelapse) → timelapse, (simulation, sandbox) → sandbox.
 *  6. 고르기(눌러서) `pickMode(목록, 지금, 목표)`: 목표가 목록에 있으면 landing(지금, 목표), 없으면 지금 그대로. 예(목록 5개): (simulation, astro) → photo, (photo, simulation) → simulation, (photo, event) → photo(목록에 없음).
 *  7. 밀기 `dragMode(목록, 지금, dx, vx)`: 방향은 |dx| ≥ 40 이면 dx 부호(음수 = 다음), 아니고 |vx| ≥ 600 이면 vx 부호, 둘 다 못 미치면 그대로. 크기는 |dx| ≥ 160 또는 |vx| ≥ 1800 이면 두 칸, 아니면 한 칸.
 *     옮긴 결과에 5번 규칙을 적용한다. 숫자가 아닌 값이 있으면 그대로. (목록 5개 기준)
 *     (simulation, −50, 0) → sandbox, (simulation, −200, 0) → photo, (sandbox, −50, 0) → photo, (sandbox, −200, 0) → photo(두 칸이면 astro 지만 처음 들어오므로 photo),
 *     (photo, −50, 0) → astro, (photo, −200, 0) → timelapse, (astro, −200, 0) → timelapse(끝에서 멈춤), (photo, 50, 0) → sandbox, (photo, 200, 0) → simulation, (simulation, 100, 0) → simulation(끝에서 멈춤),
 *     (photo, −39, −599) → photo, (photo, −39, −600) → astro, (photo, −39, 600) → sandbox, (photo, −50, 900) → astro(거리가 40 이상이면 속도가 반대여도 거리를 따른다),
 *     (photo, −159, 0) → astro(한 칸), (photo, −160, 0) → timelapse(두 칸), (photo, −10, −1799) → astro, (photo, −10, −1800) → timelapse, (sandbox, −10, −1800) → photo, (photo, NaN, 0) → photo. 목록 6개(event 있음)에서 (timelapse, −50, 0) → event, 5개에서는 → timelapse.
 *  8. 줄 배치 `stripLayout(목록, 가운데, 폭 = 390, 칸 폭 = 84)`: 모드마다 { mode, x, opacity, visible }. x = 폭/2 + (자기 칸 − 가운데 칸) · 칸 폭 (글자 가운데 위치). 가운데와의 거리 0 → 불투명도 1, 1 → 0.62, 2 → 0.34, 3 → 0.16, 4 이상 → 0 이고 visible 거짓.
 *     가운데가 simulation(목록 5개): x = 195 · 279 · 363 · 447 · 531, 불투명도 1 · 0.62 · 0.34 · 0.16 · 0(숨김). 가운데가 photo: x = 27 · 111 · 195 · 279 · 363, 불투명도 0.34 · 0.62 · 1 · 0.62 · 0.34, 전부 보임. 가운데가 목록에 없으면 첫 모드로 본다.
 *  9. 가이드 `viewGuide({ azDeg, elDeg })`: 방위를 [0, 360) 로(−10 → 350, 370 → 10, 360 → 0), 고도는 −90 ~ 90 으로 자른다(95 → 90, −95 → −90). 둘 중 하나라도 숫자가 아니면(NaN · 없음 · null) null.
 * 10. 바꾸기 `switchMode(이전, 목표, 보던 방향)` → { mode, guideOp, guide }: mode = landing(이전, 목표).
 *     이전이 카메라가 아니고 mode 가 카메라이면 guideOp 'set' 과 guide = viewGuide(보던 방향)(보던 방향이 잘못이면 guideOp 'clear', guide null). 이전과 mode 가 같으면 'keep'. 카메라 → 카메라는 'keep'(가이드 그대로).
 *     그 밖(카메라 → 시뮬레이션 · 샌드박스, 시뮬레이션 ↔ 샌드박스)은 'clear'. keep · clear 일 때 guide 는 null.
 *     (sandbox, astro, {159, 13}) → { photo, set, {159, 13} }. (simulation, photo, {−10, 5}) → { photo, set, {350, 5} }. (photo, astro, …) → { astro, keep, null }. (astro, sandbox, …) → { sandbox, clear, null }. (sandbox, photo, {NaN, 1}) → { photo, clear, null }. (photo, photo, …) → keep.
 * 11. 칩 `chipsFor(모드)`: simulation → [](2026-11-21 기기에서 보신 사용자 의견: 날짜가 칩 줄과 시간 자 왼쪽 두 곳에 있어 공간을 덜 쓰는 자 왼쪽 하나만 남기고, 그 날짜를 위아래로 밀어 바로 다른 날로 간다 — 그래서 시뮬레이션에는 칩 줄이 없다), sandbox → [move, view, scene, tools](높이와 줌을 "보기"로 합쳤다), 카메라 쪽 모드는 null(카메라 칩은 따로). `chipLabel(칩, 언어)`: 한국어 어제 · 오늘 · 내일 · 날짜 / 이동 · 보기 · 장면 · 도구,
 *     영어 Yesterday · Today · Tomorrow · Date / Move · View · Scenes · Tools, 일본어 昨日 · 今日 · 明日 · 日付 / 移動 · 表示 · シーン · ツール. 줄마다 칩은 4개 이하, 이름은 12자 이하.
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-mode-strip.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const J = JSON.stringify;
const close = (a, b) => Math.abs(a - b) < 1e-9;

(async () => {
  let M = null;
  try { M = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'modeStrip.js')); } catch { M = null; }
  ok(!!M && typeof M.modeList === 'function' && typeof M.dragMode === 'function' && typeof M.switchMode === 'function', 'modeStrip 이 있다');
  if (!M || typeof M.modeList !== 'function' || typeof M.dragMode !== 'function') { console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); }

  const L5 = M.modeList(), L6 = M.modeList(true);
  console.log('\n[1~3] 목록 · 종류 · 이름');
  ok(J(L5) === J(['simulation', 'sandbox', 'photo', 'astro', 'timelapse']) && J(M.modeList(false)) === J(L5), '기본 목록 다섯 개(이벤트 없음)');
  ok(J(L6) === J([...L5, 'event']), '이벤트가 있으면 맨 끝에 하나 붙는다');
  ok(![...L5, ...L6].some(k => /sunset|normal|glow/i.test(k)), '노을 모드는 없다');
  ok(!M.isCamera('simulation') && !M.isCamera('sandbox') && ['photo', 'astro', 'timelapse', 'event'].every(M.isCamera), 'isCamera');
  ok(J(['simulation', 'sandbox', 'photo', 'astro', 'timelapse', 'event'].map(M.captureKeyFor)) === J([null, null, 'normal', 'astro', 'timelapse', 'event']), 'captureKeyFor');
  const names = (l) => L6.map(k => M.modeName(k, l));
  ok(J(names('ko')) === J(['시뮬레이션', '샌드박스', '사진', '천체', '타임랩스', '이벤트']), '한국어 이름');
  ok(J(names('en')) === J(['Simulation', 'Sandbox', 'Photo', 'Astro', 'Timelapse', 'Event']), '영어 이름');
  ok(J(names('ja')) === J(['シミュレーション', 'サンドボックス', '写真', '天体', 'タイムラプス', 'イベント']), '일본어 이름');
  ok(L6.every((k, i) => new Set(['ko', 'en', 'ja'].map(l => names(l)[i])).size === 3), '세 언어가 모드마다 다르다');

  console.log('\n[4] 칸 옮기기');
  ok(M.stepBy(L5, 'simulation', 2) === 'photo' && M.stepBy(L5, 'photo', -1) === 'sandbox' && M.stepBy(L5, 'timelapse', 3) === 'timelapse' && M.stepBy(L5, 'simulation', -2) === 'simulation', '옮기고 양 끝에서 멈춘다(돌아가지 않는다)');
  ok(M.stepBy(L5, 'nope', 1) === 'sandbox' && M.stepBy(L5, 'photo', NaN) === 'photo' && M.stepBy(L5, 'photo', 0) === 'photo', '지금이 목록에 없으면 첫 모드에서, 칸 수가 숫자가 아니면 0');

  console.log('\n[5~6] 들어가는 규칙과 고르기');
  const Lg = M.landing;
  ok(Lg('simulation', 'astro') === 'photo' && Lg('sandbox', 'timelapse') === 'photo' && Lg('sandbox', 'photo') === 'photo', '시뮬레이션 · 샌드박스에서 카메라 쪽으로 가면 사진에 내린다');
  ok(Lg('photo', 'astro') === 'astro' && Lg('astro', 'sandbox') === 'sandbox' && Lg('astro', 'timelapse') === 'timelapse' && Lg('simulation', 'sandbox') === 'sandbox', '그 밖에는 목표 그대로');
  ok(M.pickMode(L5, 'simulation', 'astro') === 'photo' && M.pickMode(L5, 'photo', 'simulation') === 'simulation' && M.pickMode(L5, 'photo', 'event') === 'photo' && M.pickMode(L6, 'astro', 'event') === 'event', 'pickMode: 눌러서 고르기');

  console.log('\n[7] 밀기');
  const D = (cur, dx, vx, list = L5) => M.dragMode(list, cur, dx, vx);
  ok(D('simulation', -50, 0) === 'sandbox' && D('simulation', -200, 0) === 'photo' && D('sandbox', -50, 0) === 'photo' && D('sandbox', -200, 0) === 'photo', '시뮬레이션 · 샌드박스에서 밀기(두 칸이어도 사진에서 선다)');
  ok(D('photo', -50, 0) === 'astro' && D('photo', -200, 0) === 'timelapse' && D('astro', -200, 0) === 'timelapse', '사진에서 오른쪽 모드로, 끝에서 멈춘다');
  ok(D('photo', 50, 0) === 'sandbox' && D('photo', 200, 0) === 'simulation' && D('simulation', 100, 0) === 'simulation', '반대로 밀기, 끝에서 멈춘다');
  ok(D('photo', -39, -599) === 'photo' && D('photo', -39, -600) === 'astro' && D('photo', -39, 600) === 'sandbox' && D('photo', -50, 900) === 'astro', '경계 39/599 못 미침, 600 닿음, 거리가 40 이상이면 거리를 따른다');
  ok(D('photo', -159, 0) === 'astro' && D('photo', -160, 0) === 'timelapse' && D('photo', -10, -1799) === 'astro', '두 칸 경계: 159 한 칸, 160 두 칸, 속도 1799 한 칸');
  ok(D('photo', -10, -1800) === 'timelapse' && D('sandbox', -10, -1800) === 'photo' && D('photo', NaN, 0) === 'photo' && D('photo', 0, Infinity) === 'photo', '빠르면 두 칸, 숫자가 아니면 그대로');
  ok(D('timelapse', -50, 0, L6) === 'event' && D('timelapse', -50, 0, L5) === 'timelapse', '이벤트가 있을 때만 그 끝으로');

  console.log('\n[8] 줄 배치');
  const S0 = M.stripLayout(L5, 'simulation');
  ok(J(S0.map(s => s.x)) === J([195, 279, 363, 447, 531]) && J(S0.map(s => s.opacity)) === J([1, 0.62, 0.34, 0.16, 0]) && J(S0.map(s => s.visible)) === J([true, true, true, true, false]), '가운데가 시뮬레이션: 자리 · 불투명도 · 숨김');
  const S2 = M.stripLayout(L5, 'photo');
  ok(J(S2.map(s => s.x)) === J([27, 111, 195, 279, 363]) && J(S2.map(s => s.opacity)) === J([0.34, 0.62, 1, 0.62, 0.34]) && S2.every(s => s.visible) && J(S2.map(s => s.mode)) === J(L5), '가운데가 사진');
  ok(J(M.stripLayout(L5, 'nope').map(s => s.x)) === J([195, 279, 363, 447, 531]) && J(M.stripLayout(L5, 'photo', 400, 100).map(s => s.x)) === J([0, 100, 200, 300, 400]), '목록에 없으면 첫 모드, 폭 · 칸 폭을 바꿀 수 있다');

  console.log('\n[9] 가이드');
  const G = M.viewGuide;
  ok(J(G({ azDeg: 159, elDeg: 13 })) === J({ azDeg: 159, elDeg: 13 }) && G({ azDeg: -10, elDeg: 5 }).azDeg === 350 && G({ azDeg: 370, elDeg: 5 }).azDeg === 10 && G({ azDeg: 360, elDeg: 0 }).azDeg === 0 && !Object.is(G({ azDeg: -360, elDeg: 0 }).azDeg, -0), '방위를 0~360 으로');
  ok(G({ azDeg: 45, elDeg: 95 }).elDeg === 90 && G({ azDeg: 45, elDeg: -95 }).elDeg === -90 && G({ azDeg: 45, elDeg: 30 }).elDeg === 30, '고도를 −90~90 으로');
  ok(G({ azDeg: NaN, elDeg: 1 }) === null && G({ azDeg: 1, elDeg: undefined }) === null && G(null) === null && G({ azDeg: Infinity, elDeg: 1 }) === null, '숫자가 아니면 null');

  console.log('\n[10] 바꾸기');
  const view = { azDeg: 159, elDeg: 13 };
  const T = (a, b, v = view) => M.switchMode(a, b, v);
  const t1 = T('sandbox', 'astro');
  ok(t1.mode === 'photo' && t1.guideOp === 'set' && J(t1.guide) === J({ azDeg: 159, elDeg: 13 }), '샌드박스 → 천체: 사진에 내리고 가이드를 건다');
  const t2 = T('simulation', 'photo', { azDeg: -10, elDeg: 5 });
  ok(t2.mode === 'photo' && t2.guideOp === 'set' && J(t2.guide) === J({ azDeg: 350, elDeg: 5 }), '시뮬레이션 → 사진: 방위가 정리된 가이드');
  ok(J(T('photo', 'astro')) === J({ mode: 'astro', guideOp: 'keep', guide: null }), '카메라 → 카메라: 가이드 그대로(keep)');
  ok(J(T('astro', 'sandbox')) === J({ mode: 'sandbox', guideOp: 'clear', guide: null }) && J(T('simulation', 'sandbox')) === J({ mode: 'sandbox', guideOp: 'clear', guide: null }) && J(T('sandbox', 'simulation')) === J({ mode: 'simulation', guideOp: 'clear', guide: null }), '카메라 → 샌드박스, 시뮬레이션 ↔ 샌드박스: clear');
  ok(J(T('sandbox', 'photo', { azDeg: NaN, elDeg: 1 })) === J({ mode: 'photo', guideOp: 'clear', guide: null }), '보던 방향이 잘못이면 가이드 없이(clear)');
  ok(T('photo', 'photo').guideOp === 'keep' && T('simulation', 'simulation').guideOp === 'keep', '같은 모드는 keep');

  console.log('\n[11] 칩');
  ok(J(M.chipsFor('simulation')) === J([]) && J(M.chipsFor('sandbox')) === J(['move', 'view', 'scene']) && ['photo', 'astro', 'timelapse', 'event'].every(k => M.chipsFor(k) === null), '시뮬레이션은 칩 없음, 샌드박스 칩(높이와 줌은 보기로), 카메라 쪽은 null');
  const lab = (l) => M.chipsFor('sandbox').map(c => M.chipLabel(c, l));
  const labDay = (l) => ['yesterday', 'today', 'tomorrow', 'date'].map(c => M.chipLabel(c, l));
  ok(J(lab('ko')) === J(['이동', '보기', '장면']) && J(labDay('ko')) === J(['어제', '오늘', '내일', '날짜']), '한국어 칩 이름');
  ok(J(lab('en')) === J(['Move', 'View', 'Scenes']) && J(labDay('en')) === J(['Yesterday', 'Today', 'Tomorrow', 'Date']), '영어 칩 이름');
  ok(J(lab('ja')) === J(['移動', '表示', 'シーン']) && J(labDay('ja')) === J(['昨日', '今日', '明日', '日付']), '일본어 칩 이름');
  ok(['ko', 'en', 'ja'].every(l => lab(l).every(s => s.length > 0 && s.length <= 12)) && M.chipsFor('simulation').length === 0 && M.chipsFor('sandbox').length <= 4, '줄마다 칩 4개 이하, 이름 12자 이하');

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n통과 — pass ${pass}`);
  process.exit(fail ? 1 : 0);
})();
