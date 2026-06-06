import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, PanResponder, Animated } from 'react-native';

interface GenericSliderProps {
  value: number; // 0 to 100
  onChange: (value: number) => void;
  onGrant?: () => void;
  onRelease?: () => void;
  theme: any;
  children?: React.ReactNode; // Custom knob content
  trackColor?: string;
  fillColor?: string;
  colorMap?: { inputRange: number[]; outputRange: string[] };
  knobColor?: string;
  trackOverlay?: React.ReactNode;
}

export const GenericSlider: React.FC<GenericSliderProps> = ({
  value,
  onChange,
  onGrant,
  onRelease,
  theme,
  children,
  trackColor,
  fillColor,
  colorMap,
  knobColor,
  trackOverlay,
}) => {
  const animatedValue = useRef(new Animated.Value(value)).current;
  const [isDragging, setIsDragging] = useState(false);
  const [localValue, setLocalValue] = useState(value);

  const [layoutWidth, setLayoutWidth] = useState(0);
  const trackRef = useRef<View>(null);
  const trackPos = useRef({ x: 0, width: 0 });

  // 1. 색상 부드러운 전환을 위한 보간 애니메이션 설계
  const [prevColor, setPrevColor] = useState(fillColor || theme.accent);
  const [nextColor, setNextColor] = useState(fillColor || theme.accent);
  const colorAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const targetColor = fillColor || theme.accent;
    if (targetColor !== nextColor) {
      setPrevColor(nextColor);
      setNextColor(targetColor);
      colorAnim.setValue(0);
      Animated.timing(colorAnim, {
        toValue: 1,
        duration: 300, // 300ms 동안 자연스럽게 변화
        useNativeDriver: false,
      }).start();
    }
  }, [fillColor, theme.accent]);

  const animatedFillColor = useMemo(() => {
    if (colorMap && colorMap.inputRange.length > 1) {
      return animatedValue.interpolate({
        inputRange: colorMap.inputRange,
        outputRange: colorMap.outputRange,
        extrapolate: 'clamp',
      });
    }
    return colorAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [prevColor, nextColor],
    });
  }, [colorMap, prevColor, nextColor, colorAnim, animatedValue]);

  useEffect(() => {
    if (!isDragging) {
      Animated.spring(animatedValue, {
        toValue: value,
        useNativeDriver: false,
        tension: 60,
        friction: 12,
      }).start();
      setLocalValue(value);
    }
  }, [value, isDragging]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dx) > 2,
    onPanResponderGrant: (evt) => {
      setIsDragging(true);
      onGrant?.();
      if (trackPos.current.width === 0) return;
      
      const relativeX = evt.nativeEvent.pageX - trackPos.current.x - 27; // Subtract padding
      const usableWidth = trackPos.current.width - 54; // Total width minus both paddings
      const p = Math.max(0, Math.min(100, (relativeX / usableWidth) * 100));
      setLocalValue(p);
      animatedValue.setValue(p);
      onChange(p);
    },
    onPanResponderMove: (evt) => {
      if (trackPos.current.width === 0) return;
      const relativeX = evt.nativeEvent.pageX - trackPos.current.x - 27;
      const usableWidth = trackPos.current.width - 54;
      const p = Math.max(0, Math.min(100, (relativeX / usableWidth) * 100));
      setLocalValue(p);
      animatedValue.setValue(p);
      onChange(p);
    },
    onPanResponderRelease: () => {
      setIsDragging(false);
      onRelease?.();
    },
    onPanResponderTerminate: () => {
      setIsDragging(false);
      onRelease?.();
    },
  }), [onChange, onGrant, onRelease]);



  const onLayout = (event: any) => {
    const { width } = event.nativeEvent.layout;
    setLayoutWidth(width);
    trackRef.current?.measureInWindow((x, y, w, h) => {
      trackPos.current = { x, width: w };
    });
  };

  const fillWidth = animatedValue.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%']
  });

  const knobPosition = animatedValue.interpolate({
    inputRange: [0, 100],
    outputRange: layoutWidth > 0 ? [27, layoutWidth - 27] : [27, 27]
  });

  return (
    <View 
      ref={trackRef}
      style={styles.container} 
      onLayout={onLayout}
      {...panResponder.panHandlers}
    >
      {/* 1. Track (Bottom) */}
      <View style={[styles.track, { backgroundColor: trackColor || 'rgba(255,255,255,0.1)', zIndex: 1 }]}>
        <Animated.View 
          style={[
            styles.fill, 
            { 
              width: fillWidth,
              backgroundColor: animatedFillColor,
            }
          ]} 
        />
      </View>

      {/* 2. Track Overlay (Markers) - Between Track and Knob */}
      {trackOverlay && (
        <View style={{ ...StyleSheet.absoluteFillObject, zIndex: 10, elevation: 10, paddingHorizontal: 27 }} pointerEvents="none">
           {trackOverlay}
        </View>
      )}

      {/* 3. Knob (Top) */}
      <Animated.View 
        style={[
          styles.knob, 
          { 
            left: knobPosition,
            borderColor: theme.bg,
            backgroundColor: knobColor || '#FFF',
            zIndex: 100,
            elevation: 100,
          }
        ]}
      >
        {children}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { height: 44, justifyContent: 'center', width: '100%', paddingHorizontal: 27 },
  track: { height: 6, borderRadius: 3, width: '100%', position: 'relative' },
  fill: { height: '100%', borderRadius: 3, position: 'absolute' },
  knob: { 
    position: 'absolute', 
    top: -14, 
    width: 54, 
    height: 34, 
    borderRadius: 12, 
    marginLeft: -27, 
    justifyContent: 'center', 
    alignItems: 'center', 
    shadowColor: '#000', 
    shadowOpacity: 0.2, 
    shadowRadius: 4, 
    elevation: 5, 
    borderWidth: 2 
  },
});
