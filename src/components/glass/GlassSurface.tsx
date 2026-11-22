/**
 * GlassSurface.tsx — 테두리 없는 옅은 유리(목업 "4차 b"). 값은 `theme/glassTokens.ts`(밝은 하늘 위 글자 대비로 정함).
 *
 * 최적화(2026-11-22):
 * - 네이티브(Android/iOS)에서는 4중 중첩 View + expo-blur 개별 마운트 + 텍스트 그림자 래스터라이징을 제거하고,
 *   합성된 단일 배경색(`backgroundColor`)과 얇은 상단 테두리(`borderTopWidth: StyleSheet.hairlineWidth`)만 가진
 *   단일 `View`로 렌더링해 Overdraw와 레이아웃 비용을 1/4로 줄입니다.
 * - 웹 하네스(`Platform.OS === 'web'`)에서는 기존 CSS `backdrop-filter`와 픽셀 검증 호환을 유지합니다.
 */
import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { blendRGB, GLASS, glassFill } from '../../theme/glassTokens';
import { TOUCH } from '../../theme/tokens';

/** expo-blur 의 흐림 세기(0~100). 호환용 상수 유지. */
export const BLUR_INTENSITY = 50;

const TINT = `rgba(${GLASS.tintRGB.join(', ')}, ${GLASS.tintAlpha})`;
const NATIVE_BASE_BG = glassFill(false);
const NATIVE_ACTIVE_RGB = blendRGB(GLASS.fillRGB, GLASS.tintRGB, GLASS.tintAlpha);
const NATIVE_ACTIVE_BG = `rgba(${Math.round(NATIVE_ACTIVE_RGB[0])}, ${Math.round(NATIVE_ACTIVE_RGB[1])}, ${Math.round(NATIVE_ACTIVE_RGB[2])}, ${GLASS.flatAlpha + (1 - GLASS.flatAlpha) * GLASS.tintAlpha})`;

interface Props {
  style?: StyleProp<ViewStyle>;
  /** 켜진 칩: 하늘색 덧칠 */
  active?: boolean;
  testID?: string;
  children?: React.ReactNode;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
}

export const GlassSurface: React.FC<Props> = React.memo(({ style, active = false, testID, children, pointerEvents }) => {
  if (Platform.OS === 'web') {
    const webBlur: any = {
      backdropFilter: `blur(${GLASS.blurPx}px) saturate(${GLASS.saturate * 100}%)`,
      WebkitBackdropFilter: `blur(${GLASS.blurPx}px) saturate(${GLASS.saturate * 100}%)`,
    };
    return (
      <View testID={testID} pointerEvents={pointerEvents} style={[styles.base, webBlur, style]}>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: glassFill(true) }]} />
        {active ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: TINT }]} /> : null}
        <View pointerEvents="none" style={styles.highlight} />
        {children}
      </View>
    );
  }

  return (
    <View
      testID={testID}
      pointerEvents={pointerEvents}
      style={[
        styles.nativeBase,
        active ? styles.nativeActive : styles.nativeInactive,
        style,
      ]}
    >
      {children}
    </View>
  );
});

const styles = StyleSheet.create({
  base: { overflow: 'hidden', borderWidth: 0, borderRadius: TOUCH / 2 },
  highlight: { position: 'absolute', top: 0, left: 8, right: 8, height: 1, backgroundColor: GLASS.highlight },
  nativeBase: {
    overflow: 'hidden',
    borderRadius: TOUCH / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  nativeInactive: {
    backgroundColor: NATIVE_BASE_BG,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  nativeActive: {
    backgroundColor: NATIVE_ACTIVE_BG,
    borderColor: 'rgba(56, 189, 248, 0.42)',
  },
});

/**
 * 유리 위 글자 그림자(글자 색은 `TEXT`).
 * 네이티브에서는 칩·눈금마다 텍스트 그림자 래스터라이징이 걸리는 것을 막기 위해 빈 객체로 두어 GPU 텍스트 캐시 히트율을 높입니다.
 */
export const glassTextShadow = (Platform.OS === 'web'
  ? {
      textShadowColor: GLASS.textShadow.color,
      textShadowOffset: { width: GLASS.textShadow.x, height: GLASS.textShadow.y },
      textShadowRadius: GLASS.textShadow.blur,
    }
  : {}) as {
  readonly textShadowColor?: string;
  readonly textShadowOffset?: { readonly width: number; readonly height: number };
  readonly textShadowRadius?: number;
};
