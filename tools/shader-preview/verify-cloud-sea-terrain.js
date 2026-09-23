/**
 * **운해를 땅이 가리는가** 합격 판정. `build-cloud-sea-terrain.js` 의 짝.
 *
 * 표본 화소마다 CPU 가 같은 DEM 타일을 **따로** 풀어(dem-cpu.js — PNG 를 Node
 * 가 직접 디코드, 셰이더와 겹치는 코드 없음) 시선을 400걸음으로 따라갑니다:
 *
 *   덱에 닿기 전에 땅이 시선보다 높다  → "땅"   (운해가 없어야 함)
 *   끝까지 땅이 아래에 있다           → "운해" (운해가 있어야 함)
 *   시선이 덱에 안 닿는다(가장자리 위) → "하늘"(운해가 없어야 함)
 *
 * 시선과 땅이 0.15°(바닥 1m) 안에서 갈리는 화소는 뺍니다 — 셰이더는
 * 32+8걸음이고 CPU 는 480걸음이라, 스치는 시선은 둘이 달라도 결함이 아닙니다.
 * 뺀 수는 찍습니다.
 *
 * ## 자가 공허 점검
 *
 * - "땅" 화소가 충분히 있어야 합니다 — 없으면 가림을 시험한 적이 없습니다.
 * - **덱 위로 솟은 봉우리**(맞은 지점 고도 > 덱 윗면)가 있어야 합니다 —
 *   운해를 뚫고 나온 능선이 이 기능의 핵심 장면입니다.
 * - 가림을 **끈** 판에서는 "땅" 화소에 운해가 그려져야 합니다 — 켠 판과
 *   달라야 가림이 실제로 일을 한 것입니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/build-cloud-sea-terrain.js
 * 사용: node tools/shader-preview/verify-cloud-sea-terrain.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN, PREVIEW } = require('./paths');
const { makeCpuDem, tileSpanMetres } = require('./dem-cpu');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const R_KM = 6371;
const TAU_MIN = 0.16, STEPS = 400;
/**
 * 애매함의 폭 — **각도로** 잽니다(화소 0.3° 의 절반, 0.15°).
 *
 * ⚠ 처음에는 15m 고정이었습니다. 그러면 발밑 20m 앞 땅(시선과 0.1m 차)도
 *   "애매함" 이 아니라 판정 대상이 되고, 반대로 30km 밖 능선은 15m 차도
 *   화면에서 0.03° 라 사실상 애매합니다. 거리에 비례해야 합니다. GPU·CPU
 *   고도 차(수십 cm)를 덮으려고 바닥 1m 를 둡니다.
 */
const tolM = (dM) => Math.max(1.0, dM * Math.tan(0.15 * Math.PI / 180));

(async () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(PREVIEW, 'cloud-sea-terrain.json'), 'utf8'));
  const demDir = path.join(PREVIEW, cfg.DIR);
  const fine = makeCpuDem({ demDir, zoom: cfg.zFine, lat: cfg.LAT, lon: cfg.LON });
  const far = makeCpuDem({ demDir, zoom: cfg.zFar, lat: cfg.LAT, lon: cfg.LON });
  // 셰이더와 같은 넘기기 반지름(0.30 ~ 0.98 × 보장 반지름). 보장 반지름 = 0.98·(블록−1)/2·타일.
  const rp = 0.98 * 0.5 * (cfg.BLOCK - 1) * tileSpanMetres(cfg.zFine, cfg.LAT);
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const terrM = (e, s) => {
    const f = fine.elevAtGround(e, s), g = far.elevAtGround(e, s);
    if (f == null) return g;
    if (g == null) return f;
    const w = 1 - sstep(rp * 0.30, rp * 0.98, Math.hypot(e, s));
    return g + (f - g) * w;
  };
  const eyeKm = cfg.eyeM / 1000, topKm = cfg.DECK[1];

  /** 한 시선의 CPU 판정. */
  const classify = (dx, dy, dz) => {
    const sinE = dy, cosE = Math.hypot(dx, dz);
    const A = R_KM + topKm, B = R_KM + eyeKm;
    const disc = A * A - B * B * cosE * cosE;
    if (disc < 0) return { k: '하늘' };
    const tFar = -B * sinE + Math.sqrt(disc);
    if (!(tFar > 0) || B <= A) return { k: '하늘' };
    const tEnd = (B * B - A * A) / tFar;
    const hx = cosE > 1e-6 ? dx / cosE : 0, hz = cosE > 1e-6 ? dz / cosE : 0;
    let minMargin = Infinity, minQ = Infinity, hitElev = null, hitDistM = null;
    // ⚠ 발밑을 **촘촘히** 봐야 합니다. 눈은 땅 위 1.6m 뿐이라 사면에서는
    //   5~20m 앞 땅이 시선보다 0.5~1.6m 높고, 지형 메시는 그 화소에 **가까운
    //   땅**을 그립니다. 균일 400걸음은 첫 걸음이 20~50m 라 그걸 못 봤고,
    //   셰이더가 옳게 가린 운해 78화소를 결함으로 읽었습니다.
    //   0.5m~300m 를 로그 간격 80점으로 더 봅니다.
    const ts = [];
    for (let i = 0; i < 80; i++) ts.push((0.5 * Math.pow(600, i / 79)) / 1000 / Math.max(cosE, 1e-3));
    for (let i = 1; i <= STEPS; i++) ts.push(tEnd * i / STEPS);
    ts.sort((a, b) => a - b);
    for (const t of ts) {
      if (t > tEnd) break;
      const dKm = t * cosE;
      const rayM = (eyeKm + t * sinE + dKm * dKm / (2 * R_KM)) * 1000;
      const h = terrM(hx * dKm * 1000, hz * dKm * 1000);
      if (h == null) continue;
      const m = rayM - h;
      if (m < minMargin) minMargin = m;
      const q = m / tolM(dKm * 1000);
      if (q < minQ) minQ = q;
      // ⚠ 첫 교차에서 멈추면 안 됩니다 — 그 걸음의 여유는 늘 몇 m 뿐이라
      //   "땅" 화소가 전부 애매함으로 빠집니다(처음에 그래서 10,430개를 뺐습니다).
      //   끝까지 가며 **가장 깊이 파고든** 값을 여유로 씁니다.
      if (m < 0 && hitElev == null) { hitElev = h; hitDistM = dKm * 1000; }
    }
    if (hitElev != null) return { k: '땅', margin: minMargin, q: minQ, hitElev, hitDistM };
    return { k: '운해', margin: minMargin, q: minQ };
  };

  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/cloud-sea-terrain.html', { timeout: 600000 });
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
  console.log(`  눈높이 ${stats.eyeM.toFixed(1)}m · 덱 ${stats.deck[0]}~${stats.deck[1]}km`);

  const tally = { 땅: [0, 0], 운해: [0, 0], 하늘: [0, 0] };   // [표본, 운해가 그려진 수]
  let 뺌 = 0, 봉우리 = 0, 봉우리_운해 = 0, 끔_땅_운해 = 0, 끔_땅 = 0;
  console.log('\n판별        땅(운해/표본)   운해(운해/표본)   하늘(운해/표본)');
  for (const v of stats.판) {
    const row = { 땅: [0, 0], 운해: [0, 0], 하늘: [0, 0] };
    v.on.forEach(([dx, dy, dz, tau], i) => {
      const c = classify(dx, dy, dz);
      if (c.k !== '하늘' && Math.abs(c.q) < 1) { 뺌++; return; }
      const has = tau >= TAU_MIN;
      row[c.k][0]++; if (has) row[c.k][1]++;
      if (c.k === '땅') {
        끔_땅++; if (v.off[i] >= TAU_MIN) 끔_땅_운해++;
        // ⚠ 덱 윗면에 닿기 전에 막혔으면 맞은 땅은 **언제나** 윗면보다 높습니다
        //   (시선이 아직 윗면 위에 있으므로). 그래서 "덱 위로 솟았나" 로 가르면
        //   "땅" 전체와 같은 수가 나옵니다 — 처음에 그렇게 공허했습니다.
        //   대신 **발밑 사면(3km 안)** 과 **먼 능선(3km 밖)** 으로 가릅니다.
        if (c.hitDistM > 3000) { 봉우리++; if (has) 봉우리_운해++; }
      }
    });
    for (const k of Object.keys(tally)) { tally[k][0] += row[k][0]; tally[k][1] += row[k][1]; }
    const f = k => `${row[k][1]}/${row[k][0]}`.padStart(9);
    console.log(`  ${String(v.az).padStart(3)}° ${String(v.pitch).padStart(4)}°   ${f('땅')}        ${f('운해')}         ${f('하늘')}`);
  }
  console.log(`  시선과 땅이 0.15°(바닥 1m) 안에서 갈려 뺀 화소: ${뺌}`);

  console.log('\n== 자가 공허 점검 ==');
  ok(tally.땅[0] >= 200, `"땅" 화소가 충분하다 (${tally.땅[0]}) — 가림이 시험된다`);
  ok(tally.운해[0] >= 200, `"운해" 화소가 충분하다 (${tally.운해[0]})`);
  ok(봉우리 >= 20, `3km 밖 능선을 보는 화소가 있다 (${봉우리}) — 발밑 사면만 시험한 게 아니다`);
  ok(tally.땅[0] - 봉우리 >= 20, `발밑 사면(3km 안)을 보는 화소가 있다 (${tally.땅[0] - 봉우리})`);
  ok(끔_땅 > 0 && 끔_땅_운해 / 끔_땅 > 0.95,
    `가림을 끄면 "땅" 화소에 운해가 덮인다 (${끔_땅_운해}/${끔_땅}) — 고치기 전의 모습`);

  console.log('\n== 판정 ==');
  const r = k => tally[k][0] ? tally[k][1] / tally[k][0] : NaN;
  ok(r('땅') <= 0.02, `땅이 앞이면 운해를 안 그린다 (${tally.땅[1]}/${tally.땅[0]} = ${(r('땅') * 100).toFixed(2)}%)`);
  ok(봉우리 > 0 && 봉우리_운해 / 봉우리 <= 0.02,
    `운해 위로 솟은 먼 능선은 안 덮인다 (${봉우리_운해}/${봉우리})`);
  ok(r('운해') >= 0.98, `땅이 아래면 운해를 그린다 (${tally.운해[1]}/${tally.운해[0]} = ${(r('운해') * 100).toFixed(2)}%)`);
  ok(r('하늘') <= 0.02 || tally.하늘[0] === 0, `덱 가장자리 위는 비어 있다 (${tally.하늘[1]}/${tally.하늘[0]})`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
