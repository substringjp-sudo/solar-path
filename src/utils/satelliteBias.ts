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
 * | +0h | 1.0 | 15.22 → **10.39** | −32% |
 * | +1h | 0.5 | 15.34 → 13.02 | −15% |
 * | +2h | 0.3 | 15.43 → 14.35 | −7% |
 * | +3h | 0.3 | 15.46 → 14.93 | −3% |
 * | +5h | 0.3 | 15.54 → 14.94 | −4% |
 * | +8h | 0.3 | 16.45 → 16.24 | −1% |
 *
 * ⚠ **이 표는 한 번 고쳐 쓴 것입니다.** 처음에 −45%(18.15 → 10.01)라고 적었는데,
 * 그때는 시간평균 일사를 **순간** 맑은하늘로 나누고 있었습니다(아래
 * `clearSkyGHIMean` 참고). 분모를 맞추니 *보정 전* 오차가 18.23 → 15.22 로
 * 내려갔습니다 — **18.15 중 3.0 은 예보 오차가 아니라 자 자신의 잡음**이었고,
 * 그만큼 개선폭이 부풀어 있었습니다. 보정 **후** 값은 10.51 → 10.39 로 거의
 * 그대로입니다. 참값은 **−32%** 입니다.
 *
 * ⚠ **감쇠를 안 줄이면 해롭습니다.** 감쇠 1.0 을 그대로 끌고 가면 +2h 에서
 * +5%, +3h 에서 +12%, +8h 에서 +16% 로 **나빠집니다.** 과보정입니다.
 * **자르는 게 아니라 줄이는 것**이 답입니다. 위 최적 감쇠(1.0 / 0.5 / 0.3)는
 * `exp(−h/1.6)` = 1.00 / 0.53 / 0.29 와 맞습니다 — 분모를 고친 뒤에도
 * **곡선의 모양은 그대로 살아남았습니다.**
 *
 * ⚠ **밤에는 못 씁니다.** 일사가 0 이라 관측이 없습니다. 일몰을 몇 시간 앞두고
 * 쓰는 것은 위 표의 +3~5h 자리라 이득이 작습니다. **가장 크게 듣는 곳은
 * "지금 하늘"** 입니다(실시간 화면·AR 카메라).
 */

/** 되돌아볼 시간(시간). 1시간이 가장 좋았습니다 — 길수록 나빠집니다. */
export const LOOKBACK_HOURS = 1;
/** 편향 크기 한계(τ). 위성 잡음 한 번에 화면이 뒤집히지 않게 자릅니다. */
export const BIAS_CLAMP = 0.35;
/**
 * 쓸 수 있는 가장 낮은 맑은하늘 일사(W/m²) — **태양고도 15°** 에 해당합니다.
 *
 * ⚠ 이 문턱이 −45% 를 잰 조건입니다. 더 낮추면 안 됩니다. 처음에 80(고도 약
 * 4.6°)으로 두고 실기를 돌렸더니 맑은하늘 배율이 **1.658** 로 나왔습니다 —
 * Haurwitz 가 낮은 태양에서 크게 빗나가는데 그 구간을 받아들인 탓입니다.
 * 15° 로 올리니 제자리로 왔습니다.
 */
export const MIN_CLEAR_GHI = 226;
/** 이 시간을 넘으면 아예 안 씁니다 — +8h 에서는 되레 나빠졌습니다. */
export const MAX_LEAD_HOURS = 6;
/** 감쇠 시정수(시간). 위 표의 최적 감쇠와 맞습니다. */
const DAMP_TAU_H = 1.6;

/** 맑은 하늘 수평면 일사 (Haurwitz). `cosZ` 는 태양 천정각의 코사인입니다. */
export const clearSkyGHI = (cosZ: number): number =>
  cosZ <= 0 ? 0 : 1098 * cosZ * Math.exp(-0.059 / cosZ);

/**
 * **창에서 평균한** 맑은 하늘 일사.
 *
 * ⚠ Open-Meteo 의 시간별 일사는 **직전 한 시간의 평균**입니다. 그래서 그 시각
 * *순간*의 맑은하늘로 나누면 안 됩니다 — 해가 빠르게 오르내리는 시간대에서
 * 분모가 통째로 어긋납니다. 서울 9월에서 잰 것:
 *
 * ```
 *   08:00  순간 332 / 창평균 217  →  1.53배  (아침을 흐리게 읽습니다)
 *   12:00  순간 854 / 창평균 828  →  1.03배
 *   17:00  순간 324 / 창평균 432  →  0.75배
 *   18:00  순간 110 / 창평균 226  →  0.49배  (일몰을 맑게 읽습니다)
 * ```
 *
 * **일몰에서 가장 큽니다** — 이 앱이 겨누는 바로 그 시각입니다. 맑은하늘
 * 배율(p95)은 하루에 하나뿐이라 **시각마다 달라지는 이 오차를 못 지웁니다.**
 *
 * @param endMs  창의 끝(= 자료의 시각).
 * @param cosZAt 그 시각의 태양 천정각 코사인을 주는 함수.
 */
export const clearSkyGHIMean = (
  endMs: number,
  cosZAt: (ms: number) => number,
  windowMin = 60,
  stepMin = 5,
): number => {
  let sum = 0;
  let n = 0;
  // 창 안을 계단 가운데에서 표본합니다(끝점 이중 계산을 피합니다).
  for (let m = windowMin - stepMin / 2; m > 0; m -= stepMin) {
    sum += clearSkyGHI(cosZAt(endMs - m * 60_000));
    n++;
  }
  return n ? sum / n : 0;
};

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
    if (s.clearSkyGHI < MIN_CLEAR_GHI) continue;     // 태양이 너무 낮아 잡음이 큽니다
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
