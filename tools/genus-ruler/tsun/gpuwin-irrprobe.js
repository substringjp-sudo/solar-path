/**
 * §180 L7irrprobe — 구름 패스 GetIrradiance(r, μs) 를 텍셀마다 바로 읽는 GPU 탐침 실행기(+ P1 덮개 산란 자르기 탐침).
 * L3twilight(구름 덮개 평균 휘도의 ln 잔차)은 깊은 박명 휘도 ~1e−7 · 0 잘림 · 바뀌는 화소 마스크 때문에 잡음이 지배해 §178 조도 고침을 보이지 못했음
 * (−10..−6° rms 끔 0.60 · 켬 0.66). 이 탐침은 조도 함수 자체를 해 −12..+10°(0.05°) × 높이 0·2·5·7.4 km 격자에서 읽어, 같은 GPU 표로 계산한
 * CPU 이식(gpuwin-irrcpu.js)·세밀 기준표(fixtures/irradiance-app15.json fine)와 대조합니다. 페이지·셰이더는 gpuwin-irrentry.ts · gpuwin-irrshader.ts.
 *
 * lighting-render-check.js 와 같은 지킴·잠금(그 파일은 창이 단계마다 다시 읽으므로 고치지 않고 따로 둠):
 *   --guard-tag genus-ruler/volsky/run.js 필수(동결 eval-grain.sh guard_concurrent 가 이 페이지를 봄) · RULER-grain 과정이 보이면 거부 ·
 *   SwiftShader GPU 과정이 이미 있으면 거부 · /tmp/run-tsun.lock(run-tsun·조명 단계와 같은 잠금) · 출력은 .harness/·grain·volsky·src 아래 금지 ·
 *   bundle.json 이 app.js 를 보증(두 번 묶어 같음)·더러운 트리 번들은 --allow-dirty 일 때만.
 *
 *   nice -n 19 node tools/genus-ruler/tsun/gpuwin-irrprobe.js build --root <GW_ROOT>/bundle-irr          번들(esbuild 두 번 · bundle.json)
 *   nice -n 19 node tools/genus-ruler/tsun/gpuwin-irrprobe.js run --guard-tag genus-ruler/volsky/run.js --root <GW_ROOT>/bundle-irr \
 *       --scenes <GW_ROOT>/jobs/light-scenes.json --out <OUT>/L [--max-min 58] [--lock /tmp/run-tsun.lock] [--fixture F] [--allow-dirty] [--dry]
 *   node tools/genus-ruler/tsun/gpuwin-irrprobe.js analyze --raw <OUT>/L/L7irrprobe.raw.json [--fixture F] [--json OUT]   (브라우저 없이 다시 분석)
 *   node tools/genus-ruler/tsun/gpuwin-irrprobe.js estimate                                                      (시간 어림)
 * 출력: <out>/L7irrprobe.json(요약·지표 — 열쇠 key = 번들·장면·이 파일·CPU 파일·고정표·인자 sha, ok) · <out>/L7irrprobe.raw.json(GPU 원값).
 *   같은 열쇠의 ok 출력이 있으면 건너뜀(종료 0). 종료: 0 끝·건너뜀 · 1 오류 · 2 거부 · 3 시간 한도 · 6 맥락 손실(lighting-render-check 와 같음).
 * 시간 [estimate]: 페이지 하나 = 대기 생성 3~12 분(c0.log 7.5~12 [measured]) + 구름 패스 low 컴파일·2 프레임 1~3 분 + 탐침 프로그램 7~8 개 컴파일·그리기 < 2 분.
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const L = require('./run-tsun-lib');
const G = require('./gpuwin-lib');
const C = require('./gpuwin-irrcpu');

const REPO = path.resolve(__dirname, '..', '..', '..');
const STAGE = 'L7irrprobe';
const CANVAS = [400, 300];
const DEFAULT_FIXTURE = path.join(REPO, 'tools/shader-preview/fixtures/irradiance-app15.json');
const ENTRY = 'tools/genus-ruler/tsun/gpuwin-irrentry.ts';
/** 시간 어림(분) [estimate] — 대기 생성은 gpuwin-lib ATMOS_MIN([measured] c0.log), 나머지는 L1compile low 컴파일 1~2.5 분 [measured 범위] + 탐침. */
const EST = { atmos: G.ATMOS_MIN, start: [0.5, 1], sceneCompile: [1, 3], probe: [0.5, 2], close: [G.PAGE_END_MIN, G.PAGE_END_MIN] };
const estimateMin = () => [0, 1].map(i => EST.atmos[i] + EST.start[i] + EST.sceneCompile[i] + EST.probe[i] + EST.close[i]);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

/** 명령 줄 → 인자(시험이 그대로 부름). 오류는 { error, code: 2 }. */
function parseArgs(argvIn) {
  const argv = argvIn.slice();
  const cmd = argv.length && !argv[0].startsWith('--') ? argv.shift() : 'run';
  const err = m => ({ error: m, code: 2 });
  const take = (k, d = null) => { const i = argv.indexOf(k); if (i < 0) return d; if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`${k} needs a value`); const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const flag = k => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; };
  let a;
  try {
    a = { cmd, guardTag: take('--guard-tag'), root: take('--root'), scenes: take('--scenes'), out: take('--out'), maxMin: Number(take('--max-min', String(G.LIGHT_MAX_MIN))),
      lock: take('--lock', process.env.TSUN_LOCK || '/tmp/run-tsun.lock'), fixture: take('--fixture', DEFAULT_FIXTURE), raw: take('--raw'), json: take('--json'),
      allowDirty: flag('--allow-dirty'), dry: flag('--dry') };
  } catch (e) { return err('gpuwin-irrprobe: ' + e.message); }
  if (argv.length) return err('gpuwin-irrprobe: unknown argument(s) ' + argv.join(' '));
  if (!['run', 'build', 'analyze', 'estimate'].includes(cmd)) return err('gpuwin-irrprobe: command must be run|build|analyze|estimate');
  if (cmd === 'build') { if (!a.root) return err('gpuwin-irrprobe build: --root is required'); const bad = G.forbiddenPath(a.root); if (bad) return err(`gpuwin-irrprobe: refusing to write under ${a.root} — ${bad}`); return a; }
  if (cmd === 'analyze') { if (!a.raw) return err('gpuwin-irrprobe analyze: --raw is required'); if (a.json) { const bad = G.forbiddenPath(a.json); if (bad) return err(`gpuwin-irrprobe: refusing to write ${a.json} — ${bad}`); } return a; }
  if (cmd === 'estimate') return a;
  if (a.guardTag !== L.GUARD_TAG) return err(`gpuwin-irrprobe: refusing — launch with --guard-tag ${L.GUARD_TAG} so eval-grain.sh guard_concurrent sees this page`);
  if (!(a.maxMin > 0 && a.maxMin <= G.CHUNK_MAX_MIN)) return err(`gpuwin-irrprobe: --max-min must be in (0, ${G.CHUNK_MAX_MIN}]`);
  for (const k of ['root', 'scenes', 'out']) if (!a[k]) return err('gpuwin-irrprobe: --' + k + ' is required');
  { const bad = G.forbiddenPath(a.out) || G.forbiddenPath(a.root); if (bad) return err(`gpuwin-irrprobe: refusing to write under ${a.out} / ${a.root} — ${bad}`); }
  return a;
}
/** 지킴(브라우저 전): grain 무늬 과정(자기·이 실행기 이름은 뺌) · SwiftShader GPU 과정. pg = 무늬 → pgrep -af 출력. 문제 목록(비면 통과). */
function guardProblems(pg, selfPid = process.pid) {
  const anc = L.ancestorsOf(selfPid);
  const bad = L.conflictingProcesses(pg(L.GRAIN_PATTERN), anc).filter(p => !/gpuwin-irrprobe/.test(p.cmd));
  const gpu = L.conflictingProcesses(pg(L.SWIFTSHADER_GPU_PATTERN), [selfPid]);
  return [...bad.map(p => ({ ...p, why: 'RULER-grain (or tagged) process' })), ...gpu.map(p => ({ ...p, why: 'SwiftShader GPU process' }))];
}
/** 페이지에 넘길 탐침 인자(e·μs 는 node 에서 만들어 양쪽이 같은 float32 값). */
function probeParams(S, p = C.DEFAULT_PARAMS) {
  const es = C.eGrid(p);
  return { scene: { input: S.P1B.input, options: S.P1B.options }, heightsKm: p.heightsKm.slice(), es, mus: es.map(C.muOf), aerial: { grid: p.aerial.grid.slice(), deckKm: p.aerial.deckKm } };
}
/** 열쇠: 번들(entry·셰이더 조립 글자 포함) · 장면 · 이 파일 · CPU 파일 · 고정표 · 인자 · 캔버스. */
function keyOf(o) { return sha(JSON.stringify({ stage: STAGE, bundle: o.bundleSha, scenes: o.scenesSha, self: o.selfSha, cpu: o.cpuSha, fixture: o.fixtureSha, params: sha(JSON.stringify(o.params)), canvas: CANVAS })); }
/** 번들 폴더 점검(bundle.json 이 app.js 를 보증). 문제면 글자. */
function bundleProblem(root, allowDirty) {
  const app = path.join(root, 'app.js');
  if (!fs.existsSync(app)) return 'no bundle ' + app + ' (build first: gpuwin-irrprobe.js build --root ' + root + ')';
  let info; try { info = JSON.parse(fs.readFileSync(path.join(root, 'bundle.json'), 'utf8')); } catch (e) { return 'no bundle.json next to app.js — ' + e.message; }
  if (info.same !== true || info.bundleSha256 !== sha(fs.readFileSync(app))) return 'bundle.json does not vouch for app.js';
  if (info.entry !== ENTRY) return `bundle.json entry ${info.entry} is not ${ENTRY}`;
  if (Number(info.dirtyFiles) > 0 && !allowDirty) return `bundle built from a dirty tree (${info.dirtyFiles} files) — commit first or pass --allow-dirty`;
  return null;
}
/** 번들 만들기(build_light 와 같은 꼴 — 두 번 묶어 같은지). */
function build(root) {
  fs.mkdirSync(path.join(root, '.again'), { recursive: true });
  const outs = [path.join(root, 'app.js'), path.join(root, '.again', 'app.js')];
  for (const o of outs) execFileSync('npx', ['esbuild', ENTRY, '--bundle', '--format=esm', `--outfile=${o}`, '--define:__DEV__=false', '--define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY="1"', '--log-level=warning'], { cwd: REPO, stdio: 'inherit' });
  const A = sha(fs.readFileSync(outs[0])), B = sha(fs.readFileSync(outs[1]));
  const ver = execFileSync('npx', ['esbuild', '--version'], { cwd: REPO, encoding: 'utf8' }).trim();
  const head = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' }).split('\n').filter(Boolean).length;
  const info = { bundleSha256: A, again: B, same: A === B, esbuild: ver, gitHead: head, dirtyFiles: dirty, entry: ENTRY };
  fs.writeFileSync(path.join(root, 'bundle.json'), JSON.stringify(info) + '\n');
  return info;
}
/** 원값 → 지표(브라우저 뒤·analyze 명령 공통). */
function analyzeAll(raw, fixturePath, params = C.DEFAULT_PARAMS) {
  const fxd = fixturePath && fs.existsSync(fixturePath) ? C.loadFixture(JSON.parse(fs.readFileSync(fixturePath, 'utf8'))) : null;
  const irr = C.analyzeIrr(raw, fxd, params), tvf = C.tableVsFixture(raw, fxd), aerial = raw.aerial ? C.analyzeAerial(raw.aerial, params) : null;
  return { irr, tableVsFixture: tvf, aerial, summary: C.summarize(irr, aerial, tvf), fixture: fxd ? path.relative(REPO, fixturePath) : null };
}

module.exports = { STAGE, CANVAS, EST, estimateMin, parseArgs, guardProblems, probeParams, keyOf, bundleProblem, analyzeAll, DEFAULT_FIXTURE, ENTRY };

// ───── 실행 ─────
if (require.main === module) {
  const a = parseArgs(process.argv.slice(2));
  if (a.error) { console.error(a.error); process.exit(a.code); }
  if (a.cmd === 'estimate') { const [lo, hi] = estimateMin(); console.log(JSON.stringify({ stage: STAGE, estimateMin: [lo, hi], parts: EST, note: 'one page: atmosphere + start + cloud-pass low compile/2 frames + probe programs + close [estimate]' })); process.exit(0); }
  if (a.cmd === 'build') { const info = build(path.resolve(a.root)); console.log(JSON.stringify(info)); process.exit(info.same ? 0 : 1); }
  if (a.cmd === 'analyze') {
    const raw = JSON.parse(fs.readFileSync(a.raw, 'utf8'));
    const res = analyzeAll(raw, a.fixture);
    if (a.json) { fs.writeFileSync(a.json + '.tmp', JSON.stringify(res, null, 1)); fs.renameSync(a.json + '.tmp', a.json); }
    console.log(res.summary.join('\n')); process.exit(0);
  }
  const ROOT = path.resolve(a.root);
  { const bp = bundleProblem(ROOT, a.allowDirty); if (bp) { console.error('gpuwin-irrprobe: ' + bp); process.exit(2); } }
  const BUNDLE_SHA = sha(fs.readFileSync(path.join(ROOT, 'app.js')));
  const bundleInfo = JSON.parse(fs.readFileSync(path.join(ROOT, 'bundle.json'), 'utf8'));
  let S, scenesBuf;
  try { scenesBuf = fs.readFileSync(a.scenes); S = JSON.parse(scenesBuf); } catch (e) { console.error('gpuwin-irrprobe: cannot read --scenes ' + e.message); process.exit(2); }
  if (!S.P1B || !S.P1B.input) { console.error('gpuwin-irrprobe: scenes file has no P1B'); process.exit(2); }
  const params = probeParams(S);
  const fixtureSha = fs.existsSync(a.fixture) ? sha(fs.readFileSync(a.fixture)) : 'none';
  const KEY = keyOf({ bundleSha: BUNDLE_SHA, scenesSha: sha(scenesBuf), selfSha: sha(fs.readFileSync(__filename)), cpuSha: sha(fs.readFileSync(path.join(__dirname, 'gpuwin-irrcpu.js'))), fixtureSha, params });
  const outFile = path.join(a.out, STAGE + '.json'), rawFile = path.join(a.out, STAGE + '.raw.json');
  const prev = (() => { try { return JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { return null; } })();
  if (prev && prev.key === KEY && prev.ok === true) { console.log(`gpuwin-irrprobe: ${STAGE} already done with the same key — skip`); process.exit(0); }
  // 지킴
  let probs;
  try { probs = guardProblems(pat => G.pgrepAf(pat)); } catch (e) { console.error('gpuwin-irrprobe: ' + e.message); process.exit(2); }
  if (probs.length) { console.error('gpuwin-irrprobe: refusing — conflicting process(es):\n' + probs.map(p => `  ${p.pid} [${p.why}] ${p.cmd.slice(0, 160)}`).join('\n')); process.exit(2); }
  if (a.dry) {
    console.log(JSON.stringify({ dry: true, stage: STAGE, maxMin: a.maxMin, canvas: CANVAS, bundle: BUNDLE_SHA.slice(0, 16), key: KEY.slice(0, 16), out: outFile, wouldSkip: false,
      grid: { n: params.es.length, heights: params.heightsKm, aerial: params.aerial.grid }, paramsBytes: JSON.stringify(params).length, estimateMin: estimateMin(), fixture: fixtureSha.slice(0, 16) }));
    process.exit(0);
  }
  let lock;
  try { lock = L.acquireLock(a.lock); } catch (e) { console.error(String(e.message)); process.exit(2); }
  process.on('exit', () => lock.release());
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { lock.release(); process.exit(130); });

  fs.mkdirSync(a.out, { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="app.js"></script></body></html>');
  const server = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : 'text/html' });
    fs.createReadStream(f).pipe(res);
  }).listen(0);

  (async () => {
    const t0 = Date.now(), deadline = t0 + a.maxMin * 60000;
    const { chromium } = require('/opt/node22/lib/node_modules/playwright');
    const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const closeBrowser = async () => { await Promise.race([b.close().catch(() => {}), new Promise(r => setTimeout(r, 60000))]); };
    const finish = async (code, msg) => { if (msg) console.error(msg); await closeBrowser(); server.close(); process.exit(code); };
    let timer;
    const left = () => Math.max(1000, deadline - Date.now());
    try {
      const pg = await b.newPage({ viewport: { width: CANVAS[0], height: CANVAS[1] } });
      pg.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); });
      await pg.goto(`http://localhost:${server.address().port}/index.html?w=${CANVAS[0]}&h=${CANVAS[1]}`, { waitUntil: 'commit', timeout: 120000 });
      await pg.waitForFunction(() => /^READY::/.test(document.title), null, { timeout: Math.min(900000, left()), polling: 1000 });
      const errs = await pg.evaluate(() => window.__errors);
      if (errs.length) return finish(1, 'page errors: ' + JSON.stringify(errs).slice(0, 2000));
      const atmosMs = await pg.evaluate(() => window.__atmosMs), spectral = await pg.evaluate(() => window.__spectral);
      console.log(STAGE, 'atmosphere ms', Math.round(atmosMs), 'spectral', spectral, 'chromium', b.version());
      const r = await Promise.race([pg.evaluate(prm => window.__irrProbe(prm), params),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('TIME LIMIT ' + a.maxMin + ' min')), left()); })]);
      clearTimeout(timer);
      const raw = r.result.raw; delete r.result.raw;
      fs.writeFileSync(rawFile + '.tmp', JSON.stringify(raw)); fs.renameSync(rawFile + '.tmp', rawFile);
      let analysis = null, analysisError = null;
      try { analysis = analyzeAll(raw, a.fixture); } catch (e) { analysisError = String(e && e.stack || e).slice(0, 2000); }
      const tc = r.result.textChecks || {};
      const checks = { prefixOnEqualsInjectedOff: tc.onEqualsInjected === true, prefixOffIsTakramOriginal: tc.offHasAnchor === true && tc.offMarks === 0, prefixOnMarked: tc.onMarks === 1,
        vertexSameGetIrradiance: !!(tc.vertexGetIrradianceSameAsFragment && tc.vertexGetIrradianceSameAsFragment.off && tc.vertexGetIrradianceSameAsFragment.on),
        packReadbackBitExact: r.result.packCheck ? r.result.packCheck.texelsDiffering === 0 : null, spectral: spectral === true };
      const ok = !r.ctxLost && r.glError === 0 && !(r.errors || []).length && !(r.shaderErrors || []).length && !(r.brokenPrograms || []).length && !analysisError;
      const rec = { stage: STAGE, key: KEY, ok, bundleSha256: BUNDLE_SHA, scenesSha256: sha(scenesBuf), bundle: { esbuild: bundleInfo.esbuild, gitHead: bundleInfo.gitHead, dirtyFiles: bundleInfo.dirtyFiles, entry: bundleInfo.entry },
        chromium: b.version(), atmosMs, spectral, wallMin: (Date.now() - t0) / 60000, finishedAt: new Date().toISOString(), guardTag: a.guardTag, checks, analysisError,
        ...r, analysis, rawFile: path.basename(rawFile), params: { heightsKm: params.heightsKm, e: [params.es[0], params.es[params.es.length - 1], C.DEFAULT_PARAMS.eStep], aerial: params.aerial } };
      fs.writeFileSync(outFile + '.tmp', JSON.stringify(rec, null, 1)); fs.renameSync(outFile + '.tmp', outFile);
      if (analysis) console.log(analysis.summary.join('\n'));
      console.log(STAGE, ok ? 'OK' : 'NOT OK', 'wall', rec.wallMin.toFixed(1), 'min', JSON.stringify(checks));
      return finish(r.ctxLost ? 6 : ok ? 0 : 1);
    } catch (e) {
      clearTimeout(timer);
      const msg = String(e && e.message || e);
      fs.writeFileSync(path.join(a.out, STAGE + '.error.txt'), `${new Date().toISOString()} ${msg}\n`);
      return finish(/^TIME LIMIT/.test(msg) ? 3 : /context was lost|webglcontextlost/.test(msg) ? 6 : 1, STAGE + ' ERROR ' + msg.slice(0, 1000));
    }
  })().catch(e => { console.error(e); process.exit(1); });
}
