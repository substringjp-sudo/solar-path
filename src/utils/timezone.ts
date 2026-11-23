

/**
 * 주어진 기준 Date(기기 로컬 시간대)를 특정 법정 오프셋(시간) 기준으로 가상 변환합니다.
 * UTC 메소드(getUTCHours 등)를 통해 기기 시스템 타임존에 독립적으로 동작합니다.
 */
export const getLocalTimeAtLocation = (date: Date, offsetHours: number): Date => {
  return new Date(date.getTime() + offsetHours * 60 * 60 * 1000);
};

/**
 * 현지 로컬 시간 기준 가상 Date를 다시 기기 시간 기준 Date로 역변환합니다.
 */
export const getSystemTimeFromLocationTime = (locationDate: Date, offsetHours: number): Date => {
  return new Date(locationDate.getTime() - offsetHours * 60 * 60 * 1000);
};

