/**
 * RULER-grain 실행기 — run.js 와 같은 페이지(SwiftShader Chromium, 대기 표 한 번)에 잡을 이어 그리되:
 *  - 번들 폴더를 고름(--root, 기본 .harness/volsky-grain — .harness/volsky 는 다른 작업이 씀),
 *  - grain 잡의 파일을 window.__grainWrite 로 받아 <out>/<잡 이름>/ 에 쓰고, meta.json 은 마지막에(임시 파일 → 이름 바꾸기),
 *  - 이어 그리기: meta.json 이 있고 그 bundleSha256·jobSha256 가 지금 번들·잡과 같으면 건너뜀,
 *  - --max-min N: N 분이 지나면 새 잡을 시작하지 않고 끝냄(종료 코드 3 = 남은 잡 있음) — 백그라운드 2 시간 한도 안에서 덩어리로.
 *  - 잡이 throw 하면 <잡>/error.txt 를 쓰고 다음 잡으로(끝에 종료 코드 4).
 *  - 잡의 canvas 가 W×H 와 다르면 건너뜀(캔버스마다 따로 부름).
 *  - grain 필드가 없는 잡은 run.js 와 같이 <out>/<이름>.png · .alpha.png + results.jsonl 한 줄(G0c·바이트 동일 점검용).
 *
 *   node tools/genus-ruler/grain/run-grain.js [--root DIR] [--max-min N] [--atmos load|gen] jobs.json outDir W H
 * 묶기(동결 명령, RULER-grain §10):
 *   esbuild tools/genus-ruler/volsky/entry.ts --bundle --format=esm --outfile=.harness/volsky-grain/app.js \
 *     --define:__DEV__=false --define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY='"1"'
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const ROOT = path.resolve(opt('--root', path.join(__dirname, '../../../.harness/volsky-grain')));
const MAX_MIN = Number(opt('--max-min', '0'));
const ATMOS = opt('--atmos', 'gen');
const [jobsFile, outDir, W = '390', H = '584'] = argv;
if (!jobsFile || !outDir) { console.error('usage: run-grain.js [--root DIR] [--max-min N] [--atmos load|gen] jobs.json outDir W H'); process.exit(2); }
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const BUNDLE_SHA = sha(path.join(ROOT, 'app.js'));
if (ATMOS === 'load') {
  fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
  const src = path.join(__dirname, '../../../node_modules/@takram/three-atmosphere/assets');
  for (const f of fs.readdirSync(src)) if (f.endsWith('.bin')) fs.copyFileSync(path.join(src, f), path.join(ROOT, 'assets', f));
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="app.js"></script></body></html>');
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.bin') ? 'application/octet-stream' : 'text/html' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const jobSha = j => crypto.createHash('sha256').update(JSON.stringify(j)).digest('hex');
const safe = s => { if (!/^[A-Za-z0-9_.+-]+$/.test(s)) throw new Error('bad name: ' + s); return s; };
(async () => {
  const t0 = Date.now();
  const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  const done = j => {
    const m = path.join(outDir, safe(j.name), 'meta.json');
    if (!j.grain || !fs.existsSync(m)) return false;
    try { const mm = JSON.parse(fs.readFileSync(m, 'utf8')); return mm.bundleSha256 === BUNDLE_SHA && mm.jobSha256 === jobSha(j); } catch { return false; }
  };
  // 캔버스가 다른 잡(기기 전체 틀 1080×2340 등)은 이 호출에서 건너뜀 — eval-grain.sh 가 캔버스마다 따로 부름.
  const fits = j => !j.canvas || (j.canvas[0] === +W && j.canvas[1] === +H);
  const todo = jobs.filter(j => fits(j) && !done(j));
  console.log('bundle', BUNDLE_SHA.slice(0, 16), 'jobs', jobs.length, 'other canvas', jobs.filter(j => !fits(j)).length, 'todo', todo.length, 'canvas', W + 'x' + H, 'atmos', ATMOS);
  if (!todo.length) { server.close(); process.exit(0); }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: +W, height: +H } });
  p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); });
  await p.exposeFunction('__grainWrite', (job, file, b64, append) => {
    const d = path.join(outDir, safe(job)); fs.mkdirSync(d, { recursive: true });
    const f = path.join(d, safe(file)), buf = Buffer.from(b64, 'base64');
    if (append) fs.appendFileSync(f, buf); else fs.writeFileSync(f, buf);
  });
  await p.goto(`http://localhost:${server.address().port}/index.html?w=${W}&h=${H}${ATMOS === 'load' ? '&atmos=load' : ''}`, { waitUntil: 'commit', timeout: 120000 });
  await p.waitForFunction(() => /^READY::/.test(document.title), null, { timeout: 900000, polling: 1000 });
  const errs = await p.evaluate(() => window.__errors);
  if (errs.length) { console.log('errors', errs); process.exit(1); }
  const browserVersion = b.version();
  console.log('atmosphere ms', Math.round(await p.evaluate(() => window.__atmosMs)), 'spectral', await p.evaluate(() => window.__spectral), 'chromium', browserVersion);
  let left = 0, failed = 0;
  for (let k = 0; k < todo.length; k++) {
    const job = todo[k];
    if (MAX_MIN > 0 && (Date.now() - t0) / 60000 > MAX_MIN) { left = todo.length - k; break; }
    const ts = Date.now();
    let r;
    try { r = await p.evaluate(j => window.__job(j), job); }
    catch (e) {
      // 잡 하나가 throw 하면(앵커 없음·알 수 없는 옵션 등) 기록하고 다음 잡으로 — meta.json 이 없으니 grain.py 는 그 단위를 '없음'으로 셈.
      failed++; console.log(job.name, 'ERROR', String(e).slice(0, 400));
      if (job.grain) { const d = path.join(outDir, safe(job.name)); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'error.txt'), String(e)); }
      continue;
    }
    const wallOuter = Date.now() - ts;
    if (job.grain) {
      const d = path.join(outDir, safe(job.name)); fs.mkdirSync(d, { recursive: true });
      const meta = { ...r, bundleSha256: BUNDLE_SHA, jobSha256: jobSha(job), wallMsOuter: wallOuter,
        chromium: browserVersion, atmos: ATMOS, canvas: [+W, +H], pageJobIndex: k, finishedAt: new Date().toISOString(), job };
      fs.writeFileSync(path.join(d, 'meta.json.tmp'), JSON.stringify(meta, null, 1));
      fs.renameSync(path.join(d, 'meta.json.tmp'), path.join(d, 'meta.json'));
      console.log(job.name, job.grain.mode, 'wall', (wallOuter / 1000).toFixed(1) + 's', 'ok', r.captureOk, r.glErrors && r.glErrors.length ? 'glErr ' + r.glErrors : '', r.cost ? JSON.stringify(r.cost) : '');
    } else {
      for (const kk of ['rgb', 'alpha']) if (r[kk]) { fs.writeFileSync(path.join(outDir, safe(job.name) + (kk === 'alpha' ? '.alpha' : '') + '.png'), Buffer.from(r[kk].split(',')[1], 'base64')); delete r[kk]; }
      fs.appendFileSync(path.join(outDir, 'results.jsonl'), JSON.stringify({ name: job.name, bundleSha256: BUNDLE_SHA, wallMsOuter: wallOuter, ...r }) + '\n');
      console.log(job.name, 'wall', (wallOuter / 1000).toFixed(1) + 's', JSON.stringify(r).slice(0, 200));
    }
  }
  await b.close(); server.close();
  if (failed) console.log('failed jobs', failed);
  if (left) { console.log('time limit: jobs left', left); process.exit(3); }
  if (failed) process.exit(4);
})().catch(e => { console.error(e); process.exit(1); });
