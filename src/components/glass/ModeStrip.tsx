/**
 * ModeStrip.tsx — 셔터 아래 모드 줄(목업 "5차: 모드 줄"). 가운데 글자가 지금 모드이고 양옆은 멀수록 투명합니다.
 * 좌우로 밀면 한 칸씩(세게 밀면 두 칸) 붙고, 글자를 눌러도 그 모드로 갑니다. 하늘 쪽에서 카메라 쪽으로 가면 사진에 내립니다(`utils/modeStrip.ts`, 판정 verify-mode-strip.js).
 * 밀기는 이 줄에서만 받습니다 — 화면 가운데 드래그는 3D 하늘 회전입니다.
 *
 * 모드를 실제로 바꾸는 일(가이드 걸기 포함)은 바깥이 합니다(`onPick` 으로 받은 모드를 `switchMode` 에 넘김).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { color as DARK } from '../../theme/tokens';
import { TEXT } from '../../theme/glassTokens';
import { dragMode, modeName, pickMode, stripLayout, type AppMode } from '../../utils/modeStrip';
import { L3 } from '../../utils/i18n';
import { glassTextShadow } from './GlassSurface';
import { isRecentDrag, markDragEnd } from './dragGuard';

type Lang = 'ko' | 'en' | 'ja';

interface Props {
  mode: AppMode;
  modes: readonly AppMode[];
  language: Lang;
  onPick: (mode: AppMode) => void;
}

const ITEM_W = 84;
const H = 44;

let lastGlobalMode: AppMode | null = null;
let lastSlideDir: -1 | 0 | 1 = 0;

/** 마지막 모드 이동 방향(+1: 오른쪽 모드, -1: 왼쪽 모드) — 상단 UI 연동 슬라이드에 사용 */
export const getLastModeSlideDir = (): -1 | 0 | 1 => lastSlideDir;
export const recordModeTransition = (from: AppMode | null, to: AppMode, list: readonly AppMode[]): -1 | 0 | 1 => {
  if (!from || from === to) return 0;
  const a = list.indexOf(from);
  const b = list.indexOf(to);
  if (a < 0 || b < 0 || a === b) return 0;
  lastSlideDir = b > a ? 1 : -1;
  return lastSlideDir;
};

export const ModeStrip: React.FC<Props> = ({ mode, modes, language, onPick }) => {
  const [width, setWidth] = useState(390);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const dragAnim = useRef(new Animated.Value(0)).current;
  const dragValRef = useRef(0);
  const prevModeRef = useRef<AppMode | null>(lastGlobalMode);
  const translateX = useMemo(() => Animated.add(slideAnim, dragAnim), [slideAnim, dragAnim]);

  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    lastGlobalMode = mode;
    if (prev && prev !== mode) {
      const prevIdx = modes.indexOf(prev);
      const curIdx = modes.indexOf(mode);
      if (prevIdx >= 0 && curIdx >= 0 && prevIdx !== curIdx) {
        recordModeTransition(prev, mode, modes);
        const startOffset = (curIdx - prevIdx) * ITEM_W + dragValRef.current;
        dragValRef.current = 0;
        dragAnim.setValue(0);
        slideAnim.setValue(startOffset);
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
        return;
      }
    }
    dragValRef.current = 0;
    dragAnim.setValue(0);
  }, [mode, modes, slideAnim, dragAnim]);

  const ref = useRef({ mode, modes, onPick });
  ref.current = { mode, modes, onPick };

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => {
      const clamped = Math.max(-ITEM_W * 1.5, Math.min(ITEM_W * 1.5, g.dx));
      dragValRef.current = clamped;
      dragAnim.setValue(clamped);
    },
    onPanResponderRelease: (_, g) => {
      markDragEnd();
      const next = dragMode(ref.current.modes, ref.current.mode, g.dx, g.vx * 1000);
      if (next !== ref.current.mode) {
        ref.current.onPick(next);
        // 탭이나 오버레이 전환(예: 데이터 ↔ 시뮬레이션, 시뮬레이션 → 카메라)처럼 이 인스턴스의 mode prop 자체가
        // 바뀌지 않는 경우에도 다음 프레임에 dragAnim 을 0 으로 되돌려 줄이 밀린 채로 굳지 않게 합니다.
        requestAnimationFrame(() => {
          if (dragValRef.current !== 0) {
            dragValRef.current = 0;
            Animated.timing(dragAnim, {
              toValue: 0,
              duration: 180,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }).start();
          }
        });
      } else {
        dragValRef.current = 0;
        Animated.timing(dragAnim, {
          toValue: 0,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      }
    },
    onPanResponderTerminate: () => {
      markDragEnd();
      dragValRef.current = 0;
      Animated.timing(dragAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    },
  }), [dragAnim]);

  const items = stripLayout(modes, mode, width, ITEM_W);
  return (
    <View
      testID="mode-strip"
      {...pan.panHandlers}
      accessibilityRole="tablist"
      accessibilityLabel={L3(language, '모드, 좌우로 밀거나 눌러 바꾸기', 'Mode, swipe sideways or tap', 'モード、左右にスワイプまたはタップ')}
      onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width) || 390)}
      style={styles.strip}
    >
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}>
        {items.map(i => {
          const on = i.mode === mode;
          return (
            <Pressable
              key={i.mode}
              testID={`mode-${i.mode}`}
              accessibilityRole="tab"
              aria-selected={on}
              onPress={() => { if (isRecentDrag()) return; const t = pickMode(modes, mode, i.mode); if (t !== mode) onPick(t); }}
              style={[styles.item, { left: i.x - ITEM_W / 2, opacity: i.visible ? i.opacity : 0.12 }]}
            >
              <Text style={[styles.label, { fontWeight: on ? '600' : '400' }, glassTextShadow]}>{modeName(i.mode, language)}</Text>
            </Pressable>
          );
        })}
      </Animated.View>
      <View pointerEvents="none" style={[styles.dot, { left: width / 2 - 2 }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  strip: { height: H, alignSelf: 'stretch', overflow: 'hidden' },
  item: { position: 'absolute', top: 0, width: ITEM_W, height: H, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, letterSpacing: 0.3, color: TEXT },
  dot: { position: 'absolute', bottom: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: DARK.accent },
});
