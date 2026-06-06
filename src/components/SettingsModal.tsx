import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, ScrollView, Platform, Linking, ActivityIndicator, TextInput, Animated, Dimensions } from 'react-native';
import { X, User, Shield, Info, ArrowRight, Camera, MapPin, CheckCircle2, AlertCircle, LogOut, KeyRound, Mail, Image, Mic } from 'lucide-react-native';
import * as CameraModule from 'expo-camera';
import * as Location from 'expo-location';
import { useCelestialStore } from '../store/useCelestialStore';
import { auth } from '../config/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';

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
  const [windowHeight] = useState(Dimensions.get('window').height);
  const slideAnim = useRef(new Animated.Value(windowHeight)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: windowHeight,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, windowHeight]);

  const { 
    currentUser,
    locationPermission,
    cameraPermission,
    mediaPermission,
    microphonePermission,
    checkPermissions,
    requestLocationPermission,
    requestCameraPermission,
    requestMediaPermission,
    requestMicrophonePermission,
  } = useCelestialStore();
  const [showLicenses, setShowLicenses] = useState(false);

  // Auth States
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUpActive, setIsSignUpActive] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auth Actions
  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      setAuthError('이메일과 비밀번호를 입력해주세요.');
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
      let friendlyMsg = err.message || '로그인에 실패했습니다.';
      if (err.code === 'auth/invalid-credential') {
        friendlyMsg = '이메일 또는 비밀번호가 올바르지 않습니다.';
      } else if (err.code === 'auth/invalid-email') {
        friendlyMsg = '올바르지 않은 이메일 형식입니다.';
      }
      setAuthError(friendlyMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignUp = async () => {
    if (!email.trim() || !password.trim()) {
      setAuthError('이메일과 비밀번호를 입력해주세요.');
      return;
    }
    if (password.length < 6) {
      setAuthError('비밀번호는 최소 6자리 이상이어야 합니다.');
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
      let friendlyMsg = err.message || '회원가입에 실패했습니다.';
      if (err.code === 'auth/email-already-in-use') {
        friendlyMsg = '이미 가입된 이메일 주소입니다.';
      } else if (err.code === 'auth/invalid-email') {
        friendlyMsg = '올바르지 않은 이메일 형식입니다.';
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
      setAuthError(err.message || '로그아웃에 실패했습니다.');
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

  const handleMicrophonePress = () => {
    if (microphonePermission === 'granted') return;
    if (microphonePermission === 'denied') {
      Linking.openSettings();
    } else {
      requestMicrophonePermission();
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
    { name: 'Expo', version: '54.0.33', license: 'MIT', url: 'https://expo.dev' },
    { name: 'Lucide React Native', version: '0.473.0', license: 'ISC', url: 'https://lucide.dev' },
    { name: 'Zustand', version: '5.0.3', license: 'MIT', url: 'https://zustand-demo.pmnd.rs' },
    { name: 'SunCalc', version: '1.9.0', license: 'BSD-2-Clause', url: 'https://github.com/mourner/suncalc' },
    { name: 'Date-fns', version: '4.1.0', license: 'MIT', url: 'https://date-fns.org' },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Animated.View style={[
          styles.modalContainer, 
          { 
            backgroundColor: theme.bg, 
            borderColor: theme.border,
            transform: [{ translateY: slideAnim }]
          }
        ]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Settings</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={20} color={theme.subText} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollPadding}>
            {/* 1. Account Section */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.subText }]}>Account</Text>
              
              {currentUser ? (
                /* Profile Card */
                <View style={[styles.card, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                  <View style={styles.profileRow}>
                    <View style={[styles.avatarCircle, { backgroundColor: theme.border }]}>
                      <User size={24} color={theme.accent} />
                    </View>
                    <View style={styles.profileInfo}>
                      <Text style={[styles.profileName, { color: theme.text }]} numberOfLines={1}>
                        {currentUser.email || 'Signed In User'}
                      </Text>
                      <Text style={[styles.profileDesc, { color: '#4CAF50', fontWeight: '700' }]}>
                        ✓ Cloud Sync Enabled
                      </Text>
                    </View>
                    <TouchableOpacity 
                      onPress={handleSignOut} 
                      disabled={isSubmitting}
                      style={[styles.signOutBtn, { backgroundColor: 'rgba(255,82,82,0.1)' }]}
                    >
                      {isSubmitting ? (
                        <ActivityIndicator size="small" color="#FF5252" />
                      ) : (
                        <LogOut size={16} color="#FF5252" />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                /* Auth Form */
                <View style={[styles.card, { backgroundColor: theme.glass, borderColor: theme.border, padding: 16, gap: 12 }]}>
                  <Text style={[styles.authTitle, { color: theme.text }]}>
                    {isSignUpActive ? 'Create Account' : 'Sign In'}
                  </Text>
                  
                  <View style={[styles.inputWrapper, { borderColor: theme.border, backgroundColor: theme.bg }]}>
                    <Mail size={16} color={theme.subText} />
                    <TextInput
                      style={[styles.input, { color: theme.text }]}
                      placeholder="Email"
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
                      placeholder="Password"
                      placeholderTextColor={theme.subText}
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                      autoCapitalize="none"
                    />
                  </View>

                  {authError && (
                    <View style={styles.errorContainer}>
                      <AlertCircle size={14} color="#FF5252" />
                      <Text style={styles.errorText}>{authError}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    onPress={isSignUpActive ? handleSignUp : handleSignIn}
                    disabled={isSubmitting}
                    style={[styles.authButton, { backgroundColor: theme.text }]}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator size="small" color={theme.bg} />
                    ) : (
                      <Text style={[styles.authButtonText, { color: theme.bg }]}>
                        {isSignUpActive ? 'Sign Up' : 'Sign In'}
                      </Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      setIsSignUpActive(!isSignUpActive);
                      setAuthError(null);
                    }}
                    style={styles.switchModeBtn}
                  >
                    <Text style={[styles.switchModeText, { color: theme.subText }]}>
                      {isSignUpActive 
                        ? 'Already have an account? Sign In' 
                        : "Don't have an account? Sign Up"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* 2. System Permissions Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: theme.subText }]}>App Permissions</Text>
              </View>

              <View style={[styles.card, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                {/* Camera Permission */}
                <TouchableOpacity 
                  style={[styles.permissionRow, { borderBottomColor: theme.border, borderBottomWidth: 0.5 }]}
                  onPress={handleCameraPress}
                  activeOpacity={0.7}
                >
                  <View style={styles.permIconContainer}>
                    <Camera size={16} color={theme.text} />
                    <Text style={[styles.permLabel, { color: theme.text }]}>Camera</Text>
                  </View>
                  <View style={styles.statusRow}>
                    {cameraPermission === 'granted' ? (
                      <View style={styles.badgeGranted}>
                        <CheckCircle2 size={12} color="#4CAF50" />
                        <Text style={styles.badgeTextGranted}>Granted</Text>
                      </View>
                    ) : (
                      <View style={styles.badgeDenied}>
                        <AlertCircle size={12} color="#FF5252" />
                        <Text style={styles.badgeTextDenied}>
                          {cameraPermission === 'denied' ? 'Denied' : 'Not Granted'}
                        </Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>

                {/* Storage & Media Permission */}
                <TouchableOpacity 
                  style={[styles.permissionRow, { borderBottomColor: theme.border, borderBottomWidth: 0.5 }]}
                  onPress={handleMediaPress}
                  activeOpacity={0.7}
                >
                  <View style={styles.permIconContainer}>
                    <Image size={16} color={theme.text} />
                    <Text style={[styles.permLabel, { color: theme.text }]}>Storage & Media</Text>
                  </View>
                  <View style={styles.statusRow}>
                    {mediaPermission === 'granted' ? (
                      <View style={styles.badgeGranted}>
                        <CheckCircle2 size={12} color="#4CAF50" />
                        <Text style={styles.badgeTextGranted}>Granted</Text>
                      </View>
                    ) : (
                      <View style={styles.badgeDenied}>
                        <AlertCircle size={12} color="#FF5252" />
                        <Text style={styles.badgeTextDenied}>
                          {mediaPermission === 'denied' ? 'Denied' : 'Not Granted'}
                        </Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>

                {/* Microphone Permission */}
                <TouchableOpacity 
                  style={[styles.permissionRow, { borderBottomColor: theme.border, borderBottomWidth: 0.5 }]}
                  onPress={handleMicrophonePress}
                  activeOpacity={0.7}
                >
                  <View style={styles.permIconContainer}>
                    <Mic size={16} color={theme.text} />
                    <Text style={[styles.permLabel, { color: theme.text }]}>Audio & Mic</Text>
                  </View>
                  <View style={styles.statusRow}>
                    {microphonePermission === 'granted' ? (
                      <View style={styles.badgeGranted}>
                        <CheckCircle2 size={12} color="#4CAF50" />
                        <Text style={styles.badgeTextGranted}>Granted</Text>
                      </View>
                    ) : (
                      <View style={styles.badgeDenied}>
                        <AlertCircle size={12} color="#FF5252" />
                        <Text style={styles.badgeTextDenied}>
                          {microphonePermission === 'denied' ? 'Denied' : 'Not Granted'}
                        </Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>

                {/* Location Permission */}
                <TouchableOpacity 
                  style={styles.permissionRow}
                  onPress={handleLocationPress}
                  activeOpacity={0.7}
                >
                  <View style={styles.permIconContainer}>
                    <MapPin size={16} color={theme.text} />
                    <Text style={[styles.permLabel, { color: theme.text }]}>Location</Text>
                  </View>
                  <View style={styles.statusRow}>
                    {locationPermission === 'granted' ? (
                      <View style={styles.badgeGranted}>
                        <CheckCircle2 size={12} color="#4CAF50" />
                        <Text style={styles.badgeTextGranted}>Granted</Text>
                      </View>
                    ) : (
                      <View style={styles.badgeDenied}>
                        <AlertCircle size={12} color="#FF5252" />
                        <Text style={styles.badgeTextDenied}>
                          {locationPermission === 'denied' ? 'Denied' : 'Not Granted'}
                        </Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>

                {/* System Settings Button */}
                <TouchableOpacity 
                  onPress={openSystemSettings}
                  style={[styles.settingsBtn, { backgroundColor: theme.border }]}
                >
                  <Shield size={14} color={theme.text} />
                  <Text style={[styles.settingsBtnText, { color: theme.text }]}>Manage system settings</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* 3. App Info & Version Section */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.subText }]}>About App</Text>
              <View style={[styles.card, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                <View style={[styles.infoRow, { borderBottomColor: theme.border, borderBottomWidth: 0.5 }]}>
                  <Text style={[styles.infoLabel, { color: theme.subText }]}>Version</Text>
                  <Text style={[styles.infoValue, { color: theme.text }]}>1.0.0 (Build 1)</Text>
                </View>

                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: theme.subText }]}>Identifier</Text>
                  <Text style={[styles.infoValue, { color: theme.text }]}>com.pplaner.beforeglow</Text>
                </View>

                {/* Open Source Licenses Trigger */}
                <TouchableOpacity 
                  onPress={() => setShowLicenses(prev => !prev)}
                  style={[styles.licensesToggle, { borderTopColor: theme.border, borderTopWidth: 0.5 }]}
                >
                  <View style={styles.licensesLabelRow}>
                    <Info size={14} color={theme.text} />
                    <Text style={[styles.licensesToggleText, { color: theme.text }]}>Open Source Licenses</Text>
                  </View>
                  <Text style={{ color: theme.accent, fontSize: 11, fontWeight: 'bold' }}>
                    {showLicenses ? 'HIDE' : 'SHOW'}
                  </Text>
                </TouchableOpacity>

                {/* Licenses List Accordion */}
                {showLicenses && (
                  <View style={[styles.licensesContainer, { backgroundColor: 'rgba(0,0,0,0.15)' }]}>
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
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    height: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  scrollContent: {
    flex: 1,
  },
  scrollPadding: {
    padding: 16,
    paddingBottom: 40,
    gap: 20,
  },
  section: {
    gap: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingLeft: 4,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInfo: {
    flex: 1,
    marginLeft: 12,
  },
  profileName: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  profileDesc: {
    fontSize: 11,
    marginTop: 2,
  },
  signOutBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    height: '100%',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,82,82,0.08)',
    padding: 10,
    borderRadius: 10,
  },
  errorText: {
    color: '#FF5252',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  authButton: {
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  authButtonText: {
    fontSize: 14,
    fontWeight: '800',
  },
  switchModeBtn: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  switchModeText: {
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
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
    fontSize: 14,
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgeGranted: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(76,175,80,0.1)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 4,
  },
  badgeTextGranted: {
    color: '#4CAF50',
    fontSize: 11,
    fontWeight: '800',
  },
  badgeDenied: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,82,82,0.1)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 4,
  },
  badgeTextDenied: {
    color: '#FF5252',
    fontSize: 11,
    fontWeight: '800',
  },
  settingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  settingsBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  infoLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  licensesToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  licensesLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  licensesToggleText: {
    fontSize: 13,
    fontWeight: '700',
  },
  licensesContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  licenseItem: {
    paddingVertical: 10,
  },
  licenseItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  libName: {
    fontSize: 12,
    fontWeight: '700',
  },
  libVersion: {
    fontSize: 11,
  },
  libLicense: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
});
