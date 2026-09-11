import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, useWindowDimensions } from 'react-native';
import { Calendar, Clock, Info, Sun, Sunrise, Sunset, Compass, Globe } from 'lucide-react-native';
import { useCelestialStore } from '../../store/useCelestialStore';
import { getSunPosition, getCelestialEvents, getSubsolarPoint, getTerminatorSegments } from '../../utils/celestial';
import { buildSunOverlay, isIsolineScale } from '../../utils/solarGeometry';
import { buildRadarFrame, isRadarScale } from '../../utils/cloudRadar';
import { fetchDayWeatherRing, CloudPathData } from '../../utils/weather';
import { localDateString } from '../../utils/localDate';
import { formatLocalTime, getLocalTimeAtLocation } from '../../utils/timezone';
import { t } from '../../utils/i18n';
import { IsolineControls } from './IsolineControls';
import { IsolineGuideModal } from './IsolineGuideModal';
import { MapCanvas } from './MapCanvas';
import { MapGlobe } from './MapGlobe';
import { SunAzimuthView } from '../MapScreen/SunAzimuthView';
import * as d3 from 'd3-geo';

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
  const [projectionType, setProjectionType] = useState<'2D' | '3D'>('2D');
  const [globeScale, setGlobeScale] = useState(150);

  const lat = location?.coords.latitude ?? 37.5665;
  const lon = location?.coords.longitude ?? 126.9780;

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // 줌 레벨에 따라 제공될 등시선 시간 간격 (4시간, 2시간, 1시간, 30분) - 렉 방지용 하한선 30분 지정
  const step = useMemo(() => {
    if (projectionType === '2D') {
      if (longitudeDelta >= 180) return 240; // 4시간
      if (longitudeDelta >= 90) return 120;  // 2시간
      if (longitudeDelta >= 40) return 60;   // 1시간
      return 30;                             // 30분
    } else {
      if (globeScale <= 120) return 240;     // 4시간
      if (globeScale <= 250) return 120;     // 2시간
      if (globeScale <= 500) return 60;      // 1시간
      return 30;                             // 30분
    }
  }, [projectionType, longitudeDelta, globeScale]);

  /**
   * 좁은 축척에서 지도에 얹을 **태양 오버레이**. 넓으면 null 입니다.
   *
   * 등치선과 태양경로는 같은 기하의 두 표현입니다 — 등고도선은 직하점 중심의
   * 원이고, 태양 방위는 그 원의 법선입니다(`solarGeometry.ts`). 화면 폭이 1°
   * 아래로 내려가면 등치선은 화면 안에서 5분도 안 벌어져 뜻을 잃으므로,
   * 같은 기하를 **법선 쪽**으로 바꿔 보여 줍니다.
   *
   * ⚠ 3D 지구본에는 안 붙입니다 — 거기서는 축척이 늘 넓습니다.
   */
  const sunOverlay = useMemo(
    () => (projectionType === '2D' ? buildSunOverlay(selectedDate, lat, lon, longitudeDelta) : null),
    [projectionType, selectedDate, lat, lon, longitudeDelta],
  );
  const isLocalScale = sunOverlay !== null;

  /**
   * 구름 레이더 자료. **스토어가 이미 미리 받아 둔 고리**라 캐시 적중입니다 —
   * 지도를 연다고 요청이 늘지 않습니다.
   *
   * ⚠ **오늘 날짜만** 씁니다. 다른 날을 고르면 그 날짜의 고리를 새로 받게 되는데
   * 97점짜리 요청이라 슬라이더를 미는 동안 계속 나갑니다. 날짜를 옮기면 레이더는
   * 조용히 사라집니다.
   */
  const [ring, setRing] = useState<CloudPathData[] | null>(null);
  const isToday = useMemo(
    () => localDateString(selectedDate) === localDateString(new Date()),
    [selectedDate],
  );
  const wantRadar = isToday && projectionType === '2D' && isRadarScale(longitudeDelta, lat);

  useEffect(() => {
    if (!wantRadar) return;
    let alive = true;
    fetchDayWeatherRing(lat, lon, new Date())
      .then(r => { if (alive) setRing(r); })
      .catch(err => console.warn('레이더용 구름 고리를 못 받았습니다:', err));
    return () => { alive = false; };
  }, [wantRadar, lat, lon]);

  const radar = useMemo(
    () => (wantRadar ? buildRadarFrame(ring, lat, lon, selectedDate.getTime(), longitudeDelta) : null),
    [wantRadar, ring, lat, lon, selectedDate, longitudeDelta],
  );

  const dateKey = selectedDate.toISOString().slice(0, 10);
  const allTerminators = useMemo(() => {
    // 좁은 축척에서는 안 그리므로 만들지도 않습니다 — 하루치 터미네이터를
    // 48번 계산하는 일이라 그냥 두면 값만 버립니다.
    if (!isIsolineScale(longitudeDelta) && projectionType === '2D') return [];
    const list = [];
    const base = new Date(dateKey);
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
  }, [dateKey, step, longitudeDelta, projectionType]);

  const nightPolygonCoords = useMemo(() => {
    try {
      // 구글맵 Polygon의 래핑 반전 특성에 대응하기 위해,
      // 안티포달 포인트 대신 태양 남중점(subsolar) 자체를 투사 원점으로 주어 바깥쪽(밤 영역)이 칠해지도록 유도합니다.
      const circleGeoJSON = d3.geoCircle().center([subsolar.longitude, subsolar.latitude]).radius(90)();
      if (!circleGeoJSON || !circleGeoJSON.coordinates) return [];

      const segments: Array<Array<{ latitude: number; longitude: number }>> = [];

      if (circleGeoJSON.type === 'Polygon') {
        circleGeoJSON.coordinates.forEach((ring: any) => {
          const seg = ring.map((pt: [number, number]) => ({
            longitude: pt[0],
            latitude: pt[1]
          }));
          if (seg.length > 0) segments.push(seg);
        });
      } else if (circleGeoJSON.type === 'MultiPolygon') {
        circleGeoJSON.coordinates.forEach((polygon: any) => {
          polygon.forEach((ring: any) => {
            const seg = ring.map((pt: [number, number]) => ({
              longitude: pt[0],
              latitude: pt[1]
            }));
            if (seg.length > 0) segments.push(seg);
          });
        });
      }
      return segments;
    } catch (e) {
      console.error('Failed to generate 2D night polygon:', e);
      return [];
    }
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
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
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

      {/* 가변 메인 프레임: 지도가 화면의 남은 높이를 꽉 채웁니다 */}
      <View 
        style={[styles.mapCard, { borderColor: theme.border }]}
        onTouchStart={() => useCelestialStore.getState().setGestureBlocked(true)}
        onTouchEnd={() => useCelestialStore.getState().setGestureBlocked(false)}
        onTouchCancel={() => useCelestialStore.getState().setGestureBlocked(false)}
      >
        {projectionType === '2D' ? (
          <MapCanvas
            lat={lat}
            lon={lon}
            hasLocation={!!location}
            subsolar={subsolar}
            terminator={terminator}
            allTerminators={allTerminators}
            nightPolygonCoords={nightPolygonCoords}
            onRegionChangeComplete={handleRegionChangeComplete}
            theme={theme}
            selectedDate={selectedDate}
            sunOverlay={sunOverlay}
            radar={radar}
          />
        ) : (
          <MapGlobe
            subsolar={subsolar}
            terminator={terminator}
            allTerminators={allTerminators}
            lat={lat}
            lon={lon}
            hasLocation={!!location}
            theme={theme}
            isActive={isActive}
            initialScale={globeScale}
            selectedDate={selectedDate}
            onScaleChange={setGlobeScale}
          />
        )}

        <TouchableOpacity
          onPress={() => setProjectionType((p) => (p === '2D' ? '3D' : '2D'))}
          style={[styles.projectionBtn, { backgroundColor: theme.glass, borderColor: theme.border }]}
          activeOpacity={0.7}
        >
          {projectionType === '2D' ? (
            <Globe size={16} color={theme.text} />
          ) : (
            <Compass size={16} color={theme.accent} />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setGuideVisible(true)}
          style={[styles.guideBtn, { backgroundColor: theme.glass, borderColor: theme.border }]}
          activeOpacity={0.7}
        >
          <Info size={16} color={theme.text} />
        </TouchableOpacity>

        {/* 지도 우측 상단 태양 정보 오버레이 배지 */}
        <View style={[styles.solarOverlay, { backgroundColor: theme.glass, borderColor: theme.border }]}>
          <View style={styles.solarOverlayItem}>
            <Sun size={11} color="#FFD700" />
            <Text style={[styles.solarOverlayText, { color: theme.text }]}>
              {sunPosAtSelected.altitude.toFixed(0)}° / {sunPosAtSelected.azimuth.toFixed(0)}°
            </Text>
          </View>
          <View style={[styles.solarOverlayDivider, { backgroundColor: theme.border }]} />
          <View style={styles.solarOverlayItem}>
            <Sunrise size={11} color="#FFA500" />
            <Text style={[styles.solarOverlayText, { color: theme.text }]}>
              {formatLocalTime(localSunrise, 'HH:mm')}
            </Text>
          </View>
          <View style={[styles.solarOverlayDivider, { backgroundColor: theme.border }]} />
          <View style={styles.solarOverlayItem}>
            <Sunset size={11} color="#FF4500" />
            <Text style={[styles.solarOverlayText, { color: theme.text }]}>
              {formatLocalTime(localSunset, 'HH:mm')}
            </Text>
          </View>
        </View>

        {/* ── 극좌표 인셋 ────────────────────────────────────────────────
               좁은 축척에서만 뜹니다. 지도 평면은 방위는 그려도 **고도**를
               못 그립니다 — 그건 이 원만 가진 값입니다. */}
        {isLocalScale && (
          <View style={[styles.polarInset, { backgroundColor: theme.glass, borderColor: theme.border }]}>
            <SunAzimuthView theme={theme} currentTime={selectedDate} compact />
          </View>
        )}

        <View style={[styles.legend, { backgroundColor: theme.glass, borderColor: theme.border }]}>
          {radar && (
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, { backgroundColor: 'rgba(226,232,240,0.75)' }]} />
              <Text style={[styles.legendText, { color: theme.subText }]}>
                구름 · 바깥 칸 {Math.round(radar.outerSpacingKm)}km
              </Text>
            </View>
          )}
          {isLocalScale ? (
            <>
              <View style={styles.legendItem}>
                <View style={[styles.legendLine, { backgroundColor: '#38BDF8' }]} />
                <Text style={[styles.legendText, { color: theme.subText }]}>등고도선</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendLine, { backgroundColor: '#FB923C' }]} />
                <Text style={[styles.legendText, { color: theme.subText }]}>태양 방위 (그 법선)</Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.legendItem}>
                <View style={[styles.legendLine, { backgroundColor: '#FFA500' }]} />
                <Text style={[styles.legendText, { color: theme.subText }]}>{t('isolineSunriseLine', language)}</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendLine, { backgroundColor: '#FF4500' }]} />
                <Text style={[styles.legendText, { color: theme.subText }]}>{t('isolineSunsetLine', language)}</Text>
              </View>
            </>
          )}
        </View>
      </View>

      {/* 화면 최하단 시간/날짜 조작 컨트롤러 */}
      <View style={styles.bottomControls}>
        <IsolineControls
          selectedDate={selectedDate}
          onChangeDate={setSelectedDate}
          onSlidingStart={handleSlidingStart}
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying((p) => !p)}
          theme={theme}
        />
      </View>

      <IsolineGuideModal visible={guideVisible} onClose={() => setGuideVisible(false)} theme={theme} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  headerRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  headerChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
  },
  headerIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerLabel: {
    fontSize: 8,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  headerValue: {
    fontSize: 12,
    fontWeight: '900',
  },
  mapCard: {
    flex: 1,
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    position: 'relative',
  },
  guideBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    zIndex: 10,
  },
  projectionBtn: {
    position: 'absolute',
    top: 10,
    right: 48,
    width: 32,
    height: 32,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    zIndex: 10,
  },
  solarOverlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    gap: 8,
    zIndex: 10,
  },
  solarOverlayItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  solarOverlayText: {
    fontSize: 9.5,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.3,
  },
  solarOverlayDivider: {
    width: 1,
    height: 10,
    opacity: 0.4,
  },
  polarInset: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    overflow: 'hidden',
  },
  legend: {
    position: 'absolute',
    bottom: 8,
    left: 10,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    zIndex: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendLine: {
    width: 10,
    height: 3,
    borderRadius: 1,
  },
  legendText: {
    fontSize: 8.5,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.2,
  },
  bottomControls: {
    marginTop: 6,
  },
});
