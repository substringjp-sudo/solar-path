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
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { StyleSheet, View, Text, ScrollView, Animated, ActivityIndicator, Platform } from 'react-native';
import { SlidersHorizontal, Sparkles, Sun, Sunset, Moon, Star, Flame, Target, SlidersVertical, CloudOff, RefreshCw } from 'lucide-react-native';
import { SkyScene3D } from '../SkyScene3D/SkyScene3D';
import { LayerControlModal } from '../SunsetSimulation/LayerControlModal';
import { DateTimeBar, type ScrubKind } from '../TimeBar/DateTimeBar';
import { useCelestialStore } from '../../store/useCelestialStore';
import {
  shiftTz,
  getSeasonMarkers,
  dateToDatePercent,
} from '../../utils/dateSlider';
import {
  fetchTerrainProfile,
  fetchDayWeatherRing,
  fetchWeatherCanary,
  getInterpolatedWeather,
  type CloudPathData,
  type TerrainData,
} from '../../utils/weather';
import { findPresetTerrain } from '../../utils/presetTerrains';
import { scenePrediction } from '../../utils/scenePrediction';
import {
  weatherCacheKey,
  sameBucket,
  canarySaysSkip,
  canaryIsUsable,
  canaryPrint,
} from '../../utils/cachePolicy';
import {
  isTimelineUsable,
  type SkyTimeline,
} from '../../utils/skyTimeline';
import { PredictionCard } from '../SunsetSimulation/PredictionCard';
import { InfoCard } from '../InfoCard';
import { PeekSheet, PEEK_HEIGHT } from './PeekSheet';
import { DevTuningPanel } from './DevTuningPanel';
import SunCalc from 'suncalc';
import { sunPosition } from '../../utils/solarPosition';
import { buildSkyEvents } from '../../utils/skyEvents';
import { t } from '../../utils/i18n';
import { color, color as DARK, radius, mono, dataColor } from '../../theme/tokens';
import { makeStyles, useThemeColors, useDataColors, OVERLAY_THEME } from '../../theme/useTheme';
import { PressScale, OverlayButton, Reveal } from '../ui';
import { timeTo } from '../../theme/motion';

interface SkyScreenProps {
  theme: any;
  currentTime: Date;
  /** 사용자가 고른 시각(슬라이더·이벤트 칩) — 시계에서 떼어 붙듭니다(`handleTimeChange` → `pinTime`, utils/liveClock.ts). */
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
  onCameraPress?: () => void;
  /** 하단 막대의 날짜 글자를 누르면 — 달력 창(App 이 엽니다). */
  onOpenDatePicker?: () => void;
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
  onCameraPress,
  onOpenDatePicker,
}) => {
  const color = useThemeColors(); const dataColor = useDataColors(); const styles = useStyles();
  const [stageH, setStageH] = useState(0);
  const { location, weatherCacheList, terrainCacheList, addTerrainCache, addWeatherCache, language, timezoneOffsetHours, isCacheHydrated } = useCelestialStore();
  const [isLayerModalVisible, setLayerModalVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<'featured' | 'general'>('featured');
  const [trackingTarget, setTrackingTarget] = useState<string | null>(null);
  // 레이어·하늘 설정은 스토어에 둡니다 — 촬영하기(카메라)의 3D 가 같은 값으로 그리게.
  const layers = useCelestialStore(s => s.skyLayers);
  const setSkyLayers = useCelestialStore(s => s.setSkyLayers);
  const skySettings = useCelestialStore(s => s.skySettings);
  const setSkySettings = useCelestialStore(s => s.setSkySettings);

  const latitude = location?.coords.latitude ?? 37.5665;
  const longitude = location?.coords.longitude ?? 126.9780;

  const currentDateStr = useMemo(
    () => `${currentTime.getFullYear()}-${String(currentTime.getMonth() + 1).padStart(2, '0')}-${String(currentTime.getDate()).padStart(2, '0')}`,
    [currentTime]
  );

  // 3D 지형 실루엣 및 사용자 해발 고도 State (프리셋 및 캐시 우선 초기화)
  const initialTerrain: TerrainData = useMemo(() => {
    const preset = findPresetTerrain(latitude, longitude);
    if (preset) return preset;

    const cached = terrainCacheList.find(c => Math.abs(c.latitude - latitude) < 0.05 && Math.abs(c.longitude - longitude) < 0.05);
    if (cached?.data && Array.isArray((cached.data as any).panoramicAngles)) {
      const d = cached.data as any;
      return {
        panoramicAngles: d.panoramicAngles ?? [],
        farAngles: d.farAngles ?? [],
        bandAngles: d.bandAngles ?? [],
        bandDistancesKm: d.bandDistancesKm ?? [5, 15, 40],
        waterFrac: d.waterFrac ?? [],
        minAz: d.minAz ?? 0,
        maxAz: d.maxAz ?? 360,
        observerElevation: d.observerElevation ?? location?.coords?.altitude ?? 50,
        elevations: d.elevations ?? [],
      };
    }
    return {
      panoramicAngles: [],
      farAngles: [],
      bandAngles: [],
      bandDistancesKm: [5, 15, 40],
      waterFrac: [],
      minAz: 0,
      maxAz: 360,
      observerElevation: location?.coords.altitude ?? 50,
      elevations: [],
    };
  }, [terrainCacheList, latitude, longitude, location?.coords.altitude]);

  const [terrainData, setTerrainData] = useState<TerrainData>(initialTerrain);
  const lastFetchedCoordRef = useRef<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    if (!isCacheHydrated || !latitude || !longitude) return;

    const isDifferentLocation =
      !lastFetchedCoordRef.current ||
      Math.abs(lastFetchedCoordRef.current.lat - latitude) > 0.05 ||
      Math.abs(lastFetchedCoordRef.current.lon - longitude) > 0.05;

    if (isDifferentLocation) {
      lastFetchedCoordRef.current = { lat: latitude, lon: longitude };

      // 1. 오프라인 고정밀 프리셋 지형 우선 확인 (0ms 즉시 로드)
      const preset = findPresetTerrain(latitude, longitude);
      if (preset) {
        setTerrainData(preset);
        return;
      }

      // 2. 캐시 목록에서 탐색 (0.05° 허용치 적용)
      const cached = terrainCacheList.find(
        (item) => Math.abs(item.latitude - latitude) < 0.05 && Math.abs(item.longitude - longitude) < 0.05
      );

      if (cached && cached.data?.bandAngles?.length > 0) {
        setTerrainData(cached.data);
        return;
      }

      // 3. 캐시가 없으면 Open-Meteo 지형 고도 API 호출
      const reqLat = latitude;
      const reqLon = longitude;
      fetchTerrainProfile(reqLat, reqLon, 0, 360)
        .then((tData) => {
          if (
            !lastFetchedCoordRef.current ||
            Math.abs(lastFetchedCoordRef.current.lat - reqLat) > 0.05 ||
            Math.abs(lastFetchedCoordRef.current.lon - reqLon) > 0.05
          ) {
            return;
          }
          if (tData.isFallback) return;
          if (tData && Array.isArray(tData.panoramicAngles) && tData.panoramicAngles.length > 0) {
            setTerrainData(tData);
            addTerrainCache({
              key: `terrain_${reqLat.toFixed(3)}_${reqLon.toFixed(3)}`,
              latitude: reqLat,
              longitude: reqLon,
              data: tData,
              timestamp: Date.now(),
            });
          }
        })
        .catch((err) => {
          console.log('3D terrain profile fetch error:', err);
        });
    }
  }, [isCacheHydrated, latitude, longitude, terrainCacheList, addTerrainCache]);

  const simObj = useMemo(() => ({
    terrain: terrainData,
  }), [terrainData]);

  const sunPos = sunPosition(currentTime, latitude, longitude);
  const sunAltitude = (sunPos.altitude * 180) / Math.PI;
  const sunAzimuth = (sunPos.azimuth * 180) / Math.PI + 180;

  const moonPos = SunCalc.getMoonPosition(currentTime, latitude, longitude);
  const moonAltitude = (moonPos.altitude * 180) / Math.PI;
  const moonAzimuth = (moonPos.azimuth * 180) / Math.PI + 180;

  // ── 실제 기상 데이터 (스플래시 캐시 및 저장된 캐시 우선 초기화) ──────────────────────────
  const initialWeather = useMemo(() => {
    const cached = weatherCacheList.find(c => 
      c.key.includes(currentDateStr) && 
      sameBucket(c.latitude, c.longitude, latitude, longitude)
    );
    if (cached?.data && Array.isArray(cached.data)) {
      return cached.data as CloudPathData[];
    }
    return [];
  }, [weatherCacheList, currentDateStr, latitude, longitude]);

  const [pathData, setPathData] = useState<CloudPathData[]>(initialWeather);
  const [isWeatherLoading, setIsWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);

  // 비동기 스토어 캐시 로드 후 initialWeather가 생기면 즉시 화면 상태 동기화
  useEffect(() => {
    if (initialWeather.length > 0 && pathData.length === 0) {
      setPathData(initialWeather);
    }
  }, [initialWeather, pathData.length]);

  // ── 날짜 슬라이더 및 계절 마커 (맵뷰와 동일한 1년 슬라이더) ─────────────
  const tz = timezoneOffsetHours ?? 0;
  const localNow = useMemo(() => shiftTz(currentTime, tz), [currentTime, tz]);
  const currentYear = localNow.getUTCFullYear();
  const seasonMarkers = useMemo(() => getSeasonMarkers(currentYear), [currentYear]);
  const seasonMarkerPositions = useMemo(() => [
    { key: 'spring', pct: dateToDatePercent(seasonMarkers.springEquinox, tz), color: dataColor.spring },
    { key: 'summer', pct: dateToDatePercent(seasonMarkers.summerSolstice, tz), color: dataColor.summer },
    { key: 'autumn', pct: dateToDatePercent(seasonMarkers.autumnEquinox, tz), color: dataColor.autumn },
    { key: 'winter', pct: dateToDatePercent(seasonMarkers.winterSolstice, tz), color: dataColor.winter },
  ], [seasonMarkers, tz, dataColor]);

  // 날짜/시간 스크롤 상태 — 스크롤 중에는 날씨 호출 차단 및 3D 볼륨 씬 재생성 보류
  const [isSliding, setIsSliding] = useState(false);
  const isDateSlidingRef = useRef(false);
  const isTimeSlidingRef = useRef(false);
  const updateSlidingState = useCallback(() => {
    setIsSliding(isDateSlidingRef.current || isTimeSlidingRef.current);
  }, []);
  const weatherDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const weatherAbortControllerRef = useRef<AbortController | null>(null);
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  /**
   * 360° 전방위 날씨 로드 함수 (태양 방위와 무관)
   * 1개 지점의 초경량 카나리아 지문을 먼저 조회하여 기상청 모델 갱신 여부를 확인하고,
   * 모델 런이 같으면 대용량 요청을 100% 스킵하고 저장된 캐시를 그대로 사용합니다.
   */
  const loadWeather = useCallback(async (forceRefresh: boolean = false) => {
    if (!latitude || !longitude) return;

    // 이전 진행 중이던 요청이 있으면 즉시 중단(Abort)
    if (weatherAbortControllerRef.current) {
      weatherAbortControllerRef.current.abort();
      weatherAbortControllerRef.current = null;
    }

    const controller = new AbortController();
    weatherAbortControllerRef.current = controller;

    const reqLat = latitude, reqLon = longitude;
    const reqTime = currentTimeRef.current;
    const reqDate = currentDateStr;

    // 1) 캐시 조회 (동일 격자, 동일 날짜)
    const existingCache = weatherCacheList.find(c => 
      c.key.includes(reqDate) && 
      sameBucket(c.latitude, c.longitude, reqLat, reqLon)
    );

    // 2) 이미 유효한 캐시 데이터가 있고 강제 새로고침이 아닌 경우 -> 1개 점 카나리아 지문 검사
    if (existingCache?.data && Array.isArray(existingCache.data) && existingCache.data.length > 0 && !(existingCache.data as any)[0]?.isFallback && !forceRefresh) {
      const storedCanary = (existingCache as any).canaryPrint as string | undefined;

      if (storedCanary) {
        try {
          if (__DEV__) {
            console.log(`[Weather] 1개 점 카나리아 지문 검사 중... (${reqLat.toFixed(4)}, ${reqLon.toFixed(4)}, ${reqDate})`);
          }
          const canarySeries = await fetchWeatherCanary(reqLat, reqLon, reqTime, controller.signal);
          
          if (controller.signal.aborted) return;

          // 카나리아 지문이 일치하거나, 카나리아 조회가 실패(429/네트워크 오류)한 경우에도
          // 기존 캐시가 유효하므로 대용량 요청을 생략하고 기존 캐시를 유지합니다!
          if (!canarySeries || (canaryIsUsable(canarySeries) && canarySaysSkip(storedCanary, canarySeries))) {
            if (__DEV__) {
              console.log('[Weather] 카나리아 지문 일치 또는 캐시 유지 — 대용량 요청 생략!');
            }
            setPathData(existingCache.data as CloudPathData[]);
            setIsWeatherLoading(false);
            setWeatherError(null);
            return;
          }
          if (__DEV__) {
            console.log('[Weather] 카나리아 지문 불일치 또는 새 모델 런 감지 — 360° 전체 날씨 갱신 진행');
          }
        } catch (err: any) {
          if (controller.signal.aborted || err?.name === 'AbortError') return;
          // 에러 시에도 기존 캐시 안전하게 유지
          setPathData(existingCache.data as CloudPathData[]);
          setIsWeatherLoading(false);
          setWeatherError(null);
          return;
        }
      } else {
        // 저장된 지문이 없더라도 캐시 데이터가 있으므로 화면에 즉시 띄우고 불필요한 재요청 생략
        setPathData(existingCache.data as CloudPathData[]);
        setIsWeatherLoading(false);
        setWeatherError(null);
        return;
      }
    }

    // 3) 캐시가 없거나, 강제 새로고침이거나, 카나리아 지문이 갈린 경우:
    //    360° 전방위 고리 날씨를 1회 수신
    setIsWeatherLoading(true);
    setWeatherError(null);

    try {
      const [canarySeries, ringData] = await Promise.all([
        fetchWeatherCanary(reqLat, reqLon, reqTime, controller.signal).catch(() => null),
        fetchDayWeatherRing(reqLat, reqLon, reqTime, forceRefresh, controller.signal),
      ]);

      if (controller.signal.aborted) return;

      if (!Array.isArray(ringData) || ringData.length === 0) {
        throw new Error(t('weatherLoadFailed', language));
      }

      if (!(ringData as any)[0]?.isFallback) {
        addWeatherCache({
          key: weatherCacheKey(reqLat, reqLon, reqDate),
          data: ringData,
          timestamp: Date.now(),
          latitude: reqLat,
          longitude: reqLon,
          canaryPrint: canarySeries ? canaryPrint(canarySeries) : undefined,
        } as any);
      }

      setPathData(ringData);
      setWeatherError(null);
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === 'AbortError') return;
      const msg = err?.message || t('weatherLoadFailed', language);
      console.warn('3D weather fetch error:', msg);
      if (pathData.length === 0) {
        setWeatherError(msg);
      }
    } finally {
      if (weatherAbortControllerRef.current === controller) {
        weatherAbortControllerRef.current = null;
        setIsWeatherLoading(false);
      }
    }
  }, [latitude, longitude, currentDateStr, weatherCacheList, addWeatherCache, language, pathData.length]);

  const handleDateSlidingStart = useCallback(() => {
    isDateSlidingRef.current = true;
    updateSlidingState();
    // 1) 2초 타이머 즉시 취소
    if (weatherDebounceTimerRef.current) {
      clearTimeout(weatherDebounceTimerRef.current);
      weatherDebounceTimerRef.current = null;
    }
    // 2) 진행 중이던 기존 날씨 요청 즉시 중단
    if (weatherAbortControllerRef.current) {
      weatherAbortControllerRef.current.abort();
      weatherAbortControllerRef.current = null;
      setIsWeatherLoading(false);
    }
  }, [updateSlidingState]);

  /**
   * 날짜 손잡이를 끄는 동안 — 남아 있는 날씨 요청·타이머를 끊고, 받아 둔 날씨가 있으면 그 날의 하늘로 바로 바꿉니다.
   * (시각은 하단 막대가 이미 정해 `newDate` 로 넘깁니다.)
   */
  const handleDateScrubPreview = useCallback((newDate: Date) => {
    if (weatherDebounceTimerRef.current) {
      clearTimeout(weatherDebounceTimerRef.current);
      weatherDebounceTimerRef.current = null;
    }
    if (weatherAbortControllerRef.current) {
      weatherAbortControllerRef.current.abort();
      weatherAbortControllerRef.current = null;
      setIsWeatherLoading(false);
    }
    const newDateStr = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
    const cached = weatherCacheList.find(c =>
      c.key.includes(newDateStr) && sameBucket(c.latitude, c.longitude, latitude, longitude)
    );
    if (cached?.data && Array.isArray(cached.data) && cached.data.length > 0) {
      setPathData(cached.data as CloudPathData[]);
    }
  }, [weatherCacheList, latitude, longitude]);

  /** 하단 막대가 고른 시각. 날짜 손잡이를 끄는 중이면 위 정리를 먼저 하고 시각을 반영합니다. */
  const handleBarPick = useCallback((time: Date, meta?: { scrub?: ScrubKind }) => {
    if (meta?.scrub === 'date') handleDateScrubPreview(time);
    setCurrentTime(time);
  }, [handleDateScrubPreview, setCurrentTime]);

  const handleBarSlidingStart = useCallback((kind: ScrubKind) => {
    if (kind === 'date') handleDateSlidingStart();
    else { isTimeSlidingRef.current = true; updateSlidingState(); }
  }, [handleDateSlidingStart, updateSlidingState]);

  const handleDateSlidingComplete = useCallback(() => {
    isDateSlidingRef.current = false;
    updateSlidingState();
    if (weatherDebounceTimerRef.current) {
      clearTimeout(weatherDebounceTimerRef.current);
      weatherDebounceTimerRef.current = null;
    }
    // 스크롤을 떼고 250ms 뒤에 검증 및 로드 (기존 2초에서 대폭 단축하여 즉각 반응)
    weatherDebounceTimerRef.current = setTimeout(() => {
      weatherDebounceTimerRef.current = null;
      loadWeather(false);
    }, 250);
  }, [updateSlidingState, loadWeather]);

  const handleBarSlidingComplete = useCallback((kind: ScrubKind) => {
    if (kind === 'date') handleDateSlidingComplete();
    else { isTimeSlidingRef.current = false; updateSlidingState(); }
  }, [handleDateSlidingComplete, updateSlidingState]);

  const prevDateStrRef = useRef(currentDateStr);
  const prevLatLonRef = useRef(`${latitude?.toFixed(4)},${longitude?.toFixed(4)}`);
  const isMountedRef = useRef(false);

  useEffect(() => {
    // 디스크 캐시 로딩이 끝나지 않았으면 대기
    if (!isCacheHydrated) return;

    const latLonStr = `${latitude?.toFixed(4)},${longitude?.toFixed(4)}`;
    const isDateChanged = prevDateStrRef.current !== currentDateStr;
    const isLocChanged = prevLatLonRef.current !== latLonStr;

    prevDateStrRef.current = currentDateStr;
    prevLatLonRef.current = latLonStr;

    // 슬라이더 스크롤 중일 때는 즉시 로드하지 않고 타이머에 위임
    if (isDateSlidingRef.current || isTimeSlidingRef.current) {
      if (weatherDebounceTimerRef.current) {
        clearTimeout(weatherDebounceTimerRef.current);
        weatherDebounceTimerRef.current = null;
      }
      if (weatherAbortControllerRef.current) {
        weatherAbortControllerRef.current.abort();
        weatherAbortControllerRef.current = null;
        setIsWeatherLoading(false);
      }
      return;
    }

    // 마운트 시 (또는 isCacheHydrated 완료 직후): 캐시 먼저 확인
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      const cached = weatherCacheList.find(c => 
        c.key.includes(currentDateStr) && sameBucket(c.latitude, c.longitude, latitude, longitude)
      );
      if (cached?.data && Array.isArray(cached.data) && cached.data.length > 0) {
        setPathData(cached.data as CloudPathData[]);
        return;
      }
      if (pathData.length === 0) {
        loadWeather(false);
      }
      return;
    }

    if (isDateChanged || isLocChanged) {
      // 캐시에 데이터가 있으면 즉시 교체
      const cached = weatherCacheList.find(c => 
        c.key.includes(currentDateStr) && sameBucket(c.latitude, c.longitude, latitude, longitude)
      );
      if (cached?.data && Array.isArray(cached.data) && cached.data.length > 0) {
        setPathData(cached.data as CloudPathData[]);
      }

      // 날짜나 위치가 변경된 경우: 기존 요청 중단 + 250ms 디바운스
      if (weatherAbortControllerRef.current) {
        weatherAbortControllerRef.current.abort();
        weatherAbortControllerRef.current = null;
        setIsWeatherLoading(false);
      }
      if (weatherDebounceTimerRef.current) clearTimeout(weatherDebounceTimerRef.current);
      weatherDebounceTimerRef.current = setTimeout(() => {
        weatherDebounceTimerRef.current = null;
        loadWeather(false);
      }, 250);
      return;
    }
  }, [isCacheHydrated, latitude, longitude, currentDateStr, loadWeather, pathData.length, weatherCacheList]);

  useEffect(() => {
    return () => {
      if (weatherDebounceTimerRef.current) clearTimeout(weatherDebounceTimerRef.current);
      if (weatherAbortControllerRef.current) weatherAbortControllerRef.current.abort();
    };
  }, []);

  // ── 하루치 사전 계산 ─────────────────────────────────────────────────────
  //
  // "새로 만들기"를 누르면 그 장소·그 날짜의 하늘을 통째로 계산합니다.
  // 그 뒤로는 시간을 아무리 움직여도 네트워크도, fBm도 다시 돌지 않고
  // 키프레임 사이 보간만 합니다 (utils/skyTimeline.ts).
  const [isDevPanelOpen, setDevPanelOpen] = useState(false);
  const [timeline, setTimeline] = useState<SkyTimeline | null>(null);

  // 날짜나 장소가 바뀌면 계산해 둔 하늘은 더 이상 맞지 않습니다.
  const timelineValid = isTimelineUsable(timeline, latitude, longitude, currentTime);
  // 촬영하기(카메라)도 같은 하루치 하늘을 쓰도록 스토어에 내놓습니다(저장하지 않는 칸).
  const setSkyTimeline = useCelestialStore(s => s.setSkyTimeline);
  useEffect(() => { setSkyTimeline(timelineValid ? timeline : null); }, [timelineValid, timeline, setSkyTimeline]);
  useEffect(() => {
    if (timeline && !isTimelineUsable(timeline, latitude, longitude, currentTime)) {
      setTimeline(null);
    }
  }, [timeline, latitude, longitude, currentDateStr]);

  const interpolatedWeather = useMemo(
    () => (pathData.length ? getInterpolatedWeather(pathData, currentTime) : []),
    [pathData, currentTime]
  );

  const prediction = useMemo(() => scenePrediction({
    pathData,
    time: currentTime,
    sunAltDeg: sunAltitude,
    obs: interpolatedWeather[0],
    latitude,
    observerElevM: terrainData.observerElevation,
  }), [pathData, interpolatedWeather, currentTime, sunAltitude, latitude, terrainData.observerElevation]);

  // 오늘의 추천 및 일반 이벤트 — 모두 계산에서 나옵니다(`skyEvents.ts` 머리말).
  // 일몰·일출은 **그 시각의** 노을 예측으로 품질·점수를 답니다.
  const predictionAt = (tm?: Date | null) => {
    if (!tm || !pathData.length) return null;
    const sp = sunPosition(tm, latitude, longitude);
    const p = scenePrediction({
      pathData,
      time: tm,
      sunAltDeg: sp.altitude * (180 / Math.PI),
      obs: getInterpolatedWeather(pathData, tm)[0],
      latitude,
      observerElevM: terrainData.observerElevation,
    });
    return p ? { score: p.score, quality: p.quality } : null;
  };
  const eventItems = useMemo(() => buildSkyEvents({
    date: currentTime,
    latitude,
    longitude,
    events,
    sunsetPrediction: predictionAt(events?.sunset),
    sunrisePrediction: predictionAt(events?.sunrise),
    language,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [currentTime.toDateString(), events, pathData, latitude, language, terrainData.observerElevation]);

  const featuredList = useMemo(() => eventItems.filter(e => e.category === 'featured'), [eventItems]);
  const generalList = useMemo(() => eventItems.filter(e => e.category === 'general'), [eventItems]);

  const formatTimeStr = (d: Date) => {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  // 요약 한 줄에 쓸 값들
  const scoreText = prediction?.score != null ? t('evScore', language).replace('{n}', String(Math.round(prediction.score))) : '—';
  const sunsetText = events?.sunset
    ? `${String(events.sunset.getHours()).padStart(2, '0')}:${String(events.sunset.getMinutes()).padStart(2, '0')}`
    : '--:--';
  const highCloudPct = interpolatedWeather[0]?.high;

  return (
    <View style={styles.container}>
      {/* ── 3D 돔: 화면을 꽉 채웁니다 ───────────────────────────────────── */}
      {/* 무대 — 씬은 아래에서 PEEK_HEIGHT 만큼 비켜 고정, 시트는 그 위로 떠서 올라옵니다(찌그러짐 없음). */}
      <View style={styles.stage} onLayout={(e) => setStageH(e.nativeEvent.layout.height)}>
      <View style={styles.sceneWrapper}>
        <SkyScene3D
          sim={simObj}
          currentTime={currentTime}
          sunAltitude={sunAltitude}
          sunAzimuth={sunAzimuth}
          prediction={prediction}
          location={location}
          interpolatedWeather={interpolatedWeather}
          theme={OVERLAY_THEME}
          layers={layers}
          skySettings={skySettings}
          trackingTarget={trackingTarget}
          onSelectTrackingTarget={setTrackingTarget}
          fullScreen={true}
          timeline={timelineValid ? timeline : null}
          isActive={isActive}
          isSliding={isSliding}
        />

        {trackingTarget && (
          <PressScale
            style={overlayStyles.trackingBadge}
            onPress={() => setTrackingTarget(null)}
            activeOpacity={0.8}
          >
            <Target size={11} color={DARK.accent} style={{ marginRight: 4 }} />
            <Text style={overlayStyles.trackingText}>
              {t(trackingTarget === 'sun' ? 'trackSun' : trackingTarget === 'moon' ? 'trackMoon' : trackingTarget === 'milkyway' ? 'trackMilky' : 'trackBody', language)}
            </Text>
            <Text style={overlayStyles.trackingCancel}> {t('trackRelease', language)}</Text>
          </PressScale>
        )}

        {/* 씬 위 오버레이 버튼: 3D 표시 설정 */}
        <View style={overlayStyles.sceneOverlayButtons}>
          {/* 3D 요소 표시 설정 모달 */}
          <OverlayButton
            onPress={() => setLayerModalVisible(true)}
            // 개발자/튜닝 패널 — 레이어 버튼 길게 누르기로 열고 닫습니다.
            onLongPress={() => setDevPanelOpen(v => !v)}
            accessibilityLabel={t('layerTitle', language)}
          >
            <SlidersHorizontal size={16} color={DARK.text} />
          </OverlayButton>

          {/* 개발자 튜닝 — 레이어 버튼 길게 누르기로도 열립니다 */}
          {isDevPanelOpen && (
            <OverlayButton active onPress={() => setDevPanelOpen(false)}>
              <SlidersVertical size={14} color={DARK.accent} />
            </OverlayButton>
          )}
        </View>

        {/* 날씨 수신 실패 배너 및 재시도 버튼 */}
        {weatherError && (
          <Reveal style={overlayStyles.weatherErrorBanner}>
            <View style={overlayStyles.weatherErrorHeader}>
              <CloudOff size={15} color="#F87171" />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={overlayStyles.weatherErrorTitle}>
                  {t('weatherLoadFailed', language)}
                </Text>
                <Text style={overlayStyles.weatherErrorDesc} numberOfLines={1}>
                  {weatherError}
                </Text>
              </View>
              <PressScale
                style={overlayStyles.weatherRetryButton}
                onPress={() => loadWeather(true)}
                disabled={isWeatherLoading}
                activeOpacity={0.7}
              >
                {isWeatherLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <View style={overlayStyles.weatherRetryContent}>
                    <RefreshCw size={11} color="#FFFFFF" style={{ marginRight: 4 }} />
                    <Text style={overlayStyles.weatherRetryText}>
                      {t('retry', language)}
                    </Text>
                  </View>
                )}
              </PressScale>
            </View>
          </Reveal>
        )}
      </View>

      {/* ── peek 시트: 닫히면 요약 한 줄, 끌어올리면 근거와 수치 ─────────── */}
      <PeekSheet
        theme={theme}
        maxHeight={stageH || undefined}
        summary={
          <View style={styles.summaryRow}>
            <Flame size={13} color={color.glow} />
            <Text style={[styles.summaryScore, { color: theme.text }]}>{scoreText}</Text>
            <Text style={[styles.summaryDot, { color: theme.subText }]}>·</Text>
            <Sunset size={12} color={color.glow} />
            <Text style={[styles.summaryValue, { color: theme.text }]}>{sunsetText}</Text>
            {highCloudPct != null && (
              <>
                <Text style={[styles.summaryDot, { color: theme.subText }]}>·</Text>
                <Text style={[styles.summaryValue, { color: theme.subText }]}>
                  {t('highCloudPct', language).replace('{n}', String(Math.round(highCloudPct)))}
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

          {/* 이벤트 — 탭하면 그 시각으로 이동 */}
          <View style={styles.eventSection}>
            <View style={styles.tabToggleGroup}>
              <PressScale
                style={[styles.tabButton, activeTab === 'featured' && styles.tabButtonActive]}
                onPress={() => setActiveTab('featured')}
                activeOpacity={0.8}
              >
                <Sparkles size={12} color={activeTab === 'featured' ? color.accent : color.textDim} style={{ marginRight: 4 }} />
                <Text style={[styles.tabText, activeTab === 'featured' && styles.tabTextActive]}>{t('evFeatured', language)}</Text>
              </PressScale>

              <PressScale
                style={[styles.tabButton, activeTab === 'general' && styles.tabButtonActive]}
                onPress={() => setActiveTab('general')}
                activeOpacity={0.8}
              >
                <Sun size={12} color={activeTab === 'general' ? color.accent : color.textDim} style={{ marginRight: 4 }} />
                <Text style={[styles.tabText, activeTab === 'general' && styles.tabTextActive]}>{t('evGeneral', language)}</Text>
              </PressScale>
            </View>

            {(activeTab === 'featured' ? featuredList : generalList).map(item => (
              <PressScale
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
                  if (item.id.includes('sunset')) return <Sunset size={14} color={color.glow} />;
                  if (item.id.includes('sunrise')) return <Sun size={14} color={color.sun} />;
                  if (item.id.includes('crescent')) return <Moon size={14} color={color.moon} />;
                  if (item.id.includes('milkyway')) return <Sparkles size={14} color="#A78BFA" />;
                  if (item.id.includes('planets')) return <Star size={14} color="#F43F5E" />;
                  if (item.id.includes('moon')) return <Moon size={14} color={color.moon} />;
                  return <Sun size={14} color={color.sun} />;
                })()}
                <View style={styles.eventRowText}>
                  <Text style={[styles.eventTitle, { color: theme.text }]}>{item.title}</Text>
                  <Text style={[styles.eventDesc, { color: theme.subText }]} numberOfLines={1}>
                    {item.description}
                  </Text>
                </View>
                {item.badge && (
                  <Text style={[styles.eventBadge, { color: theme.subText, borderColor: theme.border }]}>{item.badge}</Text>
                )}
                <Text style={[styles.eventTime, { color: theme.text }]}>{formatTimeStr(item.time)}</Text>
              </PressScale>
            ))}
          </View>

          {/* 태양·달 수치 — 맨 아래: 예측(판단) → 이벤트(언제) → 수치(근거) 순으로 읽습니다. */}
          <View style={[styles.numberFrame, { backgroundColor: theme.glass, borderColor: theme.border }]}>
            <View style={styles.frameHeader}>
              <Sun size={11} color={color.sun} />
              <Text style={[styles.frameLabel, { color: theme.subText }]}>{t('sunMoon', language)}</Text>
            </View>
            <View style={styles.numberGrid}>
              <InfoCard
                icon={<Sun size={14} color={color.sun} />}
                label={t('sunLabel', language)}
                value={`${sunAltitude.toFixed(0)}°`}
                subValue={`${sunAzimuth.toFixed(0)}°`}
                theme={theme}
              />
              <InfoCard
                icon={<Moon size={14} color={color.moon} />}
                label={t('moonLabel', language)}
                value={`${moonAltitude.toFixed(0)}°`}
                subValue={`${moonAzimuth.toFixed(0)}°`}
                theme={theme}
              />
              <InfoCard
                icon={<Sunset size={14} color={color.glow} />}
                label={t('sunset', language)}
                value={sunsetText}
                theme={theme}
              />
            </View>
          </View>
        </ScrollView>
      </PeekSheet>
      </View>

      {/* ── 상시 노출: 날짜 + 시간 막대 한 벌(§143) ─────────────────────────
             ±1일 · ±1시간 · ±1년, 리드타임 정확도 띠, 데이터 기간 — `TimeBar/DateTimeBar.tsx`. */}
      <View style={[styles.bottomPanel, { backgroundColor: color.panel, borderColor: color.border }]}>
        <DateTimeBar
          currentTime={currentTime}
          onPick={handleBarPick}
          onSlidingStart={handleBarSlidingStart}
          onSlidingComplete={handleBarSlidingComplete}
          isTimeMachineEnabled={isTimeMachineEnabled}
          onNow={() => setTimeMachineEnabled?.(false)}
          onOpenDatePicker={onOpenDatePicker}
          onCameraPress={onCameraPress}
          events={events}
          seasonPcts={seasonMarkerPositions}
        />
      </View>

      <DevTuningPanel visible={isDevPanelOpen} onClose={() => setDevPanelOpen(false)} />

      <LayerControlModal
        visible={isLayerModalVisible}
        onClose={() => setLayerModalVisible(false)}
        layers={layers}
        onToggleLayer={(key) => setSkyLayers(prev => {
          // paths 토글 시 labels도 동기화
          if (key === 'paths') {
            return { ...prev, paths: !prev.paths, labels: !prev.paths };
          }
          return { ...prev, [key]: !prev[key] };
        })}
        skySettings={skySettings}
        onChangeSkySettings={(next) => setSkySettings(next)}
        theme={theme}
      />
    </View>
  );
};

/** 하늘 위의 떠 있는 것 — 화면 모드와 상관없이 어둡습니다(모듈의 어두운 `color`). */
const overlayStyles = StyleSheet.create({
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
    borderRadius: radius.xs,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buildBanner: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    backgroundColor: color.panel,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: 12,
    paddingVertical: 9,
    zIndex: 25,
    gap: 6,
  },
  buildLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: color.text,
  },
  buildHint: {
    fontSize: 9,
    fontWeight: '700',
    color: color.textMute,
  },
  buildError: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FCA5A5',
  },
  progressTrack: {
    height: 4,
    borderRadius: radius.xs,
    backgroundColor: 'rgba(148, 163, 184, 0.25)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: radius.xs,
    backgroundColor: color.success,
  },
  weatherErrorBanner: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    backgroundColor: 'rgba(23, 23, 23, 0.92)',
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    zIndex: 25,
  },
  weatherErrorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weatherErrorTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#F87171',
  },
  weatherErrorDesc: {
    fontSize: 11,
    fontWeight: '700',
    color: color.textMute,
    marginTop: 2,
  },
  weatherRetryButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.85)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.xs,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  weatherRetryContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weatherRetryText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  trackingBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(11, 19, 43, 0.85)',
    borderColor: color.accent,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs,
    zIndex: 20,
    gap: 4,
  },
  trackingText: {
    fontSize: 11,
    fontWeight: '800',
    color: color.text,
    fontFamily: mono,
  },
  trackingCancel: {
    fontSize: 11,
    fontWeight: '800',
    color: color.accent,
  },
});

/** 시트·아래 패널 — 화면 모드를 따릅니다. */
const useStyles = makeStyles((color) => ({
  container: {
    flex: 1,
  },
  stage: {
    flex: 1,
    position: 'relative',
  },
  sceneWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: PEEK_HEIGHT,
    overflow: 'hidden',
  },

  // ── peek 시트 요약 한 줄 ──────────────────────────────────────────────
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryScore: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
    fontFamily: mono,
  },
  summaryValue: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: mono,
  },
  summaryDot: {
    fontSize: 13,
    fontWeight: '700',
    opacity: 0.5,
  },

  // ── 시트 본문 ────────────────────────────────────────────────────────
  sheetScroll: {
    paddingBottom: 16,
    gap: 10,
  },
  numberFrame: {
    borderRadius: radius.xs,
    padding: 10,
    borderWidth: 1,
    borderColor: color.border,
  },
  frameHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    marginBottom: 6,
    gap: 6,
  },
  frameLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: mono,
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
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: 'rgba(148, 163, 184, 0.1)',
  },
  tabButtonActive: {
    backgroundColor: color.accentSoft,
    borderColor: color.accentLine,
  },
  tabText: {
    fontSize: 11,
    fontWeight: '700',
    color: color.textDim,
    fontFamily: mono,
    letterSpacing: 0.3,
  },
  tabTextActive: {
    color: color.accent,
    fontWeight: '800',
  },
  // 이벤트를 가로 스크롤 카드가 아니라 세로 목록으로 바꿨습니다.
  // 시트 안에서는 세로 스크롤이 이미 있어서 가로 스크롤과 충돌합니다.
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
  },
  eventRowFeatured: {
    borderColor: 'rgba(245, 158, 11, 0.45)',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  eventRowText: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  eventDesc: {
    fontSize: 11,
    marginTop: 1,
    fontFamily: mono,
  },
  eventBadge: {
    fontSize: 11,
    fontWeight: '700',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginRight: 8,
  },
  eventTime: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.4,
  },

  bottomPanel: {
    paddingTop: 3,
    paddingBottom: Platform.OS === 'android' ? 20 : 6,
    borderTopWidth: 1,
    borderColor: color.border,
  },
}));
