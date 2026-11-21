/**
 * DockSheet.tsx — 접었다 펼치는 아래 막대(목업 "4차 b", 애플 카메라 참고). 계산은 `utils/dockStages.ts`(판정 verify-dock-stages.js).
 *
 * 맨 아래 고정부(`children`: 칩 · 시간 자 · 셔터 · 모드 줄) 위에 펼친 영역(`expanded`)을 얹습니다. 접힘(min)은 고정부만, 펼침(mid) · 전체(full)는 영역이 자라 하늘을 더 덮습니다.
 * 손잡이를 누르면 다음 단계, 막대를 위로 밀면 펼침 · 아래로 밀면 접힘(40 px / 600 px/s 방향, 160 px / 1800 px/s 두 단계). 세로 밀기만 받으므로 가로로 끄는 시간 자 · 모드 줄과 겹치지 않습니다.
 * 뒤에는 아래 막이 깔려 밝은 하늘에서도 글자가 읽힙니다.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { dockExtraHeight, dragStage, tapNext, type DockStage } from '../../utils/dockStages';
import { color as DARK } from '../../theme/tokens';
import { L3 } from '../../utils/i18n';
import { Scrim } from './Scrim';
import { isRecentDrag, markDragEnd } from './dragGuard';

type Lang = 'ko' | 'en' | 'ja';

interface Props {
  stage: DockStage;
  onStageChange: (s: DockStage) => void;
  language: Lang;
  /**
   * 펼친 영역(min 에서는 보이지 않음). 높이는 이 부품이 정합니다. 함수로 주면 이 단계에서 쓸 수 있는 **최대 높이**(px)를 받아 그 안에 맞춰 그립니다
   * (긴 패널이 안쪽에서 스크롤되게 하려는 것 — 내용 높이로 줄인 값이 아니라 단계의 최대값이라, 내용이 늘어도 막히지 않습니다).
   */
  expanded?: React.ReactNode | ((maxH: number) => React.ReactNode);
  /** 고정부: 칩 · 시간 자 · 셔터 · 모드 줄 */
  children: React.ReactNode;
  /** 화면 높이를 직접 넘길 때(하네스). 기본은 창 높이. */
  screenH?: number;
  /** mid 단계일 때 펼친 영역의 최대 높이(콘텐츠 실제 높이에 맞춰 빈 여백을 없앨 때). */
  midMaxH?: number;
  /** 고정부 + 손잡이 줄의 높이가 정해지거나 바뀔 때(px). 막대 위에 떠 있는 것을 그만큼 올리는 데 씁니다. */
  onFixedHeight?: (h: number) => void;
}

/** 손잡이 줄 높이(px). */
const HANDLE_ROW_H = 28;

const HANDLE_LABELS: Record<DockStage, [string, string, string]> = {
  min: ['펼치기', 'Expand', '広げる'],
  mid: ['더 펼치기', 'Expand more', 'さらに広げる'],
  full: ['접기', 'Collapse', '閉じる'],
};

export const DockSheet: React.FC<Props> = ({ stage, onStageChange, language, expanded, children, screenH, midMaxH, onFixedHeight }) => {
  const win = useWindowDimensions();
  const H = screenH ?? win.height;
  const [fixedH, setFixedH] = useState(380);
  const [contentH, setContentH] = useState(0);
  // 막대 전체 = 손잡이 줄 + 펼친 영역 + 고정부. 펼친 영역이 쓸 수 있는 자리는 손잡이 줄까지 빼고 셉니다.
  const rawExtra = dockExtraHeight(stage, H, fixedH + HANDLE_ROW_H);
  const fullExtra = dockExtraHeight('full', H, fixedH + HANDLE_ROW_H);
  let extra = rawExtra;
  if (stage !== 'min') {
    if (contentH > 0) extra = Math.min(extra, contentH);
    if (stage === 'mid' && midMaxH != null && midMaxH > 0) extra = Math.min(extra, midMaxH);
  }

  const anim = useRef(new Animated.Value(extra)).current;
  const animValRef = useRef(extra);
  const draggingRef = useRef(false);
  const dragStartRef = useRef(extra);

  useEffect(() => {
    const id = anim.addListener(({ value }) => { animValRef.current = value; });
    return () => anim.removeListener(id);
  }, [anim]);

  useEffect(() => {
    if (draggingRef.current) return;
    Animated.timing(anim, { toValue: extra, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [extra, anim]);

  const maxDrag = contentH > 0 ? Math.min(fullExtra, contentH) : fullExtra;
  const ref = useRef({ stage, onStageChange, extra, maxDrag });
  ref.current = { stage, onStageChange, extra, maxDrag };
  const makePan = (capture: boolean) => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: capture ? undefined : (_, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.4,
    onMoveShouldSetPanResponderCapture: capture ? (_, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2 : undefined,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      draggingRef.current = true;
      dragStartRef.current = animValRef.current;
      anim.stopAnimation();
    },
    onPanResponderMove: (_, g) => {
      const clamped = Math.max(0, Math.min(ref.current.maxDrag, dragStartRef.current - g.dy));
      anim.setValue(clamped);
    },
    onPanResponderRelease: (_, g) => {
      draggingRef.current = false;
      markDragEnd();
      const next = dragStage(ref.current.stage, g.dy, g.vy * 1000);
      if (next !== ref.current.stage) {
        ref.current.onStageChange(next);
      } else {
        Animated.timing(anim, { toValue: ref.current.extra, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
      }
    },
    onPanResponderTerminate: () => {
      draggingRef.current = false;
      markDragEnd();
      Animated.timing(anim, { toValue: ref.current.extra, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    },
  });
  const pan = useMemo(() => makePan(false), [anim]);
  const handlePan = useMemo(() => makePan(true), [anim]);

  const [ko, en, ja] = HANDLE_LABELS[stage];
  return (
    <View testID="dock" pointerEvents="box-none" style={styles.dock} {...pan.panHandlers}>
      <Scrim edge="bottom" height={fixedH + extra + 40} />
      <View {...handlePan.panHandlers}>
        <Pressable
          testID="dock-handle"
          accessibilityRole="button"
          accessibilityLabel={L3(language, ko, en, ja)}
          aria-expanded={stage !== 'min'}
          onPress={() => { if (!isRecentDrag()) onStageChange(tapNext(stage)); }}
          hitSlop={{ top: 8, bottom: 8 }}
          style={styles.handleHit}
        >
          <View style={styles.handle} />
        </Pressable>
      </View>
      <Animated.View testID="dock-expanded" style={[styles.expanded, { height: anim }]} pointerEvents={stage === 'min' ? 'none' : 'auto'}>
        <View
          style={{ maxHeight: fullExtra > 0 ? fullExtra : undefined }}
          onLayout={(e: LayoutChangeEvent) => {
            const h = Math.ceil(e.nativeEvent.layout.height);
            if (h !== contentH) setContentH(h);
          }}
        >
          {typeof expanded === 'function' ? expanded(rawExtra) : expanded}
        </View>
      </Animated.View>
      <View testID="dock-fixed" onLayout={(e: LayoutChangeEvent) => { const h = Math.round(e.nativeEvent.layout.height); setFixedH(h); onFixedHeight?.(h + HANDLE_ROW_H); }} style={styles.fixed}>
        {children}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 40 },
  handleHit: { alignSelf: 'center', minHeight: HANDLE_ROW_H, minWidth: 80, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 36, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
  expanded: { overflow: 'hidden' },
  fixed: { paddingBottom: 6, gap: 10 },
});
void DARK;
