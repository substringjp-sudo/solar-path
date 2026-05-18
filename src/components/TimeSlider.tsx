import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { format, startOfDay, addMinutes, subMinutes } from 'date-fns';
import { Clock, Zap } from 'lucide-react-native';
import { GenericSlider } from './GenericSlider';

interface TimeSliderProps {
  value: Date;
  onChange: (time: Date) => void;
  mode?: 'fullDay' | 'relative';
  baseTime?: Date;
  isTimeMachineEnabled?: boolean;
  onToggleTimeMachine?: (enabled: boolean) => void;
  theme: any;
  isDay: boolean;
  markers?: Array<{ time: Date | null; color: string; type: 'rise' | 'set' }>;
}

export const TimeSlider: React.FC<TimeSliderProps> = ({
  value,
  onChange,
  mode = 'fullDay',
  baseTime,
  isTimeMachineEnabled = true,
  onToggleTimeMachine = () => {},
  theme,
  isDay,
  markers = [],
}) => {
  const isFullDay = mode === 'fullDay';
  const dayStart = startOfDay(value);
  
  const getPercentageFromTime = (t: Date) => {
    if (isFullDay) {
      const mins = (t.getTime() - dayStart.getTime()) / (1000 * 60);
      return (mins / (24 * 60)) * 100;
    } else {
      const ref = baseTime || new Date();
      const diff = (t.getTime() - ref.getTime()) / (1000 * 60);
      return ((diff + 150) / 300) * 100;
    }
  };

  const getTimeFromPercentage = (p: number) => {
    const pct = Math.max(0, Math.min(100, p)) / 100;
    if (isFullDay) {
      return addMinutes(dayStart, pct * 24 * 60);
    } else {
      const ref = baseTime || new Date();
      return addMinutes(subMinutes(ref, 150), pct * 300);
    }
  };

  const currentPct = getPercentageFromTime(value);

  const getKnobColors = (p: number) => {
    let color = isDay ? '#4facfe' : '#FFFFFF';
    let textColor = isDay ? '#FFFFFF' : '#1A1A1A';
    const threshold = 5; 
    markers.forEach(m => {
      if (!m.time) return;
      const mp = getPercentageFromTime(m.time);
      const dist = Math.abs(mp - p);
      if (dist < threshold) {
        color = m.color === '#888' ? '#888888' : m.color;
        textColor = '#000';
      }
    });
    return { color, textColor };
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Clock size={14} color={isTimeMachineEnabled ? "#FFD700" : theme.subText} />
          <Text style={[styles.title, { color: theme.subText }, isTimeMachineEnabled && { color: "#FFD700" }]}>
            {isFullDay ? (isTimeMachineEnabled ? "Time Machine" : "Real-time") : "Simulation Time"}
          </Text>
        </View>
        {isFullDay && isTimeMachineEnabled && (
          <TouchableOpacity 
            style={[styles.nowButton, { backgroundColor: theme.accent }]} 
            onPress={() => onToggleTimeMachine(false)}
          >
            <Zap size={10} color="#000" fill="#000" />
            <Text style={styles.nowText}>NOW</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.sliderWrapper}>
        <GenericSlider
          value={currentPct}
          onChange={(p) => onChange(getTimeFromPercentage(p))}
          onGrant={() => onToggleTimeMachine(true)}
          theme={theme}
          trackColor={isDay ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)'}
          knobColor={getKnobColors(currentPct).color}
          trackOverlay={
            <View style={styles.markerOverlay} pointerEvents="none">
              {isFullDay && markers.map((marker, i) => {
                if (!marker.time) return null;
                const p = getPercentageFromTime(marker.time);
                if (p < 0 || p > 100) return null;
                return (
                  <View 
                    key={i} 
                    style={[styles.marker, { left: `${p}%`, backgroundColor: marker.color, transform: [{ rotate: marker.type === 'rise' ? '20deg' : '-20deg' }] }]} 
                  />
                );
              })}
            </View>
          }
        >
          <Text style={[styles.tooltipText, { color: getKnobColors(currentPct).textColor }]}>
            {format(value, 'HH:mm')}
          </Text>
        </GenericSlider>
      </View>

      <View style={styles.timeLabels}>
        <Text style={[styles.timeLabel, { color: theme.subText }]}>{isFullDay ? "00:00" : "-2.5h"}</Text>
        <Text style={[styles.timeLabel, { color: theme.subText }]}>{isFullDay ? "12:00" : (baseTime ? format(baseTime, 'HH:mm') : "Event")}</Text>
        <Text style={[styles.timeLabel, { color: theme.subText }]}>{isFullDay ? "23:59" : "+2.5h"}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, height: 28 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 11, fontWeight: '800', marginLeft: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  nowButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, gap: 3 },
  nowText: { color: '#000', fontSize: 10, fontWeight: '900' },
  sliderWrapper: { position: 'relative', height: 44, justifyContent: 'center' },
  markerOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  marker: { position: 'absolute', width: 2, height: 12, top: -3, borderRadius: 1 },
  tooltipText: { fontSize: 13, fontWeight: '900', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  timeLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 27 },
  timeLabel: { fontSize: 10, fontWeight: '700', opacity: 0.6 },
});
