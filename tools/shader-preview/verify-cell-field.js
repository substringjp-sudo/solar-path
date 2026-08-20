/**
 * 구운 셀 필드 검증 (docs/CLOUD_TEXTURE_PLAN.md 1단계).
 *
 * 합격 기준은 하나입니다: **운량 대비 통과 면적비 오차가 ±2%p 이내**.
 * 개선 전 덱은 -25.2%p 였습니다 (measure-cloud-scale.js).
 *
 * 같이 확인하는 것:
 *  - 밉 레벨마다 따로 폈는가 (먼 하늘에서도 운량이 맞는가)
 *  - 타일 이음매가 이어지는가 (안 이어지면 하늘에 격자선이 보입니다)
 *  - 무늬가 실제로 세밀한가 (1단계가 굽기만 하고 주파수를 못 올리면 헛일)
 *
 * 준비:
 *   npx tsc --module commonjs --target es2020 --moduleResolution node \
 *     --skipLibCheck --outDir /tmp/cellbuild src/utils/cloudCellField.ts
 */
const C = require('/tmp/cellbuild/cloudCellField.js');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}

const COVERS = [0.05, 0.15, 0.25, 0.39, 0.5, 0.6, 0.75, 0.9, 0.95];

for (const variant of ['fbm', 'billow']) {
  console.log('\n########## variant = ' + variant + ' ##########');
  const t0 = Date.now();
  const field = C.bakeCellField({ size: 512, tileCells: 16, octaves: 5, variant });
  const bakeMs = Date.now() - t0;
  console.log('굽기 %dms · %d×%d · 밉 %d단', bakeMs, field.size, field.size, field.mips.length);

  console.log('\n== 통과 면적비 (레벨 0) ==');
  console.log('운량 │ 통과 면적 │   오차');
  let worst = 0;
  for (const cover of COVERS) {
    const got = C.coverageAt(field.data, cover);
    const err = got - cover;
    worst = Math.max(worst, Math.abs(err));
    console.log('%s │ %s │ %s%%p',
      cover.toFixed(2), got.toFixed(4).padStart(9),
      (err >= 0 ? '+' : '') + (err * 100).toFixed(2).padStart(5));
  }
  ok(worst <= 0.02, `면적비 오차 ≤ 2%p (최대 ${(worst * 100).toFixed(2)}%p)`);

  console.log('\n== 밉 레벨별 면적비 (운량 0.39) ==');
  //
  // 허용 오차를 레벨마다 다르게 잡습니다. N×N 레벨에서 면적비는 1/N² 단위로만
  // 표현되므로, 4×4(=16텍셀)에서 39%를 6.25%보다 정확히 맞추는 것은 **원리상
  // 불가능**합니다. 이건 평활화의 실패가 아니라 표본 수의 한계입니다.
  // 그래서 기준을 완화하는 대신 표현 한계를 계산해 그것과 비교합니다.
  console.log('레벨 │ 한 변 │ 통과 면적 │  오차  │ 표현 한계 │ 판정');
  let mipFail = 0;
  field.mips.forEach((m, i) => {
    const side = field.size >> i;
    if (side < 2) return;
    const got = C.coverageAt(m, 0.39);
    const err = got - 0.39;
    const granularity = 1 / (side * side);   // 텍셀 하나가 바꾸는 면적비
    const budget = Math.max(0.02, granularity);
    const good = Math.abs(err) <= budget;
    if (!good) mipFail++;
    console.log('%s │ %s │ %s │ %s%%p │ %s%%p │ %s',
      String(i).padStart(4), String(side).padStart(5),
      got.toFixed(4).padStart(9),
      (err >= 0 ? '+' : '') + (err * 100).toFixed(2).padStart(5),
      (budget * 100).toFixed(2).padStart(8),
      good ? 'ok' : '초과');
  });
  ok(mipFail === 0, `모든 밉이 표현 한계 안에 있음 (초과 ${mipFail}개)`);

  console.log('\n== 타일 이음매 ==');
  // 이음매를 넘는 차이가 내부의 이웃 차이보다 크게 튀면 격자선이 보입니다.
  const N = field.size;
  const d = field.data;
  let seamSum = 0, innerSum = 0;
  for (let y = 0; y < N; y++) {
    seamSum += Math.abs(d[y * N + (N - 1)] - d[y * N + 0]);
    innerSum += Math.abs(d[y * N + (N >> 1)] - d[y * N + (N >> 1) + 1]);
  }
  const seam = seamSum / N, inner = innerSum / N;
  console.log('  가로 이음매 평균 차 %s vs 내부 이웃 평균 차 %s', seam.toFixed(2), inner.toFixed(2));
  ok(seam <= inner * 1.6, `가로 이음매가 내부와 비슷 (${(seam / inner).toFixed(2)}배)`);

  let seamSumV = 0, innerSumV = 0;
  for (let x = 0; x < N; x++) {
    seamSumV += Math.abs(d[(N - 1) * N + x] - d[0 * N + x]);
    innerSumV += Math.abs(d[(N >> 1) * N + x] - d[((N >> 1) + 1) * N + x]);
  }
  const seamV = seamSumV / N, innerV = innerSumV / N;
  console.log('  세로 이음매 평균 차 %s vs 내부 이웃 평균 차 %s', seamV.toFixed(2), innerV.toFixed(2));
  ok(seamV <= innerV * 1.6, `세로 이음매가 내부와 비슷 (${(seamV / innerV).toFixed(2)}배)`);

  console.log('\n== 무늬 세밀도 (운량 0.39에서 조각 개수) ==');
  // 한 줄을 훑어 경계 교차를 세면 타일당 조각 수가 나옵니다.
  const t = (1 - 0.39) * 256;
  let crossings = 0, prev = null;
  const row = N >> 1;
  for (let x = 0; x < N; x++) {
    const on = d[row * N + x] >= t;
    if (prev !== null && on !== prev) crossings++;
    prev = on;
  }
  const perTile = crossings / 2;
  console.log('  타일 가로 한 줄에 조각 %s개 (셀 설정 %d개)', perTile.toFixed(1), field.options.tileCells);
  ok(perTile >= field.options.tileCells * 0.4,
    `조각 밀도가 설정한 셀 수에 부합 (${perTile.toFixed(1)} / ${field.options.tileCells})`);
}

console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
process.exit(fail === 0 ? 0 : 1);
