/**
 * dayScoreSeries.ts — 한 출몰 둘레의 **시간대별 노을 점수**(학습 페이지 "오늘" 구역에서 접어 둔 그래프의 점들).
 *
 * 01 하늘 시트의 그래프(`SkyScreen` 의 `scoreGraph`)와 **같은 식**입니다: 출몰 둘레 9시간 창(`scoreWindow`)을 10분 간격으로 훑어
 * 각 시각의 노을 예측(`scenePrediction`)의 점수를 답니다. 점수가 있는 시각은 그 시각의 예보(`path`)로 셉니다.
 *
 *  - 해가 노을이 생길 수 없는 높이·깊이(`canGlow` 가 거짓)면 예측 없이 **0** 입니다(`scoreSeries.GLOW_ALT_*`).
 *  - 받아 둔 예보 시각 범위 밖(`hasDataAt` 가 거짓)의 점은 **비웁니다(null)** — 가장자리 값을 지어 쓰지 않습니다.
 *  - 점수가 하나도 없으면(`hasAnyScore` 가 거짓) 그래프를 그리지 않도록 null 을 돌려줍니다.
 *
 * 판정: `tools/shader-preview/verify-day-score-series.js`
 */
import { sunPosition } from './solarPosition';
import { scenePrediction } from './scenePrediction';
import { getInterpolatedWeather, type CloudPathData } from './weather';
import { hasDataAt, type EventSide } from './sunForecast';
import { canGlow, hasAnyScore, sampleScores, scoreWindow, type ScorePoint, type ScoreWindow } from './scoreSeries';

const DEG = 180 / Math.PI;

export function dayScoreSeries(
  path: readonly CloudPathData[] | null | undefined,
  at: Date,
  side: EventSide,
  latitude: number,
  longitude: number,
  tzHours: number,
  observerElevM?: number,
  stepMin = 10,
): { win: ScoreWindow; points: ScorePoint[] } | null {
  if (!path?.length || !Number.isFinite(at.getTime())) return null;
  const win = scoreWindow(at.getTime(), side, tzHours);
  const points = sampleScores(win, stepMin, (tm) => {
    const sp = sunPosition(tm, latitude, longitude);
    const alt = sp.altitude * DEG;
    if (!canGlow(alt)) return 0;
    if (!hasDataAt(path, tm)) return null;
    return scenePrediction({
      pathData: path,
      time: tm,
      sunAltDeg: alt,
      sunAzDeg: sp.azimuth * DEG + 180,
      obs: getInterpolatedWeather(path as CloudPathData[], tm)[0],
      latitude,
      observerElevM,
    })?.score ?? null;
  });
  return hasAnyScore(points) ? { win, points } : null;
}
