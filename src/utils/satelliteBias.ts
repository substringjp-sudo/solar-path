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
 *
 * ## ⚠ 위 표는 **관측점의 총운량**입니다 — 거리와 층 (2026-10-02 후쿠이)
 *
 * 편향은 관측점 1점에서 내는데, 예전에는 해 경로 **모든 점(최대 380km)의 저·중·상층에
 * 똑같이** 걸었습니다. 후쿠이 10-02 17시: 16시 편향 +0.018(일사 1.8%, 위성 잡음 수준)에
 * 감쇠 0.535 를 곱한 Δτ 0.0096 이 **비어 있던 층마다 28%** 를 만들었고, 서쪽 바다 위
 * 저층이 28~51% 가 됐습니다. Kasten-Czeplak 의 역함수는 맑은 쪽에서 기울기가 무한대라
 * τ 0.01 이 운량 0 → 28% 입니다. 게다가 세 층에 같은 Δτ 를 따로 주면 **기둥으로는 그
 * 몇 배**가 됩니다.
 *
 * `tools/weather-truth/measure-bias-distance.js` 로 쟀습니다(30일 · 12곳 · 동서 25~400km,
 * 규칙은 재기 전에 정함). 총운량 τ 오차, 감쇠 없이 걸 때:
 *
 * | 거리 | +0h | +1h | +2h | +3h |
 * |---|---|---|---|---|
 * | 관측점 | — | −26% | −11% | −4% |
 * | 25km | −28% | −18% | −8% | −4% |
 * | 100km | −9% | −11% | −7% | −3% |
 * | 200km | **+0%** | −6% | −5% | −3% |
 * | 400km | **+6%** | −2% | −3% | −2% |
 *
 * 편향은 생각보다 **멀리까지 맞습니다** — 모델의 치우침이 수백 km 규모로 함께 갑니다.
 * 감쇠 길이는 20칸 평균이 300~1000km 에서 평평해(12.92~12.89, 감쇠 없음 12.96) 규칙대로
 * 500km 입니다(`BIAS_DECAY_KM`). 후쿠이의 진짜 원인은 거리가 아니라 **층**이었습니다 —
 * 앱이 그리는 세 층을 겹친 기둥(무작위 겹침)의 τ 오차:
 *
 * | | 보정 없음 | 예전(층마다 같은 Δτ) | 비례 배분(`allocateColumnBias`) |
 * |---|---|---|---|
 * | 관측점 +1~3h | 15.33 | **16.70** | 13.50 |
 * | 25km | 15.01 | 17.69 | 12.95 |
 * | 100km | 14.47 | 18.54 | 13.27 |
 * | 400km | 15.80 | 20.75 | 15.42 |
 *
 * 예전 방식은 그리는 하늘을 **관측점에서조차 보정 안 함보다 나쁘게** 만들고 있었습니다.
 * 위 −32% 는 총운량(`total`)의 이득이고, 앱이 그리는 것은 층입니다. 모델 저층이 0% 인
 * 표본의 **48.7%** 에 저층을 만들어 냈습니다(비례 배분은 0건).
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

/**
 * 거리 감쇠 길이(km) — 관측점에서 낸 편향이 경로 점에서 `exp(−거리/이 값)` 만큼 듣습니다.
 *
 * 머리말 "거리와 층" 표. 300~1000km 가 0.03 안으로 평평해서 길이 자체보다 **"수백 km"** 라는
 * 것이 잰 사실입니다. 앱 경로의 가장 먼 점(380km)에서 0.47 입니다.
 */
export const BIAS_DECAY_KM = 500;

/**
 * 그리는 기둥이 이 값(%) 이하면 층을 손대지 않습니다 — README 의 "맑음" 줄(총운량 ≤ 20%).
 *
 * 맑은 기둥에는 다시 키울 구름 구조가 없고, 위성 τ 는 빠진 구름이 **어느 층**인지 말하지 못합니다.
 * 비례만으로는 후쿠이 10~30km 점(저층 1% · 상층 1%)이 배수 12 를 받아 1% → 12% 가 됩니다 —
 * 0 을 만드는 것은 막아도 흔적을 부풀립니다. 잰 비용은 관측점 이득의 2% 입니다(비례 13.46 → 13.50).
 *
 * "기압면 습도가 가장 높은 층에 넣기" 는 하지 않았습니다. 후쿠이 10-02 16시 단면(best_match)에서
 * 상대습도가 가장 높은 면은 **850hPa 73%(경계층)** 였고, 실제 구름이 있던 400hPa 는 35% 였습니다 —
 * 그 규칙은 이 사례에서 구름을 다시 저층에 넣습니다.
 */
export const CLEAR_COLUMN_PCT = 20;

/** 관측점에서 `distanceKm` 떨어진 점에 편향을 얼마나 걸지(0~1). 관측점(0km)은 1 — 거기 이득은 그대로입니다. */
export function weightForDistance(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 1;
  return Math.exp(-distanceKm / BIAS_DECAY_KM);
}

const pct = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0);

/**
 * 세 층을 한 기둥으로(%) — **무작위 겹침** 1 − Π(1 − cᵢ).
 * §60 에서 층으로 총량을 내는 방식 중 위성과 가장 맞았던 것입니다(τ오차 17.5, 최대 겹침 19.1).
 */
export const columnCover = (low: number, mid: number, high: number): number =>
  100 * (1 - (1 - pct(low) / 100) * (1 - pct(mid) / 100) * (1 - pct(high) / 100));

export interface LayerCover {
  low: number;
  mid: number;
  high: number;
}

/**
 * 기둥 τ 를 `dTau` 만큼 옮기도록 **세 층에 같은 배수 k** 를 곱합니다. `dTau` 가 양수면 어둡게(구름을 더).
 *
 * - 모델이 구름을 둔 층에 **그 양에 비례해** 나눕니다. 0% 층은 몇 배를 해도 0% 입니다.
 * - 그리는 기둥(`columnCover`)의 τ 가 **정확히** `dTau` 만큼 옮습니다 — 편향을 잰 단위(기둥 τ)
 *   그대로입니다. 예전처럼 층마다 `dTau` 를 따로 주면 기둥으로는 그 몇 배가 됩니다.
 * - 기둥이 `CLEAR_COLUMN_PCT` 이하면 손대지 않습니다(위 상수 주석).
 * - 층은 100% 에서 멈춥니다. 가장 큰 층이 100% 면 기둥도 100% 라 거기서 멈춥니다 — 그 너머로 k 를
 *   키우면 작은 층만 부풀립니다.
 *
 * 순수 함수입니다. 새 값을 돌려줍니다.
 */
export function allocateColumnBias(layers: LayerCover, dTau: number): LayerCover {
  const l = pct(layers.low), m = pct(layers.mid), h = pct(layers.high);
  const same = { low: l, mid: m, high: h };
  if (!Number.isFinite(dTau) || dTau === 0) return same;
  const c0 = columnCover(l, m, h);
  if (c0 <= CLEAR_COLUMN_PCT) return same;
  const target = coverFromTau(Math.max(0.25, Math.min(1, tauFromCover(c0) - dTau)));
  if (target === c0) return same;
  const at = (k: number): LayerCover => ({ low: Math.min(100, k * l), mid: Math.min(100, k * m), high: Math.min(100, k * h) });
  // 기둥은 k 에 대해 단조 증가합니다. 늘릴 때는 [1, 가장 큰 층이 100% 가 되는 k], 줄일 때는 [0, 1].
  let lo = target > c0 ? 1 : 0;
  let hi = target > c0 ? 100 / Math.max(l, m, h) : 1;
  for (let it = 0; it < 60; it++) {
    const k = (lo + hi) / 2;
    const c = at(k);
    if (columnCover(c.low, c.mid, c.high) < target) lo = k; else hi = k;
  }
  return at((lo + hi) / 2);
}

export interface CloudAt extends LayerCover {
  /** 모델 총운량(%). 없으면 그대로 비워 둡니다. */
  total?: number | null;
}

/**
 * 경로 한 점 · 한 시각의 보정 — `weather.ts` 의 `applyBiasToPath` 가 시각마다 부릅니다.
 *
 * - 편향은 거리로 줄이고(`weightForDistance`), 앞선 시간으로 줄입니다(`dampingForLead`).
 * - 층은 `allocateColumnBias`.
 * - 총운량은 예전 식(`applyBias`) 그대로 거리만 줄입니다 — **관측점(0km)에서는 예전과 같은 값**이고,
 *   머리말 첫 표(−32%)가 잰 것이 이 값입니다.
 */
export function correctCloudAt(cloud: CloudAt, bias: number | null, leadHours: number, distanceKm: number): CloudAt {
  if (bias == null || !Number.isFinite(bias)) return { ...cloud };
  const b = bias * weightForDistance(distanceKm);
  const layers = allocateColumnBias(cloud, b * dampingForLead(leadHours));
  return {
    ...layers,
    total: cloud.total == null ? cloud.total : applyBias(cloud.total, b, leadHours),
  };
}
