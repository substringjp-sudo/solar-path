/**
 * 지평선 프로필 — 눈에서 본 땅의 스카이라인 (2026-11-19, docs/SANDBOX_MODE_PLAN.md 5·6 장).
 *
 * 방위 1° 마다, 거리 구간마다 "그 거리까지 땅이 눈에 가장 높게 보이는 앙각"(누적 최대)을 적어 둡니다.
 *  - 해·달 걸기: 해·달이 **스카이라인 위에** 있는가(안 그러면 산 뒤에 가려 안 보입니다). `skylineAngleDeg`.
 *  - 먼 건물: 그 거리의 건물을 앞의 땅이 가리는가. `occluderAngleDeg` (`farBuildings.ts`).
 *
 * 앙각은 곡률·굴절을 담은 눈에 보이는 높이입니다(`curvatureDropM`, 렌더링·고르기와 같은 식).
 * 높이 표본은 `HeightSampler`(동 x, 남 z, m → 해발 m)로 추상화해 앱(DEM 패치)과 시험(합성 산)이 같은 식을 씁니다.
 */
import { curvatureDropM } from './earth';
import { groundXZ, type HeightSampler } from './demPick';

const RAD = Math.PI / 180;

/** 땅이 하나도 없다는 뜻의 앙각(°). */
export const NO_TERRAIN = -90;

export interface HorizonProfile {
  eyeM: number;
  /** 방위 칸 수(360)와 칸 폭(°) */
  nAz: number;
  azStepDeg: number;
  /** 거리 칸 수와 칸 폭(m) */
  nDist: number;
  distStepM: number;
  /** cum[a·nDist + k] = 방위 칸 a 에서 거리 (k+1)·distStepM 까지 땅의 최대 앙각(°). 자료가 없는 곳은 건너뜀. 없으면 NO_TERRAIN. */
  cum: Float32Array;
}

export const normAz = (a: number) => ((a % 360) + 360) % 360;

/**
 * 눈(해발 eyeM)에서 본 지평선 프로필. 방위 칸마다 거리를 따라 걸으며 땅의 앙각 누적 최대를 기록합니다.
 * 걸음은 가까울수록 촘촘(거리의 1.2%, 6~distStepM/2 m)해 가까운 능선을 놓치지 않습니다.
 */
export function buildHorizonProfile(
  sample: HeightSampler,
  eyeM: number,
  opts: { azStepDeg?: number; distStepM?: number; maxDistM?: number; refractionK?: number } = {},
): HorizonProfile {
  const azStepDeg = opts.azStepDeg ?? 1;
  const distStepM = opts.distStepM ?? 250;
  const maxDistM = opts.maxDistM ?? 15000;
  const refrK = opts.refractionK;
  const nAz = Math.round(360 / azStepDeg);
  const nDist = Math.ceil(maxDistM / distStepM);
  const cum = new Float32Array(nAz * nDist).fill(NO_TERRAIN);
  const maxStep = distStepM / 2;
  for (let a = 0; a < nAz; a++) {
    const az = a * azStepDeg;
    let m = NO_TERRAIN;
    let k = 0;
    for (let d = 6; d <= maxDistM + 1e-6;) {
      const kk = Math.min(nDist - 1, Math.floor((d - 1e-9) / distStepM));
      while (k < kk) { cum[a * nDist + k] = m; k++; }
      const [e, s] = groundXZ(az, d);
      const h = sample(e, s);
      if (h != null) {
        const ang = Math.atan2(h - eyeM - curvatureDropM(d, refrK), d) / RAD;
        if (ang > m) m = ang;
      }
      d += Math.min(maxStep, Math.max(6, d * 0.012));
    }
    while (k < nDist) { cum[a * nDist + k] = m; k++; }
  }
  return { eyeM, nAz, azStepDeg, nDist, distStepM, cum };
}

/**
 * 방위 azDeg·거리 distM 에 선 건물을 가리는 땅의 앙각(°) — 그 거리 **앞**까지의 누적 최대.
 * 이웃 방위 칸 셋 중 가장 낮은 것을 씁니다(건물 폭·칸 경계 때문에 놓치지 않게, 보수적으로).
 */
export function occluderAngleDeg(p: HorizonProfile, azDeg: number, distM: number): number {
  const k = Math.floor(distM / p.distStepM) - 1;
  if (k < 0) return NO_TERRAIN;
  const kk = Math.min(k, p.nDist - 1);
  const a0 = Math.round(normAz(azDeg) / p.azStepDeg) % p.nAz;
  let lo = Infinity;
  for (const da of [-1, 0, 1]) {
    const a = (a0 + da + p.nAz) % p.nAz;
    const v = p.cum[a * p.nDist + kk];
    if (v < lo) lo = v;
  }
  return lo;
}

/**
 * 방위 azDeg 의 스카이라인을 만드는 능선까지의 거리(m) — 누적 최대가 처음 그 값에 닿는 거리 칸의 가운데. 땅이 없으면 null.
 * 계산 과정 보기의 "능선 1.8°, 4.2 km" 에 씁니다. 칸 폭(기본 250 m)만큼의 오차가 있습니다.
 */
export function skylineDistM(p: HorizonProfile, azDeg: number): number | null {
  const a = Math.round(normAz(azDeg) / p.azStepDeg) % p.nAz;
  const row = a * p.nDist;
  const fin = p.cum[row + p.nDist - 1];
  if (fin <= NO_TERRAIN) return null;
  for (let k = 0; k < p.nDist; k++) if (p.cum[row + k] >= fin - 0.005) return (k + 0.5) * p.distStepM;
  return null;
}

/**
 * 방위 azDeg 의 스카이라인 앙각(°) — 프로필 전 거리의 최대. 방위 칸 사이는 선형으로 이어 줍니다(보수적인 최솟값이 아니라
 * 있는 그대로: 해·달이 스카이라인에 가리는지는 건물과 달리 "대충 보이는 쪽" 이 아니라 사실대로 말해야 합니다).
 * 땅이 하나도 없으면 NO_TERRAIN.
 */
export function skylineAngleDeg(p: HorizonProfile, azDeg: number): number {
  const f = normAz(azDeg) / p.azStepDeg;
  const a0 = Math.floor(f) % p.nAz, a1 = (a0 + 1) % p.nAz;
  const t = f - Math.floor(f);
  const v0 = p.cum[a0 * p.nDist + p.nDist - 1], v1 = p.cum[a1 * p.nDist + p.nDist - 1];
  if (v0 <= NO_TERRAIN && v1 <= NO_TERRAIN) return NO_TERRAIN;
  if (v0 <= NO_TERRAIN) return v1;
  if (v1 <= NO_TERRAIN) return v0;
  return v0 + (v1 - v0) * t;
}
