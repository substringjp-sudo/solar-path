/**
 * **위에서 본 구름** (§120 B) — 판정.
 *
 * 먼저 정한 줄:
 *  1. 예보 → 면적: 운량장(셰이더에 들어가는 운량)과 위에서 본 면적(τ ≥ 0.16, 반경 150km)이
 *     층마다 0.10 안에서 같다 — 하늘 쪽 판정(verify-layer-elev)과 같은 문턱·같은 허용.
 *     운량장이 0.95 를 넘는 칸(하늘 파이프라인이 흐림으로 올린 것)은 빼고, 면적은 단조로 는다.
 *  2. 방향: 동쪽 흐림 · 서쪽 맑음 예보에서 동쪽 불투명도 평균이 서쪽보다 0.1 넘게 크다.
 *  3. 이류: 서풍 60km/h 에서 한 시간 뒤 무늬가 동쪽으로 60km(= 기대 화소 ±2) 옮는다.
 *  5. 입자 크기(§120.10): 고른 50% 에서 **15km 떨어진** 두 점의 불투명도 상관이 0.5 이상 —
 *     레이더·위성 그림처럼 수십 km 덩어리로 뭉친다. 대조 — 하늘 셀 모양장 그대로면 0.5 밑.
 *     (사용자 보고 "입자가 너무 잘고 구름 레이더와 비슷하지가 않아". 문턱은 재기 전에 정함.)
 *  (참고) 방사형 줄 — **합격 줄이 아닙니다.** 바깥 고리(200~340km)에서 30km 떨어진 두 점의
 *     상관을 반경·원주 방향으로 견줘 적기만 합니다.
 *     ⚠ 처음에는 줄로 세웠습니다: 이웃 한 화소 상관 비 ≤ 1.3 → 대조(하늘의 방향 잡음 운량장)가
 *       1.01 로 줄을 못 봄. 줄 폭(방위 15° = 52~89km)에 맞춰 30km 상관 차 ≤ 0.1 로 자를 바꿈 →
 *       대조가 0.054 로 여전히 문턱 밑. 자를 두 번 바꾸고도 대조가 안 넘으니 더 만지면 결과에
 *       자를 맞추는 셈이라, 참고 값으로만 남깁니다. 줄무늬는 그림으로 봤습니다(§120.6).
 *  대조: 하늘(45°) 문턱을 그대로 쓰면 줄 1 이 어긋남을 잡는다(어느 층이든 0.10 넘게).
 *        바람 0 이면 옮는 거리가 0 이다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/build-cloud-top-view.js
 *       node tools/shader-preview/verify-cloud-top-view.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(`${ORIGIN}/cloud-top-view.html`, { waitUntil: 'commit', timeout: 180000 });
  await p.waitForFunction(() => document.title.startsWith('DONE'), null, { timeout: 240000 });
  const s = await p.evaluate(() => window.__stats);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  ok(pageErrors.length === 0 && errs.length === 0, `페이지 오류 없음 ${[...pageErrors, ...errs][0] || ''}`);
  if (!s) { console.log('\nFAILURES — __stats 가 없습니다.'); process.exit(1); }
  const N = s.N, Rk = s.rangeKm, kmpx = (2 * Rk) / N;
  const dist = (i) => { const x = i % N, y = (i / N) | 0; return Math.hypot((x + 0.5) * kmpx - Rk, (y + 0.5) * kmpx - Rk); };
  const area = (alpha, maxKm = 150) => { let n = 0, c = 0; alpha.forEach((v, i) => { if (dist(i) <= maxKm) { n++; if (v >= 38) c++; } }); return c / n; };
  const LI = { low: 0, mid: 1, high: 2 }, NAME = { low: '저층', mid: '중층', high: '상층' };
  console.log(`  화소 ${N} · 반경 ${Rk}km · ${kmpx.toFixed(2)}km/px`);

  console.log('\n== 1. 예보 → 면적 (τ ≥ 0.16, 반경 150km) ==');
  for (const L of ['low', 'mid', 'high']) {
    const rows = s.R.area.filter(r => r.layer === L).map(r => ({ c: r.coverMean[LI[L]], f: r.c, a: area(r.alpha) }));
    console.log(`  ${NAME[L]}: ` + rows.map(r => `예보 ${r.f}→운량장 ${r.c.toFixed(2)}→면적 ${r.a.toFixed(2)}`).join(' · '));
    const use = rows.filter(r => r.c < 0.95);
    const worst = Math.max(...use.map(r => Math.abs(r.a - r.c)));
    ok(worst <= 0.10, `${NAME[L]} — 면적이 운량장을 따른다 (최대 어긋남 ${worst.toFixed(3)})`);
    ok(rows.every((r, i) => i === 0 || r.a >= rows[i - 1].a - 1e-9), `${NAME[L]} — 예보가 늘면 면적도 는다`);
  }
  console.log('\n== 대조: 하늘 셀 모양장·하늘(45°) 문턱을 그대로 쓰면 ==');
  const skyErr = s.R.areaSky.map(r => {
    const c = s.R.area.find(x => x.layer === r.layer && x.c === 50).coverMean[LI[r.layer]];
    const e = area(r.alpha) - c;
    console.log(`  ${NAME[r.layer]}: 운량장 ${c.toFixed(2)} → 면적 ${area(r.alpha).toFixed(2)} (어긋남 ${e >= 0 ? '+' : ''}${e.toFixed(2)})`);
    return Math.abs(e);
  });
  ok(Math.max(...skyErr) > 0.10, `자가 어긋남을 본다 (최대 ${Math.max(...skyErr).toFixed(2)} > 0.10)`);

  console.log('\n== 2. 방향 ==');
  let e = 0, w = 0, ne = 0, nw = 0;
  s.R.dir.forEach((v, i) => { if (dist(i) > Rk * 0.95) return; const x = i % N; if (x > N / 2 + 5) { e += v; ne++; } else if (x < N / 2 - 5) { w += v; nw++; } });
  const E = e / ne / 255, Wm = w / nw / 255;
  ok(E - Wm > 0.1, `동쪽(흐림) ${E.toFixed(3)} > 서쪽(맑음) ${Wm.toFixed(3)} + 0.1`);

  console.log('\n== 3. 이류 — 한 시간 뒤 무늬가 바람만큼 옮는가 ==');
  const D = s.R.drift;
  const corr = (A, B, sh) => {
    let sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0, n = 0;
    for (let y = 40; y < N - 40; y++) for (let x = 40; x < N - 40; x++) {
      const a = A[y * N + x], bb = B[y * N + x + sh]; sa += a; sb += bb; sab += a * bb; saa += a * a; sbb += bb * bb; n++;
    }
    const ca = saa / n - (sa / n) ** 2, cb = sbb / n - (sb / n) ** 2;
    return (sab / n - (sa * sb) / n / n) / Math.sqrt(ca * cb + 1e-9);
  };
  const best = (A, B) => { let bc = -2, bs = 0; for (let sh = -24; sh <= 24; sh++) { const c = corr(A, B, sh); if (c > bc) { bc = c; bs = sh; } } return { bs, bc }; };
  const want = 60 / kmpx;
  const wv = best(D.w0, D.w1), cv = best(D.c0, D.c1);
  console.log(`  바람 ${JSON.stringify(D.winds.mid)} · 기대 ${want.toFixed(1)}px(60km) · 찾은 ${wv.bs}px (상관 ${wv.bc.toFixed(2)}, 제자리 ${corr(D.w0, D.w1, 0).toFixed(2)})`);
  ok(Math.abs(wv.bs - want) <= 2, `무늬가 동쪽으로 바람만큼 옮는다 (${wv.bs}px ≈ ${want.toFixed(1)}px)`);
  ok(cv.bs === 0, `대조: 바람 0 이면 제자리 (${cv.bs}px, 상관 ${cv.bc.toFixed(2)})`);

  console.log('\n== 5. 입자 크기 — 15km 떨어진 상관 ==');
  const lagCorr = (A, lagPx) => {
    let sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0, n = 0;
    for (let y = 30; y < N - 30; y++) for (let x = 30; x < N - 30 - lagPx; x++) {
      if (dist(y * N + x) > Rk * 0.85) continue;
      for (const [a, bb] of [[A[y * N + x], A[y * N + x + lagPx]], [A[y * N + x], A[(y + lagPx) * N + x]]]) {
        sa += a; sb += bb; sab += a * bb; saa += a * a; sbb += bb * bb; n++;
      }
    }
    const ca = saa / n - (sa / n) ** 2, cb = sbb / n - (sb / n) ** 2;
    return (sab / n - (sa * sb) / n / n) / Math.sqrt(ca * cb + 1e-9);
  };
  const lag = Math.round(15 / kmpx);
  const gm = lagCorr(s.R.grain.meso, lag), gs = lagCorr(s.R.grain.sky, lag);
  console.log(`  ${lag}px(${(lag * kmpx).toFixed(1)}km) — 덩어리 모양장 ${gm.toFixed(3)} · 대조(하늘 셀 모양장) ${gs.toFixed(3)}`);
  ok(gm >= 0.5, `덩어리로 뭉친다 (${gm.toFixed(3)} ≥ 0.5)`);
  ok(gs < 0.5, `대조: 하늘 셀 모양장이면 잔 점이다 (${gs.toFixed(3)} < 0.5)`);

  console.log('\n== 참고: 방사형 줄 ==');
  const LAG = 30;   // km
  const aniso = (A) => {
    const at = (rk, th) => { const x = Math.round((Rk + rk * Math.sin(th)) / kmpx - 0.5), y = Math.round((Rk - rk * Math.cos(th)) / kmpx - 0.5); return A[y * N + x]; };
    const pr = [], pt = [];
    for (let rk = 200; rk <= 340 - LAG; rk += kmpx) {
      const dth = kmpx / rk;
      for (let th = 0; th < 2 * Math.PI; th += dth) {
        const v = at(rk, th);
        pr.push([v, at(rk + LAG, th)]);
        pt.push([v, at(rk, th + LAG / rk)]);
      }
    }
    const cr = (P) => { const n = P.length; let sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0; for (const [a, bb] of P) { sa += a; sb += bb; sab += a * bb; saa += a * a; sbb += bb * bb; } const ca = saa / n - (sa / n) ** 2, cb = sbb / n - (sb / n) ** 2; return (sab / n - sa * sb / n / n) / Math.sqrt(ca * cb + 1e-9); };
    return { rad: cr(pr), tan: cr(pt) };
  };
  const f = aniso(s.R.spokes.forecast), k = aniso(s.R.spokes.skyColumns);
  const df = f.rad - f.tan, dk = k.rad - k.tan;
  console.log(`  ${LAG}km 떨어진 상관 — 예보 보간: 반경 ${f.rad.toFixed(3)} · 원주 ${f.tan.toFixed(3)} → 차 ${df.toFixed(3)}`);
  console.log(`  대조(하늘 방향 잡음): 반경 ${k.rad.toFixed(3)} · 원주 ${k.tan.toFixed(3)} → 차 ${dk.toFixed(3)}`);
  console.log('  (참고 — 합격 줄 아님. 머리말 참고)');

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
