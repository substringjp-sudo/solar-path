/**
 * **올려다본 구름을 가까운 산이 가리는가** 합격 판정. `build-cloud-ridge.js` 의 짝.
 *
 * 표본 화소마다 CPU 가 같은 DEM 타일을 **따로** 풀어(dem-cpu.js) 시선을
 * 따라갑니다(발밑 로그 80점 + 균일 480걸음, 70km 까지):
 *
 *   구름에 닿기 전에 땅이 시선보다 높다 → "능선" (구름이 없어야 함)
 *   끝까지 땅이 아래                    → "구름" (구름이 있어야 함)
 *   바다 수평선 아래                    → 뺌 (슬랩이 원래 안 그림)
 *
 * 시선과 땅이 0.15°(바닥 1m) 안에서 갈리는 화소는 뺍니다(`verify-cloud-sea-terrain`
 * 과 같은 이유). 뺀 수는 찍습니다.
 *
 * ## 자가 공허 점검
 *
 * - "능선" 화소가 충분해야 합니다 — 없으면 가림을 시험한 적이 없습니다.
 * - 가림을 **끈** 판(uTerrainOccludeSky = 0, 패치는 같음)에서 "능선" 화소에
 *   구름이 그려져야 합니다 — 그게 고치기 전의 결함이고, 켠 판과 달라야 가림이
 *   실제로 일을 한 것입니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/build-cloud-ridge.js
 * 사용: node tools/shader-preview/verify-cloud-ridge.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN, PREVIEW } = require('./paths');
const { makeCpuDem, tileSpanMetres } = require('./dem-cpu');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const R_KM = 6371;
const TAU_MIN = 0.16, STEPS = 480, MAX_KM = 70;
const tolM = (dM) => Math.max(1.0, dM * Math.tan(0.15 * Math.PI / 180));

(async () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(PREVIEW, 'cloud-ridge.json'), 'utf8'));
  const demDir = path.join(PREVIEW, cfg.DIR);
  const fine = makeCpuDem({ demDir, zoom: cfg.zFine, lat: cfg.LAT, lon: cfg.LON });
  const far = makeCpuDem({ demDir, zoom: cfg.zFar, lat: cfg.LAT, lon: cfg.LON });
  const rp = 0.98 * 0.5 * (cfg.BLOCK - 1) * tileSpanMetres(cfg.zFine, cfg.LAT);
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const terrM = (e, s) => {
    const f = fine.elevAtGround(e, s), g = far.elevAtGround(e, s);
    if (f == null) return g;
    if (g == null) return f;
    const w = 1 - sstep(rp * 0.30, rp * 0.98, Math.hypot(e, s));
    return g + (f - g) * w;
  };
  const eyeKm = cfg.eyeM / 1000;
  const horizonSinE = -Math.sin(Math.acos(R_KM / (R_KM + eyeKm)));

  const classify = (dx, dy, dz) => {
    const sinE = dy, cosE = Math.hypot(dx, dz);
    if (sinE <= horizonSinE + 0.002) return { k: '아래' };
    // 저층 껍질(1.6km 판의 밑면)까지의 슬랜트 — 관측자가 아래이므로 양근 하나.
    const A = R_KM + cfg.LOW_KM, B = R_KM + eyeKm;
    const tCloud = -B * sinE + Math.sqrt(A * A - B * B * cosE * cosE);
    const tEnd = Math.min(tCloud, MAX_KM);
    const hx = cosE > 1e-6 ? dx / cosE : 0, hz = cosE > 1e-6 ? dz / cosE : 0;
    const ts = [];
    for (let i = 0; i < 80; i++) ts.push((0.5 * Math.pow(600, i / 79)) / 1000 / Math.max(cosE, 1e-3));
    for (let i = 1; i <= STEPS; i++) ts.push(tEnd * i / STEPS);
    ts.sort((a, b) => a - b);
    let minQ = Infinity, hit = false;
    for (const t of ts) {
      if (t > tEnd) break;
      const dKm = t * cosE;
      const rayM = (eyeKm + t * sinE + dKm * dKm / (2 * R_KM)) * 1000;
      const h = terrM(hx * dKm * 1000, hz * dKm * 1000);
      if (h == null) continue;
      const m = rayM - h;
      const q = m / tolM(dKm * 1000);
      if (q < minQ) minQ = q;
      if (m < 0) hit = true;
    }
    return { k: hit ? '능선' : '구름', q: minQ, tCloud };
  };

  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/cloud-ridge.html', { timeout: 600000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 600000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0, `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/ERR/.test(title), `셰이더 컴파일 · 패치 적재 (${title}${errs.length ? ' — ' + errs[0] : ''})`);
  if (!stats) { console.log('\nFAILURES — __stats 없음'); process.exit(1); }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);
  console.log(`  눈높이 ${stats.eyeM.toFixed(1)}m · 저층 ${stats.lowKm}km`);

  const tally = { 능선: [0, 0], 구름: [0, 0] };
  let 뺌 = 0, 아래 = 0, 끔_능선 = 0, 끔_능선_구름 = 0, 끔_구름 = 0, 끔_구름_구름 = 0;
  console.log('\n판           능선(구름/표본)   구름(구름/표본)');
  for (const v of stats.판) {
    const row = { 능선: [0, 0], 구름: [0, 0] };
    v.on.forEach(([dx, dy, dz, tau], i) => {
      const c = classify(dx, dy, dz);
      if (c.k === '아래') { 아래++; return; }
      if (Math.abs(c.q) < 1) { 뺌++; return; }
      const has = tau >= TAU_MIN, hadOff = v.off[i] >= TAU_MIN;
      row[c.k][0]++; if (has) row[c.k][1]++;
      if (c.k === '능선') { 끔_능선++; if (hadOff) 끔_능선_구름++; }
      else { 끔_구름++; if (hadOff) 끔_구름_구름++; }
    });
    for (const k of Object.keys(tally)) { tally[k][0] += row[k][0]; tally[k][1] += row[k][1]; }
    const f = k => `${row[k][1]}/${row[k][0]}`.padStart(10);
    console.log(`  ${String(v.az).padStart(3)}° ${String(v.pitch).padStart(3)}°   ${f('능선')}        ${f('구름')}`);
  }
  console.log(`  바다 수평선 아래 ${아래} · 0.15° 안에서 갈려 뺀 화소 ${뺌}`);

  console.log('\n== 자가 공허 점검 ==');
  ok(tally.능선[0] >= 200, `"능선" 화소가 충분하다 (${tally.능선[0]}) — 가림이 시험된다`);
  ok(tally.구름[0] >= 200, `"구름" 화소가 충분하다 (${tally.구름[0]})`);
  ok(끔_능선 > 0 && 끔_능선_구름 / 끔_능선 > 0.95,
    `가림을 끄면 능선 앞에 구름이 그려진다 (${끔_능선_구름}/${끔_능선}) — 고치기 전의 결함`);
  ok(끔_구름 > 0 && 끔_구름_구름 / 끔_구름 > 0.98,
    `가림을 끈 판도 트인 하늘에는 구름이 있다 (${끔_구름_구름}/${끔_구름}) — 운량 100% 가 먹혔다`);

  console.log('\n== 판정 ==');
  const r = k => tally[k][0] ? tally[k][1] / tally[k][0] : NaN;
  ok(r('능선') <= 0.02, `능선이 앞이면 구름을 안 그린다 (${tally.능선[1]}/${tally.능선[0]} = ${(r('능선') * 100).toFixed(2)}%)`);
  ok(r('구름') >= 0.98, `트인 하늘에는 구름을 그린다 (${tally.구름[1]}/${tally.구름[0]} = ${(r('구름') * 100).toFixed(2)}%)`);

  console.log('\n== 지평선 굽기 — 속도만 바꾸고 그림은 그대로인가 ==');
  const diffs = stats.판.map(v => v.굽기차이);
  ok(diffs.every(d => d === 0), `굽은 판과 안 굽은 판이 바이트 단위로 같다 (방향별 다른 바이트: ${diffs.join(' ')})`);
  const C = stats.비용;
  const over = x => ((x / C.가림끔 - 1) * 100).toFixed(0) + '%';
  console.log(`  한 장 ${C.가림끔}ms(가림 끔) · ${C.굽기없음}ms(다 걸음, ${over(C.굽기없음)}) · ${C.굽기}ms(굽기, ${over(C.굽기)})`);
  ok(C.굽기 < C.굽기없음, '굽으면 다 걷는 것보다 빠르다');

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
