import { useEffect, useState, useRef, useMemo } from 'react';
import { Dimensions, Animated, Platform, Alert, AppState } from 'react-native';
import * as Location from 'expo-location';
import { useCelestialStore } from '../store/useCelestialStore';
import { getSunPosition, getMoonPosition, getSunPath, getMoonPath, getCelestialEvents } from '../utils/celestial';
import { getGoldenTimeInfo } from '../utils/sunCamera';
import { getLocalTimeAtLocation, getSystemTimeFromLocationTime } from '../utils/timezone';
import { auth } from '../config/firebase';

export function useCelestialApp() {
  const { width } = Dimensions.get('window');
  
  const defaultCoords = { latitude: 37.5665, longitude: 126.9780 }; 
  const { 
    currentTime, location, timezoneOffsetHours, timezoneLabel, isTimeMachineEnabled, userRotation, isGyroEnabled, errorMsg, 
    savedLocations, currentUser, myPhotos, globalPhotos,
    locationPermission, cameraPermission,
    setCurrentTime, setLocation, setTimeMachineEnabled, setUserRotation, setGyroEnabled, 
    resetRotation, setErrorMsg, updateTime, addSavedLocation, removeSavedLocation,
    setCurrentUser, syncSavedLocations, addMyPhoto, removeMyPhoto, syncMyPhotos,
    uploadAndPostPhoto, syncGlobalPhotos, removeGlobalPhoto,
    checkPermissions, requestLocationPermission, requestCameraPermission
  } = useCelestialStore();

  const longitude = location?.coords.longitude ?? defaultCoords.longitude;
  const latitude = location?.coords.latitude ?? defaultCoords.latitude;

  // 현지 기준 가상 시간 계산 (실제 법정 오프셋 반영)
  const currentTimeLocal = useMemo(() => {
    return getLocalTimeAtLocation(currentTime, timezoneOffsetHours);
  }, [currentTime, timezoneOffsetHours]);

  const [animating, setAnimating] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isMapVisible, setMapVisible] = useState(false);
  const [isSavedListVisible, setSavedListVisible] = useState(false);
  const [isSettingsVisible, setSettingsVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<'tracker' | 'sim'>('tracker');
  const [isSunCameraVisible, setSunCameraVisible] = useState(false);
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const prevTabRef = useRef(activeTab);
  const hasResetRef = useRef(false);

  // Theme Logic (Forced to true to default to Light Theme as requested)
  const isDay = true;
  const themeAnim = useRef(new Animated.Value(0)).current;

  const sunPos = getSunPosition(
    currentTime, 
    location?.coords.latitude || defaultCoords.latitude, 
    location?.coords.longitude || defaultCoords.longitude
  );

  useEffect(() => {
    Animated.timing(themeAnim, {
      toValue: isDay ? 0 : 1,
      duration: 800,
      useNativeDriver: false,
    }).start();
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

  // 골든타임 활성 여부 (일출/일몰 전후 2.5시간) - 실제 기기 시간 기준
  const goldenTimeInfo = useMemo(() => {
    return getGoldenTimeInfo(
      new Date(),
      location?.coords.latitude || defaultCoords.latitude,
      location?.coords.longitude || defaultCoords.longitude
    );
  }, [location]);

  // 탭 전환 시 시간 슬라이더 초기값 리셋 (무한 루프 방지를 위해 플래그 기법 적용)
  useEffect(() => {
    if (prevTabRef.current !== activeTab) {
      prevTabRef.current = activeTab;
      // 탭이 실제로 전환됐을 때만 리셋
      if (activeTab === 'tracker') {
        setCurrentTime(new Date());
      } else if (activeTab === 'sim') {
        if (events && events.sunrise) {
          setCurrentTime(events.sunrise);
        }
      }
    }
    // events 변경으로 인한 추가 리셋은 의도적으로 막음
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const dynamicTheme = {
    bg: themeAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['#E8EDF2', '#08080C'] // Deeper background for pro look
    }),
    glass: themeAnim.interpolate({
      inputRange: [0, 1],
      outputRange: isAndroid
        ? ['#FFFFFF', '#14141C']
        : ['rgba(255,255,255,0.4)', 'rgba(255,255,255,0.08)'] // More transparent for true glass feel
    }),
    text: themeAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['#1A1A1A', '#FFFFFF']
    }),
    subText: themeAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['#555555', '#AAAAAA']
    }),
    border: themeAnim.interpolate({
      inputRange: [0, 1],
      outputRange: isAndroid
        ? ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.04)']
        : ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.1)']
    }),
    accent: '#FFD700',
  };

  const theme = {
    bg: isDay ? '#E8EDF2' : '#08080C',
    glass: isAndroid
      ? (isDay ? '#FFFFFF' : '#14141C')
      : (isDay ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.08)'),
    text: isDay ? '#1A1A1A' : '#FFFFFF',
    subText: isDay ? '#555' : '#AAA',
    border: isAndroid
      ? (isDay ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)')
      : (isDay ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)'),
    accent: '#FFD700',
  };

  // Gyro Sync Logic with Tilt-Compensated Compass
  const accRef = useRef({ x: 0, y: 0, z: -1 });
  const magRef = useRef({ x: 0, y: 0, z: 0 });
  const lastHeading = useRef(0);

  useEffect(() => {
    let subAcc: any = null;
    let subMag: any = null;
    let timer: any = null;

    if (isGyroEnabled) {
      Promise.all([
        import('expo-sensors').then(m => m.Accelerometer),
        import('expo-sensors').then(m => m.Magnetometer),
      ]).then(([Accelerometer, Magnetometer]) => {
        Accelerometer.setUpdateInterval(32);
        Magnetometer.setUpdateInterval(32);

        subAcc = Accelerometer.addListener(data => {
          accRef.current = data;
        });
        subMag = Magnetometer.addListener(data => {
          magRef.current = data;
        });

        // 30fps 센서 융합 루프
        timer = setInterval(() => {
          const { x: Ax, y: Ay, z: Az } = accRef.current;
          const { x: Mx, y: My, z: Mz } = magRef.current;

          const accNorm = Math.sqrt(Ax * Ax + Ay * Ay + Az * Az);
          if (accNorm < 0.1) return;

          const nx = Ax / accNorm;
          const ny = Ay / accNorm;
          const nz = Az / accNorm;

          const roll = Math.atan2(ny, -nz);
          const pitch = Math.atan2(-nx, Math.sqrt(ny * ny + nz * nz));

          const cosRoll = Math.cos(roll);
          const sinRoll = Math.sin(roll);
          const cosPitch = Math.cos(pitch);
          const sinPitch = Math.sin(pitch);

          const Mh_x = Mx * cosPitch + Mz * sinPitch;
          const Mh_y = Mx * sinRoll * sinPitch + My * cosRoll - Mz * sinRoll * cosPitch;

          let azimuthRad = Math.atan2(-Mh_y, Mh_x);
          let azimuthDeg = (azimuthRad * 180 / Math.PI + 360) % 360;

          // 한국 표준 편각 보정
          const declination = -8.0 + (latitude - 37.5) * 0.1 + (longitude - 127.0) * 0.05;
          let finalHeading = (azimuthDeg + declination + 360) % 360;

          // 보정된 회전각을 기기 물리 회전 방향과 일치하게 반전
          finalHeading = (360 - finalHeading) % 360;

          // Low-pass filter 스무딩
          const prev = lastHeading.current;
          const diff = ((finalHeading - prev + 540) % 360) - 180;
          
          if (Math.abs(diff) < 0.2) return;

          const smoothed = (prev + diff * 0.12 + 360) % 360;
          const finalVal = Math.round(smoothed * 10) / 10;

          lastHeading.current = finalVal;
          setUserRotation(finalVal);
        }, 32);
      });
    }

    return () => {
      subAcc && subAcc.remove();
      subMag && subMag.remove();
      timer && clearInterval(timer);
    };
  }, [isGyroEnabled, setUserRotation, latitude, longitude]);

  const animateContent = () => {
    contentOpacity.setValue(0);
    Animated.timing(contentOpacity, {
      toValue: 1,
      duration: 500,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
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
    if (goldenTimeInfo.isActive) {
      setSunCameraVisible(true);
    } else {
      Alert.alert(
        'Waiting for Golden Hour',
        'AR Camera is only active during the 2.5 hours before and after sunrise/sunset.\n\n(Developer Bypass: Long-press for 2 seconds to force open.)',
        [{ text: 'OK', style: 'default' }]
      );
    }
  };

  const handleCameraLongPress = () => {
    Alert.alert(
      'Developer Test Mode',
      'Would you like to bypass the Golden Hour constraint and force open the AR Camera?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Force Open', style: 'destructive', onPress: () => setSunCameraVisible(true) }
      ]
    );
  };

  const handleSaveLocation = async () => {
    if (!location) return;
    
    // Check if already saved
    const isAlreadySaved = savedLocations.some(
      loc => loc.latitude === location.coords.latitude && loc.longitude === location.coords.longitude
    );
    
    if (isAlreadySaved) {
      Alert.alert('This place is already saved.');
      return;
    }

    const defaultName = `Place ${savedLocations.length + 1}`;

    if (Platform.OS === 'web') {
      const name = window.prompt('Please enter a name for this place.', defaultName);
      if (name !== null) {
        const finalName = name.trim() || defaultName;
        addSavedLocation(finalName, location.coords.latitude, location.coords.longitude);
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
              addSavedLocation(finalName, location.coords.latitude, location.coords.longitude);
            } 
          }
        ],
        'plain-text',
        defaultName
      );
    } else {
      // Android does not support Alert.prompt.
      // Save automatically with a friendly default name and let them know.
      addSavedLocation(defaultName, location.coords.latitude, location.coords.longitude);
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
      (async () => {
        try {
          let loc = await Location.getCurrentPositionAsync({});
          setLocation(loc);
        } catch (err) {
          console.warn('Failed to get current location:', err);
        }
      })();
    }
  }, [locationPermission, setLocation]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!isTimeMachineEnabled && !animating) {
        updateTime();
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [isTimeMachineEnabled, animating, updateTime]);

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
