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
 * 자가 공허 검사(2026-10-02 더함): 천정 8° 원의 광학두께 표준편차가 옛·새 모두 ≥ 2 — 구조가 없으면 화면 자가 공허.
 *   화면 자의 흐름 시각은 대조(균일 운량장)의 천정에 구조가 있는 첫 시각으로 고릅니다(build 쪽 주석).
 *
 * §113 — 새 조회가 관측자 둘레 8km 를 평면에서 평활하게 되어, 양성 대조·옛 조회는 평활을 끈
 * `coverageFromSamples(samples, { nearKm: 0 })`(§101 까지의 조회)로 잽니다. 줄 하나를 더합니다:
 *  - 운량장: 관측자 둘레 2·5km 원(맨 안쪽 고리 밖)의 방위 편차가 평활 전의 0.25배 이하.
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
  // §113 부터 새 조회는 관측자 둘레를 평면에서 평활합니다. 고리의 방위 편차(양성 대조)는 평활 **전**
  // (§101 까지, pre)에서 잽니다 — 평활 뒤에는 고리에서도 편차가 거의 없어 대조가 공허해집니다.
  const lays = ['low', 'mid', 'high'].filter(L => field.layers[L][0].pre >= 0.02);
  for (const L of ['low', 'mid', 'high']) {
    console.log(`  [${L}]  d/d0      d(km)   옛 표준편차  §101      새(§113)`);
    for (const r of field.layers[L]) console.log(`         ${r.f.toFixed(3).padStart(6)}  ${r.d.toFixed(3).padStart(7)}   ${r.old.toFixed(4).padStart(9)}   ${r.pre.toFixed(4).padStart(7)}   ${r.neu.toFixed(4).padStart(7)}`);
    for (const r of field.layers[L + 'Near']) console.log(`         d = ${r.d} km 원: §101 ${r.pre.toFixed(4)} → §113 ${r.neu.toFixed(4)}`);
  }
  console.log('\n  화면 광학두께 원 표준편차   천정 1°/8° (비)            대조 55° 1°/8° (비)');
  for (const k of ['old', 'new', 'uniform']) { const s = screen[k]; console.log(`  ${k}   ${s.z1.toFixed(2)}/${s.z8.toFixed(2)} (${s.zRatio.toFixed(2)})      ${s.c1.toFixed(2)}/${s.c8.toFixed(2)} (${s.cRatio.toFixed(2)})`); }

  console.log('\n== 자가 공허 검사 ==');
  // (2026-10-02 더함) 천정 8° 원에 구조가 없으면(표준편차 ≈ 0) 아래 화면 자는 결함이 있어도 없어도 같은 값을
  // 냅니다. 운량 사상을 바꾼 뒤 상층 84% 장면이 그렇게 되어 옛 조회 대조가 깨졌습니다.
  ok(st.screenDrift >= 0, `대조(균일 운량장)의 천정에 구조가 있는 흐름 시각을 찾았다 (${st.screenDrift}시)`);
  const screenLive = screen.old.z8 >= 2 && screen.new.z8 >= 2;
  ok(screenLive, `천정 8° 원에 구조가 있다 (옛 ${screen.old.z8.toFixed(2)} · 새 ${screen.new.z8.toFixed(2)} ≥ 2)` +
    (screenLive ? '' : ' — 공허: 아래 화면 천정 줄(새 2 · 옛 대조 1)은 재지 않습니다. 운량장 자가 그대로 지킵니다.'));

  console.log('\n== 고친 동작 ==');
  ok(lays.length > 0, `양성 대조: 고리에 방위 편차가 실제로 있다 (§101 조회 ${['low','mid','high'].map(L => L + ' ' + field.layers[L][0].pre.toFixed(3)).join(' · ')} — ≥ 0.02 인 층만 잽니다: ${lays.join(',') || '없음'})`);
  for (const L of lays) { const rs = field.layers[L], ring = rs[0], tip = rs[rs.length - 1];
    ok(tip.neu <= 0.1 * ring.pre, `운량장 ${L}: 천정 가까이(d0/32) 방위 편차가 사라진다 (${tip.neu.toFixed(4)} ≤ 0.1 × ${ring.pre.toFixed(4)})`); }
  ok(field.outsideMaxDiff < 1e-6, `운량장: 맨 안쪽 고리 밖은 §101 조회가 옛 조회와 같다 (최대 차 ${field.outsideMaxDiff.toExponential(1)})`);
  // §113 — 맨 안쪽 고리 **밖**에서도 관측자로 모이는 부채꼴(방위 칸 경계)이 남았습니다. 2·5km 원의
  // 방위 편차가 평활 전의 0.25 배 이하여야 합니다(재기 전에 정함). 평활 전에 편차가 있는 층만.
  for (const L of ['low', 'mid', 'high']) for (const r of field.layers[L + 'Near']) if (r.pre >= 0.02)
    ok(r.neu <= 0.25 * r.pre, `§113 운량장 ${L}: ${r.d}km 원의 부채꼴이 사라진다 (${r.neu.toFixed(4)} ≤ 0.25 × ${r.pre.toFixed(4)})`);
  if (screenLive) ok(screen.new.zRatio <= 0.4, `화면: 천정이 한 점으로 모이지 않는다 (1°/8° 비 ${screen.new.zRatio.toFixed(2)} ≤ 0.4)`);
  if (screenLive) ok(screen.new.zRatio <= 1.5 * screen.uniform.zRatio, `화면: 천정 편차가 균일한 운량장의 결과 같은 수준 (${screen.new.zRatio.toFixed(2)} ≤ 1.5 × ${screen.uniform.zRatio.toFixed(2)})`);
  ok(screen.new.cRatio <= 0.4 && screen.old.cRatio <= 0.4, `화면 대조점(55°)은 둘 다 매끄럽게 읽힌다 (${screen.old.cRatio.toFixed(2)} · ${screen.new.cRatio.toFixed(2)} ≤ 0.4)`);
  console.log('\n== 대조 (옛 조회는 자에 걸린다) ==');
  for (const L of lays) { const rs = field.layers[L], ring = rs[0], tip = rs[rs.length - 1];
    ok(tip.old >= 0.5 * ring.old, `옛 운량장 ${L}은 천정까지 방위 편차가 남는다 (${tip.old.toFixed(4)} ≥ 0.5 × ${ring.old.toFixed(4)})`); }
  if (screenLive) ok(screen.old.zRatio >= 0.6, `옛 화면은 천정이 한 점으로 모인다 (1°/8° 비 ${screen.old.zRatio.toFixed(2)} ≥ 0.6)`);

  const sheet = new PNG({ width: W * 2, height: H });
  shots.forEach((s, k) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3, q = (y * sheet.width + k * W + x) * 4; sheet.data[q] = s.img[i]; sheet.data[q + 1] = s.img[i + 1]; sheet.data[q + 2] = s.img[i + 2]; sheet.data[q + 3] = 255; } });
  fs.writeFileSync(path.join(PREVIEW, '..', 'zenith-columns-sheet.png'), PNG.sync.write(sheet));
  console.log('\n접촉 인화: .harness/zenith-columns-sheet.png (왼쪽 옛 조회 · 오른쪽 새 조회, 시선 276° · +82°)');
  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
