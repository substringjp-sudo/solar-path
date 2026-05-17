import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Text, SafeAreaView, StatusBar, ActivityIndicator, Dimensions, TouchableOpacity, Animated, Platform } from 'react-native';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { format, addDays, subDays, isSameDay } from 'date-fns';
import { Sun, Moon, Navigation, Sunrise, Sunset, Clock, Zap, ChevronLeft, ChevronRight, Calendar, RotateCcw, MapPin, Compass, Star, Trash2, X } from 'lucide-react-native';
import { Modal, ScrollView, Alert } from 'react-native';

import { useCelestialStore } from './store/useCelestialStore';
import { getSunPosition, getMoonPosition, getSunPath, getMoonPath, getCelestialEvents } from './utils/celestial';
import { CelestialChart } from './components/CelestialChart';
import { InfoCard } from './components/InfoCard';
import { TimeSlider } from './components/TimeSlider';
import { SunsetSimulation } from './components/SunsetSimulation';
import { AdaptiveDatePicker } from './components/AdaptiveDatePicker/AdaptiveDatePicker';
import { MapPicker } from './components/MapPicker';

const AnimatedSafeAreaView = Animated.createAnimatedComponent(SafeAreaView);

export default function App() {
  const { width } = Dimensions.get('window');
  // ... existing state ...

  // Calculate positions ...
  const defaultCoords = { latitude: 37.5665, longitude: 126.9780 }; 
  const { 
    currentTime, location, isTimeMachineEnabled, userRotation, isGyroEnabled, errorMsg, 
    savedLocations,
    setCurrentTime, setLocation, setTimeMachineEnabled, setUserRotation, setGyroEnabled, 
    resetRotation, setErrorMsg, updateTime, addSavedLocation, removeSavedLocation
  } = useCelestialStore();

  const [animating, setAnimating] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isMapVisible, setMapVisible] = useState(false);
  const [isSavedListVisible, setSavedListVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<'tracker' | 'sim'>('tracker');
  const contentOpacity = useRef(new Animated.Value(1)).current;

  // Theme Logic
  const sunPos = getSunPosition(currentTime, location?.coords.latitude || defaultCoords.latitude, location?.coords.longitude || defaultCoords.longitude);
  const isDay = sunPos.altitude > 0;
  const themeAnim = useRef(new Animated.Value(isDay ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(themeAnim, {
      toValue: isDay ? 0 : 1,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [isDay]);

  const moonPos = getMoonPosition(currentTime, location?.coords.latitude || defaultCoords.latitude, location?.coords.longitude || defaultCoords.longitude);
  const sunPath = getSunPath(currentTime, location?.coords.latitude || defaultCoords.latitude, location?.coords.longitude || defaultCoords.longitude);
  const moonPath = getMoonPath(currentTime, location?.coords.latitude || defaultCoords.latitude, location?.coords.longitude || defaultCoords.longitude);
  const events = getCelestialEvents(currentTime, location?.coords.latitude || defaultCoords.latitude, location?.coords.longitude || defaultCoords.longitude);

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
  }, [isGyroEnabled]);

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
    const diff = Math.abs(newTime.getTime() - currentTime.getTime());
    const isJump = diff > (1000 * 60 * 30);
    if (isJump && !animating) {
      animateTimeTo(newTime, 500);
    } else {
      setCurrentTime(newTime);
    }
  };

  const handleDateChange = (newDate: Date) => {
    const newTime = new Date(newDate);
    newTime.setHours(currentTime.getHours());
    newTime.setMinutes(currentTime.getMinutes());
    animateContent();
    setCurrentTime(newTime);
    if (!isTimeMachineEnabled) setTimeMachineEnabled(true);
  };
  
  const handleSaveLocation = async () => {
    if (!location) return;
    
    // Check if already saved
    const isAlreadySaved = savedLocations.some(
      loc => loc.latitude === location.coords.latitude && loc.longitude === location.coords.longitude
    );
    
    if (isAlreadySaved) {
      Alert.alert('이미 저장된 장소입니다.');
      return;
    }

    const defaultName = `장소 ${savedLocations.length + 1}`;

    if (Platform.OS === 'web') {
      const name = window.prompt('이 장소의 이름을 입력해주세요.', defaultName);
      if (name !== null) {
        const finalName = name.trim() || defaultName;
        addSavedLocation(finalName, location.coords.latitude, location.coords.longitude);
        Alert.alert('성공', '장소가 저장되었습니다!');
      }
    } else if (Platform.OS === 'ios') {
      Alert.prompt(
        '장소 저장',
        '이 장소의 이름을 입력해주세요.',
        [
          { text: '취소', style: 'cancel' },
          { 
            text: '저장', 
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
      Alert.alert('장소 저장', `장소가 '${defaultName}'(으)로 저장되었습니다!`);
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
    const timer = setInterval(() => {
      if (!isTimeMachineEnabled && !animating) {
        updateTime();
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [isTimeMachineEnabled, animating]);

  if (errorMsg) return (
    <View style={styles.centered}>
      <Text style={styles.errorText}>{errorMsg}</Text>
    </View>
  );

  if (!location) return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color="#FFD700" />
      <Text style={styles.loadingText}>Locating your position...</Text>
    </View>
  );

  return (
    <AnimatedSafeAreaView style={[styles.container, { backgroundColor: dynamicTheme.bg }]}>
      <StatusBar barStyle={isDay ? "dark-content" : "light-content"} translucent backgroundColor="transparent" />
      
      <View style={styles.mainContent}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Animated.View style={[styles.navToggle, { backgroundColor: dynamicTheme.glass, borderColor: dynamicTheme.border }]}>
              <TouchableOpacity 
                onPress={() => setActiveTab('tracker')}
                style={[styles.navButton, activeTab === 'tracker' && { backgroundColor: theme.text }]}
              >
                <Animated.Text style={[styles.navText, { color: activeTab === 'tracker' ? theme.bg : dynamicTheme.subText }]}>Tracker</Animated.Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={() => setActiveTab('sim')}
                style={[styles.navButton, activeTab === 'sim' && { backgroundColor: theme.text }]}
              >
                <Animated.Text style={[styles.navText, { color: activeTab === 'sim' ? theme.bg : dynamicTheme.subText }]}>Simulation</Animated.Text>
              </TouchableOpacity>
            </Animated.View>

            <TouchableOpacity 
              onPress={() => setMapVisible(true)}
              style={[styles.mapOpenBtn, { backgroundColor: theme.accent }]}
            >
              <MapPin size={14} color="#000" />
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={() => setSavedListVisible(true)}
              style={[styles.mapOpenBtn, { backgroundColor: theme.glass, borderColor: theme.border, borderWidth: 1 }]}
            >
              <Star size={14} color={theme.text} fill={savedLocations.length > 0 ? theme.accent : 'transparent'} />
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={handleSaveLocation}
              style={[styles.mapOpenBtn, { backgroundColor: theme.text }]}
            >
              <Text style={[styles.mapOpenText, { color: theme.bg }]}>SAVE</Text>
            </TouchableOpacity>
          </View>

          {activeTab === 'tracker' && (
            <Animated.View style={[styles.dateNavigator, { backgroundColor: dynamicTheme.glass, borderColor: dynamicTheme.border }]}>
              <TouchableOpacity onPress={() => handleDateChange(subDays(currentTime, 1))} style={styles.dateControl}>
                <ChevronLeft size={16} color={isDay ? '#1A1A1A' : '#FFFFFF'} />
              </TouchableOpacity>
              
              <TouchableOpacity onPress={() => setShowDatePicker(true)} style={styles.dateCenter}>
                <Calendar size={12} color={isDay ? '#666' : '#AAA'} style={{ marginRight: 6 }} />
                <Animated.Text style={[styles.dateText, { color: dynamicTheme.text }]}>
                  {format(currentTime, 'EEE, MMM d, yyyy')}
                </Animated.Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => handleDateChange(addDays(currentTime, 1))} style={styles.dateControl}>
                <ChevronRight size={16} color={theme.text} />
              </TouchableOpacity>

              {!isSameDay(currentTime, new Date()) && (
                <TouchableOpacity 
                  onPress={() => handleDateChange(new Date())} 
                  style={[styles.todayButton, { backgroundColor: theme.text }]}
                >
                  <RotateCcw size={10} color={theme.bg} />
                  <Text style={[styles.todayText, { color: theme.bg }]}>TODAY</Text>
                </TouchableOpacity>
              )}
            </Animated.View>
          )}
        </View>

        <Animated.View style={[styles.animatedContent, { opacity: contentOpacity }]}>
          {activeTab === 'tracker' ? (
            <>
              <View style={styles.chartContainer}>
                <CelestialChart 
                  sunPos={sunPos} 
                  moonPos={moonPos} 
                  sunPath={sunPath} 
                  moonPath={moonPath}
                  isDay={isDay}
                  rotation={userRotation}
                  onRotationChange={setUserRotation}
                />
                
                <View style={styles.trackerControls}>
                  <TouchableOpacity 
                    onPress={resetRotation}
                    style={[styles.trackerBtn, { backgroundColor: theme.glass, borderColor: theme.border }]}
                  >
                    <RotateCcw size={16} color={theme.text} />
                    <Text style={[styles.trackerBtnText, { color: theme.text }]}>RESET</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    onPress={() => setGyroEnabled(!isGyroEnabled)}
                    style={[styles.trackerBtn, { backgroundColor: isGyroEnabled ? theme.accent : theme.glass, borderColor: isGyroEnabled ? theme.accent : theme.border }]}
                  >
                    <Compass size={16} color={isGyroEnabled ? "#000" : theme.text} />
                    <Text style={[styles.trackerBtnText, { color: isGyroEnabled ? "#000" : theme.text }]}>GYRO</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.infoSection}>
                <View style={[styles.infoFrame, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                  <View style={styles.frameHeader}>
                    <Sun size={12} color="#FFD700" />
                    <Text style={[styles.frameLabel, { color: theme.subText }]}>SOLAR DATA</Text>
                  </View>
                  <View style={styles.grid}>
                    <InfoCard 
                      icon={<Zap size={14} color="#FFD700" />}
                      label="Position"
                      value={`${sunPos.altitude.toFixed(0)}°`}
                      subValue={`${sunPos.azimuth.toFixed(0)}°`}
                      theme={theme}
                    />
                    <InfoCard 
                      icon={<Sunrise size={14} color="#FFA500" />}
                      label="Sunrise"
                      value={format(events.sunrise, 'HH:mm')}
                      theme={theme}
                    />
                    <InfoCard 
                      icon={<Sunset size={14} color="#FF4500" />}
                      label="Sunset"
                      value={format(events.sunset, 'HH:mm')}
                      theme={theme}
                    />
                  </View>
                </View>

                <View style={[styles.infoFrame, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                  <View style={styles.frameHeader}>
                    <Moon size={12} color={isDay ? "#666" : "#E0E0E0"} />
                    <Text style={[styles.frameLabel, { color: theme.subText }]}>LUNAR DATA</Text>
                  </View>
                  <View style={styles.grid}>
                    <InfoCard 
                      icon={<Zap size={14} color="#888" />}
                      label="Position"
                      value={`${moonPos.altitude.toFixed(0)}°`}
                      subValue={`${moonPos.azimuth.toFixed(0)}°`}
                      theme={theme}
                    />
                    <InfoCard 
                      icon={<Sunrise size={14} color="#888" />}
                      label="Moonrise"
                      value={events.moonrise ? format(events.moonrise, 'HH:mm') : '--:--'}
                      theme={theme}
                    />
                    <InfoCard 
                      icon={<Sunset size={14} color="#888" />}
                      label="Moonset"
                      value={events.moonset ? format(events.moonset, 'HH:mm') : '--:--'}
                      theme={theme}
                    />
                  </View>
                </View>
              </View>
            </>
          ) : (
            <SunsetSimulation 
              theme={theme} 
              currentTime={currentTime}
              setCurrentTime={setCurrentTime}
            />
          )}
        </Animated.View>
      </View>

      {activeTab === 'tracker' && (
        <View style={[styles.bottomPanel, { backgroundColor: theme.glass, borderColor: theme.border }]}>
          <TimeSlider 
            value={currentTime}
            onChange={setCurrentTime}
            isTimeMachineEnabled={isTimeMachineEnabled}
            onToggleTimeMachine={setTimeMachineEnabled}
            theme={theme}
            isDay={isDay}
            markers={[
              { time: events.sunrise, color: '#FFA500', type: 'rise' },
              { time: events.sunset, color: '#FF4500', type: 'set' },
              { time: events.moonrise, color: '#888', type: 'rise' },
              { time: events.moonset, color: '#888', type: 'set' },
            ]}
          />
        </View>
      )}

      {showDatePicker && (
        <AdaptiveDatePicker
          value={currentTime}
          onChange={handleDateChange}
          onClose={() => setShowDatePicker(false)}
        />
      )}

      <MapPicker
        visible={isMapVisible}
        onClose={() => setMapVisible(false)}
        onSelect={(loc: any) => setLocation(loc)}
        theme={theme}
        location={location}
        currentTime={currentTime}
        isDay={isDay}
      />

      <Modal
        visible={isSavedListVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSavedListVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.savedModal, { backgroundColor: theme.bg, borderColor: theme.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Saved Places</Text>
              <TouchableOpacity onPress={() => setSavedListVisible(false)} style={styles.closeBtn}>
                <X size={20} color={theme.subText} />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.savedScroll}>
              {savedLocations.length === 0 ? (
                <View style={styles.emptySaved}>
                  <Star size={40} color={theme.border} style={{ marginBottom: 10 }} />
                  <Text style={{ color: theme.subText }}>저장된 장소가 없습니다.</Text>
                </View>
              ) : (
                savedLocations.map((loc) => (
                  <View key={loc.id} style={[styles.savedItem, { borderBottomColor: theme.border }]}>
                    <TouchableOpacity 
                      style={styles.savedItemLeft} 
                      onPress={() => handleSelectSavedLocation(loc)}
                    >
                      <MapPin size={16} color={theme.accent} />
                      <View style={{ marginLeft: 12 }}>
                        <Text style={[styles.savedName, { color: theme.text }]}>{loc.name}</Text>
                        <Text style={[styles.savedCoords, { color: theme.subText }]}>
                          {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      onPress={() => removeSavedLocation(loc.id)}
                      style={styles.deleteBtn}
                    >
                      <Trash2 size={16} color="#FF4444" />
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </AnimatedSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? Constants.statusBarHeight : 0,
  },
  mainContent: {
    flex: 1,
  },
  animatedContent: {
    flex: 1,
    minHeight: 500, // Ensure there's a minimum height for simulation visibility
  },
  header: {
    paddingTop: 5,
    paddingHorizontal: 16,
    marginBottom: 5,
    gap: 4,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  navToggle: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 20,
    borderWidth: Platform.OS === 'android' ? 0.5 : 1,
  },
  navButton: {
    paddingVertical: 5,
    paddingHorizontal: 16,
    borderRadius: 16,
  },
  navText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  mapOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  mapOpenText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#000',
    letterSpacing: -0.2,
  },
  dateNavigator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: Platform.OS === 'android' ? 0.5 : 1,
    height: 40,
  },
  dateControl: {
    padding: 4,
  },
  dateCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  dateText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  todayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 4,
    position: 'absolute',
    right: 8,
  },
  todayText: {
    fontSize: 9,
    fontWeight: '900',
  },
  chartContainer: {
    flex: 1.2,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  trackerControls: {
    position: 'absolute',
    right: 20,
    bottom: 40,
    gap: 12,
  },
  trackerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: Platform.OS === 'android' ? 3 : 2,
  },
  trackerBtnText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  infoSection: {
    paddingHorizontal: 16,
    paddingBottom: 5,
    gap: 6,
  },
  infoFrame: {
    borderRadius: 20,
    padding: 10,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: Platform.OS === 'android' ? 4 : 2,
  },
  frameHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    marginBottom: 4,
    gap: 6,
  },
  frameLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  grid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bottomPanel: {
    margin: 16,
    marginBottom: 24,
    paddingVertical: 10,
    borderRadius: 28,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: Platform.OS === 'android' ? 18 : 15,
  },
  centered: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#888',
    marginTop: 15,
    fontSize: 14,
  },
  errorText: {
    color: '#ff4444',
    textAlign: 'center',
    padding: 20,
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  savedModal: {
    width: '100%',
    maxHeight: '70%',
    borderRadius: 32,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    overflow: 'hidden',
    padding: 24,
    elevation: Platform.OS === 'android' ? 24 : 0,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '900',
  },
  savedScroll: {
    flexGrow: 0,
  },
  savedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  savedItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  savedName: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 2,
  },
  savedCoords: {
    fontSize: 12,
  },
  deleteBtn: {
    padding: 8,
  },
  emptySaved: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  closeBtn: {
    padding: 4,
  },
});
