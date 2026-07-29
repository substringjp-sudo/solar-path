import { EquatorialCoord, equatorialToHorizontal } from './celestialCoords';

export type PlanetKey = 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn';

export interface PlanetData {
  key: PlanetKey;
  nameKo: string;
  nameEn: string;
  symbol: string;
  magnitude: number;
}

export const PLANETS_METADATA: Record<PlanetKey, PlanetData> = {
  mercury: { key: 'mercury', nameKo: '수성', nameEn: 'Mercury', symbol: '☿', magnitude: -0.4 },
  venus: { key: 'venus', nameKo: '금성 (샛별)', nameEn: 'Venus', symbol: '♀', magnitude: -4.4 },
  mars: { key: 'mars', nameKo: '화성', nameEn: 'Mars', symbol: '♂', magnitude: -1.5 },
  jupiter: { key: 'jupiter', nameKo: '목성', nameEn: 'Jupiter', symbol: '♃', magnitude: -2.7 },
  saturn: { key: 'saturn', nameKo: '토성', nameEn: 'Saturn', symbol: '♄', magnitude: 0.2 },
};

/**
 * J2000.0 기준 율리우스 날짜(d) 산출
 */
function getJulianDays(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5 - 2451545.0;
}

/**
 * 5대 행성(수성, 금성, 화성, 목성, 토성)의 근사 적경(RA) / 적위(Dec) 오프라인 케플러 계산
 */
export function getPlanetEquatorialCoord(planetKey: PlanetKey, date: Date): EquatorialCoord {
  const d = getJulianDays(date);

  let raHours = 0;
  let decDeg = 0;

  switch (planetKey) {
    case 'mercury': {
      const L = (252.25 + 4.0923344 * d) % 360;
      const M = (174.79 + 4.0923344 * d) % 360;
      raHours = ((L + 3.0 * Math.sin((M * Math.PI) / 180)) / 15 + 24) % 24;
      decDeg = 7.0 * Math.sin(((L + 40) * Math.PI) / 180);
      break;
    }
    case 'venus': {
      const L = (181.98 + 1.6021302 * d) % 360;
      const M = (50.12 + 1.6021302 * d) % 360;
      raHours = ((L + 1.2 * Math.sin((M * Math.PI) / 180)) / 15 + 24) % 24;
      decDeg = 3.4 * Math.sin(((L - 10) * Math.PI) / 180);
      break;
    }
    case 'mars': {
      const L = (355.43 + 0.524033 * d) % 360;
      const M = (19.37 + 0.524033 * d) % 360;
      raHours = ((L + 10.6 * Math.sin((M * Math.PI) / 180)) / 15 + 24) % 24;
      decDeg = 1.85 * Math.sin(((L + 20) * Math.PI) / 180);
      break;
    }
    case 'jupiter': {
      const L = (34.35 + 0.083091 * d) % 360;
      const M = (20.02 + 0.083091 * d) % 360;
      raHours = ((L + 5.5 * Math.sin((M * Math.PI) / 180)) / 15 + 24) % 24;
      decDeg = 1.3 * Math.sin(((L + 100) * Math.PI) / 180);
      break;
    }
    case 'saturn': {
      const L = (50.08 + 0.03346 * d) % 360;
      const M = (317.02 + 0.03346 * d) % 360;
      raHours = ((L + 6.3 * Math.sin((M * Math.PI) / 180)) / 15 + 24) % 24;
      decDeg = 2.49 * Math.sin(((L - 50) * Math.PI) / 180);
      break;
    }
  }

  return { raHours, decDeg };
}

/**
 * 5대 주요 행성 전체의 실시간 오프라인 방위각(Azimuth), 고도각(Altitude) 계산
 */
export function getCalculatedPlanets(lat: number, lon: number, date: Date) {
  const planetKeys: PlanetKey[] = ['mercury', 'venus', 'mars', 'jupiter', 'saturn'];

  return planetKeys.map((key) => {
    const meta = PLANETS_METADATA[key];
    const eq = getPlanetEquatorialCoord(key, date);
    const horiz = equatorialToHorizontal(eq, lat, lon, date);

    return {
      ...meta,
      raHours: eq.raHours,
      decDeg: eq.decDeg,
      azimuth: horiz.azimuthDeg,
      altitude: horiz.altitudeDeg,
      isVisible: horiz.altitudeDeg > 0,
    };
  });
}
