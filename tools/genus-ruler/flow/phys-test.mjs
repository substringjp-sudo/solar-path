#!/usr/bin/env node
/**
 * phys-test.mjs — §136 구름 미세물리(`src/components/VolumetricProbe/cloudPhysics.ts`) 단위 테스트. three.js 없이 묶어 돌립니다.
 *   node tools/genus-ruler/flow/phys-test.mjs
 * 검사: 포화수증기압·습윤단열 감률·응결률·응결고도·단열 LWC·유효 반지름·소광의 교과서 값, h^(2/3) 단면 맞춤, 얼음 비율,
 * 열역학 보간·물러남, 종류별 광학두께가 문헌 범위(TAU_RANGE) 안(표준대기 + 서울 10월 단면), 종류 순서(권운 < 고적운 < 층적운 < 적운).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUT = process.argv.find(a => a.startsWith('--out='))?.slice(6) ?? path.join(ROOT, '.harness/phys-test');
fs.mkdirSync(OUT, { recursive: true });
const BUNDLE = path.join(OUT, 'cloudPhysics.cjs');
execFileSync('npx', ['esbuild', path.join(ROOT, 'src/components/VolumetricProbe/cloudPhysics.ts'), '--bundle', '--format=cjs', '--platform=node', `--outfile=${BUNDLE}`, '--log-level=error'], { cwd: ROOT, stdio: 'inherit' });
if (/require\(["']three["']\)/.test(fs.readFileSync(BUNDLE, 'utf8'))) throw new Error('cloudPhysics.ts must stay pure (no three.js)');
const require = createRequire(import.meta.url);
const P = require(BUNDLE);
// 렌더 봉투(종류 손잡이) — 앱의 GENUS 표를 그대로 가져옵니다(three.js 포함 묶음, 표만 씀).
const GB = path.join(OUT, 'cloudGenus.cjs');
execFileSync('npx', ['esbuild', path.join(ROOT, 'src/components/VolumetricProbe/cloudGenus.ts'), '--bundle', '--format=cjs', '--platform=node', `--outfile=${GB}`, '--log-level=error'], { cwd: ROOT, stdio: 'inherit' });
const CG = require(GB);
const envOf = g => CG.genusEnvelope({ genus: g, cover: 0.5 });

const results = [];
const check = (name, ok, detail) => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`); };
const within = (v, lo, hi) => v >= lo && v <= hi;
const f3 = v => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(3));

// 1 교과서 값
check('esat(0 °C) = 6.112 hPa', Math.abs(P.esatWater(0) - 6.112) < 1e-3, f3(P.esatWater(0)));
check('esat(20 °C) ≈ 23.4 hPa', within(P.esatWater(20), 23.2, 23.6), f3(P.esatWater(20)));
const gm = (t, p) => P.moistLapse(t, p) * 1000;
check('Γm(10 °C, 1000 hPa) 5.0–5.6 K/km', within(gm(10, 1000), 5.0, 5.6), f3(gm(10, 1000)));
check('Γm(20 °C, 1000 hPa) 4.0–4.6 K/km', within(gm(20, 1000), 4.0, 4.6), f3(gm(20, 1000)));
check('Γm(−20 °C, 500 hPa) 7.2–8.4 K/km', within(gm(-20, 500), 7.2, 8.4), f3(gm(-20, 500)));
const gl = (t, p) => P.condensationRate(t, p) * 1e6;   // g/m³/km
check('Γl(10 °C, 900 hPa) 1.7–2.3 g/m³/km', within(gl(10, 900), 1.7, 2.3), f3(gl(10, 900)));
check('Γl 는 추울수록 작다(−10 °C 600 hPa < 10 °C 900 hPa)', gl(-10, 600) < gl(10, 900), `${f3(gl(-10, 600))} < ${f3(gl(10, 900))}`);
check('LCL(20, 15) = 625 m', Math.abs(P.lclHeightM(20, 15) - 625) < 1e-9);
const ad = P.adiabaticLWC(10, 900, 1000);
check('단열 LWC(10 °C, 900 hPa, 1 km) 1.6–2.2 g/m³', within(ad.lwc * 1e3, 1.6, 2.2), `${f3(ad.lwc * 1e3)} g/m³, 꼭대기 ${f3(ad.tC)} °C`);
const re = P.effRadiusLiquid(0.5e-3, 100e6) * 1e6;
check('r_eff(0.5 g/m³, 100 /cm³) 10–13 μm', within(re, 10, 13), f3(re));
check('β(0.3 g/m³, 10 μm) = 0.045 /m', Math.abs(P.betaLiquid(0.3e-3, 10e-6) - 0.045) < 1e-9);
check('IWC(−40 °C) = 0.01 g/m³', Math.abs(P.iceWaterContent(-40) * 1e3 - 0.01) < 1e-9);
check('r_ice(−40 °C) = 40 μm', Math.abs(P.effRadiusIce(-40) * 1e6 - 40) < 1e-9);

// 2 단면 맞춤
{
  const { A, k, b } = P.ADIABATIC_PROFILE;
  let mx = 0, s = 0; const n = 1000;
  for (let i = 0; i <= n; i++) { const x = i / n, y = A * (1 - Math.exp(-k * x)) + b * x; if (x >= 0.1) mx = Math.max(mx, Math.abs(y - Math.pow(x, 2 / 3))); s += y / (n + 1); }
  check('h^(2/3) 맞춤 최대 어긋남(hf ≥ 0.1) < 0.03', mx < 0.03, f3(mx));
  check('단면 평균 ≈ 3/5', within(s, 0.58, 0.62), f3(s));
  check('단면 hf = 1 에서 1', Math.abs(A * (1 - Math.exp(-k)) + b - 1) < 2e-3);
}

// 3 얼음 비율·β ∝ h^(2/3)
check('얼음 비율 0 °C → 0, −23 °C → 1, −10 °C 사이', P.iceFraction(0) === 0 && P.iceFraction(-23) === 1 && within(P.iceFraction(-10), 0.5, 0.8), f3(P.iceFraction(-10)));
{
  const a = P.layerPhysics('sc', 1500, 400), c = P.layerPhysics('sc', 1500, 800);
  const r = c.betaTop / a.betaTop;
  check('β_top(2H)/β_top(H) ≈ 2^(2/3) (±10 %)', within(r, 1.587 * 0.9, 1.587 * 1.1), f3(r));
}

// 4 열역학 보간·물러남
{
  const levels = [{ zM: 100, tC: 20, pHPa: 1000 }, { zM: 1500, tC: 12, pHPa: 850 }, { zM: 3000, tC: 2, pHPa: 700 }];
  const t = P.thermoAt(750, { levels });
  check('단면 보간(750 m → 16.29 °C, 기압 로그 보간 927 hPa)', t.source === 'profile' && Math.abs(t.tC - (20 - 8 * 650 / 1400)) < 1e-9 && Math.abs(t.pHPa - 1000 * Math.pow(0.85, 650 / 1400)) < 1e-6, `${f3(t.tC)} °C ${f3(t.pHPa)} hPa`);
  const s = P.thermoAt(1000, { t2mC: 25, groundM: 0 });
  check('지상 기온 물러남(1 km → 18.5 °C)', s.source === 'surface' && Math.abs(s.tC - 18.5) < 1e-9, f3(s.tC));
  const z = P.thermoAt(1000, null);
  check('표준대기 물러남(1 km → 8.5 °C, 899 hPa)', z.source === 'standard' && Math.abs(z.tC - 8.5) < 1e-9 && within(z.pHPa, 898, 900), `${f3(z.tC)} °C ${f3(z.pHPa)} hPa`);
  check('LCL 밑면(지면 40 m, 24/16 °C → 1.04 km)', Math.abs(P.lclBaseKm({ groundM: 40, t2mC: 24, td2mC: 16 }) - 1.04) < 1e-9);
  check('LCL 밑면 — 이슬점 없으면 null', P.lclBaseKm({ t2mC: 24 }) === null);
}

// 4b 검토에서 나온 결함(§136.2) — NaN 지면, 높은 관측점의 응결고도, 단면 끝 연속, 높이별 상, 모루 상한
{
  const t = P.thermoAt(1000, { t2mC: 20, groundM: NaN });
  check('지면 높이 NaN 이어도 지상 기온 물러남이 유한', Number.isFinite(t.tC) && Number.isFinite(t.pHPa), `${f3(t.tC)} °C`);
  const L = P.layerPhysics('sc', 1500, 750, { t2mC: 20, groundM: NaN }, envOf('sc'));
  check('지면 NaN → 층 β 유한·양수', Number.isFinite(L.betaTop) && L.betaTop > 0, f3(L.betaTop));
  check('LCL 밑면: 지면 NaN → 유한', Number.isFinite(P.lclBaseKm({ groundM: NaN, t2mC: 20, td2mC: 15 })));
  check('LCL 밑면: 4000 m 관측점은 지면 위(≥ 4.3 km)', P.lclBaseKm({ groundM: 4000, t2mC: 5, td2mC: 3 }) >= 4.3 - 1e-9, f3(P.lclBaseKm({ groundM: 4000, t2mC: 5, td2mC: 3 })));
  check('LCL 밑면: 1600 m 관측점 T−Td 20 → 4.1 km(지면 위 상한 3.5 km)', Math.abs(P.lclBaseKm({ groundM: 1600, t2mC: 25, td2mC: 5 }) - 4.1) < 1e-9);
  const low = { t2mC: 5, groundM: 0, levels: [[100, 4, 1000], [1500, -3, 850], [3100, -10, 700]].map(([zM, tC, pHPa]) => ({ zM, tC, pHPa })) };
  const a = P.thermoAt(3600, low), b = P.thermoAt(3610, low), c = P.thermoAt(99, low), d = P.thermoAt(101, low);
  check('단면 끝 밖으로 연속(위 3600→3610 m, 아래 99→101 m |ΔT| < 0.1 K)', Math.abs(a.tC - b.tC) < 0.1 && Math.abs(c.tC - d.tC) < 0.1 && Math.abs(a.pHPa - b.pHPa) < 2, `${f3(a.tC)}→${f3(b.tC)} °C`);
  const cb = P.layerPhysics('cb', 1000, 8000, { t2mC: 28, groundM: 0 }, envOf('cb'));
  check('적란운(밑면 +21 °C): 높이별 상 — 얼음 비율 0.05~0.95', cb.iceOptical > 0.05 && cb.iceOptical < 0.95, `얼음 ${f3(cb.iceOptical)} τ ${f3(cb.tauCore)}`);
  let capOk = true;
  for (const t2 of [15, 25, 33, 35]) { const an = P.layerPhysics('cbanvil', 8800, 1500, { t2mC: t2, groundM: 0 }, envOf('cbanvil')); capOk = capOk && an.iwcTop * 1e3 <= 0.4 + 1e-9 && an.tauCore <= P.TAU_RANGE.cbanvil[1]; }
  check('모루 IWC ≤ 0.4 g/m³, 여름(지상 33·35 °C)에도 τ ≤ 50', capOk);
}

// 5 종류별 광학두께(문헌 범위)
const SCENES = { cu: [1500, 1600], sc: [1500, 750], st: [500, 400], ac: [4500, 400], as: [4000, 1500], ns: [1000, 3200], ci: [9000, 800], cs: [8500, 1000], cbanvil: [9000, 1500] };
// 서울 10/12 12시 근처 단면(Open-Meteo 형식: 높이·기온·기압) — 지상 20 °C, 850 hPa 9 °C, 700 hPa 0 °C, 500 hPa −14 °C, 300 hPa −40 °C, 250 hPa −50 °C.
const prof = (g, t2, td, lv) => ({ groundM: g, t2mC: t2, td2mC: td, levels: lv.map(([zM, tC, pHPa]) => ({ zM, tC, pHPa })) });
const SEOUL = prof(40, 20, 11, [[110, 19, 1000], [1500, 9, 850], [3100, 0, 700], [5800, -14, 500], [9500, -40, 300], [10800, -50, 250]]);
// 서울 8월·1월 근처(검토 §136.2 의 여름 사례 포함)
const SEOUL8 = prof(40, 30, 23, [[110, 29, 1000], [1500, 20, 850], [3150, 9, 700], [5880, -6, 500], [9650, -32, 300], [10950, -42, 250]]);
const SEOUL1 = prof(40, -2, -10, [[110, -3, 1000], [1450, -10, 850], [2950, -20, 700], [5450, -35, 500], [8900, -55, 300], [10200, -58, 250]]);
const rows = {};
// 1월은 기록만(INFO): 1단계의 혼합상(ECMWF 얼음 비율 + 큰 얼음 반지름)은 겨울 난층운을 τ 22 로 냅니다(범위 40 아래) — 2단계 몫(§136.2).
const PROFS = [['표준', null, true], ['서울10월', SEOUL, true], ['서울8월', SEOUL8, true], ['서울1월', SEOUL1, false]];
for (const [name, th, gate] of PROFS) {
  for (const [g, [baseM, H]] of Object.entries(SCENES)) {
    const L = P.layerPhysics(g, baseM, H, th, envOf(g)), r = P.TAU_RANGE[g];
    rows[`${name}:${g}`] = L;
    (gate ? check : (n, ok, d) => console.log(`INFO  ${n}  ${ok ? '범위 안' : '범위 밖'}  ${d}`))(`τ ${g} (${name}) ∈ [${r[0]}, ${r[1]}]`, within(L.tauCore, r[0], r[1]),
      `τ ${f3(L.tauCore)} (렌더 ${f3(L.tauRendered)})  β_top ${f3(L.betaTop)} /m  밑 ${f3(L.tBaseC)} °C 꼭대기 ${f3(L.tTopC)} °C  LWC ${f3(L.lwcTop * 1e3)} IWC ${f3(L.iwcTop * 1e3)} g/m³  r ${f3(L.reffLiqUm)}/${f3(L.reffIceUm)} μm  얼음 ${f3(L.iceOptical)}  무리 ${f3(L.halo)}  가루 ${f3(L.powder)}`);
  }
}
check('렌더 기둥 τ ≤ 물리 τ(봉투가 깎음), 적운 비 0.3~0.7', Object.values(rows).every(L => L.tauRendered <= L.tauCore + 1e-9) && within(rows['표준:cu'].tauRendered / rows['표준:cu'].tauCore, 0.3, 0.7), `cu ${f3(rows['표준:cu'].tauRendered / rows['표준:cu'].tauCore)}`);
for (const [name] of PROFS) {
  const t = g => rows[`${name}:${g}`].tauCore;
  check(`종류 순서 τ ci < ac < sc < cu (${name})`, t('ci') < t('ac') && t('ac') < t('sc') && t('sc') < t('cu'), ['ci', 'ac', 'sc', 'cu'].map(g => f3(t(g))).join(' < '));
  check(`무리: cs > ci > 0, 물 구름 0 (${name})`, rows[`${name}:cs`].halo > rows[`${name}:ci`].halo && rows[`${name}:ci`].halo > 0 && ['cu', 'sc', 'st', 'ac'].every(g => rows[`${name}:${g}`].halo === 0));
  check(`가루 효과: 권운 0, 적운 1 (${name})`, rows[`${name}:ci`].powder === 0 && rows[`${name}:cu`].powder === 1);
}
// 6 지금(손값) 대비 — 기록만
const HAND = { cu: 0.22, sc: 0.22, st: 0.2, ac: 0.2, as: 0.15, ns: 0.28, ci: 0.003, cs: 0.0015, cbanvil: 0.06 };
console.log('\n종류  손값 densityScale → 물리 β_top(표준)  (배율)   손값 τ(0.625·ds·H) → 물리 τ   렌더 기둥 τ 손값 → 물리');
for (const [g, [, H]] of Object.entries(SCENES)) {
  const L = rows[`표준:${g}`];
  const handR = (() => { let s = 0; const N = 200; for (let i = 0; i < N; i++) { const hf = (i + 0.5) / N; s += (0.25 + 0.75 * hf) * P.envelopeAt(envOf(g), hf); } return HAND[g] * H * s / N; })();
  console.log(`${g.padEnd(8)} ${String(HAND[g]).padEnd(7)} → ${f3(L.betaTop).padEnd(9)} (×${f3(L.betaTop / HAND[g])})   ${f3(0.625 * HAND[g] * H).padEnd(6)} → ${f3(L.tauCore).padEnd(6)}   렌더 ${f3(handR).padEnd(6)} → ${f3(L.tauRendered)}`);
}

// 7 liveScene 배선 — 예보 단면 → 열역학 입력, 적운류만 응결고도 밑면(physBaseKm)
{
  const LB = path.join(OUT, 'liveScene.cjs');
  execFileSync('npx', ['esbuild', path.join(ROOT, 'src/components/VolumetricProbe/liveScene.ts'), '--bundle', '--format=cjs', '--platform=node', '--define:__DEV__=false', `--outfile=${LB}`, '--log-level=error'], { cwd: ROOT, stdio: 'inherit' });
  const LS = require(LB);
  const PL = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 600, 500, 400, 300, 250, 200];
  const zs = [110, 330, 540, 760, 990, 1460, 1950, 2470, 3010, 4200, 5600, 7200, 9200, 10400, 11800];
  const obs = (cover, tdC) => ({
    low: cover, mid: 0, high: 0, precipitation: 0, humidity: 60, t2mC: 24, td2mC: tdC,
    profileHeightM: zs, profileCoverPct: zs.map(z => (z >= 900 && z <= 2000 ? 70 : 0)),
    profileTempC: zs.map((z, i) => (i === 3 ? NaN : 24 - 6.5e-3 * z)),
    windULow: 10, windVLow: 0, windUMid: 20, windVMid: 0, windUHigh: 40, windVHigh: 0,
  });
  const th = LS.thermoOf(obs(40, 16), 40);
  check('thermoOf: 기온이 있는 면만(14/15)·지상 기온·이슬점', th.levels.length === 14 && th.t2mC === 24 && th.td2mC === 16 && th.levels[0].pHPa === 1000, `면 ${th.levels.length}`);
  const seen = new Set();
  let okAll = true, okThermo = true;
  for (const [cover, td] of [[40, 16], [30, 20], [60, 16], [90, 23]]) {
    const r = LS.buildLiveScene({ lat: 37.57, lon: 126.98, heightM: 40, date: new Date('2026-10-12T03:00:00Z'), obs: obs(cover, td) });
    okThermo = okThermo && !!r.input.thermo && r.input.thermo.t2mC === 24;
    for (const L of r.input.layers) {
      if (!L.genus) continue;
      seen.add(L.genus);
      const want = ['cu', 'cg', 'cb'].includes(L.genus) ? P.lclBaseKm({ groundM: 40, t2mC: 24, td2mC: td }) : undefined;
      if (L.physBaseKm !== want) okAll = false;
    }
  }
  check('buildLiveScene: 입력에 thermo', okThermo);
  check('buildLiveScene: physBaseKm 는 적운류만 = 지면 + 응결고도', okAll && [...seen].some(g => ['cu', 'cg', 'cb'].includes(g)), `본 종류 ${[...seen].join(',')}`);
}
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
