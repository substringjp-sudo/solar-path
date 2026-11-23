/**
 * ExposureCells.tsx — 카메라 아래 막대 위의 **추천 칸 넷**: 렌즈 · ISO · 셔터 · WB(docs/SANDBOX_MODE_PLAN.md 16절 표 4).
 *
 * 카메라를 조종하지 않는 **추천**입니다(expo-camera 가 사진 모드의 ISO · 셔터 · WB 를 못 정함). 값은 지금 해 고도에서 맑은 하늘 기준으로 어림한 것이라
 * 구름 낀 날은 더 어둡습니다. 삼각대가 필요하거나(천체 탭 권장) 하면 한 줄 알림이 붙습니다. 계산은 `utils/exposureAdvice.ts` · `utils/lensInfo.ts`.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { color, mono, radius } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';
import {
  PHOTO_ISO_CHOICES,
  PHOTO_SHUTTER_CHOICES,
  PHOTO_WB_CHOICES,
  photoWbLabel,
  shutterLabel,
  shutterLevelFor,
  wbLabel,
  type ExposureAdvice,
  type PhotoWbPreset,
} from '../../utils/exposureAdvice';

type ManualTab = 'iso' | 'shutter' | 'wb';

interface Props {
  language: Language;
  advice: ExposureAdvice | null;
  /** "≈ 24 mm" */
  lensMm: string;
  /** "1x" · "5x + 디지털 7.5x" */
  lensText: string;
  /** 렌즈 상자 탭 시 가상 광학 가방 팝업 열기. */
  onPressLens?: () => void;
  /** 장착된 확장 렌즈·필터 요약. */
  gearSummary?: string;
  /** 확장 렌즈/필터가 1개 이상 활성 상태인지. */
  gearActive?: boolean;
  /** 사진 모드 수동 ISO / 셔터 / WB (null 이면 추천값 자동). */
  manualIso?: number | null;
  manualShutterS?: number | null;
  manualWb?: PhotoWbPreset | null;
  onChangeIso?: (iso: number | null) => void;
  onChangeShutter?: (shutterS: number | null) => void;
  onChangeWb?: (wb: PhotoWbPreset | null) => void;
}

export const ExposureCells: React.FC<Props> = ({
  language,
  advice,
  lensMm,
  lensText,
  onPressLens,
  gearSummary,
  gearActive = false,
  manualIso = null,
  manualShutterS = null,
  manualWb = null,
  onChangeIso,
  onChangeShutter,
  onChangeWb,
}) => {
  const [openTab, setOpenTab] = useState<ManualTab | null>(null);
  const lensSub = gearSummary ? `${lensMm} · ${gearSummary}` : lensMm;
  const isoValue = manualIso != null ? String(manualIso) : advice ? String(advice.iso) : '–';
  const shutterValue = manualShutterS != null ? shutterLabel(manualShutterS) : advice ? advice.shutterText : '–';
  const wbActive = manualWb != null && manualWb !== 'auto';
  const wbValue = wbActive ? photoWbLabel(manualWb, language) : advice ? wbLabel(advice.wb, language) : '–';

  const autoTag = L3(language, '추천', 'Auto', '推奨');
  const manualTag = L3(language, '수동', 'Manual', '手動');

  const cells = [
    {
      key: 'lens' as const,
      label: L3(language, '렌즈', 'Lens', 'レンズ'),
      value: lensText,
      sub: lensSub,
      interactive: !!onPressLens,
      active: gearActive,
      onPress: onPressLens,
      testID: 'exposure-cell-lens',
    },
    {
      key: 'iso' as const,
      label: 'ISO',
      value: isoValue,
      sub: onChangeIso ? (manualIso != null ? manualTag : autoTag) : '',
      interactive: !!onChangeIso,
      active: manualIso != null || openTab === 'iso',
      onPress: onChangeIso ? () => setOpenTab(t => (t === 'iso' ? null : 'iso')) : undefined,
      testID: 'exposure-cell-iso',
    },
    {
      key: 'shutter' as const,
      label: L3(language, '셔터', 'Shutter', 'シャッター'),
      value: shutterValue,
      sub: onChangeShutter ? (manualShutterS != null ? manualTag : autoTag) : '',
      interactive: !!onChangeShutter,
      active: manualShutterS != null || openTab === 'shutter',
      onPress: onChangeShutter ? () => setOpenTab(t => (t === 'shutter' ? null : 'shutter')) : undefined,
      testID: 'exposure-cell-shutter',
    },
    {
      key: 'wb' as const,
      label: 'WB',
      value: wbValue,
      sub: onChangeWb ? (wbActive ? manualTag : autoTag) : '',
      interactive: !!onChangeWb,
      active: wbActive || openTab === 'wb',
      onPress: onChangeWb ? () => setOpenTab(t => (t === 'wb' ? null : 'wb')) : undefined,
      testID: 'exposure-cell-wb',
    },
  ];

  const effectiveLevel = manualShutterS != null ? shutterLevelFor(manualShutterS) : advice?.level;
  const note = !effectiveLevel ? '' : effectiveLevel === 'astro'
    ? L3(language, '너무 어두워요 — 천체 탭이나 삼각대로', 'Too dark — use the Astro tab or a tripod', '暗すぎます — 天体タブか三脚で')
    : effectiveLevel === 'tripod'
      ? L3(language, '손으로는 흔들려요 — 삼각대 권장', 'Handheld will blur — use a tripod', '手持ちはブレます — 三脚推奨')
      : '';

  return (
    <View style={styles.wrap} accessibilityLabel={L3(language, '노출 추천 및 수동 설정', 'Exposure advice & manual controls', '露出目安・手動設定')}>
      <View style={styles.row}>
        {cells.map(c => {
          if (c.interactive && c.onPress) {
            return (
              <Pressable
                key={c.key}
                testID={c.testID}
                onPress={c.onPress}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.cell,
                  styles.cellInteractive,
                  c.active && styles.cellActive,
                  pressed && styles.cellPressed,
                ]}
              >
                <View style={styles.labelRow}>
                  <Text style={[styles.label, c.active && styles.labelActive]}>{c.label}</Text>
                  <Text style={[styles.chevron, c.active && styles.labelActive]}>
                    {openTab === c.key ? '▴' : '▾'}
                  </Text>
                </View>
                <Text style={styles.value} numberOfLines={1}>{c.value}</Text>
                {c.sub ? <Text style={[styles.sub, c.active && styles.subActive]} numberOfLines={1}>{c.sub}</Text> : null}
              </Pressable>
            );
          }
          return (
            <View key={c.key} style={styles.cell}>
              <Text style={styles.label}>{c.label}</Text>
              <Text style={styles.value} numberOfLines={1}>{c.value}</Text>
              {c.sub ? <Text style={styles.sub} numberOfLines={1}>{c.sub}</Text> : null}
            </View>
          );
        })}
      </View>

      {openTab === 'iso' && onChangeIso && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
          <Pressable
            testID="iso-choice-auto"
            onPress={() => { onChangeIso(null); setOpenTab(null); }}
            style={[styles.choiceChip, manualIso == null && styles.choiceChipActive]}
          >
            <Text style={[styles.choiceText, manualIso == null && styles.choiceTextActive]}>{autoTag}</Text>
          </Pressable>
          {PHOTO_ISO_CHOICES.map(val => {
            const sel = manualIso === val;
            return (
              <Pressable
                key={val}
                testID={`iso-choice-${val}`}
                onPress={() => onChangeIso(val)}
                style={[styles.choiceChip, sel && styles.choiceChipActive]}
              >
                <Text style={[styles.choiceText, sel && styles.choiceTextActive]}>{val}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {openTab === 'shutter' && onChangeShutter && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
          <Pressable
            testID="shutter-choice-auto"
            onPress={() => { onChangeShutter(null); setOpenTab(null); }}
            style={[styles.choiceChip, manualShutterS == null && styles.choiceChipActive]}
          >
            <Text style={[styles.choiceText, manualShutterS == null && styles.choiceTextActive]}>{autoTag}</Text>
          </Pressable>
          {PHOTO_SHUTTER_CHOICES.map(val => {
            const sel = manualShutterS != null && Math.abs(manualShutterS - val) < 1e-6;
            return (
              <Pressable
                key={val}
                testID={`shutter-choice-${val}`}
                onPress={() => onChangeShutter(val)}
                style={[styles.choiceChip, sel && styles.choiceChipActive]}
              >
                <Text style={[styles.choiceText, sel && styles.choiceTextActive]}>{shutterLabel(val)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {openTab === 'wb' && onChangeWb && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
          {PHOTO_WB_CHOICES.map(val => {
            const sel = (manualWb ?? 'auto') === val;
            return (
              <Pressable
                key={String(val)}
                testID={`wb-choice-${val}`}
                onPress={() => {
                  onChangeWb(val === 'auto' ? null : val);
                  if (val === 'auto') setOpenTab(null);
                }}
                style={[styles.choiceChip, sel && styles.choiceChipActive]}
              >
                <Text style={[styles.choiceText, sel && styles.choiceTextActive]}>{photoWbLabel(val, language)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <Text style={styles.note} numberOfLines={1}>
        {note || (onChangeIso
          ? L3(language, '각 칸을 눌러 렌즈 · ISO · 셔터 · WB 수동 조절', 'Tap cells to adjust Lens · ISO · Shutter · WB', '各欄をタップしてレンズ・ISO・シャッター・WBを調整')
          : onPressLens
            ? L3(language, '렌즈 칸을 눌러 확장 렌즈·필터 장착', 'Tap Lens box for optical mounts & filters', 'レンズ欄をタップして光学レンズ・フィルターを装着')
            : L3(language, '추천 · 맑은 하늘 기준 어림', 'Advice · clear-sky estimate', '目安 · 快晴基準'))}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginBottom: 6, gap: 4 },
  row: { flexDirection: 'row', gap: 6 },
  cell: { flex: 1, minWidth: 0, paddingVertical: 4, paddingHorizontal: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, backgroundColor: color.overlay, alignItems: 'center' },
  cellInteractive: { borderColor: color.borderStrong },
  cellActive: { borderColor: color.accent, backgroundColor: color.accentSoft },
  cellPressed: { opacity: 0.78 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  label: { fontFamily: mono, fontSize: 10, color: color.textDim },
  labelActive: { color: color.accent, fontWeight: '700' },
  chevron: { fontSize: 9, color: color.textDim },
  value: { fontFamily: mono, fontSize: 13, color: color.text },
  sub: { fontFamily: mono, fontSize: 10, color: color.textDim },
  subActive: { color: color.text },
  pickerRow: { flexDirection: 'row', gap: 6, paddingVertical: 3, paddingHorizontal: 2 },
  choiceChip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.overlay,
  },
  choiceChipActive: { borderColor: color.accent, backgroundColor: color.accentSoft },
  choiceText: { fontFamily: mono, fontSize: 11, color: color.textDim },
  choiceTextActive: { color: color.accent, fontWeight: '700' },
  note: { fontFamily: mono, fontSize: 10, color: color.textDim, textAlign: 'center' },
});
