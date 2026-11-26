/**
 * 3D 하늘에 넘기는 노을 예측 — **하늘 화면과 촬영하기(카메라)가 같은 식**으로 부릅니다.
 *
 * 예전에는 카메라가 시정 15km · 습도 50% · 관측 고도 0 을 박아 따로 불렀습니다. 3D 는 이 값의
 * `factors.overheadOvercast` 로 조명을 흐리게 하므로, 같은 자리·같은 시각이라도 두 화면의
 * 하늘이 달라졌습니다.
 */
import { predictSunset } from './sunsetPhysics';

/**
 * 같은 입력이면 같은 답 — 예보 배열마다 최근 512 개를 기억합니다(최적화 검토 D2).
 * 판정 줄(`findGlowPeak`) · 점수 그래프 · 학습 페이지 · 예보 판정이 같은 시각을 따로 부르고,
 * 슬라이더를 놓을 때마다 판정 줄이 같은 16 시각을 다시 셉니다. 값은 바꾸지 않습니다:
 * 점수가 시각에 대해 톱니처럼 뛰므로(30 초에 최대 6 점, verify-day-score-series 주석) 표 보간은 쓰지 않고
 * 입력이 정확히 같을 때만 돌려줍니다. 결과 객체는 읽기만 합니다(부르는 쪽이 고치지 않음).
 */
const MEMO_MAX = 512;
const memo = new WeakMap<object, Map<string, ReturnType<typeof predictSunset> | null>>();

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
  const key = `${time.getTime()}|${sunAltDeg}|${sunAzDeg}|${obs?.visibility}|${obs?.humidity}|${latitude}|${observerElevM}`;
  let m = memo.get(pathData);
  if (!m) { m = new Map(); memo.set(pathData, m); }
  if (m.has(key)) return m.get(key)!;
  const out = computePrediction(pathData, time, sunAltDeg, sunAzDeg, obs, latitude, observerElevM);
  if (m.size >= MEMO_MAX) m.delete(m.keys().next().value as string);
  m.set(key, out);
  return out;
}

function computePrediction(
  pathData: readonly any[],
  time: Date,
  sunAltDeg: number,
  sunAzDeg: number,
  obs: { visibility?: number; humidity?: number } | undefined,
  latitude: number,
  observerElevM: number | undefined,
) {
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
