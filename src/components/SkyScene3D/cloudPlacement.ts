/**
 * cloudPlacement.ts
 *
 * Why: 3D 구름을 태양 방위각 ±20° 안에만 뿌리던 기존 방식 대신,
 * cloudMatrix.ts의 29포인트 방사 격자(0/50/100/200km)를 그대로 써서 360° 전방향에 배치합니다.
 *
 * 핵심 원칙 두 가지
 *  1) 완전 결정적(deterministic): Math.random()을 쓰지 않습니다. 셀 id + 인덱스 해시로만
 *     모양·크기·지터를 정하므로, 시간 슬라이더를 움직여도 구름이 튀지 않습니다.
 *  2) 색은 atmosphere.ts의 단일 물리 모델에서 유도합니다. 구름 고도의 직달광과
 *     주변 하늘색, 광학두께 τ를 넘기면 셰이더가 2-stream 산란을 계산합니다.
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
  /** 구름 고도에서의 직달광 (linear RGB) */
  beam: RGB;
  /** 구름 주변 하늘색 (linear RGB) */
  ambient: RGB;
  /** 구름 광학두께 — 셰이더가 이걸로 반사/투과를 계산합니다 */
  tau: number;
  /** 구름 고도 (km) — 원경 대기 투시 계산에 사용 */
  altitudeKm: number;
  /** 도감의 그림자 대비 (0~1) */
  shadowContrast: number;
  /** 도감의 림라이트 날카로움 (0~1) */
  rimSharpness: number;
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
  sunAzDeg: number;
  /** 대기 광학 상태 (가시거리·습도·미세먼지에서 유도) */
  atmosphere: AtmosphereParams;
  overcast: number;
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
    sunAzDeg,
    atmosphere,
    overcast,
    maxPerCell = 4,
    maxTotal = 320,
  } = params;

  // 바람 이류: 시간이 흐르면 구름이 실제로 흘러갑니다.
  // computeCloudCellData가 minutesOffset을 받아 풍향/풍속대로 위치를 옮겨줍니다.
  const minutesOffset = (currentTime.getTime() / 60000) % 600;

  const gridPoints = generate29GridPoints(latitude, longitude);

  // 구름 고도별 직달광은 종류 수만큼만 계산하면 되므로 캐싱합니다.
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

      // ── 물리 색상 ───────────────────────────────────────────────────────
      const preset = getCloudPreset(
        layerType,
        cell.cloudCover * 100,
        overcast,
        0,
        0,
        50,
        10000
      );

      // 구름 고도에서의 직달광. 높은 구름은 해가 진 뒤에도 빛을 받습니다.
      const beam = beamFor(altKm);

      // 구름이 있는 방향의 하늘색 (재조명 성분)
      const azDiff = ((sunAzDeg - azimuthDeg + 540) % 360) - 180;
      const gammaDeg = Math.acos(
        clamp01Signed(
          Math.sin((elevationDeg * Math.PI) / 180) * Math.sin((sunAltDeg * Math.PI) / 180) +
          Math.cos((elevationDeg * Math.PI) / 180) * Math.cos((sunAltDeg * Math.PI) / 180) *
          Math.cos((azDiff * Math.PI) / 180)
        )
      ) * (180 / Math.PI);
      const ambient = skyRadiance(elevationDeg, gammaDeg, sunAltDeg, atmosphere);

      // 광학두께를 도감의 투과율(scattering)에서 역산합니다.
      // 이렇게 하면 도감에 적힌 "투과율 95%"가 화면에서 실제로 성립합니다.
      const tau = cloudOpticalDepthFromDb(preset.scattering, cell.cloudCover);

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
        beam,
        ambient,
        tau,
        altitudeKm: altKm,
        shadowContrast: preset.shadowContrast,
        rimSharpness: preset.rimLightSharpness,
        horizontal,
      });
    }

    if (out.length >= maxTotal) break;
  }

  return out;
}

/** [-1,1] 클램프 (acos 입력 보호) */
function clamp01Signed(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

/** 아틀라스에 구워진 변형 개수 조회 */
function countVariants(atlas: CloudAtlas, name: CloudPresetName, horizontal: boolean): number {
  let n = 0;
  while (atlas.rects.has(cloudAtlasKey(name, n, horizontal))) n++;
  return n;
}
