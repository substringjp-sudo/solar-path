/**
 * **01 하늘의 시간대별 점수 그래프(`scoreSeries.ts`)가 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * 화면이 그리는 창·눈금·높은 곳이 실제 시각과 어긋나면 "높은 곳을 누르면 그 시간으로" 가 엉뚱한 시각으로 갑니다.
 * 기준값은 코드의 식을 되풀이하지 않고 **날짜 글자(ISO, 시간대 표기)로 직접 적은 시각**과, 앱과 다른 구현(SunCalc)의 일몰 시각입니다.
 *
 * 먼저 정한 줄(돌려 보기 전):
 *  0. (2026-11-21 추가) 가장 붉은 구간 `peakWindow(표본, 비율 = 0.8)`: 높은 때(peak, 점수 1 이상 표본의 최댓값, 같으면 먼저 온 시각)에서 양쪽으로 이웃 표본을 따라가며 점수가 있고(null 아님) 최댓값 × 비율 이상인 동안 이어 붙인 구간 { fromMs, toMs, score }. 시각은 첫 · 끝 표본의 t. 표본 [0,10,50,90,100,95,60,20,0](10분 간격) → 30분 ~ 50분 · 점수 100. [90,null,100,95] → 20 ~ 30분(null 에서 멈춤). [100,100,50] → 0 ~ 10분. 비율 0.5 → 20 ~ 60분, 비율 1 → 40 ~ 40분. 내내 1 미만 · 빈 목록 → null. 비율이 숫자가 아니거나 0 이하 · 1 초과이면 0.8 로 본다. [75, 100] → 비율 0.8 이면 10 ~ 10분(75 < 80), 비율 0.7 이면 0 ~ 10분. [100, 60, 100] → 먼저 온 쪽이라 0 ~ 0분.
 *  0b. (2026-11-21 추가) 낮은 구름 구간 `lowCloudWindow(표본, 문턱 = 60)`: 표본 점수 자리에 낮은 구름 %가 들어온다. 문턱 이상(점수 있음, null 아님)인 표본이 이어진 구간 가운데 가장 긴 것(길이가 같으면 먼저 온 쪽) { fromMs, toMs, score = 그 구간의 최댓값 }. 시각은 첫 · 끝 표본의 t. [0,70,80,65,10,90,0] → 10 ~ 30분 · 점수 80(길이 3 > 1). [70,null,70] → 0 ~ 0분(null 에서 끊김, 먼저 온 쪽). [60] → 0 ~ 0분(문턱은 포함), [59.9] → null. 문턱 80 이면 [70,80,90] → 10 ~ 20분. 빈 목록 · 전부 null · 전부 문턱 미만 → null. 문턱이 숫자가 아니거나 0 이하 · 100 초과이면 60.
 *
 *  1. 창 `scoreWindow`
 *     a. 서울(+9) 2026-11-21 일몰 17:04 → 12:00 ~ 21:00(+09:00), 일출 07:21 → 03:00 ~ 12:00. 길이는 늘 정확히 9시간.
 *     b. 경계: 일몰 17:00:00 → 12:00 시작, 16:59:59 → 11:00 시작.
 *     c. 시간대 소수(인도 +5:30, 일몰 17:40 → 12:00+05:30 시작)와 음수(뉴욕 −5, 일몰 16:50 → 11:00−05:00 시작), 0(런던).
 *     d. 출몰은 창 안 앞에서 5~6시간(일몰) · 4~5시간(일출) 자리에 든다.
 *  2. 표본 `sampleScores`: 10분 간격이면 55 점, 15분이면 37 점. 처음은 창 시작, 끝은 창 끝, 간격은 정확히 같다. predict 는 Date 를 받는다.
 *     null · undefined · NaN · ±Infinity → null, 100 넘으면 100, 0 아래면 0 으로 자른다.
 *  3. 가로 사상: 창 시작 → 0, 끝 → 폭, 가운데 → 폭/2. `timeAtX` 는 `xAtTime` 의 거꾸로(1 ms 안), 범위 밖은 창 끝으로 자른다.
 *     세로: 점수 0 → 높이 − 아래 여백, 100 → 위 여백, 값이 클수록 위(y 가 작다).
 *  4. 경로 `scorePaths`
 *     a. 높은 때(peak)는 점수 1 이상 표본의 최댓값, 같으면 먼저 온 시각. x · y 는 사상과 같다. 내내 1 미만이면 null.
 *     b. 선은 `M` 으로 시작해 점 수 − 1 개의 `L`, 면은 `Z` 로 닫히고 바닥 y 를 지난다.
 *     c. null 이 끼면 구간이 나뉜다([5,10,null,20,30] → 2 구간, `M` 두 번). 점 하나뿐인 구간은 안 그리되 peak 에는 센다. 전부 null 이면 빈 글자와 peak null.
 *  5. 눈금 `axisTicks`: 12:00~21:00 창은 12:00 · 15:00 · 18:00 · 21:00 이 x = 0 · W/3 · 2W/3 · W. 11:00 시작 창은 12 · 15 · 18 이 W/9 · 4W/9 · 7W/9.
 *     인도(+5:30) 창도 현지 정시에 놓인다. 글은 두 자리 "03:00".
 *  6. 글 `graphLabel`: peak 17:04(+9) → "시간대별 점수 그래프, 17시 무렵이 가장 높음", 17:40 → 18시, 자정을 넘으면 0~23 으로. 없으면 "점수가 높은 때가 없음".
 *     en · ja 글도 같은 시각을 말하고 en · ja 에 한글이 없고 NaN · undefined 가 없다.
 *  7. 실제 예측으로: 서울 2026-11-21 일몰 창을 앱과 같은 예측(`predictSunset` + 앱의 해 위치)으로 10분 간격으로 훑는다(낮은 4 · 중간 18 · 높은 63 %, 해 쪽 트임).
 *     SunCalc 일몰 시각(앱과 다른 구현)을 기준으로 아래를 본다. 점수-고도 표(44@+5°, 66@+2°, 71@0°, 70@−2°, 26@−4°, 1@−6°)와 해의 고도 변화율
 *     약 0.18°/분에서, 점수 44 이상인 구간은 일몰 −28 ~ +17분, 절반(35) 이상인 구간은 약 −35 ~ +20분이다.
 *     a. 점수의 무게중심(점수로 가중한 평균 시각)이 일몰 −30 ~ +15분 안.  b. 일몰에 가장 가까운 표본이 최댓값의 90 % 이상(일몰이 높은 구간 안).
 *     c. 최댓값의 절반 이상인 표본이 모두 일몰 −35 ~ +20분 안.  d. 최댓값 ≥ 50.  e. 첫 표본(해 +30°)과 끝 표본(밤)은 5 이하.
 *     f. 점수 10 이상인 표본은 한 덩어리(여러 봉우리가 아님).  g. 흐린 하늘(낮은 95 · 중간 80)은 peak 가 null 이거나 점수 20 미만.
 *     h. 문턱을 건 표본(`canGlow` 밖은 예측 없이 0)이 문턱 없는 표본과 모든 시각에서 0.5 미만으로 같고, 예측 호출은 55 번 가운데 16 번 이하.
 *     (기록: 처음에는 "가장 높은 점수의 시각이 일몰 −15 ~ +25분" 으로 적었다. 돌려 보니 점수가 −17분 ~ +11분에서 70 안팎으로 평평해 최댓값 시각이 그 안 어디든
 *      될 수 있어 의미 있는 통계가 아니었다. 다음으로 적은 "무게중심 ±15분" 은 점수-고도 표를 간격이 고르지 않은 점으로 가중해 "−2분 근처" 라고 잘못 셈한 것에
 *      기댔고, 고르게 재면 앞쪽으로 기울어 −13.6분이 나왔다. 위 기준은 점수가 있는 구간(표의 받침)에서 도출한 것으로 바꾼 것이다.)
 *  8. 해 고도 문턱(`canGlow`, 예측을 건너뛰는 근거): 경계 −8 · 15 는 true, −8.01 · 15.01 은 false.
 *     낮은 구름 0 · 10 · 40 %, 중간 0 · 30 · 60 · 90 %, 높은 구름 0 · 40 · 70 · 100 % 의 48 가지 하늘 모두에서 `predictSunset` 의 점수가
 *     해 고도 +15° · +20° · +30° 와 −8° · −10° · −15° 에서 0.5 미만(실험에서 +14° 이상과 −7° 이하는 정확히 0). 문턱 안에서는 점수가 0 이 넘는다(안쪽이 비어 있지 않음).
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-score-series.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');
const SunCalc = require('suncalc');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const iso = (s) => Date.parse(s);
const HOUR = 3600e3, MIN = 60e3;
const hhmm = (ms, tz) => new Date(ms + tz * HOUR).toISOString().slice(11, 16);

(async () => {
  const S = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'scoreSeries.js'));
  const SP = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'sunsetPhysics.js'));
  const T = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'solarPosition.js'));

  // ── 1. 창 ─────────────────────────────────────────────────────────────────
  console.log('\n[1] 창');
  {
    const w1 = S.scoreWindow(iso('2026-11-21T17:04:00+09:00'), 'sunset', 9);
    ok(w1.fromMs === iso('2026-11-21T12:00:00+09:00') && w1.toMs === iso('2026-11-21T21:00:00+09:00'), `서울 일몰 17:04 → ${hhmm(w1.fromMs, 9)} ~ ${hhmm(w1.toMs, 9)}`);
    const w2 = S.scoreWindow(iso('2026-11-21T07:21:00+09:00'), 'sunrise', 9);
    ok(w2.fromMs === iso('2026-11-21T03:00:00+09:00') && w2.toMs === iso('2026-11-21T12:00:00+09:00'), `서울 일출 07:21 → ${hhmm(w2.fromMs, 9)} ~ ${hhmm(w2.toMs, 9)}`);
    ok(w1.toMs - w1.fromMs === 9 * HOUR && w2.toMs - w2.fromMs === 9 * HOUR, '길이는 정확히 9시간');
    ok(S.scoreWindow(iso('2026-11-21T17:00:00+09:00'), 'sunset', 9).fromMs === iso('2026-11-21T12:00:00+09:00'), '경계: 일몰 17:00:00 → 12:00 시작');
    ok(S.scoreWindow(iso('2026-11-21T16:59:59+09:00'), 'sunset', 9).fromMs === iso('2026-11-21T11:00:00+09:00'), '경계: 일몰 16:59:59 → 11:00 시작');
    ok(S.scoreWindow(iso('2026-11-21T17:40:00+05:30'), 'sunset', 5.5).fromMs === iso('2026-11-21T12:00:00+05:30'), '인도(+5:30) 일몰 17:40 → 현지 12:00 시작');
    ok(S.scoreWindow(iso('2026-11-21T16:50:00-05:00'), 'sunset', -5).fromMs === iso('2026-11-21T11:00:00-05:00'), '뉴욕(−5) 일몰 16:50 → 현지 11:00 시작');
    ok(S.scoreWindow(iso('2026-11-21T16:03:00+00:00'), 'sunset', 0).fromMs === iso('2026-11-21T11:00:00+00:00'), '런던(0) 일몰 16:03 → 11:00 시작');
    let inside = true;
    for (const [ev, side, tz] of [['2026-11-21T17:04:00+09:00', 'sunset', 9], ['2026-11-21T16:59:59+09:00', 'sunset', 9], ['2026-11-21T17:00:00+09:00', 'sunset', 9], ['2026-06-21T19:56:00+09:00', 'sunset', 9], ['2026-11-21T07:21:00+09:00', 'sunrise', 9], ['2026-06-21T05:12:00+09:00', 'sunrise', 9], ['2026-11-21T17:40:00+05:30', 'sunset', 5.5]]) {
      const w = S.scoreWindow(iso(ev), side, tz);
      const into = (iso(ev) - w.fromMs) / HOUR;
      const lead = side === 'sunset' ? 5 : 4;
      if (!(into >= lead && into < lead + 1)) inside = false;
    }
    ok(inside, '출몰은 창 안 앞에서 5~6시간(일몰) · 4~5시간(일출) 자리에 든다(7 경우)');
  }

  // ── 2. 표본 ───────────────────────────────────────────────────────────────
  console.log('\n[2] 표본');
  {
    const w = S.scoreWindow(iso('2026-11-21T17:04:00+09:00'), 'sunset', 9);
    const seen = [];
    const p10 = S.sampleScores(w, 10, (d) => { seen.push(d); return 1; });
    ok(p10.length === 55 && p10[0].t === w.fromMs && p10[54].t === w.toMs, `10분 간격 ${p10.length} 점, 처음 ${hhmm(p10[0].t, 9)} 끝 ${hhmm(p10[54].t, 9)}`);
    ok(p10.every((p, i) => i === 0 || p.t - p10[i - 1].t === 10 * MIN), '간격이 정확히 10분');
    ok(seen.every(d => d instanceof Date) && seen[3].getTime() === w.fromMs + 30 * MIN, 'predict 는 Date 를 받는다');
    ok(S.sampleScores(w, 15, () => 1).length === 37, '15분 간격 37 점');
    const odd = [null, undefined, NaN, Infinity, -Infinity, 150, -20, 42];
    const q = S.sampleScores({ fromMs: 0, toMs: 7 * 10 * MIN }, 10, (d) => odd[d.getTime() / (10 * MIN)]);
    ok(q.map(p => String(p.score)).join() === 'null,null,null,null,null,100,0,42', `이상한 값 처리: ${q.map(p => String(p.score)).join()}`);   // join 은 null 을 빈 글자로 찍으므로 String 으로
  }

  // ── 3. 가로·세로 사상 ──────────────────────────────────────────────────────
  console.log('\n[3] 사상');
  {
    const w = { fromMs: iso('2026-11-21T12:00:00+09:00'), toMs: iso('2026-11-21T21:00:00+09:00') };
    const g = { width: 360, height: 44, padTop: 4, padBottom: 2 };
    ok(S.xAtTime(w, g, w.fromMs) === 0 && S.xAtTime(w, g, w.toMs) === 360 && Math.abs(S.xAtTime(w, g, iso('2026-11-21T16:30:00+09:00')) - 180) < 1e-9, '처음 0 · 끝 360 · 16:30 은 180');
    let worst = 0;
    for (let i = 0; i < 50; i++) { const t = w.fromMs + Math.floor(((i * 7919) % 1000) / 1000 * (w.toMs - w.fromMs)); worst = Math.max(worst, Math.abs(S.timeAtX(w, g, S.xAtTime(w, g, t)) - t)); }
    ok(worst <= 1, `timeAtX 는 xAtTime 의 거꾸로(최대 차 ${worst.toFixed(3)} ms)`);
    ok(S.timeAtX(w, g, -30) === w.fromMs && S.timeAtX(w, g, 999) === w.toMs, '범위 밖 x 는 창 끝으로');
    ok(S.yAtScore(g, 0) === 42 && S.yAtScore(g, 100) === 4 && S.yAtScore(g, 50) === 23 && S.yAtScore(g, 30) > S.yAtScore(g, 60), `점수 0 → ${S.yAtScore(g, 0)} · 50 → ${S.yAtScore(g, 50)} · 100 → ${S.yAtScore(g, 100)}, 클수록 위`);
  }

  // ── 4. 경로 ───────────────────────────────────────────────────────────────
  console.log('\n[4] 경로');
  {
    const w = { fromMs: 0, toMs: 9 * 10 * MIN };           // 점 10 개(0~9)
    const g = { width: 90, height: 40, padTop: 4, padBottom: 2 };
    const mkp = (arr) => arr.map((s, i) => ({ t: i * 10 * MIN, score: s }));
    const p1 = S.scorePaths(mkp([0, 5, 20, 60, 90, 90, 40, 10, 2, 0]), w, g);
    ok(p1.peak && p1.peak.score === 90 && p1.peak.t === 4 * 10 * MIN, `높은 때는 점수 90 의 먼저 온 시각(${p1.peak && p1.peak.t / (10 * MIN)}번째)`);
    ok(p1.peak.x === S.xAtTime(w, g, p1.peak.t) && p1.peak.y === S.yAtScore(g, 90), 'peak 의 x · y 가 사상과 같다');
    const L = (p1.line.match(/L/g) || []).length, M = (p1.line.match(/M/g) || []).length;
    ok(p1.line.startsWith('M') && L === 9 && M === 1 && p1.segments === 1, `선: M ${M} 번, L ${L} 번(점 10 개 → 9)`);
    ok(p1.area.endsWith('Z') && p1.area.includes(' 38 ') && p1.area.startsWith('M0 38 L0 '), `면: Z 로 닫히고 바닥 y=38 에서 시작 ("${p1.area.slice(0, 22)}…")`);
    const p2 = S.scorePaths(mkp([5, 10, null, 20, 30]), { fromMs: 0, toMs: 4 * 10 * MIN }, g);
    ok(p2.segments === 2 && (p2.line.match(/M/g) || []).length === 2 && (p2.area.match(/Z/g) || []).length === 2, `null 이 끼면 두 구간(M ${(p2.line.match(/M/g) || []).length} 번, Z ${(p2.area.match(/Z/g) || []).length} 번)`);
    const p3 = S.scorePaths(mkp([null, 50, null, null, 3]), { fromMs: 0, toMs: 4 * 10 * MIN }, g);
    ok(p3.segments === 0 && p3.line === '' && p3.peak && p3.peak.score === 50, '점 하나뿐인 구간은 안 그리지만 peak 에는 센다');
    const p4 = S.scorePaths(mkp([null, null, null]), { fromMs: 0, toMs: 2 * 10 * MIN }, g);
    ok(p4.line === '' && p4.area === '' && p4.peak === null && p4.segments === 0, '전부 null 이면 빈 경로 · peak null');
    const p5 = S.scorePaths(mkp([0, 0.4, 0, 0.9]), { fromMs: 0, toMs: 3 * 10 * MIN }, g);
    ok(p5.peak === null && p5.segments === 1, '내내 1 미만이면 peak 없음(선은 그린다)');
    const p6 = S.scorePaths(mkp([10, 70, 70, 30]), { fromMs: 0, toMs: 3 * 10 * MIN }, g);
    ok(p6.peak.t === 10 * MIN, '같은 점수면 먼저 온 시각');
    ok(S.hasAnyScore(mkp([null, 0])) === true && S.hasAnyScore(mkp([null, null])) === false && S.hasAnyScore([]) === false, 'hasAnyScore: 0 도 점수, 전부 null 이면 없음');
  }

  // ── 5. 눈금 ───────────────────────────────────────────────────────────────
  console.log('\n[5] 눈금');
  {
    const g = { width: 360, height: 44 };
    const w = { fromMs: iso('2026-11-21T12:00:00+09:00'), toMs: iso('2026-11-21T21:00:00+09:00') };
    const t1 = S.axisTicks(w, g, 9);
    ok(t1.map(t => `${t.label}@${t.x}`).join() === '12:00@0,15:00@120,18:00@240,21:00@360', `12~21시 창: ${t1.map(t => `${t.label}@${t.x}`).join()}`);
    const w2 = { fromMs: iso('2026-11-21T11:00:00+09:00'), toMs: iso('2026-11-21T20:00:00+09:00') };
    const t2 = S.axisTicks(w2, g, 9);
    ok(t2.map(t => `${t.label}@${t.x}`).join() === '12:00@40,15:00@160,18:00@280', `11시 시작 창: ${t2.map(t => `${t.label}@${t.x}`).join()}`);
    const w3 = S.scoreWindow(iso('2026-11-21T07:21:00+09:00'), 'sunrise', 9);
    ok(S.axisTicks(w3, g, 9).map(t => t.label).join() === '03:00,06:00,09:00,12:00', `일출 창 눈금: ${S.axisTicks(w3, g, 9).map(t => t.label).join()}`);
    const w4 = S.scoreWindow(iso('2026-11-21T17:40:00+05:30'), 'sunset', 5.5);
    ok(S.axisTicks(w4, g, 5.5).map(t => t.label).join() === '12:00,15:00,18:00,21:00', `인도 창 눈금(현지 정시): ${S.axisTicks(w4, g, 5.5).map(t => t.label).join()}`);
    const w5 = S.scoreWindow(iso('2026-11-21T22:30:00+09:00'), 'sunset', 9);   // 창이 자정을 넘음: 22:30 − 5시간 = 17:30 → 17:00 시작, 02:00 끝
    ok(w5.fromMs === iso('2026-11-21T17:00:00+09:00') && S.axisTicks(w5, g, 9).map(t => t.label).join() === '18:00,21:00,00:00', `자정을 넘는 창(17:00~02:00)의 눈금: ${S.axisTicks(w5, g, 9).map(t => t.label).join()}`);
  }

  // ── 6. 글 ─────────────────────────────────────────────────────────────────
  console.log('\n[6] 글');
  {
    const pk = (s) => ({ t: iso(s) });
    ok(S.graphLabel(pk('2026-11-21T17:04:00+09:00'), 9, 'ko') === '시간대별 점수 그래프, 17시 무렵이 가장 높음', `ko 17:04 → "${S.graphLabel(pk('2026-11-21T17:04:00+09:00'), 9, 'ko')}"`);
    ok(S.graphLabel(pk('2026-11-21T17:40:00+09:00'), 9, 'ko').includes('18시 무렵'), '17:40 은 18시 무렵(가까운 정시)');
    ok(S.graphLabel(pk('2026-11-21T23:50:00+09:00'), 9, 'ko').includes('0시 무렵'), '23:50 은 0시 무렵(24 가 아니라)');
    ok(S.graphLabel(pk('2026-11-21T17:04:00+09:00'), 9, 'en') === 'Score by time of day, highest around 17:00' && S.graphLabel(pk('2026-11-21T17:04:00+09:00'), 9, 'ja') === '時間帯別スコアのグラフ、17時ごろが最も高い', 'en · ja 도 17시');
    ok(S.graphLabel(null, 9, 'ko').includes('점수가 높은 때가 없음'), '높은 때가 없으면 그렇게 말한다');
    const all = [];
    for (const L of ['ko', 'en', 'ja']) for (const peak of [pk('2026-11-21T05:04:00+09:00'), null]) all.push(S.graphLabel(peak, 9, L));
    ok(all.every(t => !/NaN|undefined|Infinity/.test(t)), 'NaN · undefined · Infinity 가 없다');
    ok(all.filter((t, i) => Math.floor(i / 2) > 0).every(t => !/[가-힣]/.test(t)), 'en · ja 글에 한글이 없다');
  }

  // ── 7. 실제 예측으로 ──────────────────────────────────────────────────────
  console.log('\n[7] 실제 예측');
  {
    const lat = 37.5665, lon = 126.978;
    const noon = new Date('2026-11-21T03:00:00Z');
    const sunsetSC = SunCalc.getTimes(noon, lat, lon).sunset.getTime();
    const sunsetApp = T.sunTimes(noon, lat, lon).sunset.getTime();
    ok(Math.abs(sunsetApp - sunsetSC) <= 2 * MIN, `앱 일몰 ${hhmm(sunsetApp, 9)} / SunCalc ${hhmm(sunsetSC, 9)} (기준이 서로 2분 안)`);
    const w = S.scoreWindow(sunsetApp, 'sunset', 9);
    const T0 = new Date(w.fromMs);
    const mk = (low, mid, high, d, off) => ({ distance: d, azimuthOffset: off, source: 'standard', hourly: { time: ['x'], timeMs: [T0.getTime()], low: [low], mid: [mid], high: [high] } });
    const ring = (lo, mi, hi) => [mk(lo, mi, hi, 0, 0), ...[30, 60, 100, 200].flatMap(d => [0, 90, 180, 270].map(a => mk(a === 0 ? 0 : lo, mi, hi, d, a)))];
    const run = (path) => S.sampleScores(w, 10, (d) => {
      const sp = T.sunPosition(d, lat, lon);
      return SP.predictSunset(path, d, sp.altitude * 180 / Math.PI, 20000, 55, lat, 38, 325, sp.azimuth * 180 / Math.PI + 180).score;
    });
    const good = run(ring(4, 18, 63));
    const pk = S.scorePaths(good, w, { width: 360, height: 44 }).peak;
    // 점수는 해가 +5° ~ −3° 일 때 44~71 로 평평해서(일몰 −28분 ~ +17분) 최댓값의 시각은 평평한 구간 안 어디든 될 수 있습니다.
    // 그래서 최댓값 시각 대신 점수의 무게중심(점수로 가중한 평균 시각)을 SunCalc 일몰과 견줍니다.
    const sum = good.reduce((a, p) => a + p.score, 0);
    const centroid = good.reduce((a, p) => a + p.score * p.t, 0) / sum;
    const dc = (centroid - sunsetSC) / MIN;
    ok(dc >= -30 && dc <= 15, `점수 무게중심 ${hhmm(centroid, 9)} = SunCalc 일몰 ${dc >= 0 ? '+' : ''}${dc.toFixed(1)}분 (기준 −30 ~ +15분)`);
    const near = good.reduce((b, p) => (Math.abs(p.t - sunsetSC) < Math.abs(b.t - sunsetSC) ? p : b), good[0]);
    const maxScore = Math.max(...good.map(p => p.score));
    ok(near.score >= 0.9 * maxScore, `일몰에 가장 가까운 표본(${hhmm(near.t, 9)}) 점수 ${near.score.toFixed(0)} 가 최댓값 ${maxScore.toFixed(0)} 의 90 % 이상`);
    const half = good.filter(p => p.score >= 0.5 * maxScore).map(p => (p.t - sunsetSC) / MIN);
    ok(half.length > 0 && Math.min(...half) >= -35 && Math.max(...half) <= 20, `최댓값의 절반 이상인 표본은 일몰 ${Math.min(...half).toFixed(0)} ~ +${Math.max(...half).toFixed(0)}분 (기준 −35 ~ +20분)`);
    ok(pk && pk.score >= 50, `최댓값 ${pk && pk.score.toFixed(0)} ≥ 50 (시각 ${pk && hhmm(pk.t, 9)})`);
    ok(good[0].score <= 5 && good[good.length - 1].score <= 5, `첫 표본(${hhmm(good[0].t, 9)}) ${good[0].score.toFixed(0)} · 끝 표본(${hhmm(good[good.length - 1].t, 9)}) ${good[good.length - 1].score.toFixed(0)} 은 5 이하`);
    const idx = good.map((p, i) => (p.score >= 10 ? i : -1)).filter(i => i >= 0);
    ok(idx.length > 0 && idx[idx.length - 1] - idx[0] === idx.length - 1, `점수 10 이상 표본 ${idx.length} 개가 한 덩어리(${hhmm(good[idx[0]].t, 9)}~${hhmm(good[idx[idx.length - 1]].t, 9)})`);
    // h. 문턱을 건 표본이 문턱 없는 표본과 같고 예측 호출이 크게 준다
    let calls = 0;
    const gatedRun = (path) => S.sampleScores(w, 10, (d) => {
      const sp = T.sunPosition(d, lat, lon);
      const alt = sp.altitude * 180 / Math.PI;
      if (!S.canGlow(alt)) return 0;
      calls++;
      return SP.predictSunset(path, d, alt, 20000, 55, lat, 38, 325, sp.azimuth * 180 / Math.PI + 180).score;
    });
    const gated = gatedRun(ring(4, 18, 63));
    const maxDiff = Math.max(...gated.map((p, i) => Math.abs(p.score - good[i].score)));
    ok(maxDiff < 0.5 && calls <= 16, `문턱을 건 표본과 문턱 없는 표본의 최대 차 ${maxDiff.toFixed(3)} < 0.5, 예측 호출 ${calls} / ${good.length} 번(≤ 16)`);
    const cloudy = run(ring(95, 80, 10));
    const pc = S.scorePaths(cloudy, w, { width: 360, height: 44 }).peak;
    ok(!pc || pc.score < 20, `흐린 하늘: peak ${pc ? pc.score.toFixed(0) : '없음'} (없거나 20 미만)`);
  }

  // ── 8. 해 고도 문턱 ───────────────────────────────────────────────────────
  console.log('\n[8] 해 고도 문턱');
  {
    ok(S.canGlow(-8) && S.canGlow(15) && !S.canGlow(-8.01) && !S.canGlow(15.01) && S.canGlow(0), '경계 −8 · 15 는 안, −8.01 · 15.01 은 밖');
    const T0 = new Date('2026-11-21T17:00:00+09:00');
    const mk = (low, mid, high, d, off) => ({ distance: d, azimuthOffset: off, source: 'standard', hourly: { time: ['x'], timeMs: [T0.getTime()], low: [low], mid: [mid], high: [high] } });
    const ring = (lo, mi, hi) => [mk(lo, mi, hi, 0, 0), ...[30, 60, 100, 200].flatMap(d => [0, 90, 180, 270].map(a => mk(a === 0 ? 0 : lo, mi, hi, d, a)))];
    let n = 0, worstOut = 0, worstWhere = '', insideMax = 0;
    for (const lo of [0, 10, 40]) for (const mi of [0, 30, 60, 90]) for (const hi of [0, 40, 70, 100]) {
      const p = ring(lo, mi, hi);
      n++;
      for (const a of [15, 20, 30, -8, -10, -15]) {
        const sc = SP.predictSunset(p, T0, a, 20000, 55, 37.5, 38, 325, 250).score;
        if (sc > worstOut) { worstOut = sc; worstWhere = `${lo}/${mi}/${hi} @ ${a}°`; }
      }
      for (const a of [8, 4, 2, 0, -2]) insideMax = Math.max(insideMax, SP.predictSunset(p, T0, a, 20000, 55, 37.5, 38, 325, 250).score);
    }
    ok(n === 48 && worstOut < 0.5, `${n} 가지 하늘의 문턱 바깥(+15° 이상 · −8° 이하) 최대 점수 ${worstOut.toFixed(2)} < 0.5 ${worstWhere ? '(' + worstWhere + ')' : ''}`);
    ok(insideMax > 20, `문턱 안(+8° ~ −2°)에서는 점수가 올라간다(최대 ${insideMax.toFixed(0)})`);
  }

  console.log('\n[0] 가장 붉은 구간 peakWindow');
  {
    const S = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'scoreSeries.js'));
    const pts = (arr) => arr.map((v, i) => ({ t: i * 10 * MIN, score: v }));
    const W = (arr, f) => (typeof S.peakWindow === 'function' ? S.peakWindow(pts(arr), f) : 'none');
    const eq = (w, a, b, sc) => !!w && w !== 'none' && w.fromMs === a * MIN && w.toMs === b * MIN && w.score === sc;
    const base = [0, 10, 50, 90, 100, 95, 60, 20, 0];
    ok(eq(W(base), 30, 50, 100), '기본 비율 0.8: 90 · 100 · 95 → 30 ~ 50분');
    ok(eq(W([90, null, 100, 95]), 20, 30, 100), 'null 에서 멈춘다');
    ok(eq(W([100, 100, 50]), 0, 10, 100), '같은 점수는 먼저 온 쪽에서 시작해 이어 붙인다');
    ok(eq(W(base, 0.5), 20, 60, 100) && eq(W(base, 1), 40, 40, 100), '비율 0.5 → 20 ~ 60분, 비율 1 → 40 ~ 40분');
    ok(W([0, 0.5, 0.9]) === null && W([]) === null && W([null, null]) === null, '내내 1 미만 · 빈 목록 · 전부 null → null');
    ok(eq(W([75, 100]), 10, 10, 100) && eq(W([75, 100], 0.7), 0, 10, 100) && eq(W([100, 60, 100]), 0, 0, 100), '문턱 80 에 못 미치는 75 는 빠지고(0.7 이면 들어감), 같은 최고점이 떨어져 있으면 먼저 온 쪽');
    ok(eq(W(base, NaN), 30, 50, 100) && eq(W(base, 0), 30, 50, 100) && eq(W(base, 1.5), 30, 50, 100), '비율이 잘못이면 0.8');
  }

  console.log('\n[0b] 낮은 구름 구간 lowCloudWindow');
  {
    const S = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'scoreSeries.js'));
    const pts = (arr) => arr.map((v, i) => ({ t: i * 10 * MIN, score: v }));
    const L = (arr, th) => (typeof S.lowCloudWindow === 'function' ? S.lowCloudWindow(pts(arr), th) : 'none');
    const eq = (w, a, b, sc) => !!w && w !== 'none' && w.fromMs === a * MIN && w.toMs === b * MIN && w.score === sc;
    ok(eq(L([0, 70, 80, 65, 10, 90, 0]), 10, 30, 80), '가장 긴 이어진 구간(3 개)을 고른다, 점수는 구간 최댓값');
    ok(eq(L([70, null, 70]), 0, 0, 70), 'null 에서 끊기고 같은 길이면 먼저 온 쪽');
    ok(eq(L([60]), 0, 0, 60) && L([59.9]) === null, '문턱은 포함(60), 59.9 는 아님');
    ok(eq(L([70, 80, 90], 80), 10, 20, 90), '문턱을 바꾸면(80) 그만큼만');
    ok(L([]) === null && L([null, null]) === null && L([10, 20]) === null, '빈 목록 · 전부 null · 전부 문턱 미만 → null');
    ok(eq(L([70, 80], NaN), 0, 10, 80) && eq(L([70, 80], 0), 0, 10, 80) && eq(L([70, 80], 101), 0, 10, 80), '문턱이 잘못이면 60');
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
