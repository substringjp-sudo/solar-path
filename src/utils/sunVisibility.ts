/**
 * sunVisibility.ts — 태양 원반이 **얼마나 또렷이 보이는가**의 물리 (문서 §151).
 *
 * 같은 연무라도 어떤 날은 원반이 선명한 주황 공으로 보이고 어떤 날은 번짐에 묻힙니다. 그 갈림은 세 양으로 정해집니다.
 *
 * ① 원반 휘도 L_d = L0·T      (L0 = E0/Ω ≈ 2×10⁹ cd/m², T = exp(−τ_ext)).
 *    눈으로 편히 보려면 L_d 가 약 10⁵~10⁶ cd/m² 아래여야 합니다. 그보다 밝으면 눈 안 산란(Stiles–Holladay 눈부심 막 10E/θ²)과
 *    카메라 블룸이 원반 경계를 지워 "빛나는 별"이 됩니다 → 높은 해·맑은 날에 원반이 안 보이는 까닭.
 * ② 원반과 둘레의 대비 R = L_d / (L_aur + L_diff).
 *    해를 바라보는 시선의 단일산란 둘레빛은 균질층에서 L_aur(θ) = E0·e^(−τ)·Σ τ_s,i·P_i(θ) 입니다.
 *    (해 쪽으로 본 광로에서 직달 감쇠와 시선 감쇠가 곱해져 e^(−s)·e^(−(τ−s)) = e^(−τ) 로 상쇄) 그러면 원반 대 둘레빛의 비는
 *    L_d/L_aur = 1/(Ω·τ_s·P(θ)) — T 에는 안 달려 있고 **산란 광학두께와 앞산란 위상함수**로만 정해집니다. 입자가 크고(앞산란 P 가 큼)
 *    산란이 많을수록(τ_s) 원반이 둘레빛에 묻힙니다. 여기에 다중산란으로 채워진 확산 하늘빛 L_diff 가 더해집니다.
 *    시각 문턱: Weber 대비 (L_d−L_b)/L_b ≳ 2 → R ≳ 3 에서 보이기 시작, R ≳ 30 이면 뚜렷.
 * ③ 경계 흐림 — 원반 둘레의 앞산란 비율이 크면(τ_a·m_a·ω 가 클 때) 경계가 번집니다.
 *
 * 시선 공기량 m 은 평면 대기 근사가 아니라 지수 대기(척도 높이 H)·곡률·굴절을 적분한 Chapman 함수입니다:
 *   m(h) = (1/H) ∫₀^∞ exp(−(r(s)−Re)/H) ds,  r(s) = √(Re² + s² + 2·Re·s·sin h),  Re = (R+z)/(1−k).
 * 에어로졸은 낮은 곳에 몰려(H≈1.5 km) 지평선 근처 공기량이 레일리(H≈8.4 km)보다 오히려 커서(수평선에서 약 29 대 25.5, 5° 에서 10.5 대 9.9),
 * 낮은 해에서 연무가 원반을 훨씬 세게 깎습니다.
 *
 * ⚠ 상수(눈부심 문턱 10⁵~3×10⁷ cd/m², 확산광 식, 앞산란 비율)는 문헌 수준의 추정이며 사진으로 맞춘 값이 아닙니다.
 */
const R_EARTH_KM = 6371;
/** 굴절을 담은 유효 지구 반지름 배율 (표준 굴절 계수 k ≈ 0.13) */
const REFRACTION_K = 0.13;
/** 태양 직달 조도(대기 밖, lux)와 원반 입체각(sr) → 원반 휘도 L0 */
const E0_LUX = 1.33e5;
const SUN_SOLID_ANGLE = Math.PI * Math.pow((0.267 * Math.PI) / 180, 2);
export const SUN_L0_CDM2 = E0_LUX / SUN_SOLID_ANGLE;   // ≈ 2.0e9
const H_RAY_KM = 8.4;
export const H_AER_KM = 1.5;
const TAU_RAY_550 = 0.0973;
const TAU_OZONE_550 = 0.03;
const EDGE_DEG = 0.3;                                    // 원반 가장자리 바로 바깥

/** 지수 대기의 시선 공기량(Chapman 함수 수치적분). 겉보기 고도 apparentAltDeg, 관측점 해발 elevM. 수직(90°)에서 1. */
export function chapmanAirmass(scaleHeightKm: number, apparentAltDeg: number, elevM = 0): number {
  const h = Math.max(-1, Math.min(90, apparentAltDeg));
  const sinH = Math.sin((h * Math.PI) / 180);
  const Re = ((R_EARTH_KM + elevM / 1000) / (1 - REFRACTION_K));
  const H = scaleHeightKm;
  // s = H·u² 로 치환해 위쪽 꼬리를 성기게(du 균일). 15H 에서 지수가 e^-15 로 충분히 작음.
  const U = Math.sqrt(30);
  const N = 480;
  let sum = 0, prev = 0;
  for (let i = 0; i <= N; i++) {
    const u = (U * i) / N;
    const s = H * u * u;
    const r = Math.sqrt(Re * Re + s * s + 2 * Re * s * sinH);
    const f = Math.exp(-(r - Re) / H) * 2 * H * u / H;   // ds = 2·H·u du, 1/H 곱
    if (i > 0) sum += 0.5 * (f + prev) * (U / N);
    prev = f;
  }
  return sum;
}

/** Henyey–Greenstein 위상함수 (sr⁻¹) */
const hg = (g: number, cosT: number) => (1 - g * g) / (4 * Math.PI * Math.pow(Math.max(1 + g * g - 2 * g * cosT, 1e-9), 1.5));

export interface AerosolOptics {
  /** 550nm 광학두께(전체) */
  aod: number;
  /** Ångström 지수 */
  alpha: number;
  /** 비대칭도(앞산란) */
  g: number;
  /** 단일산란 반사율 */
  omega: number;
}

export interface SunVisibility {
  tauRay: number; tauAer: number; tauTotal: number;
  /** 550nm 직달 투과율 */
  transmittance: number;
  /** 원반 휘도(cd/m²) */
  discLum: number;
  /** 원반 가장자리 바로 바깥 단일산란 둘레빛·확산 하늘빛(cd/m²) */
  aureoleLum: number; diffuseLum: number;
  /** 원반 대 둘레 대비 R = L_d / (L_aur + L_diff) */
  contrast: number;
  /** 눈부심 0(편안)~1(경계가 지워지는 눈부심) */
  dazzle: number;
  /** 둘레에 묻힘 정도의 반대: 0(묻힘)~1(뚜렷) */
  distinct: number;
  /** 경계 흐림 0~1 (원반 둘레 앞산란 비율) */
  edgeBlur: number;
  /** 셰이더용: 둘레빛 / 원반 (≤ 1) */
  aureoleRel: number;
  /** 셰이더용: 눈부심 계수(원반 대비, r⁻² 꼬리 앞 계수) */
  glareGain: number;
}

const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const cache = new Map<string, SunVisibility>();

export function sunVisibility(apparentAltDeg: number, observerElevM: number, a: AerosolOptics): SunVisibility {
  const key = [apparentAltDeg.toFixed(2), Math.round(observerElevM / 50), a.aod.toFixed(3), a.g.toFixed(2), a.omega.toFixed(2)].join('|');
  const hit = cache.get(key); if (hit) return hit;
  const zKm = observerElevM / 1000;
  const mR = chapmanAirmass(H_RAY_KM, apparentAltDeg, observerElevM);
  const mA = chapmanAirmass(H_AER_KM, apparentAltDeg, observerElevM);
  const tauRayV = TAU_RAY_550 * Math.exp(-zKm / H_RAY_KM);
  const tauAerV = a.aod * Math.exp(-zKm / H_AER_KM);
  const tauRay = (tauRayV + TAU_OZONE_550) * mR;
  const tauAer = tauAerV * mA;
  const tauTotal = tauRay + tauAer;
  const T = Math.exp(-tauTotal);
  const discLum = SUN_L0_CDM2 * T;

  // 단일산란 둘레빛 (시선이 해 쪽): L = E0·e^(−τ)·(ω·τ_a·m_a·P_a + τ_r·m_r·P_r)
  const cosT = Math.cos((EDGE_DEG * Math.PI) / 180);
  const Pa = 0.9 * hg(a.g, cosT) + 0.1 * hg(Math.min(0.985, a.g + 0.27), cosT);   // 본체 + 회절 봉우리
  const Pr = (3 / (16 * Math.PI)) * (1 + cosT * cosT);
  const aureoleLum = E0_LUX * T * (a.omega * tauAer * Pa + tauRayV * mR * Pr);
  // 다중산란 확산 하늘빛 (추정): 수평면 확산 조도 ≈ E0·sin h·½·ω·(1−e^(−τ_수직)), 해 근처 하늘은 평균의 약 1.5배
  const tauV = tauRayV + tauAerV;
  const sinH = Math.max(Math.sin((Math.max(apparentAltDeg, 0) * Math.PI) / 180), 0.05);
  const eDiff = E0_LUX * sinH * 0.5 * a.omega * (1 - Math.exp(-tauV));
  const diffuseLum = (1.5 * eDiff) / Math.PI;
  const contrast = discLum / (aureoleLum + diffuseLum);

  const logL = Math.log10(Math.max(discLum, 1));
  const dazzle = sstep(5.0, 7.5, logL);
  const distinct = sstep(Math.log10(2), Math.log10(30), contrast);
  const fwd = 1 - Math.exp(-0.08 * a.omega * tauAer);
  const out: SunVisibility = {
    tauRay, tauAer, tauTotal, transmittance: T, discLum, aureoleLum, diffuseLum, contrast, dazzle, distinct,
    edgeBlur: Math.min(1, fwd * 1.5),
    aureoleRel: Math.min(1, 1 / Math.max(contrast, 1)),
    glareGain: 5 * dazzle,
  };
  if (cache.size > 64) cache.clear();
  cache.set(key, out);
  return out;
}

/**
 * 예보 한 시각의 에어로졸 → 광학 입력. AOD(CAMS)가 있으면 그것, 없으면 PM(0.012·PM2.5 + 0.004·(PM10−PM2.5)),
 * 그것도 없으면 시정(3.912/vis·1.5 km). 초미세 비중 f 가 크면 Ångström 가 크고 앞산란이 약하며, 먼지·조대 입자가 많으면 반대.
 * 모르면 null.
 */
export function aerosolOpticsFromObs(o: { aod550?: number; pm25?: number; pm10?: number; dust?: number; visibility?: number }): AerosolOptics | null {
  const ok = (v: number | undefined): v is number => v != null && Number.isFinite(v) && v >= 0;
  let aod: number | null = null;
  if (ok(o.aod550)) aod = o.aod550;
  else if (ok(o.pm25) || ok(o.pm10)) aod = (o.pm25 ?? 0) * 0.012 + Math.max(0, (o.pm10 ?? 0) - (o.pm25 ?? 0)) * 0.004;
  else if (ok(o.visibility) && o.visibility > 0 && o.visibility < 30000) aod = (3.912 / (o.visibility / 1000)) * 1.5;
  if (aod == null) return null;
  const fine = ok(o.pm25) && ok(o.pm10) && o.pm10 > 0 ? Math.min(1, o.pm25 / o.pm10) : 0.6;
  const dustShare = ok(o.dust) && ok(o.pm10) && o.pm10 > 0 ? Math.min(1, o.dust / o.pm10) : 0;
  const f = fine * (1 - dustShare);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return { aod, alpha: clamp(0.3 + 1.1 * f, 0.3, 1.6), g: 0.62 + 0.18 * (1 - f), omega: 0.93 + 0.05 * (1 - f) };
}
