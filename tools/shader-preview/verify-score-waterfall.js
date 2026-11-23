/**
 * **점수 · 한계등급 가감 막대(워터폴)가 앱의 실제 계산과 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * `src/utils/scoreWaterfall.ts` 는 노을 점수(`SunsetScoreBreakdown`)와 별 한계등급(`StarResult`)을 "앞 단계가 남긴 값에서 다음 단계가 얼마를 깎았나" 순서의
 * 막대 한 줄씩으로 풀어 냅니다. 화면이 그린 막대와 설명 줄이 실제 점수와 갈라지면 "왜 이 점수인가" 가 거짓말을 하게 되므로 합이 맞는지가 핵심입니다.
 * (목업의 "기준 40 · +18 · −12 …" 는 예시 값이었습니다. 실제 점수는 100 에서 깎이기만 하고, 한계등급은 6.5 에서 깎이기만 합니다.)
 *
 * 먼저 정한 줄:
 *  1. 노을 모양 — 시작 100, 줄 id 가 순서대로 window · paint · path · weather, 줄마다 delta ≤ 0, after 는 앞 줄 after + delta.
 *  2. 손으로 푼 값 — breakdown { sunWindow .5, pathClarity .8, paintedCloud .6, weatherClear .7 }:
 *       맑은 하늘 몫 38·.5·.8·.7^.85 = 11.2248 (.7^.85 = .73847), 구름 몫 62·.6·.7^.55 = 30.5736 (.7^.55 = .82187), 끝 41.7984.
 *       window −19, paint −24.8, path −3.8, weather −10.6016(= 맑은 하늘 몫 −3.9752 와 구름 몫 −6.6264). (처음 적을 때 거듭제곱을 손으로 어림해 41.7941 · −10.6059 로 적었다. 파이썬으로 다시 풀어 고쳤다.)
 *  3. 끝 = 앱의 계산 — `predictSunset` 이 낸 breakdown 으로 만든 끝 값이 baseSkyGlow + cloudRedScore 와 같고, 반올림해 0~100 으로 자르면 점수와 같다.
 *  4. 별 모양 — 시작은 startMag(6.5), 줄은 어두운 밤이면 moon · light · haze, 박명이면 twilight 가 맨 앞에 끼고, delta 는 모델의 단계별 값과 같다(구름은 등급을 바꾸지 않으므로 줄이 아니다).
 *     끝은 limitMag 와 0.25 등급 안.
 *  5. 막대 눈금 — scaleMax 는 노을 100, 별 7(막대가 칸을 넘지 않는다).
 *  6. 없는 값 — breakdown 이 없으면 노을 null.
 *  7. 글 — NaN · undefined · Infinity 가 없고 en · ja 글에 한글이 없다.
 *  8. 앱 연결 — 만들기 길(calcTopic)이 두 주제에 waterfall 을 싣고, 화면(WhySection)이 막대(WaterfallBars)를 위에, 단계 줄(가감을 오른쪽에)을 아래에 그리며,
 *     막대 사이에 점선 연결선을 그린다.
 */
const path = require('path');
const fs = require('fs');
const { PREVIEW, REPO_ROOT } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

(async () => {
  const W = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'scoreWaterfall.js'));
  const SP = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'sunsetPhysics.js'));
  const SV = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'starVisibility.js'));

  console.log('\n[1] 노을 모양 · [2] 손으로 푼 값');
  const hand = { sunAltDeg: 0.5, effectiveSunAlt: 0.5, sunWindow: 0.5, pathClarity: 0.8, paintedCloud: 0.6, weatherClear: 0.7, skyClear: 0.8, airClear: 0.875,
    rawLitCloud: 0.5, weatherDreary: 0.3, obs: { low: 10, mid: 20, high: 30, humidity: 50, visibilityM: 20000, precipMm: 0, waterKg: 18 },
    layers: { high: { cover: 0.3, lit: 0.3 }, mid: { cover: 0.2, lit: 0.1 }, low: { cover: 0.1, lit: 0 } },
    baseSkyGlow: 38 * 0.5 * 0.8 * Math.pow(0.7, 0.85), cloudRedScore: 62 * 0.6 * Math.pow(0.7, 0.55) };
  const w = W.sunsetWaterfall(hand, 'ko');
  ok(w && w.unit === 'pts' && w.start === 100, `시작 100 (${w && w.start})`);
  ok(w && w.rows.map(r => r.id).join() === 'window,paint,path,weather', `줄 id 순서 (${w && w.rows.map(r => r.id)})`);
  ok(w && w.rows.every((r, i) => r.delta <= 1e-9 && near(r.after, (i === 0 ? 100 : w.rows[i - 1].after) + r.delta, 1e-9)), '모든 줄 delta ≤ 0, after = 앞 after + delta');
  const exp = [-19, -24.8, -3.8, -10.6016];
  ok(w && w.rows.every((r, i) => near(r.delta, exp[i], 1e-3)), `손으로 푼 delta ${exp} (실제 ${w && w.rows.map(r => r.delta.toFixed(4))})`);
  ok(w && near(w.end, 41.7984, 1e-3), `끝 41.7984 (실제 ${w && w.end.toFixed(4)})`);
  ok(w && w.scaleMax === 100, '눈금 최대 100');

  console.log('\n[3] 끝 = 앱의 계산');
  {
    const mk = (low, mid, high, d, off) => ({ distance: d, azimuthOffset: off, source: 'standard', hourly: { time: ['2026-11-19T17:00'], timeMs: [Date.parse('2026-11-19T17:00:00+09:00')], low: [low], mid: [mid], high: [high], directNormalIrradiance: [300], totalColumnWaterVapour: [18], precipitation: [0], visibility: [20000], humidity: [55] } });
    const T0 = new Date('2026-11-19T17:00:00+09:00');
    const ringPath = (lo, mi, hi) => [mk(lo, mi, hi, 0, 0), ...[30, 60, 100, 200].flatMap(d => [0, 90, 180, 270].map(a => mk(a === 0 ? 0 : lo * 0.8, mi, hi, d, a)))];
    let bad = [];
    for (const [lo, mi, hi, alt] of [[4, 18, 63, 0.5], [60, 80, 90, 0.5], [0, 0, 0, 1], [10, 10, 10, 40], [30, 40, 70, -2]]) {
      const pred = SP.predictSunset(ringPath(lo, mi, hi), T0, alt, 20000, 55, 37.5, 30, 323, 250);
      const b = pred.breakdown; const ww = W.sunsetWaterfall(b, 'ko');
      if (!ww) { bad.push(`${lo},${mi},${hi},${alt}: null`); continue; }
      const truth = b.baseSkyGlow + b.cloudRedScore;
      if (!near(ww.end, truth, 1e-6)) bad.push(`${lo},${mi},${hi},${alt}: end ${ww.end} ≠ ${truth}`);
      if (Math.max(0, Math.min(100, Math.round(ww.end))) !== pred.score) bad.push(`${lo},${mi},${hi},${alt}: 반올림 ${Math.round(ww.end)} ≠ 점수 ${pred.score}`);
      if (!near(ww.rows[ww.rows.length - 1].after, ww.end, 1e-6)) bad.push(`${lo},${mi},${hi},${alt}: 마지막 after ≠ end`);
    }
    ok(bad.length === 0, `실제 예측 5 장면에서 끝 = baseSkyGlow + cloudRedScore, 반올림 = 점수${bad.length ? ': ' + bad.slice(0, 3).join(' / ') : ''}`);
  }

  console.log('\n[4] 별');
  {
    const TIME_IN = (o) => ({ cloudPct: 10, sunAltDeg: -30, moonAltDeg: 40, moonIllum: 0.9, lightPollutionMag: 4.5, aod550: 0.3, ...o });
    const fm = (d) => d.toFixed(1);
    let bad = [];
    for (const o of [{}, { sunAltDeg: -10 }, { moonAltDeg: -20 }, { lightPollutionMag: 6.2, aod550: 0.02, moonAltDeg: -20 }, { lightPollutionMag: null, aod550: null }]) {
      const inp = TIME_IN(o); const r = SV.starLimit(inp); const ww = W.starWaterfall(r, 'ko');
      const ids = ww.rows.map(x => x.id).join();
      const want = (r.twilight ? 'twilight,' : '') + 'moon,light,haze';
      if (ids !== want) bad.push(`ids ${ids} ≠ ${want}`);
      if (!near(ww.start, r.startMag, 1e-9)) bad.push('start');
      const d = Object.fromEntries(ww.rows.map(x => [x.id, x.delta]));
      if (!near(d.moon, r.moon.deltaMag, 1e-9) || !near(d.light, r.light.deltaMag, 1e-9) || !near(d.haze, r.haze.deltaMag, 1e-9) || (r.twilight && !near(d.twilight, r.twilight.deltaMag, 1e-9))) bad.push('delta');
      if (Math.abs(ww.end - r.limitMag) > 0.25) bad.push(`end ${ww.end} vs ${r.limitMag}`);
      if (ww.rows.some(x => x.delta > 1e-9)) bad.push('양수 delta');
      if (ww.unit !== 'mag' || ww.scaleMax !== 7) bad.push('unit/scale');
    }
    ok(bad.length === 0, `별 5 장면: 줄 id · 시작 · delta = 모델, 끝이 한계와 0.25 안, 눈금 7${bad.length ? ': ' + bad.slice(0, 3).join(' / ') : ''}`);
  }

  console.log('\n[6] 없는 값');
  ok(W.sunsetWaterfall(undefined, 'ko') === null && W.sunsetWaterfall(null, 'ko') === null, 'breakdown 없으면 null');

  console.log('\n[7] 글');
  {
    let badTxt = 0, han = 0;
    for (const L of ['ko', 'en', 'ja']) {
      const ws = [W.sunsetWaterfall(hand, L), W.starWaterfall(SV.starLimit(TIME_IN2()), L)];
      for (const ww of ws) { const t = JSON.stringify(ww); if (/NaN|undefined|Infinity/.test(t)) badTxt++; if (L !== 'ko' && /[가-힣]/.test(t)) han++; }
    }
    function TIME_IN2() { return { cloudPct: 10, sunAltDeg: -30, moonAltDeg: 40, moonIllum: 0.9, lightPollutionMag: 4.5, aod550: 0.3 }; }
    ok(badTxt === 0, 'NaN · undefined · Infinity 가 없다');
    ok(han === 0, 'en · ja 글에 한글이 없다');
  }

  console.log('\n[8] 앱 연결');
  {
    const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, 'src', ...p), 'utf8');
    const topic = read('utils', 'calcTopic.ts');
    const steps = read('utils', 'calcSteps.ts');
    const why = read('components', 'LearnScreen', 'WhySection.tsx');
    const bars = read('components', 'LearnScreen', 'WaterfallBars.tsx');
    ok(/waterfall/.test(topic) && /sunsetWaterfall\(/.test(steps) && /starWaterfall\(/.test(steps), '만들기 길이 노을 · 별 결과에 waterfall 을 싣는다');
    ok(/<WaterfallBars/.test(why) && /<WaterfallSteps/.test(why), '화면이 막대 · 단계 줄을 그린다');
    ok(/borderStyle: 'dashed'|strokeDasharray/.test(bars), '막대 사이 점선 연결선');
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
