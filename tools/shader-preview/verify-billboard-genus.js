/**
 * 5단계 합격 판정 (docs/CLOUD_TEXTURE_PLAN.md 3-G).
 *
 * "빌보드는 적운·적란운으로 후퇴" — 나머지 여덟 운형(Ci·Cc·Cs·Ac·As·Sc·St·Ns)은
 * 이제 덱이 담당하고 빌보드는 그리지 않아야 합니다.
 *
 * `build-overcast-preview.js`가 이미 8가지 운량·태양고도 조합을 돌려
 * `built.instances`에서 뽑은 운형 집합(`genera`)과 개수(`n`)를 남기므로,
 * 새 미리보기 없이 그 결과를 읽습니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-overcast-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-billboard-genus.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const BILLBOARD_ALLOWED = new Set(['Cumulus', 'Cumulonimbus']);

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1220, height: 800 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto('http://localhost:8123/overcast.html');
  await p.waitForTimeout(8000);

  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0,
    `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/SHADER_ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats || !stats.length) {
    console.log('\nFAILURES — __stats 가 없습니다.');
    process.exit(1);
  }

  console.log('\n== 장면별 빌보드 운형 ==');
  console.log('장면              │ 개수 │ 운형');
  let badGenus = 0;
  for (const s of stats) {
    const genera = (s.genera || '').split(',').filter(Boolean);
    const bad = genera.filter(g => !BILLBOARD_ALLOWED.has(g));
    if (bad.length > 0) badGenus++;
    console.log('%s │ %s │ %s%s',
      s.label.padEnd(16), String(s.n).padStart(4), s.genera || '(없음)',
      bad.length ? '  ← 허용 안 됨: ' + bad.join(',') : '');
  }
  ok(badGenus === 0, '모든 장면에서 빌보드 운형이 적운·적란운뿐');

  console.log('\n== 전천 흐림(8/8)에서 빌보드가 사라지는가 ==');
  // 8/8은 대부분 층운·난층운·층적운으로 판정되므로(Cumulus 아님),
  // 이제 빌보드가 전부 덱으로 넘어가 n이 0이어야 합니다.
  const overcast = stats.filter(s => s.label.includes('8/8'));
  ok(overcast.length > 0, '흐림 8/8 장면을 찾음');
  for (const s of overcast) {
    ok(s.n === 0, `${s.label}: 빌보드 0장 (덱이 전담, 실측 ${s.n})`);
  }

  console.log('\n== 권층운(Cs) 장면에서 빌보드가 사라지는가 ==');
  // 이 시나리오는 운형이 처음부터 Cirrostratus로 강제된 무리(halo) 장면입니다.
  // Cs는 연속 베일이라 빌보드가 없어야 합니다(늘 그랬지만, 5단계로 더 확실해짐).
  const halo = stats.find(s => s.label.includes('권층운'));
  ok(halo && halo.n === 0, `권층운 장면: 빌보드 0장 (실측 ${halo ? halo.n : '없음'})`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
