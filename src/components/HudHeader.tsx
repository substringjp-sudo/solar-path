import React, { useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, Platform } from 'react-native';
import { addDays, subDays } from 'date-fns';
import { MapPin, ChevronLeft, ChevronRight, Calendar, RotateCcw, Camera as CameraIcon, Settings } from 'lucide-react-native';
import { useCelestialStore } from '../store/useCelestialStore';
import { getLocalTimeAtLocation, formatLocalTime } from '../utils/timezone';

interface HudHeaderProps {
  activeTab: 'tracker' | 'sim' | 'gallery';
  setActiveTab: (tab: 'tracker' | 'sim' | 'gallery') => void;
  setMapVisible: (visible: boolean) => void;
  setSavedListVisible: (visible: boolean) => void;
  setSettingsVisible: (visible: boolean) => void;
  handleSaveLocation: () => void;
  handleCameraPress: () => void;
  handleCameraLongPress: () => void;
  goldenTimeInfo: { isActive: boolean; type: 'sunrise' | 'sunset' | null };
  setShowDatePicker: (visible: boolean) => void;
  handleDateChange: (date: Date) => void;
  theme: any;
  dynamicTheme: any;
  currentTimeLocal?: Date;
  timezoneLabel?: string;
}

export const HudHeader: React.FC<HudHeaderProps> = ({
  activeTab,
  setActiveTab,
  setMapVisible,
  setSavedListVisible,
  setSettingsVisible,
  handleSaveLocation,
  handleCameraPress,
  handleCameraLongPress,
  goldenTimeInfo,
  setShowDatePicker,
  handleDateChange,
  theme,
  dynamicTheme,
  currentTimeLocal,
  timezoneLabel,
}) => {
  const { currentTime, location, timezoneOffsetHours } = useCelestialStore();
  const isDay = activeTab === 'tracker' ? theme.bg === '#E8EDF2' : true; // 기본 낮 밤 계산 백업
  
  // 현지 기준의 오늘(Today) 가상 날짜
  const isTodayLocal = useMemo(() => {
    const todayLocal = getLocalTimeAtLocation(new Date(), timezoneOffsetHours);
    const currentLocal = currentTimeLocal || getLocalTimeAtLocation(currentTime, timezoneOffsetHours);
    return todayLocal.getUTCFullYear() === currentLocal.getUTCFullYear() &&
           todayLocal.getUTCMonth() === currentLocal.getUTCMonth() &&
           todayLocal.getUTCDate() === currentLocal.getUTCDate();
  }, [currentTime, currentTimeLocal, timezoneOffsetHours]);

  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <Animated.View style={[styles.navToggle, { backgroundColor: dynamicTheme.glass, borderColor: dynamicTheme.border }]}>
          <TouchableOpacity 
            onPress={() => setActiveTab('tracker')}
            style={[styles.navButton, activeTab === 'tracker' && { backgroundColor: theme.text }]}
          >
            <Animated.Text style={[styles.navText, { color: activeTab === 'tracker' ? theme.bg : dynamicTheme.subText }]}>Tracker</Animated.Text>
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => setActiveTab('sim')}
            style={[styles.navButton, activeTab === 'sim' && { backgroundColor: theme.text }]}
          >
            <Animated.Text style={[styles.navText, { color: activeTab === 'sim' ? theme.bg : dynamicTheme.subText }]}>Simulation</Animated.Text>
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => setActiveTab('gallery')}
            style={[styles.navButton, activeTab === 'gallery' && { backgroundColor: theme.text }]}
          >
            <Animated.Text style={[styles.navText, { color: activeTab === 'gallery' ? theme.bg : dynamicTheme.subText }]}>Gallery</Animated.Text>
          </TouchableOpacity>
        </Animated.View>
 
        <View style={styles.rightButtonsContainer}>
          <TouchableOpacity 
            onPress={() => setMapVisible(true)}
            style={[styles.mapOpenBtn, { backgroundColor: theme.accent }]}
          >
            <MapPin size={14} color="#000" />
          </TouchableOpacity>

          <TouchableOpacity 
            onPress={() => setSettingsVisible(true)}
            style={[styles.settingsOpenBtn, { backgroundColor: theme.glass, borderColor: theme.border, borderWidth: 1 }]}
          >
            <Settings size={14} color={theme.text} />
          </TouchableOpacity>

          {/* AR 촬영 버튼 — 골든타임(일출/일몰 전후 2.5시간)에만 활성화, 롱프레스로 우회 진입 가능 */}
          <TouchableOpacity
            onPress={handleCameraPress}
            onLongPress={handleCameraLongPress}
            delayLongPress={1500}
            style={[
              styles.mapOpenBtn,
              goldenTimeInfo.isActive
                ? { 
                    backgroundColor: goldenTimeInfo.type === 'sunrise' ? '#FFA500' : '#FF4500',
                    shadowColor: goldenTimeInfo.type === 'sunrise' ? '#FFA500' : '#FF4500',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.4,
                    shadowRadius: 6,
                    elevation: 5
                  }
                : { 
                    backgroundColor: theme.glass, 
                    borderColor: theme.border, 
                    borderWidth: 1,
                    opacity: 0.55
                  }
            ]}
          >
            <CameraIcon size={14} color={goldenTimeInfo.isActive ? '#FFF' : theme.text} />
            {goldenTimeInfo.isActive ? (
              <Text style={[styles.mapOpenText, { color: '#FFF', fontSize: 9, fontWeight: 'bold' }]}>GOLDEN</Text>
            ) : (
              <Text style={[styles.mapOpenText, { color: theme.text, fontSize: 8, opacity: 0.7 }]}>LOCK</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
 
      {activeTab !== 'gallery' && (
        <Animated.View style={[styles.dateNavigator, { backgroundColor: dynamicTheme.glass, borderColor: dynamicTheme.border }]}>
          {activeTab !== 'sim' ? (
            <TouchableOpacity onPress={() => handleDateChange(subDays(currentTimeLocal || currentTime, 1))} style={styles.dateControl}>
              <ChevronLeft size={16} color={theme.text} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 24 }} />
          )}
          
          <TouchableOpacity onPress={() => setShowDatePicker(true)} style={styles.dateCenter}>
            <Calendar size={12} color={theme.subText} style={{ marginRight: 6 }} />
            <Animated.Text style={[styles.dateText, { color: dynamicTheme.text }]}>
              {formatLocalTime(currentTimeLocal || currentTime, 'yyyy/MM/dd')}
            </Animated.Text>
            {timezoneLabel && (
              <View style={[styles.timezoneBadge, { backgroundColor: theme.bg === '#E8EDF2' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)' }]}>
                <Text style={[styles.timezoneText, { color: theme.subText }]}>{timezoneLabel}</Text>
              </View>
            )}
          </TouchableOpacity>
   
          {activeTab !== 'sim' ? (
            <TouchableOpacity onPress={() => handleDateChange(addDays(currentTimeLocal || currentTime, 1))} style={styles.dateControl}>
              <ChevronRight size={16} color={theme.text} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 24 }} />
          )}
   
          {!isTodayLocal && activeTab !== 'sim' && (
            <TouchableOpacity 
              onPress={() => handleDateChange(new Date())} 
              style={[styles.todayButton, { backgroundColor: theme.text }]}
            >
              <RotateCcw size={10} color={theme.bg} />
              <Text style={[styles.todayText, { color: theme.bg }]}>TODAY</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    paddingTop: 5,
    paddingHorizontal: 16,
    marginBottom: 5,
    gap: 4,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  navToggle: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 20,
    borderWidth: Platform.OS === 'android' ? 0.5 : 1,
  },
  navButton: {
    paddingVertical: 5,
    paddingHorizontal: 16,
    borderRadius: 16,
  },
  navText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  rightButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsOpenBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  mapOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    gap: 4,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  mapOpenText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#000',
    letterSpacing: -0.2,
  },
  dateNavigator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: Platform.OS === 'android' ? 0.5 : 1,
    height: 40,
  },
  dateControl: {
    padding: 4,
  },
  dateCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  dateText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  todayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 4,
    position: 'absolute',
    right: 8,
  },
  todayText: {
    fontSize: 9,
    fontWeight: '900',
  },
  timezoneBadge: {
    marginLeft: 6,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 6,
  },
  timezoneText: {
    fontSize: 9,
    fontWeight: '800',
  },
});
