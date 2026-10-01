import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Calendar, Clock, Play, Pause } from 'lucide-react-native';
import { GenericSlider } from '../GenericSlider';
import { getSeasonMarkers } from '../../utils/celestial';
import { t } from '../../utils/i18n';
import { useCelestialStore } from '../../store/useCelestialStore';
import { color, radius, mono, dataColor } from '../../theme/tokens';
import { PressScale, PrimaryButton } from '../ui';
import { makeStyles, useThemeColors, useDataColors } from '../../theme/useTheme';

interface IsolineControlsProps {
  selectedDate: Date;
  onChangeDate: (date: Date) => void;
  onSlidingStart?: () => void;
  onSlidingComplete?: () => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  theme: any;
}

/**
 * ⚠ 시각은 **관측지 현지 시각**으로 보이고 다룹니다(점검 2026-09-29). 예전에는 지도 탭만 UTC 라
 *   하늘 탭이 22:07 일 때 지도는 13:07 UTC 였습니다. 기기 시간대가 아니라 관측지 시간대
 *   (`timezoneOffsetHours`)로 옮긴 날짜를 getUTC* 로 읽어, 어느 나라 기기에서도 같게 셉니다.
 */
const shift = (d: Date, tz: number) => new Date(d.getTime() + tz * 3600000);
const unshift = (ms: number, tz: number) => new Date(ms - tz * 3600000);

const daysInYear = (year: number) => Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000);

const getDayOfYear = (local: Date) => {
  const start = Date.UTC(local.getUTCFullYear(), 0, 1);
  return Math.floor((local.getTime() - start) / 86400000) + 1;
};

const dateToDatePercent = (date: Date, tz: number) => {
  const local = shift(date, tz);
  const total = daysInYear(local.getUTCFullYear());
  return ((getDayOfYear(local) - 1) / (total - 1)) * 100;
};

const datePercentToDate = (percent: number, year: number, hour: number, minute: number, tz: number) => {
  const total = daysInYear(year);
  const dayIndex = Math.round((Math.max(0, Math.min(100, percent)) / 100) * (total - 1));
  const base = Date.UTC(year, 0, 1, hour, minute, 0, 0);
  return unshift(base + dayIndex * 86400000, tz);
};

const dateToTimePercent = (date: Date, tz: number) => {
  const l = shift(date, tz);
  return ((l.getUTCHours() * 60 + l.getUTCMinutes()) / 1440) * 100;
};

const timePercentToDate = (percent: number, baseDate: Date, tz: number) => {
  const minutes = Math.min(1439, Math.max(0, Math.round((percent / 100) * 1440)));
  const l = shift(baseDate, tz);
  l.setUTCHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return unshift(l.getTime(), tz);
};

const pad = (n: number) => String(n).padStart(2, '0');
const formatMonthDay = (date: Date, tz: number) => { const l = shift(date, tz); return `${l.getUTCMonth() + 1}/${l.getUTCDate()}`; };
const formatHourMinute = (date: Date, tz: number) => { const l = shift(date, tz); return `${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}`; };

export const IsolineControls: React.FC<IsolineControlsProps> = ({
  selectedDate,
  onChangeDate,
  onSlidingStart,
  onSlidingComplete,
  isPlaying,
  onTogglePlay,
  theme,
}) => {
  const color = useThemeColors(); const dataColor = useDataColors(); const styles = useStyles();
  const { language, timezoneOffsetHours } = useCelestialStore();
  const tz = timezoneOffsetHours ?? 0;
  const localNow = shift(selectedDate, tz);
  const year = localNow.getUTCFullYear();

  const seasonMarkers = useMemo(() => getSeasonMarkers(year), [year]);

  const datePct = dateToDatePercent(selectedDate, tz);
  const timePct = dateToTimePercent(selectedDate, tz);

  const seasonButtons = [
    { key: 'spring', label: t('isolineSpring', language), date: seasonMarkers.springEquinox, color: dataColor.spring },
    { key: 'summer', label: t('isolineSummer', language), date: seasonMarkers.summerSolstice, color: dataColor.summer },
    { key: 'autumn', label: t('isolineAutumn', language), date: seasonMarkers.autumnEquinox, color: dataColor.autumn },
    { key: 'winter', label: t('isolineWinter', language), date: seasonMarkers.winterSolstice, color: dataColor.winter },
  ];

  const jumpToSeason = (target: Date) => {
    // 그 절기 **현지 날짜**에 지금의 현지 시각을 그대로.
    const l = shift(target, tz);
    l.setUTCHours(localNow.getUTCHours(), localNow.getUTCMinutes(), 0, 0);
    onChangeDate(unshift(l.getTime(), tz));
  };

  const seasonMarkerPositions = seasonButtons.map((s) => ({
    ...s,
    pct: dateToDatePercent(s.date, tz),
  }));

  return (
    <View style={[styles.container, { backgroundColor: theme.glass, borderColor: theme.border }]}>
      {/* 계절 바로가기 버튼 */}
      <View style={styles.seasonRow}>
        {seasonButtons.map((s) => (
          <PressScale
            key={s.key}
            onPress={() => jumpToSeason(s.date)}
            style={[styles.seasonBtn, { backgroundColor: theme.bg, borderColor: theme.border }]}
            activeOpacity={0.7}
          >
            <View style={[styles.seasonDot, { backgroundColor: s.color }]} />
            <Text style={[styles.seasonBtnText, { color: theme.text }]}>{s.label}</Text>
          </PressScale>
        ))}
      </View>

      {/* 날짜 슬라이더 (계절 마커 표시) */}
      <View style={styles.sliderBlock}>
        <View style={styles.sliderHeader}>
          <View style={styles.sliderHeaderLeft}>
            <Calendar size={12} color={theme.subText} />
            <Text style={[styles.sliderLabel, { color: theme.subText }]}>{t('isolineDateLabel', language)}</Text>
          </View>
          <Text style={[styles.sliderValue, { color: theme.text }]}>{formatMonthDay(selectedDate, tz)}</Text>
        </View>
        <View style={styles.sliderWrapper}>
          <GenericSlider
            value={datePct}
            onChange={(p) => onChangeDate(datePercentToDate(p, year, localNow.getUTCHours(), localNow.getUTCMinutes(), tz))}
            onGrant={onSlidingStart}
            onRelease={onSlidingComplete}
            theme={theme}
            trackColor={color.border}
            fillColor={theme.accent}
            knobColor={color.panelRaised}
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
            <Text style={[styles.tooltipText, { color: color.accent }]}>{formatMonthDay(selectedDate, tz)}</Text>
          </GenericSlider>
        </View>
      </View>

      {/* 시각 슬라이더 — 현지 시각. UTC 는 곁에 작게(등시선이 세계 시각이므로). */}
      <View style={styles.sliderBlock}>
        <View style={styles.sliderHeader}>
          <View style={styles.sliderHeaderLeft}>
            <Clock size={12} color={theme.subText} />
            <Text style={[styles.sliderLabel, { color: theme.subText }]}>
              {t('isolineTimeLabel', language)}
              {/* UTC 는 왼쪽에 작게 — 오른쪽은 끝자락에서 슬라이더 말풍선이 덮습니다. */}
              {`  · ${formatHourMinute(selectedDate, 0)} UTC`}
            </Text>
          </View>
          <Text style={[styles.sliderValue, { color: theme.text }]}>{formatHourMinute(selectedDate, tz)}</Text>
        </View>
        <View style={styles.sliderWrapper}>
          <GenericSlider
            value={timePct}
            onChange={(p) => onChangeDate(timePercentToDate(p, selectedDate, tz))}
            onGrant={onSlidingStart}
            onRelease={onSlidingComplete}
            theme={theme}
            trackColor={color.border}
            fillColor={color.accent}
            knobColor={color.panelRaised}
          >
            <Text style={[styles.tooltipText, { color: color.accent }]}>{formatHourMinute(selectedDate, tz)}</Text>
          </GenericSlider>
        </View>
        <View style={styles.timeLabels}>
          <Text style={[styles.timeLabel, { color: theme.subText }]}>00:00</Text>
          <Text style={[styles.timeLabel, { color: theme.subText }]}>12:00</Text>
          <Text style={[styles.timeLabel, { color: theme.subText }]}>24:00</Text>
        </View>
      </View>

      {/* 자동 재생 — 이 패널의 주 동작. 재생 중엔 "멈춤" 이 되어 danger 색. */}
      <PrimaryButton
        onPress={onTogglePlay}
        tone={isPlaying ? 'danger' : 'accent'}
        icon={isPlaying ? <Pause size={15} color={color.onAccent} fill={color.onAccent} /> : <Play size={15} color={color.onAccent} fill={color.onAccent} />}
        label={isPlaying ? t('isolinePause', language) : t('isolinePlay', language)}
      />
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  container: {
    borderRadius: radius.xs,
    borderWidth: 1,
    padding: 14,
    gap: 12,
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
    paddingVertical: 7,
    borderRadius: radius.xs,
    borderWidth: 1,
  },
  seasonDot: {
    width: 5,
    height: 5,
    borderRadius: 1,
  },
  seasonBtnText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.3,
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
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontFamily: mono,
  },
  sliderValue: {
    fontSize: 13,
    fontWeight: '900',
    fontFamily: mono,
    letterSpacing: 0.4,
  },
  sliderWrapper: {
    position: 'relative',
    // 손잡이(시각 말풍선)가 트랙 위로 14px 솟습니다 — 그만큼 비워 두어야 라벨 줄을 덮지 않습니다.
    marginTop: 14,
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
    width: 4,
    height: 4,
    borderRadius: 1,
  },
  tooltipText: {
    fontSize: 11,
    fontWeight: '900',
    fontFamily: mono,
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
    fontFamily: mono,
    opacity: 0.7,
  },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 38,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
  },
  playBtnText: {
    fontSize: 11,
    fontWeight: '900',
    fontFamily: mono,
    letterSpacing: 0.8,
    color: '#000',
  },
}));
