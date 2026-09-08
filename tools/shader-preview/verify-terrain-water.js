/**
 * **땅과 물의 높이·경계** (계획 48절).
 *
 * 사용자 지적: "육지 데이터는 잘 받아오고 있는데 자꾸 땅이 실제 해수면 대비
 * 고도보다 낮게 나오거나 땅과 물의 경계면이 어색하고 땅과 물의 렌더링도
 * 어색해."
 *
 * `createTerrainBands` 가 만든 **실제 정점**을 읽어 셋을 잽니다.
 *
 *  ① 물이 능선 높이를 깎지 않는가 — 만 너머 산이 제 높이로 서는가.
 *    예전에는 방위별 수역 **비율**을 모든 거리대에 곱해서, 5km 가 물이면
 *    40km 의 산까지 ×0.533 으로 줄었습니다.
 *  ② 물이 **바다 수평선**에 놓이는가 — 지면 원반의 가장자리와 같은 각도.
 *    예전에는 0 으로 클램프돼 수평선 위에 육지색 띠가 얹혔습니다.
 *  ③ 띠의 아래끝이 항상 위끝보다 아래인가 — topDeg 가 음수로 갈 수 있게
 *    되었으므로 고정 -2.5° 로는 뒤집힐 수 있습니다.
 *
 * 준비: (이 스크립트가 알아서 TerrainRing 을 CommonJS 로 컴파일합니다)
 * 사용: node tools/shader-preview/verify-terrain-water.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SRC = '/home/user/solar-path';
const OUT = path.join(process.env.TMPDIR || os.tmpdir(), 'terrainbuild');

fs.rmSync(OUT, { recursive: true, force: true });
try {
  execFileSync('npx', ['tsc', '--module', 'commonjs', '--target', 'es2020',
    '--moduleResolution', 'node', '--skipLibCheck', '--esModuleInterop',
    '--allowSyntheticDefaultImports', '--resolveJsonModule',
    '--outDir', OUT, 'src/components/SkyScene3D/TerrainRing.ts'],
    { cwd: SRC, stdio: 'pipe' });
} catch (e) { /* tsc 는 타입 오류가 있어도 emit 합니다 — 산출물 존재로 판단 */ }
const MOD = path.join(OUT, 'components/SkyScene3D/TerrainRing.js');
if (!fs.existsSync(MOD)) throw new Error(`${MOD} 가 생기지 않았습니다`);

const T = require(MOD);

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  PASS: ${label}`); }
  else { fail++; console.log(`  FAIL: ${label}`); }
}

const OBS_M = 30;
const SEA = -T.seaHorizonDipDeg(OBS_M);          // 바다 수평선 (도)
const DIST = [5, 15, 40];
const N = 31;                                     // 실제 파이프라인의 방위 표본 수

/**
 * 해안 관측점을 흉내 냅니다.
 *  - 방위 0~120°  : 바다 (세 거리 전부 물)
 *  - 방위 120~240°: 만 너머 산 (5km 물, 15·40km 육지 — 문제의 그 경우)
 *  - 방위 240~360°: 전부 육지
 */
function scene() {
  const angles = DIST.map(() => new Array(N).fill(0));
  const water = DIST.map(() => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    const az = (i / (N - 1)) * 360;
    for (let j = 0; j < DIST.length; j++) {
      const dm = DIST[j] * 1000;
      const drop = (dm * dm) / (2 * 6371000);
      let elev;
      if (az < 120) { elev = 0; water[j][i] = 1; }
      else if (az < 240) {
        if (DIST[j] === 5) { elev = 0; water[j][i] = 1; }
        else elev = 500;                          // 만 너머 500m 산
      } else elev = 300;
      angles[j][i] = (Math.atan2(elev - OBS_M - drop, dm) * 180) / Math.PI;
    }
  }
  return { angles, water };
}

/** 정점에서 방위별 위끝 각을 되읽습니다. */
function topsOf(handle, distKm) {
  const band = handle.bands.find(b => b.distanceKm === distKm);
  const elev = band.mesh.geometry.getAttribute('aElevDeg').array;
  const segs = elev.length / 2;
  const tops = [], bots = [];
  for (let s = 0; s < segs; s++) { bots.push(elev[s * 2]); tops.push(elev[s * 2 + 1]); }
  return { tops, bots, segs };
}
/** 화면 방위(도) → 세그먼트 번호 */
const segAt = (azDeg, segs) => Math.round((azDeg / 360) * segs) % segs;

const { angles, water } = scene();
const h = T.createTerrainBands(angles, DIST, undefined, water, OBS_M);

console.log(`\n== 관측 ${OBS_M}m · 바다 수평선 ${SEA.toFixed(3)}° ==`);

// ① 만 너머 산이 제 높이로 서는가 (방위 180°, 40km 띠)
{
  const { tops, segs } = topsOf(h, 40);
  const got = tops[segAt(180, segs)];
  const want = angles[2][Math.round((180 / 360) * (N - 1))];
  console.log(`\n== ① 만 너머 산 (방위 180°, 40km) ==`);
  console.log(`  자료의 지형각 ${want.toFixed(3)}°   화면에 선 각 ${got.toFixed(3)}°`);
  // 예전 코드였다면 water=1/3 → ×0.533 이었습니다.
  console.log(`  (예전 방식이면 ${(want * 0.533).toFixed(3)}° — 절반으로 깎임)`);
  ok(Math.abs(got - want) < 0.02, `물이 섞인 방위에서도 산이 제 높이 (${got.toFixed(3)}° 대 ${want.toFixed(3)}°)`);
}

// ② 물인 방위가 바다 수평선에 놓이는가 (방위 60°)
{
  console.log(`\n== ② 물인 방위가 바다 수평선에 놓이는가 (방위 60°) ==`);
  for (const d of DIST) {
    const { tops, segs } = topsOf(h, d);
    const got = tops[segAt(60, segs)];
    console.log(`  ${String(d).padStart(2)}km 띠 위끝 ${got.toFixed(3)}°  (바다 수평선 ${SEA.toFixed(3)}°)`);
    ok(Math.abs(got - SEA) < 0.02, `${d}km 물이 바다 수평선에 놓임`);
  }
}

// ③ 아래끝이 항상 위끝보다 아래인가
{
  console.log(`\n== ③ 띠가 뒤집히지 않는가 ==`);
  let worst = Infinity, worstD = 0;
  for (const d of DIST) {
    const { tops, bots, segs } = topsOf(h, d);
    for (let s = 0; s < segs; s++) {
      const m = tops[s] - bots[s];
      if (m < worst) { worst = m; worstD = d; }
    }
  }
  console.log(`  위끝−아래끝 최솟값 ${worst.toFixed(3)}° (${worstD}km 띠)`);
  ok(worst > 0, `모든 방위에서 위끝이 아래끝보다 위 (최소 여유 ${worst.toFixed(3)}°)`);
}

// ④ 육지 방위는 물에 영향받지 않는가 (방위 300°)
{
  console.log(`\n== ④ 전부 육지인 방위는 그대로인가 (방위 300°) ==`);
  const { tops, segs } = topsOf(h, 15);
  const got = tops[segAt(300, segs)];
  const want = angles[1][Math.round((300 / 360) * (N - 1))];
  console.log(`  자료 ${want.toFixed(3)}°   화면 ${got.toFixed(3)}°`);
  ok(Math.abs(got - want) < 0.02, `육지 방위가 자료 그대로 (${got.toFixed(3)}°)`);
}

// ⑤ 수역 마스크가 **제 방위**를 가리키는가
//
// ⚠ 처음에는 마스크와 능선의 "경계 방위"를 각각 찾아 견줬는데, 그 잣대는
// 두 격자(64칸 = 5.625° 대 72분절 = 5°)의 양자화에 묻혀 **옛 매핑에 더 좋은
// 점수**를 줬습니다. 경계 위치가 아니라 **매핑 자체**를 직접 잽니다.
//
// 표본 배열은 az_i = i · 360/(N-1) 이므로, 텍스처 칸 i(방위 i·360/TN)가
// 담아야 할 값은 그 방위에서 원본을 선형보간한 값입니다.
{
  console.log(`\n== ⑤ 수역 마스크의 방위 매핑 ==`);
  const frac = [];
  for (let i = 0; i < N; i++) frac.push((water[0][i] + water[1][i] + water[2][i]) / 3);
  const tex = T.makeWaterTexture(frac);
  const TN = tex.image.width;
  const step = 360 / (N - 1);
  let worst = 0, worstAz = 0;
  for (let i = 0; i < TN; i++) {
    const az = (i / TN) * 360;
    const t = az / step;
    const a = Math.min(Math.floor(t), N - 1);
    const b = Math.min(a + 1, N - 1);
    const f = t - Math.floor(t);
    const want = frac[a] * (1 - f) + frac[b] * f;
    const got = tex.image.data[i * 4] / 255;
    const err = Math.abs(got - want);
    if (err > worst) { worst = err; worstAz = az; }
  }
  console.log(`  칸 ${TN}개 · 표본 간격 ${step.toFixed(1)}°`);
  console.log(`  방위별 값 최대 오차 ${worst.toFixed(4)} (방위 ${worstAz.toFixed(1)}°)`);
  ok(worst < 0.02, `마스크가 제 방위의 값을 담고 있음 (최대 오차 ${worst.toFixed(4)})`);
}

h.dispose();
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — pass ${pass} / fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
