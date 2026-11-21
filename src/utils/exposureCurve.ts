/**
 * exposureCurve.ts — 타임랩스 시트의 **예측 노출 곡선**(docs/SANDBOX_MODE_PLAN.md 8.3.1 · 목업 9).
 *
 * 해 고도(°)에서 **맑은 하늘**의 바깥 밝기(lux)를 어림하고, 시작 장면 대비 몇 단(stop, 밝기 두 배) 어두워지거나 밝아지는지를 돌려줍니다.
 * 구름 · 지형 · 관측 고도는 반영하지 않습니다(화면에도 "맑은 하늘 기준 어림"이라고 적습니다). 기준표는 널리 인용되는 어림값이고,
 * 그 사이는 고도에 대해 로그 직선(lux 의 로그가 직선)으로 잇습니다. 순수 함수 — 판정은 `tools/shader-preview/verify-exposure-curve.js`.
 */

/** [해 고도(°), 맑은 하늘 바깥 밝기(lux)] — 고도 오름차순. */
export const LUX_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [-12, 0.01],
  [-6, 3.4],
  [0, 400],
  [10, 10000],
];

/** 해 고도 → 맑은 하늘 밝기(lux). 숫자가 아니면 null, 기준표 밖은 끝값으로 자릅니다. */
export function sceneLux(altDeg: number): number | null {
  if (typeof altDeg !== 'number' || !Number.isFinite(altDeg)) return null;
  const first = LUX_ANCHORS[0], last = LUX_ANCHORS[LUX_ANCHORS.length - 1];
  if (altDeg <= first[0]) return first[1];
  if (altDeg >= last[0]) return last[1];
  for (let i = 1; i < LUX_ANCHORS.length; i++) {
    const [a1, l1] = LUX_ANCHORS[i];
    if (altDeg <= a1) {
      const [a0, l0] = LUX_ANCHORS[i - 1];
      const t = (altDeg - a0) / (a1 - a0);
      return Math.exp(Math.log(l0) + t * (Math.log(l1) - Math.log(l0)));
    }
  }
  return last[1];
}

/** 고도 목록 → 첫 값 대비 단 수(log2 밝기 비). 숫자가 아닌 값은 그 자리만 null, 첫 값이 null 이면 전부 null. */
export function exposureStops(altsDeg: readonly number[]): Array<number | null> {
  const l0 = altsDeg.length ? sceneLux(altsDeg[0]) : null;
  return altsDeg.map(a => {
    const l = sceneLux(a);
    return l0 == null || l == null ? null : Math.log2(l / l0);
  });
}

export interface ExposureSummary { total: number; min: number; max: number }

/** 마지막 유효한 값 − 첫 유효한 값, 최소 · 최대. 유효한 값이 둘 미만이면 null. */
export function exposureSummary(stops: ReadonlyArray<number | null>): ExposureSummary | null {
  const v = stops.filter((s): s is number => typeof s === 'number' && Number.isFinite(s));
  if (v.length < 2) return null;
  return { total: v[v.length - 1] - v[0], min: Math.min(...v), max: Math.max(...v) };
}

/** 폭 × 높이 안의 점 글자 "x,y x,y …"(SVG polyline). 가장 밝은 값이 위(0), 가장 어두운 값이 아래(높이). 모두 같으면 가운데. 점이 둘 미만이면 빈 글자. */
export function exposureLine(stops: ReadonlyArray<number | null>, width: number, height: number): string {
  const n = stops.length;
  const v = stops.filter((s): s is number => typeof s === 'number' && Number.isFinite(s));
  if (n < 2 || v.length < 2) return '';
  const hi = Math.max(...v), lo = Math.min(...v);
  const pts: string[] = [];
  stops.forEach((s, i) => {
    if (typeof s !== 'number' || !Number.isFinite(s)) return;
    const x = (i * width) / (n - 1);
    const y = hi === lo ? height / 2 : ((hi - s) / (hi - lo)) * height;
    pts.push(`${+x.toFixed(2)},${+y.toFixed(2)}`);
  });
  return pts.join(' ');
}
