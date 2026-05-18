import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import { SunsetPrediction } from '../../utils/sunsetPhysics';

export interface PredictionCardProps {
  prediction: SunsetPrediction;
  theme: any;
  weatherSource?: 'ultra-short' | 'open-meteo' | string;
  isSunrise: boolean;
  onPressSource?: () => void;
}

export const qualityColor = (q: SunsetPrediction['quality']): string => {
  switch (q) {
    case 'Epic': return '#FF5C3F';
    case 'Great': return '#FF8A3D';
    case 'Fair': return '#E6C25A';
    case 'Muted': return '#9AA1AA';
    case 'Overcast': return '#6B7886';
    default: return '#9AA1AA';
  }
};

export const PredictionCard: React.FC<PredictionCardProps> = ({
  prediction,
  theme,
  weatherSource,
  isSunrise,
  onPressSource,
}) => {
  return (
    <View style={[styles.predictionCard, { backgroundColor: theme.glass, borderColor: theme.border }]}>
      <View style={styles.predictionHeader}>
        <View style={styles.predictionQualityRow}>
          <View style={styles.qualityContainer}>
            <Text style={[styles.predictionQuality, { color: qualityColor(prediction.quality) }]}>
              {prediction.quality.toUpperCase()}
            </Text>
            {weatherSource === 'ultra-short' && (
              <TouchableOpacity 
                style={[
                  styles.sourceBadge, 
                  { backgroundColor: 'rgba(77, 160, 176, 0.2)', borderColor: 'rgba(77, 160, 176, 0.3)' }
                ]}
                onPress={onPressSource}
              >
                <Text style={styles.sourceBadgeText}>기상청 초단기 예보</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={[styles.predictionSubLabel, { color: theme.subText }]}>
            {isSunrise ? 'DAWN FORECAST' : 'SUNSET FORECAST'}
          </Text>
        </View>
        <View style={styles.predictionScoreWrap}>
          <Text style={[styles.predictionScore, { color: theme.text }]}>{prediction.score}</Text>
          <Text style={[styles.predictionScoreMax, { color: theme.subText }]}>/100</Text>
        </View>
      </View>
      <Text style={[styles.predictionDesc, { color: theme.subText }]} numberOfLines={2}>
        {prediction.description}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  predictionCard: {
    height: 96, // 카드 높이를 항상 96으로 고정하여 설명글 줄 수에 따른 꿀렁임 제거!
    padding: 12,
    borderRadius: 20,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    justifyContent: 'space-between', // 카드 내부 헤더와 설명란의 균형 잡힌 정렬 보장
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
  predictionQualityRow: {
    flexDirection: 'column',
    gap: 2,
  },
  qualityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  predictionQuality: {
    fontSize: 22,
    fontWeight: '900',
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
  predictionSubLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  predictionScoreWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  predictionScore: {
    fontSize: 22,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  predictionScoreMax: {
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 2,
  },
  predictionDesc: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 18,
  },
  predictionFactors: {
    gap: 8,
    marginTop: 4,
  },
});
