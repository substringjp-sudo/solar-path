/**
 * **시간 자(눈금자를 끌어 시각을 바꾸는 줄)의 순수 계산이 맞는가** — `src/utils/timeRuler.ts`. 브라우저 · 네트워크 불필요.
 * (목업 "4차 b": 가운데 파란 핀은 고정, 눈금이 손가락을 따라 움직인다. 15분마다 눈금, 30분은 조금 길게, 정시는 더 길고 "17:00" 글자. 왼쪽 "오늘 ▾"는 날짜, 일몰 표시가 자 위에 뜬다.)
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 기준 시각 C = 2026-11-21 17:04 KST(+9) = Date.UTC(2026, 10, 21, 8, 4). 폭 390 px, 한 시간 72 px(15분 18 px). 2026-11-21 은 토요일(1월 1일이 목요일, 11월 21일은 한 해의 325번째 날, 324 mod 7 = 2 → 목 + 2 = 토).
 *
 *  1. 눈금(`rulerTicks(가운데 시각, 시간대, 폭 = 390, 시간당 px = 72)`): 현지 시각이 15분의 배수인 때마다 { x, ms, kind, label? }. x = 폭/2 + (눈금 시각 − 가운데 시각)(분)/60 · 시간당 px.
 *     kind: 정시 'hour'(label "HH:00"), 30분 'half', 15 · 45분 'quarter'(label 없음). 화면 밖 18 px 까지 포함(x ∈ [−18, 폭 + 18]).
 *     C 에서: 17:00 → x 190.2(hour, "17:00"), 17:15 → 208.2(quarter), 17:30 → 226.2(half), 18:00 → 262.2(hour, "18:00"), 16:45 → 172.2. 맨 왼쪽은 14:15(x −7.8, 14:00 은 −25.8 이라 밖), 맨 오른쪽은 20:00(x 406.2, 20:15 는 424.2 라 밖).
 *     모두 24 개: 정시 6(15 ~ 20시), 30분 6, 15 · 45분 12. x 는 오름차순. 시간대를 바꿔도(+0) 눈금 자리는 시각 차로만 정해지고 글자만 현지 시각을 따른다: 같은 C 를 UTC(+0)로 보면 17:00 눈금 자리는 그대로 190.2 지만 글자는 "08:00"(= 현지 8시) 이어야 한다.
 *  2. 끌기(`dragTimeMs(시작 시각, dx, { pxPerHour = 72, snapMin = 1 })`): 손가락이 오른쪽(+)으로 가면 눈금이 따라 오른쪽으로 오므로 시각은 **이전**으로. 새 시각 = 시작 − dx / 시간당 px · 3600000 ms, 그 뒤 snapMin 분 단위로 가장 가까운 분에 맞춘다(에포크 기준 분).
 *     C 에서 dx 72 → 16:04, dx −36 → 17:34, dx 7.3 → 16:58(−6.08분 → −6분), dx 0 → C 그대로, snapMin 5 로 dx −36 → 17:35(17:34 를 5분 단위로), dx 가 숫자가 아니면 C 그대로.
 *     시각이 분 단위가 아니어도(초 · 밀리초가 붙음) 결과는 분 경계 위다.
 *  3. 일몰 표시 자리(`markerX(가운데 시각, 표시 시각, 폭 = 390, 시간당 px = 72)`): 폭/2 + 차(분)/60 · 시간당 px, 0 ~ 폭 밖이면 null. C 에서 17:17 → 210.6. 사흘 뒤 같은 시각 → null. 표시 시각이 숫자가 아니면 null.
 *  4. 날짜 차(`dayOffset(시각, 지금, 시간대)`): 현지 날짜 차이(시각 − 지금), 정수. C 와 지금 2026-11-21 09:00 KST → 0, 지금 11-20 23:50 KST → 1, 지금 11-22 00:10 KST → −1, 11-21 00:30 KST 시각과 지금 11-20 23:50 KST → 1.
 *     `shiftDays(시각, n)`: 현지 시각은 그대로 n 일(24시간 · n) 옮김. C + 1 → 2026-11-22 17:04 KST, C − 1 → 11-20 17:04 KST.
 *  5. 날짜 글(`dateLabel(시각, 지금, 시간대, 언어)`): 차 0 · −1 · +1 은 한국어 "오늘" · "어제" · "내일", 영어 "Today" · "Yesterday" · "Tomorrow", 일본어 "今日" · "昨日" · "明日". 그 밖은 한국어 "11.23 월", 영어 "Mon 11/23", 일본어 "11/23(月)"(C + 2일 · 지금 11-21).
 *     `timeText(시각, 시간대)` = "17:04".
 *     `dateShort(시각, 시간대, 언어)`(2026-11-21 추가: 시뮬레이션은 위 칩 줄에 어제 · 오늘 · 내일이 있어 자 왼쪽 날짜 단추가 "오늘"을 또 쓰면 같은 것이 두 번 보인다 — 거기엔 날짜 자체를 쓴다): 항상 날짜와 요일. C 는 한국어 "11.21 토", 영어 "Sat 11/21", 일본어 "11/21(土)". C + 2일은 "11.23 월" (dateLabel 의 그 밖의 날짜 글과 같다).
 *  6. 일주일 줄(`weekStrip(고른 시각, 지금, 시간대, 언어)`): 지금 기준 −2일 ~ +4일 7 칸 { offset, ms, day, weekday, selected }. 지금 11-21 · 고른 것 C: day = 19 20 21 22 23 24 25, 한국어 요일 목 금 토 일 월 화 수, 영어 Thu Fri Sat Sun Mon Tue Wed, 일본어 木 金 土 日 月 火 水, selected 는 offset 0(셋째 칸)만 참.
 *     지금이 같은 날 09:00 이어도(지금의 시각이 다름) 각 칸의 ms 는 고른 시각(17:04)을 따른다: 셋째 칸 ms = C.
 *     각 칸의 ms 는 고른 시각의 현지 시각을 그대로 두고 날짜만 그 칸으로 옮긴 값(칸을 누르면 그 시각으로 간다): 첫 칸 = C − 2일, 마지막 칸 = C + 4일. 고른 것이 11-23 이면 selected 는 offset 2(다섯째 칸).
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-time-ruler.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const J = JSON.stringify;
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
const KST = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 9, mi);
const C = KST(2026, 11, 21, 17, 4);

(async () => {
  let R = null;
  try { R = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'timeRuler.js')); } catch { R = null; }
  ok(!!R && typeof R.rulerTicks === 'function' && typeof R.dragTimeMs === 'function' && typeof R.weekStrip === 'function', 'timeRuler 가 있다');
  if (!R || typeof R.rulerTicks !== 'function' || typeof R.dragTimeMs !== 'function') { console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); }

  console.log('\n[1] 눈금');
  const T = R.rulerTicks(C, 9);
  const at = (hh, mm) => T.find(t => t.ms === KST(2026, 11, 21, hh, mm));
  ok(T.length === 24 && J(T.map(t => t.x)) === J([...T.map(t => t.x)].sort((a, b) => a - b)), `24 개, x 오름차순(${T.length} 개)`);
  ok(near(at(17, 0).x, 190.2) && at(17, 0).kind === 'hour' && at(17, 0).label === '17:00' && near(at(17, 15).x, 208.2) && at(17, 15).kind === 'quarter' && at(17, 15).label === undefined, '17:00 · 17:15');
  ok(near(at(17, 30).x, 226.2) && at(17, 30).kind === 'half' && near(at(18, 0).x, 262.2) && at(18, 0).label === '18:00' && near(at(16, 45).x, 172.2), '17:30 · 18:00 · 16:45');
  ok(T[0].ms === KST(2026, 11, 21, 14, 15) && near(T[0].x, -7.8) && T[23].ms === KST(2026, 11, 21, 20, 0) && near(T[23].x, 406.2), '맨 왼쪽 14:15(−7.8) · 맨 오른쪽 20:00(406.2)');
  ok(T.filter(t => t.kind === 'hour').length === 6 && T.filter(t => t.kind === 'half').length === 6 && T.filter(t => t.kind === 'quarter').length === 12, '정시 6 · 30분 6 · 15/45분 12');
  const U = R.rulerTicks(C, 0);
  const u17 = U.find(t => near(t.x, 190.2));
  ok(U.length === 24 && !!u17 && u17.label === '08:00', `시간대 +0: 눈금 자리는 같고 글자는 현지 시각("${u17 && u17.label}")`);

  console.log('\n[2] 끌기');
  const D = (dx, o) => R.dragTimeMs(C, dx, o);
  ok(D(72) === KST(2026, 11, 21, 16, 4) && D(-36) === KST(2026, 11, 21, 17, 34) && D(7.3) === KST(2026, 11, 21, 16, 58) && D(0) === C, '72 → 16:04, −36 → 17:34, 7.3 → 16:58, 0 → 그대로');
  ok(D(-36, { snapMin: 5 }) === KST(2026, 11, 21, 17, 35) && D(NaN) === C && D(Infinity) === C, 'snapMin 5 → 17:35, 숫자가 아니면 그대로');
  const d2 = R.dragTimeMs(C + 23456, -10);
  ok(d2 % 60000 === 0, `초 · 밀리초가 붙은 시각도 결과는 분 경계 위(${d2 % 60000})`);

  console.log('\n[3] 일몰 표시');
  ok(near(R.markerX(C, KST(2026, 11, 21, 17, 17)), 210.6) && R.markerX(C, KST(2026, 11, 24, 17, 17)) === null && R.markerX(C, NaN) === null, '17:17 → 210.6, 사흘 뒤 → null, 숫자가 아니면 null');

  console.log('\n[4] 날짜 차');
  const now0 = KST(2026, 11, 21, 9, 0);
  ok(R.dayOffset(C, now0, 9) === 0 && R.dayOffset(C, KST(2026, 11, 20, 23, 50), 9) === 1 && R.dayOffset(C, KST(2026, 11, 22, 0, 10), 9) === -1 && R.dayOffset(KST(2026, 11, 21, 0, 30), KST(2026, 11, 20, 23, 50), 9) === 1, '날짜 차(자정 경계 포함)');
  ok(R.shiftDays(C, 1) === KST(2026, 11, 22, 17, 4) && R.shiftDays(C, -1) === KST(2026, 11, 20, 17, 4), 'shiftDays');

  console.log('\n[5] 날짜 글');
  const L = (n, l) => R.dateLabel(R.shiftDays(C, n), C, 9, l);
  ok(J([0, -1, 1].map(n => L(n, 'ko'))) === J(['오늘', '어제', '내일']) && J([0, -1, 1].map(n => L(n, 'en'))) === J(['Today', 'Yesterday', 'Tomorrow']) && J([0, -1, 1].map(n => L(n, 'ja'))) === J(['今日', '昨日', '明日']), '오늘 · 어제 · 내일');
  ok(L(2, 'ko') === '11.23 월' && L(2, 'en') === 'Mon 11/23' && L(2, 'ja') === '11/23(月)' && R.timeText(C, 9) === '17:04', '그 밖의 날짜 · 시각 글');

  ok(typeof R.dateShort === 'function' && R.dateShort(C, 9, 'ko') === '11.21 토' && R.dateShort(C, 9, 'en') === 'Sat 11/21' && R.dateShort(C, 9, 'ja') === '11/21(土)' && R.dateShort(R.shiftDays(C, 2), 9, 'ko') === '11.23 월' && R.dateShort(R.shiftDays(C, 2), 9, 'ko') === L(2, 'ko'), '날짜 줄이 오늘이어도 날짜 자체: dateShort');

  console.log('\n[6] 일주일 줄');
  const W = R.weekStrip(C, C, 9, 'ko');
  ok(W.length === 7 && J(W.map(w => w.day)) === J([19, 20, 21, 22, 23, 24, 25]) && J(W.map(w => w.weekday)) === J(['목', '금', '토', '일', '월', '화', '수']) && J(W.map(w => w.offset)) === J([-2, -1, 0, 1, 2, 3, 4]), '날짜 · 요일 · offset');
  ok(J(W.map(w => w.selected)) === J([false, false, true, false, false, false, false]) && W[0].ms === R.shiftDays(C, -2) && W[6].ms === R.shiftDays(C, 4), '고른 칸 · 첫 칸과 마지막 칸의 시각');
  ok(J(R.weekStrip(C, C, 9, 'en').map(w => w.weekday)) === J(['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']) && J(R.weekStrip(C, C, 9, 'ja').map(w => w.weekday)) === J(['木', '金', '土', '日', '月', '火', '水']), '영어 · 일본어 요일');
  const Wn = R.weekStrip(C, KST(2026, 11, 21, 9, 0), 9, 'ko');
  ok(Wn[2].ms === C && Wn[0].ms === R.shiftDays(C, -2) && Wn[2].selected, '지금의 시각이 달라도 칸의 시각은 고른 시각을 따른다');
  const W2 = R.weekStrip(R.shiftDays(C, 2), C, 9, 'ko');
  ok(J(W2.map(w => w.selected)) === J([false, false, false, false, true, false, false]), '고른 것이 11-23 이면 다섯째 칸');

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n통과 — pass ${pass}`);
  process.exit(fail ? 1 : 0);
})();
