#!/usr/bin/env node
/**
 * make-jobs.mjs — RULER-flow 의 volsky 잡 목록을 씁니다(§130). 손으로 고치지 말고 이 스크립트를 고칩니다.
 *   node tools/genus-ruler/flow/make-jobs.mjs            → jobs-flow.json(판정 장면 C0–C3 × 5 장면 × 3 방위) · jobs-flow-guards.json(박명 가드)
 *   node tools/genus-ruler/flow/make-jobs.mjs --cands C1,C2  → 후보를 골라 씀(배치 나누기)
 * 돌리기: node tools/genus-ruler/volsky/run.js tools/genus-ruler/flow/jobs-flow.json out/ 390 584 gen
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--cands');
const only = i >= 0 ? process.argv[i + 1].split(',') : null;
const out = process.argv.indexOf('--out');
const suffix = out >= 0 ? process.argv[out + 1] : '';

export const CANDS = {
  C0: undefined,
  C1: { flow: true, flowDensity: false },
  C2: { flow: true, flowDensity: true },
  C3: { flow: true, flowDensity: true, flowUv: true },
};
const base = { lat: 36.5679, lon: 136.6774, heightM: 103, date: '2026-10-03T03:00:00.000Z', el: 20, fov: 60 };
export const SCENES = {
  cu: [{ genus: 'cu', cover: 0.35, baseKm: 1.5, band: 'low' }],
  ac: [{ genus: 'ac', cover: 0.6, baseKm: 4.5, band: 'mid' }],
  ci: [{ genus: 'ci', cover: 0.6, baseKm: 9, band: 'high' }],
  sc25: [{ genus: 'sc', cover: 0.25, baseKm: 1.5, band: 'low' }],
  sc85: [{ genus: 'sc', cover: 0.85, baseKm: 1.5, band: 'low' }],
};
const common = { frames: 32, quality: 'high', res: 0.5, out: 'both' };
const jobs = [];
for (const [c, options] of Object.entries(CANDS)) {
  if (only && !only.includes(c)) continue;
  for (const [s, layers] of Object.entries(SCENES)) for (const az of [200, 110, 20]) {
    jobs.push({ name: `${c}_${s}_${az}`, input: { ...base, az, layers }, ...common, ...(options ? { options } : {}) });
  }
}
// 박명 가드(RULER-twilight-hue 장면): 사도 부근, 10/05 17:34·17:46 JST, sc 23 % @1.0 + ac 43 % @3.5.
const tw = { lat: 37.81, lon: 138.28, heightM: 5, fov: 60, layers: [{ genus: 'sc', cover: 0.23, baseKm: 1.0, band: 'low' }, { genus: 'ac', cover: 0.43, baseKm: 3.5, band: 'mid' }] };
const guards = [];
for (const [c, options] of Object.entries(CANDS)) {
  if (only && !only.includes(c)) continue;
  for (const [t, az, el] of [['1734', 260, 24], ['1746', 276, 21]]) {
    guards.push({ name: `${c}_tw${t}`, input: { ...tw, date: `2026-10-05T08:${t.slice(2)}:00.000Z`, az, el }, ...common, ...(options ? { options } : {}) });
  }
}
fs.writeFileSync(path.join(HERE, `jobs-flow${suffix}.json`), JSON.stringify(jobs, null, 0));
fs.writeFileSync(path.join(HERE, `jobs-flow-guards${suffix}.json`), JSON.stringify(guards, null, 0));
console.log(`jobs ${jobs.length}, guards ${guards.length}`);
