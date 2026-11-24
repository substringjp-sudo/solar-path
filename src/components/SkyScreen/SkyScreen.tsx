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
import { StyleSheet, View, Text, ActivityIndicator, Platform, Switch, Image, Dimensions } from 'react-native';
import { Sun, Sunset, Moon, SlidersVertical, CloudOff, RefreshCw, ListChecks, Play, Square } from 'lucide-react-native';
import { SkyScene3D, type SkyScene3DHandle } from '../SkyScene3D/SkyScene3D';
import { LayerControlModal } from '../SunsetSimulation/LayerControlModal';
import { HEADER_HEIGHT, belowHeader } from '../../utils/headerLayout';
/** 시간 자 · 날짜 줄을 끄는 종류(시간 자가 새 틀의 `SlideKind` 와 같은 값). */
type ScrubKind = 'date' | 'time';
import { useCelestialStore } from '../../store/useCelestialStore';
import {
  fetchTerrainProfile,
  fetchDayWeatherRing,
  fetchWeatherCanary,
  getInterpolatedWeather,
  type CloudPathData,
  type TerrainData,
} from '../../utils/weather';
import { findPresetTerrain } from '../../utils/presetTerrains';
import { isCurrentTerrainModel } from '../../utils/terrainPick';
import { scenePrediction } from '../../utils/scenePrediction';
import {
  weatherCacheKey,
  sameBucket,
  shouldSkipWeatherDownload,
  canaryPrint,
} from '../../utils/cachePolicy';
import {
  isTimelineUsable,
  type SkyTimeline,
} from '../../utils/skyTimeline';
import { PredictionCard } from '../SunsetSimulation/PredictionCard';
import { findGlowPeak, type GlowPeak } from '../../utils/glowPeak';
import { scoreWindow, sampleScores, hasAnyScore, canGlow } from '../../utils/scoreSeries';
import { ScoreGraph } from './ScoreGraph';
import { hapticError } from '../../utils/haptics';
import { InfoCard } from '../InfoCard';
import { cloudSummary, skyDirection } from '../../utils/skyWords';
import { DevTuningPanel } from './DevTuningPanel';
import {
  getVolumetricStatus,
  subscribeVolumetricStatus,
  type VolumetricPrewarmStatus,
} from '../VolumetricProbe/volumetricStatus';
import { getMoonPositionPrecise, moonSemidiameterDeg } from '../../utils/moonPosition';
import { sunPosition } from '../../utils/solarPosition';
import { starArgsFor, hourlyCovers, starWeatherOf, type StarWeather } from '../../utils/starTonight';
import { estimateLightPollution, type NightLights } from '../../utils/cityLightMap';
import { getCachedNightLights, loadNightLights } from '../../utils/nightLightsAsset';
import { upcomingMoments, starMoment } from '../../utils/upcomingMoments';
import { localNoons, type EventSide } from '../../utils/sunForecast';
import type { LearnEntry, LearnSection, LearnTopic } from '../../utils/learnSections';
import { useForecastDays } from '../../hooks/useForecastDays';
import { UpcomingCards } from './UpcomingCards';
import { t, L3 } from '../../utils/i18n';
import { color, color as DARK, radius, mono, type } from '../../theme/tokens';
import { makeStyles, OVERLAY_THEME } from '../../theme/useTheme';
import { PressScale, OverlayButton, Reveal } from '../ui';
import { distanceM } from '../../utils/geoMove';
import type { MoveMode } from '../../utils/joystickMotion';
import { type FarStatus } from './SandboxPanel';
import { SkyFrame, LiveReadout } from './SkyFrame';
import { GlassChip } from '../glass/GlassChip';
import { GlassSurface } from '../glass/GlassSurface';
import { SandboxShootPanel, type SandboxShootMode } from './SandboxShootPanel';
import { CornerExposureBadge } from '../AstroCamera/CornerExposureBadge';
import { SceneSheet, type SaveResult } from './SceneSheet';
import { makeScene, nextSceneId, pendingTargetFromScene, targetFromPicked, type SavedScene } from '../../utils/savedScenes';
import { rebuildPicked, targetPointOf } from '../../utils/pickedTarget';
import { eyeForMode } from '../../utils/flightAssist';
import { useGlide } from '../../hooks/useGlide';
import { DialPair, MoveStick } from './SandboxDials';
import { useJoystickDriver } from '../../hooks/useJoystickDriver';
import { ObjectInfoPanel } from './ObjectInfoPanel';
import { snapBuildingTarget, type PickedTarget } from '../../utils/demPick';
import {
  planAstroShotSummary,
  computeAstroSimExposureParams,
  createDefaultAstroSettings,
  type AstroSettingsState,
} from '../../utils/astroCameraUi';
import type { AstroCameraCapabilities } from '../../../modules/astro-camera';
import {
  adviseExposure,
  computeManualEvOffset,
  wbTintColor,
  type PhotoWbPreset,
} from '../../utils/exposureAdvice';
import { lensLine } from '../../utils/lensInfo';
import { planTimelapse, previewTimeAt, videoClock, type TimelapsePlan } from '../../utils/timelapsePlan';
import { analyzeAstroWindow, type AstroWindowAnalysis } from '../../utils/astroForecast';

const SANDBOX_ASTRO_CAPS: AstroCameraCapabilities = {
  available: false, cameraId: '', hardwareLevel: -1, rawSupported: false, manualSensorSupported: false,
  minExposureMs: 100, maxExposureMs: 30000, minIso: 100, maxIso: 6400,
  focalLengthMm: 4.5, focal35mm: 24, hfovDeg: 65, sensorOrientation: 90,
  supportsFocusDistance: false, rawWidth: 0, rawHeight: 0, yuvWidth: 0, yuvHeight: 0,
};

/** 해·달 걸기로 시선을 옮길 때 시야 중심을 올리는 몫(화면 높이의 비율) — 아래쪽을 덮는 정보 패널 위로 대상이 오게. */
const ALIGN_VIEW_OFFSET_Y = 0.25;

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
  isCameraOverlayActive?: boolean;
  /** 점수 숫자 · 왜 그런가요 · 별 보기 카드 · 다가오는 좋은 순간 카드 · 구름 한 줄을 누르면 — 02 학습으로 가서 그 구역 · 주제 · 날로 맞춥니다(App 이 탭을 바꿉니다). */
  onOpenLearn?: (entry: Omit<LearnEntry, 'nonce'>) => void;
  /** 하단 모드 줄에서 "데이터"를 고를 때 */
  onOpenData?: () => void;
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
  isCameraOverlayActive = false,
  onOpenLearn,
  onOpenData,
}) => {
  const styles = useStyles();
  // 2026-11-19 초보자 화면 덜어내기(docs/SANDBOX_MODE_PLAN.md 2.4): 꺼짐이 기본, 켜면 지금까지의 모든 조작.
  const expertMode = useCelestialStore(s => s.expertMode);
  const setExpertMode = useCelestialStore(s => s.setExpertMode);
  // 새 화면 틀(실험, 설정의 "실험"): 켜면 아래 시트 · 시간 막대 · 샌드박스 조작부 대신 유리 막대(SkyFrame)가 서고, 그 안에 같은 조작부가 칩 · 펼침으로 들어갑니다.
  // 샌드박스 망원 배율(전문가 모드만) — 1 이면 지금까지처럼 지상 시야각 30~120°, 20 이면 1.5~6°(달 사진용).
  const [teleX, setTeleX] = useState(1);
  // 샌드박스 눈 높이(m)와 이동 모드(걷기 · 자전거 · 차 · 비행). 전문가 모드가 꺼지면 씬에는 눈 높이를 넘기지 않아 원래(1.6 m)로 돌아갑니다.
  const [eyeH, setEyeH] = useState(1.6);
  const [moveMode, setMoveMode] = useState<MoveMode>('bike');
  const homeCoords = useCelestialStore(s => s.homeCoords);
  // 샌드박스에서 화면을 탭해 고른 대상(지형 지점). 전문가 모드를 끄거나 위치가 바뀌면 지웁니다.
  const [picked, setPicked] = useState<PickedTarget | null>(null);
  const [pickedDetailOpen, setPickedDetailOpen] = useState(false);
  useEffect(() => { if (!expertMode) setPicked(null); }, [expertMode]);
  useEffect(() => { if (!picked) setPickedDetailOpen(false); }, [picked]);
  const goodOnly = useCelestialStore(s => !!s.notifPrefs?.goodOnly);
  const setNotifPref = useCelestialStore(s => s.setNotifPref);
  const toggleGoodOnly = (next: boolean) => {
    setNotifPref('goodOnly', next);
    // 켜면 노을 · 일출 예보도 켭니다 — 거를 알림이 있어야 합니다(02 학습의 "좋음 이상 알림"과 같은 동작).
    if (next) { setNotifPref('sunsetForecast', true); setNotifPref('sunriseForecast', true); }
  };
  const { location, weatherCacheList, terrainCacheList, addTerrainCache, addWeatherCache, language, timezoneOffsetHours, isCacheHydrated } = useCelestialStore();
  const [isLayerModalVisible, setLayerModalVisible] = useState(false);
  const [trackingTarget, setTrackingTarget] = useState<string | null>(null);
  // 레이어·하늘 설정은 스토어에 둡니다 — 촬영하기(카메라)의 3D 가 같은 값으로 그리게.
  const layers = useCelestialStore(s => s.skyLayers);
  const setSkyLayers = useCelestialStore(s => s.setSkyLayers);
  const skySettings = useCelestialStore(s => s.skySettings);
  const setSkySettings = useCelestialStore(s => s.setSkySettings);

  const latitude = location?.coords.latitude ?? 37.5665;
  const longitude = location?.coords.longitude ?? 126.9780;
  const pickedRef = useRef<PickedTarget | null>(null);
  pickedRef.current = picked;
  useEffect(() => {
    const cur = pickedRef.current;
    if (!cur) return;
    const pt = targetPointOf(cur);
    if (!pt) { setPicked(null); return; }
    const tp = sceneRef.current?.targetFromLatLon?.(pt.latitude, pt.longitude, pt.elevM);
    if (!tp || tp.distM > 50_000) { setPicked(null); return; }
    setPicked(rebuildPicked(cur.kind, cur.building, tp));
  }, [latitude, longitude]);   // 자리 이동 후 고른 대상을 새 눈 기준으로 다시 계산(너무 멀어지면 해제)

  const currentDateStr = useMemo(
    () => `${currentTime.getFullYear()}-${String(currentTime.getMonth() + 1).padStart(2, '0')}-${String(currentTime.getDate()).padStart(2, '0')}`,
    [currentTime]
  );

  // 3D 지형 실루엣 및 사용자 해발 고도 State (프리셋 및 캐시 우선 초기화)
  const initialTerrain: TerrainData = useMemo(() => {
    const preset = findPresetTerrain(latitude, longitude);
    if (preset) return preset;

    const cached = terrainCacheList.find(c => Math.abs(c.latitude - latitude) < 0.05 && Math.abs(c.longitude - longitude) < 0.05 && isCurrentTerrainModel(c.data));
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
        (item) => Math.abs(item.latitude - latitude) < 0.05 && Math.abs(item.longitude - longitude) < 0.05 && isCurrentTerrainModel(item.data)
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

  const sunPos = sunPosition(currentTime, latitude, longitude);
  const sunAltitude = (sunPos.altitude * 180) / Math.PI;
  const sunAzimuth = (sunPos.azimuth * 180) / Math.PI + 180;

  const moonPos = getMoonPositionPrecise(currentTime, latitude, longitude);
  const moonAltitude = (moonPos.altitude * 180) / Math.PI;
  const moonAzimuth = (moonPos.azimuth * 180) / Math.PI + 180;

  // ── 실제 기상 데이터 (스플래시 캐시 및 저장된 캐시 우선 초기화) ──────────────────────────
  const matchedWeatherCache = useMemo(() => {
    return weatherCacheList.find(c =>
      c.key.includes(currentDateStr) &&
      sameBucket(c.latitude, c.longitude, latitude, longitude)
    ) ?? null;
  }, [weatherCacheList, currentDateStr, latitude, longitude]);

  const initialWeather = useMemo(() => {
    if (matchedWeatherCache?.data && Array.isArray(matchedWeatherCache.data)) {
      return matchedWeatherCache.data as CloudPathData[];
    }
    return [];
  }, [matchedWeatherCache]);

  const [pathData, setPathData] = useState<CloudPathData[]>(initialWeather);
  const [isWeatherLoading, setIsWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  // 값은 더 이상 화면에 쓰이지 않고(옛 화면의 새로고침 줄) 설정자만 흐름 정리에 남습니다.
  const [, setIsForceRefreshing] = useState(false);
  const [, setWeatherRefreshError] = useState<string | null>(null);
  const [volPrewarm, setVolPrewarm] = useState<VolumetricPrewarmStatus | null>(() => getVolumetricStatus().prewarm);

  useEffect(() => {
    return subscribeVolumetricStatus(s => setVolPrewarm(s.prewarm));
  }, []);

  const simObj = useMemo(() => ({
    terrain: terrainData,
    pathData,
  }), [terrainData, pathData]);

  // 비동기 스토어 캐시 로드 후 initialWeather가 생기면 즉시 화면 상태 동기화
  useEffect(() => {
    if (initialWeather.length > 0 && pathData.length === 0) {
      setPathData(initialWeather);
    }
  }, [initialWeather, pathData.length]);

  // ── 날짜 슬라이더 및 계절 마커 (맵뷰와 동일한 1년 슬라이더) ─────────────
  const tz = timezoneOffsetHours ?? 0;

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
  const [sandboxShootMode, setSandboxShootMode] = useState<SandboxShootMode>('photo');
  const isAstroMode = expertMode && sandboxShootMode === 'astro';
  const skippedAstroDateRef = useRef(false);
  const prevIsAstroRef = useRef(isAstroMode);
  // 맑은 하늘 대체 자료(429 등)를 쓰는 중인지 — 알림을 띄우고 뒤에서 다시 받습니다(1·2·4·5 분 간격).
  const usingFallbackSky = Boolean((pathData as any)?.[0]?.isFallback);
  const fallbackRetryRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; n: number }>({ timer: null, n: 0 });

  /**
   * 360° 전방위 날씨 로드 함수 (태양 방위와 무관)
   * 1개 지점의 초경량 카나리아 지문을 먼저 조회하여 기상청 모델 갱신 여부를 확인하고,
   * 모델 런이 같으면 대용량 요청을 100% 스킵하고 저장된 캐시를 그대로 사용합니다.
   */
  const loadWeather = useCallback(async (forceRefresh: boolean = false) => {
    if (!latitude || !longitude) return;

    if (forceRefresh && weatherDebounceTimerRef.current) {
      clearTimeout(weatherDebounceTimerRef.current);
      weatherDebounceTimerRef.current = null;
    }

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
    const hasValidCache = Boolean(
      existingCache?.data &&
      Array.isArray(existingCache.data) &&
      existingCache.data.length > 0 &&
      !(existingCache.data as any)[0]?.isFallback
    );

    if (forceRefresh) {
      setIsForceRefreshing(true);
      setWeatherRefreshError(null);
    }

    // 2) 이미 유효한 캐시 데이터가 있고 강제 새로고침이 아닌 경우 -> 1개 점 카나리아 지문 검사
    if (!forceRefresh && hasValidCache) {
      const storedCanary = (existingCache as any)?.canaryPrint as string | undefined;

      if (storedCanary) {
        try {
          if (__DEV__) {
            console.log(`[Weather] 1개 점 카나리아 지문 검사 중... (${reqLat.toFixed(4)}, ${reqLon.toFixed(4)}, ${reqDate})`);
          }
          const canarySeries = await fetchWeatherCanary(reqLat, reqLon, reqTime, controller.signal);

          if (controller.signal.aborted) return;

          const decision = shouldSkipWeatherDownload({
            hasValidCache,
            forceRefresh: false,
            storedCanary,
            canarySeries,
          });
          if (decision.skip) {
            if (__DEV__) {
              console.log(`[Weather] 카나리아 (${decision.reason}) — 대용량 요청 생략!`);
            }
            setPathData(prev => (prev === existingCache!.data ? prev : (existingCache!.data as CloudPathData[])));
            setIsWeatherLoading(false);
            setWeatherError(null);
            return;
          }
          if (__DEV__) {
            console.log('[Weather] 카나리아 지문 불일치 또는 새 모델 런 감지 — 360° 전체 날씨 갱신 진행');
          }
        } catch {
          if (controller.signal.aborted) return;
          // 에러(타임아웃 포함) 시에도 기존 캐시 안전하게 유지
          setPathData(prev => (prev === existingCache!.data ? prev : (existingCache!.data as CloudPathData[])));
          setIsWeatherLoading(false);
          setWeatherError(null);
          return;
        }
      } else {
        // 저장된 지문이 없더라도 캐시 데이터가 있으므로 화면에 즉시 띄우고 불필요한 재요청 생략
        setPathData(prev => (prev === existingCache!.data ? prev : (existingCache!.data as CloudPathData[])));
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
      const ringData = await fetchDayWeatherRing(reqLat, reqLon, reqTime, forceRefresh, controller.signal);

      if (controller.signal.aborted) return;

      if (!Array.isArray(ringData) || ringData.length === 0) {
        throw new Error(t('weatherLoadFailed', language));
      }

      const returnedFallback = Boolean((ringData as any)[0]?.isFallback);
      if (returnedFallback && hasValidCache && existingCache?.data) {
        // 강제 갱신 중 API 한도(429)로 폴백이 내려온 경우 기존 실제 캐시를 유지하고 사용자에게 알립니다.
        setPathData(prev => (prev === existingCache.data ? prev : (existingCache.data as CloudPathData[])));
        setWeatherRefreshError(
          L3(
            language,
            '요청 한도(429)로 새 수신을 못해 기존 캐시를 유지했습니다',
            'Rate limited (429) — kept existing cached weather',
            'リクエスト制限(429)のため既存キャッシュを維持しました',
          )
        );
        return;
      }

      const downloadedAt = Date.now();
      // 링 수신 직후 화면에 바로 반영하고, 카나리아 지문 조회는 뒤에서 순차 실행해 연결 경쟁을 피합니다.
      setPathData(ringData);
      setWeatherError(null);
      setWeatherRefreshError(null);
      setIsWeatherLoading(false);

      if (!returnedFallback) {
        const canarySeries = await fetchWeatherCanary(reqLat, reqLon, reqTime, controller.signal).catch(() => null);
        addWeatherCache({
          key: weatherCacheKey(reqLat, reqLon, reqDate),
          data: ringData,
          timestamp: downloadedAt,
          latitude: reqLat,
          longitude: reqLon,
          canaryPrint: canarySeries ? canaryPrint(canarySeries) : undefined,
        } as any);
      }
    } catch (err: any) {
      if (controller.signal.aborted) return;
      const isTimeout = err?.name === 'AbortError';
      const msg = isTimeout
        ? L3(language, '날씨 서버 응답 시간이 초과되었습니다', 'Weather server request timed out', '天気サーバーの応答がタイムアウトしました')
        : (err?.message || t('weatherLoadFailed', language));
      console.warn(`3D weather fetch error: ${msg}`);
      if (pathData.length === 0) {
        setWeatherError(msg);
      } else if (forceRefresh) {
        setWeatherRefreshError(msg);
      }
      if (forceRefresh) hapticError();
    } finally {
      if (weatherAbortControllerRef.current === controller) {
        weatherAbortControllerRef.current = null;
        setIsWeatherLoading(false);
        setIsForceRefreshing(false);
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
      setPathData(prev => (prev === cached.data ? prev : (cached.data as CloudPathData[])));
    }
  }, [weatherCacheList, latitude, longitude]);

  useEffect(() => {
    const st = fallbackRetryRef.current;
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    if (!usingFallbackSky || isAstroMode) { st.n = 0; return; }
    const waitMs = Math.min(300_000, 60_000 * 2 ** st.n);
    st.timer = setTimeout(() => {
      st.timer = null;
      st.n += 1;
      loadWeather(false);
    }, waitMs);
    return () => { if (st.timer) { clearTimeout(st.timer); st.timer = null; } };
  }, [usingFallbackSky, isAstroMode, pathData, loadWeather]);

  /** 하단 막대가 고른 시각. 날짜 손잡이를 끄는 중이면 위 정리를 먼저 하고 시각을 반영합니다. */
  const handleBarPick = useCallback((time: Date, meta?: { scrub?: ScrubKind }) => {
    if (meta?.scrub === 'date') handleDateScrubPreview(time);
    setCurrentTime(time);
  }, [handleDateScrubPreview, setCurrentTime]);

  const handleBarSlidingStart = useCallback((kind: ScrubKind) => {
    if (kind === 'date') handleDateSlidingStart();
    else { isTimeSlidingRef.current = true; updateSlidingState(); }
  }, [handleDateSlidingStart, updateSlidingState]);

  /** 하늘을 떠나 지도·구 단계에 있는지 — 그때는 "지도로" 버튼 대신 지도 위 "착륙"이 돌아오는 길입니다. */
  const [ascended, setAscended] = useState(false);
  const prevWasAscendedRef = useRef(false);

  const handleDateSlidingComplete = useCallback(() => {
    isDateSlidingRef.current = false;
    updateSlidingState();
    if (weatherDebounceTimerRef.current) {
      clearTimeout(weatherDebounceTimerRef.current);
      weatherDebounceTimerRef.current = null;
    }
    if (isAstroMode || ascended) {
      skippedAstroDateRef.current = true;
      return;
    }
    // 스크롤을 떼고 250ms 뒤에 검증 및 로드 (기존 2초에서 대폭 단축하여 즉각 반응)
    weatherDebounceTimerRef.current = setTimeout(() => {
      weatherDebounceTimerRef.current = null;
      loadWeather(false);
    }, 250);
  }, [updateSlidingState, loadWeather, isAstroMode, ascended]);

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
    const wasAstroMode = prevIsAstroRef.current;
    const wasAscended = prevWasAscendedRef.current;

    prevDateStrRef.current = currentDateStr;
    prevLatLonRef.current = latLonStr;
    prevIsAstroRef.current = isAstroMode;
    prevWasAscendedRef.current = ascended;

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
        setPathData(prev => (prev === cached.data ? prev : (cached.data as CloudPathData[])));
        return;
      }
      if (pathData.length === 0) {
        loadWeather(false);
      }
      return;
    }

    const resumedFromAstro = ((wasAstroMode && !isAstroMode) || (wasAscended && !ascended)) && skippedAstroDateRef.current;

    if (isDateChanged || isLocChanged || resumedFromAstro) {
      setWeatherRefreshError(null);
      // 캐시에 데이터가 있으면 즉시 교체
      const cached = weatherCacheList.find(c => 
        c.key.includes(currentDateStr) && sameBucket(c.latitude, c.longitude, latitude, longitude)
      );
      if (cached?.data && Array.isArray(cached.data) && cached.data.length > 0) {
        setPathData(prev => (prev === cached.data ? prev : (cached.data as CloudPathData[])));
      }

      if (weatherAbortControllerRef.current) {
        weatherAbortControllerRef.current.abort();
        weatherAbortControllerRef.current = null;
        setIsWeatherLoading(false);
      }
      if (weatherDebounceTimerRef.current) {
        clearTimeout(weatherDebounceTimerRef.current);
        weatherDebounceTimerRef.current = null;
      }

      // 천체 모드 또는 우주/지도 모드에서 날짜만 바뀐 경우 날씨 서버 요청을 건너뜁니다
      if ((isAstroMode || ascended) && isDateChanged && !isLocChanged) {
        skippedAstroDateRef.current = true;
        return;
      }

      skippedAstroDateRef.current = false;
      // 날짜나 위치가 변경된 경우: 250ms 디바운스
      weatherDebounceTimerRef.current = setTimeout(() => {
        weatherDebounceTimerRef.current = null;
        loadWeather(false);
      }, 250);
      return;
    }
  }, [isCacheHydrated, latitude, longitude, currentDateStr, isAstroMode, ascended, loadWeather, pathData.length, weatherCacheList]);

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
  const sceneRef = useRef<SkyScene3DHandle>(null);
  // 해·달 걸기로 시선을 옮겼다면(시야 중심을 올려 둠) 고른 대상을 지울 때 되돌립니다.
  const alignedViewRef = useRef(false);
  /** 해 · 달 걸기로 맞춰 둔 천체(장면 저장이 기억합니다). 고른 대상이 지워지면 함께 지웁니다. */
  const alignedBodyRef = useRef<'sun' | 'moon' | null>(null);
  // 먼 건물(샌드박스): 보는 방향만 받습니다 — 도심 z14 타일은 한 장이 0.2~0.8 MB 라 사방을 받으면 수십 MB 입니다.
  const [farStatus, setFarStatus] = useState<FarStatus | null>(null);
  /** 저장된 위치를 (lat, lon) 으로 바꿉니다(샌드박스 이동의 확정 · 내 위치로 · 저장한 장면 열기). */
  const setSpot = (p: { latitude: number; longitude: number }) => {
    useCelestialStore.getState().setLocation({
      coords: { latitude: p.latitude, longitude: p.longitude, altitude: 0, accuracy: 0, altitudeAccuracy: 0, heading: 0, speed: 0 },
      timestamp: Date.now(),
    });
  };
  // ── 여기로 가기(12.5 6번) · 비행 모드 눈 높이 ───────────────────────────────
  // 고른 점까지 눈을 부드럽게 옮기고(저장된 위치는 그대로) 도착하면 한 번 저장합니다. 조이스틱을 쥐거나 위치가 바깥에서 바뀌면 접습니다.
  const glide = useGlide({
    getOrigin: () => {
      const c = useCelestialStore.getState().location?.coords ?? { latitude, longitude };
      return { latitude: c.latitude, longitude: c.longitude };
    },
    setEye: (p) => sceneRef.current?.setEyeLocation?.(p.latitude, p.longitude),
    clearEye: () => sceneRef.current?.clearEyeLocation?.(),
    commit: setSpot,
  });
  const flyStashRef = useRef<number | null>(null);
  const changeMoveMode = (m: MoveMode) => {
    const r = eyeForMode(moveMode, m, eyeH, flyStashRef.current);
    flyStashRef.current = r.stash;
    if (r.eyeH !== eyeH) setEyeH(r.eyeH);
    setMoveMode(m);
  };
  // ── 장면 저장(docs/SANDBOX_MODE_PLAN.md 12.3) ───────────────────────────────
  // 자리 · 눈 높이 · 보는 방향 · 줌 · 시각 · 고른 대상을 이 기기에만 저장하고(날씨는 저장하지 않고 열 때 새로 받습니다) 저장한 장면 시트에서 엽니다.
  const savedScenes = useCelestialStore(s => s.savedScenes);
  const sampleScenesSeeded = useCelestialStore(s => s.sampleScenesSeeded);
  const seenHints = useCelestialStore(s => s.seenHints);
  const markHintSeen = useCelestialStore(s => s.markHintSeen);
  const restoreSampleScenes = useCelestialStore(s => s.restoreSampleScenes);
  useEffect(() => {
    if (isCacheHydrated && !sampleScenesSeeded && savedScenes.length === 0) {
      restoreSampleScenes();
    }
  }, [isCacheHydrated, sampleScenesSeeded, savedScenes.length, restoreSampleScenes]);
  useEffect(() => {
    if (picked) {
      if (!seenHints?.sandboxPick) markHintSeen('sandboxPick');
      if (!seenHints?.alignBody) setPickedDetailOpen(true);
    }
  }, [picked, seenHints?.sandboxPick, seenHints?.alignBody, markHintSeen]);
  useEffect(() => {
    if (ascended && !seenHints?.spaceZoom) {
      markHintSeen('spaceZoom');
    }
  }, [ascended, seenHints?.spaceZoom, markHintSeen]);
  const [sceneSheetOpen, setSceneSheetOpen] = useState(false);
  const pendingSceneTargetRef = useRef<ReturnType<typeof pendingTargetFromScene>>(null);
  const scenePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopScenePoll = () => { if (scenePollRef.current) { clearInterval(scenePollRef.current); scenePollRef.current = null; } };
  useEffect(() => stopScenePoll, []);
  /** 지금 장면을 읽습니다. 장면이 아직 안 올라와 시선을 못 읽으면 null. 눈이 움직이는 중이면 눈의 자리를 씁니다. */
  const readScene = (name: string): SavedScene | null => {
    const view = sceneRef.current?.getRenderState?.()?.view;
    if (!view) return null;
    const spot = sceneRef.current?.getEyeState?.().eye ?? { latitude, longitude };
    const now = Date.now();
    return makeScene(
      { latitude: spot.latitude, longitude: spot.longitude, eyeHeightM: eyeH, azDeg: view.az, elDeg: view.el, zoomX: teleX, timeMs: currentTime.getTime(), target: targetFromPicked(picked), aligned: alignedBodyRef.current },
      { name, nowMs: now, id: nextSceneId(now), tzHours: tz, lang: language },
    );
  };
  // ── 샌드박스 촬영 미리보기 스튜디오 (사진 노출 · 천체 장노출 · 타임랩스 미리보기 → 카메라 전달) ──
  const [sandboxExposure, setSandboxExposure] = useState<number>(0);
  const [sandboxIso, setSandboxIso] = useState<number | null>(null);
  const [sandboxShutterS, setSandboxShutterS] = useState<number | null>(null);
  const [sandboxWb, setSandboxWb] = useState<PhotoWbPreset | null>(null);
  const [sandboxAstroSettings, setSandboxAstroSettings] = useState<AstroSettingsState>(() => ({ ...createDefaultAstroSettings(), mode: 'trails' }));
  const [sandboxTlPlan, setSandboxTlPlan] = useState<TimelapsePlan | null>(null);
  const [collapseNonce, setCollapseNonce] = useState<number>(0);
  const [sandboxLongExpUri, setSandboxLongExpUri] = useState<string | null>(null);
  const [sandboxLongExpBusy, setSandboxLongExpBusy] = useState<boolean>(false);
  const [sandboxTlPreviewing, setSandboxTlPreviewing] = useState<boolean>(false);
  const [sandboxTlClock, setSandboxTlClock] = useState<string>('0:00 / 0:00');
  const sbPreviewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sbPreviewOriginRef = useRef<Date | null>(null);

  const stopSandboxTlPreview = useCallback(() => {
    if (sbPreviewTimerRef.current) { clearInterval(sbPreviewTimerRef.current); sbPreviewTimerRef.current = null; }
    sceneRef.current?.endLiveAccum?.();
    if (sbPreviewOriginRef.current) { setCurrentTime(sbPreviewOriginRef.current); sbPreviewOriginRef.current = null; }
    setSandboxTlPreviewing(false);
  }, [setCurrentTime]);

  const startSandboxTlPreview = useCallback((plan: TimelapsePlan, startMs: number, endMs: number) => {
    if (sbPreviewTimerRef.current) clearInterval(sbPreviewTimerRef.current);
    if (!sbPreviewOriginRef.current) sbPreviewOriginRef.current = currentTime;
    setSandboxLongExpUri(null);
    const accumMode = plan.kind === 'trail';
    if (accumMode) {
      sceneRef.current?.beginLiveAccum?.({
        lighten: true,
        exposureGain: 1.25,
        shadowLift: 0.012,
        starBoost: 1.45,
      });
    } else {
      sceneRef.current?.endLiveAccum?.();
    }
    setSandboxTlPreviewing(true);
    setSandboxTlClock(videoClock(0, plan.targetVideoSec));
    const t0 = Date.now();
    sbPreviewTimerRef.current = setInterval(() => {
      const elapsed = (Date.now() - t0) / 1000;
      const tMs = previewTimeAt(startMs, endMs, plan.targetVideoSec, elapsed);
      setCurrentTime(new Date(tMs));
      if (accumMode) sceneRef.current?.stepLiveAccum?.(tMs);
      setSandboxTlClock(videoClock(elapsed, plan.targetVideoSec));
      if (elapsed >= plan.targetVideoSec) stopSandboxTlPreview();
    }, accumMode ? 120 : 100);
  }, [currentTime, setCurrentTime, stopSandboxTlPreview]);

  useEffect(() => () => {
    if (sbPreviewTimerRef.current) clearInterval(sbPreviewTimerRef.current);
    sceneRef.current?.endLiveAccum?.();
  }, []);
  useEffect(() => {
    if (!expertMode) {
      setSandboxLongExpUri(null);
      if (sandboxTlPreviewing) stopSandboxTlPreview();
    }
  }, [expertMode, sandboxTlPreviewing, stopSandboxTlPreview]);

  const sandboxAstroSummary = useMemo(() => {
    if (!expertMode) {
      return planAstroShotSummary({
        settings: sandboxAstroSettings,
        caps: SANDBOX_ASTRO_CAPS,
        latitudeDeg: latitude,
        azDeg: 180,
        elDeg: 30,
      });
    }
    const view = sceneRef.current?.getRenderState?.()?.view;
    return planAstroShotSummary({
      settings: sandboxAstroSettings,
      caps: SANDBOX_ASTRO_CAPS,
      latitudeDeg: latitude,
      azDeg: view?.az ?? Math.round(sunAzimuth),
      elDeg: view?.el ?? 30,
    });
  }, [expertMode, sandboxAstroSettings, latitude, sunAzimuth]);

  const longExpReqRef = useRef<number>(0);
  const longExpBusyRef = useRef<boolean>(false);
  const longExpAbortRef = useRef<AbortController | null>(null);
  const runSandboxLongExp = useCallback(async () => {
    const sky = sceneRef.current;
    const st = sky?.getRenderState?.();
    if (!sky || !st) return;
    longExpAbortRef.current?.abort();
    const ctl = new AbortController();
    longExpAbortRef.current = ctl;
    longExpReqRef.current += 1;
    const reqId = longExpReqRef.current;
    longExpBusyRef.current = true;
    setSandboxLongExpBusy(true);
    try {
      const simMode = sandboxAstroSettings.mode === 'tracked'
        ? (sandboxAstroSettings.keepFixedGround ? 'tracked_fixed_ground' : 'tracked')
        : 'trails';
      const sp = computeAstroSimExposureParams(sandboxAstroSettings.durationSec, sandboxAstroSummary.clampedIso);
      const res = await sky.renderLongExposure(
        { az: st.view.az, el: st.view.el, fov: st.view.fov, rollDeg: st.view.roll },
        {
          mode: simMode,
          startTimeMs: currentTimeRef.current.getTime(),
          durationSec: sandboxAstroSettings.durationSec,
          steps: sp.stepsForPreview,
          exposureGain: sp.exposureGain,
          starBoost: sp.starBoost,
          shadowLift: sp.shadowLift,
          settleFrames: 4,
          requireReady: false,
          waitMs: 5000,
          format: 'jpeg',
          compress: 0.85,
          signal: ctl.signal,
        },
      );
      if (reqId === longExpReqRef.current && !ctl.signal.aborted && res.uri) {
        setSandboxLongExpUri(res.uri);
      }
    } finally {
      if (reqId === longExpReqRef.current) {
        longExpBusyRef.current = false;
        setSandboxLongExpBusy(false);
      }
    }
  }, [sandboxAstroSettings, sandboxAstroSummary.clampedIso]);

  const isGestureBlocked = useCelestialStore(s => s.isGestureBlocked);
  const [sandboxViewSig, setSandboxViewSig] = useState<string>('');
  useEffect(() => {
    if (!expertMode || isCameraOverlayActive || sandboxShootMode !== 'astro' || isSliding || isGestureBlocked) return undefined;
    const poll = () => {
      // 합성 중에는 remoteViewRef(적도의 추적)로 시선이 임시 회전하므로 시선 시그니처를 갱신하지 않습니다.
      if (longExpBusyRef.current) return;
      const v = sceneRef.current?.getRenderState?.()?.view;
      if (!v) return;
      const sig = `${Math.round(v.az)}_${Math.round(v.el)}_${Math.round(v.fov)}`;
      setSandboxViewSig(prev => (prev === sig ? prev : sig));
    };
    poll();
    const id = setInterval(poll, 350);
    return () => clearInterval(id);
  }, [expertMode, isCameraOverlayActive, sandboxShootMode, isSliding, isGestureBlocked]);

  // 천체 탭 활성 시 시간·시선·설정 변경 후 450ms 정지하면 자동으로 장노출 합성
  useEffect(() => {
    longExpReqRef.current += 1;
    longExpBusyRef.current = false;
    longExpAbortRef.current?.abort();
    longExpAbortRef.current = null;
    sceneRef.current?.cancelLongExposure?.();

    if (!expertMode || isCameraOverlayActive || sandboxShootMode !== 'astro') {
      setSandboxLongExpUri(null);
      setSandboxLongExpBusy(false);
      return undefined;
    }
    if (isSliding || isGestureBlocked) {
      setSandboxLongExpUri(null);
      setSandboxLongExpBusy(false);
      return undefined;
    }
    setSandboxLongExpUri(null);
    const t = setTimeout(() => {
      runSandboxLongExp();
    }, 450);
    return () => {
      clearTimeout(t);
      longExpAbortRef.current?.abort();
      sceneRef.current?.cancelLongExposure?.();
    };
  }, [expertMode, isCameraOverlayActive, sandboxShootMode, isSliding, isGestureBlocked, sandboxViewSig, runSandboxLongExp]);

  const sandboxExpoAdvice = useMemo(() => adviseExposure(Math.round(sunAltitude)), [sunAltitude]);
  const sandboxLensInfo = useMemo(() => {
    const win = Dimensions.get('window');
    const vFov = Math.max(10, Math.min(85, 65 / Math.max(1, teleX)));
    return lensLine(vFov, win.width / Math.max(1, win.height));
  }, [teleX]);

  const sandboxSunAltAt = useCallback((ms: number) => {
    return sunPosition(new Date(ms), latitude, longitude).altitude * (180 / Math.PI);
  }, [latitude, longitude]);

  /** "이 장면 찍기 / 카메라로 이동": 지금 장면과 샌드박스 촬영 세팅을 그대로 카메라로 넘깁니다. */
  const shootScene = (overridePlan?: TimelapsePlan) => {
    const sc = readScene('');
    if (!sc) return;
    if (sandboxTlPreviewing) stopSandboxTlPreview();
    setSandboxLongExpUri(null);
    const store = useCelestialStore.getState();
    store.setCameraScene(sc);
    store.setCameraHandoff(expertMode ? {
      mode: sandboxShootMode,
      zoomX: teleX,
      exposure: sandboxExposure,
      astroSettings: sandboxAstroSettings,
      timelapsePlan: overridePlan ?? sandboxTlPlan,
    } : null);
    onCameraPress?.();
  };
  const saveScene = (name: string): SaveResult => {
    const sc = readScene(name);
    if (!sc) return 'unavailable';
    const r = useCelestialStore.getState().addSavedScene(sc);
    return r.ok ? 'saved' : r.reason === 'full' ? 'full' : 'unavailable';
  };
  /**
   * 저장한 장면으로 샌드박스를 엽니다: 자리, 눈 높이, 줌, 시각을 맞추고 시선을 돌린 뒤, 고른 대상이 있었으면 새 자리의 지형이 오는 대로(최대 1 분)
   * 같은 대상을 새 눈 기준으로 다시 잡습니다(`targetFromLatLon` + `rebuildPicked`). 날씨는 새 자리와 시각으로 새로 받습니다("내 위치 아님" 표시는 거리로 저절로 켜집니다).
   */
  const openScene = (sc: SavedScene) => {
    setSceneSheetOpen(false);
    stopScenePoll();
    pendingSceneTargetRef.current = null;
    alignedBodyRef.current = null;
    setPicked(null);
    setEyeH(sc.eyeHeightM);
    setTeleX(sc.zoomX);
    setCurrentTime(new Date(sc.timeMs));
    setSpot({ latitude: sc.latitude, longitude: sc.longitude });
    sceneRef.current?.setCameraView?.(sc.azDeg, sc.elDeg);
    const p = pendingTargetFromScene(sc);
    if (!p) return;
    const aligned = sc.aligned;
    pendingSceneTargetRef.current = p;
    let tries = 0;
    scenePollRef.current = setInterval(() => {
      const w = pendingSceneTargetRef.current;
      if (!w) { stopScenePoll(); return; }
      const tp = sceneRef.current?.targetFromLatLon?.(w.latitude, w.longitude, w.elevM);
      if (!tp) {
        if (++tries > 120) { pendingSceneTargetRef.current = null; stopScenePoll(); }   // 1 분이 지나도 지형이 안 오면 대상은 포기합니다
        return;
      }
      pendingSceneTargetRef.current = null;
      stopScenePoll();
      const np = rebuildPicked(w.kind, w.building, tp);
      setPicked(np);
      // 해 · 달에 맞춰 저장한 장면이면 같은 맞춤을 다시 합니다(화각을 좁히고 시야 중심을 올려 대상과 천체가 패널 위에 보이게).
      if (aligned && np) {
        alignedBodyRef.current = aligned;
        alignedViewRef.current = true;
        sceneRef.current?.setCameraView?.(np.azDeg, np.elDeg, 14, { centerOffsetYFrac: ALIGN_VIEW_OFFSET_Y });
      }
    }, 500);
  };
  const loadFarBuildings = async () => {
    // 먼 건물을 보려는 것이니 건물 레이어가 꺼져 있으면 켭니다(기본은 꺼짐).
    setSkyLayers(prev => (prev.buildings ? prev : { ...prev, buildings: true }));
    setFarStatus({ state: 'loading', tilesDone: 0, tilesTotal: 0, bytes: 0 });
    try {
      const r = await sceneRef.current?.loadFarBuildings?.({ onProgress: p => setFarStatus({ state: 'loading', ...p }) });
      setFarStatus(r
        ? { state: 'done', tilesDone: r.fetched, tilesTotal: r.planned, bytes: r.bytes, buildings: r.buildings, truncated: r.truncated, failed: r.failed }
        : { state: 'off', tilesDone: 0, tilesTotal: 0, bytes: 0 });
    } catch {
      setFarStatus({ state: 'error', tilesDone: 0, tilesTotal: 0, bytes: 0 });
    }
  };
  useEffect(() => { setFarStatus(null); }, [latitude, longitude]);   // 자리가 바뀌면 먼 건물은 비워지므로 표시도 지웁니다
  useEffect(() => {
    if (!picked && alignedViewRef.current) {
      alignedViewRef.current = false;
      sceneRef.current?.clearCameraLensOverride?.();
    }
    if (!picked) alignedBodyRef.current = null;
  }, [picked]);
  const [timeline, setTimeline] = useState<SkyTimeline | null>(null);

  // 날짜나 장소가 바뀌면 계산해 둔 하늘은 더 이상 맞지 않습니다.
  const timelineValid = isTimelineUsable(timeline, latitude, longitude, currentTime);
  const lastAstroAnalysisRef = useRef<AstroWindowAnalysis | null>(null);
  const sandboxAstroAnalysis: AstroWindowAnalysis | null = useMemo(() => {
    if (!expertMode) return null;
    const isTlAstro = sandboxShootMode === 'timelapse' && (sandboxTlPlan?.kind ?? 'plain') !== 'plain';
    if (sandboxShootMode !== 'astro' && !isTlAstro) return null;
    if (isSliding) return lastAstroAnalysisRef.current;
    const view = sceneRef.current?.getRenderState?.()?.view;
    const win = Dimensions.get('window');
    const vFov = view?.fov ?? Math.max(10, Math.min(85, 65 / Math.max(1, teleX)));
    const hFov = vFov * (win.width / Math.max(1, win.height));
    const durSec = sandboxShootMode === 'astro'
      ? sandboxAstroSettings.durationSec
      : (sandboxTlPlan?.totalMin ?? 60) * 60;
    const next = analyzeAstroWindow({
      timeline: timelineValid ? timeline : null,
      view: {
        azDeg: view?.az ?? sunAzimuth,
        elDeg: view?.el ?? 30,
        hfovDeg: hFov,
        vfovDeg: vFov,
      },
      startMs: currentTime.getTime(),
      exposureSec: durSec,
      lookaheadMin: Math.max(30, Math.round(durSec / 60)),
    });
    lastAstroAnalysisRef.current = next;
    return next;
  }, [expertMode, isSliding, sandboxShootMode, sandboxTlPlan, sandboxAstroSettings.durationSec, timelineValid, timeline, teleX, sunAzimuth, currentTime]);
  // 촬영하기(카메라)도 같은 하루치 하늘을 쓰도록 스토어에 내놓습니다(저장하지 않는 칸).
  const setSkyTimeline = useCelestialStore(s => s.setSkyTimeline);
  useEffect(() => { setSkyTimeline(timelineValid ? timeline : null); }, [timelineValid, timeline, setSkyTimeline]);
  useEffect(() => {
    if (timeline && !isTimelineUsable(timeline, latitude, longitude, currentTime)) {
      setTimeline(null);
    }
  }, [timeline, latitude, longitude, currentDateStr]);

  // 시간 스크롤(isSliding) 중에는 5분 버킷 단위로만 46개 고리 전체 보간을 갱신해 매 터치 이벤트마다 배열 재생성 및 SkyScene3D weatherRef 변동을 막습니다.
  const weatherEvalMs = isSliding
    ? Math.floor(currentTime.getTime() / 300_000) * 300_000
    : currentTime.getTime();
  const interpolatedWeather = useMemo(
    () => (pathData.length ? getInterpolatedWeather(pathData, new Date(weatherEvalMs)) : []),
    [pathData, weatherEvalMs]
  );

  const lastPredictionRef = useRef<ReturnType<typeof scenePrediction>>(null);
  const prediction = useMemo(() => {
    if (isSliding && lastPredictionRef.current) return lastPredictionRef.current;
    const next = scenePrediction({
      pathData,
      time: currentTime,
      sunAltDeg: sunAltitude,
      sunAzDeg: sunAzimuth,
      obs: interpolatedWeather[0],
      latitude,
      observerElevM: terrainData.observerElevation,
    });
    lastPredictionRef.current = next;
    return next;
  }, [isSliding, pathData, interpolatedWeather, currentTime, sunAltitude, sunAzimuth, latitude, terrainData.observerElevation]);

  // 그 시각의 노을 예측(점수 · 판정). 시간대별 점수 그래프가 씁니다. 하늘 일정 목록은 02 학습으로 옮겨 갔습니다(`LearnScreen`).
  const predictionAt = (tm?: Date | null) => {
    if (!tm || !pathData.length) return null;
    const sp = sunPosition(tm, latitude, longitude);
    const p = scenePrediction({
      pathData,
      time: tm,
      sunAltDeg: sp.altitude * (180 / Math.PI),
      sunAzDeg: sp.azimuth * (180 / Math.PI) + 180,
      obs: getInterpolatedWeather(pathData, tm)[0],
      latitude,
      observerElevM: terrainData.observerElevation,
    });
    return p ? { score: p.score, quality: p.quality } : null;
  };
  // 판정 한 줄(디자인 개정 A2): 다가오는 출몰(밤이고 일출 전이면 일출, 아니면 일몰)의 노을 판정과
  // "가장 붉을 때". 지금 시각의 점수가 아니라 그 출몰 앞뒤에서 점수가 가장 높은 순간입니다(`utils/glowPeak.ts`).
  const isSunriseSide = sunAltitude < 0 && (events?.sunrise ? currentTime < events.sunrise : false);
  const lastGlowRef = useRef<GlowPeak<NonNullable<ReturnType<typeof scenePrediction>>> | null>(null);
  const glow = useMemo(() => {
    if (isSliding && lastGlowRef.current) return lastGlowRef.current;
    const next = findGlowPeak(
      isSunriseSide ? events?.sunrise : events?.sunset,
      isSunriseSide ? 'sunrise' : 'sunset',
      (tm) => {
        if (!pathData.length) return null;
        const sp = sunPosition(tm, latitude, longitude);
        return scenePrediction({
          pathData,
          time: tm,
          sunAltDeg: sp.altitude * (180 / Math.PI),
          sunAzDeg: sp.azimuth * (180 / Math.PI) + 180,
          obs: getInterpolatedWeather(pathData, tm)[0],
          latitude,
          observerElevM: terrainData.observerElevation,
        });
      },
    );
    lastGlowRef.current = next;
    return next;
  }, [isSliding, isSunriseSide, events, pathData, latitude, longitude, terrainData.observerElevation]);

  // 시간대별 점수 그래프(목업 1): 판정 줄이 겨누는 출몰 둘레 9시간을 10분 간격으로, 하늘 화면과 같은 예측(`predictionAt`)으로 훑습니다.
  // 받아 둔 예보 시각 범위 밖의 점은 비웁니다(가장자리 값을 지어 쓰지 않음). 점수가 하나도 없으면 그래프를 그리지 않습니다.
  const graphEvent = isSunriseSide ? events?.sunrise : events?.sunset;
  const scoreGraph = useMemo(() => {
    if (!graphEvent || !Number.isFinite(graphEvent.getTime()) || !pathData.length) return null;
    const win = scoreWindow(graphEvent.getTime(), isSunriseSide ? 'sunrise' : 'sunset', tz);
    const h = pathData[0]?.hourly;
    const times = h?.timeMs ?? h?.time?.map(x => new Date(x).getTime());
    const covered = (ms: number) => !!times?.length && ms >= times[0] && ms <= times[times.length - 1];
    const points = sampleScores(win, 10, (tm) => {
      // 해가 노을이 생길 수 없는 높이·깊이면 예측 없이 0 (utils/scoreSeries.ts `GLOW_ALT_*`). 예측은 한 시각에 보간이 두 번 돕니다.
      if (!canGlow(sunPosition(tm, latitude, longitude).altitude * (180 / Math.PI))) return 0;
      return covered(tm.getTime()) ? predictionAt(tm)?.score ?? null : null;
    });
    return hasAnyScore(points) ? { win, points } : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphEvent?.getTime(), isSunriseSide, pathData, latitude, longitude, tz, terrainData.observerElevation]);

  // "다가오는 좋은 순간" 카드(목업 1): 시트를 **펼칠 때** 16일 예보를 한 번 받아(한 시간 캐시) 내일·모레의 더 좋은 출몰을 고릅니다.
  // 앱을 켤 때는 받지 않습니다. 예보를 못 받았거나 보통 이상이 없으면 카드가 없습니다.
  const [sheetOpen, setSheetOpen] = useState(false);
  const cardsOn = sheetOpen && !expertMode;
  const { days: forecastDays, now: forecastNow } = useForecastDays({ fetch: cardsOn, compute: cardsOn, days: 3, haptic: false });
  const moments = useMemo(() => upcomingMoments(forecastDays, forecastNow.getTime()), [forecastDays, forecastNow]);

  // "오늘 밤 별 보기" 카드의 입력(`utils/starTonight.ts`): 별을 볼 시각(이미 밤이면 그 시각, 아니면 그날 천문 박명 30분 뒤)의
  // 구름·연무 예보와 해·달, 밤 불빛 지도의 한계등급. 그 시각의 예보가 받아 둔 시간 범위 밖이면 "모름"으로 둡니다(가장자리 값을 지어 쓰지 않음).
  const [nightLights, setNightLights] = useState<NightLights | null>(() => getCachedNightLights());
  useEffect(() => {
    if (nightLights) return;
    let alive = true;
    loadNightLights().then(m => { if (alive && m) setNightLights(m); });
    return () => { alive = false; };
  }, [nightLights]);
  const starArgsAt = (date: Date) => {
    const weatherAt = (when: Date): StarWeather | null => {
      const h = pathData[0]?.hourly;
      const times = h?.timeMs ?? h?.time?.map(x => new Date(x).getTime());
      return hourlyCovers(times, when.getTime()) ? starWeatherOf(getInterpolatedWeather(pathData, when)[0]) : null;
    };
    return starArgsFor({
      date,
      lat: latitude,
      lon: longitude,
      elevM: terrainData.observerElevation ?? 0,
      weatherAt,
      lightPollutionMag: nightLights ? estimateLightPollution(nightLights, latitude, longitude).magLimit : null,
    });
  };

  // "오늘 밤 별 보기" 카드(목업 1의 첫 카드, `utils/upcomingMoments.ts` `starMoment`): 오늘 밤 별을 보는 시각의 구름·해·달·빛 지도로 한계등급을 세어
  // 구름이 보통 이하이고 3등급 이상일 때만. 보고 있는 날이 오늘이 아니면 받아 둔 날씨가 그 밤을 덮지 않아 운량을 몰라 카드가 없습니다(지어내지 않음).
  const star = useMemo(() => {
    if (!cardsOn) return null;
    const now = new Date();
    const a = starArgsAt(now);
    return starMoment({ timeMs: a.timeMs, nowMs: now.getTime(), input: a.input, cloudKnown: a.cloudKnown });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardsOn, pathData, nightLights, latitude, longitude, terrainData.observerElevation]);
  const sunsetText = events?.sunset
    ? `${String(events.sunset.getHours()).padStart(2, '0')}:${String(events.sunset.getMinutes()).padStart(2, '0')}`
    : '--:--';

  // 쉬운 말(목업 1): 해가 뜨고 지는 쪽("서쪽 하늘")과 하늘 위 구름 한 줄("낮은 구름 조금 · 높은 구름 많음", `utils/skyWords.ts`).
  // 구름 줄은 예보가 있을 때만 — 받는 중 · 실패 · 맑은 하늘 대체 자료(`usingFallbackSky`) · 받아 둔 시간 밖에서는 숫자를 말로 옮길 근거가 없어 적지 않습니다.
  const dirEvent = isSunriseSide ? events?.sunrise : events?.sunset;
  const glowDirection = useMemo(
    () => (dirEvent && Number.isFinite(dirEvent.getTime()) ? skyDirection(sunPosition(dirEvent, latitude, longitude).azimuth * (180 / Math.PI) + 180, language) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dirEvent?.getTime(), latitude, longitude, language],
  );
  // 02 학습으로 들어가는 길(점수 숫자 · 왜 그런가요 · 별 보기 카드 · 구름 한 줄 …). 그 시각의 날 · 쪽을 학습 페이지의 고른 날로 싣습니다.
  const learnAt = (date: Date, side: EventSide, section: LearnSection, topic?: LearnTopic, at?: number) =>
    onOpenLearn?.({ section, topic, at, focus: { noonMs: localNoons(date, tz, 1)[0], side } });
  const weatherCoversNow = (() => {
    const h = pathData[0]?.hourly;
    const times = h?.timeMs ?? h?.time?.map(x => new Date(x).getTime());
    return !!times?.length && currentTime.getTime() >= times[0] && currentTime.getTime() <= times[times.length - 1];
  })();
  const cloudCaption = !expertMode && !weatherError && !isWeatherLoading && !usingFallbackSky && weatherCoversNow
    ? cloudSummary(interpolatedWeather[0], language)
    : null;

  // 시트 안 내용(점수 · 그래프 · 알림 · 다가오는 좋은 순간 · 수치): 지금 시트와 새 틀의 끝까지 펼친 시뮬레이션이 같은 것을 씁니다.
  const sheetContent = (
    <>
          {(glow?.prediction ?? prediction) && (
            <PredictionCard
              prediction={(glow?.prediction ?? prediction)!}
              theme={OVERLAY_THEME}
              forceDark
              isSunrise={isSunriseSide}
              peakTime={glow?.time}
              directionText={glowDirection}
              onWhy={() => learnAt(glow?.time ?? currentTime, isSunriseSide ? 'sunrise' : 'sunset', 'why', 'score')}
            />
          )}

          {/* 시간대별 점수 그래프 — 누르면 그 시각으로(초보자 화면) */}
          {!expertMode && scoreGraph && (
            <ScoreGraph
              points={scoreGraph.points}
              window={scoreGraph.win}
              nowMs={currentTime.getTime()}
              tzHours={tz}
              language={language}
              forceDark
              onPickTime={(ms) => setCurrentTime(new Date(ms))}
            />
          )}

          {/* 좋은 하늘 알림 — 02 학습의 "좋음 이상 알림"과 같은 설정 */}
          <View style={[styles.alertRow, { borderColor: DARK.border }]}>
            <Text style={[styles.alertLabel, { color: DARK.text }]} numberOfLines={1}>
              {L3(language, '좋은 하늘이면 알려 주기', 'Alert me on good skies', '良い空なら通知')}
            </Text>
            <Switch
              value={goodOnly}
              onValueChange={toggleGoodOnly}
              trackColor={{ false: DARK.border, true: DARK.accentLine }}
              thumbColor={goodOnly ? DARK.accent : DARK.textMute}
              accessibilityLabel={L3(language, '좋은 하늘이면 알려 주기', 'Alert me on good skies', '良い空なら通知')}
            />
          </View>

          {/* 다가오는 좋은 순간 — 초보자 화면. 이벤트 목록과 기상 정보는 02 학습으로 모였습니다(docs/SANDBOX_MODE_PLAN.md 13 장). */}
          <View style={styles.eventSection}>
            {!expertMode && (
              <Text style={[styles.upcomingLabel, { color: DARK.textDim }]}>
                {L3(language, '다가오는 좋은 순간', 'Coming up', 'これからの見どころ')}
              </Text>
            )}
            {!expertMode && (moments.length > 0 || star) && (
              <UpcomingCards
                moments={moments}
                star={star}
                language={language}
                tzHours={tz}
                forceDark
                onPress={(m) => {
                  if (onOpenLearn) onOpenLearn({ section: 'today', focus: { noonMs: m.noonMs, side: m.side } });
                  else setCurrentTime(new Date(m.timeMs));
                }}
                onStarPress={() => {
                  if (!star) return;
                  learnAt(new Date(star.timeMs), 'sunset', 'why', 'stars', star.timeMs);
                }}
              />
            )}
            {onOpenLearn && (
              <PressScale
                style={[styles.learnLink, { borderColor: DARK.border, backgroundColor: DARK.fill }]}
                onPress={() => learnAt(currentTime, isSunriseSide ? 'sunrise' : 'sunset', 'today')}
                accessibilityRole="button"
                accessibilityLabel={L3(language, '02 학습에서 하늘 일정, 근거, 과정 보기', 'See the schedule, data and steps in 02 Learn', '02 学習で予定・根拠・過程を見る')}
              >
                <ListChecks size={14} color={DARK.textDim} />
                <Text style={[styles.learnLinkText, { color: DARK.text }]}>
                  {L3(language, '학습에서 일정 · 근거 · 과정 보기', 'Schedule, data and steps in Learn', '学習で予定・根拠・過程を見る')}
                </Text>
              </PressScale>
            )}
          </View>

          {/* 태양·달 수치 — 맨 아래: 예측(판단) → 이벤트(언제) → 수치(근거) 순으로 읽습니다. 전문가 모드만. */}
          {expertMode && (
          <View style={[styles.numberFrame, { backgroundColor: DARK.fill, borderColor: DARK.border }]}>
            <View style={styles.frameHeader}>
              <Sun size={11} color={DARK.sun} />
              <Text style={[styles.frameLabel, { color: DARK.textDim }]}>{t('sunMoon', language)}</Text>
            </View>
            <View style={styles.numberGrid}>
              <InfoCard
                icon={<Sun size={14} color={DARK.sun} />}
                label={t('sunLabel', language)}
                value={`${sunAltitude.toFixed(0)}°`}
                subValue={`${sunAzimuth.toFixed(0)}°`}
                theme={OVERLAY_THEME}
              />
              <InfoCard
                icon={<Moon size={14} color={DARK.moon} />}
                label={t('moonLabel', language)}
                value={`${moonAltitude.toFixed(0)}°`}
                subValue={`${moonAzimuth.toFixed(0)}°`}
                theme={OVERLAY_THEME}
              />
              <InfoCard
                icon={<Sunset size={14} color={DARK.glow} />}
                label={t('sunset', language)}
                value={sunsetText}
                theme={OVERLAY_THEME}
              />
            </View>
          </View>
          )}
    </>
  );

  const shutterMoveDriver = useJoystickDriver({
    mode: moveMode,
    ref: 'view',
    getOrigin: () => {
      const c = useCelestialStore.getState().location?.coords ?? { latitude, longitude };
      return { latitude: c.latitude, longitude: c.longitude };
    },
    getHeading: () => sceneRef.current?.getRenderState?.()?.view?.az ?? null,
    setEye: (p) => sceneRef.current?.setEyeLocation?.(p.latitude, p.longitude),
    clearEye: () => sceneRef.current?.clearEyeLocation?.(),
    commit: setSpot,
    onGrab: glide.finish,
  });

  const setSkyHeaderActions = useCelestialStore(s => s.setSkyHeaderActions);
  const headerTrackingLabel = trackingTarget
    ? t(trackingTarget === 'sun' ? 'trackSun' : trackingTarget === 'moon' ? 'trackMoon' : trackingTarget === 'milkyway' ? 'trackMilky' : 'trackBody', language)
    : null;
  const headerPickedLabel = !isCameraOverlayActive && expertMode && !ascended && picked
    ? (picked.kind === 'building' && picked.building
      ? `${L3(language, '건물', 'Bldg', '建物')} ${Math.round(picked.building.heightM)}m · ${picked.distM >= 1000 ? `${(picked.distM / 1000).toFixed(1)}km` : `${Math.round(picked.distM)}m`}`
      : `${L3(language, '지형', 'Terrain', '地形')} · ${picked.distM >= 1000 ? `${(picked.distM / 1000).toFixed(1)}km` : `${Math.round(picked.distM)}m`}`)
    : null;
  useEffect(() => {
    setSkyHeaderActions({
      flyToMap: () => sceneRef.current?.flyToMap(),
      openLayers: () => setLayerModalVisible(true),
      openDev: () => setDevPanelOpen(v => !v),
      ascended,
      trackingLabel: headerTrackingLabel,
      onClearTracking: () => setTrackingTarget(null),
      pickedLabel: headerPickedLabel,
      pickedDetailOpen,
      onTogglePickedDetail: () => setPickedDetailOpen(v => !v),
      onClearPicked: () => { pendingSceneTargetRef.current = null; setPicked(null); },
    });
    return () => setSkyHeaderActions(null);
  }, [setSkyHeaderActions, ascended, headerTrackingLabel, headerPickedLabel, pickedDetailOpen]);

  const [dockInset, setDockInset] = useState(210);
  // ── 새 화면 틀(SkyFrame) 연결 ────────────────────────────────────────────────
  const frameGetView = useCallback(() => {
    const v = sceneRef.current?.getRenderState?.()?.view;
    return v ? { azDeg: v.az, elDeg: v.el } : null;
  }, []);
  const frameSandbox = {
    shoot: (
      <SandboxShootPanel
        language={language}
        mode={sandboxShootMode}
        onModeChange={(m) => {
          setSandboxShootMode(m);
          setSandboxLongExpUri(null);
          if (sandboxTlPreviewing) stopSandboxTlPreview();
        }}
        exposure={sandboxExposure}
        onExposureChange={setSandboxExposure}
        teleX={teleX}
        onChangeTeleX={setTeleX}
        manualIso={sandboxIso}
        manualShutterS={sandboxShutterS}
        manualWb={sandboxWb}
        onChangeIso={setSandboxIso}
        onChangeShutter={setSandboxShutterS}
        onChangeWb={setSandboxWb}
        expoAdvice={sandboxExpoAdvice}
        lensMm={sandboxLensInfo.mmText}
        lensText={sandboxLensInfo.lensText}
        astroSettings={sandboxAstroSettings}
        onAstroSettingsChange={setSandboxAstroSettings}
        astroSummary={sandboxAstroSummary}
        astroCaps={SANDBOX_ASTRO_CAPS}
        astroAnalysis={sandboxAstroAnalysis}
        events={{
          sunrise: events?.sunrise ? events.sunrise.getTime() : null,
          sunset: events?.sunset ? events.sunset.getTime() : null,
        }}
        nowMs={currentTime.getTime()}
        tzHours={tz}
        sunAltAt={sandboxSunAltAt}
        timelapsePlan={sandboxTlPlan}
        onTimelapsePlanChange={setSandboxTlPlan}
      />
    ),
  };

  return (
    <View style={styles.container}>
      {/* ── 3D 돔: 화면을 꽉 채웁니다 ───────────────────────────────────── */}
      {/* 무대 — 씬은 아래에서 PEEK_HEIGHT 만큼 비켜 고정, 시트는 그 위로 떠서 올라옵니다(찌그러짐 없음). */}
      <View style={styles.stage}>
      <View style={styles.sceneWrapper}>
        <SkyScene3D
          ref={sceneRef}
          onAscendedChange={setAscended}
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
          telephotoX={expertMode ? teleX : 1}
          onChangeTelephoto={setTeleX}
          showLensInfo={expertMode}
          eyeHeightM={expertMode ? eyeH : undefined}
          pickEnabled={expertMode && !isCameraOverlayActive}
          onPickTarget={(t) => { pendingSceneTargetRef.current = null; setPicked(t); }}
          pickedTarget={picked}
          trackingTarget={trackingTarget}
          onSelectTrackingTarget={setTrackingTarget}
          fullScreen={true}
          timeline={timelineValid ? timeline : null}
          isActive={isActive}
          isSliding={isSliding}
          disableGestures={isCameraOverlayActive}
          hideHudOverlay={isCameraOverlayActive}
          hideCompassBar
          topInset={HEADER_HEIGHT}
          registerPrimary
        />

        {/* 샌드박스 사진 노출(EV) · 수동 ISO/셔터/WB 미리보기 틴트 */}
        {expertMode && !isCameraOverlayActive && sandboxShootMode === 'photo' && (() => {
          const evDelta = computeManualEvOffset(sandboxExpoAdvice, sandboxIso, sandboxShutterS);
          const effExp = Math.max(-1, Math.min(1, sandboxExposure + evDelta * 0.18));
          const wbTint = wbTintColor(sandboxWb);
          return (
            <>
              {effExp !== 0 && (
                <View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      backgroundColor: effExp < 0
                        ? `rgba(0, 0, 0, ${Math.abs(effExp) * 0.45})`
                        : `rgba(255, 255, 255, ${effExp * 0.28})`,
                    },
                  ]}
                />
              )}
              {wbTint && (
                <View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, { backgroundColor: wbTint }]}
                />
              )}
            </>
          );
        })()}

        {/* 샌드박스 우측 상단 수동 설정 배지 (기본값이면 숨김, 위아래 슬라이드로 EV 조절) */}
        {expertMode && !isCameraOverlayActive && sandboxShootMode === 'photo' && (
          <CornerExposureBadge
            language={language}
            exposure={sandboxExposure}
            onExposureChange={setSandboxExposure}
            manualIso={sandboxIso}
            manualShutterS={sandboxShutterS}
            manualWb={sandboxWb}
            top={HEADER_HEIGHT + 8}
            right={12}
          />
        )}

        {/* 샌드박스 천체 장노출 3D 미리보기 */}
        {expertMode && !isCameraOverlayActive && sandboxLongExpUri && (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Image
              source={{ uri: sandboxLongExpUri }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              fadeDuration={120}
            />
          </View>
        )}

        {/* 샌드박스 천체 자동 합성 상태 & 타임랩스 메인화면 재생 컨트롤 */}
        {expertMode && !isCameraOverlayActive && (sandboxLongExpBusy || sandboxLongExpUri || sandboxShootMode === 'timelapse') && (
          <View style={overlayStyles.previewBannerWrap} pointerEvents="box-none">
            <GlassSurface style={overlayStyles.previewBanner}>
              {sandboxLongExpBusy ? (
                <>
                  <ActivityIndicator size="small" color={DARK.moon} />
                  <Text style={overlayStyles.previewBannerText}>
                    {L3(language, '장노출 합성 중…', 'Synthesizing long-exposure…', '長露光合成中…')}
                  </Text>
                </>
              ) : sandboxLongExpUri ? (
                <>
                  <Text style={overlayStyles.previewBannerText}>
                    {L3(language, '장노출 합성 결과', 'Long-exposure preview', '長露光プレビュー')}
                  </Text>
                  <GlassChip
                    label={L3(language, '해제', 'Clear', '解除')}
                    onPress={() => setSandboxLongExpUri(null)}
                  />
                </>
              ) : sandboxTlPreviewing ? (
                <>
                  <Text style={overlayStyles.previewBannerText}>
                    {`${L3(language, '타임랩스 재생 중', 'Playing timelapse', 'タイムラプス再生中')} · ${sandboxTlClock}`}
                  </Text>
                  <GlassChip
                    label={L3(language, '멈추기', 'Stop', '停止')}
                    icon={<Square size={11} color="#F1F5F9" fill="#F1F5F9" />}
                    onPress={stopSandboxTlPreview}
                  />
                </>
              ) : (
                <GlassChip
                  testID="sb-tl-play"
                  label={L3(language, '재생하기', 'Play', '再生する')}
                  icon={<Play size={12} color="#F1F5F9" fill="#F1F5F9" />}
                  active
                  onPress={() => {
                    const plan = sandboxTlPlan ?? planTimelapse({ totalMin: 60, videoSec: 10, fps: 30, kind: 'plain', stackSize: 1 });
                    const startMs = currentTime.getTime();
                    const endMs = startMs + plan.totalMin * 60000;
                    setCollapseNonce(n => n + 1);
                    startSandboxTlPreview(plan, startMs, endMs);
                  }}
                />
              )}
            </GlassSurface>
          </View>
        )}

        {/* 고른 대상 상세 정보 (전문가 모드, 헤더 배지를 탭해 펼침) */}
        {!isCameraOverlayActive && expertMode && !ascended && picked && pickedDetailOpen && (
          <View style={overlayStyles.objectPanelTop} pointerEvents="box-none">
            <ObjectInfoPanel
              language={language}
              target={picked}
              sun={{ azDeg: sunAzimuth, altDeg: sunAltitude }}
              moon={{ azDeg: moonAzimuth, altDeg: moonAltitude }}
              moonDiskDeg={2 * moonSemidiameterDeg(moonPos.distance)}
              onCalc={() => learnAt(currentTime, isSunriseSide ? 'sunrise' : 'sunset', 'why', 'score')}
              observer={{ latitude, longitude, fromMs: currentTime.getTime() }}
              getSkyline={() => sceneRef.current?.getSkyline?.() ?? null}
              onAlign={(hit) => {
                // 그 시각으로 가서 시선을 대상에 맞춥니다. 화각은 원반이 보일 만큼 좁히고, 시야 중심은 위로 올려
                // (패널이 아래쪽을 덮으므로) 대상과 그 곁의 해·달이 패널 위에 보이게 합니다.
                setCurrentTime(new Date(hit.timeMs));
                alignedViewRef.current = true;
                alignedBodyRef.current = hit.body;
                sceneRef.current?.setCameraView?.(picked.azDeg, picked.elDeg, 14, { centerOffsetYFrac: ALIGN_VIEW_OFFSET_Y });
              }}
              onSnap={(top) => setPicked(p => (p ? snapBuildingTarget(p, top) : p))}
              onGo={() => {
                const pt = targetPointOf(picked);
                if (pt) glide.start({ latitude: pt.latitude, longitude: pt.longitude });
              }}
              onClear={() => { pendingSceneTargetRef.current = null; setPicked(null); }}
            />
          </View>
        )}

        <SceneSheet
          visible={sceneSheetOpen}
          language={language}
          scenes={savedScenes}
          draft={sceneSheetOpen ? readScene('') : null}
          nowMs={Date.now()}
          tzHours={tz}
          onSave={saveScene}
          onOpen={openScene}
          onRename={(id, n) => useCelestialStore.getState().renameSavedScene(id, n)}
          onRemove={(id) => useCelestialStore.getState().removeSavedScene(id)}
          onRestoreSamples={restoreSampleScenes}
          onClose={() => setSceneSheetOpen(false)}
        />

        {/* 맥락 기반 1회성 핵심 기능 발견 힌트 배너 (샌드박스 건물 피킹 · 해/달 걸기 · 우주 모드) */}
        {!isCameraOverlayActive && !ascended && !picked && !weatherError && !isWeatherLoading && (
          expertMode && !seenHints?.sandboxPick ? (
            <View style={overlayStyles.previewBannerWrap} pointerEvents="box-none">
              <GlassSurface style={overlayStyles.previewBanner}>
                <Text style={[overlayStyles.previewBannerText, { flexShrink: 1 }]} numberOfLines={2}>
                  {L3(language, '건물·능선을 탭해 해·달을 걸거나 두 손가락 축소로 우주까지 나가 보세요', 'Tap a building/ridge to align Sun/Moon, or pinch out to space', '建物・稜線をタップして太陽・月を重ねるか、ピンチアウトで宇宙へ')}
                </Text>
                <GlassChip
                  label={L3(language, '추천 장면', 'Samples', 'サンプル')}
                  active
                  onPress={() => {
                    markHintSeen('sandboxPick');
                    setSceneSheetOpen(true);
                  }}
                />
                <GlassChip
                  label="✕"
                  onPress={() => markHintSeen('sandboxPick')}
                />
              </GlassSurface>
            </View>
          ) : !expertMode && !seenHints?.spaceZoom ? (
            <View style={overlayStyles.previewBannerWrap} pointerEvents="box-none">
              <GlassSurface style={overlayStyles.previewBanner}>
                <Text style={[overlayStyles.previewBannerText, { flexShrink: 1 }]} numberOfLines={2}>
                  {L3(language, '두 손가락으로 화면을 축소하거나 지구본을 누르면 우주·지도로 나갑니다', 'Pinch out or tap the globe to zoom out to space & map', '2本指で縮小するか地球アイコンを押すと宇宙・地図へ出ます')}
                </Text>
                <GlassChip
                  label={L3(language, '우주로', 'To space', '宇宙へ')}
                  active
                  onPress={() => {
                    markHintSeen('spaceZoom');
                    sceneRef.current?.flyToMap();
                  }}
                />
                <GlassChip
                  label="✕"
                  onPress={() => markHintSeen('spaceZoom')}
                />
              </GlassSurface>
            </View>
          ) : null
        )}

        {/* 개발자 튜닝 패널이 켜졌을 때만 닫기 버튼 표시 (지도·레이어 버튼은 AppHeader 상단 줄로 통합) */}
        {!isCameraOverlayActive && isDevPanelOpen && (
        <View style={overlayStyles.sceneOverlayButtons}>
          <OverlayButton active onPress={() => setDevPanelOpen(false)}>
            <SlidersVertical size={14} color={DARK.accent} />
          </OverlayButton>
        </View>
        )}

        {/* 2026-11-18 예보 대신 맑은 하늘 대체 자료(요청 한도 429 등)를 쓰는 중 — 예전에는 아무 표시 없이 구름 0 % 로 그려
              실제로 구름이 많은 날도 맑게 보였음(사용자 보고, 서울 11/19 일출). 알리고 뒤에서 다시 받습니다. */}
        {!weatherError && !isWeatherLoading && usingFallbackSky && (
          <View style={[overlayStyles.buildBanner, overlayStyles.bannerTop]} pointerEvents="none">
            <Text style={overlayStyles.buildLabel} numberOfLines={1}>
              {L3(language, '구름 예보를 받지 못해 맑은 하늘로 보여 주는 중', 'No cloud forecast yet — showing a clear sky', '雲予報を取得できず晴天で表示中')}
            </Text>
            <Text style={overlayStyles.buildHint} numberOfLines={1}>
              {L3(language, '예보 서버 요청 한도에 걸렸어요. 잠시 뒤 자동으로 다시 받아요', 'Forecast server rate limit — retrying automatically', '予報サーバーの制限中です。自動で再取得します')}
            </Text>
          </View>
        )}

        {/* 날씨 수신 배너 (터치 통과). 2026-11-18 하늘 사전 계산 진행은 팝업 대신 시간 막대 아래 선으로 보입니다(DateTimeBar). */}
        {!weatherError && isWeatherLoading && (() => {
          const pct = isWeatherLoading
            ? 15
            : Math.min(100, Math.max(5, Math.round(((volPrewarm?.done ?? 0) / Math.max(1, volPrewarm?.total ?? 24)) * 100)));
          const label = isWeatherLoading
            ? L3(language, '기상 데이터 수신 중…', 'Fetching weather data…', '気象データを受信中…')
            : L3(
                language,
                `오늘의 하늘 준비 중 · ${volPrewarm?.done ?? 0}/${volPrewarm?.total ?? 24} (${pct}%)`,
                `Preparing day sky · ${volPrewarm?.done ?? 0}/${volPrewarm?.total ?? 24} (${pct}%)`,
                `1日の空を準備中 · ${volPrewarm?.done ?? 0}/${volPrewarm?.total ?? 24} (${pct}%)`,
              );
          const hint = isWeatherLoading
            ? L3(
                language,
                '선택한 날짜·장소의 360° 구름 예보를 불러오고 있습니다',
                'Loading 360° cloud forecast for selected date & place',
                '選択した日時・場所の360°雲予報を読み込んでいます',
              )
            : L3(
                language,
                '백그라운드에서 시간대별 하늘을 미리 계산하고 있습니다',
                'Precomputing hourly sky in the background',
                'バックグラウンドで時間帯別の空を計算しています',
              );
          return (
            <View style={[overlayStyles.buildBanner, overlayStyles.bannerTop]} pointerEvents="none">
              <Text style={overlayStyles.buildLabel} numberOfLines={1}>{label}</Text>
              <View style={overlayStyles.progressTrack}>
                <View style={[overlayStyles.progressFill, { width: `${pct}%` }]} />
              </View>
              <Text style={overlayStyles.buildHint} numberOfLines={1}>{hint}</Text>
            </View>
          );
        })()}

        {/* 날씨 수신 실패 배너 및 재시도 버튼 */}
        {weatherError && (
          <Reveal style={[overlayStyles.weatherErrorBanner, overlayStyles.bannerTop]}>
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

        {/* 샌드박스 상시 오버레이: stage 안에 두어 SkyFrame 설정 시트/배경막 아래에 놓이도록 배치 */}
        {!isCameraOverlayActive && expertMode && !ascended && (
          <>
            <View style={[overlayStyles.floatingJoystick, { bottom: dockInset + 12 }]}>
              <MoveStick
                language={language}
                size={88}
                relative
                onStick={shutterMoveDriver.onStick}
                onNudge={shutterMoveDriver.nudge}
              />
            </View>
            <View style={[overlayStyles.floatingDials, { bottom: dockInset + 12 }]}>
              <DialPair language={language} eyeHeightM={eyeH} onEyeHeight={setEyeH} zoomX={teleX} onZoom={setTeleX} />
            </View>
          </>
        )}
      </View>

      {/* ── 새 화면 틀(실험): 시간 자 · 칩 · 셔터 · 모드 줄이 한 막대에 ─────────── */}
      {!isCameraOverlayActive && (
        <SkyFrame
          language={language}
          tz={tz}
          nowMs={Date.now()}
          timeMs={currentTime.getTime()}
          onSlideStart={handleBarSlidingStart}
          onPick={(ms, kind) => handleBarPick(new Date(ms), { scrub: kind })}
          onSlideEnd={handleBarSlidingComplete}
          showNow={
            isTimeMachineEnabled
            || Math.abs(currentTime.getTime() - Date.now()) > 60_000
            || (homeCoords != null && distanceM(homeCoords, { latitude, longitude }) > 20)
          }
          onNow={() => {
            setTimeMachineEnabled?.(false);
            if (homeCoords && distanceM(homeCoords, { latitude, longitude }) > 20) {
              glide.cancel();
              sceneRef.current?.setEyeLocation?.(homeCoords.latitude, homeCoords.longitude);
              setSpot(homeCoords);
            }
          }}
          sunsetMs={events?.sunset ? events.sunset.getTime() : null}
          sunsetLabel={`${L3(language, '일몰', 'Sunset', '日没')} ${sunsetText}`}
          scoreSamples={scoreGraph ? scoreGraph.points : null}
          mode={expertMode ? 'sandbox' : 'simulation'}
          onSwitch={(sw) => {
            if (sw.mode === 'data') { onOpenData?.(); return; }
            if (sw.mode === 'simulation' || sw.mode === 'sandbox') { setExpertMode(sw.mode === 'sandbox'); return; }
            // 모드 줄로 카메라에 들어가면 방향 · 세팅을 고정하지 않습니다(촬영 버튼을 누를 때만 고정).
            useCelestialStore.getState().setCameraScene(null);
            useCelestialStore.getState().setCameraHandoff(null);
            onCameraPress?.();
          }}
          getView={frameGetView}
          readout={<LiveReadout language={language} getView={() => { const v = sceneRef.current?.getRenderState?.()?.view; return v ? { az: v.az, el: v.el, fov: v.fov } : null; }} eyeHeightM={expertMode ? eyeH : undefined} />}
          simBody={sheetOpen ? (
            <>
              {cloudCaption ? (
                <View style={{ alignItems: 'flex-start' }}>
                  <GlassChip label={cloudCaption} onPress={() => learnAt(currentTime, isSunriseSide ? 'sunrise' : 'sunset', 'why', 'cloud')} accessibilityLabel={`${cloudCaption} — ${L3(language, '구름 모양 계산 과정 보기', 'See how the cloud shapes are decided', '雲の形の計算過程を見る')}`} />
                </View>
              ) : null}
              {sheetContent}
            </>
          ) : null}
          sandbox={frameSandbox}
          collapseNonce={collapseNonce}
          onDockHeight={setDockInset}
          onShoot={() => { if (readScene('')) shootScene(); else onCameraPress?.(); }}
          onSaveScene={() => setSceneSheetOpen(true)}
          onOpenLatestScene={savedScenes.length > 0 ? () => openScene(savedScenes[0]) : undefined}
          onOpenCalendar={onOpenDatePicker}
          onSimBodyOpenChange={setSheetOpen}
        />
      )}
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
        far={expertMode ? { status: farStatus, onLoad: loadFarBuildings } : undefined}
        theme={theme}
      />
    </View>
  );
};

/** 하늘 위의 떠 있는 것 — 화면 모드와 상관없이 어둡습니다(모듈의 어두운 `color`). */
const overlayStyles = StyleSheet.create({
  sceneOverlayButtons: {
    position: 'absolute',
    top: belowHeader(12),
    right: 12,
    gap: 8,
    zIndex: 20,
    alignItems: 'flex-end',
  },
  sandboxPanel: { position: 'absolute', left: 12, top: belowHeader(108), zIndex: 20 },
  objectPanel: { position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 22 },
  // 새 화면 틀: 아래는 유리 막대가 쓰므로 고른 대상 정보는 위(읽음 줄 아래)에 둡니다.
  objectPanelTop: { position: 'absolute', left: 12, right: 12, top: belowHeader(42), zIndex: 22 },
  // 고른 대상이 없을 때의 장면 저장 줄: 도구 열었을 때 하단 툴독 위에 배치
  sceneBar: { position: 'absolute', left: 12, right: 12, bottom: 72, zIndex: 22 },
  sandboxDock: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingTop: 8, paddingBottom: Platform.OS === 'android' ? 20 : 8,
    backgroundColor: DARK.panel, borderTopWidth: 1, borderColor: DARK.border,
  },
  sandboxDockBtn: { width: 'auto', flex: 1, height: 38, paddingHorizontal: 6, gap: 4 },
  sandboxDockText: { fontFamily: mono, fontSize: 11, fontWeight: '700', color: DARK.text },
  expertBtn: { width: 'auto', minWidth: 32, paddingHorizontal: 10 },
  expertBtnText: { fontFamily: mono, fontSize: 11, fontWeight: '700', color: DARK.text },
  overlayButton: {
    width: 32,
    height: 32,
    borderRadius: radius.xs,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // 새 화면 틀: 아래는 유리 막대가 쓰므로 알림 줄은 위(읽음 줄 아래)로 올립니다.
  bannerTop: { bottom: undefined, top: belowHeader(56) },
  previewBannerWrap: { position: 'absolute', left: 16, right: 16, top: belowHeader(38), alignItems: 'center', zIndex: 28 },
  floatingJoystick: { position: 'absolute', left: 14, zIndex: 15 },
  floatingDials: { position: 'absolute', right: 10, zIndex: 15 },
  previewBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  previewBannerText: { fontSize: 11, fontWeight: '600', color: '#F1F5F9' },
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
    top: belowHeader(12),
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
    bottom: 0,
    overflow: 'hidden',
  },

  // ── peek 시트 요약 한 줄 ──────────────────────────────────────────────
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryVerdict: {
    fontSize: 16,
    fontWeight: '800',
  },
  summaryScore: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
    fontFamily: mono,
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: '500',
    flexShrink: 1,
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
  upcomingLabel: { ...type.micro, marginBottom: 2 },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    borderBottomWidth: 1,
    marginBottom: 4,
  },
  alertLabel: { ...type.body, flex: 1, minWidth: 0 },
  // 02 학습으로 가는 줄(시트의 이벤트 목록 · 기상 정보 탭은 학습 페이지로 모였습니다).
  learnLink: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
    borderRadius: radius.xs,
    borderWidth: 1,
  },
  learnLinkText: { ...type.body, flex: 1, minWidth: 0 },

  bottomPanel: {
    paddingTop: 3,
    paddingBottom: Platform.OS === 'android' ? 20 : 6,
    borderTopWidth: 1,
    borderColor: color.border,
  },
}));
