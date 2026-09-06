/**
 * TabNavigator.tsx
 *
 * 평면 3탭 컨텐츠 스위처. 스와이프 순서는 `TAB_ORDER` 하나에서 나오므로
 * 헤더 탭 순서와 어긋날 수 없습니다.
 *
 * Why (docs/IA_REDESIGN.md §1-B): 이전 구현은
 *   `tabOrder = ['tracker','sim','isoline','rainbow','all','my']`
 * 라는 평면 배열로 스와이프했는데, 실제 구조는 카테고리 × 서브탭 2단이었습니다.
 * 그래서 `sim`에서 스와이프하면 `rainbow`(cloud 카테고리)로 넘어가면서도
 * `selectedCategory`는 그대로였고, `sim3dView`는 배열에 없어 스와이프로
 * 오갈 수조차 없었습니다. 카테고리 개념을 없애 이 어긋남을 구조적으로 제거합니다.
 */
import React, { useRef } from 'react';
import { StyleSheet, View, Animated, Platform, Dimensions, PanResponder } from 'react-native';
import { useCelestialStore } from '../store/useCelestialStore';
import { SkyScreen } from './SkyScreen/SkyScreen';
import { MapScreen } from './MapScreen/MapScreen';
import { Gallery } from './Gallery';
import { TAB_ORDER, type AppTab } from './AppHeader';

interface TabNavigatorProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  contentOpacity: Animated.Value;
  contentTranslateX: Animated.Value;
  events: any;
  theme: any;
  dynamicTheme: any;
  currentTime: Date;
  setCurrentTime: (time: Date) => void;
  isTimeMachineEnabled: boolean;
  setTimeMachineEnabled: (enabled: boolean) => void;
  globalPhotos: any[];
  myPhotos: any[];
  removeGlobalPhoto: (id: string) => Promise<void>;
  setMapVisible: (visible: boolean) => void;
  onCameraPress?: () => void;
  isSuspended?: boolean;
}

export const TabNavigator: React.FC<TabNavigatorProps> = ({
  activeTab,
  setActiveTab,
  contentTranslateX,
  events,
  theme,
  dynamicTheme,
  currentTime,
  setCurrentTime,
  isTimeMachineEnabled,
  setTimeMachineEnabled,
  globalPhotos,
  myPhotos,
  removeGlobalPhoto,
  setMapVisible,
  onCameraPress,
  isSuspended = false,
}) => {
  const { width } = Dimensions.get('window');

  const activeIndex = TAB_ORDER.indexOf(activeTab);
  const startX = useRef(0);
  const activeTabRef = useRef(activeTab);
  const activeIndexRef = useRef(activeIndex);
  activeTabRef.current = activeTab;
  activeIndexRef.current = activeIndex;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // 씬 회전·슬라이더·시트 드래그 중에는 탭 스와이프가 가로채면 안 됩니다.
        if (useCelestialStore.getState().isGestureBlocked) return false;

        const { pageY } = evt.nativeEvent;
        const { height } = Dimensions.get('window');
        // 하단 컨트롤(타임 슬라이더·peek 시트) 영역은 양보합니다.
        if (pageY > height - 200) return false;

        const isHorizontal = Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
        return isHorizontal && Math.abs(gestureState.dx) > 12;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        startX.current = -activeIndexRef.current * width;
      },
      onPanResponderMove: (_evt, gestureState) => {
        let dx = gestureState.dx;
        // 양 끝에서는 고무줄
        if (
          (activeIndexRef.current === 0 && dx > 0) ||
          (activeIndexRef.current === TAB_ORDER.length - 1 && dx < 0)
        ) {
          dx = dx * 0.35;
        }
        contentTranslateX.setValue(startX.current + dx);
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const swipeThreshold = width * 0.25;
        const velocityThreshold = 0.3;
        const { dx, vx } = gestureState;

        let target: AppTab | null = null;
        if (dx < -swipeThreshold || vx < -velocityThreshold) {
          if (activeIndexRef.current < TAB_ORDER.length - 1) {
            target = TAB_ORDER[activeIndexRef.current + 1];
          }
        } else if (dx > swipeThreshold || vx > velocityThreshold) {
          if (activeIndexRef.current > 0) {
            target = TAB_ORDER[activeIndexRef.current - 1];
          }
        }

        if (target && target !== activeTabRef.current) {
          setActiveTab(target);
        } else {
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
      },
    })
  ).current;

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <View style={[styles.page, { width }, activeTab !== 'sky' && styles.hiddenPage]}>
        <SkyScreen
          theme={theme}
          currentTime={currentTime}
          setCurrentTime={setCurrentTime}
          isTimeMachineEnabled={isTimeMachineEnabled}
          setTimeMachineEnabled={setTimeMachineEnabled}
          events={events}
          setMapVisible={setMapVisible}
          onCameraPress={onCameraPress}
          isActive={activeTab === 'sky' && !isSuspended}
        />
      </View>
      <View style={[styles.page, { width }, activeTab !== 'map' && styles.hiddenPage]}>
        <MapScreen
          theme={theme}
          currentTime={currentTime}
          setCurrentTime={setCurrentTime}
          isTimeMachineEnabled={isTimeMachineEnabled}
          setTimeMachineEnabled={setTimeMachineEnabled}
          events={events}
          onCameraPress={onCameraPress}
          isActive={activeTab === 'map'}
        />
      </View>
      <View style={[styles.page, { width }, activeTab !== 'log' && styles.hiddenPage]}>
        <Gallery
          theme={theme}
          dynamicTheme={dynamicTheme}
          globalPhotos={globalPhotos}
          myPhotos={myPhotos}
          removeGlobalPhoto={removeGlobalPhoto}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  page: {
    flex: 1,
  },
  hiddenPage: {
    display: 'none',
  },
});
