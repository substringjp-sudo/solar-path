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
 * 10. `starMoment`("오늘 밤 별 보기" 카드): 맑은 밤(운량 10 %, 빛 지도 6.0, 달 없음)이면 카드이고 한계등급이 `starLimit` 과 같다. 운량 50 % 는 카드, 50.01 % 와 80 % 는 없다
 *     (구름 문턱은 `cloudRating`: 20 좋음 · 50 보통). 운량을 모르면 없다(NaN 도 없다). 한계등급 3 은 경계라 부동소수 오차 1e-6 은 봐준다:
 *     도시 하늘 빛 지도 3.0(앱이 내는 가장 낮은 값)에 달 90 % 55° 는 2.86 이라 없고, 같은 도시에 달이 없으면 3.0 이라 있고, 빛 지도 2.9 면 없다.
 *     별 보는 시각이 지금보다 5분 안(이미 지났어도)이면 fromNow, 6분 뒤면 아니다. timeMs 가 NaN 이면 없다. 문턱 상수는 3 과 5분.
 *  9. `matchesFocus`: 같은 쪽이고 정오 차가 12시간 미만이면 true, 다른 쪽 · 12시간 이상 · focus 없음이면 false.
 * 11. 앱 연결(소스 정규식, 2026-11-20): 별 카드는 규칙 없이 화면에서 켜지면 안 되므로 (a) `SkyScreen.tsx` 가 `starMoment(` 를 부르고 그 시각 계산을 **지금**(`new Date()`)으로 한다
 *     (보고 있는 날짜 `calcDate` 가 아니다: "오늘 밤" 카드) (b) 시트가 닫혔거나 전문가 모드(`cardsOn` 거짓)면 계산 없이 null (c) 카드 줄은 `moments` 나 `star` 가 있으면 그린다
 *     (d) `UpcomingCards` 에 `star` 와 `onStarPress` 를 넘기고, 누르면 02 학습의 별 보기 과정을 `star.timeMs` 시각으로 연다(`learnAt(..., 'why', 'stars', star.timeMs)`)
 *     (e) 시트에는 하늘 일정 줄이 없다(`simpleEventRows` · `combinedEventList` · `eventItems` 가 없다) — 일정은 02 학습이 보인다. 그래서 별 카드와 같은 때의 "은하수" 줄이 겹칠 일이 없다
 *     (f) `UpcomingCards.tsx` 는 별 카드를 날 카드(`moments.map`)보다 앞에 그리고 접근성 글에
 *     "계산 과정 보기" 를 넣으며, 카드가 셋 이상이면 안쪽 여백을 줄이고(`dense`) 가운데 줄을 두 줄까지 접는다(360 폭 폰에서 "Sunset Good" 이 "Sunset G…" 로 잘려 판정 낱말이 안 보이던 것을 막음).
 *
 *     (2026-11-20 학습 페이지로 합쳐지며 (d) · (e) 를 새 연결에서 읽도록 옮겼습니다. (d) 의 누름은 옛 계산 창(`setCalcDate` · `setCalcTopic('stars')` · `setCalcOpen`)이 없어져 `learnAt` 으로 같은 일을
 *      합니다(별 보기 주제를 `star.timeMs` 시각으로 연다). (e) 는 시트의 이벤트 줄(`simpleEventRows`)이 학습 페이지로 옮겨 가 "별 카드와 은하수 줄이 겹친다" 는 상황 자체가 없어졌으므로, 줄이 시트에
 *      남아 있지 않은지를 확인합니다. 지키려는 것 — 별 카드와 같은 때의 줄이 겹치지 않는다 — 은 그대로입니다.)
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

  console.log('\n[10] 오늘 밤 별 보기');
  {
    const SV = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'starVisibility.js'));
    const base = { cloudPct: 10, sunAltDeg: -30, moonAltDeg: -20, moonIllum: 0, lightPollutionMag: 6.0, aod550: 0.05 };
    const T0 = Date.parse('2026-11-19T19:21:00+09:00');
    const mk = (over, extra = {}) => U.starMoment({ timeMs: T0, nowMs: T0 - 3 * 3600e3, cloudKnown: true, input: { ...base, ...over }, ...extra });
    const clear = mk({});
    ok(!!clear && clear.timeMs === T0 && Math.abs(clear.limitMag - SV.starLimit({ ...base }).limitMag) < 1e-12 && clear.cloudPct === 10 && clear.fromNow === false, `맑은 밤: 카드, 한계 ${clear && clear.limitMag.toFixed(2)} = starLimit`);
    ok(!!mk({ cloudPct: 50 }) && mk({ cloudPct: 50.01 }) === null && mk({ cloudPct: 80 }) === null && !!mk({ cloudPct: 20 }) && !!mk({ cloudPct: 0 }), `운량 50 % 는 카드, 50.01 · 80 % 는 없다 (20 % · 0 % 는 카드)`);
    ok(mk({}, { cloudKnown: false }) === null && mk({ cloudPct: NaN }) === null && U.starMoment({ timeMs: NaN, nowMs: T0, cloudKnown: true, input: { ...base } }) === null, '운량을 모르면(예보 없음 · NaN) 없다, timeMs 가 NaN 이어도 없다');
    const cityMoon = { lightPollutionMag: 3.0, moonAltDeg: 55, moonIllum: 0.9 };
    const cityNoMoon = { lightPollutionMag: 3.0 };
    const lowL = SV.starLimit({ ...base, ...cityMoon }).limitMag, highL = SV.starLimit({ ...base, ...cityNoMoon }).limitMag;
    const tooDark = SV.starLimit({ ...base, lightPollutionMag: 2.9 }).limitMag;
    ok(lowL < 3 && mk(cityMoon) === null && Math.abs(highL - 3) < 1e-6 && !!mk(cityNoMoon) && tooDark < 3 - 1e-6 && mk({ lightPollutionMag: 2.9 }) === null,
      `한계등급 3 문턱: 도시 + 보름달 ${lowL.toFixed(2)} 는 없고, 도시 달 없음 ${highL.toFixed(6)} 는 있고(경계), 빛 지도 2.9 의 ${tooDark.toFixed(2)} 는 없다`);
    ok(mk({}, { nowMs: T0 - 5 * 60e3 }).fromNow === true && mk({}, { nowMs: T0 - 6 * 60e3 }).fromNow === false && mk({}, { nowMs: T0 + 3600e3 }).fromNow === true, '지금부터: 5분 안 · 이미 지남은 true, 6분 뒤는 false');
    ok(U.MIN_STAR_LIMIT === 3 && U.STAR_NOW_MS === 5 * 60e3 && U.STAR_LIMIT_EPS === 1e-6, '문턱 상수 3 · 5분 · 여유 1e-6');
  }

  console.log('\n[11] 앱 연결 (소스)');
  {
    const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, 'src', ...p), 'utf8');
    const sky = read('components', 'SkyScreen', 'SkyScreen.tsx');
    const cards = read('components', 'SkyScreen', 'UpcomingCards.tsx');
    const starBlock = (sky.match(/const star = useMemo\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/) || [''])[0];
    ok(starBlock !== '' && /const now = new Date\(\);/.test(starBlock) && /starArgsAt\(now\)/.test(starBlock) && /starMoment\(\{[^}]*nowMs: now\.getTime\(\)/.test(starBlock) && !/calcDate/.test(starBlock),
      '(a) 별 카드는 지금(new Date())으로 계산하고 보고 있는 날짜 calcDate 는 쓰지 않는다');
    ok(/if \(!cardsOn\) return null;/.test(starBlock) && /const cardsOn = sheetOpen && !expertMode;/.test(sky), '(b) 시트가 닫혔거나 전문가 모드면 계산 없이 null');
    ok(/\{!expertMode && \(moments\.length > 0 \|\| star\) && \(\s*<UpcomingCards/.test(sky), '(c) 카드 줄은 moments 나 star 가 있으면 그린다');
    const press = (sky.match(/onStarPress=\{\(\) => \{[\s\S]*?\}\}/) || [''])[0];
    ok(/<UpcomingCards[\s\S]*?star=\{star\}/.test(sky) && /learnAt\(new Date\(star\.timeMs\), 'sunset', 'why', 'stars', star\.timeMs\)/.test(press),
      '(d) star 와 onStarPress 를 넘기고 누르면 star.timeMs 시각으로 02 학습의 별 보기 과정을 연다');
    ok(!/simpleEventRows|combinedEventList|const eventItems|featuredList|generalList/.test(sky), "(e) 시트에 하늘 일정 줄이 없다(02 학습으로 옮김) — 별 카드와 같은 때의 '은하수' 줄이 겹치지 않는다");
    const iStar = cards.indexOf('{star && ('), iMap = cards.indexOf('moments.map(');
    ok(iStar > 0 && iMap > iStar && /계산 과정 보기/.test(cards), '(f1) 별 카드가 날 카드보다 앞이고 접근성 글에 "계산 과정 보기"');
    ok(/const dense = moments\.length \+ \(star \? 1 : 0\) >= 3;/.test(cards) && /cardDense: \{ paddingHorizontal: space\.sm \}/.test(cards) && (cards.match(/numberOfLines=\{2\}/g) || []).length === 2 && !/numberOfLines=\{1\}/.test(cards),
      '(f2) 카드 셋 이상이면 안쪽 여백을 줄이고(dense) 가운데 줄은 두 줄까지 접는다(한 줄 말줄임 없음)');
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
