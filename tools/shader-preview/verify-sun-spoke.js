/**
 * **예측이 해 쪽 줄을 읽는가** — 링 날씨(절대 방위)를 해 기준으로 돌리는 `alignRingToSun` 의 판정.
 *
 * ## 사례
 *
 * 앱의 날씨는 모두 `fetchDayWeatherRing` 의 링입니다. 링의 `azimuthOffset` 은 절대 방위(0 = 북)인데,
 * `predictSunset` · `beamPathTransmittance` 는 `azimuthOffset === 0` 을 해 쪽 줄로 읽습니다(부채꼴 시절의
 * 약속). 그래서 해가 서쪽에 있어도 예측은 **북쪽 줄**의 구름으로 점수를 냈습니다(2026-10-25 발견).
 *
 * ## ⚠ 재기 전에 정한 문턱 (2026-10-25, 고침과 함께 박았습니다)
 *
 * - **S0 음성 대조**: 서쪽 줄에만 저층운 95%, 나머지 맑음, 해는 서쪽(270°) 고도 0.5°.
 *   해 방위를 주지 않으면(옛 호출) pathClarity ≥ 0.9(북쪽 맑은 줄을 읽음) — 버그를 재현하는지.
 *   해 방위를 주면 pathClarity ≤ 0.2 이고 점수가 옛 호출보다 낮다.
 * - **S1 부채꼴과 같다**: 해가 링 방위 위에 있으면(300°), 그 방위 줄만 떼어 만든 해 기준 부채꼴과
 *   점수 · pathClarity 가 같다(차 < 1e-9).
 *   ⚠ 처음에는 270° 로 적었습니다. 5km 고리(60° 간격)에는 270° 가 없어 그 거리만 240° · 300° 보간값이
 *   되고(pathClarity 0.2688 대 0.2703), 손으로 만든 부채꼴은 참값을 써서 어긋났습니다. 코드가 아니라
 *   시험의 각도 문제라, 두 고리 모두에 있는 300° 로 옮겼습니다. 문턱은 그대로입니다.
 * - **S2 보간**: 해 255°에서 30° 고리의 중심점 저층 = 240° · 270° 값의 평균, 60° 고리(5km)는
 *   240° · 300° 사이 1/4 지점(차 < 1e-9).
 * - **S3 이어짐**: 해를 180° → 360° 1° 씩 돌릴 때 이웃 두 점의 점수 차 ≤ 3, pathClarity 차 ≤ 0.05.
 * - **S4 이음매**: 해 175° 와 −185° 가 같다. 해 180° 에서 거리마다 중심점이 하나다(±180 복사본이 둘로
 *   세지지 않음).
 * - **S5 관측점**: 거리 0 점은 하나이고 값이 그대로다.
 * - **S6 돌려도 같다**: 구름 마당과 해를 함께 60° · 120° · 180° 돌리면 점수 · pathClarity 가 같다(차 < 1e-9).
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-sun-spoke.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

globalThis.__DEV__ = false;
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const U = (m) => import('file://' + path.join(PREVIEW, 'app', 'utils', m));
  const SP = await U('sunsetPhysics.js');
  const W = await U('weather.js');

  // 앱 링과 같은 모양(weather.ts `RING`): 관측점 + 5km 6방위 + 나머지 고리 12방위 + ±180 복사본.
  const NEAR = [0, 60, 120, 180, -120, -60];
  const FAR = [0, 30, 60, 90, 120, 150, 180, -150, -120, -90, -60, -30];
  const DISTS = [5, 10, 30, 70, 130, 200, 280, 380];
  const T0 = Date.UTC(2026, 9, 25, 8, 0);
  const times = [0, 1, 2].map(h => new Date(T0 + h * 3600e3).toISOString().slice(0, 16));
  const at = new Date(T0 + 3600e3);
  const pt = (distance, azimuthOffset, c) => ({
    distance, azimuthOffset, source: 'standard',
    hourly: {
      time: times, timeMs: times.map(t => new Date(t + 'Z').getTime()),
      low: [c.low, c.low, c.low], mid: [c.mid, c.mid, c.mid], high: [c.high, c.high, c.high],
      visibility: distance === 0 ? [24000, 24000, 24000] : undefined,
      humidity: distance === 0 ? [60, 60, 60] : undefined,
    },
  });
  const OBS = { low: 0, mid: 40, high: 20 };
  /** field(distance, bearing) → {low, mid, high}. bearing 은 0~360. */
  const ring = (field) => {
    const out = [pt(0, 0, OBS)];
    for (const d of DISTS) for (const az of (d === 5 ? NEAR : FAR)) out.push(pt(d, az, field(d, (az + 360) % 360)));
    for (const p of out.filter(p => p.azimuthOffset === 180)) out.push({ ...p, azimuthOffset: -180 });
    return out;
  };
  const predict = (pd, sunAz, alt = 0.5) => SP.predictSunset(pd, at, alt, 24000, 60, 37.5, 0, 298, sunAz);

  // ── S0 음성 대조
  const westOnly = ring((d, az) => (Math.abs(((az - 270 + 540) % 360) - 180) <= 30 ? { low: 95, mid: 0, high: 0 } : { low: 0, mid: 0, high: 0 }));
  const legacy = predict(westOnly, undefined);
  const fixed = predict(westOnly, 270);
  console.log(`  S0 옛 호출 점수 ${legacy.score} ${legacy.quality} pathClarity ${legacy.factors.pathClarity.toFixed(3)}` +
    ` → 해 방위 ${fixed.score} ${fixed.quality} pathClarity ${fixed.factors.pathClarity.toFixed(3)}`);
  ok(legacy.factors.pathClarity >= 0.9, `S0a 옛 호출은 북쪽 맑은 줄을 읽는다 — pathClarity ${legacy.factors.pathClarity.toFixed(3)} ≥ 0.9`);
  ok(fixed.factors.pathClarity <= 0.2 && fixed.score < legacy.score,
     `S0b 해 방위를 주면 서쪽 구름을 읽는다 — pathClarity ${fixed.factors.pathClarity.toFixed(3)} ≤ 0.2, 점수 ${fixed.score} < ${legacy.score}`);

  // ── 결정적인 울퉁불퉁한 구름 마당(S1 · S3 · S6 공용)
  const bumpy = (d, az) => {
    const r = Math.PI / 180;
    return {
      low: Math.max(0, 40 + 35 * Math.sin(az * r * 2 + d / 90)),
      mid: Math.max(0, 35 + 30 * Math.cos(az * r + d / 140)),
      high: Math.max(0, 30 + 25 * Math.sin(az * r * 3 - d / 200)),
    };
  };
  const bumpyRing = ring(bumpy);

  // ── S1 부채꼴과 같다
  const fan = [pt(0, 0, OBS), ...DISTS.map(d => pt(d, 0, bumpy(d, 300)))];
  const a1 = predict(bumpyRing, 300), f1 = predict(fan, undefined);
  ok(Math.abs(a1.score - f1.score) < 1e-9 && Math.abs(a1.factors.pathClarity - f1.factors.pathClarity) < 1e-9,
     `S1 해 300° 링 = 해 기준 부채꼴 — 점수 ${a1.score}/${f1.score} · pathClarity ${a1.factors.pathClarity.toFixed(4)}/${f1.factors.pathClarity.toFixed(4)}`);

  // ── S2 보간
  const interp = W.getInterpolatedWeather(bumpyRing, at);
  const aligned = SP.alignRingToSun(interp, 255);
  const c30 = aligned.find(p => p.distance === 30 && p.azimuthOffset === 0);
  const want30 = (bumpy(30, 240).low + bumpy(30, 270).low) / 2;
  const c5 = aligned.find(p => p.distance === 5 && p.azimuthOffset === 0);
  const want5 = bumpy(5, 240).low + (bumpy(5, 300).low - bumpy(5, 240).low) * 0.25;
  ok(c30 && Math.abs(c30.low - want30) < 1e-9 && c5 && Math.abs(c5.low - want5) < 1e-9,
     `S2 해 255° 중심점 저층 — 30km ${c30?.low.toFixed(3)} (240·270 평균 ${want30.toFixed(3)}) · 5km ${c5?.low.toFixed(3)} (240→300 1/4 ${want5.toFixed(3)})`);

  // ── S3 이어짐
  let maxDS = 0, maxDP = 0, worst = 0;
  let prev = predict(bumpyRing, 180);
  for (let az = 181; az <= 360; az++) {
    const cur = predict(bumpyRing, az);
    const ds = Math.abs(cur.score - prev.score), dp = Math.abs(cur.factors.pathClarity - prev.factors.pathClarity);
    if (ds > maxDS) { maxDS = ds; worst = az; }
    maxDP = Math.max(maxDP, dp);
    prev = cur;
  }
  ok(maxDS <= 3 && maxDP <= 0.05, `S3 해 180→360° 1° 씩 — 이웃 점수 차 최대 ${maxDS}(${worst}°) ≤ 3 · pathClarity 차 최대 ${maxDP.toFixed(4)} ≤ 0.05`);

  // ── S4 이음매
  const p175 = predict(bumpyRing, 175), pm185 = predict(bumpyRing, -185);
  const seam = SP.alignRingToSun(interp, 180);
  const perDist = DISTS.map(d => seam.filter(p => p.distance === d && p.azimuthOffset === 0).length);
  ok(Math.abs(p175.score - pm185.score) < 1e-9 && Math.abs(p175.factors.pathClarity - pm185.factors.pathClarity) < 1e-9 && perDist.every(n => n === 1),
     `S4 175° = −185° (점수 ${p175.score}/${pm185.score}) · 해 180° 거리마다 중심점 ${perDist.join(',')}`);

  // ── S5 관측점
  const obsPts = aligned.filter(p => p.distance === 0);
  const obs0 = interp.find(p => p.distance === 0);
  ok(obsPts.length === 1 && obsPts[0].azimuthOffset === 0 && obsPts[0].low === obs0.low && obsPts[0].mid === obs0.mid && obsPts[0].high === obs0.high,
     `S5 관측점 하나 · 값 그대로 (${obsPts.length}점, 저/중/상 ${obsPts[0]?.low}/${obsPts[0]?.mid}/${obsPts[0]?.high})`);

  // ── S6 돌려도 같다
  const base = predict(bumpyRing, 250);
  const rot = [60, 120, 180].map(R => {
    const r = predict(ring((d, az) => bumpy(d, (az - R + 360) % 360)), 250 + R);
    return { R, ds: Math.abs(r.score - base.score), dp: Math.abs(r.factors.pathClarity - base.factors.pathClarity) };
  });
  ok(rot.every(x => x.ds < 1e-9 && x.dp < 1e-9),
     `S6 마당과 해를 함께 돌림 — ${rot.map(x => `${x.R}° Δ점수 ${x.ds} Δclarity ${x.dp.toExponential(1)}`).join(' · ')}`);

  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
