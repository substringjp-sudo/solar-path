/**
 * GlassSurface.tsx — 테두리 없는 옅은 유리(목업 "4차 b"). 값은 `theme/glassTokens.ts`(밝은 하늘 위 글자 대비로 정함).
 *
 * 구성: 흐림(웹은 CSS backdrop-filter, 기기는 expo-blur) + 어두운 칠 + 위 가장자리 안쪽 선(테두리 대신).
 * expo-blur 가 없는 개발 빌드에서도 앱이 죽지 않도록 불러오기를 감싸고, 못 불러오면 흐림 없는 짙은 칠(0.50)로 그립니다.
 * 켜진 칩은 `active` 로 하늘색 덧칠(0.20)을 얹습니다 — 글자는 흰색 그대로.
 */
import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GLASS, glassFill } from '../../theme/glassTokens';

let BlurViewImpl: React.ComponentType<any> | null = null;
if (Platform.OS === 'ios') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    BlurViewImpl = require('expo-blur').BlurView ?? null;
  } catch {
    BlurViewImpl = null;
  }
}

/** expo-blur 의 흐림 세기(0~100). 22 px 상당으로 보고 정한 값이라 실기기에서 눈으로 맞춥니다. */
export const BLUR_INTENSITY = 50;

const TINT = `rgba(${GLASS.tintRGB.join(', ')}, ${GLASS.tintAlpha})`;

interface Props {
  style?: StyleProp<ViewStyle>;
  /** 켜진 칩: 하늘색 덧칠 */
  active?: boolean;
  testID?: string;
  children?: React.ReactNode;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
}

export const GlassSurface: React.FC<Props> = ({ style, active = false, testID, children, pointerEvents }) => {
  const blurred = Platform.OS === 'web' || BlurViewImpl !== null;
  const webBlur: any = Platform.OS === 'web'
    ? { backdropFilter: `blur(${GLASS.blurPx}px) saturate(${GLASS.saturate * 100}%)`, WebkitBackdropFilter: `blur(${GLASS.blurPx}px) saturate(${GLASS.saturate * 100}%)` }
    : null;
  return (
    <View testID={testID} pointerEvents={pointerEvents} style={[styles.base, webBlur, style]}>
      {Platform.OS !== 'web' && BlurViewImpl ? (
        <BlurViewImpl intensity={BLUR_INTENSITY} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
      ) : null}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: glassFill(blurred) }]} />
      {active ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: TINT }]} /> : null}
      <View pointerEvents="none" style={styles.highlight} />
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  base: { overflow: 'hidden', borderWidth: 0 },
  highlight: { position: 'absolute', top: 0, left: 8, right: 8, height: 1, backgroundColor: GLASS.highlight },
});

/** 유리 위 글자 그림자(글자 색은 `TEXT`). */
export const glassTextShadow = {
  textShadowColor: GLASS.textShadow.color,
  textShadowOffset: { width: GLASS.textShadow.x, height: GLASS.textShadow.y },
  textShadowRadius: GLASS.textShadow.blur,
} as const;
