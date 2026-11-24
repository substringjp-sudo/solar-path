/**
 * CornerExposureBadge.tsx — 사진 · 샌드박스 우측 상단 수동 노출/설정 숫자 배지.
 * 기본값에서 변경된 값이 있을 때만 표시되며, 배지 위에서 위아래로 슬라이드해 EV 를 조절할 수 있습니다.
 */
import React, { useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { color, mono, radius } from '../../theme/tokens';
import { type Language } from '../../utils/i18n';
import { photoWbLabel, shutterLabel, type PhotoWbPreset } from '../../utils/exposureAdvice';

interface Props {
  language: Language;
  exposure: number;
  onExposureChange: (next: number) => void;
  manualIso?: number | null;
  manualShutterS?: number | null;
  manualWb?: PhotoWbPreset | null;
  /** true 이면 EV 대신 % 부스트로 표시 (천체 탭 호환) */
  percentMode?: boolean;
  top?: number;
  right?: number;
}

export const CornerExposureBadge: React.FC<Props> = ({
  language,
  exposure,
  onExposureChange,
  manualIso = null,
  manualShutterS = null,
  manualWb = null,
  percentMode = false,
  top = 12,
  right = 12,
}) => {
  const hasEv = Math.abs(exposure) >= 0.04;
  const hasWb = manualWb != null && manualWb !== 'auto';
  const hasAnyChange = hasEv || manualIso != null || manualShutterS != null || hasWb;

  const latestExpRef = useRef(exposure);
  latestExpRef.current = exposure;
  const startExpRef = useRef(0);
  const onChangeRef = useRef(onExposureChange);
  onChangeRef.current = onExposureChange;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 2,
        onPanResponderGrant: () => {
          startExpRef.current = latestExpRef.current;
        },
        onPanResponderMove: (_, gs) => {
          const raw = Math.max(-1, Math.min(1, startExpRef.current - gs.dy / 120));
          const snapped = Math.abs(raw) < 0.04 ? 0 : Math.round(raw * 10) / 10;
          onChangeRef.current(snapped);
        },
      }),
    [],
  );

  if (!hasAnyChange) return null;

  const parts: string[] = [];
  if (hasEv) {
    parts.push(
      percentMode
        ? `${exposure >= 0 ? '+' : ''}${Math.round(exposure * 100)}%`
        : `${exposure >= 0 ? '+' : ''}${exposure.toFixed(1)} EV`,
    );
  }
  if (manualIso != null) parts.push(`ISO ${manualIso}`);
  if (manualShutterS != null) parts.push(shutterLabel(manualShutterS));
  if (hasWb) parts.push(photoWbLabel(manualWb, language));

  return (
    <View
      testID="corner-exposure-badge"
      style={[styles.badge, { top, right }]}
      {...panResponder.panHandlers}
      accessibilityLabel={parts.join(' · ')}
    >
      <Text style={styles.arrow}>↕</Text>
      <Text style={styles.text} numberOfLines={1}>
        {parts.join(' · ')}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    zIndex: 25,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: 'rgba(10, 14, 24, 0.72)',
  },
  arrow: {
    fontFamily: mono,
    fontSize: 10,
    color: color.accent,
  },
  text: {
    fontFamily: mono,
    fontSize: 11,
    fontWeight: '600',
    color: color.text,
  },
});
