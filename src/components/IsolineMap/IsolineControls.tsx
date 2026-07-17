import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Calendar, Clock, Play, Pause } from 'lucide-react-native';
import { GenericSlider } from '../GenericSlider';
import { getSeasonMarkers } from '../../utils/celestial';
import { t } from '../../utils/i18n';
import { useCelestialStore } from '../../store/useCelestialStore';

interface IsolineControlsProps {
  selectedDate: Date;
  onChangeDate: (date: Date) => void;
  onSlidingStart?: () => void;
  onSlidingComplete?: () => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  theme: any;
}

const daysInYear = (year: number) => Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000);

const getDayOfYear = (date: Date) => {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / 86400000) + 1;
};

const dateToDatePercent = (date: Date) => {
  const total = daysInYear(date.getUTCFullYear());
  return ((getDayOfYear(date) - 1) / (total - 1)) * 100;
};

const datePercentToDate = (percent: number, year: number, hour: number, minute: number) => {
  const total = daysInYear(year);
  const dayIndex = Math.round((Math.max(0, Math.min(100, percent)) / 100) * (total - 1));
  const base = Date.UTC(year, 0, 1, hour, minute, 0, 0);
  return new Date(base + dayIndex * 86400000);
};

const dateToTimePercent = (date: Date) => ((date.getUTCHours() * 60 + date.getUTCMinutes()) / 1440) * 100;

const timePercentToDate = (percent: number, baseDate: Date) => {
  const minutes = Math.min(1439, Math.max(0, Math.round((percent / 100) * 1440)));
  const d = new Date(baseDate);
  d.setUTCHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
};

const formatMonthDay = (date: Date) => `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
const formatHourMinute = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

export const IsolineControls: React.FC<IsolineControlsProps> = ({
  selectedDate,
  onChangeDate,
  onSlidingStart,
  onSlidingComplete,
  isPlaying,
  onTogglePlay,
  theme,
}) => {
  const { language } = useCelestialStore();
  const year = selectedDate.getUTCFullYear();

  const seasonMarkers = useMemo(() => getSeasonMarkers(year), [year]);

  const datePct = dateToDatePercent(selectedDate);
  const timePct = dateToTimePercent(selectedDate);

  const seasonButtons = [
    { key: 'spring', label: t('isolineSpring', language), date: seasonMarkers.springEquinox, color: '#4ADE80' },
    { key: 'summer', label: t('isolineSummer', language), date: seasonMarkers.summerSolstice, color: '#FFA500' },
    { key: 'autumn', label: t('isolineAutumn', language), date: seasonMarkers.autumnEquinox, color: '#F97316' },
    { key: 'winter', label: t('isolineWinter', language), date: seasonMarkers.winterSolstice, color: '#38BDF8' },
  ];

  const jumpToSeason = (target: Date) => {
    const next = new Date(target);
    next.setUTCHours(selectedDate.getUTCHours(), selectedDate.getUTCMinutes(), 0, 0);
    onChangeDate(next);
  };

  const seasonMarkerPositions = seasonButtons.map((s) => ({
    ...s,
    pct: dateToDatePercent(s.date),
  }));

  return (
    <View style={[styles.container, { backgroundColor: theme.glass, borderColor: theme.border }]}>
      {/* 계절 바로가기 버튼 */}
      <View style={styles.seasonRow}>
        {seasonButtons.map((s) => (
          <TouchableOpacity
            key={s.key}
            onPress={() => jumpToSeason(s.date)}
            style={[styles.seasonBtn, { backgroundColor: theme.bg, borderColor: theme.border }]}
            activeOpacity={0.7}
          >
            <View style={[styles.seasonDot, { backgroundColor: s.color }]} />
            <Text style={[styles.seasonBtnText, { color: theme.text }]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 날짜 슬라이더 (계절 마커 표시) */}
      <View style={styles.sliderBlock}>
        <View style={styles.sliderHeader}>
          <View style={styles.sliderHeaderLeft}>
            <Calendar size={12} color={theme.subText} />
            <Text style={[styles.sliderLabel, { color: theme.subText }]}>{t('isolineDateLabel', language)}</Text>
          </View>
          <Text style={[styles.sliderValue, { color: theme.text }]}>{formatMonthDay(selectedDate)}</Text>
        </View>
        <View style={styles.sliderWrapper}>
          <GenericSlider
            value={datePct}
            onChange={(p) => onChangeDate(datePercentToDate(p, year, selectedDate.getUTCHours(), selectedDate.getUTCMinutes()))}
            onGrant={onSlidingStart}
            onRelease={onSlidingComplete}
            theme={theme}
            trackColor={theme.bg === '#E8EDF2' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)'}
            fillColor={theme.accent}
            knobColor="#FFFFFF"
            trackOverlay={
              <View style={styles.markerOverlay} pointerEvents="none">
                {seasonMarkerPositions.map((s) => (
                  <View key={s.key} style={[styles.tickMarker, { left: `${s.pct}%` }]}>
                    <View style={[styles.tickDot, { backgroundColor: s.color }]} />
                  </View>
                ))}
              </View>
            }
          >
            <Text style={[styles.tooltipText, { color: '#1A1A1A' }]}>{formatMonthDay(selectedDate)}</Text>
          </GenericSlider>
        </View>
      </View>

      {/* 시각 슬라이더 (UTC) */}
      <View style={styles.sliderBlock}>
        <View style={styles.sliderHeader}>
          <View style={styles.sliderHeaderLeft}>
            <Clock size={12} color={theme.subText} />
            <Text style={[styles.sliderLabel, { color: theme.subText }]}>{t('isolineTimeLabel', language)}</Text>
          </View>
          <Text style={[styles.sliderValue, { color: theme.text }]}>{formatHourMinute(selectedDate)} UTC</Text>
        </View>
        <View style={styles.sliderWrapper}>
          <GenericSlider
            value={timePct}
            onChange={(p) => onChangeDate(timePercentToDate(p, selectedDate))}
            onGrant={onSlidingStart}
            onRelease={onSlidingComplete}
            theme={theme}
            trackColor={theme.bg === '#E8EDF2' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)'}
            fillColor="#38BDF8"
            knobColor="#FFFFFF"
          >
            <Text style={[styles.tooltipText, { color: '#1A1A1A' }]}>{formatHourMinute(selectedDate)}</Text>
          </GenericSlider>
        </View>
        <View style={styles.timeLabels}>
          <Text style={[styles.timeLabel, { color: theme.subText }]}>00:00</Text>
          <Text style={[styles.timeLabel, { color: theme.subText }]}>12:00</Text>
          <Text style={[styles.timeLabel, { color: theme.subText }]}>24:00</Text>
        </View>
      </View>

      {/* 자동 재생 버튼 */}
      <TouchableOpacity
        onPress={onTogglePlay}
        style={[styles.playBtn, { backgroundColor: isPlaying ? '#EF4444' : theme.accent }]}
        activeOpacity={0.8}
      >
        {isPlaying ? <Pause size={15} color="#000" fill="#000" /> : <Play size={15} color="#000" fill="#000" />}
        <Text style={styles.playBtnText}>{isPlaying ? t('isolinePause', language) : t('isolinePlay', language)}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 24,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    padding: 16,
    gap: 14,
  },
  seasonRow: {
    flexDirection: 'row',
    gap: 6,
  },
  seasonBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
  },
  seasonDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  seasonBtnText: {
    fontSize: 11,
    fontWeight: '800',
  },
  sliderBlock: {
    gap: 2,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  sliderHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sliderLabel: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sliderValue: {
    fontSize: 12,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  sliderWrapper: {
    position: 'relative',
  },
  markerOverlay: {
    width: '100%',
    height: '100%',
  },
  tickMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 12,
    marginLeft: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  tooltipText: {
    fontSize: 11,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  timeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 27,
    marginTop: 2,
  },
  timeLabel: {
    fontSize: 9,
    fontWeight: '700',
    opacity: 0.6,
  },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 16,
  },
  playBtnText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#000',
  },
});
