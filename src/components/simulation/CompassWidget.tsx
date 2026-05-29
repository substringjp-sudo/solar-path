import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Theme } from '../../types/simulation';

interface CompassWidgetProps {
  heading: number;
  sunAzimuth: number;
  theme: Theme;
}

export const CompassWidget = React.memo<CompassWidgetProps>(({
  heading, sunAzimuth, theme
}) => {
  const normalizeHeading = (h: number) => ((h % 360) + 360) % 360;
  const currentHeading = normalizeHeading(heading);
  const sunAzimuthRelative = normalizeHeading(sunAzimuth);

  const renderScale = () => {
    const ticks = [];
    const range = 60; // Total 120 degrees shown (60 each side)
    const step = 15;
    const center = currentHeading;
    
    for (let i = -range; i <= range; i += step) {
      const tickHeading = normalizeHeading(center + i);
      const left = 50 + (i / range) * 50;
      
      ticks.push(
        <View key={i} style={[styles.tick, { left: `${left}%`, backgroundColor: theme.subText, opacity: 1 - Math.abs(i)/range }]} />
      );
      
      if (tickHeading % 90 === 0) {
        const label = tickHeading === 0 ? 'N' : tickHeading === 90 ? 'E' : tickHeading === 180 ? 'S' : 'W';
        ticks.push(
          <Text key={`label-${i}`} style={[styles.tickLabel, { left: `${left}%`, color: theme.text, opacity: 1 - Math.abs(i)/range }]}>
            {label}
          </Text>
        );
      }
    }
    
    // Sun Marker
    const sunDiff = ((sunAzimuthRelative - currentHeading + 180 + 360) % 360) - 180;
    if (Math.abs(sunDiff) <= range) {
      const sunLeft = 50 + (sunDiff / range) * 50;
      ticks.push(
        <View key="sun-marker" style={[styles.scaleSunMarker, { left: `${sunLeft}%` }]}>
          <Text style={[styles.scaleSunLabel, { color: theme.accent }]}>☀️</Text>
        </View>
      );
    }

    return ticks;
  };

  return (
    <View style={[styles.compassWidget, { backgroundColor: theme.glass, borderColor: theme.border }]}>
      <View style={styles.compassScaleContainer}>
        <View style={styles.scaleClip}>{renderScale()}</View>
        <View style={[styles.centerIndicator, { borderTopColor: theme.accent }]} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  compassWidget: { 
    paddingVertical: 8, 
    paddingHorizontal: 16, 
    borderRadius: 28, 
    borderWidth: 1, 
    height: 64,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  compassScaleContainer: { height: 44, justifyContent: 'flex-end' },
  scaleClip: { flex: 1, overflow: 'hidden' },
  tick: { position: 'absolute', bottom: 4, width: 1, height: 8 },
  tickLabel: { position: 'absolute', fontSize: 10, fontWeight: 'bold', width: 30, textAlign: 'center', marginLeft: -15, bottom: 12 },
  centerIndicator: { position: 'absolute', top: 0, left: '50%', marginLeft: -5, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#FFF' },
  scaleSunMarker: { position: 'absolute', top: 0, alignItems: 'center', width: 30, marginLeft: -15 },
  scaleSunLabel: { fontSize: 8, fontWeight: '900' },
});
