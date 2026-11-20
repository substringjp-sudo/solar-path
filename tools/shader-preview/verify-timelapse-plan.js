/**
 * **타임랩스 계획(간격 · 총 시간 · 영상 길이)의 순수 계산이 맞는가** — `src/utils/timelapsePlan.ts`. 브라우저 · 네트워크 불필요.
 * (계획 8.3.1: 타임랩스의 기본 칸은 간격 · 총 시간 · 영상 길이 · WB, 결과물은 MP4.)
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20, 구현보다 먼저 박았습니다)
 * 독립 기준: 영상 길이 = 장수 ÷ 초당 장면 수(fps). 빨라지는 배수 = 총 시간 ÷ 영상 길이. 간격 = 총 시간 ÷ (영상 길이 × fps).
 * 한계(내가 정한 값, 근거는 아래): 간격 최소 2 초(한 장 찍고 저장하는 데 걸리는 시간 여유), 총 시간 1 분 ~ 6 시간, 영상 3 ~ 60 초, fps 는 24 또는 30(기본 30), 한 장 평균 3 MB 로 저장 공간을 어림한다.
 *
 *  1. `planTimelapse({ totalMin, videoSec, fps })` = { intervalS, frames, videoSec(실제), speedup, estimateMB }:
 *     - 일몰 60 분 · 영상 10 초 · 30 fps → 간격 12 s, 장수 300(처음 한 장을 더해 301 장이 아니라, 간격으로 나눈 칸 수 300 + 시작 장 1 = 301), 실제 영상 301/30 = 10.03 초, 배수 360×(총 3600 ÷ 10 = 360, 어림 1e-6), 저장 301 × 3 = 903 MB.
 *     - 총 120 분 · 영상 20 초 · 24 fps → 간격 7200 / 480 = 15 s, 장수 481.
 *     - 간격이 2 초보다 짧아지는 요청(총 10 분 · 영상 60 초 · 30 fps → 600/1800 = 0.333 s)은 간격을 2 초로 올리고 그에 맞춰 장수를 줄인다: 600/2 + 1 = 301 장, 영상 301/30 = 10.03 초(요청한 60 초보다 짧아진다 — `clamped` 가 'interval').
 *     - 간격은 0.5 초 단위로 가장 가까운 값으로 반올림한다(총 62 분 · 10 초 · 30 fps → 3720/300 = 12.4 → 12.5 초, 장수 floor(3720/12.5) + 1 = 298).
 *       (처음에는 61 분으로 적고 12.2 → 12.5 라고 적었는데 12.2 는 12.0 에 더 가까워 기준을 잘못 계산한 것이었습니다. 시험 자료만 62 분으로 고쳤고 반올림 규칙은 그대로입니다.)
 *  2. 범위 밖 입력은 범위로 자른다: 총 시간 < 1 분 → 1 분, > 360 분 → 360 분, 영상 < 3 초 → 3 초, > 60 초 → 60 초, fps 가 24 도 30 도 아니면 30. 숫자가 아니면 기본값(총 60 분 · 영상 10 초 · 30 fps).
 *  3. `presetWindow(kind, eventMs)` — 해가 뜨고 지는 시각(eventMs)을 기준으로 한 촬영 구간: 일몰('sunset') = 일몰 −20 분 ~ +40 분(60 분), 일출('sunrise') = 일출 −40 분 ~ +20 분(60 분), 낮에서 밤으로('day-to-night') = 일몰 −20 분 ~ +130 분(150 분). 반환 { startMs, endMs, totalMin }.
 *     `eventMs` 가 숫자가 아니면 null.
 *  4. `frameTimes(startMs, intervalS, frames)`: 찍을 시각 목록. 첫 장은 startMs, 그 뒤 간격마다, 길이 = 장수. 간격이 0 이하거나 장수가 1 미만이면 빈 목록.
 *  5. 사용자에게 보일 한 줄(`planSummary(plan, lang)`): 한국어 "12초마다 301장 · 영상 10초 · 360배속", 영어 "Every 12 s, 301 frames · 10 s video · 360×", 일본어 "12秒ごと 301枚 · 動画10秒 · 360倍速". 간격이 정수면 소수점 없이, 아니면 한 자리("12.5초").
 *  6. 다음 장까지 기다릴 시간(`nextDelayMs(시작, 간격 초, 장 번호, 지금)`) = max(0, 시작 + 번호 × 간격 × 1000 − 지금) ms. 간격마다 어긋남이 쌓이지 않게 시작 시각 기준으로 센다(앞 장이 오래 걸렸으면 짧게, 이미 늦었으면 0).
 *     시작 1000, 간격 12, 3 번째 장(번호 3)은 1000 + 36000 = 37000 ms 에 찍는다: 지금 20000 이면 17000 ms, 지금 40000 이면 0. 숫자가 아니면 0.
 *  7. 진행(`runProgress(시작, 간격, 장수, 찍은 장수, 지금)`) = { taken, frames, remainingS, done }: 마지막 장을 찍을 시각 = 시작 + (장수 − 1) × 간격 × 1000. 남은 초 = max(0, 올림((그 시각 − 지금) / 1000)). done = 찍은 장수 ≥ 장수.
 *     시작 0, 간격 12, 301 장: 지금 0 → 남은 3600 초, 지금 100000 → 3500 초, 지금 3600000 이상 → 0. 찍은 장수 301 이면 done 참, 300 이면 거짓.
 *  8. 미리보기 시각(`previewTimeAt(시작, 끝, 영상 초, 지난 초)`) = 시작 + (끝 − 시작) × (지난 초 ÷ 영상 초를 0~1 로 자른 값). 지난 초 0 → 시작, 영상 초의 절반 → 한가운데, 그 이상 → 끝. 영상 초가 0 이하거나 숫자가 아니면 끝.
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-timelapse-plan.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, t) => Math.abs(a - b) <= t;
const J = JSON.stringify;

(async () => {
  let T = null;
  try { T = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'timelapsePlan.js')); } catch { T = null; }
  ok(!!T && typeof T.planTimelapse === 'function' && typeof T.presetWindow === 'function' && typeof T.frameTimes === 'function' && typeof T.planSummary === 'function', 'timelapsePlan 이 있다');
  if (!T || typeof T.planTimelapse !== 'function') { console.log(`\n실패 있음 — pass ${pass} / fail ${fail}`); process.exit(1); }

  console.log('\n[1] planTimelapse');
  let p = T.planTimelapse({ totalMin: 60, videoSec: 10, fps: 30 });
  ok(p.intervalS === 12 && p.frames === 301 && near(p.videoSec, 301 / 30, 1e-9) && near(p.speedup, 360, 0.5) && p.estimateMB === 903 && p.clamped === null, `일몰 60분 · 10초 · 30fps: ${J(p)}`);
  p = T.planTimelapse({ totalMin: 120, videoSec: 20, fps: 24 });
  ok(p.intervalS === 15 && p.frames === 481 && p.fps === 24, `120분 · 20초 · 24fps: 간격 ${p.intervalS} 장수 ${p.frames}`);
  p = T.planTimelapse({ totalMin: 10, videoSec: 60, fps: 30 });
  ok(p.intervalS === 2 && p.frames === 301 && near(p.videoSec, 301 / 30, 1e-9) && p.clamped === 'interval', `간격이 2 초보다 짧아지면 2 초로 올린다: ${J(p)}`);
  p = T.planTimelapse({ totalMin: 62, videoSec: 10, fps: 30 });
  ok(p.intervalS === 12.5 && p.frames === 298, `간격은 0.5 초 단위(12.4 → 12.5): ${p.intervalS} / ${p.frames}`);
  p = T.planTimelapse({ totalMin: 61, videoSec: 10, fps: 30 });
  ok(p.intervalS === 12, `12.2 → 12: ${p.intervalS}`);

  console.log('\n[2] 범위 밖 입력');
  ok(T.planTimelapse({ totalMin: 0.2, videoSec: 10, fps: 30 }).totalMin === 1 && T.planTimelapse({ totalMin: 9999, videoSec: 10, fps: 30 }).totalMin === 360, '총 시간 1 ~ 360 분으로 자른다');
  ok(T.planTimelapse({ totalMin: 60, videoSec: 1, fps: 30 }).targetVideoSec === 3 && T.planTimelapse({ totalMin: 60, videoSec: 999, fps: 30 }).targetVideoSec === 60, '영상 3 ~ 60 초로 자른다');
  ok(T.planTimelapse({ totalMin: 60, videoSec: 10, fps: 25 }).fps === 30 && T.planTimelapse({ totalMin: 60, videoSec: 10, fps: 24 }).fps === 24, 'fps 는 24 · 30 만');
  const d = T.planTimelapse({ totalMin: NaN, videoSec: undefined, fps: null });
  ok(d.totalMin === 60 && d.targetVideoSec === 10 && d.fps === 30 && d.intervalS === 12, `숫자가 아니면 기본(60분 · 10초 · 30fps): ${J(d)}`);

  console.log('\n[3] presetWindow');
  const ev = Date.UTC(2026, 11, 21, 8, 17); // 일몰 17:17 KST
  const w = (k) => T.presetWindow(k, ev);
  ok(w('sunset').startMs === ev - 20 * 60000 && w('sunset').endMs === ev + 40 * 60000 && w('sunset').totalMin === 60, '일몰: −20 ~ +40 분');
  ok(w('sunrise').startMs === ev - 40 * 60000 && w('sunrise').endMs === ev + 20 * 60000 && w('sunrise').totalMin === 60, '일출: −40 ~ +20 분');
  ok(w('day-to-night').startMs === ev - 20 * 60000 && w('day-to-night').endMs === ev + 130 * 60000 && w('day-to-night').totalMin === 150, '낮에서 밤으로: −20 ~ +130 분');
  ok(T.presetWindow('sunset', NaN) === null && T.presetWindow('sunset', undefined) === null, '시각이 숫자가 아니면 null');

  console.log('\n[4] frameTimes');
  const ft = T.frameTimes(1000, 12, 4);
  ok(J(ft) === J([1000, 13000, 25000, 37000]), `4 장: ${J(ft)}`);
  ok(T.frameTimes(1000, 0, 4).length === 0 && T.frameTimes(1000, -1, 4).length === 0 && T.frameTimes(1000, 12, 0).length === 0, '간격 0 이하 · 장수 0 이면 빈 목록');

  console.log('\n[5] planSummary');
  const s = T.planTimelapse({ totalMin: 60, videoSec: 10, fps: 30 });
  ok(T.planSummary(s, 'ko') === '12초마다 301장 · 영상 10초 · 360배속', `한국어: ${T.planSummary(s, 'ko')}`);
  ok(T.planSummary(s, 'en') === 'Every 12 s, 301 frames · 10 s video · 360×' && T.planSummary(s, 'ja') === '12秒ごと 301枚 · 動画10秒 · 360倍速', `영어 · 일본어: ${T.planSummary(s, 'en')} / ${T.planSummary(s, 'ja')}`);
  ok(T.planSummary(T.planTimelapse({ totalMin: 62, videoSec: 10, fps: 30 }), 'ko').startsWith('12.5초마다'), '간격이 정수가 아니면 한 자리');

  console.log('\n[6~8] 진행 · 미리보기');
  ok(T.nextDelayMs(1000, 12, 3, 20000) === 17000 && T.nextDelayMs(1000, 12, 3, 40000) === 0 && T.nextDelayMs(1000, 12, 0, 1000) === 0 && T.nextDelayMs(NaN, 12, 3, 0) === 0, '다음 장까지: 17000 · 늦으면 0 · 첫 장 0 · NaN 0');
  const rp = (taken, now) => T.runProgress(0, 12, 301, taken, now);
  ok(rp(0, 0).remainingS === 3600 && rp(10, 100000).remainingS === 3500 && rp(300, 3600000).remainingS === 0 && rp(300, 9e9).remainingS === 0 && rp(0, 100500).remainingS === 3500 && rp(0, 100000).taken === 0, '남은 초 3600 · 3500 · 0(올림: 100.5 초 지났으면 3499.5 → 3500)');
  ok(rp(301, 0).done === true && rp(300, 0).done === false && rp(0, 0).frames === 301, 'done: 301 장이면 참, 300 장이면 거짓');
  ok(T.previewTimeAt(1000, 61000, 10, 0) === 1000 && T.previewTimeAt(1000, 61000, 10, 5) === 31000 && T.previewTimeAt(1000, 61000, 10, 99) === 61000 && T.previewTimeAt(1000, 61000, 10, -3) === 1000, '미리보기 시각: 시작 · 한가운데 · 끝, 음수는 시작');
  ok(T.previewTimeAt(1000, 61000, 0, 5) === 61000 && T.previewTimeAt(1000, 61000, NaN, 5) === 61000, '영상 초가 0 · NaN 이면 끝');

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
