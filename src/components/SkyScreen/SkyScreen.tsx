/**
 * SkyScreen.tsx
 *
 * "하늘" 탭 — 자기중심(돔 안) 시점. 답하는 질문은 **"뭐가 보일까"** 입니다.
 *
 * 레이아웃 원칙 (docs/IA_REDESIGN.md §4): 작은 화면에서는 나누지 말고 순서를 만듭니다.
 *  - 3D 씬이 화면을 꽉 채우고 (full-bleed)
 *  - 상시 노출은 타임 슬라이더 하나뿐 — 시간 스크럽이 이 앱의 핵심 인터랙션
 *  - 예측·수치·이벤트는 peek 시트 안. 닫히면 요약 한 줄(52px)만 남습니다.
 *
 * 이전에는 씬(고정 380px) + 이벤트 박스 + 슬라이더가 세로로 쌓여 셋 다 좁았습니다.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { SlidersHorizontal, Sparkles, Sun, Sunset, Moon, Star, Flame, Target, Zap } from 'lucide-react-native';
import { SkyScene3D, DEFAULT_SKY_SETTINGS, LayerState, SkySettings } from '../SkyScene3D/SkyScene3D';
import { LayerControlModal } from '../SunsetSimulation/LayerControlModal';
import { TimeSlider } from '../TimeSlider';
import { useCelestialStore } from '../../store/useCelestialStore';
import {
  fetchTerrainProfile,
  fetchSunsetWeather,
  getInterpolatedWeather,
  type CloudPathData,
} from '../../utils/weather';
import { predictSunset } from '../../utils/sunsetPhysics';
import { PredictionCard } from '../SunsetSimulation/PredictionCard';
import { InfoCard } from '../InfoCard';
import { PeekSheet } from './PeekSheet';
import SunCalc from 'suncalc';

interface SkyScreenProps {
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

export const SkyScreen: React.FC<SkyScreenProps> = ({
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

  const moonPos = SunCalc.getMoonPosition(currentTime, latitude, longitude);
  const moonAltitude = (moonPos.altitude * 180) / Math.PI;
  const moonAzimuth = (moonPos.azimuth * 180) / Math.PI + 180;

  // ── 실제 기상 데이터 ─────────────────────────────────────────────────────
  // 이게 없으면 3D 씬의 구름은 전부 위경도 해시로만 만들어져서
  // 흐린 날과 맑은 날의 화면이 완전히 같아집니다.
  const [pathData, setPathData] = useState<CloudPathData[]>([]);
  // 초단기 실황(nowcast). 예전 2D 시뮬 탭의 ⚡ 버튼이 하던 일입니다.
  const [useNowcast, setUseNowcast] = useState(false);
  const [isNowcastLoading, setNowcastLoading] = useState(false);
  const currentDateStr = useMemo(
    () => `${currentTime.getFullYear()}-${currentTime.getMonth() + 1}-${currentTime.getDate()}`,
    [currentTime]
  );
  // 방위는 30° 버킷으로 캐시되므로 태양 방위가 조금 움직여도 재요청이 없습니다.
  const bucketedSunAz = useMemo(() => Math.round(sunAzimuth / 30) * 30, [sunAzimuth]);

  useEffect(() => {
    let cancelled = false;
    if (!latitude || !longitude) return;

    setNowcastLoading(true);
    fetchSunsetWeather(latitude, longitude, bucketedSunAz, useNowcast, currentTime)
      .then(data => {
        if (!cancelled && Array.isArray(data)) setPathData(data);
      })
      .catch(err => {
        console.log('3D weather fetch error:', err);
      })
      .finally(() => {
        if (!cancelled) setNowcastLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // currentTime 전체가 아니라 날짜·방위 버킷에만 반응해야 슬라이더마다 재요청하지 않습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude, currentDateStr, bucketedSunAz, useNowcast]);

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

  // 요약 한 줄에 쓸 값들
  const scoreText = prediction?.score != null ? `${Math.round(prediction.score)}점` : '—';
  const sunsetText = events?.sunset
    ? `${String(events.sunset.getHours()).padStart(2, '0')}:${String(events.sunset.getMinutes()).padStart(2, '0')}`
    : '--:--';
  const highCloudPct = interpolatedWeather[0]?.high;

  return (
    <View style={styles.container}>
      {/* ── 3D 돔: 화면을 꽉 채웁니다 ───────────────────────────────────── */}
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

        {/* 씬 위 오버레이는 최소한만 — 레이어 토글과 초단기 실황 */}
        <View style={styles.sceneOverlayButtons}>
          <TouchableOpacity
            style={[
              styles.overlayButton,
              {
                backgroundColor: useNowcast ? 'rgba(250, 204, 21, 0.32)' : 'rgba(5, 5, 10, 0.65)',
                borderColor: useNowcast ? '#FACC15' : theme.border,
              },
            ]}
            onPress={() => setUseNowcast(v => !v)}
            disabled={isNowcastLoading}
            activeOpacity={0.7}
          >
            <Zap size={14} color={useNowcast ? '#FACC15' : '#FFFFFF'} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.overlayButton, { backgroundColor: 'rgba(5, 5, 10, 0.65)', borderColor: theme.border }]}
            onPress={() => setLayerModalVisible(true)}
            activeOpacity={0.7}
          >
            <SlidersHorizontal size={14} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── peek 시트: 닫히면 요약 한 줄, 끌어올리면 근거와 수치 ─────────── */}
      <PeekSheet
        theme={theme}
        summary={
          <View style={styles.summaryRow}>
            <Flame size={13} color="#F97316" />
            <Text style={[styles.summaryScore, { color: theme.text }]}>{scoreText}</Text>
            <Text style={[styles.summaryDot, { color: theme.subText }]}>·</Text>
            <Sunset size={12} color="#FB923C" />
            <Text style={[styles.summaryValue, { color: theme.text }]}>{sunsetText}</Text>
            {highCloudPct != null && (
              <>
                <Text style={[styles.summaryDot, { color: theme.subText }]}>·</Text>
                <Text style={[styles.summaryValue, { color: theme.subText }]}>
                  상층운 {Math.round(highCloudPct)}%
                </Text>
              </>
            )}
          </View>
        }
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScroll}>
          {prediction && (
            <PredictionCard
              prediction={prediction}
              theme={theme}
              isSunrise={sunAltitude < 0 && (events?.sunrise ? currentTime < events.sunrise : false)}
            />
          )}

          {/* 태양·달 수치 — 예전 tracker 탭의 InfoCard 그리드 */}
          <View style={[styles.numberFrame, { backgroundColor: theme.glass, borderColor: theme.border }]}>
            <View style={styles.frameHeader}>
              <Sun size={11} color="#FFD700" />
              <Text style={[styles.frameLabel, { color: theme.subText }]}>태양 · 달</Text>
            </View>
            <View style={styles.numberGrid}>
              <InfoCard
                icon={<Sun size={14} color="#FFD700" />}
                label="태양"
                value={`${sunAltitude.toFixed(0)}°`}
                subValue={`${sunAzimuth.toFixed(0)}°`}
                theme={theme}
              />
              <InfoCard
                icon={<Moon size={14} color="#94A3B8" />}
                label="달"
                value={`${moonAltitude.toFixed(0)}°`}
                subValue={`${moonAzimuth.toFixed(0)}°`}
                theme={theme}
              />
              <InfoCard
                icon={<Sunset size={14} color="#FF4500" />}
                label="일몰"
                value={sunsetText}
                theme={theme}
              />
            </View>
          </View>

          {/* 이벤트 — 탭하면 그 시각으로 이동 */}
          <View style={styles.eventSection}>
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

            {(activeTab === 'featured' ? featuredList : generalList).map(item => (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.eventRow,
                  { borderColor: theme.border },
                  item.category === 'featured' && styles.eventRowFeatured,
                ]}
                onPress={() => setCurrentTime(item.time)}
                activeOpacity={0.75}
              >
                {(() => {
                  if (item.id.includes('sunset')) return <Sunset size={14} color="#F97316" />;
                  if (item.id.includes('sunrise')) return <Sun size={14} color="#FBBF24" />;
                  if (item.id.includes('crescent')) return <Moon size={14} color="#38BDF8" />;
                  if (item.id.includes('milkyway')) return <Sparkles size={14} color="#A78BFA" />;
                  if (item.id.includes('night')) return <Star size={14} color="#F43F5E" />;
                  if (item.id.includes('moon')) return <Moon size={14} color="#38BDF8" />;
                  return <Sun size={14} color="#EAB308" />;
                })()}
                <View style={styles.eventRowText}>
                  <Text style={[styles.eventTitle, { color: theme.text }]}>{item.title}</Text>
                  <Text style={[styles.eventDesc, { color: theme.subText }]} numberOfLines={1}>
                    {item.description}
                  </Text>
                </View>
                <Text style={[styles.eventTime, { color: theme.text }]}>{formatTimeStr(item.time)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </PeekSheet>

      {/* ── 상시 노출은 타임 슬라이더 하나뿐 ────────────────────────────── */}
      <View style={[styles.bottomPanel, { backgroundColor: theme.glass, borderColor: theme.border }]}>
        <TimeSlider
          value={currentTime}
          onChange={setCurrentTime}
          isTimeMachineEnabled={isTimeMachineEnabled}
          onToggleTimeMachine={setTimeMachineEnabled}
          theme={theme}
          isDay={sunAltitude > 0}
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
  },
  // 씬은 화면을 꽉 채웁니다. 고정 높이(380px)를 쓰면 큰 화면에서 여백이,
  // 작은 화면에서는 답답함이 생깁니다.
  sceneWrapper: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  sceneOverlayButtons: {
    position: 'absolute',
    top: 12,
    right: 12,
    gap: 8,
    zIndex: 20,
  },
  overlayButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trackingBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
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
    fontSize: 10,
    fontWeight: '800',
    color: '#38BDF8',
  },

  // ── peek 시트 요약 한 줄 ──────────────────────────────────────────────
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryScore: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  summaryValue: {
    fontSize: 12,
    fontWeight: '700',
  },
  summaryDot: {
    fontSize: 12,
    fontWeight: '700',
    opacity: 0.5,
  },

  // ── 시트 본문 ────────────────────────────────────────────────────────
  sheetScroll: {
    paddingBottom: 16,
    gap: 10,
  },
  numberFrame: {
    borderRadius: 16,
    padding: 10,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
  },
  frameHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    marginBottom: 6,
    gap: 6,
  },
  frameLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  numberGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  eventSection: {
    gap: 6,
  },
  tabToggleGroup: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 2,
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
  },
  tabButtonActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.22)',
  },
  tabText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
  },
  tabTextActive: {
    color: '#F8FAFC',
    fontWeight: '900',
  },
  // 이벤트를 가로 스크롤 카드가 아니라 세로 목록으로 바꿨습니다.
  // 시트 안에서는 세로 스크롤이 이미 있어서 가로 스크롤과 충돌합니다.
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  eventRowFeatured: {
    borderColor: 'rgba(249, 115, 22, 0.45)',
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
  },
  eventRowText: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 12.5,
    fontWeight: '800',
  },
  eventDesc: {
    fontSize: 10.5,
    marginTop: 1,
  },
  eventTime: {
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },

  bottomPanel: {
    paddingVertical: 8,
    borderTopWidth: Platform.OS === 'android' ? 0 : 1,
  },
});
