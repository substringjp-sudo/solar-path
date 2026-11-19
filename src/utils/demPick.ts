/**
 * 지형 지점 고르기 (2026-11-19, docs/SANDBOX_MODE_PLAN.md 3 장) — 화면을 누른 방향에서 눈에 처음 닿는 땅을 찾습니다.
 *
 * 높이 표본은 `HeightSampler`(동 x, 남 z, m → 해발 m, 자료 밖이면 null)로 추상화해 앱(DEM 패치)과 시험(합성 산)이 같은 식을 씁니다.
 * 곡률 낙차는 `curvatureDropM`(utils/earth.ts)을 씁니다: 지점 (거리 d, 해발 h) 이 눈에 보이는 앙각은 atan2(h − 눈 − 낙차(d), d).
 */
import { curvatureDropM } from './earth';

export type HeightSampler = (eastM: number, southM: number) => number | null;

const RAD = Math.PI / 180;
/** 곡률 낙차는 earth.ts 한 곳의 식을 씁니다 — 지형 렌더링과 같은 지구(굴절을 넣은 뒤에는 자동으로 같이 바뀜). */
const drop = curvatureDropM;

/** 방위(°, 북에서 시계방향)·거리 → 지상 좌표 (동, 남). */
export const groundXZ = (azDeg: number, distM: number): [number, number] => [Math.sin(azDeg * RAD) * distM, -Math.cos(azDeg * RAD) * distM];

export interface TerrainHit {
  distM: number;
  /** 해발 m */
  elevM: number;
  eastM: number;
  southM: number;
  /** 눈에서 본 앙각(°) — 곡률·굴절 포함. 화면에서 이 점이 보이는 높이. */
  elevAngleDeg: number;
}

/**
 * 눈(해발 eyeM)에서 방위 azDeg·앙각 elDeg 로 쏜 시선이 처음 땅에 닿는 점. 닿지 않으면 null(하늘·바다·자료 밖).
 * 시선 높이 z(d) = 눈 + d·tan(el) + 낙차(d) 가 땅 높이 h(d) 이하가 되는 첫 거리를 찾고 이분법으로 다듬습니다.
 */
export function rayHitTerrain(
  sample: HeightSampler,
  eyeM: number,
  azDeg: number,
  elDeg: number,
  opts: { maxDistM?: number; minDistM?: number } = {},
): TerrainHit | null {
  const maxD = opts.maxDistM ?? 40000;
  const tan = Math.tan(elDeg * RAD);
  const above = (d: number): number | null => {   // 시선이 땅 위에 있는 정도(m, 양수 = 시선이 위)
    const [e, s] = groundXZ(azDeg, d);
    const h = sample(e, s);
    if (h == null) return null;
    return eyeM + d * tan + drop(d) - h;
  };
  let prevD = opts.minDistM ?? 8;
  let prev = above(prevD);
  if (prev != null && prev <= 0) {
    // 발밑이 이미 시선보다 높다(눈 높이가 땅보다 낮은 데이터 오차) — 바로 앞 땅
    const [e, s] = groundXZ(azDeg, prevD);
    const h = sample(e, s)!;
    return { distM: prevD, elevM: h, eastM: e, southM: s, elevAngleDeg: (Math.atan2(h - eyeM - drop(prevD), prevD) / RAD) };
  }
  for (let d = prevD; d <= maxD;) {
    d += Math.min(150, Math.max(6, d * 0.012));
    const cur = above(d);
    if (cur == null) { prev = null; prevD = d; continue; }
    if (prev != null && cur <= 0) {
      let lo = prevD, hi = d;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        const v = above(mid);
        if (v != null && v > 0) lo = mid; else hi = mid;
      }
      const dd = hi;   // 땅 쪽(시선이 땅 아래로 들어간 쪽)
      const [e, s] = groundXZ(azDeg, dd);
      const h = sample(e, s) ?? eyeM;
      return { distM: dd, elevM: h, eastM: e, southM: s, elevAngleDeg: Math.atan2(h - eyeM - drop(dd), dd) / RAD };
    }
    prev = cur; prevD = d;
  }
  return null;
}

/**
 * 고른 점에서 가까운 봉우리로 올라갑니다(8 방향 경사 오름, 칸 stepM, 반경 maxR 안).
 * 평평하거나 이미 정상이면 제자리.
 */
export function climbToPeak(sample: HeightSampler, eastM: number, southM: number, opts: { stepM?: number; maxR?: number } = {}): { eastM: number; southM: number; elevM: number } | null {
  const step = opts.stepM ?? 8, maxR = opts.maxR ?? 150;
  let e = eastM, s = southM;
  const h0 = sample(e, s);
  if (h0 == null) return null;
  let h: number = h0;
  for (let it = 0; it < 64; it++) {
    let bestE = e, bestS = s;
    let bestH: number = h;
    for (let k = 0; k < 8; k++) {
      const a = (k * 45) * RAD;
      const ne = e + Math.sin(a) * step, ns = s - Math.cos(a) * step;
      if (Math.hypot(ne - eastM, ns - southM) > maxR) continue;
      const nh = sample(ne, ns);
      if (nh != null && nh > bestH) { bestH = nh; bestE = ne; bestS = ns; }
    }
    if (bestH <= h) break;
    e = bestE; s = bestS; h = bestH;
  }
  return { eastM: e, southM: s, elevM: h };
}

/** 눈에서 대상 점까지 땅이 시선을 가리지 않는가(꼭 가장 높은 가림 점의 여유 m 를 함께). 여유가 양수면 보임. */
export function lineOfSightClearance(sample: HeightSampler, eyeM: number, eastM: number, southM: number, targetElevM: number): { visible: boolean; marginM: number } {
  const D = Math.hypot(eastM, southM);
  if (D < 1) return { visible: true, marginM: 99 };
  let minMargin = Infinity;
  for (let d = 10; d < D - 5; d += Math.min(120, Math.max(8, d * 0.015))) {
    const f = d / D;
    const h = sample(eastM * f, southM * f);
    if (h == null) continue;
    // 눈 → 대상 직선(곡률 보정 좌표)의 d 에서 높이: 눈 + (대상 − 눈 − 낙차(D))·f + 낙차(d)
    const ray = eyeM + (targetElevM - eyeM - drop(D)) * f + drop(d);
    minMargin = Math.min(minMargin, ray - h);
  }
  return { visible: minMargin > 0, marginM: Number.isFinite(minMargin) ? minMargin : 99 };
}

/** 두 방향(방위·앙각, °) 사이 각도(°). */
export function angularSeparationDeg(az1: number, el1: number, az2: number, el2: number): number {
  const a1 = az1 * RAD, a2 = az2 * RAD, e1 = el1 * RAD, e2 = el2 * RAD;
  const c = Math.sin(e1) * Math.sin(e2) + Math.cos(e1) * Math.cos(e2) * Math.cos(a1 - a2);
  return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
}

/** 화면을 눌러 고른 대상(2026-11-19). 지금은 지형 한 점(봉우리 포함). 건물·랜드마크는 이 모양에 이름·높이를 더해 이어 갑니다. */
export interface PickedTarget {
  kind: 'terrain';
  /** 눈에서 본 방위(°, 북에서 시계방향)·앙각(°, 곡률 포함) */
  azDeg: number;
  elDeg: number;
  /** 눈에서의 지상 거리(m) */
  distM: number;
  /** 대상 해발(m)과 눈 해발(m) */
  elevM: number;
  eyeElevM: number;
  /** 눈 기준 지상 좌표(동, 남, m) */
  eastM: number;
  southM: number;
  latitude: number | null;
  longitude: number | null;
  /** 땅이 시선을 가리지 않는가, 가장 빠듯한 곳의 여유(m) */
  visible: boolean;
  marginM: number;
}
