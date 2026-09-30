import React from 'react';
import { StyleSheet, View, Text, Platform } from 'react-native';
import { SunsetPrediction } from '../../utils/sunsetPhysics';
import { useCelestialStore } from '../../store/useCelestialStore';
import { t } from '../../utils/i18n';
import { color, radius, mono, dataColor, tint } from '../../theme/tokens';
import { PressScale } from '../ui';

export interface PredictionCardProps {
  prediction: SunsetPrediction;
  theme: any;
  weatherSource?: 'ultra-short' | 'open-meteo' | string;
  isSunrise: boolean;
  onPressSource?: () => void;
}

/** 구름 양 라벨 색상 */
export const cloudLabelColor = (c: SunsetPrediction['cloudLabel']): string => {
  switch (c) {
    case 'Overcast': return dataColor.qOvercast;
    case 'Complex':  return dataColor.qFair;
    case 'Clear':    return color.textDim;
    default:         return color.textDim;
  }
};

/** 색상 라벨 색상 */
export const colorLabelColor = (c: SunsetPrediction['colorLabel']): string => {
  switch (c) {
    case 'Vivid': return dataColor.qEpic;
    case 'Muted': return color.textDim;
    case 'Clean': return dataColor.qClean;
    default:      return color.textDim;
  }
};

/** 하위 호환: quality 기반 색상 (Visualizer 등에서 계속 사용) */
export const qualityColor = (q: SunsetPrediction['quality']): string => {
  switch (q) {
    case 'Epic':    return dataColor.qEpic;
    case 'Great':   return dataColor.qGreat;
    case 'Fair':    return dataColor.qFair;
    case 'Muted':   return color.textDim;
    case 'Overcast': return dataColor.qOvercast;
    default:        return color.textDim;
  }
};

export const PredictionCard: React.FC<PredictionCardProps> = ({
  prediction,
  theme,
  weatherSource,
  isSunrise,
  onPressSource,
}) => {
  const { language } = useCelestialStore();
  return (
    <View style={[styles.predictionCard, { backgroundColor: theme.glass, borderColor: theme.border }]}>
      <View style={styles.predictionHeader}>
        {/* Anchor: 구름 양 */}
        <View style={styles.predictionLeftCol}>
          <View style={styles.labelRow}>
            <Text style={[styles.mainLabel, { color: cloudLabelColor(prediction.cloudLabel) }]}>
              {t(('cloud' + prediction.cloudLabel) as any, language).toUpperCase()}
            </Text>
            {weatherSource === 'ultra-short' && (
              <PressScale
                style={[
                  styles.sourceBadge,
                  { backgroundColor: tint(dataColor.qClean, 0.2), borderColor: tint(dataColor.qClean, 0.3) }
                ]}
                onPress={onPressSource}
              >
                <Text style={styles.sourceBadgeText}>{t('kmaForecast', language)}</Text>
              </PressScale>
            )}
          </View>
          <Text style={[styles.subLabel, { color: theme.subText }]}>
            {isSunrise ? t('dawnForecast', language) : t('sunsetForecast', language)}
          </Text>
        </View>

        {/* Anchor: 색상 평가 */}
        <View style={styles.colorLabelWrap}>
          <Text style={[styles.mainLabel, { color: colorLabelColor(prediction.colorLabel) }]}>
            {t(('color' + prediction.colorLabel) as any, language).toUpperCase()}
          </Text>
          <Text style={[styles.subLabel, { color: theme.subText, textAlign: 'right' }]}>
            {t('colorEvalLabel', language)}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  predictionCard: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    flexShrink: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  predictionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  predictionLeftCol: {
    flexDirection: 'column',
    gap: 3,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mainLabel: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: mono,
  },
  subLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
    fontFamily: mono,
  },
  sourceBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: radius.xs,
    borderWidth: 1,
  },
  sourceBadgeText: {
    color: dataColor.qClean,
    fontSize: 9,
    fontWeight: '800',
    fontFamily: mono,
  },
  colorLabelWrap: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 3,
  },
});
