import React from 'react';
import { StyleSheet, View, Text } from 'react-native';

interface FactorBarProps {
  label: string;
  value: number;
  color: string;
  theme: any;
  inverted?: boolean;
}

export const FactorBar = React.memo<FactorBarProps>(({
  label, value, color, theme, inverted,
}) => {
  const display = Math.max(0, Math.min(1, value));
  const fillPct = Math.round(display * 100);
  
  return (
    <View style={styles.factorBar}>
      <View style={styles.factorBarLabelRow}>
        <Text style={[styles.factorBarLabel, { color: theme.subText }]}>{label}</Text>
        <Text style={[styles.factorBarValue, { color: theme.text }]}>{fillPct}%</Text>
      </View>
      <View style={[styles.factorBarTrack, { backgroundColor: theme.glass, borderColor: theme.border, borderWidth: 1 }]}>
        <View style={[styles.factorBarFill, { width: `${fillPct}%`, backgroundColor: color, opacity: inverted ? 0.6 : 1 }]} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  factorBar: { flex: 1 },
  factorBarLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  factorBarLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 0.5, opacity: 0.7 },
  factorBarValue: { fontSize: 9, fontWeight: '800' },
  factorBarTrack: { height: 3, borderRadius: 2, overflow: 'hidden' },
  factorBarFill: { height: '100%', borderRadius: 2 },
});
