import React, { useMemo, useRef, useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, Platform, Modal, Pressable } from 'react-native';
import { addDays, subDays } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar, RotateCcw, Camera as CameraIcon, Settings, ChevronDown, Lock, Sun, Cloud, Star, Image as ImageIcon } from 'lucide-react-native';
import { useCelestialStore } from '../store/useCelestialStore';
import { getLocalTimeAtLocation, formatLocalTime } from '../utils/timezone';
import { t } from '../utils/i18n';

export type CategoryType = 'sun' | 'cloud' | 'star' | 'gallery';
export type TabType = 'tracker' | 'sim' | 'isoline' | 'rainbow' | 'all' | 'my';

export const CATEGORY_TABS: Record<CategoryType, { id: TabType; labelKey: string; disabled?: boolean }[]> = {
  sun: [
    { id: 'tracker', labelKey: 'tracker' },
    { id: 'sim', labelKey: 'simulation' },
    { id: 'isoline', labelKey: 'isolineTab' },
  ],
  cloud: [
    { id: 'tracker', labelKey: 'tracker' },
    { id: 'rainbow', labelKey: 'rainbowTab', disabled: true },
  ],
  star: [
    { id: 'tracker', labelKey: 'tracker', disabled: true },
  ],
  gallery: [
    { id: 'all', labelKey: 'allTab' },
    { id: 'my', labelKey: 'myTab' },
  ],
};

const renderCategoryIcon = (cat: CategoryType, color: string = '#FFF', size: number = 14) => {
  switch (cat) {
    case 'sun': return <Sun size={size} color="#FFD700" />;
    case 'cloud': return <Cloud size={size} color="#88C0D0" />;
    case 'star': return <Star size={size} color="#E5E9F0" />;
    case 'gallery': return <ImageIcon size={size} color="#D8DEE9" />;
  }
};

const CATEGORY_NAMES: Record<CategoryType, string> = {
  sun: 'catSun',
  cloud: 'catCloud',
  star: 'catStar',
  gallery: 'catGallery',
};

interface HudHeaderProps {
  activeTab: string;
  setActiveTab: (tab: any) => void;
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
  const { currentTime, timezoneOffsetHours, language, selectedCategory, setSelectedCategory } = useCelestialStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const currentTabs = useMemo(() => CATEGORY_TABS[selectedCategory] || CATEGORY_TABS.sun, [selectedCategory]);
  const currentTabIds = useMemo(() => currentTabs.map(t => t.id), [currentTabs]);

  const activeTabIndex = useMemo(() => {
    const idx = currentTabIds.indexOf(activeTab as TabType);
    return idx >= 0 ? idx : 0;
  }, [currentTabIds, activeTab]);

  const tabIndicatorAnim = useRef(new Animated.Value(activeTabIndex)).current;

  useEffect(() => {
    Animated.timing(tabIndicatorAnim, {
      toValue: activeTabIndex,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [activeTabIndex]);

  const tabCount = currentTabs.length;
  const indicatorLeft = tabIndicatorAnim.interpolate({
    inputRange: currentTabIds.map((_, i) => i),
    outputRange: currentTabIds.map((_, i) => `${(i * 100) / tabCount}%`),
  });

  const handleCategorySelect = (cat: CategoryType) => {
    if (cat === 'star') return; // 별 카테고리는 미완성 비활성화
    setDropdownOpen(false);
    setSelectedCategory(cat);
    
    // 카테고리 변경 시 첫 번째 활성 탭으로 스위칭
    const firstActiveTab = CATEGORY_TABS[cat].find(t => !t.disabled)?.id || 'tracker';
    setActiveTab(firstActiveTab);
  };

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
        {/* Category Dropdown Button */}
        <TouchableOpacity
          onPress={() => setDropdownOpen(true)}
          style={[styles.categoryDropdownBtn, { backgroundColor: dynamicTheme.glass, borderColor: dynamicTheme.border }]}
          activeOpacity={0.7}
        >
          {renderCategoryIcon(selectedCategory, theme.text, 14)}
          <Text style={[styles.categoryText, { color: theme.text }]}>
            {t(CATEGORY_NAMES[selectedCategory] as any, language)}
          </Text>
          <ChevronDown size={14} color={theme.text} />
        </TouchableOpacity>

        {/* Dynamic Sub-Tab Navigator */}
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
          {currentTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const isDisabled = !!tab.disabled;

            return (
              <TouchableOpacity
                key={tab.id}
                onPress={() => !isDisabled && setActiveTab(tab.id)}
                disabled={isDisabled}
                style={[styles.navButton, isDisabled && { opacity: 0.35 }]}
              >
                <Animated.Text
                  numberOfLines={1}
                  style={[
                    styles.navText,
                    { color: isActive ? theme.bg : dynamicTheme.subText },
                    isDisabled && { textDecorationLine: 'line-through' }
                  ]}
                >
                  {t(tab.labelKey as any, language)}
                  {isDisabled ? ' 🔒' : ''}
                </Animated.Text>
              </TouchableOpacity>
            );
          })}
        </Animated.View>

        {/* Right Utility Buttons */}
        <View style={styles.rightButtonsContainer}>
          <TouchableOpacity 
            onPress={() => setSettingsVisible(true)}
            style={[styles.settingsOpenBtn, { backgroundColor: theme.glass, borderColor: theme.border, borderWidth: 1 }]}
          >
            <Settings size={14} color={theme.text} />
          </TouchableOpacity>

          {/* AR 촬영 버튼 */}
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
                      opacity: 0.2,
                    }
            ]}
          >
            <CameraIcon size={14} color={(goldenTimeInfo.isActive && !isSimulationLoading) ? '#FFF' : theme.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Date Navigator Bar */}
      {selectedCategory !== 'gallery' && (
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

      {/* Category Selection Modal Popup */}
      <Modal
        visible={dropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setDropdownOpen(false)}>
          <View style={[styles.dropdownMenu, { backgroundColor: '#1C1924', borderColor: 'rgba(255,255,255,0.15)' }]}>
            <Text style={styles.dropdownTitle}>카테고리 선택</Text>
            {(['sun', 'cloud', 'star', 'gallery'] as CategoryType[]).map((cat) => {
              const isSelected = selectedCategory === cat;
              const isDisabled = cat === 'star';

              return (
                <TouchableOpacity
                  key={cat}
                  disabled={isDisabled}
                  onPress={() => handleCategorySelect(cat)}
                  style={[
                    styles.dropdownItem,
                    isSelected && styles.dropdownItemSelected,
                    isDisabled && { opacity: 0.35 }
                  ]}
                >
                  <View style={styles.dropdownItemLeft}>
                    {renderCategoryIcon(cat, '#FFF', 16)}
                    <Text style={[styles.dropdownItemText, isSelected && { color: '#FF9800', fontWeight: '900' }]}>
                      {t(CATEGORY_NAMES[cat] as any, language)}
                    </Text>
                  </View>
                  {isDisabled && (
                    <View style={styles.disabledBadge}>
                      <Lock size={10} color="#AAA" />
                      <Text style={styles.disabledText}>{t('comingSoon' as any, language)}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Modal>
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
    gap: 6,
  },
  categoryDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: Platform.OS === 'android' ? 0.5 : 1,
    gap: 4,
  },
  categoryIcon: {
    fontSize: 13,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  navToggle: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 20,
    borderWidth: Platform.OS === 'android' ? 0.5 : 1,
    flex: 1,
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
    gap: 6,
  },
  settingsOpenBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
  },
  cameraOpenBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
  },
  dateNavigator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: Platform.OS === 'android' ? 0.5 : 1,
    height: 38,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-start',
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  dropdownMenu: {
    borderRadius: 20,
    padding: 12,
    borderWidth: 1,
    gap: 4,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  dropdownTitle: {
    color: '#888',
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 6,
    marginLeft: 8,
    letterSpacing: 0.5,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  dropdownItemSelected: {
    backgroundColor: 'rgba(255, 152, 0, 0.15)',
  },
  dropdownItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dropdownItemIcon: {
    fontSize: 16,
  },
  dropdownItemText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  disabledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  disabledText: {
    color: '#AAA',
    fontSize: 10,
    fontWeight: '700',
  },
});
