import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SlidersHorizontal, Sparkles, Sun, Sunset, Moon, Star, Flame, Compass, Target } from 'lucide-react-native';
import { SkyScene3D, DEFAULT_SKY_SETTINGS, LayerState, SkySettings } from './SkyScene3D/SkyScene3D';
import { LayerControlModal } from './SunsetSimulation/LayerControlModal';
import { TimeSlider } from './TimeSlider';
import { useCelestialStore } from '../store/useCelestialStore';
import {
  fetchTerrainProfile,
  fetchSunsetWeather,
  getInterpolatedWeather,
  type CloudPathData,
} from '../utils/weather';
import { predictSunset } from '../utils/sunsetPhysics';
import SunCalc from 'suncalc';

interface Sim3DContainerProps {
  theme: any;
  currentTime: Date;
  setCurrentTime: (time: Date) => void;
  isTimeMachineEnabled?: boolean;
  setTimeMachineEnabled?: (enabled: boolean) => void;
  events?: {
    sunrise?: Date;
    sunset?: Date;
    moonrise?: Date;
    moonset?: Date;
  };
  setMapVisible?: (visible: boolean) => void;
}

export interface EventItem {
  id: string;
  title: string;
  time: Date;
  category: 'featured' | 'general';
  icon?: string;
  badge?: string;
  description: string;
}

export const Sim3DContainer: React.FC<Sim3DContainerProps> = ({
  theme,
  currentTime,
  setCurrentTime,
  isTimeMachineEnabled = true,
  setTimeMachineEnabled,
  events,
  setMapVisible,
}) => {
  const { location } = useCelestialStore();
  const [isLayerModalVisible, setLayerModalVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<'featured' | 'general'>('featured');
  const [trackingTarget, setTrackingTarget] = useState<string | null>(null);
  const [layers, setLayers] = useState<LayerState>({
    labels: true,
    sun: true,
    moon: true,
    stars: true,
    milkyway: true,
    planets: true,
    clouds: true,
    paths: true,
  });
  const [skySettings, setSkySettings] = useState<SkySettings>(DEFAULT_SKY_SETTINGS);

  const latitude = location?.coords.latitude ?? 37.5665;
  const longitude = location?.coords.longitude ?? 126.9780;

  // 3D 지형 실루엣 및 사용자 해발 고도 State
  const [terrainData, setTerrainData] = useState<{
    panoramicAngles: number[];
    observerElevation: number;
  }>({
    panoramicAngles: [],
    observerElevation: location?.coords.altitude ?? 50,
  });

  useEffect(() => {
    if (latitude && longitude) {
      fetchTerrainProfile(latitude, longitude, 0, 360)
        .then(tData => {
          if (tData && Array.isArray(tData.panoramicAngles)) {
            setTerrainData({
              panoramicAngles: tData.panoramicAngles,
              observerElevation: tData.observerElevation ?? location?.coords?.altitude ?? 50,
            });
          }
        })
        .catch(err => {
          console.log('3D terrain profile fetch error:', err);
        });
    }
  }, [latitude, longitude]);

  const simObj = useMemo(() => ({
    terrain: {
      panoramicAngles: terrainData.panoramicAngles,
      observerElevation: terrainData.observerElevation,
    },
  }), [terrainData]);

  const sunPos = SunCalc.getPosition(currentTime, latitude, longitude);
  const sunAltitude = (sunPos.altitude * 180) / Math.PI;
  const sunAzimuth = (sunPos.azimuth * 180) / Math.PI + 180;

  // ── 실제 기상 데이터 ─────────────────────────────────────────────────────
  // 이게 없으면 3D 씬의 구름은 전부 위경도 해시로만 만들어져서
  // 흐린 날과 맑은 날의 화면이 완전히 같아집니다.
  const [pathData, setPathData] = useState<CloudPathData[]>([]);
  const currentDateStr = useMemo(
    () => `${currentTime.getFullYear()}-${currentTime.getMonth() + 1}-${currentTime.getDate()}`,
    [currentTime]
  );
  // 방위는 30° 버킷으로 캐시되므로 태양 방위가 조금 움직여도 재요청이 없습니다.
  const bucketedSunAz = useMemo(() => Math.round(sunAzimuth / 30) * 30, [sunAzimuth]);

  useEffect(() => {
    let cancelled = false;
    if (!latitude || !longitude) return;

    fetchSunsetWeather(latitude, longitude, bucketedSunAz, false, currentTime)
      .then(data => {
        if (!cancelled && Array.isArray(data)) setPathData(data);
      })
      .catch(err => {
        console.log('3D weather fetch error:', err);
      });

    return () => {
      cancelled = true;
    };
    // currentTime 전체가 아니라 날짜·방위 버킷에만 반응해야 슬라이더마다 재요청하지 않습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude, currentDateStr, bucketedSunAz]);

  const interpolatedWeather = useMemo(
    () => (pathData.length ? getInterpolatedWeather(pathData, currentTime) : []),
    [pathData, currentTime]
  );

  const prediction = useMemo(() => {
    if (!pathData.length) return null;
    const obs = interpolatedWeather[0];
    const dayOfYear = Math.floor(
      (currentTime.getTime() - Date.UTC(currentTime.getUTCFullYear(), 0, 0)) / 86400000
    );
    try {
      return predictSunset(
        pathData,
        currentTime,
        sunAltitude,
        obs?.visibility,
        obs?.humidity,
        latitude,
        terrainData.observerElevation,
        dayOfYear
      );
    } catch (err) {
      console.log('3D prediction error:', err);
      return null;
    }
  }, [pathData, interpolatedWeather, currentTime, sunAltitude, latitude, terrainData.observerElevation]);

  // 오늘의 추천 및 일반 이벤트 목록 생성
  const eventItems = useMemo(() => {
    const list: EventItem[] = [];
    const baseDate = new Date(currentTime);
    
    const sunrise = events?.sunrise ?? new Date(baseDate.setHours(6, 12, 0, 0));
    const sunset = events?.sunset ?? new Date(baseDate.setHours(19, 35, 0, 0));
    const moonrise = events?.moonrise ?? new Date(baseDate.setHours(20, 10, 0, 0));
    const moonset = events?.moonset ?? new Date(baseDate.setHours(5, 40, 0, 0));

    const moonIllum = SunCalc.getMoonIllumination(currentTime);
    const isCrescent = moonIllum.phase < 0.25 || moonIllum.phase > 0.75;

    // 1. 추천 이벤트 (Featured Events)
    list.push({
      id: 'f_sunset',
      title: '훌륭한 일몰',
      time: sunset,
      category: 'featured',
      badge: '추천 95점',
      description: '황혼의 붉은 노을빛과 고층 구름의 빛 반사',
    });

    list.push({
      id: 'f_sunrise',
      title: '훌륭한 일출',
      time: sunrise,
      category: 'featured',
      badge: '추천 90점',
      description: '새벽녘 지평선 황금빛 직달광',
    });

    if (isCrescent) {
      list.push({
        id: 'f_crescent',
        title: '눈썹달/초승달',
        time: new Date(sunset.getTime() + 45 * 60000),
        category: 'featured',
        badge: '달 위상',
        description: '일몰 직후 남서쪽 하늘에 선명한 초승달',
      });
    }

    list.push({
      id: 'f_milkyway',
      title: '은하수 관측 적기',
      time: new Date(sunset.getTime() + 150 * 60000),
      category: 'featured',
      badge: '별자리',
      description: '광해와 달빛이 적어 은하 적도가 또렷한 밤',
    });

    list.push({
      id: 'f_night',
      title: '행성 & 야경 경치',
      time: new Date(baseDate.setHours(22, 0, 0, 0)),
      category: 'featured',
      badge: '야경',
      description: '목성/토성 및 6.5등급 8천여 항성 관측',
    });

    // 2. 일반 이벤트 (General Events)
    list.push({
      id: 'g_sunrise',
      title: '일출',
      time: sunrise,
      category: 'general',
      description: '오늘의 일출 시각',
    });

    list.push({
      id: 'g_sunset',
      title: '일몰',
      time: sunset,
      category: 'general',
      description: '오늘의 일몰 시각',
    });

    list.push({
      id: 'g_moonrise',
      title: '월출',
      time: moonrise,
      category: 'general',
      description: '오늘의 월출 시각',
    });

    list.push({
      id: 'g_moonset',
      title: '월몰',
      time: moonset,
      category: 'general',
      description: '오늘의 월몰 시각',
    });

    return list;
  }, [currentTime, events]);

  const featuredList = useMemo(() => eventItems.filter(e => e.category === 'featured'), [eventItems]);
  const generalList = useMemo(() => eventItems.filter(e => e.category === 'general'), [eventItems]);

  const formatTimeStr = (d: Date) => {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  return (
    <View style={styles.container}>
      {/* 3D 시뮬레이션 뷰포트 (높이 밸런스 조절) */}
      <View style={styles.sceneWrapper}>
        <SkyScene3D
          sim={simObj}
          currentTime={currentTime}
          sunAltitude={sunAltitude}
          sunAzimuth={sunAzimuth}
          prediction={prediction}
          location={location}
          interpolatedWeather={interpolatedWeather}
          theme={theme}
          layers={layers}
          skySettings={skySettings}
          trackingTarget={trackingTarget}
          onSelectTrackingTarget={setTrackingTarget}
          fullScreen={true}
        />

        {trackingTarget && (
          <TouchableOpacity
            style={styles.trackingBadge}
            onPress={() => setTrackingTarget(null)}
            activeOpacity={0.8}
          >
            <Target size={11} color="#38BDF8" style={{ marginRight: 4 }} />
            <Text style={styles.trackingText}>
              {trackingTarget === 'sun' ? '태양 추적 중' : trackingTarget === 'moon' ? '달 추적 중' : trackingTarget === 'milkyway' ? '은하수 추적 중' : '천체 추적 중'}
            </Text>
            <Text style={styles.trackingCancel}> [해제]</Text>
          </TouchableOpacity>
        )}
        
        <TouchableOpacity
          style={[styles.layerControlButton, { backgroundColor: 'rgba(5, 5, 10, 0.65)', borderColor: theme.border }]}
          onPress={() => setLayerModalVisible(true)}
          activeOpacity={0.7}
        >
          <SlidersHorizontal size={14} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* 시뮬레이터와 타임 슬라이더 사이 추천/일반 이벤트 박스 */}
      <View style={[styles.eventBoxContainer, { backgroundColor: theme.glass ?? 'rgba(15, 23, 42, 0.6)', borderColor: theme.border }]}>
        <View style={styles.eventHeaderRow}>
          <View style={styles.tabToggleGroup}>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'featured' && styles.tabButtonActive]}
              onPress={() => setActiveTab('featured')}
              activeOpacity={0.8}
            >
              <Sparkles size={12} color={activeTab === 'featured' ? '#F59E0B' : '#94A3B8'} style={{ marginRight: 4 }} />
              <Text style={[styles.tabText, activeTab === 'featured' && styles.tabTextActive]}>추천 이벤트</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'general' && styles.tabButtonActive]}
              onPress={() => setActiveTab('general')}
              activeOpacity={0.8}
            >
              <Sun size={12} color={activeTab === 'general' ? '#38BDF8' : '#94A3B8'} style={{ marginRight: 4 }} />
              <Text style={[styles.tabText, activeTab === 'general' && styles.tabTextActive]}>일반 이벤트</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.eventCardsScroll}
        >
          {(activeTab === 'featured' ? featuredList : generalList).map(item => (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.eventCard,
                item.category === 'featured' ? styles.eventCardFeatured : styles.eventCardGeneral,
              ]}
              onPress={() => setCurrentTime(item.time)}
              activeOpacity={0.75}
            >
              <View style={styles.cardTopRow}>
                {(() => {
                  if (item.id.includes('sunset')) return <Sunset size={13} color="#F97316" />;
                  if (item.id.includes('sunrise')) return <Sun size={13} color="#FBBF24" />;
                  if (item.id.includes('crescent')) return <Moon size={13} color="#38BDF8" />;
                  if (item.id.includes('milkyway')) return <Sparkles size={13} color="#A78BFA" />;
                  if (item.id.includes('night')) return <Star size={13} color="#F43F5E" />;
                  if (item.id.includes('moon')) return <Moon size={13} color="#38BDF8" />;
                  return <Sun size={13} color="#EAB308" />;
                })()}
                <Text style={styles.cardTimeText}>{formatTimeStr(item.time)}</Text>
                {item.badge && (
                  <View style={styles.cardBadge}>
                    <Text style={styles.cardBadgeText}>{item.badge}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardDesc} numberOfLines={1}>{item.description}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* 3D 뷰어 하단 시간 슬라이더 */}
      <View style={[styles.bottomPanel, { backgroundColor: theme.glass, borderColor: theme.border }]}>
        <TimeSlider 
          value={currentTime}
          onChange={setCurrentTime}
          isTimeMachineEnabled={isTimeMachineEnabled}
          onToggleTimeMachine={setTimeMachineEnabled}
          theme={theme}
          isDay={true}
          onPressMap={() => setMapVisible && setMapVisible(true)}
          markers={events ? [
            { time: events.sunrise || null, color: '#FFA500', type: 'rise' },
            { time: events.sunset || null, color: '#FF4500', type: 'set' },
            { time: events.moonrise || null, color: '#888', type: 'rise' },
            { time: events.moonset || null, color: '#888', type: 'set' },
          ] : []}
        />
      </View>

      <LayerControlModal
        visible={isLayerModalVisible}
        onClose={() => setLayerModalVisible(false)}
        layers={layers}
        onToggleLayer={(key) => setLayers(prev => {
          // paths 토글 시 labels도 동기화
          if (key === 'paths') {
            return { ...prev, paths: !prev.paths, labels: !prev.paths };
          }
          return { ...prev, [key]: !prev[key] };
        })}
        skySettings={skySettings}
        onChangeSkySettings={(next) => setSkySettings(prev => ({ ...prev, ...next }))}
        theme={theme}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 12,
  },
  sceneWrapper: {
    height: 380, // 세로로 너무 긴 시뮬레이션 높이 비율 조절
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  layerControlButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  trackingBadge: {
    position: 'absolute',
    top: 12,
    left: 100,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderColor: '#38BDF8',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    zIndex: 20,
  },
  trackingText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  trackingCancel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#94A3B8',
  },
  eventBoxContainer: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
  },
  eventHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  tabToggleGroup: {
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: 10,
    padding: 2,
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  tabText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#F8FAFC',
    fontWeight: '800',
  },
  eventCardsScroll: {
    gap: 8,
    paddingRight: 8,
  },
  eventCard: {
    width: 145,
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
  },
  eventCardFeatured: {
    backgroundColor: 'rgba(30, 27, 75, 0.65)',
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  eventCardGeneral: {
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  cardIcon: {
    fontSize: 14,
  },
  cardTimeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#F1F5F9',
  },
  cardBadge: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
  },
  cardBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#F59E0B',
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 2,
  },
  cardDesc: {
    fontSize: 10,
    color: '#94A3B8',
  },
  bottomPanel: {
    marginTop: 10,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
});
