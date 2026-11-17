import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, Eye, Square, X } from 'lucide-react-native';
import { radius, space } from '../../theme/tokens';
import { PressScale } from '../ui';
import { L3, type Language } from '../../utils/i18n';
import type { AstroCaptureProgress, AstroCaptureMode } from '../../utils/astroCapturePipeline';
import {
  ASTRO_NIGHT_PALETTE as R,
  formatCountdownMMSS,
  formatDurationLabel,
  type AstroShotSummary,
} from '../../utils/astroCameraUi';

export type AstroNightPhase = 'countdown' | 'capturing' | 'finalizing';

interface AstroCaptureNightOverlayProps {
  phase: AstroNightPhase;
  mode: AstroCaptureMode;
  summary: AstroShotSummary;
  totalTargetDurationSec: number;
  countdownRemainingSec: number;
  progress: AstroCaptureProgress | null;
  monochromeRed: boolean;
  onToggleMonochromeRed: () => void;
  onSkipCountdown: () => void;
  onStopEarlyAndSave: () => void;
  onCancelAbort: () => void;
  stopEarlyRequested: boolean;
  language: Language;
}

/**
 * 야간 천체 촬영 중 전용 화면: 암적응 보호를 위해 순수 검정(#000000) 배경과 적색 UI만 사용한다.
 * 시작 카운트다운 → 실시간 중간 합성 미리보기 + 남은 시간 + 흔들림 경고를 표시한다.
 */
export const AstroCaptureNightOverlay: React.FC<AstroCaptureNightOverlayProps> = ({
  phase,
  mode,
  summary,
  totalTargetDurationSec,
  countdownRemainingSec,
  progress,
  monochromeRed,
  onToggleMonochromeRed,
  onSkipCountdown,
  onStopEarlyAndSave,
  onCancelAbort,
  stopEarlyRequested,
  language,
}) => {
  const shotIndex = progress?.frameIndex ?? 0;
  const totalFrames = progress?.totalFrames ?? summary.totalFrames;
  const acceptedFrames = progress?.acceptedFrames ?? 0;
  const rejectedFrames = progress?.rejectedFrames ?? 0;
  const remainingSec = progress?.remainingSec ?? summary.effectiveTotalSec;
  const elapsedSec = progress?.elapsedSec ?? 0;
  const progressFrac = totalFrames > 0 ? Math.min(1, Math.max(0, shotIndex / totalFrames)) : 0;
  const formatTag = (progress?.format ?? (summary.rawActive ? 'raw16' : 'yuv')).toUpperCase();
  const shakeCount = progress?.shakeCount ?? 0;
  const lastShake = progress?.lastShake ?? null;

  const modeLabel =
    mode === 'tracked'
      ? L3(language, '별 추적 · 지구 자전 보정', 'Star Track · Earth Rotation Comp', '星追尾 · 自転補正')
      : L3(language, '별 궤적 · 고정 화각', 'Star Trails · Fixed Frame', '星軌跡 · 固定構図');

  return (
    <View style={styles.root}>
      {/* 상단 상태 줄 */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.liveDot} />
          <Text style={styles.headerTitle}>
            {phase === 'countdown'
              ? L3(language, '삼각대 안정 대기', 'Stabilizing Tripod', '三脚安定待機')
              : phase === 'finalizing'
                ? L3(language, '최종 32-bit PNG 합성 중…', 'Finalizing PNG Stack…', '最終PNG合成中…')
                : stopEarlyRequested
                  ? L3(language, '현재 프레임 후 마무리…', 'Stopping after current…', '現在フレーム後終了…')
                  : L3(language, '야간 장노출 촬영 중', 'Night Exposure Active', '夜間長時間露光中')}
          </Text>
        </View>
        <View style={styles.formatBadge}>
          <Text style={styles.formatText}>{formatTag}</Text>
        </View>
      </View>

      <Text style={styles.modeSub}>{modeLabel}</Text>

      {phase === 'countdown' ? (
        <View style={styles.countdownBody}>
          <View style={styles.countdownRing}>
            <Text style={styles.countdownNum}>{Math.max(1, Math.ceil(countdownRemainingSec))}</Text>
          </View>
          <Text style={styles.countdownHint}>
            {L3(
              language,
              '터치 진동이 가라앉은 뒤 자동으로 첫 노출을 시작합니다.',
              'Capture starts automatically once touch vibrations settle.',
              'タッチ振動が収まってから自動で露光を開始します。',
            )}
          </Text>
          <View style={styles.planBox}>
            <Text style={styles.planText}>
              {`${formatDurationLabel(totalTargetDurationSec, language)} · ${summary.subExposureSecUsed}s × ${summary.totalFrames}${L3(language, '장', ' frames', '枚')} · ISO ${summary.clampedIso}`}
            </Text>
          </View>
          <View style={styles.btnRow}>
            <PressScale style={styles.cancelBtn} onPress={onCancelAbort}>
              <X size={16} color={R.primary} />
              <Text style={styles.cancelText}>{L3(language, '취소', 'Cancel', 'キャンセル')}</Text>
            </PressScale>
            <PressScale style={styles.primaryRedBtn} onPress={onSkipCountdown}>
              <Text style={styles.primaryRedText}>{L3(language, '지금 바로 촬영', 'Start Now', '今すぐ撮影')}</Text>
            </PressScale>
          </View>
        </View>
      ) : (
        <View style={styles.captureBody}>
          {/* 카운트다운 · 프레임 진행률 */}
          <View style={styles.timerCard}>
            <View style={styles.timerTop}>
              <View>
                <Text style={styles.timerLabel}>{L3(language, '남은 시간', 'Remaining', '残り時間')}</Text>
                <Text style={styles.timerBig}>{formatCountdownMMSS(remainingSec)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.timerLabel}>
                  {`${L3(language, '경과', 'Elapsed', '経過')} ${formatCountdownMMSS(elapsedSec)}`}
                </Text>
                <Text style={styles.frameStat}>
                  {`${shotIndex} / ${totalFrames}${L3(language, '장', 'f', '枚')} · ${L3(language, '유효', 'OK', '有効')} ${acceptedFrames}${rejectedFrames > 0 ? ` · ${L3(language, '제외', 'Skip', '除外')} ${rejectedFrames}` : ''}`}
                </Text>
              </View>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(progressFrac * 100)}%` }]} />
            </View>
            {progress && progress.lastErrorPx > 0 && (
              <Text style={styles.alignStat}>
                {L3(
                  language,
                  `직전 프레임 별 정합 오차 ${progress.lastErrorPx.toFixed(2)}px`,
                  `Last star alignment error ${progress.lastErrorPx.toFixed(2)}px`,
                  `直前フレーム星整合誤差 ${progress.lastErrorPx.toFixed(2)}px`,
                )}
              </Text>
            )}
          </View>

          {/* 삼각대 흔들림 경고 배너 */}
          {lastShake ? (
            <View style={[styles.shakeBanner, lastShake.severity === 'severe' && styles.shakeBannerSevere]}>
              <AlertTriangle size={16} color={R.bright} />
              <Text style={styles.shakeText}>
                {lastShake.severity === 'severe'
                  ? L3(
                      language,
                      `#${lastShake.frameIndex} 프레임 흔들림 경고 (${lastShake.peakDegPerSec.toFixed(2)}°/s · 오차 ${lastShake.alignmentErrorPx.toFixed(1)}px) — ${mode === 'tracked' ? '자동 제외됨' : '결과 선명도 주의'}`,
                      `Shake on frame #${lastShake.frameIndex} (${lastShake.peakDegPerSec.toFixed(2)}°/s · ${lastShake.alignmentErrorPx.toFixed(1)}px)`,
                      `#${lastShake.frameIndex} フレーム揺れ警告 (${lastShake.peakDegPerSec.toFixed(2)}°/s)`,
                    )
                  : L3(
                      language,
                      `#${lastShake.frameIndex} 미세 진동 감지 (${lastShake.peakDegPerSec.toFixed(2)}°/s · 누적 ${shakeCount}회)`,
                      `Mild vibration on #${lastShake.frameIndex} (total ${shakeCount})`,
                      `#${lastShake.frameIndex} 微振動検知 (累計 ${shakeCount}回)`,
                    )}
              </Text>
            </View>
          ) : shakeCount > 0 ? (
            <View style={styles.shakeBanner}>
              <AlertTriangle size={14} color={R.dim} />
              <Text style={[styles.shakeText, { color: R.dim }]}>
                {L3(
                  language,
                  `이전 흔들림 감지 ${shakeCount}회 — 현재 프레임 안정`,
                  `Previous shake events: ${shakeCount} — stable now`,
                  `過去の揺れ検知 ${shakeCount}回 — 現在安定`,
                )}
              </Text>
            </View>
          ) : null}

          {/* 현재까지의 중간 합성 미리보기 */}
          <View style={styles.previewBox}>
            {progress?.previewUri ? (
              <Image source={{ uri: progress.previewUri }} style={styles.previewImage} resizeMode="contain" fadeDuration={0} />
            ) : (
              <View style={styles.previewEmpty}>
                <Text style={styles.previewEmptyTitle}>
                  {L3(
                    language,
                    `첫 서브프레임 노출 중 (${summary.subExposureSecUsed}s)…`,
                    `Exposing first sub-frame (${summary.subExposureSecUsed}s)…`,
                    `最初のサブフレーム露光中 (${summary.subExposureSecUsed}s)…`,
                  )}
                </Text>
                <Text style={styles.previewEmptySub}>
                  {L3(
                    language,
                    '첫 장이 누적되면 실시간 합성 이미지가 여기에 표시됩니다.',
                    'Intermediate stacked preview appears after frame 1.',
                    '1枚目の累積後、リアルタイム合成画像が表示されます。',
                  )}
                </Text>
              </View>
            )}
            <View style={styles.previewTopOverlay}>
              <Text style={styles.previewTag}>
                {L3(language, '실시간 중간 합성', 'Live Stack Preview', 'リアルタイム合成')}
              </Text>
              <PressScale style={styles.colorPeekBtn} onPress={onToggleMonochromeRed}>
                <Eye size={12} color={R.primary} />
                <Text style={styles.colorPeekText}>
                  {monochromeRed
                    ? L3(language, '적색 야간', 'Red Night', '赤色夜間')
                    : L3(language, '원본색', 'Color', '原色')}
                </Text>
              </PressScale>
            </View>
          </View>

          {/* 하단 중단 / 여기까지 합성 */}
          <View style={styles.btnRow}>
            <PressScale
              style={styles.cancelBtn}
              onPress={onCancelAbort}
              disabled={phase === 'finalizing'}
            >
              <X size={16} color={R.primary} />
              <Text style={styles.cancelText}>{L3(language, '완전 취소', 'Abort', '中止')}</Text>
            </PressScale>
            <PressScale
              style={[
                styles.primaryRedBtn,
                (acceptedFrames === 0 || phase === 'finalizing' || stopEarlyRequested) && { opacity: 0.4 },
              ]}
              onPress={onStopEarlyAndSave}
              disabled={acceptedFrames === 0 || phase === 'finalizing' || stopEarlyRequested}
            >
              <Square size={14} color={R.bright} fill={R.bright} />
              <Text style={styles.primaryRedText}>
                {L3(language, '여기까지 합성', 'Finish & Stack', 'ここまでに合成')}
              </Text>
            </PressScale>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: R.bg,
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingBottom: Platform.OS === 'ios' ? 34 : 22,
    paddingHorizontal: space.lg,
    justifyContent: 'space-between',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: R.bright },
  headerTitle: { fontSize: 17, fontWeight: '700', color: R.primary },
  formatBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: R.borderStrong,
    backgroundColor: R.surface,
  },
  formatText: { fontSize: 11, fontWeight: '700', color: R.primary, letterSpacing: 0.6 },
  modeSub: { fontSize: 12, color: R.dim, marginTop: 4 },
  countdownBody: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 24 },
  countdownRing: {
    width: 148,
    height: 148,
    borderRadius: 74,
    borderWidth: 2,
    borderColor: R.borderStrong,
    backgroundColor: R.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownNum: {
    fontSize: 64,
    fontWeight: '700',
    color: R.bright,
    fontVariant: ['tabular-nums'],
  },
  countdownHint: { fontSize: 13, color: R.dim, textAlign: 'center', lineHeight: 19, paddingHorizontal: 16 },
  planBox: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: R.border,
    backgroundColor: R.surface,
  },
  planText: { fontSize: 12, color: R.primary, fontVariant: ['tabular-nums'] },
  captureBody: { flex: 1, gap: space.sm, marginTop: space.sm, justifyContent: 'space-between' },
  timerCard: {
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: R.border,
    backgroundColor: R.surface,
    gap: 8,
  },
  timerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  timerLabel: { fontSize: 11, color: R.dim },
  timerBig: { fontSize: 30, fontWeight: '700', color: R.bright, fontVariant: ['tabular-nums'] },
  frameStat: { fontSize: 13, fontWeight: '600', color: R.primary, marginTop: 2, fontVariant: ['tabular-nums'] },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: R.surfaceRaised,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: R.bright },
  alignStat: { fontSize: 11, color: R.dim, fontVariant: ['tabular-nums'] },
  shakeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: R.border,
    backgroundColor: R.surface,
  },
  shakeBannerSevere: {
    borderColor: R.bright,
    backgroundColor: R.warnBg,
  },
  shakeText: { fontSize: 12, fontWeight: '600', color: R.bright, flex: 1 },
  previewBox: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: R.border,
    backgroundColor: R.bg,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: { width: '100%', height: '100%' },
  previewEmpty: { alignItems: 'center', paddingHorizontal: 24, gap: 6 },
  previewEmptyTitle: { fontSize: 14, fontWeight: '600', color: R.primary },
  previewEmptySub: { fontSize: 12, color: R.dim, textAlign: 'center' },
  previewTopOverlay: {
    position: 'absolute',
    top: 8,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewTag: {
    fontSize: 11,
    fontWeight: '600',
    color: R.dim,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.xs,
  },
  colorPeekBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: R.borderStrong,
    backgroundColor: R.surface,
  },
  colorPeekText: { fontSize: 11, fontWeight: '600', color: R.primary },
  btnRow: { flexDirection: 'row', gap: space.sm, width: '100%' },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: R.border,
    backgroundColor: R.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  cancelText: { fontSize: 14, fontWeight: '600', color: R.primary },
  primaryRedBtn: {
    flex: 1.4,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: R.bright,
    backgroundColor: R.surfaceRaised,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryRedText: { fontSize: 14, fontWeight: '700', color: R.bright },
});
