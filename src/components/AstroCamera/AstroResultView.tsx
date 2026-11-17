import React from 'react';
import { ActivityIndicator, Image, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, Check, Download, RefreshCw } from 'lucide-react-native';
import { color, radius, space, type } from '../../theme/tokens';
import { PressScale } from '../ui';
import { L3, type Language } from '../../utils/i18n';
import type { AstroCaptureRunResult } from '../../utils/astroCapturePipeline';
import {
  formatDurationLabel,
  summarizeAstroCaptureResult,
} from '../../utils/astroCameraUi';

interface AstroResultViewProps {
  result: AstroCaptureRunResult;
  simPreviewUri: string | null;
  simError: string | null;
  isoUsed: number;
  isSaving: boolean;
  hasSaved: boolean;
  onSavePng: () => void;
  onRetake: () => void;
  language: Language;
}

/**
 * 천체 장노출 촬영 완료 전용 화면.
 * 무손실 PNG 스택 결과와 3D 장노출 예측을 비교하고 프레임·정합·흔들림 리포트를 보여준다.
 */
export const AstroResultView: React.FC<AstroResultViewProps> = ({
  result,
  simPreviewUri,
  simError,
  isoUsed,
  isSaving,
  hasSaved,
  onSavePng,
  onRetake,
  language,
}) => {
  const stats = summarizeAstroCaptureResult(result);
  const modeLabel =
    result.mode === 'tracked'
      ? L3(language, '별 추적 · 지구 자전 보정', 'Star Tracking', '星追尾')
      : L3(language, '별 궤적 · 고정 화각', 'Star Trails', '星軌跡');

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>
          {L3(language, '천체 장노출 결과', 'Astro Long Exposure', '天体長時間露光の結果')}
        </Text>

        {/* 실제 PNG vs 3D 장노출 예측 */}
        <View style={styles.compareRow}>
          <View style={styles.compareCol}>
            <Image source={{ uri: result.uri }} style={styles.compareImg} resizeMode="cover" />
            <Text style={styles.compareLabel}>
              {L3(language, '실제 스택 (PNG)', 'Stacked PNG', '実撮影 (PNG)')}
            </Text>
          </View>
          <View style={styles.compareCol}>
            {simPreviewUri ? (
              <Image source={{ uri: simPreviewUri }} style={styles.compareImg} resizeMode="cover" />
            ) : (
              <View style={styles.compareMissing}>
                <Text style={styles.missingText}>
                  {L3(language, '3D 장노출 예측 없음', 'No 3D preview', '3D予測なし')}
                </Text>
                {simError ? (
                  <Text style={styles.missingErr} numberOfLines={3}>{simError}</Text>
                ) : null}
              </View>
            )}
            <Text style={styles.compareLabel}>
              {L3(language, '3D 장노출 시뮬레이션', '3D Long-Exp Sim', '3D 長時間露光予測')}
            </Text>
          </View>
        </View>

        {/* 천체 촬영 telemetry 리포트 */}
        <View style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <Text style={styles.reportTitle}>
              {L3(language, '합성 리포트', 'Stacking Report', '合成レポート')}
            </Text>
            <View style={styles.formatChip}>
              <Text style={styles.formatChipText}>
                {result.rawFormatUsed === 'raw16' ? '16-bit RAW → PNG' : 'YUV → PNG'}
              </Text>
            </View>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{L3(language, '합성 모드', 'Mode', '方式')}</Text>
            <Text style={styles.metaValue}>{modeLabel}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{L3(language, '촬영 시간 / 서브셔터', 'Duration / Sub', '時間 / サブ')}</Text>
            <Text style={styles.metaValue}>
              {`${formatDurationLabel(result.actualDurationSec, language)}${result.stoppedEarly ? L3(language, ' (조기 종료)', ' (early)', ' (途中終了)') : ''} · ${result.subExposureSecUsed}s · ISO ${isoUsed}`}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{L3(language, '프레임 누적', 'Frames', 'フレーム')}</Text>
            <Text style={styles.metaValue}>
              {`${L3(language, '유효', 'OK', '有効')} ${result.acceptedFrames} / ${result.totalFramesShot}${L3(language, '장', '', '枚')}${result.rejectedFrames > 0 ? ` (${L3(language, '구름', 'cloud', '雲')} ${stats.cloudyRejected} · ${L3(language, '진동', 'motion', '揺れ')} ${stats.motionRejected})` : ''}`}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{L3(language, '별 정합 평균 오차', 'Star alignment err', '星整合平均誤差')}</Text>
            <Text style={styles.metaValue}>{`${stats.meanErrorPx.toFixed(2)} px · ${result.width}×${result.height}`}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{L3(language, '삼각대 흔들림', 'Shake events', '三脚揺れ検知')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {stats.shakeCount > 0 && (
                <AlertTriangle size={13} color={stats.severeShakeCount > 0 ? color.danger : color.warning} />
              )}
              <Text
                style={[
                  styles.metaValue,
                  stats.severeShakeCount > 0 && { color: color.danger },
                ]}
              >
                {stats.shakeCount === 0
                  ? L3(language, '감지 없음', 'None', 'なし')
                  : L3(
                      language,
                      `${stats.shakeCount}회 (중대 ${stats.severeShakeCount}회)`,
                      `${stats.shakeCount} (${stats.severeShakeCount} severe)`,
                      `${stats.shakeCount}回 (重大 ${stats.severeShakeCount}回)`,
                    )}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.btnRow}>
          <PressScale style={styles.retakeBtn} onPress={onRetake} disabled={isSaving}>
            <RefreshCw size={17} color={color.text} />
            <Text style={styles.retakeText}>{L3(language, '다시 찍기', 'Retake', '撮り直し')}</Text>
          </PressScale>

          <PressScale
            style={[styles.saveBtn, hasSaved && { backgroundColor: color.success }]}
            onPress={onSavePng}
            disabled={isSaving || hasSaved}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={color.onAccent} />
            ) : hasSaved ? (
              <>
                <Check size={17} color={color.onAccent} />
                <Text style={styles.saveText}>{L3(language, 'PNG 저장됨', 'PNG Saved', 'PNG保存済み')}</Text>
              </>
            ) : (
              <>
                <Download size={17} color={color.onAccent} />
                <Text style={styles.saveText}>{L3(language, '무손실 PNG 저장', 'Save PNG', '無損失PNG保存')}</Text>
              </>
            )}
          </PressScale>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  scroll: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 40,
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  title: { ...type.display, color: color.text, fontSize: 20 },
  compareRow: { flexDirection: 'row', gap: space.sm },
  compareCol: { flex: 1, gap: 6 },
  compareImg: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: radius.md,
    backgroundColor: '#03050C',
    borderWidth: 1,
    borderColor: color.border,
  },
  compareMissing: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: radius.md,
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.sm,
    gap: 6,
  },
  missingText: { ...type.label, color: color.textDim, textAlign: 'center' },
  missingErr: { ...type.micro, color: color.textMute, textAlign: 'center' },
  compareLabel: { ...type.label, color: color.textDim, textAlign: 'center' },
  reportCard: {
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.panel,
    gap: 8,
  },
  reportHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  reportTitle: { ...type.body, fontWeight: '700', color: color.text },
  formatChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.moon,
    backgroundColor: 'rgba(165, 180, 252, 0.14)',
  },
  formatChipText: { ...type.micro, color: color.moon },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  metaLabel: { ...type.micro, color: color.textDim },
  metaValue: { ...type.label, color: color.text, flexShrink: 1, textAlign: 'right' },
  btnRow: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  retakeBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.panelRaised,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  retakeText: { ...type.body, fontWeight: '600', color: color.text },
  saveBtn: {
    flex: 1.4,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: color.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveText: { ...type.body, fontWeight: '700', color: color.onAccent },
});
