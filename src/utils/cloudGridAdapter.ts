/**
 * cloudGridAdapter.ts
 *
 * 강화 구름 격자(`fetchCloudGrid`)를 3D 씬이 쓰는 관측 팬 형식으로 옮깁니다.
 *
 * Why 어댑터가 필요한가:
 * 격자는 원래 2D 전용이었습니다. `convertGridToClouds`가 격자를 **SVG 폴리곤**으로
 * 바꿔 버려서, 3D 씬은 그 결과물을 소비할 방법이 없었습니다. 폴리곤은 화면 좌표에
 * 갇힌 최종 산출물이지 기상 필드가 아니기 때문입니다.
 *
 * 그런데 격자의 **원본**은 3D가 이미 먹는 것과 정확히 같은 물건입니다 —
 * (방위 오프셋, 거리)에 매달린 저·중·상층 운량. `skyColumn.WeatherFan`이
 * 요구하는 `CloudData`와 필드 이름만 다릅니다. 그래서 폴리곤화 **이전** 단계에서
 * 갈라내면 3D가 그대로 받아쓸 수 있습니다.
 *
 * 격자가 기본 팬보다 나은 점:
 *   기본 팬  5레이(±20°) × 7고리(10~380km) = 35점
 *   강화 격자 7레이(±30°) × 10고리(10~380km) = 70점
 * 방위 폭이 1.5배, 점 밀도가 2배입니다. `buildSkyColumns`는 팬 밖 방향을
 * 관측점 값으로 메우고 신뢰도를 떨어뜨리므로, 팬이 넓어지면 그만큼 하늘의
 * 더 넓은 부분이 실측으로 채워집니다.
 */
import type { CloudData } from './weather';
import { interpolateCloudGrid, type CloudDensityGrid } from './cloudGrid';

export interface GridFanParams {
  grid: CloudDensityGrid;
  /** 지금 보고 있는 시각. 격자의 시간축에서 다시 읽습니다. */
  time: Date;
  /**
   * 현재 태양 방위 (도).
   *
   * `WeatherFan`은 `azimuthOffset`을 **현재 태양 방위 기준**으로 해석합니다.
   * 반면 격자의 `azOffset`은 **격자를 받을 때의** 태양 방위(`grid.azCenter`)
   * 기준입니다. 격자는 방위 10° 버킷으로 10분간 캐시되므로 둘은 어긋날 수
   * 있고, 그대로 넘기면 하늘 구조 전체가 그 차이만큼 회전합니다.
   */
  sunAzimuthDeg: number;
  /**
   * 기본 팬의 시간 보간 결과. 관측점(0km) 항목의 부가 관측값을 가져오는 데
   * 씁니다 — 격자에는 없는 값들입니다.
   */
  baseline?: CloudData[];
}

/**
 * 격자 → `WeatherFan`이 먹는 `CloudData[]`.
 *
 * 관측점을 각 레이 앞에 붙이는 이유:
 * 격자의 첫 고리가 10km라 그보다 가까운 방향(저층 고도각 8.5° 위쪽 전부)은
 * `WeatherFan.alongRay`의 하한 클램프에 걸려 10km 값을 그대로 씁니다.
 * 머리 위가 10km 밖 하늘로 채워지는 셈입니다. 관측점을 넣으면 그 구간이
 * 실제 머리 위 값으로 보간됩니다.
 *
 * 부가 관측값(DNI·습도·강수·시정)도 여기에만 있습니다. 이게 빠지면
 * `resolvePresetFromWeather`가 비구름을 못 고르고 `cloudTauFromDNI`가
 * null을 돌려줘, 강화 격자를 켠 순간 오히려 물리가 나빠집니다.
 */
export function cloudGridToFan(params: GridFanParams): CloudData[] {
  const { grid, time, sunAzimuthDeg, baseline } = params;

  const points = interpolateCloudGrid(grid, time);
  if (points.length === 0) return baseline ?? [];

  // 격자 중심과 현재 태양 방위의 차이. 모든 레이에 같은 값을 더하므로
  // 레이 묶음(byOffset의 키 집합)은 그대로 7개로 유지됩니다.
  const azShift = ((grid.azCenter - sunAzimuthDeg + 540) % 360) - 180;

  const observer = baseline?.find(s => (s.distance ?? 0) === 0) ?? baseline?.[0];

  const out: CloudData[] = points.map(p => ({
    low: clampPct(p.low),
    mid: clampPct(p.mid),
    high: clampPct(p.high),
    distance: p.distance,
    azimuthOffset: p.azOffset + azShift,
  }));

  if (observer) {
    // 레이마다 0km 앵커를 하나씩. 한 레이에만 넣으면 그 레이만 머리 위가
    // 달라져 하늘에 부채꼴 이음매가 생깁니다.
    const offsets = [...new Set(out.map(s => s.azimuthOffset))];
    for (const off of offsets) {
      out.push({
        ...observer,
        distance: 0,
        azimuthOffset: off,
      });
    }
  }

  return out;
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/**
 * 격자가 지금 보고 있는 방향·시각에 대해 아직 쓸 만한지 판정합니다.
 *
 * 격자는 태양 방위 기준 ±30° 부채꼴이라 방위가 크게 어긋나면 실측 영역이
 * 하늘의 엉뚱한 쪽에 얹힙니다. 그럴 바에는 기본 팬이 낫습니다.
 */
export function isGridUsable(
  grid: CloudDensityGrid | null,
  sunAzimuthDeg: number,
  maxAzDriftDeg = 25
): grid is CloudDensityGrid {
  if (!grid || grid.points.length === 0) return false;
  const drift = Math.abs(((grid.azCenter - sunAzimuthDeg + 540) % 360) - 180);
  return drift <= maxAzDriftDeg;
}
