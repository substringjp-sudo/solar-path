/**
 * RunExtras.tsx — 타임랩스 촬영 중 카드의 **밝기 곡선 · 배터리 줄 · "화면 끄고 계속"**(docs/SANDBOX_MODE_PLAN.md 16절 표 12).
 *
 * 곡선: 점선 = 예측(장면 밝기의 단 변화, 맑은 하늘 기준 어림), 실선 = 실제(찍은 사진 평균 밝기의 단 변화). 같은 눈금입니다.
 * 자동 노출이 장면을 따라가면 실제 선은 0 근처에 머물고, 못 따라가면 예측을 따라 내려갑니다(`utils/runCurve.ts`).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { MoonStar } from 'lucide-react-native';
import { color, mono } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';
import { batteryLine, batteryLow, curvePaths, type ActualPoint } from '../../utils/runCurve';
import type { BatteryStatus } from '../../utils/runDevice';

const W = 140, H = 28;

interface Props {
  language: Language;
  /** 예측: 구간을 균등하게 나눈 단 수 */
  pred: ReadonlyArray<number | null>;
  /** 실제: 찍은 장마다 { f: 구간 위치 0~1, stops } */
  actual: ReadonlyArray<ActualPoint>;
  battery: BatteryStatus | null;
  running: boolean;
  onScreenOff: () => void;
}

export const RunExtras: React.FC<Props> = ({ language, pred, actual, battery, running, onScreenOff }) => {
  const paths = curvePaths(pred, actual, W, H);
  const line = battery ? batteryLine(battery.level, battery.charging, battery.lowPower, language) : '';
  const low = battery ? batteryLow(battery.level, battery.charging) : false;
  return (
    <View style={styles.wrap}>
      {paths.pred ? (
        <View style={styles.curveRow}>
          <Svg width={W} height={H} accessibilityLabel={L3(language, '예측 대 실제 밝기 곡선', 'Predicted vs actual brightness', '予測と実際の明るさ')}>
            <Polyline points={paths.pred} fill="none" stroke={color.textDim} strokeWidth={1.5} strokeDasharray="3,3" />
            {paths.actual ? <Polyline points={paths.actual} fill="none" stroke={color.accent} strokeWidth={2} /> : null}
          </Svg>
          <Text style={styles.legend} numberOfLines={2}>
            {L3(language, '점선 예측 · 실선 실제(사진 평균 밝기). 맑은 하늘 기준 어림', 'Dashed: predicted · solid: photos (mean brightness). Clear-sky estimate', '点線: 予測 · 実線: 写真の平均の明るさ。快晴の目安')}
          </Text>
        </View>
      ) : null}
      {line ? <Text style={[styles.battery, low && { color: color.warning }]}>{low ? `${line} · ${L3(language, '배터리가 부족해요', 'Battery low', '電池残量わずか')}` : line}</Text> : null}
      {running ? (
        <Pressable onPress={onScreenOff} accessibilityRole="button" accessibilityLabel={L3(language, '화면 끄고 계속 찍기', 'Turn the screen off and keep shooting', '画面を消して撮影を続ける')} style={styles.offBtn} hitSlop={6}>
          <MoonStar size={14} color={color.text} />
          <Text style={styles.offText}>{L3(language, '화면 끄고 계속', 'Screen off, keep going', '画面を消して続行')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

interface CoverProps { language: Language; taken: number; frames: number; onWake: () => void }

/** "화면 끄고 계속" 동안 화면 전체를 덮는 검은 면. 누르면 켜집니다(촬영은 계속). */
export const ScreenOffCover: React.FC<CoverProps> = ({ language, taken, frames, onWake }) => (
  <Pressable onPress={onWake} style={styles.cover} accessibilityRole="button" accessibilityLabel={L3(language, '화면 켜기(촬영은 계속돼요)', 'Wake the screen (shooting continues)', '画面をつける(撮影は続きます)')}>
    <Text style={styles.coverText}>{`${taken}/${frames}`}</Text>
    <Text style={styles.coverHint}>{L3(language, '촬영 중 · 누르면 화면이 켜져요', 'Shooting · tap to wake the screen', '撮影中 · タップで画面がつきます')}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  curveRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legend: { flex: 1, minWidth: 0, fontFamily: mono, fontSize: 10, color: color.textDim },
  battery: { fontFamily: mono, fontSize: 11, color: color.textDim },
  offBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: color.border, minHeight: 32 },
  offText: { fontFamily: mono, fontSize: 12, color: color.text },
  cover: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', zIndex: 1000, elevation: 1000 },
  coverText: { fontFamily: mono, fontSize: 18, color: '#3A3F4A' },
  coverHint: { marginTop: 8, fontFamily: mono, fontSize: 11, color: '#2A2F38' },
});
