/**
 * **하단 날짜·시간 막대의 순수 논리** 합격 판정(§143). 브라우저가 필요 없습니다.
 *
 * 사용: node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-time-bar.js
 *
 * 무엇을 재나:
 *  [1] 리드타임 등급 — 경계(지금 · +72h · +7d · +16d · 1940)에서 정확히 바뀌는가.
 *  [2] 등급 띠 — 0~100 을 빈틈·겹침 없이 덮고, 등급이 과거 → 높음 → 보통 → 낮음 → 없음 순으로만 가는가.
 *      과거의 해는 통째로 과거, 먼 미래의 해는 통째로 없음. 띠의 경계 위치가 경계 시각과 일치하는가(표본이 아니라 해석적).
 *  [3] 날짜 슬라이더 사상이 기존 `dateSlider.dateToDatePercent` 와 같은가(두 벌이 갈라지지 않게).
 *  [4] ±1일·±1시간·±1년 — 자정 넘김, 윤일(2/29 → 평년 2/28), 범위 끝 고정, 왕복.
 *  [5] 커밋 간격 조절 — 첫 값 즉시, 이어지는 값은 간격마다 마지막 것만, flush 는 즉시, 손을 뗀 값이 반드시 나감.
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

(async () => {
  const T = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'timeBar.js'));
  const D = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'dateSlider.js'));
  const NOW = Date.UTC(2026, 9, 16, 4, 33);   // 2026-10-16 13:33 KST
  const TZ = 9;
  const H = T.MS_HOUR, DAY = T.MS_DAY;

  console.log('[1] 리드타임 등급 경계');
  ok(T.tierAt(NOW - 1, NOW) === 'past', '지금 직전은 past');
  ok(T.tierAt(NOW, NOW) === 'high', '지금 정각부터 high');
  ok(T.tierAt(NOW + 72 * H - 1, NOW) === 'high' && T.tierAt(NOW + 72 * H, NOW) === 'medium', '72시간에서 high → medium');
  ok(T.tierAt(NOW + 168 * H - 1, NOW) === 'medium' && T.tierAt(NOW + 168 * H, NOW) === 'low', '7일에서 medium → low');
  ok(T.tierAt(NOW + 384 * H - 1, NOW) === 'low' && T.tierAt(NOW + 384 * H, NOW) === 'none', '16일에서 low → none');
  ok(T.tierAt(T.DATA_START_MS - 1, NOW) === 'none' && T.tierAt(T.DATA_START_MS, NOW) === 'past', '1940-01-01 에서 none → past');
  const w = T.dataWindow(NOW);
  ok(w.fromMs === T.DATA_START_MS && w.toMs === NOW + 16 * DAY, '데이터 기간 = 1940 ~ 지금 + 16일');

  console.log('\n[2] 등급 띠');
  const rank = t => T.TIER_ORDER.indexOf(t);
  const checkSegs = (segs, label) => {
    let cover = segs.length > 0 && near(segs[0].from, 0) && near(segs[segs.length - 1].to, 100);
    let tight = true, mono = true, merged = true;
    for (let i = 0; i < segs.length; i++) {
      if (!(segs[i].to > segs[i].from)) tight = false;
      if (i > 0) {
        if (!near(segs[i].from, segs[i - 1].to)) tight = false;
        if (rank(segs[i].tier) <= rank(segs[i - 1].tier)) { mono = false; if (segs[i].tier === segs[i - 1].tier) merged = false; }
      }
    }
    ok(cover, `${label}: 0~100 을 덮는다`);
    ok(tight, `${label}: 빈틈·겹침 없음`);
    ok(mono && merged, `${label}: 등급이 과거 → 높음 → 보통 → 낮음 → 없음 순`);
  };
  const y2026 = T.yearTierSegments(2026, TZ, NOW);
  checkSegs(y2026, '2026년');
  ok(y2026.map(s => s.tier).join() === 'past,high,medium,low,none', `2026년 띠 = ${y2026.map(s => s.tier).join('→')}`);
  const nowP = T.yearPct(NOW, 2026, TZ);
  ok(near(y2026[0].to, nowP, 1e-6), `past → high 경계가 "지금" 위치(${nowP.toFixed(3)}%)`);
  ok(near(y2026[1].to, T.yearPct(NOW + 72 * H, 2026, TZ)) && near(y2026[2].to, T.yearPct(NOW + 168 * H, 2026, TZ))
    && near(y2026[3].to, T.yearPct(NOW + 384 * H, 2026, TZ)), '나머지 경계도 해당 시각의 위치');
  const y2019 = T.yearTierSegments(2019, TZ, NOW), y2040 = T.yearTierSegments(2040, TZ, NOW);
  ok(y2019.length === 1 && y2019[0].tier === 'past', '과거의 해는 통째로 past');
  ok(y2040.length === 1 && y2040[0].tier === 'none', '먼 미래의 해는 통째로 none');
  const y1930 = T.yearTierSegments(1930, TZ, NOW);
  ok(y1930.length === 1 && y1930[0].tier === 'none', '1940 이전은 통째로 none');
  const y1940 = T.yearTierSegments(1940, TZ, NOW);
  ok(y1940.every(s => s.tier === 'past' || s.tier === 'none') && y1940[y1940.length - 1].tier === 'past', '1940년은 past(경계 걸침 허용)');
  // 연말 걸침: 2026-12-25 에 지금을 두면 다음 해 앞쪽이 high/medium 이어야 한다
  const NOW2 = Date.UTC(2026, 11, 29, 3, 0);
  const y2027 = T.yearTierSegments(2027, TZ, NOW2);
  ok(y2027[0].tier === 'high' || y2027[0].tier === 'medium', `연말에는 다음 해 앞쪽도 예보 구간(${y2027.map(s => s.tier).join('→')})`);
  checkSegs(y2027, '2027년(연말 기준)');

  // 하루 띠: 오늘은 past → high, 내일은 통째로 high, +5일은 medium, +10일은 low, +20일 none
  const dayStart = d => T.localDayStartMs(NOW + d * DAY, TZ);
  const today = T.dayTierSegments(dayStart(0), NOW);
  checkSegs(today, '오늘');
  ok(today.map(s => s.tier).join() === 'past,high', `오늘 = ${today.map(s => s.tier).join('→')}`);
  ok(near(today[0].to, T.nowPctInDay(NOW, dayStart(0)), 1e-6), '오늘의 past/high 경계 = 지금 위치(13:33 → 56.25%)');
  const tier1 = d => T.dayTierSegments(dayStart(d), NOW).map(s => s.tier).join('→');
  ok(tier1(1) === 'high' || tier1(1) === 'high→medium', `내일 = ${tier1(1)}`);
  ok(tier1(5).includes('medium'), `+5일 = ${tier1(5)}`);
  ok(tier1(10).includes('low'), `+10일 = ${tier1(10)}`);
  ok(tier1(30) === 'none', `+30일 = ${tier1(30)}`);
  ok(tier1(-3) === 'past', `-3일 = ${tier1(-3)}`);
  ok(T.nowPctInDay(NOW, dayStart(1)) === null && T.nowPctInYear(NOW, 2027, TZ) === null, '"지금" 표시는 그 범위 안일 때만');

  console.log('\n[3] 날짜 슬라이더 사상 = dateSlider.dateToDatePercent');
  let worst = 0, worstNoon = 0;
  for (const [y, m, d, hh] of [[2026, 0, 1, 12], [2026, 5, 15, 3], [2026, 11, 31, 22], [2024, 1, 29, 8], [2024, 11, 31, 1], [2025, 6, 4, 23]]) {
    const t = Date.UTC(y, m, d, hh) - TZ * H;
    const ref = D.dateToDatePercent(new Date(t), TZ);
    worst = Math.max(worst, Math.abs(T.dayIndexPct(t, TZ) - ref));
    const noon = Date.UTC(y, m, d, 12) - TZ * H;   // 정오에서는 연속 위치(띠 계산용)도 같아야 한다
    worstNoon = Math.max(worstNoon, Math.abs(T.yearPct(noon, y, TZ) - ref));
  }
  ok(worst < 1e-9, `손잡이 위치(하루 한 칸) 일치 — 시각과 무관 (최악 차 ${worst.toExponential(1)})`);
  ok(worstNoon < 1e-9, `정오에서는 띠 계산의 연속 위치도 같다 (최악 차 ${worstNoon.toExponential(1)})`);
  ok(near(T.yearPct(T.yearNoon0Ms(2026, TZ), 2026, TZ), 0) && near(T.yearPct(T.yearNoon0Ms(2026, TZ) + 364 * DAY, 2026, TZ), 100), '1/1 정오 = 0 %, 12/31 정오 = 100 %');
  ok(T.daysInYear(2024) === 366 && T.daysInYear(2100) === 365 && T.daysInYear(2000) === 366, '윤년 판정(2100 은 평년)');

  console.log('\n[4] ±1일 · ±1시간 · ±1년');
  const loc = t => new Date(t + TZ * H).toISOString().slice(0, 16).replace('T', ' ');
  const t0 = Date.UTC(2026, 9, 16, 4, 33);   // 10/16 13:33 KST
  ok(loc(T.shiftDays(t0, 1)) === '2026-10-17 13:33' && loc(T.shiftDays(t0, -1)) === '2026-10-15 13:33', `±1일 시각 유지 (${loc(T.shiftDays(t0, 1))})`);
  ok(loc(T.shiftHours(t0, 1)) === '2026-10-16 14:33' && loc(T.shiftHours(t0, -1)) === '2026-10-16 12:33', '±1시간');
  const late = Date.UTC(2026, 9, 16, 14, 30);  // KST 23:30
  ok(loc(T.shiftHours(late, 1)) === '2026-10-17 00:30', `23:30 + 1시간 → 다음 날 00:30 (${loc(T.shiftHours(late, 1))})`);
  const early = Date.UTC(2026, 9, 15, 15, 20); // KST 00:20 (10/16)
  ok(loc(T.shiftHours(early, -1)) === '2026-10-15 23:20', `00:20 − 1시간 → 전날 23:20 (${loc(T.shiftHours(early, -1))})`);
  ok(loc(T.shiftYears(t0, TZ, 1)) === '2027-10-16 13:33' && loc(T.shiftYears(t0, TZ, -10)) === '2016-10-16 13:33', '±N년 월·일·시각 유지');
  const leap = Date.UTC(2024, 1, 29, 3, 0);
  ok(loc(T.shiftYears(leap, TZ, 1)) === '2025-02-28 12:00', `2/29 + 1년 → 평년 2/28 (${loc(T.shiftYears(leap, TZ, 1))})`);
  ok(loc(T.shiftYears(leap, TZ, 4)) === '2028-02-29 12:00', `2/29 + 4년 → 2/29 (${loc(T.shiftYears(leap, TZ, 4))})`);
  ok(T.shiftYears(t0, TZ, -500) === T.DATA_START_MS && T.shiftYears(t0, TZ, 500) === T.MAX_MS, '범위 끝에서 멈춘다(1940 · 2100)');
  ok(T.shiftDays(T.DATA_START_MS, -1) === T.DATA_START_MS && T.shiftHours(T.MAX_MS, 5) === T.MAX_MS, '일·시간도 범위 끝에서 멈춘다');
  ok(T.shiftDays(T.shiftDays(t0, 7), -7) === t0 && T.shiftHours(T.shiftHours(t0, 5), -5) === t0, '일·시간 왕복');
  // 시각 부호: 서쪽 지역(−5)에서도 지역 기준
  const ny = Date.UTC(2026, 2, 1, 4, 30);     // NY(−5) 2026-02-28 23:30
  const loc5 = t => new Date(t - 5 * H).toISOString().slice(0, 16).replace('T', ' ');
  ok(loc5(T.shiftYears(ny, -5, 1)) === '2027-02-28 23:30', `서쪽 지역도 지역 날짜 기준 (${loc5(T.shiftYears(ny, -5, 1))})`);
  ok(loc(T.withLocalMinutes(t0, TZ, 6 * 60 + 5)) === '2026-10-16 06:05' && loc(T.withLocalMinutes(t0, TZ, 99999)) === '2026-10-16 23:59', '시간 슬라이더: 지역 날짜 유지 · 분 설정 · 하루 끝에서 멈춤');
  ok(T.localDayKey(t0, TZ) === '2026-10-16' && T.localDayKey(late, TZ) === '2026-10-16' && T.localDayKey(late + 31 * 60000, TZ) === '2026-10-17', '지역 날짜 키(자정에서 바뀜)');
  ok(T.localDayStartMs(t0, TZ) === Date.UTC(2026, 9, 15, 15), '지역 자정 = 15:00Z');

  console.log('\n[4b] 낮·노을·밤 구간');
  {
    const seg = T.dayPhaseSegments(6 * 60 + 30, 18 * 60 + 10);   // 06:30 · 18:10
    const key = seg.map(x => `${x.phase}:${x.from}-${x.to}`).join(' ');
    ok(key === 'night:0-330 golden:330-480 day:480-1000 golden:1000-1150 night:1150-1440', `구간 = ${key}`);
    ok(seg[0].from === 0 && seg[seg.length - 1].to === 1440 && seg.every((x, i) => i === 0 || x.from === seg[i - 1].to), '0~1440 을 빈틈없이 덮는다');
    const fb = T.dayPhaseSegments(null, null).map(x => x.phase).join();
    ok(fb === 'night,golden,day,golden,night', `일출·일몰이 없으면 06:00·18:30 로 (${fb})`);
    const edge = T.dayPhaseSegments(30, 1400);   // 골든 창이 하루 밖으로 나가는 날
    ok(edge[0].from === 0 && edge[edge.length - 1].to === 1440 && edge.every(x => x.to > x.from), '창이 하루 밖으로 나가도 0~1440 안에서 정리');
    ok(T.phaseAtMinute(330, 390, 1090) === 'golden' && T.phaseAtMinute(120, 390, 1090) === 'night' && T.phaseAtMinute(700, 390, 1090) === 'day', '분 → 때');
    const ds = T.localDayStartMs(t0, TZ);
    ok(T.minuteInDay(ds + 90 * 60000, ds) === 90 && T.minuteInDay(ds + 1440 * 60000, ds) === null && T.minuteInDay(ds - 1, ds) === null && T.minuteInDay(null, ds) === null, '그날 안의 분 · 밖은 null');
  }

  console.log('\n[5] 커밋 간격 조절');
  const log = [];
  let clock = 0; const timers = [];
  const env = {
    now: () => clock,
    setTimeout: (fn, ms) => { const t = { at: clock + ms, fn, live: true }; timers.push(t); return t; },
    clearTimeout: t => { if (t) t.live = false; },
  };
  const advance = ms => {
    const end = clock + ms;
    for (;;) {
      const next = timers.filter(t => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      clock = next.at; next.live = false; next.fn();
    }
    clock = end;
  };
  const th = T.createCommitThrottle(v => log.push([clock, v]), 100, env);
  th.push(1);
  ok(log.length === 1 && log[0][1] === 1, '첫 값은 즉시 나간다');
  advance(10); th.push(2); advance(10); th.push(3); advance(10); th.push(4);
  ok(log.length === 1, '간격 안의 값은 모아 둔다');
  advance(100);
  ok(log.length === 2 && log[1][1] === 4 && log[1][0] === 100, `간격 끝에 마지막 값(4)만 나간다 (${JSON.stringify(log[1])})`);
  advance(500); th.push(5);
  ok(log.length === 3 && log[2][1] === 5, '충분히 쉰 뒤의 값은 즉시');
  th.push(6); th.flush();
  ok(log.length === 4 && log[3][1] === 6, 'flush 는 남은 값을 즉시 낸다(손을 뗄 때)');
  advance(1000);
  ok(log.length === 4, 'flush 뒤에 중복으로 나가지 않는다');
  th.flush();
  ok(log.length === 4, '남은 값이 없으면 flush 는 아무것도 안 한다');
  th.push(7); th.push(8); th.cancel(); advance(1000);
  ok(log.length === 5 && log[4][1] === 7, 'cancel 은 모아 둔 값을 버린다');
  // 초당 호출 수: 1ms 간격 입력 3초 → 약 30회 이하
  log.length = 0; clock = 10000; timers.length = 0;
  const th2 = T.createCommitThrottle(v => log.push(v), 100, env);
  for (let i = 0; i < 3000; i++) { th2.push(i); advance(1); }
  th2.flush();
  ok(log.length <= 32 && log[log.length - 1] === 2999, `1 ms 간격 3000 입력 → 커밋 ${log.length}회(≈ 초당 10회), 마지막 값 보존`);

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
