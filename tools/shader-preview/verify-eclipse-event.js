/**
 * **월식 이벤트 모드의 켜짐 규칙과 글(`src/utils/eclipseEvent.ts`)이 맞는가** — 순수 계산 판정. 브라우저 · 네트워크 불필요.
 * 월식 접촉 시각은 `verify-lunar-eclipse.js`(NASA), 단계 · 가시성 · 노출은 `verify-eclipse-plan.js` 가 판정했다. 여기서는 모드 줄의 "이벤트" 가 **언제 나타나는가**와 화면 글을 본다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 함수 `eclipseEventFor(nowMs, latDeg, lonDeg)` → `{ eclipse, plan, now }` 또는 null.
 *   켜짐 규칙(계획 문서 "월식 같은 날에만, 관측지에서 달이 떠 있는 식만"): 그 시각 앞뒤의 월식(`nextLunarEclipse(now − 6 시간)`)에 대해
 *   (a) 지금이 `p1 − 24 시간` 이상 · `p4` 이하(준비는 하루 전부터, 끝나면 사라짐) 이고,
 *   (b) 그 자리에서 달이 식 중 한 번이라도 뜨며(`plan.visible`),
 *   (c) 달이 지는 때(`visibleToMs`)가 아직 오지 않았다(지금 이후에 볼 것이 남음)일 때만 켜진다. `now` 는 `stageAt(plan, nowMs)`.
 * 손계산 기준(2025-03-14 개기, NASA 가장 깊은 때 06:58:41 UT, 길이 반그림자 362.6 분 → p1 = 가장 깊은 때 − 181.3 분 ≈ 03:57:23 UT, p4 ≈ 09:59:59 UT):
 *   - 뉴욕(40.71, −74.0): p1 − 25 시간 → null(하루 넘게 남음) · p1 − 23 시간 → 켜짐, `now.phase` = 'before', 남은 23 시간(±2 분) · 가장 깊은 때 → 켜짐, 단계 'total'(가장 깊은 때는 개기 u2~u3 사이) · 가장 깊은 때 + 2 시간 → 켜짐(이미 가장 깊은 때가 지났어도 진행 중인 식을 찾는다), 단계 'penumbral'(개기 끝 가장 깊은 때 +32.7 분, 부분 끝 +109.2 분이라 +120 분은 부분 끝 뒤의 반그림자) · p4 + 1 분 → null.
 *   - 도쿄(35.68, 139.69) 2025-09-07 개기(가장 깊은 때 18:11:43 UT, 반그림자 길이 326.7 분): 반대점 손계산으로 달이 지는 때 ≈ 가장 깊은 때 + 140 분(±12 분). 가장 깊은 때 + 120 분 → 켜짐(아직 20 분 남음), 가장 깊은 때 + 150 분 → null(달이 이미 짐 — 식은 +163 분까지 가지만 볼 수 없다).
 *   - 적도 경도 60°(2025-03-14 식 내내 달이 지평선 아래, verify-eclipse-plan 의 손계산) → 식 한가운데에도 null.
 *   - 식이 없는 날(2026-06-01 — 이 날 근처 6 시간 안에 식이 없다, 2026-08-28 이 다음 식) → null. 입력이 숫자가 아니면 null.
 * 글: `stageName(key, lang)`: ko 반그림자 · 부분식 · 개기식 / en Penumbral · Partial · Total / ja 半影 · 部分食 · 皆既食.
 *   `formatRemain(ms)`: 음수 · 0 → "0:00", 59 초 → "0:59", 10 분 → "10:00", 1 시간 → "1:00:00", 1 시간 2 분 5 초 → "1:02:05", 숫자가 아니면 "--:--".
 */
const path = require('path');
const { PREVIEW } = require('./paths');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const MIN = 60000, HOUR = 3600000;
const utc = (s) => Date.parse(s + 'Z');

(async () => {
  const L = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'lunarEclipse.js'));
  const E = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'eclipseEvent.js')).catch(() => null);
  const g1 = utc('2025-03-14T06:58:41'), g2 = utc('2025-09-07T18:11:43');
  const e1 = L.lunarEclipseAt(g1);
  const ev = (t, lat, lon) => (E && E.eclipseEventFor ? E.eclipseEventFor(t, lat, lon) : null);

  console.log('[1] 켜짐 규칙(뉴욕 2025-03-14)');
  ok(ev(e1.p1Ms - 25 * HOUR, 40.71, -74.0) === null, 'p1 − 25 시간: 꺼짐(하루 넘게 남음)');
  const a = ev(e1.p1Ms - 23 * HOUR, 40.71, -74.0);
  ok(!!a && a.now.phase === 'before' && Math.abs(a.now.remainingMs - 23 * HOUR) <= 2 * MIN, 'p1 − 23 시간: 켜짐, 식 전, 남은 23 시간');
  const b = ev(g1, 40.71, -74.0);
  ok(!!b && b.now.phase === 'in' && b.now.stage.key === 'total', '가장 깊은 때: 켜짐, 단계 개기');
  const c = ev(g1 + 120 * MIN, 40.71, -74.0);
  ok(!!c && c.now.phase === 'in' && c.now.stage.key === 'penumbral', '가장 깊은 때 + 2 시간(이미 지난 뒤에도 진행 중인 식을 찾는다): 켜짐, 단계 반그림자');
  ok(ev(e1.p4Ms + MIN, 40.71, -74.0) === null, 'p4 + 1 분: 꺼짐(끝나면 사라짐)');

  console.log('\n[2] 달이 지는 곳 · 안 뜨는 곳');
  ok(!!ev(g2 + 120 * MIN, 35.68, 139.69), '도쿄 2025-09-07 가장 깊은 때 + 120 분: 켜짐(달이 아직 떠 있음)');
  ok(ev(g2 + 150 * MIN, 35.68, 139.69) === null, '도쿄 가장 깊은 때 + 150 분: 꺼짐(달이 이미 짐)');
  ok(ev(g1, 0, 60) === null, '적도 경도 60°(식 내내 달이 아래): 가장 깊은 때에도 꺼짐');

  console.log('\n[3] 식이 없는 날 · 틀린 입력');
  ok(ev(utc('2026-06-01T12:00:00'), 40.71, -74.0) === null, '2026-06-01: 꺼짐');
  ok(ev(NaN, 40, 0) === null && ev(g1, NaN, 0) === null && ev(g1, 40, Infinity) === null, '숫자가 아닌 입력: null');

  console.log('\n[4] 글');
  const S = E && E.stageName;
  ok(!!S && S('penumbral', 'ko') === '반그림자' && S('partial', 'ko') === '부분식' && S('total', 'ko') === '개기식' && S('penumbral', 'en') === 'Penumbral' && S('partial', 'en') === 'Partial' && S('total', 'en') === 'Total' && S('penumbral', 'ja') === '半影' && S('partial', 'ja') === '部分食' && S('total', 'ja') === '皆既食', '단계 이름 ko · en · ja');
  const F = E && E.formatRemain;
  ok(!!F && F(-5) === '0:00' && F(0) === '0:00' && F(59000) === '0:59' && F(10 * MIN) === '10:00' && F(HOUR) === '1:00:00' && F(HOUR + 2 * MIN + 5000) === '1:02:05' && F(NaN) === '--:--', '남은 시간 글: 0:00 · 0:59 · 10:00 · 1:00:00 · 1:02:05 · --:--');

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
