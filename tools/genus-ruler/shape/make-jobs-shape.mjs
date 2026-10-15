#!/usr/bin/env node
/**
 * make-jobs-shape.mjs — RULER-shape §3 held-out 잡 목록(jobs-shape.json). 렌더 전에 고정·커밋합니다.
 *   node tools/genus-ruler/shape/make-jobs-shape.mjs
 * 가나자와 2026-10-03 12:00 JST, 시선 고도 20°, 세로 시야 60°, 32 프레임, high, 배율 0.5, 노출 자동 × 0.5, 오프셋 [−4, 11], 방위 35·300.
 * 장면: cu25·cu50(시드 5151·6161, 열역학 B) · cg40(5151, B) · sc40·sc85(5151·6161, A). 후보 K0(skeleton 0)·K0h(1)·K1(2)·K2(3), 영가설 K0h 시드 7171·8181.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TH = JSON.parse(fs.readFileSync(path.join(HERE, 'thermo-heldout.json'), 'utf8')).profiles;
const BASE = { lat: 36.5679, lon: 136.6774, heightM: 103, date: '2026-10-03T03:00:00.000Z', el: 20, fov: 60, weatherOffsetKm: [-4, 11] };
const AZ = [35, 300];
const SCENES = [
  { id: 'cu25', genus: 'cu', cover: 0.25, th: 'B', seeds: [5151, 6161] },
  { id: 'cu50', genus: 'cu', cover: 0.5, th: 'B', seeds: [5151, 6161] },
  { id: 'cg40', genus: 'cg', cover: 0.4, th: 'B', seeds: [5151], thicknessM: 2500 },
  { id: 'sc40', genus: 'sc', cover: 0.4, th: 'A', seeds: [5151, 6161] },
  { id: 'sc85', genus: 'sc', cover: 0.85, th: 'A', seeds: [5151, 6161] },
];
const CANDS = [['K0', 0], ['K0h', 1], ['K1', 2], ['K2', 3]];
const NULL_SEEDS = [7171, 8181];
const jobs = [];
const job = (cand, sc, seed, az, sk) => ({
  name: `${cand}_${sc.id}s${seed}_${az}`,
  input: {
    ...BASE, az,
    layers: [{ genus: sc.genus, cover: sc.cover, baseKm: 1.5, band: 'low', ...(sc.thicknessM ? { thicknessM: sc.thicknessM } : {}), opts: { seed } }],
    thermo: TH[sc.th].thermo,
  },
  frames: 32, quality: 'high', res: 0.5, out: 'both', exposureScale: 0.5,
  options: { skeleton: sk },
});
for (const [cand, sk] of CANDS) for (const sc of SCENES) for (const seed of sc.seeds) for (const az of AZ) jobs.push(job(cand, sc, seed, az, sk));
// 영가설: K0h 를 다른 시드로(같은 장면·방위) — cg 는 제외(보고 전용)
for (const seed of NULL_SEEDS) for (const sc of SCENES.filter(s => s.genus !== 'cg')) for (const az of AZ) jobs.push(job('K0hn' + seed, sc, seed, az, 1));
fs.writeFileSync(path.join(HERE, 'jobs-shape.json'), JSON.stringify(jobs, null, 1));
console.log('jobs', jobs.length, 'held-out thermo A', TH.A.date, 'B', TH.B.date);
