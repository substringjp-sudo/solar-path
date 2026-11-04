/**
 * g1-keys.cjs — G1(c) 날씨 키(자 L748 "(c) 날씨 키 문자열", S3-design.md §8 (c)): 앱 코드(volumetricScene.ts weatherPlan)가
 * 잡마다 만드는 날씨 텍스처 키 문자열을 그대로 잡아 적습니다. 앱 코드는 바꾸지 않습니다.
 *
 *   node tools/genus-ruler/oro/g1/g1-keys.cjs <jobs.json> <outDir> <outJson> [w=390 h=584]
 *
 * 어떻게: volsky run.js 와 같은 묶음(.harness/volsky/app.js, build.sh 가 만든 것)·같은 index.html·같은 chromium 경로와 깃발
 *   (run.js 소스에서 읽음 — 둘이 갈라지지 않게)로 페이지를 띄우고, 잡을 돌리기 전에 Map.prototype.set 을 감쌉니다.
 *   날씨 캐시(weatherCache: Map<string, DataTexture>)에 넣는 키 — cachePut 과 cacheGet 의 재삽입 모두 — 가운데
 *   '[' 로 시작하는 문자열이고 값이 DataTexture 인 것만 적습니다. 잡 하나에서 서로 다른 키가 정확히 1 개여야 합니다(아니면 exit 1).
 *   감싼 함수는 원래 set 을 그대로 부르므로 그림은 같아야 하고, 잡마다 rgb·alpha 의 md5 를 함께 적어 run.js 결과와 견줍니다.
 * 보고용으로 잡마다 페이지 타이머(setTimeout·setInterval) 만든 수도 적습니다(pageTimers — 앱 장면 객체 안의 타이머까지 보임).
 * 출력 JSON: {chromiumPath, chromiumFlags, jobs: {<name>: {weatherKey, nKeySets, pageTimers, rgb, alpha}}}. 표준 출력은 이름·수·md5 만.
 */
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '../../../..');
const RUN_JS = path.join(ROOT, 'tools/genus-ruler/volsky/run.js');
const SERVE = path.join(ROOT, '.harness/volsky');
const [jobsFile, outDir, outJson, W = '390', H = '584'] = process.argv.slice(2);
if (!jobsFile || !outDir || !outJson) { console.error('usage: g1-keys.cjs <jobs.json> <outDir> <outJson> [w h]'); process.exit(2); }

/** run.js 의 chromium 경로·깃발·playwright 경로(소스 그대로 읽기). */
function runJsLaunch() {
  const src = fs.readFileSync(RUN_JS, 'utf8');
  const pw = src.match(/require\('([^']*playwright)'\)/);
  const ex = src.match(/executablePath:\s*'([^']+)'/);
  const ar = src.match(/args:\s*(\[[^\]]*\])/);
  const idx = src.match(/'(<!doctype html>[^']*)'/);
  if (!pw || !ex || !ar || !idx) throw new Error('run.js: launch options not found');
  return { playwright: pw[1], executablePath: ex[1], args: JSON.parse(ar[1].replace(/'/g, '"')), indexHtml: idx[1] };
}
const md5 = b => crypto.createHash('md5').update(b).digest('hex');

(async () => {
  const L = runJsLaunch();
  const { chromium } = require(L.playwright);
  if (!fs.existsSync(path.join(SERVE, 'app.js'))) { console.error('no .harness/volsky/app.js — run volsky/build.sh first'); process.exit(2); }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(SERVE, 'index.html'), L.indexHtml);
  const server = http.createServer((req, res) => {
    const f = path.join(SERVE, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(SERVE + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.bin') ? 'application/octet-stream' : 'text/html' });
    fs.createReadStream(f).pipe(res);
  }).listen(0);
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: L.executablePath, args: L.args });
  const p = await b.newPage({ viewport: { width: +W, height: +H } });
  p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });
  await p.goto(`http://localhost:${port}/index.html?w=${W}&h=${H}`, { waitUntil: 'commit', timeout: 120000 });
  await p.waitForFunction(() => /^READY::/.test(document.title), null, { timeout: 900000, polling: 1000 });
  const errs = await p.evaluate(() => window.__errors);
  if (errs.length) { console.log('errors', errs.length); process.exit(1); }
  await p.evaluate(() => {
    const orig = Map.prototype.set;
    window.__g1keys = [];
    Map.prototype.set = function (k, v) {
      if (typeof k === 'string' && k.charCodeAt(0) === 91 && v && v.isDataTexture === true) window.__g1keys.push(k);
      return orig.call(this, k, v);
    };
    // 보고용: 잡 하나(setOptions → setScene → 프레임들)가 만드는 페이지 타이머 수 — 앱 장면 객체 안의 타이머까지 보임(G1(d) 보조)
    window.__g1timers = { setTimeout: 0, setInterval: 0 };
    for (const k of ['setTimeout', 'setInterval']) {
      const o = window[k];
      window[k] = function (...a) { window.__g1timers[k]++; return o.apply(this, a); };
    }
  });
  const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  const out = { chromiumPath: L.executablePath, chromiumFlags: L.args, jobs: {} };
  let bad = 0;
  for (const job of jobs) {
    await p.evaluate(() => { window.__g1keys = []; window.__g1timers.setTimeout = 0; window.__g1timers.setInterval = 0; });
    const r = await p.evaluate(j => window.__job(j), job);
    const keys = await p.evaluate(() => window.__g1keys.slice());
    const timers = await p.evaluate(() => ({ ...window.__g1timers }));
    const distinct = [...new Set(keys)];
    const rec = { nKeySets: keys.length, weatherKey: distinct.length === 1 ? distinct[0] : null, pageTimers: timers };
    if (distinct.length !== 1) bad++;
    for (const k of ['rgb', 'alpha']) if (r[k]) {
      const buf = Buffer.from(r[k].split(',')[1], 'base64');
      fs.writeFileSync(path.join(outDir, job.name + (k === 'alpha' ? '.alpha' : '') + '.png'), buf);
      rec[k] = md5(buf);
    }
    out.jobs[job.name] = rec;
    console.log(`KEY ${job.name} sets ${keys.length} distinct ${distinct.length} rgb ${rec.rgb ?? '-'} alpha ${rec.alpha ?? '-'}`);
  }
  fs.mkdirSync(path.dirname(path.resolve(outJson)), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(out, null, 1) + '\n');
  await b.close(); server.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('g1-keys:', (e && e.message) || e); process.exit(3); });
