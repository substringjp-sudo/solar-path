/**
 * 구름 붉기(층별 조도·투과) + 연속 흐림/탁도 감쇠 기반 노을 점수 검증 (2026-11-16).
 *
 * 사용:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/verify-sunset-score.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

globalThis.__DEV__ = false;
let pass = 0, fail = 0;
const ok = (c, l) => {
  if (c) { pass++; console.log('  PASS: ' + l); }
  else { fail++; console.log('  FAIL: ' + l); }
};

(async () => {
  const SP = await import('file://' + path.join(PREVIEW, 'app/utils/sunsetPhysics.js'));
  const T0 = Date.UTC(2026, 9, 25, 8, 0);
  const times = [0, 1, 2].map((h) => new Date(T0 + h * 3600e3).toISOString().slice(0, 16));
  const at = new Date(T0 + 3600e3);

  const makePath = (obsCloud, farCloud = obsCloud, extra = {}) =>
    [0, 5, 10, 30, 70, 130, 200, 280, 380].map((d) => {
      const c = d === 0 ? obsCloud : farCloud;
      return {
        distance: d,
        azimuthOffset: 0,
        source: 'standard',
        hourly: {
          time: times,
          timeMs: times.map((t) => new Date(t + 'Z').getTime()),
          low: [c.low, c.low, c.low],
          mid: [c.mid, c.mid, c.mid],
          high: [c.high, c.high, c.high],
          visibility: d === 0 ? [28000, 28000, 28000] : undefined,
          humidity: d === 0 ? [55, 55, 55] : undefined,
          ...extra,
        },
      };
    });

  const evalCase = (obsCloud, altDeg = 0, farCloud = obsCloud, extra = {}) =>
    SP.predictSunset(makePath(obsCloud, farCloud, extra), at, altDeg, 28000, 55, 37.5, 0, 274);

  console.log('\n[1] 맑은 날(구름 0%) 바닥 점수 · 구름 노을 최고점');
  const clear0 = evalCase({ low: 0, mid: 0, high: 0 }, 0);
  const highOnly = evalCase({ low: 0, mid: 0, high: 50 }, -1.0);
  const epicSunset = evalCase({ low: 5, mid: 45, high: 35 }, -1.2, { low: 0, mid: 10, high: 15 });
  console.log(`  맑음 0%: ${clear0.score} (${clear0.quality}) · 상층 50%: ${highOnly.score} (${highOnly.quality}) · 황금노을: ${epicSunset.score} (${epicSunset.quality})`);
  ok(clear0.score >= 30 && clear0.score <= 42 && clear0.quality === 'Fair',
    `구름 0% 완전 맑은 일몰은 바닥 점수 30~42점대 (${clear0.score}, ${clear0.quality})`);
  ok(highOnly.score >= 70 && epicSunset.score >= 75 && epicSunset.quality === 'Epic' && epicSunset.score > clear0.score + 35,
    `구름이 붉게 칠해진 날은 고득점 (${highOnly.score} / ${epicSunset.score} ${epicSunset.quality})`);

  console.log('\n[2] 해 고도·지구그림자 변화');
  const noon = evalCase({ low: 5, mid: 45, high: 35 }, 20, { low: 0, mid: 10, high: 15 });
  const lateNight = evalCase({ low: 5, mid: 45, high: 35 }, -5.5, { low: 0, mid: 10, high: 15 });
  ok(noon.score === 0 && lateNight.score < 15 && epicSunset.score >= 75,
    `낮(${noon.score}) · 깊은 밤(${lateNight.score}) ≪ 노을 정점(${epicSunset.score})`);

  console.log('\n[3] 흐림·강수·탁도·지평선 차단의 연속 감쇠 (절벽 없음)');
  const lowGrid = [5, 25, 45, 65, 85].map((low) => evalCase({ low, mid: 40, high: 30 }, 0, { low, mid: 10, high: 15 }).score);
  const rainy = evalCase({ low: 60, mid: 60, high: 40 }, 0, { low: 60, mid: 60, high: 40 }, { precipitation: [1.5, 1.5, 1.5] });
  const aodGrid = [0.05, 0.25, 0.6, 1.2].map((a) => evalCase({ low: 5, mid: 40, high: 30 }, 0.5, { low: 0, mid: 10, high: 15 }, { aod550: [a, a, a] }).score);
  const horBlocked = evalCase({ low: 0, mid: 40, high: 30 }, 0, { low: 95, mid: 40, high: 30 });
  const horClear = evalCase({ low: 0, mid: 40, high: 30 }, 0, { low: 0, mid: 10, high: 15 });
  console.log(`  저층운 5→85%: ${lowGrid.join(' → ')} · 비: ${rainy.score} (${rainy.quality})`);
  console.log(`  AOD 0.05→1.2: ${aodGrid.join(' → ')} · 지평선 막힘: ${horBlocked.score} vs 맑음: ${horClear.score}`);

  const isMonotonicDown = (arr) => arr.every((v, i) => i === 0 || v <= arr[i - 1]);
  ok(isMonotonicDown(lowGrid) && lowGrid[0] >= 65 && lowGrid[4] <= 5,
    `하층운 증가 시 단조 감소 (${lowGrid.join(' → ')})`);
  ok(rainy.score === 0 && rainy.quality === 'Overcast',
    `비 오는 날 0점 Overcast (${rainy.score}, ${rainy.quality})`);
  ok(isMonotonicDown(aodGrid) && aodGrid[0] > aodGrid[3] + 35,
    `미세먼지/황사 AOD 증가 시 계단 없이 단조 감소 (${aodGrid.join(' → ')})`);
  ok(horBlocked.score < 25 && horBlocked.score < horClear.score - 45,
    `해 쪽 지평선 구름 차단 시 큰 폭 감점 (${horBlocked.score} vs ${horClear.score})`);

  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
