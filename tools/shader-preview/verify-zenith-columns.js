/**
 * **천정 부챗살** 판정 (§101). `build-zenith-columns.js` 의 짝.
 *
 * 자(재기 전에 정함):
 *  - 양성 대조: 맨 안쪽 고리에서 방위 편차 ≥ 0.02 인 층이 있어야 합니다(없으면 자가 공허).
 *  - 운량장(그런 층마다): 천정 둘레 원(지상 반지름 d)의 운량 표준편차가 d → 0 에서 사라진다 —
 *    d = d0/32 에서 고리(d0)의 0.1배 이하. 한 점은 한 값만 가집니다.
 *  - 운량장: 맨 안쪽 고리 **밖**은 옛 조회와 똑같다(최대 차 < 1e-6) — 다른 하늘은 안 건드림.
 *  - 화면: 천정 둘레 광학두께의 (1° 원 표준편차 ÷ 8° 원 표준편차) ≤ 0.4.
 *  - 화면: 같은 비가 **균일한 운량장**(모양장의 결만 남음)의 1.5배 이하.
 *  - 화면 대조점(고도 55°)은 같은 비가 ≤ 0.4 (매끄러운 장에서 자가 작게 읽는다).
 * 대조(자가 증상을 보는가): 옛 조회는 운량장 비 ≥ 0.5, 화면 천정 비 ≥ 0.6.
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN, PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/zenith-columns.html', { timeout: 600000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 600000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const st = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();
  ok(pageErrors.length === 0 && !/ERR/.test(title), `컴파일·예외 없음 (${title}${errs.length ? ' — ' + errs[0] : ''})`);
  if (!st) { console.log('FAILURES — __stats 없음'); process.exit(1); }
  const { field, screen, shots, W, H } = st;
  console.log(`\n맨 안쪽 고리(km): 저층 ${field.innerKm.low.toFixed(2)} · 중층 ${field.innerKm.mid.toFixed(2)} · 상층 ${field.innerKm.high.toFixed(2)}`);
  const lays = ['low', 'mid', 'high'].filter(L => field.layers[L][0].old > 0 || field.layers[L][0].neu > 0);
  for (const L of ['low', 'mid', 'high']) {
    console.log(`  [${L}]  d/d0      d(km)   옛 표준편차  새 표준편차`);
    for (const r of field.layers[L]) console.log(`         ${r.f.toFixed(3).padStart(6)}  ${r.d.toFixed(3).padStart(7)}   ${r.old.toFixed(4).padStart(9)}   ${r.neu.toFixed(4).padStart(9)}`);
  }
  console.log('\n  화면 광학두께 원 표준편차   천정 1°/8° (비)            대조 55° 1°/8° (비)');
  for (const k of ['old', 'new', 'uniform']) { const s = screen[k]; console.log(`  ${k}   ${s.z1.toFixed(2)}/${s.z8.toFixed(2)} (${s.zRatio.toFixed(2)})      ${s.c1.toFixed(2)}/${s.c8.toFixed(2)} (${s.cRatio.toFixed(2)})`); }

  console.log('\n== 고친 동작 ==');
  ok(lays.length > 0 && lays.every(L => field.layers[L][0].neu >= 0.02), `양성 대조: 고리에 방위 편차가 실제로 있다 (${['low','mid','high'].map(L => L + ' ' + field.layers[L][0].neu.toFixed(3)).join(' · ')} — ≥ 0.02 인 층만 잽니다: ${lays.join(',') || '없음'})`);
  for (const L of lays) { const rs = field.layers[L], ring = rs[0], tip = rs[rs.length - 1];
    ok(tip.neu <= 0.1 * ring.neu, `운량장 ${L}: 천정 가까이(d0/32) 방위 편차가 사라진다 (${tip.neu.toFixed(4)} ≤ 0.1 × ${ring.neu.toFixed(4)})`); }
  ok(field.outsideMaxDiff < 1e-6, `운량장: 맨 안쪽 고리 밖은 옛 조회와 같다 (최대 차 ${field.outsideMaxDiff.toExponential(1)})`);
  ok(screen.new.zRatio <= 0.4, `화면: 천정이 한 점으로 모이지 않는다 (1°/8° 비 ${screen.new.zRatio.toFixed(2)} ≤ 0.4)`);
  ok(screen.new.zRatio <= 1.5 * screen.uniform.zRatio, `화면: 천정 편차가 균일한 운량장의 결과 같은 수준 (${screen.new.zRatio.toFixed(2)} ≤ 1.5 × ${screen.uniform.zRatio.toFixed(2)})`);
  ok(screen.new.cRatio <= 0.4 && screen.old.cRatio <= 0.4, `화면 대조점(55°)은 둘 다 매끄럽게 읽힌다 (${screen.old.cRatio.toFixed(2)} · ${screen.new.cRatio.toFixed(2)} ≤ 0.4)`);
  console.log('\n== 대조 (옛 조회는 자에 걸린다) ==');
  for (const L of lays) { const rs = field.layers[L], ring = rs[0], tip = rs[rs.length - 1];
    ok(tip.old >= 0.5 * ring.old, `옛 운량장 ${L}은 천정까지 방위 편차가 남는다 (${tip.old.toFixed(4)} ≥ 0.5 × ${ring.old.toFixed(4)})`); }
  ok(screen.old.zRatio >= 0.6, `옛 화면은 천정이 한 점으로 모인다 (1°/8° 비 ${screen.old.zRatio.toFixed(2)} ≥ 0.6)`);

  const sheet = new PNG({ width: W * 2, height: H });
  shots.forEach((s, k) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3, q = (y * sheet.width + k * W + x) * 4; sheet.data[q] = s.img[i]; sheet.data[q + 1] = s.img[i + 1]; sheet.data[q + 2] = s.img[i + 2]; sheet.data[q + 3] = 255; } });
  fs.writeFileSync(path.join(PREVIEW, '..', 'zenith-columns-sheet.png'), PNG.sync.write(sheet));
  console.log('\n접촉 인화: .harness/zenith-columns-sheet.png (왼쪽 옛 조회 · 오른쪽 새 조회, 시선 276° · +82°)');
  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
