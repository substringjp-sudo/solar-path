/**
 * cloudDeck.ts
 *
 * **관측자가 구름층 위에 있을 때의 기하** — 운해.
 *
 * ## 지금 코드가 막고 있던 것
 *
 * `skyColumn.elevationToDistanceKm` 는 첫 줄이 `Math.max(0, elevDeg)` 입니다.
 * **내려다보는 각을 0으로 눌러 버립니다.** 그리고 층 고도에서 관측자 고도를
 * 빼는 코드가 어디에도 없었습니다 — `observerElevation` 은 오직 지평선
 * 처짐에만 쓰였습니다.
 *
 * 곧 모형이 **"관측자는 땅에 있고 구름은 늘 위에 있다"** 였습니다. 해발
 * 1,600m 에 서서 1,200m 구름 위에 있어도 그 구름을 **머리 위에** 그립니다.
 *
 * ## 올바른 기하
 *
 * 지심 원점에서 관측자는 반지름 `B = R + h관측자`, 구름 껍질은 `A = R + h구름`
 * 입니다. 관측자의 국소 수평을 x, 연직을 y 로 두면 시선은
 *
 * ```
 *   P = (0, B),   방향 u = (cos ε, sin ε)      ε < 0 이면 내려다봄
 * ```
 *
 * 이고, `|P + t·u| = A` 를 풀면
 *
 * ```
 *   t² + 2B·sin(ε)·t + (B² − A²) = 0
 * ```
 *
 * 입니다. 이 한 식이 **위아래를 한꺼번에** 다룹니다 — 관측자가 층 아래면
 * `B² − A² < 0` 이라 양근이 하나뿐이고, 층 위면 둘 다 양수라 **가까운 근**이
 * 눈에 보이는 구름 윗면입니다.
 *
 * ## 가까운 근은 뺄셈 없이 냅니다 — 다만 이유를 정정합니다
 *
 * 근의 공식을 그대로 쓰면 `−B sin ε − √(A² − B²cos²ε)` 인데, 두 항이 모두
 * 1,250km 쯤이고 답은 **2km** 입니다. 그래서 여기서는 먼 근을 먼저 구하고
 * **근과 곱**으로 가까운 근을 냅니다:
 *
 * ```
 *   t먼   = −B·sinε + √(A² − B²cos²ε)
 *   t가까 = (B² − A²) / t먼            ← 뺄셈이 없다
 * ```
 *
 * ⚠ **처음에 "순진한 뺄셈은 자릿수가 날아간다" 고 적었는데 틀렸습니다.**
 * 그건 제가 손으로 계산할 때 유효숫자가 모자랐던 것이지 코드의 문제가
 * 아니었습니다. 배정밀도로 실제로 재 보니:
 *
 * ```
 *   고도차 1000m  →  상대차 1e-11      ← 실제 운해
 *   고도차  100m  →  상대차 1e-10
 *   고도차    1m  →  상대차 1e-8
 *   고도차   1cm  →  상대차 1e-6       ← 여기서야 보이기 시작
 * ```
 *
 * 곧 **물리적으로 뜻 있는 구간에서는 어느 쪽을 써도 같습니다.** 그래도 근과
 * 곱 쪽을 두는 이유는 측정된 결함이 있어서가 아니라, 공짜이면서 구성상 옳고
 * 고도차가 0 으로 가도 안 무너지기 때문입니다. 판정 [2]가 이 사실을
 * 그대로 못 박아 둡니다.
 *
 * ## 자연히 따라오는 것 — 구름바다의 먼 가장자리
 *
 * 판별식이 0 이 되는 각이 **구름 껍질의 지평선**입니다:
 *
 * ```
 *   ε_가장자리 = −acos(A / B)
 * ```
 *
 * 관측자 1,600m · 구름 1,200m 면 0.642° 아래, 71.4km. 그보다 위를 보면 시선이
 * 구름 껍질에 **영영 안 닿습니다.** 곧 운해는 −90°(발밑)부터 −0.642°까지
 * **아래 반구를 통째로** 채웁니다 — 띠가 아니라 바닥입니다.
 */

import { EARTH_RADIUS_KM } from './earth';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** 시선이 구름 껍질에 닿았을 때의 결과. */
export interface DeckHit {
  /** 관측자에서 그 점까지의 **직선** 거리(km). */
  slantKm: number;
  /** 구름 껍질 위로 잰 **호** 거리(km). `skyColumn` 의 거리 규약과 같습니다. */
  arcKm: number;
}

/** 관측자가 이 층보다 위에 있는가. */
export const isAboveLayer = (layerAltKm: number, observerAltKm: number): boolean =>
  observerAltKm > layerAltKm;

/**
 * 구름 껍질의 **지평선 처짐**(도, 양수).
 *
 * 관측자가 층 아래면 0 입니다 — 그때는 껍질이 머리 위라 가장자리가 없습니다.
 */
export const deckHorizonDipDeg = (layerAltKm: number, observerAltKm: number): number => {
  const A = EARTH_RADIUS_KM + layerAltKm;
  const B = EARTH_RADIUS_KM + observerAltKm;
  if (B <= A) return 0;
  return Math.acos(Math.min(1, A / B)) * R2D;
};

/**
 * 고도각 `elevDeg` 로 본 시선이 구름 껍질과 만나는 곳.
 *
 * 관측자 고도를 **받습니다** — 이게 이 모듈이 있는 이유입니다.
 * 닿지 않으면 `null`(관측자가 층 위인데 너무 위를 본 경우).
 *
 * ⚠ `elevDeg` 를 클램프하지 않습니다. 음수는 **내려다보는 각**입니다.
 */
export const deckHit = (
  elevDeg: number, layerAltKm: number, observerAltKm: number,
): DeckHit | null => {
  const A = EARTH_RADIUS_KM + layerAltKm;
  const B = EARTH_RADIUS_KM + observerAltKm;
  const e = elevDeg * D2R;
  const s = Math.sin(e), c = Math.cos(e);

  // t² + 2B·s·t + (B² − A²) = 0
  const disc = A * A - B * B * c * c;
  if (disc < 0) return null;                 // 껍질을 스치지도 못함
  const root = Math.sqrt(disc);

  const tFar = -B * s + root;
  const below = B <= A;                      // 관측자가 층 아래(또는 같은 높이)

  let t: number;
  if (below) {
    // 근의 곱 B²−A² ≤ 0 이므로 양근은 하나뿐입니다. 그게 tFar 입니다.
    t = tFar;
  } else {
    // 층 위 — 두 근이 다 양수이고 **가까운 쪽**이 보이는 윗면입니다.
    // 근과 곱으로 냅니다. 물리 구간에서는 뺄셈과 같은 값이지만(머리말 참고)
    // 고도차가 0 으로 가도 안 무너집니다.
    if (tFar <= 0) return null;              // 뒤쪽으로만 만남 = 안 보임
    t = (B * B - A * A) / tFar;
  }
  if (!(t > 0) || !Number.isFinite(t)) return null;

  // 만난 점의 지심각 → 껍질 위 호 거리
  const x = t * c;                           // 국소 수평 성분
  const y = B + t * s;                       // 국소 연직 성분(지심 반지름 쪽)
  const theta = Math.atan2(x, y);            // 관측자와 대상 사이 지심각
  return { slantKm: t, arcKm: A * theta };
};

/**
 * `deckHit` 의 역 — 껍질 위 호 거리 `arcKm` 에 있는 점의 고도각(도).
 *
 * 관측자보다 아래면 음수가 나옵니다. 클램프하지 않습니다.
 */
export const deckElevationDeg = (
  arcKm: number, layerAltKm: number, observerAltKm: number,
): number => {
  const A = EARTH_RADIUS_KM + layerAltKm;
  const B = EARTH_RADIUS_KM + observerAltKm;
  const theta = Math.max(0, arcKm) / A;
  // 관측자 국소 좌표에서 대상의 위치
  const x = A * Math.sin(theta);             // 수평
  const y = A * Math.cos(theta) - B;         // 연직(음수면 아래)
  return Math.atan2(y, x) * R2D;
};

/**
 * 운해 조건인가 — **이 판단만으로 화면을 바꾸지는 않습니다.**
 *
 * 저층운이 충분히 깔려 있고, 그 층이 관측자보다 아래일 때입니다.
 *
 * ⚠ **문턱 0.6 은 재서 얻은 값이 아닙니다.** "운량이 낮으면 구멍이 숭숭
 * 뚫려 바다가 아니라 흩어진 구름" 이라는 방향만 맞고, 어디서 갈리는지는
 * 사진과 대조한 적이 없습니다. 이 값을 화면 분기에 쓰기 전에 재야 합니다 —
 * 지금은 이름표(로그·안내)에만 씁니다. 기하(`deckHit`)는 이 문턱과 **무관**하게
 * 운량을 그대로 받아 그립니다.
 *
 * ⚠ 이건 **모델이 말하는 것**을 옮길 뿐입니다. 예보 격자가 25km(ECMWF)·
 * 11km(ICON)라 골짜기 규모 역전층 운해를 모델이 아는지는 별개 문제입니다.
 */
export const CLOUD_SEA_MIN_COVER = 0.6;

export const isCloudSea = (
  lowCover: number, layerAltKm: number, observerAltKm: number,
): boolean => isAboveLayer(layerAltKm, observerAltKm) && lowCover >= CLOUD_SEA_MIN_COVER;
