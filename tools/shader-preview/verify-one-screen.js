/**
 * **한 화면 안에서** 기상 수치만으로 좌우가 갈리는가.
 *
 * `verify-region-cover.js`가 보장하는 것은 **360° 하늘 전체**에 대한
 * 지역 보존입니다 — "동쪽을 보면 흐리고 서쪽을 보면 맑다". 그건 한 프레임
 * 안에서 좌우가 갈린다는 뜻이 아닙니다. 화각 60° 안에는 기상 링의 방위가
 * 2~3개밖에 안 들어오니까요 (링이 30° 간격).
 *
 * 그래서 이 검사는 **렌더된 한 프레임의 픽셀**에서 좌우 운량을 잽니다.
 * 대조군은 경계가 없는 균일 링 — 그게 없으면 좌우 차이가 기상 때문인지
 * 그냥 노이즈 때문인지 구분할 수 없습니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-one-screen-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-one-screen.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

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
  const p = await b.newPage({ viewport: { width: 1000, height: 560 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto('http://localhost:8123/one-screen.html');
  await p.waitForTimeout(15000);

  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0,
    `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/SHADER_ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats) {
    console.log('\nFAILURES — __stats 가 없습니다.');
    process.exit(1);
  }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);

  const pc = v => (v * 100).toFixed(1).padStart(5);
  const show = (name, s) => {
    console.log(`  ${name}  전체     좌 ${pc(s.left)}%  우 ${pc(s.right)}%  차이 ${pc(s.diff)}%p`);
    console.log(`  ${name}  천정쪽   좌 ${pc(s.천정쪽.left)}%  우 ${pc(s.천정쪽.right)}%  차이 ${pc(s.천정쪽.diff)}%p`);
    console.log(`  ${name}  지평선쪽 좌 ${pc(s.지평선쪽.left)}%  우 ${pc(s.지평선쪽.right)}%  차이 ${pc(s.지평선쪽.diff)}%p`);
  };

  console.log('\n== 서쪽 0% / 동쪽 95% 경계를 정면으로 ==');
  show('경계', stats.경계);
  console.log('\n== 균일 48% 대조군 ==');
  show('균일', stats.균일);

  console.log('\n== 판정 ==');
  const sig = stats.경계.diff;
  const noise = Math.abs(stats.균일.diff);
  ok(sig > 0.25,
    `한 화면 안에서 좌우가 크게 갈림 (${(sig * 100).toFixed(1)}%p > 25%p)`);
  ok(stats.경계.left < 0.20,
    `맑은 쪽이 실제로 맑음 (${(stats.경계.left * 100).toFixed(1)}% < 20%)`);
  ok(stats.경계.right > 0.40,
    `흐린 쪽이 실제로 흐림 (${(stats.경계.right * 100).toFixed(1)}% > 40%)`);
  // 대조군이 없으면 위 숫자가 기상 때문인지 노이즈 때문인지 알 수 없습니다.
  ok(noise < 0.12,
    `균일 입력에서는 좌우가 거의 같음 (${(noise * 100).toFixed(1)}%p < 12%p)`);
  ok(sig > noise * 3,
    `기상이 만든 대비가 노이즈보다 3배 이상 (${(sig / Math.max(1e-9, noise)).toFixed(1)}배)`);

  // 지평선 쪽은 시선이 멀리 나가 링의 바깥 고리를 쓰므로 대비가 가장 잘
  // 살아야 합니다. 여기가 죽으면 거리 방향 분해가 안 되고 있다는 뜻입니다.
  ok(stats.경계.지평선쪽.diff > 0.20,
    `지평선 쪽에서도 갈림 (${(stats.경계.지평선쪽.diff * 100).toFixed(1)}%p > 20%p)`);
  ok(stats.경계.지평선쪽.left < 0.12,
    `지평선 쪽 맑은 편이 거의 비어 있음 (${(stats.경계.지평선쪽.left * 100).toFixed(1)}% < 12%)`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
