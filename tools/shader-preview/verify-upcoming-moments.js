/**
 * **"다가오는 좋은 순간" 카드 고르기(`upcomingMoments.ts`)가 규칙대로인가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * 카드가 02 예보와 다른 판정을 보이거나 이미 지난 순간·예보 없는 순간을 올리면 "좋은 순간" 이 거짓말이 됩니다.
 * 합성한 판정 목록으로 규칙을 하나씩 확인합니다. 판정 순서만은 앱의 소스(`PredictionCard.VERDICT_ORDER`)를 직접 읽어 대어 봅니다.
 *
 * 먼저 정한 줄(돌려 보기 전):
 *  1. 목업과 같은 장면(지금 16:42): 오늘 일몰 좋음 · 내일 일출 보통/일몰 아쉬움 · 모레 일출 아쉬움/일몰 좋음 · 3일 뒤 둘 다 훌륭함
 *     → 카드 둘: [내일 일출 보통 07:21, 모레 일몰 좋음 17:03]. 오늘(0)과 3일 뒤는 올리지 않는다.
 *  2. 하루 하나: 더 좋은 쪽, 같으면 점수가 높은 쪽(점수가 없으면 가장 낮게), 그래도 같으면 일몰. 보통 미만(아쉬움·흐림)만 있는 날은 카드 없음, 전부 그러면 [].
 *  3. 예보 없는 출몰(quality null)은 건너뛰고 다른 쪽이 기준을 넘으면 그쪽을 올린다. 3일 안(high) 아닌 등급은 건너뛴다.
 *  4. 이미 지난 출몰은 건너뛴다(지금이 내일 일몰 뒤면 내일은 없고 모레만).
 *  5. 카드 시각은 가장 붉을 때(peakAt), 없으면 출몰 시각. id 는 `${noonMs}_${side}`. 이유 문장(description)은 그대로 전해지고 없으면 null.
 *  6. max 로 개수를 자른다(1 이면 첫 카드만). 빈 목록은 [].
 *  7. 날짜 정오 간격이 23·25시간(서머타임 날)이어도 날짜 번호가 맞다(내일 = 1, 모레 = 2).
 *  8. 판정 순서가 앱 소스의 `VERDICT_ORDER` 와 같고(Overcast < Muted < Fair < Great < Epic), qualityLevel 은 1~5, null 은 0.
 *  9. `matchesFocus`: 같은 쪽이고 정오 차가 12시간 미만이면 true, 다른 쪽 · 12시간 이상 · focus 없음이면 false.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-upcoming-moments.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW, REPO_ROOT } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const DAY = 86400e3;
const hhmm = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(11, 16);

(async () => {
  const U = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'upcomingMoments.js'));

  const noon0 = Date.parse('2026-11-19T12:00:00+09:00');
  const ev = (side, iso, quality, o = {}) => ({
    side, at: new Date(iso), peakAt: o.peak ? new Date(o.peak) : null, score: o.score ?? 60,
    quality, tier: o.tier ?? 'high', source: quality ? 'forecast' : null, description: o.desc,
  });
  const day = (i, sunrise, sunset, noonShiftMs = 0) => ({ noonMs: noon0 + i * DAY + noonShiftMs, sunrise, sunset });
  const NOW = Date.parse('2026-11-19T16:42:00+09:00');

  const mock = () => [
    day(0, ev('sunrise', '2026-11-19T07:20:00+09:00', 'Fair'), ev('sunset', '2026-11-19T17:04:00+09:00', 'Great')),
    day(1, ev('sunrise', '2026-11-20T07:21:00+09:00', 'Fair'), ev('sunset', '2026-11-20T17:03:00+09:00', 'Muted')),
    day(2, ev('sunrise', '2026-11-21T07:22:00+09:00', 'Muted'), ev('sunset', '2026-11-21T17:03:00+09:00', 'Great')),
    day(3, ev('sunrise', '2026-11-22T07:23:00+09:00', 'Epic'), ev('sunset', '2026-11-22T17:02:00+09:00', 'Epic')),
  ];

  console.log('\n[1] 목업 장면');
  {
    const m = U.upcomingMoments(mock(), NOW);
    ok(m.length === 2, `카드 ${m.length} 장`);
    ok(m[0].dayOffset === 1 && m[0].side === 'sunrise' && m[0].quality === 'Fair' && hhmm(m[0].timeMs) === '07:21', `첫 카드: 내일(${m[0].dayOffset}) ${m[0].side} ${m[0].quality} ${hhmm(m[0].timeMs)}`);
    ok(m[1].dayOffset === 2 && m[1].side === 'sunset' && m[1].quality === 'Great' && hhmm(m[1].timeMs) === '17:03', `둘째 카드: 모레(${m[1].dayOffset}) ${m[1].side} ${m[1].quality} ${hhmm(m[1].timeMs)}`);
    ok(m.every(x => x.dayOffset >= 1 && x.dayOffset <= 2), '오늘(0)과 3일 뒤(훌륭함이어도)는 올리지 않는다');
  }

  console.log('\n[2] 하루 하나 · 보통 이상');
  {
    const tie = U.upcomingMoments([day(0, null, null), day(1, ev('sunrise', '2026-11-20T07:21:00+09:00', 'Great'), ev('sunset', '2026-11-20T17:03:00+09:00', 'Great'))], NOW);
    ok(tie.length === 1 && tie[0].side === 'sunset', `판정도 점수도 같으면 일몰(${tie[0] && tie[0].side})`);
    const byScore = U.upcomingMoments([day(0, null, null), day(1, ev('sunrise', '2026-11-20T07:21:00+09:00', 'Great', { score: 80 }), ev('sunset', '2026-11-20T17:03:00+09:00', 'Great', { score: 70 }))], NOW);
    ok(byScore[0].side === 'sunrise', `같은 판정이면 점수가 높은 쪽(일출 80 > 일몰 70): ${byScore[0].side}`);
    const byScore2 = U.upcomingMoments([day(0, null, null), day(1, ev('sunrise', '2026-11-20T07:21:00+09:00', 'Great', { score: 70 }), ev('sunset', '2026-11-20T17:03:00+09:00', 'Great', { score: 80 }))], NOW);
    ok(byScore2[0].side === 'sunset', `점수가 높은 쪽이 일몰이면 일몰: ${byScore2[0].side}`);
    const noScore = U.upcomingMoments([day(0, null, null), day(1, ev('sunrise', '2026-11-20T07:21:00+09:00', 'Great', { score: 60 }), (() => { const e = ev('sunset', '2026-11-20T17:03:00+09:00', 'Great'); e.score = null; return e; })())], NOW);
    ok(noScore[0].side === 'sunrise', `점수가 없는 쪽은 가장 낮게 센다: ${noScore[0].side}`);
    const levelFirst = U.upcomingMoments([day(0, null, null), day(1, ev('sunrise', '2026-11-20T07:21:00+09:00', 'Epic', { score: 50 }), ev('sunset', '2026-11-20T17:03:00+09:00', 'Great', { score: 99 }))], NOW);
    ok(levelFirst[0].side === 'sunrise', `판정이 점수보다 먼저(훌륭함 50 > 좋음 99): ${levelFirst[0].side}`);
    const rise = U.upcomingMoments([day(0, null, null), day(1, ev('sunrise', '2026-11-20T07:21:00+09:00', 'Epic'), ev('sunset', '2026-11-20T17:03:00+09:00', 'Great'))], NOW);
    ok(rise.length === 1 && rise[0].side === 'sunrise', `더 좋은 쪽이 일출이면 일출(${rise[0] && rise[0].side})`);
    const low = U.upcomingMoments([day(0, null, null), day(1, ev('sunrise', '2026-11-20T07:21:00+09:00', 'Muted'), ev('sunset', '2026-11-20T17:03:00+09:00', 'Overcast')), day(2, ev('sunrise', '2026-11-21T07:22:00+09:00', 'Muted'), null)], NOW);
    ok(low.length === 0, '아쉬움·흐림만 있는 날은 카드가 없다(전부 그러면 빈 목록)');
    const fair = U.upcomingMoments([day(0, null, null), day(1, ev('sunrise', '2026-11-20T07:21:00+09:00', 'Muted'), ev('sunset', '2026-11-20T17:03:00+09:00', 'Fair'))], NOW);
    ok(fair.length === 1 && fair[0].quality === 'Fair', '보통은 기준을 넘는다(경계 포함)');
  }

  console.log('\n[3] 예보 없음 · 등급');
  {
    const a = U.upcomingMoments([day(0, null, null), day(1, ev('sunrise', '2026-11-20T07:21:00+09:00', null), ev('sunset', '2026-11-20T17:03:00+09:00', 'Fair')), day(2, ev('sunrise', '2026-11-21T07:22:00+09:00', null), ev('sunset', '2026-11-21T17:03:00+09:00', null))], NOW);
    ok(a.length === 1 && a[0].dayOffset === 1 && a[0].side === 'sunset', '예보 없는 쪽은 건너뛰고 다른 쪽을 올린다. 둘 다 없는 날은 카드가 없다');
    const t = U.upcomingMoments([day(0, null, null), day(1, ev('sunrise', '2026-11-20T07:21:00+09:00', 'Epic', { tier: 'medium' }), ev('sunset', '2026-11-20T17:03:00+09:00', 'Fair'))], NOW);
    ok(t.length === 1 && t[0].side === 'sunset', '3일 안(high) 아닌 등급은 건너뛴다');
    ok(U.upcomingMoments([day(0, null, null), day(1, null, null)], NOW).length === 0, '출몰이 없는 날(null)은 카드가 없다');
  }

  console.log('\n[4] 지난 출몰');
  {
    const late = Date.parse('2026-11-20T18:00:00+09:00');   // 내일 일몰 뒤
    const m = U.upcomingMoments(mock(), late);
    ok(m.length === 1 && m[0].dayOffset === 2, `지금이 내일 일몰 뒤면 모레만(${m.map(x => x.dayOffset).join()})`);
  }

  console.log('\n[5] 시각 · id · 이유');
  {
    const d = [day(0, null, null), day(1, ev('sunrise', '2026-11-20T07:21:00+09:00', 'Great', { peak: '2026-11-20T07:15:00+09:00', desc: 'Thin high clouds.' }), null), day(2, null, ev('sunset', '2026-11-21T17:03:00+09:00', 'Fair'))];
    const m = U.upcomingMoments(d, NOW);
    ok(hhmm(m[0].timeMs) === '07:15' && hhmm(m[0].atMs) === '07:21', `카드 시각은 가장 붉을 때 ${hhmm(m[0].timeMs)} (출몰 ${hhmm(m[0].atMs)})`);
    ok(hhmm(m[1].timeMs) === '17:03' && m[1].description === null, '가장 붉을 때가 없으면 출몰 시각, 이유가 없으면 null');
    ok(m[0].description === 'Thin high clouds.', '이유 문장은 그대로 전해진다');
    ok(m[0].id === `${noon0 + DAY}_sunrise` && m[1].id === `${noon0 + 2 * DAY}_sunset`, `id: ${m[0].id}`);
  }

  console.log('\n[6] 개수');
  {
    ok(U.upcomingMoments(mock(), NOW, { max: 1 }).length === 1 && U.upcomingMoments(mock(), NOW, { max: 1 })[0].dayOffset === 1, 'max 1 이면 첫 카드만');
    ok(U.upcomingMoments([], NOW).length === 0, '빈 목록은 []');
  }

  console.log('\n[7] 서머타임 날');
  {
    const d = [day(0, null, null), day(1, ev('sunrise', '2026-11-20T07:21:00+09:00', 'Great'), null, -3600e3), day(2, null, ev('sunset', '2026-11-21T17:03:00+09:00', 'Great'), +3600e3)];   // 정오 간격 23시간 · 25시간
    const m = U.upcomingMoments(d, NOW);
    ok(m.length === 2 && m[0].dayOffset === 1 && m[1].dayOffset === 2, `정오 간격이 23·25시간이어도 날짜 번호가 맞다(${m.map(x => x.dayOffset).join()})`);
  }

  console.log('\n[8] 판정 순서');
  {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'components', 'SunsetSimulation', 'PredictionCard.tsx'), 'utf8');
    const m = /VERDICT_ORDER:\s*Quality\[\]\s*=\s*\[([^\]]*)\]/.exec(src);
    const appOrder = m ? m[1].split(',').map(x => x.replace(/['"\s]/g, '')).filter(Boolean) : [];
    ok(appOrder.length === 5 && appOrder.join() === U.QUALITY_ORDER.join(), `앱 소스의 순서 ${appOrder.join(' < ')} 와 같다`);
    ok(U.QUALITY_ORDER.every((q, i) => U.qualityLevel(q) === i + 1) && U.qualityLevel(null) === 0 && U.qualityLevel(undefined) === 0, 'qualityLevel 1~5, null · undefined 는 0');
  }

  console.log('\n[9] 강조할 칸');
  {
    const f = { noonMs: noon0 + DAY, side: 'sunset' };
    ok(U.matchesFocus({ noonMs: noon0 + DAY }, 'sunset', f) && U.matchesFocus({ noonMs: noon0 + DAY + 11 * 3600e3 }, 'sunset', f), '같은 쪽 · 정오 차 11시간 이내는 true');
    ok(!U.matchesFocus({ noonMs: noon0 + DAY }, 'sunrise', f) && !U.matchesFocus({ noonMs: noon0 + DAY + 12 * 3600e3 }, 'sunset', f) && !U.matchesFocus({ noonMs: noon0 + 2 * DAY }, 'sunset', f), '다른 쪽 · 정오 차 12시간 · 다른 날은 false');
    ok(!U.matchesFocus({ noonMs: noon0 }, 'sunset', null) && !U.matchesFocus({ noonMs: noon0 }, 'sunset', undefined), 'focus 가 없으면 false');
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
