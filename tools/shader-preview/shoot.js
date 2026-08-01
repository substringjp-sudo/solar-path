/**
 * 미리보기 페이지를 헤드리스 크로미움(SwiftShader)에서 렌더해 PNG로 저장합니다.
 *
 * 사용: node shoot.js [페이지.html] [출력.png]
 *   기본값은 full.html → full-preview.png
 * 미리 preview 디렉터리에서 `python3 -m http.server 8123` 을 띄워두세요
 * (file:// 로는 ES 모듈이 CORS에 막힙니다).
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const SP = '/tmp/claude-0/-home-user-solar-path/eaf4c0af-06ca-5c06-a0d7-588dbfb07373/scratchpad';
const page = process.argv[2] || 'full.html';
const out = process.argv[3] || 'full-preview.png';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1220, height: 800 } });
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await p.goto('http://localhost:8123/' + page);
  await p.waitForTimeout(8000);
  console.log('TITLE:', await p.title());
  const errs = await p.evaluate(() => window.__errors || []);
  errs.forEach(e => {
    const m = e.match(/ERROR:[^\n]*/g);
    if (m) m.slice(0, 10).forEach(x => console.log(x));
    else console.log(e.slice(0, 400));
  });
  await p.locator('#wrap').screenshot({ path: SP + '/' + out });
  await b.close();
})();
