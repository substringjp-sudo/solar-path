/**
 * 볼륨 하늘 하네스 — **데스크탑(진짜 GPU)용 실행기**. `run.js` 는 이 저장소의 가상 PC 경로(/opt/...)와 소프트웨어 GPU(SwiftShader)가 박혀 있어
 * 다른 컴퓨터에서는 안 돕니다. 이 파일은 같은 하네스(`entry.ts`)를 같은 방식으로 묶고 돌리되:
 *   - 묶기를 스스로 합니다(`esbuild` — npx 가 받아 옴).
 *   - 크롬은 설치된 Google Chrome(`channel: 'chrome'`)을 진짜 GPU 로 띄웁니다(`GPU=swiftshader` 면 소프트웨어 GPU 로 — 비교용).
 *   - 시작할 때 GPU 이름과 `MAX_TEXTURE_IMAGE_UNITS`(조각 셰이더 텍스처 한도)를 찍고, 장면마다 구름 프로그램이 실제로 쓴 샘플러 수를 찍습니다.
 *     (기기에서 M 품질이 깨지는 것의 후보 — 한도 16 에서 샘플러 19~20 개.)
 *
 * 준비(한 번):   npm install            (저장소 의존성)
 *                npm install --no-save playwright     (브라우저는 안 받아도 됨 — 설치된 Chrome 을 씁니다)
 * 돌리기:        node tools/genus-ruler/volsky/run-desktop.js <jobs.json> <outDir> [너비=390] [높이=584]
 *   예)          node tools/genus-ruler/volsky/run-desktop.js tools/genus-ruler/volsky/jobs-device-1611.json out-desktop
 * 환경변수:      GPU=swiftshader(소프트웨어 GPU)  HEADFUL=1(창을 띄움)  BROWSER=chromium(playwright 가 받은 크롬)  NO_BUILD=1(묶기 건너뜀)
 */
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  console.error('playwright 가 없습니다. 저장소 루트에서:  npm install --no-save playwright');
  process.exit(1);
}
const REPO = path.resolve(__dirname, '..', '..', '..');
const ROOT = path.join(REPO, '.harness', 'volsky-desktop');
const [jobsFile, outDir, W = '390', H = '584', ...EXTRA] = process.argv.slice(2);
if (!jobsFile || !outDir) { console.error('사용: node tools/genus-ruler/volsky/run-desktop.js <jobs.json> <outDir> [너비] [높이]'); process.exit(1); }

fs.mkdirSync(ROOT, { recursive: true });
if (!process.env.NO_BUILD) {
  const stub = './tools/genus-ruler/volsky/stubs';
  const args = ['--yes', 'esbuild@0.28.2', 'tools/genus-ruler/volsky/entry.ts', '--bundle', '--format=esm', `--outfile=${path.join('.harness', 'volsky-desktop', 'app.js')}`,
    '--define:__DEV__=false', `--define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY='"1"'`,
    `--alias:react-native=${stub}/react-native.js`, `--alias:expo-file-system=${stub}/expo-file-system`, '--loader:.png=empty', '--log-level=warning'];
  console.log('묶는 중…');
  execFileSync('npx', args, { cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32' });
}
const nl = path.join(REPO, 'assets', 'nightlights');
if (fs.existsSync(nl)) { fs.mkdirSync(path.join(ROOT, 'assets', 'nightlights'), { recursive: true }); for (const f of fs.readdirSync(nl)) fs.copyFileSync(path.join(nl, f), path.join(ROOT, 'assets', 'nightlights', f)); }
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="app.js"></script></body></html>');
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.bin') ? 'application/octet-stream' : 'text/html' });
  fs.createReadStream(f).pipe(res);
}).listen(0);

(async () => {
  const port = server.address().port;
  const soft = process.env.GPU === 'swiftshader';
  const launchArgs = soft
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl'];
  const opts = { headless: !process.env.HEADFUL, args: launchArgs };
  if (process.env.BROWSER !== 'chromium') opts.channel = 'chrome';
  const b = await chromium.launch(opts);
  const p = await b.newPage({ viewport: { width: +W, height: +H } });
  p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); });
  // 링크된 프로그램의 샘플러 수 — 구름 셰이더가 쓰는 텍스처 수(진단).
  await p.addInitScript(() => {
    window.__progs = [];
    const P = WebGL2RenderingContext.prototype, lp = P.linkProgram;
    P.linkProgram = function (prog) {
      lp.call(this, prog);
      try {
        const n = this.getProgramParameter(prog, this.ACTIVE_UNIFORMS); let c = 0;
        for (let i = 0; i < n; i++) { const u = this.getActiveUniform(prog, i); if ([this.SAMPLER_2D, this.SAMPLER_3D, this.SAMPLER_2D_ARRAY, this.SAMPLER_CUBE, this.SAMPLER_2D_SHADOW].includes(u.type)) c += u.size; }
        window.__progs.push({ samplers: c, linked: !!this.getProgramParameter(prog, this.LINK_STATUS) });
      } catch (e) {}
    };
  });
  const gl = await p.evaluate(() => {
    const c = document.createElement('canvas'), g = c.getContext('webgl2');
    if (!g) return null;
    const e = g.getExtension('WEBGL_debug_renderer_info');
    return { renderer: e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER), maxTextureImageUnits: g.getParameter(g.MAX_TEXTURE_IMAGE_UNITS), maxCombined: g.getParameter(g.MAX_COMBINED_TEXTURE_IMAGE_UNITS) };
  });
  console.log('GPU', JSON.stringify(gl));
  await p.goto(`http://localhost:${port}/index.html?w=${W}&h=${H}${EXTRA.map(e => '&' + e).join('')}`, { waitUntil: 'commit', timeout: 120000 });
  await p.waitForFunction(() => /^READY::/.test(document.title), null, { timeout: 1800000, polling: 1000 });
  const errs = await p.evaluate(() => window.__errors);
  if (errs.length) { console.log('errors', errs); process.exit(1); }
  console.log('atmosphere ms', Math.round(await p.evaluate(() => window.__atmosMs)), 'spectral', await p.evaluate(() => window.__spectral));
  const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  const results = {};
  for (const job of jobs) {
    const t0 = Date.now();
    const r = await p.evaluate(j => window.__job(j), job);
    for (const k of ['rgb', 'alpha']) if (r[k]) { fs.writeFileSync(path.join(outDir, job.name + (k === 'alpha' ? '.alpha' : '') + '.png'), Buffer.from(r[k].split(',')[1], 'base64')); delete r[k]; }
    const progs = await p.evaluate(() => { const a = window.__progs; window.__progs = []; return a; });
    const big = progs.filter(x => x.samplers >= 14);
    r.__samplers = big; results[job.name] = r;
    console.log(job.name, `${((Date.now() - t0) / 1000).toFixed(1)}s`, '큰 프로그램 샘플러', JSON.stringify(big));
  }
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 1));
  console.log('끝 —', path.resolve(outDir));
  await b.close(); server.close();
})();
