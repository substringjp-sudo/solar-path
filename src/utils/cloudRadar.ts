/**
 * cloudRadar.ts
 *
 * **이미 받아 둔 구름 고리를 지도 위 레이더 화면으로 그립니다.**
 *
 * ## 자료는 어디서 오나 — 추가 요청 0
 *
 * `fetchDayWeatherRing` 이 관측점 둘레를 **반경 380km · 97점**으로 받습니다
 * (거리 0·5·10·30·70·130·200·280·380km, 방위 12 — 5km 고리만 6).
 * 스토어가 이미 미리 받아 캐시하므로 지도에서 다시 불러도 **캐시 적중**입니다.
 *
 * ## ⚠ 이 그림이 얼마나 아는가 — 재고 적습니다
 *
 * 진짜 격자(197점)와 견줬습니다. 대조는 "관측점 값 하나를 전역에 쓰기":
 *
 * ```
 *   고리 보간  RMS 15.4%p      상수  RMS 37.3%p      −59%
 * ```
 *
 * 장식이 아니라 실제 정보를 나릅니다. 다만 **거리에 따라 크게 다릅니다**:
 *
 * ```
 *   거리(km)    고리보간   상수    고리점 간격
 *     0~ 40       0.0      0.0        10km    ← 예보가 한 칸이라 정보 없음
 *    40~100      10.7     15.5        37km
 *   160~240      14.7     33.5       105km
 *   320~380      18.2     46.0       183km    ← 여기서 값어치가 가장 큼
 * ```
 *
 * **멀수록 오차도 크지만 값어치는 더 큽니다** — 상수가 훨씬 더 나쁘기 때문입니다.
 *
 * ## ⚠ 매끈하게 칠하지 않습니다
 *
 * 고리점 간격이 바깥에서 **183km** 입니다. 이걸 부드럽게 보간해 칠하면 실제보다
 * 수십 배 많이 아는 것처럼 보입니다. 그래서 **자료가 가진 그대로** 고리·방위
 * 칸(환형 섹터)으로 그립니다. 옛 PPI 레이더 화면이 원래 이 모양이고, 보는
 * 사람이 해상도를 눈으로 알 수 있습니다.
 *
 * ## 보이는 구간도 잰 값입니다
 *
 * ```
 *   화면 폭  20km(0.23°) → 화면 안 운량 차  12.6%p
 *   화면 폭  40km(0.45°) →                 30.8%p
 *   화면 폭 120km(1.36°) →                 52.6%p
 * ```
 *
 * 아래로는 화면 폭 **20km** 에서 대비가 사라지기 시작하고(예보 격자가 약 25km
 * — 블렌드 중 ECMWF 0.25° 가 정합니다), 위로는 원반 지름 **760km** 를 화면이
 * 넘어서면 자료 없는 바다에 섬만 뜨므로 거기서 끊습니다.
 */
import { CloudPathData, layerWindsFrom } from './weather';
import { WeatherFan } from './skyColumn';
import { classifyCloud, CloudClass } from './cloudMatrix';

/** 고리가 실제로 받는 거리(km). `weather.ts` 의 `RING` 과 같아야 합니다. */
export const RADAR_RINGS_KM = [0, 5, 10, 30, 70, 130, 200, 280, 380] as const;
/** 원반 반지름(km). */
export const RADAR_RADIUS_KM = 380;

/**
 * ⚠ **문턱은 도(度)가 아니라 km 입니다.**
 *
 * 처음에 `6.8°` 라고 박아 뒀다가 판정에 걸렸습니다. 760km 를 111.32 로 나눈
 * 값인데, `longitudeDelta` 는 **경도** 도수라 위도 37.5° 에서는 1° 가 88.3km
 * 입니다(실제로는 8.60°). 게다가 위도마다 다릅니다 — 적도 6.8°, 60°N 13.7°.
 * 상수로 둘 값이 아니었습니다.
 *
 * (등치선 문턱 1° 는 도수로 두는 게 맞습니다 — 그쪽은 "경도 1° = 시간 4분"
 * 이라 위도와 무관합니다. 같은 '도' 라도 재는 것이 다릅니다.)
 */
/** 이 아래로는 안 그립니다 — 예보 격자가 약 25km 라 화면이 평평해집니다.
 *  ⚠ 잰 값: 화면 폭 20km 에서 화면 안 운량 차가 12.6%p 까지 떨어집니다. */
export const RADAR_MIN_VIEW_KM = 20;
/** 이 위로는 안 그립니다 — 원반이 화면을 못 덮어 자료 없는 바다에 섬만 뜹니다. */
export const RADAR_MAX_VIEW_KM = 2 * 380;

/** 경도 1° 가 이 위도에서 몇 km 인가. */
export const kmPerLonDeg = (lat: number): number => 111.32 * Math.cos(lat * (Math.PI / 180));

export const isRadarScale = (longitudeDeltaDeg: number, lat: number): boolean => {
  const km = longitudeDeltaDeg * kmPerLonDeg(lat);
  return km >= RADAR_MIN_VIEW_KM && km <= RADAR_MAX_VIEW_KM;
};

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const EARTH_KM = 6371;

const dest = (lat: number, lon: number, distKm: number, bearing: number) => {
  const d = distKm / EARTH_KM, b = bearing * RAD, p1 = lat * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = lon * RAD + Math.atan2(
    Math.sin(b) * Math.sin(d) * Math.cos(p1),
    Math.cos(d) - Math.sin(p1) * Math.sin(p2),
  );
  return { latitude: p2 * DEG, longitude: ((l2 * DEG + 540) % 360) - 180 };
};

export interface RadarCell {
  /** 섹터 테두리 (닫힌 다각형). */
  polygon: { latitude: number; longitude: number }[];
  /** 총운량 0~100. */
  coverPct: number;
  /** 이 칸의 안쪽·바깥 반지름(km) — 얼마나 성긴 자료인지 드러냅니다. */
  innerKm: number;
  outerKm: number;
}

export interface RadarFrame {
  cells: RadarCell[];
  /**
   * 관측점의 구름 종류 — 층별 운량과 강수로 가립니다(`cloudMatrix.classifyCloud`).
   * 예전 레이더 탭은 이걸 위경도 해시로 지어냈습니다.
   */
  observerClass: CloudClass;
  /** 관측점 층별 운량(%) — 종류를 그렇게 부른 근거를 화면에 같이 적으려고 나릅니다. */
  observerLayers: { low: number; mid: number; high: number; precipitationMm: number };
  /**
   * 구름을 미는 바람. **관측점 값 하나뿐**입니다 — 칸마다 다른 바람은 없습니다.
   * 자료가 없으면 null 이고, 그때는 화살표를 안 그립니다.
   *
   * ⚠ `fromBearingDeg` 는 **불어오는 쪽**(기상 관례)입니다. 구름이 **가는 쪽**은
   *   `toBearingDeg` 입니다. 화살표를 그릴 때 둘을 헷갈리면 구름이 반대로 갑니다.
   */
  wind: { speedKmh: number; fromBearingDeg: number; toBearingDeg: number } | null;
  /** 원반 테두리 — 자료가 여기서 끝난다는 것을 눈에 보이게 합니다. */
  edge: { latitude: number; longitude: number }[];
  /** 이 칸들이 어느 시각인가. */
  timeMs: number;
  /** 가장 바깥 칸의 방위 간격(km) — 화면에 적어 해상도를 숨기지 않습니다. */
  outerSpacingKm: number;
}

/** 운량(%) → 레이더 색. 비가 아니라 **구름**이므로 흰-회색 계열입니다. */
export const radarColor = (coverPct: number, alpha = 1): string => {
  const c = Math.max(0, Math.min(100, coverPct)) / 100;
  // 맑음(투명한 남색) → 흐림(흰색). 비 레이더의 초록-빨강을 쓰면 비가 온다는
  // 뜻으로 읽히므로 안 씁니다.
  const r = Math.round(90 + 165 * c);
  const g = Math.round(110 + 145 * c);
  const b = Math.round(140 + 115 * c);
  const a = (0.10 + 0.62 * c) * alpha;
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
};

/**
 * 고리 자료를 그 시각의 레이더 한 장으로 만듭니다.
 *
 * @param ring   `fetchDayWeatherRing` 이 준 것.
 * @param timeMs 그리고 싶은 시각.
 * @returns 축척이 창 밖이거나 자료가 모자라면 `null`.
 */
export const buildRadarFrame = (
  ring: CloudPathData[] | null | undefined,
  lat: number,
  lon: number,
  timeMs: number,
  longitudeDeltaDeg: number,
): RadarFrame | null => {
  if (!isRadarScale(longitudeDeltaDeg, lat)) return null;
  if (!ring || ring.length < 2) return null;

  /** 그 시각의 인덱스. */
  const idxOf = (h: CloudPathData['hourly']): number => {
    let i = 0;
    while (i < h.timeMs.length - 1 && h.timeMs[i + 1] <= timeMs) i++;
    return i;
  };
  // 그 시각의 총운량을 각 점에서 뽑습니다.
  const at = (p: CloudPathData): number | null => {
    const h = p.hourly;
    if (!h?.timeMs?.length) return null;
    const i = idxOf(h);
    const pick = (arr?: number[]) => (arr && arr[i] != null ? arr[i] : null);
    // 모델 총운량이 가장 잘 맞습니다(§60). 없으면 층 중 최대로 물러납니다.
    const total = pick(h.total);
    if (total != null) return total;
    const l = pick(h.low) ?? 0, m = pick(h.mid) ?? 0, hi = pick(h.high) ?? 0;
    return Math.max(l, m, hi);
  };

  // WeatherFan 은 앱이 하늘을 그릴 때 쓰는 **그 보간기**입니다. 여기서 따로
  // 구현하면 지도와 하늘이 서로 다른 구름을 말하게 됩니다.
  const samples = ring.map(p => {
    const v = at(p) ?? 0;
    return { ...p, low: v, mid: v, high: v };
  });
  const fan = new WeatherFan(samples as any, 0);
  if (!fan.hasData) return null;

  const azStep = 30;                       // 고리가 실제로 가진 방위 간격
  const cells: RadarCell[] = [];
  for (let ri = 0; ri < RADAR_RINGS_KM.length - 1; ri++) {
    const innerKm = RADAR_RINGS_KM[ri];
    const outerKm = RADAR_RINGS_KM[ri + 1];
    for (let a = 0; a < 360; a += azStep) {
      const midAz = a + azStep / 2;
      const midR = (innerKm + outerKm) / 2;
      const { data } = fan.sample(midAz, midR);
      if (!data) continue;

      // 섹터 — 호를 몇 점으로 나눠 둥글게 만듭니다.
      const ARC = 4;
      const poly: { latitude: number; longitude: number }[] = [];
      for (let k = 0; k <= ARC; k++) poly.push(dest(lat, lon, outerKm, a + (azStep * k) / ARC));
      if (innerKm === 0) {
        poly.push({ latitude: lat, longitude: lon });
      } else {
        for (let k = ARC; k >= 0; k--) poly.push(dest(lat, lon, innerKm, a + (azStep * k) / ARC));
      }
      cells.push({ polygon: poly, coverPct: data.mid, innerKm, outerKm });
    }
  }

  const edge: { latitude: number; longitude: number }[] = [];
  for (let a = 0; a <= 360; a += 6) edge.push(dest(lat, lon, RADAR_RADIUS_KM, a));

  // 관측점(0km)의 층별 운량으로 구름 종류를 가립니다.
  const obs = ring.find(p => (p.distance ?? 0) === 0) ?? ring[0];
  const oh = obs?.hourly;
  const oi = oh?.timeMs?.length ? idxOf(oh) : -1;
  const g = (arr?: number[]) => (oi >= 0 && arr && arr[oi] != null ? arr[oi] : 0);
  const observerLayers = {
    low: g(oh?.low), mid: g(oh?.mid), high: g(oh?.high),
    precipitationMm: g(oh?.precipitation as number[] | undefined),
  };
  const observerClass = classifyCloud(observerLayers);

  // 구름을 미는 바람 — 중층을 씁니다. 앱의 `layerWindsFrom` 을 그대로 써서
  // 지도와 하늘이 같은 바람을 말하게 합니다.
  let wind: RadarFrame['wind'] = null;
  if (oi >= 0 && oh) {
    const lw = layerWindsFrom({
      windULow: oh.windULow?.[oi], windVLow: oh.windVLow?.[oi],
      windUMid: oh.windUMid?.[oi], windVMid: oh.windVMid?.[oi],
      windUHigh: oh.windUHigh?.[oi], windVHigh: oh.windVHigh?.[oi],
    } as any);
    if (lw && lw.mid.speedKmh > 0.5) {
      wind = {
        speedKmh: lw.mid.speedKmh,
        fromBearingDeg: lw.mid.bearingDeg,
        toBearingDeg: (lw.mid.bearingDeg + 180) % 360,
      };
    }
  }

  return {
    cells,
    edge,
    observerClass,
    observerLayers,
    wind,
    timeMs,
    outerSpacingKm: (2 * Math.PI * RADAR_RADIUS_KM) / (360 / azStep),
  };
};
