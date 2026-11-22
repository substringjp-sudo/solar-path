/**
 * BottomDock.tsx — 시뮬레이션 · 샌드박스 · 사진 · 천체 · 타임랩스가 함께 쓰는 단일 하단 컨트롤러.
 *
 * 구조(위에서 아래로 모든 모드 100% 동일한 높이 · 모양):
 *  1. 손잡이 줄 (`DockSheet` handle) + 펼침 시트 (`expanded`)
 *  2. 1줄 칩 슬롯 (`chips-row`, 높이 28px 고정 — 배율 다이얼 + 칩들)
 *  3. 시간 자 (`TimeRuler` — 왼쪽 날짜 휠 `dateShort` · 가운데 시각 `HH:mm` · 오른쪽 `지금`)
 *  4. 셔터 줄 (`shutter-row` — 왼쪽 48×48 원형 유리 버튼 · 가운데 78×78 아이콘 셔터 또는 조이스틱 · 오른쪽 48×48 원형 유리 버튼)
 *  5. 모드 줄 (`ModeStrip` — 데이터 · 시뮬레이션 · 샌드박스 · 사진 · 천체 · 타임랩스)
 */
import React from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { DockSheet } from './DockSheet';
import { CHIP_MIN_H, GlassChip } from './GlassChip';
import { getLastModeSlideDir, ModeStrip } from './ModeStrip';
import { TimeRuler } from './TimeRuler';
import { ZoomDialPill } from './ZoomDialPill';
import { color as DARK } from '../../theme/tokens';
import type { DockStage } from '../../utils/dockStages';
import type { AppMode } from '../../utils/modeStrip';
import { dateShort, dayOffset, shiftDays, type ScoreSample } from '../../utils/timeRuler';
import type { Language } from '../../utils/i18n';

export interface BottomDockChip {
  id: string;
  testID?: string;
  label: string;
  icon?: React.ReactNode;
  mono?: boolean;
  active?: boolean;
  expanded?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
}

export interface BottomDockRulerProps {
  timeMs: number;
  tz: number;
  nowMs: number;
  onDragStart?: () => void;
  onChange: (ms: number) => void;
  onCommit?: (ms: number) => void;
  onDayShift?: (nextMs: number) => void;
  onDatePress?: () => void;
  sunsetMs?: number | null;
  sunsetLabel?: string;
  scoreSamples?: readonly ScoreSample[] | null;
  showNow?: boolean;
  onNow?: () => void;
}

export interface BottomDockSideAction {
  testID?: string;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
  onPress?: () => void;
}

export interface BottomDockProps {
  language: Language;
  stage: DockStage;
  onStageChange: (s: DockStage) => void;
  expanded?: React.ReactNode | ((maxH: number) => React.ReactNode);
  midMaxH?: number;
  fitContent?: boolean;
  screenH?: number;
  onDockHeight?: (h: number) => void;
  /** 1줄 칩 왼쪽에 놓을 배율 슬라이더(카메라 모드) */
  zoomDial?: {
    magnification: number;
    onChange: (mag: number) => void;
  } | null;
  /** 1줄 칩 목록(모든 모드에서 1줄 유지) */
  chips: readonly BottomDockChip[];
  /** 시간 자(모든 하늘/카메라 모드에서 동일한 모양으로 표시) */
  ruler: BottomDockRulerProps;
  /** 셔터 줄 왼쪽 48×48 원형 유리 버튼 */
  leftAction: BottomDockSideAction;
  /** 셔터 줄 오른쪽 48×48 원형 유리 버튼 */
  rightAction: BottomDockSideAction;
  shutterLabel: string;
  shutterInner: React.ReactNode;
  shutterColor?: string;
  shutterBusy?: boolean;
  onShutter: () => void;
  stripMode: AppMode;
  stripModes: readonly AppMode[];
  onPickMode: (m: AppMode) => void;
}

let lastDockSnapshot: {
  mode: AppMode;
  chipsNode: React.ReactNode;
  shutterNode: React.ReactNode;
  shutterBg: string;
} | null = null;

export const BottomDock: React.FC<BottomDockProps> = ({
  language,
  stage,
  onStageChange,
  expanded,
  midMaxH,
  fitContent = true,
  screenH,
  onDockHeight,
  zoomDial = null,
  chips,
  ruler,
  leftAction,
  rightAction,
  shutterLabel,
  shutterInner,
  shutterColor,
  shutterBusy = false,
  onShutter,
  stripMode,
  stripModes,
  onPickMode,
}) => {
  const SHUTTER_SLIDE_PX = 76;
  const [chipsW, setChipsW] = React.useState(360);
  const slideAnim = React.useRef(new Animated.Value(0)).current;
  const curShutterBg = shutterColor ?? DARK.accent;
  const chipsContent = (
    <>
      {zoomDial ? (
        <ZoomDialPill
          magnification={zoomDial.magnification}
          onChange={zoomDial.onChange}
          language={language}
        />
      ) : null}
      {chips.map(c => (
        <GlassChip
          key={c.id}
          testID={c.testID ?? `chip-${c.id}`}
          label={c.label}
          icon={c.icon}
          mono={c.mono}
          active={c.active}
          expanded={c.expanded}
          accessibilityLabel={c.accessibilityLabel}
          onPress={c.onPress}
        />
      ))}
    </>
  );

  const [slideState, setSlideState] = React.useState<{
    dir: -1 | 1;
    prevChips: React.ReactNode;
    prevShutter: React.ReactNode;
    prevShutterBg: string;
  } | null>(null);
  const latestRef = React.useRef({ mode: stripMode, chipsContent, shutterInner, shutterBg: curShutterBg });
  latestRef.current = { mode: stripMode, chipsContent, shutterInner, shutterBg: curShutterBg };

  React.useEffect(() => {
    const prev = lastDockSnapshot;
    const cur = latestRef.current;
    if (prev && prev.mode !== stripMode) {
      const prevIdx = stripModes.indexOf(prev.mode);
      const curIdx = stripModes.indexOf(stripMode);
      const dir: -1 | 0 | 1 =
        prevIdx >= 0 && curIdx >= 0 && prevIdx !== curIdx
          ? (curIdx > prevIdx ? 1 : -1)
          : getLastModeSlideDir();
      if (dir !== 0) {
        setSlideState({
          dir,
          prevChips: prev.chipsNode,
          prevShutter: prev.shutterNode,
          prevShutterBg: prev.shutterBg,
        });
        slideAnim.setValue(0);
        Animated.timing(slideAnim, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) setSlideState(null);
        });
      }
    }
    lastDockSnapshot = {
      mode: cur.mode,
      chipsNode: cur.chipsContent,
      shutterNode: cur.shutterInner,
      shutterBg: cur.shutterBg,
    };
  }, [stripMode, stripModes, slideAnim]);

  if (lastDockSnapshot && lastDockSnapshot.mode === stripMode) {
    lastDockSnapshot = {
      mode: stripMode,
      chipsNode: chipsContent,
      shutterNode: shutterInner,
      shutterBg: curShutterBg,
    };
  }

  const off = dayOffset(ruler.timeMs, ruler.nowMs, ruler.tz);
  const handleDayShift = (deltaDays: number) => {
    const nextMs = shiftDays(ruler.timeMs, deltaDays);
    if (ruler.onDayShift) {
      ruler.onDayShift(nextMs);
    } else {
      ruler.onDragStart?.();
      ruler.onChange(nextMs);
      ruler.onCommit?.(nextMs);
    }
  };

  return (
    <DockSheet
      stage={stage}
      onStageChange={onStageChange}
      language={language}
      expanded={expanded}
      midMaxH={midMaxH}
      fitContent={fitContent}
      screenH={screenH}
      onFixedHeight={onDockHeight}
    >
      <View
        testID="chips-row"
        style={styles.chipsRow}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (w > 0 && Math.abs(w - chipsW) > 4) setChipsW(w);
        }}
      >
        {slideState ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.chipsSlideSlot,
              styles.chipsRowInner,
              {
                transform: [{
                  translateX: slideAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -slideState.dir * chipsW],
                  }),
                }],
                opacity: slideAnim.interpolate({
                  inputRange: [0, 0.75, 1],
                  outputRange: [1, 0.2, 0],
                }),
              },
            ]}
          >
            {slideState.prevChips}
          </Animated.View>
        ) : null}
        <Animated.View
          style={[
            styles.chipsRowInner,
            slideState
              ? {
                  transform: [{
                    translateX: slideAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [slideState.dir * chipsW, 0],
                    }),
                  }],
                  opacity: slideAnim.interpolate({
                    inputRange: [0, 0.25, 1],
                    outputRange: [0, 0.85, 1],
                  }),
                }
              : null,
          ]}
        >
          {chipsContent}
        </Animated.View>
      </View>

      <TimeRuler
        timeMs={ruler.timeMs}
        tz={ruler.tz}
        nowMs={ruler.nowMs}
        language={language}
        onDragStart={ruler.onDragStart}
        onChange={ruler.onChange}
        onCommit={ruler.onCommit}
        sunsetMs={ruler.sunsetMs}
        sunsetLabel={ruler.sunsetLabel}
        scoreSamples={ruler.scoreSamples}
        dateText={dateShort(ruler.timeMs, ruler.tz, language)}
        onDatePress={ruler.onDatePress}
        onDayShift={(n) => {
          void off;
          handleDayShift(n);
        }}
        showNow={ruler.showNow}
        onNow={ruler.onNow}
      />

      <View testID="shutter-row" style={styles.shutterRow}>
        <View style={[styles.sideWrap, leftAction.disabled && styles.disabled]}>
          <GlassChip
            testID={leftAction.testID}
            label=""
            active={leftAction.active}
            icon={leftAction.icon}
            accessibilityLabel={leftAction.accessibilityLabel}
            onPress={leftAction.disabled ? undefined : leftAction.onPress}
            style={styles.round48}
          />
        </View>

        <Pressable
          testID="shutter"
          accessibilityRole="button"
          accessibilityLabel={shutterLabel}
          disabled={shutterBusy}
          onPress={onShutter}
          style={[styles.shutterRing, shutterBusy && styles.disabled]}
        >
          <View style={styles.shutterClip}>
            {slideState ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.shutterInner,
                  styles.shutterCircleAbs,
                  { backgroundColor: slideState.prevShutterBg },
                  {
                    transform: [{
                      translateX: slideAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -slideState.dir * SHUTTER_SLIDE_PX],
                      }),
                    }],
                  },
                ]}
              >
                {slideState.prevShutter}
              </Animated.View>
            ) : null}
            <Animated.View
              style={[
                styles.shutterInner,
                { backgroundColor: curShutterBg },
                slideState
                  ? {
                      transform: [{
                        translateX: slideAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [slideState.dir * SHUTTER_SLIDE_PX, 0],
                        }),
                      }],
                    }
                  : null,
              ]}
            >
              {shutterInner}
            </Animated.View>
          </View>
        </Pressable>

        <View style={[styles.sideWrap, rightAction.disabled && styles.disabled]}>
          <GlassChip
            testID={rightAction.testID}
            label=""
            active={rightAction.active}
            icon={rightAction.icon}
            accessibilityLabel={rightAction.accessibilityLabel}
            onPress={rightAction.disabled ? undefined : rightAction.onPress}
            style={styles.round48}
          />
        </View>
      </View>

      <ModeStrip mode={stripMode} modes={stripModes} language={language} onPick={onPickMode} />
    </DockSheet>
  );
};

const styles = StyleSheet.create({
  chipsRow: {
    minHeight: CHIP_MIN_H,
    position: 'relative',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  chipsRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'nowrap',
    gap: 6,
    paddingHorizontal: 10,
  },
  chipsSlideSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
  },
  sideWrap: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  round48: {
    width: 48,
    minHeight: 48,
    borderRadius: 24,
    paddingHorizontal: 0,
  },
  shutterRing: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  shutterClip: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: DARK.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterCircleAbs: {
    position: 'absolute',
  },
  disabled: {
    opacity: 0.45,
  },
});
