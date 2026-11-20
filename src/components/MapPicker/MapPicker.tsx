import React, { useState, useRef, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, Modal, TextInput, ScrollView, Dimensions, Alert, Animated, PanResponder, ActivityIndicator } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import Svg, { Circle, Line } from 'react-native-svg';
import { MapPin, X, Navigation, LocateFixed, Save, Trash2, Star } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useCelestialStore } from '../../store/useCelestialStore';
import { t, L3 } from '../../utils/i18n';
import { radius, mono, space, type } from '../../theme/tokens';
import { PressScale } from '../ui';
import { springTo, timeTo } from '../../theme/motion';
import { makeStyles, useThemeColors } from '../../theme/useTheme';
import { useAdministrativeArea } from '../../utils/reverseGeocode';

const { height } = Dimensions.get('window');

export const MapPicker = ({
  visible,
  onClose,
  onSelect,
  location,
  savedLocations = [],
  addSavedLocation,
  removeSavedLocation,
}: any) => {
  const color = useThemeColors();
  const styles = useStyles();
  const { language, homeCoords, setHomeCoords } = useCelestialStore();
  const [windowHeight] = useState(Dimensions.get('window').height);
  const slideAnim = useRef(new Animated.Value(windowHeight)).current;
  const mapRef = useRef<MapView>(null);

  const [latInput, setLatInput] = useState(location?.coords?.latitude?.toFixed(6) || '37.566500');
  const [lonInput, setLonInput] = useState(location?.coords?.longitude?.toFixed(6) || '126.978000');
  const [saveName, setSaveName] = useState('');
  const [isLocating, setIsLocating] = useState(false);

  const parsedLat = useMemo(() => {
    const v = parseFloat(latInput);
    return Number.isFinite(v) ? v : undefined;
  }, [latInput]);
  const parsedLon = useMemo(() => {
    const v = parseFloat(lonInput);
    return Number.isFinite(v) ? v : undefined;
  }, [lonInput]);
  const pickedAdminName = useAdministrativeArea(parsedLat, parsedLon);

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
    }),
  ).current;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(windowHeight);
      springTo(slideAnim, 0, 'sheet').start();

      const lat = location?.coords?.latitude ?? 37.5665;
      const lon = location?.coords?.longitude ?? 126.9780;
      setLatInput(lat.toFixed(6));
      setLonInput(lon.toFixed(6));

      setTimeout(() => {
        mapRef.current?.animateToRegion(
          {
            latitude: lat,
            longitude: lon,
            latitudeDelta: 0.012,
            longitudeDelta: 0.012,
          },
          1,
        );
      }, 240);
    }
  }, [visible, windowHeight, location]);

  const handleJumpToLocation = (lat: number, lon: number, applyNow = false) => {
    setLatInput(lat.toFixed(6));
    setLonInput(lon.toFixed(6));
    mapRef.current?.animateToRegion(
      {
        latitude: lat,
        longitude: lon,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      },
      380,
    );
    if (applyNow) {
      onSelect({
        coords: {
          latitude: lat,
          longitude: lon,
          altitude: 0,
          accuracy: 0,
          altitudeAccuracy: 0,
          heading: 0,
          speed: 0,
        },
        timestamp: Date.now(),
      });
    }
  };

  const handleCurrentLocation = async () => {
    if (isLocating) return;
    setIsLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (homeCoords) {
          handleJumpToLocation(homeCoords.latitude, homeCoords.longitude, true);
          return;
        }
        Alert.alert(t('permissionDenied', language), t('permissionDeniedMsg', language));
        return;
      }

      // 1) 즉시 반응하도록 최근 캐시 위치나 앱 기동 시 측정한 homeCoords로 먼저 지도 중심 이동
      const lastKnown = await Location.getLastKnownPositionAsync({}).catch(() => null);
      const quickCoords = lastKnown?.coords ?? homeCoords;
      if (quickCoords) {
        handleJumpToLocation(quickCoords.latitude, quickCoords.longitude, true);
      }

      // 2) 실내 GPS 무한 대기를 막기 위해 3.5초 타임아웃으로 실시간 측위 시도
      const gpsPromise = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const timeoutPromise = new Promise<null>((res) => setTimeout(() => res(null), 3500));
      const fresh = await Promise.race([gpsPromise, timeoutPromise]).catch(() => null);

      if (fresh?.coords) {
        setHomeCoords({ latitude: fresh.coords.latitude, longitude: fresh.coords.longitude });
        handleJumpToLocation(fresh.coords.latitude, fresh.coords.longitude, true);
      } else if (!quickCoords) {
        Alert.alert(t('error', language), t('failedGetLocation', language));
      }
    } catch (error) {
      if (homeCoords) {
        handleJumpToLocation(homeCoords.latitude, homeCoords.longitude, true);
      } else {
        console.error('Error getting location:', error);
        Alert.alert(t('error', language), t('failedGetLocation', language));
      }
    } finally {
      setIsLocating(false);
    }
  };

  const handleManualSelect = () => {
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    if (!isNaN(lat) && !isNaN(lon)) {
      onSelect({
        coords: {
          latitude: lat,
          longitude: lon,
          altitude: 0,
          accuracy: 0,
          altitudeAccuracy: 0,
          heading: 0,
          speed: 0,
        },
        timestamp: Date.now(),
      });
      handleClose();
    }
  };

  const handleSaveLocation = () => {
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    if (isNaN(lat) || isNaN(lon)) {
      Alert.alert(t('error', language), t('invalidCoordsAlert', language));
      return;
    }
    const finalName = saveName.trim() || pickedAdminName || '';
    if (!finalName) {
      Alert.alert(t('notification', language), t('enterPlaceNameAlert', language));
      return;
    }

    addSavedLocation(finalName, lat, lon);
    setSaveName('');
    Alert.alert(
      t('success', language),
      L3(language, `'${finalName}' 장소를 저장했습니다.`, `Saved '${finalName}'.`, `「${finalName}」を保存しました。`),
    );
  };

  const handleSelectSaved = (saved: any) => {
    handleJumpToLocation(saved.latitude, saved.longitude, true);
  };

  const isCloseTo = (latA: number, lonA: number) => {
    if (parsedLat == null || parsedLon == null) return false;
    return Math.hypot(latA - parsedLat, lonA - parsedLon) < 0.003;
  };

  return (
    <Modal visible={visible} animationType="fade" transparent={true} onRequestClose={handleClose}>
      <View style={styles.modalOverlay}>
        <PressScale
          style={[StyleSheet.absoluteFill, { backgroundColor: color.scrim }]}
          activeOpacity={1}
          onPress={handleClose}
        />

        <Animated.View
          style={[
            styles.modalContainer,
            {
              backgroundColor: color.panelRaised,
              borderColor: color.borderStrong,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={styles.dragHandleWrapper} {...panResponder.panHandlers}>
            <View style={[styles.dragHandle, { backgroundColor: color.borderStrong }]} />
          </View>

          {/* 헤더 — SettingsModal 과 동일한 규격 */}
          <View style={[styles.header, { borderBottomColor: color.border }]}>
            <View style={styles.headerTextCol}>
              <Text style={[styles.headerTitle, { color: color.text }]}>{t('changeLocation', language)}</Text>
              <Text style={[styles.headerSub, { color: color.textDim }]} numberOfLines={1}>
                {pickedAdminName
                  ? `${pickedAdminName} · ${parsedLat?.toFixed(4) ?? ''}, ${parsedLon?.toFixed(4) ?? ''}`
                  : t('pickOnMap', language)}
              </Text>
            </View>
            <PressScale onPress={handleClose} style={[styles.closeBtn, { backgroundColor: color.fill, borderColor: color.border }]}>
              <X size={18} color={color.text} />
            </PressScale>
          </View>

          <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollPadding} showsVerticalScrollIndicator={false}>
            {/* 1. 첫 화면 상단: 내 위치 + 저장된 장소 빠른 선택 섹션 */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: color.textDim }]}>{t('savedPlaces', language)}</Text>
                <PressScale
                  onPress={handleCurrentLocation}
                  disabled={isLocating}
                  style={[styles.myLocChip, { backgroundColor: color.accentSoft, borderColor: color.accentLine }]}
                >
                  {isLocating ? (
                    <ActivityIndicator size="small" color={color.accent} style={{ transform: [{ scale: 0.7 }] }} />
                  ) : (
                    <LocateFixed size={12} color={color.accent} />
                  )}
                  <Text style={[styles.myLocChipText, { color: color.accent }]}>{t('myLocation', language)}</Text>
                </PressScale>
              </View>

              {savedLocations.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: color.panel, borderColor: color.border }]}>
                  <Star size={14} color={color.textMute} />
                  <Text style={[styles.emptyText, { color: color.textDim }]}>{t('noSavedPlaces', language)}</Text>
                </View>
              ) : (
                <View style={[styles.card, { backgroundColor: color.panel, borderColor: color.border }]}>
                  {savedLocations.map((loc: any, idx: number) => {
                    const selected = isCloseTo(loc.latitude, loc.longitude);
                    return (
                      <View
                        key={loc.id}
                        style={[
                          styles.savedRow,
                          idx > 0 && { borderTopWidth: 1, borderTopColor: color.border },
                          selected && { backgroundColor: color.accentSoft },
                        ]}
                      >
                        <PressScale style={styles.savedRowMain} onPress={() => handleSelectSaved(loc)}>
                          <View
                            style={[
                              styles.savedIconBox,
                              {
                                backgroundColor: selected ? color.accent : color.fill,
                                borderColor: selected ? color.accent : color.border,
                              },
                            ]}
                          >
                            <MapPin size={14} color={selected ? color.onAccent : color.accent} />
                          </View>
                          <View style={styles.savedTextCol}>
                            <Text
                              style={[
                                styles.savedName,
                                { color: selected ? color.accent : color.text },
                              ]}
                              numberOfLines={1}
                            >
                              {loc.name}
                            </Text>
                            <Text style={[styles.savedCoords, { color: color.textDim }]} numberOfLines={1}>
                              {`${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`}
                            </Text>
                          </View>
                        </PressScale>
                        <PressScale
                          style={styles.applySavedChip}
                          onPress={() => {
                            onSelect({
                              coords: {
                                latitude: loc.latitude,
                                longitude: loc.longitude,
                                altitude: 0,
                                accuracy: 0,
                                altitudeAccuracy: 0,
                                heading: 0,
                                speed: 0,
                              },
                              timestamp: Date.now(),
                            });
                            handleClose();
                          }}
                        >
                          <Text style={[styles.applySavedChipText, { color: color.accent }]}>
                            {L3(language, '이동', 'Go', '移動')}
                          </Text>
                        </PressScale>
                        <PressScale style={styles.deleteBtn} onPress={() => removeSavedLocation(loc.id)}>
                          <Trash2 size={15} color={color.danger} />
                        </PressScale>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* 2. 지도에서 직접 고르기 */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: color.textDim }]}>
                {L3(language, '지도에서 선택', 'PICK ON MAP', '地図から選択')}
              </Text>
              <View style={[styles.mapWrapper, { borderColor: color.border }]}>
                <MapView
                  ref={mapRef}
                  provider={PROVIDER_GOOGLE}
                  style={StyleSheet.absoluteFillObject}
                  initialRegion={{
                    latitude: location?.coords?.latitude || 37.5665,
                    longitude: location?.coords?.longitude || 126.9780,
                    latitudeDelta: 0.012,
                    longitudeDelta: 0.012,
                  }}
                  onRegionChangeComplete={(region) => {
                    setLatInput(region.latitude.toFixed(6));
                    setLonInput(region.longitude.toFixed(6));
                  }}
                  showsUserLocation={true}
                  showsMyLocationButton={false}
                />

                {/* 중앙 십자선 오버레이 */}
                <View style={styles.crosshairContainer} pointerEvents="none">
                  <Svg width="36" height="36" viewBox="0 0 40 40" fill="none">
                    <Circle cx="20" cy="20" r="8" stroke={color.accent} strokeWidth="2.5" opacity={0.85} />
                    <Circle cx="20" cy="20" r="1.8" fill={color.accent} />
                    <Line x1="20" y1="2" x2="20" y2="9" stroke={color.accent} strokeWidth="2.5" strokeLinecap="round" />
                    <Line x1="20" y1="31" x2="20" y2="38" stroke={color.accent} strokeWidth="2.5" strokeLinecap="round" />
                    <Line x1="2" y1="20" x2="9" y2="20" stroke={color.accent} strokeWidth="2.5" strokeLinecap="round" />
                    <Line x1="31" y1="20" x2="38" y2="20" stroke={color.accent} strokeWidth="2.5" strokeLinecap="round" />
                  </Svg>
                </View>

                {/* 지도 위 내 위치 플로팅 버튼 */}
                <PressScale
                  onPress={handleCurrentLocation}
                  disabled={isLocating}
                  style={[
                    styles.locateMeBtn,
                    {
                      backgroundColor: color.panelRaised,
                      borderColor: color.borderStrong,
                    },
                  ]}
                  activeOpacity={0.75}
                >
                  {isLocating ? (
                    <ActivityIndicator size="small" color={color.accent} />
                  ) : (
                    <LocateFixed size={18} color={color.accent} />
                  )}
                </PressScale>
              </View>
            </View>

            {/* 3. 좌표 미세 조정 & 새 장소 저장 */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: color.textDim }]}>{t('pickedCoords', language)}</Text>
              <View style={[styles.card, styles.formCard, { backgroundColor: color.panel, borderColor: color.border }]}>
                <View style={styles.coordRow}>
                  <View style={styles.coordField}>
                    <Text style={[styles.fieldLabel, { color: color.textMute }]}>LAT</Text>
                    <TextInput
                      style={[styles.input, { color: color.text, borderColor: color.borderStrong, backgroundColor: color.fill }]}
                      value={latInput}
                      onChangeText={(val) => setLatInput(val.replace(/[^0-9.-]/g, ''))}
                      placeholder={t('latitude', language)}
                      placeholderTextColor={color.textMute}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={styles.coordField}>
                    <Text style={[styles.fieldLabel, { color: color.textMute }]}>LON</Text>
                    <TextInput
                      style={[styles.input, { color: color.text, borderColor: color.borderStrong, backgroundColor: color.fill }]}
                      value={lonInput}
                      onChangeText={(val) => setLonInput(val.replace(/[^0-9.-]/g, ''))}
                      placeholder={t('longitude', language)}
                      placeholderTextColor={color.textMute}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>

                <View style={styles.saveRow}>
                  <TextInput
                    style={[styles.nameInput, { color: color.text, borderColor: color.borderStrong, backgroundColor: color.fill }]}
                    placeholder={pickedAdminName ? `${pickedAdminName} (${t('enterPlaceName', language)})` : t('enterPlaceName', language)}
                    placeholderTextColor={color.textMute}
                    value={saveName}
                    onChangeText={setSaveName}
                  />
                  <PressScale
                    style={[styles.saveBtn, { backgroundColor: color.fill, borderColor: color.accentLine }]}
                    onPress={handleSaveLocation}
                  >
                    <Save size={15} color={color.accent} />
                    <Text style={[styles.saveBtnText, { color: color.accent }]}>
                      {L3(language, '저장', 'Save', '保存')}
                    </Text>
                  </PressScale>
                </View>
              </View>
            </View>
          </ScrollView>

          {/* 하단 고정 주 실행 버튼 — 스크롤과 무관하게 항상 노출 */}
          <View style={[styles.footerBar, { backgroundColor: color.panelRaised, borderTopColor: color.border }]}>
            <PressScale
              onPress={handleManualSelect}
              style={[styles.confirmBtn, { backgroundColor: color.accent }]}
            >
              <Navigation size={16} color={color.onAccent} />
              <Text style={[styles.confirmBtnText, { color: color.onAccent }]}>
                {pickedAdminName
                  ? `${pickedAdminName} · ${t('selectThisLocation', language)}`
                  : t('selectThisLocation', language)}
              </Text>
            </PressScale>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const useStyles = makeStyles((color) => ({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    height: Math.min(height * 0.86, 720),
    borderTopLeftRadius: radius.xs,
    borderTopRightRadius: radius.xs,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 20,
  },
  dragHandleWrapper: {
    width: '100%',
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 6,
  },
  dragHandle: {
    width: 32,
    height: 2,
    borderRadius: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    gap: 12,
  },
  headerTextCol: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    ...type.title,
  },
  headerSub: {
    fontSize: 11,
    marginTop: 2,
    fontFamily: mono,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.xs,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    flex: 1,
  },
  scrollPadding: {
    padding: 14,
    paddingBottom: 20,
    gap: 14,
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
    ...type.label,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingLeft: 2,
  },
  myLocChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: radius.xs,
    borderWidth: 1,
  },
  myLocChipText: {
    ...type.label,
  },
  card: {
    borderRadius: radius.xs,
    borderWidth: 1,
    overflow: 'hidden',
  },
  emptyCard: {
    height: 44,
    borderRadius: radius.xs,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 12,
    fontWeight: '500',
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 8,
  },
  savedRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  savedIconBox: {
    width: 30,
    height: 30,
    borderRadius: radius.xs,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  savedTextCol: {
    flex: 1,
    minWidth: 0,
  },
  savedName: {
    ...type.bodyStrong,
  },
  savedCoords: {
    fontSize: 11,
    fontFamily: mono,
    marginTop: 1,
  },
  applySavedChip: {
    paddingHorizontal: 8,
    height: 26,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.accentLine,
    backgroundColor: color.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
  },
  applySavedChipText: {
    ...type.label,
  },
  deleteBtn: {
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapWrapper: {
    position: 'relative',
    height: 205,
    borderRadius: radius.xs,
    borderWidth: 1,
    overflow: 'hidden',
  },
  crosshairContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -18,
    marginTop: -18,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  locateMeBtn: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: radius.xs,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  formCard: {
    padding: 10,
    gap: 8,
  },
  coordRow: {
    flexDirection: 'row',
    gap: 8,
  },
  coordField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fieldLabel: {
    ...type.micro,
    width: 24,
  },
  input: {
    flex: 1,
    height: 36,
    borderWidth: 1,
    borderRadius: radius.xs,
    paddingHorizontal: 10,
    fontSize: 13,
    fontFamily: mono,
    fontWeight: '700',
  },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nameInput: {
    flex: 1,
    height: 36,
    borderWidth: 1,
    borderRadius: radius.xs,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  saveBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: radius.xs,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  saveBtnText: {
    ...type.label,
  },
  footerBar: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  confirmBtn: {
    height: 44,
    borderRadius: radius.xs,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  confirmBtnText: {
    ...type.bodyStrong,
  },
}));
