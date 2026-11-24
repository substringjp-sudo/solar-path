/**
 * cloudPhysics.ts — §136 구름 미세물리 1단계(순수 함수, three.js 없음).
 *
 * 종류(cu·sc·ac…)와 층의 기온·기압에서 **소광 계수 β(1/m)·세로 단면·얼음 비율·무리 세기**를 정합니다. 지금까지 종류별
 * 소광(GENUS.densityScale)은 판정기로 고른 손값이라 거의 모든 종류가 0.2 /m 근처였습니다 — 두께 400 m 고적운의 광학두께가
 * 50 가까이 되어 불투명했고 고층운(1.5 km)은 200 을 넘었습니다. 여기서는 교과서 식으로 셉니다:
 *
 *  - 응결고도(LCL) ≈ 125 m·(T − Td) (Espy).
 *  - 습윤단열 감률 Γm(T, p), 응결률 dq_l/dz = (cp/Lv)(Γd − Γm) — 밑면에서 걸음 25 m 로 적분해 단열 액체수 LWC_ad(h).
 *  - 실제 LWC = f_ad · LWC_ad (혼입으로 덜 참 — 종류별 f_ad).
 *  - 유효 반지름 r_eff = 1.08 · (3 LWC / (4π ρw N))^(1/3) (N = 물방울 수 농도, 종류별 대륙/해양 중간값).
 *  - β = 1.5 · LWC / (ρw · r_eff)  (큰 입자 Q_ext = 2) → β ∝ LWC^(2/3) ∝ h^(2/3).
 *  - 얼음: 권운 IWC(T) = 10^(−2 + 0.05(Tc + 40)) g/m³ (Krämer 2016·Schiller 2008 현장 중앙값의 약 1.5~2 배 — 위쪽 중앙), r_eff,ice(T) = 20 + (Tc + 60) μm,
 *    β = 1.5 · IWC / (ρi · r_eff,ice). 혼합상: 얼음 비율 f(T) = 1 − ((Tc + 23)/23)² (ECMWF IFS, 0 ~ −23 °C).
 *
 * 렌더(takram)에서 층 밀도 = 날씨 밀도(0~1, 모양 잡음으로 깎임) × densityScale × densityProfile(hf). 그래서
 * densityProfile = h^(2/3) 를 takram 꼴 −A·e^(−k·hf) + b·hf + A 로 맞춘 것(RMS 0.008), densityScale = 높이마다 센 β 를 더한
 * 기둥 광학두께(tauCore)가 0.597 · densityScale · H 와 같아지는 값입니다. 종류 봉투(patchGenusShader 의 min(1, edge·hs))가 꼭대기를
 * 깎으므로 렌더가 실제로 그리는 기둥은 더 얇습니다(tauRendered — 적운 약 0.5 배).
 * 이 단면은 takram 층 단위 값이라 구름 패스와 그림자 패스에 **똑같이** 들어갑니다.
 *
 * 열역학 입력이 없으면 표준대기(지표 15 °C, 6.5 K/km)로 물러납니다.
 */
import type { GenusKey } from './cloudGenus';
import { clamp } from '../../utils/math';

const G = 9.80665, RD = 287.05, CP = 1004.6, EPS = 0.622, RHO_W = 1000, RHO_I = 917;
const GAMMA_D = G / CP;
const lv = (tC: number) => 2.501e6 - 2370 * tC;

/** 물 위 포화수증기압(hPa, Bolton 1980). */
export function esatWater(tC: number): number {
  return 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));
}

/** 표준대기(지표 t0C, 6.5 K/km, 11 km 위 등온) — 기온(°C)·기압(hPa). */
export function standardAtmosphere(zM: number, t0C = 15): { tC: number; pHPa: number } {
  const T0 = t0C + 273.15, z = Math.max(0, zM);
  const zt = Math.min(z, 11000), Tt = T0 - 0.0065 * zt;
  let p = 1013.25 * Math.pow(Tt / T0, G / (RD * 0.0065));
  if (z > 11000) p *= Math.exp((-G * (z - 11000)) / (RD * Tt));
  return { tC: Tt - 273.15, pHPa: p };
}

/** 습윤단열 감률(K/m). */
export function moistLapse(tC: number, pHPa: number): number {
  const T = tC + 273.15, es = esatWater(tC), rs = (EPS * es) / Math.max(pHPa - es, 1), L = lv(tC);
  return (G * (1 + (L * rs) / (RD * T))) / (CP + (L * L * rs * EPS) / (RD * T * T));
}

/** 응결률 Γl = ρ · (cp/Lv) · (Γd − Γm) (kg/m³ per m) — 10 °C·900 hPa 에서 약 2 g/m³/km. */
export function condensationRate(tC: number, pHPa: number): number {
  const rho = (pHPa * 100) / (RD * (tC + 273.15));
  return rho * (CP / lv(tC)) * (GAMMA_D - moistLapse(tC, pHPa));
}

/** 응결고도(m, 지면 위) — Espy 125 m/K. */
export function lclHeightM(t2mC: number, td2mC: number): number {
  return 125 * Math.max(0, t2mC - td2mC);
}

/** 밑면(tC, pHPa)에서 h(m) 올라간 곳까지 습윤단열로 들어 올린 단열 액체수(kg/m³)와 그곳의 기온·기압. */
export function adiabaticLWC(tBaseC: number, pBaseHPa: number, hM: number): { lwc: number; tC: number; pHPa: number } {
  let t = tBaseC, p = pBaseHPa, ql = 0;
  const n = Math.max(1, Math.ceil(hM / 25)), dz = hM / n;
  for (let i = 0; i < n; i++) {
    const rho = (p * 100) / (RD * (t + 273.15));
    ql += (CP / lv(t)) * (GAMMA_D - moistLapse(t, p)) * dz;   // 질량 혼합비(kg/kg)
    t -= moistLapse(t, p) * dz;
    p -= (rho * G * dz) / 100;
  }
  const rho = (p * 100) / (RD * (t + 273.15));
  return { lwc: ql * rho, tC: t, pHPa: p };
}

/** 물방울 유효 반지름(m) — LWC(kg/m³), 수 농도 N(1/m³). k = 0.8(해양) → 1.08, k = 0.67(대륙, N ≥ 300 /cm³) → 1.14. */
export function effRadiusLiquid(lwc: number, nPerM3: number, factor = 1.08): number {
  if (!(lwc > 0) || !(nPerM3 > 0)) return 0;
  return factor * Math.cbrt((3 * lwc) / (4 * Math.PI * RHO_W * nPerM3));
}
export function betaLiquid(lwc: number, reffM: number): number {
  return reffM > 0 && lwc > 0 ? (1.5 * lwc) / (RHO_W * reffM) : 0;
}
/** 권운 얼음수 함량(kg/m³) — 10^(−2 + 0.05(Tc + 40)) g/m³ × 배율, 0.1 mg/m³ ~ 상한(g/m³)으로 자름(배율 **뒤에** 자름). */
export function iceWaterContent(tC: number, scale = 1, capGm3 = 0.05): number {
  return clamp(Math.pow(10, -2 + 0.05 * (tC + 40)) * scale, 1e-4, capGm3) * 1e-3;
}
/** 얼음 유효 반지름(m) — 20 + (Tc + 60) μm, 15 ~ 60 μm. */
export function effRadiusIce(tC: number): number {
  return clamp(20 + (tC + 60), 15, 60) * 1e-6;
}
export function betaIce(iwc: number, reffM: number): number {
  return reffM > 0 && iwc > 0 ? (1.5 * iwc) / (RHO_I * reffM) : 0;
}
/** 혼합상 얼음 질량 비율(ECMWF IFS): 0 °C 위 0, −23 °C 아래 1. */
export function iceFraction(tC: number): number {
  if (tC >= 0) return 0;
  if (tC <= -23) return 1;
  const x = (tC + 23) / 23;
  return 1 - x * x;
}

/**
 * 종류별 미세물리 가정.
 *  - phase: liquid = 물(과냉각 물 구름 포함 — 그 높이의 구름 기온 −20 °C 아래에서 얼기 시작해 −38 °C 에 다 얾),
 *    mixed = 높이마다 얼음 비율 f(T)(ECMWF)로 응결량을 물·얼음에 나눔(iceMin 이 있으면 그 아래로 내려가지 않음 — 고층운은 대개 얼음),
 *    ice = 권운 IWC(T)(층 가운데 기온, 평평한 단면).
 *  - fAd: 단열 대비 실제 LWC. 대류(cu·cg·cb)는 높이에 따라 줄어듦 fAd(h) = max(0.15, e^(−h/1.2 km))(Warner 1955: 밑면 위 1 km ≈ 0.4,
 *    1.5 km ≈ 0.3). 층적운 0.6(두께 750 m 는 대개 분리된 층 — 0.5~0.6), 층운 0.8, 고적운 0.7, 난층운·고층운 0.15·0.2(대규모 상승의 응결량 대용).
 *  - nCm3: 물방울 수 농도(동아시아 대륙성 쪽 중간값). 혼합상에서 물방울 수는 물 몫(1 − f)만큼 줄어듦(베르게론 과정으로 사라짐).
 *  - 혼합은 균질 혼합(N 고정 → β ∝ fAd^(2/3)) — 적운 관측은 비균질 혼합(β ∝ fAd) 쪽이지만 1단계는 균질로 둡니다.
 *  - iwcScale·iwcCap: 권운 IWC(T) 배율·상한(g/m³) — 권층운 1.5·0.08, 적란운 모루 30·0.4(대류 코어 근처 0.05~0.5 g/m³, Heymsfield).
 *  - halo: 22° 무리 세기(0~1).
 */
export interface GenusMicro {
  phase: 'liquid' | 'mixed' | 'ice'; fAd: number; convective?: boolean; nCm3: number; iceMin?: number;
  iwcScale?: number; iwcCap?: number; halo: number; profile: 'adiabatic' | 'flat';
}
export const GENUS_MICRO: Record<GenusKey, GenusMicro> = {
  cu: { phase: 'liquid', fAd: 1, convective: true, nCm3: 400, halo: 0, profile: 'adiabatic' },
  cg: { phase: 'mixed', fAd: 1, convective: true, nCm3: 400, halo: 0, profile: 'adiabatic' },
  cb: { phase: 'mixed', fAd: 1, convective: true, nCm3: 400, halo: 0, profile: 'adiabatic' },
  cbanvil: { phase: 'ice', fAd: 0, nCm3: 0, iwcScale: 30, iwcCap: 0.4, halo: 0.3, profile: 'flat' },
  sc: { phase: 'liquid', fAd: 0.6, nCm3: 250, halo: 0, profile: 'adiabatic' },
  st: { phase: 'liquid', fAd: 0.8, nCm3: 200, halo: 0, profile: 'adiabatic' },
  ns: { phase: 'mixed', fAd: 0.15, nCm3: 150, halo: 0, profile: 'adiabatic' },
  ac: { phase: 'liquid', fAd: 0.7, nCm3: 150, halo: 0, profile: 'adiabatic' },
  as: { phase: 'mixed', fAd: 0.2, nCm3: 100, iceMin: 0.7, halo: 0, profile: 'adiabatic' },
  ci: { phase: 'ice', fAd: 0, nCm3: 0, iwcScale: 1, iwcCap: 0.05, halo: 0.5, profile: 'flat' },
  cs: { phase: 'ice', fAd: 0, nCm3: 0, iwcScale: 1.5, iwcCap: 0.08, halo: 1, profile: 'flat' },
};

/** h^(2/3) 를 takram DensityProfile 꼴 −A·e^(−k·hf) + b·hf + A 로 맞춘 값(hf = 1 에서 1, RMS 0.008, 평균 0.597). */
export const ADIABATIC_PROFILE = { A: 0.2795, k: 6.56, b: 0.7209 };
const ADIABATIC_MEAN = ADIABATIC_PROFILE.A * (1 - (1 - Math.exp(-ADIABATIC_PROFILE.k)) / ADIABATIC_PROFILE.k) + ADIABATIC_PROFILE.b / 2;

/** 열역학 입력 — 관측점 예보(CloudData)에서 옮겨 담습니다. 빈 값은 NaN/undefined. */
export interface ThermoInput {
  /** 관측점 지면 높이(m, 해발) */
  groundM?: number;
  t2mC?: number;
  td2mC?: number;
  /** 기압면 단면(높이 m 해발 · 기온 °C · 기압 hPa) — 높이 순서 무관 */
  levels?: { zM: number; tC: number; pHPa: number }[];
  // ── §139 뼈대(cloudSkeleton) 입력 — 없으면 대용값(RULER-shape §1.3). ──
  /** 경계층 높이(m, 지면 위) · CAPE(J/kg) · 영하고도(m, 해발) */
  pblM?: number;
  capeJkg?: number;
  freezingLevelM?: number;
  /** 기압면 상대습도(높이 m 해발 · %) */
  rhLevels?: { zM: number; rhPct: number }[];
  /** 850 / 600 hPa 바람(동·북, **m/s** — 앱의 km/h 를 liveScene 이 나눔) */
  windLowMps?: [number, number];
  windMidMps?: [number, number];
  /** 시간 강수(mm) */
  precipMm?: number;
}
const fin = (v: number | undefined | null): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 해발 zM 의 기온·기압. 단면이 있으면 그 안은 보간(기온 선형, 기압 로그), 밖은 가장 가까운 끝 면에서 6.5 K/km·정역학으로 이어 갑니다
 * (단면 끝에서 다른 출처로 뛰지 않게). 단면이 없으면 지상 기온 + 6.5 K/km, 그것도 없으면 표준대기.
 */
export function thermoAt(zM: number, th?: ThermoInput | null): { tC: number; pHPa: number; source: 'profile' | 'surface' | 'standard' } {
  const lv0 = (th?.levels ?? []).filter(l => fin(l.zM) && fin(l.tC) && fin(l.pHPa) && l.pHPa > 0).sort((a, b) => a.zM - b.zM);
  if (lv0.length >= 1) {
    const lo = lv0[0], hi = lv0[lv0.length - 1];
    if (lv0.length >= 2 && zM >= lo.zM && zM <= hi.zM) {
      let i = 0;
      while (i < lv0.length - 2 && zM > lv0[i + 1].zM) i++;
      const a = lv0[i], b = lv0[i + 1], f = (zM - a.zM) / Math.max(1, b.zM - a.zM);
      return { tC: a.tC + (b.tC - a.tC) * f, pHPa: Math.exp(Math.log(a.pHPa) + (Math.log(b.pHPa) - Math.log(a.pHPa)) * f), source: 'profile' };
    }
    const a = zM < lo.zM ? lo : hi;
    const t = a.tC - 0.0065 * (zM - a.zM);
    return { tC: t, pHPa: a.pHPa * Math.pow((t + 273.15) / (a.tC + 273.15), G / (RD * 0.0065)), source: 'profile' };
  }
  const g = fin(th?.groundM) ? (th!.groundM as number) : 0;
  if (th && fin(th.t2mC)) {
    // 지상 기온을 해수면으로 내려 표준대기에 넣음(기압도 같은 식)
    return { ...standardAtmosphere(zM, th.t2mC + 0.0065 * Math.max(0, g)), source: 'surface' };
  }
  return { ...standardAtmosphere(zM), source: 'standard' };
}

/** 렌더 단면의 봉투(cloudGenus patchGenusShader 와 같은 식) — 날씨 밀도 1 인 기둥에서 높이별 밀도 상한 min(1, edge·hs(hf)). */
export interface GenusEnvelope { mode: number; base: number; top: number; edge: number }
export function envelopeAt(e: GenusEnvelope, hf: number): number {
  let hs: number;
  if (e.mode >= 2.5) hs = hf < 1 - 1e-4 ? hf : 0;   // §139 뚜껑(층적운 뼈대): 꼭대기 평평, 밑면 = 1 − d
  else if (e.mode >= 0.5) hs = 1 - Math.pow(Math.max(Math.abs(hf * 2 - 1), 1e-6), Math.max(e.top, 1e-3));
  else {
    const x = clamp(hf / Math.max(e.base, 1e-4), 0, 1), ramp = x * x * (3 - 2 * x);
    hs = ramp * Math.pow(Math.max(1 - hf, 1e-6), e.top);
  }
  return clamp(hs * e.edge, 0, 1);
}

export interface LayerPhysics {
  /** 층 꼭대기(hf = 1) 소광(1/m) — CloudLayer.densityScale. 단면 × H 의 적분이 tauCore 와 같도록 맞춤 */
  betaTop: number;
  /** takram DensityProfile(expTerm, exponent, linearTerm, constantTerm) — hf = 1 에서 1 */
  profile: [number, number, number, number];
  /** 물리 기둥 광학두께 ∫β dz(높이마다 그 자리의 상·반지름으로) — 문헌 범위와 견주는 값 */
  tauCore: number;
  /** 렌더가 실제로 그리는 기둥(날씨 밀도 1, 종류 봉투 min(1, edge·hs) 곱함)의 광학두께 — env 를 주지 않으면 tauCore */
  tauRendered: number;
  /** 광학적 얼음 비율 τ_ice / τ — 산란 위상 레인 */
  iceOptical: number;
  /** 22° 무리 세기(0~1) = 종류 무리 × 광학적 얼음 비율 */
  halo: number;
  /** 가루 효과(takram powder) 무게 — 렌더 기둥 광학두께 1 아래는 0, 5 위는 1 */
  powder: number;
  /** 진단 */
  tBaseC: number; tTopC: number; pBaseHPa: number; lwcTop: number; iwcTop: number; reffLiqUm: number; reffIceUm: number;
  source: 'profile' | 'surface' | 'standard';
}

const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/**
 * 층 하나의 미세물리. baseM = 밑면 해발(m), heightM = 층 두께(m, 렌더 층 그대로), env = 그 종류의 렌더 봉투(있으면 tauRendered 를 셈).
 * 물·혼합 층은 밑면에서 습윤단열로 25 m 씩 올라가며 그 높이의 구름 기온으로 상(물/얼음)·반지름·β 를 정하고 더합니다.
 */
export function layerPhysics(genus: GenusKey, baseM: number, heightM: number, th?: ThermoInput | null, env?: GenusEnvelope | null): LayerPhysics {
  const m = GENUS_MICRO[genus];
  const H = Math.max(50, fin(heightM) ? heightM : 50);
  const base = thermoAt(baseM, th);
  const tTop = thermoAt(baseM + H, th).tC;
  let tauL = 0, tauI = 0, lwcTop = 0, iwcTop = 0, rlTop = 0, riTop = 0;
  if (m.phase === 'ice') {
    const tMid = thermoAt(baseM + H / 2, th).tC;
    iwcTop = iceWaterContent(tMid, m.iwcScale ?? 1, m.iwcCap ?? 0.05);
    riTop = effRadiusIce(tMid);
    tauI = betaIce(iwcTop, riTop) * H;
  } else {
    const rFac = m.nCm3 >= 300 ? 1.14 : 1.08;
    let t = base.tC, p = base.pHPa, ql = 0, prev = { l: 0, i: 0 };
    const n = Math.max(1, Math.ceil(H / 25)), dz = H / n;
    for (let k = 1; k <= n; k++) {
      const rho0 = (p * 100) / (RD * (t + 273.15)), gm = moistLapse(t, p);
      ql += (CP / lv(t)) * (GAMMA_D - gm) * dz;
      t -= gm * dz;
      p -= (rho0 * G * dz) / 100;
      const h = k * dz, rho = (p * 100) / (RD * (t + 273.15));
      const fAd = m.convective ? Math.max(0.15, Math.exp(-h / 1200)) : m.fAd;
      const cond = fAd * ql * rho;
      const f = m.phase === 'mixed' ? Math.max(iceFraction(t), m.iceMin ?? 0) : clamp((-20 - t) / 18, 0, 1);
      const lw = (1 - f) * cond, iw = f * cond;
      const rl = effRadiusLiquid(lw, (1 - f) * m.nCm3 * 1e6, rFac), ri = effRadiusIce(t);
      const cur = { l: betaLiquid(lw, rl), i: betaIce(iw, ri) };
      tauL += 0.5 * (prev.l + cur.l) * dz;
      tauI += 0.5 * (prev.i + cur.i) * dz;
      prev = cur;
      if (k === n) { lwcTop = lw; iwcTop = iw; rlTop = rl; riTop = iw > 0 ? ri : 0; }
    }
  }
  const tauCore = tauL + tauI;
  const flat = m.profile === 'flat';
  const { A, k, b } = ADIABATIC_PROFILE;
  const profile: [number, number, number, number] = flat ? [0, 0, 0, 1] : [-A, -k, b, A];
  const betaTop = tauCore / ((flat ? 1 : ADIABATIC_MEAN) * H);
  let tauRendered = tauCore;
  if (env) {
    let sum = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const hf = (i + 0.5) / N;
      const prof = flat ? 1 : A * (1 - Math.exp(-k * hf)) + b * hf;
      sum += prof * envelopeAt(env, hf);
    }
    tauRendered = betaTop * H * (sum / N);
  }
  const iceOptical = tauCore > 0 ? tauI / tauCore : 0;
  const tMidPhys = thermoAt(baseM + H / 2, th).tC;
  const rhMid = (() => {
    const rl = th?.rhLevels;
    if (!rl?.length) return 75;
    let best = rl[0], minD = Math.abs(rl[0].zM - (baseM + H / 2));
    for (const q of rl) { const d = Math.abs(q.zM - (baseM + H / 2)); if (d < minD) { best = q; minD = d; } }
    return best.rhPct;
  })();
  const windMps = th?.windLowMps ? Math.hypot(th.windLowMps[0], th.windLowMps[1]) : 4;
  const pOpt = particleCloudState({
    tCloudC: tMidPhys,
    t2mC: th?.t2mC,
    rhPct: rhMid,
    precipMm: th?.precipMm ?? 0,
    windSpeedMps: windMps,
    freezingLevelM: th?.freezingLevelM,
    cloudBaseM: baseM,
  });
  return {
    betaTop, profile, tauCore, tauRendered, iceOptical,
    halo: m.halo * iceOptical * pOpt.haloScale,
    powder: smooth(1, 5, tauRendered) * pOpt.powderScale,
    tBaseC: base.tC, tTopC: tTop, pBaseHPa: base.pHPa, lwcTop, iwcTop,
    reffLiqUm: rlTop * 1e6, reffIceUm: riTop * 1e6, source: base.source,
  };
}

/**
 * §137 물리 없이 쓰는 손값 얼음 레인 — 소광·단면은 손값 그대로 두고 얼음 종류(ci·cs·모루) 층에만 무리 가중(halo)을 주거나(H1),
 * 얼음 층의 가루 효과를 끕니다(H2, ci·cs 만 — 모루는 두꺼워 그대로). 얼음 종류가 아니거나 둘 다 꺼져 있으면 null(= 무리 0 · 가루 1, 셰이더 변화 없음).
 */
export function iceLaneHand(genus: GenusKey, o: { halo: boolean; powderOff: boolean }): { halo: number; powder: number } | null {
  const m = GENUS_MICRO[genus];
  if (m.phase !== 'ice') return null;
  const halo = o.halo ? m.halo : 0;
  const powder = o.powderOff && genus !== 'cbanvil' ? 0 : 1;
  return halo > 0 || powder < 1 ? { halo, powder } : null;
}

/**
 * 입자 물리 기반 연속 광학 레인(햇무리 halo · 가루 효과 powder).
 * 층 opts 에 입자 상태에서 유도된 haloWeight / powderWeight 가 있으면 연속 반영하고,
 * 없으면 기존 손값 얼음 레인(iceLaneHand)으로 물러납니다.
 */
export function particleOpticalLane(
  genus: GenusKey,
  opts?: { haloWeight?: number; powderWeight?: number },
  handOpts?: { halo: boolean; powderOff: boolean },
): { halo: number; powder: number } | null {
  const hw = opts?.haloWeight;
  const pw = opts?.powderWeight;
  if (typeof hw === 'number' || typeof pw === 'number') {
    const halo = typeof hw === 'number' && Number.isFinite(hw) ? clamp(hw, 0, 1) : 0;
    const powder = typeof pw === 'number' && Number.isFinite(pw) ? clamp(pw, 0, 1) : 1;
    return halo > 0.01 || powder < 0.98 ? { halo, powder } : null;
  }
  return handOpts ? iceLaneHand(genus, handOpts) : null;
}

/**
 * 적운류 밑면 = 지면 + 응결고도(§136). 지상 기온·이슬점이 없으면 null(예보 단면의 밑면을 그대로 씀). 지면 위 0.3 ~ 3.5 km 로 자릅니다.
 */
export function lclBaseKm(th?: ThermoInput | null): number | null {
  if (!th || !fin(th.t2mC) || !fin(th.td2mC)) return null;
  const g = fin(th.groundM) ? th.groundM : 0;
  return (g + clamp(lclHeightM(th.t2mC, th.td2mC), 300, 3500)) / 1000;
}

/**
 * 구름 하나(가운데 기둥)의 광학두께 범위 — WMO 종류별 단일 구름 관측 정리(Stephens 1978, Sassen & Comstock 2001, Heymsfield 2017,
 * Wood 2012 층적운). ISCCP 의 τ 구간(Cu < 3.6 등)은 화소 평균 분류라 여기 범위와 다릅니다. 단위 테스트와 RULER-physics.md 가 같은 표를 씁니다.
 */
export const TAU_RANGE: Partial<Record<GenusKey, [number, number]>> = {
  cu: [10, 300], sc: [5, 80], st: [5, 60], ac: [2, 20], as: [2, 40], ns: [40, 400], ci: [0.03, 3], cs: [0.1, 4], cbanvil: [1, 50],
};

/** 얼음 위 포화수증기압(hPa, Murphy & Koop 2005 근사). */
export function esatIce(tC: number): number {
  return 6.1115 * Math.exp((22.452 * tC) / (tC + 272.55));
}

/**
 * 구름 구성 입자 상태 벡터 및 연속 형태·수명·광학 산란 매개변수.
 * 날씨·구름 종류 분기가 아니라 기온·습도·강수량·풍속·연직 시어로부터
 * [작은 물방울, 큰 물방울, 빙정, 눈송이] 4개 입자군의 연속 비율과
 * 낙하 종단속도(v_t), 상이완 시정수(τ_p), 스펙트럼 가우시안 감쇠 길이(σ_b),
 * 경계 선명도 배율(edgeScale), 하단 낙하·승화 커튼 깊이(fallScaleM),
 * 광학 산란 특성(effectiveG, haloScale, powderScale, thruBoost, aoScale)을 유도합니다.
 */
export interface ParticleCloudState {
  /** 작은 구름 물방울 비율 (r ≈ 5~12 μm, v_t ≈ 0.01~0.05 m/s) */
  smallDropFrac: number;
  /** 큰 물방울·빗방울 비율 (r ≈ 50~500 μm, v_t ≈ 1~5 m/s) */
  largeDropFrac: number;
  /** 빙정 입자 비율 (r ≈ 20~80 μm, v_t ≈ 0.1~0.4 m/s) */
  iceCrystalFrac: number;
  /** 얼음에서 응집·부착 성장한 눈송이 입자 비율 (r ≈ 300~2000 μm, v_t ≈ 0.8~1.5 m/s) */
  snowFlakeFrac: number;
  /** 대표 낙하 종단 속도 v_t (m/s) */
  terminalVelMps: number;
  /** 상이완(증발·승화) 시간 척도 배율 (물방울 1.0 → 빙정·눈송이 최대 3.5) */
  phaseTauScale: number;
  /** 푸리에 수분 스펙트럼 가우시안 저역통과 감쇠 길이 σ_b (km, 0 ~ 1.6) */
  spectralSigmaKm: number;
  /** 셰이더 경계 기울기(edge / flowEdge) 배율 (0.38 ~ 1.15) */
  edgeScale: number;
  /** 구름 밑면 아래 낙하·승화 커튼 깊이 L_fall (m, 0 ~ 750) */
  fallScaleM: number;
  /** 저층 대기 눈·빙정 산란 연무 가중치 (0 ~ 1) */
  snowHazeWeight: number;
  /** 입자 상이완·낙하·난류 혼합이 결합된 연속 구름 수명 주기도 τ_life (초, 900 ~ 4800, 300초 단위 양자화) */
  lifeSec: number;
  /** 바람결·낙하 가닥(flowWisp) 보강량 (0 ~ 0.45) */
  wispBoost: number;
  /** 날카로운 Worley 가장자리 침식(flowCarve) 감쇠 배율 (0.25 ~ 1.0, 눈·빙정에서 부드럽게 퍼짐) */
  carveScale: number;
  /** 연직 시어 낙하 꼬리 기울임(flowTilt) 보강량 (0 ~ 0.65) */
  tiltBoost: number;
  /** 입자군 가중 유효 비대칭 산란 인자 g_eff (0.73 ~ 0.88) */
  effectiveG: number;
  /** 순수 육각 빙정 대비 응집 눈송이 혼합에 따른 22°·46° 햇무리 유효 비율 (0 ~ 1) */
  haloScale: number;
  /** 가루 효과(takram powder) 가중치 (작은 물방울 1.0 → 눈송이·빙정 0.22로 감쇠해 포근한 회백색 확산) */
  powderScale: number;
  /** 다중 산란 확산 투과(genusThru) 연속 보강량 (0 ~ 0.85) */
  thruBoost: number;
  /** 하늘빛 가림(genusAO) 완화 배율 (0.55 ~ 1.0) */
  aoScale: number;
  /** 과포화·강수 입자 성장에 따른 구름 내부 최소 응결 바닥 부스트 (0 ~ 0.38) */
  satFloor: number;
}

export function particleCloudState(input: {
  tCloudC: number;
  t2mC?: number;
  rhPct: number;
  precipMm: number;
  windSpeedMps: number;
  shearPerSec?: number;
  freezingLevelM?: number;
  cloudBaseM?: number;
}): ParticleCloudState {
  const tC = Number.isFinite(input.tCloudC) ? input.tCloudC : 5;
  const tSurf = input.t2mC != null && Number.isFinite(input.t2mC) ? input.t2mC : tC + 6;
  const rh = clamp(Number.isFinite(input.rhPct) ? input.rhPct : 75, 10, 100);
  const precip = Math.max(0, Number.isFinite(input.precipMm) ? input.precipMm : 0);
  const wind = Math.max(0, Number.isFinite(input.windSpeedMps) ? input.windSpeedMps : 3);
  const shear = Math.max(0, Number.isFinite(input.shearPerSec) ? input.shearPerSec! : 0.002);

  // 1) 혼합상 얼음 비율 f_ice(T) 및 베르게론-핀데어젠(WBF) 얼음 과포화 성장 구동력
  const fIce = iceFraction(tC);
  const esW = esatWater(tC);
  const esI = tC < 0 ? esatIce(tC) : esW;
  const sIce = tC < 0 ? Math.max(0, (rh / 100) * (esW / Math.max(1e-4, esI)) - 1) : 0;
  const wbfPeak = tC < 0 ? Math.exp(-0.5 * Math.pow((tC + 14) / 6.5, 2)) : 0;

  // 2) 액체상 내 작은 물방울 vs 충돌·병합 큰 물방울 비율
  const coalDrive = clamp((rh - 78) / 22, 0, 1) * 0.35 + clamp(precip / 1.5, 0, 1) * 0.65;
  const liqTotal = 1 - fIce;
  const largeDropFrac = liqTotal * clamp(coalDrive, 0, 0.85);
  const smallDropFrac = Math.max(0, liqTotal - largeDropFrac);

  // 3) 빙정 vs 눈송이(응집·림 성장) 비율 — 지상 기온·영하고도가 낮고 강수·과포화가 있을수록 눈송이 우세
  const coldColumn = clamp((2.5 - tSurf) / 5.5, 0, 1);
  const aggDrive = clamp(
    sIce * 1.4 + wbfPeak * (0.35 + 0.45 * clamp(rh / 100, 0, 1)) + clamp(precip / 0.6, 0, 1) * (0.45 + 0.55 * coldColumn),
    0,
    0.92,
  );
  const snowFromSurface = coldColumn * clamp(precip / 0.4, 0, 1) * 0.65;
  const effectiveIce = clamp(Math.max(fIce, snowFromSurface), 0, 1);
  const snowFlakeFrac = effectiveIce * aggDrive;
  const iceCrystalFrac = Math.max(0, effectiveIce - snowFlakeFrac);

  const sum = Math.max(1e-6, smallDropFrac + largeDropFrac + iceCrystalFrac + snowFlakeFrac);
  const pSmall = smallDropFrac / sum;
  const pLarge = largeDropFrac / sum;
  const pIce = iceCrystalFrac / sum;
  const pSnow = snowFlakeFrac / sum;

  // 4) 입자군별 물리 특성 합성
  const terminalVelMps = pSmall * 0.03 + pIce * 0.28 + pSnow * 1.15 + pLarge * 3.4;
  const subSat = Math.max(0.03, 1 - rh / 100);
  const phaseTauScale = (pSmall * 0.25 + pLarge * 0.9 + pIce * 2.1 + pSnow * 3.2) * clamp(0.12 / subSat, 0.5, 2.2);

  // 5) 푸리에 스펙트럼 가우시안 감쇠 길이 σ_b (km)
  const windDiff = clamp(wind / 14, 0, 1);
  const iceSnowMix = pIce * 0.65 + pSnow * 1.0;
  const spectralSigmaKm = clamp(
    iceSnowMix * (0.55 + 0.65 * windDiff + 0.35 * clamp((rh - 70) / 30, 0, 1)) + pLarge * 0.22 * windDiff,
    0,
    1.6,
  );

  // 6) 셰이더 경계 기울기 배율 (edgeScale)
  const sharpBoost = pSmall * clamp((75 - rh) / 35, 0, 1) * 0.14;
  const blurDrop = iceSnowMix * (0.42 + 0.18 * windDiff) + pLarge * 0.16;
  const edgeScale = clamp(1 + sharpBoost - blurDrop, 0.38, 1.14);

  // 7) 하단 낙하·승화 커튼 깊이 L_fall (m)
  const fallRaw = (pSnow * 520 + pIce * 220 + pLarge * 340) * clamp(phaseTauScale / 1.8, 0.4, 1.5) * (0.75 + 0.35 * windDiff);
  const fallScaleM = Math.round(clamp(fallRaw, 0, 750));

  const snowHazeWeight = clamp(pSnow * 1.15 + pIce * 0.45 * coldColumn, 0, 1);

  // 8) 입자군별 연속 구름 수명 τ_life = (τ_evap⁻¹ + 0.35·τ_fall⁻¹ + 0.55·τ_mix⁻¹)⁻¹
  //  - 작은 물방울 + 건조 + 강풍: 빠른 증발·난류 혼합으로 수명 단축 (15~25분)
  //  - 빙정·눈송이 + 높은 얼음 과포화: 느린 승화로 수명 연장 (45~80분), 큰 빗방울은 낙하 침강으로 수명 제한
  const tauEvapSec = 1800 * clamp(phaseTauScale, 0.45, 3.2);
  const tauFallSec = 1000 / Math.max(0.08, terminalVelMps);
  const tauMixSec = 2600 / (0.6 + 0.9 * windDiff + 80 * shear);
  const invLife = 1 / tauEvapSec + 0.35 / Math.max(450, tauFallSec) + 0.55 / Math.max(600, tauMixSec);
  const lifeSec = Math.round(clamp(1 / invLife, 900, 4800) / 300) * 300;

  // 9) 셰이더 미세 결·낙하 꼬리 매개변수
  //  - 눈송이·빙정이 바람과 시어를 타면 둥근 Worley 세포(flowCarve)는 무뎌지고 바람 방향 낙하 가닥(wisp)과 기울임(tilt)이 살아납니다.
  const wispBoost = Math.round(clamp(iceSnowMix * (0.22 + 0.23 * windDiff) + pLarge * 0.12 * windDiff, 0, 0.45) * 20) / 20;
  const carveScale = Math.round(clamp(1 - iceSnowMix * 0.68 - pLarge * 0.25, 0.25, 1.0) * 20) / 20;
  const tiltBoost = Math.round(clamp((iceSnowMix * 0.45 + pLarge * 0.30) * (0.5 + 0.5 * clamp(shear / 0.004, 0, 1.5)), 0, 0.65) * 20) / 20;

  // 10) 입자 종류별 광학 산란 특성
  //  - 작은 물방울(g=0.85), 큰 물방울(g=0.88), 육각 빙정(g=0.77, 22° 햇무리 선명), 응집 눈송이(g=0.73, 내부 다중 반사로 무리 소멸 및 등방 산란 증가)
  const effectiveG = Math.round((pSmall * 0.85 + pLarge * 0.88 + pIce * 0.77 + pSnow * 0.73) * 1000) / 1000;
  const haloScale = Math.round(clamp(pIce / Math.max(1e-4, pIce + 1.6 * pSnow), 0, 1) * 20) / 20;
  const powderScale = Math.round(clamp(1 - pSnow * 0.72 - pIce * 0.55 - pLarge * 0.18, 0.22, 1.0) * 20) / 20;
  const thruBoost = Math.round(clamp(pSnow * 0.75 + pIce * 0.35 + pLarge * 0.25, 0, 0.85) * 20) / 20;
  const aoScale = Math.round(clamp(1 - pSnow * 0.35 - pIce * 0.20, 0.55, 1.0) * 20) / 20;
  const rhSat = clamp((rh - 72) / 26, 0, 1);
  const satFloor = Math.round(clamp((0.28 * (pLarge + pSnow) + 0.16 * rhSat * (0.4 + 0.6 * (pLarge + pSnow + pIce))) * (0.5 + 0.5 * rhSat), 0, 0.38) * 20) / 20;

  return {
    smallDropFrac: pSmall,
    largeDropFrac: pLarge,
    iceCrystalFrac: pIce,
    snowFlakeFrac: pSnow,
    terminalVelMps,
    phaseTauScale,
    spectralSigmaKm: Math.round(spectralSigmaKm * 20) / 20,
    edgeScale: Math.round(edgeScale * 20) / 20,
    fallScaleM,
    snowHazeWeight,
    lifeSec,
    wispBoost,
    carveScale,
    tiltBoost,
    effectiveG,
    haloScale,
    powderScale,
    thruBoost,
    aoScale,
    satFloor,
  };
}
