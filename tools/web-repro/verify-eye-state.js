/**
 * **눈 이동의 장면 연결을 웹 하네스로 확인합니다**(연속 이동 조이스틱 2단계, docs/SANDBOX_MODE_PLAN.md 12.2). 그림 비교가 아니라 유니폼 값으로 확인합니다
 * (SwiftShader 에서 한 장 그리는 데 1~2 분이 걸려 그림 비교는 느립니다). `SkyScene3DHandle.getEyeState` 가 지형 · 바다 셰이더의 눈 좌표(`uDemObs` …)를 돌려줍니다.
 *
 * 확인하는 것:
 *  1. 눈을 동쪽으로 50 · 100 · 300 · 1000 m 옮기면 지형의 눈 좌표가 d/타일지상거리 만큼 정확히 따라온다(바다도 같고, 성긴 패치는 16 배 덜).
 *  2. 가운데 타일 안에서는 새 타일을 요청하지 않는다(눈이 움직여도 높이장을 다시 받지 않는다).
 *  3. 가운데 타일을 벗어나면(3 km) 새 블록을 받고, 새 블록에서도 눈의 **절대 타일 좌표**(원점 + 눈 좌표)가 그대로다(끊김 없음).
 *  4. 위치를 눈 자리로 커밋하면(`__set`) 눈은 다시 위치를 따르고, 커밋 전후 눈의 절대 타일 좌표가 같다(튀지 않는다).
 *
 * 사용: sh tools/web-repro/build.sh && node tools/web-repro/verify-eye-state.js .harness/web-repro
 * 필요: Playwright, 그리고 s3.amazonaws.com 의 지형 타일(curl 로 받아 임시 폴더에 둠 — 브라우저는 CORS 로 못 받음).
 */
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const dir = process.argv[2];
const LAT = 37.5665, LON = 126.978, M = 111320, COS = Math.cos(LAT * Math.PI / 180);
const types = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => { const f = path.join(dir, decodeURIComponent(req.url.split('?')[0].split('#')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }).listen(0);
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, t) => Math.abs(a - b) <= t;
(async () => {
  const hash = JSON.stringify({ t: '2026-11-19T07:00:00Z', lat: LAT, lon: LON, elevM: 40, sunAlt: 0.35, sunAz: 2.6, view: { az: 90, el: 4, fov: 70 }, vol: 0, eyeH: 1.6, w: 160, h: 100, bld: 1 });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 160, height: 100 }, deviceScaleFactor: 1 });
  const CACHE = path.join(os.tmpdir(), 'solar-path-demcache'); fs.mkdirSync(CACHE, { recursive: true });
  const reqs = [];
  await ctx.route(/elevation-tiles-prod/, async (route) => {
    const url = route.request().url(); reqs.push(url);
    const m = url.match(/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/);
    const f = path.join(CACHE, m ? `${m[1]}_${m[2]}_${m[3]}.png` : 'x.png');
    try { if (!fs.existsSync(f)) execFileSync('curl', ['-sS', '--fail', '--max-time', '25', '-o', f, url]); await route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'access-control-allow-origin': '*', 'content-type': 'image/png' } }); }
    catch (e) { await route.fulfill({ status: 404, body: '' }); }
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 200)));
  await p.goto(`http://localhost:${server.address().port}/repro.html#${encodeURIComponent(hash)}`);
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) { await p.waitForTimeout(1000); ready = await p.evaluate(() => !!globalThis.__skyHandle?.getHorizonProfile?.()); }
  ok(ready, 'DEM 블록이 왔다');
  const st = () => p.evaluate(() => globalThis.__skyHandle.getEyeState());
  const east = (d, n = 0) => ({ lat: LAT + n / M, lon: LON + d / (M * COS) });
  const base = await st();
  const B = base.block, span = B.tileSpanM;
  ok(!!base.obs.terrain && !!base.obs.sea && base.eye === null && base.moving === false, `처음: 눈은 위치를 따르고(eye null) 건물은 숨기지 않는다. 지형 눈 좌표 (${base.obs.terrain?.map(v => v.toFixed(4))})`);
  await p.waitForTimeout(2000);
  const r0 = reqs.length;
  // 1 같은 블록 안에서 동쪽으로
  let worst = 0, worstSea = 0, farRatioOk = true;
  for (const d of [50, 100, 300, 1000]) {
    const q = east(d);
    await p.evaluate(({ lat, lon }) => globalThis.__skyHandle.setEyeLocation(lat, lon), q);
    const s = await st();
    const du = s.obs.terrain[0] - base.obs.terrain[0], dv = s.obs.terrain[1] - base.obs.terrain[1];
    worst = Math.max(worst, Math.abs(du - d / span) + Math.abs(dv));
    worstSea = Math.max(worstSea, Math.abs(s.obs.sea[0] - s.obs.terrain[0]) + Math.abs(s.obs.sea[1] - s.obs.terrain[1]));
    // 성긴(줌 9) 패치는 타일 한 장이 훨씬 넓어 같은 d m 에 좌표가 덜 변한다(2^4 배 덜)
    const duFar = s.obs.terrainFar[0] - base.obs.terrainFar[0];
    if (!(duFar > 0 && Math.abs(duFar * 16 - du) < 0.02 * du + 1e-6)) farRatioOk = false;
    ok(s.moving === true && s.eye && near(s.eye.longitude, q.lon, 1e-9), `동쪽 ${d} m: 눈이 떨어져 있다고 표시(건물 숨김)하고 눈 자리가 맞다`);
  }
  ok(worst < 1e-3, `지형의 눈 좌표가 동쪽 d m 에 d/${span.toFixed(0)} 타일만큼 정확히 따라온다(최대 어긋남 ${worst.toExponential(1)} 타일)`);
  ok(worstSea < 1e-9, '바다의 눈 좌표가 지형과 같다');
  ok(farRatioOk, '성긴 패치(줌 9)의 눈 좌표도 같은 거리를 따라온다(타일이 16 배 넓은 만큼 덜 변함)');
  await p.waitForTimeout(1500);
  ok(reqs.length === r0, `가운데 타일 안에서는 새 타일을 요청하지 않는다(요청 ${reqs.length - r0}개)`);
  // 2 가운데 타일을 넘어 동쪽으로 3 km
  const farEye = east(3000);
  await p.evaluate(({ lat, lon }) => globalThis.__skyHandle.setEyeLocation(lat, lon), farEye);
  let swapped = false, s2 = null;
  for (let i = 0; i < 90 && !swapped; i++) { await p.waitForTimeout(1000); s2 = await st(); swapped = s2.block.originTileX !== B.originTileX; }
  ok(swapped, `3 km 가면 새 블록을 받는다(원점 타일 ${B.originTileX} → ${s2?.block.originTileX}, 새로 요청한 타일 ${reqs.length - r0}개)`);
  if (swapped) {
    // 끊김 없음: 절대 타일 좌표(원점 + u)가 눈 자리 그대로
    const absNew = s2.block.originTileX + s2.obs.terrain[0];
    const n = 2 ** s2.block.zoom, expectX = ((farEye.lon + 180) / 360) * n;
    ok(near(absNew, expectX, 1e-6), `새 블록에서도 눈의 절대 타일 좌표가 그대로다(${absNew.toFixed(5)} = ${expectX.toFixed(5)})`);
    ok(s2.obs.terrain[0] >= 1 && s2.obs.terrain[0] < 2, `새 블록에서 눈은 가운데 타일 안이다(u = ${s2.obs.terrain[0].toFixed(3)})`);
  }
  // 3 커밋: 위치를 눈 자리로 바꾸면(좌표가 바뀜) 눈은 위치를 따르고 값은 그대로
  const before = await st();
  await p.evaluate(({ lat, lon }) => globalThis.__set({ lat, lon }), farEye);
  await p.waitForTimeout(3000);
  const after = await st();
  ok(after.eye === null && after.moving === false, '위치를 눈 자리로 커밋하면 눈은 다시 위치를 따르고 건물 숨김이 풀린다');
  ok(near(after.obs.terrain[0] + after.block.originTileX, before.obs.terrain[0] + before.block.originTileX, 1e-5) && near(after.obs.terrain[1] + after.block.originTileY, before.obs.terrain[1] + before.block.originTileY, 1e-5),
     `커밋 전후의 눈의 절대 타일 좌표가 같다(튀지 않는다): 전 (${(before.obs.terrain[0] + before.block.originTileX).toFixed(5)}) 후 (${(after.obs.terrain[0] + after.block.originTileX).toFixed(5)})`);
  console.log(`\n${fail ? '실패 있음' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
