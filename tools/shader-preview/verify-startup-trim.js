/**
 * **앱을 켤 때의 쓸데없는 일을 줄인 것(2026-11-23)이 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * 두 가지를 봅니다.
 *  (A) 저장 계층 — `src/utils/debouncedPersist.ts`. zustand persist 는 `set()` 이 불릴 때마다(나침반 · 로딩 상태 · 위치 …) 저장을 다시 하는데,
 *      그때마다 위치 · 저장한 곳 · 사진 목록 · 장면 전체를 JSON 으로 만들고 글자마다 XOR 암호화한 뒤 AsyncStorage 에 썼다.
 *      저장 대상 필드가 하나도 안 바뀌어도 그랬다. 이 부품은 (1) 저장 대상이 앞과 같은 참조면 아무것도 안 하고 (2) 바뀌면 잠깐 모았다가 마지막 것만 한 번 쓰고
 *      (3) 앱이 뒤로 가기 전에는 바로 쓴다(`flush`).
 *  (B) 죽은 작업 — `generateSimulationImage` 는 1×1 픽셀 JPEG 을 돌려주는 빈 껍데기인데도 앱을 켤 때마다 그 그림을 위해 지금 시각 예보를 찾고 노을 예측을 돌리고,
 *      알림 · 위젯용으로 1 픽셀을 파일에 쓰고 세 크기로 줄였다. 이 일을 모두 없앤다. (위젯은 그림이 없으면 스스로 같은 1 픽셀을 쓰므로 보이는 것이 같다.)
 *
 * 먼저 정한 줄(실행 전):
 *  A1. 같은 state 참조로 setItem 을 다시 부르면 저장소 쓰기 0 번, 직렬화(encode) 0 번.
 *  A2. 바뀐 state 로 부르면 지연(delayMs) 전에는 쓰기 0 번, 지연 뒤 1 번, 쓴 값은 마지막으로 준 값. 지연 안에 N 번 바꿔도 쓰기는 1 번.
 *  A3. 지연 뒤 직렬화한 결과가 마지막에 쓴 것과 글자까지 같으면(참조만 새로 만든 경우) 쓰지 않는다.
 *  A4. flush() 는 모아 둔 것을 바로 쓰고, 한 번 더 부르면 쓰기가 늘지 않는다. 모아 둔 것이 없으면 쓰지 않는다.
 *  A5. getItem: 저장소 값을 decode 해 {state, version} 으로 돌려준다. decode 가 던지면(암호화 전에 저장한 옛 값) 그대로 읽어 본다. 값이 없으면 null.
 *  A6. removeItem 은 모아 둔 쓰기를 취소하고 저장소에서 지운다(지운 뒤 되살아나지 않는다).
 *  A7. encode 가 던지면 암호화 없이 그대로 쓴다(옛 동작과 같음). 쓰기 오류는 밖으로 던지지 않는다.
 *  A8. 연결 — 스토어가 이 부품을 쓰고(createJSONStorage 대신), 앱이 뒤로 갈 때 flush 한다.
 *  B1. 소스에 generateSimulationImage · saveSimulationImageToCache · compressToWidgetSizes · setCurrentSimulationUri · currentSimulationUri 가 코드로 남아 있지 않다(주석 제외).
 *  --- 2단계(2026-11-23, 같은 판정에 이어 붙임) ---
 *  C1. 링 캐시 파일 이름 → 같은 날 · 같은 격자의 날씨 캐시 쌍둥이 파일 이름(`weatherTwinOfRingFile`): `ring_<격자>_<날짜>.dat` → `w_<격자>_<날짜>.dat`. 링이 아닌 이름은 null.
 *      (시작할 때 링 캐시와 날씨 캐시를 모두 읽어 `primeRingCache([...링, ...날씨])` 로 넣는데 같은 키는 날씨가 이긴다 → 쌍둥이가 있는 링 파일은 읽을 필요가 없다.)
 *  C2. 연결 — 링 캐시를 읽을 때 `MAX_RING_ENTRIES`(3) 상한과 쌍둥이 건너뛰기를 쓰고, 파일 읽기는 하나씩이 아니라 한꺼번에(Promise.all) 한다. 스토어의 링 저장은 MAX_RING_ENTRIES 를 쓰고 날씨 쌍둥이가 생겼으면 쓰지 않는다.
 *  D1. 지형 고도 요청 합치기 — 같은 자리 · 같은 범위의 `fetchTerrainProfile` 을 동시에 둘 부르면 네트워크 요청은 1 번, 두 결과는 같은 값. 끝난 뒤 다시 부르면 캐시로(요청 0 번). 실패는 캐시하지 않고 다음 호출이 다시 시도한다.
 *  E1. XOR 16진수 암호화 속도 — `xorHex.ts` 의 encode/decode 가 옛 글자별 구현과 **같은 글**을 낸다(유니코드 · 빈 글 · 긴 글 포함, 왕복 동일). 큰 글에서 옛 것보다 느리지 않다(비교 로그만, 시간은 판정에 안 씀).
 *  F1. 처음 실행 안내가 떠 있는 동안 3D 하늘은 멈춘다(`isSuspended` 에 showGuide).
 *  F2. 켜는 단계 시간 기록(`startupTrace.ts`) — 표시 · 구간 길이 · 합이 맞고, 개발 빌드에서만 로그를 낸다.
 *  B2. 켤 때 알림 예약이 쓰는 effect 는 남아 있고(알림 · 앱 아이콘 · 위젯 글자 갱신), 위젯 갱신은 그림 없이 글자만 넘긴다.
 */
const path = require('path');
const fs = require('fs');
const { PREVIEW, REPO_ROOT } = require('./paths');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const D = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'debouncedPersist.js'));
  const mk = (opts = {}) => {
    const mem = new Map(); const calls = { set: 0, enc: 0, remove: 0 }; const timers = []; let id = 0;
    const raw = { getItem: async (k) => (mem.has(k) ? mem.get(k) : null), setItem: async (k, v) => { calls.set++; mem.set(k, v); }, removeItem: async (k) => { calls.remove++; mem.delete(k); } };
    const st = D.createDebouncedPersistStorage({
      raw, delayMs: 500,
      encode: opts.encode ?? ((s) => { calls.enc++; return 'E:' + s; }),
      decode: opts.decode ?? ((s) => { if (!s.startsWith('E:')) throw new Error('legacy'); return s.slice(2); }),
      schedule: (fn, ms) => { const t = { id: ++id, fn, ms, live: true }; timers.push(t); return t; },
      cancel: (t) => { if (t) t.live = false; },
    });
    const fire = async () => { for (const t of timers.filter(x => x.live)) { t.live = false; await t.fn(); } await Promise.resolve(); };
    return { st, mem, calls, timers, fire };
  };
  const S1 = { a: [1], b: 'x' };

  console.log('\n[A] 저장 계층');
  { // A1
    const t = mk(); await t.st.setItem('k', { state: S1, version: 0 }); await t.fire();
    const w = t.calls.set, e = t.calls.enc;
    await t.st.setItem('k', { state: S1, version: 0 }); await t.st.setItem('k', { state: { ...S1 }, version: 0 }).catch(() => {});
    ok(w === 1 && e === 1, `첫 저장 1 번 (쓰기 ${w}, 직렬화 ${e})`);
    const t2 = mk(); await t2.st.setItem('k', { state: S1, version: 0 }); await t2.fire();
    const before = { ...t2.calls }; await t2.st.setItem('k', { state: S1, version: 0 }); await t2.fire();
    ok(t2.calls.set === before.set && t2.calls.enc === before.enc, `같은 참조로 다시 부르면 쓰기 · 암호화 0 번 (쓰기 ${t2.calls.set - before.set}, 암호화 ${t2.calls.enc - before.enc})`);
    // JSON 만들기(JSON.stringify) 자체도 0 번이어야 한다 — 사진 목록이 큰 사람일수록 이 비용이 크다. toJSON 으로 세어 본다.
    let json = 0; const counted = { a: [1], toJSON() { json++; return { a: [1] }; } };
    const t3 = mk(); await t3.st.setItem('k', { state: counted, version: 0 }); await t3.fire();
    const j1 = json; for (let i = 0; i < 5; i++) await t3.st.setItem('k', { state: counted, version: 0 }); await t3.fire();
    ok(j1 === 1 && json === 1, `같은 state 를 다섯 번 더 줘도 JSON 만들기는 늘지 않는다 (${j1} → ${json})`);
  }
  { // A2
    const t = mk(); const base = { a: [1], b: 'x' };
    await t.st.setItem('k', { state: base, version: 0 }); await t.fire();
    const w0 = t.calls.set;
    for (let i = 0; i < 5; i++) await t.st.setItem('k', { state: { ...base, b: 'y' + i }, version: 0 });
    ok(t.calls.set === w0, `지연 전에는 쓰기 0 번 (${t.calls.set - w0})`);
    await t.fire();
    ok(t.calls.set === w0 + 1, `다섯 번 바꿔도 쓰기 1 번 (${t.calls.set - w0})`);
    ok(t.mem.get('k').includes('"b":"y4"'), '쓴 값은 마지막으로 준 값');
    ok(t.timers.filter(x => x.ms === 500).length >= 1, '지연은 500ms');
  }
  { // A3
    const t = mk(); await t.st.setItem('k', { state: { a: 1 }, version: 0 }); await t.fire();
    const w0 = t.calls.set; await t.st.setItem('k', { state: { a: 1 }, version: 0 }); await t.fire();
    ok(t.calls.set === w0, `참조만 새로 만든 같은 내용은 쓰지 않는다 (${t.calls.set - w0})`);
  }
  { // A4
    const t = mk(); await t.st.setItem('k', { state: { a: 1 }, version: 0 });
    await t.st.flush(); const w1 = t.calls.set; await t.st.flush(); await t.fire();
    ok(w1 === 1 && t.calls.set === 1, `flush 는 바로 쓰고 한 번 더 불러도 늘지 않는다 (${w1} → ${t.calls.set})`);
    const t0 = mk(); await t0.st.flush(); ok(t0.calls.set === 0, '모아 둔 것이 없으면 flush 가 쓰지 않는다');
  }
  { // A5
    const t = mk(); await t.st.setItem('k', { state: { a: 1 }, version: 3 }); await t.st.flush();
    const got = await t.st.getItem('k');
    ok(got && got.version === 3 && got.state.a === 1, 'getItem 이 {state, version} 으로 돌려준다');
    t.mem.set('old', JSON.stringify({ state: { a: 9 }, version: 0 }));
    const old = await t.st.getItem('old'); ok(old && old.state.a === 9, '옛 평문 값도 읽는다');
    ok((await t.st.getItem('none')) === null, '없으면 null');
  }
  { // A6
    const t = mk(); await t.st.setItem('k', { state: { a: 1 }, version: 0 }); await t.st.removeItem('k'); await t.fire(); await t.st.flush();
    ok(!t.mem.has('k') && t.calls.set === 0, '지우면 모아 둔 쓰기가 되살아나지 않는다');
  }
  { // A7
    const t = mk({ encode: () => { throw new Error('boom'); } });
    await t.st.setItem('k', { state: { a: 1 }, version: 0 }); await t.fire();
    ok(t.mem.get('k') === JSON.stringify({ state: { a: 1 }, version: 0 }), 'encode 실패 시 평문으로 쓴다');
    const bad = D.createDebouncedPersistStorage({ raw: { getItem: async () => null, setItem: async () => { throw new Error('disk'); }, removeItem: async () => {} }, delayMs: 1, encode: (s) => s, decode: (s) => s, schedule: (f) => { f(); return 0; }, cancel: () => {} });
    let threw = false; try { await bad.setItem('k', { state: { a: 2 }, version: 0 }); await bad.flush(); } catch { threw = true; }
    ok(!threw, '저장소 쓰기 오류를 밖으로 던지지 않는다');
  }
  { // A8
    const store = fs.readFileSync(path.join(REPO_ROOT, 'src/store/useCelestialStore.ts'), 'utf8');
    ok(/createDebouncedPersistStorage(<[^>]*>)?\(/.test(store) && !/createJSONStorage\(/.test(store.replace(/import[^\n]*createJSONStorage[^\n]*\n/, '')), '스토어가 createDebouncedPersistStorage 를 쓴다(createJSONStorage 는 더 안 쓴다)');
    ok(/AppState\.addEventListener\('change'[\s\S]{0,200}flush\(\)/.test(store), '앱이 뒤로 갈 때 flush 한다');
  }

  console.log('\n[B] 죽은 작업');
  {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
    const files = [];
    const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f.name)) files.push(p); } };
    walk(path.join(REPO_ROOT, 'src'));
    const names = ['generateSimulationImage', 'saveSimulationImageToCache', 'compressToWidgetSizes', 'setCurrentSimulationUri', 'currentSimulationUri'];
    const left = [];
    for (const f of files) { const s = strip(fs.readFileSync(f, 'utf8')); for (const n of names) if (s.includes(n)) left.push(`${path.relative(REPO_ROOT, f)}:${n}`); }
    ok(left.length === 0, `죽은 함수 · 필드가 코드로 남아 있지 않다${left.length ? ': ' + left.join(', ') : ''}`);
    const app = fs.readFileSync(path.join(REPO_ROOT, 'src/hooks/useCelestialApp.ts'), 'utf8');
    ok(/scheduleSunsetNotification\(/.test(app) && /scheduleSunriseNotification\(/.test(app) && /setAppIcon\(/.test(app), '알림 예약 · 앱 아이콘 갱신은 남아 있다');
    const upd = app.match(/updateSunsetWidgetData\(\{[\s\S]*?\}\);/g) || [];
    ok(upd.length >= 1 && upd.every(u => !/simulation(Small|Medium|Large)?Uri/.test(u)), `위젯 갱신이 그림 없이 글자만 넘긴다 (${upd.length} 곳)`);
  }

  console.log('\n[C] 링 캐시 읽기');
  {
    const CP = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'cachePolicy.js'));
    ok(CP.weatherTwinOfRingFile('ring_37.56_126.98_2026-11-23.dat') === 'w_37.56_126.98_2026-11-23.dat', '링 파일 → 날씨 쌍둥이 파일 이름');
    ok(CP.weatherTwinOfRingFile('w_x_2026-11-23.dat') === null && CP.weatherTwinOfRingFile('t_x.dat') === null, '링이 아닌 이름은 null');
    const pc = fs.readFileSync(path.join(REPO_ROOT, 'src/utils/persistentCache.ts'), 'utf8');
    const store = fs.readFileSync(path.join(REPO_ROOT, 'src/store/useCelestialStore.ts'), 'utf8');
    ok(/MAX_RING_ENTRIES/.test(pc) && /weatherTwinOfRingFile/.test(pc) && /Promise\.all/.test(pc.slice(pc.indexOf('const readFiles'), pc.indexOf('const writeFiles'))), 'persistentCache: 링 상한 · 쌍둥이 건너뛰기 · 한꺼번에 읽기');
    const pers = store.slice(store.indexOf('setRingPersister('), store.indexOf('setRingPersister(') + 1200);
    ok(/MAX_RING_ENTRIES/.test(pers) && /(w_|weatherCacheKey|replace\(\/\^ring_)/.test(pers), '스토어 링 저장: 상한 3 + 날씨 쌍둥이가 있으면 쓰지 않음');
  }
  console.log('\n[D] 지형 요청 합치기');
  {
    globalThis.__DEV__ = false;
    let reqs = 0, fail = false;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      reqs++; await new Promise(r => setTimeout(r, 20));
      if (fail) return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
      const n = (String(url).match(/latitude=([^&]*)/)?.[1] ?? '0').split(',').length;
      return { ok: true, status: 200, json: async () => ({ elevation: Array.from({ length: n }, (_, i) => 100 + i) }), text: async () => '' };
    };
    try {
      const W = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'weather.js'));
      const [a, b] = await Promise.all([W.fetchTerrainProfile(10.123, 20.456, 0, 360), W.fetchTerrainProfile(10.123, 20.456, 0, 360)]);
      const n1 = reqs;
      ok(n1 >= 1 && a === b, `동시에 둘 불러도 같은 결과 객체 (요청 ${n1} 번)`);
      const c = await W.fetchTerrainProfile(10.123, 20.456, 0, 360);
      ok(reqs === n1 && c === a, `끝난 뒤 다시 부르면 캐시 (추가 요청 ${reqs - n1} 번)`);
      // 요청 수 비교: 한 번 부를 때의 요청 수 k 와 동시 둘의 요청 수가 같아야 한다
      reqs = 0; await W.fetchTerrainProfile(11.2, 21.4, 0, 360); const single = reqs;
      reqs = 0; await Promise.all([W.fetchTerrainProfile(12.2, 22.4, 0, 360), W.fetchTerrainProfile(12.2, 22.4, 0, 360)]);
      ok(reqs === single, `동시 둘의 요청 수(${reqs}) = 하나일 때의 요청 수(${single})`);
      fail = true; reqs = 0;
      const f1 = await W.fetchTerrainProfile(13.3, 23.3, 0, 360); const afterFail = reqs;
      fail = false; const f2 = await W.fetchTerrainProfile(13.3, 23.3, 0, 360);
      ok(reqs > afterFail && !f2.isFallback, `실패(${f1.isFallback ? '대용값' : '?'})는 캐시하지 않고 다음 호출이 다시 시도한다`);
    } finally { globalThis.fetch = realFetch; }
  }
  console.log('\n[E] XOR 암호화');
  {
    const X = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'xorHex.js'));
    const salt = 'BeforeGlowSecuritySalt_2026_SolarPath_android_34_54';
    const toHex = (str) => { let r = ''; for (let i = 0; i < str.length; i++) r += ('0' + str.charCodeAt(i).toString(16)).slice(-2); return r; };
    const fromHex = (hex) => { let r = ''; for (let i = 0; i < hex.length; i += 2) r += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16)); return r; };
    const refEnc = (text) => { if (!text) return ''; const u = encodeURIComponent(text); let r = ''; for (let i = 0; i < u.length; i++) r += String.fromCharCode(u.charCodeAt(i) ^ salt.charCodeAt(i % salt.length)); return toHex(r); };
    const refDec = (hex) => { if (!hex) return ''; const t = fromHex(hex); let r = ''; for (let i = 0; i < t.length; i++) r += String.fromCharCode(t.charCodeAt(i) ^ salt.charCodeAt(i % salt.length)); return decodeURIComponent(r); };
    const samples = ['', 'a', 'hello world', '한글 노을 🌅 점수 72', JSON.stringify({ k: [1, 2, 3], s: '가나다' }), 'x'.repeat(100000), JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ i, t: '구름 ' + i })))];
    let bad = 0; for (const t of samples) { const e = X.xorHexEncode(t, salt); if (e !== refEnc(t) || X.xorHexDecode(e, salt) !== t || X.xorHexDecode(refEnc(t), salt) !== refDec(refEnc(t))) bad++; }
    ok(bad === 0, `옛 구현과 같은 글을 내고 왕복이 같다 (${samples.length} 개 중 어긋남 ${bad})`);
    const big = JSON.stringify(Array.from({ length: 20000 }, (_, i) => ({ i, t: '구름 ' + i, v: Math.sin(i) }))); const te = refEnc(big);
    let t0 = Date.now(); refDec(te); const tOld = Date.now() - t0; t0 = Date.now(); X.xorHexDecode(te, salt); const tNew = Date.now() - t0;
    console.log(`  (참고: ${(big.length / 1024).toFixed(0)} KB 복호화 옛 ${tOld}ms → 새 ${tNew}ms)`);
  }
  console.log('\n[F] 켜는 동안 3D · 시간 기록');
  {
    const app = fs.readFileSync(path.join(REPO_ROOT, 'src/App.tsx'), 'utf8');
    ok(/isSuspended=\{[^}]*showGuide/.test(app), '처음 실행 안내가 떠 있으면 3D 하늘을 멈춘다');
    const T = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'startupTrace.js'));
    let now = 1000; const lines = [];
    const tr = T.createStartupTrace({ now: () => now, log: (m) => lines.push(m), enabled: true });
    tr.mark('start'); now += 40; tr.mark('cache'); now += 250; tr.mark('weather'); now += 10; tr.mark('ready');
    const sp = tr.spans();
    ok(sp.map(x => x.label).join() === 'cache,weather,ready' && sp.map(x => x.ms).join() === '40,250,10' && tr.total() === 300, `구간 40 · 250 · 10, 합 300 (${JSON.stringify(sp.map(x => x.ms))}, ${tr.total()})`);
    ok(lines.length > 0 && /cache/.test(lines.join('')), '켜 두면 로그를 낸다');
    const off = []; const t2 = T.createStartupTrace({ now: () => now, log: (m) => off.push(m), enabled: false }); t2.mark('a'); t2.mark('b');
    ok(off.length === 0, '끄면(릴리스) 로그를 내지 않는다');
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
