import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Clock, Zap, Camera } from 'lucide-react-native';
import { GenericSlider } from './GenericSlider';
import { useCelestialStore } from '../store/useCelestialStore';
import { getLocalTimeAtLocation, getSystemTimeFromLocationTime, formatLocalTime } from '../utils/timezone';
import { t, L3 } from '../utils/i18n';
import { color, radius, mono } from '../theme/tokens';
import { PressScale } from './ui';
import { makeStyles, useThemeColors } from '../theme/useTheme';

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
  onCameraPress?: () => void;
  onSlidingStart?: () => void;
  onSlidingComplete?: () => void;
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
  onCameraPress,
  onSlidingStart,
  onSlidingComplete,
}) => {
  const color = useThemeColors(); const styles = useStyles();
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
    // Astro-HUD: 흑연 옵시디언 다크 노브 + 일렉트릭 시안 발광 타임코드
    return { color: color.panelRaised, textColor: color.accent };
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
        if (!m.time || m.color === color.textDim || m.color === color.textDim) return;
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

      if (isGolden) return color.sun;
      const isSliderDay = valueMinutes >= sunriseMinutes && valueMinutes < sunsetMinutes;
      return isSliderDay ? color.accent : '#1A237E';
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
      if (m.color === color.textDim || m.color === color.textDim) return;

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
      return color.sun; // 일출 일몰 (노란색)
    }

    // 2. 현재 선택된 시간(valueMinutes) 기준 낮/밤 판단
    const isSliderDay = valueMinutes >= sunriseMinutes && valueMinutes < sunsetMinutes;

    // 낮: 청량한 하늘색, 밤: 깊고 짙은 남색
    return isSliderDay ? color.accent : '#1A237E';
  };

  return (
    <View style={styles.container}>
      {/* ── 좌측: 타임라인 스크러버 섹션 ─────────────────────────────────── */}
      <View style={styles.sliderSection}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Clock size={12} color={color.accent} />
            <Text style={[styles.title, { color: color.text }]}>
              {isFullDay ? (isTimeMachineEnabled ? t('timeMachine', language) : t('realtime', language)) : t('simulationTime', language)}
            </Text>
            <View style={styles.telemetryTagWrap}>
              <View style={[styles.telemetryDot, { backgroundColor: isTimeMachineEnabled ? color.warning : color.success }]} />
              <Text style={styles.telemetryTag}>
                {isTimeMachineEnabled ? 'SIM' : 'LIVE'}
              </Text>
            </View>
          </View>

          <View style={styles.headerButtons}>
            {isFullDay && isTimeMachineEnabled && (
              <PressScale 
                style={styles.nowBtn} 
                onPress={() => onToggleTimeMachine(false)}
                activeOpacity={0.75}
              >
                <Zap size={10} color={color.onAccent} fill={color.onAccent} />
                <Text style={styles.nowBtnText}>{t('now', language)}</Text>
              </PressScale>
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
            onGrant={() => {
              onToggleTimeMachine(true);
              onSlidingStart?.();
            }}
            onRelease={onSlidingComplete}
            theme={theme}
            trackColor={isDay ? color.accentSoft : color.border}
            fillColor={getFillColor()}
            colorMap={colorMap}
            knobColor={getKnobColors(currentPct).color}
            trackOverlay={
              <View style={styles.markerOverlay} pointerEvents="none">
                {localMarkers.map((marker, i) => {
                  if (!marker.time) return null;
                  const p = getPercentageFromTime(marker.time);
                  if (p < 0 || p > 100) return null;
                  const markerColor = marker.color === color.textDim ? color.textDim : marker.color;
                  return (
                    <View 
                      key={i} 
                      style={[styles.markerContainer, { left: `${p}%` }]} 
                    >
                      {marker.type === 'rise' && (
                        <Text style={[styles.directionIndicator, { color: markerColor, marginBottom: 2 }]}>▲</Text>
                      )}
                      <View style={[styles.auraRing, { borderColor: markerColor, backgroundColor: color.panelRaised }]}>
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
          <Text style={styles.timeLabel}>
            {isFullDay ? "00:00" : `${startOffset >= 0 ? '+' : ''}${(startOffset / 60).toFixed(1)}h`}
          </Text>
          {isFullDay ? (
            <Text style={styles.timeLabel}>12:00</Text>
          ) : (
            localBaseTime && (
              <View style={styles.absoluteLabelOverlay} pointerEvents="none">
                <View style={[styles.absoluteLabelContainer, { left: `${baseTimePercentage}%` }]}>
                  <Text style={styles.timeLabel}>
                    {formatLocalTime(localBaseTime, 'HH:mm')}
                  </Text>
                </View>
              </View>
            )
          )}
          <Text style={styles.timeLabel}>
            {isFullDay ? "23:59" : `+${((startOffset + totalRange) / 60).toFixed(1)}h`}
          </Text>
        </View>
      </View>

      {/* ── 우측: Astro-HUD 카메라 셔터 모듈 ────────────────────────────── */}
      {onCameraPress && (
        <View style={styles.shutterModule}>
          {/* 'READY' 표시등은 뺐습니다 — 상태와 무관하게 늘 READY 라 뜻이 없었습니다(점검 2026-09-29). */}
          <PressScale
            style={styles.shutterBtn}
            onPress={onCameraPress}
            activeOpacity={0.78}
            accessibilityLabel={L3(language, 'AR 카메라 열기', 'Open AR camera', 'ARカメラを開く')}
            accessibilityRole="button"
          >
            <View style={styles.shutterOuterRing}>
              <View style={styles.shutterInnerCore}>
                <Camera size={19} color={color.onAccent} strokeWidth={2.4} />
              </View>
            </View>
          </PressScale>
          <Text style={styles.shutterLabel}>CAM / AR</Text>
        </View>
      )}
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  sliderSection: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    height: 24,
    zIndex: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  title: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  telemetryTagWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: color.fill,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: radius.xs,
    borderWidth: 0.5,
    borderColor: color.border,
    marginLeft: 4,
  },
  telemetryDot: {
    width: 4.5,
    height: 4.5,
    borderRadius: radius.xs,
  },
  telemetryTag: {
    fontSize: 9,
    fontWeight: '800',
    color: color.textDim,
    letterSpacing: 0.5,
    fontFamily: mono,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    zIndex: 10,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: color.accentSoft,
    borderWidth: 1,
    borderColor: color.accentLine,
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: radius.xs,
  },
  actionBtnText: {
    color: color.accent,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  nowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: color.sun,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: radius.xs,
  },
  nowBtnText: {
    color: color.onAccent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  sliderWrapper: {
    position: 'relative',
    height: 44,
    justifyContent: 'center',
  },
  markerOverlay: {
    width: '100%',
    height: '100%',
  },
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
    width: 9,
    height: 9,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coreDot: {
    width: 2.5,
    height: 2.5,
    borderRadius: radius.xs,
  },
  directionIndicator: {
    fontSize: 9,
    fontWeight: '900',
    opacity: 0.85,
  },
  tooltipText: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  timeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
    paddingHorizontal: 27,
    position: 'relative',
  },
  timeLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: color.textMute,
    fontFamily: mono,
  },
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
    marginLeft: -30,
    top: 0,
    bottom: 0,
  },

  /* ── Astro-HUD 카메라 셔터 모듈 스타일 ─────────────────────────── */
  shutterModule: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.fill,
    borderWidth: 1,
    borderColor: color.accentLine,
    borderRadius: radius.sm,
    paddingVertical: 5,
    paddingHorizontal: 7,
    gap: 3,
    height: 74,
  },
  shutterStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  shutterLed: {
    width: 4,
    height: 4,
    borderRadius: radius.xs,
    backgroundColor: color.success,
    shadowColor: color.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 3,
  },
  shutterStatusText: {
    color: color.success,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: mono,
  },
  shutterBtn: {
    shadowColor: color.sun,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 5,
  },
  shutterOuterRing: {
    width: 38,
    height: 38,
    borderRadius: radius.lg,
    backgroundColor: color.border,
    borderWidth: 1.5,
    borderColor: 'rgba(245, 158, 11, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterInnerCore: {
    width: 30,
    height: 30,
    borderRadius: radius.lg,
    backgroundColor: color.sun,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterLabel: {
    color: color.textDim,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    fontFamily: mono,
  },
}));
