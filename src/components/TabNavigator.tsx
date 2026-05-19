import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, Platform } from 'react-native';
import { RotateCcw, Compass, Sun, Moon, Zap, Sunrise, Sunset } from 'lucide-react-native';
import { format, isSameDay } from 'date-fns';
import { useCelestialStore } from '../store/useCelestialStore';
import { getLocalTimeAtLocation } from '../utils/timezone';
import { useMemo } from 'react';
import { CelestialChart } from './CelestialChart';
import { InfoCard } from './InfoCard';
import { TimeSlider } from './TimeSlider';
import { SunsetSimulation } from './SunsetSimulation';

interface TabNavigatorProps {
  activeTab: 'tracker' | 'sim';
  contentOpacity: Animated.Value;
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
}

export const TabNavigator: React.FC<TabNavigatorProps> = ({
  activeTab,
  contentOpacity,
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
}) => {
  const { location } = useCelestialStore();
  const longitude = location?.coords.longitude ?? 126.9780;

  const eventsLocal = useMemo(() => {
    return {
      sunrise: getLocalTimeAtLocation(events.sunrise, longitude),
      sunset: getLocalTimeAtLocation(events.sunset, longitude),
      moonrise: events.moonrise ? getLocalTimeAtLocation(events.moonrise, longitude) : null,
      moonset: events.moonset ? getLocalTimeAtLocation(events.moonset, longitude) : null,
    };
  }, [events, longitude]);

  const currentTimeLocal = useMemo(() => {
    return getLocalTimeAtLocation(currentTime, longitude);
  }, [currentTime, longitude]);
  return (
    <View style={styles.container}>
      <Animated.View style={[styles.animatedContent, { opacity: contentOpacity }]}>
        {activeTab === 'tracker' ? (
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
              />
              
              <View style={styles.trackerControls}>
                <TouchableOpacity 
                  onPress={resetRotation}
                  style={[styles.trackerBtn, { backgroundColor: theme.glass, borderColor: theme.border }]}
                >
                  <RotateCcw size={16} color={theme.text} />
                  <Text style={[styles.trackerBtnText, { color: theme.text }]}>RESET</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  onPress={() => setGyroEnabled(!isGyroEnabled)}
                  style={[styles.trackerBtn, { backgroundColor: isGyroEnabled ? theme.accent : theme.glass, borderColor: isGyroEnabled ? theme.accent : theme.border }]}
                >
                  <Compass size={16} color={isGyroEnabled ? "#000" : theme.text} />
                  <Text style={[styles.trackerBtnText, { color: isGyroEnabled ? "#000" : theme.text }]}>GYRO</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.infoSection}>
              <View style={[styles.infoFrame, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                <View style={styles.frameHeader}>
                  <Sun size={12} color="#FFD700" />
                  <Text style={[styles.frameLabel, { color: theme.subText }]}>SOLAR DATA</Text>
                </View>
                <View style={styles.grid}>
                  <InfoCard 
                    icon={<Zap size={14} color="#FFD700" />}
                    label="Position"
                    value={`${sunPos.altitude.toFixed(0)}°`}
                    subValue={`${sunPos.azimuth.toFixed(0)}°`}
                    theme={theme}
                  />
                  <InfoCard 
                    icon={<Sunrise size={14} color="#FFA500" />}
                    label="Sunrise"
                    value={format(eventsLocal.sunrise, 'HH:mm')}
                    subValue={isSameDay(eventsLocal.sunrise, currentTimeLocal) ? '오늘' : '내일'}
                    theme={theme}
                  />
                  <InfoCard 
                    icon={<Sunset size={14} color="#FF4500" />}
                    label="Sunset"
                    value={format(eventsLocal.sunset, 'HH:mm')}
                    subValue={isSameDay(eventsLocal.sunset, currentTimeLocal) ? '오늘' : '내일'}
                    theme={theme}
                  />
                </View>
              </View>

              <View style={[styles.infoFrame, { backgroundColor: theme.glass, borderColor: theme.border }]}>
                <View style={styles.frameHeader}>
                  <Moon size={12} color={isDay ? "#666" : "#E0E0E0"} />
                  <Text style={[styles.frameLabel, { color: theme.subText }]}>LUNAR DATA</Text>
                </View>
                <View style={styles.grid}>
                  <InfoCard 
                    icon={<Zap size={14} color="#888" />}
                    label="Position"
                    value={`${moonPos.altitude.toFixed(0)}°`}
                    subValue={`${moonPos.azimuth.toFixed(0)}°`}
                    theme={theme}
                  />
                  <InfoCard 
                    icon={<Sunrise size={14} color="#888" />}
                    label="Moonrise"
                    value={eventsLocal.moonrise ? format(eventsLocal.moonrise, 'HH:mm') : '--:--'}
                    subValue={eventsLocal.moonrise ? (isSameDay(eventsLocal.moonrise, currentTimeLocal) ? '오늘' : '내일') : undefined}
                    theme={theme}
                  />
                  <InfoCard 
                    icon={<Sunset size={14} color="#888" />}
                    label="Moonset"
                    value={eventsLocal.moonset ? format(eventsLocal.moonset, 'HH:mm') : '--:--'}
                    subValue={eventsLocal.moonset ? (isSameDay(eventsLocal.moonset, currentTimeLocal) ? '오늘' : '내일') : undefined}
                    theme={theme}
                  />
                </View>
              </View>
            </View>
          </>
        ) : (
          <SunsetSimulation 
            theme={theme} 
            currentTime={currentTime}
            setCurrentTime={setCurrentTime}
          />
        )}
      </Animated.View>

      {activeTab === 'tracker' && (
        <View style={[styles.bottomPanel, { backgroundColor: theme.glass, borderColor: theme.border }]}>
          <TimeSlider 
            value={currentTime}
            onChange={setCurrentTime}
            isTimeMachineEnabled={isTimeMachineEnabled}
            onToggleTimeMachine={setTimeMachineEnabled}
            theme={theme}
            isDay={isDay}
            markers={[
              { time: events.sunrise, color: '#FFA500', type: 'rise' },
              { time: events.sunset, color: '#FF4500', type: 'set' },
              { time: events.moonrise, color: '#888', type: 'rise' },
              { time: events.moonset, color: '#888', type: 'set' },
            ]}
          />
        </View>
      )}
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
});
