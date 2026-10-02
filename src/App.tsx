import React, { useEffect } from 'react';
import { StyleSheet, View, Text, SafeAreaView, StatusBar, Animated, Platform, Modal, ScrollView, Image, Dimensions, Linking } from 'react-native';
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
import { parseTeleportUrl } from './utils/teleport';
import { t } from './utils/i18n';
import { PressScale } from './components/ui';
import { springTo, timeTo } from './theme/motion';
import { motion, color, dataColor } from './theme/tokens';
import { makeStyles, useThemeColors, useDataColors, useScheme } from './theme/useTheme';

/** 가운데 창은 94% 에서 스프링으로 커지며 나타납니다(docs/DESIGN_SYSTEM.md §7). */
const POP_FROM = motion.popFrom;

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
  const color = useThemeColors(); const dataColor = useDataColors(); const styles = useStyles(); const scheme = useScheme();
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  const { language, isAppReady, preloadInitialData, preloadStatus, setTeleportTarget } = useCelestialStore();
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
    dynamicTheme,
    theme,
    goldenTimeInfo,
    
    handleToggleTimeMachine,
    handleTimeChange,
    handleDateChange,
    handleSaveLocation,
    handleSelectSavedLocation,
    defaultCoords,
    isSimulationLoading,
  } = useCelestialApp();

  // 앱 마운트 시 백그라운드 데이터(날씨, 지형 캐시 등) 프리로드 실행
  React.useEffect(() => {
    preloadInitialData();
  }, [preloadInitialData]);
  const startupLocationSettled = useCelestialStore(s => s.startupLocationSettled);

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
      timeTo(splashFadeAnim, 0, 'slow', 'exit', { keepWhenReduced: true }).start(() => setIsSplashDismissed(true));
    }
  }, [isAppReady]);

  React.useEffect(() => {
    if (!isAppReady) {
      timeTo(contentFade, 1, 'slow', 'enter', { keepWhenReduced: true }).start();
    }
  }, [isAppReady]);

  React.useEffect(() => {
    let target = 0.15;
    if (preloadStatus === 'checkingPermissions') target = 0.35;
    else if (preloadStatus === 'locatingPosition') target = 0.6;
    else if (preloadStatus === 'analyzingData') target = 0.85;
    else if (preloadStatus === 'simulationReady') target = 1.0;

    timeTo(progressVal, target, 'slow', 'standard', { useNativeDriver: false, keepWhenReduced: true }).start();
  }, [preloadStatus]);

  // 커스텀 고급 팝업 애니메이션 효과용 상태
  const warningScale = React.useRef(new Animated.Value(POP_FROM)).current;
  const warningOpacity = React.useRef(new Animated.Value(0)).current;
  const savedListScale = React.useRef(new Animated.Value(POP_FROM)).current;
  const savedListOpacity = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (isCameraWarningVisible) {
      warningScale.setValue(POP_FROM);
      warningOpacity.setValue(0);
      Animated.parallel([
        springTo(warningScale, 1, 'sheet'),
        timeTo(warningOpacity, 1, 'fast', 'enter', { keepWhenReduced: true }),
      ]).start();
    }
  }, [isCameraWarningVisible]);

  React.useEffect(() => {
    if (isSavedListVisible) {
      savedListScale.setValue(POP_FROM);
      savedListOpacity.setValue(0);
      Animated.parallel([
        springTo(savedListScale, 1, 'sheet'),
        timeTo(savedListOpacity, 1, 'fast', 'enter', { keepWhenReduced: true }),
      ]).start();
    }
  }, [isSavedListVisible]);

  // 앱 숏컷 및 외부 딥링크 처리 (beforeglow://camera, beforeglow://teleport 등)
  //
  // ⚠ 현재 시각은 ref 로 읽습니다. 예전에는 effect 의존성에 currentTime 이 있어, 텔레포트가 시각을 바꾸면
  //   effect 가 다시 돌고 → getInitialURL 이 **같은 주소**를 또 돌려주고 → 다시 시각을 바꾸는 고리가 돌아
  //   "Maximum update depth exceeded" 로 멈췄습니다(웹에서 ?teleport 주소로 열 때). 처음 주소는 한 번만 처리합니다.
  // ⚠ 처음 주소는 **프리로드가 시작 위치를 정한 뒤에**(startupLocationSettled) 처리합니다. 시작할 때 위치를
  //   정하는 길(프리로드의 GPS, 권한이 생기면 넣는 기본 위치)이 텔레포트보다 늦게 끝나 텔레포트 위치를
  //   덮어썼습니다 — 위의 고리가 그걸 계속 다시 덮어써서 가려져 있었습니다. isAppReady 로는 모자랍니다:
  //   3D 가 첫 장을 그리면 켜져서, 웹에서 재 보니 준비 3.5초 · 프리로드의 GPS 6.6초였습니다. 프리로드가 다
  //   끝나기까지(날씨·지형, 웹 13초) 기다릴 까닭은 없습니다.
  const currentTimeRef = React.useRef(currentTime);
  currentTimeRef.current = currentTime;
  const initialUrlHandledRef = React.useRef(false);
  const handleUrlRef = React.useRef<((event: { url: string }) => void) | null>(null);
  React.useEffect(() => {
    const handleUrl = (event: { url: string }) => {
      const url = event.url;
      if (!url) return;

      if (url.toLowerCase().includes('camera')) {
        setSunCameraVisible(true);
        return;
      }

      const teleportData = parseTeleportUrl(url, currentTimeRef.current);
      if (teleportData) {
        if (__DEV__) console.log('[DeepLink] Teleport received:', teleportData);
        // 열려있는 모달들을 모두 닫고 3D 씬 탭으로 즉시 워프
        setMapVisible(false);
        setSavedListVisible(false);
        setShowDatePicker(false);
        setSettingsVisible(false);
        setSunCameraVisible(false);
        setActiveTab('sky');

        if (teleportData.location) {
          setLocation(teleportData.location);
        }
        if (teleportData.time) {
          // 링크에 담긴 시각도 사용자가 고른 시각입니다 — 붙들어서 시계가 덮지 않게(utils/liveClock.ts).
          handleTimeChange(teleportData.time);
        }
        if (teleportData.camera) {
          setTeleportTarget(teleportData.camera);
        }
      }
    };

    const subscription = Linking.addEventListener('url', handleUrl);
    handleUrlRef.current = handleUrl;

    return () => {
      subscription.remove();
    };
  }, [setLocation, handleTimeChange, setTeleportTarget, setActiveTab, setSunCameraVisible, setMapVisible, setSavedListVisible, setShowDatePicker, setSettingsVisible]);

  React.useEffect(() => {
    if (!startupLocationSettled || initialUrlHandledRef.current) return;
    initialUrlHandledRef.current = true;
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleUrlRef.current?.({ url });
      }
    });
  }, [startupLocationSettled]);

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
        <StatusBar barStyle={scheme === 'light' ? 'dark-content' : 'light-content'} translucent backgroundColor="transparent" />
        
        <View style={styles.mainContent}>
        <AppHeader
          activeTab={activeTab as AppTab}
          setActiveTab={setActiveTab}
          setSettingsVisible={setSettingsVisible}
          setMapVisible={setMapVisible}
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
          onCameraPress={() => setSunCameraVisible(true)}
          isSuspended={isSunCameraVisible || isMapVisible || isSettingsVisible || isSavedListVisible}
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
              <PressScale onPress={() => setSavedListVisible(false)} style={styles.closeBtn}>
                <X size={20} color={theme.subText} />
              </PressScale>
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
                    <PressScale 
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
                    </PressScale>
                    <PressScale 
                      onPress={() => removeSavedLocation(loc.id)}
                      style={styles.deleteBtn}
                    >
                      <Trash2 size={16} color={color.danger} />
                    </PressScale>
                  </View>
                ))
              )}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* AR 노을 촬영 카메라 (닫힐 때 메모리/GPU/센서 완전 해제) */}
      {isSunCameraVisible && (
        <SunCamera
          visible={isSunCameraVisible}
          onClose={() => setSunCameraVisible(false)}
          latitude={location?.coords.latitude || defaultCoords.latitude}
          longitude={location?.coords.longitude || defaultCoords.longitude}
          currentTime={currentTime}
          goldenTimeInfo={goldenTimeInfo}
        />
      )}

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
                <Camera size={28} color={dataColor.sunrise} />
              </View>
            </View>
            
            <Text style={[styles.warningTitle, { color: theme.text }]}>{t('waitingGoldenHour', language)}</Text>
            
            <Text style={[styles.warningMessage, { color: theme.subText }]}>
              {t('cameraWarningMessage', language)}
            </Text>

            <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
              <PressScale 
                onPress={() => setCameraWarningVisible(false)} 
                style={[styles.warningCancelBtn, { flex: 1, borderColor: theme.border }]}
                activeOpacity={0.8}
              >
                <Text style={[styles.warningConfirmText, { color: theme.text }]}>{t('cancel', language)}</Text>
              </PressScale>
              <PressScale 
                onPress={() => {
                  setCameraWarningVisible(false);
                  setSunCameraVisible(true);
                }} 
                style={[styles.warningConfirmBtn, { flex: 1, backgroundColor: theme.accent || color.sun }]}
                activeOpacity={0.8}
              >
                <Text style={[styles.warningConfirmText, { color: color.onAccent }]}>{t('enterAnyway', language)}</Text>
              </PressScale>
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

const useStyles = makeStyles((color) => ({
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
    color: color.textDim,
    marginTop: 15,
    fontSize: 14,
  },
  errorText: {
    color: color.danger,
    textAlign: 'center',
    padding: 20,
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: color.scrim,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  savedModal: {
    width: '100%',
    maxHeight: '75%',
    borderRadius: 4,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 18,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    paddingBottom: 10,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  savedScroll: {
    flexGrow: 0,
  },
  savedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  savedItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  savedName: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  savedCoords: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  deleteBtn: {
    padding: 6,
  },
  emptySaved: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  closeBtn: {
    padding: 4,
  },
  warningModal: {
    width: '88%',
    borderRadius: 4,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    elevation: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  warningIconContainer: {
    marginBottom: 14,
  },
  warningIconBg: {
    width: 48,
    height: 48,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 165, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 10,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  warningMessage: {
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  warningConfirmBtn: {
    paddingVertical: 10,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  warningCancelBtn: {
    paddingVertical: 10,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  warningConfirmText: {
    fontSize: 12.5,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.4,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: color.bg,
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
    color: color.text,
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textShadowColor: color.accentLine,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  appSubtitleText: {
    color: color.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2.5,
    marginTop: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
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
    backgroundColor: 'rgba(9, 13, 24, 0.88)',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: color.borderStrong,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  progressBarBg: {
    width: '100%',
    height: 4,
    backgroundColor: color.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: color.accent,
    borderRadius: 2,
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 2,
  },
  preloadStatusText: {
    color: color.textDim,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.5,
  },
  paperOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  capturedText: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 8,
    letterSpacing: 0.5,
  },
}));
