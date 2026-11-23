import React, { useState } from 'react';
import { View, Text, TextInput, ActivityIndicator, Alert } from 'react-native';
import { User, CheckCircle2, AlertCircle, LogOut, KeyRound, Mail, Globe, ChevronRight } from 'lucide-react-native';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../config/firebase';
import { useCelestialStore } from '../store/useCelestialStore';
import { t, L3, type Language } from '../utils/i18n';
import { deleteAccountAndData } from '../utils/accountDeletion';
import { PressScale } from './ui';
import { useThemeColors } from '../theme/useTheme';
import { useStyles } from './SettingsModal.styles';

interface SettingsAccountSectionProps {
  currentUser: ReturnType<typeof useCelestialStore.getState>['currentUser'];
  language: Language;
  theme: any;
  onOpenPortal: () => void;
}

export const SettingsAccountSection: React.FC<SettingsAccountSectionProps> = ({
  currentUser,
  language,
  theme,
  onOpenPortal,
}) => {
  const color = useThemeColors();
  const styles = useStyles();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUpActive, setIsSignUpActive] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  // 앱 안 계정 삭제(Play 정책) — 확인을 한 번 받고, 서버 데이터 → 계정 순으로 지웁니다(utils/accountDeletion.ts).
  const runDeleteAccount = async () => {
    setIsSubmitting(true);
    setAuthError(null);
    const res = await deleteAccountAndData();
    setIsSubmitting(false);
    if (res.ok) {
      useCelestialStore.setState({ myPhotos: [], savedLocations: [] });
      Alert.alert(
        L3(language, '계정을 삭제했습니다', 'Account deleted', 'アカウントを削除しました'),
        L3(language, `사진·장소 기록 ${res.docs}건과 파일 ${res.files}개를 지웠습니다.`, `Removed ${res.docs} records and ${res.files} files.`, `記録${res.docs}件とファイル${res.files}個を削除しました。`),
      );
    } else if (res.reason === 'requires-recent-login') {
      setAuthError(L3(language,
        '데이터는 지웠습니다. 보안을 위해 다시 로그인한 뒤 한 번 더 눌러 계정을 삭제해 주세요.',
        'Your data is deleted. For security, sign in again and tap once more to delete the account.',
        'データは削除しました。安全のため再ログイン後、もう一度押してアカウントを削除してください。'));
    } else {
      setAuthError(L3(language, '삭제하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.', 'Could not delete. Check your connection and try again.', '削除できませんでした。接続を確認して再度お試しください。') + (res.message ? ` (${res.message})` : ''));
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      L3(language, '계정을 삭제할까요?', 'Delete your account?', 'アカウントを削除しますか？'),
      L3(language,
        '올린 사진(전역 갤러리 포함), 저장한 장소, 로그인 정보가 서버에서 영구히 지워집니다. 되돌릴 수 없습니다.',
        'Your uploaded photos (including the public gallery), saved places and sign-in are permanently removed from our servers. This cannot be undone.',
        'アップロードした写真（公開ギャラリーを含む）、保存した場所、ログイン情報がサーバーから完全に削除されます。元に戻せません。'),
      [
        { text: L3(language, '취소', 'Cancel', 'キャンセル'), style: 'cancel' },
        { text: L3(language, '삭제', 'Delete', '削除'), style: 'destructive', onPress: runDeleteAccount },
      ],
    );
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

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.subText }]}>{t('account', language)}</Text>

      {currentUser ? (
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
          {currentUser && !currentUser.isAnonymous && (
            <PressScale onPress={handleDeleteAccount} disabled={isSubmitting} style={[styles.deleteAccountRow, { borderTopColor: theme.border }]}>
              <Text style={[styles.deleteAccountText, { color: color.danger }]}>{L3(language, '계정 삭제', 'Delete account', 'アカウントを削除')}</Text>
              <Text style={[styles.notifDesc, { color: theme.subText }]}>{L3(language, '사진·장소·로그인 정보를 서버에서 지웁니다', 'Removes your photos, places and sign-in from our servers', '写真・場所・ログイン情報をサーバーから削除します')}</Text>
            </PressScale>
          )}
          {authError && currentUser && !currentUser.isAnonymous ? (
            <Text style={[styles.notifDesc, { color: color.danger, paddingHorizontal: 14, paddingBottom: 12 }]}>{authError}</Text>
          ) : null}
        </View>
      ) : (
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
              {[
                { ok: password.length >= 8, text: t('passwordMinLengthHint', language) },
                { ok: /[A-Z]/.test(password) && /[0-9]/.test(password) && /[!@#$%^&*(),.?":{}|<>]/.test(password), text: t('passwordComplexityHint', language) },
              ].map(h => (
                <View key={h.text} style={styles.passwordHintRow}>
                  {h.ok ? <CheckCircle2 size={12} color={color.success} /> : <AlertCircle size={12} color={color.danger} />}
                  <Text style={[styles.passwordHintText, { color: h.ok ? color.success : color.danger }]}>{h.text}</Text>
                </View>
              ))}
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
              {isSignUpActive ? t('alreadyHaveAccount', language) : t('dontHaveAccount', language)}
            </Text>
          </PressScale>
        </View>
      )}

      <PressScale
        style={[styles.portalLinkRow, { backgroundColor: theme.glass, borderColor: theme.border }]}
        onPress={onOpenPortal}
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
  );
};
