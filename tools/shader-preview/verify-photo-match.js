/**
 * **렌더가 실제 하늘 사진에서 얼마나 떨어져 있는가** 판정 — `photo-match.html`.
 *
 * "현실감이 없다"는 지적은 잣대가 없으면 취향 논쟁으로 끝납니다. 위키미디어
 * 공용의 실제 하늘 사진에서 뽑은 값이 과녁이고, 같은 조건의 렌더를 **같은
 * 함수**(tools/photo-ref/sky-stats.js)로 재서 견줍니다.
 *
 * 준비:
 *   node tools/photo-ref/fetch-sky-refs.js
 *   node tools/photo-ref/measure-photos.js
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-photo-match.js
 * 사용: node tools/shader-preview/verify-photo-match.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');
const fs = require('fs');
const path = require('path');

const PHOTO = path.join(__dirname, '../../.harness/photoref/photo-stats.json');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}

(async () => {
  if (!fs.existsSync(PHOTO)) {
    console.log('사진 지표가 없습니다. node tools/photo-ref/measure-photos.js 를 먼저 돌리세요.');
    process.exit(1);
  }
  const { target } = JSON.parse(fs.readFileSync(PHOTO, 'utf8'));

  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1220, height: 800 } });
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await p.goto(ORIGIN + '/photo-match.html');
  await p.waitForFunction(() => document.title.startsWith('DONE'), { timeout: 180000 });
  const stats = await p.evaluate(() => window.__stats);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);

  const at = t => stats.결과.find(r => r.tag === t);
  const 비 = (r, t, k) => r[k] / Math.max(1e-6, t[k]);

  console.log('\n== 렌더 대 사진 — 같은 지표, 같은 폭(320) ==');
  console.log('  조건          지표      사진    렌더    배율');
  const rows = [];
  for (const tag of Object.keys(target)) {
    const r = at(tag), t = target[tag];
    if (!r) continue;
    for (const k of ['채도', '대비', '국소대비', '채도기울기', '원색', '흰포화']) {
      const v = 비(r, t, k);
      rows.push({ tag, k, photo: t[k], render: r[k], ratio: v });
      console.log(`  ${tag.padEnd(13)} ${k.padEnd(9)} ${String(t[k]).padStart(6)} `
        + `${String(r[k]).padStart(7)} ${(v).toFixed(2).padStart(7)}x`);
    }
  }

  // ── 판정 ───────────────────────────────────────────────────────────
  //
  // 절대값이 아니라 **사진 대비 배율**로 봅니다. 사진마다 노출·현상이
  // 달라 절대값을 못으로 박으면 사진을 바꿀 때마다 낡습니다.
  console.log('\n== 구름 대비가 사진 범위 안인가 ==');
  // 사용자의 지적이 바로 이것입니다: "구름이 대비가 너무 심하다".
  // 국소대비는 이웃 화소 밝기차라 구름 가장자리의 날카로움이 여기 잡힙니다.
  for (const tag of Object.keys(target)) {
    const r = at(tag); if (!r) continue;
    const v = r.국소대비 / Math.max(1e-6, target[tag].국소대비);
    ok(v < 2.0, `${tag} 국소대비가 사진의 2배 미만 (${v.toFixed(2)}x)`);
  }

  console.log('\n== 하늘이 지평선으로 가며 흐려지는가 ==');
  // 실제 하늘은 **예외 없이** 지평선 쪽 채도가 낮습니다 — 공기가 두꺼워
  // 산란광이 색을 씻어 냅니다(에어리얼 퍼스펙티브). 잰 사진 9장 중
  // 과대현상된 HDR 한 장을 빼면 전부 기울기 < 1 입니다.
  for (const tag of Object.keys(target)) {
    const r = at(tag); if (!r) continue;
    ok(r.채도기울기 < 1.0, `${tag} 하단 채도가 상단보다 낮다 (${r.채도기울기})`);
  }

  console.log('\n== 원색 화소가 사진 범위 안인가 ==');
  // 채도 0.6 을 넘는 화소의 비율. 실제 하늘은 맑은 날 파랑에서만 높고
  // 노을·박명에서는 오히려 **낮습니다**(공기가 색을 씻어 냄).
  for (const tag of Object.keys(target)) {
    const r = at(tag); if (!r) continue;
    ok(r.원색 < Math.max(0.10, target[tag].원색 * 2.5 + 0.05),
       `${tag} 원색 화소가 사진 범위 (${r.원색} 대 ${target[tag].원색})`);
  }

  // ── 구름 크기와 모양 ────────────────────────────────────────────────
  //
  // 색만 재던 것에 자를 하나 더 댑니다. 여기서만은 **조건별 과녁을 안 씁니다.**
  // 위키미디어의 조건 라벨(검색어·분류)이 못 미덥기 때문입니다 — "흐림"으로
  // 받은 43장이 대부분 노을이었고, 눈으로 안 봤으면 그 과녁으로 튜닝할
  // 뻔했습니다.
  //
  // 다행히 구조 지표는 **조건과 거의 무관**했습니다. 사진 129장의 조건별
  // 무늬기울기 중앙값이 2.6~3.17 로 다 비슷합니다. 그래서 라벨을 안 믿고
  // 전체 분포(p10~p90)를 과녁으로 씁니다.
  const B_LO = 2.03, B_HI = 3.47;      // 무늬기울기 p10~p90 (중앙 2.98)
  const L_LO = 0.014, L_HI = 0.049;    // 국소대비   p10~p90 (중앙 0.029)
  console.log('\n== 구름 모양이 실제 하늘의 거칠기 범위 안인가 ==');
  console.log(`  (사진 129장 분포: 무늬기울기 ${B_LO}~${B_HI}, 국소대비 ${L_LO}~${L_HI})`);
  for (const r of stats.결과) {
    if (!Number.isFinite(r.무늬기울기)) continue;
    console.log(`  ${r.tag.padEnd(13)} 무늬기울기 ${String(r.무늬기울기).padStart(5)}` +
                `   구름각크기 ${String(r.구름각크기).padStart(6)}°   국소대비 ${r.국소대비}`);
    ok(r.무늬기울기 >= B_LO && r.무늬기울기 <= B_HI,
       `${r.tag} 무늬기울기가 사진 범위 (${r.무늬기울기})`);
  }
  console.log('\n== 구름에 구조가 있는가 ==');
  // 구름각크기가 화면 크기(62°)에 붙으면 파워가 전부 최대 규모에 몰린 것 —
  // 화면에 구름 무늬가 사실상 없다는 뜻입니다.
  for (const r of stats.결과) {
    if (!Number.isFinite(r.구름각크기)) continue;
    ok(r.구름각크기 < 55, `${r.tag} 구름 무늬가 화면보다 작다 (${r.구름각크기}°)`);
  }

  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
