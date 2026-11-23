/**
 * ScoreGraph.tsx — 01 하늘 시트의 **시간대별 점수 그래프**(docs/SANDBOX_MODE_PLAN.md 2.4, 목업 1번).
 *
 * 하루 가운데 9시간 창(일몰이면 12:00~21:00 꼴)의 노을 점수를 작은 면 그래프로 보여 주고, **누르면 그 시각으로** 갑니다.
 * 파란 세로선은 지금 보고 있는 시각입니다. 점수 값은 하늘 화면과 같은 예측에서 오므로(`utils/scoreSeries.ts`) 요약 줄의 점수와 어긋나지 않습니다.
 *
 * 누름 자리는 그림이 아니라 **바깥 누름 영역**에서 읽습니다. 그림과 글자는 터치를 받지 않게 해서(`pointerEvents="none"`)
 * `locationX` 가 닿은 자식 기준으로 어긋나지 않습니다(`ScrubTrack` 머리말의 옛 슬라이더 결함과 같은 부류).
 * 웹 하네스의 클릭 이벤트에는 `locationX` 가 없어(처음에 시각이 NaN 이 됐습니다) 화면 좌표에서 이 영역의 왼쪽을 빼는 길도 둡니다.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Pressable, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { makeStyles, useThemeColors } from '../../theme/useTheme';
import { color as DARK, space, type, type Palette } from '../../theme/tokens';
import { axisTicks, graphLabel, scorePaths, timeAtX, xAtTime, type ScorePoint, type ScoreWindow } from '../../utils/scoreSeries';

type Lang = 'ko' | 'en' | 'ja';

interface Props {
  points: readonly ScorePoint[];
  window: ScoreWindow;
  /** 지금 보고 있는 시각(ms) — 창 안이면 세로선으로 */
  nowMs: number;
  /** 관측지 UTC 오프셋(시간) */
  tzHours: number;
  language: Lang;
  /** 그래프를 누르면 그 시각(ms)으로 */
  onPickTime: (ms: number) => void;
  height?: number;
  forceDark?: boolean;
}

const TICK_W = 40;

export const ScoreGraph: React.FC<Props> = ({ points, window: win, nowMs, tzHours, language, onPickTime, height = 44, forceDark = false }) => {
  const themeColor = useThemeColors();
  const themeStyles = useStyles();
  const color = forceDark ? DARK : themeColor;
  const styles = forceDark ? darkStyles : themeStyles;
  const [width, setWidth] = useState(0);
  const g = useMemo(() => ({ width: Math.max(1, width), height }), [width, height]);
  const paths = useMemo(() => scorePaths(points, win, g), [points, win, g]);
  const ticks = useMemo(() => axisTicks(win, g, tzHours), [win, g, tzHours]);
  const nowX = nowMs >= win.fromMs && nowMs <= win.toMs ? xAtTime(win, g, nowMs) : null;
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const areaRef = useRef<View>(null);

  const pickAtX = (x: number) => {
    const t = timeAtX(win, g, x);
    if (width > 0 && Number.isFinite(t)) onPickTime(Math.round(t));
  };
  // 앱(RN)의 누름 이벤트는 `locationX` 를 줍니다. 웹의 클릭 이벤트에는 없어서(DOM 이벤트) 화면 좌표에서 이 영역의 왼쪽을 뺍니다.
  const onPress = (e: GestureResponderEvent) => {
    const ne = e.nativeEvent as unknown as { locationX?: number; pageX?: number; clientX?: number };
    if (typeof ne.locationX === 'number' && Number.isFinite(ne.locationX)) { pickAtX(ne.locationX); return; }
    const pageX = ne.pageX ?? ne.clientX;
    if (typeof pageX === 'number') areaRef.current?.measureInWindow((left) => pickAtX(pageX - left));
  };

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Pressable
        ref={areaRef}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={graphLabel(paths.peak, tzHours, language)}
        accessibilityHint={language === 'ko' ? '누르면 그 시각으로 갑니다' : language === 'ja' ? '押すとその時刻に移ります' : 'Tap to jump to that time'}
        style={{ height }}
      >
        <View pointerEvents="none" style={{ height }}>
          {width > 0 && (
            <Svg width={width} height={height}>
              {!!paths.area && <Path d={paths.area} fill={color.glow} fillOpacity={0.22} />}
              {!!paths.line && <Path d={paths.line} stroke={color.glow} strokeWidth={1.5} fill="none" strokeLinejoin="round" />}
              {nowX != null && <Line x1={nowX} x2={nowX} y1={0} y2={height} stroke={color.accent} strokeWidth={2} />}
            </Svg>
          )}
        </View>
      </Pressable>
      <View style={styles.axis} pointerEvents="none">
        {width > 0 && ticks.map(t => (
          <Text key={t.t} style={[styles.tick, { left: Math.max(0, Math.min(width - TICK_W, t.x - TICK_W / 2)) }]}>{t.label}</Text>
        ))}
      </View>
    </View>
  );
};

const makeGraphStyles = (color: Palette) => ({
  wrap: { gap: space.xs },
  axis: { height: 12 },
  tick: { position: 'absolute' as const, top: 0, width: TICK_W, textAlign: 'center' as const, ...type.micro, color: color.textMute },
});

const useStyles = makeStyles(makeGraphStyles);
const darkStyles = makeGraphStyles(DARK);
