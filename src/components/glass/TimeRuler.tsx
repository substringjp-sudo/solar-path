/**
 * TimeRuler.tsx — 시간 자(목업 "4차 b"). 상자 없이 눈금만, 가운데 파란 핀은 고정이고 눈금이 손가락을 따라 움직입니다.
 * 계산은 `utils/timeRuler.ts`(판정 verify-time-ruler.js). 왼쪽 날짜 단추 · 가운데 시각 숫자 · 오른쪽 "지금" 단추는 유리 알약/막 위 큰 글자(글자 대비는 glassTokens 판정).
 *
 * 시각은 바깥이 쥡니다(`timeMs`). 끄는 동안 `onChange` 로 계속 알리고, 놓을 때 `onCommit` 으로 한 번 더 알립니다(무거운 계산은 commit 에서).
 * 스크린리더: adjustable — 증가 · 감소로 15분씩.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { color as DARK, mono } from '../../theme/tokens';
import { TEXT } from '../../theme/glassTokens';
import { dateLabel, dragTimeMs, markerX, PX_PER_HOUR, rulerBand, rulerTicks, RULER_WIDTH, timeText, type ScoreSample } from '../../utils/timeRuler';
import { L3 } from '../../utils/i18n';
import { GlassChip } from './GlassChip';
import { glassTextShadow } from './GlassSurface';
import { markDragEnd } from './dragGuard';

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
  onNow?: () => void;
}

const RULER_H = 56;
const STEP_MS = 15 * 60_000;
const TICK_H = { hour: 16, half: 10, quarter: 6 } as const;
const TICK_A = { hour: 0.95, half: 0.7, quarter: 0.4 } as const;

export const TimeRuler: React.FC<Props> = ({ timeMs, tz, nowMs, language, onChange, onCommit, onDragStart, sunsetMs = null, sunsetLabel, scoreSamples = null, dateText, onDatePress, onNow }) => {
  const [width, setWidth] = useState(RULER_WIDTH);
  const startRef = useRef(timeMs);
  const lastRef = useRef(timeMs);
  const propsRef = useRef({ timeMs, onChange, onCommit, onDragStart });
  propsRef.current = { timeMs, onChange, onCommit, onDragStart };

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { startRef.current = propsRef.current.timeMs; lastRef.current = startRef.current; propsRef.current.onDragStart?.(); },
    onPanResponderMove: (_, g) => {
      const ms = dragTimeMs(startRef.current, g.dx);
      if (ms !== lastRef.current) { lastRef.current = ms; propsRef.current.onChange(ms); }
    },
    onPanResponderRelease: () => { markDragEnd(); propsRef.current.onCommit?.(lastRef.current); },
    onPanResponderTerminate: () => { markDragEnd(); propsRef.current.onCommit?.(lastRef.current); },
  }), []);

  const ticks = rulerTicks(timeMs, tz, width, PX_PER_HOUR);
  const mx = sunsetMs == null ? null : markerX(timeMs, sunsetMs, width, PX_PER_HOUR);
  const step = useCallback((dir: 1 | -1) => { const ms = timeMs + dir * STEP_MS; onChange(ms); onCommit?.(ms); }, [timeMs, onChange, onCommit]);
  const text = timeText(timeMs, tz);
  const band = scoreSamples ? rulerBand(scoreSamples, timeMs, width, PX_PER_HOUR) : [];

  return (
    <View style={styles.wrap} onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width) || RULER_WIDTH)}>
      <View style={styles.top}>
        <GlassChip
          testID="ruler-date"
          label={dateText ?? dateLabel(timeMs, nowMs, tz, language)}
          icon={<ChevronDown size={14} color={TEXT} />}
          onPress={onDatePress}
          accessibilityLabel={L3(language, '날짜 고르기', 'Pick date', '日付を選ぶ')}
          expanded={false}
        />
        <Text testID="ruler-digits" style={[styles.digits, glassTextShadow]}>{text}</Text>
        <GlassChip testID="ruler-now" label={L3(language, '지금', 'Now', '今')} onPress={onNow} />
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
          <View key={`b${i}`} testID="ruler-band" pointerEvents="none" style={[styles.band, { left: b.x0, width: b.x1 - b.x0, opacity: b.alpha }]} />
        ))}
        {ticks.map(t => (
          <View key={t.ms} pointerEvents="none" style={[styles.tick, { left: t.x - 1, height: TICK_H[t.kind], backgroundColor: `rgba(241,245,249,${TICK_A[t.kind]})` }]} />
        ))}
        {ticks.filter(t => t.label).map(t => (
          <Text key={`l${t.ms}`} pointerEvents="none" style={[styles.tickLabel, { left: t.x - 20 }, glassTextShadow]}>{t.label}</Text>
        ))}
        {mx !== null ? <View pointerEvents="none" style={[styles.sunset, { left: mx - 5 }]} /> : null}
        {mx !== null && sunsetLabel ? <Text pointerEvents="none" style={[styles.sunsetLabel, { left: mx + 8 }, glassTextShadow]}>{sunsetLabel}</Text> : null}
        <View pointerEvents="none" style={[styles.pin, { left: width / 2 - 1.5 }]} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 2 },
  digits: { fontFamily: mono, fontSize: 22, fontWeight: '800', color: TEXT },
  track: { height: RULER_H, overflow: 'hidden' },
  tick: { position: 'absolute', bottom: 18, width: 2, borderRadius: 1 },
  tickLabel: { position: 'absolute', bottom: 0, width: 40, textAlign: 'center', fontFamily: mono, fontSize: 11, color: TEXT },
  band: { position: 'absolute', bottom: 38, height: 3, borderRadius: 2, backgroundColor: DARK.glow },
  pin: { position: 'absolute', top: 2, bottom: 16, width: 3, borderRadius: 2, backgroundColor: DARK.accent },
  sunset: { position: 'absolute', bottom: 34, width: 10, height: 10, borderRadius: 5, backgroundColor: DARK.sun },
  sunsetLabel: { position: 'absolute', top: 0, fontSize: 11, fontWeight: '700', color: TEXT },
});
