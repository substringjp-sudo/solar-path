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

/**
 * ── 2D 주파수(FBM) 노이즈 & 유기적 레이더 에코 생성 ───────────────────────
 * 3D CloudSlab.ts 의 노이즈 주파수 모델을 2D 레이더 평면으로 투영합니다.
 */

function slabHash21(x: number, y: number): number {
  const pX = (x * 123.34 + y * 456.21) % 289;
  const dot = pX * pX + pX + 45.32;
  return Math.abs(Math.sin(dot) * 43758.5453) % 1;
}

function slabVNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = slabHash21(ix, iy);
  const b = slabHash21(ix + 1, iy);
  const c = slabHash21(ix, iy + 1);
  const d = slabHash21(ix + 1, iy + 1);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function slabFbm2D(x: number, y: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = 1.0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * slabVNoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / norm;
}

/** Catmull-Rom 기반 닫힌 부드러운 큐빅 베지어 패스 생성 */
export function getClosedSplinePath(points: { x: number; y: number }[]): string {
  const len = points.length;
  if (len < 3) return '';
  let d = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < len; i++) {
    const p0 = points[(i - 1 + len) % len];
    const p1 = points[i];
    const p2 = points[(i + 1) % len];
    const p3 = points[(i + 2) % len];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d + ' Z';
}

export interface RadarEchoBlob {
  id: string;
  cx: number;
  cy: number;
  outerPath: string;
  corePath?: string;
  outerColor: string;
  coreColor?: string;
  glowColor: string;
  cell: CloudCellData;
}

/**
 * 구름 셀과 레이더 좌표를 결합해 유기적 주파수 에코 형태를 만듭니다.
 */
export function buildRadarEchoBlob(
  cell: CloudCellData,
  cx: number,
  cy: number,
  scale: number = 1.0
): RadarEchoBlob {
  // 셀 고유 주파수 시드
  const seedX = (cell.bearingDeg * 0.13 + cell.distanceKm * 0.27) % 50;
  const seedY = (cell.lat * 3.1 + cell.lon * 2.7) % 50;

  // 운량 및 구름 유형에 따른 기준 반경
  const isCenter = cell.distanceKm === 0;
  const baseR = (isCenter ? 18 : 13 + cell.cloudCover * (cell.distanceKm > 100 ? 25 : 18)) * scale;

  const windRad = (cell.windBearingDeg * Math.PI) / 180;
  const numSteps = 16;
  const outerPoints: { x: number; y: number }[] = [];
  const corePoints: { x: number; y: number }[] = [];

  for (let i = 0; i < numSteps; i++) {
    const angle = (i * 2 * Math.PI) / numSteps;
    // 바람 방향으로 약간 늘어나는 이류 연신
    const windElongation = 1.0 + 0.22 * Math.cos(angle - windRad);

    // 2D FBM 주파수 변위 (유기적인 구름 가장자리 주름)
    const noiseVal = slabFbm2D(seedX + Math.cos(angle) * 2.2, seedY + Math.sin(angle) * 2.2, 3);
    const noiseFactor = 0.7 + 0.6 * noiseVal;

    const rOuter = baseR * windElongation * noiseFactor;
    outerPoints.push({
      x: cx + rOuter * Math.cos(angle),
      y: cy + rOuter * Math.sin(angle),
    });

    // 구름 코어 (고반사도 영역)
    const rCore = rOuter * (0.42 + cell.cloudCover * 0.24);
    corePoints.push({
      x: cx + rCore * Math.cos(angle),
      y: cy + rCore * Math.sin(angle),
    });
  }

  const outerPath = getClosedSplinePath(outerPoints);
  const hasCore = cell.cloudCover > 0.35 || cell.isSpecial;
  const corePath = hasCore ? getClosedSplinePath(corePoints) : undefined;

  // 기상 레이더 에코 반사도 색상 매핑
  let outerColor = 'rgba(56, 189, 248, 0.22)';
  let coreColor: string | undefined = undefined;
  let glowColor = 'rgba(56, 189, 248, 0.4)';

  switch (cell.cloudType) {
    case 'cumulonimbus': // 적란운 (위험 기상 - 강한 반사도 붉은 에코)
      outerColor = 'rgba(249, 115, 22, 0.38)';
      coreColor = 'rgba(239, 68, 68, 0.85)';
      glowColor = 'rgba(239, 68, 68, 0.6)';
      break;
    case 'stratus': // 층운 / 비구름 (연두~녹색 비구름 에코)
      outerColor = 'rgba(34, 197, 94, 0.28)';
      coreColor = 'rgba(52, 211, 153, 0.68)';
      glowColor = 'rgba(34, 197, 94, 0.45)';
      break;
    case 'cirrus': // 권운 (노을빛/자줏빛 얇은 에코)
      outerColor = 'rgba(168, 85, 247, 0.24)';
      coreColor = hasCore ? 'rgba(216, 180, 254, 0.55)' : undefined;
      glowColor = 'rgba(168, 85, 247, 0.4)';
      break;
    case 'lenticularis': // 렌즈구름
      outerColor = 'rgba(236, 72, 153, 0.32)';
      coreColor = 'rgba(244, 114, 182, 0.75)';
      glowColor = 'rgba(236, 72, 153, 0.5)';
      break;
    case 'fair_cumulus':
    default:
      outerColor = 'rgba(56, 189, 248, 0.25)';
      coreColor = hasCore ? 'rgba(226, 232, 240, 0.6)' : undefined;
      glowColor = 'rgba(56, 189, 248, 0.4)';
      break;
  }

  return {
    id: cell.id,
    cx,
    cy,
    outerPath,
    corePath,
    outerColor,
    coreColor,
    glowColor,
    cell,
  };
}
