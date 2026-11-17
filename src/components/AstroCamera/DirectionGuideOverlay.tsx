import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Check, Target, Vibrate, VolumeX, X } from 'lucide-react-native';
import { color, radius, space, type } from '../../theme/tokens';
import { PressScale } from '../ui';
import { L3, type Language } from '../../utils/i18n';
import type { DirectionGuideState, DirectionTarget } from '../../utils/astroCameraUi';

interface DirectionGuideOverlayProps {
  target: DirectionTarget;
  guide: DirectionGuideState;
  vibrationEnabled: boolean;
  onToggleVibration: () => void;
  onClearTarget: () => void;
  stageHeight: number;
  language: Language;
}

/**
 * 목표 방향이 잠긴 상태에서 화면 중앙 십자 가이드와 상하좌우 회전 방향, 진동 토글을 표시한다.
 * 맞지 않을 때 진동이 오고, 정렬(≤ 2.5°)되면 진동이 멈춰 화면을 못 보는 삼각대에서도 맞출 수 있다.
 */
export const DirectionGuideOverlay: React.FC<DirectionGuideOverlayProps> = ({
  target,
  guide,
  vibrationEnabled,
  onToggleVibration,
  onClearTarget,
  stageHeight,
  language,
}) => {
  const yawArrow =
    Math.abs(guide.deltaAzDeg) < 1.5
      ? ''
      : guide.deltaAzDeg > 0
        ? `→ ${Math.round(Math.abs(guide.deltaAzDeg))}°`
        : `← ${Math.round(Math.abs(guide.deltaAzDeg))}°`;
  const pitchArrow =
    Math.abs(guide.deltaElDeg) < 1.5
      ? ''
      : guide.deltaElDeg > 0
        ? `↑ ${Math.round(Math.abs(guide.deltaElDeg))}°`
        : `↓ ${Math.round(Math.abs(guide.deltaElDeg))}°`;

  const hintLabel = guide.onTarget
    ? L3(language, '방향 일치 — 볼헤드를 고정하세요', 'Aligned — lock tripod', '方向一致 — 三脚を固定してください')
    : [yawArrow, pitchArrow].filter(Boolean).join('  ') || `${guide.errorDeg.toFixed(1)}°`;

  return (
    <View style={[styles.root, { height: stageHeight }]} pointerEvents="box-none">
      <View style={styles.reticleWrap} pointerEvents="box-none">
        {/* 상하 HUD 와 겹치지 않도록 과녁 바로 위 중앙에 목표 상태/진동 토글/해제 배치 */}
        <View style={styles.chipBar} pointerEvents="box-none">
          <View style={[styles.targetChip, guide.onTarget && styles.targetChipOk]}>
            {guide.onTarget ? (
              <Check size={13} color={color.success} />
            ) : (
              <Target size={13} color={color.accent} />
            )}
            <Text style={[styles.targetText, guide.onTarget && { color: color.success }]}>
              {`${Math.round(target.azDeg)}° / ${target.elDeg >= 0 ? '+' : ''}${Math.round(target.elDeg)}° · ${guide.onTarget ? L3(language, '일치', 'Locked', '一致') : `${guide.errorDeg.toFixed(1)}°`}`}
            </Text>
          </View>

          <PressScale
            style={[styles.iconBtn, vibrationEnabled && !guide.onTarget && styles.iconBtnActive]}
            onPress={onToggleVibration}
            accessibilityLabel={L3(language, '진동 가이드 켜기/끄기', 'Toggle vibration guide', '振動ガイド切替')}
          >
            {vibrationEnabled ? (
              <Vibrate size={14} color={guide.onTarget ? color.success : color.accent} />
            ) : (
              <VolumeX size={14} color={color.textDim} />
            )}
          </PressScale>

          <PressScale
            style={styles.iconBtn}
            onPress={onClearTarget}
            accessibilityLabel={L3(language, '목표 방향 해제', 'Clear target direction', '目標方向を解除')}
          >
            <X size={14} color={color.text} />
          </PressScale>
        </View>

        <View style={[styles.reticleRing, guide.onTarget && styles.reticleRingOk]} pointerEvents="none">
          <View style={[styles.reticleDot, guide.onTarget && { backgroundColor: color.success }]} />
        </View>
        <View style={[styles.dirPill, guide.onTarget && styles.dirPillOk]} pointerEvents="none">
          <Text style={[styles.dirText, guide.onTarget && { color: color.success }]}>
            {hintLabel}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, top: 0 },
  reticleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  chipBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  targetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
    paddingHorizontal: space.sm,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.accentLine,
    backgroundColor: color.overlay,
  },
  targetChipOk: {
    borderColor: color.success,
    backgroundColor: 'rgba(10, 28, 18, 0.85)',
  },
  targetText: { ...type.micro, color: color.text, fontWeight: '600' },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: {
    borderColor: color.accentLine,
    backgroundColor: color.accentSoft,
  },
  reticleRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: color.accentLine,
    backgroundColor: 'rgba(56, 189, 248, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticleRingOk: {
    borderColor: color.success,
    backgroundColor: 'rgba(74, 222, 128, 0.14)',
  },
  reticleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: color.accent,
  },
  dirPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.overlay,
  },
  dirPillOk: {
    borderColor: color.success,
    backgroundColor: 'rgba(10, 28, 18, 0.9)',
  },
  dirText: { ...type.label, color: color.text },
});
