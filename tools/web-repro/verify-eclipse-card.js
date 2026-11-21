/**
 * **월식 이벤트 카드(`EclipseCard`)가 계산 값을 그대로 보이고 눌림이 움직이는지 웹 하네스(`eclipsecard:1`)에서 봅니다**(docs/SANDBOX_MODE_PLAN.md §23-6).
 * 계산은 `verify-eclipse-event.js` · `verify-eclipse-plan.js` 가 잰다. 여기서는 화면 글 · 펼침 · 유리 · 글자색 · 터치 크기 · 겹침을 본다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-21, 화면을 보기 전에 손계산으로 박았습니다)
 * 식: 2025-03-14 개기식, 가장 깊은 때 g = 06:58:41 UT, 개기 길이 65.4 분 → u2 = g − 32.7 분 ≈ 06:26 UT, u3 = g + 32.7 분 ≈ 07:31 UT, 반그림자 p1 = g − 181.3 분 ≈ 03:57 UT.
 * 하네스: 390 × 844, 연무 하늘, 한국어. 뉴욕(40.71, −74.0, 시간대 −4 = EDT), 지금 = g + `at` 분. 도쿄(35.68, 139.69, +9).
 *  1. 뉴욕 지금 = g(개기 한가운데): 카드 `eclipse-card` 유리(흐림 22 px). 제목 "월식 · 개기식", 상태 `eclipse-status` = "개기식 · 다음 부분식까지 M:SS"(남은 = u3 − g ≈ 32.7 분 → 30:00 ~ 35:00 사이의 "m:ss"), 노출 안내 `eclipse-advice` 는 개기 단계의 가장자리 ~ 가운데: "ISO 100 · 1/80 ~ ISO 100 · 1/5". 달이 식 내내 떠 있으므로 달 뜸 · 짐 줄 `eclipse-moon` 은 없다.
 *  2. 뉴욕 지금 = g − 240 분(식 시작 전, p1 − g = −181.3 분이라 시작까지 58.7 분): 상태는 "월식 시작까지 " 로 시작하고 남은 글이 "58:xx"(±2 분: 56:xx ~ 60:xx → 시간이 없는 "m:ss" 형식), 노출 안내는 첫 단계(반그림자)의 것 "ISO 100 · 1/4000".
 *  3. 시간표: 처음엔 `eclipse-table` 없음. "시간표" 칩(`eclipse-toggle`, aria-expanded false) 누르면 aria-expanded true · 5 줄 `eclipse-row-0..4`(반그림자 · 부분식 · 개기식 · 부분식 · 반그림자), 칩 글은 "접기". 개기 줄(2번)의 시각 "02:26–03:31"(EDT = UT − 4, ±1 분 허용: 02:25~02:27 시작, 03:30~03:32 끝), 모든 줄이 보이므로 "달이 지평선 아래" 글은 없다. 다시 누르면 접힌다.
 *  4. 도쿄 지금 = g + 110 분(+105 분에 달이 뜸, 단계는 u4 = g + 109.2 분 뒤의 반그림자): 켜짐. 줄 `eclipse-moon` = "달이 HH:mm 에 떠요"(HH:mm 은 g + 105 ± 12 분 = JST 17:31 ~ 17:55), 시간표 5 줄 중 앞 4 줄은 "달이 지평선 아래", 마지막 줄만 노출 안내(ISO 100 · 1/4000).
 *  5. 모양: 카드 안 모든 글자색 rgb(241, 245, 249). 단추(시간표)는 hitSlop 포함 40 px 이상. 카드는 화면 안, 안의 요소가 서로 겹치지 않음 — ko · en · ja × 390 × 844 · 360 × 740 × (접힘 · 펼침). 영어 · 일본어에서도 같은 값(남은 시간 · ISO · 셔터)이 보인다.
 *
 * 사용: sh tools/web-repro/build.sh && node tools/web-repro/verify-eclipse-card.js .harness/web-repro [그림 저장 폴더]
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
const TXT = 'rgb(241, 245, 249)';

(async () => {
  const O = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'layoutOverlap.js'));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const open = async (flags = {}, vp = { width: 390, height: 844 }) => {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 200)));
    const hash = JSON.stringify({ eclipsecard: 1, w: vp.width, h: vp.height, ...flags });
    await p.goto(`http://localhost:${server.address().port}/repro.html#${encodeURIComponent(hash)}`);
    await p.locator('[data-testid="eclipse-root"]').waitFor({ timeout: 90000 });
    await p.waitForTimeout(400);
    return { ctx, p };
  };
  const txt = (p, id) => p.locator(`[data-testid="${id}"]`).first().innerText();
  const count = (p, id) => p.locator(`[data-testid="${id}"]`).count();
  const attr = (p, id, a) => p.locator(`[data-testid="${id}"]`).first().getAttribute(a);
  const tap = async (p, id) => { await p.locator(`[data-testid="${id}"]`).first().click({ force: true }); await p.waitForTimeout(300); };
  const shot = async (p, name) => { if (shots) await p.screenshot({ path: path.join(shots, name + '.png') }); };
  const mmss = (s) => { const m = /(\d+):(\d\d)(?::(\d\d))?/.exec(s); return m ? (m[3] != null ? [+m[1], +m[2], +m[3]] : [0, +m[1], +m[2]]) : null; };

  console.log('[1] 뉴욕 개기 한가운데');
  { const { ctx, p } = await open({ at: 0 });
    ok(await count(p, 'eclipse-card') === 1, '카드가 있다');
    ok(/blur\(22px\)/.test(await p.locator('[data-testid="eclipse-card"]').first().evaluate(e => getComputedStyle(e).backdropFilter || '')), '흐림 22 px 유리');
    const body = await p.locator('body').innerText();
    ok(/월식 · 개기식/.test(body), '제목 "월식 · 개기식"');
    const s = await txt(p, 'eclipse-status'); const t = mmss(s);
    ok(/^개기식 · 다음 부분식까지 \d+:\d\d$/.test(s) && t && t[0] === 0 && t[1] >= 30 && t[1] <= 35, `상태 "${s}"(30:00 ~ 35:00)`);
    const a = await txt(p, 'eclipse-advice');
    ok(/ISO 100 · 1\/80 ~ ISO 100 · 1\/5$/.test(a), `노출 안내 "${a}"`);
    ok(await count(p, 'eclipse-moon') === 0, '달 뜸 · 짐 줄 없음');
    await shot(p, 'eclipse-total'); await ctx.close(); }

  console.log('\n[2] 뉴욕 식 시작 전');
  { const { ctx, p } = await open({ at: -240 });
    const s = await txt(p, 'eclipse-status'); const t = mmss(s);
    ok(/^월식 시작까지 \d+:\d\d$/.test(s) && t && t[0] === 0 && t[1] >= 56 && t[1] <= 60, `상태 "${s}"(56 ~ 60 분)`);
    const a = await txt(p, 'eclipse-advice');
    ok(/ISO 100 · 1\/4000$/.test(a), `노출 안내(반그림자) "${a}"`);
    await ctx.close(); }

  console.log('\n[3] 시간표 펼침');
  { const { ctx, p } = await open({ at: 0 });
    ok(await count(p, 'eclipse-table') === 0 && await attr(p, 'eclipse-toggle', 'aria-expanded') === 'false', '처음엔 접힘');
    await tap(p, 'eclipse-toggle');
    ok(await attr(p, 'eclipse-toggle', 'aria-expanded') === 'true' && await count(p, 'eclipse-row-4') === 1 && await count(p, 'eclipse-row-5') === 0, '누르면 5 줄');
    const names = []; for (let i = 0; i < 5; i++) names.push((await txt(p, `eclipse-row-${i}`)).split(/\s+/)[0]);
    ok(names.join() === '반그림자,부분식,개기식,부분식,반그림자', `줄 이름 ${names.join(' · ')}`);
    const r2 = await txt(p, 'eclipse-row-2');
    const m = /(\d\d):(\d\d)–(\d\d):(\d\d)/.exec(r2);
    const st = m ? +m[1] * 60 + +m[2] : -1, en = m ? +m[3] * 60 + +m[4] : -1;
    ok(!!m && st >= 2 * 60 + 25 && st <= 2 * 60 + 27 && en >= 3 * 60 + 30 && en <= 3 * 60 + 32, `개기 줄 시각 ${m && m[0]}(EDT 02:26–03:31 ±1 분)`);
    ok(!/지평선 아래/.test(await txt(p, 'eclipse-table')), '모든 줄이 보임: "달이 지평선 아래" 없음');
    ok(/접기/.test(await txt(p, 'eclipse-toggle')), '칩 글 "접기"');
    await shot(p, 'eclipse-table');
    await tap(p, 'eclipse-toggle');
    ok(await count(p, 'eclipse-table') === 0, '다시 누르면 접힘');
    await ctx.close(); }

  console.log('\n[4] 도쿄: 달이 식 도중에 뜬다');
  { const { ctx, p } = await open({ at: 110, lat: 35.68, lon: 139.69, tz: 9 });
    ok(await count(p, 'eclipse-card') === 1, '켜짐');
    const mo = await txt(p, 'eclipse-moon'); const m = /(\d\d):(\d\d)/.exec(mo);
    const mins = m ? +m[1] * 60 + +m[2] : -1;
    ok(/^달이 \d\d:\d\d 에 떠요$/.test(mo) && mins >= 17 * 60 + 31 && mins <= 17 * 60 + 55, `"${mo}"(JST 17:31 ~ 17:55)`);
    await tap(p, 'eclipse-toggle');
    const rows = []; for (let i = 0; i < 5; i++) rows.push(await txt(p, `eclipse-row-${i}`));
    ok(rows.slice(0, 4).every(r => /지평선 아래/.test(r)) && !/지평선 아래/.test(rows[4]) && /ISO 100 · 1\/4000/.test(rows[4]), '앞 4 줄은 "달이 지평선 아래", 마지막 줄만 노출 안내');
    await shot(p, 'eclipse-tokyo'); await ctx.close(); }

  console.log('\n[5] 모양 · 겹침');
  const bad = []; const colors = new Set(); let smallBtn = null, outside = [];
  for (const lang of ['ko', 'en', 'ja']) for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) for (const exp of [false, true]) {
    const { ctx, p } = await open({ at: 0, lang }, vp);
    if (exp) await tap(p, 'eclipse-toggle');
    const info = await p.evaluate(() => {
      const root = document.querySelector('[data-testid="eclipse-card"]');
      const cr = root.getBoundingClientRect();
      const items = [];
      root.querySelectorAll('[data-testid]').forEach(e => { const r = e.getBoundingClientRect(); items.push({ id: e.getAttribute('data-testid'), rect: { x: r.x, y: r.y, w: r.width, h: r.height } }); });
      const cols = []; root.querySelectorAll('*').forEach(e => { if (e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) cols.push(getComputedStyle(e).color); });
      const tg = document.querySelector('[data-testid="eclipse-toggle"]').getBoundingClientRect();
      return { items, cols, card: { x: cr.x, y: cr.y, w: cr.width, h: cr.height }, tg: { w: tg.width, h: tg.height }, vw: innerWidth, vh: innerHeight };
    });
    // 칩 눌림 영역 = 28 + hitSlop 12
    if (info.tg.h + 12 < 40) smallBtn = info.tg;
    info.cols.forEach(c => colors.add(c));
    if (info.card.x < 0 || info.card.y < 0 || info.card.x + info.card.w > info.vw || info.card.y + info.card.h > info.vh) outside.push(`${lang}/${vp.width}/${exp}`);
    // 부모(card) 는 자식과 겹쳐도 센다 안 함: 안의 줄만 비교
    const flat = info.items.filter(i => i.id !== 'eclipse-card' && i.id !== 'eclipse-table').map(i => ({ id: i.id, rect: i.rect, parent: undefined }));
    // 시간표 줄의 안 요소는 data-testid 가 없어 줄끼리만 비교됨
    const ov = O.findOverlaps(flat);
    if (ov.length) bad.push(`${lang}/${vp.width}/${exp}: ${JSON.stringify(ov)}`);
    await ctx.close();
  }
  ok([...colors].every(c => c === TXT), `카드 안 모든 글자색 #F1F5F9: ${JSON.stringify([...colors])}`);
  ok(!smallBtn, `시간표 칩 눌림 영역 40 px 이상(hitSlop 포함)${smallBtn ? ' — ' + JSON.stringify(smallBtn) : ''}`);
  ok(outside.length === 0, `카드가 화면 안(${outside.join(', ') || '12 조합'})`);
  ok(bad.length === 0, `겹침 없음(12 조합)${bad.length ? ': ' + bad.join(' | ') : ''}`);
  { const { ctx, p } = await open({ at: 0, lang: 'en' });
    ok(/Lunar eclipse · Total/.test(await p.locator('body').innerText()) && /Total · Partial in \d+:\d\d/.test(await txt(p, 'eclipse-status')) && /ISO 100 · 1\/80 ~ ISO 100 · 1\/5/.test(await txt(p, 'eclipse-advice')), '영어: 제목 · 상태 · 같은 노출 값');
    await ctx.close(); }
  { const { ctx, p } = await open({ at: 0, lang: 'ja' });
    ok(/月食 · 皆既食/.test(await p.locator('body').innerText()) && /ISO 100 · 1\/80 ~ ISO 100 · 1\/5/.test(await txt(p, 'eclipse-advice')), '일본어: 제목 · 같은 노출 값');
    await ctx.close(); }

  await b.close(); server.close();
  console.log(fail ? `\n실패 있음 — pass ${pass} / fail ${fail}` : `\n모두 통과 — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
