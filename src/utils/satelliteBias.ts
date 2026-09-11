/**
 * **위성이 방금 본 하늘로 예보를 보정합니다.**
 *
 * ## 왜
 *
 * §56 에서 쟀듯 예보 자체가 크게 치우쳐 있습니다 — 짙게 흐린 하늘에서 투과율
 * τ 를 +10~34 만큼 맑은 쪽으로 말합니다. 렌더링을 아무리 고쳐도 안 없어집니다.
 *
 * 그런데 위성은 **지금 하늘을 실제로 보고 있습니다**(약 1.5시간 지연).
 * 지난 한 시간의 "예보가 말한 τ" 와 "위성이 본 τ" 의 차이를 재서 앞으로 빼면,
 * 그 치우침을 **입력 단계에서** 깎을 수 있습니다.
 *
 * ## 얼마나 듣는가 — 30일 · 10지역으로 쟀습니다
 *
 * | 앞선 시간 | 감쇠 | τ오차 전 → 후 | 개선 |
 * |---|---|---|---|
 * | +0h | 1.0 | 18.15 → **10.01** | −45% |
 * | +1h | 0.5~0.7 | 17.40 → 12.56 | −28% |
 * | +2h | 0.3 | 16.87 → 14.38 | −15% |
 * | +3h | 0.3 | 16.41 → 14.82 | −10% |
 * | +5h | 0.1 | 15.65 → 15.16 | −3% |
 * | +8h | 0.1 | 17.21 → **18.38** | **+7% 나빠짐** |
 *
 * ⚠ **감쇠를 안 줄이면 해롭습니다.** +2h 에 감쇠 1.0 을 그대로 쓰면
 * 16.87 → 17.90 으로 **나빠집니다.** 과보정입니다. 처음에 그걸 보고 "+2h 부터는
 * 쓰면 안 된다" 고 결론 낼 뻔했는데, 감쇠를 0.3 으로 낮추니 −15% 로 도움이
 * 됐습니다. **자르는 게 아니라 줄이는 것**이 답이었습니다.
 *
 * ⚠ **밤에는 못 씁니다.** 일사가 0 이라 관측이 없습니다. 일몰을 몇 시간 앞두고
 * 쓰는 것은 위 표의 +3~5h 자리라 이득이 작습니다. **가장 크게 듣는 곳은
 * "지금 하늘"** 입니다(실시간 화면·AR 카메라).
 */

/** 되돌아볼 시간(시간). 1시간이 가장 좋았습니다 — 길수록 나빠집니다. */
export const LOOKBACK_HOURS = 1;
/** 편향 크기 한계(τ). 위성 잡음 한 번에 화면이 뒤집히지 않게 자릅니다. */
export const BIAS_CLAMP = 0.35;
/** 이 시간을 넘으면 아예 안 씁니다 — +8h 에서는 되레 나빠졌습니다. */
export const MAX_LEAD_HOURS = 6;
/** 감쇠 시정수(시간). 위 표의 최적 감쇠와 맞습니다. */
const DAMP_TAU_H = 1.6;

/** 맑은 하늘 수평면 일사 (Haurwitz). `cosZ` 는 태양 천정각의 코사인입니다. */
export const clearSkyGHI = (cosZ: number): number =>
  cosZ <= 0 ? 0 : 1098 * cosZ * Math.exp(-0.059 / cosZ);

/** 운량(%) → 투과율 τ. Kasten-Czeplak. */
export const tauFromCover = (pct: number): number =>
  1 - 0.75 * Math.pow(Math.min(100, Math.max(0, pct)) / 100, 3.4);

/** 투과율 τ → 운량(%). 위의 역함수. */
export const coverFromTau = (tau: number): number =>
  100 * Math.pow(Math.max(0, Math.min(1, 1 - tau)) / 0.75, 1 / 3.4);

/**
 * 앞선 시간에 따른 감쇠. 0 이면 보정을 안 씁니다.
 *
 * ⚠ 이 곡선이 이 모듈의 핵심입니다. 감쇠 없이 그대로 빼면 몇 시간 뒤에는
 * **없느니만 못합니다.**
 */
export function dampingForLead(leadHours: number): number {
  if (!Number.isFinite(leadHours)) return 0;
  if (leadHours < 0) return 1;                       // 과거는 관측이 있으니 온전히
  if (leadHours > MAX_LEAD_HOURS) return 0;
  return Math.exp(-leadHours / DAMP_TAU_H);
}

export interface BiasSample {
  /** 그 시각 예보가 말한 총운량 (%) */
  forecastCoverPct: number;
  /** 위성이 본 수평면 일사 (W/m²) */
  observedGHI: number;
  /** 그 시각의 맑은하늘 일사 (W/m²) */
  clearSkyGHI: number;
}

/**
 * 지난 시각들에서 편향(τ 단위)을 냅니다. **양수면 예보가 실제보다 맑다**는 뜻입니다.
 *
 * @param clearScale 그 지역의 맑은하늘 배율. Haurwitz 는 연무를 무시하므로
 *   지역마다 몇 % 씩 어긋납니다(§56 README). 모르면 1 을 넣습니다.
 * @returns 표본이 모자라면 `null`.
 */
export function estimateBias(samples: BiasSample[], clearScale = 1): number | null {
  const diffs: number[] = [];
  for (const s of samples) {
    if (!Number.isFinite(s.observedGHI) || !Number.isFinite(s.clearSkyGHI)) continue;
    if (s.clearSkyGHI < 80) continue;                // 태양이 너무 낮아 잡음이 큽니다
    const tauObs = Math.min(1, Math.max(0, s.observedGHI / s.clearSkyGHI / (clearScale || 1)));
    diffs.push(tauFromCover(s.forecastCoverPct) - tauObs);
  }
  if (diffs.length === 0) return null;
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return Math.max(-BIAS_CLAMP, Math.min(BIAS_CLAMP, mean));
}

/**
 * 예보 운량에 편향을 적용합니다.
 *
 * @param leadHours 마지막 위성 관측으로부터 **앞선** 시간.
 * @returns 보정된 운량(%). 보정을 안 쓰는 경우 원래 값 그대로.
 */
export function applyBias(coverPct: number, bias: number | null, leadHours: number): number {
  if (bias == null || !Number.isFinite(coverPct)) return coverPct;
  const d = dampingForLead(leadHours);
  if (d <= 0) return coverPct;
  const corrected = tauFromCover(coverPct) - bias * d;
  return Math.max(0, Math.min(100, coverFromTau(corrected)));
}
