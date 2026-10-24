/**
 * **물가 근처를 칠하는 값(`dem_shoreField`)이 맞는가** 합격 판정 (§157). `build-shore-frag.js` 의 짝.
 *
 * GPU 의 흐린 고도(열여섯 화소의 3차 B-스플라인)·쌍선형 고도·기울기를, Node 가 PNG 를 직접 풀어 따로 구현한 참조와
 * 견줍니다. 좌표·방향·스플라인 가중치 어느 것이 틀려도 평지에서는 안 보이고 해안선 근처에서만 어긋나므로, 표본의 절반을
 * 해안선 근처에서 뽑았습니다. 대조(동·남을 바꿔 읽음)는 이 자가 방향에 눈먼 것이 아님을 보입니다.
 *
 * 준비: node tools/shader-preview/build-shore-frag.js
 *       node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/verify-shore-frag.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 700, height: 300 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/shore-frag.html', { timeout: 120000, waitUntil: 'commit' });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 600000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0, `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건${errs.length ? ' — ' + errs[0].slice(0, 200) : ''})`);
  if (!stats || !stats.결과) { console.log('\nFAILURES — __stats.결과 가 없습니다.'); process.exit(1); }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);
  const r = stats.결과;
  ok(Object.keys(r).length === 2, `두 곳을 다 쟀다 (${Object.keys(r).join(', ')})`);

  for (const [k, v] of Object.entries(r)) {
    console.log(`\n== ${k} == (표본 ${v.표본}, 그중 해안선 근처 ${v.해안선근처}, ${v.ms}ms)`);
    console.log(`  흐린 고도 평균오차 ${v.흐린고도평균오차} · 최대 ${v.흐린고도최대오차} m   | 쌍선형 고도 평균 ${v.쌍선형평균오차} · 최대 ${v.쌍선형최대오차} m`);
    console.log(`  기울기 평균오차 ${v.기울기평균오차} · 최대 ${v.기울기최대오차} (m/m)   | 흐린 고도와 쌍선형 고도의 차 최대 ${v.흐림차최대} m`);
    console.log(`  대조(동·남 바꿈) 평균오차 ${v.대조평균오차} m`);
    ok(v.해안선근처 >= 150, `${k}: 해안선 근처 표본이 충분하다 (${v.해안선근처} ≥ 150)`);
    ok(v.흐린고도평균오차 <= 0.001 && v.흐린고도최대오차 <= 0.01, `${k}: 흐린 고도가 참조와 같다 (평균 ${v.흐린고도평균오차} ≤ 0.001 · 최대 ${v.흐린고도최대오차} ≤ 0.01 m)`);
    ok(v.쌍선형평균오차 <= 0.001 && v.쌍선형최대오차 <= 0.01, `${k}: 쌍선형 고도도 같다 (평균 ${v.쌍선형평균오차} ≤ 0.001 · 최대 ${v.쌍선형최대오차} ≤ 0.01 m)`);
    ok(v.기울기최대오차 <= 0.0005, `${k}: 기울기가 같다 (최대 ${v.기울기최대오차} ≤ 0.0005 m/m — 바닥 기울기 문턱 0.002 의 1/4)`);
    ok(v.흐림차최대 >= 0.05, `${k}: 흐리기가 실제로 일한다 — 흐린 고도와 쌍선형 고도의 차 최대 ${v.흐림차최대} ≥ 0.05 m (아니면 이 표본으로는 흐린 것과 안 흐린 것을 못 가른다)`);
    ok(v.대조평균오차 >= 20 * Math.max(v.흐린고도평균오차, 0.0005),
      `${k}: 대조 — 동·남을 바꾸면 크게 어긋난다 (${v.대조평균오차} ≥ ${(20 * Math.max(v.흐린고도평균오차, 0.0005)).toFixed(4)}) — 자가 눈멀지 않았다`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
