/**
 * **카메라의 새 틀(`AstroCamera/CameraFrame`)이 누른 대로 움직이는지 웹 하네스(`camframe:1`)에서 봅니다**(docs/SANDBOX_MODE_PLAN.md 17절 4번 · 23절). 가짜 카메라 위에 올립니다.
 * 계산(단계 · 모드 줄 · 시간 자)은 `verify-dock-stages` · `verify-mode-strip` · `verify-time-ruler` 가 잽니다. 여기서는 부품이 **카메라의 칩 · 셔터 · 시간 자 자리에서 맞게 놓이고 눌림이 전달되는지**를 봅니다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 하네스: 390 × 844, 밝은 하늘(연무), 한국어. 일어난 일은 `window.__cam` = { zoom, view, shutter, lock, picks, times, commits, nows, dock, drawer }.
 *  1. 처음(사진 · 실제 카메라): 글에 "1×" "2×" "3×" "5×" "노출" "시뮬레이션" "샌드박스" "사진" "천체" "타임랩스"가 있다(사진에서 타임랩스는 두 칸 옆이라 줄 안에 흐리게 보임 — 처음에 "줄 밖"이라고 적었으나 줄 밖인 것은 네 칸 이상 떨어진 시뮬레이션 모드일 때만이라 기준이 틀렸음). **시간 자는 없다**(실제 카메라는 지금 시각이라 바꿀 수 없음: `ruler-track` 없음).
 *     손잡이 이름 "펼치기". 손가락으로 누르는 단추(손잡이 제외)는 모두 40 px 이상 — 칩은 눌림 영역(`hitSlop` 위아래 6 · 좌우 4)을 더해서 잰다(칩 28 px + 12 = 40). 셔터 줄: 셔터 링 78 × 78(하늘 화면 새 틀과 같음), 왼쪽 · 오른쪽 둥근 칩은 48 × 48.
 *  2. 줌 칩: "2×" 를 누르면 zoom 2, "2×" 만 aria-pressed 가 참.
 *  3. 노출 칩: 누르면 `panel-exposure` 가 펼쳐져(막대 단계 mid) "ISO" · "셔터" · "WB" · "추천 · 맑은 하늘 기준 어림"이 보이고 칩의 aria-expanded 가 참. 다시 누르면 접혀 패널이 안 보인다.
 *  4. 보기 전환: 왼쪽 둥근 칩을 누르면 view = blend 이고 **시간 자가 나타난다**(`ruler-track`). 자를 오른쪽으로 72 px 끌면 times 끝 = 처음 시각 − 1 시간(72 px = 1 시간), 놓으면 commits 1. "지금" 이 나타나 누르면 nows 1 이고 시각이 처음으로.
 *     한 번 더 누르면 sim(자 유지), 또 누르면 camera(자 사라짐).
 *  5. 셔터 · 오른쪽 칩: 셔터를 누르면 shutter 1, 오른쪽 둥근 칩(방향 고정)을 누르면 lock 1.
 *  6. 모드 줄: "천체" 를 누르면 picks 끝 = astro. (모드 줄이 하는 일은 `verify-mode-strip` 이 잼.)
 *  7. 천체 탭(`tab: astro`): 셔터 안쪽 색이 달빛 색 rgb(203, 213, 225), 칩 "설정" 을 누르면 drawer 1(기존 천체 설정 열기 호출), 모드 줄의 선택은 "천체".
 *  8. 막대 높이 알림: `onDockHeight` 가 고정부 높이 + 손잡이 줄 28 을 알린다 — 값이 `dock-fixed` 의 잰 높이 + 28 과 ±1 px 로 같다. (막대 위에 떠 있는 것을 올리는 데 씀.)
 *  9. 겹침: 언어 ko · en · ja × 화면 390 × 844 · 360 × 740 × 상태 { 사진 · 카메라 접힘, 사진 · 노출 펼침, 사진 · 겹침(자 보임) 접힘, 사진 · 3D 접힘, 천체 · 카메라 접힘 } 에서 `findOverlaps` 가 빈 목록(칩 줄과 칩 · 자 왼쪽 · 시각 숫자 · 지금 · 자 · 셔터 줄 · 둥근 칩 · 셔터 · 모드 줄 · 펼친 칸). 모든 요소는 화면 안.
 *  10. 글자색 · 재질: 화면의 모든 글자는 계산된 색이 rgb(241, 245, 249)(하늘색 글자 없음, 단 하네스가 단 "카메라 …" 안내 글 제외). 칩 줄의 유리 칠은 흐림 22 px(`backdrop-filter`).
 *
 * 사용: sh tools/web-repro/build.sh && node tools/web-repro/verify-camera-frame.js .harness/web-repro [그림 저장 폴더]
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
const C = Date.UTC(2026, 10, 21, 8, 4), HOUR = 3600000;

(async () => {
  const O = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'layoutOverlap.js'));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const open = async (flags = {}, vp = { width: 390, height: 844 }) => {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 200)));
    const hash = JSON.stringify({ camframe: 1, w: vp.width, h: vp.height, ...flags });
    await p.goto(`http://localhost:${server.address().port}/repro.html#${encodeURIComponent(hash)}`);
    await p.locator('[data-testid="camframe-root"]').waitFor({ timeout: 90000 });
    await p.waitForTimeout(400);
    return { ctx, p };
  };
  const st = (p) => p.evaluate(() => JSON.parse(JSON.stringify(globalThis.__cam)));
  const body = (p) => p.locator('body').innerText();
  const rect = async (p, id) => { const l = p.locator(`[data-testid="${id}"]`).first(); if (!(await l.count())) return null; return await l.evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }); };
  const has = async (p, id) => { const r = await rect(p, id); return !!r && r.w > 0 && r.h > 0; };
  const attr = (p, id, a) => p.locator(`[data-testid="${id}"]`).first().getAttribute(a);
  const shot = async (p, name) => { if (shots) await p.screenshot({ path: path.join(shots, name + '.png') }); };
  const tap = async (p, id) => { await p.locator(`[data-testid="${id}"]`).first().click({ force: true }); await p.waitForTimeout(450); };
  const drag = async (p, from, dx, steps = 10) => { await p.mouse.click(5, 300); await p.waitForTimeout(150); await p.mouse.move(from.x, from.y); await p.mouse.down(); for (let i = 1; i <= steps; i++) { await p.mouse.move(from.x + (dx * i) / steps, from.y); await p.waitForTimeout(20); } await p.mouse.up(); await p.waitForTimeout(450); };

  console.log('\n[1] 처음(사진 · 실제 카메라)');
  {
    const { ctx, p } = await open();
    const t = await body(p);
    ok(['1×', '2×', '3×', '5×', '노출', '시뮬레이션', '샌드박스', '사진', '천체'].every(w => t.includes(w)) && t.includes('타임랩스'), `글 확인: ${t.replace(/\n+/g, ' ').slice(0, 70)}`);
    ok(!(await has(p, 'ruler-track')), '실제 카메라에는 시간 자가 없다');
    ok((await attr(p, 'dock-handle', 'aria-label')) === '펼치기', '손잡이 이름 "펼치기"');
    const small = await p.locator('[role="button"]').evaluateAll(els => els.filter(e => e.getAttribute('data-testid') !== 'dock-handle').map(e => { const r = e.getBoundingClientRect(); const chip = (e.getAttribute('data-testid') || '').startsWith('chip-'); return { id: e.getAttribute('data-testid') || e.getAttribute('aria-label'), w: r.width + (chip ? 8 : 0), h: r.height + (chip ? 12 : 0) }; }).filter(r => r.w > 0 && (r.w < 40 || r.h < 40)));
    ok(small.length === 0, `손가락으로 누르는 단추는 모두 40 px 이상(작은 것 ${J(small)})`);
    const sh = await rect(p, 'shutter'), vt = await rect(p, 'view-toggle'), lk = await rect(p, 'lock');
    ok(Math.abs(sh.w - 78) < 1 && Math.abs(sh.h - 78) < 1 && Math.abs(vt.w - 48) < 1 && Math.abs(lk.h - 48) < 1, `셔터 ${sh.w.toFixed(0)}×${sh.h.toFixed(0)}(78) · 둥근 칩 ${vt.w.toFixed(0)}×${lk.h.toFixed(0)}(48)`);
    await shot(p, '1-photo');
    await ctx.close();
  }

  console.log('\n[2] 줌 칩');
  {
    const { ctx, p } = await open();
    await tap(p, 'chip-zoom-2');
    const s = await st(p);
    const pr = await Promise.all([1, 2, 3, 5].map(m => attr(p, `chip-zoom-${m}`, 'aria-pressed')));
    ok(s.zoom === 2 && J(pr) === J(['false', 'true', 'false', 'false']), `zoom ${s.zoom}, 눌림 ${J(pr)}`);
    await ctx.close();
  }

  console.log('\n[3] 노출 칩');
  {
    const { ctx, p } = await open();
    await tap(p, 'chip-exposure');
    const t = await body(p);
    ok(await has(p, 'panel-exposure') && ['ISO', '셔터', 'WB', '추천 · 맑은 하늘 기준 어림'].every(w => t.includes(w)) && (await attr(p, 'chip-exposure', 'aria-expanded')) === 'true', '노출 패널이 펼쳐지고 칩이 expanded');
    await tap(p, 'chip-exposure');
    ok(!(await has(p, 'panel-exposure')) && (await attr(p, 'chip-exposure', 'aria-expanded')) === 'false', '다시 누르면 접힘');
    await ctx.close();
  }

  console.log('\n[4] 보기 전환과 시간 자');
  {
    const { ctx, p } = await open();
    await tap(p, 'view-toggle');
    let s = await st(p);
    ok(s.view === 'blend' && await has(p, 'ruler-track'), `view ${s.view}, 시간 자 나타남`);
    const tr = await rect(p, 'ruler-track');
    await drag(p, { x: tr.x + tr.w / 2, y: tr.y + tr.h / 2 }, 72);
    s = await st(p);
    ok(s.times.length > 0 && Math.abs(s.times[s.times.length - 1] - (C - HOUR)) <= 5 * 60000 && s.commits === 1, `자를 72 px 끌면 한 시간 전 근처: ${new Date(s.times[s.times.length - 1] || 0).toISOString().slice(11, 16)} (기준 07:04 UTC ± 5분), commits ${s.commits}`);
    ok(await has(p, 'ruler-now'), '"지금" 이 나타남');
    await tap(p, 'ruler-now');
    s = await st(p);
    ok(s.nows === 1 && s.timeMs === C, `"지금" → nows ${s.nows}, 시각 처음으로`);
    await tap(p, 'view-toggle');
    s = await st(p);
    ok(s.view === 'sim' && await has(p, 'ruler-track'), `한 번 더: view ${s.view}, 자 유지`);
    await tap(p, 'view-toggle');
    s = await st(p);
    ok(s.view === 'camera' && !(await has(p, 'ruler-track')), `또 한 번: view ${s.view}, 자 사라짐`);
    await ctx.close();
  }

  console.log('\n[5] 셔터 · 방향 고정');
  {
    const { ctx, p } = await open();
    await tap(p, 'shutter'); await tap(p, 'lock');
    const s = await st(p);
    ok(s.shutter === 1 && s.lock === 1, `셔터 ${s.shutter} · 방향 고정 ${s.lock}`);
    await ctx.close();
  }

  console.log('\n[6] 모드 줄');
  {
    const { ctx, p } = await open();
    await tap(p, 'mode-astro');
    const s = await st(p);
    ok(s.picks[s.picks.length - 1] === 'astro', `picks ${J(s.picks)}`);
    await ctx.close();
  }

  console.log('\n[7] 천체 탭');
  {
    const { ctx, p } = await open({ tab: 'astro', sky: 'night' });
    const bg = await p.locator('[data-testid="shutter"] > div').first().evaluate(e => getComputedStyle(e).backgroundColor);
    ok(bg === 'rgb(203, 213, 225)', `셔터 안쪽 달빛 색 ${bg}`);
    await tap(p, 'chip-astro');
    const s = await st(p);
    ok(s.drawer === 1, `"설정" → 기존 천체 설정 열기 호출 ${s.drawer}`);
    const sel = await p.locator('[data-testid="mode-astro"]').first().getAttribute('aria-selected');
    ok(sel === 'true' || (await body(p)).includes('천체'), `모드 줄의 선택은 천체(aria-selected ${sel})`);
    await ctx.close();
  }

  console.log('\n[8] 막대 높이 알림');
  {
    const { ctx, p } = await open();
    const s = await st(p), fx = await rect(p, 'dock-fixed');
    ok(s.dock > 100 && Math.abs(s.dock - (Math.round(fx.h) + 28)) <= 1, `알린 높이 ${s.dock} = 고정부 ${fx.h.toFixed(0)} + 28`);
    await ctx.close();
  }

  console.log('\n[9] 겹침');
  {
    const parents = { 'chips-row': 'dock-fixed', 'ruler-date-swipe': 'dock-fixed', 'ruler-date': 'ruler-date-swipe', 'ruler-digits': 'dock-fixed', 'ruler-now': 'dock-fixed', 'ruler-track': 'dock-fixed', 'ruler-band': 'ruler-track', 'shutter-row': 'dock-fixed', 'mode-strip': 'dock-fixed', 'view-toggle': 'shutter-row', lock: 'shutter-row', shutter: 'shutter-row', 'dock-handle': 'dock', 'dock-expanded': 'dock', 'dock-fixed': 'dock' };
    const states = [
      ['photo-camera', {}, []],
      ['photo-exposure', {}, ['chip-exposure']],
      ['photo-blend', {}, ['view-toggle']],
      ['photo-sim', {}, ['view-toggle', 'view-toggle']],
      ['astro-camera', { tab: 'astro', sky: 'night' }, []],
    ];
    let bad = [], outside = [], n = 0;
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 740 }])
      for (const lang of ['ko', 'en', 'ja'])
        for (const [name, flags, taps] of states) {
          const { ctx, p } = await open({ lang, ...flags }, vp);
          for (const id of taps) await tap(p, id);
          const items = await p.evaluate((parents) => {
            const out = [];
            document.querySelectorAll('[data-testid]').forEach(e => {
              const id = e.getAttribute('data-testid');
              if (id === 'camframe-root' || id === 'dock' || (id.startsWith('mode-') && id !== 'mode-strip')) return;
              const r = e.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return;
              out.push({ id, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, parent: parents[id] || (id.startsWith('chip-') ? 'chips-row' : id.startsWith('panel-') ? 'dock-expanded' : undefined) });
            });
            return out;
          }, parents);
          const ex = items.find(i => i.id === 'dock-expanded');
          const shown = items.filter(i => !(i.parent === 'dock-expanded') || (ex && ex.rect.h >= 1));
          const real = O.findOverlaps(shown);
          if (real.length) bad.push(`${vp.width}x${vp.height} ${lang} ${name}: ${J(real).slice(0, 160)}`);
          for (const it of shown) if (it.rect.x < -0.5 || it.rect.x + it.rect.w > vp.width + 0.5) outside.push(`${vp.width} ${lang} ${name} ${it.id} x ${it.rect.x.toFixed(0)} w ${it.rect.w.toFixed(0)}`);
          n++;
          if (shots && vp.width === 390 && lang === 'ko') await shot(p, `9-${name}`);
          await ctx.close();
        }
    ok(bad.length === 0, `겹침 없음(${n} 조합)${bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''}`);
    ok(outside.length === 0, `요소가 모두 화면 안${outside.length ? ': ' + outside.slice(0, 4).join(' | ') : ''}`);
  }

  console.log('\n[10] 글자색 · 재질');
  {
    const { ctx, p } = await open();
    const colors = await p.evaluate(() => { const out = new Set(); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.textContent.trim() || n.textContent.startsWith('카메라 ')) continue; out.add(getComputedStyle(n.parentElement).color); } return [...out]; });
    ok(colors.every(c => c === 'rgb(241, 245, 249)'), `모든 글자가 #F1F5F9: ${J(colors)}`);
    const bf = await p.locator('[data-testid="chip-zoom-1"] > div').first().evaluate(e => { const c = getComputedStyle(e); return c.backdropFilter || c.webkitBackdropFilter; });
    ok(/blur\(22px\)/.test(bf), `칩 유리 흐림 ${bf}`);
    await ctx.close();
  }

  await b.close(); server.close();
  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n통과 — pass ${pass}`);
  process.exit(fail ? 1 : 0);
})();
