const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const SP='/tmp/claude-0/-home-user-solar-path/eaf4c0af-06ca-5c06-a0d7-588dbfb07373/scratchpad';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1220, height: 800 } });
  await p.goto('http://localhost:8123/full.html');
  await p.waitForTimeout(5000);
  console.log('TITLE:', await p.title());
  const errs = await p.evaluate(()=>window.__errors||[]);
  errs.forEach(e => { const m=e.match(/ERROR:[^\n]*/g); if(m) m.slice(0,8).forEach(x=>console.log(x)); });
  await p.locator('#wrap').screenshot({ path: SP+'/full-preview.png' });
  await b.close();
})();
