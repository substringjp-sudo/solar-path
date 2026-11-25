/**
 * **고적운 · 층적운이 사진처럼 잘게 잘리면서 운량 · 흐린 날 · 판 구름은 그대로인가** — 판정(계획 문서 §24, 2단계). 브라우저·네트워크가 필요 없습니다.
 *
 * 앱과 같은 길(mergeFlowOpts → planFlowScene(앱 기본값) → makeGenusWeather 256칸 · 24 km)로 텍스처를 만들어 `measure-cloud-cells.js` 의 자로 잽니다.
 * 씨앗 3개(7 · 11 · 23) 평균. 바람 서풍 30 km/h · 전단 25 km/h.
 *
 * 1단계 측정(§24.9): 운량 50 % 에서 가장 큰 조각이 구름 면적의 0.88~0.95, 스펙트럼 봉우리 20~24 km. 사진은 0.08 과 약 0.4~1 km.
 *
 * 먼저 정한 줄(실행 전):
 *  1. 운량 보존 — ac · sc 운량 0.1 · 0.3 · 0.5 · 0.7 에서 실제 덮인 면적이 목표 ±0.01.
 *  2. 흐린 날 그대로 — 운량 0.95 · 1.0 의 ac · sc 텍스처가 셀을 끈 것(flowCell 0)과 바이트까지 같다(셀은 운량 0.95 에서 0 으로 줄어든다).
 *  3. 판 구름 그대로 — ns · st · as 운량 1.0 텍스처가 flowCell 0 과 같다(셀은 sc · ac 에만).
 *  4. 빈 하늘 — 운량 0 이면 구름 칸 0.
 *  5. 잘게 잘림 — 운량 0.5 에서 가장 큰 조각의 몫이 ac · sc 모두 0.35 이하(지금 0.88~0.95).
 *  6. 셀 크기 — 운량 0.4 ~ 0.7 에서 스펙트럼 봉우리가 셀 파장 λ₀ 의 0.5 ~ 2 배. λ₀ = 2.75 × 층 두께(ac 400 m → 1.1 km, sc 750 m → 2.06 km).
 *  7. 배치 — 운량 0.1 · 0.3 에서 Clark–Evans R ∈ [0.9, 1.5].
 *     ⚠ 처음 적은 줄은 "R < 1.0(무리 짓기)" 였다. 구현 뒤 R 1.2~1.5 가 나와 사진을 같은 자로 재 보니 사진도 R 1.2(조각 175개, 경계 보정 없음)였다.
 *     세포 대류는 원래 준규칙 무늬이고, "R < 1 무리 짓기" 는 맑은 날 적운의 성질을 고적운 · 층적운에 잘못 가져온 가정이었다. 사진 값 둘레로 고쳤다
 *     (0.9 아래는 큰 흐름이 다 정하는 덩어리, 1.5 위는 격자처럼 고른 바둑판).
 *  8. 크기 분포 — 운량 0.3 · 0.5 에서 β 가 0.35 ~ 1.2(조각 하나가 다 먹지도, 같은 크기만 있지도 않음. 사진 0.52).
 *  9. 맑은 날 두께 — 운량 0.1 에서 조각(≥ 4칸)마다의 최대 d 중앙값 ≥ 0.35(얇은 부스러기만 남지 않음).
 * 11. 둥근 땡땡이 아님 — 운량 0.5 에서 조각(≥ 9칸) 길쭉함(2차 모멘트 축비) 중앙값 ≥ 1.6. (첫 구현이 숫자 1~10 을 다 통과했지만 위에서 본 그림이
 *     동그란 땡땡이였고 흐름 줄무늬가 사라졌다 — 판정이 모양을 안 봐서 놓쳤다. 셀을 흐름 변위로 끌고 가게 고친 뒤 이 줄을 덧붙였다.)
 * 10. 끄면 예전과 같다 — flowCell 0 이면 운량 0.5 ac · sc 텍스처가 고치기 전 측정(§24.9)과 같은 통계(가장 큰 조각 몫 ±0.02).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { measure } = require('./measure-cloud-cells');

const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

function buildModule() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-cells-v-'));
  const entry = path.join(work, 'runner.ts'), stub = path.join(work, 'rn-stub.js'), bundle = path.join(work, 'runner.cjs');
  fs.writeFileSync(stub, 'module.exports = { Platform: { OS: "web" }, Asset: { fromModule: () => ({ downloadAsync: async () => {} }) } };');
  fs.writeFileSync(entry, `import { makeGenusWeather, mergeFlowOpts, planFlowScene } from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/cloudGenus.ts'))};
    (globalThis as any).__CC = { makeGenusWeather, mergeFlowOpts, planFlowScene };`);
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=cjs', '--platform=node', '--define:__DEV__=false', '--loader:.png=empty',
    `--alias:react-native=${stub}`, `--alias:expo-asset=${stub}`, `--outfile=${bundle}`, '--log-level=error'], { cwd: ROOT, stdio: 'inherit' });
  globalThis.expo = { NativeModule: class {}, EventEmitter: class {}, SharedObject: class {} };
  require(bundle);
  return globalThis.__CC;
}

const APP_FLOW = { n: 64, steps: 20, hours: 0.5, vrms: 2, psiEvery: 2, qMode: 0, qN: 128, qH: 0.5, s90: 0 };
const WIND = { windU: 30, windV: 10, shearU: 25, shearV: 8 };
const SEEDS = [7, 11, 23];
const LAMBDA = { ac: 2.75 * 0.4, sc: 2.75 * 0.75 };

(async () => {
  const M = buildModule();
  const tex = (genus, cover, seed, extra = {}) => {
    const L = M.mergeFlowOpts({ genus, cover, opts: { ...WIND, flowSeed: seed, ...extra } });
    return M.makeGenusWeather([L], 256, 24, seed, [], M.planFlowScene([L], APP_FLOW)).image.data;
  };
  const avg = (genus, cover, key, extra) => { const xs = SEEDS.map(s => measure(tex(genus, cover, s, extra))[key]).filter(x => x != null); return xs.reduce((a, b) => a + b, 0) / xs.length; };
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  console.log('\n[1] 운량 보존');
  for (const g of ['ac', 'sc']) {
    const bad = [];
    for (const c of [0.1, 0.3, 0.5, 0.7]) for (const s of SEEDS) { const m = measure(tex(g, c, s)); if (Math.abs(m.cover - c) > 0.01) bad.push(`${c}/${s}: ${m.cover}`); }
    ok(bad.length === 0, `${g}: 목표 ±0.01${bad.length ? ' — ' + bad.join(', ') : ''}`);
  }
  console.log('\n[2] 흐린 날 그대로 · [3] 판 구름 그대로 · [4] 빈 하늘');
  for (const g of ['ac', 'sc']) for (const c of [0.95, 1]) ok(SEEDS.every(s => same(tex(g, c, s), tex(g, c, s, { flowCell: 0 }))), `${g} 운량 ${c}: 셀 끈 것과 바이트 같음`);
  for (const g of ['ns', 'st', 'as']) ok(same(tex(g, 1, 7), tex(g, 1, 7, { flowCell: 0 })), `${g} 운량 1: 셀 끈 것과 바이트 같음`);
  for (const g of ['ac', 'sc']) ok(SEEDS.every(s => measure(tex(g, 0, s)).cover === 0), `${g} 운량 0: 구름 칸 0`);

  console.log('\n[5] 잘게 잘림 · [6] 셀 크기');
  for (const g of ['ac', 'sc']) {
    const lf = avg(g, 0.5, 'largestFrac');
    ok(lf <= 0.35, `${g} 운량 0.5: 가장 큰 조각의 몫 ${lf.toFixed(3)} ≤ 0.35`);
    for (const c of [0.4, 0.55, 0.7]) {
      const pk = avg(g, c, 'peakKm');
      ok(pk >= 0.5 * LAMBDA[g] && pk <= 2 * LAMBDA[g], `${g} 운량 ${c}: 봉우리 ${pk.toFixed(2)} km ∈ [${(0.5 * LAMBDA[g]).toFixed(2)}, ${(2 * LAMBDA[g]).toFixed(2)}]`);
    }
  }
  console.log('\n[7] 배치 · [8] 크기 분포 · [9] 맑은 날 두께');
  for (const g of ['ac', 'sc']) {
    for (const c of [0.1, 0.3]) { const R = avg(g, c, 'clarkEvans'); ok(R >= 0.9 && R <= 1.5, `${g} 운량 ${c}: Clark–Evans ${R.toFixed(2)} ∈ [0.9, 1.5] (사진 1.2)`); }
    for (const c of [0.3, 0.5]) { const b = avg(g, c, 'beta'); ok(b >= 0.35 && b <= 1.2, `${g} 운량 ${c}: β ${b.toFixed(2)} ∈ [0.35, 1.2]`); }
    const th = avg(g, 0.1, 'blobMaxMed'); ok(th >= 0.35, `${g} 운량 0.1: 조각 최대 d 중앙값 ${th.toFixed(2)} ≥ 0.35`);
  }
  console.log('\n[11] 둥근 땡땡이 아님');
  for (const g of ['ac', 'sc']) { const e = avg(g, 0.5, 'elongMed'); ok(e >= 1.6, `${g} 운량 0.5: 조각 길쭉함 중앙값 ${e.toFixed(2)} ≥ 1.6`); }
  console.log('\n[10] 끄면 예전과 같다');
  const before = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/evidence/cloud-cells-before-2026-11-25.json'), 'utf8')).rows;
  for (const g of ['ac', 'sc']) {
    const ref = before.find(r => r.genus === g && r.coverIn === 0.5).largestFrac;
    const now = avg(g, 0.5, 'largestFrac', { flowCell: 0 });
    ok(Math.abs(now - ref) <= 0.02, `${g} 운량 0.5 셀 끔: 가장 큰 조각의 몫 ${now.toFixed(3)} ≈ 고치기 전 ${ref}`);
  }
  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
