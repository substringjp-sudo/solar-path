/**
 * ValueDialStrip.tsx — 촬영 시간 · 동영상 길이 · 총 노출 · 서브셔터 · EV 등을
 * 좌우 스크롤/드래그로 부드럽게 조절하는 카메라 다이얼 스트립.
 *
 * 특징:
 * - 좌우로 드래그(스크롤)하면 눈금이 흐르며 연속 스텝 값을 부드럽게 바꿉니다.
 * - 세로 드래그(|dy| > |dx|)는 즉시 부모 세로 ScrollView로 양보해 페이지 상하 스크롤과 절대 충돌하지 않습니다.
 * - 눈금 위 주요 프리셋 칩을 탭하면 해당 값으로 즉시 이동합니다.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { GlassSurface, glassTextShadow } from './GlassSurface';
import { ACTIVE_CHIP_TEXT, GLASS, TEXT } from '../../theme/glassTokens';
import { color as DARK, mono } from '../../theme/tokens';

export interface DialOption<T extends number | string> {
  value: T;
  label: string;
  testID?: string;
  disabled?: boolean;
  major?: boolean;
}

interface Props<T extends number | string> {
  label?: string;
  valueText?: string;
  options: readonly DialOption<T>[];
  selectedValue: T;
  onSelect: (value: T) => void;
  isSelected?: (optionValue: T, selectedValue: T) => boolean;
  testID?: string;
  /** 좌측 고정 액션 칩 (예: 'NPF 자동' 토글) */
  leadingChip?: React.ReactNode;
}

const ITEM_MIN_W = 58;
const ITEM_GAP = 6;
const ITEM_STRIDE = ITEM_MIN_W + ITEM_GAP;

export function ValueDialStrip<T extends number | string>({
  label,
  valueText,
  options,
  selectedValue,
  onSelect,
  isSelected,
  testID,
  leadingChip,
}: Props<T>) {
  const scrollRef = useRef<ScrollView>(null);
  const isUserScrollingRef = useRef(false);
  const lastEmittedIdxRef = useRef<number>(-1);

  const checkSelected = useCallback(
    (optVal: T) => {
      if (isSelected) return isSelected(optVal, selectedValue);
      if (typeof optVal === 'number' && typeof selectedValue === 'number') {
        return Math.abs(optVal - selectedValue) < 1e-4;
      }
      return optVal === selectedValue;
    },
    [isSelected, selectedValue],
  );

  const activeIdx = options.findIndex(o => checkSelected(o.value));

  // 외부에서 값이 바뀌면 해당 칩이 가운데 근처에 오도록 스크롤 정렬
  useEffect(() => {
    if (isUserScrollingRef.current || activeIdx < 0) return;
    lastEmittedIdxRef.current = activeIdx;
  }, [activeIdx]);

  // 스크롤 중에만 중앙 눈금 기준으로 값을 연속 변경할지, 혹은 가로 스크롤 + 탭 + 드래그 스냅을 동시에 지원할지:
  // 가로 ScrollView의 onScroll에서 스크롤 오프셋에 따라 자연스럽게 값을 업데이트하면
  // 손가락으로 밀어서(스크롤로) 값을 바꾸는 카메라 다이얼 감각과 탭 선택이 모두 동작합니다.
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!isUserScrollingRef.current) return;
      const x = e.nativeEvent.contentOffset.x;
      const viewW = e.nativeEvent.layoutMeasurement.width;
      const contentW = e.nativeEvent.contentSize.width;
      const maxScroll = Math.max(1, contentW - viewW);
      if (maxScroll <= 12 || options.length <= 1) return;
      const ratio = Math.max(0, Math.min(1, x / maxScroll));
      const idx = Math.min(options.length - 1, Math.max(0, Math.round(ratio * (options.length - 1))));
      if (idx !== lastEmittedIdxRef.current && !options[idx]?.disabled) {
        lastEmittedIdxRef.current = idx;
        onSelect(options[idx].value);
      }
    },
    [options, onSelect],
  );

  return (
    <View testID={testID} style={styles.wrap}>
      {(label || valueText) ? (
        <View style={styles.headerRow}>
          {label ? <Text style={styles.label}>{label}</Text> : <View />}
          {valueText ? <Text style={styles.valueBadge}>{valueText}</Text> : null}
        </View>
      ) : null}

      <GlassSurface style={styles.trackSurface}>
        <View style={styles.trackRow}>
          {leadingChip ? <View style={styles.leadingWrap}>{leadingChip}</View> : null}
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
            directionalLockEnabled
            scrollEventThrottle={16}
            decelerationRate="fast"
            onScrollBeginDrag={() => {
              isUserScrollingRef.current = true;
            }}
            onScroll={handleScroll}
            onScrollEndDrag={() => {
              isUserScrollingRef.current = false;
            }}
            onMomentumScrollEnd={() => {
              isUserScrollingRef.current = false;
            }}
            contentContainerStyle={styles.scrollContent}
          >
            {options.map((opt, idx) => {
              const active = idx === activeIdx;
              return (
                <Pressable
                  key={String(opt.value)}
                  testID={opt.testID}
                  disabled={opt.disabled}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, disabled: opt.disabled }}
                  accessibilityLabel={opt.label}
                  onPress={() => {
                    isUserScrollingRef.current = false;
                    lastEmittedIdxRef.current = idx;
                    onSelect(opt.value);
                  }}
                  style={[
                    styles.item,
                    active && styles.itemActive,
                    opt.disabled && styles.itemDisabled,
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.itemText,
                      active && styles.itemTextActive,
                      glassTextShadow,
                    ]}
                  >
                    {opt.label}
                  </Text>
                  <View style={styles.tickRow} pointerEvents="none">
                    <View
                      style={[
                        styles.tick,
                        (opt.major ?? idx % 2 === 0) ? styles.tickMajor : styles.tickMinor,
                        active && styles.tickActive,
                      ]}
                    />
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  label: {
    fontFamily: mono,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: TEXT,
    opacity: 0.75,
    ...glassTextShadow,
  },
  valueBadge: {
    fontFamily: mono,
    fontSize: 11.5,
    fontWeight: '700',
    color: DARK.accent,
    ...glassTextShadow,
  },
  trackSurface: {
    borderRadius: 12,
    paddingVertical: 4,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leadingWrap: {
    paddingLeft: 6,
    paddingRight: 4,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(255,255,255,0.14)',
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: ITEM_GAP,
  },
  item: {
    minWidth: ITEM_MIN_W,
    paddingHorizontal: 9,
    paddingTop: 5,
    paddingBottom: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  itemActive: {
    borderColor: 'rgba(56, 189, 248, 0.65)',
    backgroundColor: `rgba(${GLASS.tintRGB.join(', ')}, ${GLASS.tintAlpha * 0.85})`,
  },
  itemDisabled: {
    opacity: 0.38,
  },
  itemText: {
    fontFamily: mono,
    fontSize: 11.5,
    fontWeight: '600',
    color: TEXT,
    opacity: 0.78,
  },
  itemTextActive: {
    color: ACTIVE_CHIP_TEXT,
    fontWeight: '700',
    opacity: 1,
  },
  tickRow: {
    height: 6,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  tick: {
    width: 1.5,
    borderRadius: 1,
    backgroundColor: 'rgba(241, 245, 249, 0.35)',
  },
  tickMajor: {
    height: 5,
  },
  tickMinor: {
    height: 3,
  },
  tickActive: {
    height: 6,
    width: 2,
    backgroundColor: DARK.accent,
  },
});
