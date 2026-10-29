/**
 * §179 RULER-tsun 실행기(WP8 — ruler-delta B2, RULER-tsun §5.0 ①) — entry-tsun 번들을 SwiftShader Chromium 한 페이지에서 잡마다 이어 그립니다.
 * **RULER-grain 렌더와 동시에 돌리지 않습니다**: 시작 전 자기 지킴(pgrep — run-tsun-lib.js), 잠금 파일, 덩어리 ≤ 2 시간(--max-min, 기본 110).
 * 예약된 기계 창(B0·B2 보정 렌더)에서만 — 사용자/조정자가 정함(ruler-delta B4·U8). 판정 회차 없음(2026-10-28 사용자 결정).
 *
 *   띄우기(ruler-delta B2 의 줄 — 표지 덕에 동결 eval-grain.sh 의 guard_concurrent 가 이 덩어리를 봄):
 *     VROOT=<번들 폴더> nice -n 19 node tools/genus-ruler/tsun/run-tsun.js --guard-tag genus-ruler/volsky/run.js jobs.json outDir W H [gen|load]
 *   선택: --max-min N(기본 110) · --lock 파일(기본 /tmp/run-tsun.lock) · --root 번들 폴더(VROOT 대신) · --watchdog-scale s · --atmos load|gen
 *   번들: tools/genus-ruler/tsun/run-tsun.sh build <폴더>(두 번 빌드해 sha 같음 확인).
 *
 * 잡(entry-tsun.ts 머리말): 새 손잡이 9 개 명시, image · debug(tsunDebug 1) · cost(grain.mode 'cost'). 잡 W·H(또는 canvas)가 이 호출의 크기와 다르면 건너뜀.
 * 출력: outDir/<잡>.png · .alpha.png(그림) · .debug.png · .debug.f16(R-A_T) · .cost.f16(비용) · <잡>.meta.json(마지막에, 임시 → 이름 바꾸기) ·
 *       results.jsonl(잡마다 한 줄). 이어 그리기: <잡>.meta.json 의 bundleSha256·jobSha256 가 같으면 건너뜀.
 * 종료 코드: 0 끝 · 2 거부(지킴·잠금·품질 섞기·인자) · 3 시간 한도(남은 잡) · 4 잡 실패 있음 · 5 감시 시간 넘김(덩어리 끝) · 6 맥락 손실(덩어리 끝).
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const L = require('./run-tsun-lib');

const args = L.parseArgs(process.argv.slice(2), process.env);
if (!args.jobsFile || !args.outDir) { console.error('usage: run-tsun.js [--guard-tag X] [--max-min N] [--lock F] [--root DIR] jobs.json outDir W H [gen|load]'); process.exit(2); }

// ── 자기 지킴: RULER-grain 과정이 돌고 있으면 시작하지 않음(자신·조상은 뺌).
{
  let out = '';
  try { out = execFileSync('pgrep', ['-af', L.GRAIN_PATTERN], { encoding: 'utf8' }); } catch (e) { out = e.status === 1 ? '' : (() => { console.error('run-tsun: pgrep failed', e.message); process.exit(2); })(); }
  const bad = L.conflictingProcesses(out, L.ancestorsOf(process.pid));
  if (bad.length) { console.error('run-tsun: RULER-grain process running — refusing:\n' + bad.map(p => `  ${p.pid} ${p.cmd}`).join('\n')); process.exit(2); }
}
if (args.guardTag !== L.GUARD_TAG) console.log(`run-tsun: warning — launched without --guard-tag ${L.GUARD_TAG}; eval-grain.sh cannot see this chunk`);
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
const jobs = JSON.parse(fs.readFileSync(args.jobsFile, 'utf8'));
const mixed = L.mixedQualities(jobs);
if (mixed.length) { console.error('run-tsun: one job file mixes qualities ' + mixed.join('/') + ' — high jobs go on their own page (ruler-delta F4)'); process.exit(2); }
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

(async () => {
  const t0 = Date.now();
  const fits = j => (j.W == null || j.W === args.W) && (j.H == null || j.H === args.H) && (!j.canvas || (j.canvas[0] === args.W && j.canvas[1] === args.H));
  const done = j => { const m = path.join(args.outDir, safe(j.name) + '.meta.json'); try { const mm = JSON.parse(fs.readFileSync(m, 'utf8')); return mm.bundleSha256 === BUNDLE_SHA && mm.jobSha256 === jobSha(j); } catch { return false; } };
  const todo = jobs.filter(j => fits(j) && !done(j));
  console.log('bundle', BUNDLE_SHA.slice(0, 16), 'jobs', jobs.length, 'other canvas', jobs.filter(j => !fits(j)).length, 'todo', todo.length, 'canvas', args.W + 'x' + args.H, 'lock', args.lock);
  if (!todo.length) { server.close(); process.exit(0); }
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: args.W, height: args.H } });
  p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); });
  await p.goto(`http://localhost:${server.address().port}/index.html?w=${args.W}&h=${args.H}${args.atmos === 'load' ? '&atmos=load' : ''}`, { waitUntil: 'commit', timeout: 120000 });
  await p.waitForFunction(() => /^READY::/.test(document.title), null, { timeout: 900000, polling: 1000 });
  const errs = await p.evaluate(() => window.__errors);
  if (errs.length) { console.log('errors', errs); await b.close(); server.close(); process.exit(1); }
  const browserVersion = b.version();
  const fixture = await p.evaluate(() => window.__fixture);
  console.log('atmosphere ms', Math.round(await p.evaluate(() => window.__atmosMs)), 'chromium', browserVersion, 'fixture', JSON.stringify(fixture).slice(0, 120));
  let left = 0, failed = 0, code = 0;
  for (let k = 0; k < todo.length; k++) {
    const job = todo[k];
    if (args.maxMin > 0 && (Date.now() - t0) / 60000 > args.maxMin) { left = todo.length - k; break; }
    const ts = Date.now(), wd = L.watchdogMs(job, args.watchdogScale);
    let r, timer;
    try {
      r = await Promise.race([p.evaluate(j => window.__job(j), job), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('WATCHDOG ' + Math.round(wd / 60000) + ' min')), wd); })]);
    } catch (e) {
      failed++;
      const msg = String(e && e.message || e);
      console.log(job.name, 'ERROR', msg.slice(0, 400));
      fs.writeFileSync(path.join(args.outDir, safe(job.name) + '.error.txt'), msg);
      fs.appendFileSync(path.join(args.outDir, 'results.jsonl'), JSON.stringify({ name: job.name, error: msg.slice(0, 2000), bundleSha256: BUNDLE_SHA, wallMsOuter: Date.now() - ts }) + '\n');
      // 감시 시간·맥락 손실: 페이지가 GPU 그리기에 묶였거나 맥락이 없음 — 덩어리를 끝냄(같은 덩어리 안에서 다시 하지 않음).
      if (/^WATCHDOG/.test(msg)) { code = 5; break; }
      if (/context was lost|webglcontextlost/.test(msg)) { code = 6; break; }
      continue;
    } finally { clearTimeout(timer); }
    const wallOuter = Date.now() - ts;
    for (const [suffix, url] of Object.entries(r.files || {})) fs.writeFileSync(path.join(args.outDir, safe(job.name) + '.' + suffix), Buffer.from(String(url).split(',')[1], 'base64'));
    const meta = { ...r.meta, bundleSha256: BUNDLE_SHA, jobSha256: jobSha(job), wallMsOuter: wallOuter, chromium: browserVersion, atmos: args.atmos,
      canvas: [args.W, args.H], pageJobIndex: k, finishedAt: new Date().toISOString(), guardTag: args.guardTag, watchdogMs: wd, files: Object.keys(r.files || {}) };
    const mf = path.join(args.outDir, safe(job.name) + '.meta.json');
    fs.writeFileSync(mf + '.tmp', JSON.stringify(meta, null, 1)); fs.renameSync(mf + '.tmp', mf);
    fs.appendFileSync(path.join(args.outDir, 'results.jsonl'), JSON.stringify({ name: job.name, kind: meta.kind, bundleSha256: BUNDLE_SHA, wallMsOuter: wallOuter, ms: meta.ms, frameMsMax: meta.frameMs && meta.frameMs.max, captureOk: meta.captureOk, cost: meta.cost || null, debug: meta.debug || null, tsun: meta.tsun }) + '\n');
    console.log(job.name, meta.kind, 'wall', (wallOuter / 1000).toFixed(1) + 's', 'ok', meta.captureOk, meta.cost ? JSON.stringify(meta.cost).slice(0, 160) : '');
    if (meta.ctxLost) { code = 6; break; }
  }
  await b.close(); server.close();
  if (failed) console.log('failed jobs', failed);
  if (code) process.exit(code);
  if (left) { console.log('time limit: jobs left', left); process.exit(3); }
  if (failed) process.exit(4);
})().catch(e => { console.error(e); process.exit(1); });
