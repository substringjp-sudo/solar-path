import React, { useRef } from 'react';
import { View, Dimensions, StyleSheet, PanResponder } from 'react-native';
import Svg, { Circle, Path, G, Line, Text as SvgText, Defs, RadialGradient, Stop, LinearGradient, Rect } from 'react-native-svg';
import { Moon } from 'lucide-react-native';
import { PathPoint, CelestialPosition } from '../utils/celestial';

interface CelestialChartProps {
  sunPos: CelestialPosition;
  moonPos: CelestialPosition;
  sunPath: PathPoint[];
  moonPath: PathPoint[];
  isDay: boolean;
  rotation?: number;
  onRotationChange?: (rot: number) => void;
  isActive?: boolean;
}

export const CelestialChart: React.FC<CelestialChartProps> = ({
  sunPos,
  moonPos,
  sunPath,
  moonPath,
  isDay,
  rotation = 0,
  onRotationChange = () => {},
  isActive = true,
}) => {
  const { width } = Dimensions.get('window');
  const CANVAS_SIZE = width * 0.75;
  const CENTER = CANVAS_SIZE / 2;
  const RADIUS = CANVAS_SIZE * 0.4;

  const startRotation = useRef(0);
  const startAngle = useRef(0);
  const startX = useRef(0);
  const startY = useRef(0);

  const rotationRef = useRef(rotation);
  const onRotationChangeRef = useRef(onRotationChange);
  const isActiveRef = useRef(isActive);

  // Keep references updated to avoid stale closures in panResponder
  rotationRef.current = rotation;
  onRotationChangeRef.current = onRotationChange;
  isActiveRef.current = isActive;

  const getAngle = (x: number, y: number) => {
    const dx = x - CENTER;
    const dy = y - CENTER;
    return Math.atan2(dy, dx) * (180 / Math.PI);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !!isActiveRef.current,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        startAngle.current = getAngle(locationX, locationY);
        startX.current = locationX;
        startY.current = locationY;
        // Ensure we use a valid number for start rotation using the updated ref
        startRotation.current = Number(rotationRef.current) || 0;
      },
      onPanResponderMove: (evt, gestureState) => {
        const currentX = startX.current + gestureState.dx;
        const currentY = startY.current + gestureState.dy;
        const currentAngle = getAngle(currentX, currentY);
        const delta = currentAngle - startAngle.current;
        
        // Final safety check for callback using the updated ref
        if (typeof onRotationChangeRef.current === 'function') {
          onRotationChangeRef.current(startRotation.current + delta);
        }
      },
    })
  ).current;

  const polarToCartesian = (azimuth: number, altitude: number) => {
    const r = RADIUS * (1 - altitude / 90);
    const theta = (azimuth - 90) * (Math.PI / 180);
    return {
      x: CENTER + r * Math.cos(theta),
      y: CENTER + r * Math.sin(theta),
    };
  };

  const sunCoords = polarToCartesian(sunPos.azimuth, sunPos.altitude);
  const moonCoords = polarToCartesian(moonPos.azimuth, moonPos.altitude);

  const renderPath = (path: PathPoint[], color: string, isMoon: boolean = false) => {
    if (path.length < 2) return null;
    let d = "";
    let isNewSegment = true;
    path.forEach((p, i) => {
      if (p.altitude >= 0) {
        const coords = polarToCartesian(p.azimuth, p.altitude);
        if (isNewSegment) {
          d += `M${coords.x} ${coords.y}`;
          isNewSegment = false;
        } else {
          d += ` L${coords.x} ${coords.y}`;
        }
      } else {
        isNewSegment = true;
      }
    });

    if (d === "") return null;

    return (
      <Path
        d={d}
        stroke={color}
        strokeWidth={isMoon ? "1.2" : "1.8"}
        fill="none"
        strokeDasharray={isMoon ? "3 5" : "6 4"}
        opacity={isMoon ? 0.6 : 0.8}
      />
    );
  };

  const getSkyColors = () => {
    const alt = sunPos.altitude;
    if (alt > 10) return { top: '#4facfe', bottom: '#00f2fe', opacity: 0.2 }; 
    if (alt > 0) return { top: '#fb8c00', bottom: '#ffeb3b', opacity: 0.4 }; 
    if (alt > -4) return { top: '#8e2de2', bottom: '#ff0080', opacity: 0.5 }; 
    if (alt > -12) return { top: '#2c3e50', bottom: '#000000', opacity: 0.6 }; 
    return { top: '#000428', bottom: '#004e92', opacity: 0.8 }; 
  };

  const sky = getSkyColors();
  const strokeColor = isDay ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.1)";

  // Safe rotation value for SVG
  const safeRotation = Number(rotation) || 0;

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <Svg width={CANVAS_SIZE} height={CANVAS_SIZE} viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}>
        <Defs>
          <RadialGradient id="skyGrad" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0%" stopColor={sky.top} stopOpacity={sky.opacity} />
            <Stop offset="80%" stopColor={sky.bottom} stopOpacity={sky.opacity * 0.5} />
            <Stop offset="100%" stopColor="transparent" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="sunGlow" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0%" stopColor="#FFF" stopOpacity="1" />
            <Stop offset="40%" stopColor="#FFD700" stopOpacity="0.8" />
            <Stop offset="100%" stopColor="#FFD700" stopOpacity="0" />
          </RadialGradient>
        </Defs>

        {/* Rotate entire chart group */}
        <G transform={`rotate(${safeRotation}, ${CENTER}, ${CENTER})`}>
          <Circle cx={CENTER} cy={CENTER} r={RADIUS * 1.2} fill="url(#skyGrad)" />
          <Circle cx={CENTER} cy={CENTER} r={RADIUS} stroke={strokeColor} strokeWidth="1" fill="none" />
          
          <Line x1={CENTER - RADIUS} y1={CENTER} x2={CENTER + RADIUS} y2={CENTER} stroke={isDay ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.2)"} strokeWidth="1" strokeDasharray="3 3" />
          <Line x1={CENTER} y1={CENTER - RADIUS} x2={CENTER} y2={CENTER + RADIUS} stroke={isDay ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.2)"} strokeWidth="1" strokeDasharray="3 3" />

          {[30, 60].map(r => (
            <Circle key={r} cx={CENTER} cy={CENTER} r={RADIUS * (1 - r/90)} stroke={strokeColor} strokeWidth="0.5" fill="none" />
          ))}

          {/* Dynamic Shadow Effect */}
          {sunPos.altitude > -2 && (
            <G transform={`rotate(${sunPos.azimuth + 90}, ${CENTER}, ${CENTER})`}>
              <Defs>
                <LinearGradient id="shadowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <Stop 
                    offset="0%" 
                    stopColor={isDay ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.08)"} 
                    stopOpacity={Math.max(0, Math.min(1, sunPos.altitude / 30))} 
                  />
                  <Stop offset="100%" stopColor="transparent" stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Rect
                x={CENTER}
                y={CENTER - 4} // Center vertically relative to 8px height
                width={Math.max(0, (90 - sunPos.altitude) / 90) * RADIUS}
                height={8} // Match center circle diameter
                fill="url(#shadowGradient)"
                rx={4}
              />
            </G>
          )}

          {['N', 'E', 'S', 'W'].map((label, i) => {
            const angle = i * 90;
            const coords = polarToCartesian(angle, -10);
            return (
              <SvgText key={label} x={coords.x} y={coords.y} fill={isDay ? "#1A1A1A" : "#FFFFFF"} fontSize="12" fontWeight="900" textAnchor="middle" alignmentBaseline="middle">
                {label}
              </SvgText>
            );
          })}

          <Circle cx={CENTER} cy={CENTER} r={4} fill={isDay ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.4)"} />
          <Circle cx={CENTER} cy={CENTER} r={1.5} fill={isDay ? "#FFF" : "#000"} />

          {renderPath(sunPath, "#FFD700")}
          {renderPath(moonPath, "#E0E0E0", true)}

          {sunPos.altitude > -5 && (
            <G>
              <Circle cx={sunCoords.x} cy={sunCoords.y} r={20} fill="url(#sunGlow)" opacity={0.8} />
              <Circle cx={sunCoords.x} cy={sunCoords.y} r={8} fill="#FFD700" />
            </G>
          )}

          {moonPos.altitude > -5 && (
            <G>
              <Circle cx={moonCoords.x} cy={moonCoords.y} r={15} fill={isDay ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.1)"} />
              <Moon size={18} color={isDay ? "#666" : "#E0E0E0"} fill={isDay ? "#666" : "#E0E0E0"} x={moonCoords.x - 9} y={moonCoords.y - 9} />
            </G>
          )}
        </G>
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { justifyContent: 'center', alignItems: 'center', paddingVertical: 20 },
});
