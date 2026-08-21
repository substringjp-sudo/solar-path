/**
 * skyTimeline.ts
 *
 * 하루치 하늘을 **미리 다 계산해 두고**, 렌더는 그 사이를 선형 보간만 하도록
 * 만듭니다.
 *
 * Why: 지금까지는 시간이 바뀔 때마다 그 자리에서 다시 풀었습니다.
 *  - 날씨 팬이 **태양 방위 중심**이라, 시간을 옮기면 방위 버킷이 바뀌고
 *    같은 날 같은 장소인데도 네트워크를 다시 탔습니다.
 *  - 매번 576방향 fBm + 기둥 광학을 다시 풀었습니다.
 * 그래서 스크럽이 끊기고, 언제 멈출지 예측할 수 없었습니다.
 *
 * 여기서는 비용을 **앞으로 몰아넣습니다.** 버튼 한 번에
 *   ① 360° 하루치 날씨 1회 요청
 *   ② N개 키프레임에 대해 하늘 기둥·광학을 전부 계산
 * 을 끝내고(진행률 표시), 이후 렌더는 키프레임 사이 보간뿐입니다.
 *
 * ## 무엇을 보간해도 되는가
 *
 * 키프레임에 저장하는 값은 전부 **시간에 대해 매끄러운 연속량**입니다 —
 * 방향별 운량, 층별 투과율, 태양·달 위치. 5분 간격이면 태양은 1.25°,
 * 운량은 시간 보간된 예보라 그보다 더 완만하게 움직입니다. 선형으로 충분합니다.
 *
 * 반대로 **불연속인 것은 저장하지 않습니다.** 구름의 개수·운형·아틀라스 조각
 * 같은 것은 보간하면 튑니다. 그건 렌더 시점에 보간된 운량에서 다시 뽑습니다
 * (`buildCloudsFromColumns`). 그 부분은 fBm이 없어 훨씬 쌉니다.
 *
 * ## 방향 격자가 고정이라는 점이 핵심입니다
 *
 * `buildSkyColumns`는 항상 같은 (층 × 방위 24 × 고도 8) = 576 방향을 같은
 * 순서로 내놓습니다. 그래서 키프레임마다 **운량 576개(Float32Array)** 만
 * 저장하면 되고, 방향·거리는 한 번만 저장하면 됩니다.
 */
import {
  buildSkyColumns,
  solveColumnOptics,
  haloStrength,
  layerMeanCover,
  WeatherFan,
  PLACEHOLDER_WIND_SPEED_KMH,
  PLACEHOLDER_WIND_BEARING_DEG,
  type LayerSample,
  type LayerKey,
  type ColumnOptics,
} from './skyColumn';
import {
  fetchDayWeatherRing,
  getInterpolatedWeather,
  type CloudData,
  type CloudPathData,
} from './weather';
import { makeAtmosphereParams, type AtmosphereParams } from './atmosphere';
import { representativeTauForObserver } from './cloudPresets';
import SunCalc from 'suncalc';

const R2D = 180 / Math.PI;

/** 키프레임 하나 — 그 시각의 하늘 상태 전부 */
export interface SkyKeyframe {
  tMs: number;
  sunAltDeg: number;
  sunAzDeg: number;
  moonAltDeg: number;
  moonAzDeg: number;
  /** 방향별 운량. `layout`과 같은 인덱스 순서입니다. */
  cover: Float32Array;
  beamHigh: number;
  beamMid: number;
  beamLow: number;
  diffHigh: number;
  diffMid: number;
  diffLow: number;
  sunTransmittance: number;
  diffuseToGround: number;
  halo: number;
  /** 관측점 기상 — 운형 판정과 DNI 역산에 씁니다. */
  obs: CloudData | undefined;
  atmosphere: AtmosphereParams;
}

/** 방향 격자. 시간에 무관하므로 한 번만 저장합니다. */
export interface ColumnLayout {
  layer: LayerKey;
  azimuthDeg: number;
  elevationDeg: number;
  distanceKm: number;
  confidence: number;
}

export interface SkyTimeline {
  /** 어느 날, 어디를 계산한 것인지 — 재사용 가능 여부 판정에 씁니다. */
  dateKey: string;
  latitude: number;
  longitude: number;
  stepMinutes: number;
  startMs: number;
  endMs: number;
  layout: ColumnLayout[];
  frames: SkyKeyframe[];
  /** 이 하루의 층별 평균 운량 — 요약 표시용 */
  dayMeanCover: { low: number; mid: number; high: number };
  builtAtMs: number;
}

/** 보간 결과 — `buildCloudsFromColumns`가 그대로 먹습니다. */
export interface SampledSky {
  tMs: number;
  sunAltDeg: number;
  sunAzDeg: number;
  moonAltDeg: number;
  moonAzDeg: number;
  samples: LayerSample[];
  optics: ColumnOptics;
  halo: number;
  obs: CloudData | undefined;
  atmosphere: AtmosphereParams;
}

export interface BuildTimelineParams {
  latitude: number;
  longitude: number;
  /** 계산할 날짜 (그 날 00:00~24:00 로컬) */
  date: Date;
  observerElevM?: number;
  /** 키프레임 간격 (분). 기본 5분 = 288 프레임 */
  stepMinutes?: number;
  /** 진행률 0~1 과 단계 설명 */
  onProgress?: (progress: number, label: string) => void;
  /** 취소 신호 — true를 반환하면 중단합니다. */
  isCancelled?: () => boolean;
}

export const DEFAULT_STEP_MINUTES = 5;

export function dateKeyOf(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 하루치 하늘을 계산합니다.
 *
 * **UI 스레드를 막지 않도록 주기적으로 양보합니다.** 이게 없으면 진행률 바가
 * 멈춘 채 화면이 얼어붙고, 사용자는 앱이 죽은 줄 압니다 — 진행률을 보여주는
 * 목적 자체가 사라집니다.
 */
export async function buildSkyTimeline(params: BuildTimelineParams): Promise<SkyTimeline> {
  const {
    latitude,
    longitude,
    date,
    observerElevM = 0,
    stepMinutes = DEFAULT_STEP_MINUTES,
    onProgress,
    isCancelled,
  } = params;

  const report = (p: number, label: string) => onProgress?.(Math.max(0, Math.min(1, p)), label);

  report(0.02, '하루치 날씨를 받는 중…');
  const ring: CloudPathData[] = await fetchDayWeatherRing(latitude, longitude, date);
  if (isCancelled?.()) throw new Error('CANCELLED');
  report(0.18, '하늘 격자를 세우는 중…');

  // 그 날 00:00 로컬부터 24시간
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  const frameCount = Math.max(2, Math.round((24 * 60) / stepMinutes) + 1);
  const endMs = startMs + (frameCount - 1) * stepMinutes * 60000;

  const dayOfYear = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);

  const frames: SkyKeyframe[] = [];
  let layout: ColumnLayout[] | null = null;

  // 한 번에 이만큼 계산하고 UI에 양보합니다.
  const CHUNK = 12;
  let lastYield = Date.now();

  for (let i = 0; i < frameCount; i++) {
    if (isCancelled?.()) throw new Error('CANCELLED');

    const tMs = startMs + i * stepMinutes * 60000;
    const t = new Date(tMs);

    const sunPos = SunCalc.getPosition(t, latitude, longitude);
    const sunAltDeg = sunPos.altitude * R2D;
    const sunAzDeg = sunPos.azimuth * R2D + 180;
    const moonPos = SunCalc.getMoonPosition(t, latitude, longitude);

    const weather = getInterpolatedWeather(ring, t);
    const obs = weather.find(w => (w.distance ?? 0) === 0) ?? weather[0];

    const atmosphere = makeAtmosphereParams({
      visibilityM: obs?.visibility,
      humidityPct: obs?.humidity,
      observerElevM,
      latitude,
      dayOfYear,
    });

    // 링은 절대 방위를 `azimuthOffset`에 담고 있으므로 중심은 0(북)입니다.
    const fan = new WeatherFan(weather, 0);
    const samples = buildSkyColumns({
      fan,
      // 이류는 그 날 00:00 기준 경과 분으로 둡니다 — 시간이 흐르면 구조가
      // 하늘을 가로질러 흐르고, 같은 시각이면 항상 같은 그림이 나옵니다.
      driftMinutes: i * stepMinutes,
      // **실측이 아니라 대용 상수입니다** (skyColumn.ts 주석 참고).
      windSpeedKmh: PLACEHOLDER_WIND_SPEED_KMH,
      windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
    });

    if (!layout) {
      layout = samples.map(s => ({
        layer: s.layer,
        azimuthDeg: s.azimuthDeg,
        elevationDeg: s.elevationDeg,
        distanceKm: s.distanceKm,
        confidence: s.confidence,
      }));
    }

    const optics = solveColumnOptics(samples, sunAzDeg, sunAltDeg, layer =>
      representativeTauForObserver(layer, obs)
    );

    const cover = new Float32Array(samples.length);
    for (let k = 0; k < samples.length; k++) cover[k] = samples[k].cover;

    const halo = haloStrength(
      layerMeanCover(samples, 'high'),
      layerMeanCover(samples, 'low'),
      layerMeanCover(samples, 'mid'),
      sunAltDeg
    );

    frames.push({
      tMs,
      sunAltDeg,
      sunAzDeg,
      moonAltDeg: moonPos.altitude * R2D,
      moonAzDeg: moonPos.azimuth * R2D + 180,
      cover,
      beamHigh: optics.beamFactor.high,
      beamMid: optics.beamFactor.mid,
      beamLow: optics.beamFactor.low,
      diffHigh: optics.diffuseFactor.high,
      diffMid: optics.diffuseFactor.mid,
      diffLow: optics.diffuseFactor.low,
      sunTransmittance: optics.sunTransmittance,
      diffuseToGround: optics.diffuseToGround,
      halo,
      obs,
      atmosphere,
    });

    if (i % CHUNK === CHUNK - 1 || Date.now() - lastYield > 60) {
      report(0.18 + 0.8 * ((i + 1) / frameCount), `하늘을 계산하는 중… ${i + 1}/${frameCount}`);
      // setTimeout(0)로 이벤트 루프에 양보 — 진행률 바가 실제로 움직입니다.
      await new Promise(r => setTimeout(r, 0));
      lastYield = Date.now();
    }
  }

  report(1, '완료');

  const meanOf = (layer: LayerKey) => {
    if (!layout) return 0;
    let sum = 0;
    let n = 0;
    for (const f of frames) {
      for (let k = 0; k < layout.length; k++) {
        if (layout[k].layer !== layer) continue;
        sum += f.cover[k];
        n++;
      }
    }
    return n ? sum / n : 0;
  };

  return {
    dateKey: dateKeyOf(date),
    latitude,
    longitude,
    stepMinutes,
    startMs,
    endMs,
    layout: layout ?? [],
    frames,
    dayMeanCover: { low: meanOf('low'), mid: meanOf('mid'), high: meanOf('high') },
    builtAtMs: Date.now(),
  };
}


/**
 * 타임라인에서 임의 시각을 읽습니다. **여기가 렌더 경로의 전부입니다.**
 *
 * 인접 두 키프레임을 찾아 선형 보간합니다. fBm도, 팬 샘플링도, 네트워크도
 * 없습니다 — 576개 실수 보간이 전부입니다.
 */
export function sampleTimeline(tl: SkyTimeline, timeMs: number): SampledSky | null {
  const { frames, layout } = tl;
  if (frames.length === 0) return null;

  const stepMs = tl.stepMinutes * 60000;
  const raw = (timeMs - tl.startMs) / stepMs;
  const i0 = Math.max(0, Math.min(frames.length - 1, Math.floor(raw)));
  const i1 = Math.min(frames.length - 1, i0 + 1);
  const f = i1 === i0 ? 0 : Math.max(0, Math.min(1, raw - i0));

  const a = frames[i0];
  const b = frames[i1];
  const lerp = (x: number, y: number) => x + (y - x) * f;

  const samples: LayerSample[] = new Array(layout.length);
  for (let k = 0; k < layout.length; k++) {
    const L = layout[k];
    samples[k] = {
      layer: L.layer,
      azimuthDeg: L.azimuthDeg,
      elevationDeg: L.elevationDeg,
      distanceKm: L.distanceKm,
      cover: lerp(a.cover[k], b.cover[k]),
      confidence: L.confidence,
    };
  }

  // 방위는 0/360 이음매에서 뒤집히므로 최단호로 보간합니다.
  const lerpAngle = (x: number, y: number) => {
    let d = ((y - x + 540) % 360) - 180;
    return (x + d * f + 360) % 360;
  };

  const optics: ColumnOptics = {
    beamFactor: {
      high: lerp(a.beamHigh, b.beamHigh),
      mid: lerp(a.beamMid, b.beamMid),
      low: lerp(a.beamLow, b.beamLow),
    },
    diffuseFactor: {
      high: lerp(a.diffHigh, b.diffHigh),
      mid: lerp(a.diffMid, b.diffMid),
      low: lerp(a.diffLow, b.diffLow),
    },
    sunTransmittance: lerp(a.sunTransmittance, b.sunTransmittance),
    diffuseToGround: lerp(a.diffuseToGround, b.diffuseToGround),
  };

  return {
    tMs: timeMs,
    sunAltDeg: lerp(a.sunAltDeg, b.sunAltDeg),
    sunAzDeg: lerpAngle(a.sunAzDeg, b.sunAzDeg),
    moonAltDeg: lerp(a.moonAltDeg, b.moonAltDeg),
    moonAzDeg: lerpAngle(a.moonAzDeg, b.moonAzDeg),
    samples,
    optics,
    halo: lerp(a.halo, b.halo),
    // 관측점 기상과 대기 파라미터는 시간당 변화가 작아 가까운 쪽을 씁니다.
    // (운형 판정에만 쓰이므로 보간해도 의미가 없습니다.)
    obs: f < 0.5 ? a.obs : b.obs,
    atmosphere: f < 0.5 ? a.atmosphere : b.atmosphere,
  };
}

/** 이 타임라인을 지금 위치·날짜에 그대로 쓸 수 있는지 */
export function isTimelineUsable(
  tl: SkyTimeline | null,
  latitude: number,
  longitude: number,
  date: Date,
  maxDistanceKm = 15
): tl is SkyTimeline {
  if (!tl) return false;
  if (tl.dateKey !== dateKeyOf(date)) return false;
  // 대략적인 거리 (위도 1° ≈ 111km)
  const dLat = (tl.latitude - latitude) * 111;
  const dLon = (tl.longitude - longitude) * 111 * Math.cos((latitude * Math.PI) / 180);
  return Math.hypot(dLat, dLon) <= maxDistanceKm;
}
