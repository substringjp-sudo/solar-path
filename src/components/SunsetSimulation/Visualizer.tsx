import React, { useMemo } from 'react';
import { StyleSheet, View, Text, useWindowDimensions, Platform, GestureResponderHandlers } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, RadialGradient, Rect, Circle, Polygon, Path, G } from 'react-native-svg';
import { Sun } from 'lucide-react-native';
import { SunsetPrediction, getApparentAltitude, getHorizonDip } from '../../utils/sunsetPhysics';
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

function generatePolygonalCloudPath(w: number, h: number, seed: number, type: 'high' | 'mid' | 'low'): string {
  const rand = (s: number) => {
    const x = Math.sin(s) * 10000;
    return x - Math.floor(x);
  };
  // 정점 수를 축소하여 렌더링 성능을 획기적으로 개선합니다.
  const steps = type === 'high' ? 4 : type === 'mid' ? 6 : 8;
  const points: { x: number; y: number }[] = [];
  const heightVar = type === 'high' ? 0.25 : type === 'mid' ? 0.45 : 0.65;
  
  // Left-to-right top edge
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = w * t;
    const noise = rand(seed + i * 7.3);
    const py = h * (0.15 + noise * heightVar * Math.sin(t * Math.PI));
    points.push({ x: px, y: py });
  }
  // Right-to-left bottom edge
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const px = w * t;
    const noise = rand(seed + i * 11.7 + 50);
    const py = h * (0.85 - noise * heightVar * 0.4 * Math.sin(t * Math.PI));
    points.push({ x: px, y: py });
  }
  let path = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;
  }
  path += ' Z';
  return path;
}

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

        const baseWidth = type === 'high' ? 120 : type === 'mid' ? 150 : 180;
        const baseHeight = type === 'high' ? 6 : type === 'mid' ? 14 : 24;
        
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

          // Generate master static cloud path to prevent precision issues and recalculation
          const pathStr = generatePolygonalCloudPath(baseWidth, baseHeight, seed, type);

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
            pathStr
          });
        }
      });
    });

    // Deep sort: further away (larger S) rendered first, so closer (smaller S) overlaps it!
    results.sort((a, b) => b.S - a.S);
    return results;
  }, [interpolatedWeather, sim, horizonDipDeg, prediction]);

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

      // Warm glow factor
      const sunGlowColorStr = prediction?.sunDiskColor ?? '#FFD700';
      const litRGB = parseColor(sunGlowColorStr);
      const shadowRGB = parseColor(item.baseColorStr);

      const sunAz = sim?.azimuth ?? 180;
      const sunAlt = sunAltitude;
      let azDiff = cloudAzimuthAbs - sunAz;
      azDiff = ((azDiff + 180) % 360) - 180;
      const altDiff = item.apparentElevationDeg - sunAlt;
      const angularDistanceToSun = Math.sqrt(azDiff * azDiff + altDiff * altDiff);

      const sunCloseness = Math.max(0, 1 - angularDistanceToSun / 35);
      
      const fireRGB = interpolateColors(litRGB, { r: 255, g: 110, b: 0, a: 1 }, 0.35); // fiery orange-red
      const finalLitRGB = interpolateColors(shadowRGB, fireRGB, sunCloseness * 0.95);
      const finalShadowRGB = interpolateColors(shadowRGB, litRGB, sunCloseness * 0.25);

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
        renderHeight
      };
    }).filter(Boolean);
  }, [allCloudLayersData, heading, visualFov, sunAltitude, currentTime, prediction, sim, VISUALIZER_WIDTH, SKY_HEIGHT, HORIZON_Y, DEGREE_TO_PIXEL]);

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
        <Polygon points={bgPoints} fill="url(#bgTerrainGrad)" />
        <Polygon points={fgPoints} fill="url(#fgTerrainGrad)" />
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

  return (
    <View style={[styles.visualizerContainer, { width: VISUALIZER_WIDTH }]}>
      <View 
        style={[styles.sky, { height: SKY_HEIGHT, backgroundColor: skyStops[0].color }]}
        {...panHandlers}
      >
        <Svg
          width={VISUALIZER_WIDTH}
          height={SKY_HEIGHT}
          style={StyleSheet.absoluteFillObject as any}
          pointerEvents="none"
        >
          <Defs>
            <LinearGradient id="physSky" x1="0" y1="0" x2="0" y2="1">
              {skyStops.map((s, i) => (
                <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={1} />
              ))}
            </LinearGradient>
            
            <LinearGradient id="bgTerrainGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#2c2c4e" stopOpacity="1" />
              <Stop offset="1" stopColor="#1a1a2e" stopOpacity="1" />
            </LinearGradient>

            <LinearGradient id="fgTerrainGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#1a1a2e" stopOpacity="1" />
              <Stop offset="1" stopColor="#050510" stopOpacity="1" />
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

            {prediction?.sunGlowStops && (
              <RadialGradient 
                id="sunGlow" 
                cx="50%" cy="50%" r="50%" 
                fx="50%" fy="50%"
              >
                {prediction.sunGlowStops.map((s: any, i: number) => {
                  const rgbaMatch = s.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                  const stopColor = rgbaMatch ? `rgb(${rgbaMatch[1]},${rgbaMatch[2]},${rgbaMatch[3]})` : s.color;
                  const stopOpacity = rgbaMatch && rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1;
                  
                  return (
                    <Stop 
                      key={i} 
                      offset={s.offset.toFixed(3)} 
                      stopColor={stopColor} 
                      stopOpacity={isNaN(stopOpacity) ? 0 : stopOpacity} 
                    />
                  );
                })}
              </RadialGradient>
            )}

            {/* Custom dynamic cloud gradients */}
            {computedClouds.map((cloud: any) => (
              <LinearGradient key={cloud.gradId} id={cloud.gradId} x1={cloud.x1} y1={cloud.y1} x2={cloud.x2} y2={cloud.y2}>
                <Stop offset="0%" stopColor={cloud.finalShadowColor} stopOpacity={1} />
                <Stop offset="100%" stopColor={cloud.finalLitColor} stopOpacity={1} />
              </LinearGradient>
            ))}
          </Defs>
          <Rect width={VISUALIZER_WIDTH} height={SKY_HEIGHT} fill="url(#physSky)" />
          
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
            const sunX = (VISUALIZER_WIDTH / 2).toFixed(2);
            const sunY = (SKY_HEIGHT - ((sunAltitude * DEGREE_TO_PIXEL) + HORIZON_Y)).toFixed(2);
            const haloScale = prediction?.factors?.dynamicHaloScale ?? 1.0;
            const haloSize = sunSize * (15 + Math.max(0, (8 - sunAltitude) * 2.5)) * haloScale; 
            const sunColor = prediction?.sunDiskColor ?? '#FFD700';

            return (
              <>
                {/* Mie Scattering Halo (3-Stage Volumetric Aura for Elite Realism) */}
                {prediction?.sunGlowStops && (
                  <>
                    {/* Stage 3: Wide Atmospheric Ambient Glow (Ultra-soft blend) */}
                    <Circle 
                      cx={sunX} 
                      cy={sunY} 
                      r={haloSize * 1.30} 
                      fill="url(#sunGlow)"
                      opacity={0.09}
                    />
                    {/* Stage 2: Mid-range Dynamic Scattering Halo (Medium smooth) */}
                    <Circle 
                      cx={sunX} 
                      cy={sunY} 
                      r={haloSize * 0.52} 
                      fill="url(#sunGlow)"
                      opacity={0.24}
                    />
                    {/* Stage 1: Ultra-intense Core Mie Scattering Corona (Tight glare) */}
                    <Circle 
                      cx={sunX} 
                      cy={sunY} 
                      r={haloSize * 0.18} 
                      fill="url(#sunGlow)"
                      opacity={0.65}
                    />
                  </>
                )}
                
                {/* Sun Disk (Rendered on top of the halo but behind terrain) */}
                <Circle
                  cx={sunX}
                  cy={sunY}
                  r={sunSize / 2}
                  fill={sunColor}
                />
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
                {/* Volumetric shadow path offset opposite to the sun */}
                <Path
                  d={cloud.pathStr}
                  fill="rgba(0,0,0,0.22)"
                  transform={`translate(${cloud.x - (cloud.baseWidth * cloud.finalScaleX) / 2 + cloud.shadowDx}, ${cloud.y + cloud.shadowDy}) scale(${cloud.finalScaleX}, ${cloud.finalScaleY})`}
                />
                {/* Main lit cloud path */}
                <Path
                  d={cloud.pathStr}
                  fill={`url(#${cloud.gradId})`}
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

            // Scale based on distance (perspective)
            const perspectiveScale = 45 / Math.max(10, shape.centerDist);
            const clampedScale = Math.max(0.06, Math.min(2.5, perspectiveScale));
            const scaleZoom = 20 / visualFov;
            const finalScale = clampedScale * scaleZoom;

            // Cloud size based on density and type
            const baseW = shape.type === 'high' ? 180 : shape.type === 'mid' ? 200 : 220;
            const baseH = shape.type === 'high' ? 10 : shape.type === 'mid' ? 18 : 28;
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

            const baseColor = shape.type === 'high'
              ? (prediction?.highCloudColor ?? 'rgba(255, 192, 203, 0.5)')
              : shape.type === 'mid'
              ? (prediction?.midCloudColor ?? 'rgba(180, 150, 220, 0.45)')
              : (prediction?.lowCloudColor ?? 'rgba(100, 149, 237, 0.4)');

            const baseRGB = parseColor(baseColor);
            const sunGlow = parseColor(prediction?.sunDiskColor ?? '#FFD700');
            const fireRGB = interpolateColors(sunGlow, { r: 255, g: 110, b: 0, a: 1 }, 0.35);
            const litRGB = interpolateColors(baseRGB, fireRGB, sunCloseness * 0.9);
            const fillColor = colorToString(litRGB);

            // Generate a cloud-like path for this grid shape
            const seed = shape.id.charCodeAt(5) * 100 + shape.centerDist;
            const cloudPath = generatePolygonalCloudPath(baseW, baseH, seed, shape.type);
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

            const shadowRGB = interpolateColors(baseRGB, sunGlow, sunCloseness * 0.2);

            return (
              <G key={shape.id} opacity={opacity}>
                <Defs>
                  <LinearGradient id={gradId} x1={x1} y1={y1} x2={x2} y2={y2}>
                    <Stop offset="0%" stopColor={colorToString(shadowRGB)} stopOpacity={1} />
                    <Stop offset="100%" stopColor={fillColor} stopOpacity={1} />
                  </LinearGradient>
                </Defs>
                <Path
                  d={cloudPath}
                  fill={`url(#${gradId})`}
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
