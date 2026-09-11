/**
 * 날씨 캐시 키의 **자리 입도**.
 *
 * ## 고치는 낭비
 *
 * 캐시 키가 `lat.toFixed(3)` — 곧 **111m** 였습니다. 그런데 날씨 격자는
 * 한국에서 5.6km, 가장 촘촘한 곳(미국)이 2.3km 입니다(§56.1). 같은 격자칸
 * 안에서 111m 만 움직여도 **36점을 통째로 다시 받았습니다.**
 *
 * 실제로 재 봤습니다 — 도곡동에서 동쪽으로 옮겨 가며 같은 변수를 받으면:
 *
 * ```
 *    0.05 km  같음      3 km  같음
 *     0.5 km  같음      5 km  같음
 *       1 km  같음      8 km  같음(격자점은 바뀜)
 *       2 km  같음     12 km  같음
 * ```
 *
 * 12km 를 옮겨도 값이 같았습니다. 111m 로 키를 나누는 것은 **아무것도 안
 * 지키면서 왕복만 늘리는 일**입니다. 왕복 한 번이 514~640ms 였습니다.
 *
 * ## 왜 2km 인가
 *
 * 값이 같은 한계(12km)가 아니라 **격자 간격**에 맞춥니다. 잰 것 중 가장
 * 촘촘한 것이 캔자스 2.3km 이므로 그보다 아래인 **0.02°(≈2.2km 위도)** 로
 * 자릅니다. 어느 지역에서도 한 칸 안에서만 뭉치므로 **자료를 잃지 않습니다.**
 *
 * ⚠ 경계 효과는 남습니다 — 버킷 경계를 사이에 둔 두 점은 붙어 있어도 키가
 * 갈립니다. 그때는 예전과 같아질 뿐(요청 한 번)이라 나빠지지는 않습니다.
 */

/** 자리 버킷 크기(도). 잰 것 중 가장 촘촘한 격자(2.3km)보다 아래입니다. */
export const GRID_BUCKET_DEG = 0.02;

/**
 * 위경도를 격자 버킷으로 자릅니다. 같은 칸이면 **같은 문자열**입니다.
 *
 * @returns `"37.48,127.04"` 꼴. 값이 수가 아니면 `"na"`.
 */
export function gridBucket(lat: number, lon: number, stepDeg = GRID_BUCKET_DEG): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'na';
  const q = (v: number) => {
    const s = Math.round(v / stepDeg) * stepDeg;
    // -0 과 0 이 다른 문자열이 되지 않게 0 을 더합니다.
    return (s + 0).toFixed(4);
  };
  return `${q(lat)},${q(lon)}`;
}

/** 두 자리가 같은 버킷인가 — 판정과 디버그용. */
export const sameBucket = (aLat: number, aLon: number, bLat: number, bLon: number, stepDeg = GRID_BUCKET_DEG): boolean =>
  gridBucket(aLat, aLon, stepDeg) === gridBucket(bLat, bLon, stepDeg);
