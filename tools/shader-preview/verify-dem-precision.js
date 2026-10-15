/**
 * **휴대폰 GPU 의 표본 정밀도에서도 해안선이 깨끗한가** 합격 판정 (실기 2026-10-15).
 *
 * 바닷가에서만 지형이 가시 울타리처럼 솟았습니다. 원자료에는 그런 화소가 없습니다 —
 * 원인은 Terrarium 을 **하드웨어가 거른 값**으로 푼 것이었고, 휴대폰은 그 값을 fp16 으로
 * 돌려주므로 0m(R 이 127 → 128 로 넘어가는 자리)에서 최대 ±16m 가 튑니다
 * (build-dem-precision.js 머리 주석).
 *
 * 하네스 GPU 는 정확하게 거르므로 그대로는 이 결함이 안 보입니다. 그래서 셰이더의 표본
 * 줄에 fp16 왕복을 씌워 휴대폰을 흉내 냅니다. 판정은 세 갈래를 견줍니다:
 *
 *   기준          앱 코드 그대로
 *   지금 + fp16   앱 코드 + 휴대폰 표본 — **기준과 같아야** 합니다
 *   옛길 + fp16   옛 디코드 + 휴대폰 표본 — **가시가 서야** 합니다 (대조: 흉내가 먹히는가)
 *
 * 대조가 없으면 "fp16 을 씌웠는데 아무 일도 없었다" 와 "고쳐서 아무 일도 없다" 를 못
 * 가릅니다. 그래서 옛길이 실제로 물가에서 수 m 넘게 틀리고 화면에 솟은 화소를 남기는지를
 * 먼저 봅니다.
 *
 * 준비: node tools/shader-preview/build-dem-precision.js
 *       node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/verify-dem-precision.js
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
  const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  // ⚠ 'load' 를 기다리지 않습니다 — 페이지가 모듈 최상위 await 에서 다 그리므로 load 가 그만큼
  //   늦고, 하네스를 여럿 겹쳐 돌리면 goto 가 먼저 시간을 넘깁니다. 끝은 제목으로 압니다.
  await p.goto(ORIGIN + '/dem-precision.html', { timeout: 120000, waitUntil: 'commit' });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null,
    { timeout: 1200000, polling: 500 }).catch(() => {});
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
    const s = v.표본, sc = v.화면;
    console.log(`\n== ${k} ==`);
    console.log(`  고도 표본 ${s.ref.표본}점 (물가 ${s.ref.물가표본}점) — CPU 참조와의 차`);
    for (const [mode, label] of [['ref', '기준       '], ['now', '지금 + fp16'], ['legacy', '옛길 + fp16']]) {
      const x = s[mode];
      console.log(`    ${label}  최대 ${x.최대오차}m · 물가 최대 ${x.물가최대오차}m · 물가 1m 넘음 ${x.물가1m넘음}점`);
    }
    console.log(`  화면 ${sc.화소}화소 — 기준에 없는 지형(솟음) · 기준에만 있는 지형(파임)`);
    console.log(`    지금 + fp16  솟음 ${sc.now.솟음} · 파임 ${sc.now.파임}`);
    console.log(`    옛길 + fp16  솟음 ${sc.legacy.솟음} · 파임 ${sc.legacy.파임}  (가장 심한 방위 ${sc.옛길최악방위}°)`);

    console.log('  -- 흉내가 실제로 걸렸는가');
    ok(s.now.바꾼줄 >= 1 && s.legacy.바꾼줄 >= 2 && v.바꾼줄.now >= 3 && v.바꾼줄.legacy >= 6,
      `${k}: 표본 줄을 찾아 바꿨다 (표본 ${s.now.바꾼줄}/${s.legacy.바꾼줄}, 격자 ${v.바꾼줄.now}/${v.바꾼줄.legacy}) — 0 이면 앱 코드가 바뀌어 흉내가 빗나간 것`);
    ok(s.legacy.물가최대오차 >= 5,
      `${k}: 대조 — 옛길은 물가에서 수 m 넘게 틀린다 (${s.legacy.물가최대오차}m ≥ 5m)`);
    ok(sc.legacy.솟음 >= 200,
      `${k}: 대조 — 옛길은 화면에 가시를 세운다 (솟은 화소 ${sc.legacy.솟음} ≥ 200)`);

    console.log('  -- 고친 뒤');
    ok(s.ref.최대오차 <= 0.01,
      `${k}: 기준은 CPU 참조와 같다 (최대 ${s.ref.최대오차}m ≤ 0.01m)`);
    ok(s.now.최대오차 <= 0.01,
      `${k}: 휴대폰 표본에서도 고도가 정확하다 (최대 ${s.now.최대오차}m ≤ 0.01m, 물가 1m 넘음 ${s.now.물가1m넘음}점)`);
    ok(sc.now.솟음 === 0 && sc.now.파임 === 0,
      `${k}: 휴대폰 표본에서도 화면이 기준과 같다 (솟음 ${sc.now.솟음} · 파임 ${sc.now.파임})`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
