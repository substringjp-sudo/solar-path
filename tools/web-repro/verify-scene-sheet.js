/**
 * **장면 저장 줄과 저장한 장면 시트를 웹 하네스(`scenes:1`)에서 손가락(마우스)으로 확인합니다**(docs/SANDBOX_MODE_PLAN.md 12.3, 목업 2번 · 20번).
 * 저장소 대신 하네스의 상태에 목록을 두고, 화면이 부른 일은 `window.__scenes` 에 남습니다: {list, opened: [id …], saves: [이름 …], results: […]}. 계산(요약 글 · 이름 · 목록 규칙)은
 * `tools/shader-preview/verify-saved-scenes.js` 가 잽니다. 여기서는 **화면이 그 계산을 제대로 보여 주고 누른 대로 움직이는지**를 봅니다.
 *
 * ## ⚠ 재기 전에 정한 기준 (2026-11-20, 구현보다 먼저 박았습니다)
 *
 * 하네스의 "지금"은 2026-11-24 현지 18:30(+9), 지금 장면은 눈 31 m · 방위 128.4° · 20× · 롯데월드타워 꼭대기(건물 555 m).
 * 처음 저장해 둔 셋은 시안과 같다: 잠실한강공원 남단(오늘 18:12 · 눈 1.6 m · 방위 128° · 5× · 건물 555 m), 탄천 둔치(12.04 18:47 · 눈 1.6 m · 방위 131° · 5×),
 * 남산 전망대(오늘 17:04 · 눈 245 m · 방위 245° · 1× · "일몰 · 남서쪽 하늘").
 *
 *  1. 줄: 3 개일 때 "장면 저장" 단추, "저장한 장면" 글, 최근 둘의 칩(잠실한강공원 남단 · 탄천 둔치), "모두 3". 비면 "저장한 장면이 없어요"만(칩 · "모두" 없음). 50 개면 "모두 50"에 칩은 둘.
 *  2. 시트 열기("모두 3"): 제목 "저장한 장면", 설명("… 이 기기에만 있어요."), "지금 장면" 카드(이름 칸의 안내 글 = 기본 이름 "11.24 18:30 장면", 요약 한 줄 "오늘 18:30 · 눈 31 m · 방위 128° · 20×" 과 그 아래 "건물 · 555 m" 한 줄),
 *     목록 3 개가 잠실 → 탄천 → 남산 순서로 위의 요약과 대상 · 하늘 글과 함께 보인다.
 *  3. 저장: 이름 "내 새 장면" 을 적고 "저장" → 맨 앞에 "내 새 장면", 상태 "저장했어요", 이름 칸이 비고, 하네스가 저장 이름 ["내 새 장면"] 을 받고, 줄이 "모두 4" 에 칩 맨 앞이 "내 새 장면".
 *     이름을 비우고 저장하면 기본 이름 "11.24 18:30 장면" 으로 들어간다.
 *  4. 가득(50 개): 저장하면 "장면이 가득 찼어요(50개)…" 가 뜨고 목록은 50 개 그대로, 하네스는 저장을 받지 않는다.
 *  5. 지금 장면을 못 읽을 때(`noDraft`): 요약 자리에 "장면을 읽는 중…", 저장하면 "지금 장면을 읽지 못했어요".
 *  6. 열기: 목록 줄의 "열기"를 누르면 하네스가 그 장면의 id 를 받고 시트가 닫힌다. 줄의 칩을 누르면 시트 없이 바로 그 id 를 받는다.
 *  7. 이름 바꾸기: ⋯ → "이름 바꾸기" → 새 이름 → 확인 → 목록의 이름이 바뀐다. 이름을 비우고 확인하면 안 바뀐다.
 *  8. 삭제: ⋯ → "삭제" → "지울까요?" → "취소" 면 그대로, 다시 "삭제" → "지우기" 면 목록에서 사라지고 "모두 2". 삭제는 한 번 더 묻기 전에는 지워지지 않는다.
 *  9. 닫기: 시트의 닫기를 누르면 시트가 닫힌다(제목이 안 보임). 다시 열면 상태 글은 비어 있다.
 * 10. 영어 · 일본어: 제목 "Saved scenes" · "保存したシーン", 줄 "Save scene" · "シーン保存", 요약에 "Eye" · "目".
 *
 * 사용: sh tools/web-repro/build.sh && node tools/web-repro/verify-scene-sheet.js .harness/web-repro [그림 저장 폴더]
 * 필요: Playwright.
 */
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const http = require('http'), fs = require('fs'), path = require('path');
const dir = process.argv[2];
const shots = process.argv[3];
if (shots) fs.mkdirSync(shots, { recursive: true });
const types = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => { const f = path.join(dir, decodeURIComponent(req.url.split('?')[0].split('#')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }).listen(0);
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const open = async (flags, vp = { width: 380, height: 760 }) => {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 200)));
    const hash = JSON.stringify({ scenes: 1, w: vp.width, h: vp.height, ...flags });
    await p.goto(`http://localhost:${server.address().port}/repro.html#${encodeURIComponent(hash)}`);
    await p.getByRole('button', { name: /장면 저장|Save scene|シーンを保存/ }).first().waitFor({ timeout: 60000 });
    return { ctx, p };
  };
  const body = (p) => p.locator('body').innerText();
  const state = (p) => p.evaluate(() => JSON.parse(JSON.stringify(globalThis.__scenes)));
  const shot = async (p, name) => { if (shots) await p.screenshot({ path: path.join(shots, name + '.png') }); };
  const btn = (p, name, exact = true) => p.getByRole('button', { name, exact }).first();

  // ── 1 줄
  console.log('\n[1] 줄');
  {
    const { ctx, p } = await open({});
    let t = await body(p);
    ok(['장면 저장', '저장한 장면', '잠실한강공원 남단', '탄천 둔치', '모두 3'].every(w => t.includes(w)) && !t.includes('남산 전망대'), '3 개: "장면 저장" · "저장한 장면" · 최근 둘의 칩 · "모두 3"(셋째는 칩에 없다)');
    await shot(p, '1-bar-3');
    await ctx.close();
    const e = await open({ n: 0 });
    t = await body(e.p);
    ok(t.includes('저장한 장면이 없어요') && !t.includes('모두') && !t.includes('잠실'), '비면 "저장한 장면이 없어요"만');
    await shot(e.p, '1-bar-0');
    await e.ctx.close();
    const f = await open({ n: 50 });
    t = await body(f.p);
    ok(t.includes('모두 50') && t.includes('잠실한강공원 남단') && t.includes('탄천 둔치') && !t.includes('장면 4'), '50 개면 "모두 50" 에 칩은 둘');
    await f.ctx.close();
  }

  // ── 2 시트 열기
  console.log('\n[2] 시트 열기');
  {
    const { ctx, p } = await open({});
    await btn(p, /^저장한 장면 모두 보기 3$/).click();
    await p.getByText('저장한 장면', { exact: true }).first().waitFor({ timeout: 10000 });
    const t = await body(p);
    ok(t.includes('이 기기에만 있어요') && t.includes('지금 장면'), '제목 · 설명 · "지금 장면"');
    const ph = await p.getByLabel('장면 이름', { exact: true }).getAttribute('placeholder');
    ok(ph === '11.24 18:30 장면', `이름 칸의 안내 글 "${ph}" = 기본 이름`);
    ok(t.includes('오늘 18:30 · 눈 31 m · 방위 128° · 20×\n건물 · 555 m'), '지금 장면 요약 한 줄과 그 아래 대상 한 줄');
    const i1 = t.indexOf('잠실한강공원 남단', t.indexOf('저장한 장면 · 3')), i2 = t.indexOf('탄천 둔치', i1), i3 = t.indexOf('남산 전망대', i2);
    ok(i1 > 0 && i2 > i1 && i3 > i2, '목록 순서: 잠실 → 탄천 → 남산');
    ok(t.includes('오늘 18:12 · 눈 1.6 m · 방위 128° · 5×') && t.includes('12.04 18:47 · 눈 1.6 m · 방위 131° · 5×') && t.includes('오늘 17:04 · 눈 245 m · 방위 245° · 1×'), '각 줄의 요약');
    ok(t.includes('건물 · 555 m') && t.includes('일몰 · 남서쪽 하늘'), '대상 글("건물 · 555 m")과 하늘 글("일몰 · 남서쪽 하늘")');
    await shot(p, '2-sheet-3');
    await ctx.close();
  }

  // ── 3 저장, 6 열기, 7 이름 바꾸기, 8 삭제, 9 닫기
  console.log('\n[3] 저장');
  {
    const { ctx, p } = await open({ open: 1 });
    await p.getByLabel('장면 이름', { exact: true }).fill('내 새 장면');
    await btn(p, '저장').click();
    await p.waitForTimeout(300);
    let t = await body(p);
    let st = await state(p);
    ok(t.includes('저장했어요') && JSON.stringify(st.saves) === JSON.stringify(['내 새 장면']), '"저장했어요", 하네스가 저장 이름 ["내 새 장면"] 을 받았다');
    ok((await p.getByLabel('장면 이름', { exact: true }).inputValue()) === '', '이름 칸이 비었다');
    ok(st.list[0].name === '내 새 장면' && st.list.length === 4 && t.includes('저장한 장면 · 4'), '맨 앞에 들어가고 4 개');
    await shot(p, '3-saved');
    await btn(p, '저장').click();
    await p.waitForTimeout(300);
    st = await state(p);
    ok(st.list[0].name === '11.24 18:30 장면' && st.list.length === 5, `이름을 비우고 저장하면 기본 이름 "${st.list[0].name}"`);

    console.log('\n[6] 열기');
    await btn(p, /^열기: 잠실한강공원 남단$/).click();
    await p.waitForTimeout(300);
    st = await state(p);
    ok(st.opened.includes('s1'), '"열기"를 누르면 그 장면의 id 를 받는다');
    ok(!(await body(p)).includes('이 기기에만 있어요'), '시트가 닫힌다');
    const before = st.opened.length;
    await btn(p, /^장면 열기: 내 새 장면$|^장면 열기: 11\.24 18:30 장면$/).click();
    await p.waitForTimeout(300);
    st = await state(p);
    ok(st.opened.length === before + 1 && !(await body(p)).includes('이 기기에만 있어요'), '줄의 칩을 누르면 시트 없이 바로 열린다');
    await ctx.close();
  }
  {
    const { ctx, p } = await open({ open: 1 });
    console.log('\n[7] 이름 바꾸기');
    await btn(p, /^더 보기: 탄천 둔치$/).click();
    await btn(p, '이름 바꾸기').click();
    await p.getByLabel('새 이름', { exact: true }).fill('탄천 새 이름');
    await btn(p, '확인').click();
    await p.waitForTimeout(200);
    let st = await state(p);
    ok(st.list.map(s => s.name).includes('탄천 새 이름') && !st.list.map(s => s.name).includes('탄천 둔치'), '이름이 바뀐다');
    await btn(p, /^더 보기: 탄천 새 이름$/).click();
    await btn(p, '이름 바꾸기').click();
    await p.getByLabel('새 이름', { exact: true }).fill('   ');
    await btn(p, '확인').click();
    await p.waitForTimeout(200);
    st = await state(p);
    ok(st.list.map(s => s.name).includes('탄천 새 이름'), '이름을 비우고 확인하면 안 바뀐다');

    console.log('\n[8] 삭제');
    await btn(p, /^더 보기: 남산 전망대$/).click();
    await btn(p, '삭제').click();
    ok((await body(p)).includes('지울까요?') && (await state(p)).list.length === 3, '"지울까요?" 를 묻고 아직 지우지 않는다');
    await btn(p, '취소').click();
    ok((await state(p)).list.length === 3 && !(await body(p)).includes('지울까요?'), '"취소" 면 그대로');
    await btn(p, /^더 보기: 남산 전망대$/).click();
    await btn(p, '삭제').click();
    await shot(p, '8-confirm');
    await btn(p, '지우기').click();
    await p.waitForTimeout(200);
    st = await state(p);
    ok(st.list.length === 2 && !st.list.some(s => s.name === '남산 전망대') && (await body(p)).includes('저장한 장면 · 2'), '"지우기" 면 목록에서 사라진다(2 개)');

    console.log('\n[9] 닫기');
    await btn(p, '닫기').last().click();
    await p.waitForTimeout(300);
    ok(!(await body(p)).includes('이 기기에만 있어요') && (await body(p)).includes('모두 2'), '닫으면 시트가 사라지고 줄에 "모두 2"');
    await ctx.close();
  }

  // ── 4 가득, 5 못 읽음
  console.log('\n[4] 가득');
  {
    const { ctx, p } = await open({ n: 50, open: 1 });
    await btn(p, '저장').click();
    await p.waitForTimeout(300);
    const t = await body(p), st = await state(p);
    ok(t.includes('장면이 가득 찼어요(50개)') && st.list.length === 50 && st.saves.length === 0, '"장면이 가득 찼어요(50개)…", 목록은 50 개 그대로, 저장은 받지 않았다');
    await shot(p, '4-full');
    await ctx.close();
  }
  console.log('\n[5] 지금 장면을 못 읽을 때');
  {
    const { ctx, p } = await open({ open: 1, noDraft: 1 });
    ok((await body(p)).includes('장면을 읽는 중…'), '요약 자리에 "장면을 읽는 중…"');
    await btn(p, '저장').click();
    await p.waitForTimeout(300);
    ok((await body(p)).includes('지금 장면을 읽지 못했어요'), '저장하면 "지금 장면을 읽지 못했어요"');
    await ctx.close();
  }

  // ── 10 영어 · 일본어
  console.log('\n[10] 영어 · 일본어');
  for (const [lang, title, bar, eye] of [['en', 'Saved scenes', 'Save scene', 'Eye 31 m'], ['ja', '保存したシーン', 'シーン保存', '目 31 m']]) {
    const { ctx, p } = await open({ lang, open: 1 });
    const t = await body(p);
    ok(t.includes(title) && t.includes(bar) && t.includes(eye), `${lang}: "${title}" · "${bar}" · "${eye}"`);
    await shot(p, `10-${lang}`);
    await ctx.close();
  }

  await b.close();
  server.close();
  console.log(`\n${fail ? '실패 있음' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL: 예외 — ' + (e && e.stack || e)); process.exit(1); });
