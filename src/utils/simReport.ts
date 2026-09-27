/**
 * simReport.ts
 *
 * 화면에 QR로 박아 두는 "이 프레임을 만든 입력값" 요약.
 *
 * Why: 렌더된 사진 한 장만 보고는 어떤 기상값이 이 하늘을 만들었는지
 * 역추적할 수 없습니다. 이 프로젝트에서 반복된 문제가 그것이었습니다 —
 * "이 사진이 어떤 예보에서 나왔는가"를 추측하느라 매번 렌더를 다시
 * 돌렸습니다. QR 하나면 캡처만으로 정확한 입력을 그대로 얻습니다.
 *
 * 여기 담는 것은 **입력**뿐입니다. τ·beamFactor 같은 유도값은 넣지
 * 않습니다 — 여기 있는 입력에서 그대로 다시 계산되므로, 넣으면 같은
 * 사실을 두 번 말하는 셈이고 계산식이 바뀌면 둘이 갈립니다.
 *
 * RN·THREE에 의존하지 않는 순수 함수라 QR 렌더러(RN)와 디코드 도구(Node)가
 * 같은 스키마를 공유합니다.
 */

export const SIM_REPORT_VERSION = 1 as const;

export interface SimReportObs {
  /** 저·중·상층 운량 (%) */
  low: number;
  mid: number;
  high: number;
  /** 모델이 스스로 낸 **총운량** (%). 층 합이 아닙니다 (§60). */
  total?: number;
  /** 2m 상대습도 (%) */
  humidity?: number;
  /** 강수 (mm/h) */
  precip?: number;
  /** 지표 시정 (m) */
  vis?: number;
  /** 법선면 직달일사 (W/m²) */
  dni?: number;
  /** 대기 중 수분량 — total column water vapour (kg/m²) */
  water?: number;
}

export interface SimReportPayload {
  v: typeof SIM_REPORT_VERSION;
  /** 이 프레임이 표현하는 시각 (ISO 8601) — 기기의 현재 시각이 아닙니다 */
  t: string;
  lat: number;
  lon: number;
  /** 관측자 고도 (m) */
  elevM: number;
  sunAlt: number;
  sunAz: number;
  /** 관측점 예보 — `resolvePresetFromWeather`·`makeAtmosphereParams`가 그대로 쓰는 값 */
  obs: SimReportObs;
  /**
   * 하층(850 hPa) 바람.
   *
   * `synthetic` 은 이 값의 **출처**입니다 — `false` 면 Open-Meteo 기압면
   * 실측, `true` 면 그걸 못 받아서 내려앉은 대용 상수
   * (`skyColumn.ts: PLACEHOLDER_LAYER_WINDS`). 캡처에 남겨 두어야 나중에
   * "왜 이 방향으로 결이 누웠나"를 실제 바람으로 오인하지 않습니다.
   */
  wind: { kmh: number; deg: number; synthetic: boolean };
  /**
   * 셔터를 누른 순간의 **3D 시선**: 방위 · 고도 · 기울임 · 세로 화각 · 가로/세로 비.
   *
   * ⚠ 위의 "입력만" 원칙의 예외입니다. 시선은 센서값이라 예보에서 다시 계산할 수 없는데, 없으면
   *   기기 화면을 되살릴 수 없었습니다(2026-09-27 마쓰모토 천정 꽃잎 — 하네스가 어느 각도를
   *   그려야 할지 몰랐습니다).
   */
  view?: { az: number; el: number; roll: number; fov: number; asp: number };
  /**
   * 구름판이 **실제로 받은** 값 — 예보에서 여러 단계를 거쳐 나와 입력만으로는 같게 못 만듭니다.
   * alt 층 높이(km) · deck 운해 밑·윗면(km, 모르면 −1) · fog 구름 속 안개 [소광, 밑, 위] ·
   * eyeM 눈높이 · drift 이류 시각(h) · city 도시광 · nf 근거리 볼륨 · wind 층별 바람 벡터
   * (km/h, 저·중·상 × 동·남) · cov 천정 둘레 운량 — 층마다 **두 자리 숫자 16개를 이은 문자열**
   * (2km 고리 8방위, 10km 고리 8방위, 북부터 45° 간격, 0~99; `readCloudSlabState`).
   *
   * ⚠ 짧게 적습니다. 숫자 배열로 두었더니 QR 이 97칸으로 촘촘해져 250px 캡처에서 못 읽었습니다.
   *   관측 고도는 elevM 과 같아 뺐습니다.
   */
  slab?: {
    alt: number[]; deck: number[]; fog: number[];
    eyeM: number; drift: number; city: number; nf: number;
    wind: number[];
    cov: { l: string; m: string; h: string };
  };
  /** 스냅샷 직전 GL 버퍼 가운데 밝기(0~255) — 썸네일 칸의 "GL" 값과 같습니다. */
  gl?: number;
}

const round = (v: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

/** 0~99 값들을 두 자리씩 이은 문자열로 — QR 을 덜 촘촘하게 합니다. */
const packCover = (v: number[]): string =>
  v.map(x => String(Math.max(0, Math.min(99, Math.round(x)))).padStart(2, '0')).join('');

const roundOpt = (v: number | undefined, decimals: number): number | undefined =>
  v == null || Number.isNaN(v) ? undefined : round(v, decimals);

export interface BuildSimReportParams {
  /** 프레임이 표현하는 시각 (epoch ms) */
  simTimeMs: number;
  latitude: number;
  longitude: number;
  observerElevM: number;
  sunAltDeg: number;
  sunAzDeg: number;
  obs:
    | {
        low?: number;
        mid?: number;
        high?: number;
        total?: number;
        humidity?: number;
        precipitation?: number;
        visibility?: number;
        directNormalIrradiance?: number;
        totalColumnWaterVapour?: number;
      }
    | undefined;
  windSpeedKmh: number;
  windBearingDeg: number;
  /** 위 두 값이 대용 상수인가 (실측이면 false) */
  windSynthetic: boolean;
  /** 3D 시선 (없으면 싣지 않음) */
  view?: { az: number; el: number; roll: number; fov: number; aspect: number };
  /** 구름판 상태 (`readCloudSlabState` 의 값, 없으면 싣지 않음) */
  slab?: {
    layerAltKm: number[]; lowDeckKm: number[]; fog: number[];
    observerAltKm: number; eyeHeightM: number; driftHours: number; cityLight: number; nearField: number;
    winds: number[];
    cover: { low: number[]; mid: number[]; high: number[] };
  } | null;
  /** 스냅샷 직전 GL 버퍼 밝기 (−1 이면 못 잼) */
  glMean?: number;
}

export function buildSimReportPayload(params: BuildSimReportParams): SimReportPayload {
  const { obs } = params;
  return {
    v: SIM_REPORT_VERSION,
    t: new Date(params.simTimeMs).toISOString(),
    // 4자리 소수 ≈ 11m. 그 이상의 정밀도는 이 용도에 필요 없습니다.
    lat: round(params.latitude, 4),
    lon: round(params.longitude, 4),
    elevM: Math.round(params.observerElevM),
    sunAlt: round(params.sunAltDeg, 2),
    sunAz: round(params.sunAzDeg, 2),
    obs: {
      low: Math.round(obs?.low ?? 0),
      mid: Math.round(obs?.mid ?? 0),
      high: Math.round(obs?.high ?? 0),
      // 모델이 스스로 낸 총운량. 층을 합친 값이 아니라 별도 변수입니다(§60).
      // 다음 기기 판정에서 "층 합보다 이게 하늘과 맞나" 를 눈으로 갈리려고 싣습니다.
      total: roundOpt(obs?.total, 0),
      humidity: roundOpt(obs?.humidity, 0),
      precip: roundOpt(obs?.precipitation, 2),
      vis: roundOpt(obs?.visibility, 0),
      dni: roundOpt(obs?.directNormalIrradiance, 0),
      water: roundOpt(obs?.totalColumnWaterVapour, 1),
    },
    wind: {
      kmh: round(params.windSpeedKmh, 1),
      deg: round(params.windBearingDeg, 1),
      synthetic: params.windSynthetic,
    },
    view: params.view
      ? {
          az: round(params.view.az, 1),
          el: round(params.view.el, 1),
          roll: round(params.view.roll, 1),
          fov: round(params.view.fov, 1),
          asp: round(params.view.aspect, 3),
        }
      : undefined,
    slab: params.slab
      ? {
          alt: params.slab.layerAltKm.map(v => round(v, 2)),
          deck: params.slab.lowDeckKm.map(v => round(v, 2)),
          fog: params.slab.fog.map(v => round(v, 2)),
          eyeM: round(params.slab.eyeHeightM, 0),
          drift: round(params.slab.driftHours, 1),
          city: round(params.slab.cityLight, 2),
          nf: round(params.slab.nearField, 0),
          wind: params.slab.winds.map(v => Math.round(v)),
          cov: {
            l: packCover(params.slab.cover.low),
            m: packCover(params.slab.cover.mid),
            h: packCover(params.slab.cover.high),
          },
        }
      : undefined,
    gl: params.glMean != null && params.glMean >= 0 ? Math.round(params.glMean) : undefined,
  };
}

/**
 * QR에 넣을 문자열로 직렬화합니다.
 *
 * `JSON.stringify`는 `undefined` 필드를 자동으로 빼므로, 관측값이 없는
 * 필드(예: 시정 미제공 지역)는 페이로드에서 조용히 사라집니다.
 */
export function encodeSimReportPayload(payload: SimReportPayload): string {
  return JSON.stringify(payload);
}
