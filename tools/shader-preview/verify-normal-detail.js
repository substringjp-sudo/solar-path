/**
 * **법선 재구성(①)과 자료 아래 결(②)** 합격 판정.
 * `build-normal-detail.js` 의 짝.
 *
 * ## 무엇을 못 박나
 *
 * ⚠ **먼저 실루엣입니다.** 둘 다 법선에만 걸었으므로 알파 마스크가 한 화소도
 * 달라지면 안 됩니다. 이게 깨지면 나머지 수치는 볼 것도 없습니다 — 높이를
 * 건드린 것이고, 그러면 기존 실루엣 판정 전부와 싸우게 됩니다.
 *
 * ① 이중선형은 C0 라 텍셀 경계마다 법선이 꺾입니다. 3차 B-스플라인은 C2 라
 *   꺾임이 없고, 근사 필터라 자료의 1m 계단도 저역통과합니다.
 *   화면에서 **꺾임(밝기 2차 차분)이 21% 줄고** 음영의 퍼짐은 오히려 늡니다
 *   — 각짐이 줄면서 진짜 기복이 드러난 것입니다.
 *
 * ② 결의 진폭은 **그 자리의 텍셀 규모 기울기에 비례**합니다. 그래서
 *   평평한 땅에서는 정확히 0 이어야 합니다 — 이 대조가 "잡음을 그냥
 *   뿌린 것" 과 "자료가 말한 만큼만 이어 그린 것" 을 가릅니다.
 *   그리고 잔 옥타브가 거리에 따라 꺼지므로 **먼 쪽 결이 가까운 쪽보다
 *   옅어야** 합니다.
 *
 * ⚠ 세기(uDetail)는 **자료에서 유도한 값이 아닙니다.** 자료가 정하는 것은
 * 옥타브 사이의 **비율**(허스트 지수 H = 0.80~0.84, R² 0.996)이고, 절대
 * 세기는 값 잡음의 기울기 상수에 걸려 있어 눈금이 안 잡힙니다. 그래서 세기를
 * 훑어 **평균 밝기가 5% 넘게 안 움직이는** 가장 큰 값(0.10)으로 잡았습니다.
 * 0.6 이면 평균이 109 → 77 로 30% 떨어집니다 — 그건 질감이 아니라 다른
 * 표면입니다.
 *
 * 사용: node tools/shader-preview/build-normal-detail.js
 *       node tools/shader-preview/verify-normal-detail.js
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
  await p.goto(ORIGIN + '/normal-detail.html', { timeout: 300000 });
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
  console.log('\n== 마니산 정상 · 해 25° 측광 ==');
  for (const [k, v] of Object.entries(r))
    console.log(`  ${k.padEnd(16)} 평균 ${String(v.평균).padStart(7)} · σ ${String(v.퍼짐).padStart(7)}`
      + ` · 결 ${String(v.결).padStart(7)} · 꺾임 ${String(v.꺾임).padStart(7)}`
      + ` · 실루엣차이 ${v.실루엣차이 ?? '-'}`
      + (v.띠 ? ` · 먼쪽 ${v.띠.먼쪽} / 가까운쪽 ${v.띠.가까운쪽}` : ''));

  const 옛 = r['옛 방식'], B = r['① B-스플라인'];
  const 기본 = r['①+② 0.10 (기본)'], 셈 = r['①+② 0.60'];
  const 평판 = r['평판 · ①+②'];

  console.log('\n== 먼저: 높이를 안 건드렸는가 ==');
  ok([옛, B, 기본, 셈].every(v => v.실루엣차이 === 0),
    `모든 경우에서 실루엣이 한 화소도 안 달라졌다`
    + ` (${[옛, B, 기본, 셈].map(v => v.실루엣차이).join(' · ')})`);

  console.log('\n== ① B-스플라인이 꺾임을 줄이는가 ==');
  const 줄음 = (옛.꺾임 - B.꺾임) / 옛.꺾임;
  ok(줄음 >= 0.10,
    `꺾임이 ${(100 * 줄음).toFixed(1)}% 줄었다 (${옛.꺾임} → ${B.꺾임})`);
  ok(B.퍼짐 > 옛.퍼짐,
    `그런데 음영의 퍼짐은 오히려 늘었다 — 각짐이 줄며 진짜 기복이 드러난다`
    + ` (σ ${옛.퍼짐} → ${B.퍼짐})`);
  ok(Math.abs(B.평균 - 옛.평균) / 옛.평균 <= 0.03,
    `평균 밝기는 거의 그대로 (${옛.평균} → ${B.평균})`);

  console.log('\n== ② 결이 자료를 따라가는가 ==');
  //
  // 이게 ② 의 핵심 대조입니다. 진폭이 그 자리 기울기에 비례하므로 평평한
  // 땅에서는 **정확히** 0 이어야 합니다. 0 이 아니면 자료와 무관한 잡음을
  // 그리고 있는 것입니다.
  ok(평판 && 평판.결 === 0 && 평판.퍼짐 === 0,
    `평평한 땅(DEM 없음)에서는 결이 정확히 0 (결 ${평판.결} · σ ${평판.퍼짐})`);
  ok(기본.결 > 3 * B.결,
    `기복이 있는 곳에서는 결이 뚜렷하다 (${B.결} → ${기본.결})`);
  ok(기본.띠.먼쪽 < 기본.띠.가까운쪽,
    `먼 쪽이 옅다 — 잔 옥타브가 거리에 따라 꺼진다`
    + ` (먼쪽 ${기본.띠.먼쪽} < 가까운쪽 ${기본.띠.가까운쪽})`);

  console.log('\n== 세기: 질감인가 다른 표면인가 ==');
  //
  // 결은 자료 아래 규모의 질감이지 다른 면이 아닙니다. 평균 밝기를 크게
  // 옮기면 그건 표면을 바꾼 것입니다 — 법선을 세게 흔들면 ndl 이 0 에서
  // 잘려 화면이 통째로 어두워집니다.
  ok(Math.abs(기본.평균 - B.평균) / B.평균 <= 0.05,
    `기본 세기(0.10)는 평균을 5% 넘게 안 옮긴다`
    + ` (${B.평균} → ${기본.평균}, ${(100 * (기본.평균 - B.평균) / B.평균).toFixed(1)}%)`);
  ok(Math.abs(셈.평균 - B.평균) / B.평균 > 0.20,
    `대조: 세게 걸면(0.60) 평균이 크게 떨어진다 — 그래서 안 씁니다`
    + ` (${B.평균} → ${셈.평균}, ${(100 * (셈.평균 - B.평균) / B.평균).toFixed(1)}%)`);
  const 단조 = ['①+② 0.10 (기본)', '①+② 0.20', '①+② 0.35', '①+② 0.60']
    .map(k => r[k]).filter(Boolean);
  ok(단조.every((v, i) => i === 0 || v.결 > 단조[i - 1].결),
    `세기를 올리면 결이 단조 증가 (${단조.map(v => v.결).join(' → ')})`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
