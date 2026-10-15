import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, PanResponder, Animated } from 'react-native';
import { useCelestialStore } from '../store/useCelestialStore';
import { color, radius, mono } from '../theme/tokens';
import { timeTo } from '../theme/motion';
import { makeStyles, useThemeColors } from '../theme/useTheme';

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
  const color = useThemeColors(); const styles = useStyles();
  const animatedValue = useRef(new Animated.Value(value)).current;
  const [isDragging, setIsDragging] = useState(false);
  const [localValue, setLocalValue] = useState(value);

  const [layoutWidth, setLayoutWidth] = useState(0);
  const trackRef = useRef<View>(null);
  const dragStartValue = useRef(0);
  const dragStartPageX = useRef(0);
  /** 슬라이더의 화면 왼쪽(px) — 손가락의 화면 좌표(`pageX`)와 같은 좌표계로 맞추려고 잽니다. */
  const leftRef = useRef(0);
  const measureLeft = () => {
    trackRef.current?.measureInWindow?.((x: number) => { if (Number.isFinite(x)) leftRef.current = x; });
  };

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
      // 색 바뀜은 움직임이 아니라서 동작 줄이기에서도 남깁니다.
      timeTo(colorAnim, 1, 'base', 'standard', { useNativeDriver: false, keepWhenReduced: true }).start();
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
      
      // ⚠ `locationX` 는 손가락이 닿은 **가장 안쪽 자식** 기준이라(4px 트랙이면 트랙 시작점 기준) 닿은 자리에 따라
      //   최대 27px 어긋났습니다. 화면 좌표(`pageX`)에서 슬라이더의 화면 왼쪽을 빼면 어디를 눌러도 같습니다.
      measureLeft();
      const usableWidth = layoutWidth - 54; // Total width minus both paddings
      const relativeX = evt.nativeEvent.pageX - leftRef.current - 27; // Subtract padding
      const p = Math.max(0, Math.min(100, (relativeX / usableWidth) * 100));
      
      dragStartValue.current = p;
      dragStartPageX.current = evt.nativeEvent.pageX;
      setLocalValue(p);
      animatedValue.setValue(p);
      onChangeRef.current(p);
    },
    onPanResponderMove: (evt, gestureState) => {
      if (layoutWidth === 0) return;
      const usableWidth = layoutWidth - 54;
      const dp = ((gestureState.moveX - dragStartPageX.current) / usableWidth) * 100;
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
    measureLeft();
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
      <View style={[styles.track, { backgroundColor: trackColor || color.border, zIndex: 1 }]}>
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
            backgroundColor: knobColor || color.text,
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

const useStyles = makeStyles((color) => ({
  container: { height: 44, justifyContent: 'center', width: '100%', paddingHorizontal: 27 },
  track: { height: 4, borderRadius: radius.xs, width: '100%', position: 'relative' },
  fill: { height: '100%', borderRadius: radius.xs, position: 'absolute', left: 0 },
  knob: { 
    position: 'absolute', 
    top: -14, 
    width: 56, 
    height: 32, 
    borderRadius: radius.xs, 
    marginLeft: -28, 
    justifyContent: 'center', 
    alignItems: 'center', 
    shadowColor: '#000', 
    shadowOpacity: 0.35, 
    shadowRadius: 6, 
    elevation: 6, 
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.65)',
  },
}));
