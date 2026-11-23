/**
 * ZoneHead.tsx — 학습 페이지 구역 머리표(목업의 "지금 / 24시간 / 16일 / 원리").
 * 이름표(알약)와 범위 글 한 줄만 둡니다. 구역마다 알약 색을 달리해 "지금의 해석 · 이후 예보 · 원리"가 한눈에 갈리게 하되,
 * 색만으로 구분하지 않도록 글자(이름표)가 항상 함께 있습니다.
 */
import React from 'react';
import { Text, View } from 'react-native';
import type { Language } from '../../utils/i18n';
import { zoneBadge, zoneRange, type ZoneKey } from '../../utils/learnSections';
import { radius, space, type } from '../../theme/tokens';
import { makeStyles, useThemeColors } from '../../theme/useTheme';

export const ZoneHead: React.FC<{ zone: ZoneKey; language: Language }> = ({ zone, language }) => {
  const color = useThemeColors(); const styles = useStyles();
  const tone = zone === 'today' ? color.accent : zone === 'hours' || zone === 'forecast' ? color.sun : zone === 'why' ? color.moon : color.textDim;
  return (
    <View style={styles.row}>
      <View style={[styles.pill, { borderColor: tone }]}><Text style={[styles.pillText, { color: tone }]}>{zoneBadge(zone, language)}</Text></View>
      <Text style={styles.range}>{zoneRange(zone, language)}</Text>
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  pill: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1.5 },
  pillText: { ...type.label, fontWeight: '700' },
  range: { ...type.label, color: color.textMute },
}));
