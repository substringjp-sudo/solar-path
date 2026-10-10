/**
 * PeekSheet.tsx
 *
 * 아래에서 끌어올리는 시트. 닫힌 상태에서는 **한 줄 요약**만 보이고,
 * 끌어올리면 자세한 내용이 나옵니다.
 *
 * Why: 작은 화면에서 3D 씬·정보 패널·타임 슬라이더를 세로로 쌓으면 셋 다
 * 좁아집니다. 나누는 대신 **순서를 만드는** 편이 낫습니다 — 씬은 화면을 꽉 채우고,
 * 정보는 필요할 때 위로 덮습니다.
 *
 * 상시 노출은 요약 한 줄뿐이라 씬이 잃는 높이가 52px입니다.
 *
 * ⚠ 예전에는 시트가 씬과 같은 세로 줄에서 자라서, 펼치면 3D 하늘이 그만큼 **찌그러졌습니다**
 *   (사용자 2026-09-30: "설정은 화면 위에 겹쳐지게 열리는데 추천이벤트는 열면 시뮬레이션이
 *   찌그러지는데 그냥 같이 위에 겹쳤으면"). 이제 시트는 부모(무대)의 아래에 **떠서** 씬 위로
 *   올라오고, 씬 크기는 그대로입니다. 펼친 동안은 씬에 옅은 막이 깔리고, 막을 누르면 닫힙니다.
 *   부모는 `position: relative` 인 무대여야 하고, 씬은 아래에서 `PEEK_HEIGHT` 만큼 비켜 둡니다.
 */
import React, { useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Animated,
  PanResponder,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useCelestialStore } from '../../store/useCelestialStore';
import { color, radius, mono } from '../../theme/tokens';
import { PressScale } from '../ui';
import { springTo } from '../../theme/motion';
import { makeStyles, useThemeColors } from '../../theme/useTheme';

/** 닫힌 상태에서 보이는 높이 (grabber + 요약 한 줄) */
export const PEEK_HEIGHT = 40;

interface PeekSheetProps {
  /** 닫힌 상태에 보이는 요약 (한 줄) */
  summary: React.ReactNode;
  /** 펼쳤을 때 나오는 내용 */
  children: React.ReactNode;
  theme: any;
  /** 펼쳤을 때 화면 높이의 몇 %를 차지할지 */
  expandedRatio?: number;
  /** 무대(부모) 높이 — 펼친 높이가 이보다 커지지 않게 */
  maxHeight?: number;
}

export const PeekSheet: React.FC<PeekSheetProps> = ({
  summary,
  children,
  theme,
  expandedRatio = 0.62,
  maxHeight,
}) => {
  const color = useThemeColors(); const styles = useStyles();
  const { height } = useWindowDimensions();
  const expandedHeight = Math.round(Math.min(height * expandedRatio, maxHeight ? maxHeight - 12 : Infinity));
  /** 펼침 정도 0(닫힘) ~ 1(열림) */
  const progress = useRef(new Animated.Value(0)).current;
  const progressValue = useRef(0);
  const dragStart = useRef(0);

  // 실제 수치를 따라가야 드래그 시작점을 잡을 수 있습니다.
  React.useEffect(() => {
    const id = progress.addListener(({ value }) => {
      progressValue.current = value;
    });
    return () => progress.removeListener(id);
  }, [progress]);

  const animateTo = useCallback(
    (to: number) => {
      springTo(progress, to, 'sheet', { useNativeDriver: false }).start();
    },
    [progress]
  );

  const travel = Math.max(1, expandedHeight - PEEK_HEIGHT);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      // 세로 드래그일 때만 잡습니다. 가로는 탭 스와이프에 양보합니다.
      onMoveShouldSetPanResponder: (_evt, g) =>
        Math.abs(g.dy) > Math.abs(g.dx) && Math.abs(g.dy) > 6,
      onPanResponderGrant: () => {
        // 시트를 잡는 동안 탭 스와이프가 가로채지 않도록 막습니다.
        useCelestialStore.getState().setGestureBlocked(true);
        dragStart.current = progressValue.current;
      },
      onPanResponderMove: (_evt, g) => {
        // 위로 끌면 dy가 음수 → 펼침이 커집니다.
        const next = dragStart.current - g.dy / travel;
        progress.setValue(Math.max(0, Math.min(1, next)));
      },
      onPanResponderRelease: (_evt, g) => {
        useCelestialStore.getState().setGestureBlocked(false);
        const flung = Math.abs(g.vy) > 0.5;
        if (flung) animateTo(g.vy < 0 ? 1 : 0);
        else animateTo(progressValue.current > 0.4 ? 1 : 0);
      },
      onPanResponderTerminate: () => {
        useCelestialStore.getState().setGestureBlocked(false);
        animateTo(progressValue.current > 0.4 ? 1 : 0);
      },
    })
  ).current;

  const sheetHeight = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [PEEK_HEIGHT, expandedHeight],
  });
  // 요약은 펼치면 사라지고, 본문은 펼치면 나타납니다.
  const summaryOpacity = progress.interpolate({
    inputRange: [0, 0.35],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const bodyOpacity = progress.interpolate({
    inputRange: [0.25, 0.8],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const toggle = useCallback(() => {
    animateTo(progressValue.current > 0.4 ? 0 : 1);
  }, [animateTo]);

  // 펼친 만큼 씬에 옅은 막 — 설정 창처럼 "위에 겹친" 층임을 알려 주고, 누르면 닫힙니다.
  const scrimOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const id = progress.addListener(({ value }) => setOpen((o) => (value > 0.05) !== o ? value > 0.05 : o));
    return () => progress.removeListener(id);
  }, [progress]);

  return (
    <>
    <Animated.View
      pointerEvents={open ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, { backgroundColor: color.scrim, opacity: scrimOpacity }]}
    >
      <PressScale reaction="none" style={StyleSheet.absoluteFill} onPress={() => animateTo(0)} accessibilityLabel="close" />
    </Animated.View>
    <Animated.View
      style={[
        styles.sheet,
        {
          height: sheetHeight,
          backgroundColor: theme?.card || theme?.glass || 'rgba(15, 23, 42, 0.94)',
          borderColor: theme?.border || color.border,
        },
      ]}
      {...panResponder.panHandlers}
    >
      <PressScale activeOpacity={0.9} onPress={toggle} style={styles.grabberArea}>
        <View style={[styles.grabber, { backgroundColor: theme?.subText || color.textDim }]} />
      </PressScale>

      {/* 요약 — 닫힌 상태의 유일한 콘텐츠 */}
      <Animated.View
        style={[styles.summaryRow, { opacity: summaryOpacity }]}
        pointerEvents="none"
      >
        {summary}
      </Animated.View>

      {/* 본문 — 요약 위에 겹쳐 페이드 인 */}
      <Animated.View style={[styles.body, { opacity: bodyOpacity }]}>
        {children}
      </Animated.View>
    </Animated.View>
    </>
  );
};

const useStyles = makeStyles((color) => ({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 16,
  },
  grabberArea: {
    paddingTop: 5,
    paddingBottom: 2,
    alignItems: 'center',
  },
  grabber: {
    width: 28,
    height: 2,
    borderRadius: 1,
    opacity: 0.5,
  },
  summaryRow: {
    position: 'absolute',
    top: 13,
    left: 0,
    right: 0,
    height: PEEK_HEIGHT - 13,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 2,
  },
}));
