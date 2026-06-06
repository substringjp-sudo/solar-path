import React, { useMemo, useRef } from 'react';
import { StyleSheet, View, Text, useWindowDimensions, Platform, GestureResponderHandlers, PanResponder } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, RadialGradient, Rect, Circle, Polygon, Path, G, Filter, FeGaussianBlur, FeOffset, FeComponentTransfer, FeFuncA, FeMerge, FeMergeNode, Ellipse, Polyline } from 'react-native-svg';
import { Sun } from 'lucide-react-native';
import { SunsetPrediction, getApparentAltitude, getHorizonDip, directBeamRGB, computeSkyGrid, rgbToCss, clamp01, skyColorAtDirection } from '../../utils/sunsetPhysics';
import { useCelestialStore } from '../../store/useCelestialStore';
import { getLocalTimeAtLocation, formatLocalTime } from '../../utils/timezone';
import { GridCloudShape } from '../../utils/cloudGridRenderer';

interface VisualizerProps {
  prediction: SunsetPrediction | null;
  sim: any;
  interpolatedWeather: any[];
  heading: number;
  visualFov: number;
  onFovChange?: (fov: number) => void;
  currentTime: Date;
  sunAltitude: number;
  isSunVisible: boolean;
  eventAzimuths: { sunrise: number; sunset: number };
  theme: any;
  panHandlers: GestureResponderHandlers;
  gridCloudShapes?: GridCloudShape[];
  location?: any;
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
export type CloudPresetName =
  | 'Cirrus'          // 권운 (새털구름)
  | 'Cirrocumulus'    // 권적운 (비늘구름)
  | 'Cirrostratus'    // 권층운 (햇무리구름)
  | 'Altocumulus'     // 고적운 (양떼구름)
  | 'Altostratus'     // 고층운 (차일구름)
  | 'Nimbostratus'    // 난층운 (비구름)
  | 'Stratocumulus'   // 층적운 (물결뭉게구름)
  | 'Stratus'         // 층운 (안개구름)
  | 'Cumulus'         // 적운 (뭉게구름)
  | 'Cumulonimbus';   // 적란운 (소나기구름)

interface CloudPreset {
  name: CloudPresetName;
  thickness: number;          // 0.0 ~ 1.0 (빛 차단 및 그늘 깊이)
  shadowContrast: number;     // 0.0 ~ 1.0 (그림자 색상 어두움 비중)
  scattering: number;         // 0.0 ~ 1.0 (구름 본체의 빛 산란 투과율)
  rimLightSharpness: number;  // 0.0 ~ 1.0 (림라이트 영역의 좁고 날카로운 정도)
  baseOpacity: number;        // 기본 투명도 바이어스
}

function getCloudPreset(
  layerType: 'high' | 'mid' | 'low',
  density: number,
  overcast: number,
  precipFactor: number,
  liquidWater: number,
  humidity: number = 50
): CloudPreset {
  if (layerType === 'high') {
    if (overcast > 0.6 && density > 60) {
      return {
        name: 'Cirrostratus',
        thickness: 0.12,
        shadowContrast: 0.15,
        scattering: 0.85,
        rimLightSharpness: 0.25,
        baseOpacity: 0.35,
      };
    } else if (density < 30 && overcast < 0.3) {
      return {
        name: 'Cirrus',
        thickness: 0.04,
        shadowContrast: 0.05,
        scattering: 0.95,
        rimLightSharpness: 0.15,
        baseOpacity: 0.15,
      };
    } else {
      return {
        name: 'Cirrocumulus',
        thickness: 0.16,
        shadowContrast: 0.20,
        scattering: 0.80,
        rimLightSharpness: 0.30,
        baseOpacity: 0.28,
      };
    }
  } else if (layerType === 'mid') {
    const isRaining = precipFactor > 0.15;
    if (isRaining) {
      return {
        name: 'Nimbostratus',
        thickness: 0.75,
        shadowContrast: 0.80,
        scattering: 0.30,
        rimLightSharpness: 0.50,
        baseOpacity: 0.80,
      };
    } else if (density > 65 || overcast > 0.6) {
      return {
        name: 'Altostratus',
        thickness: 0.55,
        shadowContrast: 0.50,
        scattering: 0.60,
        rimLightSharpness: 0.40,
        baseOpacity: 0.55,
      };
    } else {
      return {
        name: 'Altocumulus',
        thickness: 0.40,
        shadowContrast: 0.40,
        scattering: 0.70,
        rimLightSharpness: 0.60,
        baseOpacity: 0.45,
      };
    }
  } else {
    const isStormy = precipFactor > 0.35 || liquidWater > 20;
    if (isStormy) {
      return {
        name: 'Cumulonimbus',
        thickness: 1.00,
        shadowContrast: 0.98,
        scattering: 0.20,
        rimLightSharpness: 0.90,
        baseOpacity: 0.92,
      };
    }

    // 비 오는 날(강수가 약간 존재)이며 습도가 높은 먹구름 낀 안개날씨에 안개성 층운(Stratus) 판정
    const isRainingLight = precipFactor > 0.05;
    if (isRainingLight && humidity > 85) {
      return {
        name: 'Stratus',
        thickness: 0.65,
        shadowContrast: 0.60,
        scattering: 0.50,
        rimLightSharpness: 0.40,
        baseOpacity: 0.75,
      };
    }

    if (density > 60 || overcast > 0.6) {
      return {
        name: 'Stratocumulus',
        thickness: 0.80,
        shadowContrast: 0.82,
        scattering: 0.40,
        rimLightSharpness: 0.75,
        baseOpacity: 0.75,
      };
    }

    // 맑은 날이라도 안개/밤이슬 등으로 대기 하층 습도가 극도로 높을 때 층운(Stratus) 판정
    if (humidity > 90 && density < 40) {
      return {
        name: 'Stratus',
        thickness: 0.30,
        shadowContrast: 0.30,
        scattering: 0.70,
        rimLightSharpness: 0.30,
        baseOpacity: 0.35,
      };
    }

    return {
      name: 'Cumulus',
      thickness: 0.70,
      shadowContrast: 0.72,
      scattering: 0.45,
      rimLightSharpness: 0.82,
      baseOpacity: 0.65,
    };
  }
}

function getSunBeamColor(alt: number): { r: number; g: number; b: number } {
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


// Collage / Papercraft cloud SVG templates categorized by 10 specific cloud types
export const CLOUD_TEMPLATES: Record<CloudPresetName, string[]> = {
  Cirrus: [
    "M 0,20 C 20,15 45,8 70,12 C 85,14 110,7 130,12 C 105,16 80,13 55,20 C 35,25 15,23 0,20 Z",
    "M 0,15 C 30,12 60,6 90,12 C 110,16 130,8 150,15 C 120,18 90,15 60,20 C 30,22 15,19 0,15 Z"
  ],
  Cirrocumulus: [
    "M 0,15 C 10,8 20,8 30,15 C 40,8 50,8 60,15 C 70,8 80,8 90,15 C 75,20 45,20 15,20 C 5,20 0,18 0,15 Z",
    "M 10,12 C 18,6 26,6 34,12 C 42,6 50,6 58,12 C 66,6 74,6 82,12 C 68,16 42,16 16,16 Z"
  ],
  Cirrostratus: [
    "M 0,15 C 50,12 100,12 150,15 L 150,20 C 100,23 50,23 0,20 Z"
  ],
  Altocumulus: [
    "M 10,20 C 15,12 25,12 35,20 C 45,12 55,12 65,20 C 75,12 85,12 95,20 C 105,12 115,12 125,20 L 125,25 C 95,28 65,28 35,25 L 10,20 Z",
    "M 10,20 C 10,14 20,10 35,10 C 45,5 65,5 75,12 C 85,8 100,8 110,14 C 120,10 135,12 140,20 Z"
  ],
  Altostratus: [
    "M 5,22 C 30,15 60,28 90,20 C 120,12 150,25 180,22 L 180,27 C 150,30 120,17 90,25 C 60,33 30,20 5,27 Z"
  ],
  Nimbostratus: [
    "M 0,20 C 30,15 70,15 100,20 C 130,25 170,25 200,20 L 200,32 C 170,35 130,35 100,32 C 70,28 30,28 0,32 Z"
  ],
  Stratocumulus: [
    "M 15,25 C 15,18 28,12 45,16 C 55,8 80,8 95,18 C 110,10 135,12 145,22 C 155,20 170,25 175,32 C 150,35 125,32 15,32 Z",
    "M 15,22 C 15,16 25,12 40,12 C 50,7 72,7 82,14 C 92,10 110,10 120,16 C 130,12 145,14 150,22 Z"
  ],
  Stratus: [
    "M 0,10 C 20,8 50,5 80,10 C 110,15 150,8 180,12 L 180,16 C 150,12 110,19 80,14 C 50,9 20,12 0,14 Z"
  ],
  Cumulus: [
    "M 15,35 C 15,25 25,18 40,18 C 50,10 70,8 85,12 C 100,5 125,5 140,15 C 150,12 165,15 170,25 C 180,25 185,30 185,35 C 185,38 15,38 15,35 Z",
    "M 20,40 C 20,28 32,20 50,20 C 60,10 82,8 100,12 C 118,4 146,4 163,16 C 175,12 192,16 198,28 C 210,28 215,34 215,40 Z"
  ],
  Cumulonimbus: [
    "M 20,60 C 20,50 30,45 40,45 C 30,30 50,15 70,20 C 60,-5 120,-5 110,25 C 130,20 150,35 140,50 C 155,50 160,55 160,60 Z",
    "M 10,50 C 10,42 16,36 28,36 C 20,20 45,10 65,18 C 55,2 105,2 95,24 C 112,20 130,30 120,45 C 130,45 135,48 135,50 Z"
  ]
};

export const Visualizer: React.FC<VisualizerProps> = ({
  prediction,
  sim,
  interpolatedWeather,
  heading,
  visualFov,
  onFovChange,
  currentTime,
  sunAltitude,
  isSunVisible,
  eventAzimuths,
  theme,
  panHandlers,
  gridCloudShapes,
  location,
}) => {
  const { width, height } = useWindowDimensions();
  const { timezoneOffsetHours } = useCelestialStore();

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

  // uniforms definition moved below computedClouds

  // 1. Unified 3D Spatial Clouds Computation & Depth Sorting (Optimized caching)
  const allCloudLayersData = useMemo(() => {
    const results: any[] = [];
    if (!interpolatedWeather || !sim?.pathData) return results;

    const R_E = 6371; // Earth radius in km
    const h_v = (sim?.terrain?.observerElevation ?? 50) / 1000; // Observer altitude in km (default 50m)

    const types: ('high' | 'mid' | 'low')[] = ['high', 'mid', 'low'];
    const isOvercast = (prediction?.factors?.overheadOvercast ?? 0) >= 0.75;
    const overcast = prediction?.factors?.overheadOvercast ?? 0;

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
        const interpolated = interpolatedWeather[pIdx];
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
          sum += interpolatedWeather[1 + c * 7 + d]?.high ?? 0;
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
          const interpolated = interpolatedWeather[pIdx];
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
      sim.pathData.forEach((c: any, i: number) => {
        const interpolated = interpolatedWeather[i];
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

        // 구름 프리셋 판별 (보정된 perceivedDensity 적용)
        let preset = getCloudPreset(
          type,
          perceivedDensity,
          overcast,
          precip,
          water,
          humidity
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
        else if (preset.name === 'Cumulonimbus') H_c = 4.5;

        // 층상 장막 구름(Strata Layer) 여부 판정
        const isStrata = 
          preset.name === 'Nimbostratus' || 
          preset.name === 'Stratus' || 
          preset.name === 'Altostratus' || 
          preset.name === 'Cirrostratus';

        if (isStrata) {
          // 층상운은 개별 조각 구름 루프를 돌지 않고, 해당 위상(거리/층)마다 1개의 넓은 레이어만 생성
          const seed = type.charCodeAt(0) * 100 + i * 37;
          let d = baseDist;
          const isLocal = d === 0;
          if (isLocal) {
            d = 12; // 로컬 안개/비구름의 가상 기준 거리 (km)
          }

          const phi = d / R_E;
          const Vx = (R_E + H_c) * Math.sin(phi);
          const Vy = (R_E + H_c) * Math.cos(phi) - (R_E + h_v);
          const S = Math.sqrt(Vx * Vx + Vy * Vy);
          const alpha = Math.atan2(Vy, Vx);
          const elevationDeg = alpha * (180 / Math.PI);
          let apparentElevationDeg = getApparentAltitude(elevationDeg);

          if (isLocal || apparentElevationDeg >= -horizonDipDeg - 0.2) {
            const effElevationDeg = isLocal ? (visualFov / 2 + 10) : apparentElevationDeg;
            
            let baseHeight = 35;
            if (preset.name === 'Stratus') baseHeight = 45;
            else if (preset.name === 'Nimbostratus') baseHeight = 220;
            else if (preset.name === 'Altostratus') baseHeight = 70;
            else if (preset.name === 'Cirrostratus') baseHeight = 40;

            const baseColorStr = preset.name === 'Nimbostratus'
              ? 'rgba(65, 70, 80, 0.95)'
              : preset.name === 'Stratus'
              ? 'rgba(215, 222, 228, 0.45)'
              : preset.name === 'Altostratus'
              ? 'rgba(145, 140, 160, 0.6)'
              : 'rgba(225, 210, 225, 0.25)';

            results.push({
              id: `${type}-${i}-strata`,
              type,
              S: isLocal ? 0.1 : S,
              apparentElevationDeg: effElevationDeg,
              azimuthOffset: 0,
              baseWidth: VISUALIZER_WIDTH * 2.2,
              baseHeight,
              baseColorStr,
              seed,
              opacityDensity: perceivedDensity,
              d,
              pathStr: '',
              preset,
              isDeck,
              cloudCategory: isLocal ? 'near' : (d > 200 ? 'far' : 'mid'),
              weatherMode: {
                isStormSystem: status.isStormSystem,
                isStratusDeck: status.isStratusDeck,
                isCirrostratusVeil: status.isCirrostratusVeil,
                isCirrusStreamer: status.isCirrusStreamer,
                isScatteredCumulus: status.isScatteredCumulus,
              },
              isStrata: true,
              isLocal,
            });
          }
        } else {
          // 조각 구름들 (Cumulus, Altocumulus, Cumulonimbus 등)
          const isDenseDeck = status.isStormSystem || status.isStratusDeck;
          const cloudCount = isDenseDeck 
            ? Math.ceil(perceivedDensity / 16)
            : (isOvercast ? Math.ceil(perceivedDensity / 22) : Math.ceil(perceivedDensity / 10));
          
          for (let s = 0; s < cloudCount; s++) {
            const seed = type.charCodeAt(0) * 100 + i * 37 + s * 17;
            
            let d = baseDist;
            if (baseDist === 0) {
              d = 4 + ((seed * 13) % 25);
            } else if (baseDist <= 80) {
              d = 45 + ((seed * 19) % 55);
            } else if (baseDist <= 200) {
              d = 130 + ((seed * 29) % 100);
            } else {
              d = 270 + ((seed * 41) % 130);
            }

            const phi = d / R_E;
            const Vx = (R_E + H_c) * Math.sin(phi);
            const Vy = (R_E + H_c) * Math.cos(phi) - (R_E + h_v);
            
            const S = Math.sqrt(Vx * Vx + Vy * Vy);
            const alpha = Math.atan2(Vy, Vx);
            const elevationDeg = alpha * (180 / Math.PI);
            let apparentElevationDeg = getApparentAltitude(elevationDeg);

            if (d > 80) {
              const minHeightOffset = type === 'high' ? 1.0 : type === 'mid' ? 0.5 : 0.25;
              const targetLift = minHeightOffset + 1.2 * Math.exp(apparentElevationDeg);
              apparentElevationDeg = Math.max(apparentElevationDeg, targetLift);
            }

            if (apparentElevationDeg < -horizonDipDeg - 0.2) continue;

            let cloudCategory: 'near' | 'mid' | 'far' = 'mid';
            if (d <= 80) cloudCategory = 'near';
            else if (d > 200) cloudCategory = 'far';

            const templates = CLOUD_TEMPLATES[preset.name] || CLOUD_TEMPLATES.Cumulus;
            const templateIndex = seed % templates.length;
            const pathStr = templates[templateIndex];

            let baseWidth = 150;
            let baseHeight = 35;
            
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
            } else if (preset.name === 'Altocumulus') {
              baseWidth = 170;
              baseHeight = 30;
            } else if (preset.name === 'Cumulonimbus') {
              baseWidth = 160;
              baseHeight = 100;
            } else if (preset.name === 'Cumulus') {
              baseWidth = 190;
              baseHeight = 48;
            } else {
              baseWidth = 170;
              baseHeight = 32;
            }

            const baseColorStr =
              type === 'high'
                ? (prediction?.highCloudColor ?? 'rgba(255, 192, 203, 0.4)')
                : type === 'mid'
                ? (prediction?.midCloudColor ?? 'rgba(180, 150, 220, 0.35)')
                : (prediction?.lowCloudColor ?? 'rgba(100, 149, 237, 0.3)');

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
              weatherMode: {
                isStormSystem: status.isStormSystem,
                isStratusDeck: status.isStratusDeck,
                isCirrostratusVeil: status.isCirrostratusVeil,
                isCirrusStreamer: status.isCirrusStreamer,
                isScatteredCumulus: status.isScatteredCumulus,
              },
              isStrata: false,
              isLocal: false,
            });
          }
        }
      });
    });

    // Deep sort: further away (larger S) rendered first, so closer (smaller S) overlaps it!
    results.sort((a, b) => b.S - a.S);
    return results;
  }, [interpolatedWeather, sim, horizonDipDeg, prediction]);

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

  // 2. Unified 3D Spatial Clouds Mapping, Depth Sorting & Multi-Layer Occlusion
  const unifiedClouds = useMemo(() => {
    const horizonTop = SKY_HEIGHT - HORIZON_Y;
    const scaleZoom = 20 / visualFov;
    const { overcast, dustIntensity } = weatherFactors;

    const cloudsList: any[] = [];

    // ── Helper 1: Map allCloudLayersData (일반 3D 구름) ──────────────────────
    allCloudLayersData.forEach((item) => {
      const isStrata = item.isStrata;
      
      let x = VISUALIZER_WIDTH / 2;
      let y = horizonTop - (item.apparentElevationDeg * DEGREE_TO_PIXEL);
      let relativeAz = 0;
      let cloudAzimuthAbs = sim?.azimuth || 0;
      
      if (!isStrata) {
        const spatialDx = (((item.seed * 73) % 120) - 60); // in km
        const timeMs = currentTime.getTime();
        const windSpeedKmh = 25; 
        const windDriftKm = (timeMs / 3600000) * windSpeedKmh;
        const totalDx = spatialDx + (windDriftKm % 160 - 80);
        
        const totalAzOffset = item.azimuthOffset + Math.atan2(totalDx, item.d) * (180 / Math.PI);
        cloudAzimuthAbs = (sim?.azimuth || 0) + totalAzOffset;

        const relativeAzDeg = cloudAzimuthAbs - heading;
        relativeAz = ((relativeAzDeg + 180) % 360) - 180;
        
        const fovRad = (visualFov * Math.PI) / 180;
        const halfFovRad = fovRad / 2;
        const xOffsetRatio = Math.tan((relativeAz * Math.PI) / 180) / Math.tan(halfFovRad);
        x = (VISUALIZER_WIDTH / 2) + (xOffsetRatio * (VISUALIZER_WIDTH / 2));
      } else {
        if (item.isLocal) {
          y = 0; // 로컬 안개/비구름은 머리 위를 다 덮음
        } else {
          // 먼 층상 구름은 지평선 위 고도각 높이까지만 올라오도록 배치
          y = horizonTop - (item.apparentElevationDeg * DEGREE_TO_PIXEL);
        }
      }

      const perspectiveScale = 35 / item.S;
      const clampedScale = Math.max(0.075, Math.min(3.0, perspectiveScale));
      const foreshorteningFactor = 0.15 + (clampedScale / 3.0) * 0.85; 

      let finalScaleX = 1.0;
      let finalScaleY = 1.0;
      let renderWidth = item.baseWidth;
      let renderHeight = item.baseHeight;

      if (!isStrata) {
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
        finalScaleX = clampedScale * scaleZoom * horizontalStretch * densityStretch;
        finalScaleY = clampedScale * foreshorteningFactor * scaleZoom;
        
        renderWidth = item.baseWidth * finalScaleX;
        renderHeight = item.baseHeight * finalScaleY;
      } else {
        renderWidth = VISUALIZER_WIDTH * 2.2;
        
        if (item.isLocal) {
          renderHeight = SKY_HEIGHT;
        } else {
          const topY = horizonTop - (item.apparentElevationDeg * DEGREE_TO_PIXEL);
          const bottomY = horizonTop;
          renderHeight = Math.max(2, bottomY - topY);
        }
        
        const scaleY = Math.max(0.4, Math.min(1.6, perspectiveScale));
        finalScaleY = scaleY * scaleZoom;
      }

      // Skip rendering if way off-screen horizontally
      if (x + renderWidth < -100 || x - renderWidth > VISUALIZER_WIDTH + 100) {
        return;
      }

      // Proximity-to-Sun Gradient coloring:
      const relativeSunAz = (((sim?.azimuth || 180) - heading + 180) % 360) - 180;
      const lightDx = Math.sin((relativeSunAz * Math.PI) / 180);
      const lightDy = -Math.sin(((sunAltitude - 15) * Math.PI) / 180);
      
      const lightLength = Math.sqrt(lightDx * lightDx + lightDy * lightDy);
      const cosA = lightLength > 1e-5 ? lightDx / lightLength : 0;
      const sinA = lightLength > 1e-5 ? lightDy / lightLength : -1.0;
      
      const x1 = (0.5 - cosA * 0.5) * 100 + '%';
      const y1 = (0.5 - sinA * 0.5) * 100 + '%';
      const x2 = (0.5 + cosA * 0.5) * 100 + '%';
      const y2 = (0.5 + sinA * 0.5) * 100 + '%';

      const preset = item.preset;

      // 구름 기본 색 (날씨에 따라 칙칙함 반영)
      let baseCloudRGB = parseColor(item.baseColorStr);
      if (overcast > 0.5) {
        baseCloudRGB = interpolateColors(baseCloudRGB, { r: 90, g: 95, b: 105, a: 1 }, overcast * 0.8);
      }
      if (dustIntensity > 0.5) {
        baseCloudRGB = interpolateColors(baseCloudRGB, { r: 120, g: 105, b: 90, a: 1 }, dustIntensity * 0.7);
      }

      let azDiff = cloudAzimuthAbs - (sim?.azimuth || 180);
      azDiff = ((azDiff + 180) % 360) - 180;
      
      const dProjection = item.d * Math.cos((azDiff * Math.PI) / 180);
      const phiProjection = dProjection / 6371;
      const sunAltFromCloud = sunAltitude + phiProjection * (180 / Math.PI);
      const cloudBeam = getSunBeamColor(sunAltFromCloud);

      const angularDistanceToSun = Math.sqrt(azDiff * azDiff + (item.apparentElevationDeg - sunAltitude) * (item.apparentElevationDeg - sunAltitude));
      const ambientSky = skyColorAtDirection(
        Math.max(0.05, item.apparentElevationDeg),
        angularDistanceToSun,
        sunAltitude,
        weatherFactors.beta,
        weatherFactors.pathClarity
      );

      const beamIntensity = clamp01((sunAltFromCloud + 2.0) / 4.0) * weatherFactors.pathClarity;
      let litLight = mixRgb(ambientSky, cloudBeam, beamIntensity * 0.85);
      
      const darkShadowRGB = { r: 0.05, g: 0.06, b: 0.12 };
      let shadowLight = mixRgb(ambientSky, darkShadowRGB, preset.shadowContrast * 0.85);

      // ── 기상 모드별 색상 튜닝 ──
      if (item.weatherMode.isStormSystem) {
        // 비구름 폭풍우: 극단적으로 어두운 남회색/차콜 블랙 톤 대입
        litLight = mixRgb(litLight, { r: 0.06, g: 0.07, b: 0.10 }, 0.8);
        shadowLight = mixRgb(shadowLight, { r: 0.03, g: 0.04, b: 0.06 }, 0.9);
      } else if (item.weatherMode.isStratusDeck) {
        // 해무안개: 그림자 경계를 뽀얗고 밝게 하여 음영 대비 대폭 약화
        shadowLight = mixRgb(shadowLight, litLight, 0.7);
      }

      const litBlend = 0.9 - preset.thickness * 0.25;
      const shadowBlend = 0.8 - preset.thickness * 0.1;

      const finalLitRGB = interpolateColors(
        baseCloudRGB,
        { r: Math.round(litLight.r * 255), g: Math.round(litLight.g * 255), b: Math.round(litLight.b * 255), a: 1 },
        litBlend
      );
      const finalShadowRGB = interpolateColors(
        baseCloudRGB,
        { r: Math.round(shadowLight.r * 255), g: Math.round(shadowLight.g * 255), b: Math.round(shadowLight.b * 255), a: 1 },
        shadowBlend
      );

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

      // 안개(Stratus)는 반투명(transparent)하게 뒤가 보여야 함
      if (preset.name === 'Stratus') {
        cloudOpacity = Math.min(0.65, cloudOpacity);
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
        const y = horizonTop - (shape.apparentElevation * DEGREE_TO_PIXEL);

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

        const renderWidth = baseW * finalScaleX;
        const renderHeight = baseH * finalScaleY;

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

        const preset = getCloudPreset(
          shape.type,
          shape.density,
          overcast,
          avgPrecip,
          avgLiquidWater
        );

        const templates = CLOUD_TEMPLATES[preset.name] || CLOUD_TEMPLATES.Cumulus;
        const seed = shape.id.charCodeAt(5) * 100 + shape.centerDist;
        const templateIndex = seed % templates.length;
        const pathStr = templates[templateIndex];

        let baseRGB = parseColor(
          shape.type === 'high'
            ? (prediction?.highCloudColor ?? 'rgba(255, 192, 203, 0.5)')
            : shape.type === 'mid'
            ? (prediction?.midCloudColor ?? 'rgba(180, 150, 220, 0.45)')
            : (prediction?.lowCloudColor ?? 'rgba(100, 149, 237, 0.4)')
        );
        if (overcast > 0.5) baseRGB = interpolateColors(baseRGB, { r: 90, g: 95, b: 105, a: 1 }, overcast * 0.8);
        if (dustIntensity > 0.5) baseRGB = interpolateColors(baseRGB, { r: 120, g: 105, b: 90, a: 1 }, dustIntensity * 0.7);

        const cloudAzimuthAbs = (sim?.azimuth ?? 180) + shape.centerAzOffset + windAzOffset;
        let azDiff = cloudAzimuthAbs - (sim?.azimuth ?? 180);
        azDiff = ((azDiff + 180) % 360) - 180;
        
        const dProjection = shape.centerDist * Math.cos((azDiff * Math.PI) / 180);
        const phiProjection = dProjection / 6371;
        const sunAltFromCloud = sunAltitude + phiProjection * (180 / Math.PI);
        const cloudBeam = getSunBeamColor(sunAltFromCloud);

        const angularDistanceToSun = Math.sqrt(azDiff * azDiff + (shape.apparentElevation - sunAltitude) * (shape.apparentElevation - sunAltitude));
        const ambientSky = skyColorAtDirection(
          Math.max(0.05, shape.apparentElevation),
          angularDistanceToSun,
          sunAltitude,
          weatherFactors.beta,
          weatherFactors.pathClarity
        );

        const beamIntensity = clamp01((sunAltFromCloud + 2.0) / 4.0) * weatherFactors.pathClarity;
        let litLight = mixRgb(ambientSky, cloudBeam, beamIntensity * 0.85);
        
        const darkShadowRGB = { r: 0.05, g: 0.06, b: 0.12 };
        let shadowLight = mixRgb(ambientSky, darkShadowRGB, preset.shadowContrast * 0.85);

        const litBlend = 0.9 - preset.thickness * 0.25;
        const shadowBlend = 0.8 - preset.thickness * 0.1;

        let litRGB = interpolateColors(
          baseRGB,
          { r: Math.round(litLight.r * 255), g: Math.round(litLight.g * 255), b: Math.round(litLight.b * 255), a: 1 },
          litBlend
        );
        let shadowRGB = interpolateColors(
          baseRGB,
          { r: Math.round(shadowLight.r * 255), g: Math.round(shadowLight.g * 255), b: Math.round(shadowLight.b * 255), a: 1 },
          shadowBlend
        );

        const midRGB = interpolateColors(shadowRGB, litRGB, 0.45);

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

        const relativeSunAz = (((sim?.azimuth || 180) - heading + 180) % 360) - 180;
        const lightDx = Math.sin((relativeSunAz * Math.PI) / 180);
        const lightDy = -Math.sin(((sunAltitude - 15) * Math.PI) / 180);
        
        const lightLength = Math.sqrt(lightDx * lightDx + lightDy * lightDy);
        const cosA = lightLength > 1e-5 ? lightDx / lightLength : 0;
        const sinA = lightLength > 1e-5 ? lightDy / lightLength : -1.0;

        const x1 = `${(0.5 - cosA * 0.5) * 100}%`;
        const y1 = `${(0.5 - sinA * 0.5) * 100}%`;
        const x2 = `${(0.5 + cosA * 0.5) * 100}%`;
        const y2 = `${(0.5 + sinA * 0.5) * 100}%`;

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
          apparentElevationDeg: shape.apparentElevation,
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
    const sunY = SKY_HEIGHT - ((sunAltitude * DEGREE_TO_PIXEL) + HORIZON_Y);

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

    // ── 4단계: 다시 먼 거리 순(S 내림차순) 정렬 ────────────────────────────
    cloudsList.sort((a, b) => b.S - a.S);

    return {
      clouds: cloudsList,
      sunOcclusion,
    };
  }, [allCloudLayersData, gridCloudShapes, heading, visualFov, sunAltitude, currentTime, prediction, sim, VISUALIZER_WIDTH, SKY_HEIGHT, HORIZON_Y, DEGREE_TO_PIXEL, weatherFactors]);

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
    const verticalFovDeg = skyViewportH * visualFov / VISUALIZER_WIDTH;

    return computeSkyGrid(
      sunAltitude,
      sunAzDeg,
      heading,
      visualFov,
      beta,
      pathClarity,
      verticalFovDeg,
    );
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

      const minElev = type === 'high' ? 18 : type === 'mid' ? 6 : 0;
      const maxElev = type === 'high' ? Math.min(85, 55 * scaleFactor) : type === 'mid' ? Math.min(75, 22 * scaleFactor) : Math.min(50, 9 * scaleFactor);

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
      const opacity = Math.min(0.96, (avgDensity / 100) * overcast * 1.15);

      return {
        id: `giant-${type}`,
        pathStr,
        color: baseColorStr,
        opacity,
      };
    }).filter(Boolean);
  }, [prediction, interpolatedWeather, SKY_HEIGHT, HORIZON_Y, DEGREE_TO_PIXEL, VISUALIZER_WIDTH, heading, visualFov, currentTime, sim]);

  const renderFarTerrain = () => {
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
    const layers = terrainColors.layers;
    const contourLine = terrainColors.contourLine;

    return (
      <G key="far-mountain-group">
        {Array.from({ length: CONTOUR_LEVELS }, (_, li) => {
          const frac = ((li + 1) / CONTOUR_LEVELS);
          const ridgeFrac = ((li + 1.05) / CONTOUR_LEVELS);
          return (
            <G key={`far-cl-${li}`}>
              <Polygon
                points={getContourPoints(farAngles, dynamicScale * 1.5, 0, frac)}
                fill={layers[Math.min(li, layers.length - 1)]}
                opacity={0.92}
              />
              {li < CONTOUR_LEVELS - 1 && (
                <Polygon
                  points={getContourPoints(farAngles, dynamicScale * 1.5, 0, ridgeFrac)}
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
    if (!sim?.terrain?.panoramicAngles) return null;

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
    const layers = terrainColors.layers;
    const contourLine = terrainColors.contourLine;
    const fgAngles = sim.terrain.panoramicAngles || [];

    return (
      <G key="fg-mountain-group">
        {/* Panoramic Ridge Highlight */}
        {sunAltitude >= -4.0 && sunAltitude <= 8.0 && (
          <G>
            <Polyline
              points={getRidgeLinePoints(fgAngles, dynamicScale, -1.5)}
              fill="none"
              stroke="#FF8C00"
              strokeWidth={4.5}
              opacity={Math.max(0, Math.min(1, sunAltitude >= 0 ? 1 - (sunAltitude / 8) : 1 - (sunAltitude / -4))) * 0.45}
            />
            <Polyline
              points={getRidgeLinePoints(fgAngles, dynamicScale, -1)}
              fill="none"
              stroke="#FFE082"
              strokeWidth={1.8}
              opacity={Math.max(0, Math.min(1, sunAltitude >= 0 ? 1 - (sunAltitude / 8) : 1 - (sunAltitude / -4))) * 0.8}
            />
          </G>
        )}

        {/* Foreground Mountain layers */}
        {Array.from({ length: CONTOUR_LEVELS }, (_, li) => {
          const frac = ((li + 1) / CONTOUR_LEVELS);
          const ridgeFrac = ((li + 1.05) / CONTOUR_LEVELS);
          return (
            <G key={`fg-cl-${li}`}>
              <Polygon
                points={getContourPoints(fgAngles, dynamicScale, 0, frac)}
                fill={layers[Math.min(li, layers.length - 1)]}
                opacity={0.95}
              />
              {li < CONTOUR_LEVELS - 1 && (
                <Polygon
                  points={getContourPoints(fgAngles, dynamicScale, 0, ridgeFrac)}
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
            <Sun size={8} color="#FFA500" />
            <Text style={styles.overlaySunLabel}>RISE</Text>
          </View>
        )}
        {sunsetX >= 0 && sunsetX <= VISUALIZER_WIDTH && (
          <View style={[styles.overlaySunMarker, { left: sunsetX }]}>
            <Sun size={8} color="#FF4500" />
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
    const badgeColor = isSunrise ? '#FFA500' : '#FF4500';

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
    <View style={[styles.visualizerContainer, { width: VISUALIZER_WIDTH }]}>
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

            {/* Custom dynamic cloud gradients */}
            {unifiedClouds.clouds.map((cloud: any) => (
              <LinearGradient key={cloud.gradId} id={cloud.gradId} x1={cloud.x1} y1={cloud.y1} x2={cloud.x2} y2={cloud.y2}>
                <Stop offset="0%" stopColor={cloud.finalShadowColor} stopOpacity={1} />
                <Stop offset={cloud.stopMid} stopColor={cloud.finalMidColor} stopOpacity={1} />
                <Stop offset={cloud.stopLit} stopColor={cloud.finalLitColor} stopOpacity={1} />
                <Stop offset="100%" stopColor={cloud.finalHighlightColor} stopOpacity={1} />
              </LinearGradient>
            ))}
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
            const sunY = SKY_HEIGHT - ((sunAltitude * DEGREE_TO_PIXEL) + HORIZON_Y);

            // Refined pillar trigger timing: sun must be very close to horizon or below it (0.1 to -4.0 degrees)
            let visibilityFactor = 0;
            if (sunAltitude <= 0.1 && sunAltitude >= -4.0) {
              if (sunAltitude > 0.0) {
                // 0.1도 -> 0.0도: 서서히 밝아짐
                visibilityFactor = (0.1 - sunAltitude) / 0.1;
              } else if (sunAltitude >= -1.5) {
                // 0.0도 -> -1.5도: 황혼 피크 강도 유지
                visibilityFactor = 1.0;
              } else {
                // -1.5도 -> -4.0도: 밤이 다가오며 소멸
                visibilityFactor = (sunAltitude - (-4.0)) / 2.5;
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
            const sunY = Number((SKY_HEIGHT - ((sunAltitude * DEGREE_TO_PIXEL) + HORIZON_Y)).toFixed(2));
            const sunColor = prediction?.sunDiskColor ?? '#FFD700';
            const parsedSun = parseColor(sunColor);
            const pureSunDiskColor = `rgb(${parsedSun.r}, ${parsedSun.g}, ${parsedSun.b})`;
            
            // pathClarity가 낮을수록(구름이 태양 앞을 가릴수록) 태양 디스크 자체도 흐려지거나 아예 소멸되도록 불투명도 조절
            const pathClarity = prediction?.factors?.pathClarity ?? 1.0;
            const baseSunOpacity = clamp01((pathClarity - 0.15) / 0.85);
            const sunOpacity = baseSunOpacity * (1.0 - unifiedClouds.sunOcclusion);
            
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

            // 1) Far Terrain (S = 40km)
            const farTerrain = renderFarTerrain();
            if (farTerrain) {
              renderQueue.push({
                S: 40,
                key: 'far-terrain',
                element: farTerrain,
              });
            }

            // 2) Foreground Terrain (S = 8km)
            const fgTerrain = renderForegroundTerrain();
            if (fgTerrain) {
              renderQueue.push({
                S: 8,
                key: 'fg-terrain',
                element: fgTerrain,
              });
            }

            // 3) Clouds
            unifiedClouds.clouds.forEach((cloud: any) => {
              if (!cloud) return;
              const key = `cloud-${cloud.id}`;
              let element: React.ReactNode = null;

              if (cloud.isStrata) {
                // 층상운은 가로폭이 넓은 면(Rect)으로 연출합니다.
                const rx = -0.6 * VISUALIZER_WIDTH;
                element = (
                  <G opacity={cloud.cloudOpacity}>
                    <Rect
                      x={rx}
                      y={cloud.y}
                      width={cloud.renderWidth}
                      height={cloud.renderHeight}
                      fill={`url(#${cloud.gradId})`}
                    />
                  </G>
                );
              } else {
                // 일반 구름은 기존 방식대로 Path로 렌더링합니다.
                const tx = cloud.x - (cloud.baseWidth * cloud.finalScaleX) / 2;
                const ty = cloud.y;
                const scaleStr = `scale(${cloud.finalScaleX}, ${cloud.finalScaleY})`;
                element = (
                  <G opacity={cloud.cloudOpacity}>
                    <Path
                      d={cloud.pathStr}
                      fill={`url(#${cloud.gradId})`}
                      transform={`translate(${tx}, ${ty}) ${scaleStr}`}
                    />
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
  fovTickText: {
    display: 'none',
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
});
