/**
 * ui — 공용 부품. 색·반경·글자는 전부 `theme/tokens` 에서 옵니다(2026-09-29 디자인 정리).
 *
 *  - `OverlayButton` : 3D 하늘·지도 위에 떠 있는 아이콘 버튼(오른쪽 위 보기 조작 묶음).
 *  - `Chip`          : 켜고 끄는 작은 선택 버튼(필터·토글·세그먼트).
 *  - `SectionLabel`  : 패널 안 구획 머리(모노 대문자 라벨).
 *  - `Panel`         : 도킹 패널 카드.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { color, material, radius, space, type, OVERLAY_BTN } from '../../theme/tokens';

export const OverlayButton: React.FC<{
  onPress?: () => void;
  onLongPress?: () => void;
  active?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}> = ({ onPress, onLongPress, active, accessibilityLabel, style, children }) => (
  <TouchableOpacity
    onPress={onPress}
    onLongPress={onLongPress}
    delayLongPress={700}
    activeOpacity={0.7}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    style={[styles.overlayBtn, active && styles.overlayBtnOn, style]}
  >
    {children}
  </TouchableOpacity>
);

export const Chip: React.FC<{
  label: string;
  on?: boolean;
  onPress?: () => void;
  leading?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}> = ({ label, on, onPress, leading, style }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.75}
    accessibilityRole="button"
    accessibilityState={{ selected: !!on }}
    style={[styles.chip, on && styles.chipOn, style]}
  >
    {leading}
    <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
  </TouchableOpacity>
);

export const SectionLabel: React.FC<{ children: React.ReactNode; icon?: React.ReactNode; right?: React.ReactNode }> = ({ children, icon, right }) => (
  <View style={styles.sectionRow}>
    {icon}
    <Text style={styles.sectionLabel}>{children}</Text>
    {right ? <View style={{ marginLeft: 'auto' }}>{right}</View> : null}
  </View>
);

export const Panel: React.FC<{ style?: StyleProp<ViewStyle>; children: React.ReactNode }> = ({ style, children }) => (
  <View style={[styles.panel, style]}>{children}</View>
);

const styles = StyleSheet.create({
  overlayBtn: {
    ...material.overlay,
    width: OVERLAY_BTN,
    height: OVERLAY_BTN,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayBtnOn: { backgroundColor: color.accentSoft, borderColor: color.accentLine },
  chip: {
    ...material.chip,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
  },
  chipOn: { ...material.chipOn },
  chipText: { ...type.label, color: color.textDim },
  chipTextOn: { color: color.accent },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.sm },
  sectionLabel: { ...type.micro, color: color.textDim, textTransform: 'uppercase' },
  panel: { ...material.panel, padding: space.md, borderRadius: radius.md },
});
