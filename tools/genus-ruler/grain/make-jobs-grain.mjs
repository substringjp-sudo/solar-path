#!/usr/bin/env node
/**
 * make-jobs-grain.mjs — RULER-grain 잡·장면 표(동결 대상). 손으로 고치지 말고 이 스크립트를 고칩니다(고치면 새 자).
 *   node tools/genus-ruler/grain/make-jobs-grain.mjs [--out jobs-grain.json] [--scenes-out scenes-grain.json]
 *        [--adopt adopt-R{k}.json] [--ref-ss 4|2] [--warm-high 16|64] [--device-h 2340] [--device-res 0.5]
 *  --adopt: grain.py --gate 가 쓴 채택 파일(손으로 쓰지 않음) — 라운드 k+1 의 B_k = C0 + 채택 델타 들. 없으면 모든 라운드의 기준이 C0(동결 파일).
 *  --ref-ss / --warm-high / --device-*: §4.5 줄이기 사다리·§3 G9 대안·기기 피치 재계산(m2) — 탐침(판정 아님) 결과로만, 판정 렌더 전에 정하고 인자를 기록.
 * 장면 이름 규칙(grain.py 가 같은 규칙으로 읽음 — grain-test.py 시험): <팔>__<층>_<시각>__<방위 t|s|a>__<틀 dev|std|hdev|ddev>[__<꼬리표>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out', path.join(HERE, 'jobs-grain.json'));
const SCENES_OUT = arg('--scenes-out', path.join(HERE, 'scenes-grain.json'));
const ADOPT = arg('--adopt', null);
const REF_SS = Number(arg('--ref-ss', '4'));
const WARM_HIGH = Number(arg('--warm-high', '16'));
const DEV_H = Number(arg('--device-h', '2340'));
const DEV_RES = Number(arg('--device-res', '0.5'));

// ───── 장소·시각(엔진 해 위치: volsky/sun-azel.mjs, 2026-10-28 렌더 전에 잼) ─────
const SITE = { lat: 36.5679, lon: 136.6774, heightM: 103 };
const TIMES = {
  e45: { iso: '2026-10-03T04:00:00.000Z', az: 208.268, el: 45.622 },
  e20: { iso: '2026-10-03T06:45:00.000Z', az: 248.230, el: 20.560 },
  e8: { iso: '2026-10-03T07:50:00.000Z', az: 258.886, el: 8.039 },
  e5: { iso: '2026-10-03T08:05:00.000Z', az: 261.178, el: 5.070 },
  e3: { iso: '2026-10-03T08:15:00.000Z', az: 262.686, el: 3.080 },
  tw: { iso: '2026-10-03T08:40:00.000Z', az: 266.412, el: -1.921 },
  tw4: { iso: '2026-10-03T08:50:00.000Z', az: 267.895, el: -3.929 },
};
const AZ_OFF = { t: 4, s: 97, a: -172 };     // 해 쪽(해가 화면 안) · 옆 · 해 반대
const azOf = (time, k) => +(((TIMES[time].az + AZ_OFF[k]) % 360 + 360) % 360).toFixed(3);
// ───── 층(단층, 이전 자와 같은 값) ─────
const LAYERS = {
  cu35: { genus: 'cu', cover: 0.35, baseKm: 1.5, band: 'low', photo: 'Cu', partial: true, thickM: 1600, shapeAmount: 1.0 },
  sc25: { genus: 'sc', cover: 0.25, baseKm: 1.5, band: 'low', photo: 'StSc', partial: true, thickM: 750, shapeAmount: 1.0 },
  sc85: { genus: 'sc', cover: 0.85, baseKm: 1.5, band: 'low', photo: 'StSc', partial: true, thickM: 750, shapeAmount: 1.0 },
  ac60: { genus: 'ac', cover: 0.6, baseKm: 4.5, band: 'mid', photo: 'AcCc', partial: true, thickM: 400, shapeAmount: 0.6 },
  ci60: { genus: 'ci', cover: 0.6, baseKm: 9, band: 'high', photo: 'Ci', partial: true, thickM: 800, shapeAmount: 0.15 },
  st90: { genus: 'st', cover: 0.9, baseKm: 0.5, band: 'low', photo: 'St', partial: false, thickM: 400, shapeAmount: 0.1 },
  ns100: { genus: 'ns', cover: 1.0, baseKm: 1.0, band: 'low', photo: 'Ns', partial: false, thickM: 3200, shapeAmount: 0.8 },
  as90: { genus: 'as', cover: 0.9, baseKm: 4.0, band: 'mid', photo: 'As', partial: false, thickM: 1500, shapeAmount: 0.3 },
};
const SEEDS = { heldout: { seed: 5757, off: [11, 6] }, confirm: { seed: 5858, off: [-9, 4] }, dev: { seed: 4242, off: [7, -5] } };
// ───── 묶음(§4.1) ─────
const BUNDLES = [
  ['L', ['cu35', 'sc25', 'sc85', 'ac60', 'ci60'], ['e3', 'e5', 'e8'], true],
  ['T', ['ac60', 'ci60'], ['tw'], true],
  ['T4', ['ac60', 'ci60', 'sc25'], ['tw4'], true],
  ['O5', ['st90', 'ns100', 'as90'], ['e5'], true],
  ['H', ['cu35', 'sc25', 'sc85', 'ac60', 'ci60'], ['e20', 'e45'], false],
  ['O45', ['st90', 'ns100', 'as90'], ['e45'], false],
  ['TERM', ['sc25'], ['tw'], false],          // 1.5 km 밑면에서 해가 지는 고도(−1.8°) 근처 — 기록만(P·V 밖)
];
// ───── 틀(§2.1) ─────
const DEV_VFOV = +(2 * Math.atan((584 / DEV_H) * Math.tan(Math.PI / 6)) * 180 / Math.PI).toFixed(3);   // 16.397°
const FRAMES = {
  std: { canvas: [390, 584], fov: 60, el: 20, res: 0.5 },
  dev: { canvas: [390, 584], fov: DEV_VFOV, el: 9, res: DEV_RES },
  hdev: { canvas: [1080, DEV_H], fov: 60, el: 20, res: DEV_RES },
  ddev: { canvas: [1080, DEV_H], fov: 60, el: 9, res: DEV_RES },     // P4 창 등가(기기 전체 틀, 가운데 390×584 를 F-dev 와 견줌)
};
// H-dev 의 측정 고도대 0.8~17° 를 덮는 행(가운데 열 기준, 여유 ±1°): 화소 고도 = 시선 + atan(v), v = tan(vfov/2)·(1 − 2y/H).
const cropFor = (fr, lo, hi) => {
  const t = Math.tan(fr.fov * Math.PI / 360), v = e => Math.tan((e - fr.el) * Math.PI / 180) / t;
  return [+Math.max(0, (1 - v(hi)) / 2).toFixed(4), +Math.min(1, (1 - v(lo)) / 2).toFixed(4)];
};
const CROP = { hdev: cropFor(FRAMES.hdev, -0.2, 18), ddev: [0.375, 0.625] };

// ───── 해석 보폭 표(§7.1, 절차 M2 — 빈 날씨 걸음 mix(step, maxStep, mip) 포함, 비평 gapstep 규칙) ─────
const R = 6371e3;
const near = (base, el) => { const mu = Math.sin(el * Math.PI / 180); return -R * mu + Math.sqrt((R * mu) ** 2 + (R + base) ** 2 - R * R); };
function deltaAt(base, el, dIn, pss, minStep = 50, maxStep = 1000) {
  let step = minStep + (pss - 1) * near(base, el), d = 0, inc = 0;
  while (d < dIn) { const mip = Math.log2(Math.max(1, 1 + d * 1e-5)); step *= pss; inc = step * (1 - Math.min(1, mip)) + maxStep * Math.min(1, mip); d += inc; }
  return inc;
}
/** 첫 적중 직전 증분의 대표값: 부분 덮임 층 = 층 안 거리 2·5·10 km 의 중앙값, 덮인 층(st·ns·as) = 첫 표본 거리(stepSize0·jitter·2, jitter 중앙 0.5). */
function deltaTyp(layer, el, pss, minStep = 50, maxStep = 1000) {
  const L = LAYERS[layer], base = L.baseKm * 1000;
  if (!L.partial) return minStep + (pss - 1) * near(base, el);
  const v = [2000, 5000, 10000].map(d => deltaAt(base, el, d, pss, minStep, maxStep)).sort((a, b) => a - b);
  return v[1];
}
const STEP_TABLE = {};
for (const layer of Object.keys(LAYERS)) {
  STEP_TABLE[layer] = {};
  for (const el of [3, 5, 9, 20, 45]) STEP_TABLE[layer][el] = {
    C0: Math.round(deltaTyp(layer, el, 1.01)), 'E1a.3': Math.round(deltaTyp(layer, el, 1.003)), 'E1a.0': Math.round(deltaTyp(layer, el, 1.0)),
    E1b: Math.round(Math.max(50, deltaTyp(layer, el, 1.01) / 8)), ref: Math.round(deltaTyp(layer, el, 1.0, 10, 10)),
  };
}

// ───── 후보(§1 닫힌 목록) — 라운드 기준 위에 얹는 델타 ─────
const ARMS = {
  C0: { round: 0, delta: {} },
  'E1a.3': { round: 1, delta: { material: { perspectiveStepScale: 1.003 } } },
  'E1a.0': { round: 1, delta: { material: { perspectiveStepScale: 1.0, maxIterationCount: 600 } } },
  E1b: { round: 1, delta: { options: { refineOnHit: 1 } }, knob: true },
  'E2a.8': { round: 2, delta: { options: { sunMarch: [8, 120, 1.6] } } },
  'E2a.6': { round: 2, delta: { options: { sunMarch: [6, 90, 1.6] } } },
  E2b: { round: 2, delta: { options: { sunLowpass: 1 } }, knob: true },
  E2c: { round: 2, delta: { options: { sunMarch: [8, 120, 1.6], sunLowpass: 1 } }, knob: true, conditional: 'E2a.8 이 G8 만 실패' },
  E3: { round: 3, delta: { options: { erodeCentered: 1 } }, knob: true, densityChange: true },
  E3b: { round: 3, delta: { options: { erodeCentered: 2, erodePixelAngleDeg: 0.0566 } }, knob: true, densityChange: true, judgedVsC0Ref: true },
  E3c: { round: 3, delta: { options: { debugDensityMul: 0.2 } }, knob: true, densityChange: true, diagnostic: true },
  E4: { round: 4, delta: { options: { jitterMode: 1 } }, knob: true, jitter: true },
  'E5-': { round: 5, delta: { material: { shapeRepeat: { scale: 0.6 } } }, densityChange: true },
  'E5+': { round: 5, delta: { material: { shapeRepeat: { scale: 1.5 } } }, densityChange: true },
};
const ROUND_ARMS = { 1: ['E1a.3', 'E1a.0', 'E1b'], 2: ['E2a.8', 'E2a.6', 'E2b', 'E2c'], 3: ['E3', 'E3b', 'E3c'], 4: ['E4'], 5: ['E5-', 'E5+'] };
const merge = (a, b) => ({ options: { ...(a.options ?? {}), ...(b.options ?? {}) }, material: { ...(a.material ?? {}), ...(b.material ?? {}) } });
const adopt = ADOPT ? JSON.parse(fs.readFileSync(ADOPT, 'utf8')) : null;
// B_k: 채택 파일의 adopted(라운드 순) 델타를 C0 위에 차례로.
const baseFor = round => {
  let b = { options: {}, material: {} }, names = [];
  for (const a of adopt?.adopted ?? []) if (a.round < round) { b = merge(b, ARMS[a.arm].delta); names.push(a.arm); }
  return { cfg: b, label: names.length ? 'B' + (round - 1) + '[' + names.join('+') + ']' : 'C0' };
};

// ───── 잡 만들기 ─────
const REF_MAT = { minStepSize: 10, maxStepSize: 10, perspectiveStepScale: 1.0, maxIterationCount: 8000 };
const REF_OPT = { sunMarch: [26, 260, 1.1], temporalUpscale: false };
const layerInput = (layer, seedSet) => { const L = LAYERS[layer]; return [{ genus: L.genus, cover: L.cover, baseKm: L.baseKm, band: L.band, opts: { seed: SEEDS[seedSet].seed } }]; };
function inputFor(layer, time, azk, frame, seedSet) {
  const fr = FRAMES[frame];
  return { ...SITE, date: TIMES[time].iso, az: azOf(time, azk), el: fr.el, fov: fr.fov, weatherOffsetKm: SEEDS[seedSet].off, layers: layerInput(layer, seedSet) };
}
const name = (arm, layer, time, azk, frame, tag) => [arm, layer + '_' + time, azk, frame].concat(tag ? [tag] : []).join('__');
function captureGrain(frame, time, extra = {}) {
  const high = TIMES[time].el >= 12;
  const g = { mode: 'capture', frame0: 0, warm: high ? WARM_HIGH : 16, window: 64, stills: [7, 23, 39, 55], store: frame === 'std' ? 'lite' : 'full', pngStills: frame === 'std' ? [0] : [] };
  if (CROP[frame]) g.crop = CROP[frame];
  return { ...g, ...extra };
}
function job({ set, round, arm, armCfg, layer, time, azk, frame, seedSet = 'heldout', grain, tag, extraOpt = {}, extraMat = {}, resolve }) {
  const fr = FRAMES[frame];
  const options = { ...(armCfg.options ?? {}), ...extraOpt }, material = { ...(armCfg.material ?? {}), ...extraMat };
  const j = { name: name(arm, layer, time, azk, frame, tag), set, round, arm, layer, time, az: azk, frame, canvas: fr.canvas, quality: 'low', res: fr.res,
    input: inputFor(layer, time, azk, frame, seedSet), grain };
  if (Object.keys(options).length) j.options = options;
  if (Object.keys(material).length) j.material = material;
  if (resolve) j.resolve = resolve;
  return j;
}
const unitsOf = (bundles, frames) => {
  const u = [];
  for (const [b, layers, times] of BUNDLES) if (bundles.includes(b)) for (const layer of layers) for (const time of times) for (const azk of ['t', 's', 'a']) for (const frame of frames) u.push({ bundle: b, layer, time, azk, frame });
  return u;
};
const HELD_DEV = unitsOf(['L', 'T', 'T4', 'O5', 'TERM'], ['dev']);
const HELD_STD = unitsOf(['L', 'T', 'T4', 'O5', 'H', 'O45', 'TERM'], ['std']);
const HELD_HDEV = [['cu35', 'e20'], ['cu35', 'e45'], ['ac60', 'e20'], ['ac60', 'e45']].map(([layer, time]) => ({ bundle: 'H', layer, time, azk: 's', frame: 'hdev' }));
const TW_GUARD = [['tw1734', '2026-10-05T08:34:00.000Z', 260, 24], ['tw1746', '2026-10-05T08:46:00.000Z', 276, 21]];
const twGuardJob = (arm, armCfg, round, [nm, date, az, el]) => ({
  name: [arm, nm, 'g', 'std'].join('__'), set: 'guard', round, arm, layer: nm, time: nm, az: 'g', frame: 'std', canvas: [390, 584], quality: 'low', res: 0.5,
  input: { lat: 37.81, lon: 138.28, heightM: 5, date, az, el, fov: 60, layers: [{ genus: 'sc', cover: 0.23, baseKm: 1, band: 'low' }, { genus: 'ac', cover: 0.43, baseKm: 3.5, band: 'mid' }] },
  grain: { mode: 'capture', frame0: 0, warm: 16, window: 64, stills: [7, 23, 39, 55], store: 'lite', pngStills: [0] },
  ...(Object.keys(armCfg.options ?? {}).length ? { options: armCfg.options } : {}), ...(Object.keys(armCfg.material ?? {}).length ? { material: armCfg.material } : {}),
});

const jobs = [];
const armList = ['C0', ...Object.values(ROUND_ARMS).flat()];
for (const arm of armList) {
  const A = ARMS[arm], base = baseFor(A.round || 1);
  const cfg = arm === 'C0' ? { options: {}, material: {} } : merge(base.cfg, A.delta);
  const round = A.round, hClaim = ['E1a.3', 'E1a.0', 'E1b', 'E2a.8', 'E2a.6', 'E2b', 'E2c'].includes(arm) || arm === 'C0';
  for (const u of HELD_DEV) jobs.push(job({ set: 'heldout', round, arm, armCfg: cfg, ...u, grain: captureGrain('dev', u.time) }));
  for (const u of HELD_STD) jobs.push(job({ set: 'heldout', round, arm, armCfg: cfg, ...u, grain: captureGrain('std', u.time) }));
  if (hClaim) for (const u of HELD_HDEV) jobs.push(job({ set: 'hdev', round, arm, armCfg: cfg, ...u, grain: captureGrain('hdev', u.time) }));
  for (const g of TW_GUARD) jobs.push(twGuardJob(arm, cfg, round, g));
  // 비용(§2.4): F-dev(L·T·T4·O5, 방위 s) + F-std(H·O45, 방위 s) — 16 프레임.
  for (const u of unitsOf(['L', 'T', 'T4', 'O5'], ['dev']).filter(x => x.azk === 's'))
    jobs.push(job({ set: 'cost', round, arm, armCfg: cfg, ...u, tag: 'cost', grain: { mode: 'cost', frame0: 0, frames: 16 } }));
  for (const u of unitsOf(['H', 'O45'], ['std']).filter(x => x.azk === 's'))
    jobs.push(job({ set: 'cost', round, arm, armCfg: cfg, ...u, tag: 'cost', grain: { mode: 'cost', frame0: 0, frames: 16 } }));
  // 확인 집합 Q(§5.5): 새 시드·오프셋, 방위 s, F-dev, 제품 장면 — R6 에서 C0 와 B_final 만(여기서는 C0 정의; B_final 은 --adopt 로).
  if (arm === 'C0') for (const u of unitsOf(['L', 'T', 'T4', 'O5'], ['dev']).filter(x => x.azk === 's'))
    jobs.push(job({ set: 'confirm', round: 6, arm, armCfg: cfg, ...u, seedSet: 'confirm', tag: 'Q', grain: captureGrain('dev', u.time) }));
}
// R6 결합 B_final(채택 파일이 있을 때만): held-out 전체 + Q
if (adopt?.final) {
  let b = { options: {}, material: {} }; for (const a of adopt.adopted ?? []) b = merge(b, ARMS[a.arm].delta);
  for (const u of HELD_DEV) jobs.push(job({ set: 'heldout', round: 6, arm: 'Bfinal', armCfg: b, ...u, grain: captureGrain('dev', u.time) }));
  for (const u of HELD_STD) jobs.push(job({ set: 'heldout', round: 6, arm: 'Bfinal', armCfg: b, ...u, grain: captureGrain('std', u.time) }));
  for (const u of HELD_HDEV) jobs.push(job({ set: 'hdev', round: 6, arm: 'Bfinal', armCfg: b, ...u, grain: captureGrain('hdev', u.time) }));
  for (const g of TW_GUARD) jobs.push(twGuardJob('Bfinal', b, 6, g));
  for (const u of unitsOf(['L', 'T', 'T4', 'O5'], ['dev']).filter(x => x.azk === 's'))
    jobs.push(job({ set: 'confirm', round: 6, arm: 'Bfinal', armCfg: b, ...u, seedSet: 'confirm', tag: 'Q', grain: captureGrain('dev', u.time) }));
}
// 기준 렌더(§3.1): C0 밀도장 한 벌(F-dev 의 L·T·T4·O5 전부) + 밀도장을 바꾸는 팔(E3·E5±)의 보고용 9 칸.
const refGrain = { mode: 'reference', frame0: 0, n: 2 * REF_SS * REF_SS, ss: REF_SS, capFrames: 2 };   // 층화 두 바퀴(앞·뒤 반쪽이 각각 모든 칸)
const refJob = (arm, cfg, u, tag = 'ref', mat = REF_MAT, opt = REF_OPT, g = refGrain) => job({ set: 'ref', round: ARMS[arm]?.round ?? 0, arm, armCfg: cfg, ...u, tag, extraOpt: opt, extraMat: mat, resolve: { temporalAlpha: 1 }, grain: { ...g } });
for (const u of unitsOf(['L', 'T', 'T4', 'O5'], ['dev'])) jobs.push(refJob('C0', { options: {}, material: {} }, u));
const REPORT9 = unitsOf(['L'], ['dev']).filter(u => ['cu35', 'sc85', 'ac60'].includes(u.layer) && u.azk === 's');
for (const arm of ['E3', 'E5-', 'E5+']) for (const u of REPORT9) jobs.push({ ...refJob(arm, merge(baseFor(ARMS[arm].round).cfg, ARMS[arm].delta), u), set: 'refReport' });

// ───── 탐침(§8.3) — 개발 집합(시드 4242·오프셋 [7, −5]), C0 와 기준만 지표; 후보는 컴파일 점검만 ─────
const DEV_UNITS_FDEV = ['cu35', 'sc85', 'ac60'].flatMap(layer => ['t', 's', 'a'].map(azk => ({ layer, time: 'e5', azk, frame: 'dev' })));
const DEV_UNITS_FSTD = ['cu35', 'sc85', 'ac60'].flatMap(layer => ['e5', 'e20'].flatMap(time => ['t', 's', 'a'].map(azk => ({ layer, time, azk, frame: 'std' }))));
const C0 = { options: {}, material: {} };
for (const [tag, seed] of [['A', 12345], ['B', 12345], ['n777', 777], ['n4242', 4242]]) {
  for (const u of DEV_UNITS_FDEV) jobs.push(job({ set: 'probe', round: -1, arm: 'C0', armCfg: C0, ...u, seedSet: 'dev', tag: 'P8' + tag, grain: captureGrain('dev', u.time, { noiseSeed: seed }) }));
  for (const u of DEV_UNITS_FSTD) jobs.push(job({ set: 'probe', round: -1, arm: 'C0', armCfg: C0, ...u, seedSet: 'dev', tag: 'P8' + tag, grain: captureGrain('std', u.time, { noiseSeed: seed }) }));
}
for (const [tag, seed] of [['A', 12345], ['n777', 777]]) jobs.push(job({ set: 'probe', round: -1, arm: 'C0', armCfg: C0, layer: 'cu35', time: 'e20', azk: 's', frame: 'hdev', seedSet: 'dev', tag: 'P8' + tag, grain: captureGrain('hdev', 'e20', { noiseSeed: seed }) }));
// P1 시간(최악: sc25 e3 F-dev — 성기고 긴 맑은 광선), 기준 4 프레임(n = 2·ss² 아래로는 반쪽 비교 불가라 시간만)
jobs.push(job({ set: 'probe', round: -1, arm: 'C0', armCfg: C0, layer: 'sc25', time: 'e3', azk: 's', frame: 'dev', seedSet: 'dev', tag: 'P1', grain: captureGrain('dev', 'e3') }));
jobs.push({ ...refJob('C0', C0, { layer: 'sc25', time: 'e3', azk: 's', frame: 'dev' }, 'P1ref', REF_MAT, REF_OPT, { mode: 'reference', frame0: 0, n: 2, ss: 1, capFrames: 0 }), set: 'probe', input: inputFor('sc25', 'e3', 's', 'dev', 'dev') });
// P2 기준 수렴: (10, 10, 8000) vs (5, 5, 16000), 그리고 화소 점 표본 기준(ss 1) — 앨리어싱 몫 A
for (const [tag, mat, g] of [['P2ref10', REF_MAT, refGrain], ['P2ref5', { minStepSize: 5, maxStepSize: 5, perspectiveStepScale: 1.0, maxIterationCount: 16000 }, refGrain], ['P2refpt', REF_MAT, { ...refGrain, ss: 1 }]])
  jobs.push({ ...refJob('C0', C0, { layer: 'cu35', time: 'e5', azk: 's', frame: 'dev' }, tag, mat, REF_OPT, g), set: 'probe', input: inputFor('cu35', 'e5', 's', 'dev', 'dev') });
// P3 순서 불변(G9): 같은 F-std 잡을 페이지 맨 앞(P8A 의 첫 F-std 잡)과, 해 ≥ 12° 잡 네 개 뒤에 다시
for (const time of ['e20', 'e45']) for (const azk of ['t', 's']) jobs.push(job({ set: 'probe3', round: -1, arm: 'C0', armCfg: C0, layer: 'ac60', time, azk, frame: 'std', seedSet: 'dev', tag: 'P3pre', grain: captureGrain('std', time) }));
jobs.push(job({ set: 'probe3', round: -1, arm: 'C0', armCfg: C0, layer: 'cu35', time: 'e20', azk: 't', frame: 'std', seedSet: 'dev', tag: 'P3', grain: captureGrain('std', 'e20') }));
// P4 창 등가: 기기 전체 틀(1080×H·×res, 시선 9°) 가운데 390×584 ↔ F-dev(P8A) — 개발 F-dev 세 단위
for (const layer of ['cu35', 'sc85', 'ac60']) jobs.push(job({ set: 'probeDev', round: -1, arm: 'C0', armCfg: C0, layer, time: 'e5', azk: 's', frame: 'ddev', seedSet: 'dev', tag: 'P4', grain: captureGrain('ddev', 'e5') }));
// P6 손잡이·덮어쓰기 팔 컴파일 점검(상태 해시만, 지표 없음) · P7 비용 변형 C0 상식 점검
for (const arm of armList.filter(a => a !== 'C0')) jobs.push(job({ set: 'probe6', round: -1, arm, armCfg: ARMS[arm].delta, layer: 'cu35', time: 'e5', azk: 's', frame: 'dev', seedSet: 'dev', tag: 'P6', grain: { mode: 'state' } }));
jobs.push(job({ set: 'probe6', round: -1, arm: 'C0', armCfg: C0, layer: 'cu35', time: 'e5', azk: 's', frame: 'dev', seedSet: 'dev', tag: 'P6', grain: { mode: 'state' } }));
jobs.push(job({ set: 'probe', round: -1, arm: 'C0', armCfg: C0, layer: 'cu35', time: 'e5', azk: 's', frame: 'dev', seedSet: 'dev', tag: 'P7', grain: { mode: 'cost', frame0: 0, frames: 16 } }));

// ───── 장면 표(grain.py 가 읽음): 단위·묶음·P·K ─────
const scenes = {};
for (const [b, layers, times, product] of BUNDLES) for (const layer of layers) for (const time of times) {
  const key = layer + '_' + time;
  scenes[key] = { layer, time, bundle: b, product: product && b !== 'TERM', photoGenus: LAYERS[layer].photo, sunEl: TIMES[time].el, sunAz: TIMES[time].az,
    az: { t: azOf(time, 't'), s: azOf(time, 's'), a: azOf(time, 'a') }, partial: LAYERS[layer].partial, shapeAmount: LAYERS[layer].shapeAmount, record: b === 'TERM' };
}
// 주장 칸 K(§5.2, 렌더 전 물리에서): 단위 = (장면, 방위, 틀, 영역) 에서 영역 무관.
const viewEl = f => FRAMES[f].el;
const K = {
  E1: (s, f) => !s.record && deltaTyp(s.layer, viewEl(f), 1.01) >= 100,
  E2: (s) => !s.record && s.sunEl >= 3 && ['cu35', 'sc25', 'sc85', 'ac60', 'ci60'].includes(s.layer),
  E3: (s) => !s.record && ['cu35', 'sc25', 'sc85', 'ac60'].includes(s.layer),
  E4: (s, f) => !s.record && f === 'dev',
  E5: (s) => !s.record && ['cu35', 'sc25', 'sc85', 'ac60'].includes(s.layer),
};
const claims = {};
for (const [k, fn] of Object.entries(K)) { claims[k] = {}; for (const [key, s] of Object.entries(scenes)) claims[k][key] = Object.fromEntries(['dev', 'std', 'hdev'].map(f => [f, !!fn(s, f)])); }
// 예산(§4.5 추정 — 탐침 P1 이 고침): 초/프레임, 캔버스·해 고도·모드별 근사.
const secPerFrame = j => {
  const big = j.canvas[0] * j.canvas[1] > 1e6, high = TIMES[j.time]?.el >= 12;
  if (j.grain.mode === 'reference') return (big ? 10 : 1) * 30;   // 10 m 걸음 · 업스케일 끔(1/16 아님) · 8000 반복 — 추정 15~45 s
  if (j.grain.mode === 'state') return 0;
  return (big ? 11 : 1) * (high ? 0.75 : 0.5) + (big ? 1.0 : 0.08);   // 렌더 + 읽기·누적
};
const framesOf = j => j.grain.mode === 'reference' ? j.grain.n + (j.grain.capFrames ?? 0) : j.grain.mode === 'cost' ? j.grain.frames : j.grain.mode === 'state' ? 0 : (j.grain.warm + j.grain.window);
const budget = {};
for (const j of jobs) { const key = j.set + ':' + j.arm; budget[key] = (budget[key] ?? 0) + secPerFrame(j) * framesOf(j) + 4; }
const hours = Object.fromEntries(Object.entries(budget).map(([k, v]) => [k, +(v / 3600).toFixed(2)]));
const total = Object.values(budget).reduce((a, b) => a + b, 0) / 3600;

const doc = {
  ruler: 'RULER-grain', generator: 'make-jobs-grain.mjs', args: { adopt: ADOPT ? path.basename(ADOPT) : null, refSs: REF_SS, warmHigh: WARM_HIGH, deviceH: DEV_H, deviceRes: DEV_RES },
  site: SITE, times: TIMES, azOffsets: AZ_OFF, layers: LAYERS, seeds: SEEDS, frames: FRAMES, crops: CROP, bundles: BUNDLES.map(([b, layers, times, product]) => ({ bundle: b, layers, times, product })),
  arms: ARMS, roundArms: ROUND_ARMS, refMaterial: REF_MAT, refOptions: REF_OPT, refGrain, stepTable: STEP_TABLE, scenes, claims,
  budgetHours: hours, budgetTotalHours: +total.toFixed(1), nJobs: jobs.length,
};
fs.writeFileSync(OUT, JSON.stringify(jobs));
fs.writeFileSync(SCENES_OUT, JSON.stringify(doc, null, 1));
const bySet = {}; for (const j of jobs) bySet[j.set] = (bySet[j.set] ?? 0) + 1;
console.log('jobs', jobs.length, JSON.stringify(bySet), 'F-dev vfov', DEV_VFOV, 'hdev crop', CROP.hdev);
console.log('budget total h', total.toFixed(1));
for (const [k, v] of Object.entries(hours).sort()) console.log('  ', k, v);
