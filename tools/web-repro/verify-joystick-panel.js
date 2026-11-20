/**
 * **조이스틱 패널을 웹 하네스에서 손가락(마우스)으로 눌러 확인합니다**(연속 이동 조이스틱 3단계, docs/SANDBOX_MODE_PLAN.md 12.2). 장면 대신 가짜 호스트를 물린 `sbx:1` 패널입니다
 * (장면 쪽 눈 이동은 `verify-eye-state.js` 가 잽니다). 가짜 호스트가 받은 호출은 `window.__drive` 에 남습니다: {eyes, lastEye, firstEye, commits, clears, origin}.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20, 구현보다 먼저 박았습니다)
 *
 *  1. 처음 화면: 모드 칩 걷기 · 자전거 · 차 · 비행, 안내 "끝까지 밀면 2 m/s"(걷기가 처음), "지금 속도 0.0 m/s", 이동 방향 단추는 "시선 기준"(처음이 시선 기준). 눈 · 확정 호출은 아직 없다.
 *  2. 모드 칩을 누르면 안내 글이 그 모드의 최고 속도로 바뀐다: 자전거 8 · 차 25 · 비행 120 · 걷기 2 m/s.
 *  3. 걷기에서 손잡이를 끝까지 앞으로 밀고 2.5 초 쥐고 있으면: 장면의 눈이 프레임마다(초당 30 번 넘게) 옮겨지고, 쥐고 있는 동안 위치 확정은 한 번도 없고,
 *     속도 숫자가 2.0 m/s 로 올라가며, 시선 방위(여기서는 30°)로 간다(눈의 이동 방위가 30° ± 1°). 간 거리가 해석해 V·(t − τ(1 − e^(−t/τ))) 의 ±12 % 안이다(t 는 눌러서 재는 사이의 실제 시간).
 *  4. 손잡이를 놓으면 속도 숫자가 0.0 m/s 로 가라앉고 **위치 확정이 정확히 한 번**, 확정한 자리가 마지막으로 눈을 둔 자리와 같으며(1e-9°), 확정 뒤 저장된 위치(origin)가 그 자리다. 그 뒤에는 확정이 더 안 나온다.
 *  5. 비행에서 끝까지 2.5 초 밀면 "내 위치 아님 · N m"가 나타나고(저장된 위치에서 150 m 넘게 떨어졌을 때, 눈의 자리 기준 실시간 거리, N 은 해석해의 ±15 %), 놓고 멈추면 확정된 자리까지의 거리와 같은 글이 남는다.
 *  6. 이동 방향 단추를 눌러 "북 기준"으로 바꾸면 손잡이 글이 "앞"에서 "N" 으로 바뀌고, 앞으로 밀면 시선과 무관하게 북쪽(방위 0° ± 1°)으로 간다.
 *  7. 건물 받기 막대: 장면이 알려 주는 진행이 받는 중 5/8 이면 "주변 불러오는 중"과 "건물 62 %"가 보이고, 움직이는 동안에는 숨고, 멈추면 다시 보인다. 진행이 idle 이 되면 사라지고, 못 받아 retry 면 "건물을 못 받았어요" · "다시 시도해요".
 *  8. 영어 · 일본어: "Full push = 2 m/s" · "いっぱいに倒すと 2 m/s", 칩 Walk · Bike · Car · Fly / 徒歩 · 自転車 · 車 · 飛行.
 *
 * 사용: sh tools/web-repro/build.sh && node tools/web-repro/verify-joystick-panel.js .harness/web-repro [그림 저장 폴더]
 * 필요: Playwright. 그림 폴더를 주면 상태별 화면을 저장합니다(그림은 눈으로 보는 용이고 통과 여부는 숫자로 가립니다).
 */
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const http = require('http'), fs = require('fs'), path = require('path');
const dir = process.argv[2];
const shots = process.argv[3];
if (shots) fs.mkdirSync(shots, { recursive: true });
const LAT = 37.5665, LON = 126.978, M = 111320, COS = Math.cos(LAT * Math.PI / 180), TAU = 0.3;
const types = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => { const f = path.join(dir, decodeURIComponent(req.url.split('?')[0].split('#')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }).listen(0);
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const ramp = (V, t) => V * (t - TAU * (1 - Math.exp(-t / TAU)));
const offs = (a) => ({ east: (a[1] - LON) * M * COS, north: (a[0] - LAT) * M });
const bearing = (o) => ((Math.atan2(o.east, o.north) * 180) / Math.PI + 360) % 360;

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const open = async (flags, vp = { width: 360, height: 640 }) => {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 200)));
    const hash = JSON.stringify({ sbx: 1, w: vp.width, h: vp.height, lat: LAT, lon: LON, az: 30, el: 5, home: { latitude: LAT, longitude: LON }, ...flags });
    await p.goto(`http://localhost:${server.address().port}/repro.html#${encodeURIComponent(hash)}`);
    await p.getByLabel('위치 이동 조이스틱').or(p.getByLabel('Move joystick')).or(p.getByLabel('位置移動ジョイスティック')).first().waitFor({ timeout: 60000 });
    return { ctx, p };
  };
  const stickBox = async (p) => (await p.getByLabel(/위치 이동 조이스틱|Move joystick|位置移動ジョイスティック/).first().boundingBox());
  const drv = (p) => p.evaluate(() => JSON.parse(JSON.stringify(globalThis.__drive)));
  const speedLabel = async (p) => (await p.getByLabel(/^(지금 속도|Current speed|現在の速度) /).first().getAttribute('aria-label'));
  const shot = async (p, name) => { if (shots) await p.screenshot({ path: path.join(shots, name + '.png') }); };
  const push = async (p, dx, dy) => {
    const bx = await stickBox(p), cx = bx.x + bx.width / 2, cy = bx.y + bx.height / 2;
    await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx + dx, cy + dy, { steps: 4 });
    return Date.now();
  };

  // ── 1 처음 화면
  console.log('\n[1] 처음 화면');
  {
    const { ctx, p } = await open({});
    const body = await p.locator('body').innerText();
    ok(['걷기', '자전거', '차', '비행'].every(w => body.includes(w)), '모드 칩 걷기 · 자전거 · 차 · 비행');
    ok(body.includes('끝까지 밀면 2 m/s'), '안내 "끝까지 밀면 2 m/s"(걷기가 처음)');
    ok((await speedLabel(p)) === '지금 속도 0.0 m/s', `"${await speedLabel(p)}"`);
    ok(body.includes('시선 기준') && !body.includes('북 기준'), '이동 방향 단추는 "시선 기준"(처음이 시선 기준)');
    const d = await drv(p);
    ok(d.eyes === 0 && d.commits.length === 0 && d.clears === 0, '눈 · 확정 호출은 아직 없다');
    await shot(p, '1-idle');
    // ── 2 모드 칩
    console.log('\n[2] 모드 칩');
    for (const [name, v] of [['자전거', 8], ['차', 25], ['비행', 120], ['걷기', 2]]) {
      await p.getByRole('button', { name: new RegExp('^' + name + ',') }).click();
      ok((await p.locator('body').innerText()).includes(`끝까지 밀면 ${v} m/s`), `${name} → 끝까지 밀면 ${v} m/s`);
    }
    await ctx.close();
  }

  // ── 3·4 걷기: 밀기와 놓기
  console.log('\n[3] 걷기로 2.5 초 밀기');
  {
    const { ctx, p } = await open({});
    const t0 = await push(p, 0, -29);
    await p.waitForTimeout(1200);
    const mid = await drv(p);
    ok(mid.commits.length === 0 && mid.eyes > 10, `쥐고 있는 동안 눈이 옮겨지고(${mid.eyes}번) 확정은 없다`);
    await p.waitForTimeout(1300);
    const held = await drv(p), t1 = Date.now();
    const T = (t1 - t0) / 1000;
    const rate = held.eyes / T;
    ok(rate > 30, `눈을 초당 ${rate.toFixed(0)} 번 옮긴다(> 30)`);
    ok(held.commits.length === 0, '쥐고 있는 동안 위치 확정은 한 번도 없다');
    ok((await speedLabel(p)) === '지금 속도 2.0 m/s', `속도 숫자 "${await speedLabel(p)}"`);
    const o = offs(held.lastEye);
    ok(Math.abs(bearing(o) - 30) < 1, `시선 방위 30° 로 간다(이동 방위 ${bearing(o).toFixed(2)}°)`);
    const d = Math.hypot(o.east, o.north), want = ramp(2, T);
    ok(Math.abs(d - want) / want < 0.12, `간 거리 ${d.toFixed(2)} m ≈ 해석해 ${want.toFixed(2)} m(t = ${T.toFixed(2)} 초, ±12 %)`);
    await shot(p, '3-walk-held');
    await p.mouse.up();
    await p.waitForTimeout(2500);
    const done = await drv(p);
    ok(done.commits.length === 1, `손을 놓으면 위치 확정이 정확히 한 번(${done.commits.length})`);
    ok(Math.abs(done.commits[0][0] - done.lastEye[0]) < 1e-9 && Math.abs(done.commits[0][1] - done.lastEye[1]) < 1e-9, '확정한 자리 = 마지막으로 눈을 둔 자리');
    ok(Math.abs(done.origin[0] - done.commits[0][0]) < 1e-12 && Math.abs(done.origin[1] - done.commits[0][1]) < 1e-12, '확정 뒤 저장된 위치가 그 자리다');
    ok((await speedLabel(p)) === '지금 속도 0.0 m/s', `놓으면 속도 숫자가 0.0 으로 가라앉는다("${await speedLabel(p)}")`);
    await p.waitForTimeout(800);
    ok((await drv(p)).commits.length === 1, '그 뒤에는 확정이 더 안 나온다');
    await ctx.close();
  }

  // ── 5 비행: 내 위치 아님
  console.log('\n[5] 비행으로 2.5 초 밀기');
  {
    const { ctx, p } = await open({ mode: 'fly' });
    ok(!(await p.locator('body').innerText()).includes('내 위치 아님'), '처음에는 "내 위치 아님"이 없다');
    const t0 = await push(p, 0, -29);
    await p.waitForTimeout(2500);
    const T = (Date.now() - t0) / 1000;
    const body = await p.locator('body').innerText();
    const m = body.match(/내 위치 아님 · (\d+(?:\.\d)?) (km|m)/);
    const want = ramp(120, T);
    const shown = m ? Number(m[1]) * (m[2] === 'km' ? 1000 : 1) : NaN;
    ok(!!m && Math.abs(shown - want) / want < 0.15, `"내 위치 아님 · ${m ? m[1] + ' ' + m[2] : '—'}"(눈의 자리 기준 실시간, 해석해 ${want.toFixed(0)} m ±15 %)`);
    ok(/m\/s/.test((await speedLabel(p)) || '') && Number((await speedLabel(p)).match(/(\d+) m\/s/)?.[1]) >= 100, `비행 속도 숫자 "${await speedLabel(p)}"`);
    await shot(p, '5-fly-held');
    await p.mouse.up();
    await p.waitForTimeout(3500);
    const done = await drv(p);
    ok(done.commits.length === 1, `놓고 멈추면 위치 확정이 정확히 한 번(${done.commits.length})`);
    const o = offs(done.commits[0]), dist = Math.hypot(o.east, o.north);
    const body2 = await p.locator('body').innerText();
    const m2 = body2.match(/내 위치 아님 · (\d+(?:\.\d)?) (km|m)/);
    const shown2 = m2 ? Number(m2[1]) * (m2[2] === 'km' ? 1000 : 1) : NaN;
    ok(!!m2 && Math.abs(shown2 - dist) < 1.5, `멈춘 뒤 거리 글 "${m2 && m2[0]}" = 확정한 자리까지 ${dist.toFixed(1)} m`);
    await shot(p, '5-fly-stopped');
    await ctx.close();
  }

  // ── 6 북 기준
  console.log('\n[6] 북 기준');
  {
    const { ctx, p } = await open({});
    await p.getByRole('button', { name: /^이동 방향 기준/ }).click();
    const body = await p.locator('body').innerText();
    ok(body.includes('북 기준') && /\bN\b/.test(body) && !body.includes('앞\n'), '단추가 "북 기준", 손잡이 글이 N');
    const t0 = await push(p, 0, -29);
    await p.waitForTimeout(1500);
    const held = await drv(p);
    const o = offs(held.lastEye), brg = bearing(o);
    ok(Math.min(brg, 360 - brg) < 1, `앞으로 밀면 시선(30°)과 무관하게 북쪽(이동 방위 ${brg.toFixed(2)}°)`);
    await p.mouse.up();
    await p.waitForTimeout(1500);
    await shot(p, '6-north-up');
    await ctx.close();
  }

  // ── 7 건물 받기 막대
  console.log('\n[7] 건물 받기 막대');
  {
    const { ctx, p } = await open({});
    await p.evaluate(() => { globalThis.__load = { phase: 'loading', done: 5, total: 8 }; });
    await p.waitForTimeout(700);
    let body = await p.locator('body').innerText();
    ok(body.includes('주변 불러오는 중') && body.includes('건물 62 %'), '받는 중 5/8 → "주변 불러오는 중" · "건물 62 %"');
    await shot(p, '7-loading-62');
    const t0 = await push(p, 0, -29);
    await p.waitForTimeout(700);
    body = await p.locator('body').innerText();
    ok(!body.includes('주변 불러오는 중'), '움직이는 동안에는 숨는다');
    await p.mouse.up();
    await p.waitForTimeout(2500);
    body = await p.locator('body').innerText();
    ok(body.includes('주변 불러오는 중') && body.includes('건물 62 %'), '멈추면 다시 보인다');
    await p.evaluate(() => { globalThis.__load = { phase: 'loading', done: 0, total: 0 }; });
    await p.waitForTimeout(700);
    body = await p.locator('body').innerText();
    ok(body.includes('주변 불러오는 중') && !body.includes('건물 ') , '전체를 모르면 제목만');
    await p.evaluate(() => { globalThis.__load = { phase: 'retry', done: 0, total: 0 }; });
    await p.waitForTimeout(700);
    body = await p.locator('body').innerText();
    ok(body.includes('건물을 못 받았어요') && body.includes('다시 시도해요'), '못 받으면 "건물을 못 받았어요" · "다시 시도해요"');
    await shot(p, '7-retry');
    await p.evaluate(() => { globalThis.__load = { phase: 'idle', done: 0, total: 0 }; });
    await p.waitForTimeout(700);
    body = await p.locator('body').innerText();
    ok(!body.includes('주변 불러오는 중') && !body.includes('건물을 못 받았어요'), 'idle 이면 사라진다');
    await ctx.close();
  }

  // ── 8 영어 · 일본어
  console.log('\n[8] 영어 · 일본어');
  for (const [lang, hint, names] of [['en', 'Full push = 2 m/s', ['Walk', 'Bike', 'Car', 'Fly']], ['ja', 'いっぱいに倒すと 2 m/s', ['徒歩', '自転車', '車', '飛行']]]) {
    const { ctx, p } = await open({ lang });
    const body = await p.locator('body').innerText();
    ok(body.includes(hint) && names.every(n => body.includes(n)), `${lang}: "${hint}" · ${names.join(' · ')}`);
    await shot(p, `8-${lang}`);
    await ctx.close();
  }

  await b.close();
  server.close();
  console.log(`\n${fail ? '실패 있음' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL: 예외 — ' + (e && e.stack || e)); process.exit(1); });
