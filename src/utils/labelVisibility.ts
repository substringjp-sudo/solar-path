/**
 * labelVisibility.ts — 3D 하늘의 천체 라벨을 "지금 맨눈으로 보일 때만" 띄우는 규칙.
 *
 * 사용자 요청(2026-09-30): "낮에는 행성이 안보이는데 라벨 보이는게 번거롭고 달도 낮에 보일때만
 * 보여졌으면 좋겠어." 예전에는 행성은 지평선 위이기만 하면, 달은 화면 안이기만 하면(지평선 아래여도)
 * 라벨을 띄웠습니다.
 *
 * 기준(맨눈, 맑은 하늘):
 *  - 행성은 하늘이 그 행성의 밝기만큼 어두워져야 보입니다. 해가 지평선 아래 몇 도일 때 처음 보이는지를
 *    밝기 순으로 둡니다 — 금성(−4등급) 해 −2°, 목성(−2등급) −4°, 화성·수성 −5°, 토성(+0.5등급) −6°.
 *    낮의 금성은 위치를 알면 볼 수 있지만, 라벨이 "찾아보라" 는 뜻이 되지 않게 박명 뒤로 둡니다.
 *  - 행성·달은 지평선 근처에서 대기에 흐려지므로 고도 2° 이상에서만 라벨을 띄웁니다(달은 0°).
 *  - 달은 밤(해 −2° 아래)에는 떠 있으면 보입니다. 낮에는 **충분히 차 있고(조명 12% 이상) 해에서
 *    충분히 떨어져(20° 이상)** 있어야 파란 하늘에서 보입니다 — 해 옆의 가는 초승달은 낮에 안 보입니다.
 *  - 은하수 중심은 천문 박명 가까이(해 −15° 아래)에서만 보입니다.
 */
import type { PlanetKey } from './celestialPlanets';

/** 행성이 처음 맨눈에 보이는 해 고도(°). 이 값보다 해가 낮아야 합니다. */
export const PLANET_SUN_LIMIT: Record<PlanetKey, number> = {
  venus: -2,
  jupiter: -4,
  mars: -5,
  mercury: -5,
  saturn: -6,
};

export const PLANET_MIN_ALT = 2;
export const MOON_NIGHT_SUN = -2;
export const MOON_DAY_MIN_ILLUM = 0.12;
export const MOON_DAY_MIN_SEP = 20;
export const MILKY_WAY_SUN = -15;

export function planetLabelVisible(key: PlanetKey, planetAltDeg: number, sunAltDeg: number): boolean {
  return planetAltDeg >= PLANET_MIN_ALT && sunAltDeg <= PLANET_SUN_LIMIT[key];
}

export function moonLabelVisible(p: {
  moonAltDeg: number;
  sunAltDeg: number;
  /** 조명 비율 0~1 */
  illum: number;
  /** 해와 달 사이 각거리(°) */
  sepDeg: number;
}): boolean {
  if (p.moonAltDeg < 0) return false;
  if (p.sunAltDeg <= MOON_NIGHT_SUN) return true;
  return p.illum >= MOON_DAY_MIN_ILLUM && p.sepDeg >= MOON_DAY_MIN_SEP;
}

export function milkyWayLabelVisible(centerAltDeg: number, sunAltDeg: number): boolean {
  return centerAltDeg > 0 && sunAltDeg <= MILKY_WAY_SUN;
}
