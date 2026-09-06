/**
 * AppHeader.tsx
 *
 * 평면 3탭 헤더. `HudHeader`의 카테고리 드롭다운(모달) × 서브탭 2단 구조를 대체합니다.
 *
 * Why (docs/IA_REDESIGN.md §1): 이전 구조는 2D 시뮬 → 3D 시뮬 이동에
 * "카테고리 버튼 → 모달 열림 → 항목 선택 → 모달 닫힘"이 필요했습니다.
 * 둘 다 "하늘을 본다"는 같은 일인데 3탭 + 모달이 걸렸습니다.
 *
 * 탭은 **공간 프레임**으로 나눕니다 — 시뮬레이터 개수가 아니라
 * "어떤 시점에서 묻는 질문인가"입니다. 이 축은 서로 겹치지 않습니다.
 *   하늘: 자기중심(돔 안) — "뭐가 보일까"
 *   지도: 타자중심(위에서) — "뭐가 오고 있나"
 *   기록: 시간축 — "뭘 봤나"
 */
import React, { useMemo, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, Platform } from 'react-native';
import { addDays, subDays } from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  RotateCcw,
  MapPin,
  Settings,
} from 'lucide-react-native';
import { useCelestialStore } from '../store/useCelestialStore';
import { getLocalTimeAtLocation, formatLocalTime } from '../utils/timezone';
import { t } from '../utils/i18n';

/** 앱의 최상위 화면. 이 셋이 전부입니다. */
export type AppTab = 'sky' | 'map' | 'log';

export const APP_TABS: { id: AppTab; label: string }[] = [
  { id: 'sky', label: '하늘' },
  { id: 'map', label: '지도' },
  { id: 'log', label: '기록' },
];

/** 스와이프 순서 = 탭 순서. 둘이 어긋날 수 없도록 같은 배열에서 유도합니다. */
export const TAB_ORDER: AppTab[] = APP_TABS.map(t2 => t2.id);

interface AppHeaderProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  setSettingsVisible: (visible: boolean) => void;
  setMapVisible?: (visible: boolean) => void;
  setShowDatePicker: (visible: boolean) => void;
  handleDateChange: (date: Date) => void;
  theme: any;
  dynamicTheme: any;
  currentTimeLocal?: Date;
  timezoneLabel?: string;
  isSimulationLoading?: boolean;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  activeTab,
  setActiveTab,
  setSettingsVisible,
  setMapVisible,
  setShowDatePicker,
  handleDateChange,
  theme,
  dynamicTheme,
  currentTimeLocal,
  timezoneLabel,
  isSimulationLoading = false,
}) => {
  const { currentTime, timezoneOffsetHours, language } = useCelestialStore();

  const activeIndex = useMemo(() => {
    const i = TAB_ORDER.indexOf(activeTab);
    return i >= 0 ? i : 0;
  }, [activeTab]);

  const indicatorAnim = useRef(new Animated.Value(activeIndex)).current;
  useEffect(() => {
    Animated.timing(indicatorAnim, {
      toValue: activeIndex,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [activeIndex, indicatorAnim]);

  const indicatorLeft = indicatorAnim.interpolate({
    inputRange: APP_TABS.map((_, i) => i),
    outputRange: APP_TABS.map((_, i) => `${(i * 100) / APP_TABS.length}%`),
  });

  // 기록 탭은 날짜와 무관하므로 날짜 바를 숨깁니다.
  const showDateBar = activeTab !== 'log';

  const isTodayLocal = useMemo(() => {
    const todayLocal = getLocalTimeAtLocation(new Date(), timezoneOffsetHours);
    const currentLocal = currentTimeLocal || getLocalTimeAtLocation(currentTime, timezoneOffsetHours);
    return (
      todayLocal.getUTCFullYear() === currentLocal.getUTCFullYear() &&
      todayLocal.getUTCMonth() === currentLocal.getUTCMonth() &&
      todayLocal.getUTCDate() === currentLocal.getUTCDate()
    );
  }, [currentTime, currentTimeLocal, timezoneOffsetHours]);

  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <Animated.View
          style={[styles.navToggle, { backgroundColor: dynamicTheme.glass, borderColor: dynamicTheme.border }]}
        >
          <Animated.View
            style={[
              styles.navIndicator,
              {
                backgroundColor: theme.text,
                left: indicatorLeft,
                width: `${100 / APP_TABS.length}%`,
              },
            ]}
          />
          {APP_TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                style={styles.navButton}
                activeOpacity={0.8}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.navText, { color: isActive ? theme.bg : dynamicTheme.subText }]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </Animated.View>

        <View style={styles.rightButtons}>
          {setMapVisible && (
            <TouchableOpacity
              onPress={() => setMapVisible(true)}
              style={[styles.iconBtn, { backgroundColor: theme.glass, borderColor: theme.border, borderWidth: 1 }]}
              accessibilityLabel="현재위치 변경"
              accessibilityRole="button"
            >
              <MapPin size={15} color={theme.accent || '#38BDF8'} />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={() => setSettingsVisible(true)}
            style={[styles.iconBtn, { backgroundColor: theme.glass, borderColor: theme.border, borderWidth: 1 }]}
            accessibilityLabel="설정"
            accessibilityRole="button"
          >
            <Settings size={14} color={theme.text} />
          </TouchableOpacity>
        </View>
      </View>

      {showDateBar && (
        <Animated.View
          style={[styles.dateNavigator, { backgroundColor: dynamicTheme.glass, borderColor: dynamicTheme.border }]}
        >
          <TouchableOpacity
            onPress={() => handleDateChange(subDays(currentTimeLocal || currentTime, 1))}
            style={styles.dateControl}
          >
            <ChevronLeft size={16} color={theme.text} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setShowDatePicker(true)} style={styles.dateCenter}>
            <Calendar size={12} color={theme.subText} style={{ marginRight: 6 }} />
            <Animated.Text style={[styles.dateText, { color: dynamicTheme.text }]}>
              {formatLocalTime(currentTimeLocal || currentTime, 'yyyy/MM/dd')}
            </Animated.Text>
            {timezoneLabel && (
              <View
                style={[
                  styles.timezoneBadge,
                  { backgroundColor: theme.bg === '#E8EDF2' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)' },
                ]}
              >
                <Text style={[styles.timezoneText, { color: theme.subText }]}>{timezoneLabel}</Text>
              </View>
            )}
          </TouchableOpacity>

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
            <TouchableOpacity
              onPress={() => handleDateChange(addDays(currentTimeLocal || currentTime, 1))}
              style={styles.dateControl}
            >
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
    paddingHorizontal: 14,
    marginBottom: 5,
    gap: 4,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  navToggle: {
    flexDirection: 'row',
    padding: 2.5,
    borderRadius: 4,
    borderWidth: Platform.OS === 'android' ? 0.5 : 1,
    flex: 1,
    position: 'relative',
  },
  navIndicator: {
    position: 'absolute',
    top: 2.5,
    bottom: 2.5,
    borderRadius: 3,
  },
  navButton: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 3,
    zIndex: 2,
  },
  navText: {
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  rightButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateNavigator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 4,
    borderWidth: Platform.OS === 'android' ? 0.5 : 1,
    height: 36,
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
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  todayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 3,
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
    letterSpacing: 0.3,
  },
  timezoneBadge: {
    marginLeft: 6,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 3,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  timezoneText: {
    fontSize: 8.5,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
