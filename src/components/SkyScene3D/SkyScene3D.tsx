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
 * - CloudField: 10종 SVG 템플릿 아틀라스 기반 InstancedMesh 구름 (draw call 1개)
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
import { bakeCloudAtlas, type CloudAtlas } from './cloudAtlas';
import { createCloudField, updateCloudField, type CloudField } from './CloudField';
import { buildCloudInstances } from './cloudPlacement';
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

/** InstancedMesh 용량. 29셀 × 최대 4개 ≈ 116이지만 여유를 둡니다. */
const MAX_CLOUDS = 320;

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

    // 7. Clouds — SVG 템플릿 아틀라스를 1회 굽고 InstancedMesh 하나로 렌더
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
      
      const azRad = (cameraAzRef.current * Math.PI) / 180;
      const elevRad = (cameraElevRef.current * Math.PI) / 180;
      const lookDist = 100;
      camera.lookAt(
        lookDist * Math.cos(elevRad) * Math.sin(azRad),
        lookDist * Math.sin(elevRad),
        -lookDist * Math.cos(elevRad) * Math.cos(azRad)
      );

      // 빌보드 회전은 vertex shader에서 처리하므로 여기서 할 일이 없습니다.
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
    if (cloudFieldRef.current) {
      cloudFieldRef.current.mesh.visible = currentLayers.clouds;
    }

    rebuildClouds();
  }, [currentTime, location]);

  // 구름 갱신 — 지오메트리 생성/해제 없이 인스턴스 속성만 다시 씁니다.
  const rebuildClouds = useCallback(() => {
    const field = cloudFieldRef.current;
    const atlas = cloudAtlasRef.current;
    if (!field || !atlas) return;

    const factors = predictionRef.current?.factors;
    const beta = factors?.aerosolBeta ?? 0.08;
    const pathClarity = factors?.pathClarity ?? 1.0;
    const overcast = factors?.overheadOvercast ?? 0;
    const dustIntensity = Math.max(0, Math.min(1, (beta - 0.04) / 0.46));

    const instances = buildCloudInstances({
      atlas,
      latitude: location?.coords?.latitude ?? 37.5,
      longitude: location?.coords?.longitude ?? 127.0,
      currentTime,
      sunAltDeg: sunAltRef.current,
      beta,
      pathClarity,
      overcast,
      dustIntensity,
      maxTotal: MAX_CLOUDS,
    });

    updateCloudField(field, atlas, instances, sunAzRef.current, sunAltRef.current);
    field.mesh.visible = layersRef.current.clouds;
  }, [currentTime, location]);

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
      // 아틀라스 텍스처는 씬 그래프에 속하지 않으므로 별도 해제
      cloudAtlasRef.current?.dispose();
      cloudAtlasRef.current = null;
      cloudFieldRef.current = null;
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
