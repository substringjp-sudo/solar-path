/**
 * §169 품질 단계가 구름 해상도 배율을 지키는지(브라우저). takram qualityPreset 은 resolutionScale 까지 1 로 덮어써,
 * 하늘 화면(품질 다음에 해상도를 다시 걸지 않음)이 설정 0.5 대신 1.0 으로 그렸습니다.
 *
 *   묶기:  npx esbuild tools/genus-ruler/volsky/entry.ts --bundle --format=esm --outfile=.harness/volsky/app.js \
 *            --define:__DEV__=false --define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY='"1"'
 *   돌리기: node tools/genus-ruler/volsky/quality-res-check.js
 * (대기 표는 takram 의 미리 만든 표를 읽습니다 — run.js 의 load 와 같음.)
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../../../.harness/volsky');
fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
const src = path.join(__dirname, '../../../node_modules/@takram/three-atmosphere/assets');
for (const f of fs.readdirSync(src)) if (f.endsWith('.bin')) fs.copyFileSync(path.join(src, f), path.join(ROOT, 'assets', f));
fs.writeFileSync(path.join(ROOT, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="app.js"></script></body></html>');
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.bin') ? 'application/octet-stream' : 'text/html' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 200, height: 300 } });
  await p.goto(`http://localhost:${server.address().port}/index.html?w=200&h=300&atmos=load`, { waitUntil: 'commit', timeout: 120000 });
  await p.waitForFunction(() => /^READY::/.test(document.title), null, { timeout: 900000, polling: 1000 });
  const r = await p.evaluate(() => {
    const v = window.__vol, out = {};
    // 하늘 화면 순서: 생성 → setResolutionScale(조절기 0.5) → 첫 프레임에 setQuality(설정 품질).
    v.setResolutionScale(0.5); v.setQuality('low'); out.low = v.resolutionScale();
    v.setQuality('medium'); out.medium = v.resolutionScale();
    v.setResolutionScale(0.35); v.setQuality('high'); out.high = v.resolutionScale();
    v.setQuality('low'); out.lowAgain = v.resolutionScale();
    // 품질 단계 몫은 여전히 걸려야 합니다(해상도만 지킴): low 의 1차 최소 보폭 50 m(§140), 중간 단계 100 m 가 아님을 확인.
    out.lowStep = v.debug.clouds.clouds.minStepSize;
    out.lowShapeDetail = v.debug.clouds.shapeDetail;
    v.setQuality('medium'); out.mediumShapeDetail = v.debug.clouds.shapeDetail;
    return out;
  });
  ok(r.low === 0.5, `0.5 → low 뒤에도 0.5 (${r.low})`);
  ok(r.medium === 0.5, `→ medium 뒤에도 0.5 (${r.medium})`);
  ok(r.high === 0.35, `0.35 → high 뒤에도 0.35 (${r.high})`);
  ok(r.lowAgain === 0.35, `→ low 로 되돌려도 0.35 (${r.lowAgain})`);
  ok(r.lowStep === 50 && r.lowShapeDetail === false && r.mediumShapeDetail === true,
    `품질 단계의 다른 값은 그대로 걸림: low 보폭 ${r.lowStep} m · 잔모양 ${r.lowShapeDetail} · medium 잔모양 ${r.mediumShapeDetail}`);
  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — pass ${pass} / fail ${fail}`);
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
