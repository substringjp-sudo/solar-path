import React, { useEffect, useMemo, useState, useRef } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Dimensions, Animated, Platform, TouchableOpacity, Linking, Modal } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Polygon, Rect } from 'react-native-svg';
import { Sun, Compass, AlertCircle, Cloud, WifiOff, Maximize, Info, ExternalLink } from 'lucide-react-native';
import { format, addMinutes, isAfter, addHours, subMinutes } from 'date-fns';
import { TimeSlider } from './TimeSlider';
import SunCalc from 'suncalc';
import { Magnetometer } from 'expo-sensors';
import { useNetInfo } from '@react-native-community/netinfo';
import { GenericSlider } from './GenericSlider';

import { useCelestialStore } from '../store/useCelestialStore';
import { fetchSunsetWeather, fetchTerrainProfile, CloudPathData, TerrainData, getDistance, getInterpolatedWeather } from '../utils/weather';
import { predictSunset, SunsetPrediction } from '../utils/sunsetPhysics';

const qualityColor = (q: SunsetPrediction['quality']): string => {
  switch (q) {
    case 'Epic': return '#FF5C3F';
    case 'Great': return '#FF8A3D';
    case 'Fair': return '#E6C25A';
    case 'Muted': return '#9AA1AA';
    case 'Overcast': return '#6B7886';
  }
};

const FactorBar: React.FC<{ label: string; value: number; color: string; theme: any; inverted?: boolean }> = ({
  label, value, color, theme, inverted,
}) => {
  const display = Math.max(0, Math.min(1, value));
  const fillPct = Math.round(display * 100);
  return (
    <View style={styles.factorBar}>
      <View style={styles.factorBarLabelRow}>
        <Text style={[styles.factorBarLabel, { color: theme.subText }]}>{label}</Text>
        <Text style={[styles.factorBarValue, { color: theme.text }]}>{fillPct}%</Text>
      </View>
      <View style={[styles.factorBarTrack, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
        <View style={[styles.factorBarFill, { width: `${fillPct}%`, backgroundColor: color, opacity: inverted ? 0.6 : 1 }]} />
      </View>
    </View>
  );
};

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

export const SunsetSimulation: React.FC<SunsetSimulationProps> = ({ 
  theme, 
  currentTime, 
  setCurrentTime 
}) => {
  const { width, height } = Dimensions.get('window');
  const { 
    location, 
    weatherCache, 
    terrainCache, 
    setWeatherCache, 
    setTerrainCache 
  } = useCelestialStore();
  const netInfo = useNetInfo();
  
  const [visualFov, setVisualFov] = useState(20);
  const animatedFov = useRef(new Animated.Value(20)).current;

  // Track FOV changes for debugging
  useEffect(() => {
    console.log(`[SunsetSim] FOV: ${visualFov.toFixed(1)}°, Zoom: ${(20 / visualFov).toFixed(2)}x`);
  }, [visualFov]);
  const [sim, setSim] = useState<SimulationState | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<string>('시뮬레이션 준비 중...');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [showSources, setShowSources] = useState(false);

  const [eventAzimuths, setEventAzimuths] = useState({ sunrise: 0, sunset: 0 });
  const startFov = useRef(20);

  useEffect(() => {
    if (!location) return;
    const fetchSim = async () => {
      try {
        const { latitude, longitude } = location.coords;
        const now = new Date();
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

        let weatherData = weatherCache?.data;
        let terrainData = terrainCache?.data;

        // Terrain: 100m threshold
        const distTerrain = terrainCache ? getDistance(latitude, longitude, terrainCache.latitude, terrainCache.longitude) : Infinity;
        const shouldFetchTerrain = !terrainCache || distTerrain > 100;

        // Weather: 1km threshold OR 30 minutes
        const distWeather = weatherCache ? getDistance(latitude, longitude, weatherCache.latitude, weatherCache.longitude) : Infinity;
        const timePassed = weatherCache ? Date.now() - weatherCache.timestamp : Infinity;
        const shouldFetchWeather = !weatherCache || distWeather > 1000 || timePassed > 1800000;

        if (shouldFetchWeather || shouldFetchTerrain) {
          if (shouldFetchWeather) setLoadingStatus('기상 데이터 분석 중...');
          
          const [newWeather, newTerrain] = await Promise.all([
            shouldFetchWeather ? fetchSunsetWeather(latitude, longitude, az) : Promise.resolve(weatherData),
            shouldFetchTerrain ? fetchTerrainProfile(latitude, longitude, 0, 360, (msg) => setLoadingStatus(msg)) : Promise.resolve(terrainData)
          ]);

          if (shouldFetchWeather && newWeather) {
            weatherData = newWeather;
            setWeatherCache({ 
              key: `w_${latitude.toFixed(4)}_${longitude.toFixed(4)}`, 
              data: newWeather, 
              timestamp: Date.now(), 
              latitude, 
              longitude 
            });
          }
          if (shouldFetchTerrain && newTerrain) {
            terrainData = newTerrain;
            setTerrainCache({ 
              key: `t_${latitude.toFixed(4)}_${longitude.toFixed(4)}`, 
              data: newTerrain, 
              timestamp: Date.now(), 
              latitude, 
              longitude 
            });
          }
        }

        if (weatherData && terrainData) {
          const trueEventTime = calculateTrueEventTime(
            nextEvent, 
            type, 
            latitude, 
            longitude, 
            terrainData as TerrainData
          );

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
      } catch (err) { console.error(err); }
    };
    fetchSim();
  }, [location]);

  if (netInfo.isConnected === false) {
    return (
      <View style={styles.offlineContainer}>
        <View style={[styles.offlineIconBg, { backgroundColor: theme.glass, borderColor: theme.border }]}>
          <WifiOff size={40} color={theme.accent} />
        </View>
        <Text style={[styles.offlineTitle, { color: theme.text }]}>Network Required</Text>
        <Text style={[styles.offlineText, { color: theme.subText }]}>Simulation needs an active connection to fetch terrain data.</Text>
      </View>
    );
  }

  const simLoaded = !!sim;
  const VISUALIZER_WIDTH = width - 24; // accounting for container padding
  const SKY_HEIGHT = height > 700 ? 260 : 220;
  const HORIZON_Y = SKY_HEIGHT * 0.10; // Lower horizon
  const DEGREE_TO_PIXEL = VISUALIZER_WIDTH / visualFov;
  
  // Base sizes for FOV 20
  const sunSize = 40 * (20 / visualFov);
  const cloudSize = 32 * (20 / visualFov);

  const calculateTrueEventTime = (baseTime: Date, type: 'Sunrise' | 'Sunset', lat: number, lon: number, terrain: TerrainData) => {
    // Search in a range of +/- 60 minutes with 30s precision
    const startOffset = type === 'Sunrise' ? -30 : -30; // Start searching 30 mins before
    const endOffset = 90; // Up to 90 mins after base event
    
    let bestTime = baseTime;
    
    // Simple iterative search for the crossing point
    for (let offset = startOffset; offset < endOffset; offset += 0.5) { // 30s steps
      const checkTime = addMinutes(baseTime, offset);
      const pos = SunCalc.getPosition(checkTime, lat, lon);
      const alt = pos.altitude * (180 / Math.PI);
      const az = (pos.azimuth * 180 / Math.PI) + 180;
      
      // Get terrain angle at this azimuth
      const angles = terrain.panoramicAngles;
      const normalizedAz = ((az % 360) + 360) % 360;
      const index = (normalizedAz / 360) * (angles.length - 1);
      const i1 = Math.floor(index);
      const i2 = (i1 + 1) % angles.length;
      const ratio = index - i1;
      const terrainAngle = angles[i1] * (1 - ratio) + angles[i2] * ratio;
      
      if (type === 'Sunset') {
        if (alt <= terrainAngle) return checkTime;
      } else { // Sunrise
        if (alt >= terrainAngle) return checkTime;
      }
    }
    return bestTime;
  };

  // Helper to get terrain angle at specific azimuth
  const getTerrainAngleAtAz = (az: number) => {
    if (!sim?.terrain?.panoramicAngles) return 0;
    const angles = sim.terrain.panoramicAngles;
    const normalizedAz = ((az % 360) + 360) % 360;
    const index = (normalizedAz / 360) * (angles.length - 1);
    const i1 = Math.floor(index);
    const i2 = (i1 + 1) % angles.length;
    const ratio = index - i1;
    return angles[i1] * (1 - ratio) + angles[i2] * ratio;
  };

  // Sun position calculation based on current simulation time
  const sunPos = SunCalc.getPosition(currentTime, location?.coords.latitude || 0, location?.coords.longitude || 0);
  const sunAltitude = sunPos.altitude * (180 / Math.PI);
  const sunAzimuth = (sunPos.azimuth * 180 / Math.PI) + 180;

  const currentTerrainAngle = getTerrainAngleAtAz(sunAzimuth);
  const isSunVisible = sunAltitude > currentTerrainAngle;

  // The sun is always centered in this simulation
  const heading = sunAzimuth;

  // Physics-based prediction. Re-computed whenever weather, time, or the
  // observer-relative sun altitude meaningfully changes. The astronomical
  // sun altitude is what matters for whether overhead high clouds are still
  // catching direct sunlight; terrain occlusion only affects the sun disk.
  const prediction = useMemo<SunsetPrediction | null>(() => {
    if (!sim?.pathData || sim.pathData.length < 4) return null;
    const obsHourly = getInterpolatedWeather(sim.pathData, currentTime)[0];
    return predictSunset(
      sim.pathData,
      currentTime,
      sunAltitude,
      obsHourly?.visibility,
      obsHourly?.humidity,
    );
  }, [sim?.pathData, currentTime, sunAltitude]);

  // Drag rotation disabled as per user request to keep sun centered

  const renderTerrain = () => {
    if (!sim?.terrain?.panoramicAngles) return null;

    const terrainHeight = 160;
    const pointsCount = 45; 
    const buffer = visualFov * 0.2;
    const totalRenderFov = visualFov + buffer * 2;
    
    const avgAngle = sim.terrain.panoramicAngles.reduce((a, b) => a + b, 0) / sim.terrain.panoramicAngles.length;
    const targetPeakHeight = SKY_HEIGHT * 0.15; 
    
    // IMPORTANT: Use a fixed DEGREE_TO_PIXEL based on reference FOV 20 
    // so that dynamicScale represents an absolute physical scaling factor.
    // This ensures that as visualFov changes, the pixels-per-degree change naturally.
    const REF_DEGREE_TO_PIXEL = VISUALIZER_WIDTH / 20;
    const baseScale = targetPeakHeight / (Math.max(1, avgAngle) * REF_DEGREE_TO_PIXEL);
    const dynamicScale = Math.min(10, Math.max(1.5, baseScale));

    const getPoints = (angles: number[], verticalScale: number, yOffset: number) => {
      const pointsList: string[] = [];
      const getAngle = (az: number) => {
        const normalizedAz = ((az % 360) + 360) % 360;
        const index = (normalizedAz / 360) * (angles.length - 1);
        const i1 = Math.floor(index);
        const i2 = (i1 + 1) % angles.length;
        const ratio = index - i1;
        let angle = angles[i1] * (1 - ratio) + angles[i2] * ratio;
        if (angle < 0.1) {
          angle += (Math.sin(az * 10) * 0.05) + (Math.sin(az * 25) * 0.02);
        }
        return angle;
      };

      for (let i = 0; i <= pointsCount; i++) {
        const relativeDeg = - (totalRenderFov / 2) + (i * totalRenderFov / pointsCount);
        const absDeg = heading + relativeDeg;
        const angle = getAngle(absDeg);
        const x = (relativeDeg / visualFov) * (width - 24) + (width - 24) / 2;
        const y = terrainHeight - HORIZON_Y - (angle * verticalScale * DEGREE_TO_PIXEL) + yOffset;
        pointsList.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }
      return pointsList.join(' ') + ` ${width - 24},${terrainHeight} 0,${terrainHeight}`;
    };

    const bgPoints = getPoints(sim.terrain.farAngles, dynamicScale * 1.6, 0); 
    const fgPoints = getPoints(sim.terrain.panoramicAngles, dynamicScale, 5); 

    return (
      <View style={styles.terrainContainer}>
        <Svg width={width - 24} height={terrainHeight}>
          <Defs>
            <LinearGradient id="bgTerrainGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#2c2c4e" stopOpacity="0.7" />
              <Stop offset="1" stopColor="#1a1a2e" stopOpacity="0.9" />
            </LinearGradient>
            <LinearGradient id="fgTerrainGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#1a1a2e" stopOpacity="0.9" />
              <Stop offset="1" stopColor="#050510" stopOpacity="1" />
            </LinearGradient>
          </Defs>
          {/* Background Layer */}
          <Polygon points={bgPoints} fill="url(#bgTerrainGrad)" />
          {/* Foreground Layer */}
          <Polygon points={fgPoints} fill="url(#fgTerrainGrad)" />
        </Svg>
        {/* Fill the bottom gap if any */}
        <View style={[styles.terrainBase, { backgroundColor: '#050510' }]} />
      </View>
    );
  };

  const renderCloudLayer = (c: any, i: number, type: 'high' | 'low') => {
    const hr = currentTime.getHours();
    const low = c.hourly.low[hr] || 0;
    const high = c.hourly.high[hr] || 0;
    const density = type === 'high' ? high : low;
    if (density < 5) return null;

    const zoomScale = 20 / visualFov;
    // Lower index (further away) should have smaller scale
    const perspectiveScale = 0.6 + (1 - i * 0.15) * 0.4;
    const combinedScale = zoomScale * perspectiveScale;

    // Base dimensions adjusted for better visibility
    const baseWidth = type === 'high' ? 120 : 180;
    const baseHeight = type === 'high' ? 6 : 24;
    const baseRadius = type === 'high' ? 3 : 12;

    const horizonTop = SKY_HEIGHT - HORIZON_Y;

    // Physically-derived cloud tints. High layer also blends the mid color
    // for some textural variety since Open-Meteo collapses everything >2km
    // into two bands.
    const physBg =
      type === 'high'
        ? (prediction?.highCloudColor ?? 'rgba(255, 192, 203, 0.4)')
        : (prediction?.lowCloudColor ?? 'rgba(100, 149, 237, 0.3)');

    return Array.from({ length: Math.ceil(density / 15) }).map((_, s) => {
      const seed = i * 17 + s;
      // Use degrees for distribution, so spacing scales with FOV
      const baseDegOffset = ((seed * 137) % 80) - 40;
      const x = (VISUALIZER_WIDTH / 2) + (baseDegOffset * DEGREE_TO_PIXEL);

      const baseDistFromHorizon = type === 'high' ? (140 - i * 15) : (80 - i * 12);
      const y = horizonTop - (baseDistFromHorizon * zoomScale);

      // More visible drift
      const timeMs = currentTime.getTime();
      const drift = ((timeMs / 5000) % 200 - 100) * zoomScale;

      return (
        <View
          key={`${type}-${i}-${s}`}
          style={[
            type === 'high' ? styles.cloudShapeHigh : styles.cloudShapeLow,
            {
              width: baseWidth * combinedScale,
              height: baseHeight * combinedScale,
              borderRadius: baseRadius * combinedScale,
              left: x + drift - (baseWidth * combinedScale / 2),
              top: y,
              backgroundColor: physBg,
              opacity: Math.min(0.75, 0.25 + (density / 150)),
              zIndex: 10 - i
            }
          ]}
        />
      );
    });
  };

  const renderAzimuthScale = () => {
    const ticks = [];
    const range = visualFov + 40;
    const start = Math.floor((heading - range / 2) / 2) * 2;
    const end = Math.ceil((heading + range / 2) / 2) * 2;
    for (let deg = start; deg <= end; deg += 2) {
      const norm = (deg + 360) % 360;
      const x = (VISUALIZER_WIDTH / 2) + (deg - heading) * DEGREE_TO_PIXEL;
      const isMajor = norm % 45 === 0;
      let label = "";
      if (norm === 0) label = 'N'; 
      else if (norm === 90) label = 'E'; 
      else if (norm === 180) label = 'S'; 
      else if (norm === 270) label = 'W';
      ticks.push(
        <View key={deg} style={[styles.tick, { left: x, height: isMajor ? 10 : 5, backgroundColor: isMajor ? theme.accent : theme.text }]}>
          {label !== "" && <Text style={[styles.tickLabel, { color: isMajor ? theme.accent : theme.text }]}>{label}</Text>}
        </View>
      );
    }
    const sunriseX = (VISUALIZER_WIDTH / 2) + (eventAzimuths.sunrise - heading) * DEGREE_TO_PIXEL;
    const sunsetX = (VISUALIZER_WIDTH / 2) + (eventAzimuths.sunset - heading) * DEGREE_TO_PIXEL;
    return (
      <View style={[styles.compassWidget, { backgroundColor: theme.glass, borderColor: theme.border }]}>
        <View style={styles.compassScaleContainer}>
          <View style={styles.scaleClip}>{ticks}</View>
          <View style={[styles.scaleSunMarker, { left: sunriseX }]}>
            <Sun size={8} color="#FFA500" />
            <Text style={[styles.scaleSunLabel, { color: theme.text }]}>RISE</Text>
          </View>
          <View style={[styles.scaleSunMarker, { left: sunsetX }]}>
            <Sun size={8} color="#FF4500" />
            <Text style={[styles.scaleSunLabel, { color: theme.text }]}>SET</Text>
          </View>
          <View style={[styles.centerIndicator, { borderTopColor: theme.accent }]} />
        </View>
      </View>
    );
  };

  const hr = currentTime.getHours();
  const skyStops = prediction?.skyGradient ?? [
    { offset: 0, color: '#08101e' },
    { offset: 1, color: '#08101e' },
  ];

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
          <View style={styles.visualizerContainer}>
            <View style={[styles.sky, { height: SKY_HEIGHT, backgroundColor: skyStops[0].color }]}>
              <Svg
                width={VISUALIZER_WIDTH}
                height={SKY_HEIGHT}
                style={StyleSheet.absoluteFillObject as any}
                pointerEvents="none"
              >
                <Defs>
                  <LinearGradient id="physSky" x1="0" y1="0" x2="0" y2="1">
                    {skyStops.map((s, i) => (
                      <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={1} />
                    ))}
                  </LinearGradient>
                </Defs>
                <Rect width={VISUALIZER_WIDTH} height={SKY_HEIGHT} fill="url(#physSky)" />
              </Svg>
              {(() => {
                const sunX = VISUALIZER_WIDTH / 2;
                const sunColor = isSunVisible
                  ? (prediction?.sunDiskColor ?? '#FFD700')
                  : '#FF4500';
                return (
                  <View
                    style={[
                      styles.sun,
                      {
                        width: sunSize,
                        height: sunSize,
                        borderRadius: sunSize / 2,
                        bottom: (sunAltitude * DEGREE_TO_PIXEL) + HORIZON_Y - (sunSize / 2),
                        left: sunX - (sunSize / 2),
                        backgroundColor: sunColor,
                        shadowColor: sunColor,
                      }
                    ]}
                  />
                );
              })()}
              {renderTerrain()}
              <View style={{ position: 'absolute', width: '100%', height: '100%', left: (sim.azimuth - heading) * DEGREE_TO_PIXEL }}>
                {sim.pathData.map((c, i) => renderCloudLayer(c, i, 'high'))}
                {sim.pathData.map((c, i) => renderCloudLayer(c, i, 'low'))}
              </View>
            </View>
          </View>

          {renderAzimuthScale()}

          {prediction && (
            <View style={[styles.predictionCard, { backgroundColor: theme.glass, borderColor: theme.border }]}>
              <View style={styles.predictionHeader}>
                <View style={styles.predictionQualityRow}>
                  <Text style={[styles.predictionQuality, { color: qualityColor(prediction.quality) }]}>
                    {prediction.quality.toUpperCase()}
                  </Text>
                  <Text style={[styles.predictionSubLabel, { color: theme.subText }]}>
                    {sim.type === 'Sunrise' ? 'DAWN FORECAST' : 'SUNSET FORECAST'}
                  </Text>
                </View>
                <View style={styles.predictionScoreWrap}>
                  <Text style={[styles.predictionScore, { color: theme.text }]}>{prediction.score}</Text>
                  <Text style={[styles.predictionScoreMax, { color: theme.subText }]}>/100</Text>
                </View>
              </View>
              <Text style={[styles.predictionDesc, { color: theme.subText }]} numberOfLines={2}>
                {prediction.description}
              </Text>
              <View style={styles.predictionFactors}>
                <FactorBar label="BEAM" value={prediction.factors.beamRedness} color="#FF6B5C" theme={theme} />
                <FactorBar label="PATH" value={prediction.factors.pathClarity} color="#FFC56B" theme={theme} />
                <FactorBar label="GLOW" value={prediction.factors.overheadGlow} color="#FF99CC" theme={theme} />
                <FactorBar label="OVERCAST" value={prediction.factors.overheadOvercast} color="#8FA1B5" theme={theme} inverted />
              </View>
            </View>
          )}

          <View style={[styles.simControl, { backgroundColor: theme.glass, borderColor: theme.border }]}>
            <TimeSlider 
              mode="relative"
              value={currentTime}
              onChange={setCurrentTime}
              baseTime={sim.eventTime}
              theme={theme}
              isDay={sunAltitude > 0}
            />
          </View>

          <View style={[styles.zoomControl, { backgroundColor: theme.glass, borderColor: theme.border }]}>
            <View style={styles.zoomHeader}>
              <View style={styles.zoomTitleRow}>
                <Maximize size={12} color={theme.subText} />
                <Text style={[styles.zoomTitle, { color: theme.subText }]}>시야각 수정</Text>
              </View>
            </View>
            
            <View style={styles.zoomSliderWrapper}>
              <GenericSlider
                value={((visualFov - 10) / 20) * 100}
                onChange={(p) => {
                  const newFov = 10 + (p / 100) * 20;
                  setVisualFov(newFov);
                }}
                theme={theme}
                trackColor="rgba(255,255,255,0.1)"
                knobColor={theme.glass}
              >
                <Text style={[styles.zoomKnobText, { color: theme.text }]}>
                  {Math.round(visualFov)}°
                </Text>
              </GenericSlider>
            </View>

            <TouchableOpacity 
              style={styles.infoButton} 
              onPress={() => setShowSources(true)}
            >
              <Info size={14} color={theme.subText} />
              <Text style={[styles.infoButtonText, { color: theme.subText }]}>Data Sources</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.bottomRow}>
            <View style={[styles.hero, { backgroundColor: theme.glass, borderColor: theme.border, flex: 1.2 }]}>
              <View style={styles.sourceBadgeRow}>
                <Text style={[styles.heroTitle, { color: theme.text }]}>
                  {sim.type === 'Sunrise' ? 'Actual Dawn' : 'Actual Twilight'}
                </Text>
                <View style={[
                  styles.sourceBadge, 
                  { backgroundColor: sim.weatherSource === 'ultra-short' ? 'rgba(77, 160, 176, 0.2)' : 'rgba(255, 255, 255, 0.05)' }
                ]}>
                  <Text style={[
                    styles.sourceBadgeText, 
                    { color: sim.weatherSource === 'ultra-short' ? '#4DA0B0' : theme.subText }
                  ]}>
                    {sim.weatherSource === 'ultra-short' ? '초단기정밀' : '글로벌표준'}
                  </Text>
                </View>
              </View>
              <Text style={[styles.heroTime, { color: theme.accent }]}>
                {format(sim.trueEventTime || sim.eventTime, 'HH:mm')}
                {sim.trueEventTime && (
                  <Text style={{ fontSize: 10, color: theme.subText, fontWeight: '400' }}>
                    {` (Terrain +${Math.abs(Math.round((sim.trueEventTime.getTime() - sim.eventTime.getTime()) / 60000))}m)`}
                  </Text>
                )}
              </Text>
            </View>

            <View style={styles.cloudGrid}>
              {sim.pathData.slice(0, 4).map((c, i) => (
                <View key={i} style={[styles.gridItem, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                  <Text style={[styles.gridDist, { color: theme.subText }]}>{c.distance === 0 ? 'Loc' : `${c.distance}k`}</Text>
                  <View style={styles.miniBars}>
                    <View style={[styles.miniBar, { height: `${Math.max(5, c.hourly.high[hr])}%`, backgroundColor: '#FF69B4' }]} />
                    <View style={[styles.miniBar, { height: `${Math.max(5, c.hourly.low[hr])}%`, backgroundColor: '#4682B4' }]} />
                  </View>
                </View>
              ))}
            </View>
          </View>
        </Animated.View>
      )}

      <Modal
        visible={showSources}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSources(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>데이터 출처 정보</Text>
              <TouchableOpacity onPress={() => setShowSources(false)}>
                <Text style={[styles.closeText, { color: theme.accent }]}>닫기</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sourceList}>
              <View style={styles.sourceSection}>
                <Text style={[styles.sourceCategory, { color: theme.accent }]}>GEOSPATIAL</Text>
                <TouchableOpacity 
                  style={styles.sourceItem}
                  onPress={() => Linking.openURL('https://open-meteo.com/en/docs/elevation-api')}
                >
                  <View style={styles.sourceContent}>
                    <Text style={[styles.sourceLabel, { color: theme.text }]}>지형 고도 (DEM)</Text>
                    <Text style={[styles.sourceDesc, { color: theme.subText }]}>Open-Meteo Elevation API</Text>
                  </View>
                  <ExternalLink size={14} color={theme.subText} />
                </TouchableOpacity>
              </View>

              <View style={styles.sourceSection}>
                <Text style={[styles.sourceCategory, { color: theme.accent }]}>METEOROLOGY</Text>
                <TouchableOpacity 
                  style={styles.sourceItem}
                  onPress={() => Linking.openURL('https://open-meteo.com/')}
                >
                  <View style={styles.sourceContent}>
                    <Text style={[styles.sourceLabel, { color: theme.text }]}>기상 및 구름 예측</Text>
                    <Text style={[styles.sourceDesc, { color: theme.subText }]}>
                      {sim?.weatherSource === 'ultra-short' ? '기상청(KMA) 초단기예보 API' : 'Open-Meteo Weather API'}
                    </Text>
                  </View>
                  <ExternalLink size={14} color={theme.subText} />
                </TouchableOpacity>
              </View>

              <View style={styles.sourceSection}>
                <Text style={[styles.sourceCategory, { color: theme.accent }]}>ASTRONOMY</Text>
                <View style={styles.sourceItemNonClickable}>
                  <View style={styles.sourceContent}>
                    <Text style={[styles.sourceLabel, { color: theme.text }]}>태양 궤적 및 방위각</Text>
                    <Text style={[styles.sourceDesc, { color: theme.subText }]}>SunCalc Library</Text>
                  </View>
                </View>
              </View>
            </View>

            <Text style={[styles.attribution, { color: theme.subText }]}>
              All weather data provided by Open-Meteo.com under CC BY 4.0.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12, backgroundColor: 'transparent' },
  mainWrapper: { flex: 1, justifyContent: 'space-between' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', height: 300 },
  loadingText: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  loadingSubText: { fontSize: 11, opacity: 0.6 },
  visualizerContainer: { borderRadius: 24, overflow: 'hidden', marginBottom: 8 },
  sky: { position: 'relative', overflow: 'hidden' },
  sun: { width: 40, height: 40, borderRadius: 20, position: 'absolute', zIndex: 50, shadowRadius: 15, shadowOpacity: 0.8 },
  terrainContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 100 },
  terrainBase: { height: 100, width: '100%', marginTop: -2 },
  cloudShapeHigh: { position: 'absolute' },
  cloudShapeLow: { position: 'absolute' },
  simControl: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, marginBottom: 8 },
  compassWidget: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, height: 60, marginBottom: 8 },
  predictionCard: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, marginBottom: 8 },
  predictionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 },
  predictionQualityRow: { flexDirection: 'column' },
  predictionQuality: { fontSize: 16, fontWeight: '900', letterSpacing: 1.2 },
  predictionSubLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 1 },
  predictionScoreWrap: { flexDirection: 'row', alignItems: 'baseline' },
  predictionScore: { fontSize: 22, fontWeight: '900', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  predictionScoreMax: { fontSize: 11, fontWeight: '700', marginLeft: 2 },
  predictionDesc: { fontSize: 11, lineHeight: 15, marginBottom: 8 },
  predictionFactors: { flexDirection: 'row', gap: 6 },
  factorBar: { flex: 1 },
  factorBarLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  factorBarLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  factorBarValue: { fontSize: 9, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  factorBarTrack: { height: 3, borderRadius: 2, overflow: 'hidden' },
  factorBarFill: { height: '100%', borderRadius: 2 },
  compassScaleContainer: { height: 48, justifyContent: 'flex-end' },
  scaleClip: { flex: 1, overflow: 'hidden' },
  tick: { position: 'absolute', bottom: 5, width: 1 },
  tickLabel: { position: 'absolute', fontSize: 10, fontWeight: 'bold', width: 30, textAlign: 'center', marginLeft: -15, bottom: 12 },
  centerIndicator: { position: 'absolute', top: 0, left: '50%', marginLeft: -5, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#FFF' },
  scaleSunMarker: { position: 'absolute', top: 2, alignItems: 'center', width: 30, marginLeft: -15 },
  scaleSunLabel: { fontSize: 8, fontWeight: '900' },
  bottomRow: { flexDirection: 'row', gap: 8, height: 80 },
  hero: { borderRadius: 20, padding: 12, borderWidth: 1, justifyContent: 'center' },
  sourceBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  sourceBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)' },
  sourceBadgeText: { fontSize: 8, fontWeight: '900' },
  heroTitle: { fontSize: 16, fontWeight: '900' },
  heroTime: { fontSize: 14, fontWeight: '700' },
  cloudGrid: { flexDirection: 'row', gap: 6, flex: 2.2 },
  gridItem: { padding: 6, borderRadius: 12, borderWidth: 1, alignItems: 'center', flex: 1, justifyContent: 'center' },
  gridDist: { fontSize: 9, fontWeight: '700', marginBottom: 4 },
  miniBars: { flexDirection: 'row', gap: 3, height: 25, alignItems: 'flex-end' },
  miniBar: { width: 6, borderRadius: 3 },
  zoomControl: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 8,
  },
  zoomHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    height: 28,
    paddingHorizontal: 16,
  },
  zoomTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  zoomTitle: {
    fontSize: 11,
    fontWeight: '800',
    marginLeft: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  zoomSliderWrapper: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  zoomKnobText: {
    fontSize: 13,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  offlineContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  offlineIconBg: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', borderWidth: 1, marginBottom: 20 },
  offlineTitle: { fontSize: 18, fontWeight: '900', marginBottom: 8 },
  offlineText: { fontSize: 13, textAlign: 'center', opacity: 0.8 },
  infoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 6,
  },
  infoButtonText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  closeText: {
    fontWeight: '700',
  },
  sourceList: {
    gap: 16,
    marginBottom: 20,
  },
  sourceSection: {
    marginBottom: 20,
  },
  sourceCategory: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 8,
    opacity: 0.8,
  },
  sourceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  sourceItemNonClickable: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
  },
  sourceContent: {
    flex: 1,
  },
  sourceLabel: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  sourceDesc: {
    fontSize: 11,
    fontWeight: '500',
    opacity: 0.7,
  },
  attribution: {
    fontSize: 11,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
