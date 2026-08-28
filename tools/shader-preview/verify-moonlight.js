/**
 * **달빛 → 한계등급** 합격 판정 — `src/utils/moonlight.ts`.
 *
 * 픽셀이 없는 순수 계산이라 stage-node 산출물을 바로 require 합니다.
 *
 * 준비: node tools/shader-preview/stage-node.js  (moonbuild 잡이 없으면
 *       아래 tsc 호출이 즉석에서 만듭니다 — 별도 준비 불필요)
 * 사용: node tools/shader-preview/verify-moonlight.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');

const OUT = '/tmp/moonbuild';
fs.rmSync(OUT, { recursive: true, force: true });
execFileSync('npx', ['tsc', '--module', 'commonjs', '--target', 'es2020',
  '--moduleResolution', 'node', '--outDir', OUT, 'src/utils/moonlight.ts'],
  { cwd: '/home/user/solar-path', stdio: 'pipe' });
const M = require(`${OUT}/moonlight.js`);

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}

console.log('== 경계 ==');
ok(M.moonMagLoss(-10, 1.0) === 0, '지평선 아래 보름달은 손실 0');
ok(M.moonMagLoss(45, 0) < 0.01, '삭(new moon)은 고도 상관없이 손실 거의 0');

console.log('\n== 크기 ==');
const full90 = M.moonMagLoss(90, 1.0);
console.log(`  보름달 중천 손실 = ${full90.toFixed(2)}등급`);
// 육안 한계등급이 새 달 암소(~6.5)에서 보름달 밤(~2.5~3.5)까지 떨어지는
// 실측 범위를 따릅니다.
ok(full90 > 3.0 && full90 <= 4.0, '보름달 중천 손실이 3~4등급 사이');

const full10 = M.moonMagLoss(10, 1.0);
ok(full10 < full90, `달이 낮으면(고도10°) 중천보다 손실이 작다 (${full10.toFixed(2)} < ${full90.toFixed(2)})`);

const half = M.moonMagLoss(90, 0.5);
// 후방산란(opposition surge) 때문에 조명 절반이 밝기 절반보다 훨씬 위입니다.
ok(half > full90 * 0.5, `반달이 절반보다 밝다 — opposition surge (${half.toFixed(2)} > ${(full90 * 0.5).toFixed(2)})`);

console.log('\n== 합성 (실효 한계등급) ==');
ok(M.effectiveMagLimit(6.5, 90, 1.0) < 6.5 - 3.0, '보름달이 뜨면 실효 한계등급이 크게 내려간다');
ok(M.effectiveMagLimit(6.5, -20, 1.0) === 6.5, '달이 지평선 아래면 기준값 그대로');
ok(M.effectiveMagLimit(3.0, 90, 1.0) === 3.0, '바닥(도심 3.0등급) 아래로는 안 내려간다 — 이중 차감 방지');

console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
process.exit(fail === 0 ? 0 : 1);
