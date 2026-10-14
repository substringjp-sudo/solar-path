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
 *  - 얼음: 권운 IWC(T) = 10^(−2 + 0.05(Tc + 40)) g/m³ (Krämer 2016 중앙값 근처), r_eff,ice(T) = 20 + (Tc + 60) μm,
 *    β = 1.5 · IWC / (ρi · r_eff,ice). 혼합상: 얼음 비율 f(T) = 1 − ((Tc + 23)/23)² (ECMWF IFS, 0 ~ −23 °C).
 *
 * 렌더(takram)에서 층 밀도 = 날씨 밀도(0~1, 모양 잡음으로 깎임) × densityScale × densityProfile(hf). 그래서
 * densityScale = 층 꼭대기(hf = 1)의 β, densityProfile = h^(2/3) 를 takram 꼴 −A·e^(−k·hf) + b·hf + A 로 맞춘 것
 * (RMS 0.008) — 날씨 밀도 1 인 기둥의 광학두께가 0.6 · β_top · H 입니다. 모양 잡음의 깎임이 혼입(덜 찬 가장자리)을 맡습니다.
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

/** 물방울 유효 반지름(m) — LWC(kg/m³), 수 농도 N(1/m³), k = 0.8 → 1.08. */
export function effRadiusLiquid(lwc: number, nPerM3: number): number {
  return 1.08 * Math.cbrt((3 * Math.max(lwc, 0)) / (4 * Math.PI * RHO_W * nPerM3));
}
export function betaLiquid(lwc: number, reffM: number): number {
  return reffM > 0 ? (1.5 * lwc) / (RHO_W * reffM) : 0;
}
/** 권운 얼음수 함량(kg/m³) — 10^(−2 + 0.05(Tc + 40)) g/m³, 0.1 mg/m³ ~ 0.05 g/m³ 로 자름. */
export function iceWaterContent(tC: number): number {
  return clamp(Math.pow(10, -2 + 0.05 * (tC + 40)), 1e-4, 0.05) * 1e-3;
}
/** 얼음 유효 반지름(m) — 20 + (Tc + 60) μm, 15 ~ 60 μm. */
export function effRadiusIce(tC: number): number {
  return clamp(20 + (tC + 60), 15, 60) * 1e-6;
}
export function betaIce(iwc: number, reffM: number): number {
  return reffM > 0 ? (1.5 * iwc) / (RHO_I * reffM) : 0;
}
/** 혼합상 얼음 질량 비율(ECMWF IFS): 0 °C 위 0, −23 °C 아래 1. */
export function iceFraction(tC: number): number {
  if (tC >= 0) return 0;
  if (tC <= -23) return 1;
  const x = (tC + 23) / 23;
  return 1 - x * x;
}

/**
 * 종류별 미세물리 가정. phase: liquid = 물(고적운 같은 과냉각 물 구름 포함 — −20 °C 아래에서 얼기 시작해 −38 °C 에 다 얾),
 * mixed = 단열 응결량을 얼음 비율 f(T, 층 3/4 높이)로 물·얼음에 나눔, ice = 권운 IWC(T).
 * fAd: 단열 대비 실제 LWC(Warner 1955·Brenguier 2000 범위의 중간), nCm3: 동아시아 대륙성 쪽 중간값, halo: 22° 무리 세기(0~1).
 * iwcScale: 권운 IWC(T) 배율 — 권층운 1.5(고르고 두꺼움), 적란운 모루 30(대류 코어 근처 0.05~0.5 g/m³, Heymsfield).
 */
export interface GenusMicro { phase: 'liquid' | 'mixed' | 'ice'; fAd: number; nCm3: number; iwcScale?: number; halo: number; profile: 'adiabatic' | 'flat' }
export const GENUS_MICRO: Record<GenusKey, GenusMicro> = {
  cu: { phase: 'liquid', fAd: 0.5, nCm3: 400, halo: 0, profile: 'adiabatic' },
  cg: { phase: 'mixed', fAd: 0.4, nCm3: 400, halo: 0, profile: 'adiabatic' },
  cb: { phase: 'mixed', fAd: 0.3, nCm3: 400, halo: 0, profile: 'adiabatic' },
  cbanvil: { phase: 'ice', fAd: 0, nCm3: 0, iwcScale: 30, halo: 0.3, profile: 'flat' },
  sc: { phase: 'liquid', fAd: 0.8, nCm3: 250, halo: 0, profile: 'adiabatic' },
  st: { phase: 'liquid', fAd: 0.8, nCm3: 200, halo: 0, profile: 'adiabatic' },
  ns: { phase: 'mixed', fAd: 0.15, nCm3: 150, halo: 0, profile: 'adiabatic' },
  ac: { phase: 'liquid', fAd: 0.7, nCm3: 150, halo: 0, profile: 'adiabatic' },
  as: { phase: 'mixed', fAd: 0.2, nCm3: 100, halo: 0, profile: 'adiabatic' },
  ci: { phase: 'ice', fAd: 0, nCm3: 0, iwcScale: 1, halo: 0.5, profile: 'flat' },
  cs: { phase: 'ice', fAd: 0, nCm3: 0, iwcScale: 1.5, halo: 1, profile: 'flat' },
};

/** h^(2/3) 를 takram DensityProfile 꼴 −A·e^(−k·hf) + b·hf + A 로 맞춘 값(hf = 1 에서 1, RMS 0.008). */
export const ADIABATIC_PROFILE = { A: 0.2795, k: 6.56, b: 0.7209 };

/** 열역학 입력 — 관측점 예보(CloudData)에서 옮겨 담습니다. 빈 값은 NaN/undefined. */
export interface ThermoInput {
  /** 관측점 지면 높이(m, 해발) */
  groundM?: number;
  t2mC?: number;
  td2mC?: number;
  /** 기압면 단면(높이 m 해발 · 기온 °C · 기압 hPa) — 높이 순서 무관 */
  levels?: { zM: number; tC: number; pHPa: number }[];
}

/** 해발 zM 의 기온·기압 — 단면이 있으면 그 사이를 보간(기온 선형, 기압 로그), 없으면 지상 기온 + 6.5 K/km, 둘 다 없으면 표준대기. */
export function thermoAt(zM: number, th?: ThermoInput | null): { tC: number; pHPa: number; source: 'profile' | 'surface' | 'standard' } {
  const lv0 = (th?.levels ?? []).filter(l => Number.isFinite(l.zM) && Number.isFinite(l.tC) && Number.isFinite(l.pHPa)).sort((a, b) => a.zM - b.zM);
  if (lv0.length >= 2 && zM >= lv0[0].zM - 500 && zM <= lv0[lv0.length - 1].zM + 500) {
    let i = 0;
    while (i < lv0.length - 2 && zM > lv0[i + 1].zM) i++;
    const a = lv0[i], b = lv0[i + 1], f = (zM - a.zM) / Math.max(1, b.zM - a.zM);
    return { tC: a.tC + (b.tC - a.tC) * f, pHPa: Math.exp(Math.log(a.pHPa) + (Math.log(b.pHPa) - Math.log(a.pHPa)) * f), source: 'profile' };
  }
  const g = th?.groundM ?? 0;
  if (th && Number.isFinite(th.t2mC)) {
    // 지상 기온을 해수면으로 내려 표준대기에 넣음(기압도 같은 식)
    const s = standardAtmosphere(zM, (th.t2mC as number) + 0.0065 * Math.max(0, g));
    return { ...s, source: 'surface' };
  }
  return { ...standardAtmosphere(zM), source: 'standard' };
}

export interface LayerPhysics {
  /** 층 꼭대기(hf = 1) 소광(1/m) — CloudLayer.densityScale */
  betaTop: number;
  /** takram DensityProfile(expTerm, exponent, linearTerm, constantTerm) — hf = 1 에서 1 */
  profile: [number, number, number, number];
  /** 날씨 밀도 1 인 기둥의 광학두께 ∫β dz */
  tauCore: number;
  /** 광학적 얼음 비율(β_ice / β, 층 꼭대기) — 산란 위상 레인 */
  iceOptical: number;
  /** 22° 무리 세기(0~1) = 종류 무리 × 광학적 얼음 비율 */
  halo: number;
  /** 가루 효과(takram powder) 무게 — 얇은 층(광학두께 1 아래)은 0, 5 위는 1 */
  powder: number;
  /** 진단 */
  tBaseC: number; tTopC: number; pBaseHPa: number; lwcTop: number; iwcTop: number; reffLiqUm: number; reffIceUm: number;
  source: 'profile' | 'surface' | 'standard';
}

const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/**
 * 층 하나의 미세물리. baseM = 밑면 해발(m), heightM = 층 두께(m, 렌더 층 그대로).
 */
export function layerPhysics(genus: GenusKey, baseM: number, heightM: number, th?: ThermoInput | null): LayerPhysics {
  const m = GENUS_MICRO[genus];
  const H = Math.max(50, heightM);
  const base = thermoAt(baseM, th);
  const top = adiabaticLWC(base.tC, base.pHPa, H);
  const tTop = thermoAt(baseM + H, th).tC;
  let lwc = 0, iwc = 0, rl = 0, ri = 0, bl = 0, bi = 0;
  if (m.phase === 'ice') {
    // 얼음 층은 층 가운데 기온의 IWC 를 고르게(평평한 단면)
    const tMid = thermoAt(baseM + H / 2, th).tC;
    iwc = iceWaterContent(tMid) * (m.iwcScale ?? 1);
    ri = effRadiusIce(tMid);
    bi = betaIce(iwc, ri);
  } else {
    const cond = m.fAd * top.lwc;
    const tF = thermoAt(baseM + 0.75 * H, th).tC;
    const f = m.phase === 'mixed' ? iceFraction(tF) : clamp((-20 - tTop) / 18, 0, 1);
    lwc = (1 - f) * cond;
    iwc = f * cond;
    rl = effRadiusLiquid(lwc, m.nCm3 * 1e6);
    ri = effRadiusIce(tF);
    bl = betaLiquid(lwc, rl);
    bi = betaIce(iwc, ri);
  }
  const betaTop = bl + bi;
  const iceOptical = betaTop > 0 ? bi / betaTop : 0;
  const { A, k, b } = ADIABATIC_PROFILE;
  const profile: [number, number, number, number] = m.profile === 'flat' ? [0, 0, 0, 1] : [-A, -k, b, A];
  const meanShape = m.profile === 'flat' ? 1 : A * (1 - (1 - Math.exp(-k)) / k) + b / 2;
  const tauCore = betaTop * meanShape * H;
  return {
    betaTop, profile, tauCore, iceOptical,
    halo: m.halo * iceOptical,
    powder: smooth(1, 5, tauCore),
    tBaseC: base.tC, tTopC: tTop, pBaseHPa: base.pHPa, lwcTop: lwc, iwcTop: iwc,
    reffLiqUm: rl * 1e6, reffIceUm: ri * 1e6, source: base.source,
  };
}

/**
 * 적운류 밑면 = 지면 + 응결고도(§136). 지상 기온·이슬점이 없으면 null(예보 단면의 밑면을 그대로 씀). 0.3 ~ 3.5 km 로 자릅니다.
 */
export function lclBaseKm(th?: ThermoInput | null): number | null {
  if (!th || !Number.isFinite(th.t2mC) || !Number.isFinite(th.td2mC)) return null;
  const z = lclHeightM(th.t2mC as number, th.td2mC as number);
  return clamp(((th.groundM ?? 0) + z) / 1000, ((th.groundM ?? 0) + 300) / 1000, 3.5);
}

/**
 * 문헌 광학두께 범위(구름 하나의 가운데 기둥) — 단위 테스트와 RULER-physics.md 가 같은 표를 씁니다.
 * Cu 10–300(맑은 날 적운 ~ 웅대), Sc 5–80, St 5–60, Ac 2–20, As 2–40, Ns 40–400, Ci 0.03–3, Cs 0.1–4, 모루 1–50.
 * (Stephens 1978, Rossow & Schiffer 1999 ISCCP 구분, Sassen & Comstock 2001, Heymsfield 2017 정리.)
 */
export const TAU_RANGE: Partial<Record<GenusKey, [number, number]>> = {
  cu: [10, 300], sc: [5, 80], st: [5, 60], ac: [2, 20], as: [2, 40], ns: [40, 400], ci: [0.03, 3], cs: [0.1, 4], cbanvil: [1, 50],
};
