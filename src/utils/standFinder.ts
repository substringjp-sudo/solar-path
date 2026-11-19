/**
 * 서 있을 자리 찾기 (docs/SANDBOX_MODE_PLAN.md 5.1 "대상에 달 걸기" 1~5 단계).
 *
 * 고른 대상 점 T(꼭대기 같은 곳)에 해나 달을 **원하는 크기로** 걸려면 어디에 서야 하고 언제인가.
 *
 * ## 기하
 *
 * 1. **크기가 거리를 정합니다.** 해·달 원반(지름 θ ≈ 0.52°)이 대상의 길이 L(예: 꼭대기 50 m, 전체 높이 555 m)과 같은 크기로 보이려면
 *    눈에서 대상까지 비스듬한 거리 r = L / (2·tan(θ·비율/2)). 50 m 면 약 5.5 km, 555 m 면 약 61 km.
 * 2. **방위가 자리를 정합니다.** 해·달이 방위 A 에 있을 때, 눈은 T 에서 그 반대쪽으로 지상 거리 d = r·cos(고도) 만큼 물러난 점 P 에 서야
 *    T 가 해·달과 같은 방위에 놓입니다(P → T 시선이 A 를 향함).
 * 3. **눈 높이가 고도를 정합니다.** P 에서 본 T 의 겉보기 앙각 = atan2(T 해발 − (P 지반 + 눈) − 낙차(d), d). 이것이 해·달의 겉보기 고도와 같아야
 *    합니다. 그 차 err(t) = 해·달 고도 − 앙각 이 0 에 드는 순간이 답입니다(곡률·굴절은 `curvatureDropM`, 지형 시선과 같은 식).
 * 4. 그 자리의 땅이 물이면 서 있을 수 없고, 땅이 P 에서 T 를 가리면 못 봅니다(`lineOfSightClearance`).
 *
 * 해·달이 움직이면 P 도 고리 위를 돌며 지반 높이가 바뀌므로 err(t) 는 시간에 따라 오르내립니다.
 *
 * ## 탐색 — 구면 추적과 같은 걸음 줄이기
 *
 * err 이 변하는 빠르기는 해·달 고도 변화(≤ 0.27°/분)에 P 가 움직이며 지반이 달라지는 몫(경사 0.5, 방위 변화 0.27°/분 안에서 ≤ 0.27°/분)을
 * 더해 0.6°/분 안쪽이라고 보고, 허용 각 ε 밖이면 (|err| − ε)/0.6 분을 건너뜁니다. 수직 절벽처럼 이를 넘는 지형은 놓칠 수 있습니다
 * (지반 자료 칸이 수백 m 라 절벽이 이미 풀려 있습니다). 해·달이 수평선 아래면 뜨는 데 걸릴 시간만큼 건넙니다.
 * ε 안에 들면 0.5 분 걸음으로 따라가 가장 가까운 순간을 잡고 황금분할로 초 단위까지 다듬습니다.
 *
 * 모든 각은 **겉보기**입니다. 해·달 위치는 걸기 찾기(`alignSearch.bodySky`)와 같은 식(같은 굴절)입니다.
 */
import { bodySky, type AlignBody } from './alignSearch';
import { curvatureDropM } from './earth';
import { lineOfSightClearance, type HeightSampler } from './demPick';
import SunCalc from 'suncalc';

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;
/** err(t) 가 변하는 빠르기의 상한(°/분). 위 머리말 참고. */
const V_ERR_DEG_PER_MIN = 0.6;
/** 해·달이 하늘에서 오르내리는 빠르기의 상한(°/분) — 수평선 아래에서 뜰 때까지 건너뛰는 데 씁니다. */
const V_SKY_DEG_PER_MIN = 0.27;
const MIN_STEP_MIN = 0.5;
const MAX_STEP_MIN = 60;
/** 자료가 없는 자리를 만나면 이만큼(분) 건너뜁니다. */
const NO_DATA_STEP_MIN = 5;
/** 이 각(°) 아래의 해·달은 보이지 않는 것으로 건너뜁니다(수평선 근처 원반 포함). */
const HORIZON_SKIP_DEG = -1.5;

export interface StandQuery {
  body: AlignBody;
  /** 대상 점: 위경도와 해발(m). 꼭대기에 걸 때는 지붕 해발. */
  target: { latitude: number; longitude: number; elevM: number };
  /** 대상 점의 지상 좌표(동 x, 남 z, m). `ground` 와 `isWater` 가 쓰는 틀과 같아야 합니다. */
  targetXZ: { eastM: number; southM: number };
  /** 해·달 원반이 가릴 대상 부분의 길이(m): 꼭대기 50 m 면 50, 전체 높이면 그 높이. */
  sizeM: number;
  /** 원반 지름 대비 크기(1 = 같은 크기). 기본 1. */
  sizeRatio?: number;
  fromMs: number;
  days: number;
  /** 땅 위 눈 높이(m). 기본 1.6. */
  eyeAboveGroundM?: number;
  /** 허용 각(°): 원반 중심이 대상 점에서 이만큼 위아래로 벗어나도 후보. 기본 0.25°. */
  epsDeg?: number;
  /** 지반 해발 표본(대상 점과 같은 지상 좌표). 자료 밖이면 null. */
  ground: HeightSampler;
  /** 그 자리가 물인가(서 있을 수 없음). 모르면 물로 보지 않습니다. */
  isWater?: (eastM: number, southM: number) => boolean;
  /** 위경도 변환(`ground` 틀의 동·남 m → 위경도). 없으면 hit 의 위경도는 null. */
  toLatLon?: (eastM: number, southM: number) => { latitude: number; longitude: number } | null;
}

export interface StandHit {
  body: AlignBody;
  timeMs: number;
  /** 서 있을 자리(대상 점과 같은 틀의 지상 좌표와 위경도) */
  eastM: number;
  southM: number;
  latitude: number | null;
  longitude: number | null;
  groundElevM: number;
  /** 대상 점까지 지상 거리(m) */
  distM: number;
  /** 그때 해·달의 방위(북 0 시계 °)·겉보기 고도(°)·지름(°) */
  azDeg: number;
  altDeg: number;
  diskDeg: number;
  /** 그 자리에서 본 대상 점의 겉보기 앙각(°) */
  elDeg: number;
  /** 원반 중심이 대상 점보다 위(+)·아래(−)로 벗어난 각(°) */
  errDeg: number;
  /** 달의 밝은 비율(0~1) */
  illum?: number;
  /** 그때 해의 겉보기 고도(°) — 낮·황혼·밤 */
  sunAltDeg: number;
  /** 땅이 그 자리에서 대상 점을 가리지 않는가 */
  visible: boolean;
  /** 그 자리가 물 위인가 */
  onWater: boolean;
}

/** 해·달 원반이 대상의 길이 L 과 같은 크기로 보이는 비스듬한 거리(m). */
export function neededSlantDistanceM(sizeM: number, diskDeg: number, ratio = 1): number {
  return sizeM / (2 * Math.tan((diskDeg * ratio * D2R) / 2));
}

interface Probe {
  sky: { azDeg: number; altDeg: number; diskDeg: number };
  /** 대상 점 → 자리 지상 거리 */
  d: number;
  eastM: number;
  southM: number;
  groundM: number | null;
  elDeg: number;
  /** 해·달 고도 − 대상 앙각(°). 자료가 없으면 NaN. */
  err: number;
}

function probe(q: StandQuery, ms: number): Probe {
  const sky = bodySky(q.body, ms, q.target.latitude, q.target.longitude, q.target.elevM);
  const r = neededSlantDistanceM(q.sizeM, sky.diskDeg, q.sizeRatio ?? 1);
  const d = r * Math.cos(sky.altDeg * D2R);
  const A = sky.azDeg * D2R;
  const eastM = q.targetXZ.eastM - d * Math.sin(A);
  const southM = q.targetXZ.southM + d * Math.cos(A);
  const g = q.ground(eastM, southM);
  if (g == null) return { sky, d, eastM, southM, groundM: null, elDeg: NaN, err: NaN };
  const eye = g + (q.eyeAboveGroundM ?? 1.6);
  const elDeg = Math.atan2(q.target.elevM - eye - curvatureDropM(d), d) * R2D;
  return { sky, d, eastM, southM, groundM: g, elDeg, err: sky.altDeg - elDeg };
}

function hitFrom(q: StandQuery, ms: number): StandHit {
  const p = probe(q, ms);
  const eye = (p.groundM ?? 0) + (q.eyeAboveGroundM ?? 1.6);
  // P 를 원점으로 옮긴 표본으로 땅의 시선 가림을 봅니다.
  const fromP: HeightSampler = (x, z) => q.ground(p.eastM + x, p.southM + z);
  const los = lineOfSightClearance(fromP, eye, q.targetXZ.eastM - p.eastM, q.targetXZ.southM - p.southM, q.target.elevM);
  const ll = q.toLatLon ? q.toLatLon(p.eastM, p.southM) : null;
  const sunAlt = q.body === 'sun' ? p.sky.altDeg : bodySky('sun', ms, q.target.latitude, q.target.longitude, q.target.elevM).altDeg;
  const g = p.groundM ?? 0;
  const onWater = q.isWater ? q.isWater(p.eastM, p.southM) : false;
  return {
    body: q.body,
    timeMs: ms,
    eastM: p.eastM,
    southM: p.southM,
    latitude: ll?.latitude ?? null,
    longitude: ll?.longitude ?? null,
    groundElevM: g,
    distM: p.d,
    azDeg: p.sky.azDeg,
    altDeg: p.sky.altDeg,
    diskDeg: p.sky.diskDeg,
    elDeg: p.elDeg,
    errDeg: p.err,
    illum: q.body === 'moon' ? SunCalc.getMoonIllumination(new Date(ms)).fraction : undefined,
    sunAltDeg: sunAlt,
    visible: los.visible,
    onWater,
  };
}

const yieldToUi = () => new Promise<void>(r => setTimeout(r, 0));

/**
 * `fromMs` 부터 `days` 일 안에서, 해·달이 대상 점에서 `epsDeg` 안으로 드는 서 있을 자리를 시간순으로 모두 찾습니다.
 * 한 번 드는 구간(해·달이 하늘을 지나는 동안 err 이 ε 안인 동안)은 가장 가까운 순간 하나로 줄입니다.
 * 물 위 자리는 `includeWater` 가 아니면 뺍니다. 가려진 자리는 `visible: false` 로 남겨 부르는 쪽이 고릅니다.
 */
export async function findStandPoints(
  q: StandQuery,
  opts: { isCancelled?: () => boolean; onProgress?: (frac: number) => void; includeWater?: boolean } = {},
): Promise<StandHit[]> {
  const eps = q.epsDeg ?? 0.25;
  const endMs = q.fromMs + q.days * 86400e3;
  const hits: StandHit[] = [];
  let t = q.fromMs;
  let lastYield = Date.now();

  while (t < endMs) {
    if (Date.now() - lastYield > 12) {
      if (opts.isCancelled?.()) return hits;
      opts.onProgress?.((t - q.fromMs) / (endMs - q.fromMs));
      await yieldToUi();
      lastYield = Date.now();
    }
    const p = probe(q, t);
    if (p.sky.altDeg < HORIZON_SKIP_DEG) {
      t += Math.min(MAX_STEP_MIN * 4, Math.max(MIN_STEP_MIN, (HORIZON_SKIP_DEG - p.sky.altDeg) / V_SKY_DEG_PER_MIN)) * 60e3;
      continue;
    }
    if (!Number.isFinite(p.err)) { t += NO_DATA_STEP_MIN * 60e3; continue; }
    const a = Math.abs(p.err);
    if (a > eps) {
      t += Math.min(MAX_STEP_MIN, Math.max(MIN_STEP_MIN, (a - eps) / V_ERR_DEG_PER_MIN)) * 60e3;
      continue;
    }

    // ε 안: 0.5 분 걸음으로 나올 때까지 따라가 가장 가까운 순간을 잡습니다(구면 추적이 건넌 만큼 앞에서부터 봅니다).
    const stepMs = MIN_STEP_MIN * 60e3;
    let best = { t, a };
    let tt = t - stepMs;
    const startScan = tt;
    for (;;) {
      const pp = probe(q, tt);
      const aa = Number.isFinite(pp.err) ? Math.abs(pp.err) : Infinity;
      if (aa < best.a) best = { t: tt, a: aa };
      if (aa > eps && tt > t) break;
      tt += stepMs;
      if (tt - startScan > 6 * 3600e3 || tt > endMs + 6 * 3600e3) break;
    }

    // 가장 가까운 순간 둘레를 황금분할로 다듬습니다.
    let lo = best.t - stepMs, hi = best.t + stepMs;
    const f = (ms: number) => { const e = probe(q, ms).err; return Number.isFinite(e) ? Math.abs(e) : Infinity; };
    const phi = (Math.sqrt(5) - 1) / 2;
    let x1 = hi - phi * (hi - lo), x2 = lo + phi * (hi - lo);
    let f1 = f(x1), f2 = f(x2);
    for (let i = 0; i < 28; i++) {
      if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - phi * (hi - lo); f1 = f(x1); }
      else { lo = x1; x1 = x2; f1 = f2; x2 = lo + phi * (hi - lo); f2 = f(x2); }
    }
    const tBest = (lo + hi) / 2;
    if (tBest >= q.fromMs && tBest <= endMs) {
      const hit = hitFrom(q, tBest);
      if (Number.isFinite(hit.errDeg) && Math.abs(hit.errDeg) <= eps && hit.altDeg > HORIZON_SKIP_DEG && (opts.includeWater || !hit.onWater)) hits.push(hit);
    }
    t = Math.max(tt, best.t) + 2 * 60e3;
  }
  opts.onProgress?.(1);
  return hits;
}

/**
 * 서로 `gapHours` 안의 후보는 한 묶음 — **한 번 지나가는 동안 여러 번 드는 것**(울퉁불퉁한 땅에서 ε 구간이 갈라질 때)을 하나로 줄입니다.
 * 묶음마다 대표 하나: 보이는 것 먼저, 그다음 어긋남이 작은 것.
 *
 * 평지에서 재 보니 달은 하루에 뜨는 쪽 한 번, 지는 쪽 한 번 드는데(90 일에 87 + 87 곳) 인접 후보 간격이 6~20 시간입니다.
 * 기준을 12 시간으로 두면 뜨는 쪽과 지는 쪽이 절반쯤 엉뚱하게 합쳐져서 한 장면이 사라지므로, 6 시간보다 짧은 4 시간이 기본입니다.
 */
export interface StandGroup { best: StandHit; count: number; hits: StandHit[] }

const betterStand = (a: StandHit, b: StandHit) => {
  if (a.visible !== b.visible) return a.visible;
  return Math.abs(a.errDeg) < Math.abs(b.errDeg);
};

export function groupStandHits(hits: StandHit[], gapHours = 4): StandGroup[] {
  const sorted = [...hits].sort((x, y) => x.timeMs - y.timeMs);
  const groups: StandGroup[] = [];
  for (const h of sorted) {
    const last = groups[groups.length - 1];
    if (last && h.timeMs - last.hits[last.hits.length - 1].timeMs <= gapHours * 3600e3) {
      last.hits.push(h);
      last.count++;
      if (betterStand(h, last.best)) last.best = h;
    } else groups.push({ best: h, count: 1, hits: [h] });
  }
  return groups;
}
