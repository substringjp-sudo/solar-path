#!/usr/bin/env node
/**
 * make-jobs-phys.mjs — RULER-physics(§136) volsky 잡. 손으로 고치지 말고 이 스크립트를 고칩니다.
 *   node tools/genus-ruler/flow/make-jobs-phys.mjs [--cands P0,P1,P2] [--out <suffix>]
 *     → jobs-phys<suffix>.json(낮 8 장면 × 3 방위 + halo) · jobs-phys-guards<suffix>.json(박명 2 + 서울 1)
 * 돌리기: node tools/genus-ruler/volsky/run.js tools/genus-ruler/flow/jobs-phys.json out/ 390 584 gen
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--cands');
const only = i >= 0 ? process.argv[i + 1].split(',') : null;
const o = process.argv.indexOf('--out');
const suffix = o >= 0 ? process.argv[o + 1] : '';

export const CANDS = {
  P0: { physics: false, physicsIce: false },
  P1: { physics: true, physicsIce: false },
  P2: { physics: true, physicsIce: true },
};
const base = { lat: 36.5679, lon: 136.6774, heightM: 103, date: '2026-10-03T03:00:00.000Z', el: 20, fov: 60 };
export const SCENES = {
  cu: [{ genus: 'cu', cover: 0.35, baseKm: 1.5, band: 'low' }],
  ac: [{ genus: 'ac', cover: 0.6, baseKm: 4.5, band: 'mid' }],
  ci: [{ genus: 'ci', cover: 0.6, baseKm: 9, band: 'high' }],
  sc25: [{ genus: 'sc', cover: 0.25, baseKm: 1.5, band: 'low' }],
  sc85: [{ genus: 'sc', cover: 0.85, baseKm: 1.5, band: 'low' }],
  st: [{ genus: 'st', cover: 0.9, baseKm: 0.5, band: 'low' }],
  as: [{ genus: 'as', cover: 0.9, baseKm: 4.0, band: 'mid' }],
  ns: [{ genus: 'ns', cover: 1.0, baseKm: 1.0, band: 'low' }],
};
const common = { frames: 32, quality: 'high', res: 0.5, out: 'both' };
// 서울 10/12 단면(phys-test.mjs 의 SEOUL 과 같음)
export const SEOUL_THERMO = { groundM: 40, t2mC: 20, td2mC: 11, levels: [[110, 19, 1000], [1500, 9, 850], [3100, 0, 700], [5800, -14, 500], [9500, -40, 300], [10800, -50, 250]].map(([zM, tC, pHPa]) => ({ zM, tC, pHPa })) };
const jobs = [], guards = [];
for (const [c, options] of Object.entries(CANDS)) {
  if (only && !only.includes(c)) continue;
  for (const [s, layers] of Object.entries(SCENES)) for (const az of [200, 110, 20]) {
    jobs.push({ name: `${c}_${s}_${az}`, input: { ...base, az, layers }, ...common, options });
  }
  // 무리: 시선 = 해(2026-10-03 03:00Z 가나자와, suncalc 방위 186.58° 고도 49.48°). 방위 자리는 0(phys.py 이름 규칙).
  jobs.push({ name: `${c}_halo_0`, input: { ...base, az: 186.58, el: 49.48, layers: [{ genus: 'cs', cover: 0.9, baseKm: 8.5, band: 'high' }] }, ...common, options });
  const tw = { lat: 37.81, lon: 138.28, heightM: 5, fov: 60, layers: [{ genus: 'sc', cover: 0.23, baseKm: 1.0, band: 'low' }, { genus: 'ac', cover: 0.43, baseKm: 3.5, band: 'mid' }] };
  for (const [t, az, el] of [['1734', 260, 24], ['1746', 276, 21]]) {
    guards.push({ name: `${c}_tw${t}`, input: { ...tw, date: `2026-10-05T08:${t.slice(2)}:00.000Z`, az, el }, ...common, options });
  }
  const seoulOpts = (lo) => ({ windU: 18, windV: 4, shearU: 22, shearV: 6, flowSeed: 4242, ...lo });
  guards.push({
    name: `${c}_seoul`, frames: 32, quality: 'low', res: 0.5, out: 'both', options,
    input: {
      lat: 37.57, lon: 126.98, heightM: 40, date: '2026-10-12T03:09:00.000Z', az: 129, el: 35, fov: 75, thermo: SEOUL_THERMO,
      layers: [
        { genus: 'sc', cover: 0.25, baseKm: 1.2, band: 'low', opts: seoulOpts({ macroGradX: 0.3, macroGradY: 0 }) },
        { genus: 'ac', cover: 0.3, baseKm: 4, band: 'mid', opts: seoulOpts({ windU: 40, windV: 10, shearU: 40, shearV: 5, macroGradX: 0, macroGradY: 0.4 }) },
        { genus: 'ci', cover: 0.4, baseKm: 9, band: 'high', opts: seoulOpts({ windU: 80, windV: 15, shearU: 0, shearV: 0, macroGradX: 0.6, macroGradY: 0 }) },
      ],
    },
  });
}
fs.writeFileSync(path.join(HERE, `jobs-phys${suffix}.json`), JSON.stringify(jobs, null, 0));
fs.writeFileSync(path.join(HERE, `jobs-phys-guards${suffix}.json`), JSON.stringify(guards, null, 0));
console.log(`jobs ${jobs.length}, guards ${guards.length}`);
