#!/usr/bin/env node
/**
 * make-jobs-phys2.mjs — RULER-physics2(§137) volsky 잡. 손으로 고치지 말고 이 스크립트를 고칩니다.
 *   node tools/genus-ruler/flow/make-jobs-phys2.mjs [--out jobs-phys2.json]
 * held-out: 새 날씨 타일 시드(layers[].opts.seed 4242) + 날씨 오프셋 [7, −5] km + 방위 5(해 반대쪽)·160(해 옆 27°)·290(해 옆 103°).
 * 무리 장면의 해 방위·고도는 suncalc 가 아니라 엔진 함수(tools/genus-ruler/volsky/sun-azel.mjs)로 받습니다.
 * 순서 = 우선순위(일부만 그려져도 규칙이 완결되게): P0·P1 낮 장면 → P2 권운 → 무리 장면 → H1·H2 권운 → D1 진단.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.indexOf('--out');
const OUT = outArg >= 0 ? process.argv[outArg + 1] : path.join(HERE, 'jobs-phys2.json');

const SEED = 4242, OFFSET = [7, -5], AZ = [5, 160, 290];
const base = { lat: 36.5679, lon: 136.6774, heightM: 103, date: '2026-10-03T03:00:00.000Z', el: 20, fov: 60, weatherOffsetKm: OFFSET };
const L = (genus, cover, baseKm, band, extra = {}) => ({ genus, cover, baseKm, band, opts: { seed: SEED, ...extra } });
const scenes = (extra = {}) => ({
  cu: [L('cu', 0.35, 1.5, 'low', extra)], ac: [L('ac', 0.6, 4.5, 'mid', extra)], ci: [L('ci', 0.6, 9, 'high', extra)],
  sc25: [L('sc', 0.25, 1.5, 'low', extra)], sc85: [L('sc', 0.85, 1.5, 'low', extra)], st: [L('st', 0.9, 0.5, 'low', extra)],
  as: [L('as', 0.9, 4.0, 'mid', extra)], ns: [L('ns', 1.0, 1.0, 'low', extra)],
});
const common = { frames: 32, quality: 'high', res: 0.5, out: 'both' };
const OPT = {
  P0: { physics: false, physicsIce: false }, P1: { physics: true, physicsIce: false }, P2: { physics: true, physicsIce: true },
  H1: { iceHalo: true }, H2: { icePowderOff: true },
};
const job = (cand, scene, az, layers, options, extra = {}) => ({ name: `${cand}_${scene}_${az}`, input: { ...base, az, layers }, ...common, options, ...extra });
const jobs = [];
// 1 낮 장면 P0·P1
for (const c of ['P0', 'P1']) for (const [s, layers] of Object.entries(scenes())) for (const az of AZ) jobs.push(job(c, s, az, layers, OPT[c]));
// 2 P2 권운(물 구름 장면은 P1 과 입력이 같아 상태 해시로 대신)
for (const az of AZ) jobs.push(job('P2', 'ci', az, scenes().ci, OPT.P2));
// 3 무리 장면 — 시선 = 해(엔진 값)
const sun = (iso) => JSON.parse(execFileSync('node', [path.join(HERE, '../volsky/sun-azel.mjs'), String(base.lat), String(base.lon), String(base.heightM), iso], { encoding: 'utf8' }).trim().split('\n').pop());
const sunH = sun('2026-10-03T03:00:00Z'), sunL = sun('2026-10-03T06:00:00Z');
const HALO = [['hcsH', sunH, '2026-10-03T03:00:00.000Z', [L('cs', 0.9, 8.5, 'high')]], ['hcsL', sunL, '2026-10-03T06:00:00.000Z', [L('cs', 0.9, 8.5, 'high')]],
  ['hciH', sunH, '2026-10-03T03:00:00.000Z', [L('ci', 0.9, 9, 'high')]], ['hciL', sunL, '2026-10-03T06:00:00.000Z', [L('ci', 0.9, 9, 'high')]]];
for (const [name, s, iso, layers] of HALO) for (const c of ['P0', 'P1', 'P2', 'H1', 'H2']) {
  jobs.push({ name: `${c}_${name}_0`, input: { ...base, date: iso, az: s.az, el: s.el, layers }, ...common, options: OPT[c] });
}
// 4 H1·H2 권운 가드(낮 장면 ci)
for (const c of ['H1', 'H2']) for (const az of AZ) jobs.push(job(c, 'ci', az, scenes().ci, OPT[c]));
// 5 D1 진단 — 방위 290, 부분 덮임 네 장면. 이름 첫 글자 = 팔(F 바닥값 0 · K 하늘빛 0 · G 지면 반사 0 · T 통과 0), 둘째 글자 = 기준(0 = P0, 1 = P1)
const D1 = (arm, b) => ({ options: { ...OPT['P' + b], ...(arm === 'F' ? { debugLightFloors: [0, 0] } : {}) }, fill: arm === 'K' ? { skyLightScale: 0 } : arm === 'G' ? { groundBounceScale: 0 } : undefined, thru: arm === 'T' });
for (const b of [0, 1]) for (const arm of ['F', 'K', 'G', 'T']) for (const sc of ['cu', 'sc25', 'sc85', 'ac']) {
  const d = D1(arm, b);
  const layers = scenes(d.thru ? { thru: 0 } : {})[sc];
  jobs.push(job(arm + b, sc, 290, layers, d.options, d.fill ? { fill: d.fill } : {}));
}
fs.writeFileSync(OUT, JSON.stringify(jobs));
const byCand = {}; for (const j of jobs) byCand[j.name.split('_')[0]] = (byCand[j.name.split('_')[0]] ?? 0) + 1;
console.log(`jobs ${jobs.length}`, JSON.stringify(byCand), 'sunH', JSON.stringify(sunH), 'sunL', JSON.stringify(sunL));
