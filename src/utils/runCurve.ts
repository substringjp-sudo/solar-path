/**
 * runCurve.ts — 타임랩스 **촬영 중 카드**의 밝기 곡선과 배터리 줄(docs/SANDBOX_MODE_PLAN.md 16절 표 12). 순수 함수.
 *
 * 곡선은 두 선을 같은 눈금(첫 장면 대비 몇 단)에 겹칩니다: 예측 = 장면(맑은 하늘) 밝기 변화(`exposureCurve.exposureStops`), 실제 = 찍은 사진의 평균 밝기 변화.
 * 자동 노출이 장면을 따라가면 실제는 0 근처에 머물고, 못 따라가면 예측을 따라 내려갑니다. 판정은 `tools/shader-preview/verify-run-card.js`.
 * 기기 온도는 Expo 가 주는 API 가 없어 다루지 않습니다.
 */

const MIN_LUMA = 0.002;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** RGBA 화소 배열 → 평균 선형 밝기(0 ~ 1). 채널을 (v ÷ 255)^2.2 로 선형화해 Rec.709 계수로 합침. 빈 목록 · 4 의 배수가 아니면 null. */
export function lumaFromRgba(rgba: ArrayLike<number>): number | null {
  const n = rgba.length;
  if (n === 0 || n % 4 !== 0) return null;
  let sum = 0;
  for (let i = 0; i < n; i += 4) {
    sum += 0.2126 * Math.pow(rgba[i] / 255, 2.2) + 0.7152 * Math.pow(rgba[i + 1] / 255, 2.2) + 0.0722 * Math.pow(rgba[i + 2] / 255, 2.2);
  }
  return sum / (n / 4);
}

/** 밝기 목록 → 첫 유효한 값 대비 단 수. 유효하지 않은 칸은 null, 바닥(0.002)에서 멈춤. */
export function photoStops(lumas: ReadonlyArray<number | null>, floor: number = MIN_LUMA): Array<number | null> {
  const ref = lumas.find(num);
  if (ref === undefined) return lumas.map(() => null);
  const r = Math.max(ref, floor);
  return lumas.map(l => (num(l) ? Math.log2(Math.max(l, floor) / r) : null));
}

export interface ActualPoint { f: number; stops: number | null }

const fmt = (n: number) => String(+n.toFixed(2));

/** 두 선을 한 눈금에 그린 점 글자. 최댓값이 위(0), 최솟값이 아래(높이), 모두 같으면 가운데. 점이 둘 미만인 선은 빈 글자. */
export function curvePaths(pred: ReadonlyArray<number | null>, actual: ReadonlyArray<ActualPoint>, width: number, height: number): { pred: string; actual: string } {
  const all: number[] = [];
  pred.forEach(v => { if (num(v)) all.push(v); });
  actual.forEach(p => { if (num(p.stops)) all.push(p.stops); });
  if (all.length === 0) return { pred: '', actual: '' };
  const hi = Math.max(...all), lo = Math.min(...all);
  const y = (v: number) => (hi === lo ? height / 2 : ((hi - v) / (hi - lo)) * height);
  const line = (pts: Array<[number, number]>) => (pts.length >= 2 ? pts.map(([px, py]) => `${fmt(px)},${fmt(py)}`).join(' ') : '');
  const n = pred.length;
  const p: Array<[number, number]> = [];
  pred.forEach((v, i) => { if (num(v) && n >= 2) p.push([(i * width) / (n - 1), y(v)]); });
  const a: Array<[number, number]> = [];
  actual.forEach(pt => { if (num(pt.stops)) a.push([Math.min(1, Math.max(0, pt.f)) * width, y(pt.stops)]); });
  return { pred: line(p), actual: line(a) };
}

type Lang = 'ko' | 'en' | 'ja';

/** "배터리 62% · 충전 중 · 절전 모드". 수준이 없으면 빈 글자. */
export function batteryLine(level: number | null | undefined, charging: boolean, lowPower: boolean, lang: Lang): string {
  if (!num(level)) return '';
  const pct = Math.round(level * 100);
  const head = lang === 'en' ? `Battery ${pct}%` : lang === 'ja' ? `バッテリー ${pct}%` : `배터리 ${pct}%`;
  const chg = lang === 'en' ? 'Charging' : lang === 'ja' ? '充電中' : '충전 중';
  const low = lang === 'en' ? 'Low power' : lang === 'ja' ? '省電力' : '절전 모드';
  return [head, charging ? chg : '', lowPower ? low : ''].filter(Boolean).join(' · ');
}

/** 배터리가 15 % 이하이고 충전 중이 아닐 때만 참. */
export function batteryLow(level: number | null | undefined, charging: boolean): boolean {
  return num(level) && level <= 0.15 && !charging;
}
