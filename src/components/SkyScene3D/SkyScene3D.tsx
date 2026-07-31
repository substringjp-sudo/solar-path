/**
 * SkyScene3D.tsx
 *
 * 3D 하늘 시뮬레이션의 메인 씬 컴포넌트.
 * GLView + Three.js로 구현하며, 기존 시뮬레이션과 동일한 데이터를 소비합니다.
 *
 * 구성:
 * - Skydome: 360° 물리 기반 하늘색
 * - TerrainRing: panoramicAngles 기반 지형 실루엣
 * - SunMesh & MoonMesh: 태양 및 달 디스크/위상
 * - CelestialObjectsMesh: 별, 은하수, 5대 행성
 * - CelestialPathMesh: 태양/달 24h 이동 궤적 & 관측자 그림자
 * - CloudMesh: flat polygon 구름 (billboard)
 */
import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import { View, StyleSheet, PanResponder, useWindowDimensions, Text } from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer } from 'expo-three';
import * as THREE from 'three';

import { createSkydome, updateSkydomeColors } from './Skydome';
import { createTerrainRing, updateTerrainColors } from './TerrainRing';
import { createSunGroup, updateSunPosition } from './SunMesh';
import { createMoonGroup, updateMoonPosition } from './MoonMesh';
import { createCelestialObjectsGroup, updateCelestialObjects, CelestialObjectsGroup } from './CelestialObjectsMesh';
import { createCelestialPathsGroup, updateCelestialPaths, CelestialPathsGroup } from './CelestialPathMesh';
import { createCloudGroup, updateCloudBillboards, type Cloud3DData } from './CloudMesh';
import { useCelestialStore } from '../../store/useCelestialStore';

export interface LayerState {
  sun: boolean;
  moon: boolean;
  stars: boolean;
  planets: boolean;
  clouds: boolean;
  paths: boolean;
}

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
}

const DEFAULT_LAYERS: LayerState = {
  sun: true,
  moon: true,
  stars: true,
  planets: true,
  clouds: true,
  paths: true,
};

const DRAG_SENSITIVITY = 0.3;

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
}) => {
  const { width, height } = useWindowDimensions();
  
  const SCENE_WIDTH = width - 32;
  const SCENE_HEIGHT = Math.round(height * 0.45);

  // Three.js refs
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const skydomeRef = useRef<THREE.Mesh | null>(null);
  const terrainRef = useRef<THREE.Mesh | null>(null);
  const sunGroupRef = useRef<THREE.Group | null>(null);
  const moonGroupRef = useRef<THREE.Group | null>(null);
  const celestialObjectsRef = useRef<CelestialObjectsGroup | null>(null);
  const celestialPathsRef = useRef<CelestialPathsGroup | null>(null);
  const cloudGroupRef = useRef<THREE.Group | null>(null);
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
  
  useEffect(() => { sunAltRef.current = sunAltitude; }, [sunAltitude]);
  useEffect(() => { sunAzRef.current = sunAzimuth; }, [sunAzimuth]);
  useEffect(() => { predictionRef.current = prediction; }, [prediction]);
  useEffect(() => { simRef.current = sim; }, [sim]);
  useEffect(() => { weatherRef.current = interpolatedWeather; }, [interpolatedWeather]);
  useEffect(() => { layersRef.current = layers; }, [layers]);

  // 터치 제스처
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
            cameraAzRef.current = (cameraAzRef.current - dx * DRAG_SENSITIVITY + 360) % 360;
            cameraElevRef.current = Math.max(-10, Math.min(85, cameraElevRef.current + dy * DRAG_SENSITIVITY));
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

    // 1. Skydome
    const skydome = createSkydome();
    scene.add(skydome);
    skydomeRef.current = skydome;

    // 2. Terrain
    const panoramicAngles = simRef.current?.terrain?.panoramicAngles;
    if (panoramicAngles && panoramicAngles.length > 0) {
      const terrain = createTerrainRing(panoramicAngles);
      scene.add(terrain);
      terrainRef.current = terrain;
    }

    // 3. Sun
    const sunGroup = createSunGroup();
    scene.add(sunGroup);
    sunGroupRef.current = sunGroup;

    // 4. Moon
    const moonGroup = createMoonGroup();
    scene.add(moonGroup);
    moonGroupRef.current = moonGroup;

    // 5. Celestial Objects (Stars, Planets, MilkyWay)
    const celObjects = createCelestialObjectsGroup();
    scene.add(celObjects.containerGroup);
    celestialObjectsRef.current = celObjects;

    // 6. Celestial Paths & Ground Shadow
    const celPaths = createCelestialPathsGroup();
    scene.add(celPaths.containerGroup);
    celestialPathsRef.current = celPaths;

    // 초기 업데이트
    updateScene();

    // Render loop
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      
      const azRad = (cameraAzRef.current * Math.PI) / 180;
      const elevRad = (cameraElevRef.current * Math.PI) / 180;
      const lookDist = 100;
      camera.lookAt(
        lookDist * Math.cos(elevRad) * Math.sin(azRad),
        lookDist * Math.sin(elevRad),
        -lookDist * Math.cos(elevRad) * Math.cos(azRad)
      );

      if (cloudGroupRef.current) {
        updateCloudBillboards(cloudGroupRef.current, camera);
      }

      renderer.render(scene, camera);
      gl.endFrameEXP();
    };
    animate();
  }, []);

  // 물리 파라미터 및 레이어 옵션 변경 시 씬 업데이트
  const updateScene = useCallback(() => {
    const beta = predictionRef.current?.factors?.aerosolBeta ?? 0.08;
    const pathClarity = predictionRef.current?.factors?.pathClarity ?? 1.0;
    const overcast = predictionRef.current?.factors?.overheadOvercast ?? 0;
    const currentLayers = layersRef.current;
    const lat = location?.coords?.latitude ?? 37.5;
    const lng = location?.coords?.longitude ?? 127.0;

    // 1. Skydome
    if (skydomeRef.current) {
      updateSkydomeColors(skydomeRef.current, sunAltRef.current, sunAzRef.current, beta, pathClarity);
    }

    // 2. Terrain
    if (terrainRef.current) {
      updateTerrainColors(terrainRef.current, sunAltRef.current, overcast, 0);
    }

    // 3. Sun (Layer 옵션 반영)
    if (sunGroupRef.current) {
      updateSunPosition(
        sunGroupRef.current,
        sunAltRef.current,
        sunAzRef.current,
        simRef.current?.terrain?.observerElevation ?? 50,
        lat,
        beta
      );
      sunGroupRef.current.visible = currentLayers.sun;
    }

    // 4. Moon (Layer 옵션 반영)
    if (moonGroupRef.current) {
      updateMoonPosition(moonGroupRef.current, currentTime, lat, lng);
      moonGroupRef.current.visible = currentLayers.moon && moonGroupRef.current.visible;
    }

    // 5. Celestial Objects (Stars, Planets, MilkyWay) (Layer 옵션 반영)
    if (celestialObjectsRef.current) {
      updateCelestialObjects(celestialObjectsRef.current, currentTime, lat, lng, sunAltRef.current);
      celestialObjectsRef.current.starsPoints.visible = currentLayers.stars && celestialObjectsRef.current.starsPoints.visible;
      celestialObjectsRef.current.milkyWayPoints.visible = currentLayers.stars && celestialObjectsRef.current.milkyWayPoints.visible;
      celestialObjectsRef.current.planetsGroup.visible = currentLayers.planets;
    }

    // 6. Celestial Paths & Ground Shadow (Layer 옵션 반영)
    if (celestialPathsRef.current) {
      updateCelestialPaths(celestialPathsRef.current, currentTime, lat, lng, sunAltRef.current, sunAzRef.current);
      celestialPathsRef.current.sunPathLine.visible = currentLayers.paths;
      celestialPathsRef.current.moonPathLine.visible = currentLayers.paths;
      celestialPathsRef.current.groundShadowMesh.visible = currentLayers.paths && celestialPathsRef.current.groundShadowMesh.visible;
    }

    // 7. Clouds (Layer 옵션 반영)
    if (cloudGroupRef.current) {
      cloudGroupRef.current.visible = currentLayers.clouds;
    }

    rebuildClouds();
  }, [currentTime, location]);

  // 구름 재생성
  const rebuildClouds = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene || !weatherRef.current || weatherRef.current.length === 0) return;

    if (cloudGroupRef.current) {
      scene.remove(cloudGroupRef.current);
      cloudGroupRef.current.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    }

    const clouds: Cloud3DData[] = [];
    const distances = [10, 30, 70, 130, 200, 280, 380];
    const angleOffsets = [-20, -10, 0, 10, 20];
    const cloudPresets: Record<string, string[]> = {
      high: ['M 0,20 C 20,15 45,8 70,12 C 85,14 110,7 130,12 C 105,16 80,13 55,20 C 35,25 15,23 0,20 Z'],
      mid: ['M 10,20 C 15,12 25,12 35,20 C 45,12 55,12 65,20 C 75,12 85,12 95,20 C 105,12 115,12 125,20 L 125,25 C 95,28 65,28 35,25 L 10,20 Z'],
      low: ['M 15,35 C 15,25 25,18 40,18 C 50,10 70,8 85,12 C 100,5 125,5 140,15 C 150,12 165,15 170,25 C 180,25 185,30 185,35 C 185,38 15,38 15,35 Z'],
    };

    const pathClarity = predictionRef.current?.factors?.pathClarity ?? 1.0;
    const sunAlt = sunAltRef.current;

    const getLayerColor = (layerType: 'high' | 'mid' | 'low', density: number) => {
      const illumAlt = layerType === 'high' ? sunAlt + 3 : layerType === 'mid' ? sunAlt + 2.2 : sunAlt + 1;
      const cloudIllum = illumAlt >= 0.5 ? 1 : illumAlt > -1.5 ? (illumAlt + 1.5) / 2 : 0;
      
      const litBase = cloudIllum > 0.5 ? 200 : 120;
      const shadowBase = 60;
      const factor = cloudIllum * pathClarity;
      
      return {
        lit: { r: litBase + factor * 55, g: litBase * 0.8 + factor * 40, b: litBase * 0.6 + factor * 20 },
        shadow: { r: shadowBase, g: shadowBase + 5, b: shadowBase + 15 },
      };
    };

    for (let col = 0; col < 5; col++) {
      for (let d = 0; d < 7; d++) {
        const pIdx = 1 + col * 7 + d;
        const w = weatherRef.current[pIdx];
        if (!w) continue;

        const dist = distances[d];
        const azOffset = angleOffsets[col];
        const absAz = (sunAzRef.current + azOffset + 360) % 360;

        (['high', 'mid', 'low'] as const).forEach(type => {
          const density = w[type] ?? 0;
          if (density < 5) return;

          const cloudAltKm = type === 'high' ? 9 : type === 'mid' ? 4 : 1;
          const elevDeg = Math.atan2(cloudAltKm, dist) * (180 / Math.PI);

          const colors = getLayerColor(type, density);
          const svgPaths = cloudPresets[type];
          const pathIdx = Math.floor(Math.random() * svgPaths.length);

          clouds.push({
            azimuthDeg: absAz,
            elevationDeg: elevDeg,
            distanceKm: dist,
            layerType: type,
            density,
            svgPath: svgPaths[pathIdx],
            litColor: colors.lit,
            shadowColor: colors.shadow,
            thickness: type === 'high' ? 0.1 : type === 'mid' ? 0.4 : 0.7,
            opacity: type === 'high' ? 0.5 : type === 'mid' ? 0.7 : 0.85,
          });
        });
      }
    }

    const cloudGroup = createCloudGroup(clouds);
    cloudGroup.visible = layersRef.current.clouds;
    scene.add(cloudGroup);
    cloudGroupRef.current = cloudGroup;
  }, []);

  useEffect(() => {
    if (sceneRef.current) {
      if (Math.abs(cameraAzRef.current - sunAzimuth) > 90) {
        cameraAzRef.current = sunAzimuth;
        cameraElevRef.current = Math.max(0, Math.min(30, sunAltitude));
      }
      updateScene();
    }
  }, [sunAltitude, sunAzimuth, currentTime, prediction, layers]);

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
    };
  }, []);

  const compassLabel = useMemo(() => {
    const az = cameraAzRef.current;
    if (az >= 337.5 || az < 22.5) return 'N';
    if (az >= 22.5 && az < 67.5) return 'NE';
    if (az >= 67.5 && az < 112.5) return 'E';
    if (az >= 112.5 && az < 157.5) return 'SE';
    if (az >= 157.5 && az < 202.5) return 'S';
    if (az >= 202.5 && az < 247.5) return 'SW';
    if (az >= 247.5 && az < 292.5) return 'W';
    return 'NW';
  }, [cameraAzRef.current]);

  return (
    <View style={[styles.container, fullScreen ? { flex: 1, width: '100%', height: '100%' } : { width: SCENE_WIDTH, height: SCENE_HEIGHT }]}>
      <GLView
        style={styles.glView}
        onContextCreate={onContextCreate}
        {...panResponder.panHandlers}
      />
      <View style={styles.hudOverlay} pointerEvents="none">
        <View style={[styles.compassBadge, { backgroundColor: theme?.glass ?? 'rgba(0,0,0,0.5)' }]}>
          <Text style={[styles.compassText, { color: theme?.text ?? '#fff' }]}>
            {compassLabel}
          </Text>
        </View>
        <View style={[styles.fovBadge, { backgroundColor: theme?.glass ?? 'rgba(0,0,0,0.5)' }]}>
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
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  compassBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  compassText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  fovBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  fovText: {
    fontSize: 10,
    fontWeight: '600',
  },
  modeBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(59, 130, 246, 0.6)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  modeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
