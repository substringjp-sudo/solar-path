import React, { useState } from 'react';
import { ActivityIndicator, Image, Platform, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, Smartphone, Sparkles, Target, X } from 'lucide-react-native';
import { color, radius, space, type, TOUCH } from '../../theme/tokens';
import { PressScale } from '../ui';
import { L3, type Language } from '../../utils/i18n';
import { getPrimarySky } from '../SkyScene3D/primarySky';
import {
  computeAstroSimExposureParams,
  formatDurationLabel,
  type AstroSettingsState,
  type CameraTabMode,
  type DirectionTarget,
} from '../../utils/astroCameraUi';

interface SimPickerOverlayProps {
  visible: boolean;
  cameraTab: CameraTabMode;
  astroSettings: AstroSettingsState;
  currentTime: Date;
  currentPhoneView: () => { az: number; el: number };
  onCloseToCamera: () => void;
  onLockTarget: (target: DirectionTarget) => void;
  language: Language;
}

/**
 * 카메라를 끈 상태에서 메인 60fps SkyScene3D · DateTimeBar 위에서
 * 구도와 미래 시간을 찾은 뒤 목표 방향을 잠그는 플로팅 오버레이.
 */
export const SimPickerOverlay: React.FC<SimPickerOverlayProps> = ({
  visible,
  cameraTab,
  astroSettings,
  currentTime,
  currentPhoneView,
  onCloseToCamera,
  onLockTarget,
  language,
}) => {
  const [longExpUri, setLongExpUri] = useState<string | null>(null);
  const [isIntegrating, setIsIntegrating] = useState(false);

  React.useEffect(() => {
    if (!visible) getPrimarySky()?.cancelLongExposure?.();
    return () => { getPrimarySky()?.cancelLongExposure?.(); };
  }, [visible]);

  if (!visible) return null;

  const handleSyncToPhone = () => {
    getPrimarySky()?.cancelLongExposure?.();
    setLongExpUri(null);
    const v = currentPhoneView();
    getPrimarySky()?.setCameraView?.(v.az, v.el);
  };

  const handleLockCurrentView = () => {
    getPrimarySky()?.cancelLongExposure?.();
    const sky = getPrimarySky();
    const state = sky?.getRenderState();
    const v = state?.view;
    setLongExpUri(null);
    if (v) {
      onLockTarget({
        azDeg: Number((((v.az % 360) + 360) % 360).toFixed(1)),
        elDeg: Number(v.el.toFixed(1)),
      });
    } else {
      onCloseToCamera();
    }
  };

  const handlePreviewLongExposure = async () => {
    const sky = getPrimarySky();
    const state = sky?.getRenderState();
    if (!sky || !state) return;

    sky.cancelLongExposure?.();
    setIsIntegrating(true);
    try {
      const simMode =
        astroSettings.mode === 'tracked'
          ? (astroSettings.keepFixedGround ? 'tracked_fixed_ground' : 'tracked')
          : 'trails';
      const sp = computeAstroSimExposureParams(astroSettings.durationSec, astroSettings.iso);
      const res = await sky.renderLongExposure(
        {
          az: state.view.az,
          el: state.view.el,
          fov: state.view.fov,
          rollDeg: state.view.roll,
        },
        {
          mode: simMode,
          startTimeMs: currentTime.getTime(),
          durationSec: astroSettings.durationSec,
          steps: sp.stepsForPreview,
          exposureGain: sp.exposureGain,
          starBoost: sp.starBoost,
          shadowLift: sp.shadowLift,
          settleFrames: 4,
          requireReady: false,
          waitMs: 4000,
          format: 'jpeg',
          compress: 0.85,
        },
      );
      if (res.uri) setLongExpUri(res.uri);
    } finally {
      setIsIntegrating(false);
    }
  };

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* 장노출 스냅샷 결과를 켜 둔 동안 3D 스테이지 위에 표시 (하단 DateTimeBar 조작은 유지) */}
      {longExpUri && (
        <View style={styles.previewWrap} pointerEvents="box-none">
          <Image source={{ uri: longExpUri }} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0} />
          <PressScale style={styles.closeLongBtn} onPress={() => setLongExpUri(null)}>
            <X size={14} color={color.text} />
            <Text style={styles.closeLongText}>
              {L3(language, '실시간 60fps 3D로 돌아가기', 'Back to live 3D', 'リアルタイム3Dに戻る')}
            </Text>
          </PressScale>
        </View>
      )}

      {/* 상단 플로팅 헤더 바 — AppHeader 자리에 얹혀 구도 탐색·미래 시간·목표 고정을 제어 */}
      <View style={styles.topBar}>
        <View style={styles.row}>
          <PressScale style={styles.backBtn} onPress={() => { setLongExpUri(null); onCloseToCamera(); }}>
            <ArrowLeft size={16} color={color.text} />
            <Text style={styles.backText}>{L3(language, '카메라', 'Camera', 'カメラ')}</Text>
          </PressScale>

          <PressScale style={styles.subBtn} onPress={handleSyncToPhone}>
            <Smartphone size={14} color={color.textDim} />
            <Text style={styles.subBtnText}>{L3(language, '내 폰 각도', 'Phone view', 'スマホ角度')}</Text>
          </PressScale>

          <PressScale style={styles.lockBtn} onPress={handleLockCurrentView}>
            <Target size={15} color={color.onAccent} />
            <Text style={styles.lockBtnText}>{L3(language, '이 방향 맞추기', 'Aim here', 'この方向に合わせる')}</Text>
          </PressScale>
        </View>

        <View style={styles.hintRow}>
          <Text style={styles.hintText} numberOfLines={1}>
            {L3(
              language,
              '드래그로 구도 탐색 · 아래 막대로 미래 시간 확인 → [이 방향 맞추기]',
              'Drag 3D sky & scrub bottom bar for future time → [Aim here]',
              'ドラッグで構図・下部バーで未来時刻確認 → [この方向に合わせる]',
            )}
          </Text>
          {cameraTab === 'astro' && (
            <PressScale
              style={[styles.astroSimBtn, isIntegrating && { opacity: 0.6 }]}
              onPress={handlePreviewLongExposure}
              disabled={isIntegrating}
            >
              {isIntegrating ? (
                <ActivityIndicator size="small" color={color.moon} />
              ) : (
                <Sparkles size={13} color={color.moon} />
              )}
              <Text style={styles.astroSimText}>
                {L3(
                  language,
                  `${formatDurationLabel(astroSettings.durationSec, language)} 장노출 확인`,
                  `${formatDurationLabel(astroSettings.durationSec, language)} Sim`,
                  `${formatDurationLabel(astroSettings.durationSec, language)} 露光予測`,
                )}
              </Text>
            </PressScale>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
  },
  previewWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 220,
    backgroundColor: '#03050C',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: space.md,
  },
  closeLongBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.overlay,
  },
  closeLongText: { ...type.label, color: color.text },
  topBar: {
    paddingTop: Platform.OS === 'ios' ? 50 : 32,
    paddingBottom: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: color.panel,
    borderBottomWidth: 1,
    borderColor: color.borderStrong,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: TOUCH,
    paddingHorizontal: 10,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.fill,
  },
  backText: { ...type.label, color: color.text },
  subBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: TOUCH,
    paddingHorizontal: 10,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.fill,
  },
  subBtnText: { ...type.micro, color: color.textDim },
  lockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: TOUCH,
    paddingHorizontal: 12,
    borderRadius: radius.xs,
    backgroundColor: color.accent,
  },
  lockBtnText: { ...type.label, fontWeight: '700', color: color.onAccent },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  hintText: { ...type.micro, color: color.textDim, flex: 1 },
  astroSimBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.moon,
    backgroundColor: 'rgba(165, 180, 252, 0.14)',
  },
  astroSimText: { ...type.micro, fontWeight: '600', color: color.moon },
});
