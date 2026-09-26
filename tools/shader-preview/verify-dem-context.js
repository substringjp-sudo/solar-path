/**
 * **DEM 패치는 GL 컨텍스트마다** 판정. `build-dem-context.js` 의 짝.
 *
 * 자(재기 전에 정함):
 *  - 두 번째 렌더러는 첫 렌더러의 패치를 돌려받지 않고 자기 패치를 받으며, 그 패치가 읽힌다(> 0).
 *  - 한 렌더러 몫을 버려도(`clearDemCache(B)`) 다른 렌더러의 패치는 그대로 읽히고 캐시에 남는다.
 *  - 새 렌더러(= 새 컨텍스트)는 새 패치를 받고 그것이 읽힌다.
 * 대조(자가 증상을 보는지):
 *  - 남의 컨텍스트 패치를 그리면 빈 높이장(0)이다 — 예전 공유 캐시의 (1).
 *  - 전부 버리면(`clearDemCache()`) 쓰던 패치가 빈 높이장이 된다 — 예전 정리 방식의 (2).
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/dem-context.html', { timeout: 120000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 120000, polling: 250 }).catch(() => {});
  const title = await p.title();
  const st = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();
  ok(pageErrors.length === 0 && !/ERR/.test(title), `예외 없음 (${title}${errs.length ? ' — ' + errs[0] : ''})`);
  if (!st) { console.log('FAILURES — __stats 없음'); process.exit(1); }
  const o = st.out;
  console.log('  ' + JSON.stringify(o));
  console.log('== 고친 동작 ==');
  ok(o.aInA > 0, `첫 렌더러의 패치가 읽힌다 (${o.aInA.toFixed(1)})`);
  ok(!o.sameObject, '두 번째 렌더러는 첫 렌더러의 패치를 돌려받지 않는다');
  ok(o.bInB > 0, `두 번째 렌더러의 패치가 읽힌다 (${o.bInB.toFixed(1)})`);
  ok(o.aAfterClearB > 0 && o.aCacheKept, `두 번째 몫을 버려도 첫 패치는 읽히고 캐시에 남는다 (${o.aAfterClearB.toFixed(1)})`);
  ok(o.cFresh && o.cInC > 0, `새 컨텍스트는 새 패치를 받고 읽힌다 (${o.cInC.toFixed(1)})`);
  console.log('== 대조 ==');
  ok(o.aInB === 0, `남의 컨텍스트 패치는 빈 높이장 (${o.aInB.toFixed(1)}) — 예전 공유 캐시가 지형을 지운 까닭`);
  ok(o.aAfterClearAll === 0, `전부 버리면 쓰던 패치가 빈 높이장 (${o.aAfterClearAll.toFixed(1)}) — 예전 정리 방식`);
  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
