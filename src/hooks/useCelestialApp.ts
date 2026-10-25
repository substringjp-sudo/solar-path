import { useThemeColors, useScheme } from '../theme/useTheme';
import { useEffect, useState, useRef, useMemo } from 'react';
import { Dimensions, Animated, Platform, Alert, AppState, InteractionManager } from 'react-native';
import * as Location from 'expo-location';
import { useCelestialStore } from '../store/useCelestialStore';
import { getSunPosition, getCelestialEvents } from '../utils/celestial';
import { localDayKey, clampMs } from '../utils/timeBar';
import { getGoldenTimeInfo } from '../utils/sunCamera';
import { TAB_ORDER, type AppTab } from '../components/AppHeader';
import { getLocalTimeAtLocation, getSystemTimeFromLocationTime } from '../utils/timezone';
import { auth } from '../config/firebase';
import { signInAnonymously } from 'firebase/auth';
import * as Notifications from 'expo-notifications';
import { predictSunset } from '../utils/sunsetPhysics';
import { fetchDayWeatherRing, getInterpolatedWeather, fetchTerrainProfile, type CloudPathData } from '../utils/weather';
import { localDateString } from '../utils/localDate';
import { sameBucket } from '../utils/cachePolicy';
import { setAppIcon, getAppIcon } from 'expo-dynamic-app-icon';
import { t, Language } from '../utils/i18n';
import { airQualityNote } from '../utils/airQuality';

const L3 = (lang: Language, ko: string, en: string, ja: string) => (lang === 'ko' ? ko : lang === 'ja' ? ja : en);
import { generateSimulationImage, saveSimulationImageToCache, compressToWidgetSizes } from '../utils/simulationImage';
import { updateSunsetWidgetData } from '../utils/widgetStorage';
import { springTo, timeTo } from '../theme/motion';
import { DEFAULT_NOTIF_PREFS, SKY_NOTIF_KINDS, planSkyNotifications } from '../utils/notificationPlan';
import { cancelScheduledByPrefix, hasNotificationPermission, scheduleSkyPlan } from '../utils/notificationScheduler';
import { followClock } from '../utils/liveClock';



Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Android 전용 High-Priority 알림 채널 생성 (OS 절전 모드 우회 및 헤드업 팝업 보장)
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('beforeglow-sunset-channel', {
    name: 'Sunset & Sunrise Alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF4500',
    sound: 'default',
    enableVibrate: true,
    enableLights: true,
  });
}

const requestNotificationPermission = async () => {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  return finalStatus === 'granted';
};

/**
 * 저장된 캐시가 있으면 네트워크를 아예 타지 않고 캐시를 돌려줍니다.
 * 없을 때만 단 1회 네트워크로 날씨를 요청합니다.
 */
const getOrFetchWeatherData = async (
  lat: number,
  lon: number,
  targetTime: Date,
  azimuth?: number,
  cacheOnly: boolean = false
): Promise<CloudPathData[] | null> => {
  try {
    const dateStr = localDateString(targetTime);
    const cached = useCelestialStore.getState().weatherCacheList.find(c =>
      c.key.includes(dateStr) && sameBucket(c.latitude, c.longitude, lat, lon)
    );
    if (cached?.data && Array.isArray(cached.data) && cached.data.length > 0) {
      if (__DEV__) console.log(`[useCelestialApp] Weather cache hit for ${dateStr} — network skipped`);
      return cached.data as CloudPathData[];
    }
    if (cacheOnly || !useCelestialStore.getState().isCacheHydrated) return null;
    return await fetchDayWeatherRing(lat, lon, targetTime);
  } catch (err) {
    if (__DEV__) console.warn('[useCelestialApp] getOrFetchWeatherData failed:', err);
    return null;
  }
};

/**
 * 그날 일몰의 구름·하늘 표지와 대기질 한 줄(**그날 예보**). 받지 못하면 null — 다른 날 표지를 빌려 쓰지
 * 않습니다. 캐시가 없으면 429 한도 초과 방지를 위해 네트워크를 무리하게 태우지 않고 null을 반환합니다.
 */
const sunsetLabelsFor = async (
  lat: number, lon: number, sunset: Date, language: Language, cacheOnly: boolean = true
): Promise<{ cloudLabel: string; colorLabel: string; airNote: string } | null> => {
  try {
    const wx = await getOrFetchWeatherData(lat, lon, sunset, undefined, cacheOnly);
    if (!wx || wx.length === 0) return null;
    const obs = getInterpolatedWeather(wx, sunset)[0];
    if (!obs) return null;
    const pred = predictSunset(wx, sunset, 0, obs.visibility, obs.humidity, lat, 0, undefined, getSunPosition(sunset, lat, lon).azimuth);
    if (!pred) return null;
    return {
      cloudLabel: t(('cloud' + pred.cloudLabel) as any, language),
      colorLabel: t(('color' + pred.colorLabel) as any, language),
      airNote: airQualityNote(obs, language),
    };
  } catch (e) {
    if (__DEV__) console.warn('[Notification] Day forecast failed:', sunset.toISOString(), e);
    return null;
  }
};

const scheduleSunsetNotification = async (
  sunsetTime: Date,
  /** null 이면 예보 없이 "일몰 2시간 전" 만 알립니다(예보를 못 받았을 때 맑음이라고 지어내지 않습니다). */
  cloudLabel: string | null,
  colorLabel: string | null,
  language: Language,
  triggerTime?: Date,
  imageUri?: string | null,
  customIdentifier: string = 'sunset-alert',
  /** 대기질 한 줄(`airQuality.airQualityNote`). 빈 문자열이면 붙이지 않습니다. */
  airNote: string = '',
  /** 예보를 받은 날로부터 알림이 울리는 날까지 며칠인지. 1 이상이면 본문에 밝힙니다. */
  staleDays: number = 0
) => {
  try {
    const effectiveTrigger = triggerTime ?? new Date(sunsetTime.getTime() - 2 * 60 * 60 * 1000);
    if (effectiveTrigger.getTime() <= Date.now()) return;

    const title = t('sunsetNotificationTitle', language);
    const body = cloudLabel == null || colorLabel == null
      ? t('sunsetNotificationBodyNoForecast', language)
      : t('sunsetNotificationBody', language)
          .replace('{cloud}', cloudLabel)
          .replace('{color}', colorLabel)
        + (staleDays > 0 ? ' ' + t('sunsetNotificationStale', language).replace('{n}', String(staleDays)) : '')
        + (airNote ? ' ' + airNote : '');

    await Notifications.cancelScheduledNotificationAsync(customIdentifier);
    await Notifications.scheduleNotificationAsync({
      identifier: customIdentifier,
      content: {
        title,
        body,
        sound: true,
        ...(Platform.OS === 'android' ? { channelId: 'beforeglow-sunset-channel' } : {}),
        ...(imageUri ? {
          attachments: [{
            url: imageUri,
            identifier: 'sunset-preview',
            type: 'public.jpeg',
            hideThumbnail: false,
          }],
          ...(Platform.OS === 'android' ? {
            android: {
              notificationStyle: {
                type: 'bigpicture',
                picture: imageUri,
                largeIcon: imageUri,
              },
            },
          } : {}),
        } : {}),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: effectiveTrigger },
    });
    if (__DEV__) console.log(`[Sunset Notification Scheduled: ${customIdentifier}]`, effectiveTrigger, cloudLabel, colorLabel, imageUri ? '🏞 image attached' : '');
  } catch (err) {
    console.error('Failed to schedule sunset notification:', err);
  }
};

const scheduleSunriseNotification = async (
  sunriseTime: Date,
  cloudLabel: string | null,
  colorLabel: string | null,
  language: Language,
  triggerTime?: Date,
  imageUri?: string | null,
  customIdentifier: string = 'sunrise-alert',
  airNote: string = ''
) => {
  try {
    let effectiveTrigger = triggerTime;
    if (!effectiveTrigger) {
      effectiveTrigger = new Date(sunriseTime.getTime());
      effectiveTrigger.setDate(effectiveTrigger.getDate() - 1);
      effectiveTrigger.setHours(22, 0, 0, 0);
    }
    if (effectiveTrigger.getTime() <= Date.now()) return;

    const title = t('sunriseNotificationTitle', language);
    const body = cloudLabel == null || colorLabel == null
      ? t('sunriseNotificationBodyNoForecast', language)
      : t('sunriseNotificationBody', language)
          .replace('{cloud}', cloudLabel)
          .replace('{color}', colorLabel) + (airNote ? ' ' + airNote : '');

    await Notifications.cancelScheduledNotificationAsync(customIdentifier);
    await Notifications.scheduleNotificationAsync({
      identifier: customIdentifier,
      content: {
        title,
        body,
        sound: true,
        ...(Platform.OS === 'android' ? { channelId: 'beforeglow-sunset-channel' } : {}),
        ...(imageUri ? {
          ...(Platform.OS === 'android' ? {
            android: {
              notificationStyle: {
                type: 'bigpicture',
                picture: imageUri,
                largeIcon: imageUri,
              },
            },
          } : {}),
          ...(Platform.OS === 'ios' ? {
            attachments: [{
              url: imageUri,
              identifier: 'sunrise-preview',
              type: 'public.jpeg',
              hideThumbnail: false,
            }],
          } : {}),
        } : {}),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: effectiveTrigger },
    });
    if (__DEV__) console.log(`[Sunrise Notification Scheduled: ${customIdentifier}]`, effectiveTrigger, cloudLabel, colorLabel, imageUri ? '🏞 image attached' : '');
  } catch (err) {
    console.error('Failed to schedule sunrise notification:', err);
  }
};

export function useCelestialApp() {
  const { width } = Dimensions.get('window');
  
  const defaultCoords = { latitude: 37.5665, longitude: 126.9780 }; 
  const { 
    currentTime, location, timezoneOffsetHours, timezoneLabel, isTimeMachineEnabled, userRotation, isGyroEnabled, errorMsg, 
    savedLocations, currentUser, myPhotos, globalPhotos,
    locationPermission, cameraPermission, isSimulationLoading, language,
    isAppReady, initialTab, isCacheHydrated,
    setCurrentTime, setLocation, setTimeMachineEnabled, setUserRotation, setGyroEnabled, 
    resetRotation, setErrorMsg, updateTime, pinTime, addSavedLocation, removeSavedLocation,
    setCurrentUser, syncSavedLocations, addMyPhoto, removeMyPhoto, syncMyPhotos,
    uploadAndPostPhoto, syncGlobalPhotos, removeGlobalPhoto, initializePendingUploads,
    checkPermissions, requestLocationPermission, requestCameraPermission, notifPrefs: storedNotifPrefs
  } = useCelestialStore();
  // 저장된 설정에 새 항목이 없을 수 있어(앱 업데이트) 기본값 위에 얹습니다.
  const notifPrefs = { ...DEFAULT_NOTIF_PREFS, ...storedNotifPrefs };



  // 현지 기준 가상 시간 계산 (실제 법정 오프셋 반영)
  const currentTimeLocal = useMemo(() => {
    return getLocalTimeAtLocation(currentTime, timezoneOffsetHours);
  }, [currentTime, timezoneOffsetHours]);

  const [animating, setAnimating] = useState(false);
  const animatingRef = useRef(animating);
  animatingRef.current = animating;
  // 시계를 따라가는 중이면 지금으로 맞춥니다 — 사용자가 고른(붙든) 시각은 `updateTime` 이 그대로 둡니다
  // (utils/liveClock.ts). "지금" 애니메이션 중에는 그것이 시각을 옮기고 있으니 건드리지 않습니다.
  const syncClock = () => {
    if (!animatingRef.current) updateTime();
  };
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isMapVisible, setMapVisible] = useState(false);
  const [isSavedListVisible, setSavedListVisible] = useState(false);
  const [isSettingsVisible, setSettingsVisible] = useState(false);
  const [activeTab, setActiveTabState] = useState<AppTab>('sky');

  const hasInitializedTab = useRef(false);
  useEffect(() => {
    if (isAppReady && !hasInitializedTab.current) {
      hasInitializedTab.current = true;
      // 저장·전달된 값이 옛 'map' 이면(지도 탭은 없어졌습니다) 하늘로.
      const startTab: AppTab = (TAB_ORDER as string[]).includes(initialTab) ? (initialTab as AppTab) : 'sky';
      setActiveTabState(startTab);
      const toIdx = tabOrder.indexOf(startTab);
      contentTranslateX.setValue(-toIdx * width);
      // 지연 업로드 대기 큐 복구 및 스케줄링 실행
      initializePendingUploads();
    }
  }, [isAppReady, initialTab, width, initializePendingUploads]);

  const setActiveTab = (tab: AppTab) => {
    if (tab === activeTab) return;
    setActiveTabState(tab as any);
    animateContent(tab);
  };
  const [isSunCameraVisible, setSunCameraVisibleState] = useState(false);
  /**
   * 카메라는 **지금** 하늘에 3D 를 겹쳐 찍고, 그 3D 는 스토어의 `currentTime` 으로 그립니다. 시계를 따라가는
   * 중이면 여는 순간 지금으로 맞춥니다 — 멈춘 시각으로 그려, 후쿠이 21:02 기록에 17시대 노을이 담겼습니다.
   * 사용자가 고른(붙든) 시각은 그대로 둡니다.
   */
  const setSunCameraVisible = (visible: boolean) => {
    if (visible) syncClock();
    setSunCameraVisibleState(visible);
  };
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const prevTabRef = useRef(activeTab);
  const lastSunsetDateRef = useRef<string | null>(null);
  const lastSunriseDateRef = useRef<string | null>(null);

  // Theme Logic (Forced to true to default to Light Theme as requested)
  const isDay = true;
  const themeAnim = useRef(new Animated.Value(0)).current;

  // ⚠ 해·달 위치(`sunPos`·`moonPos`)와 하루 경로(`sunPath`·`moonPath`)는 여기서 세지 않습니다. 하늘 화면이 필요한 값을
  //   스스로 세고, 이 훅의 반환값을 받는 App 은 쓰지 않았습니다 — 그런데 시간 슬라이더를 움직일 때마다(루트라서 앱
  //   전체가 다시 그려지며) 해 경로 49점 + 달 경로 25점을 매번 다시 세고 있었습니다.
  const lat0 = location?.coords.latitude || defaultCoords.latitude;
  const lon0 = location?.coords.longitude || defaultCoords.longitude;

  useEffect(() => {
    // 낮↔밤 배경색 — 색이라 동작 줄이기에서도 남깁니다.
    timeTo(themeAnim, isDay ? 0 : 1, 'slow', 'standard', { useNativeDriver: false, keepWhenReduced: true }).start();
  }, [isDay]);

  // 현지 타임존 기준의 당일 정오(12:00) 시스템 시각 계산
  const targetSystemNoon = useMemo(() => {
    const localTime = getLocalTimeAtLocation(currentTime, timezoneOffsetHours);
    const localNoon = new Date(Date.UTC(
      localTime.getUTCFullYear(),
      localTime.getUTCMonth(),
      localTime.getUTCDate(),
      12, 0, 0, 0
    ));
    return getSystemTimeFromLocationTime(localNoon, timezoneOffsetHours);
  }, [currentTime, timezoneOffsetHours]);

  // 일출·일몰·월출·월몰은 **하루 단위**입니다 — 시각이 아니라 그 지역 날짜가 바뀔 때만 다시 셉니다.
  // (예전에는 렌더마다 셌고, `getMoonTimes` 는 48시간을 훑어 가장 무거운 호출입니다.)
  const eventsDayKey = localDayKey(currentTime.getTime(), timezoneOffsetHours);
  const events = useMemo(
    () => getCelestialEvents(targetSystemNoon, lat0, lon0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventsDayKey, lat0, lon0],
  );

  // 골든타임 활성 여부 (일출/일몰 전후 2.5시간) - 시간 흐름 및 타임머신 조작에 연동
  // 카메라(SunCamera)만 씁니다 — 열려 있을 때만 셉니다(슬라이더를 움직일 때마다 사흘치 일출·일몰을 세지 않게).
  const minuteKey = Math.floor(currentTime.getTime() / 60000);
  const goldenTimeInfo = useMemo(() => {
    if (!isSunCameraVisible) return null;
    return getGoldenTimeInfo(currentTime, lat0, lon0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSunCameraVisible, lat0, lon0, minuteKey]);

  // 탭 전환 시 시각 처리 (탭이 실제로 바뀔 때만 — 이전 탭을 기억합니다)
  //
  // ⚠ 하늘 탭에 들어올 때 그날 일출·일몰로 옮기던 것(예전 sim 탭의 동작)은 뺐습니다. 하늘 탭은 이제 기본
  //   탭이라 지도·기록에 다녀오면 메인 화면이 노을 시각으로 바뀌었고, 그 시각이 머문 것도 1분 타이머가
  //   하늘 탭에서 꺼져 있었기 때문입니다. 타이머가 돌면 1분 안에 튕겨 돌아가고, 붙들면 다녀올 때마다 메인
  //   화면이 멈춥니다(utils/liveClock.ts). 그날 일출·일몰은 하늘 시트의 이벤트 칩이 한 번에 옮깁니다.
  useEffect(() => {
    if (prevTabRef.current !== activeTab) {
      const targetTab = activeTab;
      prevTabRef.current = targetTab;
      
      const task = InteractionManager.runAfterInteractions(() => {
        if (targetTab === 'log') {
          // 기록 탭은 시간과 무관하므로 타임머신을 꺼 현재 시각으로 돌립니다.
          setTimeMachineEnabled(false);
        }
      });

      return () => task.cancel();
    }
  }, [activeTab]);

  // AppState 리스너: 포그라운드 복귀 시 권한 실시간 동기화
  useEffect(() => {
    checkPermissions();
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        checkPermissions();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [checkPermissions]);

  const isAndroid = Platform.OS === 'android';

  // ⚠ 테마는 `src/theme/tokens.ts` 에서 옵니다(2026-09-29 디자인 정리). 예전에는 강조색이 낮엔 주황,
  //   밤엔 하늘색으로 바뀌어 "누를 수 있는 것" 의 색이 시간대마다 달랐습니다. 이제 조작은 늘 하늘색이고,
  //   주황·호박은 해·노을 **데이터**의 색입니다. 낮/밤에는 바닥 밝기만 아주 조금 달라집니다.
  // 패널·창·헤더가 쓰는 테마 — 화면 모드(어둡게 · 밝게 · 시스템)를 따릅니다. 하늘·지도 위의 떠 있는 것은
  // 이 `theme` 이 아니라 `OVERLAY_THEME`(늘 어두움, theme/useTheme.ts)을 씁니다(docs/DESIGN_SYSTEM.md §4.1).
  const C = useThemeColors();
  const scheme = useScheme();
  const baseBg = scheme === 'light' ? C.bg : '#0A0E18';
  const dynamicTheme = {
    bg: themeAnim.interpolate({ inputRange: [0, 1], outputRange: [baseBg, C.bg] }),
    card: C.panel,
    glass: C.panel,
    text: C.text,
    subText: C.textDim,
    border: C.border,
    accent: C.accent,
  };

  const theme = {
    bg: isDay ? baseBg : C.bg,
    card: C.panel,
    glass: C.panel,
    text: C.text,
    subText: C.textDim,
    mute: C.textMute,
    border: C.border,
    accent: C.accent,
    overlay: C.overlay,
    scheme,
  };

  // Compass Sync Logic with OS-Compensated Heading
  const lastHeading = useRef(0);

  useEffect(() => {
    let headingSubscription: any = null;

    if (isGyroEnabled) {
      const startWatching = async () => {
        try {
          headingSubscription = await Location.watchHeadingAsync((data) => {
            const heading = data.trueHeading !== -1 ? data.trueHeading : data.magHeading;
            
            // 보정된 회전각을 기기 물리 회전 방향과 일치하게 반전
            let finalHeading = (360 - heading) % 360;

            // Low-pass filter 스무딩
            const prev = lastHeading.current;
            const diff = ((finalHeading - prev + 540) % 360) - 180;
            
            if (Math.abs(diff) < 0.2) return;

            const smoothed = (prev + diff * 0.15 + 360) % 360;
            const finalVal = Math.round(smoothed * 10) / 10;

            lastHeading.current = finalVal;
            setUserRotation(finalVal);
          });
        } catch (err) {
          console.error('Failed to start compass heading watch:', err);
        }
      };
      startWatching();
    }

    return () => {
      if (headingSubscription) {
        headingSubscription.remove();
      }
    };
  }, [isGyroEnabled, setUserRotation]);

  const contentTranslateX = useRef(new Animated.Value(0)).current;
  // 스와이프·애니메이션 순서는 헤더의 탭 순서(TAB_ORDER) 하나에서 나옵니다.
  // 예전에는 여기와 TabNavigator가 각자 배열을 들고 있어 서로 어긋났습니다.
  const tabOrder = TAB_ORDER;

  const animateContent = (toTab?: AppTab) => {
    const screenWidth = Dimensions.get('window').width;
    if (!toTab) return;
    const toIdx = tabOrder.indexOf(toTab as any);
    const targetX = -(toIdx >= 0 ? toIdx : 0) * screenWidth;

    springTo(contentTranslateX, targetX, 'page').start();
  };

  // "지금" 되돌림(애니메이션 + 850ms 뒤 시계 잡기)을 끊을 수 있게 — 애니메이션 차례 번호와 그 타이머.
  const animTokenRef = useRef(0);
  const nowReturnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animateTimeTo = (targetDate: Date, duration: number = 600) => {
    const token = ++animTokenRef.current;
    setAnimating(true);
    const startTime = Date.now();
    const startVal = currentTime.getTime();
    const endVal = targetDate.getTime();

    const step = () => {
      if (token !== animTokenRef.current) return; // 끊겼습니다 — 사용자가 시각을 골랐거나 새 애니메이션
      const now = Date.now();
      const progress = Math.min(1, (now - startTime) / duration);
      const ease = 1 - Math.pow(1 - progress, 3);
      const currentVal = startVal + (endVal - startVal) * ease;
      setCurrentTime(new Date(currentVal));
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        setAnimating(false);
      }
    };
    requestAnimationFrame(step);
  };

  const handleToggleTimeMachine = (enabled: boolean) => {
    if (!enabled) {
      animateTimeTo(new Date(), 800);
      if (nowReturnTimerRef.current) clearTimeout(nowReturnTimerRef.current);
      nowReturnTimerRef.current = setTimeout(() => {
        nowReturnTimerRef.current = null;
        setTimeMachineEnabled(false);
      }, 850);
    } else {
      setTimeMachineEnabled(true);
    }
  };

  /**
   * 사용자가 직접 고른 시각 — 붙들어서 시계가 덮지 않게 합니다(utils/liveClock.ts).
   * ⚠ "지금" 되돌림이 아직 진행 중이면 끊습니다. 안 끊으면 "지금" 을 누르고 1초 안에 고른 시각을 애니메이션이
   *   프레임마다 덮고, 850ms 타이머가 다시 지금으로 돌려놓습니다.
   */
  const pickTime = (time: Date) => {
    animTokenRef.current++;
    if (nowReturnTimerRef.current) {
      clearTimeout(nowReturnTimerRef.current);
      nowReturnTimerRef.current = null;
    }
    if (animatingRef.current) setAnimating(false);
    pinTime(time);
  };

  // 슬라이더·이벤트 칩(SkyScreen) — 예전에는 시각만 바꿔, 칩으로 옮긴 시각은 LIVE 로 남았습니다.
  const handleTimeChange = (newTime: Date) => {
    pickTime(newTime);
  };

  /**
   * 달력에서 고른 날 — `picked` 는 **기기 지역 기준** 년·월·일이 고른 날입니다(`datePickerValue` 가 지역 날짜를 그렇게 실어
   * 보냅니다). 시각은 지금 보던 **관측지 시각**을 그대로 두고 날짜만 바꿉니다.
   * ⚠ 예전에는 `setHours(currentTimeLocal.getHours())` 로 기기 지역 getter 에 관측지 시각을 섞어, 기기와 관측지 시간대가
   *   다르면 시각이 어긋났습니다.
   */
  const handleDateChange = (picked: Date) => {
    const l = getLocalTimeAtLocation(currentTime, timezoneOffsetHours);
    const ms = Date.UTC(picked.getFullYear(), picked.getMonth(), picked.getDate(), l.getUTCHours(), l.getUTCMinutes(), 0, 0)
      - timezoneOffsetHours * 3600000;
    animateContent();
    pickTime(new Date(clampMs(ms)));
  };
  /** 달력에 처음 보일 날 — 관측지 지역 날짜를 기기 지역 정오로 옮겨 실은 값. */
  const datePickerValue = (() => {
    const l = getLocalTimeAtLocation(currentTime, timezoneOffsetHours);
    return new Date(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate(), 12);
  })();

  const handleCameraPress = () => {
    if (isSimulationLoading) return;
    setSunCameraVisible(true);
  };

  const handleCameraLongPress = () => {
    if (isSimulationLoading) return;
    setSunCameraVisible(true);
  };

  const handleSaveLocation = async () => {
    if (!location) return;
    
    // Check if already saved
    const isAlreadySaved = savedLocations.some(
      loc => loc.latitude === location.coords.latitude && loc.longitude === location.coords.longitude
    );
    
    if (isAlreadySaved) {
      Alert.alert('Notification', 'This location is already saved.');
      return;
    }

    // 백그라운드 지형 데이터 조용히 패치 (약 0.5초 소요)
    let terrainData: any = undefined;
    try {
      terrainData = await fetchTerrainProfile(
        location.coords.latitude,
        location.coords.longitude,
        0,
        360
      );
    } catch (err) {
      console.warn('Failed to fetch silent terrain profile during location save:', err);
    }

    const defaultName = `Place ${savedLocations.length + 1}`;

    if (Platform.OS === 'web') {
      const name = window.prompt('Please enter a name for this place.', defaultName);
      if (name !== null) {
        const finalName = name.trim() || defaultName;
        addSavedLocation(finalName, location.coords.latitude, location.coords.longitude, terrainData);
        Alert.alert('Success', 'Place saved successfully!');
      }
    } else if (Platform.OS === 'ios') {
      Alert.prompt(
        'Save Place',
        'Please enter a name for this place.',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Save', 
            onPress: (name: string | undefined) => {
              const finalName = name?.trim() || defaultName;
              addSavedLocation(finalName, location.coords.latitude, location.coords.longitude, terrainData);
            } 
          }
        ],
        'plain-text',
        defaultName
      );
    } else {
      // Android does not support Alert.prompt.
      addSavedLocation(defaultName, location.coords.latitude, location.coords.longitude, terrainData);
      Alert.alert('Save Place', `Place saved as '${defaultName}'!`);
    }
  };

  const handleSelectSavedLocation = (saved: any) => {
    setLocation({
      coords: {
        latitude: saved.latitude,
        longitude: saved.longitude,
        altitude: 0,
        accuracy: 0,
        altitudeAccuracy: 0,
        heading: 0,
        speed: 0
      },
      timestamp: Date.now()
    });
    setSavedListVisible(false);
    animateContent();
  };

  useEffect(() => {
    if (locationPermission === 'granted') {
      // Force immediate default location mock in emulator to bypass GPS lock freeze
      setLocation({
        coords: {
          latitude: 37.5665,
          longitude: 126.9780,
          altitude: 0,
          accuracy: 0,
          altitudeAccuracy: 0,
          heading: 0,
          speed: 0
        },
        timestamp: Date.now()
      });
    }
  }, [locationPermission, setLocation]);

  // 시계를 따라가는 중이면 1분마다, 그리고 앱이 다시 활성화될 때 지금으로 맞춥니다(utils/liveClock.ts).
  // ⚠ 탭을 묻지 않습니다 — 예전 `activeTab !== 'sky'` 조건 때문에 기본 탭에서 시계가 멈췄습니다.
  //   사용자가 고른 시각은 `isTimeMachineEnabled` 가 지킵니다.
  useEffect(() => {
    const onActive = (fn: () => void) => {
      const subscription = AppState.addEventListener('change', (nextAppState) => {
        if (nextAppState === 'active') fn();
      });
      return () => subscription.remove();
    };
    return followClock(syncClock, onActive);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncClock 은 ref 와 고정된 updateTime 만 읽습니다
  }, []);

  // Firebase Auth & Firestore 실시간 동기화 라이프사이클
  useEffect(() => {
    let unsubscribeFirestoreLocations: (() => void) | null = null;
    let unsubscribeFirestorePhotos: (() => void) | null = null;
    
    const unsubscribeAuth = auth.onAuthStateChanged(async (user) => {
      await setCurrentUser(user);
      
      if (unsubscribeFirestoreLocations) {
        unsubscribeFirestoreLocations();
        unsubscribeFirestoreLocations = null;
      }
      if (unsubscribeFirestorePhotos) {
        unsubscribeFirestorePhotos();
        unsubscribeFirestorePhotos = null;
      }
      
      if (user) {
        unsubscribeFirestoreLocations = syncSavedLocations();
        unsubscribeFirestorePhotos = syncMyPhotos();
      } else {
        // 비로그인 상태일 경우 자동으로 익명 로그인을 시도하여 사진 공유(업로드)가 항상 작동하도록 보증
        try {
          await signInAnonymously(auth);
        } catch (anonErr) {
          console.warn('[Auth] Auto anonymous sign-in failed:', anonErr);
        }
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeFirestoreLocations) {
        unsubscribeFirestoreLocations();
      }
      if (unsubscribeFirestorePhotos) {
        unsubscribeFirestorePhotos();
      }
    };
  }, [setCurrentUser, syncSavedLocations, syncMyPhotos]);

  useEffect(() => {
    const unsubscribeGlobalPhotos = syncGlobalPhotos();
    return () => {
      unsubscribeGlobalPhotos();
    };
  }, [syncGlobalPhotos]);

  // 오늘의 스마트 노을 및 내일의 일출 알림 스케줄링 (+ 동적 앱아이콘 업데이트 연동)
  useEffect(() => {
    if (!isCacheHydrated || !location || !events) return;

    const lat = location.coords.latitude;
    const lon = location.coords.longitude;

    // 알림 설정에서 끈 예보는 예약을 지우고 다음에 켤 때 다시 예약되게 합니다.
    if (!notifPrefs.sunsetForecast) { lastSunsetDateRef.current = null; cancelScheduledByPrefix('sunset-alert'); }
    if (!notifPrefs.sunriseForecast) { lastSunriseDateRef.current = null; cancelScheduledByPrefix('sunrise-alert'); }

    // 1) 일몰(노을) 알림 스케줄링
    if (events.sunset && notifPrefs.sunsetForecast) {
      const sunsetTime = events.sunset;
      const sunsetDateStr = sunsetTime.toDateString();

      // 알림 트리거 시각: 일몰 2시간 전. 단 그 시각이 이미 지났으면 현재+5분으로 대체 (앱을 늦게 열었을 때도 받을 수 있음)
      const idealTrigger = sunsetTime.getTime() - 2 * 60 * 60 * 1000;
      const fallbackTrigger = Date.now() + 5 * 60 * 1000; // 5분 후
      const hasTriggerWindow = sunsetTime.getTime() > Date.now() + 5 * 60 * 1000; // 일몰이 최소 5분 이후

      if (hasTriggerWindow && lastSunsetDateRef.current !== sunsetDateStr) {
        lastSunsetDateRef.current = sunsetDateStr;
        const effectiveTriggerTime = new Date(idealTrigger > Date.now() ? idealTrigger : fallbackTrigger);
        
        // 일몰 시간 우선 동기화
        updateSunsetWidgetData({
          timeStr: sunsetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
          eventLabel: L3(language, '오늘의 일몰', "Today's sunset", '今日の日の入り'),
          cloudLabel: L3(language, '분석 중...', 'Analyzing...', '分析中...'),
          colorLabel: L3(language, '예측 정보 수신 중', 'Fetching forecast', '予報を取得中'),
          updatedAtStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
        const scheduleSunsetAlert = async () => {
          try {
            const hasPermission = await requestNotificationPermission();
            if (!hasPermission) {
              lastSunsetDateRef.current = null;
              return;
            }

            // 예보를 못 받으면 null — 예전에는 '맑음 / 깨끗' 을 기본으로 박아 받지도 않은 예보를 알렸습니다.
            let cloudLabel: string | null = null;
            let colorLabel: string | null = null;
            let sunsetNotifImageUri: string | null = null;
            let airNote = '';
            try {
              const weatherData = await getOrFetchWeatherData(lat, lon, sunsetTime);
              if (weatherData && weatherData.length > 0) {
                const interpolated = getInterpolatedWeather(weatherData, sunsetTime);
                const obs = interpolated[0];
                // 대기질은 오늘 일몰 시각의 값입니다 — 다른 날은 그날 예보에서 따로 받습니다.
                airNote = airQualityNote(obs, language);
                if (obs) {
                  const prediction = predictSunset(
                    weatherData, sunsetTime, 0, obs.visibility, obs.humidity, lat, 0,
                    undefined, getSunPosition(sunsetTime, lat, lon).azimuth
                  );
                  if (prediction) {
                    cloudLabel = t(('cloud' + prediction.cloudLabel) as any, language);
                    colorLabel = t(('color' + prediction.colorLabel) as any, language);

                    // 앱아이콘: Vivid → epic, Overcast → muted, 그 외 → clear
                    try {
                      let targetIcon: 'spiconmuted' | 'spiconclear' | 'spiconepic' = 'spiconclear';
                      if (prediction.colorLabel === 'Vivid') targetIcon = 'spiconepic';
                      else if (prediction.cloudLabel === 'Overcast') targetIcon = 'spiconmuted';
                      if (typeof setAppIcon === 'function') {
                        const currentIcon = getAppIcon();
                        if (currentIcon !== targetIcon) {
                          setAppIcon(targetIcon);
                          if (__DEV__) console.log(`[AppIcon] Set to: ${targetIcon} (cloud:${prediction.cloudLabel} color:${prediction.colorLabel})`);
                        }
                      }
                    } catch (iconErr) {
                      console.warn('[AppIcon] Failed to set alternate app icon:', iconErr);
                    }

                    // 알림 및 위젯용 시뮬레이션 이미지 생성 → 위젯 데이터 즉시 갱신
                    try {
                      const sunAltDeg = getSunPosition(sunsetTime, lat, lon).altitude * (180 / Math.PI);
                      const overcast = prediction.factors?.overheadOvercast ?? 0.3;
                      const b64 = await generateSimulationImage(sunAltDeg, overcast, Date.now() & 0xFFFF, prediction);
                      let resImages = null;
                      if (b64) {
                        sunsetNotifImageUri = await saveSimulationImageToCache(b64, 'notif_sunset.jpg');
                        resImages = await compressToWidgetSizes(`data:image/jpeg;base64,${b64}`, 'widget_sunset');
                      }

                      // 홈 화면 반응형 위젯 데이터 실시간 갱신 (Small/Medium/Large 3단계 해상도 지원)
                      updateSunsetWidgetData({
                        timeStr: sunsetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
                        eventLabel: L3(language, '오늘의 일몰', "Today's sunset", '今日の日の入り'),
                        cloudLabel,
                        colorLabel,
                        simulationUri: sunsetNotifImageUri,
                        simulationSmallUri: resImages?.small || sunsetNotifImageUri,
                        simulationMediumUri: resImages?.medium || sunsetNotifImageUri,
                        simulationLargeUri: resImages?.large || sunsetNotifImageUri,
                        updatedAtStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                      });
                    } catch (imgErr) {
                      console.warn('[Notification/Widget] Simulation image generation failed:', imgErr);
                    }
                  }
                }
              }
            } catch (weatherErr) {
              console.warn('[Notification] Weather fetch failed, using default labels:', weatherErr);
            }

            // 예전 노을 예약만 지웁니다 — 전부 지우면(cancelAll) 일출·하늘 이벤트 알림까지 사라졌습니다.
            await cancelScheduledByPrefix('sunset-alert-day-');

            // 향후 7일간 다일 사전 알림 스케줄링 (앱을 일주일 동안 켜지 않아도 OS 스케줄러가 매일 일몰 2시간 전에 알림 발송).
            // ⚠ 날마다 **그날 예보**를 받습니다. 예전에는 7일 모두 오늘 표지·오늘 그림을 붙여, 맑은 오늘 뒤 비 오는
            //   내일도 "맑음" 으로 울렸습니다. 그림(3D 시뮬)은 오늘 것만 만들고 다른 날은 붙이지 않습니다.
            //   앱을 열면(날짜가 바뀌면) 다시 예약하므로, 며칠 전 예보로 울리는 건 앱을 열지 않은 날뿐이고 본문에 밝힙니다.
            for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
              const futureDate = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
              const dayEvents = getCelestialEvents(futureDate, lat, lon);
              if (!dayEvents.sunset) continue;

              const fSunset = dayEvents.sunset;
              const fIdealTrigger = fSunset.getTime() - 2 * 60 * 60 * 1000;
              if (fIdealTrigger <= Date.now() && dayOffset > 0) continue;

              const notifId = `sunset-alert-day-${dayOffset}`;
              const triggerTime = new Date(fIdealTrigger > Date.now() ? fIdealTrigger : Date.now() + (5 + dayOffset) * 60 * 1000);
              if (dayOffset === 0) {
                await scheduleSunsetNotification(fSunset, cloudLabel, colorLabel, language, triggerTime, sunsetNotifImageUri, notifId, airNote);
              } else {
                const day = await sunsetLabelsFor(lat, lon, fSunset, language);
                await scheduleSunsetNotification(fSunset, day?.cloudLabel ?? null, day?.colorLabel ?? null, language, triggerTime, null, notifId, day?.airNote ?? '', dayOffset);
              }
            }
          } catch (err) {
            console.error('Failed to schedule multi-day sunset notifications:', err);
            lastSunsetDateRef.current = null;
          }
        };
        scheduleSunsetAlert();
      }
    }

    // 2) 일출 알림 스케줄링 (전날 밤 10시 시점이 미래인 경우)
    if (events.sunrise && notifPrefs.sunriseForecast) {
      const sunriseTime = events.sunrise;
      const sunriseDateStr = sunriseTime.toDateString();
      const alertTime = new Date(sunriseTime.getTime());
      alertTime.setDate(alertTime.getDate() - 1);
      alertTime.setHours(22, 0, 0, 0); // 전날 22:00

      // 전날 22시가 이미 지났으면 현재+5분으로 대체 (당일 앱을 열었을 때도 받을 수 있음)
      const hasSunriseWindow = sunriseTime.getTime() > Date.now() + 5 * 60 * 1000;
      if (hasSunriseWindow && lastSunriseDateRef.current !== sunriseDateStr) {
        lastSunriseDateRef.current = sunriseDateStr;
        const effectiveSunriseTrigger = new Date(
          alertTime.getTime() > Date.now() ? alertTime.getTime() : Date.now() + 5 * 60 * 1000
        );
        const scheduleSunriseAlert = async () => {
          try {
            const hasPermission = await requestNotificationPermission();
            if (!hasPermission) {
              lastSunriseDateRef.current = null;
              return;
            }

            let cloudLabel: string | null = null;
            let colorLabel: string | null = null;
            let sunriseNotifImageUri: string | null = null;
            let airNote = '';
            try {
              const weatherData = await getOrFetchWeatherData(lat, lon, sunriseTime);
              if (weatherData && weatherData.length > 0) {
                const interpolated = getInterpolatedWeather(weatherData, sunriseTime);
                const obs = interpolated[0];
                airNote = airQualityNote(obs, language);
                if (obs) {
                  const prediction = predictSunset(
                    weatherData, sunriseTime, 0, obs.visibility, obs.humidity, lat, 0,
                    undefined, getSunPosition(sunriseTime, lat, lon).azimuth
                  );
                  if (prediction) {
                    cloudLabel = t(('cloud' + prediction.cloudLabel) as any, language);
                    colorLabel = t(('color' + prediction.colorLabel) as any, language);

                    try {
                      let targetIcon: 'spiconmuted' | 'spiconclear' | 'spiconepic' = 'spiconclear';
                      if (prediction.colorLabel === 'Vivid') targetIcon = 'spiconepic';
                      else if (prediction.cloudLabel === 'Overcast') targetIcon = 'spiconmuted';

                      if (typeof setAppIcon === 'function') {
                        const currentIcon = getAppIcon();
                        if (currentIcon !== targetIcon) {
                          setAppIcon(targetIcon);
                          if (__DEV__) console.log(`[AppIcon] Set to: ${targetIcon} (cloud:${prediction.cloudLabel} color:${prediction.colorLabel})`);
                        }
                      }
                    } catch (iconErr) {
                      console.warn('[AppIcon] Failed to set alternate app icon:', iconErr);
                    }

                    // 알림용 시뮬레이션 이미지 생성 → 캐시 저장
                    try {
                      const sunAltDeg = getSunPosition(sunriseTime, lat, lon).altitude * (180 / Math.PI);
                      const overcast = prediction.factors?.overheadOvercast ?? 0.3;
                      const b64 = await generateSimulationImage(sunAltDeg, overcast, Date.now() & 0xFFFF, prediction);
                      sunriseNotifImageUri = b64 ? await saveSimulationImageToCache(b64, 'notif_sunrise.jpg') : null;
                    } catch (imgErr) {
                      console.warn('[Notification] Sunrise simulation image generation failed:', imgErr);
                    }
                  }
                }
              }
            } catch (weatherErr) {
              console.warn('[Notification] Weather fetch failed for sunrise, using default labels:', weatherErr);
            }

            await scheduleSunriseNotification(sunriseTime, cloudLabel, colorLabel, language, effectiveSunriseTrigger, sunriseNotifImageUri, undefined, airNote);
          } catch (err) {
            console.error('Failed to schedule sunrise notification:', err);
            lastSunriseDateRef.current = null;
          }
        };
        scheduleSunriseAlert();
      }
    }

    // 3) 현재 시각 기준의 시뮬레이션 이미지 사전 생성 및 저장 (디바운스 450ms 적용, 갱신 시 메모리 비우기 및 작업 취소 처리)
    useCelestialStore.getState().setCurrentSimulationUri(null); // 날짜/위치 갱신 즉시 이전 메모리 캐시를 해제하여 GC 대상화

    let isCancelled = false;
    let timerId: any = null;

    const generateCurrentSimulation = async () => {
      try {
        const now = new Date();
        const currentSunPos = getSunPosition(now, lat, lon);
        
        let prediction: any = null;
        let cloudRatio = 0.5;
        
        const azimuth = currentSunPos.azimuth;

        if (isCancelled) return;
        const weatherData = await getOrFetchWeatherData(lat, lon, now);
        
        if (isCancelled) return;
        if (weatherData && weatherData.length > 0) {
          const interpolated = getInterpolatedWeather(weatherData, now);
          const obs = interpolated[0];
          if (obs) {
            prediction = predictSunset(
              weatherData, now, currentSunPos.altitude, obs.visibility, obs.humidity, lat, 0, undefined, azimuth
            );
            const maxCloud = Math.max(obs.low ?? 0, obs.mid ?? 0, obs.high ?? 0);
            cloudRatio = maxCloud / 100;
          }
        } else {
          prediction = predictSunset([], now, currentSunPos.altitude, 15000, 50, lat, 0);
        }
        
        if (isCancelled) return;
        if (prediction) {
          const seed = Math.round(lat * 1000 + lon * 100 + now.getTime() / 60000);
          const b64 = await generateSimulationImage(
            currentSunPos.altitude,
            cloudRatio,
            seed,
            prediction
          );
          
          if (isCancelled) return;
          if (b64) {
            useCelestialStore.getState().setCurrentSimulationUri(b64);
            if (__DEV__) console.log('[Background Simulation] Pre-generated current simulation image.');
          }
        }
      } catch (err) {
        if (!isCancelled) {
          console.warn('[Background Simulation] Pre-generation failed:', err);
        }
      }
    };

    timerId = setTimeout(() => {
      generateCurrentSimulation();
    }, 450);

    return () => {
      isCancelled = true;
      if (timerId) {
        clearTimeout(timerId);
      }
    };
  }, [isCacheHydrated, location?.coords.latitude, location?.coords.longitude, events?.sunset?.getTime(), events?.sunrise?.getTime(), notifPrefs.sunsetForecast, notifPrefs.sunriseForecast]);

  // 하늘 이벤트 알림(골든아워·블루아워·월출·가는 달·은하수·행성) — 설정·위치·언어·날짜가 바뀌면 다시 계획합니다.
  const skyPlanKey = JSON.stringify([
    notifPrefs.golden, notifPrefs.blue, notifPrefs.moonrise, notifPrefs.crescent, notifPrefs.milkyway, notifPrefs.planets, notifPrefs.leadMin,
    location ? Math.round(location.coords.latitude * 100) / 100 : null, location ? Math.round(location.coords.longitude * 100) / 100 : null,
    language, timezoneOffsetHours, events?.sunrise?.toDateString() ?? null,
  ]);
  useEffect(() => {
    if (!location) return;
    const anyOn = SKY_NOTIF_KINDS.some((k) => notifPrefs[k]);
    let cancelled = false;
    (async () => {
      if (!anyOn) { await cancelScheduledByPrefix('sky-'); return; }
      if (!(await hasNotificationPermission(true)) || cancelled) return;
      const plan = planSkyNotifications({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        now: new Date(),
        prefs: notifPrefs,
        language,
        tzOffsetHours: timezoneOffsetHours,
      });
      if (!cancelled) await scheduleSkyPlan(plan);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skyPlanKey]);

  return {
    width,
    animating,
    setAnimating,
    showDatePicker,
    setShowDatePicker,
    isMapVisible,
    setMapVisible,
    isSavedListVisible,
    setSavedListVisible,
    isSettingsVisible,
    setSettingsVisible,
    activeTab,
    setActiveTab,
    isSunCameraVisible,
    setSunCameraVisible,
    contentOpacity,
    contentTranslateX,
    currentTime,
    currentTimeLocal,
    timezoneLabel,
    location,
    isTimeMachineEnabled,
    userRotation,
    isGyroEnabled,
    errorMsg,
    savedLocations,
    currentUser,
    setCurrentTime,
    setLocation,
    setTimeMachineEnabled,
    setUserRotation,
    setGyroEnabled,
    resetRotation,
    setErrorMsg,
    updateTime,
    addSavedLocation,
    removeSavedLocation,
    myPhotos,
    addMyPhoto,
    removeMyPhoto,
    globalPhotos,
    uploadAndPostPhoto,
    removeGlobalPhoto,
    locationPermission,
    cameraPermission,
    isSimulationLoading,
    checkPermissions,
    requestLocationPermission,
    requestCameraPermission,
    
    isDay,
    themeAnim,
    events,
    goldenTimeInfo,
    isAndroid,
    dynamicTheme,
    theme,
    
    animateContent,
    animateTimeTo,
    handleToggleTimeMachine,
    handleTimeChange,
    handleDateChange,
    datePickerValue,
    handleCameraPress,
    handleCameraLongPress,
    handleSaveLocation,
    handleSelectSavedLocation,
    defaultCoords,
  };
}
