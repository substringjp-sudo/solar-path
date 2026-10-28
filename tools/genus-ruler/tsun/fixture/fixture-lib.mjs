/**
 * fixture-lib.mjs — §179 WP1 T_sun 고정표 도구의 공용 부분(격자·항목·앱 타일 덤프·C 핵 실행·기록 읽기).
 * build-fixture.mjs(표 꾸리기)와 fixture-test.mjs(U1a~U1f)가 함께 씁니다. 중간 산출물은 os.tmpdir() 또는 --tmp 아래에만 씁니다.
 *
 * 앱 타일: src/components/VolumetricProbe/cloudGenus.ts 의 makeGenusWeather 를 esbuild 로 묶어(three 는 가짜 상자) 앱과 같은 인자
 * (S 256, 24 km, 씨앗 7, 층 자리 = 레인)로 부릅니다. 운량 축 c = makeGenusWeather 에 들어가는 값(genusCoverIn 역표 **뒤**, 1 % 눈금 앞뒤 무관).
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../../..');
export const SHAPE_BIN = path.join(ROOT, 'node_modules/@takram/three-clouds/assets/shape.bin');

// ───── 격자(§179 결정 — design v2.1 §4.4·§8, 숫자는 [decision]) ─────
/** 창 길이 L(km). τ(L) = −ln⟨T(0, L)⟩ 를 이 점들에서 저장, 사이는 선형, 40 km 너머는 마지막 마디 기울기로 연장. */
export const L_GRID = [0.125, 0.25, 0.5, 1, 2, 3, 5, 7, 10, 14, 20, 40];
/** τ_c 의 해 쪽 2차 행진 도달(km) — codemap: 들머리 1.10 km → 70~80 km 에서 0.25 km, 그 너머 0(τ 0.5 대용). */
export const REACH_GRID = [0, 0.125, 0.25, 0.5, 0.75, 1.1, 1.5];
/** τ_c 를 맞추는 L(km, L_GRID 의 첨자) — v2.1 §1 M4 의 2/5/10 km 를 포함, 최대 오차 최소(minimax) 상수. */
export const CONDL_KM = [2, 3, 5, 7, 10];
export const CONDL_IDX = CONDL_KM.map(l => L_GRID.indexOf(l));
/** 방위별 τ_c 표의 도달·L 부분 격자(REACH_GRID·CONDL_KM 의 부분 — 크기를 줄임: 셰이더 도달은 0(대용) 또는 0.25~1.1 km) */
export const REACH_PHI = [0, 0.25, 0.5, 1.1];
export const CONDL_PHI = [2, 5, 10];
/** 방위별 τ_c 를 고르게 하는 반폭(도): 타일 축 ±15° 안 2.5°, 그 밖 7.5°(이웃 칸 ±2 · ±5° 를 삼각 무게로) [decision] */
export const PHI_SMOOTH = phi => { const a = ((phi % 90) + 90) % 90; return a <= 15 || a >= 75 ? 2.5 : 7.5; };
/** U1a 자유 경로 점(km): 4·8·16 km 의 국소 비율 = 이웃 두 점(l/√2, l√2)의 로그 기울기 */
export const FREE_KM = [2 * Math.SQRT2, 4 * Math.SQRT2, 8 * Math.SQRT2, 16 * Math.SQRT2];
/** 높이 비율 hf. 양 끝(0·1)은 두 단면 모두 hs = 0 → 구름 없음(평가기가 0 칸을 덧붙임). */
export const HF_GRID = [0.02, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.98];
/**
 * 타일 운량(makeGenusWeather 입력). 0 아래는 평가기가 0 칸(c = 0)과 선형.
 * 생성기는 c ≥ 0.999 에서 문턱을 끄고(th = −1) 장 전체를 씁니다 → 0.998 과 1.0 사이가 불연속(ac hf 0.6: λ₁₀ 0.5 → 39 /km [computed]).
 * ac 는 0.95 위에서 τ 가 가파르게 오름(hf 0.37, τ(10 km): 0.95 4.2 · 0.97 4.8 · 0.99 6.3 · 0.998 8.7 [measured, 행 256]) — 그래서 0.95~0.998 을
 * 촘촘히(앱 역표가 ac 0.75/0.85/0.9 → 0.934/0.961/0.974, cu 0.5 → 0.927 로 이 구간에 몰림) 두고, 평가기는 c < FULL_COVER 이면 0.998 이하 칸끼리만, c ≥ FULL_COVER 이면 1.0 칸만 씁니다.
 */
export const COVER_GRID = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.96, 0.97, 0.98, 0.99, 0.998, 1.0];
/** cloudGenus.genusWeatherSteps 의 `L.cover >= 0.999` 와 같은 값 */
export const FULL_COVER = 0.999;
/** 방위 φ(도, 북에서 시계, mod 180 — 선을 뒤집어도 창 모집단이 같음): 타일 축(0·90°) ±15° 안은 1°, 그 밖은 5° (v2.1 §2 M6). */
export const PHI_GRID = (() => {
  const s = new Set();
  for (let a = -15; a <= 15; a++) s.add(((a % 180) + 180) % 180);
  for (let a = 75; a <= 105; a++) s.add(a);
  for (let a = 20; a <= 70; a += 5) s.add(a);
  for (let a = 110; a <= 160; a += 5) s.add(a);
  return [...s].sort((x, y) => x - y);
})();

/**
 * 항목 = (종류, 레인). 레인이 씨앗을 정합니다(genusWeatherSteps: seed + 레인×1000) — 같은 종류도 레인마다 다른 타일.
 * §179 결정: T_sun 은 하네스 도구뿐이라(앱 경로 없음, 2026-10-28) RULER-tsun 장면(scenes-tsun.json 의 모든 층: P·RA·HS·AS·COST)이 쓰는
 * 여섯 (종류, 레인)만 만듭니다 — 앱 규칙(liveScene: 저 0 · 중 1 · 상 2 · 모루 3)의 나머지(st·cg·cb·as·cs·cbanvil·ns@0)는 몬테카를로 비용
 * (칸당 ~10 ms, 아래 BUILD_PARAM)을 아끼려 뺐습니다. 표에 없는 (종류, 레인)은 평가기가 같은 종류의 첫 항목으로 대신하고(같은 통계, 다른
 * 실현 — fixture-test 의 '레인 대체' 보고), 종류가 없으면 −1 → 빌더가 처리(앱 경로를 열 때 이 목록을 늘림).
 */
export const ENTRIES = [
  { genus: 'sc', lane: 0 }, { genus: 'cu', lane: 0 },
  { genus: 'ac', lane: 1 }, { genus: 'ns', lane: 1 },
  { genus: 'ac', lane: 2 }, { genus: 'ci', lane: 2 },
];

/**
 * C 핵 매개변수(표 꾸리기). 관측점 = 헤다(P2/P3/RA 장면) — 모양 잡음 좌표의 ECEF 방향만 정함.
 * 표본 수 [measured, fixture-test 개발 측정]: T ≈ 0.01~0.02 의 ln⟨T⟩ 표준편차가 행 64·24 km 에서 0.16~0.41, 행 256 에서 0.07~0.14,
 * 행 128 격자·시작 48 km 에서 0.05~0.13 — 좁은 틈 통로가 평균을 정해서(모양 잡음을 꺼도 0.135) 표본에 느리게 수렴합니다.
 * 그래서 행은 격자(lattice: 한 칸의 공통 이동 하나), 줄은 길게(시작 구간 48 km — 같은 표본 수에서 행 수보다 효율적).
 */
export const BUILD_PARAM = { S: 256, tileKm: 24, ds: 0.05, rows: 128, startStep: 0.2, startRange: 48, lat: 34.97342, lon: 138.77713, lattice: 1 };
export const BUILD_SEED = 0x7155a179n; // §179 표 씨앗(시험은 다른 씨앗)
export const SIGMA_IN = 0.1; // 1/km — 구름 안 시작(C 핵과 같은 값)

export const sha256 = buf => createHash('sha256').update(buf).digest('hex');
export const tmpDir = (arg) => {
  const d = arg ?? path.join(os.tmpdir(), 'tsun-fixture');
  fs.mkdirSync(d, { recursive: true });
  return d;
};
export const argOf = (name, def) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};

/** splitmix64 로 칸 씨앗(결정론) */
export function cellSeed(base, ...ks) {
  let s = BigInt.asUintN(64, base);
  for (const k of ks) {
    s = BigInt.asUintN(64, s + 0x9e3779b97f4a7c15n + BigInt(Math.round(k * 1000)));
    let z = s;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
    s = z ^ (z >> 31n);
  }
  return s.toString();
}

/**
 * cloudGenus.ts(+macroShader.ts)를 묶어 불러옵니다. 반환: { G: 모듈, sources: {상대경로: sha256}, srcRev }
 * src = 'head'(기본): `git archive <rev>` 로 VolumetricProbe 폴더를 tmp 에 풀어 그 글자로 묶습니다 — 다른 작업이 작업 트리의 cloudGenus.ts 를
 * 고치는 중이어도 표가 커밋 하나에 묶이고(재현), 머리말에 그 커밋을 적습니다. 'worktree' 는 작업 트리 그대로(개발용).
 */
export function loadApp(tmp, src = argOf('src', 'head')) {
  let base = ROOT, srcRev = 'worktree';
  if (src !== 'worktree') {
    const rev = src === 'head' ? 'HEAD' : src;
    srcRev = execFileSync('git', ['-C', ROOT, 'rev-parse', rev], { encoding: 'utf8' }).trim();
    base = path.join(tmp, `src-${srcRev.slice(0, 12)}`);
    if (!fs.existsSync(path.join(base, 'src/components/VolumetricProbe/cloudGenus.ts'))) {
      fs.mkdirSync(base, { recursive: true });
      const tar = execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', srcRev, 'src/components/VolumetricProbe', 'src/utils'], { maxBuffer: 1 << 28 });
      execFileSync('tar', ['-x', '-C', base], { input: tar });
    }
  }
  const entry = path.join(tmp, 'app-entry.ts');
  fs.writeFileSync(entry, [
    `export { makeGenusWeather, genusCoverIn, GENUS } from '${path.join(base, 'src/components/VolumetricProbe/cloudGenus')}';`,
    `export { macroThresholdTable } from '${path.join(base, 'src/components/VolumetricProbe/macroShader')}';`,
  ].join('\n'));
  const bundle = path.join(tmp, 'app.cjs'), meta = path.join(tmp, 'app.meta.json');
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=cjs', '--platform=node', '--external:three', `--outfile=${bundle}`,
    `--metafile=${meta}`, '--log-level=warning'], { cwd: ROOT, stdio: 'inherit' });
  const require = createRequire(import.meta.url);
  const Module = require('node:module');
  const origLoad = Module._load;
  // three 의 DataTexture 는 바이트 상자일 뿐 — 렌더 없음(tools/genus-ruler/flow/tile-gen.mjs 와 같은 가짜)
  Module._load = function (req, ...a) {
    if (req === 'three') return {
      DataTexture: class { constructor(data, w, h) { this.image = { data, width: w, height: h }; } },
      LinearFilter: 0, LinearMipMapLinearFilter: 0, NoColorSpace: '', RepeatWrapping: 0, ClampToEdgeWrapping: 0, RGBAFormat: 0, UnsignedByteType: 0,
      Vector3: class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } copy(v) { return this.set(v.x, v.y, v.z); } normalize() { return this; } },
      Vector4: class { constructor(x = 0, y = 0, z = 0, w = 0) { this.x = x; this.y = y; this.z = z; this.w = w; } set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; } },
      Matrix4: class { constructor() { this.elements = new Array(16).fill(0); } },
    };
    return origLoad.call(this, req, ...a);
  };
  delete require.cache[bundle];
  const G = require(bundle);
  Module._load = origLoad;
  const inputs = Object.keys(JSON.parse(fs.readFileSync(meta, 'utf8')).inputs).filter(p => !p.includes('node_modules') && !p.includes('app-entry'));
  const sources = {};
  for (const p of inputs.map(p => (path.isAbsolute(p) ? p : path.join(ROOT, p))).sort()) {
    sources[path.relative(base, p)] = sha256(fs.readFileSync(p));
  }
  return { G, sources, srcRev };
}

/** 앱 타일 한 장의 레인 채널(S² 바이트). */
export function tileBytes(G, genus, lane, cover, opts, S = 256, tileKm = 24) {
  const layers = [null, null, null, null];
  layers[lane] = { genus, cover, ...(opts ? { opts } : {}) };
  const t = G.makeGenusWeather(layers, S, tileKm, 7);
  const d = t.image.data;
  const out = Buffer.alloc(S * S);
  for (let i = 0; i < S * S; i++) out[i] = d[i * 4 + lane];
  return out;
}

/** 종류 단면 손잡이(렌더러가 쓰는 값 — GENUS, takram 기본 밀도 단면 0.75·hf + 0.25 또는 profileBase). */
export function genusProfile(G, genus) {
  const p = G.GENUS[genus];
  const pb = p.profileBase;
  return { mode: p.mode, base: p.base, top: p.top, edge: p.edge, densityScale: p.densityScale, shapeAmount: p.shapeAmount,
    profLin: pb != null ? 1 - pb : 0.75, profConst: pb != null ? pb : 0.25 };
}

/** C 핵 빌드(-O2, fast-math·FMA 축약 없음 — 같은 x86-64·glibc 에서 같은 바이트). */
export function compileCore(tmp) {
  const exe = path.join(tmp, 'tsunfix');
  execFileSync('gcc', ['-O2', '-ffp-contract=off', '-std=gnu11', '-o', exe, path.join(HERE, 'tsunfix.c'), '-lm'], { stdio: 'inherit' });
  return exe;
}

export const recLen = () => 1 + L_GRID.length + 2 + REACH_GRID.length * CONDL_IDX.length + 1 + FREE_KM.length + 2;

/** 계획 글자: 머리 + 칸 줄들 */
export function planText(param, cells) {
  const P = param;
  const head = [
    `GRID ${L_GRID.length} ${L_GRID.join(' ')}`,
    `REACH ${REACH_GRID.length} ${REACH_GRID.join(' ')}`,
    `CONDL ${CONDL_IDX.length} ${CONDL_IDX.join(' ')}`,
    `FREE ${FREE_KM.length} ${FREE_KM.map(v => v.toFixed(12)).join(' ')}`,
    `LATTICE ${P.lattice ? 1 : 0}`,
    `PARAM ${P.S} ${P.tileKm} ${P.ds} ${P.rows} ${P.startStep} ${P.startRange} ${P.lat} ${P.lon}`,
    `CELLS ${cells.length}`,
  ];
  const lines = cells.map(c => [c.tile, c.mip ?? 0, c.macroS ?? -1, c.prof.mode, c.prof.base, c.prof.top, c.prof.edge, c.prof.densityScale,
    c.shapeAmount ?? c.prof.shapeAmount, c.prof.profLin, c.prof.profConst, c.hf, c.phi, c.seed].join(' '));
  return head.concat(lines).join('\n') + '\n';
}

/** C 핵 실행(nice 19). 반환: 칸마다 기록을 푼 객체 배열 */
export function runCore(exe, tilesPath, plan, outPath) {
  const planPath = outPath + '.plan.txt';
  fs.writeFileSync(planPath, plan);
  return new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', '19', exe, tilesPath, SHAPE_BIN, planPath, outPath], { stdio: 'inherit' });
    p.on('exit', code => (code === 0 ? resolve(readRecords(outPath)) : reject(new Error(`tsunfix exit ${code}`))));
  });
}

export function readRecords(outPath) {
  const buf = fs.readFileSync(outPath);
  const f = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
  const n = recLen(), nL = L_GRID.length, nR = REACH_GRID.length, nCL = CONDL_IDX.length, nF = FREE_KM.length;
  const recs = [];
  for (let o = 0; o + n <= f.length; o += n) {
    let p = o;
    const nStarts = f[p++];
    const meanT = Array.from(f.subarray(p, p + nL)); p += nL;
    const sumW = f[p++], nIn = f[p++];
    const sumWT = Array.from(f.subarray(p, p + nR * nCL)); p += nR * nCL;
    const nClear = f[p++];
    const okF = Array.from(f.subarray(p, p + nF)); p += nF;
    const meanSigma = f[p++], inFrac = f[p++];
    recs.push({ nStarts, meanT, sumW, nIn, sumWT, nClear, okF, meanSigma, inFrac });
  }
  return recs;
}

/**
 * 여러 계획을 동시 conc 개로(각각 nice 19). 결과 순서 = 입력 순서.
 * 캐시: outPath 옆 .key 에 sha256(계획 글자 + 타일 묶음 sha + 핵 실행 파일 sha)를 적어 두고 같으면 다시 돌리지 않습니다 — 긴 표 꾸리기를
 * `--only` 로 여러 번(각 ≤ 10 CPU 분) 나눠 돌린 뒤 전체를 한 번 더 부르면 이어 붙입니다. U1c(두 번 만들기)는 다른 --tmp 로 캐시 없이.
 */
export async function runMany(exe, tilesPath, jobs, conc = 2, cacheSalt = '') {
  const out = new Array(jobs.length);
  const exeSha = sha256(fs.readFileSync(exe));
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      const t0 = Date.now();
      const key = sha256(jobs[i].plan + '\n' + cacheSalt + '\n' + exeSha);
      const keyPath = jobs[i].outPath + '.key';
      if (fs.existsSync(keyPath) && fs.existsSync(jobs[i].outPath) && fs.readFileSync(keyPath, 'utf8') === key) {
        out[i] = readRecords(jobs[i].outPath);
        if (jobs[i].label) console.log(`  ${jobs[i].label}: 캐시 ${jobs[i].cells} 칸`);
        continue;
      }
      if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
      out[i] = await runCore(exe, tilesPath, jobs[i].plan, jobs[i].outPath);
      fs.writeFileSync(keyPath, key);
      if (jobs[i].label) console.log(`  ${jobs[i].label}: ${jobs[i].cells} 칸 ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  return out;
}
