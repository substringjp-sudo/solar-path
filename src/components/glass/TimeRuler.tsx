/**
 * TimeRuler.tsx — 시간 자(목업 "4차 b"). 상자 없이 눈금만, 가운데 파란 핀은 고정이고 눈금이 손가락을 따라 움직입니다.
 * 계산은 `utils/timeRuler.ts`(판정 verify-time-ruler.js). 왼쪽 날짜 단추 · 가운데 시각 숫자 · 오른쪽 "지금" 단추는 유리 알약/막 위 큰 글자(글자 대비는 glassTokens 판정).
 *
 * 성능 최적화(2026-11-22):
 * - 터치 순간 JS 스레드 레이아웃 재계산을 유발하던 `height: trackH` (`useNativeDriver: false`) 애니메이션을 제거했습니다.
 *   트랙 컨테이너 높이를 고정하고 눈금 스케일/투명도 전환으로 반응해 터치 시작 시 프레임 드랍이 발생하지 않습니다.
 * - 눈금(`rulerTicks`)과 노을 점수 띠(`rulerBand`) 계산을 `useMemo`로 감싸 불필요한 배열 재할당을 줄였습니다.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Sun } from 'lucide-react-native';
import { color as DARK, mono } from '../../theme/tokens';
import { TEXT } from '../../theme/glassTokens';
import { dateLabel, dragTimeMs, daySwipeSteps, markerX, PX_PER_HOUR, rulerBand, rulerFade, rulerTicks, RULER_WIDTH, timeText, type ScoreSample } from '../../utils/timeRuler';
import { L3 } from '../../utils/i18n';
import { GlassChip } from './GlassChip';
import { glassTextShadow } from './GlassSurface';
import { isRecentDrag, markDragEnd } from './dragGuard';
import { emitScrubTime } from '../../utils/liveClock';

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
  /** 세로 날짜 휠 드래그 시작/드래그 중 미리보기/손 뗌 커밋(ms). */
  onDayDragStart?: () => void;
  onDayPreview?: (ms: number) => void;
  onDayCommit?: (ms: number) => void;
  /** 현재 시각/위치와 다를 때만 "지금" 단추를 보임. */
  showNow?: boolean;
  onNow?: () => void;
  /** '지금' 실시간 추종 여부(true면 매초 시각·눈금을 자동 진행) */
  live?: boolean;
  /** 슬라이더 우측 상단의 작은 태양 따라가기 아이콘 버튼 */
  sunTracked?: boolean;
  onToggleTrackSun?: () => void;
}

const RULER_TRACK_H = 38;
const DAY_STEP_PX = 20;
const DAY_ROW_H = 16;
const DAY_MS = 24 * 3_600_000;
const STEP_MS = 15 * 60_000;
const TICK_H = { hour: 16, half: 10, quarter: 6 } as const;
const TICK_A = { hour: 0.95, half: 0.7, quarter: 0.4 } as const;

export const TimeRuler: React.FC<Props> = React.memo(({ timeMs, tz, nowMs, language, onChange, onCommit, onDragStart, sunsetMs = null, sunsetLabel, scoreSamples = null, dateText, onDatePress, onDayShift, onDayDragStart, onDayPreview, onDayCommit, showNow = true, onNow, live = false, sunTracked = false, onToggleTrackSun }) => {
  const [width, setWidth] = useState(RULER_WIDTH);
  const [rulerActive, setRulerActive] = useState(false);
  const [dayDragY, setDayDragY] = useState(0);
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const [liveNowMs, setLiveNowMs] = useState<number>(() => Date.now());
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef(timeMs);
  const lastRef = useRef(timeMs);
  const lastEmitTsRef = useRef(0);
  const dayStartMsRef = useRef<number | null>(null);
  const lastDayStepRef = useRef(0);
  const propsRef = useRef({ timeMs, live, onChange, onCommit, onDragStart, onDayDragStart, onDayPreview, onDayCommit });
  propsRef.current = { timeMs, live, onChange, onCommit, onDragStart, onDayDragStart, onDayPreview, onDayCommit };

  useEffect(() => () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
  }, []);

  // '지금' 실시간 추종 중일 때는 전체 화면을 리렌더하지 않고 TimeRuler 내부에서만 매초 시각과 눈금을 진행합니다.
  useEffect(() => {
    if (!live || scrubMs !== null || dayDragY !== 0) return;
    setLiveNowMs(Date.now());
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const now = Date.now();
      const delay = 1000 - (now % 1000) + 16;
      timer = setTimeout(() => {
        setLiveNowMs(Date.now());
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [live, scrubMs, dayDragY]);

  const setRulerOpen = useCallback((open: boolean) => {
    if (collapseTimer.current) { clearTimeout(collapseTimer.current); collapseTimer.current = null; }
    if (open) {
      setRulerActive(true);
    } else {
      collapseTimer.current = setTimeout(() => {
        setRulerActive(false);
      }, 240);
    }
  }, []);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      startRef.current = propsRef.current.live ? Date.now() : propsRef.current.timeMs;
      lastRef.current = startRef.current;
      setRulerOpen(true);
      propsRef.current.onDragStart?.();
    },
    onPanResponderMove: (_, g) => {
      const ms = dragTimeMs(startRef.current, g.dx);
      if (ms !== lastRef.current) {
        lastRef.current = ms;
        setScrubMs(ms);
        emitScrubTime(ms);
        const now = Date.now();
        if (now - lastEmitTsRef.current >= 40) {
          lastEmitTsRef.current = now;
          propsRef.current.onChange(ms);
        }
      }
    },
    onPanResponderRelease: () => {
      markDragEnd();
      setScrubMs(null);
      propsRef.current.onChange(lastRef.current);
      propsRef.current.onCommit?.(lastRef.current);
      setRulerOpen(false);
    },
    onPanResponderTerminate: () => {
      markDragEnd();
      setScrubMs(null);
      propsRef.current.onChange(lastRef.current);
      propsRef.current.onCommit?.(lastRef.current);
      setRulerOpen(false);
    },
  }), [setRulerOpen]);

  const dayRef = useRef(onDayShift);
  dayRef.current = onDayShift;
  const dayPan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => (!!dayRef.current || !!propsRef.current.onDayPreview) && Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      dayStartMsRef.current = propsRef.current.live ? Date.now() : propsRef.current.timeMs;
      lastDayStepRef.current = 0;
      propsRef.current.onDayDragStart?.();
    },
    onPanResponderMove: (_, g) => {
      setDayDragY(g.dy);
      const step = daySwipeSteps(g.dy);
      if (step !== lastDayStepRef.current) {
        lastDayStepRef.current = step;
        const base = dayStartMsRef.current ?? propsRef.current.timeMs;
        const nextMs = base + step * DAY_MS;
        emitScrubTime(nextMs);
        propsRef.current.onDayPreview?.(nextMs);
      }
    },
    onPanResponderRelease: (_, g) => {
      markDragEnd();
      const base = dayStartMsRef.current;
      dayStartMsRef.current = null;
      setDayDragY(0);
      const n = daySwipeSteps(g.dy);
      if (base != null && propsRef.current.onDayCommit) {
        const finalMs = base + n * DAY_MS;
        propsRef.current.onDayPreview?.(finalMs);
        propsRef.current.onDayCommit(finalMs);
      } else if (n !== 0) {
        dayRef.current?.(n);
      }
    },
    onPanResponderTerminate: (_, g) => {
      markDragEnd();
      const base = dayStartMsRef.current;
      dayStartMsRef.current = null;
      setDayDragY(0);
      const n = daySwipeSteps(g.dy);
      if (base != null && propsRef.current.onDayCommit) {
        propsRef.current.onDayCommit(base + n * DAY_MS);
      }
    },
  }), []);

  const isLiveTicking = live && scrubMs === null;
  const displayMs = scrubMs ?? (live ? liveNowMs : timeMs);
  // 드래그·고정 시각에서는 1분 버킷으로 메모이제이션하고, 실시간 모드에서는 매초 눈금·마커가 부드럽게 흐르게 합니다.
  const trackCenterMs = isLiveTicking ? displayMs : Math.round(displayMs / 60_000) * 60_000;
  const ticks = useMemo(() => rulerTicks(trackCenterMs, tz, width, PX_PER_HOUR), [trackCenterMs, tz, width]);
  const mx = useMemo(() => (sunsetMs == null ? null : markerX(trackCenterMs, sunsetMs, width, PX_PER_HOUR)), [trackCenterMs, sunsetMs, width]);
  const band = useMemo(() => (scoreSamples ? rulerBand(scoreSamples, trackCenterMs, width, PX_PER_HOUR) : []), [scoreSamples, trackCenterMs, width]);
  const step = useCallback((dir: 1 | -1) => { const ms = timeMs + dir * STEP_MS; onChange(ms); onCommit?.(ms); }, [timeMs, onChange, onCommit]);
  const text = timeText(displayMs, tz, isLiveTicking);

  // 세로 날짜 휠: 드래그 거리에 맞춰 위아래 날짜가 부드럽게 오르내림
  const effectiveNowMs = isLiveTicking ? displayMs : nowMs;
  const liveDays = daySwipeSteps(dayDragY);
  const previewCenterMs = (dayStartMsRef.current ?? displayMs) + liveDays * DAY_MS;
  const wheelOffsetY = dayDragY + liveDays * DAY_STEP_PX;
  const prevDayText = dateLabel(previewCenterMs - DAY_MS, effectiveNowMs, tz, language);
  const currDayText = liveDays === 0 && dateText ? dateText : dateLabel(previewCenterMs, effectiveNowMs, tz, language);
  const nextDayText = dateLabel(previewCenterMs + DAY_MS, effectiveNowMs, tz, language);

  const tickScaleY = rulerActive ? 1 : 0.6;
  const tickBottom = rulerActive ? 14 : 6;

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

      <View
        testID="ruler-track"
        {...pan.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={L3(language, '시각, 좌우로 끌어 바꾸기', 'Time, drag sideways to change', '時刻、左右にドラッグして変更')}
        accessibilityValue={{ text }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
        style={styles.track}
      >
        {band.map((b, i) => (
          <View key={`b${i}`} testID="ruler-band" pointerEvents="none" style={[styles.band, { bottom: rulerActive ? 31 : 21, left: b.x0, width: b.x1 - b.x0, opacity: b.alpha * rulerFade((b.x0 + b.x1) / 2, width).opacity }]} />
        ))}
        {ticks.map(t => {
          const f = rulerFade(t.x, width);
          return <View key={t.ms} pointerEvents="none" style={[styles.tick, { bottom: tickBottom, left: t.x - 1, height: TICK_H[t.kind] * f.scale * tickScaleY, backgroundColor: `rgba(241,245,249,${TICK_A[t.kind] * f.opacity * (rulerActive ? 1 : 0.72)})` }]} />;
        })}
        {rulerActive && ticks.filter(t => t.label).map(t => {
          const f = rulerFade(t.x, width);
          return <Text key={`l${t.ms}`} pointerEvents="none" style={[styles.tickLabel, { left: t.x - 20, opacity: f.opacity, transform: [{ scale: f.scale }] }, glassTextShadow]}>{t.label}</Text>;
        })}
        {mx !== null ? <View pointerEvents="none" style={[styles.sunset, { bottom: rulerActive ? 27 : 18, left: mx - 4, opacity: rulerFade(mx, width).opacity }]} /> : null}
        {rulerActive && mx !== null && sunsetLabel ? <Text pointerEvents="none" style={[styles.sunsetLabel, { left: mx + 8 }, glassTextShadow]}>{sunsetLabel}</Text> : null}
        <View pointerEvents="none" style={[styles.pin, { bottom: rulerActive ? 12 : 4, left: width / 2 - 1.5 }]} />
      </View>
    </View>
  );
});

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
  track: { height: RULER_TRACK_H, overflow: 'hidden' },
  tick: { position: 'absolute', width: 1.5, borderRadius: 1 },
  tickLabel: { position: 'absolute', bottom: 0, width: 40, textAlign: 'center', fontFamily: mono, fontSize: 9.5, fontWeight: '400', color: TEXT },
  band: { position: 'absolute', height: 3, borderRadius: 2, backgroundColor: DARK.glow },
  pin: { position: 'absolute', top: 2, width: 2.5, borderRadius: 2, backgroundColor: DARK.accent },
  sunset: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: DARK.sun },
  sunsetLabel: { position: 'absolute', top: 0, fontSize: 9.5, fontWeight: '500', color: TEXT },
});
