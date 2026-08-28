/**
 * **바람 자료층** 합격 판정 — 픽셀이 아니라 `weather.ts` → `skyColumn.ts`
 * 사이의 값 변환을 잽니다.
 *
 * 화면 쪽은 `verify-wind-drift.js` 가 봅니다. 여기서 따로 보는 이유는,
 * 이 구간의 오류가 **화면에 안 나타나기 때문**입니다. 방위 부호를 뒤집어도
 * 구름은 여전히 그럴듯하게 흐르고, 실측을 못 받아 대용값으로 내려앉아도
 * 그림은 멀쩡합니다. 그래서 값 자체를 단언합니다:
 *
 *  1. Open-Meteo 응답(속도 + **불어오는** 방위)이 성분으로 바뀌고,
 *     다시 (속도, 방위)로 돌아올 때 원래 값이 나오는가 — 왕복.
 *  2. 350° 와 10° 같은 이음매를 성분이 제대로 넘기는가.
 *  3. 요청이 실패하면 **조용히** 대용값으로 내려앉고, 그 사실이
 *     `measured: false` 로 드러나는가.
 *
 * 준비: node tools/shader-preview/stage-node.js
 * 사용: node tools/shader-preview/verify-wind-data.js
 */
global.__DEV__ = false;
const W = require('/tmp/skybuild/weather.js');
const SC = require('/tmp/skybuild/skyColumn.js');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
/** 방위 차이는 360° 이음매를 넘어서 재야 합니다. */
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** 캔드 응답을 돌려주는 fetch. 실제 네트워크는 쓰지 않습니다. */
function stubFetch(payload, { fail: shouldFail = false } = {}) {
  global.fetch = async () => {
    if (shouldFail) throw new Error('네트워크 없음(의도된 실패)');
    return { ok: true, status: 200, json: async () => payload };
  };
}

function response(levels) {
  const hourly = { time: ['2026-08-28T00:00'] };
  for (const [hpa, [sp, dir]] of Object.entries(levels)) {
    hourly[`wind_speed_${hpa}`] = [sp];
    hourly[`wind_direction_${hpa}`] = [dir];
  }
  return { hourly };
}

(async () => {
  console.log('== 속도·방위 왕복 ==');
  // 응답에서 성분으로, 성분에서 다시 속도·방위로. 중간이 어긋나면
  // 어느 쪽이든 여기서 드러납니다.
  const CASES = [
    { name: '서풍 270°', low: [18, 270], mid: [31, 245], high: [62, 280] },
    { name: '북쪽 이음매', low: [12, 350], mid: [20, 10], high: [44, 0] },
    { name: '동풍 90°', low: [7, 90], mid: [15, 135], high: [30, 180] },
  ];
  let n = 0;
  for (const c of CASES) {
    stubFetch(response({ '850hPa': c.low, '600hPa': c.mid, '250hPa': c.high }));
    // 위경도를 매번 달리해 캐시가 앞 사례를 돌려주지 않게 합니다.
    const got = await W.fetchLayerWinds(10 + n, 20 + n, new Date('2026-08-28T00:00:00Z'));
    n++;
    if (!got) { ok(false, `${c.name} — 응답을 받지 못했습니다`); continue; }

    // fetchLayerWinds 의 성분을 CloudData 모양으로 옮겨 layerWindsFrom 에 넣습니다
    // (앱에서 attachLayerWinds → getInterpolatedWeather 가 하는 일과 같습니다).
    const obs = {
      low: 0, mid: 0, high: 0, distance: 0, azimuthOffset: 0,
      windULow: got.windULow[0], windVLow: got.windVLow[0],
      windUMid: got.windUMid[0], windVMid: got.windVMid[0],
      windUHigh: got.windUHigh[0], windVHigh: got.windVHigh[0],
    };
    const back = W.layerWindsFrom(obs);
    if (!back) { ok(false, `${c.name} — layerWindsFrom 이 null`); continue; }

    for (const [k, want] of [['low', c.low], ['mid', c.mid], ['high', c.high]]) {
      const g = back[k];
      console.log(`  ${c.name} ${k}: ${want[0]}km/h ${want[1]}° → ` +
        `${g.speedKmh.toFixed(2)}km/h ${g.bearingDeg.toFixed(2)}°`);
      ok(near(g.speedKmh, want[0], 0.02), `${c.name} ${k} 속도 왕복`);
      ok(angDiff(g.bearingDeg, want[1]) < 0.02, `${c.name} ${k} 방위 왕복`);
    }
  }

  console.log('\n== 층이 서로 섞이지 않는가 ==');
  stubFetch(response({ '850hPa': [10, 0], '600hPa': [20, 90], '250hPa': [40, 180] }));
  const sep = await W.fetchLayerWinds(41, 41, new Date('2026-08-28T00:00:00Z'));
  const s = W.layerWindsFrom({
    low: 0, mid: 0, high: 0, distance: 0, azimuthOffset: 0,
    windULow: sep.windULow[0], windVLow: sep.windVLow[0],
    windUMid: sep.windUMid[0], windVMid: sep.windVMid[0],
    windUHigh: sep.windUHigh[0], windVHigh: sep.windVHigh[0],
  });
  // 850 → low, 600 → mid, 250 → high. 순서가 뒤집히면 상층운이
  // 하층운보다 **느리게** 흘러 하늘이 거꾸로 보입니다.
  ok(near(s.low.speedKmh, 10, 0.02) && angDiff(s.low.bearingDeg, 0) < 0.02, '850hPa → low');
  ok(near(s.mid.speedKmh, 20, 0.02) && angDiff(s.mid.bearingDeg, 90) < 0.02, '600hPa → mid');
  ok(near(s.high.speedKmh, 40, 0.02) && angDiff(s.high.bearingDeg, 180) < 0.02, '250hPa → high');

  console.log('\n== 실패하면 대용값으로 내려앉는가 ==');
  stubFetch(null, { fail: true });
  const dead = await W.fetchLayerWinds(51, 51, new Date('2026-08-28T00:00:00Z'));
  ok(dead === null, '요청 실패는 예외가 아니라 null (하늘은 계속 그려집니다)');

  const fb = SC.resolveLayerWinds(undefined);
  ok(fb.measured === false, '실측 없음이 measured:false 로 드러난다');
  ok(fb.winds.low.speedKmh === SC.PLACEHOLDER_WIND_SPEED_KMH, '대용값 하층 속도');
  // 상층이 하층보다 빨라야 합니다 — 제트류. 같은 값이면 층별 이류가
  // 사실상 하나의 바람이 됩니다.
  ok(fb.winds.high.speedKmh > fb.winds.mid.speedKmh &&
     fb.winds.mid.speedKmh > fb.winds.low.speedKmh,
    `대용값도 고도가 오를수록 빠르다 (${fb.winds.low.speedKmh.toFixed(0)} < ` +
    `${fb.winds.mid.speedKmh.toFixed(0)} < ${fb.winds.high.speedKmh.toFixed(0)} km/h)`);

  const real = SC.resolveLayerWinds({
    low: 0, mid: 0, high: 0, distance: 0, azimuthOffset: 0,
    windULow: 5, windVLow: 5, windUMid: 5, windVMid: 5, windUHigh: 5, windVHigh: 5,
  });
  ok(real.measured === true, '성분이 있으면 measured:true');

  // 층 하나라도 빠지면 전체가 대용값입니다 — 세 층 중 둘만 실측이면
  // 층 사이 속도비가 실제와 대용값이 섞인 엉뚱한 값이 됩니다.
  const partial = SC.resolveLayerWinds({
    low: 0, mid: 0, high: 0, distance: 0, azimuthOffset: 0,
    windULow: 5, windVLow: 5, windUMid: 5, windVMid: 5,
  });
  ok(partial.measured === false, '한 층이라도 없으면 통째로 대용값');

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
