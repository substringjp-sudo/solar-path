/**
 * **DEM 이 없을 때 능선 밴드가 구름을 가리는가** 합격 판정. `build-cloud-bands.js` 의 짝.
 *
 * 표본 화소마다:
 *   가림판 = 진짜 밴드 메시가 그 화소를 칠했는가
 *   구름 거리 = 저층 껍질까지의 슬랜트(관측자 아래에서 양근 하나)
 *   밴드 거리 = 밴드 수평 거리 / cos(고도각)   (셰이더와 같은 규약)
 *
 *   가림판 1 · 구름이 밴드보다 멂  → "능선"  (구름 없어야 함)
 *   가림판 1 · 구름이 밴드보다 가까움 → "앞 구름" (구름 있어야 함)
 *   가림판 0 · 수평선 위           → "하늘"  (구름 있어야 함)
 *
 * 경계 화소(가림판 가장자리 ±1화소와 거리 차 3% 안)는 뺍니다 — 메시는 삼각형으로
 * 래스터되고 셰이더는 방위 512칸이라 가장자리 한 화소는 서로 다를 수 있습니다.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const R_KM = 6371, TAU_MIN = 0.16;

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage();
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/cloud-bands.html', { timeout: 600000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 600000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const st = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0 && !/ERR/.test(title), `컴파일·예외 없음 (${title}${errs.length ? ' — ' + errs[0] : ''})`);
  if (!st) { console.log('FAILURES — __stats 없음'); process.exit(1); }
  ok(st.glError === 0, `glGetError == 0 (${st.glError})`);

  const eyeKm = st.obsM / 1000;
  const horizonSinE = -Math.sin(st.dip * Math.PI / 180);
  const cloudKm = (sinE, cosE) => {
    const A = R_KM + st.lowKm, B = R_KM + eyeKm;
    return -B * sinE + Math.sqrt(A * A - B * B * cosE * cosE);
  };

  for (const [name, v] of Object.entries(st.판)) {
    const t = { 능선: [0, 0, 0], 앞구름: [0, 0, 0], 하늘: [0, 0, 0] };   // [표본, 켬 구름, 끔 구름]
    let 뺌 = 0;
    const grid = new Map(v.S.map((s, i) => [i, s]));
    const n = v.S.length, cols = Math.round(Math.sqrt(n));
    v.S.forEach(([dx, dy, dz, m, on, off], i) => {
      if (dy <= horizonSinE + 0.002) return;
      // 가림판 가장자리 — 이웃과 값이 다르면 뺍니다.
      const nb = [i - 1, i + 1, i - cols, i + cols].map(k => grid.get(k)).filter(Boolean);
      if (nb.some(s => s[3] !== m)) { 뺌++; return; }
      const cosE = Math.hypot(dx, dz);
      const cK = cloudKm(dy, cosE), bK = v.dist / Math.max(cosE, 1e-3);
      let k;
      if (m) {
        if (Math.abs(cK - bK) / bK < 0.03) { 뺌++; return; }
        k = cK > bK ? '능선' : '앞구름';
      } else k = '하늘';
      t[k][0]++; if (on >= TAU_MIN) t[k][1]++; if (off >= TAU_MIN) t[k][2]++;
    });
    console.log(`\n== ${name} (밴드 ${v.dist}km) ==`);
    console.log(`  능선 ${t.능선[1]}/${t.능선[0]} (끔 ${t.능선[2]}) · 앞 구름 ${t.앞구름[1]}/${t.앞구름[0]} · 하늘 ${t.하늘[1]}/${t.하늘[0]} · 뺌 ${뺌}`);
    ok(t.능선[0] >= 100, `"능선" 표본이 충분하다 (${t.능선[0]})`);
    ok(t.능선[2] / Math.max(1, t.능선[0]) > 0.95, `밴드를 안 주면 능선 앞에 구름이 칠해진다 (${t.능선[2]}/${t.능선[0]}) — 고치기 전`);
    ok(t.능선[1] / Math.max(1, t.능선[0]) <= 0.02, `밴드를 주면 능선 뒤 구름이 가려진다 (${t.능선[1]}/${t.능선[0]})`);
    ok(t.하늘[1] / Math.max(1, t.하늘[0]) >= 0.98, `능선 밖 하늘은 그대로 (${t.하늘[1]}/${t.하늘[0]})`);
    if (name === '먼능선') {
      ok(t.앞구름[0] >= 50, `능선보다 가까운 구름 표본이 있다 (${t.앞구름[0]}) — 거리 판정이 시험된다`);
      ok(t.앞구름[1] / Math.max(1, t.앞구름[0]) >= 0.98, `능선보다 가까운 구름은 남는다 (${t.앞구름[1]}/${t.앞구름[0]})`);
    }
  }

  console.log('\n== DEM 이 있으면 밴드는 안 쓰인다 ==');
  if (!st.demSame) ok(false, 'DEM 패치를 못 읽었다 (build-cloud-ridge.js 를 먼저 돌려 dem-gurye 를 받으세요)');
  else {
    ok(st.demSame.cloud > 1000, `구름이 실제로 그려진 판이다 (${st.demSame.cloud}화소) — 빈 화면끼리 견준 게 아니다`);
    ok(st.demSame.diff === 0, `밴드를 줘도 안 줘도 바이트 단위로 같다 (다른 바이트 ${st.demSame.diff})`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
