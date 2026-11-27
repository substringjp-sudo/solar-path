/**
 * SandboxQuickOpticsButtons.tsx — 샌드박스 좌측 상단 세로 원형 빠른 확장 버튼(렌즈 · 필터).
 * 위아래로 렌즈/필터 버튼을 배치하고, 누르면 오른쪽 옆으로 작은 원형 아이콘 버튼만 펼쳐집니다.
 * 세부 설정은 설정 시트에서 조절합니다.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Contrast,
  Disc,
  Droplets,
  RotateCcw,
  Shield,
  Sparkles,
  Stars,
  SunDim,
} from 'lucide-react-native';
import { GlassSurface } from '../glass/GlassSurface';
import { MiniFilterRingIcon, MiniLensBarrelIcon, type LensKind } from '../AstroCamera/CameraLensZoomSection';
import { color as DARK, mono } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';
import {
  createDefaultGearBag,
  toggleFrontFilter,
  type CameraGearBagState,
  type FrontFilterId,
} from '../../utils/photoAlgorithms';

type QuickMenu = 'lens' | 'filter' | null;

const QUICK_LENS_PRESETS: ReadonlyArray<{ zoom: number; mm: string; kind: LensKind }> = [
  { zoom: 0.6, mm: '14mm', kind: 'ultrawide' },
  { zoom: 1, mm: '24mm', kind: 'wide' },
  { zoom: 1.5, mm: '35mm', kind: 'wide' },
  { zoom: 2, mm: '48mm', kind: 'wide' },
  { zoom: 3, mm: '70mm', kind: 'tele' },
  { zoom: 5, mm: '120mm', kind: 'tele' },
  { zoom: 10, mm: '240mm', kind: 'supertele' },
];

const QUICK_FILTER_ICONS: ReadonlyArray<{
  id: FrontFilterId;
  renderIcon: (active: boolean) => React.ReactNode;
}> = [
  { id: 'gnd', renderIcon: a => <Contrast size={14} color={a ? DARK.accent : DARK.text} /> },
  { id: 'cpl', renderIcon: a => <Disc size={14} color={a ? DARK.accent : DARK.text} /> },
  { id: 'nd1000', renderIcon: a => <SunDim size={14} color={a ? DARK.accent : DARK.text} /> },
  { id: 'dehaze', renderIcon: a => <Droplets size={14} color={a ? DARK.accent : DARK.text} /> },
  { id: 'proMist', renderIcon: a => <Sparkles size={14} color={a ? DARK.accent : DARK.text} /> },
  { id: 'astroClear', renderIcon: a => <Stars size={14} color={a ? DARK.accent : DARK.text} /> },
  { id: 'ghostClean', renderIcon: a => <Shield size={14} color={a ? DARK.accent : DARK.text} /> },
];

interface Props {
  language: Language;
  top: number;
  left?: number;
  teleX: number;
  onChangeTeleX: (x: number) => void;
  gearBag: CameraGearBagState;
  onChangeGearBag: React.Dispatch<React.SetStateAction<CameraGearBagState>>;
  isLowSpec?: boolean;
}

export const SandboxQuickOpticsButtons: React.FC<Props> = ({
  language,
  top,
  left = 12,
  teleX,
  onChangeTeleX,
  gearBag,
  onChangeGearBag,
  isLowSpec = false,
}) => {
  const [openMenu, setOpenMenu] = useState<QuickMenu>(null);

  const lensActive = (!isLowSpec && (gearBag.lensMount !== 'standard' || gearBag.verticalShift)) || Math.abs(teleX - 1) >= 0.08;
  const filterActive = gearBag.frontFilters.length > 0 || gearBag.filmBack !== 'natural';

  const currentZoomPreset = QUICK_LENS_PRESETS.reduce((best, p) =>
    Math.abs(p.zoom - teleX) < Math.abs(best.zoom - teleX) ? p : best,
  );

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
        {/* 1행: 렌즈 버튼 (위) + 옆으로 작은 원형 아이콘 확장 */}
        <View style={styles.row} pointerEvents="box-none">
          <Pressable
            testID="sb-quick-lens-btn"
            onPress={() => setOpenMenu(m => (m === 'lens' ? null : 'lens'))}
            accessibilityRole="button"
            accessibilityState={{ expanded: openMenu === 'lens' }}
            accessibilityLabel={L3(language, '렌즈 빠른 선택', 'Quick lens selector', 'レンズクイック選択')}
            style={styles.circleBtn}
          >
            <GlassSurface active={openMenu === 'lens' || lensActive} style={StyleSheet.absoluteFill} />
            <MiniLensBarrelIcon active={openMenu === 'lens' || lensActive} kind={currentZoomPreset.kind} />
          </Pressable>

          {openMenu === 'lens' && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.expandRow}
              style={styles.expandScroll}
            >
              {QUICK_LENS_PRESETS.map(p => {
                const active = Math.abs(teleX - p.zoom) < 0.08;
                return (
                  <Pressable
                    key={p.mm}
                    onPress={() => onChangeTeleX(p.zoom)}
                    accessibilityRole="button"
                    accessibilityLabel={p.mm}
                    style={styles.miniCircleBtn}
                  >
                    <GlassSurface active={active} blurred style={StyleSheet.absoluteFill} />
                    <MiniLensBarrelIcon active={active} kind={p.kind} />
                  </Pressable>
                );
              })}
              {lensActive && (
                <Pressable
                  onPress={() => {
                    onChangeTeleX(1);
                    onChangeGearBag(s => ({ ...s, lensMount: 'standard', verticalShift: false }));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={L3(language, '렌즈 초기화', 'Reset lens', 'レンズリセット')}
                  style={styles.miniCircleBtn}
                >
                  <GlassSurface blurred style={StyleSheet.absoluteFill} />
                  <RotateCcw size={13} color={DARK.textDim} />
                </Pressable>
              )}
            </ScrollView>
          )}
        </View>

        {/* 2행: 필터 버튼 (아래) + 옆으로 작은 원형 아이콘 확장 */}
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
              style={styles.expandScroll}
            >
              {QUICK_FILTER_ICONS.map(f => {
                const active = gearBag.frontFilters.includes(f.id);
                return (
                  <Pressable
                    key={f.id}
                    onPress={() => onChangeGearBag(s => toggleFrontFilter(s, f.id))}
                    accessibilityRole="button"
                    accessibilityLabel={f.id}
                    style={styles.miniCircleBtn}
                  >
                    <GlassSurface active={active} blurred style={StyleSheet.absoluteFill} />
                    {f.renderIcon(active)}
                  </Pressable>
                );
              })}
              {filterActive && (
                <Pressable
                  onPress={() => onChangeGearBag(createDefaultGearBag())}
                  accessibilityRole="button"
                  accessibilityLabel={L3(language, '필터 초기화', 'Reset filters', 'フィルターリセット')}
                  style={styles.miniCircleBtn}
                >
                  <GlassSurface blurred style={StyleSheet.absoluteFill} />
                  <RotateCcw size={13} color={DARK.textDim} />
                </Pressable>
              )}
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
    maxWidth: '92%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
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
  expandScroll: {
    maxWidth: 280,
  },
  expandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 4,
  },
  miniCircleBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
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
