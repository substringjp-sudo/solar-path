const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [qs, out] = [process.argv[2] || '', process.argv[3] || 'out.png'];
  const p0 = new URLSearchParams(qs); const W = +(p0.get('w') || 390), H = +(p0.get('hpx') || 584);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: W, height: H } });
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text().slice(0, 300)); });
  await p.goto('http://localhost:8311/' + (process.env.PAGE || 'index.html') + '?' + qs, { waitUntil: 'commit', timeout: 120000 });
  await p.waitForFunction(() => /^DONE::/.test(document.title), null, { timeout: 900000, polling: 1000 });
  console.log(JSON.stringify(await p.evaluate(() => ({ e: window.__errors, s: window.__stats }))));
  const url = await p.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  require('fs').writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  await b.close();
})();
