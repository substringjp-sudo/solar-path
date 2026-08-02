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
import { View, StyleSheet, PanResponder, useWindowDimensions, Text } from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer } from 'expo-three';
import * as THREE from 'three';

import { createSkydome, updateSkydome, type SkydomeHandle } from './Skydome';
import { createTerrainRing, createGroundPlane, createCompassGroup, updateTerrainColors, updateGroundColors } from './TerrainRing';
import { createSun, updateSun, type SunHandle } from './SunMesh';
import { createMoonGroup, updateMoonPosition } from './MoonMesh';
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
import { buildCloudInstances } from './cloudPlacement';
import { makeAtmosphereParams, skyRadiance } from '../../utils/atmosphere';

export interface LayerState {
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
}

const DEFAULT_LAYERS: LayerState = {
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
}) => {
  const { width, height } = useWindowDimensions();
  
  const SCENE_WIDTH = width - 32;
  const SCENE_HEIGHT = Math.round(height * 0.45);

  // 실시간 UI 방위 표시용 State
  const [cameraAzimuth, setCameraAzimuth] = useState<number>(sunAzimuth);

  // Three.js refs
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const skydomeRef = useRef<SkydomeHandle | null>(null);
  const terrainRef = useRef<THREE.Mesh | null>(null);
  const groundRef = useRef<THREE.Mesh | null>(null);
  const compassGroupRef = useRef<THREE.Group | null>(null);
  const sunRef = useRef<SunHandle | null>(null);
  const moonGroupRef = useRef<THREE.Group | null>(null);
  const starFieldRef = useRef<StarFieldHandle | null>(null);
  const milkyWayRef = useRef<MilkyWayHandle | null>(null);
  const celestialPathsRef = useRef<CelestialPathsGroup | null>(null);
  
  /** 별·은하수가 공유하는 적도→지평 회전 행렬 (프레임당 1회만 계산) */
  const equToHorizonRef = useRef(new THREE.Matrix3());
  const cloudAtlasRef = useRef<CloudAtlas | null>(null);
  const cloudFieldRef = useRef<CloudField | null>(null);
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

  useEffect(() => { sceneWidthRef.current = SCENE_WIDTH; }, [SCENE_WIDTH]);
  useEffect(() => { skySettingsRef.current = skySettings; }, [skySettings]);
  useEffect(() => { sunAltRef.current = sunAltitude; }, [sunAltitude]);
  useEffect(() => { sunAzRef.current = sunAzimuth; }, [sunAzimuth]);
  useEffect(() => { predictionRef.current = prediction; }, [prediction]);
  useEffect(() => { simRef.current = sim; }, [sim]);
  useEffect(() => { weatherRef.current = interpolatedWeather; }, [interpolatedWeather]);
  useEffect(() => { layersRef.current = layers; }, [layers]);

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
    const moonGroup = createMoonGroup();
    scene.add(moonGroup);
    moonGroupRef.current = moonGroup;

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

    // 6. Celestial Paths & Ground Shadow
    const celPaths = createCelestialPathsGroup();
    scene.add(celPaths.containerGroup);
    celestialPathsRef.current = celPaths;

    // 7. Clouds
    const atlas = bakeCloudAtlas(renderer as unknown as THREE.WebGLRenderer);
    cloudAtlasRef.current = atlas;
    const cloudField = createCloudField(atlas, MAX_CLOUDS);
    scene.add(cloudField.mesh);
    cloudFieldRef.current = cloudField;

    // 초기 업데이트
    updateScene();

    // Render loop
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      
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
      gl.endFrameEXP();
    };
    animate();
  }, []);

  const updateScene = useCallback(() => {
    const overcast = predictionRef.current?.factors?.overheadOvercast ?? 0;
    const currentLayers = layersRef.current;
    const lat = location?.coords?.latitude ?? 37.5;
    const lng = location?.coords?.longitude ?? 127.0;

    const atmosphere = makeAtmosphereParams({
      visibilityM: observerWeather()?.visibility,
      humidityPct: observerWeather()?.humidity,
      observerElevM: simRef.current?.terrain?.observerElevation ?? 0,
      latitude: lat,
      dayOfYear: dayOfYearOf(currentTime),
    });

    if (skydomeRef.current) {
      updateSkydome(skydomeRef.current, sunAltRef.current, sunAzRef.current, atmosphere);
    }

    if (groundRef.current) {
      updateGroundColors(groundRef.current, sunAltRef.current, overcast);
    }

    if (terrainRef.current) {
      updateTerrainColors(terrainRef.current, sunAltRef.current, overcast, 0);
    }

    if (sunRef.current) {
      updateSun(sunRef.current, sunAltRef.current, sunAzRef.current, atmosphere);
      if (!currentLayers.sun) sunRef.current.mesh.visible = false;
    }

    if (moonGroupRef.current) {
      updateMoonPosition(moonGroupRef.current, currentTime, lat, lng);
      moonGroupRef.current.visible = currentLayers.moon && moonGroupRef.current.visible;
    }

    const equToHorizon = computeEquToHorizon(currentTime, lat, lng, equToHorizonRef.current);
    const settings = skySettingsRef.current;

    if (starFieldRef.current) {
      updateStarField(starFieldRef.current, {
        equToHorizon,
        sunAltDeg: sunAltRef.current,
        brightness: settings.starBrightness,
        magLimit: settings.starMagLimit,
        pixelRatio: pixelRatioRef.current,
        planets: buildPlanetPoints(currentTime),
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
      updateCelestialPaths(celestialPathsRef.current, currentTime, lat, lng, sunAltRef.current, sunAzRef.current);
      celestialPathsRef.current.containerGroup.visible = currentLayers.paths;
    }

    if (cloudFieldRef.current) {
      cloudFieldRef.current.mesh.visible = currentLayers.clouds;
    }

    rebuildClouds();
  }, [currentTime, location]);

  const rebuildClouds = useCallback(() => {
    const field = cloudFieldRef.current;
    const atlas = cloudAtlasRef.current;
    if (!field || !atlas) return;

    const overcast = predictionRef.current?.factors?.overheadOvercast ?? 0;
    const lat = location?.coords?.latitude ?? 37.5;

    const atmosphere = makeAtmosphereParams({
      visibilityM: observerWeather()?.visibility,
      humidityPct: observerWeather()?.humidity,
      observerElevM: simRef.current?.terrain?.observerElevation ?? 0,
      latitude: lat,
      dayOfYear: dayOfYearOf(currentTime),
    });

    const instances = buildCloudInstances({
      atlas,
      latitude: lat,
      longitude: location?.coords?.longitude ?? 127.0,
      currentTime,
      sunAltDeg: sunAltRef.current,
      sunAzDeg: sunAzRef.current,
      atmosphere,
      overcast,
      maxTotal: MAX_CLOUDS,
    });

    const horizonGlow = skyRadiance(0.5, 5, sunAltRef.current, atmosphere);
    const zenithSky = skyRadiance(88, 90, sunAltRef.current, atmosphere);

    updateCloudField(field, atlas, instances, sunAzRef.current, sunAltRef.current, {
      horizonGlow,
      zenithSky,
      betaMie: atmosphere.betaMie,
      angstrom: atmosphere.angstrom,
      elevScale: atmosphere.elevScale,
    });
    field.mesh.visible = layersRef.current.clouds;
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
        <View style={[styles.compassBadge, { backgroundColor: theme?.glass ?? 'rgba(15, 23, 42, 0.75)' }]}>
          <Text style={[styles.compassText, { color: theme?.text ?? '#ffffff' }]}>
            {formatCompassText(cameraAzimuth)}
          </Text>
        </View>
        <View style={[styles.fovBadge, { backgroundColor: theme?.glass ?? 'rgba(15, 23, 42, 0.75)' }]}>
          <Text style={[styles.fovText, { color: theme?.subText ?? 'rgba(255,255,255,0.7)' }]}>
            FOV {Math.round(fovRef.current)}°
          </Text>
        </View>
      </View>
      <View style={styles.modeBadge}>
        <Text style={styles.modeText}>3D</Text>
      </View>
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
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  compassBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  compassText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
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
    fontWeight: '900',
    letterSpacing: 1,
  },
});
