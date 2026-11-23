/**
 * sunsetWb.ts — 노을 물리 색감 보존 WB(Chromaticity Lock) · 3단 노출 브라케팅 · 방향성 톤 LUT.
 *
 * Why:
 *  - 스마트폰 기본 카메라 AWB는 화면이 붉어지면 '색 틀어짐'으로 오판해 파란 게인을 올려
 *    노을을 회갈색으로 죽입니다.
 *  - 앱은 촬영 순간의 태양 고도 · AOD · 습도를 알고 있으므로, 물리적 대기 산란 색온도와
 *    색도를 기준(Prior)으로 삼아 AWB 과보정을 되돌리는 3×3 색 보정 행렬과 1D 톤 LUT를
 *    네이티브 카메라/셰이더 파이프라인에 넘깁니다.
 */
import type { Mat3 } from '../astroStackMath';

export interface SkyChromaticityInput {
  /** 태양 고도각(도). -6°(시민박명) ~ +90°(천정). */
  sunAltDeg: number;
  /** 에어로졸 광학 두께(AOD 550nm). 보통 0.05(청명) ~ 0.8(탁함). */
  aod: number;
  /** 상대 습도(0..100%). */
  humidityPct: number;
  /** 전운량(0..1). */
  cloudCover01?: number;
}

export interface SkyChromaticityRef {
  /** 태양 주변(노을 광원) 물리 색온도(K). */
  horizonCctK: number;
  /** 천정(배경 하늘) 물리 색온도(K). */
  zenithCctK: number;
  /** 기준 선형 RGB 화이트포인트(최대 채널=1 정규화). */
  referenceRgb: [number, number, number];
  /** CIE 1931 xy 색도. */
  cieXy: [number, number];
  /** 노을 강도 지수(0=한낮/완전한 밤, 1=골든/매직아워 피크). */
  sunsetIntensity01: number;
}

export interface SunsetWbInput extends SkyChromaticityInput {
  /**
   * 현재 카메라 프레임(AWB 적용 상태)의 하늘 대표 선형 RGB 평균(0..1).
   * 네이티브 카메라의 저해상도 썸네일이나 AWB 메타데이터에서 추출해 넘깁니다.
   */
  measuredSkyRgb: readonly [number, number, number];
  /** 보정 강도(0=원본 유지, 1=물리 기준에 100% 정렬). 기본 0.72. */
  strength?: number;
}

export interface SunsetWbResult {
  /** 네이티브 셰이더에 바로 넘길 선형 RGB 3×3 색 보정 행렬(row-major). */
  colorMatrix: Mat3;
  /** 채널별 최종 게인 [rGain, gGain, bGain]. */
  rgbGains: [number, number, number];
  /** 물리 기준 색도 정보. */
  reference: SkyChromaticityRef;
  /** 네이티브 수동 화이트밸런스 락에 쓸 권장 색온도(K). */
  lockCctK: number;
}

export interface SunsetBracketPlan {
  /** [하이라이트 보존 언더, 구름 적정, 지상 실루엣] EV 오프셋. */
  evOffsets: [number, number, number];
  /** 3장 합성 가중치(하이라이트 롤오프 · 실루엣 대비 보존용). */
  mergeWeights: [number, number, number];
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * 색온도(K, 1800~20000) → 선형 sRGB 기준광(최대 채널 1.0 정규화).
 * Planckian locus 근사(Tanner Helland / Kang 기반) 후 sRGB 감마 역변환으로 선형화.
 */
export function cctToLinearRgb(kelvin: number): [number, number, number] {
  const k = clamp(kelvin, 1800, 20000) / 100;
  let r: number;
  let g: number;
  let b: number;

  if (k <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(k) - 161.1195681661;
    b = k <= 19 ? 0 : 138.5177312231 * Math.log(k - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(k - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(k - 60, -0.0755148492);
    b = 255;
  }

  const toLin = (c: number) => {
    const s = clamp(c / 255, 0, 1);
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lr = Math.max(1e-4, toLin(r));
  const lg = Math.max(1e-4, toLin(g));
  const lb = Math.max(1e-4, toLin(b));
  const mx = Math.max(lr, lg, lb);
  return [lr / mx, lg / mx, lb / mx];
}

/** 선형 sRGB → CIE 1931 xy 색도. */
export function linearRgbToCieXy(rgb: readonly [number, number, number]): [number, number] {
  const [r, g, b] = rgb;
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const Z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b;
  const sum = X + Y + Z;
  if (sum <= 1e-8) return [0.3127, 0.3290];
  return [X / sum, Y / sum];
}

/**
 * 태양 고도·AOD·습도에서 대기 산란 물리 색온도 분포를 산출합니다.
 * - 태양 고도가 0°~+8°일수록 광로(Air Mass)가 길어져 단파장(청색)이 빠져나가고
 *   지평선 광원 색온도가 2400~3400K까지 내려갑니다.
 * - 해가 지평선 아래(-1°~-6°)로 내려가면 블루아워로 전환되며 천정 색온도가 급상승합니다.
 */
export function computePhysicalSkyChromaticity(input: SkyChromaticityInput): SkyChromaticityRef {
  const alt = input.sunAltDeg;
  const aod = clamp(input.aod, 0.02, 1.2);
  const rh = clamp(input.humidityPct, 0, 100) / 100;
  const cloud = clamp(input.cloudCover01 ?? 0.3, 0, 1);

  // 골든/매직아워 피크 가중치 (-5° ~ +12° 구간)
  const sunsetBell = Math.exp(-Math.pow((alt - 1.5) / 6.5, 2));
  const blueHourWeight = alt < 0 ? clamp(-alt / 6, 0, 1) : 0;

  // 대기질량 근사(Kasten-Young 간략화): 고도가 낮을수록 장파장(적색) 우세
  const effAlt = Math.max(0.5, alt + 2.0);
  const airMass = 1 / (Math.sin((effAlt * Math.PI) / 180) + 0.15 * Math.pow(effAlt + 3.885, -1.253));
  const aerosolWarmth = clamp((aod * 0.75 + rh * 0.25) * 0.9, 0, 1);

  // 지평선(태양 방향) 색온도: 정오 ~5600K → 일몰 직전 ~2500K → 블루아워 ~7800K
  const dayWarmCct = 5600 - clamp((airMass - 1) / 14, 0, 1) * (2700 + 500 * aerosolWarmth);
  const horizonCctK = clamp(
    dayWarmCct * (1 - blueHourWeight * 0.7) + 7600 * (blueHourWeight * 0.7),
    2300,
    9500,
  );

  // 천정(배경 하늘) 색온도: 맑을수록 높고 구름이 많으면 태양광 색을 반사해 낮아짐
  const clearZenith = 6800 + 2600 * blueHourWeight + 900 * (1 - aerosolWarmth);
  const zenithCctK = clamp(clearZenith * (1 - 0.35 * cloud) + horizonCctK * (0.35 * cloud), 4200, 12000);

  // 대표 물리 색도: 구름이 적당히 있을수록 지평선 노을빛이 하늘 전체에 넓게 퍼짐
  const horizonShare = clamp(0.45 + 0.35 * sunsetBell + 0.15 * cloud, 0.35, 0.9);
  const effectiveCct = horizonCctK * horizonShare + zenithCctK * (1 - horizonShare);
  const referenceRgb = cctToLinearRgb(effectiveCct);

  return {
    horizonCctK: Math.round(horizonCctK),
    zenithCctK: Math.round(zenithCctK),
    referenceRgb,
    cieXy: linearRgbToCieXy(referenceRgb),
    sunsetIntensity01: clamp(sunsetBell * (1 - 0.25 * Math.max(0, cloud - 0.85) / 0.15), 0, 1),
  };
}

/**
 * AWB가 노을 색을 회색으로 중화했을 때 이를 물리 색도로 되돌리는 3×3 행렬을 계산합니다.
 * - 과도한 색 깨짐을 막기 위해 채널 게인을 [0.65, 1.55]로 안전하게 제한하고 휘도를 보존합니다.
 */
export function computeSunsetWbCorrection(input: SunsetWbInput): SunsetWbResult {
  const ref = computePhysicalSkyChromaticity(input);
  const strength = clamp(input.strength ?? 0.72, 0, 1);

  const [mr, mg, mb] = input.measuredSkyRgb;
  const mMax = Math.max(1e-4, mr, mg, mb);
  const measNorm: [number, number, number] = [
    Math.max(1e-4, mr / mMax),
    Math.max(1e-4, mg / mMax),
    Math.max(1e-4, mb / mMax),
  ];

  const rawGains: [number, number, number] = [
    clamp(ref.referenceRgb[0] / measNorm[0], 0.65, 1.55),
    clamp(ref.referenceRgb[1] / measNorm[1], 0.75, 1.35),
    clamp(ref.referenceRgb[2] / measNorm[2], 0.65, 1.55),
  ];

  // strength에 따라 단위 게인(1.0)과 보간
  let gr = 1 + (rawGains[0] - 1) * strength;
  let gg = 1 + (rawGains[1] - 1) * strength;
  let gb = 1 + (rawGains[2] - 1) * strength;

  // Rec.709 휘도 보존 정규화 (노출이 튀지 않게)
  const lumBefore = 0.2126 * measNorm[0] + 0.7152 * measNorm[1] + 0.0722 * measNorm[2];
  const lumAfter = 0.2126 * measNorm[0] * gr + 0.7152 * measNorm[1] * gg + 0.0722 * measNorm[2] * gb;
  const lumScale = lumAfter > 1e-5 ? lumBefore / lumAfter : 1;
  gr *= lumScale;
  gg *= lumScale;
  gb *= lumScale;

  // 노을 피크에서는 약간의 적-청 크로스 채도 보강으로 회갈색 탁함을 걷어냄
  const satBoost = 0.06 * ref.sunsetIntensity01 * strength;
  const colorMatrix: Mat3 = [
    gr * (1 + satBoost), -gr * satBoost * 0.5, -gr * satBoost * 0.5,
    -gg * satBoost * 0.3, gg * (1 + satBoost * 0.6), -gg * satBoost * 0.3,
    -gb * satBoost * 0.5, -gb * satBoost * 0.5, gb * (1 + satBoost),
  ];

  // 카메라 하드웨어 WB Lock용 색온도 (태양광 5200K~5600K 기준 고정 시 노을 붉은기 보존)
  const lockCctK = Math.round(5400 + (ref.horizonCctK < 3800 ? 200 : 0));

  return {
    colorMatrix,
    rgbGains: [gr, gg, gb],
    reference: ref,
    lockCctK,
  };
}

/**
 * 태양 고도와 구름 상태에 따른 3단 노출 브라케팅 계획을 산출합니다.
 * - 태양이 낮고 밝을수록 언더노출 폭을 넓혀 태양 코어와 구름 하이라이트를 살립니다.
 */
export function computeSunsetBracketEv(sunAltDeg: number, cloudCover01: number): SunsetBracketPlan {
  const cloud = clamp(cloudCover01, 0, 1);
  const directSunRisk = sunAltDeg > -1 && sunAltDeg < 18 ? 1 - 0.55 * cloud : 0.3;
  const underEv = -Number((1.2 + 1.4 * directSunRisk).toFixed(2));
  const overEv = Number((0.9 + 0.9 * (sunAltDeg < 2 ? 1 : 0.5)).toFixed(2));

  return {
    evOffsets: [underEv, 0, overEv],
    // 실루엣을 억지로 밝히지 않고(over 가중치 제한), 적정+언더 중심으로 자연 대비 유지
    mergeWeights: [0.34, 0.48, 0.18],
  };
}

/**
 * 하이라이트 롤오프 + 실루엣 대비 보존용 256-entry 1D 톤 LUT(0..1).
 * 일반 Smart HDR처럼 암부를 과도하게 들어 올리지 않고 필름식 S-커브 + 부드러운 어깨(shoulder)를 적용합니다.
 */
export function buildSunsetToneLut(opts: {
  /** 하이라이트 압축 강도(0..1). 기본 0.65. */
  highlightRollOff?: number;
  /** 실루엣 암부 보존 강도(0..1, 높을수록 검은 실루엣 유지). 기본 0.45. */
  silhouetteDepth?: number;
  size?: number;
} = {}): Float32Array {
  const n = Math.max(16, opts.size ?? 256);
  const roll = clamp(opts.highlightRollOff ?? 0.65, 0, 1);
  const sil = clamp(opts.silhouetteDepth ?? 0.45, 0, 1);
  const lut = new Float32Array(n);

  // Filmic toe(실루엣) + Reinhard-like shoulder(하이라이트)
  const toeGamma = 1.0 + 0.32 * sil;
  const shoulderK = 0.6 + 1.8 * roll;

  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const toe = Math.pow(x, toeGamma);
    // [0,1]에서 단조 증가하며 1.0에 부드럽게 수렴
    const mapped = (toe * (1 + shoulderK)) / (1 + shoulderK * toe);
    lut[i] = clamp(mapped, 0, 1);
  }
  lut[0] = 0;
  lut[n - 1] = 1;
  return lut;
}
