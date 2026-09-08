/**
 * **먼 바다가 산으로 오인되지 않는가** (docs/GROUND_PLAN.md 4단계).
 *
 * 사용자 지적: "땅이 실제 해수면 대비 고도보다 낮게 나오거나 땅과 물의
 * 경계면이 어색하고 땅과 물의 렌더링도 어색해."
 *
 * `createTerrainBands` 는 능선과 물을 이렇게 가릅니다:
 *
 *     const hasMountain = raw > (-dipDeg + 0.005);
 *     const topDeg = hasMountain ? Math.min(raw, maxVisualAngle) : -dipDeg;
 *
 * 이 판정이 성립하려면 지형각 `raw` 와 수평선 `dipDeg` 가 **같은 지구**를
 * 써야 합니다. 그런데 지형각에는 지구 곡률이 빠져 있었습니다 — 낙차
 * `d²/2R` 은 5km 에서 2m 지만 40km 면 108m 입니다.
 *
 *   관측 30m · 수평선 -0.176°
 *   40km 해수면:  곡률 없이 -0.043°  →  raw > -dipDeg  →  **산으로 오인**
 *                 곡률 넣어 -0.197°  →  raw ≤ -dipDeg  →  물로 접힘 ✓
 *
 * 오인되면 수면 위에 회색 띠가 남습니다. 그게 "경계면이 어색"의 정체입니다.
 *
 * 재는 것:
 *  ① 세 거리대의 **바다**가 전부 수평선에 접히는가 (회색 띠가 없는가)
 *  ② 진짜 산은 제 높이로 서는가 (물 옆이라고 깎이지 않는가)
 *  ③ 띠가 뒤집히지 않는가 (위끝 ≥ 아래끝)
 *
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
const DIP = T.seaHorizonDipDeg(OBS_M);      // 양수 (도)
const SEA = -DIP;
const DIST = [5, 15, 40];
const N = 31;
const R_EARTH = 6371000;

/**
 * `fetchTerrainProfile` 의 지형각 계산을 그대로 옮깁니다.
 * `curvature` 를 끄면 고치기 전 동작이 됩니다.
 */
function anglesFor(sceneElev, curvature) {
  const angles = DIST.map(() => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    const az = (i / (N - 1)) * 360;
    for (let j = 0; j < DIST.length; j++) {
      const dm = DIST[j] * 1000;
      const drop = curvature ? (dm * dm) / (2 * R_EARTH) : 0;
      angles[j][i] = (Math.atan2(sceneElev(az, DIST[j]) - OBS_M - drop, dm) * 180) / Math.PI;
    }
  }
  return angles;
}

/** 해안 관측점: 0~120° 전부 바다 · 120~240° 만 너머 산 · 240~360° 육지 */
const coast = (az, distKm) => {
  if (az < 120) return 0;
  if (az < 240) return distKm === 5 ? 0 : 500;
  return 300;
};

function topsOf(handle, distKm) {
  const band = handle.bands.find(b => b.distanceKm === distKm);
  const elev = band.mesh.geometry.getAttribute('aElevDeg').array;
  const segs = elev.length / 2;
  const tops = [], bots = [];
  for (let s = 0; s < segs; s++) { bots.push(elev[s * 2]); tops.push(elev[s * 2 + 1]); }
  return { tops, bots, segs };
}
const segAt = (azDeg, segs) => Math.round((azDeg / 360) * segs) % segs;

console.log(`\n== 관측 ${OBS_M}m · 바다 수평선 ${SEA.toFixed(3)}° ==`);

// 참고용: 곡률을 끄면 어떤 각이 나오는지 같이 찍습니다.
{
  const off = anglesFor(coast, false), on = anglesFor(coast, true);
  const k = Math.round((60 / 360) * (N - 1));            // 바다 방위
  console.log(`\n  [참고] 바다 방위의 지형각 — 곡률 없이 / 넣어서 (수평선 ${SEA.toFixed(3)}°)`);
  for (let j = 0; j < DIST.length; j++) {
    const a = off[j][k], b = on[j][k];
    console.log(`    ${String(DIST[j]).padStart(2)}km   ${a.toFixed(3)}°  ${a > SEA ? '← 산으로 오인' : ''}` +
                `   →   ${b.toFixed(3)}°  ${b > SEA ? '← 산으로 오인' : ''}`);
  }
}

const h = T.createTerrainBands(anglesFor(coast, true), DIST, undefined, null, OBS_M);

// ① 바다가 전부 수평선에 접히는가
{
  console.log(`\n== ① 바다가 수평선에 접히는가 (방위 60°) ==`);
  for (const d of DIST) {
    const { tops, segs } = topsOf(h, d);
    const got = tops[segAt(60, segs)];
    console.log(`  ${String(d).padStart(2)}km 띠 위끝 ${got.toFixed(3)}°  (수평선 ${SEA.toFixed(3)}°)`);
    ok(Math.abs(got - SEA) < 0.005, `${d}km 바다가 수평선에 접힘 — 수면 위 회색 띠 없음`);
  }
}

// ② 진짜 산은 제 높이로
{
  console.log(`\n== ② 만 너머 산이 제 높이로 서는가 (방위 180°, 40km) ==`);
  const { tops, segs } = topsOf(h, 40);
  const got = tops[segAt(180, segs)];
  const want = anglesFor(coast, true)[2][Math.round((180 / 360) * (N - 1))];
  console.log(`  자료 ${want.toFixed(3)}°   화면 ${got.toFixed(3)}°`);
  ok(Math.abs(got - want) < 0.02, `물 옆이어도 산이 제 높이 (${got.toFixed(3)}°)`);
}

// ③ 띠가 뒤집히지 않는가
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
  ok(worst >= 0, `모든 방위에서 위끝이 아래끝 이상 (최소 ${worst.toFixed(3)}°)`);
}

h.dispose();
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — pass ${pass} / fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
