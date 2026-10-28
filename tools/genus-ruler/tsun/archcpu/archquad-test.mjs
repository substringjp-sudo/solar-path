#!/usr/bin/env node
/**
 * archquad-test.mjs — §179 WP5 단위 시험(design v2 §8 U5a + 거울 대조). CPU 만, 렌더·브라우저 없음.
 *
 *   nice -n 19 node tools/genus-ruler/tsun/archcpu/archquad-test.mjs [--tmp=<dir>]
 *
 * src/components/VolumetricProbe/archQuad.ts 를 esbuild 로 묶어(출력은 os.tmpdir() 아래 새 폴더 또는 --tmp) 부릅니다.
 *  U5a (관문): 여섯 노드 가중치 합 = sin(dip)·60°(라디안 π/3 — sr) 상대 ≤ 1e−14, archBandSolidAngle 과 같음, 심프슨으로 적분한 띠 입체각과
 *       ≤ 1e−12, 노드가 Ω = [−dip, 0] × ±30° 안 · 고도 = −f·dip(f = GL2) · 방향이 단위 벡터이고 고도·방위가 노드 값.
 *  옥타브 (관문): 노드 하나만 빛이 있을 때 archAttenuatedSum = takramMultipleScattering(τ_mid + τ_own) · L dΩ · e^(−τ_rest) (≤ 1e−13) ·
 *       archNoT 이면 τ_rest ≡ 0 · τ = 0 의 S = archContractSums.octave · i = 0 옥타브 합 = phase.
 *  위상 정규화 (관문): ∫ archPhase(cos; cⁱ) dω = 1(i = 0..7, 수치 적분 ≤ 1e−6) — 자 §1 'Φ 는 ∫Φ dω = 1'.
 *  거울 (관문): 같은 입력(결정적 의사 난수 사례 16 개)에서 archquad.py(CPU 적분기가 쓰는 파이썬 거울)와 모든 수가 상대 ≤ 1e−12.
 *  상수 (보고 → 있으면 관문): cloudTsun.ts(WP4 셰이더 주입)가 ARCH_GL2·ARCH_AZ_DEG·ARCH_AZ_WIDTH_DEG 를 내보내면 이 파일 상수와 같아야 함.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const argOf = (k, d) => { const a = process.argv.find(s => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const TMP = argOf('tmp') ? path.resolve(argOf('tmp')) : fs.mkdtempSync(path.join(os.tmpdir(), 'archquad-'));
fs.mkdirSync(TMP, { recursive: true });
const require = createRequire(import.meta.url);
let fails = 0;
const check = (name, ok, detail) => { if (ok === false) fails++; console.log(`${ok === null ? 'REPORT' : ok ? 'PASS' : 'FAIL'}  ${name}  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); };
const bundle = (src, out) => execFileSync('npx', ['esbuild', path.join(ROOT, src), '--bundle', '--format=cjs', '--platform=node', `--outfile=${out}`, '--log-level=warning'],
  { cwd: ROOT, stdio: 'inherit' });

bundle('src/components/VolumetricProbe/archQuad.ts', path.join(TMP, 'archQuad.cjs'));
const Q = require(path.join(TMP, 'archQuad.cjs'));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

// ───── U5a ─────
{
  let worst = 0, worstSimp = 0, okAll = true; const rows = [];
  for (const h of [0.25, 0.5, 1.0, 1.5, 2.8, 4.5, 7.4, 9.0, 13.0]) {
    const dip = Q.archDipRad(h);
    const nodes = Q.archNodes(dip);
    const sum = nodes.reduce((s, n) => s + n.dOmega, 0);
    const target = Math.sin(dip) * (60 * Math.PI / 180);
    const m = 2000, hs = dip / m;
    let simp = 0;
    for (let i = 0; i <= m; i++) simp += (i === 0 || i === m ? 1 : i % 2 ? 4 : 2) * Math.cos(-dip + i * hs);
    simp *= (hs / 3) * (Math.PI / 3);
    worst = Math.max(worst, rel(sum, target)); worstSimp = Math.max(worstSimp, rel(sum, simp));
    const band = Q.archBandSolidAngle(dip);
    // 노드 자리 · 방향
    const up = unit([0.3, -0.2, 1.0]), row = unit([1.0, 0.4, 0.1]);
    const fr = Q.archTangentFrame(up, row);
    let okNode = nodes.length === 6 && rel(band, target) <= 1e-15;
    nodes.forEach((n, k) => {
      const f = Q.ARCH_GL2_FRACTIONS[n.group];
      okNode &&= n.elevationRad === -f * dip && n.elevationRad > -dip && n.elevationRad < 0 && Math.abs(n.azimuthRad) < Q.ARCH_AZ_HALF_WIDTH_DEG * Math.PI / 180;
      okNode &&= n.group === Math.floor(k / 3) && n.azimuthRad === Q.ARCH_AZ_NODES_DEG[k % 3] * Math.PI / 180;
      const w = Q.archNodeDirection(n, up, row);
      const e = Math.asin(dot(w, fr.up)), az = Math.atan2(dot(w, fr.b), dot(w, fr.a));
      okNode &&= Math.abs(Math.hypot(...w) - 1) < 1e-14 && Math.abs(e - n.elevationRad) < 1e-12 && Math.abs(az - n.azimuthRad) < 1e-12;
    });
    okAll &&= okNode;
    rows.push({ h, dipDeg: +(dip * 180 / Math.PI).toFixed(4), sum, target });
  }
  check('U5a Σ dΩ = sin(dip)·60° (sr), 9 heights 0.25–13 km', worst <= 1e-14 && worstSimp <= 1e-12 && okAll,
    `max rel vs sin(dip)·π/3 ${worst.toExponential(2)} · vs Simpson band ${worstSimp.toExponential(2)} · nodes inside Ω/directions ${okAll}`);
  check('U5a GL2 fractions are the 2-point Gauss–Legendre nodes on [0,1]',
    // 두 식((3 ∓ √3)/6 와 1/2 ∓ 1/(2√3))은 반올림 순서만 달라 1 ulp(≈ 1.1e−16) 까지 다를 수 있음
    Math.abs(Q.ARCH_GL2_FRACTIONS[0] - (0.5 - 0.5 / Math.sqrt(3))) <= 4e-16 && Math.abs(Q.ARCH_GL2_FRACTIONS[1] - (0.5 + 0.5 / Math.sqrt(3))) <= 4e-16 &&
    Math.abs(Q.ARCH_GL2_FRACTIONS[0] + Q.ARCH_GL2_FRACTIONS[1] - 1) <= 2e-16,
    Q.ARCH_GL2_FRACTIONS.map(x => x.toPrecision(17)).join(' / '));
}

// ───── 옥타브 식 ─────
{
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let worst = 0, noTok = true, sumOk = true;
  for (let t = 0; t < 40; t++) {
    const dip = Q.archDipRad(0.5 + 12 * rnd());
    const nodes = Q.archNodes(dip);
    const k = Math.floor(rnd() * 6);
    const L = nodes.map((_, j) => (j === k ? [rnd(), rnd(), rnd()] : [0, 0, 0]));
    const cosv = nodes.map(() => 2 * rnd() - 1);
    const C = Q.archOctaveCache(nodes, L, cosv);
    const tau = { tauMid: 3 * rnd(), own: [2 * rnd(), 2 * rnd()], rest: [4 * rnd(), 4 * rnd()] };
    const S = Q.archAttenuatedSum(C, tau);
    const g = nodes[k].group;
    const ms = Q.takramMultipleScattering(tau.tauMid + tau.own[g], cosv[k]) * nodes[k].dOmega * Math.exp(-tau.rest[g]);
    for (let c = 0; c < 3; c++) worst = Math.max(worst, rel(S[c], ms * L[k][c]));
    const Sn = Q.archAttenuatedSum(C, { ...tau, noT: true }), S0 = Q.archAttenuatedSum(C, { ...tau, rest: [0, 0] });
    noTok &&= Sn.every((v, c) => v === S0[c]);
    // τ = 0 이면 S = octave 합, i = 0 합 = phase
    const L6 = nodes.map(() => [rnd(), rnd(), rnd()]);
    const C6 = Q.archOctaveCache(nodes, L6, cosv);
    const s6 = Q.archContractSums(nodes, L6, cosv), z = Q.archAttenuatedSum(C6, { tauMid: 0, own: [0, 0], rest: [0, 0] });
    const ph = [0, 1, 2].map(c => nodes.reduce((s, n, j) => s + L6[j][c] * Q.archPhase(cosv[j], 1) * n.dOmega, 0));
    const raw = [0, 1, 2].map(c => nodes.reduce((s, n, j) => s + L6[j][c] * n.dOmega, 0));
    for (let c = 0; c < 3; c++) sumOk &&= rel(z[c], s6.octave[c]) < 1e-13 && rel(s6.phase[c], ph[c]) < 1e-13 && rel(s6.raw[c], raw[c]) < 1e-13;
  }
  check('octave cache path = takram approximateMultipleScattering × L dΩ × e^(−τ_rest)', worst <= 1e-13, `max rel ${worst.toExponential(2)} (40 random cases)`);
  check('archNoT ⇒ τ_rest ≡ 0 (bit-equal)', noTok, '');
  check('τ = 0 ⇒ S = octave sum; i = 0 ⇒ phase sum; raw = Σ L dΩ', sumOk, '');
}

// ───── 위상 정규화 ─────
{
  let worst = 0;
  for (let i = 0; i < 8; i++) {
    const att = Math.pow(0.5, i);
    const n = 200000; let s = 0;
    for (let j = 0; j < n; j++) { const mu = -1 + (j + 0.5) * (2 / n); s += Q.archPhase(mu, att); }
    s *= 2 * Math.PI * (2 / n);
    worst = Math.max(worst, Math.abs(s - 1));
  }
  check('∫ archPhase(cos; cⁱ) dω = 1 for i = 0..7', worst <= 1e-6, `max |∫ − 1| ${worst.toExponential(2)}`);
}

// ───── TS ↔ 파이썬 거울 ─────
{
  let seed = 987654321;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const rv = () => unit([2 * rnd() - 1, 2 * rnd() - 1, 2 * rnd() - 1]);
  const cases = [];
  for (let t = 0; t < 16; t++) {
    cases.push({ heightKm: 0.2 + 13 * rnd(), up: rv(), rowAxis: rv(), rayDir: rv(),
      radiance: Array.from({ length: 6 }, (_, j) => [rnd() * 0.05, rnd() * 0.02, (t % 5 === 0 && j === 4 ? -1 : 1) * rnd() * 0.01]),
      tauMid: 2 * rnd(), own: [rnd(), 3 * rnd()], rest: [5 * rnd(), rnd()], noT: t % 4 === 3,
      msProbe: [[0, 2 * rnd() - 1], [10 * rnd(), 2 * rnd() - 1]] });
  }
  const inp = path.join(TMP, 'archquad-in.json');
  fs.writeFileSync(inp, JSON.stringify({ cases }));
  const py = JSON.parse(execFileSync('python3', ['-I', path.join(HERE, 'archquad.py'), '--selftest-json', inp], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  let worst = 0, n = 0, keyOk = true;
  const cmp = (a, b) => { n++; const d = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-30); worst = Math.max(worst, a === b ? 0 : d); };
  const cmpV = (a, b) => { if (a.length !== b.length) keyOk = false; a.forEach((x, i) => (Array.isArray(x) ? cmpV(x, b[i]) : cmp(x, b[i]))); };
  cases.forEach((cs, t) => {
    const p = py.cases[t];
    const dip = Q.archDipRad(cs.heightKm), nodes = Q.archNodes(dip);
    const dirs = nodes.map(nd => Q.archNodeDirection(nd, cs.up, cs.rowAxis));
    const cosv = dirs.map(w => dot(w, cs.rayDir));
    const C = Q.archOctaveCache(nodes, cs.radiance, cosv);
    const S = Q.archAttenuatedSum(C, { tauMid: cs.tauMid, own: cs.own, rest: cs.rest, noT: cs.noT });
    const sums = Q.archContractSums(nodes, cs.radiance, cosv);
    cmp(dip, p.dip); cmp(Q.archBandSolidAngle(dip), p.band);
    nodes.forEach((nd, k) => { for (const key of ['group', 'az', 'elevationRad', 'azimuthRad', 'dOmega']) cmp(nd[key], p.nodes[k][key]); });
    cmpV(dirs, p.dirs); cmpV(cosv, p.cosView); cmpV(C, p.C); cmpV(S, p.S);
    cmpV(sums.raw, p.sums.raw); cmpV(sums.phase, p.sums.phase); cmpV(sums.octave, p.sums.octave);
    cmpV(Q.archMidDirection(cs.up, cs.rowAxis, dip), p.mid);
    cmpV(cs.msProbe.map(([tau, c]) => Q.takramMultipleScattering(tau, c)), p.ms);
  });
  const c = py.consts;
  const constOk = c.gl2[0] === Q.ARCH_GL2_FRACTIONS[0] && c.gl2[1] === Q.ARCH_GL2_FRACTIONS[1] && c.az.every((v, i) => v === Q.ARCH_AZ_NODES_DEG[i]) &&
    c.azWidth === Q.ARCH_AZ_NODE_WIDTH_DEG && c.azHalf === Q.ARCH_AZ_HALF_WIDTH_DEG && c.octaves === Q.ARCH_OCTAVES && c.att === Q.ARCH_OCTAVE_ATTENUATION &&
    c.phase.g1 === Q.ARCH_PHASE.g1 && c.phase.g2 === Q.ARCH_PHASE.g2 && c.phase.mix === Q.ARCH_PHASE.mix && c.bottom === Q.ARCH_BOTTOM_RADIUS_KM;
  check('TS archQuad.ts ↔ python archquad.py (16 cases, every number)', worst <= 1e-12 && keyOk && constOk, `${n} numbers, max rel ${worst.toExponential(2)} · constants equal ${constOk}`);
}

// ───── cloudTsun.ts 상수(WP4) ─────
{
  let T = null;
  try { bundle('src/components/VolumetricProbe/cloudTsun.ts', path.join(TMP, 'cloudTsun.cjs')); T = require(path.join(TMP, 'cloudTsun.cjs')); } catch (e) { T = null; }
  if (!T || !T.ARCH_GL2) check('cloudTsun.ts arch constants', null, 'cloudTsun.ts 가 없거나 ARCH_GL2 를 내보내지 않음 — 대조 생략');
  else {
    const ok = T.ARCH_GL2.length === 2 && T.ARCH_GL2.every((v, i) => v === Q.ARCH_GL2_FRACTIONS[i]) && T.ARCH_AZ_DEG.every((v, i) => v === Q.ARCH_AZ_NODES_DEG[i]) &&
      T.ARCH_AZ_WIDTH_DEG === Q.ARCH_AZ_NODE_WIDTH_DEG;
    check('cloudTsun.ts ARCH_GL2/ARCH_AZ_DEG/ARCH_AZ_WIDTH_DEG = archQuad.ts', ok, `${JSON.stringify(T.ARCH_GL2)} ${JSON.stringify(T.ARCH_AZ_DEG)} ${T.ARCH_AZ_WIDTH_DEG}`);
  }
}

console.log(fails ? `FAILED ${fails}` : 'ALL PASS', `(tmp ${TMP})`);
process.exit(fails ? 1 : 0);
