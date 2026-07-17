import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, useWindowDimensions, ScrollView } from 'react-native';
import { Calendar, Clock, Info, Sun, Sunrise, Sunset, Compass, MapPin, Hourglass } from 'lucide-react-native';
import { useCelestialStore } from '../../store/useCelestialStore';
import { getSunPosition, getCelestialEvents, getSubsolarPoint, getTerminatorSegments } from '../../utils/celestial';
import { formatLocalTime, getLocalTimeAtLocation } from '../../utils/timezone';
import { t } from '../../utils/i18n';
import { IsolineControls } from './IsolineControls';
import { IsolineGuideModal } from './IsolineGuideModal';
import { MapCanvas } from './MapCanvas';

// InfoCard는 window 폭 기준 고정 width(30%)를 쓰기 때문에 태블릿 2단 레이아웃의
// 좁은 사이드 패널 안에서는 넘칠 수 있어, 여기서는 flex 기반의 자체 타일을 사용합니다.
const StatTile: React.FC<{ icon: React.ReactNode; label: string; value: string; theme: any }> = ({ icon, label, value, theme }) => (
  <View style={styles.statTile}>
    <View style={[styles.statIconWrap, { backgroundColor: theme.bg }]}>{icon}</View>
    <View style={{ flex: 1 }}>
      <Text style={[styles.statLabel, { color: theme.subText }]} numberOfLines={1}>{label}</Text>
      <Text style={[styles.statValue, { color: theme.text }]} numberOfLines={1}>{value}</Text>
    </View>
  </View>
);

interface IsolineMapProps {
  theme: any;
  currentTime: Date;
  isActive: boolean;
}

const AUTOPLAY_TICK_MS = 150;
const AUTOPLAY_STEP_MINUTES = 20;

export const IsolineMap: React.FC<IsolineMapProps> = ({ theme, currentTime, isActive }) => {
  const { location, timezoneOffsetHours, language } = useCelestialStore();
  const { width } = useWindowDimensions();
  const isTablet = width > 900;

  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date(currentTime));
  const [isPlaying, setIsPlaying] = useState(false);
  const [guideVisible, setGuideVisible] = useState(false);
  const [longitudeDelta, setLongitudeDelta] = useState(60);

  const lat = location?.coords.latitude ?? 37.5665;
  const lon = location?.coords.longitude ?? 126.9780;

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleRegionChangeComplete = useCallback((region: { longitudeDelta: number }) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setLongitudeDelta(region.longitudeDelta);
    }, 350); // 350ms 디바운스
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // 탭이 비활성화되면(다른 탭으로 스와이프) 자동재생을 일시정지해 배터리/성능을 절약합니다.
  useEffect(() => {
    if (!isActive && isPlaying) setIsPlaying(false);
  }, [isActive]);

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setSelectedDate((prev) => new Date(prev.getTime() + AUTOPLAY_STEP_MINUTES * 60 * 1000));
    }, AUTOPLAY_TICK_MS);
    return () => clearInterval(interval);
  }, [isPlaying]);

  const terminator = useMemo(() => getTerminatorSegments(selectedDate), [selectedDate]);
  const subsolar = useMemo(() => getSubsolarPoint(selectedDate), [selectedDate]);

  // 최소 간격을 10분으로 조정하여 렌더링 성능 최적화 (버벅임 방지)
  const step = useMemo(() => {
    if (longitudeDelta >= 120) return 120;
    if (longitudeDelta >= 60) return 60;
    if (longitudeDelta >= 20) return 30;
    if (longitudeDelta >= 8) return 15;
    return 10;
  }, [longitudeDelta]);

  const allTerminators = useMemo(() => {
    const list = [];
    const base = new Date(selectedDate);
    base.setUTCHours(0, 0, 0, 0);
    
    for (let min = 0; min < 1440; min += step) {
      const time = new Date(base.getTime() + min * 60 * 1000);
      const segments = getTerminatorSegments(time);
      list.push({
        time,
        sunrise: segments.sunrise,
        sunset: segments.sunset
      });
    }
    return list;
  }, [selectedDate, step]);

  const nightStripes = useMemo(() => {
    const lat_s = subsolar.latitude * (Math.PI / 180);
    const lon_s = subsolar.longitude * (Math.PI / 180);
    const stripes: Array<Array<{ latitude: number; longitude: number }>> = [];

    const LAT_STEP = 10;
    const LON_STEP = 10;

    for (let latDeg = -90; latDeg < 90; latDeg += LAT_STEP) {
      const latMin = latDeg;
      const latMax = latDeg + LAT_STEP;
      const latMid = (latMin + latMax) / 2;
      const latMidRad = latMid * (Math.PI / 180);

      let inNight = false;
      let startLon = -180;

      for (let lonDeg = -180; lonDeg <= 180; lonDeg += LON_STEP) {
        const currLon = Math.min(180, lonDeg);
        const lonRad = currLon * (Math.PI / 180);

        const sin_alt = Math.sin(latMidRad) * Math.sin(lat_s) + Math.cos(latMidRad) * Math.cos(lat_s) * Math.cos(lonRad - lon_s);
        const isNight = sin_alt < 0;

        if (isNight && !inNight) {
          inNight = true;
          startLon = currLon;
        } else if (!isNight && inNight) {
          inNight = false;
          stripes.push([
            { latitude: latMin, longitude: startLon },
            { latitude: latMin, longitude: currLon },
            { latitude: latMax, longitude: currLon },
            { latitude: latMax, longitude: startLon },
          ]);
        }
      }
      if (inNight) {
        stripes.push([
          { latitude: latMin, longitude: startLon },
          { latitude: latMin, longitude: 180 },
          { latitude: latMax, longitude: 180 },
          { latitude: latMax, longitude: startLon },
        ]);
      }
    }
    return stripes;
  }, [subsolar]);

  const sunPosAtSelected = useMemo(() => getSunPosition(selectedDate, lat, lon), [selectedDate, lat, lon]);
  const eventsAtSelected = useMemo(() => getCelestialEvents(selectedDate, lat, lon), [selectedDate, lat, lon]);

  const localSunrise = useMemo(() => getLocalTimeAtLocation(eventsAtSelected.sunrise, timezoneOffsetHours), [eventsAtSelected, timezoneOffsetHours]);
  const localSunset = useMemo(() => getLocalTimeAtLocation(eventsAtSelected.sunset, timezoneOffsetHours), [eventsAtSelected, timezoneOffsetHours]);

  const dayLengthLabel = useMemo(() => {
    const totalMin = Math.max(0, Math.round((eventsAtSelected.sunset.getTime() - eventsAtSelected.sunrise.getTime()) / 60000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}h ${m}m`;
  }, [eventsAtSelected]);

  const dateLabel = useMemo(() => {
    return `${selectedDate.getUTCFullYear()}.${String(selectedDate.getUTCMonth() + 1).padStart(2, '0')}.${String(selectedDate.getUTCDate()).padStart(2, '0')}`;
  }, [selectedDate]);

  const timeLabel = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(selectedDate.getUTCHours())}:${pad(selectedDate.getUTCMinutes())} UTC`;
  }, [selectedDate]);

  const handleSlidingStart = () => setIsPlaying(false);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <View style={[styles.headerChip, { backgroundColor: theme.glass, borderColor: theme.border }]}>
          <View style={[styles.headerIconWrap, { backgroundColor: theme.bg }]}>
            <Calendar size={14} color={theme.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerLabel, { color: theme.subText }]} numberOfLines={1}>{t('isolineSelectedDate', language)}</Text>
            <Text style={[styles.headerValue, { color: theme.text }]} numberOfLines={1}>{dateLabel}</Text>
          </View>
        </View>
        <View style={[styles.headerChip, { backgroundColor: theme.glass, borderColor: theme.border }]}>
          <View style={[styles.headerIconWrap, { backgroundColor: theme.bg }]}>
            <Clock size={14} color="#38BDF8" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerLabel, { color: theme.subText }]} numberOfLines={1}>{t('isolineSelectedTimeUtc', language)}</Text>
            <Text style={[styles.headerValue, { color: theme.text }]} numberOfLines={1}>{timeLabel}</Text>
          </View>
        </View>
      </View>

      <View style={[styles.mainWrapper, isTablet && styles.tabletMainWrapper]}>
        <View 
          style={[styles.mapCard, isTablet && styles.tabletMapCard, { borderColor: theme.border }]}
          onTouchStart={() => useCelestialStore.getState().setGestureBlocked(true)}
          onTouchEnd={() => useCelestialStore.getState().setGestureBlocked(false)}
          onTouchCancel={() => useCelestialStore.getState().setGestureBlocked(false)}
        >
          <MapCanvas
            lat={lat}
            lon={lon}
            hasLocation={!!location}
            subsolar={subsolar}
            terminator={terminator}
            allTerminators={allTerminators}
            nightStripes={nightStripes}
            onRegionChangeComplete={handleRegionChangeComplete}
            theme={theme}
          />

          <TouchableOpacity
            onPress={() => setGuideVisible(true)}
            style={[styles.guideBtn, { backgroundColor: theme.glass, borderColor: theme.border }]}
            activeOpacity={0.7}
          >
            <Info size={16} color={theme.text} />
          </TouchableOpacity>

          <View style={[styles.legend, { backgroundColor: theme.glass, borderColor: theme.border }]}>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, { backgroundColor: '#FFA500' }]} />
              <Text style={[styles.legendText, { color: theme.subText }]}>{t('isolineSunriseLine', language)}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, { backgroundColor: '#FF4500' }]} />
              <Text style={[styles.legendText, { color: theme.subText }]}>{t('isolineSunsetLine', language)}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.sidePanel, isTablet && styles.tabletSidePanel]}>
          <IsolineControls
            selectedDate={selectedDate}
            onChangeDate={setSelectedDate}
            onSlidingStart={handleSlidingStart}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            theme={theme}
          />

          <View style={[styles.infoFrame, { backgroundColor: theme.glass, borderColor: theme.border }]}>
            <View style={styles.frameHeader}>
              <MapPin size={12} color={theme.accent} />
              <Text style={[styles.frameLabel, { color: theme.subText }]}>{t('isolineLocationInfo', language)}</Text>
            </View>
            <View style={styles.grid}>
              <StatTile
                icon={<MapPin size={14} color={theme.accent} />}
                label={t('latitude', language)}
                value={`${lat.toFixed(2)}°`}
                theme={theme}
              />
              <StatTile
                icon={<MapPin size={14} color={theme.accent} />}
                label={t('longitude', language)}
                value={`${lon.toFixed(2)}°`}
                theme={theme}
              />
            </View>
          </View>

          <View style={[styles.infoFrame, { backgroundColor: theme.glass, borderColor: theme.border }]}>
            <View style={styles.frameHeader}>
              <Sun size={12} color="#FFD700" />
              <Text style={[styles.frameLabel, { color: theme.subText }]}>{t('isolineSolarInfo', language)}</Text>
            </View>
            <View style={styles.grid}>
              <StatTile
                icon={<Compass size={14} color="#FFD700" />}
                label={t('solarAltitude', language)}
                value={`${sunPosAtSelected.altitude.toFixed(0)}°`}
                theme={theme}
              />
              <StatTile
                icon={<Compass size={14} color="#FFD700" />}
                label={t('solarAzimuth', language)}
                value={`${sunPosAtSelected.azimuth.toFixed(0)}°`}
                theme={theme}
              />
            </View>
            <View style={styles.grid}>
              <StatTile
                icon={<Sunrise size={14} color="#FFA500" />}
                label={t('sunrise', language)}
                value={formatLocalTime(localSunrise, 'HH:mm')}
                theme={theme}
              />
              <StatTile
                icon={<Sunset size={14} color="#FF4500" />}
                label={t('sunset', language)}
                value={formatLocalTime(localSunset, 'HH:mm')}
                theme={theme}
              />
              <StatTile
                icon={<Hourglass size={14} color="#38BDF8" />}
                label={t('dayLength', language)}
                value={dayLengthLabel}
                theme={theme}
              />
            </View>
          </View>
        </View>
      </View>

      <IsolineGuideModal visible={guideVisible} onClose={() => setGuideVisible(false)} theme={theme} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  headerChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    borderRadius: 16,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
  },
  headerIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerLabel: {
    fontSize: 8.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  headerValue: {
    fontSize: 13,
    fontWeight: '900',
  },
  mainWrapper: {
    gap: 12,
  },
  tabletMainWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  mapCard: {
    height: 280,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    position: 'relative',
  },
  tabletMapCard: {
    flex: 1,
    height: 520,
  },
  guideBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  legend: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendLine: {
    width: 12,
    height: 3,
    borderRadius: 1.5,
  },
  legendText: {
    fontSize: 9,
    fontWeight: '700',
  },
  sidePanel: {
    gap: 10,
    marginTop: 12,
  },
  tabletSidePanel: {
    flex: 1,
    marginTop: 0,
    marginLeft: 12,
  },
  infoFrame: {
    borderRadius: 20,
    padding: 10,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
  },
  frameHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    marginBottom: 4,
    gap: 6,
  },
  frameLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statTile: {
    flexBasis: '50%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
    minWidth: 100,
  },
  statIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 8,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '800',
  },
});
