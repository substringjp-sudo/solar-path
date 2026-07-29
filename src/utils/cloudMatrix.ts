export type CloudTypeCategory = 'cumulonimbus' | 'cirrus' | 'lenticularis' | 'stratus' | 'fair_cumulus';

export interface CloudCellData {
  id: string;
  distanceKm: number; // 0, 50, 100, 200
  bearingDeg: number;  // 방위각 (0~360)
  lat: number;
  lon: number;
  cloudCover: number; // 0 ~ 1 (구름량)
  cloudType: CloudTypeCategory;
  cloudName: string;
  isSpecial: boolean;  // 적란운 또는 렌즈구름 등 특별 강조 구름 여부
  windSpeedKmh: number;
  windBearingDeg: number;
}

// 거리별 동심원 29개 정밀 방사형 격자 정의
// 0km: 1개, 50km: 4개 (N, E, S, W), 100km: 8개 (N, NE, E, SE, S, SW, W, NW), 200km: 16개 (22.5° 간격 16방위)
export const RADIAL_GRID_DEFINITIONS: { distanceKm: number; count: number }[] = [
  { distanceKm: 0, count: 1 },
  { distanceKm: 50, count: 4 },
  { distanceKm: 100, count: 8 },
  { distanceKm: 200, count: 16 },
];

/**
 * 위도/경도 및 방위각/거리 기반 29개 좌표점 산출
 */
export function generate29GridPoints(centerLat: number, centerLon: number) {
  const points: { id: string; distanceKm: number; bearingDeg: number; lat: number; lon: number }[] = [];

  // 0km (내 위치)
  points.push({
    id: 'grid-0-0',
    distanceKm: 0,
    bearingDeg: 0,
    lat: centerLat,
    lon: centerLon,
  });

  // 50km, 100km, 200km
  RADIAL_GRID_DEFINITIONS.slice(1).forEach(({ distanceKm, count }) => {
    const step = 360 / count;
    for (let i = 0; i < count; i++) {
      const bearing = (i * step) % 360;
      // 대략적인 거리->위경도 변환 (1° ≈ 111km)
      const rad = (bearing * Math.PI) / 180;
      const dLat = (distanceKm / 111) * Math.cos(rad);
      const dLon = (distanceKm / (111 * Math.cos((centerLat * Math.PI) / 180))) * Math.sin(rad);

      points.push({
        id: `grid-${distanceKm}-${bearing}`,
        distanceKm,
        bearingDeg: bearing,
        lat: centerLat + dLat,
        lon: centerLon + dLon,
      });
    }
  });

  return points;
}

/**
 * 모의/실제 일기 데이터를 기반으로 구름 종류 및 위상 결정
 */
export function computeCloudCellData(
  gridPoint: { id: string; distanceKm: number; bearingDeg: number; lat: number; lon: number },
  minutesOffset: number = 0 // 0분 ~ 60분
): CloudCellData {
  const { id, distanceKm, bearingDeg, lat, lon } = gridPoint;

  // 위치 및 시분 기반 물리적 의사 난수 시드 생성
  const seed = Math.abs(Math.sin(lat * 12.9898 + lon * 78.233 + (bearingDeg + 1) * 37.71 + minutesOffset * 0.1));
  const cloudCover = Math.min(1, Math.max(0.1, (seed * 1.3) % 1.0));

  let cloudType: CloudTypeCategory = 'fair_cumulus';
  let cloudName = '뭉게구름 (Cumulus)';
  let isSpecial = false;

  // 먼 거리 (100km ~ 200km) 상공의 웅장한 적란운 또는 희귀 렌즈구름 시뮬레이션
  if (seed > 0.78 && distanceKm >= 100) {
    cloudType = 'cumulonimbus';
    cloudName = '웅장한 적란운 (Cumulonimbus)';
    isSpecial = true;
  } else if (seed > 0.68) {
    cloudType = 'cirrus';
    cloudName = '노을빛 털구름 (Cirrus)';
    isSpecial = false;
  } else if (seed > 0.62 && distanceKm >= 50) {
    cloudType = 'lenticularis';
    cloudName = '희귀 렌즈구름 (Lenticular)';
    isSpecial = true;
  } else if (seed < 0.3) {
    cloudType = 'stratus';
    cloudName = '비구름 / 층운 (Stratus)';
    isSpecial = false;
  }

  // 풍향 및 풍속 (기본 서풍계열 ~25km/h)
  const windSpeedKmh = 15 + Math.floor(seed * 20);
  const windBearingDeg = (240 + Math.floor(seed * 60)) % 360;

  // 풍속 벡터를 이용한 10분~60분 후 위치 전이 물리 계산
  let effectiveBearing = bearingDeg;
  let effectiveDistance = distanceKm;

  if (minutesOffset > 0 && distanceKm > 0) {
    const hours = minutesOffset / 60;
    const travelKm = windSpeedKmh * hours;
    
    // 이동 거리 및 각도 오프셋 벡터 결합
    const radWind = (windBearingDeg * Math.PI) / 180;
    const dx = travelKm * Math.sin(radWind);
    const dy = travelKm * Math.cos(radWind);

    const radOrig = (bearingDeg * Math.PI) / 180;
    const origX = distanceKm * Math.sin(radOrig) + dx;
    const origY = distanceKm * Math.cos(radOrig) + dy;

    effectiveDistance = Math.min(220, Math.sqrt(origX * origX + origY * origY));
    effectiveBearing = (Math.atan2(origX, origY) * 180 / Math.PI + 360) % 360;
  }

  return {
    id,
    distanceKm: Math.round(effectiveDistance),
    bearingDeg: Math.round(effectiveBearing),
    lat,
    lon,
    cloudCover: Number(cloudCover.toFixed(2)),
    cloudType,
    cloudName,
    isSpecial,
    windSpeedKmh,
    windBearingDeg,
  };
}
