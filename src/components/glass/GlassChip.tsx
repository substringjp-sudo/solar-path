/**
 * GlassChip.tsx — 유리 알약 단추(칩 · 날짜 · "지금" · 읽음 줄 바탕). 높이는 40 이상(손가락 닿는 곳), 글자는 항상 #F1F5F9.
 * 켜진 칩은 하늘색 덧칠, 펼쳐진 칩은 aria-expanded.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { ACTIVE_CHIP_TEXT, GLASS, TEXT } from '../../theme/glassTokens';
import { mono as monoFont } from '../../theme/tokens';
import { GlassSurface, glassTextShadow } from './GlassSurface';
import { isRecentDrag } from './dragGuard';

interface Props {
  label: string;
  onPress?: () => void;
  icon?: React.ReactNode;
  active?: boolean;
  expanded?: boolean;
  mono?: boolean;
  /** 유리 칠 없이 글자만(이미 유리 면 안에 놓인 탭 따위). 켜졌을 때만 하늘색 덧칠. */
  flat?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export const CHIP_MIN_H = 40;

export const GlassChip: React.FC<Props> = ({ label, onPress, icon, active = false, expanded, mono = false, flat = false, accessibilityLabel, style, testID }) => {
  const content = (
    <>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text numberOfLines={1} style={[styles.text, mono && styles.mono, { color: active ? ACTIVE_CHIP_TEXT : TEXT }, glassTextShadow]}>{label}</Text>
    </>
  );
  const body = flat ? (
    <View style={[styles.pill, style, active && styles.flatActive]}>{content}</View>
  ) : (
    <GlassSurface active={active} style={[styles.pill, style]}>{content}</GlassSurface>
  );
  if (!onPress) return <View testID={testID}>{body}</View>;
  return (
    <Pressable
      testID={testID}
      onPress={() => { if (!isRecentDrag()) onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      aria-pressed={active}
      aria-expanded={expanded}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  pill: { minHeight: CHIP_MIN_H, paddingHorizontal: 14, borderRadius: CHIP_MIN_H / 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  icon: { alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 11, fontWeight: '700' },
  mono: { fontFamily: monoFont },
  pressed: { opacity: 0.7 },
  flatActive: { backgroundColor: `rgba(${GLASS.tintRGB.join(', ')}, ${GLASS.tintAlpha})` },
});
