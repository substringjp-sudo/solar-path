/**
 * **지형 평탄화 둘(건물 발자국 바닥 · 강 수면)이 각자 맞고, 같이 써도 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * `src/utils/demBuildingFlatten.ts` 의 순수 함수 `flattenFootprints`(건물마다 발자국 아래를 한 높이로)와
 * `flattenWaterHeights`(넓은 물 칸을 평평한 수면으로)를 합성 격자에 대어 봅니다. 두 기능은 따로 만들어진 PR 둘이었고, 합칠 때 같은 파일의
 * 같은 자리를 고쳐서 충돌이 났습니다. 이 판정은 합친 결과가 두 기능을 다 지니는지 지킵니다. `flattenDemPatchUnderBuildings` 안에서의 순서
 * (수면 → 발자국)와 같은 순서로 이어 부르는 시험도 있습니다(GPU 읽기가 필요한 그 함수 자체는 부르지 않습니다).
 *
 * 먼저 정한 줄(실행 전):
 *  1. 발자국: 비탈 위 8×8 칸 건물 — 발자국 안 모든 칸이 **한 값**, 그 값은 발자국 안 최댓값 이하이고 둘레 고리의 가장 낮은 값 이상이며
 *     고리 중앙값 이하(낮은 분위수), 발자국 밖 칸은 한 칸도 안 바뀐다.
 *     구덩이 위의 건물(안이 둘레보다 낮음)은 발자국 안의 가장 높은 값에서 멈춘다(둘레 높이로 올려 구덩이를 메우지 않음). 고리가 거의 빈 곳(발자국이
 *     격자를 덮음)과 빈 목록은 그대로.
 *     격자 가장자리에 걸친 발자국도 던지지 않는다.
 *  2. 수면: 다리(강 위 15 m 솟음 4 칸)와 잡음(±0.8 m)이 섞인 강 — 강을 가로지른 높이 차가 0.15 m 이하, 다리 자리가 이웃 수면과 0.5 m 안,
 *     둑(물 아닌 칸)은 한 칸도 안 바뀐다, 좁은 개울(폭 10 m)은 그대로, 물이 없으면 그대로.
 *  3. 같이: 강가의 건물이 있는 격자에 수면 → 발자국 순으로 부르면 위 둘이 모두 지켜지고 NaN 이 없다. 발자국 바닥은 평평해진 수면에서 잰다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-dem-flatten.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

// 재현 가능한 난수
let seed = 20261119;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

(async () => {
  const F = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'demBuildingFlatten.js'));
  const N = 128, TEXEL = 5;   // 5 m 칸, 640 m 격자
  const idx = (i, j) => j * N + i;
  const rect = (x0, y0, x1, y1) => Float32Array.from([x0, y0, x1, y0, x1, y1, x0, y1]);   // 칸 좌표 (칸 i 의 중심 = i + 0.5)
  const inRect = (r, i, j) => i + 0.5 >= r[0] && i + 0.5 < r[2] && j + 0.5 >= r[1] && j + 0.5 < r[5];
  const sameOutside = (a, b, skip) => { for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (!skip(i, j) && a[idx(i, j)] !== b[idx(i, j)]) return false; return true; };
  const median = (xs) => { const s = [...xs].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };

  // ── [1] 발자국 ──
  console.log('\n[1] 발자국 바닥');
  {
    const h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[idx(i, j)] = 100 + 0.5 * i;   // 동으로 오르는 비탈(0.1 m/m)
    const fp = rect(60, 60, 68, 68);                 // 8×8 칸
    const r = F.flattenFootprints(h, N, TEXEL, [fp]);
    let vals = new Set(), inMax = -Infinity, ringVals = [], R = 2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (inRect(fp, i, j)) { vals.add(r.heights[idx(i, j)]); inMax = Math.max(inMax, h[idx(i, j)]); }
      else if (i >= 58 && i < 70 && j >= 58 && j < 70) ringVals.push(h[idx(i, j)]);
    }
    const pad = [...vals][0];
    ok(vals.size === 1, `발자국 안 64 칸이 모두 한 값이다 (${vals.size} 가지)`);
    ok(pad <= inMax + 1e-4, `바닥 ${pad.toFixed(2)} m 은 발자국 안 최댓값 ${inMax.toFixed(2)} m 이하다`);
    ok(pad >= Math.min(...ringVals) - 1e-4 && pad <= median(ringVals) + 1e-4, `바닥은 고리 안에서 낮은 쪽이다 (최저 ${Math.min(...ringVals).toFixed(2)} ≤ ${pad.toFixed(2)} ≤ 중앙값 ${median(ringVals).toFixed(2)})`);
    ok(sameOutside(h, r.heights, (i, j) => inRect(fp, i, j)), '발자국 밖 칸은 한 칸도 안 바뀐다');
    ok(r.stats.touched === 64, `손댄 칸 ${r.stats.touched} = 64`);

    // 구덩이 위의 건물: 안이 둘레(100 m)보다 낮다(90~90.7 m). 바닥은 발자국 안의 가장 높은 값(90.7 m)에서 멈춘다 — 둘레 높이로 올려 구덩이를 메우지 않는다.
    const hp = new Float32Array(N * N).fill(100);
    for (let j = 60; j < 68; j++) for (let i = 60; i < 68; i++) hp[idx(i, j)] = 90 + 0.1 * (i - 60);
    const rp = F.flattenFootprints(hp, N, TEXEL, [fp]);
    let pmax = -Infinity, pmin = Infinity;
    for (let j = 60; j < 68; j++) for (let i = 60; i < 68; i++) { pmax = Math.max(pmax, rp.heights[idx(i, j)]); pmin = Math.min(pmin, rp.heights[idx(i, j)]); }
    ok(Math.abs(pmax - 90.7) < 1e-3 && Math.abs(pmin - 90.7) < 1e-3, `구덩이 위의 건물은 한 높이로 맞추되 둘레(100 m)로 올리지 않는다 — 바닥 ${pmin.toFixed(2)}~${pmax.toFixed(2)} m (안의 최고 90.7 m)`);
    ok(rp.stats.maxRaiseM <= 0.7 + 1e-3 && rp.stats.maxDropM < 1e-3, `올린 높이는 안의 높이 차(0.7 m) 이내다 (최대 ${rp.stats.maxRaiseM.toFixed(3)} m)`);

    // 고리가 빈 곳: 발자국이 격자를 거의 다 덮음
    const rd = F.flattenFootprints(h, N, TEXEL, [rect(0, 0, N, N)]);
    ok(rd.stats.touched === 0 && rd.heights.every((v, k) => v === h[k]), '고리가 거의 빈 곳(발자국이 격자를 덮음)은 건드리지 않는다');
    ok(F.flattenFootprints(h, N, TEXEL, []).heights === h, '빈 목록은 같은 배열을 그대로 돌려준다');
    let threw = false;
    try { F.flattenFootprints(h, N, TEXEL, [rect(-6, -6, 3, 3), rect(N - 3, N - 3, N + 6, N + 6), Float32Array.from([5, 5, 5, 5, 5, 5])]); } catch (e) { threw = true; }
    ok(!threw, '격자 가장자리에 걸친 발자국과 퇴화한 발자국도 던지지 않는다');
  }

  // ── [2] 수면 ──
  console.log('\n[2] 강 수면');
  const makeRiver = () => {
    const h = new Float32Array(N * N);
    const water = (i, j) => (j >= 50 && j < 70 ? 1 : 0);   // 폭 20 칸 = 100 m 강
    const narrow = (i, j) => (j >= 100 && j < 102 ? 1 : 0); // 폭 2 칸 = 10 m 개울
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (water(i, j)) h[idx(i, j)] = 10 - 0.01 * i + (rnd() - 0.5) * 1.6 + (i >= 60 && i < 64 ? 15 : 0);   // 완만한 경사 + 잡음 + 다리
      else if (narrow(i, j)) h[idx(i, j)] = 30 - 0.05 * i + (rnd() - 0.5) * 0.4;                              // 가파르게 흐르는 개울
      else h[idx(i, j)] = 20 + 0.02 * j;                                                                       // 둑과 들
    }
    return { h, waterAt: (i, j) => Math.max(water(i, j), narrow(i, j)), water, narrow };
  };
  {
    const { h, waterAt, water, narrow } = makeRiver();
    const r = F.flattenWaterHeights(h, N, TEXEL, waterAt);
    let worstAcross = 0;
    for (let i = 8; i < N - 8; i++) {
      let lo = Infinity, hi = -Infinity;
      for (let j = 52; j < 68; j++) { const v = r.heights[idx(i, j)]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      worstAcross = Math.max(worstAcross, hi - lo);
    }
    ok(worstAcross <= 0.15, `강을 가로지른 높이 차가 0.15 m 이하다 (최대 ${worstAcross.toFixed(3)} m, 원자료 잡음은 ±0.8 m)`);
    let bridgeMax = -Infinity, nbrMax = -Infinity;
    for (let j = 52; j < 68; j++) {
      for (let i = 60; i < 64; i++) bridgeMax = Math.max(bridgeMax, r.heights[idx(i, j)]);
      for (let i = 50; i < 56; i++) nbrMax = Math.max(nbrMax, r.heights[idx(i, j)]);
    }
    ok(bridgeMax <= nbrMax + 0.5, `다리 15 m 솟음이 지워져 이웃 수면과 0.5 m 안이다 (다리 ${bridgeMax.toFixed(2)} · 이웃 ${nbrMax.toFixed(2)})`);
    ok(sameOutside(h, r.heights, (i, j) => water(i, j) === 1 && !narrow(i, j)) || sameOutside(h, r.heights, (i, j) => water(i, j) === 1), '둑(물 아닌 칸)은 한 칸도 안 바뀐다');
    let narrowSame = true;
    for (let j = 100; j < 102; j++) for (let i = 0; i < N; i++) if (r.heights[idx(i, j)] !== h[idx(i, j)]) narrowSame = false;
    ok(narrowSame, '좁은 개울(폭 10 m)은 그대로다(산골 물길은 경사를 따라 흐름)');
    ok(r.stats.touched > 1500, `손댄 칸 ${r.stats.touched} (강 칸 ${20 * N} 중 대부분)`);
    ok(F.flattenWaterHeights(h, N, TEXEL, () => 0).heights === h, '물이 없으면 같은 배열을 그대로 돌려준다');
  }

  // ── [3] 같이 ──
  console.log('\n[3] 수면 → 발자국 순서로 이어 부르기');
  {
    const { h, waterAt, water, narrow } = makeRiver();
    // 강 위쪽 둑(행 50 바로 위) 강가에 건물
    const fp = rect(30, 40, 40, 48);   // 10×8 칸, 강(행 50)에서 2 칸 떨어짐
    const w = F.flattenWaterHeights(h, N, TEXEL, waterAt);
    const f = F.flattenFootprints(w.heights, N, TEXEL, [fp]);
    const out = f.heights;
    let finite = true;
    for (const v of out) if (!Number.isFinite(v)) { finite = false; break; }
    ok(finite, '결과에 NaN · Infinity 가 없다');
    let across = 0;
    for (let i = 8; i < N - 8; i++) { let lo = Infinity, hi = -Infinity; for (let j = 52; j < 68; j++) { lo = Math.min(lo, out[idx(i, j)]); hi = Math.max(hi, out[idx(i, j)]); } across = Math.max(across, hi - lo); }
    ok(across <= 0.15, `이어 불러도 강 수면이 평평하다 (가로지른 차 ${across.toFixed(3)} m)`);
    const vals = new Set();
    for (let j = 40; j < 48; j++) for (let i = 30; i < 40; i++) vals.add(out[idx(i, j)]);
    ok(vals.size === 1, '강가 건물의 발자국 80 칸이 한 값이다');
    const pad = [...vals][0];
    let inMax = -Infinity, ringMin = Infinity;
    for (let j = 38; j < 50; j++) for (let i = 28; i < 42; i++) {
      if (inRect(fp, i, j)) inMax = Math.max(inMax, w.heights[idx(i, j)]);
      else ringMin = Math.min(ringMin, w.heights[idx(i, j)]);
    }
    ok(pad <= inMax + 1e-4 && pad >= ringMin - 1e-4, `발자국 바닥 ${pad.toFixed(2)} m 이 [고리 최저 ${ringMin.toFixed(2)}, 안 최고 ${inMax.toFixed(2)}] 안이다`);
    ok(sameOutside(w.heights, out, (i, j) => inRect(fp, i, j)), '발자국 밖은 수면 평탄화 결과 그대로다(발자국 단계가 수면을 건드리지 않음)');
    let narrowSame = true;
    for (let j = 100; j < 102; j++) for (let i = 0; i < N; i++) if (out[idx(i, j)] !== h[idx(i, j)]) narrowSame = false;
    ok(narrowSame && water(0, 55) === 1 && narrow(0, 100) === 1, '좁은 개울은 끝까지 그대로다');
  }

  console.log(`\n${fail === 0 ? '모두 통과' : '실패 있음'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
