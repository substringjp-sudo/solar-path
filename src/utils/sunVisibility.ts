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


// ── 분광 투과율 → 원반 색 ────────────────────────────────────────────────────────
// 원반 스펙트럼 = 태양(5772 K 흑체) × T(λ), T(λ) = exp(−[(τ_R(λ)+τ_oz(λ))·m_R + τ_a(λ)·m_a]).
//   τ_R(λ) = 0.0973·(λ/550)^−4.05 (레일리), τ_a(λ) = AOD·(λ/550)^−α (Ångström), 오존 샤퓌 흡수대(600 nm 중심, 300 DU 에서 최대 0.045).
// CIE 등색 함수(Wyman 외 2013 다중 가우스 근사)로 XYZ → 선형 sRGB, 대기가 없을 때(T=1)의 색을 흰색으로 맞춘 뒤(폰 크리스 식 순응) 최댓값 1 로 정규화.
// 해가 낮아질수록 파장이 짧은 쪽부터 사라져 흰 → 노랑 → 주황 → 붉은색으로 가고, 연무(Ångström α 가 작은 조대 입자는 덜 붉게)와 해 고도에 따라 달라짐.
const WL = Array.from({ length: 17 }, (_, i) => 380 + i * 20);
const planck = (nm: number) => { const l = nm * 1e-9; return Math.pow(l, -5) / (Math.exp(1.4388e-2 / (l * 5772)) - 1); };
const lobe = (l: number, mu: number, s1: number, s2: number) => { const t = (l - mu) / (l < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };
const cieX = (l: number) => 1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2);
const cieY = (l: number) => 0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1);
const cieZ = (l: number) => 1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8);
const SUN_SPEC = WL.map(planck);
function spectrumToLinearRgb(trans: (nm: number) => number): { r: number; g: number; b: number; Y: number } {
  let X = 0, Y = 0, Z = 0;
  WL.forEach((l, i) => { const w = SUN_SPEC[i] * trans(l); X += w * cieX(l); Y += w * cieY(l); Z += w * cieZ(l); });
  return { r: 3.2406 * X - 1.5372 * Y - 0.4986 * Z, g: -0.9689 * X + 1.8758 * Y + 0.0415 * Z, b: 0.0557 * X - 0.2040 * Y + 1.0570 * Z, Y };
}
const WHITE = spectrumToLinearRgb(() => 1);
const ozoneTau = (nm: number) => 0.045 * Math.exp(-0.5 * Math.pow((nm - 600) / 55, 2));

export interface SunDiscSpectrum {
  /** 최댓값 1 로 정규화한 선형 sRGB 색(대기 밖 태양 = 흰색 기준) */
  rgb: { r: number; g: number; b: number };
  /** 휘도 투과율 T_Y = Y(T)/Y(1) */
  transmittanceY: number;
}
export function sunDiscSpectrum(mR: number, mA: number, tauRayV: number, tauAerV: number, alpha: number): SunDiscSpectrum {
  const c = spectrumToLinearRgb(nm => Math.exp(-((tauRayV * Math.pow(nm / 550, -4.05) + ozoneTau(nm)) * mR + tauAerV * Math.pow(nm / 550, -alpha) * mA)));
  const rel = [Math.max(0, c.r / WHITE.r), Math.max(0, c.g / WHITE.g), Math.max(0, c.b / WHITE.b)];
  const mx = Math.max(rel[0], rel[1], rel[2], 1e-30);
  return { rgb: { r: rel[0] / mx, g: rel[1] / mx, b: rel[2] / mx }, transmittanceY: c.Y / WHITE.Y };
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
  /** 원반 색(최댓값 1 선형 sRGB, 분광 모형) */
  rgb: { r: number; g: number; b: number };
  /** 표시 단계 색(최댓값 1)에 곱할 배율(노출 적용 후, ACES 입력) — 목표 휘도 ÷ 색의 휘도. 눈부신 흰색 ↔ 어두운 주황·붉은색 */
  displayPeak: number;
}

const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * 표시 단계(노출 적용 후) 목표 밝기: 원반 **휘도**(색 채널 최댓값이 아니라)를 L_d 의 0.2 제곱으로 압축해 맞춥니다 —
 * 최댓값 기준이면 낮은 해의 초록 채널까지 밝아져 톤매핑에서 노랗게 떠 버립니다(붉은 원반 → 노란 원반). 휘도 기준이면 붉은 색은
 * 붉은 채널만 밝게, 초록·파랑은 물리 비율대로 어둡게 남습니다. 계수 0.22 는 ACES 톤매핑(밝은 붉은색이 주황·노랑으로 밀림)과 sRGB 인코딩을
 * 거친 뒤에도 지평선 원반이 붉은 주황으로 남도록 렌더로 고른 값(0.5 에서는 노란색). 눈부신 영역(L_d ≳ 5×10⁷)은 별도로 올려 흰색으로 날립니다.
 *   Y_t = 0.22·(L_d/10⁶)^0.2 · (1 + 8·sstep(log₁₀L_d; 7.7, 9.0)),  peak = Y_t / Y(rgb)
 */
function displayPeakFor(discLum: number, rgb: { r: number; g: number; b: number }): number {
  const logL = Math.log10(Math.max(discLum, 1));
  const yt = Math.max(0.03, 0.22 * Math.pow(discLum / 1e6, 0.2)) * (1 + 8 * sstep(7.7, 9.0, logL));
  const yRgb = Math.max(0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b, 1e-3);
  return Math.min(80, yt / yRgb);
}

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
  const tauTotal = tauRay + tauAer;   // 550 nm 소광 광학두께(참고·진단용)
  const spec = sunDiscSpectrum(mR, mA, tauRayV, tauAerV, a.alpha);
  const T = spec.transmittanceY;   // 휘도 투과율(분광 적분). 550 nm 값 exp(−τ_ext) 와 가깝지만 붉은 쪽이 더 살아 있어 약간 큼
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
    rgb: spec.rgb,
    displayPeak: displayPeakFor(discLum, spec.rgb),
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
