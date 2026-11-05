#!/usr/bin/env node
/**
 * g1-baseline.mjs — 조각(a·b·d)과 G1(c) qKey 를 모아 tools/genus-ruler/oro/g1-baseline.json 을 씁니다(S3-design.md §8 꼴).
 *
 *   node tools/genus-ruler/oro/g1/g1-baseline.mjs --parts .harness/oro/g1/parts --jobs tools/genus-ruler/oro/g1/jobs-g1.json
 *        --inputs tools/genus-ruler/oro/oro-inputs.json --out tools/genus-ruler/oro/g1-baseline.json [--final]
 *
 * 조각: a.json(g1-md5.mjs), b.json(g1-render.mjs), d.json(g1-live.mjs). 모두 같은 HEAD·같은 잡 파일·같은 하네스 번들에서 나왔는지,
 * A/A·키 실행 일치·대조 실행 일치가 참인지 확인하고, 하나라도 어긋나면 쓰지 않고 exit 1.
 * (c) qKey = SkyScene3D.tsx 의 `const q = …` · `const qKey = `…`` 식 그대로(g1-lib extractQKey), 설정 = 잡(settingsOfJob).
 * 날씨 키 = g1-keys.cjs 가 잡은 weatherPlan 키(b.json keys).
 * oro-inputs 에서는 pendingSites(탐측 대기 사이트 수)만 읽습니다(MODIS 없음).
 * 커밋·도구 상태(git 은 --quiet·--porcelain 만): commit = HEAD, 합친 커밋 이후 src 변경 없음, src·volsky 작업 트리 깨끗,
 * G1 도구가 커밋돼 있는지(지금은 아니라 false — 자 L862 의 G1 기준 커밋은 이 도구를 넣은 커밋).
 * 부하(build note 19): b.json 의 run1·run2·control·keys 네 단계가 모두 놀던 컨테이너에서 시작했고(before loadavg < 1.0, pcpu ≥ 50
 * 프로세스 없음) 그리는 동안 남의 CPU 가 0.5 코어 아래였어야 씁니다. 수치는 b.json 에만 남기고 여기에는 참·거짓만(재조립 바이트 같음).
 * 최종(build note 20): status.final = 아래 모두 참 — G1 도구 커밋됨, 잰 커밋이 제 부모에서 tools/genus-ruler/oro/g1 밖을 바꾸지 않음,
 * src = 115fbe2, volsky = ece32b1(묶기 고침), 입력 파일이 그 커밋에 그대로 커밋됨, 탐측·고리 대기 사이트 0, 조각·조립이 모두 그 커밋,
 * 부하 지킴 통과. 아니면 status.notFinal 에 까닭. --final 이면 final 이 아닐 때 쓰지 않고 exit 1(FROZEN runtime 에 넣을 판).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ESBUILD, ROOT, SKY_SCENE, canonicalJson, die as die0, extractQKey, forbiddenPath, gitPorcelain, gitQuiet, parseArgs,
  resolveCommit, settingsOfJob, sha256,
} from './g1-lib.mjs';

const TOOL = 'g1-baseline';
const die = (m, c) => die0(TOOL, m, c);
const MERGED = '115fbe2';
const BUNDLE_FIX = 'ece32b1';                 // main 합친 뒤 하네스 묶기(volsky/build.sh 등)
const G1_DIR = 'tools/genus-ruler/oro/g1';
const RENDER_STEPS = ['run1', 'run2', 'control', 'keys'];

function main() {
  const o = parseArgs(TOOL, process.argv.slice(2), { '--parts': true, '--jobs': true, '--inputs': true, '--out': true, '--final': false });
  for (const k of ['--parts', '--jobs', '--inputs', '--out']) { if (!o[k]) die(`${k} is required`); if (forbiddenPath(o[k])) die(`${k}: path refused`); }
  const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));
  const P = path.resolve(o['--parts']);
  const A = rd(path.join(P, 'a.json')), B = rd(path.join(P, 'b.json')), D = rd(path.join(P, 'd.json'));
  const jobsRaw = fs.readFileSync(path.resolve(o['--jobs'])), jobs = JSON.parse(jobsRaw.toString('utf8'));
  const names = jobs.map(j => j.name);
  const head = resolveCommit(TOOL, 'HEAD'), mergedFull = resolveCommit(TOOL, MERGED);
  const problems = [];
  const need = (ok, what) => { if (!ok) problems.push(what); };

  // ── 일관성 ──
  // 잰 커밋 = a 조각의 커밋(두 macro 번들을 그 커밋에서 git show 로 꺼냄). 다른 조각과 지금 HEAD 는 같은 커밋이거나,
  // 앱·하네스 경로(src, tools/genus-ruler/volsky)가 바이트 같은 커밋이어야 합니다(다른 도구의 커밋이 그 사이에 끼어도 잰 값은 같음).
  const commit = A.commit;
  const APP = ['src', 'tools/genus-ruler/volsky'];
  const appSame = (x, y) => x === y || gitQuiet(['diff', '--quiet', x, y, '--', ...APP]);
  const partCommits = { a: A.commit, b: B.commit ?? null, d: D.commit ?? null, headAtAssembly: head };
  for (const [k, c] of Object.entries(partCommits)) need(typeof c === 'string' && /^[0-9a-f]{40}$/.test(c) && appSame(commit, c), `${k} commit ${c} is not app-identical to ${commit}`);
  const inputsSha = sha256(fs.readFileSync(path.resolve(o['--inputs'])));
  need(A.inputs.oroInputsSha256 === inputsSha, 'a.json was computed from another oro-inputs.json');
  need(B.jobsFileSha256 === sha256(jobsRaw), 'b.json was rendered from another jobs file');
  for (const s of ['run1', 'run2', 'keys']) need(B[`${s}Bundle`] === B.harnessBundle?.sha256, `b.json ${s} used another harness bundle`);
  need(B.aa === true, 'A/A failed (run1 != run2)');
  need(B.keysMatchRun1 === true, 'key-capture run did not reproduce run1');
  need(B.controlMatchesMergeAA === true, 'control run does not reproduce oro/merge-aa.json');
  need(B.macroOnAllJobs === true, 'macro grid texture not active in every G1 job (genusMacroTexOn)');
  // 부하 지킴(build note 19): 네 그리기 단계 모두 기록돼 있고, 시작 때 놀았고, 도는 동안 남의 CPU < 0.5 코어
  const load = B.load ?? {};
  need(RENDER_STEPS.every(st => load[st]), `render load record missing for ${RENDER_STEPS.filter(st => !load[st]).join(',') || '-'} (b.json from a g1-render without the load guard)`);
  need(Object.values(load).every(l => l.before[0] < 1.0), 'render step started under load');
  need(Object.values(load).every(l => Array.isArray(l.heavy) && l.heavy.length === 0), 'render step started while another process used ≥ 50 % CPU');
  need(Object.values(load).every(l => l.during && l.during.foreignCores < 0.5), 'another process used ≥ 0.5 core while a render step ran');
  need(B.renderUnloaded === true, 'b.json renderUnloaded is not true');
  for (const n of names) {
    need(!!B.run1?.[n]?.rgb && !!B.run1?.[n]?.alpha, `missing render for ${n}`);
    need(typeof B.keys?.[n]?.weatherKey === 'string', `missing weather key for ${n}`);
  }
  need(D.error === null && D.realNetwork.length === 0 && D.d6d14Requests === 0 && D.srcClean === true && D.timersDetail.pendingAtEnd === 0, 'd.json checks did not pass');
  need(Array.isArray(D.callSites) && D.callSites.length > 0 && D.callSitesInfo && Object.keys(D.callSitesInfo.parseDiagnostics).length === 0,
    'd.json has no callSites (g1-live without the static scan) or a source file did not parse');
  // Q-45: macro 번들 = oro-base B 번들(같은 macroField.ts) — oro-base 의 index.json 에 적힌 번들 sha256(115fbe2)과 같아야 함
  const baseIdx = path.join(ROOT, '.harness/oro/base/index.json');
  const q45 = fs.existsSync(baseIdx) ? rd(baseIdx).bundleSha256 === A.bundles.macro.sha256 : null;
  need(q45 !== false, 'macro bundle sha256 != oro-base B bundle sha256 (Q-45)');
  const srcDirty = gitPorcelain(['src']), volskyDirty = gitPorcelain(['tools/genus-ruler/volsky']);
  need(srcDirty.length === 0 && volskyDirty.length === 0, 'src or volsky working tree is not clean');
  const appUnchanged = gitQuiet(['diff', '--quiet', mergedFull, commit, '--', 'src']) && gitQuiet(['diff', '--quiet', mergedFull, head, '--', 'src']);
  need(appUnchanged, `src changed between ${MERGED} and HEAD`);
  if (problems.length) { for (const p of problems) console.error(`PROBLEM ${p}`); die(`${problems.length} problem(s); g1-baseline.json not written`, 1); }

  // ── (c) ──
  const skySrc = fs.readFileSync(path.join(ROOT, SKY_SCENE));
  const qk = extractQKey(skySrc.toString('utf8'));
  const c = {}, cSettings = {};
  for (const j of jobs) {
    const st = settingsOfJob(j);
    c[j.name] = { weatherKey: B.keys[j.name].weatherKey, qKey: qk.fn(st) };
    cSettings[j.name] = st;
  }
  const inputsDoc = rd(path.resolve(o['--inputs']));
  const pend = inputsDoc.pendingSites ?? {};
  const toolsPorcelain = gitPorcelain([G1_DIR]);
  // ── 최종 판 조건(build note 20) ──
  const inputsRel = path.relative(ROOT, path.resolve(o['--inputs'])).split(path.sep).join('/');
  const g1ToolsCommitted = toolsPorcelain.length === 0 && gitQuiet(['diff', '--quiet', commit, '--', G1_DIR]);
  // 잰 커밋이 제 (첫) 부모에서 G1 도구 폴더 밖을 바꾸지 않음(자 L862 '… G1 측정 도구만 더한 커밋')
  const commitOnlyG1Tools = gitQuiet(['rev-parse', '--quiet', '--verify', `${commit}^^{commit}`])
    && gitQuiet(['diff', '--quiet', `${commit}^`, commit, '--', '.', `:(exclude)${G1_DIR}`]);
  const fin = {
    g1ToolsCommitted,
    commitOnlyG1Tools,
    srcIsMerged: appUnchanged,
    volskyIsBundleFix: gitQuiet(['diff', '--quiet', resolveCommit(TOOL, BUNDLE_FIX), commit, '--', 'tools/genus-ruler/volsky']),
    inputsCommitted: gitPorcelain([inputsRel]).length === 0 && gitQuiet(['diff', '--quiet', commit, '--', inputsRel]),
    noPendingSoundingSites: (pend.sounding ?? []).length === 0,
    noPendingRingSites: (pend.ring ?? []).length === 0,
    partsAtCommit: Object.values(partCommits).every(c => c === commit),
    renderUnloaded: B.renderUnloaded === true,
  };
  const notFinal = Object.keys(fin).filter(k => fin[k] !== true).sort();
  if (o['--final'] && notFinal.length) { for (const k of notFinal) console.error(`NOT-FINAL ${k}`); die(`--final: ${notFinal.length} condition(s) false; g1-baseline.json not written`, 1); }

  const out = {
    schema: 'g1-baseline/1',
    commit, mergedCommit: MERGED, mergedCommitFull: mergedFull, partCommits,
    status: {
      appUnchangedSinceMerge: appUnchanged, srcClean: true, volskyClean: true,
      // g1ToolsCommitted: G1 도구(이 폴더)가 잰 커밋에 그대로 들어 있는지(작업 트리에 바뀐·새 파일이 없고 잰 커밋과도 같음)
      ...fin,
      final: notFinal.length === 0, notFinal,
      bundleFixCommit: BUNDLE_FIX,
      renderGuard: 'run1, run2, control and keys each started with loadavg[0] < 1.0 and no other process at pcpu >= 50 (ps), and other processes used < 0.5 core on average while each ran (/proc); values in the b part',
      note: notFinal.length === 0
        ? 'final: measured at the G1 baseline commit (115fbe2 + bundle fix ece32b1 + G1 tools only, ruler L862) with no pending sounding or ring site; FROZEN runtime takes commit, mergedCommit, bundles.macro.sha256 and bundles.harness.sha256'
        : 'not final (see notFinal): FROZEN runtime must not take this file; re-run g1-run.sh --final at the G1 baseline commit after the 11-05 oro-inputs.json rebuild (build note 20)',
    },
    bundles: {
      macro: { sha256: A.bundles.macro.sha256, esbuild: ESBUILD, entry: A.bundles.macro.entry, equalsOroBaseB: q45 },
      macroChain: A.bundles.macroChain,
      harness: { sha256: B.harnessBundle.sha256, md5: B.harnessBundle.md5, build: 'volsky/build.sh', md5EqualsMergeAA: B.controlBundleMd5MatchesMergeAA },
      live: D.bundle,
    },
    dCallSitesInfo: { parser: D.callSitesInfo.parser, files: D.callSitesInfo.files, execModules: D.callSitesInfo.execModules,
      netExports: D.callSitesInfo.netExports, executed: D.callSitesInfo.executed },
    versions: {
      node: B.versions.node, esbuild: ESBUILD, chromium: B.versions.chromium, chromiumPath: B.versions.chromiumPath,
      chromiumRealPath: B.versions.chromiumRealPath, chromiumFlags: B.versions.chromiumFlags, typescript: D.callSitesInfo.parser,
      // SwiftShader 일꾼 수 고정(g1-render --swiftshader-threads; 없으면 null = 기본). S7 의 뒤 렌더는 같은 threads·steps 여야 함
      swiftshader: B.versions.swiftshader ?? null,
    },
    inputs: {
      oroInputsSha256: inputsSha, ringInputsSha256: A.inputs.ringInputsSha256, scenes: A.inputs.scenes,
      pendingSoundingSites: (pend.sounding ?? []).length, pendingRingSites: (pend.ring ?? []).length,
    },
    defs: {
      ...A.defs,
      b: 'node tools/genus-ruler/volsky/run.js tools/genus-ruler/oro/g1/jobs-g1.json <dir> 390 584 gen after volsky/build.sh; md5 of <name>.png (rgb) and <name>.alpha.png (alpha); aa = two runs equal; jobs = run 1',
      c: `weatherKey = volumetricScene.ts weatherPlan key captured from the weather cache (g1-keys.cjs); qKey = ${SKY_SCENE} expressions (q = ${qk.qExpr}; qKey template) evaluated on the job settings (quality, res, volumetric<Option>)`,
      d: D.path,
      dCallSites: 'static network call sites over src/**/*.ts(x) (g1-live scanCallSites, TypeScript parser): every fetch / fetch<Upper>… call, new XMLHttpRequest|WebSocket|EventSource, and call to a non-root network-reaching export of the executed modules, outside the code that the dynamic path executes (roots in dCallSitesInfo.execModules); "<file>:<callee>" or "<file>:<top-level name>:<callee>", sorted, one entry per call',
    },
    a: A.a, aMode2: A.aMode2, aMode2Init: A.aMode2Init,
    b: {
      aa: B.aa, keysRunMatchesRun1: B.keysMatchRun1, macroOnAllJobs: B.macroOnAllJobs,
      control: { matchesMergeAA: B.controlMatchesMergeAA, bundleMd5MatchesMergeAA: B.controlBundleMd5MatchesMergeAA, jobs: B.control },
      jobsFileSha256: B.jobsFileSha256,
      jobs: Object.fromEntries(jobs.map(j => [j.name, { rgb: B.run1[j.name].rgb, alpha: B.run1[j.name].alpha, options: j.options ?? {} }])),
    },
    c,
    cSettings: { skyScene3DSha256: sha256(skySrc), settings: cSettings },
    d: {
      requests: D.requests, rebuilds: D.rebuilds, timers: D.timers, timersDetail: D.timersDetail, d6d14Requests: D.d6d14Requests, callSites: D.callSites,
      options: D.options, fixture: D.fixture, frames: D.run.frames, keyFieldChanges: D.run.keyFieldChanges,
      harnessPageTimers: Object.fromEntries(names.map(n => [n, B.keys[n].pageTimers ?? null])),
    },
  };
  fs.mkdirSync(path.dirname(path.resolve(o['--out'])), { recursive: true });
  const text = canonicalJson(out);
  fs.writeFileSync(path.resolve(o['--out']), text);
  console.log(`WROTE ${path.relative(ROOT, path.resolve(o['--out']))} sha256 ${sha256(Buffer.from(text))} scenes ${A.inputs.scenes} jobs ${names.length} requests ${D.requests.length} rebuilds ${D.rebuilds} timers ${D.timers} callSites ${D.callSites.length} final ${out.status.final}${notFinal.length ? ` (notFinal: ${notFinal.join(',')})` : ''}`);
}

main();
