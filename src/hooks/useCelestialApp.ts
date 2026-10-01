import { useThemeColors, useScheme } from '../theme/useTheme';
import { useEffect, useState, useRef, useMemo } from 'react';
import { Dimensions, Animated, Platform, Alert, AppState, InteractionManager } from 'react-native';
import * as Location from 'expo-location';
import { useCelestialStore } from '../store/useCelestialStore';
import { getSunPosition, getMoonPosition, getSunPath, getMoonPath, getCelestialEvents } from '../utils/celestial';
import { getGoldenTimeInfo } from '../utils/sunCamera';
import { TAB_ORDER, type AppTab } from '../components/AppHeader';
import { getLocalTimeAtLocation, getSystemTimeFromLocationTime } from '../utils/timezone';
import { auth } from '../config/firebase';
import { signInAnonymously } from 'firebase/auth';
import * as Notifications from 'expo-notifications';
import { predictSunset } from '../utils/sunsetPhysics';
import { fetchSunsetWeather, getInterpolatedWeather, fetchTerrainProfile } from '../utils/weather';
import { setAppIcon, getAppIcon } from 'expo-dynamic-app-icon';
import { t, Language } from '../utils/i18n';
import { airQualityNote } from '../utils/airQuality';

const L3 = (lang: Language, ko: string, en: string, ja: string) => (lang === 'ko' ? ko : lang === 'ja' ? ja : en);
import { generateSimulationImage, saveSimulationImageToCache, compressToWidgetSizes } from '../utils/simulationImage';
import { updateSunsetWidgetData } from '../utils/widgetStorage';
import { springTo, timeTo } from '../theme/motion';
import { DEFAULT_NOTIF_PREFS, SKY_NOTIF_KINDS, planSkyNotifications } from '../utils/notificationPlan';
import { cancelScheduledByPrefix, hasNotificationPermission, scheduleSkyPlan } from '../utils/notificationScheduler';



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

const scheduleSunsetNotification = async (
  sunsetTime: Date,
  cloudLabel: string,
  colorLabel: string,
  language: Language,
  triggerTime?: Date,
  imageUri?: string | null,
  customIdentifier: string = 'sunset-alert',
  /** 대기질 한 줄(`airQuality.airQualityNote`). 빈 문자열이면 붙이지 않습니다. */
  airNote: string = ''
) => {
  try {
    const effectiveTrigger = triggerTime ?? new Date(sunsetTime.getTime() - 2 * 60 * 60 * 1000);
    if (effectiveTrigger.getTime() <= Date.now()) return;

    const title = t('sunsetNotificationTitle', language);
    const body = t('sunsetNotificationBody', language)
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
  cloudLabel: string,
  colorLabel: string,
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
    const body = t('sunriseNotificationBody', language)
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
    isAppReady, initialTab,
    setCurrentTime, setLocation, setTimeMachineEnabled, setUserRotation, setGyroEnabled, 
    resetRotation, setErrorMsg, updateTime, addSavedLocation, removeSavedLocation,
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
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isMapVisible, setMapVisible] = useState(false);
  const [isSavedListVisible, setSavedListVisible] = useState(false);
  const [isSettingsVisible, setSettingsVisible] = useState(false);
  const [activeTab, setActiveTabState] = useState<AppTab>('sky');

  const hasInitializedTab = useRef(false);
  useEffect(() => {
    if (isAppReady && !hasInitializedTab.current) {
      hasInitializedTab.current = true;
      setActiveTabState(initialTab);
      const toIdx = tabOrder.indexOf(initialTab);
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
  const [isSunCameraVisible, setSunCameraVisible] = useState(false);
  const [isCameraWarningVisible, setCameraWarningVisible] = useState(false);
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const prevTabRef = useRef(activeTab);
  const lastSunsetDateRef = useRef<string | null>(null);
  const lastSunriseDateRef = useRef<string | null>(null);

  // Theme Logic (Forced to true to default to Light Theme as requested)
  const isDay = true;
  const themeAnim = useRef(new Animated.Value(0)).current;

  const sunPos = getSunPosition(
    currentTime, 
    location?.coords.latitude || defaultCoords.latitude, 
    location?.coords.longitude || defaultCoords.longitude
  );

  useEffect(() => {
    // 낮↔밤 배경색 — 색이라 동작 줄이기에서도 남깁니다.
    timeTo(themeAnim, isDay ? 0 : 1, 'slow', 'standard', { useNativeDriver: false, keepWhenReduced: true }).start();
  }, [isDay]);

  const moonPos = getMoonPosition(
    currentTime, 
    location?.coords.latitude || defaultCoords.latitude, 
    location?.coords.longitude || defaultCoords.longitude
  );
  const sunPath = getSunPath(
    currentTime, 
    location?.coords.latitude || defaultCoords.latitude, 
    location?.coords.longitude || defaultCoords.longitude
  );
  const moonPath = getMoonPath(
    currentTime, 
    location?.coords.latitude || defaultCoords.latitude, 
    location?.coords.longitude || defaultCoords.longitude
  );
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

  const events = getCelestialEvents(
    targetSystemNoon, 
    location?.coords.latitude || defaultCoords.latitude, 
    location?.coords.longitude || defaultCoords.longitude
  );

  // 골든타임 활성 여부 (일출/일몰 전후 2.5시간) - 시간 흐름 및 타임머신 조작에 연동
  const goldenTimeInfo = useMemo(() => {
    return getGoldenTimeInfo(
      currentTime,
      location?.coords.latitude || defaultCoords.latitude,
      location?.coords.longitude || defaultCoords.longitude
    );
  }, [location, currentTime]);

  // 탭 전환 시 시간 슬라이더 초기값 리셋 (무한 루프 방지를 위해 플래그 기법 적용)
  useEffect(() => {
    if (prevTabRef.current !== activeTab) {
      const targetTab = activeTab;
      prevTabRef.current = targetTab;
      
      const task = InteractionManager.runAfterInteractions(() => {
        if (targetTab === 'sky') {
          // 하늘 탭으로 들어오면 그날의 주요 이벤트 시각으로 맞춰줍니다.
          // (예전 sim 탭의 동작 — 하늘 탭이 그 역할을 흡수했습니다)
          const localHour = currentTimeLocal.getUTCHours();
          if (localHour < 12) {
            if (events && events.sunrise) {
              setCurrentTime(events.sunrise);
            } else if (events && events.sunset) {
              setCurrentTime(events.sunset);
            }
          } else {
            if (events && events.sunset) {
              setCurrentTime(events.sunset);
            } else if (events && events.sunrise) {
              setCurrentTime(events.sunrise);
            }
          }
        } else if (targetTab === 'log') {
          // 기록 탭은 시간과 무관하므로 타임머신을 꺼 현재 시각으로 돌립니다.
          setTimeMachineEnabled(false);
        }
      });

      return () => task.cancel();
    }
  }, [activeTab, currentTimeLocal, events]);

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

  const animateTimeTo = (targetDate: Date, duration: number = 600) => {
    setAnimating(true);
    const startTime = Date.now();
    const startVal = currentTime.getTime();
    const endVal = targetDate.getTime();

    const step = () => {
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
      setTimeout(() => setTimeMachineEnabled(false), 850);
    } else {
      setTimeMachineEnabled(true);
    }
  };

  const handleTimeChange = (newTime: Date) => {
    setCurrentTime(newTime);
  };

  const handleDateChange = (newDate: Date) => {
    const newTime = new Date(newDate);
    newTime.setHours(currentTimeLocal.getHours());
    newTime.setMinutes(currentTimeLocal.getMinutes());
    newTime.setSeconds(0);
    newTime.setMilliseconds(0);
    
    const systemTime = getSystemTimeFromLocationTime(newTime, timezoneOffsetHours);
    animateContent();
    setCurrentTime(systemTime);
    if (!isTimeMachineEnabled) setTimeMachineEnabled(true);
  };
  
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

  useEffect(() => {
    const timer = setInterval(() => {
      if (!isTimeMachineEnabled && !animating && activeTab !== 'sky') {
        updateTime();
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [isTimeMachineEnabled, animating, updateTime, activeTab]);

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
    if (!location || !events) return;

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

            let cloudLabel: string = t('cloudClear', language);
            let colorLabel: string = t('colorClean', language);
            let sunsetNotifImageUri: string | null = null;
            let airNote = '';
            try {
              const azimuth = getSunPosition(sunsetTime, lat, lon).azimuth;
              const weatherData = await fetchSunsetWeather(lat, lon, azimuth, false, sunsetTime);
              if (weatherData && weatherData.length > 0) {
                const interpolated = getInterpolatedWeather(weatherData, sunsetTime);
                const obs = interpolated[0];
                // 대기질은 오늘 일몰 시각의 값입니다 — 아래 7일 예약 중 **오늘 것에만** 붙입니다.
                airNote = airQualityNote(obs, language);
                if (obs) {
                  const prediction = predictSunset(
                    weatherData, sunsetTime, 0, obs.visibility, obs.humidity, lat, 0
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

            // 향후 7일간 다일 사전 알림 스케줄링 (앱을 일주일 동안 켜지 않아도 OS 스케줄러가 매일 일몰 2시간 전에 3D 시뮬레이션 알림 발송)
            for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
              const futureDate = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
              const dayEvents = getCelestialEvents(futureDate, lat, lon);
              if (!dayEvents.sunset) continue;

              const fSunset = dayEvents.sunset;
              const fIdealTrigger = fSunset.getTime() - 2 * 60 * 60 * 1000;
              if (fIdealTrigger <= Date.now() && dayOffset > 0) continue;

              const notifId = `sunset-alert-day-${dayOffset}`;
              const triggerTime = new Date(fIdealTrigger > Date.now() ? fIdealTrigger : Date.now() + (5 + dayOffset) * 60 * 1000);
              await scheduleSunsetNotification(fSunset, cloudLabel, colorLabel, language, triggerTime, sunsetNotifImageUri, notifId, dayOffset === 0 ? airNote : '');
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

            let cloudLabel: string = t('cloudClear', language);
            let colorLabel: string = t('colorClean', language);
            let sunriseNotifImageUri: string | null = null;
            let airNote = '';
            try {
              const azimuth = getSunPosition(sunriseTime, lat, lon).azimuth;
              const weatherData = await fetchSunsetWeather(lat, lon, azimuth, false, sunriseTime);
              if (weatherData && weatherData.length > 0) {
                const interpolated = getInterpolatedWeather(weatherData, sunriseTime);
                const obs = interpolated[0];
                airNote = airQualityNote(obs, language);
                if (obs) {
                  const prediction = predictSunset(
                    weatherData, sunriseTime, 0, obs.visibility, obs.humidity, lat, 0
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
        const weatherData = await fetchSunsetWeather(lat, lon, azimuth, false, now);
        
        if (isCancelled) return;
        if (weatherData && weatherData.length > 0) {
          const interpolated = getInterpolatedWeather(weatherData, now);
          const obs = interpolated[0];
          if (obs) {
            prediction = predictSunset(
              weatherData, now, currentSunPos.altitude, obs.visibility, obs.humidity, lat, 0
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
  }, [location?.coords.latitude, location?.coords.longitude, events?.sunset?.getTime(), events?.sunrise?.getTime(), notifPrefs.sunsetForecast, notifPrefs.sunriseForecast]);

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
    isCameraWarningVisible,
    setCameraWarningVisible,
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
    
    sunPos,
    isDay,
    themeAnim,
    moonPos,
    sunPath,
    moonPath,
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
    handleCameraPress,
    handleCameraLongPress,
    handleSaveLocation,
    handleSelectSavedLocation,
    defaultCoords,
  };
}
