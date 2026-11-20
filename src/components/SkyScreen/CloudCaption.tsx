/**
 * CloudCaption.tsx — 하늘 위 **구름 한 줄**(쉬운 말, docs/SANDBOX_MODE_PLAN.md 2.4). 하늘 아래쪽 가운데에 얹는 작은 알약입니다.
 * 글은 `utils/skyWords.ts` 의 `cloudSummary` 가 만듭니다. 처음에는 터치를 받지 않아(그 밑의 하늘을 그대로 만질 수 있게) 글자 알약만 있었고,
 * `onPress` 를 주면 알약만 눌러 "구름 모양" 계산 과정을 엽니다(숫자를 누르면 그 단계로 가는 규칙, 계획 9.4.1). 알약 밖은 여전히 하늘로 터치가 지나갑니다.
 * 하늘 위에 뜨는 것이라 화면 모드와 상관없이 어두운 재질(overlay)을 씁니다.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color as DARK, radius } from '../../theme/tokens';
import { PressScale } from '../ui';

interface Props {
  text: string;
  /** 주면 알약이 버튼이 됩니다. */
  onPress?: () => void;
  /** 버튼일 때 스크린리더 글(없으면 text). */
  accessibilityLabel?: string;
}

export const CloudCaption: React.FC<Props> = ({ text, onPress, accessibilityLabel }) => (
  <View style={styles.wrap} pointerEvents={onPress ? 'box-none' : 'none'}>
    {onPress ? (
      <PressScale
        style={styles.pill}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? text}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.pillText} numberOfLines={1}>{text}</Text>
      </PressScale>
    ) : (
      <Text style={styles.text} numberOfLines={1}>{text}</Text>
    )}
  </View>
);

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, bottom: 14, alignItems: 'center', zIndex: 18 },
  text: {
    fontSize: 12, fontWeight: '600', color: DARK.text, backgroundColor: DARK.overlay,
    borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5, overflow: 'hidden',
  },
  pill: { backgroundColor: DARK.overlay, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5, overflow: 'hidden', maxWidth: '100%' },
  pillText: { fontSize: 12, fontWeight: '600', color: DARK.text },
});
