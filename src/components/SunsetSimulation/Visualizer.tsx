import React, { useMemo, useRef, useEffect } from 'react';
import { EARTH_RADIUS_KM } from '../../utils/earth';
import { StyleSheet, View, Text, useWindowDimensions, Platform, GestureResponderHandlers, PanResponder, TouchableOpacity, Alert } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Circle, Polygon, Path, G, Polyline, ClipPath } from 'react-native-svg';
import { Sun, Download } from 'lucide-react-native';
import { SunsetPrediction, getApparentAltitude, getHorizonDip, directBeamRGB, computeSkyGrid as originalComputeSkyGrid, rgbToCss, clamp01, skyColorAtDirection, cloudIllumination, predictSunset, getApproximatedSkyColor } from '../../utils/sunsetPhysics';
import { useCelestialStore } from '../../store/useCelestialStore';
import { t } from '../../utils/i18n';
import { getLocalTimeAtLocation, formatLocalTime } from '../../utils/timezone';
import { GridCloudShape } from '../../utils/cloudGridRenderer';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { generateSimulationImage, captureVisualizerSnapshot } from '../../utils/simulationImage';
import { sunPosition } from '../../utils/solarPosition';
import { getInterpolatedWeather } from '../../utils/weather';

// 하늘 격자 계산용 전역 캐시 맵
const skyGridCache = new Map<string, any[]>();

function cachedComputeSkyGrid(
  apparentSunAlt: number,
  sunAz: number,
  heading: number,
  visualFov: number,
  beta: number,
  pathClarity: number,
  verticalFovDeg: number
): any[] {
  const roundedAlt = Math.round(apparentSunAlt * 5) / 5;
  const roundedAz = Math.round(sunAz * 2) / 2;
  const key = `${roundedAlt.toFixed(1)}_${roundedAz.toFixed(1)}_${heading.toFixed(0)}_${visualFov.toFixed(0)}_${beta.toFixed(3)}_${pathClarity.toFixed(2)}`;
  
  if (skyGridCache.has(key)) {
    return skyGridCache.get(key)!;
  }
  
  const result = originalComputeSkyGrid(
    apparentSunAlt,
    sunAz,
    heading,
    visualFov,
    beta,
    pathClarity,
    verticalFovDeg
  );
  
  skyGridCache.set(key, result);
  return result;
}

interface VisualizerProps {
  prediction: SunsetPrediction | null;
  sim: any;
  interpolatedWeather: any[];
  heading: number;
  visualFov: number;
  onFovChange?: (fov: number) => void;
  currentTime: Date;
  sunAltitude: number;
  eventAzimuths: { sunrise: number; sunset: number };
  theme: any;
  panHandlers: GestureResponderHandlers;
  gridCloudShapes?: GridCloudShape[];
  location?: any;
  isSliding?: boolean;
  snapshotRef?: React.RefObject<any>;
}

interface RGB {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(colorStr: string): RGB {
  const str = colorStr.trim().toLowerCase();
  const rgbaRegex = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/;
  const match = str.match(rgbaRegex);
  if (match) {
    return {
      r: parseInt(match[1], 10),
      g: parseInt(match[2], 10),
      b: parseInt(match[3], 10),
      a: match[4] !== undefined ? parseFloat(match[4]) : 1,
    };
  }
  if (str.startsWith('#')) {
    const hex = str.substring(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16),
        a: 1,
      };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16),
        a: parseInt(hex.substring(6, 8), 16) / 255,
      };
    }
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

function interpolateColors(c1: RGB, c2: RGB, factor: number): RGB {
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * factor),
    g: Math.round(c1.g + (c2.g - c1.g) * factor),
    b: Math.round(c1.b + (c2.b - c1.b) * factor),
    a: c1.a + (c2.a - c1.a) * factor,
  };
}

const mixRgb = (
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number
): { r: number; g: number; b: number } => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});

function colorToString(rgb: RGB): string {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${rgb.a})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 10 Cloud Genera Types & Physics Parameters
// ─────────────────────────────────────────────────────────────────────────────
// 운형 프리셋과 SVG 템플릿은 순수 데이터라 utils/cloudPresets.ts로 옮겼습니다.
// (React Native 컴포넌트에 묶여 있으면 3D 쪽에서 재사용·검증이 안 됩니다.)
// 기존 import 경로를 깨지 않도록 여기서 그대로 재수출합니다.
import {
  getCloudPreset,
  CLOUD_TEMPLATES,
  CLOUD_TEMPLATES_HORIZONTAL,
  type CloudPresetName,
  type CloudPreset,
} from '../../utils/cloudPresets';
import { dataColor } from '../../theme/tokens';

export {
  getCloudPreset,
  CLOUD_TEMPLATES,
  CLOUD_TEMPLATES_HORIZONTAL,
  type CloudPresetName,
  type CloudPreset,
};

export function getSunBeamColor(alt: number): { r: number; g: number; b: number } {
  if (alt > 12.0) {
    return { r: 1.0, g: 1.0, b: 1.0 };
  } else if (alt > 5.0) {
    const t = Math.max(0, Math.min(1, (alt - 5.0) / 7.0));
    return {
      r: 1.0,
      g: 0.85 + t * 0.15,
      b: 0.20 + t * 0.80,
    };
  } else if (alt > 1.5) {
    const t = Math.max(0, Math.min(1, (alt - 1.5) / 3.5));
    return {
      r: 1.0,
      g: 0.45 + t * 0.40,
      b: 0.02 + t * 0.18,
    };
  } else if (alt > -2.0) {
    const t = Math.max(0, Math.min(1, (alt - (-2.0)) / 3.5));
    return {
      r: 1.0,
      g: 0.12 + t * 0.33,
      b: 0.00 + t * 0.02,
    };
  } else if (alt > -7.0) {
    const t = Math.max(0, Math.min(1, (alt - (-7.0)) / 5.0));
    return {
      r: 0.85 + t * 0.15,
      g: 0.02 + t * 0.10,
      b: 0.01 + t * 0.01,
    };
  } else {
    const t = Math.max(0, Math.min(1, (alt + 12.0) / 5.0));
    return {
      r: 0.10 + t * 0.75,
      g: 0.01 + t * 0.01,
      b: 0.03 + t * 0.01,
    };
  }
}

export interface ApproximatedCloudColors {
  litRGB: RGB;
  shadowRGB: RGB;
  midRGB: RGB;
  cloudIllum: number;
  beamIntensity: number;
  baseRGB: RGB;
}

const cloudColorsCache = new Map<string, ApproximatedCloudColors>();

export function approximateCloudColors(
  sunAltFromCloud: number,
  layerType: 'high' | 'mid' | 'low',
  preset: CloudPreset,
  weatherFactors: { pathClarity: number },
  overcast: number,
  dustIntensity: number,
  ambientSky: { r: number; g: number; b: number },
  cloudBeam: { r: number; g: number; b: number }
): ApproximatedCloudColors {
  const roundedAlt = Math.round(sunAltFromCloud * 5) / 5;
  const key = `${roundedAlt.toFixed(1)}_${layerType}_${preset.name}_${weatherFactors.pathClarity.toFixed(2)}_${overcast.toFixed(2)}_${dustIntensity.toFixed(2)}_${ambientSky.r.toFixed(2)}_${ambientSky.g.toFixed(2)}_${ambientSky.b.toFixed(2)}_${cloudBeam.r.toFixed(2)}_${cloudBeam.g.toFixed(2)}_${cloudBeam.b.toFixed(2)}`;
  
  if (cloudColorsCache.has(key)) {
    return cloudColorsCache.get(key)!;
  }

  // 1. 선형 근사 조도 (cloudIllumination과 동일한 선형 매핑 적용)
  let dip = 1.0;
  if (layerType === 'high') dip = 3.0;
  else if (layerType === 'mid') dip = 2.2;
  
  const sunFromCloud = sunAltFromCloud + dip;
  let cloudIllum = 0;
  if (sunFromCloud >= 0.5) cloudIllum = 1;
  else if (sunFromCloud > -1.5) cloudIllum = (sunFromCloud + 1.5) / 2.0;

  // 2. 태양 고도(sunAltFromCloud) 기반 구름 직사광(cloudSunlight) 고속 선형 근사
  let cloudSunlight = { r: 0.98, g: 0.50, b: 0.15 };
  if (sunAltFromCloud > 5) {
    cloudSunlight = { r: 0.98, g: 0.95, b: 0.88 };
  } else if (sunAltFromCloud >= -2) {
    const t = (sunAltFromCloud + 2) / 7;
    cloudSunlight.g = 0.50 + 0.45 * t;
    cloudSunlight.b = 0.15 + 0.73 * t;
  }

  // 얼음 구름(high)인 경우 핑크빛 추가 선형 보간 (sunAltFromCloud <= 4)
  if (layerType === 'high' && sunAltFromCloud <= 4) {
    const tIce = Math.max(0, Math.min(1, (sunAltFromCloud + 4) / 8));
    cloudSunlight.r = 1.0 + (0.98 - 1.0) * tIce;
    cloudSunlight.g = 0.45 + (cloudSunlight.g - 0.45) * tIce;
    cloudSunlight.b = 0.65 + (cloudSunlight.b - 0.65) * tIce;
  }

  // 3. 구름 고유 반사광(localCloudBeamRGB) 계산
  const baseLit = layerType === 'high' ? 1.4 : layerType === 'mid' ? 1.2 : 0.9;
  const mixFactor = Math.max(0, Math.min(1, cloudIllum * baseLit * (weatherFactors.pathClarity * 0.5 + 0.5)));
  
  const SHADOWED_CLOUD_LINEAR = { r: 0.22, g: 0.24, b: 0.3 };
  const localCloudBeamRGB = {
    r: SHADOWED_CLOUD_LINEAR.r + (cloudSunlight.r - SHADOWED_CLOUD_LINEAR.r) * mixFactor,
    g: SHADOWED_CLOUD_LINEAR.g + (cloudSunlight.g - SHADOWED_CLOUD_LINEAR.g) * mixFactor,
    b: SHADOWED_CLOUD_LINEAR.b + (cloudSunlight.b - SHADOWED_CLOUD_LINEAR.b) * mixFactor,
  };

  // 4. 구름 기본 색상 결정 및 날씨 영향도 보간
  let baseRGB = {
    r: Math.round(localCloudBeamRGB.r * 255),
    g: Math.round(localCloudBeamRGB.g * 255),
    b: Math.round(localCloudBeamRGB.b * 255),
    a: 1
  };
  
  if (overcast > 0.5) {
    const overcastWeight = overcast * 0.8;
    baseRGB.r = Math.round(baseRGB.r + (90 - baseRGB.r) * overcastWeight);
    baseRGB.g = Math.round(baseRGB.g + (95 - baseRGB.g) * overcastWeight);
    baseRGB.b = Math.round(baseRGB.b + (105 - baseRGB.b) * overcastWeight);
  }
  if (dustIntensity > 0.5) {
    const dustWeight = dustIntensity * 0.7;
    baseRGB.r = Math.round(baseRGB.r + (120 - baseRGB.r) * dustWeight);
    baseRGB.g = Math.round(baseRGB.g + (105 - baseRGB.g) * dustWeight);
    baseRGB.b = Math.round(baseRGB.b + (90 - baseRGB.b) * dustWeight);
  }

  // 5. 직사 및 앰비언트 셰이딩 광선 결정 (선형 보간)
  const beamIntensity = cloudIllum * weatherFactors.pathClarity;
  const litIntensity = beamIntensity * 0.85;
  const litLight = {
    r: ambientSky.r + (cloudBeam.r - ambientSky.r) * litIntensity,
    g: ambientSky.g + (cloudBeam.g - ambientSky.g) * litIntensity,
    b: ambientSky.b + (cloudBeam.b - ambientSky.b) * litIntensity,
  };

  const darkShadowRGB = { r: 0.05, g: 0.06, b: 0.12 };
  const shadowIntensity = preset.shadowContrast * 0.85;
  const shadowLight = {
    r: ambientSky.r + (darkShadowRGB.r - ambientSky.r) * shadowIntensity,
    g: ambientSky.g + (darkShadowRGB.g - ambientSky.g) * shadowIntensity,
    b: ambientSky.b + (darkShadowRGB.b - ambientSky.b) * shadowIntensity,
  };

  // 6. 구름 종류별 커스텀 기상 튜닝 선형 적용
  if (preset.name === 'Altostratus') {
    // 회청색 강제화
    baseRGB = { r: 130, g: 140, b: 160, a: 1 };
  } else if (preset.name === 'Nimbostratus') {
    // 어두운 회청색 폭풍우 톤 강제화 및 추가 어둠 보정
    baseRGB = { r: 90, g: 100, b: 115, a: 1 };
  } else if (preset.name === 'Stratus') {
    // 반투명한 하얀색 면 강제화
    baseRGB = { r: 245, g: 248, b: 255, a: 1 };
  }

  const litBlend = 0.9 - preset.thickness * 0.25;
  const shadowBlend = 0.8 - preset.thickness * 0.1;

  const litRGB = {
    r: Math.round(baseRGB.r + (litLight.r * 255 - baseRGB.r) * litBlend),
    g: Math.round(baseRGB.g + (litLight.g * 255 - baseRGB.g) * litBlend),
    b: Math.round(baseRGB.b + (litLight.b * 255 - baseRGB.b) * litBlend),
    a: 1
  };

  const shadowRGB = {
    r: Math.round(baseRGB.r + (shadowLight.r * 255 - baseRGB.r) * shadowBlend),
    g: Math.round(baseRGB.g + (shadowLight.g * 255 - baseRGB.g) * shadowBlend),
    b: Math.round(baseRGB.b + (shadowLight.b * 255 - baseRGB.b) * shadowBlend),
    a: 1
  };

  if (layerType === 'high' && preset.thickness < 0.4) {
    // 지구 그림자에 가려지지 않은 상태(cloudIllum > 0)일 때는 그림자가 붉게 물들게(litRGB에 가깝게) 보간
    // cloudIllum이 0이 되면(지구 그림자에 완전히 들어감) 원래의 회색 그림자(shadowRGB)가 됨
    const redGlowFactor = cloudIllum;
    if (redGlowFactor > 0) {
      shadowRGB.r = Math.round(shadowRGB.r + (litRGB.r - shadowRGB.r) * redGlowFactor * 0.95);
      shadowRGB.g = Math.round(shadowRGB.g + (litRGB.g - shadowRGB.g) * redGlowFactor * 0.95);
      shadowRGB.b = Math.round(shadowRGB.b + (litRGB.b - shadowRGB.b) * redGlowFactor * 0.95);
    }
  }

  return {
    litRGB,
    shadowRGB,
    midRGB: {
      r: Math.round(shadowRGB.r + (litRGB.r - shadowRGB.r) * 0.45),
      g: Math.round(shadowRGB.g + (litRGB.g - shadowRGB.g) * 0.45),
      b: Math.round(shadowRGB.b + (litRGB.b - shadowRGB.b) * 0.45),
      a: 1
    },
    cloudIllum,
    beamIntensity,
    baseRGB
  };
}


export const Visualizer: React.FC<VisualizerProps> = ({
  prediction,
  sim,
  interpolatedWeather,
  heading,
  visualFov,
  onFovChange,
  currentTime,
  sunAltitude,
  eventAzimuths,
  theme,
  panHandlers,
  gridCloudShapes,
  location,
  isSliding = false,
  snapshotRef,
}) => {
  const internalRef = useRef<any>(null);
  const targetViewRef = snapshotRef || internalRef;
  const { width, height } = useWindowDimensions();
  const { timezoneOffsetHours, isDebugMode, language, setCurrentSimulationUri } = useCelestialStore();

  const VISUALIZER_WIDTH = width - 32; // refined floating card margin
  const SKY_HEIGHT = Math.round(height * 0.38); // dynamically syncs vertical aspect ratio with CelestialChart
  
  // Calculate physical Horizon Dip based on observer elevation (in meters)
  const observerElevationM = sim?.terrain?.observerElevation ?? 50;
  const horizonDipDeg = getHorizonDip(observerElevationM);
  
  const DEGREE_TO_PIXEL = VISUALIZER_WIDTH / visualFov;
  // Lower horizon dynamically as observer goes higher (due to Earth's curvature horizon dip)
  const HORIZON_Y = SKY_HEIGHT * 0.10 - (horizonDipDeg * DEGREE_TO_PIXEL);

  // Base sizes for FOV 20
  const sunSize = 40 * (20 / visualFov);

  // 1회 캐싱된 이벤트 시점 날씨 보간 데이터 및 예측
  const eventWeather = useMemo(() => {
    if (interpolatedWeather && interpolatedWeather.length > 0) {
      return interpolatedWeather;
    }
    if (!sim?.pathData || sim.pathData.length === 0) return [];
    return getInterpolatedWeather(sim.pathData, sim.eventTime || currentTime);
  }, [interpolatedWeather, sim?.pathData, sim?.eventTime, currentTime]);

  const eventPrediction = useMemo(() => {
    if (prediction) return prediction;
    if (!sim?.pathData || sim.pathData.length < 4 || !eventWeather || eventWeather.length === 0) return null;
    const targetTime = sim?.eventTime || currentTime;
    const baseSunPos = sunPosition(targetTime, location?.coords?.latitude || 0, location?.coords?.longitude || 0);
    const baseSunAlt = baseSunPos.altitude * (180 / Math.PI);
    return predictSunset(
      sim.pathData,
      targetTime,
      baseSunAlt,
      eventWeather[0]?.visibility,
      eventWeather[0]?.humidity,
      location?.coords?.latitude,
      location?.coords?.altitude ?? sim?.terrain?.observerElevation ?? 0
    );
  }, [prediction, sim?.pathData, sim?.eventTime, currentTime, eventWeather, location, sim?.terrain?.observerElevation]);

  const effectivePathData = useMemo(() => {
    if (sim?.pathData && sim.pathData.length > 0) {
      return sim.pathData;
    }
    if (eventWeather && eventWeather.length > 0) {
      return eventWeather.map((w: any, idx: number) => ({
        distance: w.distance ?? [0, 15, 40, 80, 150, 250, 350][idx % 7],
        azimuthOffset: w.azimuthOffset ?? 0,
      }));
    }
    return Array.from({ length: 29 }, (_, idx) => ({
      distance: [0, 15, 40, 80, 150, 250, 350][idx % 7],
      azimuthOffset: 0,
    }));
  }, [sim?.pathData, eventWeather]);

  // 1. Unified 3D Spatial Clouds Computation & Depth Sorting (Optimized caching)
  const allCloudLayersData = useMemo(() => {
    const results: any[] = [];
    if (!eventWeather || eventWeather.length === 0) return results;

    const R_E = EARTH_RADIUS_KM; // Earth radius in km
    const h_v = (sim?.terrain?.observerElevation ?? 50) / 1000; // Observer altitude in km (default 50m)

    const types: ('high' | 'mid' | 'low')[] = ['high', 'mid', 'low'];
    const isOvercast = (eventPrediction?.factors?.overheadOvercast ?? 0) >= 0.75;
    const overcast = eventPrediction?.factors?.overheadOvercast ?? 0;

    // ── 0) 동일 거리의 열들 중 연속된 지점들의 구름(isContinuous) 판별 ──
    const continuousGrid = {
      high: new Array(7).fill(false),
      mid: new Array(7).fill(false),
      low: new Array(7).fill(false),
    };

    for (let d = 0; d < 7; d++) {
      types.forEach((type) => {
        const hasCloud = new Array(5).fill(false);
        for (let col = 0; col < 5; col++) {
          const pIdx = 1 + col * 7 + d;
          const interpolated = eventWeather[pIdx];
          if (interpolated) {
            const val = type === 'high' ? interpolated.high : type === 'mid' ? interpolated.mid : interpolated.low;
            hasCloud[col] = (val || 0) >= 20; // 20% 이상이면 구름 존재로 간주
          }
        }
        
        // 연속된 둘 이상의 지점 판별 (0..4 중 인접한 두 지점 모두 구름 존재)
        let isContinuous = false;
        for (let col = 0; col < 4; col++) {
          if (hasCloud[col] && hasCloud[col + 1]) {
            isContinuous = true;
            break;
          }
        }
        continuousGrid[type][d] = isContinuous;
      });
    }

    // ── 1) 5개 방위각 열별 공간 기상 패턴 분석 (10k ~ 380k 사이) ──
    const colStatus = Array.from({ length: 5 }, () => ({
      isStormSystem: false,      // 거대 비구름대 (저중고 전층 고밀도 수직발달)
      isStratusDeck: false,      // 거대 지상 해무/안개 (저층 고밀도, 중고층 없음)
      isScatteredCumulus: false, // 맑은 날의 산재한 뭉게구름 (거리별 밀도 편차가 큼)
      isCirrostratusVeil: false, // 고고도 얇은 면사포 (고층 고밀도, 저중층 맑음)
      isCirrusStreamer: false,   // 제트기류 새털구름 띠 (고층 고밀도가 선형 분포)
      isDeck: new Array(7).fill(false) // 거리별 기본 연속성 기록
    }));

    for (let col = 0; col < 5; col++) {
      const lowVals: number[] = [];
      const midVals: number[] = [];
      const highVals: number[] = [];
      
      for (let d = 0; d < 7; d++) {
        const pIdx = 1 + col * 7 + d;
        const interpolated = eventWeather[pIdx];
        lowVals.push(interpolated?.low ?? 0);
        midVals.push(interpolated?.mid ?? 0);
        highVals.push(interpolated?.high ?? 0);
      }
      
      const avgLow = lowVals.reduce((a, b) => a + b, 0) / 7;
      const avgMid = midVals.reduce((a, b) => a + b, 0) / 7;
      const avgHigh = highVals.reduce((a, b) => a + b, 0) / 7;
      
      // 밀도의 공간적 분산(Variance) 계산
      const varLow = lowVals.reduce((sum, v) => sum + Math.pow(v - avgLow, 2), 0) / 7;
      const varHigh = highVals.reduce((sum, v) => sum + Math.pow(v - avgHigh, 2), 0) / 7;

      // 인접 열들의 평균 고고도 구름 밀도 (선형 새털구름대 판정용)
      const getColAvgHigh = (c: number) => {
        let sum = 0;
        for (let d = 0; d < 7; d++) {
          sum += eventWeather[1 + c * 7 + d]?.high ?? 0;
        }
        return sum / 7;
      };
      const leftColAvg = col > 0 ? getColAvgHigh(col - 1) : 0;
      const rightColAvg = col < 4 ? getColAvgHigh(col + 1) : 0;

      // 1. 거대 비구름대 판정 (앞 4개 근거리 지점에서 저, 중, 고 모두 55% 이상)
      const nearLowAvg = lowVals.slice(0, 4).reduce((a,b)=>a+b, 0) / 4;
      const nearMidAvg = midVals.slice(0, 4).reduce((a,b)=>a+b, 0) / 4;
      const nearHighAvg = highVals.slice(0, 4).reduce((a,b)=>a+b, 0) / 4;
      
      if (nearLowAvg >= 55 && nearMidAvg >= 55 && nearHighAvg >= 55) {
        colStatus[col].isStormSystem = true;
      }
      // 2. 거대 지상 안개/해무 판정 (저층 고밀도, 중고층은 맑음)
      else if (nearLowAvg >= 50 && avgMid < 15 && avgHigh < 15) {
        colStatus[col].isStratusDeck = true;
      }
      // 3. 고고도 얇은 면사포 권층운 판정 (저중층 맑음, 고층은 중간 밀도로 고르게 분포)
      else if (avgLow < 15 && avgMid < 15 && (avgHigh >= 30 && avgHigh <= 75) && varHigh < 150) {
        colStatus[col].isCirrostratusVeil = true;
      }
      // 4. 제트기류 새털구름 띠 판정 (고층운이 선형으로 뻗음, 양옆은 맑음)
      else if (avgHigh >= 35 && avgLow < 15 && avgMid < 15 && ((col > 0 && leftColAvg < 15) || (col < 4 && rightColAvg < 15))) {
        colStatus[col].isCirrusStreamer = true;
      }
      // 5. 산재된 조각 뭉게구름 판정 (저층 편차가 매우 큼)
      else if (avgLow >= 15 && avgLow < 50 && varLow > 220) {
        colStatus[col].isScatteredCumulus = true;
      }

      // 거리별 기본 연속성(isDeck) 기록 (앞뒤거리에 구름이 연속해 있는지 여부)
      const layers: ('low' | 'mid' | 'high')[] = ['low', 'mid', 'high'];
      layers.forEach(layer => {
        const hasCloud = new Array(7).fill(false);
        for (let d = 0; d < 7; d++) {
          const pIdx = 1 + col * 7 + d;
          const interpolated = eventWeather[pIdx];
          if (interpolated) {
            const val = layer === 'high' ? interpolated.high : layer === 'mid' ? interpolated.mid : interpolated.low;
            hasCloud[d] = val >= 25;
          }
        }
        for (let d = 0; d < 7; d++) {
          if (hasCloud[d]) {
            const prevNeighbour = d > 0 ? hasCloud[d - 1] : false;
            const nextNeighbour = d < 6 ? hasCloud[d + 1] : false;
            if (prevNeighbour || nextNeighbour) {
              colStatus[col].isDeck[d] = true;
            }
          }
        }
      });
    }
    
    types.forEach((type) => {
      effectivePathData.forEach((c: any, i: number) => {
        const interpolated = eventWeather[i];
        if (!interpolated) return;
        const low = interpolated.low || 0;
        const mid = interpolated.mid || 0;
        const high = interpolated.high || 0;
        const density = type === 'high' ? high : type === 'mid' ? mid : low;

        if (density < 5) return;

        const baseDist = c?.distance ?? [0, 80, 200, 350][i % 4];
        const precip = interpolated.precipitation ?? 0;
        const water = interpolated.totalColumnWaterVapour ?? 0;
        const humidity = interpolated.humidity ?? 50;

        // 2) 체감 구름양 보정 (지평선 부근 투영 경로 증가로 인한 체감 구름양 폭증 보정)
        let slantPathFactor = 1.0;
        if (baseDist > 0) {
          if (baseDist <= 10) slantPathFactor = 3.5;
          else if (baseDist <= 30) slantPathFactor = 5.0;
          else if (baseDist <= 70) slantPathFactor = 6.5;
          else slantPathFactor = 8.0;
        }
        
        const perceivedDensity = Math.min(100, Math.round(100 * (1.0 - Math.pow(1.0 - density / 100, slantPathFactor))));

        // 해당 지점의 기상 패턴 상태 획득
        const colIdx = i === 0 ? 2 : Math.floor((i - 1) / 7);
        const distIdx = i === 0 ? 0 : (i - 1) % 7;
        const status = colStatus[colIdx];
        const isDeck = i === 0 ? false : status.isDeck[distIdx];

        const visibility = interpolated.visibility ?? 10000;

        // 구름 프리셋 판별 (보정된 perceivedDensity 적용)
        let preset = getCloudPreset(
          type,
          perceivedDensity,
          overcast,
          precip,
          water,
          humidity,
          visibility
        );

        // ── 구름 형태 및 프리셋 패턴 강제 매핑 ──
        if (status.isStormSystem) {
          // 거대 비구름대인 경우 저/중층은 Nimbostratus, 고층은 Cirrostratus로 강제화
          if (type === 'low' || type === 'mid') {
            preset = {
              name: 'Nimbostratus',
              thickness: 0.95,
              shadowContrast: 0.96,
              scattering: 0.22,
              rimLightSharpness: 0.85,
              baseOpacity: 0.98,
            };
          } else {
            preset = {
              name: 'Cirrostratus',
              thickness: 0.40,
              shadowContrast: 0.45,
              scattering: 0.60,
              rimLightSharpness: 0.40,
              baseOpacity: 0.80,
            };
          }
        } else if (status.isStratusDeck && type === 'low') {
          // 거대 지상 안개/해무의 경우 Stratus로 강제화
          preset = {
            name: 'Stratus',
            thickness: 0.50,
            shadowContrast: 0.25, // 안개는 그늘이 부드러움
            scattering: 0.85,
            rimLightSharpness: 0.20,
            baseOpacity: 0.92,
          };
        } else if (status.isCirrostratusVeil && type === 'high') {
          // 고고도 얇은 면사포 권층운 강제화
          preset = {
            name: 'Cirrostratus',
            thickness: 0.10,
            shadowContrast: 0.08,
            scattering: 0.92,
            rimLightSharpness: 0.15,
            baseOpacity: 0.20,
          };
        } else if (status.isCirrusStreamer && type === 'high') {
          // 제트기류 새털구름대 강제화
          preset = {
            name: 'Cirrus',
            thickness: 0.05,
            shadowContrast: 0.05,
            scattering: 0.98,
            rimLightSharpness: 0.20,
            baseOpacity: 0.25,
          };
        } else if (status.isScatteredCumulus && type === 'low') {
          // 산재한 조각 뭉게구름 적운 강제화
          preset = {
            name: 'Cumulus',
            thickness: 0.70,
            shadowContrast: 0.75,
            scattering: 0.40,
            rimLightSharpness: 0.85,
            baseOpacity: 0.80,
          };
        } else if (isDeck && type === 'low' && preset.name === 'Cumulus') {
          // 단순히 겹친 저층운은 층적운으로 시트화
          preset = {
            name: 'Stratocumulus',
            thickness: 0.85,
            shadowContrast: 0.85,
            scattering: 0.35,
            rimLightSharpness: 0.70,
            baseOpacity: 0.95,
          };
        }

        // 구름 종류별 물리 고도 H_c 세분화 지정 (km)
        let H_c = 1.5;
        if (preset.name === 'Cirrus') H_c = 11.0;
        else if (preset.name === 'Cirrocumulus') H_c = 9.5;
        else if (preset.name === 'Cirrostratus') H_c = 8.5;
        else if (preset.name === 'Altocumulus') H_c = 5.0;
        else if (preset.name === 'Altostratus') H_c = 4.2;
        else if (preset.name === 'Nimbostratus') H_c = 2.5;
        else if (preset.name === 'Stratocumulus') H_c = 1.8;
        else if (preset.name === 'Stratus') H_c = 0.4;
        else if (preset.name === 'Cumulus') H_c = 1.2;
        else if (preset.name === 'Cumulonimbus') H_c = 6.8;

        // 층상 장막 구름(Strata Layer) 여부 판정
        // 층상운을 개별 조각 구름처럼 3D 공간 상에 흩어지도록 장막(Strata) 분기 제거
        const isStrata = false;

        // 조각 구름들 (10종 운형 모두 조각 구름 형태로 3D 공간 상에 생성)
        const isDenseDeck = status.isStormSystem || status.isStratusDeck;
        const isContinuous = i === 0 ? false : continuousGrid[type][distIdx];

        let cloudCount = isDenseDeck 
          ? Math.ceil(perceivedDensity / 16)
          : (isOvercast ? Math.ceil(perceivedDensity / 22) : Math.ceil(perceivedDensity / 10));
        
        if (isContinuous) {
          // 연속성 구름은 더 촘촘히 겹쳐서 거대한 띠를 형성하도록 개수 1.4배 보정
          cloudCount = Math.ceil(cloudCount * 1.4);
        }

        if (isSliding) {
          // 슬라이더 조작 중일 때는 구름 개수를 25% 이하로 조율하여 렌더링 부하 대폭 감소
          cloudCount = Math.max(1, Math.round(cloudCount * 0.25));
        }
        
        for (let s = 0; s < cloudCount; s++) {
          const seed = type.charCodeAt(0) * 100 + i * 37 + s * 17;
          
          let d = baseDist;
          if (baseDist === 0) {
            d = 4 + ((seed * 13) % 16); // 로컬 구름: 4km ~ 20km 범위 분산
          } else {
            // 실제 격자 지점 거리 기준 +/- 25% 범위로 정교하게 분산
            const spread = baseDist * 0.25;
            const offset = ((seed * 17) % (spread * 2)) - spread;
            d = Math.max(1, baseDist + offset);
          }

          const phi = d / R_E;
          const Vx = (R_E + H_c) * Math.sin(phi);
          const Vy = (R_E + H_c) * Math.cos(phi) - (R_E + h_v);
          
          const S = Math.sqrt(Vx * Vx + Vy * Vy);
          const alpha = Math.atan2(Vy, Vx);
          const elevationDeg = alpha * (180 / Math.PI);
          // 지구 곡률을 반영한 순수 물리적 겉보기 고도 (보정 없음)
          // alpha = atan2(Vy, Vx) 자체가 지구 곡률로 인해 원거리 구름을
          // 지평선(0°) 근처 또는 이하로 정확하게 투영함
          const apparentElevationDeg = getApparentAltitude(elevationDeg);
          let baseColorStr =
            type === 'high'
              ? (eventPrediction?.highCloudColor ?? 'rgba(255, 192, 203, 0.4)')
              : type === 'mid'
              ? (eventPrediction?.midCloudColor ?? 'rgba(180, 150, 220, 0.35)')
              : (eventPrediction?.lowCloudColor ?? 'rgba(100, 149, 237, 0.3)');

          // 난층운, 고층운, 층운 개별 맞춤 색상 처리
          if (preset.name === 'Altostratus') {
            baseColorStr = 'rgba(130, 140, 160, 0.55)'; // 회청색
          } else if (preset.name === 'Nimbostratus') {
            baseColorStr = 'rgba(90, 100, 115, 0.75)'; // 어두운 회청색
          } else if (preset.name === 'Stratus') {
            baseColorStr = 'rgba(245, 248, 255, 0.4)'; // 반투명한 하얀색 면
          }

          let cloudCategory: 'near' | 'mid' | 'far' = 'mid';
          if (d <= 80) cloudCategory = 'near';
          else if (d > 200) cloudCategory = 'far';

          const isNear = d <= 35;
          const templates = isNear
            ? (CLOUD_TEMPLATES_HORIZONTAL[preset.name] || CLOUD_TEMPLATES_HORIZONTAL.Cumulus)
            : (CLOUD_TEMPLATES[preset.name] || CLOUD_TEMPLATES.Cumulus);
          const templateIndex = seed % templates.length;
          const pathStr = templates[templateIndex];

          let baseWidth = 150;
          let baseHeight = 35;
          
          // 10종 운형의 기상학적 특성 기반 가로/세로 규격 매핑
          if (status.isStratusDeck && type === 'low') {
            baseWidth = 260;
            baseHeight = 12;
          } else if (status.isStormSystem && (type === 'low' || type === 'mid')) {
            baseWidth = 260;
            baseHeight = 65;
          } else if (preset.name === 'Cirrus') {
            baseWidth = 220;
            baseHeight = 15;
          } else if (preset.name === 'Cirrocumulus') {
            baseWidth = 180;
            baseHeight = 25;
          } else if (preset.name === 'Cirrostratus') {
            baseWidth = 220;
            baseHeight = 12;
          } else if (preset.name === 'Altocumulus') {
            baseWidth = 170;
            baseHeight = 30;
          } else if (preset.name === 'Altostratus') {
            baseWidth = 240;
            baseHeight = 60;
          } else if (preset.name === 'Nimbostratus') {
            baseWidth = 280;
            baseHeight = 90;
          } else if (preset.name === 'Stratocumulus') {
            baseWidth = 190;
            baseHeight = 40;
          } else if (preset.name === 'Stratus') {
            baseWidth = 240;
            baseHeight = 30;
          } else if (preset.name === 'Cumulus') {
            baseWidth = 190;
            baseHeight = 48;
          } else if (preset.name === 'Cumulonimbus') {
            baseWidth = 180;
            baseHeight = 220;
          }

          results.push({
            id: `${type}-${i}-${s}`,
            type,
            S,
            apparentElevationDeg,
            azimuthOffset: c?.azimuthOffset ?? 0,
            baseWidth,
            baseHeight,
            baseColorStr,
            seed,
            opacityDensity: perceivedDensity,
            d,
            pathStr,
            preset,
            isDeck,
            cloudCategory,
            isContinuous,
            isNear,
            weatherMode: {
              isStormSystem: status.isStormSystem,
              isStratusDeck: status.isStratusDeck,
              isCirrostratusVeil: status.isCirrostratusVeil,
              isCirrusStreamer: status.isCirrusStreamer,
              isScatteredCumulus: status.isScatteredCumulus,
            },
            isStrata: false,
            isLocal: false,
            H_c,
          });
        }
      });
    });

    // Deep sort: further away (larger S) rendered first, so closer (smaller S) overlaps it!
    results.sort((a, b) => b.S - a.S);
    return results;
  }, [eventWeather, eventPrediction, sim, isSliding]);

  // Extract real-time weather factors for dynamic papercraft collage styling
  const weatherFactors = useMemo(() => {
    const beta = prediction?.factors?.aerosolBeta ?? 0.08;
    const pathClarity = prediction?.factors?.pathClarity ?? 1.0;
    const overcast = prediction?.factors?.overheadOvercast ?? 0.0;
    
    // Normalize aerosol dust intensity (0 to 1 scale)
    const dustIntensity = Math.max(0, Math.min(1, (beta - 0.04) / 0.46)); 
    
    // Cloud opacity blocker for direct solar light
    const cloudBlock = Math.max(0, Math.min(1, 1.0 - pathClarity));

    return {
      beta,
      pathClarity,
      overcast,
      dustIntensity,
      cloudBlock
    };
  }, [prediction]);

  // 메인 화면 시뮬레이션 뷰(SVG/구름) 상태 변경 시 스냅샷 이미지 동기화
  useEffect(() => {
    let isCancelled = false;
    
    const updatePreviewImage = async () => {
      try {
        if (targetViewRef && targetViewRef.current) {
          const uri = await captureVisualizerSnapshot(targetViewRef, { quality: 0.85 });
          if (!isCancelled && uri) {
            setCurrentSimulationUri(uri);
          }
        }
      } catch (err) {
        console.warn('[Visualizer Image Sync] Failed to capture SVG view snapshot:', err);
      }
    };

    const timer = setTimeout(updatePreviewImage, isSliding ? 300 : 150);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [sunAltitude, weatherFactors?.overcast, prediction, currentTime, location?.coords?.latitude, location?.coords?.longitude, isSliding, setCurrentSimulationUri, targetViewRef]);

  // 2. Unified 3D Spatial Clouds Mapping, Depth Sorting & Multi-Layer Occlusion
  const unifiedClouds = useMemo(() => {
    const horizonTop = SKY_HEIGHT - HORIZON_Y;
    const scaleZoom = 20 / visualFov;
    const { overcast, dustIntensity } = weatherFactors;

    // 대기 산란 물리 시뮬레이션 대표 하늘색 2개 캐싱 (천정 vs 지평선)로 Hot Loop 내 중복 연산 제거
    const zenithSkyColor = getApproximatedSkyColor(80, 90, sunAltitude, weatherFactors.beta, weatherFactors.pathClarity);
    const horizonSkyColor = getApproximatedSkyColor(0.05, 0, sunAltitude, weatherFactors.beta, weatherFactors.pathClarity);

    const cloudsList: any[] = [];

    // ── Helper 1: Map allCloudLayersData (일반 3D 구름) ──────────────────────
    allCloudLayersData.forEach((item) => {
      const timeMs = currentTime.getTime();
      const windSpeedKmh = 25; 
      const windDriftKm = (timeMs / 3600000) * windSpeedKmh;
      const spatialDx = (((item.seed * 73) % 120) - 60); // in km
      const totalDx = spatialDx + (windDriftKm % 160 - 80);
      
      const totalAzOffset = item.azimuthOffset + Math.atan2(totalDx, item.d) * (180 / Math.PI);
      const baseAzimuth = sim?.azimuth ?? heading ?? 270;
      const cloudAzimuthAbs = baseAzimuth + totalAzOffset;
      const relativeAzDeg = cloudAzimuthAbs - heading;
      const relativeAz = ((relativeAzDeg + 180) % 360) - 180;
      const halfFov = visualFov / 2;

      // 1) 수평 방위각 시야각 컬링 검사 (여유 15도)
      if (relativeAz < -halfFov - 15 || relativeAz > halfFov + 15) {
        return;
      }

      // 2) 수직 고도각 시야각 컬링 검사 및 화면 분포를 위한 비선형 스쿼싱(Squashing) 적용
      const horizonTop = SKY_HEIGHT - HORIZON_Y;
      const verticalFovDeg = (horizonTop * visualFov) / VISUALIZER_WIDTH;

      let renderElevation = item.apparentElevationDeg;
      if (renderElevation > 0) {
        // 실제 고도각(0~90도)을 화면 수직 시야각(0~verticalFovDeg) 범위로 고르게 펼치기 위해 비선형 압축 적용
        renderElevation = verticalFovDeg * Math.pow(renderElevation / 90, 0.48);
      } else {
        // 지구 곡률로 지평선 이하로 투영된 원거리 구름 처리:
        // 음수 고도 → 지평선(0) 바로 위에 밀착 배치 (0 ~ +0.4° 범위)
        // 이는 수백km 떨어진 구름이 관측자 눈높이에서 지평선 선상으로 보이는 현상을 재현
        const clampedBelow = Math.max(renderElevation, -horizonDipDeg);
        renderElevation = 0.4 * (1.0 + clampedBelow / Math.max(horizonDipDeg, 0.001));
      }

      if (renderElevation < -0.5 || renderElevation > verticalFovDeg + 5) {
        return;
      }

      const fovRad = (visualFov * Math.PI) / 180;
      const halfFovRad = fovRad / 2;
      const xOffsetRatio = Math.tan((relativeAz * Math.PI) / 180) / Math.tan(halfFovRad);
      const x = (VISUALIZER_WIDTH / 2) + (xOffsetRatio * (VISUALIZER_WIDTH / 2));
      const y = horizonTop - (renderElevation * DEGREE_TO_PIXEL);

      const perspectiveScale = 35 / item.S;
      const clampedScale = Math.max(0.075, Math.min(3.0, perspectiveScale));

      let finalScaleX = 1.0;
      let finalScaleY = 1.0;
      let renderWidth = item.baseWidth;
      let renderHeight = item.baseHeight;

      let horizontalStretch = 1.0;
      if (item.weatherMode.isStormSystem) {
        horizontalStretch = 4.8;
      } else if (item.weatherMode.isStratusDeck) {
        horizontalStretch = 4.2;
      } else if (item.weatherMode.isCirrostratusVeil) {
        horizontalStretch = 3.0;
      } else if (item.weatherMode.isScatteredCumulus) {
        horizontalStretch = 1.1;
      } else {
        horizontalStretch = item.isDeck 
          ? 3.6 
          : (item.cloudCategory === 'far' ? 3.2 : item.cloudCategory === 'mid' ? 1.8 : 1.0);
      }

      const densityStretch = item.weatherMode.isScatteredCumulus ? 1.0 : (1.0 + (item.opacityDensity / 120.0));
      
      if (item.isNear) {
        // 머리 위 수평 구름: 가로로 얇고 길쭉하게 스케일링
        const horizForeshortening = 0.12 + (clampedScale / 3.0) * 0.20;
        finalScaleX = clampedScale * scaleZoom * horizontalStretch * densityStretch * 1.6;
        finalScaleY = clampedScale * horizForeshortening * scaleZoom * 0.6;
      } else {
        // 멀리 있는 수직 구름: 세로 비율을 상대적으로 유지
        const vertForeshortening = 0.35 + (clampedScale / 3.0) * 0.65;
        finalScaleX = clampedScale * scaleZoom * horizontalStretch * densityStretch * 0.85;
        finalScaleY = clampedScale * vertForeshortening * scaleZoom * 1.1;
      }

      // 적란운(Cumulonimbus)은 세로로 훨씬 거대하게 치솟아야 하므로 스케일 추가 보정
      if (item.preset?.name === 'Cumulonimbus') {
        finalScaleY = finalScaleY * 1.6;
      }

      if (item.isContinuous) {
        // 연속성 구름은 가로 스케일을 2.2배 확대하여 서로 완전히 겹치게 함
        finalScaleX = finalScaleX * 2.2;
      }
      
      renderWidth = item.baseWidth * finalScaleX;
      renderHeight = item.baseHeight * finalScaleY;

      // 최소 렌더 크기 보정 (원근에 의해 너무 납작해지거나 작아져 실선으로 깨지는 현상 방지)
      if (renderHeight < 8) {
        renderHeight = 8;
      }
      if (renderWidth < 20) {
        renderWidth = 20;
      }

      // 일반 조각 구름이 화면을 비정상적으로 뒤덮지 않도록 안전 제한(Safe Cap) 적용
      const maxCloudWidth = VISUALIZER_WIDTH * 0.85;
      const maxCloudHeight = SKY_HEIGHT * 0.45;
      
      if (renderWidth > maxCloudWidth) {
        const ratio = maxCloudWidth / renderWidth;
        renderWidth = maxCloudWidth;
        renderHeight = renderHeight * ratio;
      }
      if (renderHeight > maxCloudHeight) {
        renderHeight = maxCloudHeight;
      }

      // Skip rendering if way off-screen horizontally
      if (x + renderWidth < -150 || x - renderWidth > VISUALIZER_WIDTH + 150) {
        return;
      }

      const relativeSunAz = (((sim?.azimuth || 180) - heading + 180) % 360) - 180;
      const lightDx = Math.sin((relativeSunAz * Math.PI) / 180);
      const lightDy = -Math.sin(((sunAltitude - 15) * Math.PI) / 180);
      
      const lightLength = Math.sqrt(lightDx * lightDx + lightDy * lightDy);
      const cosA = lightLength > 1e-5 ? lightDx / lightLength : 0;
      const sinA = lightLength > 1e-5 ? lightDy / lightLength : -1.0;

      const preset = item.preset;

      let azDiff = cloudAzimuthAbs - (sim?.azimuth || 180);
      azDiff = ((azDiff + 180) % 360) - 180;
      
      const dProjection = item.d * Math.cos((azDiff * Math.PI) / 180);
      const phiProjection = dProjection / EARTH_RADIUS_KM;
      const sunAltFromCloud = sunAltitude + phiProjection * (180 / Math.PI);
      const cloudBeam = getSunBeamColor(sunAltFromCloud);

      // Proximity-to-Sun Gradient coloring:
      // 태양 높이에 맞춰 위아래 하이라이트 방향 반전
      const isSunAboveCloud = sunAltFromCloud > 0;
      const x1 = '50%';
      const y1 = isSunAboveCloud ? '100%' : '0%';
      const x2 = '50%';
      const y2 = isSunAboveCloud ? '0%' : '100%';

      // skyColorAtDirection 중복 호출 제거 및 캐싱된 하늘색 선형 보간 적용
      const elevRatio = clamp01(item.apparentElevationDeg / 80.0);
      const ambientSky = mixRgb(horizonSkyColor, zenithSkyColor, elevRatio);

      // 선형 근사 함수로 구름 및 음영 색상 일괄 고속 산출
      const approxColors = approximateCloudColors(
        sunAltFromCloud,
        item.type,
        preset,
        weatherFactors,
        overcast,
        dustIntensity,
        ambientSky,
        cloudBeam
      );

      const cloudIllum = approxColors.cloudIllum;
      const beamIntensity = approxColors.beamIntensity;
      const angularDistanceToSun = Math.sqrt(azDiff * azDiff + (item.apparentElevationDeg - sunAltitude) * (item.apparentElevationDeg - sunAltitude));

      let finalLitRGB = approxColors.litRGB;
      let finalShadowRGB = approxColors.shadowRGB;

      // ── 기상 모드별 색상 튜닝 ── (필요한 경우에만 가볍게 보정)
      if (item.weatherMode.isStormSystem || item.weatherMode.isStratusDeck) {
        const cloudIllum = cloudIllumination(sunAltFromCloud, item.H_c);
        const beamIntensity = cloudIllum * weatherFactors.pathClarity;
        let litLight = mixRgb(ambientSky, cloudBeam, beamIntensity * 0.85);
        const darkShadowRGB = { r: 0.05, g: 0.06, b: 0.12 };
        let shadowLight = mixRgb(ambientSky, darkShadowRGB, preset.shadowContrast * 0.85);

        if (item.weatherMode.isStormSystem) {
          litLight = mixRgb(litLight, { r: 0.06, g: 0.07, b: 0.10 }, 0.8);
          shadowLight = mixRgb(shadowLight, { r: 0.03, g: 0.04, b: 0.06 }, 0.9);
        } else if (item.weatherMode.isStratusDeck) {
          shadowLight = mixRgb(shadowLight, litLight, 0.7);
        }

        const litBlend = 0.9 - preset.thickness * 0.25;
        const shadowBlend = 0.8 - preset.thickness * 0.1;
        
        finalLitRGB = interpolateColors(
          finalLitRGB, // base
          { r: Math.round(litLight.r * 255), g: Math.round(litLight.g * 255), b: Math.round(litLight.b * 255), a: 1 },
          litBlend
        );
        finalShadowRGB = interpolateColors(
          finalShadowRGB,
          { r: Math.round(shadowLight.r * 255), g: Math.round(shadowLight.g * 255), b: Math.round(shadowLight.b * 255), a: 1 },
          shadowBlend
        );
      }

      const finalMidRGB = interpolateColors(finalShadowRGB, finalLitRGB, 0.65);

      const highlightIntensity = preset.thickness > 0.5 ? 1.0 : 0.7;
      const finalHighlightRGB = interpolateColors(
        finalLitRGB,
        { r: Math.round(cloudBeam.r * 255), g: Math.round(cloudBeam.g * 255), b: Math.round(cloudBeam.b * 255), a: 1 },
        highlightIntensity
      );

      let rimHighlight = finalHighlightRGB;
      if (angularDistanceToSun < 35 && sunAltFromCloud > -3.0) {
        const cosG = Math.cos((angularDistanceToSun * Math.PI) / 180);
        const gMie = 0.76;
        const phase = (1 - gMie * gMie) / Math.pow(1 + gMie * gMie - 2 * gMie * cosG, 1.5);
        const phaseMax = (1 - gMie * gMie) / Math.pow((1 - gMie) * (1 - gMie), 1.5);
        const mieHighlight = clamp01(phase / phaseMax) * beamIntensity * weatherFactors.pathClarity;
        
        rimHighlight = interpolateColors(
          finalHighlightRGB,
          { r: Math.round(cloudBeam.r * 255), g: Math.round(cloudBeam.g * 255), b: Math.round(cloudBeam.b * 255), a: 1 },
          mieHighlight * 0.4
        );
      }

      const stopMid = `${Math.round(20 + preset.thickness * 25)}%`;
      const stopLit = `${Math.round(45 + preset.thickness * 20)}%`;

      const shadowDist = Math.min(6, 2 + renderHeight * 0.15);
      const shadowDx = -cosA * shadowDist;
      const shadowDy = -sinA * shadowDist;

      const aerosolScaleHeight = 260; 
      const aerosolExtinction = Math.exp(-item.S / aerosolScaleHeight);

      const gradId = `cloudGrad-${item.id}`;

      // 구름 종류에 따른 불투명(Opaque) 여부 판정
      const isOpaqueCloud = 
        preset.name === 'Cumulus' || 
        preset.name === 'Cumulonimbus' || 
        preset.name === 'Nimbostratus' || 
        preset.name === 'Stratocumulus';

      const maxOpacityCap = isOpaqueCloud ? 0.98 : (0.45 + (overcast * 0.45));
      const baseOpacityAttenuated = preset.baseOpacity * aerosolExtinction * (1.0 + overcast * 0.5);
      
      let cloudOpacity = Math.max(
        Math.min(0.98, Math.max(0.15, (item.opacityDensity / 100) * maxOpacityCap)),
        Math.min(0.98, baseOpacityAttenuated)
      );

      // 불투명 구름은 밀도가 존재하면 확실하게 불투명(Opaque)으로 고정
      if (isOpaqueCloud && item.opacityDensity >= 15) {
        cloudOpacity = 0.98;
      }

      // 3개 영역 분기 높이 계산
      const altMin = -6.0;
      const altMax = 6.0;
      const tAlt = clamp01((sunAltFromCloud - altMin) / (altMax - altMin));
      const topWeight = tAlt;
      const bottomWeight = 1.0 - tAlt;

      const transmission = 1.0 - preset.thickness;
      const totalHighlightRatio = 0.4 + 0.5 * transmission;
      const activeGlow = cloudIllum * weatherFactors.pathClarity;
      const totalHighlightHeight = item.baseHeight * totalHighlightRatio * activeGlow;

      let topRimHeight = totalHighlightHeight * topWeight;
      let bottomRimHeight = totalHighlightHeight * bottomWeight;

      if (topRimHeight + bottomRimHeight > item.baseHeight) {
        const total = topRimHeight + bottomRimHeight;
        topRimHeight = (topRimHeight / total) * item.baseHeight;
        bottomRimHeight = (bottomRimHeight / total) * item.baseHeight;
      }

      // 위아래 반분할 노을 색상 계산
      const altLimit = 10.0;
      const tColor = Math.max(-1.0, Math.min(1.0, sunAltFromCloud / altLimit));
      const whiteRGB = { r: 255, g: 250, b: 242, a: 1 };
      const grayRGB = finalShadowRGB;
      const redRGB = finalLitRGB;

      let topHalfRGB = whiteRGB;
      let bottomHalfRGB = whiteRGB;

      if (tColor > 0) {
        topHalfRGB = interpolateColors(redRGB, whiteRGB, tColor);
        bottomHalfRGB = interpolateColors(grayRGB, whiteRGB, tColor);
      } else {
        const tNorm = tColor + 1.0; // 0.0 ~ 1.0
        topHalfRGB = interpolateColors(grayRGB, redRGB, tNorm);
        bottomHalfRGB = interpolateColors(redRGB, grayRGB, tNorm);
      }
      
      const finalTopHalfColor = colorToString(topHalfRGB);
      const finalBottomHalfColor = colorToString(bottomHalfRGB);

      // 층상운 종류별 투명도 캡 세분화 (하늘 격자 및 태양이 은은하게 비치도록)
      if (preset.name === 'Cirrostratus') {
        cloudOpacity = Math.min(0.25, cloudOpacity);
      } else if (preset.name === 'Altostratus') {
        cloudOpacity = Math.min(0.55, cloudOpacity);
      } else if (preset.name === 'Stratus') {
        cloudOpacity = Math.min(0.65, cloudOpacity);
      } else if (preset.name === 'Nimbostratus') {
        cloudOpacity = Math.min(0.85, cloudOpacity);
      }

      cloudsList.push({
        ...item,
        x,
        y,
        gradId,
        x1, y1, x2, y2,
        finalShadowColor: colorToString(finalShadowRGB),
        finalMidColor: colorToString(finalMidRGB),
        finalLitColor: colorToString(finalLitRGB),
        finalHighlightColor: colorToString(rimHighlight),
        stopMid,
        stopLit,
        shadowDx,
        shadowDy,
        cloudOpacity,
        finalScaleX,
        finalScaleY,
        renderWidth,
        renderHeight,
        relativeAz,
        isOpaqueCloud,
        topRimHeight,
        bottomRimHeight,
        finalTopHalfColor,
        finalBottomHalfColor,
      });
    });

    // ── Helper 2: Map gridCloudShapes (외부 그리드 구름) ──────────────────────
    if (gridCloudShapes && gridCloudShapes.length > 0) {
      gridCloudShapes.forEach((shape) => {
        const timeMs = currentTime.getTime();
        const windSpeedKmh = 25;
        const windDriftKm = (timeMs / 3600000) * windSpeedKmh;
        const totalDx = (windDriftKm % 160 - 80);
        const windAzOffset = Math.atan2(totalDx, shape.centerDist) * (180 / Math.PI);
        const relAzDeg = shape.centerAzOffset + windAzOffset;
        const relativeAz = ((relAzDeg + 180) % 360) - 180;
        
        const fovRad = (visualFov * Math.PI) / 180;
        const halfFovRad = fovRad / 2;
        const xOffsetRatio = Math.tan((relativeAz * Math.PI) / 180) / Math.tan(halfFovRad);
        const x = (VISUALIZER_WIDTH / 2) + (xOffsetRatio * (VISUALIZER_WIDTH / 2));
        const minElevation = shape.type === 'high' ? 1.5 : shape.type === 'mid' ? 0.8 : 0.4;
        const apparentElevationClamped = Math.max(shape.apparentElevation, minElevation);
        const y = horizonTop - (apparentElevationClamped * DEGREE_TO_PIXEL);

        const perspectiveScale = 45 / Math.max(10, shape.centerDist);
        const clampedScale = Math.max(0.06, Math.min(2.5, perspectiveScale));
        const finalScaleX = clampedScale * scaleZoom;
        const finalScaleY = clampedScale * scaleZoom * 0.6;

        let baseW = 150;
        let baseH = 35;
        if (shape.type === 'high') {
          baseW = 220; baseH = 15;
        } else if (shape.type === 'mid') {
          baseW = 170; baseH = 32;
        } else {
          baseW = 190; baseH = 48;
        }

        let renderWidth = baseW * finalScaleX;
        let renderHeight = baseH * finalScaleY;

        // 최소 렌더 크기 보정 (원근에 의해 아주 먼 거리의 그리드 구름 조각이 극도로 얇아져 선처럼 깨지는 현상 방지)
        if (renderHeight < 8) {
          renderHeight = 8;
        }
        if (renderWidth < 20) {
          renderWidth = 20;
        }

        // 그리드 기반 조각 구름이 화면을 비정상적으로 뒤덮지 않도록 안전 제한 적용
        const maxCloudWidth = VISUALIZER_WIDTH * 0.85;
        const maxCloudHeight = SKY_HEIGHT * 0.45;
        
        if (renderWidth > maxCloudWidth) {
          const ratio = maxCloudWidth / renderWidth;
          renderWidth = maxCloudWidth;
          renderHeight = renderHeight * ratio;
        }
        if (renderHeight > maxCloudHeight) {
          renderHeight = maxCloudHeight;
        }

        let cloudCategory: 'near' | 'mid' | 'far' = 'mid';
        if (shape.centerDist <= 80) cloudCategory = 'near';
        else if (shape.centerDist > 200) cloudCategory = 'far';

        if (x + renderWidth < -100 || x - renderWidth > VISUALIZER_WIDTH + 100) {
          return;
        }

        const avgPrecip = interpolatedWeather && interpolatedWeather.length > 0
          ? interpolatedWeather.reduce((sum, w) => sum + (w.precipitation || 0), 0) / interpolatedWeather.length
          : 0;
        const avgLiquidWater = interpolatedWeather && interpolatedWeather.length > 0
          ? interpolatedWeather.reduce((sum, w) => sum + (w.totalColumnWaterVapour || 0), 0) / interpolatedWeather.length
          : 0;
        const avgVisibility = interpolatedWeather && interpolatedWeather.length > 0
          ? interpolatedWeather.reduce((sum, w) => sum + (w.visibility ?? 10000), 0) / interpolatedWeather.length
          : 10000;
        const avgHumidity = interpolatedWeather && interpolatedWeather.length > 0
          ? interpolatedWeather.reduce((sum, w) => sum + (w.humidity ?? 50), 0) / interpolatedWeather.length
          : 50;

        const preset = getCloudPreset(
          shape.type,
          shape.density,
          overcast,
          avgPrecip,
          avgLiquidWater,
          avgHumidity,
          avgVisibility
        );

        const templates = CLOUD_TEMPLATES[preset.name] || CLOUD_TEMPLATES.Cumulus;
        const seed = shape.id.charCodeAt(5) * 100 + shape.centerDist;
        const templateIndex = seed % templates.length;
        const pathStr = templates[templateIndex];

        const cloudAzimuthAbs = (sim?.azimuth ?? 180) + shape.centerAzOffset + windAzOffset;
        let azDiff = cloudAzimuthAbs - (sim?.azimuth ?? 180);
        azDiff = ((azDiff + 180) % 360) - 180;
        
        const dProjection = shape.centerDist * Math.cos((azDiff * Math.PI) / 180);
        const phiProjection = dProjection / EARTH_RADIUS_KM;
        const sunAltFromCloud = sunAltitude + phiProjection * (180 / Math.PI);
        const cloudBeam = getSunBeamColor(sunAltFromCloud);

        // 구름 종류별 물리 고도 H_c 세분화 지정 (km)
        let H_c = 1.5;
        if (preset.name === 'Cirrus') H_c = 11.0;
        else if (preset.name === 'Cirrocumulus') H_c = 9.5;
        else if (preset.name === 'Cirrostratus') H_c = 8.5;
        else if (preset.name === 'Altocumulus') H_c = 5.0;
        else if (preset.name === 'Altostratus') H_c = 4.2;
        else if (preset.name === 'Nimbostratus') H_c = 2.5;
        else if (preset.name === 'Stratocumulus') H_c = 1.8;
        else if (preset.name === 'Stratus') H_c = 0.4;
        else if (preset.name === 'Cumulus') H_c = 1.2;
        else if (preset.name === 'Cumulonimbus') H_c = 4.5;

        // skyColorAtDirection 중복 호출 제거 및 캐싱된 하늘색 선형 보간 적용
        const elevRatio = clamp01(shape.apparentElevation / 80.0);
        const ambientSky = mixRgb(horizonSkyColor, zenithSkyColor, elevRatio);

        // 선형 근사 함수로 구름 및 음영 색상 일괄 고속 산출
        const approxColors = approximateCloudColors(
          sunAltFromCloud,
          shape.type,
          preset,
          weatherFactors,
          overcast,
          dustIntensity,
          ambientSky,
          cloudBeam
        );

        let litRGB = approxColors.litRGB;
        let shadowRGB = approxColors.shadowRGB;
        const midRGB = approxColors.midRGB;

        const cloudIllum = approxColors.cloudIllum;
        const beamIntensity = approxColors.beamIntensity;
        const baseRGB = approxColors.baseRGB;
        const angularDistanceToSun = Math.sqrt(azDiff * azDiff + (shape.apparentElevation - sunAltitude) * (shape.apparentElevation - sunAltitude));

        const highlightIntensity = preset.thickness > 0.5 ? 1.0 : 0.7;
        const highlightRGB = interpolateColors(
          litRGB,
          { r: Math.round(cloudBeam.r * 255), g: Math.round(cloudBeam.g * 255), b: Math.round(cloudBeam.b * 255), a: 1 },
          highlightIntensity
        );

        let rimHighlightRGB = highlightRGB;
        if (angularDistanceToSun < 35 && sunAltFromCloud > -3.0) {
          const cosG = Math.cos((angularDistanceToSun * Math.PI) / 180);
          const gMie = 0.76;
          const phase = (1 - gMie * gMie) / Math.pow(1 + gMie * gMie - 2 * gMie * cosG, 1.5);
          const phaseMax = (1 - gMie * gMie) / Math.pow((1 - gMie) * (1 - gMie), 1.5);
          const mieHighlight = clamp01(phase / phaseMax) * beamIntensity * weatherFactors.pathClarity;
          
          rimHighlightRGB = interpolateColors(
            highlightRGB,
            { r: Math.round(cloudBeam.r * 255), g: Math.round(cloudBeam.g * 255), b: Math.round(cloudBeam.b * 255), a: 1 },
            mieHighlight * 0.4
          );
        }

        const stopMid = `${Math.round(30 + preset.thickness * 45)}%`;
        const stopLit = `${Math.round(70 + preset.thickness * 20)}%`;

        // 태양 높이에 맞춰 위아래 하이라이트 방향 반전
        const isSunAboveCloud = sunAltFromCloud > 0;
        const x1 = '50%';
        const y1 = isSunAboveCloud ? '100%' : '0%';
        const x2 = '50%';
        const y2 = isSunAboveCloud ? '0%' : '100%';

        const relativeSunAz = (((sim?.azimuth || 180) - heading + 180) % 360) - 180;
        const lightDx = Math.sin((relativeSunAz * Math.PI) / 180);
        const lightDy = -Math.sin(((sunAltitude - 15) * Math.PI) / 180);
        
        const lightLength = Math.sqrt(lightDx * lightDx + lightDy * lightDy);
        const cosA = lightLength > 1e-5 ? lightDx / lightLength : 0;
        const sinA = lightLength > 1e-5 ? lightDy / lightLength : -1.0;

        // 3개 영역 분기 높이 계산
        const altMin = -6.0;
        const altMax = 6.0;
        const tAlt = clamp01((sunAltFromCloud - altMin) / (altMax - altMin));
        const topWeight = tAlt;
        const bottomWeight = 1.0 - tAlt;

        const transmission = 1.0 - preset.thickness;
        const totalHighlightRatio = 0.4 + 0.5 * transmission;
        const activeGlow = cloudIllum * weatherFactors.pathClarity;
        const totalHighlightHeight = baseH * totalHighlightRatio * activeGlow;

        let topRimHeight = totalHighlightHeight * topWeight;
        let bottomRimHeight = totalHighlightHeight * bottomWeight;

        if (topRimHeight + bottomRimHeight > baseH) {
          const total = topRimHeight + bottomRimHeight;
          topRimHeight = (topRimHeight / total) * baseH;
          bottomRimHeight = (bottomRimHeight / total) * baseH;
        }

        // 위아래 반분할 노을 색상 계산
        const altLimit = 10.0;
        const tColor = Math.max(-1.0, Math.min(1.0, sunAltFromCloud / altLimit));
        const whiteRGB = { r: 255, g: 250, b: 242, a: 1 };
        const grayRGB = shadowRGB;
        const redRGB = litRGB;

        let topHalfRGB = whiteRGB;
        let bottomHalfRGB = whiteRGB;

        if (tColor > 0) {
          topHalfRGB = interpolateColors(redRGB, whiteRGB, tColor);
          bottomHalfRGB = interpolateColors(grayRGB, whiteRGB, tColor);
        } else {
          const tNorm = tColor + 1.0; // 0.0 ~ 1.0
          topHalfRGB = interpolateColors(grayRGB, redRGB, tNorm);
          bottomHalfRGB = interpolateColors(redRGB, grayRGB, tNorm);
        }
        
        const finalTopHalfColor = colorToString(topHalfRGB);
        const finalBottomHalfColor = colorToString(bottomHalfRGB);

        // 구름 종류에 따른 불투명(Opaque) 여부 판정
        const isOpaqueCloud = 
          preset.name === 'Cumulus' || 
          preset.name === 'Cumulonimbus' || 
          preset.name === 'Nimbostratus' || 
          preset.name === 'Stratocumulus';

        let cloudOpacity = Math.max(0.1, preset.baseOpacity * (shape.density / 100));
        if (isOpaqueCloud && shape.density >= 15) {
          cloudOpacity = 0.98;
        }

        cloudsList.push({
          id: shape.id,
          type: shape.type,
          S: shape.centerDist, // distance for depth sorting
          apparentElevationDeg: apparentElevationClamped,
          azimuthOffset: shape.centerAzOffset,
          baseWidth: baseW,
          baseHeight: baseH,
          baseColorStr: colorToString(baseRGB),
          seed,
          opacityDensity: shape.density,
          d: shape.centerDist,
          pathStr,
          cloudCategory,
          preset,
          precipitation: avgPrecip,
          liquidWater: avgLiquidWater,
          x,
          y,
          gradId: `gridGrad-${shape.id}`,
          x1, y1, x2, y2,
          finalShadowColor: colorToString(shadowRGB),
          finalMidColor: colorToString(midRGB),
          finalLitColor: colorToString(litRGB),
          finalHighlightColor: colorToString(rimHighlightRGB),
          stopMid,
          stopLit,
          shadowDx: 0,
          shadowDy: 0,
          cloudOpacity,
          finalScaleX,
          finalScaleY,
          renderWidth,
          renderHeight,
          relativeAz,
          isOpaqueCloud,
          topRimHeight,
          bottomRimHeight,
          finalTopHalfColor,
          finalBottomHalfColor,
          weatherMode: {
            isStormSystem: false,
            isStratusDeck: false,
            isCirrostratusVeil: false,
            isCirrusStreamer: false,
            isScatteredCumulus: false,
          }
        });
      });
    }

    // ── 3단계: 가까운 순(S 오름차순) 정렬 및 Occlusion 연산 ──────────────────
    cloudsList.sort((a, b) => a.S - b.S);

    const numBuckets = 12;
    const bucketOcclusion = new Array(numBuckets).fill(0);
    let sunTransmission = 1.0;

    const sunX = VISUALIZER_WIDTH / 2;
    const apparentSunAltForOccl = getApparentAltitude(sunAltitude);
    const sunY = SKY_HEIGHT - ((apparentSunAltForOccl * DEGREE_TO_PIXEL) + HORIZON_Y);

    cloudsList.forEach((cloud) => {
      const halfFov = visualFov / 2;
      let bucketIdx = Math.floor(((cloud.relativeAz + halfFov) / visualFov) * numBuckets);
      bucketIdx = Math.max(0, Math.min(numBuckets - 1, bucketIdx));

      const O_b = bucketOcclusion[bucketIdx];

      // 구름 간 차폐 적용: 불투명(Opaque) 구름일수록 뒤쪽 구름을 강하게 가려 완전 차폐함
      const occlWeight = cloud.isOpaqueCloud ? 0.95 : 0.45;
      cloud.cloudOpacity = cloud.cloudOpacity * (1.0 - O_b * occlWeight);

      // 차폐 기여도 누적
      const thicknessFactor = cloud.preset.thickness * (cloud.isOpaqueCloud ? 1.0 : 0.6);
      const opacityContribution = cloud.cloudOpacity * thicknessFactor;

      // 주 버킷 차폐 누적
      bucketOcclusion[bucketIdx] = Math.min(0.99, bucketOcclusion[bucketIdx] + (1.0 - bucketOcclusion[bucketIdx]) * opacityContribution);
      
      // 인접 버킷에도 차폐 효과 스필오버
      if (bucketIdx > 0) {
        bucketOcclusion[bucketIdx - 1] = Math.min(0.99, bucketOcclusion[bucketIdx - 1] + (1.0 - bucketOcclusion[bucketIdx - 1]) * opacityContribution * 0.4);
      }
      if (bucketIdx < numBuckets - 1) {
        bucketOcclusion[bucketIdx + 1] = Math.min(0.99, bucketOcclusion[bucketIdx + 1] + (1.0 - bucketOcclusion[bucketIdx + 1]) * opacityContribution * 0.4);
      }

      // 태양 차폐 연산 (Sun Disk 가림막)
      const rx = cloud.renderWidth / 2;
      const ry = cloud.renderHeight / 2;
      if (rx > 0 && ry > 0) {
        const dx = sunX - cloud.x;
        const dy = sunY - cloud.y;
        // 타원 거리 계산 (구름 크기에 맞춰 1.1x 범위 가림)
        const distEll = Math.sqrt((dx / rx) * (dx / rx) + (dy / ry) * (dy / ry));
        
        if (distEll < 1.1) {
          const overlapFactor = Math.max(0, Math.min(1.0, 1.1 - distEll));
          // 불투명 구름일수록 태양을 강력하게 완전히 가려버림
          const cloudBlockFactor = cloud.cloudOpacity * cloud.preset.thickness * (cloud.isOpaqueCloud ? 1.5 : 0.8);
          const sunOcclContribution = overlapFactor * cloudBlockFactor;
          
          sunTransmission = sunTransmission * (1.0 - Math.min(0.99, sunOcclContribution));
        }
      }
    });

    const sunOcclusion = 1.0 - sunTransmission;

    // ── 4단계: 다시 먼 거리 순(S 내림차순) 정렬 (in-place reverse로 O(N) 최적화) ────────────────────────────
    cloudsList.reverse();

    return {
      clouds: cloudsList,
      sunOcclusion,
    };
  }, [allCloudLayersData, gridCloudShapes, heading, visualFov, sunAltitude, currentTime, prediction, sim, VISUALIZER_WIDTH, SKY_HEIGHT, HORIZON_Y, DEGREE_TO_PIXEL, weatherFactors, isSliding]);

  // ── 지평선 너머 구름의 태양빛 차단 계산 ─────────────────────────────────────
  // 조건: (1) 구름이 지평선 아래, (2) 태양 방향 ±90° 이내, (3) 태양 고도 < 8°
  // 이 세 조건이 동시에 만족될 때만 해당 구름이 수평에 가까운 태양빛을 차단
  const belowHorizonSunBlock = useMemo(() => {
    // 태양이 충분히 낮지 않으면 지평선 너머 구름이 태양빛 경로에 걸리지 않음
    if (sunAltitude >= 8) return 0;

    const sunAzDeg = sim?.azimuth ?? 180;
    // 태양 고도가 낮을수록 수평 방향 차단 효과 극대화: 0° = 1.0, 8° = 0.0
    const solarGrazingFactor = Math.max(0, 1.0 - sunAltitude / 8.0);

    let totalBlock = 0;
    let sampleCount = 0;

    allCloudLayersData.forEach((item) => {
      // 조건 1: 물리적으로 지평선 아래에 있는 구름만
      if (item.apparentElevationDeg > 0) return;

      // 추가 조건: 고고도 구름(high cloud)은 지평선 근처 하늘을 어둡게 하는 수평 차광 효과에서 제외
      if (item.type === 'high') return;

      // 조건 2: 구름 방위각과 태양 방위각의 차이가 ±90° 이내
      // item.azimuthOffset은 태양 방향 기준 상대 오프셋
      const azDiffFromSun = Math.abs(item.azimuthOffset);
      if (azDiffFromSun > 90) return;

      // 방위각 alignment 가중치: 태양 방향에 가까울수록 1.0, 90° 차이일 때 0.0
      const azAlignmentFactor = Math.pow(Math.cos((azDiffFromSun * Math.PI) / 180), 2);

      // 구름 두께 × 밀도로 실제 차단율 계산
      const thicknessFactor = item.preset?.thickness ?? 0.5;
      const densityFactor = item.opacityDensity / 100;

      // 저고도/중고도 구름 중에서도 적란운(Cumulonimbus)이나 난층운(Nimbostratus)과 같은 두꺼운 비구름 종류에 높은 가중치 부여
      let typeBoost = 1.0;
      if (item.preset?.name === 'Cumulonimbus' || item.preset?.name === 'Nimbostratus') {
        typeBoost = 1.5;
      } else if (item.preset?.name === 'Altostratus' || item.preset?.name === 'Stratocumulus' || item.preset?.name === 'Cumulus') {
        typeBoost = 1.0;
      } else {
        typeBoost = 0.3; // 얇은 하층/중층운은 차단력을 대폭 낮춤
      }

      const cloudBlock = thicknessFactor * densityFactor * azAlignmentFactor * solarGrazingFactor * typeBoost;

      totalBlock += cloudBlock;
      sampleCount++;
    });

    if (sampleCount === 0) return 0;
    // 여러 구름의 차단 효과는 누적되지만 1.0을 초과하지 않도록 물리적 clamp
    // (각 구름이 독립적으로 빛을 가리는 게 아니라 투과율의 곱으로 계산)
    return Math.max(0, Math.min(0.85, (totalBlock / sampleCount) * Math.min(sampleCount, 5)));
  }, [allCloudLayersData, sunAltitude, sim]);

  // ── Sky mosaic: 8 vertical × 5 horizontal = 40 cell physically-based colors ──
  const skyGrid = useMemo(() => {
    const beta = prediction?.factors?.aerosolBeta ?? 0.08;
    const pathClarity = prediction?.factors?.pathClarity ?? 1.0;
    const sunAzDeg = sim?.azimuth ?? 180;

    // The actual vertical elevation range visible in the sky viewport depends on FOV.
    // DEGREE_TO_PIXEL = VISUALIZER_WIDTH / visualFov, so:
    // verticalFovDeg = (SKY_HEIGHT - HORIZON_Y) / DEGREE_TO_PIXEL
    //                = (SKY_HEIGHT - HORIZON_Y) * visualFov / VISUALIZER_WIDTH
    const skyViewportH = SKY_HEIGHT - HORIZON_Y;
    const verticalFovDeg = (skyViewportH * visualFov) / VISUALIZER_WIDTH;

    const apparentSunAltForSky = getApparentAltitude(sunAltitude);
    const baseGrid = cachedComputeSkyGrid(
      apparentSunAltForSky,
      sunAzDeg,
      heading,
      visualFov,
      beta,
      pathClarity,
      verticalFovDeg
    );

    // 지평선 너머 구름의 태양빛 차단 효과에 따른 darkening 로직은 유저 요청으로 제거됨
    return baseGrid;
  }, [sunAltitude, heading, visualFov, prediction, sim, SKY_HEIGHT, HORIZON_Y, VISUALIZER_WIDTH]);

  // Adjust papercraft border line styles for comic/papercraft theme (clear white borders when clear, fading to soft tint in heavy cloud/haze)
  const borderStyle = useMemo(() => {
    const { dustIntensity, overcast } = weatherFactors;
    const severity = Math.max(dustIntensity, overcast);
    // 카툰 느낌을 주기 위해 기본 strokeWidth를 2.0으로 두껍게 가져가고, 날씨가 안 좋을 때만 흐려지게 함
    const strokeWidth = Math.max(0.8, 2.0 * (1.0 - severity * 0.5));
    const strokeOpacity = Math.max(0.3, 1.0 - severity * 0.6);
    return {
      strokeWidth,
      strokeColor: `rgba(255, 255, 255, ${strokeOpacity.toFixed(2)})`
    };
  }, [weatherFactors]);

  // Interpolate terrain and ocean colors based on sun altitude & weather factors (Topographic Map Style)
  const terrainColors = useMemo(() => {
    const alt = sunAltitude;
    const { overcast, dustIntensity } = weatherFactors;
    
    // Smooth transition for day/night: -6 degrees to +8 degrees
    const t = Math.max(0, Math.min(1, (alt + 6) / 14));
    
    // 노을 강도: 맑을 때 극대화, 흐리거나 먼지가 심하면 0에 수렴
    const sunsetGlowFactor = Math.max(0, 1.0 - (overcast * 1.3 + dustIntensity * 0.9)) * (1.0 - Math.pow(Math.abs(t - 0.4) / 0.4, 2));
    const clampedGlow = Math.max(0, Math.min(1, sunsetGlowFactor));

    // 1) 맑은 날의 기본 대낮/황혼/밤 색상 (바다)
    const daySeaStart = parseColor('#29b6f6');
    const daySeaMid = parseColor('#0288d1');
    const daySeaEnd = parseColor('#01579b');
    const nightSeaStart = parseColor('#1a0f30');
    const nightSeaMid = parseColor('#0c051a');
    const nightSeaEnd = parseColor('#040108');
    const goldenSeaStart = parseColor('#ff5500');
    const goldenSeaMid = parseColor('#d00d56');
    const goldenSeaEnd = parseColor('#180230');

    let seaStartRGB = interpolateColors(nightSeaStart, daySeaStart, t);
    let seaMidRGB = interpolateColors(nightSeaMid, daySeaMid, t);
    let seaEndRGB = interpolateColors(nightSeaEnd, daySeaEnd, t);
    seaStartRGB = interpolateColors(seaStartRGB, goldenSeaStart, clampedGlow);
    seaMidRGB = interpolateColors(seaMidRGB, goldenSeaMid, clampedGlow);
    seaEndRGB = interpolateColors(seaEndRGB, goldenSeaEnd, clampedGlow);

    // 2) 지형도 스타일 등고선 레이어 색상
    // 낮에는 녹색~갈색~암회색 지형도 팔레트, 밤엔 어두운 남색~퍼플 팔레트
    // 등고선 레이어 (아래부터 위 순서: layer0=최저, layer4=최고)
    const dayLayers = [
      parseColor('#2d3f2f'), // layer0: 저지대 짙은 녹색
      parseColor('#3a5234'), // layer1: 구릉 녹색
      parseColor('#4a5e3d'), // layer2: 중간 고지 올리브
      parseColor('#5a5e46'), // layer3: 고지대 황갈
      parseColor('#6b6052'), // layer4: 고봉 회갈색
    ];
    const nightLayers = [
      parseColor('#0d0e1e'), // layer0
      parseColor('#111428'), // layer1
      parseColor('#161a32'), // layer2
      parseColor('#1b203c'), // layer3
      parseColor('#212646'), // layer4
    ];
    const goldenLayers = [
      parseColor('#3d1a12'), // layer0
      parseColor('#4a2016'), // layer1
      parseColor('#563026'), // layer2
      parseColor('#5e3820'), // layer3
      parseColor('#6b4228'), // layer4
    ];

    const contourLayers = dayLayers.map((dayC, i) => {
      let c = interpolateColors(nightLayers[i], dayC, t);
      if (clampedGlow > 0.05) c = interpolateColors(c, goldenLayers[i], clampedGlow * 0.6);
      return c;
    });

    // 등고선 선 색 (각 레이어보다 약간 밝게)
    const contourLineDay = parseColor('#8fa87a');
    const contourLineNight = parseColor('#2a2e4a');
    let contourLineRGB = interpolateColors(contourLineNight, contourLineDay, t);
    if (clampedGlow > 0.05) contourLineRGB = interpolateColors(contourLineRGB, parseColor('#a06030'), clampedGlow * 0.5);

    // 날씨 나쁠 때 탈색
    const badWeatherSeverity = Math.max(overcast, dustIntensity);
    const grayTone = overcast > dustIntensity
      ? { start: parseColor('#303540'), mid: parseColor('#20242b'), end: parseColor('#12151a') }
      : { start: parseColor('#4a3c31'), mid: parseColor('#332820'), end: parseColor('#1f1712') };

    if (badWeatherSeverity > 0.1) {
      seaStartRGB = interpolateColors(seaStartRGB, grayTone.start, badWeatherSeverity * 0.85);
      seaMidRGB = interpolateColors(seaMidRGB, grayTone.mid, badWeatherSeverity * 0.85);
      seaEndRGB = interpolateColors(seaEndRGB, grayTone.end, badWeatherSeverity * 0.85);
      for (let i = 0; i < contourLayers.length; i++) {
        contourLayers[i] = interpolateColors(contourLayers[i], i % 2 === 0 ? grayTone.start : grayTone.mid, badWeatherSeverity * 0.85);
      }
      contourLineRGB = interpolateColors(contourLineRGB, grayTone.mid, badWeatherSeverity * 0.8);
    }

    return {
      seaStart: colorToString(seaStartRGB),
      seaMid: colorToString(seaMidRGB),
      seaEnd: colorToString(seaEndRGB),
      // 등고선 레이어 5단계
      layers: contourLayers.map(colorToString),
      contourLine: colorToString(contourLineRGB),
    };
  }, [sunAltitude, weatherFactors]);

  // (halo useMemos removed — sun glow is now handled by sky mosaic Mie boost)


  // (uniforms block removed — Skia shader replaced by SVG mosaic)

  // 3. Compute continuous overhead giant cloud bands when overcast factor is extremely high
  const giantClouds = useMemo(() => {
    if (!prediction || !interpolatedWeather) return [];
    const overcast = prediction.factors?.overheadOvercast ?? 0;
    if (overcast < 0.75) return [];

    const types: ('high' | 'mid' | 'low')[] = ['high', 'mid', 'low'];
    const horizonTop = SKY_HEIGHT - HORIZON_Y;

    // Time-based wind drift shift translated to degrees
    const timeMs = currentTime.getTime();
    const windSpeedDegPerMs = 0.000005; // subtle drift over time
    const windShiftDeg = (timeMs * windSpeedDegPerMs) % 360;

    return types.map((type) => {
      // 로컬(거리 80km 이하) 구름 밀도 평균을 80%, 원거리 평균을 20% 반영하여 로컬 체감 날씨를 극대화
      const localDensities = interpolatedWeather.filter((w: any) => w.distance <= 80).map((w: any) => type === 'high' ? w.high : type === 'mid' ? w.mid : w.low);
      const localAvg = localDensities.length > 0 ? localDensities.reduce((a: number, b: number) => a + b, 0) / localDensities.length : 0;
      const remoteDensities = interpolatedWeather.filter((w: any) => w.distance > 80).map((w: any) => type === 'high' ? w.high : type === 'mid' ? w.mid : w.low);
      const remoteAvg = remoteDensities.length > 0 ? remoteDensities.reduce((a: number, b: number) => a + b, 0) / remoteDensities.length : 0;
      const avgDensity = localAvg * 0.8 + remoteAvg * 0.2;
      if (avgDensity < 15) return null;

      const baseColorStr =
        type === 'high'
          ? (prediction.highCloudColor)
          : type === 'mid'
          ? (prediction.midCloudColor)
          : (prediction.lowCloudColor);

      // Define altitude range boundaries for giant sheets
      // 로컬 저/중/고층운의 밀도가 높을수록 구름 장막이 머리 위(천정 방향)로 더 높이 확장되도록 설정
      const localDensity = type === 'high' ? (interpolatedWeather[0]?.high ?? 0) : type === 'mid' ? (interpolatedWeather[0]?.mid ?? 0) : (interpolatedWeather[0]?.low ?? 0);
      const scaleFactor = 1.0 + (localDensity / 100) * 1.5; // 최대 2.5배 확장

      const minElev = type === 'high' ? 35 : type === 'mid' ? 15 : 2;
      const maxElev = type === 'high' 
        ? Math.min(65, 50 * scaleFactor) 
        : type === 'mid' 
        ? Math.min(35, 20 * scaleFactor) 
        : Math.min(12, 8 * scaleFactor);

      const yStart = horizonTop - (maxElev * DEGREE_TO_PIXEL);
      const yEnd = horizonTop - (minElev * DEGREE_TO_PIXEL);
      const layerHeight = Math.max(28, yEnd - yStart);

      // Project a seamless 360-degree cloud ring to completely prevent clipping
      const totalWidth = 360 * DEGREE_TO_PIXEL;
      const xStart = (VISUALIZER_WIDTH / 2) - (heading - windShiftDeg) * DEGREE_TO_PIXEL;

      // Higher step count for smoother 360-degree cyclical sampling
      const steps = 36;
      const topPoints: { x: number; y: number }[] = [];
      const bottomPoints: { x: number; y: number }[] = [];

      // Top boundary points with Fourier-like smooth wave synthesis (Seamless Loop)
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const px = xStart + totalWidth * t;
        const sampleAz = (heading - windShiftDeg) + 360 * t;
        
        const rad = (sampleAz * Math.PI) / 180;
        const wave1 = Math.sin(rad * 3) * 0.12;
        const wave2 = Math.cos(rad * 7) * 0.06;
        const wave3 = Math.sin(rad * 12) * 0.03;
        const noiseSum = wave1 + wave2 + wave3;
        
        const py = yStart + layerHeight * (0.2 + noiseSum);
        topPoints.push({ x: px, y: py });
      }

      // Bottom boundary points
      for (let k = steps; k >= 0; k--) {
        const t = k / steps;
        const px = xStart + totalWidth * t;
        const sampleAz = (heading - windShiftDeg) + 360 * t;
        
        const rad = (sampleAz * Math.PI) / 180;
        const wave1 = Math.sin(rad * 2.5 + 2) * 0.12;
        const wave2 = Math.cos(rad * 6 + 4) * 0.06;
        const wave3 = Math.sin(rad * 11 + 6) * 0.03;
        const noiseSum = wave1 + wave2 + wave3;
        
        const py = yStart + layerHeight * (0.8 - noiseSum);
        bottomPoints.push({ x: px, y: py });
      }

      // Build smooth path using Cubic Bezier segments
      let pathStr = `M ${topPoints[0].x.toFixed(1)},${topPoints[0].y.toFixed(1)}`;
      
      for (let k = 0; k < steps; k++) {
        const p0 = topPoints[k];
        const p1 = topPoints[k + 1];
        const cp1x = p0.x + (p1.x - p0.x) / 3;
        const cp1y = p0.y;
        const cp2x = p0.x + 2 * (p1.x - p0.x) / 3;
        const cp2y = p1.y;
        pathStr += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
      }

      pathStr += ` L ${bottomPoints[0].x.toFixed(1)},${bottomPoints[0].y.toFixed(1)}`;

      for (let k = 0; k < steps; k++) {
        const p0 = bottomPoints[k];
        const p1 = bottomPoints[k + 1];
        const cp1x = p0.x - (p0.x - p1.x) / 3;
        const cp1y = p0.y;
        const cp2x = p0.x - 2 * (p0.x - p1.x) / 3;
        const cp2y = p1.y;
        pathStr += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
      }

      pathStr += ' Z';
      const opacity = Math.min(0.35, (avgDensity / 100) * overcast * 0.5);

      return {
        id: `giant-${type}`,
        pathStr,
        color: baseColorStr,
        opacity,
      };
    }).filter(Boolean);
  }, [prediction, interpolatedWeather, SKY_HEIGHT, HORIZON_Y, DEGREE_TO_PIXEL, VISUALIZER_WIDTH, heading, visualFov, currentTime, sim]);

  // ── 지형 기하학적 포인트 연산 캐싱 (성능 극대화) ──────────────────
  const farTerrainGeom = useMemo(() => {
    if (!sim?.terrain?.panoramicAngles) return null;
    const farAngles = sim.terrain.farAngles || [];
    if (farAngles.length <= 1) return null;

    const pointsCount = 150;
    const buffer = visualFov * 0.2;
    const totalRenderFov = visualFov + buffer * 2;

    const avgAngle = (sim.terrain.panoramicAngles.reduce((a: number, b: number) => a + b, 0) || 0) / (sim.terrain.panoramicAngles.length || 1);
    const targetPeakHeight = SKY_HEIGHT * 0.08;
    const REF_DEGREE_TO_PIXEL = VISUALIZER_WIDTH / 20;
    const baseScale = targetPeakHeight / (Math.max(1, avgAngle) * REF_DEGREE_TO_PIXEL);
    const dynamicScale = Math.min(4.0, Math.max(0.6, baseScale));
    const horizonLineY = SKY_HEIGHT - HORIZON_Y;

    const getAngle = (angles: number[], azDeg: number) => {
      if (angles.length < 2) return 0;
      const normalizedAz = ((azDeg % 360) + 360) % 360;
      const index = (normalizedAz / 360) * (angles.length - 1);
      const i1 = Math.floor(index);
      const i2 = (i1 + 1) % angles.length;
      const ratio = index - i1;
      return (angles[i1] || 0) * (1 - ratio) + (angles[i2] || 0) * ratio;
    };

    const getContourPoints = (angles: number[], verticalScale: number, yOffset: number, heightFraction: number) => {
      const pointsList: string[] = [];
      for (let i = 0; i <= pointsCount; i++) {
        const relativeDeg = -(totalRenderFov / 2) + (i * totalRenderFov / pointsCount);
        const absDeg = heading + relativeDeg;
        const angle = getAngle(angles, absDeg) * heightFraction;
        const x = (relativeDeg / visualFov) * VISUALIZER_WIDTH + VISUALIZER_WIDTH / 2;
        const y = horizonLineY - (angle * verticalScale * DEGREE_TO_PIXEL) + yOffset;
        pointsList.push(`${x.toFixed(2)},${y.toFixed(2)}`);
      }
      const lastX = VISUALIZER_WIDTH.toFixed(2);
      const groundY = (horizonLineY + 2).toFixed(2);
      return pointsList.join(' ') + ` ${lastX},${groundY} 0,${groundY}`;
    };

    const CONTOUR_LEVELS = 5;
    const contourPointsList = Array.from({ length: CONTOUR_LEVELS }, (_, li) => {
      const frac = ((li + 1) / CONTOUR_LEVELS);
      const ridgeFrac = ((li + 1.05) / CONTOUR_LEVELS);
      return {
        contour: getContourPoints(farAngles, dynamicScale * 1.5, 0, frac),
        ridge: getContourPoints(farAngles, dynamicScale * 1.5, 0, ridgeFrac)
      };
    });

    return {
      contourPointsList,
    };
  }, [sim?.terrain?.panoramicAngles, sim?.terrain?.farAngles, heading, visualFov, SKY_HEIGHT, HORIZON_Y, DEGREE_TO_PIXEL, VISUALIZER_WIDTH]);

  const fgTerrainGeom = useMemo(() => {
    if (!sim?.terrain?.panoramicAngles) return null;
    const fgAngles = sim.terrain.panoramicAngles || [];

    const pointsCount = 150;
    const buffer = visualFov * 0.2;
    const totalRenderFov = visualFov + buffer * 2;

    const avgAngle = (sim.terrain.panoramicAngles.reduce((a: number, b: number) => a + b, 0) || 0) / (sim.terrain.panoramicAngles.length || 1);
    const targetPeakHeight = SKY_HEIGHT * 0.08;
    const REF_DEGREE_TO_PIXEL = VISUALIZER_WIDTH / 20;
    const baseScale = targetPeakHeight / (Math.max(1, avgAngle) * REF_DEGREE_TO_PIXEL);
    const dynamicScale = Math.min(4.0, Math.max(0.6, baseScale));
    const horizonLineY = SKY_HEIGHT - HORIZON_Y;

    const getAngle = (angles: number[], azDeg: number) => {
      if (angles.length < 2) return 0;
      const normalizedAz = ((azDeg % 360) + 360) % 360;
      const index = (normalizedAz / 360) * (angles.length - 1);
      const i1 = Math.floor(index);
      const i2 = (i1 + 1) % angles.length;
      const ratio = index - i1;
      return (angles[i1] || 0) * (1 - ratio) + (angles[i2] || 0) * ratio;
    };

    const getContourPoints = (angles: number[], verticalScale: number, yOffset: number, heightFraction: number) => {
      const pointsList: string[] = [];
      for (let i = 0; i <= pointsCount; i++) {
        const relativeDeg = -(totalRenderFov / 2) + (i * totalRenderFov / pointsCount);
        const absDeg = heading + relativeDeg;
        const angle = getAngle(angles, absDeg) * heightFraction;
        const x = (relativeDeg / visualFov) * VISUALIZER_WIDTH + VISUALIZER_WIDTH / 2;
        const y = horizonLineY - (angle * verticalScale * DEGREE_TO_PIXEL) + yOffset;
        pointsList.push(`${x.toFixed(2)},${y.toFixed(2)}`);
      }
      const lastX = VISUALIZER_WIDTH.toFixed(2);
      const groundY = (horizonLineY + 2).toFixed(2);
      return pointsList.join(' ') + ` ${lastX},${groundY} 0,${groundY}`;
    };

    const getRidgeLinePoints = (angles: number[], verticalScale: number, yOffset: number) => {
      const pointsList: string[] = [];
      for (let i = 0; i <= pointsCount; i++) {
        const relativeDeg = -(totalRenderFov / 2) + (i * totalRenderFov / pointsCount);
        const absDeg = heading + relativeDeg;
        const angle = getAngle(angles, absDeg);
        const x = (relativeDeg / visualFov) * VISUALIZER_WIDTH + VISUALIZER_WIDTH / 2;
        const y = horizonLineY - (angle * verticalScale * DEGREE_TO_PIXEL) + yOffset;
        pointsList.push(`${x.toFixed(2)},${y.toFixed(2)}`);
      }
      return pointsList.join(' ');
    };

    const CONTOUR_LEVELS = 5;
    const contourPointsList = Array.from({ length: CONTOUR_LEVELS }, (_, li) => {
      const frac = ((li + 1) / CONTOUR_LEVELS);
      const ridgeFrac = ((li + 1.05) / CONTOUR_LEVELS);
      return {
        contour: getContourPoints(fgAngles, dynamicScale, 0, frac),
        ridge: getContourPoints(fgAngles, dynamicScale, 0, ridgeFrac)
      };
    });

    const ridgeHighlightPoints1 = getRidgeLinePoints(fgAngles, dynamicScale, -1.5);
    const ridgeHighlightPoints2 = getRidgeLinePoints(fgAngles, dynamicScale, -1);

    return {
      contourPointsList,
      ridgeHighlightPoints1,
      ridgeHighlightPoints2,
    };
  }, [sim?.terrain?.panoramicAngles, heading, visualFov, SKY_HEIGHT, HORIZON_Y, DEGREE_TO_PIXEL, VISUALIZER_WIDTH]);

  const renderFarTerrain = () => {
    if (!farTerrainGeom) return null;
    const CONTOUR_LEVELS = 5;
    const layers = terrainColors.layers;
    const contourLine = terrainColors.contourLine;

    return (
      <G key="far-mountain-group">
        {Array.from({ length: CONTOUR_LEVELS }, (_, li) => {
          const geom = farTerrainGeom.contourPointsList[li];
          if (!geom) return null;
          return (
            <G key={`far-cl-${li}`}>
              <Polygon
                points={geom.contour}
                fill={layers[Math.min(li, layers.length - 1)]}
                opacity={0.92}
              />
              {li < CONTOUR_LEVELS - 1 && (
                <Polygon
                  points={geom.ridge}
                  fill="none"
                  stroke={contourLine}
                  strokeWidth={0.6}
                  opacity={0.55}
                />
              )}
            </G>
          );
        })}
      </G>
    );
  };

  const renderForegroundTerrain = () => {
    if (!fgTerrainGeom) return null;
    const CONTOUR_LEVELS = 5;
    const layers = terrainColors.layers;
    const contourLine = terrainColors.contourLine;

    return (
      <G key="fg-mountain-group">
        {/* Panoramic Ridge Highlight */}
        {sunAltitude >= -4.0 && sunAltitude <= 8.0 && (
          <G>
            <Polyline
              points={fgTerrainGeom.ridgeHighlightPoints1}
              fill="none"
              stroke="#FF8C00"
              strokeWidth={4.5}
              opacity={Math.max(0, Math.min(1, sunAltitude >= 0 ? 1 - (sunAltitude / 8) : 1 - (sunAltitude / -4))) * 0.45}
            />
            <Polyline
              points={fgTerrainGeom.ridgeHighlightPoints2}
              fill="none"
              stroke="#FFE082"
              strokeWidth={1.8}
              opacity={Math.max(0, Math.min(1, sunAltitude >= 0 ? 1 - (sunAltitude / 8) : 1 - (sunAltitude / -4))) * 0.8}
            />
          </G>
        )}

        {/* Foreground Mountain layers */}
        {Array.from({ length: CONTOUR_LEVELS }, (_, li) => {
          const geom = fgTerrainGeom.contourPointsList[li];
          if (!geom) return null;
          return (
            <G key={`fg-cl-${li}`}>
              <Polygon
                points={geom.contour}
                fill={layers[Math.min(li, layers.length - 1)]}
                opacity={0.95}
              />
              {li < CONTOUR_LEVELS - 1 && (
                <Polygon
                  points={geom.ridge}
                  fill="none"
                  stroke={contourLine}
                  strokeWidth={0.75}
                  opacity={0.65}
                />
              )}
            </G>
          );
        })}
      </G>
    );
  };

  const renderOverlayAzimuthScale = () => {
    const ticks = [];
    const range = visualFov + 15;
    const start = Math.floor((heading - range / 2) / 2) * 2;
    const end = Math.ceil((heading + range / 2) / 2) * 2;
    
    for (let deg = start; deg <= end; deg += 2) {
      const norm = (deg + 360) % 360;
      const x = (VISUALIZER_WIDTH / 2) + (deg - heading) * DEGREE_TO_PIXEL;
      const isMajor = norm % 10 === 0;
      const isCard = norm % 45 === 0;
      let label = "";
      if (norm === 0) label = 'N'; 
      else if (norm === 90) label = 'E'; 
      else if (norm === 180) label = 'S'; 
      else if (norm === 270) label = 'W';
      else if (isMajor) label = `${norm}°`;

      if (x < -20 || x > VISUALIZER_WIDTH + 20) continue;

      ticks.push(
        <View 
          key={deg} 
          style={[
            styles.overlayTick, 
            { 
              left: x, 
              height: isCard ? 8 : (isMajor ? 5 : 3), 
              backgroundColor: isCard ? theme.accent : 'rgba(255,255,255,0.4)' 
            }
          ]}
        >
          {label !== "" && (
            <Text style={[styles.overlayTickLabel, { color: isCard ? theme.accent : 'rgba(255,255,255,0.7)', fontSize: isCard ? 9 : 7 }]}>
              {label}
            </Text>
          )}
        </View>
      );
    }

    const sunriseX = (VISUALIZER_WIDTH / 2) + (eventAzimuths.sunrise - heading) * DEGREE_TO_PIXEL;
    const sunsetX = (VISUALIZER_WIDTH / 2) + (eventAzimuths.sunset - heading) * DEGREE_TO_PIXEL;

    return (
      <View style={[styles.overlayCompass, { backgroundColor: 'rgba(4,5,16,0.97)' }]}>
        <View style={styles.scaleClip}>{ticks}</View>
        
        {sunriseX >= 0 && sunriseX <= VISUALIZER_WIDTH && (
          <View style={[styles.overlaySunMarker, { left: sunriseX }]}>
            <Sun size={8} color={dataColor.sunrise} />
            <Text style={styles.overlaySunLabel}>RISE</Text>
          </View>
        )}
        {sunsetX >= 0 && sunsetX <= VISUALIZER_WIDTH && (
          <View style={[styles.overlaySunMarker, { left: sunsetX }]}>
            <Sun size={8} color={dataColor.sunset} />
            <Text style={styles.overlaySunLabel}>SET</Text>
          </View>
        )}
        
        <View style={[styles.overlayCenterIndicator, { borderBottomColor: theme.accent }]} />
      </View>
    );
  };

  const renderNextEventBadge = () => {
    if (!sim) return null;
    const { type, eventTime } = sim;
    if (!eventTime) return null;

    const localCurrent = getLocalTimeAtLocation(currentTime, timezoneOffsetHours);
    const localEvent = getLocalTimeAtLocation(eventTime, timezoneOffsetHours);

    const isSameDay = localCurrent.getDate() === localEvent.getDate() &&
                      localCurrent.getMonth() === localEvent.getMonth() &&
                      localCurrent.getFullYear() === localEvent.getFullYear();

    const dateLabel = isSameDay ? 'Today' : 'Tomorrow';
    const formattedTime = formatLocalTime(localEvent, 'HH:mm');

    const isSunrise = type === 'Sunrise';
    const badgeColor = isSunrise ? dataColor.sunrise : dataColor.sunset;

    return (
      <View style={[styles.nextEventBadge, { backgroundColor: 'rgba(5, 5, 10, 0.65)', borderColor: theme.border }]}>
        <View style={styles.nextEventHeader}>
          <View style={[styles.eventDot, { backgroundColor: badgeColor }]} />
          <Text style={styles.nextEventTitle}>NEXT EVENT</Text>
        </View>
        <Text style={[styles.nextEventValue, { color: '#FFFFFF' }]}>
          {isSunrise ? 'Sunrise' : 'Sunset'} <Text style={styles.nextEventTime}>{dateLabel} {formattedTime}</Text>
        </Text>
      </View>
    );
  };

  const handleExportJpg = async () => {
    try {
      const cloudRatio = weatherFactors?.overcast ?? 0;
      const base64Image = await generateSimulationImage(sunAltitude, cloudRatio);
      
      if (!base64Image) {
        Alert.alert(t('error', language), t('saveJpgFailed', language));
        return;
      }

      let finalSaveUri = base64Image;
      if (base64Image.startsWith('data:')) {
        try {
          const base64Data = base64Image.split(';base64,')[1];
          const tempFileUri = `${FileSystem.cacheDirectory}simulation_${Date.now()}.jpg`;
          await FileSystem.writeAsStringAsync(tempFileUri, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
          });
          finalSaveUri = tempFileUri;
        } catch (fsErr) {
          console.error('[Visualizer] Failed to write temp export file:', fsErr);
          Alert.alert(t('error', language), t('saveJpgFailed', language));
          return;
        }
      }

      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status === 'granted') {
        await MediaLibrary.saveToLibraryAsync(finalSaveUri);
        Alert.alert(t('success', language), t('saveJpgSuccess', language));
      } else {
        Alert.alert(t('permissionRequired', language), t('galleryPermissionRequiredMsg', language));
      }
    } catch (err) {
      console.warn('Failed to export simulation image:', err);
      Alert.alert(t('error', language), t('saveJpgFailed', language));
    }
  };

  const handleLogAndCapture = async () => {
    const obsWeather = interpolatedWeather?.[0];
    const visibilityVal = obsWeather?.visibility !== undefined ? (obsWeather.visibility / 1000).toFixed(1) : 'N/A';
    const humidityVal = obsWeather?.humidity !== undefined ? obsWeather.humidity.toFixed(0) : 'N/A';
    const precipVal = obsWeather?.precipitation !== undefined ? obsWeather.precipitation.toFixed(2) : 'N/A';
    const overcastVal = weatherFactors?.overcast?.toFixed(2) ?? 'N/A';
    const betaVal = weatherFactors?.beta?.toFixed(4) ?? 'N/A';
    const pathClarityVal = weatherFactors?.pathClarity?.toFixed(2) ?? 'N/A';
    const sunOcclVal = (unifiedClouds?.sunOcclusion * 100)?.toFixed(1) ?? '0.0';

    const debugLogPayload = {
      event: 'SOLAR_PATH_PHYSICS_SNAPSHOT',
      timestamp: new Date().toISOString(),
      observer: {
        latitude: location?.coords?.latitude ?? 'N/A',
        longitude: location?.coords?.longitude ?? 'N/A',
        elevationM: observerElevationM ?? 'N/A',
      },
      astronomy: {
        sunAltitude: sunAltitude,
        visualFov: visualFov,
        heading: heading,
      },
      atmosphere: {
        visibilityKm: visibilityVal,
        humidityPercent: humidityVal,
        precipitationMm: precipVal,
        aerosolBeta: betaVal,
        pathClarity: pathClarityVal,
      },
      clouds: {
        overcast: overcastVal,
        sunOcclusionPercent: sunOcclVal,
        totalRenderedObjects: unifiedClouds.clouds.length,
        types: (() => {
          const counts: Record<string, number> = {};
          unifiedClouds.clouds.forEach((c: any) => {
            const name = c.preset?.name || 'Unknown';
            counts[name] = (counts[name] || 0) + 1;
          });
          return counts;
        })(),
      },
      weatherGrid: interpolatedWeather?.map((w: any, idx: number) => ({
        index: idx,
        distanceKm: w.distance,
        azimuthOffset: w.azimuthOffset ?? 0,
        clouds: { low: w.low, mid: w.mid, high: w.high },
        humidityPercent: w.humidity,
        visibilityM: w.visibility,
        precipitationMm: w.precipitation,
      })) ?? [],
    };

    if (__DEV__) {
      console.log('[PHYSICS_DEBUG_SNAPSHOT]', JSON.stringify(debugLogPayload, null, 2));
    }

    try {
      const cloudRatio = weatherFactors?.overcast ?? 0;
      const base64Image = await generateSimulationImage(sunAltitude, cloudRatio);
      
      if (!base64Image) {
        Alert.alert('Error', 'Failed to generate simulation image.');
        return;
      }

      let finalSaveUri = base64Image;
      if (base64Image.startsWith('data:')) {
        try {
          const base64Data = base64Image.split(';base64,')[1];
          const tempFileUri = `${FileSystem.cacheDirectory}sim_snapshot_${Date.now()}.jpg`;
          await FileSystem.writeAsStringAsync(tempFileUri, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
          });
          finalSaveUri = tempFileUri;
        } catch (fsErr) {
          console.error('[Visualizer] Failed to write temp snapshot file:', fsErr);
          Alert.alert('Error', 'Failed to prepare image for saving.');
          return;
        }
      }

      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status === 'granted') {
        await MediaLibrary.saveToLibraryAsync(finalSaveUri);
        Alert.alert('Saved & Logged', '시뮬레이션 스냅샷 이미지가 갤러리에 저장되었으며, 기상 데이터가 콘솔(logcat)에 기록되었습니다.');
      } else {
        Alert.alert('Logged (No Storage Permission)', '기상 데이터가 콘솔에 기록되었습니다. (저장 공간 권한 없음)');
      }
    } catch (err) {
      console.warn('Failed to capture or save simulation debug image:', err);
      Alert.alert('Logged (Image Save Failed)', '기상 데이터가 콘솔에 기록되었습니다.');
    }
  };

  const renderDebugOverlay = () => {
    if (!isDebugMode) return null;

    const counts: Record<string, number> = {};
    unifiedClouds.clouds.forEach((c: any) => {
      const name = c.preset?.name || 'Unknown';
      counts[name] = (counts[name] || 0) + 1;
    });

    const observerLat = location?.coords?.latitude?.toFixed(4) ?? 'N/A';
    const observerLon = location?.coords?.longitude?.toFixed(4) ?? 'N/A';
    const observerEl = observerElevationM?.toFixed(1) ?? 'N/A';
    const sunAlt = sunAltitude?.toFixed(2) ?? 'N/A';
    
    const obsWeather = interpolatedWeather?.[0];
    const visibility = obsWeather?.visibility !== undefined ? `${(obsWeather.visibility / 1000).toFixed(1)}km` : 'N/A';
    const humidity = obsWeather?.humidity !== undefined ? `${obsWeather.humidity.toFixed(0)}%` : 'N/A';
    const precip = obsWeather?.precipitation !== undefined ? `${obsWeather.precipitation.toFixed(2)}mm` : 'N/A';
    
    const overcast = weatherFactors?.overcast?.toFixed(2) ?? 'N/A';
    const beta = weatherFactors?.beta?.toFixed(4) ?? 'N/A';
    const pathClarity = weatherFactors?.pathClarity?.toFixed(2) ?? 'N/A';
    const sunOccl = (unifiedClouds?.sunOcclusion * 100)?.toFixed(1) ?? '0.0';

    return (
      <View style={styles.debugOverlayContainer} pointerEvents="box-none">
        <Text style={styles.debugOverlayTitle}>SIMULATION PHYSICS DEBUG</Text>
        
        <View style={styles.debugRow}>
          <Text style={styles.debugLabel}>Observer Pos:</Text>
          <Text style={styles.debugValue}>{observerLat}°, {observerLon}° ({observerEl}m)</Text>
        </View>
        <View style={styles.debugRow}>
          <Text style={styles.debugLabel}>Sun Altitude:</Text>
          <Text style={styles.debugValue}>{sunAlt}°</Text>
        </View>
        <View style={styles.debugRow}>
          <Text style={styles.debugLabel}>Visibility / Hum:</Text>
          <Text style={styles.debugValue}>{visibility} / {humidity} (Rain: {precip})</Text>
        </View>
        <View style={styles.debugRow}>
          <Text style={styles.debugLabel}>Overcast / Beta:</Text>
          <Text style={styles.debugValue}>{overcast} / {beta}</Text>
        </View>
        <View style={styles.debugRow}>
          <Text style={styles.debugLabel}>Path Clarity / Occl:</Text>
          <Text style={styles.debugValue}>{pathClarity} / {sunOccl}%</Text>
        </View>

        <Text style={styles.debugSubTitle}>Active Cloud Objects ({unifiedClouds.clouds.length})</Text>
        {Object.entries(counts).length > 0 ? (
          Object.entries(counts).map(([name, count]) => (
            <View key={name} style={styles.debugCloudRow}>
              <Text style={styles.debugCloudName}>• {name}</Text>
              <Text style={styles.debugCloudCount}>{count} obj</Text>
            </View>
          ))
        ) : (
          <Text style={styles.debugNoCloud}>No cloud objects rendered</Text>
        )}

        <TouchableOpacity 
          style={styles.debugLogBtn} 
          onPress={handleLogAndCapture}
          activeOpacity={0.7}
        >
          <Text style={styles.debugLogBtnText}>Log & Save Snapshot</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const visualFovRef = useRef(visualFov);
  visualFovRef.current = visualFov;

  const fovDragRef = useRef<{ startY: number; startFov: number } | null>(null);
  const fovPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        fovDragRef.current = {
          startY: evt.nativeEvent.pageY,
          startFov: visualFovRef.current,
        };
      },
      onPanResponderMove: (evt) => {
        if (!fovDragRef.current || !onFovChange) return;
        // Drag UP = zoom in (smaller FOV), drag DOWN = zoom out (larger FOV)
        // The slider is 200px tall (bottom: 48, top: 8) representing 10−30°
        // 200px / 20° = 10px per degree
        const dy = evt.nativeEvent.pageY - fovDragRef.current.startY;
        const deltaFov = dy * (20 / 200); // 20° range over ~200px track height
        const newFov = Math.max(10, Math.min(30, fovDragRef.current.startFov + deltaFov));
        onFovChange(newFov);
      },
      onPanResponderRelease: () => {
        fovDragRef.current = null;
      },
    })
  ).current;

  const renderOverlayFovScale = () => {
    const fovPct = ((visualFov - 10) / 20) * 100;
    const fovTicks = [10, 15, 20, 25, 30];
    
    return (
      <View style={[styles.overlayFovContainer, { borderColor: theme.border }]} {...fovPanResponder.panHandlers}>
        <View style={styles.fovInnerWrapper}>
          <View style={styles.fovTrackLine} />
          {fovTicks.map((val) => {
            const pct = ((val - 10) / 20) * 100;
            return (
              <View 
                key={val} 
                style={[
                  styles.fovTickLine, 
                  { 
                    top: `${pct}%`, 
                  }
                ]}
              />
            );
          })}
          
          <View style={[styles.fovPointer, { top: `${fovPct}%`, borderColor: theme.accent }]}>
            <View style={[styles.fovPointerDot, { backgroundColor: theme.accent }]} />
            <View style={[styles.fovTooltip, { backgroundColor: 'rgba(5, 5, 10, 0.85)', borderColor: theme.accent }]}>
              <Text style={[styles.fovTooltipText, { color: '#ffffff' }]}>
                {visualFov.toFixed(0)}°
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  const skyStops = prediction?.skyGradient ?? [
    { offset: 0, color: '#08101e' },
    { offset: 1, color: '#08101e' },
  ];

  // ── Sky mosaic rendering constants ────────────────────────────────────────
  const SKY_ROWS = 8;
  const SKY_COLS = 5;
  const cellW = VISUALIZER_WIDTH / SKY_COLS;
  const cellH = (SKY_HEIGHT - HORIZON_Y) / SKY_ROWS; // only above horizon
  const horizonTop = SKY_HEIGHT - HORIZON_Y;

  return (
    <View ref={targetViewRef} style={[styles.visualizerContainer, { width: VISUALIZER_WIDTH }]}>
      <View 
        style={[styles.sky, { height: SKY_HEIGHT }]}
        {...panHandlers}
      >
        {/* ── Physical Sky Mosaic Background (8×5 grid, no blur/gradient) ── */}
        <Svg
          width={VISUALIZER_WIDTH}
          height={SKY_HEIGHT}
          style={StyleSheet.absoluteFillObject as any}
          pointerEvents="none"
        >
          {/* Night/below-horizon fill */}
          <Rect x={0} y={0} width={VISUALIZER_WIDTH} height={SKY_HEIGHT}
            fill={`rgb(1,2,12)`} />
          {/* Sky mosaic cells (above horizon only) */}
          {skyGrid.map((color, idx) => {
            const row = Math.floor(idx / SKY_COLS);
            const col = idx % SKY_COLS;
            const x = col * cellW;
            // row 0 = zenith (top), row 7 = near horizon (bottom)
            const y = row * cellH;
            const cssColor = rgbToCss(color);
            return (
              <Rect
                key={`sky-${row}-${col}`}
                x={x}
                y={y}
                width={cellW + 1}
                height={cellH + 1}
                fill={cssColor}
              />
            );
          })}
          {/* Below-horizon gradient (sea color fading to dark) */}
          <Defs>
            <LinearGradient id="belowHorizonGrad" x1="0" y1="0" x2="0" y2="1">
              {/* Use the lowest sky row color for continuity */}
              <Stop offset="0%" stopColor={skyGrid.length >= SKY_COLS
                ? rgbToCss(skyGrid[SKY_ROWS * SKY_COLS - Math.ceil(SKY_COLS / 2)])
                : '#08101e'} stopOpacity={0.9} />
              <Stop offset="100%" stopColor="rgb(1,2,12)" stopOpacity={1} />
            </LinearGradient>
            {/* Sea gradient — rendered behind terrain in this base SVG */}
            <LinearGradient id="bgSeaGradBase" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={terrainColors.seaStart} stopOpacity={0.85} />
              <Stop offset="40%" stopColor={terrainColors.seaMid} stopOpacity={0.95} />
              <Stop offset="100%" stopColor={terrainColors.seaEnd} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          {/* Below-horizon sky fade */}
          <Rect x={0} y={horizonTop} width={VISUALIZER_WIDTH} height={SKY_HEIGHT - horizonTop}
            fill="url(#belowHorizonGrad)" />
          {/* Sea fill — sits here so terrain SVG renders on top */}
          <Rect x={0} y={horizonTop} width={VISUALIZER_WIDTH} height={SKY_HEIGHT - horizonTop}
            fill="url(#bgSeaGradBase)" />
        </Svg>

        <Svg
          width={VISUALIZER_WIDTH}
          height={SKY_HEIGHT}
          style={StyleSheet.absoluteFillObject as any}
          pointerEvents="none"
        >
          <Defs>
            {/* Haze gradient (dust) */}
            <LinearGradient id="lightPillarGrad" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor={theme.accent ?? '#FFD700'} stopOpacity={0} />
              <Stop offset="25%" stopColor={theme.accent ?? '#FFD700'} stopOpacity={0.06} />
              <Stop offset="50%" stopColor={theme.accent ?? '#FFD700'} stopOpacity={0.4} />
              <Stop offset="75%" stopColor={theme.accent ?? '#FFD700'} stopOpacity={0.06} />
              <Stop offset="100%" stopColor={theme.accent ?? '#FFD700'} stopOpacity={0} />
            </LinearGradient>

            <LinearGradient id="pillarVerticalGrad" x1="0" y1="1" x2="0" y2="0">
              <Stop offset="0%" stopColor={theme.accent ?? '#FFD700'} stopOpacity={0.7} />
              <Stop offset="30%" stopColor={theme.accent ?? '#FFD700'} stopOpacity={0.35} />
              <Stop offset="70%" stopColor={theme.accent ?? '#FFD700'} stopOpacity={0.1} />
              <Stop offset="100%" stopColor={theme.accent ?? '#FFD700'} stopOpacity={0} />
            </LinearGradient>


            {/* Fine dust haze linear gradient for horizons */}
            <LinearGradient id="hazeGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#a37648" stopOpacity={0} />
              <Stop offset="45%" stopColor="#c59768" stopOpacity={0.65} />
              <Stop offset="75%" stopColor="#9a6e42" stopOpacity={0.8} />
              <Stop offset="100%" stopColor="#9a6e42" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          
          {/* 1. Solar Light Pillar */}
          {(() => {
            const sunX = VISUALIZER_WIDTH / 2;
            const apparentSunAltForPillar = getApparentAltitude(sunAltitude);
            const sunY = SKY_HEIGHT - ((apparentSunAltForPillar * DEGREE_TO_PIXEL) + HORIZON_Y);

            // Refined pillar trigger timing: sun must be very close to horizon or below it (0.1 to -4.0 degrees)
            let visibilityFactor = 0;
            if (apparentSunAltForPillar <= 0.1 && apparentSunAltForPillar >= -4.0) {
              if (apparentSunAltForPillar > 0.0) {
                // 0.1도 -> 0.0도: 서서히 밝아짐
                visibilityFactor = (0.1 - apparentSunAltForPillar) / 0.1;
              } else if (apparentSunAltForPillar >= -1.5) {
                // 0.0도 -> -1.5도: 황혼 피크 강도 유지
                visibilityFactor = 1.0;
              } else {
                // -1.5도 -> -4.0도: 밤이 다가오며 소멸
                visibilityFactor = (apparentSunAltForPillar - (-4.0)) / 2.5;
              }
            }
            const pillarOpacity = 0.15 * visibilityFactor;

            if (pillarOpacity <= 0) return null;

            const scaleZoom = 20 / visualFov;
            const topY = 0;
            const bottomY = Math.min(SKY_HEIGHT, sunY + 10);

            // Core: Thinner and sharper suject vertical beam
            const baseWidthCore = 2.5 * scaleZoom;
            const topWidthCore = 1.0 * scaleZoom;
            const corePoints = `
              ${sunX - topWidthCore / 2},${topY} 
              ${sunX + topWidthCore / 2},${topY} 
              ${sunX + baseWidthCore / 2},${bottomY} 
              ${sunX - baseWidthCore / 2},${bottomY}
            `.trim();

            // Glow: Thinner, highly soft surrounding ambient glow
            const baseWidthGlow = 9.0 * scaleZoom;
            const topWidthGlow = 3.5 * scaleZoom;
            const glowPoints = `
              ${sunX - topWidthGlow / 2},${topY} 
              ${sunX + topWidthGlow / 2},${topY} 
              ${sunX + baseWidthGlow / 2},${bottomY} 
              ${sunX - baseWidthGlow / 2},${bottomY}
            `.trim();

            return (
              <G opacity={pillarOpacity}>
                {/* Outer Glow (넓고 매우 부드러움) */}
                <Polygon
                  points={glowPoints}
                  fill="url(#pillarVerticalGrad)"
                  opacity={0.18}
                />
                {/* Inner Core (좁고 상대적으로 또렷함) */}
                <Polygon
                  points={corePoints}
                  fill="url(#pillarVerticalGrad)"
                  opacity={0.7}
                />
              </G>
            );
          })()}

          {/* 2. Sun Disk */}
          {(() => {
            const sunX = Number((VISUALIZER_WIDTH / 2).toFixed(2));
            const apparentSunAltForDisk = getApparentAltitude(sunAltitude);
            const sunY = Number((SKY_HEIGHT - ((apparentSunAltForDisk * DEGREE_TO_PIXEL) + HORIZON_Y)).toFixed(2));
            const sunColor = prediction?.sunDiskColor ?? '#FFD700';
            const parsedSun = parseColor(sunColor);
            const pureSunDiskColor = `rgb(${parsedSun.r}, ${parsedSun.g}, ${parsedSun.b})`;
            
            // pathClarity가 낮을수록(구름이 태양 앞을 가릴수록) 태양 디스크 자체도 흐려지거나 아예 소멸되도록 불투명도 조절
            const pathClarity = prediction?.factors?.pathClarity ?? 1.0;
            const baseSunOpacity = clamp01((pathClarity - 0.15) / 0.85);
            const sunOpacity = Math.max(0.1, baseSunOpacity * (1.0 - unifiedClouds.sunOcclusion));
            
            return (
              <G opacity={sunOpacity}>
                <Circle cx={sunX} cy={sunY} r={sunSize / 2} fill={pureSunDiskColor} />
              </G>
            );
          })()}

          {/* 3. Continuous Overcast Giant Clouds (Rendered behind terrain) */}
          {giantClouds.map((gCloud: any) => {
            if (!gCloud) return null;
            return (
              <Path
                key={gCloud.id}
                d={gCloud.pathStr}
                fill={gCloud.color}
                opacity={gCloud.opacity}
              />
            );
          })}

          {/* 4. Depth-sorted Clouds & Terrain (Z-Buffer) */}
          {(() => {
            const renderQueue: Array<{ S: number; key: string; element: React.ReactNode }> = [];

            // 1) Far Terrain (S = 25km)
            const farTerrain = renderFarTerrain();
            if (farTerrain) {
              renderQueue.push({
                S: 25,
                key: 'far-terrain',
                element: farTerrain,
              });
            }

            // 2) Foreground Terrain (S = 5km)
            const fgTerrain = renderForegroundTerrain();
            if (fgTerrain) {
              renderQueue.push({
                S: 5,
                key: 'fg-terrain',
                element: fgTerrain,
              });
            }

            // 3) Clouds
            unifiedClouds.clouds.forEach((cloud: any) => {
              if (!cloud) return;
              const key = `cloud-${cloud.id}`;
              let element: React.ReactNode = null;

              // 모든 구름은 각 프리셋의 물결무늬 템플릿 패스(Path)로 렌더링합니다.
              const tx = cloud.x - (cloud.baseWidth * cloud.finalScaleX) / 2;
              const ty = cloud.y;
              const scaleStr = `scale(${cloud.finalScaleX}, ${cloud.finalScaleY})`;
              if (cloud.preset?.name === 'Cirrus') {
                // 권운: 얇은 선이 겹쳐서 샛털 형태로 표현되도록 특수 렌더링 (투명도 조율)
                element = (
                  <G opacity={cloud.cloudOpacity * 0.45}>
                    {[0, 2, 4, 6].map((offsetY, idx) => (
                      <Path
                        key={idx}
                        d={cloud.pathStr}
                        fill="transparent"
                        stroke={cloud.finalLitColor}
                        strokeWidth={0.7}
                        transform={`translate(${tx}, ${ty + offsetY}) ${scaleStr}`}
                      />
                    ))}
                  </G>
                );
              } else {
                // 구름 종류별 그림자 축소 비율 지정 (테두리 림 두께 및 실루엣 조율)
                const isCirrocumulus = cloud.preset?.name === 'Cirrocumulus';
                const isStratus = cloud.preset?.name === 'Stratus' || cloud.preset?.name === 'Cirrostratus';
                
                // 층상운은 세로가 얇으므로 스케일 축소를 다르게 하고 일반 적운계열은 더 굵게 지정
                const shadowScaleX = isCirrocumulus ? 0.91 : isStratus ? 0.95 : 0.85;
                const shadowScaleY = isCirrocumulus ? 0.86 : isStratus ? 0.68 : 0.76;
                
                const dx = (cloud.baseWidth * (1.0 - shadowScaleX)) / 2;
                const dy = (cloud.baseHeight * (1.0 - shadowScaleY)) / 2;

                element = (
                  <G opacity={cloud.cloudOpacity}>
                    <G transform={`translate(${tx}, ${ty}) ${scaleStr}`}>
                      <Defs>
                        <ClipPath id={`clip-${cloud.id}`}>
                          <Path d={cloud.pathStr} />
                        </ClipPath>
                      </Defs>
                      
                      {/* 1. Top Half Area (위쪽 절반 빛색) */}
                      <Rect
                        x={-50}
                        y={-10}
                        width={cloud.baseWidth + 100}
                        height={cloud.baseHeight / 2 + 12}
                        fill={cloud.finalTopHalfColor}
                        clipPath={`url(#clip-${cloud.id})`}
                      />
                      
                      {/* 2. Bottom Half Area (아래쪽 절반 빛색) */}
                      <Rect
                        x={-50}
                        y={cloud.baseHeight / 2 - 2}
                        width={cloud.baseWidth + 100}
                        height={cloud.baseHeight / 2 + 12}
                        fill={cloud.finalBottomHalfColor}
                        clipPath={`url(#clip-${cloud.id})`}
                      />
                      
                      {/* 3. Inner Shadow Body (테두리 후광을 만들기 위한 안쪽 그늘 폴리곤) */}
                      <Path
                        d={cloud.pathStr}
                        fill={cloud.finalShadowColor}
                        transform={`translate(${dx}, ${dy}) scale(${shadowScaleX}, ${shadowScaleY})`}
                      />
                    </G>
                  </G>
                );
              }

              renderQueue.push({
                S: cloud.S,
                key,
                element,
              });
            });

            // Painter's Algorithm: 먼 것부터 렌더링 (거리 내림차순 정렬)
            renderQueue.sort((a, b) => b.S - a.S);

            return renderQueue.map((item) => (
              <G key={item.key}>
                {item.element}
              </G>
            ));
          })()}
        </Svg>
        {renderOverlayAzimuthScale()}
        {renderOverlayFovScale()}
        {renderNextEventBadge()}
        {/* 이미지 저장 버튼 제거 완료 */}
        {renderDebugOverlay()}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  visualizerContainer: { 
    alignSelf: 'center', 
    borderRadius: 24, 
    overflow: 'hidden', 
    marginBottom: 8 
  },
  sky: { position: 'relative', overflow: 'hidden' },
  exportJpgBtn: {
    position: 'absolute',
    top: 40,
    left: 8,
    backgroundColor: 'rgba(5, 5, 10, 0.65)',
    borderWidth: 1,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 150,
  },
  scaleClip: { flex: 1, overflow: 'hidden' },
  overlayCompass: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 32,
    zIndex: 120,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'flex-start',
    paddingTop: 4,
  },
  overlayTick: {
    position: 'absolute',
    top: 0,
    width: 1,
  },
  overlayTickLabel: {
    position: 'absolute',
    fontWeight: 'bold',
    width: 30,
    textAlign: 'center',
    marginLeft: -15,
    top: 8,
  },
  overlayCenterIndicator: {
    position: 'absolute',
    bottom: 0,
    left: '50%',
    marginLeft: -5,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  overlaySunMarker: {
    position: 'absolute',
    bottom: 1,
    alignItems: 'center',
    width: 30,
    marginLeft: -15,
  },
  overlaySunLabel: {
    fontSize: 7,
    fontWeight: '900',
    color: '#FFF',
    marginTop: 1,
  },
  overlayFovContainer: {
    position: 'absolute',
    left: 12,
    top: 12,
    bottom: 48,   // 나침반 높이(32) + 여유(16)
    width: 28,
    zIndex: 120,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(5, 5, 10, 0.5)',
  },
  fovInnerWrapper: {
    flex: 1,
    width: '100%',
    marginVertical: 14,
    position: 'relative',
    alignItems: 'center',
  },
  fovTrackLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 1,
  },
  fovTickLine: {
    position: 'absolute',
    left: 11, // (28 - 6) / 2 = 11
    width: 6,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  fovPointer: {
    position: 'absolute',
    left: 3, // (28 - 20) / 2 = 4 (테두리 보정)
    width: 20,
    height: 20,
    marginTop: -10,
    borderWidth: 1.5,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  fovPointerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  fovTooltip: {
    position: 'absolute',
    left: 26, // pointer width 20 + 6px gap
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    minWidth: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  fovTooltipText: {
    fontSize: 9,
    fontWeight: '800',
  },
  nextEventBadge: {
    position: 'absolute',
    top: 40,
    right: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    zIndex: 120,
    minWidth: 110,
  },
  nextEventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  eventDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  nextEventTitle: {
    fontSize: 7.5,
    fontWeight: '900',
    color: 'rgba(255, 255, 255, 0.6)',
    letterSpacing: 0.5,
  },
  nextEventValue: {
    fontSize: 12,
    fontWeight: '800',
  },
  nextEventTime: {
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.8,
  },
  debugOverlayContainer: {
    position: 'absolute',
    top: 12,
    left: 48,
    width: 210,
    backgroundColor: 'rgba(5, 5, 10, 0.75)',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    zIndex: 130,
  },
  debugOverlayTitle: {
    fontSize: 8,
    fontWeight: '900',
    color: '#38bdf8',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  debugSubTitle: {
    fontSize: 7.5,
    fontWeight: '900',
    color: '#a78bfa',
    marginTop: 6,
    marginBottom: 2,
    letterSpacing: 0.3,
  },
  debugRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 1,
  },
  debugLabel: {
    fontSize: 7.5,
    color: 'rgba(255, 255, 255, 0.55)',
    fontWeight: '600',
  },
  debugValue: {
    fontSize: 7.5,
    color: 'rgba(255, 255, 255, 0.9)',
    fontWeight: '700',
  },
  debugCloudRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: 4,
  },
  debugCloudName: {
    fontSize: 7,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '600',
  },
  debugCloudCount: {
    fontSize: 7,
    color: '#34d399',
    fontWeight: '700',
  },
  debugNoCloud: {
    fontSize: 7,
    color: 'rgba(255, 255, 255, 0.4)',
    fontStyle: 'italic',
    paddingLeft: 4,
  },
  debugLogBtn: {
    marginTop: 8,
    backgroundColor: '#0288d1',
    borderRadius: 6,
    paddingVertical: 5,
    alignItems: 'center',
  },
  debugLogBtnText: {
    color: '#FFF',
    fontSize: 8,
    fontWeight: '900',
  },
});
