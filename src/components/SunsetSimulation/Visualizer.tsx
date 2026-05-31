import React, { useMemo } from 'react';
import { StyleSheet, View, Text, useWindowDimensions, Platform, GestureResponderHandlers } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, RadialGradient, Rect, Circle, Polygon, Path, G, Filter, FeGaussianBlur, FeOffset, FeComponentTransfer, FeFuncA, FeMerge, FeMergeNode, Ellipse } from 'react-native-svg';
import { Sun } from 'lucide-react-native';
import { SunsetPrediction, getApparentAltitude, getHorizonDip, directBeamRGB, computeSkyGrid, rgbToCss, clamp01 } from '../../utils/sunsetPhysics';
import { useCelestialStore } from '../../store/useCelestialStore';
import { getLocalTimeAtLocation, formatLocalTime } from '../../utils/timezone';
import { GridCloudShape } from '../../utils/cloudGridRenderer';

interface VisualizerProps {
  prediction: SunsetPrediction | null;
  sim: any;
  interpolatedWeather: any[];
  heading: number;
  visualFov: number;
  currentTime: Date;
  sunAltitude: number;
  isSunVisible: boolean;
  eventAzimuths: { sunrise: number; sunset: number };
  theme: any;
  panHandlers: GestureResponderHandlers;
  gridCloudShapes?: GridCloudShape[];
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

function colorToString(rgb: RGB): string {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${rgb.a})`;
}

// Collage / Papercraft cloud SVG templates categorized by distance
const CLOUD_TEMPLATES = {
  // Far clouds (d > 200 km): thin horizontal wisps/cirrus
  far: [
    "M 0,20 C 15,17 30,12 50,12 C 70,12 85,17 100,20 C 85,23 70,25 50,25 C 30,25 15,23 0,20 Z",
    "M 0,15 C 20,13 40,8 60,8 C 80,8 100,13 120,15 C 100,18 80,20 60,20 C 40,20 20,18 0,15 Z",
    "M 0,25 C 25,21 50,15 75,15 C 100,15 125,21 150,25 C 125,29 100,31 75,31 C 50,31 25,29 0,25 Z"
  ],
  // Mid clouds (80 < d <= 200 km): wave/layer clusters
  mid: [
    "M 10,20 C 10,14 20,10 35,10 C 45,5 65,5 75,12 C 85,8 100,8 110,14 C 120,10 135,12 140,20 C 140,23 10,23 10,20 Z",
    "M 5,18 C 5,12 15,8 28,8 C 36,4 52,4 62,10 C 70,6 85,6 93,12 C 101,8 115,10 120,18 C 120,21 5,21 5,18 Z",
    "M 15,22 C 15,16 25,12 40,12 C 50,7 72,7 82,14 C 92,10 110,10 120,16 C 130,12 145,14 150,22 C 150,25 15,25 15,22 Z"
  ],
  // Near clouds (d <= 80 km): fluffy volumetric paper cumulus
  near: [
    "M 15,35 C 15,25 25,18 40,18 C 50,10 70,8 85,12 C 100,5 125,5 140,15 C 150,12 165,15 170,25 C 180,25 185,30 185,35 C 185,38 15,38 15,35 Z",
    "M 10,28 C 10,20 18,14 30,14 C 38,8 54,6 66,10 C 78,4 98,4 110,12 C 118,9 130,12 134,20 C 142,20 146,24 146,28 C 146,30 10,30 10,28 Z",
    "M 20,40 C 20,28 32,20 50,20 C 60,10 82,8 100,12 C 118,4 146,4 163,16 C 175,12 192,16 198,28 C 210,28 215,34 215,40 C 215,43 20,43 20,40 Z"
  ]
};

export const Visualizer: React.FC<VisualizerProps> = ({
  prediction,
  sim,
  interpolatedWeather,
  heading,
  visualFov,
  currentTime,
  sunAltitude,
  isSunVisible,
  eventAzimuths,
  theme,
  panHandlers,
  gridCloudShapes,
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
        const H_c = type === 'high' ? 9.5 : type === 'mid' ? 4.5 : 1.5; 

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
          const apparentElevationDeg = getApparentAltitude(elevationDeg);

          // Skip if below horizon dip
          if (apparentElevationDeg < -horizonDipDeg - 0.2) continue;

          // Resolve papercraft template based on distance categories
          let cloudCategory: 'near' | 'mid' | 'far' = 'mid';
          if (d <= 80) cloudCategory = 'near';
          else if (d > 200) cloudCategory = 'far';

          const templates = CLOUD_TEMPLATES[cloudCategory];
          const templateIndex = seed % templates.length;
          const pathStr = templates[templateIndex];

          // Set dimensions optimal for template aspect ratios
          const baseWidth = cloudCategory === 'far' ? 150 : cloudCategory === 'mid' ? 140 : 200;
          const baseHeight = cloudCategory === 'far' ? 25 : cloudCategory === 'mid' ? 25 : 45;

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
            cloudCategory
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
      const clampedScale = Math.max(0.04, Math.min(3.0, perspectiveScale));
      const foreshorteningFactor = 0.15 + (clampedScale / 3.0) * 0.85; 

      const finalScaleX = clampedScale * scaleZoom;
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

      // Compute vector from cloud center to sun
      const dx = sunX - x;
      const dy = sunY - (y + renderHeight / 2);
      const angleRad = Math.atan2(dy, dx);
      
      const cosA = Math.cos(angleRad);
      const sinA = Math.sin(angleRad);
      
      // Vector coordinates relative to bounding box
      const x1 = (0.5 - cosA * 0.5) * 100 + '%';
      const y1 = (0.5 - sinA * 0.5) * 100 + '%';
      const x2 = (0.5 + cosA * 0.5) * 100 + '%';
      const y2 = (0.5 + sinA * 0.5) * 100 + '%';

      // 카툰 스타일: 구름이 물드는지 여부를 날씨 상태와 해 고도로 명확히 정의
      const alt = sunAltitude;
      const { overcast, dustIntensity } = weatherFactors;
      // 노을이 나타날 수 있는 조건 (해 고도 -8 ~ +10도, 맑은 대기)
      const isGoldenHour = alt >= -8 && alt <= 10;
      const sunsetQuality = Math.max(0, 1.0 - (overcast * 1.3 + dustIntensity * 0.9)); // 0이면 노을빛이 완전히 가려짐

      const sunAz = sim?.azimuth ?? 180;
      const sunAlt = sunAltitude;
      let azDiff = cloudAzimuthAbs - sunAz;
      azDiff = ((azDiff + 180) % 360) - 180;
      const altDiff = item.apparentElevationDeg - sunAlt;
      const angularDistanceToSun = Math.sqrt(azDiff * azDiff + altDiff * altDiff);
      const sunCloseness = Math.max(0, 1 - angularDistanceToSun / 32);

      // 구름 기본 색 (날씨에 따라 칙칙함 반영)
      let baseCloudRGB = parseColor(item.baseColorStr);
      if (overcast > 0.5) {
        baseCloudRGB = interpolateColors(baseCloudRGB, { r: 90, g: 95, b: 105, a: 1 }, overcast * 0.8);
      }
      if (dustIntensity > 0.5) {
        baseCloudRGB = interpolateColors(baseCloudRGB, { r: 120, g: 105, b: 90, a: 1 }, dustIntensity * 0.7);
      }

      let finalLitRGB: RGB;
      let finalShadowRGB: RGB;

      if (isGoldenHour && sunsetQuality > 0.15 && sunCloseness > 0.1) {
        // 카툰 스타일 물듦 효과: 경계가 확실하고 강렬한 형광 오렌지/황금빛
        const burnFactor = sunCloseness * sunsetQuality;
        const sunsetGlowRGB = interpolateColors(
          { r: 255, g: 80, b: 0, a: 1 },
          { r: 255, g: 215, b: 0, a: 1 },
          Math.min(1, burnFactor * 1.5)
        );
        
        finalLitRGB = interpolateColors(baseCloudRGB, sunsetGlowRGB, Math.min(1, burnFactor * 1.3));
        finalShadowRGB = interpolateColors(baseCloudRGB, { r: 130, g: 40, b: 90, a: 1 }, Math.min(0.85, burnFactor * 0.95)); // 보라빛 그림자
      } else {
        // 노을이 안 보이거나 태양과 먼 경우 -> 뚜렷한 노을 변화 없음
        finalLitRGB = baseCloudRGB;
        finalShadowRGB = interpolateColors(baseCloudRGB, { r: 40, g: 50, b: 70, a: 1 }, 0.35);
      }

      // Shadow offset (opposite to the sun vector)
      const shadowDist = Math.min(6, 2 + renderHeight * 0.15);
      const shadowDx = -cosA * shadowDist;
      const shadowDy = -sinA * shadowDist;

      // Haze attenuation
      const aerosolScaleHeight = 260; 
      const aerosolExtinction = Math.exp(-item.S / aerosolScaleHeight);
      const baseOpacity = 0.12 + (item.opacityDensity / 120);
      const cloudOpacity = Math.max(0.12, Math.min(0.85, baseOpacity * aerosolExtinction)); 

      const gradId = `cloudGrad-${item.id}`;

      return {
        ...item,
        x,
        y,
        gradId,
        x1, y1, x2, y2,
        finalLitColor: colorToString(finalLitRGB),
        finalShadowColor: colorToString(finalShadowRGB),
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

    return computeSkyGrid(
      sunAltitude,
      sunAzDeg,
      heading,
      visualFov,
      beta,
      pathClarity,
    );
  }, [sunAltitude, heading, visualFov, prediction, sim]);

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

  // Interpolate terrain and ocean colors based on sun altitude & weather factors (Cartoon Collage Style)
  const terrainColors = useMemo(() => {
    const alt = sunAltitude;
    const { overcast, dustIntensity } = weatherFactors;
    
    // Smooth transition for day/night: -6 degrees to +8 degrees
    const t = Math.max(0, Math.min(1, (alt + 6) / 14));
    
    // 노을 강도: 맑을 때 극대화, 흐리거나 먼지가 심하면 0에 수렴
    const sunsetGlowFactor = Math.max(0, 1.0 - (overcast * 1.3 + dustIntensity * 0.9)) * (1.0 - Math.pow(Math.abs(t - 0.4) / 0.4, 2));
    const clampedGlow = Math.max(0, Math.min(1, sunsetGlowFactor));

    // 1) 맑은 날의 기본 대낮/황혼/밤 색상
    // 낮의 선명한 바다 (카툰풍 스카이블루)
    const daySeaStart = parseColor('#29b6f6');
    const daySeaMid = parseColor('#0288d1');
    const daySeaEnd = parseColor('#01579b');

    // 밤/황혼의 깊은 어두운 바다
    const nightSeaStart = parseColor('#1a0f30');
    const nightSeaMid = parseColor('#0c051a');
    const nightSeaEnd = parseColor('#040108');

    // 맑은 날 골든아워의 타오르는 노을 바다
    const goldenSeaStart = parseColor('#ff5500');
    const goldenSeaMid = parseColor('#d00d56');
    const goldenSeaEnd = parseColor('#180230');

    // 보간 적용
    // 기본적으로 낮/밤 상태 보간 후, 노을 타임에는 노을 바다 색상을 강렬하게 끼얹는다.
    let seaStartRGB = interpolateColors(nightSeaStart, daySeaStart, t);
    let seaMidRGB = interpolateColors(nightSeaMid, daySeaMid, t);
    let seaEndRGB = interpolateColors(nightSeaEnd, daySeaEnd, t);

    seaStartRGB = interpolateColors(seaStartRGB, goldenSeaStart, clampedGlow);
    seaMidRGB = interpolateColors(seaMidRGB, goldenSeaMid, clampedGlow);
    seaEndRGB = interpolateColors(seaEndRGB, goldenSeaEnd, clampedGlow);

    // 지형 색상 (맑을 때의 선명한 카툰톤)
    // 낮: 짙은 슬레이트 블루/네이비
    const dayFgStart = parseColor('#1e293b');
    const dayFgEnd = parseColor('#0f172a');
    const dayBgStart = parseColor('#334155');
    const dayBgEnd = parseColor('#1e293b');

    // 밤/황혼: 다크 퍼플
    const nightFgStart = parseColor('#120a21');
    const nightFgEnd = parseColor('#07020f');
    const nightBgStart = parseColor('#24153b');
    const nightBgEnd = parseColor('#0f071f');

    let fgStartRGB = interpolateColors(nightFgStart, dayFgStart, t);
    let fgEndRGB = interpolateColors(nightFgEnd, dayFgEnd, t);
    let bgStartRGB = interpolateColors(nightBgStart, dayBgStart, t);
    let bgEndRGB = interpolateColors(nightBgEnd, dayBgEnd, t);

    // 노을 타임 지형은 아래쪽에 붉은 잔광이 살짝 비치는 느낌
    if (clampedGlow > 0.05) {
      fgStartRGB = interpolateColors(fgStartRGB, parseColor('#3d112d'), clampedGlow * 0.4);
      bgStartRGB = interpolateColors(bgStartRGB, parseColor('#4c123a'), clampedGlow * 0.5);
    }

    // 2) 날씨가 안 좋을 때의 카툰 피드백 (완벽한 회조색/진흙 갈색 탈색)
    // 흐리면 무채색 회색, 미세먼지는 칙칙한 진흙 갈색
    const badWeatherSeverity = Math.max(overcast, dustIntensity);
    if (badWeatherSeverity > 0.1) {
      const grayTone = overcast > dustIntensity 
        ? { start: parseColor('#303540'), mid: parseColor('#20242b'), end: parseColor('#12151a') } // 흐림: 회색조
        : { start: parseColor('#4a3c31'), mid: parseColor('#332820'), end: parseColor('#1f1712') }; // 미세먼지: 황갈색조

      seaStartRGB = interpolateColors(seaStartRGB, grayTone.start, badWeatherSeverity * 0.85);
      seaMidRGB = interpolateColors(seaMidRGB, grayTone.mid, badWeatherSeverity * 0.85);
      seaEndRGB = interpolateColors(seaEndRGB, grayTone.end, badWeatherSeverity * 0.85);

      fgStartRGB = interpolateColors(fgStartRGB, grayTone.start, badWeatherSeverity * 0.9);
      fgEndRGB = interpolateColors(fgEndRGB, grayTone.end, badWeatherSeverity * 0.9);
      bgStartRGB = interpolateColors(bgStartRGB, grayTone.mid, badWeatherSeverity * 0.95);
      bgEndRGB = interpolateColors(bgEndRGB, grayTone.end, badWeatherSeverity * 0.95);
    }

    return {
      bgStart: colorToString(bgStartRGB),
      bgEnd: colorToString(bgEndRGB),
      fgStart: colorToString(fgStartRGB),
      fgEnd: colorToString(fgEndRGB),
      seaStart: colorToString(seaStartRGB),
      seaMid: colorToString(seaMidRGB),
      seaEnd: colorToString(seaEndRGB),
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
      // Find average density for this type from weather stations
      const densities = interpolatedWeather.map((w: any) => type === 'high' ? w.high : type === 'mid' ? w.mid : w.low);
      const avgDensity = densities.reduce((a: number, b: number) => a + b, 0) / densities.length;
      if (avgDensity < 15) return null;

      const baseColorStr =
        type === 'high'
          ? (prediction.highCloudColor)
          : type === 'mid'
          ? (prediction.midCloudColor)
          : (prediction.lowCloudColor);

      // Define altitude range boundaries for giant sheets
      const minElev = type === 'high' ? 18 : type === 'mid' ? 6 : 0;
      const maxElev = type === 'high' ? 55 : type === 'mid' ? 22 : 9;

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
    // 산맥 높이 스케일을 완화하여 수평선 부근에 완만하고 자연스럽게 걸치도록 조정합니다.
    const targetPeakHeight = SKY_HEIGHT * 0.08; 
    
    const REF_DEGREE_TO_PIXEL = VISUALIZER_WIDTH / 20;
    const baseScale = targetPeakHeight / (Math.max(1, avgAngle) * REF_DEGREE_TO_PIXEL);
    const dynamicScale = Math.min(4.0, Math.max(0.6, baseScale));
    
    const horizonLineY = SKY_HEIGHT - HORIZON_Y;

    const getPoints = (angles: number[], verticalScale: number, yOffset: number) => {
      const pointsList: string[] = [];
      const getAngle = (azDeg: number) => {
        if (angles.length < 2) return 0;
        const normalizedAz = ((azDeg % 360) + 360) % 360;
        const index = (normalizedAz / 360) * (angles.length - 1);
        const i1 = Math.floor(index);
        const i2 = (i1 + 1) % angles.length;
        const ratio = index - i1;
        const a1 = angles[i1] || 0;
        const a2 = angles[i2] || 0;
        return a1 * (1 - ratio) + a2 * ratio;
      };

      for (let i = 0; i <= pointsCount; i++) {
        const relativeDeg = - (totalRenderFov / 2) + (i * totalRenderFov / pointsCount);
        const absDeg = heading + relativeDeg;
        const angle = getAngle(absDeg);
        const x = (relativeDeg / visualFov) * VISUALIZER_WIDTH + VISUALIZER_WIDTH / 2;
        const y = horizonLineY - (angle * verticalScale * DEGREE_TO_PIXEL) + yOffset;
        
        pointsList.push(`${x.toFixed(2)},${y.toFixed(2)}`);
      }
      
      const lastX = VISUALIZER_WIDTH.toFixed(2);
      const groundY = SKY_HEIGHT.toFixed(2);
      return pointsList.join(' ') + ` ${lastX},${groundY} 0,${groundY}`;
    };

    const bgPoints = getPoints(sim.terrain.farAngles || [], dynamicScale * 1.5, 0); 
    const fgPoints = getPoints(sim.terrain.panoramicAngles || [], dynamicScale, 4); 

    return (
      <G>
        {/* Sea Layer Shadow (Collage) */}
        <Rect
          x={0}
          y={horizonLineY + 3.0}
          width={VISUALIZER_WIDTH}
          height={SKY_HEIGHT - horizonLineY}
          fill="rgba(0,0,0,0.16)"
        />
        {/* Sea Layer */}
        <Rect
          x={0}
          y={horizonLineY}
          width={VISUALIZER_WIDTH}
          height={SKY_HEIGHT - horizonLineY}
          fill="url(#bgSeaGrad)"
          stroke={borderStyle.strokeColor}
          strokeWidth={borderStyle.strokeWidth}
        />
        
        {/* Fine Dust Haze Layer behind terrain but above sea */}
        {weatherFactors.dustIntensity > 0.08 && (
          <Rect
            x={0}
            y={horizonLineY - 20}
            width={VISUALIZER_WIDTH}
            height={40}
            fill="url(#hazeGrad)"
            opacity={weatherFactors.dustIntensity * 0.8}
          />
        )}
        
        {/* Far Mountain Terrain Shadow (Collage) */}
        <Polygon
          points={bgPoints}
          fill="rgba(0,0,0,0.16)"
          transform="translate(1.0, 3.5)"
        />
        {/* Far Mountain Terrain */}
        <Polygon
          points={bgPoints}
          fill="url(#bgTerrainGrad)"
          stroke={borderStyle.strokeColor}
          strokeWidth={borderStyle.strokeWidth}
        />
        
        {/* Foreground Mountain Terrain Shadow (Collage) */}
        <Polygon
          points={fgPoints}
          fill="rgba(0,0,0,0.22)"
          transform="translate(1.5, 4.0)"
        />
        {/* Foreground Mountain Terrain */}
        <Polygon
          points={fgPoints}
          fill="url(#fgTerrainGrad)"
          stroke={borderStyle.strokeColor}
          strokeWidth={borderStyle.strokeWidth * 1.25}
        />
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
      <View style={[styles.overlayCompass, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
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
        
        <View style={[styles.overlayCenterIndicator, { borderTopColor: theme.accent }]} />
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

  const renderOverlayFovScale = () => {
    const fovPct = ((visualFov - 10) / 20) * 100;
    const fovTicks = [10, 15, 20, 25, 30];
    
    return (
      <View style={styles.overlayFovContainer}>
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
          </Defs>
          <Rect x={0} y={horizonTop} width={VISUALIZER_WIDTH} height={SKY_HEIGHT - horizonTop}
            fill="url(#belowHorizonGrad)" />
        </Svg>

        <Svg
          width={VISUALIZER_WIDTH}
          height={SKY_HEIGHT}
          style={StyleSheet.absoluteFillObject as any}
          pointerEvents="none"
        >
          <Defs>
            {/* Sea linear gradient reflecting dynamic twilight to daytime transitions */}
            <LinearGradient id="bgSeaGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={terrainColors.seaStart} stopOpacity={0.8} />
              <Stop offset="40%" stopColor={terrainColors.seaMid} stopOpacity="0.95" />
              <Stop offset="100%" stopColor={terrainColors.seaEnd} stopOpacity="1" />
            </LinearGradient>

            <LinearGradient id="bgTerrainGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={terrainColors.bgStart} stopOpacity={1} />
              <Stop offset="1" stopColor={terrainColors.bgEnd} stopOpacity={1} />
            </LinearGradient>

            <LinearGradient id="fgTerrainGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={terrainColors.fgStart} stopOpacity={1} />
              <Stop offset="1" stopColor={terrainColors.fgEnd} stopOpacity={1} />
            </LinearGradient>

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
                <Stop offset="100%" stopColor={cloud.finalLitColor} stopOpacity={1} />
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

          {/* 2. Sun Glow & Disk (Rendered behind clouds and terrain) */}
          {(() => {
            const sunX = Number((VISUALIZER_WIDTH / 2).toFixed(2));
            const sunY = Number((SKY_HEIGHT - ((sunAltitude * DEGREE_TO_PIXEL) + HORIZON_Y)).toFixed(2));
            const glowVisibility = prediction?.factors?.pathClarity ?? 1.0;
            const sunColor = prediction?.sunDiskColor ?? '#FFD700';

            // Extract pure color RGB values from rgba string to avoid transparent border
            const parsedSun = parseColor(sunColor);
            const pureSunDiskColor = `rgb(${parsedSun.r}, ${parsedSun.g}, ${parsedSun.b})`;
            const sunOpacity = parsedSun.a;

            return (
              <>
                {/* Sun Disk - color from prediction (deep red near horizon, white-yellow when high) */}
                <G opacity={sunOpacity}>
                  {/* Paper Sun Disk Shadow */}
                  <Circle
                    cx={sunX + 1.5}
                    cy={sunY + 3.5}
                    r={sunSize / 2}
                    fill="rgba(0, 0, 0, 0.22)"
                  />
                  {/* Main Sun Disk */}
                  <Circle
                    cx={sunX}
                    cy={sunY}
                    r={sunSize / 2}
                    fill={pureSunDiskColor}
                    stroke={borderStyle.strokeColor}
                    strokeWidth={borderStyle.strokeWidth * 1.5}
                  />
                </G>
              </>
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

          {/* 4. 3D Depth-sorted Clouds (Rendered behind terrain) */}
          {computedClouds.map((cloud: any) => {
            if (!cloud) return null;
            return (
              <G key={cloud.id} opacity={cloud.cloudOpacity}>
                {/* Paper Cloud Shadow */}
                <Path
                  d={cloud.pathStr}
                  fill="rgba(0,0,0,0.16)"
                  transform={`translate(${cloud.x - (cloud.baseWidth * cloud.finalScaleX) / 2 + 1.5}, ${cloud.y + 3.5}) scale(${cloud.finalScaleX}, ${cloud.finalScaleY})`}
                />
                {/* Main lit cloud path with Paper border */}
                <Path
                  d={cloud.pathStr}
                  fill={`url(#${cloud.gradId})`}
                  stroke={borderStyle.strokeColor}
                  strokeWidth={borderStyle.strokeWidth * 0.8}
                  transform={`translate(${cloud.x - (cloud.baseWidth * cloud.finalScaleX) / 2}, ${cloud.y}) scale(${cloud.finalScaleX}, ${cloud.finalScaleY})`}
                />
              </G>
            );
          })}

          {/* 4.5. Enhanced Grid Clouds (rendered between computed clouds and terrain) */}
          {gridCloudShapes && gridCloudShapes.length > 0 && gridCloudShapes.map((shape) => {
            const horizonTop = SKY_HEIGHT - HORIZON_Y;

            // Compute wind drift coordinate here (synchronized with computedClouds)
            const timeMs = currentTime.getTime();
            const windSpeedKmh = 25; 
            const windDriftKm = (timeMs / 3600000) * windSpeedKmh;
            const totalDx = (windDriftKm % 160 - 80);
            const windAzOffset = Math.atan2(totalDx, shape.centerDist) * (180 / Math.PI);

            // Map polar grid coordinates to screen space with wind drift
            const relAzDeg = shape.centerAzOffset + windAzOffset;
            const relAz = ((relAzDeg + 180) % 360) - 180;
            const fovRad = (visualFov * Math.PI) / 180;
            const halfFovRad = fovRad / 2;
            const xOffsetRatio = Math.tan((relAz * Math.PI) / 180) / Math.tan(halfFovRad);
            const cx = (VISUALIZER_WIDTH / 2) + (xOffsetRatio * (VISUALIZER_WIDTH / 2));

            // Vertical position from apparent elevation
            const cy = horizonTop - (shape.apparentElevation * DEGREE_TO_PIXEL);

            // Resolve papercraft template based on distance categories
            let cloudCategory: 'near' | 'mid' | 'far' = 'mid';
            if (shape.centerDist <= 80) cloudCategory = 'near';
            else if (shape.centerDist > 200) cloudCategory = 'far';

            const seed = shape.id.charCodeAt(5) * 100 + shape.centerDist;
            const templates = CLOUD_TEMPLATES[cloudCategory];
            const templateIndex = seed % templates.length;
            const cloudPath = templates[templateIndex];

            // Set dimensions optimal for template aspect ratios
            const baseW = cloudCategory === 'far' ? 150 : cloudCategory === 'mid' ? 140 : 200;
            const baseH = cloudCategory === 'far' ? 25 : cloudCategory === 'mid' ? 25 : 45;

            // Scale based on distance (perspective)
            const perspectiveScale = 45 / Math.max(10, shape.centerDist);
            const clampedScale = Math.max(0.06, Math.min(2.5, perspectiveScale));
            const scaleZoom = 20 / visualFov;
            const finalScale = clampedScale * scaleZoom;

            const renderW = baseW * finalScale;
            const renderH = baseH * finalScale * 0.6;

            // Skip if off-screen
            if (cx + renderW < -60 || cx - renderW > VISUALIZER_WIDTH + 60) return null;
            if (cy + renderH < -30 || cy > SKY_HEIGHT + 30) return null;

            // Opacity from density
            const opacity = Math.max(0.15, Math.min(0.75, shape.density / 100));

            // Sun proximity coloring (reuse prediction colors, using wind-drifted position)
            const sunAz = sim?.azimuth ?? 180;
            const cloudAzimuthAbs = (sim?.azimuth ?? 180) + shape.centerAzOffset + windAzOffset;
            let azDiff = cloudAzimuthAbs - sunAz;
            azDiff = ((azDiff + 180) % 360) - 180;
            const altDiff = shape.apparentElevation - sunAltitude;
            const angularDist = Math.sqrt(azDiff * azDiff + altDiff * altDiff);
            const sunCloseness = Math.max(0, 1 - angularDist / 30);

            // 카툰 물듦 법칙 반영
            const alt = sunAltitude;
            const { overcast, dustIntensity } = weatherFactors;
            const isGoldenHour = alt >= -8 && alt <= 10;
            const sunsetQuality = Math.max(0, 1.0 - (overcast * 1.3 + dustIntensity * 0.9));

            let baseRGB = parseColor(
              shape.type === 'high'
                ? (prediction?.highCloudColor ?? 'rgba(255, 192, 203, 0.5)')
                : shape.type === 'mid'
                ? (prediction?.midCloudColor ?? 'rgba(180, 150, 220, 0.45)')
                : (prediction?.lowCloudColor ?? 'rgba(100, 149, 237, 0.4)')
            );

            // 날씨 보간
            if (overcast > 0.5) {
              baseRGB = interpolateColors(baseRGB, { r: 90, g: 95, b: 105, a: 1 }, overcast * 0.8);
            }
            if (dustIntensity > 0.5) {
              baseRGB = interpolateColors(baseRGB, { r: 120, g: 105, b: 90, a: 1 }, dustIntensity * 0.7);
            }

            let litRGB: RGB;
            let shadowRGB: RGB;

            if (isGoldenHour && sunsetQuality > 0.15 && sunCloseness > 0.1) {
              const burnFactor = sunCloseness * sunsetQuality;
              const sunsetGlowRGB = interpolateColors(
                { r: 255, g: 80, b: 0, a: 1 },
                { r: 255, g: 215, b: 0, a: 1 },
                Math.min(1, burnFactor * 1.5)
              );
              litRGB = interpolateColors(baseRGB, sunsetGlowRGB, Math.min(1, burnFactor * 1.3));
              shadowRGB = interpolateColors(baseRGB, { r: 130, g: 40, b: 90, a: 1 }, Math.min(0.85, burnFactor * 0.95));
            } else {
              litRGB = baseRGB;
              shadowRGB = interpolateColors(baseRGB, { r: 40, g: 50, b: 70, a: 1 }, 0.35);
            }

            const fillColor = colorToString(litRGB);

            const gradId = `gridGrad-${shape.id}`;

            // Sun direction for gradient
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

            return (
              <G key={shape.id} opacity={opacity}>
                <Defs>
                  <LinearGradient id={gradId} x1={x1} y1={y1} x2={x2} y2={y2}>
                    <Stop offset="0%" stopColor={colorToString(shadowRGB)} stopOpacity={1} />
                    <Stop offset="100%" stopColor={fillColor} stopOpacity={1} />
                  </LinearGradient>
                </Defs>
                {/* Paper Grid Cloud Shadow */}
                <Path
                  d={cloudPath}
                  fill="rgba(0,0,0,0.16)"
                  transform={`translate(${cx - (baseW * finalScale) / 2 + 1.5}, ${cy + 3.5}) scale(${finalScale}, ${finalScale * 0.6})`}
                />
                {/* Main Cloud Path */}
                <Path
                  d={cloudPath}
                  fill={`url(#${gradId})`}
                  stroke={borderStyle.strokeColor}
                  strokeWidth={borderStyle.strokeWidth * 0.8}
                  transform={`translate(${cx - (baseW * finalScale) / 2}, ${cy}) scale(${finalScale}, ${finalScale * 0.6})`}
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
    top: 0,
    left: 0,
    right: 0,
    height: 32,
    zIndex: 120,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'flex-end',
    paddingBottom: 4,
  },
  overlayTick: {
    position: 'absolute',
    bottom: 0,
    width: 1,
  },
  overlayTickLabel: {
    position: 'absolute',
    fontWeight: 'bold',
    width: 30,
    textAlign: 'center',
    marginLeft: -15,
    bottom: 8,
  },
  overlayCenterIndicator: {
    position: 'absolute',
    top: 0,
    left: '50%',
    marginLeft: -5,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  overlaySunMarker: {
    position: 'absolute',
    top: 1,
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
    top: 40,
    bottom: 20,
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
