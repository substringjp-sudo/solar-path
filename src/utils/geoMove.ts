/**
 * 위치 이동 계산 (2026-11-19, 샌드박스 위치 이동·"내 위치 아님").
 * 짧은 거리(수 km 안)용 평면 근사입니다 — 위도 1° = 111,320 m, 경도 1° = 111,320 · cos(위도) m.
 */
const M_PER_DEG = 111320;
const RAD = Math.PI / 180;

/** (lat, lon) 에서 동쪽 eastM · 북쪽 northM 만큼 옮긴 좌표. */
export function offsetLatLon(lat: number, lon: number, eastM: number, northM: number): { latitude: number; longitude: number } {
  const latitude = Math.max(-89.9, Math.min(89.9, lat + northM / M_PER_DEG));
  const longitude = lon + eastM / (M_PER_DEG * Math.max(0.05, Math.cos(lat * RAD)));
  return { latitude, longitude: ((longitude + 540) % 360) - 180 };
}

/** 두 지점 사이 거리(m). 하버사인. */
export function distanceM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6371000;
  const dLat = (b.latitude - a.latitude) * RAD;
  const dLon = (b.longitude - a.longitude) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * RAD) * Math.cos(b.latitude * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
