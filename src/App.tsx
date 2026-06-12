import React from 'react';
import { StyleSheet, View, Text, SafeAreaView, StatusBar, ActivityIndicator, TouchableOpacity, Animated, Platform, Modal, ScrollView } from 'react-native';
import Constants from 'expo-constants';
import { MapPin, Star, Trash2, X, AlertCircle, Camera } from 'lucide-react-native';
import * as SplashScreen from 'expo-splash-screen';

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

  const logoScale = React.useRef(new Animated.Value(0.9)).current;
  const logoOpacity = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!isAppReady) {
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 6,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start(() => {
        Animated.loop(
          Animated.sequence([
            Animated.timing(logoScale, {
              toValue: 1.04,
              duration: 1200,
              useNativeDriver: true,
            }),
            Animated.timing(logoScale, {
              toValue: 1,
              duration: 1200,
              useNativeDriver: true,
            }),
          ])
        ).start();
      });
    }
  }, [isAppReady]);

  // 로딩 진행 중(스플래시 화면 유지 중)에는 커스텀 로딩 화면을 렌더링합니다.
  if (!isAppReady) {
    return (
      <View style={styles.loadingContainer}>
        <Animated.View style={[
          styles.logoWrapper,
          {
            opacity: logoOpacity,
            transform: [{ scale: logoScale }]
          }
        ]}>
          <Animated.Image 
            source={require('../assets/icon.png')} 
            style={styles.loadingLogo} 
            resizeMode="cover"
          />
        </Animated.View>
        <ActivityIndicator size="large" color="#FFD700" style={{ marginTop: 28 }} />
        <Text style={styles.preloadStatusText}>{t(preloadStatus as any, language)}</Text>
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

            <TouchableOpacity 
              onPress={() => setCameraWarningVisible(false)} 
              style={[styles.warningConfirmBtn, { backgroundColor: theme.accent || '#FFD700' }]}
              activeOpacity={0.8}
            >
              <Text style={[styles.warningConfirmText, { color: '#000' }]}>{t('confirm', language)}</Text>
            </TouchableOpacity>
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
    width: '100%',
    paddingVertical: 12,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  warningConfirmText: {
    fontSize: 14,
    fontWeight: '800',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#08080C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoWrapper: {
    borderRadius: 32,
    backgroundColor: '#08080C',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 215, 0, 0.25)', // 은은한 골드 테두리
    shadowColor: '#FFD700', // 금빛 글로우
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 15,
    elevation: 20,
  },
  loadingLogo: {
    width: 128,
    height: 128,
    borderRadius: 30,
    overflow: 'hidden', // Android/iOS 둥근 모서리 보장
  },
  preloadStatusText: {
    color: '#AAAAAA',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 20,
    letterSpacing: 0.5,
  },
});
