/**
 * cloudSkeleton.ts — 구름 **뼈대**: 종류별 발생 원리 → 층 밑면·꼭대기·열기둥 자리·폭·깊이·롤·전단 (§139, RULER-shape §1). three.js 없음, 순수 함수.
 *
 * 적운·웅대적운(§1.1): 밑면 = 응결고도(125 m/K), 열기둥 간격 λ = 2√2·min(경계층, LCL)(Thuburn & Efstathiou 2020; Öktem & Romps 2021 관측 2.7~3.1),
 * 폭 중앙값 0.6 z_LCL(SGP 코드 길이 — 불확실 ±0.2), 면적 멱법칙 b 1.7(절단 파레토, 상한 (0.6λ)²), 깊이 D_i = min(r_i w_i, D_max)(r 는 종 — humilis < 1 < congestus,
 * D_max 는 덱 두께/역전/영하고도), 켤 확률 ∝ √면적 로 위에서 본 면적 = 운량, 전단 밀림 S·D²/(2 w_up).
 * 층적운(§1.2): 꼭대기 = 역전(pblM → RH ≥ 85 % 면 → dθ/dz 최대 → +600 m), 뚜껑 단면(mode 3), 혼합층 요소 2.5 h(롤이면 바람 −15°, 3:1),
 * 중규모 열린(운량 < 0.6 또는 강수)/닫힌 세포 35 h(Wood & Hartmann 2006).
 * 모든 높이는 지면 위(AGL) 로 셈하고 baseM 만 해발로 돌려줍니다. 날씨 타일은 주기(tileKm)라 자리 좌표는 [0, 1).
 */
import type { ThermoInput } from './cloudPhysics';

export type SkeletonGenus = 'cu' | 'cg' | 'sc';

export interface SkeletonLayerInput {
  genus: SkeletonGenus;
  /** 원 운량 0~1(coverRemap 미적용 — RULER-shape 검토 구현 7) */
  cover: number;
  /** 예보 저층 덱 밑면(km, 해발) · 두께(m) — 있으면 우선 */
  baseKm?: number;
  thicknessM?: number;
}

export interface SkeletonCell {
  /** 타일 좌표 [0, 1) (x 동, y 북) */
  x: number; y: number;
  /** 폭(km) · 깊이(m) · 켜짐 */
  wKm: number; dM: number; on: boolean;
  /**
   * §139 K3 열기둥별 변이(vary) — 없으면 K1 과 같음(p = 0.5/r, capW 1, ax 1, off 0).
   * p: 캡 지수(성장 0.5/r · 성숙 0.3/r — 평평한 꼭대기) · capW: 캡 높이 몫(소멸 단계 0.4 — 터렛만 남은 누더기) · ax: 바람 가로 방향 축 비(타원) ·
   * off: 캡 중심 밀림(R 대비, 바람 방향) · dir: 바람 방향 단위벡터(x 동, y 북) · stage: 0 성장 1 성숙 2 소멸 · s: 세기(로그정규)
   */
  p?: number; capW?: number; ax?: number; off?: number; dir?: [number, number]; stage?: 0 | 1 | 2; s?: number;
}

export interface Skeleton {
  genus: SkeletonGenus;
  /** 층 밑면(m, 해발) · 두께(m) */
  baseM: number; heightM: number;
  /** 응결고도·역전(m, 지면 위), 역전 출처 */
  zLclM: number | null; zInvM: number | null; zInvSource: 'pbl' | 'rh' | 'theta' | 'fallback' | 'none';
  /** 적운: 간격·폭 중앙값(km), a_min(km²), r_50, D_max(m), 열기둥 */
  lambdaKm: number; w50Km: number; aMinKm2: number; r50: number; dMaxM: number;
  cells: SkeletonCell[];
  /** 켜진 열기둥의 위에서 본 면적 합(타일 분율) · 폭 배율(합쳐지는 체제) · 스커트 필요 */
  areaOn: number; widthScale: number; skirt: boolean;
  /** 단면 모드: 0 돔(cu·cg) · 3 뚜껑(sc) */
  mode: 0 | 3;
  /** 롤/구름 거리 방향(°, 북 0 동 90, 구름이 늘어선 방향) — 없으면 등방 */
  rollDeg: number | null;
  /** 층적운 요소 간격·중규모 세포(km), 열린 세포 여부 */
  elKm: number; mesoKm: number; open: boolean;
  /** 전단 기울기 — 꼭대기 수평 밀림 / 두께(무차원, 동·북) */
  tilt: [number, number];
  wUpMps: number;
  /** 캐시 키용 결정적 해시 */
  hash: string;
}

export const SK = {
  LCL_M_PER_K: 125, LCL_MIN_M: 150, LCL_MAX_M: 3500, ML_DEPTH_M: 600,
  /** pblM 이 LCL 의 이 비율보다 낮으면(안정 시각의 모델 경계층 — 개발 장면 45~128 m) λ 척도에 쓰지 않음 */
  PBL_TRUST_OVER_LCL: 0.5,
  SPACING_FACTOR: 2 * Math.SQRT2, SPACING_MIN_KM: 0.5, SPACING_MAX_KM: 10,
  W50_OVER_LCL: 0.6, SIZE_EXP_B: 1.7, A_MAX_OVER_LAMBDA: 0.6,
  R50_CU: [0.4, 1.2] as [number, number], R50_CG: [1.2, 2] as [number, number], R_WIDTH_EXP: 0.3,
  CU_DMAX_OVER_LCL: 0.7, CG_DMAX_MIN_M: 2500,
  ACTIVATION_EXP: 0.5, COVER_TOL: 0.03, JITTER: 0.9, STREET_CROSS_JITTER: 0.2,
  INV_RH_PCT: 85, INV_THETA_MIN_K_PER_KM: 4, INV_SEARCH_M: 3000, INV_FALLBACK_M: 600, SC_BASE_RH_PCT: 90,
  SC_THICK_MIN_M: 200, SC_THICK_MAX_M: 1200, SC_EL_OVER_H: 2.5, SC_MESO_OVER_H: 35, SC_OPEN_COVER: 0.6,
  ROLL_MIN_MPS: 5, ROLL_OFFSET_DEG: -15,
  SHEAR_DZ_M: 2700, W_UP_CU: 2, W_UP_CG_MIN: 3, W_UP_CG_CAPE: 0.3, TILT_MAX: 1.5,
} as const;

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 결정적 난수(cloudGenus.rng 와 같은 식) */
export const skRng = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** 이슬점(°C) — Magnus 역산(RH %). */
export function dewPointC(tC: number, rhPct: number): number {
  const a = 17.625, b = 243.04, g = Math.log(Math.max(1, Math.min(100, rhPct)) / 100) + (a * tC) / (b + tC);
  return (b * g) / (a - g);
}

/**
 * 응결고도(m, 지면 위) — Espy 125 m/K, 150~3500 m. 기압면 기온·상대습도가 있으면 **혼합층 LCL**(지상 + 지면 위 600 m 안 면들의 (T − T_d) 평균, 각 면의 높이에서
 * 올림 — 아침 지상 이슬점만으로는 적운 밑면이 수백 m 낮게 나옴: 개발 장면 S2 지상 350 m vs 예보 덱 1.28 km), 없으면 지상값. 기온·이슬점이 없으면 null.
 */
export function lclAglM(th?: ThermoInput | null): number | null {
  if (!th || !fin(th.t2mC) || !fin(th.td2mC)) return null;
  const g = fin(th.groundM) ? th.groundM : 0;
  const pts: { z: number; dep: number }[] = [{ z: 0, dep: Math.max(0, th.t2mC - th.td2mC) }];
  const rh = th.rhLevels ?? [];
  for (const l of th.levels ?? []) {
    const z = l.zM - g;
    if (!fin(z) || z <= 10 || z > SK.ML_DEPTH_M) continue;
    const r = rh.find(x => Math.abs(x.zM - l.zM) < 1 && fin(x.rhPct));
    if (!r) continue;
    pts.push({ z, dep: Math.max(0, l.tC - dewPointC(l.tC, r.rhPct)) });
  }
  const z0 = pts.reduce((s, p) => s + p.z, 0) / pts.length, dep = pts.reduce((s, p) => s + p.dep, 0) / pts.length;
  return clamp(z0 + SK.LCL_M_PER_K * dep, SK.LCL_MIN_M, SK.LCL_MAX_M);
}

/** 온위(K) — θ = T (1000/p)^0.286 */
const theta = (tC: number, pHPa: number) => (tC + 273.15) * Math.pow(1000 / Math.max(1, pHPa), 0.286);

/**
 * 역전(혼합층 꼭대기) 높이(m, 지면 위). 우선순위(RULER-shape §1.2): (1) pblM (2) 밑면 위 RH ≥ 85 % 연속면의 꼭대기 (3) 밑면 위 3 km 안 dθ/dz 최대 면(≥ 4 K/km)
 * (4) 밑면 + 600 m. 밑면보다 100 m 이상 높아야 그 출처를 받아들입니다.
 */
export function inversionAglM(th: ThermoInput | null | undefined, baseAglM: number): { zM: number; source: Skeleton['zInvSource'] } {
  const g = fin(th?.groundM) ? (th!.groundM as number) : 0;
  const ok = (z: number) => fin(z) && z >= baseAglM + 100;
  if (th && fin(th.pblM) && ok(th.pblM)) return { zM: th.pblM, source: 'pbl' };
  const rh = (th?.rhLevels ?? []).filter(l => fin(l.zM) && fin(l.rhPct)).map(l => ({ z: l.zM - g, rh: l.rhPct })).sort((a, b) => a.z - b.z);
  const above = rh.filter(l => l.z >= baseAglM - 50);
  if (above.length && above[0].rh >= SK.INV_RH_PCT) {
    let top = above[0].z;
    for (let i = 1; i < above.length && above[i].rh >= SK.INV_RH_PCT; i++) top = above[i].z;
    // 연속면의 꼭대기와 그 위 첫 건조면의 가운데 — 면 간격 안 어딘가에 역전이 있음
    const next = above.find(l => l.z > top);
    const z = next ? (top + next.z) / 2 : top;
    if (ok(z)) return { zM: z, source: 'rh' };
  }
  const lv = (th?.levels ?? []).filter(l => fin(l.zM) && fin(l.tC) && fin(l.pHPa)).map(l => ({ z: l.zM - g, th: theta(l.tC, l.pHPa) })).sort((a, b) => a.z - b.z);
  let best = -1, bestZ = NaN;
  for (let i = 0; i + 1 < lv.length; i++) {
    const a = lv[i], b = lv[i + 1];
    if (b.z < baseAglM || a.z > baseAglM + SK.INV_SEARCH_M) continue;
    const grad = ((b.th - a.th) / Math.max(1, b.z - a.z)) * 1000;
    if (grad > best) { best = grad; bestZ = a.z; }
  }
  if (best >= SK.INV_THETA_MIN_K_PER_KM && ok(bestZ)) return { zM: bestZ, source: 'theta' };
  return { zM: baseAglM + SK.INV_FALLBACK_M, source: 'fallback' };
}

/** 절단 파레토(면적 멱법칙 n(a) ∝ a^(−b)) 의 역누적: U ∈ [0,1) → a ∈ [aMin, aMax]. */
export function paretoArea(u: number, aMin: number, aMax: number, b = SK.SIZE_EXP_B): number {
  const k = b - 1, t = 1 - Math.pow(aMin / aMax, k);
  return aMin * Math.pow(1 - u * t, -1 / k);
}

/** 중앙값이 target 이 되는 aMin(aMax 는 고정) — 이분법. 중앙값 ≥ aMax 면 aMax 를 돌려줌(폭 상한에 걸린 체제). */
export function aMinForMedian(target: number, aMax: number, b = SK.SIZE_EXP_B): number {
  if (target >= aMax) return aMax;
  let lo = 1e-9, hi = aMax;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (paretoArea(0.5, mid, aMax, b) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 종류별 w_up(m/s) — cu 2, cg max(3, 0.3√(2·CAPE)) */
export function updraftMps(genus: SkeletonGenus, capeJkg?: number): number {
  if (genus !== 'cg') return SK.W_UP_CU;
  return Math.max(SK.W_UP_CG_MIN, fin(capeJkg) ? SK.W_UP_CG_CAPE * Math.sqrt(2 * Math.max(0, capeJkg)) : 0);
}

/** 전단 기울기(무차원, 동·북): 밀림 = S·D²/(2 w_up), S = |V_mid − V_low| / 2.7 km, 밀림 ≤ 1.5 D → tilt = 밀림 / D. */
export function shearTilt(th: ThermoInput | null | undefined, heightM: number, wUpMps: number): [number, number] {
  const lo = th?.windLowMps, mi = th?.windMidMps;
  if (!lo || !mi || !lo.every(fin) || !mi.every(fin) || !(heightM > 0)) return [0, 0];
  const du = mi[0] - lo[0], dv = mi[1] - lo[1], m = Math.hypot(du, dv);
  if (m < 1e-6) return [0, 0];
  const S = m / SK.SHEAR_DZ_M;                     // 1/s
  const offset = Math.min(SK.TILT_MAX * heightM, (S * heightM * heightM) / (2 * wUpMps));
  const t = offset / heightM;
  return [(t * du) / m, (t * dv) / m];
}

/** 롤/구름 거리 방향(°, 북 0 동 90 — 구름이 늘어선 방향) — 850 hPa 바람 ≥ 5 m/s 면 바람 방향 − 15°, 아니면 null. */
export function rollDirectionDeg(th?: ThermoInput | null): number | null {
  const w = th?.windLowMps;
  if (!w || !w.every(fin)) return null;
  const sp = Math.hypot(w[0], w[1]);
  if (sp < SK.ROLL_MIN_MPS) return null;
  const toDeg = ((Math.atan2(w[0], w[1]) * 180) / Math.PI + 360) % 360;   // 부는 방향(동 = 90)
  return (toDeg + SK.ROLL_OFFSET_DEG + 360) % 360;
}

function fnv(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 층 하나의 뼈대. thermo 가 없거나 모자라면 §1.3 대용값. tileKm = 날씨 타일 한 변, seed = 열기둥 자리·크기 시드(층 시드).
 */
/** 표준정규(Box–Muller) — 결정적 rng 둘 */
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(6.2831853 * r());

export interface SkeletonOpts {
  /**
   * §139 K3 — 열기둥별 변이: 세기 s ~ 로그정규(σ VARY_S_SIGMA)로 깊이 D_i = min(r_i w_i, D_max)·clamp(s·√(w_i/w_max), 0.25, 1)(좁고 약한 열기둥은 혼입으로 얕게,
   * D_max 에 닿는 건 소수), 종 r_i ~ 로그정규(r_50, σ VARY_R_SIGMA), 생애 단계(성장 40 % · 성숙 35 % · 소멸 25 %: 돔 지수·평평한 꼭대기·깊이 ½ 누더기),
   * 캡 비대칭(바람 방향 0.15 R 밀림, 가로 축 0.8). 스커트 없음(퍼진 층은 밑면이 아니라 꼭대기에 생김 — 이번 구조로 표현 불가, §8).
   */
  vary?: boolean;
}
export const VARY = { S_SIGMA: 0.5, R_SIGMA: 0.35, R_MIN: 0.3, R_MAX: 2.5, D_MIN_FRAC: 0.25, STAGE_GROW: 0.4, STAGE_MATURE: 0.75, P_GROW: 0.5, P_MATURE: 0.3, DECAY_DEPTH: 0.5, DECAY_CAPW: 0.4, OFF_R: 0.15, AX: 0.8 } as const;

export function skeletonOf(L: SkeletonLayerInput, th: ThermoInput | null | undefined, tileKm: number, seed: number, o: SkeletonOpts = {}): Skeleton {
  const g = fin(th?.groundM) ? (th!.groundM as number) : 0;
  const lcl = lclAglM(th);
  const deckBaseAgl = fin(L.baseKm) ? Math.max(50, L.baseKm * 1000 - g) : null;
  const deckThick = fin(L.thicknessM) && L.thicknessM > 0 ? L.thicknessM : null;
  const precip = fin(th?.precipMm) ? (th!.precipMm as number) : 0;
  const rng = skRng(seed);

  if (L.genus === 'sc') {
    // 밑면: 예보 덱 → 첫 RH ≥ 90 % 면 → LCL → 덱 없으면 600 m
    const rh = (th?.rhLevels ?? []).filter(l => fin(l.zM) && fin(l.rhPct)).map(l => ({ z: l.zM - g, rh: l.rhPct })).sort((a, b) => a.z - b.z);
    const rhBase = rh.find(l => l.rh >= SK.SC_BASE_RH_PCT && l.z > 50)?.z ?? null;
    const baseAgl = deckBaseAgl ?? rhBase ?? lcl ?? 600;
    const inv = inversionAglM(th, baseAgl);
    let thick = clamp(inv.zM - baseAgl, SK.SC_THICK_MIN_M, SK.SC_THICK_MAX_M);
    if (deckThick) thick = clamp(deckThick, SK.SC_THICK_MIN_M, SK.SC_THICK_MAX_M);
    const h = (baseAgl + thick) / 1000;                 // 혼합층 깊이(km) = 역전 높이
    const roll = rollDirectionDeg(th);
    const open = L.cover < SK.SC_OPEN_COVER || precip > 0;
    const core = { genus: L.genus, baseM: g + baseAgl, heightM: thick, zLclM: lcl, zInvM: baseAgl + thick, zInvSource: inv.source,
      lambdaKm: 0, w50Km: 0, aMinKm2: 0, r50: 0, dMaxM: thick, cells: [] as SkeletonCell[], areaOn: L.cover, widthScale: 1, skirt: false,
      mode: 3 as const, rollDeg: roll, elKm: SK.SC_EL_OVER_H * h, mesoKm: SK.SC_MESO_OVER_H * h, open, tilt: [0, 0] as [number, number], wUpMps: 0 };
    return { ...core, hash: fnv(JSON.stringify({ ...core, cells: undefined, seed, tileKm })) };
  }

  // ── 적운 · 웅대적운 ──
  const zb = lcl ?? deckBaseAgl ?? 1000;
  const pbl = fin(th?.pblM) ? (th!.pblM as number) : NaN;
  const mix = fin(pbl) && pbl >= SK.PBL_TRUST_OVER_LCL * zb ? Math.min(pbl, zb) : zb;
  const lambda = clamp((SK.SPACING_FACTOR * mix) / 1000, SK.SPACING_MIN_KM, SK.SPACING_MAX_KM);
  const inv = inversionAglM(th, zb);
  let dMax: number;
  if (L.genus === 'cg') {
    const fz = fin(th?.freezingLevelM) ? (th!.freezingLevelM as number) - g - zb : NaN;
    dMax = deckThick ?? (fin(fz) && fz > 0 ? Math.max(SK.CG_DMAX_MIN_M, fz) : SK.CG_DMAX_MIN_M);
  } else {
    dMax = deckThick ?? (inv.source !== 'fallback' ? inv.zM - zb : SK.CU_DMAX_OVER_LCL * zb);
  }
  dMax = clamp(dMax, 150, 12000);
  const rr = L.genus === 'cg' ? SK.R50_CG : SK.R50_CU;
  const r50 = clamp(dMax / zb, rr[0], rr[1]);
  const w50 = (SK.W50_OVER_LCL * zb) / 1000;
  const aMax = Math.pow(SK.A_MAX_OVER_LAMBDA * lambda, 2);
  const aMin = aMinForMedian((Math.PI / 4) * w50 * w50, aMax);
  const roll = rollDirectionDeg(th);

  // 바람 방향 단위벡터(850 hPa; 없으면 동) — K3 캡 비대칭용
  const wl = th?.windLowMps;
  const wm = wl && wl.every(fin) ? Math.hypot(wl[0], wl[1]) : 0;
  const windDir: [number, number] = wm > 1e-6 ? [wl![0] / wm, wl![1] / wm] : [1, 0];
  // 자리: λ 격자 + 지터(롤이면 바람 방향 줄 — 가로 지터 작게), 주기 타일 [0,1)
  const n = Math.max(1, Math.round(tileKm / lambda));
  const cells: SkeletonCell[] = [];
  const ang = roll == null ? 0 : (roll * Math.PI) / 180;      // 늘어선 방향(북 0 → y, 동 90 → x)
  const ca = Math.sin(ang), sa = Math.cos(ang);                 // 늘어선 방향 단위벡터 (x, y)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const ja = (rng() - 0.5) * SK.JITTER, jc = (rng() - 0.5) * (roll == null ? SK.JITTER : SK.STREET_CROSS_JITTER);
    const u = rng();
    const a = paretoArea(u, aMin, aMax);
    const w = 2 * Math.sqrt(a / Math.PI);
    let r = r50 * Math.pow(w / w50, SK.R_WIDTH_EXP);
    let x = (i + 0.5) / n, y = (j + 0.5) / n;
    if (roll == null) { x += ja / n; y += jc / n; } else { x += (ja * ca + jc * -sa) / n; y += (ja * sa + jc * ca) / n; }
    const cell: SkeletonCell = { x: ((x % 1) + 1) % 1, y: ((y % 1) + 1) % 1, wKm: w, dM: 0, on: false };
    if (o.vary) {
      // K3: 종·세기·생애 단계·비대칭 — 셀마다 따로 시드한 rng(자리·크기의 rng 열을 건드리지 않아 K1 과 자리가 같음)
      const vr = skRng(((seed ^ 0x9e3779b9) + (j * n + i) * 7919) | 0);
      r = clamp(r * Math.exp(VARY.R_SIGMA * gauss(vr)), VARY.R_MIN, VARY.R_MAX);
      const s = Math.exp(VARY.S_SIGMA * gauss(vr)), ph = vr();
      const stage: 0 | 1 | 2 = ph < VARY.STAGE_GROW ? 0 : ph < VARY.STAGE_MATURE ? 1 : 2;
      const wMax = 2 * Math.sqrt(aMax / Math.PI);
      let d = Math.min(r * w * 1000, dMax) * clamp(s * Math.sqrt(w / wMax), VARY.D_MIN_FRAC, 1);
      if (stage === 2) d *= VARY.DECAY_DEPTH;
      cell.dM = d; cell.s = s; cell.stage = stage;
      cell.p = (stage === 1 ? VARY.P_MATURE : VARY.P_GROW) / r;
      cell.capW = stage === 2 ? VARY.DECAY_CAPW : 1;
      cell.ax = VARY.AX; cell.off = VARY.OFF_R;
      cell.dir = windDir;
    } else {
      cell.dM = Math.min(r * w * 1000, dMax);
    }
    cells.push(cell);
  }
  // 활성: 켤 확률 ∝ a^0.5 (Efraimidis–Spirakis 키) 로 Σ면적 ≈ cover
  const tile2 = tileKm * tileKm;
  const keyed = cells.map((c, idx) => ({ idx, key: Math.pow(rng(), 1 / Math.pow((Math.PI / 4) * c.wKm * c.wKm, SK.ACTIVATION_EXP)) }));
  keyed.sort((p, q) => q.key - p.key);
  let area = 0;
  for (const k of keyed) {
    const c = cells[k.idx], a = ((Math.PI / 4) * c.wKm * c.wKm) / tile2;
    if (area >= L.cover) break;
    if (area + a > L.cover + SK.COVER_TOL && area + a - L.cover > L.cover - area) break;
    c.on = true; area += a;
  }
  let widthScale = 1, skirt = false;
  if (area < L.cover - SK.COVER_TOL) {
    // 전부 켜도 모자람 — 합쳐지는 체제: 폭을 √(cover/Σ) 배(≤ 0.6 λ), 그래도 모자라면 스커트(생성기)
    for (const c of cells) c.on = true;
    const all = cells.reduce((s, c) => s + ((Math.PI / 4) * c.wKm * c.wKm) / tile2, 0);
    widthScale = Math.sqrt(L.cover / Math.max(1e-9, all));
    const cap = SK.A_MAX_OVER_LAMBDA * lambda;
    area = 0;
    for (const c of cells) { c.wKm = Math.min(cap, c.wKm * widthScale); area += ((Math.PI / 4) * c.wKm * c.wKm) / tile2; }
    skirt = !o.vary && area < L.cover - SK.COVER_TOL;   // K3 는 스커트 없음(모자란 운량은 G4 로 보고)
  }
  const heightM = cells.reduce((m, c) => (c.on ? Math.max(m, c.dM) : m), 0) || dMax;
  const wUp = updraftMps(L.genus, th?.capeJkg);
  const core = { genus: L.genus, baseM: g + zb, heightM, zLclM: lcl, zInvM: inv.source === 'fallback' ? null : inv.zM, zInvSource: inv.source,
    lambdaKm: lambda, w50Km: w50, aMinKm2: aMin, r50, dMaxM: dMax, cells, areaOn: area, widthScale, skirt,
    mode: 0 as const, rollDeg: roll, elKm: 0, mesoKm: 0, open: false, tilt: shearTilt(th, heightM, wUp), wUpMps: wUp };
  const key = { ...core, cells: cells.map(c => [+c.x.toFixed(5), +c.y.toFixed(5), +c.wKm.toFixed(4), Math.round(c.dM), c.on ? 1 : 0, c.p ?? 0, c.capW ?? 1, c.stage ?? -1]), seed, tileKm, vary: !!o.vary };
  return { ...core, hash: fnv(JSON.stringify(key)) };
}
