import React, { useMemo, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, Platform, Dimensions, PanResponder } from 'react-native';
import { RotateCcw, Compass, Sun, Moon, Zap, Sunrise, Sunset, MapPin } from 'lucide-react-native';
import { useCelestialStore } from '../store/useCelestialStore';
import { getLocalTimeAtLocation, formatLocalTime } from '../utils/timezone';
import { t } from '../utils/i18n';
import { CelestialChart } from './CelestialChart';
import { InfoCard } from './InfoCard';
import { TimeSlider } from './TimeSlider';
import { SunsetSimulation } from './SunsetSimulation';
import { Gallery } from './Gallery';
import { IsolineMap } from './IsolineMap/IsolineMap';
import { CloudTrackerChart } from './CloudTrackerChart';
import { Sim3DContainer } from './Sim3DContainer';

interface TabNavigatorProps {
  activeTab: string;
  setActiveTab: (tab: any) => void;
  contentOpacity: Animated.Value;
  contentTranslateX: Animated.Value;
  sunPos: any;
  moonPos: any;
  sunPath: any[];
  moonPath: any[];
  events: any;
  theme: any;
  dynamicTheme: any;
  userRotation: number;
  setUserRotation: (rot: number) => void;
  resetRotation: () => void;
  isGyroEnabled: boolean;
  setGyroEnabled: (enabled: boolean) => void;
  currentTime: Date;
  setCurrentTime: (time: Date) => void;
  isTimeMachineEnabled: boolean;
  setTimeMachineEnabled: (enabled: boolean) => void;
  isDay: boolean;
  globalPhotos: any[];
  myPhotos: any[];
  removeGlobalPhoto: (id: string) => Promise<void>;
  setMapVisible: (visible: boolean) => void;
}

const isSameDayUTC = (d1: Date, d2: Date) => {
  return d1.getUTCFullYear() === d2.getUTCFullYear() &&
         d1.getUTCMonth() === d2.getUTCMonth() &&
         d1.getUTCDate() === d2.getUTCDate();
};

export const TabNavigator: React.FC<TabNavigatorProps> = ({
  activeTab,
  setActiveTab,
  contentOpacity,
  contentTranslateX,
  sunPos,
  moonPos,
  sunPath,
  moonPath,
  events,
  theme,
  dynamicTheme,
  userRotation,
  setUserRotation,
  resetRotation,
  isGyroEnabled,
  setGyroEnabled,
  currentTime,
  setCurrentTime,
  isTimeMachineEnabled,
  setTimeMachineEnabled,
  isDay,
  globalPhotos,
  myPhotos,
  removeGlobalPhoto,
  setMapVisible,
}) => {
  const { location, timezoneOffsetHours, language, selectedCategory } = useCelestialStore();

  const eventsLocal = useMemo(() => {
    return {
      sunrise: getLocalTimeAtLocation(events.sunrise, timezoneOffsetHours),
      sunset: getLocalTimeAtLocation(events.sunset, timezoneOffsetHours),
      moonrise: events.moonrise ? getLocalTimeAtLocation(events.moonrise, timezoneOffsetHours) : null,
      moonset: events.moonset ? getLocalTimeAtLocation(events.moonset, timezoneOffsetHours) : null,
    };
  }, [events, timezoneOffsetHours]);

  const currentTimeLocal = useMemo(() => {
    return getLocalTimeAtLocation(currentTime, timezoneOffsetHours);
  }, [currentTime, timezoneOffsetHours]);
  const { width } = Dimensions.get('window');

  const tabOrder = ['tracker', 'sim', 'isoline', 'rainbow', 'all', 'my'];
  const activeIndex = tabOrder.indexOf(activeTab);
  const startX = useRef(0);

  const activeTabRef = useRef(activeTab);
  const activeIndexRef = useRef(activeIndex);
  activeTabRef.current = activeTab;
  activeIndexRef.current = activeIndex;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // 태양(sun) 카테고리가 아니거나 제스처가 명시적으로 차단된 경우 탭 슬라이드 터치 차단
        const currentCategory = useCelestialStore.getState().selectedCategory;
        if (currentCategory !== 'sun' || useCelestialStore.getState().isGestureBlocked) {
          return false;
        }

        const { pageY } = evt.nativeEvent;
        const { height } = Dimensions.get('window');

        // 하단 타임 슬라이더 카드 영역(최하단 160px 영역) 터치는 탭 슬라이드 제스처를 획득하지 않고 양보
        if (pageY > height - 160) {
          return false;
        }

        // Only claim gesture if horizontal movement is greater than vertical, and movement is significant
        const isHorizontal = Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
        const isSignificant = Math.abs(gestureState.dx) > 10;
        return isHorizontal && isSignificant;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        startX.current = -activeIndexRef.current * width;
      },
      onPanResponderMove: (evt, gestureState) => {
        let dx = gestureState.dx;
        // Rubber-band effect on edge pages
        if ((activeIndexRef.current === 0 && dx > 0) || (activeIndexRef.current === tabOrder.length - 1 && dx < 0)) {
          dx = dx * 0.35;
        }
        contentTranslateX.setValue(startX.current + dx);
      },
      onPanResponderRelease: (evt, gestureState) => {
        const swipeThreshold = width * 0.25;
        const velocityThreshold = 0.3;
        const dx = gestureState.dx;
        const vx = gestureState.vx;

        let targetTab: string | null = null;

        if (dx < -swipeThreshold || vx < -velocityThreshold) {
          if (activeIndexRef.current < tabOrder.length - 1) {
            targetTab = tabOrder[activeIndexRef.current + 1];
          }
        } else if (dx > swipeThreshold || vx > velocityThreshold) {
          if (activeIndexRef.current > 0) {
            targetTab = tabOrder[activeIndexRef.current - 1];
          }
        }

        if (targetTab && targetTab !== activeTabRef.current) {
          setActiveTab(targetTab);
        } else {
          // Snap back if threshold not met
          Animated.spring(contentTranslateX, {
            toValue: startX.current,
            bounciness: 4,
            useNativeDriver: Platform.OS !== 'web',
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(contentTranslateX, {
          toValue: startX.current,
          useNativeDriver: Platform.OS !== 'web',
        }).start();
      }
    })
  ).current;

  return (
    <View style={[styles.container, { overflow: 'hidden' }]} {...panResponder.panHandlers}>
      <View style={[
        styles.animatedContent,
        {
          flexDirection: 'row',
          width: width,
        }
      ]}>
        {/* Active Tab Screen */}
        <View style={{ width: width, flex: 1 }}>
          {activeTab === 'tracker' ? (
            selectedCategory === 'cloud' ? (
              <CloudTrackerChart
                theme={theme}
                latitude={location?.coords.latitude || 37.5665}
                longitude={location?.coords.longitude || 126.9780}
              />
            ) : (
              <>
                <View style={styles.chartContainer}>
                  <CelestialChart 
                    sunPos={sunPos} 
                    moonPos={moonPos} 
                    sunPath={sunPath} 
                    moonPath={moonPath}
                    isDay={isDay}
                    rotation={userRotation}
                    onRotationChange={setUserRotation}
                    isActive={activeTab === 'tracker'}
                  />
              
                  <View style={styles.trackerControls}>
                    <TouchableOpacity 
                      onPress={resetRotation}
                      style={[styles.trackerBtn, { backgroundColor: theme.glass, borderColor: theme.border }]}
                    >
                      <RotateCcw size={16} color={theme.text} />
                      <Text style={[styles.trackerBtnText, { color: theme.text }]}>{t('reset', language)}</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                      onPress={() => setGyroEnabled(!isGyroEnabled)}
                      style={[styles.trackerBtn, { backgroundColor: isGyroEnabled ? theme.accent : theme.glass, borderColor: isGyroEnabled ? theme.accent : theme.border }]}
                    >
                      <Compass size={16} color={isGyroEnabled ? "#000" : theme.text} />
                      <Text style={[styles.trackerBtnText, { color: isGyroEnabled ? "#000" : theme.text }]}>{t('gyro', language)}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.infoSection}>
                  <View style={[styles.infoFrame, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                    <View style={styles.frameHeader}>
                      <Sun size={12} color="#FFD700" />
                      <Text style={[styles.frameLabel, { color: theme.subText }]}>{t('solarData', language)}</Text>
                    </View>
                    <View style={styles.grid}>
                      <InfoCard 
                        icon={<Zap size={14} color="#FFD700" />}
                        label={t('position', language)}
                        value={`${sunPos.altitude.toFixed(0)}°`}
                        subValue={`${sunPos.azimuth.toFixed(0)}°`}
                        theme={theme}
                      />
                      <InfoCard 
                        icon={<Sunrise size={14} color="#FFA500" />}
                        label={t('sunrise', language)}
                        value={formatLocalTime(eventsLocal.sunrise, 'HH:mm')}
                        subValue={isSameDayUTC(eventsLocal.sunrise, currentTimeLocal) ? t('todayLabel', language) : t('tomorrowLabel', language)}
                        theme={theme}
                      />
                      <InfoCard 
                        icon={<Sunset size={14} color="#FF4500" />}
                        label={t('sunset', language)}
                        value={formatLocalTime(eventsLocal.sunset, 'HH:mm')}
                        subValue={isSameDayUTC(eventsLocal.sunset, currentTimeLocal) ? t('todayLabel', language) : t('tomorrowLabel', language)}
                        theme={theme}
                      />
                    </View>
                  </View>

                  <View style={[styles.infoFrame, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                    <View style={styles.frameHeader}>
                      <Moon size={12} color={isDay ? "#666" : "#E0E0E0"} />
                      <Text style={[styles.frameLabel, { color: theme.subText }]}>{t('lunarData', language)}</Text>
                    </View>
                    <View style={styles.grid}>
                      <InfoCard 
                        icon={<Zap size={14} color="#888" />}
                        label={t('position', language)}
                        value={`${moonPos.altitude.toFixed(0)}°`}
                        subValue={`${moonPos.azimuth.toFixed(0)}°`}
                        theme={theme}
                      />
                      <InfoCard 
                        icon={<Sunrise size={14} color="#888" />}
                        label={t('moonrise', language)}
                        value={eventsLocal.moonrise ? formatLocalTime(eventsLocal.moonrise, 'HH:mm') : '--:--'}
                        subValue={eventsLocal.moonrise ? (isSameDayUTC(eventsLocal.moonrise, currentTimeLocal) ? t('todayLabel', language) : t('tomorrowLabel', language)) : undefined}
                        theme={theme}
                      />
                      <InfoCard 
                        icon={<Sunset size={14} color="#888" />}
                        label={t('moonset', language)}
                        value={eventsLocal.moonset ? formatLocalTime(eventsLocal.moonset, 'HH:mm') : '--:--'}
                        subValue={eventsLocal.moonset ? (isSameDayUTC(eventsLocal.moonset, currentTimeLocal) ? t('todayLabel', language) : t('tomorrowLabel', language)) : undefined}
                        theme={theme}
                      />
                    </View>
                  </View>
                </View>

                <View style={[styles.bottomPanel, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                  <TimeSlider 
                    value={currentTime}
                    onChange={setCurrentTime}
                    isTimeMachineEnabled={isTimeMachineEnabled}
                    onToggleTimeMachine={setTimeMachineEnabled}
                    theme={theme}
                    isDay={isDay}
                    onPressMap={() => setMapVisible(true)}
                    markers={[
                      { time: events.sunrise, color: '#FFA500', type: 'rise' },
                      { time: events.sunset, color: '#FF4500', type: 'set' },
                      { time: events.moonrise, color: '#888', type: 'rise' },
                      { time: events.moonset, color: '#888', type: 'set' },
                    ]}
                  />
                </View>
              </>
            )
          ) : activeTab === 'sim' ? (
            <SunsetSimulation 
              theme={theme} 
              currentTime={currentTime}
              setCurrentTime={setCurrentTime}
              setMapVisible={setMapVisible}
              activeTab={activeTab as any}
            />
          ) : activeTab === 'isoline' ? (
            <IsolineMap
              theme={theme}
              currentTime={currentTime}
              isActive={true}
            />
          ) : activeTab === 'sim3dView' ? (
            <Sim3DContainer
              theme={theme}
              currentTime={currentTime}
              setCurrentTime={setCurrentTime}
              isTimeMachineEnabled={isTimeMachineEnabled}
              setTimeMachineEnabled={setTimeMachineEnabled}
              events={events}
              setMapVisible={setMapVisible}
            />
          ) : activeTab === 'all' || activeTab === 'my' ? (
            <Gallery
              theme={theme}
              dynamicTheme={dynamicTheme}
              globalPhotos={activeTab === 'my' ? [] : globalPhotos}
              myPhotos={myPhotos}
              removeGlobalPhoto={removeGlobalPhoto}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  animatedContent: {
    flex: 1,
    minHeight: 500,
  },
  chartContainer: {
    flex: 1.2,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  trackerControls: {
    position: 'absolute',
    right: 20,
    bottom: 40,
    gap: 12,
  },
  trackerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: Platform.OS === 'android' ? 3 : 2,
  },
  trackerBtnText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  infoSection: {
    paddingHorizontal: 16,
    paddingBottom: 5,
    gap: 6,
  },
  infoFrame: {
    borderRadius: 20,
    padding: 10,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: Platform.OS === 'android' ? 4 : 2,
  },
  frameHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    marginBottom: 4,
    gap: 6,
  },
  frameLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  grid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bottomPanel: {
    margin: 16,
    marginBottom: 24,
    paddingVertical: 10,
    borderRadius: 28,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: Platform.OS === 'android' ? 18 : 15,
  },
  bottomPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 2,
  },
  floatingMapBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
});
