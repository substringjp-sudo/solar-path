/**
 * **산에 입체감이 있는가** — 진단과 회귀 방지. `build-relief.js` 의 짝.
 *
 * 실기 보고: "여전히 지형에 자연스러운 그림자가 존재하지 않아서 산에
 * 입체감이 느껴지지 않아."
 *
 * ## 재 본 것과, 그래서 **고치지 않은** 것
 *
 * 마니산 정상에서 네 가지 조명으로 지면 화소 밝기의 퍼짐을 쟀습니다.
 * 어느 쪽이든 σ 가 평균의 1% 안팎입니다 — 판지가 맞습니다. 원인을 하나씩
 * 지워 보았고, 짐작이 **세 번 다 틀렸습니다**:
 *
 * ① **법선이 뭉개졌나?** 아닙니다. 해를 지평선에 수평으로 두면(그러면 화면이
 *    곧 n.x) σ 가 6.38, 범위 43~118 입니다. 법선은 살아 있습니다.
 * ② **표시의 최소 밝기 바닥이 지우나?** 앱이 실제로 쓰는 조도에서는 아닙니다.
 *    해 1° 에서도 지형 밝기가 155 라 바닥(54)에 안 닿습니다 — 바닥을 껐다 켠
 *    두 값이 **소수점까지 같습니다.** (조도를 10배 작게 어림잡았을 때는
 *    σ 가 정확히 0 이었습니다. 하네스의 잘못이었지 앱의 잘못이 아니었습니다.)
 * ③ **직달광이 너무 약한가?** 앱의 대기 모형에서 수평면 직달은 하늘의
 *    0.094배입니다 — 맑은 날 실제 값(약 3.4배)보다 36배 작습니다. 그런데
 *    물리 비율로 올려 노출을 맞춰 봐도 σ 는 1.68 → 2.16 밖에 안 갑니다.
 *
 * 남은 설명은 **기하 그 자체**입니다. 해가 25° 에 있으면 거의 수직인 법선들이
 * 전부 `sin 25° = 0.42` 라는 같은 받침 위에 놓이고, 그 위에 얹히는 차이가
 * 작습니다. 게다가 이 자리 DEM 의 경사 중앙값이 13.6° 로 완만합니다. 즉
 * 지금 보이는 평평함의 상당 부분은 **자료와 태양 기하가 정말 그런 것**이고,
 * 한 줄 고쳐서 될 일이 아닙니다.
 *
 * 그래서 이 판정은 고침을 주장하지 않습니다. **재 본 값을 못 박아** 두어,
 * 앞으로 무언가가 지형을 더 납작하게 만들면 그때 걸리게 합니다.
 *
 * ⚠ 천공률 `(1 + cos θ)/2` 를 넣어 봤다가 뺐습니다. 물리로는 맞지만 급한
 * 사면을 밝게 하는 암반 알베도와 정확히 반대로 작용해 서로를 지웠습니다
 * (σ 1.192 → 0.618). **음영을 늘리려던 항이 음영을 줄였습니다.**
 *
 * 사용: node tools/shader-preview/build-relief.js
 *       node tools/shader-preview/verify-relief.js
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
  const p = await b.newPage({ viewport: { width: 960, height: 760 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/relief.html', { timeout: 300000 });
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
  if (!stats || !stats.결과 || !stats.결과.진단) {
    console.log('\nFAILURES — __stats.결과 가 없습니다.'); process.exit(1);
  }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);
  const r = stats.결과, g = r.진단;

  console.log('\n== 조명별 (마니산 정상, 해 25°) ==');
  for (const k of Object.keys(r)) {
    if (k === '진단' || k === '평판') continue;
    const v = r[k].그대로;
    console.log(`  ${k.padEnd(16)} 평균 ${String(v.평균).padStart(7)} · σ ${String(v.표준편차).padStart(6)}`
      + ` (평균의 ${(100 * v.표준편차 / v.평균).toFixed(2)}%) · ${v.최소}~${v.최대}`);
  }
  console.log('\n== 항을 하나씩 지워 보기 ==');
  for (const k of Object.keys(g))
    console.log(`  ${k.padEnd(22)} 평균 ${String(g[k].평균).padStart(7)} · σ ${String(g[k].표준편차).padStart(6)}`
      + ` · ${g[k].최소}~${g[k].최대}`);

  console.log('\n== 판정 ==');

  // ── 자가 점검: 이 자가 실제로 음영을 잴 수 있는가 ────────────────────────
  ok(r.평판.그대로.표준편차 === 0,
    `대조: 평평한 땅은 완전히 고르다 (σ ${r.평판.그대로.표준편차}) — 자가 잡음을 안 만든다`);
  ok(g['수평 해 (=n.x)'].표준편차 >= 4,
    `법선은 살아 있다 — 수평 해로 비추면 σ ${g['수평 해 (=n.x)'].표준편차} (≥ 4)`);
  // ⚠ 예전에는 이 자리에서 σ 가 정확히 0 이었습니다 — 노출 1/8 이 장면을
  //   표시 바닥 아래로 통째로 밀어넣었기 때문입니다. 직달 눈금을 물리값으로
  //   올린 뒤로는 1/8 로 줄여도 바닥 위에 남습니다(평균 71). 그래서 "바닥이
  //   뭉갠다"가 아니라 **"노출을 줄이면 음영도 같이 줄어든다"** 로 계측기를
  //   확인합니다 — 자가 상수를 안 만든다는 뜻은 그대로입니다.
  ok(g['직달만 · 노출 1/8'].표준편차 < g['하늘몫 0 (직달만)'].표준편차,
    `계측기 확인: 노출을 1/8 로 줄이면 음영도 함께 줄어든다`
    + ` (σ ${g['하늘몫 0 (직달만)'].표준편차} → ${g['직달만 · 노출 1/8'].표준편차})`);

  // ── 진단 못 박기 ─────────────────────────────────────────────────────────
  ok(Math.abs(g['새벽 · 바닥 그대로'].평균 - g['새벽 · 바닥끔'].평균) < 0.01
     && Math.abs(g['새벽 · 바닥 그대로'].표준편차 - g['새벽 · 바닥끔'].표준편차) < 0.01,
    `앱이 쓰는 조도에서는 바닥이 안 물린다 — 껐다 켠 값이 같다`
    + ` (${g['새벽 · 바닥 그대로'].평균} / ${g['새벽 · 바닥끔'].평균})`);
  // ── 직달 눈금 하나만 바꾼 A/B ──────────────────────────────────────────
  // 두 벌의 차이는 SOLAR_BEAM_SCALE 하나뿐이고, 노출은 각자 평평한 지면의
  // 밝기를 지키도록 따라옵니다. σ 가 벌어지면 그것은 눈금이 만든 것입니다.
  const 옛 = g['옛 눈금 (S=1)'], 새 = g['물리 눈금 (S=26)'];
  const 늘음 = (새.표준편차 - 옛.표준편차) / 옛.표준편차;
  ok(늘음 >= 0.25,
    `직달을 물리 눈금으로 올리면 음영이 크게 는다`
    + ` (σ ${옛.표준편차} → ${새.표준편차}, +${(100 * 늘음).toFixed(1)}%)`);
  ok(새.표준편차 < 0.5 * g['수평 해 (=n.x)'].표준편차,
    `그래도 수평 해에 한참 못 미친다 — 남은 것은 태양 고도와 완만한 경사`
    + ` (${새.표준편차} vs ${g['수평 해 (=n.x)'].표준편차})`);

  // 눈금을 올린 만큼 **해의 방향이 화면을 좌우해야** 합니다. 예전에는 네
  // 방위의 평균이 118~126 으로 붙어 있었습니다 (가장 밝은 쪽이 어두운 쪽의
  // 1.06배) — 어느 쪽에서 비추든 같은 그림이라는 뜻이고, 그것이 곧 판지입니다.
  const 방위 = Object.keys(r).filter(k => k !== '진단' && k !== '평판');
  const 평균들 = 방위.map(k => r[k].그대로.평균);
  const 대비 = Math.max(...평균들) / Math.max(1e-6, Math.min(...평균들));
  ok(대비 >= 1.4,
    `해의 방향이 화면을 좌우한다 — 가장 밝은 방위가 가장 어두운 쪽의`
    + ` ${대비.toFixed(2)}배 (${평균들.map(v => v.toFixed(0)).join(' / ')})`);

  // ── 회귀 방지: 지금보다 더 납작해지면 걸립니다 ──────────────────────────
  for (const k of Object.keys(r)) {
    if (k === '진단' || k === '평판') continue;
    ok(r[k].그대로.표준편차 >= 1.4,
      `${k}: 음영이 더 죽지 않았다 (σ ${r[k].그대로.표준편차} ≥ 1.4)`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
