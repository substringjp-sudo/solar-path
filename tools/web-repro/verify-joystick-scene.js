/**
 * **조이스틱 패널 → 구동기 → 실제 장면의 눈 → 위치 확정이 끝까지 이어지는가**를 웹 하네스(`drive:1`)에서 손가락(마우스)으로 확인합니다(연속 이동 조이스틱 3단계, docs/SANDBOX_MODE_PLAN.md 12.2).
 * 그림 비교가 아니라 눈 상태 · 유니폼 값으로 확인합니다(SwiftShader 에서는 한 장 그리는 데 오래 걸려, 프레임이 느려도 맞게 **상태 기준으로** 기다립니다).
 * 패널과 가짜 호스트의 동작은 `verify-joystick-panel.js`, 구동기 계산은 `tools/shader-preview/verify-joystick-driver.js`, 장면의 눈 이동 자체는 `verify-eye-state.js` 가 잽니다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20, 구현보다 먼저 박았습니다)
 *
 *  1. 처음: DEM 블록이 오면 눈은 위치를 따르고(`eye` null) 눈이 떨어져 있다고 표시하지 않는다(`moving` 거짓).
 *  2. 비행 모드로 시선 동쪽(90°)을 향해 손잡이를 끝까지 밀고, 눈이 위치에서 40 m 넘게 떨어질 때까지 쥐고 있으면: 눈이 동쪽(방위 90° ± 1°)으로 가고(`getEyeState().eye`),
 *     장면이 눈이 떨어져 있다고 알고(`moving` 참), 지형의 눈 좌표(`uDemObs`)가 그 거리만큼 정확히 따라오며(d/타일 지상 거리, 1e-3 타일 안), 쥐고 있는 동안 위치 확정은 한 번도 없고,
 *     구동기가 장면의 눈을 여러 번(5 번 넘게) 옮겼다.
 *  3. 손잡이를 놓으면 위치 확정이 정확히 한 번 나오고, 장면의 위치가 그 자리로 바뀌며(눈은 다시 위치를 따라 `eye` null, `moving` 거짓), 확정 뒤 지형의 눈 좌표가 확정한 자리의 독립 계산값
 *     (슬리피 맵 식으로 센 절대 타일 좌표)과 1e-6 타일 안으로 같다(끊김 없음). 확정한 자리는 위치에서 동쪽으로 40 m 넘게 간 곳이고 위도는 거의 그대로(5 cm 안)다.
 *  4. 그 뒤 3 초 동안 확정이 더 안 나오고 눈은 위치를 따른다.
 *
 * 사용: sh tools/web-repro/build.sh && node tools/web-repro/verify-joystick-scene.js .harness/web-repro
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
const tileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
(async () => {
  const hash = JSON.stringify({ drive: 1, mode: 'fly', t: '2026-11-19T07:00:00Z', lat: LAT, lon: LON, elevM: 40, sunAlt: 0.35, sunAz: 2.6, view: { az: 90, el: 4, fov: 70 }, vol: 0, eyeH: 1.6, w: 160, h: 100 });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });
  const CACHE = path.join(os.tmpdir(), 'solar-path-demcache'); fs.mkdirSync(CACHE, { recursive: true });
  await ctx.route(/elevation-tiles-prod/, async (route) => {
    const url = route.request().url();
    const m = url.match(/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/);
    const f = path.join(CACHE, m ? `${m[1]}_${m[2]}_${m[3]}.png` : 'x.png');
    try { if (!fs.existsSync(f)) execFileSync('curl', ['-sS', '--fail', '--max-time', '25', '-o', f, url]); await route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'access-control-allow-origin': '*', 'content-type': 'image/png' } }); }
    catch (e) { await route.fulfill({ status: 404, body: '' }); }
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 200)));
  await p.goto(`http://localhost:${server.address().port}/repro.html#${encodeURIComponent(hash)}`);
  let ready = false;
  for (let i = 0; i < 150 && !ready; i++) { await p.waitForTimeout(1000); ready = await p.evaluate(() => !!globalThis.__skyHandle?.getHorizonProfile?.()); }
  ok(ready, 'DEM 블록이 왔다');
  const st = () => p.evaluate(() => globalThis.__skyHandle.getEyeState());
  const commits = () => p.evaluate(() => (globalThis.__commits || []).slice());
  const offs = (e) => ({ east: (e[1] - LON) * M * COS, north: (e[0] - LAT) * M });

  // ── 1 처음
  console.log('\n[1] 처음');
  const base = await st();
  ok(base.eye === null && base.moving === false && !!base.obs.terrain, `눈은 위치를 따르고(eye null) 떨어져 있다고 표시하지 않는다(moving ${base.moving}). 지형 눈 좌표 (${base.obs.terrain && base.obs.terrain.map(v => v.toFixed(4))})`);
  const span = base.block.tileSpanM;

  // ── 2 밀기
  console.log('\n[2] 비행으로 40 m 넘게 밀기');
  const stick = p.getByLabel('위치 이동 조이스틱').first();
  const bx = await stick.boundingBox(), cx = bx.x + bx.width / 2, cy = bx.y + bx.height / 2;
  await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx, cy - 29, { steps: 4 });
  let s = null, off = null;
  for (let i = 0; i < 240; i++) {
    await p.waitForTimeout(250);
    s = await st();
    if (s.eye) { off = offs([s.eye.latitude, s.eye.longitude]); if (Math.hypot(off.east, off.north) > 40) break; }
  }
  ok(!!s && !!s.eye && Math.hypot(off.east, off.north) > 40, `눈이 위치에서 ${off ? Math.hypot(off.east, off.north).toFixed(1) : '—'} m 떨어졌다(> 40)`);
  const brg = ((Math.atan2(off.east, off.north) * 180) / Math.PI + 360) % 360;
  ok(Math.abs(brg - 90) < 1, `동쪽으로 간다(방위 ${brg.toFixed(2)}°)`);
  ok(s.moving === true, '장면이 눈이 떨어져 있다고 안다(moving 참)');
  const du = s.obs.terrain[0] - base.obs.terrain[0], dv = s.obs.terrain[1] - base.obs.terrain[1];
  const d = Math.hypot(off.east, off.north);
  ok(near(du, off.east / span, 1e-3) && near(dv, -off.north / span, 1e-3), `지형의 눈 좌표가 눈을 따라온다(du ${du.toFixed(5)} = ${(off.east / span).toFixed(5)}, 거리 ${d.toFixed(1)} m)`);
  ok((await commits()).length === 0, '쥐고 있는 동안 위치 확정은 한 번도 없다');
  const log = await p.evaluate(() => globalThis.__driveLog || { eyes: 0 });
  ok(log.eyes > 5, `구동기가 장면의 눈을 ${log.eyes} 번 옮겼다(> 5)`);

  // ── 3 놓기
  console.log('\n[3] 놓기');
  await p.mouse.up();
  let c = [];
  for (let i = 0; i < 240 && c.length === 0; i++) { await p.waitForTimeout(250); c = await commits(); }
  ok(c.length === 1, `손잡이를 놓으면 위치 확정이 정확히 한 번(${c.length})`);
  let s2 = null;
  for (let i = 0; i < 60; i++) { await p.waitForTimeout(250); s2 = await st(); if (s2.eye === null) break; }
  ok(s2.eye === null && s2.moving === false, `확정 뒤 눈은 다시 위치를 따른다(eye ${JSON.stringify(s2.eye)}, moving ${s2.moving})`);
  const cm = c[0], co = offs(cm);
  ok(co.east > 40 && Math.abs(co.north) < 0.05, `확정한 자리는 동쪽으로 ${co.east.toFixed(1)} m(> 40), 위도 차 ${co.north.toExponential(1)} m`);
  const absNow = s2.block.originTileX + s2.obs.terrain[0], want = tileX(cm[1], s2.block.zoom);
  ok(near(absNow, want, 1e-6), `확정 뒤 지형의 눈 절대 타일 좌표 ${absNow.toFixed(6)} = 확정한 자리의 독립 계산값 ${want.toFixed(6)}(끊김 없음)`);

  // ── 4 그 뒤
  console.log('\n[4] 그 뒤');
  await p.waitForTimeout(3000);
  const c2 = await commits(), s3 = await st();
  ok(c2.length === 1 && s3.eye === null, `3 초 뒤에도 확정은 한 번뿐이고 눈은 위치를 따른다(확정 ${c2.length}, eye ${JSON.stringify(s3.eye)})`);

  await b.close();
  server.close();
  console.log(`\n${fail ? '실패 있음' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL: 예외 — ' + (e && e.stack || e)); process.exit(1); });
