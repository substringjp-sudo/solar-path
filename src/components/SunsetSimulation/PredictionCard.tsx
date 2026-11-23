/**
 * PredictionCard.tsx — 노을 예측 카드와 **판정 한 축**(2026-10-25, 디자인 개정 A2).
 *
 * 예전 카드는 구름 단어(많음 · 복합적 · 없음)와 색 단어(화려함 · 칙칙함 · 깨끗함) 두 축을 따로 보여 주고,
 * 점수와 이유는 없었습니다. 이제 판정 단어 하나 + 점수 + 다섯 칸 + 이유 한 문장입니다.
 *
 *  - 판정은 `sunsetPhysics` 의 `quality` 를 그대로 옮긴 다섯 단계입니다(가려짐 · 옅음 · 보통 · 좋음 · 붉게 탐).
 *  - 칸 수가 단계입니다. 색을 가려 보기 어려워도 칸 수로 읽힙니다(docs/DESIGN_SYSTEM.md §10).
 *  - 색은 시스템의 `q-*` 데이터 색입니다. 옅음(Muted)은 `textDim`.
 *  - 이유는 이미 계산되던 `description` 을 세 언어로 옮겨(`translateSunsetDesc`) 적습니다.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { SunsetPrediction } from '../../utils/sunsetPhysics';
import { useCelestialStore } from '../../store/useCelestialStore';
import { t, L3, translateSunsetDesc, type Language } from '../../utils/i18n';
import { radius, space, type, tint, color as DARK, dataColor as DARK_DATA, type Palette, type DataPalette } from '../../theme/tokens';
import { PressScale } from '../ui';
import { makeStyles, useThemeColors, useDataColors } from '../../theme/useTheme';

export type Quality = SunsetPrediction['quality'];

/** 낮은 단계부터. 칸 수 = 위치 + 1. */
export const VERDICT_ORDER: Quality[] = ['Overcast', 'Muted', 'Fair', 'Great', 'Epic'];
export const verdictLevel = (q: Quality): number => VERDICT_ORDER.indexOf(q) + 1;

export const verdictColor = (q: Quality, data: DataPalette = DARK_DATA, c: Palette = DARK): string => {
  switch (q) {
    case 'Epic': return data.qEpic;
    case 'Great': return data.qGreat;
    case 'Fair': return data.qFair;
    case 'Overcast': return data.qOvercast;
    default: return c.textDim;
  }
};

export const verdictWord = (q: Quality, language: Language): string => t(`verdict${q}` as any, language);

/** 관측지 현지 시각 HH:MM(기기 시간대가 아니라 `timezoneOffsetHours`). */
export const localHHMM = (d: Date, tzHours: number): string => {
  const l = new Date(d.getTime() + tzHours * 3_600_000);
  return `${String(l.getUTCHours()).padStart(2, '0')}:${String(l.getUTCMinutes()).padStart(2, '0')}`;
};

/** 다섯 칸 — 채운 칸 수가 판정 단계입니다. */
export const VerdictMeter: React.FC<{ quality: Quality; cellWidth?: number; cellHeight?: number }> = ({
  quality, cellWidth = 6, cellHeight = 10,
}) => {
  const color = useThemeColors(); const dataColor = useDataColors();
  const n = verdictLevel(quality);
  const on = verdictColor(quality, dataColor, color);
  return (
    <View style={{ flexDirection: 'row', gap: 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {VERDICT_ORDER.map((_, i) => (
        <View key={i} style={{ width: cellWidth, height: cellHeight, borderRadius: 2, backgroundColor: i < n ? on : color.border }} />
      ))}
    </View>
  );
};

export interface PredictionCardProps {
  prediction: SunsetPrediction;
  /** 옛 호출과 맞추려고 받기만 합니다 — 색은 토큰에서 옵니다. */
  theme?: any;
  weatherSource?: 'ultra-short' | 'open-meteo' | string;
  isSunrise: boolean;
  onPressSource?: () => void;
  /** 가장 붉을 때(`utils/glowPeak.ts`). 모르면 적지 않습니다. */
  peakTime?: Date | null;
  /** "왜 그런가요?" — 점수가 나온 단계를 보여 주는 계산 과정 보기로 갑니다(docs/SANDBOX_MODE_PLAN.md 9 장). 없으면 링크를 그리지 않습니다. */
  onWhy?: () => void;
  /** 해가 뜨고 지는 쪽("서쪽 하늘") — 머리 줄에 덧붙입니다(`utils/skyWords.ts`). 모르면 적지 않습니다. */
  directionText?: string | null;
  /** 하늘 위 어두운 유리 시트 안에서는 화면 모드와 무관하게 어두운 팔레트를 씁니다. */
  forceDark?: boolean;
}

export const PredictionCard: React.FC<PredictionCardProps> = ({
  prediction,
  weatherSource,
  isSunrise,
  onPressSource,
  peakTime,
  onWhy,
  directionText,
  forceDark = false,
}) => {
  const themeColor = useThemeColors(); const themeData = useDataColors(); const themeStyles = useStyles();
  const color = forceDark ? DARK : themeColor;
  const dataColor = forceDark ? DARK_DATA : themeData;
  const styles = forceDark ? darkStyles : themeStyles;
  const language = useCelestialStore(s => s.language);
  const tz = useCelestialStore(s => s.timezoneOffsetHours) ?? 0;
  const q = prediction.quality;
  const level = verdictLevel(q);
  const reason = translateSunsetDesc(prediction.description, language);

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.sectionLabel}>{`${isSunrise ? t('dawnForecast', language) : t('sunsetForecast', language)}${directionText ? ` · ${directionText}` : ''}`}</Text>
        {weatherSource === 'ultra-short' && (
          <PressScale
            style={[styles.sourceBadge, { backgroundColor: tint(dataColor.qClean, 0.14), borderColor: tint(dataColor.qClean, 0.4) }]}
            onPress={onPressSource}
          >
            <Text style={[styles.sourceBadgeText, { color: dataColor.qClean }]}>{t('kmaForecast', language)}</Text>
          </PressScale>
        )}
      </View>

      <View style={styles.verdictRow}>
        <Text style={[styles.verdictWord, { color: verdictColor(q, dataColor, color) }]}>{verdictWord(q, language)}</Text>
        <Text style={styles.score}>{Math.round(prediction.score)}</Text>
        <Text style={styles.unit}>/ 100</Text>
        {peakTime && (
          <View style={styles.peak}>
            <Text style={styles.peakLabel}>{t('peakGlow', language)}</Text>
            <Text style={styles.peakTime}>{localHHMM(peakTime, tz)}</Text>
          </View>
        )}
      </View>

      <View style={styles.scale}>
        {VERDICT_ORDER.map((v, i) => {
          const here = i + 1 === level;
          return (
            <View key={v} style={styles.scaleCell}>
              <View style={[
                styles.scaleBar,
                { backgroundColor: verdictColor(v, dataColor, color) },
                here && { borderWidth: 2, borderColor: color.text },
              ]} />
              <Text style={[styles.scaleLabel, here && { color: color.text }]} numberOfLines={1}>{verdictWord(v, language)}</Text>
            </View>
          );
        })}
      </View>

      {!!reason && <Text style={styles.reason}>{reason}</Text>}

      {onWhy && (
        <PressScale onPress={onWhy} accessibilityLabel={L3(language, '왜 그런가요? 점수가 나온 과정 보기', 'Why? See how the score is made', 'なぜ? スコアの出し方を見る')} style={styles.why}>
          <Text style={styles.whyText}>{L3(language, '왜 그런가요?', 'Why?', 'なぜ?')}</Text>
        </PressScale>
      )}
    </View>
  );
};

const makeCardStyles = (color: Palette) => ({
  card: {
    backgroundColor: color.fill,
    borderColor: color.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.md,
  },
  headRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: space.sm },
  sectionLabel: { ...type.micro, color: color.textDim, textTransform: 'uppercase' as const },
  sourceBadge: { paddingHorizontal: space.xs, paddingVertical: space.xxs, borderRadius: radius.xs, borderWidth: 1 },
  sourceBadgeText: { ...type.micro },
  verdictRow: { flexDirection: 'row' as const, alignItems: 'baseline' as const, gap: space.sm },
  verdictWord: { ...type.title },
  score: { ...type.display, color: color.text },
  unit: { ...type.micro, color: color.textMute },
  peak: { marginLeft: 'auto' as const, alignItems: 'flex-end' as const },
  peakLabel: { ...type.micro, color: color.textDim },
  peakTime: { ...type.label, color: color.text },
  scale: { flexDirection: 'row' as const, gap: space.xs },
  scaleCell: { flex: 1, alignItems: 'center' as const, gap: space.xs },
  scaleBar: { alignSelf: 'stretch' as const, height: 8, borderRadius: 2 },
  scaleLabel: { ...type.micro, color: color.textDim },
  reason: { ...type.body, color: color.textDim, lineHeight: 20 },
  why: { alignSelf: 'flex-start' as const, minHeight: 36, justifyContent: 'center' as const },
  whyText: { ...type.label, color: color.accent },
});

const useStyles = makeStyles(makeCardStyles);
const darkStyles = makeCardStyles(DARK);
