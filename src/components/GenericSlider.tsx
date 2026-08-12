import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, PanResponder, Animated } from 'react-native';
import { useCelestialStore } from '../store/useCelestialStore';

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
  const dragStartValue = useRef(0);

  // Callback refs to prevent PanResponder recreation on parent re-renders
  const onChangeRef = useRef(onChange);
  const onGrantRef = useRef(onGrant);
  const onReleaseRef = useRef(onRelease);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onGrantRef.current = onGrant;
  }, [onGrant]);

  useEffect(() => {
    onReleaseRef.current = onRelease;
  }, [onRelease]);

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

  // 2. 최초 레이아웃 크기가 잡혔을 때, 게이지가 유실되지 않도록 값을 명시적으로 갱신합니다.
  useEffect(() => {
    if (layoutWidth > 0) {
      animatedValue.setValue(value);
      setLocalValue(value);
    }
  }, [layoutWidth]);

  useEffect(() => {
    if (!isDragging) {
      // 외부 값이 갱신될 때 부드러운 spring 보간 딜레이 없이 즉시 셋업되도록 강제 주입
      animatedValue.setValue(value);
      setLocalValue(value);
    }
  }, [value, isDragging]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dx) > 2,
    onPanResponderGrant: (evt) => {
      useCelestialStore.getState().setGestureBlocked(true);
      setIsDragging(true);
      onGrantRef.current?.();
      if (layoutWidth === 0) return;
      
      const { locationX } = evt.nativeEvent;
      const usableWidth = layoutWidth - 54; // Total width minus both paddings
      const relativeX = locationX - 27; // Subtract padding
      const p = Math.max(0, Math.min(100, (relativeX / usableWidth) * 100));
      
      dragStartValue.current = p;
      setLocalValue(p);
      animatedValue.setValue(p);
      onChangeRef.current(p);
    },
    onPanResponderMove: (evt, gestureState) => {
      if (layoutWidth === 0) return;
      const usableWidth = layoutWidth - 54;
      const dp = (gestureState.dx / usableWidth) * 100;
      const p = Math.max(0, Math.min(100, dragStartValue.current + dp));
      setLocalValue(p);
      animatedValue.setValue(p);
      onChangeRef.current(p);
    },
    onPanResponderRelease: () => {
      useCelestialStore.getState().setGestureBlocked(false);
      setIsDragging(false);
      onReleaseRef.current?.();
    },
    onPanResponderTerminate: () => {
      useCelestialStore.getState().setGestureBlocked(false);
      setIsDragging(false);
      onReleaseRef.current?.();
    },
  }), [layoutWidth]);



  const onLayout = (event: any) => {
    const { width } = event.nativeEvent.layout;
    setLayoutWidth(width);
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
        pointerEvents="none"
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
  fill: { height: '100%', borderRadius: 3, position: 'absolute', left: 0 },
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
