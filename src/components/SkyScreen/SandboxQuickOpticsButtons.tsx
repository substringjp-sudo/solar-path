/**
 * SandboxQuickOpticsButtons.tsx — 샌드박스 좌측 상단 세로 원형 빠른 확장 버튼(효과렌즈 · 필터).
 * 위아래로 렌즈/필터 버튼을 배치하고, 누르면 오른쪽 옆으로 작은 원형 아이콘과 짧은 이름만 펼쳐집니다.
 * 세부 설정은 설정 시트에서 조절합니다.
 */
import React, { useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Aperture,
  Contrast,
  Disc,
  Droplets,
  Layers,
  Maximize2,
  MoveHorizontal,
  RotateCcw,
  Shield,
  Sparkles,
  Stars,
  SunDim,
} from 'lucide-react-native';
import { GlassSurface } from '../glass/GlassSurface';
import { MiniFilterRingIcon, MiniLensBarrelIcon } from '../AstroCamera/CameraLensZoomSection';
import { color as DARK, mono } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';
import {
  createDefaultGearBag,
  toggleFrontFilter,
  type CameraGearBagState,
  type FrontFilterId,
  type OpticalLensMount,
} from '../../utils/photoAlgorithms';

type QuickMenu = 'lens' | 'filter' | null;

const EFFECT_LENS_ITEMS: ReadonlyArray<{
  id: OpticalLensMount;
  label: (lang: Language) => string;
  renderIcon: (active: boolean) => React.ReactNode;
}> = [
  {
    id: 'standard',
    label: lang => L3(lang, '표준', 'Std', '標準'),
    renderIcon: a => <Aperture size={14} color={a ? DARK.accent : DARK.text} />,
  },
  {
    id: 'scheimpflug',
    label: lang => L3(lang, '틸트', 'Tilt', 'チルト'),
    renderIcon: a => <Layers size={14} color={a ? DARK.accent : DARK.text} />,
  },
  {
    id: 'dolly',
    label: lang => L3(lang, '원근압축', 'Dolly', '圧縮'),
    renderIcon: a => <Maximize2 size={14} color={a ? DARK.accent : DARK.text} />,
  },
  {
    id: 'anamorphic',
    label: lang => L3(lang, '아나모픽', 'Anamorp', 'アナモル'),
    renderIcon: a => <MoveHorizontal size={14} color={a ? DARK.accent : DARK.text} />,
  },
];

const QUICK_FILTER_ITEMS: ReadonlyArray<{
  id: FrontFilterId;
  label: (lang: Language) => string;
  renderIcon: (active: boolean) => React.ReactNode;
}> = [
  {
    id: 'gnd',
    label: () => 'GND',
    renderIcon: a => <Contrast size={14} color={a ? DARK.accent : DARK.text} />,
  },
  {
    id: 'cpl',
    label: () => 'CPL',
    renderIcon: a => <Disc size={14} color={a ? DARK.accent : DARK.text} />,
  },
  {
    id: 'nd1000',
    label: () => 'ND1000',
    renderIcon: a => <SunDim size={14} color={a ? DARK.accent : DARK.text} />,
  },
  {
    id: 'dehaze',
    label: lang => L3(lang, '연무', 'Dehaze', '霞'),
    renderIcon: a => <Droplets size={14} color={a ? DARK.accent : DARK.text} />,
  },
  {
    id: 'proMist',
    label: () => 'Mist',
    renderIcon: a => <Sparkles size={14} color={a ? DARK.accent : DARK.text} />,
  },
  {
    id: 'astroClear',
    label: lang => L3(lang, '광해컷', 'Astro', '光害'),
    renderIcon: a => <Stars size={14} color={a ? DARK.accent : DARK.text} />,
  },
  {
    id: 'ghostClean',
    label: lang => L3(lang, '고스트', 'Ghost', 'ゴースト'),
    renderIcon: a => <Shield size={14} color={a ? DARK.accent : DARK.text} />,
  },
];

interface Props {
  language: Language;
  top: number;
  left?: number;
  teleX?: number;
  onChangeTeleX?: (x: number) => void;
  gearBag: CameraGearBagState;
  onChangeGearBag: React.Dispatch<React.SetStateAction<CameraGearBagState>>;
  isLowSpec?: boolean;
}

export const SandboxQuickOpticsButtons: React.FC<Props> = ({
  language,
  top,
  left = 12,
  gearBag,
  onChangeGearBag,
  isLowSpec = false,
}) => {
  const [openMenu, setOpenMenu] = useState<QuickMenu>(null);

  const lensActive = !isLowSpec && (gearBag.lensMount !== 'standard' || gearBag.verticalShift);
  const filterActive = gearBag.frontFilters.length > 0 || gearBag.filmBack !== 'natural';
  const expandMaxWidth = Math.max(200, Dimensions.get('window').width - left - 36 - 20);

  return (
    <>
      {openMenu !== null && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setOpenMenu(null)}
          accessibilityLabel={L3(language, '닫기', 'Close', '閉じる')}
        />
      )}

      <View style={[styles.wrap, { top, left }]} pointerEvents="box-none">
        {/* 1행: 효과렌즈 버튼 (위) + 옆으로 작은 원형 아이콘/이름 확장 */}
        {!isLowSpec && (
          <View style={styles.row} pointerEvents="box-none">
            <Pressable
              testID="sb-quick-lens-btn"
              onPress={() => setOpenMenu(m => (m === 'lens' ? null : 'lens'))}
              accessibilityRole="button"
              accessibilityState={{ expanded: openMenu === 'lens' }}
              accessibilityLabel={L3(language, '효과렌즈 빠른 선택', 'Quick effect lens selector', '効果レンズクイック選択')}
              style={styles.circleBtn}
            >
              <GlassSurface active={openMenu === 'lens' || lensActive} style={StyleSheet.absoluteFill} />
              <MiniLensBarrelIcon active={openMenu === 'lens' || lensActive} kind="wide" />
            </Pressable>

            {openMenu === 'lens' && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.expandRow}
                style={{ maxWidth: expandMaxWidth }}
              >
                {lensActive && (
                  <Pressable
                    onPress={() => onChangeGearBag(s => ({ ...s, lensMount: 'standard', verticalShift: false }))}
                    accessibilityRole="button"
                    accessibilityLabel={L3(language, '초기화', 'Reset', 'リセット')}
                    style={styles.itemCol}
                  >
                    <View style={styles.miniCircleBtn}>
                      <GlassSurface blurred style={StyleSheet.absoluteFill} />
                      <RotateCcw size={13} color={DARK.textDim} />
                    </View>
                    <Text style={styles.itemLabel} numberOfLines={1}>
                      {L3(language, '초기화', 'Reset', '戻す')}
                    </Text>
                  </Pressable>
                )}
                {EFFECT_LENS_ITEMS.map(item => {
                  const active = gearBag.lensMount === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => onChangeGearBag(s => ({ ...s, lensMount: item.id }))}
                      accessibilityRole="button"
                      accessibilityLabel={item.label(language)}
                      style={styles.itemCol}
                    >
                      <View style={styles.miniCircleBtn}>
                        <GlassSurface active={active} blurred style={StyleSheet.absoluteFill} />
                        {item.renderIcon(active)}
                      </View>
                      <Text style={[styles.itemLabel, active && styles.itemLabelActive]} numberOfLines={1}>
                        {item.label(language)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>
        )}

        {/* 2행: 필터 버튼 (아래) + 옆으로 작은 원형 아이콘/이름 확장 */}
        <View style={styles.row} pointerEvents="box-none">
          <Pressable
            testID="sb-quick-filter-btn"
            onPress={() => setOpenMenu(m => (m === 'filter' ? null : 'filter'))}
            accessibilityRole="button"
            accessibilityState={{ expanded: openMenu === 'filter' }}
            accessibilityLabel={L3(language, '필터 빠른 선택', 'Quick filter selector', 'フィルタークイック選択')}
            style={styles.circleBtn}
          >
            <GlassSurface active={openMenu === 'filter' || filterActive} style={StyleSheet.absoluteFill} />
            <MiniFilterRingIcon active={openMenu === 'filter' || filterActive} />
            {gearBag.frontFilters.length > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{gearBag.frontFilters.length}</Text>
              </View>
            )}
          </Pressable>

          {openMenu === 'filter' && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.expandRow}
              style={{ maxWidth: expandMaxWidth }}
            >
              {filterActive && (
                <Pressable
                  onPress={() => onChangeGearBag(createDefaultGearBag())}
                  accessibilityRole="button"
                  accessibilityLabel={L3(language, '초기화', 'Reset', 'リセット')}
                  style={styles.itemCol}
                >
                  <View style={styles.miniCircleBtn}>
                    <GlassSurface blurred style={StyleSheet.absoluteFill} />
                    <RotateCcw size={13} color={DARK.textDim} />
                  </View>
                  <Text style={styles.itemLabel} numberOfLines={1}>
                    {L3(language, '초기화', 'Reset', '戻す')}
                  </Text>
                </Pressable>
              )}
              {QUICK_FILTER_ITEMS.map(f => {
                const active = gearBag.frontFilters.includes(f.id);
                return (
                  <Pressable
                    key={f.id}
                    onPress={() => onChangeGearBag(s => toggleFrontFilter(s, f.id))}
                    accessibilityRole="button"
                    accessibilityLabel={f.label(language)}
                    style={styles.itemCol}
                  >
                    <View style={styles.miniCircleBtn}>
                      <GlassSurface active={active} blurred style={StyleSheet.absoluteFill} />
                      {f.renderIcon(active)}
                    </View>
                    <Text style={[styles.itemLabel, active && styles.itemLabelActive]} numberOfLines={1}>
                      {f.label(language)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    zIndex: 27,
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  circleBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingRight: 12,
  },
  itemCol: {
    alignItems: 'center',
    gap: 3,
    minWidth: 34,
  },
  miniCircleBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLabel: {
    fontFamily: mono,
    fontSize: 9,
    fontWeight: '600',
    color: DARK.textDim,
    textAlign: 'center',
  },
  itemLabelActive: {
    color: DARK.accent,
    fontWeight: '800',
  },
  countBadge: {
    position: 'absolute',
    top: 3,
    right: 3,
    minWidth: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: DARK.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  countBadgeText: {
    fontFamily: mono,
    fontSize: 8.5,
    fontWeight: '800',
    color: DARK.onAccent,
  },
});
