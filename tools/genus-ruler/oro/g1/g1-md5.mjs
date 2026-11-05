#!/usr/bin/env node
/**
 * g1-md5.mjs — G1(a)(자 L748, S3-design.md §8 (a)): 장면 × 밴드(저·중·상)마다 앱의 `buildMacroField` 가 내는 배열의 md5.
 *
 *   node tools/genus-ruler/oro/g1/g1-md5.mjs --inputs <oro-inputs.json> [--commit <rev>(기본 HEAD)] --out <a.json> [--scenes a,b]
 *
 * 입력(허용 목록, 장면 JSON 은 열지 않음 — MODIS 없음):
 *   - 파일은 --inputs 하나. 그 안에서 scenes.<s>.ringGeom.{dist, az} 와 scenes.<s>.times.closest.ring.{low,mid,high}.{f64,nullIdx}
 *     만 꺼냅니다(g1-lib pickRingInputs). 고리 점 = 유한한 점만, 12 개 미만이면 그 밴드는 null(앱 규칙 pts.length >= 12).
 *   - samples = samplesFromRing(점.map(p => ({distance, azimuthOffset, cover: cover*100}))) — applyScene 이 넘기는 꼴(§8 Inputs).
 * 번들(§8, build notes 1): <commit> 의 macroField.ts·cloudFlow.ts 를 git show 로 꺼내 닫힌 폴더에서 esbuild 0.28.2 로 묶은 두 번들.
 *   - 'macro'  = oro-base.mjs 의 B 번들과 같은 entry·같은 명령(같은 커밋이면 sha256 같음; FROZEN runtime 의 'B 번들').
 *   - 'chain'  = 같은 소스에 stepMacroState 를 더 내보낸 번들(모드 2 사슬용).
 * 계산(n = 128, cellKm = 768/128 = 6 — 잡 옵션 macroN 128 과 앱 extentKm 768):
 *   - 모드 1(a):    f = buildMacroField(samples, {n, cellKm, noise: false}, null) — macro 번들.
 *                  md5(cover), md5(base), md5(lambdaRes), state 의 형식 배열마다 md5(키 정렬). `ms`·beta 같은 수는 뺌.
 *   - 모드 2(aMode2): chain 번들. f0 = buildMacroField(samples, {n, cellKm, noise: true}, null)(applyScene 의 첫 장),
 *                  그 뒤 k = 1..15: stepMacroState(st, 60); f_k = buildMacroField(samples, 같은 opts, st)(setDate 의 1 분 걸음,
 *                  상태를 다음 걸음에 넘김). 걸음마다 md5(cover ‖ base ‖ lambdaRes ‖ state 형식 배열들(키 정렬)) 하나.
 *                  첫 장 f0 의 같은 md5 는 aMode2Init 에 따로 둡니다.
 * 출력(--out, 키 정렬 JSON): {schema, commit, bundles, inputs, defs, a, aMode2, aMode2Init}. 표준 출력은 수·sha256 만.
 * 종료 코드: 0 성공 · 2 인자·입력 오류 · 3 번들·계산 오류.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import {
  BANDS3, ENTRY_B, ENTRY_CHAIN, ESBUILD, EXTENT_KM, MACRO_N, STEP_SEC, STEPS,
  buildIsolatedBundle, canonicalJson, die as die0, forbiddenPath, md5, parseArgs, pickRingInputs, resolveCommit,
  ringInputsSha256, ringPoints, sha256,
} from './g1-lib.mjs';

const TOOL = 'g1-md5';
const die = (m, c) => die0(TOOL, m, c);

/** 형식 배열의 LE 바이트(byteOffset 안전). */
const bytesOf = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
/** state 안의 형식 배열(ArrayBuffer view)만, 키 정렬. */
function stateArrays(st) {
  if (!st || typeof st !== 'object') die('buildMacroField: state missing', 3);
  return Object.keys(st).sort().filter(k => ArrayBuffer.isView(st[k])).map(k => [k, st[k]]);
}
function checkField(f, n) {
  for (const k of ['cover', 'base', 'lambdaRes'])
    if (!(f[k] instanceof Float32Array) || f[k].length !== n * n) die(`buildMacroField: ${k} is not a Float32Array of n²`, 3);
}
function mode1Md5(f, n) {
  checkField(f, n);
  const state = {};
  for (const [k, a] of stateArrays(f.state)) state[k] = md5(bytesOf(a));
  return { cover: md5(bytesOf(f.cover)), base: md5(bytesOf(f.base)), lambdaRes: md5(bytesOf(f.lambdaRes)), state };
}
function stepMd5(f, n) {
  checkField(f, n);
  const parts = [f.cover, f.base, f.lambdaRes, ...stateArrays(f.state).map(([, a]) => a)].map(bytesOf);
  return md5(Buffer.concat(parts));
}

function main() {
  const o = parseArgs(TOOL, process.argv.slice(2), { '--inputs': true, '--commit': true, '--out': true, '--scenes': true });
  if (!o['--inputs'] || !o['--out']) die('--inputs <oro-inputs.json> and --out <file> are required');
  for (const k of ['--inputs', '--out']) if (forbiddenPath(o[k])) die(`${k}: path refused (§0.1 forbidden pattern)`);
  if (os.endianness() !== 'LE') die('host is not little-endian', 3);
  const commit = resolveCommit(TOOL, o['--commit'] ?? 'HEAD');
  const bB = buildIsolatedBundle(TOOL, 'macro', commit, ENTRY_B);
  const bC = buildIsolatedBundle(TOOL, 'chain', commit, ENTRY_CHAIN);
  console.log(`BUNDLE macro ${bB.sha256} chain ${bC.sha256} esbuild ${ESBUILD} node ${process.version} commit ${commit}`);
  const req = createRequire(import.meta.url);
  const MB = req(bB.file), MC = req(bC.file);
  if (typeof MB.buildMacroField !== 'function' || typeof MB.samplesFromRing !== 'function') die('macro bundle lacks buildMacroField/samplesFromRing', 3);
  if (typeof MC.stepMacroState !== 'function' || typeof MC.buildMacroField !== 'function') die('chain bundle lacks stepMacroState/buildMacroField', 3);

  // 읽는 파일은 이것 하나. 파싱한 문서는 허용 목록을 꺼낸 뒤 버립니다.
  const inputsPath = path.resolve(o['--inputs']);
  const raw = fs.readFileSync(inputsPath);
  const inputsSha = sha256(raw);
  const scenes = pickRingInputs(TOOL, JSON.parse(raw.toString('utf8')));
  let names = Object.keys(scenes).sort();
  if (o['--scenes'] != null) {
    const want = [...new Set(o['--scenes'].split(',').filter(Boolean))].sort();
    if (!want.length) die('--scenes is empty');
    for (const s of want) if (!(s in scenes)) die(`--scenes: no scene ${JSON.stringify(s)} in inputs`);
    names = want;
  }
  const n = MACRO_N, cellKm = EXTENT_KM / MACRO_N;
  const a = {}, aMode2 = {}, aMode2Init = {};
  let stateKinds = null, nBand = 0, nNull = 0;
  for (const s of names) {
    a[s] = {}; aMode2[s] = {}; aMode2Init[s] = {};
    for (const b of BANDS3) {
      const pts = ringPoints(scenes[s], b);
      if (!pts) { a[s][b] = null; aMode2[s][b] = null; aMode2Init[s][b] = null; nNull++; continue; }
      const app = pts.map(p => ({ distance: p.distance, azimuthOffset: p.azimuthOffset, cover: p.cover * 100 }));
      // 모드 1 — B 번들(oro-base 와 같은 번들)
      const f1 = MB.buildMacroField(MB.samplesFromRing(app), { n, cellKm, noise: false }, null);
      a[s][b] = mode1Md5(f1, n);
      const kinds = Object.fromEntries(stateArrays(f1.state).map(([k, v]) => [k, v.constructor.name]));
      if (stateKinds === null) stateKinds = kinds;
      else if (JSON.stringify(kinds) !== JSON.stringify(stateKinds)) die('state array set differs between bands', 3);
      // 모드 2 — 사슬 번들, applyScene 의 첫 장 + setDate 의 1 분 걸음 15 번
      const samples = MC.samplesFromRing(app);
      const opts = { n, cellKm, noise: true };
      const f0 = MC.buildMacroField(samples, opts, null);
      aMode2Init[s][b] = stepMd5(f0, n);
      const st = f0.state, chain = [];
      for (let k = 1; k <= STEPS; k++) {
        MC.stepMacroState(st, STEP_SEC);
        const fk = MC.buildMacroField(samples, opts, st);
        if (fk.state !== st) die('buildMacroField did not reuse the chained state', 3);
        chain.push(stepMd5(fk, n));
      }
      aMode2[s][b] = chain;
      nBand++;
    }
  }
  const out = {
    schema: 'g1-md5/1', commit,
    bundles: {
      macro: { sha256: bB.sha256, esbuild: ESBUILD, entry: ENTRY_B.trim() },
      macroChain: { sha256: bC.sha256, esbuild: ESBUILD, entry: ENTRY_CHAIN.trim() },
    },
    inputs: { oroInputsSha256: inputsSha, ringInputsSha256: ringInputsSha256(Object.fromEntries(names.map(s => [s, scenes[s]]))), scenes: names.length },
    defs: {
      samples: 'samplesFromRing(finite ring points of times.closest, cover*100); band null when < 12 points',
      a: 'buildMacroField(samples, {n:128, cellKm:6, noise:false}, null) with the macro (B) bundle; md5 of raw LE bytes of cover, base, lambdaRes and of each typed array of state (keys sorted); numbers (ms, beta, betaFit, state scalars) excluded',
      aMode2Init: 'chain bundle: f0 = buildMacroField(samples, {n:128, cellKm:6, noise:true}, null); md5 of cover||base||lambdaRes||state typed arrays (keys sorted)',
      aMode2: `chain bundle: for k = 1..${STEPS}: stepMacroState(st, ${STEP_SEC}); f_k = buildMacroField(samples, same opts, st); md5 as aMode2Init`,
      stateArrayTypes: stateKinds ?? {},
    },
    a, aMode2, aMode2Init,
  };
  fs.mkdirSync(path.dirname(path.resolve(o['--out'])), { recursive: true });
  const text = canonicalJson(out);
  fs.writeFileSync(path.resolve(o['--out']), text);
  console.log(`DONE scenes ${names.length} bands ${nBand} null ${nNull} steps ${STEPS} out-sha256 ${sha256(Buffer.from(text))}`);
}

main();
