/**
 * glowPeak.ts — "가장 붉을 때": 일몰·일출 앞뒤에서 노을 예측 점수가 가장 높은 순간.
 *
 * 따로 모형을 두지 않습니다. 화면이 이미 쓰는 예측(`scenePrediction`)을 출몰 앞뒤 몇 분 간격으로
 * 불러 점수가 가장 높은 시각을 고릅니다. 그래서 하늘 그림·점수와 어긋날 수 없습니다.
 *
 *  - 일몰: 출몰 15분 전 ~ 30분 뒤(해가 지고 난 뒤 구름 밑면이 붉어지는 쪽으로 더 넓게).
 *  - 일출: 거울로 30분 전 ~ 15분 뒤.
 *  - 3분 간격 16번. 점수가 같으면 먼저 오는 시각입니다.
 *  - 예측을 못 하면(날씨 없음) `null` 입니다. 지어낸 시각을 내놓지 않습니다.
 */

export const GLOW_STEP_MIN = 3;
const MS_MIN = 60_000;

export interface GlowPeak<P> {
  time: Date;
  score: number;
  prediction: P;
}

export function findGlowPeak<P extends { score: number }>(
  event: Date | null | undefined,
  side: 'sunset' | 'sunrise',
  predictAt: (t: Date) => P | null,
): GlowPeak<P> | null {
  if (!event || !Number.isFinite(event.getTime())) return null;
  const [fromMin, toMin] = side === 'sunset' ? [-15, 30] : [-30, 15];
  let best: GlowPeak<P> | null = null;
  for (let m = fromMin; m <= toMin; m += GLOW_STEP_MIN) {
    const t = new Date(event.getTime() + m * MS_MIN);
    const p = predictAt(t);
    if (!p || !Number.isFinite(p.score)) continue;
    if (!best || p.score > best.score) best = { time: t, score: p.score, prediction: p };
  }
  return best;
}
