/**
 * DockSheet.tsx — 접었다 펼치는 아래 막대(목업 "4차 b", 애플 카메라 참고). 계산은 `utils/dockStages.ts`(판정 verify-dock-stages.js).
 *
 * 맨 아래 고정부(`children`: 칩 · 시간 자 · 셔터 · 모드 줄) 위에 펼친 영역(`expanded`)을 얹습니다.
 * - 닫혀 있을 때도 `fullExtra` 기준으로 내용 실제 높이를 미리 재 두어 손가락 드래그가 막히지 않고 1:1 로 따라옵니다.
 * - 배경 딤 막은 `anim` 값에 연동해 화면 전체를 부드럽게 덮어 잘림/깜박임 없이 어두워집니다.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { dockExtraHeight, dragStage, tapNext, type DockStage } from '../../utils/dockStages';
import { useCelestialStore } from '../../store/useCelestialStore';
import { L3 } from '../../utils/i18n';
import { Scrim } from './Scrim';
import { isRecentDrag, markDragEnd } from './dragGuard';

type Lang = 'ko' | 'en' | 'ja';

interface Props {
  stage: DockStage;
  onStageChange: (s: DockStage) => void;
  language: Lang;
  /**
   * 펼친 영역(min 에서는 보이지 않음). 함수로 주면 쓸 수 있는 최대 높이(px)를 받아 그 안에 맞춰 그립니다.
   */
  expanded?: React.ReactNode | ((maxH: number) => React.ReactNode);
  /** 고정부: 칩 · 시간 자 · 셔터 · 모드 줄 */
  children: React.ReactNode;
  /** 화면 높이를 직접 넘길 때(하네스). 기본은 창 높이. */
  screenH?: number;
  /** mid 단계일 때 펼친 영역의 최대 높이. */
  midMaxH?: number;
  /** true 면 mid/full 구분 없이 콘텐츠 실제 높이(최대 fullExtra)까지 펼쳐 잘리지 않게 함. */
  fitContent?: boolean;
  /** true 면 손잡이와 펼침 영역을 숨기고 고정부만 둠. */
  hideHandle?: boolean;
  /** 고정부 + 손잡이 줄의 높이가 정해지거나 바뀔 때(px). */
  onFixedHeight?: (h: number) => void;
}

/** 손잡이 줄 높이(px). */
const HANDLE_ROW_H = 28;

const HANDLE_LABELS: Record<DockStage, [string, string, string]> = {
  min: ['펼치기', 'Expand', '広げる'],
  mid: ['더 펼치기', 'Expand more', 'さらに広げる'],
  full: ['접기', 'Collapse', '閉じる'],
};

export const DockSheet: React.FC<Props> = ({
  stage,
  onStageChange,
  language,
  expanded,
  children,
  screenH,
  midMaxH,
  fitContent = false,
  hideHandle = false,
  onFixedHeight,
}) => {
  const win = useWindowDimensions();
  const H = screenH ?? win.height;
  const [fixedH, setFixedH] = useState(270);
  const [contentH, setContentH] = useState(0);

  const rawExtra = dockExtraHeight(stage, H, fixedH + HANDLE_ROW_H);
  const fullExtra = dockExtraHeight('full', H, fixedH + HANDLE_ROW_H);

  let extra = rawExtra;
  if (stage !== 'min') {
    if (fitContent && contentH > 0) {
      extra = Math.min(fullExtra, contentH);
    } else {
      if (contentH > 0) extra = Math.min(extra, contentH);
      if (stage === 'mid' && midMaxH != null && midMaxH > 0) extra = Math.min(extra, midMaxH);
    }
  }

  // 닫혀 있을 때도 fullExtra 를 넘겨 내용 실제 높이를 미리 잼 (96px 로 잘려 드래그가 막히는 버그 방지)
  const panelMeasureMaxH = fitContent || stage === 'min' ? fullExtra : rawExtra;

  const anim = useRef(new Animated.Value(extra)).current;
  const animValRef = useRef(extra);
  const animTargetRef = useRef(extra);
  const draggingRef = useRef(false);
  const dragStartRef = useRef(extra);

  useEffect(() => {
    const id = anim.addListener(({ value }) => { animValRef.current = value; });
    return () => anim.removeListener(id);
  }, [anim]);

  useEffect(() => {
    if (draggingRef.current) return;
    if (Math.abs(extra - animTargetRef.current) < 0.5 && Math.abs(extra - animValRef.current) < 0.5) return;
    animTargetRef.current = extra;
    Animated.spring(anim, {
      toValue: extra,
      tension: 260,
      friction: 28,
      overshootClamping: true,
      useNativeDriver: false,
    }).start();
  }, [extra, anim]);

  const maxDrag = contentH > 0 ? Math.min(fullExtra, contentH) : fullExtra;
  const ref = useRef({ stage, onStageChange, extra, maxDrag, fitContent });
  ref.current = { stage, onStageChange, extra, maxDrag, fitContent };

  const springTo = (toValue: number) => {
    animTargetRef.current = toValue;
    Animated.spring(anim, {
      toValue,
      tension: 260,
      friction: 28,
      overshootClamping: true,
      useNativeDriver: false,
    }).start();
  };

  const makePan = (capture: boolean) => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: capture ? undefined : (_, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.4,
    onMoveShouldSetPanResponderCapture: capture ? (_, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2 : undefined,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      draggingRef.current = true;
      dragStartRef.current = animValRef.current;
      anim.stopAnimation();
      useCelestialStore.getState().setGestureBlocked(true);
    },
    onPanResponderMove: (_, g) => {
      const clamped = Math.max(0, Math.min(ref.current.maxDrag, dragStartRef.current - g.dy));
      anim.setValue(clamped);
    },
    onPanResponderRelease: (_, g) => {
      draggingRef.current = false;
      useCelestialStore.getState().setGestureBlocked(false);
      markDragEnd();
      const vy = g.vy * 1000;
      let next = dragStage(ref.current.stage, g.dy, vy);
      if (ref.current.fitContent) {
        if (next !== 'min') {
          next = 'full';
        } else if (ref.current.stage === 'min' && ref.current.maxDrag > 0 && animValRef.current >= Math.min(90, ref.current.maxDrag * 0.45)) {
          next = 'full';
        }
      }
      if (next !== ref.current.stage) {
        ref.current.onStageChange(next);
      } else {
        springTo(ref.current.extra);
      }
    },
    onPanResponderTerminate: () => {
      draggingRef.current = false;
      useCelestialStore.getState().setGestureBlocked(false);
      markDragEnd();
      springTo(ref.current.extra);
    },
  });
  const pan = useMemo(() => makePan(false), [anim]);
  const handlePan = useMemo(() => makePan(true), [anim]);

  const dimRange = Math.max(120, maxDrag);
  const dimOpacity = anim.interpolate({
    inputRange: [0, dimRange],
    outputRange: [0, 0.48],
    extrapolate: 'clamp',
  });
  const contentOpacity = anim.interpolate({
    inputRange: [0, 32],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const [ko, en, ja] = HANDLE_LABELS[stage];
  const onHandlePress = () => {
    if (isRecentDrag()) return;
    if (fitContent) {
      onStageChange(stage === 'min' ? 'full' : 'min');
    } else {
      onStageChange(tapNext(stage));
    }
  };

  return (
    <>
      {!hideHandle && (
        <Animated.View pointerEvents="none" style={[styles.backdropDim, { opacity: dimOpacity }]} />
      )}
      <View testID="dock" pointerEvents="box-none" style={styles.dock} {...(hideHandle ? {} : pan.panHandlers)}>
        <Scrim edge="bottom" height={fixedH + 72} />
        {!hideHandle && (
          <>
            <View {...handlePan.panHandlers}>
              <Pressable
                testID="dock-handle"
                accessibilityRole="button"
                accessibilityLabel={L3(language, ko, en, ja)}
                aria-expanded={stage !== 'min'}
                onPress={onHandlePress}
                hitSlop={{ top: 8, bottom: 8 }}
                style={styles.handleHit}
              >
                <View style={styles.handle} />
              </Pressable>
            </View>
            <Animated.View
              testID="dock-expanded"
              style={[styles.expanded, { height: anim, opacity: contentOpacity }]}
              pointerEvents={stage === 'min' ? 'none' : 'auto'}
            >
              <View
                style={{ maxHeight: fullExtra > 0 ? fullExtra : undefined }}
                onLayout={(e: LayoutChangeEvent) => {
                  const h = Math.ceil(e.nativeEvent.layout.height);
                  if (h > 0 && Math.abs(h - contentH) > 1) setContentH(h);
                }}
              >
                {typeof expanded === 'function' ? expanded(panelMeasureMaxH) : expanded}
              </View>
            </Animated.View>
          </>
        )}
        <View
          testID="dock-fixed"
          onLayout={(e: LayoutChangeEvent) => {
            const h = Math.round(e.nativeEvent.layout.height);
            if (h !== fixedH) setFixedH(h);
            onFixedHeight?.(h + (hideHandle ? 0 : HANDLE_ROW_H));
          }}
          style={styles.fixed}
        >
          {children}
        </View>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  backdropDim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 40 },
  handleHit: { alignSelf: 'center', minHeight: HANDLE_ROW_H, minWidth: 80, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 36, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
  expanded: { overflow: 'hidden' },
  fixed: { paddingBottom: 6, gap: 10 },
});
