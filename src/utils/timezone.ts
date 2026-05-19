/**
 * 경도(Longitude)를 기반으로 해당 지역의 UTC 오프셋(시간)을 계산합니다.
 */
export const getTimezoneOffsetHours = (longitude: number): number => {
  return Math.round(longitude / 15);
};

/**
 * 계산된 오프셋을 기반으로 "GMT+9" 혹은 "GMT-8" 형식의 문자열을 반환합니다.
 */
export const getTimezoneLabel = (longitude: number): string => {
  const offset = getTimezoneOffsetHours(longitude);
  if (offset === 0) return 'GMT';
  return `GMT${offset > 0 ? '+' : ''}${offset}`;
};

/**
 * 주어진 기준 Date(기기 로컬 시간대)를 특정 경도의 현지 시간대 기준으로 가상 변환합니다.
 * 포맷팅용 텍스트를 만들 때 해당 오프셋을 가산/감산하여 표현합니다.
 */
export const getLocalTimeAtLocation = (date: Date, targetLongitude: number): Date => {
  const localOffsetHours = -date.getTimezoneOffset() / 60;
  const targetOffsetHours = getTimezoneOffsetHours(targetLongitude);
  
  // 두 오프셋의 차이 (시간)
  const diffHours = targetOffsetHours - localOffsetHours;
  
  // 차이를 반영한 새로운 Date 생성
  return new Date(date.getTime() + diffHours * 60 * 60 * 1000);
};

/**
 * 현지 로컬 시간 기준 가상 Date를 다시 기기 시간 기준 Date로 역변환합니다.
 * (데이트피커나 슬라이더에서 선택된 시간 값을 전역 상태에 쓸 때 역보정 필요)
 */
export const getSystemTimeFromLocationTime = (locationDate: Date, targetLongitude: number): Date => {
  const localOffsetHours = -locationDate.getTimezoneOffset() / 60;
  const targetOffsetHours = getTimezoneOffsetHours(targetLongitude);
  const diffHours = targetOffsetHours - localOffsetHours;
  return new Date(locationDate.getTime() - diffHours * 60 * 60 * 1000);
};
