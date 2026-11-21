/**
 * GlassIconButton.tsx — 유리 면 안의 아이콘 단추(카메라 위 줄의 닫기 · 앞뒤 전환). 눌림 영역은 TOUCH(40) × 40.
 */
import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { TOUCH } from '../../theme/tokens';
import { GlassSurface } from './GlassSurface';

interface Props {
  icon: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export const GlassIconButton: React.FC<Props> = ({ icon, onPress, accessibilityLabel, active = false, style, testID }) => (
  <Pressable
    testID={testID}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    aria-pressed={active}
    style={({ pressed }) => [pressed && styles.pressed]}
  >
    <GlassSurface active={active} style={[styles.face, style]}>{icon}</GlassSurface>
  </Pressable>
);

const styles = StyleSheet.create({
  face: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
