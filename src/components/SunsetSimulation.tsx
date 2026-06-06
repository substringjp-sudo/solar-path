import React, { useEffect, useMemo, useState, useRef } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Animated, TouchableOpacity, PanResponder, Platform, Alert } from 'react-native';
import { isAfter, addHours, addMinutes } from 'date-fns';
import SunCalc from 'suncalc';
import { useNetInfo } from '@react-native-community/netinfo';
import { getLocalTimeAtLocation, formatLocalTime } from '../utils/timezone';

import { useCelestialStore } from '../store/useCelestialStore';
import { fetchSunsetWeather, fetchTerrainProfile, CloudPathData, TerrainData, getDistance, getInterpolatedWeather, getLocalHighResModel } from '../utils/weather';
import { predictSunset, SunsetPrediction } from '../utils/sunsetPhysics';
import { fetchCloudGrid, CloudDensityGrid } from '../utils/cloudGrid';
import { convertGridToClouds, GridCloudShape } from '../utils/cloudGridRenderer';

import { OfflineView } from './SunsetSimulation/OfflineView';
import { PredictionCard } from './SunsetSimulation/PredictionCard';
import { SourceInfoModal } from './SunsetSimulation/SourceInfoModal';
import { Visualizer } from './SunsetSimulation/Visualizer';
import { TimeSlider } from './TimeSlider';
import { RotateCw, Layers, Zap, Info, AlertCircle, MapPin } from 'lucide-react-native';
import { WeatherDetailModal } from './SunsetSimulation/WeatherDetailModal';
 
interface SimulationState {
  type: 'Sunrise' | 'Sunset';
  eventTime: Date;
  trueEventTime?: Date;
  azimuth: number;
  fov: number;
  pathData: CloudPathData[];
  terrain: TerrainData;
  loading: boolean;
  weatherSource: 'standard' | 'ultra-short' | 'fallback';
}

interface SunsetSimulationProps {
  theme: any;
  currentTime: Date;
  setCurrentTime: (time: Date) => void;
  setMapVisible: (visible: boolean) => void;
}

export const SunsetSimulation: React.FC<SunsetSimulationProps> = (props) => {
  const { theme, currentTime, setCurrentTime, setMapVisible } = props;
  
  const { 
    location, 
    timezoneOffsetHours,
    weatherCacheList, 
    terrainCacheList, 
    addWeatherCache, 
    addTerrainCache 
  } = useCelestialStore();
  const netInfo = useNetInfo();
  
  const [visualFov, setVisualFov] = useState(20);
  const visualFovRef = useRef(20);
  React.useEffect(() => {
    visualFovRef.current = visualFov;
  }, [visualFov]);

  const [sim, setSim] = useState<SimulationState | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<string>('Preparing Simulation...');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [showSources, setShowSources] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const forceRefreshRef = useRef(false);
  const [cloudGridData, setCloudGridData] = useState<CloudDensityGrid | null>(null);
  const [enhancedLoading, setEnhancedLoading] = useState(false);
  const [isNowcastLoading, setIsNowcastLoading] = useState(false);
  const [isWeatherDetailVisible, setWeatherDetailVisible] = useState(false);

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

  const currentDateStr = useMemo(() => {
    const localTime = getLocalTimeAtLocation(currentTime, timezoneOffsetHours);
    return formatLocalTime(localTime, 'yyyy-MM-dd');
  }, [currentTime, timezoneOffsetHours]);


  const lastFetchedDateRef = useRef<string>('');

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length >= 2,
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          initialPinchDist.current = getTouchDistance(touches);
          initialFovOnPinch.current = visualFovRef.current;
        }
      },
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          // If the pinch baseline isn't captured yet (e.g., transition from 1 touch to 2),
          // immediately capture the current distance and visualFov as the benchmark!
          if (initialPinchDist.current === null) {
            initialPinchDist.current = getTouchDistance(touches);
            initialFovOnPinch.current = visualFovRef.current;
            return;
          }
          const currentDist = getTouchDistance(touches);
          if (currentDist > 0) {
            const ratio = initialPinchDist.current / currentDist;
            let targetFov = initialFovOnPinch.current * ratio;
            targetFov = Math.max(10, Math.min(30, targetFov));
            setVisualFov(targetFov);
          }
        } else {
          // Reset benchmark if fingers are lifted to ensure a smooth transition on next pinch
          initialPinchDist.current = null;
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
    
    if (lastFetchedDateRef.current === currentDateStr && !forceRefreshRef.current) {
      return;
    }
    
    let active = true;
    lastFetchedDateRef.current = currentDateStr;
    const isForceRefresh = forceRefreshRef.current;
    forceRefreshRef.current = false;

    setSim(null);
    setLoadingStatus(isForceRefresh ? 'Forcing Weather & Terrain Update...' : 'Preparing Simulation...');
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
        
        if (!isForceRefresh) {
          for (const item of terrainCacheList) {
            const dist = getDistance(latitude, longitude, item.latitude, item.longitude);
            if (dist <= minDistTerrain) {
              minDistTerrain = dist;
              foundTerrainCache = item;
            }
          }
        }
        
        if (foundTerrainCache) terrainData = foundTerrainCache.data;
        const shouldFetchTerrain = !terrainData;

        let weatherData = null;
        let foundWeatherCache = null;
        let minDistWeather = 2000;
        const timeLimit = 1800000;
        
        if (!isForceRefresh) {
          for (const item of weatherCacheList) {
            const dist = getDistance(latitude, longitude, item.latitude, item.longitude);
            const age = Date.now() - item.timestamp;
            if (dist <= minDistWeather && age <= timeLimit) {
              minDistWeather = dist;
              foundWeatherCache = item;
            }
          }
        }
        
        if (foundWeatherCache) weatherData = foundWeatherCache.data;
        const shouldFetchWeather = !weatherData;

        if (shouldFetchWeather || shouldFetchTerrain) {
          if (shouldFetchWeather && active) setLoadingStatus('Analyzing Weather Data...');
          
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
        } else {
          // 혹시라도 데이터가 없는 경우를 대비한 세이프 로딩 오프
          if (active) {
            setSim(prev => prev ? { ...prev, loading: false } : null);
          }
        }
      } catch (err) {
        if (active) {
          console.error("Simulation initialization failed:", err);
          setSim(prev => {
            if (prev) return { ...prev, loading: false };
            return {
              type: 'Sunset',
              eventTime: new Date(),
              azimuth: 270,
              fov: 20,
              pathData: [],
              terrain: { panoramicAngles: Array(61).fill(0), farAngles: Array(61).fill(0), minAz: 0, maxAz: 360, observerElevation: 50 },
              loading: false,
              weatherSource: 'standard'
            };
          });
        }
      }
    };
    fetchSim();

    return () => { active = false; };
  }, [location, currentDateStr, refreshTrigger]);

  const handleRefresh = () => {
    if (!sim || forceRefreshRef.current) return;
    forceRefreshRef.current = true;
    lastFetchedDateRef.current = '';
    setCloudGridData(null);
    setRefreshTrigger(prev => prev + 1);
  };

  const handleEnhancedCloud = async () => {
    if (!location || !sim || enhancedLoading) return;
    setEnhancedLoading(true);
    try {
      const { latitude, longitude } = location.coords;
      const grid = await fetchCloudGrid(latitude, longitude, sunAzimuth, currentTime);
      if (grid) {
        setCloudGridData(grid);
      }
    } catch (err) {
      console.error('Enhanced cloud fetch failed:', err);
    } finally {
      setEnhancedLoading(false);
    }
  };

  const isNowcastSupported = useMemo(() => {
    if (!location) return false;
    const model = getLocalHighResModel(location.coords.latitude, location.coords.longitude);
    return model !== 'best_match';
  }, [location]);

  const isWithinNowcastWindow = useMemo(() => {
    if (!sim?.eventTime) return false;
    const diff = sim.eventTime.getTime() - Date.now();
    // 일출/일몰 이벤트 시각 2시간 전부터 이벤트 후 1시간 사이
    return diff <= 2 * 60 * 60 * 1000 && diff >= -1 * 60 * 60 * 1000;
  }, [sim?.eventTime]);

  const showNowcastButton = isNowcastSupported && isWithinNowcastWindow && sim?.weatherSource !== 'ultra-short';

  const handleLoadNowcast = async () => {
    if (!location || !sim || isNowcastLoading) return;
    setIsNowcastLoading(true);
    try {
      const { latitude, longitude } = location.coords;
      const data = await fetchSunsetWeather(latitude, longitude, sim.azimuth, true);
      if (data && data.length > 0) {
        setSim(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            pathData: data,
            weatherSource: 'ultra-short'
          };
        });
        addWeatherCache({
          key: `w_nowcast_${latitude.toFixed(4)}_${longitude.toFixed(4)}`,
          data,
          timestamp: Date.now(),
          latitude,
          longitude
        });
        Alert.alert('정밀 예보 적용 완료', '초단기 국지 기상 모델(Nowcast)이 성공적으로 반영되었습니다.');
      } else {
        Alert.alert('알림', '초단기 정밀 기상 데이터를 가져올 수 없습니다. 잠시 후 다시 시도해 주세요.');
      }
    } catch (err) {
      console.error('Failed to load nowcast weather:', err);
      Alert.alert('에러', '초단기 정밀 예보를 로드하는 도중 오류가 발생했습니다.');
    } finally {
      setIsNowcastLoading(false);
    }
  };

  const gridCloudShapes = useMemo<GridCloudShape[]>(() => {
    if (!cloudGridData) return [];
    return convertGridToClouds(cloudGridData, sim?.terrain?.observerElevation ?? 50);
  }, [cloudGridData, sim?.terrain?.observerElevation]);

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

  const obsHourly = useMemo(() => {
    if (!sim?.pathData || sim.pathData.length === 0) return null;
    return getInterpolatedWeather(sim.pathData, currentTime)[0];
  }, [sim?.pathData, currentTime]);

  const prediction = useMemo<SunsetPrediction | null>(() => {
    if (!sim?.pathData || sim.pathData.length < 4) return null;
    return predictSunset(
      sim.pathData,
      currentTime,
      sunAltitude,
      obsHourly?.visibility,
      obsHourly?.humidity,
      location?.coords?.latitude,
      location?.coords?.altitude ?? sim?.terrain?.observerElevation ?? 0,
    );
  }, [sim?.pathData, currentTime, sunAltitude, obsHourly, location?.coords?.latitude, location?.coords?.altitude, sim?.terrain?.observerElevation]);

  const pm25 = useMemo(() => {
    const beta = prediction?.factors?.aerosolBeta ?? 0.08;
    return Math.round(beta * 280);
  }, [prediction]);

  const interpolatedWeather = useMemo(() => {
    if (!sim?.pathData) return [];
    return getInterpolatedWeather(sim.pathData, currentTime);
  }, [sim?.pathData, currentTime]);

  const gridPanelData = useMemo(() => {
    if (!cloudGridData) return null;
    
    // Choose 4 representative distance rings matching the spacing of the original panel
    const targetRings = [10, 80, 170, 380];
    
    return targetRings.map(dist => {
      const pointsAtDist = cloudGridData.points.filter(p => p.distance === dist);
      if (pointsAtDist.length === 0) {
        return { distance: dist, low: 0, mid: 0, high: 0 };
      }
      
      const lowSum = pointsAtDist.reduce((sum, p) => sum + p.low, 0);
      const midSum = pointsAtDist.reduce((sum, p) => sum + p.mid, 0);
      const highSum = pointsAtDist.reduce((sum, p) => sum + p.high, 0);
      const count = pointsAtDist.length;
      
      return {
        distance: dist,
        low: Math.round(lowSum / count),
        mid: Math.round(midSum / count),
        high: Math.round(highSum / count),
      };
    });
  }, [cloudGridData]);

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

  // 5-Ray * 7-Distance (총 35개 지격) 매트릭스 변환
  const miniGridMatrix = useMemo(() => {
    if (!interpolatedWeather || interpolatedWeather.length < 36) return [];
    const matrix: any[][] = [];
    const distances = [380, 280, 200, 130, 70, 30, 10]; // top to bottom
    const gridAngles = [-20, -10, 0, 10, 20];
    
    distances.forEach((dist) => {
      const row: any[] = [];
      gridAngles.forEach((ang) => {
        const angleIdx = gridAngles.indexOf(ang);
        const distIdx = [10, 30, 70, 130, 200, 280, 380].indexOf(dist);
        const dataIdx = 1 + angleIdx * 7 + distIdx;
        row.push(interpolatedWeather[dataIdx] || { low: 0, mid: 0, high: 0 });
      });
      matrix.push(row);
    });
    return matrix;
  }, [interpolatedWeather]);

  // 구름 고도별 혼합 색상 (저=SteelBlue, 중=MediumPurple, 고=HotPink)
  const getCellColor = (low: number, mid: number, high: number) => {
    const sum = low + mid + high;
    if (sum === 0) return 'rgba(255, 255, 255, 0.05)';
    const r = Math.round((high * 255 + mid * 147 + low * 70) / sum);
    const g = Math.round((high * 105 + mid * 112 + low * 130) / sum);
    const b = Math.round((high * 180 + mid * 219 + low * 180) / sum);
    const maxVal = Math.max(low, mid, high);
    const opacity = 0.2 + (maxVal / 100) * 0.8;
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  const getMiniAltitudeColor = (val: number, type: 'low' | 'mid' | 'high') => {
    if (val === 0) return 'rgba(255, 255, 255, 0.05)';
    let r = 70, g = 130, b = 180;
    if (type === 'mid') {
      r = 147; g = 112; b = 219;
    } else if (type === 'high') {
      r = 255; g = 105; b = 180;
    }
    const opacity = 0.15 + (val / 100) * 0.85;
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  // Update weather pathData dynamically if the camera heading (sunAzimuth) drifts too far from the sampled azimuth
  useEffect(() => {
    if (!location || !sim || sim.loading) return;
    
    const { latitude, longitude } = location.coords;
    const currentAz = sunAzimuth;
    
    // Calculate shortest angular distance between current sun azimuth and simulated (sampled) azimuth
    let diff = Math.abs(currentAz - sim.azimuth);
    diff = diff > 180 ? 360 - diff : diff;
    
    // If the difference is greater than 35 degrees, fetch updated pathData for this direction!
    if (diff > 35) {
      let active = true;
      const fetchUpdatedWeather = async () => {
        try {
          const newWeather = await fetchSunsetWeather(latitude, longitude, currentAz);
          if (active && newWeather) {
            setSim(prev => {
              if (!prev) return null;
              return {
                ...prev,
                azimuth: currentAz,
                pathData: newWeather,
                weatherSource: newWeather[0]?.source || prev.weatherSource
              };
            });
          }
        } catch (err) {
          console.error('Failed to update weather for new azimuth:', err);
        }
      };
      
      // Debounce slightly to prevent rapid API requests when user drags slider
      const timer = setTimeout(fetchUpdatedWeather, 450);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }
  }, [sunAzimuth, location, sim?.loading]);

  if (!theme) return null;
  if (netInfo.isConnected === false) return <OfflineView theme={theme} />;

  return (
    <View style={styles.container}>
      {!simLoaded ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={[styles.loadingText, { color: theme.text, marginTop: 12 }]}>{loadingStatus}</Text>
          <Text style={[styles.loadingSubText, { color: theme.subText }]}>
            {loadingStatus.includes('Weather') ? 'Collecting global weather model data' : 'Generating terrain elevation profile'}
          </Text>
        </View>
      ) : (
        <Animated.View style={[styles.mainWrapper, { opacity: fadeAnim }]}>
          <View style={styles.visualizerWrapper}>
            <Visualizer
              sim={sim}
              currentTime={currentTime}
              sunAltitude={sunAltitude}
              heading={heading}
              visualFov={visualFov}
              onFovChange={setVisualFov}
              prediction={prediction}
              panHandlers={panResponder.panHandlers}
              theme={theme}
              interpolatedWeather={interpolatedWeather}
              isSunVisible={isSunVisible}
              eventAzimuths={eventAzimuths}
              gridCloudShapes={gridCloudShapes}
              location={location}
            />
            {showNowcastButton && (
              <TouchableOpacity 
                style={[styles.nowcastButton, { backgroundColor: isNowcastLoading ? 'rgba(255, 215, 0, 0.35)' : 'rgba(5, 5, 10, 0.65)', borderColor: theme.border }]}
                onPress={handleLoadNowcast}
                activeOpacity={0.7}
                disabled={isNowcastLoading}
              >
                {isNowcastLoading ? (
                  <ActivityIndicator size={10} color="#FFFFFF" />
                ) : (
                  <Zap size={12} color="#FFD700" />
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity 
              style={[styles.enhancedButton, { backgroundColor: cloudGridData ? 'rgba(70, 130, 180, 0.7)' : 'rgba(5, 5, 10, 0.65)', borderColor: cloudGridData ? 'rgba(100, 160, 210, 0.6)' : theme.border }]}
              onPress={handleEnhancedCloud}
              activeOpacity={0.7}
            >
              {enhancedLoading ? (
                <ActivityIndicator size={10} color="#FFFFFF" />
              ) : (
                <Layers size={12} color={cloudGridData ? '#FFFFFF' : 'rgba(255,255,255,0.7)'} />
              )}
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.refreshButton, { backgroundColor: 'rgba(5, 5, 10, 0.65)', borderColor: theme.border }]}
              onPress={handleRefresh}
              activeOpacity={0.7}
            >
              <RotateCw size={12} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.bottomSection}>
            {sim?.weatherSource === 'fallback' && (
              <TouchableOpacity
                style={[
                  styles.warningBanner,
                  {
                    backgroundColor: 'rgba(255, 92, 63, 0.08)',
                    borderColor: 'rgba(255, 92, 63, 0.25)',
                  }
                ]}
                onPress={() => {
                  Alert.alert(
                    '기상 정보 수신 실패',
                    '기상 API 서버(Open-Meteo)의 장애 또는 단시간 과도한 요청에 의한 일시적 IP 제한으로 실시간 날씨 정보를 가져올 수 없습니다.\n\n현재 맑은 날(기본값)로 임시 시뮬레이션 중이며, 10분 정도 대기 후 다시 날씨 갱신 버튼을 눌러주세요.',
                    [{ text: '확인', style: 'default' }]
                  );
                }}
                activeOpacity={0.7}
              >
                <AlertCircle size={13} color="#FF5C3F" style={{ marginRight: 6 }} />
                <Text style={styles.warningBannerText}>
                  실시간 기상 수신 실패 (임시 데이터 적용됨) · 상세 보기
                </Text>
              </TouchableOpacity>
            )}

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
                <Text style={[styles.aerosolTitle, { color: theme.text }]}>Aerosols & Humidity</Text>
                <View style={styles.aerosolRow}>
                  <View style={styles.aerosolCol}>
                    <Text style={[styles.aerosolVal, { color: theme.text }]}>
                      {obsHourly?.humidity != null ? Math.round(obsHourly.humidity) : 50}
                      <Text style={styles.aerosolUnit}>%</Text>
                    </Text>
                    <Text style={[styles.aerosolLabel, { color: theme.subText }]}>RH</Text>
                  </View>
                  
                  <View style={[styles.miniDivider, { backgroundColor: theme.border }]} />
                  
                  <View style={styles.aerosolCol}>
                    <Text style={[styles.aerosolVal, { 
                      color: pm25 <= 15 ? '#4DA0B0' : pm25 <= 35 ? '#E6C25A' : pm25 <= 75 ? '#FF8A3D' : '#FF5C3F'
                    }]}>
                      {pm25}
                      <Text style={styles.aerosolUnit}>㎍</Text>
                    </Text>
                    <Text style={[styles.aerosolLabel, { color: theme.subText }]}>PM2.5</Text>
                  </View>
                </View>
              </View>

              <View style={[styles.verticalDivider, { backgroundColor: theme.border }]} />

              <TouchableOpacity 
                style={styles.unifiedRightSection} 
                onPress={() => setWeatherDetailVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={[styles.gridTitleText, { color: theme.text }]}>Cloud Radar Grid</Text>
                
                <View style={styles.miniGridContainer}>
                  {miniGridMatrix.map((row, rIdx) => (
                    <View key={rIdx} style={styles.miniGridRow}>
                      {row.map((cell, cIdx) => {
                        // Calculate width and margin dynamically to form an inverted triangle (trapezoid)
                        const cellWidth = 10 - rIdx * 0.9;
                        const cellMargin = 1.0 - rIdx * 0.08;
                        return (
                          <View
                            key={cIdx}
                            style={[
                              styles.miniGridCell, 
                              { 
                                borderColor: theme.border,
                                width: cellWidth,
                                marginHorizontal: cellMargin,
                                overflow: 'hidden'
                              }
                            ]}
                          >
                            <View style={{ flex: 1, width: '100%', height: '100%' }}>
                              <View style={{ flex: 1, width: '100%', backgroundColor: getMiniAltitudeColor(cell.high, 'high') }} />
                              <View style={{ flex: 1, width: '100%', backgroundColor: getMiniAltitudeColor(cell.mid, 'mid') }} />
                              <View style={{ flex: 1, width: '100%', backgroundColor: getMiniAltitudeColor(cell.low, 'low') }} />
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
                
                <View style={styles.detailHintRow}>
                  <Info size={8} color={theme.accent} style={{ marginRight: 3 }} />
                  <Text style={[styles.detailHintText, { color: theme.subText }]}>
                    380km Radius Map (Tap)
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            <View style={[styles.simControl, { backgroundColor: theme.glass, borderColor: theme.border, position: 'relative' }]}>
              <TouchableOpacity
                onPress={() => setMapVisible(true)}
                style={[styles.floatingMapBtn, { backgroundColor: theme.accent }]}
                activeOpacity={0.7}
              >
                <MapPin size={14} color="#000" />
              </TouchableOpacity>
              <TimeSlider 
                mode="relative"
                value={currentTime}
                onChange={setCurrentTime}
                baseTime={sim?.eventTime || new Date()}
                theme={theme}
                isDay={sunAltitude > 0}
                markers={[
                  {
                    time: sim?.eventTime || null,
                    color: sim?.type === 'Sunrise' ? '#FFA500' : '#FF4500',
                    type: sim?.type === 'Sunrise' ? 'rise' : 'set'
                  }
                ]}
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

      <WeatherDetailModal
        visible={isWeatherDetailVisible}
        onClose={() => setWeatherDetailVisible(false)}
        theme={theme}
        pathData={sim?.pathData || []}
        interpolatedWeather={interpolatedWeather}
        currentTime={currentTime}
        weatherSource={sim?.weatherSource || 'standard'}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 0, backgroundColor: 'transparent' },
  mainWrapper: { flex: 1, justifyContent: 'space-between' },
  visualizerWrapper: {
    position: 'relative',
    width: '100%',
  },
  nowcastButton: {
    position: 'absolute',
    top: 8,
    right: 72,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  enhancedButton: {
    position: 'absolute',
    top: 8,
    right: 40,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 999,
  },
  refreshButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 999,
  },
  bottomSection: { gap: 6, marginTop: 'auto' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', height: 300 },
  loadingText: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  loadingSubText: { fontSize: 11, opacity: 0.6 },
  simControl: { 
    paddingVertical: 10,
    justifyContent: 'center', 
    borderRadius: 28, 
    borderWidth: Platform.OS === 'android' ? 0 : 1, 
    marginBottom: 24, // 트래커의 bottomPanel marginBottom: 24와 완벽하게 일치!
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
    height: 84,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: Platform.OS === 'android' ? 4 : 2,
    marginBottom: 4,
  },
  unifiedLeftSection: {
    flex: 1.35,
    justifyContent: 'center',
    gap: 4,
  },
  verticalDivider: {
    width: 1,
    height: '65%',
    marginHorizontal: 8,
  },
  unifiedRightSection: {
    flex: 1.9,
    justifyContent: 'center',
    paddingVertical: 2,
  },
  gridTitleText: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
    opacity: 0.85,
    marginBottom: 4,
    textAlign: 'center',
  },
  miniGridContainer: {
    flex: 1,
    justifyContent: 'center',
    marginVertical: 1,
    paddingHorizontal: 2,
  },
  miniGridRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginVertical: 0.6,
  },
  miniGridCell: {
    width: 8,
    height: 4.8,
    borderRadius: 1.2,
    marginHorizontal: 0.8,
    borderWidth: 0.3,
  },
  detailHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  detailHintText: {
    fontSize: 7,
    fontWeight: '700',
    opacity: 0.7,
  },
  aerosolTitle: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    opacity: 0.85,
    marginBottom: 2,
  },
  aerosolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  aerosolCol: {
    alignItems: 'center',
    flex: 1,
  },
  aerosolVal: {
    fontSize: 14,
    fontWeight: '900',
  },
  aerosolUnit: {
    fontSize: 8,
    fontWeight: '600',
    opacity: 0.7,
  },
  aerosolLabel: {
    fontSize: 8,
    fontWeight: '600',
    marginTop: 1,
  },
  miniDivider: {
    width: 1,
    height: 12,
    opacity: 0.3,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 6,
    justifyContent: 'center',
  },
  warningBannerText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FF5C3F',
  },
  floatingMapBtn: {
    position: 'absolute',
    top: -16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
});
