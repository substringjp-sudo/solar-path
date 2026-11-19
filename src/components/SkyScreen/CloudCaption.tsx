/**
 * CloudCaption.tsx — 하늘 위 **구름 한 줄**(쉬운 말, docs/SANDBOX_MODE_PLAN.md 2.4). 하늘 아래쪽 가운데에 얹는 작은 알약입니다.
 * 글은 `utils/skyWords.ts` 의 `cloudSummary` 가 만들고, 터치는 받지 않습니다(그 밑의 하늘을 그대로 만질 수 있게).
 * 하늘 위에 뜨는 것이라 화면 모드와 상관없이 어두운 재질(overlay)을 씁니다.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color as DARK, radius } from '../../theme/tokens';

export const CloudCaption: React.FC<{ text: string }> = ({ text }) => (
  <View style={styles.wrap} pointerEvents="none">
    <Text style={styles.text} numberOfLines={1}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, bottom: 14, alignItems: 'center', zIndex: 18 },
  text: {
    fontSize: 12, fontWeight: '600', color: DARK.text, backgroundColor: DARK.overlay,
    borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5, overflow: 'hidden',
  },
});
