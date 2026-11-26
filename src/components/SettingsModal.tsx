import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Modal, ScrollView, Linking, Animated, Dimensions, PanResponder, TouchableWithoutFeedback } from 'react-native';
import { X, Shield, Info, Bell, Camera, MapPin, CheckCircle2, AlertCircle, Image, ExternalLink } from 'lucide-react-native';
import { useCelestialStore } from '../store/useCelestialStore';
import { t, L3 } from '../utils/i18n';
import { PressScale, Chip } from './ui';
import { DEFAULT_NOTIF_PREFS, LEAD_OPTIONS, type NotifPrefs } from '../utils/notificationPlan';
import { hasNotificationPermission } from '../utils/notificationScheduler';
import { PRIVACY_URL } from '../utils/accountDeletion';
import Constants from 'expo-constants';
import { springTo, timeTo } from '../theme/motion';
import { useThemeColors } from '../theme/useTheme';
import { useStyles } from './SettingsModal.styles';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  theme: any;
  dynamicTheme: any;
  /** "안내 다시 보기" — 처음 실행 안내(8번 화면)를 다시 엽니다. 없으면 이 줄을 그리지 않습니다. */
  onOpenGuide?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  visible,
  onClose,
  theme,
  dynamicTheme,
  onOpenGuide,
}) => {
  const color = useThemeColors(); const styles = useStyles();
  const [windowHeight] = useState(Dimensions.get('window').height);
  const slideAnim = useRef(new Animated.Value(windowHeight)).current;

  const handleClose = () => {
    timeTo(slideAnim, windowHeight, 'base', 'exit').start(onClose);
  };

  // 드래그 제스처로 닫기 위한 PanResponder
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // 아래로 드래그하는 경향이 뚜렷할 때 제스처 획득 (dy > 10)
        return Math.abs(gestureState.dy) > 10 && gestureState.dy > 0;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          slideAnim.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 120 || gestureState.vy > 0.5) {
          // 120px 이상 쓸어내렸거나 빠르게 휙 내렸을 때 닫기 실행
          handleClose();
        } else {
          // 덜 내렸으면 원래 위치로 통통 복귀
          springTo(slideAnim, 0, 'sheet').start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(windowHeight);
      springTo(slideAnim, 0, 'sheet').start();
    }
  }, [visible, windowHeight]);

  const { 
    locationPermission,
    cameraPermission,
    mediaPermission,
    checkPermissions,
    requestLocationPermission,
    requestCameraPermission,
    requestMediaPermission,
    isDebugMode,
    setDebugMode,
    language,
    setLanguage,
    themeMode,
    setThemeMode,
    statusBarIcon,
    setStatusBarIcon,
    graphicsQuality,
    setGraphicsQuality,
    notifPrefs: storedNotifPrefs,
    setNotifPref,
  } = useCelestialStore();
  const notifPrefs: NotifPrefs = { ...DEFAULT_NOTIF_PREFS, ...storedNotifPrefs };
  const [notifGranted, setNotifGranted] = useState<boolean | null>(null);
  useEffect(() => {
    if (visible) hasNotificationPermission(false).then(setNotifGranted);
  }, [visible]);
  const toggleNotif = async (key: keyof Omit<NotifPrefs, 'leadMin'>) => {
    const next = !notifPrefs[key];
    setNotifPref(key, next);
    // 켤 때 권한을 묻습니다(이미 허용이면 조용히 지나감).
    if (next) setNotifGranted(await hasNotificationPermission(true));
  };

  const [showLicenses, setShowLicenses] = useState(false);

  const handleLocationPress = () => {
    if (locationPermission === 'granted') return;
    if (locationPermission === 'denied') {
      Linking.openSettings();
    } else {
      requestLocationPermission();
    }
  };

  const handleCameraPress = () => {
    if (cameraPermission === 'granted') return;
    if (cameraPermission === 'denied') {
      Linking.openSettings();
    } else {
      requestCameraPermission();
    }
  };

  const handleMediaPress = () => {
    if (mediaPermission === 'granted') return;
    if (mediaPermission === 'denied') {
      Linking.openSettings();
    } else {
      requestMediaPermission();
    }
  };

  useEffect(() => {
    if (visible) {
      checkPermissions();
    }
  }, [visible, checkPermissions]);

  const openSystemSettings = () => {
    Linking.openSettings();
  };

  const licenses = [
    { name: 'React', version: '19.1.0', license: 'MIT', url: 'https://react.dev' },
    { name: 'React Native', version: '0.81.5', license: 'MIT', url: 'https://reactnative.dev' },
    { name: 'Expo', version: '54.0.35', license: 'MIT', url: 'https://expo.dev' },
    { name: 'Lucide React Native', version: '0.473.0', license: 'ISC', url: 'https://lucide.dev' },
    { name: 'Zustand', version: '5.0.3', license: 'MIT', url: 'https://zustand-demo.pmnd.rs' },
    { name: 'SunCalc', version: '1.9.0', license: 'BSD-2-Clause', url: 'https://github.com/mourner/suncalc' },
    { name: 'Date-fns', version: '4.1.0', license: 'MIT', url: 'https://date-fns.org' },
    { name: 'Open-Meteo API', version: 'Weather & Terrain Data', license: 'CC BY-NC 4.0 (Attribution Required)', url: 'https://open-meteo.com' },
    { name: 'Copernicus Atmosphere Monitoring Service (CAMS)', version: 'Air quality via Open-Meteo', license: 'Contains modified Copernicus Atmosphere Monitoring Service information', url: 'https://atmosphere.copernicus.eu' },
    { name: 'Google Maps API', version: 'Map SDK', license: 'Google Maps Terms of Service', url: 'https://developers.google.com/maps' },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <PressScale 
        style={styles.overlay} 
        activeOpacity={1} 
        onPress={handleClose}
      >
        <TouchableWithoutFeedback>
          <Animated.View style={[
            styles.modalContainer, 
            { 
              backgroundColor: theme.bg, 
              borderColor: theme.border,
              transform: [{ translateY: slideAnim }]
            }
          ]}>
            {/* 드래그 닫기 핸들 바 */}
            <View style={styles.dragHandleWrapper} {...panResponder.panHandlers}>
              <View style={[styles.dragHandle, { backgroundColor: theme.border }]} />
            </View>

            {/* Header */}
            <View style={[styles.header, { borderBottomColor: theme.border, paddingTop: 4 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={[styles.headerTitle, { color: theme.text }]}>
                  {t('settings', language)}
                </Text>
              </View>
              <PressScale onPress={handleClose} style={[styles.closeBtn, { backgroundColor: color.fill }]}>
                <X size={18} color={theme.subText} />
              </PressScale>
            </View>

            <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollPadding}>
              {/* 1. 언어 — 가장 자주 바꾸는 것부터(디자인 정리 2026-09-29) */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.subText }]}>{t('languageSetting', language)}</Text>
                <View style={[styles.card, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                  <View style={styles.langSelectorRow}>
                    <PressScale 
                      style={[
                        styles.langOption, 
                        language === 'ko' && { backgroundColor: color.accentSoft }
                      ]}
                      onPress={() => setLanguage('ko')}
                    >
                      <Text style={[styles.langText, { color: language === 'ko' ? color.accent : theme.text, fontWeight: language === 'ko' ? '800' : '500' }]}>한국어</Text>
                    </PressScale>
                    <PressScale 
                      style={[
                        styles.langOption, 
                        language === 'en' && { backgroundColor: color.accentSoft }
                      ]}
                      onPress={() => setLanguage('en')}
                    >
                      <Text style={[styles.langText, { color: language === 'en' ? color.accent : theme.text, fontWeight: language === 'en' ? '800' : '500' }]}>English</Text>
                    </PressScale>
                    <PressScale 
                      style={[
                        styles.langOption, 
                        language === 'ja' && { backgroundColor: color.accentSoft }
                      ]}
                      onPress={() => setLanguage('ja')}
                    >
                      <Text style={[styles.langText, { color: language === 'ja' ? color.accent : theme.text, fontWeight: language === 'ja' ? '800' : '500' }]}>日本語</Text>
                    </PressScale>
                  </View>
                </View>
              </View>

              {/* 1-b. 화면 모드 — 밝게는 패널·창·기록 탭·헤더만 밝힙니다. 하늘·지도 위와 촬영 화면은 늘 어둡습니다. */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.subText }]}>{L3(language, '화면 모드', 'Appearance', '表示モード')}</Text>
                <View style={[styles.card, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                  <View style={styles.langSelectorRow}>
                    {([
                      ['dark', L3(language, '어둡게', 'Dark', 'ダーク')],
                      ['light', L3(language, '밝게', 'Light', 'ライト')],
                      ['system', L3(language, '시스템', 'System', 'システム')],
                    ] as const).map(([mode, label]) => (
                      <PressScale
                        key={mode}
                        style={[styles.langOption, themeMode === mode && { backgroundColor: color.accentSoft }]}
                        onPress={() => setThemeMode(mode)}
                        accessibilityState={{ selected: themeMode === mode }}
                      >
                        <Text style={[styles.langText, { color: themeMode === mode ? color.accent : theme.text, fontWeight: themeMode === mode ? '800' : '500' }]}>{label}</Text>
                      </PressScale>
                    ))}
                  </View>
                </View>
                <Text style={[styles.modeHint, { color: theme.subText }]}>
                  {L3(language,
                    '하늘·지도 위와 촬영 화면은 그림 위에서 읽혀야 해서 늘 어둡습니다.',
                    'The sky, the map and the camera stay dark so their labels stay readable over the picture.',
                    '空・地図の上とカメラ画面は、絵の上で読めるよう常に暗いままです。')}
                </Text>
              </View>

              {/* 1-b2. 상단 알림바 아이콘 색 (배경은 검은색 고정) */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.subText }]}>{L3(language, '상단 알림바 아이콘', 'Status bar icons', 'ステータスバーアイコン')}</Text>
                <View style={[styles.card, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                  <View style={styles.langSelectorRow}>
                    {([
                      ['light', L3(language, '흰색 (밝게)', 'White', '白 (明るく)')],
                      ['dark', L3(language, '검은색 (어둡게)', 'Black', '黒 (暗く)')],
                    ] as const).map(([iconMode, label]) => (
                      <PressScale
                        key={iconMode}
                        style={[styles.langOption, statusBarIcon === iconMode && { backgroundColor: color.accentSoft }]}
                        onPress={() => setStatusBarIcon(iconMode)}
                        accessibilityState={{ selected: statusBarIcon === iconMode }}
                      >
                        <Text style={[styles.langText, { color: statusBarIcon === iconMode ? color.accent : theme.text, fontWeight: statusBarIcon === iconMode ? '800' : '500' }]}>{label}</Text>
                      </PressScale>
                    ))}
                  </View>
                </View>
              </View>

              {/* 1-b3. 시뮬레이션 화질 (고화질 / 저사양 도트 모드) */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.subText }]}>{L3(language, '시뮬레이션 화질', 'Simulation quality', 'シミュレーション画質')}</Text>
                <View style={[styles.card, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                  <View style={styles.langSelectorRow}>
                    {([
                      ['high', L3(language, '고화질', 'High quality', '高画質')],
                      ['low', L3(language, '저화질 (도트)', 'Low spec (Pixel)', '低画質 (ドット)')],
                    ] as const).map(([qMode, label]) => (
                      <PressScale
                        key={qMode}
                        style={[styles.langOption, graphicsQuality === qMode && { backgroundColor: color.accentSoft }]}
                        onPress={() => setGraphicsQuality(qMode)}
                        accessibilityState={{ selected: graphicsQuality === qMode }}
                      >
                        <Text style={[styles.langText, { color: graphicsQuality === qMode ? color.accent : theme.text, fontWeight: graphicsQuality === qMode ? '800' : '500' }]}>{label}</Text>
                      </PressScale>
                    ))}
                  </View>
                </View>
                <Text style={[styles.modeHint, { color: theme.subText }]}>
                  {L3(
                    language,
                    '저화질 모드는 도트 그래픽으로 그리며 구름 미세 결·추가 지형 마스크 연산과 데이터를 생략해 배터리와 데이터를 아낍니다.',
                    'Low-spec mode renders in pixel art and skips fine cloud detail & extra terrain mask downloads to save battery and data.',
                    '低画質モードはドット絵で描画し、雲の細部計算や追加データの取得を省略して負荷を抑えます。',
                  )}
                </Text>
              </View>

              {/* 1-c. 알림 — 노을·일출 예보 + 천체력으로 정해지는 하늘 이벤트(utils/notificationPlan.ts) */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.subText }]}>{L3(language, '알림', 'Notifications', '通知')}</Text>
                <View style={[styles.card, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                  {([
                    ['sunsetForecast', L3(language, '노을 예보', 'Sunset forecast', '夕焼け予報'), L3(language, '일몰 2시간 전 · 구름·색 예측', '2 h before sunset · clouds and colour', '日没2時間前・雲と色の予測')],
                    ['sunriseForecast', L3(language, '일출 예보', 'Sunrise forecast', '日の出予報'), L3(language, '전날 밤 10시 · 구름·색 예측', '10 pm the night before · clouds and colour', '前夜22時・雲と色の予測')],
                    ['goodOnly', L3(language, '좋음 이상만', 'Good days only', '良い日だけ'), L3(language, '노을·일출 예보를 좋음 이상으로 판정된 날만 · 02 학습과 같은 판정', 'Sunset and sunrise forecasts only when rated Good or better · same verdict as 02 Learn', '夕焼け・日の出予報を「良い」以上の日だけ・02 学習と同じ判定')],
                    ['golden', L3(language, '골든아워', 'Golden hour', 'ゴールデンアワー'), L3(language, '아침 일출 · 저녁 해 6°', 'Sunrise · evening sun at 6°', '朝の日の出・夕方の太陽6°')],
                    ['blue', L3(language, '블루아워', 'Blue hour', 'ブルーアワー'), L3(language, '해뜨기 전 · 해진 뒤 푸른 하늘', 'Blue sky before sunrise and after sunset', '日の出前・日没後の青い空')],
                    ['moonrise', L3(language, '월출', 'Moonrise', '月の出'), L3(language, '달이 뜰 때 · 밝기와 함께', 'When the Moon rises, with its phase', '月が昇るとき・輝面と一緒に')],
                    ['crescent', L3(language, '가는 달', 'Thin crescent', '細い月'), L3(language, '저녁 초승달 · 새벽 그믐달', 'Evening crescent · morning crescent', '夕方の三日月・明け方の有明月')],
                    ['milkyway', L3(language, '은하수', 'Milky Way', '天の川'), L3(language, '달빛 없는 어두운 밤', 'Dark, moonless nights', '月明かりのない暗い夜')],
                    ['planets', L3(language, '보이는 행성', 'Planets up', '見える惑星'), L3(language, '박명 뒤 떠 있는 행성', 'Planets above the horizon after dusk', '薄明後に昇っている惑星')],
                  ] as const).map(([key, title, desc], idx) => {
                    const on = notifPrefs[key];
                    return (
                      <PressScale
                        key={key}
                        style={[styles.notifRow, idx > 0 && { borderTopWidth: 1, borderTopColor: theme.border }]}
                        onPress={() => toggleNotif(key)}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: on }}
                      >
                        <View style={styles.notifText}>
                          <Text style={[styles.notifTitle, { color: theme.text }]}>{title}</Text>
                          <Text style={[styles.notifDesc, { color: theme.subText }]} numberOfLines={2}>{desc}</Text>
                        </View>
                        <View style={[styles.notifPill, on ? { backgroundColor: color.accent } : { backgroundColor: color.fill, borderColor: color.border, borderWidth: 1 }]}>
                          <Text style={[styles.notifPillText, { color: on ? color.onAccent : theme.subText }]}>{on ? 'ON' : 'OFF'}</Text>
                        </View>
                      </PressScale>
                    );
                  })}
                  <View style={[styles.notifLeadRow, { borderTopColor: theme.border }]}>
                    <Text style={[styles.notifDesc, { color: theme.subText, marginBottom: 8 }]}>
                      {L3(language, '하늘 이벤트 알림 시점', 'Sky event alerts', '空のイベント通知のタイミング')}
                    </Text>
                    <View style={styles.notifLeadChips}>
                      {LEAD_OPTIONS.map((m) => (
                        <Chip
                          key={m}
                          on={notifPrefs.leadMin === m}
                          onPress={() => setNotifPref('leadMin', m)}
                          label={m === 0 ? L3(language, '정각', 'On time', '時刻どおり') : m === 60 ? L3(language, '1시간 전', '1 h before', '1時間前') : L3(language, `${m}분 전`, `${m} min before`, `${m}分前`)}
                        />
                      ))}
                    </View>
                  </View>
                </View>
                {notifGranted === false && (
                  <PressScale onPress={() => Linking.openSettings()} style={[styles.notifWarn, { backgroundColor: color.dangerSoft }]}>
                    <Bell size={13} color={color.danger} />
                    <Text style={[styles.notifDesc, { color: color.danger, flex: 1 }]}>
                      {L3(language, '알림 권한이 꺼져 있어 알림이 오지 않습니다. 눌러서 시스템 설정을 엽니다.', 'Notifications are off for this app. Tap to open system settings.', '通知が許可されていません。タップしてシステム設定を開きます。')}
                    </Text>
                  </PressScale>
                )}
              </View>

              {/* 2. 앱 권한 */}
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={[styles.sectionTitle, { color: theme.subText }]}>{t('appPermissions', language)}</Text>
                </View>

                <View style={[styles.card, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                  {/* Camera Permission */}
                  <PressScale 
                    style={[styles.permissionRow, { borderBottomColor: theme.border, borderBottomWidth: 0.5 }]}
                    onPress={handleCameraPress}
                    activeOpacity={0.7}
                  >
                    <View style={styles.permIconContainer}>
                      <Camera size={16} color={theme.text} />
                      <Text style={[styles.permLabel, { color: theme.text }]}>{t('camera', language)}</Text>
                    </View>
                    <View style={styles.statusRow}>
                      {cameraPermission === 'granted' ? (
                        <View style={styles.badgeGranted}>
                          <CheckCircle2 size={12} color={color.success} />
                          <Text style={styles.badgeTextGranted}>{t('granted', language)}</Text>
                        </View>
                      ) : (
                        <View style={styles.badgeDenied}>
                          <AlertCircle size={12} color={color.danger} />
                          <Text style={styles.badgeTextDenied}>
                            {cameraPermission === 'denied' ? t('denied', language) : t('notGranted', language)}
                          </Text>
                        </View>
                      )}
                    </View>
                  </PressScale>

                  {/* Storage & Media Permission */}
                  <PressScale 
                    style={[styles.permissionRow, { borderBottomColor: theme.border, borderBottomWidth: 0.5 }]}
                    onPress={handleMediaPress}
                    activeOpacity={0.7}
                  >
                    <View style={styles.permIconContainer}>
                      <Image size={16} color={theme.text} />
                      <Text style={[styles.permLabel, { color: theme.text }]}>{t('storageMedia', language)}</Text>
                    </View>
                    <View style={styles.statusRow}>
                      {mediaPermission === 'granted' ? (
                        <View style={styles.badgeGranted}>
                          <CheckCircle2 size={12} color={color.success} />
                          <Text style={styles.badgeTextGranted}>{t('granted', language)}</Text>
                        </View>
                      ) : (
                        <View style={styles.badgeDenied}>
                          <AlertCircle size={12} color={color.danger} />
                          <Text style={styles.badgeTextDenied}>
                            {mediaPermission === 'denied' ? t('denied', language) : t('notGranted', language)}
                          </Text>
                        </View>
                      )}
                    </View>
                  </PressScale>

                  {/* 마이크 줄은 뺐습니다 — 앱은 소리를 녹음하지 않고, 매니페스트에서도 RECORD_AUDIO 를
                      지웠습니다(app.config.js, 점검 2026-09-29). */}
                  {/* Location Permission */}
                  <PressScale 
                    style={styles.permissionRow}
                    onPress={handleLocationPress}
                    activeOpacity={0.7}
                  >
                    <View style={styles.permIconContainer}>
                      <MapPin size={16} color={theme.text} />
                      <Text style={[styles.permLabel, { color: theme.text }]}>{t('location', language)}</Text>
                    </View>
                    <View style={styles.statusRow}>
                      {locationPermission === 'granted' ? (
                        <View style={styles.badgeGranted}>
                          <CheckCircle2 size={12} color={color.success} />
                          <Text style={styles.badgeTextGranted}>{t('granted', language)}</Text>
                        </View>
                      ) : (
                        <View style={styles.badgeDenied}>
                          <AlertCircle size={12} color={color.danger} />
                          <Text style={styles.badgeTextDenied}>
                            {locationPermission === 'denied' ? t('denied', language) : t('notGranted', language)}
                          </Text>
                        </View>
                      )}
                    </View>
                  </PressScale>

                  {/* System Settings Button */}
                  <PressScale 
                    onPress={openSystemSettings}
                    style={[styles.settingsBtn, { backgroundColor: theme.border }]}
                  >
                    <Shield size={14} color={theme.text} />
                    <Text style={[styles.settingsBtnText, { color: theme.text }]}>{t('manageSystemSettings', language)}</Text>
                  </PressScale>
                </View>
              </View>

              {/* 3. 앱 정보 */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.subText }]}>{t('aboutApp', language)}</Text>
                <View style={[styles.card, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                  {/* 처음 실행 안내(8번 화면)를 다시 엽니다 */}
                  {onOpenGuide && (
                    <PressScale
                      style={[styles.infoRow, { borderBottomColor: theme.border, borderBottomWidth: 0.5 }]}
                      onPress={onOpenGuide}
                      accessibilityLabel={L3(language, '안내 다시 보기', 'Replay the guide', '案内をもう一度見る')}
                    >
                      <Text style={[styles.infoLabel, { color: theme.subText }]}>{L3(language, '안내 다시 보기', 'Replay the guide', '案内をもう一度見る')}</Text>
                      <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '700' }}>{L3(language, '열기', 'Open', '開く')}</Text>
                    </PressScale>
                  )}
                  <View style={[styles.infoRow, { borderBottomColor: theme.border, borderBottomWidth: 0.5 }]}>
                    <Text style={[styles.infoLabel, { color: theme.subText }]}>{t('version', language)}</Text>
                    <Text style={[styles.infoValue, { color: theme.text }]}>{Constants.expoConfig?.version ?? '—'}</Text>
                  </View>

                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: theme.subText }]}>{t('identifier', language)}</Text>
                    <Text style={[styles.infoValue, { color: theme.text }]}>com.pplaner.beforeglow</Text>
                  </View>

                  {/* 개인정보처리방침(웹) — 스토어 등록 정보와 같은 주소 */}
                  <PressScale style={[styles.infoRow, { borderBottomColor: theme.border, borderBottomWidth: 0.5 }]} onPress={() => Linking.openURL(PRIVACY_URL)}>
                    <Text style={[styles.infoLabel, { color: theme.subText }]}>{L3(language, '개인정보처리방침', 'Privacy policy', 'プライバシーポリシー')}</Text>
                    <ExternalLink size={14} color={theme.subText} />
                  </PressScale>

                  {/* Open Source Licenses Trigger */}
                  <PressScale 
                    onPress={() => setShowLicenses(prev => !prev)}
                    style={[styles.licensesToggle, { borderTopColor: theme.border, borderTopWidth: 0.5 }]}
                  >
                    <View style={styles.licensesLabelRow}>
                      <Info size={14} color={theme.text} />
                      <Text style={[styles.licensesToggleText, { color: theme.text }]}>{t('openSourceLicenses', language)}</Text>
                    </View>
                    <Text style={{ color: theme.accent, fontSize: 11, fontWeight: '700' }}>
                      {showLicenses ? 'HIDE' : 'SHOW'}
                    </Text>
                  </PressScale>

                  {/* Licenses List Accordion */}
                  {showLicenses && (
                    <View style={[styles.licensesContainer, { backgroundColor: color.fill }]}>
                      {licenses.map((lib, idx) => (
                        <View 
                          key={lib.name} 
                          style={[
                            styles.licenseItem, 
                            idx < licenses.length - 1 && { borderBottomColor: theme.border, borderBottomWidth: 0.5 }
                          ]}
                        >
                          <View style={styles.licenseItemHeader}>
                            <Text style={[styles.libName, { color: theme.text }]}>{lib.name}</Text>
                            <Text style={[styles.libVersion, { color: theme.subText }]}>v{lib.version}</Text>
                          </View>
                          <Text style={styles.libLicense}>License: {lib.license}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>

              {/* 개발자 옵션 — 개발 빌드에서만, 맨 아래 */}
              {__DEV__ && (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: theme.subText }]}>{t('developerOptions', language)}</Text>
                  <View style={[styles.card, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                    <PressScale 
                      style={styles.permissionRow}
                      onPress={() => setDebugMode(!isDebugMode)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.permIconContainer}>
                        <Info size={16} color={theme.text} />
                        <Text style={[styles.permLabel, { color: theme.text }]}>{t('simulationDebugMode', language)}</Text>
                      </View>
                      <View style={styles.statusRow}>
                        {isDebugMode ? (
                          <View style={styles.badgeGranted}>
                            <CheckCircle2 size={12} color={color.success} />
                            <Text style={styles.badgeTextGranted}>ON</Text>
                          </View>
                        ) : (
                          <View style={styles.badgeDenied}>
                            <AlertCircle size={12} color={color.danger} />
                            <Text style={styles.badgeTextDenied}>OFF</Text>
                          </View>
                        )}
                      </View>
                    </PressScale>
                  </View>
                </View>
              )}
            </ScrollView>
          </Animated.View>
        </TouchableWithoutFeedback>
      </PressScale>
    </Modal>
  );
};
