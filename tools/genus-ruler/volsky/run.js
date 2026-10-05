/**
 * 볼륨 하늘 측정 하네스 실행기(§127).
 *
 *   묶기:  npx esbuild tools/genus-ruler/volsky/entry.ts --bundle --format=esm --outfile=.harness/volsky/app.js \
 *            --define:__DEV__=false --define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY='"1"'
 *          (index.html 은 run.js 가 씁니다)
 *   돌리기: node tools/genus-ruler/volsky/run.js jobs.json outDir [w h] [load]
 *          (load: takram 의 미리 만든 대기 표를 읽음 — 앱처럼 만들지 않아 빠르지만 앱과 같은 길은 아님)
 *
 * jobs.json = [{ name, input:{lat,lon,heightM,date(ISO),az,el,fov,layers:[…],exposure?}, frames?, quality?, res?, options?, out? }, …]
 * 결과: outDir/<name>.png(표시 색) · <name>.alpha.png(구름 불투명도) · results.json(프레임 시간·해 고도·노출).
 * 대기 표를 한 번만 만들려고 한 페이지에서 모든 장면을 이어 그립니다.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../../../.harness/volsky');
const [jobsFile, outDir, W = '390', H = '584', ATMOS = ''] = process.argv.slice(2);
// 5번째 인자 'load' 면 takram 의 미리 만든 대기 표를 읽습니다(.harness/volsky/assets 에 three-atmosphere/assets/*.bin 복사).
if (ATMOS === 'load') {
  fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
  const src = path.join(__dirname, '../../../node_modules/@takram/three-atmosphere/assets');
  for (const f of fs.readdirSync(src)) if (f.endsWith('.bin')) fs.copyFileSync(path.join(src, f), path.join(ROOT, 'assets', f));
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="app.js"></script></body></html>');
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.bin') ? 'application/octet-stream' : 'text/html' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
(async () => {
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: +W, height: +H } });
  p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); });
  await p.goto(`http://localhost:${port}/index.html?w=${W}&h=${H}${ATMOS === 'load' ? '&atmos=load' : ''}`, { waitUntil: 'commit', timeout: 120000 });
  await p.waitForFunction(() => /^READY::/.test(document.title), null, { timeout: 900000, polling: 1000 });
  const errs = await p.evaluate(() => window.__errors);
  if (errs.length) { console.log('errors', errs); process.exit(1); }
  console.log('atmosphere ms', Math.round(await p.evaluate(() => window.__atmosMs)));
  const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  const results = {};
  for (const job of jobs) {
    const r = await p.evaluate(j => window.__job(j), job);
    for (const k of ['rgb', 'alpha']) if (r[k]) { fs.writeFileSync(path.join(outDir, job.name + (k === 'alpha' ? '.alpha' : '') + '.png'), Buffer.from(r[k].split(',')[1], 'base64')); delete r[k]; }
    results[job.name] = r;
    console.log(job.name, JSON.stringify(r).slice(0, 400));
  }
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 1));
  await b.close(); server.close();
})();
