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
import { StyleSheet, View, Text, Animated, Platform } from 'react-native';
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
import { t, L3 } from '../utils/i18n';
import { color, radius, mono } from '../theme/tokens';
import { PressScale } from './ui';
import { timeTo } from '../theme/motion';
import { makeStyles, useThemeColors } from '../theme/useTheme';

/** 앱의 최상위 화면. 이 셋이 전부입니다. */
export type AppTab = 'sky' | 'map' | 'log';

export const APP_TABS: { id: AppTab; code: string; label: string }[] = [
  { id: 'sky', code: '01', label: '01 SKY' },
  { id: 'map', code: '02', label: '02 MAP' },
  { id: 'log', code: '03', label: '03 LOG' },
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
  const color = useThemeColors(); const styles = useStyles();
  const { currentTime, timezoneOffsetHours, language } = useCelestialStore();

  const activeIndex = useMemo(() => {
    const i = TAB_ORDER.indexOf(activeTab);
    return i >= 0 ? i : 0;
  }, [activeTab]);

  const indicatorAnim = useRef(new Animated.Value(activeIndex)).current;
  useEffect(() => {
    timeTo(indicatorAnim, activeIndex, 'base', 'enter', { useNativeDriver: false }).start();
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
        <View style={styles.navToggle}>
          <Animated.View
            style={[
              styles.navIndicator,
              {
                left: indicatorLeft,
                width: `${100 / APP_TABS.length}%`,
              },
            ]}
          />
          {APP_TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <PressScale
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                style={styles.navButton}
                activeOpacity={0.8}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.navText,
                    { color: isActive ? color.accent : color.textMute },
                    isActive && { fontWeight: '900' }
                  ]}
                >
                  {/* 번호는 HUD 문체로 두고 이름은 언어를 따릅니다(점검 2026-09-29). */}
                  {`${tab.code} ${tab.id === 'sky' ? L3(language, '하늘', 'SKY', '空')
                    : tab.id === 'map' ? L3(language, '지도', 'MAP', '地図')
                    : L3(language, '기록', 'LOG', '記録')}`}
                </Text>
              </PressScale>
            );
          })}
        </View>

        <View style={styles.rightButtons}>
          {setMapVisible && (
            <PressScale
              onPress={() => setMapVisible(true)}
              style={styles.iconBtn}
              accessibilityLabel={L3(language, '위치 변경', 'Change location', '位置を変更')}
              accessibilityRole="button"
            >
              <MapPin size={14} color={color.accent} />
            </PressScale>
          )}

          <PressScale
            onPress={() => setSettingsVisible(true)}
            style={styles.iconBtn}
            accessibilityLabel={t('settings', language)}
            accessibilityRole="button"
          >
            <Settings size={14} color={color.textDim} />
          </PressScale>
        </View>
      </View>

      {showDateBar && (
        <View style={styles.dateNavigator}>
          <PressScale
            onPress={() => handleDateChange(subDays(currentTimeLocal || currentTime, 1))}
            style={styles.dateControl}
          >
            <ChevronLeft size={16} color={color.textDim} />
          </PressScale>

          <PressScale onPress={() => setShowDatePicker(true)} style={styles.dateCenter}>
            <Calendar size={11} color={color.accent} style={{ marginRight: 6 }} />
            {/* 'DATE //' 접두어는 뺐습니다 — 달력 아이콘이 이미 말하고, 320px 기기에서 두 줄로 깨졌습니다. */}
            <Text style={styles.dateText}>
              {formatLocalTime(currentTimeLocal || currentTime, 'yyyy.MM.dd')}
            </Text>
            {timezoneLabel && (
              <View style={styles.timezoneBadge}>
                <Text style={styles.timezoneText}>{timezoneLabel}</Text>
              </View>
            )}
          </PressScale>

          <View style={styles.dateRightControls}>
            {!isTodayLocal && (
              <PressScale
                onPress={() => handleDateChange(new Date())}
                style={styles.todayButton}
              >
                <RotateCcw size={10} color={color.accent} />
                <Text style={styles.todayText}>{t('today', language)}</Text>
              </PressScale>
            )}
            <PressScale
              onPress={() => handleDateChange(addDays(currentTimeLocal || currentTime, 1))}
              style={styles.dateControl}
            >
              <ChevronRight size={16} color={color.textDim} />
            </PressScale>
          </View>
        </View>
      )}
    </View>
  );
};

const useStyles = makeStyles((color) => ({
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
    padding: 2,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.panel,
    flex: 1,
    position: 'relative',
  },
  navIndicator: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    borderRadius: radius.xs,
    backgroundColor: color.accentSoft,
    borderBottomWidth: 2,
    borderBottomColor: color.accent,
  },
  navButton: {
    flex: 1,
    paddingVertical: 5.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.xs,
    zIndex: 2,
  },
  navText: {
    fontSize: 11,
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  rightButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.panel,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateNavigator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.panel,
    height: 34,
  },
  dateControl: {
    padding: 3,
  },
  dateCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  datePrefix: {
    fontSize: 9,
    color: color.textMute,
    fontFamily: mono,
    fontWeight: '700',
  },
  dateText: {
    fontSize: 11,
    color: color.text,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: mono,
  },
  todayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.accentLine,
    backgroundColor: color.accentSoft,
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
    fontFamily: mono,
    color: color.accent,
    letterSpacing: 0.3,
  },
  timezoneBadge: {
    marginLeft: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: radius.xs,
    borderWidth: 0.5,
    borderColor: color.border,
    backgroundColor: color.fill,
  },
  timezoneText: {
    fontSize: 9,
    color: color.textDim,
    fontWeight: '800',
    fontFamily: mono,
  },
}));
