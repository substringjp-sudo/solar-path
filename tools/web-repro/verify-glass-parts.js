/**
 * **유리 부품(아래 막대 · 시간 자 · 모드 줄 · 유리 칩 · 막)을 웹 하네스(`glass:1`)에서 손가락(마우스)으로 확인합니다**(docs/SANDBOX_MODE_PLAN.md 17 ~ 19절, 목업 "4차 b" · "5차: 모드 줄").
 * 계산은 `verify-dock-stages.js` · `verify-mode-strip.js` · `verify-time-ruler.js` · `verify-glass-tokens.js` 가 잽니다. 여기서는 **부품이 그 계산대로 그려지고 누른 대로 움직이는지, 화면 요소가 서로 겹치지 않는지**를 봅니다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 하네스: 390 × 844, 밝은 하늘(연무), 한국어, 시각 2026-11-21 17:04 KST, 일몰 17:17. 일어난 일은 `window.__glass` = { stage, mode, timeMs, switches: [{ mode, guideOp, guide }], commits: [ms], shutter, dates, nows }.
 *
 *  1. 처음 모습(시뮬레이션 · 접힘): 글에 "하늘" "데이터" "기록"(숫자 없음), "17:04", "지금", "일몰 17:17"(2026-11-21 기기 의견으로 시뮬레이션의 칩 줄 "어제 · 오늘 · 내일 · 날짜"를 없앴고, 화소 확인은 샌드박스 칩 "이동"에서 한다), 모드 줄 "시뮬레이션" "샌드박스" "사진" "천체"(네 개는 보이고 "타임랩스"는 줄 밖이라 DOM 에 없음).
 *     같은 것이 두 번 안 보인다(2026-11-21): 시뮬레이션은 칩 줄에 "오늘"이 있으므로 자 왼쪽 날짜 단추는 날짜 자체("11.21 토"), 그래서 "오늘"은 화면에 정확히 한 번. 샌드박스는 칩에 오늘이 없어 자 왼쪽이 "오늘" 한 번.
 *     머리줄 탭(하늘 · 데이터 · 기록)은 하나의 유리 면 안에 있고 탭마다 따로 유리 칠을 하지 않는다(탭 글자 단추의 배경이 투명, 켜진 "하늘"만 하늘색 덧칠).
 *     손잡이 이름 "펼치기". 손가락으로 누르는 단추(손잡이 제외)는 모두 폭 · 높이 40 px 이상. 손잡이는 눌림 영역을 8 px 씩 넓혀 28 + 16 = 44.
 *  2. 시간 자 끌기: 자 위에서 오른쪽으로 72 px 끌면 "16:04"(한 시간 전), 놓으면 commits 에 Date.UTC(2026, 10, 21, 7, 4) 하나. 이어서 왼쪽으로 36 px(시작 16:04 에서) → 16:34 … 대신 처음 상태에서 왼쪽 36 px → "17:34". "지금" → "17:04"(nows 1). 날짜 칩 → dates 1 이고 단계 mid.
 *     눈금 글자 "17:00" 의 가운데 x 가 자의 왼쪽에서 190.2 ± 1.5 px(17:04 일 때). 끌어서 시각이 바뀌는 동안 단계 · 모드는 안 바뀐다.
 *  3. 아래 막대 단계: 손잡이를 누르면 min → mid → full → min. 펼친 영역의 높이는 `dockExtraHeight(단계, 844, 잰 고정부 높이)`(고정부 높이는 화면에서 읽음) ± 1 과 같고 0 < mid ≤ full. 세로로 위로 100 px 밀면 min → mid, 위로 200 px 밀면 min → full(RN 의 PanResponder 는 끌기를 잡은 자리부터 거리를 재서 처음 20 px 남짓이 빠지므로 200 px 는 실제로 약 180 px = 두 단계 문턱 160 px 를 넘고, 161 ~ 170 px 로 끌면 한 단계에 그친다. 이 하네스의 마우스 끌기는 210 px 이상일 때 응답자 처리가 끌기를 못 받는 일이 있어 200 px 로 둔다), 아래로 100 px 밀면 mid → min.
 *     시간 자 · 모드 줄에서 가로로 끌어도 단계는 안 바뀐다. full 일 때 손잡이 위쪽 끝이 읽음 줄 아래(읽음 줄 아래 가장자리 이하)에 있다.
 *  4. 모드 줄: "샌드박스"를 누르면 mode sandbox, switches 끝 = { sandbox, clear, null }, 칩이 "이동" "보기" "장면" "도구". 샌드박스에서 줄을 왼쪽으로 100 px 밀면 "사진", switches 끝 = { photo, set, { 159, 13 } }(보던 방향이 가이드). 사진에서 왼쪽으로 200 px(두 칸) → "타임랩스"로 가고 guideOp keep.
 *     타임랩스에서는 "시뮬레이션"이 줄 밖(네 칸 거리)이라 누를 수 없고, 오른쪽으로 200 px 두 번(두 칸 + 두 칸 = 사진 → 시뮬레이션) 끌면 simulation, clear. 시뮬레이션에서 "천체"를 누르면 사진에 내려 mode photo, guideOp set. 선택된 글자의 불투명도 1, 바로 옆 글자 0.62(계산된 스타일).
 *     줄을 끌어도 시각 · 단계는 안 바뀐다. 이벤트가 있는 날(`event: 1`)에는 줄 끝에 "이벤트"가 하나 더 있다(사진 모드에서 천체 → 타임랩스 → 이벤트 순서로 이어져 보임).
 *  5. 겹침: 요소 목록(머리줄 탭 · 위치 · 설정 · 읽음 줄, 아래 막대의 손잡이 · 펼친 영역 안 요소 · 칩 줄과 칩들 · 날짜 · 시각 숫자 · 지금 · 자 · 셔터 줄의 썸네일 · 셔터 · 장면 저장 · 모드 줄)에서 `findOverlaps` 가 빈 목록이다(부모 · 자식은 제외).
 *     조합: 언어 ko · en · ja × 단계 min · mid · full × 모드 simulation · sandbox · photo × 화면 390 × 844 · 360 × 740. 모든 칩과 요소는 화면 안(0 ≤ x, x + 폭 ≤ 화면 폭). 읽음 줄은 머리줄과 겹치지 않는다.
 *  6. 접근성: 손잡이 이름이 단계마다 "펼치기" · "더 펼치기" · "접기". 시간 자는 슬라이더 역할이고 이름에 "시각". 모드 줄은 tablist, 고른 글자가 선택됨.
 *  7. 글자색 · 재질: 화면의 모든 글자는 계산된 색이 rgb(241, 245, 249)(#F1F5F9 — 하늘색 글자 없음). 유리 면(머리줄 탭)의 계산된 backdrop-filter 에 blur(22px) 가 있다. 유리 면에 테두리 너비 0.
 *     화소 확인(밝은 하늘): 칩 줄 안의 한 점(칩의 왼쪽 안쪽 6 px, 세로 가운데, 글자 없는 자리)의 색이 `glassBackdrop(연무, 아래 막 알파(그 자리 비율), 흐림 있음)` 과 채널마다 12 이내(샌드박스 칩 "이동"). 하늘 바탕은 이 장면에서 #e9e2d6 한 가지로 평평해지는 아래쪽만 잰다.
 *
 * 사용: sh tools/web-repro/build.sh && node tools/web-repro/verify-glass-parts.js .harness/web-repro [그림 저장 폴더]
 * 필요: Playwright, `node tools/shader-preview/stage-esm.js`(계산 모듈을 읽어 옴).
 */
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const http = require('http'), fs = require('fs'), path = require('path');
const { PREVIEW } = require('../shader-preview/paths');
const dir = process.argv[2];
const shots = process.argv[3];
if (shots) fs.mkdirSync(shots, { recursive: true });
const types = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => { const f = path.join(dir, decodeURIComponent(req.url.split('?')[0].split('#')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }).listen(0);
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const J = JSON.stringify;
const C = Date.UTC(2026, 10, 21, 8, 4);

(async () => {
  const D = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'dockStages.js'));
  const O = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'layoutOverlap.js'));
  const G = await import('file://' + path.join(PREVIEW, 'app', 'theme', 'glassTokens.js'));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const open = async (flags = {}, vp = { width: 390, height: 844 }) => {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 200)));
    const hash = JSON.stringify({ glass: 1, w: vp.width, h: vp.height, ...flags });
    await p.goto(`http://localhost:${server.address().port}/repro.html#${encodeURIComponent(hash)}`);
    await p.locator('[data-testid="glass-root"]').waitFor({ timeout: 90000 });
    await p.waitForTimeout(400);
    return { ctx, p };
  };
  const st = (p) => p.evaluate(() => JSON.parse(JSON.stringify(globalThis.__glass)));
  const body = (p) => p.locator('body').innerText();
  const rect = async (p, id) => { const l = p.locator(`[data-testid="${id}"]`).first(); if (!(await l.count())) return null; return await l.evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }); };
  const shot = async (p, name) => { if (shots) await p.screenshot({ path: path.join(shots, name + '.png') }); };
  // 사람 속도로 끈다(한 걸음 20 ms): 100 px 가 0.2 초 = 500 px/s, 두 단계 속도(1800 px/s) 밑. 너무 빠르게 끌면 속도 규칙이 두 칸으로 만든다.
  // 하네스 사정: 끌기를 마치고 손을 뗀 뒤 바로 다음 끌기를 시작하면 웹의 응답자 처리가 새 끌기를 놓치는 일이 있어(위로 · 아래로 · 위로 세 번째가 안 먹음), 빈 하늘을 한 번 눌러 둔다.
  const drag = async (p, from, dx, dy = 0, steps = 10) => { await p.mouse.click(5, 300); await p.waitForTimeout(150); await p.mouse.move(from.x, from.y); await p.mouse.down(); for (let i = 1; i <= steps; i++) { await p.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps); await p.waitForTimeout(20); } await p.mouse.up(); await p.waitForTimeout(400); };
  const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const digits = async (p) => (await p.locator('[data-testid="ruler-digits"]').innerText()).trim();

  // ── 1 처음 모습
  console.log('\n[1] 처음 모습');
  {
    const { ctx, p } = await open();
    const t = await body(p);
    ok(['하늘', '데이터', '기록', '17:04', '지금', '일몰 17:17', '시뮬레이션', '샌드박스', '사진', '천체'].every(w => t.includes(w)) && !t.includes('타임랩스') && !/\b0[123]\b/.test(t.split('17:04')[0]), `글 확인(타임랩스는 줄 밖): ${t.replace(/\n+/g, ' ').slice(0, 90)}`);
    ok(!t.includes('어제') && !t.includes('내일') && t.includes('11.21 토'), '시뮬레이션: 칩 줄이 없고 자 왼쪽은 날짜("11.21 토")');
    const tabBg = await p.locator('[data-testid="hdr-tabs"] [role="button"]').evaluateAll(els => els.map(e => getComputedStyle(e.firstElementChild || e).backgroundColor));
    ok(tabBg.length === 3 && tabBg.slice(1).every(c => c === 'rgba(0, 0, 0, 0)'), `탭 단추 배경이 투명(켜진 것 빼고): ${tabBg.join(' | ')}`);
    const handle = p.locator('[data-testid="dock-handle"]');
    ok((await handle.getAttribute('aria-label')) === '펼치기', '손잡이 이름 "펼치기"');
    const hr = await rect(p, 'dock-handle');
    ok(hr.h + 16 >= 44 || hr.h >= 28, `손잡이 눌림 영역: 높이 ${hr.h} + 위아래 8 px`);
    const small = await p.locator('[role="button"]').evaluateAll(els => els.filter(e => e.getAttribute('data-testid') !== 'dock-handle').map(e => { const r = e.getBoundingClientRect(); return { id: e.getAttribute('data-testid') || e.getAttribute('aria-label'), w: r.width, h: r.height }; }).filter(r => r.w > 0 && (r.w < 40 || r.h < 40)));
    ok(small.length === 0, `손가락으로 누르는 단추는 모두 40 px 이상(작은 것 ${J(small)})`);
    await shot(p, '1-sim-min');
    await ctx.close();
  }

  // ── 2 시간 자 끌기
  console.log('\n[2] 시간 자 끌기');
  {
    const { ctx, p } = await open();
    const tr = await rect(p, 'ruler-track');
    const lab = await p.locator('text="17:00"').first().evaluate(e => { const r = e.getBoundingClientRect(); return r.x + r.width / 2; });
    ok(Math.abs(lab - tr.x - 190.2) <= 1.5, `"17:00" 가운데 x ${(lab - tr.x).toFixed(1)} (190.2 ± 1.5)`);
    await drag(p, center(tr), 72);
    let s = await st(p);
    ok((await digits(p)) === '16:04' && s.timeMs === Date.UTC(2026, 10, 21, 7, 4), `72 px 오른쪽 → ${await digits(p)}`);
    ok(s.commits.length === 1 && s.commits[0] === Date.UTC(2026, 10, 21, 7, 4) && s.stage === 'min' && s.mode === 'simulation', '놓으면 commit 하나, 단계 · 모드는 그대로');
    await p.locator('[data-testid="ruler-now"]').click();
    s = await st(p);
    ok((await digits(p)) === '17:04' && s.nows === 1, '"지금" → 17:04');
    await drag(p, center(await rect(p, 'ruler-track')), -36);
    ok((await digits(p)) === '17:34', `36 px 왼쪽 → ${await digits(p)}`);
    await p.locator('[data-testid="ruler-date"]').click();
    s = await st(p);
    ok(s.dates === 1 && s.stage === 'mid', '날짜 칩 → dates 1, 단계 mid');
    await shot(p, '2-ruler-dragged');
    await ctx.close();
  }

  // ── 3 아래 막대 단계
  console.log('\n[3] 아래 막대 단계');
  {
    const { ctx, p } = await open();
    const fixedH = Math.round((await rect(p, 'dock-fixed')).h);
    const exp = async () => Math.round((await rect(p, 'dock-expanded')).h);
    const seq = [];
    for (let i = 0; i < 4; i++) { seq.push([(await st(p)).stage, await exp()]); if (i < 3) { await p.locator('[data-testid="dock-handle"]').click({ force: true }); await p.waitForTimeout(450); } }
    ok(J(seq.map(x => x[0])) === J(['min', 'mid', 'full', 'min']), `손잡이: ${seq.map(x => x[0])}`);
    const want = (s) => D.dockExtraHeight(s, 844, fixedH + 28); // 손잡이 줄(28 px)도 막대가 차지하는 자리
    ok(Math.abs(seq[0][1] - 0) <= 1 && Math.abs(seq[1][1] - want('mid')) <= 1 && Math.abs(seq[2][1] - want('full')) <= 1 && 0 < seq[1][1] && seq[1][1] <= seq[2][1], `펼친 영역 높이 ${seq.map(x => x[1])} (고정부 ${fixedH} + 손잡이 줄 28 → mid ${want('mid')} · full ${want('full')})`);
    // 세로 밀기: 칩 줄 위에서
    const sr = center(await rect(p, 'shutter-row'));
    await drag(p, { x: 8, y: sr.y }, 0, -100);
    ok((await st(p)).stage === 'mid', `위로 100 px → mid (${(await st(p)).stage})`);
    await drag(p, { x: 8, y: center(await rect(p, 'shutter-row')).y }, 0, 100);
    ok((await st(p)).stage === 'min', `아래로 100 px → min (${(await st(p)).stage})`);
    await drag(p, { x: 8, y: center(await rect(p, 'shutter-row')).y }, 0, -200);
    ok((await st(p)).stage === 'full', `위로 200 px → full (${(await st(p)).stage})`);
    const hdl = await rect(p, 'dock-handle'), ro = await rect(p, 'readout');
    ok(hdl.y >= ro.y + ro.h - 1, `full 일 때 손잡이 위(${hdl.y.toFixed(0)}) ≥ 읽음 줄 아래(${(ro.y + ro.h).toFixed(0)})`);
    await shot(p, '3-full');
    await drag(p, { x: 8, y: center(await rect(p, 'shutter-row')).y }, 0, 100);
    ok((await st(p)).stage === 'mid', `아래로 100 px → mid (${(await st(p)).stage})`);
    await p.locator('[data-testid="dock-handle"]').click({ force: true }); await p.locator('[data-testid="dock-handle"]').click({ force: true }); await p.waitForTimeout(400);
    const s0 = (await st(p)).stage;
    await drag(p, center(await rect(p, 'ruler-track')), 40);
    await drag(p, center(await rect(p, 'mode-strip')), -20, 0, 4);
    ok((await st(p)).stage === s0, `가로로 끌어도 단계는 그대로(${s0})`);
    await ctx.close();
  }

  // ── 4 모드 줄
  console.log('\n[4] 모드 줄');
  {
    const { ctx, p } = await open();
    const mode = async () => (await st(p)).mode;
    const last = async () => { const s = await st(p); return s.switches[s.switches.length - 1]; };
    await p.locator('[data-testid="mode-sandbox"]').click();
    let t = await body(p);
    ok((await mode()) === 'sandbox' && J(await last()) === J({ mode: 'sandbox', guideOp: 'clear', guide: null }) && ['이동', '보기', '장면', '도구'].every(w => t.includes(w)) && !t.includes('어제'), '샌드박스: clear, 칩 이동 · 보기 · 장면 · 도구');
    await drag(p, center(await rect(p, 'mode-strip')), -100);
    ok((await mode()) === 'photo' && J(await last()) === J({ mode: 'photo', guideOp: 'set', guide: { azDeg: 159, elDeg: 13 } }), `왼쪽 100 px → 사진, 가이드 set { 159, 13 } (${J(await last())})`);
    await drag(p, center(await rect(p, 'mode-strip')), -200);
    ok((await mode()) === 'timelapse' && (await last()).guideOp === 'keep', `왼쪽 200 px(두 칸) → 타임랩스, keep (${await mode()}, ${(await last()).guideOp})`);
    await drag(p, center(await rect(p, 'mode-strip')), 200);
    await drag(p, center(await rect(p, 'mode-strip')), 200);
    ok((await mode()) === 'simulation' && (await last()).guideOp === 'clear', `오른쪽 200 px 두 번 → 시뮬레이션(타임랩스에서 네 칸 밖이라 누를 수 없음), clear (${await mode()})`);
    await p.locator('[data-testid="mode-astro"]').click();
    ok((await mode()) === 'photo' && (await last()).guideOp === 'set', '시뮬레이션에서 천체를 누르면 사진에 내려 set');
    const op = (id) => p.locator(`[data-testid="${id}"]`).evaluate(e => getComputedStyle(e).opacity);
    ok((await op('mode-photo')) === '1' && (await op('mode-sandbox')) === '0.62' && (await op('mode-astro')) === '0.62', '선택 1, 옆 0.62');
    const before = await st(p);
    await drag(p, center(await rect(p, 'mode-strip')), 30, 0, 4);
    const after = await st(p);
    ok(after.stage === before.stage && after.timeMs === before.timeMs, '줄을 끌어도 시각 · 단계는 그대로');
    ok(await p.locator('[role="tablist"]').count() >= 1 && (await p.locator('[data-testid="mode-photo"]').getAttribute('aria-selected')) === 'true', '줄은 tablist, 고른 글자가 선택됨');
    await shot(p, '4-photo');
    await ctx.close();
    const e = await open({ event: 1, mode: 'photo' });
    await drag(e.p, center(await rect(e.p, 'mode-strip')), -200);
    ok((await st(e.p)).mode === 'timelapse', '이벤트 날: 사진 → 두 칸 → 타임랩스');
    await drag(e.p, center(await rect(e.p, 'mode-strip')), -50);
    ok((await st(e.p)).mode === 'event' && (await body(e.p)).includes('이벤트'), '이어서 한 칸 → 이벤트');
    await e.ctx.close();
  }

  // ── 5 겹침
  console.log('\n[5] 겹침');
  {
    const parents = { 'dock-handle': 'dock', 'dock-expanded': 'dock', 'dock-fixed': 'dock', 'chips-row': 'dock-fixed', 'ruler-date-swipe': 'dock-fixed', 'ruler-date': 'ruler-date-swipe', 'ruler-digits': 'dock-fixed', 'ruler-now': 'dock-fixed', 'ruler-track': 'dock-fixed', 'shutter-row': 'dock-fixed', 'mode-strip': 'dock-fixed', thumb: 'shutter-row', shutter: 'shutter-row', 'scene-save': 'shutter-row', 'hdr-tabs': 'hdr', 'hdr-place': 'hdr', 'hdr-settings': 'hdr' };
    let bad = [], outside = [], n = 0;
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 740 }])
      for (const lang of ['ko', 'en', 'ja'])
        for (const mode of ['simulation', 'sandbox', 'photo'])
          for (const stage of ['min', 'mid', 'full']) {
            const { ctx, p } = await open({ lang, mode, stage }, vp);
            await p.waitForTimeout(500);
            const items = await p.evaluate((parents) => {
              const out = [];
              document.querySelectorAll('[data-testid]').forEach(e => {
                const id = e.getAttribute('data-testid');
                if (id === 'glass-root' || id === 'dock' || id.startsWith('mode-') && id !== 'mode-strip') return;
                const r = e.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) return;
                out.push({ id, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, parent: parents[id] || (id.startsWith('chip-') ? 'chips-row' : id.startsWith('week-') ? 'expanded-week' : id === 'expanded-week' || id === 'expanded-panel' ? 'dock-expanded' : undefined) });
              });
              return out;
            }, parents);
            // 펼친 영역이 접혀 있으면(높이 0, overflow 잘림) 그 안 요소는 보이지 않으므로 겹침 목록에서 뺀다.
            const ex = items.find(i => i.id === 'dock-expanded');
            const hidden = (i) => (!ex || ex.rect.h < 1) && (i.parent === 'dock-expanded' || i.parent === 'expanded-week' || i.id === 'expanded-week' || i.id === 'expanded-panel');
            const vis = items.filter(i => !hidden(i));
            const real = O.findOverlaps(vis);
            if (real.length) bad.push(`${vp.width}x${vp.height} ${lang} ${mode} ${stage}: ${J(real)}`);
            for (const it of vis) if (it.rect.x < -0.5 || it.rect.x + it.rect.w > vp.width + 0.5) outside.push(`${vp.width} ${lang} ${mode} ${stage} ${it.id} x ${it.rect.x.toFixed(0)} w ${it.rect.w.toFixed(0)}`);
            const ro = items.find(i => i.id === 'readout'), ht = items.find(i => i.id === 'hdr-tabs'), hd = items.find(i => i.id === 'dock-handle');
            if (ro && ht && O.overlaps(ro.rect, ht.rect)) bad.push(`${vp.width} ${lang} ${mode} ${stage}: 읽음 줄 · 머리줄 탭 겹침`);
            if (stage === 'full' && ro && hd && hd.rect.y < ro.rect.y + ro.rect.h - 1) bad.push(`${vp.width}x${vp.height} ${lang} ${mode} full: 손잡이가 읽음 줄 위로 올라감`);
            n++;
            if (shots && vp.width === 390 && lang === 'en' && mode === 'sandbox') await shot(p, `5-en-sandbox-${stage}`);
            await ctx.close();
          }
    ok(bad.length === 0, `겹침 없음(${n} 조합)${bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''}`);
    ok(outside.length === 0, `요소가 모두 화면 안${outside.length ? ': ' + outside.slice(0, 4).join(' | ') : ''}`);
  }

  // ── 6~7 접근성 · 글자색 · 재질
  console.log('\n[6~7] 접근성 · 글자색 · 재질');
  {
    const { ctx, p } = await open();
    const names = [];
    for (let i = 0; i < 3; i++) { names.push(await p.locator('[data-testid="dock-handle"]').getAttribute('aria-label')); await p.locator('[data-testid="dock-handle"]').click({ force: true }); await p.waitForTimeout(300); }
    ok(J(names) === J(['펼치기', '더 펼치기', '접기']), `손잡이 이름 ${names}`);
    ok(await p.getByRole('slider', { name: /시각/ }).count() === 1, '시간 자는 슬라이더 역할 · 이름 "시각"');
    await p.locator('[data-testid="dock-handle"]').click({ force: true }); await p.waitForTimeout(400);
    const colors = await p.evaluate(() => {
      const bad = [];
      const w = document.createTreeWalker(document.querySelector('[data-testid="glass-root"]'), NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const c = getComputedStyle(n.parentElement).color; if (c !== 'rgb(241, 245, 249)') bad.push(n.textContent.trim() + ' ' + c); }
      return bad;
    });
    ok(colors.length === 0, `모든 글자가 #F1F5F9${colors.length ? ': ' + colors.slice(0, 4).join(' | ') : ''}`);
    const glass = await p.locator('[data-testid="hdr-tabs"]').evaluate(e => { const c = getComputedStyle(e); return { bf: c.backdropFilter || c.webkitBackdropFilter, bw: c.borderTopWidth }; });
    ok(/blur\(22px\)/.test(glass.bf) && glass.bw === '0px', `유리 면 backdrop-filter "${glass.bf}", 테두리 ${glass.bw}`);
    await ctx.close();
    // 화소: 칩 줄 안, 칩 왼쪽 안쪽 6 px 의 색
    const q = await open({ sky: 'haze', mode: 'sandbox' });
    const dock = await rect(q.p, 'dock-handle');
    const chip = await rect(q.p, 'chip-move');
    const fixed = await rect(q.p, 'dock-fixed');
    const png = await q.p.screenshot();
    const px = await q.p.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0); return null; }, png.toString('base64')).catch(() => null);
    void px; void dock;
    const probe = { x: Math.round(chip.x + 6), y: Math.round(chip.y + chip.h / 2) };
    const rgb = await q.p.evaluate(async ({ b64, x, y }) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0); return Array.from(cx.getImageData(x, y, 1, 1).data).slice(0, 3); }, { b64: png.toString('base64'), x: probe.x, y: probe.y });
    const dockTop = fixed.y - 28 - 40 + 40; // 막은 dock 위쪽(손잡이 줄 포함)부터. 아래 막 높이 = 고정부 + 0 + 40, 맨 아래에 붙음
    const scrimH = fixed.h + 40, scrimTop = 844 - scrimH;
    const f = (probe.y - scrimTop) / scrimH;
    const want = G.glassBackdrop([0xe9, 0xe2, 0xd6], G.scrimAlpha(G.SCRIM_BOTTOM, f), true);
    const diff = rgb.map((v, i) => Math.abs(v - want[i]));
    ok(diff.every(d => d <= 12), `칩 안 화소 rgb(${rgb}) ≈ 계산 rgb(${want.map(Math.round)}) (비율 ${f.toFixed(2)}, 차 ${diff.map(Math.round)})`);
    void dockTop;
    await q.ctx.close();
  }

  await b.close(); server.close();
  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n통과 — pass ${pass}`);
  process.exit(fail ? 1 : 0);
})();
