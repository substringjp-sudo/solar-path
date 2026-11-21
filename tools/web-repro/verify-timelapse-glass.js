/**
 * **타임랩스 설정 시트(`TimelapsePanel`)와 촬영 중 카드(`TimelapseRunCard` + `RunExtras`)의 유리 모양이 누른 대로 움직이는지 웹 하네스(`tlglass:1`)에서 봅니다**(docs/SANDBOX_MODE_PLAN.md 23절).
 * 계산은 `verify-timelapse-plan.js` · `verify-run-card.js` · `verify-exposure-advice.js` 가 잽니다. 여기서는 화면이 그 값을 보이고 눌림이 전달되는지, 유리 · 글자색 · 터치 크기를 봅니다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 구현보다 먼저 박았습니다)
 * 하네스: 390 × 844, 밝은 하늘(연무), 한국어, 일몰 17:17 KST(= 08:17 UTC), 지금 16:17. 일어난 일은 `window.__tl` = { previews, starts, closes, finishes, dismisses, screenOffs }.
 *  1. 시트(`view: sheet`): `tl-sheet` 가 흐림 22 px 유리(backdrop-filter). 칩: 종류 3(일반 · 밝게 합성 · 궤적 누적), 구간 3(일몰 60분 · 일출 60분 · 낮에서 밤으로 150분), 영상 길이 4(5 · 10 · 20 · 30초). 켜진 칩은 하나씩(aria-pressed): 처음은 일반 · 일몰 60분 · 10초.
 *     값 칸(일몰 60분 · 10초 · 30 fps · 일반): **간격 12 s · 찍는 장 301 · 영상 10 s · 저장 301**(`verify-timelapse-plan` 기준과 같음). 부제 "일반 · 16:57 ~ 17:57"(일몰 17:17 −20 ~ +40분). 요약 "시작 16:57 · 촬영 60분 · 저장 약 903 MB". "가장 붉을 때 16:57 ~ 17:27", "낮은 구름 두꺼움 16:47 ~ 17:07"(하네스가 준 구간) · "밝기 −" 로 시작하는 예측 노출 줄과 "맑은 하늘 기준 어림".
 *  2. 시트 누름: "20초" → 값 칸이 간격 6 s · 찍는 장 601 · 영상 20 s · 저장 601. "밝게 합성" → "4장씩" 칩 줄이 나타나고 값 칸 저장 = ceil(찍는 장 ÷ 4). "일출 60분" 은 하네스에 일출이 없어 "지금부터 60분"(부제). "미리보기" → previews 1(영상 길이 · 시작 · 끝 전달), "지금 시작" → starts 1, 닫기(X) → closes 1.
 *  3. 시트 모양: 시트 높이는 화면의 80 % 이하, 시트 안 모든 글자색은 rgb(241, 245, 249)(#F1F5F9 — 하늘색 · 흐린 회색 글자 없음). 손가락으로 누르는 단추는 모두 40 px 이상(칩은 hitSlop 위아래 6 · 좌우 4 를 더해서, 아래 "미리보기" · "지금 시작" 은 44). 360 × 740 에서도 시트 안 "지금 시작" 까지 스크롤로 닿는다(안 잘림).
 *  4. 촬영 중 카드(`view: run`, 찍는 중): `tl-run` 유리, "REC" 있음, "마치기" 칩(`tl-finish`), 값 칸 "37/301" · "12:31" · "37", 밝기 곡선(svg, 점선 예측 + 실선 실제), 배터리 "배터리 62%", "화면 끄고 계속" 칩, 알림 "화면을 켜 두세요". 마치기를 누르면 finishes 1, "화면 끄고 계속" → screenOffs 1.
 *     끝난 뒤(`running: 0`): "REC" 없음, "마치기" · "화면 끄고 계속" 없음, 닫기(X) 칩 `tl-dismiss` → dismisses 1, 알림 "타임랩스 끝 · 37장 앨범에 저장". 멈춤(`err: 1`, 끝남): 알림 "타임랩스가 멈췄어요 · 37장 찍음".
 *     배터리 부족(`lowbat: 1`): "⚠ 배터리 8% · 절전 모드 · 배터리가 부족해요".
 *  5. 카드 모양: 카드 안 모든 글자색 rgb(241, 245, 249). 단추(마치기 · 닫기 · 화면 끄고 계속)는 hitSlop 포함 40 px 이상. 카드 안 요소(제목 줄 · 값 칸 셋 · 곡선 · 배터리 · 화면 끄고 계속 · 알림)가 서로 겹치지 않음 — ko · en · ja × 390 × 844 · 360 × 740.
 *
 * 사용: sh tools/web-repro/build.sh && node tools/web-repro/verify-timelapse-glass.js .harness/web-repro [그림 저장 폴더]
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
const TXT = 'rgb(241, 245, 249)';

(async () => {
  const O = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'layoutOverlap.js'));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const open = async (flags = {}, vp = { width: 390, height: 844 }) => {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 200)));
    const hash = JSON.stringify({ tlglass: 1, w: vp.width, h: vp.height, ...flags });
    await p.goto(`http://localhost:${server.address().port}/repro.html#${encodeURIComponent(hash)}`);
    await p.locator('[data-testid="tlglass-root"]').waitFor({ timeout: 90000 });
    await p.waitForTimeout(500);
    return { ctx, p };
  };
  const st = (p) => p.evaluate(() => JSON.parse(JSON.stringify(globalThis.__tl)));
  const body = (p) => p.locator('body').innerText();
  const rect = async (p, id) => { const l = p.locator(`[data-testid="${id}"]`).first(); if (!(await l.count())) return null; return await l.evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }); };
  const has = async (p, id) => { const r = await rect(p, id); return !!r && r.w > 0 && r.h > 0; };
  const attr = (p, id, a) => p.locator(`[data-testid="${id}"]`).first().getAttribute(a);
  const shot = async (p, name) => { if (shots) await p.screenshot({ path: path.join(shots, name + '.png') }); };
  const tap = async (p, id) => { await p.locator(`[data-testid="${id}"]`).first().click({ force: true }); await p.waitForTimeout(400); };
  const cellsText = async (p) => (await p.locator('[data-testid="tl-card"]').innerText()).replace(/\n+/g, ' ');
  const colorsIn = (p, id) => p.locator(`[data-testid="${id}"]`).first().evaluate(root => { const out = new Set(); const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.textContent.trim()) continue; out.add(getComputedStyle(n.parentElement).color); } return [...out]; });
  const smallBtns = (p, rootId) => p.locator(`[data-testid="${rootId}"] [role="button"]`).evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); const id = e.getAttribute('data-testid') || e.getAttribute('aria-label'); const chip = !(id === 'tl-preview' || id === 'tl-start'); return { id, w: r.width + (chip ? 8 : 0), h: r.height + (chip ? 12 : 0) }; }).filter(r => r.w > 0 && (r.w < 40 || r.h < 40)));

  console.log('\n[1] 시트: 처음');
  {
    const { ctx, p } = await open();
    const bf = await p.locator('[data-testid="tl-sheet"]').evaluate(e => { const c = getComputedStyle(e); return c.backdropFilter || c.webkitBackdropFilter; });
    ok(/blur\(22px\)/.test(bf), `시트는 흐림 유리(${bf})`);
    const ids = ['tl-kind-plain', 'tl-kind-stacked', 'tl-kind-trail', 'tl-preset-sunset', 'tl-preset-sunrise', 'tl-preset-day-to-night', 'tl-video-5', 'tl-video-10', 'tl-video-20', 'tl-video-30'];
    const pr = await Promise.all(ids.map(id => attr(p, id, 'aria-pressed')));
    ok(pr.every(v => v !== null) && J(pr.map(v => v === 'true')) === J([true, false, false, true, false, false, false, true, false, false]), `칩 10개, 켜진 것: 일반 · 일몰 60분 · 10초 ${J(pr)}`);
    const t = await cellsText(p);
    ok(/간격\s*12 s/.test(t) && /찍는 장\s*301/.test(t) && /영상\s*10 s/.test(t) && /저장\s*301/.test(t), `값 칸: ${t.slice(0, 40)}`);
    const all = await body(p);
    ok(all.includes('일반 · 16:57 ~ 17:57') && t.includes('시작 16:57 · 촬영 60분 · 저장 약 903 MB'), '부제 "일반 · 16:57 ~ 17:57", 요약 "시작 16:57 · 촬영 60분 · 저장 약 903 MB"');
    ok(t.includes('가장 붉을 때 16:57 ~ 17:27') && t.includes('낮은 구름 두꺼움 16:47 ~ 17:07') && /밝기 [−+]\d+\.\d단/.test(t) && t.includes('맑은 하늘 기준 어림'), '붉을 때 · 낮은 구름 · 예측 노출 줄(맑은 하늘 기준 어림)');
    await shot(p, '1-sheet');
    await ctx.close();
  }

  console.log('\n[2] 시트: 누름');
  {
    const { ctx, p } = await open();
    await tap(p, 'tl-video-20');
    let t = await cellsText(p);
    ok(/간격\s*6 s/.test(t) && /찍는 장\s*601/.test(t) && /영상\s*20 s/.test(t) && /저장\s*601/.test(t), `20초: ${t.slice(0, 40)}`);
    await tap(p, 'tl-kind-stacked');
    ok(await has(p, 'tl-stack-4') && (await attr(p, 'tl-kind-stacked', 'aria-pressed')) === 'true', '"밝게 합성" → "4장씩" 칩 줄이 나타남');
    t = await cellsText(p);
    const m = t.match(/찍는 장\s*(\d+)/), sv = t.match(/저장\s*(\d+)/);
    ok(!!m && !!sv && Number(sv[1]) === Math.ceil(Number(m[1]) / 4), `밝게 합성 4장씩: 찍는 ${m && m[1]} → 저장 ${sv && sv[1]} = ceil(÷4)`);
    await tap(p, 'tl-kind-plain');
    await tap(p, 'tl-preset-sunrise');
    ok((await body(p)).includes('지금부터 60분'), '"일출 60분" 은 일출 시각이 없어 "지금부터 60분"');
    await tap(p, 'tl-preview'); await tap(p, 'tl-start'); await tap(p, 'tl-close');
    const s = await st(p);
    ok(s.previews.length === 1 && s.previews[0].sec > 0 && s.previews[0].endMs > s.previews[0].startMs && s.starts.length === 1 && s.closes >= 1, `미리보기 ${J(s.previews)} · 시작 ${J(s.starts)} · 닫기 ${s.closes}`);
    await ctx.close();
  }

  console.log('\n[3] 시트 모양');
  {
    const { ctx, p } = await open();
    const sh = await rect(p, 'tl-sheet');
    ok(sh.h <= 844 * 0.8 + 1, `시트 높이 ${sh.h.toFixed(0)} ≤ 80 % (${(844 * 0.8).toFixed(0)})`);
    const cols = await colorsIn(p, 'tl-sheet');
    ok(cols.every(c => c === TXT), `시트 안 모든 글자 #F1F5F9: ${J(cols)}`);
    const small = await smallBtns(p, 'tl-sheet');
    ok(small.length === 0, `단추는 모두 40 px 이상(hitSlop 포함, 작은 것 ${J(small)})`);
    await ctx.close();
    const q = await open({}, { width: 360, height: 740 });
    await q.p.locator('[data-testid="tl-start"]').scrollIntoViewIfNeeded();
    const r = await rect(q.p, 'tl-start');
    ok(r && r.y + r.h <= 740 + 0.5 && r.y >= 0, `360 × 740: 스크롤하면 "지금 시작" 이 화면 안(y ${r && r.y.toFixed(0)})`);
    await shot(q.p, '3-sheet-360');
    await q.ctx.close();
  }

  console.log('\n[4] 촬영 중 카드');
  {
    const { ctx, p } = await open({ view: 'run' });
    const t = await body(p);
    ok(await has(p, 'tl-run') && t.includes('REC') && await has(p, 'tl-finish') && !(await has(p, 'tl-dismiss')), '유리 카드, REC, 마치기(닫기는 없음)');
    ok((await p.locator('[data-testid="tl-cell-taken"]').innerText()).includes('37/301') && (await p.locator('[data-testid="tl-cell-left"]').innerText()).includes('12:31') && (await p.locator('[data-testid="tl-cell-album"]').innerText()).includes('37'), '값 칸 37/301 · 12:31 · 37');
    const svgOk = await p.locator('[data-testid="tl-run"] svg polyline').evaluateAll(els => els.length === 2 && els.some(e => e.getAttribute('stroke-dasharray')) && els.some(e => !e.getAttribute('stroke-dasharray')));
    ok(svgOk, '밝기 곡선: 점선(예측) + 실선(실제)');
    ok(t.includes('배터리 62%') && (await has(p, 'run-screen-off')) && (await p.locator('[data-testid="tl-note"]').innerText()).includes('화면을 켜 두세요'), '배터리 62% · 화면 끄고 계속 · 알림 "화면을 켜 두세요"');
    await tap(p, 'tl-finish'); await tap(p, 'run-screen-off');
    const s = await st(p);
    ok(s.finishes === 1 && s.screenOffs === 1, `마치기 ${s.finishes} · 화면 끄고 계속 ${s.screenOffs}`);
    await shot(p, '4-run');
    await ctx.close();
    const d = await open({ view: 'run', running: 0 });
    const td = await body(d.p);
    ok(!td.includes('REC') && !(await has(d.p, 'tl-finish')) && !(await has(d.p, 'run-screen-off')) && await has(d.p, 'tl-dismiss') && (await d.p.locator('[data-testid="tl-note"]').innerText()).includes('타임랩스 끝 · 37장 앨범에 저장'), '끝난 뒤: REC · 마치기 · 화면 끄고 계속 없음, 닫기, "타임랩스 끝 · 37장 앨범에 저장"');
    await tap(d.p, 'tl-dismiss');
    ok((await st(d.p)).dismisses === 1, '닫기 → dismisses 1');
    await d.ctx.close();
    const e = await open({ view: 'run', running: 0, err: 1 });
    ok((await e.p.locator('[data-testid="tl-note"]').innerText()).includes('타임랩스가 멈췄어요 · 37장 찍음'), '멈춤 알림 "타임랩스가 멈췄어요 · 37장 찍음"');
    await e.ctx.close();
    const lb = await open({ view: 'run', lowbat: 1 });
    ok((await lb.p.locator('[data-testid="run-battery"]').innerText()).includes('⚠ 배터리 8% · 절전 모드 · 배터리가 부족해요'), '배터리 부족 "⚠ 배터리 8% · 절전 모드 · 배터리가 부족해요"');
    await lb.ctx.close();
  }

  console.log('\n[5] 카드 모양 · 겹침');
  {
    const { ctx, p } = await open({ view: 'run' });
    const cols = await colorsIn(p, 'tl-run');
    ok(cols.every(c => c === TXT), `카드 안 모든 글자 #F1F5F9: ${J(cols)}`);
    const small = await p.locator('[data-testid="tl-run"] [role="button"]').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { id: e.getAttribute('data-testid'), w: r.width + 8, h: r.height + 12 }; }).filter(r => r.w < 40 || r.h < 40));
    ok(small.length === 0, `카드의 단추는 hitSlop 포함 40 px 이상(작은 것 ${J(small)})`);
    await ctx.close();
    const parents = { 'tl-finish': 'tl-run', 'tl-dismiss': 'tl-run', 'tl-cell-taken': 'tl-run', 'tl-cell-left': 'tl-run', 'tl-cell-album': 'tl-run', 'run-battery': 'tl-run', 'run-screen-off': 'tl-run', 'tl-note': 'tl-run' };
    let bad = [], n = 0;
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 740 }])
      for (const lang of ['ko', 'en', 'ja'])
        for (const flags of [{}, { running: 0 }, { lowbat: 1 }]) {
          const q = await open({ view: 'run', lang, ...flags }, vp);
          const items = await q.p.evaluate((parents) => ['tl-run', 'tl-finish', 'tl-dismiss', 'tl-cell-taken', 'tl-cell-left', 'tl-cell-album', 'run-battery', 'run-screen-off', 'tl-note'].map(id => { const e = document.querySelector(`[data-testid="${id}"]`); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null; return { id, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, parent: parents[id] }; }).filter(Boolean), parents);
          const real = O.findOverlaps(items);
          if (real.length) bad.push(`${vp.width}x${vp.height} ${lang} ${J(flags)}: ${J(real).slice(0, 120)}`);
          for (const it of items) if (it.rect.x < -0.5 || it.rect.x + it.rect.w > vp.width + 0.5) bad.push(`${vp.width} ${lang} ${it.id} 화면 밖`);
          n++;
          await q.ctx.close();
        }
    ok(bad.length === 0, `겹침 없음 · 화면 안(${n} 조합)${bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''}`);
  }

  await b.close(); server.close();
  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n통과 — pass ${pass}`);
  process.exit(fail ? 1 : 0);
})();
