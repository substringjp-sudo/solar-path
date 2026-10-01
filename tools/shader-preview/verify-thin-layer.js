/**
 * **얇은 중층운을 얇게 그리는가** (2026-10-01) — 판정. `build-thin-layer.js` 의 짝.
 *
 * 근거: 위성 일사(`tools/weather-truth/measure-thin-layer.js`, 32곳 · 90일). 단면에서 중층 띠(2~7km)에
 * 운량 ≥ 10% 인 면이 0개면 τ 0.75, 1개면 τ 3.75 — 앱의 고적운 τ 16 보다 훨씬 얇았습니다.
 *
 * 자(재기 전에 정함):
 *  1. 상수가 잰 값과 같다: n0 0.75 · n1 3.75 · 기준 16 = PRESET_OPTICS.Altocumulus.tau.
 *  2. 도코나메 단면(600hPa 한 면 13%) → 중층 배율 3.75/16, 대표 τ 3.75. 저층·상층은 1.
 *  3. 단면이 없으면 1(예전 그대로) · 두꺼운 단면(띠 안 2면 이상)이면 1 · 0면이면 0.75/16.
 *  4. 그림(앱과 같은 합성기): 밤 · 얇은 단면에서 구름 무늬 대비(덩어리 밝기 변동계수)가 예전의 50% 이하.
 *     두꺼운 단면은 예전과 화소까지 같다. 낮에도 얇은 단면이면 대비가 준다(밤만의 보정이 아니다).
 *
 * 사용: node tools/shader-preview/stage-esm.js && node tools/shader-preview/build-thin-layer.js
 *       node tools/shader-preview/verify-thin-layer.js
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN, PREVIEW } = require('./paths');

globalThis.__DEV__ = false;
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const U = (m) => import('file://' + path.join(PREVIEW, 'app', 'utils', m));
  const CP = await U('cloudProfile.js');
  const PR = await U('cloudPresets.js');
  const H_M = [98, 314, 539, 775, 1010, 1491, 2010, 2548, 3128, 4393, 5845, 7567, 9696, 10965, 12452];
  const THIN = [0, 0, 0, 0, 0, 0, 0, 0, 0, 13, 0, 0, 0, 0, 0];
  const THICK = [0, 0, 0, 0, 0, 0, 0, 0, 40, 60, 35, 0, 0, 0, 0];
  const NONE = H_M.map(() => 0);

  console.log('\n[1] 상수 = 위성으로 잰 값');
  ok(CP.THIN_MID_TAU.n0 === 0.75 && CP.THIN_MID_TAU.n1 === 3.75, `n0 ${CP.THIN_MID_TAU.n0} · n1 ${CP.THIN_MID_TAU.n1}`);
  ok(CP.THIN_MID_TAU.preset === PR.PRESET_OPTICS.Altocumulus.tau, `기준 ${CP.THIN_MID_TAU.preset} = 고적운 τ ${PR.PRESET_OPTICS.Altocumulus.tau}`);

  console.log('\n[2] 도코나메 단면 → 중층 3.75/16');
  {
    const obs = { low: 0, mid: 20, high: 17, humidity: 73, profileHeightM: H_M, profileCoverPct: THIN };
    const k = CP.layerTauScale('mid', obs);
    const tau = PR.representativeTauForObserver('mid', obs);
    console.log(`      면 수 ${CP.midCloudyLevels(H_M, THIN)} · 배율 ${k.toFixed(4)} · 대표 τ ${tau}`);
    ok(Math.abs(k - 3.75 / 16) < 1e-12 && Math.abs(tau - 3.75) < 1e-9, '중층 배율 3.75/16, 대표 τ 3.75');
    ok(CP.layerTauScale('low', obs) === 1 && CP.layerTauScale('high', obs) === 1, '저층·상층은 1');
  }

  console.log('\n[3] 단면 없음 · 두꺼움 · 0면');
  {
    const base = { low: 0, mid: 20, high: 0, humidity: 60 };
    ok(CP.layerTauScale('mid', base) === 1 && PR.representativeTauForObserver('mid', base) === PR.PRESET_OPTICS.Altocumulus.tau, '단면이 없으면 예전 그대로');
    ok(CP.layerTauScale('mid', { ...base, profileHeightM: H_M, profileCoverPct: THICK }) === 1, '띠 안 2면 이상이면 1');
    ok(Math.abs(CP.layerTauScale('mid', { ...base, profileHeightM: H_M, profileCoverPct: NONE }) - 0.75 / 16) < 1e-12, '0면이면 0.75/16');
  }

  console.log('\n[4] 그림 — 앱과 같은 합성기');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  const pageErrors = []; p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/thin-layer.html', { timeout: 600000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 600000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const st = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();
  ok(pageErrors.length === 0 && !/ERR/.test(title), `컴파일·예외 없음 (${title}${errs.length ? ' — ' + errs[0] : ''})`);
  if (!st) { console.log('FAILURES — __stats 없음'); process.exit(1); }
  ok(st.glError === 0, `glGetError == 0 (${st.glError})`);
  const get = (n, m) => st.out.find(o => o.name === n && o.mode === m);
  for (const n of ['night-thin', 'night-thick', 'day-thin', 'night-midonly', 'night-clear']) {
    const o = get(n, 'old'), q = get(n, 'new');
    console.log(`      ${n.padEnd(11)} 중층 배율 ${q.scale.mid.toFixed(3)} · 대비 ${o.cv.toFixed(3)} → ${q.cv.toFixed(3)} · 평균 밝기 ${o.mean.toFixed(1)} → ${q.mean.toFixed(1)}`);
  }
  ok(get('night-thin', 'new').cv <= 0.5 * get('night-thin', 'old').cv, '밤 · 얇은 단면: 구름 대비가 예전의 50% 이하');
  const same = (a, c) => a.img.length === c.img.length && a.img.every((v, i) => v === c.img[i]);
  ok(same(get('night-thick', 'old'), get('night-thick', 'new')), '두꺼운 단면: 예전과 화소까지 같다');
  ok(get('day-thin', 'new').cv < get('day-thin', 'old').cv, '낮에도 얇은 단면이면 대비가 준다');

  // 접촉 인화: 위 old, 아래 new
  const { W, H } = st; const names = ['night-thin', 'night-thick', 'day-thin', 'night-midonly', 'night-clear'];
  const sheet = new PNG({ width: W * names.length, height: H * 2 });
  names.forEach((n, k) => ['old', 'new'].forEach((m, j) => {
    const o = get(n, m);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3, q = ((j * H + y) * sheet.width + k * W + x) * 4; sheet.data[q] = o.img[i]; sheet.data[q + 1] = o.img[i + 1]; sheet.data[q + 2] = o.img[i + 2]; sheet.data[q + 3] = 255; }
  }));
  fs.writeFileSync(path.join(PREVIEW, '..', 'thin-layer-sheet.png'), PNG.sync.write(sheet));

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — pass ${pass} / fail ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
