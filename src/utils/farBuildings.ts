/**
 * 먼 건물 중 "보일 수 있는 것만" 고르기 (2026-11-19, docs/SANDBOX_MODE_PLAN.md 6.3).
 *
 * 지금 건물은 눈 둘레 1 km 만 받습니다. 그 밖은 산이 가리는 곳이 많고, 가리지 않는 곳도 낮은 집은 너무 작아 보이지
 * 않으니 다 받으면 낭비입니다. 반대로 롯데월드타워 같은 높은 건물은 10 km 밖에서도 지평선 위로 우뚝 섭니다.
 *
 * 1. 지평선 프로필(`buildHorizonProfile`): 방위 1° 마다, 거리 구간마다 "그 거리까지 땅이 눈에 가장 높게 보이는 앙각"(누적 최대).
 *    앙각은 곡률·굴절을 담은 눈에 보이는 높이입니다(`curvatureDropM`, 렌더링·고르기와 같은 식).
 * 2. 타일 고르기(`planFarTiles`): 타일 안 어딘가에 가장 높은 건물(`hCapM`)이 서 있다면 그 윗부분이 땅에 가리지 않는가.
 *    가리면 그 타일은 받지 않습니다.
 * 3. 건물 고르기(`selectVisibleFar`): 받은 타일의 건물마다 **보이는 각높이** = 꼭대기 앙각 − max(밑동 앙각, 가리는 땅 앙각)
 *    이 `minVisibleDeg` 이상인 것만, 큰 것부터 `maxBuildings` 채까지.
 *
 * 높이 표본은 `HeightSampler`(동 x, 남 z, m → 해발 m)로 추상화해 앱(DEM 패치)과 시험(합성 산)이 같은 식을 씁니다.
 * 건물끼리의 가림(앞 건물이 뒤 건물을 가림)은 보지 않습니다 — 땅이 가리는 것만. 보수적이라 보이지 않는 건물이 섞일 수 있습니다.
 */
import { curvatureDropM } from './earth';
import { groundXZ, type HeightSampler } from './demPick';
import { tileListForRadius, tilePointToLonLat, type TileCoord } from './mvtTiles';

const RAD = Math.PI / 180;
const drop = curvatureDropM;

/** 이 안(눈 둘레)은 가까운 건물 읽기(`fetchNearbyBuildings`)가 맡습니다. */
export const FAR_INNER_M = 1000;
/** 먼 건물을 찾는 가장 먼 거리. 광역 DEM 패치(62 km)의 반지름 안쪽. */
export const FAR_OUTER_M = 15000;
/** 보이는 각높이가 이보다 작은 건물은 화면에서 한 줄에 못 미쳐 생략(10 km 에서 약 21 m). */
export const FAR_MIN_VISIBLE_DEG = 0.12;
/** 타일에 서 있을 수 있는 가장 높은 건물(m) — 이보다 낮은 것만 있다고 보고 타일을 거릅니다. */
export const FAR_H_CAP_M = 600;
export const FAR_MAX_TILES = 150;
export const FAR_MAX_BUILDINGS = 3000;

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

/** 땅이 하나도 없다는 뜻의 앙각(°). */
export const NO_TERRAIN = -90;

const normAz = (a: number) => ((a % 360) + 360) % 360;

/**
 * 눈(해발 eyeM)에서 본 지평선 프로필. 방위 칸마다 거리를 따라 걸으며 땅의 앙각 누적 최대를 기록합니다.
 * 걸음은 가까울수록 촘촘(거리의 1.2%, 6~distStepM/2 m)해 가까운 능선을 놓치지 않습니다.
 */
export function buildHorizonProfile(
  sample: HeightSampler,
  eyeM: number,
  opts: { azStepDeg?: number; distStepM?: number; maxDistM?: number } = {},
): HorizonProfile {
  const azStepDeg = opts.azStepDeg ?? 1;
  const distStepM = opts.distStepM ?? 250;
  const maxDistM = opts.maxDistM ?? FAR_OUTER_M;
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
        const ang = Math.atan2(h - eyeM - drop(d), d) / RAD;
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
 * 해발 groundM 의 땅에 높이 heightM 로 선 건물의 **보이는 각높이**(°). 0 이하면 땅에 가려 안 보입니다.
 * = 꼭대기 앙각 − max(밑동 앙각, 가리는 땅 앙각).
 */
export function visibleAngleDeg(p: HorizonProfile, azDeg: number, distM: number, groundM: number, heightM: number): number {
  const dr = drop(distM);
  const top = Math.atan2(groundM + heightM - p.eyeM - dr, distM) / RAD;
  const base = Math.atan2(groundM - p.eyeM - dr, distM) / RAD;
  return top - Math.max(base, occluderAngleDeg(p, azDeg, distM));
}

/** 관측점 중심 위경도 → 지상 좌표 (동, 남) m. buildMergedBuildingGeometry 와 같은 환산입니다. */
export function lonLatToEastSouth(lat0: number, lon0: number, lat: number, lon: number): [number, number] {
  const mPerDegLat = 110574.0;
  const mPerDegLon = 111320.0 * Math.cos((lat0 * Math.PI) / 180);
  return [(lon - lon0) * mPerDegLon, -(lat - lat0) * mPerDegLat];
}

const azOf = (e: number, s: number) => normAz((Math.atan2(e, -s) / RAD));
/** 두 방위의 차(0~180°). */
export const angDiffDeg = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * 타일 한 장을 (이 칸 수 + 1)² 개 격자점으로 살핍니다. 모서리와 가장자리를 **포함**합니다 — 바깥 반지름 끝을 스치는 타일(가장 가까운
 * 점이 늘 타일 가장자리나 모서리에 있습니다)과 능선 가장자리를 스친 타일을 놓치지 않게.
 */
const PLAN_GRID = 6;

export interface FarTilePlan {
  tiles: TileCoord[];
  /** 거리 안에 든 후보 타일 수 */
  considered: number;
  /** 땅에 가려 거른 타일 수 */
  hidden: number;
}

/**
 * 먼 건물을 받을 타일 목록. 가까운 건물 읽기(`fetchNearbyBuildings`)가 받는 타일과 겹쳐도 **빼지 않습니다** — 그 읽기는
 * 중심이 `innerM` 안인 건물만 쓰고 나머지는 버리므로, 그 타일의 바깥쪽 건물은 여기서 다시 받아야 합니다(같은 타일은 HTTP 캐시가 받아 줍니다).
 * 타일마다 7×7 점을 보고, 어느 점에서든 가장 높은 건물(`hCapM`)의 보이는 각높이가 `minVisibleDeg` 이상이면 받습니다.
 * 가까운 것부터 `maxTiles` 개까지.
 *
 * `sector` 가 있으면 그 방위 범위(중심 ± 반폭)에 든 격자점만 봅니다 — **받는 양을 줄이는 가장 큰 손잡이**입니다. 도심 z14 타일은
 * 한 장이 0.2~0.8 MB 라 사방 15 km 를 다 받으면 수십 MB 입니다(2026-11-19 서울 표본). 보는 방향만 받으면 몇 장입니다.
 */
export function planFarTiles(
  profile: HorizonProfile,
  sample: HeightSampler,
  lat: number,
  lon: number,
  opts: { zoom?: number; innerM?: number; outerM?: number; hCapM?: number; minVisibleDeg?: number; maxTiles?: number; sector?: { azDeg: number; halfWidthDeg: number } } = {},
): FarTilePlan {
  const z = opts.zoom ?? 14;
  const innerM = opts.innerM ?? FAR_INNER_M;
  const outerM = opts.outerM ?? FAR_OUTER_M;
  const hCap = opts.hCapM ?? FAR_H_CAP_M;
  const minVis = opts.minVisibleDeg ?? FAR_MIN_VISIBLE_DEG;
  const maxTiles = opts.maxTiles ?? FAR_MAX_TILES;
  const cand: Array<{ t: TileCoord; d: number }> = [];
  let considered = 0, hidden = 0;
  for (const t of tileListForRadius(lat, lon, outerM, z)) {
    const nw = tilePointToLonLat(t.x, t.y, t.z, 0, 0, 1);
    const se = tilePointToLonLat(t.x, t.y, t.z, 1, 1, 1);
    let best = -Infinity, dMin = Infinity, anyIn = false;
    for (let iy = 0; iy <= PLAN_GRID; iy++) {
      for (let ix = 0; ix <= PLAN_GRID; ix++) {
        const pLat = nw.lat + (se.lat - nw.lat) * iy / PLAN_GRID;
        const pLon = nw.lon + (se.lon - nw.lon) * ix / PLAN_GRID;
        const [e, s] = lonLatToEastSouth(lat, lon, pLat, pLon);
        const d = Math.hypot(e, s);
        if (d < innerM || d > outerM) continue;
        const az = azOf(e, s);
        if (opts.sector && angDiffDeg(az, opts.sector.azDeg) > opts.sector.halfWidthDeg) continue;
        anyIn = true;
        if (d < dMin) dMin = d;
        const g = sample(e, s);
        if (g == null) continue;
        const v = visibleAngleDeg(profile, az, d, g, hCap);
        if (v > best) best = v;
      }
    }
    if (!anyIn) continue;
    considered++;
    if (best >= minVis) cand.push({ t, d: dMin }); else hidden++;
  }
  cand.sort((a, b) => a.d - b.d);
  return { tiles: cand.slice(0, maxTiles).map(c => c.t), considered, hidden };
}

/** 한 건물 후보 — 타일에서 읽은 바깥 링의 위경도와 높이. */
export interface FarCandidate {
  lat: number;
  lon: number;
  heightM: number;
  ring: Array<{ lat: number; lon: number }>;
}

export interface FarPick<T extends FarCandidate> {
  item: T;
  distM: number;
  azDeg: number;
  visibleDeg: number;
}

/**
 * 후보 중 보이는 각높이가 `minVisibleDeg` 이상인 것을 큰 것부터 `maxBuildings` 개. 거리 범위 밖은 뺍니다.
 */
export function selectVisibleFar<T extends FarCandidate>(
  profile: HorizonProfile,
  sample: HeightSampler,
  lat0: number,
  lon0: number,
  items: Iterable<T>,
  opts: { innerM?: number; outerM?: number; minVisibleDeg?: number; maxBuildings?: number } = {},
): FarPick<T>[] {
  const innerM = opts.innerM ?? FAR_INNER_M;
  const outerM = opts.outerM ?? FAR_OUTER_M;
  const minVis = opts.minVisibleDeg ?? FAR_MIN_VISIBLE_DEG;
  const cap = opts.maxBuildings ?? FAR_MAX_BUILDINGS;
  const out: FarPick<T>[] = [];
  for (const it of items) {
    const [e, s] = lonLatToEastSouth(lat0, lon0, it.lat, it.lon);
    const d = Math.hypot(e, s);
    if (d < innerM || d > outerM) continue;
    const g = sample(e, s);
    if (g == null) continue;
    const az = azOf(e, s);
    const v = visibleAngleDeg(profile, az, d, g, it.heightM);
    if (v >= minVis) out.push({ item: it, distM: d, azDeg: az, visibleDeg: v });
  }
  out.sort((a, b) => b.visibleDeg - a.visibleDeg);
  return out.length > cap ? out.slice(0, cap) : out;
}
