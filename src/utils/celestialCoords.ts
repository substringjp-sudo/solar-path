export interface EquatorialCoord {
  raHours: number;  // 적경 (0 ~ 24 시간)
  decDeg: number;   // 적위 (-90 ~ +90 도)
}

export interface HorizontalCoord {
  azimuthDeg: number;  // 방위각 (0 ~ 360 도, 북쪽=0, 동쪽=90)
  altitudeDeg: number; // 고도각 (-90 ~ +90 도, 지평선=0)
}

/**
 * UTC Date 기준 그린위치 항성시(GMST: Greenwich Mean Sidereal Time) 계산 (도 단위)
 */
export function getGMSTDeg(date: Date): number {
  const jd = date.getTime() / 86400000 + 2440587.5; // 율리우스일 (Julian Date)
  const d = jd - 2451545.0; // J2000.0 기준 일수
  let gmst = 280.46061837 + 360.98564736629 * d;
  gmst = ((gmst % 360) + 360) % 360;
  return gmst;
}

/**
 * 지방 항성시(LMST: Local Mean Sidereal Time) 계산 (도 단위)
 */
export function getLMSTDeg(date: Date, lonDeg: number): number {
  const gmst = getGMSTDeg(date);
  let lmst = gmst + lonDeg;
  lmst = ((lmst % 360) + 360) % 360;
  return lmst;
}

/**
 * 적도 좌표계 (적경 RA, 적위 Dec) -> 지평 좌표계 (방위각 Azimuth, 고도각 Altitude) 변환
 */
export function equatorialToHorizontal(
  coord: EquatorialCoord,
  latDeg: number,
  lonDeg: number,
  date: Date
): HorizontalCoord {
  const lmstDeg = getLMSTDeg(date, lonDeg);
  const raDeg = coord.raHours * 15; // 시 간 -> 도 단위 변환
  const haDeg = ((lmstDeg - raDeg + 360) % 360); // 시각각 (Hour Angle)

  const latRad = (latDeg * Math.PI) / 180;
  const decRad = (coord.decDeg * Math.PI) / 180;
  const haRad = (haDeg * Math.PI) / 180;

  // 고도각 sin(alt) = sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(ha)
  const sinAlt = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  const altRad = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const altitudeDeg = (altRad * 180) / Math.PI;

  // 방위각 cos(az) = (sin(dec) - sin(lat) * sin(alt)) / (cos(lat) * cos(alt))
  const cosAlt = Math.cos(altRad);
  let azimuthDeg = 0;
  if (Math.abs(cosAlt) > 1e-6) {
    const cosAz = (Math.sin(decRad) - Math.sin(latRad) * sinAlt) / (Math.cos(latRad) * cosAlt);
    const clampedCosAz = Math.max(-1, Math.min(1, cosAz));
    let azRad = Math.acos(clampedCosAz);

    if (Math.sin(haRad) > 0) {
      azRad = 2 * Math.PI - azRad;
    }
    azimuthDeg = (azRad * 180) / Math.PI;
  }

  return {
    azimuthDeg: Math.round(((azimuthDeg + 360) % 360) * 100) / 100,
    altitudeDeg: Math.round(altitudeDeg * 100) / 100,
  };
}
