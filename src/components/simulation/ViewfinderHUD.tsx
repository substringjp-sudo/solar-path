import React from 'react';
import { StyleSheet, View, Text, Platform } from 'react-native';

interface ViewfinderHUDProps {
  heading: number;
  sunAltitude: number;
  fov: number;
  theme: any;
}

export const ViewfinderHUD = React.memo<ViewfinderHUDProps>(({
  heading, sunAltitude, fov, theme
}) => {
  return (
    <View style={styles.hudContainer} pointerEvents="none">
      <View style={[styles.hudCorner, styles.hudCornerTL, { borderColor: theme.accent }]} />
      <View style={[styles.hudCorner, styles.hudCornerTR, { borderColor: theme.accent }]} />
      <View style={[styles.hudCorner, styles.hudCornerBL, { borderColor: theme.accent }]} />
      <View style={[styles.hudCorner, styles.hudCornerBR, { borderColor: theme.accent }]} />

      <View style={styles.hudCrosshair}>
        <View style={[styles.hudInnerCircle, { borderColor: theme.accent }]} />
        <View style={[styles.hudHeadingLine, { height: 40, backgroundColor: theme.accent }]} />
        <View style={[styles.hudHeadingLine, { width: 40, height: 1, backgroundColor: theme.accent }]} />
      </View>

      <View style={styles.hudTelemetryLeft}>
        <View style={styles.hudItem}>
          <Text style={[styles.hudLabel, { color: theme.text }]}>HDG</Text>
          <View style={styles.hudValueRow}>
            <Text style={[styles.hudValue, { color: theme.text }]}>{Math.round(heading)}°</Text>
            <Text style={[styles.hudUnit, { color: theme.subText }]}>TRUE</Text>
          </View>
        </View>
        <View style={styles.hudItem}>
          <Text style={[styles.hudLabel, { color: theme.text }]}>ALT</Text>
          <View style={styles.hudValueRow}>
            <Text style={[styles.hudValue, { color: theme.text }]}>{sunAltitude.toFixed(1)}°</Text>
          </View>
        </View>
      </View>

      <View style={styles.hudTelemetryRight}>
        <View style={styles.hudItem}>
          <Text style={[styles.hudLabel, { color: theme.text }]}>FOV</Text>
          <View style={styles.hudValueRow}>
            <Text style={[styles.hudValue, { color: theme.text }]}>{Math.round(fov)}°</Text>
          </View>
        </View>
        <View style={styles.hudItem}>
          <Text style={[styles.hudLabel, { color: theme.text }]}>RES</Text>
          <View style={[styles.hudValueRow, { opacity: 0.8 }]}>
            <Text style={[styles.hudValue, { color: theme.text }]}>4K</Text>
            <Text style={[styles.hudUnit, { color: theme.subText }]}>SIM</Text>
          </View>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  hudContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hudCorner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderWidth: 1.5,
  },
  hudCornerTL: { top: 20, left: 20, borderRightWidth: 0, borderBottomWidth: 0 },
  hudCornerTR: { top: 20, right: 20, borderLeftWidth: 0, borderBottomWidth: 0 },
  hudCornerBL: { bottom: 20, left: 20, borderRightWidth: 0, borderTopWidth: 0 },
  hudCornerBR: { bottom: 20, right: 20, borderLeftWidth: 0, borderTopWidth: 0 },
  hudCrosshair: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hudHeadingLine: {
    position: 'absolute',
    width: 1,
    height: 20,
    opacity: 0.3,
  },
  hudInnerCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    opacity: 0.1,
  },
  hudTelemetryLeft: {
    position: 'absolute',
    left: 20,
    bottom: 20,
    gap: 12,
  },
  hudTelemetryRight: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    alignItems: 'flex-end',
    gap: 12,
  },
  hudItem: {
    gap: 2,
  },
  hudLabel: {
    fontSize: 8,
    fontWeight: '900',
    opacity: 0.5,
    letterSpacing: 1,
  },
  hudValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  hudValue: {
    fontSize: 14,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  hudUnit: {
    fontSize: 10,
    fontWeight: '700',
    marginLeft: 2,
    opacity: 0.6,
  },
});
