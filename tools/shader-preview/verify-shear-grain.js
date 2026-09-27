/**
 * **구름 늘어남은 바람 시어에서** 판정 (§109). `build-shear-grain.js` 의 짝.
 *
 * 자(재기 전에 정함):
 *  1. 시어 없음(S0): 상층 결집도 ≤ 저층 + 0.08 — 시어가 없으면 권운도 줄무늬가 아니다.
 *  2. 시어가 셀수록 줄무늬: 상층 결집도 S0 < S1 < S2.
 *  3. 방향은 시어를 따른다(S3): 상층 주방향이 시어 축(V상 − V중)과 20° 안. 그리고 그 축은 상층 바람
 *     축과 20° 넘게 달라야 한다(아니면 이 자가 둘을 못 가림).
 *  4. 보통 바람(S1)에서 층 사이 결집도 차 ≤ 0.15 — "층마다 다른 방향이 중구난방" 의 크기.
 *  5. 중층 물결: 보통 시어(S0·S1)에서는 중층 결집도 ≤ 저층 + 0.08. 양성 대조 — 극단 시어(S4,
 *     Ri < 0.25)에서는 S0 보다 0.05 넘게 크다.
 * 대조: 예전 코드(상층 4:1 고정·중층 물결 고정)는 1 과 4 에 걸려야 한다.
 *
 * ## 잰 결과 (정한 자 그대로)
 *
 * | | 예전 코드 | §109 |
 * |---|---|---|
 * | 1 시어 없음 상층 결집 | 0.321 FAIL | 0.044 PASS |
 * | 2 S0<S1<S2 | 0.321 = 0.321 = 0.321 FAIL | 0.044 < 0.127 < 0.286 PASS |
 * | 3b 시어 축과의 차 | 21.6° FAIL (바람 축과 3.8°) | 3.1° PASS |
 * | 4 S1 층 사이 차 | 0.292 FAIL | 0.201 **FAIL** |
 * | 5b 양성 대조 | FAIL | FAIL |
 *
 * ⚠ 4 는 그대로 FAIL 로 둡니다(문턱 안 옮김). 남은 0.201 은 중층(0.03)과 저층(0.23) 사이의 차이고,
 *   둘 다 바람과 무관하게 S0~S4 에서 값이 똑같습니다 — 저층 셀이 커서 천정 화면에 구름 가장자리
 *   몇 개만 들어오고, 그 가장자리 하나가 결집도를 끌어올립니다(접촉 인화 오른쪽 칸). 바람 늘이기와는
 *   상관없는 이 자의 바닥값이라, 이번 변경의 몫은 0.292 → 0.201 로 줄어든 부분입니다.
 * ⚠ 5 는 판정에서 뺐습니다(참고로만 찍음). 중층 물결은 이번에 건드리지 않았고(Ri 로 물결을 켜는 것은
 *   넣지 않음), 양성 대조 5b 가 예전·새 코드 모두에서 실패해 **이 자가 중층 물결을 못 본다**는 것이
 *   드러났습니다. 대조가 실패한 자로 5a 를 PASS 라 부를 수 없습니다.
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN, PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const axDiff = (a, b) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/shear-grain.html', { timeout: 600000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 600000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const st = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();
  ok(pageErrors.length === 0 && !/ERR/.test(title), `컴파일·예외 없음 (${title}${errs.length ? ' — ' + errs[0] : ''})`);
  if (!st) { console.log('FAILURES — __stats 없음'); process.exit(1); }
  const o = st.out;
  console.log('\n  경우   상층(축°/결집)    중층            저층            상층 시어축  상층 바람축');
  for (const k of Object.keys(o)) console.log(`  ${k}     ${o[k].high.axis}/${o[k].high.coh}   ${o[k].mid.axis}/${o[k].mid.coh}   ${o[k].low.axis}/${o[k].low.coh}   ${o[k].shearAxisHigh.toFixed(1)}   ${o[k].windAxisHigh.toFixed(1)}`);
  console.log('');
  ok(o.S0.high.coh <= o.S0.low.coh + 0.08, `1. 시어 없음: 상층도 줄무늬가 아니다 (${o.S0.high.coh} ≤ ${o.S0.low.coh} + 0.08)`);
  ok(o.S0.high.coh < o.S1.high.coh && o.S1.high.coh < o.S2.high.coh, `2. 시어가 셀수록 줄무늬 (${o.S0.high.coh} < ${o.S1.high.coh} < ${o.S2.high.coh})`);
  const dShear = axDiff(o.S3.high.axis, o.S3.shearAxisHigh), dWindShear = axDiff(o.S3.windAxisHigh, o.S3.shearAxisHigh);
  ok(dWindShear > 20, `3a. 대조: 도는 바람에서 시어 축과 바람 축이 갈린다 (${dWindShear.toFixed(1)}° > 20°)`);
  ok(dShear <= 20, `3b. 상층 줄무늬는 시어 축을 따른다 (차 ${dShear.toFixed(1)}° ≤ 20°, 바람 축과는 ${axDiff(o.S3.high.axis, o.S3.windAxisHigh).toFixed(1)}°)`);
  const spread = Math.max(o.S1.high.coh, o.S1.mid.coh, o.S1.low.coh) - Math.min(o.S1.high.coh, o.S1.mid.coh, o.S1.low.coh);
  ok(spread <= 0.15, `4. 보통 바람에서 층 사이 결집도 차 ≤ 0.15 (${spread.toFixed(3)})`);
  // 5 는 참고로만 — 양성 대조(5b)가 실패하면 이 자는 중층 물결을 못 보는 것이라 5a 를 판정할 수 없습니다.
  const c5b = o.S4.mid.coh > o.S0.mid.coh + 0.05;
  console.log(`  참고 5a. 보통 시어의 중층 결집 (S0 ${o.S0.mid.coh} · S1 ${o.S1.mid.coh}, 저층 ${o.S0.low.coh})`);
  console.log(`  참고 5b. 양성 대조 극단 시어(Ri<0.25) 중층 ${o.S4.mid.coh} vs S0 ${o.S0.mid.coh} — ${c5b ? '보임' : '안 보임: 이 자는 중층 물결을 못 봄'}`);

  const { shots, TW, TH } = st;
  const sheet = new PNG({ width: TW * 3, height: TH * 2 });
  shots.forEach((s, k) => { const ox = (k % 3) * TW, oy = Math.floor(k / 3) * TH;
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) { const i = (y * TW + x) * 3, q = ((oy + y) * sheet.width + ox + x) * 4; sheet.data[q] = s.img[i]; sheet.data[q + 1] = s.img[i + 1]; sheet.data[q + 2] = s.img[i + 2]; sheet.data[q + 3] = 255; } });
  fs.writeFileSync(path.join(PREVIEW, '..', 'shear-grain-sheet.png'), PNG.sync.write(sheet));
  console.log('\n접촉 인화: .harness/shear-grain-sheet.png (위 S1 보통 · 아래 S3 도는 바람, 왼쪽부터 상·중·저층, 천정, 위=북)');
  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
