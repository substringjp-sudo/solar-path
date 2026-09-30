import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, Modal, TextInput, ScrollView, Dimensions, Alert, Platform, Animated, PanResponder } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import Svg, { Circle, Line } from 'react-native-svg';
import { MapPin, X, Navigation, LocateFixed, Save, Trash2, Star } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useCelestialStore } from '../../store/useCelestialStore';
import { t } from '../../utils/i18n';
import { color, radius, mono } from '../../theme/tokens';
import { PressScale } from '../ui';
import { springTo, timeTo } from '../../theme/motion';
import { makeStyles, useThemeColors } from '../../theme/useTheme';

const { width, height } = Dimensions.get('window');

export const MapPicker = ({ 
  visible, 
  onClose, 
  onSelect, 
  theme, 
  location, 
  currentTime, 
  isDay = false,
  savedLocations = [],
  addSavedLocation,
  removeSavedLocation
}: any) => {
  const color = useThemeColors(); const styles = useStyles();
  const { language } = useCelestialStore();
  const [windowHeight] = useState(Dimensions.get('window').height);
  const slideAnim = useRef(new Animated.Value(windowHeight)).current;
  const mapRef = useRef<MapView>(null);

  const [latInput, setLatInput] = useState(location?.coords?.latitude?.toString() || '37.56');
  const [lonInput, setLonInput] = useState(location?.coords?.longitude?.toString() || '126.97');
  const [saveName, setSaveName] = useState('');

  const isAndroid = Platform.OS === 'android';

  const handleClose = () => {
    timeTo(slideAnim, windowHeight, 'base', 'exit').start(onClose);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 10 && gestureState.dy > 0;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          slideAnim.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 120 || gestureState.vy > 0.5) {
          handleClose();
        } else {
          springTo(slideAnim, 0, 'sheet').start();
        }
      },
    })
  ).current;

  // Sync animation when visibility changes
  useEffect(() => {
    if (visible) {
      slideAnim.setValue(windowHeight);
      springTo(slideAnim, 0, 'sheet').start();

      // Initialize inputs based on location
      const lat = location?.coords?.latitude || 37.56;
      const lon = location?.coords?.longitude || 126.97;
      setLatInput(lat.toString());
      setLonInput(lon.toString());

      // Move map to initial location
      setTimeout(() => {
        mapRef.current?.animateToRegion({
          latitude: lat,
          longitude: lon,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }, 1);
      }, 300);
    }
  }, [visible, windowHeight, location]);

  const handleJumpToLocation = (lat: number, lon: number) => {
    setLatInput(lat.toFixed(6));
    setLonInput(lon.toFixed(6));
    mapRef.current?.animateToRegion({
      latitude: lat,
      longitude: lon,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }, 600);
  };

  const handleCurrentLocation = async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('permissionDenied', language), t('permissionDeniedMsg', language));
        return;
      }
      
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      handleJumpToLocation(loc.coords.latitude, loc.coords.longitude);
    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert(t('error', language), t('failedGetLocation', language));
    }
  };

  const handleManualSelect = () => {
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    if (!isNaN(lat) && !isNaN(lon)) {
      onSelect({ coords: { latitude: lat, longitude: lon } });
      handleClose();
    }
  };

  const handleSaveLocation = () => {
    if (!saveName.trim()) {
      Alert.alert(t('notification', language), t('enterPlaceNameAlert', language));
      return;
    }
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    if (isNaN(lat) || isNaN(lon)) {
      Alert.alert(t('error', language), t('invalidCoordsAlert', language));
      return;
    }

    addSavedLocation(saveName.trim(), lat, lon);
    const savedNameText = saveName.trim();
    setSaveName('');
    Alert.alert(
      t('success', language),
      language === 'ko'
        ? `'${savedNameText}' 장소가 성공적으로 저장되었습니다.`
        : `'${savedNameText}' has been saved successfully.`
    );
  };

  const handleSelectSaved = (saved: any) => {
    handleJumpToLocation(saved.latitude, saved.longitude);
  };

  // UI 테마 토큰 설정 (Astro-HUD 규격: 4px 샤프 엣지 & 딥 흑연 계측기)
  const m3Style = {
    modalContent: {
      backgroundColor: color.panelRaised,
      borderTopLeftRadius: 4,
      borderTopRightRadius: 4,
      borderWidth: 1,
      borderColor: color.borderStrong,
    },
    section: {
      backgroundColor: color.panel,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: color.border,
      elevation: 2,
    },
    input: {
      backgroundColor: color.fill,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: color.borderStrong,
      height: 44,
    },
    button: {
      borderRadius: 4,
      height: 46,
      elevation: 3,
    },
    savedItem: {
      backgroundColor: color.panel,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: color.border,
      elevation: 1,
    }
  };

  const glassStyle = {
    modalContent: {
      backgroundColor: color.panelRaised,
      borderTopLeftRadius: 4,
      borderTopRightRadius: 4,
      borderWidth: 1,
      borderColor: color.borderStrong,
    },
    section: {
      backgroundColor: color.panel,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: color.border,
    },
    input: {
      backgroundColor: color.fill,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: color.borderStrong,
      height: 44,
    },
    button: {
      borderRadius: 4,
      height: 46,
    },
    savedItem: {
      backgroundColor: color.panel,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: color.border,
    }
  };

  const dStyle = isAndroid ? m3Style : glassStyle;

  return (
    <Modal visible={visible} animationType="fade" transparent={true} onRequestClose={handleClose}>
      <View style={styles.modalOverlay}>
        <PressScale 
          style={[StyleSheet.absoluteFill, { backgroundColor: color.scrim }]}
          activeOpacity={1}
          onPress={handleClose}
        />
        
        <Animated.View style={[
          styles.modalContent, 
          dStyle.modalContent,
          { transform: [{ translateY: slideAnim }] }
        ]}>
          <View style={styles.dragHandleWrapper} {...panResponder.panHandlers}>
            <View style={[styles.dragHandle, { backgroundColor: theme.border }]} />
          </View>

          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: theme.text }]}>{t('changeLocation', language)}</Text>
              <Text style={[styles.subtitle, { color: theme.subText }]}>{t('pickOnMap', language)}</Text>
            </View>
            <PressScale onPress={handleClose} style={styles.closeBtn}>
              <X size={24} color={theme.text} />
            </PressScale>
          </View>

          {/* Map Wrapper with Floating Overlay Controls */}
          <View style={styles.mapWrapper}>
            <View style={[styles.mapContainer, { borderColor: theme.border }]}>
              <MapView
                ref={mapRef}
                provider={PROVIDER_GOOGLE}
                style={StyleSheet.absoluteFillObject}
                initialRegion={{
                  latitude: location?.coords?.latitude || 37.56,
                  longitude: location?.coords?.longitude || 126.97,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                }}
                onRegionChangeComplete={(region) => {
                  setLatInput(region.latitude.toFixed(6));
                  setLonInput(region.longitude.toFixed(6));
                }}
                showsUserLocation={true}
                showsMyLocationButton={false}
              />

              {/* 중앙 표지점 오버레이 */}
              <View style={styles.crosshairContainer} pointerEvents="none">
                <Svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                  <Circle cx="20" cy="20" r="8" stroke={theme.accent} strokeWidth="2.5" opacity={0.8} />
                  <Circle cx="20" cy="20" r="1.5" fill={theme.accent} />
                  <Line x1="20" y1="2" x2="20" y2="9" stroke={theme.accent} strokeWidth="2.5" strokeLinecap="round" />
                  <Line x1="20" y1="31" x2="20" y2="38" stroke={theme.accent} strokeWidth="2.5" strokeLinecap="round" />
                  <Line x1="2" y1="20" x2="9" y2="20" stroke={theme.accent} strokeWidth="2.5" strokeLinecap="round" />
                  <Line x1="31" y1="20" x2="38" y2="20" stroke={theme.accent} strokeWidth="2.5" strokeLinecap="round" />
                </Svg>
              </View>
            </View>

            {/* Locate Me Floating Button */}
            <PressScale
              onPress={handleCurrentLocation}
              style={[
                styles.locateMeBtn,
                {
                  backgroundColor: theme.glass,
                  borderColor: theme.border,
                }
              ]}
              activeOpacity={0.7}
            >
              <LocateFixed size={20} color={theme.accent} />
            </PressScale>
          </View>

          {/* Form and List Scroll Area */}
          <ScrollView style={styles.formScroll} showsVerticalScrollIndicator={false}>
            <View style={[styles.section, dStyle.section]}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.subText }]}>{t('pickedCoords', language)}</Text>
                <PressScale onPress={handleCurrentLocation} style={styles.currentLocLink}>
                  <LocateFixed size={12} color={theme.accent} />
                  <Text style={[styles.currentLocLinkText, { color: theme.accent }]}>{t('myLocation', language)}</Text>
                </PressScale>
              </View>
              
              {/* 콤팩트 위치 입력 & 장소 저장 통합 폼 */}
              <View style={styles.compactSaveForm}>
                <View style={styles.compactInputsContainer}>
                  <View style={styles.compactInputRow}>
                    <TextInput
                      style={[styles.input, { color: theme.text, borderColor: theme.border, flex: 1 }, dStyle.input]}
                      value={latInput}
                      onChangeText={(val) => setLatInput(val.replace(/[^0-9.-]/g, ''))}
                      placeholder={t('latitude', language)}
                      placeholderTextColor={theme.subText}
                      keyboardType="decimal-pad"
                    />
                    <TextInput
                      style={[styles.input, { color: theme.text, borderColor: theme.border, flex: 1, marginLeft: 8 }, dStyle.input]}
                      value={lonInput}
                      onChangeText={(val) => setLonInput(val.replace(/[^0-9.-]/g, ''))}
                      placeholder={t('longitude', language)}
                      placeholderTextColor={theme.subText}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  
                  <TextInput
                    style={[styles.nameInput, { color: theme.text, borderColor: theme.border, marginTop: 8 }, dStyle.input]}
                    placeholder={t('enterPlaceName', language)}
                    placeholderTextColor={theme.subText}
                    value={saveName}
                    onChangeText={setSaveName}
                  />
                </View>

                <PressScale
                  style={[
                    styles.saveBtnCompact, 
                    { backgroundColor: theme.accent }, 
                    dStyle.button, 
                    { width: isAndroid ? 48 : 44, height: isAndroid ? 48 : 44 }
                  ]}
                  onPress={handleSaveLocation}
                >
                  <Save size={16} color={color.onAccent} />
                </PressScale>
              </View>
            </View>

            <PressScale 
              onPress={handleManualSelect}
              style={[styles.confirmBtn, { backgroundColor: color.accent, marginTop: 24, marginBottom: 24 }, dStyle.button]}
            >
              <Navigation size={20} color={color.onAccent} />
              <Text style={[styles.confirmBtnText, { color: color.onAccent }]}>{t('selectThisLocation', language)}</Text>
            </PressScale>

            {/* 저장된 즐겨찾기 목록 */}
            <View style={styles.savedSection}>
              <Text style={[styles.sectionTitle, { color: theme.subText, marginBottom: 12 }]}>{t('savedPlaces', language)}</Text>
              {savedLocations.length === 0 ? (
                <View style={[styles.emptyState, { borderColor: theme.border }]}>
                  <Star size={24} color={theme.subText} style={{ marginBottom: 6 }} />
                  <Text style={{ color: theme.subText, fontSize: 13 }}>{t('noSavedPlaces', language)}</Text>
                </View>
              ) : (
                <View style={styles.savedList}>
                  {savedLocations.map((loc: any) => (
                    <View key={loc.id} style={[styles.savedItem, dStyle.savedItem]}>
                      <PressScale
                        style={styles.savedItemContent}
                        onPress={() => handleSelectSaved(loc)}
                      >
                        <View style={[styles.savedItemIcon, { backgroundColor: theme.glass }]}>
                          <MapPin size={16} color={theme.accent} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.savedItemName, { color: theme.text }]}>{loc.name}</Text>
                          <Text style={[styles.savedItemCoords, { color: theme.subText }]}>
                            {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                          </Text>
                        </View>
                      </PressScale>
                      <PressScale
                        style={styles.deleteBtn}
                        onPress={() => removeSavedLocation(loc.id)}
                      >
                        <Trash2 size={16} color={color.danger} />
                      </PressScale>
                    </View>
                  ))}
                </View>
              )}
            </View>
            <View style={{ height: 40 }} />
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const useStyles = makeStyles((color) => ({
  dragHandleWrapper: {
    width: '100%',
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    marginTop: -8,
    marginBottom: 4,
  },
  dragHandle: {
    width: 32,
    height: 2,
    borderRadius: 1,
    backgroundColor: color.borderStrong,
  },
  modalOverlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  modalContent: { height: height * 0.9, borderTopLeftRadius: 4, borderTopRightRadius: 4, paddingHorizontal: 20, paddingTop: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '900', fontFamily: mono, letterSpacing: 0.5 },
  subtitle: { fontSize: 11, marginTop: 2, opacity: 0.8, fontFamily: mono },
  closeBtn: { padding: 6, backgroundColor: color.fill, borderRadius: radius.xs, borderWidth: 1, borderColor: color.border },
  
  mapWrapper: {
    position: 'relative',
    height: height * 0.38,
    minHeight: 280,
    maxHeight: 340,
    marginBottom: 16,
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
  mapContainer: { flex: 1, borderRadius: radius.xs, borderWidth: 1, borderColor: color.border, overflow: 'hidden' },
  crosshairContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -20,
    marginTop: -20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  locateMeBtn: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  formScroll: { flex: 1 },
  section: { padding: 16, borderRadius: radius.lg, borderWidth: 1 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  currentLocLink: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: color.fill, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8 },
  currentLocLinkText: { fontSize: 11, fontWeight: '700' },
  input: { height: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 16, fontSize: 16, backgroundColor: color.fill },
  nameInput: { flex: 1, height: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 16, fontSize: 16, backgroundColor: color.fill },
  compactSaveForm: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  compactInputsContainer: {
    flex: 1,
  },
  compactInputRow: {
    flexDirection: 'row',
  },
  saveBtnCompact: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
  },
  savedSection: { marginTop: 24 },
  emptyState: { height: 100, borderRadius: radius.lg, borderWidth: 1, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  savedList: { gap: 10 },
  savedItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: radius.lg, borderWidth: 1 },
  savedItemContent: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  savedItemIcon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: color.fill, justifyContent: 'center', alignItems: 'center' },
  savedItemName: { fontSize: 16, fontWeight: '700' },
  savedItemCoords: { fontSize: 11, opacity: 0.6, marginTop: 2 },
  deleteBtn: { padding: 10 },
  confirmBtn: { flexDirection: 'row', height: 56, borderRadius: radius.lg, justifyContent: 'center', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  confirmBtnText: { fontSize: 16, fontWeight: '900', color: '#000' }
}));
