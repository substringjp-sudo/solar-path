import React from 'react';
import { StyleSheet, View, Text, SafeAreaView, StatusBar, ActivityIndicator, TouchableOpacity, Animated, Platform, Modal, ScrollView } from 'react-native';
import Constants from 'expo-constants';
import { MapPin, Star, Trash2, X, AlertCircle, Camera } from 'lucide-react-native';
import * as SplashScreen from 'expo-splash-screen';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Circle, Rect, Path, Ellipse } from 'react-native-svg';

import { useCelestialApp } from './hooks/useCelestialApp';
import { HudHeader } from './components/HudHeader';
import { TabNavigator } from './components/TabNavigator';
import { AdaptiveDatePicker } from './components/AdaptiveDatePicker/AdaptiveDatePicker';
import { MapPicker } from './components/MapPicker';
import { SunCamera } from './components/SunCamera';
import { SettingsModal } from './components/SettingsModal';
import { PermissionRequestView } from './components/PermissionRequestView';
import { useCelestialStore } from './store/useCelestialStore';
import { t } from './utils/i18n';

// 앱 초기 기동 시 Native Splash Screen을 유지하도록 고정합니다.
SplashScreen.preventAutoHideAsync().catch(() => {});

const AnimatedSafeAreaView = Animated.createAnimatedComponent(SafeAreaView);

export default function App() {
  const { language, isAppReady, preloadInitialData, preloadStatus } = useCelestialStore();
  const {
    animating,
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
    locationPermission,
    isTimeMachineEnabled,
    userRotation,
    isGyroEnabled,
    errorMsg,
    savedLocations,
    setLocation,
    setUserRotation,
    setGyroEnabled,
    resetRotation,
    removeSavedLocation,
    addSavedLocation,
    myPhotos,
    addMyPhoto,
    removeMyPhoto,
    globalPhotos,
    uploadAndPostPhoto,
    removeGlobalPhoto,
    
    sunPos,
    isDay,
    moonPos,
    sunPath,
    moonPath,
    events,
    goldenTimeInfo,
    dynamicTheme,
    theme,
    
    handleToggleTimeMachine,
    handleTimeChange,
    handleDateChange,
    handleCameraPress,
    handleCameraLongPress,
    handleSaveLocation,
    handleSelectSavedLocation,
    defaultCoords,
    isSimulationLoading,
  } = useCelestialApp();

  // 앱 마운트 시 백그라운드 데이터(날씨, 지형 캐시 등) 프리로드 실행
  React.useEffect(() => {
    preloadInitialData();
  }, [preloadInitialData]);

  // 로딩이 완료되면 스플래시 화면을 부드럽게 종료
  React.useEffect(() => {
    if (isAppReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isAppReady]);

  const progressVal = React.useRef(new Animated.Value(0.15)).current;
  const contentFade = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!isAppReady) {
      Animated.timing(contentFade, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }).start();
    }
  }, [isAppReady]);

  React.useEffect(() => {
    let target = 0.15;
    if (preloadStatus === 'checkingPermissions') target = 0.35;
    else if (preloadStatus === 'locatingPosition') target = 0.6;
    else if (preloadStatus === 'analyzingData') target = 0.85;
    else if (preloadStatus === 'simulationReady') target = 1.0;

    Animated.timing(progressVal, {
      toValue: target,
      duration: 500,
      useNativeDriver: false,
    }).start();
  }, [preloadStatus]);

  // 로딩 진행 중(스플래시 화면 유지 중)에는 커스텀 로딩 화면을 렌더링합니다.
  if (!isAppReady) {
    return (
      <View style={styles.loadingContainer}>
        {/* Fullscreen SVG Sunset Drawing matching icon.png style */}
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 800 800" preserveAspectRatio="xMidYMid slice">
          <Defs>
            <LinearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor="#0b132b" />
              <Stop offset="35%" stopColor="#1c2541" />
              <Stop offset="65%" stopColor="#5c2c5c" />
              <Stop offset="85%" stopColor="#cf455c" />
              <Stop offset="100%" stopColor="#ff7b54" />
            </LinearGradient>
            <RadialGradient id="sunGrad" cx="50%" cy="40%" r="60%">
              <Stop offset="0%" stopColor="#fff4cc" />
              <Stop offset="25%" stopColor="#ffcc00" />
              <Stop offset="65%" stopColor="#ff6600" />
              <Stop offset="100%" stopColor="#cc0044" />
            </RadialGradient>
            <LinearGradient id="cloudEdgeGrad" x1="0%" y1="100%" x2="0%" y2="0%">
              <Stop offset="0%" stopColor="#ffcc00" />
              <Stop offset="100%" stopColor="#ffffff" />
            </LinearGradient>
            <LinearGradient id="cloudBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor="#311d4d" stopOpacity={0.95} />
              <Stop offset="100%" stopColor="#160c26" stopOpacity={0.95} />
            </LinearGradient>
            <LinearGradient id="mountFar" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor="#4c2c72" />
              <Stop offset="100%" stopColor="#211235" />
            </LinearGradient>
            <LinearGradient id="mountMid" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor="#2e184a" />
              <Stop offset="100%" stopColor="#120621" />
            </LinearGradient>
            <LinearGradient id="mountNear" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor="#160829" />
              <Stop offset="100%" stopColor="#05010a" />
            </LinearGradient>
            <LinearGradient id="waterGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor="#190d33" />
              <Stop offset="50%" stopColor="#0c051c" />
              <Stop offset="100%" stopColor="#020005" />
            </LinearGradient>
            <LinearGradient id="yoonseulGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor="#ff6600" stopOpacity={0} />
              <Stop offset="25%" stopColor="#ffcc00" stopOpacity={0.8} />
              <Stop offset="50%" stopColor="#ffffff" stopOpacity={1} />
              <Stop offset="75%" stopColor="#ffcc00" stopOpacity={0.8} />
              <Stop offset="100%" stopColor="#ff6600" stopOpacity={0} />
            </LinearGradient>
          </Defs>

          {/* Sky Background */}
          <Rect width="800" height="800" fill="url(#skyGrad)" />
          
          {/* Sun setting into horizon */}
          <Circle cx="400" cy="430" r="170" fill="url(#sunGrad)" />

          {/* Cloud Backlight */}
          <Path d="M 200,320 Q 300,260 420,290 T 640,300 Q 700,340 600,380 H 200 Z" fill="url(#cloudEdgeGrad)" opacity={0.3} />

          {/* Far Mountains */}
          <Path d="M 0,520 L 150,440 L 290,490 L 460,390 L 620,470 L 800,410 L 800,560 L 0,560 Z" fill="url(#mountFar)" opacity={0.9} />

          {/* Clouds passing in front of Sun */}
          <Path d="M 120,380 C 170,330 250,330 290,360 C 340,310 440,310 490,350 C 530,320 610,330 650,370 C 690,410 630,460 570,440 C 490,460 410,430 360,450 C 290,440 160,440 120,380 Z" fill="url(#cloudBodyGrad)" />
          <Path d="M 120,380 C 170,330 250,330 290,360 C 340,310 440,310 490,350 C 530,320 610,330 650,370" fill="none" stroke="url(#cloudEdgeGrad)" strokeWidth={4} strokeLinecap="round" opacity={0.9} />

          {/* Mid Mountains */}
          <Path d="M -50,560 L 180,460 L 340,520 L 510,430 L 690,510 L 850,440 L 850,600 L -50,600 Z" fill="url(#mountMid)" />

          {/* Near Mountains */}
          <Path d="M -20,600 L 120,510 L 260,560 L 420,470 L 600,550 L 820,480 L 820,620 L -20,620 Z" fill="url(#mountNear)" />

          {/* Water Surface */}
          <Rect y={540} width="800" height="260" fill="url(#waterGrad)" />

          {/* Ripple lines */}
          <Path d="M 50,555 Q 220,548 400,555 T 750,555" fill="none" stroke="#cf455c" strokeWidth={2} opacity={0.5} />
          <Path d="M 100,580 Q 250,572 400,580 T 700,580" fill="none" stroke="#cf455c" strokeWidth={1.8} opacity={0.4} />
          <Path d="M 150,610 Q 280,602 400,610 T 650,610" fill="none" stroke="#cf455c" strokeWidth={1.5} opacity={0.3} />
          <Path d="M 180,645 Q 300,637 400,645 T 620,645" fill="none" stroke="#ff7b54" strokeWidth={1.2} opacity={0.25} />
          <Path d="M 220,685 Q 310,677 400,685 T 580,685" fill="none" stroke="#ff7b54" strokeWidth={1} opacity={0.2} />
          <Path d="M 260,730 Q 330,723 400,730 T 540,730" fill="none" stroke="#ffcc00" strokeWidth={1} opacity={0.15} />

          {/* Yoonseul (Golden Glow Reflections) */}
          <Ellipse cx="400" cy="558" rx="160" ry="10" fill="url(#yoonseulGrad)" />
          <Ellipse cx="400" cy="583" rx="130" ry="8" fill="url(#yoonseulGrad)" />
          <Ellipse cx="400" cy="613" rx="100" ry="7" fill="url(#yoonseulGrad)" />
          <Ellipse cx="400" cy="648" rx="80" ry="6" fill="url(#yoonseulGrad)" />
          <Ellipse cx="400" cy="688" rx="60" ry="5" fill="url(#yoonseulGrad)" />
          <Ellipse cx="400" cy="733" rx="40" ry="4" fill="url(#yoonseulGrad)" />
          <Ellipse cx="400" cy="775" rx="20" ry="3" fill="url(#yoonseulGrad)" />

          {/* Sparkling Yoonseul Particles */}
          <Path d="M 400,550 L 406,556 L 400,562 L 394,556 Z" fill="#ffffff" />
          <Path d="M 350,565 L 354,569 L 350,573 L 346,569 Z" fill="#ffcc00" opacity={0.9} />
          <Path d="M 450,567 L 454,571 L 450,575 L 446,571 Z" fill="#ffcc00" opacity={0.9} />
          <Path d="M 380,590 L 385,595 L 380,600 L 375,595 Z" fill="#ffffff" />
          <Path d="M 420,592 L 425,597 L 420,602 L 415,597 Z" fill="#ffffff" />
          <Path d="M 330,605 L 333,608 L 330,611 L 327,608 Z" fill="#ffcc00" opacity={0.7} />
          <Path d="M 470,603 L 473,606 L 470,609 L 467,606 Z" fill="#ffcc00" opacity={0.7} />
          <Path d="M 395,625 L 400,630 L 395,635 L 390,630 Z" fill="#ffffff" />
          <Path d="M 410,655 L 414,659 L 410,663 L 406,659 Z" fill="#ffcc00" opacity={0.85} />
          <Path d="M 370,665 L 373,668 L 370,671 L 367,668 Z" fill="#ffcc00" opacity={0.6} />
          <Path d="M 402,705 L 405,708 L 402,711 L 399,708 Z" fill="#ffffff" opacity={0.75} />
        </Svg>

        {/* Content Overlay */}
        <SafeAreaView style={styles.loadingOverlay}>
          {/* Header Area for App Name (Keeps it high on the dark sky part, fully visible) */}
          <Animated.View style={[styles.loadingHeader, { opacity: contentFade }]}>
            <Text style={styles.appNameText}>BeforeGlow</Text>
            <Text style={styles.appSubtitleText}>The Solar & Sunset Tracker</Text>
          </Animated.View>

          {/* Footer Area for custom progress bar & state details */}
          <Animated.View style={[styles.loadingFooter, { opacity: contentFade }]}>
            {/* Custom concept-matching progress bar */}
            <View style={styles.progressBarBg}>
              <Animated.View style={[
                styles.progressBarFill,
                {
                  width: progressVal.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%']
                  })
                }
              ]} />
            </View>
            <Text style={styles.preloadStatusText}>
              {t(preloadStatus as any, language)}
            </Text>
          </Animated.View>
        </SafeAreaView>
      </View>
    );
  }

  // 권한 체크 후 권한 거부 시 권한 요청 화면 렌더링
  if (locationPermission !== 'granted') {
    return <PermissionRequestView />;
  }

  // 프리로더 완료 후 위치가 정상적으로 설정되지 않았을 경우 (대비책)
  if (!location) {
    return null;
  }

  return (
    <AnimatedSafeAreaView style={[styles.container, { backgroundColor: dynamicTheme.bg }]}>
      <StatusBar barStyle={isDay ? "dark-content" : "light-content"} translucent backgroundColor="transparent" />
      
      <View style={styles.mainContent}>
        <HudHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          setSavedListVisible={setSavedListVisible}
          setSettingsVisible={setSettingsVisible}
          handleSaveLocation={handleSaveLocation}
          handleCameraPress={handleCameraPress}
          handleCameraLongPress={handleCameraLongPress}
          goldenTimeInfo={goldenTimeInfo}
          setShowDatePicker={setShowDatePicker}
          handleDateChange={handleDateChange}
          theme={theme}
          dynamicTheme={dynamicTheme}
          currentTimeLocal={currentTimeLocal}
          timezoneLabel={timezoneLabel}
          isSimulationLoading={isSimulationLoading}
        />

        <TabNavigator
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          contentOpacity={contentOpacity}
          contentTranslateX={contentTranslateX}
          sunPos={sunPos}
          moonPos={moonPos}
          sunPath={sunPath}
          moonPath={moonPath}
          events={events}
          theme={theme}
          dynamicTheme={dynamicTheme}
          userRotation={userRotation}
          setUserRotation={setUserRotation}
          resetRotation={resetRotation}
          isGyroEnabled={isGyroEnabled}
          setGyroEnabled={setGyroEnabled}
          currentTime={currentTime}
          setCurrentTime={handleTimeChange}
          isTimeMachineEnabled={isTimeMachineEnabled}
          setTimeMachineEnabled={handleToggleTimeMachine}
          isDay={isDay}
          globalPhotos={globalPhotos}
          removeGlobalPhoto={removeGlobalPhoto}
          setMapVisible={setMapVisible}
        />
      </View>

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
        savedLocations={savedLocations}
        addSavedLocation={addSavedLocation}
        removeSavedLocation={removeSavedLocation}
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
              <Text style={[styles.modalTitle, { color: theme.text }]}>{t('savedPlaces', language)}</Text>
              <TouchableOpacity onPress={() => setSavedListVisible(false)} style={styles.closeBtn}>
                <X size={20} color={theme.subText} />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.savedScroll}>
              {savedLocations.length === 0 ? (
                <View style={styles.emptySaved}>
                  <Star size={40} color={theme.border} style={{ marginBottom: 10 }} />
                  <Text style={{ color: theme.subText }}>{t('noSavedPlaces', language)}</Text>
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

      {/* AR 노을 촬영 카메라 */}
      <SunCamera
        visible={isSunCameraVisible}
        onClose={() => setSunCameraVisible(false)}
        latitude={location?.coords.latitude || defaultCoords.latitude}
        longitude={location?.coords.longitude || defaultCoords.longitude}
        currentTime={currentTime}
        goldenTimeInfo={goldenTimeInfo}
      />

      {/* 설정 모달 */}
      <SettingsModal
        visible={isSettingsVisible}
        onClose={() => setSettingsVisible(false)}
        theme={theme}
        dynamicTheme={dynamicTheme}
      />

      {/* 카메라 비활성화 안내 모달 */}
      <Modal
        visible={isCameraWarningVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCameraWarningVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.warningModal, { backgroundColor: theme.card || '#1A1D24', borderColor: theme.border }]}>
            <View style={styles.warningIconContainer}>
              <View style={[styles.warningIconBg, { backgroundColor: 'rgba(255, 165, 0, 0.15)' }]}>
                <Camera size={28} color="#FFA500" />
              </View>
            </View>
            
            <Text style={[styles.warningTitle, { color: theme.text }]}>{t('waitingGoldenHour', language)}</Text>
            
            <Text style={[styles.warningMessage, { color: theme.subText }]}>
              {t('cameraWarningMessage', language)}
            </Text>

            <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
              <TouchableOpacity 
                onPress={() => setCameraWarningVisible(false)} 
                style={[styles.warningCancelBtn, { flex: 1, borderColor: theme.border }]}
                activeOpacity={0.8}
              >
                <Text style={[styles.warningConfirmText, { color: theme.text }]}>{t('cancel', language)}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={() => {
                  setCameraWarningVisible(false);
                  setSunCameraVisible(true);
                }} 
                style={[styles.warningConfirmBtn, { flex: 1, backgroundColor: theme.accent || '#FFD700' }]}
                activeOpacity={0.8}
              >
                <Text style={[styles.warningConfirmText, { color: '#000' }]}>{t('enterAnyway', language)}</Text>
              </TouchableOpacity>
            </View>
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
  warningModal: {
    width: '85%',
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    elevation: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  warningIconContainer: {
    marginBottom: 16,
  },
  warningIconBg: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  warningTitle: {
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 12,
    textAlign: 'center',
  },
  warningMessage: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
  },
  warningConfirmBtn: {
    paddingVertical: 12,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  warningCancelBtn: {
    paddingVertical: 12,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  warningConfirmText: {
    fontSize: 14,
    fontWeight: '800',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#08080C',
  },
  loadingOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 64,
  },
  loadingHeader: {
    alignItems: 'center',
    marginTop: 40,
  },
  appNameText: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 3,
    textShadowColor: 'rgba(255, 215, 0, 0.5)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 12,
  },
  appSubtitleText: {
    color: '#FFD700',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    marginTop: 8,
    opacity: 0.85,
    textTransform: 'uppercase',
  },
  loadingFooter: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
    marginBottom: 40,
  },
  progressBarBg: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 2,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#FFD700',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 2,
  },
  preloadStatusText: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 14,
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
