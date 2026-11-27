/**
 * 노출 측광(`exposureMeter.ts`) 순수 함수 판정 — 2026-11-27.
 * 기기: 해가 지평선 아래로 내려갈 때 화면 전체가 도리어 밝아짐(자동 노출 표가 해 고도만 보고 노출을 키움). 시뮬레이션은 화면 평균 휘도를 재서 보정하고, 샌드박스는 수동 고정.
 *  1. 목표 범위 안의 휘도는 보정 1(표 그대로), 아래면 올리고 위면 내림.
 *  2. 보정은 [GAIN_MIN, GAIN_MAX] 안(±2 EV).
 *  3. 어두울수록 보정이 단조 증가.
 *  4. 칸 값(sqrt 평균 휘도, 8 비트)을 평균 휘도로 되돌림 — 전부 같은 칸이면 그 값², 0 이면 0.
 *  5. 로그 시정수 따라가기: dt 0 이면 그대로, 오래 지나면 목표, 중간은 사이(단조).
 *  6. 소스: 샌드박스(manual)는 표 · 측광을 부르지 않고 고정값 × 2^EV, 시뮬레이션 기본은 측광, 읽기 실패해도 표 노출로 안전.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'meter-v-'));
const entry = path.join(work, 'e.ts'), out = path.join(work, 'e.cjs');
fs.writeFileSync(entry, `import * as M from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/exposureMeter.ts'))}; (globalThis as any).__M = M;`);
execFileSync('npx', ['esbuild', entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`, '--log-level=error'], { cwd: ROOT, stdio: 'inherit' });
require(out);
const M = globalThis.__M;
console.log('[1] 범위');
ok(M.meterTargetGain(0.15) === 1 && M.meterTargetGain(M.METER_LUM_LO) === 1 && M.meterTargetGain(M.METER_LUM_HI) === 1, '범위 안(0.1~0.25)은 보정 1');
ok(M.meterTargetGain(0.05) > 1, '어두우면 올림');
ok(M.meterTargetGain(0.5) < 1, '너무 밝으면 내림');
console.log('[2] 제한');
ok(M.meterTargetGain(1e-9) === M.METER_GAIN_MAX && M.meterTargetGain(0) === M.METER_GAIN_MAX, '아주 어두워도 최대 ' + M.METER_GAIN_MAX);
ok(M.meterTargetGain(1000) === M.METER_GAIN_MIN, '아주 밝아도 최소 ' + M.METER_GAIN_MIN);
console.log('[3] 단조');
let mono = true, prev = Infinity;
for (const l of [0.001, 0.003, 0.01, 0.03, 0.06, 0.1, 0.2, 0.3, 0.6]) { const g = M.meterTargetGain(l); if (g > prev + 1e-12) mono = false; prev = g; }
ok(mono, '밝을수록 보정이 줄어듦(비증가)');
console.log('[4] 부호화');
const same = new Uint8Array(16 * 16 * 4).fill(128);
ok(Math.abs(M.meterLumOf(same) - (128 / 255) ** 2) < 1e-9, '전부 128 이면 (128/255)²');
ok(M.meterLumOf(new Uint8Array(1024)) === 0, '전부 0 이면 0');
console.log('[5] 따라가기');
ok(M.meterSmooth(1, 3, 0) === 1, 'dt 0 이면 그대로');
ok(Math.abs(M.meterSmooth(1, 3, 1000) - 3) < 1e-6, '오래 지나면 목표');
const mid = M.meterSmooth(1, 3, 0.9); ok(mid > 1 && mid < 3, '중간은 사이');
console.log('[6] 소스');
const src = fs.readFileSync(path.join(ROOT, 'src/components/VolumetricProbe/volumetricScene.ts'), 'utf8');
ok(/if \(p\.exposure == null && exposureMode === 'manual'\) return manualExposure \* scale;/.test(src), '수동은 표 대신 고정값 × 배율');
ok(/exposureMode !== 'manual' && lastInput && lastInput\.exposure == null/.test(src), '수동이면 측광 안 함');
ok(/let exposureMode: 'metered' \| 'table' \| 'manual' = 'metered'/.test(src), '시뮬레이션 기본은 측광');
const sk = fs.readFileSync(path.join(ROOT, 'src/components/SkyScene3D/SkyScene3D.tsx'), 'utf8');
ok(/sandboxManualExposure \? 'manual'/.test(sk), '장면이 샌드박스 수동 플래그를 노출 방식으로 넘김');
const sc = fs.readFileSync(path.join(ROOT, 'src/components/SkyScreen/SkyScreen.tsx'), 'utf8');
ok(/expertMode \? \{ \.\.\.skySettings, sandboxManualExposure: true \}/.test(sc), '전문가(샌드박스) 모드에서만 수동 켬');
console.log(`\n${pass} PASS / ${fail} FAIL`); process.exit(fail ? 1 : 0);
