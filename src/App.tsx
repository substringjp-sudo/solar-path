import React from 'react';
import { StyleSheet, View, Text, SafeAreaView, StatusBar, TouchableOpacity, Animated, Platform, Modal, ScrollView, Image, Dimensions } from 'react-native';
import Constants from 'expo-constants';
import { MapPin, Star, Trash2, X, Camera } from 'lucide-react-native';
import * as SplashScreen from 'expo-splash-screen';

import { useCelestialApp } from './hooks/useCelestialApp';
import { AppHeader, type AppTab } from './components/AppHeader';
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

// 로딩 화면 순회용 대표 노을 사진 목록 (EXIF 제거본)
const LOAD_IMAGES = [
  {
    source: require('../assets/photos_clean/20251019_174521.jpg'),
    location: {
      ko: '서울특별시, 대한민국',
      en: 'Seoul, South Korea'
    },
    sunX: 0.5
  },
  {
    source: require('../assets/photos_clean/20220130_174222.jpg'),
    location: {
      ko: '홍성군, 대한민국',
      en: 'Hongseong, South Korea'
    },
    sunX: 0.5
  },
  {
    source: require('../assets/photos_clean/20221014_174506.jpg'),
    location: {
      ko: '평창군 미탄면, 대한민국',
      en: 'Mitan, South Korea'
    },
    sunX: 0.5
  },
  {
    source: require('../assets/photos_clean/20240516_192636.jpg'),
    location: {
      ko: '수사미초, 일본',
      en: 'Susami, Japan'
    },
    sunX: 0.5
  },
  {
    source: require('../assets/photos_clean/20191209_065429.jpg'),
    location: {
      ko: '방콕, 태국',
      en: 'Bangkok, Thailand'
    },
    sunX: 0.5
  }
];

export default function App() {
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  const { language, isAppReady, preloadInitialData, preloadStatus } = useCelestialStore();
  const {
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
    savedLocations,
    setLocation,
    setUserRotation,
    setGyroEnabled,
    resetRotation,
    removeSavedLocation,
    addSavedLocation,
    myPhotos,
    globalPhotos,
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

  // 앱 마운트 시 즉시 네이티브 스플래시 화면을 숨기고 하이브리드 로딩 화면을 노출합니다.
  React.useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  const progressVal = React.useRef(new Animated.Value(0.15)).current;
  const contentFade = React.useRef(new Animated.Value(0)).current;

  const [isSplashDismissed, setIsSplashDismissed] = React.useState(false);
  const splashFadeAnim = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (isAppReady) {
      Animated.timing(splashFadeAnim, {
        toValue: 0,
        duration: 450,
        useNativeDriver: true,
      }).start(() => setIsSplashDismissed(true));
    }
  }, [isAppReady]);

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

  // 커스텀 고급 팝업 애니메이션 효과용 상태
  const warningScale = React.useRef(new Animated.Value(0.85)).current;
  const warningOpacity = React.useRef(new Animated.Value(0)).current;
  const savedListScale = React.useRef(new Animated.Value(0.85)).current;
  const savedListOpacity = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (isCameraWarningVisible) {
      warningScale.setValue(0.85);
      warningOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(warningScale, {
          toValue: 1,
          friction: 6,
          tension: 100,
          useNativeDriver: true,
        }),
        Animated.timing(warningOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        })
      ]).start();
    }
  }, [isCameraWarningVisible]);

  React.useEffect(() => {
    if (isSavedListVisible) {
      savedListScale.setValue(0.85);
      savedListOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(savedListScale, {
          toValue: 1,
          friction: 7,
          tension: 90,
          useNativeDriver: true,
        }),
        Animated.timing(savedListOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        })
      ]).start();
    }
  }, [isSavedListVisible]);

  // 앱 세션별 랜덤 로딩 이미지 지정
  const randomImageRef = React.useRef(LOAD_IMAGES[Math.floor(Math.random() * LOAD_IMAGES.length)]);

  // 권한 체크 후 권한 거부 시 권한 요청 화면 렌더링
  if (locationPermission !== 'granted' && locationPermission !== null) {
    return <PermissionRequestView />;
  }

  // 프리로더 완료 전 임시 대비책
  if (!location) {
    return null;
  }

  const imageAspect = 4 / 3;
  const scaledWidth = screenHeight * imageAspect;
  const sunX = randomImageRef.current.sunX ?? 0.5;
  const sunPositionInImage = scaledWidth * sunX;
  let leftOffset = (screenWidth / 2) - sunPositionInImage;
  leftOffset = Math.max(screenWidth - scaledWidth, Math.min(0, leftOffset));

  return (
    <Animated.View style={{ flex: 1, backgroundColor: dynamicTheme.bg }}>
      <AnimatedSafeAreaView style={[styles.container, { backgroundColor: dynamicTheme.bg }]}>
        <StatusBar barStyle={isDay ? "dark-content" : "light-content"} translucent backgroundColor="transparent" />
        
        <View style={styles.mainContent}>
        <AppHeader
          activeTab={activeTab as AppTab}
          setActiveTab={setActiveTab}
          setSettingsVisible={setSettingsVisible}
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
          activeTab={activeTab as AppTab}
          setActiveTab={setActiveTab}
          contentOpacity={contentOpacity}
          contentTranslateX={contentTranslateX}
          events={events}
          theme={theme}
          dynamicTheme={dynamicTheme}
          currentTime={currentTime}
          setCurrentTime={handleTimeChange}
          isTimeMachineEnabled={isTimeMachineEnabled}
          setTimeMachineEnabled={handleToggleTimeMachine}
          globalPhotos={globalPhotos}
          myPhotos={myPhotos}
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
          <Animated.View style={[
            styles.savedModal, 
            { 
              backgroundColor: theme.bg, 
              borderColor: theme.border,
              opacity: savedListOpacity,
              transform: [{ scale: savedListScale }]
            }
          ]}>
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
          </Animated.View>
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
          <Animated.View style={[
            styles.warningModal, 
            { 
              backgroundColor: theme.card || '#1A1D24', 
              borderColor: theme.border,
              opacity: warningOpacity,
              transform: [{ scale: warningScale }]
            }
          ]}>
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
          </Animated.View>
        </View>
      </Modal>
      </AnimatedSafeAreaView>

      {/* 앱 초기 기동 스플래시 오버레이: 3D 씬이 백그라운드에서 완전히 준비될 때까지 유지되다 부드럽게 페이드아웃 */}
      {!isSplashDismissed && (
        <Animated.View
          style={[
            styles.loadingContainer,
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 9999,
              opacity: splashFadeAnim,
            },
          ]}
          pointerEvents={isAppReady ? 'none' : 'auto'}
        >
          <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
          <Image
            source={randomImageRef.current.source}
            style={{
              position: 'absolute',
              width: scaledWidth,
              height: screenHeight,
              left: leftOffset,
              top: 0,
            }}
            resizeMode="cover"
          />

          <View style={styles.paperOverlay} />

          <SafeAreaView style={styles.loadingOverlay}>
            <Animated.View style={[styles.loadingHeader, { opacity: contentFade }]}>
              <Text style={styles.appNameText}>BeforeGlow</Text>
              <Text style={styles.appSubtitleText}>The Solar & Sunset Tracker</Text>
            </Animated.View>

            <Animated.View style={[styles.loadingFooter, { opacity: contentFade }]}>
              <View style={styles.glassContainer}>
                <View style={styles.progressBarBg}>
                  <Animated.View
                    style={[
                      styles.progressBarFill,
                      {
                        width: progressVal.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0%', '100%'],
                        }),
                      },
                    ]}
                  />
                </View>
                <Text style={styles.preloadStatusText}>
                  {t(preloadStatus as any, language)}
                </Text>

                <Text style={styles.capturedText}>
                  {language === 'ko'
                    ? `📸 ${randomImageRef.current.location.ko}에서 촬영된 노을`
                    : `📸 Sunset captured in ${randomImageRef.current.location.en}`}
                </Text>
              </View>
            </Animated.View>
          </SafeAreaView>
        </Animated.View>
      )}
    </Animated.View>
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
    backgroundColor: '#F4EBE6',
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
    color: '#3D312A',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 3,
    textShadowColor: 'rgba(61, 49, 42, 0.12)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  appSubtitleText: {
    color: '#D86A4F',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    marginTop: 8,
    opacity: 0.9,
    textTransform: 'uppercase',
  },
  loadingFooter: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
    marginBottom: 40,
  },
  glassContainer: {
    width: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  progressBarBg: {
    width: '100%',
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#D86A4F',
    borderRadius: 3,
    shadowColor: '#D86A4F',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 1,
  },
  preloadStatusText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 14,
    letterSpacing: 0.5,
  },
  paperOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(244, 235, 230, 0.18)',
  },
  capturedText: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 8,
    letterSpacing: 0.5,
  },
});
