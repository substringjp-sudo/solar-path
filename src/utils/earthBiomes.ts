/**
 * earthBiomes.ts — 우주 모드(MapGlobe)용 경량 지형 · 고도 · 해저 수심 GeoJSON 정의.
 *
 * `MapGlobe` 의 `landClip`(WORLD_LAND)과 `globeClip` 안에서 `d3-geo` 투영기로 바로 그려지므로
 * 해안선 정밀도 부담 없이 지역별 토지색(열대우림 · 사막 · 타이가 · 빙설), 주요 산맥/고원 고도,
 * 얕은 대륙붕과 심해저 분지를 가볍게 표현합니다.
 */
import * as d3 from 'd3-geo';

export interface BiomeFeature {
  id: string;
  geometry: GeoJSON.Polygon;
}

const RAD = Math.PI / 180;

/**
 * `(cx, cy)` 중심 타원형 GeoJSON 폴리곤을 생성합니다.
 * `d3.geoArea` 가 작은 쪽(< 2π)이 되도록 시계 방향(d3-geo 구면 규약)으로 정렬합니다.
 */
function makeRegion(
  id: string,
  lon: number,
  lat: number,
  rxDeg: number,
  ryDeg: number,
  rotDeg: number = 0,
  steps: number = 18,
): BiomeFeature {
  const cosR = Math.cos(rotDeg * RAD);
  const sinR = Math.sin(rotDeg * RAD);
  const ring: [number, number][] = [];
  // d3-geo 는 구면에서 시계 방향 링을 내부로 봅니다 (t: 0 -> -2π)
  for (let i = 0; i < steps; i++) {
    const t = -(i / steps) * Math.PI * 2;
    const lx = rxDeg * Math.cos(t);
    const ly = ryDeg * Math.sin(t);
    const dLon = lx * cosR - ly * sinR;
    const dLat = lx * sinR + ly * cosR;
    ring.push([
      Math.max(-179.9, Math.min(179.9, lon + dLon)),
      Math.max(-89.5, Math.min(89.5, lat + dLat)),
    ]);
  }
  ring.push(ring[0]);
  const poly: GeoJSON.Polygon = { type: 'Polygon', coordinates: [ring] };
  // 혹시 구면 면적이 2π 를 넘으면(반대쪽이 내부로 잡힌 경우) 링을 뒤집습니다.
  if (d3.geoArea(poly) > Math.PI * 2) {
    poly.coordinates[0] = [...ring].reverse();
  }
  return { id, geometry: poly };
}

function makeCircle(id: string, lon: number, lat: number, radiusDeg: number): BiomeFeature {
  const poly = d3.geoCircle().center([lon, lat]).radius(radiusDeg).precision(12)();
  return { id, geometry: poly };
}

/** ── 바다 수심: 깊은 심해저 분지 · 해구 ── */
export const OCEAN_ABYSSAL_FEATURES: readonly BiomeFeature[] = [
  makeRegion('abyss-npac', -168, 28, 36, 16, -8),
  makeRegion('abyss-mariana', 146, 18, 8, 13, 12),
  makeRegion('abyss-spac', -132, -28, 34, 18, 6),
  makeRegion('abyss-natl', -42, 27, 20, 14, 18),
  makeRegion('abyss-satl', -18, -22, 16, 18, -10),
  makeRegion('abyss-ind', 76, -18, 22, 18, 12),
];

/** ── 바다 수심: 얕은 대륙붕 · 연안 천해 ── */
export const OCEAN_SHELF_FEATURES: readonly BiomeFeature[] = [
  makeRegion('shelf-yellow', 123, 33, 6.5, 7.5, -15),      // 황해 · 동중국해
  makeRegion('shelf-sunda', 109, 2, 12, 11, -18),          // 순다 대륙붕 · 자바해
  makeRegion('shelf-carib', -77, 22, 9, 5.5, -20),         // 바하마 · 카리브 천해
  makeRegion('shelf-north', 3, 55, 7, 5, 10),              // 북해
  makeRegion('shelf-persian', 52, 26, 5, 2.8, -32),        // 페르시아만
  makeRegion('shelf-hudson', -84, 59, 8, 6, 0),            // 허드슨만
  makeRegion('shelf-arafura', 136, -11, 9, 4.5, -10),      // 아라푸라해 · 그레이트배리어리프
];

/** ── 육지 생물군계 (landClip 으로 대륙 경계에 맞춰 잘림) ── */
export const LAND_RAINFOREST_FEATURES: readonly BiomeFeature[] = [
  makeRegion('rf-amazon', -61, -4, 16, 10, -10),
  makeRegion('rf-congo', 21, 0, 10, 7.5, 5),
  makeRegion('rf-seasia', 112, 1, 18, 9, -15),
  makeRegion('rf-central-am', -84, 10, 6, 4, -35),
];

export const LAND_DESERT_FEATURES: readonly BiomeFeature[] = [
  makeRegion('des-sahara-w', -2, 23, 18, 8.5, -5),
  makeRegion('des-sahara-e', 24, 22, 14, 8, 4),
  makeRegion('des-arabia', 46, 23, 11, 8, -22),
  makeRegion('des-iran', 57, 32, 8, 5.5, -15),
  makeRegion('des-gobi', 100, 41, 16, 6, 8),
  makeRegion('des-kazakh', 63, 44, 12, 6, 5),
  makeRegion('des-aus', 133, -24, 14, 7.5, -8),
  makeRegion('des-swus', -111, 33, 8, 6, -25),
  makeRegion('des-kalahari', 19, -23, 6.5, 6.5, 0),
  makeRegion('des-atacama', -69, -22, 3, 8, -8),
];

export const LAND_TAIGA_FEATURES: readonly BiomeFeature[] = [
  makeRegion('taiga-sib-w', 76, 61, 24, 8, 4),
  makeRegion('taiga-sib-e', 120, 62, 26, 8.5, -6),
  makeRegion('taiga-can', -100, 58, 28, 8, -10),
  makeRegion('taiga-scand', 18, 64, 9, 5, 22),
];

export const LAND_ICE_FEATURES: readonly BiomeFeature[] = [
  makeCircle('ice-antarctica', 0, -90, 24),
  makeRegion('ice-greenland', -42, 72, 14, 10, 14),
];

/** ── 주요 산맥 · 고원 (고도 1단계: 고지대/기저, 2단계: 최고봉/만년설) ── */
export const ELEVATION_HIGHLANDS: readonly BiomeFeature[] = [
  makeRegion('elev-tibet', 88, 33, 14, 6.5, -10),
  makeRegion('elev-andes-n', -73, -10, 4.5, 13, -15),
  makeRegion('elev-andes-s', -69, -32, 3.2, 13, 6),
  makeRegion('elev-rockies', -111, 43, 6.5, 14, -24),
  makeRegion('elev-alps', 12, 46, 7.5, 2.8, 10),
  makeRegion('elev-caucasus', 44, 42, 5.5, 2.4, -22),
  makeRegion('elev-ethiopia', 39, 9, 5, 5, 10),
];

export const ELEVATION_PEAKS: readonly BiomeFeature[] = [
  makeRegion('peak-himalaya', 85, 29, 10, 2.4, -14),
  makeRegion('peak-andes', -69, -20, 2.2, 11, -6),
  makeRegion('peak-rockies', -114, 48, 3.5, 9, -25),
  makeRegion('peak-alps', 10, 46.5, 4.5, 1.4, 8),
];
