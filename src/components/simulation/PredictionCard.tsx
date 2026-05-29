import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import { FactorBar } from './FactorBar';
import { qualityColor } from './utils';
import { SunsetPrediction } from '../../utils/sunsetPhysics';
import { Theme } from '../../types/simulation';

interface PredictionCardProps {
  prediction: SunsetPrediction | null;
  theme: Theme;
  onPress: () => void;
}

export const PredictionCard = React.memo<PredictionCardProps>(({
  prediction, theme, onPress
}) => {
  if (!prediction) return null;
  const qColor = qualityColor(prediction.quality);
  
  return (
    <TouchableOpacity 
      activeOpacity={0.8} 
      onPress={onPress}
      style={[styles.predictionCard, { backgroundColor: theme.glass, borderColor: theme.border }]}
    >
      <View style={styles.predictionHeader}>
        <View style={styles.predictionQualityRow}>
          <Text style={[styles.predictionSubLabel, { color: theme.subText }]}>SUNSET QUALITY</Text>
          <Text style={[styles.predictionQuality, { color: qColor }]}>{prediction.quality.toUpperCase()}</Text>
        </View>
        <View style={styles.predictionScoreWrap}>
          <Text style={[styles.predictionScore, { color: theme.text }]}>{prediction.score}</Text>
          <Text style={[styles.predictionScoreMax, { color: theme.subText }]}>/100</Text>
        </View>
      </View>
      
      <Text style={[styles.predictionDesc, { color: theme.subText }]} numberOfLines={1}>
        {prediction.description}
      </Text>
      
      <View style={styles.predictionFactors}>
        <FactorBar label="VIBRANCY" value={prediction.factors.beamRedness} color={qColor} theme={theme} />
        <FactorBar label="CLARITY" value={prediction.factors.pathClarity} color="#4682B4" theme={theme} />
        <FactorBar label="OVERCAST" value={prediction.factors.overheadOvercast} color="#8E8E93" theme={theme} inverted />
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  predictionCard: { 
    width: '100%',
    padding: 24, 
    borderRadius: 40, 
    borderWidth: 1.2, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 20 }, 
    shadowOpacity: 0.35, 
    shadowRadius: 32,
    elevation: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  predictionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  predictionQualityRow: { flexDirection: 'column' },
  predictionQuality: { fontSize: 18, fontWeight: '900', letterSpacing: 1.5 },
  predictionSubLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, opacity: 0.6, marginBottom: 2 },
  predictionScoreWrap: { flexDirection: 'row', alignItems: 'baseline' },
  predictionScore: { fontSize: 28, fontWeight: '900', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  predictionScoreMax: { fontSize: 12, fontWeight: '700', marginLeft: 2, opacity: 0.4 },
  predictionDesc: { fontSize: 12, lineHeight: 17, marginBottom: 12, fontWeight: '500' },
  predictionFactors: { flexDirection: 'row', gap: 8 },
});
