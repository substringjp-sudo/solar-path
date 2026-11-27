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
import { getPrimarySky, setPrimarySky } from './primarySky';
import React, { useRef, useCallback, useEffect, useState, useMemo, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet, PanResponder, useWindowDimensions, Text, TouchableOpacity, Animated, Platform, PixelRatio } from 'react-native';
import { registerWorkletModule } from '../VolumetricProbe/skyWorklet';

if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    registerWorkletModule(require('react-native-worklets'));
  } catch { /* fallback to main-thread chunked generator */ }
}
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer, loadTextureAsync } from 'expo-three';
import * as THREE from 'three';
import { targetPointAt, type PickedTarget, type TargetPoint } from '../../utils/demPick';
import { targetPointOf } from '../../utils/pickedTarget';
import { pickTargetAt } from '../../utils/pickTarget';
import { buildHorizonProfile, skylineAngleDeg, type HorizonProfile } from '../../utils/horizon';
import { offsetLatLon, localOffsetM } from '../../utils/geoMove';
import { blockCovers, denseRadiusM, moveObserver } from '../../utils/demGeometry';
import { Target } from 'lucide-react-native';
import SunCalc from 'suncalc';
import { getMoonPositionPrecise } from '../../utils/moonPosition';
import { sunPosition } from '../../utils/solarPosition';
import {
  VOLUMETRIC_SKY_ENABLED,
  REMOTE_SETTLE_FRAMES,
  FAR_MAX_BUILDINGS_SHOWN,
  PIXEL_ART_CHOICES,
  flattenDemForBuildings,
  sceneHeightSampler,
  mergeBuildings,
  dayOfYearOf,
  computeSkyAtmosphereMeans,
  computeMoonGroundLighting,
  computeTrackingStep,
  projectCelestialScreenLabels,
  resolveCelestialLabelY,
  type LayerState,
  type SkySettings,
  type LongExposureSimMode,
  type LongExposureSimOptions,
  type LongExposureSimResult,
  type EyeState,
  type FarBuildingsResult,
  type VolumetricPhaseOf,
  type VolumetricSceneState,
  type SkyRenderState,
} from './SkyScene3DHelpers';
export {
  PIXEL_ART_CHOICES,
  type LayerState,
  type SkySettings,
  type LongExposureSimMode,
  type LongExposureSimOptions,
  type LongExposureSimResult,
  type EyeState,
  type FarBuildingsResult,
  type VolumetricPhaseOf,
  type VolumetricSceneState,
  type SkyRenderState,
};
import { styles } from './SkyScene3D.styles';

import {
  createTerrainBands,
  updateTerrainBands,
  type TerrainBandsHandle,
  createGroundPlane,
  setGroundHorizon,
  createCompassGroup,
  updateGroundColors,
  disposeTerrainRing,
  disposeGroundPlane,
  disposeCompassGroup,
  seaHorizonDipDeg,
} from './TerrainRing';
import { createSun, updateSun, sunDisplayScale, setSunCloudAlpha, type SunHandle } from './SunMesh';
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
  FAR_FIELD_FAR_M,
  FAR_FIELD_RINGS,
  FIELD_RINGS,
  type TerrainFieldHandle,
} from './TerrainField';
import {
  createBuildingField,
  updateBuildingFieldEye,
  computeNightWindowRate,
  computeNightWindowGlow,
  type BuildingFieldHandle,
} from './BuildingField';
import { fetchNearbyBuildings, BUILDING_RADIUS_M, type BuildingMeshData } from '../../utils/buildingTiles';
import type { LoadProgress } from '../../utils/loadProgress';
import { loadFarBuildings, type FarTileData } from '../../utils/farBuildingsLoad';
import { fetchUrbanMask } from '../../utils/mvtTiles';
import { type BuildingCover } from '../../utils/demBuildingFlatten';
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
import { computeTrackedAttitudeAt } from '../../utils/astroStackMath';
import { createMilkyWayBand, updateMilkyWay, type MilkyWayHandle } from './MilkyWayBand';
import { ensureNightLightsForLocation, loadNightLights, getCachedNightLights } from '../../utils/nightLightsAsset';
import {
  CITY_REF_LOCAL,
  cityGlowDirection,
  cityLightField,
  estimateLightPollution,
  getPrehydratedCityLightField,
  getPrehydratedLightPollution,
  type CityLightField,
  type LightPollutionEstimate,
  type NightLights,
} from '../../utils/cityLightMap';
import type { VolumetricScene } from '../VolumetricProbe/volumetricScene';
import { createResolutionGovernor, volumetricStats, type ResolutionGovernor } from '../../utils/volumetricGovernor';
import { setVolumetricStatus } from '../VolumetricProbe/volumetricStatus';
/** 개발 패널 상태 줄 덧붙임(§25.9) — 층마다 종류 · 렌더 두께(m) · 미세물리 기둥 τ(렌더 봉투 반영). 기기에서 구름이 실제로 얼마나 두껍게 그려지는지 한 줄로. */
function layerOpticsNote(
  layers: readonly { genus?: string | null; thicknessM?: number | null }[] | undefined,
  phys: readonly ({ tauRendered: number } | null)[] | null | undefined,
): string {
  if (!layers?.length) return '';
  const parts = layers.slice(0, 4).map((L, i) => {
    if (!L?.genus) return null;
    const t = phys?.[i]?.tauRendered;
    return `${L.genus} ${L.thicknessM ? `${Math.round(L.thicknessM)}m` : '기본'}${t != null && Number.isFinite(t) ? ` τ${t.toFixed(0)}` : ''}`;
  }).filter(Boolean);
  return parts.length ? ` · 층 ${parts.join(' / ')}` : '';
}
import {
  evaluateVolDateSync,
  buildDayPrewarmBuckets,
  nextPrewarmBucket,
  type VolDateSyncState,
} from '../../utils/sliderSettle';
// §126.7 볼륨 하늘 — 메인 시뮬레이션 기본 경로로 활성화
const loadVolumetric = (): typeof import('../VolumetricProbe/volumetricScene') | null =>
  (VOLUMETRIC_SKY_ENABLED ? require('../VolumetricProbe/volumetricScene') : null);
const loadLiveScene = (): typeof import('../VolumetricProbe/liveScene') | null =>
  (VOLUMETRIC_SKY_ENABLED ? require('../VolumetricProbe/liveScene') : null);
// §165 장면 캐시 키(순수 모듈) — liveScene 과 같은 이유로 게을리 불러옵니다.
const loadSceneKey = (): typeof import('../VolumetricProbe/sceneKey') | null =>
  (VOLUMETRIC_SKY_ENABLED ? require('../VolumetricProbe/sceneKey') : null);
import { createCelestialPathsGroup, updateCelestialPaths, setCelestialPathsNow, setCelestialPathsNearFade, NEAR_FADE_INNER_HOURS, CelestialPathsGroup } from './CelestialPathMesh';
import { ViewfinderOverlay } from './ViewfinderOverlay';
import { sampleTimeline, type SkyTimeline, type SampledSky } from '../../utils/skyTimeline';
import {
  createSceneComposer,
  assignLayer,
  DEFAULT_SOFT_SCALE,
  LAYER_MID,
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
import { fetchDayWeatherRing, getInterpolatedWeather, type CloudPathData } from '../../utils/weather';
import { fetchMetarReports, nearestStationLatest, type MetarObs } from '../../utils/metar';
import {
  PRESET_OPTICS,
  representativePresetForObserver,
  representativeTauForObserver,
} from '../../utils/cloudPresets';
import {
  WeatherFan,
  buildSkyColumns,
  solveColumnOptics,
  resolveLayerWinds,
  elevationGrid,
  layerMeanCover,
  PLACEHOLDER_WIND_SPEED_KMH,
  PLACEHOLDER_WIND_BEARING_DEG,
  type ColumnOptics,
} from '../../utils/skyColumn';
import type { LayerWinds } from '../../utils/weather';
import { layerTauScale } from '../../utils/cloudProfile';
import { makeAtmosphereParams, skyRadiance, beamAtAltitude, applyTuningUniforms, angularSeparationDeg, groundLighting, setSceneCityLight, SOLAR_BEAM_SCALE } from '../../utils/atmosphere';
import { getApparentAltitude } from '../../utils/sunsetPhysics';
import { DEFAULT_TUNING, getTuning, subscribeTuning } from '../../utils/skyTuning';
import { effectiveMagLimit } from '../../utils/moonlight';
import { useCelestialStore } from '../../store/useCelestialStore';
import { subscribeScrubTime } from '../../utils/liveClock';
import { L3 } from '../../utils/i18n';
import { isReducedMotion } from '../../theme/motion';

/** 박명광선의 기준점. 렌더 루프에서 매 프레임 다시 채웁니다. */
const sunDirRayVec = new THREE.Vector3();
/**
 * 볼륨 구름 정착 뒤 다듬기 프레임 수. 시간 업스케일(1/16) 에서 화소마다 표본이 16 프레임에 하나 → 96 프레임이면 화소당 표본 ~6 개를
 * 더 얻어 누적(cloudAccum 0.25)이 행진 지터 잡음을 평균합니다. 30 fps 에서 ~3 초, 손을 대면 멈춥니다.
 */
const VOL_REFINE_FRAMES = 96;
/** 다듬기 시간 상한(ms) — 느린 기기에서 프레임 수를 다 못 채워도 여기서 멈춥니다. */
const VOL_REFINE_MAX_MS = 2500;

export const DEFAULT_SKY_SETTINGS: SkySettings = {
  starBrightness: 1.0,
  starMagLimit: 6.5,
  pixelArtRows: 0,
  volumetricSky: true,
  volumetricQuality: 'low',
  volumetricRes: 0.5,
  volumetricAutoRes: true,
  // 대기 흐름 구름 모형과 층별 바람 드리프트/전단 기울임(flowUv)을 기본으로 켭니다. 개발 패널 FLOW/UV 칩으로 끌 수 있습니다.
  volumetricFlow: true,
  volumetricFlowUv: true,
  volumetricPhysics: true,   // §25.7 미세물리 단면·소광 기본(층적운 한낮 그늘)
  volumetricPhysicsIce: false,
  volumetricMacro: 1,
  volumetricMorph: false,
  volumetricBillow: true,
  volumetricFill: true,
  volumetricAccurateSun: true,
  volumetricLowSunShadow: true,
  volumetricFarSun: true,
  volumetricSheetDiffuse: true,
  volumetricClampInscatter: true,
  volumetricIrradianceLogMu: true,
};

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
  /** 외부(카메라 오버레이 등)에서 제스처를 직접 처리할 때 씬 내부 PanResponder 비활성화 */
  disableGestures?: boolean;
  /** 내부 FOV HUD 배지 숨김 여부 */
  hideHudOverlay?: boolean;
  /** 내부 하단 나침반 눈금자 Bar 숨김 여부 */
  hideCompassBar?: boolean;
  /** 땅을 떠나 위로 올라갔는지(지상 시야각 단계를 넘었는지) 바뀔 때. 화면이 "지도로" 버튼을 숨기는 데 씁니다. */
  onAscendedChange?: (ascended: boolean) => void;
  /**
   * 망원 배율(1 이상, 기본 1). 2026-11-19 샌드박스: 지상 시야각(30~120°)을 이 값으로 나눕니다. 20 배면 1.5~6°(달이 화면 3분의 1).
   * 손가락 줌(30~120°)은 그대로 기본 시야각을 정하고, 망원은 그 위에 곱해집니다. 시야각을 읽는 곳(드래그 속도·해 크기·눈금)이 모두 같이 따라갑니다.
   */
  telephotoX?: number;
  /** 망원 배율이 핀치 줌아웃이나 상공 상승으로 초기화·변경될 때 호스트에 알립니다. */
  onChangeTelephoto?: (nextTeleX: number) => void;
  /** 샌드박스: 눈금자에 렌즈 정보(35mm 환산, 쓸 렌즈, 디지털 배율)를 함께 보입니다. */
  showLensInfo?: boolean;
  /** 위에 떠 있는 것(앱 머리줄)이 가리는 높이(px). 위쪽 알림 · 렌즈 배지를 그만큼 내립니다. 기본 0. */
  topInset?: number;
  /**
   * 샌드박스: 짧게 탭하면 그 방향에서 눈에 처음 닿는 땅이나 건물(멀면 가까운 봉우리·건물 꼭대기로 붙임)을 골라 `onPickTarget` 으로 알립니다.
   * 하늘·바다 쪽을 탭하면 null. 지상 단계에서만 동작합니다.
   */
  pickEnabled?: boolean;
  onPickTarget?: (t: PickedTarget | null) => void;
  /** 고른 대상 — 화면에 표시(고리)합니다. null 이면 표시 없음. */
  pickedTarget?: PickedTarget | null;
  /**
   * 땅 위 눈 높이(m, 기본 1.6). 2026-11-19 샌드박스: 지상 시야 단계(지도로 올라가기 전)에서만 씁니다. 지형·건물·구름이 이 높이의 눈으로 다시 그려집니다.
   * 지도로 올라가는 구간은 자기 고도 곡선을 쓰므로 높이를 올려 둔 채 줌아웃하면 올라가기 시작할 때 한 번 낮아집니다.
   */
  eyeHeightM?: number;
  /** 하늘 화면의 장면을 다른 화면(촬영)이 renderRemote 로 빌려 쓰게 등록합니다(primarySky.ts). */
  registerPrimary?: boolean;
}

/** 3D 시뮬레이터 외부 제어 및 스냅샷 캡처 핸들 */
export interface SkyScene3DHandle {
  takeSnapshot: (options?: { format?: 'jpeg' | 'png'; compress?: number }) => Promise<string | null>;
  getLastSnapshotError: () => string | null;
  getLastBufferMean: () => number;
  getRenderState: () => SkyRenderState | null;
  isVolumetricReady: () => boolean;
  renderRemote: (view: { az: number; el: number; fov: number }, opts?: { waitMs?: number; format?: 'jpeg' | 'png'; compress?: number; requireReady?: boolean }) => Promise<{ uri: string | null; ready: boolean; error: string | null; state: SkyRenderState | null }>;
  renderLongExposure: (
    view: { az: number; el: number; fov: number; rollDeg?: number },
    opts: LongExposureSimOptions,
  ) => Promise<LongExposureSimResult>;
  cancelLongExposure?: () => void;
  beginLiveAccum?: (opts?: { lighten?: boolean; exposureGain?: number; shadowLift?: number; starBoost?: number }) => void;
  stepLiveAccum?: (timeMs: number) => void;
  endLiveAccum?: () => void;
  flyToMap: () => void;
  setCameraView?: (
    azDeg: number,
    elDeg: number,
    fovDeg?: number,
    opts?: { rollDeg?: number; centerOffsetYFrac?: number },
  ) => void;
  clearCameraLensOverride?: () => void;
  getSkyline?: () => ((azDeg: number) => number | null) | null;
  getHorizonProfile?: () => HorizonProfile | null;
  targetFromLatLon?: (latitude: number, longitude: number, elevM: number) => (TargetPoint & { eyeElevM: number }) | null;
  setEyeLocation?: (latitude: number, longitude: number) => void;
  clearEyeLocation?: () => void;
  getEyeState?: () => EyeState;
  getBuildingProgress?: () => LoadProgress;
  loadFarBuildings?: (opts?: { onProgress?: (p: { tilesDone: number; tilesTotal: number; bytes: number }) => void }) => Promise<FarBuildingsResult | null>;
}

/** 망원 배율 상한 — 지상 시야각 30~120° 를 이 값으로 나눕니다(1.5~6°). */
export const TELE_MAX = 20;

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
  buildings: false,
};

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
    registerPrimary = false,
    cameraElevationProp,
    fovProp,
    disableGestures = false,
    hideHudOverlay = false,
    hideCompassBar = false,
    onAscendedChange,
    telephotoX = 1,
    onChangeTelephoto,
    showLensInfo = false,
    topInset = 0,
    eyeHeightM,
    pickEnabled = false,
    onPickTarget,
    pickedTarget = null,
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
  const urbanLoadedKeyRef = useRef<string | null>(null);
  const urbanCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const noiseOriginRef = useRef<{ lat: number; lng: number } | null>(null);
  const bandCenterRef = useRef<{ lat: number; lng: number; bandAngles: unknown } | null>(null);
  const volSceneOriginRef = useRef<{ latitude: number; longitude: number } | null>(null);
  // 도시·포장 지도가 바뀔 때마다 올립니다. 지형 빛 판 캐시 키에 넣어, 지도가 늦게 와도 다시 그립니다.
  const urbanSerialRef = useRef(0);
  // DEM 패치·건물 패치가 바뀔 때마다 올립니다. 건물/지형 빛 판 캐시 키에 넣어, 패치가 늦게 와도 건물 외벽이 누락되지 않게 합니다.
  const demSerialRef = useRef(0);
  // 건물 덮개(지도). DEM 과 지도 중 늦게 온 쪽이 건물 자리 고도 깎기를 겁니다(demBuildingFlatten.ts).
  const bldCoverRef = useRef<{ key: string; lat: number; lng: number; cover: BuildingCover } | null>(null);
  const buildingFieldRef = useRef<BuildingFieldHandle | null>(null);
  /** 먼 건물(샌드박스): 가까운 건물 병합 기하·읽은 먼 타일·그 위치 키·진행 중 읽기. 먼 건물은 위치가 바뀌면 비웁니다. */
  const nearBuildingDataRef = useRef<BuildingMeshData | null>(null);
  // 지금 그려지는 건물(가까운 것 + 불러온 먼 것)의 병합 기하. 화면을 눌러 건물을 고를 때 `pick` 색인을 씁니다.
  const mergedBuildingRef = useRef<BuildingMeshData | null>(null);
  const farTilesRef = useRef<Map<string, FarTileData>>(new Map());
  const farLocKeyRef = useRef('');
  const farAbortRef = useRef<AbortController | null>(null);
  /** 핸들(한 번만 만들어짐)이 읽는 관측 중심 위경도 — 매 렌더 갱신 */
  const bldCenterRef = useRef<{ lat: number; lng: number }>({ lat: 0, lng: 0 });
  /** 땅 프로필·스카이라인 캐시(해·달 걸기, 계산 과정 보기) — 지형 패치 번호와 눈 높이가 같은 동안 재사용. */
  const skylineCacheRef = useRef<{ key: string; prof: HorizonProfile; fn: (azDeg: number) => number | null } | null>(null);
  /** 캐시된(없으면 지금 만드는) 땅 프로필. 땅 자료가 아직 없으면 null. 핸들(한 번만 만들어짐)이 부르므로 ref 로만 읽습니다. */
  const horizonCacheRef = useRef<() => { prof: HorizonProfile; fn: (azDeg: number) => number | null } | null>(() => null);
  const horizonCache = () => horizonCacheRef.current();
  const buildingLoadedKeyRef = useRef<string | null>(null);
  /** 지금 위치의 주변 건물을 받는 진행(샌드박스의 "주변 불러오는 중 · 건물 %" 막대). 핸들 `getBuildingProgress` 가 읽습니다. */
  const buildingProgressRef = useRef<LoadProgress>({ phase: 'idle', done: 0, total: 0 });
  const buildingRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buildingRetryCountRef = useRef(0);
  const seaPlaneRef = useRef<SeaPlaneHandle | null>(null);
  const demPatchRef = useRef<DemPatch | null>(null);
  const demMaskPatchRef = useRef<DemPatch | null>(null);
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
  /**
   * 눈 이동(연속 이동 조이스틱 2단계, docs/SANDBOX_MODE_PLAN.md 12.2): 조이스틱이 프레임마다 눈의 경위도를 알립니다(`setEyeLocation`).
   * null 이면 `location`(커밋된 위치)을 따릅니다. 움직이는 동안 `location` 은 그대로 두어 날씨 · 건물 · 물 마스크 같은 위치별 자료를 다시 받지 않고,
   * 눈이 떨어져 있는 동안은 지형 · 바다의 `uDemObs` 만 프레임마다 옮깁니다.
   */
  const eyeRef = useRef<{ latitude: number; longitude: number } | null>(null);
  /** 눈이 커밋된 위치에서 떨어져 있는 동안 true — 건물은 커밋된 위치 기준이라 이 동안 숨깁니다. */
  const eyeMovingRef = useRef(false);
  /** 마지막으로 본 커밋된 위치 좌표 — 같은 좌표로 객체만 새로 온 것을 가립니다. */
  const prevLocCoordsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  /** 새 블록 받기에 실패한 뒤 이 시각까지는 다시 요청하지 않습니다(프레임마다 두드리지 않게). */
  const demRecenterAfterRef = useRef(0);
  const [buildingSyncTick, setBuildingSyncTick] = useState(0);
  const [buildingRetryTick, setBuildingRetryTick] = useState(0);
  const sunRef = useRef<SunHandle | null>(null);
  const moonRef = useRef<MoonHandle | null>(null);
  /** 달을 광원으로 둔 지면 조도(이득 곱하기 전) — 달이 움직였을 때만 다시 구합니다. */
  const moonGroundCacheRef = useRef<{ alt: number; az: number; atmos: unknown; sky: { r: number; g: number; b: number }; beam: { r: number; g: number; b: number } } | null>(null);
  const starFieldRef = useRef<StarFieldHandle | null>(null);
  const milkyWayRef = useRef<MilkyWayHandle | null>(null);
  const celestialPathsRef = useRef<CelestialPathsGroup | null>(null);
  // 2026-11-18 장노출(renderLongExposure)을 그리는 동안 해·달 경로선을 숨김 — 결과는 사진 흉내라 안내선이 찍히면 안 됨(사용자 요청).
  const hidePathsForExposureRef = useRef(false);
  
  /** 별·은하수가 공유하는 적도→지평 회전 행렬 (프레임당 1회만 계산) */
  const equToHorizonRef = useRef(new THREE.Matrix3());
  /** 마지막 구름 기둥 광학 결과 — 태양 차폐에 사용합니다. */
  const lastCloudOpticsRef = useRef<ColumnOptics | null>(null);
  const composerRef = useRef<SceneComposerHandle | null>(null);
  const glRef = useRef<ExpoWebGLRenderingContext | null>(null);
  const animFrameRef = useRef<number>(0);
  const isSceneReadyRef = useRef<boolean>(false);

  // 카메라 회전 state (ref로 관리)
  const cameraAzRef = useRef(sunAzimuth);
  const cameraElevRef = useRef(13); // 기본 FOV 60° 기준 땅이 30%를 넘지 않도록 13°로 초기화
  const fovRef = useRef(60);
  const cameraRollRef = useRef(0);
  const viewCenterOffsetYFracRef = useRef(0);
  // 무한 줌 스펙트럼 (0~1: 지상 FOV 30°~120°, 1~2: 상공 고도 상승 1.6m~20km 구름 레이더, 2~3: 우주 궤도 3차원 지구본 및 노을 등시선)
  const zoomProgressRef = useRef((60 - 30) / 90);
  /** 망원 배율 — `applyZoomProgress` 가 지상 시야각을 이 값으로 나눕니다(props.telephotoX). */
  const teleRef = useRef(1);
  const pinchTeleRef = useRef(1);
  const onChangeTelephotoRef = useRef(onChangeTelephoto);
  onChangeTelephotoRef.current = onChangeTelephoto;
  /** 샌드박스 고르기 — 탭 판정과 결과를 렌더 루프·손짓 처리가 읽습니다. */
  const pickEnabledRef = useRef(false);
  pickEnabledRef.current = pickEnabled;
  const onPickTargetRef = useRef(onPickTarget);
  onPickTargetRef.current = onPickTarget;
  const pickedTargetRef = useRef<PickedTarget | null>(null);
  const pickedViewRef = useRef<{ azDeg: number; elDeg: number } | null>(null);
  if (pickedTargetRef.current !== pickedTarget) {
    pickedTargetRef.current = pickedTarget;
    pickedViewRef.current = null;
  }
  const tapStartMsRef = useRef(0);
  const doPickRef = useRef<(x: number, y: number) => void>(() => {});
  /** 눈 높이(m) — props.eyeHeightM. 지상 단계에서 자세의 고도를 덮어씁니다. */
  const eyeHeightRef = useRef<number | undefined>(undefined);
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
  /** 볼륨 구름 배치용 그 시간(정시 + 30 분)의 날씨 — 시간 버킷·경로 자료·보간 날씨가 바뀔 때만 다시 계산. */
  const volBucketWxRef = useRef<{ ms: number; path: CloudPathData[]; live: unknown; wx: any[] } | null>(null);
  const layersRef = useRef(layers);
  const skySettingsRef = useRef(skySettings);
  // §126.7 볼륨 하늘 — 장면·생성 중 표시·마지막 층 키(층은 바뀔 때만 다시 만듦)·실패 표시
  const volRef = useRef<VolumetricScene | null>(null);
  const volBusyRef = useRef(false);
  const volFailedRef = useRef<string | null>(null);
  const volKeyRef = useRef('');
  const volSizeRef = useRef('');
  const bufSizeRef = useRef('');
  const isSnapshottingRef = useRef(false);
  /** §160 가장 가까운 공항 METAR(10 분마다). 오면 볼륨 장면 키를 비워 다시 만들게 합니다. */
  const metarRef = useRef<MetarObs | null>(null);
  /** 주변 공항 여러 곳의 최근 보고 — 거시 운량 고리 보정(liveScene `metars`). */
  const metarsRef = useRef<MetarObs[]>([]);
  /** 장면·시선이 바뀐 뒤 시간 누적(1/16 화소씩)이 차도록 더 그릴 프레임 수 */
  const volSettleRef = useRef(0);
  /** 정착 뒤 다듬기 프레임 남은 수(`VOL_REFINE_FRAMES`) — 움직이면 멈추고 다음 정착 끝에서 다시 채움. */
  const volRefineRef = useRef(0);
  const volRefineStartRef = useRef(0);
  const volAccumOnRef = useRef(false);
  const volViewRef = useRef('');
  /** §127 첫 장면이 걸리기 전에는 볼륨 하늘을 쓰지 않습니다(날씨를 잘라 만드는 동안 예전 하늘). */
  const volHasSceneRef = useRef(false);
  const lastVolSceneRef = useRef<VolumetricSceneState | null>(null);   // §165 마지막 적용 장면(QR)
  const volFreshRef = useRef(false);   // §165 마지막 적용 장면이 한 프레임 이상 실제로 그려졌는가(적용 직후 스냅샷은 옛 장면)
  /** §129 지난 프레임에 볼륨 하늘을 깔았는가 — 바다 쌍둥이(거리·빛 판)는 그때만 그립니다(평소 구름 슬랩의 가림을 바꾸지 않게). */
  const volDrewRef = useRef(false);
  const volPendingRef = useRef(false);
  const volBuildSeqRef = useRef(0);
  const prewarmedDayKeyRef = useRef('');
  const prewarmCancelRef = useRef<(() => void) | null>(null);
  const volGovRef = useRef<ResolutionGovernor | null>(null);
  const volQualityRef = useRef('');
  const pixelRatioRef = useRef(1);
  const sceneWidthRef = useRef(SCENE_WIDTH);
  const layoutSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const glScaleRef = useRef<number>(PixelRatio.get() || 1);
  const syncGlDrawingBufferSize = (gl: ExpoWebGLRenderingContext | null) => {
    if (!gl) return;
    const lw = layoutSizeRef.current.w;
    const lh = layoutSizeRef.current.h;
    if (lw <= 0 || lh <= 0) return;
    const scale = glScaleRef.current > 0 ? glScaleRef.current : (PixelRatio.get() || 1);
    const nextW = Math.max(1, Math.round(lw * scale));
    const nextH = Math.max(1, Math.round(lh * scale));
    if (gl.drawingBufferWidth !== nextW || gl.drawingBufferHeight !== nextH) {
      (gl as any).drawingBufferWidth = nextW;
      (gl as any).drawingBufferHeight = nextH;
    }
  };

  const timelineRef = useRef<SkyTimeline | null>(timeline);
  const isActiveRef = useRef(isActive);
  /** 촬영 화면이 빌려 쓰는 동안의 시선(renderRemote / renderLongExposure). 있으면 비활성이어도 그리고, 이 시선을 씁니다. */
  const remoteViewRef = useRef<{ az: number; el: number; fov: number; rollDeg?: number } | null>(null);
  const remoteFramesRef = useRef(0);
  /** 장노출 시뮬레이션 동안 씬 시각을 스텝마다 고정 덮어쓰기 */
  const overrideSceneTimeMsRef = useRef<number | null>(null);
  /** 장노출 시뮬레이션 동안 별 밝기 추가 배율 */
  const starBoostOverrideRef = useRef<number>(1);
  /** 장노출 누적 패스 지시자 (animate 루프가 한 스텝씩 처리) */
  const accumDirectiveRef = useRef<{
    begin?: boolean;
    captureStep?: { weight: number; fixedBase: boolean; lighten?: boolean };
    pendingResolve?: { gain: number; shadowLift: number; fixedGround: boolean };
    onDone?: () => void;
  } | null>(null);
  const liveAccumRef = useRef<{
    started: boolean;
    lighten: boolean;
    exposureGain: number;
    shadowLift: number;
  } | null>(null);
  const isSlidingRef = useRef(isSliding);
  const trackingTargetRef = useRef(trackingTarget);
  const onSelectTrackingTargetRef = useRef(onSelectTrackingTarget);
  const lastTrackingHudSyncMsRef = useRef(0);
  const trackingActiveUntilRef = useRef(0);
  const lastVolContWallMsRef = useRef(0);
  const scrubSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetTimeMsRef = useRef(currentTime.getTime());
  const lastSyncedPropTimeMsRef = useRef<number | null>(null);
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
  /** 카메라 회전·줌 중 시간 무관 CPU/리렌더 스로틀링용 캐시 */
  const sceneDirtyRef = useRef<boolean>(true);
  const lastUpdateSceneTimeMsRef = useRef<number>(-1e15);
  const lastUpdateSceneWallMsRef = useRef<number>(0);
  const lastAppliedTuningRef = useRef<unknown>(null);
  const locationRef = useRef(location);
  const nightLightsRef = useRef<NightLights | null>(getCachedNightLights());
  const lastCityPatchRef = useRef<{ field: TerrainFieldHandle; patch: Float32Array | null } | null>(null);
  const cachedCityFieldRef = useRef<{
    map: NightLights | null;
    key: string;
    field: CityLightField;
    dir: { x: number; z: number };
  } | null>(null);
  const getCachedCityField = (lat: number, lon: number) => {
    const m = nightLightsRef.current;
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    const hit = cachedCityFieldRef.current;
    if (hit && hit.map === m && hit.key === key) return hit;
    const pre = getPrehydratedCityLightField(lat, lon);
    if (!m && !pre) return null;
    const field = pre ?? cityLightField(m!, lat, lon);
    const dir = cityGlowDirection(field.azGain);
    const next = { map: m, key, field, dir };
    cachedCityFieldRef.current = next;
    return next;
  };
  const cityExpCompRef = useRef<number>(1);
  const overrideStartBucketMsRef = useRef<number | null>(null);
  const cachedLightEstRef = useRef<{ key: string; est: LightPollutionEstimate } | null>(null);
  const getLightEst = (lat: number, lon: number): LightPollutionEstimate | null => {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (cachedLightEstRef.current?.key === key) return cachedLightEstRef.current.est;
    const pre = getPrehydratedLightPollution(lat, lon);
    if (pre) {
      cachedLightEstRef.current = { key, est: pre };
      return pre;
    }
    const m = nightLightsRef.current;
    if (!m) return null;
    const est = estimateLightPollution(m, lat, lon);
    cachedLightEstRef.current = { key, est };
    return est;
  };
  const lastCityLightValRef = useRef<number>(-1);
  const lastVolCityLightRef = useRef<number>(-1);
  const lastVolDateSyncRef = useRef<VolDateSyncState>({ targetMs: null, wallMs: 0 });
  const lastVolContMinRef = useRef<number | null>(null);
  const prevLabelsRef = useRef<Array<{ id: string; name: string; x: number; y: number; color: string }>>([]);
  const lastSentAzElevRef = useRef<{ az: number; el: number }>({ az: -999, el: -999 });
  const volInteractingRef = useRef<boolean>(false);

  /** 렌더링 요청: 화면 변화 시 루프를 깨우고 지정 프레임 수만큼 렌더링 후 자동 슬립 */
  const requestRender = useCallback((frames = 4) => {
    framesToRenderRef.current = Math.max(framesToRenderRef.current, frames);
    if (!isLoopRunningRef.current && (isActiveRef.current || remoteViewRef.current) && glRef.current) {
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
    if (p <= P_FOV_END) {
      fovRef.current = (30 + p * 90) / teleRef.current;
    } else if (teleRef.current > 1) {
      teleRef.current = 1;
      onChangeTelephotoRef.current?.(1);
    }
    const { w, h } = viewSizeRef.current;
    const aspect = w / h;
    // 3D 가 보이는 동안 지도 한가운데는 관측점(카메라 바로 아래). 지도에서 줌인하면
    // 넘기는 점에 닿을 때 관측점으로 돌아오게 조금씩 데려옵니다.
    if (p <= P_FADE_START) mapCenterRef.current = { ...homeRef.current };
    else if (!opts.keepCenter) mapCenterRef.current = homeCenterStep(mapCenterRef.current, homeRef.current, prev, p);
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
      if (Math.abs(target - from) >= 1e-6) {
        applyZoomProgress(from, { force: true, keepCenter: true });
      }
      return;
    }
    const t0 = performance.now();
    const step = () => {
      const now = performance.now();
      const t = Math.max(0, Math.min(1, (now - t0) / duration));
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
    const step = () => {
      const now = performance.now();
      const t = Math.max(0, Math.min(1, (now - t0) / durationMs));
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
      sceneDirtyRef.current = true;
      requestRender(12);
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
      if (scrubSettleTimerRef.current) {
        clearTimeout(scrubSettleTimerRef.current);
        scrubSettleTimerRef.current = null;
      }
      // 슬라이더에서 손을 떼는 순간: 드래그 중 예약된 레거시 구름 타이머(180ms)가 뒤늦게 터지지 않게 즉시 플러시합니다.
      if (cloudRebuildTimerRef.current) {
        clearTimeout(cloudRebuildTimerRef.current);
        cloudRebuildTimerRef.current = null;
        lastCloudSceneMsRef.current = -1e15;
      }
      sceneDirtyRef.current = true;
      lastTargetSyncPerfRef.current = performance.now();
      if (volPendingRef.current) {
        // 비동기 빌드가 이미 대기 중이면 완료 후 1회만 수렴하도록 옛 구름 재수렴을 돌리지 않습니다.
        volSettleRef.current = 0;
        requestRender(1);
      } else {
        volSettleRef.current = Math.max(volSettleRef.current, 18);
        requestRender(4);
      }
    }
  }, [isSliding, requestRender]);

  // 볼륨 하늘 실시간 구름 유영 및 LIVE 시계 진행: 현재시간 자동재생 중일 때만 1초 간격으로 가볍게 갱신합니다.
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      const st = useCelestialStore.getState();
      const isLiveNow = !st.isTimeMachineEnabled && Math.abs(targetTimeMsRef.current - Date.now()) <= 60_000;
      if (
        isLiveNow &&
        volRef.current &&
        !isSlidingRef.current &&
        !volPendingRef.current &&
        volSettleRef.current <= 0 &&
        !st.isGestureBlocked
      ) {
        requestRender(1);
      }
    }, 1000);
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
  /** 지금 눈 위치의 지형 틀(지반 표본). 이 자리의 지형이 아직 안 왔으면 null. */
  const groundFrame = () => {
    const renderer = rendererRef.current, patch = demPatchRef.current, here = eyeCoords();
    if (!renderer || !patch || !here) return null;
    // 받아 둔 블록이 눈 둘레를 덮는 동안만(옛 "받은 키 = 위치 키" 검사를 눈 이동에 맞게 바꿈).
    if (!blockCovers(patch, here.latitude, here.longitude, denseRadiusM(patch), 0)) return null;
    const ground = sceneHeightSampler(renderer, patch, demMaskPatchRef.current);
    if (!ground) return null;
    return { ground };
  };
  // 땅 프로필: 지형 패치 번호와 눈 높이가 같은 동안은 다시 만들지 않습니다(40 km 프로필은 샘플 십수만 번).
  horizonCacheRef.current = () => {
    const renderer = rendererRef.current, patch = demPatchRef.current;
    if (!renderer || !patch) return null;
    const sample = sceneHeightSampler(renderer, patch, demMaskPatchRef.current);
    if (!sample) return null;
    const ground = sample(0, 0) ?? simRef.current?.terrain?.observerElevation ?? 0;
    const eye = ground + (eyeHeightRef.current ?? 1.6);
    const key = `${demSerialRef.current}|${eye.toFixed(1)}`;
    if (skylineCacheRef.current?.key === key) return skylineCacheRef.current;
    const prof = buildHorizonProfile(sample, eye, { maxDistM: 40000 });
    const fn = (az: number) => { const v = skylineAngleDeg(prof, az); return v > -89 ? v : null; };
    return (skylineCacheRef.current = { key, prof, fn });
  };
  useImperativeHandle(ref, () => { const h = ({
    renderRemote: null as unknown as SkyScene3DHandle['renderRemote'],
    getLastSnapshotError: () => lastSnapshotErrorRef.current,
    getLastBufferMean: () => lastBufferMeanRef.current,
    flyToMap: () => flyToMapRef.current(),
    setCameraView: (
      azDeg: number,
      elDeg: number,
      fovDeg?: number,
      opts?: { rollDeg?: number; centerOffsetYFrac?: number },
    ) => {
      if (overrideSceneTimeMsRef.current !== null || remoteViewRef.current !== null) return;
      cameraAzRef.current = ((azDeg % 360) + 360) % 360;
      setCameraAzimuth(cameraAzRef.current);
      cameraElevRef.current = Math.max(-45, Math.min(85, elDeg));
      setCameraElevation(cameraElevRef.current);
      if (fovDeg !== undefined && Number.isFinite(fovDeg)) {
        fovRef.current = Math.max(10, Math.min(120, fovDeg));
        zoomProgressRef.current = Math.max(0, Math.min(P_FOV_END, (fovRef.current - 30) / 90));
        if (cameraRef.current) {
          cameraRef.current.fov = fovRef.current;
          cameraRef.current.updateProjectionMatrix();
        }
        setCameraFov(fovRef.current);
      } else if (zoomProgressRef.current > P_FOV_END) {
        zoomProgressRef.current = (fovRef.current * teleRef.current - 30) / 90;
      }
      if (opts?.rollDeg !== undefined && Number.isFinite(opts.rollDeg)) {
        cameraRollRef.current = opts.rollDeg;
      }
      if (opts?.centerOffsetYFrac !== undefined && Number.isFinite(opts.centerOffsetYFrac)) {
        const nextOff = Math.max(-0.45, Math.min(0.45, opts.centerOffsetYFrac));
        viewCenterOffsetYFracRef.current = nextOff;
        if (cameraRef.current) {
          if (Math.abs(nextOff) > 1e-4) {
            const aw = 1000 * (cameraRef.current.aspect || 1);
            cameraRef.current.setViewOffset(aw, 1000, 0, nextOff * 1000, aw, 1000);
          } else if (cameraRef.current.view?.enabled) {
            cameraRef.current.clearViewOffset();
          }
        }
      }
      trackingTargetRef.current = null;
      onSelectTrackingTargetRef.current?.(null);
      requestRender(8);
    },
    loadFarBuildings: async (opts) => {
      const renderer = rendererRef.current, patch = demPatchRef.current, field = buildingFieldRef.current;
      const { lat, lng } = bldCenterRef.current;
      if (!renderer || !patch || !field) return null;
      const sample = sceneHeightSampler(renderer, patch, demMaskPatchRef.current);
      if (!sample) return null;
      const ground = sample(0, 0) ?? simRef.current?.terrain?.observerElevation ?? 0;
      const eye = ground + (eyeHeightRef.current ?? 1.6);
      const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
      if (farLocKeyRef.current !== key) { farTilesRef.current = new Map(); farLocKeyRef.current = key; }
      // 보는 방향: 카메라 방위 ± (가로 화각 / 2 + 6°). 가로 화각은 세로 화각과 화면 비로 구합니다.
      const { w, h } = layoutSizeRef.current;
      const hfov = (2 * Math.atan(Math.tan((fovRef.current * Math.PI) / 360) * (w > 0 && h > 0 ? w / h : 1)) * 180) / Math.PI;
      const sector = { azDeg: cameraAzRef.current, halfWidthDeg: Math.min(90, hfov / 2 + 6) };
      farAbortRef.current?.abort();
      const ctl = new AbortController();
      farAbortRef.current = ctl;
      const res = await loadFarBuildings({ lat, lon: lng, eyeM: eye, sample, sector, existing: farTilesRef.current, signal: ctl.signal, onProgress: opts?.onProgress });
      if (ctl.signal.aborted) return null;
      const merged = mergeBuildings(nearBuildingDataRef.current, farTilesRef.current, lat, lng);
      mergedBuildingRef.current = merged;
      field.setBuildings(merged);
      demSerialRef.current += 1;
      volSettleRef.current = Math.max(volSettleRef.current, 18);
      sceneDirtyRef.current = true;
      requestRender(10);
      let buildings = 0;
      for (const t of farTilesRef.current.values()) buildings += t.picks.length;
      return { planned: res.plan.tiles.length, fetched: res.fetched, failed: res.failed, bytes: res.bytes, truncated: res.truncated, tilesTotal: farTilesRef.current.size, buildings: Math.min(buildings, FAR_MAX_BUILDINGS_SHOWN) };
    },
    getSkyline: () => horizonCache()?.fn ?? null,
    getHorizonProfile: () => horizonCache()?.prof ?? null,
    targetFromLatLon: (latitude, longitude, elevM) => {
      const f = groundFrame();
      const here = eyeCoords();
      if (!f || !here) return null;
      const ground = f.ground(0, 0) ?? simRef.current?.terrain?.observerElevation ?? 0;
      const eye = ground + (eyeHeightRef.current ?? 1.6);
      const o = localOffsetM(here, latitude, longitude);
      return { ...targetPointAt(f.ground, eye, o.eastM, -o.northM, elevM, (e, z) => offsetLatLon(here.latitude, here.longitude, e, -z)), eyeElevM: eye };
    },
    setEyeLocation: (latitude, longitude) => {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      eyeRef.current = { latitude, longitude };
      const here = locationRef.current?.coords;
      const off = here ? localOffsetM(here, latitude, longitude) : null;
      eyeMovingRef.current = !off || Math.hypot(off.eastM, off.northM) > 0.5;
      applyEye();
      // 눈이 받아 둔 블록의 가운데 타일(촘촘한 패치가 둘레 반경을 보장하는 자리)을 벗어나면 그 자리의 블록으로 바꿉니다.
      const patch = demPatchRef.current;
      if (patch && Date.now() >= demRecenterAfterRef.current && !blockCovers(patch, latitude, longitude, denseRadiusM(patch), 0)) {
        void loadDemForRef.current(latitude, longitude, `${latitude.toFixed(3)},${longitude.toFixed(3)}`, () => false);
      }
    },
    clearEyeLocation: () => {
      eyeRef.current = null;
      eyeMovingRef.current = false;
      applyEye();
    },
    getEyeState: (): EyeState => {
      const pick = (u: Record<string, { value: unknown }> | undefined, k: string): [number, number] | null => {
        const v = u?.[k]?.value as { x?: number; y?: number } | undefined;
        return v && typeof v.x === 'number' && typeof v.y === 'number' ? [v.x, v.y] : null;
      };
      const tu = terrainFieldRef.current?.material.uniforms, su = seaPlaneRef.current?.material.uniforms;
      const d = demPatchRef.current;
      return {
        eye: eyeRef.current,
        moving: eyeMovingRef.current,
        obs: { terrain: pick(tu, 'uDemObs'), terrainEye: pick(tu, 'uDemEyeObs'), terrainFar: pick(tu, 'uDemFarObs'), sea: pick(su, 'uDemObs'), seaMask: pick(su, 'uSeaMaskObs') },
        block: d ? { zoom: d.zoom, originTileX: d.originTileX, originTileY: d.originTileY, blockTiles: d.blockTiles, tileSpanM: d.tileSpanM } : null,
      };
    },
    getBuildingProgress: (): LoadProgress => ({ ...buildingProgressRef.current }),
    clearCameraLensOverride: () => {
      cameraRollRef.current = 0;
      viewCenterOffsetYFracRef.current = 0;
      if (cameraRef.current?.view?.enabled) {
        cameraRef.current.clearViewOffset();
      }
      requestRender(3);
    },
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
        : VOLUMETRIC_SKY_ENABLED ? 'creating' : 'off';
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
    takeSnapshot: null as unknown as SkyScene3DHandle['takeSnapshot'],
  }) as SkyScene3DHandle;

    const captureGlSnapshot = async (
      drawOnce: () => void,
      options: { format?: 'jpeg' | 'png'; compress?: number } = { format: 'jpeg', compress: 0.85 },
    ): Promise<string | null> => {
      lastSnapshotErrorRef.current = null;
      isSnapshottingRef.current = true;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }
      isLoopRunningRef.current = false;
      try {
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
            syncGlDrawingBufferSize(glRef.current);
            const dw = glRef.current.drawingBufferWidth;
            const dh = glRef.current.drawingBufferHeight;
            const bufKey = `${dw}x${dh}`;
            if (dw > 0 && dh > 0 && bufKey !== bufSizeRef.current) {
              bufSizeRef.current = bufKey;
              rendererRef.current.setSize(dw, dh, false);
              rendererRef.current.setViewport(0, 0, dw, dh);
              rendererRef.current.setScissor(0, 0, dw, dh);
              rendererRef.current.setScissorTest(false);
              cameraRef.current.aspect = dw / Math.max(1, dh);
              cameraRef.current.updateProjectionMatrix();
              composerRef.current?.setSize(dw, dh);
              volRef.current?.setSize(dw, dh);
              volSizeRef.current = bufKey;
              pixelRatioRef.current = Math.max(1, dw / Math.max(1, sceneWidthRef.current));
            }
            // ⚠ 두 번 그립니다. takeSnapshotAsync 가 앞버퍼를 읽는지 뒷버퍼를 읽는지는 expo-gl 구현에 달렸고
            //   기기 없이는 못 정합니다. 한 번 그려 넘기고 한 번 더 그리면 어느 쪽을 읽든 최신 프레임입니다.
            drawOnce();
            glRef.current.endFrameEXP();
            drawOnce();
            glRef.current.flush();

            let bufMean = -1;
            try {
              const g = glRef.current;
              const w = g.drawingBufferWidth, ch = g.drawingBufferHeight;
              const n = 32;
              const px = new Uint8Array(n * n * 4);
              g.readPixels(Math.max(0, (w >> 1) - (n >> 1)), Math.max(0, (ch >> 1) - (n >> 1)),
                           n, n, g.RGBA, g.UNSIGNED_BYTE, px);
              let sum = 0;
              for (let i = 0; i < n * n; i++) {
                sum += 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
              }
              bufMean = sum / (n * n);
            } catch (_) { /* readPixels 를 못 해도 스냅샷은 계속합니다 */ }
            lastBufferMeanRef.current = bufMean;

            // 웹(하네스·expo web): takeSnapshotAsync 가 빈 주소를 돌려주므로 방금 그린 캔버스를 바로 읽습니다(같은 작업 안이라 지워지기 전).
            const webCanvas = Platform.OS === 'web' ? (glRef.current as { canvas?: { toDataURL?: (t: string, q?: number) => string } }).canvas : undefined;
            if (webCanvas?.toDataURL) {
              const dataUri = webCanvas.toDataURL(options.format === 'png' ? 'image/png' : 'image/jpeg', options.compress ?? 0.85);
              if (dataUri && dataUri.length > 64) return dataUri;
            }
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
      } finally {
        isSnapshottingRef.current = false;
      }
    };

    h.takeSnapshot = (options = { format: 'jpeg', compress: 0.85 }) =>
      captureGlSnapshot(() => {
        const composer = composerRef.current;
        if (composer) {
          composer.render(rendererRef.current as unknown as THREE.WebGLRenderer, sceneRef.current!, cameraRef.current!);
        } else if (cameraRef.current && rendererRef.current && sceneRef.current) {
          cameraRef.current.layers.enableAll();
          rendererRef.current.setRenderTarget(null);
          rendererRef.current.render(sceneRef.current, cameraRef.current);
        }
      }, options);

    // 촬영 화면용: 이 장면을 잠깐 다른 시선으로 그려 한 장(primarySky.ts). 그리는 동안 원래 시선·줌을 맡겨 두었다가 되돌립니다.
    // 한 번에 하나씩(미리보기와 셔터가 겹치면 앞 것이 끝난 뒤) — 겹치면 한쪽의 되돌리기가 다른 쪽 시선을 지움.
    let remoteChain: Promise<unknown> = Promise.resolve();
    const renderRemoteOnce: SkyScene3DHandle['renderRemote'] = async (view, opts = {}) => {
      const waitMs = opts.waitMs ?? 3000;
      const wasActive = isActiveRef.current;
      const saved = { az: cameraAzRef.current, el: cameraElevRef.current, fov: fovRef.current, zoom: zoomProgressRef.current };
      remoteViewRef.current = view;
      remoteFramesRef.current = 0;
      zoomProgressRef.current = 0;
      try {
        const t0 = Date.now();
        // 시선을 건 뒤 적어도 REMOTE_SETTLE_FRAMES 프레임은 그리고, 볼륨 하늘이 준비되면 찍습니다.
        // 2026-11-13 예전 3 프레임: 구름은 takram 시간 누적(4×4 = 16 프레임에 한 바퀴)으로 완성되는데, 시선을 크게 옮긴 직후라
        // 가장자리가 덜 쌓여 점점이 부서지고 테두리가 생겼음(수원 촬영 예측; 웹 재현 3·8 프레임 얼룩, 30 프레임 깨끗).
        for (;;) {
          requestRender(3);
          await new Promise(r => setTimeout(r, 60));
          const ready = h.isVolumetricReady();
          if (remoteFramesRef.current >= REMOTE_SETTLE_FRAMES && ready) break;
          if (Date.now() - t0 > waitMs) {
            // 볼륨 하늘이 준비됐는데 프레임만 덜 쌓였으면 그대로 찍습니다(느린 폰에서 "준비 안 됨" 으로 버리지 않게).
            if (!ready && opts.requireReady !== false) return { uri: null, ready: false, error: null, state: h.getRenderState() };
            break;
          }
        }
        const state = h.getRenderState();
        const uri = await h.takeSnapshot({ format: opts.format ?? 'jpeg', compress: opts.compress ?? 0.85 });
        return { uri, ready: h.isVolumetricReady(), error: uri ? null : lastSnapshotErrorRef.current, state };
      } finally {
        remoteViewRef.current = null;
        cameraAzRef.current = saved.az; cameraElevRef.current = saved.el; zoomProgressRef.current = saved.zoom;
        if (Math.abs(fovRef.current - saved.fov) > 0.01 && cameraRef.current) { fovRef.current = saved.fov; cameraRef.current.fov = saved.fov; cameraRef.current.updateProjectionMatrix(); }
        if (!wasActive && !isActiveRef.current) { isLoopRunningRef.current = false; if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = 0; } }
        else requestRender(2);
      }
    };
    h.renderRemote = (view, opts) => {
      const run = remoteChain.then(() => renderRemoteOnce(view, opts));
      remoteChain = run.catch(() => undefined);
      return run;
    };

    let latestLongExpToken = 0;
    let activeLongExpCancel: (() => void) | null = null;

    const runRenderStep = (directive: {
      begin?: boolean;
      captureStep?: { weight: number; fixedBase: boolean };
      pendingResolve?: { gain: number; shadowLift: number; fixedGround: boolean };
    }, registerCancel?: (fn: (() => void) | null) => void) => new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        registerCancel?.(null);
        resolve();
      };
      const timer = setTimeout(() => {
        if (accumDirectiveRef.current?.onDone === done) accumDirectiveRef.current = null;
        done();
      }, 2000);
      registerCancel?.(() => {
        if (accumDirectiveRef.current?.onDone === done) accumDirectiveRef.current = null;
        done();
      });
      accumDirectiveRef.current = { ...directive, onDone: done };
      requestRender(2);
    });

    const renderLongExposureOnce = async (
      view: { az: number; el: number; fov: number; rollDeg?: number },
      opts: LongExposureSimOptions,
      token: number,
    ): Promise<LongExposureSimResult> => {
      const mode = opts.mode;
      const startTimeMs = opts.startTimeMs ?? targetTimeMsRef.current;
      const durationSec = Math.max(10, Math.min(3600, opts.durationSec ?? 300));
      const steps = Math.max(4, Math.min(192, Math.round(opts.steps ?? 20)));
      const exposureGain = opts.exposureGain ?? Number((1 + Math.log2(1 + durationSec / 90) * 0.72).toFixed(2));
      const shadowLift = opts.shadowLift ?? 0.015;
      const starBoost = opts.starBoost ?? 1.25;
      const settleFrames = Math.max(1, Math.min(REMOTE_SETTLE_FRAMES, Math.round(opts.settleFrames ?? REMOTE_SETTLE_FRAMES)));
      const requireReady = opts.requireReady ?? true;
      const waitMs = opts.waitMs ?? 5000;

      const isCancelled = () => token !== latestLongExpToken || !!opts.signal?.aborted;
      const cancelledResult = (): LongExposureSimResult => ({
        uri: null,
        ready: false,
        error: 'aborted',
        mode,
        durationSec,
        steps,
        exposureGain,
        state: null,
      });

      if (isCancelled()) return cancelledResult();

      let cancelCurrentWait: (() => void) | null = null;
      const cancelHook = () => {
        cancelCurrentWait?.();
        cancelCurrentWait = null;
      };
      activeLongExpCancel = cancelHook;
      const onSignalAbort = () => cancelHook();
      opts.signal?.addEventListener('abort', onSignalAbort, { once: true });

      const wasActive = isActiveRef.current;
      const saved = {
        az: cameraAzRef.current,
        el: cameraElevRef.current,
        fov: fovRef.current,
        zoom: zoomProgressRef.current,
      };
      const baseAttitude = {
        yawDeg: view.az,
        pitchDeg: view.el,
        rollDeg: view.rollDeg ?? 0,
      };
      const lat = locationRef.current?.coords?.latitude ?? 37.5;
      const lon = locationRef.current?.coords?.longitude ?? 127.0;
      const startDate = new Date(startTimeMs);

      overrideStartBucketMsRef.current = Math.floor(startTimeMs / 3600000) * 3600000 + 1800000;
      overrideSceneTimeMsRef.current = startTimeMs;
      starBoostOverrideRef.current = starBoost;
      hidePathsForExposureRef.current = true;
      if (celestialPathsRef.current) celestialPathsRef.current.containerGroup.visible = false;
      remoteViewRef.current = { ...view };
      remoteFramesRef.current = 0;
      zoomProgressRef.current = 0;
      sceneDirtyRef.current = true;

      try {
        const t0 = Date.now();
        for (;;) {
          if (isCancelled()) return cancelledResult();
          requestRender(3);
          await new Promise<void>(r => {
            const t = setTimeout(() => { cancelCurrentWait = null; r(); }, 60);
            cancelCurrentWait = () => { clearTimeout(t); cancelCurrentWait = null; r(); };
          });
          if (isCancelled()) return cancelledResult();
          const ready = h.isVolumetricReady();
          if (remoteFramesRef.current >= settleFrames && (ready || !requireReady)) break;
          if (Date.now() - t0 > waitMs) {
            if (requireReady && !ready) {
              return {
                uri: null,
                ready: false,
                error: '볼륨 하늘 준비 시간 초과',
                mode,
                durationSec,
                steps,
                exposureGain,
                state: h.getRenderState(),
              };
            }
            break;
          }
        }

        if (isCancelled()) return cancelledResult();
        if (!composerRef.current) {
          return {
            uri: null,
            ready: false,
            error: 'SceneComposer 준비 안 됨',
            mode,
            durationSec,
            steps,
            exposureGain,
            state: h.getRenderState(),
          };
        }

        cityExpCompRef.current = Math.pow(Math.max(1, exposureGain), 0.65) / Math.max(1, exposureGain);
        volRef.current?.setCityTerrainExpScale?.(cityExpCompRef.current);
        volRef.current?.setAccumulating?.(true);
        for (let k = 0; k < steps; k++) {
          if (isCancelled()) return cancelledResult();
          const frac = steps <= 1 ? 0 : k / (steps - 1);
          const tkMs = startTimeMs + frac * durationSec * 1000;
          overrideSceneTimeMsRef.current = tkMs;
          sceneDirtyRef.current = true;

          if (mode === 'trails') {
            remoteViewRef.current = { ...view };
          } else {
            // 적도의 추적: 기준 시각(startDate)의 하늘 시선·업벡터를 지구 자전에 맞춰 따라갑니다.
            const tracked = computeTrackedAttitudeAt(baseAttitude, startDate, new Date(tkMs), lat, lon);
            remoteViewRef.current = {
              az: tracked.yawDeg,
              el: tracked.pitchDeg,
              fov: view.fov,
              rollDeg: tracked.rollDeg,
            };
          }

          await runRenderStep(
            {
              begin: k === 0,
              captureStep: {
                weight: 1,
                fixedBase: k === 0 && mode === 'tracked_fixed_ground',
              },
            },
            (fn) => { cancelCurrentWait = fn; },
          );
          if (isCancelled()) return cancelledResult();
        }

        if (isCancelled()) return cancelledResult();
        const useFixedGround = mode === 'tracked_fixed_ground';
        const state = h.getRenderState();
        const uri = await captureGlSnapshot(() => {
          if (composerRef.current && rendererRef.current) {
            composerRef.current.resolveAccumulation(
              rendererRef.current as unknown as THREE.WebGLRenderer,
              { exposureGain, shadowLift, useFixedGround },
            );
          }
        }, { format: opts.format ?? 'jpeg', compress: opts.compress ?? 0.9 });

        if (isCancelled()) return cancelledResult();
        return {
          uri,
          ready: true,
          error: uri ? null : lastSnapshotErrorRef.current,
          mode,
          durationSec,
          steps,
          exposureGain,
          state,
        };
      } finally {
        opts.signal?.removeEventListener('abort', onSignalAbort);
        if (activeLongExpCancel === cancelHook) activeLongExpCancel = null;
        cancelCurrentWait = null;
        cityExpCompRef.current = 1;
        volRef.current?.setCityTerrainExpScale?.(1);
        volRef.current?.setAccumulating?.(false);
        overrideStartBucketMsRef.current = null;
        accumDirectiveRef.current = null;
        composerRef.current?.endAccumulation();
        overrideSceneTimeMsRef.current = null;
        starBoostOverrideRef.current = 1;
        hidePathsForExposureRef.current = false;
        if (celestialPathsRef.current) celestialPathsRef.current.containerGroup.visible = layersRef.current.paths;
        remoteViewRef.current = null;
        sceneDirtyRef.current = true;
        cameraAzRef.current = saved.az;
        cameraElevRef.current = saved.el;
        zoomProgressRef.current = saved.zoom;
        if (Math.abs(fovRef.current - saved.fov) > 0.01 && cameraRef.current) {
          fovRef.current = saved.fov;
          cameraRef.current.fov = saved.fov;
          cameraRef.current.updateProjectionMatrix();
        }
        if (!wasActive && !isActiveRef.current) {
          isLoopRunningRef.current = false;
          if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = 0; }
        } else {
          requestRender(3);
        }
      }
    };

    h.cancelLongExposure = () => {
      latestLongExpToken += 1;
      activeLongExpCancel?.();
    };

    h.renderLongExposure = (view, opts) => {
      const token = ++latestLongExpToken;
      // 진행 중이던 이전 장노출 작업을 즉시 중단시켜 큐 대기를 없앱니다.
      activeLongExpCancel?.();
      const run = remoteChain.then(() => renderLongExposureOnce(view, opts, token));
      remoteChain = run.catch(() => undefined);
      return run;
    };
    h.beginLiveAccum = (opts) => {
      liveAccumRef.current = {
        started: false,
        lighten: !!opts?.lighten,
        exposureGain: opts?.exposureGain ?? 1.25,
        shadowLift: opts?.shadowLift ?? 0.012,
      };
      starBoostOverrideRef.current = opts?.starBoost ?? 1.35;
      hidePathsForExposureRef.current = true;
      if (celestialPathsRef.current) celestialPathsRef.current.containerGroup.visible = false;
      volRef.current?.setAccumulating?.(true);
    };
    h.stepLiveAccum = (timeMs) => {
      const live = liveAccumRef.current;
      if (!live) return;
      const begin = !live.started;
      live.started = true;
      overrideSceneTimeMsRef.current = timeMs;
      sceneDirtyRef.current = true;
      accumDirectiveRef.current = {
        begin,
        captureStep: { weight: 1, fixedBase: false, lighten: live.lighten },
        pendingResolve: { gain: live.exposureGain, shadowLift: live.shadowLift, fixedGround: false },
      };
      requestRender(1);
    };
    h.endLiveAccum = () => {
      liveAccumRef.current = null;
      accumDirectiveRef.current = null;
      overrideSceneTimeMsRef.current = null;
      starBoostOverrideRef.current = 1;
      hidePathsForExposureRef.current = false;
      if (celestialPathsRef.current) celestialPathsRef.current.containerGroup.visible = layersRef.current.paths;
      volRef.current?.setAccumulating?.(false);
      composerRef.current?.endAccumulation();
      sceneDirtyRef.current = true;
      requestRender(3);
    };
    return h;
  }, [requestRender]);
  useEffect(() => {
    if (!registerPrimary) return;
    const h = (ref as React.MutableRefObject<SkyScene3DHandle | null> | null)?.current ?? null;
    setPrimarySky(h);
    return () => { if (getPrimarySky() === h) setPrimarySky(null); };
  }, [registerPrimary, ref]);

  // ── 성능 캐시 ref ──────────────────────────────────────────────────────────
  /** makeAtmosphereParams 결과 캐시 (2분 간격) */
  const cachedAtmosphereRef = useRef<ReturnType<typeof makeAtmosphereParams> | null>(null);
  const cachedAtmosphereMsRef = useRef(0);
  /** buildPlanetPoints 결과 캐시 (30초 간격) */
  const cachedPlanetPointsRef = useRef<ReturnType<typeof buildPlanetPoints> | null>(null);
  const cachedPlanetPointsMsRef = useRef(0);
  /** 달빛·광공해가 깎은 실효 한계등급 캐시 */
  const cachedMoonMagLimitRef = useRef(6.5);
  const cachedMoonMagMsRef = useRef(0);
  const cachedMoonBaseMagRef = useRef(Number.NaN);
  /** updateCelestialPaths 마지막 갱신 시각 (30초 간격) */
  const sunDiscRadiusDegRef = useRef(0.267);
  const lastCelestialPathsMsRef = useRef(0);
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
  useEffect(() => { skySettingsRef.current = skySettings; sceneDirtyRef.current = true; lastAppliedTuningRef.current = null; requestRender(3); }, [skySettings, requestRender]);
  useEffect(() => { sunAltRef.current = sunAltitude; sceneDirtyRef.current = true; requestRender(3); }, [sunAltitude, requestRender]);
  useEffect(() => { sunAzRef.current = sunAzimuth; sceneDirtyRef.current = true; requestRender(3); }, [sunAzimuth, requestRender]);
  useEffect(() => { predictionRef.current = prediction; sceneDirtyRef.current = true; requestRender(3); }, [prediction, requestRender]);
  useEffect(() => { simRef.current = sim; sceneDirtyRef.current = true; requestRender(3); }, [sim, requestRender]);
  useEffect(() => { weatherRef.current = interpolatedWeather; sceneDirtyRef.current = true; requestRender(3); }, [interpolatedWeather, requestRender]);
  useEffect(() => {
    locationRef.current = location;
    // 위치 **좌표**가 새로 정해지면(조이스틱이 멈춰 커밋했거나, 다른 곳을 골랐거나) 눈은 다시 위치를 따릅니다. 커밋이면 눈의 자리와 같아 화면이 안 튑니다.
    // 같은 좌표로 객체만 새로 온 것(위치 갱신의 시각 도장, 웹 하네스의 매 렌더 새 객체)은 움직이는 눈을 되돌리지 않습니다.
    const c = location?.coords, p = prevLocCoordsRef.current;
    const same = !!c && !!p && Math.abs(c.latitude - p.latitude) < 1e-9 && Math.abs(c.longitude - p.longitude) < 1e-9;
    prevLocCoordsRef.current = c ? { latitude: c.latitude, longitude: c.longitude } : null;
    if (!same) {
      eyeRef.current = null;
      eyeMovingRef.current = false;
      cachedAtmosphereMsRef.current = 0;
      const vOrig = volSceneOriginRef.current;
      if (c && vOrig) {
        const jumpOff = localOffsetM(vOrig, c.latitude, c.longitude);
        if (Math.hypot(jumpOff.eastM, jumpOff.northM) > 30_000) {
          volHasSceneRef.current = false;
          volKeyRef.current = '';
          volViewRef.current = '';
        }
      }
    }
    applyEye();
    lastAppliedTuningRef.current = null;
    sceneDirtyRef.current = true;
    requestRender(4);
  }, [location, requestRender]);
  useEffect(() => {
    let alive = true;
    const lat = location?.coords?.latitude ?? 37.5665;
    const lon = location?.coords?.longitude ?? 126.9780;
    ensureNightLightsForLocation(lat, lon).then(() => {
      if (!alive) return;
      nightLightsRef.current = getCachedNightLights();
      cachedLightEstRef.current = null;
      cachedCityFieldRef.current = null;
      cachedMoonBaseMagRef.current = Number.NaN;
      lastCityLightValRef.current = -1;
      lastVolCityLightRef.current = -1;
      if (volRef.current && nightLightsRef.current) volRef.current.setCityMap(nightLightsRef.current);
      sceneDirtyRef.current = true;
      requestRender(6);
    });
    return () => { alive = false; };
  }, [location?.coords?.latitude, location?.coords?.longitude, requestRender]);
  // §160 METAR — 자리가 바뀌면 바로, 그 뒤 10 분마다. 실패하면 null(예보 그대로). 볼륨 하늘이 꺼져 있으면 받지 않습니다.
  const metarLat = location?.coords?.latitude, metarLon = location?.coords?.longitude;
  useEffect(() => {
    if (!VOLUMETRIC_SKY_ENABLED || metarLat == null || metarLon == null) return;
    const ctl = new AbortController();
    let alive = true;
    const pull = () => fetchMetarReports(metarLat, metarLon, ctl.signal).then(reports => {
      if (!alive) return;
      const before = metarRef.current;
      const m = nearestStationLatest(reports);
      metarRef.current = m;
      const prevSig = metarsRef.current.length + '|' + metarsRef.current.reduce((a, r) => Math.max(a, r.timeMs), 0);
      metarsRef.current = reports;
      const sig = reports.length + '|' + reports.reduce((a, r) => Math.max(a, r.timeMs), 0);
      // 씬이 이미/곧 그려진 상태에서 무작정 키를 비우면 권운 등 전 층이 2번 계산됨 — effectiveVolSceneKey 가 실제 운량/강수 변화 여부로 재빌드를 결정
      if ((before?.icao ?? '') !== (m?.icao ?? '') || (before?.timeMs ?? 0) !== (m?.timeMs ?? 0) || prevSig !== sig) { requestRender(3); }
    }).catch(() => {});
    pull();
    const id = setInterval(pull, 10 * 60_000);
    return () => { alive = false; ctl.abort(); clearInterval(id); };
  }, [metarLat, metarLon, requestRender]);
  useEffect(() => { layersRef.current = layers; sceneDirtyRef.current = true; lastAppliedTuningRef.current = null; requestRender(3); }, [layers, requestRender]);
  useEffect(() => { timelineRef.current = timeline; sceneDirtyRef.current = true; requestRender(3); }, [timeline, requestRender]);

  // 운형 문턱·덱 밀폐·빌보드 수는 uniform이 아니라 배치 로직에 들어갑니다.
  // 바뀌면 다음 프레임에 다시 배치하도록 재빌드 조건을 깨워 둡니다.
  useEffect(() => subscribeTuning(() => {
    lastCloudSceneMsRef.current = -1e15;
    lastCloudSunAltRef.current = -999;
    sceneDirtyRef.current = true;
    lastAppliedTuningRef.current = null;
    requestRender(4);
  }), [requestRender]);
  useEffect(() => { trackingTargetRef.current = trackingTarget; if (trackingTarget) requestRender(15); }, [trackingTarget, requestRender]);
  useEffect(() => { onSelectTrackingTargetRef.current = onSelectTrackingTarget; }, [onSelectTrackingTarget]);
  useEffect(() => {
    const nextMs = currentTime.getTime();
    // emitScrubTime 으로 이미 같은 시각이 반영된 뒤 React 상태만 뒤따라 커밋될 때는 드리프트 기준을 되감지 않습니다.
    if (lastSyncedPropTimeMsRef.current !== null && nextMs === targetTimeMsRef.current) {
      lastSyncedPropTimeMsRef.current = nextMs;
      return;
    }
    lastSyncedPropTimeMsRef.current = nextMs;
    targetTimeMsRef.current = nextMs;
    lastTargetSyncPerfRef.current = performance.now();
    sceneDirtyRef.current = true;
    requestRender(4);
  }, [currentTime, requestRender]);

  useEffect(() => subscribeScrubTime((ms) => {
    targetTimeMsRef.current = ms;
    lastTargetSyncPerfRef.current = performance.now();
    sceneDirtyRef.current = true;
    requestRender(2);
    if (scrubSettleTimerRef.current) clearTimeout(scrubSettleTimerRef.current);
    scrubSettleTimerRef.current = setTimeout(() => {
      scrubSettleTimerRef.current = null;
      if (isSlidingRef.current) requestRender(2);
    }, 180);
  }), [requestRender]);

  const cameraAzimuthPropRef = useRef(cameraAzimuthProp);
  const cameraElevationPropRef = useRef(cameraElevationProp);
  const fovPropRef = useRef(fovProp);
  const disableGesturesRef = useRef(disableGestures);
  disableGesturesRef.current = disableGestures;

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
  // 샌드박스 고르기: 화면 점 → 시선(카메라 unproject, 롤·뷰 오프셋 포함) → 눈에 처음 닿는 땅이나 건물 → 먼 것은 봉우리·꼭대기로 붙임 → 보이는지 확인.
  doPickRef.current = (x: number, y: number) => {
    const cam = cameraRef.current, patch = demPatchRef.current, renderer = rendererRef.current, cb = onPickTargetRef.current;
    const { w: vw, h: vh } = layoutSizeRef.current;
    if (!cam || !patch || !renderer || !cb || !vw || !vh) return;
    // 가까운 촘촘한 패치(수 km)를 먼저, 그 밖은 지형 셰이더가 멀리 쓰는 광역 패치로 — 먼 산(수십 km)도 고를 수 있게.
    const sample = sceneHeightSampler(renderer, patch, demMaskPatchRef.current);
    if (!sample) return;
    cam.updateMatrixWorld();
    const v = new THREE.Vector3((x / vw) * 2 - 1, 1 - (y / vh) * 2, 0.5).unproject(cam).sub(cam.position);
    const len = v.length();
    if (len < 1e-9) return;
    const azDeg = ((Math.atan2(v.x, -v.z) * 180) / Math.PI + 360) % 360;
    const elDeg = (Math.asin(Math.max(-1, Math.min(1, v.y / len))) * 180) / Math.PI;
    const ground = sample(0, 0) ?? simRef.current?.terrain?.observerElevation ?? 0;
    const eye = ground + (eyeHeightRef.current ?? 1.6);
    // 처음 닿는 지형이나 건물(utils/pickTarget.ts). 건물 층이 꺼져 있으면 건물은 고르지 않습니다. 먼 대상은 손끝 12 px 여유.
    const here = eyeCoords();
    const target = pickTargetAt({
      sample,
      eyeM: eye,
      azDeg,
      elDeg,
      buildings: layers.buildings ? mergedBuildingRef.current?.pick ?? null : null,
      tolDeg: (12 * cam.fov) / vh,
      toLatLon: here ? (e, s) => offsetLatLon(here.latitude, here.longitude, e, -s) : undefined,
    });
    cb(target);
  };
  // 눈 높이 — 바뀌면 다시 그립니다(렌더 루프가 읽음). 고도 상승에 따른 하층 에어로졸/대기 감쇠 변화도 다시 반영합니다.
  useEffect(() => {
    const h = eyeHeightM !== undefined && Number.isFinite(eyeHeightM) ? Math.max(0.5, Math.min(2000, eyeHeightM)) : undefined;
    if (eyeHeightRef.current === h) return;
    eyeHeightRef.current = h;
    cachedAtmosphereMsRef.current = 0;
    sceneDirtyRef.current = true;
    reaimPickedTarget();
    lastViewMoveMsRef.current = Date.now();
    requestRender(6);
  }, [eyeHeightM, requestRender]);
  // 망원 배율 — 지상에서만. 바뀌면 지상 시야각을 다시 셉니다(손가락 줌의 기본 시야각 ÷ 배율).
  useEffect(() => {
    const t = Math.max(1, Math.min(TELE_MAX, Number.isFinite(telephotoX) ? telephotoX : 1));
    if (Math.abs(teleRef.current - t) < 1e-6) return;
    teleRef.current = t;
    const p = zoomProgressRef.current;
    if (p <= P_FOV_END) {
      fovRef.current = (30 + p * 90) / t;
      if (cameraRef.current) {
        cameraRef.current.fov = fovRef.current;
        cameraRef.current.updateProjectionMatrix();
      }
      setCameraFov(fovRef.current);
      lastViewMoveMsRef.current = Date.now();
      requestRender(6);
    }
  }, [telephotoX, requestRender]);

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
    // 1. 위치가 실제로 달라졌을 때만 전역 위치 갱신 (같은 자리 착륙 시 불필요한 재로딩/프레임 끊김 방지)
    const prevLat = locationRef.current?.coords?.latitude;
    const prevLon = locationRef.current?.coords?.longitude;
    const moved = prevLat === undefined || prevLon === undefined
      || Math.abs(prevLat - targetLat) > 1e-5
      || Math.abs(prevLon - targetLon) > 1e-5;
    homeRef.current = { latitude: targetLat, longitude: targetLon };
    setDivingLocation({ latitude: targetLat, longitude: targetLon });
    if (moved) {
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
    }

    // 2. 부드러운 다이빙 착륙 애니메이션 — 지상 시선은 처음부터 저장해 둔 값으로
    //    (내려오며 서서히 들림. 예전에는 끝 프레임에 한 번에 튀었습니다).
    if (divingAnimFrameRef.current) cancelAnimationFrame(divingAnimFrameRef.current);
    if (settleFrameRef.current !== null) { cancelAnimationFrame(settleFrameRef.current); settleFrameRef.current = null; }
    if (flyFrameRef.current !== null) { cancelAnimationFrame(flyFrameRef.current); flyFrameRef.current = null; }
    mapGlobeRef.current?.stopMotion?.();
    cameraElevRef.current = savedGroundElevRef.current;
    const startProgress = zoomProgressRef.current;
    const targetProgress = (60 - 30) / 90; // 지상 1인칭 관측 FOV 60° (0.333)
    const startTime = performance.now();
    // 멀리서 내려올수록 조금 더 길게(지구본 3.0 → 1.5 s, 상공 1.3 → 0.8 s).
    const duration = 600 + 340 * Math.max(0, startProgress - targetProgress);

    const animateDive = () => {
      const nowTime = performance.now();
      const t = Math.max(0, Math.min(1.0, (nowTime - startTime) / duration));
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
  const overlayReadyForMap = overlayLive && (zoomProgressState >= P_MAP_MOUNT || overlayWarm);
  const overlayMinute = Math.floor(currentTime.getTime() / 60000);
  const globeCelestialData = useMemo(() => {
    if (!overlayReadyForMap) return null;
    const date = new Date(overlayMinute * 60000);
    return {
      date,
      subsolar: getSubsolarPoint(date),
      terminator: getTerminatorSegments(date),
      sublunar: getSublunarPoint(date),
      moonFraction: getMoonPhase(date).fraction,
    };
  }, [overlayReadyForMap, overlayMinute]);

  // ── 지도 및 지구본용 등시선(Isochrone) 24시간 일출·일몰 격자선 — 고른 날짜(관측지 현지)가 바뀔 때만 ──
  const overlayTzMs = (useCelestialStore.getState().timezoneOffsetHours ?? 0) * 3600000;
  const overlayDayKey = new Date(overlayMinute * 60000 + overlayTzMs).toISOString().slice(0, 10);
  const allTerminators = useMemo(() => {
    if (!overlayReadyForMap) return [];
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
  }, [overlayReadyForMap, overlayDayKey, overlayTzMs]);

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
    if (!isActive || zoomProgressState < P_MAP_MOUNT) return;
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
  }, [isActive, zoomProgressState >= P_MAP_MOUNT]);

  // 고리 중심 — 위에서 본 구름을 그 자리의 해·달 고도로 칠합니다(밤엔 어둡게, 2026-11-18).
  const cloudRingCenter = cloudRingFetchRef.current;
  const topView = useCloudTopView(cloudRing, overlayMinute * 60000, zoomProgressState >= P_FADE_START - 0.08,
    cloudRingCenter ? { lat: cloudRingCenter.lat, lon: cloudRingCenter.lon } : null);

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
      onStartShouldSetPanResponder: () => !disableGesturesRef.current && cameraAzimuthPropRef.current === undefined,
      onMoveShouldSetPanResponder: (evt, gs) =>
        !disableGesturesRef.current &&
        cameraAzimuthPropRef.current === undefined &&
        (Math.abs(gs.dx) > 4 || Math.abs(gs.dy) > 4 || evt.nativeEvent.touches.length >= 2),
      onStartShouldSetPanResponderCapture: (evt) => !disableGesturesRef.current && evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponderCapture: (evt) => !disableGesturesRef.current && evt.nativeEvent.touches.length >= 2,
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
        tapStartMsRef.current = evt.nativeEvent?.timestamp ?? Date.now();   // 이벤트 시각(느린 프레임에 밀려도 손가락 시간 그대로)
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
            pinchTeleRef.current = teleRef.current;
            pinchSamplesRef.current = [];
            return;
          }
          const dist = getTouchDist(touches);
          if (dist > 0) {
            // ratio > 1: 두 손가락 모으기 (줌아웃 / 망원 해제 -> 광각 -> 상공 상승 -> 우주 궤도 지구본)
            // ratio < 1: 두 손가락 벌리기 (줌인 / 지구본 -> 상공 -> 지상 착륙)
            if (divingAnimFrameRef.current) {
              // 착륙 중에 손을 대면 애니메이션을 멈추고 지금 자리에서 이어 받습니다.
              cancelAnimationFrame(divingAnimFrameRef.current);
              divingAnimFrameRef.current = null;
              setDivingLocation(null);
              pinchDistRef.current = dist;
              pinchZoomProgressRef.current = zoomProgressRef.current;
              pinchTeleRef.current = teleRef.current;
            }
            const distRatio = pinchDistRef.current / dist;
            if (pinchTeleRef.current > 1 && distRatio > 1 && pinchZoomProgressRef.current <= P_FOV_END) {
              const nextTele = Math.max(1, pinchTeleRef.current / distRatio);
              if (Math.abs(nextTele - teleRef.current) > 1e-3) {
                teleRef.current = nextTele;
                onChangeTelephotoRef.current?.(Math.round(nextTele * 10) / 10);
              }
              const residualRatio = distRatio / pinchTeleRef.current;
              if (residualRatio > 1) {
                applyZoomProgressRef.current(progressFromPinch(pinchZoomProgressRef.current, residualRatio));
              } else {
                applyZoomProgressRef.current(pinchZoomProgressRef.current, { force: true });
              }
            } else {
              applyZoomProgressRef.current(progressFromPinch(pinchZoomProgressRef.current, distRatio));
            }
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
            // 화면 높이와 현재 세로 FOV 에 맞춘 1:1 각도/픽셀 비율(전체화면·망원 줌에서도 손가락을 따라옴)
            const vh = Math.max(200, viewSizeRef.current.h || 844);
            const fovDeg = Math.max(1, Math.min(120, fovRef.current || 60));
            const degPerPx = ((2 * Math.tan((fovDeg * Math.PI) / 360)) / vh) * (180 / Math.PI);
            const cosEl = Math.max(0.25, Math.cos((cameraElevRef.current * Math.PI) / 180));
            const nextAz = (cameraAzRef.current - (dx * degPerPx) / cosEl + 360) % 360;
            cameraAzRef.current = nextAz;
            // 지상 모드에서만 상하 시선 조작 허용 (상공 레이더 모드에서는 직하향 탑다운 안정 유지)
            if (zoomProgressRef.current <= P_FOV_END) {
              const minElev = -45;
              cameraElevRef.current = Math.max(minElev, Math.min(85, cameraElevRef.current + dy * degPerPx));
              savedGroundElevRef.current = cameraElevRef.current;
            }
          }
          lastTouchRef.current = { x: touches[0].pageX, y: touches[0].pageY };
          pinchDistRef.current = null;
          // 뷰파인더 눈금자 UI는 120ms + 0.2° 임계값 스로틀 — 드래그 중 불필요한 React 리렌더 방지
          const nowAz = Date.now();
          if (nowAz - lastAzUpdateMsRef.current > 120) {
            const dAz = Math.abs(((cameraAzRef.current - lastSentAzElevRef.current.az + 540) % 360) - 180);
            const dEl = Math.abs(cameraElevRef.current - lastSentAzElevRef.current.el);
            if (dAz >= 0.2 || dEl >= 0.2) {
              lastAzUpdateMsRef.current = nowAz;
              lastSentAzElevRef.current.az = cameraAzRef.current;
              lastSentAzElevRef.current.el = cameraElevRef.current;
              setCameraAzimuth(cameraAzRef.current);
              setCameraElevation(cameraElevRef.current);
            }
          }
        }
      },
      onPanResponderRelease: (evt) => {
        // 짧게 눌렀다 뗐고 움직임이 없었으면 탭(샌드박스 고르기). 움직이면 touchStartLocRef 가 이미 비어 있습니다.
        const wasTap = pickEnabledRef.current && touchStartLocRef.current !== null && pinchDistRef.current === null
          && pinchSamplesRef.current.length === 0 && zoomProgressRef.current <= P_FOV_END && (evt?.nativeEvent?.timestamp ?? Date.now()) - tapStartMsRef.current < 350;
        const tapX = evt?.nativeEvent?.locationX, tapY = evt?.nativeEvent?.locationY;
        if (wasTap && typeof tapX === 'number' && typeof tapY === 'number') doPickRef.current(tapX, tapY);
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        touchStartLocRef.current = null;
        lastTouchRef.current = null;
        pinchDistRef.current = null;
        lastSentAzElevRef.current.az = cameraAzRef.current;
        lastSentAzElevRef.current.el = cameraElevRef.current;
        setCameraAzimuth(cameraAzRef.current);
        setCameraElevation(cameraElevRef.current);
        const hadPinchOrOverlay = pinchSamplesRef.current.length > 0 || zoomProgressRef.current > P_FOV_END;
        if (hadPinchOrOverlay) {
          setCameraFov(fovRef.current);
          // 놓기·끊김 모두 같은 식(예전 끊김 처리는 고도 식과 단계 문턱이 달랐습니다).
          // 손가락 속도로 조금 더 가고, 겹침 구간이면 끝까지 마저 갑니다(§153).
          settleZoomRef.current(pinchRateFromSamples(pinchSamplesRef.current));
        }
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
        lastSentAzElevRef.current.az = cameraAzRef.current;
        lastSentAzElevRef.current.el = cameraElevRef.current;
        setCameraAzimuth(cameraAzRef.current);
        setCameraElevation(cameraElevRef.current);
        const hadPinchOrOverlay = pinchSamplesRef.current.length > 0 || zoomProgressRef.current > P_FOV_END;
        // 빼앗겼을 때는 미끄러지지 않고, 겹침 구간이면 끝으로만 갑니다.
        pinchSamplesRef.current = [];
        if (hadPinchOrOverlay) {
          setCameraFov(fovRef.current);
          settleZoomRef.current(0);
        }
        requestRender(3);
        useCelestialStore.getState().setGestureBlocked(false);
        markAdjustingRef.current(false);
      },
    })
  ).current;

  // GLView 컨텍스트 초기화
  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    // GL 컨텍스트를 **다시** 받는 경우(앱을 내렸다 올렸을 때, SurfaceTexture 재생성 등):
    // 1) 이전 컨텍스트 루프를 즉시 중단하고
    // 2) 옛 렌더러에 묶여 있던 DEM 패치(demPatchRef)·볼륨 하늘(volRef)·구름 그림자·튜닝 캐시를 모두 비워
    //    새 GL 컨텍스트에서 높이장과 볼륨 하늘이 정상 재생성되게 합니다.
    //    (demPatchRef 나 volRef 가 남으면 loadDemForRef 가 blockCovers 조기 반환으로 새 terrainField 에 패치를
    //     안 꽂아 평면 원반만 남고, volRef 는 죽은 컨텍스트의 텍스처를 반환해 하늘이 검게 됩니다.)
    if (glRef.current && (glRef.current as any).__contextLostRef) {
      (glRef.current as any).__contextLostRef(true);
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    isLoopRunningRef.current = false;
    if (rendererRef.current) clearDemCache(rendererRef.current);
    demPatchRef.current = null;
    demMaskPatchRef.current = null;
    demLoadedKeyRef.current = null;
    demLoadingKeyRef.current = null;
    urbanLoadedKeyRef.current = null;
    buildingLoadedKeyRef.current = null;
    buildingRetryCountRef.current = 0;
    cloudShadowTexRef.current = null;
    cloudShadowKeyRef.current = '';
    prewarmCancelRef.current?.();
    prewarmedDayKeyRef.current = '';
    ++volBuildSeqRef.current;
    volRef.current = null;
    volBusyRef.current = false;
    volFailedRef.current = null;
    volHasSceneRef.current = false;
    volPendingRef.current = false;
    volKeyRef.current = '';
    volQualityRef.current = '';
    volSizeRef.current = '';
    volViewRef.current = '';
    lastAppliedTuningRef.current = null;
    lastCityLightValRef.current = -1;
    lastVolCityLightRef.current = -1;
    glRef.current = gl;
    if (layoutSizeRef.current.w > 0 && gl.drawingBufferWidth > 0) {
      glScaleRef.current = gl.drawingBufferWidth / layoutSizeRef.current.w;
    } else if (layoutSizeRef.current.h > 0 && gl.drawingBufferHeight > 0) {
      glScaleRef.current = gl.drawingBufferHeight / layoutSizeRef.current.h;
    } else {
      glScaleRef.current = PixelRatio.get() || 1;
    }
    syncGlDrawingBufferSize(gl);

    const renderer = new Renderer({ gl });
    renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
    bufSizeRef.current = `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`;
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
    // 2026-11-18 가로등 빛 웅덩이(더하기) — 지형·건물 깊이 뒤에.
    terrainField.lampMesh.renderOrder = -0.47;
    scene.add(terrainField.lampMesh);
    assignLayer(terrainField.lampMesh, LAYER_MID);
    terrainFieldRef.current = terrainField;

    const buildingField = createBuildingField({ eyeHeightM: 1.6 });
    buildingField.mesh.renderOrder = -0.475;
    scene.add(buildingField.mesh);
    assignLayer(buildingField.mesh, LAYER_MID);
    buildingField.windowMesh.renderOrder = -0.468;
    scene.add(buildingField.windowMesh);
    assignLayer(buildingField.windowMesh, LAYER_MID);
    buildingField.lampMesh3D.renderOrder = -0.466;
    scene.add(buildingField.lampMesh3D);
    assignLayer(buildingField.lampMesh3D, LAYER_MID);
    buildingField.lampPoints.renderOrder = -0.465;
    scene.add(buildingField.lampPoints);
    assignLayer(buildingField.lampPoints, LAYER_MID);
    scene.add(buildingField.distMesh);
    assignLayer(buildingField.distMesh, LAYER_TERRAIN_DIST);
    scene.add(buildingField.litMesh);
    assignLayer(buildingField.litMesh, LAYER_TERRAIN_LIT);
    buildingFieldRef.current = buildingField;
    setBuildingSyncTick(t => t + 1);

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

    const syncBufferSize = (dw: number, dh: number, bufKey: string) => {
      if (dw <= 0 || dh <= 0 || bufKey === bufSizeRef.current) return;
      bufSizeRef.current = bufKey;
      renderer.setSize(dw, dh, false);
      renderer.setViewport(0, 0, dw, dh);
      renderer.setScissor(0, 0, dw, dh);
      renderer.setScissorTest(false);
      camera.aspect = dw / Math.max(1, dh);
      camera.updateProjectionMatrix();
      composerRef.current?.setSize(dw, dh);
      if (volRef.current) {
        volRef.current.setSize(dw, dh);
        volSizeRef.current = bufKey;
      }
      pixelRatioRef.current = Math.max(1, dw / Math.max(1, sceneWidthRef.current));
      volViewRef.current = '';
      sceneDirtyRef.current = true;
    };

    const stepAdaptiveSoftScale = (now: number) => {
      if (volRef.current && volHasSceneRef.current) return;
      if (adaptLastTs > 0) {
        const dt = now - adaptLastTs;
        if (dt < 200) {
          if (adaptSettle > 0) adaptSettle--;
          else { adaptAccMs += dt; adaptCount++; }
        }
      }
      adaptLastTs = now;
      const composerAdapt = composerRef.current;
      if (!composerAdapt || adaptCount < ADAPT_WINDOW) return;
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
    };

    const applyTrackingStep = (frameDate: Date): boolean => {
      if (!trackingTargetRef.current) {
        trackingActiveUntilRef.current = 0;
        return false;
      }
      const step = computeTrackingStep({
        target: trackingTargetRef.current,
        sunPos: sunRef.current?.mesh?.position ?? null,
        moonPos: moonRef.current?.group?.position ?? null,
        equToHorizon: equToHorizonRef.current,
        frameDate,
        terrain: simRef.current?.terrain,
        sunDiscRadiusDeg: sunDiscRadiusDegRef.current,
        currentAz: cameraAzRef.current,
        currentElev: cameraElevRef.current,
      });
      if (step.clearTarget) {
        trackingTargetRef.current = null;
        trackingActiveUntilRef.current = 0;
        onSelectTrackingTargetRef.current?.(null);
        return false;
      }
      if (step.nextAz !== undefined && step.nextElev !== undefined) {
        const nowPerf = performance.now();
        cameraAzRef.current = step.nextAz;
        cameraElevRef.current = step.nextElev;
        if (step.moving) {
          trackingActiveUntilRef.current = nowPerf + 160;
        } else if (!isSlidingRef.current) {
          trackingActiveUntilRef.current = 0;
        }
        // 3D 카메라는 ref로 60fps 즉시 반영하고, HUD 표시용 React state는 쓰로틀해 매 프레임 전체 리렌더를 방지
        if (!step.moving || nowPerf - lastTrackingHudSyncMsRef.current >= 150) {
          lastTrackingHudSyncMsRef.current = nowPerf;
          setCameraAzimuth(step.nextAz);
          setCameraElevation(step.nextElev);
        }
        return step.moving;
      }
      if (!isSlidingRef.current) trackingActiveUntilRef.current = 0;
      return false;
    };

    const syncCameraPoseAndSurfaceOffsets = (rv: typeof remoteViewRef.current) => {
      if (cameraAzimuthPropRef.current !== undefined) cameraAzRef.current = cameraAzimuthPropRef.current;
      if (cameraElevationPropRef.current !== undefined) cameraElevRef.current = cameraElevationPropRef.current;
      if (fovPropRef.current !== undefined && Math.abs(fovRef.current - fovPropRef.current) > 0.05) {
        fovRef.current = fovPropRef.current;
        camera.fov = fovPropRef.current;
        camera.updateProjectionMatrix();
      }
      if (rv) {
        cameraAzRef.current = rv.az; cameraElevRef.current = rv.el;
        if (Math.abs(fovRef.current - rv.fov) > 0.05) { fovRef.current = rv.fov; camera.fov = rv.fov; camera.updateProjectionMatrix(); }
      }

      const groundY = groundRef.current ? groundRef.current.position.y : 0;
      const pose = cameraPoseForProgress(
        zoomProgressRef.current, cameraElevRef.current, cameraAzRef.current,
        homeRef.current.latitude, camera.aspect, fovRef.current,
      );
      const altitudeM = zoomProgressRef.current <= P_FOV_END && eyeHeightRef.current !== undefined ? eyeHeightRef.current : pose.altitudeM;
      const cameraY = groundY + altitudeM;
      camera.position.set(0, cameraY, 0);
      if (starFieldRef.current) starFieldRef.current.points.position.set(0, cameraY, 0);
      if (milkyWayRef.current) milkyWayRef.current.mesh.position.set(0, cameraY, 0);
      if (celestialPathsRef.current) celestialPathsRef.current.containerGroup.position.set(0, cameraY, 0);
      if (compassGroupRef.current) compassGroupRef.current.position.set(0, cameraY, 0);
      const effectiveElev = pose.elevDeg;
      const effectiveAz = pose.azDeg;
      if (Math.abs(camera.fov - pose.fovDeg) > 0.05) {
        camera.fov = pose.fovDeg;
        camera.updateProjectionMatrix();
      }
      const targetFar = Math.max(1000, altitudeM * 8);
      if (Math.abs(camera.far - targetFar) > 50) {
        camera.far = targetFar;
        camera.updateProjectionMatrix();
      }

      const azRad = (effectiveAz * Math.PI) / 180;
      const elevRad = (effectiveElev * Math.PI) / 180;
      const lookDist = Math.max(100, altitudeM);
      const curOffFrac = camera.view?.enabled ? camera.view.offsetY / camera.view.fullHeight : 0;
      const curViewAspect = camera.view?.enabled ? camera.view.fullWidth / Math.max(1, camera.view.fullHeight) : camera.aspect;
      if (
        Math.abs(curOffFrac - viewCenterOffsetYFracRef.current) > 1e-4 ||
        (camera.view?.enabled && Math.abs(curViewAspect - camera.aspect) > 1e-4)
      ) {
        if (Math.abs(viewCenterOffsetYFracRef.current) > 1e-4) {
          const aw = 1000 * (camera.aspect || 1);
          camera.setViewOffset(aw, 1000, 0, viewCenterOffsetYFracRef.current * 1000, aw, 1000);
        } else {
          camera.clearViewOffset();
        }
      }
      camera.up.set(pose.up[0], pose.up[1], pose.up[2]);
      const activeRollDeg = rv?.rollDeg ?? cameraRollRef.current;
      if (activeRollDeg && Math.abs(activeRollDeg) > 1e-4) {
        const fwdRoll = new THREE.Vector3(
          Math.cos(elevRad) * Math.sin(azRad),
          Math.sin(elevRad),
          -Math.cos(elevRad) * Math.cos(azRad),
        ).normalize();
        camera.up.applyAxisAngle(fwdRoll, (activeRollDeg * Math.PI) / 180);
      }
      camera.lookAt(
        lookDist * Math.cos(elevRad) * Math.sin(azRad),
        cameraY + lookDist * Math.sin(elevRad),
        -lookDist * Math.cos(elevRad) * Math.cos(azRad),
      );

      const curEye = eyeCoords();
      if (terrainFieldRef.current) {
        updateTerrainFieldEye(terrainFieldRef.current, camera);
        terrainFieldRef.current.material.uniforms.uEyeHeightM.value = altitudeM;
        if (curEye) {
          if (
            !noiseOriginRef.current ||
            Math.hypot(
              localOffsetM({ latitude: noiseOriginRef.current.lat, longitude: noiseOriginRef.current.lng }, curEye.latitude, curEye.longitude).eastM,
              localOffsetM({ latitude: noiseOriginRef.current.lat, longitude: noiseOriginRef.current.lng }, curEye.latitude, curEye.longitude).northM,
            ) > 10_000
          ) {
            noiseOriginRef.current = { lat: curEye.latitude, lng: curEye.longitude };
          }
          const nOff = localOffsetM({ latitude: noiseOriginRef.current.lat, longitude: noiseOriginRef.current.lng }, curEye.latitude, curEye.longitude);
          terrainFieldRef.current.setNoiseEyeOffset?.(nOff.eastM, -nOff.northM);
        }
        const uc = urbanCenterRef.current;
        const uOff = curEye && uc ? localOffsetM({ latitude: uc.lat, longitude: uc.lng }, curEye.latitude, curEye.longitude) : { eastM: 0, northM: 0 };
        terrainFieldRef.current.setUrbanEyeOffset?.(uOff.eastM, -uOff.northM);
        seaPlaneRef.current?.setWaterMaskEyeOffset?.(uOff.eastM, -uOff.northM);
      }
      if (buildingFieldRef.current) {
        const bc = bldCenterRef.current;
        const bldFresh = buildingLoadedKeyRef.current !== null;
        const bOff = curEye ? localOffsetM({ latitude: bc.lat, longitude: bc.lng }, curEye.latitude, curEye.longitude) : { eastM: 0, northM: 0 };
        buildingFieldRef.current.material.uniforms.uEyeHeightM.value = altitudeM;
        buildingFieldRef.current.setEyeOffset(bOff.eastM, -bOff.northM);
        const bldInRange = Math.hypot(bOff.eastM, bOff.northM) < 2500;
        const bldAerialVisible = altitudeM <= 900;
        buildingFieldRef.current.setVisible(Boolean(layersRef.current.buildings) && bldFresh && bldInRange && bldAerialVisible);
        updateBuildingFieldEye(buildingFieldRef.current, camera);
      }
      if (seaPlaneRef.current) {
        updateSeaPlaneEye(seaPlaneRef.current, camera);
        if (seaPlaneRef.current.material.uniforms.uEyeHeightM) {
          seaPlaneRef.current.material.uniforms.uEyeHeightM.value = altitudeM;
        }
        if (!volDrewRef.current) { seaPlaneRef.current.distMesh.visible = false; seaPlaneRef.current.litMesh.visible = false; }
      }
      if (terrainFieldRef.current?.mesh.visible && rendererRef.current) {
        const fastShadow = isSlidingRef.current || performance.now() < trackingActiveUntilRef.current;
        terrainFieldRef.current.bakeSunShadow(rendererRef.current, fastShadow);
        terrainFieldRef.current.bakeAmbient(rendererRef.current);
      }
      return { altitudeM, effectiveAz, effectiveElev };
    };

    const syncTuningAndCityLightUniforms = () => {
      const locNow = locationRef.current;
      const lightEstNow = getLightEst(locNow?.coords?.latitude ?? 37.5, locNow?.coords?.longitude ?? 127.0);
      terrainFieldRef.current?.setFarUrban(lightEstNow ? lightEstNow.pollution : 0);
      const cityLightsEnabled = layersRef.current.cityLights !== false;
      const cityLightNow = !cityLightsEnabled
        ? 0
        : lightEstNow
          ? lightEstNow.pollution
          : Math.max(0, Math.min(1, (6.5 - skySettingsRef.current.starMagLimit) / 3.5));
      // 구름·하늘 도시광 기준은 3등급(1.0)으로 고정하고 실제 세기/분포는 밤 불빛 지도가 정합니다.
      const volCityLightNow = cityLightsEnabled && nightLightsRef.current ? 1.0 : 0;
      const tuningNow = getTuning();
      if (
        tuningNow === lastAppliedTuningRef.current &&
        Math.abs(cityLightNow - lastCityLightValRef.current) <= 1e-4 &&
        Math.abs(volCityLightNow - lastVolCityLightRef.current) <= 1e-4
      ) {
        return;
      }
      lastAppliedTuningRef.current = tuningNow;
      lastCityLightValRef.current = cityLightNow;
      lastVolCityLightRef.current = volCityLightNow;
      setSceneCityLight(cityLightNow);
      volRef.current?.setCityLight(volCityLightNow);
      volRef.current?.setExposureScale(tuningNow.displayExposure / DEFAULT_TUNING.displayExposure);
      applyTuningUniforms(sunRef.current?.material.uniforms);
      if (groundRef.current) applyTuningUniforms((groundRef.current.material as THREE.ShaderMaterial).uniforms);
      if (terrainFieldRef.current) applyTuningUniforms(terrainFieldRef.current.material.uniforms);
      if (buildingFieldRef.current) applyTuningUniforms(buildingFieldRef.current.material.uniforms);
      if (seaPlaneRef.current) applyTuningUniforms(seaPlaneRef.current.material.uniforms);
    };

    const ensureVolumetricInstance = () => {
      if (volRef.current || volBusyRef.current) return;
      const mod = loadVolumetric();
      if (!mod) {
        volFailedRef.current = '볼륨 모듈을 불러오지 못했습니다';
        setVolumetricStatus({ phase: 'failed', error: volFailedRef.current });
        return;
      }
      volBusyRef.current = true;
      setVolumetricStatus({ phase: 'creating', sinceMs: Date.now(), error: null });
      const tAtmos = Date.now();
      const harnessVolOpts = (globalThis as unknown as { __volCreateOpts?: (r: THREE.WebGLRenderer) => Promise<Record<string, unknown>> }).__volCreateOpts;
      (harnessVolOpts ? harnessVolOpts(renderer as unknown as THREE.WebGLRenderer) : Promise.resolve({}))
        .then(extra => mod.createVolumetricScene(renderer as unknown as THREE.WebGLRenderer, gl.drawingBufferWidth, gl.drawingBufferHeight, { genus: true, celestial: false, flow: skySettingsRef.current.volumetricFlow ?? true, flowUv: skySettingsRef.current.volumetricFlowUv ?? true, keepIceShaderLoaded: true, ...extra }))
        .then(v => {
          volumetricStats.atmosMs = Date.now() - tAtmos;
          volumetricStats.spectral = v.spectral;
          volGovRef.current = createResolutionGovernor({ maxScale: skySettingsRef.current.volumetricRes ?? 0.5 });
          v.setResolutionScale(volGovRef.current.scale);
          volQualityRef.current = '';
          volRef.current = v;
          lastVolCityLightRef.current = -1;
          const curLat = locationRef.current?.coords?.latitude ?? 37.5665;
          const curLon = locationRef.current?.coords?.longitude ?? 126.9780;
          if (nightLightsRef.current) v.setCityMap(nightLightsRef.current);
          else if (!getPrehydratedCityLightField(curLat, curLon)) {
            ensureNightLightsForLocation(curLat, curLon).then(() => {
              if (volRef.current === v && getCachedNightLights()) v.setCityMap(getCachedNightLights());
            });
          }
          volBusyRef.current = false; volKeyRef.current = ''; volHasSceneRef.current = false; volPendingRef.current = false;
          volSizeRef.current = `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`; volSettleRef.current = 18;
          setVolumetricStatus({ phase: 'running' }); requestRender(3);
        })
        .catch(e => { volFailedRef.current = '생성: ' + String((e as Error)?.message ?? e); volBusyRef.current = false; setVolumetricStatus({ phase: 'failed', error: volFailedRef.current }); console.warn('[SkyScene] 볼륨 하늘 생성 실패:', (e as Error)?.stack ?? e); requestRender(2); });
    };

    const startDayPrewarmIfNeeded = (
      live: NonNullable<ReturnType<typeof loadLiveScene>>,
      vol: VolumetricScene,
      vLat: number, vLon: number, vElev: number, vDate: Date, vBucketMs: number,
      vPath: CloudPathData[], effectiveAz: number, effectiveElev: number, altitudeM: number,
    ) => {
      const dayStart = new Date(vDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayStartMs = dayStart.getTime();
      const dayPrewarmKey = `${vLat.toFixed(2)}|${vLon.toFixed(2)}|${Math.round(vElev / 100)}|${dayStartMs}|${(vPath[0] as any)?.time ?? ''}|${vPath.length}|${volQualityRef.current}|${metarRef.current?.icao ?? ''}`;
      if (dayPrewarmKey === prewarmedDayKeyRef.current) return;
      prewarmCancelRef.current?.();
      prewarmedDayKeyRef.current = dayPrewarmKey;
      let aborted = false;
      prewarmCancelRef.current = () => { aborted = true; };
      const hourBuckets = buildDayPrewarmBuckets(dayStartMs, vBucketMs);
      const metarSnap = metarRef.current;
      const metarsSnap = metarsRef.current;
      const fillSnap = skySettingsRef.current.volumetricFill ?? true;
      // 2026-11-26 시간 막대를 끄는 동안에도 굽기(짧은 조각) — 예전에는 끄는 동안 멈춰, 안 구운 시간으로 가면 구름이 수 초 늦게 바뀌었음.
      // 같은 텍스처를 미리 만드는 것뿐이라 손을 뗐을 때 그림은 그대로(근사 없음). 지금 장면 굽기(volPending)가 우선.
      const shouldPausePrewarm = () =>
        !isActiveRef.current ||
        !glVisibleForProgress(zoomProgressRef.current) ||
        useCelestialStore.getState().isGestureBlocked ||
        volPendingRef.current ||
        (volSettleRef.current > 0 && !isSlidingRef.current);
      const focusBucketNow = () => Math.floor(renderedTimeMsRef.current / 3600000) * 3600000 + 1800000;
      (async () => {
        const totalHours = hourBuckets.length;
        await new Promise(r => setTimeout(r, 1500));
        let reportedActive = false;
        const readyMs: number[] = [];
        setVolumetricStatus({ prewarm: { active: false, done: 0, total: totalHours, readyMs: [] } });
        const remaining = hourBuckets.slice();
        for (let idx = 0; idx < totalHours; idx++) {
          if (aborted) return;
          while (shouldPausePrewarm() && !aborted) {
            await new Promise(r => setTimeout(r, 60));
          }
          if (aborted) return;
          // 막대가 움직였으면 지금 가리키는 시간 칸에 가장 가까운 것부터.
          const bMs = nextPrewarmBucket(remaining, focusBucketNow())!;
          remaining.splice(remaining.indexOf(bMs), 1);
          const bDate = new Date(bMs);
          const bWx = getInterpolatedWeather(vPath, bDate);
          const input = live.buildLiveScene({
            lat: vLat, lon: vLon, heightM: vElev, date: bDate,
            pathData: vPath, obs: bWx[0] ?? null, interpolatedWeather: bWx,
            az: effectiveAz, el: effectiveElev, fov: camera.fov,
            altitudeM, metar: metarSnap, metars: metarsSnap, fill: fillSnap,
          }).input;
          const alreadyCached = vol.hasCachedScene?.(input, false) ?? false;
          if (!alreadyCached) {
            if (!reportedActive) {
              reportedActive = true;
              setVolumetricStatus({ prewarm: { active: true, done: idx, total: totalHours, readyMs: readyMs.slice() } });
            }
            await vol.prewarmScenesAsync!([input], () => aborted, undefined, shouldPausePrewarm, true);
            if (aborted) return;
          }
          const done = idx + 1;
          readyMs.push(bMs);
          setVolumetricStatus({
            prewarm: { active: reportedActive && done < totalHours, done, total: totalHours, readyMs: readyMs.slice() },
          });
        }
      })().catch(() => {
        if (!aborted) setVolumetricStatus({ prewarm: null });
      });
    };

    const stepVolumetricScene = (
      now: number,
      composerNow: SceneComposerHandle,
      altitudeM: number,
      effectiveAz: number,
      effectiveElev: number,
      rv: typeof remoteViewRef.current,
    ): THREE.Texture | null => {
      let volTex: THREE.Texture | null = null;
      const volSet = skySettingsRef.current;
      const volSetting = VOLUMETRIC_SKY_ENABLED;
      if (!volSetting && volFailedRef.current) { volFailedRef.current = null; }
      if (VOLUMETRIC_SKY_ENABLED && !volSetting && !volBusyRef.current) setVolumetricStatus({ phase: 'off', error: null });
      const volWant = volSetting && !volFailedRef.current;
      if (volWant && !volRef.current && !volBusyRef.current) ensureVolumetricInstance();
      if (!volWant || !volRef.current) return null;

      try {
        const vol = volRef.current;
        const live = loadLiveScene();
        const szKey = `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`;
        if (szKey !== volSizeRef.current) { vol.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight); volSizeRef.current = szKey; }
        const isLowSpec = (volSet.pixelArtRows ?? 0) > 0;
        const q = volSet.volumetricQuality ?? 'low';
        const effRes = isLowSpec ? Math.min(0.28, volSet.volumetricRes ?? 0.5) : (volSet.volumetricRes ?? 0.5);
        const effBillow = isLowSpec ? false : (volSet.volumetricBillow ?? true);
        const effCells = !isLowSpec;
        const effEdgeRough = isLowSpec ? 0 : 0.5;
        const qKey = `${q}|${effRes}|${isLowSpec ? 1 : 0}|${(volSet.volumetricFlow ?? true) ? 1 : 0}|${(volSet.volumetricFlowUv ?? true) ? 1 : 0}|${volSet.volumetricPhysics ? 1 : 0}|${volSet.volumetricPhysicsIce ? 1 : 0}|${volSet.volumetricMacro ?? 1}|${volSet.volumetricMorph ? 1 : 0}|${effBillow ? 1 : 0}|${volSet.volumetricFill ?? true ? 1 : 0}|${volSet.volumetricAccurateSun ?? true ? 1 : 0}|${volSet.volumetricLowSunShadow ?? true ? 1 : 0}|${volSet.volumetricFarSun ?? true ? 1 : 0}|${volSet.volumetricSheetDiffuse ?? true ? 1 : 0}|${volSet.volumetricClampInscatter ?? true ? 1 : 0}|${volSet.volumetricIrradianceLogMu ?? true ? 1 : 0}|${(volSet.volumetricRefine ?? true) && !isLowSpec ? 1 : 0}`;
        if (qKey !== volQualityRef.current) {
          const prevKey = volQualityRef.current;
          vol.setQuality(q);
          vol.setOptions({
            flow: volSet.volumetricFlow ?? true,
            flowUv: volSet.volumetricFlowUv ?? true,
            physics: !!volSet.volumetricPhysics,
            physicsIce: !!volSet.volumetricPhysics && !!volSet.volumetricPhysicsIce,
            macro: volSet.volumetricMacro ?? 1,
            morph: !!volSet.volumetricMorph,
            billow: effBillow,
            cells: effCells,
            edgeRough: effEdgeRough,
            accurateSunBelowDeg: (volSet.volumetricAccurateSun ?? true) ? 91 : null,
            shadowMinSunDeg: (volSet.volumetricLowSunShadow ?? true) ? -4 : 12,
            farSun: volSet.volumetricFarSun ?? true,
            diffuse: (volSet.volumetricSheetDiffuse ?? true) ? 4 : 0,
            sunLowpass: 1,
            sunMarch: effBillow ? [6, 90, 1.75] : [4, 280, 2.0],
            clampInscatter: volSet.volumetricClampInscatter ?? true,
            irradianceLogMu: volSet.volumetricIrradianceLogMu ?? true,
            cloudAccum: ((volSet.volumetricRefine ?? true) && !isLowSpec) ? 0.25 : 1,
            keepIceShaderLoaded: true,
          }, false);
          // 고화질 → 저화질 전환 시에는 기존 구름 타일을 그대로 재사용하고, 저화질 → 고화질로 올릴 때만 S=128 타일이었다면 고해상도(S=256) 재합성을 트리거합니다.
          if (!prevKey || (!isLowSpec && lastVolIsFastRef.current)) {
            volKeyRef.current = '';
          }
          const changed = volGovRef.current?.setMax(effRes);
          if (changed != null) vol.setResolutionScale(changed);
          volQualityRef.current = qKey; volSettleRef.current = Math.max(volSettleRef.current, isLowSpec ? 8 : 18);
        }

        const vLat = location?.coords?.latitude ?? 37.5, vLon = location?.coords?.longitude ?? 127.0;
        const vElev = simRef.current?.terrain?.observerElevation ?? location?.coords?.altitude ?? 50;
        const vDate = new Date(renderedTimeMsRef.current);
        const vPath: CloudPathData[] = simRef.current?.pathData ?? [];
        const vBucketMs = overrideStartBucketMsRef.current ?? (Math.floor(renderedTimeMsRef.current / 3600000) * 3600000 + 1800000);
        if (!volBucketWxRef.current || volBucketWxRef.current.ms !== vBucketMs || volBucketWxRef.current.path !== vPath || volBucketWxRef.current.live !== weatherRef.current) {
          volBucketWxRef.current = { ms: vBucketMs, path: vPath, live: weatherRef.current, wx: vPath.length ? getInterpolatedWeather(vPath, new Date(vBucketMs)) : (weatherRef.current ?? []) };
        }
        const vWx = volBucketWxRef.current.wx;
        const vObs = vWx?.[0] ?? null;
        const wSample = vWx?.[Math.min(4, Math.max(0, (vWx?.length ?? 0) - 1))];
        const key = loadSceneKey()!.effectiveVolSceneKey({
          sceneMs: vBucketMs, lat: vLat, lon: vLon, elevM: vElev,
          metarId: '', metar: metarRef.current, obs: vObs, sample: wSample,
        });
        const volRollDeg = rv?.rollDeg ?? cameraRollRef.current ?? 0;
        const volOffY = viewCenterOffsetYFracRef.current;
        const curEyeForKey = eyeCoords();
        const eyeKey = curEyeForKey ? `${curEyeForKey.latitude.toFixed(6)},${curEyeForKey.longitude.toFixed(6)}` : '';
        const nowPerf = performance.now();
        const isSlidingNow = !!isSlidingRef.current;
        const isTrackingActive = nowPerf < trackingActiveUntilRef.current;
        const isInteractingNow = isSlidingNow || isTrackingActive || eyeMovingRef.current || useCelestialStore.getState().isGestureBlocked || settleFrameRef.current !== null || flyFrameRef.current !== null || divingAnimFrameRef.current !== null;
        const altQuant = altitudeM > 50
          ? Math.round(altitudeM / Math.max(10, altitudeM * (isInteractingNow ? 0.06 : 0.02)))
          : Math.round(altitudeM);
        const viewKey = `${effectiveAz.toFixed(2)}|${effectiveElev.toFixed(2)}|${camera.fov.toFixed(2)}|${altQuant}|${volRollDeg.toFixed(2)}|${volOffY.toFixed(3)}|${eyeKey}`;
        const isFast = isLowSpec;
        const volKeyChanged = Boolean(live && key !== volKeyRef.current);

        if (volInteractingRef.current !== isInteractingNow) {
          volInteractingRef.current = isInteractingNow;
          vol.setInteracting?.(isInteractingNow, !isInteractingNow && volKeyChanged);
          composerNow.setInteracting?.(isInteractingNow);
          if (!isInteractingNow && !volPendingRef.current && !volKeyChanged) {
            volSettleRef.current = Math.max(volSettleRef.current, 18);
          }
        }
        if (volKeyChanged && live) {
          const curWx = vPath.length ? getInterpolatedWeather(vPath, vDate) : (weatherRef.current ?? []);
          const built = live.buildLiveScene({
            lat: vLat, lon: vLon, heightM: vElev, date: vDate, pathData: vPath,
            obs: curWx[0] ?? vObs, interpolatedWeather: curWx.length ? curWx : vWx,
            az: effectiveAz, el: effectiveElev, fov: camera.fov, altitudeM,
            metar: metarRef.current, metars: metarsRef.current, fill: skySettingsRef.current.volumetricFill ?? true,
          });
          const cachedHit = vol.hasCachedScene?.(built.input, isFast) ?? false;
          if (cachedHit) {
            ++volBuildSeqRef.current;
            lastSlidingVolBuildTimeRef.current = nowPerf;
            lastVolIsFastRef.current = isFast;
            volKeyRef.current = key;
            volPendingRef.current = false;
            vol.setScene(built.input);
            volSceneOriginRef.current = { latitude: vLat, longitude: vLon };
            lastVolContMinRef.current = Math.floor(vDate.getTime() / 60000);
            volumetricStats.weatherMs = vol.weatherMs();
            volHasSceneRef.current = true;
            if (!isSlidingNow) setVolumetricStatus({ buildingScene: false, summary: built.summary + layerOpticsNote(built.input.layers, vol.physicsInfo()) });
            else setVolumetricStatus({ buildingScene: false });
            const g = built.genus;
            lastVolSceneRef.current = built.obs ? {
              t: vDate.toISOString(),
              low: Math.round(built.obs.low), mid: Math.round(built.obs.mid), high: Math.round(built.obs.high),
              total: built.obs.total != null ? Math.round(built.obs.total) : undefined,
              genus: g ? `${g.low ?? '-'}/${g.mid ?? '-'}/${g.high ?? '-'}` : '-',
              tau: built.tauDni != null ? Math.round(built.tauDni * 10) / 10 : undefined,
            } : null;
            volViewRef.current = '';
            lastVolDateSyncRef.current.targetMs = null;
            volSettleRef.current = 18;
            volFreshRef.current = false;
          } else if (
            !volHasSceneRef.current ||
            !isSlidingNow ||
            (nowPerf - lastTargetSyncPerfRef.current >= 165 && nowPerf - lastSlidingVolBuildTimeRef.current > 280)
          ) {
            const isFirstCloudScene = !volHasSceneRef.current;
            if (isFirstCloudScene) {
              vol.setScene({ ...built.input, layers: [], macro: undefined });
              volSceneOriginRef.current = { latitude: vLat, longitude: vLon };
              volHasSceneRef.current = true;
              volViewRef.current = '';
              lastVolDateSyncRef.current.targetMs = null;
            }
            lastSlidingVolBuildTimeRef.current = nowPerf;
            lastVolIsFastRef.current = isFast;
            volKeyRef.current = key;
            volPendingRef.current = true;
            volSettleRef.current = 0;
            setVolumetricStatus({ buildingScene: true });
            if (framesToRenderRef.current > 1) framesToRenderRef.current = 1;
            const myBuildSeq = ++volBuildSeqRef.current;
            const tW = Date.now();
            const asyncSliceMs = isFirstCloudScene ? 8 : (isSlidingNow ? 4 : 10);
            vol.setSceneAsync(built.input, isFast, asyncSliceMs).then(applied => {
              if (volBuildSeqRef.current !== myBuildSeq) return;
              volPendingRef.current = false;
              volumetricStats.weatherMs = vol.weatherMs();
              if (applied) {
                volHasSceneRef.current = true;
                volSceneOriginRef.current = { latitude: vLat, longitude: vLon };
                lastVolContMinRef.current = null;
                setVolumetricStatus({ buildingScene: false, summary: built.summary + layerOpticsNote(built.input.layers, vol.physicsInfo()) });
                const g = built.genus;
                lastVolSceneRef.current = built.obs ? {
                  t: vDate.toISOString(),
                  low: Math.round(built.obs.low), mid: Math.round(built.obs.mid), high: Math.round(built.obs.high),
                  total: built.obs.total != null ? Math.round(built.obs.total) : undefined,
                  genus: g ? `${g.low ?? '-'}/${g.mid ?? '-'}/${g.high ?? '-'}` : '-',
                  tau: built.tauDni != null ? Math.round(built.tauDni * 10) / 10 : undefined,
                } : null;
                volViewRef.current = '';
                lastVolDateSyncRef.current.targetMs = null;
                volSettleRef.current = 18;
                volFreshRef.current = false;
              } else if (volKeyRef.current === key) {
                volKeyRef.current = '';
                setVolumetricStatus({ buildingScene: false });
              } else {
                setVolumetricStatus({ buildingScene: false });
              }
              if (__DEV__ && Date.now() - tW > 50) console.log(`[SkyScene] 볼륨 층 ${applied ? '바꿈' : '버림'} ${Date.now() - tW}ms`);
              requestRender(3);
            }).catch(e => {
              if (volBuildSeqRef.current !== myBuildSeq) return;
              volPendingRef.current = false;
              if (volKeyRef.current === key) volKeyRef.current = '';
              volFailedRef.current = '층: ' + String((e as Error)?.message ?? e);
              setVolumetricStatus({ phase: 'failed', buildingScene: false, error: volFailedRef.current });
              console.warn('[SkyScene] 볼륨 층 생성 실패:', (e as Error)?.stack ?? e); requestRender(2);
            });
          }
        }
        // 시간 막대를 끄는 중에도 시작(다른 날로 넘어가면 그날을 곧바로 굽기 시작) — 저화질(도트) 모드에서는 24시간 백그라운드 사전 합성을 생략합니다.
        if (!isLowSpec && live && volHasSceneRef.current && (!isInteractingNow || isSlidingNow) && !volPendingRef.current && vPath.length > 0 && vol.prewarmScenesAsync) {
          startDayPrewarmIfNeeded(live, vol, vLat, vLon, vElev, vDate, vBucketMs, vPath, effectiveAz, effectiveElev, altitudeM);
        }
        if (volHasSceneRef.current) {
          const nowWall = Date.now();
          const vMs = vDate.getTime();
          const overrideMs = overrideSceneTimeMsRef.current;
          const syncDecision = evaluateVolDateSync({
            targetMs: overrideMs ?? targetTimeMsRef.current,
            overrideActive: overrideMs !== null,
            renderedMs: vMs,
            nowWall,
            lastSync: lastVolDateSyncRef.current,
            driftAnchor: driftAnchorRef.current,
            volPending: volPendingRef.current,
            isInteracting: isInteractingNow,
            // 다듬기 중에도 바람 드리프트를 미룸 — 그리는 동안 구름이 흐르면 누적이 흐르는 그림을 섞어 일렁임.
            volSettleRemaining: volSettleRef.current + volRefineRef.current,
            isLiveClock: !useCelestialStore.getState().isTimeMachineEnabled && Math.abs(targetTimeMsRef.current - nowWall) <= 60_000,
          });
          driftAnchorRef.current = syncDecision.nextAnchor;
          lastVolDateSyncRef.current = syncDecision.nextLastSync;
          const curMin = Math.floor(vMs / 60000);
          const contThrottleOk = !isInteractingNow || nowPerf - lastVolContWallMsRef.current >= 150;
          if (live && !volPendingRef.current && vol.updateContinuousScene && lastVolContMinRef.current !== curMin && contThrottleOk) {
            lastVolContMinRef.current = curMin;
            lastVolContWallMsRef.current = nowPerf;
            const contWx = vPath.length ? getInterpolatedWeather(vPath, vDate) : (weatherRef.current ?? []);
            if (contWx.length > 0) {
              const contBuilt = live.buildLiveScene({
                lat: vLat, lon: vLon, heightM: vElev, date: vDate, pathData: vPath,
                obs: contWx[0] ?? null, interpolatedWeather: contWx,
                az: effectiveAz, el: effectiveElev, fov: camera.fov, altitudeM,
                metar: metarRef.current, metars: metarsRef.current, fill: skySettingsRef.current.volumetricFill ?? true,
              });
              vol.updateContinuousScene(contBuilt.input);
              if (!isSlidingNow) setVolumetricStatus({ summary: contBuilt.summary + layerOpticsNote(contBuilt.input.layers, vol.physicsInfo()) });
            }
          }
          if (syncDecision.shouldCallSetDate) vol.setDate(vDate, syncDecision.driftSec);
          if (syncDecision.shouldResetSettle) volSettleRef.current = Math.max(volSettleRef.current, 18);
          const intervalMs = lastRenderTsRef.current > 0 ? now - lastRenderTsRef.current : 0;
          const dtSec = intervalMs > 0 ? Math.min(0.1, Math.max(0.001, intervalMs / 1000)) : 1 / 60;
          const gov = volGovRef.current;
          if (gov && (volSet.volumetricAutoRes ?? true) && isInteractingNow) {
            const next = gov.sample(intervalMs);
            if (next != null) { vol.setResolutionScale(next); volSettleRef.current = Math.max(volSettleRef.current, 18); }
          }
          volumetricStats.frameMs = gov?.emaMs ?? 0;
          volumetricStats.resScale = vol.resolutionScale();
          volumetricStats.quality = q;

          const terrainOn = !!terrainFieldRef.current?.mesh.visible;
          const buildingsOn = !!buildingFieldRef.current?.mesh.visible;
          const anyTerrainOn = terrainOn || buildingsOn;
          const qSunStep = isSlidingNow ? (1 / 1.5) : (isInteractingNow ? 4 : 20);
          const qSunAlt = Math.round(sunAltRef.current * qSunStep);
          const qSunAz = Math.round(sunAzRef.current * qSunStep);
          const bldSerial = buildingsOn ? buildingFieldRef.current!.geomSerial() : -1;
          const terrainPassKey = `${viewKey}|${qSunAlt}|${qSunAz}|${terrainFieldRef.current?.mesh.uuid ?? ''}|${terrainOn ? 1 : 0}|${bldSerial}|${urbanSerialRef.current}|${demSerialRef.current}`;
          composerNow.setTerrainLit(true);
          composerNow.prepareTerrainDistance(renderer as unknown as THREE.WebGLRenderer, scene, camera, terrainPassKey);
          const ridge = terrainOn ? terrainFieldRef.current!.sunRidge() : null;
          vol.setTerrainDistance(anyTerrainOn ? composerNow.terrainDistanceTexture() : null, anyTerrainOn ? composerNow.terrainLitTexture() : null,
            ridge?.valid ? ridge.texture : null, (seaPlaneRef.current?.material.uniforms.uSlopeVar?.value as number | undefined) ?? 0.03,
            anyTerrainOn ? composerNow.terrainLit2Texture() : null);

          if (viewKey !== volViewRef.current) {
            const volHere = volSceneOriginRef.current ?? location?.coords;
            const rawEyeOff = curEyeForKey && volHere ? localOffsetM(volHere, curEyeForKey.latitude, curEyeForKey.longitude) : { eastM: 0, northM: 0 };
            const farFromOrigin = Math.hypot(rawEyeOff.eastM, rawEyeOff.northM) > 30_000;
            vol.setEyeOffset?.(farFromOrigin ? 0 : rawEyeOff.northM, farFromOrigin ? 0 : rawEyeOff.eastM);
            vol.setView(effectiveAz, effectiveElev, camera.fov, altitudeM, volRollDeg, volOffY);
            volViewRef.current = viewKey;
            if (overrideSceneTimeMsRef.current === null && !volPendingRef.current) {
              volSettleRef.current = Math.max(volSettleRef.current, 18);
            }
          }
          // 표본 누적은 가만히 있는 다듬기 동안만(이번 프레임을 그리기 전에 정함) — 움직일 때 섞으면 구름이 일렁이고 끌립니다.
          const accumWant = volRefineRef.current > 0 && volSettleRef.current === 0 && !isInteractingNow && !isSlidingNow
            && (skySettingsRef.current.volumetricRefine ?? true) && (skySettingsRef.current.pixelArtRows ?? 0) <= 0;
          if (accumWant !== volAccumOnRef.current) { volAccumOnRef.current = accumWant; vol.setCloudAccumActive?.(accumWant); }
          vol.setGroundGrain?.(skySettingsRef.current.volumetricGroundGrain ?? 0);
          volTex = vol.renderToTexture(dtSec);
          if (volSettleRef.current > 0) {
            volSettleRef.current--;
            if (volSettleRef.current === 0 && (skySettingsRef.current.volumetricRefine ?? true) && (skySettingsRef.current.pixelArtRows ?? 0) <= 0) { volRefineRef.current = VOL_REFINE_FRAMES; volRefineStartRef.current = performance.now(); }
            if (framesToRenderRef.current < 2) framesToRenderRef.current = 2;
          } else if (volRefineRef.current > 0 && (isInteractingNow || isSlidingNow || performance.now() - volRefineStartRef.current > VOL_REFINE_MAX_MS)) {
            volRefineRef.current = 0;   // 손을 대거나 시간 상한을 넘기면 다듬기를 끝냄(느린 기기에서 오래 붙잡지 않게)
          } else if (volRefineRef.current > 0) {
            // 정착 뒤 다듬기(2026-11-26 알갱이 잡음): 시간 업스케일은 화소마다 16 프레임에 표본 하나라, 정착(18 프레임)에서 멈추면
            // 표본 1 개의 행진 잡음이 굳습니다. 손을 뗀 채로 몇 초 더 그려 구름 패스의 누적(cloudAccum)이 표본을 평균하게 합니다.
            volRefineRef.current--;
            if (framesToRenderRef.current < 2) framesToRenderRef.current = 2;
          }
        }
      } catch (e) {
        volTex = null;
        volFailedRef.current = '프레임: ' + String((e as Error)?.message ?? e);
        setVolumetricStatus({ phase: 'failed', error: volFailedRef.current });
        try { volRef.current?.dispose(); } catch { /* 이미 망가진 장면 */ }
        volRef.current = null;
        volHasSceneRef.current = false;
        volPendingRef.current = false;
        console.warn('[SkyScene] 볼륨 하늘 프레임 실패:', (e as Error)?.stack ?? e);
      }
      return volTex;
    };

    const renderFrameWithComposer = (composerNow: SceneComposerHandle, dw: number, dh: number, volTex: THREE.Texture | null) => {
      composerNow.setExternalSky(volTex);
      if (sunRef.current) setSunCloudAlpha(sunRef.current, volTex);
      if (!volTex) composerNow.setTerrainLit(false);
      for (const h of [terrainFieldRef.current, buildingFieldRef.current, seaPlaneRef.current]) {
        if (!h) continue;
        h.material.colorWrite = !volTex;
        if (h.material.uniforms.uDepthOnly) h.material.uniforms.uDepthOnly.value = volTex ? 1 : 0;
      }
      volDrewRef.current = !!volTex;
      if (volTex) volFreshRef.current = true;
      composerNow.setPixelArt(skySettingsRef.current.pixelArtRows ?? 0);

      const accumDir = accumDirectiveRef.current;
      if (accumDir) {
        const threeRenderer = renderer as unknown as THREE.WebGLRenderer;
        accumDirectiveRef.current = null;
        if (accumDir.begin) composerNow.beginAccumulation(threeRenderer);
        if (accumDir.captureStep) {
          composerNow.renderAccumStep(threeRenderer, scene, camera, {
            weight: accumDir.captureStep.weight,
            captureAsFixedBase: accumDir.captureStep.fixedBase,
            lighten: accumDir.captureStep.lighten,
          });
        }
        if (accumDir.pendingResolve) {
          composerNow.resolveAccumulation(threeRenderer, {
            exposureGain: accumDir.pendingResolve.gain,
            shadowLift: accumDir.pendingResolve.shadowLift,
            useFixedGround: accumDir.pendingResolve.fixedGround,
          });
        }
        accumDir.onDone?.();
      } else if (liveAccumRef.current?.started) {
        const liveAcc = liveAccumRef.current;
        composerNow.resolveAccumulation(renderer as unknown as THREE.WebGLRenderer, {
          exposureGain: liveAcc.exposureGain,
          shadowLift: liveAcc.shadowLift,
          useFixedGround: false,
        });
      } else {
        renderer.setViewport(0, 0, dw, dh);
        renderer.setScissorTest(false);
        composerNow.render(renderer as unknown as THREE.WebGLRenderer, scene, camera);
      }

      if (!isSceneReadyRef.current) {
        if (!VOLUMETRIC_SKY_ENABLED || !!volTex) {
          isSceneReadyRef.current = true;
          useCelestialStore.getState().setAppReady(true);
        }
      }
    };

    const refreshCelestialLabels = (frameDate: Date) => {
      const nowForLabel = Date.now();
      if (layersRef.current.labels === false || nowForLabel - lastLabelUpdateMsRef.current < 250) return;
      lastLabelUpdateMsRef.current = nowForLabel;
      const ratio = pixelRatioRef.current || 1;
      const labs = zoomProgressRef.current <= P_FOV_END + 0.05
        ? projectCelestialScreenLabels({
            camera,
            vw: layoutSizeRef.current.w || sceneWidthRef.current || gl.drawingBufferWidth / ratio,
            vh: layoutSizeRef.current.h || viewSizeRef.current.h || gl.drawingBufferHeight / ratio,
            layers: layersRef.current,
            sunPos: sunRef.current?.mesh?.position ?? null,
            moonPos: moonRef.current?.group?.position ?? null,
            sunAltDeg: sunAltRef.current,
            sunDiscRadiusDeg: sunDiscRadiusDegRef.current,
            eyeHeightM: eyeHeightRef.current,
            terrain: simRef.current?.terrain,
            equToHorizon: equToHorizonRef.current,
            frameDate,
            lang: useCelestialStore.getState().language,
            pickedTarget: pickedTargetRef.current,
            pickedView: pickedViewRef.current,
          })
        : [];
      const prevLabs = prevLabelsRef.current;
      const labelsChanged =
        labs.length !== prevLabs.length ||
        labs.some((a, i) => {
          const b = prevLabs[i];
          return a.id !== b.id || a.name !== b.name || a.color !== b.color || Math.hypot(a.x - b.x, a.y - b.y) >= 1.5;
        });
      if (labelsChanged) {
        prevLabelsRef.current = labs;
        setCelestialLabels(labs);
      }
    };

    const animate = () => {
      if (contextLost || isSnapshottingRef.current) {
        isLoopRunningRef.current = false;
        return;
      }
      if (!isActiveRef.current && !remoteViewRef.current) {
        isLoopRunningRef.current = false;
        return;
      }
      if (!remoteViewRef.current && !glVisibleForProgress(zoomProgressRef.current)) {
        isLoopRunningRef.current = false;
        return;
      }

      const now = performance.now();
      if (lastRenderTsRef.current > 0 && now - lastRenderTsRef.current < 15.5) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      syncGlDrawingBufferSize(gl);
      const dw = gl.drawingBufferWidth;
      const dh = gl.drawingBufferHeight;
      syncBufferSize(dw, dh, `${dw}x${dh}`);
      stepAdaptiveSoftScale(now);

      let isTrackingMoving = false;
      try {
        const isLive = !useCelestialStore.getState().isTimeMachineEnabled && Math.abs(targetTimeMsRef.current - Date.now()) <= 60_000;
        const wallElapsedMs = (isSlidingRef.current || !isLive) ? 0 : Math.max(0, performance.now() - lastTargetSyncPerfRef.current);
        const effectiveTimeMs = overrideSceneTimeMsRef.current ?? (targetTimeMsRef.current + wallElapsedMs);
        renderedTimeMsRef.current = effectiveTimeMs;
        const frameDate = new Date(renderedTimeMsRef.current);
        if (
          sceneDirtyRef.current ||
          isSlidingRef.current ||
          overrideSceneTimeMsRef.current !== null ||
          Math.abs(effectiveTimeMs - lastUpdateSceneTimeMsRef.current) >= 500 ||
          now - lastUpdateSceneWallMsRef.current >= 500
        ) {
          updateScene(frameDate);
          sceneDirtyRef.current = false;
          lastUpdateSceneTimeMsRef.current = effectiveTimeMs;
          lastUpdateSceneWallMsRef.current = now;
        }

        isTrackingMoving = applyTrackingStep(frameDate);
        const rv = remoteViewRef.current;
        const { altitudeM, effectiveAz, effectiveElev } = syncCameraPoseAndSurfaceOffsets(rv);
        syncTuningAndCityLightUniforms();

        const composerNow = composerRef.current;
        if (composerNow) {
          const useMoonComposerDir = sunAltRef.current < -6 && !!moonRef.current?.group.visible && layersRef.current.moon;
          if (useMoonComposerDir && moonRef.current) {
            sunDirRayVec.copy(moonRef.current.group.position).normalize();
            const moonComposerAlt = (Math.asin(Math.max(-1, Math.min(1, sunDirRayVec.y))) * 180) / Math.PI;
            composerNow.setSun(sunDirRayVec, moonComposerAlt);
          } else {
            const rayAlt = (getApparentAltitude(sunAltRef.current) * Math.PI) / 180;
            const rayAz = (sunAzRef.current * Math.PI) / 180;
            composerNow.setSun(
              sunDirRayVec.set(Math.cos(rayAlt) * Math.sin(rayAz), Math.sin(rayAlt), -Math.cos(rayAlt) * Math.cos(rayAz)),
              sunAltRef.current,
            );
          }
          const volTex = stepVolumetricScene(now, composerNow, altitudeM, effectiveAz, effectiveElev, rv);
          renderFrameWithComposer(composerNow, dw, dh, volTex);
        } else {
          renderer.setViewport(0, 0, dw, dh);
          renderer.setScissorTest(false);
          renderer.render(scene, camera);
          if (accumDirectiveRef.current) {
            const cb = accumDirectiveRef.current.onDone;
            accumDirectiveRef.current = null;
            cb?.();
          }
          if (!isSceneReadyRef.current) {
            isSceneReadyRef.current = true;
            useCelestialStore.getState().setAppReady(true);
          }
        }
        consecutiveErrors = 0;
        refreshCelestialLabels(frameDate);
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
      if (remoteViewRef.current) remoteFramesRef.current++;
      lastRenderTsRef.current = performance.now();
      lastRenderedSceneTimeMsRef.current = targetTimeMsRef.current;

      if (framesToRenderRef.current > 0) framesToRenderRef.current--;
      if (!isSceneReadyRef.current || framesToRenderRef.current > 0 || isTrackingMoving) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
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

  const syncDemAndSeaUniforms = (args: {
    targetDate: Date;
    overcast: number;
    currentLayers: LayerState;
    atmosphere: ReturnType<typeof makeAtmosphereParams>;
    seaDipDeg: number;
    moonApparentAltRad: number;
    moonAzRad: number;
    moonIrr: { r: number; g: number; b: number } | null;
    moonBeamRadiance: { r: number; g: number; b: number };
  }) => {
    const {
      targetDate, overcast, currentLayers, atmosphere, seaDipDeg,
      moonApparentAltRad, moonAzRad, moonIrr, moonBeamRadiance,
    } = args;
    const sky = cachedSkyMeanRGBRef.current;
    const horizon = cachedHorizonRGBRef.current;
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
    const sunAltRad = (getApparentAltitude(sunAltRef.current) * Math.PI) / 180;
    const lit = groundLighting(sunAltRef.current, sky, beam, sunT);

    const setSharedAtmosUniforms = (u: Record<string, THREE.IUniform>) => {
      u.uMoonAzRad.value = moonAzRad;
      u.uMoonAltRad.value = moonApparentAltRad;
      u.uSunAzRad.value = sunAzRad;
      u.uSunAltRad.value = sunAltRad;
      u.uSunAltDeg.value = sunAltRef.current;
      (u.uHazeRadiance.value as THREE.Vector3).set(horizon.r, horizon.g, horizon.b);
      u.uBeta.value = atmosphere.betaMie;
      u.uAngstrom.value = atmosphere.angstrom;
      u.uElevScale.value = atmosphere.elevScale;
      if (u.uOzoneDU) u.uOzoneDU.value = atmosphere.ozoneDU;
    };

    for (const h of [terrainFieldRef.current, buildingFieldRef.current]) {
      if (!h) continue;
      const u = h.material.uniforms;
      (u.uSurfaceIrr.value as THREE.Vector3).set(
        lit.surfaceIrr.r + (moonIrr?.r ?? 0),
        lit.surfaceIrr.g + (moonIrr?.g ?? 0),
        lit.surfaceIrr.b + (moonIrr?.b ?? 0),
      );
      (u.uSunRadiance.value as THREE.Vector3).set(lit.sunRadiance.r, lit.sunRadiance.g, lit.sunRadiance.b);
      (u.uMoonRadiance.value as THREE.Vector3).set(
        SOLAR_BEAM_SCALE * moonBeamRadiance.r,
        SOLAR_BEAM_SCALE * moonBeamRadiance.g,
        SOLAR_BEAM_SCALE * moonBeamRadiance.b,
      );
      u.uExposure.value = lit.exposure;
      u.uDiagRaw.value = skySettingsRef.current.diagRawTerrain ? 1 : 0;
      setSharedAtmosUniforms(u);
      if (u.uOvercast) u.uOvercast.value = overcast;
    }

    const cityLightsOn = currentLayers.cityLights !== false;
    const locCoords = locationRef.current?.coords;
    const cachedCity = cityLightsOn && locCoords
      ? getCachedCityField(locCoords.latitude, locCoords.longitude)
      : null;
    const cityField = cachedCity?.field ?? null;
    const localNorm = cityField ? Math.min(1.25, Math.max(0, cityField.local / CITY_REF_LOCAL)) : 0;
    const skyGlow = cityField ? cityField.skyGlow : 0;
    const cityDir = cachedCity ? cachedCity.dir : { x: 0, z: -1 };
    const nightT = Math.max(0, Math.min(1, (2.0 - sunAltRef.current) / 8.0));
    const nightFade = nightT * nightT * (3 - 2 * nightT);
    const cloudBounce = 1.0 + 0.65 * Math.min(1, Math.max(0, overcast));
    const expComp = cityExpCompRef.current;
    const tzOffsetHours = useCelestialStore.getState().timezoneOffsetHours ?? (-targetDate.getTimezoneOffset() / 60);
    const localD = new Date(targetDate.getTime() + tzOffsetHours * 3600_000);
    const localHour = localD.getUTCHours() + localD.getUTCMinutes() / 60 + localD.getUTCSeconds() / 3600;
    const cityTimeScale = localHour >= 22
      ? 1.0 - 0.32 * (localHour - 22) / 2
      : localHour < 2
        ? 0.68 - 0.33 * (localHour / 2)
        : localHour < 5
          ? 0.35
          : localHour < 7
            ? 0.35 + 0.40 * (localHour - 5) / 2
            : localHour < 18
              ? 0.75
              : 0.75 + 0.25 * (localHour - 18) / 4;
    const baseCityTerrainGain = cityLightsOn ? 0.008 * cloudBounce * nightFade * expComp * cityTimeScale : 0;
    const hasCityPatch = Boolean(cityLightsOn && cityField && cityField.patch.length > 0);
    const cityTerrainGain = baseCityTerrainGain * skyGlow;
    const cityPatchScale = 0;
    const cityWallGain = cityLightsOn ? 0.045 * Math.pow(Math.max(0, localNorm), 1.45) * cloudBounce * nightFade * expComp * cityTimeScale : 0;

    if (terrainFieldRef.current) {
      const tf = terrainFieldRef.current;
      const nextPatch = cityField?.patch ?? null;
      if (lastCityPatchRef.current?.field !== tf || lastCityPatchRef.current?.patch !== nextPatch) {
        tf.setCityPatch(nextPatch, cityField?.n ?? 0, cityField?.halfKm ?? 0);
        lastCityPatchRef.current = { field: tf, patch: nextPatch };
      }
      const tu = tf.material.uniforms;
      if (tu.uCityTerrainGain) tu.uCityTerrainGain.value = cityTerrainGain;
      if (tu.uCityPatchScale) tu.uCityPatchScale.value = cityPatchScale;
      if (tu.uCityTimeScale) tu.uCityTimeScale.value = cityTimeScale;
      if (tu.uCityDirXZ?.value) (tu.uCityDirXZ.value as THREE.Vector2).set(cityDir.x, cityDir.z);
    }
    if (buildingFieldRef.current) {
      const bu = buildingFieldRef.current.material.uniforms;
      if (bu.uCityWallGain) bu.uCityWallGain.value = cityWallGain;
      if (bu.uCityDirXZ?.value) (bu.uCityDirXZ.value as THREE.Vector2).set(cityDir.x, cityDir.z);
      if (bu.uObsElevM) bu.uObsElevM.value = simRef.current?.terrain?.observerElevation ?? 0;
      buildingFieldRef.current.setWindowLighting(
        computeNightWindowRate(localHour),
        computeNightWindowGlow(sunAltRef.current, cityLightsOn, localNorm),
      );
      const lampT = cityLightsOn ? Math.max(0, Math.min(1, (6.5 - sunAltRef.current) / 7.5)) : 0;
      const lampRegion = 0.25 + 0.75 * Math.max(0, Math.min(1, localNorm));
      const lampTime = 0.65 + 0.35 * cityTimeScale;
      const lampGlow = lampT * lampT * (3 - 2 * lampT) * lampRegion * lampTime;
      const pxRows = skySettingsRef.current.pixelArtRows ?? 0;
      const lampPxRatio = pxRows > 0 ? 0.1 : PixelRatio.get();
      buildingFieldRef.current.setLampGlow(lampGlow, lampPxRatio);
      terrainFieldRef.current?.setLampGlow(lampGlow);
    }
    if (seaPlaneRef.current) {
      const u = seaPlaneRef.current.material.uniforms;
      (u.uSurfaceIrr.value as THREE.Vector3).set(surfaceIrr.r, surfaceIrr.g, surfaceIrr.b);
      (u.uSunRadiance.value as THREE.Vector3).set(beam.r * sunT, beam.g * sunT, beam.b * sunT);
      (u.uMoonRadiance.value as THREE.Vector3).set(moonBeamRadiance.r, moonBeamRadiance.g, moonBeamRadiance.b);
      if (u.uSeaDipRad) u.uSeaDipRad.value = (seaDipDeg * Math.PI) / 180;
      u.uSlopeVar.value = 0.003 + 0.00512 * Math.max(0, layerWindsNow().low.speedKmh / 3.6);
      setSharedAtmosUniforms(u);
    }
  };

  const updateScene = useCallback((evalDate?: Date) => {
    const targetDate = evalDate || new Date(renderedTimeMsRef.current);
    const overcast = predictionRef.current?.factors?.overheadOvercast ?? 0;
    const currentLayers = layersRef.current;
    const lat = locationRef.current?.coords?.latitude ?? 37.5;
    const lng = locationRef.current?.coords?.longitude ?? 127.0;

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
      const eyeOffsetM = Math.max(0, (eyeHeightRef.current ?? 1.6) - 1.6);
      cachedAtmosphereRef.current = makeAtmosphereParams({
        visibilityM: observerWeather()?.visibility,
        humidityPct: observerWeather()?.humidity,
        aod550: observerWeather()?.aod550,
        dustUgM3: observerWeather()?.dust,
        pm10: observerWeather()?.pm10,
        observerElevM: (simRef.current?.terrain?.observerElevation ?? 0) + eyeOffsetM,
        latitude: lat,
        dayOfYear: dayOfYearOf(targetDate),
      });
      cachedAtmosphereMsRef.current = nowMs;
    }
    const atmosphere = cachedAtmosphereRef.current;

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
      const means = computeSkyAtmosphereMeans(sunAltRef.current, sunAzRef.current, atmosphere);
      cachedSkyMeanRGBRef.current = means.skyMean;
      cachedHorizonRGBRef.current = means.horizonMean;
    }

    // ── 달빛 조명 연산 (공통) ────────────────────────────────────────────────
    const obsElevForMoonM = atmosphere.observerElevM ?? ((simRef.current?.terrain?.observerElevation ?? 0) + Math.max(0, (eyeHeightRef.current ?? 1.6) - 1.6));
    const seaDipDeg = seaHorizonDipDeg(obsElevForMoonM);
    const moonPos = getMoonPositionPrecise(targetDate, lat, lng, obsElevForMoonM);
    const moonIllum = SunCalc.getMoonIllumination(targetDate);
    const mAltDegG = (moonPos.altitude * 180) / Math.PI;
    const mAzDegG = (moonPos.azimuth * 180) / Math.PI + 180;
    const moonApparentAltRad = moonPos.altitude;
    const moonAzRad = (mAzDegG * Math.PI) / 180;
    const moonLit = computeMoonGroundLighting({
      sunAltDeg: sunAltRef.current,
      mAltDeg: mAltDegG,
      mAzDeg: mAzDegG,
      seaDipDeg,
      moonFraction: moonIllum.fraction,
      overcast,
      atmosphere,
      cache: moonGroundCacheRef.current,
    });
    moonGroundCacheRef.current = moonLit.nextCache;
    const moonIrr = moonLit.moonIrr;
    const moonBeamRadiance = moonLit.moonBeamRadiance;

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

    // ── DEM 근거리 지형 · 해수면 물빛 · 야간 도시 조명 ─────────────────────────────
    syncDemAndSeaUniforms({
      targetDate, overcast, currentLayers, atmosphere, seaDipDeg,
      moonApparentAltRad, moonAzRad, moonIrr, moonBeamRadiance,
    });

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
      const eyeOffsetM = Math.max(0, (eyeHeightRef.current ?? 1.6) - 1.6);
      const sunVis = sunVisibility(sunPlaceAlt, (simRef.current?.terrain?.observerElevation ?? 0) + eyeOffsetM, sunOptics);
      const cloudOcc = (currentLayers.clouds && lastCloudOpticsRef.current)
        ? lastCloudOpticsRef.current.sunTransmittance
        : 1;
      updateSun(sunRef.current, sunAltRef.current, sunAzRef.current, atmosphere, cloudOcc, sunPlaceAlt, sunScale.scale, sunVis, {
        fovDeg: fovRef.current,
        dateMs: targetDate.getTime(),
      });
      sunDiscRadiusDegRef.current = sunScale.radiusDeg;
      if (!currentLayers.sun) sunRef.current.mesh.visible = false;
    }

    if (moonRef.current) {
      updateMoonPosition(moonRef.current, targetDate, lat, lng, {
        atmosphere,
        sunAltDeg: sunAltRef.current,
        fovDeg: fovRef.current,
      });
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

    // ── 달빛·빛지도가 깎아먹는 한계등급: 씬 시각(5분) 또는 기준 등급 변동 시 즉시 갱신 ───
    const lightEstForStars = getLightEst(lat, lng);
    const baseMagLimit = lightEstForStars ? lightEstForStars.magLimit : settings.starMagLimit;
    if (
      Math.abs(targetTimeMs - cachedMoonMagMsRef.current) > 300_000 ||
      Math.abs(baseMagLimit - cachedMoonBaseMagRef.current) > 1e-3
    ) {
      cachedMoonMagLimitRef.current = effectiveMagLimit(baseMagLimit, mAltDegG, moonIllum.fraction);
      cachedMoonMagMsRef.current = targetTimeMs;
      cachedMoonBaseMagRef.current = baseMagLimit;
    }
    // 장노출 시뮬레이션 시 노출시간·감도 배율에 비례해 어두운 한계등급 별까지 드러나도록 보너스 부여
    const exposureMagBonus =
      starBoostOverrideRef.current > 1
        ? Math.min(2.0, Math.log2(starBoostOverrideRef.current) * 1.15)
        : 0;
    const liveMagLimit = cachedMoonMagLimitRef.current + exposureMagBonus;

    if (starFieldRef.current) {
      const pxRows = settings.pixelArtRows ?? 0;
      updateStarField(starFieldRef.current, {
        equToHorizon,
        sunAltDeg: sunAltRef.current,
        brightness: settings.starBrightness * starBoostOverrideRef.current,
        magLimit: liveMagLimit,
        pixelRatio: pixelRatioRef.current,
        pixelArt: pxRows > 0,
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
        settings.starBrightness * starBoostOverrideRef.current,
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
      celestialPathsRef.current.containerGroup.visible = currentLayers.paths && !hidePathsForExposureRef.current;
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
      const isScrubbing = isSlidingRef.current || useCelestialStore.getState().isGestureBlocked;

      if (cloudRebuildTimerRef.current) {
        clearTimeout(cloudRebuildTimerRef.current);
        cloudRebuildTimerRef.current = null;
      }
      if (scrubSettleTimerRef.current) {
        clearTimeout(scrubSettleTimerRef.current);
        scrubSettleTimerRef.current = null;
      }

      const executeRebuild = () => {
        rebuildCloudsForDate(targetDate, sampled);
        lastCloudRebuildMsRef.current = Date.now();
        lastCloudSunAltRef.current = sunAltRef.current;
        lastCloudSceneMsRef.current = targetDate.getTime();
        lastCloudWeatherRef.current = weatherRef.current;
      };

      // 볼륨 하늘이 켜진 상태에서 슬라이더를 끄는 중에는 숨겨진 레거시 구름(576방위 fBm + 4096 그림자 맵) 재빌드를 미룹니다.
      if (isSlidingRef.current && volDrewRef.current) {
        cloudRebuildTimerRef.current = setTimeout(executeRebuild, 180);
      } else if (isScrubbing && !sampled) {
        cloudRebuildTimerRef.current = setTimeout(executeRebuild, 70);
      } else {
        executeRebuild();
      }
    }
  }, [location]);

  const rebuildCloudsForDate = useCallback((targetDate: Date, sampled?: SampledSky | null) => {
    let builtSamples;
    let builtOptics: ColumnOptics;
    if (sampled) {
      builtSamples = sampled.samples;
      builtOptics = sampled.optics;
    } else {
      const fan = new WeatherFan(weatherRef.current ?? [], 0);
      const obs = fan.observerData();
      const { winds: layerWinds } = resolveLayerWinds(obs);
      const driftMinutes = (targetDate.getTime() / 60000) % 1440;
      builtSamples = buildSkyColumns({
        fan,
        driftMinutes,
        windSpeedKmh: PLACEHOLDER_WIND_SPEED_KMH,
        windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
        layerWinds,
      });
      builtOptics = solveColumnOptics(builtSamples, sunAzRef.current, sunAltRef.current, layer =>
        representativeTauForObserver(layer, obs)
      );
    }

    lastCloudOpticsRef.current = builtOptics;

    // ── 땅에 지는 구름 그림자 지도 ─────────────────────────────────────────
    //
    // 하늘의 구름과 **같은 표본 배열**을 읽습니다 (utils/cloudShadowMap).
    // 따로 만들면 하늘의 구름과 땅의 그늘이 서로 다른 구름을 가리킵니다.
    //
    // 구름·해가 안 바뀌면 다시 굽지 않습니다 — 4,096번 조회라 싸지만
    // 매 프레임 할 일은 아닙니다.
    {
      const obsNow = observerWeather();
      const qAngle = (deg: number) =>
        isSlidingRef.current && volDrewRef.current
          ? (Math.round(deg / 2) * 2).toFixed(1)
          : deg.toFixed(1);
      const key = [
        qAngle(sunAltRef.current), qAngle(sunAzRef.current),
        builtSamples.length, layerMeanCover(builtSamples, 'low').toFixed(3),
        layerMeanCover(builtSamples, 'mid').toFixed(3),
        layerMeanCover(builtSamples, 'high').toFixed(3),
      ].join('|');
      if (key !== cloudShadowKeyRef.current) {
        cloudShadowKeyRef.current = key;
        cloudShadowTexRef.current = buildCloudShadowTexture({
          samples: builtSamples,
          azSteps: 24,
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

    // 태양 원반 차폐
    if (sunRef.current) {
      sunRef.current.material.uniforms.uOcclusion.value = layersRef.current.clouds
        ? builtOptics.sunTransmittance
        : 1;
    }
  }, [location]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !sim?.terrain?.bandAngles) return;
    const lat = location?.coords?.latitude ?? 37.5;
    const lng = location?.coords?.longitude ?? 127.0;
    const prevBand = bandCenterRef.current;
    if (
      prevBand &&
      prevBand.bandAngles === sim.terrain.bandAngles &&
      terrainBandsRef.current &&
      waterMaskHandleRef.current
    ) {
      const off = localOffsetM({ latitude: prevBand.lat, longitude: prevBand.lng }, lat, lng);
      if (Math.hypot(off.eastM, off.northM) < 500) return;
    }
    bandCenterRef.current = { lat, lng, bandAngles: sim.terrain.bandAngles };

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
  /** 눈의 현재 경위도: 조이스틱이 정한 것이 있으면 그것, 없으면 `location`. */
  const eyeCoords = (): { latitude: number; longitude: number } | null => eyeRef.current ?? locationRef.current?.coords ?? null;
  /** 포커싱된 지형/건물이 있으면 이동 · 눈 높이 변경 후에도 화면 중앙에 오도록 카메라 방위 · 앙각을 맞춥니다. */
  const reaimPickedTarget = () => {
    const pk = pickedTargetRef.current;
    if (!pk) { pickedViewRef.current = null; return; }
    const pt = targetPointOf(pk);
    if (!pt) return;
    const f = groundFrame();
    const here = eyeCoords();
    if (!f || !here) return;
    const ground = f.ground(0, 0) ?? simRef.current?.terrain?.observerElevation ?? 0;
    const eye = ground + (eyeHeightRef.current ?? 1.6);
    const o = localOffsetM(here, pt.latitude, pt.longitude);
    const tp = targetPointAt(f.ground, eye, o.eastM, -o.northM, pt.elevM);
    const nextEl = Math.max(-85, Math.min(85, tp.elDeg));
    pickedViewRef.current = { azDeg: tp.azDeg, elDeg: nextEl };
    cameraAzRef.current = tp.azDeg;
    cameraElevRef.current = nextEl;
    setCameraAzimuth(tp.azDeg);
    setCameraElevation(nextEl);
  };
  /**
   * 지형 · 바다 · 건물의 `uDemObs`(와 받아 둔 패치의 `observerU/V`)를 눈의 현재 자리로 맞춥니다. 받아 둔 블록 안에서는 가벼운 일이라 프레임마다 불러도 됩니다.
   * 땅 프로필(40 km, 샘플 십수만 번)은 눈 자리마다 달라지므로 비우고, 부르는 쪽(`getHorizonProfile`)이 필요할 때 다시 만듭니다.
   */
  const applyEye = () => {
    const e = eyeCoords();
    if (!e) return;
    if (
      !noiseOriginRef.current ||
      Math.hypot(
        localOffsetM({ latitude: noiseOriginRef.current.lat, longitude: noiseOriginRef.current.lng }, e.latitude, e.longitude).eastM,
        localOffsetM({ latitude: noiseOriginRef.current.lat, longitude: noiseOriginRef.current.lng }, e.latitude, e.longitude).northM,
      ) > 10_000
    ) {
      noiseOriginRef.current = { lat: e.latitude, lng: e.longitude };
    }
    const nOff = localOffsetM({ latitude: noiseOriginRef.current.lat, longitude: noiseOriginRef.current.lng }, e.latitude, e.longitude);
    const uc = urbanCenterRef.current;
    const uOff = uc ? localOffsetM({ latitude: uc.lat, longitude: uc.lng }, e.latitude, e.longitude) : { eastM: 0, northM: 0 };
    terrainFieldRef.current?.setObserver(e.latitude, e.longitude);
    terrainFieldRef.current?.setNoiseEyeOffset?.(nOff.eastM, -nOff.northM);
    terrainFieldRef.current?.setUrbanEyeOffset?.(uOff.eastM, -uOff.northM);
    seaPlaneRef.current?.setObserver(e.latitude, e.longitude);
    seaPlaneRef.current?.setWaterMaskEyeOffset?.(uOff.eastM, -uOff.northM);
    buildingFieldRef.current?.setObserver(e.latitude, e.longitude);
    const bc = bldCenterRef.current;
    const bOff = localOffsetM({ latitude: bc.lat, longitude: bc.lng }, e.latitude, e.longitude);
    buildingFieldRef.current?.setEyeOffset(bOff.eastM, -bOff.northM);
    skylineCacheRef.current = null;
    reaimPickedTarget();
    requestRender(2);
  };

  /**
   * 높이장 블록을 받아 지형 · 바다 · 건물에 꽂습니다. `location` 이 바뀔 때(아래 효과)와, 눈이 받아 둔 블록의 가운데 타일을 벗어났을 때(`setEyeLocation`)
   * 둘이 같은 길을 씁니다. 같은 자리를 이미 받았거나 받는 중이면 아무것도 안 합니다.
   */
  const isLowSpecMode = (skySettings.pixelArtRows ?? 0) > 0;
  const loadDemForRef = useRef<(lat: number, lng: number, key: string, isCancelled: () => boolean) => Promise<void>>(async () => {});
  loadDemForRef.current = async (lat, lng, key, isCancelled) => {
    demWantKeyRef.current = key;
    const wantMask = (skySettingsRef.current.pixelArtRows ?? 0) === 0;
    const needUpgradeMask = wantMask && demLoadedKeyRef.current === key && demPatchRef.current && !demMaskPatchRef.current;
    if ((demLoadedKeyRef.current === key && !needUpgradeMask) || demLoadingKeyRef.current === key) return;
    // 받아 둔 블록이 이 자리 둘레를 이미 덮으면(가운데 타일 안) 다시 받지 않고 눈 좌표만 맞춥니다 —
    // 단, 저화질에서 고화질로 전환해 60km 물 마스크(demMaskPatchRef)가 비어 있다면 마스크만 추가로 받습니다.
    const cur = demPatchRef.current;
    if (cur && blockCovers(cur, lat, lng, denseRadiusM(cur), 0) && (!wantMask || demMaskPatchRef.current)) {
      demLoadedKeyRef.current = key;
      demLoadingKeyRef.current = null;
      applyEye();
      return;
    }
    demLoadingKeyRef.current = key;
    const renderer = rendererRef.current;
    if (!renderer) { demLoadingKeyRef.current = null; return; }
    try {
      const load = (radiusM: number) => loadDemPatch(lat, lng, radiusM, {
        renderer,
        loadTexture: (url: string) => loadTextureAsync({ asset: url }),
      });
      const patch = (needUpgradeMask && cur) ? cur : await load(FIELD_FAR_M);
      // 물 마스크는 고화질 모드에서만 따로 받습니다(60km 광역 3×3 타일).
      // 저화질 도트 모드에서는 생략해 네트워크·텍스처 연산을 아끼고, 고화질로 전환할 때 추가로 받습니다.
      const maskPatch = wantMask ? await load(SEA_MASK_RADIUS_M).catch(() => null) : demMaskPatchRef.current;
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
      demMaskPatchRef.current = maskPatch;
      if (
        bldCoverRef.current &&
        blockCovers(patch, bldCoverRef.current.lat, bldCoverRef.current.lng, denseRadiusM(patch), 0)
      ) {
        moveObserver(patch, bldCoverRef.current.lat, bldCoverRef.current.lng);
        flattenDemForBuildings(renderer, patch, bldCoverRef.current.cover);
        moveObserver(patch, lat, lng);
      }
      // 한 격자가 셋을 다 받습니다 — 촘촘한 것, 발밑용(촘촘한 것), 성긴 것.
      // ⚠ 발밑 고도는 **촘촘한** 패치로 짚습니다. 성긴 것으로 읽으면 같은
      //   자리가 10.9m 낮아 이음매에 층계가 생깁니다.
      terrainFieldRef.current?.setPatch(patch, patch, maskPatch);
      buildingFieldRef.current?.setPatch(patch, patch, maskPatch);
      seaPlaneRef.current?.setPatch(patch, maskPatch);
      demSerialRef.current += 1;
      volSettleRef.current = Math.max(volSettleRef.current, 18);
      // 이제 진짜 자료가 있으니 켭니다 (마운트 직후의 발밑고도-0m
      // 근사가 화면에 비칠 일이 없습니다 — 위 mesh.visible = false 참고).
      if (patch && terrainFieldRef.current) terrainFieldRef.current.mesh.visible = true;
      if (patch && seaPlaneRef.current) seaPlaneRef.current.mesh.visible = true;
      demLoadedKeyRef.current = key;
      applyEye();   // 받는 사이 눈이 더 갔을 수 있어, 새 블록에서 눈의 현재 자리로 맞춥니다
      requestRender(10);
      demRetryCountRef.current = 0;
    } catch (e) {
      if (__DEV__) console.warn('[DEM] 높이장을 못 받았습니다 — 기존 화면으로 물러납니다.', e);
      demRecenterAfterRef.current = Date.now() + 2000;   // 눈 이동 중 새 블록 요청이 실패하면 2초 쉽니다
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
      if (!isCancelled() || demWantKeyRef.current === key) {
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
  };

  useEffect(() => {
    const lat = location?.coords?.latitude;
    const lng = location?.coords?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;

    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    let cancelled = false;
    void loadDemForRef.current(lat, lng, key, () => cancelled);

    return () => { cancelled = true; };
  }, [location, requestRender, demRetryTick, isLowSpecMode]);

  const bldLat = location?.coords?.latitude ?? 37.5665;
  const bldLng = location?.coords?.longitude ?? 126.9780;
  if (buildingLoadedKeyRef.current === null) {
    bldCenterRef.current = { lat: bldLat, lng: bldLng };
  }
  useEffect(() => {
    if (!terrainFieldRef.current || isLowSpecMode) return;

    const key = `${bldLat.toFixed(3)},${bldLng.toFixed(3)}`;
    if (urbanLoadedKeyRef.current === key) return;
    if (urbanCenterRef.current) {
      const uOff = localOffsetM({ latitude: urbanCenterRef.current.lat, longitude: urbanCenterRef.current.lng }, bldLat, bldLng);
      if (Math.hypot(uOff.eastM, uOff.northM) < 400) return;
    }

    const controller = new AbortController();
    fetchUrbanMask(bldLat, bldLng, { signal: controller.signal })
      .then((mask) => {
        if (controller.signal.aborted || !terrainFieldRef.current || !mask) return;
        urbanLoadedKeyRef.current = key;
        urbanCenterRef.current = { lat: bldLat, lng: bldLng };
        terrainFieldRef.current.setUrbanMask(mask);
        buildingFieldRef.current?.setLamps(mask.lamps, mask.lampDirs);
        seaPlaneRef.current?.setWaterMask?.(terrainFieldRef.current.waterMaskTex(), mask.halfM);
        urbanSerialRef.current += 1;
        applyEye();
        // 지도가 DEM 보다 늦게 왔으면 여기서 건물 자리 고도를 깎고 패치를 다시 꽂습니다.
        if (mask.bld) {
          // 2026-11-19 물 덮개(강·호수 자리를 평평한 수면 고도로)와 건물 발자국(건물마다 바닥을 한 높이로)도 함께
          // (demBuildingFlatten.ts 의 flattenWaterHeights · flattenFootprints).
          const cover: BuildingCover = {
            ...mask.bld,
            water: [
              ...(mask.waterHi ? [mask.waterHi] : []),
              ...(mask.water ? [{ size: mask.size, halfM: mask.halfM, data: mask.water }] : []),
            ],
            footprints: mask.footprints,
            pave: mask.pave,
          };
          bldCoverRef.current = { key, lat: bldLat, lng: bldLng, cover };
          const patch = demPatchRef.current, renderer = rendererRef.current;
          if (patch && renderer && blockCovers(patch, bldLat, bldLng, denseRadiusM(patch), 0)) {
            // 건물 발자국은 마스크 중심 위치 기준입니다 — 눈이 떨어져 있어도 그 기준으로 깎고, 끝나면 눈 자리로 되돌립니다.
            moveObserver(patch, bldLat, bldLng);
            if (flattenDemForBuildings(renderer, patch, cover)) {
              const maskPatch = demMaskPatchRef.current;
              terrainFieldRef.current.setPatch(patch, patch, maskPatch);
              buildingFieldRef.current?.setPatch(patch, patch, maskPatch);
              seaPlaneRef.current?.setPatch(patch, maskPatch);
              demSerialRef.current += 1;
            }
            applyEye();
          }
        }
        sceneDirtyRef.current = true;
        requestRender(6);
      })
      .catch(() => {});

    return () => controller.abort();
  }, [bldLat, bldLng, requestRender, buildingSyncTick, isLowSpecMode]);

  const bldEnabled = Boolean(layers.buildings);
  useEffect(() => {
    if (!bldEnabled) {
      if (buildingRetryTimerRef.current) {
        clearTimeout(buildingRetryTimerRef.current);
        buildingRetryTimerRef.current = null;
      }
      buildingRetryCountRef.current = 0;
      buildingProgressRef.current = { phase: 'idle', done: 0, total: 0 };
      if (buildingFieldRef.current) {
        buildingFieldRef.current.setVisible(false);
        sceneDirtyRef.current = true;
        requestRender(3);
      }
      return;
    }
    if (!buildingFieldRef.current) return;

    const key = `${bldLat.toFixed(3)},${bldLng.toFixed(3)}`;
    const bldDistM = buildingLoadedKeyRef.current !== null
      ? Math.hypot(
          localOffsetM({ latitude: bldCenterRef.current.lat, longitude: bldCenterRef.current.lng }, bldLat, bldLng).eastM,
          localOffsetM({ latitude: bldCenterRef.current.lat, longitude: bldCenterRef.current.lng }, bldLat, bldLng).northM,
        )
      : Infinity;
    if ((buildingLoadedKeyRef.current === key || bldDistM < 350) && buildingFieldRef.current.hasGeometry()) {
      buildingProgressRef.current = { phase: 'idle', done: 0, total: 0 };
      if (demPatchRef.current) {
        buildingFieldRef.current.setPatch(demPatchRef.current, demPatchRef.current, demMaskPatchRef.current);
      }
      buildingFieldRef.current.setVisible(true);
      applyEye();
      requestRender(4);
      return;
    }

    const controller = new AbortController();
    buildingProgressRef.current = { phase: 'loading', done: 0, total: 0 };
    fetchNearbyBuildings(bldLat, bldLng, {
      radiusM: BUILDING_RADIUS_M,
      signal: controller.signal,
      onProgress: (p) => { if (!controller.signal.aborted) buildingProgressRef.current = { phase: 'loading', done: p.done, total: p.total }; },
    })
      .then((meshData) => {
        if (controller.signal.aborted || !buildingFieldRef.current) return;
        buildingProgressRef.current = { phase: 'idle', done: 0, total: 0 };
        buildingLoadedKeyRef.current = key;
        bldCenterRef.current = { lat: bldLat, lng: bldLng };
        buildingRetryCountRef.current = 0;
        if (demPatchRef.current) {
          buildingFieldRef.current.setPatch(demPatchRef.current, demPatchRef.current, demMaskPatchRef.current);
        }
        // 먼 건물은 위치마다 따로입니다 — 자리가 바뀌었으면 비우고, 같은 자리에서 다시 읽었으면 이어 붙입니다.
        if (farLocKeyRef.current !== key) { farTilesRef.current = new Map(); farLocKeyRef.current = key; }
        nearBuildingDataRef.current = meshData;
        const merged = mergeBuildings(meshData, farTilesRef.current, bldLat, bldLng);
        mergedBuildingRef.current = merged;
        buildingFieldRef.current.setBuildings(merged);
        buildingFieldRef.current.setVisible(true);
        applyEye();
        demSerialRef.current += 1;
        volSettleRef.current = Math.max(volSettleRef.current, 18);
        if (__DEV__) {
          console.log('[Buildings] 주변 건물 로드:', meshData ? `${meshData.buildingCount}채 / ${meshData.vertexCount}정점` : '0채', key);
        }
        sceneDirtyRef.current = true;
        requestRender(10);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (__DEV__) console.warn('[Buildings] 주변 건물 데이터를 못 받았습니다.', e);
        buildingProgressRef.current = { phase: 'retry', done: 0, total: 0 };
        const n = buildingRetryCountRef.current;
        buildingRetryCountRef.current = n + 1;
        const waitMs = Math.min(30_000, 3000 * 2 ** n);
        if (buildingRetryTimerRef.current) clearTimeout(buildingRetryTimerRef.current);
        buildingRetryTimerRef.current = setTimeout(() => {
          buildingRetryTimerRef.current = null;
          setBuildingRetryTick((t) => t + 1);
        }, waitMs);
      });

    return () => controller.abort();
  }, [bldLat, bldLng, bldEnabled, requestRender, buildingSyncTick, buildingRetryTick]);

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
      if (scrubSettleTimerRef.current) {
        clearTimeout(scrubSettleTimerRef.current);
        scrubSettleTimerRef.current = null;
      }

      volRef.current?.dispose();
      volRef.current = null;
      volHasSceneRef.current = false;
      volPendingRef.current = false;

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
      urbanLoadedKeyRef.current = null;
      farAbortRef.current?.abort();
      if (buildingFieldRef.current) {
        buildingFieldRef.current.dispose();
        buildingFieldRef.current = null;
      }
      if (buildingRetryTimerRef.current) {
        clearTimeout(buildingRetryTimerRef.current);
        buildingRetryTimerRef.current = null;
      }
      buildingLoadedKeyRef.current = null;
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

      // 합성기가 잡고 있는 렌더 타깃 두 장 — 화면 크기라 놓치면 큽니다.
      composerRef.current?.dispose();
      composerRef.current = null;

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
      collapsable={false}
      style={[
        styles.container,
        fullScreen ? { flex: 1, width: '100%', height: '100%' } : { width: SCENE_WIDTH, height: SCENE_HEIGHT },
      ]}
      onLayout={(e) => {
        const lw = e.nativeEvent.layout.width;
        const lh = e.nativeEvent.layout.height;
        if (lw > 0) sceneWidthRef.current = lw;
        if (lw > 0 && lh > 0) {
          layoutSizeRef.current = { w: lw, h: lh };
          syncGlDrawingBufferSize(glRef.current);
        }
        requestRender(4);
      }}
      {...panResponder.panHandlers}
    >
      {/* 지도가 3D 위로 겹쳐 오르는 동안 3D 는 불투명 그대로(둘 다 반투명이면 가운데가 어두워짐).
             지도가 다 덮으면(넘기는 점) 숨기고 렌더 루프도 쉽니다. */}
      <Animated.View collapsable={false} style={[styles.glView, { opacity: glOpacityAnim }]} pointerEvents={zoomProgressState < P_HANDOFF ? 'auto' : 'none'}>
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
          lensAspect={showLensInfo ? width / Math.max(1, height) : undefined}
          topInset={topInset}
        />
      )}

      {/* 3D 천체 위치 2D 스크린 오버레이 라벨 핀 (지상 관측 뷰에서만 표시) */}
      {layers?.labels !== false && zoomProgressState <= P_FOV_END + 0.05 && (() => {
        const LBL_W = 84;
        const LBL_H = 24;
        const maxY = Math.max(120, sceneH - 48);
        const placed: Array<{ x: number; y: number; w: number; h: number }> = [];

        return celestialLabels.map(lbl => {
          if (lbl.id === 'pick') {
            return (
              <TouchableOpacity
                key="pick"
                activeOpacity={0.75}
                hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                onPress={() => onPickTarget?.(null)}
                style={[styles.pickRing, { left: lbl.x - 15, top: lbl.y - 15 }]}
              >
                <View style={styles.pickDot} />
              </TouchableOpacity>
            );
          }
          const isTrackingThis = trackingTarget === lbl.id;
          const rawX = Math.max(8, Math.min(sceneW - LBL_W - 8, lbl.x - 18));
          const preferredY = lbl.y >= 46 ? lbl.y - 34 : lbl.y + 18;
          const rawY = Math.max(8, Math.min(maxY - LBL_H - 6, preferredY));
          const finalY = resolveCelestialLabelY(rawX, rawY, placed, maxY, LBL_W, LBL_H);
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
                  backgroundColor: isTrackingThis ? 'rgba(56, 189, 248, 0.35)' : 'rgba(15, 23, 42, 0.58)',
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
            isNight={(sunOverlay?.fan?.nowAlt ?? 0) < 0}
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
              style={[StyleSheet.absoluteFillObject, { opacity: globeOpacityAnim, backgroundColor: '#02040A' }]}
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
                minRadius={40}
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
        <View style={[styles.radarHudPill, { top: 50 + topInset }]}>
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
            hitSlop={10}
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
