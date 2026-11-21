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
  /** 펼친 영역(min 에서는 보이지 않음). 높이는 이 부품이 정합니다. */
  expanded?: React.ReactNode;
  /** 고정부: 칩 · 시간 자 · 셔터 · 모드 줄 */
  children: React.ReactNode;
  /** 화면 높이를 직접 넘길 때(하네스). 기본은 창 높이. */
  screenH?: number;
}

/** 손잡이 줄 높이(px). */
const HANDLE_ROW_H = 28;

const HANDLE_LABELS: Record<DockStage, [string, string, string]> = {
  min: ['펼치기', 'Expand', '広げる'],
  mid: ['더 펼치기', 'Expand more', 'さらに広げる'],
  full: ['접기', 'Collapse', '閉じる'],
};

export const DockSheet: React.FC<Props> = ({ stage, onStageChange, language, expanded, children, screenH }) => {
  const win = useWindowDimensions();
  const H = screenH ?? win.height;
  const [fixedH, setFixedH] = useState(380);
  // 막대 전체 = 손잡이 줄 + 펼친 영역 + 고정부. 펼친 영역이 쓸 수 있는 자리는 손잡이 줄까지 빼고 셉니다.
  const extra = dockExtraHeight(stage, H, fixedH + HANDLE_ROW_H);
  const anim = useRef(new Animated.Value(extra)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: extra, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [extra, anim]);

  const ref = useRef({ stage, onStageChange });
  ref.current = { stage, onStageChange };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, g) => {
      markDragEnd();
      const next = dragStage(ref.current.stage, g.dy, g.vy * 1000);
      if (next !== ref.current.stage) ref.current.onStageChange(next);
    },
  }), []);

  const [ko, en, ja] = HANDLE_LABELS[stage];
  return (
    <View testID="dock" pointerEvents="box-none" style={styles.dock} {...pan.panHandlers}>
      <Scrim edge="bottom" height={fixedH + extra + 40} />
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
      <Animated.View testID="dock-expanded" style={[styles.expanded, { height: anim }]} pointerEvents={stage === 'min' ? 'none' : 'auto'}>
        {expanded}
      </Animated.View>
      <View testID="dock-fixed" onLayout={(e: LayoutChangeEvent) => setFixedH(Math.round(e.nativeEvent.layout.height))} style={styles.fixed}>
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
