/**
 * **하늘 화면의 새 틀(`SkyScreen/SkyFrame`)이 누른 대로 움직이는지 웹 하네스(`skyframe:1`)에서 확인합니다**(docs/SANDBOX_MODE_PLAN.md 16 ~ 21절, 목업 "4차 b" · "5차: 모드 줄").
 * 부품(유리 면 · 시간 자 · 모드 줄 · 아래 막대)은 `verify-glass-parts.js` 가 봅니다. 여기서는 **시뮬레이션 · 샌드박스의 칩 · 펼침 · 시각 알림 순서 · 모드 바꾸기 · 겹침**을 봅니다. 안의 내용은 가짜 글입니다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 하네스: 390 × 844, 밝은 하늘, 한국어, 시각 C = 2026-11-21 17:04 KST(+9), 지금도 C. 일어난 일은 `window.__frame` = { mode, timeMs, ev: [{ e: 'start' | 'pick' | 'end', kind, ms? }], switches, shoots, saves, nows, calendars }. 하루 = 86400000 ms.
 *
 *  1. 처음(시뮬레이션): 칩 "어제" "오늘" "내일" "날짜", "오늘" 칩이 켜짐(aria-pressed 참)이고 다른 둘은 거짓, 읽음 줄 "159° S · 해 EL 13.0°", 자 왼쪽 단추 "11.21 토", 시각 숫자 "17:04", 펼친 내용(일주일 줄 · 시뮬레이션 내용)은 안 보임.
 *  2. 날짜 칩(펼치지 않고 바로 옮김): "어제" → ev 가 start(date) · pick(date, C − 1일) · end(date) 순서, 자 왼쪽 "11.20 금", 시각 숫자는 그대로 "17:04", "어제" 칩만 켜짐. 이어서 "내일" → pick(date, C + 1일)(어제에서 이틀 건너 내일로 감), "오늘" → pick(date, C).
 *  3. "날짜" 칩: 누르면 일주일 줄(7 칸, 날 19 20 21 22 23 24 25, 21 이 켜짐)이 펼쳐지고 "날짜" 칩이 펼쳐짐(aria-expanded 참), "달력에서 고르기" 단추가 보임. 23 칸을 누르면 pick(date, C + 2일)와 23 이 켜짐. "달력에서 고르기"를 누르면 calendars 1. "날짜" 를 다시 누르면 접힌다(일주일 줄이 안 보임, aria-expanded 거짓).
 *  4. 시간 자를 오른쪽으로 72 px 끌면 ev 에 start(time) 이 먼저, pick(time) 들이 이어지고 end(time) 이 마지막이며, 마지막 pick 은 C − 1시간, 시각 숫자 "16:04". "지금"을 누르면 nows 1 이고 "17:04" 로 돌아온다.
 *  5. 끝까지 펼침: 손잡이를 누르면 min → mid → full. mid 에서는 시뮬레이션 내용("점수와 다가오는 좋은 순간")이 안 보이고 full 에서 보인다. 다시 누르면 접히고 일주일 줄도 사라진다.
 *  6. 샌드박스: 모드 줄 "샌드박스"를 누르면 switches 끝 = { sandbox, clear, null }, 하네스의 mode 가 sandbox, 칩이 "이동" "보기" "장면" "도구"(어제 · 오늘 · 내일 · 날짜 없음), 읽음 줄 "159° S · EL 13.0° · 눈 1.6 m", 펼침 없음.
 *     "이동"을 누르면 펼침이 열리고 그 칸 내용("이동 내용")이 보이며 "이동" 칩이 펼쳐짐. 이어서 "보기"를 누르면 내용이 "보기 내용"으로 바뀌고(이동 내용은 안 보임) 닫혔다 열리지 않고 그대로 펼쳐진 채다. "보기"를 다시 누르면 접히고(내용이 안 보임) 칩 aria-expanded 거짓. 펼친 채 모드 줄을 시뮬레이션으로 되돌리면 펼침이 접히고(내용 없음) 칩이 시뮬레이션 칩으로 바뀐다.
 *  7. 카메라 쪽: 샌드박스에서 모드 줄을 왼쪽으로 100 px 밀면 switches 끝 = { photo, set, { 159, 13 } }(보던 방향이 가이드)이고 하네스의 mode 는 그대로 sandbox(카메라는 하늘 화면이 아니라 밖에서 엶). 시뮬레이션에서 "천체"를 누르면 { photo, set, … }. 모드를 바꾸면 펼침은 접힌다.
 *  8. 셔터를 누르면 shoots 1, 장면 저장 단추를 누르면 saves 1.
 *  9. 겹침: 언어 ko · en · ja × 화면 390 × 844 · 360 × 740 × 상태 { 시뮬레이션 접힘, 날짜 펼침(mid), 시뮬레이션 full, 샌드박스 이동 · 보기 · 장면 · 도구 펼침 } 에서 `findOverlaps` 가 빈 목록(읽음 줄 · 칩 줄과 칩 · 자 왼쪽 · 시각 숫자 · 지금 · 자 · 셔터 줄의 썸네일 · 셔터 · 장면 저장 · 모드 줄 · 일주일 줄과 칸 · 달력 단추 · 펼친 칸). 읽음 줄은 막대 손잡이보다 위(읽음 줄 아래 가장자리 ≤ 손잡이 위 가장자리 + 1). 모든 요소는 화면 안.
 *
 * 사용: sh tools/web-repro/build.sh && node tools/web-repro/verify-sky-frame.js .harness/web-repro [그림 저장 폴더]
 * 필요: Playwright, `node tools/shader-preview/stage-esm.js`.
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
const C = Date.UTC(2026, 10, 21, 8, 4), DAY = 86400000;

(async () => {
  const O = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'layoutOverlap.js'));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const open = async (flags = {}, vp = { width: 390, height: 844 }) => {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 200)));
    const hash = JSON.stringify({ skyframe: 1, w: vp.width, h: vp.height, ...flags });
    await p.goto(`http://localhost:${server.address().port}/repro.html#${encodeURIComponent(hash)}`);
    await p.locator('[data-testid="frame-root"]').waitFor({ timeout: 90000 });
    await p.waitForTimeout(400);
    return { ctx, p };
  };
  const st = (p) => p.evaluate(() => JSON.parse(JSON.stringify(globalThis.__frame)));
  const body = (p) => p.locator('body').innerText();
  const rect = async (p, id) => { const l = p.locator(`[data-testid="${id}"]`).first(); if (!(await l.count())) return null; return await l.evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }); };
  // 펼친 영역이 접혀 있으면(높이 0, 안쪽은 overflow 로 잘림) 그 안 요소는 DOM 에 있어도 보이지 않는다.
  const vis = async (p, id) => { const r = await rect(p, id); if (!r || r.w <= 0 || r.h <= 0) return false; const ex = await rect(p, 'dock-expanded'); return !!ex && ex.h >= 1 && r.y >= ex.y - 1 && r.y + r.h <= ex.y + ex.h + 1; };
  const attr = (p, id, a) => p.locator(`[data-testid="${id}"]`).first().getAttribute(a);
  const shot = async (p, name) => { if (shots) await p.screenshot({ path: path.join(shots, name + '.png') }); };
  const tap = async (p, id) => { await p.locator(`[data-testid="${id}"]`).first().click({ force: true }); await p.waitForTimeout(450); };
  const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  // 하네스 사정은 verify-glass-parts.js 와 같다(사람 속도로 끌고, 끌기 사이에 빈 하늘을 한 번 눌러 둠).
  const drag = async (p, from, dx, dy = 0, steps = 10) => { await p.mouse.click(5, 300); await p.waitForTimeout(150); await p.mouse.move(from.x, from.y); await p.mouse.down(); for (let i = 1; i <= steps; i++) { await p.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps); await p.waitForTimeout(20); } await p.mouse.up(); await p.waitForTimeout(450); };
  const digits = async (p) => (await p.locator('[data-testid="ruler-digits"]').innerText()).trim();
  const lastSw = async (p) => { const s = await st(p); return s.switches[s.switches.length - 1]; };

  // ── 1 처음
  console.log('\n[1] 처음(시뮬레이션)');
  {
    const { ctx, p } = await open();
    const t = await body(p);
    ok(['어제', '오늘', '내일', '날짜', '159° S · 해 EL 13.0°', '11.21 토', '17:04'].every(w => t.includes(w)) && !t.includes('이동'), '칩 · 읽음 줄 · 자 왼쪽 날짜 · 시각');
    ok((await attr(p, 'chip-today', 'aria-pressed')) === 'true' && (await attr(p, 'chip-yesterday', 'aria-pressed')) === 'false' && (await attr(p, 'chip-tomorrow', 'aria-pressed')) === 'false', '"오늘" 칩만 켜짐');
    ok(!(await vis(p, 'week-strip')) && !t.includes('점수와 다가오는 좋은 순간'), '펼친 내용 안 보임');
    await shot(p, '1-sim');
    await ctx.close();
  }

  // ── 2 날짜 칩
  console.log('\n[2] 날짜 칩');
  {
    const { ctx, p } = await open();
    await tap(p, 'chip-yesterday');
    let s = await st(p);
    ok(J(s.ev.map(e => e.e + ':' + e.kind)) === J(['start:date', 'pick:date', 'end:date']) && s.ev[1].ms === C - DAY, `어제: ev ${s.ev.map(e => e.e)} · ms = C − 1일`);
    ok((await body(p)).includes('11.20 금') && (await digits(p)) === '17:04' && (await attr(p, 'chip-yesterday', 'aria-pressed')) === 'true' && (await attr(p, 'chip-today', 'aria-pressed')) === 'false', '자 왼쪽 "11.20 금", 시각 그대로, "어제"만 켜짐');
    await tap(p, 'chip-tomorrow');
    s = await st(p);
    ok(s.ev[s.ev.length - 2].ms === C + DAY && s.timeMs === C + DAY, '어제에서 내일 → C + 1일');
    await tap(p, 'chip-today');
    s = await st(p);
    ok(s.ev[s.ev.length - 2].ms === C && s.timeMs === C, '오늘 → C');
    await ctx.close();
  }

  // ── 3 날짜 펼침
  console.log('\n[3] 날짜 펼침');
  {
    const { ctx, p } = await open();
    await tap(p, 'chip-date');
    const days = await p.locator('[data-testid^="week-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid').replace('week-', '')).filter(x => /^\d+$/.test(x)));
    ok(J(days) === J(['19', '20', '21', '22', '23', '24', '25']) && (await attr(p, 'week-21', 'aria-pressed')) === 'true' && (await attr(p, 'chip-date', 'aria-expanded')) === 'true' && (await vis(p, 'calendar')), `일주일 줄 ${days}, 21 켜짐, "날짜" 펼쳐짐, 달력 단추`);
    await tap(p, 'week-23');
    let s = await st(p);
    ok(s.ev[s.ev.length - 2].ms === C + 2 * DAY && (await attr(p, 'week-23', 'aria-pressed')) === 'true', '23 칸 → C + 2일, 23 켜짐');
    await tap(p, 'calendar');
    ok((await st(p)).calendars === 1, '달력에서 고르기 → calendars 1');
    await shot(p, '3-week');
    await tap(p, 'chip-date');
    ok(!(await vis(p, 'week-strip')) && (await attr(p, 'chip-date', 'aria-expanded')) === 'false', '"날짜" 다시 → 접힘');
    await ctx.close();
  }

  // ── 4 시간 자
  console.log('\n[4] 시간 자');
  {
    const { ctx, p } = await open();
    await drag(p, center(await rect(p, 'ruler-track')), 72);
    const s = await st(p);
    const kinds = s.ev.map(e => e.e + ':' + e.kind);
    ok(kinds[0] === 'start:time' && kinds[kinds.length - 1] === 'end:time' && kinds.slice(1, -1).every(k => k === 'pick:time') && s.ev[s.ev.length - 2].ms === C - 3600000 && (await digits(p)) === '16:04', `start → pick … → end, 마지막 pick = C − 1시간 (${kinds.length} 개, ${await digits(p)})`);
    await tap(p, 'ruler-now');
    ok((await st(p)).nows === 1 && (await digits(p)) === '17:04', '"지금" → nows 1, 17:04');
    await ctx.close();
  }

  // ── 5 끝까지 펼침
  console.log('\n[5] 끝까지 펼침');
  {
    const { ctx, p } = await open();
    await tap(p, 'dock-handle');
    const mid = await body(p);
    await tap(p, 'dock-handle');
    const full = await body(p);
    ok(!mid.includes('점수와 다가오는 좋은 순간') && full.includes('점수와 다가오는 좋은 순간') && await vis(p, 'week-strip'), 'mid 에는 시뮬레이션 내용이 없고 full 에 있다');
    await shot(p, '5-sim-full');
    await tap(p, 'dock-handle');
    ok(!(await vis(p, 'week-strip')) && !(await body(p)).includes('점수와 다가오는 좋은 순간'), '다시 누르면 접힘');
    await ctx.close();
  }

  // ── 6 샌드박스
  console.log('\n[6] 샌드박스');
  {
    const { ctx, p } = await open();
    await tap(p, 'mode-sandbox');
    let t = await body(p);
    ok(J(await lastSw(p)) === J({ mode: 'sandbox', guideOp: 'clear', guide: null }) && (await st(p)).mode === 'sandbox' && ['이동', '보기', '장면', '도구', '159° S · EL 13.0° · 눈 1.6 m'].every(w => t.includes(w)) && !t.includes('어제') && !t.includes('내일'), '샌드박스: clear, 칩 이동 · 보기 · 장면 · 도구, 읽음 줄');
    await tap(p, 'chip-move');
    t = await body(p);
    ok(t.includes('이동 내용') && (await attr(p, 'chip-move', 'aria-expanded')) === 'true', '"이동" → 이동 내용, 펼쳐짐');
    await shot(p, '6-sbx-move');
    await tap(p, 'chip-view');
    t = await body(p);
    ok(t.includes('보기 내용') && !t.includes('이동 내용') && (await attr(p, 'chip-view', 'aria-expanded')) === 'true' && (await attr(p, 'chip-move', 'aria-expanded')) === 'false', '"보기" → 내용이 바뀌고 펼쳐진 채');
    await tap(p, 'chip-view');
    t = await body(p);
    ok(!t.includes('보기 내용') && (await attr(p, 'chip-view', 'aria-expanded')) === 'false', '"보기" 다시 → 접힘');
    await tap(p, 'chip-tools');
    ok((await body(p)).includes('도구 내용'), '"도구" → 도구 내용');
    await drag(p, center(await rect(p, 'mode-strip')), 100);
    t = await body(p);
    ok((await st(p)).mode === 'simulation' && !t.includes('도구 내용') && t.includes('어제') && !(await vis(p, 'panel-tools')), `오른쪽으로 밀어 시뮬레이션: 펼침 접힘, 칩이 시뮬레이션 칩 (${(await st(p)).mode})`);
    await ctx.close();
  }

  // ── 7 카메라 쪽, 8 셔터
  console.log('\n[7~8] 카메라 쪽 · 셔터 · 장면 저장');
  {
    const { ctx, p } = await open({ mode: 'sandbox' });
    await tap(p, 'chip-move');
    await drag(p, center(await rect(p, 'mode-strip')), -100);
    ok(J(await lastSw(p)) === J({ mode: 'photo', guideOp: 'set', guide: { azDeg: 159, elDeg: 13 } }) && (await st(p)).mode === 'sandbox', `샌드박스에서 왼쪽 100 px: ${J(await lastSw(p))}, 하네스 mode 그대로`);
    ok(!(await body(p)).includes('이동 내용'), '모드를 바꾸면 펼침은 접힌다');
    await ctx.close();
    const q = await open();
    await tap(q.p, 'mode-astro');
    const sw = await lastSw(q.p);
    ok(sw.mode === 'photo' && sw.guideOp === 'set', `시뮬레이션에서 "천체" → 사진에 내려 set (${J(sw)})`);
    await tap(q.p, 'shutter');
    await tap(q.p, 'scene-save');
    const s = await st(q.p);
    ok(s.shoots === 1 && s.saves === 1, '셔터 1 · 장면 저장 1');
    await q.ctx.close();
  }

  // ── 9 겹침
  console.log('\n[9] 겹침');
  {
    const parents = { 'chips-row': 'dock-fixed', 'ruler-date': 'dock-fixed', 'ruler-digits': 'dock-fixed', 'ruler-now': 'dock-fixed', 'ruler-track': 'dock-fixed', 'shutter-row': 'dock-fixed', 'mode-strip': 'dock-fixed', thumb: 'shutter-row', shutter: 'shutter-row', 'scene-save': 'shutter-row', 'dock-handle': 'dock', 'dock-expanded': 'dock', 'dock-fixed': 'dock', 'week-strip': 'dock-expanded', calendar: 'dock-expanded', 'sim-body': 'dock-expanded' };
    const states = [
      ['sim-min', []],
      ['sim-week', ['chip-date']],
      ['sim-full', ['chip-date', 'dock-handle']],
      ['sbx-move', ['mode-sandbox', 'chip-move']],
      ['sbx-view', ['mode-sandbox', 'chip-view']],
      ['sbx-scene', ['mode-sandbox', 'chip-scene']],
      ['sbx-tools', ['mode-sandbox', 'chip-tools']],
    ];
    let bad = [], outside = [], n = 0;
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 740 }])
      for (const lang of ['ko', 'en', 'ja'])
        for (const [name, taps] of states) {
          const { ctx, p } = await open({ lang }, vp);
          for (const id of taps) await tap(p, id);
          const items = await p.evaluate((parents) => {
            const out = [];
            document.querySelectorAll('[data-testid]').forEach(e => {
              const id = e.getAttribute('data-testid');
              if (id === 'frame-root' || id === 'dock' || (id.startsWith('mode-') && id !== 'mode-strip') || id.startsWith('body-') || id === 'frame-readout') return;
              const r = e.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return;
              out.push({ id, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, parent: parents[id] || (id.startsWith('chip-') ? 'chips-row' : id.startsWith('week-') ? 'week-strip' : id.startsWith('panel-') ? 'dock-expanded' : undefined) });
            });
            const ro = document.querySelector('[data-testid="frame-readout"]');
            if (ro) { const r = ro.getBoundingClientRect(); out.push({ id: 'frame-readout', rect: { x: r.x, y: r.y, w: r.width, h: r.height } }); }
            return out;
          }, parents);
          // 펼친 영역이 접혀 있으면(높이 0) 그 안 요소는 잘려 보이지 않으므로 뺀다.
          const ex = items.find(i => i.id === 'dock-expanded');
          const inEx = (i) => i.parent === 'dock-expanded' || i.parent === 'week-strip' || i.id === 'week-strip' || i.id === 'calendar' || i.id === 'sim-body';
          const shownItems = items.filter(i => !inEx(i) || (ex && ex.rect.h >= 1));
          const real = O.findOverlaps(shownItems);
          if (real.length) bad.push(`${vp.width}x${vp.height} ${lang} ${name}: ${J(real).slice(0, 160)}`);
          for (const it of shownItems) if (it.rect.x < -0.5 || it.rect.x + it.rect.w > vp.width + 0.5) outside.push(`${vp.width} ${lang} ${name} ${it.id} x ${it.rect.x.toFixed(0)} w ${it.rect.w.toFixed(0)}`);
          const ro = items.find(i => i.id === 'frame-readout'), hd = items.find(i => i.id === 'dock-handle');
          if (ro && hd && ro.rect.y + ro.rect.h > hd.rect.y + 1) bad.push(`${vp.width}x${vp.height} ${lang} ${name}: 읽음 줄이 손잡이 아래로 내려옴 (${(ro.rect.y + ro.rect.h).toFixed(0)} > ${hd.rect.y.toFixed(0)})`);
          n++;
          if (shots && vp.width === 390 && lang === 'en' && name.startsWith('sbx')) await shot(p, `9-en-${name}`);
          await ctx.close();
        }
    ok(bad.length === 0, `겹침 없음(${n} 조합)${bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''}`);
    ok(outside.length === 0, `요소가 모두 화면 안${outside.length ? ': ' + outside.slice(0, 4).join(' | ') : ''}`);
  }

  await b.close(); server.close();
  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n통과 — pass ${pass}`);
  process.exit(fail ? 1 : 0);
})();
