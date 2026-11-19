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

/** 대상 위의 한 점: 눈에서 본 방위(°, 북에서 시계방향)·앙각(°, 곡률 포함)·지상 거리와 해발, 눈 기준 지상 좌표(동, 남), 위경도, 땅이 시선을 가리는지. */
export interface TargetPoint {
  azDeg: number;
  elDeg: number;
  /** 눈에서의 지상 거리(m) */
  distM: number;
  /** 대상 해발(m) */
  elevM: number;
  /** 눈 기준 지상 좌표(동, 남, m) */
  eastM: number;
  southM: number;
  latitude: number | null;
  longitude: number | null;
  /** 땅이 시선을 가리지 않는가, 가장 빠듯한 곳의 여유(m) */
  visible: boolean;
  marginM: number;
}

/** 지상 좌표(눈 기준 동·남 m)와 해발로 대상 점을 채웁니다(앙각은 곡률 포함, 가림은 땅만). `toLatLon` 이 없으면 위경도는 null. */
export function targetPointAt(
  sample: HeightSampler,
  eyeM: number,
  eastM: number,
  southM: number,
  elevM: number,
  toLatLon?: (eastM: number, southM: number) => { latitude: number; longitude: number } | null,
): TargetPoint {
  const distM = Math.hypot(eastM, southM);
  const azDeg = ((Math.atan2(eastM, -southM) * 180) / Math.PI + 360) % 360;
  const elDeg = (Math.atan2(elevM - eyeM - drop(distM), distM) * 180) / Math.PI;
  const los = lineOfSightClearance(sample, eyeM, eastM, southM, elevM);
  const ll = toLatLon ? toLatLon(eastM, southM) : null;
  return { azDeg, elDeg, distM, elevM, eastM, southM, latitude: ll?.latitude ?? null, longitude: ll?.longitude ?? null, visible: los.visible, marginM: los.marginM };
}

/**
 * 대상의 겉보기 높이각(°): 같은 거리에서 꼭대기와 밑동이 눈에 보이는 앙각의 차(곡률·굴절 포함).
 * 목업의 "높이각"이고, 달 지름(약 0.52°)으로 나누면 "달 대비 크기"입니다.
 */
export function apparentHeightDeg(eyeM: number, distM: number, baseElevM: number, topElevM: number): number {
  const el = (z: number) => (Math.atan2(z - eyeM - drop(distM), distM) * 180) / Math.PI;
  return el(topElevM) - el(baseElevM);
}

/** 고른 대상이 건물일 때의 정보. 지도 자료(`render_height`)의 높이라 실제와 다를 수 있습니다. */
export interface BuildingInfo {
  /** 지반 위 지붕 높이(m) */
  heightM: number;
  /** 지반 해발과 지붕 해발(m) */
  baseElevM: number;
  topElevM: number;
  /** 발자국 긴 변·짧은 변(m) */
  longM: number;
  shortM: number;
  /** 눈에서 본 겉보기 높이각(°): 지붕 한가운데 거리에서 꼭대기 앙각 − 밑동 앙각 */
  angularHeightDeg: number;
  /** 지금 대상 점이 꼭대기로 붙은 점인가(아니면 누른 자리 그대로) */
  snapped: boolean;
  /** 전환용 두 점: 누른 자리와 꼭대기(지붕 한가운데) */
  hitPoint: TargetPoint;
  topPoint: TargetPoint;
}

/**
 * 화면을 눌러 고른 대상(2026-11-19). 지형 한 점(봉우리 포함)이거나 건물입니다. 건물이면 `building` 에 정보가 있고, 점 칸(방위·앙각·거리 …)은
 * `building.snapped` 가 참이면 꼭대기, 아니면 누른 자리입니다. 랜드마크는 이 모양에 이름·높이를 더해 이어 갑니다.
 */
export interface PickedTarget extends TargetPoint {
  kind: 'terrain' | 'building';
  /** 눈 해발(m) */
  eyeElevM: number;
  building?: BuildingInfo;
}

/** 건물 대상의 점 칸을 꼭대기(true) 또는 누른 자리(false)로 바꿉니다. 건물이 아니거나 이미 그 점이면 그대로 돌려줍니다. */
export function snapBuildingTarget(t: PickedTarget, snapTop: boolean): PickedTarget {
  const b = t.building;
  if (!b || b.snapped === snapTop) return t;
  const p = snapTop ? b.topPoint : b.hitPoint;
  return { ...t, ...p, building: { ...b, snapped: snapTop } };
}
