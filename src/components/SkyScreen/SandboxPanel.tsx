/**
 * SandboxPanel.tsx — 샌드박스(전문가 모드) 구도 도구: 눈 높이 · 위치 이동 · "내 위치 아님".
 * docs/SANDBOX_MODE_PLAN.md 2.2. 하늘 위의 떠 있는 것이라 화면 모드와 상관없이 어두운 재질(overlay)을 씁니다.
 *
 * - 눈 높이: 칩 5개. 눈이 그 높이에서 보는 지형·건물·구름으로 다시 그립니다.
 * - 이동: 동서남북 단추 한 번에 `stepM` 미터. 누를 때마다 위치를 바꿉니다(날씨·지형은 새 자리 것을 받습니다).
 * - 내 위치 아님: 기기 위치에서 멀면(`awayM`) 알리고, "내 위치로"로 돌아옵니다.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LocateFixed } from 'lucide-react-native';
import { OverlayButton } from '../ui';
import { color as DARK, mono, radius } from '../../theme/tokens';
import { L3 } from '../../utils/i18n';

export const EYE_HEIGHT_CHOICES_M = [1.6, 10, 30, 100, 300] as const;
export const MOVE_STEP_CHOICES_M = [10, 100, 1000] as const;

/** 이 거리(m) 넘게 떨어지면 "내 위치 아님". */
export const AWAY_THRESHOLD_M = 150;

interface Props {
  language: 'ko' | 'en' | 'ja';
  eyeHeightM: number;
  onEyeHeight: (m: number) => void;
  stepM: number;
  onStep: (m: number) => void;
  /** 동쪽(+)·북쪽(+) 미터 */
  onMove: (eastM: number, northM: number) => void;
  /** 기기 위치에서 떨어진 거리(m). 기기 위치를 모르면 null. */
  awayM: number | null;
  onHome: () => void;
}

const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km` : `${m % 1 === 0 ? m : m.toFixed(1)} m`);

export const SandboxPanel: React.FC<Props> = ({ language, eyeHeightM, onEyeHeight, stepM, onStep, onMove, awayM, onHome }) => {
  const away = awayM != null && awayM > AWAY_THRESHOLD_M;
  const nextStep = () => {
    const i = MOVE_STEP_CHOICES_M.indexOf(stepM as (typeof MOVE_STEP_CHOICES_M)[number]);
    onStep(MOVE_STEP_CHOICES_M[(i + 1) % MOVE_STEP_CHOICES_M.length]);
  };
  const dir = (label: string, icon: React.ReactNode, e: number, n: number) => (
    <OverlayButton onPress={() => onMove(e * stepM, n * stepM)} accessibilityLabel={label} style={styles.dirBtn}>
      {icon}
    </OverlayButton>
  );
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {away && (
        <View style={styles.awayRow}>
          <View style={styles.awayBadge}>
            <Text style={styles.awayText} numberOfLines={1}>
              {L3(language, '내 위치 아님', 'Not my location', '現在地ではない')} · {fmtM(Math.round(awayM!))}
            </Text>
          </View>
          <OverlayButton onPress={onHome} accessibilityLabel={L3(language, '내 위치로', 'Back to my location', '現在地へ')} style={styles.homeBtn}>
            <LocateFixed size={14} color={DARK.accent} />
            <Text style={styles.homeText}>{L3(language, '내 위치로', 'Home', '現在地へ')}</Text>
          </OverlayButton>
        </View>
      )}

      <Text style={styles.label}>{L3(language, '눈 높이', 'Eye height', '目の高さ')}</Text>
      <View style={styles.chipRow}>
        {EYE_HEIGHT_CHOICES_M.map(h => (
          <OverlayButton
            key={h}
            active={Math.abs(eyeHeightM - h) < 0.01}
            onPress={() => onEyeHeight(h)}
            accessibilityLabel={`${L3(language, '눈 높이', 'Eye height', '目の高さ')} ${h} m`}
            style={styles.chip}
          >
            <Text style={[styles.chipText, Math.abs(eyeHeightM - h) < 0.01 && { color: DARK.accent }]}>{h}</Text>
          </OverlayButton>
        ))}
        <Text style={styles.unit}>m</Text>
      </View>

      <Text style={styles.label}>{L3(language, '위치 이동', 'Move', '位置移動')}</Text>
      <View style={styles.moveRow}>
        <View style={styles.pad}>
          <View style={styles.padRow}>
            <View style={styles.dirSlot} />
            {dir(L3(language, '북쪽으로', 'North', '北へ'), <ArrowUp size={14} color={DARK.text} />, 0, 1)}
            <View style={styles.dirSlot} />
          </View>
          <View style={styles.padRow}>
            {dir(L3(language, '서쪽으로', 'West', '西へ'), <ArrowLeft size={14} color={DARK.text} />, -1, 0)}
            <View style={styles.dirSlot} />
            {dir(L3(language, '동쪽으로', 'East', '東へ'), <ArrowRight size={14} color={DARK.text} />, 1, 0)}
          </View>
          <View style={styles.padRow}>
            <View style={styles.dirSlot} />
            {dir(L3(language, '남쪽으로', 'South', '南へ'), <ArrowDown size={14} color={DARK.text} />, 0, -1)}
            <View style={styles.dirSlot} />
          </View>
        </View>
        <OverlayButton onPress={nextStep} accessibilityLabel={`${L3(language, '이동 간격', 'Step', '移動幅')} ${fmtM(stepM)}`} style={styles.stepBtn}>
          <Text style={styles.stepText}>{fmtM(stepM)}</Text>
          <Text style={styles.stepSub}>{L3(language, '한 번에', 'per tap', '1回')}</Text>
        </OverlayButton>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  label: { fontFamily: mono, fontSize: 9, letterSpacing: 1, color: DARK.textMute, marginTop: 4 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chip: { width: 38, height: 28 },
  chipText: { fontFamily: mono, fontSize: 11, fontWeight: '700', color: DARK.text },
  unit: { fontFamily: mono, fontSize: 11, color: DARK.textDim, marginLeft: 2 },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pad: { gap: 2 },
  padRow: { flexDirection: 'row', gap: 2 },
  dirSlot: { width: 32, height: 32 },
  dirBtn: { width: 32, height: 32 },
  stepBtn: { width: 64, height: 44, flexDirection: 'column' },
  stepText: { fontFamily: mono, fontSize: 13, fontWeight: '700', color: DARK.text },
  stepSub: { fontSize: 9, color: DARK.textDim },
  awayRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  awayBadge: {
    backgroundColor: DARK.overlay,
    borderColor: DARK.danger,
    borderWidth: 1,
    borderRadius: radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 6,
    maxWidth: 190,
  },
  awayText: { fontFamily: mono, fontSize: 11, fontWeight: '700', color: DARK.danger },
  homeBtn: { width: 'auto', minWidth: 72, paddingHorizontal: 8, flexDirection: 'row', gap: 4, flexShrink: 0 },
  homeText: { fontSize: 11, fontWeight: '700', color: DARK.accent },
});
