import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { mono } from '../../theme/tokens';
import { useThemeColors } from '../../theme/useTheme';
import type { PrecisionGear } from '../../utils/timeBar';

interface TimeLoupeProps {
  label: string;
  minute: number;
  accentColor?: string;
  precisionGear?: PrecisionGear;
}

export const LOUPE_WIDTH = 154;
export const LOUPE_HEIGHT = 62;
const TICK_STEP_PX = 7;
const TICK_RADIUS = 11; // -11 ~ +11분 (총 23개 눈금)
const TICKS_ROW_WIDTH = (TICK_RADIUS * 2 + 1) * TICK_STEP_PX;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export const TimeLoupe: React.FC<TimeLoupeProps> = React.memo(({
  label, minute, accentColor, precisionGear = 1,
}) => {
  const color = useThemeColors();
  const accent = accentColor ?? color.accent;

  // 정수 중심 분과 소수부 오프셋을 분리해 눈금 스트립이 1분 경계 사이에서도 매끄럽게 미끄러집니다.
  const centerMinRounded = Math.round(minute);
  const fracMin = Math.max(-0.5, Math.min(0.5, minute - centerMinRounded));
  const slideX = -fracMin * TICK_STEP_PX;

  const tickNodes = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    for (let offset = -TICK_RADIUS; offset <= TICK_RADIUS; offset++) {
      const minVal = centerMinRounded + offset;
      const normalizedMin = ((minVal % 1440) + 1440) % 1440;
      const isTen = normalizedMin % 10 === 0;
      const isFive = normalizedMin % 5 === 0;
      const isCenter = offset === 0;

      const tickHeight = isTen ? 10 : isFive ? 7 : 4;
      const tickOpacity = isCenter ? 1 : isTen ? 0.8 : isFive ? 0.6 : 0.35;
      let tickLabel: string | null = null;
      if (isFive || isTen) {
        tickLabel = `${pad2(Math.floor(normalizedMin / 60))}:${pad2(normalizedMin % 60)}`;
      }

      nodes.push(
        <View key={offset} style={styles.tickCol}>
          <View
            style={[
              styles.tick,
              {
                height: tickHeight,
                backgroundColor: isCenter ? accent : color.textDim,
                opacity: tickOpacity,
              },
            ]}
          />
          {tickLabel && (
            <Text
              style={[
                styles.tickLabelText,
                {
                  color: isCenter ? accent : color.textDim,
                  opacity: isCenter ? 1 : 0.75,
                },
              ]}
              numberOfLines={1}
            >
              {tickLabel}
            </Text>
          )}
        </View>,
      );
    }
    return nodes;
  }, [centerMinRounded, accent, color.textDim]);

  const gearLabel = precisionGear === 0.1 ? '1/10×' : precisionGear === 0.25 ? '1/4×' : null;

  return (
    <View style={styles.container}>
      {/* ── 유리 볼록 렌즈 반사광 (Glass Glare / Highlight) ──────── */}
      <View style={styles.glassHighlight} />
      <View style={styles.diagonalGlare} />

      {/* ── 상단 정밀 시각 텍스트 (+ 세로 드래그 정밀 배율) ──────── */}
      <View style={styles.header}>
        <Text style={[styles.timeText, { color: accent }]}>{label}</Text>
        {gearLabel && (
          <View style={[styles.gearPill, { borderColor: accent }]}>
            <Text style={[styles.gearText, { color: accent }]}>{gearLabel}</Text>
          </View>
        )}
      </View>

      {/* ── 하단 정밀 확대 눈금자 ─────────────────────────────────── */}
      <View style={styles.rulerContainer}>
        <View style={[styles.ticksRow, { transform: [{ translateX: slideX }] }]}>
          {tickNodes}
        </View>

        {/* 중앙 정밀 크로스헤어 / 레티클 핀 */}
        <View style={[styles.centerReticle, { backgroundColor: accent }]} />

        {/* 렌즈 곡면 느낌을 주는 좌우 가장자리 비네팅/페이드 */}
        <View style={[styles.vignetteLeft, { backgroundColor: 'rgba(16, 20, 28, 0.92)' }]} />
        <View style={[styles.vignetteRight, { backgroundColor: 'rgba(16, 20, 28, 0.92)' }]} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: LOUPE_WIDTH,
    height: LOUPE_HEIGHT,
    borderRadius: 18,
    backgroundColor: 'rgba(18, 22, 32, 0.95)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 6,
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 12,
  },

  /* 볼록 렌즈 상단 타원형 반사광 */
  glassHighlight: {
    position: 'absolute',
    top: 2,
    left: 12,
    right: 12,
    height: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },

  /* 우측 사선 유리 광택선 */
  diagonalGlare: {
    position: 'absolute',
    top: -10,
    right: 18,
    width: 24,
    height: 70,
    transform: [{ rotate: '30deg' }],
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },

  header: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  timeText: {
    fontSize: 14,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.6,
  },
  gearPill: {
    position: 'absolute',
    right: 2,
    paddingHorizontal: 4,
    paddingVertical: 0.5,
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: 'rgba(18, 22, 32, 0.85)',
  },
  gearText: {
    fontSize: 8.5,
    fontWeight: '800',
    fontFamily: mono,
  },

  rulerContainer: {
    width: '100%',
    height: 25,
    justifyContent: 'flex-start',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  ticksRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: TICKS_ROW_WIDTH,
  },
  tickCol: {
    alignItems: 'center',
    width: TICK_STEP_PX,
  },
  tick: {
    width: 1.5,
    borderRadius: 1,
  },
  tickLabelText: {
    position: 'absolute',
    top: 11,
    fontSize: 7.5,
    fontFamily: mono,
    fontWeight: '600',
    width: 32,
    textAlign: 'center',
    letterSpacing: -0.2,
  },

  /* 중앙 정밀 타겟 침 */
  centerReticle: {
    position: 'absolute',
    top: -3,
    width: 2,
    height: 13,
    borderRadius: 1,
    zIndex: 3,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 2,
  },

  /* 좌우 렌즈 왜곡 비네팅 */
  vignetteLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 10,
    opacity: 0.85,
  },
  vignetteRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 10,
    opacity: 0.85,
  },
});

