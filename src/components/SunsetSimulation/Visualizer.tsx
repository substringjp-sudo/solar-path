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
type CloudPresetName =
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
const CLOUD_TEMPLATES: Record<CloudPresetName, string[]> = {
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

        // 구름 프리셋 판별 (기상 조건 반영)
        const preset = getCloudPreset(
          type,
          density,
          overcast,
          precip,
          water,
          humidity
        );

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
        else if (preset.name === 'Cumulonimbus') H_c = 4.5; // 거대한 적란운 중심

        // If overcast, we draw massive giant bands instead of 100s of small clouds to prevent FPS drop and look cleaner.
        // We still render a few scattered background clouds to give depth.
        const cloudCount = isOvercast ? Math.ceil(density / 35) : Math.ceil(density / 12);
        
        for (let s = 0; s < cloudCount; s++) {
          const seed = type.charCodeAt(0) * 100 + i * 37 + s * 17;
          
          // Spread clouds dynamically around the sampling area to avoid artificial bands
          let d = baseDist;
          if (baseDist === 0) {
            d = 4 + ((seed * 13) % 25); // 4 to 29 km
          } else if (baseDist <= 80) {
            d = 45 + ((seed * 19) % 55); // 45 to 100 km
          } else if (baseDist <= 200) {
            d = 130 + ((seed * 29) % 100); // 130 to 230 km
          } else {
            d = 270 + ((seed * 41) % 130); // 270 to 400 km
          }

          // Earth curvature elevation angle calculation
          const phi = d / R_E;
          const Vx = (R_E + H_c) * Math.sin(phi);
          const Vy = (R_E + H_c) * Math.cos(phi) - (R_E + h_v);
          
          const S = Math.sqrt(Vx * Vx + Vy * Vy); // line of sight distance (km)
          const alpha = Math.atan2(Vy, Vx);
          const elevationDeg = alpha * (180 / Math.PI);
          let apparentElevationDeg = getApparentAltitude(elevationDeg);

          // 먼 거리 구름 (d > 80km)에 대한 수평선 리프트 및 압축 효과 적용
          if (d > 80) {
            // 거리가 멀수록 대기 굴절 및 구름 두께 효과로 지평선 바로 위에 맺힙니다.
            // 음수이거나 너무 낮은 고도각을 지평선 위(0.3도 ~ 2.0도 사이)로 들어올립니다.
            const minHeightOffset = type === 'high' ? 1.0 : type === 'mid' ? 0.5 : 0.25;
            const targetLift = minHeightOffset + 1.2 * Math.exp(apparentElevationDeg);
            apparentElevationDeg = Math.max(apparentElevationDeg, targetLift);
          }

          // Skip if below horizon dip
          if (apparentElevationDeg < -horizonDipDeg - 0.2) continue;

          // Resolve papercraft template based on distance categories
          let cloudCategory: 'near' | 'mid' | 'far' = 'mid';
          if (d <= 80) cloudCategory = 'near';
          else if (d > 200) cloudCategory = 'far';

          const templates = CLOUD_TEMPLATES[preset.name] || CLOUD_TEMPLATES.Cumulus;
          const templateIndex = seed % templates.length;
          const pathStr = templates[templateIndex];

          // 구름 종류별 렌더링 규격(Aspect Ratio) 설정
          let baseWidth = 150;
          let baseHeight = 35;
          
          if (preset.name === 'Cirrus' || preset.name === 'Stratus') {
            baseWidth = 220;
            baseHeight = 15;
          } else if (preset.name === 'Cirrostratus' || preset.name === 'Altostratus' || preset.name === 'Nimbostratus') {
            baseWidth = 240;
            baseHeight = 24;
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

          // Base cloud color
          const baseColorStr =
            type === 'high'
              ? (prediction?.highCloudColor ?? 'rgba(255, 192, 203, 0.4)')
              : type === 'mid'
              ? (prediction?.midCloudColor ?? 'rgba(180, 150, 220, 0.35)')
              : (prediction?.lowCloudColor ?? 'rgba(100, 149, 237, 0.3)');

          results.push({
            id: `${type}-${i}-${s}`,
            type,
            S, // distance for depth sorting
            apparentElevationDeg,
            azimuthOffset: c?.azimuthOffset ?? 0, // Fanning offset
            baseWidth,
            baseHeight,
            baseColorStr,
            seed,
            opacityDensity: density,
            d,
            pathStr,
            cloudCategory,
            preset,
            precipitation: interpolated.precipitation ?? 0,
            liquidWater: interpolated.totalColumnWaterVapour ?? 0,
          });
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

  // 2. Map computed sorted clouds to visual SVG structures with dynamic warm gradients and shadows
  const computedClouds = useMemo(() => {
    const horizonTop = SKY_HEIGHT - HORIZON_Y;
    const scaleZoom = 20 / visualFov;
    
    return allCloudLayersData.map((item) => {
      // Compute wind drift coordinate here (since currentTime is in dependency array here)
      const spatialDx = (((item.seed * 73) % 120) - 60); // in km
      const timeMs = currentTime.getTime();
      const windSpeedKmh = 25; 
      const windDriftKm = (timeMs / 3600000) * windSpeedKmh;
      const totalDx = spatialDx + (windDriftKm % 160 - 80);
      
      // Cloud azimuth relative to sim azimuth, factoring in 3-Ray Fanning offset
      const totalAzOffset = item.azimuthOffset + Math.atan2(totalDx, item.d) * (180 / Math.PI);
      
      // Absolute azimuth of the cloud
      const cloudAzimuthAbs = (sim?.azimuth || 0) + totalAzOffset;

      // Horizontal mapping via tangent visual FOV camera projection
      const relativeAzDeg = cloudAzimuthAbs - heading;
      const relativeAz = ((relativeAzDeg + 180) % 360) - 180;
      
      const fovRad = (visualFov * Math.PI) / 180;
      const halfFovRad = fovRad / 2;
      const xOffsetRatio = Math.tan((relativeAz * Math.PI) / 180) / Math.tan(halfFovRad);
      const x = (VISUALIZER_WIDTH / 2) + (xOffsetRatio * (VISUALIZER_WIDTH / 2));

      // Vertical mapping
      const y = horizonTop - (item.apparentElevationDeg * DEGREE_TO_PIXEL);

      // Unified 3D scaling (clamping scale carefully)
      const perspectiveScale = 35 / item.S;
      // 원거리 크기 최소 한계를 0.04에서 0.075로 완화하여 가독성 확보
      const clampedScale = Math.max(0.075, Math.min(3.0, perspectiveScale));
      const foreshorteningFactor = 0.15 + (clampedScale / 3.0) * 0.85; 

      // 먼 거리 구름은 수평선 전체를 덮는 거대한 띠 형태이므로 가로로 길게 스트레칭합니다.
      const horizontalStretch = item.cloudCategory === 'far' ? 3.2 : item.cloudCategory === 'mid' ? 1.8 : 1.0;
      const finalScaleX = clampedScale * scaleZoom * horizontalStretch;
      const finalScaleY = clampedScale * foreshorteningFactor * scaleZoom;

      const renderWidth = item.baseWidth * finalScaleX;
      const renderHeight = item.baseHeight * finalScaleY;

      // Skip rendering if way off-screen horizontally
      if (x + renderWidth < -50 || x - renderWidth > VISUALIZER_WIDTH + 50) {
        return null;
      }

      // Proximity-to-Sun Gradient coloring:
      const sunY = SKY_HEIGHT - ((sunAltitude * DEGREE_TO_PIXEL) + HORIZON_Y);
      const sunX = VISUALIZER_WIDTH / 2;

      // 태양은 무한히 먼 거리의 평행 광원(Parallel Light)이므로 구름의 개별 좌표 x에 따라 
      // 빛받는 방향이 좌우로 뒤집혀서는 안 됩니다. 
      // 오직 카메라 시야각(heading) 대비 태양 방위각(sim.azimuth) 차이에 의해 구름 전체의 광원 수평 성분이 통일되게 회전합니다.
      const relativeSunAz = (((sim?.azimuth || 180) - heading + 180) % 360) - 180;
      const lightDx = Math.sin((relativeSunAz * Math.PI) / 180);
      
      // 수직 성분: 태양의 고도가 15도 부근일 때 수직 성분이 0이 되도록 설정
      const lightDy = -Math.sin(((sunAltitude - 15) * Math.PI) / 180);
      
      // 광원 벡터 정규화
      const lightLength = Math.sqrt(lightDx * lightDx + lightDy * lightDy);
      const cosA = lightLength > 1e-5 ? lightDx / lightLength : 0;
      const sinA = lightLength > 1e-5 ? lightDy / lightLength : -1.0;
      
      // Vector coordinates relative to bounding box
      const x1 = (0.5 - cosA * 0.5) * 100 + '%';
      const y1 = (0.5 - sinA * 0.5) * 100 + '%';
      const x2 = (0.5 + cosA * 0.5) * 100 + '%';
      const y2 = (0.5 + sinA * 0.5) * 100 + '%';

      // 1) 구름 프리셋 판별 (기존의 물리연산 시 지정한 preset 재사용)
      const preset = item.preset;

      // 구름 기본 색 (날씨에 따라 칙칙함 반영)
      let baseCloudRGB = parseColor(item.baseColorStr);
      const { overcast, dustIntensity } = weatherFactors;
      if (overcast > 0.5) {
        baseCloudRGB = interpolateColors(baseCloudRGB, { r: 90, g: 95, b: 105, a: 1 }, overcast * 0.8);
      }
      if (dustIntensity > 0.5) {
        baseCloudRGB = interpolateColors(baseCloudRGB, { r: 120, g: 105, b: 90, a: 1 }, dustIntensity * 0.7);
      }

      // 2) 태양 방위각 차이
      let azDiff = cloudAzimuthAbs - (sim?.azimuth || 180);
      azDiff = ((azDiff + 180) % 360) - 180;
      
      // 3) 태양 방향 투영 수평 거리
      const dProjection = item.d * Math.cos((azDiff * Math.PI) / 180);
      const phiProjection = dProjection / 6371;
      // 4) 지구 곡률에 기인한 구름 시점의 겉보기 태양 고도각 계산 (일몰 후 지평선 너머 해돋이 광량 반영)
      const sunAltFromCloud = sunAltitude + phiProjection * (180 / Math.PI);

      const latVal = (location as any)?.coords?.latitude ?? 37.5665;
      const doy = 172; // default
      const cloudHeightM = item.type === 'high' ? 9500 : item.type === 'mid' ? 4500 : 1500;

      // 5) 구름 고도에서의 물리적인 직사광선 스펙트럼 색상 보간
      const cloudBeam = getSunBeamColor(sunAltFromCloud);

      // 6) 구름 주변 하늘 앰비언트(주변광) 색상
      const angularDistanceToSun = Math.sqrt(azDiff * azDiff + (item.apparentElevationDeg - sunAltitude) * (item.apparentElevationDeg - sunAltitude));
      const ambientSky = skyColorAtDirection(
        Math.max(0.05, item.apparentElevationDeg),
        angularDistanceToSun,
        sunAltitude,
        weatherFactors.beta,
        weatherFactors.pathClarity
      );

      // 7) 구름 위치의 직사광 강도 (지평선 아래 감쇠 반영)
      const beamIntensity = clamp01((sunAltFromCloud + 2.0) / 4.0) * weatherFactors.pathClarity;

      // 8) Lit / Shadow 광원 블렌딩
      const litLight = mixRgb(ambientSky, cloudBeam, beamIntensity * 0.85);
      
      // 얇은 구름(preset.thickness 낮음)은 그림자도 밝은 산란광을 많이 받아 밝음
      // 두꺼운 구름(preset.thickness 높음)은 매우 어두운 차콜 그늘 톤으로 수렴
      const darkShadowRGB = { r: 0.05, g: 0.06, b: 0.12 };
      const shadowLight = mixRgb(ambientSky, darkShadowRGB, preset.shadowContrast * 0.85);

      // 얇은 구름은 baseCloudRGB의 흔적을 덜 남기고 산란된 빛(litLight)을 뽀얗게 머금음
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

      // 중간톤(Mid) 색상 계산: 태양 방향의 은은한 광원이 구름 몸통에 더 넓게 전이되도록 가중치 상향 (0.45 -> 0.65)
      const finalMidRGB = interpolateColors(finalShadowRGB, finalLitRGB, 0.65);

      // 하이라이트(Highlight) 색상 계산: 태양을 마주하는 림 에지용 밝은 광택
      const highlightIntensity = preset.thickness > 0.5 ? 1.0 : 0.7;
      const finalHighlightRGB = interpolateColors(
        finalLitRGB,
        { r: Math.round(cloudBeam.r * 255), g: Math.round(cloudBeam.g * 255), b: Math.round(cloudBeam.b * 255), a: 1 },
        highlightIntensity
      );

      // 9) Mie phase 역광 하이라이트 (테두리 실버 라이닝 추가 증폭)
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
          mieHighlight * 0.75
        );
      }

      // 두께에 따른 그라데이션 Stop 오프셋 계산: 빛받는 면이 구름 안쪽으로 더 은은히 확산되도록 스톱 오프셋 앞당김
      const stopMid = `${Math.round(20 + preset.thickness * 25)}%`; // 20% ~ 45%
      const stopLit = `${Math.round(45 + preset.thickness * 20)}%`; // 45% ~ 65%

      // Shadow offset (opposite to the sun vector)
      const shadowDist = Math.min(6, 2 + renderHeight * 0.15);
      const shadowDx = -cosA * shadowDist;
      const shadowDy = -sinA * shadowDist;

      // Haze attenuation
      const aerosolScaleHeight = 260; 
      const aerosolExtinction = Math.exp(-item.S / aerosolScaleHeight);

      const gradId = `cloudGrad-${item.id}`;

      // 흐릴수록(overcast가 높을수록) 구름의 투명도가 더 불투명해지도록 보정 (최대 0.90)
      const maxOpacityCap = 0.45 + (weatherFactors.overcast * 0.45);
      const baseOpacityAttenuated = preset.baseOpacity * aerosolExtinction * (1.0 + weatherFactors.overcast * 0.5);
      const cloudOpacity = Math.max(
        Math.min(0.95, Math.max(0.15, (item.opacityDensity / 100) * maxOpacityCap)),
        Math.min(0.95, baseOpacityAttenuated)
      );

      return {
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
        relativeAz
      };
    }).filter(Boolean);
  }, [allCloudLayersData, heading, visualFov, sunAltitude, currentTime, prediction, sim, VISUALIZER_WIDTH, SKY_HEIGHT, HORIZON_Y, DEGREE_TO_PIXEL]);

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

  const renderTerrain = () => {
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

    // Helper: get terrain height angle at absolute azimuth
    const getAngle = (angles: number[], azDeg: number) => {
      if (angles.length < 2) return 0;
      const normalizedAz = ((azDeg % 360) + 360) % 360;
      const index = (normalizedAz / 360) * (angles.length - 1);
      const i1 = Math.floor(index);
      const i2 = (i1 + 1) % angles.length;
      const ratio = index - i1;
      return (angles[i1] || 0) * (1 - ratio) + (angles[i2] || 0) * ratio;
    };

    // Build polygon points string for a given height fraction (0=ground, 1=full ridge)
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

    // Build polyline points string for the top silhouette ridge only
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

    // ── Contour layer fractions ──────────────────────────────────
    const CONTOUR_LEVELS = 5;
    const layers = terrainColors.layers;
    const contourLine = terrainColors.contourLine;
    const farAngles = sim.terrain.farAngles || [];
    const fgAngles = sim.terrain.panoramicAngles || [];

    return (
      <G>
        {/* Panoramic Ridge Highlight (glowing orange/gold rim on foreground ridge) */}
        {sunAltitude >= -4.0 && sunAltitude <= 8.0 && (
          <G>
            {/* Outer blur-like glow */}
            <Polyline
              points={getRidgeLinePoints(fgAngles, dynamicScale, -1.5)}
              fill="none"
              stroke="#FF8C00"
              strokeWidth={4.5}
              opacity={Math.max(0, Math.min(1, sunAltitude >= 0 ? 1 - (sunAltitude / 8) : 1 - (sunAltitude / -4))) * 0.45}
            />
            {/* Inner core */}
            <Polyline
              points={getRidgeLinePoints(fgAngles, dynamicScale, -1)}
              fill="none"
              stroke="#FFE082"
              strokeWidth={1.8}
              opacity={Math.max(0, Math.min(1, sunAltitude >= 0 ? 1 - (sunAltitude / 8) : 1 - (sunAltitude / -4))) * 0.8}
            />
          </G>
        )}

        {/* ── Far Mountain: topographic contour layers ─────────────────────── */}
        {farAngles.length > 1 && (
          <G>
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
        )}

        {/* ── Foreground Mountain: topographic contour layers ──────────────── */}
        <G>
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

  const fovDragRef = useRef<{ startY: number; startFov: number } | null>(null);
  const fovPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        fovDragRef.current = {
          startY: evt.nativeEvent.pageY,
          startFov: visualFov,
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
      <View style={styles.overlayFovContainer} {...fovPanResponder.panHandlers}>
        <View style={styles.fovTrackLine} />
        {fovTicks.map((val) => {
          const pct = ((val - 10) / 20) * 100;
          const isBase = val === 20;
          return (
            <View 
              key={val} 
              style={[
                styles.fovTickLine, 
                { 
                  top: `${pct}%`, 
                  width: isBase ? 10 : 6,
                  backgroundColor: 'rgba(255,255,255,0.4)'
                }
              ]}
            >
              <Text style={styles.fovTickText}>
                {val}°
              </Text>
            </View>
          );
        })}
        
        <View style={[styles.fovPointer, { top: `${fovPct}%`, borderColor: theme.accent }]}>
          <View style={[styles.fovPointerDot, { backgroundColor: theme.accent }]} />
          <View style={[styles.fovTooltip, { backgroundColor: 'rgba(0,0,0,0.75)', borderColor: theme.accent }]}>
            <Text style={[styles.fovTooltipText, { color: '#ffffff' }]}>
              {visualFov.toFixed(0)}°
            </Text>
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
            {computedClouds.map((cloud: any) => (
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
            const sunOpacity = clamp01((pathClarity - 0.15) / 0.85);
            
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

          {/* 4. 3D Depth-sorted Clouds */}
          {computedClouds.map((cloud: any) => {
            if (!cloud) return null;
            const tx = cloud.x - (cloud.baseWidth * cloud.finalScaleX) / 2;
            const ty = cloud.y;
            const scaleStr = `scale(${cloud.finalScaleX}, ${cloud.finalScaleY})`;
            return (
              <G key={cloud.id} opacity={cloud.cloudOpacity}>
                {/* Cloud fill only — no border/shadow */}
                <Path
                  d={cloud.pathStr}
                  fill={`url(#${cloud.gradId})`}
                  transform={`translate(${tx}, ${ty}) ${scaleStr}`}
                />
              </G>
            );
          })}

          {/* 4.5. Enhanced Grid Clouds */}
          {gridCloudShapes && gridCloudShapes.length > 0 && gridCloudShapes.map((shape) => {
            const horizonTop = SKY_HEIGHT - HORIZON_Y;
            const timeMs = currentTime.getTime();
            const windSpeedKmh = 25;
            const windDriftKm = (timeMs / 3600000) * windSpeedKmh;
            const totalDx = (windDriftKm % 160 - 80);
            const windAzOffset = Math.atan2(totalDx, shape.centerDist) * (180 / Math.PI);
            const relAzDeg = shape.centerAzOffset + windAzOffset;
            const relAz = ((relAzDeg + 180) % 360) - 180;
            const fovRad = (visualFov * Math.PI) / 180;
            const halfFovRad = fovRad / 2;
            const xOffsetRatio = Math.tan((relAz * Math.PI) / 180) / Math.tan(halfFovRad);
            const cx = (VISUALIZER_WIDTH / 2) + (xOffsetRatio * (VISUALIZER_WIDTH / 2));
            const cy = horizonTop - (shape.apparentElevation * DEGREE_TO_PIXEL);
            let cloudCategory: 'near' | 'mid' | 'far' = 'mid';
            if (shape.centerDist <= 80) cloudCategory = 'near';
            else if (shape.centerDist > 200) cloudCategory = 'far';
            const seed = shape.id.charCodeAt(5) * 100 + shape.centerDist;
            
            const { overcast, dustIntensity } = weatherFactors;
            const avgPrecip = interpolatedWeather && interpolatedWeather.length > 0
              ? interpolatedWeather.reduce((sum, w) => sum + (w.precipitation || 0), 0) / interpolatedWeather.length
              : 0;
            const avgLiquidWater = interpolatedWeather && interpolatedWeather.length > 0
              ? interpolatedWeather.reduce((sum, w) => sum + (w.totalColumnWaterVapour || 0), 0) / interpolatedWeather.length
              : 0;

            // 1) 구름 프리셋 판별
            const preset = getCloudPreset(
              shape.type,
              shape.density,
              overcast,
              avgPrecip,
              avgLiquidWater
            );

            const templates = CLOUD_TEMPLATES[preset.name] || CLOUD_TEMPLATES.Cumulus;
            const templateIndex = seed % templates.length;
            const cloudPath = templates[templateIndex];

            // 구름 종류별 렌더링 규격(Aspect Ratio) 설정
            let baseW = 150;
            let baseH = 35;
            
            if (preset.name === 'Cirrus' || preset.name === 'Stratus') {
              baseW = 220;
              baseH = 15;
            } else if (preset.name === 'Cirrostratus' || preset.name === 'Altostratus' || preset.name === 'Nimbostratus') {
              baseW = 240;
              baseH = 24;
            } else if (preset.name === 'Cumulonimbus') {
              baseW = 160;
              baseH = 100;
            } else if (preset.name === 'Cumulus') {
              baseW = 190;
              baseH = 48;
            } else {
              baseW = 170;
              baseH = 32;
            }

            const perspectiveScale = 45 / Math.max(10, shape.centerDist);
            const clampedScale = Math.max(0.06, Math.min(2.5, perspectiveScale));
            const scaleZoom = 20 / visualFov;
            const finalScale = clampedScale * scaleZoom;
            const renderW = baseW * finalScale;
            const renderH = baseH * finalScale * 0.6;

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

            const latVal = (location as any)?.coords?.latitude ?? 37.5665;
            const doy = 172;
            const cloudHeightM = shape.type === 'high' ? 9500 : shape.type === 'mid' ? 4500 : 1500;

            // 2) 구름 고도에서의 물리적인 직사광선 스펙트럼 색상 보간
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
            const litLight = mixRgb(ambientSky, cloudBeam, beamIntensity * 0.85);
            
            // 얇은 구름은 그림자도 밝은 산란광을 많이 받아 밝음
            // 두꺼운 구름은 매우 어두운 차콜 그늘 톤으로 수렴
            const darkShadowRGB = { r: 0.05, g: 0.06, b: 0.12 };
            const shadowLight = mixRgb(ambientSky, darkShadowRGB, preset.shadowContrast * 0.85);

            // 얇은 구름은 baseRGB의 흔적을 덜 남기고 산란된 빛(litLight)을 뽀얗게 머금음
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

            // 중간톤(Mid) 색상 계산
            const midRGB = interpolateColors(shadowRGB, litRGB, 0.45);

            // 하이라이트(Highlight) 색상 계산: 태양을 마주하는 림 에지용 밝은 광택
            const highlightIntensity = preset.thickness > 0.5 ? 1.0 : 0.7;
            const highlightRGB = interpolateColors(
              litRGB,
              { r: Math.round(cloudBeam.r * 255), g: Math.round(cloudBeam.g * 255), b: Math.round(cloudBeam.b * 255), a: 1 },
              highlightIntensity
            );

            // Mie phase 역광 하이라이트 추가 보정 (태양 부근일 때 림 발광 증폭)
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
                mieHighlight * 0.75
              );
            }

            // 두께에 따른 그라데이션 Stop 오프셋 계산
            const stopMid = `${Math.round(30 + preset.thickness * 45)}%`; // 30% ~ 75%
            const stopLit = `${Math.round(70 + preset.thickness * 20)}%`; // 70% ~ 90%

            const fillColor = colorToString(litRGB);
            const shadowColor = colorToString(shadowRGB);
            const midColor = colorToString(midRGB);
            const highlightColor = colorToString(rimHighlightRGB);

            const gradId = `gridGrad-${shape.id}`;
            const sunScreenY = SKY_HEIGHT - ((sunAltitude * DEGREE_TO_PIXEL) + HORIZON_Y);
            const dx = (VISUALIZER_WIDTH / 2) - cx;
            const dy = sunScreenY - cy;
            const angleRad = Math.atan2(dy, dx);
            const cosA = Math.cos(angleRad);
            const sinA = Math.sin(angleRad);
            const x1 = `${(0.5 - cosA * 0.5) * 100}%`;
            const y1 = `${(0.5 - sinA * 0.5) * 100}%`;
            const x2 = `${(0.5 + cosA * 0.5) * 100}%`;
            const y2 = `${(0.5 + sinA * 0.5) * 100}%`;
            const gTx = cx - (baseW * finalScale) / 2;
            const gTy = cy;
            const gScale = `scale(${finalScale}, ${finalScale * 0.6})`;
            return (
              <G key={shape.id} opacity={Math.max(0.1, preset.baseOpacity * (shape.density / 100))}>
                <Defs>
                  <LinearGradient id={gradId} x1={x1} y1={y1} x2={x2} y2={y2}>
                    <Stop offset="0%" stopColor={shadowColor} stopOpacity={1} />
                    <Stop offset={stopMid} stopColor={midColor} stopOpacity={1} />
                    <Stop offset={stopLit} stopColor={fillColor} stopOpacity={1} />
                    <Stop offset="100%" stopColor={highlightColor} stopOpacity={1} />
                  </LinearGradient>
                </Defs>
                {/* Cloud fill with gradient */}
                <Path
                  d={cloudPath}
                  fill={`url(#${gradId})`}
                  transform={`translate(${gTx}, ${gTy}) ${gScale}`}
                />
              </G>
            );
          })}

          {/* 5. Panoramic Terrain (Rendered ON TOP of all celestial objects to naturally occlude them!) */}
          {renderTerrain()}
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
    left: 8,
    top: 8,
    bottom: 48,   // 나침반 높이(32) + 여유(16)
    width: 32,
    zIndex: 120,
    alignItems: 'center',
  },
  fovTrackLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1.5,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  fovTickLine: {
    position: 'absolute',
    left: 10,
    height: 1,
    justifyContent: 'center',
  },
  fovTickText: {
    position: 'absolute',
    left: 8,
    fontSize: 7,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '700',
    width: 25,
  },
  fovPointer: {
    position: 'absolute',
    left: -4,
    width: 10,
    height: 10,
    marginTop: -5,
    borderWidth: 1.5,
    borderRadius: 5,
    backgroundColor: '#050510',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fovPointerDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  fovTooltip: {
    position: 'absolute',
    left: 14,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 0.5,
    width: 34,
    alignItems: 'center',
  },
  fovTooltipText: {
    fontSize: 7,
    fontWeight: '900',
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
