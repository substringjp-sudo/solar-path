import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Theme } from '../../types/simulation';

interface SimulationHeroProps {
  simulationTime: Date;
  terrainOffset?: number;
  theme: Theme;
}

export const SimulationHero: React.FC<SimulationHeroProps> = ({ 
  simulationTime, 
  terrainOffset = 0, 
  theme 
}) => {
  return (
    <View style={[styles.heroCard, { backgroundColor: theme.glass, borderColor: theme.border }]}>
      <View style={styles.heroHeader}>
        <Text style={[styles.heroTitle, { color: theme.subText }]}>GOLDEN HOUR</Text>
        <View style={[styles.sourceBadge, { borderColor: theme.accent }]}>
          <Text style={[styles.sourceBadgeText, { color: theme.accent }]}>LIVE</Text>
        </View>
      </View>
      <View style={styles.heroTimeRow}>
        <Text style={[styles.heroTime, { color: theme.text }]}>
          {simulationTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
        </Text>
        {terrainOffset > 0 && (
          <Text style={[styles.terrainOffset, { color: '#FFA500' }]}>
            +{terrainOffset.toFixed(1)}° TERRAIN
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  heroCard: { 
    flex: 1, 
    borderRadius: 32, 
    padding: 16, 
    borderWidth: 1, 
    justifyContent: 'center',
  },
  heroHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 6 
  },
  heroTitle: { 
    fontSize: 10, 
    fontWeight: '900', 
    letterSpacing: 1.2 
  },
  heroTimeRow: { 
    flexDirection: 'row', 
    alignItems: 'baseline', 
    gap: 6 
  },
  heroTime: { 
    fontSize: 22, 
    fontWeight: '900' 
  },
  terrainOffset: { 
    fontSize: 13, 
    fontWeight: '800' 
  },
  sourceBadge: { 
    paddingHorizontal: 6, 
    paddingVertical: 3, 
    borderRadius: 8, 
    borderWidth: 0.5 
  },
  sourceBadgeText: { 
    fontSize: 8, 
    fontWeight: '900' 
  },
});
