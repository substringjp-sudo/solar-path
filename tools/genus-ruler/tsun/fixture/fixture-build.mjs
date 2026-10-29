#!/usr/bin/env node
/**
 * fixture-build.mjs — §179 WP1 T_sun 빈틈 법칙 고정표(curve of growth G + 조건부 τ_c)를 만듭니다(design v2 §8 WP1, v2.1 §4.4·§8).
 *
 *   nice -n 19 node tools/genus-ruler/tsun/fixture/fixture-build.mjs [--out=<dir>] [--tmp=<dir>] [--jobs=2] [--src=head|worktree|<rev>] [--max-jobs=N]
 *
 *   전체는 ≈ 18 만 칸(6 항목 × 운량 17 × hf 21 × 방위 84), 행 256 에서 칸당 ≈ 25~60 ms(부하 아래) ≈ 1.5~2 CPU 시간 [measured] —
 *   `--max-jobs=3`(일감 하나 = 운량 3 × hf 21 × 방위 84 = 5292 칸, 2~5 CPU 분) 로 여러 번 부르면 같은 --tmp 의 캐시에 이어 붙고, 마지막 부름이 꾸립니다(종료 코드 3 = 미완). `--entries=sc@0,ac@1` 은
 *   새로 돌릴 일감을 그 항목으로 제한하고, `--partial-ok` 는 다 찬 항목만 꾸린 시험용 부분 표를 냅니다(같은 캐시라 버리는 계산이 없음).
 *   --only=sc@0,ac@1 은 개발용 일부 항목.
 * 1) 앱 종류 타일: cloudGenus.makeGenusWeather(씨앗 7, 256², 24 km)를 커밋 글자(--src, 기본 HEAD)에서 묶어 항목(종류, 레인) × 운량 격자마다 덤프.
 * 2) C 핵(tsunfix.c): 렌더러 밀도 복제(타일 × 종류 단면 × shape.bin 모양 잡음 침식, mip 0, quality low = 세부 잡음 없음)로
 *    칸(항목, 운량 c, hf, 방위 φ)마다 수평선 무차별 ⟨T(0, L)⟩ 와 구름 안 시작의 σ 가중 ⟨T(r, r+L)⟩ 를 적분.
 * 3) 꾸리기:
 *    - τ(L) = −ln⟨T(0, L)⟩ (L_GRID 12 점, 0~60 자름, uint16 ×1000) — G(Λ; c, hf, φ) = τ(Λ/λ₁₀) 의 표본. λ₁₀ 은 평가기(tsunFixture.ts)가
 *      표에서 다시 셈(λ₁₀ = τ(L*)/L*, L* = τ ≤ ln 1e4 인 가장 긴 격자 L ≤ 10 km — 10 km 에서 T < 1e−4 이면 짧은 L 로 내려감 [decision]).
 *    - τ_c(c, hf, reach) = 방위 평균(360°, φ 칸 폭 가중) 오프셋 off(r, L) = −ln⟨T(r, r+L) | 구름 안⟩_σ − τ(L) 의, L ∈ {2, 5, 10} km 에서
 *      최소최대(minimax) 상수 (max + min)/2. 두 T 가 모두 ≥ 1e−4 인 L 만 씀; 없으면 0 (int16 ×1000).
 *    - τ_c 의 L 별 표 tauCL(c, hf, reach, L ∈ condL) — 같은 오프셋을 상수로 접지 않은 것(셰이더가 u_true 로 읽을 수 있게).
 *    - τ_c 의 방위·L 별 표 tauCPhi(c, hf, φ ∈ 360°, reach, L) — 조건부 창은 뒤집기 대칭이 아니라 같은 선의 앞·뒤 창을 함께 적분(tsunfix.c),
 *      이웃 방위로 고르게(빌더가 해 방위로 읽음).
 * 4) 출력: <out>/tsun-fixture.bin(리틀 엔디언: τ uint16 → τ_c int16 → τ_c(L) int16 → τ_c(φ, L) uint8 블록) + <out>/tsun-fixture.json(머리말, bin 의 sha256 포함).
 *    머리말에는 시간 같은 비결정 값을 넣지 않습니다(U1c: 두 번 만들어 바이트 같음). 시간·칸 수는 <tmp>/build-log.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as F from './fixture-lib.mjs';

const OUT = path.resolve(F.argOf('out', F.HERE));
const TMP = F.tmpDir(F.argOf('tmp'));
const JOBS = Number(F.argOf('jobs', '2'));
// --only=sc@0,ac@1 : 개발용 일부 항목(머리말에 적힘 — 꾸린 표를 동결에 쓰려면 전체로)
const ONLY = F.argOf('only') ? new Set(F.argOf('only').split(',')) : null;
// --phi-range=lo,hi : 개발용 방위 부분 격자(mod 180 도, 머리말에 적힘)
const PHI_RANGE = F.argOf('phi-range') ? F.argOf('phi-range').split(',').map(Number) : null;
const PHI = PHI_RANGE ? F.PHI_GRID.filter(p => p >= PHI_RANGE[0] && p <= PHI_RANGE[1]) : F.PHI_GRID;
const t0 = Date.now();
fs.mkdirSync(OUT, { recursive: true });

const { G, sources, srcRev } = F.loadApp(TMP);
const P = F.BUILD_PARAM;

// ───── 1) 타일 ─────
const tiles = [], tileIndex = [];
const entries = F.ENTRIES.filter(E => !ONLY || ONLY.has(`${E.genus}@${E.lane}`)).map((E, ei) => {
  const covers = E.covers ?? F.COVER_GRID;
  const tileIds = covers.map(c => {
    const b = F.tileBytes(G, E.genus, E.lane, c, E.opts, P.S, P.tileKm);
    tileIndex.push({ entry: ei, genus: E.genus, lane: E.lane, cover: c, sha256: F.sha256(b) });
    tiles.push(b);
    return tiles.length - 1;
  });
  return { ...E, gi: F.ENTRIES.indexOf(E), covers, tileIds, prof: F.genusProfile(G, E.genus), hf: F.hfOf(E) };
});
const tilesBlob = Buffer.concat(tiles);
const tilesPath = path.join(TMP, 'tiles-build.bin');
fs.writeFileSync(tilesPath, tilesBlob);
console.log(`타일 ${tiles.length} 장 (${((Date.now() - t0) / 1000).toFixed(1)} s) — src ${srcRev}`);

// ───── 2) C 핵 ─────
// 일감 = (항목, 운량 묶음 COVER_BLOCK 개). 캐시 이름은 (종류@레인, 첫 운량 첨자)로 고정 — `--max-jobs=N` 으로 새로 돌릴 일감 수를 묶어
// 한 번 부를 때 ≤ 10 CPU 분(§179 작업 규칙: C0 렌더와 4 코어를 나눔)씩 이어 돌리고, 모두 차면 꾸립니다(이어 붙인 표 = 한 번에 만든 표, U1c).
const COVER_BLOCK = 3;
const MAX_JOBS = F.argOf('max-jobs') ? Number(F.argOf('max-jobs')) : Infinity;
// --entries=sc@0,ac@1 : 이 부름에서 새로 돌릴 일감을 그 항목으로 제한(캐시·계획은 전체와 같음 — 나중 부름이 이어 붙임)
const RUN_ENTRIES = F.argOf('entries') ? new Set(F.argOf('entries').split(',')) : null;
// --partial-ok : 다 찬 항목만 꾸려 시험용 부분 표를 냄(머리말 partial 에 적힘 — 동결에는 전체 표만)
const PARTIAL_OK = process.argv.includes('--partial-ok');
const exe = F.compileCore(TMP);
const jobs = [];
// 일감 하나 = (항목, 운량 묶음, hf 목록) — 기본 HF_GRID 일감 뒤에 항목별 덧붙인 hf(hfExtra) 일감을 따로 둡니다(캐시 이름 -hx)
const addJobs = (hfList, suffix) => entries.forEach((E, ei) => {
  if (!hfList(E).length) return;
  for (let b = 0; b < E.covers.length; b += COVER_BLOCK) {
    const cells = [];
    E.covers.slice(b, b + COVER_BLOCK).forEach((c, k) => hfList(E).forEach(hf => PHI.forEach(phi => {
      // 씨앗은 값(운량·hf·φ)으로 — 부분 격자(--phi-range)·격자 변경에도 같은 칸은 같은 씨앗
      cells.push({ ci: b + k, hf, phi, tile: E.tileIds[b + k], prof: E.prof, seed: F.cellSeed(F.BUILD_SEED, E.gi, c, hf, phi) });
    })));
    jobs.push({ entry: ei, label: `${E.genus}@${E.lane} c${b}${suffix}`, cells: cells.length, keys: cells.map(c => `${c.ci}|${c.hf}|${c.phi}`),
      plan: F.planText(P, cells), outPath: path.join(TMP, `cells-${E.genus}@${E.lane}-c${b}${suffix}.f64`),
      skip: RUN_ENTRIES ? !RUN_ENTRIES.has(`${E.genus}@${E.lane}`) : false });
  }
});
addJobs(() => F.HF_GRID, '');
addJobs(E => E.hfExtra ?? [], '-hx');
const tc = Date.now();
const recsByJob = await F.runMany(exe, tilesPath, jobs, JOBS, F.sha256(tilesBlob), MAX_JOBS);
const coreMs = Date.now() - tc;
const missing = recsByJob.filter(r => r == null).length;
const doneEntry = entries.map((_, ei) => jobs.every((j, i) => j.entry !== ei || recsByJob[i] != null));
if (missing) {
  console.log(`미완: 일감 ${jobs.length - missing}/${jobs.length} 캐시됨 — 같은 --tmp 로 다시 부르면 이어 돌립니다 (${(coreMs / 1000).toFixed(1)} s)`);
  if (!PARTIAL_OK || !doneEntry.some(Boolean)) process.exit(3);
}
// 항목마다 [운량][hf(항목 격자)][φ] 차례로 다시 늘어놓음(기본 일감 + 덧붙인 hf 일감)
const recsAll = entries.map((E, ei) => {
  const byKey = new Map();
  jobs.forEach((j, i) => { if (j.entry === ei && recsByJob[i]) j.keys.forEach((k, n) => byKey.set(k, recsByJob[i][n])); });
  const out = [];
  E.covers.forEach((_, ci) => E.hf.forEach(hf => PHI.forEach(phi => out.push(byKey.get(`${ci}|${hf}|${phi}`)))));
  return out;
});
// 다 찬 항목만 꾸림(--partial-ok 일 때 일부)
const PART_ENTRIES = missing ? entries.filter((_, ei) => doneEntry[ei]).map(E => `${E.genus}@${E.lane}`) : null;
const recsByEntry = recsAll.filter((_, ei) => doneEntry[ei]);
entries.splice(0, entries.length, ...entries.filter((_, ei) => doneEntry[ei]));

// ───── 3) 꾸리기 ─────
const nL = F.L_GRID.length, nP = PHI.length, nR = F.REACH_GRID.length, nCL = F.CONDL_IDX.length; // nH 는 항목마다(E.hf)
const TAU_MAX = 60, T_OK = 1e-4;
// 칸 폭(도) — 원형 격자의 이웃 반간격 합(τ 는 mod 180, τ_c 는 360)
const circW = (g, period) => g.map((p, i) => {
  const n = g.length, prev = i === 0 ? g[n - 1] - period : g[i - 1], next = i === n - 1 ? g[0] + period : g[i + 1];
  return (next - prev) / 2;
});
const PHI360 = F.phi360(PHI), nP2 = PHI360.length, phiW360 = circW(PHI360, 360);
const angDist = (x, y) => { const d = Math.abs(x - y) % 360; return Math.min(d, 360 - d); };
let tauLen = 0, tauCLen = 0, tauCPLen = 0;
for (const E of entries) {
  const nH = E.hf.length;
  E.tauOffset = tauLen; tauLen += E.covers.length * nH * nP * nL;
  E.tauCOffset = tauCLen; tauCLen += E.covers.length * nH * nR;
  E.tauCPhiOffset = tauCPLen; tauCPLen += E.covers.length * nH * nP2 * nR * nCL;
}
const tau = new Uint16Array(tauLen), tauC = new Int16Array(tauCLen);
// L 별 τ_c(c, hf, reach, L ∈ condL) — 상수 하나로는 L 2 → 10 km 에서 오프셋이 크게 변함(ac c 0.96: 2.0 → 1.0 안팎, 개발 측정) [§179 결정:
// 상수(설계의 균일 변수 표)와 L 별 표를 함께 싣고, 셰이더는 u_true(층 안 남은 길)로 L 별 표를 읽을 수 있게 함]
const tauCL = new Int16Array(tauCLen * nCL);
// 방위별 τ_c(c, hf, φ ∈ 360°, reach, L): 축 근처 1~3° 에서 오프셋이 방위 평균보다 0.4~0.5 크고, 뒤집기 대칭이 아님(φ 와 φ + 180° 가
// 0.4 까지 다름 — tsunfix.c 머리말). 칸마다 표본 잡음(행 128 에서 ±0.1~0.15)이 있어 이웃 방위를 삼각 무게(PHI_SMOOTH)로 고르게 함.
// uint8: τ_c = −1 + 0.025·b (−1 ~ 5.375; 자른 수는 stats 에) [§179 결정: int16 의 절반 크기; 개발 표에서 τ_c 는 −0.62 ~ 5.22(도달 0 의
// 중앙값 ≈ 3 — 구름 안 시작 칸 자체의 현), 양자화 오차 ≤ 0.0125 는 U1e 허용 0.3 의 4 %]
const TCP_SCALE = 0.025, TCP_OFFSET = -1;
const tauCPhi = new Uint8Array(tauCPLen);
const stats = { tauCSpreadMax: 0, tauCSpreadP95: 0, tauCNoData: 0, cells: 0, tauCPhiClamped: 0, tauCPhiFallback: 0 };
const spreads = [];
const q = v => Math.round(Math.max(-30, Math.min(30, v)) * 1000); // τ_c 양자화(int16 ×1000, ±30 자름)
const q8 = v => { const k = Math.round((v - TCP_OFFSET) / TCP_SCALE); if (k > 255 || k < 0) stats.tauCPhiClamped++; return Math.max(0, Math.min(255, k)); };
entries.forEach((E, ei) => {
  const recs = recsByEntry[ei], nH = E.hf.length;
  let k = 0;
  for (let ci = 0; ci < E.covers.length; ci++) for (let hi = 0; hi < nH; hi++) {
    // offs[j][ri * nCL + c] = 조건부 오프셋(없으면 null), j = φ360 첨자(앞 창 j < nP, 뒤 창 j ≥ nP)
    const offs = Array.from({ length: nP2 }, () => new Array(nR * nCL).fill(null));
    for (let pi = 0; pi < nP; pi++, k++) {
      const r = recs[k];
      const base = E.tauOffset + ((ci * nH + hi) * nP + pi) * nL;
      for (let l = 0; l < nL; l++) {
        const t = Math.min(TAU_MAX, Math.max(0, -Math.log(Math.max(r.meanT[l], 1e-300))));
        tau[base + l] = Math.round(t * 1000);
      }
      stats.cells++;
      if (!(r.sumW > 0)) continue;
      for (let ri = 0; ri < nR; ri++) for (let c = 0; c < nCL; c++) {
        const Tu = r.meanT[F.CONDL_IDX[c]];
        if (!(Tu >= T_OK)) continue;
        const Tf = r.sumWT[ri * nCL + c] / r.sumW, Tb = r.sumWTb[ri * nCL + c] / r.sumW;
        if (Tf >= T_OK) offs[pi][ri * nCL + c] = -Math.log(Tf) + Math.log(Tu);
        if (Tb >= T_OK) offs[nP + pi][ri * nCL + c] = -Math.log(Tb) + Math.log(Tu);
      }
    }
    // 방위 평균(칸 폭 무게, 360°)
    const avg = new Array(nR * nCL).fill(null);
    for (let j = 0; j < nR * nCL; j++) {
      let sw = 0, sv = 0;
      for (let pj = 0; pj < nP2; pj++) if (offs[pj][j] != null) { sw += phiW360[pj]; sv += phiW360[pj] * offs[pj][j]; }
      if (sw > 0) avg[j] = sv / sw;
    }
    for (let ri = 0; ri < nR; ri++) {
      const v = [];
      for (let c = 0; c < nCL; c++) if (avg[ri * nCL + c] != null) v.push(avg[ri * nCL + c]);
      let tc0 = 0;
      if (v.length) {
        const mx = Math.max(...v), mn = Math.min(...v);
        tc0 = (mx + mn) / 2;
        spreads.push((mx - mn) / 2);
      } else stats.tauCNoData++;
      tauC[E.tauCOffset + (ci * nH + hi) * nR + ri] = q(tc0);
      // L 별: 자료 없는 L 은 가장 가까운 자료 있는 L 의 값, 하나도 없으면 상수(0)
      for (let c = 0; c < nCL; c++) {
        let best = null;
        for (let d = 0; d < nCL && best == null; d++) for (const cc of [c - d, c + d]) {
          if (cc >= 0 && cc < nCL && avg[ri * nCL + cc] != null && best == null) best = avg[ri * nCL + cc];
        }
        tauCL[(E.tauCOffset + (ci * nH + hi) * nR + ri) * nCL + c] = q(best ?? tc0);
      }
    }
    // 방위별(고르게, 360° 원형): 자료 없는 칸은 방위 평균 L 별 값
    for (let pi = 0; pi < nP2; pi++) {
      const hw = F.PHI_SMOOTH(PHI360[pi]);
      for (let j = 0; j < nR * nCL; j++) {
        let sw = 0, sv = 0;
        for (let pj = 0; pj < nP2; pj++) {
          const d = angDist(PHI360[pj], PHI360[pi]), v = offs[pj][j];
          if (d > hw || v == null) continue;
          const w = phiW360[pj] * (1 - d / (hw + 1e-9));
          sw += w; sv += w * v;
        }
        const ri = Math.floor(j / nCL), c = j % nCL;
        if (!(sw > 0)) stats.tauCPhiFallback++;
        const val = sw > 0 ? sv / sw : tauCL[(E.tauCOffset + (ci * nH + hi) * nR + ri) * nCL + c] / 1000;
        tauCPhi[E.tauCPhiOffset + (((ci * nH + hi) * nP2 + pi) * nR + ri) * nCL + c] = q8(val);
      }
    }
  }
});
spreads.sort((a, b) => a - b);
stats.tauCSpreadMax = +(spreads[spreads.length - 1] ?? 0).toFixed(4);
stats.tauCSpreadP95 = +(spreads[Math.floor(0.95 * (spreads.length - 1))] ?? 0).toFixed(4);

const bin = Buffer.concat([Buffer.from(tau.buffer, tau.byteOffset, tau.byteLength), Buffer.from(tauC.buffer, tauC.byteOffset, tauC.byteLength),
  Buffer.from(tauCL.buffer, tauCL.byteOffset, tauCL.byteLength), Buffer.from(tauCPhi.buffer, tauCPhi.byteOffset, tauCPhi.byteLength)]);
// uint8 블록이 끝이라 앞 블록의 2 바이트 정렬은 그대로(τ·τ_c·τ_c(L) 모두 짝수 바이트)
const header = {
  name: 'tsun-fixture',
  section: '§179 WP1 (design v2 §8 WP1, v2.1 §4.4·§8)',
  version: 1,
  note: 'T_sun 빈틈 법칙: 수평선 무차별 ⟨T(0,L)⟩ → τ(L) 표(G(Λ)=τ(Λ/λ₁₀)) + 구름 안 시작 조건부 오프셋 τ_c. 렌더러 밀도 복제(앱 종류 타일 × 단면 × shape.bin 침식, mip 0, quality low). [computed]',
  layout: {
    endian: 'little',
    tau: { type: 'uint16', scale: 0.001, order: '[entry][cover][hf][phi][L]', offsetBytes: 0, count: tauLen },
    tauC: { type: 'int16', scale: 0.001, order: '[entry][cover][hf][reach]', offsetBytes: tau.byteLength, count: tauCLen },
    tauCL: { type: 'int16', scale: 0.001, order: '[entry][cover][hf][reach][condL]', offsetBytes: tau.byteLength + tauC.byteLength, count: tauCL.length },
    tauCPhi: { type: 'uint8', scale: TCP_SCALE, offset: TCP_OFFSET, order: '[entry][cover][hf][phi360][reach][condL]', offsetBytes: tau.byteLength + tauC.byteLength + tauCL.byteLength, count: tauCPhi.length },
  },
  grids: { L: F.L_GRID, reach: F.REACH_GRID, condL: F.CONDL_KM, hf: F.HF_GRID, phi: PHI, phi360: PHI360, covers: F.COVER_GRID, fullCover: F.FULL_COVER },
  rules: {
    lambda10: 'λ₁₀ = τ(L*)/L*, L* = 가장 긴 격자 L ≤ 10 km 중 τ(L) ≤ ln(1e4); 없으면 L[0]',
    G: 'G(Λ; 칸) = τ_칸(Λ/λ₁₀_칸) — L 사이 선형, τ(0) = 0, 40 km 너머는 마지막 마디 기울기',
    hfEnds: 'hf 0 과 1 은 두 단면 모두 hs = 0 → 0 칸(평가기)',
    hfPerEntry: '항목의 hf 격자는 entries[].hf(기본 grids.hf + 덧붙인 마디 — ns 의 윗면·밑면 0.025 간격)',
    coverBelow: 'c < covers[0] 은 c = 0 의 0 칸과 선형',
    coverFull: 'c ≥ fullCover(0.999) 는 생성기가 문턱을 끈 장(불연속) — 1.0 칸만; c < fullCover 는 fullCover 아래 칸끼리만(0.998 에서 자름)',
    phi: '방위 φ = 해 쪽 선 방향(북에서 시계, 평면 (동, 북) = 종류 타일 uv). τ 는 mod 180(무조건 창은 뒤집기 대칭), 1°/5° 격자 사이 선형',
    tauC: 'σ 가중 구름 안(σ ≥ 0.1/km) 시작, 방위 평균(360°, φ 칸 폭 가중), L ∈ condL 의 minimax 상수; 두 T ≥ 1e−4 인 L 만',
    tauCPhi: 'τ_c 의 방위(360° — 뒤집기 대칭 아님)·도달·L 별 값, 이웃 방위 삼각 무게(반폭 축 ±15° 안 2.5°, 밖 7.5°); 자료 없으면 방위 평균 tauCL; uint8, τ_c = offset + scale·b',
    tauCL: 'τ_c 의 L 별 값(condL 2·5·10 km, 방위 평균) — L < 2 는 0 에서 선형, L > 10 은 10 km 값; 자료 없는 L 은 가장 가까운 L',
    fallback: '표에 없는 (종류, 레인) → 같은 종류의 첫 항목(다른 타일 실현); 종류가 없으면 null(빌더가 처리)',
    densityScale: '표는 GENUS.densityScale 로 만듦 — 층 opts 가 다르면(cs 의 DNI 덮개 등) 빌더가 Λ 를 비율로 늘림(근사)',
  },
  params: { ...P, mip: 0, quality: 'low (shape detail 없음)', shapeRepeat: 3e-4, sigmaIn: F.SIGMA_IN, seed: F.BUILD_SEED.toString(), tauMax: TAU_MAX, tOk: T_OK,
    tileSeed: 7, tileS: P.S, tileKm: P.tileKm, coverAxis: 'makeGenusWeather 입력 운량(genusCoverIn 역표 뒤)' },
  entries: entries.map(E => ({ genus: E.genus, lane: E.lane, opts: E.opts ?? null, covers: E.covers, hf: E.hf, profile: E.prof, tauOffset: E.tauOffset, tauCOffset: E.tauCOffset, tauCPhiOffset: E.tauCPhiOffset })),
  provenance: {
    srcRev, sources, shapeBin: F.sha256(fs.readFileSync(F.SHAPE_BIN)), core: F.sha256(fs.readFileSync(path.join(F.HERE, 'tsunfix.c'))),
    lib: F.sha256(fs.readFileSync(path.join(F.HERE, 'fixture-lib.mjs'))), builder: F.sha256(fs.readFileSync(path.join(F.HERE, 'fixture-build.mjs'))),
    tilesBlob: F.sha256(tilesBlob), tiles: tileIndex,
  },
  stats,
  partial: ONLY || PHI_RANGE || PART_ENTRIES ? { entries: PART_ENTRIES ?? (ONLY ? [...ONLY] : null), phiRange: PHI_RANGE } : null,
  binBytes: bin.length,
  binSha256: F.sha256(bin),
};
fs.writeFileSync(path.join(OUT, 'tsun-fixture.bin'), bin);
fs.writeFileSync(path.join(OUT, 'tsun-fixture.json'), JSON.stringify(header, null, 1) + '\n');
const log = { wallS: (Date.now() - t0) / 1000, coreS: coreMs / 1000, cells: stats.cells, jobs: JOBS, out: OUT, binBytes: bin.length, binSha256: header.binSha256,
  headerSha256: F.sha256(fs.readFileSync(path.join(OUT, 'tsun-fixture.json'))) };
fs.writeFileSync(path.join(TMP, 'build-log.json'), JSON.stringify(log, null, 1));
console.log(JSON.stringify(log));
