/**
 * TabNavigator.tsx
 *
 * 평면 3탭(01 하늘 · 02 학습 · 03 기록) 컨텐츠 스위처. 스와이프 순서는 `TAB_ORDER` 하나에서 나오므로
 * 헤더 탭 순서와 어긋날 수 없습니다.
 *
 * Why (docs/IA_REDESIGN.md §1-B): 이전 구현은
 *   `tabOrder = ['tracker','sim','isoline','rainbow','all','my']`
 * 라는 평면 배열로 스와이프했는데, 실제 구조는 카테고리 × 서브탭 2단이었습니다.
 * 그래서 `sim`에서 스와이프하면 `rainbow`(cloud 카테고리)로 넘어가면서도
 * `selectedCategory`는 그대로였고, `sim3dView`는 배열에 없어 스와이프로
 * 오갈 수조차 없었습니다. 카테고리 개념을 없애 이 어긋남을 구조적으로 제거합니다.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, Animated, Dimensions, PanResponder } from 'react-native';
import { useCelestialStore } from '../store/useCelestialStore';
import { SkyScreen } from './SkyScreen/SkyScreen';
import { LearnScreen } from './LearnScreen/LearnScreen';
import { TAB_ORDER, type AppTab } from './AppHeader';
import { contentInsetTop } from '../utils/headerLayout';
import type { LearnEntry } from '../utils/learnSections';
import { springTo } from '../theme/motion';
import { ModeStrip } from './glass/ModeStrip';
import { modeList } from '../utils/modeStrip';

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
  /** 하단 막대의 날짜 글자를 누르면 여는 달력 창 */
  onOpenDatePicker?: () => void;
  isSuspended?: boolean;
  isCameraOverlayActive?: boolean;
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
  onOpenDatePicker,
  isSuspended = false,
  isCameraOverlayActive = false,
}) => {
  const { width } = Dimensions.get('window');

  const activeIndex = TAB_ORDER.indexOf(activeTab);
  // 01 하늘의 카드 · 점수 · 왜 그런가요에서 02 학습으로 올 때 싣는 요청(구역 · 주제 · 날). 들어올 때마다 nonce 가 달라져 같은 곳으로 다시 와도 맞춰집니다.
  const [learnEntry, setLearnEntry] = useState<LearnEntry | null>(null);
  const entryCount = useRef(0);
  const openLearn = (e: Omit<LearnEntry, 'nonce'>) => {
    entryCount.current += 1;
    setLearnEntry({ ...e, nonce: entryCount.current });
    setActiveTab('learn');
  };
  const pendingLearnEntry = useCelestialStore(s => s.pendingLearnEntry);
  const requestOpenLearn = useCelestialStore(s => s.requestOpenLearn);
  useEffect(() => {
    if (!pendingLearnEntry) return;
    openLearn(pendingLearnEntry);
    requestOpenLearn(null);
  }, [pendingLearnEntry]);
  const startX = useRef(0);
  const activeTabRef = useRef(activeTab);
  const activeIndexRef = useRef(activeIndex);
  const setActiveTabRef = useRef(setActiveTab);
  activeTabRef.current = activeTab;
  activeIndexRef.current = activeIndex;
  setActiveTabRef.current = setActiveTab;

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
          setActiveTabRef.current(target);
        } else {
          springTo(contentTranslateX, startX.current, 'page').start();
        }
      },
      onPanResponderTerminate: () => {
        springTo(contentTranslateX, startX.current, 'page').start();
      },
    })
  ).current;

  const language = useCelestialStore(s => s.language);
  const learnModes = useMemo(() => modeList(false), []);
  const learnEl = useMemo(
    () => (
      <LearnScreen
        isActive={activeTab === 'learn' && !isSuspended}
        setCurrentTime={setCurrentTime}
        onOpenSky={() => setActiveTabRef.current('sky')}
        entry={learnEntry}
      />
    ),
    [activeTab, isSuspended, setCurrentTime, learnEntry],
  );

  return (
    <View collapsable={false} style={styles.container} {...panResponder.panHandlers}>
      {/* React Native Android(Fabric)에서 GLView 상위 View 의 pointerEvents 가 'auto' ↔ 'none' 으로 바뀌고
          collapsable={false} 가 없으면 View Flattening 상태가 바뀌며 네이티브 ViewGroup 에서 TextureView(GLView)가
          removeView → addView 되어 SurfaceTexture 와 GLContext 가 파괴·재생성됩니다.
          가로 트랙과 양쪽 페이지 모두 collapsable={false} 로 고정하고 sky 페이지의 pointerEvents 는 고정합니다. */}
      <Animated.View
        collapsable={false}
        style={[
          styles.track,
          { width: width * TAB_ORDER.length, transform: [{ translateX: contentTranslateX }] },
        ]}
      >
        <View
          collapsable={false}
          pointerEvents={activeTab === 'learn' ? 'auto' : 'none'}
          style={[styles.page, { width, backgroundColor: theme.bg, paddingTop: contentInsetTop('learn') }]}
        >
          {learnEl}
          <View style={styles.dataBottomBar}>
            <ModeStrip
              mode="data"
              modes={learnModes}
              language={language}
              onPick={(m) => {
                if (m === 'data') return;
                if (m === 'simulation') { useCelestialStore.getState().setExpertMode(false); setActiveTabRef.current('sky'); return; }
                if (m === 'sandbox') { useCelestialStore.getState().setExpertMode(true); setActiveTabRef.current('sky'); return; }
                useCelestialStore.getState().setCameraScene(null);
                useCelestialStore.getState().setCameraHandoff(null);
                setActiveTabRef.current('sky');
                onCameraPress?.();
              }}
            />
          </View>
        </View>
        <View
          collapsable={false}
          style={[styles.page, { width, paddingTop: contentInsetTop('sky') }]}
        >
          <SkyScreen
            theme={theme}
            currentTime={currentTime}
            setCurrentTime={setCurrentTime}
            isTimeMachineEnabled={isTimeMachineEnabled}
            setTimeMachineEnabled={setTimeMachineEnabled}
            events={events}
            setMapVisible={setMapVisible}
            onCameraPress={onCameraPress}
            onOpenDatePicker={onOpenDatePicker}
            isActive={activeTab === 'sky' && !isSuspended}
            isCameraOverlayActive={isCameraOverlayActive}
            onOpenLearn={openLearn}
            onOpenData={() => setActiveTabRef.current('learn')}
          />
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  track: {
    flex: 1,
    flexDirection: 'row',
  },
  page: {
    height: '100%',
    flexShrink: 0,
  },
  dataBottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 6,
    paddingBottom: 6,
    backgroundColor: 'rgba(12, 16, 26, 0.9)',
  },
});
