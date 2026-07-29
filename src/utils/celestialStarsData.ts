import { EquatorialCoord, HorizontalCoord, equatorialToHorizontal } from './celestialCoords';

export interface StarItem {
  id: string;
  nameKo: string;
  nameEn: string;
  constellation: string;
  raHours: number; // 적경 (0 ~ 24)
  decDeg: number;  // 적위 (-90 ~ +90)
  magnitude: number; // 겉보기 등급 (낮을수록 밝음)
}

export interface ConstellationLine {
  id: string;
  nameKo: string;
  starPairs: [string, string][]; // 연결되는 두 별 ID의 쌍
}

// 오프라인 전용 전 세계 주요 항성 데이터베이스 (Mag 3.5 이하 50여 개 대표 항성)
export const BRIGHT_STARS_DATA: StarItem[] = [
  { id: 'sirius', nameKo: '시리우스', nameEn: 'Sirius', constellation: '큰개자리', raHours: 6.75, decDeg: -16.72, magnitude: -1.46 },
  { id: 'canopus', nameKo: '카노푸스', nameEn: 'Canopus', constellation: '용골자리', raHours: 6.4, decDeg: -52.7, magnitude: -0.74 },
  { id: 'arcturus', nameKo: '아르크투루스', nameEn: 'Arcturus', constellation: '목동자리', raHours: 14.26, decDeg: 19.18, magnitude: -0.05 },
  { id: 'rigel_kent', nameKo: '알파센타우리', nameEn: 'Alpha Centauri', constellation: '센타우루스자리', raHours: 14.66, decDeg: -60.83, magnitude: -0.27 },
  { id: 'vega', nameKo: '베가 (직녀성)', nameEn: 'Vega', constellation: '거문고자리', raHours: 18.62, decDeg: 38.78, magnitude: 0.03 },
  { id: 'capella', nameKo: '카펠라', nameEn: 'Capella', constellation: '마차부자리', raHours: 5.28, decDeg: 45.99, magnitude: 0.08 },
  { id: 'rigel', nameKo: '리겔', nameEn: 'Rigel', constellation: '오리온자리', raHours: 5.24, decDeg: -8.2, magnitude: 0.13 },
  { id: 'procyon', nameKo: '프로키온', nameEn: 'Procyon', constellation: '작은개자리', raHours: 7.65, decDeg: 5.22, magnitude: 0.34 },
  { id: 'betelgeuse', nameKo: '베텔게우스', nameEn: 'Betelgeuse', constellation: '오리온자리', raHours: 5.92, decDeg: 7.41, magnitude: 0.5 },
  { id: 'achernar', nameKo: '아케르나르', nameEn: 'Achernar', constellation: '에리다누스자리', raHours: 1.63, decDeg: -57.24, magnitude: 0.46 },
  { id: 'hadar', nameKo: '하다르', nameEn: 'Hadar', constellation: '센타우루스자리', raHours: 14.06, decDeg: -60.37, magnitude: 0.61 },
  { id: 'altair', nameKo: '알타이르 (견우성)', nameEn: 'Altair', constellation: '독수리자리', raHours: 19.84, decDeg: 8.87, magnitude: 0.77 },
  { id: 'acrux', nameKo: '아크룩스', nameEn: 'Acrux', constellation: '남십자자리', raHours: 12.44, decDeg: -63.1, magnitude: 0.76 },
  { id: 'aldebaran', nameKo: '알데바란', nameEn: 'Aldebaran', constellation: '황소자리', raHours: 4.6, decDeg: 16.51, magnitude: 0.86 },
  { id: 'antares', nameKo: '안타레스', nameEn: 'Antares', constellation: '전갈자리', raHours: 16.49, decDeg: -26.43, magnitude: 0.96 },
  { id: 'spica', nameKo: '스피카', nameEn: 'Spica', constellation: '처녀자리', raHours: 13.42, decDeg: -11.16, magnitude: 0.97 },
  { id: 'pollux', nameKo: '폴룩스', nameEn: 'Pollux', constellation: '쌍둥이자리', raHours: 7.76, decDeg: 28.03, magnitude: 1.14 },
  { id: 'fomalhaut', nameKo: '포말하우트', nameEn: 'Fomalhaut', constellation: '남쪽물고기자리', raHours: 22.96, decDeg: -29.62, magnitude: 1.16 },
  { id: 'deneb', nameKo: '데네브', nameEn: 'Deneb', constellation: '백조자리', raHours: 20.69, decDeg: 45.28, magnitude: 1.25 },
  { id: 'mimosa', nameKo: '미모사', nameEn: 'Mimosa', constellation: '남십자자리', raHours: 12.79, decDeg: -59.69, magnitude: 1.25 },
  { id: 'regulus', nameKo: '레굴루스', nameEn: 'Regulus', constellation: '사자자리', raHours: 10.14, decDeg: 11.97, magnitude: 1.35 },
  { id: 'adara', nameKo: '아다라', nameEn: 'Adhara', constellation: '큰개자리', raHours: 6.98, decDeg: -28.97, magnitude: 1.5 },
  { id: 'castor', nameKo: '카스토르', nameEn: 'Castor', constellation: '쌍둥이자리', raHours: 7.58, decDeg: 31.89, magnitude: 1.58 },
  { id: 'gacrux', nameKo: '가크룩스', nameEn: 'Gacrux', constellation: '남십자자리', raHours: 12.52, decDeg: -57.11, magnitude: 1.63 },
  { id: 'shaula', nameKo: '샤울라', nameEn: 'Shaula', constellation: '전갈자리', raHours: 17.56, decDeg: -37.1, magnitude: 1.62 },
  { id: 'bellatrix', nameKo: '벨라트릭스', nameEn: 'Bellatrix', constellation: '오리온자리', raHours: 5.42, decDeg: 6.35, magnitude: 1.64 },
  { id: 'elnath', nameKo: '엘나트', nameEn: 'Elnath', constellation: '황소자리', raHours: 5.44, decDeg: 28.61, magnitude: 1.65 },
  { id: 'alnilam', nameKo: '알닐람 (오리온 허리)', nameEn: 'Alnilam', constellation: '오리온자리', raHours: 5.6, decDeg: -1.2, magnitude: 1.69 },
  { id: 'polaris', nameKo: '북극성 (Polaris)', nameEn: 'Polaris', constellation: '작은곰자리', raHours: 2.53, decDeg: 89.26, magnitude: 1.98 },
  { id: 'dubhe', nameKo: '두베 (북두칠성 1성)', nameEn: 'Dubhe', constellation: '큰곰자리', raHours: 11.06, decDeg: 61.75, magnitude: 1.79 },
  { id: 'merak', nameKo: '메라크 (북두칠성 2성)', nameEn: 'Merak', constellation: '큰곰자리', raHours: 11.03, decDeg: 56.38, magnitude: 2.37 },
  { id: 'phecda', nameKo: '페크다 (북두칠성 3성)', nameEn: 'Phecda', constellation: '큰곰자리', raHours: 11.9, decDeg: 53.69, magnitude: 2.44 },
  { id: 'megrez', nameKo: '메그레즈 (북두칠성 4성)', nameEn: 'Megrez', constellation: '큰곰자리', raHours: 12.25, decDeg: 57.03, magnitude: 3.31 },
  { id: 'alioth', nameKo: '알리오스 (북두칠성 5성)', nameEn: 'Alioth', constellation: '큰곰자리', raHours: 12.9, decDeg: 55.96, magnitude: 1.76 },
  { id: 'mizar', nameKo: '미자르 (북두칠성 6성)', nameEn: 'Mizar', constellation: '큰곰자리', raHours: 13.4, decDeg: 54.92, magnitude: 2.23 },
  { id: 'alkaid', nameKo: '알카이드 (북두칠성 7성)', nameEn: 'Alkaid', constellation: '큰곰자리', raHours: 13.79, decDeg: 49.31, magnitude: 1.85 },
];

// 오프라인 대표 별자리 선 데이터 (오리オン, 북두칠성, 여름 삼각형 등)
export const CONSTELLATION_LINES_DATA: ConstellationLine[] = [
  {
    id: 'big_dipper',
    nameKo: '북두칠성',
    starPairs: [
      ['dubhe', 'merak'],
      ['merak', 'phecda'],
      ['phecda', 'megrez'],
      ['megrez', 'alioth'],
      ['alioth', 'mizar'],
      ['mizar', 'alkaid'],
    ],
  },
  {
    id: 'orion_main',
    nameKo: '오리온자리',
    starPairs: [
      ['betelgeuse', 'bellatrix'],
      ['bellatrix', 'rigel'],
      ['betelgeuse', 'alnilam'],
      ['rigel', 'alnilam'],
    ],
  },
  {
    id: 'summer_triangle',
    nameKo: '여름의 대삼각형',
    starPairs: [
      ['vega', 'altair'],
      ['altair', 'deneb'],
      ['deneb', 'vega'],
    ],
  },
  {
    id: 'gemini_twins',
    nameKo: '쌍둥이자리',
    starPairs: [
      ['castor', 'pollux'],
    ],
  },
];

/**
 * 특정 시간/위도/경도에서의 모든 별들의 지평 좌표계 위치 계산 (오프라인 연산)
 */
export function getCalculatedStars(lat: number, lon: number, date: Date) {
  return BRIGHT_STARS_DATA.map((star) => {
    const horizontal = equatorialToHorizontal(
      { raHours: star.raHours, decDeg: star.decDeg },
      lat,
      lon,
      date
    );

    return {
      ...star,
      azimuth: horizontal.azimuthDeg,
      altitude: horizontal.altitudeDeg,
      isVisible: horizontal.altitudeDeg > 0, // 지평선 위에 있는지 여부
    };
  });
}
