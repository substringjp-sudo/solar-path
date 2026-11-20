/**
 * CompareChips.tsx — **한 번 누르는 피드백 칩**(docs/SANDBOX_MODE_PLAN.md 8.7, 목업 5): "구름 양: 실제가 더 많음 · 비슷 · 더 적음", "색: 더 붉음 · 비슷 · 덜 붉음".
 * 같은 칩을 다시 누르면 꺼집니다(`recordCompare.mergeCompare`). 모은 값은 03 기록의 요약과 치우침이 읽습니다.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, radius, mono } from '../theme/tokens';
import { PressScale } from './ui';
import { L3, type Language } from '../utils/i18n';
import type { CloudFeedback, ColorFeedback, PhotoCompare } from '../utils/recordCompare';

interface Props {
  language: Language;
  value: PhotoCompare | undefined;
  onChange: (next: PhotoCompare) => void;
}

const cloudChips = (l: Language): Array<{ v: CloudFeedback; label: string }> => [
  { v: 'more', label: L3(l, '실제가 더 많음', 'More clouds', '実際は多い') },
  { v: 'same', label: L3(l, '비슷', 'Similar', '同程度') },
  { v: 'less', label: L3(l, '더 적음', 'Fewer clouds', '実際は少ない') },
];
const colorChips = (l: Language): Array<{ v: ColorFeedback; label: string }> => [
  { v: 'redder', label: L3(l, '더 붉음', 'Redder', 'より赤い') },
  { v: 'same', label: L3(l, '비슷', 'Similar', '同程度') },
  { v: 'weaker', label: L3(l, '덜 붉음', 'Less red', '赤みが弱い') },
];

export const CompareChips: React.FC<Props> = ({ language, value, onChange }) => (
  <View style={styles.wrap}>
    <Text style={styles.label}>{L3(language, '구름 양 (실제 하늘이)', 'CLOUD AMOUNT (REAL SKY)', '雲の量 (実際の空)')}</Text>
    <View style={styles.row}>
      {cloudChips(language).map(c => {
        const on = value?.cloud === c.v;
        return (
          <PressScale key={c.v} style={[styles.chip, on && styles.chipOn]} onPress={() => onChange({ cloud: c.v })} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${L3(language, '구름 양', 'Cloud amount', '雲の量')}: ${c.label}`}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
          </PressScale>
        );
      })}
    </View>
    <Text style={styles.label}>{L3(language, '색 (실제 하늘이)', 'COLOR (REAL SKY)', '色 (実際の空)')}</Text>
    <View style={styles.row}>
      {colorChips(language).map(c => {
        const on = value?.color === c.v;
        return (
          <PressScale key={c.v} style={[styles.chip, on && styles.chipOn]} onPress={() => onChange({ color: c.v })} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${L3(language, '색', 'Color', '色')}: ${c.label}`}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
          </PressScale>
        );
      })}
    </View>
  </View>
);

const styles = StyleSheet.create({
  wrap: { gap: 6, marginTop: 8 },
  label: { fontFamily: mono, fontSize: 9, letterSpacing: 0.8, color: color.textMute },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, backgroundColor: color.fill },
  chipOn: { borderColor: color.accent },
  chipText: { fontSize: 12, fontWeight: '700', color: color.textDim },
  chipTextOn: { color: color.accent },
});
