/**
 * SkyScene3D.tsx
 *
 * 3D 하늘 시뮬레이션의 메인 씬 컴포넌트.
 * GLView + Three.js로 구현하며, 기존 시뮬레이션과 동일한 데이터를 소비합니다.
 *
 * 구성:
 * - Skydome: 360° 물리 기반 하늘색
 * - TerrainRing: panoramicAngles 기반 지형 실루엣 + 3D Ground Plane (대지)
 * - CompassGroup: 3D 지평선 방위 링 & 방향 마커 (N, E, S, W)
 * - SunMesh & MoonMesh: 태양 및 달 디스크/위상
 * - StarField: 6.5등급까지 8,355개 실제 항성 + 5대 행성 (draw call 1개)
 * - MilkyWayBand: 은하 적도를 따르는 광대(光帶)
 * - CelestialPathMesh: 태양/달 24h 이동 궤적 리본 & 관측자 그림자
 * - CloudField: 10종 SVG 템플릿 아틀라스 기반 InstancedMesh 구름 (draw call 1개)
 */
import React, { useRef, useCallback, useEffect, useState, useMemo, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet, PanResponder, useWindowDimensions, Text, TouchableOpacity, ActivityIndicator, Animated } from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer, loadTextureAsync } from 'expo-three';
import * as THREE from 'three';
import { Target } from 'lucide-react-native';
import SunCalc from 'suncalc';
import { sunPosition } from '../../utils/solarPosition';
import { planetLabelVisible, moonLabelVisible, milkyWayLabelVisible } from '../../utils/labelVisibility';

import { createSkydome, updateSkydome, type SkydomeHandle } from './Skydome';
import {
  createTerrainRing,
  createTerrainBands,
  updateTerrainBands,
  type TerrainBandsHandle,
  createGroundPlane,
  setGroundHorizon,
  makeWaterTexture,
  createCompassGroup,
  updateTerrainColors,
  updateGroundColors,
  disposeTerrainRing,
  disposeGroundPlane,
  disposeCompassGroup,
  seaHorizonDipDeg,
  TERRAIN_MAX_ANGLE_DEG,
} from './TerrainRing';
import { createSun, updateSun, sunDisplayScale, type SunHandle } from './SunMesh';
import { sunVisibility, aerosolOpticsFromObs } from '../../utils/sunVisibility';
import { createMoonGroup, updateMoonPosition, type MoonHandle } from './MoonMesh';
import { createWaterMask2DTexture, type WaterMaskHandle } from '../../utils/waterMask';
import { loadDemPatch, clearDemCache, type DemPatch } from '../../utils/demTiles';
import {
  buildCloudShadowTexture, CLOUD_SHADOW_HALF_M,
} from '../../utils/cloudShadowMap';
import {
  createTerrainField,
  updateTerrainFieldEye,
  FIELD_FAR_M,
  FAR_FIELD_NEAR_M,
  FAR_FIELD_FAR_M,
  FAR_FIELD_RINGS,
  FIELD_RINGS,
  type TerrainFieldHandle,
} from './TerrainField';
import {
  createSeaPlane,
  SEA_MASK_RADIUS_M,
  updateSeaPlaneEye,
  type SeaPlaneHandle,
} from './SeaPlane';
import {
  createStarField,
  updateStarField,
  computeEquToHorizon,
  buildPlanetPoints,
  type StarFieldHandle,
} from './StarField';
import { createMilkyWayBand, updateMilkyWay, type MilkyWayHandle } from './MilkyWayBand';
import type { VolumetricScene } from '../VolumetricProbe/volumetricScene';
import { createResolutionGovernor, volumetricStats, type ResolutionGovernor } from '../../utils/volumetricGovernor';
import { setVolumetricStatus } from '../VolumetricProbe/volumetricStatus';
// §126.7 볼륨 하늘 — 메인 시뮬레이션 기본 경로로 활성화
const VOLUMETRIC_SKY_ENABLED = true;
/** 볼륨 하늘 기본 활성화 */
const VOLUMETRIC_SKY_DEFAULT_ON = true;
const loadVolumetric = (): typeof import('../VolumetricProbe/volumetricScene') | null =>
  (VOLUMETRIC_SKY_ENABLED ? require('../VolumetricProbe/volumetricScene') : null);
const loadLiveScene = (): typeof import('../VolumetricProbe/liveScene') | null =>
  (VOLUMETRIC_SKY_ENABLED ? require('../VolumetricProbe/liveScene') : null);
// §165 장면 캐시 키(순수 모듈) — liveScene 과 같은 이유로 게을리 불러옵니다.
const loadSceneKey = (): typeof import('../VolumetricProbe/sceneKey') | null =>
  (VOLUMETRIC_SKY_ENABLED ? require('../VolumetricProbe/sceneKey') : null);
import { createCelestialPathsGroup, updateCelestialPaths, setCelestialPathsNow, setCelestialPathsNearFade, NEAR_FADE_INNER_HOURS, CelestialPathsGroup } from './CelestialPathMesh';
import { bakeCloudAtlas, type CloudAtlas } from './cloudAtlas';
import { createCloudField, updateCloudField, type CloudField } from './CloudField';
import { ViewfinderOverlay } from './ViewfinderOverlay';
import {
  buildCloudInstances,
  buildCloudsFromColumns,
  LAYER_ALTITUDE_KM,
  type BuildCloudsResult,
} from './cloudPlacement';
import { sampleTimeline, type SkyTimeline, type SampledSky } from '../../utils/skyTimeline';
import {
  createCloudDeck,
  updateCloudDeck,
  CLOUD_SAMPLE_AZ_STEPS,
  type CloudDeckHandle,
  type GenusInput,
} from './CloudDeck';
import {
  createSceneComposer,
  assignLayer,
  DEFAULT_SOFT_SCALE,
  LAYER_SOFT_SKY,
  LAYER_MID,
  LAYER_SOFT_CLOUD,
  LAYER_FRONT,
  LAYER_CELESTIAL,
  LAYER_TERRAIN_DIST,
  LAYER_TERRAIN_LIT,
  type SceneComposerHandle,
} from './SceneComposer';
import { MapCanvas, type MapCanvasHandle } from '../IsolineMap/MapCanvas';
import { MapGlobe, type MapGlobeHandle } from '../IsolineMap/MapGlobe';
import {
  globeRadiusForDelta, deltaForGlobeRadius, type MapMode,
} from '../../utils/mapProjection';
import {
  P_FOV_END, P_MAP_MOUNT, P_FADE_START, P_HANDOFF, P_MAX,
  altitudeForProgress, cameraPoseForProgress, lonDeltaForProgress, progressForLonDelta,
  mapOpacityForProgress, glVisibleForProgress, homeCenterStep, progressFromPinch,
  globeLayerOpacityForLonDelta, globeMorphForLonDelta, flingProgress, settleProgress, settleDurationMs, easeOutCubic, pinchRateFromSamples,
} from '../../utils/zoomContinuum';
import { getTerminatorSegments, getSubsolarPoint, getSublunarPoint, getMoonPhase } from '../../utils/celestial';
import { buildSunOverlay } from '../../utils/solarGeometry';
import { sameBucket } from '../../utils/weatherCacheKey';
import * as d3 from 'd3-geo';
import { useCloudTopView } from '../IsolineMap/useCloudTopView';
import { fetchDayWeatherRing, type CloudPathData } from '../../utils/weather';
import { fetchNearestMetar, type MetarObs } from '../../utils/metar';
import {
  PRESET_OPTICS,
  representativePresetForObserver,
  blendedOpticsFromWeather,
  type BlendedOptics,
} from '../../utils/cloudPresets';

/** 방향별 광학을 담는 재사용 버퍼 — 갱신마다 576번 불리므로 새로 만들지 않습니다. */
const _genusOut: BlendedOptics = {
  tau: 0, shadowContrast: 0, cellSizeKm: 0, cellStrength: 0, cellAspect: 1,
};
import { resolveLayerWinds, elevationGrid, layerMeanCover } from '../../utils/skyColumn';
import type { LayerWinds } from '../../utils/weather';
import { fogAtObserver, layerTauScale } from '../../utils/cloudProfile';
import { makeAtmosphereParams, skyRadiance, beamAtAltitude, applyCloudDimming, applyTuningUniforms, angularSeparationDeg, groundLighting, moonLight, setSceneCityLight, SOLAR_BEAM_SCALE } from '../../utils/atmosphere';
import { getApparentAltitude } from '../../utils/sunsetPhysics';
import { getTuning, subscribeTuning } from '../../utils/skyTuning';
import { getPlanetEquatorialCoord, PlanetKey } from '../../utils/celestialPlanets';
import { effectiveMagLimit } from '../../utils/moonlight';
import { useCelestialStore } from '../../store/useCelestialStore';
import { L3 } from '../../utils/i18n';
import { isReducedMotion } from '../../theme/motion';

// 매 프레임 / 매 초마다 발생하는 객체 할당(GC Churn) 방지용 재사용 Vector3
const tempPlanetVec = new THREE.Vector3();
const projTempVec = new THREE.Vector3();
const trackingMwVec = new THREE.Vector3();
const sunDirDeckVec = new THREE.Vector3();
/** 박명광선의 기준점. 렌더 루프에서 매 프레임 다시 채웁니다. */
const sunDirRayVec = new THREE.Vector3();
const tempMoonDirVec = new THREE.Vector3();

function getPlanetDirectionVector(
  key: PlanetKey,
  date: Date,
  targetVec: THREE.Vector3 = tempPlanetVec
): THREE.Vector3 {
  const eq = getPlanetEquatorialCoord(key, date);
  const raRad = (eq.raHours / 24) * Math.PI * 2;
  const decRad = (eq.decDeg * Math.PI) / 180;
  const cd = Math.cos(decRad);
  return targetVec.set(cd * Math.cos(raRad), cd * Math.sin(raRad), Math.sin(decRad)).normalize();
}

export interface LayerState {
  labels: boolean;
  sun: boolean;
  moon: boolean;
  stars: boolean;
  milkyway: boolean;
  planets: boolean;
  clouds: boolean;
  paths: boolean;
  cityLights: boolean;
}

/** 별 표현을 사용자가 조절하는 값 (레이어 ON/OFF와 달리 연속값이라 따로 둡니다) */
export interface SkySettings {
  /** 밝기 배율 0~2 */
  starBrightness: number;
  /** 표시 한계 등급 (3 = 도심, 6.5 = 완전한 암천) */
  starMagLimit: number;
  /** 도트 모드(§97) — 화면을 이 줄 수로 그려 네모 화소 그대로 늘립니다. 0 = 끔. */
  pixelArtRows: number;
  /**
   * §126.7 볼륨 하늘 — 하늘돔·구름 슬랩 대신 takram 대기+볼륨 구름(종류별 모형, 지금 예보)을 하늘 층으로 씁니다.
   * 개발 빌드에서만 동작(출시 번들에는 takram 경로가 들어가지 않음). 지형·바다·해·달·별은 그대로입니다.
   */
  volumetricSky?: boolean;
  /** §127 볼륨 하늘 품질 단계(takram 행진 걸음 수) — 기본 low. */
  volumetricQuality?: 'low' | 'medium' | 'high';
  /** §127 볼륨 구름 해상도 최대 배율(화면 대비) — 기본 0.5. 자동 조절은 이 값 아래에서만 움직입니다. */
  volumetricRes?: number;
  /** §127 프레임 간격을 보고 구름 해상도를 자동으로 내리고 올림 — 기본 켬. */
  volumetricAutoRes?: boolean;
  /** §130 대기 흐름 구름 모형(flow) · 층별 바람 드리프트/전단 기울임(flowUv) — 자(RULER-flow)·운량 역표 재맞춤 전까지 기본 끔. */
  volumetricFlow?: boolean;
  volumetricFlowUv?: boolean;
  /** §136 구름 미세물리(physics: 종류별 소광·단열 단면·응결고도 밑면) · 얼음 무리(physicsIce) — 자(RULER-physics)를 넘기지 못해 기본 끔, 개발 패널 PHYS/ICE 칩으로 켬. */
  volumetricPhysics?: boolean;
  volumetricPhysicsIce?: boolean;
  /** §156 거시 운량 격자 — 0 끔(기울기 두 수) · 1 Barnes 격자(RULER-macro 판정으로 기본) · 2 스펙트럼 잡음까지(개발 패널 MAC 칩). */
  volumetricMacro?: 0 | 1 | 2;
  /** 연속 형태 생성기(morph) — 저층 무늬를 종류 프리셋 대신 예보 연속량으로 만듦 (개발 패널 MORPH 칩). */
  volumetricMorph?: boolean;
  /** 실험 — 촬영(카메라) 화면의 3D 시뮬에도 볼륨 하늘을 켭니다(기본 꺼짐: 카메라 스트림과 GPU 를 나눠 써 기기에서 ANR 이 났던 적이 있어 기기 확인 후 켭니다). 메인 시뮬레이션과 같은 구름이 됩니다. */
  cameraVolumetric?: boolean;
}

export const DEFAULT_SKY_SETTINGS: SkySettings = {
  starBrightness: 1.0,
  starMagLimit: 6.5,
  pixelArtRows: 0,
  volumetricSky: true,
  volumetricQuality: 'low',
  volumetricRes: 0.5,
  volumetricAutoRes: true,
  // §135 0단계: 흐름 모형은 자(RULER-flow)를 다 넘기지 못해 기본 끔으로 되돌립니다(커밋 1918960 이 켜 둔 것). 개발 패널 FLOW/UV 칩으로 켤 수 있습니다.
  volumetricFlow: false,
  volumetricFlowUv: false,
  volumetricPhysics: false,
  volumetricPhysicsIce: false,
  volumetricMacro: 1,
  volumetricMorph: false,
};

/**
 * 도트 모드의 굵기 — 화면 세로를 몇 줄로 그리는가. 한 도트는 화면 **정수** 화소입니다
 * (SceneComposer.setPixelArt). 폰 하늘 화면(세로 약 1,200~2,400 물리 화소)에서 256 줄이면
 * 한 도트가 5~9화소로 잔잔하고, 96 줄이면 12~25화소로 또렷한 옛 게임 느낌입니다.
 */
export const PIXEL_ART_CHOICES: { rows: number; label: string }[] = [
  { rows: 0, label: '끔' },
  { rows: 256, label: '가늘게' },
  { rows: 160, label: '보통' },
  { rows: 96, label: '굵게' },
];

interface SkyScene3DProps {
  sim: any;
  currentTime: Date;
  sunAltitude: number;
  sunAzimuth: number;
  prediction: any;
  location: any;
  interpolatedWeather: any[];
  theme: any;
  layers?: LayerState;
  fullScreen?: boolean;
  skySettings?: SkySettings;
  trackingTarget?: string | null;
  onSelectTrackingTarget?: (target: string | null) => void;
  /**
   * 사전 계산된 하루치 하늘. 있으면 매 갱신마다 다시 푸는 대신
   * 키프레임 사이를 보간해서 씁니다 (utils/skyTimeline.ts).
   */
  timeline?: SkyTimeline | null;
  isActive?: boolean;
  /** 사용자가 날짜/시간 슬라이더를 드래그 중인지 여부 (드래그 중에는 무거운 볼륨 씬 재생성을 보류) */
  isSliding?: boolean;
  /** 외부에서 강제 주입하는 카메라 방위각 (AR 카메라 실시간 연동 시 사용) */
  cameraAzimuthProp?: number;
  /** 외부에서 강제 주입하는 카메라 고도각 (AR 카메라 실시간 연동 시 사용) */
  cameraElevationProp?: number;
  /** 외부에서 강제 주입하는 카메라 시야각 FOV (카메라 줌 배율 연동 시 사용) */
  fovProp?: number;
  /** 내부 FOV HUD 배지 숨김 여부 */
  hideHudOverlay?: boolean;
  /** 내부 하단 나침반 눈금자 Bar 숨김 여부 */
  hideCompassBar?: boolean;
  /** 땅을 떠나 위로 올라갔는지(지상 시야각 단계를 넘었는지) 바뀔 때. 화면이 "지도로" 버튼을 숨기는 데 씁니다. */
  onAscendedChange?: (ascended: boolean) => void;
}

/** 3D 시뮬레이터 외부 제어 및 스냅샷 캡처 핸들 */
export interface SkyScene3DHandle {
  takeSnapshot: (options?: { format?: 'jpeg' | 'png'; compress?: number }) => Promise<string | null>;
  /** 마지막 스냅샷이 실패한 이유. 성공했거나 아직 안 찍었으면 null. */
  getLastSnapshotError: () => string | null;
  /**
   * 마지막 스냅샷 **직전에** GL 버퍼에서 직접 잰 가운데 32×32 평균 밝기
   * (0~255, −1 = 못 쟀음).
   *
   * 왜 필요한가: 저장된 그림이 검을 때 "그린 것이 검다"와 "스냅샷 경로가
   * 잃는다"를 가릅니다. 이 값이 0 이면 앞쪽, 0 이 아닌데 그림이 검으면
   * 뒤쪽입니다.
   */
  getLastBufferMean: () => number;
  /**
   * 이 프레임을 그린 **시선과 구름판 상태**(QR 보고서용). 장면이 아직 없으면 null.
   *
   * 예보 입력만으로는 기기 화면을 되살릴 수 없었습니다 — 시선은 센서값이라 QR 에 없고, 층
   * 높이·운해·안개·운량장은 예보에서 여러 단계를 거쳐 나옵니다(`readCloudSlabState`).
   */
  getRenderState: () => SkyRenderState | null;
  /** §165 볼륨 장면이 적용돼 마지막 프레임에 실제로 그려졌는가 — 카메라가 스냅샷 전에 묻습니다. */
  isVolumetricReady: () => boolean;
  /**
   * 하늘 → 지도(구름 레이더 축척)로 날아갑니다. 두 손가락 줌아웃의 **누르기 대안**입니다(디자인 2단).
   * 돌아올 때는 지도 위의 "착륙"을 씁니다.
   */
  flyToMap: () => void;
}

/** `SkyScene3DHandle.getRenderState` 의 값. */
/** §165 이 화면 인스턴스의 볼륨 하늘 상태 — 모듈 저장소(volumetricStatus)는 여러 화면이 함께 쓰므로 인스턴스별로 따로 봅니다. */
export type VolumetricPhaseOf = 'off' | 'creating' | 'updating' | 'running' | 'failed';
/** §165 마지막으로 **적용된** 볼륨 장면 — QR 에 실어 "카드가 무엇을 그렸는지" 를 입력과 따로 남깁니다. */
export interface VolumetricSceneState {
  /** 장면 시각(ISO) — 카메라 셔터 시각이 아니라 장면이 만들어진 시각 */
  t: string;
  /** 장면이 쓴 관측점 운량(%) — METAR 덮어쓰기 뒤의 값 */
  low: number; mid: number; high: number; total?: number;
  /** 그려진 종류(승격 적용) 'sc/as/-' */
  genus: string;
  /** §158 DNI 광학두께(없으면 undefined) */
  tau?: number;
}
export interface SkyRenderState {
  /** 시선: 방위(북 0°, 동 90°) · 고도 · 기울임(오른쪽으로 기울면 +) · 세로 화각 · 가로/세로 */
  view: { az: number; el: number; roll: number; fov: number; aspect: number };
  slab: null;
  /** 이 인스턴스의 볼륨 상태 · 마지막 적용 장면(없으면 null). 'running' 이 아니면 화면은 옛 하늘입니다(§165). */
  volPhase: VolumetricPhaseOf;
  scene: VolumetricSceneState | null;
}

const DEFAULT_LAYERS: LayerState = {
  labels: true,
  sun: true,
  moon: true,
  stars: true,
  milkyway: true,
  planets: true,
  clouds: true,
  paths: true,
  cityLights: true,
};

const DRAG_SENSITIVITY = 0.3;

/** InstancedMesh 용량. 29셀 × 최대 4개 ≈ 116이지만 여유를 둡니다. */
const MAX_CLOUDS = 160; // 320 → 160: 모바일 GPU 부하 절반 절감

/** 연중 일수 — 지구·태양 거리 보정에 사용 */
function dayOfYearOf(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}

function formatCompassText(azimuth: number): string {
  const az = ((azimuth % 360) + 360) % 360;
  let dir = 'N';
  if (az >= 22.5 && az < 67.5) dir = 'NE';
  else if (az >= 67.5 && az < 112.5) dir = 'E';
  else if (az >= 112.5 && az < 157.5) dir = 'SE';
  else if (az >= 157.5 && az < 202.5) dir = 'S';
  else if (az >= 202.5 && az < 247.5) dir = 'SW';
  else if (az >= 247.5 && az < 292.5) dir = 'W';
  else if (az >= 292.5 && az < 337.5) dir = 'NW';

  return `${dir} ${Math.round(az)}°`;
}

export const SkyScene3D = forwardRef<SkyScene3DHandle, SkyScene3DProps>((
  {
    sim,
    currentTime,
    sunAltitude,
    sunAzimuth,
    prediction,
    location,
    interpolatedWeather,
    theme,
    layers = DEFAULT_LAYERS,
    fullScreen = false,
    skySettings = DEFAULT_SKY_SETTINGS,
    trackingTarget,
    onSelectTrackingTarget,
    timeline = null,
    isActive = true,
    isSliding = false,
    cameraAzimuthProp,
    cameraElevationProp,
    fovProp,
    hideHudOverlay = false,
    hideCompassBar = false,
    onAscendedChange,
  },
  ref
) => {
  const { width, height } = useWindowDimensions();
  
  const SCENE_WIDTH = width - 32;
  const SCENE_HEIGHT = Math.round(SCENE_WIDTH * (3 / 4));

  // 실시간 UI 방위 및 뷰파인더 눈금자용 State
  const [cameraAzimuth, setCameraAzimuth] = useState<number>(cameraAzimuthProp ?? sunAzimuth);
  const [cameraElevation, setCameraElevation] = useState<number>(cameraElevationProp ?? 13);
  const [cameraFov, setCameraFov] = useState<number>(fovProp ?? 60);
  const [celestialLabels, setCelestialLabels] = useState<Array<{ id: string; name: string; x: number; y: number; color: string }>>([]);

  // Three.js refs
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const skydomeRef = useRef<SkydomeHandle | null>(null);
  const terrainRef = useRef<THREE.Mesh | null>(null);
  /** 거리대별 능선 (docs/GROUND_PLAN.md 3단계) */
  const terrainBandsRef = useRef<TerrainBandsHandle | null>(null);
  const groundRef = useRef<THREE.Mesh | null>(null);
  /** 2D 수역 마스크 (해안선·만·반도 + 강·호수) */
  const waterMaskHandleRef = useRef<WaterMaskHandle | null>(null);
  const waterTexRef = useRef<THREE.DataTexture | null>(null);
  const compassGroupRef = useRef<THREE.Group | null>(null);
  /**
   * **DEM 높이장 근거리 지형·해수면** (docs/COASTLINE_PLAN.md 1~5단계).
   *
   * `groundRef`(평평한 원반)·`terrainBandsRef`(5/15/40km 능선 실루엣)는
   * 그대로 둡니다 — 이 메시들은 그 **위에 얹히는 근거리(0~3km) 보강**이라,
   * DEM 을 못 받거나 아직 받는 중이면 기존 화면으로 그대로 물러납니다
   * (아래 렌더 순서 참고). 절대 기존 경로를 대체하지 않습니다.
   */
  const terrainFieldRef = useRef<TerrainFieldHandle | null>(null);
  const seaPlaneRef = useRef<SeaPlaneHandle | null>(null);
  const demPatchRef = useRef<DemPatch | null>(null);
  /** 진행 중인 요청과 마지막으로 받은 좌표 — 같은 자리를 중복 요청하지 않습니다. */
  const demLoadingKeyRef = useRef<string | null>(null);
  /**
   * 지금 원하는 좌표 키. 받던 결과를 쓸지는 이것으로 가립니다 — `location` 객체가 같은 좌표로 새로 오면
   * (위치 갱신, 웹 하네스의 매 렌더 새 객체) 이펙트가 다시 돌아 예전 실행이 취소되는데, 키가 같으면
   * 받던 결과가 그대로 맞습니다. 예전에는 그 결과를 버리고 '받는 중' 표시만 남아 다시 요청하지 않았습니다(§129).
   */
  const demWantKeyRef = useRef<string | null>(null);
  /** DEM 요청 재시도 타이머와 실패 횟수 — 아래 요청 이펙트가 씁니다. */
  const demRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demRetryCountRef = useRef(0);
  /** 땅에 지는 구름 그림자 지도. 구름·해가 바뀔 때만 다시 굽습니다. */
  const cloudShadowTexRef = useRef<THREE.DataTexture | null>(null);
  const cloudShadowKeyRef = useRef<string>('');
  const demLoadedKeyRef = useRef<string | null>(null);
  /**
   * 재시도를 이펙트에 알리는 눈금. ref 만 바꾸면 리액트가 이펙트를 다시
   * 돌리지 않으므로, 타이머가 이 값을 올려 재요청을 깨웁니다.
   */
  const [demRetryTick, setDemRetryTick] = useState(0);
  const sunRef = useRef<SunHandle | null>(null);
  const moonRef = useRef<MoonHandle | null>(null);
  /** 달을 광원으로 둔 지면 조도(이득 곱하기 전) — 달이 움직였을 때만 다시 구합니다. */
  const moonGroundCacheRef = useRef<{ alt: number; az: number; atmos: unknown; sky: { r: number; g: number; b: number }; beam: { r: number; g: number; b: number } } | null>(null);
  const starFieldRef = useRef<StarFieldHandle | null>(null);
  const milkyWayRef = useRef<MilkyWayHandle | null>(null);
  const celestialPathsRef = useRef<CelestialPathsGroup | null>(null);
  
  /** 별·은하수가 공유하는 적도→지평 회전 행렬 (프레임당 1회만 계산) */
  const equToHorizonRef = useRef(new THREE.Matrix3());
  const cloudAtlasRef = useRef<CloudAtlas | null>(null);
  /** 마지막 구름 빌드 결과 — 덱 셸과 태양 차폐가 같은 샘플을 씁니다. */
  const lastCloudBuildRef = useRef<BuildCloudsResult | null>(null);
  const cloudFieldRef = useRef<CloudField | null>(null);
  const cloudDeckRef = useRef<CloudDeckHandle | null>(null);
  const composerRef = useRef<SceneComposerHandle | null>(null);
  const glRef = useRef<ExpoWebGLRenderingContext | null>(null);
  const animFrameRef = useRef<number>(0);
  const isSceneReadyRef = useRef<boolean>(false);

  // 카메라 회전 state (ref로 관리)
  const cameraAzRef = useRef(sunAzimuth);
  const cameraElevRef = useRef(13); // 기본 FOV 60° 기준 땅이 30%를 넘지 않도록 13°로 초기화
  const fovRef = useRef(60);
  // 무한 줌 스펙트럼 (0~1: 지상 FOV 30°~120°, 1~2: 상공 고도 상승 1.6m~20km 구름 레이더, 2~3: 우주 궤도 3차원 지구본 및 노을 등시선)
  const zoomProgressRef = useRef((60 - 30) / 90);
  const pinchZoomProgressRef = useRef((60 - 30) / 90);
  const savedGroundElevRef = useRef(13);
  const [altitudeMState, setAltitudeMState] = useState(1.6);
  /**
   * ⚠ 손짓 중에는 **120 ms 에 한 번**(그리고 단계가 바뀔 때 바로)만 따라옵니다. 매 프레임
   * 따라가야 하는 것(3D 카메라·지도 위치·구 반지름·겹침 불투명도)은 ref·Animated·손잡이로
   * 리렌더 없이 갑니다(`applyZoomProgress`). 예전에는 50 ms 마다(착륙 때는 매 프레임) 이
   * 큰 컴포넌트 전체와 지도 위 선 수백 개가 다시 그려졌습니다.
   */
  const [zoomProgressState, setZoomProgressState] = useState((60 - 30) / 90);
  const [overlayMode, setOverlayMode] = useState<MapMode>('tiles');
  /**
   * 지도·구 겹을 **상승을 시작할 때** 띄우고, 지상으로 돌아온 뒤 4 초 동안 그대로 둡니다.
   * 예전에는 진행도 1.26 에서야 네이티브 지도를 띄워 그 프레임이 손짓 한가운데에서 끊겼고,
   * 지상↔상공을 오갈 때마다 지도를 새로 만들었습니다(타일도 새로 받음).
   */
  const ascended = zoomProgressState > P_FOV_END;
  useEffect(() => { onAscendedChange?.(ascended); }, [ascended, onAscendedChange]);
  /** 손으로 시선·줌을 바꾸는 중 — 고도·시야각 눈금은 이때만 보입니다(놓고 0.9초 뒤 숨김). */
  const [viewAdjusting, setViewAdjusting] = useState(false);
  const adjustTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markAdjustingRef = useRef((on: boolean) => {
    if (adjustTimerRef.current) { clearTimeout(adjustTimerRef.current); adjustTimerRef.current = null; }
    if (on) setViewAdjusting(true);
    else adjustTimerRef.current = setTimeout(() => setViewAdjusting(false), 900);
  });
  useEffect(() => () => { if (adjustTimerRef.current) clearTimeout(adjustTimerRef.current); }, []);
  const [overlayWarm, setOverlayWarm] = useState(false);
  useEffect(() => {
    if (ascended) { setOverlayWarm(true); return; }
    const t = setTimeout(() => setOverlayWarm(false), 4000);
    return () => clearTimeout(t);
  }, [ascended]);
  const overlayLive = ascended || overlayWarm;
  const [divingLocation, setDivingLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  /**
   * 지도·구에서 길게 눌러 고른 자리 — **확인을 받기 전에는 옮기지 않습니다.** 예전에는 길게
   * 누르는 즉시 관측점이 바뀌어 날씨·지형을 새로 받고 착륙했는데, 지구본을 돌리려고 손가락을
   * 잠깐 얹기만 해도 걸려 방해가 됐습니다.
   */
  const [pendingPick, setPendingPick] = useState<{ latitude: number; longitude: number; sameCell: boolean } | null>(null);
  /** 마지막으로 줌·이동이 있었던 때 — 그 직후의 길게 누르기는 손짓의 끝자락이라 무시합니다. */
  const lastViewMoveMsRef = useRef(0);
  // 지도·구의 한가운데. 관측점(home)과 다를 수 있습니다(지도·구를 끌었을 때).
  const homeRef = useRef({
    latitude: location?.coords?.latitude ?? 37.5,
    longitude: location?.coords?.longitude ?? 127.0,
  });
  const mapCenterRef = useRef({ ...homeRef.current });
  const viewSizeRef = useRef({ w: 390, h: 844 });
  const mapCanvasRef = useRef<MapCanvasHandle>(null);
  const mapGlobeRef = useRef<MapGlobeHandle>(null);
  /** 구 겹이 타일을 다 덮었는가 — 그동안은 밑의 지도를 옮기지 않습니다. */
  const globeLatchRef = useRef(false);
  /** 지금 구 형태(0 메르카토르 ~ 1 구) — 구가 처음 뜰 때 넘깁니다. */
  const globeMorphRef = useRef(0);
  /** 손을 뗀 뒤 미끄러지고 겹침 구간 밖으로 마저 가는 애니메이션(§153). */
  const settleFrameRef = useRef<number | null>(null);
  /** 두 손가락 줌의 최근 진행도 표본 — 손을 뗄 때 속도를 셉니다. */
  const pinchSamplesRef = useRef<Array<{ t: number; p: number }>>([]);
  /** §155 바람 드리프트 시계의 기준 — 고른 시각(ms)과 그 시각이 정해진 실제 시각(ms). */
  const driftAnchorRef = useRef<{ sceneMs: number; wallMs: number } | null>(null);
  const overlayFrameRef = useRef<number | null>(null);
  const lastZoomStateMsRef = useRef(0);
  const zoomStateKeyRef = useRef('');
  const glOpacityAnim = useRef(new Animated.Value(1)).current;
  const mapOpacityAnim = useRef(new Animated.Value(0)).current;
  const globeOpacityAnim = useRef(new Animated.Value(0)).current;
  const cardRadiusAnim = useRef(new Animated.Value(14)).current;
  const divingAnimFrameRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartLocRef = useRef<{ x: number; y: number } | null>(null);
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null);
  const pinchDistRef = useRef<number | null>(null);
  const pinchFovRef = useRef(60);

  // 물리 파라미터 ref
  const sunAltRef = useRef(sunAltitude);
  const sunAzRef = useRef(sunAzimuth);
  const predictionRef = useRef(prediction);
  const simRef = useRef(sim);
  const weatherRef = useRef(interpolatedWeather);
  const layersRef = useRef(layers);
  const skySettingsRef = useRef(skySettings);
  // §126.7 볼륨 하늘 — 장면·생성 중 표시·마지막 층 키(층은 바뀔 때만 다시 만듦)·실패 표시
  const volRef = useRef<VolumetricScene | null>(null);
  const volBusyRef = useRef(false);
  const volFailedRef = useRef<string | null>(null);
  const volKeyRef = useRef('');
  const volSizeRef = useRef('');
  /** §160 가장 가까운 공항 METAR(10 분마다). 오면 볼륨 장면 키를 비워 다시 만들게 합니다. */
  const metarRef = useRef<MetarObs | null>(null);
  /** 장면·시선이 바뀐 뒤 시간 누적(1/16 화소씩)이 차도록 더 그릴 프레임 수 */
  const volSettleRef = useRef(0);
  const volViewRef = useRef('');
  /** §127 첫 장면이 걸리기 전에는 볼륨 하늘을 쓰지 않습니다(날씨를 잘라 만드는 동안 예전 하늘). */
  const volHasSceneRef = useRef(false);
  const lastVolSceneRef = useRef<VolumetricSceneState | null>(null);   // §165 마지막 적용 장면(QR)
  const volFreshRef = useRef(false);   // §165 마지막 적용 장면이 한 프레임 이상 실제로 그려졌는가(적용 직후 스냅샷은 옛 장면)
  /** §129 지난 프레임에 볼륨 하늘을 깔았는가 — 바다 쌍둥이(거리·빛 판)는 그때만 그립니다(평소 구름 슬랩의 가림을 바꾸지 않게). */
  const volDrewRef = useRef(false);
  const volPendingRef = useRef(false);
  const volGovRef = useRef<ResolutionGovernor | null>(null);
  const volQualityRef = useRef('');
  const pixelRatioRef = useRef(1);
  const sceneWidthRef = useRef(SCENE_WIDTH);

  const timelineRef = useRef<SkyTimeline | null>(timeline);
  const isActiveRef = useRef(isActive);
  const isSlidingRef = useRef(isSliding);
  const trackingTargetRef = useRef(trackingTarget);
  const onSelectTrackingTargetRef = useRef(onSelectTrackingTarget);
  const targetTimeMsRef = useRef(currentTime.getTime());
  const lastTargetSyncPerfRef = useRef(performance.now());
  const lastCloudRebuildMsRef = useRef(0);   // 구름 마지막 재빌드 시각 (벽시계)
  const lastCloudSunAltRef   = useRef(-999); // 구름 재빌드 당시 태양 고도
  const lastCloudSceneMsRef  = useRef(-1e15); // 구름 재빌드 당시 **씬** 시각
  /** 구름 재빌드 당시 기상 배열. 정체성 비교로 슬라이더 변화를 잡습니다. */
  const lastCloudWeatherRef  = useRef<any[] | null>(null);
  const renderedTimeMsRef = useRef(currentTime.getTime());
  /** 슬라이더 패스트 스크럽 시 구름 재빌드 디바운스/취소용 타이머 ref */
  const cloudRebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 슬라이더 조작 중 3D 볼륨 구름 실시간 갱신 쓰로틀링 (150ms) */
  const lastSlidingVolBuildTimeRef = useRef<number>(0);
  /** 현재 걸린 볼륨 씬이 슬라이딩용 고속(S=128) 프리뷰였는지 여부 */
  const lastVolIsFastRef = useRef<boolean>(false);

  // ── 스마트 온디맨드 렌더링 & GPU/CPU 유휴 절전 컨트롤러 ──────────────────
  const animateRef = useRef<() => void>(() => {});
  const framesToRenderRef = useRef<number>(5);
  const isLoopRunningRef = useRef<boolean>(false);
  const lastRenderTsRef = useRef<number>(0);
  const lastRenderedSceneTimeMsRef = useRef<number>(0);

  /** 렌더링 요청: 화면 변화 시 루프를 깨우고 지정 프레임 수만큼 렌더링 후 자동 슬립 */
  const requestRender = useCallback((frames = 4) => {
    framesToRenderRef.current = Math.max(framesToRenderRef.current, frames);
    if (!isLoopRunningRef.current && isActiveRef.current && glRef.current) {
      isLoopRunningRef.current = true;
      animFrameRef.current = requestAnimationFrame(animateRef.current);
    }
  }, []);

  /**
   * **줌 진행도를 바꾸는 유일한 길.** 손짓 이동·놓기·끊김·착륙 애니메이션·구 손짓이 모두
   * 여기로 옵니다(예전에는 네 군데에 식이 복사돼 서로 달랐습니다). 축척·고도는
   * `zoomContinuum.ts` 가 한 줄로 풉니다 — 3D 내려다본 땅 폭 = 지도 폭 = 구 반지름.
   *
   * - 3D 카메라: 렌더 루프가 `zoomProgressRef` 를 읽습니다.
   * - 지도·실루엣·구: 프레임마다 한 번 손잡이로 옮깁니다(리렌더 없음).
   * - 겹침 불투명도·카드 모서리: Animated 값(리렌더 없음).
   * - React 상태: 단계(지도 띄움·타일/실루엣/구·넘김)가 바뀔 때 바로, 그 밖에는 120 ms 에 한 번.
   */
  const applyZoomProgress = useCallback((p: number, opts: { force?: boolean; keepCenter?: boolean } = {}) => {
    const prev = zoomProgressRef.current;
    zoomProgressRef.current = p;
    if (Math.abs(p - prev) > 1e-6) lastViewMoveMsRef.current = Date.now();
    if (p <= P_FOV_END) fovRef.current = 30 + p * 90;
    const { w, h } = viewSizeRef.current;
    const aspect = w / h;
    // 3D 가 보이는 동안 지도 한가운데는 관측점(카메라 바로 아래). 지도에서 줌인하면
    // 넘기는 점에 닿을 때 관측점으로 돌아오게 조금씩 데려옵니다.
    if (p <= P_FADE_START) mapCenterRef.current = { ...homeRef.current };
    else if (!opts.keepCenter) mapCenterRef.current = homeCenterStep(mapCenterRef.current, homeRef.current, prev, p);
    const c = mapCenterRef.current;
    // ⚠ 진행도 ↔ 축척은 **관측점 위도**로 풉니다(3D 땅 폭이 거기서 정해짐). 지도 한가운데
    //   위도로 풀면 지도를 위아래로 끈 뒤 다음 손짓에서 축척이 수십 % 튑니다.
    const lonDelta = lonDeltaForProgress(p, homeRef.current.latitude, aspect);
    // 타일 → 구 겹(§153). 둘 다 지도 폭으로 정합니다 — 겹 바꾸기(같은 메르카토르라 땅이 두 겹으로 안 번짐),
    // 그다음 형태 바꾸기(메르카토르 → 구). 문턱이 아니라 연속 값이라 히스테리시스가 필요 없습니다.
    const vec = p > P_FADE_START ? globeLayerOpacityForLonDelta(lonDelta) : 0;
    const morph = globeMorphForLonDelta(lonDelta);
    globeMorphRef.current = morph;
    globeLatchRef.current = vec >= 0.999;
    const mode: MapMode = vec <= 0 ? 'tiles' : vec < 0.5 ? 'silhouette' : 'globe';

    // 3D 뷰는 지도가 완전히 덮이기 전까지는 100% 불투명하게 선명히 유지!
    glOpacityAnim.setValue(glVisibleForProgress(p) ? 1 : 0);
    // 지도는 3D 위에 0 -> 1로 반투명하게 부드럽게 겹쳐 올라옴
    mapOpacityAnim.setValue(mapOpacityForProgress(p));
    globeOpacityAnim.setValue(vec);
    // 카드 모서리는 구 형태를 따라 둥글어집니다.
    cardRadiusAnim.setValue(14 + morph * 30);

    if (overlayFrameRef.current === null) {
      overlayFrameRef.current = requestAnimationFrame(() => {
        overlayFrameRef.current = null;
        const pp = zoomProgressRef.current;
        if (pp <= P_MAP_MOUNT) return;
        const cc = mapCenterRef.current;
        const vs = viewSizeRef.current;
        const d = lonDeltaForProgress(pp, homeRef.current.latitude, vs.w / vs.h);
        const region = { latitude: cc.latitude, longitude: cc.longitude, longitudeDelta: d };
        // 구가 덮고 있는 동안은 그 밑의 지도·실루엣을 옮기지 않습니다(안 보이는 겹을 프레임마다 그리던 몫).
        // 구에서 나오는 첫 프레임에 다시 옮깁니다. 구는 숨어 있어도 축척·한가운데를 기억만 합니다(`visible`).
        if (!globeLatchRef.current) mapCanvasRef.current?.moveTo(region, 0);
        mapGlobeRef.current?.setView({ radius: globeRadiusForDelta(cc.latitude, d, vs.w), center: cc, morph: globeMorphRef.current });
      });
    }

    const key = `${p > P_FOV_END}|${p > P_MAP_MOUNT}|${p > P_FADE_START}|${p >= P_HANDOFF}|${mode}`;
    const now = Date.now();
    if (opts.force || key !== zoomStateKeyRef.current || now - lastZoomStateMsRef.current > 120) {
      zoomStateKeyRef.current = key;
      lastZoomStateMsRef.current = now;
      setZoomProgressState(p);
      setOverlayMode(mode);
      setAltitudeMState(altitudeForProgress(p, homeRef.current.latitude, aspect));
    }
    requestRender(2);
  }, [requestRender]);

  // PanResponder 는 처음 한 번만 만들어지므로 ref 로 부릅니다.
  const applyZoomProgressRef = useRef(applyZoomProgress);
  applyZoomProgressRef.current = applyZoomProgress;

  /**
   * 손을 뗀 뒤(§153) — 손가락 속도로 조금 더 미끄러지고, 두 겹이 반쯤 겹친 구간(3D ↔ 지도, 타일 ↔ 구 겹)이면
   * 가까운 끝까지 마저 갑니다. 한 번의 감속 곡선이라 손을 뗀 순간의 속도가 이어집니다.
   * `rate` 는 진행도/초(양수 = 줌아웃).
   */
  const cancelSettle = useCallback(() => {
    if (settleFrameRef.current !== null) cancelAnimationFrame(settleFrameRef.current);
    settleFrameRef.current = null;
  }, []);
  const settleZoom = useCallback((rate: number) => {
    cancelSettle();
    const from = zoomProgressRef.current;
    const vs = viewSizeRef.current;
    const lat = homeRef.current.latitude;
    const target = settleProgress(flingProgress(from, rate), lat, vs.w / vs.h, rate);
    const duration = settleDurationMs(from, target, rate);
    if (duration <= 0) {
      applyZoomProgress(from, { force: true, keepCenter: true });
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const p = from + (target - from) * easeOutCubic(t);
      if (t < 1) {
        applyZoomProgress(p);
        settleFrameRef.current = requestAnimationFrame(step);
      } else {
        settleFrameRef.current = null;
        applyZoomProgress(target, { force: true, keepCenter: true });
        setCameraFov(fovRef.current);
      }
    };
    settleFrameRef.current = requestAnimationFrame(step);
  }, [applyZoomProgress, cancelSettle]);
  const settleZoomRef = useRef(settleZoom);
  settleZoomRef.current = settleZoom;
  const cancelSettleRef = useRef(cancelSettle);
  cancelSettleRef.current = cancelSettle;

  /**
   * 버튼으로 줌 진행도를 옮깁니다 — 손짓 없이 같은 길(`applyZoomProgress`)을 지납니다.
   * 동작 줄이기면 바로 끝값으로 갑니다.
   */
  const flyFrameRef = useRef<number | null>(null);
  const flyToProgress = useCallback((target: number, durationMs = 1100) => {
    cancelSettle();
    if (flyFrameRef.current !== null) cancelAnimationFrame(flyFrameRef.current);
    const from = zoomProgressRef.current;
    const finish = () => {
      flyFrameRef.current = null;
      applyZoomProgress(target, { force: true, keepCenter: true });
      setCameraFov(fovRef.current);
    };
    if (isReducedMotion() || Math.abs(target - from) < 1e-3) { finish(); return; }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs);
      if (t < 1) {
        applyZoomProgress(from + (target - from) * easeOutCubic(t));
        flyFrameRef.current = requestAnimationFrame(step);
      } else finish();
    };
    flyFrameRef.current = requestAnimationFrame(step);
  }, [applyZoomProgress, cancelSettle]);
  useEffect(() => () => { if (flyFrameRef.current !== null) cancelAnimationFrame(flyFrameRef.current); }, []);
  /** 지도 폭 6°(약 500 km) — 구름 레이더 고리(380 km)가 한 화면에 들어옵니다. */
  const flyToMapRef = useRef(() => {});
  flyToMapRef.current = () => {
    const vs = viewSizeRef.current;
    const target = Math.min(P_MAX, Math.max(P_HANDOFF + 0.05, progressForLonDelta(6, homeRef.current.latitude, vs.w / vs.h)));
    flyToProgress(target);
  };

  useEffect(() => () => {
    if (overlayFrameRef.current !== null) cancelAnimationFrame(overlayFrameRef.current);
    if (divingAnimFrameRef.current !== null) cancelAnimationFrame(divingAnimFrameRef.current);
    if (settleFrameRef.current !== null) cancelAnimationFrame(settleFrameRef.current);
  }, []);

  useEffect(() => {
    isActiveRef.current = isActive;
    if (isActive) {
      requestRender(5);
    } else {
      isLoopRunningRef.current = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }
    }
  }, [isActive, requestRender]);

  useEffect(() => {
    const wasSliding = isSlidingRef.current;
    isSlidingRef.current = isSliding;
    if (!isSliding && wasSliding) {
      // 슬라이더에서 손을 떼는 순간: 슬라이딩 중 돌던 미완료 비동기 작업만 취소하고
      // 대기 플래그를 정상화 (이미 같은 시간대 키가 있으면 텍스처를 불필요하게 다시 굽지 않음)
      if (volRef.current?.cancelAsync) {
        volRef.current.cancelAsync();
      }
      volPendingRef.current = false;
      lastTargetSyncPerfRef.current = performance.now();
      requestRender(5);
    }
  }, [isSliding, requestRender]);

  // 볼륨 하늘 실시간 구름 유영: 0.4 초마다 렌더를 깨워 바람 드리프트(§155)를 반영 — 1 초 간격은 한 번에 몇 px 씩 툭툭 넘어갔습니다.
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      if (volRef.current && !isSlidingRef.current) {
        requestRender(2);
      }
    }, 400);
    return () => clearInterval(timer);
  }, [isActive, requestRender]);

  // 외부(SunCamera 등)에서 3D 씬 고화질 스냅샷을 캡처할 수 있도록 핸들 노출
  //
  // ⚠ **실패하면 왜 실패했는지 남깁니다.** 예전에는 어떤 이유로 실패하든
  //   `null` 하나만 돌려줬고, 부르는 쪽(SunCamera 촬영 결과 화면)은 그걸
  //   받으면 썸네일 칸을 **통째로 안 그렸습니다**. 그래서 화면에서는 아무
  //   설명 없이 시뮬레이터 썸네일만 사라졌습니다 — 실기 보고 그대로입니다.
  //   이유를 `lastSnapshotErrorRef` 에 담아 두면 그 칸에 대신 적을 수 있습니다.
  const lastSnapshotErrorRef = useRef<string | null>(null);
  /** 스냅샷 직전에 GL 버퍼에서 직접 잰 가운데 32×32 평균 밝기. −1 = 못 쟀음. */
  const lastBufferMeanRef = useRef<number>(-1);
  useImperativeHandle(ref, () => ({
    getLastSnapshotError: () => lastSnapshotErrorRef.current,
    getLastBufferMean: () => lastBufferMeanRef.current,
    flyToMap: () => flyToMapRef.current(),
    getRenderState: () => {
      const cam = cameraRef.current;
      if (!cam) return null;
      cam.updateMatrixWorld(true);
      const fwd = new THREE.Vector3();
      cam.getWorldDirection(fwd);
      const az = ((Math.atan2(fwd.x, -fwd.z) * 180) / Math.PI + 360) % 360;
      const el = (Math.asin(Math.max(-1, Math.min(1, fwd.y))) * 180) / Math.PI;
      // 기울임: 카메라의 위쪽이 "기울임 없는 위쪽"(세계 위를 시선에 수직으로 깎은 것)에서 돈 각.
      // 천정을 똑바로 보면 그 기준이 없어 0 으로 둡니다.
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      const ref = new THREE.Vector3(0, 1, 0).addScaledVector(fwd, -fwd.y);
      let roll = 0;
      if (ref.lengthSq() > 1e-8) {
        ref.normalize();
        const right = new THREE.Vector3().crossVectors(fwd, ref);
        roll = (Math.atan2(up.dot(right), up.dot(ref)) * 180) / Math.PI;
      }
      const volPhase: VolumetricPhaseOf = volFailedRef.current ? 'failed'
        : (volHasSceneRef.current && volDrewRef.current) ? (volPendingRef.current ? 'updating' : 'running')
        : (VOLUMETRIC_SKY_ENABLED && skySettingsRef.current.volumetricSky !== false) ? 'creating' : 'off';
      return {
        view: { az, el, roll, fov: cam.fov, aspect: cam.aspect },
        slab: null,
        volPhase,
        scene: lastVolSceneRef.current,
      };
    },
    // 준비 = 실패 아님 · 예보 장면이 적용됨(lastVolSceneRef, 예보 없는 빈 장면은 아님) · 다시 만드는 중 아님 · 적용 뒤 그려졌고 시간 업스케일이 반쯤 가라앉음.
    isVolumetricReady: () => !volFailedRef.current && volHasSceneRef.current && volDrewRef.current && !volPendingRef.current
      && lastVolSceneRef.current != null && volFreshRef.current && volSettleRef.current <= 8,
    takeSnapshot: async (options = { format: 'jpeg', compress: 0.85 }) => {
      lastSnapshotErrorRef.current = null;
      // ⚠ 한 번 더 시도합니다. 카메라 촬영 직후에는 GL 표면이 잠깐 뺏길 수
      //   있어 첫 시도가 던지는 경우가 있습니다. 한 프레임 쉬고 다시 겁니다.
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 50));
        try {
          if (!glRef.current) { lastSnapshotErrorRef.current = 'GL 컨텍스트 없음'; continue; }
          if (!rendererRef.current || !sceneRef.current || !cameraRef.current) {
            lastSnapshotErrorRef.current = '3D 장면 준비 안 됨';
            continue;
          }
          // ── **컴포저로 그립니다** ────────────────────────────────────
          //
          // ⚠ 실기에서 썸네일이 **검게** 나왔습니다. 칸도 보이고 실패 사유도
          //   안 떴으니 스냅샷은 성공했고 내용만 비었다는 뜻이었습니다.
          //
          //   원인은 스냅샷 경로가 아니라 **무엇을 그렸는가** 였습니다.
          //   여기서는 `renderer.render(scene, camera)` 를 직접 불렀는데,
          //   이 장면의 객체는 전부 레이어 1~4 에 배정돼 있습니다
          //   (LAYER_SOFT_SKY 1 · LAYER_MID 2 · LAYER_SOFT_CLOUD 3 ·
          //   LAYER_FRONT 4 — 위 assignLayer 호출들). **레이어 0 에는
          //   아무것도 없습니다.** three.js 카메라의 기본 마스크는 레이어 0
          //   하나만 켜므로 그 호출은 **아무것도 안 그리고**, 남는 것은
          //   지우기색(검정)뿐입니다. 실기 화면의 검은 사각형이 그것입니다.
          //
          //   실시간 루프는 `composer.render(...)` 로 그립니다(아래 animate).
          //   스냅샷도 같은 길로 가야 같은 그림이 나옵니다 — 레이어를 나눠
          //   그리는 것도, 블룸·박명광선 후처리도 전부 그 안에 있습니다.
          const composer = composerRef.current;
          const drawOnce = () => {
            if (composer) {
              composer.render(rendererRef.current as unknown as THREE.WebGLRenderer,
                              sceneRef.current!, cameraRef.current!);
            } else {
              // 컴포저가 아직 없으면(첫 프레임 전) 최소한 레이어는 다 켭니다.
              cameraRef.current!.layers.enableAll();
              rendererRef.current!.setRenderTarget(null);
              rendererRef.current!.render(sceneRef.current!, cameraRef.current!);
            }
          };
          // ⚠ 두 번 그립니다. takeSnapshotAsync 가 앞버퍼를 읽는지 뒷버퍼를
          //   읽는지는 expo-gl 구현에 달렸고 기기 없이는 못 정합니다. 한 번
          //   그려 넘기고 한 번 더 그리면 **어느 쪽을 읽든** 같은 최신
          //   프레임입니다. 한 컷 캡처라 프레임 하나가 더 드는 것은 문제가
          //   안 됩니다.
          drawOnce();
          glRef.current.endFrameEXP();
          drawOnce();
          glRef.current.flush();

          // ── 자가 진단 ───────────────────────────────────────────────
          //
          // ⚠ 위 손질이 맞는지는 기기에서만 압니다. 그래서 **GL 버퍼를 직접
          //   찍어** 두 후보를 가릅니다. 여기서 잰 밝기가 0 이면 그린 것
          //   자체가 검은 것이고(장면·카메라 문제), 0 이 아닌데 저장된
          //   그림이 검으면 스냅샷 경로가 잃는 것입니다.
          //   전체를 읽으면 비싸므로 화면 가운데 32×32 만 봅니다.
          let bufMean = -1;
          try {
            const g = glRef.current;
            const w = g.drawingBufferWidth, h = g.drawingBufferHeight;
            const n = 32;
            const px = new Uint8Array(n * n * 4);
            g.readPixels(Math.max(0, (w >> 1) - (n >> 1)), Math.max(0, (h >> 1) - (n >> 1)),
                         n, n, g.RGBA, g.UNSIGNED_BYTE, px);
            let sum = 0;
            for (let i = 0; i < n * n; i++) {
              sum += 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
            }
            bufMean = sum / (n * n);
          } catch (_) { /* readPixels 를 못 해도 스냅샷은 계속합니다 */ }
          lastBufferMeanRef.current = bufMean;

          const snapshot = await GLView.takeSnapshotAsync(glRef.current, {
            format: options.format ?? 'jpeg',
            compress: options.compress ?? 0.85,
          });
          const uriStr = snapshot
            ? (typeof snapshot.uri === 'string' ? snapshot.uri : snapshot.localUri || '')
            : '';
          if (uriStr) return uriStr;
          lastSnapshotErrorRef.current = '스냅샷이 빈 주소를 돌려줌';
        } catch (e) {
          lastSnapshotErrorRef.current = e instanceof Error ? e.message : String(e);
          console.warn(`[SkyScene3D] takeSnapshot failed (시도 ${attempt + 1}/2):`, e);
        }
      }
      return null;
    },
  }), []);

  // ── 성능 캐시 ref ──────────────────────────────────────────────────────────
  /** makeAtmosphereParams 결과 캐시 (2분 간격) */
  const cachedAtmosphereRef = useRef<ReturnType<typeof makeAtmosphereParams> | null>(null);
  const cachedAtmosphereMsRef = useRef(0);
  /** computeEquToHorizon 마지막 갱신 시각 (30초 간격) */
  const cachedEquToHorizonMsRef = useRef(0);
  /** buildPlanetPoints 결과 캐시 (30초 간격) */
  const cachedPlanetPointsRef = useRef<ReturnType<typeof buildPlanetPoints> | null>(null);
  const cachedPlanetPointsMsRef = useRef(0);
  /** 달빛이 깎은 실효 한계등급 캐시 (30초 간격) */
  const cachedMoonMagLimitRef = useRef(6.5);
  const cachedMoonMagMsRef = useRef(0);
  /** updateCelestialPaths 마지막 갱신 시각 (30초 간격) */
  const sunDiscRadiusDegRef = useRef(0.267);
  const lastCelestialPathsMsRef = useRef(0);
  /** getSunPath/getMoonPath 날짜 키 캐시 (같은 날이면 재계산 생략) */
  const cachedSunPathDateRef = useRef('');
  /** setCelestialLabels 마지막 호출 시각 (4fps = 250ms 스로틀) */
  const lastLabelUpdateMsRef = useRef(0);

  /** skyRadiance 연산(24회 루프) 캐시: 태양 각도가 0.04° 이상 변하지 않으면 재사용 */
  const lastSkyMeanSunAltRef = useRef<number>(-999);
  const lastSkyMeanSunAzRef = useRef<number>(-999);
  const lastSkyMeanAtmosRef = useRef<any>(null);
  const cachedSkyMeanRGBRef = useRef<{ r: number; g: number; b: number }>({ r: 0.2, g: 0.3, b: 0.5 });
  /**
   * 지평선 부근 하늘빛 — DEM 지형·해수면의 공기원근(먼 지형이 이 색으로
   * 수렴)과 하늘 되비침(수평선 쪽 물의 바탕색)이 씁니다. `cachedSkyMeanRGB`
   * 는 반구 평균이라 지평선보다 밝습니다(천정 쪽 가중), 그래서 따로 둡니다.
   */
  const cachedHorizonRGBRef = useRef<{ r: number; g: number; b: number }>({ r: 0.05, g: 0.06, b: 0.09 });

  useEffect(() => { sceneWidthRef.current = SCENE_WIDTH; requestRender(3); }, [SCENE_WIDTH, requestRender]);
  useEffect(() => { skySettingsRef.current = skySettings; requestRender(3); }, [skySettings, requestRender]);
  useEffect(() => { sunAltRef.current = sunAltitude; requestRender(3); }, [sunAltitude, requestRender]);
  useEffect(() => { sunAzRef.current = sunAzimuth; requestRender(3); }, [sunAzimuth, requestRender]);
  useEffect(() => { predictionRef.current = prediction; requestRender(3); }, [prediction, requestRender]);
  useEffect(() => { simRef.current = sim; requestRender(3); }, [sim, requestRender]);
  useEffect(() => { weatherRef.current = interpolatedWeather; requestRender(3); }, [interpolatedWeather, requestRender]);
  // §160 METAR — 자리가 바뀌면 바로, 그 뒤 10 분마다. 실패하면 null(예보 그대로). 볼륨 하늘이 꺼져 있으면 받지 않습니다.
  const metarLat = location?.coords?.latitude, metarLon = location?.coords?.longitude;
  useEffect(() => {
    if (!VOLUMETRIC_SKY_ENABLED || metarLat == null || metarLon == null) return;
    const ctl = new AbortController();
    let alive = true;
    const pull = () => fetchNearestMetar(metarLat, metarLon, ctl.signal).then(m => {
      if (!alive) return;
      const before = metarRef.current;
      metarRef.current = m;
      if ((before?.icao ?? '') !== (m?.icao ?? '') || (before?.timeMs ?? 0) !== (m?.timeMs ?? 0)) { volKeyRef.current = ''; requestRender(3); }
    }).catch(() => {});
    pull();
    const id = setInterval(pull, 10 * 60_000);
    return () => { alive = false; ctl.abort(); clearInterval(id); };
  }, [metarLat, metarLon, requestRender]);
  useEffect(() => { layersRef.current = layers; requestRender(3); }, [layers, requestRender]);
  useEffect(() => { timelineRef.current = timeline; requestRender(3); }, [timeline, requestRender]);

  // 운형 문턱·덱 밀폐·빌보드 수는 uniform이 아니라 배치 로직에 들어갑니다.
  // 바뀌면 다음 프레임에 다시 배치하도록 재빌드 조건을 깨워 둡니다.
  useEffect(() => subscribeTuning(() => {
    lastCloudSceneMsRef.current = -1e15;
    lastCloudSunAltRef.current = -999;
    requestRender(4);
  }), [requestRender]);
  useEffect(() => { trackingTargetRef.current = trackingTarget; if (trackingTarget) requestRender(15); }, [trackingTarget, requestRender]);
  useEffect(() => { onSelectTrackingTargetRef.current = onSelectTrackingTarget; }, [onSelectTrackingTarget]);
  useEffect(() => {
    targetTimeMsRef.current = currentTime.getTime();
    lastTargetSyncPerfRef.current = performance.now();
    requestRender(4);
  }, [currentTime, requestRender]);

  const cameraAzimuthPropRef = useRef(cameraAzimuthProp);
  const cameraElevationPropRef = useRef(cameraElevationProp);
  const fovPropRef = useRef(fovProp);

  useEffect(() => {
    cameraAzimuthPropRef.current = cameraAzimuthProp;
    if (cameraAzimuthProp !== undefined) {
      setCameraAzimuth(cameraAzimuthProp);
      requestRender(3);
    }
  }, [cameraAzimuthProp, requestRender]);
  useEffect(() => {
    cameraElevationPropRef.current = cameraElevationProp;
    if (cameraElevationProp !== undefined) {
      setCameraElevation(cameraElevationProp);
      requestRender(3);
    }
  }, [cameraElevationProp, requestRender]);
  useEffect(() => {
    fovPropRef.current = fovProp;
    if (fovProp !== undefined) {
      setCameraFov(fovProp);
      requestRender(3);
    }
  }, [fovProp, requestRender]);

  const teleportTarget = useCelestialStore((s) => s.teleportTarget);
  const language = useCelestialStore((s) => s.language);
  useEffect(() => {
    if (!teleportTarget) return;
    if (teleportTarget.cameraAz !== undefined) {
      cameraAzRef.current = (teleportTarget.cameraAz % 360 + 360) % 360;
      setCameraAzimuth(cameraAzRef.current);
    }
    if (teleportTarget.cameraElev !== undefined) {
      cameraElevRef.current = Math.max(-45, Math.min(85, teleportTarget.cameraElev));
      setCameraElevation(cameraElevRef.current);
    }
    if (teleportTarget.fov !== undefined) {
      fovRef.current = Math.max(20, Math.min(120, teleportTarget.fov));
      if (cameraRef.current) {
        cameraRef.current.fov = fovRef.current;
        cameraRef.current.updateProjectionMatrix();
      }
      setCameraFov(fovRef.current);
    }
    trackingTargetRef.current = null;
    if (onSelectTrackingTargetRef.current) {
      onSelectTrackingTargetRef.current(null);
    }
    requestRender(10);
  }, [teleportTarget?.nonce, requestRender]);

  /**
   * 롱프레스 위치 이동 & 다이빙 착륙 애니메이션 (우주/상공 -> 지상 1.6m 하늘).
   *
   * 관측점(home)을 먼저 목표로 바꿔 두면, 진행도가 줄어드는 동안 `applyZoomProgress` 가
   * 지도·구 한가운데를 목표로 데려와 **넘기는 점에서 정확히 목표 바로 위**가 됩니다.
   * 매 프레임 React 상태를 바꾸지 않습니다(예전 끊김의 큰 몫).
   */
  const startDivingLanding = useCallback((targetLat: number, targetLon: number) => {
    // 진행도 ↔ 축척이 관측점 위도에 묶여 있으므로, 관측점을 바꾸기 전에 지금 축척을
    // 새 위도의 진행도로 옮겨 둡니다(안 하면 서울 → 오슬로 착륙 첫 프레임에 지도가 튐).
    const aspect0 = viewSizeRef.current.w / viewSizeRef.current.h;
    const p0 = zoomProgressRef.current;
    if (p0 > P_HANDOFF) {
      const d0 = lonDeltaForProgress(p0, homeRef.current.latitude, aspect0);
      zoomProgressRef.current = progressForLonDelta(d0, targetLat, aspect0);
    }
    // 1. 전역 위치 갱신 (일출·일몰 시간, 날씨, 지형 자동 재계산)
    homeRef.current = { latitude: targetLat, longitude: targetLon };
    setDivingLocation({ latitude: targetLat, longitude: targetLon });
    useCelestialStore.getState().setLocation({
      coords: {
        latitude: targetLat,
        longitude: targetLon,
        altitude: 0,
        accuracy: 0,
        altitudeAccuracy: 0,
        heading: 0,
        speed: 0,
      },
      timestamp: Date.now(),
    });

    // 2. 부드러운 다이빙 착륙 애니메이션 — 지상 시선은 처음부터 저장해 둔 값으로
    //    (내려오며 서서히 들림. 예전에는 끝 프레임에 한 번에 튀었습니다).
    if (divingAnimFrameRef.current) cancelAnimationFrame(divingAnimFrameRef.current);
    if (settleFrameRef.current !== null) { cancelAnimationFrame(settleFrameRef.current); settleFrameRef.current = null; }
    cameraElevRef.current = savedGroundElevRef.current;
    const startProgress = zoomProgressRef.current;
    const targetProgress = (60 - 30) / 90; // 지상 1인칭 관측 FOV 60° (0.333)
    const startTime = performance.now();
    // 멀리서 내려올수록 조금 더 길게(지구본 3.0 → 1.5 s, 상공 1.3 → 0.8 s).
    const duration = 600 + 340 * Math.max(0, startProgress - targetProgress);

    const animateDive = (nowTime: number) => {
      const t = Math.min(1.0, (nowTime - startTime) / duration);
      // 부드러운 Ease-In-Out 3차 곡선 — 출발·착륙 모두 덜컹이지 않게
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      applyZoomProgress(startProgress + (targetProgress - startProgress) * ease);
      if (t < 1.0) {
        divingAnimFrameRef.current = requestAnimationFrame(animateDive);
      } else {
        divingAnimFrameRef.current = null;
        applyZoomProgress(targetProgress, { force: true });
        setDivingLocation(null);
        setCameraFov(60);
        setCameraElevation(cameraElevRef.current);
        requestRender(5);
      }
    };

    divingAnimFrameRef.current = requestAnimationFrame(animateDive);
  }, [requestRender, applyZoomProgress]);

  /**
   * 평면 지도·지구본용 해·달 — 직하점, 일출·일몰선, 달 위상.
   *
   * ⚠ 예전에는 상승을 시작한 순간의 시각으로 한 번만 세어, 지도·구에 있는 동안 시간 슬라이더를 밀어도
   *   해 자리·밤 그늘이 그대로였고(달은 아예 없었습니다) 다음 상승 때야 바뀌었습니다. 지금은 **고른 시각**
   *   (`currentTime`)을 분 단위로 따라갑니다 — 슬라이더를 미는 동안 1 분보다 잘게 다시 세지 않습니다.
   */
  const overlayMinute = Math.floor(currentTime.getTime() / 60000);
  const globeCelestialData = useMemo(() => {
    if (!overlayLive) return null;
    const date = new Date(overlayMinute * 60000);
    return {
      date,
      subsolar: getSubsolarPoint(date),
      terminator: getTerminatorSegments(date),
      sublunar: getSublunarPoint(date),
      moonFraction: getMoonPhase(date).fraction,
    };
  }, [overlayLive, overlayMinute]);

  // ── 지도 및 지구본용 등시선(Isochrone) 24시간 일출·일몰 격자선 — 고른 날짜(관측지 현지)가 바뀔 때만 ──
  const overlayTzMs = (useCelestialStore.getState().timezoneOffsetHours ?? 0) * 3600000;
  const overlayDayKey = new Date(overlayMinute * 60000 + overlayTzMs).toISOString().slice(0, 10);
  const allTerminators = useMemo(() => {
    if (!overlayLive) return [];
    const list = [];
    const base = new Date(new Date(overlayDayKey).getTime() - overlayTzMs);
    const step = 60; // 1시간 간격 등시선

    for (let min = 0; min < 1440; min += step) {
      const time = new Date(base.getTime() + min * 60 * 1000);
      const segments = getTerminatorSegments(time);
      list.push({
        time,
        sunrise: segments.sunrise,
        sunset: segments.sunset,
      });
    }
    return list;
  }, [overlayLive, overlayDayKey, overlayTzMs]);

  // ── 지구 밤 영역(Night shadow) 2D/3D 폴리곤 ─────────────────────────────────
  const nightPolygonCoords = useMemo(() => {
    if (!globeCelestialData) return [];
    try {
      const circleGeoJSON = d3.geoCircle().center([globeCelestialData.subsolar.longitude, globeCelestialData.subsolar.latitude]).radius(90)();
      if (!circleGeoJSON || !circleGeoJSON.coordinates) return [];
      const segments: Array<Array<{ latitude: number; longitude: number }>> = [];
      if (circleGeoJSON.type === 'Polygon') {
        circleGeoJSON.coordinates.forEach((ring: any) => {
          const seg = ring.map((pt: [number, number]) => ({ longitude: pt[0], latitude: pt[1] }));
          if (seg.length > 0) segments.push(seg);
        });
      } else if (circleGeoJSON.type === 'MultiPolygon') {
        circleGeoJSON.coordinates.forEach((polygon: any) => {
          polygon.forEach((ring: any) => {
            const seg = ring.map((pt: [number, number]) => ({ longitude: pt[0], latitude: pt[1] }));
            if (seg.length > 0) segments.push(seg);
          });
        });
      }
      return segments;
    } catch (e) {
      return [];
    }
  }, [globeCelestialData?.subsolar]);

  // ── 시뮬레이션 구름 탑다운 뷰 (하늘 시뮬레이션의 구름을 지도와 지구본 위에 투영) ───
  const [cloudRing, setCloudRing] = useState<CloudPathData[] | null>(null);
  const cloudRingFetchRef = useRef<{ lat: number; lon: number; ms: number } | null>(null);
  useEffect(() => {
    if (!isActive || zoomProgressState <= P_FOV_END) return;
    const cLat = location?.coords?.latitude ?? 37.5;
    const cLon = location?.coords?.longitude ?? 127.0;
    // 줌을 오르내릴 때마다 다시 받지 않습니다 — 같은 날씨 칸(0.02°)에서 10 분 안이면 그대로.
    const last = cloudRingFetchRef.current;
    if (last && sameBucket(last.lat, last.lon, cLat, cLon) && Date.now() - last.ms < 10 * 60 * 1000) return;
    let alive = true;
    fetchDayWeatherRing(cLat, cLon, new Date())
      .then((r) => {
        if (!alive) return;
        cloudRingFetchRef.current = { lat: cLat, lon: cLon, ms: Date.now() };
        setCloudRing(r);
      })
      .catch((err) => console.warn('지도 구름 탑다운 링 수신 실패:', err));
    return () => { alive = false; };
  }, [isActive, zoomProgressState > P_FOV_END]);

  const topView = useCloudTopView(cloudRing, renderedTimeMsRef.current || Date.now(), zoomProgressState > P_FOV_END);

  const observerWeather = useCallback(() => {
    const w = weatherRef.current;
    return w && w.length > 0 ? w[0] : undefined;
  }, []);

  /**
   * 층별 바람. 관측점 기압면 실측(850/600/250 hPa)이 있으면 그것, 없으면
   * 대용값입니다 — 판단은 `resolveLayerWinds` 한 곳에서만 합니다.
   *
   * ⚠ 렌더 루프가 **매 프레임** 부릅니다. `resolveLayerWinds` 는 층마다
   * 객체를 새로 만드니 그대로 두면 60fps × 4개가 쓰레기로 쌓입니다.
   * 관측점 기상 객체가 바뀔 때만 다시 풀고 나머지는 캐시를 돌려줍니다.
   */
  const windCacheRef = useRef<{ src: unknown; winds: LayerWinds } | null>(null);
  const layerWindsNow = useCallback(() => {
    const obs = observerWeather();
    const c = windCacheRef.current;
    if (c && c.src === obs) return c.winds;
    const winds = resolveLayerWinds(obs).winds;
    windCacheRef.current = { src: obs, winds };
    return winds;
  }, [observerWeather]);

  /**
   * 덱이 쓸 층 대표 운형의 광학 — 조각 기하와 광학두께가 **같은 운형**에서
   * 나와야 합니다. 갈라지면 "권운처럼 얇은데 층적운처럼 큰 조각"이 나옵니다.
   */
  const opticsForLayer = useCallback((layer: 'low' | 'mid' | 'high', obs: any) => {
    const name = representativePresetForObserver(layer, obs);
    const o = PRESET_OPTICS[name] ?? PRESET_OPTICS.Cumulus;
    // 얇은 중층은 얇게(`cloudProfile.layerTauScale`) — 그림자도 화면의 구름과 같은 두께로.
    const k = layerTauScale(layer, obs);
    return k === 1 ? o : { ...o, tau: o.tau * k };
  }, []);

  /**
   * 화면 픽셀 하나의 각크기 (rad). 덱의 밉 필터 보정이 이걸로 축소율을
   * 해석적으로 구합니다 — 미분(dFdx)을 쓰지 않아도 됩니다.
   */
  const pixelAngleRad = useCallback(() => {
    const h = Math.max(1, glRef.current?.drawingBufferHeight ?? 1000);
    return (fovRef.current * Math.PI) / 180 / h;
  }, []);

  const getTouchDist = (touches: any[]) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // 나침반 UI용 화각 업데이트: 드래그 중 React 리렌더 방지
  const lastAzUpdateMsRef = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => cameraAzimuthPropRef.current === undefined,
      onMoveShouldSetPanResponder: () => cameraAzimuthPropRef.current === undefined,
      onStartShouldSetPanResponderCapture: (evt) => evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponderCapture: (evt) => evt.nativeEvent.touches.length >= 2,
      /**
       * 씬을 잡은 동안에는 아무에게도 responder를 넘기지 않습니다.
       *
       * Why: `isGestureBlocked`는 **권고**입니다 — `TabNavigator`가 자발적으로
       * 확인해 줄 때만 효과가 있습니다. 반면 RN 제스처 시스템이 실제로 강제하는
       * 것은 이 콜백입니다. 부모가 responder를 원하면 시스템이 현재 responder에게
       * `onPanResponderTerminationRequest`를 묻고, **기본값이 true라서 그냥
       * 빼앗깁니다.**
       *
       * 증상: 가로로 끌면 12px까지만 돌아가고 멈춥니다 (TabNavigator의 스와이프
       * 임계값이 12px). 세로는 `|dx| > |dy|` 조건에 걸려 빼앗기지 않으므로
       * 멀쩡히 동작합니다 — "위아래로만 움직인다"가 정확히 이 모양입니다.
       */
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        // 드래그 시작: TabNavigator가 수평 스와이프를 가로채지 않도록 차단
        useCelestialStore.getState().setGestureBlocked(true);
        markAdjustingRef.current(true);
        requestRender(4);
        // 미끄러지던 줌은 손을 대는 자리에서 멈추고 이어 받습니다.
        cancelSettleRef.current();
        pinchSamplesRef.current = [];
        // 드래그 시 자동 천체 트래킹 해제 -> 자유 조작 모드로 전환
        if (trackingTargetRef.current && onSelectTrackingTargetRef.current) {
          onSelectTrackingTargetRef.current(null);
        }
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
          touchStartLocRef.current = null;
          pinchDistRef.current = getTouchDist(touches);
          pinchFovRef.current = fovRef.current;
          pinchZoomProgressRef.current = zoomProgressRef.current;
          setPendingPick(null);
        } else {
          lastTouchRef.current = { x: touches[0].pageX, y: touches[0].pageY };
          touchStartLocRef.current = { x: touches[0].pageX, y: touches[0].pageY };
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
        }
      },
      onPanResponderMove: (evt) => {
        requestRender(2);
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
          touchStartLocRef.current = null;
          if (pinchDistRef.current === null) {
            pinchDistRef.current = getTouchDist(touches);
            pinchFovRef.current = fovRef.current;
            pinchZoomProgressRef.current = zoomProgressRef.current;
            pinchSamplesRef.current = [];
            return;
          }
          const dist = getTouchDist(touches);
          if (dist > 0) {
            // ratio > 1: 두 손가락 모으기 (줌아웃 / 광각 -> 상공 상승 -> 우주 궤도 지구본)
            // ratio < 1: 두 손가락 벌리기 (줌인 / 지구본 -> 상공 -> 지상 착륙)
            if (divingAnimFrameRef.current) {
              // 착륙 중에 손을 대면 애니메이션을 멈추고 지금 자리에서 이어 받습니다.
              cancelAnimationFrame(divingAnimFrameRef.current);
              divingAnimFrameRef.current = null;
              setDivingLocation(null);
              pinchDistRef.current = dist;
              pinchZoomProgressRef.current = zoomProgressRef.current;
            }
            applyZoomProgressRef.current(progressFromPinch(pinchZoomProgressRef.current, pinchDistRef.current / dist));
            const samples = pinchSamplesRef.current;
            const tNow = Date.now();
            samples.push({ t: tNow, p: zoomProgressRef.current });
            while (samples.length > 2 && tNow - samples[0].t > 100) samples.shift();
            const nowZoom = Date.now();
            if (nowZoom - lastAzUpdateMsRef.current > 120 && zoomProgressRef.current <= P_FOV_END) {
              lastAzUpdateMsRef.current = nowZoom;
              setCameraFov(fovRef.current);
            }
          }
        } else {
          if (touchStartLocRef.current) {
            const dx = touches[0].pageX - (lastTouchRef.current?.x ?? touches[0].pageX);
            const dy = touches[0].pageY - (lastTouchRef.current?.y ?? touches[0].pageY);
            if (Math.hypot(dx, dy) > 10) {
              if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
              }
              touchStartLocRef.current = null;
            }
          }
          if (lastTouchRef.current && zoomProgressRef.current < P_FADE_START) {
            const dx = touches[0].pageX - lastTouchRef.current.x;
            const dy = touches[0].pageY - lastTouchRef.current.y;
            const nextAz = (cameraAzRef.current - dx * DRAG_SENSITIVITY + 360) % 360;
            cameraAzRef.current = nextAz;
            // 지상 모드에서만 상하 시선 조작 허용 (상공 레이더 모드에서는 직하향 탑다운 안정 유지)
            if (zoomProgressRef.current <= P_FOV_END) {
              const minElev = -45;
              cameraElevRef.current = Math.max(minElev, Math.min(85, cameraElevRef.current + dy * DRAG_SENSITIVITY));
              savedGroundElevRef.current = cameraElevRef.current;
            }
          }
          lastTouchRef.current = { x: touches[0].pageX, y: touches[0].pageY };
          pinchDistRef.current = null;
          // 뷰파인더 눈금자 UI는 80ms 스로틀 — 매 터치 이벤트마다 React 리렌더 방지
          const nowAz = Date.now();
          if (nowAz - lastAzUpdateMsRef.current > 80) {
            lastAzUpdateMsRef.current = nowAz;
            setCameraAzimuth(cameraAzRef.current);
            setCameraElevation(cameraElevRef.current);
          }
        }
      },
      onPanResponderRelease: () => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        touchStartLocRef.current = null;
        lastTouchRef.current = null;
        pinchDistRef.current = null;
        setCameraAzimuth(cameraAzRef.current);
        setCameraElevation(cameraElevRef.current);
        setCameraFov(fovRef.current);
        // 놓기·끊김 모두 같은 식(예전 끊김 처리는 고도 식과 단계 문턱이 달랐습니다).
        // 손가락 속도로 조금 더 가고, 겹침 구간이면 끝까지 마저 갑니다(§153).
        settleZoomRef.current(pinchRateFromSamples(pinchSamplesRef.current));
        pinchSamplesRef.current = [];
        requestRender(5);
        // 드래그 종료: TabNavigator 스와이프 다시 허용
        useCelestialStore.getState().setGestureBlocked(false);
        markAdjustingRef.current(false);
      },
      onPanResponderTerminate: () => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        touchStartLocRef.current = null;
        lastTouchRef.current = null;
        pinchDistRef.current = null;
        setCameraAzimuth(cameraAzRef.current);
        setCameraElevation(cameraElevRef.current);
        setCameraFov(fovRef.current);
        // 빼앗겼을 때는 미끄러지지 않고, 겹침 구간이면 끝으로만 갑니다.
        pinchSamplesRef.current = [];
        settleZoomRef.current(0);
        requestRender(3);
        useCelestialStore.getState().setGestureBlocked(false);
        markAdjustingRef.current(false);
      },
    })
  ).current;

  // GLView 컨텍스트 초기화
  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    // GL 컨텍스트를 **다시** 받는 경우(앱을 내렸다 올렸을 때 등): 옛 렌더러의 DEM 패치는
    // 죽은 컨텍스트의 렌더 타깃이라 새 씬에서는 빈 높이장입니다. 버리고 다시 받습니다.
    // 예전에는 "이미 받은 자리" 로 기억돼 새 지형 메시가 끝내 숨은 채였습니다(§100).
    if (rendererRef.current) clearDemCache(rendererRef.current);
    demLoadedKeyRef.current = null;
    demLoadingKeyRef.current = null;
    glRef.current = gl;

    const renderer = new Renderer({ gl });
    renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
    renderer.setClearColor(0x000000, 1);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      fovRef.current,
      gl.drawingBufferWidth / gl.drawingBufferHeight,
      0.1,
      1000
    );
    // 지면 위 160cm(1.6 유닛) 사람 눈높이 시점
    camera.position.set(0, 1.6, 0);
    cameraRef.current = camera;

    // 1. Skydome (물리 대기 산란 셰이더)
    const skydome = createSkydome();
    scene.add(skydome.mesh);
    assignLayer(skydome.mesh, LAYER_SOFT_SKY);
    skydomeRef.current = skydome;

    // 2a. Ground Plane (3D 대지 원반) — 지금은 근거리(0~3km)의 **대비책**입니다.
    // DEM 이 없거나 아직 못 받았을 때, 그리고 3km 밖에서 계속 이 자리를
    // 채웁니다. 아래 2a′ 가 그 위에 실제 지형을 얹습니다.
    const ground = createGroundPlane();
    scene.add(ground);
    assignLayer(ground, LAYER_MID);
    groundRef.current = ground;

    // 2a′. DEM 높이장 근거리 지형 · 해수면 (docs/COASTLINE_PLAN.md).
    //
    // ⚠ **원반보다 나중에** 그립니다 (−0.48 / −0.47 > 원반 −0.5).
    //
    // 처음엔 반대로 짰습니다 — 원반보다 **먼저**(−0.6/−0.55) 두고 "깊이로
    // 겨루니 있는 곳에서는 새 메시가 이긴다"고 적었습니다. 틀렸습니다.
    // 원반은 눈 아래 0.5 에 놓인 **평평한 판**이라, 내려다보는 각 θ 에서
    // 깊이가 `0.5/sin θ` 입니다 — θ=1° 에서 29, θ=7° 에서 4.1. 새 지형과
    // 해수면은 반지름 120~470 의 각도 돔 위에 있으니 **거의 언제나 원반이
    // 더 가깝습니다.** 원반은 depthWrite:false 라 깊이를 안 쓰지만
    // depthTest:true 로 이겨서 **색을 덮어씁니다.**
    //
    // 그래서 실기에서 새 지형이 거의 안 보였습니다: 수평선 바로 아래
    // 얇은 띠(polygonOffset 이 스치는 각에서 크게 밀어 주는 자리)만 남고
    // 나머지는 평평한 원반이었습니다. 사용자가 "내가 선 자리 둘레 땅이
    // 전부 해발 0 처럼 평평하고 물이 고여 있다"고 본 것이 이것입니다.
    // 하네스로 재 보니 원반을 빼는 것만으로 보이는 바다가 675 → 5,307화소
    // (마니산 정상에서는 1,328 → 14,740화소, 띠 0.31° → 8.58°)였습니다.
    //
    // 고침은 순서 하나입니다. 원반이 **먼저** 배경을 칠하고, 새 메시가 그
    // 위에 그립니다. 새 메시가 없거나 버리는 자리(뭍의 물, 3km 밖)에는
    // 원반이 그대로 남아 이어받습니다. 하늘 천체(은하수 −0.6, 해·달
    // −0.55, 별 −0.5)와 원반의 앞뒤는 **건드리지 않습니다** — 그걸 뒤집으면
    // 지평선 아래로 진 해가 땅 위에 뜹니다.
    // ⚠ **격자는 하나입니다** (구조 개편 ②). 예전에는 근거리(0.6m~3km, 줌 13)와
    //   먼 지형(3km~55km, 줌 9) 둘이었고 3km 에서 딱 맞닿았습니다 — 서로 다른
    //   자료로 그려진 하드 이음매였습니다. 이제 한 메시가 발밑부터 55km 까지
    //   맡고, 촘촘한 패치가 보장하는 반지름의 30% 지점부터 가장자리까지
    //   부드럽게 성긴 자료로 넘깁니다.
    //
    //   섞는 폭 0.30 은 훑어서 골랐습니다. 좁히면 나빠집니다 — 섞는 구간의
    //   가짜 기울기가 w'(r)·Δh 인데 두 자료가 10.9m 어긋나므로, 폭이 좁으면
    //   그 어긋남이 한 자리에 몰립니다(0.75 에서 이음매 0.84 → 1.35).
    //
    //   ⚠ 이음매가 **좋아지지는 않습니다** — 두 격자와 비슷합니다(평균 0.838
    //     대 0.818). 얻는 것은 메시가 하나가 되는 것입니다: 자료 경계가
    //     구조적으로 사라지고 드로우 콜이 하나 줄고, 실루엣 정확도는 동률
    //     입니다(절대중앙 0.0872). verify-unified-field.js 참고.
    const terrainField = createTerrainField({
      eyeHeightM: 1.6,
      farM: FAR_FIELD_FAR_M,
      rings: FIELD_RINGS + FAR_FIELD_RINGS,
    });
    terrainField.mesh.renderOrder = -0.48;
    // DEM 이 오기 전엔 발밑 고도를 모르니 uObsElevM 대비책(0m)으로
    // 평평하게 그립니다 — 그 근사가 화면에 잠깐이라도 비치지 않도록,
    // 패치가 실제로 들어올 때까지는 아예 숨겨 둡니다(아래 DEM 요청
    // 이펙트가 켭니다). 그동안은 원반이 그 자리를 이어받습니다.
    terrainField.mesh.visible = false;
    scene.add(terrainField.mesh);
    assignLayer(terrainField.mesh, LAYER_MID);
    // §117 — 지형 거리 판의 쌍둥이(합성기가 구름 해상도로 따로 그림). 보임은 격자를 따라갑니다.
    terrainField.distMesh.visible = false;
    scene.add(terrainField.distMesh);
    assignLayer(terrainField.distMesh, LAYER_TERRAIN_DIST);
    // §129 — 지형 빛 판의 쌍둥이(볼륨 하늘일 때만 합성기가 그림).
    terrainField.litMesh.visible = false;
    scene.add(terrainField.litMesh);
    assignLayer(terrainField.litMesh, LAYER_TERRAIN_LIT);
    terrainFieldRef.current = terrainField;

    const seaPlane = createSeaPlane({ eyeHeightM: 1.6 });
    seaPlane.mesh.renderOrder = -0.47;
    seaPlane.mesh.visible = false;
    scene.add(seaPlane.mesh);
    assignLayer(seaPlane.mesh, LAYER_MID);
    // §129 — 바다도 거리 판(바다 표시)·빛 판에 쌍둥이를 둡니다(볼륨 하늘이 되비침을 칠함).
    scene.add(seaPlane.distMesh);
    assignLayer(seaPlane.distMesh, LAYER_TERRAIN_DIST);
    scene.add(seaPlane.litMesh);
    assignLayer(seaPlane.litMesh, LAYER_TERRAIN_LIT);
    seaPlaneRef.current = seaPlane;
    // 하네스 전용(tools/web-repro) — 지형·해수면 손잡이를 열어 한쪽만 끄거나 균일변수를 바꿔 원인을 가릅니다. 기기에서는 정의되지 않습니다.
    if ((globalThis as unknown as { __volCreateOpts?: unknown }).__volCreateOpts) (globalThis as unknown as Record<string, unknown>).__skyDebug = { terrainField: terrainFieldRef.current, seaPlane };

    // 2b. Compass Ring & Direction Markers (3D 지평선 방위 마커)
    const compassGroup = createCompassGroup();
    scene.add(compassGroup);
    assignLayer(compassGroup, LAYER_MID);
    compassGroupRef.current = compassGroup;

    // 2c. 거리대별 능선.
    //
    // 예전에는 `createTerrainRing(panoramicAngles)` 하나였습니다. 그 배열은
    // 5·15·40km 지형각의 **최댓값**이라 "가까운 언덕 뒤에 먼 산"이 사라지고,
    // 게다가 재질이 FrontSide여서 안쪽에서 보면 통째로 컬링돼 **한 번도
    // 화면에 안 나왔습니다** (docs/GROUND_PLAN.md 3단계).
    const bandAngles = simRef.current?.terrain?.bandAngles;
    const bandDist = simRef.current?.terrain?.bandDistancesKm;
    if (bandAngles && bandDist && bandAngles.length > 0) {
      const bands = createTerrainBands(
        bandAngles,
        bandDist,
        undefined,
        simRef.current?.terrain?.waterFrac,
        simRef.current?.terrain?.observerElevation ?? 50
      );
      scene.add(bands.group);
      assignLayer(bands.group, LAYER_MID);
      terrainBandsRef.current = bands;
    }

    // 초기 2D 수역 마스크(해안선·만·반도·강·호수) 즉시 생성
    const initLat = location?.coords?.latitude ?? 37.5;
    const initLng = location?.coords?.longitude ?? 127.0;
    const initWaterHandle = createWaterMask2DTexture({
      latitude: initLat,
      longitude: initLng,
      observerElevation: simRef.current?.terrain?.observerElevation ?? 50,
      elevations: (simRef.current?.terrain as any)?.elevations,
      waterFrac: simRef.current?.terrain?.waterFrac,
    });
    waterMaskHandleRef.current = initWaterHandle;
    waterTexRef.current = initWaterHandle.texture;

    // 3. Sun
    const sun = createSun();
    scene.add(sun.mesh);
    assignLayer(sun.mesh, LAYER_CELESTIAL);   // 구름 아래 (§94)
    sunRef.current = sun;

    // 4. Moon
    const moon = createMoonGroup();
    scene.add(moon.group);
    assignLayer(moon.group, LAYER_CELESTIAL);   // 구름 아래 (§94)
    moonRef.current = moon;

    // 5a. 은하수
    const milkyWay = createMilkyWayBand();
    scene.add(milkyWay.mesh);
    assignLayer(milkyWay.mesh, LAYER_CELESTIAL);   // 구름 아래 (§94)
    milkyWayRef.current = milkyWay;

    // 5b. 항성 + 행성
    const starField = createStarField(8);
    scene.add(starField.points);
    // 별은 점 광원이라 **반드시 원해상도**입니다 (SceneComposer 주석).
    assignLayer(starField.points, LAYER_CELESTIAL);   // 구름 아래 (§94)
    starFieldRef.current = starField;

    pixelRatioRef.current = Math.max(
      1,
      gl.drawingBufferWidth / Math.max(1, sceneWidthRef.current)
    );

    // 6. Celestial Paths & Standard Gnomon Shadow Pole (160cm/100cm)
    const celPaths = createCelestialPathsGroup();
    scene.add(celPaths.containerGroup);
    assignLayer(celPaths.containerGroup, LAYER_MID);
    celestialPathsRef.current = celPaths;

    // 7. Clouds
    const atlas = bakeCloudAtlas(renderer as unknown as THREE.WebGLRenderer);
    cloudAtlasRef.current = atlas;
    const cloudField = createCloudField(atlas, MAX_CLOUDS);
    scene.add(cloudField.mesh);
    // 빌보드 구름은 산 능선 뒤에 가려져야 하므로 LAYER_MID에서 산(-0.35)보다 먼저(-0.42) 렌더링
    assignLayer(cloudField.mesh, LAYER_MID);
    cloudFieldRef.current = cloudField;

    // 연속 구름층 — 운량이 병합 임계를 넘으면 빌보드 위로 덮입니다.
    const cloudDeck = createCloudDeck({
      maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
    });
    scene.add(cloudDeck.group);
    assignLayer(cloudDeck.group, LAYER_SOFT_CLOUD);
    cloudDeckRef.current = cloudDeck;

    // ── 구름 슬랩 (docs/SKY_REBUILD_PLAN.md) ─────────────────────────────
    //
    // 구면 껍질 덱과 빌보드를 대체합니다. 전체화면 패스 하나로, 화면 픽셀에서
    // 방향 → 지상거리 → 월드 (x, z) 로 바로 갑니다. 극좌표 격자가 없으므로
    // 천정 특이점도 지평선 타일 격자도 생기지 않고, 알파가 두께에서 나오므로
    // 가장자리가 저절로 얇아 노을빛이 투과합니다.
    //
    cloudDeck.group.visible = false;
    cloudField.mesh.visible = false;

    // ── 분리 해상도 합성 (docs 배율 훑기 결과) ──────────────────────────
    //
    // 하늘돔과 구름 덱만 절반 해상도로 그린 뒤 화면에 얹습니다. 별·태양·
    // 지형·빌보드는 원해상도 그대로입니다 — 별은 점 광원이라 해상도를
    // 낮추면 흐려지고 깜빡입니다.
    //
    // 프래그먼트 부하도 그 두 층에서 1/4이 됩니다.
    const composer = createSceneComposer(
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      DEFAULT_SOFT_SCALE
    );
    composerRef.current = composer;
    // §117·§127 지형 거리 판 — 볼륨 하늘이 이 판으로 구름 행진을 지형에서 멈춥니다(vol.setTerrainDistance).
    // ⚠ 슬랩 전용이 아닙니다. 꺼지면 빈 판(0km)이 넘어가 하늘 전체가 "지형"으로 칠해져 검어집니다.
    composer.setTerrainDistance(true);

    // 초기 업데이트
    updateScene();

    // Render loop
    let contextLost = false;
    let consecutiveErrors = 0;
    (gl as any).__contextLostRef = (v: boolean) => { contextLost = v; };

    /**
     * **적응 해상도** — 기기가 감당하는 만큼만 선명하게.
     *
     * 하늘·구름은 저해상도 버퍼에 그린 뒤 확대합니다. 배율이 그림을 얼마나
     * 깎는지 재봤습니다 (`build-app-vs-harness.js`, 세부 = 이웃 화소 밝기차
     * 평균, 원해상도를 100%로):
     *
     *   배율 2 (예전 고정값)  세부 77~81%   렌더 비용 0.35배
     *   배율 1.5              세부 84~87%   렌더 비용 0.53배
     *   배율 1                세부 98~100%  렌더 비용 0.97배
     *
     * 색·휘도·채도는 세 배율에서 소수점까지 같습니다. 배율은 **선명도만**
     * 바꿉니다. 그래서 고정값 하나로 정할 문제가 아닙니다 — 빠른 기기는
     * 배율 1로 하네스 습작과 같은 그림을 낼 수 있고, 느린 기기는 2가 아니면
     * 프레임을 못 맞춥니다.
     *
     * 2에서 **시작**해 여유가 확인되면 내려갑니다. 반대 방향(느려서 올림)이
     * 즉시 반응하도록 비대칭으로 둡니다 — 끊기는 것이 흐린 것보다 나쁩니다.
     */
    const ADAPT_MIN = 1.0;
    const ADAPT_MAX = 2.0;
    const ADAPT_STEP = 0.5;
    /** 이 프레임 시간을 넘으면 무겁다고 보고 배율을 올립니다 (약 38fps). */
    const ADAPT_SLOW_MS = 26;
    /** 이보다 빠르면 여유가 있다고 보고 배율을 내립니다 (약 55fps). */
    const ADAPT_FAST_MS = 18;
    /** 판단에 쓰는 프레임 수. 너무 짧으면 한 번 튄 프레임에 흔들립니다. */
    const ADAPT_WINDOW = 45;
    let adaptAccMs = 0;
    let adaptCount = 0;
    let adaptLastTs = 0;
    /** 배율을 막 바꾼 직후 몇 프레임은 렌더 타깃 재생성 비용이 섞이므로 버립니다. */
    let adaptSettle = 0;

    const animate = () => {
      if (contextLost) {
        isLoopRunningRef.current = false;
        return;
      }

      if (!isActiveRef.current) {
        // 탭 비활성화 시 렌더링 및 루프 완전 중단 (GPU/CPU 0% 절전)
        isLoopRunningRef.current = false;
        return;
      }

      // 지도가 3D 를 다 덮었으면 그리지 않습니다 — GPU 를 지도·구에 양보(줌아웃 끊김 줄이기).
      // 줌인으로 넘기는 점 아래로 오면 `applyZoomProgress` 의 requestRender 가 다시 깨웁니다.
      if (!glVisibleForProgress(zoomProgressRef.current)) {
        isLoopRunningRef.current = false;
        return;
      }

      const now = performance.now();

      // ── 60fps 캡 (120Hz ProMotion 과열 방지: 최소 15.5ms 간격 보장) ───────────
      if (lastRenderTsRef.current > 0 && now - lastRenderTsRef.current < 15.5) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      // ── 프레임 시간 적산 (적응 해상도) ───────────────────────────────────
      {
        if (adaptLastTs > 0) {
          const dt = now - adaptLastTs;
          if (dt < 200) {
            if (adaptSettle > 0) adaptSettle--;
            else { adaptAccMs += dt; adaptCount++; }
          }
        }
        adaptLastTs = now;

        const composerAdapt = composerRef.current;
        if (composerAdapt && adaptCount >= ADAPT_WINDOW) {
          const avg = adaptAccMs / adaptCount;
          adaptAccMs = 0; adaptCount = 0;
          const cur = composerAdapt.softScale;
          let next = cur;
          if (avg > ADAPT_SLOW_MS) next = Math.min(ADAPT_MAX, cur + ADAPT_STEP);
          else if (avg < ADAPT_FAST_MS) next = Math.max(ADAPT_MIN, cur - ADAPT_STEP);
          if (Math.abs(next - cur) > 1e-3) {
            composerAdapt.setSoftScale(next);
            adaptSettle = 5;
          }
        }
      }

      let isTrackingMoving = false;

      try {
        // 즉시(0ms) 시간 이동 + 실시간 경과 시간 연속 반영 (바람 드리프트 및 천체 연속 유영)
        const wallElapsedMs = isSlidingRef.current ? 0 : Math.max(0, performance.now() - lastTargetSyncPerfRef.current);
        const effectiveTimeMs = targetTimeMsRef.current + wallElapsedMs;
        renderedTimeMsRef.current = effectiveTimeMs;
        const frameDate = new Date(renderedTimeMsRef.current);
        updateScene(frameDate);

        // 3D 천체 카메라 트래킹 (Smooth Celestial Camera Tracking)
        if (trackingTargetRef.current) {
          let tPos: THREE.Vector3 | null = null;
          const target = trackingTargetRef.current;
          if (target === 'sun' && sunRef.current?.mesh) {
            tPos = sunRef.current.mesh.position;
          } else if (target === 'moon' && moonRef.current?.group) {
            tPos = moonRef.current.group.position;
          } else if (target === 'milkyway') {
            tPos = trackingMwVec
              .set(0.5, -0.4, -0.7)
              .normalize()
              .multiplyScalar(400)
              .applyMatrix3(equToHorizonRef.current);
          } else if (target.startsWith('planet_')) {
            const idx = parseInt(target.split('_')[1], 10);
            const keys: PlanetKey[] = ['jupiter', 'saturn', 'venus'];
            if (keys[idx]) {
              const dir = getPlanetDirectionVector(keys[idx], frameDate, tempPlanetVec);
              tPos = dir.multiplyScalar(380).applyMatrix3(equToHorizonRef.current);
            }
          }

          if (tPos) {
            const targetAz = (Math.atan2(tPos.x, -tPos.z) * (180 / Math.PI) + 360) % 360;
            const horizDist = Math.hypot(tPos.x, tPos.z);
            const targetElev = Math.atan2(tPos.y, horizDist) * (180 / Math.PI);

            let azDiff = targetAz - cameraAzRef.current;
            while (azDiff > 180) azDiff -= 360;
            while (azDiff < -180) azDiff += 360;

            const minElev = -20;
            const clampedTargetElev = Math.max(minElev, targetElev);
            const elevDiff = clampedTargetElev - cameraElevRef.current;

            if (Math.abs(azDiff) > 0.05 || Math.abs(elevDiff) > 0.05) {
              isTrackingMoving = true;
            }

            cameraAzRef.current = (cameraAzRef.current + azDiff * 0.14 + 360) % 360;
            cameraElevRef.current += elevDiff * 0.14;
            setCameraAzimuth(cameraAzRef.current);
            setCameraElevation(cameraElevRef.current);
          }
        }

        // 외부 주입 카메라 각도/FOV 실시간 반영 (AR 카메라 연동)
        if (cameraAzimuthPropRef.current !== undefined) {
          cameraAzRef.current = cameraAzimuthPropRef.current;
        }
        if (cameraElevationPropRef.current !== undefined) {
          cameraElevRef.current = cameraElevationPropRef.current;
        }
        if (fovPropRef.current !== undefined && Math.abs(fovRef.current - fovPropRef.current) > 0.05) {
          fovRef.current = fovPropRef.current;
          camera.fov = fovPropRef.current;
          camera.updateProjectionMatrix();
        }

        // 카메라 높이 및 무한 줌 스펙트럼 (지상 1.6m ~ 상공 20km 조감도 수직 다이빙 착륙/상승)
        // 진행도 → 자세는 `zoomContinuum.ts` 한 곳에서 풉니다. 넘기는 점(P_HANDOFF)에서
        // 내려다본 땅 폭이 지도 폭과 같고, 내려다보는 동안 방위가 북쪽 위로 돌아갑니다.
        const groundY = groundRef.current ? groundRef.current.position.y : 0;
        const pose = cameraPoseForProgress(
          zoomProgressRef.current, cameraElevRef.current, cameraAzRef.current,
          homeRef.current.latitude, camera.aspect, fovRef.current,
        );
        const altitudeM = pose.altitudeM;
        const cameraY = groundY + altitudeM;
        camera.position.set(0, cameraY, 0);
        const effectiveElev = pose.elevDeg;
        const effectiveAz = pose.azDeg;
        if (Math.abs(camera.fov - pose.fovDeg) > 0.05) {
          camera.fov = pose.fovDeg;
          camera.updateProjectionMatrix();
        }

        // 상공에서 지형/구름이 잘리지 않도록 카메라 Far 클립 확장 (기본 1000m -> 상공 시 최대 160km)
        const targetFar = Math.max(1000, altitudeM * 8);
        if (Math.abs(camera.far - targetFar) > 50) {
          camera.far = targetFar;
          camera.updateProjectionMatrix();
        }

        const azRad = (effectiveAz * Math.PI) / 180;
        const elevRad = (effectiveElev * Math.PI) / 180;
        const lookDist = Math.max(100, altitudeM);

        // 화면 위쪽은 시선에 수직인 연속 벡터 — 내려다볼 때 북쪽(−Z)이 위.
        // ⚠ 예전에는 −85° 에서 (0,1,0) → (0,0,−1) 로 바꿔, 그 한 프레임에 화면이 방위각만큼 돌았습니다.
        camera.up.set(pose.up[0], pose.up[1], pose.up[2]);

        camera.lookAt(
          lookDist * Math.cos(elevRad) * Math.sin(azRad),
          cameraY + lookDist * Math.sin(elevRad),
          -lookDist * Math.cos(elevRad) * Math.cos(azRad)
        );

        // 지형 및 해수면에 상공 관측 고도 전달
        if (terrainFieldRef.current) {
          updateTerrainFieldEye(terrainFieldRef.current, camera);
          terrainFieldRef.current.material.uniforms.uEyeHeightM.value = altitudeM;
        }
        if (seaPlaneRef.current) {
          updateSeaPlaneEye(seaPlaneRef.current, camera);
          if (seaPlaneRef.current.material.uniforms.uEyeHeightM) {
            seaPlaneRef.current.material.uniforms.uEyeHeightM.value = altitudeM;
          }
          if (!volDrewRef.current) { seaPlaneRef.current.distMesh.visible = false; seaPlaneRef.current.litMesh.visible = false; }
        }
        // 해 쪽 산 그림자 경계 — 해·지형이 그대로면 아무것도 안 합니다(TerrainField.bakeSunShadow).
        if (terrainFieldRef.current?.mesh.visible && rendererRef.current) {
          terrainFieldRef.current.bakeSunShadow(rendererRef.current);
          // §157 하늘 보임(AO) — DEM 패치가 바뀔 때만 굽습니다(같은 패치면 아무것도 안 함).
          terrainFieldRef.current.bakeAmbient(rendererRef.current);
        }

        // 개발자 튜닝 값을 매 프레임 밀어 넣습니다. 슬라이더를 움직이는 즉시
        // 스카이돔·태양·구름·덱이 같은 값으로 다시 그려집니다.
        // §95 — 광공해만큼 밤 암순응을 덜 받습니다. 구름 슬랩에 넘기는 cityLight 와 같은 식.
        setSceneCityLight(layersRef.current.cityLights === false
          ? 0 : Math.max(0, Math.min(1, (6.5 - skySettingsRef.current.starMagLimit) / 3.5)));
        applyTuningUniforms(skydomeRef.current?.material.uniforms);
        applyTuningUniforms(sunRef.current?.material.uniforms);
        applyTuningUniforms(cloudFieldRef.current?.material.uniforms);
        const deckLayers = cloudDeckRef.current?.layers;
        if (deckLayers) for (const dl of deckLayers) applyTuningUniforms(dl.material.uniforms);
        if (groundRef.current) applyTuningUniforms((groundRef.current.material as THREE.ShaderMaterial).uniforms);
        if (terrainFieldRef.current) applyTuningUniforms(terrainFieldRef.current.material.uniforms);
        if (seaPlaneRef.current) applyTuningUniforms(seaPlaneRef.current.material.uniforms);

        // 층마다 다른 해상도로 그려 합성합니다. 합성기가 없으면(생성 실패
        // 등) 예전처럼 한 번에 그립니다 — 화면이 안 나오는 것보다 낫습니다.
        const composerNow = composerRef.current;
        if (composerNow) {
          // 광선의 기준점은 **매 프레임** 넣습니다. `updateScene`에서 한 번만
          // 넣으면 카메라를 돌리는 프레임에 광선이 한 박자 늦게 따라옵니다.
          // 광선은 **보이는** 해에서 뻗습니다 — 겉보기 고도(대기 굴절).
          const rayAlt = (getApparentAltitude(sunAltRef.current) * Math.PI) / 180;
          const rayAz = (sunAzRef.current * Math.PI) / 180;
          composerNow.setSun(
            sunDirRayVec.set(
              Math.cos(rayAlt) * Math.sin(rayAz),
              Math.sin(rayAlt),
              -Math.cos(rayAlt) * Math.cos(rayAz)
            ),
            sunAltRef.current
          );
          // ── §126.7 볼륨 하늘(개발 빌드 설정) — takram 대기+구름을 텍스처로 그려 하늘 층으로 넘깁니다 ──
          let volTex: THREE.Texture | null = null;
          const volSet = skySettingsRef.current;
          const volSetting = (volSet.volumetricSky ?? VOLUMETRIC_SKY_DEFAULT_ON) && VOLUMETRIC_SKY_ENABLED;
          // 끄면 실패 기록을 지웁니다 — VOL 을 껐다 켜면 다시 시도합니다.
          if (!volSetting && volFailedRef.current) { volFailedRef.current = null; }
          if (VOLUMETRIC_SKY_ENABLED && !volSetting && !volBusyRef.current) setVolumetricStatus({ phase: 'off', error: null });
          const volWant = volSetting && !volFailedRef.current;
          if (volWant && !volRef.current && !volBusyRef.current) {
            const mod = loadVolumetric();
            if (!mod) {
              volFailedRef.current = '볼륨 모듈을 불러오지 못했습니다';
              setVolumetricStatus({ phase: 'failed', error: volFailedRef.current });
            } else {
              volBusyRef.current = true;
              setVolumetricStatus({ phase: 'creating', sinceMs: Date.now(), error: null });
              const tAtmos = Date.now();
              // ⚠ postprocessing 의 composer.setSize 는 렌더러(드로잉 버퍼) 크기까지 바꿉니다 — 저해상도 버퍼 크기로 만들면
              //   앱 화면이 그 크기로 줄어듭니다(웹 하네스에서 1/4 화면). 그래서 **전체 크기**로 만들고 구름만 해상도 배율로 낮춥니다.
              // 하네스 전용(tools/web-repro) — 미리 만든 대기 표 등 만들기 옵션을 덮습니다. 기기에서는 정의되지 않습니다.
              const harnessVolOpts = (globalThis as unknown as { __volCreateOpts?: (r: THREE.WebGLRenderer) => Promise<Record<string, unknown>> }).__volCreateOpts;
              (harnessVolOpts ? harnessVolOpts(renderer as unknown as THREE.WebGLRenderer) : Promise.resolve({}))
                .then(extra => mod.createVolumetricScene(renderer as unknown as THREE.WebGLRenderer, gl.drawingBufferWidth, gl.drawingBufferHeight, { genus: true, celestial: false, ...extra }))
                .then(v => {
                  volumetricStats.atmosMs = Date.now() - tAtmos;
                  volumetricStats.spectral = v.spectral;
                  // §127 기기 성능: 품질 단계와 구름 해상도(최대 배율 아래에서 프레임 간격으로 자동 조절).
                  volGovRef.current = createResolutionGovernor({ maxScale: skySettingsRef.current.volumetricRes ?? 0.5 });
                  v.setResolutionScale(volGovRef.current.scale);
                  volQualityRef.current = '';
                  volRef.current = v; volBusyRef.current = false; volKeyRef.current = ''; volHasSceneRef.current = false; volPendingRef.current = false;
                  volSizeRef.current = `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`; volSettleRef.current = 24;
                  setVolumetricStatus({ phase: 'running' }); requestRender(3);
                })
                .catch(e => { volFailedRef.current = '생성: ' + String((e as Error)?.message ?? e); volBusyRef.current = false; setVolumetricStatus({ phase: 'failed', error: volFailedRef.current }); console.warn('[SkyScene] 볼륨 하늘 생성 실패:', (e as Error)?.stack ?? e); requestRender(2); });
            }
          }
          if (volWant && volRef.current) {
           try {
            const vol = volRef.current;
            const live = loadLiveScene();
            const szKey = `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`;
            if (szKey !== volSizeRef.current) { vol.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight); volSizeRef.current = szKey; }
            // §127 품질 단계·최대 해상도 설정이 바뀌면 겁니다.
            const q = volSet.volumetricQuality ?? 'low';
            const qKey = `${q}|${volSet.volumetricRes ?? 0.5}|${volSet.volumetricFlow ? 1 : 0}|${volSet.volumetricFlowUv ? 1 : 0}|${volSet.volumetricPhysics ? 1 : 0}|${volSet.volumetricPhysicsIce ? 1 : 0}|${volSet.volumetricMacro ?? 1}|${volSet.volumetricMorph ? 1 : 0}`;
            if (qKey !== volQualityRef.current) {
              vol.setQuality(q);
              // §130 흐름 모형 플래그 — 장면은 아래 키를 비워 setSceneAsync(잘라 만들기)로 다시 만듭니다(동기 재생성은 수 초 멈춤).
              vol.setOptions({ flow: !!volSet.volumetricFlow, flowUv: !!volSet.volumetricFlowUv, physics: !!volSet.volumetricPhysics, physicsIce: !!volSet.volumetricPhysics && !!volSet.volumetricPhysicsIce, macro: volSet.volumetricMacro ?? 1, morph: !!volSet.volumetricMorph }, false);
              volKeyRef.current = '';
              const changed = volGovRef.current?.setMax(volSet.volumetricRes ?? 0.5);
              if (changed != null) vol.setResolutionScale(changed);
              volQualityRef.current = qKey; volSettleRef.current = Math.max(volSettleRef.current, 16);
            }
            const vLat = location?.coords?.latitude ?? 37.5, vLon = location?.coords?.longitude ?? 127.0;
            const vElev = simRef.current?.terrain?.observerElevation ?? location?.coords?.altitude ?? 50;
            const vObs = weatherRef.current?.[0] ?? null;
            const vDate = new Date(renderedTimeMsRef.current);
            // §135 안정적 기상 블록 버킷팅:
            // 분 단위 미세 소수점 차이로 텍스처가 매번 다시 구워지는 것을 방지하기 위해 1시간/5% 단위로 양자화합니다.
            // 같은 시간대 내에서는 구름 형태가 유지되며 vol.setDate(바람 드리프트·태양 조명)만 60fps로 매끄럽게 돌아갑니다.
            const wLen = weatherRef.current?.length ?? 0;
            const wSample = weatherRef.current?.[Math.min(4, Math.max(0, wLen - 1))];
            // §165 키는 순수 모듈 sceneKey.ts — 시간 버킷·자리·운량·덱·바람에 τ 구간과 비 0.3 플래그를 더했습니다.
            const key = loadSceneKey()!.volSceneKey({
              sceneMs: renderedTimeMsRef.current, lat: vLat, lon: vLon, elevM: vElev,
              metarId: metarRef.current ? `${metarRef.current.icao}@${metarRef.current.timeMs}` : '',
              metarTimeMs: metarRef.current?.timeMs ?? null,
              obs: vObs, sample: wSample,
            });
            const viewKey = `${effectiveAz.toFixed(2)}|${effectiveElev.toFixed(2)}|${camera.fov.toFixed(2)}|${Math.round(altitudeM)}`;
            const nowPerf = performance.now();
            const isSlidingNow = !!isSlidingRef.current;
            // 슬라이딩 중에는 180ms 쓰로틀로 S=128 초고속 프리뷰를 돌리고,
            // 손을 뗐을 때는 동일한 구름 위치 그대로 S=256 고화질 디테일 업을 1회 진행합니다.
            const allowSlidingBuild = !isSlidingNow || (nowPerf - lastSlidingVolBuildTimeRef.current > 180);
            const isFast = isSlidingNow;
            const needUpgrade = !isSlidingNow && lastVolIsFastRef.current;
            if (live && (key !== volKeyRef.current || needUpgrade) && !volPendingRef.current && allowSlidingBuild) {
              lastSlidingVolBuildTimeRef.current = nowPerf;
              lastVolIsFastRef.current = isFast;
              const built = live.buildLiveScene({
                lat: vLat, lon: vLon, heightM: vElev, date: vDate,
                pathData: simRef.current?.pathData ?? [],
                obs: vObs,
                interpolatedWeather: weatherRef.current,
                az: effectiveAz, el: effectiveElev, fov: camera.fov,
                altitudeM,
                metar: metarRef.current,
              });
              volKeyRef.current = key;
              volPendingRef.current = true;
              const tW = Date.now();
              vol.setSceneAsync(built.input, isFast).then(applied => {
                volPendingRef.current = false;
                volumetricStats.weatherMs = vol.weatherMs();
                if (applied) {
                  volHasSceneRef.current = true;
                  setVolumetricStatus({ summary: built.summary });
                  const g = built.genus;
                  lastVolSceneRef.current = built.obs ? {
                    t: vDate.toISOString(),
                    low: Math.round(built.obs.low), mid: Math.round(built.obs.mid), high: Math.round(built.obs.high),
                    total: built.obs.total != null ? Math.round(built.obs.total) : undefined,
                    genus: g ? `${g.low ?? '-'}/${g.mid ?? '-'}/${g.high ?? '-'}` : '-',
                    tau: built.tauDni != null ? Math.round(built.tauDni * 10) / 10 : undefined,
                  } : null;
                  volViewRef.current = '';          // 다음 프레임에 지금 시선을 다시 겁니다(생성 중에 돌렸을 수 있음)
                  volSettleRef.current = 24;
                  volFreshRef.current = false;      // §165 새 장면이 한 프레임 그려질 때까지 준비 아님
                } else if (volKeyRef.current === key) volKeyRef.current = '';
                if (__DEV__ && Date.now() - tW > 50) console.log(`[SkyScene] 볼륨 층 ${applied ? '바꿈' : '버림'} ${Date.now() - tW}ms`);
                requestRender(3);
              }).catch(e => {
                volPendingRef.current = false; volKeyRef.current = '';
                volFailedRef.current = '층: ' + String((e as Error)?.message ?? e);
                setVolumetricStatus({ phase: 'failed', error: volFailedRef.current });
                console.warn('[SkyScene] 볼륨 층 생성 실패:', (e as Error)?.stack ?? e); requestRender(2);
              });
            }
            if (volHasSceneRef.current) {
              // §155 드리프트 시계 = 고른 시각 + 그 시각이 정해진 뒤 흐른 실제 시간. 시각을 고정해 둔 동안에도 구름이 바람 따라
              // 흐르고, '지금' 모드에서 시각이 1 분씩 넘어가도 시계가 이어져 튀지 않습니다(넘어간 만큼 이미 흘렀음).
              const nowWall = Date.now();
              const anc = driftAnchorRef.current;
              if (!anc || anc.sceneMs !== vDate.getTime()) driftAnchorRef.current = { sceneMs: vDate.getTime(), wallMs: nowWall };
              const a2 = driftAnchorRef.current!;
              vol.setDate(vDate, (a2.sceneMs + (nowWall - a2.wallMs)) / 1000);
              const intervalMs = lastRenderTsRef.current > 0 ? now - lastRenderTsRef.current : 0;
              const dtSec = intervalMs > 0 ? Math.min(0.1, Math.max(0.001, intervalMs / 1000)) : 1 / 60;
              // §127 해상도 자동 조절 — 이어서 그린 프레임 간격으로 구름 해상도 배율을 계단으로 내리고 올립니다.
              const gov = volGovRef.current;
              if (gov && (volSet.volumetricAutoRes ?? true)) {
                const next = gov.sample(intervalMs);
                if (next != null) { vol.setResolutionScale(next); volSettleRef.current = Math.max(volSettleRef.current, 16); }
              }
              volumetricStats.frameMs = gov?.emaMs ?? 0;
              volumetricStats.resScale = gov?.scale ?? 0;
              volumetricStats.quality = q;
              // §127 지형 거리 — 이번 프레임의 판을 먼저 그려 구름 행진이 지형에서 멈추게 합니다(산 앞 구름은 산 위, 산 뒤 구름은 가림).
              // §129 지형 빛 판도 같이 — 지형을 takram 이 하늘·구름과 같은 빛·노출로 칠합니다.
              composerNow.setTerrainLit(true);
              composerNow.prepareTerrainDistance(renderer as unknown as THREE.WebGLRenderer, scene, camera);
              const terrainOn = !!terrainFieldRef.current?.mesh.visible;
              const ridge = terrainOn ? terrainFieldRef.current!.sunRidge() : null;
              vol.setTerrainDistance(terrainOn ? composerNow.terrainDistanceTexture() : null, terrainOn ? composerNow.terrainLitTexture() : null,
                ridge?.valid ? ridge.texture : null, (seaPlaneRef.current?.material.uniforms.uSlopeVar?.value as number | undefined) ?? 0.03,
                terrainOn ? composerNow.terrainLit2Texture() : null);

              // ── 볼륨 뷰포트 렌더링 ──
              if (viewKey !== volViewRef.current) {
                vol.setView(effectiveAz, effectiveElev, camera.fov, altitudeM);
                volViewRef.current = viewKey;
                volSettleRef.current = Math.max(volSettleRef.current, 16);
              }
              volTex = vol.renderToTexture(dtSec);

              // 시간 업스케일이 차도록 몇 프레임 더 — 정적 화면에서 루프가 잠들면 입자가 남습니다.
              if (volSettleRef.current > 0) { volSettleRef.current--; if (framesToRenderRef.current < 2) framesToRenderRef.current = 2; }
            }
           } catch (e) {
            // 프레임 중 실패 — 기존 하늘로 돌아가고 이유를 패널에 남깁니다(장면은 버림, VOL 을 껐다 켜면 다시 만듦).
            volTex = null;
            volFailedRef.current = '프레임: ' + String((e as Error)?.message ?? e);
            setVolumetricStatus({ phase: 'failed', error: volFailedRef.current });
            try {
              volRef.current?.dispose();
            } catch { /* 이미 망가진 장면 */ }
            volRef.current = null;
            volHasSceneRef.current = false;
            volPendingRef.current = false;
            console.warn('[SkyScene] 볼륨 하늘 프레임 실패:', (e as Error)?.stack ?? e);
           }
          }
          composerNow.setExternalSky(volTex);
          if (!volTex) composerNow.setTerrainLit(false);   // §129 볼륨 하늘이 아니면 지형 빛 판을 그리지 않음
          volDrewRef.current = !!volTex;
          if (volTex) volFreshRef.current = true;
          if (skydomeRef.current) skydomeRef.current.mesh.visible = !volTex;

          // 도트 모드(§97) — 합성기가 내부 해상도로 그리고 끝에서 최근접으로 늘립니다.
          composerNow.setPixelArt(skySettingsRef.current.pixelArtRows ?? 0);
          composerNow.render(renderer as unknown as THREE.WebGLRenderer, scene, camera);

          // 볼륨 하늘이 켜져 있을 때는 볼륨 텍스처(volTex)가 첫 렌더링된 후 앱 스플래시 완료 트리거
          if (!isSceneReadyRef.current) {
            const isVolReady = !volSetting || !!volTex;
            if (isVolReady) {
              isSceneReadyRef.current = true;
              useCelestialStore.getState().setAppReady(true);
            }
          }
        } else {
          renderer.render(scene, camera);
          if (!isSceneReadyRef.current) {
            isSceneReadyRef.current = true;
            useCelestialStore.getState().setAppReady(true);
          }
        }
        consecutiveErrors = 0; // 성공적 렌더링 시 연속 오류 카운터 초기화

        // 3D 천체 위치 2D 스크린 좌표 투영 라벨 계산
        // ── 250ms(4fps) 스로틀: React setState가 렌더루프보다 훨씬 무거움 ──────
        const nowForLabel = Date.now();
        if (layersRef.current.labels !== false && nowForLabel - lastLabelUpdateMsRef.current >= 250) {
          lastLabelUpdateMsRef.current = nowForLabel;
          const w = gl.drawingBufferWidth;
          const h = gl.drawingBufferHeight;
          const ratio = pixelRatioRef.current || 1;

          const proj = (v3: THREE.Vector3) => {
            projTempVec.copy(v3).project(camera);
            const visible =
              projTempVec.z < 1.0 &&
              projTempVec.x >= -1.1 &&
              projTempVec.x <= 1.1 &&
              projTempVec.y >= -1.1 &&
              projTempVec.y <= 1.1;
            const px = ((projTempVec.x + 1) * w) / 2 / ratio;
            const py = ((-projTempVec.y + 1) * h) / 2 / ratio;
            return { px, py, visible };
          };

          const labs: Array<{ id: string; name: string; x: number; y: number; color: string }> = [];
          // 라벨은 언어 설정을 따릅니다(예전엔 "태양 Sun" 처럼 두 언어 병기, 점검 2026-09-29).
          const lang = useCelestialStore.getState().language;

          // 1. 태양 (Sun)
          if (sunRef.current?.mesh && layersRef.current.sun && sunAltRef.current > -0.9) {
            const p = proj(sunRef.current.mesh.position);
            if (p.visible) labs.push({ id: 'sun', name: L3(lang, '태양', 'Sun', '太陽'), x: p.px, y: p.py, color: '#FBBF24' });
          }
          // 2. 달 (Moon) — 지금 맨눈에 보일 때만(떠 있고, 낮이면 충분히 차고 해에서 떨어져 있을 때 · labelVisibility.ts)
          if (moonRef.current?.group && layersRef.current.moon) {
            const mp = moonRef.current.group.position;
            const mLen = mp.length() || 1;
            const moonAltDeg = (Math.asin(Math.max(-1, Math.min(1, mp.y / mLen))) * 180) / Math.PI;
            let sepDeg = 180;
            if (sunRef.current?.mesh) {
              const sp = sunRef.current.mesh.position;
              const sLen = sp.length() || 1;
              const cos = (mp.x * sp.x + mp.y * sp.y + mp.z * sp.z) / (mLen * sLen);
              sepDeg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
            }
            const illum = SunCalc.getMoonIllumination(frameDate).fraction;
            if (moonLabelVisible({ moonAltDeg, sunAltDeg: sunAltRef.current, illum, sepDeg })) {
              const p = proj(mp);
              if (p.visible) labs.push({ id: 'moon', name: L3(lang, '달', 'Moon', '月'), x: p.px, y: p.py, color: '#38BDF8' });
            }
          }
          // 3. 은하수 중심부 (Milky Way Center)
          if (layersRef.current.milkyway) {
            const mwPos = trackingMwVec.set(0.5, -0.4, -0.7).normalize().multiplyScalar(400);
            mwPos.applyMatrix3(equToHorizonRef.current);
            const mwAltDeg = (Math.asin(Math.max(-1, Math.min(1, mwPos.y / (mwPos.length() || 1)))) * 180) / Math.PI;
            if (milkyWayLabelVisible(mwAltDeg, sunAltRef.current)) {
              const p = proj(mwPos);
              if (p.visible) labs.push({ id: 'milkyway', name: L3(lang, '은하수 중심', 'Milky Way center', '天の川中心'), x: p.px, y: p.py, color: '#C4B5FD' });
            }
          }
          // 4. 주요 행성 (Planets: 목성, 토성, 금성) — 하늘이 그 행성만큼 어두울 때만(낮에는 숨김)
          if (layersRef.current.planets) {
            const planetList: Array<{ key: PlanetKey; name: string; color: string }> = [
              { key: 'jupiter', name: L3(lang, '목성', 'Jupiter', '木星'), color: '#F43F5E' },
              { key: 'saturn', name: L3(lang, '토성', 'Saturn', '土星'), color: '#F59E0B' },
              { key: 'venus', name: L3(lang, '금성', 'Venus', '金星'), color: '#38BDF8' },
            ];
            planetList.forEach((pl, idx) => {
              const pDir = getPlanetDirectionVector(pl.key, frameDate, tempPlanetVec);
              const pWorld = pDir.multiplyScalar(380);
              pWorld.applyMatrix3(equToHorizonRef.current);
              const pAltDeg = (Math.asin(Math.max(-1, Math.min(1, pWorld.y / (pWorld.length() || 1)))) * 180) / Math.PI;
              if (planetLabelVisible(pl.key, pAltDeg, sunAltRef.current)) {
                const p = proj(pWorld);
                if (p.visible) labs.push({ id: `planet_${idx}`, name: pl.name, x: p.px, y: p.py, color: pl.color });
              }
            });
          }

          setCelestialLabels(labs);
        }
      } catch (e) {
        consecutiveErrors++;
        console.warn(`[SkyScene] Render frame warning (${consecutiveErrors}/10):`, e);
        if (consecutiveErrors >= 10) {
          console.error('[SkyScene] Exceeded consecutive render error limit, pausing loop.');
          contextLost = true;
          isLoopRunningRef.current = false;
          return;
        }
      }

      gl.endFrameEXP();
      lastRenderTsRef.current = performance.now();
      lastRenderedSceneTimeMsRef.current = targetTimeMsRef.current;

      // ── 온디맨드 렌더링 스케줄링 결정 ─────────────────────────────────
      if (framesToRenderRef.current > 0) {
        framesToRenderRef.current--;
      }

      // 첫 렌더 미완료, 잔여 프레임 잔존, 또는 카메라 트래킹 중일 때만 다음 프레임 예약
      if (!isSceneReadyRef.current || framesToRenderRef.current > 0 || isTrackingMoving) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        // 정적 상태: 루프 완전 정지(Sleep, 0 FPS) ➔ GPU/CPU 100% 휴식
        isLoopRunningRef.current = false;
      }
    };

    animateRef.current = animate;
    isLoopRunningRef.current = true;
    animate();
    // 렌더러가 생긴 **뒤에** DEM 을 받게 합니다. 요청 이펙트는 location 에만 걸려 있어서,
    // 마운트 때 렌더러가 아직 없으면 위치가 바뀔 때까지 지형을 안 받았습니다.
    setDemRetryTick(t => t + 1);
  }, []);

  const updateScene = useCallback((evalDate?: Date) => {
    const targetDate = evalDate || new Date(renderedTimeMsRef.current);
    const overcast = predictionRef.current?.factors?.overheadOvercast ?? 0;
    const currentLayers = layersRef.current;
    const lat = location?.coords?.latitude ?? 37.5;
    const lng = location?.coords?.longitude ?? 127.0;

    // 사전 계산된 타임라인이 있으면 **전부 여기서 읽습니다.**
    // 태양 위치·대기·하늘 기둥이 한 번에 나오므로 아래 캐시들이 필요 없습니다.
    const tl = timelineRef.current;
    const sampled: SampledSky | null = tl ? sampleTimeline(tl, targetDate.getTime()) : null;

    if (sampled) {
      sunAltRef.current = sampled.sunAltDeg;
      sunAzRef.current = sampled.sunAzDeg;
    } else {
      // 태양 위치는 가볍고 매 프레임 필요 → 항상 계산
      const sunPos = sunPosition(targetDate, lat, lng);
      sunAltRef.current = (sunPos.altitude * 180) / Math.PI;
      sunAzRef.current = (sunPos.azimuth * 180) / Math.PI + 180;
    }

    const nowMs = Date.now();

    // ── makeAtmosphereParams: 2분 캐시 ────────────────────────────────────────
    // 기상 파라미터(가시거리·습도)는 실시간 변화 없음. 매 프레임 계산은 낭비.
    if (sampled) {
      cachedAtmosphereRef.current = sampled.atmosphere;
    } else if (!cachedAtmosphereRef.current || nowMs - cachedAtmosphereMsRef.current > 120_000) {
      cachedAtmosphereRef.current = makeAtmosphereParams({
        visibilityM: observerWeather()?.visibility,
        humidityPct: observerWeather()?.humidity,
        aod550: observerWeather()?.aod550,
        dustUgM3: observerWeather()?.dust,
        pm10: observerWeather()?.pm10,
        observerElevM: simRef.current?.terrain?.observerElevation ?? 0,
        latitude: lat,
        dayOfYear: dayOfYearOf(targetDate),
      });
      cachedAtmosphereMsRef.current = nowMs;
    }
    const atmosphere = cachedAtmosphereRef.current;

    if (skydomeRef.current) {
      // 달빛 하늘 (§92) — 구름 슬랩도 같은 moonLight 로 달을 광원으로 씁니다.
      const skyMoonPos = SunCalc.getMoonPosition(targetDate, lat, lng);
      const skyMoonAlt = (skyMoonPos.altitude * 180) / Math.PI;
      const skyMoon = moonLight(
        sunAltRef.current, skyMoonAlt, SunCalc.getMoonIllumination(targetDate).fraction, atmosphere);
      updateSkydome(skydomeRef.current, sunAltRef.current, sunAzRef.current, atmosphere, 1.0, {
        altDeg: skyMoonAlt,
        azDeg: (skyMoonPos.azimuth * 180) / Math.PI + 180,
        gain: skyMoon.gain,
      });
    }

    // 지면·능선이 **같이 쓰는** 하늘 조도. 몇 방향만 뽑아 평균해도 충분합니다
    // (지면은 방향을 구분해 보지 않고 전부 합쳐 받습니다). 태양 쪽이 훨씬
    // 밝으므로 방위도 같이 훑어야 편향이 없습니다.
    //
    // **코사인 가중이 핵심입니다.** 수평면이 받는 조도는 ∫L·cosθ dΩ 이라
    // 천정 쪽이 크게, 지평선 쪽이 작게 기여합니다. 균등 평균으로 내면
    // 지평선의 노을빛을 과대 반영해 지면이 실제보다 따뜻해집니다.
    // ── skyRadiance 조도 연산(24회 삼각함수 루프) 캐싱 ────────────────────────
    // 태양 고도/방위 또는 대기 파라미터가 0.04° 이상 변했을 때만 무거운 물리 연산 재계산
    const sunMoved =
      Math.abs(sunAltRef.current - lastSkyMeanSunAltRef.current) > 0.04 ||
      Math.abs(sunAzRef.current - lastSkyMeanSunAzRef.current) > 0.04 ||
      atmosphere !== lastSkyMeanAtmosRef.current;

    if (sunMoved) {
      lastSkyMeanSunAltRef.current = sunAltRef.current;
      lastSkyMeanSunAzRef.current = sunAzRef.current;
      lastSkyMeanAtmosRef.current = atmosphere;

      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (const elev of [10, 30, 50, 75]) {
        const w = Math.sin((elev * Math.PI) / 180);   // cos(천정각)
        for (let a = 0; a < 6; a++) {
          const az = (a * 360) / 6;
          const gamma = angularSeparationDeg(az, elev, sunAzRef.current, sunAltRef.current);
          const L = skyRadiance(elev, gamma, sunAltRef.current, atmosphere);
          sr += L.r * w; sg += L.g * w; sb += L.b * w; sw += w;
        }
      }
      cachedSkyMeanRGBRef.current = { r: sr / sw, g: sg / sw, b: sb / sw };

      // 지평선 부근(고도 2°) 하늘빛 — 방위 6곳 균등 평균. 공기원근이 먼
      // 지형을 이 색으로 끌고 갑니다.
      let hr = 0, hg = 0, hb = 0;
      for (let a = 0; a < 6; a++) {
        const az = (a * 360) / 6;
        const gamma = angularSeparationDeg(az, 2, sunAzRef.current, sunAltRef.current);
        const L = skyRadiance(2, gamma, sunAltRef.current, atmosphere);
        hr += L.r; hg += L.g; hb += L.b;
      }
      cachedHorizonRGBRef.current = { r: hr / 6, g: hg / 6, b: hb / 6 };
    }

    // ── 달빛 조명 연산 (공통) ────────────────────────────────────────────────
    const moonPos = SunCalc.getMoonPosition(targetDate, lat, lng);
    const moonIllum = SunCalc.getMoonIllumination(targetDate);
    // 지면의 달빛 — 하늘·구름과 같은 달빛(§92): "해를 달 자리에 둔 낮" 의 지면 조도 × 이득.
    // 하늘 평균(24방향)은 달이 0.2° 넘게 움직였을 때만 다시 구합니다.
    const mAltDegG = (moonPos.altitude * 180) / Math.PI;
    const mAzDegG = (moonPos.azimuth * 180) / Math.PI + 180;
    const mGain = moonLight(sunAltRef.current, mAltDegG, moonIllum.fraction, atmosphere).gain;
    let moonIrr: { r: number; g: number; b: number } | null = null;
    let moonBeamRadiance: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 };
    const moonApparentAltRad = (getApparentAltitude(mAltDegG) * Math.PI) / 180;
    const moonAzRad = (mAzDegG * Math.PI) / 180;

    if (mGain > 0 && mAltDegG > 0) {
      const c = moonGroundCacheRef.current;
      if (!c || Math.abs(c.alt - mAltDegG) > 0.2 || Math.abs(c.az - mAzDegG) > 0.2 || c.atmos !== atmosphere) {
        let sr = 0, sg = 0, sb = 0, sw = 0;
        for (const elev of [10, 30, 50, 75]) {
          const w = Math.sin((elev * Math.PI) / 180);
          for (let a = 0; a < 6; a++) {
            const az = (a * 360) / 6;
            const L = skyRadiance(elev, angularSeparationDeg(az, elev, mAzDegG, mAltDegG), mAltDegG, atmosphere);
            sr += L.r * w; sg += L.g * w; sb += L.b * w; sw += w;
          }
        }
        const beamM = beamAtAltitude(mAltDegG, 0, atmosphere);
        const direct = Math.sin((mAltDegG * Math.PI) / 180) / Math.PI;
        moonGroundCacheRef.current = {
          alt: mAltDegG, az: mAzDegG, atmos: atmosphere,
          sky: { r: sr / sw, g: sg / sw, b: sb / sw },
          beam: { r: beamM.r * direct, g: beamM.g * direct, b: beamM.b * direct },
        };
      }
      const c2 = moonGroundCacheRef.current!;
      // 직사 몫은 해처럼 운량만큼 가립니다(하늘 몫은 구름 밑면이 대신 비추므로 그대로).
      const t = 1 - overcast;
      moonIrr = {
        r: (c2.sky.r + c2.beam.r * t) * mGain,
        g: (c2.sky.g + c2.beam.g * t) * mGain,
        b: (c2.sky.b + c2.beam.b * t) * mGain,
      };
      const beamM = beamAtAltitude(mAltDegG, 0, atmosphere);
      moonBeamRadiance = {
        r: beamM.r * mGain * t,
        g: beamM.g * mGain * t,
        b: beamM.b * mGain * t,
      };
    }

    if (groundRef.current) {
      updateGroundColors(groundRef.current, sunAltRef.current, overcast, {
        skyMean: cachedSkyMeanRGBRef.current,
        betaMie: atmosphere.betaMie,
        angstrom: atmosphere.angstrom,
        elevScale: atmosphere.elevScale,
        waterTex2D: waterTexRef.current,
        windSpeedMs: layerWindsNow().low.speedKmh / 3.6,
        beam: beamAtAltitude(sunAltRef.current, 0, atmosphere),
        sunTransmittance: 1 - overcast,
        sunAzimuthDeg: sunAzRef.current,
        moonAltitudeDeg: mAltDegG,
        moonAzimuthDeg: mAzDegG,
        moonFraction: moonIllum.fraction,
        moonIrradiance: moonIrr,
      });
    }

    // ── DEM 근거리 지형 · 해수면 물빛 ─────────────────────────────────────────
    //
    // `updateGroundColors`(위)와 **같은 물리량**을 씁니다 — 조도 = 하늘 몫
    // + 직달 몫, 태양 복사휘도 = beam × 태양가림률. 값을 다시 유도하지
    // 않고 그대로 받아씁니다. 이 메시들엔 채도 하한을 따로 안 낮춥니다
    // (`updateGroundColors` 가 지면 채도를 0.55배 하는 것과 달리, 여기는
    // 아직 실측으로 맞출 대상이 이 메시 자체뿐이라 1.0 그대로 둡니다).
    {
      const sky = cachedSkyMeanRGBRef.current;
      const beam = beamAtAltitude(sunAltRef.current, 0, atmosphere);
      const sunT = 1 - overcast;
      const sinAlt = Math.max(0, Math.sin((sunAltRef.current * Math.PI) / 180));
      const direct = (sinAlt * sunT) / Math.PI;
      const surfaceIrr = {
        r: sky.r + beam.r * direct + (moonIrr?.r ?? 0),
        g: sky.g + beam.g * direct + (moonIrr?.g ?? 0),
        b: sky.b + beam.b * direct + (moonIrr?.b ?? 0),
      };
      const sunAzRad = (sunAzRef.current * Math.PI) / 180;
      // ⚠ 지형·물에 넣는 **방향**은 겉보기 고도입니다(대기 굴절, 수평선에서 약 0.5°). 땅에 닿는 빛은 굴절된
      //   광선이라, 산이 해를 가리는 순간(산 그림자 · 산 앞 공기의 그늘)과 윤슬의 자리가 보이는 해와 맞아야
      //   합니다. 밝기 모형에 들어가는 uSunAltDeg 는 기하 고도 그대로 둡니다(사진 판정으로 맞춘 값).
      const sunAltRad = (getApparentAltitude(sunAltRef.current) * Math.PI) / 180;
      const horizon = cachedHorizonRGBRef.current;

      // ── 지형만은 **물리 직달/확산 비**로 갑니다 ─────────────────────────
      //
      // 직달에 빠져 있던 눈금(SOLAR_BEAM_SCALE)을 채우고, 같은 자리에서
      // 노출을 나눠 평평한 지면의 밝기를 그대로 지킵니다. 사면만 밝고
      // 어두워지므로 물·옛 원반과의 밝기 견줌도 그대로 성립합니다.
      const lit = groundLighting(sunAltRef.current, sky, beam, sunT);
      const terrainMoonRadiance = {
        r: SOLAR_BEAM_SCALE * moonBeamRadiance.r,
        g: SOLAR_BEAM_SCALE * moonBeamRadiance.g,
        b: SOLAR_BEAM_SCALE * moonBeamRadiance.b,
      };

      for (const h of [terrainFieldRef.current]) {
        if (!h) continue;
        const u = h.material.uniforms;
        (u.uSurfaceIrr.value as THREE.Vector3).set(
          lit.surfaceIrr.r + (moonIrr?.r ?? 0),
          lit.surfaceIrr.g + (moonIrr?.g ?? 0),
          lit.surfaceIrr.b + (moonIrr?.b ?? 0)
        );
        (u.uSunRadiance.value as THREE.Vector3).set(
          lit.sunRadiance.r, lit.sunRadiance.g, lit.sunRadiance.b);
        (u.uMoonRadiance.value as THREE.Vector3).set(
          terrainMoonRadiance.r, terrainMoonRadiance.g, terrainMoonRadiance.b);
        u.uMoonAzRad.value = moonAzRad;
        u.uMoonAltRad.value = moonApparentAltRad;
        u.uExposure.value = lit.exposure;
        u.uSunAzRad.value = sunAzRad;
        u.uSunAltRad.value = sunAltRad;
        u.uSunAltDeg.value = sunAltRef.current;
        (u.uHazeRadiance.value as THREE.Vector3).set(horizon.r, horizon.g, horizon.b);
        u.uBeta.value = atmosphere.betaMie;
        u.uAngstrom.value = atmosphere.angstrom;
        u.uElevScale.value = atmosphere.elevScale;
        if (u.uOzoneDU) u.uOzoneDU.value = atmosphere.ozoneDU;
      }
      if (seaPlaneRef.current) {
        const u = seaPlaneRef.current.material.uniforms;
        (u.uSurfaceIrr.value as THREE.Vector3).set(surfaceIrr.r, surfaceIrr.g, surfaceIrr.b);
        (u.uSunRadiance.value as THREE.Vector3).set(beam.r * sunT, beam.g * sunT, beam.b * sunT);
        (u.uMoonRadiance.value as THREE.Vector3).set(
          moonBeamRadiance.r, moonBeamRadiance.g, moonBeamRadiance.b);
        u.uMoonAzRad.value = moonAzRad;
        u.uMoonAltRad.value = moonApparentAltRad;
        // Cox & Munk (1954) — **윤슬 폭을 정하는 것은 이 값 하나**입니다.
        // 옛 원반 물(updateGroundColors)과 같은 바람을 씁니다.
        u.uSlopeVar.value = 0.003 + 0.00512 * Math.max(0, layerWindsNow().low.speedKmh / 3.6);
        u.uSunAzRad.value = sunAzRad;
        u.uSunAltRad.value = sunAltRad;
        u.uSunAltDeg.value = sunAltRef.current;
        (u.uHazeRadiance.value as THREE.Vector3).set(horizon.r, horizon.g, horizon.b);
        u.uBeta.value = atmosphere.betaMie;
        u.uAngstrom.value = atmosphere.angstrom;
        u.uElevScale.value = atmosphere.elevScale;
        if (u.uOzoneDU) u.uOzoneDU.value = atmosphere.ozoneDU;
      }
    }

    // ── 옛 능선 띠는 DEM 이 실리면 **끕니다** ──────────────────────────────
    //
    // 먼 지형 격자(3~55km)가 같은 자리를 훨씬 촘촘히 그립니다 — 띠는 방위마다
    // 5·15·40km 딱 세 점만 보고, 격자는 96 고리 × 256 살입니다. 껐다 켠 두
    // 장의 차이 화소를 세 보니 DEM 이 있을 때 띠가 이기는 자리가 거의
    // 없습니다 (내륙 0.007% · 바닷가 0% · 높은 곳 0%).
    //
    // ⚠ 그런데 **지우지는 않습니다.** DEM 이 없으면 띠가 유일한 능선
    //   실루엣이고(0.46%), 무엇보다 자료원이 다릅니다 — 띠는 고도 API,
    //   격자는 AWS 타일이라 한쪽이 죽어도 다른 쪽은 살아 있을 수 있습니다.
    //   원반과 같은 규약입니다: 죽은 코드가 아니라 대비책이므로 끕니다.
    //
    // 수치는 tools/shader-preview/verify-bands-need.js 에 못 박혀 있습니다.
    // ── 옛 지면 원반도 같은 규약으로 끕니다 ───────────────────────────────
    //
    // 원반은 DEM 이 있어도 화면의 0.016~0.809% 를 칠하고 있었는데, 그 몫이
    // 두 가지로 갈립니다:
    //
    //   ① 바닷가 4,821화소 — 지형과 해수면 사이의 **구멍**이었습니다.
    //      원반이 뒤에서 메워 주고 있었을 뿐입니다. 해수면 한쪽 겹침
    //      (uShoreOverlapM)으로 구멍 자체를 닫았으니 이제 0 입니다.
    //   ② 산꼭대기 75,742화소 — **하늘을 지면으로 칠하던 것**입니다.
    //      setGroundHorizon 이 원반을 내리는데 카메라도 같이 내려가 서로
    //      지워, 테두리가 고도와 무관하게 −0.191° 에 고정됩니다. 진짜
    //      수평선은 455m 에서 −0.686° 라 그 사이 0.495° 가 가짜 지면이었습니다.
    //      끄면 그 자리가 하늘로 돌아옵니다 — 고치는 것이 아니라 없애는 쪽.
    //
    // ⚠ 껐을 때 하늘에 구멍이 나면 안 됩니다. 원반을 끈 장면에서 지평선
    //   아래인데 아무것도 안 그려진 화소를 세어 못 박아 뒀습니다 —
    //   바닷가 0 · 내륙 3 · 산꼭대기 1,134(화면의 0.108%). 켜 두면 대신
    //   0.495° 짜리 가짜 지평선을 얻으므로 끄는 쪽이 낫습니다.
    //
    //   산꼭대기의 1,134 는 처음에 "해수면 격자가 60km 에서 끝나 76km
    //   수평선에 못 닿는다" 한 가지로 적었는데 **틀렸습니다.** 방위별로
    //   갈라 보니 74% 는 수평선과 무관한 16~22km 밖의 복잡한 실제 해안선을
    //   근거리·광역 격자가 다르게 근사해 생기는 별개의 결함이고, 수평선
    //   문제는 6% 뿐입니다. 그 6% 는 `createConcentricGeometry` 의 꼬리
    //   고리(SeaPlane 의 `SEA_TAIL_*`)로 화소 폭 아래까지 줄였습니다 —
    //   SEA_FAR_M 자체를 늘리면(200km) 기존 고리가 옅어져 되레 나빠집니다.
    //   나머지 74% 는 아직 안 고쳤습니다. 수치는 verify-disc-horizon.js 에.
    //
    // ⚠ 원반에는 내륙 강·호수의 OSM 마스크(uWaterTex2D)가 달려 있습니다.
    //   반경 475m 짜리 128×128 이라 지금도 사실상 안 보이지만(원반이 이기는
    //   화소가 내륙에서 3개), 끄면 **내륙 물의 코드 경로가 사라집니다.**
    //   나중에 강·호수를 그리려면 해수면이나 지형 셰이더에 새로 넣어야 합니다.
    // ⚠ **끄는 것은 그리기뿐입니다 — 원반 객체는 살려 둡니다.** 카메라 높이가
    //   `groundRef.position.y + 1.6` 이라(setGroundHorizon) 원반을 없애면
    //   눈높이가 같이 사라집니다. visible 만 내리면 위치 계산은 그대로입니다.
    const demOn = !!terrainFieldRef.current?.mesh.visible;
    if (groundRef.current) groundRef.current.visible = !demOn;
    if (terrainBandsRef.current) {
      terrainBandsRef.current.group.visible = !demOn;
    }

    if (terrainBandsRef.current && terrainBandsRef.current.group.visible) {
      updateTerrainBands(terrainBandsRef.current, sunAltRef.current, {
        skyMean: cachedSkyMeanRGBRef.current,
        hazeAt: (az: number, elev: number) =>
          skyRadiance(
            elev,
            angularSeparationDeg(az, elev, sunAzRef.current, sunAltRef.current),
            sunAltRef.current,
            atmosphere
          ),
        beam: beamAtAltitude(sunAltRef.current, 0, atmosphere),
        sunTransmittance: 1 - overcast,
        betaMie: atmosphere.betaMie,
        angstrom: atmosphere.angstrom,
        elevScale: atmosphere.elevScale,
        moonIrradiance: moonIrr,
      });
    }

    if (sunRef.current) {
      // 원반은 **보이는 자리**(겉보기 고도)에 놓습니다. 앱이 알리는 일몰(기하 −0.833°)은 굴절 34′ 를 담은
      // 관례라, 기하 고도에 그리면 원반이 그보다 2~3분 먼저 수평선 아래로 숨었습니다.
      const sunPlaceAlt = getApparentAltitude(sunAltRef.current);
      const sunScale = sunDisplayScale(fovRef.current, sunPlaceAlt);
      const ow = observerWeather();
      const sunOptics = (ow && aerosolOpticsFromObs(ow)) ?? { aod: 0.12, alpha: 1.3, g: 0.64, omega: 0.95 };
      const sunVis = sunVisibility(sunPlaceAlt, simRef.current?.terrain?.observerElevation ?? 0, sunOptics);
      const cloudOcc = (currentLayers.clouds && lastCloudBuildRef.current)
        ? lastCloudBuildRef.current.optics.sunTransmittance
        : 1;
      updateSun(sunRef.current, sunAltRef.current, sunAzRef.current, atmosphere, cloudOcc, sunPlaceAlt, sunScale.scale, sunVis);
      sunDiscRadiusDegRef.current = sunScale.radiusDeg;
      if (!currentLayers.sun) sunRef.current.mesh.visible = false;
    }

    if (moonRef.current) {
      updateMoonPosition(moonRef.current, targetDate, lat, lng);
      moonRef.current.group.visible = currentLayers.moon && moonRef.current.group.visible;
    }

    // ── computeEquToHorizon: targetDate 기준으로 실시간 계산 ───────────────────
    // LST 계산 및 3x3 회전 행렬 구성은 0.001ms 미만의 단순 삼각함수 연산으로,
    // 슬라이더를 움직일 때 실시간으로 지구 자전(별자리 이동)이 자연스럽게 회전합니다.
    computeEquToHorizon(targetDate, lat, lng, equToHorizonRef.current);
    const equToHorizon = equToHorizonRef.current;
    const settings = skySettingsRef.current;

    // ── buildPlanetPoints: 씬 시각 10분 단위 갱신 ────────────────────────────
    const targetTimeMs = targetDate.getTime();
    if (!cachedPlanetPointsRef.current || Math.abs(targetTimeMs - cachedPlanetPointsMsRef.current) > 600_000) {
      cachedPlanetPointsRef.current = buildPlanetPoints(targetDate);
      cachedPlanetPointsMsRef.current = targetTimeMs;
    }

    // ── 달빛이 깎아먹는 한계등급: 씬 시각 5분 단위 갱신 ─────────────────────────
    if (Math.abs(targetTimeMs - cachedMoonMagMsRef.current) > 300_000) {
      const moonPos = SunCalc.getMoonPosition(targetDate, lat, lng);
      const moonAltDeg = (moonPos.altitude * 180) / Math.PI;
      const illum = SunCalc.getMoonIllumination(targetDate).fraction;
      cachedMoonMagLimitRef.current = effectiveMagLimit(settings.starMagLimit, moonAltDeg, illum);
      cachedMoonMagMsRef.current = targetTimeMs;
    }
    const liveMagLimit = cachedMoonMagLimitRef.current;

    if (starFieldRef.current) {
      updateStarField(starFieldRef.current, {
        equToHorizon,
        sunAltDeg: sunAltRef.current,
        brightness: settings.starBrightness,
        magLimit: liveMagLimit,
        pixelRatio: pixelRatioRef.current,
        planets: cachedPlanetPointsRef.current,
        showStars: currentLayers.stars,
        showPlanets: currentLayers.planets,
      });
      starFieldRef.current.points.visible = currentLayers.stars || currentLayers.planets;
    }

    if (milkyWayRef.current) {
      updateMilkyWay(
        milkyWayRef.current,
        equToHorizon,
        sunAltRef.current,
        settings.starBrightness,
        liveMagLimit
      );
      milkyWayRef.current.mesh.visible = currentLayers.milkyway;
    }

    // ── updateCelestialPaths: 씬 날짜 변경 또는 1시간 단위 갱신 ──────────────────
    if (celestialPathsRef.current) {
      if (Math.abs(targetTimeMs - lastCelestialPathsMsRef.current) > 3600_000) {
        updateCelestialPaths(celestialPathsRef.current, targetDate, lat, lng, sunAltRef.current, sunAzRef.current);
        lastCelestialPathsMsRef.current = targetTimeMs;
      }
      // 지금 시각·원반 크기는 궤적을 다시 채우지 않아도 매 프레임 맞춥니다(시간 슬라이더를 움직일 때 비움 자리가 태양을 따라가게).
      setCelestialPathsNow(celestialPathsRef.current, targetDate);
      setCelestialPathsNearFade(celestialPathsRef.current, Math.max(NEAR_FADE_INNER_HOURS, (sunDiscRadiusDegRef.current * 2.2) / 15));
      celestialPathsRef.current.containerGroup.visible = currentLayers.paths;
    }

    if (cloudFieldRef.current) {
      cloudFieldRef.current.mesh.visible = false;
    }
    if (cloudDeckRef.current) {
      cloudDeckRef.current.group.visible = false;
    }

    // ── 구름 재빌드 조건 ──────────────────────────────────────────────────────
    //
    // 벽시계 시간만으로 조이면 두 가지를 놓칩니다.
    //
    // ① **기상 데이터가 바뀌어도 안 그립니다.** 슬라이더를 끌면
    //    `interpolatedWeather`가 새로 계산되는데, 그게 트리거에 없으면
    //    최대 30초 동안 예전 운량으로 그린 하늘을 보게 됩니다.
    // ② **태양 고도가 정체된 시간대에 멈춥니다.** 고도 변화율은 남중·자정
    //    부근에서 0에 가까우므로, 그 근처를 스크럽하면 `altDelta`가 안 자라
    //    씬 시각이 몇 시간을 건너뛰어도 구름이 그대로입니다.
    //
    // 그래서 **씬 시각**과 **기상 배열 정체성**을 함께 봅니다. 벽시계 조건은
    // 실시간 관측 중 구름이 서서히 흐르게 하는 안전망으로만 남깁니다.
    const weatherChanged = weatherRef.current !== lastCloudWeatherRef.current;
    const altDelta = Math.abs(sunAltRef.current - lastCloudSunAltRef.current);
    const sceneDeltaMin = Math.abs(targetDate.getTime() - lastCloudSceneMsRef.current) / 60000;
    const wallDeltaSec = (nowMs - lastCloudRebuildMsRef.current) / 1000;

    // 타임라인이 있으면 재빌드가 fBm 없이 조명만 다시 계산하는 수준이라
    // 훨씬 촘촘히 갱신해도 됩니다 (씬 시각 1분 = 실제 구름 변화 한 칸).
    const sceneThresholdMin = sampled ? 0.5 : 2;
    if (weatherChanged || sceneDeltaMin > sceneThresholdMin || altDelta > 1.0 || wallDeltaSec > 30) {
      const isScrubbing = useCelestialStore.getState().isGestureBlocked;

      if (cloudRebuildTimerRef.current) {
        clearTimeout(cloudRebuildTimerRef.current);
        cloudRebuildTimerRef.current = null;
      }

      const executeRebuild = () => {
        rebuildCloudsForDate(targetDate, sampled);
        lastCloudRebuildMsRef.current = Date.now();
        lastCloudSunAltRef.current = sunAltRef.current;
        lastCloudSceneMsRef.current = targetDate.getTime();
        lastCloudWeatherRef.current = weatherRef.current;
      };

      // 타임라인이 준비되었을 때는 가벼운 보간이므로 즉시 실행,
      // 타임라인이 없는 상태에서 드래그 중일 때는 70ms 디바운스로 CPU 폭주 방지
      if (isScrubbing && !sampled) {
        cloudRebuildTimerRef.current = setTimeout(executeRebuild, 70);
      } else {
        executeRebuild();
      }
    }
  }, [location]);

  const rebuildCloudsForDate = useCallback((targetDate: Date, sampled?: SampledSky | null) => {
    const lat = location?.coords?.latitude ?? 37.5;

    const atmosphere =
      sampled?.atmosphere ??
      makeAtmosphereParams({
        visibilityM: observerWeather()?.visibility,
        humidityPct: observerWeather()?.humidity,
        aod550: observerWeather()?.aod550,
        dustUgM3: observerWeather()?.dust,
        pm10: observerWeather()?.pm10,
        observerElevM: simRef.current?.terrain?.observerElevation ?? 0,
        latitude: lat,
        dayOfYear: dayOfYearOf(targetDate),
      });

    // 타임라인이 있으면 **비싼 앞부분을 건너뜁니다** — 팬 샘플링도, 576방향
    // fBm도, 기둥 광학도 이미 계산돼 있습니다. 여기서는 조명만 다시 겁니다.
    const built = sampled
      ? buildCloudsFromColumns({
          atlas: cloudAtlasRef.current ?? ({} as any),
          sunAltDeg: sunAltRef.current,
          sunAzDeg: sunAzRef.current,
          atmosphere,
          samples: sampled.samples,
          optics: sampled.optics,
          halo: sampled.halo,
          obs: sampled.obs,
          maxTotal: getTuning().maxClouds,
        })
      : buildCloudInstances({
          atlas: cloudAtlasRef.current ?? ({} as any),
          currentTime: targetDate,
          sunAltDeg: sunAltRef.current,
          sunAzDeg: sunAzRef.current,
          atmosphere,
          weather: weatherRef.current ?? [],
          // 날씨 배열은 360° 고리(절대 방위, 0 = 북). 해 방위로 돌려 읽으면 안 됩니다(§166).
          weatherCenterAzDeg: 0,
          maxTotal: getTuning().maxClouds,
        });

    lastCloudBuildRef.current = built;

    // ── 땅에 지는 구름 그림자 지도 ─────────────────────────────────────────
    //
    // 하늘의 구름과 **같은 표본 배열**을 읽습니다 (utils/cloudShadowMap).
    // 따로 만들면 하늘의 구름과 땅의 그늘이 서로 다른 구름을 가리킵니다.
    //
    // 구름·해가 안 바뀌면 다시 굽지 않습니다 — 4,096번 조회라 싸지만
    // 매 프레임 할 일은 아닙니다.
    {
      const obsNow = observerWeather();
      const key = [
        sunAltRef.current.toFixed(1), sunAzRef.current.toFixed(1),
        built.samples.length, layerMeanCover(built.samples, 'low').toFixed(3),
        layerMeanCover(built.samples, 'mid').toFixed(3),
        layerMeanCover(built.samples, 'high').toFixed(3),
      ].join('|');
      if (key !== cloudShadowKeyRef.current) {
        cloudShadowKeyRef.current = key;
        cloudShadowTexRef.current = buildCloudShadowTexture({
          samples: built.samples,
          azSteps: CLOUD_SAMPLE_AZ_STEPS,
          elevs: elevationGrid(),
          sunAltDeg: sunAltRef.current,
          sunAzDeg: sunAzRef.current,
          tauFor: (layer) => opticsForLayer(layer, obsNow).tau,
        }, cloudShadowTexRef.current);
      }
      for (const h of [terrainFieldRef.current, seaPlaneRef.current]) {
        if (!h) continue;
        const cu = h.material.uniforms;
        if (cu.uCloudShadowTex && cloudShadowTexRef.current) {
          cu.uCloudShadowTex.value = cloudShadowTexRef.current;
          cu.uCloudShadowHalfM.value = CLOUD_SHADOW_HALF_M;
          cu.uCloudShadow.value = layersRef.current.clouds ? 1 : 0;
        }
      }
    }

    // 하늘도 구름층 아래로 들어갑니다.
    if (skydomeRef.current) {
      const su = skydomeRef.current.material.uniforms;
      su.uCloudDiffuse.value = layersRef.current.clouds ? built.optics.diffuseToGround : 1;
      su.uHaloStrength.value = layersRef.current.clouds ? built.halo : 0;
    }

    // 태양 원반 차폐
    if (sunRef.current) {
      sunRef.current.material.uniforms.uOcclusion.value = layersRef.current.clouds
        ? built.optics.sunTransmittance
        : 1;
    }
  }, [location]);

  useEffect(() => {
    if (sceneRef.current) {
      updateScene();
    }
  }, [sunAltitude, sunAzimuth, currentTime, prediction, layers, skySettings]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !sim?.terrain?.bandAngles) return;

    if (terrainBandsRef.current) {
      scene.remove(terrainBandsRef.current.group);
      terrainBandsRef.current.dispose();
      terrainBandsRef.current = null;
    }

    const bands = createTerrainBands(
      sim.terrain.bandAngles,
      sim.terrain.bandDistancesKm,
      undefined,
      sim.terrain.waterFrac,
      sim.terrain.observerElevation ?? 50
    );
    scene.add(bands.group);
    // 지형은 다시 만들어질 수 있습니다 — 그때도 층 배정을 잊으면 안 됩니다.
    assignLayer(bands.group, LAYER_MID);
    terrainBandsRef.current = bands;

    // 2D 수역 마스크(해안선·만·반도 + 강·호수)와 바다 수평선 각도 갱신
    const lat = location?.coords?.latitude ?? 37.5;
    const lng = location?.coords?.longitude ?? 127.0;

    waterMaskHandleRef.current?.dispose();
    const waterHandle = createWaterMask2DTexture({
      latitude: lat,
      longitude: lng,
      observerElevation: sim.terrain.observerElevation ?? 50,
      elevations: (sim.terrain as any).elevations,
      waterFrac: sim.terrain.waterFrac,
    });
    waterMaskHandleRef.current = waterHandle;
    waterTexRef.current = waterHandle.texture;

    if (groundRef.current) {
      setGroundHorizon(groundRef.current, sim.terrain.observerElevation ?? 0);
      const mat = groundRef.current.material as THREE.ShaderMaterial;
      if (mat?.uniforms?.uWaterTex2D) {
        mat.uniforms.uWaterTex2D.value = waterHandle.texture;
        mat.uniforms.uHasWater.value = 1.0;
      }
    }
    lastSkyMeanSunAltRef.current = -999;
    requestRender(10);
  }, [sim?.terrain?.bandAngles, location, requestRender]);

  /**
   * **DEM 높이장 패치 요청** (docs/COASTLINE_PLAN.md 1단계).
   *
   * ⚠ `sim.terrain`(Open-Meteo 31방위 프로필)과는 **독립**입니다. 새 지형은
   * 발밑 고도까지 DEM 자신이 정하므로(`TerrainField`·`SeaPlane` 의
   * `groundAtEye`), 여기서는 위경도만 있으면 됩니다 — `observerElevation`
   * 을 넘길 필요가 없습니다.
   *
   * 자리가 바뀌면(위경도가 눈에 띄게 달라지면) 다시 받습니다. 소수점
   * 3자리(≈110m)면 같은 타일 블록 안에 머물 확률이 높아 재요청을
   * 걸러내되, 도보로 이동하는 정도는 못 잡습니다 — `loadDemPatch` 자체가
   * 같은 블록이면 캐시를 쓰므로 크게 문제되지 않습니다.
   */
  useEffect(() => {
    const lat = location?.coords?.latitude;
    const lng = location?.coords?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;

    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    demWantKeyRef.current = key;
    if (demLoadedKeyRef.current === key || demLoadingKeyRef.current === key) return;
    demLoadingKeyRef.current = key;

    let cancelled = false;
    (async () => {
      const renderer = rendererRef.current;
      if (!renderer) { demLoadingKeyRef.current = null; return; }
      try {
        const load = (radiusM: number) => loadDemPatch(lat, lng, radiusM, {
          renderer,
          loadTexture: (url: string) => loadTextureAsync({ asset: url }),
        });
        const patch = await load(FIELD_FAR_M);
        // 물 마스크는 따로 받습니다 — 같은 3×3 블록을 훨씬 낮은 줌으로
        // 받아 60km 를 덮습니다. 이게 없으면 3km 밖이 "모르는 곳"이 되고,
        // 예전에는 그걸 물로 두어 **내륙에서도 사방에 물이 고였습니다**.
        // 실패해도 치명적이지 않습니다 — 촘촘한 패치의 가장자리 값으로
        // 물러납니다(SeaPlane.ts 의 vWater 참고).
        const maskPatch = await load(SEA_MASK_RADIUS_M).catch(() => null);
        // ⚠ 직접 dispose 하지 않습니다. `loadDemPatch` 는 모듈 안에 블록
        // 하나짜리 캐시를 두고, 자리를 옮겨 새로 받을 때 **이전 패치를
        // 스스로 정리**합니다(demTiles.ts 참고). 같은 블록 안이면 오히려
        // *같은 객체*를 돌려주므로, 여기서 "이전" 패치를 지운다며
        // `demPatchRef.current`를 dispose 하면 방금 받은 새 패치를
        // 지우는 꼴이 됩니다. 컴포넌트가 통째로 내려갈 때만
        // `clearDemCache()` 로 정리합니다 (아래 정리 이펙트).
        // 받는 사이에 GL 컨텍스트가 바뀌었으면 이 패치는 옛 컨텍스트의 것입니다 — 버립니다.
        // (onContextCreate 가 다시 요청합니다.)
        // 같은 좌표로 이펙트만 다시 돈 것(취소)이면 이 결과를 그대로 씁니다 — 버리면 다시 요청할 실행이 없습니다.
        if (demWantKeyRef.current !== key || rendererRef.current !== renderer) return;
        // 아홉 장이 **전부** 실패했을 때만 null 입니다 — 한 장이라도 오면
        // 구멍이 있는 채로 패치를 돌려줍니다.
        if (!patch) throw new Error('DEM 타일을 한 장도 못 받았습니다');
        demPatchRef.current = patch;
        // 한 격자가 셋을 다 받습니다 — 촘촘한 것, 발밑용(촘촘한 것), 성긴 것.
        // ⚠ 발밑 고도는 **촘촘한** 패치로 짚습니다. 성긴 것으로 읽으면 같은
        //   자리가 10.9m 낮아 이음매에 층계가 생깁니다.
        terrainFieldRef.current?.setPatch(patch, patch, maskPatch);
        seaPlaneRef.current?.setPatch(patch, maskPatch);
        // 이제 진짜 자료가 있으니 켭니다 (마운트 직후의 발밑고도-0m
        // 근사가 화면에 비칠 일이 없습니다 — 위 mesh.visible = false 참고).
        if (patch && terrainFieldRef.current) terrainFieldRef.current.mesh.visible = true;
        if (patch && seaPlaneRef.current) seaPlaneRef.current.mesh.visible = true;
        demLoadedKeyRef.current = key;
        requestRender(10);
        demRetryCountRef.current = 0;
      } catch (e) {
        if (__DEV__) console.warn('[DEM] 높이장을 못 받았습니다 — 기존 화면으로 물러납니다.', e);
        // ── 다시 걸어 봅니다 ────────────────────────────────────────────────
        //
        // 이 이펙트는 location 에만 걸려 있고 **성공했을 때만**
        // demLoadedKeyRef 를 찍습니다. 재시도가 없으면 한 번 실패한 뒤로는
        // 위치가 110m(소수점 3자리) 넘게 바뀌기 전까지 다시 안 받습니다 —
        // 지하철에서 앱을 켜면 지상에 나와 네트워크가 돌아와도 옛 원반만
        // 보입니다.
        //
        // 그동안 화면이 비지는 않습니다. 원반이 지면의 70% 를 이어받습니다
        // (verify-disc-need.js). 다만 그건 대비책이지 보여 주려던 것이
        // 아닙니다.
        //
        // 2·4·8·16·32초, 그다음은 60초로 묶습니다. 그래도 안 되면 네트워크나
        // 서버 쪽 문제이므로 계속 두드리지 않고 60초 간격으로만 지켜봅니다 —
        // 앱이 할 수 있는 일은 여기까지입니다.
        if (!cancelled || demWantKeyRef.current === key) {
          const n = demRetryCountRef.current + 1;
          demRetryCountRef.current = n;
          const waitMs = Math.min(60000, 1000 * 2 ** n);
          if (demRetryTimerRef.current) clearTimeout(demRetryTimerRef.current);
          demRetryTimerRef.current = setTimeout(() => {
            demRetryTimerRef.current = null;
            // 키를 지우면 위 가드가 풀려 이펙트가 다시 요청합니다.
            demLoadingKeyRef.current = null;
            setDemRetryTick(t => t + 1);
          }, waitMs);
        }
      } finally {
        if (demLoadingKeyRef.current === key) demLoadingKeyRef.current = null;
      }
    })();

    return () => { cancelled = true; };
  }, [location, requestRender, demRetryTick]);

  useEffect(() => {
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }

      if (cloudRebuildTimerRef.current) {
        clearTimeout(cloudRebuildTimerRef.current);
        cloudRebuildTimerRef.current = null;
      }

      skydomeRef.current?.dispose();
      volRef.current?.dispose();
      volRef.current = null;
      volHasSceneRef.current = false;
      volPendingRef.current = false;
      skydomeRef.current = null;

      if (terrainBandsRef.current) {
        terrainBandsRef.current.dispose();
        terrainBandsRef.current = null;
      }
      if (terrainRef.current) {
        disposeTerrainRing(terrainRef.current);
        terrainRef.current = null;
      }

      if (groundRef.current) {
        disposeGroundPlane(groundRef.current);
        groundRef.current = null;
      }

      if (terrainFieldRef.current) {
        terrainFieldRef.current.dispose();
        terrainFieldRef.current = null;
      }
      if (seaPlaneRef.current) {
        seaPlaneRef.current.dispose();
        seaPlaneRef.current = null;
      }
      // DEM 은 모듈 안 캐시에 하나 살아 있습니다 — 씬이 통째로 내려갈 때만
      // 지웁니다(다음 마운트에서 죽은 GL 컨텍스트의 텍스처를 들고 있지
      // 않도록). 도중에 자리를 옮길 때는 loadDemPatch 자신이 정리합니다.
      demPatchRef.current = null;
      if (demRetryTimerRef.current) {
        clearTimeout(demRetryTimerRef.current);
        demRetryTimerRef.current = null;
      }
      demLoadingKeyRef.current = null;
      demLoadedKeyRef.current = null;
      demWantKeyRef.current = null;   // 내려간 뒤 끝난 요청이 결과를 꽂지 않게
      // ⚠ **이 씬의 렌더러 몫만** 버립니다. 인자 없이 부르면 다른 씬(카메라를 닫을 때의
      //   하늘 탭)이 쓰던 패치까지 지워 그쪽 지형이 사라집니다(§100).
      if (rendererRef.current) clearDemCache(rendererRef.current);

      waterMaskHandleRef.current?.dispose();
      waterMaskHandleRef.current = null;
      waterTexRef.current = null;

      if (compassGroupRef.current) {
        disposeCompassGroup(compassGroupRef.current);
        compassGroupRef.current = null;
      }

      sunRef.current?.dispose();
      sunRef.current = null;

      moonRef.current?.dispose();
      moonRef.current = null;

      starFieldRef.current?.dispose();
      starFieldRef.current = null;

      milkyWayRef.current?.dispose();
      milkyWayRef.current = null;

      celestialPathsRef.current?.dispose();
      celestialPathsRef.current = null;

      cloudDeckRef.current?.dispose();
      cloudDeckRef.current = null;

      // 합성기가 잡고 있는 렌더 타깃 두 장 — 화면 크기라 놓치면 큽니다.
      composerRef.current?.dispose();
      composerRef.current = null;

      cloudAtlasRef.current?.dispose();
      cloudAtlasRef.current = null;

      if (cloudFieldRef.current) {
        cloudFieldRef.current.dispose();
        cloudFieldRef.current = null;
      }

      if (sceneRef.current) {
        sceneRef.current.traverse(child => {
          if (
            child instanceof THREE.Mesh ||
            child instanceof THREE.Points ||
            child instanceof THREE.Line ||
            child instanceof THREE.LineSegments ||
            child instanceof THREE.InstancedMesh
          ) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
            } else {
              (child.material as THREE.Material)?.dispose();
            }
          }
        });
        sceneRef.current.clear();
        sceneRef.current = null;
      }

      if (rendererRef.current) {
        try {
          rendererRef.current.dispose();
        } catch (_) {}
        rendererRef.current = null;
      }

      glRef.current = null;
    };
  }, []);

  const sceneW = fullScreen ? width : SCENE_WIDTH;
  const sceneH = fullScreen ? height : SCENE_HEIGHT;
  const minDim = Math.min(sceneW, sceneH);

  const curLat = location?.coords?.latitude ?? 37.5;
  const curLon = location?.coords?.longitude ?? 127.0;

  // 진행도 → 축척은 `applyZoomProgress` 가 프레임마다 손잡이로 넘깁니다. 여기 값들은
  // 지도·구가 **처음 뜰 때**와 단계 판단(120 ms 상태)에만 씁니다.
  viewSizeRef.current = { w: sceneW, h: sceneH };
  // 관측점(3D 카메라 바로 아래). 착륙 애니메이션 중에는 목표가 먼저 들어가 있습니다.
  if (!divingLocation) homeRef.current = { latitude: curLat, longitude: curLon };
  const currentLonDelta = lonDeltaForProgress(zoomProgressState, homeRef.current.latitude, sceneW / sceneH);
  const mapMounted = overlayLive || zoomProgressState > P_MAP_MOUNT;
  const isGlobeMode = overlayMode === 'globe';
  /**
   * 구 겹은 지도 단계에 닿으면 미리 띄워(숨김) 두고, 지도가 내려갈 때까지 둡니다 — 타일 위로 오르기 시작하는
   * 프레임에 새로 만들지 않게(§153). 숨은 동안은 손잡이 값을 기억만 합니다.
   */
  const [globeWarm, setGlobeWarm] = useState(false);
  useEffect(() => {
    if (!mapMounted) setGlobeWarm(false);
    else if (zoomProgressState >= P_HANDOFF) setGlobeWarm(true);
  }, [mapMounted, zoomProgressState]);
  const globeMounted = mapMounted && (globeWarm || zoomProgressState >= P_HANDOFF);

  // 좁은 축척에서의 태양 수직면 & 방위각 부채꼴 오버레이 — **관측점** 기준.
  // 축척은 2^(1/2) 단위로 끊어, 줌 중 매 상태 갱신마다 지도 위 선을 다시 만들지 않습니다.
  const sunOverlayDelta = Math.pow(2, Math.round(Math.log2(currentLonDelta) * 2) / 2);
  const sunOverlay = useMemo(() => {
    if (!mapMounted || isGlobeMode) return null;
    return buildSunOverlay(new Date(overlayMinute * 60000), curLat, curLon, sunOverlayDelta);
  }, [mapMounted, isGlobeMode, curLat, curLon, sunOverlayDelta, overlayMinute]);

  // 지도·구에 넘기는 값은 모두 고정 — 바뀌지 않으면 memo 된 지도가 다시 그려지지 않습니다.
  // (예전에는 렌더마다 새 객체·새 함수라 줌 50 ms 마다 등시선 수백 줄이 다시 그려졌습니다.)
  const mapStartRegion = useMemo(() => ({
    latitude: mapCenterRef.current.latitude,
    longitude: mapCenterRef.current.longitude,
    longitudeDelta: lonDeltaForProgress(zoomProgressRef.current, homeRef.current.latitude, sceneW / sceneH),
  }), [mapMounted]); // eslint-disable-line react-hooks/exhaustive-deps
  const globeStart = useMemo(() => {
    const c = mapCenterRef.current;
    const d = lonDeltaForProgress(zoomProgressRef.current, homeRef.current.latitude, sceneW / sceneH);
    return { center: { latitude: c.latitude, longitude: c.longitude }, radius: globeRadiusForDelta(c.latitude, d, sceneW),
      morph: globeMorphRef.current };
  }, [globeMounted]); // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * 길게 누르기 → **자리만 고릅니다**(핀 + 확인 카드). 옮기기(관측점·날씨·지형 새로 받기·착륙)는
   * 카드의 "여기로 이동" 을 눌러야 합니다. 줌·착륙 중이거나 줌·이동 직후 0.6 초 안의 길게
   * 누르기는 손짓의 끝자락이라 버립니다.
   */
  const onMapLongPress = useCallback((coord: { latitude: number; longitude: number }) => {
    if (zoomProgressRef.current < P_HANDOFF) return;
    if (pinchDistRef.current !== null || divingAnimFrameRef.current !== null) return;
    if (Date.now() - lastViewMoveMsRef.current < 600) return;
    if (!Number.isFinite(coord.latitude) || !Number.isFinite(coord.longitude)) return;
    const h = homeRef.current;
    setPendingPick({
      latitude: coord.latitude,
      longitude: coord.longitude,
      // 같은 날씨 칸(0.02°)이면 새로 받을 날씨가 없습니다 — 카드에 그렇게 적습니다.
      sameCell: sameBucket(h.latitude, h.longitude, coord.latitude, coord.longitude),
    });
  }, []);
  const confirmPick = useCallback(() => {
    if (!pendingPick) return;
    setPendingPick(null);
    startDivingLanding(pendingPick.latitude, pendingPick.longitude);
  }, [pendingPick, startDivingLanding]);
  // 고른 채 두면 8 초 뒤 저절로 닫습니다. 지도 단계를 벗어나도 닫습니다.
  const atMapStage = zoomProgressState >= P_HANDOFF;
  useEffect(() => {
    if (!pendingPick) return;
    if (!atMapStage) { setPendingPick(null); return; }
    const t = setTimeout(() => setPendingPick(null), 8000);
    return () => clearTimeout(t);
  }, [pendingPick, atMapStage]);
  // 안내 문구는 지도 단계에 들어올 때 4 초만, 그것도 처음 두 번만 보입니다(늘 떠 있으면 가립니다).
  const [hintOn, setHintOn] = useState(false);
  const hintShownRef = useRef(0);
  useEffect(() => {
    if (!atMapStage || hintShownRef.current >= 2) { setHintOn(false); return; }
    hintShownRef.current += 1;
    setHintOn(true);
    const t = setTimeout(() => setHintOn(false), 4000);
    return () => clearTimeout(t);
  }, [atMapStage]);
  const pickPin = useMemo(
    () => (pendingPick ? { latitude: pendingPick.latitude, longitude: pendingPick.longitude } : null),
    [pendingPick],
  );
  /**
   * 구의 반지름·한가운데 → 진행도. ⚠ 반지름은 **한가운데 위도**로 풉니다 — `applyZoomProgress` 가 진행도에서 구 반지름을
   * 같은 식(`globeRadiusForDelta(한가운데 위도)`)으로 되돌리므로, 이렇게 해야 돌아온 반지름이 구가 가진 값과 같아 튀지 않습니다.
   * 예전에는 관측점 위도로 풀어, 구를 남북으로 돌린 뒤 다음 줌에서 축척이 cos 비만큼 튀었습니다.
   */
  const progressForGlobe = useCallback((v: { latitude: number; radius: number }) => {
    const vs = viewSizeRef.current;
    const d = deltaForGlobeRadius(v.latitude, v.radius, vs.w);
    return Math.min(P_MAX, Math.max(P_HANDOFF, progressForLonDelta(d, homeRef.current.latitude, vs.w / vs.h)));
  }, []);
  /** 구 안의 손짓(끌기·벌리기·관성) 중 프레임마다 — 형태·겹 불투명도·밑의 지도가 같이 갑니다(§153). */
  const onGlobeViewChanging = useCallback((v: { latitude: number; longitude: number; radius: number }) => {
    cancelSettle();
    lastViewMoveMsRef.current = Date.now();
    mapCenterRef.current = { latitude: v.latitude, longitude: v.longitude };
    applyZoomProgress(progressForGlobe(v), { keepCenter: true });
  }, [applyZoomProgress, cancelSettle, progressForGlobe]);
  const onGlobeViewChange = useCallback((v: { latitude: number; longitude: number; radius: number; zoomedIn?: boolean }) => {
    // 구를 돌리거나(한가운데) 구 안에서 확대·축소했을 때(반지름) — 손을 뗀 자리를 받아 겹침 구간이면 끝으로 보냅니다.
    const c0 = mapCenterRef.current;
    if (Math.abs(c0.latitude - v.latitude) > 1e-6 || Math.abs(c0.longitude - v.longitude) > 1e-6) {
      lastViewMoveMsRef.current = Date.now();
    }
    mapCenterRef.current = { latitude: v.latitude, longitude: v.longitude };
    zoomProgressRef.current = progressForGlobe(v);
    settleZoom(0);
  }, [settleZoom, progressForGlobe]);

  return (
    <View
      style={[
        styles.container,
        fullScreen ? { flex: 1, width: '100%', height: '100%' } : { width: SCENE_WIDTH, height: SCENE_HEIGHT },
      ]}
      {...panResponder.panHandlers}
    >
      {/* 지도가 3D 위로 겹쳐 오르는 동안 3D 는 불투명 그대로(둘 다 반투명이면 가운데가 어두워짐).
             지도가 다 덮으면(넘기는 점) 숨기고 렌더 루프도 쉽니다. */}
      <Animated.View style={[styles.glView, { opacity: glOpacityAnim }]} pointerEvents={zoomProgressState < P_HANDOFF ? 'auto' : 'none'}>
        <GLView
          style={styles.glView}
          onContextCreate={onContextCreate}
        />
      </Animated.View>

      {/* ── 하늘 위 눈금: 방위 한 줄(늘) + 고도·시야각(손으로 바꾸는 동안만) ── */}
      {!hideHudOverlay && !hideCompassBar && zoomProgressState <= P_FOV_END + 0.1 && (
        <ViewfinderOverlay
          cameraAzimuth={cameraAzimuth}
          cameraElevation={cameraElevation}
          cameraFov={cameraFov}
          theme={theme}
          adjusting={viewAdjusting}
        />
      )}

      {/* 3D 천체 위치 2D 스크린 오버레이 라벨 핀 (지상 관측 뷰에서만 표시) */}
      {layers?.labels !== false && zoomProgressState <= P_FADE_START && (() => {
        // 라벨 크기 추정 (px): 가로 90, 세로 24
        const LBL_W = 90;
        const LBL_H = 24;
        const maxY = fullScreen ? Math.max(380, height - 200) : 380;
        // 배치된 라벨 bounding box 목록
        const placed: Array<{ x: number; y: number; w: number; h: number }> = [];

        const resolveY = (rawX: number, rawY: number): number => {
          let y = rawY;
          const MARGIN = 4;
          // 최대 5번 시도 (위 또는 아래로 밀어내기)
          for (let attempt = 0; attempt < 5; attempt++) {
            const overlapping = placed.some(p =>
              rawX < p.x + p.w + MARGIN &&
              rawX + LBL_W > p.x - MARGIN &&
              y < p.y + p.h + MARGIN &&
              y + LBL_H > p.y - MARGIN
            );
            if (!overlapping) break;
            // 아래로 먼저 밀고, 아래가 화면 밖이면 위로
            const downY = y + LBL_H + MARGIN;
            const upY   = y - LBL_H - MARGIN;
            if (downY + LBL_H <= maxY) {
              y = downY;
            } else {
              y = Math.max(10, upY);
            }
          }
          return y;
        };

        return celestialLabels.map(lbl => {
          const isTrackingThis = trackingTarget === lbl.id;
          const rawX = Math.max(10, Math.min(SCENE_WIDTH - LBL_W - 10, lbl.x - 30));
          const rawY = Math.max(10, Math.min(maxY - LBL_H - 10, lbl.y - 28));
          const finalY = resolveY(rawX, rawY);
          placed.push({ x: rawX, y: finalY, w: LBL_W, h: LBL_H });

          return (
            <TouchableOpacity
              key={lbl.id}
              activeOpacity={0.8}
              onPress={() => onSelectTrackingTarget?.(isTrackingThis ? null : lbl.id)}
              style={[
                styles.celestialLabelPin,
                {
                  left: rawX,
                  top: finalY,
                  borderColor: isTrackingThis ? '#38BDF8' : lbl.color,
                  backgroundColor: isTrackingThis ? 'rgba(56, 189, 248, 0.35)' : 'rgba(15, 23, 42, 0.8)',
                },
              ]}
            >
              <View style={[styles.labelDot, { backgroundColor: lbl.color }]} />
              <Text style={styles.labelText}>{lbl.name}</Text>
              {isTrackingThis && <Target size={10} color="#38BDF8" style={{ marginLeft: 3 }} />}
            </TouchableOpacity>
          );
        });
      })()}

      {/* ── 2~3단계: 기존 지도 뷰(IsolineMap) 파이프라인 (평면 구글 지도 -> 육지 실루엣 -> 구형 지구본 유기적 모핑) ── */}
      {mapMounted && globeCelestialData && (
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            {
              opacity: mapOpacityAnim,
              borderRadius: cardRadiusAnim,
              overflow: 'hidden',
            },
          ]}
          pointerEvents={zoomProgressState >= P_HANDOFF ? 'auto' : 'none'}
        >
          {/* 지도·실루엣·구를 **겹쳐 둡니다**. 예전에는 지도 ↔ 구를 삼항으로 갈아 끼워, 문턱을 넘을 때마다
                 네이티브 지도를 지우고 새로 만들었습니다(타일 재요청 · 그 프레임 끊김). */}
          <MapCanvas
            ref={mapCanvasRef}
            lat={curLat}
            lon={curLon}
            hasLocation={!!location}
            subsolar={globeCelestialData.subsolar}
            terminator={globeCelestialData.terminator}
            allTerminators={allTerminators}
            nightPolygonCoords={nightPolygonCoords}
            sunOverlay={sunOverlay}
            topView={topView}
            theme={theme}
            selectedDate={globeCelestialData.date}
            startRegion={mapStartRegion}
            // 두 손가락 줌은 하늘 탭의 진행도가 받습니다(지도가 같이 확대하면 둘이 싸워 덜컹임).
            zoomEnabled={false}
            // 지도 단계의 손짓은 모두 구 겹이 받고 지도는 `moveTo` 로만 움직입니다(§154). 네이티브 지도의
            // 영역 변경 알림은 우리가 옮긴 것의 늦은 메아리라 받지 않습니다(받으면 손을 뗀 뒤 옛 자리로 되돌아감).
            onLongPress={onMapLongPress}
            pickPin={pickPin}
          />

          {globeMounted && (
            <Animated.View
              style={[StyleSheet.absoluteFillObject, { opacity: globeOpacityAnim, backgroundColor: '#0B1220' }]}
              // 지도 단계 내내 구 겹이 손을 받습니다(타일만 보일 때도) — 끌기는 형태 0 의 메르카토르라 밑의 지도와
              // 같이 움직이고, 두 손가락은 하늘 탭 줌으로 넘어가 지구본 ↔ 지도 ↔ 지상을 한 손짓으로 오갑니다(§154).
              pointerEvents={atMapStage ? 'auto' : 'none'}
            >
              <MapGlobe
                ref={mapGlobeRef}
                subsolar={globeCelestialData.subsolar}
                terminator={globeCelestialData.terminator}
                allTerminators={allTerminators}
                sublunar={globeCelestialData.sublunar}
                moonFraction={globeCelestialData.moonFraction}
                visible={overlayMode !== 'tiles'}
                lat={curLat}
                lon={curLon}
                hasLocation={!!location}
                theme={theme}
                isActive={isActive && atMapStage}
                interactive={atMapStage}
                width={sceneW}
                height={sceneH}
                topView={topView}
                initialCenter={globeStart.center}
                initialRadius={globeStart.radius}
                initialMorph={globeStart.morph}
                // ⚠ 위 끝은 넉넉히 — 구로 넘어가는 축척의 반지름이 화면 폭의 2~3 배(서울 세로 폰 ≈ 1000 px)
                //   입니다. 예전 800 에 잘려 넘어가는 순간 땅이 줄었습니다.
                // ⚠ 위 끝은 지도 단계의 가장 좁은 폭(넘기는 점 ≈ 0.45°)까지 — 서울 세로 폰 ≈ 63000 px. 예전 20000 에
                //   잘리면 손잡이 반지름이 실제 축척과 달라 끌기가 3 배 빨랐고 줌이 거기서 멈췄습니다.
                minRadius={100}
                maxRadius={1e7}
                onSelectLocation={onMapLongPress}
                onViewChange={onGlobeViewChange}
                onViewChanging={onGlobeViewChanging}
                pickPin={pickPin}
                selectedDate={globeCelestialData.date}
              />
            </Animated.View>
          )}
        </Animated.View>
      )}

      {/* ── 무한 줌 상공 모드 및 우주 궤도 지구본 모드 HUD 뱃지 ── */}
      {(zoomProgressState > P_FOV_END + 0.1 || divingLocation) && (
        <View style={styles.radarHudPill}>
          <View style={[styles.radarHudDot, isGlobeMode && { backgroundColor: '#F59E0B' }]} />
          <Text style={styles.radarHudTitle}>
            {divingLocation
              ? L3(language,
                  `(${divingLocation.latitude.toFixed(2)}°, ${divingLocation.longitude.toFixed(2)}°) 착륙 중`,
                  `Landing at (${divingLocation.latitude.toFixed(2)}°, ${divingLocation.longitude.toFixed(2)}°)`,
                  `(${divingLocation.latitude.toFixed(2)}°, ${divingLocation.longitude.toFixed(2)}°) に着陸中`)
              : isGlobeMode
              ? L3(language, '지구본 · 노을 등시선', 'Globe · sunset isolines', '地球儀 · 夕焼け等時線')
              : (() => {
                  const alt = altitudeMState >= 1000 ? `${(altitudeMState / 1000).toFixed(1)}km` : `${Math.round(altitudeMState)}m`;
                  return L3(language, `상공 ${alt} · 구름 레이더`, `${alt} up · cloud radar`, `上空 ${alt} · 雲レーダー`);
                })()}
          </Text>
          <TouchableOpacity
            style={styles.radarHudResetBtn}
            onPress={() => {
              const cLat = location?.coords?.latitude ?? 37.5;
              const cLon = location?.coords?.longitude ?? 127.0;
              startDivingLanding(cLat, cLon);
            }}
          >
            <Text style={styles.radarHudResetText}>{L3(language, '착륙', 'Land', '着陸')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 길게 눌러 고른 자리 — 확인해야 옮깁니다 */}
      {pendingPick && atMapStage && !divingLocation && (
        <View style={styles.pickCard}>
          <Text style={styles.pickTitle}>
            {pendingPick.latitude.toFixed(2)}°, {pendingPick.longitude.toFixed(2)}°
          </Text>
          <Text style={styles.pickSub}>
            {pendingPick.sameCell
              ? L3(language, '지금 위치와 같은 날씨 칸입니다', 'Same weather cell as your location', '現在地と同じ天気のマスです')
              : L3(language, '이 위치의 날씨를 새로 받아 착륙합니다', 'Fetches weather here, then lands', 'ここの天気を取得して着陸します')}
          </Text>
          <View style={styles.pickRow}>
            <TouchableOpacity style={styles.pickCancel} onPress={() => setPendingPick(null)}>
              <Text style={styles.pickCancelText}>{L3(language, '취소', 'Cancel', 'キャンセル')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pickGo} onPress={confirmPick}>
              <Text style={styles.pickGoText}>{L3(language, '여기로 이동', 'Go here', 'ここへ移動')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 안내 — 지도 단계에 들어올 때 잠깐만 */}
      {hintOn && !pendingPick && !divingLocation && (
        <View style={styles.radarHintToast} pointerEvents="none">
          <Text style={styles.radarHintText}>
            {L3(language, '길게 눌러 위치를 고르면, 확인 후 그곳으로 이동합니다', 'Long-press to pick a place, then confirm to go there', '長押しで場所を選び、確認するとそこへ移動します')}
          </Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  glView: {
    flex: 1,
  },
  modeBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.75)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  modeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  celestialLabelPin: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
    zIndex: 30,
  },
  labelDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  labelText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '800',
  },
  radarHudPill: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.6)',
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 50,
  },
  radarHudDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#38BDF8',
    marginRight: 6,
  },
  radarHudTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  radarHudResetBtn: {
    marginLeft: 10,
    backgroundColor: 'rgba(56, 189, 248, 0.25)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: '#38BDF8',
  },
  radarHudResetText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
  },
  radarHintToast: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    zIndex: 40,
  },
  radarHintText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  pickCard: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    minWidth: 230,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.45)',
    zIndex: 45,
  },
  pickTitle: { color: '#F1F5F9', fontSize: 13, fontWeight: '700' },
  pickSub: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  pickRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8, gap: 8 },
  pickCancel: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(148, 163, 184, 0.18)' },
  pickCancelText: { color: '#CBD5E1', fontSize: 13, fontWeight: '700' },
  pickGo: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: '#0EA5E9' },
  pickGoText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});
