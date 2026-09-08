import * as Location from 'expo-location';
import { TeleportTarget } from '../store/useCelestialStore';

export const TELEPORT_PRESETS: Record<string, { lat: number; lon: number; name: string }> = {
  daebu: { lat: 37.262579, lon: 126.559687, name: '대부도 방아머리' },
  daebudo: { lat: 37.262579, lon: 126.559687, name: '대부도 방아머리' },
  jeongdongjin: { lat: 37.6917, lon: 129.0326, name: '정동진' },
  hyeopjae: { lat: 33.3938, lon: 126.2396, name: '제주 협재' },
  seoraksan: { lat: 38.1194, lon: 128.4656, name: '설악산 대청봉' },
  seoul: { lat: 37.5665, lon: 126.9780, name: '서울시청' },
  busan: { lat: 35.1587, lon: 129.1604, name: '해운대' },
  haeundae: { lat: 35.1587, lon: 129.1604, name: '해운대' },
  incheon: { lat: 37.4475, lon: 126.5936, name: '을왕리' },
  eurwangni: { lat: 37.4475, lon: 126.5936, name: '을왕리' },
  jeju: { lat: 33.5097, lon: 126.5219, name: '제주도' },
};

export interface TeleportParsedData {
  location?: Location.LocationObject;
  time?: Date;
  camera?: Omit<TeleportTarget, 'nonce'>;
}

export function parseTeleportUrl(url: string, baseDate: Date = new Date()): TeleportParsedData | null {
  if (!url || (!url.includes('teleport') && !url.includes('warp'))) {
    return null;
  }

  const queryIndex = url.indexOf('?');
  const params: Record<string, string> = {};
  if (queryIndex !== -1) {
    const queryString = url.slice(queryIndex + 1);
    const pairs = queryString.split('&');
    for (const pair of pairs) {
      const [k, v] = pair.split('=');
      if (k) {
        params[decodeURIComponent(k).toLowerCase()] = v ? decodeURIComponent(v) : '';
      }
    }
  }

  const result: TeleportParsedData = {};

  // 1. 위치 파싱 (preset 또는 lat/lon)
  let targetLat: number | undefined;
  let targetLon: number | undefined;

  const presetKey = params.preset || params.loc || params.place;
  if (presetKey && TELEPORT_PRESETS[presetKey.toLowerCase()]) {
    const p = TELEPORT_PRESETS[presetKey.toLowerCase()];
    targetLat = p.lat;
    targetLon = p.lon;
  } else {
    if (params.lat !== undefined && params.lat !== '') targetLat = parseFloat(params.lat);
    if (params.lon !== undefined && params.lon !== '') targetLon = parseFloat(params.lon);
    if (params.lng !== undefined && params.lng !== '') targetLon = parseFloat(params.lng);
  }

  if (targetLat !== undefined && targetLon !== undefined && !isNaN(targetLat) && !isNaN(targetLon)) {
    result.location = {
      coords: {
        latitude: targetLat,
        longitude: targetLon,
        altitude: 0,
        accuracy: 1,
        altitudeAccuracy: 1,
        heading: 0,
        speed: 0,
      },
      timestamp: Date.now(),
    };
  }

  // 2. 일시 파싱 (iso, date, time)
  if (params.iso) {
    const d = new Date(params.iso);
    if (!isNaN(d.getTime())) {
      result.time = d;
    }
  } else {
    let d = new Date(baseDate.getTime());
    let hasTimeOrDate = false;

    if (params.date) {
      const parts = params.date.split('-').map(s => parseInt(s, 10));
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        d.setFullYear(parts[0], parts[1] - 1, parts[2]);
        hasTimeOrDate = true;
      }
    }

    if (params.time) {
      const parts = params.time.split(':').map(s => parseInt(s, 10));
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        d.setHours(parts[0], parts[1], parts[2] || 0, 0);
        hasTimeOrDate = true;
      }
    }

    if (hasTimeOrDate) {
      result.time = d;
    }
  }

  // 3. 카메라 방위각, 고도각, FOV 파싱
  const camera: Omit<TeleportTarget, 'nonce'> = {};
  let hasCamera = false;

  if (params.az !== undefined && params.az !== '') {
    const az = parseFloat(params.az);
    if (!isNaN(az)) {
      camera.cameraAz = (az % 360 + 360) % 360;
      hasCamera = true;
    }
  }

  if (params.el !== undefined && params.el !== '') {
    const el = parseFloat(params.el);
    if (!isNaN(el)) {
      camera.cameraElev = Math.max(-50, Math.min(85, el));
      hasCamera = true;
    }
  }

  if (params.fov !== undefined && params.fov !== '') {
    const fov = parseFloat(params.fov);
    if (!isNaN(fov)) {
      camera.fov = Math.max(20, Math.min(120, fov));
      hasCamera = true;
    }
  }

  if (hasCamera) {
    result.camera = camera;
  }

  return result;
}
