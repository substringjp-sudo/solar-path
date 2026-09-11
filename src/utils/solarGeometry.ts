/**
 * solarGeometry.ts
 *
 * **등치선과 태양경로는 같은 그림의 두 부분입니다.** 이 모듈이 그 고리입니다.
 *
 * ## 무엇이 같은가
 *
 * 직하점(subsolar point)은 그 순간 태양이 **천정에 있는** 지구 위의 한 점입니다.
 * 지구 위 어느 점의 태양 고도는 그 점에서 직하점까지의 각거리로 정해집니다:
 *
 * ```
 *   고도 = 90° − (직하점까지의 각거리)
 * ```
 *
 * 그래서 **등고도선은 직하점을 중심으로 한 원**입니다. 그리고 태양 방위는
 * **직하점으로의 대권 방위**와 같습니다 — 잰 잔차 **0.00°** 입니다(서울·시드니·
 * 런던, 고도 −51°~+43°, 낮과 밤 전부. `verify-solar-geometry.js`).
 *
 * 원의 법선은 중심을 향하므로, 결론이 이렇게 나옵니다:
 *
 * ```
 *   태양 방위 ⟂ 그 지점을 지나는 등고도선          (언제나, 모든 고도에서)
 * ```
 *
 * 지금 지도 탭이 그리는 "등치선"(일출·일몰선)은 이 가족 중 **고도 0° 짜리 한
 * 명**일 뿐입니다. `getTerminatorSegments(date, zenithAngleDeg)` 가 이미 천정각을
 * 받으므로, 같은 함수로 가족 전체를 그릴 수 있습니다.
 *
 * ## 왜 축척에 따라 다른 것을 보여야 하는가
 *
 * 화면이 좁아지면 등치선은 **정보를 잃습니다.** 화면 안에서 일출 시각이 얼마나
 * 벌어지는지 쟀습니다(서울, 9월):
 *
 * ```
 *   화면 폭  5°(555km)  → 25분        화면 폭 0.2°(22km) → 59초
 *   화면 폭  2°(222km)  → 10분        화면 폭 0.1°(11km) → 30초
 *   화면 폭  1°(111km)  →  5분   ← 등치선 간격(30분)보다 작아진다
 * ```
 *
 * 1° 아래에서는 화면 전체가 한 시각이나 마찬가지라 선이 0~1개만 보입니다.
 * 그 자리에서 뜻이 생기는 질문은 "지구 어디가 지금 일출인가" 가 아니라
 * **"내 하늘 어디에 해가 있나"** 입니다. 같은 기하의 다른 표현으로 넘어갑니다.
 */
import SunCalc from 'suncalc';
import { getSubsolarPoint, getSunPosition } from './celestial';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * 등치선이 정보를 잃는 화면 폭(경도, 도). 약 111km.
 *
 * ⚠ 고른 값이 아니라 **잰 값**입니다 — 이 폭에서 화면 안 일출 시각 차가
 * 5분으로, 등치선 간격(30분)보다 작아집니다. 더 좁히면 화면에 선이 0~1개입니다.
 */
export const LOCAL_CROSSOVER_DELTA_DEG = 1;

/** 두 점 사이 대권 각거리(도). */
export const angularDistanceDeg = (
  lat1: number, lon1: number, lat2: number, lon2: number,
): number => {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.acos(Math.max(-1, Math.min(1, c))) * DEG;
};

/** 1번 점에서 2번 점으로의 **초기 대권 방위**(북=0, 시계방향, 0~360). */
export const bearingDeg = (
  lat1: number, lon1: number, lat2: number, lon2: number,
): number => {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * DEG + 360) % 360;
};

/**
 * 그 지점을 지나는 **등고도선의 방위**(선이므로 0~180 으로 접습니다).
 *
 * 등고도선은 직하점 중심의 원이고 태양 방위는 그 중심을 향하므로, 접선은
 * 태양 방위에 직교합니다. 여기서는 그 관계를 **쓰고**, 맞는지는 판정이
 * 고도장의 수치 기울기로 **따로 재서** 확인합니다 — 여기서 재면 순환입니다.
 */
export const isoAltitudeBearingDeg = (date: Date, lat: number, lon: number): number => {
  const s = getSubsolarPoint(date);
  return (bearingDeg(lat, lon, s.latitude, s.longitude) + 90) % 180;
};

/** 직하점까지의 각거리로 낸 태양 고도(도). 기하값 — 대기굴절·시차는 없습니다. */
export const sunAltitudeFromSubsolar = (date: Date, lat: number, lon: number): number => {
  const s = getSubsolarPoint(date);
  return 90 - angularDistanceDeg(lat, lon, s.latitude, s.longitude);
};

/** 선(방향 없음)과 반직선 사이의 각(0~90). */
export const lineRayAngleDeg = (lineBearing: number, rayBearing: number): number => {
  const d = Math.abs((((lineBearing - rayBearing) % 180) + 180) % 180);
  return Math.min(d, 180 - d);
};

export interface SunFan {
  /** 일출 방위(도). 그날 일출이 없으면 null. */
  riseAz: number | null;
  /** 일몰 방위(도). 그날 일몰이 없으면 null. */
  setAz: number | null;
  /** 지금 태양 방위(도). */
  nowAz: number;
  /** 지금 태양 고도(도). 음수면 지평선 아래입니다. */
  nowAlt: number;
}

/**
 * 지도 위에 얹을 **태양 방위 부채** — 그날 해가 뜨는 방향과 지는 방향,
 * 그리고 지금 방향입니다.
 *
 * ⚠ 백야·극야에서는 일출·일몰이 없어 `null` 이 돌아옵니다. 그때도 `nowAz`
 * 는 늘 있으므로 화살표는 그릴 수 있습니다.
 */
export const getSunFan = (date: Date, lat: number, lon: number): SunFan => {
  const now = getSunPosition(date, lat, lon);
  const times = SunCalc.getTimes(date, lat, lon);
  const azAt = (t: Date | undefined): number | null =>
    t && !Number.isNaN(t.getTime()) ? getSunPosition(t, lat, lon).azimuth : null;
  return {
    riseAz: azAt(times.sunrise),
    setAz: azAt(times.sunset),
    nowAz: now.azimuth,
    nowAlt: now.altitude,
  };
};

/**
 * 이 축척에서 등치선을 그리는 것이 뜻이 있는가.
 *
 * 씬이 쓰는 것과 판정이 쓰는 것을 **같은 함수**로 묶어 둡니다 — 갈라 두면
 * 한쪽만 바뀌어도 판정이 공허하게 통과합니다(§62 에서 그렇게 당했습니다).
 */
export const isIsolineScale = (longitudeDeltaDeg: number): boolean =>
  longitudeDeltaDeg >= LOCAL_CROSSOVER_DELTA_DEG;

/**
 * 화면 안에서 일출 시각이 얼마나 벌어지는가(분). 위 문턱의 **근거**이고,
 * 판정이 이 값을 직접 잽니다.
 */
export const sunriseSpreadMinutes = (
  date: Date, lat: number, lon: number,
  longitudeDeltaDeg: number, aspect = 1.6,
): number | null => {
  const latDelta = (longitudeDeltaDeg * aspect) / 2;
  const lonDelta = longitudeDeltaDeg / 2;
  const times: number[] = [];
  for (const dLat of [-latDelta, 0, latDelta]) {
    for (const dLon of [-lonDelta, 0, lonDelta]) {
      const la = Math.max(-89, Math.min(89, lat + dLat));
      const t = SunCalc.getTimes(date, la, lon + dLon).sunrise;
      if (t && !Number.isNaN(t.getTime())) times.push(t.getTime());
    }
  }
  if (times.length < 2) return null;
  return (Math.max(...times) - Math.min(...times)) / 60000;
};
