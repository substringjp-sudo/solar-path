/**
 * 앱 하늘 화면(web-repro, EXPO_PUBLIC_VOLUMETRIC_SKY=1 로 묶은 것)을 장면 하나씩 찍습니다(§127).
 *   node tools/genus-ruler/volsky/repro-shot.js <repro 폴더> '<# 뒤 JSON>' out.png [기다림 초=120]
 * 볼륨 하늘은 대기 표(SwiftShader 60~70초)가 끝나야 켜지므로 정해진 시간을 기다린 뒤 화면을 찍습니다.
 * DEM 타일은 프록시 인증서를 거치므로 인증서 오류를 무시하고, CORS 머리를 붙입니다(하네스 전용).
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [dir, hash, out, waitS = '120'] = process.argv.slice(2);
const types = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = path.join(dir, decodeURIComponent(req.url.split('?')[0].split('#')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
(async () => {
  const Q = JSON.parse(hash);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--ignore-certificate-errors'] });
  const p = await b.newPage({ viewport: { width: Q.w ?? 400, height: Q.h ?? 300 } });
  // DEM 타일(S3)은 CORS 머리가 없어 웹에서는 텍스처로 못 올립니다(앱은 네이티브라 상관없음) — 하네스에서만 붙입니다.
  await p.route('**/elevation-tiles-prod/**', async route => {
    const r = await route.fetch();
    await route.fulfill({ response: r, headers: { ...r.headers(), 'access-control-allow-origin': '*' } });
  });
  const logs = [];
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text().slice(0, 200)); });
  p.on('pageerror', e => logs.push('PAGEERROR ' + (e.stack || e.message).slice(0, 400)));
  await p.goto(`http://localhost:${server.address().port}/repro.html#${encodeURIComponent(hash)}`);
  await p.waitForTimeout(+waitS * 1000);
  // 앱 캔버스는 그리기 버퍼를 보존하지 않아 toDataURL 이 검게 나옵니다 — 화면을 찍습니다.
  await p.screenshot({ path: out, timeout: 240000 });
  console.log(JSON.stringify({ out, logs: logs.filter(l => !/favicon|DevTools/.test(l)).slice(0, 8) }));
  await b.close(); server.close();
})();
