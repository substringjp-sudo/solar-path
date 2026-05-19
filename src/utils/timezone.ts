/**
 * 계산된 오프셋을 기반으로 "GMT+9" 혹은 "GMT-8" 형식의 문자열을 반환합니다.
 */
export const formatTimezoneOffsetLabel = (offsetHours: number): string => {
  if (offsetHours === 0) return 'GMT';
  return `GMT${offsetHours > 0 ? '+' : ''}${offsetHours}`;
};

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

/**
 * getLocalTimeAtLocation으로 변환된 가상 Date 객체를 UTC 기준으로 포맷팅합니다.
 * pattern: 'HH:mm' | 'yyyy-MM-dd' | 'yyyy-MM-dd HH:mm' | 'EEE, MMM d, yyyy'
 */
export const formatLocalTime = (date: Date, pattern: string): string => {
  const pad = (num: number) => String(num).padStart(2, '0');
  
  const yyyy = date.getUTCFullYear();
  const MM = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const HH = pad(date.getUTCHours());
  const mm = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const EEE = days[date.getUTCDay()];
  const MMM = months[date.getUTCMonth()];
  const d = String(date.getUTCDate());

  // Replace tokens carefully
  return pattern
    .replace('yyyy', String(yyyy))
    .replace('MMM', MMM)
    .replace('MM', MM)
    .replace('dd', dd)
    .replace('EEE', EEE)
    .replace('HH', HH)
    .replace('mm', mm)
    .replace('ss', ss)
    .replace('d', d);
};


