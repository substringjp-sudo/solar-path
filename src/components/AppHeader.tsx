/**
 * AppHeader.tsx
 *
 * 앱 맨 위 한 줄 — **탭 셋(01 하늘 · 02 예보 · 03 기록)** + 위치(장소 이름) · 설정.
 *
 * ## 달라진 것 (2026-10-25, 디자인 2단)
 *
 * - 탭 이름을 디자인 시스템 이름으로 바꿨습니다("시뮬레이션 · 갤러리" → "하늘 · 기록").
 * - 그 사이에 **02 예보**(16일 × 일출 · 일몰 판정, `ForecastScreen`)를 끼웠습니다. 기록은 03 입니다.
 * - 위치 버튼이 지금 장소를 이름으로 보여 줍니다(`placeLabel`). 예전에는 핀 아이콘만 있어 어느 하늘인지 알 수 없었습니다.
 *
 * ## 달라진 것 (§143)
 *
 * - **날짜 바를 뺐습니다.** 날짜 표시·앞뒤 하루·"오늘"·달력은 하단의 날짜·시간 막대(`TimeBar/DateTimeBar`)가
 *   전부 합니다. 같은 값을 위아래에서 두 번 보여 주고 있었습니다.
 * - **지도 탭을 뺐습니다.** 지도·구는 하늘 탭을 핀치로 줌아웃하면 같은 화면에서 이어집니다(`zoomContinuum.ts`).
 *   지도 탭의 등시선·구름 레이더는 그 줌 화면이 이미 그립니다.
 *
 * (옛 구조의 이력: docs/IA_REDESIGN.md — 카테고리 드롭다운 × 서브탭 → 평면 3탭 → 2탭 → 지금의 3탭.)
 */
import React, { useMemo, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, Animated, useWindowDimensions } from 'react-native';
import { MapPin, Settings } from 'lucide-react-native';
import { useCelestialStore } from '../store/useCelestialStore';
import { t, L3 } from '../utils/i18n';
import { color, radius, mono, space, type, TOUCH } from '../theme/tokens';
import type { SavedLocation } from '../store/useCelestialStore';
import { PressScale } from './ui';
import { timeTo } from '../theme/motion';
import { makeStyles, useThemeColors } from '../theme/useTheme';

/** 앱의 최상위 화면. 이 셋이 전부입니다. */
export type AppTab = 'sky' | 'forecast' | 'log';

export const APP_TABS: { id: AppTab; code: string; label: string }[] = [
  { id: 'sky', code: '01', label: '01 SKY' },
  { id: 'forecast', code: '02', label: '02 AHEAD' },
  { id: 'log', code: '03', label: '03 LOG' },
];

/**
 * 헤더 위치 버튼에 적을 이름. 저장한 장소와 1km 안이면 그 이름, 아니면 짧은 좌표입니다.
 * 역지오코딩(네트워크)은 부르지 않습니다 — 사진 올리기에서만 씁니다.
 */
export function placeLabel(lat: number | undefined, lon: number | undefined, saved: SavedLocation[]): string | null {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.cos((lat * Math.PI) / 180);
  let best: { name: string; d: number } | null = null;
  for (const s of saved) {
    const d = Math.hypot((s.latitude - lat) * kmPerDegLat, (s.longitude - lon) * kmPerDegLon);
    if (d <= 1 && (!best || d < best.d)) best = { name: s.name, d };
  }
  if (best) return best.name;
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}

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
  const location = useCelestialStore(s => s.location);
  const savedLocations = useCelestialStore(s => s.savedLocations);
  const place = useMemo(
    () => placeLabel(location?.coords?.latitude, location?.coords?.longitude, savedLocations),
    [location?.coords?.latitude, location?.coords?.longitude, savedLocations],
  );

  // 탭이 셋이 되어 좁은 폭(360 미만)에서는 장소 이름을 접고 핀만 둡니다 — 이름은 읽기 라벨에 그대로 남습니다.
  const showPlaceName = useWindowDimensions().width >= 360;

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
                  {/* 번호는 실제 순서라 붙이고 이름은 언어를 따릅니다(디자인 시스템 · 말투). */}
                  {`${tab.code} ${tab.id === 'sky' ? L3(language, '하늘', 'SKY', '空')
                    : tab.id === 'forecast' ? L3(language, '예보', 'AHEAD', '予報')
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
              style={styles.placeBtn}
              accessibilityLabel={`${L3(language, '위치 변경', 'Change location', '位置を変更')}${place ? ` — ${place}` : ''}`}
              accessibilityRole="button"
            >
              <MapPin size={16} color={color.accent} />
              {!!place && showPlaceName && <Text style={styles.placeText} numberOfLines={1}>{place}</Text>}
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
  /** 위치 버튼 — 지금 어느 하늘인지 이름으로 보여 줍니다(예전에는 핀 아이콘만). */
  placeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: TOUCH,
    minWidth: TOUCH,
    maxWidth: 112,
    paddingHorizontal: space.md,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.panel,
    justifyContent: 'center',
  },
  placeText: { ...type.bodyStrong, color: color.text, flexShrink: 1 },
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
