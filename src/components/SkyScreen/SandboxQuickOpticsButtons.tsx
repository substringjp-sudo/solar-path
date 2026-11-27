/**
 * SandboxQuickOpticsButtons.tsx — 샌드박스 우측 상단 원형 빠른 확장 버튼(렌즈 · 필터).
 * 설정 시트를 열지 않고도 하늘 화면 위에서 화각·렌즈 마운트·광학 필터·필름 백을 즉시 전환할 수 있습니다.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RotateCcw, X } from 'lucide-react-native';
import { GlassChip } from '../glass/GlassChip';
import { GlassSurface } from '../glass/GlassSurface';
import { MiniFilterRingIcon, MiniLensBarrelIcon, type LensKind } from '../AstroCamera/CameraLensZoomSection';
import { color as DARK, mono } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';
import {
  createDefaultGearBag,
  filmBackShortLabel,
  frontFilterShortLabel,
  hasActiveOpticalGear,
  lensMountShortLabel,
  toggleFrontFilter,
  type CameraGearBagState,
  type FilmBackMode,
  type FrontFilterId,
  type OpticalLensMount,
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

interface Props {
  language: Language;
  top: number;
  right?: number;
  teleX: number;
  onChangeTeleX: (x: number) => void;
  gearBag: CameraGearBagState;
  onChangeGearBag: React.Dispatch<React.SetStateAction<CameraGearBagState>>;
  isLowSpec?: boolean;
}

export const SandboxQuickOpticsButtons: React.FC<Props> = ({
  language,
  top,
  right = 12,
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

      <View style={[styles.wrap, { top, right }]} pointerEvents="box-none">
        {/* 우측 상단 작은 원형 확장 버튼 2개 */}
        <View style={styles.btnRow} pointerEvents="box-none">
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
        </View>

        {/* 확장 팝오버: 렌즈 */}
        {openMenu === 'lens' && (
          <GlassSurface blurred style={styles.popover}>
            <View style={styles.popHeader}>
              <Text style={styles.popTitle}>
                {L3(language, '렌즈 · 화각', 'LENS · FOCAL', 'レンズ・画角')}
              </Text>
              <View style={styles.popHeaderActions}>
                {lensActive && (
                  <Pressable
                    onPress={() => {
                      onChangeTeleX(1);
                      onChangeGearBag(s => ({ ...s, lensMount: 'standard', verticalShift: false }));
                    }}
                    hitSlop={6}
                    style={styles.iconBtn}
                    accessibilityLabel={L3(language, '렌즈 초기화', 'Reset lens', 'レンズリセット')}
                  >
                    <RotateCcw size={12} color={DARK.textDim} />
                  </Pressable>
                )}
                <Pressable onPress={() => setOpenMenu(null)} hitSlop={6} style={styles.iconBtn}>
                  <X size={13} color={DARK.textDim} />
                </Pressable>
              </View>
            </View>

            <Text style={styles.subLabel}>{L3(language, '화각 프리셋', 'FOCAL LENGTH', '焦点距離')}</Text>
            <View style={styles.chipRow}>
              {QUICK_LENS_PRESETS.map(p => (
                <GlassChip
                  key={p.mm}
                  label={p.mm}
                  mono
                  active={Math.abs(teleX - p.zoom) < 0.08}
                  onPress={() => onChangeTeleX(p.zoom)}
                />
              ))}
            </View>

            {!isLowSpec && (
              <>
                <Text style={styles.subLabel}>{L3(language, '광학 마운트', 'OPTICAL MOUNT', '光学マウント')}</Text>
                <View style={styles.chipRow}>
                  {(['standard', 'scheimpflug', 'dolly', 'anamorphic'] as OpticalLensMount[]).map(m => (
                    <GlassChip
                      key={m}
                      label={lensMountShortLabel(m, language)}
                      active={gearBag.lensMount === m}
                      onPress={() => onChangeGearBag(s => ({ ...s, lensMount: m }))}
                    />
                  ))}
                </View>

                {gearBag.lensMount === 'scheimpflug' && (
                  <View style={styles.tuneRow}>
                    {[300, 800, 1200, 2500, 5000].map(dist => (
                      <GlassChip
                        key={dist}
                        label={dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${dist}m`}
                        mono
                        active={gearBag.focusDistM === dist}
                        onPress={() => onChangeGearBag(s => ({ ...s, focusDistM: dist }))}
                      />
                    ))}
                    {([1.4, 2.0, 2.8, 4.0] as const).map(f => (
                      <GlassChip
                        key={f}
                        label={`f/${f}`}
                        mono
                        active={gearBag.apertureF === f}
                        onPress={() => onChangeGearBag(s => ({ ...s, apertureF: f }))}
                      />
                    ))}
                  </View>
                )}

                {gearBag.lensMount === 'dolly' && (
                  <View style={styles.tuneRow}>
                    {[1.25, 1.55, 1.85, 2.2].map(z => (
                      <GlassChip
                        key={z}
                        label={`${z.toFixed(2)}×`}
                        mono
                        active={Math.abs(gearBag.dollyFarZoom - z) < 0.05}
                        onPress={() => onChangeGearBag(s => ({ ...s, dollyFarZoom: z }))}
                      />
                    ))}
                  </View>
                )}

                {gearBag.lensMount === 'anamorphic' && (
                  <View style={styles.tuneRow}>
                    {([6, 8, 10] as const).map(b => (
                      <GlassChip
                        key={b}
                        label={`${b}${L3(language, '갈래', '-ray', '本')}`}
                        mono
                        active={gearBag.sunstarBlades === b}
                        onPress={() => onChangeGearBag(s => ({ ...s, sunstarBlades: b }))}
                      />
                    ))}
                  </View>
                )}
              </>
            )}
          </GlassSurface>
        )}

        {/* 확장 팝오버: 필터 & 필름 */}
        {openMenu === 'filter' && (
          <GlassSurface blurred style={styles.popover}>
            <View style={styles.popHeader}>
              <Text style={styles.popTitle}>
                {L3(
                  language,
                  `필터 (${gearBag.frontFilters.length}/2) · 필름`,
                  `FILTERS (${gearBag.frontFilters.length}/2) · FILM`,
                  `フィルター (${gearBag.frontFilters.length}/2) · フィルム`,
                )}
              </Text>
              <View style={styles.popHeaderActions}>
                {hasActiveOpticalGear(gearBag) && (
                  <Pressable
                    onPress={() => onChangeGearBag(createDefaultGearBag())}
                    hitSlop={6}
                    style={styles.iconBtn}
                    accessibilityLabel={L3(language, '필터 초기화', 'Reset filters', 'フィルターリセット')}
                  >
                    <RotateCcw size={12} color={DARK.textDim} />
                  </Pressable>
                )}
                <Pressable onPress={() => setOpenMenu(null)} hitSlop={6} style={styles.iconBtn}>
                  <X size={13} color={DARK.textDim} />
                </Pressable>
              </View>
            </View>

            <ScrollView style={styles.popScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              <Text style={styles.subLabel}>{L3(language, '원형 필터', 'OPTICAL FILTERS', '円形フィルター')}</Text>
              <View style={styles.chipRow}>
                {(['gnd', 'cpl', 'nd1000', 'dehaze', 'proMist', 'astroClear', 'ghostClean'] as FrontFilterId[]).map(fid => (
                  <GlassChip
                    key={fid}
                    label={frontFilterShortLabel(fid, language)}
                    active={gearBag.frontFilters.includes(fid)}
                    onPress={() => onChangeGearBag(s => toggleFrontFilter(s, fid))}
                  />
                ))}
              </View>

              {gearBag.frontFilters.includes('gnd') && (
                <View style={styles.tuneRow}>
                  <GlassChip
                    label={L3(language, '리버스', 'Reverse', 'リバース')}
                    active={gearBag.gndMode === 'reverse'}
                    onPress={() => onChangeGearBag(s => ({ ...s, gndMode: 'reverse' }))}
                  />
                  <GlassChip
                    label={L3(language, '표준', 'Standard', '標準')}
                    active={gearBag.gndMode === 'standard'}
                    onPress={() => onChangeGearBag(s => ({ ...s, gndMode: 'standard' }))}
                  />
                  {[1.0, 1.8, 2.5, 3.5].map(ev => (
                    <GlassChip
                      key={ev}
                      label={`-${ev.toFixed(1)}EV`}
                      mono
                      active={Math.abs(gearBag.gndStops - ev) < 0.15}
                      onPress={() => onChangeGearBag(s => ({ ...s, gndStops: ev }))}
                    />
                  ))}
                </View>
              )}

              {gearBag.frontFilters.includes('cpl') && (
                <View style={styles.tuneRow}>
                  {[0.4, 0.78, 1.0].map(v => (
                    <GlassChip
                      key={v}
                      label={`CPL ${Math.round(v * 100)}%`}
                      mono
                      active={Math.abs(gearBag.cplStrength - v) < 0.12}
                      onPress={() => onChangeGearBag(s => ({ ...s, cplStrength: v }))}
                    />
                  ))}
                </View>
              )}

              {gearBag.frontFilters.includes('nd1000') && (
                <View style={styles.tuneRow}>
                  {[6, 12, 20, 30, 60].map(sec => (
                    <GlassChip
                      key={sec}
                      label={`ND ${sec}s`}
                      mono
                      active={gearBag.ndDurationSec === sec}
                      onPress={() => onChangeGearBag(s => ({ ...s, ndDurationSec: sec }))}
                    />
                  ))}
                </View>
              )}

              {gearBag.frontFilters.includes('dehaze') && (
                <View style={styles.tuneRow}>
                  {[
                    { v: -0.8, label: L3(language, '산수화', 'Ink', '山水') },
                    { v: -0.4, label: L3(language, '안개', 'Mist', '薄霞') },
                    { v: 0.55, label: 'Dehaze' },
                    { v: 0.95, label: 'Clear+' },
                  ].map(p => (
                    <GlassChip
                      key={p.v}
                      label={p.label}
                      active={Math.abs(gearBag.dehazeStrength - p.v) < 0.12}
                      onPress={() => onChangeGearBag(s => ({ ...s, dehazeStrength: p.v }))}
                    />
                  ))}
                </View>
              )}

              {gearBag.frontFilters.includes('proMist') && (
                <View style={styles.tuneRow}>
                  {([0.125, 0.25, 0.5, 1] as const).map(gr => (
                    <GlassChip
                      key={gr}
                      label={gr === 1 ? 'ProMist 1' : `1/${Math.round(1 / gr)}`}
                      mono
                      active={gearBag.proMistGrade === gr}
                      onPress={() => onChangeGearBag(s => ({ ...s, proMistGrade: gr }))}
                    />
                  ))}
                </View>
              )}

              <Text style={styles.subLabel}>{L3(language, '필름 · 센서 백', 'FILM BACK', 'フィルム')}</Text>
              <View style={styles.chipRow}>
                {(['natural', 'sunsetWb', 'monoZone'] as FilmBackMode[]).map(fb => (
                  <GlassChip
                    key={fb}
                    label={filmBackShortLabel(fb, language)}
                    active={gearBag.filmBack === fb}
                    onPress={() => onChangeGearBag(s => ({ ...s, filmBack: fb }))}
                  />
                ))}
              </View>
            </ScrollView>
          </GlassSurface>
        )}
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    zIndex: 27,
    alignItems: 'flex-end',
    gap: 8,
  },
  btnRow: {
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
  popover: {
    width: 268,
    maxHeight: 320,
    borderRadius: 14,
    padding: 10,
    gap: 6,
  },
  popHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  popTitle: {
    fontFamily: mono,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: DARK.textDim,
  },
  popHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    padding: 2,
  },
  popScroll: {
    maxHeight: 268,
  },
  subLabel: {
    fontFamily: mono,
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: DARK.textDim,
    marginTop: 6,
    marginBottom: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  tuneRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148,163,184,0.22)',
  },
});
