/**
 * §179 RULER-tsun 실행기(WP8 — ruler-delta B2, RULER-tsun §5.0 ①) — entry-tsun 번들을 SwiftShader Chromium 한 페이지에서 잡마다 이어 그립니다.
 * **RULER-grain 렌더와 동시에 돌리지 않습니다**: 시작 전 자기 지킴(pgrep — run-tsun-lib.js), 잠금 파일, 덩어리 ≤ 2 시간(--max-min, 기본 110).
 * 예약된 기계 창(B0·B2 보정 렌더)에서만 — 사용자/조정자가 정함(ruler-delta B4·U8). 판정 회차 없음(2026-10-28 사용자 결정).
 *
 *   띄우기(ruler-delta B2 의 줄 — 표지 덕에 동결 eval-grain.sh 의 guard_concurrent 가 이 덩어리를 봄):
 *     VROOT=<번들 폴더> nice -n 19 node tools/genus-ruler/tsun/run-tsun.js --guard-tag genus-ruler/volsky/run.js jobs.json outDir W H [gen|load]
 *   §179 검토 반영(하네스 2): --guard-tag 가 없거나 다르면 **거부**(종료 2) — 처음 판은 경고만 해서 동결 확장기(make-jobs-tsun expand)가 쓰는 띄우기 줄
 *   (태그 없음)로 띄운 덩어리를 eval-grain.sh 가 못 봤음. 확장기의 줄은 tools/genus-ruler/tsun/run-tsun.sh run … 을 쓰도록 A1/E8 갱신에서 고쳐야 함
 *   (확장기는 동결 후보라 여기서 고치지 않음 — 그 전까지 그 줄은 여기서 거부됨).
 *   선택: --max-min N((0, 120], 기본 110) · --lock 파일(기본 /tmp/run-tsun.lock) · --root 번들 폴더(VROOT 대신) · --watchdog-scale s(> 0) · --atmos load|gen ·
 *         --retry-watchdog(감시 시간에 걸린 잡을 다시) · --allow-dirty(번들이 고친 작업 트리에서 묶였어도 돌림 — 기본 거부)
 *   번들: tools/genus-ruler/tsun/run-tsun.sh build <폴더>(두 번 빌드해 sha 같음 확인 → bundle.json). 실행기는 bundle.json 을 읽어 same·sha 를 대조.
 *
 * 잡(entry-tsun.ts 머리말): 새 손잡이 9 개 명시, image · debug(tsunDebug 1, 이름 …__dbg1) · cost(grain.mode 'cost'). 잡 W·H(또는 canvas)가 이 호출의 크기와
 * 다르면 건너뜀. 한 잡 파일 안 품질 섞기·같은 이름은 거부.
 * 출력: outDir/<잡>.png · .alpha.png(그림) · .debug.png · .debug.f16(R-A_T) · .cost-tsun.f16(비용) · <잡>.meta.json(마지막에, 임시 → 이름 바꾸기) ·
 *       results.jsonl(잡마다 한 줄) · results.json(이름 → meta, 덩어리 끝에 합침 — volsky run.js 와 같은 꼴, 하네스 15).
 *       **실패한 잡(throw · captureOk false · 맥락 손실)은 그림·meta 를 쓰지 않고** <잡>.error.txt 와 results.jsonl 줄만(하네스 5) — 같은 이름의
 *       옛 출력도 지움. 이어 그리기: <잡>.meta.json 의 bundleSha256·jobSha256·fixtureSha256 이 같고 captureOk 참이면 건너뜀(하네스 6).
 *       감시 시간에 걸린 잡은 <잡>.watchdog.txt 를 남기고, 다음 덩어리는 --retry-watchdog 없이는 그 잡을 건너뜀(같은 잡에 막혀 되풀이하지 않게, 하네스 8c).
 * 종료 코드: 0 끝 · 2 거부(지킴·잠금·품질 섞기·같은 이름·인자·번들) · 3 시간 한도(남은 잡) · 4 잡 실패 있음 · 5 감시 시간 넘김(덩어리 끝) · 6 맥락 손실(덩어리 끝).
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const L = require('./run-tsun-lib');

let args;
try { args = L.parseArgs(process.argv.slice(2), process.env); } catch (e) { console.error(String(e.message)); process.exit(2); }
if (!args.jobsFile || !args.outDir) { console.error('usage: run-tsun.js --guard-tag genus-ruler/volsky/run.js [--max-min N] [--lock F] [--root DIR] [--watchdog-scale s] [--retry-watchdog] [--allow-dirty] jobs.json outDir W H [gen|load]'); process.exit(2); }
// 하네스 2: 표지 없이 띄운 덩어리는 동결 eval-grain.sh 가 못 봄 — 거부
if (args.guardTag !== L.GUARD_TAG) { console.error(`run-tsun: refusing — launch with --guard-tag ${L.GUARD_TAG} (tools/genus-ruler/tsun/run-tsun.sh run …) so eval-grain.sh guard_concurrent can see this chunk`); process.exit(2); }

// ── 자기 지킴: RULER-grain 과정이 돌고 있으면 시작하지 않음(자신·run-tsun 조상은 뺌). pgrep 이 없거나 실패하면 거부(닫힌 쪽으로).
const pgrepAll = pattern => {
  try { return execFileSync('pgrep', ['-af', pattern], { encoding: 'utf8' }); } catch (e) { if (e.status === 1) return ''; console.error('run-tsun: pgrep failed', e.message); process.exit(2); }
  return '';
};
{
  const bad = L.conflictingProcesses(pgrepAll(L.GRAIN_PATTERN), L.ancestorsOf(process.pid));
  if (bad.length) { console.error('run-tsun: RULER-grain process running — refusing:\n' + bad.map(p => `  ${p.pid} ${p.cmd}`).join('\n')); process.exit(2); }
  // 하네스 14(d): 죽은 grain 실행이 남긴 SwiftShader GPU 과정도 4 코어를 나눠 씀 — 시작 때는 이 실행기의 자식이 아직 없으니 보이면 남의 것
  const gpu = L.conflictingProcesses(pgrepAll(L.SWIFTSHADER_GPU_PATTERN), [process.pid]);
  if (gpu.length) { console.error('run-tsun: a SwiftShader Chromium GPU process is running (orphaned or another harness) — refusing:\n' + gpu.map(p => `  ${p.pid} ${p.cmd.slice(0, 160)}`).join('\n')); process.exit(2); }
}
let lock;
try { lock = L.acquireLock(args.lock); } catch (e) { console.error(String(e.message)); process.exit(2); }
if (lock.stale) console.log('run-tsun: removed stale lock', JSON.stringify(lock.stale));
const release = () => lock.release();
process.on('exit', release);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { release(); process.exit(130); });

const ROOT = path.resolve(args.root);
const FIX = path.join(__dirname, 'fixture');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const BUNDLE = path.join(ROOT, 'app.js');
if (!fs.existsSync(BUNDLE)) { console.error('run-tsun: no bundle ' + BUNDLE + ' (run-tsun.sh build)'); process.exit(2); }
const BUNDLE_SHA = sha(BUNDLE);
// 하네스 15: bundle.json(run-tsun.sh build)과 대조 — 두 번 묶어 같고, 그 sha 가 지금 app.js 이고, 깨끗한 트리에서 묶였어야(아니면 --allow-dirty)
let bundleInfo;
try { bundleInfo = JSON.parse(fs.readFileSync(path.join(ROOT, 'bundle.json'), 'utf8')); } catch (e) { console.error('run-tsun: no readable bundle.json next to app.js (run-tsun.sh build) — ' + e.message); process.exit(2); }
if (bundleInfo.same !== true || bundleInfo.bundleSha256 !== BUNDLE_SHA) { console.error(`run-tsun: bundle.json does not vouch for app.js (same ${bundleInfo.same}, sha ${String(bundleInfo.bundleSha256).slice(0, 16)} vs ${BUNDLE_SHA.slice(0, 16)})`); process.exit(2); }
if (Number(bundleInfo.dirtyFiles) > 0 && !args.allowDirty) { console.error(`run-tsun: bundle was built from a dirty tree (${bundleInfo.dirtyFiles} files) — commit first or pass --allow-dirty (development only)`); process.exit(2); }
// 하네스 6: 고정표(10 MB bin 은 git 밖)도 이어 그리기 열쇠와 meta 에
const FIXTURE_SHA = (() => { try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(FIX, 'tsun-fixture.json'))).update(fs.readFileSync(path.join(FIX, 'tsun-fixture.bin'))).digest('hex'); } catch { return null; } })();
let PLAYWRIGHT_VERSION = null;
try { PLAYWRIGHT_VERSION = require('/opt/node22/lib/node_modules/playwright/package.json').version; } catch { /* 기록만 */ }
const jobs = JSON.parse(fs.readFileSync(args.jobsFile, 'utf8'));
if (!Array.isArray(jobs)) { console.error('run-tsun: job file must be a JSON array'); process.exit(2); }
const mixed = L.mixedQualities(jobs);
if (mixed.length) { console.error('run-tsun: one job file mixes qualities ' + mixed.join('/') + ' — high jobs go on their own page (ruler-delta F4)'); process.exit(2); }
const dups = L.duplicateNames(jobs);
if (dups.length) { console.error('run-tsun: duplicate job names in one file (outputs and meta would overwrite each other): ' + dups.slice(0, 8).join(', ')); process.exit(2); }
if (args.atmos === 'load') {
  fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
  const src = path.join(__dirname, '../../../node_modules/@takram/three-atmosphere/assets');
  for (const f of fs.readdirSync(src)) if (f.endsWith('.bin')) fs.copyFileSync(path.join(src, f), path.join(ROOT, 'assets', f));
}
fs.mkdirSync(args.outDir, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="app.js"></script></body></html>');
// 고정표는 저장소 폴더에서 그대로(읽기만) — /tsun-fixture/tsun-fixture.json·.bin 두 파일만.
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const fx = u.match(/^\/tsun-fixture\/(tsun-fixture\.(json|bin))$/);
  const f = fx ? path.join(FIX, fx[1]) : path.join(ROOT, u);
  if ((!fx && !f.startsWith(ROOT)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : f.endsWith('.bin') ? 'application/octet-stream' : 'text/html' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const jobSha = j => crypto.createHash('sha256').update(JSON.stringify(j)).digest('hex');
const safe = s => { if (!/^[A-Za-z0-9_.+-]+$/.test(s)) throw new Error('bad name: ' + s); return s; };
const outOf = (j, suffix) => path.join(args.outDir, safe(j.name) + '.' + suffix);
/** 실패한 잡의 옛 최종 이름 출력을 지움(남아 있으면 tsun_photo.py 가 빈 그림을 셈 — 하네스 5). */
const clearOutputs = j => { for (const s of ['png', 'alpha.png', 'debug.png', 'debug.f16', 'cost-tsun.f16', 'meta.json']) { try { fs.unlinkSync(outOf(j, s)); } catch { /* 없음 */ } } };
/** 덩어리 끝: results.json(이름 → meta)을 기존 것에 합침(volsky run.js 와 같은 꼴). */
const mergeResults = metas => {
  if (!metas.length) return;
  const f = path.join(args.outDir, 'results.json');
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { cur = {}; }
  for (const m of metas) cur[m.name] = m;
  fs.writeFileSync(f + '.tmp', JSON.stringify(cur, null, 1)); fs.renameSync(f + '.tmp', f);
};

(async () => {
  const t0 = Date.now();
  const chunkEndsBy = new Date(t0 + args.maxMin * 60000).toISOString();
  const fits = j => (j.W == null || j.W === args.W) && (j.H == null || j.H === args.H) && (!j.canvas || (j.canvas[0] === args.W && j.canvas[1] === args.H));
  const done = j => { try { const mm = JSON.parse(fs.readFileSync(outOf(j, 'meta.json'), 'utf8')); return mm.captureOk === true && mm.bundleSha256 === BUNDLE_SHA && mm.jobSha256 === jobSha(j) && mm.fixtureSha256 === FIXTURE_SHA; } catch { return false; } };
  const wdHit = j => fs.existsSync(outOf(j, 'watchdog.txt'));
  const skippedWd = args.retryWatchdog ? [] : jobs.filter(j => fits(j) && !done(j) && wdHit(j));
  const todo = jobs.filter(j => fits(j) && !done(j) && (args.retryWatchdog || !wdHit(j)));
  console.log('bundle', BUNDLE_SHA.slice(0, 16), 'fixture', String(FIXTURE_SHA).slice(0, 16), 'jobs', jobs.length, 'other canvas', jobs.filter(j => !fits(j)).length, 'todo', todo.length,
    'skipped (watchdog earlier)', skippedWd.length, 'canvas', args.W + 'x' + args.H, 'lock', args.lock, 'chunk ends by', chunkEndsBy);
  if (skippedWd.length) console.log('run-tsun: skipping jobs that hit the watchdog in an earlier chunk (use --retry-watchdog): ' + skippedWd.map(j => j.name).slice(0, 8).join(', '));
  if (!todo.length) { server.close(); process.exit(skippedWd.length ? 4 : 0); }
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  /** 하네스 8e: 감시 시간에 걸린 뒤의 b.close() 도 묶일 수 있음 — 60 초와 경주하고 넘으면 그냥 끝냄. */
  const closeBrowser = async () => { await Promise.race([b.close().catch(() => {}), new Promise(r => setTimeout(r, 60000))]); };
  const p = await b.newPage({ viewport: { width: args.W, height: args.H } });
  p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); });
  await p.goto(`http://localhost:${server.address().port}/index.html?w=${args.W}&h=${args.H}${args.atmos === 'load' ? '&atmos=load' : ''}`, { waitUntil: 'commit', timeout: 120000 });
  await p.waitForFunction(() => /^READY::/.test(document.title), null, { timeout: 900000, polling: 1000 });
  const errs = await p.evaluate(() => window.__errors);
  if (errs.length) { console.log('errors', errs); await closeBrowser(); server.close(); process.exit(1); }
  const browserVersion = b.version();
  const fixture = await p.evaluate(() => window.__fixture);
  console.log('atmosphere ms', Math.round(await p.evaluate(() => window.__atmosMs)), 'chromium', browserVersion, 'playwright', PLAYWRIGHT_VERSION, 'fixture', JSON.stringify(fixture).slice(0, 120));
  let left = 0, failed = 0, code = 0;
  const metas = [];
  const failJob = (job, msg, extra = {}) => {
    failed++;
    console.log(job.name, 'ERROR', msg.slice(0, 400));
    clearOutputs(job);
    fs.writeFileSync(outOf(job, 'error.txt'), msg);
    fs.appendFileSync(path.join(args.outDir, 'results.jsonl'), JSON.stringify({ name: job.name, error: msg.slice(0, 2000), bundleSha256: BUNDLE_SHA, fixtureSha256: FIXTURE_SHA, chunkEndsBy, ...extra }) + '\n');
  };
  for (let k = 0; k < todo.length; k++) {
    const job = todo[k];
    let wd;
    try { wd = L.watchdogMs(job, args.watchdogScale, { W: args.W, H: args.H, first: k === 0 }); } catch (e) { failJob(job, String(e.message)); continue; }
    // 하네스 3: 이 잡의 감시 시간이 덩어리 끝을 넘으면 시작하지 않음(처음 판은 한도 직전에 REF 를 시작해 2 시간을 25~50 분 넘길 수 있었음)
    if (!L.startsWithinChunk((Date.now() - t0) / 60000, wd, args.maxMin)) { left = todo.length - k; break; }
    const ts = Date.now();
    let r, timer;
    try {
      r = await Promise.race([p.evaluate(j => window.__job(j), job), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('WATCHDOG ' + Math.round(wd / 60000) + ' min')), wd); })]);
    } catch (e) {
      const msg = String(e && e.message || e);
      failJob(job, msg, { wallMsOuter: Date.now() - ts });
      // 감시 시간·맥락 손실: 페이지가 GPU 그리기에 묶였거나 맥락이 없음 — 덩어리를 끝냄(같은 덩어리 안에서 다시 하지 않음).
      if (/^WATCHDOG/.test(msg)) { fs.writeFileSync(outOf(job, 'watchdog.txt'), `${new Date().toISOString()} ${msg} (watchdog ${wd} ms)\n`); code = 5; break; }
      if (/context was lost|webglcontextlost/.test(msg)) { code = 6; break; }
      continue;
    } finally { clearTimeout(timer); }
    const wallOuter = Date.now() - ts;
    // 하네스 5: 맥락 손실·GL 오류(captureOk false)인 잡은 그림·meta 를 쓰지 않음 — 이어 그리기에서 '끝남'으로 보이지 않게
    if (!r || !r.meta || r.meta.captureOk !== true || r.meta.ctxLost) {
      failJob(job, `capture not ok (captureOk ${r && r.meta && r.meta.captureOk}, ctxLost ${r && r.meta && r.meta.ctxLost}, glError ${r && r.meta && r.meta.glError}, glErrors ${JSON.stringify(r && r.meta && r.meta.glErrors)})`, { wallMsOuter: wallOuter });
      if (r && r.meta && r.meta.ctxLost) { code = 6; break; }
      continue;
    }
    for (const [suffix, url] of Object.entries(r.files || {})) fs.writeFileSync(outOf(job, suffix), Buffer.from(String(url).split(',')[1], 'base64'));
    try { fs.unlinkSync(outOf(job, 'error.txt')); } catch { /* 없음 */ }
    try { fs.unlinkSync(outOf(job, 'watchdog.txt')); } catch { /* 없음 */ }
    const meta = { ...r.meta, bundleSha256: BUNDLE_SHA, jobSha256: jobSha(job), fixtureSha256: FIXTURE_SHA, wallMsOuter: wallOuter, chromium: browserVersion, playwright: PLAYWRIGHT_VERSION,
      bundle: { esbuild: bundleInfo.esbuild, gitHead: bundleInfo.gitHead, dirtyFiles: bundleInfo.dirtyFiles }, atmos: args.atmos,
      canvas: [args.W, args.H], pageJobIndex: k, finishedAt: new Date().toISOString(), chunkEndsBy, guardTag: args.guardTag, watchdogMs: wd, files: Object.keys(r.files || {}) };
    const mf = outOf(job, 'meta.json');
    fs.writeFileSync(mf + '.tmp', JSON.stringify(meta, null, 1)); fs.renameSync(mf + '.tmp', mf);
    metas.push(meta);
    fs.appendFileSync(path.join(args.outDir, 'results.jsonl'), JSON.stringify({ name: job.name, kind: meta.kind, bundleSha256: BUNDLE_SHA, fixtureSha256: FIXTURE_SHA, chunkEndsBy, wallMsOuter: wallOuter, ms: meta.ms, frameMsMax: meta.frameMs && meta.frameMs.max, captureOk: meta.captureOk, cost: meta.cost || null, debug: meta.debug || null, tsun: meta.tsun, cloudSamplers: meta.cloudSamplers || null }) + '\n');
    console.log(job.name, meta.kind, 'wall', (wallOuter / 1000).toFixed(1) + 's', 'ok', meta.captureOk, meta.cost ? JSON.stringify(meta.cost).slice(0, 160) : '');
  }
  mergeResults(metas);
  await closeBrowser(); server.close();
  if (failed) console.log('failed jobs', failed);
  if (code) process.exit(code);
  if (left) { console.log('time limit: jobs left', left, '(next job would cross', chunkEndsBy + ')'); process.exit(3); }
  if (failed || skippedWd.length) process.exit(4);
})().catch(e => { console.error(e); process.exit(1); });
