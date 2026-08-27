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
   * 바람. **실측이 아니라 대용 상수입니다** — `skyColumn.ts`의
   * `PLACEHOLDER_WIND_SPEED_KMH`/`PLACEHOLDER_WIND_BEARING_DEG`를 그대로
   * 옮긴 것입니다. `synthetic: true`로 그 사실을 캡처에도 남겨, 나중에
   * "왜 이 방향으로 결이 누웠나"를 실제 바람으로 오인하지 않게 합니다.
   */
  wind: { kmh: number; deg: number; synthetic: true };
}

const round = (v: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

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
        humidity?: number;
        precipitation?: number;
        visibility?: number;
        directNormalIrradiance?: number;
        totalColumnWaterVapour?: number;
      }
    | undefined;
  windSpeedKmh: number;
  windBearingDeg: number;
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
      humidity: roundOpt(obs?.humidity, 0),
      precip: roundOpt(obs?.precipitation, 2),
      vis: roundOpt(obs?.visibility, 0),
      dni: roundOpt(obs?.directNormalIrradiance, 0),
      water: roundOpt(obs?.totalColumnWaterVapour, 1),
    },
    wind: {
      kmh: round(params.windSpeedKmh, 1),
      deg: round(params.windBearingDeg, 1),
      synthetic: true,
    },
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
