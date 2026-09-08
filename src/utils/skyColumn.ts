/**
 * skyColumn.ts
 *
 * 하늘을 **방향으로** 샘플링합니다.
 *
 * Why: 기존 구현은 29점 지상 격자(0/50/100/200km)의 각 점에 구름을 하나씩 놓고
 * 고도각을 `atan2(고도, 거리)`로 구했습니다. 그러면 29칸 중 28칸이 고도각 13°
 * 아래에 깔립니다. 13° 위쪽은 입체각으로 하늘의 **77.6%** 인데, 그걸 중심 셀
 * 한 칸이 담당하게 됩니다. 고개를 들면 언제나 비어 있던 이유입니다.
 *
 * 지상 격자는 200km를 내려다보는 *평면도*이고 하늘은 *돔*입니다. 다른 공간입니다.
 * 여기서는 순서를 뒤집습니다 — 볼 방향 (az, ε)을 먼저 정하고, 그 방향이 어느
 * 지상 지점을 보는지 `d = h / tan ε` 로 역산해 거기서 기상을 읽습니다.
 *
 * 고도 1.5km 구름층이 하늘에서 차지하는 영역은 전부 반경 43km 안입니다.
 * 반대로 고도 10km 권운은 2°에서 286km까지 갑니다. 층마다 보는 거리가 다르므로
 * 층별로 따로 리샘플링해야 합니다.
 */
import { layerWindsFrom, type CloudData, type LayerWinds } from './weather';
import { EARTH_RADIUS_KM } from './earth';
import { PRESET_OPTICS, resolvePresetFromWeather } from './cloudPresets';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export type LayerKey = 'low' | 'mid' | 'high';

/** 층별 대표 고도 (km). 실제 운형 고도는 이 근처에서 결정됩니다. */
export const LAYER_ALTITUDE_KM: Record<LayerKey, number> = {
  low: 1.5,
  mid: 4.5,
  high: 10.0,
};

/**
 * 층 샘플 하나. 하늘의 한 방향에서 본 그 층의 상태입니다.
 */
export interface LayerSample {
  layer: LayerKey;
  azimuthDeg: number;
  elevationDeg: number;
  /** 지상 투영 거리 (km) */
  distanceKm: number;
  /** 0~1 운량 */
  cover: number;
  /** 이 방향 관측의 신뢰도. 실측 팬 안이면 1, 밖이면 0으로 떨어집니다. */
  confidence: number;
  // ── 운형 판정용 방향별 기상 (docs/CLOUD_VARIETY_PLAN.md 3단계) ────────────
  //
  // 운형은 운량만으로 정해지지 않습니다. 같은 저층 80%라도 강수가 있으면
  // 난층운, 없으면 층적운입니다. 그런데 `resolvePresetFromWeather`는 강수·
  // 습도를 **관측점 값 하나**로 받고 있었습니다 — 서쪽 30km에 비가 와도
  // 그 방향이 비구름이 되지 않았습니다.
  //
  // 이 값들은 새로 받아오는 게 아닙니다. Open-Meteo 팬은 이미 모든 지점에서
  // `precipitation`과 `relative_humidity_2m`을 받고 있고(weather.ts의
  // 원격 지점 변수 목록), 여기까지 오지 않고 있었을 뿐입니다.
  /** 이 방향 지점의 강수 (mm/h) */
  precipMmH: number;
  /** 이 방향 지점의 상대습도 (%) */
  humidityPct: number;
  /** 이 방향 지점의 저층 운량 (%) — 운형 판정 입력 */
  lowPct: number;
  /** 이 방향 지점의 상층 운량 (%) — 적란운 판정 입력 */
  highPct: number;
}

/** 방위 24 × 고도 8 = 192 방향/층 */
const AZ_STEPS = 24;
const ELEV_STEPS = 8;

/**
 * 고도각 격자. 등간격이 아니라 **등입체각**으로 나눕니다.
 *
 * 고도각을 균등하게 자르면 천정 쪽 샘플이 좁은 영역에 몰리고 지평선 쪽이
 * 성깁니다. 입체각은 `sin ε` 에 비례하므로 `sin ε` 를 균등 분할해야
 * 각 샘플이 같은 넓이의 하늘을 담당합니다.
 */
/**
 * ⚠ **알려진 한계 — 천정 뚜껑에 표본이 없습니다.**
 *
 * 맨 위 표본이 69.64°에서 멈추는데(8단계 기준) 덱 메시는 천정까지
 * 올라갑니다. 69.6°~90° 는 위를 올려다볼 때 화면의 상당 부분인데 그 구간에
 * 표본이 하나도 없어서, 격자 보간이 맨 윗줄(방위 24방향마다 값이 다름)로
 * 고정됩니다. 그 값들이 천정 한 점으로 빨려들며 **바람개비 부챗살**이
 * 됩니다 — 실기기 캡처에서 보고된 "천정 주변 왜곡"이 이것입니다.
 * `tools/shader-preview/build-dome-defects.js` 1칸이 그대로 재현합니다.
 *
 * 고쳐 봤습니다: 그 구간을 지상거리로 균등하게 쪼개 3줄을 더 넣으면
 * 부챗살이 눈에 띄게 사라집니다(렌더로 확인). 그런데 **판정 7종이
 * 깨졌습니다.** 아래 `buildSkyColumns`의 U자 운량장이 전체 표본에 대한
 * **순위 사상**이라, 천정 근처에 값이 비슷한 표본 72개가 늘면 분위수가
 * 통째로 밀려 모든 방향의 운량이 흔들립니다.
 *
 * 제대로 고치려면 순위 사상을 **입체각 가중**으로 바꿔야 합니다. 지금
 * 격자가 등입체각인 덕에 가중치가 필요 없었던 것이고, 천정 줄을 더하는
 * 순간 그 성질이 깨집니다.
 *
 * 덱 메시 쪽에도 같이 걸린 것이 하나 더 있습니다. 메시는 89°에서 멈춰
 * 천정에 **지름 2°짜리 구멍**이 뚫려 있고(캡처에서 하늘돔이 그 구멍으로
 * 비칩니다), 90°까지 늘리면 구멍은 닫힙니다. 그런데 그러면 고리 간격이
 * 2.734° → 2.766°로 바뀌면서 운량 재표본이 달라지고, 운형 분화 신호가
 * 절반으로 줄었습니다 (`verify-genus-split`: 11.2%p → 5.4%p). 왜 그렇게
 * 크게 움직이는지 아직 설명하지 못해서 넣지 않았습니다.
 *
 * 둘 다 **덱 표현 자체를 다시 볼지 논의 중이라**(볼륨 레이마칭) 여기서
 * 멈춰 둡니다 — 곧 없어질 수도 있는 코드에 통계를 다시 맞추는 것은
 * 값이 없고, 설명 못 하는 변화를 넣는 것은 더 나쁩니다.
 */
export function elevationGrid(steps: number = ELEV_STEPS): number[] {
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    // sin ε 를 (0, 1] 구간에서 균등 분할하고 셀 중앙을 취합니다.
    const s = (i + 0.5) / steps;
    out.push(Math.asin(Math.min(1, s)) * R2D);
  }
  return out;
}

/** 지구 반지름 (km). 구면 투영의 기준. `utils/earth.ts` 가 원본입니다. */
export { EARTH_RADIUS_KM };

/**
 * 운량 U자 곡선의 세기. 1이면 균등분포, 클수록 맑음/흐림 양 끝으로 몰립니다.
 * 렌더로 고른 값 — 자세한 근거는 `buildSkyColumns` 안 주석.
 */
export const U_SHAPE_P = 2.0;
/**
 * U자 구조를 얼마나 섞을지 (1 = 순수 U자).
 *
 * 1보다 작게 둘 이유가 없어서 1입니다. 혼합은 `c + (shaped − c)·k` 라 어떤
 * k에서도 평균이 예보값 그대로이고, k를 줄이면 구조만 옅어집니다.
 * (0.85였을 때 표준편차 0.139 → 1.0에서 0.162, 노이즈 규모까지 고치면 0.263.)
 */
export const U_SHAPE_MIX = 1.0;
/** 국소 평균 보정 이웃 — 방위 반경 (도). */
export const LOCAL_AZ_DEG = 45;
/** 국소 평균 보정 이웃 — 고도 반경 (sin ε 단위, 고리 약 2칸). */
export const LOCAL_ELEV_SIN = 0.25;

/**
 * 고도각 → 구름층 위 투영 거리 (호 길이, km).
 *
 * **평면 근사를 자르는 게 아니라 구면을 직접 풉니다.** 예전에는
 * `min(h/tan ε, sqrt(2Rh))` 였는데, 그건 두 가지가 틀렸습니다:
 *
 * 1. 자르는 지점에서 값이 꺾입니다. 그 아래 고도각이 전부 같은 거리로
 *    뭉개져, 곡률이 아니라 **벽**이 됩니다.
 * 2. 자르기 전에도 이미 많이 틀립니다. 상층 10km · 고도각 1°에서
 *    평면식은 573km, 참값은 263km — **2.2배**. 0.2°에서는 8.5배입니다.
 *
 * 정확한 값은 시선과 구름 구면(반지름 R+h)의 교점입니다. 경사거리는
 * `r = -R sinε + sqrt(R²sin²ε + 2Rh + h²)` 인데, 이 형태는 천정에서
 * 큰 수 둘을 빼게 되어 유효숫자가 날아갑니다. 켤레를 곱해 정리한 아래
 * 형태는 어느 고도각에서도 상쇄가 없습니다.
 *
 * ε → 0 에서 `sqrt(2Rh + h²)` 로 **스스로 수렴**하므로 상한이 필요 없습니다.
 * `CloudDeck.ts`의 FRAG가 같은 식을 씁니다 — 격자와 셰이더가 하늘의 같은
 * 지점을 가리켜야 하기 때문입니다. (예전에는 저층에서 격자 138km,
 * 셰이더 60km로 **57% 어긋나** 있었습니다.)
 */
export function elevationToDistanceKm(elevDeg: number, altKm: number): number {
  const R = EARTH_RADIUS_KM;
  const er = Math.max(0, elevDeg) * D2R;
  const sinE = Math.max(0, Math.sin(er));
  const cosE = Math.cos(er);
  const chord = 2 * R * altKm + altKm * altKm;
  const r = chord / (R * sinE + Math.sqrt(R * R * sinE * sinE + chord));
  const theta = Math.asin(Math.min(1, Math.max(0, (r * cosE) / (R + altKm))));
  return (R + altKm) * theta;
}

/**
 * `elevationToDistanceKm`의 **역함수** — 거리 d에 있는 고도 h 점의 고도각.
 *
 * 관측자를 반지름 R의 구면 위 (0, R), 대상을 지심각 θ 만큼 떨어진 고도 h
 * 지점으로 두면 대상의 위치는 ((R+h)sinθ, (R+h)cosθ) 입니다. 관측자의
 * 국소 연직은 (0,1), 수평은 (1,0) 이므로
 *
 *   tan ε = ((R+h)cosθ − R) / ((R+h) sinθ)
 *
 * 입니다. `elevationToDistanceKm`이 d를 **구름 껍질 위의 호**로 정의하므로
 * (d = (R+h)·θ), 여기서도 θ = d/(R+h) 로 되돌립니다.
 *
 * 5단계에서 필요합니다: 밑면이 거리 d에 놓인 구름의 **꼭대기**가 몇 도에
 * 보이는지를 알아야 연직 각크기가 나옵니다.
 */
export function elevationFromDistanceDeg(distanceKm: number, altKm: number): number {
  const R = EARTH_RADIUS_KM;
  const Rh = R + Math.max(0, altKm);
  const theta = Math.max(1e-9, distanceKm) / Rh;
  return Math.atan2(Rh * Math.cos(theta) - R, Rh * Math.sin(theta)) * R2D;
}

// ── 공간 노이즈 ────────────────────────────────────────────────────────────
// 실측이 없는 방향을 메우고, 실측이 있는 곳에도 구조를 줍니다.
// **평균은 건드리지 않고 분산만** 담당합니다 — 평균을 흔들면 예보가 왜곡됩니다.

function hash2(x: number, y: number): number {
  let h = Math.imul(Math.round(x * 131.7) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(Math.round(y * 217.3) ^ 0xc2b2ae35, 0x27d4eb2f);
  h ^= h >>> 15;
  return ((h >>> 0) % 100000) / 100000;
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** 2~3 옥타브 fBm. 결과는 대략 0~1, 평균 0.5. */
export function fbm2(x: number, y: number, octaves: number = 3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let px = x;
  let py = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(px, py);
    norm += amp;
    px *= 2.03;
    py *= 2.03;
    amp *= 0.5;
  }
  return sum / Math.max(1e-6, norm);
}

// ── 실측 기상 샘플러 ───────────────────────────────────────────────────────

/**
 * 관측 팬을 (방위, 거리)로 조회할 수 있게 감싼 것.
 *
 * 실제 API 팬은 태양 방위 기준 `azOffset ∈ [-20,-10,0,10,20]`,
 * `distance ∈ [10,30,70,130,200,280,380]` 입니다. **360°가 아닙니다.**
 * 팬 밖은 관측점(0km) 값을 기저로 쓰고 신뢰도를 0으로 떨어뜨립니다.
 */
export class WeatherFan {
  private readonly byOffset = new Map<number, { distanceKm: number; data: CloudData }[]>();
  private readonly offsets: number[] = [];
  private readonly observer: CloudData | undefined;
  readonly fanCenterAzDeg: number;
  readonly hasData: boolean;

  constructor(samples: CloudData[], fanCenterAzDeg: number) {
    this.fanCenterAzDeg = fanCenterAzDeg;
    this.observer = samples.find(s => (s.distance ?? 0) === 0) ?? samples[0];

    for (const s of samples) {
      const off = s.azimuthOffset ?? 0;
      let arr = this.byOffset.get(off);
      if (!arr) {
        arr = [];
        this.byOffset.set(off, arr);
      }
      arr.push({ distanceKm: s.distance ?? 0, data: s });
    }
    for (const arr of this.byOffset.values()) arr.sort((a, b) => a.distanceKm - b.distanceKm);

    // 관측점(0km)은 **모든 레이가 만나는 같은 지점**입니다.
    //
    // Why 이게 필요한가: API 팬은 0km 표본을 오프셋 0 레이에만 답니다. 나머지
    // 레이는 첫 표본이 10km라 `alongRay`의 하한 클램프에 걸려, 관측자 바로 위를
    // **10km 밖 하늘로** 채웁니다. 저층운(고도 1.5km)은 고도각 8.5° 위쪽 전부가
    // 10km 안이므로 머리 위가 통째로 틀어집니다.
    //
    // 측정 (관측자 0%, 10km 밖 90%): 같은 천정 방향이 방위에 따라
    //   270°(팬 중심, 0km 표본 있음) 4.3%
    //   300°/330°(가장자리 레이 클램프) 84.1% / 82.2%
    //   0°/90°(팬 밖 → 관측점 대체)     0.0%
    // 하나의 물리적 지점이 세 값을 동시에 갖는 모순입니다.
    //
    // 0km 표본을 모든 레이의 시작점으로 복사하면 이 모순이 사라지고,
    // 머리 위가 실제 관측값으로 수렴합니다.
    const observer0 = samples.find(s => (s.distance ?? 0) === 0);
    if (observer0) {
      for (const arr of this.byOffset.values()) {
        if (arr.length === 0 || arr[0].distanceKm > 0) {
          arr.unshift({ distanceKm: 0, data: observer0 });
        }
      }
    }

    this.offsets = [...this.byOffset.keys()].sort((a, b) => a - b);
    this.hasData = samples.length > 0;
  }

  /** 한 레이(방위 오프셋)에서 거리 보간 */
  private alongRay(offset: number, distanceKm: number): CloudData | undefined {
    const arr = this.byOffset.get(offset);
    if (!arr || arr.length === 0) return undefined;
    if (distanceKm <= arr[0].distanceKm) return arr[0].data;
    const last = arr[arr.length - 1];
    if (distanceKm >= last.distanceKm) return last.data;

    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i];
      const b = arr[i + 1];
      if (distanceKm >= a.distanceKm && distanceKm <= b.distanceKm) {
        const t = (distanceKm - a.distanceKm) / Math.max(1e-6, b.distanceKm - a.distanceKm);
        // 강수·습도도 같이 보간합니다 (3단계). 예전에는 스프레드로 **가까운
        // 쪽 값이 그대로** 넘어와, 30km 표본과 70km 표본 사이 전 구간이
        // 30km의 강수를 썼습니다. 운량만 보간되고 운형 입력은 계단이었던 셈입니다.
        const lerpOpt = (x?: number, y?: number) =>
          x == null ? y : y == null ? x : x + (y - x) * t;
        return {
          ...a.data,
          low: a.data.low + (b.data.low - a.data.low) * t,
          mid: a.data.mid + (b.data.mid - a.data.mid) * t,
          high: a.data.high + (b.data.high - a.data.high) * t,
          precipitation: lerpOpt(a.data.precipitation, b.data.precipitation),
          humidity: lerpOpt(a.data.humidity, b.data.humidity),
        };
      }
    }
    return last.data;
  }

  /**
   * 절대 방위 + 거리로 조회.
   * 반환 `confidence`: 팬 안 1.0 → 팬 가장자리 밖으로 갈수록 0.
   */
  sample(azimuthDeg: number, distanceKm: number): { data: CloudData | undefined; confidence: number } {
    if (!this.hasData) return { data: undefined, confidence: 0 };

    // 태양 방위 기준 오프셋 (-180 ~ 180)
    const rel = ((azimuthDeg - this.fanCenterAzDeg + 540) % 360) - 180;

    const minOff = this.offsets[0] ?? 0;
    const maxOff = this.offsets[this.offsets.length - 1] ?? 0;

    // 팬 밖: 관측점 값 + 신뢰도 감쇠
    if (rel < minOff || rel > maxOff) {
      const edge = rel < minOff ? minOff : maxOff;
      const beyond = Math.abs(rel - edge);
      // 가장자리에서 45° 넘어가면 관측점 값만 씁니다.
      const conf = Math.max(0, 1 - beyond / 45);
      const edgeData = this.alongRay(edge, distanceKm);
      return {
        data: conf > 0 && edgeData ? edgeData : this.observer,
        confidence: conf,
      };
    }

    // 팬 안: 인접 두 레이 사이 보간
    let lo = this.offsets[0];
    let hi = this.offsets[this.offsets.length - 1];
    for (let i = 0; i < this.offsets.length - 1; i++) {
      if (rel >= this.offsets[i] && rel <= this.offsets[i + 1]) {
        lo = this.offsets[i];
        hi = this.offsets[i + 1];
        break;
      }
    }
    const a = this.alongRay(lo, distanceKm);
    const b = this.alongRay(hi, distanceKm);
    if (!a) return { data: this.observer, confidence: 0.4 };
    if (!b || lo === hi) return { data: a, confidence: 1 };

    const t = (rel - lo) / Math.max(1e-6, hi - lo);
    // 강수·습도도 같이 보간합니다 (3단계). 거리 방향과 같은 이유입니다 —
    // 스프레드만 두면 두 레이 사이 30° 전체가 낮은 쪽 레이의 강수를 씁니다.
    const lerpOpt = (x?: number, y?: number) =>
      x == null ? y : y == null ? x : x + (y - x) * t;
    return {
      data: {
        ...a,
        low: a.low + (b.low - a.low) * t,
        mid: a.mid + (b.mid - a.mid) * t,
        high: a.high + (b.high - a.high) * t,
        precipitation: lerpOpt(a.precipitation, b.precipitation),
        humidity: lerpOpt(a.humidity, b.humidity),
      },
      confidence: 1,
    };
  }

  observerData(): CloudData | undefined {
    return this.observer;
  }
}

/**
 * 바람 대용값 — **실측을 못 받았을 때만** 쓰입니다.
 *
 * 이제 `weather.ts: fetchLayerWinds` 가 관측점의 기압면 바람(850 / 600 /
 * 250 hPa)을 받아옵니다. 이 상수는 그 요청이 실패했을 때(모델이 기압면을
 * 지원하지 않는 지역·날짜, 네트워크 오류) 내려앉을 자리입니다.
 *
 * 값의 근거: 중위도 편서풍대의 온건한 대표값(서남서 260°, 22km/h).
 * 필라멘트 정렬에는 방향만 쓰이고, 축은 180° 주기라 "불어오는/불어가는"
 * 구분은 결과에 영향이 없습니다.
 */
export const PLACEHOLDER_WIND_SPEED_KMH = 22;
export const PLACEHOLDER_WIND_BEARING_DEG = 260;

/**
 * 실측 바람이 없을 때 쓸 층별 대용값.
 *
 * 한 값이 아니라 층마다 다른 이유: 대류권에서는 고도가 오를수록 바람이
 * 세집니다(제트류). 850 / 600 / 250 hPa 의 중위도 대표값을 대략 1 : 1.7 : 3.4
 * 로 두었습니다. 방향은 셋 다 같게 둡니다 — 실제로는 고도에 따라 도는
 * (thermal wind) 것이 보통이지만, 근거 없이 각도를 지어내면 층 사이가
 * 어긋나 보이기만 합니다.
 */
export const PLACEHOLDER_LAYER_WINDS: LayerWinds = {
  low: { speedKmh: PLACEHOLDER_WIND_SPEED_KMH, bearingDeg: PLACEHOLDER_WIND_BEARING_DEG },
  mid: { speedKmh: PLACEHOLDER_WIND_SPEED_KMH * 1.7, bearingDeg: PLACEHOLDER_WIND_BEARING_DEG },
  high: { speedKmh: PLACEHOLDER_WIND_SPEED_KMH * 3.4, bearingDeg: PLACEHOLDER_WIND_BEARING_DEG },
};

/**
 * 관측점 기상에서 층별 바람을 얻고, 없으면 대용값으로 내려앉습니다.
 * "바람이 실측인가"를 판단할 자리를 여기 하나로 모읍니다.
 */
export function resolveLayerWinds(obs?: CloudData | null): { winds: LayerWinds; measured: boolean } {
  const real = layerWindsFrom(obs);
  return real ? { winds: real, measured: true } : { winds: PLACEHOLDER_LAYER_WINDS, measured: false };
}

/**
 * U자 값 집합과 그 g 사다리.
 *
 * `base[rank] = uShape((rank + 0.5) / N)` 이므로 **값의 집합은 N에만
 * 의존합니다.** 프레임마다 바뀌는 것은 어느 방향이 어느 순위를 받느냐이지
 * 값 자체가 아닙니다. 따라서 `mean(base^g)` 도 매번 같고, g 사다리도 같습니다.
 *
 * 매 프레임 다시 만들면 사다리만으로 층당 40 × N 번의 `pow` 가 듭니다
 * (타임라인 288프레임 × 3층 = 660만 번). N으로 캐싱합니다.
 */
const uShapeCache = new Map<number, {
  base: Float64Array; gLadder: Float64Array; mLadder: Float64Array; GS: number;
}>();

function uShapeTable(n: number) {
  const hit = uShapeCache.get(n);
  if (hit) return hit;

  // U자 곡선. p = 1이면 균등, p > 1이면 가운데가 가팔라 질량이 양 끝으로
  // 밀립니다. v(0) = 0, v(1) = 1 이 정확히 성립합니다.
  const base = new Float64Array(n);
  for (let rank = 0; rank < n; rank++) {
    const x = (rank + 0.5) / n;
    const a = Math.pow(x, U_SHAPE_P);
    const b = Math.pow(1 - x, U_SHAPE_P);
    base[rank] = a / (a + b);
  }

  // g 사다리 (기하 등비). 평균은 g에 대해 감소하므로 표는 내림차순입니다.
  const GS = 40;
  const gLadder = new Float64Array(GS);
  const mLadder = new Float64Array(GS);
  for (let j = 0; j < GS; j++) {
    const g = Math.pow(10, -3 + (6 * j) / (GS - 1));   // 1e-3 ~ 1e3
    let m = 0;
    for (let i = 0; i < n; i++) m += Math.pow(base[i], g);
    gLadder[j] = g;
    mLadder[j] = m / n;
  }

  const built = { base, gLadder, mLadder, GS };
  uShapeCache.set(n, built);
  return built;
}

/**
 * 국소 평균 보정용 이웃 목록. 방위·고도 격자가 같으면 결과가 같으므로
 * 격자 크기로 캐싱합니다 (`buildSkyColumns`가 타임라인에서 288 × 3번 불립니다).
 */
const neighborhoodCache = new Map<string, { idx: Int32Array[]; w: Float64Array[] }>();

function neighborhood(
  staged: { azimuthDeg: number; elevationDeg: number }[],
  n: number,
  azSteps: number,
  elevSteps: number
): { idx: Int32Array[]; w: Float64Array[] } {
  const key = `${azSteps}x${elevSteps}`;
  const hit = neighborhoodCache.get(key);
  if (hit) return hit;

  const sinEl = new Float64Array(n);
  for (let i = 0; i < n; i++) sinEl[i] = Math.sin((staged[i].elevationDeg * Math.PI) / 180);

  const idx: Int32Array[] = new Array(n);
  const w: Float64Array[] = new Array(n);
  const idxBuf = new Int32Array(n);
  const wBuf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a0 = staged[i].azimuthDeg;
    let cnt = 0;
    for (let j = 0; j < n; j++) {
      let dAz = Math.abs(staged[j].azimuthDeg - a0);
      if (dAz > 180) dAz = 360 - dAz;
      if (dAz > LOCAL_AZ_DEG) continue;
      // 고도는 각도가 아니라 **sin 등간격**으로 재야 합니다 — 지평선 쪽 고리가
      // 각도로는 촘촘해서, 각도로 재면 이웃 크기가 하늘 위치마다 달라집니다.
      const dEl = Math.abs(sinEl[i] - sinEl[j]);
      if (dEl > LOCAL_ELEV_SIN) continue;
      idxBuf[cnt] = j;
      wBuf[cnt] = (1 - dAz / LOCAL_AZ_DEG) * (1 - dEl / LOCAL_ELEV_SIN);
      cnt++;
    }
    idx[i] = idxBuf.slice(0, cnt);
    w[i] = wBuf.slice(0, cnt);
  }
  const built = { idx, w };
  neighborhoodCache.set(key, built);
  return built;
}

export interface SkyColumnParams {
  fan: WeatherFan;
  /** 바람 이류를 반영하기 위한 시간 오프셋 (분). 구조가 하늘을 가로질러 흐릅니다. */
  driftMinutes: number;
  windSpeedKmh: number;
  windBearingDeg: number;
  /**
   * 층별 바람. 주면 `windSpeedKmh`/`windBearingDeg` 대신 **층마다** 다른
   * 이류를 씁니다 — 상층운이 하층운보다 서너 배 빨리 흐르는 것이 실제
   * 하늘에서 가장 눈에 띄는 바람의 흔적입니다.
   */
  layerWinds?: LayerWinds;
  azSteps?: number;
  elevSteps?: number;
}

/**
 * 층별 하늘 방향 샘플을 만듭니다.
 *
 * 반환 배열은 (층 × 방위 × 고도) 순서이고, 각 샘플이 같은 크기의 입체각을 담당합니다.
 */
export function buildSkyColumns(params: SkyColumnParams): LayerSample[] {
  const {
    fan,
    driftMinutes,
    windSpeedKmh,
    windBearingDeg,
    layerWinds,
    azSteps = AZ_STEPS,
    elevSteps = ELEV_STEPS,
  } = params;

  const elevs = elevationGrid(elevSteps);
  const out: LayerSample[] = [];

  // 바람 이류 — 구조가 시간에 따라 흐르도록 노이즈 좌표를 밀어줍니다.
  //
  // ⚠ 미는 방향은 **불어오는 쪽**입니다. 노이즈를 `x + d` 에서 읽으면
  // 무늬는 `-d` 로 움직이므로, 구름이 "불어가는 쪽"으로 흐르게 하려면
  // 좌표를 "불어오는 쪽"으로 밀어야 합니다. 기상 방위가 곧 그 값입니다.
  const driftOf = (w: { speedKmh: number; bearingDeg: number }) => {
    const km = (w.speedKmh * driftMinutes) / 60;
    const rad = w.bearingDeg * D2R;
    return { x: km * Math.sin(rad), y: km * Math.cos(rad) };
  };
  const fallbackDrift = driftOf({ speedKmh: windSpeedKmh, bearingDeg: windBearingDeg });

  (['low', 'mid', 'high'] as LayerKey[]).forEach(layer => {
    const altKm = LAYER_ALTITUDE_KM[layer];
    const { x: driftX, y: driftY } = layerWinds ? driftOf(layerWinds[layer]) : fallbackDrift;
    // 노이즈 셀 크기.
    //
    // 예전 값은 3.5 / 11 / 28 km — "실제 구름 구조의 규모"를 따른 것이었습니다.
    // 그런데 이 노이즈가 담당해야 하는 것은 구름 구조 전체가 아니라
    // **예보 격자가 못 담는 잔여분**입니다. 큰 규모는 이미 기상 링(방위 12 ×
    // 거리 7)이 실제 데이터로 주고 있으니까요.
    //
    // 11km는 격자 간격보다 커서 **인접 방향들이 같은 노이즈 값을 공유**했고,
    // 그러면 노이즈가 예보와 같은 규모에서 경쟁합니다. 그 경쟁을 국소 평균
    // 보정이 지우는데, 지우는 김에 U자 구조까지 같이 지워졌습니다
    // (측정: 표준편차 0.139, 파란 하늘 1.5%밖에 안 남음).
    //
    // 격자 간격 아래로 내리면 둘이 안 부딪힙니다. 그런데 무작정 잘게 하면
    // **시간 일관성**이 깨집니다 — 타임라인 키프레임이 5분 간격인데 바람
    // 22km/h면 그 사이에 1.8km 흐릅니다. 셀이 1.6km면 키프레임 사이에 무늬가
    // 통째로 뒤바뀌어, 구름이 흘러가는 게 아니라 자리에서 명멸합니다.
    //
    // 6실현 평균으로 세 지표를 함께 훑은 결과 (배율 → 지역오차 / 표준편차 /
    // 보간오차):
    //
    //   ×1.00  11.0km   1.9%p / 0.157 / 1.5%p   구조가 너무 없음
    //   ×0.50   5.5km   1.8%p / 0.195 / 3.1%p
    //   ×0.35   3.8km   1.5%p / 0.226 / 4.4%p   ← 채택
    //   ×0.15   1.6km   1.7%p / 0.263 / 7.9%p   구조는 최고, 명멸함
    //
    // 지역 예보 보존은 어느 배율에서도 국소 보정이 지켜 줍니다. 실제 상충은
    // 구조 ↔ 시간 일관성이고, 0.35가 그 균형점입니다.
    const cellKm = layer === 'low' ? 1.2 : layer === 'mid' ? 3.8 : 9.8;
    // 층마다 다른 오프셋 — 세 층이 같은 무늬로 겹치면 가짜처럼 보입니다.
    const layerOffset = layer === 'low' ? 0 : layer === 'mid' ? 37.1 : 73.9;

    // 1차: 평균 운량과 원시 노이즈를 모읍니다.
    const staged: {
      azimuthDeg: number;
      elevationDeg: number;
      distanceKm: number;
      meanCover: number;
      confidence: number;
      n: number;
      precipMmH: number;
      humidityPct: number;
      lowPct: number;
      highPct: number;
    }[] = [];

    for (let ai = 0; ai < azSteps; ai++) {
      const azimuthDeg = (ai * 360) / azSteps;
      const azRad = azimuthDeg * D2R;

      for (const elevationDeg of elevs) {
        const distanceKm = elevationToDistanceKm(elevationDeg, altKm);

        const { data, confidence } = fan.sample(azimuthDeg, distanceKm);
        const raw = data
          ? layer === 'low'
            ? data.low
            : layer === 'mid'
              ? data.mid
              : data.high
          : 0;
        const meanCover = Math.max(0, Math.min(1, raw / 100));

        // 지상 좌표에서 노이즈를 읽어야 방향이 바뀌어도 구조가 일관됩니다.
        // (하늘 각도로 읽으면 지평선 쪽이 늘어나 줄무늬가 생깁니다.)
        const gx = (distanceKm * Math.sin(azRad) + driftX) / cellKm;
        const gy = (distanceKm * Math.cos(azRad) + driftY) / cellKm;
        const n = fbm2(gx + layerOffset, gy + layerOffset, 3);

        staged.push({
          azimuthDeg, elevationDeg, distanceKm, meanCover, confidence, n,
          // 3단계: 이 방향 지점의 기상. 운량과 **같은 지점**에서 뽑아야
          // "비는 오는데 구름은 저쪽" 같은 모순이 생기지 않습니다.
          precipMmH: data?.precipitation ?? 0,
          humidityPct: data?.humidity ?? 60,
          lowPct: data?.low ?? 0,
          highPct: data?.high ?? 0,
        });
      }
    }

    // ── 순위 사상으로 U자 운량장 만들기 ──────────────────────────────────
    //
    // 예전에는 `cover = 평균 + (노이즈 - 노이즈평균) × 진폭` 이었습니다.
    // 평균은 잘 보존됐지만 **분포가 평균 주위 좁은 가우시안**이었습니다.
    // 중층 평균 50%로 재보면 하늘이 8%~94% 사이에 표준편차 0.14로 뭉쳐
    // **10% 미만인 방향이 0%, 90% 초과인 방향이 0%** 였습니다. 즉 어느 쪽을
    // 봐도 반쯤 덮인 하늘 — 파란 구멍도, 꽉 찬 덩어리도 없는 벽지입니다.
    // 진폭만 키우면 0과 1에서 잘려 평균이 밀리므로 그 길은 막혀 있습니다.
    //
    // 실제 운량장은 U자(이봉형)입니다. 하늘은 맑거나 덮이거나이고, 고르게
    // 반쯤 덮인 하늘이 오히려 드뭅니다. 사진에도 파란 구멍과 짙은 덩어리가
    // 같이 있습니다.
    //
    // 그래서 **1단계에서 셀 무늬에 썼던 히스토그램 평활화를 한 층 위에**
    // 그대로 적용합니다: 노이즈를 값으로 쓰지 않고 **순위**만 씁니다.
    //   1. 노이즈 순위 → 분위수 u
    //   2. u를 U자 곡선에 통과시켜 v (양 끝으로 질량을 밀어냄)
    //   3. 곡선 지수를 이분법으로 잡아 평균을 목표 운량에 맞춤
    //   4. 남은 오차를 단조 보정으로 정확히 0으로
    // 순위 사상은 단조라 **어느 방향이 더 흐린지**(공간 구조)는 노이즈가
    // 그대로 정합니다. 값만 다시 배분됩니다.
    //
    // 표본이 등입체각이므로(elevationGrid가 sin ε 균등) 순위 = 입체각
    // 분위수이고, 표본 평균 = 하늘 평균입니다. 예전 주석이 걱정하던
    // "지상에서 균일하게 안 퍼진다"는 문제도 순위를 쓰면 사라집니다 —
    // 노이즈 값의 편향이 순위에 영향을 주지 않기 때문입니다.
    const N = staged.length;
    if (N > 0) {
      const order = staged.map((_, i) => i).sort((a, b) => staged[a].n - staged[b].n);

      // `base` 값의 **집합**은 매번 같습니다 — 순위 분위수 (i+0.5)/N 을 고정된
      // 곡선에 통과시킨 것이라 N만 같으면 동일합니다. 바뀌는 건 어느 방향이
      // 어느 값을 받느냐(순서)뿐입니다. 그래서 값 집합도, 거기서 나오는 g
      // 사다리도 N으로 캐싱합니다.
      const { base: baseSorted, gLadder, mLadder, GS } = uShapeTable(N);
      const base = new Float64Array(N);
      for (let rank = 0; rank < N; rank++) base[order[rank]] = baseSorted[rank];

      // ── 방향마다 **자기 예보값**을 평균으로 갖게 합니다 ──────────────────
      //
      // `base^g` 의 평균은 g에 대해 단조 감소합니다. 그러니 목표 운량 c 마다
      // 대응하는 g가 하나 있습니다. 그 대응을 표로 만들어 두고 방향마다
      // 자기 c로 뽑아 씁니다.
      //
      // ⚠ 여기가 처음에 틀렸던 자리입니다. 층 전체 평균 하나로 U자를 만든 뒤
      // `cover = U자 + (그 방향 예보 − 층평균)` 으로 더해서 옮겼더니,
      // **[0,1] 클램프가 지역 평균을 파괴했습니다.** 서쪽 예보 5%인데 U자
      // 진폭이 ±40%p라 절반이 음수로 잘려나가고, 잘린 만큼 평균이 위로
      // 밀려 화면에서는 **26%**로 나왔습니다 (측정). 5배입니다.
      // 예전 코드가 `spread = 4c(1-c)`로 진폭을 줄여 두었던 게 바로 이
      // 클램프를 피하려던 것이었는데, 그 보호를 걷어내고 대책을 안 세웠습니다.
      //
      // 지수를 방향마다 다르게 주면 클램프가 아예 필요 없습니다. 예보 5%인
      // 지역은 큰 g가 걸려 대부분 0 근처, 일부만 1 근처가 되고 — 평균은
      // 정확히 0.05입니다. 맑은 하늘에 구름 몇 덩이, 그게 실제 모습입니다.
      // 예보 100%면 g → 0이라 `base^0 = 1`, 빈틈이 사라집니다. 예전
      // `spread → 0` 이 지키던 성질이 공짜로 따라옵니다.
      // 목표 평균 c → 지수 g (표를 로그 보간).
      const gammaFor = (c: number) => {
        if (c >= mLadder[0]) return gLadder[0];
        if (c <= mLadder[GS - 1]) return gLadder[GS - 1];
        for (let j = 0; j < GS - 1; j++) {
          if (c <= mLadder[j] && c >= mLadder[j + 1]) {
            const span = mLadder[j] - mLadder[j + 1];
            const t = span > 1e-12 ? (mLadder[j] - c) / span : 0;
            return Math.exp(Math.log(gLadder[j]) * (1 - t) + Math.log(gLadder[j + 1]) * t);
          }
        }
        return gLadder[GS - 1];
      };

      // 여기서는 사다리 보간만 씁니다. 지수가 정확히 c를 맞추는지는 확인하지
      // 않습니다 — 방향마다 `meanAt`을 다시 돌면 N²이 되고(타임라인 288프레임
      // × 3층이라 그것만으로 초 단위), **어차피 바로 아래 국소 보정이 더 강한
      // 보장을 겁니다**: 전역 평균이 아니라 이웃 평균을 목표에 맞추므로
      // 사다리 보간 오차도 사다리 끝의 미달도 거기서 함께 흡수됩니다.
      const shapedArr = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        shapedArr[i] = Math.pow(base[i], gammaFor(staged[i].meanCover));
      }

      // ── 국소 평균 보정 ────────────────────────────────────────────────────
      //
      // 위의 지수는 `base` **전체** 분포에 대해 평균을 맞춥니다. 그런데 fbm은
      // 공간 상관이 있어서, 한 지역에 속한 방향들의 `base` 값이 전체 분포를
      // 대표하지 않습니다 — 이웃한 방향은 비슷한 노이즈 값을 갖습니다.
      // 그래서 지역별로 평균이 밀립니다 (측정: 예보 47%인 넓은 구역이 35%로,
      // −11.9%p).
      //
      // 방향마다 **이웃의 실현 평균**과 **이웃의 예보 평균**을 견주어 그
      // 비율만큼 되돌립니다. 이웃 가중이 매끄러우므로 보정도 매끄럽고,
      // 경계에 이음매가 생기지 않습니다. 보정 자체는 앞서 쓴 것과 같은
      // 단조 유계 형태라 [0,1]을 벗어나지 않습니다.
      //
      // 이웃 크기가 관건입니다. 너무 좁으면 표본이 적어 U자 구조까지 같이
      // 지워지고, 너무 넓으면 지역차를 다시 뭉갭니다. 방위 ±45°·고도 ±2고리가
      // 렌더와 측정으로 고른 값입니다.
      // 이웃 목록은 **방향 격자에만** 의존합니다 — 방위·고도가 매번 같으므로
      // 층이 바뀌어도, 시각이 바뀌어도 그대로입니다. `buildSkyColumns`는
      // 타임라인에서 288번 × 3층 불리므로 매번 N²을 다시 훑으면 이것만으로
      // 수 초가 됩니다. 격자 크기로 캐싱합니다.
      const { idx: nbrIdx, w: nbrW } = neighborhood(staged, N, azSteps, elevSteps);

      const localMean = (arr: ArrayLike<number>, idx: number) => {
        const ix = nbrIdx[idx], wt = nbrW[idx];
        let w = 0, acc = 0;
        for (let k = 0; k < ix.length; k++) { w += wt[k]; acc += wt[k] * arr[ix[k]]; }
        return w > 0 ? acc / w : 0;
      };
      const targets = new Float64Array(N);
      for (let i = 0; i < N; i++) targets[i] = staged[i].meanCover;

      for (let i = 0; i < N; i++) {
        const s = staged[i];
        const c = s.meanCover;
        let shaped = shapedArr[i];
        const R = localMean(shapedArr, i);
        const T = localMean(targets, i);
        if (R > T + 1e-9 && R > 1e-9) shaped *= T / R;
        else if (R < T - 1e-9 && R < 1 - 1e-9) {
          shaped = 1 - (1 - shaped) * ((1 - T) / (1 - R));
        }
        // U자 구조 혼합
        // Nimbostratus나 Stratus처럼 cellStrength가 없는 층은 틈새(파란 하늘)를 허용하면 안 되므로
        // U-shape 효과를 무효화하고 cover를 강제로 올려 틈을 메웁니다.
        const preset = resolvePresetFromWeather(layer, c, {
          precipitation: s.precipMmH,
          humidity: s.humidityPct,
          lowPct: s.lowPct,
          highPct: s.highPct,
        }, i * 13.7);
        const cellStrength = PRESET_OPTICS[preset]?.cellStrength ?? 1.0;
        
        let k = Math.min(1, U_SHAPE_MIX * (1 + (1 - s.confidence) * 0.3));
        let targetC = c;
        if (cellStrength < 0.1) {
          k = 0; // U자형 구조(빈 틈과 두꺼운 덩어리)를 없앱니다.
          targetC = Math.max(targetC, 0.98); // 강제로 빈 틈을 메움
        }
        
        const cover = Math.max(0, Math.min(1, targetC + (shaped - targetC) * k));

        out.push({
          layer,
          azimuthDeg: s.azimuthDeg,
          elevationDeg: s.elevationDeg,
          distanceKm: s.distanceKm,
          cover,
          confidence: s.confidence,
          precipMmH: s.precipMmH,
          humidityPct: s.humidityPct,
          lowPct: s.lowPct,
          highPct: s.highPct,
        });
      }
    }
  });

  return out;
}

// ── 수직 광학 스택 ─────────────────────────────────────────────────────────

/** 두 층의 반사·투과를 합성 (adding method) */
export function addLayers(
  R1: number,
  T1: number,
  R2: number,
  T2: number
): { R: number; T: number } {
  // 층 사이 다중 반사를 무시하면 다층운이 부자연스럽게 밝아집니다.
  const denom = Math.max(1e-4, 1 - R1 * R2);
  return {
    R: R1 + (T1 * T1 * R2) / denom,
    T: (T1 * T2) / denom,
  };
}

/** 광학두께 → 2-stream 반사·투과 (CLOUD_G = 0.85) */
export function cloudRT(tau: number): { R: number; T: number } {
  const tauEff = tau * (1 - 0.85);
  return { R: tauEff / (tauEff + 2), T: 2 / (tauEff + 2) };
}

export interface ColumnOptics {
  /**
   * 각 층에 닿는 **평행광(직달)** 배율.
   *
   * Beer-Lambert `exp(-τ/sinθ)`입니다. 2-stream의 T와 구분해야 합니다 —
   * T는 직달+확산 총 투과율이고, 구름의 밝은 면/그늘 면 대비를 만드는 것은
   * 오직 평행광입니다. 위층이 두꺼우면 이 값이 0에 붙고, 그 순간 아래 구름의
   * 명암이 사라져 평평한 회색이 됩니다. 그것이 흐린 날입니다.
   */
  beamFactor: Record<LayerKey, number>;
  /**
   * 각 층에 위에서 내려오는 **확산광** 배율 (2-stream T).
   *
   * 평행광이 죽어도 이 빛은 남습니다. 흐린 날이 캄캄하지 않고 균일하게
   * 밝은 회색인 이유입니다. 이걸 빠뜨리면 8/8 하늘이 새까매집니다.
   */
  diffuseFactor: Record<LayerKey, number>;
  /** 관측자가 태양 원반을 볼 때의 직달 투과율 (원반 차폐) */
  sunTransmittance: number;
  /** 하늘 전체를 통과해 내려오는 확산광 비율 */
  diffuseToGround: number;
}

/**
 * 태양 방향 기둥을 풀어 층별 직달광 감쇠를 구합니다.
 *
 * **이 항이 흐린 날의 변곡점입니다.** 이전에는 각 구름이 독립이라 상층이
 * 완전히 덮여도 그 아래 저층운이 직달광 100%를 받았습니다. 그래서 아무리
 * 두꺼운 구름을 쌓아도 "햇빛 받은 뭉게구름"으로 보였습니다.
 *
 * 직달광이 사라지면 밝은 면/그늘 면 대비가 소멸하고, 그제야 평평한 회색이 됩니다.
 */
export function solveColumnOptics(
  samples: LayerSample[],
  sunAzDeg: number,
  sunAltDeg: number,
  tauFor: (layer: LayerKey) => number
): ColumnOptics {
  // 태양 방향에서 각 층의 운량을 읽습니다.
  const coverTowardSun = (layer: LayerKey): number => {
    const altKm = LAYER_ALTITUDE_KM[layer];
    const dist = elevationToDistanceKm(Math.max(3, sunAltDeg), altKm);
    let best: LayerSample | undefined;
    let bestScore = Infinity;
    for (const s of samples) {
      if (s.layer !== layer) continue;
      const dAz = Math.abs(((s.azimuthDeg - sunAzDeg + 540) % 360) - 180);
      const dD = Math.abs(s.distanceKm - dist) / Math.max(1, dist);
      const score = dAz / 30 + dD;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best?.cover ?? 0;
  };

  // 경사 경로 배율 — 태양이 낮으면 구름을 더 길게 통과합니다.
  const slant = 1 / Math.max(0.12, Math.sin(Math.max(3, sunAltDeg) * D2R));

  // 층별 (R, T) — 확산 성분. 운량이 1 미만이면 그 비율만큼만 가립니다.
  const layerRT = (layer: LayerKey): { R: number; T: number } => {
    const c = Math.max(0, Math.min(1, coverTowardSun(layer)));
    if (c <= 0.001) return { R: 0, T: 1 };
    const { R, T } = cloudRT(tauFor(layer));
    // 구름이 덮은 부분은 (R,T), 나머지는 그대로 통과.
    return { R: R * c, T: T * c + (1 - c) };
  };

  // 층별 평행광 투과 — Beer-Lambert. 구름이 덮은 비율만 감쇠합니다.
  const layerDirect = (layer: LayerKey): number => {
    const c = Math.max(0, Math.min(1, coverTowardSun(layer)));
    if (c <= 0.001) return 1;
    const through = Math.exp(-tauFor(layer) * slant);
    return through * c + (1 - c);
  };

  const high = layerRT('high');
  const mid = layerRT('mid');
  const low = layerRT('low');

  const dHigh = layerDirect('high');
  const dMid = layerDirect('mid');
  const dLow = layerDirect('low');

  // 확산은 위에서부터 adding으로 쌓습니다 (층간 다중반사 포함).
  const highMid = addLayers(high.R, high.T, mid.R, mid.T);
  const all = addLayers(highMid.R, highMid.T, low.R, low.T);

  return {
    // 평행광은 단순 곱 — 직달광은 한 번 산란되면 더 이상 직달이 아닙니다.
    beamFactor: {
      high: 1,
      mid: dHigh,
      low: dHigh * dMid,
    },
    diffuseFactor: {
      high: 1,
      mid: high.T,
      low: highMid.T,
    },
    sunTransmittance: dHigh * dMid * dLow,
    diffuseToGround: all.T,
  };
}

/**
 * **방향마다 다른 그늘** — 그 방향 그 층의 구름에 닿는 직달광 배율
 * (docs/CLOUD_VARIETY_PLAN.md 4단계).
 *
 * ## 왜 필요한가
 *
 * `solveColumnOptics`는 **관측점 수직 기둥 하나**를 풀고 그 `beamFactor`를
 * 하늘 전체에 씁니다. 그래서 서쪽에 두꺼운 상층 띠가 있으면 **동쪽 저층까지
 * 같이 어두워집니다.** 실제로는 옆 구름이 그늘인데 이 구름만 빛을 받는
 * 그 대비가 노을 하늘의 인상을 거의 다 만듭니다.
 *
 * ## 기하
 *
 * 방위 az·지상거리 d·고도 h에 있는 구름에 닿는 햇빛은, 거기서 **태양 쪽으로**
 * 올라가며 위층을 지납니다. 고도 h2에서의 관통점은 지상 좌표로
 *
 *   P = d·(sin az, cos az) + Δ·(sin az☉, cos az☉),
 *   Δ = dist(az☉고도, h2) − dist(az☉고도, h)
 *
 * 입니다. Δ를 두 구면 거리의 차로 잡으면 지구 곡률이 자동으로 들어옵니다 —
 * 평면 근사 (h2−h)/tan(ε)는 태양이 낮을 때 크게 빗나갑니다.
 *
 * 태양 고도 3° 미만은 3°로 잡습니다(기하가 발산). 그 아래에서는 어차피
 * 직달광 자체가 거의 없어 배율의 차이가 화면에 남지 않습니다.
 *
 * ## 확산광은 왜 안 하나
 *
 * 확산광은 반구 전체에서 오므로 한 방향의 위층 운량에 거의 좌우되지
 * 않습니다. 방향성이 있는 것은 평행광뿐이고, 밝은 면/그늘 면 대비를 만드는
 * 것도 평행광입니다. 확산은 관측점 기둥 값(`diffuseFactor`)을 그대로 씁니다.
 *
 * @returns `samples`와 **같은 인덱스**의 배율 배열 (1 = 그늘 없음)
 */
export function solveDirectionalShade(
  samples: LayerSample[],
  sunAzDeg: number,
  sunAltDeg: number,
  tauFor: (layer: LayerKey) => number,
  azSteps: number = AZ_STEPS,
  elevSteps: number = ELEV_STEPS
): Float32Array {
  const out = new Float32Array(samples.length);
  out.fill(1);

  const elevs = elevationGrid(elevSteps);
  const nE = elevs.length;
  const layers: LayerKey[] = ['low', 'mid', 'high'];

  // 층별 인덱스 목록. samples는 층 → 방위 → 고도 순이지만, 그 가정에
  // 기대지 않고 실제로 모읍니다 (타임라인 경로가 순서를 바꿔도 안전하도록).
  const idxOf: Record<LayerKey, number[]> = { low: [], mid: [], high: [] };
  for (let i = 0; i < samples.length; i++) idxOf[samples[i].layer].push(i);
  for (const L of layers) {
    if (idxOf[L].length !== azSteps * nE) return out; // 격자가 다르면 그늘 없음
  }

  // 고도각 → 지상거리 (층마다 고정). 고도각이 오르면 거리는 줄어듭니다.
  const distByElev: Record<LayerKey, number[]> = { low: [], mid: [], high: [] };
  for (const L of layers) {
    for (let e = 0; e < nE; e++) {
      distByElev[L].push(elevationToDistanceKm(elevs[e], LAYER_ALTITUDE_KM[L]));
    }
  }

  /** 층 L의 지상 좌표 (az, dist)에서 운량을 이중선형으로 읽습니다. */
  const coverAtGround = (L: LayerKey, azDeg: number, distKm: number): number => {
    const ix = idxOf[L];
    const aF = ((azDeg % 360) + 360) % 360 / (360 / azSteps);
    const a0 = Math.floor(aF) % azSteps;
    const a1 = (a0 + 1) % azSteps;
    const at = aF - Math.floor(aF);

    const dArr = distByElev[L];
    // 내림차순. dist가 dArr[e] 와 dArr[e+1] 사이인 e를 찾습니다.
    let e0 = 0;
    while (e0 < nE - 2 && dArr[e0 + 1] > distKm) e0++;
    const e1 = Math.min(nE - 1, e0 + 1);
    const span = dArr[e0] - dArr[e1];
    const et = span > 1e-6 ? Math.max(0, Math.min(1, (dArr[e0] - distKm) / span)) : 0;

    const c = (a: number, e: number) => samples[ix[a * nE + e]].cover;
    return (
      (c(a0, e0) * (1 - et) + c(a0, e1) * et) * (1 - at) +
      (c(a1, e0) * (1 - et) + c(a1, e1) * et) * at
    );
  };

  const sunAltEff = Math.max(3, sunAltDeg);
  const sunRad = sunAzDeg * D2R;
  const sunX = Math.sin(sunRad);
  const sunY = Math.cos(sunRad);
  const slant = 1 / Math.max(0.12, Math.sin(sunAltEff * D2R));
  // 태양 쪽으로 올라가며 각 고도에 닿는 지상거리.
  const rayDist: Record<LayerKey, number> = {
    low: elevationToDistanceKm(sunAltEff, LAYER_ALTITUDE_KM.low),
    mid: elevationToDistanceKm(sunAltEff, LAYER_ALTITUDE_KM.mid),
    high: elevationToDistanceKm(sunAltEff, LAYER_ALTITUDE_KM.high),
  };
  const through: Record<LayerKey, number> = {
    low: Math.exp(-tauFor('low') * slant),
    mid: Math.exp(-tauFor('mid') * slant),
    high: Math.exp(-tauFor('high') * slant),
  };

  for (const L of layers) {
    const above = layers.filter(U => LAYER_ALTITUDE_KM[U] > LAYER_ALTITUDE_KM[L]);
    if (above.length === 0) continue; // 상층은 위에 아무것도 없습니다
    for (const i of idxOf[L]) {
      const s = samples[i];
      const azRad = s.azimuthDeg * D2R;
      const px = s.distanceKm * Math.sin(azRad);
      const py = s.distanceKm * Math.cos(azRad);
      let f = 1;
      for (const U of above) {
        const delta = rayDist[U] - rayDist[L];
        const qx = px + delta * sunX;
        const qy = py + delta * sunY;
        const dist = Math.sqrt(qx * qx + qy * qy);
        const az = (Math.atan2(qx, qy) * R2D + 360) % 360;
        const c = Math.max(0, Math.min(1, coverAtGround(U, az, dist)));
        // 덮인 비율만 감쇠 — `solveColumnOptics`의 layerDirect와 같은 식입니다.
        f *= through[U] * c + (1 - c);
      }
      out[i] = f;
    }
  }
  return out;
}

/**
 * 22° 무리가 보일 조건인지 판정합니다.
 *
 * 무리는 **얇은 권층운**에서만 보입니다. 조건이 꽤 까다롭습니다:
 *  - 상층이 어느 정도 덮여 있어야 합니다 (얼음 결정이 있어야 하므로)
 *  - 그런데 너무 두꺼우면 안 됩니다 — 빛이 여러 번 산란되면 각이 흩어져 사라집니다
 *  - 저·중층이 가리고 있으면 애초에 태양이 안 보입니다
 *  - 태양이 지평선 근처면 고리 아래쪽이 잘려 잘 안 보입니다
 */
export function haloStrength(
  highCover: number,
  lowCover: number,
  midCover: number,
  sunAltDeg: number
): number {
  // 상층이 있어야 하지만, 0.85를 넘어 두꺼워지면 다중산란으로 흐려집니다.
  const ice = Math.min(
    smoothstep01(0.25, 0.55, highCover),
    1 - smoothstep01(0.85, 1.0, highCover)
  );
  // 아래층이 가리면 못 봅니다.
  const clearBelow = (1 - smoothstep01(0.2, 0.6, lowCover)) * (1 - smoothstep01(0.3, 0.7, midCover));
  // 태양이 22° 위로 올라와야 고리가 온전히 보입니다.
  const alt = smoothstep01(6, 24, sunAltDeg);
  return Math.max(0, Math.min(1, ice * clearBelow * alt));
}

function smoothstep01(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * 층별 하늘 전체 평균 운량 (입체각 가중).
 *
 * 등입체각 격자를 쓰므로 단순 산술평균이 곧 입체각 가중 평균입니다.
 * 검증에서 "입력 운량이 보존되는가"를 확인하는 데 씁니다.
 */
export function layerMeanCover(samples: LayerSample[], layer: LayerKey): number {
  let sum = 0;
  let n = 0;
  for (const s of samples) {
    if (s.layer !== layer) continue;
    sum += s.cover;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}
