/**
 * dniOpticalDepth.ts — 예보 직달일사(DNI)로 **구름 기둥의 광학두께**를 되짚습니다(§158).
 *
 * 왜: 10/24 12:59 서울 — 예보 "상층 100 %·중 50 %·저 24 %·강수 0 mm", 실제는 비 오는 흐린 날. 종류 규칙은 상층 100 % 를
 * 권운(ci, 아주 얇음)으로 그려 하늘이 맑게 보였습니다. 그런데 같은 예보의 DNI 는 29 W/m²(맑으면 ≈ 500) — 해가 가려진 두꺼운 구름을
 * 모델 자신이 말하고 있었습니다. 운량(얼마나 덮였나)과 광학두께(얼마나 두꺼운가)는 다른 양이고, 두께는 DNI 가 압니다.
 *
 * 맑은 하늘 DNI: Meinel 근사 1000·0.7^(AM^0.678)(해발 0, 보통 에어로졸) × 에어로졸 초과분 exp(−(AOD−0.12)·AM). 공기량 AM 은 Kasten–Young.
 * 구름 투과율 T = DNI / DNI_clear, τ = −ln T. DNI 는 산란광 바닥(수십 W/m²)이 있어 T < 0.03 이면 "τ ≥ 3.5(포화)" 로만 압니다.
 */
export const DNI_BACKGROUND_AOD = 0.12;
/** DNI 바닥 아래(해가 완전히 가려짐) — 이 값 이상이라는 뜻으로 돌려줍니다. */
export const DNI_TAU_SATURATED = 4;
const DNI_FLOOR_T = 0.03;

export function kastenYoungAirmass(sunAltDeg: number): number {
  const h = Math.max(0.1, sunAltDeg);
  return 1 / (Math.sin((h * Math.PI) / 180) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}

export function clearSkyDni(sunAltDeg: number, aod550 = DNI_BACKGROUND_AOD): number {
  if (!(sunAltDeg > 0)) return 0;
  const am = kastenYoungAirmass(sunAltDeg);
  const base = 1000 * Math.pow(0.7, Math.pow(am, 0.678));
  const extra = Math.max(0, (Number.isFinite(aod550) ? aod550 : DNI_BACKGROUND_AOD) - DNI_BACKGROUND_AOD);
  return base * Math.exp(-extra * am);
}

/**
 * 구름 광학두께(해 방향, 무차원). 해 5° 아래·DNI 없음이면 null. 0 = 맑음, DNI_TAU_SATURATED = 그 이상.
 */
export function cloudOpticalDepthFromDni(dniWm2: number | undefined | null, sunAltDeg: number, aod550?: number): number | null {
  if (dniWm2 == null || !Number.isFinite(dniWm2) || !(sunAltDeg >= 5)) return null;
  const clear = clearSkyDni(sunAltDeg, aod550);
  if (!(clear > 1)) return null;
  const T = Math.max(0, dniWm2) / clear;
  if (T >= 0.98) return 0;
  if (T < DNI_FLOOR_T) return DNI_TAU_SATURATED;
  return Math.min(DNI_TAU_SATURATED, -Math.log(T));
}
