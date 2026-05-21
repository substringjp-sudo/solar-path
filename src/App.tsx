import React from 'react';
import { StyleSheet, View, Text, SafeAreaView, StatusBar, ActivityIndicator, TouchableOpacity, Animated, Platform, Modal, ScrollView } from 'react-native';
import Constants from 'expo-constants';
import { MapPin, Star, Trash2, X } from 'lucide-react-native';

import { useCelestialApp } from './hooks/useCelestialApp';
import { HudHeader } from './components/HudHeader';
import { TabNavigator } from './components/TabNavigator';
import { AdaptiveDatePicker } from './components/AdaptiveDatePicker/AdaptiveDatePicker';
import { MapPicker } from './components/MapPicker';
import { SunCamera } from './components/SunCamera';
import { SettingsModal } from './components/SettingsModal';
import { PermissionRequestView } from './components/PermissionRequestView';

const AnimatedSafeAreaView = Animated.createAnimatedComponent(SafeAreaView);

export default function App() {
  const {
    animating,
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
    contentOpacity,
    currentTime,
    currentTimeLocal,
    timezoneLabel,
    location,
    locationPermission,
    isTimeMachineEnabled,
    userRotation,
    isGyroEnabled,
    errorMsg,
    savedLocations,
    setLocation,
    setUserRotation,
    setGyroEnabled,
    resetRotation,
    removeSavedLocation,
    addSavedLocation,
    myPhotos,
    addMyPhoto,
    removeMyPhoto,
    globalPhotos,
    uploadAndPostPhoto,
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
  } = useCelestialApp();

  if (locationPermission !== 'granted') {
    return <PermissionRequestView />;
  }

  if (!location) return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color="#FFD700" />
      <Text style={styles.loadingText}>Locating your position...</Text>
    </View>
  );

  return (
    <AnimatedSafeAreaView style={[styles.container, { backgroundColor: dynamicTheme.bg }]}>
      <StatusBar barStyle={isDay ? "dark-content" : "light-content"} translucent backgroundColor="transparent" />
      
      <View style={styles.mainContent}>
        <HudHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          setMapVisible={setMapVisible}
          setSavedListVisible={setSavedListVisible}
          setSettingsVisible={setSettingsVisible}
          handleSaveLocation={handleSaveLocation}
          handleCameraPress={handleCameraPress}
          handleCameraLongPress={handleCameraLongPress}
          goldenTimeInfo={goldenTimeInfo}
          setShowDatePicker={setShowDatePicker}
          handleDateChange={handleDateChange}
          theme={theme}
          dynamicTheme={dynamicTheme}
          currentTimeLocal={currentTimeLocal}
          timezoneLabel={timezoneLabel}
        />

        <TabNavigator
          activeTab={activeTab}
          contentOpacity={contentOpacity}
          sunPos={sunPos}
          moonPos={moonPos}
          sunPath={sunPath}
          moonPath={moonPath}
          events={events}
          theme={theme}
          dynamicTheme={dynamicTheme}
          userRotation={userRotation}
          setUserRotation={setUserRotation}
          resetRotation={resetRotation}
          isGyroEnabled={isGyroEnabled}
          setGyroEnabled={setGyroEnabled}
          currentTime={currentTime}
          setCurrentTime={handleTimeChange}
          isTimeMachineEnabled={isTimeMachineEnabled}
          setTimeMachineEnabled={handleToggleTimeMachine}
          isDay={isDay}
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
        myPhotos={myPhotos}
        addMyPhoto={addMyPhoto}
        removeMyPhoto={removeMyPhoto}
        globalPhotos={globalPhotos}
        uploadAndPostPhoto={uploadAndPostPhoto}
        removeGlobalPhoto={removeGlobalPhoto}
      />

      <Modal
        visible={isSavedListVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSavedListVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.savedModal, { backgroundColor: theme.bg, borderColor: theme.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Saved Places</Text>
              <TouchableOpacity onPress={() => setSavedListVisible(false)} style={styles.closeBtn}>
                <X size={20} color={theme.subText} />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.savedScroll}>
              {savedLocations.length === 0 ? (
                <View style={styles.emptySaved}>
                  <Star size={40} color={theme.border} style={{ marginBottom: 10 }} />
                  <Text style={{ color: theme.subText }}>No saved places.</Text>
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
          </View>
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
    </AnimatedSafeAreaView>
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
});
