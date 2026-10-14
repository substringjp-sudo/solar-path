#!/usr/bin/env node
/**
 * make-jobs-phys3.mjs — RULER-physics3(§138) volsky 잡. 손으로 고치지 말고 이 스크립트를 고칩니다.
 *   node tools/genus-ruler/flow/make-jobs-phys3.mjs [--out jobs-phys3.json]
 * held-out: 새 시드 4343 + 오프셋 [−6, 9] km + 방위 35·190·320(RULER-physics3 §3) + 박명 가드 2 장면(§136 G2). 후보 L0(= P0 다시 그림)·L1·L2·L3.
 * 순서 = 우선순위(일부만 그려져도 규칙이 완결되게): 낮 8 장면 × 3 방위를 후보 순으로 → 박명 2 장면.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.indexOf('--out');
const OUT = outArg >= 0 ? process.argv[outArg + 1] : path.join(HERE, 'jobs-phys3.json');

// §138 held-out — §137 의 시드 4242·오프셋 [7, −5]·방위 5·160·290 은 이번 자의 지표·후보·예측을 만들 때 본 렌더라 **개발 집합**으로 내려가고,
// 새 시드·오프셋·방위(해 반대쪽·옆·옆 구성은 같게: 해 186.7° → 35 = 반대쪽 −152°, 190 = 해 옆 3°, 320 = 해 옆 133°)로 다시 둡니다.
const SEED = 4343, OFFSET = [-6, 9], AZ = [35, 190, 320];
const base = { lat: 36.5679, lon: 136.6774, heightM: 103, date: '2026-10-03T03:00:00.000Z', el: 20, fov: 60, weatherOffsetKm: OFFSET };
const L = (genus, cover, baseKm, band, extra = {}) => ({ genus, cover, baseKm, band, opts: { seed: SEED, ...extra } });
const scenes = {
  cu: [L('cu', 0.35, 1.5, 'low')], ac: [L('ac', 0.6, 4.5, 'mid')], ci: [L('ci', 0.6, 9, 'high')],
  sc25: [L('sc', 0.25, 1.5, 'low')], sc85: [L('sc', 0.85, 1.5, 'low')], st: [L('st', 0.9, 0.5, 'low')],
  as: [L('as', 0.9, 4.0, 'mid')], ns: [L('ns', 1.0, 1.0, 'low')],
};
const common = { frames: 32, quality: 'high', res: 0.5, out: 'both' };
const OPT = { L0: { diffuse: 0 }, L1: { diffuse: 1 }, L2: { diffuse: 2 }, L3: { diffuse: 3 } };
const CANDS = Object.keys(OPT);
const job = (cand, scene, az, layers, options, extra = {}) => ({ name: `${cand}_${scene}_${az}`, input: { ...base, az, layers }, ...common, options, ...extra });
const jobs = [];
for (const c of CANDS) for (const [s, layers] of Object.entries(scenes)) for (const az of AZ) jobs.push(job(c, s, az, layers, OPT[c]));
// 박명 가드(§136 G2 와 같은 장면·시각·시선)
const TW = { lat: 37.81, lon: 138.28, heightM: 5, fov: 60, layers: [{ genus: 'sc', cover: 0.23, baseKm: 1, band: 'low' }, { genus: 'ac', cover: 0.43, baseKm: 3.5, band: 'mid' }] };
const TWS = [['tw1734', '2026-10-05T08:34:00.000Z', 260, 24], ['tw1746', '2026-10-05T08:46:00.000Z', 276, 21]];
for (const c of CANDS) for (const [name, date, az, el] of TWS) jobs.push({ name: `${c}_${name}_0`, input: { ...TW, date, az, el }, ...common, options: OPT[c] });
fs.writeFileSync(OUT, JSON.stringify(jobs));
const byCand = {}; for (const j of jobs) byCand[j.name.split('_')[0]] = (byCand[j.name.split('_')[0]] ?? 0) + 1;
console.log(`jobs ${jobs.length}`, JSON.stringify(byCand));
