/**
 * GlassSurface.tsx — 반투명 플랫 매테리얼(칩 · 버튼 · 상단 알약) + 고급 프로스트 블러(펼쳐지는 큰 시트/패널 컨테이너).
 *
 * 디자인 및 성능 구조 (2026-11-22):
 * 1. 기본(`blurred={false}`): 작은 칩 · 아이콘 버튼 · 알약은 불필요한 중첩 View 나 개별 BlurView 없이
 *    단일 View 의 반투명 플랫 다크 매테리얼(`rgba(15, 22, 36, 0.56)`)과 미세한 1px 헤어라인 보더만 그려
 *    오버드로우를 없애고 60fps 반응성을 유지합니다.
 * 2. 큰 패널/시트(`blurred={true}`): 펼쳐지는 하단 시트, 팝오버, 카드 컨테이너 단 1곳에만
 *    `expo-blur`(iOS 네이티브 블러 + Android `dimezisBlurView`)와 깊은 프로스트 다크 틴트, 상단 스펙큘러 하이라이트를
 *    입혀 고급스러운 프로스트 매트(Frosted Matte) 질감을 구현합니다.
 * 3. 웹 하네스(`Platform.OS === 'web'`)에서는 기존 CSS `backdrop-filter`와 픽셀 검증 호환을 그대로 유지합니다.
 */
import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { blendRGB, GLASS, glassFill } from '../../theme/glassTokens';
import { TOUCH } from '../../theme/tokens';

let BlurViewImpl: React.ComponentType<any> | null = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    BlurViewImpl = require('expo-blur').BlurView ?? null;
  } catch {
    BlurViewImpl = null;
  }
}

/** expo-blur 의 흐림 세기(0~100). */
export const BLUR_INTENSITY = 48;

const TINT = `rgba(${GLASS.tintRGB.join(', ')}, ${GLASS.tintAlpha})`;

// 플랫 매테리얼 색(칩 · 알약 · 버튼용): 단정하고 깊이감 있는 반투명 슬레이트 다크
const FLAT_BASE_BG = 'rgba(14, 20, 34, 0.56)';
const FLAT_ACTIVE_RGB = blendRGB(GLASS.fillRGB, GLASS.tintRGB, 0.24);
const FLAT_ACTIVE_BG = `rgba(${Math.round(FLAT_ACTIVE_RGB[0])}, ${Math.round(FLAT_ACTIVE_RGB[1])}, ${Math.round(FLAT_ACTIVE_RGB[2])}, 0.68)`;

// 프로스트 블러 시트 색(큰 패널 · 카드용): 블러 위에 얹히는 고급 다크 매트 틴트
const FROST_TINT_BG = 'rgba(11, 16, 28, 0.52)';
const FROST_FALLBACK_BG = 'rgba(12, 18, 30, 0.84)';

interface Props {
  style?: StyleProp<ViewStyle>;
  /** 켜진 칩: 하늘색 매테리얼 강조 */
  active?: boolean;
  /** 큰 시트 · 패널 컨테이너에만 true 로 켜서 하드웨어 프로스트 블러를 적용 */
  blurred?: boolean;
  testID?: string;
  children?: React.ReactNode;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
}

export const GlassSurface: React.FC<Props> = React.memo(({
  style,
  active = false,
  blurred = false,
  testID,
  children,
  pointerEvents,
}) => {
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

  // 큰 패널/시트 컨테이너: 하드웨어 프로스트 블러 + 매트 다크 오버레이 + 상단 스펙큘러 엣지
  if (blurred) {
    return (
      <View
        testID={testID}
        pointerEvents={pointerEvents}
        style={[
          styles.frostBase,
          !BlurViewImpl && { backgroundColor: FROST_FALLBACK_BG },
          active && styles.frostActiveBorder,
          style,
        ]}
      >
        {BlurViewImpl ? (
          <BlurViewImpl
            intensity={BLUR_INTENSITY}
            tint="dark"
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: active ? FLAT_ACTIVE_BG : FROST_TINT_BG },
          ]}
        />
        <View pointerEvents="none" style={styles.frostTopEdge} />
        {children}
      </View>
    );
  }

  // 기본(칩 · 버튼 · 상단 알약): 단일 View 반투명 플랫 매테리얼
  return (
    <View
      testID={testID}
      pointerEvents={pointerEvents}
      style={[
        styles.flatBase,
        active ? styles.flatActive : styles.flatInactive,
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
  flatBase: {
    overflow: 'hidden',
    borderRadius: TOUCH / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  flatInactive: {
    backgroundColor: FLAT_BASE_BG,
    borderColor: 'rgba(255, 255, 255, 0.11)',
  },
  flatActive: {
    backgroundColor: FLAT_ACTIVE_BG,
    borderColor: 'rgba(56, 189, 248, 0.48)',
  },
  frostBase: {
    overflow: 'hidden',
    borderRadius: TOUCH / 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  frostActiveBorder: {
    borderColor: 'rgba(56, 189, 248, 0.50)',
  },
  frostTopEdge: {
    position: 'absolute',
    top: 0,
    left: 14,
    right: 14,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.24)',
  },
});

/**
 * 글자 그림자(글자 색은 `TEXT`).
 * 네이티브에서는 칩·눈금마다 텍스트 그림자 래스터라이징이 걸리는 것을 막기 위해 빈 객체로 둡니다.
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
