/**
 * cloudPlacement.ts
 *
 * Why: 10종 운형(권운, 권적운, 권층운, 고적운, 고층운, 층적운, 층운, 적운, 적란운, 난층운)을 
 * 100% 매칭하여 3D 고도층(High 9-12km, Mid 4-6km, Low 1-3km)별로 체계적으로 배치합니다.
 */
import {
  generate29GridPoints,
  computeCloudCellData,
  type CloudTypeCategory,
} from '../../utils/cloudMatrix';
import { getCloudPreset, type CloudPresetName } from '../SunsetSimulation/Visualizer';
import { clamp01, type RGB } from '../../utils/sunsetPhysics';
import {
  skyRadiance,
  beamAtAltitude,
  cloudOpticalDepthFromDb,
  type AtmosphereParams,
} from '../../utils/atmosphere';
import { cloudAtlasKey, type CloudAtlas } from './cloudAtlas';

export type LayerType = 'high' | 'mid' | 'low';

/** 구름 3D 고도층별 구면 반지름 */
export const CLOUD_SHELL_RADIUS_HIGH = 460;
export const CLOUD_SHELL_RADIUS_MID  = 430;
export const CLOUD_SHELL_RADIUS_LOW  = 400;

export interface CloudInstanceData {
  azimuthDeg: number;
  elevationDeg: number;
  distanceKm: number;
  atlasKey: string;
  sizeY: number;
  aspect: number;
  opacity: number;
  beam: RGB;
  ambient: RGB;
  tau: number;
  altitudeKm: number;
  shadowContrast: number;
  rimSharpness: number;
  horizontal: boolean;
  shellRadius: number;
}

/** 
 * cloudMatrix 5개 범주 + 셀 seed 기반으로 10종 구름 프리셋으로 세분화 매핑 
 */
function resolvePreset(category: CloudTypeCategory, seed: number): CloudPresetName {
  switch (category) {
    case 'cirrus': {
      if (seed < 0.35) return 'Cirrus';
      if (seed < 0.70) return 'Cirrocumulus';
      return 'Cirrostratus';
    }
    case 'lenticularis': {
      if (seed < 0.5) return 'Altocumulus';
      return 'Altostratus';
    }
    case 'stratus': {
      if (seed < 0.33) return 'Stratus';
      if (seed < 0.66) return 'Stratocumulus';
      return 'Nimbostratus';
    }
    case 'fair_cumulus': {
      if (seed < 0.7) return 'Cumulus';
      return 'Stratocumulus';
    }
    case 'cumulonimbus': {
      if (seed < 0.6) return 'Cumulonimbus';
      return 'Nimbostratus';
    }
    default:
      return 'Cumulus';
  }
}

/** 프리셋별 대표 물리 고도 (km) */
const PRESET_ALTITUDE_KM: Record<CloudPresetName, number> = {
  Cirrus: 11.5,
  Cirrocumulus: 10.0,
  Cirrostratus: 9.0,
  Altocumulus: 5.2,
  Altostratus: 4.2,
  Nimbostratus: 2.8,
  Stratocumulus: 2.0,
  Stratus: 1.2,
  Cumulus: 1.6,
  Cumulonimbus: 3.5,
};

function presetLayerType(name: CloudPresetName): LayerType {
  if (name === 'Cirrus' || name === 'Cirrocumulus' || name === 'Cirrostratus') return 'high';
  if (name === 'Altocumulus' || name === 'Altostratus') return 'mid';
  return 'low';
}

function layerShellRadius(layer: LayerType): number {
  if (layer === 'high') return CLOUD_SHELL_RADIUS_HIGH;
  if (layer === 'mid') return CLOUD_SHELL_RADIUS_MID;
  return CLOUD_SHELL_RADIUS_LOW;
}

function hash01(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export interface BuildCloudsParams {
  atlas: CloudAtlas;
  latitude: number;
  longitude: number;
  currentTime: Date;
  sunAltDeg: number;
  sunAzDeg: number;
  atmosphere: AtmosphereParams;
  overcast: number;
  maxPerCell?: number;
  maxTotal?: number;
}

export function buildCloudInstances(params: BuildCloudsParams): CloudInstanceData[] {
  const {
    atlas,
    latitude,
    longitude,
    currentTime,
    sunAltDeg,
    sunAzDeg,
    atmosphere,
    overcast,
    maxPerCell = 4,
    maxTotal = 320,
  } = params;

  const minutesOffset = (currentTime.getTime() / 60000) % 600;
  const gridPoints = generate29GridPoints(latitude, longitude);

  const beamCache = new Map<number, RGB>();
  const beamFor = (altKm: number): RGB => {
    let v = beamCache.get(altKm);
    if (!v) {
      v = beamAtAltitude(sunAltDeg, altKm, atmosphere);
      beamCache.set(altKm, v);
    }
    return v;
  };

  const out: CloudInstanceData[] = [];

  for (const gp of gridPoints) {
    const cell = computeCloudCellData(gp, minutesOffset);

    const ringCount = cell.distanceKm <= 0 ? 1 : gridPoints.filter(p => p.distanceKm === gp.distanceKm).length;
    const sectorDeg = 360 / Math.max(1, ringCount);

    const count = Math.max(1, Math.round(cell.cloudCover * maxPerCell));

    for (let k = 0; k < count; k++) {
      if (out.length >= maxTotal) break;

      const seed1 = hash01(`${cell.id}#${k}`);
      const seed2 = hash01(`${cell.id}#${k}#b`);
      const seed3 = hash01(`${cell.id}#${k}#c`);

      const presetName = resolvePreset(cell.cloudType, seed1);
      const layerType = presetLayerType(presetName);
      const altKm = PRESET_ALTITUDE_KM[presetName];
      const shellRadius = layerShellRadius(layerType);

      const azimuthDeg = (cell.bearingDeg + (seed1 - 0.5) * sectorDeg * 0.85 + 360) % 360;
      const distanceKm = Math.max(2, cell.distanceKm * (1 + (seed2 - 0.5) * 0.44));

      // 3D 고도각: 수평거리와 실제 물리 고도(altKm)에 기반하여 정밀 계산
      const elevationDeg = Math.max(2.0, Math.atan2(altKm, Math.max(0.5, distanceKm)) * (180 / Math.PI));

      // 3D 빌보드 조망 (수평 눕힘 무조건 false -> 화면 가림 덮개 폴리곤 퇴치)
      const horizontal = false;

      let variantCount = countVariants(atlas, presetName, false);
      if (variantCount === 0) continue;

      const variant = Math.floor(seed3 * variantCount) % variantCount;
      const atlasKey = cloudAtlasKey(presetName, variant, false);
      const rect = atlas.rects.get(atlasKey);
      if (!rect) continue;

      const preset = getCloudPreset(
        layerType,
        cell.cloudCover * 100,
        overcast,
        0,
        0,
        50,
        10000
      );

      const beam = beamFor(altKm);

      const azDiff = ((sunAzDeg - azimuthDeg + 540) % 360) - 180;
      const gammaDeg = Math.acos(
        clamp01Signed(
          Math.sin((elevationDeg * Math.PI) / 180) * Math.sin((sunAltDeg * Math.PI) / 180) +
          Math.cos((elevationDeg * Math.PI) / 180) * Math.cos((sunAltDeg * Math.PI) / 180) *
          Math.cos((azDiff * Math.PI) / 180)
        )
      ) * (180 / Math.PI);
      const ambient = skyRadiance(elevationDeg, gammaDeg, sunAltDeg, atmosphere);

      const tau = cloudOpticalDepthFromDb(preset.scattering, cell.cloudCover);

      // 종횡비 및 구름 크기 안정화 (과도한 찌그러짐 방지)
      const baseAngularDeg = layerType === 'high' ? 22 : layerType === 'mid' ? 18 : 14;
      const angularDeg = baseAngularDeg * (0.8 + seed1 * 0.4);
      const sizeY = shellRadius * Math.tan((angularDeg * Math.PI) / 360) * 2;
      const clampedAspect = Math.max(0.8, Math.min(2.5, rect.aspect));

      out.push({
        azimuthDeg,
        elevationDeg,
        distanceKm,
        atlasKey,
        sizeY,
        aspect: clampedAspect,
        opacity: clamp01(preset.baseOpacity + cell.cloudCover * 0.55),
        beam,
        ambient,
        tau,
        altitudeKm: altKm,
        shadowContrast: preset.shadowContrast,
        rimSharpness: preset.rimLightSharpness,
        horizontal: false,
        shellRadius,
      });
    }

    if (out.length >= maxTotal) break;
  }

  return out;
}

function clamp01Signed(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

function countVariants(atlas: CloudAtlas, name: CloudPresetName, horizontal: boolean): number {
  let n = 0;
  while (atlas.rects.has(cloudAtlasKey(name, n, horizontal))) n++;
  return n;
}
