import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, Modal, ScrollView, Platform, Linking, ActivityIndicator, TextInput, Animated, Dimensions, PanResponder, TouchableWithoutFeedback } from 'react-native';
import { X, User, Shield, Info, ArrowRight, Camera, MapPin, CheckCircle2, AlertCircle, LogOut, KeyRound, Mail, Image, Globe, Compass, Cloud, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react-native';
import * as CameraModule from 'expo-camera';
import * as Location from 'expo-location';
import { useCelestialStore } from '../store/useCelestialStore';
import { auth } from '../config/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { t, L3 } from '../utils/i18n';
import { color, radius, mono, tint } from '../theme/tokens';
import { PressScale } from './ui';
import { springTo, timeTo } from '../theme/motion';
import { makeStyles, useThemeColors } from '../theme/useTheme';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  theme: any;
  dynamicTheme: any;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  visible,
  onClose,
  theme,
  dynamicTheme,
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
    currentUser,
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
  } = useCelestialStore();
  const [showLicenses, setShowLicenses] = useState(false);
  const [showPortal, setShowPortal] = useState(false);

  // Auth States
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUpActive, setIsSignUpActive] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auth Actions
  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      setAuthError(t('emailPasswordRequired', language));
      return;
    }
    try {
      setIsSubmitting(true);
      setAuthError(null);
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setEmail('');
      setPassword('');
    } catch (err: any) {
      console.warn('Failed to sign in:', err);
      let friendlyMsg = err.message || t('signInFailed', language);
      if (err.code === 'auth/invalid-credential') {
        friendlyMsg = t('invalidCredentials', language);
      } else if (err.code === 'auth/invalid-email') {
        friendlyMsg = t('invalidEmailFormat', language);
      }
      setAuthError(friendlyMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignUp = async () => {
    if (!email.trim() || !password.trim()) {
      setAuthError(t('emailPasswordRequired', language));
      return;
    }
    if (password.length < 8) {
      setAuthError(t('passwordMinLength', language));
      return;
    }
    const hasUppercase = /[A-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    if (!hasUppercase || !hasNumber || !hasSpecial) {
      setAuthError(t('passwordComplexity', language));
      return;
    }
    try {
      setIsSubmitting(true);
      setAuthError(null);
      await createUserWithEmailAndPassword(auth, email.trim(), password);
      setEmail('');
      setPassword('');
      setIsSignUpActive(false);
    } catch (err: any) {
      console.warn('Failed to sign up:', err);
      let friendlyMsg = err.message || t('signUpFailed', language);
      if (err.code === 'auth/email-already-in-use') {
        friendlyMsg = t('emailAlreadyInUse', language);
      } else if (err.code === 'auth/invalid-email') {
        friendlyMsg = t('invalidEmailFormat', language);
      }
      setAuthError(friendlyMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      setIsSubmitting(true);
      setAuthError(null);
      await signOut(auth);
    } catch (err: any) {
      console.warn('Failed to sign out:', err);
      setAuthError(err.message || t('signOut', language));
    } finally {
      setIsSubmitting(false);
    }
  };

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
      setShowPortal(false);
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
              {showPortal && (
                <PressScale onPress={() => setShowPortal(false)} style={styles.backBtn}>
                  <ChevronLeft size={20} color={theme.text} />
                </PressScale>
              )}
              <Text style={[styles.headerTitle, { color: theme.text, marginLeft: showPortal ? 8 : 0 }]}>
                {showPortal ? t('tabPortalLinks', language) : t('settings', language)}
              </Text>
            </View>
            <PressScale onPress={handleClose} style={styles.closeBtn}>
              <X size={20} color={theme.subText} />
            </PressScale>
          </View>

          {showPortal ? (
            <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollPadding}>
              <View style={styles.portalContainer}>
                {/* PPLANER Portal */}
                <View style={[styles.portalMainCard, { borderColor: theme.border, backgroundColor: 'rgba(255, 215, 0, 0.03)' }]}>
                  <View style={styles.portalCardHeader}>
                    <Globe size={20} color={theme.accent} style={{ marginRight: 8 }} />
                    <Text style={[styles.portalCardTitle, { color: theme.text }]}>{t('portalTitle', language)}</Text>
                  </View>
                  <Text style={[styles.portalCardDesc, { color: theme.subText }]}>
                    {t('portalDesc', language)}
                  </Text>
                  <PressScale 
                    style={[styles.portalLinkBtn, { backgroundColor: theme.accent }]}
                    onPress={() => Linking.openURL('https://pplaner.com')}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.portalLinkBtnText}>{t('visitSite', language)}</Text>
                    <ExternalLink size={14} color={color.onAccent} style={{ marginLeft: 4 }} />
                  </PressScale>
                </View>

                {/* Sister Sites Header */}
                <Text style={[styles.portalSectionHeader, { color: theme.text }]}>
                  🔗 {t('sisterSitesTitle', language)}
                </Text>

                {/* JP Rail Planner */}
                <View style={[styles.portalSubCard, { borderColor: theme.border }]}>
                  <View style={styles.portalCardHeader}>
                    <Compass size={18} color="#FF6347" style={{ marginRight: 8 }} />
                    <Text style={[styles.portalSubCardTitle, { color: theme.text }]}>{t('sisterJpRailTitle', language)}</Text>
                  </View>
                  <Text style={[styles.portalCardDesc, { color: theme.subText }]}>
                    {t('sisterJpRailDesc', language)}
                  </Text>
                  <PressScale 
                    style={[styles.portalSubLinkBtn, { backgroundColor: theme.border }]}
                    onPress={() => Linking.openURL('https://jprail.pplaner.com')}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.portalSubLinkBtnText, { color: theme.text }]}>{t('visitSite', language)}</Text>
                    <ExternalLink size={12} color={theme.text} style={{ marginLeft: 4 }} />
                  </PressScale>
                </View>

                {/* RG Nevel Planner */}
                <View style={[styles.portalSubCard, { borderColor: theme.border }]}>
                  <View style={styles.portalCardHeader}>
                    <Cloud size={18} color="#20B2AA" style={{ marginRight: 8 }} />
                    <Text style={[styles.portalSubCardTitle, { color: theme.text }]}>{t('sisterRgNevelTitle', language)}</Text>
                  </View>
                  <Text style={[styles.portalCardDesc, { color: theme.subText }]}>
                    {t('sisterRgNevelDesc', language)}
                  </Text>
                  <PressScale 
                    style={[styles.portalSubLinkBtn, { backgroundColor: theme.border }]}
                    onPress={() => Linking.openURL('https://rgnevel.pplaner.com')}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.portalSubLinkBtnText, { color: theme.text }]}>{t('visitSite', language)}</Text>
                    <ExternalLink size={12} color={theme.text} style={{ marginLeft: 4 }} />
                  </PressScale>
                </View>
              </View>
            </ScrollView>
          ) : (
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

              {/* 3. 계정 · 패밀리 서비스 */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.subText }]}>{t('account', language)}</Text>
                
                {currentUser ? (
                  /* Profile Card */
                  <View style={[styles.card, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                    <View style={styles.profileRow}>
                      <View style={[styles.avatarCircle, { backgroundColor: theme.border }]}>
                        <User size={24} color={theme.accent} />
                      </View>
                      <View style={styles.profileInfo}>
                        <Text style={[styles.profileName, { color: theme.text }]} numberOfLines={1}>
                          {currentUser.email || t('signedInUser', language)}
                        </Text>
                        <Text style={[styles.profileDesc, { color: color.success, fontWeight: '700' }]}>
                          {t('cloudSyncEnabled', language)}
                        </Text>
                      </View>
                      <PressScale 
                        onPress={handleSignOut} 
                        disabled={isSubmitting}
                        style={[styles.signOutBtn, { backgroundColor: color.dangerSoft }]}
                      >
                        {isSubmitting ? (
                          <ActivityIndicator size="small" color={color.danger} />
                        ) : (
                          <LogOut size={16} color={color.danger} />
                        )}
                      </PressScale>
                    </View>
                  </View>
                ) : (
                  /* Auth Form */
                  <View style={[styles.card, { backgroundColor: theme.glass, borderColor: theme.border, padding: 16, gap: 12 }]}>
                    <Text style={[styles.authTitle, { color: theme.text }]}>
                      {isSignUpActive ? t('createAccount', language) : t('signIn', language)}
                    </Text>
                    
                    <View style={[styles.inputWrapper, { borderColor: theme.border, backgroundColor: theme.bg }]}>
                       <Mail size={16} color={theme.subText} />
                      <TextInput
                        style={[styles.input, { color: theme.text }]}
                        placeholder={t('email', language)}
                        placeholderTextColor={theme.subText}
                        value={email}
                        onChangeText={setEmail}
                        autoCapitalize="none"
                        keyboardType="email-address"
                      />
                    </View>

                    <View style={[styles.inputWrapper, { borderColor: theme.border, backgroundColor: theme.bg }]}>
                      <KeyRound size={16} color={theme.subText} />
                      <TextInput
                        style={[styles.input, { color: theme.text }]}
                        placeholder={t('password', language)}
                        placeholderTextColor={theme.subText}
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                        autoCapitalize="none"
                      />
                    </View>
                    {isSignUpActive && password.length > 0 && (
                      <View style={styles.passwordHintContainer}>
                        <Text style={[styles.passwordHintText, { color: password.length >= 8 ? color.success : color.danger }]}>
                          {password.length >= 8 ? '✓' : '✗'} {t('passwordMinLengthHint', language)}
                        </Text>
                        <Text style={[styles.passwordHintText, { color: (/[A-Z]/.test(password) && /[0-9]/.test(password) && /[!@#$%^&*(),.?":{}|<>]/.test(password)) ? color.success : color.danger }]}>
                          {(/[A-Z]/.test(password) && /[0-9]/.test(password) && /[!@#$%^&*(),.?":{}|<>]/.test(password)) ? '✓' : '✗'} {t('passwordComplexityHint', language)}
                        </Text>
                      </View>
                    )}

                    {authError && (
                      <View style={styles.errorContainer}>
                        <AlertCircle size={14} color={color.danger} />
                        <Text style={styles.errorText}>{authError}</Text>
                      </View>
                    )}

                    <PressScale
                      onPress={isSignUpActive ? handleSignUp : handleSignIn}
                      disabled={isSubmitting}
                      style={[styles.authButton, { backgroundColor: color.accent }]}
                    >
                      {isSubmitting ? (
                        <ActivityIndicator size="small" color={color.onAccent} />
                      ) : (
                        <Text style={[styles.authButtonText, { color: color.onAccent }]}>
                          {isSignUpActive ? t('signUp', language) : t('signIn', language)}
                        </Text>
                      )}
                    </PressScale>

                    <PressScale
                      onPress={() => {
                        setIsSignUpActive(!isSignUpActive);
                        setAuthError(null);
                      }}
                      style={styles.switchModeBtn}
                    >
                      <Text style={[styles.switchModeText, { color: theme.subText }]}>
                        {isSignUpActive 
                          ? t('alreadyHaveAccount', language) 
                          : t('dontHaveAccount', language)}
                      </Text>
                    </PressScale>
                  </View>
                )}

                {/* Family Services Link */}
                <PressScale 
                  style={[styles.portalLinkRow, { backgroundColor: theme.glass, borderColor: theme.border }]}
                  onPress={() => setShowPortal(true)}
                  activeOpacity={0.7}
                >
                  <View style={styles.portalLinkLeft}>
                    <Globe size={18} color={theme.accent} />
                    <Text style={[styles.portalLinkLabel, { color: theme.text }]}>
                      {t('tabPortalLinks', language)}
                    </Text>
                  </View>
                  <ChevronRight size={16} color={theme.subText} />
                </PressScale>
              </View>

              {/* 4. 앱 정보 */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: theme.subText }]}>{t('aboutApp', language)}</Text>
                <View style={[styles.card, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                  <View style={[styles.infoRow, { borderBottomColor: theme.border, borderBottomWidth: 0.5 }]}>
                    <Text style={[styles.infoLabel, { color: theme.subText }]}>{t('version', language)}</Text>
                    <Text style={[styles.infoValue, { color: theme.text }]}>1.0.0 (Build 1)</Text>
                  </View>

                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: theme.subText }]}>{t('identifier', language)}</Text>
                    <Text style={[styles.infoValue, { color: theme.text }]}>com.pplaner.beforeglow</Text>
                  </View>

                  {/* Open Source Licenses Trigger */}
                  <PressScale 
                    onPress={() => setShowLicenses(prev => !prev)}
                    style={[styles.licensesToggle, { borderTopColor: theme.border, borderTopWidth: 0.5 }]}
                  >
                    <View style={styles.licensesLabelRow}>
                      <Info size={14} color={theme.text} />
                      <Text style={[styles.licensesToggleText, { color: theme.text }]}>{t('openSourceLicenses', language)}</Text>
                    </View>
                    <Text style={{ color: theme.accent, fontSize: 11, fontWeight: 'bold' }}>
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
          )}
          </Animated.View>
        </TouchableWithoutFeedback>
      </PressScale>
    </Modal>
  );
};

const useStyles = makeStyles((color) => ({
  modeHint: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  overlay: {
    flex: 1,
    backgroundColor: color.scrim,
    justifyContent: 'flex-end',
  },
  dragHandleWrapper: {
    width: '100%',
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 8,
  },
  dragHandle: {
    width: 32,
    height: 2,
    borderRadius: 1,
  },
  modalContainer: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderWidth: 1,
    height: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    flex: 1,
  },
  scrollPadding: {
    padding: 14,
    paddingBottom: 40,
    gap: 16,
  },
  section: {
    gap: 6,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingLeft: 2,
    fontFamily: mono,
  },
  card: {
    borderRadius: radius.xs,
    borderWidth: 1,
    overflow: 'hidden',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInfo: {
    flex: 1,
    marginLeft: 12,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  profileDesc: {
    fontSize: 11,
    marginTop: 2,
    fontFamily: mono,
  },
  signOutBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  authTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.xs,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    height: '100%',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: color.dangerSoft,
    padding: 8,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: tint(color.danger, 0.3),
  },
  errorText: {
    color: color.danger,
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
    fontFamily: mono,
  },
  authButton: {
    borderRadius: radius.xs,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  authButtonText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
    fontFamily: mono,
  },
  switchModeBtn: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  switchModeText: {
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  passwordHintContainer: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    gap: 4,
  },
  passwordHintText: {
    fontSize: 13,
    fontWeight: '600',
  },
  actionArrow: {
    padding: 4,
  },
  permissionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  permIconContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  permLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgeGranted: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: tint(color.success, 0.12),
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: tint(color.success, 0.3),
    gap: 4,
  },
  badgeTextGranted: {
    color: color.success,
    fontSize: 11,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.3,
  },
  badgeDenied: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.dangerSoft,
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.dangerSoft,
    gap: 4,
  },
  badgeTextDenied: {
    color: color.danger,
    fontSize: 11,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.3,
  },
  settingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 6,
  },
  settingsBtnText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: mono,
  },
  portalLinkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.xs,
    borderWidth: 1,
    marginTop: 8,
  },
  portalLinkLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  portalLinkLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  portalContainer: {
    paddingHorizontal: 4,
    paddingVertical: 8,
    gap: 14,
  },
  portalMainCard: {
    borderRadius: radius.xs,
    borderWidth: 1,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  portalSubCard: {
    borderRadius: radius.xs,
    borderWidth: 1,
    padding: 12,
    backgroundColor: color.fill,
  },
  portalCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  portalCardTitle: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  portalSubCardTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  portalCardDesc: {
    fontSize: 11,
    lineHeight: 15,
    opacity: 0.8,
    marginBottom: 10,
  },
  portalLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: radius.xs,
    marginTop: 4,
  },
  portalLinkBtnText: {
    fontSize: 11,
    fontWeight: '900',
    color: color.onAccent,
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  portalSubLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
  },
  portalSubLinkBtnText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: mono,
  },
  portalSectionHeader: {
    fontSize: 11,
    fontWeight: '900',
    marginTop: 6,
    marginBottom: 2,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: mono,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  infoLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: mono,
  },
  licensesToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  licensesLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  licensesToggleText: {
    fontSize: 13,
    fontWeight: '800',
  },
  licensesContainer: {
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  licenseItem: {
    paddingVertical: 8,
  },
  licenseItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  libName: {
    fontSize: 11,
    fontWeight: '800',
  },
  libVersion: {
    fontSize: 11,
    fontFamily: mono,
  },
  libLicense: {
    fontSize: 9,
    color: color.textMute,
    marginTop: 2,
    fontFamily: mono,
  },
  langSelectorRow: {
    flexDirection: 'row',
    padding: 3,
    gap: 4,
  },
  langOption: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  langText: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: mono,
  },
}));
