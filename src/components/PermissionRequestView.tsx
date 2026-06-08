import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Linking, Platform, SafeAreaView, StatusBar, ScrollView } from 'react-native';
import { MapPin, Camera, Compass, ShieldAlert, CheckCircle2, ChevronRight } from 'lucide-react-native';
import { useCelestialStore } from '../store/useCelestialStore';
import { t } from '../utils/i18n';

interface PermissionRequestViewProps {
  theme?: any;
}

export const PermissionRequestView: React.FC<PermissionRequestViewProps> = () => {
  const { 
    locationPermission, 
    cameraPermission, 
    requestLocationPermission, 
    requestCameraPermission,
    language
  } = useCelestialStore();

  const handleOpenSettings = () => {
    Linking.openSettings();
  };

  const isLocationDenied = locationPermission === 'denied';
  const isCameraDenied = cameraPermission === 'denied';

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#08080C" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Top Branding Section */}
        <View style={styles.header}>
          <View style={styles.logoBadge}>
            <Compass size={32} color="#FFD700" style={styles.logoIcon} />
          </View>
          <Text style={styles.title}>{t('permissionTitle', language)}</Text>
          <Text style={styles.subtitle}>
            {t('permissionSubtitle', language)}
          </Text>
        </View>

        {/* Permission Cards Container */}
        <View style={styles.cardsContainer}>
          
          {/* 1. Location Permission Card (Required) */}
          <View style={[styles.card, isLocationDenied && styles.cardDenied]}>
            <View style={styles.cardHeader}>
              <View style={[styles.iconContainer, { backgroundColor: 'rgba(255, 215, 0, 0.1)' }]}>
                <MapPin size={22} color="#FFD700" />
              </View>
              <View style={styles.cardTitleInfo}>
                <View style={styles.row}>
                  <Text style={styles.cardTitle}>{t('realtimeLocation', language)}</Text>
                  <View style={styles.requiredBadge}>
                    <Text style={styles.requiredBadgeText}>{t('required', language)}</Text>
                  </View>
                </View>
                <Text style={styles.cardDesc}>
                  {t('locationDesc', language)}
                </Text>
              </View>
            </View>

            <View style={styles.cardFooter}>
              {locationPermission === 'granted' ? (
                <View style={styles.statusGranted}>
                  <CheckCircle2 size={16} color="#4CAF50" />
                  <Text style={styles.statusTextGranted}>{t('granted', language)}</Text>
                </View>
              ) : isLocationDenied ? (
                <TouchableOpacity style={styles.actionBtnSettings} onPress={handleOpenSettings}>
                  <Text style={styles.actionBtnSettingsText}>{t('settingsAllow', language)}</Text>
                  <ChevronRight size={14} color="#FF5252" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.actionBtn} onPress={requestLocationPermission}>
                  <Text style={styles.actionBtnText}>{t('requestPermission', language)}</Text>
                  <ChevronRight size={14} color="#08080C" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* 2. Camera Permission Card (Optional) */}
          <View style={[styles.card, isCameraDenied && styles.cardDenied]}>
            <View style={styles.cardHeader}>
              <View style={[styles.iconContainer, { backgroundColor: 'rgba(255, 255, 255, 0.05)' }]}>
                <Camera size={22} color="#FFFFFF" />
              </View>
              <View style={styles.cardTitleInfo}>
                <View style={styles.row}>
                  <Text style={styles.cardTitle}>{t('arCameraGallery', language)}</Text>
                  <View style={styles.optionalBadge}>
                    <Text style={styles.optionalBadgeText}>{t('optional', language)}</Text>
                  </View>
                </View>
                <Text style={styles.cardDesc}>
                  {t('cameraDesc', language)}
                </Text>
              </View>
            </View>

            <View style={styles.cardFooter}>
              {cameraPermission === 'granted' ? (
                <View style={styles.statusGranted}>
                  <CheckCircle2 size={16} color="#4CAF50" />
                  <Text style={styles.statusTextGranted}>{t('granted', language)}</Text>
                </View>
              ) : isCameraDenied ? (
                <TouchableOpacity style={styles.actionBtnSettings} onPress={handleOpenSettings}>
                  <Text style={styles.actionBtnSettingsText}>{t('settingsAllow', language)}</Text>
                  <ChevronRight size={14} color="#FF5252" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnSecondary]} onPress={requestCameraPermission}>
                  <Text style={styles.actionBtnTextSecondary}>{t('requestPermission', language)}</Text>
                  <ChevronRight size={14} color="#FFFFFF" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* Dynamic Warning Notification */}
        {isLocationDenied && (
          <View style={styles.warningAlert}>
            <ShieldAlert size={18} color="#FF5252" />
            <Text style={styles.warningText}>
              {t('locationDeniedAlert', language)}
            </Text>
          </View>
        )}

        {/* Global Action Button */}
        {!isLocationDenied && locationPermission !== 'granted' && (
          <TouchableOpacity style={styles.primaryLaunchBtn} onPress={requestLocationPermission}>
            <Text style={styles.primaryLaunchBtnText}>{t('startApp', language)}</Text>
          </TouchableOpacity>
        )}

        {isLocationDenied && (
          <TouchableOpacity style={[styles.primaryLaunchBtn, styles.settingsLaunchBtn]} onPress={handleOpenSettings}>
            <Text style={styles.primaryLaunchBtnText}>{t('goToSettings', language)}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08080C',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'android' ? 40 : 20,
    paddingBottom: 40,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.2)',
  },
  logoIcon: {
    transform: [{ rotate: '45deg' }],
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    color: '#8A8A93',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 10,
  },
  cardsContainer: {
    gap: 16,
    marginBottom: 30,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 20,
  },
  cardDenied: {
    borderColor: 'rgba(255, 82, 82, 0.2)',
    backgroundColor: 'rgba(255, 82, 82, 0.02)',
  },
  cardHeader: {
    flexDirection: 'row',
    gap: 16,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTitleInfo: {
    flex: 1,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  requiredBadge: {
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  requiredBadgeText: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: '900',
  },
  optionalBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  optionalBadgeText: {
    color: '#8A8A93',
    fontSize: 10,
    fontWeight: '900',
  },
  cardDesc: {
    fontSize: 13,
    color: '#8A8A93',
    lineHeight: 20,
    marginTop: 2,
  },
  cardFooter: {
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    paddingTop: 14,
    alignItems: 'flex-end',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFD700',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#08080C',
  },
  actionBtnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  actionBtnTextSecondary: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  actionBtnSettings: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 82, 82, 0.1)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  actionBtnSettingsText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FF5252',
  },
  statusGranted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  statusTextGranted: {
    color: '#4CAF50',
    fontSize: 12,
    fontWeight: '800',
  },
  warningAlert: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'rgba(255, 82, 82, 0.08)',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 82, 82, 0.15)',
    marginBottom: 30,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: '#FF5252',
    lineHeight: 18,
    fontWeight: '700',
  },
  primaryLaunchBtn: {
    backgroundColor: '#FFD700',
    height: 52,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryLaunchBtnText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#08080C',
    letterSpacing: -0.2,
  },
  settingsLaunchBtn: {
    backgroundColor: '#FF5252',
    shadowColor: '#FF5252',
  },
});
