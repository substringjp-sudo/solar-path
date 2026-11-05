#!/usr/bin/env node
/**
 * oro-base.mjs — RULER-oro §3.4 의 B(차 꼴 결합기의 바탕): 장면·시각·밴드마다
 *     B = buildMacroField(samples, {n: 128, cellKm: 6, noise: false}).base      (Float32 그대로, u8 양자화 없음)
 * 를 만들어 파일로 쓰고 sha256 을 찍습니다. 설계: tools/genus-ruler/oro/S3-design.md §3(동결 파일, 자 L874).
 *
 *   node tools/genus-ruler/oro/oro-base.mjs --inputs <oro-inputs.json> [--commit <rev>(기본 HEAD)] [--out .harness/oro/base]
 *                                           [--scenes a,b] [--check]
 *
 * 무엇을 읽나(자 L415 "oro-base.mjs 는 oro-inputs.json 만 읽습니다", G8(a)):
 *   - 파일은 --inputs 하나뿐입니다. 그 안에서도 scenes.*.ringGeom(dist·az) 과 scenes.*.times.*.ring(f64·nullIdx),
 *     --check 때는 bSha256·bSha256n64 만 꺼내고(pickInputs) 나머지 키는 보지 않습니다.
 *   - 경로 인자는 --inputs·--out 둘(그리고 git 의 --commit)뿐이라 은행·고리 원자료·탐측 파일을 가리킬 길이 없습니다(C5).
 *     모르는 인자는 거절합니다.
 * 번들(자 L414, §9.2 runtime):
 *   - <commit> 의 src/utils/macroField.ts 와 src/components/VolumetricProbe/cloudFlow.ts 만 `git show` 로 꺼내
 *     .harness/oro/base-bundle/<commit 40자>/ 에 두고, 그 폴더를 cwd 로 esbuild 0.28.2 로 묶습니다(번들 주석의 상대 경로가
 *     커밋과 무관). cloudFlow.ts 의 `import type { GenusKey } from './cloudGenus'` 는 esbuild 가 지우므로 cloudGenus.ts 는
 *     꺼내지 않습니다(D6). three·react-native 를 끌어오면 거절합니다.
 *   - 그 폴더에 빈 tsconfig.json·package.json 을 둡니다. 없으면 esbuild 가 부모 폴더를 거슬러 저장소 뿌리의 tsconfig.json
 *     (작업 트리의 것, strict → "use strict")과 node_modules/expo/tsconfig.base.json 을 읽어, 번들이 커밋의 두 파일과 esbuild
 *     판만이 아니라 작업 트리 설정에도 매입니다(S3-design.md 'build notes' 1). B 값은 같지만 번들 sha256 이 달라집니다.
 * 계산(§3 6):
 *   - f64 는 새 8 바이트 정렬 버퍼로 풉니다(Buffer 풀의 byteOffset 은 8 의 배수가 아님, D6). NaN = null, nullIdx 와 맞아야 함.
 *   - 유한한 점이 12 개 미만이면 B = null(앱 규칙 pts.length >= 12, Q-31; 은행 끝의 모두-NaN 시각 팔 D9 포함).
 *   - samples = samplesFromRing(점.map(i => ({distance: dist[i], azimuthOffset: az[i], cover: c[i]*100}))) — applyScene 과 같은 꼴.
 *   - closest 시각은 같은 samples 로 n = 64(cellKm 12)도 만듭니다(§6 64² × 12 km 팔, M3).
 * 출력: <out>/<scene>__<time>__<band>.f32(128² LE float32, 65,536 B), <out>/<scene>__closest__<band>__n64.f32(64², 16,384 B),
 *   <out>/index.json(키 정렬). 표준 출력은 sha256·수·이름만(B 는 NWP 에서 나온 값이지만 값 자체는 찍지 않음).
 * --check: 파일을 쓰지 않고 메모리에서 다시 만들어 inputs 의 bSha256·bSha256n64 와 견줍니다(n128·n64 따로 셈). 다르면 exit 1.
 * 종료 코드: 0 성공 · 1 --check 차이 · 2 인자·입력 오류 · 3 번들·계산 오류.
 */
import fs from 'node:fs';                 // 기본 가져오기: G8(a) 의 fs-audit.cjs 가 fs.readFileSync 등을 감쌀 수 있게(§3 5)
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import cp from 'node:child_process';      // 기본 가져오기: 같은 까닭(감사 훅이 자식 프로세스 명령도 적음)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const ESBUILD = '0.28.2';
const TS_PATHS = ['src/utils/macroField.ts', 'src/components/VolumetricProbe/cloudFlow.ts'];
const ENTRY_TS = "export { buildMacroField, samplesFromRing } from './src/utils/macroField.ts';\n";
// 번들 폴더를 닫힌 세계로: esbuild 가 부모의 tsconfig.json·package.json 을 찾아 올라가지 않게(build notes 1)
const ISOLATE = { 'tsconfig.json': '{}\n', 'package.json': '{}\n' };
const FORBIDDEN_IN_BUNDLE = /require\(["'](three|react-native)["']\)|from\s*["'](three|react-native)["']/;
const BANDS = ['total', 'low', 'mid', 'high'];
const N_RING = 91;          // fetch-sat RING: 관측점 + 90
const MIN_POINTS = 12;      // volumetricScene.ts:1289 `pts.length >= 12`
const EXTENT_KM = 768;      // 판정 상자 768 km(자 L380)
const N_MAIN = 128, N_ARM = 64;
const ARM_TIME = 'closest'; // n = 64 는 closest 시각만
const SCENE_RE = /^[A-Za-z0-9-]+_\d{4}-\d{2}-\d{2}$/;   // <site>_<YYYY-MM-DD> — 파일 이름에 그대로 쓰므로 엄격하게
const TIME_RE = /^[a-z0-9]+$/;
const HEX_RE = /^[0-9a-f]{64}$/;

function die(msg, code = 2) {
  console.error(`oro-base: ${msg}`);
  process.exit(code);
}
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);

/** 키를 재귀로 정렬한 JSON(파이썬 dump_json 과 같은 꼴: indent 1, 끝 줄바꿈). */
function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (isObj(x)) { const o = {}; for (const k of Object.keys(x).sort()) o[k] = sortKeys(x[k]); return o; }
  return x;
}
const canonicalJson = x => JSON.stringify(sortKeys(x), null, 1) + '\n';

// ───────── 인자 ─────────
function parseArgs(argv) {
  const takesValue = { '--inputs': true, '--commit': true, '--out': true, '--scenes': true, '--check': false };
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!Object.prototype.hasOwnProperty.call(takesValue, k)) die(`unknown argument ${JSON.stringify(k)} (allowed: ${Object.keys(takesValue).join(' ')})`);
    if (k in o) die(`repeated ${k}`);
    if (takesValue[k]) {
      if (i + 1 >= argv.length) die(`${k} needs a value`);
      o[k] = argv[++i];
    } else o[k] = true;
  }
  if (!o['--inputs']) die('--inputs <oro-inputs.json> is required');
  const scenes = o['--scenes'] != null ? [...new Set(o['--scenes'].split(',').filter(Boolean))].sort() : null;
  if (scenes && scenes.length === 0) die('--scenes is empty');
  return {
    inputs: path.resolve(o['--inputs']),
    commit: o['--commit'] ?? 'HEAD',
    out: path.resolve(o['--out'] ?? path.join(ROOT, '.harness', 'oro', 'base')),
    scenes,
    check: o['--check'] === true,
  };
}

// ───────── 번들 ─────────
/** rev → 40 자 커밋 sha(git 은 --quiet 로만, C4). */
function resolveCommit(rev) {
  if (rev.startsWith('-') || !/^[A-Za-z0-9._/~^-]+$/.test(rev)) die(`bad --commit ${JSON.stringify(rev)}`);
  let sha = '';
  try {
    sha = cp.execFileSync('git', ['rev-parse', '--quiet', '--verify', `${rev}^{commit}`],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { die(`not a commit: ${rev}`); }
  if (!/^[0-9a-f]{40}$/.test(sha)) die(`not a commit: ${rev}`);
  return sha;
}

/** <sha> 의 두 TS 파일을 꺼내 묶고 {file, sha256} 을 돌려줍니다. 폴더는 매번 새로 만듭니다(남은 파일이 끼지 않게). */
function buildBundle(sha) {
  const dir = path.join(ROOT, '.harness', 'oro', 'base-bundle', sha);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of TS_PATHS) {
    // `git show <commit>:<path>` 는 이 두 TS 경로에만 씁니다(§0.1 C4).
    const src = cp.execFileSync('git', ['show', `${sha}:${rel}`], { cwd: ROOT, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'inherit'] });
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), src);
  }
  for (const [name, text] of Object.entries(ISOLATE)) fs.writeFileSync(path.join(dir, name), text);
  fs.writeFileSync(path.join(dir, 'entry.ts'), ENTRY_TS);
  const ver = cp.execFileSync('npx', ['--yes', `esbuild@${ESBUILD}`, '--version'],
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  if (ver !== ESBUILD) die(`esbuild version ${ver} != ${ESBUILD}`, 3);
  cp.execFileSync('npx', ['--yes', `esbuild@${ESBUILD}`, 'entry.ts', '--bundle', '--format=cjs', '--platform=node',
    '--outfile=macro.cjs', '--log-level=warning'], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
  const file = path.join(dir, 'macro.cjs');
  const code = fs.readFileSync(file);
  if (FORBIDDEN_IN_BUNDLE.test(code.toString('utf8'))) die('bundle pulls in three or react-native — refused', 3);
  return { file, sha256: sha256(code) };
}

// ───────── 입력(허용 목록) ─────────
function numArray91(a, where) {
  if (!Array.isArray(a) || a.length !== N_RING) die(`${where}: expected an array of ${N_RING} numbers`);
  for (const v of a) if (typeof v !== 'number' || !Number.isFinite(v)) die(`${where}: non-finite entry`);
  return a.slice();
}

/** f64b64(LE float64 91 개, NaN = null) → Float64Array. nullIdx 는 NaN 자리와 같아야 합니다. */
function decodeRingBand(v, where) {
  if (!isObj(v) || typeof v.f64 !== 'string' || !Array.isArray(v.nullIdx)) die(`${where}: expected {f64, nullIdx}`);
  const buf = Buffer.from(v.f64, 'base64');
  if (buf.length !== N_RING * 8 || buf.toString('base64') !== v.f64) die(`${where}.f64: not base64 of ${N_RING} float64`);
  const c = new Float64Array(Uint8Array.from(buf).buffer);   // 새 ArrayBuffer(byteOffset 0, 8 정렬)
  const nanIdx = [];
  for (let i = 0; i < N_RING; i++) {
    if (Number.isNaN(c[i])) nanIdx.push(i);
    else if (!Number.isFinite(c[i])) die(`${where}.f64: infinite entry (null must be NaN)`);
  }
  const want = v.nullIdx;
  if (want.length !== nanIdx.length || want.some((x, i) => x !== nanIdx[i])) die(`${where}: nullIdx does not match the NaN positions`);
  return c;
}

/**
 * 파싱한 inputs 에서 허용 목록 키만 꺼냅니다: scenes.<s>.ringGeom.{dist, az}, scenes.<s>.times.<t>.ring.<band>.{f64, nullIdx}
 * (withSha 면 times.<t>.bSha256, times.closest.bSha256n64 도). 돌려준 값에는 그 밖의 키가 없습니다.
 */
function pickInputs(doc, withSha) {
  const sc = isObj(doc) ? doc.scenes : null;
  if (!isObj(sc)) die('inputs: scenes is not an object');
  const out = {};
  for (const name of Object.keys(sc).sort()) {
    if (!SCENE_RE.test(name)) die(`inputs: bad scene name ${JSON.stringify(name)}`);
    const s = sc[name];
    const g = isObj(s) ? s.ringGeom : null;
    if (!isObj(g)) die(`${name}.ringGeom missing`);
    const dist = numArray91(g.dist, `${name}.ringGeom.dist`), az = numArray91(g.az, `${name}.ringGeom.az`);
    if (!isObj(s.times)) die(`${name}.times missing`);
    const times = {};
    for (const t of Object.keys(s.times).sort()) {
      if (!TIME_RE.test(t)) die(`${name}.times: bad time key ${JSON.stringify(t)}`);
      const e = s.times[t];
      if (!isObj(e) || !isObj(e.ring)) die(`${name}.times.${t}.ring missing`);
      const ring = {};
      for (const b of BANDS) ring[b] = decodeRingBand(e.ring[b], `${name}.times.${t}.ring.${b}`);
      times[t] = { ring };
      if (withSha) {
        times[t].bSha256 = isObj(e.bSha256) ? { ...e.bSha256 } : null;
        if (t === ARM_TIME) times[t].bSha256n64 = isObj(e.bSha256n64) ? { ...e.bSha256n64 } : null;
      }
    }
    out[name] = { dist, az, times };
  }
  return out;
}

// ───────── B ─────────
/** 고리 한 밴드 → samples(유한한 점이 12 개 미만이면 null). */
function ringSamples(M, dist, az, c) {
  const idx = [];
  for (let i = 0; i < N_RING; i++) if (Number.isFinite(c[i])) idx.push(i);
  if (idx.length < MIN_POINTS) return null;
  return M.samplesFromRing(idx.map(i => ({ distance: dist[i], azimuthOffset: az[i], cover: c[i] * 100 })));
}

/** applyScene 의 호출 꼴(state null). 돌려주는 값은 base 의 LE 바이트(4n²). */
function baseBytes(M, samples, n) {
  const B = M.buildMacroField(samples, { n, cellKm: EXTENT_KM / n, noise: false }, null).base;
  if (!(B instanceof Float32Array) || B.length !== n * n) die('buildMacroField: base is not a Float32Array of n²', 3);
  const bytes = Buffer.from(B.buffer, B.byteOffset, B.byteLength);
  if (bytes.length !== 4 * n * n) die('B byte length != 4n²', 3);
  return bytes;
}

const bName = (scene, time, band) => `${scene}__${time}__${band}.f32`;
const bNameN64 = (scene, band) => `${scene}__${ARM_TIME}__${band}__n64.f32`;

/** 장면 하나의 모든 시각·밴드: cb(time, band, n, bytes|null). */
function forEachB(M, sc, cb) {
  for (const t of Object.keys(sc.times).sort()) {
    for (const b of BANDS) {
      const samples = ringSamples(M, sc.dist, sc.az, sc.times[t].ring[b]);
      cb(t, b, N_MAIN, samples ? baseBytes(M, samples, N_MAIN) : null);
      if (t === ARM_TIME) cb(t, b, N_ARM, samples ? baseBytes(M, samples, N_ARM) : null);   // 같은 samples(M3)
    }
  }
}

// ───────── main ─────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (os.endianness() !== 'LE') die('this host is not little-endian; .f32 files are defined as LE', 3);
  const commit = resolveCommit(args.commit);
  const bundle = buildBundle(commit);
  console.log(`BUNDLE ${bundle.sha256} esbuild ${ESBUILD} node ${process.version} commit ${commit}`);
  const M = createRequire(import.meta.url)(bundle.file);
  if (typeof M.buildMacroField !== 'function' || typeof M.samplesFromRing !== 'function') die('bundle lacks buildMacroField/samplesFromRing', 3);

  // 읽는 파일은 이것 하나(§3 5). 파싱한 문서는 pickInputs 뒤에 버립니다.
  const raw = fs.readFileSync(args.inputs);
  const inputsFileSha256 = sha256(raw);
  const scenes = pickInputs(JSON.parse(raw.toString('utf8')), args.check);
  let names = Object.keys(scenes).sort();
  if (args.scenes) {
    for (const s of args.scenes) if (!(s in scenes)) die(`--scenes: no scene ${JSON.stringify(s)} in inputs`);
    names = args.scenes;
  }

  if (args.check) {
    // 메모리에서 다시 만들어 적힌 sha256 과 견줌. 적힌 쪽이 없으면(봉인 전) 차이로 셉니다.
    const cnt = { [N_MAIN]: { same: 0, diff: 0, null: 0 }, [N_ARM]: { same: 0, diff: 0, null: 0 } };
    for (const s of names) {
      forEachB(M, scenes[s], (t, b, n, bytes) => {
        const rec = n === N_MAIN ? scenes[s].times[t].bSha256 : scenes[s].times[t].bSha256n64;
        const want = rec && Object.prototype.hasOwnProperty.call(rec, b) ? rec[b] : undefined;
        const got = bytes ? sha256(bytes) : null;
        if (got === null && want === null) cnt[n].null++;
        else if (got !== null && typeof want === 'string' && HEX_RE.test(want) && want === got) cnt[n].same++;
        else { cnt[n].diff++; console.log(`DIFF ${s} ${t} ${b} ${n} ${want === undefined ? 'unsealed' : want === null ? 'recorded-null' : got === null ? 'rebuilt-null' : 'sha'}`); }
      });
    }
    for (const n of [N_MAIN, N_ARM]) console.log(`CHECK n${n} same ${cnt[n].same} diff ${cnt[n].diff} null ${cnt[n].null}`);
    process.exitCode = cnt[N_MAIN].diff + cnt[N_ARM].diff > 0 ? 1 : 0;   // exit() 대신: 파이프 stdout 이 다 나가게
    return;
  }

  fs.mkdirSync(args.out, { recursive: true });
  const entries = {}, entriesN64 = {};
  const tally = { [N_MAIN]: [0, 0], [N_ARM]: [0, 0] };   // [B 수, null 수]
  for (const s of names) {
    entries[s] = {};
    forEachB(M, scenes[s], (t, b, n, bytes) => {
      const file = path.join(args.out, n === N_MAIN ? bName(s, t, b) : bNameN64(s, b));
      let hex = null;
      if (bytes) { fs.writeFileSync(file, bytes); hex = sha256(bytes); tally[n][0]++; }
      else { fs.rmSync(file, { force: true }); tally[n][1]++; }   // 예전 실행의 남은 파일을 지움
      if (n === N_MAIN) (entries[s][t] ??= {})[b] = hex;
      else (entriesN64[s] ??= {})[b] = hex;
      console.log(`B ${s} ${t} ${b} ${n} ${hex ?? 'null'}`);
    });
  }
  const index = {
    schema: 'oro-base-index/1', commit, bundleSha256: bundle.sha256, esbuild: ESBUILD, node: process.version,
    inputsFileSha256, entries, entriesN64,
  };
  fs.writeFileSync(path.join(args.out, 'index.json'), canonicalJson(index));
  console.log(`DONE scenes ${names.length} n128 ${tally[N_MAIN][0]} null ${tally[N_MAIN][1]} n64 ${tally[N_ARM][0]} null ${tally[N_ARM][1]}`);
}

main();
