import { CloudPathData } from '../utils/weather';

export type CloudGenus = 
  | 'cirrus'          // 권운: 높은 고도, 얇음 → 프리즘 효과, 핑크/골드로 발광
  | 'cirrostratus'    // 권층운: 높은 고도, 중간 두께 → 해무리 효과
  | 'cumulonimbus'    // 적란운: 매우 두꺼움, 탑처럼 솟음 → 태양 차단
  | 'altostratus'     // 고층운: 중간 고도, 넓게 퍼짐 → 빛 분산
  | 'altocumulus'     // 고적운: 중간 고도, 덩어리형 → 양떼구름
  | 'stratocumulus'   // 층적운: 낮은 고도, 뭉게뭉게 → 부분 차단
  | 'stratus'         // 층운: 낮은 고도, 균일 → 완전 차단
  | 'cumulus'         // 적운: 낮은 고도, 대류성 → 부분 차단
  | 'clear';          // 맑음

export interface PressureLevelCloud {
  pressure: number;        // hPa (1000, 925, 850, 700, 500, 300, 200)
  altitudeKm: number;      // 지오포텐셜 고도 (km)
  cloudCover: number;      // 0-100%
  humidity: number;        // 상대습도
  temperature: number;     // 기온 (°C) — 빙정운 판별에 사용
}

export interface ClassifiedCloud {
  genus: CloudGenus;
  baseAltKm: number;      // 구름 저면 고도
  topAltKm: number;       // 구름 상면 고도
  opticalThickness: number; // 추정 광학 두께 (0-100)
  coverage: number;        // 커버리지 (0-1)
  isIce: boolean;          // 빙정운 여부 (T < -40°C)
}

export interface CloudPoint {
  height: number;
  density: number;
  azimuth: number;
  genus: CloudGenus;
  opticalThickness: number;
  isIce: boolean;
  topHeight: number;
}

export interface SimulationPath {
  distance: number;
  profile: CloudPoint[];
}

export interface SimulationData {
  eventTime: Date;
  weatherData: CloudPathData[];
  pathData: SimulationPath[];
  weatherSource?: string;
  sunAzimuth?: number;
  terrainInfo?: {
    horizonOffset: number;
  };
}

export interface Theme {
  bg: string;
  glass: string;
  text: string;
  subText: string;
  border: string;
  accent: string;
}
