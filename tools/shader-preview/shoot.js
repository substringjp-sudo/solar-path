/**
 * 미리보기 페이지를 헤드리스 크로미움(SwiftShader)에서 렌더해 PNG로 저장합니다.
 *
 * 사용: node shoot.js [페이지.html] [출력.png] [대기ms]
 *   기본값은 full.html → full-preview.png, 대기 8000ms
 *   SwiftShader에서 20초 넘게 도는 페이지(패널이 많거나 층 분리를 위해
 *   여러 번 굽는 것들)는 대기를 늘려야 빈 캔버스를 찍지 않습니다.
 * 미리 preview 디렉터리에서 `python3 -m http.server 8123` 을 띄워두세요
 * (file:// 로는 ES 모듈이 CORS에 막힙니다).
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { SCRATCH: SP } = require('./paths');
const page = process.argv[2] || 'full.html';
const out = process.argv[3] || 'full-preview.png';
const waitMs = Number(process.argv[4]) || 8000;
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1220, height: 800 } });
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  // ⚠ page.goto 의 기본 제한은 30초입니다. 레이마치처럼 무거운 습작은
  // 로드 중에 이미 그리기 때문에 그 안에 못 끝나고, 그러면 그림이 아니라
  // TimeoutError 만 남습니다. 대기 시간에 맞춰 넉넉히 줍니다.
  await p.goto('http://localhost:8123/' + page, { timeout: waitMs + 60000 });
  await p.waitForTimeout(waitMs);
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
