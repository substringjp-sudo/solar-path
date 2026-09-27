/**
 * **스치는 햇빛 — 둥근 대기를 지나는 광선을 직접 따라갑니다** (§106).
 *
 * 사용자: "단순 수치조정만 하지 말고 실제 대기 전체의 산란과 반사, 굴절 등의 정보를 고려해줘."
 *
 * ## 왜 필요한가
 *
 * `beamAtAltitude(해, h)` 는 높이 h 의 구름을 **지상의 관측자가 해를 dip 만큼 높게 보는 것**으로
 * 바꿔 풀었습니다: Kasten–Young 대기질량(해+dip) × exp(−h/8km). 해가 높을 때는 맞지만 노을에는
 * 틀립니다. 해 0° 에 머리 위 1.5km 구름에 닿는 빛은 그 구름 높이에서 **수평으로** 들어와, 해쪽으로
 * 수백 km 를 1.5km 안팎의 짙은 공기 속으로 스칩니다. 그 길의 공기 기둥은 수직의 약 29배인데 옛
 * 식은 17배로 셉니다. 푸른빛·초록빛은 지수로 깎이므로 차이가 몇 배로 벌어집니다.
 *
 * 해쪽으로 멀리 있는 구름은 해가 d/R 만큼 높아 광선이 덜 스칩니다 — 그래서 **해가 지는 순간 머리
 * 위는 어둡고 해쪽 지평선 구름이 탑니다.** 수치 조정이 아니라 기하와 대기에서 나오는 결과입니다.
 *
 * ## 무엇을 따라가나
 *
 *  - **공 모양 지구**(R = 6371km, 해면에서 막힘)와 **성분마다 다른 분포**: 공기는 미국 표준
 *    대기(1976)의 밀도, 에어로졸은 척도고도 1.2km(경계층에 몰린 연무), 오존은 22km 중심의 층.
 *  - **굴절**: 굴절률 n−1 = 2.93e-4 × 밀도. 광선은 밀도 기울기만큼 땅 쪽으로 휩니다
 *    (곡률 = −dn/dh · cos(국소 고도)). 그래서 구름은 기하 dip 보다 더 오래 해를 보고, 해는
 *    들어오는 **겉보기 방향**이 진짜보다 높습니다.
 *  - 투과율은 `beamFromColumns` — `directBeamRGB` 와 같은 Rayleigh·에어로졸·Chappuis 상수입니다.
 *
 * 구름 높이마다 **겉보기 고도 → (진짜 고도, 기둥 셋)** 표를 한 번 굽습니다. 이 표는 해와 무관하고
 * (기하와 대기 분포만) 높이가 바뀔 때만 다시 굽습니다.
 */
import { beamFromColumns, type RGB } from './sunsetPhysics';
import { EARTH_RADIUS_KM } from './earth';

const R = EARTH_RADIUS_KM;
/** 에어로졸 척도고도 — 대륙성 경계층의 통상값(대기 산란 렌더링의 표준값이기도 합니다). */
export const H_AEROSOL_KM = 1.2;
/** 오존층 — 22km 중심, 폭(표준편차) 6km 의 층. */
const O3_CENTER_KM = 22.0;
const O3_SIGMA_KM = 6.0;
/** 해면 굴절률 − 1 (가시광 550nm, 표준 대기). */
const N0_MINUS_1 = 2.93e-4;
const TOP_KM = 100;
const DEG = Math.PI / 180;

const o3Density = (alt: number) => Math.exp(-0.5 * ((alt - O3_CENTER_KM) / O3_SIGMA_KM) ** 2);

/**
 * **공기 밀도 — 미국 표준 대기(1976)** (해면 = 1).
 *
 * 처음엔 척도고도 8km 지수 하나로 두었는데, 굴절이 지평선에서 0.66°(천문 표준 34′ = 0.57°),
 * 10km 구름이 해를 보는 한계가 −4.2°(표준 dip 1.76′√h + 34′ 으로 −3.5°)로 너무 셌습니다.
 * 굴절은 밀도의 **기울기**가 정하는데, 대류권은 기온이 1km 에 6.5K 씩 떨어져 밀도가 지수보다
 * 완만하게(지면 척도 10.4km) 줄기 때문입니다. 조정하지 않고 실제 대기 구조를 넣습니다:
 * 0~11km 기온감률 6.5K/km(ρ ∝ (T/T0)^(g/RΓ − 1)), 11~20km 등온 216.65K, 20~32km +1K/km,
 * 그 위는 등온 척도고도로 잇습니다. 소광(Rayleigh)과 굴절이 **같은 밀도**를 씁니다.
 */
const G_OVER_R = 0.0341632;   // g/R_d (K/m)
function airDensity(altKm: number): number {
  const h = Math.max(0, altKm) * 1000;
  const T0 = 288.15;
  if (h <= 11000) {
    const T = T0 - 0.0065 * h;
    return Math.pow(T / T0, G_OVER_R / 0.0065 - 1);
  }
  const T11 = 216.65, rho11 = Math.pow(T11 / T0, G_OVER_R / 0.0065 - 1);
  if (h <= 20000) return rho11 * Math.exp(-G_OVER_R * (h - 11000) / T11);
  const rho20 = rho11 * Math.exp(-G_OVER_R * 9000 / T11);
  if (h <= 32000) {
    const T = T11 + 0.001 * (h - 20000);
    return rho20 * Math.pow(T / T11, -(G_OVER_R / 0.001 + 1));
  }
  const T32 = 228.65, rho32 = rho20 * Math.pow(T32 / T11, -(G_OVER_R / 0.001 + 1));
  return rho32 * Math.exp(-G_OVER_R * (h - 32000) / T32);
}
/** 밀도의 고도 기울기(1/km) — 굴절 곡률. */
const airDensityGrad = (altKm: number) => (airDensity(altKm + 0.01) - airDensity(Math.max(0, altKm - 0.01))) / (altKm >= 0.01 ? 0.02 : 0.01 + altKm);

// 광선 수천 개 × 걸음 수백 개라 매번 pow·exp 를 풀면 폰에서 느립니다. 10m 간격 표로 뜹니다
// (0~100km, 1만 칸, 선형 보간 — 오차는 기둥에서 1e-5 아래).
const LUT_DZ = 0.01, LUT_N = Math.ceil(TOP_KM / LUT_DZ) + 2;
const RHO = new Float64Array(LUT_N), GRAD = new Float64Array(LUT_N), AER = new Float64Array(LUT_N), OZ = new Float64Array(LUT_N);
for (let i = 0; i < LUT_N; i++) { const h = i * LUT_DZ; RHO[i] = airDensity(h); GRAD[i] = airDensityGrad(h); AER[i] = Math.exp(-h / H_AEROSOL_KM); OZ[i] = o3Density(h); }
const sampleLut = (arr: Float64Array, altKm: number) => {
  const f = Math.max(0, Math.min(LUT_N - 1.001, altKm / LUT_DZ));
  const i = f | 0;
  return arr[i] + (arr[i + 1] - arr[i]) * (f - i);
};

/** 수직 기둥(해면부터, km) — 정규화용. 중점 적분. */
const vertical = (f: (h: number) => number) => { let s = 0; for (let h = 0; h < TOP_KM; h += 0.01) s += f(h + 0.005) * 0.01; return s; };
const AIR_VERTICAL = vertical(airDensity);
const AEROSOL_VERTICAL = vertical(h => Math.exp(-h / H_AEROSOL_KM));
const O3_VERTICAL = vertical(o3Density);

export interface RayColumns {
  /** 대기 밖에서 본 광선 방향 — 출발점의 국소 수평 기준 **진짜** 고도(°). */
  eTrueDeg: number;
  /** 상대 기둥: 공기 · 에어로졸 · 오존 (해면 수직 = 1). */
  mR: number; mM: number; mO3: number;
  /** 땅에 막혔는가. */
  blocked: boolean;
}

/**
 * 높이 hKm 에서 겉보기 고도 e0Deg 로 해쪽을 향해 광선을 쏘아 대기 밖까지 따라갑니다(2차원, 해를
 * 품은 연직면). 걸음은 낮은 곳일수록 잘게 — 스치는 광선이 기둥 대부분을 가장 낮은 곳에서 얻습니다.
 */
export function traceRay(hKm: number, e0Deg: number): RayColumns {
  let x = 0, y = R + hKm;
  let dx = Math.cos(e0Deg * DEG), dy = Math.sin(e0Deg * DEG);
  let sR = 0, sM = 0, sO = 0;
  for (let i = 0; i < 40000; i++) {
    const r0 = Math.hypot(x, y);
    const alt0 = r0 - R;
    if (alt0 < 0) return { eTrueDeg: Math.atan2(dy, dx) / DEG, mR: Infinity, mM: Infinity, mO3: Infinity, blocked: true };
    if (alt0 > TOP_KM) break;
    // 걸음: 낮은 곳 0.2km, 높을수록 넓게. 스치는 광선도 고도가 d²/2R 로 천천히 변해 이 폭이면
    // 기둥·굴절 모두 0.02°·1% 안에서 수렴합니다(판정 verify-grazing-ray 가 표준값과 견줍니다).
    const ds = Math.min(4.0, 0.2 + alt0 * 0.1);
    // 중점에서 뜹니다 — 왼쪽 합은 수직에서도 기둥을 4% 부풀렸습니다.
    const mx = x + dx * ds * 0.5, my = y + dy * ds * 0.5;
    const r = Math.hypot(mx, my);
    const alt = r - R;
    if (alt < 0) return { eTrueDeg: Math.atan2(dy, dx) / DEG, mR: Infinity, mM: Infinity, mO3: Infinity, blocked: true };
    sR += sampleLut(RHO, alt) * ds;
    sM += sampleLut(AER, alt) * ds;
    sO += sampleLut(OZ, alt) * ds;
    // 굴절 — 밀도가 커지는 쪽(아래)으로 휩니다. 곡률 κ = (n0−1)·|dρ/dh| · cos(국소 고도).
    const ux = mx / r, uy = my / r;               // 국소 연직(위)
    const ud = ux * dx + uy * dy;                 // sin(국소 고도)
    const cosLocal = Math.sqrt(Math.max(0, 1 - ud * ud));
    const kappa = N0_MINUS_1 * Math.max(0, -sampleLut(GRAD, alt)) * cosLocal;
    let px = -ux + ud * dx, py = -uy + ud * dy;   // 광선에 수직인 아래쪽
    const pl = Math.hypot(px, py);
    if (pl > 1e-12) { px /= pl; py /= pl; }
    x += dx * ds; y += dy * ds;
    dx += px * kappa * ds; dy += py * kappa * ds;
    const dl = Math.hypot(dx, dy); dx /= dl; dy /= dl;
  }
  return {
    eTrueDeg: Math.atan2(dy, dx) / DEG,
    mR: sR / AIR_VERTICAL,
    mM: sM / AEROSOL_VERTICAL,
    mO3: sO / O3_VERTICAL,
    blocked: false,
  };
}

export interface GrazingTable {
  hKm: number;
  /** 진짜 고도(오름차순)와 그에 맞는 기둥·굴절(겉보기 − 진짜). */
  eTrue: Float64Array; mR: Float64Array; mM: Float64Array; mO3: Float64Array; refr: Float64Array;
  /** 땅에 막히기 직전 광선의 진짜 고도(°) — 해 원반 가림의 기준선. */
  eLimbDeg: number;
}

const tableCache = new Map<string, GrazingTable>();

/**
 * 높이 hKm 의 표. 겉보기 고도를 −6°~90° 로(지평선 둘레는 0.01°로 촘촘하게) 쏘고, 땅에 막히지 않은
 * 광선만 진짜 고도 순으로 담습니다.
 */
export function grazingTable(hKm: number): GrazingTable {
  const key = hKm.toFixed(3);
  const hit = tableCache.get(key);
  if (hit) return hit;
  const e0s: number[] = [];
  for (let e = -6; e < 3; e += 0.02) e0s.push(e);
  for (let e = 3; e < 15; e += 0.1) e0s.push(e);
  for (let e = 15; e <= 90; e += 1) e0s.push(e);
  const rows: { e: number; mR: number; mM: number; mO3: number; refr: number }[] = [];
  let eLimb = Infinity;
  for (const e0 of e0s) {
    const c = traceRay(hKm, e0);
    if (c.blocked) continue;
    rows.push({ e: c.eTrueDeg, mR: c.mR, mM: c.mM, mO3: c.mO3, refr: e0 - c.eTrueDeg });
    if (c.eTrueDeg < eLimb) eLimb = c.eTrueDeg;
  }
  rows.sort((a, b) => a.e - b.e);
  const n = rows.length;
  const t: GrazingTable = {
    hKm, eLimbDeg: eLimb,
    eTrue: new Float64Array(n), mR: new Float64Array(n), mM: new Float64Array(n), mO3: new Float64Array(n), refr: new Float64Array(n),
  };
  rows.forEach((r, i) => { t.eTrue[i] = r.e; t.mR[i] = r.mR; t.mM[i] = r.mM; t.mO3[i] = r.mO3; t.refr[i] = r.refr; });
  if (tableCache.size > 16) tableCache.clear();
  tableCache.set(key, t);
  return t;
}

/** 표에서 진짜 고도 e 의 값(선형 보간, 양끝 고정). */
function lookup(t: GrazingTable, e: number): { mR: number; mM: number; mO3: number; refr: number } {
  const a = t.eTrue;
  if (e <= a[0]) return { mR: t.mR[0], mM: t.mM[0], mO3: t.mO3[0], refr: t.refr[0] };
  const n = a.length;
  if (e >= a[n - 1]) return { mR: t.mR[n - 1], mM: t.mM[n - 1], mO3: t.mO3[n - 1], refr: t.refr[n - 1] };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= e) lo = m; else hi = m; }
  const f = (e - a[lo]) / Math.max(1e-12, a[hi] - a[lo]);
  const L = (arr: Float64Array) => arr[lo] + (arr[hi] - arr[lo]) * f;
  return { mR: L(t.mR), mM: L(t.mM), mO3: L(t.mO3), refr: L(t.refr) };
}

/** 해 원반 반지름(°). */
const SUN_RADIUS_DEG = 0.267;

/**
 * 높이 hKm(해면 기준)의 구름에 닿는 직달 — 해의 **진짜** 고도(그 자리 국소 수평 기준)로.
 * `refrDeg` 는 빛이 들어오는 겉보기 방향이 진짜보다 높은 만큼입니다.
 *
 * 원반이 지평선(막히기 직전 광선)에 걸리면 보이는 넓이 비율만큼, 그 가장자리 광선의 기둥으로
 * 투과시킵니다.
 */
export function beamGrazing(
  sunTrueDeg: number,
  hKm: number,
  p: { betaMie: number; ozoneDU: number; dayOfYear: number },
): RGB & { refrDeg: number } {
  const t = grazingTable(hKm);
  const x = Math.max(-1, Math.min(1, (sunTrueDeg - t.eLimbDeg) / SUN_RADIUS_DEG));
  const vis = (Math.PI - Math.acos(x) + x * Math.sqrt(1 - x * x)) / Math.PI;
  if (vis <= 0) return { r: 0, g: 0, b: 0, refrDeg: 0 };
  const c = lookup(t, Math.max(sunTrueDeg, t.eLimbDeg));
  const b = beamFromColumns(c.mR, c.mM, c.mO3, p.betaMie, p.ozoneDU, p.dayOfYear);
  return { r: b.r * vis, g: b.g * vis, b: b.b * vis, refrDeg: c.refr };
}
