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
import React, { useRef, useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, PanResponder, useWindowDimensions, Text, TouchableOpacity, ActivityIndicator, Animated } from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer } from 'expo-three';
import * as THREE from 'three';
import { Target } from 'lucide-react-native';
import SunCalc from 'suncalc';

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
} from './TerrainRing';
import { createSun, updateSun, type SunHandle } from './SunMesh';
import { createMoonGroup, updateMoonPosition, type MoonHandle } from './MoonMesh';
import {
  createStarField,
  updateStarField,
  computeEquToHorizon,
  buildPlanetPoints,
  type StarFieldHandle,
} from './StarField';
import { createMilkyWayBand, updateMilkyWay, type MilkyWayHandle } from './MilkyWayBand';
import { createCelestialPathsGroup, updateCelestialPaths, CelestialPathsGroup } from './CelestialPathMesh';
import { bakeCloudAtlas, type CloudAtlas } from './cloudAtlas';
import { createCloudField, updateCloudField, type CloudField } from './CloudField';
import {
  createCloudSlab,
  updateCloudSlab,
  bakeCloudSlabCoverage,
  coverageFromSamples,
  type CloudSlabHandle,
} from './CloudSlab';
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
  type SceneComposerHandle,
} from './SceneComposer';
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
import { resolveLayerWinds } from '../../utils/skyColumn';
import type { LayerWinds } from '../../utils/weather';
import { makeAtmosphereParams, skyRadiance, beamAtAltitude, applyCloudDimming, applyTuningUniforms, angularSeparationDeg } from '../../utils/atmosphere';
import { getTuning, subscribeTuning } from '../../utils/skyTuning';
import { getPlanetEquatorialCoord, PlanetKey } from '../../utils/celestialPlanets';
import { effectiveMagLimit } from '../../utils/moonlight';
import { useCelestialStore } from '../../store/useCelestialStore';

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
}

export const DEFAULT_SKY_SETTINGS: SkySettings = {
  starBrightness: 1.0,
  starMagLimit: 6.5,
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

export const SkyScene3D: React.FC<SkyScene3DProps> = ({
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
}) => {
  const { width, height } = useWindowDimensions();
  
  const SCENE_WIDTH = width - 32;
  const SCENE_HEIGHT = Math.round(SCENE_WIDTH * (3 / 4));

  // 실시간 UI 방위 표시용 State
  const [cameraAzimuth, setCameraAzimuth] = useState<number>(sunAzimuth);
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
  /** 방위별 수역 마스크 (docs/GROUND_PLAN.md 4단계) */
  const waterTexRef = useRef<THREE.DataTexture | null>(null);
  const compassGroupRef = useRef<THREE.Group | null>(null);
  const sunRef = useRef<SunHandle | null>(null);
  const moonRef = useRef<MoonHandle | null>(null);
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
  const cloudSlabRef = useRef<CloudSlabHandle | null>(null);
  const glRef = useRef<ExpoWebGLRenderingContext | null>(null);
  const animFrameRef = useRef<number>(0);
  const isSceneReadyRef = useRef<boolean>(false);

  // 카메라 회전 state (ref로 관리)
  const cameraAzRef = useRef(sunAzimuth);
  const cameraElevRef = useRef(5);
  const fovRef = useRef(60);
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
  const pixelRatioRef = useRef(1);
  const sceneWidthRef = useRef(SCENE_WIDTH);

  const timelineRef = useRef<SkyTimeline | null>(timeline);
  const isActiveRef = useRef(isActive);
  const trackingTargetRef = useRef(trackingTarget);
  const onSelectTrackingTargetRef = useRef(onSelectTrackingTarget);
  const targetTimeMsRef = useRef(currentTime.getTime());
  const lastCloudRebuildMsRef = useRef(0);   // 구름 마지막 재빌드 시각 (벽시계)
  const lastCloudSunAltRef   = useRef(-999); // 구름 재빌드 당시 태양 고도
  const lastCloudSceneMsRef  = useRef(-1e15); // 구름 재빌드 당시 **씬** 시각
  /** 구름 재빌드 당시 기상 배열. 정체성 비교로 슬라이더 변화를 잡습니다. */
  const lastCloudWeatherRef  = useRef<any[] | null>(null);
  const renderedTimeMsRef = useRef(currentTime.getTime());
  /** 슬라이더 패스트 스크럽 시 구름 재빌드 디바운스/취소용 타이머 ref */
  const cloudRebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);

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
  const lastCelestialPathsMsRef = useRef(0);
  /** getSunPath/getMoonPath 날짜 키 캐시 (같은 날이면 재계산 생략) */
  const cachedSunPathDateRef = useRef('');
  /** setCelestialLabels 마지막 호출 시각 (4fps = 250ms 스로틀) */
  const lastLabelUpdateMsRef = useRef(0);


  useEffect(() => { sceneWidthRef.current = SCENE_WIDTH; }, [SCENE_WIDTH]);
  useEffect(() => { skySettingsRef.current = skySettings; }, [skySettings]);
  useEffect(() => { sunAltRef.current = sunAltitude; }, [sunAltitude]);
  useEffect(() => { sunAzRef.current = sunAzimuth; }, [sunAzimuth]);
  useEffect(() => { predictionRef.current = prediction; }, [prediction]);
  useEffect(() => { simRef.current = sim; }, [sim]);
  useEffect(() => { weatherRef.current = interpolatedWeather; }, [interpolatedWeather]);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { timelineRef.current = timeline; }, [timeline]);

  // 운형 문턱·덱 밀폐·빌보드 수는 uniform이 아니라 배치 로직에 들어갑니다.
  // 바뀌면 다음 프레임에 다시 배치하도록 재빌드 조건을 깨워 둡니다.
  useEffect(() => subscribeTuning(() => {
    lastCloudSceneMsRef.current = -1e15;
    lastCloudSunAltRef.current = -999;
  }), []);
  useEffect(() => { trackingTargetRef.current = trackingTarget; }, [trackingTarget]);
  useEffect(() => { onSelectTrackingTargetRef.current = onSelectTrackingTarget; }, [onSelectTrackingTarget]);
  useEffect(() => { targetTimeMsRef.current = currentTime.getTime(); }, [currentTime]);

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
    return PRESET_OPTICS[name] ?? PRESET_OPTICS.Cumulus;
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
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
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
        // 드래그 시 자동 천체 트래킹 해제 -> 자유 조작 모드로 전환
        if (trackingTargetRef.current && onSelectTrackingTargetRef.current) {
          onSelectTrackingTargetRef.current(null);
        }
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          pinchDistRef.current = getTouchDist(touches);
          pinchFovRef.current = fovRef.current;
        } else {
          lastTouchRef.current = { x: touches[0].pageX, y: touches[0].pageY };
        }
      },
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          if (pinchDistRef.current === null) {
            pinchDistRef.current = getTouchDist(touches);
            pinchFovRef.current = fovRef.current;
            return;
          }
          const dist = getTouchDist(touches);
          if (dist > 0) {
            const ratio = pinchDistRef.current / dist;
            fovRef.current = Math.max(30, Math.min(120, pinchFovRef.current * ratio));
            if (cameraRef.current) {
              cameraRef.current.fov = fovRef.current;
              cameraRef.current.updateProjectionMatrix();
            }
          }
        } else {
          if (lastTouchRef.current) {
            const dx = touches[0].pageX - lastTouchRef.current.x;
            const dy = touches[0].pageY - lastTouchRef.current.y;
            const nextAz = (cameraAzRef.current - dx * DRAG_SENSITIVITY + 360) % 360;
            cameraAzRef.current = nextAz;
            cameraElevRef.current = Math.max(-10, Math.min(85, cameraElevRef.current + dy * DRAG_SENSITIVITY));
            // setCameraAzimuth 를 여기서 호출하지 않음 — 드래그 중 리렌더 차단
          }
          lastTouchRef.current = { x: touches[0].pageX, y: touches[0].pageY };
          pinchDistRef.current = null;
          // 나침반 UI는 100ms 스로싸럁 — 매 이벤트 React 리렌더 금지
          const nowAz = Date.now();
          if (nowAz - lastAzUpdateMsRef.current > 100) {
            lastAzUpdateMsRef.current = nowAz;
            setCameraAzimuth(cameraAzRef.current);
          }
        }
      },
      onPanResponderRelease: () => {
        lastTouchRef.current = null;
        pinchDistRef.current = null;
        // 드래그 종료: TabNavigator 스와이프 다시 허용
        useCelestialStore.getState().setGestureBlocked(false);
      },
      onPanResponderTerminate: () => {
        lastTouchRef.current = null;
        pinchDistRef.current = null;
        useCelestialStore.getState().setGestureBlocked(false);
      },
    })
  ).current;

  // GLView 컨텍스트 초기화
  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
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
    camera.position.set(0, 0, 0);
    cameraRef.current = camera;

    // 1. Skydome (물리 대기 산란 셰이더)
    const skydome = createSkydome();
    scene.add(skydome.mesh);
    assignLayer(skydome.mesh, LAYER_SOFT_SKY);
    skydomeRef.current = skydome;

    // 2a. Ground Plane (3D 대지 원반)
    const ground = createGroundPlane();
    scene.add(ground);
    assignLayer(ground, LAYER_MID);
    groundRef.current = ground;

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
      const bands = createTerrainBands(bandAngles, bandDist);
      scene.add(bands.group);
      assignLayer(bands.group, LAYER_MID);
      terrainBandsRef.current = bands;
    }

    // 3. Sun
    const sun = createSun();
    scene.add(sun.mesh);
    assignLayer(sun.mesh, LAYER_MID);
    sunRef.current = sun;

    // 4. Moon
    const moon = createMoonGroup();
    scene.add(moon.group);
    assignLayer(moon.group, LAYER_FRONT);
    moonRef.current = moon;

    // 5a. 은하수
    const milkyWay = createMilkyWayBand();
    scene.add(milkyWay.mesh);
    assignLayer(milkyWay.mesh, LAYER_MID);
    milkyWayRef.current = milkyWay;

    // 5b. 항성 + 행성
    const starField = createStarField(8);
    scene.add(starField.points);
    // 별은 점 광원이라 **반드시 원해상도**입니다 (SceneComposer 주석).
    assignLayer(starField.points, LAYER_MID);
    starFieldRef.current = starField;

    pixelRatioRef.current = Math.max(
      1,
      gl.drawingBufferWidth / Math.max(1, sceneWidthRef.current)
    );

    // 6. Celestial Paths & Standard Gnomon Shadow Pole (160cm/100cm)
    const celPaths = createCelestialPathsGroup();
    scene.add(celPaths.containerGroup);
    assignLayer(celPaths.containerGroup, LAYER_FRONT);
    celestialPathsRef.current = celPaths;

    // 7. Clouds
    const atlas = bakeCloudAtlas(renderer as unknown as THREE.WebGLRenderer);
    cloudAtlasRef.current = atlas;
    const cloudField = createCloudField(atlas, MAX_CLOUDS);
    scene.add(cloudField.mesh);
    // 빌보드는 원해상도 — 잔 파편을 만드는 것은 덱이고, 빌보드는
    // depthTest 로 지형과 깊이 비교를 합니다 (SceneComposer 주석).
    assignLayer(cloudField.mesh, LAYER_FRONT);
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
    // 덱과 빌보드는 아직 지우지 않았습니다 — 씬에는 남되 숨깁니다. 판정
    // 하네스가 그 모듈을 직접 세워 쓰고 있고, 실기기에서 슬랩을 확인하기
    // 전까지는 되돌릴 길을 열어 둡니다.
    const cloudSlab = createCloudSlab();
    scene.add(cloudSlab.mesh);
    assignLayer(cloudSlab.mesh, LAYER_SOFT_CLOUD);
    cloudSlabRef.current = cloudSlab;
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
      if (contextLost) return; // 컨텍스트 소실 시 루프 중단
      animFrameRef.current = requestAnimationFrame(animate);

      if (!isActiveRef.current) return; // 탭 비활성화 시 렌더링 스킵 (GPU/CPU 부하 및 메모리 절감)

      // ── 프레임 시간 적산 ──────────────────────────────────────────────
      {
        const now = performance.now();
        if (adaptLastTs > 0) {
          const dt = now - adaptLastTs;
          // 탭 복귀·시간 점프로 생긴 거대한 간격은 표본에서 뺍니다.
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

      try {
        // 즉시(0ms) 시간 이동 (타임 슬라이더 변경 시 부드러운 보간 없이 즉각 적용)
        renderedTimeMsRef.current = targetTimeMsRef.current;
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

            cameraAzRef.current = (cameraAzRef.current + azDiff * 0.14 + 360) % 360;
            cameraElevRef.current += (targetElev - cameraElevRef.current) * 0.14;
            setCameraAzimuth(cameraAzRef.current);
          }
        }

        const observerElev = simRef.current?.terrain?.observerElevation ?? 0;
        // 해발 고도(m) 반영: 100m당 0.2 유닛 (예: 500m 산 정상 = 1.0 유닛 오프셋)
        const cameraY = Math.max(0, observerElev * 0.002);
        camera.position.set(0, cameraY, 0);

        const azRad = (cameraAzRef.current * Math.PI) / 180;
        const elevRad = (cameraElevRef.current * Math.PI) / 180;
        const lookDist = 100;
        camera.lookAt(
          lookDist * Math.cos(elevRad) * Math.sin(azRad),
          cameraY + lookDist * Math.sin(elevRad),
          -lookDist * Math.cos(elevRad) * Math.cos(azRad)
        );

        // 개발자 튜닝 값을 매 프레임 밀어 넣습니다. 슬라이더를 움직이는 즉시
        // 스카이돔·태양·구름·덱이 같은 값으로 다시 그려집니다.
        applyTuningUniforms(skydomeRef.current?.material.uniforms);
        applyTuningUniforms(sunRef.current?.material.uniforms);
        applyTuningUniforms(cloudFieldRef.current?.material.uniforms);
        const deckLayers = cloudDeckRef.current?.layers;
        if (deckLayers) for (const dl of deckLayers) applyTuningUniforms(dl.material.uniforms);

        // 층마다 다른 해상도로 그려 합성합니다. 합성기가 없으면(생성 실패
        // 등) 예전처럼 한 번에 그립니다 — 화면이 안 나오는 것보다 낫습니다.
        const composerNow = composerRef.current;
        if (composerNow) {
          // 광선의 기준점은 **매 프레임** 넣습니다. `updateScene`에서 한 번만
          // 넣으면 카메라를 돌리는 프레임에 광선이 한 박자 늦게 따라옵니다.
          const rayAlt = (sunAltRef.current * Math.PI) / 180;
          const rayAz = (sunAzRef.current * Math.PI) / 180;
          composerNow.setSun(
            sunDirRayVec.set(
              Math.cos(rayAlt) * Math.sin(rayAz),
              Math.sin(rayAlt),
              -Math.cos(rayAlt) * Math.cos(rayAz)
            ),
            sunAltRef.current
          );
          const slabFrame = cloudSlabRef.current;
          const atmos = cachedAtmosphereRef.current;
          if (slabFrame && atmos) {
            const isSoft = composerNow.softScale > 1.0001;
            const sSize = composerNow.softSize();
            const slabW = isSoft ? sSize.width : gl.drawingBufferWidth;
            const slabH = isSoft ? sSize.height : gl.drawingBufferHeight;

            // 달의 위치 및 조도 계산
            const lat = location?.coords?.latitude ?? 37.5;
            const lng = location?.coords?.longitude ?? 127.0;
            const targetDate = new Date(targetTimeMsRef.current);
            const moonPos = SunCalc.getMoonPosition(targetDate, lat, lng);
            const moonIllum = SunCalc.getMoonIllumination(targetDate);
            const mAlt = moonPos.altitude;
            const mAz = moonPos.azimuth + Math.PI; // SunCalc South=0 -> Three.js North=0
            const mAltDeg = (mAlt * 180) / Math.PI;
            const mAzDeg = (mAz * 180) / Math.PI;

            tempMoonDirVec.set(
              Math.cos(mAlt) * Math.sin(mAz),
              Math.sin(mAlt),
              -Math.cos(mAlt) * Math.cos(mAz)
            );

            updateCloudSlab(slabFrame, {
              camera,
              widthPx: slabW,
              heightPx: slabH,
              sunDir: sunDirRayVec,
              sunAltDeg: sunAltRef.current,
              sunAzDeg: sunAzRef.current,
              moonDir: tempMoonDirVec,
              moonAltDeg: mAltDeg,
              moonIllum: moonIllum.fraction,
              // 도시광은 켜짐/꺼짐이 아니라 **그 장소가 얼마나 밝은가**입니다.
              // 광공해 설정(starMagLimit)에서 끌어옵니다 — 6.5등급(청정)이면
              // 0, 3.0등급(도심)이면 1. 별이 안 보이는 하늘이면 구름 밑면도
              // 그만큼 물드는 것이 같은 현상의 양면이라, 두 표현이 한 값을
              // 공유해야 서로 어긋나지 않습니다.
              cityLight: layersRef.current.cityLights === false
                ? 0
                : Math.max(0, Math.min(1, (6.5 - skySettingsRef.current.starMagLimit) / 3.5)),
              beamFor: altKm => beamAtAltitude(sunAltRef.current, altKm, atmos),
              atmosphere: atmos,
              layerWinds: layerWindsNow(),
              // `cloudPlacement` 의 `driftMinutes` 와 **같은 기준**입니다
              // (자정 기준 경과 분). 운량장과 잔무늬가 같이 흘러야 합니다.
              driftHours: ((targetTimeMsRef.current / 60000) % 1440) / 60,
              visible: layersRef.current.clouds !== false,
            });
          }
          composerNow.render(renderer as unknown as THREE.WebGLRenderer, scene, camera);
        } else renderer.render(scene, camera);
        consecutiveErrors = 0; // 성공적 렌더링 시 연속 오류 카운터 초기화

        // 첫 프레임 렌더 완료 시 앱 스플래시 완료 트리거
        if (!isSceneReadyRef.current) {
          isSceneReadyRef.current = true;
          useCelestialStore.getState().setAppReady(true);
        }

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

          // 1. 태양 (Sun)
          if (sunRef.current?.mesh && layersRef.current.sun && sunAltRef.current > -0.9) {
            const p = proj(sunRef.current.mesh.position);
            if (p.visible) labs.push({ id: 'sun', name: '태양 Sun', x: p.px, y: p.py, color: '#FBBF24' });
          }
          // 2. 달 (Moon)
          if (moonRef.current?.group && layersRef.current.moon) {
            const p = proj(moonRef.current.group.position);
            if (p.visible) labs.push({ id: 'moon', name: '달 Moon', x: p.px, y: p.py, color: '#38BDF8' });
          }
          // 3. 은하수 중심부 (Milky Way Center)
          if (layersRef.current.milkyway) {
            const mwPos = trackingMwVec.set(0.5, -0.4, -0.7).normalize().multiplyScalar(400);
            mwPos.applyMatrix3(equToHorizonRef.current);
            if (mwPos.y > 0) {
              const p = proj(mwPos);
              if (p.visible) labs.push({ id: 'milkyway', name: '은하수 중심 Milky Way', x: p.px, y: p.py, color: '#C4B5FD' });
            }
          }
          // 4. 주요 행성 (Planets: 목성, 토성, 금성)
          if (layersRef.current.planets) {
            const planetList: Array<{ key: PlanetKey; name: string; color: string }> = [
              { key: 'jupiter', name: '목성 Jupiter', color: '#F43F5E' },
              { key: 'saturn', name: '토성 Saturn', color: '#F59E0B' },
              { key: 'venus', name: '금성 Venus', color: '#38BDF8' },
            ];
            planetList.forEach((pl, idx) => {
              const pDir = getPlanetDirectionVector(pl.key, frameDate, tempPlanetVec);
              const pWorld = pDir.multiplyScalar(380);
              pWorld.applyMatrix3(equToHorizonRef.current);
              if (pWorld.y > 0) {
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
        // 단발성 렌더 에러로 루프 전체가 무조건 멈춰서 화면이 백화되는 현상 예방
        // 연속 10회 이상 에러 시에만 멈춤
        if (consecutiveErrors >= 10) {
          console.error('[SkyScene] Exceeded consecutive render error limit, pausing loop.');
          contextLost = true;
          return;
        }
      }

      gl.endFrameEXP();
    };
    animate();
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
      // SunCalc는 가볍고 태양 위치는 매 프레임 필요 → 항상 계산
      const sunPos = SunCalc.getPosition(targetDate, lat, lng);
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
        observerElevM: simRef.current?.terrain?.observerElevation ?? 0,
        latitude: lat,
        dayOfYear: dayOfYearOf(targetDate),
      });
      cachedAtmosphereMsRef.current = nowMs;
    }
    const atmosphere = cachedAtmosphereRef.current;

    if (skydomeRef.current) {
      updateSkydome(skydomeRef.current, sunAltRef.current, sunAzRef.current, atmosphere);
    }

    // 지면·능선이 **같이 쓰는** 하늘 조도. 몇 방향만 뽑아 평균해도 충분합니다
    // (지면은 방향을 구분해 보지 않고 전부 합쳐 받습니다). 태양 쪽이 훨씬
    // 밝으므로 방위도 같이 훑어야 편향이 없습니다.
    //
    // **코사인 가중이 핵심입니다.** 수평면이 받는 조도는 ∫L·cosθ dΩ 이라
    // 천정 쪽이 크게, 지평선 쪽이 작게 기여합니다. 균등 평균으로 내면
    // 지평선의 노을빛을 과대 반영해 지면이 실제보다 따뜻해집니다.
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
    const skyMeanRGB = { r: sr / sw, g: sg / sw, b: sb / sw };

    if (groundRef.current) {
      updateGroundColors(groundRef.current, sunAltRef.current, overcast, {
        skyMean: skyMeanRGB,
        // 물이 되비출 하늘은 **셰이더가 거울 방향으로 직접** 계산합니다
        // (atm_skyRadiance). 여기서는 대기 파라미터만 넘깁니다.
        betaMie: atmosphere.betaMie,
        angstrom: atmosphere.angstrom,
        elevScale: atmosphere.elevScale,
        waterTex: waterTexRef.current,
        // ⚠ 실측 바람이 아닙니다 — 권운 이방성과 같은 자리표시자입니다
        // (docs/CLOUD_TEXTURE_PLAN.md §15). 윤슬 폭이 실제 바람을 안 따릅니다.
        // 윤슬 폭은 수면을 흔드는 **지표 부근** 바람이 정합니다 — 하층(850 hPa)
        // 값을 씁니다. 실측이 없으면 예전과 같은 대용 상수로 내려앉습니다.
        windSpeedMs: layerWindsNow().low.speedKmh / 3.6,
        beam: beamAtAltitude(sunAltRef.current, 0, atmosphere),
        sunTransmittance: 1 - overcast,
        sunAzimuthDeg: sunAzRef.current,
      });
    }

    if (terrainBandsRef.current) {
      // 지면 원반과 **같은 조도**를 씁니다 (바로 위에서 계산한 skyMean).
      // 연무색은 방위·고도별로 뽑아, 먼 능선이 자기 뒤 하늘에 잠기게 합니다.
      updateTerrainBands(terrainBandsRef.current, sunAltRef.current, {
        skyMean: skyMeanRGB,
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
      });
    }

    if (sunRef.current) {
      updateSun(sunRef.current, sunAltRef.current, sunAzRef.current, atmosphere);
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
      celestialPathsRef.current.containerGroup.visible = currentLayers.paths;
    }

    if (cloudFieldRef.current) {
      cloudFieldRef.current.mesh.visible = false;
    }
    if (cloudDeckRef.current) {
      cloudDeckRef.current.group.visible = false;
    }
    if (cloudSlabRef.current) {
      cloudSlabRef.current.mesh.visible = currentLayers.clouds;
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
          maxTotal: getTuning().maxClouds,
        });

    lastCloudBuildRef.current = built;

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

    // 슬랩의 운량장 베이킹
    const slabNow = cloudSlabRef.current;
    if (slabNow) {
      bakeCloudSlabCoverage(slabNow, coverageFromSamples(built.samples));
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
      sim.terrain.bandAngles, sim.terrain.bandDistancesKm, undefined, sim.terrain.waterFrac);
    scene.add(bands.group);
    // 지형은 다시 만들어질 수 있습니다 — 그때도 층 배정을 잊으면 안 됩니다.
    assignLayer(bands.group, LAYER_MID);
    terrainBandsRef.current = bands;

    // 수역 마스크와 **바다 수평선 각도**를 같이 갱신합니다. 수평선은 관측
    // 고도로 정해집니다 (30m → 0.176° 내려앉음).
    waterTexRef.current?.dispose();
    waterTexRef.current = makeWaterTexture(sim.terrain.waterFrac ?? null);
    if (groundRef.current) {
      setGroundHorizon(groundRef.current, sim.terrain.observerElevation ?? 0);
    }
  }, [sim?.terrain?.bandAngles]);

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
      cloudSlabRef.current?.dispose();
      cloudSlabRef.current = null;

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

  return (
    <View style={[styles.container, fullScreen ? { flex: 1, width: '100%', height: '100%' } : { width: SCENE_WIDTH, height: SCENE_HEIGHT }]}>
      <GLView
        style={styles.glView}
        onContextCreate={onContextCreate}
        {...panResponder.panHandlers}
      />

      <View style={styles.hudOverlay} pointerEvents="none">
        <View style={[styles.fovBadge, { backgroundColor: theme?.glass ?? 'rgba(15, 23, 42, 0.75)' }]}>
          <Text style={[styles.fovText, { color: theme?.subText ?? 'rgba(255,255,255,0.7)' }]}>
            FOV {Math.round(fovRef.current)}°
          </Text>
        </View>
      </View>

      {/* 시뮬레이션 하단 수평 눈금 나침반 Bar */}
      <View style={styles.compassBarContainer} pointerEvents="none">
        <View style={styles.compassCenterPointer} />
        <View style={styles.compassTicksWrapper}>
          {(() => {
            const ticks = [];
            const centerAz = cameraAzimuth;
            const pxPerDeg = 1.8;
            for (let deg = -70; deg <= 70; deg += 5) {
              const targetAz = (centerAz + deg + 360) % 360;
              const roundedAz = Math.round(targetAz / 5) * 5 % 360;
              const x = deg * pxPerDeg;

              let label = '';
              if (roundedAz === 0) label = 'N';
              else if (roundedAz === 45) label = 'NE';
              else if (roundedAz === 90) label = 'E';
              else if (roundedAz === 135) label = 'SE';
              else if (roundedAz === 180) label = 'S';
              else if (roundedAz === 225) label = 'SW';
              else if (roundedAz === 270) label = 'W';
              else if (roundedAz === 315) label = 'NW';

              const isMajor = roundedAz % 45 === 0;
              const isMedium = roundedAz % 15 === 0;

              ticks.push(
                <View key={deg} style={[styles.tickItem, { transform: [{ translateX: x }] }]}>
                  <View
                    style={{
                      width: isMajor ? 2 : 1,
                      height: isMajor ? 10 : isMedium ? 7 : 4,
                      backgroundColor: isMajor ? '#38BDF8' : 'rgba(255,255,255,0.5)',
                    }}
                  />
                  {label !== '' && (
                    <Text style={[styles.tickLabel, { color: isMajor ? '#38BDF8' : '#E2E8F0' }]}>
                      {label}
                    </Text>
                  )}
                </View>
              );
            }
            return ticks;
          })()}
        </View>
      </View>

      {/* 방위각 숫자 배지 — compassBarContainer 밖에 별도 배치하여 눈금 가림 방지 */}
      <View style={styles.compassDegBadge} pointerEvents="none">
        <Text style={styles.compassDegText}>{Math.round(cameraAzimuth)}°</Text>
      </View>

      {/* 3D 천체 위치 2D 스크린 오버레이 라벨 핀 (충돌 방지 적용) */}
      {layers?.labels !== false && (() => {
        // 라벨 크기 추정 (px): 가로 85, 세로 22
        const LBL_W = 90;
        const LBL_H = 24;
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
            if (downY + LBL_H <= 380) {
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
          const rawY = Math.max(10, Math.min(380 - LBL_H - 10, lbl.y - 28));
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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  glView: {
    flex: 1,
  },
  hudOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
  },
  fovBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  fovText: {
    fontSize: 11,
    fontWeight: '700',
  },
  compassBarContainer: {
    position: 'absolute',
    bottom: 12,
    left: 20,
    right: 20,
    height: 38,
    backgroundColor: 'rgba(10, 15, 30, 0.75)',
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  compassCenterPointer: {
    position: 'absolute',
    top: 2,
    width: 2,
    height: 12,
    backgroundColor: '#FF4500',
    borderRadius: 1,
    zIndex: 10,
  },
  compassTicksWrapper: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  tickItem: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'flex-start',
    top: 6,
  },
  tickLabel: {
    fontSize: 9,
    fontWeight: '800',
    marginTop: 2,
  },
  compassDegBadge: {
    position: 'absolute',
    // compassBarContainer (bottom: 12, height: 38) 바로 위에 배치 → bottom: 12 + 38 + 4 = 54
    bottom: 54,
    right: 22,
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.4)',
  },
  compassDegText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '800',
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
    fontSize: 10,
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
    fontSize: 10,
    fontWeight: '800',
  },
});
