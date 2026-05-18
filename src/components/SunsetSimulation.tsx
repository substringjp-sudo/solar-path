import React, { useEffect, useMemo, useState, useRef } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Animated, TouchableOpacity, useWindowDimensions, PanResponder, Platform } from 'react-native';
import { format, isAfter, addHours, addMinutes } from 'date-fns';
import SunCalc from 'suncalc';
import { useNetInfo } from '@react-native-community/netinfo';

import { useCelestialStore } from '../store/useCelestialStore';
import { fetchSunsetWeather, fetchTerrainProfile, CloudPathData, TerrainData, getDistance, getInterpolatedWeather } from '../utils/weather';
import { predictSunset, SunsetPrediction } from '../utils/sunsetPhysics';

import { OfflineView } from './SunsetSimulation/OfflineView';
import { PredictionCard } from './SunsetSimulation/PredictionCard';
import { SourceInfoModal } from './SunsetSimulation/SourceInfoModal';
import { Visualizer } from './SunsetSimulation/Visualizer';
import { TimeSlider } from './TimeSlider';

interface SimulationState {
  type: 'Sunrise' | 'Sunset';
  eventTime: Date;
  trueEventTime?: Date;
  azimuth: number;
  fov: number;
  pathData: CloudPathData[];
  terrain: TerrainData;
  loading: boolean;
  weatherSource: 'standard' | 'ultra-short';
}

interface SunsetSimulationProps {
  theme: any;
  currentTime: Date;
  setCurrentTime: (time: Date) => void;
}

export const SunsetSimulation: React.FC<SunsetSimulationProps> = (props) => {
  const { theme, currentTime, setCurrentTime } = props;
  const { width, height } = useWindowDimensions();
  
  if (!theme) return null;
  
  const { 
    location, 
    weatherCacheList, 
    terrainCacheList, 
    addWeatherCache, 
    addTerrainCache 
  } = useCelestialStore();
  const netInfo = useNetInfo();
  
  const [visualFov, setVisualFov] = useState(20);
  const [sim, setSim] = useState<SimulationState | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<string>('시뮬레이션 준비 중...');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [showSources, setShowSources] = useState(false);

  const [eventAzimuths, setEventAzimuths] = useState({ sunrise: 0, sunset: 0 });

  const getTouchDistance = (touches: any[]) => {
    const [t1, t2] = touches;
    if (!t1 || !t2) return 0;
    const dx = t1.pageX - t2.pageX;
    const dy = t1.pageY - t2.pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const initialPinchDist = useRef<number | null>(null);
  const initialFovOnPinch = useRef<number>(20);

  const currentDateStr = useMemo(() => format(currentTime, 'yyyy-MM-dd'), [currentTime]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          initialPinchDist.current = getTouchDistance(touches);
          initialFovOnPinch.current = visualFov;
        }
      },
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2 && initialPinchDist.current !== null) {
          const currentDist = getTouchDistance(touches);
          if (currentDist > 0) {
            const ratio = initialPinchDist.current / currentDist;
            let targetFov = initialFovOnPinch.current * ratio;
            targetFov = Math.max(10, Math.min(30, targetFov));
            setVisualFov(targetFov);
          }
        }
      },
      onPanResponderRelease: () => {
        initialPinchDist.current = null;
      },
      onPanResponderTerminate: () => {
        initialPinchDist.current = null;
      },
    })
  ).current;

  useEffect(() => {
    if (!location) return;
    let active = true;

    setSim(null);
    setLoadingStatus('시뮬레이션 준비 중...');
    fadeAnim.setValue(0);

    const fetchSim = async () => {
      try {
        const { latitude, longitude } = location.coords;
        const now = new Date(currentTime);
        const times = SunCalc.getTimes(now, latitude, longitude);
        let nextEvent: Date;
        let type: 'Sunrise' | 'Sunset';

        if (isAfter(now, times.sunset)) {
          nextEvent = SunCalc.getTimes(addHours(now, 24), latitude, longitude).sunrise;
          type = 'Sunrise';
        } else if (isAfter(now, times.sunrise)) {
          nextEvent = times.sunset;
          type = 'Sunset';
        } else {
          nextEvent = times.sunrise;
          type = 'Sunrise';
        }
        const pos = SunCalc.getPosition(nextEvent as any, latitude, longitude);
        const az = (pos.azimuth * 180 / Math.PI) + 180;

        let terrainData = null;
        let foundTerrainCache = null;
        let minDistTerrain = 500;
        
        for (const item of terrainCacheList) {
          const dist = getDistance(latitude, longitude, item.latitude, item.longitude);
          if (dist <= minDistTerrain) {
            minDistTerrain = dist;
            foundTerrainCache = item;
          }
        }
        
        if (foundTerrainCache) terrainData = foundTerrainCache.data;
        const shouldFetchTerrain = !terrainData;

        let weatherData = null;
        let foundWeatherCache = null;
        let minDistWeather = 2000;
        const timeLimit = 1800000;
        
        for (const item of weatherCacheList) {
          const dist = getDistance(latitude, longitude, item.latitude, item.longitude);
          const age = Date.now() - item.timestamp;
          if (dist <= minDistWeather && age <= timeLimit) {
            minDistWeather = dist;
            foundWeatherCache = item;
          }
        }
        
        if (foundWeatherCache) weatherData = foundWeatherCache.data;
        const shouldFetchWeather = !weatherData;

        if (shouldFetchWeather || shouldFetchTerrain) {
          if (shouldFetchWeather && active) setLoadingStatus('기상 데이터 분석 중...');
          
          const [newWeather, newTerrain] = await Promise.all([
            shouldFetchWeather ? fetchSunsetWeather(latitude, longitude, az) : Promise.resolve(weatherData),
            shouldFetchTerrain ? fetchTerrainProfile(latitude, longitude, 0, 360, (msg) => {
              if (active) setLoadingStatus(msg);
            }) : Promise.resolve(terrainData)
          ]);

          if (!active) return;

          if (shouldFetchWeather && newWeather) {
            weatherData = newWeather;
            addWeatherCache({ key: `w_${latitude.toFixed(4)}_${longitude.toFixed(4)}`, data: newWeather, timestamp: Date.now(), latitude, longitude });
          }
          if (shouldFetchTerrain && newTerrain) {
            terrainData = newTerrain;
            addTerrainCache({ key: `t_${latitude.toFixed(4)}_${longitude.toFixed(4)}`, data: newTerrain, timestamp: Date.now(), latitude, longitude });
          }
        }

        if (!active) return;

        if (weatherData && terrainData) {
          const trueEventTime = calculateTrueEventTime(nextEvent, type, latitude, longitude, terrainData as TerrainData);

          if (!active) return;

          setSim({ 
            type, 
            eventTime: nextEvent, 
            trueEventTime,
            azimuth: az, 
            fov: 20, 
            pathData: weatherData as CloudPathData[], 
            terrain: terrainData as TerrainData, 
            loading: false,
            weatherSource: (weatherData as CloudPathData[])[0]?.source || 'standard'
          });
          setCurrentTime(nextEvent);
          const sTimes = SunCalc.getTimes(now, latitude, longitude);
          setEventAzimuths({
            sunrise: (SunCalc.getPosition(sTimes.sunrise, latitude, longitude).azimuth * 180 / Math.PI) + 180,
            sunset: (SunCalc.getPosition(sTimes.sunset, latitude, longitude).azimuth * 180 / Math.PI) + 180
          });
          Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start();
        }
      } catch (err) { if (active) console.error(err); }
    };
    fetchSim();

    return () => { active = false; };
  }, [location, currentDateStr]);

  if (netInfo.isConnected === false) return <OfflineView theme={theme} />;

  const simLoaded = !!sim;
  const calculateTrueEventTime = (baseTime: Date, type: 'Sunrise' | 'Sunset', lat: number, lon: number, terrain: TerrainData) => {
    const startOffset = -30;
    const endOffset = 90;
    let bestTime = baseTime;
    for (let offset = startOffset; offset < endOffset; offset += 0.5) {
      const checkTime = addMinutes(baseTime, offset);
      const pos = SunCalc.getPosition(checkTime, lat, lon);
      const alt = pos.altitude * (180 / Math.PI);
      const az = (pos.azimuth * 180 / Math.PI) + 180;
      const angles = terrain.panoramicAngles;
      const normalizedAz = ((az % 360) + 360) % 360;
      const index = (normalizedAz / 360) * (angles.length - 1);
      const i1 = Math.floor(index);
      const i2 = (i1 + 1) % angles.length;
      const ratio = index - i1;
      const terrainAngle = angles[i1] * (1 - ratio) + angles[i2] * ratio;
      if (type === 'Sunset') { if (alt <= terrainAngle) return checkTime; } 
      else { if (alt >= terrainAngle) return checkTime; }
    }
    return bestTime;
  };

  const sunPos = SunCalc.getPosition(currentTime, location?.coords.latitude || 0, location?.coords.longitude || 0);
  const sunAltitude = sunPos.altitude * (180 / Math.PI);
  const sunAzimuth = (sunPos.azimuth * 180 / Math.PI) + 180;
  const heading = sunAzimuth;

  const prediction = useMemo<SunsetPrediction | null>(() => {
    if (!sim?.pathData || sim.pathData.length < 4) return null;
    const obsHourly = getInterpolatedWeather(sim.pathData, currentTime)[0];
    return predictSunset(
      sim.pathData,
      currentTime,
      sunAltitude,
      obsHourly?.visibility,
      obsHourly?.humidity,
      location?.coords?.latitude,
      location?.coords?.altitude ?? sim?.terrain?.observerElevation ?? 0,
    );
  }, [sim?.pathData, currentTime, sunAltitude, location?.coords?.latitude, location?.coords?.altitude, sim?.terrain?.observerElevation]);

  const interpolatedWeather = useMemo(() => {
    if (!sim?.pathData) return [];
    return getInterpolatedWeather(sim.pathData, currentTime);
  }, [sim?.pathData, currentTime]);

  const isSunVisible = useMemo(() => {
    if (!sim?.terrain) return sunAltitude > 0;
    const angles = sim.terrain.panoramicAngles;
    const normalizedAz = ((heading % 360) + 360) % 360;
    const index = (normalizedAz / 360) * (angles.length - 1);
    const i1 = Math.floor(index);
    const i2 = (i1 + 1) % angles.length;
    const ratio = index - i1;
    const terrainAngle = angles[i1] * (1 - ratio) + angles[i2] * ratio;
    return sunAltitude > terrainAngle;
  }, [sim?.terrain, sunAltitude, heading]);

  return (
    <View style={styles.container}>
      {!simLoaded ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={[styles.loadingText, { color: theme.text, marginTop: 12 }]}>{loadingStatus}</Text>
          <Text style={[styles.loadingSubText, { color: theme.subText }]}>
            {loadingStatus.includes('기상') ? '전세계 기상 모델 데이터 수집 중' : '지형 고도 분석 데이터 생성 중'}
          </Text>
        </View>
      ) : (
        <Animated.View style={[styles.mainWrapper, { opacity: fadeAnim }]}>
          <Visualizer
            sim={sim}
            currentTime={currentTime}
            sunAltitude={sunAltitude}
            heading={heading}
            visualFov={visualFov}
            prediction={prediction}
            panHandlers={panResponder.panHandlers}
            theme={theme}
            interpolatedWeather={interpolatedWeather}
            isSunVisible={isSunVisible}
            eventAzimuths={eventAzimuths}
          />

          <View style={styles.bottomSection}>
            {prediction && (
              <PredictionCard
                prediction={prediction}
                theme={theme}
                weatherSource={sim.weatherSource}
                isSunrise={sim.type === 'Sunrise'}
                onPressSource={() => setShowSources(true)}
              />
            )}

            <View style={[styles.unifiedCard, { backgroundColor: theme.glass, borderColor: theme.border }]}>
              <View style={styles.unifiedLeftSection}>
                <View style={styles.sourceBadgeRow}>
                  <Text style={[styles.heroTitle, { color: theme.text }]}>
                    {sim?.type === 'Sunrise' ? 'Actual Dawn' : 'Actual Twilight'}
                  </Text>
                  <TouchableOpacity 
                    style={[styles.sourceBadge, { backgroundColor: sim?.weatherSource === 'ultra-short' ? 'rgba(77, 160, 176, 0.2)' : 'rgba(255, 255, 255, 0.05)' }]}
                    onPress={() => setShowSources(true)}
                  >
                    <Text style={[styles.sourceBadgeText, { color: sim?.weatherSource === 'ultra-short' ? '#4DA0B0' : theme.subText }]}>
                      {sim?.weatherSource === 'ultra-short' ? '초단기정밀' : '글로벌표준'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.heroTime, { color: theme.accent }]}>
                  {format(sim?.trueEventTime || sim?.eventTime || new Date(), 'HH:mm')}
                </Text>
              </View>

              <View style={[styles.verticalDivider, { backgroundColor: theme.border }]} />

              <View style={styles.unifiedRightSection}>
                <View style={styles.unifiedCloudGrid}>
                  {sim?.pathData?.slice(0, 4).map((c, i) => {
                    const interpolated = interpolatedWeather[i];
                    return (
                      <View key={i} style={styles.unifiedGridItem}>
                        <Text style={[styles.gridDist, { color: theme.subText }]}>{c?.distance === 0 ? 'Loc' : `${c?.distance || 0}k`}</Text>
                        <View style={styles.miniBars}>
                          <View style={[styles.miniBar, { height: `${Math.max(5, interpolated?.high ?? 0)}%`, backgroundColor: '#FF69B4' }]} />
                          <View style={[styles.miniBar, { height: `${Math.max(5, interpolated?.mid ?? 0)}%`, backgroundColor: '#9370DB' }]} />
                          <View style={[styles.miniBar, { height: `${Math.max(5, interpolated?.low ?? 0)}%`, backgroundColor: '#4682B4' }]} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>

            <View style={[styles.simControl, { backgroundColor: theme.glass, borderColor: theme.border }]}>
              <TimeSlider 
                mode="relative"
                value={currentTime}
                onChange={setCurrentTime}
                baseTime={sim?.eventTime || new Date()}
                theme={theme}
                isDay={sunAltitude > 0}
              />
            </View>
          </View>
        </Animated.View>
      )}

      <SourceInfoModal
        visible={showSources}
        onClose={() => setShowSources(false)}
        theme={theme}
        weatherSource={sim?.weatherSource}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, backgroundColor: 'transparent' },
  mainWrapper: { flex: 1, justifyContent: 'space-between' },
  bottomSection: { gap: 6, marginTop: 'auto' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', height: 300 },
  loadingText: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  loadingSubText: { fontSize: 11, opacity: 0.6 },
  simControl: { 
    height: 108, 
    justifyContent: 'center', 
    borderRadius: 28, 
    borderWidth: Platform.OS === 'android' ? 0 : 1, 
    paddingVertical: 10,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: Platform.OS === 'android' ? 18 : 15,
  },
  unifiedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    height: 80,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: Platform.OS === 'android' ? 4 : 2,
    marginBottom: 8,
  },
  unifiedLeftSection: {
    flex: 1.2,
    justifyContent: 'center',
  },
  verticalDivider: {
    width: 1,
    height: '60%',
    marginHorizontal: 12,
  },
  unifiedRightSection: {
    flex: 2.2,
    justifyContent: 'center',
  },
  unifiedCloudGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  unifiedGridItem: {
    alignItems: 'center',
    flex: 1,
  },
  sourceBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  sourceBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)' },
  sourceBadgeText: { fontSize: 8, fontWeight: '900' },
  heroTitle: { fontSize: 13, fontWeight: '900' },
  heroTime: { fontSize: 18, fontWeight: '900', marginTop: 2 },
  gridDist: { fontSize: 9, fontWeight: '700', marginBottom: 4 },
  miniBars: { flexDirection: 'row', gap: 2.5, height: 25, alignItems: 'flex-end' },
  miniBar: { width: 4.5, borderRadius: 2.5 }
});
