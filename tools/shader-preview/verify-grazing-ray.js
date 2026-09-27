/**
 * **스치는 햇빛 광선 적분** 판정 (§106) — `src/utils/grazingRay.ts` 가 표준값을 재현하는가.
 *
 * 자(재기 전에 정함, 전부 공개된 표준값):
 *  - 대기질량: 지상에서 겉보기 고도 1·2·5·10·30·60·90° 의 공기 기둥이 Kasten–Young(1989)의 ±3%.
 *    지평선(0°)은 ±5%(38.1).
 *  - 지평선 굴절: 천문 표준 34′(0.567°) ±0.05°.
 *  - 높은 곳에서 해가 보이는 한계: 항해력의 수평선 강하 1.76′√h(m)(표준 지상 굴절 포함)를 지구
 *    중심각으로 바꾸고(굴절계수 1−k = (1.76/1.93)², 중심각 = 2.116′√h) 지평선 굴절 34′ 를 더한 값
 *    ±0.1° — 1.5km: −1.93°, 10km: −4.09°.
 *  - 해가 높을 때(30°) 옛 식(beamAtAltitude)과 새 식의 직달이 ±5% — 낮 햇빛은 건드리지 않는다.
 * 대조(자가 결함을 보는가): 해 0° 에 1.5km 구름이 받는 공기 기둥이 옛 식보다 1.3배 넘게 크다
 * — 옛 식이 스치는 광선을 과소평가하던 것.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/verify-grazing-ray.js
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const G = await import(pathToFileURL(path.join(PREVIEW, 'app/utils/grazingRay.js')).href);
  const A = await import(pathToFileURL(path.join(PREVIEW, 'app/utils/atmosphere.js')).href);
  const SP = await import(pathToFileURL(path.join(PREVIEW, 'app/utils/sunsetPhysics.js')).href);
  const KY = g => 1 / (Math.sin(g * Math.PI / 180) + 0.50572 * Math.pow(g + 6.07995, -1.6364));

  console.log('== 대기질량 (지상, 겉보기 고도) ==');
  for (const e of [1, 2, 5, 10, 30, 60, 90]) {
    const c = G.traceRay(0, e), k = KY(e), r = c.mR / k;
    ok(Math.abs(r - 1) <= 0.03, `${e}°: 광선 ${c.mR.toFixed(2)} · Kasten–Young ${k.toFixed(2)} (${(100 * (r - 1)).toFixed(1)}%)`);
  }
  { const c = G.traceRay(0, 0), k = KY(0);
    ok(Math.abs(c.mR / k - 1) <= 0.05, `지평선: 광선 ${c.mR.toFixed(2)} · Kasten–Young ${k.toFixed(2)}`); }

  console.log('\n== 굴절 ==');
  { const c = G.traceRay(0, 0), refr = -c.eTrueDeg;
    ok(Math.abs(refr - 0.567) <= 0.05, `지평선 굴절 ${refr.toFixed(3)}° (표준 34′ = 0.567°)`); }
  for (const hKm of [1.5, 10]) {
    const hm = hKm * 1000, expect = -(2.116 * Math.sqrt(hm) + 34) / 60;
    const limb = G.grazingTable(hKm).eLimbDeg;
    ok(Math.abs(limb - expect) <= 0.1, `${hKm}km 에서 해가 보이는 한계 ${limb.toFixed(3)}° (항해력 dip + 34′ → ${expect.toFixed(3)}°)`);
  }

  console.log('\n== 옛 식과의 관계 ==');
  const atm = A.makeAtmosphereParams({ latitude: 37.5, observerElevM: 0, dayOfYear: 200, humidityPct: 60, visibilityM: 20000 });
  const Y = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  { const o = Y(A.beamAtAltitude(30, 1.5, atm)), n = Y(G.beamGrazing(30, 1.5, atm));
    ok(Math.abs(n / o - 1) <= 0.05, `해 30°·1.5km: 직달 옛 ${o.toFixed(4)} · 새 ${n.toFixed(4)} (${(100 * (n / o - 1)).toFixed(1)}%)`); }
  // 옛 식의 공기 기둥: Kasten–Young(겉보기(해+dip)) × exp(−h/8km)
  { const dip = Math.acos(6371 / 6372.5) * 180 / Math.PI;
    const oldM = KY(SP.getApparentAltitude(dip)) * Math.exp(-1.5 / 8);
    const t = G.grazingTable(1.5);
    let lo = 0; while (lo < t.eTrue.length - 1 && t.eTrue[lo + 1] <= 0) lo++;
    const newM = t.mR[lo];
    ok(newM > 1.3 * oldM, `대조: 해 0°·1.5km 공기 기둥 — 새 ${newM.toFixed(1)} · 옛 ${oldM.toFixed(1)} (옛 식이 스치는 길을 과소평가)`); }

  console.log('\n참고 — 해 0° 에 1.5km 구름: 머리 위 vs 해쪽 거리 d 의 직달(휘도)');
  for (const d of [0, 50, 100, 200, 300]) {
    const e = d / 6371 * 180 / Math.PI;
    console.log(`  d ${String(d).padStart(3)}km (해 +${e.toFixed(2)}°): ${Y(G.beamGrazing(e, 1.5, atm)).toExponential(2)}  (옛 식 ${Y(A.beamAtAltitude(e, 1.5, atm)).toExponential(2)})`);
  }
  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
