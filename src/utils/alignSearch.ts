/**
 * 해·달을 고른 대상에 거는 날짜 찾기 (docs/SANDBOX_MODE_PLAN.md 5 장 — "꼭대기에 달 걸기").
 *
 * 서 있는 자리와 대상 방향(방위·앙각)이 정해져 있을 때, 앞으로 언제 해나 달이 그 방향에 가장 가까이 오는가.
 * 모든 각은 **겉보기**(굴절 포함)입니다. 대상의 앙각(`PickedTarget.elDeg`)도 곡률·굴절을 담은 눈에 보이는 높이라
 * 하늘의 해·달과 같은 잣대에서 견줄 수 있습니다.
 *
 * ## 방법 — 구면 추적(sphere tracing)
 *
 * 해·달은 하늘에서 1 분에 0.26° 보다 빨리 움직이지 못합니다(항성시 0.2507°/분, 달은 오히려 조금 느립니다).
 * 그래서 지금 대상까지 d° 떨어져 있으면, 허용 반경 ε° 안으로 들어오려면 적어도 (d − ε)/0.26 분은 걸립니다.
 * 그만큼 건너뛰면 **놓칠 수 없습니다.** 멀 때는 몇 시간씩 건너뛰고 가까울 때만 촘촘해서, 1 년을
 * 천 번대 위치 계산으로 훑습니다(10 분 걸음이면 5 만 번).
 *
 * 허용 반경 안에 들면 1 분 걸음으로 나올 때까지 따라가 가장 가까운 순간을 잡고 황금분할로 초 단위까지 다듬습니다.
 * 며칠씩 이어지는 접근은 `groupAlignments` 가 한 묶음으로 보여 줍니다.
 */
import { sunPosition } from './solarPosition';
import { getMoonPositionPrecise, moonSemidiameterDeg, refractionDeg } from './moonPosition';
import { angularSeparationDeg } from './demPick';
import SunCalc from 'suncalc';

const R2D = 180 / Math.PI;
/** 해·달의 하늘 속 최고 속도(°/분)에 여유를 둔 값 */
const V_MAX_DEG_PER_MIN = 0.27;
const MIN_STEP_MIN = 0.5;
const MAX_STEP_MIN = 240;
const SUN_DIAMETER_DEG = 0.533;

export type AlignBody = 'sun' | 'moon';

export interface AlignTarget {
  /** 북 0 시계 방향 (°) */
  azDeg: number;
  /** 겉보기 앙각 (°) */
  elDeg: number;
}

export interface AlignHit {
  body: AlignBody;
  timeMs: number;
  /** 대상과 물체 중심 사이 각(°) */
  sepDeg: number;
  /** 물체가 대상의 오른쪽(+)·왼쪽(−)으로 벗어난 하늘 각(°) */
  dAzDeg: number;
  /** 물체가 대상의 위(+)·아래(−)로 벗어난 각(°) */
  dElDeg: number;
  /** 그때 물체의 방위·겉보기 고도(°) */
  azDeg: number;
  altDeg: number;
  /** 물체의 겉보기 지름(°) — 어긋남을 "지름 몇 개" 로 말하는 데 씁니다. */
  diskDeg: number;
  /** 달의 밝은 비율(0~1) */
  illum?: number;
  /** 그때 해의 겉보기 고도(°) — 달이 걸린 하늘이 낮인지 밤인지 */
  sunAltDeg: number;
}

export interface AlignQuery {
  body: AlignBody;
  latitude: number;
  longitude: number;
  /** 눈의 해발(m). 달의 시차에 아주 조금 쓰입니다. */
  eyeElevM?: number;
  target: AlignTarget;
  fromMs: number;
  days: number;
  /** 이 각 안으로 들어온 접근만 냅니다(°). 기본 1°. */
  epsDeg?: number;
}

interface Sky { azDeg: number; altDeg: number; diskDeg: number }

const wrap360 = (d: number) => ((d % 360) + 360) % 360;

function bodySky(body: AlignBody, ms: number, lat: number, lon: number, elevM: number): Sky {
  const date = new Date(ms);
  if (body === 'sun') {
    const p = sunPosition(date, lat, lon);
    const geo = p.altitude * R2D;
    return { azDeg: wrap360(p.azimuth * R2D + 180), altDeg: geo + refractionDeg(geo), diskDeg: SUN_DIAMETER_DEG };
  }
  const m = getMoonPositionPrecise(date, lat, lon, elevM);
  return { azDeg: wrap360(m.azimuth * R2D + 180), altDeg: m.altitude * R2D, diskDeg: 2 * moonSemidiameterDeg(m.distance) };
}

const sepOf = (s: Sky, t: AlignTarget) => angularSeparationDeg(s.azDeg, s.altDeg, t.azDeg, t.elDeg);

function hitAt(q: AlignQuery, ms: number): AlignHit {
  const lat = q.latitude, lon = q.longitude, elevM = q.eyeElevM ?? 0;
  const s = bodySky(q.body, ms, lat, lon, elevM);
  // 대상 둘레의 작은 각이라 평면 근사: 방위차 × cos(고도)
  const dAz = ((s.azDeg - q.target.azDeg + 540) % 360) - 180;
  const sunAlt = q.body === 'sun' ? s.altDeg : bodySky('sun', ms, lat, lon, elevM).altDeg;
  return {
    body: q.body,
    timeMs: ms,
    sepDeg: sepOf(s, q.target),
    dAzDeg: dAz * Math.cos((q.target.elDeg * Math.PI) / 180),
    dElDeg: s.altDeg - q.target.elDeg,
    azDeg: s.azDeg,
    altDeg: s.altDeg,
    diskDeg: s.diskDeg,
    illum: q.body === 'moon' ? SunCalc.getMoonIllumination(new Date(ms)).fraction : undefined,
    sunAltDeg: sunAlt,
  };
}

/** UI 가 멈추지 않도록 일정 시간마다 숨을 돌립니다. */
const yieldToUi = () => new Promise<void>(r => setTimeout(r, 0));

/**
 * `fromMs` 부터 `days` 일 안에서 `epsDeg` 안으로 들어오는 접근을 시간순으로 모두 찾습니다.
 * 각 접근은 가장 가까운 순간 하나로 줄여 돌려줍니다.
 */
export async function searchAlignments(
  q: AlignQuery,
  opts: { isCancelled?: () => boolean; onProgress?: (frac: number) => void } = {},
): Promise<AlignHit[]> {
  const eps = q.epsDeg ?? 1;
  const lat = q.latitude, lon = q.longitude, elevM = q.eyeElevM ?? 0;
  const endMs = q.fromMs + q.days * 86400e3;
  const dist = (ms: number) => sepOf(bodySky(q.body, ms, lat, lon, elevM), q.target);
  const hits: AlignHit[] = [];
  let t = q.fromMs;
  let lastYield = Date.now();

  while (t < endMs) {
    if (Date.now() - lastYield > 12) {
      if (opts.isCancelled?.()) return hits;
      opts.onProgress?.((t - q.fromMs) / (endMs - q.fromMs));
      await yieldToUi();
      lastYield = Date.now();
    }
    const d = dist(t);
    if (d > eps) {
      const stepMin = Math.min(MAX_STEP_MIN, Math.max(MIN_STEP_MIN, (d - eps) / V_MAX_DEG_PER_MIN));
      t += stepMin * 60e3;
      continue;
    }

    // 접근 안: 1 분 걸음으로 나올 때까지(길게 머무르면 10 분 걸음) 가장 가까운 표본을 잡습니다.
    let best = { t: t, d };
    let tt = t - MIN_STEP_MIN * 60e3;           // 구면 추적이 최소 걸음으로 덮은 만큼 앞에서부터 봅니다
    const startScan = tt;
    for (;;) {
      const dd = dist(tt);
      if (dd < best.d) best = { t: tt, d: dd };
      if (dd > eps && tt > t) break;
      const elapsedMin = (tt - startScan) / 60e3;
      tt += (elapsedMin < 120 ? 1 : 10) * 60e3;
      if (tt > endMs + 36 * 3600e3) break;
    }

    // 가장 가까운 순간 둘레를 황금분할로 다듬습니다. 표본 간격 안에 극소가 있습니다.
    const spanMs = (best.t - startScan < 120 * 60e3 ? 1 : 10) * 60e3;
    let lo = best.t - spanMs, hi = best.t + spanMs;
    const phi = (Math.sqrt(5) - 1) / 2;
    let x1 = hi - phi * (hi - lo), x2 = lo + phi * (hi - lo);
    let f1 = dist(x1), f2 = dist(x2);
    for (let i = 0; i < 28; i++) {
      if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - phi * (hi - lo); f1 = dist(x1); }
      else { lo = x1; x1 = x2; f1 = f2; x2 = lo + phi * (hi - lo); f2 = dist(x2); }
    }
    const tBest = (lo + hi) / 2;
    if (tBest >= q.fromMs && tBest <= endMs) {
      const hit = hitAt(q, tBest);
      // 눈에 보일 수 있는 접근만: 겉보기 고도가 −2° 위(해·달 원반이 수평선 근처에서라도 보이는 범위)
      if (hit.sepDeg <= eps && hit.altDeg > -2) hits.push(hit);
    }
    t = Math.max(tt, best.t) + 5 * 60e3;
  }
  opts.onProgress?.(1);
  return hits;
}

export interface AlignGroup {
  /** 묶음 안에서 대상에 가장 가까웠던 접근 */
  best: AlignHit;
  firstMs: number;
  lastMs: number;
  /** 묶음 안의 접근 수(보통 날수) */
  count: number;
}

/**
 * 며칠씩 이어진 접근(해는 하루 0.4° 안쪽으로만 밀려 한 번 걸리면 여러 날 가깝습니다)을 한 묶음으로.
 * `gapDays` 보다 벌어지면 다른 묶음입니다. 입력은 시간순이어야 합니다.
 */
export function groupAlignments(hits: AlignHit[], gapDays = 2.5): AlignGroup[] {
  const out: AlignGroup[] = [];
  for (const h of hits) {
    const g = out[out.length - 1];
    if (g && h.timeMs - g.lastMs <= gapDays * 86400e3) {
      g.lastMs = h.timeMs;
      g.count++;
      if (h.sepDeg < g.best.sepDeg) g.best = h;
    } else {
      out.push({ best: h, firstMs: h.timeMs, lastMs: h.timeMs, count: 1 });
    }
  }
  return out;
}
