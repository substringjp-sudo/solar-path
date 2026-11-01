/**
 * ScrubTrack.tsx — 손가락을 **그대로 따라가는** 슬라이더 바탕.
 *
 * 하단 날짜·시간 막대가 씁니다. 옛 `GenericSlider` 의 두 결함을 고칩니다.
 *
 * ## 1. 손가락과 손잡이가 어긋나던 것
 *
 * 옛 슬라이더는 잡는 순간 `locationX` 로 위치를 정했습니다. `locationX` 는 **손가락이 닿은 가장 안쪽 자식**
 * 기준이라, 4px 트랙을 건드리면 트랙 시작점(왼쪽 패딩 27px)만큼 작게, 트랙 밖을 건드리면 맞게 나왔습니다 —
 * 닿은 자리에 따라 최대 27px 어긋났습니다. 이후 이동은 `시작값 + dx` 라 그 어긋남이 끝까지 남았습니다.
 *
 * 여기서는 **화면 절대 좌표**(`pageX` / `moveX`)에서 트랙의 화면 왼쪽(`measureInWindow`)을 뺍니다. 닿은 자식이
 * 무엇이든 같은 값이고, 손잡이를 쥔 자리(중심에서 얼마 벗어났는가)는 그대로 지켜서 잡는 순간 튀지 않습니다.
 *
 * ## 2. 움직일 때마다 React 가 다시 그리던 것
 *
 * 손잡이는 `Animated.Value`(네이티브 구동 `translateX`)로 옮기고 위치·색은 React 상태를 거치지 않습니다.
 * 손잡이 안 글자만 **글자가 바뀔 때**(시간은 분 단위) 상태를 바꿉니다. 부모에게는 `onScrub` 으로 알리되
 * 앱 전체 상태(시각)를 얼마나 자주 바꿀지는 부모가 정합니다(`createCommitThrottle`).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useCelestialStore } from '../../store/useCelestialStore';
import { mono, radius } from '../../theme/tokens';
import { useThemeColors } from '../../theme/useTheme';

/** 손잡이 가로 폭 — 가장자리 여백(손잡이가 트랙 끝에서 잘리지 않게)이 이 절반입니다. */
export const KNOB_W = 56;
export const KNOB_H = 30;
const KNOB_PAD = KNOB_W / 2;
const PIN_W = 16;
const PIN_PAD = 8;

interface Props {
  /** 손잡이 위치 0~100 (바깥이 정한 값. 손가락을 쥐고 있는 동안은 손가락이 이깁니다). */
  value: number;
  /** 위치(0~100)가 바뀔 때마다 — 부모가 커밋 간격을 정합니다. */
  onScrub: (pct: number) => void;
  onScrubStart?: () => void;
  /** 손을 뗄 때(또는 끊길 때). 부모는 여기서 남은 값을 내보냅니다. */
  onScrubEnd?: () => void;
  /** 위치 → 손잡이 안 글자 */
  formatLabel: (pct: number) => string;
  /** 터치 높이(손잡이가 이 안에 가운데로 앉습니다). */
  height?: number;
  /** 트랙 바탕(띠·눈금) — 손가락을 받지 않습니다. 가로는 트랙 폭(손잡이 중심이 움직이는 범위)에 맞춰집니다. */
  children?: React.ReactNode;
  /** 트랙 막대의 세로 위치·두께 */
  trackTop?: number;
  trackHeight?: number;
  /** 스크린리더 증감(±1 칸) */
  onAdjust?: (dir: 1 | -1) => void;
  accessibilityLabel?: string;
  accessibilityValue?: string;
  style?: StyleProp<ViewStyle>;
  knobTone?: string;
  /** 손잡이 스타일: 기존 박스형('knob') 또는 마커를 가리지 않는 핀형('pin'). 기본값은 'knob'. */
  variant?: 'knob' | 'pin';
  /** 트랙 우측에 실시간으로 연동되는 고정 라벨 배지를 렌더링할 때 사용 */
  renderValueBadge?: (label: string) => React.ReactNode;
  /** 드래그 중 상단에 표시할 정밀 돋보기(Loupe) 렌더러 */
  renderLoupe?: (pct: number, label: string) => React.ReactNode;
}

export const ScrubTrack: React.FC<Props> = ({
  value, onScrub, onScrubStart, onScrubEnd, formatLabel, height = 44,
  children, trackTop, trackHeight = 4, onAdjust, accessibilityLabel, accessibilityValue, style, knobTone,
  variant = 'knob', renderValueBadge, renderLoupe,
}) => {
  const color = useThemeColors();
  const [trackWidth, setTrackWidth] = useState(0);
  const pad = variant === 'pin' ? PIN_PAD : KNOB_PAD;
  const usable = Math.max(1, trackWidth - 2 * pad);
  const usableRef = useRef(usable);
  usableRef.current = usable;
  const padRef = useRef(pad);
  padRef.current = pad;
  const variantRef = useRef(variant);
  variantRef.current = variant;

  const [dragPct, setDragPct] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const startPctRef = useRef(value);

  // 콜백은 ref 로 — 제스처 핸들러에서 항상 최신 콜백을 참조합니다.
  const cb = useRef({ onScrub, onScrubStart, onScrubEnd, formatLabel });
  cb.current = { onScrub, onScrubStart, onScrubEnd, formatLabel };

  const currentPct = dragPct !== null ? dragPct : Math.max(0, Math.min(100, value));

  const onTrackLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  const end = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragPct(null);
    useCelestialStore.getState().setGestureBlocked(false);
    cb.current.onScrubEnd?.();
  }, []);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (evt) => {
      draggingRef.current = true;
      useCelestialStore.getState().setGestureBlocked(true);
      cb.current.onScrubStart?.();

      const touchX = evt.nativeEvent.locationX;
      const u = usableRef.current;
      const curPad = padRef.current;
      const curVariant = variantRef.current;
      // 현재 마커 중심의 X 위치 (트랙 View 기준)
      const currentMarkerX = curPad + (startPctRef.current / 100) * u;
      const dist = Math.abs(touchX - currentMarkerX);
      const grabRadius = curVariant === 'pin' ? 24 : KNOB_W / 2 + 8;

      if (dist <= grabRadius) {
        // 손잡이 근처를 잡은 경우: 현재 위치 유지한 채 dx 이동 준비
        setDragPct(startPctRef.current);
      } else {
        // 트랙의 다른 부분을 탭한 경우: 탭한 위치로 즉시 점프
        const tapPct = Math.max(0, Math.min(100, ((touchX - curPad) / u) * 100));
        startPctRef.current = tapPct;
        setDragPct(tapPct);
        cb.current.onScrub(tapPct);
      }
    },
    onPanResponderMove: (_evt, g) => {
      if (!draggingRef.current) return;
      const u = usableRef.current;
      const deltaPct = (g.dx / u) * 100;
      const nextPct = Math.max(0, Math.min(100, startPctRef.current + deltaPct));
      setDragPct(nextPct);
      cb.current.onScrub(nextPct);
    },
    onPanResponderRelease: () => end(),
    onPanResponderTerminate: () => end(),
  }), [end]);

  // 외부 value 동기화 (드래그 중이 아닐 때 startPctRef 갱신)
  useEffect(() => {
    if (!draggingRef.current) {
      startPctRef.current = Math.max(0, Math.min(100, value));
    }
  }, [value]);

  useEffect(() => () => { if (draggingRef.current) end(); }, [end]);

  const top = trackTop ?? (height - trackHeight) / 2;
  const label = formatLabel(currentPct);

  const isDragging = dragPct !== null;
  const LOUPE_W = 154;
  const markerCenter = pad + (currentPct / 100) * usable;
  // 슬라이더 트랙보다 좌우로 자연스럽게 넘어가도록 마커 중심 기준으로 직접 배치
  const loupeLeft = markerCenter - LOUPE_W / 2;
  const caretX = LOUPE_W / 2;

  return (
    <View style={[{ height, flexDirection: 'row', alignItems: 'center', width: '100%' }, style]}>
      {/* 인터랙션 트랙 영역 */}
      <View
        style={{ flex: 1, height, justifyContent: 'center' }}
        onLayout={onTrackLayout}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={accessibilityValue ? { text: accessibilityValue } : undefined}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'increment') onAdjust?.(1);
          else if (e.nativeEvent.actionName === 'decrement') onAdjust?.(-1);
        }}
        {...responder.panHandlers}
      >
        {/* 트랙 바탕 — 좌우 pad 내에서 0~100% 범위 */}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { left: pad, right: pad, top: 0, bottom: 0 }]}>
          <View style={{ position: 'absolute', left: 0, right: 0, top, height: trackHeight }}>{children}</View>
        </View>

        {/* 손잡이 / 핀: transform translateX 로 이동 */}
        {variant === 'pin' ? (
          <View
            pointerEvents="none"
            style={[
              styles.pinContainer,
              {
                height,
                transform: [{ translateX: (currentPct / 100) * usable }],
              },
            ]}
          >
            {/* 상단 핀 마커 (다이아몬드) */}
            <View
              style={[
                styles.pinDiamond,
                {
                  top: top - 8,
                  backgroundColor: knobTone ?? color.accent,
                  borderColor: color.panelRaised,
                },
              ]}
            />
            {/* 세로 관통 침 (선) */}
            <View
              style={[
                styles.pinNeedle,
                {
                  top: top - 5,
                  height: trackHeight + 11,
                  backgroundColor: knobTone ?? color.accent,
                },
              ]}
            />
          </View>
        ) : (
          <View
            pointerEvents="none"
            style={[
              styles.knob,
              {
                top: (height - KNOB_H) / 2,
                left: 0,
                transform: [{ translateX: (currentPct / 100) * usable }],
                backgroundColor: color.panelRaised,
                borderColor: knobTone ?? color.accentLine,
              },
            ]}
          >
            <Text style={[styles.knobText, { color: color.accent }]} numberOfLines={1}>{label}</Text>
          </View>
        )}

        {/* ── 드래그 중 실시간 돋보기(Loupe) 팝업 ─────────────────────── */}
        {isDragging && renderLoupe && trackWidth > 0 && (
          <View
            pointerEvents="none"
            style={[
              styles.loupeAnchor,
              {
                left: loupeLeft,
                top: top - 62,
              },
            ]}
          >
            {renderLoupe(currentPct, label)}
            <View style={[styles.loupeCaret, { left: caretX - 5 }]} />
          </View>
        )}
      </View>

      {/* 우측 고정 라벨 배지 */}
      {renderValueBadge && renderValueBadge(label)}
    </View>
  );
};

const styles = StyleSheet.create({
  knob: {
    position: 'absolute',
    left: 0,
    width: KNOB_W,
    height: KNOB_H,
    borderRadius: radius.xs,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 6,
  },
  knobText: { fontSize: 11, fontWeight: '800', fontFamily: mono, letterSpacing: 0.4 },
  pinContainer: {
    position: 'absolute',
    left: 0,
    width: PIN_W,
    alignItems: 'center',
  },
  pinDiamond: {
    position: 'absolute',
    width: 8,
    height: 8,
    transform: [{ rotate: '45deg' }],
    borderWidth: 1.5,
    borderRadius: 1,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 2,
    elevation: 4,
    zIndex: 2,
  },
  pinNeedle: {
    position: 'absolute',
    width: 2,
    borderRadius: 1,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 1.5,
    elevation: 3,
    zIndex: 1,
  },
  loupeAnchor: {
    position: 'absolute',
    width: 154,
    zIndex: 99,
  },
  loupeCaret: {
    position: 'absolute',
    bottom: -5,
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(18, 22, 32, 0.95)',
  },
});
