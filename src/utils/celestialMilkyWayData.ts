import { EquatorialCoord, equatorialToHorizontal } from './celestialCoords';

// 은하 적도(Galactic Equator) 360도 궤적 샘플 포인트 데이터 (Galactic Longitude 0 ~ 360°)
// 각 은하 경도 l에 따른 적경(RA), 적위(Dec) 오프라인 맵핑 테이블 (15도 간격 24개 핵심 포인트)
export const MILKY_WAY_EQUATOR_NODES: { lDeg: number; raHours: number; decDeg: number; isCenter?: boolean }[] = [
  { lDeg: 0, raHours: 17.76, decDeg: -28.92, isCenter: true }, // 궁수자리 (은하 중심부)
  { lDeg: 15, raHours: 18.25, decDeg: -16.0 },
  { lDeg: 30, raHours: 18.78, decDeg: -2.8 },
  { lDeg: 45, raHours: 19.35, decDeg: 10.5 },
  { lDeg: 60, raHours: 20.0, decDeg: 23.5 }, // 독수리자리/백조자리 부근
  { lDeg: 75, raHours: 20.75, decDeg: 35.8 },
  { lDeg: 90, raHours: 21.65, decDeg: 47.0 }, // 백조자리 데네브 구역
  { lDeg: 105, raHours: 22.75, decDeg: 56.5 },
  { lDeg: 120, raHours: 0.05, decDeg: 62.8 }, // 카시오페아 구역
  { lDeg: 135, raHours: 1.75, decDeg: 63.5 },
  { lDeg: 150, raHours: 3.4, decDeg: 57.5 },
  { lDeg: 165, raHours: 4.6, decDeg: 46.5 },
  { lDeg: 180, raHours: 5.45, decDeg: 33.5 }, // 마차부/오리온 은하수 반대편 (Galactic Anticenter)
  { lDeg: 195, raHours: 6.15, decDeg: 19.5 },
  { lDeg: 210, raHours: 6.75, decDeg: 5.0 },
  { lDeg: 225, raHours: 7.35, decDeg: -9.5 },
  { lDeg: 240, raHours: 7.95, decDeg: -23.5 },
  { lDeg: 255, raHours: 8.6, decDeg: -36.5 },
  { lDeg: 270, raHours: 9.35, decDeg: -48.0 }, // 돛자리/용골자리
  { lDeg: 285, raHours: 10.45, decDeg: -57.5 },
  { lDeg: 300, raHours: 12.2, decDeg: -62.8 }, // 남십자자리 구역
  { lDeg: 315, raHours: 14.3, decDeg: -61.5 },
  { lDeg: 330, raHours: 15.85, decDeg: -52.5 },
  { lDeg: 345, raHours: 16.95, decDeg: -41.5 },
];

/**
 * 특정 시간/위도/경도에서의 은하수 대원 궤적(방위각, 고도각) 산출 유틸
 */
export function getCalculatedMilkyWay(lat: number, lon: number, date: Date) {
  return MILKY_WAY_EQUATOR_NODES.map((node) => {
    const horizontal = equatorialToHorizontal(
      { raHours: node.raHours, decDeg: node.decDeg },
      lat,
      lon,
      date
    );

    return {
      lDeg: node.lDeg,
      azimuth: horizontal.azimuthDeg,
      altitude: horizontal.altitudeDeg,
      isCenter: !!node.isCenter,
      isVisible: horizontal.altitudeDeg > 0,
    };
  });
}
