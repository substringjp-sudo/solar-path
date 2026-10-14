/**
 * 장면 입력 해시(§136) — 그리지 않고 setScene 만 걸어, 구름·그림자 패스에 **GPU 로 넘어가는 입력 전부**의 해시를 냅니다:
 * 모든 균일변수 값(숫자·벡터·행렬·배열), 날씨 텍스처 바이트, 셰이더 글자, 층 매개변수. 두 번들(코드 전·후)이 같은 장면에서 해시가 같으면
 * 렌더 결과의 차이는 코드가 아니라 렌더 환경(비결정성)이 만든 것입니다. 하네스 화소 비교는 같은 옛 코드끼리도 일부 장면에서 달랐습니다(§136).
 *
 *   node tools/genus-ruler/volsky/state-hash.js --root <번들 폴더(app.js)> jobs.json out.json [w h]
 *   (번들은 run.js 머리말처럼 묶음. 옛 번들을 쓰려면 폴더에 app.js 로 복사)
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const argv = process.argv.slice(2);
const ri = argv.indexOf('--root');
const ROOT = ri >= 0 ? path.resolve(argv[ri + 1]) : path.join(__dirname, '../../../.harness/volsky');
if (ri >= 0) argv.splice(ri, 2);
const [jobsFile, outFile, W = '390', H = '584'] = argv;
fs.writeFileSync(path.join(ROOT, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="app.js"></script></body></html>');
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const HASH_FN = `(() => {
  const fnv = (s, h = 2166136261) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
  const flat = (v) => {
    if (v == null) return 'null';
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return String(v);
    if (Array.isArray(v)) return '[' + v.map(flat).join(',') + ']';
    if (typeof v.toArray === 'function') return 'T' + JSON.stringify(v.toArray());
    if (v.elements) return 'M' + JSON.stringify(Array.from(v.elements));
    if (v.isTexture) {
      const d = v.image && v.image.data;
      if (d && d.length) { let h = 2166136261; for (let i = 0; i < d.length; i += 1) { h ^= d[i] & 0xff; h = Math.imul(h, 16777619) >>> 0; } return 'tex' + d.length + ':' + h + ':' + (v.image.width || 0) + 'x' + (v.image.height || 0) + 'x' + (v.image.depth || 0); }
      return 'tex-gpu';
    }
    return 'obj:' + Object.keys(v).length;
  };
  return () => {
    const c = window.__vol.debug.clouds;
    const out = {};
    for (const [tag, m] of [['clouds', c.cloudsPass.currentMaterial], ['shadow', c.shadowPass.currentMaterial]]) {
      out[tag + '.shader'] = fnv(m.fragmentShader) + ':' + m.fragmentShader.length;
      const names = Object.keys(m.uniforms).sort();
      let h = 2166136261;
      const per = {};
      for (const k of names) { const s = k + '=' + flat(m.uniforms[k].value); per[k] = fnv(s); h = fnv(s, h); }
      out[tag + '.uniforms'] = h + ':' + names.length;
      out[tag + '.perUniform'] = per;
    }
    out.layers = fnv(JSON.stringify(c.cloudLayers.map(l => [l.channel, l.altitude, l.height, l.densityScale, l.shapeAmount, l.shapeDetailAmount, l.weatherExponent, l.shapeAlteringBias, l.coverageFilterWidth, l.shadow, l.densityProfile && [l.densityProfile.expTerm, l.densityProfile.exponent, l.densityProfile.linearTerm, l.densityProfile.constantTerm]])));
    out.weather = flat(c.localWeatherTexture);
    return out;
  };
})()`;
(async () => {
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: +W, height: +H } });
  p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });
  await p.goto(`http://localhost:${port}/index.html?w=${W}&h=${H}`, { waitUntil: 'commit', timeout: 120000 });
  await p.waitForFunction(() => /^READY::/.test(document.title), null, { timeout: 900000, polling: 1000 });
  const errs = await p.evaluate(() => window.__errors);
  if (errs.length) { console.log('errors', errs); process.exit(1); }
  await p.evaluate(`window.__hashState = ${HASH_FN}`);
  const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  const res = {};
  for (const job of jobs) {
    // 그리지 않음: frames 0 + direct(캔버스 그대로) — setScene 이 균일변수·층·날씨를 겁니다.
    const j = { ...job, frames: 0, out: 'direct' };
    res[job.name] = await p.evaluate(async jj => { await window.__job(jj); return window.__hashState(); }, j);
    console.log(job.name, res[job.name]['clouds.shader'], res[job.name]['clouds.uniforms'], res[job.name].weather.slice(0, 40));
  }
  fs.writeFileSync(outFile, JSON.stringify(res, null, 1));
  await b.close(); server.close();
})();
