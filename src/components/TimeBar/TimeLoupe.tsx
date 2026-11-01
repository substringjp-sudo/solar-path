import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { mono, radius, type } from '../../theme/tokens';
import { useThemeColors } from '../../theme/useTheme';

interface TimeLoupeProps {
  label: string;
  minute: number;
  accentColor?: string;
}

export const LOUPE_WIDTH = 154;
export const LOUPE_HEIGHT = 62;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export const TimeLoupe: React.FC<TimeLoupeProps> = ({ label, minute, accentColor }) => {
  const color = useThemeColors();
  const accent = accentColor ?? color.accent;

  // 중앙 minute 기준 좌우 ±10분 범위의 정밀 눈금 (1분 단위)
  const centerMinRounded = Math.round(minute);
  const startMin = centerMinRounded - 10;

  const ticks = [];
  for (let i = 0; i <= 20; i++) {
    const minVal = startMin + i;
    // 하루 0~1440분 순환 정규화 (음수나 1440 이상 안전 처리)
    const normalizedMin = ((minVal % 1440) + 1440) % 1440;
    const isFive = normalizedMin % 5 === 0;
    const isTen = normalizedMin % 10 === 0;
    const isCenter = i === 10; // 정중앙 타겟

    // 5분 또는 10분 단위 주요 눈금에 표시할 시각 텍스트 (예: 17:40, 17:45)
    let tickLabel: string | null = null;
    if (isFive || isTen) {
      const h = Math.floor(normalizedMin / 60);
      const m = normalizedMin % 60;
      tickLabel = `${pad2(h)}:${pad2(m)}`;
    }

    ticks.push({
      key: `tick-${minVal}-${i}`,
      minVal,
      normalizedMin,
      isFive,
      isTen,
      isCenter,
      tickLabel,
    });
  }

  return (
    <View style={styles.container}>
      {/* ── 유리 볼록 렌즈 반사광 (Glass Glare / Highlight) ──────── */}
      <View style={styles.glassHighlight} />
      <View style={styles.diagonalGlare} />

      {/* ── 상단 정밀 시각 텍스트 ─────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={[styles.timeText, { color: accent }]}>{label}</Text>
      </View>

      {/* ── 하단 정밀 확대 눈금자 ─────────────────────────────────── */}
      <View style={styles.rulerContainer}>
        {/* 눈금자 틱들 */}
        <View style={styles.ticksRow}>
          {ticks.map((t) => {
            const height = t.isTen ? 10 : t.isFive ? 7 : 4;
            const opacity = t.isCenter ? 1 : t.isTen ? 0.8 : t.isFive ? 0.6 : 0.35;
            return (
              <View key={t.key} style={styles.tickCol}>
                <View
                  style={[
                    styles.tick,
                    {
                      height,
                      backgroundColor: t.isCenter ? accent : color.textDim,
                      opacity,
                    },
                  ]}
                />
                {/* 5분/10분 단위 눈금 아래 시각 라벨 */}
                {t.tickLabel && (
                  <Text
                    style={[
                      styles.tickLabelText,
                      {
                        color: t.isCenter ? accent : color.textDim,
                        opacity: t.isCenter ? 1 : 0.75,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {t.tickLabel}
                  </Text>
                )}
              </View>
            );
          })}
        </View>

        {/* 중앙 정밀 크로스헤어 / 레티클 핀 */}
        <View style={[styles.centerReticle, { backgroundColor: accent }]} />

        {/* 렌즈 곡면 느낌을 주는 좌우 가장자리 비네팅/페이드 */}
        <View style={[styles.vignetteLeft, { backgroundColor: 'rgba(16, 20, 28, 0.92)' }]} />
        <View style={[styles.vignetteRight, { backgroundColor: 'rgba(16, 20, 28, 0.92)' }]} />
      </View>
    </View>
  );
};

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

  rulerContainer: {
    width: '100%',
    height: 25,
    justifyContent: 'flex-start',
    alignItems: 'center',
    position: 'relative',
  },
  ticksRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 2,
  },
  tickCol: {
    alignItems: 'center',
    width: 4,
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
    width: 8,
    opacity: 0.8,
  },
  vignetteRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 8,
    opacity: 0.8,
  },
});

