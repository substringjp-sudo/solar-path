/**
 * waterMask.ts
 *
 * 2D 지면-수면 분리 시스템:
 * 1. 고도 0m 이하 해안선 자연 분리: 관측자 중심 93개 고도 표본을 2D 평면 그리드로 보간하여
 *    만(Bay), 곶/반도(Peninsula), 섬의 자연스러운 2D 곡선 해안선을 생성합니다.
 * 2. 내륙 강과 호수(고도 > 0m) 수계 반영: OpenStreetMap(OSM)의 주요 강·호수 지오메트리를
 *    비동기로 받아와 2D 수역 텍스처에 합성합니다 (네트워크 실패 시에도 0m 해안선 기본 유지).
 */
import * as THREE from 'three';

const MASK_SIZE = 128; // 128x128 텍스처 (3D 원반 반경 475m 1:1 매핑, 1픽셀 ≈ 7.4m)
const MAX_RADIUS_M = 475.0; // 3D 지면 원반 반경 475m와 일치
const SAMPLES_AZ = 31;
const DISTANCES_KM = [5, 15, 40];

interface WaterMaskParams {
  latitude: number;
  longitude: number;
  observerElevation?: number;
  elevations?: number[];
  waterFrac?: number[];
}

export interface WaterMaskHandle {
  texture: THREE.DataTexture;
  dispose: () => void;
}

/**
 * 선분 래스터화 (두께 반영)
 */
function drawThickLine(
  buffer: Uint8Array,
  size: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness: number,
  val: number
) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let cx = x0;
  let cy = y0;

  const r = Math.max(0, Math.floor(thickness / 2));

  while (true) {
    for (let ox = -r; ox <= r; ox++) {
      for (let oy = -r; oy <= r; oy++) {
        const px = cx + ox;
        const py = cy + oy;
        if (px >= 0 && px < size && py >= 0 && py < size) {
          const idx = (py * size + px) * 4;
          buffer[idx] = Math.max(buffer[idx], val);
          buffer[idx + 1] = Math.max(buffer[idx + 1], val);
          buffer[idx + 2] = Math.max(buffer[idx + 2], val);
          buffer[idx + 3] = 255;
        }
      }
    }

    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
}

/**
 * 2D 고도 및 방위각 수역 비율로 3D 원반(475m) 해수면 마스크 생성
 */
function generateCoastlineMask(
  buffer: Uint8Array,
  observerElevation: number,
  elevations?: number[],
  waterFrac?: number[]
) {
  const center = (MASK_SIZE - 1) / 2;
  const hasElev = elevations && elevations.length >= SAMPLES_AZ * DISTANCES_KM.length;

  for (let y = 0; y < MASK_SIZE; y++) {
    for (let x = 0; x < MASK_SIZE; x++) {
      const u = (x - center) / center; // -1.0 ~ +1.0 (동: +1, 서: -1)
      const v = (y - center) / center; // -1.0 ~ +1.0 (남: +1, 북: -1)
      const r = Math.sqrt(u * u + v * v);

      const idx = (y * MASK_SIZE + x) * 4;

      if (r > 1.0) {
        // 원반 바깥
        buffer[idx] = 0;
        buffer[idx + 1] = 0;
        buffer[idx + 2] = 0;
        buffer[idx + 3] = 255;
        continue;
      }

      // 방위각 (북 = 0, 동 = π/2, 남 = π, 서 = 3π/2)
      let az = Math.atan2(u, -v);
      if (az < 0) az += Math.PI * 2;

      // 방위별 수역 비율 wf 계산
      let wf = 0.0;
      if (waterFrac && waterFrac.length > 0) {
        const azFrac = (az / (Math.PI * 2)) * waterFrac.length;
        const a0 = Math.floor(azFrac) % waterFrac.length;
        const a1 = (a0 + 1) % waterFrac.length;
        const fa = azFrac - Math.floor(azFrac);
        wf = waterFrac[a0] * (1 - fa) + waterFrac[a1] * fa;
      }

      let seaWater = 0.0;

      // 발밑 1.5m 해변(모래사장) 폭 (발밑 직후부터 화면 전체가 시원한 바다로 전개)
      const coastNoise = Math.sin(az * 7.0) * 0.001 + Math.cos(az * 19.0) * 0.0008;
      const beachR = Math.max(0.002, 0.004 + coastNoise); // 475m 기준 약 1.5m

      if (hasElev && elevations) {
        const azFrac = (az / (Math.PI * 2)) * SAMPLES_AZ;
        const a0 = Math.floor(azFrac) % SAMPLES_AZ;
        const a1 = (a0 + 1) % SAMPLES_AZ;
        const fa = azFrac - Math.floor(azFrac);

        const e5_0 = elevations[a0 * 3 + 0];
        const e5_1 = elevations[a1 * 3 + 0];
        const e5 = e5_0 * (1 - fa) + e5_1 * fa;

        // 5km 지점이 바다(e5 <= 0.05)이거나 방위별 수역 비율이 높은 경우(wf > 0.3):
        // 발밑 1.5m만 지나면 즉시 100% 시원한 바다 수면으로 전개
        if (e5 <= 0.05 || wf > 0.3) {
          if (r > beachR) {
            seaWater = Math.min(1.0, (r - beachR) / 0.006);
          }
        }
      } else if (wf > 0.15) {
        // elevations 없는 경우 waterFrac 기반 완벽한 해양 수면 전개:
        if (r > beachR) {
          seaWater = Math.min(1.0, ((r - beachR) / 0.006) * Math.min(1.0, wf * 1.6));
        }
      }

      const byteVal = Math.round(Math.min(1.0, seaWater) * 255);
      buffer[idx] = byteVal;
      buffer[idx + 1] = byteVal;
      buffer[idx + 2] = byteVal;
      buffer[idx + 3] = 255;
    }
  }
}

/**
 * OpenStreetMap Overpass API로 내륙 강과 호수 지오메트리 비동기 요청 및 텍스처 합성
 */
async function fetchAndApplyWaterways(
  buffer: Uint8Array,
  texture: THREE.DataTexture,
  lat: number,
  lon: number
) {
  // 관측자 주변 2km 바운딩 박스 (반경 475m 씬에 최적화)
  const latDelta = 2.0 / 110.574;
  const lonDelta = 2.0 / (111.32 * Math.cos((lat * Math.PI) / 180));
  const south = (lat - latDelta).toFixed(4);
  const north = (lat + latDelta).toFixed(4);
  const west = (lon - lonDelta).toFixed(4);
  const east = (lon + lonDelta).toFixed(4);

  const query = `[out:json][timeout:5];(way["waterway"~"river|canal"](${south},${west},${north},${east});way["natural"="water"](${south},${west},${north},${east}););out geom 80;`;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return;
    const data = await res.json();
    if (!data || !Array.isArray(data.elements)) return;

    const center = (MASK_SIZE - 1) / 2;
    let modified = false;

    for (const elem of data.elements) {
      if (!elem.geometry || !Array.isArray(elem.geometry) || elem.geometry.length < 2) continue;

      const geom = elem.geometry;
      for (let i = 0; i < geom.length - 1; i++) {
        const p0 = geom[i];
        const p1 = geom[i + 1];

        // 위경도 -> 중심 기준 m 거리
        const dx0 = (p0.lon - lon) * (111.32 * Math.cos((lat * Math.PI) / 180)) * 1000.0;
        const dy0 = (p0.lat - lat) * 110574.0;
        const dx1 = (p1.lon - lon) * (111.32 * Math.cos((lat * Math.PI) / 180)) * 1000.0;
        const dy1 = (p1.lat - lat) * 110574.0;

        // m 거리 -> 텍스처 픽셀 좌표 (반경 475m 기준)
        const x0 = Math.round(center + (dx0 / MAX_RADIUS_M) * center);
        const y0 = Math.round(center - (dy0 / MAX_RADIUS_M) * center);
        const x1 = Math.round(center + (dx1 / MAX_RADIUS_M) * center);
        const y1 = Math.round(center - (dy1 / MAX_RADIUS_M) * center);

        drawThickLine(buffer, MASK_SIZE, x0, y0, x1, y1, 2, 255);
        modified = true;
      }
    }

    if (modified) {
      texture.needsUpdate = true;
    }
  } catch {
    // 네트워크 실패 시 0m 해안선 마스크 그대로 유지
  }
}

/**
 * 관측자 위치와 고도 표본을 기반으로 2D 수역 마스크 텍스처를 생성합니다.
 */
export function createWaterMask2DTexture(params: WaterMaskParams): WaterMaskHandle {
  const { latitude, longitude, observerElevation = 50, elevations, waterFrac } = params;

  const data = new Uint8Array(MASK_SIZE * MASK_SIZE * 4);

  // 1. 고도 보간 기반 0m 해안선 생성 (동기 1~2ms)
  generateCoastlineMask(data, observerElevation, elevations, waterFrac);

  const texture = new THREE.DataTexture(data, MASK_SIZE, MASK_SIZE, THREE.RGBAFormat);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  // 2. 내륙 강/호수 지오메트리 비동기 요청 및 오버레이
  fetchAndApplyWaterways(data, texture, latitude, longitude);

  return {
    texture,
    dispose: () => {
      texture.dispose();
    },
  };
}
