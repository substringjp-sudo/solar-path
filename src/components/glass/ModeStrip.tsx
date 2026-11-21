/**
 * ModeStrip.tsx — 셔터 아래 모드 줄(목업 "5차: 모드 줄"). 가운데 글자가 지금 모드이고 양옆은 멀수록 투명합니다.
 * 좌우로 밀면 한 칸씩(세게 밀면 두 칸) 붙고, 글자를 눌러도 그 모드로 갑니다. 하늘 쪽에서 카메라 쪽으로 가면 사진에 내립니다(`utils/modeStrip.ts`, 판정 verify-mode-strip.js).
 * 밀기는 이 줄에서만 받습니다 — 화면 가운데 드래그는 3D 하늘 회전입니다.
 *
 * 모드를 실제로 바꾸는 일(가이드 걸기 포함)은 바깥이 합니다(`onPick` 으로 받은 모드를 `switchMode` 에 넘김).
 */
import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
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

export const ModeStrip: React.FC<Props> = ({ mode, modes, language, onPick }) => {
  const [width, setWidth] = useState(390);
  const [dragDx, setDragDx] = useState(0);
  const ref = useRef({ mode, modes, onPick });
  ref.current = { mode, modes, onPick };

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => setDragDx(Math.max(-ITEM_W * 1.5, Math.min(ITEM_W * 1.5, g.dx))),
    onPanResponderRelease: (_, g) => {
      markDragEnd();
      setDragDx(0);
      const next = dragMode(ref.current.modes, ref.current.mode, g.dx, g.vx * 1000);
      if (next !== ref.current.mode) ref.current.onPick(next);
    },
    onPanResponderTerminate: () => { markDragEnd(); setDragDx(0); },
  }), []);

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
      {items.filter(i => i.visible).map(i => {
        const on = i.mode === mode;
        return (
          <Pressable
            key={i.mode}
            testID={`mode-${i.mode}`}
            accessibilityRole="tab"
            aria-selected={on}
            onPress={() => { if (isRecentDrag()) return; const t = pickMode(modes, mode, i.mode); if (t !== mode) onPick(t); }}
            style={[styles.item, { left: i.x - ITEM_W / 2 + dragDx, opacity: i.opacity }]}
          >
            <Text style={[styles.label, { fontWeight: on ? '800' : '600' }, glassTextShadow]}>{modeName(i.mode, language)}</Text>
          </Pressable>
        );
      })}
      <View pointerEvents="none" style={[styles.dot, { left: width / 2 - 2 }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  strip: { height: H, alignSelf: 'stretch', overflow: 'hidden' },
  item: { position: 'absolute', top: 0, width: ITEM_W, height: H, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13, letterSpacing: 0.3, color: TEXT },
  dot: { position: 'absolute', bottom: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: DARK.accent },
});
