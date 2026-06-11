import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Clock, Zap, MapPin } from 'lucide-react-native';
import { GenericSlider } from './GenericSlider';
import { useCelestialStore } from '../store/useCelestialStore';
import { getLocalTimeAtLocation, getSystemTimeFromLocationTime, formatLocalTime } from '../utils/timezone';
import { t } from '../utils/i18n';

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
  onPressMap?: () => void;
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
  onPressMap,
}) => {
  const { location, timezoneOffsetHours, language } = useCelestialStore();

  const localValue = useMemo(() => getLocalTimeAtLocation(value, timezoneOffsetHours), [value, timezoneOffsetHours]);
  const localBaseTime = useMemo(() => baseTime ? getLocalTimeAtLocation(baseTime, timezoneOffsetHours) : undefined, [baseTime, timezoneOffsetHours]);
  
  const localMarkers = useMemo(() => {
    return markers.map(m => ({
      ...m,
      time: m.time ? getLocalTimeAtLocation(m.time, timezoneOffsetHours) : null,
    }));
  }, [markers, timezoneOffsetHours]);

  const isFullDay = mode === 'fullDay';
  const dayStart = useMemo(() => {
    const d = new Date(localValue);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }, [localValue]);
  
  const isSunrise = localMarkers.some(m => m.type === 'rise');
  const startOffset = isSunrise ? -60 : -90; // 일출은 전 1시간(-60), 일몰은 전 1.5시간(-90)
  const totalRange = 150; // 총 범위 150분 (1시간 + 1.5시간)

  const getPercentageFromTime = (t: Date) => {
    if (isFullDay) {
      const mins = t.getUTCHours() * 60 + t.getUTCMinutes();
      return (mins / (24 * 60)) * 100;
    } else {
      const ref = localBaseTime || new Date();
      const diff = (t.getTime() - ref.getTime()) / (1000 * 60);
      return ((diff - startOffset) / totalRange) * 100;
    }
  };

  const getTimeFromPercentage = (p: number) => {
    const pct = Math.max(0, Math.min(100, p)) / 100;
    if (isFullDay) {
      // Limit to 23:59 (1439 mins) so it doesn't spill over to next day
      const minutes = Math.min(1439, Math.floor(pct * 24 * 60));
      return new Date(dayStart.getTime() + minutes * 60 * 1000);
    } else {
      const ref = localBaseTime || new Date();
      return new Date(ref.getTime() + (startOffset + pct * totalRange) * 60 * 1000);
    }
  };

  const currentPct = Math.max(0, Math.min(100, getPercentageFromTime(localValue)));

  const baseTimePercentage = useMemo(() => {
    if (!localBaseTime) return 50;
    return getPercentageFromTime(localBaseTime);
  }, [localBaseTime, getPercentageFromTime]);

  const getKnobColors = (p: number) => {
    // Always return white background for the knob and dark text for the tooltip,
    // keeping the styling consistent with the forced light theme.
    return { color: '#FFFFFF', textColor: '#1A1A1A' };
  };

  const sunriseTime = useMemo(() => {
    const m = localMarkers.find(x => x.type === 'rise');
    if (m && m.time) return m.time;
    const d = new Date(dayStart);
    d.setUTCHours(6, 0, 0, 0);
    return d;
  }, [localMarkers, dayStart]);

  const sunsetTime = useMemo(() => {
    const m = localMarkers.find(x => x.type === 'set');
    if (m && m.time) return m.time;
    const d = new Date(dayStart);
    d.setUTCHours(18, 30, 0, 0);
    return d;
  }, [localMarkers, dayStart]);

  const colorMap = useMemo(() => {
    const points: Array<{ pct: number; color: string }> = [];

    const getPointColor = (t: Date) => {
      const valueMinutes = t.getUTCHours() * 60 + t.getUTCMinutes();
      const sunriseMinutes = sunriseTime.getUTCHours() * 60 + sunriseTime.getUTCMinutes();
      const sunsetMinutes = sunsetTime.getUTCHours() * 60 + sunsetTime.getUTCMinutes();

      let isGolden = false;
      localMarkers.forEach(m => {
        if (!m.time || m.color === '#888' || m.color === '#888888') return;
        const markerMinutes = m.time.getUTCHours() * 60 + m.time.getUTCMinutes();
        let diff = valueMinutes - markerMinutes;
        if (diff > 720) diff -= 1440;
        if (diff < -720) diff += 1440;

        if (m.type === 'rise') {
          if (diff >= -60 && diff <= 90) isGolden = true;
        } else if (m.type === 'set') {
          if (diff >= -90 && diff <= 60) isGolden = true;
        }
      });

      if (isGolden) return '#FFD700';
      const isSliderDay = valueMinutes >= sunriseMinutes && valueMinutes < sunsetMinutes;
      return isSliderDay ? '#38BDF8' : '#1A237E';
    };

    const transitionBufferMins = 15; // 15분 전이 그라데이션 구간

    if (isFullDay) {
      const rMinutes = sunriseTime.getUTCHours() * 60 + sunriseTime.getUTCMinutes();
      const sMinutes = sunsetTime.getUTCHours() * 60 + sunsetTime.getUTCMinutes();

      const keyMinutes = [
        0,
        (rMinutes - 60 + 1440) % 1440,
        (rMinutes + 90) % 1440,
        (sMinutes - 90 + 1440) % 1440,
        (sMinutes + 60) % 1440,
        1439
      ];

      const allMinutes: number[] = [];
      keyMinutes.forEach(m => {
        allMinutes.push(m);
        allMinutes.push((m - transitionBufferMins + 1440) % 1440);
        allMinutes.push((m + transitionBufferMins) % 1440);
      });

      const uniqueSorted = Array.from(new Set(allMinutes)).sort((a, b) => a - b);

      uniqueSorted.forEach(m => {
        const d = new Date(dayStart);
        d.setUTCHours(Math.floor(m / 60), m % 60, 0, 0);
        const pct = (m / 1440) * 100;
        points.push({ pct, color: getPointColor(d) });
      });
    } else {
      const ref = localBaseTime || new Date();
      const offsets = [
        startOffset,
        startOffset + transitionBufferMins,
        0,
        totalRange + startOffset - transitionBufferMins,
        totalRange + startOffset
      ];

      if (isSunrise) {
        offsets.push(-60 - transitionBufferMins, -60, 90, 90 + transitionBufferMins);
      } else {
        offsets.push(-90 - transitionBufferMins, -90, 60, 60 + transitionBufferMins);
      }

      const validOffsets = Array.from(new Set(offsets))
        .filter(off => off >= startOffset && off <= startOffset + totalRange)
        .sort((a, b) => a - b);

      validOffsets.forEach(off => {
        const t = new Date(ref.getTime() + off * 60 * 1000);
        const pct = ((off - startOffset) / totalRange) * 100;
        points.push({ pct, color: getPointColor(t) });
      });
    }

    points.sort((a, b) => a.pct - b.pct);

    const finalInputRange: number[] = [];
    const finalOutputRange: string[] = [];

    points.forEach((pt, idx) => {
      if (idx > 0 && Math.abs(pt.pct - finalInputRange[finalInputRange.length - 1]) < 0.01) {
        return;
      }
      finalInputRange.push(pt.pct);
      finalOutputRange.push(pt.color);
    });

    if (finalInputRange[0] > 0) {
      finalInputRange.unshift(0);
      finalOutputRange.unshift(finalOutputRange[0]);
    }
    if (finalInputRange[finalInputRange.length - 1] < 100) {
      finalInputRange.push(100);
      finalOutputRange.push(finalOutputRange[finalOutputRange.length - 1]);
    }

    return {
      inputRange: finalInputRange,
      outputRange: finalOutputRange
    };
  }, [sunriseTime, sunsetTime, localMarkers, isFullDay, dayStart, localBaseTime, startOffset, totalRange, isSunrise]);

  const getFillColor = () => {
    // 1. 일출/일몰 골든타임 구간 체크
    let isGolden = false;
    const valueMinutes = localValue.getUTCHours() * 60 + localValue.getUTCMinutes();

    let sunriseMinutes = 6 * 60; // 기본 일출 06:00
    let sunsetMinutes = 18 * 60 + 30; // 기본 일몰 18:30

    localMarkers.forEach(m => {
      if (!m.time) return;
      // 달 마커(색상이 #888)는 골든타임 판정에서 제외하고 태양 마커만 판정
      if (m.color === '#888' || m.color === '#888888') return;

      const markerMinutes = m.time.getUTCHours() * 60 + m.time.getUTCMinutes();
      
      // 일출/일몰 기준 분 기억
      if (m.type === 'rise') {
        sunriseMinutes = markerMinutes;
      } else if (m.type === 'set') {
        sunsetMinutes = markerMinutes;
      }

      // 24시간(1440분) 기준 원형 시차(Circular Time Difference) 계산
      let diff = valueMinutes - markerMinutes;
      if (diff > 720) diff -= 1440;
      if (diff < -720) diff += 1440;

      if (m.type === 'rise') {
        // 일출 골든타임: -60분 ~ +90분
        if (diff >= -60 && diff <= 90) {
          isGolden = true;
        }
      } else if (m.type === 'set') {
        // 일몰 골든타임: -90분 ~ +60분
        if (diff >= -90 && diff <= 60) {
          isGolden = true;
        }
      }
    });

    if (isGolden) {
      return '#FFD700'; // 일출 일몰 (노란색)
    }

    // 2. 현재 선택된 시간(valueMinutes) 기준 낮/밤 판단
    const isSliderDay = valueMinutes >= sunriseMinutes && valueMinutes < sunsetMinutes;

    // 낮: 청량한 하늘색, 밤: 깊고 짙은 남색
    return isSliderDay ? '#38BDF8' : '#1A237E';
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Clock size={14} color={theme.subText} />
          <Text style={[styles.title, { color: theme.subText }]}>
            {isFullDay ? (isTimeMachineEnabled ? t('timeMachine', language) : t('realtime', language)) : t('simulationTime', language)}
          </Text>
        </View>
        <View style={styles.headerButtons}>
          {onPressMap && (
            <TouchableOpacity 
              style={[styles.nowButton, { backgroundColor: theme.accent }]} 
              onPress={onPressMap}
              activeOpacity={0.7}
            >
              <MapPin size={10} color="#000" />
              <Text style={styles.nowText}>{t('mapLabel', language)}</Text>
            </TouchableOpacity>
          )}
          {isFullDay && isTimeMachineEnabled && (
            <TouchableOpacity 
              style={[styles.nowButton, { backgroundColor: theme.accent }]} 
              onPress={() => onToggleTimeMachine(false)}
              activeOpacity={0.7}
            >
              <Zap size={10} color="#000" fill="#000" />
              <Text style={styles.nowText}>{t('now', language)}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
 
      <View style={styles.sliderWrapper}>
        <GenericSlider
          value={currentPct}
          onChange={(p) => {
            const selectedLocalTime = getTimeFromPercentage(p);
            const systemTime = getSystemTimeFromLocationTime(selectedLocalTime, timezoneOffsetHours);
            onChange(systemTime);
          }}
          onGrant={() => onToggleTimeMachine(true)}
          theme={theme}
          trackColor={isDay ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)'}
          fillColor={getFillColor()}
          colorMap={colorMap}
          knobColor={getKnobColors(currentPct).color}
          trackOverlay={
            <View style={styles.markerOverlay} pointerEvents="none">
              {localMarkers.map((marker, i) => {
                if (!marker.time) return null;
                const p = getPercentageFromTime(marker.time);
                if (p < 0 || p > 100) return null;
                const markerColor = marker.color === '#888' ? '#888888' : marker.color;
                return (
                  <View 
                    key={i} 
                    style={[styles.markerContainer, { left: `${p}%` }]} 
                  >
                    {marker.type === 'rise' && (
                      <Text style={[styles.directionIndicator, { color: markerColor, marginBottom: 2 }]}>▲</Text>
                    )}
                    {/* 게이지가 차올라도 링 실루엣이 묻히지 않도록 배경을 불투명 흰색(#FFFFFF)으로 변경 */}
                    <View style={[styles.auraRing, { borderColor: markerColor, backgroundColor: '#FFFFFF' }]}>
                      <View style={[styles.coreDot, { backgroundColor: markerColor }]} />
                    </View>
                    {marker.type === 'set' && (
                      <Text style={[styles.directionIndicator, { color: markerColor, marginTop: 2 }]}>▼</Text>
                    )}
                  </View>
                );
              })}
            </View>
          }
        >
          <Text style={[styles.tooltipText, { color: getKnobColors(currentPct).textColor }]}>
            {formatLocalTime(localValue, 'HH:mm')}
          </Text>
        </GenericSlider>
      </View>
 
      <View style={styles.timeLabels}>
        <Text style={[styles.timeLabel, { color: theme.subText }]}>
          {isFullDay ? "00:00" : `${startOffset >= 0 ? '+' : ''}${(startOffset / 60).toFixed(1)}h`}
        </Text>
        {isFullDay ? (
          <Text style={[styles.timeLabel, { color: theme.subText }]}>12:00</Text>
        ) : (
          localBaseTime && (
            <View style={styles.absoluteLabelOverlay} pointerEvents="none">
              <View style={[styles.absoluteLabelContainer, { left: `${baseTimePercentage}%` }]}>
                <Text style={[styles.timeLabel, { color: theme.subText }]}>
                  {formatLocalTime(localBaseTime, 'HH:mm')}
                </Text>
              </View>
            </View>
          )
        )}
        <Text style={[styles.timeLabel, { color: theme.subText }]}>
          {isFullDay ? "23:59" : `+${((startOffset + totalRange) / 60).toFixed(1)}h`}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, height: 28 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 11, fontWeight: '800', marginLeft: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  headerButtons: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  nowButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, gap: 3 },
  nowText: { color: '#000', fontSize: 10, fontWeight: '900' },
  sliderWrapper: { position: 'relative', height: 44, justifyContent: 'center' },
  markerOverlay: { width: '100%', height: '100%' },
  markerContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    top: 0,
    bottom: 0,
    width: 24,
    marginLeft: -12,
  },
  auraRing: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coreDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  directionIndicator: {
    fontSize: 7,
    fontWeight: '900',
    opacity: 0.8,
  },
  tooltipText: { fontSize: 13, fontWeight: '900', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  timeLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 27, position: 'relative' },
  timeLabel: { fontSize: 10, fontWeight: '700', opacity: 0.6 },
  absoluteLabelOverlay: {
    position: 'absolute',
    left: 27,
    right: 27,
    top: 0,
    bottom: 0,
  },
  absoluteLabelContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
    marginLeft: -30, // 60px 너비의 딱 절반만큼 왼쪽으로 밀어 마커 중심선과 완전 정렬
    top: 0,
    bottom: 0,
  },
});
