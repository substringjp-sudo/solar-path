/**
 * 3D 하늘에 넘기는 노을 예측 — **하늘 화면과 촬영하기(카메라)가 같은 식**으로 부릅니다.
 *
 * 예전에는 카메라가 시정 15km · 습도 50% · 관측 고도 0 을 박아 따로 불렀습니다. 3D 는 이 값의
 * `factors.overheadOvercast` 로 조명을 흐리게 하므로, 같은 자리·같은 시각이라도 두 화면의
 * 하늘이 달라졌습니다.
 */
import { predictSunset } from './sunsetPhysics';

export function scenePrediction(params: {
  pathData: readonly any[];
  time: Date;
  sunAltDeg: number;
  /**
   * 해 방위(도, 북 0 · 동 90). 날씨가 링(절대 방위)이라 이것으로 해 쪽 줄을 골라 읽습니다(`alignRingToSun`).
   * 2026-10-25 전에는 넘기지 않아 예측이 늘 북쪽 줄을 읽었습니다.
   */
  sunAzDeg: number;
  /** 관측점 보간 예보(`getInterpolatedWeather(...)[0]`) */
  obs: { visibility?: number; humidity?: number } | undefined;
  latitude: number;
  observerElevM: number | undefined;
}) {
  const { pathData, time, sunAltDeg, sunAzDeg, obs, latitude, observerElevM } = params;
  if (!pathData.length) return null;
  const dayOfYear = Math.floor((time.getTime() - Date.UTC(time.getUTCFullYear(), 0, 0)) / 86400000);
  try {
    return predictSunset(
      pathData as any,
      time,
      sunAltDeg,
      obs?.visibility,
      obs?.humidity,
      latitude,
      observerElevM,
      dayOfYear,
      sunAzDeg
    );
  } catch (err) {
    console.log('3D prediction error:', err);
    return null;
  }
}
