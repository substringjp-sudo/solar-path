/**
 * 지형에 가린 일출·일몰 (2026-11-19, docs/SANDBOX_MODE_PLAN.md 9.3 "해 뜨는 시각과 방향").
 *
 * 앱이 알리는 일출·일몰은 평평한 수평선 기준(해 중심 기하 고도 −0.833°)입니다. 산이 있는 곳에서 해가 **실제로 보이기 시작하는**
 * 순간은 해 윗가장자리가 그 방향 스카이라인(`utils/horizon.ts`)을 넘는 때라, 능선이 1.8° 높으면 15분쯤 늦습니다.
 *
 * 해 위치는 앱의 태양력(`solarPosition.ts`) 그대로, 굴절은 해·달 공통 식(`moonPosition.refractionDeg`)입니다. 시각은 1분 걸음으로
 * 훑어 가림 여부가 바뀌는 곳을 찾고 이분법으로 1초 아래까지 다듬습니다.
 */
import { sunPosition, sunTimes, sunCrossings } from './solarPosition';
import { refractionDeg } from './moonPosition';

const R2D = 180 / Math.PI;
/** 해 겉보기 반지름(°). 평균 거리 0.267°(sun disc 와 같은 값). */
export const SUN_RADIUS_DEG = 0.2667;
const MIN = 60e3;

/** 방위(°) → 그 방위 스카이라인의 앙각(°). 땅 자료가 없는 방위는 null. */
export type SkylineFn = (azDeg: number) => number | null;

export interface SunHorizonEvent {
  kind: 'rise' | 'set';
  /** 앱이 알리는 평평한 수평선 기준 시각(해 중심 기하 고도 −0.833°) */
  flatMs: number;
  /** 해 윗가장자리가 스카이라인을 처음 넘는(일출) / 마지막으로 넘는(일몰) 시각. 그날 한 번도 안 보이면 null */
  visibleMs: number | null;
  /** visibleMs 때 해 방위(북 0 시계, °)와 그 방위 스카이라인 앙각(°). visibleMs 가 null 이면 flatMs 때 값 */
  azDeg: number;
  skylineDeg: number | null;
  /** visibleMs − flatMs (분). 양수 = 평평한 수평선 기준보다 늦다 */
  deltaMin: number | null;
}

interface SunSky { az: number; geoAlt: number; appAlt: number }

const skyAt = (ms: number, lat: number, lon: number): SunSky => {
  const p = sunPosition(new Date(ms), lat, lon);
  const geo = p.altitude * R2D;
  return { az: (((p.azimuth * R2D + 180) % 360) + 360) % 360, geoAlt: geo, appAlt: geo + refractionDeg(geo) };
};

/** 해 윗가장자리가 스카이라인 위(또는 걸침)인가. 스카이라인을 모르는 방위는 평평한 수평선(앙각 0, 겉보기)으로 칩니다. */
const aboveSkyline = (ms: number, lat: number, lon: number, skyline: SkylineFn): boolean => {
  const s = skyAt(ms, lat, lon);
  const sk = skyline(s.az);
  return s.appAlt + SUN_RADIUS_DEG >= (sk ?? 0);
};

/**
 * 그날 `kind`(일출/일몰) 때 해가 스카이라인 뒤에서 나타나는(사라지는) 순간. 극야·백야로 평평한 수평선 사건이 없으면 null.
 * 일출은 첫 "안 보임 → 보임", 일몰은 마지막 "보임 → 안 보임"입니다. 능선 틈으로 잠깐 보였다 다시 가리는 경우도 첫 모습을 잡습니다.
 */
export function sunHorizonEvent(
  kind: 'rise' | 'set',
  date: Date,
  lat: number,
  lon: number,
  skyline: SkylineFn,
): SunHorizonEvent | null {
  const flat = sunTimes(date, lat, lon);
  const flatMs = (kind === 'rise' ? flat.sunrise : flat.sunset).getTime();
  if (!Number.isFinite(flatMs)) return null;
  // 훑는 범위: 해가 −8° 에서 +… 까지. 낮은 스카이라인(높은 곳에서 아래를 봄)은 평평한 수평선보다 일찍,
  // 높은 능선은 몇 시간 늦게(일몰은 거꾸로) 바뀔 수 있습니다.
  const deep = sunCrossings(date, lat, lon, -8);
  const deepMs = (kind === 'rise' ? deep.rise : deep.set).getTime();
  const lo = kind === 'rise' ? (Number.isFinite(deepMs) ? deepMs : flatMs - 120 * MIN) : flatMs - 300 * MIN;
  const hi = kind === 'rise' ? flatMs + 300 * MIN : (Number.isFinite(deepMs) ? deepMs : flatMs + 120 * MIN);
  const step = MIN;
  let found: number | null = null;
  let prevMs = lo;
  let prev = aboveSkyline(prevMs, lat, lon, skyline);
  if (kind === 'rise' && prev) {
    // 훑기 시작부터 보임(해가 −8° 인데도 스카이라인이 그보다 낮은 곳): 시작 시각
    found = lo;
  }
  for (let t = lo + step; t <= hi; t += step) {
    const cur = aboveSkyline(t, lat, lon, skyline);
    if (kind === 'rise' && found == null && !prev && cur) { found = bisect(prevMs, t, lat, lon, skyline, 'rise'); }
    if (kind === 'set' && prev && !cur) { found = bisect(prevMs, t, lat, lon, skyline, 'set'); }
    prev = cur; prevMs = t;
  }
  const ref = skyAt(found ?? flatMs, lat, lon);
  return {
    kind,
    flatMs,
    visibleMs: found,
    azDeg: ref.az,
    skylineDeg: skyline(ref.az),
    deltaMin: found == null ? null : (found - flatMs) / MIN,
  };
}

/** [a, b] 안에서 보임 여부가 바뀌는 순간을 1 초 아래까지. */
function bisect(a: number, b: number, lat: number, lon: number, skyline: SkylineFn, kind: 'rise' | 'set'): number {
  let lo = a, hi = b;
  for (let i = 0; i < 17; i++) {
    const mid = (lo + hi) / 2;
    const v = aboveSkyline(mid, lat, lon, skyline);
    // 일출: lo 는 안 보임, hi 는 보임. 일몰: lo 는 보임, hi 는 안 보임.
    if (kind === 'rise') { if (v) hi = mid; else lo = mid; } else { if (v) lo = mid; else hi = mid; }
  }
  return (lo + hi) / 2;
}

export interface SunriseSteps {
  /** 1. 해 중심의 기하 고도가 0° 를 지나는 순간과 그때 방위 */
  geoZeroMs: number;
  geoZeroAzDeg: number;
  /** 2. 그 높이(고도 0°)에서 대기 굴절이 해를 띄우는 양(°)과, 해 중심의 겉보기 고도가 0° 가 되는 순간(굴절 때문에 몇 분 일찍) */
  refractionDeg: number;
  apparentZeroMs: number;
  refractionEarlyMin: number;
  /** 3·4. 지형 스카이라인과 보이기 시작 (`sunHorizonEvent`) */
  event: SunHorizonEvent;
}

/**
 * 계산 과정 보기("해 뜨는 시각과 방향")의 단계 값. 일출이면 아침, 일몰이면 저녁 사건을 풉니다.
 * 기하 0° 와 겉보기 0° 의 시각은 `sunCrossings`(해 중심 고도를 지나는 순간)에서 옵니다.
 */
export function sunHorizonSteps(kind: 'rise' | 'set', date: Date, lat: number, lon: number, skyline: SkylineFn): SunriseSteps | null {
  const ev = sunHorizonEvent(kind, date, lat, lon, skyline);
  if (!ev) return null;
  const geo0 = sunCrossings(date, lat, lon, 0);
  const geoZeroMs = (kind === 'rise' ? geo0.rise : geo0.set).getTime();
  const r0 = refractionDeg(0);
  // 겉보기 중심 고도 0° ⇔ 기하 고도가 −(굴절) 쯤. 고도가 0° 근처라 굴절을 한 번 더 풀어 줍니다.
  let g = -r0;
  for (let i = 0; i < 4; i++) g = -refractionDeg(g);
  const app0 = sunCrossings(date, lat, lon, g);
  const apparentZeroMs = (kind === 'rise' ? app0.rise : app0.set).getTime();
  const az = skyAt(geoZeroMs, lat, lon).az;
  return {
    geoZeroMs,
    geoZeroAzDeg: az,
    refractionDeg: r0,
    apparentZeroMs,
    refractionEarlyMin: Number.isFinite(apparentZeroMs) && Number.isFinite(geoZeroMs)
      ? (kind === 'rise' ? (geoZeroMs - apparentZeroMs) : (apparentZeroMs - geoZeroMs)) / MIN
      : NaN,
    event: ev,
  };
}
