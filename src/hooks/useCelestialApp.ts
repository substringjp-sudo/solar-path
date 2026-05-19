import { useEffect, useState, useRef, useMemo } from 'react';
import { Dimensions, Animated, Platform, Alert } from 'react-native';
import * as Location from 'expo-location';
import { useCelestialStore } from '../store/useCelestialStore';
import { getSunPosition, getMoonPosition, getSunPath, getMoonPath, getCelestialEvents } from '../utils/celestial';
import { getGoldenTimeInfo } from '../utils/sunCamera';
import { getLocalTimeAtLocation, getSystemTimeFromLocationTime } from '../utils/timezone';

export function useCelestialApp() {
  const { width } = Dimensions.get('window');
  
  const defaultCoords = { latitude: 37.5665, longitude: 126.9780 }; 
  const { 
    currentTime, location, timezoneOffsetHours, timezoneLabel, isTimeMachineEnabled, userRotation, isGyroEnabled, errorMsg, 
    savedLocations,
    setCurrentTime, setLocation, setTimeMachineEnabled, setUserRotation, setGyroEnabled, 
    resetRotation, setErrorMsg, updateTime, addSavedLocation, removeSavedLocation
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
  const [activeTab, setActiveTab] = useState<'tracker' | 'sim'>('tracker');
  const [isSunCameraVisible, setSunCameraVisible] = useState(false);
  const contentOpacity = useRef(new Animated.Value(1)).current;

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
  const events = getCelestialEvents(
    currentTime, 
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

  // Gyro Sync Logic with Smoothing
  const lastHeading = useRef(0);
  useEffect(() => {
    let subscription: any = null;
    if (isGyroEnabled) {
      import('expo-sensors').then(({ Magnetometer }) => {
        subscription = Magnetometer.addListener(data => {
          const { x, y } = data;
          let magHeading = Math.atan2(y, x) * (180 / Math.PI);
          let finalHeading = (magHeading - 90 + 360) % 360;
          
          // Smoothing (Low-pass filter) with Deadzone
          const prev = lastHeading.current;
          const diff = ((finalHeading - prev + 540) % 360) - 180;
          
          // Deadzone: Ignore micro-jitter if change is too small
          if (Math.abs(diff) < 0.2) return;
          
          const smoothed = (prev + diff * 0.1 + 360) % 360; // More aggressive smoothing (0.1)
          const finalVal = Math.round(smoothed * 10) / 10; // Round to 1 decimal place
          
          lastHeading.current = finalVal;
          setUserRotation(-finalVal);
        });
        Magnetometer.setUpdateInterval(16);
      });
    }
    return () => subscription && subscription.remove();
  }, [isGyroEnabled, setUserRotation]);

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
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission to access location was denied');
        return;
      }
      let loc = await Location.getCurrentPositionAsync({});
      setLocation(loc);
    })();
  }, [setLocation, setErrorMsg]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!isTimeMachineEnabled && !animating) {
        updateTime();
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [isTimeMachineEnabled, animating, updateTime]);

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
