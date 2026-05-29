import React, { useMemo } from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import Svg, { 
  Defs, LinearGradient, Stop, Rect, Circle, 
  Path, Filter, FeGaussianBlur, FeColorMatrix,
  FeMerge, FeMergeNode, G, Mask, Ellipse,
  RadialGradient
} from 'react-native-svg';
import { ViewfinderHUD } from './ViewfinderHUD';
import { Theme, SimulationPath, CloudPoint, CloudGenus } from '../../types/simulation';
import { SunsetPrediction } from '../../utils/sunsetPhysics';
import { generateCloudPath, CLOUD_STYLES } from '../../utils/cloudShapes';

const { width: screenWidth } = Dimensions.get('window');

interface SimulationVisualizerProps {
  interpolatedColors: string[];
  visualFov: number;
  sunX: number;
  sunY: number;
  sunSize: number;
  sunGlowSize: number;
  interpolatedPath: SimulationPath[];
  sunAltitude: number;
  userRotation: number;
  gyroRotation: number;
  theme: Theme;
  containerHeight: number;
  prediction: SunsetPrediction | null;
  cloudDrift?: number;
}

export const SimulationVisualizer = React.memo<SimulationVisualizerProps>(({
  interpolatedColors,
  visualFov,
  sunX,
  sunY,
  sunSize,
  sunGlowSize,
  interpolatedPath,
  sunAltitude,
  userRotation,
  gyroRotation,
  theme,
  containerHeight,
  prediction,
  cloudDrift = 0
}) => {
  const isDay = sunAltitude > -5;
  const heatHazeIntensity = prediction?.factors?.aerosolBeta ? prediction.factors.aerosolBeta * 15 : 0;
  
  // Memoize stars for stability
  const stars = useMemo(() => {
    return Array.from({ length: 150 }).map((_, i) => ({
      cx: Math.random() * 1000,
      cy: Math.random() * 600,
      r: Math.random() * 1.5 + 0.5,
      opacity: Math.random() * 0.8 + 0.2
    }));
  }, []);

  // Memoize individualized, layered cloud particles sorted by depth
  const clouds = useMemo(() => {
    const list: any[] = [];
    
    interpolatedPath.forEach((pathData: SimulationPath) => {
      const dist = pathData.distance;
      
      // Map distance to visual perspective depth (0km observer is closest)
      let depth = 1.0;
      if (dist === 80) depth = 0.7;
      else if (dist === 200) depth = 0.45;
      else if (dist === 350) depth = 0.22;
      
      // Closer clouds appear higher up from horizon, far clouds are clamped near horizon
      const yBase = containerHeight * (0.62 + depth * 0.22);
      
      pathData.profile.forEach((p: CloudPoint, idx: number) => {
        if (p.genus === 'clear' || p.density <= 0.05) return;
        
        // Horizontal projection with wrapping
        const baseShift = (((p.azimuth || 0) - userRotation + 180 + cloudDrift) % 360) - 180;
        const cx = 500 + baseShift * (1000 / visualFov);
        
        // Vertical projection scaled by depth
        const hScale = p.height * (1.8 - depth * 0.7);
        const cy = yBase - hScale;
        
        // Optimization: Culling clouds completely out of screen bounds
        if (cx < -600 || cx > 1600 || cy < -150 || cy > containerHeight + 250) {
          return;
        }
        
        const style = CLOUD_STYLES[p.genus];
        if (!style) return;
        
        // Dimensions scaled by distance
        let baseW = 200;
        let baseH = 80;
        
        switch (p.genus) {
          case 'cirrus':
            baseW = 380; baseH = 30; break;
          case 'cirrostratus':
            baseW = 750; baseH = 70; break;
          case 'cumulonimbus':
            baseW = 320; baseH = 220; break;
          case 'altocumulus':
            baseW = 240; baseH = 55; break;
          case 'altostratus':
            baseW = 600; baseH = 50; break;
          case 'stratocumulus':
            baseW = 420; baseH = 80; break;
          case 'stratus':
            baseW = 850; baseH = 60; break;
          case 'cumulus':
            baseW = 180; baseH = 85; break;
        }
        
        const cloudW = baseW * depth;
        const cloudH = baseH * depth;
        
        // Reproducible seed based on coordinates and altitude
        const seed = Math.abs(Math.sin(dist * 13 + (p.azimuth || 0) * 23 + p.height * 11)) * 10000;
        
        let baseColor = '#555';
        let highlightColor = 'transparent';
        
        if (prediction) {
          // Resolve base weather-derived color
          if (dist <= 80) baseColor = prediction.lowCloudColor;
          else if (dist === 200) baseColor = prediction.midCloudColor;
          else baseColor = prediction.highCloudColor;
          
          // Modify saturation/brightness based on cloud genus
          if (style.fillColorOffset === 'pink') {
            baseColor = prediction.highCloudColor; // Highly receptive to high altitude twilight colors
          } else if (style.fillColorOffset === 'dark') {
            // Apply heavy shadows for dense rain/storm clouds
            baseColor = baseColor.replace(/rgba?\(([^,]+),([^,]+),([^,)]+)(?:,\s*([^)]+))?\)/, (match, r, g, b, a) => {
              const darkR = Math.max(8, Math.round(Number(r) * 0.45));
              const darkG = Math.max(8, Math.round(Number(g) * 0.45));
              const darkB = Math.max(14, Math.round(Number(b) * 0.6));
              const alpha = a !== undefined ? a : '1.0';
              return `rgba(${darkR},${darkG},${darkB},${alpha})`;
            });
          }
          
          // Silver lining (edge-scattering highlight) when near the sun
          const dx = cx - sunX;
          const dy = cy - sunY;
          const distToSun = Math.sqrt(dx * dx + dy * dy);
          
          const catchesLight = sunAltitude < 18 && sunAltitude > -6;
          if (catchesLight && distToSun < 380) {
            const proximity = 1.0 - (distToSun / 380);
            highlightColor = prediction.sunDiskColor;
            (p as any).scatterIntensity = proximity * Math.max(0, Math.min(1, (18 - sunAltitude) / 10));
          } else {
            (p as any).scatterIntensity = 0;
          }
        }
        
        // Add layers to compile 3D volumetric details
        for (let l = 0; l < style.layerCount; l++) {
          const pathD = generateCloudPath(p.genus, cloudW, cloudH, seed, l);
          
          // Slightly offset sub-paths to construct fluffiness
          const lx = cx - cloudW / 2 + (l - style.layerCount / 2) * (8 * depth);
          const ly = cy - cloudH / 2 + (l - style.layerCount / 2) * (4 * depth);
          
          list.push({
            id: `cloud-${dist}-${idx}-${l}`,
            pathD,
            x: lx,
            y: ly,
            fill: baseColor,
            highlightColor,
            opacity: style.baseOpacity * p.density * (0.8 + (l / style.layerCount) * 0.2) * (0.65 + depth * 0.35),
            blur: style.blur,
            scatterIntensity: (p as any).scatterIntensity || 0,
            depth,
            shadowOffset: style.shadowOffset * depth * (l + 1) / style.layerCount,
          });
        }
      });
    });
    
    // Painter's algorithm: sort by depth rendering further elements first
    return list.sort((a, b) => a.depth - b.depth);
  }, [interpolatedPath, containerHeight, sunAltitude, prediction, userRotation, cloudDrift, visualFov, sunX, sunY]);

  const bloomLayers = [
    { size: sunGlowSize * 0.4, opacity: 1.0, blur: 2 },
    { size: sunGlowSize * 0.9, opacity: 0.6, blur: 10 },
    { size: sunGlowSize * 2.0, opacity: 0.3, blur: 20 },
    { size: sunGlowSize * 4.0, opacity: 0.1, blur: 20 },
  ];

  return (
    <View style={[styles.visualizerContainer, { height: containerHeight }]}>
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            {prediction ? (
              prediction.skyGradient.map((stop, idx) => (
                <Stop key={idx} offset={`${stop.offset * 100}%`} stopColor={stop.color} />
              ))
            ) : [
                <Stop key="s0" offset="0%" stopColor={interpolatedColors[0]} />,
                <Stop key="s1" offset="30%" stopColor={interpolatedColors[1]} />,
                <Stop key="s2" offset="60%" stopColor={interpolatedColors[2]} />,
                <Stop key="s3" offset="85%" stopColor={interpolatedColors[2]} stopOpacity={0.8} />,
                <Stop key="s4" offset="100%" stopColor={interpolatedColors[3]} />
            ]}
          </LinearGradient>
          
          <Filter id="bloomSmall">
            <FeGaussianBlur stdDeviation="3" />
          </Filter>
          <Filter id="bloomMed">
            <FeGaussianBlur stdDeviation="8" />
          </Filter>
          <Filter id="bloomLarge">
            <FeGaussianBlur stdDeviation="18" />
          </Filter>



          <RadialGradient id="sunCoreGrad" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFF" stopOpacity="1" />
            <Stop offset="40%" stopColor="#FFF" stopOpacity="1" />
            <Stop offset="70%" stopColor={prediction ? prediction.sunDiskColor : "#FFD700"} stopOpacity="1" />
            <Stop offset="100%" stopColor={prediction ? prediction.sunDiskColor : "#FF8C00"} stopOpacity="0.8" />
          </RadialGradient>

          <LinearGradient id="horizonHazeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor={theme.bg} stopOpacity={0} />
            <Stop offset="40%" stopColor={theme.bg} stopOpacity={0.4 * Math.max(0, (15 - sunAltitude) / 30)} />
            <Stop offset="100%" stopColor={theme.bg} stopOpacity={0.9} />
          </LinearGradient>

          <RadialGradient id="rayGrad" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={prediction?.sunDiskColor || "#FFF"} stopOpacity={0.15} />
            <Stop offset="100%" stopColor={prediction?.sunDiskColor || "#FFF"} stopOpacity={0} />
          </RadialGradient>

          <RadialGradient id="skyAureoleGrad" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFF" stopOpacity={0.8 * Math.max(0, (sunAltitude + 4) / 19)} />
            <Stop offset="25%" stopColor={prediction ? prediction.sunDiskColor : "#FFD700"} stopOpacity={0.5 * Math.max(0, (sunAltitude + 4) / 19)} />
            <Stop offset="60%" stopColor={prediction ? prediction.sunDiskColor : "#FF8C00"} stopOpacity={0.2 * Math.max(0, (sunAltitude + 4) / 19)} />
            <Stop offset="100%" stopColor={prediction ? prediction.sunDiskColor : "#FF8C00"} stopOpacity="0" />
          </RadialGradient>

          <Filter id="rimGlow">
            <FeGaussianBlur stdDeviation="4" />
          </Filter>
        </Defs>

        {/* 1. Sky Gradient Background */}
        <Rect x="0" y="0" width="1000" height="1000" fill="url(#skyGrad)" />
        <Rect 
          x="0" y="500" width="1000" height="200" 
          fill="url(#skyGrad)" 
          opacity={0.4}
        />

        {/* 2. Stars */}
        {sunAltitude < -2 && (
          <G opacity={Math.max(0, Math.min(1, (-sunAltitude - 2) / 10))}>
            {stars.map((star, i) => (
              <Circle key={`star-${i}`} cx={star.cx} cy={star.cy} r={star.r} fill="#FFF" opacity={star.opacity} />
            ))}
          </G>
        )}

        {/* 3. Circumsolar Glow (Aureole) */}
        {sunAltitude > -4 && (
          <Circle 
            cx={sunX} 
            cy={sunY} 
            r={400 * (50 / visualFov)} 
            fill="url(#skyAureoleGrad)" 
            opacity={0.85}
          />
        )}

        {/* 4. Horizon Sky Blur Glow */}
        <Rect 
          x="0" 
          y="300" 
          width="1000" 
          height="700" 
          fill="url(#skyGrad)" 
          opacity={0.25}
          filter="url(#bloomLarge)"
        />

        {/* 5. Sun Rays */}
        {sunAltitude > -10 && sunAltitude < 15 && (
          <G opacity={Math.max(0.2, 1 - Math.abs(sunAltitude) / 30) * 0.4}>
            {[...Array(12)].map((_, i) => {
              const angle = (i * 30 * Math.PI) / 180;
              const x2 = sunX + Math.cos(angle) * 800;
              const y2 = sunY + Math.sin(angle) * 800;
              return (
                <Path 
                  key={`ray-${i}`}
                  d={`M${sunX},${sunY} L${x2},${y2}`}
                  stroke="url(#rayGrad)"
                  strokeWidth={40}
                  opacity={0.3}
                />
              );
            })}
          </G>
        )}

        {/* 6. Clouds (Rendered behind the sun/bloom so the sun shines through!) */}
        {clouds.map((cloud) => (
          <G key={cloud.id} transform={`translate(${cloud.x}, ${cloud.y})`}>
            {/* Edge scattering highlight (Silver lining) */}
            {cloud.highlightColor !== 'transparent' && cloud.scatterIntensity > 0.1 && (
              <Path 
                d={cloud.pathD} 
                fill="none"
                stroke={cloud.highlightColor}
                strokeWidth={3 * cloud.depth}
                opacity={0.6 * cloud.scatterIntensity * cloud.opacity}
                filter="url(#bloomSmall)"
                transform={`translate(0, -1)`}
              />
            )}
            {/* The main cloud body */}
            <Path 
              d={cloud.pathD} 
              fill={cloud.fill}
              opacity={cloud.opacity}
              filter={cloud.blur > 0 ? (cloud.blur <= 3 ? "url(#bloomSmall)" : cloud.blur <= 8 ? "url(#bloomMed)" : "url(#bloomLarge)") : undefined}
            />
            {/* Internal shadow effect to provide 3D volume */}
            {cloud.shadowOffset > 0 && (
              <Path 
                d={cloud.pathD} 
                fill="#000"
                opacity={0.12}
                transform={`translate(0, ${cloud.shadowOffset})`}
              />
            )}
          </G>
        ))}

        {/* 7. Volumetric Bloom (No mask, bleeds over cloud edges) */}
        <G>
          {bloomLayers.map((bloom, idx) => (
            <Circle 
              key={`bloom-${idx}`}
              cx={sunX} 
              cy={sunY} 
              r={bloom.size} 
              fill={prediction ? prediction.sunDiskColor : "#FFD700"} 
              opacity={bloom.opacity * 1.2 * Math.max(0.1, (sunAltitude + 5) / 20)}
              filter={idx === 0 ? "url(#bloomSmall)" : idx === 1 ? "url(#bloomMed)" : "url(#bloomLarge)"}
            />
          ))}
        </G>

        {/* 8. Lens Flare (Chromatic Aberration) */}
        {(() => {
          const flareOpacity = Math.max(0, (1 - Math.abs(sunAltitude) / 15)) * 0.6 * (prediction?.factors.pathClarity || 1);
          if (sunAltitude < -2 || flareOpacity < 0.05) return null;
          
          return (
            <G opacity={flareOpacity}>
              {[0.4, 0.6, 0.75, 1.1, 1.4, 1.8].map((dist, i) => {
                const fx = sunX + (500 - sunX) * dist;
                const fy = sunY + (500 - sunY) * dist;
                const fSize = (i === 1 ? 40 : i === 2 ? 15 : i === 4 ? 60 : 25) * (sunGlowSize / 120);
                const colors = ["#FFD700", "#FF6B6B", "#4D96FF", "#FFF", "#FFD700", "#FFF"];
                return (
                  <G key={`flare-group-${i}`}>
                    <Circle cx={fx - 1.5} cy={fy} r={fSize} fill="#FF0000" opacity={0.015} />
                    <Circle cx={fx + 1.5} cy={fy} r={fSize} fill="#0000FF" opacity={0.015} />
                    <Circle 
                      cx={fx} 
                      cy={fy} 
                      r={fSize} 
                      fill={colors[i]} 
                      opacity={0.06 - i * 0.008} 
                      filter="url(#bloomSmall)"
                    />
                  </G>
                );
              })}
            </G>
          );
        })()}

        {/* 9. Sun Disk (White core & refraction atmospheric distortion) */}
        {(() => {
          const refraction = Math.max(0, Math.min(1, (5 - sunAltitude) / 10));
          const rx = sunSize * (1 + 0.3 * refraction);
          const ry = sunSize * (1 - 0.2 * refraction);
          
          return (
            <G opacity={sunAltitude > -3 ? 1 : 0}>
              {/* Outer atmosphere glow */}
              <Ellipse 
                cx={sunX} 
                cy={sunY} 
                rx={rx * 3.5} 
                ry={ry * 3.0}
                fill={prediction ? prediction.sunDiskColor : "#FF8C00"} 
                opacity={0.25 * Math.max(0, (sunAltitude + 4) / 14)}
                filter="url(#bloomLarge)" 
              />
              <Ellipse cx={sunX} cy={sunY} rx={rx} ry={ry} fill="url(#sunCoreGrad)" />
              <Ellipse cx={sunX} cy={sunY} rx={rx * 0.55} ry={ry * 0.55} fill="#FFF" opacity={0.95} />
              <Ellipse 
                cx={sunX} 
                cy={sunY} 
                rx={rx * 2.5} 
                ry={ry * 2.0}
                fill={prediction ? prediction.sunDiskColor : "#FF8C00"} 
                opacity={0.4 * Math.max(0, (sunAltitude + 3) / 13)}
                filter="url(#bloomMed)" 
              />
            </G>
          );
        })()}

        {/* 10. Integrated Horizon Haze (Fixes sharp line) */}
        <Rect 
          x="0" 
          y={containerHeight * 0.6} 
          width="1000" 
          height={containerHeight * 0.4} 
          fill="url(#horizonHazeGrad)" 
        />
      </Svg>

      <ViewfinderHUD 
        heading={(userRotation + gyroRotation + 360) % 360}
        sunAltitude={sunAltitude}
        fov={visualFov}
        theme={theme}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  visualizerContainer: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#000',
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
});
