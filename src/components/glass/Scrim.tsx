/**
 * Scrim.tsx — 위 · 아래 어두운 막(밝은 하늘에서도 글자가 읽히게). 정지점은 `theme/glassTokens.ts` 의 SCRIM_TOP · SCRIM_BOTTOM.
 * 손가락을 받지 않습니다.
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { SCRIM_BOTTOM, SCRIM_TOP, type ScrimStops } from '../../theme/glassTokens';

interface Props {
  edge: 'top' | 'bottom';
  /** 막의 높이(px). 위쪽은 기본 150(SCRIM_TOP.heightPx). 아래쪽은 아래 묶음 높이에 맞춰 넘깁니다. */
  height?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export const Scrim: React.FC<Props> = ({ edge, height, style, testID }) => {
  const stops: ScrimStops = edge === 'top' ? SCRIM_TOP.stops : SCRIM_BOTTOM;
  const h = height ?? (edge === 'top' ? SCRIM_TOP.heightPx : 380);
  const id = `scrim-${edge}`;
  return (
    <View testID={testID} pointerEvents="none" style={[styles.base, edge === 'top' ? { top: 0 } : { bottom: 0 }, { height: h }, style]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            {stops.map(([p, a], i) => <Stop key={i} offset={p} stopColor="#000" stopOpacity={a} />)}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({ base: { position: 'absolute', left: 0, right: 0 } });
