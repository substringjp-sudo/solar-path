/**
 * TimeRuler.tsx — 시간 자(목업 "4차 b"). 상자 없이 눈금만, 가운데 파란 핀은 고정이고 눈금이 손가락을 따라 움직입니다.
 * 계산은 `utils/timeRuler.ts`(판정 verify-time-ruler.js). 왼쪽 날짜 단추 · 가운데 시각 숫자 · 오른쪽 "지금" 단추는 유리 알약/막 위 큰 글자(글자 대비는 glassTokens 판정).
 *
 * 시각은 바깥이 쥡니다(`timeMs`). 끄는 동안 `onChange` 로 계속 알리고, 놓을 때 `onCommit` 으로 한 번 더 알립니다(무거운 계산은 commit 에서).
 * 스크린리더: adjustable — 증가 · 감소로 15분씩.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Sun } from 'lucide-react-native';
import { color as DARK, mono } from '../../theme/tokens';
import { TEXT } from '../../theme/glassTokens';
import { dateLabel, dragTimeMs, daySwipeSteps, markerX, PX_PER_HOUR, rulerBand, rulerFade, rulerTicks, RULER_WIDTH, timeText, type ScoreSample } from '../../utils/timeRuler';
import { L3 } from '../../utils/i18n';
import { GlassChip } from './GlassChip';
import { glassTextShadow } from './GlassSurface';
import { isRecentDrag, markDragEnd } from './dragGuard';

type Lang = 'ko' | 'en' | 'ja';

interface Props {
  timeMs: number;
  tz: number;
  nowMs: number;
  language: Lang;
  onChange: (ms: number) => void;
  onCommit?: (ms: number) => void;
  /** 끌기를 시작할 때(바깥이 "시각을 끄는 중" 표시를 켤 때). */
  onDragStart?: () => void;
  /** 자 위에 뜨는 일몰 표시(없으면 안 그림) */
  sunsetMs?: number | null;
  sunsetLabel?: string;
  /** 시간대별 점수 표본(없으면 띠를 안 그림). 높을수록 진한 주황 띠가 자 위에 깔립니다. */
  scoreSamples?: readonly ScoreSample[] | null;
  /** 날짜 단추 글을 직접 정할 때(칩 줄에 어제 · 오늘 · 내일이 이미 있으면 날짜 자체를 보여 같은 것이 두 번 안 보이게). 없으면 오늘 · 어제 · 내일 글. */
  dateText?: string;
  onDatePress?: () => void;
  /** 날짜 단추를 위아래로 밀었을 때 옮길 날 수(위로 + · 아래로 −, 20 px 마다 하루). 없으면 밀기를 받지 않음. */
  onDayShift?: (days: number) => void;
  /** 현재 시각/위치와 다를 때만 "지금" 단추를 보임. */
  showNow?: boolean;
  onNow?: () => void;
  /** 슬라이더 우측 상단의 작은 태양 따라가기 아이콘 버튼 */
  sunTracked?: boolean;
  onToggleTrackSun?: () => void;
}

const RULER_COMPACT_H = 22;
const RULER_H = 56;
const DAY_STEP_PX = 20;
const DAY_ROW_H = 16;
const DAY_MS = 24 * 3_600_000;
const STEP_MS = 15 * 60_000;
const TICK_H = { hour: 16, half: 10, quarter: 6 } as const;
const TICK_A = { hour: 0.95, half: 0.7, quarter: 0.4 } as const;

export const TimeRuler: React.FC<Props> = ({ timeMs, tz, nowMs, language, onChange, onCommit, onDragStart, sunsetMs = null, sunsetLabel, scoreSamples = null, dateText, onDatePress, onDayShift, showNow = true, onNow, sunTracked = false, onToggleTrackSun }) => {
  const [width, setWidth] = useState(RULER_WIDTH);
  const [rulerActive, setRulerActive] = useState(false);
  const [dayDragY, setDayDragY] = useState(0);
  const rulerAnim = useRef(new Animated.Value(0)).current;
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef(timeMs);
  const lastRef = useRef(timeMs);
  const propsRef = useRef({ timeMs, onChange, onCommit, onDragStart });
  propsRef.current = { timeMs, onChange, onCommit, onDragStart };

  const setRulerOpen = useCallback((open: boolean) => {
    if (collapseTimer.current) { clearTimeout(collapseTimer.current); collapseTimer.current = null; }
    if (open) {
      setRulerActive(true);
      Animated.timing(rulerAnim, { toValue: 1, duration: 150, useNativeDriver: false }).start();
    } else {
      collapseTimer.current = setTimeout(() => {
        Animated.timing(rulerAnim, { toValue: 0, duration: 220, useNativeDriver: false }).start(({ finished }) => {
          if (finished) setRulerActive(false);
        });
      }, 280);
    }
  }, [rulerAnim]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      startRef.current = propsRef.current.timeMs;
      lastRef.current = startRef.current;
      setRulerOpen(true);
      propsRef.current.onDragStart?.();
    },
    onPanResponderMove: (_, g) => {
      const ms = dragTimeMs(startRef.current, g.dx);
      if (ms !== lastRef.current) { lastRef.current = ms; propsRef.current.onChange(ms); }
    },
    onPanResponderRelease: () => {
      markDragEnd();
      propsRef.current.onCommit?.(lastRef.current);
      setRulerOpen(false);
    },
    onPanResponderTerminate: () => {
      markDragEnd();
      propsRef.current.onCommit?.(lastRef.current);
      setRulerOpen(false);
    },
  }), [setRulerOpen]);

  const dayRef = useRef(onDayShift);
  dayRef.current = onDayShift;
  const dayPan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => !!dayRef.current && Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => { setDayDragY(g.dy); },
    onPanResponderRelease: (_, g) => {
      markDragEnd();
      setDayDragY(0);
      const n = daySwipeSteps(g.dy);
      if (n !== 0) dayRef.current?.(n);
    },
    onPanResponderTerminate: () => { markDragEnd(); setDayDragY(0); },
  }), []);

  const ticks = rulerTicks(timeMs, tz, width, PX_PER_HOUR);
  const mx = sunsetMs == null ? null : markerX(timeMs, sunsetMs, width, PX_PER_HOUR);
  const step = useCallback((dir: 1 | -1) => { const ms = timeMs + dir * STEP_MS; onChange(ms); onCommit?.(ms); }, [timeMs, onChange, onCommit]);
  const text = timeText(timeMs, tz);
  const band = scoreSamples ? rulerBand(scoreSamples, timeMs, width, PX_PER_HOUR) : [];

  // 세로 날짜 휠: 드래그 거리에 맞춰 위아래 날짜가 부드럽게 오르내림
  const liveDays = daySwipeSteps(dayDragY);
  const previewCenterMs = timeMs + liveDays * DAY_MS;
  const wheelOffsetY = dayDragY + liveDays * DAY_STEP_PX;
  const prevDayText = dateLabel(previewCenterMs - DAY_MS, nowMs, tz, language);
  const currDayText = liveDays === 0 && dateText ? dateText : dateLabel(previewCenterMs, nowMs, tz, language);
  const nextDayText = dateLabel(previewCenterMs + DAY_MS, nowMs, tz, language);

  const trackH = rulerAnim.interpolate({ inputRange: [0, 1], outputRange: [RULER_COMPACT_H, RULER_H] });
  const tickScaleY = rulerActive ? 1 : 0.45;

  return (
    <View style={styles.wrap} onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width) || RULER_WIDTH)}>
      <View style={styles.top}>
        <View testID="ruler-date-swipe" {...dayPan.panHandlers} style={styles.dateWheelWrap}>
          <Pressable
            testID="ruler-date"
            onPress={() => { if (!isRecentDrag()) onDatePress?.(); }}
            accessibilityRole="button"
            accessibilityLabel={L3(language, '날짜 고르기, 위아래로 밀어 바꾸기', 'Pick date, swipe vertically to change', '日付を選ぶ、上下にスワイプして変更')}
            style={styles.dateWheelBtn}
          >
            <View style={styles.dateTicksCol} pointerEvents="none">
              <View style={styles.dateTickSmall} />
              <View style={styles.dateTickCenter} />
              <View style={styles.dateTickSmall} />
            </View>
            <View style={styles.dateWheelWindow} pointerEvents="none">
              <View style={{ transform: [{ translateY: wheelOffsetY }] }}>
                <Text numberOfLines={1} style={[styles.dateAdjacent, glassTextShadow]}>{prevDayText}</Text>
                <Text numberOfLines={1} style={[styles.dateCurrent, glassTextShadow]}>{currDayText}</Text>
                <Text numberOfLines={1} style={[styles.dateAdjacent, glassTextShadow]}>{nextDayText}</Text>
              </View>
            </View>
          </Pressable>
        </View>

        <View pointerEvents="none" style={styles.digitsCenter}>
          <Text testID="ruler-digits" style={[styles.digits, glassTextShadow]}>{text}</Text>
        </View>

        <View style={styles.nowWrap}>
          {showNow && onNow ? (
            <GlassChip testID="ruler-now" label={L3(language, '지금', 'Now', '今')} onPress={onNow} />
          ) : null}
          {onToggleTrackSun ? (
            <GlassChip
              testID="ruler-track-sun"
              label=""
              active={sunTracked}
              icon={<Sun size={14} color={sunTracked ? DARK.sun : TEXT} />}
              onPress={onToggleTrackSun}
              accessibilityLabel={L3(language, '태양 따라가기', 'Track the sun', '太陽を追う')}
              style={styles.sunBtn}
            />
          ) : null}
        </View>
      </View>

      <Animated.View
        testID="ruler-track"
        {...pan.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={L3(language, '시각, 좌우로 끌어 바꾸기', 'Time, drag sideways to change', '時刻、左右にドラッグして変更')}
        accessibilityValue={{ text }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
        style={[styles.track, { height: trackH }]}
      >
        {band.map((b, i) => (
          <View key={`b${i}`} testID="ruler-band" pointerEvents="none" style={[styles.band, { bottom: rulerActive ? 38 : 14, left: b.x0, width: b.x1 - b.x0, opacity: b.alpha * rulerFade((b.x0 + b.x1) / 2, width).opacity }]} />
        ))}
        {ticks.map(t => {
          const f = rulerFade(t.x, width);
          return <View key={t.ms} pointerEvents="none" style={[styles.tick, { bottom: rulerActive ? 18 : 4, left: t.x - 1, height: TICK_H[t.kind] * f.scale * tickScaleY, backgroundColor: `rgba(241,245,249,${TICK_A[t.kind] * f.opacity * (rulerActive ? 1 : 0.65)})` }]} />;
        })}
        {rulerActive && ticks.filter(t => t.label).map(t => {
          const f = rulerFade(t.x, width);
          return <Text key={`l${t.ms}`} pointerEvents="none" style={[styles.tickLabel, { left: t.x - 20, opacity: f.opacity, transform: [{ scale: f.scale }] }, glassTextShadow]}>{t.label}</Text>;
        })}
        {mx !== null ? <View pointerEvents="none" style={[styles.sunset, { bottom: rulerActive ? 34 : 11, left: mx - 4, opacity: rulerFade(mx, width).opacity }]} /> : null}
        {rulerActive && mx !== null && sunsetLabel ? <Text pointerEvents="none" style={[styles.sunsetLabel, { left: mx + 8 }, glassTextShadow]}>{sunsetLabel}</Text> : null}
        <View pointerEvents="none" style={[styles.pin, { bottom: rulerActive ? 16 : 3, left: width / 2 - 1.5 }]} />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  top: { position: 'relative', flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: 16, marginBottom: 2 },
  dateWheelWrap: { zIndex: 2 },
  dateWheelBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, paddingRight: 8 },
  dateTicksCol: { width: 8, height: 24, justifyContent: 'space-between', alignItems: 'flex-start' },
  dateTickSmall: { width: 4, height: 1, backgroundColor: 'rgba(241,245,249,0.45)', borderRadius: 1 },
  dateTickCenter: { width: 8, height: 1.5, backgroundColor: DARK.accent, borderRadius: 1 },
  dateWheelWindow: { height: DAY_ROW_H * 2.4, overflow: 'hidden', justifyContent: 'center', minWidth: 68 },
  dateAdjacent: { height: DAY_ROW_H, lineHeight: DAY_ROW_H, fontSize: 9.5, fontWeight: '400', color: 'rgba(241,245,249,0.42)' },
  dateCurrent: { height: DAY_ROW_H, lineHeight: DAY_ROW_H, fontSize: 11.5, fontWeight: '500', color: TEXT },
  digitsCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  digits: { fontFamily: mono, fontSize: 16, fontWeight: '500', color: TEXT, letterSpacing: 0.4 },
  nowWrap: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6, zIndex: 2 },
  sunBtn: { width: 28, minHeight: 28, borderRadius: 14, paddingHorizontal: 0 },
  track: { overflow: 'hidden' },
  tick: { position: 'absolute', width: 1.5, borderRadius: 1 },
  tickLabel: { position: 'absolute', bottom: 0, width: 40, textAlign: 'center', fontFamily: mono, fontSize: 9.5, fontWeight: '400', color: TEXT },
  band: { position: 'absolute', height: 3, borderRadius: 2, backgroundColor: DARK.glow },
  pin: { position: 'absolute', top: 2, width: 2.5, borderRadius: 2, backgroundColor: DARK.accent },
  sunset: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: DARK.sun },
  sunsetLabel: { position: 'absolute', top: 0, fontSize: 9.5, fontWeight: '500', color: TEXT },
});
