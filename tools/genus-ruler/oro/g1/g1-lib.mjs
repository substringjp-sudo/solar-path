/**
 * g1-lib.mjs — RULER-oro G1(끔 = 바이트 같음) 기준 도구들이 함께 쓰는 조각. 설계: tools/genus-ruler/oro/S3-design.md §8,
 * 자 RULER-oro.md §7 G1(L748)·§9.1 ⑦(L862).
 *
 * 여기 있는 것: 경로·해시·정렬 JSON, 커밋 풀기(git 은 --quiet 로만, §0.1 C4), 격리 번들(oro-base.mjs 와 같은 꼴, build notes 1),
 * oro-inputs.json 의 고리 허용 목록(ringGeom 과 times.closest.ring 의 저·중·상만 — 장면 JSON 은 어디서도 열지 않음),
 * 금지 경로 꼴(§0.1 의 목록과 같음; JS 도구의 경로 인자를 거절하는 데 씀).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../../..');
export const ESBUILD = '0.28.2';
export const G1_HARNESS = path.join(ROOT, '.harness', 'oro', 'g1');
export const BANDS3 = ['low', 'mid', 'high'];          // 앱의 R·G·B(volumetricScene.ts macro 띠)
export const N_RING = 91;                               // fetch-sat RING: 관측점 + 90
export const MIN_POINTS = 12;                           // volumetricScene.ts:1289 `pts.length >= 12`
export const MACRO_N = 128, EXTENT_KM = 768;            // 잡 옵션 macroN 128, 앱 extentKm 768 → cellKm 6
export const STEP_SEC = 60;                             // volumetricScene.ts MACRO_STEP_SEC
export const STEPS = 15;                                // 자 L748 "모드 2 는 AR(1) 15 걸음 사슬까지"
export const TS_PATHS = ['src/utils/macroField.ts', 'src/components/VolumetricProbe/cloudFlow.ts'];
// oro-base.mjs 의 ENTRY_TS 와 바이트까지 같음 — 같은 커밋이면 번들 sha256 이 oro-base 의 B 번들과 같아야 함(Q-45, build notes 1).
export const ENTRY_B = "export { buildMacroField, samplesFromRing } from './src/utils/macroField.ts';\n";
// 모드 2 사슬은 stepMacroState 가 필요(esbuild 가 B 번들에서는 털어 냄, build notes 1 '§8 (a)').
export const ENTRY_CHAIN = "export { buildMacroField, samplesFromRing, stepMacroState } from './src/utils/macroField.ts';\n";
const ISOLATE = { 'tsconfig.json': '{}\n', 'package.json': '{}\n' };
const FORBIDDEN_IN_BUNDLE = /require\(["'](three|react-native)["']\)|from\s*["'](three|react-native)["']/;
const SCENE_RE = /^[A-Za-z0-9-]+_\d{4}-\d{2}-\d{2}$/;

/** §0.1 의 금지 꼴(저장소 뿌리 기준 상대 경로). 도구의 경로 인자가 여기에 걸리면 아무것도 열지 않고 거절합니다. */
export const FORBIDDEN_REL = [
  /^\.harness\/macro\/sat/, /^\.harness\/oro\/sat-/, /^\.harness\/regime\/sat/,
  /^tools\/genus-ruler\/macro\/sat-quartiles\.json$/, /^tools\/genus-ruler\/ring\/(gate-.*|ringtruth-results)\.json$/,
  /^\.harness\/oro\/(f2\.log|f3-run\.log|fetch-sat.*\.log|sat-quartiles-restore\.json)$/,
  /(^|\/)scratchpad\/restore(\/|$)/, /(^|\/)judge\.lock(\.1)?$/, /(^|\/)gate-oro-[^/]*\.json$/,
];
export function forbiddenPath(p) {
  const hit = a => {
    const rel = path.relative(ROOT, a).split(path.sep).join('/');
    return FORBIDDEN_REL.some(re => re.test(rel)) || /\/scratchpad\/restore(\/|$)/.test(a);
  };
  const abs = path.resolve(p);
  if (hit(abs)) return true;            // 금지 꼴이면 그 경로는 건드리지 않음(realpath 도 하지 않음)
  try { return hit(fs.realpathSync(abs)); } catch { return false; }   // 심볼릭 링크 우회 막기(없는 경로는 그대로)
}

export function die(tool, msg, code = 2) {
  console.error(`${tool}: ${msg}`);
  process.exit(code);
}
export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
export const md5 = buf => crypto.createHash('md5').update(buf).digest('hex');
export const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);

/** 키를 재귀로 정렬한 JSON(oro_ref.dump_json 과 같은 꼴: indent 1, 끝 줄바꿈). */
export function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (isObj(x)) { const o = {}; for (const k of Object.keys(x).sort()) o[k] = sortKeys(x[k]); return o; }
  return x;
}
export const canonicalJson = x => JSON.stringify(sortKeys(x), null, 1) + '\n';
export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, canonicalJson(obj));
}

/** 인자 풀기: takes = {'--x': true(값), '--y': false(깃발)}. 모르는 인자·되풀이는 거절. */
export function parseArgs(tool, argv, takes) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!Object.prototype.hasOwnProperty.call(takes, k)) die(tool, `unknown argument ${JSON.stringify(k)} (allowed: ${Object.keys(takes).join(' ')})`);
    if (k in o) die(tool, `repeated ${k}`);
    if (takes[k]) { if (i + 1 >= argv.length) die(tool, `${k} needs a value`); o[k] = argv[++i]; } else o[k] = true;
  }
  return o;
}

/** rev → 40 자 sha(git 은 --quiet 로만, C4). */
export function resolveCommit(tool, rev) {
  if (rev.startsWith('-') || !/^[A-Za-z0-9._/~^-]+$/.test(rev)) die(tool, `bad --commit ${JSON.stringify(rev)}`);
  let sha = '';
  try {
    sha = cp.execFileSync('git', ['rev-parse', '--quiet', '--verify', `${rev}^{commit}`],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { die(tool, `not a commit: ${rev}`); }
  if (!/^[0-9a-f]{40}$/.test(sha)) die(tool, `not a commit: ${rev}`);
  return sha;
}

/** git 이 0 으로 끝나면 true(경로 명시, --quiet). */
export function gitQuiet(args) {
  try { cp.execFileSync('git', args, { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; }
}
/** git status --porcelain -- <paths> 의 줄(빈 배열 = 깨끗). */
export function gitPorcelain(paths) {
  const out = cp.execFileSync('git', ['status', '--porcelain', '--', ...paths], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

/**
 * <sha> 의 macroField.ts·cloudFlow.ts 를 `git show` 로 꺼내 닫힌 폴더(빈 tsconfig/package)에서 esbuild 0.28.2 로 묶습니다.
 * oro-base.mjs buildBundle 과 같은 명령·같은 폴더 모양(번들 주석의 상대 경로가 같아 바이트가 같음). 폴더는 매번 새로.
 */
export function buildIsolatedBundle(tool, kind, sha, entry) {
  const dir = path.join(G1_HARNESS, 'bundle', kind, sha);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of TS_PATHS) {
    const src = cp.execFileSync('git', ['show', `${sha}:${rel}`], { cwd: ROOT, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'inherit'] });
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), src);
  }
  for (const [name, text] of Object.entries(ISOLATE)) fs.writeFileSync(path.join(dir, name), text);
  fs.writeFileSync(path.join(dir, 'entry.ts'), entry);
  const ver = cp.execFileSync('npx', ['--yes', `esbuild@${ESBUILD}`, '--version'],
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  if (ver !== ESBUILD) die(tool, `esbuild version ${ver} != ${ESBUILD}`, 3);
  cp.execFileSync('npx', ['--yes', `esbuild@${ESBUILD}`, 'entry.ts', '--bundle', '--format=cjs', '--platform=node',
    '--outfile=macro.cjs', '--log-level=warning'], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
  const file = path.join(dir, 'macro.cjs');
  const code = fs.readFileSync(file);
  if (FORBIDDEN_IN_BUNDLE.test(code.toString('utf8'))) die(tool, 'bundle pulls in three or react-native — refused', 3);
  return { file, sha256: sha256(code), entry };
}

/** f64b64(LE float64 91 개, NaN = null) → Float64Array(새 8 정렬 버퍼). nullIdx 는 NaN 자리와 같아야 함(oro-base 와 같은 점검). */
export function decodeRingBand(tool, v, where) {
  if (!isObj(v) || typeof v.f64 !== 'string' || !Array.isArray(v.nullIdx)) die(tool, `${where}: expected {f64, nullIdx}`);
  const buf = Buffer.from(v.f64, 'base64');
  if (buf.length !== N_RING * 8 || buf.toString('base64') !== v.f64) die(tool, `${where}.f64: not base64 of ${N_RING} float64`);
  const c = new Float64Array(Uint8Array.from(buf).buffer);
  const nanIdx = [];
  for (let i = 0; i < N_RING; i++) {
    if (Number.isNaN(c[i])) nanIdx.push(i);
    else if (!Number.isFinite(c[i])) die(tool, `${where}.f64: infinite entry (null must be NaN)`);
  }
  const want = v.nullIdx;
  if (want.length !== nanIdx.length || want.some((x, i) => x !== nanIdx[i])) die(tool, `${where}: nullIdx does not match the NaN positions`);
  return c;
}
function numArray91(tool, a, where) {
  if (!Array.isArray(a) || a.length !== N_RING) die(tool, `${where}: expected an array of ${N_RING} numbers`);
  for (const v of a) if (typeof v !== 'number' || !Number.isFinite(v)) die(tool, `${where}: non-finite entry`);
  return Float64Array.from(a);
}

/**
 * oro-inputs 의 허용 목록 읽기(MODIS 없음): scenes.<s>.ringGeom.{dist, az}, scenes.<s>.times.closest.ring.{low,mid,high}.{f64,nullIdx}
 * 그리고 withMeta 면 scenes.<s>.{site, lat, lon, date} 와 times.closest.utc. 돌려준 값에는 그 밖의 키가 없습니다.
 */
export function pickRingInputs(tool, doc, withMeta = false) {
  const sc = isObj(doc) ? doc.scenes : null;
  if (!isObj(sc)) die(tool, 'inputs: scenes is not an object');
  const out = {};
  for (const name of Object.keys(sc).sort()) {
    if (!SCENE_RE.test(name)) die(tool, `inputs: bad scene name ${JSON.stringify(name)}`);
    const s = sc[name];
    const g = isObj(s) ? s.ringGeom : null;
    if (!isObj(g)) die(tool, `${name}.ringGeom missing`);
    const e = isObj(s.times) ? s.times.closest : null;
    if (!isObj(e) || !isObj(e.ring)) die(tool, `${name}.times.closest.ring missing`);
    const ring = {};
    for (const b of BANDS3) ring[b] = decodeRingBand(tool, e.ring[b], `${name}.times.closest.ring.${b}`);
    const rec = { dist: numArray91(tool, g.dist, `${name}.ringGeom.dist`), az: numArray91(tool, g.az, `${name}.ringGeom.az`), ring };
    if (withMeta) {
      const [site, date] = [name.slice(0, name.lastIndexOf('_')), name.slice(name.lastIndexOf('_') + 1)];
      if (s.site !== site || s.date !== date) die(tool, `${name}: site/date keys do not match the scene key`);
      if (typeof s.lat !== 'number' || typeof s.lon !== 'number' || typeof e.utc !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(e.utc))
        die(tool, `${name}: lat/lon/times.closest.utc missing`);
      Object.assign(rec, { site, date, lat: s.lat, lon: s.lon, utc: e.utc });
    }
    out[name] = rec;
  }
  return out;
}

/** 고리 입력만의 sha256(oro-inputs.json 파일 바이트와 무관 — 탐측이 들어와 파일이 다시 만들어져도 같음). */
export function ringInputsSha256(scenes) {
  const h = crypto.createHash('sha256');
  for (const name of Object.keys(scenes).sort()) {
    const s = scenes[name];
    h.update(name + '\n');
    for (const a of [s.dist, s.az, ...BANDS3.map(b => s.ring[b])]) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  }
  return h.digest('hex');
}

/** 유한한 점이 12 개 미만이면 null(앱 규칙). 아니면 앱 꼴의 고리 점 {distance, azimuthOffset, cover(0~1)}. */
export function ringPoints(s, band) {
  const c = s.ring[band], pts = [];
  for (let i = 0; i < N_RING; i++) if (Number.isFinite(c[i])) pts.push({ distance: s.dist[i], azimuthOffset: s.az[i], cover: c[i] });
  return pts.length >= MIN_POINTS ? pts : null;
}

/**
 * G1(c) qKey: 앱(SkyScene3D.tsx)이 쓰는 그대로의 식을 소스에서 꺼냅니다 — `const q = …;` 와 그 뒤의 `const qKey = `…`;` 한 쌍.
 * 둘 다 정확히 한 번씩 나와야 합니다. 돌려주는 fn(volSet) 은 그 두 식을 그대로 평가합니다(설정 객체 volSet 만 받음).
 */
export const SKY_SCENE = 'src/components/SkyScene3D/SkyScene3D.tsx';
export function extractQKey(src) {
  const qk = [...src.matchAll(/^\s*const qKey = (`[^`\n]*`);\s*$/gm)];
  if (qk.length !== 1) throw new Error(`qKey template: expected 1, found ${qk.length}`);
  const before = src.slice(0, qk[0].index);
  const qs = [...before.matchAll(/^\s*const q = ([^;\n]+);\s*$/gm)];
  if (!qs.length) throw new Error('q expression before qKey not found');
  const qExpr = qs[qs.length - 1][1].trim(), tpl = qk[0][1];
  if (!/^volSet\.[A-Za-z]+ \?\? '[a-z]+'$/.test(qExpr)) throw new Error(`unexpected q expression: ${qExpr}`);
  // eslint-disable-next-line no-new-func
  const fn = new Function('volSet', `const q = ${qExpr};\nreturn ${tpl};`);
  return { qExpr, template: tpl, fn };
}
/**
 * 잡 → 앱 설정(volSet): 품질 volumetricQuality = job.quality, 해상도 volumetricRes = job.res, 옵션 k 마다 volumetric<K> = 값
 * (macro → volumetricMacro, macroOro → volumetricMacroOro, regime → volumetricRegime …). 잡이 주지 않은 설정은 비워 두어
 * 앱의 기본값(식 안의 `??`)이 그대로 들게 합니다.
 */
export function settingsOfJob(job) {
  const s = {};
  if (job.quality != null) s.volumetricQuality = job.quality;
  if (job.res != null) s.volumetricRes = job.res;
  for (const [k, v] of Object.entries(job.options ?? {})) s['volumetric' + k[0].toUpperCase() + k.slice(1)] = v;
  return s;
}
