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
import { View, StyleSheet, PanResponder, useWindowDimensions, Text, TouchableOpacity } from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer } from 'expo-three';
import * as THREE from 'three';
import { Target } from 'lucide-react-native';
import SunCalc from 'suncalc';

import { createSkydome, updateSkydome, type SkydomeHandle } from './Skydome';
import { createTerrainRing, createGroundPlane, createCompassGroup, updateTerrainColors, updateGroundColors } from './TerrainRing';
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
import { buildCloudInstances, type BuildCloudsResult } from './cloudPlacement';
import { createCloudDeck, updateCloudDeck, type CloudDeckHandle } from './CloudDeck';
import { makeAtmosphereParams, skyRadiance, beamAtAltitude } from '../../utils/atmosphere';
import { getPlanetEquatorialCoord, PlanetKey } from '../../utils/celestialPlanets';

function getPlanetDirectionVector(key: PlanetKey, date: Date): THREE.Vector3 {
  const eq = getPlanetEquatorialCoord(key, date);
  const raRad = (eq.raHours / 24) * Math.PI * 2;
  const decRad = (eq.decDeg * Math.PI) / 180;
  const cd = Math.cos(decRad);
  return new THREE.Vector3(cd * Math.cos(raRad), cd * Math.sin(raRad), Math.sin(decRad)).normalize();
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
};

const DRAG_SENSITIVITY = 0.3;

/** InstancedMesh 용량. 29셀 × 최대 4개 ≈ 116이지만 여유를 둡니다. */
const MAX_CLOUDS = 320;

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
}) => {
  const { width, height } = useWindowDimensions();
  
  const SCENE_WIDTH = width - 32;
  const SCENE_HEIGHT = Math.round(height * 0.45);

  // 실시간 UI 방위 표시용 State
  const [cameraAzimuth, setCameraAzimuth] = useState<number>(sunAzimuth);
  const [celestialLabels, setCelestialLabels] = useState<Array<{ id: string; name: string; x: number; y: number; color: string }>>([]);

  // Three.js refs
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const skydomeRef = useRef<SkydomeHandle | null>(null);
  const terrainRef = useRef<THREE.Mesh | null>(null);
  const groundRef = useRef<THREE.Mesh | null>(null);
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
  const glRef = useRef<ExpoWebGLRenderingContext | null>(null);
  const animFrameRef = useRef<number>(0);

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

  const trackingTargetRef = useRef(trackingTarget);
  const onSelectTrackingTargetRef = useRef(onSelectTrackingTarget);
  const targetTimeMsRef = useRef(currentTime.getTime());
  const renderedTimeMsRef = useRef(currentTime.getTime());

  useEffect(() => { sceneWidthRef.current = SCENE_WIDTH; }, [SCENE_WIDTH]);
  useEffect(() => { skySettingsRef.current = skySettings; }, [skySettings]);
  useEffect(() => { sunAltRef.current = sunAltitude; }, [sunAltitude]);
  useEffect(() => { sunAzRef.current = sunAzimuth; }, [sunAzimuth]);
  useEffect(() => { predictionRef.current = prediction; }, [prediction]);
  useEffect(() => { simRef.current = sim; }, [sim]);
  useEffect(() => { weatherRef.current = interpolatedWeather; }, [interpolatedWeather]);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { trackingTargetRef.current = trackingTarget; }, [trackingTarget]);
  useEffect(() => { onSelectTrackingTargetRef.current = onSelectTrackingTarget; }, [onSelectTrackingTarget]);
  useEffect(() => { targetTimeMsRef.current = currentTime.getTime(); }, [currentTime]);

  const observerWeather = useCallback(() => {
    const w = weatherRef.current;
    return w && w.length > 0 ? w[0] : undefined;
  }, []);

  const getTouchDist = (touches: any[]) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
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
            setCameraAzimuth(nextAz);
          }
          lastTouchRef.current = { x: touches[0].pageX, y: touches[0].pageY };
          pinchDistRef.current = null;
        }
      },
      onPanResponderRelease: () => {
        lastTouchRef.current = null;
        pinchDistRef.current = null;
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
    skydomeRef.current = skydome;

    // 2a. Ground Plane (3D 대지 원반)
    const ground = createGroundPlane();
    scene.add(ground);
    groundRef.current = ground;

    // 2b. Compass Ring & Direction Markers (3D 지평선 방위 마커)
    const compassGroup = createCompassGroup();
    scene.add(compassGroup);
    compassGroupRef.current = compassGroup;

    // 2c. Terrain Ring
    const panoramicAngles = simRef.current?.terrain?.panoramicAngles;
    if (panoramicAngles && panoramicAngles.length > 0) {
      const terrain = createTerrainRing(panoramicAngles);
      scene.add(terrain);
      terrainRef.current = terrain;
    }

    // 3. Sun
    const sun = createSun();
    scene.add(sun.mesh);
    sunRef.current = sun;

    // 4. Moon
    const moon = createMoonGroup();
    scene.add(moon.group);
    moonRef.current = moon;

    // 5a. 은하수
    const milkyWay = createMilkyWayBand();
    scene.add(milkyWay.mesh);
    milkyWayRef.current = milkyWay;

    // 5b. 항성 + 행성
    const starField = createStarField(8);
    scene.add(starField.points);
    starFieldRef.current = starField;

    pixelRatioRef.current = Math.max(
      1,
      gl.drawingBufferWidth / Math.max(1, sceneWidthRef.current)
    );

    // 6. Celestial Paths & Standard Gnomon Shadow Pole (160cm/100cm)
    const celPaths = createCelestialPathsGroup();
    scene.add(celPaths.containerGroup);
    celestialPathsRef.current = celPaths;

    // 7. Clouds
    const atlas = bakeCloudAtlas(renderer as unknown as THREE.WebGLRenderer);
    cloudAtlasRef.current = atlas;
    const cloudField = createCloudField(atlas, MAX_CLOUDS);
    scene.add(cloudField.mesh);
    cloudFieldRef.current = cloudField;

    // 연속 구름층 — 운량이 병합 임계를 넘으면 빌보드 위로 덮입니다.
    const cloudDeck = createCloudDeck();
    scene.add(cloudDeck.group);
    cloudDeckRef.current = cloudDeck;

    // 초기 업데이트
    updateScene();

    // Render loop
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);

      // 120fps 급 시간 슬라이더 보간 (Lerp Smooth Time Shift)
      const timeDiff = targetTimeMsRef.current - renderedTimeMsRef.current;
      if (Math.abs(timeDiff) > 10) {
        renderedTimeMsRef.current += timeDiff * 0.22;
      }
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
          tPos = new THREE.Vector3(0.5, -0.4, -0.7).normalize().multiplyScalar(400).applyMatrix3(equToHorizonRef.current);
        } else if (target.startsWith('planet_')) {
          const idx = parseInt(target.split('_')[1], 10);
          const keys: PlanetKey[] = ['jupiter', 'saturn', 'venus'];
          if (keys[idx]) {
            const dir = getPlanetDirectionVector(keys[idx], frameDate);
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

      renderer.render(scene, camera);

      // 3D 천체 위치 2D 스크린 좌표 투영 라벨 계산
      if (layersRef.current.labels !== false) {
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const ratio = pixelRatioRef.current || 1;

        const proj = (v3: THREE.Vector3) => {
          const p = v3.clone().project(camera);
          const visible = p.z < 1.0 && p.x >= -1.1 && p.x <= 1.1 && p.y >= -1.1 && p.y <= 1.1;
          const px = ((p.x + 1) * w) / 2 / ratio;
          const py = ((-p.y + 1) * h) / 2 / ratio;
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
          const mwPos = new THREE.Vector3(0.5, -0.4, -0.7).normalize().multiplyScalar(400);
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
            const pDir = getPlanetDirectionVector(pl.key, frameDate);
            const pWorld = pDir.multiplyScalar(380);
            pWorld.applyMatrix3(equToHorizonRef.current);
            if (pWorld.y > 0) {
              const p = proj(pWorld);
              if (p.visible) labs.push({ id: `planet_${idx}`, name: pl.name, x: p.px, y: p.py, color: pl.color });
            }
          });
        }

        setCelestialLabels(labs);
      } else {
        setCelestialLabels([]);
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

    const sunPos = SunCalc.getPosition(targetDate, lat, lng);
    sunAltRef.current = (sunPos.altitude * 180) / Math.PI;
    sunAzRef.current = (sunPos.azimuth * 180) / Math.PI + 180;

    const atmosphere = makeAtmosphereParams({
      visibilityM: observerWeather()?.visibility,
      humidityPct: observerWeather()?.humidity,
      observerElevM: simRef.current?.terrain?.observerElevation ?? 0,
      latitude: lat,
      dayOfYear: dayOfYearOf(targetDate),
    });

    if (skydomeRef.current) {
      updateSkydome(skydomeRef.current, sunAltRef.current, sunAzRef.current, atmosphere);
    }

    if (groundRef.current) {
      updateGroundColors(groundRef.current, sunAltRef.current, overcast);
    }

    if (terrainRef.current) {
      updateTerrainColors(terrainRef.current, sunAltRef.current, sunAzRef.current, overcast, atmosphere.betaMie);
    }

    if (sunRef.current) {
      updateSun(sunRef.current, sunAltRef.current, sunAzRef.current, atmosphere);
      if (!currentLayers.sun) sunRef.current.mesh.visible = false;
    }

    if (moonRef.current) {
      updateMoonPosition(moonRef.current, targetDate, lat, lng);
      moonRef.current.group.visible = currentLayers.moon && moonRef.current.group.visible;
    }

    const equToHorizon = computeEquToHorizon(targetDate, lat, lng, equToHorizonRef.current);
    const settings = skySettingsRef.current;

    if (starFieldRef.current) {
      updateStarField(starFieldRef.current, {
        equToHorizon,
        sunAltDeg: sunAltRef.current,
        brightness: settings.starBrightness,
        magLimit: settings.starMagLimit,
        pixelRatio: pixelRatioRef.current,
        planets: buildPlanetPoints(targetDate),
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
        settings.starMagLimit
      );
      milkyWayRef.current.mesh.visible = currentLayers.milkyway;
    }

    if (celestialPathsRef.current) {
      updateCelestialPaths(celestialPathsRef.current, targetDate, lat, lng, sunAltRef.current, sunAzRef.current);
      celestialPathsRef.current.containerGroup.visible = currentLayers.paths;
    }

    if (cloudFieldRef.current) {
      cloudFieldRef.current.mesh.visible = currentLayers.clouds;
    }

    rebuildCloudsForDate(targetDate);
  }, [location]);

  const rebuildCloudsForDate = useCallback((targetDate: Date) => {
    const field = cloudFieldRef.current;
    const atlas = cloudAtlasRef.current;
    if (!field || !atlas) return;

    const lat = location?.coords?.latitude ?? 37.5;

    const atmosphere = makeAtmosphereParams({
      visibilityM: observerWeather()?.visibility,
      humidityPct: observerWeather()?.humidity,
      observerElevM: simRef.current?.terrain?.observerElevation ?? 0,
      latitude: lat,
      dayOfYear: dayOfYearOf(targetDate),
    });

    const built = buildCloudInstances({
      atlas,
      currentTime: targetDate,
      sunAltDeg: sunAltRef.current,
      sunAzDeg: sunAzRef.current,
      atmosphere,
      weather: weatherRef.current ?? [],
      maxTotal: MAX_CLOUDS,
    });

    const horizonGlow = skyRadiance(0.5, 5, sunAltRef.current, atmosphere);
    const zenithSky = skyRadiance(88, 90, sunAltRef.current, atmosphere);

    updateCloudField(field, atlas, built.instances, sunAzRef.current, sunAltRef.current, {
      horizonGlow,
      zenithSky,
      betaMie: atmosphere.betaMie,
      angstrom: atmosphere.angstrom,
      elevScale: atmosphere.elevScale,
      cloudDiffuse: built.optics.diffuseToGround,
    });
    field.mesh.visible = layersRef.current.clouds;
    lastCloudBuildRef.current = built;

    // 하늘도 구름층 아래로 들어갑니다. 이게 없으면 덱 구멍으로 맑은 날
    // 노을이 그대로 새어 나와 흐린 일몰이 시뻘겋게 탑니다.
    if (skydomeRef.current) {
      const su = skydomeRef.current.material.uniforms;
      su.uCloudDiffuse.value = layersRef.current.clouds ? built.optics.diffuseToGround : 1;
      // 22° 무리 — 권층운의 얼음 결정 굴절
      su.uHaloStrength.value = layersRef.current.clouds ? built.halo : 0;
    }

    // 태양 원반 차폐. 구름을 푼 뒤에 적용해야 같은 프레임의 값을 씁니다.
    if (sunRef.current) {
      sunRef.current.material.uniforms.uOcclusion.value = layersRef.current.clouds
        ? built.optics.sunTransmittance
        : 1;
    }

    // 연속 구름층. 빌보드와 같은 샘플·같은 대기 상태를 씁니다.
    const deck = cloudDeckRef.current;
    if (deck) {
      const sAlt = (sunAltRef.current * Math.PI) / 180;
      const sAz = (sunAzRef.current * Math.PI) / 180;
      const sunDir = new THREE.Vector3(
        Math.cos(sAlt) * Math.sin(sAz),
        Math.sin(sAlt),
        -Math.cos(sAlt) * Math.cos(sAz)
      );
      // 층별 대표 광학두께/그늘은 그 층에서 실제로 뽑힌 빌보드의 중앙값을 씁니다.
      const byLayer = (layer: 'low' | 'mid' | 'high') =>
        built.instances.filter(c => c.layer === layer);
      const medianOf = (arr: number[], fallback: number) => {
        if (arr.length === 0) return fallback;
        const s2 = [...arr].sort((a, b) => a - b);
        return s2[Math.floor(s2.length / 2)];
      };

      updateCloudDeck(deck, {
        samples: built.samples,
        // 덱도 **위층을 통과한** 직달광을 받아야 합니다.
        // 그래야 상층이 덮였을 때 아래 덱이 평평한 회색이 됩니다.
        beamFor: altKm => {
          const layer = altKm > 7 ? 'high' : altKm > 3 ? 'mid' : 'low';
          const f = built.optics.beamFactor[layer];
          const b = beamAtAltitude(sunAltRef.current, altKm, atmosphere);
          return { r: b.r * f, g: b.g * f, b: b.b * f };
        },
        ambientUp: zenithSky,
        ambientDown: skyRadiance(20, 70, sunAltRef.current, atmosphere),
        sunDir,
        sunAltDeg: sunAltRef.current,
        tauFor: layer => medianOf(byLayer(layer).map(c => c.tau), 25),
        shadowFor: layer => medianOf(byLayer(layer).map(c => c.shadowContrast), 0.5),
        timeSeconds: (targetDate.getTime() / 1000) % 100000,
        visible: layersRef.current.clouds,
      });
    }
  }, [currentTime, location]);

  useEffect(() => {
    if (sceneRef.current) {
      updateScene();
    }
  }, [sunAltitude, sunAzimuth, currentTime, prediction, layers, skySettings]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !sim?.terrain?.panoramicAngles) return;

    if (terrainRef.current) {
      scene.remove(terrainRef.current);
      terrainRef.current.geometry.dispose();
      (terrainRef.current.material as THREE.Material).dispose();
    }

    const terrain = createTerrainRing(sim.terrain.panoramicAngles);
    scene.add(terrain);
    terrainRef.current = terrain;
  }, [sim?.terrain?.panoramicAngles]);

  useEffect(() => {
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      sceneRef.current?.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      starFieldRef.current?.dispose();
      starFieldRef.current = null;
      milkyWayRef.current?.dispose();
      milkyWayRef.current = null;
      cloudDeckRef.current?.dispose();
      cloudDeckRef.current = null;
      cloudAtlasRef.current?.dispose();
      cloudAtlasRef.current = null;
      cloudFieldRef.current = null;
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
