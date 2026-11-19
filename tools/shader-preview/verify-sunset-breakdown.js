/**
 * **노을 점수의 단계별 중간값(breakdown)이 점수와 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * `sunsetPhysics.predictSunset` 이 점수를 만들며 이미 구한 값을 `breakdown` 으로 꺼냅니다(계산 과정 보기 용). 이 판정은 두 가지를 지킵니다.
 *  (a) **점수는 이 변경으로 달라지지 않았다** — 변경 전에 잰 8 건의 점수·품질·경로 투과율·머리 위 흐림을 그대로 기준표로 둡니다.
 *  (b) **중간값이 점수의 식을 다시 이룬다** — 화면이 "이 값들의 합" 이라고 보여 주는 것이 실제 점수와 같아야 합니다.
 *
 * 먼저 정한 줄:
 *  1. 기준표 — 8 건이 변경 전과 점수·품질이 같고 경로 투과율·머리 위 흐림이 1e-9 안.
 *  2. 합 — 무작위 입력 600 건에서 round(baseSkyGlow + cloudRedScore) 를 0~100 으로 자른 것이 score.
 *  3. 식 — baseSkyGlow = 38·sunWindow·pathClarity·weatherClear^0.85, cloudRedScore = 62·paintedCloud·weatherClear^0.55,
 *     weatherClear = skyClear·airClear, paintedCloud = (1−e^(−2.8·rawLitCloud))·pathClarity^0.85, rawLitCloud = Σ 층별 lit — 모두 1e-9 안.
 *  4. 연결 — breakdown.pathClarity 가 factors.pathClarity, 관측 원자료(저·중·상층 %)가 입력으로 준 값과 같다.
 *  5. 방향 — 해 쪽 길에 낮은 구름을 더하면 pathClarity 가 줄고, 높은 구름 비율이 늘면 high 층의 visible 이 는다.
 *  6. 입력이 잘못되면(해 고도 NaN) breakdown 은 없고 점수 0.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-sunset-breakdown.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const SP = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'sunsetPhysics.js'));
  const mk = (low, mid, high, d, off, wv = 18) => ({ distance: d, azimuthOffset: off, source: 'standard', hourly: { time: ['2026-11-19T17:00'], timeMs: [Date.parse('2026-11-19T17:00:00+09:00')], low: [low], mid: [mid], high: [high], directNormalIrradiance: [300], totalColumnWaterVapour: [wv], precipitation: [0], visibility: [20000], humidity: [55] } });
  const T = new Date('2026-11-19T17:00:00+09:00');
  const ringOf = (lo, mi, hi, sunLow = lo * 0.8) => [mk(lo, mi, hi, 0, 0), ...[30, 60, 100, 200].flatMap(d => [0, 90, 180, 270].map(a => mk(a === 270 ? sunLow : lo * 0.8, mi, hi, d, a)))];
  const predict = (ring, alt) => SP.predictSunset(ring, T, alt, 20000, 55, 37.5, 30, 323, 250);

  console.log('\n[1] 기준표 — 변경 전 값과 같다');
  {
    // [low, mid, high, 해 고도, 점수, 품질, 경로 투과율, 머리 위 흐림] — breakdown 을 넣기 전에 잰 값
    const GOLD = [[4, 18, 63, 0.5, 69, 'Great', 0.7667068839, 0.4543714286], [0, 0, 0, 1, 35, 'Fair', 1, 0], [90, 40, 10, 2, 0, 'Overcast', 0.2853182657, 1], [20, 60, 80, -1, 27, 'Muted', 0.3936651767, 0.72], [5, 5, 5, 8, 7, 'Muted', 0.9603091645, 0.135], [30, 30, 30, 0, 30, 'Muted', 0.4450486035, 0.525], [0, 10, 90, 0.2, 77, 'Epic', 0.8708914827, 0.432], [60, 0, 0, 3, 23, 'Muted', 0.6837210907, 0.57]];
    let bad = 0;
    for (const [lo, mi, hi, alt, score, q, pc, oo] of GOLD) {
      const p = predict(ringOf(lo, mi, hi), alt);
      if (p.score !== score || p.quality !== q || Math.abs(p.factors.pathClarity - pc) > 1e-9 || Math.abs(p.factors.overheadOvercast - oo) > 1e-9) { bad++; console.log('      어긋남', lo, mi, hi, alt, p.score, p.quality); }
    }
    ok(bad === 0, `8 건 모두 변경 전 점수·품질·투과율·흐림과 같다 (어긋남 ${bad})`);
  }

  console.log('\n[2][3] 합과 식 — 무작위 600 건');
  {
    let seed = 20261119; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let badSum = 0, badEq = 0, n = 0, worst = 0;
    for (let i = 0; i < 600; i++) {
      const lo = Math.round(rnd() * 100), mi = Math.round(rnd() * 100), hi = Math.round(rnd() * 100), alt = -6 + rnd() * 20;
      const p = predict(ringOf(lo, mi, hi, Math.round(rnd() * 100)), alt);
      const b = p.breakdown;
      if (!b) { badSum++; continue; }
      const sum = Math.max(0, Math.min(100, Math.round(b.baseSkyGlow + b.cloudRedScore)));
      if (sum !== p.score) badSum++;
      const e1 = Math.abs(b.baseSkyGlow - 38 * b.sunWindow * b.pathClarity * Math.pow(b.weatherClear, 0.85));
      const e2 = Math.abs(b.cloudRedScore - 62 * b.paintedCloud * Math.pow(b.weatherClear, 0.55));
      const e3 = Math.abs(b.weatherClear - b.skyClear * b.airClear);
      const e4 = Math.abs(b.paintedCloud - (1 - Math.exp(-2.8 * b.rawLitCloud)) * Math.pow(b.pathClarity, 0.85));
      const e5 = Math.abs(b.rawLitCloud - (b.layers.high.lit + b.layers.mid.lit + b.layers.low.lit));
      const e = Math.max(e1, e2, e3, e4, e5);
      worst = Math.max(worst, e);
      if (e > 1e-9) badEq++;
      n++;
    }
    ok(badSum === 0, `600 건 모두 round(baseSkyGlow + cloudRedScore) 를 0~100 으로 자른 값이 score (어긋남 ${badSum})`);
    ok(badEq === 0 && n === 600, `다섯 식이 모두 1e-9 안 (최대 오차 ${worst.toExponential(1)}, 어긋남 ${badEq})`);
  }

  console.log('\n[4] 연결');
  {
    const p = predict(ringOf(40, 25, 70), 1);
    ok(p.breakdown.pathClarity === p.factors.pathClarity, 'breakdown.pathClarity = factors.pathClarity');
    ok(p.breakdown.obs.low === 40 && p.breakdown.obs.mid === 25 && p.breakdown.obs.high === 70, `관측 원자료가 입력과 같다 (${p.breakdown.obs.low}/${p.breakdown.obs.mid}/${p.breakdown.obs.high})`);
    ok(p.breakdown.obs.humidity === 55 && p.breakdown.obs.visibilityM === 20000, '습도·시정은 predictSunset 에 준 값');
  }

  console.log('\n[5] 방향');
  {
    const clear = predict(ringOf(0, 0, 0, 0), 1), blocked = predict(ringOf(0, 0, 0, 90), 1);
    ok(blocked.breakdown.pathClarity < clear.breakdown.pathClarity - 0.05, `해 쪽 길에 낮은 구름 90% → 투과율 ${clear.breakdown.pathClarity.toFixed(2)} → ${blocked.breakdown.pathClarity.toFixed(2)}`);
    const few = predict(ringOf(0, 0, 20), 1), many = predict(ringOf(0, 0, 80), 1);
    ok(many.breakdown.layers.high.visible > few.breakdown.layers.high.visible, `높은 구름이 늘면 보이는 비율도 는다 (${few.breakdown.layers.high.visible.toFixed(2)} → ${many.breakdown.layers.high.visible.toFixed(2)})`);
  }

  console.log('\n[6] 잘못된 입력');
  {
    const p = predict(ringOf(10, 10, 10), NaN);
    ok(p.score === 0 && p.breakdown === undefined, '해 고도가 NaN 이면 점수 0, breakdown 없음');
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
