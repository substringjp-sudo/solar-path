/**
 * AppHeader.tsx
 *
 * 앱 맨 위 한 줄 — **탭 둘(시뮬레이션 · 갤러리)** + 위치 · 설정.
 *
 * ## 달라진 것 (§143)
 *
 * - **날짜 바를 뺐습니다.** 날짜 표시·앞뒤 하루·"오늘"·달력은 하단의 날짜·시간 막대(`TimeBar/DateTimeBar`)가
 *   전부 합니다. 같은 값을 위아래에서 두 번 보여 주고 있었습니다.
 * - **지도 탭을 뺐습니다.** 지도·구는 하늘 탭을 핀치로 줌아웃하면 같은 화면에서 이어집니다(`zoomContinuum.ts`).
 *   지도 탭의 등시선·구름 레이더는 그 줌 화면이 이미 그립니다.
 *
 * (옛 구조의 이력: docs/IA_REDESIGN.md — 카테고리 드롭다운 × 서브탭 → 평면 3탭 → 지금의 2탭.)
 */
import React, { useMemo, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, Animated } from 'react-native';
import { MapPin, Settings } from 'lucide-react-native';
import { useCelestialStore } from '../store/useCelestialStore';
import { t, L3 } from '../utils/i18n';
import { color, radius, mono, space, TOUCH } from '../theme/tokens';
import { PressScale } from './ui';
import { timeTo } from '../theme/motion';
import { makeStyles, useThemeColors } from '../theme/useTheme';

/** 앱의 최상위 화면. 이 둘이 전부입니다. */
export type AppTab = 'sky' | 'log';

export const APP_TABS: { id: AppTab; code: string; label: string }[] = [
  { id: 'sky', code: '01', label: '01 SIM' },
  { id: 'log', code: '02', label: '02 LOG' },
];

/** 스와이프 순서 = 탭 순서. 둘이 어긋날 수 없도록 같은 배열에서 유도합니다. */
export const TAB_ORDER: AppTab[] = APP_TABS.map(t2 => t2.id);

interface AppHeaderProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  setSettingsVisible: (visible: boolean) => void;
  setMapVisible?: (visible: boolean) => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  activeTab,
  setActiveTab,
  setSettingsVisible,
  setMapVisible,
}) => {
  const color = useThemeColors(); const styles = useStyles();
  const language = useCelestialStore(s => s.language);

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
                    isActive && { fontWeight: '800' }
                  ]}
                >
                  {/* 번호는 HUD 문체로 두고 이름은 언어를 따릅니다(점검 2026-09-29). */}
                  {`${tab.code} ${tab.id === 'sky' ? L3(language, '시뮬레이션', 'SIM', 'シミュ')
                    : L3(language, '갤러리', 'GALLERY', 'ギャラリー')}`}
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
              <MapPin size={16} color={color.accent} />
            </PressScale>
          )}

          <PressScale
            onPress={() => setSettingsVisible(true)}
            style={styles.iconBtn}
            accessibilityLabel={t('settings', language)}
            accessibilityRole="button"
          >
            <Settings size={16} color={color.textDim} />
          </PressScale>
        </View>
      </View>

    </View>
  );
};

const useStyles = makeStyles((color) => ({
  header: {
    paddingTop: space.xs,
    paddingHorizontal: space.lg,
    marginBottom: space.xs,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  /** 탭 · 아이콘 버튼 모두 높이 40(touch). 예전에는 탭 약 26 · 아이콘 32 였습니다. */
  navToggle: {
    flexDirection: 'row',
    height: TOUCH,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.panel,
    flex: 1,
    position: 'relative',
  },
  navIndicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: radius.xs,
    backgroundColor: color.accentSoft,
    borderBottomWidth: 2,
    borderBottomColor: color.accent,
  },
  navButton: {
    flex: 1,
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
    gap: space.sm,
  },
  iconBtn: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.panel,
    justifyContent: 'center',
    alignItems: 'center',
  },
}));
