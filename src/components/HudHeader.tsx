import React, { useMemo, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, Platform } from 'react-native';
import { addDays, subDays } from 'date-fns';
import { MapPin, ChevronLeft, ChevronRight, Calendar, RotateCcw, Camera as CameraIcon, Settings } from 'lucide-react-native';
import { useCelestialStore } from '../store/useCelestialStore';
import { getLocalTimeAtLocation, formatLocalTime } from '../utils/timezone';
import { t } from '../utils/i18n';

const TAB_ORDER: ('tracker' | 'sim' | 'gallery' | 'isoline')[] = ['tracker', 'sim', 'gallery', 'isoline'];

interface HudHeaderProps {
  activeTab: 'tracker' | 'sim' | 'gallery' | 'isoline';
  setActiveTab: (tab: 'tracker' | 'sim' | 'gallery' | 'isoline') => void;
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
  isSimulationLoading?: boolean;
}

export const HudHeader: React.FC<HudHeaderProps> = ({
  activeTab,
  setActiveTab,
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
  isSimulationLoading = false,
}) => {
  const { currentTime, location, timezoneOffsetHours, language } = useCelestialStore();
  const isDay = activeTab === 'tracker' ? theme.bg === '#E8EDF2' : true; // 기본 낮 밤 계산 백업
  
  const tabIndicatorAnim = useRef(new Animated.Value(TAB_ORDER.indexOf(activeTab))).current;

  useEffect(() => {
    const tabIndex = TAB_ORDER.indexOf(activeTab);

    Animated.timing(tabIndicatorAnim, {
      toValue: tabIndex,
      duration: 300,
      // 인디케이터 위치를 %(레이아웃 속성)로 애니메이션하므로 네이티브 드라이버를 사용할 수 없습니다.
      useNativeDriver: false,
    }).start();
  }, [activeTab]);

  const tabCount = TAB_ORDER.length;
  const indicatorLeft = tabIndicatorAnim.interpolate({
    inputRange: TAB_ORDER.map((_, i) => i),
    outputRange: TAB_ORDER.map((_, i) => `${(i * 100) / tabCount}%`),
  });
  
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
          <Animated.View
            style={[
              styles.navIndicator,
              {
                backgroundColor: theme.text,
                left: indicatorLeft,
                width: `${100 / tabCount}%`,
              }
            ]}
          />
          {TAB_ORDER.map((tabKey) => (
            <TouchableOpacity
              key={tabKey}
              onPress={() => setActiveTab(tabKey)}
              style={styles.navButton}
            >
              <Animated.Text
                numberOfLines={1}
                style={[styles.navText, { color: activeTab === tabKey ? theme.bg : dynamicTheme.subText }]}
              >
                {t(tabKey === 'tracker' ? 'tracker' : tabKey === 'sim' ? 'simulation' : tabKey === 'gallery' ? 'gallery' : 'isolineTab', language)}
              </Animated.Text>
            </TouchableOpacity>
          ))}
        </Animated.View>
 
        <View style={styles.rightButtonsContainer}>
          <TouchableOpacity 
            onPress={() => setSettingsVisible(true)}
            style={[styles.settingsOpenBtn, { backgroundColor: theme.glass, borderColor: theme.border, borderWidth: 1 }]}
          >
            <Settings size={14} color={theme.text} />
          </TouchableOpacity>

          {/* AR 촬영 버튼 — 골든타임(일출/일몰 전후 2.5시간)에만 활성화, 롱프레스로 우회 진입 가능 */}
          <TouchableOpacity
            disabled={isSimulationLoading || !goldenTimeInfo.isActive}
            onPress={handleCameraPress}
            onLongPress={handleCameraLongPress}
            delayLongPress={1500}
            style={[
              styles.cameraOpenBtn,
              isSimulationLoading
                ? {
                    backgroundColor: theme.glass,
                    borderColor: theme.border,
                    borderWidth: 1,
                    opacity: 0.2,
                  }
                : goldenTimeInfo.isActive
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
                      opacity: 0.2, // 비활성화 상태임을 알 수 있도록 매우 낮은 명도로 조율
                    }
            ]}
          >
            <CameraIcon size={14} color={(goldenTimeInfo.isActive && !isSimulationLoading) ? '#FFF' : theme.text} />
          </TouchableOpacity>
        </View>
      </View>
 
      {activeTab !== 'gallery' && (
        <Animated.View style={[styles.dateNavigator, { backgroundColor: dynamicTheme.glass, borderColor: dynamicTheme.border }]}>
          <TouchableOpacity onPress={() => handleDateChange(subDays(currentTimeLocal || currentTime, 1))} style={styles.dateControl}>
            <ChevronLeft size={16} color={theme.text} />
          </TouchableOpacity>
          
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
   
          {/* 오른쪽 영역: 다음 날 + Today 버튼을 하나의 row로 묶어 겹침 방지 */}
          <View style={styles.dateRightControls}>
            {!isTodayLocal && (
              <TouchableOpacity 
                onPress={() => handleDateChange(new Date())} 
                style={[styles.todayButton, { backgroundColor: theme.text }]}
              >
                <RotateCcw size={10} color={theme.bg} />
                <Text style={[styles.todayText, { color: theme.bg }]}>{t('today', language)}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => handleDateChange(addDays(currentTimeLocal || currentTime, 1))} style={styles.dateControl}>
              <ChevronRight size={16} color={theme.text} />
            </TouchableOpacity>
          </View>
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
    flex: 1,
    maxWidth: 340,
    marginRight: 10,
    position: 'relative',
  },
  navIndicator: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    borderRadius: 17,
  },
  navButton: {
    flex: 1,
    paddingVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    zIndex: 2,
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
  cameraOpenBtn: {
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
  },
  dateRightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
