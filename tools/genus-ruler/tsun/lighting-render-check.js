/**
 * §180 §178 조명 고침 렌더 확인 + WP7-P1 아틀라스 읽기 대조 — entry-gpuwin 번들을 SwiftShader Chromium 한 페이지에 띄워 단계 하나를 돌립니다.
 * **GPU 창에서만**(gpu-window.sh 가 부름 — RULER-grain 과정이 없을 때, run-tsun 과 같은 잠금 /tmp/run-tsun.lock). 페이지 하나 = 단계 하나 ≤ 60 분
 * (--max-min 58 + 브라우저 닫기 ≤ 1 분 — §180 검토 4).
 *
 *   nice -n 19 node tools/genus-ruler/tsun/lighting-render-check.js --guard-tag genus-ruler/volsky/run.js --stage L2deck-high \
 *       --root <entry-gpuwin 번들 폴더> --scenes <jobs>/light-scenes.json --out <OUT>/L [--max-min 58] [--lock F] [--allow-dirty] [--dry]
 *   단계(gpuwin-lib LIGHT_STAGES — 캔버스·entry-gpuwin 단계 이름(fn)·인자 덮어쓰기(patch)도 거기): L1compile · L2deck-low · L2deck-high · L3twilight ·
 *   L4sunset · L5cross12-low · L5cross12-medium · L6frametime-a · L6frametime-b · W7atlas.
 *   §180 검토 4: 60 분을 넘을 수 있던 L2deck·L5cross12·L6frametime 을 페이지 둘로 나눔(품질별 · L6 은 ABBA 한 번씩 두 페이지, 데움 4 + 잰 12 프레임) —
 *   한 단계가 시간 한도에 걸리면 그 페이지만 잃음(gpu-window.sh 는 같은 입력의 timeout 을 다시 돌리지 않음, GW_RETRY_FAILED=1 이면 다시).
 *   --dry: 인자·번들·장면·지킴·건너뛰기 판단만 하고 브라우저를 띄우지 않음(종료 0).
 *
 * 출력: <out>/<단계>.json(마지막에 임시 → 이름 바꾸기 — 열쇠 key = 번들 sha · 장면 sha · 인자 sha · 이 파일 sha) · <out>/<단계>/*.png(L2deck).
 *   같은 열쇠의 출력이 있고 ok 면 건너뜀(종료 0, 'skip'). 판단(합격 여부)은 gpuwin-post.mjs light 가 함 — 여기서는 기록 + 출렁임 지표 계산만.
 * 종료: 0 끝·건너뜀 · 1 오류 · 2 거부(지킴·잠금·인자·번들) · 3 시간 한도(단계가 못 끝남) · 6 맥락 손실.
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const L = require('./run-tsun-lib');
const G = require('./gpuwin-lib');

const argv = process.argv.slice(2);
const take = (k, d = null) => { const i = argv.indexOf(k); if (i < 0) return d; if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) { console.error(`lighting-render-check: ${k} needs a value`); process.exit(2); } const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = k => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; };
const args = {
  guardTag: take('--guard-tag'), stage: take('--stage'), root: take('--root'), scenes: take('--scenes'), out: take('--out'),
  maxMin: Number(take('--max-min', String(G.LIGHT_MAX_MIN))), lock: take('--lock', process.env.TSUN_LOCK || '/tmp/run-tsun.lock'),
  allowDirty: flag('--allow-dirty'), dry: flag('--dry'),
};
if (argv.length) { console.error('lighting-render-check: unknown argument(s) ' + argv.join(' ')); process.exit(2); }
if (args.guardTag !== L.GUARD_TAG) { console.error(`lighting-render-check: refusing — launch with --guard-tag ${L.GUARD_TAG} so eval-grain.sh guard_concurrent sees this page`); process.exit(2); }
const ST = G.LIGHT_STAGES[args.stage];
if (!ST) { console.error('lighting-render-check: --stage must be one of ' + Object.keys(G.LIGHT_STAGES).join(' ')); process.exit(2); }
if (!(args.maxMin > 0 && args.maxMin <= G.CHUNK_MAX_MIN)) { console.error(`lighting-render-check: --max-min must be in (0, ${G.CHUNK_MAX_MIN}]`); process.exit(2); }
for (const k of ['root', 'scenes', 'out']) if (!args[k]) { console.error('lighting-render-check: --' + k + ' is required'); process.exit(2); }
{ const bad = G.forbiddenPath(args.out); if (bad) { console.error(`lighting-render-check: refusing to write under ${args.out} — ${bad}`); process.exit(2); } }

const ROOT = path.resolve(args.root), FIX = path.join(__dirname, 'fixture');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const BUNDLE = path.join(ROOT, 'app.js');
if (!fs.existsSync(BUNDLE)) { console.error('lighting-render-check: no bundle ' + BUNDLE); process.exit(2); }
const BUNDLE_SHA = sha(fs.readFileSync(BUNDLE));
let bundleInfo;
try { bundleInfo = JSON.parse(fs.readFileSync(path.join(ROOT, 'bundle.json'), 'utf8')); } catch (e) { console.error('lighting-render-check: no bundle.json next to app.js — ' + e.message); process.exit(2); }
if (bundleInfo.same !== true || bundleInfo.bundleSha256 !== BUNDLE_SHA) { console.error('lighting-render-check: bundle.json does not vouch for app.js'); process.exit(2); }
if (Number(bundleInfo.dirtyFiles) > 0 && !args.allowDirty) { console.error(`lighting-render-check: bundle built from a dirty tree (${bundleInfo.dirtyFiles} files) — commit first or pass --allow-dirty`); process.exit(2); }
const scenesBuf = fs.readFileSync(args.scenes), SCENES_SHA = sha(scenesBuf), S = JSON.parse(scenesBuf);
const SELF_SHA = sha(fs.readFileSync(__filename));

/** 단계 인자(장면 파일에서 — 브라우저에 그대로 넘김). 해 고도 계열은 후쿠이 10/02 저녁(해 지는 쪽, 이분 탐색 구간 16:00~19:30 JST).
 *  fn = entry-gpuwin 단계 이름, 나눈 단계는 LIGHT_STAGES[stage].patch 로 덮어씀. */
function stageParams(stage) {
  return { ...baseParams(ST.fn), ...(ST.patch || {}) };
}
function baseParams(fn) {
  const deck = { input: S.P1B.input, options: S.P1B.options };
  switch (fn) {
    case 'L1compile': return { scene: deck };
    case 'L2deck': return { scene: deck, qualities: ['low', 'high'], frames: 16 };
    case 'L3twilight': return { scene: deck, from: -10, to: 0, step: 0.2, searchFrom: '2026-10-02T07:00:00Z', searchTo: '2026-10-02T10:30:00Z', bands: [[-10, -6], [-6, -3], [-3, 0]] };
    case 'L4sunset': return { scene: deck, from: 0, to: 5, step: 0.2, searchFrom: '2026-10-02T07:00:00Z', searchTo: '2026-10-02T10:30:00Z', bands: [[0, 2], [2, 5]] };
    case 'L5cross12': return { fukui: S.fukui, configs: S.configs, qualities: ['low', 'medium'], frames: 16 };
    case 'L6frametime': return { scene: S.frametimeUnit, warm: 6, timed: 24 };
    case 'W7atlas': return { units: S.wp7Units, arms: S.arms };
    default: throw new Error('stage ' + fn);
  }
}
const params = stageParams(args.stage);
const KEY = sha(JSON.stringify({ bundle: BUNDLE_SHA, scenes: SCENES_SHA, self: SELF_SHA, stage: args.stage, fn: ST.fn, canvas: [ST.W, ST.H], params: sha(JSON.stringify(params)) }));
const outFile = path.join(args.out, args.stage + '.json');
const prev = (() => { try { return JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { return null; } })();
if (prev && prev.key === KEY && prev.ok === true) { console.log(`lighting-render-check: ${args.stage} already done with the same key — skip`); process.exit(0); }

// ── 지킴(브라우저 전) — 자기·조상은 뺌(run-tsun-lib 와 같은 무늬) ──
const pg = pattern => { try { return G.pgrepAf(pattern); } catch (e) { console.error('lighting-render-check: ' + e.message); process.exit(2); } };
{
  const bad = L.conflictingProcesses(pg(L.GRAIN_PATTERN), L.ancestorsOf(process.pid)).filter(p => !/lighting-render-check/.test(p.cmd));
  if (bad.length) { console.error('lighting-render-check: RULER-grain (or tagged) process running — refusing:\n' + bad.map(p => `  ${p.pid} ${p.cmd.slice(0, 160)}`).join('\n')); process.exit(2); }
  const gpu = L.conflictingProcesses(pg(L.SWIFTSHADER_GPU_PATTERN), [process.pid]);
  if (gpu.length) { console.error('lighting-render-check: a SwiftShader GPU process is running — refusing:\n' + gpu.map(p => `  ${p.pid} ${p.cmd.slice(0, 160)}`).join('\n')); process.exit(2); }
}
if (args.dry) {
  console.log(JSON.stringify({ dry: true, stage: args.stage, fn: ST.fn, patch: ST.patch || null, maxMin: args.maxMin, canvas: [ST.W, ST.H], bundle: BUNDLE_SHA.slice(0, 16), scenes: SCENES_SHA.slice(0, 16), key: KEY.slice(0, 16), out: outFile, wouldSkip: false, paramsBytes: JSON.stringify(params).length }));
  process.exit(0);
}
let lock;
try { lock = L.acquireLock(args.lock); } catch (e) { console.error(String(e.message)); process.exit(2); }
process.on('exit', () => lock.release());
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { lock.release(); process.exit(130); });

fs.mkdirSync(args.out, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="app.js"></script></body></html>');
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const fx = u.match(/^\/tsun-fixture\/(tsun-fixture\.(json|bin))$/);
  const f = fx ? path.join(FIX, fx[1]) : path.join(ROOT, u);
  if ((!fx && !f.startsWith(ROOT)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : f.endsWith('.bin') ? 'application/octet-stream' : 'text/html' });
  fs.createReadStream(f).pipe(res);
}).listen(0);

(async () => {
  const t0 = Date.now(), deadline = t0 + args.maxMin * 60000;
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const closeBrowser = async () => { await Promise.race([b.close().catch(() => {}), new Promise(r => setTimeout(r, 60000))]); };
  const finish = async (code, msg) => { if (msg) console.error(msg); await closeBrowser(); server.close(); process.exit(code); };
  let timer;
  const left = () => Math.max(1000, deadline - Date.now());
  try {
    const p = await b.newPage({ viewport: { width: ST.W, height: ST.H } });
    p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); });
    await p.goto(`http://localhost:${server.address().port}/index.html?w=${ST.W}&h=${ST.H}`, { waitUntil: 'commit', timeout: 120000 });
    await p.waitForFunction(() => /^READY::/.test(document.title), null, { timeout: Math.min(900000, left()), polling: 1000 });
    const errs = await p.evaluate(() => window.__errors);
    if (errs.length) return finish(1, 'page errors: ' + JSON.stringify(errs).slice(0, 2000));
    const atmosMs = await p.evaluate(() => window.__atmosMs);
    console.log(args.stage, 'atmosphere ms', Math.round(atmosMs), 'chromium', b.version());
    const r = await Promise.race([p.evaluate(([s, prm]) => window.__stage(s, prm), [ST.fn, params]),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('TIME LIMIT ' + args.maxMin + ' min')), left()); })]);
    clearTimeout(timer);
    // 출렁임 지표(L3·L4) — node 에서
    if (r.result && r.result.series) {
      r.result.pulsing = {};
      for (const [k, pts] of Object.entries(r.result.series)) r.result.pulsing[k] = G.pulsing(pts.map(x => ({ e: x.e, Y: x.Y })), r.result.bands || [[-90, 90]]);
      r.result.pulsingNote = '잔차 = ln Y − 국소 2차 맞춤(±1.5°); p2pRatio = exp(봉우리 간격). clamp = LOGμ 끔, on = 둘 다 켬(앱 길).';
    }
    // PNG(L2deck) 따로
    const pngs = (r.result && r.result.pngs) || {};
    if (r.result) delete r.result.pngs;
    const pdir = path.join(args.out, args.stage);
    if (Object.keys(pngs).length) fs.mkdirSync(pdir, { recursive: true });
    for (const [n, url] of Object.entries(pngs)) fs.writeFileSync(path.join(pdir, n.replace(/[^A-Za-z0-9_.+-]/g, '_')), Buffer.from(String(url).split(',')[1], 'base64'));
    const ok = !r.ctxLost && r.glError === 0 && !(r.errors || []).length && !(r.shaderErrors || []).length && !(r.brokenPrograms || []).length;
    const rec = { stage: args.stage, fn: ST.fn, patch: ST.patch || null, key: KEY, ok, bundleSha256: BUNDLE_SHA, scenesSha256: SCENES_SHA, bundle: { esbuild: bundleInfo.esbuild, gitHead: bundleInfo.gitHead, dirtyFiles: bundleInfo.dirtyFiles },
      chromium: b.version(), atmosMs, wallMin: (Date.now() - t0) / 60000, finishedAt: new Date().toISOString(), guardTag: args.guardTag, ...r, stage: args.stage, pngs: Object.keys(pngs) };   // r.stage = fn — 나눈 단계 이름을 남김
    fs.writeFileSync(outFile + '.tmp', JSON.stringify(rec, null, 1)); fs.renameSync(outFile + '.tmp', outFile);
    console.log(args.stage, ok ? 'OK' : 'NOT OK', 'wall', rec.wallMin.toFixed(1), 'min');
    return finish(r.ctxLost ? 6 : ok ? 0 : 1);
  } catch (e) {
    clearTimeout(timer);
    const msg = String(e && e.message || e);
    fs.writeFileSync(path.join(args.out, args.stage + '.error.txt'), `${new Date().toISOString()} ${msg}\n`);
    return finish(/^TIME LIMIT/.test(msg) ? 3 : /context was lost|webglcontextlost/.test(msg) ? 6 : 1, args.stage + ' ERROR ' + msg.slice(0, 1000));
  }
})().catch(e => { console.error(e); process.exit(1); });
