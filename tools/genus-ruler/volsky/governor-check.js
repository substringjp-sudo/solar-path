// §127 해상도 자동 조절 판정(브라우저 없음). esbuild 로 묶어 node 로 돌립니다:
//   npx esbuild src/utils/volumetricGovernor.ts --format=cjs --outfile=.harness/volsky/gov.cjs && node tools/genus-ruler/volsky/governor-check.js
const { createResolutionGovernor } = require('../../../.harness/volsky/gov.cjs');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const run = (g, ms, n) => { const ch = []; for (let i = 0; i < n; i++) { const r = g.sample(ms); if (r != null) ch.push(r); } return ch; };
{ const g = createResolutionGovernor(); ok(g.scale === 0.5, `시작 = 설정 최대 0.5 (${g.scale})`);
  ok(run(g, 30, 500).length === 0, '30ms(33fps) 는 그대로'); }
{ const g = createResolutionGovernor(); const ch = run(g, 80, 200); ok(ch[0] === 0.35 && g.scale === 0.25, `80ms(12fps) 가 이어지면 0.5 → 0.35 → 0.25 (${ch.join(',')})`);
  ok(run(g, 80, 200).length === 0, '최소 0.25 아래로는 안 내려감'); }
{ const g = createResolutionGovernor(); run(g, 80, 200); const ch = run(g, 16, 1000); ok(g.scale === 0.5 && ch.length === 2, `빨라지면 천천히 최대 0.5 까지만 올라감 (${ch.join(',')})`); }
{ const g = createResolutionGovernor(); ok(run(g, 400, 300).length === 0 && g.emaMs === 0, '쉬었다 그린 프레임(400ms)은 세지 않음'); }
{ const g = createResolutionGovernor(); let n = 0; for (let i = 0; i < 1000; i++) { if (g.sample(i % 2 ? 60 : 20) != null) n++; } ok(n === 0, `들쭉날쭉해도 평균(40ms)이 띠 안이면 그대로 (바꾼 횟수 ${n})`); }
{ const g = createResolutionGovernor(); const r = g.setMax(1); ok(r === null && g.scale === 0.5, `최대를 1 로 올려도 지금 0.5 유지 (${g.scale})`);
  run(g, 10, 2000); ok(g.scale === 1, `빠르면 새 최대 1 까지 (${g.scale})`);
  const r2 = g.setMax(0.35); ok(r2 === 0.35 && g.scale === 0.35, `최대를 0.35 로 내리면 곧바로 (${r2})`); }
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
