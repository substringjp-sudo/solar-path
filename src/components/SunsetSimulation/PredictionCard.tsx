import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import { SunsetPrediction } from '../../utils/sunsetPhysics';
import { useCelestialStore } from '../../store/useCelestialStore';
import { t } from '../../utils/i18n';

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
    case 'Overcast': return '#6B7886';
    case 'Complex':  return '#E6C25A';
    case 'Clear':    return '#9AA1AA';
    default:         return '#9AA1AA';
  }
};

/** 색상 라벨 색상 */
export const colorLabelColor = (c: SunsetPrediction['colorLabel']): string => {
  switch (c) {
    case 'Vivid': return '#FF5C3F';
    case 'Muted': return '#9AA1AA';
    case 'Clean': return '#4DA0B0';
    default:      return '#9AA1AA';
  }
};

/** 하위 호환: quality 기반 색상 (Visualizer 등에서 계속 사용) */
export const qualityColor = (q: SunsetPrediction['quality']): string => {
  switch (q) {
    case 'Epic':    return '#FF5C3F';
    case 'Great':   return '#FF8A3D';
    case 'Fair':    return '#E6C25A';
    case 'Muted':   return '#9AA1AA';
    case 'Overcast': return '#6B7886';
    default:        return '#9AA1AA';
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
        {/* 왼쪽: 구름 양 */}
        <View style={styles.predictionLeftCol}>
          <View style={styles.labelRow}>
            <Text style={[styles.mainLabel, { color: cloudLabelColor(prediction.cloudLabel) }]}>
              {t(('cloud' + prediction.cloudLabel) as any, language).toUpperCase()}
            </Text>
            {weatherSource === 'ultra-short' && (
              <TouchableOpacity
                style={[
                  styles.sourceBadge,
                  { backgroundColor: 'rgba(77, 160, 176, 0.2)', borderColor: 'rgba(77, 160, 176, 0.3)' }
                ]}
                onPress={onPressSource}
              >
                <Text style={styles.sourceBadgeText}>{t('kmaForecast', language)}</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={[styles.subLabel, { color: theme.subText }]}>
            {isSunrise ? t('dawnForecast', language) : t('sunsetForecast', language)}
          </Text>
        </View>

        {/* 오른쪽: 색상 평가 */}
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
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 24,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: Platform.OS === 'android' ? 4 : 2,
  },
  predictionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  predictionLeftCol: {
    flexDirection: 'column',
    gap: 2,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mainLabel: {
    fontSize: 22,
    fontWeight: '900',
  },
  subLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  sourceBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  sourceBadgeText: {
    color: '#4DA0B0',
    fontSize: 8,
    fontWeight: '700',
  },
  colorLabelWrap: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
  },
});
