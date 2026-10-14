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

const G = 9.80665, RD = 287.05, CP = 1004.6, EPS = 0.622, RHO_W = 1000, RHO_I = 917;
const GAMMA_D = G / CP;
const lv = (tC: number) => 2.501e6 - 2370 * tC;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
  if (e.mode >= 0.5) hs = 1 - Math.pow(Math.max(Math.abs(hf * 2 - 1), 1e-6), Math.max(e.top, 1e-3));
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
  return {
    betaTop, profile, tauCore, tauRendered, iceOptical,
    halo: m.halo * iceOptical,
    powder: smooth(1, 5, tauRendered),
    tBaseC: base.tC, tTopC: tTop, pBaseHPa: base.pHPa, lwcTop, iwcTop,
    reffLiqUm: rlTop * 1e6, reffIceUm: riTop * 1e6, source: base.source,
  };
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
