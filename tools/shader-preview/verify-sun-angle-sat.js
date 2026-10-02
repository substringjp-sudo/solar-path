/**
 * **해에서 멀어질수록 하늘이 진해지는가 — 사진과 같은 모양으로** (2026-10-02) 판정. `build-sun-angle-sat.js` 의 짝.
 *
 * 과녁: 해가 화면 안에 찍힌 참고 사진 6장(`tools/photo-ref/measure-sun-angle.js`, EXIF 화각으로 화소마다 해와의
 * 각을 냄). 낮 사진 4장은 모두 해 곁(3–8°)이 가장 옅고 멀어질수록 진해졌습니다(36–46° 가 3–8° 의 2.2배 —
 * 맑은 하늘 c170 — 에서 10~17배 — 권운·무리). 노을 사진(c100, 구름 위 일몰)은 반대로 해 쪽이 가장 진하고
 * 28–36° 에서 0.15배로 옅어졌습니다.
 *
 * 자(렌더를 재기 전에 정함):
 *  1. 낮(해 35°): 36–46° 채도 ≥ 1.5 × 3–8° 채도(맑은 하늘 사진 2.2배보다 느슨하게 — 사진이 한 장뿐).
 *  2. 낮: 구간마다 앞 구간보다 0.02 넘게 떨어지지 않는다(사진 4장 모두 단조).
 *  3. 노을(해 1°): 28–36° 채도 ≤ 0.5 × 3–8° 채도.
 *
 * 현재(2026-10-02): **3 이 실패합니다(0.58배)** — 알려진 차이입니다. 물리 하늘빛은 사진 모양 그대로인데(노을 해 곁
 * 0.55 → 28–36° 0.09), 표시 단계의 톤 곡선이 해 곁을 하얗게 바랩니다. 표시에 채도 바닥(atmosphere
 * atm_chromaFloor)을 넣으면 이 판정은 4/4 가 되지만, 하늘만 바뀌고 같은 빛을 다른 길로 그리는 지형·물·해 원반과
 * 어긋나 verify-haze · verify-glitter · verify-bloom 이 걸려 꺼 두었습니다(DISP_CHROMA_FLOOR). 표시 경로를 하나로
 * 묶은 뒤에 다시 켭니다.
 *
 * 사용: node tools/shader-preview/stage-esm.js && node tools/shader-preview/build-sun-angle-sat.js
 *       node tools/shader-preview/verify-sun-angle-sat.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const BINS = ['3–8', '8–14', '14–20', '20–28', '28–36', '36–46'];
// 사진 쪽 값(measure-sun-angle.js, 2026-10-02) — 참고로 같이 찍습니다.
const PHOTO = {
  'c170 낮(맑음)': [0.288, 0.396, 0.446, 0.518, 0.574, 0.631],
  'c027 낮(권운)': [0.043, 0.124, 0.212, 0.338, 0.525, 0.541],
  'c100 노을': [0.429, 0.342, 0.256, 0.182, 0.065, 0.051],
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  await p.goto(`${ORIGIN}/sun-angle-sat.html`, { timeout: 120000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 300000, polling: 500 });
  const errs = await p.evaluate(() => window.__errors), out = await p.evaluate(() => window.__out), glErr = await p.evaluate(() => window.__glError);
  await b.close();
  ok(errs.length === 0 && glErr === 0, `셰이더·GL 오류 없음 (${errs[0] || 'gl ' + glErr})`);
  if (!out) process.exit(1);
  console.log('\n  해와의 각(°)     ' + BINS.map(x => x.padStart(7)).join(''));
  for (const [k, v] of Object.entries(PHOTO)) console.log(`  사진 ${k.padEnd(11)}` + v.map(x => x.toFixed(3).padStart(7)).join(''));
  for (const o of out) console.log(`  렌더 ${o.name.padEnd(11)}` + o.prof.map(x => x == null ? '      —' : x.toFixed(3).padStart(7)).join(''));
  const day = out.find(o => o.name === 'day').prof, ss = out.find(o => o.name === 'sunset').prof;
  ok(day[5] >= 1.5 * day[0], `낮: 36–46° 가 3–8° 의 1.5배 이상 (${(day[5] / day[0]).toFixed(2)}배)`);
  ok(day.every((x, i) => i === 0 || x >= day[i - 1] - 0.02), '낮: 해에서 멀어지며 옅어지지 않는다(0.02 넘게 떨어지는 구간 없음)');
  ok(ss[4] <= 0.5 * ss[0], `노을: 28–36° 가 3–8° 의 0.5배 이하 (${(ss[4] / ss[0]).toFixed(2)}배)`);
  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — pass ${pass} / fail ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
