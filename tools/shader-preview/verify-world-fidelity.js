/**
 * **전 세계 무작위 예보 → 화면** 합격 판정. `build-world-fidelity.js` 의 짝.
 *
 * 무엇을 왜 재는지는 build 쪽 머리말에 있습니다. 여기서는 **예보가 화면에
 * 얼마나 충실히 옮겨지는가**만 봅니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/build-world-fidelity.js
 * 사용: node tools/shader-preview/verify-world-fidelity.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const NAME = { low: '저층', mid: '중층', high: '상층' };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

/** 순위상관(스피어만) — 둘이 같은 방향으로 움직이는가. 선형을 안 가정합니다. */
function spearman(xs, ys) {
  const rank = a => {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(a.length);
    for (let i = 0; i < idx.length;) {
      let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys), n = xs.length;
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return num / Math.sqrt(dx * dy);
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  // ⚠ `load` 를 기다리면 안 됩니다 — 모듈 스크립트가 48표본을 동기로 돌려
  //   그 이벤트가 30초 안에 안 옵니다. 문서만 받고 제목을 기다립니다.
  await p.goto(ORIGIN + '/world-fidelity.html', { waitUntil: 'commit' });
  await p.waitForFunction(() => document.title === 'done', null, { timeout: 300000 });
  const data = JSON.parse(await p.$eval('#out', e => e.textContent));
  await b.close();

  if (data.fatal) { console.log('  FAIL: 페이지가 죽었습니다\n' + data.fatal); process.exit(1); }
  const rows = data.rows;
  console.log(`\n표본 ${rows.length}개 · glError ${data.glError} · 페이지 예외 ${data.errors.length}`);
  ok(data.glError === 0, `glGetError == 0 (${data.glError})`);
  ok(data.errors.length === 0, `페이지 예외 없음 (${data.errors.length})`);

  // ── [0] 자가 검증 — 운량 0 이면 화면에 아무것도 없어야 합니다.
  console.log('\n[0] 자가 검증 — 운량 0 대조');
  {
    const bad = rows.filter(r => r.영대조.면적 > 0.001);
    ok(bad.length === 0, `운량 0 이면 τ 화소가 없다 (어긴 표본 ${bad.length}/${rows.length})`);
  }

  // ── [1] 운량 → 면적: 같은 방향으로 움직이는가.
  console.log('\n[1] 예보 운량 → 화면 면적');
  for (const L of ['low', 'mid', 'high']) {
    const use = rows.filter(r => r.층[L].운량 != null);
    const xs = use.map(r => r.층[L].운량), ys = use.map(r => r.층[L].면적);
    const rho = spearman(xs, ys);
    console.log(`  ${NAME[L]}  n=${use.length}  순위상관 ${rho.toFixed(3)}`);
    ok(rho > 0.9, `${NAME[L]}: 예보 운량이 오르면 화면 면적도 오른다 (ρ ${rho.toFixed(3)} > 0.9)`);
  }

  // ── [2] 운량 → 면적: **크기**도 맞는가. 1:1 이어야 합니다.
  console.log('\n[2] 면적이 운량과 같은 크기인가 (1:1 이어야 함)');
  for (const L of ['low', 'mid', 'high']) {
    const use = rows.filter(r => r.층[L].운량 >= 10);
    if (use.length < 5) { console.log(`  ${NAME[L]}  표본 부족 (${use.length})`); continue; }
    const errs = use.map(r => Math.abs(r.층[L].면적 * 100 - r.층[L].운량));
    const med = [...errs].sort((a, b) => a - b)[Math.floor(errs.length / 2)];
    const worst = Math.max(...errs);
    console.log(`  ${NAME[L]}  n=${use.length}  중앙오차 ${med.toFixed(1)}%p · 최악 ${worst.toFixed(1)}%p`);
    ok(med < 20, `${NAME[L]}: 중앙 오차가 20%p 미만 (${med.toFixed(1)})`);
  }

  // ── [3] 층별 무늬 크기 — ⚠ **여기서는 아무것도 단언하지 않습니다.**
  //    층마다 셰이더의 셀 크기 상수가 다르므로, 이 수치로는 "예보 고도가
  //    화면에 닿는가" 를 **가릴 수 없습니다.** 처음에 여기에 단언을 걸었다가
  //    [3b] 대조에 걸렸습니다 — 부호까지 반대였습니다. 관찰로만 남깁니다.
  console.log('\n[3] 층별 무늬 크기 (관찰 — 고도의 증거가 아닙니다)');
  {
    const pairs = [];
    for (const r of rows) for (const L of ['low', 'mid', 'high']) {
      const c = r.층[L];
      if (c.운량 < 20 || c.운량 > 85 || c.무늬 == null) continue;
      if (!r.고도[L + 'From']) continue;
      pairs.push({ alt: r.고도[L], len: c.무늬, L });
    }
    for (const L of ['low', 'mid', 'high']) {
      const g = pairs.filter(p => p.L === L);
      if (!g.length) continue;
      console.log(`  ${NAME[L]}  n=${g.length}  고도 ${mean(g.map(p => p.alt)).toFixed(1)}km · 무늬 ${mean(g.map(p => p.len)).toFixed(1)}화소`);
    }
    console.log('  → 층끼리 견주면 셀 크기 상수가 섞입니다. 고도는 [3b] 에서 봅니다.');
  }

  // ── [3b] ⚠ **고도가 화면에 닿는가** — 같은 층·같은 운량에서 고도만 바꿉니다.
  //
  //    기하가 예측을 줍니다. 고도 h 의 슬랩을 고도각 θ 로 보면 지상거리는
  //    d = h/tanθ 이고, 크기 L 인 셀이 차지하는 각은
  //
  //        Δθ = L·sin²θ / h        → **고도에 반비례**
  //
  //    그래서 상층운은 잔무늬로, 적운은 덩어리로 보입니다. 화면 무늬 크기가
  //    그 비를 따라야 합니다.
  //
  //    ⚠ 처음에 [3] 에서 "높은 층이 무늬가 크다" 를 단언으로 걸었는데 이
  //    대조가 **부호까지 뒤집었습니다.** 층마다 셀 크기 상수가 다른 것을
  //    고도 효과로 잘못 읽고 있었습니다.
  console.log('\n[3b] 고도만 바꾼다 — 무늬 크기는 고도에 반비례해야 한다');
  {
    const A = 8, B = 14;                      // 넣은 두 고도(km)
    const 예측비 = B / A;                      // 무늬(A)/무늬(B) 가 이만큼이어야 합니다
    const use = rows.filter(r => r.고도대조 && r.고도대조.낮게8.무늬 > 0 && r.고도대조.높게14.무늬 > 0);
    console.log(`  표본 ${use.length}개`);
    if (use.length >= 5) {
      const lo = mean(use.map(r => r.고도대조.낮게8.무늬));
      const hi = mean(use.map(r => r.고도대조.높게14.무늬));
      const 실측비 = lo / hi;
      const down = use.filter(r => r.고도대조.높게14.무늬 < r.고도대조.낮게8.무늬).length;
      console.log(`  ${A}km: 무늬 ${lo.toFixed(1)}화소 · ${B}km: ${hi.toFixed(1)}화소`);
      console.log(`  예측 비 ${예측비.toFixed(2)} (= ${B}/${A}) · 실측 ${실측비.toFixed(2)} · 어긋남 ${((실측비/예측비-1)*100).toFixed(0)}%`);
      ok(hi < lo * 0.9, `고도를 올리면 무늬가 작아진다 (${lo.toFixed(1)} → ${hi.toFixed(1)}) — **고도가 화면에 실제로 닿는다**`);
      ok(down >= use.length * 0.8, `표본 대부분에서 같은 방향 (${down}/${use.length})`);
      ok(Math.abs(실측비 / 예측비 - 1) < 0.2,
         `크기까지 기하 예측과 맞는다 (실측 ${실측비.toFixed(2)} vs 예측 ${예측비.toFixed(2)}, 20% 안)`);
      // 음성 대조 — 고도를 안 바꾸면 화면이 안 바뀌어야 합니다.
      const nochange = use.filter(r => {
        const a = r.고도대조.같게;
        return Math.abs(a.평균τ - a.평균τ) < 1e-9;
      }).length;
      ok(nochange === use.length, `같은 고도를 넣으면 같은 값이 나온다 (${nochange}/${use.length})`);
    } else {
      ok(false, `대조 표본이 모자랍니다 (${use.length})`);
    }
  }

  // ── [4] 전 세계로 돌렸을 때 **죽는 표본이 없는가.**
  console.log('\n[4] 전 세계 어디서나 그려지는가');
  {
    const nan = rows.filter(r => ['low','mid','high'].some(L => !Number.isFinite(r.층[L].면적)));
    ok(nan.length === 0, `면적이 NaN 인 표본 없음 (${nan.length})`);
    const blank = rows.filter(r => r.예보.total >= 80 &&
      ['low','mid','high'].every(L => r.층[L].면적 < 0.05));
    ok(blank.length === 0, `총운량 80% 이상인데 세 층 다 빈 표본 없음 (${blank.length})`);
    const badAlt = rows.filter(r => [r.고도.low, r.고도.mid, r.고도.high]
      .some(v => !(v > 0.05 && v < 25)));
    ok(badAlt.length === 0, `층 높이가 0.05~25km 를 벗어난 표본 없음 (${badAlt.length})`);
  }

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
