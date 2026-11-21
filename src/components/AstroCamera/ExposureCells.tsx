/**
 * ExposureCells.tsx — 카메라 아래 막대 위의 **추천 칸 넷**: 렌즈 · ISO · 셔터 · WB(docs/SANDBOX_MODE_PLAN.md 16절 표 4).
 *
 * 카메라를 조종하지 않는 **추천**입니다(expo-camera 가 사진 모드의 ISO · 셔터 · WB 를 못 정함). 값은 지금 해 고도에서 맑은 하늘 기준으로 어림한 것이라
 * 구름 낀 날은 더 어둡습니다. 삼각대가 필요하거나(천체 탭 권장) 하면 한 줄 알림이 붙습니다. 계산은 `utils/exposureAdvice.ts` · `utils/lensInfo.ts`.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, mono, radius } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';
import { wbLabel, type ExposureAdvice } from '../../utils/exposureAdvice';

interface Props {
  language: Language;
  advice: ExposureAdvice | null;
  /** "≈ 24 mm" */
  lensMm: string;
  /** "1x" · "5x + 디지털 7.5x" */
  lensText: string;
}

export const ExposureCells: React.FC<Props> = ({ language, advice, lensMm, lensText }) => {
  const cells = [
    { key: 'lens', label: L3(language, '렌즈', 'Lens', 'レンズ'), value: lensText, sub: lensMm },
    { key: 'iso', label: 'ISO', value: advice ? String(advice.iso) : '–', sub: '' },
    { key: 'shutter', label: L3(language, '셔터', 'Shutter', 'シャッター'), value: advice ? advice.shutterText : '–', sub: '' },
    { key: 'wb', label: 'WB', value: advice ? wbLabel(advice.wb, language) : '–', sub: '' },
  ];
  const note = !advice ? '' : advice.level === 'astro'
    ? L3(language, '너무 어두워요 — 천체 탭이나 삼각대로', 'Too dark — use the Astro tab or a tripod', '暗すぎます — 天体タブか三脚で')
    : advice.level === 'tripod'
      ? L3(language, '손으로는 흔들려요 — 삼각대 권장', 'Handheld will blur — use a tripod', '手持ちはブレます — 三脚推奨')
      : '';
  return (
    <View style={styles.wrap} accessibilityLabel={L3(language, '노출 추천', 'Exposure advice', '露出の目安')}>
      <View style={styles.row}>
        {cells.map(c => (
          <View key={c.key} style={styles.cell}>
            <Text style={styles.label}>{c.label}</Text>
            <Text style={styles.value} numberOfLines={1}>{c.value}</Text>
            {c.sub ? <Text style={styles.sub} numberOfLines={1}>{c.sub}</Text> : null}
          </View>
        ))}
      </View>
      <Text style={styles.note} numberOfLines={1}>
        {note || L3(language, '추천 · 맑은 하늘 기준 어림', 'Advice · clear-sky estimate', '目安 · 快晴基準')}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginBottom: 6, gap: 4 },
  row: { flexDirection: 'row', gap: 6 },
  cell: { flex: 1, minWidth: 0, paddingVertical: 4, paddingHorizontal: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, backgroundColor: color.overlay, alignItems: 'center' },
  label: { fontFamily: mono, fontSize: 10, color: color.textDim },
  value: { fontFamily: mono, fontSize: 13, color: color.text },
  sub: { fontFamily: mono, fontSize: 10, color: color.textDim },
  note: { fontFamily: mono, fontSize: 10, color: color.textDim, textAlign: 'center' },
});
