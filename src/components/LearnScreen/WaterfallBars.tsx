/**
 * WaterfallBars.tsx — 노을 점수 · 별 한계등급의 **가감 막대**(위)와 **단계 줄**(아래).
 *
 * 막대: 앞 단계가 남긴 자리에서 다음 막대가 시작해 줄어든 만큼 칠해집니다. 이어지는 두 막대는 점선 하나로 이어,
 * 윗 막대의 위에서 아랫 막대의 아래까지 내려옵니다(끝 값이 다음 줄의 시작이라는 것이 한눈에 보이도록). 모서리는 둥글리지 않습니다.
 * 단계 줄: 이름 + 한 줄 이유를 왼쪽에, 줄어든 값을 오른쪽에 두고 끝 줄만 조금 크게 보입니다.
 * 값은 `utils/scoreWaterfall.ts` 가 만든 것을 그대로 그립니다(점수와 같은 합).
 */
import React, { useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { makeStyles, useThemeColors } from '../../theme/useTheme';
import { mono, space, type } from '../../theme/tokens';
import type { Waterfall } from '../../utils/scoreWaterfall';

const fmt = (w: Waterfall, v: number) => (w.unit === 'pts' ? String(Math.round(v)) : v.toFixed(1));
const fmtDelta = (w: Waterfall, d: number) => {
  const s = w.unit === 'pts' ? String(Math.round(Math.abs(d))) : Math.abs(d).toFixed(1);
  return Number(s) === 0 ? s : `${d < 0 ? '−' : '+'}${s}`;
};

const ROW = 26, BAR_H = 14, LABEL_W = 92, NUM_W = 40;

export const WaterfallBars: React.FC<{ waterfall: Waterfall }> = ({ waterfall: w }) => {
  const color = useThemeColors();
  const [width, setWidth] = useState(320);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.max(200, Math.round(e.nativeEvent.layout.width)));
  const trackX = LABEL_W, trackW = width - LABEL_W - NUM_W - 6;
  const X = (v: number) => trackX + (Math.max(0, Math.min(w.scaleMax, v)) / w.scaleMax) * trackW;
  const lines: Array<{ key: string; label: string; from: number; to: number; num: string; fill: string; bold?: boolean }> = [
    { key: 'start', label: w.startLabel, from: 0, to: w.start, num: fmt(w, w.start), fill: color.textMute },
    ...w.rows.map(r => ({ key: r.id, label: r.label, from: r.after - r.delta, to: r.after, num: fmtDelta(w, r.delta), fill: color.danger })),
    { key: 'end', label: w.endLabel, from: 0, to: w.end, num: fmt(w, w.end), fill: color.accent, bold: true },
  ];
  const H = lines.length * ROW;
  const barY = (i: number) => i * ROW + (ROW - BAR_H) / 2;
  const aria = `${w.endLabel} ${fmt(w, w.end)}`;
  return (
    <View onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={aria}>
      <Svg width={width} height={H}>
        {lines.map((l, i) => (
          <React.Fragment key={l.key}>
            <Rect x={trackX} y={barY(i)} width={trackW} height={BAR_H} fill={color.fill} />
            <Rect x={X(Math.min(l.from, l.to))} y={barY(i)} width={Math.max(1, X(Math.max(l.from, l.to)) - X(Math.min(l.from, l.to)))} height={BAR_H} fill={l.fill} />
            <SvgText x={0} y={i * ROW + ROW / 2 + 4} fontSize={12} fill={l.bold ? color.text : color.textDim} fontWeight={l.bold ? '700' : '400'}>{l.label}</SvgText>
            <SvgText x={width} y={i * ROW + ROW / 2 + 4} fontSize={12} fontFamily={mono} fill={l.bold ? color.text : color.textDim} fontWeight={l.bold ? '700' : '500'} textAnchor="end">{l.num}</SvgText>
          </React.Fragment>
        ))}
        {lines.map((l, i) => i === 0 ? null : (
          // 앞 줄이 끝난 자리에서, 윗 막대의 위에서 아랫 막대의 아래까지
          <Line key={`c${l.key}`} x1={X(lines[i - 1].to)} y1={barY(i - 1)} x2={X(lines[i - 1].to)} y2={barY(i) + BAR_H}
            stroke={color.text} strokeOpacity={0.7} strokeWidth={1} strokeDasharray="2 2" />
        ))}
      </Svg>
    </View>
  );
};

/** 막대 아래 단계 줄: 이름 · 한 줄 이유(왼쪽), 줄어든 값(오른쪽). 끝 줄만 조금 크게. */
export const WaterfallSteps: React.FC<{ waterfall: Waterfall }> = ({ waterfall: w }) => {
  const styles = useStyles();
  const rows = [
    { key: 'start', label: w.startLabel, note: w.startNote, val: fmt(w, w.start), tone: 'plain' as const },
    ...w.rows.map(r => ({ key: r.id, label: r.label, note: r.note, val: fmtDelta(w, r.delta), tone: 'dn' as const })),
    { key: 'end', label: w.endLabel, note: w.endNote, val: fmt(w, w.end), tone: 'end' as const },
  ];
  return (
    <View style={styles.wrap}>
      {rows.map(r => (
        <View key={r.key} style={styles.row}>
          <View style={styles.left}>
            <Text style={styles.label}>{r.label}</Text>
            <Text style={styles.note}>{r.note}</Text>
          </View>
          <Text style={[styles.val, r.tone === 'dn' && styles.dn, r.tone === 'end' && styles.end]}>{r.val}</Text>
        </View>
      ))}
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  wrap: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: color.fill, borderRadius: 10, paddingHorizontal: space.md, paddingVertical: space.sm },
  left: { flex: 1, minWidth: 0, gap: 2 },
  label: { ...type.bodyStrong, color: color.text },
  note: { fontSize: 12, color: color.textDim },
  val: { fontFamily: mono, fontSize: 17, fontWeight: '600', color: color.textDim, minWidth: 52, textAlign: 'right' },
  dn: { color: color.danger },
  end: { fontSize: 20, color: color.text },
}));
