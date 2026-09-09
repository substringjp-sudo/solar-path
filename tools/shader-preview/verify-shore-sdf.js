/**
 * **물가를 거리장으로 다시 세우면 경계가 덜 각지는가** 합격 판정.
 * `bake-shore-sdf.js` → `build-shore-sdf.js` 의 짝.
 *
 * ## 먼저: 자가 너무 얇았습니다
 *
 * 예전 자(`build-shorepatch.js`)는 줄마다 "뭍에서 물로 넘어가는 **첫** 자리"
 * 하나만 적었습니다. 384줄 중 **29~37줄**만 쓰였고, 그 표본으로는 1.4 와
 * 2.5 를 못 가립니다 — 실제로 격자 밀도를 바꾸면 값이 오르락내리락 해서
 * 아무 결론도 못 냈습니다. 못 박아 둔 **2.286** 도 그 얇은 자의 값입니다
 * (두꺼운 자로 다시 재면 같은 화면이 **1.634**).
 *
 * 이제 **모든 경계**를 적어 표본이 176~254 로 늡니다. 그러자 숫자가
 * 단조로워졌습니다.
 *
 * ## 그래서 나온 답 둘
 *
 * ① **경계는 격자가 아니라 자료가 정합니다.** 살을 늘릴수록 각짐이
 *    **커집니다**(1.774 → 2.057 → 2.193). 성긴 격자가 계단을 뭉개 주고
 *    있었을 뿐입니다. 렌더링 쪽에서 더 짜낼 것이 없다는 뜻입니다.
 *
 * ② **거리장은 −12% 를 줍니다** — 기본 격자에서 1.774 → 1.568,
 *    살 4배에서 2.193 → 1.936. 두 밀도에서 같은 비율이라 우연이 아닙니다.
 *    다만 −12% 가 전부입니다: 같은 래스터에서 만든 거리장은 **텍셀 안의
 *    정보를 지어낼 수 없고**, 양자화된 계단을 고를 뿐입니다.
 *
 * ⚠ 거리장 타일은 고원(기울기 0)을 1:31 경사로 바꾸므로 셰이더의 `trust`
 * 판단이 달라집니다 — 포말이 8.1% → 10.7% 로 늡니다. 그러니 −12% 가 순수한
 * 경계 이득만은 아닙니다. 아래에서 그것도 못 박습니다.
 *
 * 사용: node tools/shader-preview/bake-shore-sdf.js
 *       node tools/shader-preview/build-shore-sdf.js
 *       node tools/shader-preview/verify-shore-sdf.js
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
  const p = await b.newPage({ viewport: { width: 900, height: 700 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/shore-sdf.html', { timeout: 300000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null,
    { timeout: 300000, polling: 500 }).catch(() => {});
  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0, `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats || !stats.결과) { console.log('\nFAILURES — __stats.결과 가 없습니다.'); process.exit(1); }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);

  const r = stats.결과;
  console.log('\n== 대부도 갯벌 · 자료와 격자를 따로 흔들어 본 것 ==');
  for (const [k, v] of Object.entries(r))
    console.log(`  ${k.padEnd(14)} 각짐 ${String(v.경계각짐).padStart(6)}`
      + ` · 표본 ${String(v.경계줄).padStart(4)}줄`
      + ` · 뭍 ${v.뭍} · 포말 ${v.포말} (${v.포말비율}%) · 물 ${v.물}`);

  const 기본 = r['원본 기본'], 살2 = r['원본 살2배'], 살4 = r['원본 살4배'];
  const S기본 = r['거리장 기본'], S살4 = r['거리장 살4배'];

  console.log('\n== 자가 결론을 낼 만큼 두꺼운가 ==');
  //
  // ⚠ 이게 먼저입니다. 예전 자는 29~37줄이었고 그 표본으로 낸 결론이
  //   격자 밀도에 따라 뒤집혔습니다. 얇아지면 여기서 걸립니다.
  ok(Object.values(r).every(v => v.경계줄 >= 150),
    `모든 경우에서 표본이 150줄 이상 (${Object.values(r).map(v => v.경계줄).join(' · ')})`);

  console.log('\n== ① 경계는 격자가 아니라 자료가 정한다 ==');
  ok(살2.경계각짐 > 기본.경계각짐 && 살4.경계각짐 > 살2.경계각짐,
    `살을 늘릴수록 각짐이 커진다 — 성긴 격자가 계단을 뭉개고 있었다`
    + ` (${기본.경계각짐} → ${살2.경계각짐} → ${살4.경계각짐})`);
  ok(살4.살 === 4 * 기본.살, `살을 실제로 네 배로 늘렸다 (${기본.살} → ${살4.살})`);

  console.log('\n== ② 거리장은 같은 격자에서 각짐을 줄인다 ==');
  const 이득기본 = (기본.경계각짐 - S기본.경계각짐) / 기본.경계각짐;
  const 이득살4 = (살4.경계각짐 - S살4.경계각짐) / 살4.경계각짐;
  ok(이득기본 >= 0.05,
    `기본 격자에서 ${(100 * 이득기본).toFixed(1)}% 줄었다 (${기본.경계각짐} → ${S기본.경계각짐})`);
  ok(이득살4 >= 0.05,
    `살 4배에서도 ${(100 * 이득살4).toFixed(1)}% 줄었다 (${살4.경계각짐} → ${S살4.경계각짐})`);
  ok(Math.abs(이득기본 - 이득살4) <= 0.05,
    `두 밀도에서 이득이 같다 — 우연이 아니다`
    + ` (${(100 * 이득기본).toFixed(1)}% 대 ${(100 * 이득살4).toFixed(1)}%)`);

  console.log('\n== 대조: 거짓으로 이긴 것이 아닌가 ==');
  //
  // 각짐만 보면 "물을 다 지우기" 가 만점을 받습니다. 해안선이 통째로
  // 옮겨가지 않았는지, 물이 사라지지 않았는지 함께 봅니다.
  ok(Math.abs(S기본.뭍 - 기본.뭍) / 기본.뭍 <= 0.02,
    `해안선을 통째로 옮기지 않았다 — 뭍 화소 ${기본.뭍} → ${S기본.뭍}`
    + ` (${(100 * Math.abs(S기본.뭍 - 기본.뭍) / 기본.뭍).toFixed(2)}%)`);
  ok(S기본.물 >= 0.8 * 기본.물,
    `물을 지워서 이긴 것이 아니다 (${기본.물} → ${S기본.물})`);

  console.log('\n== 남는 값: 거리장이 깊이 판단도 건드린다 ==');
  //
  // 고원(기울기 0)을 1:31 경사로 바꾸므로 셰이더의 trust 가 그 자리를
  // 믿기 시작합니다. 그래서 −12% 가 순수한 경계 이득만은 아닙니다.
  // 나중에 이것까지 잡으면 이 단언이 걸리고, 그때 값을 새로 못 박으면 됩니다.
  ok(S기본.포말 > 기본.포말,
    `거리장은 포말을 늘린다 — 고원에 기울기가 생겨 trust 가 달라진다`
    + ` (${기본.포말비율}% → ${S기본.포말비율}%)`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
