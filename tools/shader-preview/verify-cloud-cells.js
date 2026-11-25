/**
 * **고적운 · 층적운 세포 무늬(셰이더)가 흐린 날 · 판 구름을 건드리지 않고 구름을 세포로 끊는가** — 판정(계획 문서 §24.11). 브라우저·네트워크 불필요.
 *
 * 세포는 날씨 지도에 굽지 않고 셰이더가 주기 타일(cloudCells.ts)을 읽어 날씨 값 lw 를 바꿉니다. 여기서는 셰이더 식의 CPU 판(cellModulate)과
 * 타일 바이트(makeCellTileData)로 재고, 셰이더 글자와 장면 연결은 글자로 확인합니다. 모양은 숫자로 못 정하므로 앱 렌더(volsky 하네스)로 사람이 봅니다.
 *
 * 먼저 정한 줄(실행 전):
 *  1. 끄면 그대로 — 세기 0 이면 lw 가 바뀌지 않는다(모든 lw · 타일 값).
 *  2. 흐린 날 · 판 구름 — 세기는 운량 ≤ 0.7 에서 1, ≥ 0.95 에서 0. ns · st · as · cu · cb · ci · cs 레인은 0, ac · sc 만 켜짐. 층 opts.cells 0 이면 끔.
 *  3. 빈 하늘 — lw = 0 이면 결과 0(세포가 구름을 만들지 않음).
 *  4. 멀리서는 틈이 없다 — far = 1 이면 lw > 0 인 곳은 모두 > 0 (풀리지 않는 세포는 평균 농도로, 반짝이는 구멍 없음).
 *  5. 타일 — 주기(왼쪽 끝 열과 오른쪽 끝 열의 평균 차이가 안쪽 이웃 열 차이의 2 배 안), 세포 틈(inner = 0) 몫이 0.15~0.5, 세포 속(inner = 1) 몫 ≥ 0.3.
 *  6. 끊김 — 흐름 무늬(ac 운량 0.5, 앱 길) 4 km 창을 세포 타일 해상도로 다시 읽어 세포를 걸면 조각 수가 걸기 전의 5 배 이상, 가장 큰 조각의 몫이 절반 아래.
 *  7. 셰이더 — 패치가 흐름 패치의 바닥 올리기 문장 바로 앞에 들어가고(그 문장 뒤의 구름 판정이 세포를 봄), 볼륨 장면이 두 패스에 걸고 두 경로에서 레인을 넣는다.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { components } = require('./measure-cloud-cells');

const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

function build() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-cells-v-'));
  const entry = path.join(work, 'runner.ts'), stub = path.join(work, 'rn-stub.js'), bundle = path.join(work, 'runner.cjs');
  fs.writeFileSync(stub, 'module.exports = { Platform: { OS: "web" }, Asset: { fromModule: () => ({ downloadAsync: async () => {} }) } };');
  fs.writeFileSync(entry, `import * as C from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/cloudCells.ts'))};
    import { makeGenusWeather, mergeFlowOpts, planFlowScene } from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/cloudGenus.ts'))};
    (globalThis as any).__CC = { C, makeGenusWeather, mergeFlowOpts, planFlowScene };`);
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=cjs', '--platform=node', '--define:__DEV__=false', '--loader:.png=empty',
    `--alias:react-native=${stub}`, `--alias:expo-asset=${stub}`, `--outfile=${bundle}`, '--log-level=error'], { cwd: ROOT, stdio: 'inherit' });
  globalThis.expo = { NativeModule: class {}, EventEmitter: class {}, SharedObject: class {} };
  require(bundle);
  return globalThis.__CC;
}

(() => {
  const { C, makeGenusWeather, mergeFlowOpts, planFlowScene } = build();
  const P = C.CELL_TILE_PX;
  const tile = C.makeCellTileData();
  const tv = (x, y) => { const o = ((((y % P) + P) % P) * P + (((x % P) + P) % P)) * 4; return [tile[o] / 255, tile[o + 1] / 255, tile[o + 2] / 255]; };

  console.log('\n[1] 끄면 그대로 · [3] 빈 하늘 · [4] 멀리서는 틈 없음');
  let id = true, empty = true, farHole = 0, farN = 0;
  for (let k = 0; k < 4000; k++) {
    const lw = (k % 101) / 100, t = tv((k * 37) % P, (k * 91) % P);
    if (C.cellModulate(lw, t, 0) !== lw) id = false;
    if (C.cellModulate(0, t, 1) !== 0 || C.cellModulate(0, t, 1, 1) !== 0) empty = false;
    if (lw > 0) { farN++; if (!(C.cellModulate(lw, t, 1, 1) > 0)) farHole++; }
  }
  ok(id, '세기 0: lw 그대로(4000 점)');
  ok(empty, 'lw 0: 결과 0(가까이 · 멀리)');
  ok(farHole === 0, `far 1: lw > 0 인 ${farN} 점 모두 > 0 (구멍 ${farHole})`);

  console.log('\n[2] 흐린 날 · 판 구름');
  ok(C.cellAmpForCover(0.3) === 1 && C.cellAmpForCover(0.7) === 1 && C.cellAmpForCover(0.95) === 0 && C.cellAmpForCover(1) === 0 && C.cellAmpForCover(0.8) > 0 && C.cellAmpForCover(0.8) < 1,
    `세기: 0.3·0.7 → 1, 0.8 → ${C.cellAmpForCover(0.8).toFixed(2)}, 0.95·1 → 0`);
  const gen = ['ac', 'sc', 'ns', 'st', 'as', 'cu', 'cb', 'ci', 'cs'];
  const lanes = gen.map(g => C.cellLanes([{ genus: g, cover: 0.5 }, null, null, null], [0.5, 1, 1, 1], [500, 0, 0, 0]).amp[0]);
  ok(lanes.join() === '1,1,0,0,0,0,0,0,0', `켜지는 종류: ${gen.map((g, i) => g + lanes[i]).join(' ')}`);
  ok(C.cellLanes([{ genus: 'ac', cover: 0.5, opts: { cells: 0 } }, null, null, null], [0.5, 1, 1, 1], [400, 0, 0, 0]).amp[0] === 0, 'opts.cells 0 이면 끔');
  ok(C.cellLanes([{ genus: 'sc', cover: 0.97 }, null, null, null], [0.97, 1, 1, 1], [750, 0, 0, 0]).amp[0] === 0, 'sc 운량 0.97: 끔');

  console.log('\n[5] 타일');
  {
    let edge = 0, inner = 0;
    for (let y = 0; y < P; y++) { const a = tv(P - 1, y), b = tv(0, y), c = tv(P - 2, y); edge += Math.abs(a[0] - b[0]); inner += Math.abs(a[0] - c[0]); }
    ok(edge <= 2 * inner, `주기: 끝 열 차이 ${(edge / P).toFixed(3)} ≤ 2 × 이웃 열 차이 ${(inner / P).toFixed(3)}`);
    let gap = 0, core = 0;
    const p = C.CELL_PARAMS;
    for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
      const t = tv(x, y); const v = (t[0] * 0.6 + (t[2] - 0.5) * 2 * p.rag - p.border) / p.soft;
      if (v <= 0) gap++; if (v >= 1) core++;
    }
    gap /= P * P; core /= P * P;
    ok(gap >= 0.15 && gap <= 0.5, `세포 틈 몫 ${gap.toFixed(3)} ∈ [0.15, 0.5]`);
    ok(core >= 0.3, `세포 속 몫 ${core.toFixed(3)} ≥ 0.3`);
  }

  console.log('\n[6] 끊김(흐름 무늬 ac 운량 0.5 위)');
  {
    const L = mergeFlowOpts({ genus: 'ac', cover: 0.5, opts: { windU: 30, windV: 10, shearU: 25, shearV: 8, flowSeed: 11 } });
    const d = makeGenusWeather([L], 256, 24, 11, [], planFlowScene([L], { n: 64, steps: 20, hours: 0.5, vrms: 2, psiEvery: 2, qMode: 0, qN: 128, qH: 0.5, s90: 0 })).image.data;
    // 4 km 창(세포 λ 1.1 km 로 타일 하나 8.8 km)을 타일 해상도(34 m)로 다시 읽음. 날씨는 이중선형.
    const W = 24, lam = 2.75 * 0.4, tileKm = C.CELL_TILE_N * lam, M = Math.round(4 / (tileKm / P));
    let best = null;
    for (let oy = 0; oy < 24; oy += 4) for (let ox = 0; ox < 24; ox += 4) {
      const lwAt = (km) => { const fx = (km[0] / W) * 256, fy = (km[1] / W) * 256; const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
        const g = (x, y) => d[((((y % 256) + 256) % 256) * 256 + (((x % 256) + 256) % 256)) * 4] / 255;
        return (g(x0, y0) * (1 - ax) + g(x0 + 1, y0) * ax) * (1 - ay) + (g(x0, y0 + 1) * (1 - ax) + g(x0 + 1, y0 + 1) * ax) * ay; };
      const before = new Uint8Array(M * M), after = new Uint8Array(M * M);
      let cov = 0;
      for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
        const km = [ox + x * tileKm / P, oy + y * tileKm / P];
        const lw = lwAt(km); const o = y * M + x;
        before[o] = lw > 1.5 / 255 ? 1 : 0; if (lw > 1.5 / 255) cov++;
        after[o] = C.cellModulate(lw, tv(x, y), 1) > 1.5 / 255 ? 1 : 0;
      }
      cov /= M * M;
      if (cov > 0.3 && cov < 0.8 && (!best || Math.abs(cov - 0.55) < Math.abs(best.cov - 0.55))) best = { cov, before, after, ox, oy };
    }
    const comp = (img) => { const c = components(img, M).comps.map(q => q.length); const tot = c.reduce((a, b) => a + b, 0); return { n: c.filter(s => s >= 9).length, lf: tot ? Math.max(...c) / tot : 0 }; };
    const b = comp(best.before), a = comp(best.after);
    ok(a.n >= 5 * Math.max(1, b.n), `창(${best.ox}, ${best.oy}) km, 덮임 ${best.cov.toFixed(2)}: 조각(≥ 9칸) ${b.n} → ${a.n} (≥ 5 배)`);
    ok(a.lf < 0.5 * b.lf, `가장 큰 조각의 몫 ${b.lf.toFixed(2)} → ${a.lf.toFixed(2)} (< 절반)`);
  }

  console.log('\n[7] 셰이더 · 연결');
  {
    const cells = fs.readFileSync(path.join(ROOT, 'src/components/VolumetricProbe/cloudCells.ts'), 'utf8');
    const flow = fs.readFileSync(path.join(ROOT, 'src/components/VolumetricProbe/cloudFlowShader.ts'), 'utf8');
    const vs = fs.readFileSync(path.join(ROOT, 'src/components/VolumetricProbe/volumetricScene.ts'), 'utf8');
    const anchor = "vec4 gCloudMask = smoothstep(vec4(0.0), vec4(1.5 / 255.0), localWeather);";
    ok(cells.includes(anchor) && flow.includes(anchor), '앵커(바닥 올리기 문장)가 흐름 패치와 세포 패치에 같은 글자로 있음');
    ok(/'    localWeather = mix\(localWeather, cV, cellAmp\);',\s*'  }',\s*ANCHOR,/.test(cells), '세포 블록이 앵커 바로 앞에 들어감');
    const iFlow = vs.indexOf('patchFlowShader(clouds.shadowPass'), iCell = vs.indexOf('patchCellShader(clouds.cloudsPass'), iCell2 = vs.indexOf('patchCellShader(clouds.shadowPass');
    ok(iFlow > 0 && iCell > iFlow && iCell2 > iFlow, '볼륨 장면: 흐름 패치 뒤 두 패스에 세포 패치');
    ok((vs.match(/setCellUniforms\(m, cellLanesOf\(/g) || []).length === 2 && /setCellUniforms\(m, null\)/.test(vs), '장면 두 경로에서 레인을 넣고, 구름 없는 경로에서 끔');
    ok(/cells: true/.test(vs), '기본 켬(VolumetricOptions.cells)');
  }

  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
