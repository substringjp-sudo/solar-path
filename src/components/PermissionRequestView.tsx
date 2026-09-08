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
    width: 56,
    height: 56,
    borderRadius: 4,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
  },
  logoIcon: {
    transform: [{ rotate: '45deg' }],
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 12.5,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  cardsContainer: {
    gap: 12,
    marginBottom: 24,
  },
  card: {
    backgroundColor: '#0E1424',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    padding: 16,
  },
  cardDenied: {
    borderColor: 'rgba(255, 82, 82, 0.35)',
    backgroundColor: 'rgba(255, 82, 82, 0.05)',
  },
  cardHeader: {
    flexDirection: 'row',
    gap: 14,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
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
    fontSize: 14.5,
    fontWeight: '800',
    color: '#FFFFFF',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  requiredBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 2,
    borderWidth: 0.5,
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  requiredBadgeText: {
    color: '#F59E0B',
    fontSize: 9.5,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  optionalBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 2,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  optionalBadgeText: {
    color: '#94A3B8',
    fontSize: 9.5,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  cardDesc: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 18,
    marginTop: 2,
  },
  cardFooter: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 12,
    alignItems: 'flex-end',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F59E0B',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 4,
  },
  actionBtnText: {
    fontSize: 11.5,
    fontWeight: '900',
    color: '#08080C',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  actionBtnSecondary: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  actionBtnTextSecondary: {
    color: '#F8FAFC',
    fontSize: 11.5,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  actionBtnSettings: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 82, 82, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 82, 82, 0.3)',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 4,
  },
  actionBtnSettingsText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#FF5252',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  statusGranted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  statusTextGranted: {
    color: '#34D399',
    fontSize: 11.5,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  warningAlert: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'rgba(255, 82, 82, 0.08)',
    padding: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 82, 82, 0.25)',
    marginBottom: 24,
  },
  warningText: {
    flex: 1,
    fontSize: 11.5,
    color: '#FF5252',
    lineHeight: 17,
    fontWeight: '700',
  },
  primaryLaunchBtn: {
    backgroundColor: '#38BDF8',
    height: 46,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  primaryLaunchBtnText: {
    fontSize: 13.5,
    fontWeight: '900',
    color: '#08080C',
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  settingsLaunchBtn: {
    backgroundColor: '#FF5252',
    shadowColor: '#FF5252',
  },
});
