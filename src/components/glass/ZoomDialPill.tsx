/**
 * ZoomDialPill.tsx — 1줄 칩 줄에 들어가는 슬라이드형 배율 다이얼 알약.
 * 가운데 현재 배율 숫자(1.0× ~ 5.0×)와 좌우 눈금을 보여 주며,
 * 좌우로 끌면 연속으로 배율이 바뀌고 가볍게 누르면 1× → 2× → 3× → 5× 순으로 순환합니다.
 */
import React, { useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { CHIP_MIN_H } from './GlassChip';
import { GlassSurface, glassTextShadow } from './GlassSurface';
import { ACTIVE_CHIP_TEXT, TEXT } from '../../theme/glassTokens';
import { mono as monoFont } from '../../theme/tokens';
import { useCelestialStore } from '../../store/useCelestialStore';
import { L3, type Language } from '../../utils/i18n';

interface Props {
  magnification: number;
  onChange: (mag: number) => void;
  language?: Language;
  minMag?: number;
  maxMag?: number;
}

const PRESET_STOPS = [1, 2, 3, 5] as const;
const SIDE_TICKS = [-3, -2, -1, 1, 2, 3] as const;

export const ZoomDialPill: React.FC<Props> = ({
  magnification,
  onChange,
  language = 'ko',
  minMag = 1.0,
  maxMag = 5.0,
}) => {
  const magRef = useRef(magnification);
  magRef.current = magnification;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const startMagRef = useRef(magnification);
  const movedRef = useRef(false);

  const clampMag = (v: number) => Math.max(minMag, Math.min(maxMag, Math.round(v * 10) / 10));

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          startMagRef.current = magRef.current;
          movedRef.current = false;
          useCelestialStore.getState().setGestureBlocked(true);
        },
        onPanResponderMove: (_evt, gs) => {
          if (Math.abs(gs.dx) > 4 || Math.abs(gs.dy) > 4) {
            movedRef.current = true;
          }
          if (Math.abs(gs.dx) <= 2) return;
          // 28px 당 1.0× 변화 (좌우 슬라이드로 1.0× ~ 5.0× 자연스럽게 조절)
          const next = clampMag(startMagRef.current + gs.dx / 28);
          if (Math.abs(next - magRef.current) >= 0.05) {
            onChangeRef.current(next);
          }
        },
        onPanResponderRelease: () => {
          useCelestialStore.getState().setGestureBlocked(false);
          if (!movedRef.current) {
            // 탭하면 1× → 2× → 3× → 5× → 1× 순환
            const cur = magRef.current;
            const nextStop = PRESET_STOPS.find(s => s > cur + 0.15) ?? PRESET_STOPS[0];
            onChangeRef.current(nextStop);
          }
        },
        onPanResponderTerminate: () => {
          useCelestialStore.getState().setGestureBlocked(false);
        },
      }),
    [minMag, maxMag],
  );

  // 배율 변화에 따라 눈금 밝기 위상이 흐르듯 움직이도록 계산
  const phase = ((magnification - minMag) * 5) % 1;
  const isZoomed = magnification > 1.05;

  const renderTick = (offset: number) => {
    const dist = Math.abs(offset - (offset > 0 ? phase : -phase));
    const major = Math.abs(offset) % 2 === 1;
    const alpha = Math.max(0.25, Math.min(0.85, 0.85 - dist * 0.16));
    return (
      <View
        key={offset}
        style={[
          styles.tick,
          major ? styles.tickMajor : styles.tickMinor,
          { opacity: alpha },
        ]}
      />
    );
  };

  return (
    <View
      testID="zoom-dial-pill"
      accessibilityRole="adjustable"
      accessibilityLabel={L3(
        language,
        `배율 ${magnification.toFixed(1)}배 — 좌우로 밀어 조절`,
        `Zoom ${magnification.toFixed(1)}x — slide left or right`,
        `倍率 ${magnification.toFixed(1)}倍 — 左右にスライドして調整`,
      )}
      {...panResponder.panHandlers}
    >
      <GlassSurface active={isZoomed} style={styles.pill}>
        <View style={styles.tickGroup} pointerEvents="none">
          {SIDE_TICKS.filter(t => t < 0).map(renderTick)}
        </View>
        <Text
          numberOfLines={1}
          style={[
            styles.valueText,
            { color: isZoomed ? ACTIVE_CHIP_TEXT : TEXT },
            glassTextShadow,
          ]}
        >
          {`${magnification.toFixed(1)}×`}
        </Text>
        <View style={styles.tickGroup} pointerEvents="none">
          {SIDE_TICKS.filter(t => t > 0).map(renderTick)}
        </View>
      </GlassSurface>
    </View>
  );
};

const styles = StyleSheet.create({
  pill: {
    minHeight: CHIP_MIN_H,
    paddingHorizontal: 10,
    borderRadius: CHIP_MIN_H / 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  tickGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  tick: {
    width: 1.5,
    borderRadius: 1,
    backgroundColor: TEXT,
  },
  tickMajor: {
    height: 10,
  },
  tickMinor: {
    height: 6,
  },
  valueText: {
    fontFamily: monoFont,
    fontSize: 11,
    fontWeight: '600',
    minWidth: 34,
    textAlign: 'center',
  },
});
