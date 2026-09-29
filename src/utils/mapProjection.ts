/**
 * mapProjection.ts
 *
 * **평면 지도가 언제 거짓말을 시작하는가, 그리고 언제 구로 넘어가야 하는가.**
 *
 * ## 왜 필요한가
 *
 * 지도 탭은 메르카토르 타일(구글맵) 위에 그립니다. 메르카토르의 배율은
 * `sec(위도)` 라 위로 갈수록 늘어납니다. 좁게 보면 티가 안 나지만 넓히면
 * **화면 위쪽과 아래쪽이 다른 배율**이 됩니다. 잰 값(세로가 긴 폰, 종횡비 1.8):
 *
 * ```
 *   중심 37.5°N   화면 폭 10° → 1.21배    30° → 1.86배
 *                          20° → 1.49배    40° → 2.43배
 * ```
 *
 * 늘어남이 2배를 넘으면 **같은 크기의 나라가 위아래에서 두 배 차이로** 보입니다.
 * 거기서부터는 평면이 아니라 구로 보는 편이 정직합니다.
 *
 * ## ⚠ 전환점은 상수가 아니라 **위도 함수**입니다
 *
 * ```
 *   적도    화면 폭 67° 부터        37.5°N   33° 부터
 *   20°N            48° 부터        60°N     25° 부터
 * ```
 *
 * 같은 화면 폭이라도 고위도에서 훨씬 빨리 깨집니다. `cloudRadar` 에서 문턱을
 * 도(度)로 박았다가 걸린 것과 같은 종류입니다 — 여기서는 처음부터 계산합니다.
 *
 * ## 전환을 매끄럽게 하려고 **중간 띠**를 둡니다
 *
 * 2D 는 구글맵 타일(도로·지명)이고 3D 구는 육지 실루엣이라, 바로 바꾸면
 * 그림체가 툭 바뀝니다. 그래서 구로 가기 전에 **타일을 먼저 끄고 실루엣으로**
 * 넘어갑니다. 그 축척이면 도로도 지명도 어차피 안 보이므로 **잃는 정보가
 * 없습니다.** 그 뒤 구로 부푸는 것은 같은 그림체끼리의 변화가 됩니다.
 *
 * ```
 *   늘어남 < 1.5        타일 지도
 *   1.5 ~ 2.0          타일 끄고 육지 실루엣 (평면)
 *   ≥ 2.0              구
 * ```
 */

/** 폰 화면의 세로/가로 비. 화면이 담는 위도 폭을 정합니다. */
export const DEFAULT_ASPECT = 1.8;

/** 이 늘어남을 넘으면 구로 갑니다. */
export const GLOBE_STRETCH = 2.0;
/** 이 늘어남을 넘으면 타일을 끄고 실루엣으로 갑니다. */
export const SILHOUETTE_STRETCH = 1.5;

const RAD = Math.PI / 180;
const sec = (latDeg: number) => 1 / Math.cos(Math.min(85, Math.abs(latDeg)) * RAD);

/** 화면이 담는 위도 범위(도). 메르카토르는 위로 갈수록 늘어나므로 근사입니다. */
export const visibleLatSpan = (
  centerLat: number, longitudeDeltaDeg: number, aspect = DEFAULT_ASPECT,
): { lo: number; hi: number } => {
  const span = longitudeDeltaDeg * aspect * Math.cos(centerLat * RAD);
  return {
    lo: Math.max(-85, centerLat - span / 2),
    hi: Math.min(85, centerLat + span / 2),
  };
};

/**
 * 화면 안 **최대/최소 배율 비** — 위쪽이 아래쪽보다 몇 배로 늘어나 보이는가.
 *
 * ⚠ 구간이 적도를 걸치면 최소 |위도| 는 **0** 입니다. 처음에 이걸 빠뜨려
 *   `min(|lo|,|hi|)` 로 쓰는 바람에 화면 폭 180° 에서 "1.00배"(왜곡 없음)가
 *   나왔습니다 — 극이 무한히 늘어나는 구간인데도요.
 */
export const mercatorStretch = (
  centerLat: number, longitudeDeltaDeg: number, aspect = DEFAULT_ASPECT,
): number => {
  const { lo, hi } = visibleLatSpan(centerLat, longitudeDeltaDeg, aspect);
  const minAbs = lo <= 0 && hi >= 0 ? 0 : Math.min(Math.abs(lo), Math.abs(hi));
  const maxAbs = Math.max(Math.abs(lo), Math.abs(hi));
  return sec(maxAbs) / sec(minAbs);
};

export type MapMode = 'tiles' | 'silhouette' | 'globe';

/** 이 축척·위도에서 무엇으로 그려야 하는가. */
export const mapModeFor = (
  centerLat: number, longitudeDeltaDeg: number, aspect = DEFAULT_ASPECT,
): MapMode => {
  const s = mercatorStretch(centerLat, longitudeDeltaDeg, aspect);
  if (s >= GLOBE_STRETCH) return 'globe';
  if (s >= SILHOUETTE_STRETCH) return 'silhouette';
  return 'tiles';
};

/**
 * 모드가 바뀌는 화면 폭(경도, 도)을 되찾습니다 — 화면에 적거나 애니메이션을
 * 맞추는 데 씁니다. 못 찾으면 null(그 위도에서는 그 모드로 안 넘어감).
 */
export const deltaForStretch = (
  centerLat: number, stretch: number, aspect = DEFAULT_ASPECT,
): number | null => {
  let lo = 0.01, hi = 360;
  if (mercatorStretch(centerLat, hi, aspect) < stretch) return null;
  if (mercatorStretch(centerLat, lo, aspect) >= stretch) return lo;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mercatorStretch(centerLat, mid, aspect) >= stretch) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
};

/**
 * 구 전환의 **진행도** 0~1. 실루엣 띠 안에서 0 → 1 로 오릅니다.
 * 크기를 이 값으로 이어 주면 원이 툭 바뀌지 않고 부풀어 오릅니다.
 */
export const globeProgress = (
  centerLat: number, longitudeDeltaDeg: number, aspect = DEFAULT_ASPECT,
): number => {
  const s = mercatorStretch(centerLat, longitudeDeltaDeg, aspect);
  if (s <= SILHOUETTE_STRETCH) return 0;
  if (s >= GLOBE_STRETCH) return 1;
  return (s - SILHOUETTE_STRETCH) / (GLOBE_STRETCH - SILHOUETTE_STRETCH);
};

/**
 * 구에서 지도로 **돌아오는** 늘어남. 들어가는 문턱(2.0)보다 낮게 두어 경계에서
 * 떨지 않게 합니다(히스테리시스, §119).
 */
export const GLOBE_EXIT_STRETCH = 1.8;

/**
 * 구 모드인가 — **직전 상태를 기억합니다.** 늘어남이 2.0 을 넘으면 들어가고
 * 1.8 아래로 내려와야 나옵니다. 그 사이에서는 직전 상태 그대로입니다.
 */
export const nextGlobeLatch = (
  wasGlobe: boolean, centerLat: number, longitudeDeltaDeg: number, aspect = DEFAULT_ASPECT,
): boolean => {
  const s = mercatorStretch(centerLat, longitudeDeltaDeg, aspect);
  if (!wasGlobe) return s >= GLOBE_STRETCH;
  return s >= GLOBE_EXIT_STRETCH;
};

/**
 * 지도의 화면 폭(경도, 도)과 **같은 축척**의 정사영 구 반지름(px).
 *
 * 정사영은 구 한가운데에서 1 라디안 = R px 입니다. 지도 폭 `widthPx` 가 담는
 * 땅의 호는 `경도 폭 · cos(위도)` 이므로 R = W / (Δλ·cosφ·π/180). 이 둘을
 * 맞춰야 지도에서 구로(또는 거꾸로) 넘어갈 때 땅 크기가 안 튑니다.
 */
export const globeRadiusForDelta = (
  centerLat: number, longitudeDeltaDeg: number, widthPx: number,
): number => {
  const c = Math.max(0.1, Math.cos(centerLat * RAD));
  return widthPx / (Math.max(0.01, longitudeDeltaDeg) * c * RAD);
};

/** `globeRadiusForDelta` 의 역 — 구 반지름에 맞는 지도 화면 폭(경도, 도). */
export const deltaForGlobeRadius = (
  centerLat: number, radiusPx: number, widthPx: number,
): number => {
  const c = Math.max(0.1, Math.cos(centerLat * RAD));
  return widthPx / (Math.max(1, radiusPx) * c * RAD);
};

/**
 * 구 둘레가 화면 안에 다 들어오는 반지름 — 구로 가는 버튼이 여기서 시작합니다.
 * 짧은 변의 42% 라 둘레에 여백이 조금 남습니다.
 */
export const globeFitRadius = (widthPx: number, heightPx: number): number =>
  0.42 * Math.max(1, Math.min(widthPx, heightPx));
