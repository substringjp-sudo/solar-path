#!/usr/bin/env node
/**
 * make-jobs-r2.mjs — RULER-flow2 타일 잡(§131). 후보 이름 → 옵션, 장면은 1회차 jobs-tile 의 흐름 장면 + dev 바람 세기(vrms 1·3).
 *   node make-jobs-r2.mjs <cand>[,<cand>…] > jobs.json     후보: R0 R1 R2 R2b(20/2 위 게이트) Q1_H0.3 … Q2_H1.0 (바탕은 --base R0|R1|R2|R2b)
 */
const args = process.argv.slice(2);
const bi = args.indexOf('--base'); const baseName = bi >= 0 ? args[bi + 1] : 'R0';
const cands = (args.find(a => !a.startsWith('--') && a !== baseName) ?? 'R0').split(',');
const BASES = {
  R0: { flow: true },
  R1: { flow: true, flowSteps: 10, flowPsiEvery: 1 },
  R2: { flow: true, flowSteps: 10, flowPsiEvery: 1, flowS90: 10 },
  R2b: { flow: true, flowSteps: 20, flowPsiEvery: 2, flowS90: 10 },
};
const optOf = (c) => {
  if (BASES[c]) return BASES[c];
  const m = /^Q([12])_H([\d.]+)$/.exec(c);
  if (!m) throw new Error('unknown candidate ' + c);
  return { ...BASES[baseName], flowQMode: +m[1], flowQN: 128, flowQH: +m[2] };
};
const SC = {
  dev: [{ genus: 'sc', cover: 0.23, baseKm: 1.0 }, { genus: 'ac', cover: 0.43, baseKm: 3.5 }],
  sc25: [{ genus: 'sc', cover: 0.25, baseKm: 1.5 }],
  sc85: [{ genus: 'sc', cover: 0.85, baseKm: 1.5 }],
  ac60: [{ genus: 'ac', cover: 0.6, baseKm: 4.5 }],
  cu35: [{ genus: 'cu', cover: 0.35, baseKm: 1.5 }],
  ci60: [{ genus: 'ci', cover: 0.6, baseKm: 9 }],
  st50: [{ genus: 'st', cover: 0.5, baseKm: 0.5 }],
};
const jobs = [];
for (const c of cands) {
  const o = optOf(c);
  for (const [s, layers] of Object.entries(SC)) jobs.push({ name: `${c}_${s}`, layers, options: o });
  for (const v of [1, 3]) jobs.push({ name: `${c}_devv${v}`, layers: SC.dev, options: { ...o, flowVrms: v } });
}
console.log(JSON.stringify(jobs, null, 0));
