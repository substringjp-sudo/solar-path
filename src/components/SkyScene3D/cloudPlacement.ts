/**
 * cloudPlacement.ts
 *
 * Why: 3D 구름을 태양 방위각 ±20° 안에만 뿌리던 기존 방식 대신,
 * cloudMatrix.ts의 29포인트 방사 격자(0/50/100/200km)를 그대로 써서 360° 전방향에 배치합니다.
 *
 * 핵심 원칙 두 가지
 *  1) 완전 결정적(deterministic): Math.random()을 쓰지 않습니다. 셀 id + 인덱스 해시로만
 *     모양·크기·지터를 정하므로, 시간 슬라이더를 움직여도 구름이 튀지 않습니다.
 *  2) 색은 2D에서 검증된 엔진 재사용: getCloudPreset() + approximateCloudColors()를
 *     그대로 호출해 lit/shadow를 따로 받아옵니다(단색으로 뭉개지 않음).
 */
import {
  generate29GridPoints,
  computeCloudCellData,
  type CloudTypeCategory,
} from '../../utils/cloudMatrix';
import {
  getCloudPreset,
  approximateCloudColors,
  getSunBeamColor,
  type CloudPresetName,
} from '../SunsetSimulation/Visualizer';
import { getApproximatedSkyColor, clamp01 } from '../../utils/sunsetPhysics';
import { cloudAtlasKey, type CloudAtlas } from './cloudAtlas';

export type LayerType = 'high' | 'mid' | 'low';

/** 구름을 배치할 구면 반지름 (스카이돔 500, 지형 480 안쪽) */
export const CLOUD_SHELL_RADIUS = 430;

/** InstancedMesh 한 칸에 들어갈 구름 하나의 최종 상태 */
export interface CloudInstanceData {
  azimuthDeg: number;
  elevationDeg: number;
  /** 관측자로부터의 수평 거리 (km) — 정렬과 크기 계산에 사용 */
  distanceKm: number;
  /** 아틀라스 UV rect 키 */
  atlasKey: string;
  /** quad 세로 크기 (월드 유닛). 가로는 aspect를 곱해 결정 */
  sizeY: number;
  aspect: number;
  opacity: number;
  litRGB: { r: number; g: number; b: number };
  shadowRGB: { r: number; g: number; b: number };
  /** 0 = 카메라를 보는 빌보드, 1 = 바닥에 눕힌 수평 배치 */
  horizontal: boolean;
}

/** cloudMatrix의 5개 범주 → 10종 구름 프리셋 이름 */
const CATEGORY_TO_PRESET: Record<CloudTypeCategory, CloudPresetName> = {
  cumulonimbus: 'Cumulonimbus',
  cirrus: 'Cirrus',
  // 렌즈구름(lenticularis)은 고적운 계열의 렌즈 형태라 Altocumulus로 매핑
  lenticularis: 'Altocumulus',
  stratus: 'Stratus',
  fair_cumulus: 'Cumulus',
};

/** 프리셋별 대표 물리 고도 (km). Visualizer의 H_c 매핑과 맞춤 */
const PRESET_ALTITUDE_KM: Record<CloudPresetName, number> = {
  Cirrus: 11.0,
  Cirrocumulus: 9.5,
  Cirrostratus: 8.5,
  Altocumulus: 4.5,
  Altostratus: 4.0,
  Nimbostratus: 2.5,
  Stratocumulus: 1.8,
  Stratus: 1.0,
  Cumulus: 1.5,
  Cumulonimbus: 3.0,
};

function presetLayerType(name: CloudPresetName): LayerType {
  if (name === 'Cirrus' || name === 'Cirrocumulus' || name === 'Cirrostratus') return 'high';
  if (name === 'Altocumulus' || name === 'Altostratus') return 'mid';
  return 'low';
}

/** 문자열 → [0,1) 결정적 해시 */
function hash01(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 부호 없는 32비트로 정규화
  return ((h >>> 0) % 100000) / 100000;
}

/** 35km 이내는 머리 위로 지나가므로 눕혀서 그립니다(2D Visualizer와 동일 기준) */
const HORIZONTAL_DISTANCE_KM = 35;

export interface BuildCloudsParams {
  atlas: CloudAtlas;
  latitude: number;
  longitude: number;
  /** 씬의 현재 시각 — 바람 이류 오프셋 계산에 사용 */
  currentTime: Date;
  sunAltDeg: number;
  /** 대기 파라미터 (prediction.factors에서) */
  beta: number;
  pathClarity: number;
  overcast: number;
  dustIntensity: number;
  /** 셀 하나당 최대 구름 개수 */
  maxPerCell?: number;
  /** 전체 상한 (InstancedMesh 용량과 맞춰야 함) */
  maxTotal?: number;
}

/**
 * 29개 격자 셀 → 개별 구름 인스턴스 목록으로 전개합니다.
 * geometry 생성/해제가 전혀 없으므로 매 프레임 호출해도 안전합니다.
 */
export function buildCloudInstances(params: BuildCloudsParams): CloudInstanceData[] {
  const {
    atlas,
    latitude,
    longitude,
    currentTime,
    sunAltDeg,
    beta,
    pathClarity,
    overcast,
    dustIntensity,
    maxPerCell = 4,
    maxTotal = 320,
  } = params;

  // 바람 이류: 시간이 흐르면 구름이 실제로 흘러갑니다.
  // computeCloudCellData가 minutesOffset을 받아 풍향/풍속대로 위치를 옮겨줍니다.
  const minutesOffset = (currentTime.getTime() / 60000) % 600;

  const gridPoints = generate29GridPoints(latitude, longitude);

  // 하늘색은 셀마다 다시 구하지 않고 천정/지평선 2개만 캐싱 후 보간 (2D와 동일 전략)
  const zenithSky = getApproximatedSkyColor(80, 90, sunAltDeg, beta, pathClarity);
  const horizonSky = getApproximatedSkyColor(0.05, 0, sunAltDeg, beta, pathClarity);

  const out: CloudInstanceData[] = [];

  for (const gp of gridPoints) {
    const cell = computeCloudCellData(gp, minutesOffset);
    const presetName = CATEGORY_TO_PRESET[cell.cloudType];
    const layerType = presetLayerType(presetName);
    const altKm = PRESET_ALTITUDE_KM[presetName];

    // 구름량에 비례한 개수 (최소 1개는 배치)
    const count = Math.max(1, Math.round(cell.cloudCover * maxPerCell));

    // 같은 거리 링에 있는 셀들이 겹치지 않도록 담당 방위 폭을 계산
    const ringCount = cell.distanceKm <= 0 ? 1 : gridPoints.filter(p => p.distanceKm === gp.distanceKm).length;
    const sectorDeg = 360 / Math.max(1, ringCount);

    for (let k = 0; k < count; k++) {
      if (out.length >= maxTotal) break;

      const seed = hash01(`${cell.id}#${k}`);
      const seed2 = hash01(`${cell.id}#${k}#b`);
      const seed3 = hash01(`${cell.id}#${k}#c`);

      // 셀 담당 섹터 안에서만 방위 지터 → 링이 고르게 채워짐
      const azimuthDeg =
        (cell.bearingDeg + (seed - 0.5) * sectorDeg * 0.85 + 360) % 360;

      // 거리 지터 ±22%
      const distanceKm = Math.max(2, cell.distanceKm * (1 + (seed2 - 0.5) * 0.44));

      // 고도각: 수평거리와 구름 고도로 결정
      const elevationDeg = Math.atan2(altKm, Math.max(0.5, distanceKm)) * (180 / Math.PI);

      // 가까운 구름은 머리 위를 지나므로 눕혀 그립니다.
      // 단 해당 종류에 수평 템플릿이 없으면 일반 빌보드로 폴백합니다.
      let horizontal = distanceKm <= HORIZONTAL_DISTANCE_KM;
      let variantCount = countVariants(atlas, presetName, horizontal);
      if (variantCount === 0 && horizontal) {
        horizontal = false;
        variantCount = countVariants(atlas, presetName, false);
      }
      if (variantCount === 0) continue;

      const variant = Math.floor(seed3 * variantCount) % variantCount;
      const atlasKey = cloudAtlasKey(presetName, variant, horizontal);
      const rect = atlas.rects.get(atlasKey);
      if (!rect) continue;

      // ── 색상: 2D에서 쓰던 물리 엔진 그대로 ──────────────────────────────
      const preset = getCloudPreset(
        layerType,
        cell.cloudCover * 100,
        overcast,
        0,
        0,
        50,
        10000
      );

      // 구름 높이에서 본 태양 고도 (지평선 아래 태양도 높은 구름은 아직 비춤)
      const sunAltFromCloud = sunAltDeg + horizonDip(altKm);

      const elevRatio = clamp01(elevationDeg / 80.0);
      const ambientSky = {
        r: horizonSky.r + (zenithSky.r - horizonSky.r) * elevRatio,
        g: horizonSky.g + (zenithSky.g - horizonSky.g) * elevRatio,
        b: horizonSky.b + (zenithSky.b - horizonSky.b) * elevRatio,
      };
      const cloudBeam = getSunBeamColor(sunAltFromCloud);

      const colors = approximateCloudColors(
        sunAltFromCloud,
        layerType,
        preset,
        { pathClarity },
        overcast,
        dustIntensity,
        ambientSky,
        cloudBeam
      );

      // ── 크기 ────────────────────────────────────────────────────────────
      // 각크기 기준으로 잡아야 멀리 있는 구름이 자연스럽게 작아집니다.
      const baseAngularDeg = layerType === 'high' ? 26 : layerType === 'mid' ? 20 : 15;
      const angularDeg = baseAngularDeg * (0.75 + seed * 0.5);
      const sizeY = CLOUD_SHELL_RADIUS * Math.tan((angularDeg * Math.PI) / 360) * 2;

      out.push({
        azimuthDeg,
        elevationDeg,
        distanceKm,
        atlasKey,
        sizeY,
        aspect: rect.aspect,
        opacity: clamp01(preset.baseOpacity + cell.cloudCover * 0.55),
        litRGB: colors.litRGB,
        shadowRGB: colors.shadowRGB,
        horizontal,
      });
    }

    if (out.length >= maxTotal) break;
  }

  return out;
}

/**
 * 구름 고도에 따른 지평선 처짐 보정.
 * 높은 구름일수록 태양이 지평선 아래로 내려가도 더 오래 빛을 받습니다.
 */
function horizonDip(altKm: number): number {
  // 대략 sqrt 관계. 11km 권운이면 약 +3.4°
  return Math.sqrt(Math.max(0, altKm)) * 1.02;
}

/** 아틀라스에 구워진 변형 개수 조회 */
function countVariants(atlas: CloudAtlas, name: CloudPresetName, horizontal: boolean): number {
  let n = 0;
  while (atlas.rects.has(cloudAtlasKey(name, n, horizontal))) n++;
  return n;
}
