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
 *  9. 종류(2026-11-20, 사용자 정리, 구현보다 먼저 박음): `kind` = 'plain'(기본, 한 장이 영상 한 프레임) · 'stacked'(밝게 합성: `stackSize` 장을 한 프레임으로 합쳐 그 프레임들로 영상) · 'trail'(궤적 누적: 처음 장부터 계속 쌓아 매 프레임이 "지금까지의 합").
 *     `frames` 는 **찍는 장수**, `outFrames` 는 **영상 프레임 수**, 영상 길이 = outFrames ÷ fps. plain: outFrames = frames. trail: outFrames = frames(한 장 찍을 때마다 누적 프레임 하나), 계산은 plain 과 같고 `cumulative` 참.
 *     stacked: 영상 프레임 수를 목표(영상 길이 × fps)로 잡고 찍는 장수 = 목표 × stackSize. 간격 = 총 시간 ÷ (영상 길이 × fps × stackSize)를 0.5 초로 맞추고 2 초 아래로는 내리지 않는다. frames = floor(총 시간 ÷ 간격) + 1, outFrames = floor(frames ÷ stackSize).
 *     stackSize 는 2~16 으로 자르고(정수로 내림) 기본 4. 총 150 분 · 영상 10 초 · 30 fps · stackSize 4 → 간격 9000/1200 = 7.5 s, frames 1201, outFrames 300, 영상 10 초, 배속 900×, 저장 1201 × 3 = 3603 MB.
 *     저장 공간은 찍는 장수 기준. plain · trail 은 `stackSize` 1.
 *     한 줄(`planSummary`): stacked 한국어 "7.5초마다 1201장 · 4장씩 합성 · 영상 10초 · 900배속", trail "12초마다 301장 · 누적 · 영상 10초 · 360배속"(영어 "stacked 4 per frame" · "cumulative", 일본어 "4枚ずつ合成" · "累積").
 * 10. 합성(2026-11-20, 실제로 합치기를 넣으며, 구현보다 먼저 박음): 찍은 사진을 장마다 어떻게 다룰지(`shotPlan(종류, 합성 장수, 장 번호(0부터), 마지막 장인가)` = { accumulate, flush, reset, saveRaw }).
 *     - 일반: 합치지 않고 그 장을 그대로 앨범에 저장: { accumulate: false, flush: false, reset: false, saveRaw: true }(모든 번호).
 *     - 궤적 누적: 장마다 누적 그림에 겹치고(밝은 쪽을 남김) 그때까지의 누적을 저장, 되돌리지 않는다: { accumulate: true, flush: true, reset: false, saveRaw: false }(모든 번호).
 *     - 밝게 합성(stackSize k): 장마다 묶음에 쌓고, (번호 + 1)이 k 의 배수인 장에서 묶음을 저장하고 비운다(flush · reset 참). 마지막 장이 k 의 배수에서 끝나지 않으면 마지막 장에서 남은 묶음을 저장하고 비운다(조금 덜 쌓인 한 장). 그 밖에는 { accumulate: true, flush: false, reset: false, saveRaw: false }.
 *       k = 4: 번호 0 · 1 · 2 는 쌓기만, 3 은 저장 · 비움, 4 · 5 · 6 쌓기만, 7 은 저장 · 비움. 번호 5 가 마지막이면 5 에서 저장 · 비움(6 장 = 4 + 2).
 *     - 앨범에 저장되는 그림 수(`savedFrames`): 일반 = frames, 궤적 누적 = frames, 밝게 합성 = ceil(frames ÷ stackSize)(마지막 덜 쌓인 묶음 포함). 150 분 · 10 초 · 30 fps · 4 장씩 = frames 1201 → ceil(1201/4) = 301.
 *     - 저장 공간 어림(`estimateMB`)은 **앨범에 저장되는 그림 기준**으로 바뀐다: 합성은 찍은 사진을 합친 뒤 버리므로 savedFrames × 3 = 301 × 3 = 903 MB(이전 기준은 찍은 장수 1201 × 3 = 3603 이었고, 합치는 일이 들어와 저장되는 것이 줄어 기준을 고쳤다). 일반 · 누적은 그대로 frames × 3.
 *       (같은 이유로 위 9 번의 밝게 합성 시험 자료 저장 공간 3603 은 903 으로 고친다. 이 값만 바뀐 것이고 간격 · 장수 · 영상 프레임 수 기준은 그대로.)
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

  console.log('\n[9] 종류');
  const st = T.planTimelapse({ totalMin: 150, videoSec: 10, fps: 30, kind: 'stacked', stackSize: 4 });
  ok(st.kind === 'stacked' && st.intervalS === 7.5 && st.frames === 1201 && st.outFrames === 300 && near(st.videoSec, 10, 1e-9) && near(st.speedup, 900, 0.5) && st.estimateMB === 903 && st.savedFrames === 301 && st.stackSize === 4 && st.cumulative === false, `밝게 합성 150분 · 10초 · 4장씩: ${J(st)}`);
  const tr = T.planTimelapse({ totalMin: 60, videoSec: 10, fps: 30, kind: 'trail' });
  const pl = T.planTimelapse({ totalMin: 60, videoSec: 10, fps: 30 });
  ok(tr.kind === 'trail' && tr.cumulative === true && tr.intervalS === pl.intervalS && tr.frames === pl.frames && tr.outFrames === tr.frames && tr.stackSize === 1, `궤적 누적은 일반과 같은 계산 + cumulative: ${J(tr)}`);
  ok(pl.kind === 'plain' && pl.cumulative === false && pl.outFrames === pl.frames && pl.stackSize === 1, '일반: outFrames = frames, 누적 아님');
  ok(T.planTimelapse({ totalMin: 150, videoSec: 10, fps: 30, kind: 'stacked', stackSize: 99 }).stackSize === 16 && T.planTimelapse({ totalMin: 150, videoSec: 10, fps: 30, kind: 'stacked', stackSize: 1 }).stackSize === 2 && T.planTimelapse({ totalMin: 150, videoSec: 10, fps: 30, kind: 'stacked' }).stackSize === 4 && T.planTimelapse({ totalMin: 150, videoSec: 10, fps: 30, kind: 'stacked', stackSize: 3.9 }).stackSize === 3, 'stackSize 2~16, 기본 4, 정수로 내림');
  const short = T.planTimelapse({ totalMin: 10, videoSec: 10, fps: 30, kind: 'stacked', stackSize: 4 });
  ok(short.intervalS === 2 && short.clamped === 'interval' && short.frames === 301 && short.outFrames === 75, `간격 2 초 미만이면 올림: ${J(short)}`);
  ok(T.planSummary(st, 'ko') === '7.5초마다 1201장 · 4장씩 합성 · 영상 10초 · 900배속' && T.planSummary(tr, 'ko') === '12초마다 301장 · 누적 · 영상 10초 · 360배속', `한국어 한 줄: ${T.planSummary(st, 'ko')} / ${T.planSummary(tr, 'ko')}`);
  ok(T.planSummary(st, 'en').includes('stacked 4 per frame') && T.planSummary(tr, 'en').includes('cumulative') && T.planSummary(st, 'ja').includes('4枚ずつ合成') && T.planSummary(tr, 'ja').includes('累積'), '영어 · 일본어');

  console.log('\n[10] 합성: shotPlan · savedFrames');
  const sp = (k, kk, i, last = false) => T.shotPlan(k, kk, i, last);
  ok(J(sp('plain', 1, 0)) === J({ accumulate: false, flush: false, reset: false, saveRaw: true }) && J(sp('plain', 1, 7, true)) === J({ accumulate: false, flush: false, reset: false, saveRaw: true }), '일반: 합치지 않고 그대로 저장');
  ok(J(sp('trail', 1, 0)) === J({ accumulate: true, flush: true, reset: false, saveRaw: false }) && J(sp('trail', 1, 99, true)) === J({ accumulate: true, flush: true, reset: false, saveRaw: false }), '궤적 누적: 장마다 겹치고 저장, 되돌리지 않음');
  const stk = [0, 1, 2, 3, 4, 5, 6, 7].map(i => sp('stacked', 4, i));
  ok(J(stk.map(x => x.flush)) === J([false, false, false, true, false, false, false, true]) && J(stk.map(x => x.reset)) === J([false, false, false, true, false, false, false, true]) && stk.every(x => x.accumulate === true && x.saveRaw === false), `밝게 합성 k=4: 3 · 7 에서 저장 · 비움: ${J(stk.map(x => x.flush))}`);
  ok(sp('stacked', 4, 5, true).flush === true && sp('stacked', 4, 5, true).reset === true && sp('stacked', 4, 5, false).flush === false, '덜 쌓인 마지막 묶음은 마지막 장에서 저장');
  ok(sp('stacked', 4, 7, true).flush === true && sp('stacked', 2, 1).flush === true && sp('stacked', 2, 0).flush === false, '정확히 끝나는 마지막 · k=2');
  ok(T.planTimelapse({ totalMin: 60, videoSec: 10, fps: 30 }).savedFrames === 301 && T.planTimelapse({ totalMin: 60, videoSec: 10, fps: 30, kind: 'trail' }).savedFrames === 301 && st.savedFrames === 301, 'savedFrames: 일반 301, 누적 301, 합성 301(ceil(1201/4))');
  const odd = T.planTimelapse({ totalMin: 10, videoSec: 10, fps: 30, kind: 'stacked', stackSize: 4 });
  ok(odd.frames === 301 && odd.savedFrames === 76 && odd.estimateMB === 228, `301 장 · 4 장씩 → ceil(301/4) = 76 장, 228 MB: ${odd.savedFrames} / ${odd.estimateMB}`);

  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
