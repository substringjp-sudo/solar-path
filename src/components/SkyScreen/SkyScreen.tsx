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
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Platform, Animated } from 'react-native';
import { SlidersHorizontal, Sparkles, Sun, Sunset, Moon, Star, Flame, Target, Zap, Layers, Wand2, X, SlidersVertical, QrCode } from 'lucide-react-native';
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
import { fetchCloudGrid, type CloudDensityGrid } from '../../utils/cloudGrid';
import { cloudGridToFan, isGridUsable } from '../../utils/cloudGridAdapter';
import {
  buildSkyTimeline,
  isTimelineUsable,
  type SkyTimeline,
} from '../../utils/skyTimeline';
import { PredictionCard } from '../SunsetSimulation/PredictionCard';
import { InfoCard } from '../InfoCard';
import { PeekSheet } from './PeekSheet';
import { DevTuningPanel } from './DevTuningPanel';
import { SimReportQR } from './SimReportQR';
import { buildSimReportPayload, encodeSimReportPayload } from '../../utils/simReport';
import { resolveLayerWinds } from '../../utils/skyColumn';
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
  isActive?: boolean;
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
  isActive = true,
}) => {
  const { location, weatherCacheList, terrainCacheList } = useCelestialStore();
  const [isLayerModalVisible, setLayerModalVisible] = useState(false);
  // 분석용 QR — 이 프레임의 기상·태양 입력값을 캡처에 함께 담습니다
  // (utils/simReport.ts). 기본은 꺼짐: 일반 사용자의 노을 사진에는
  // 필요 없는 오버레이입니다.
  const [showSimReportQR, setShowSimReportQR] = useState(false);
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
    cityLights: true,
  });
  const [skySettings, setSkySettings] = useState<SkySettings>(DEFAULT_SKY_SETTINGS);

  const latitude = location?.coords.latitude ?? 37.5665;
  const longitude = location?.coords.longitude ?? 126.9780;

  const currentDateStr = useMemo(
    () => `${currentTime.getFullYear()}-${String(currentTime.getMonth() + 1).padStart(2, '0')}-${String(currentTime.getDate()).padStart(2, '0')}`,
    [currentTime]
  );

  // 3D 지형 실루엣 및 사용자 해발 고도 State (스플래시 캐시 우선 초기화)
  const initialTerrain = useMemo(() => {
    const cached = terrainCacheList.find(c => Math.abs(c.latitude - latitude) < 0.05 && Math.abs(c.longitude - longitude) < 0.05);
    if (cached?.data && Array.isArray((cached.data as any).panoramicAngles)) {
      return {
        panoramicAngles: (cached.data as any).panoramicAngles,
        observerElevation: (cached.data as any).observerElevation ?? location?.coords?.altitude ?? 50,
      };
    }
    return {
      panoramicAngles: [],
      observerElevation: location?.coords.altitude ?? 50,
    };
  }, [terrainCacheList, latitude, longitude, location?.coords.altitude]);

  const [terrainData, setTerrainData] = useState(initialTerrain);

  useEffect(() => {
    if (terrainData.panoramicAngles.length === 0 && latitude && longitude) {
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
  }, [latitude, longitude, terrainData.panoramicAngles.length, location?.coords?.altitude]);

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

  // ── 실제 기상 데이터 (스플래시 캐시 우선 초기화) ──────────────────────────
  const initialWeather = useMemo(() => {
    const cached = weatherCacheList.find(c => 
      c.key.includes(currentDateStr) && 
      Math.abs(c.latitude - latitude) < 0.05 && 
      Math.abs(c.longitude - longitude) < 0.05
    );
    if (cached?.data && Array.isArray(cached.data)) {
      return cached.data as CloudPathData[];
    }
    return [];
  }, [weatherCacheList, currentDateStr, latitude, longitude]);

  const [pathData, setPathData] = useState<CloudPathData[]>(initialWeather);
  const [useNowcast, setUseNowcast] = useState(false);
  const [isNowcastLoading, setNowcastLoading] = useState(false);
  const bucketedSunAz = useMemo(() => Math.round(sunAzimuth / 30) * 30, [sunAzimuth]);

  useEffect(() => {
    let cancelled = false;
    if (!latitude || !longitude) return;

    // 이미 유효한 캐시 데이터가 있고 nowcast 갱신 요청이 아니라면 네트워크 스킵
    if (pathData.length > 0 && !useNowcast) return;

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
  }, [latitude, longitude, currentDateStr, bucketedSunAz, useNowcast]);

  // ── 하루치 사전 계산 ─────────────────────────────────────────────────────
  //
  // "새로 만들기"를 누르면 그 장소·그 날짜의 하늘을 통째로 계산합니다.
  // 그 뒤로는 시간을 아무리 움직여도 네트워크도, fBm도 다시 돌지 않고
  // 키프레임 사이 보간만 합니다 (utils/skyTimeline.ts).
  const [isDevPanelOpen, setDevPanelOpen] = useState(false);
  const [timeline, setTimeline] = useState<SkyTimeline | null>(null);
  const [buildProgress, setBuildProgress] = useState<number>(0);
  const [buildLabel, setBuildLabel] = useState<string>('');
  const [isBuilding, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const cancelBuildRef = React.useRef(false);

  const progressAnim = React.useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: buildProgress,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [buildProgress, progressAnim]);

  const handleBuildTimeline = React.useCallback(async () => {
    if (isBuilding) {
      // 진행 중이면 취소
      cancelBuildRef.current = true;
      return;
    }
    cancelBuildRef.current = false;
    setBuilding(true);
    setBuildError(null);
    setBuildProgress(0);
    setBuildLabel('시작하는 중…');
    try {
      const tl = await buildSkyTimeline({
        latitude,
        longitude,
        date: currentTime,
        observerElevM: terrainData.observerElevation,
        onProgress: (p, label) => {
          setBuildProgress(p);
          setBuildLabel(label);
        },
        isCancelled: () => cancelBuildRef.current,
      });
      setTimeline(tl);
      setBuildLabel('완료');
    } catch (err: any) {
      if (err?.message === 'CANCELLED') {
        setBuildLabel('취소됨');
      } else {
        console.log('sky timeline build failed:', err);
        setBuildError(err?.message?.includes('RATE_LIMIT')
          ? 'API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.'
          : '날씨를 받지 못했습니다. 연결을 확인해 주세요.');
      }
    } finally {
      setBuilding(false);
    }
  }, [isBuilding, latitude, longitude, currentTime, terrainData.observerElevation]);

  // 날짜나 장소가 바뀌면 계산해 둔 하늘은 더 이상 맞지 않습니다.
  const timelineValid = isTimelineUsable(timeline, latitude, longitude, currentTime);
  useEffect(() => {
    if (timeline && !isTimelineUsable(timeline, latitude, longitude, currentTime)) {
      setTimeline(null);
      setBuildLabel('');
      setBuildProgress(0);
    }
  }, [timeline, latitude, longitude, currentDateStr]);

  // 날짜/위치 준비 완료 시 백그라운드 자동 타임라인 사전 계산 (수동 버튼 불필요)
  useEffect(() => {
    if (!latitude || !longitude || isBuilding || timelineValid) return;

    const timer = setTimeout(() => {
      handleBuildTimeline();
    }, 400);

    return () => clearTimeout(timer);
  }, [latitude, longitude, currentDateStr, timelineValid, isBuilding, handleBuildTimeline]);

  const interpolatedWeather = useMemo(
    () => (pathData.length ? getInterpolatedWeather(pathData, currentTime) : []),
    [pathData, currentTime]
  );

  // ── 강화 구름 격자 ───────────────────────────────────────────────────────
  // 기본 팬(5레이 × 7고리, ±20°)보다 넓고 촘촘한 관측(7레이 × 10고리, ±30°)을
  // 받아 같은 자리에 끼워 넣습니다. 예전 2D 시뮬 탭의 레이어 버튼이 하던 일인데,
  // 거기서는 결과가 SVG 폴리곤이라 3D가 쓸 수 없었습니다 (utils/cloudGridAdapter.ts).
  const [useEnhancedGrid, setUseEnhancedGrid] = useState(false);
  const [cloudGrid, setCloudGrid] = useState<CloudDensityGrid | null>(null);
  const [isGridLoading, setGridLoading] = useState(false);

  useEffect(() => {
    if (!useEnhancedGrid || !latitude || !longitude) return;
    // 이미 지금 방위에 맞는 격자가 있으면 다시 부르지 않습니다.
    if (isGridUsable(cloudGrid, sunAzimuth)) return;

    let cancelled = false;
    setGridLoading(true);
    fetchCloudGrid(latitude, longitude, sunAzimuth, currentTime)
      .then(grid => {
        if (!cancelled && grid) setCloudGrid(grid);
      })
      .catch(err => {
        console.log('cloud grid fetch error:', err);
      })
      .finally(() => {
        if (!cancelled) setGridLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // 시각 전체가 아니라 날짜·방위 버킷에만 반응합니다 — 격자는 시간축을
    // 그대로 들고 있어서 슬라이더를 움직여도 다시 받을 필요가 없습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useEnhancedGrid, latitude, longitude, currentDateStr, bucketedSunAz]);

  /**
   * 씬에 실제로 넘기는 관측 팬.
   *
   * 격자가 없거나 태양 방위가 격자 중심에서 너무 벌어졌으면 기본 팬으로
   * 되돌아갑니다. 격자는 ±30° 부채꼴이라, 방위가 어긋난 채로 쓰면 실측 영역이
   * 하늘의 엉뚱한 쪽에 얹혀 기본 팬보다 나빠집니다.
   */
  const sceneWeather = useMemo(() => {
    if (!useEnhancedGrid || !isGridUsable(cloudGrid, sunAzimuth)) return interpolatedWeather;
    return cloudGridToFan({
      grid: cloudGrid,
      time: currentTime,
      sunAzimuthDeg: sunAzimuth,
      baseline: interpolatedWeather,
    });
  }, [useEnhancedGrid, cloudGrid, sunAzimuth, currentTime, interpolatedWeather]);

  const isGridActive = useEnhancedGrid && isGridUsable(cloudGrid, sunAzimuth);

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

  // 분석용 QR 페이로드. **씬에 실제로 넘어가는 값**(sceneWeather — 강화
  // 격자가 켜져 있으면 그쪽)에서 뽑아야 화면에 그려진 것과 QR이 말하는
  // 것이 어긋나지 않습니다.
  const simReportData = useMemo(
    () =>
      encodeSimReportPayload(
        buildSimReportPayload({
          simTimeMs: currentTime.getTime(),
          latitude,
          longitude,
          observerElevM: terrainData.observerElevation,
          sunAltDeg: sunAltitude,
          sunAzDeg: sunAzimuth,
          obs: sceneWeather[0],
          // 보고서에는 하층(850 hPa) 바람을 대표로 싣습니다. `synthetic` 이
          // 실측인지 대용값인지를 캡처에 남깁니다.
          ...(({ winds, measured }) => ({
            windSpeedKmh: winds.low.speedKmh,
            windBearingDeg: winds.low.bearingDeg,
            windSynthetic: !measured,
          }))(resolveLayerWinds(sceneWeather[0])),
        })
      ),
    [currentTime, latitude, longitude, terrainData.observerElevation, sunAltitude, sunAzimuth, sceneWeather]
  );

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
          interpolatedWeather={sceneWeather}
          theme={theme}
          layers={layers}
          skySettings={skySettings}
          trackingTarget={trackingTarget}
          onSelectTrackingTarget={setTrackingTarget}
          fullScreen={true}
          timeline={timelineValid ? timeline : null}
          isActive={isActive}
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

        {/* 씬 위 오버레이 버튼: 하루치 사전 계산 & 3D 표시 설정 */}
        <View style={styles.sceneOverlayButtons}>
          {/* 하루치 사전 계산. 눌러 두면 이후 스크럽이 네트워크 없이 돌아갑니다. */}
          <TouchableOpacity
            style={[
              styles.overlayButton,
              {
                backgroundColor: isBuilding
                  ? 'rgba(239, 68, 68, 0.32)'
                  : timelineValid
                    ? 'rgba(52, 211, 153, 0.32)'
                    : 'rgba(5, 5, 10, 0.65)',
                borderColor: isBuilding ? '#EF4444' : timelineValid ? '#34D399' : theme.border,
              },
            ]}
            onPress={handleBuildTimeline}
            activeOpacity={0.7}
          >
            {isBuilding
              ? <X size={14} color="#FCA5A5" />
              : <Wand2 size={14} color={timelineValid ? '#34D399' : '#FFFFFF'} />}
          </TouchableOpacity>

          {/* 3D 요소 표시 설정 모달 */}
          <TouchableOpacity
            style={[styles.overlayButton, { backgroundColor: 'rgba(5, 5, 10, 0.65)', borderColor: theme.border }]}
            onPress={() => setLayerModalVisible(true)}
            onLongPress={() => setDevPanelOpen(v => !v)}
            delayLongPress={700}
            activeOpacity={0.7}
          >
            <SlidersHorizontal size={14} color="#FFFFFF" />
          </TouchableOpacity>

          {/* 분석용 QR — 켜면 화면 왼쪽 아래에 이 프레임의 기상값 QR이 뜹니다 */}
          <TouchableOpacity
            style={[
              styles.overlayButton,
              showSimReportQR
                ? { backgroundColor: 'rgba(56, 189, 248, 0.32)', borderColor: '#38BDF8' }
                : { backgroundColor: 'rgba(5, 5, 10, 0.65)', borderColor: theme.border },
            ]}
            onPress={() => setShowSimReportQR(v => !v)}
            activeOpacity={0.7}
          >
            <QrCode size={14} color={showSimReportQR ? '#38BDF8' : '#FFFFFF'} />
          </TouchableOpacity>

          {/* 개발자 튜닝 — 레이어 버튼 길게 누르기로도 열립니다 */}
          {isDevPanelOpen && (
            <TouchableOpacity
              style={[styles.overlayButton, { backgroundColor: 'rgba(56, 189, 248, 0.32)', borderColor: '#38BDF8' }]}
              onPress={() => setDevPanelOpen(false)}
              activeOpacity={0.7}
            >
              <SlidersVertical size={14} color="#38BDF8" />
            </TouchableOpacity>
          )}
        </View>

        {/* 분석용 QR — 씬 왼쪽 아래. 진행률 배너와 자리가 겹치므로 그때는 숨깁니다. */}
        {showSimReportQR && !isBuilding && !buildError && (
          <View style={styles.simReportQrWrap}>
            <SimReportQR data={simReportData} />
          </View>
        )}

        {/* 진행률 — 계산 중에만 씬 하단에 뜹니다 */}
        {(isBuilding || buildError) && (
          <View style={styles.buildBanner}>
            {buildError ? (
              <Text style={styles.buildError} numberOfLines={2}>{buildError}</Text>
            ) : (
              <>
                <Text style={styles.buildLabel} numberOfLines={1}>{buildLabel}</Text>
                <View style={styles.progressTrack}>
                  <Animated.View
                    style={[
                      styles.progressFill,
                      {
                        width: progressAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0%', '100%'],
                        }),
                      },
                    ]}
                  />
                </View>
                <Text style={styles.buildHint}>탭하면 취소</Text>
              </>
            )}
          </View>
        )}
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

      <DevTuningPanel visible={isDevPanelOpen} onClose={() => setDevPanelOpen(false)} />

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
  sceneWrapper: {
    width: '100%',
    aspectRatio: 4 / 3,
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
  simReportQrWrap: {
    position: 'absolute',
    left: 12,
    bottom: 14,
    zIndex: 22,
  },
  buildBanner: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    backgroundColor: 'rgba(5, 8, 16, 0.88)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    zIndex: 25,
    gap: 6,
  },
  buildLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#E2E8F0',
  },
  buildHint: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
  },
  buildError: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FCA5A5',
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(148, 163, 184, 0.25)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#34D399',
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
