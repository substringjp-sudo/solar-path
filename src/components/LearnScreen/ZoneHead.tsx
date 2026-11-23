/**
 * ZoneHead.tsx — 학습 페이지 구역 머리표(목업의 "지금 / 앞으로 24시간 / 앞으로 16일 / 원리 / 근거 데이터").
 *
 * 구역마다 배지 채움·점선·색을 달리해 스크롤 중에도 "지금 · 단기 · 장기 · 원리 · 원본" 층이 즉시 구분됩니다.
 */
import React from 'react';
import { Text, View } from 'react-native';
import type { Language } from '../../utils/i18n';
import { zoneBadge, zoneRange, type ZoneKey } from '../../utils/learnSections';
import { radius, space, type } from '../../theme/tokens';
import { makeStyles, useDataColors, useThemeColors } from '../../theme/useTheme';

export const ZoneHead: React.FC<{ zone: ZoneKey; language: Language }> = ({ zone, language }) => {
  const color = useThemeColors();
  const dataColor = useDataColors();
  const styles = useStyles();

  const spec = (() => {
    switch (zone) {
      case 'today':
        return { bg: color.accent, fg: color.onAccent, bd: color.accent, dashed: false };
      case 'hours':
        return { bg: color.glowSoft, fg: dataColor.sunrise, bd: dataColor.sunrise, dashed: true };
      case 'forecast':
        return { bg: color.fill, fg: color.moon, bd: color.moon, dashed: true };
      case 'why':
        return { bg: color.fill, fg: color.success, bd: color.success, dashed: false };
      default:
        return { bg: color.fill, fg: color.textDim, bd: color.borderStrong, dashed: false };
    }
  })();

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.pill,
          {
            backgroundColor: spec.bg,
            borderColor: spec.bd,
            borderStyle: spec.dashed ? 'dashed' : 'solid',
          },
        ]}
      >
        <Text style={[styles.pillText, { color: spec.fg }]}>{zoneBadge(zone, language)}</Text>
      </View>
      <Text style={styles.range}>{zoneRange(zone, language)}</Text>
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1.5 },
  pillText: { ...type.label, fontWeight: '700' },
  range: { ...type.label, color: color.textMute },
}));
