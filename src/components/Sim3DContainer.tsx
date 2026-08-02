import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { SlidersHorizontal } from 'lucide-react-native';
import { SkyScene3D, DEFAULT_SKY_SETTINGS, LayerState, SkySettings } from './SkyScene3D/SkyScene3D';
import { LayerControlModal } from './SunsetSimulation/LayerControlModal';
import { TimeSlider } from './TimeSlider';
import { useCelestialStore } from '../store/useCelestialStore';
import { fetchTerrainProfile } from '../utils/weather';
import SunCalc from 'suncalc';

interface Sim3DContainerProps {
  theme: any;
  currentTime: Date;
  setCurrentTime: (time: Date) => void;
  isTimeMachineEnabled?: boolean;
  setTimeMachineEnabled?: (enabled: boolean) => void;
  events?: any;
  setMapVisible?: (visible: boolean) => void;
}

export const Sim3DContainer: React.FC<Sim3DContainerProps> = ({
  theme,
  currentTime,
  setCurrentTime,
  isTimeMachineEnabled = true,
  setTimeMachineEnabled,
  events,
  setMapVisible,
}) => {
  const { location } = useCelestialStore();
  const [isLayerModalVisible, setLayerModalVisible] = useState(false);
  const [layers, setLayers] = useState<LayerState>({
    sun: true,
    moon: true,
    stars: true,
    milkyway: true,
    planets: true,
    clouds: true,
    paths: true,
  });
  const [skySettings, setSkySettings] = useState<SkySettings>(DEFAULT_SKY_SETTINGS);

  const latitude = location?.coords.latitude ?? 37.5665;
  const longitude = location?.coords.longitude ?? 126.9780;

  // 3D 지형 실루엣 및 사용자 해발 고도 State
  const [terrainData, setTerrainData] = useState<{
    panoramicAngles: number[];
    observerElevation: number;
  }>({
    panoramicAngles: [],
    observerElevation: location?.coords.altitude ?? 50,
  });

  useEffect(() => {
    if (latitude && longitude) {
      fetchTerrainProfile(latitude, longitude, 0, 360)
        .then(tData => {
          if (tData && Array.isArray(tData.panoramicAngles)) {
            setTerrainData({
              panoramicAngles: tData.panoramicAngles,
              observerElevation: tData.observerElevation ?? location?.coords?.altitude ?? 50,
            });
          }
        })
        .catch(err => {
          console.log('3D terrain profile fetch error:', err);
        });
    }
  }, [latitude, longitude]);

  const simObj = useMemo(() => ({
    terrain: {
      panoramicAngles: terrainData.panoramicAngles,
      observerElevation: terrainData.observerElevation,
    },
  }), [terrainData]);

  const sunPos = SunCalc.getPosition(currentTime, latitude, longitude);
  const sunAltitude = (sunPos.altitude * 180) / Math.PI;
  const sunAzimuth = (sunPos.azimuth * 180) / Math.PI + 180;

  return (
    <View style={styles.container}>
      <View style={styles.sceneWrapper}>
        <SkyScene3D
          sim={simObj}
          currentTime={currentTime}
          sunAltitude={sunAltitude}
          sunAzimuth={sunAzimuth}
          prediction={null}
          location={location}
          interpolatedWeather={[]}
          theme={theme}
          layers={layers}
          skySettings={skySettings}
          fullScreen={true}
        />
        
        <TouchableOpacity
          style={[styles.layerControlButton, { backgroundColor: 'rgba(5, 5, 10, 0.65)', borderColor: theme.border }]}
          onPress={() => setLayerModalVisible(true)}
          activeOpacity={0.7}
        >
          <SlidersHorizontal size={14} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* 3D 뷰어 하단 시간 슬라이더 */}
      <View style={[styles.bottomPanel, { backgroundColor: theme.glass, borderColor: theme.border }]}>
        <TimeSlider 
          value={currentTime}
          onChange={setCurrentTime}
          isTimeMachineEnabled={isTimeMachineEnabled}
          onToggleTimeMachine={setTimeMachineEnabled}
          theme={theme}
          isDay={true}
          onPressMap={() => setMapVisible && setMapVisible(true)}
          markers={events ? [
            { time: events.sunrise, color: '#FFA500', type: 'rise' },
            { time: events.sunset, color: '#FF4500', type: 'set' },
            { time: events.moonrise, color: '#888', type: 'rise' },
            { time: events.moonset, color: '#888', type: 'set' },
          ] : []}
        />
      </View>

      <LayerControlModal
        visible={isLayerModalVisible}
        onClose={() => setLayerModalVisible(false)}
        layers={layers}
        onToggleLayer={(key) => setLayers(prev => ({ ...prev, [key]: !prev[key] }))}
        skySettings={skySettings}
        onChangeSkySettings={(next) => setSkySettings(prev => ({ ...prev, ...next }))}
        theme={theme}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  sceneWrapper: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  layerControlButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  bottomPanel: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
});
