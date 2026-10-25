/**
 * ui — 공용 부품. 색·반경·글자·움직임은 전부 `theme/tokens` 에서 옵니다(규칙: docs/DESIGN_SYSTEM.md).
 *
 *  - `PressScale`    : 누르면 살짝 들어가는 버튼 바탕. 앱의 모든 누를 것은 이것을 씁니다
 *                      (`TouchableOpacity` 와 같은 자리에 그대로 바꿔 끼울 수 있습니다).
 *  - `OverlayButton` : 3D 하늘·지도 위에 떠 있는 아이콘 버튼(오른쪽 위 보기 조작 묶음).
 *  - `PrimaryButton` : 화면의 주 동작 하나(재생, 로그인 …). 강조색 바탕.
 *  - `Chip`          : 켜고 끄는 작은 선택 버튼. 켜짐·꺼짐 색이 스르르 바뀝니다.
 *  - `Reveal`        : 나타날 때 아래에서 살짝 떠오르며 보이는 틀(배너·메뉴).
 *  - `SectionLabel`  : 패널 안 구획 머리(모노 대문자 라벨).
 *  - `Panel`         : 도킹 패널 카드.
 */
import React, { useEffect, useRef } from 'react';
import {
  View, Text, Pressable, Animated, StyleSheet,
  type ViewStyle, type StyleProp, type PressableProps, type GestureResponderEvent, type LayoutChangeEvent,
} from 'react-native';
import { color, material, radius, space, type, motion, OVERLAY_BTN, TOUCH } from '../../theme/tokens';
import { springTo, timeTo, pressScaleFor, isReducedMotion } from '../../theme/motion';
import { makeStyles, useThemeColors } from '../../theme/useTheme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressScaleProps = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  /**
   * `TouchableOpacity` 와 바꿔 끼우기 위해 받습니다. `1` 이면 반응하지 않습니다
   * (창 바깥 막처럼 "누르면 닫히는 바탕" 은 들어가면 안 되므로).
   */
  activeOpacity?: number;
  /** `'none'` 이면 반응하지 않습니다. */
  reaction?: 'scale' | 'none';
};

/**
 * 누름 반응 — 손가락이 닿으면 90ms 에 가장자리가 3px 들어가고, 떼면 스프링으로 돌아옵니다.
 * 작은 버튼은 5%, 화면 폭 줄은 1% 남짓 줄어듭니다(`pressScaleFor`). 동작 줄이기면 흐려지기만 합니다.
 */
export const PressScale: React.FC<PressScaleProps> = ({
  style, children, activeOpacity, reaction, onPressIn, onPressOut, onLayout, accessibilityRole, ...rest
}) => {
  const scale = useRef(new Animated.Value(1)).current;
  const dim = useRef(new Animated.Value(1)).current;
  const width = useRef(0);
  const none = reaction === 'none' || activeOpacity === 1;
  const baseOpacity = (StyleSheet.flatten(style)?.opacity as number | undefined) ?? 1;

  const handleIn = (e: GestureResponderEvent) => {
    if (!none) {
      if (isReducedMotion()) dim.setValue(motion.press.dim);
      else timeTo(scale, pressScaleFor(width.current), 'tap', 'enter').start();
    }
    onPressIn?.(e);
  };
  const handleOut = (e: GestureResponderEvent) => {
    if (!none) {
      dim.setValue(1);
      springTo(scale, 1, 'press').start();
    }
    onPressOut?.(e);
  };
  const handleLayout = (e: LayoutChangeEvent) => {
    width.current = e.nativeEvent.layout.width;
    onLayout?.(e);
  };

  return (
    <AnimatedPressable
      accessibilityRole={accessibilityRole ?? 'button'}
      {...rest}
      onPressIn={handleIn}
      onPressOut={handleOut}
      onLayout={handleLayout}
      style={[style, !none && { transform: [{ scale }], opacity: Animated.multiply(dim, baseOpacity) }] as any}
    >
      {children}
    </AnimatedPressable>
  );
};

export const OverlayButton: React.FC<{
  onPress?: () => void;
  onLongPress?: () => void;
  delayLongPress?: number;
  active?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}> = ({ onPress, onLongPress, delayLongPress = 700, active, accessibilityLabel, style, children }) => (
  <PressScale
    onPress={onPress}
    onLongPress={onLongPress}
    delayLongPress={delayLongPress}
    accessibilityLabel={accessibilityLabel}
    accessibilityState={{ selected: !!active }}
    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    style={[overlayStyles.overlayBtn, active && overlayStyles.overlayBtnOn, style]}
  >
    {children}
  </PressScale>
);

export const PrimaryButton: React.FC<{
  label: string;
  onPress?: () => void;
  icon?: React.ReactNode;
  /** `danger` 는 "멈춤" 처럼 진행 중인 것을 끊는 주 동작 */
  tone?: 'accent' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}> = ({ label, onPress, icon, tone = 'accent', disabled, style }) => {
  const color = useThemeColors(); const styles = useStyles();
  return (
  <PressScale
    onPress={onPress}
    disabled={disabled}
    accessibilityLabel={label}
    style={[styles.primary, { backgroundColor: tone === 'danger' ? color.danger : color.accent }, disabled && { opacity: 0.5 }, style]}
  >
    {icon}
    <Text style={styles.primaryText}>{label}</Text>
  </PressScale>
  );
};

/** 켜짐·꺼짐이 `fast`(160ms) 에 걸쳐 스르르 바뀝니다 — 색 변화는 동작 줄이기에서도 남깁니다. */
export const Chip: React.FC<{
  label: string;
  on?: boolean;
  onPress?: () => void;
  leading?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}> = ({ label, on, onPress, leading, style }) => {
  const color = useThemeColors(); const styles = useStyles();
  const t = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    timeTo(t, on ? 1 : 0, 'fast', 'standard', { useNativeDriver: false, keepWhenReduced: true }).start();
  }, [on, t]);
  const bg = t.interpolate({ inputRange: [0, 1], outputRange: [color.fill, color.accentSoft] });
  const bd = t.interpolate({ inputRange: [0, 1], outputRange: [color.border, color.accentLine] });
  return (
    <PressScale onPress={onPress} accessibilityState={{ selected: !!on }} style={style}>
      <Animated.View style={[styles.chip, { backgroundColor: bg, borderColor: bd }]}>
        {leading}
        <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
      </Animated.View>
    </PressScale>
  );
};

/** 처음 그려질 때 `base`(240ms) 동안 8px 아래에서 떠오르며 나타납니다. */
export const Reveal: React.FC<{ style?: StyleProp<ViewStyle>; children: React.ReactNode; pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only' }> = ({ style, children, pointerEvents }) => {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { timeTo(a, 1, 'base', 'enter').start(); }, [a]);
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [motion.rise, 0] });
  return <Animated.View pointerEvents={pointerEvents} style={[style, { opacity: a, transform: [{ translateY }] }]}>{children}</Animated.View>;
};

export const SectionLabel: React.FC<{ children: React.ReactNode; icon?: React.ReactNode; right?: React.ReactNode }> = ({ children, icon, right }) => {
  const styles = useStyles();
  return (
  <View style={styles.sectionRow}>
    {icon}
    <Text style={styles.sectionLabel}>{children}</Text>
    {right ? <View style={{ marginLeft: 'auto' }}>{right}</View> : null}
  </View>
  );
};

export const Panel: React.FC<{ style?: StyleProp<ViewStyle>; children: React.ReactNode }> = ({ style, children }) => {
  const styles = useStyles();
  return <View style={[styles.panel, style]}>{children}</View>;
};

/** 떠 있는 버튼 — 하늘·지도 위라서 화면 모드와 상관없이 어둡습니다. */
const overlayStyles = StyleSheet.create({
  overlayBtn: {
    ...material.overlay,
    width: OVERLAY_BTN,
    height: OVERLAY_BTN,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayBtnOn: { backgroundColor: color.accentSoft, borderColor: color.accentLine },
});

/** 패널·창 안의 부품 — 화면 모드를 따릅니다. */
const useStyles = makeStyles((color) => ({
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: TOUCH,
    borderRadius: radius.sm,
    paddingHorizontal: space.lg,
  },
  primaryText: { ...type.bodyStrong, color: color.onAccent },
  chip: {
    borderWidth: 1,
    borderRadius: radius.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    minHeight: TOUCH,
  },
  chipText: { ...type.label, color: color.textDim },
  chipTextOn: { color: color.accent },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.sm },
  sectionLabel: { ...type.micro, color: color.textDim, textTransform: 'uppercase' },
  panel: { backgroundColor: color.panel, borderColor: color.border, borderWidth: 1, padding: space.md, borderRadius: radius.md },
}));
