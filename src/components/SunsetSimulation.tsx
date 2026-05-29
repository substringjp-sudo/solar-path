import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  StyleSheet, View, Text, ScrollView, Animated, Dimensions,
  Platform, TouchableOpacity, PanResponder,
  Linking, Easing
} from 'react-native';
import {
  ArrowLeft, Maximize, Info, Map as MapIcon,
  Clock, Thermometer, Droplets, Wind,
  Cloud, CloudRain, Sun, Zap, Compass,
  ChevronDown, Layers, Target, Eye
} from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { DeviceMotion } from 'expo-sensors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Svg, { Defs, LinearGradient, Stop, Rect, Circle, Path } from 'react-native-svg';

import { useCelestialStore } from '../store/useCelestialStore';
import { getSimulationData } from '../utils/weather';
import {
  getSunsetColors, getSunPositionInSim,
  getSunsetPrediction, SunsetPrediction
} from '../utils/sunsetPhysics';
import { SimulationData } from '../types/simulation';
import { GenericSlider } from './GenericSlider';
import { TimeSlider } from './TimeSlider';
import { FloatingHeader } from './FloatingHeader';
import { triggerHaptic } from '../utils/haptics';

// New Simulation Components
import { PredictionCard } from './simulation/PredictionCard';
import { CompassWidget } from './simulation/CompassWidget';
import { SimulationVisualizer } from './simulation/SimulationVisualizer';
import { SimulationModals } from './simulation/SimulationModals';
const AnimatedVisualizer = Animated.createAnimatedComponent(SimulationVisualizer);
import { SimulationHero } from './simulation/SimulationHero';
import { CloudGrid } from './simulation/CloudGrid';
import { FovControl } from './simulation/FovControl';
import { qualityColor } from './simulation/utils';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

interface SunsetSimulationProps {
  theme: {
    bg: string;
    glass: string;
    text: string;
    subText: string;
    border: string;
    accent: string;
  };
  onClose?: () => void;
}

export const SunsetSimulation: React.FC<SunsetSimulationProps> = ({ theme, onClose }) => {
  const insets = useSafeAreaInsets();

  const {
  location, userRotation, setUserRotation,
  isGyroEnabled, setGyroEnabled,
  isTimeMachineEnabled, setTimeMachineEnabled,
  gyroRotation, setGyroRotation,
  currentTime
  } = useCelestialStore();

  const[localSimTime, setLocalSimTime] = useState(new Date());
  const[sim, setSim] = useState<SimulationData | null>(null);
  const[prediction, setPrediction] = useState<SunsetPrediction | null>(null);
  const[visualFov, setVisualFov] = useState(50);
  const[loading, setLoading] = useState(true);
  const[showPredictInfo, setShowPredictInfo] = useState(false);
  const[showSources, setShowSources] = useState(false);

  // Animation State
  const scrollY = useRef(new Animated.Value(0)).current;
  const dashboardY = useRef(new Animated.Value(0)).current;
  const driftAnim = useRef(new Animated.Value(0)).current;
  const[isCollapsed, setIsCollapsed] = useState(false);

  const lastTap = useRef(0);
  const isSnapped = useRef(false);

  const combinedRotation = useMemo(() => {
  return (userRotation + (isGyroEnabled?gyroRotation: 0) + 360) % 360;
  }, [userRotation, gyroRotation, isGyroEnabled]);

  // Sensor tracking moved to App.tsx to unify gyroRotation state

  useEffect(() => {
    loadSimulation();
  }, [location?.coords.latitude, location?.coords.longitude, currentTime.toDateString()]);

  const currentCoords = location?.coords || { latitude: 0, longitude: 0 };

  const loadSimulation = async () => {
  try {
  setLoading(true);
  const data = await getSimulationData(currentCoords.latitude, currentCoords.longitude, currentTime);
  setSim(data);
  setLocalSimTime(data.eventTime);

  const pred = getSunsetPrediction(data.weatherData, data.eventTime, 0, currentCoords.latitude, currentCoords.longitude);
  setPrediction(pred);
  } catch (error) {
  console.error('Sim load error:', error);
  } finally {
  setLoading(false);
  }
  };

  // Separate atmospheric calculations (heavy) from viewport calculations (frequent)
  const atmosphericState = useMemo(() => {
    if (!sim) return null;

    const eventTime = sim.eventTime.getTime();
    const currentTime = localSimTime.getTime();
    const diffMin = (currentTime - eventTime) / (60 * 1000);

    // Calculate base sun position
    const { altitude, azimuth } = getSunPositionInSim(localSimTime, currentCoords.latitude, currentCoords.longitude);
    const colors = getSunsetColors(altitude);

    // Update prediction for current time
    const currentPrediction = getSunsetPrediction(sim.weatherData, localSimTime, 0, currentCoords.latitude, currentCoords.longitude);

    // Interpolate cloud profile based on time (simulated) - this is the heavy part
    const interpolatedPath = sim.pathData.map((p) => ({
      ...p,
      profile: p.profile.map((point) => ({
        ...point,
        height: point.height * (1 + Math.sin(diffMin / 60) * 0.1)
      }))
    }));

    return {
      colors,
      altitude,
      azimuth,
      prediction: currentPrediction,
      interpolatedPath
    };
  }, [sim, localSimTime, currentCoords.latitude, currentCoords.longitude]);

  const visualState = useMemo(() => {
    if (!atmosphericState) return null;

    // FOV to Pixel Mapping
    const pixelsPerDegree = 1000 / visualFov;
    
    // Sun position depends on rotation (gyro)
    const sunX = 500 + (atmosphericState.azimuth - combinedRotation) * pixelsPerDegree;
    const sunY = 500 - (atmosphericState.altitude * pixelsPerDegree);

    return {
      ...atmosphericState,
      sunX,
      sunY,
      sunSize: 20 * (50 / visualFov),
      sunGlowSize: 120 * (50 / visualFov),
      sunAltitude: atmosphericState.altitude,
      sunAzimuth: atmosphericState.azimuth,
    };
  }, [atmosphericState, visualFov, combinedRotation]);

  // Pan Responder for horizontal rotation
  const startRotation = useRef(0);
  const rotationPanResponder = useRef(
  PanResponder.create({
  onStartShouldSetPanResponder: () => true,
  onPanResponderGrant: () => {
  startRotation.current = userRotation;

  // Double tap for reset
  const now = Date.now();
  if (now - lastTap.current < 300) {
  setUserRotation(0);
  setVisualFov(50);
  triggerHaptic('success');
  }
  lastTap.current = now;
  },
  onPanResponderMove: (_, gestureState) => {
  // Sensitivity: proportional to FOV to keep panning feel consistent
  const sensitivity = visualFov / screenWidth;
  let newRotation = (startRotation.current - gestureState.dx * sensitivity + 360) % 360;

  // Azimuth Snap logic (0, 90, 180, 270)
  const snapPoints = [0, 90, 180, 270];
  const snapThreshold = 3; // degrees
  let snapped = false;

  for (const point of snapPoints) {
  const diff = Math.abs(newRotation - point);
  const wrappedDiff = Math.abs(newRotation - (point + 360));
  const finalDiff = Math.min(diff, wrappedDiff);

  if (finalDiff < snapThreshold) {
  newRotation = point;
  snapped = true;
  break;
  }
  }

  if (snapped && !isSnapped.current) {
  triggerHaptic('medium');
  isSnapped.current = true;
  } else if (!snapped) {
  isSnapped.current = false;
  // Smooth panning haptic
  if (Math.abs(gestureState.dx) % 30 < 1.5) {
  triggerHaptic('selection');
  }
  }

  setUserRotation(newRotation);
  },
  onPanResponderRelease: () => {
  isSnapped.current = false;
  }
  })
  ).current;

  // Pan Responder for dashboard collapse
  const panResponder = useRef(
  PanResponder.create({
  onMoveShouldSetPanResponder: (_, gestureState) => {
  return Math.abs(gestureState.dy) > 10;
  },
  onPanResponderMove: (_, gestureState) => {
  if (isCollapsed) {
  if (gestureState.dy < 0) {
  dashboardY.setValue(gestureState.dy + screenHeight * 0.6);
  }
  } else {
  if (gestureState.dy > 0) {
  dashboardY.setValue(gestureState.dy);
  }
  }
  },
  onPanResponderRelease: (_, gestureState) => {
  const { dy, vy } = gestureState;
  if ((dy > 80 || vy > 0.4) && !isCollapsed) {
  collapseDashboard(vy);
  triggerHaptic('medium');
  } else if ((dy < -80 || vy < -0.4) && isCollapsed) {
  expandDashboard(vy);
  triggerHaptic('medium');
  } else {
  resetDashboard();
  }
  }
  })
  ).current;

  const collapseDashboard = (velocity = 0) => {
  setIsCollapsed(true);
  Animated.spring(dashboardY, {
  toValue: screenHeight * 0.6,
  useNativeDriver: true,
  velocity: velocity,
  tension: 85,
  friction: 14,
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 0.01
  }).start();
  };

  const expandDashboard = (velocity = 0) => {
  setIsCollapsed(false);
  Animated.spring(dashboardY, {
  toValue: 0,
  useNativeDriver: true,
  velocity: velocity,
  tension: 75,
  friction: 12,
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 0.01
  }).start();
  };

  const resetDashboard = () => {
  Animated.spring(dashboardY, {
  toValue: isCollapsed?screenHeight * 0.6: 0,
  useNativeDriver: true,
  tension: 60,
  friction: 12
  }).start();
  };

  if (!location) {
  return (
  <View style = {[styles.container, { backgroundColor: '#000' }]}>
  <View style = {styles.centered}>
  <Text style = {{ color: '#FFF' }}>Waiting for location...</Text>
  </View>
  </View>
  );
  }


  const isDay = visualState?visualState.sunAltitude > 0: true;

  // Animation values derived from dashboardY
  const floatingBarOpacity = dashboardY.interpolate({
  inputRange: [0, screenHeight * 0.35, screenHeight * 0.55],
  outputRange: [0, 0.2, 1],
  extrapolate: 'clamp'
  });

  const floatingBarTranslateY = dashboardY.interpolate({
  inputRange: [screenHeight * 0.2, screenHeight * 0.6],
  outputRange: [60, 0],
  extrapolate: 'clamp'
  });

  const floatingBarScale = dashboardY.interpolate({
  inputRange: [screenHeight * 0.45, screenHeight * 0.6],
  outputRange: [0.85, 1],
  extrapolate: 'clamp'
  });

  return (
  <View style = {styles.container}>
  <FloatingHeader
  title = "HYPER-SIMULATION"
  subtitle = "ATMOSPHERIC PREDICTION ENGINE"
  showBack
  onBack = {onClose}
  />

  {loading?(
  <View style = {styles.centered}>
  <Sun size = {32} color = {theme.accent} />
  <Text style = {[styles.loadingText, { color: theme.text }]}>INITIALIZING SIMULATION</Text>
  <Text style = {[styles.loadingSubText, { color: theme.subText }]}>Modeling atmospheric path vectors...</Text>
  </View>
  ): (
  <View style = {styles.mainWrapper} {...rotationPanResponder.panHandlers}>
  <AnimatedVisualizer
  interpolatedColors = {visualState?.colors ||[]}
  visualFov = {visualFov}
  sunX = {visualState?.sunX || 0}
  sunY = {visualState?.sunY || 0}
  sunSize = {visualState?.sunSize || 0}
  sunGlowSize = {visualState?.sunGlowSize || 0}
  interpolatedPath = {visualState?.interpolatedPath ||[]}
  sunAltitude = {visualState?.sunAltitude || 0}
  userRotation = {userRotation}
  gyroRotation = {isGyroEnabled?gyroRotation: 0}
  theme = {theme}
  containerHeight = {screenHeight * 0.5}
  prediction = {visualState?.prediction || null}
  cloudDrift = {0}
  />

  <Animated.View
  style = {[
  styles.dashboardWrapper,
  {
  transform: [{ translateY: dashboardY }],
  backgroundColor: theme.bg === '#000'?'rgba(10,10,12,0.92)': 'rgba(255,255,255,0.92)'
  }
  ]}
  >
  <View {...panResponder.panHandlers} style = {styles.dragHandleContainer}>
  <View style = {[styles.dragHandle, { backgroundColor: theme.text }]} />
  </View>

  <ScrollView
  showsVerticalScrollIndicator = {false}
  contentContainerStyle = {styles.scrollContent}
  scrollEventThrottle = {16}
  bounces = {false}
  >
  <View style = {styles.bottomCardContainer}>
  <PredictionCard
  prediction = {visualState?.prediction || prediction}
  theme = {theme}
  onPress = {() => setShowPredictInfo(true) }
  />

  <View style = {styles.dashboardRow}>
  <CompassWidget
  heading = {combinedRotation}
  sunAzimuth = {visualState?.sunAzimuth || 0}
  theme = {theme}
  />

  {/* Gyro Toggle Overlay */}
  <TouchableOpacity
  style = {[
  styles.gyroToggle,
  {
  backgroundColor: isGyroEnabled?theme.accent: 'rgba(0,0,0,0.5)',
  borderColor: isGyroEnabled?'transparent': theme.border
  }
  ]}
  onPress = {() => setGyroEnabled(!isGyroEnabled) }
  >
  <Compass size = {16} color = {isGyroEnabled?'#000': theme.text} />
  <Text style = {[styles.gyroText, { color: isGyroEnabled?'#000': theme.text }]}>
  {isGyroEnabled?'GYRO ON': 'GYRO OFF'}
  </Text>
  </TouchableOpacity>
  </View>

  <View style = {styles.dashboardRow}>
  <SimulationHero
  simulationTime = {localSimTime}
  terrainOffset = {sim?.terrainInfo?.horizonOffset}
  theme = {theme}
  />

  <CloudGrid
  weatherData = {sim?.weatherData ||[]}
  time = {localSimTime}
  theme = {theme}
  />
  </View>

  <FovControl
  fov = {visualFov}
  onFovChange = {setVisualFov}
  theme = {theme}
  />

  <View style = {[styles.simControl, { backgroundColor: theme.glass, borderColor: theme.border }]}>
  <TimeSlider
  value = {localSimTime}
  onChange = {setLocalSimTime}
  isTimeMachineEnabled = {isTimeMachineEnabled}
  onToggleTimeMachine = {setTimeMachineEnabled}
  theme = {theme}
  isDay = {isDay}
  />
  </View>

  <TouchableOpacity
  style = {styles.sourceInfoTrigger}
  onPress = {() => setShowSources(true) }
  activeOpacity = {0.7}
  >
  <Info size = {12} color = {theme.subText} />
  <Text style = {[styles.sourceInfoText, { color: theme.subText }]}>SIMULATION DATA SOURCES</Text>
  </TouchableOpacity>
  </View>
  </ScrollView>
  </Animated.View>

  {/* Layer 2: Floating Liquid Time Slider (Visible when collapsed) */}
  <Animated.View
  style = {[
  styles.floatingTimeBar,
  {
  opacity: floatingBarOpacity,
  shadowColor: theme.accent,
  transform: [
  { translateY: floatingBarTranslateY },
  { scale: floatingBarScale }
  ]
  }
  ]}
  {...panResponder.panHandlers}
  pointerEvents = {isCollapsed?'auto': 'none'}
  >
  <BlurView intensity = {Platform.OS === 'ios'?60: 90} tint = {isDay?"light": "dark"} style = {styles.blurContainer}>
  <View style = {[styles.floatingLiquidContent, { backgroundColor: 'transparent', borderColor: theme.border }]}>
  <View style = {styles.floatingHandleWrapper}>
  <View style = {[styles.floatingHandle, { backgroundColor: theme.text }]} />
  </View>
  {sim && (
  <TimeSlider
  value = {localSimTime}
  onChange = {setLocalSimTime}
  isTimeMachineEnabled = {isTimeMachineEnabled}
  onToggleTimeMachine = {setTimeMachineEnabled}
  theme = {theme}
  isDay = {isDay}
  compact
  />
  ) }
  </View>
  </BlurView>
  </Animated.View>
  </View>
  ) }

  <SimulationModals
  showPredictInfo = {showPredictInfo}
  setShowPredictInfo = {setShowPredictInfo}
  showSources = {showSources}
  setShowSources = {setShowSources}
  prediction = {prediction}
  weatherSource = {sim?.weatherSource}
  theme = {theme}
  />
  </View>
  );
  };

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    mainWrapper: { flex: 1 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loadingText: { fontSize: 15, fontWeight: '800', marginTop: 12, letterSpacing: 1 },
    loadingSubText: { fontSize: 12, opacity: 0.5, marginTop: 4 },
    dashboardWrapper: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      paddingHorizontal: 16,
      paddingBottom: Platform.OS === 'ios' ? 44 : 24,
      maxHeight: screenHeight * 0.6,
      backgroundColor: 'rgba(0,0,0,0.85)',
      borderTopLeftRadius: 40,
      borderTopRightRadius: 40,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.1)',
    },
    scrollContent: { paddingTop: 20, paddingBottom: 40 },
    bottomCardContainer: { gap: 16 },
    dashboardRow: { flexDirection: 'row', gap: 12 },
    heroCard: {
      flex: 1,
      borderRadius: 32,
      padding: 16,
      borderWidth: 1,
      justifyContent: 'center',
    },
    heroHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
    heroTitle: { fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
    heroTimeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
    heroTime: { fontSize: 22, fontWeight: '900' },
    terrainOffset: { fontSize: 13, fontWeight: '800' },
    sourceBadge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, borderWidth: 0.5 },
    sourceBadgeText: { fontSize: 8, fontWeight: '900' },
    cloudGridCard: { flex: 1.8, flexDirection: 'row', gap: 8 },
    gridItem: {
      flex: 1,
      borderRadius: 24,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 6,
    },
    gridDist: { fontSize: 8, fontWeight: '900', marginBottom: 8, opacity: 0.5 },
    miniBars: { flexDirection: 'row', gap: 3, height: 36, alignItems: 'flex-end' },
    miniBar: { width: 6, borderRadius: 3 },
    zoomControl: {
      paddingVertical: 16,
      paddingHorizontal: 20,
      borderRadius: 32,
      borderWidth: 1,
    },
    zoomHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
    zoomTitleRow: { flexDirection: 'row', alignItems: 'center' },
    zoomTitle: { fontSize: 10, fontWeight: '900', marginLeft: 8, letterSpacing: 1.2 },
    zoomValue: { fontSize: 16, fontWeight: '900' },
    zoomSliderWrapper: { height: 28, justifyContent: 'center' },
    simControl: {
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 32,
      borderWidth: 1,
    },
    gyroToggle: {
      position: 'absolute',
      top: 16,
      right: 16,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 12,
      borderWidth: 1,
      gap: 6,
    },
    gyroText: {
      fontSize: 9,
      fontWeight: '900',
      letterSpacing: 1,
    },
    sourceInfoTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, gap: 6, opacity: 0.5 },
    sourceInfoText: { fontSize: 9, fontWeight: '800', letterSpacing: 1 },
    dragHandleContainer: {
      width: '100%',
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dragHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      opacity: 0.2,
    },
    floatingTimeBar: {
      position: 'absolute',
      bottom: Platform.OS === 'ios' ? 54 : 34,
      left: 20,
      right: 20,
      borderRadius: 44,
      zIndex: 100,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.4,
      shadowRadius: 32,
      elevation: 25,
    },
    blurContainer: { flex: 1, borderRadius: 40, overflow: 'hidden' },
    floatingLiquidContent: {
      paddingVertical: 12,
      paddingHorizontal: 8,
      borderWidth: 0.5,
      borderRadius: 44,
    },
    floatingHandleWrapper: {
      width: '100%',
      height: 6,
      alignItems: 'center',
      marginBottom: 8,
      marginTop: -2,
    },
    floatingHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      opacity: 0.15,
    },
  });
