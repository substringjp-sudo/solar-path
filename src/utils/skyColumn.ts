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
import type { CloudData } from './weather';

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
export function elevationGrid(steps: number = ELEV_STEPS): number[] {
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    // sin ε 를 (0, 1] 구간에서 균등 분할하고 셀 중앙을 취합니다.
    const s = (i + 0.5) / steps;
    out.push(Math.asin(Math.min(1, s)) * R2D);
  }
  return out;
}

/**
 * 고도각 → 지상 투영 거리.
 *
 * 평면 근사 `d = h / tan ε` 를 쓰되, 지평선 근처에서 무한대로 발산하지 않도록
 * 지구 곡률 한계(구름층이 지평선에 잠기는 거리)로 자릅니다.
 * 고도 h인 층이 보이는 최대 거리는 `sqrt(2 R h)` 근처입니다 (R = 6371km).
 */
export function elevationToDistanceKm(elevDeg: number, altKm: number): number {
  const horizonKm = Math.sqrt(2 * 6371 * altKm);
  if (elevDeg <= 0.05) return horizonKm;
  const d = altKm / Math.tan(elevDeg * D2R);
  return Math.min(horizonKm, d);
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
        return {
          ...a.data,
          low: a.data.low + (b.data.low - a.data.low) * t,
          mid: a.data.mid + (b.data.mid - a.data.mid) * t,
          high: a.data.high + (b.data.high - a.data.high) * t,
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
    return {
      data: {
        ...a,
        low: a.low + (b.low - a.low) * t,
        mid: a.mid + (b.mid - a.mid) * t,
        high: a.high + (b.high - a.high) * t,
      },
      confidence: 1,
    };
  }

  observerData(): CloudData | undefined {
    return this.observer;
  }
}

export interface SkyColumnParams {
  fan: WeatherFan;
  /** 바람 이류를 반영하기 위한 시간 오프셋 (분). 구조가 하늘을 가로질러 흐릅니다. */
  driftMinutes: number;
  windSpeedKmh: number;
  windBearingDeg: number;
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
    azSteps = AZ_STEPS,
    elevSteps = ELEV_STEPS,
  } = params;

  const elevs = elevationGrid(elevSteps);
  const out: LayerSample[] = [];

  // 바람 이류 — 구조가 시간에 따라 흐르도록 노이즈 좌표를 밀어줍니다.
  const driftKm = (windSpeedKmh * driftMinutes) / 60;
  const windRad = windBearingDeg * D2R;
  const driftX = driftKm * Math.sin(windRad);
  const driftY = driftKm * Math.cos(windRad);

  (['low', 'mid', 'high'] as LayerKey[]).forEach(layer => {
    const altKm = LAYER_ALTITUDE_KM[layer];
    // 노이즈 셀 크기는 그 층의 실제 구름 구조 규모를 따릅니다.
    // 저층 적운은 수 km 간격, 상층 권운은 수십 km 규모로 뭉칩니다.
    const cellKm = layer === 'low' ? 3.5 : layer === 'mid' ? 11 : 28;
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

        staged.push({ azimuthDeg, elevationDeg, distanceKm, meanCover, confidence, n });
      }
    }

    // 노이즈 평균 보정.
    //
    // Why 필요한가: 하늘 방향 샘플은 지상에서 **균일하게 퍼지지 않습니다.**
    // 저층 1.5km 층은 고도각 3.6°에서 24km, 69.6°에서 0.56km라
    // 8개 고리 중 6개가 반경 5km 안에 몰립니다. 그 샘플들이 노이즈 셀 하나를
    // 공유해 버리면 그 셀 값이 하늘 전체 평균을 끌고 갑니다.
    // (측정: 입력 50%가 화면 29%로 나왔습니다.)
    //
    // 실현된 노이즈 평균을 빼서 편차만 남기면, 구조는 유지하면서
    // 입력 운량이 정확히 보존됩니다.
    let nSum = 0;
    for (const s of staged) nSum += s.n;
    const nMean = staged.length ? nSum / staged.length : 0.5;

    for (const s of staged) {
      // 분산은 평균이 0이나 1에 가까울수록 0으로 수렴합니다.
      // 맑으면 완전히 맑고, 8/8이면 빈틈이 없어야 하기 때문입니다.
      const spread = 4 * s.meanCover * (1 - s.meanCover);
      // 신뢰도가 낮은 방향(팬 밖)은 노이즈 비중을 키워 구조를 만듭니다.
      const amp = 0.42 * spread * (1 + (1 - s.confidence) * 0.5);
      const cover = Math.max(0, Math.min(1, s.meanCover + (s.n - nMean) * 2 * amp));

      out.push({
        layer,
        azimuthDeg: s.azimuthDeg,
        elevationDeg: s.elevationDeg,
        distanceKm: s.distanceKm,
        cover,
        confidence: s.confidence,
      });
    }
  });

  return out;
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
