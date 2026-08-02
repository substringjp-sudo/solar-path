/**
 * cloudPlacement.ts
 *
 * Why: 10종 운형(권운, 권적운, 권층운, 고적운, 고층운, 층적운, 층운, 적운, 적란운, 난층운)을 
 * 100% 매칭하며, 고고도/원거리 구름은 스카이돔 구면에, 근거리 저층 구름은 머리 위 3D 월드 공간에
 * 푹신한 다중 서브 퍼프 클러스터 폴리곤 형태로 직접 띄워 디테일한 입체 대기를 모델링합니다.
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
  isOverheadLowCloud?: boolean;
  worldX?: number;
  worldY?: number;
  worldZ?: number;
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

/** 10종 운형별 디테일 물리 광학 파라미터 맵 (투명도, 광학 두께, 그림자, 림라이트) */
interface CloudOpticsConfig {
  tau: number;
  opacity: number;
  shadowContrast: number;
  rimSharpness: number;
}

const PRESET_OPTICS: Record<CloudPresetName, CloudOpticsConfig> = {
  Cirrus: { tau: 3.0, opacity: 0.38, shadowContrast: 0.12, rimSharpness: 0.25 },
  Cirrocumulus: { tau: 4.2, opacity: 0.42, shadowContrast: 0.15, rimSharpness: 0.30 },
  Cirrostratus: { tau: 5.0, opacity: 0.45, shadowContrast: 0.10, rimSharpness: 0.20 },
  Altocumulus: { tau: 14.0, opacity: 0.72, shadowContrast: 0.48, rimSharpness: 0.60 },
  Altostratus: { tau: 18.0, opacity: 0.78, shadowContrast: 0.38, rimSharpness: 0.35 },
  Stratocumulus: { tau: 24.0, opacity: 0.88, shadowContrast: 0.62, rimSharpness: 0.70 },
  Stratus: { tau: 12.0, opacity: 0.72, shadowContrast: 0.28, rimSharpness: 0.25 },
  Cumulus: { tau: 28.0, opacity: 0.92, shadowContrast: 0.78, rimSharpness: 0.88 },
  Cumulonimbus: { tau: 70.0, opacity: 0.98, shadowContrast: 0.94, rimSharpness: 0.95 },
  Nimbostratus: { tau: 50.0, opacity: 0.96, shadowContrast: 0.88, rimSharpness: 0.45 },
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
      const opticsConfig = PRESET_OPTICS[presetName] || PRESET_OPTICS.Cumulus;

      const azimuthDeg = (cell.bearingDeg + (seed1 - 0.5) * sectorDeg * 0.85 + 360) % 360;
      const distanceKm = Math.max(2, cell.distanceKm * (1 + (seed2 - 0.5) * 0.44));

      // 3D 고도각
      const elevationDeg = Math.max(2.0, Math.atan2(altKm, Math.max(0.5, distanceKm)) * (180 / Math.PI));

      let variantCount = countVariants(atlas, presetName, false);
      if (variantCount === 0) continue;

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
      const rawAmbient = skyRadiance(elevationDeg, gammaDeg, sunAltDeg, atmosphere);
      // 야간(sunAltDeg < 0)에도 은은한 달빛/대기광 최저 광량 보장
      const minNightAmbient = { r: 0.015, g: 0.022, b: 0.040 };
      const ambient = {
        r: Math.max(rawAmbient.r, minNightAmbient.r),
        g: Math.max(rawAmbient.g, minNightAmbient.g),
        b: Math.max(rawAmbient.b, minNightAmbient.b),
      };

      const tau = Math.max(opticsConfig.tau, cloudOpticalDepthFromDb(preset.scattering, cell.cloudCover));
      const opacity = clamp01(opticsConfig.opacity * (0.6 + cell.cloudCover * 0.45));

      // 종횡비 및 구름 크기 안정화
      const baseAngularDeg = layerType === 'high' ? 22 : layerType === 'mid' ? 18 : 14;
      const angularDeg = baseAngularDeg * (0.8 + seed1 * 0.4);

      // 근거리 저층 구름 (distanceKm <= 50km & layerType !== 'high')
      const isOverheadLowCloud = distanceKm <= 55 && layerType !== 'high';

      if (isOverheadLowCloud) {
        // 머리 위 3D 월드 공간 좌표 계산 (Direct Overhead 3D World Placement)
        // 저층 구름의 볼륨감을 살리기 위해 메인 퍼프 + 2~3개의 서브 오프셋 클러스터 생성
        const subPuffCount = layerType === 'low' ? (presetName === 'Cumulus' || presetName === 'Cumulonimbus' ? 3 : 2) : 1;
        
        const mainHorizDist = Math.max(12, distanceKm * 3.6);
        const mainWorldY = Math.max(35, Math.min(180, altKm * 28.0));
        const azRad = (azimuthDeg * Math.PI) / 180;

        for (let p = 0; p < subPuffCount; p++) {
          if (out.length >= maxTotal) break;
          const subSeed = hash01(`${cell.id}#${k}#puff#${p}`);
          const variant = Math.floor(subSeed * variantCount) % variantCount;
          const atlasKey = cloudAtlasKey(presetName, variant, false);
          const rect = atlas.rects.get(atlasKey);
          if (!rect) continue;

          // 메인 인스턴스는 오프셋 0, 서브 인스턴스는 푹신한 조각 흩뿌림 오프셋
          const offsetRadius = p === 0 ? 0 : (12 + subSeed * 24);
          const offsetAngle = subSeed * Math.PI * 2;

          const px = mainHorizDist * Math.sin(azRad) + offsetRadius * Math.cos(offsetAngle);
          const py = mainWorldY + (p === 0 ? 0 : (subSeed - 0.5) * 16);
          const pz = -mainHorizDist * Math.cos(azRad) + offsetRadius * Math.sin(offsetAngle);

          const puffScale = p === 0 ? 1.0 : (0.65 + subSeed * 0.4);
          const sizeY = (mainWorldY * 0.45 + 12) * puffScale;
          const clampedAspect = Math.max(0.85, Math.min(2.2, rect.aspect));

          out.push({
            azimuthDeg,
            elevationDeg,
            distanceKm,
            atlasKey,
            sizeY,
            aspect: clampedAspect,
            opacity: opacity * (p === 0 ? 1.0 : 0.82),
            beam,
            ambient,
            tau,
            altitudeKm: altKm,
            shadowContrast: opticsConfig.shadowContrast,
            rimSharpness: opticsConfig.rimSharpness,
            horizontal: false,
            shellRadius,
            isOverheadLowCloud: true,
            worldX: px,
            worldY: py,
            worldZ: pz,
          });
        }
      } else {
        // 고고도 / 원거리 구름: 기존 스카이돔 구면(Spherical Shell Dome) 좌표
        const variant = Math.floor(seed3 * variantCount) % variantCount;
        const atlasKey = cloudAtlasKey(presetName, variant, false);
        const rect = atlas.rects.get(atlasKey);
        if (!rect) continue;

        const sizeY = shellRadius * Math.tan((angularDeg * Math.PI) / 360) * 2;
        const clampedAspect = Math.max(0.8, Math.min(2.5, rect.aspect));

        out.push({
          azimuthDeg,
          elevationDeg,
          distanceKm,
          atlasKey,
          sizeY,
          aspect: clampedAspect,
          opacity,
          beam,
          ambient,
          tau,
          altitudeKm: altKm,
          shadowContrast: opticsConfig.shadowContrast,
          rimSharpness: opticsConfig.rimSharpness,
          horizontal: false,
          shellRadius,
          isOverheadLowCloud: false,
        });
      }
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
