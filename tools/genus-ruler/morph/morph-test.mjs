#!/usr/bin/env node
/**
 * morph-test.mjs — 연속 형태 손잡이(cloudMorph.ts) 및 생성기(cloudGenus.morphField) 단위 테스트.
 * node tools/genus-ruler/morph/morph-test.mjs
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUT = path.join(ROOT, '.harness/morph-test');
fs.mkdirSync(OUT, { recursive: true });

const BUNDLE_MORPH = path.join(OUT, 'cloudMorph.cjs');
execFileSync('npx', ['esbuild', path.join(ROOT, 'src/components/VolumetricProbe/cloudMorph.ts'), '--bundle', '--format=cjs', '--platform=node', `--outfile=${BUNDLE_MORPH}`, '--log-level=error'], { cwd: ROOT, stdio: 'inherit' });

const require = createRequire(import.meta.url);
const Morph = require(BUNDLE_MORPH);

let pass = 0, fail = 0;
const t = (name, ok, info = '') => { if (ok) pass++; else fail++; console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (info ? '  ' + info : '')); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('── 1. morphParamsOf 계산 및 클램프 검사 ──');
const p1 = Morph.morphParamsOf({ baseKm: 1.0, thicknessM: 1500, windU: 10, windV: 0 }, null);
t('대류성 c 범위 [0, 1]', p1.c >= 0 && p1.c <= 1, `c=${p1.c}`);
t('얼음 비율 ice 범위 [0, 1]', p1.ice >= 0 && p1.ice <= 1, `ice=${p1.ice}`);
t('비등방 aniso >= 1', p1.aniso >= 1, `aniso=${p1.aniso}`);
t('세포 크기 cellKm > 0', p1.cellKm > 0, `cellKm=${p1.cellKm}`);

console.log('── 2. 경계 연속성 (C 변화 시 급격한 도약 방지) ──');
const pLow = Morph.morphParamsOf({ baseKm: 1.0, thicknessM: 400 }, null);
const pHigh = Morph.morphParamsOf({ baseKm: 1.0, thicknessM: 2500 }, null);
t('두께 400m vs 2500m 대류성 c 단조 증가', pHigh.c > pLow.c, `${pLow.c} -> ${pHigh.c}`);

console.log('── 3. 역전층 억제 효과 ──');
// 역전층 단면(위 300m 기온 상승)
const thermoInv = {
  levels: [
    { zM: 1000, tC: 15, pHPa: 900 },
    { zM: 1800, tC: 10, pHPa: 820 },
    { zM: 2100, tC: 13, pHPa: 790 }, // 역전 (1800~2100m 기온 상승)
  ]
};
const cNormal = Morph.convectivityOf(1000, 800, null);
const cInversion = Morph.convectivityOf(1000, 800, thermoInv);
t('역전층 존재 시 c 감소(뚜껑 효과)', cInversion <= cNormal, `${cNormal} -> ${cInversion}`);

console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
if (fail > 0) process.exit(1);
