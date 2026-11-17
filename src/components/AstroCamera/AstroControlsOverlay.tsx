import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CloudAlert, SlidersHorizontal, Sparkles, Timer } from 'lucide-react-native';
import { color, radius, space, type, TOUCH } from '../../theme/tokens';
import { PressScale } from '../ui';
import { ScrubTrack } from '../TimeBar/ScrubTrack';
import { L3, type Language } from '../../utils/i18n';
import type { AstroWindowAnalysis } from '../../utils/astroForecast';
import type { AstroCameraCapabilities } from '../../../modules/astro-camera';
import {
  COUNTDOWN_PRESETS_SEC,
  ISO_PRESETS,
  formatDurationLabel,
  type AstroShotSummary,
  type AstroSettingsState,
  type AstroSimExposureParams,
} from '../../utils/astroCameraUi';

interface AstroForecastBannerProps {
  analysis: AstroWindowAnalysis | null;
  durationSec: number;
  language: Language;
}

/**
 * 30분 앞당김 타임라인 속 선택 노출 구간의 구름 방해 여부를 1줄 배지 + 얇은 막대로 표시한다.
 */
export const AstroForecastBanner: React.FC<AstroForecastBannerProps> = ({
  analysis,
  durationSec,
  language,
}) => {
  if (!analysis || !analysis.hasData) {
    return (
      <View style={styles.forecastCard}>
        <View style={styles.forecastRow}>
          <CloudAlert size={13} color={color.moon} />
          <Text style={styles.forecastText}>
            {L3(language, '야간 구름 예보 계산 중…', 'Analyzing night cloud window…', '夜間雲予報を計算中…')}
          </Text>
        </View>
      </View>
    );
  }

  const riskColor =
    analysis.interferenceRisk === 'low'
      ? color.success
      : analysis.interferenceRisk === 'moderate'
        ? color.warning
        : color.danger;

  const layerText =
    analysis.worstLayer === 'low'
      ? L3(language, '저층운', 'Low cloud', '下層雲')
      : analysis.worstLayer === 'mid'
        ? L3(language, '중층운', 'Mid cloud', '中層雲')
        : analysis.worstLayer === 'high'
          ? L3(language, '상층운', 'High cloud', '上層雲')
          : '';

  const headline = (() => {
    if (analysis.interferenceRisk === 'low') {
      const clearM = Math.max(0, Math.round(analysis.clearWindowMin));
      return L3(
        language,
        `맑은 창 ${clearM}분+ · 구름 방해 낮음`,
        `Clear ${clearM}m+ · Low cloud risk`,
        `快晴${clearM}分+ · 雲の影響小`,
      );
    }
    if (analysis.interferenceRisk === 'moderate') {
      const firstM = analysis.firstInterferenceMin != null ? Math.round(analysis.firstInterferenceMin) : null;
      const peak = Math.round(analysis.lookaheadPeakBlockPct);
      return firstM != null
        ? L3(language, `약 ${firstM}분 뒤 구름 유입 (최대 ${peak}%)`, `Clouds in ~${firstM}m (peak ${peak}%)`, `約${firstM}分後に雲流入 (${peak}%)`)
        : L3(language, `구름 유입 가능성 (${peak}%)`, `Possible clouds (${peak}%)`, `雲流入の可能性 (${peak}%)`);
    }
    const peak = Math.round(analysis.exposurePeakBlockPct);
    const when =
      analysis.firstInterferenceMin != null && analysis.firstInterferenceMin > 0
        ? L3(language, `${Math.round(analysis.firstInterferenceMin)}분 뒤`, `in ${Math.round(analysis.firstInterferenceMin)}m`, `${Math.round(analysis.firstInterferenceMin)}分後`)
        : L3(language, '즉시', 'now', '現在');
    return L3(
      language,
      `구름 가림 위험 (${layerText ? `${layerText} · ` : ''}${when} ${peak}%)`,
      `Cloud obstruction (${layerText ? `${layerText} · ` : ''}${when} ${peak}%)`,
      `雲による遮蔽リスク (${layerText ? `${layerText} · ` : ''}${when} ${peak}%)`,
    );
  })();

  const maxOffsetMin = Math.max(15, analysis.series[analysis.series.length - 1]?.offsetMin ?? 30);
  const exposureFrac = Math.min(1, Math.max(0.08, (durationSec / 60) / maxOffsetMin));

  return (
    <View style={styles.forecastCard}>
      <View style={styles.forecastRow}>
        <View style={[styles.riskDot, { backgroundColor: riskColor }]} />
        <Text style={styles.forecastText} numberOfLines={1}>
          {headline}
        </Text>
      </View>
      {analysis.series.length > 0 && (
        <View style={styles.timelineBarWrap}>
          <View style={styles.timelineSegments}>
            {analysis.series.map((pt, i) => {
              const barColor =
                pt.effectiveBlockPct >= 35
                  ? color.danger
                  : pt.effectiveBlockPct >= 15
                    ? color.warning
                    : 'rgba(165, 180, 252, 0.28)';
              const h = Math.max(2, Math.round((pt.effectiveBlockPct / 100) * 10));
              return (
                <View key={i} style={styles.timelineCol}>
                  <View style={[styles.timelineFill, { height: h, backgroundColor: barColor }]} />
                </View>
              );
            })}
          </View>
          <View style={[styles.exposureBracket, { width: `${Math.round(exposureFrac * 100)}%` }]} />
        </View>
      )}
    </View>
  );
};

interface AstroControlsOverlayProps {
  settings: AstroSettingsState;
  onChange: React.Dispatch<React.SetStateAction<AstroSettingsState>>;
  summary: AstroShotSummary;
  caps: AstroCameraCapabilities;
  simParams: AstroSimExposureParams;
  showPrediction: boolean;
  isSimRendering: boolean;
  onRefreshPrediction: () => void;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  language: Language;
  bottomOffset?: number;
  inline?: boolean;
}

/**
 * 천체 모드 전용 뷰파인더 조작부 (노출시간·합성방식·타이머 + ISO/셔터/RAW 접이식 트레이).
 */
export const AstroControlsOverlay: React.FC<AstroControlsOverlayProps> = ({
  settings,
  onChange,
  summary,
  caps,
  simParams,
  showPrediction,
  isSimRendering,
  onRefreshPrediction,
  drawerOpen,
  onToggleDrawer,
  language,
  bottomOffset = 0,
  inline = false,
}) => {
  const minSubSec = caps.available ? Math.max(0.5, Number((caps.minExposureMs / 1000).toFixed(1))) : 1;
  const maxSubSec = caps.available ? Math.max(1, Math.floor(caps.maxExposureMs / 1000)) : 30;
  const minIso = caps.available ? caps.minIso : 100;
  const maxIso = caps.available ? caps.maxIso : 6400;

  const cycleCountdown = () => {
    const idx = COUNTDOWN_PRESETS_SEC.indexOf(settings.countdownDelaySec);
    const next = COUNTDOWN_PRESETS_SEC[(idx + 1) % COUNTDOWN_PRESETS_SEC.length];
    onChange(s => ({ ...s, countdownDelaySec: next }));
  };

  const MIN_DUR_SEC = 60;
  const MAX_DUR_SEC = 900;
  const durationPct = Math.max(
    0,
    Math.min(100, ((settings.durationSec - MIN_DUR_SEC) / (MAX_DUR_SEC - MIN_DUR_SEC)) * 100),
  );
  const durSecFromPct = (pct: number) => {
    const raw = MIN_DUR_SEC + (Math.max(0, Math.min(100, pct)) / 100) * (MAX_DUR_SEC - MIN_DUR_SEC);
    return Math.max(MIN_DUR_SEC, Math.min(MAX_DUR_SEC, Math.round(raw / 60) * 60));
  };

  const stepManualSub = (delta: number) => {
    onChange(s => {
      const cur = s.manualSubExposureSec ?? summary.autoRecommendedSec;
      const next = Math.max(minSubSec, Math.min(maxSubSec, Number((cur + delta).toFixed(1))));
      return { ...s, manualSubExposureSec: next };
    });
  };

  return (
    <View style={inline ? styles.wrapInline : [styles.wrap, { bottom: bottomOffset }]} pointerEvents="box-none">
      {drawerOpen && (
        <View style={[styles.drawer, inline && styles.drawerInline]}>
          <View style={styles.drawerSection}>
            <Text style={styles.drawerLabel}>
              {L3(language, `ISO 감도 (${summary.clampedIso})`, `ISO (${summary.clampedIso})`, `ISO (${summary.clampedIso})`)}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {ISO_PRESETS.map(isoVal => {
                const supported = isoVal >= minIso && isoVal <= maxIso;
                const active = summary.clampedIso === isoVal;
                return (
                  <PressScale
                    key={isoVal}
                    disabled={!supported}
                    onPress={() => onChange(s => ({ ...s, iso: isoVal }))}
                    style={[styles.miniChip, active && styles.miniChipOn, !supported && styles.miniChipDisabled]}
                  >
                    <Text style={[styles.miniChipText, active && styles.miniChipTextOn]}>{isoVal}</Text>
                  </PressScale>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.drawerSection}>
            <View style={styles.drawerHeaderRow}>
              <Text style={styles.drawerLabel}>
                {L3(
                  language,
                  `1장 서브셔터 (권장 ${summary.autoRecommendedSec}s · ${summary.declinationDeg}°)`,
                  `Sub-shutter (NPF ${summary.autoRecommendedSec}s · dec ${summary.declinationDeg}°)`,
                  `サブシャッター (推奨 ${summary.autoRecommendedSec}s)`,
                )}
              </Text>
              <PressScale
                onPress={() =>
                  onChange(s => ({
                    ...s,
                    manualSubExposureSec: s.manualSubExposureSec === null ? summary.autoRecommendedSec : null,
                  }))
                }
                style={[styles.miniChip, settings.manualSubExposureSec === null && styles.miniChipOn]}
              >
                <Text style={[styles.miniChipText, settings.manualSubExposureSec === null && styles.miniChipTextOn]}>
                  {settings.manualSubExposureSec === null
                    ? L3(language, 'NPF 자동', 'Auto NPF', 'NPF自動')
                    : L3(language, '수동 전환됨', 'Manual', '手動')}
                </Text>
              </PressScale>
            </View>
            <View style={styles.stepperRow}>
              <PressScale style={styles.stepBtn} onPress={() => stepManualSub(-1)}>
                <Text style={styles.stepBtnText}>-1s</Text>
              </PressScale>
              <Text style={styles.stepperVal}>{`${summary.subExposureSecUsed}s × ${summary.totalFrames}${L3(language, '장', 'f', '枚')}`}</Text>
              <PressScale style={styles.stepBtn} onPress={() => stepManualSub(1)}>
                <Text style={styles.stepBtnText}>+1s</Text>
              </PressScale>
            </View>
          </View>

          <View style={styles.switchGrid}>
            <PressScale
              onPress={() => onChange(s => ({ ...s, preferRaw: !s.preferRaw }))}
              style={[styles.toggleChip, summary.rawActive && styles.toggleChipOn]}
            >
              <Text style={[styles.toggleText, summary.rawActive && styles.toggleTextOn]}>
                {caps.available && !caps.rawSupported
                  ? L3(language, 'RAW 미지원(YUV)', 'No RAW (YUV)', 'RAW非対応')
                  : 'RAW 16bit (PNG)'}
              </Text>
            </PressScale>
            <PressScale
              onPress={() => onChange(s => ({ ...s, rejectCloudyFrames: !s.rejectCloudyFrames }))}
              style={[styles.toggleChip, settings.rejectCloudyFrames && styles.toggleChipOn]}
            >
              <Text style={[styles.toggleText, settings.rejectCloudyFrames && styles.toggleTextOn]}>
                {L3(language, '구름 프레임 제외', 'Filter clouds', '雲フレーム除外')}
              </Text>
            </PressScale>
            <PressScale
              onPress={() => onChange(s => ({ ...s, keepFixedGround: !s.keepFixedGround }))}
              style={[styles.toggleChip, settings.keepFixedGround && styles.toggleChipOn]}
            >
              <Text style={[styles.toggleText, settings.keepFixedGround && styles.toggleTextOn]}>
                {L3(language, '지상 고정 합성', 'Fixed ground', '地上固定合成')}
              </Text>
            </PressScale>
            <PressScale
              onPress={() => onChange(s => ({ ...s, lockFocusInfinity: !s.lockFocusInfinity }))}
              style={[styles.toggleChip, settings.lockFocusInfinity && styles.toggleChipOn]}
            >
              <Text style={[styles.toggleText, settings.lockFocusInfinity && styles.toggleTextOn]}>
                {L3(language, '무한대 초점 ∞', 'Focus ∞', '無限遠 ∞')}
              </Text>
            </PressScale>
          </View>
        </View>
      )}

      <View style={styles.bar}>
        {/* 1행: 합성 방식 토글 + 시뮬 갱신 / 타이머 / ISO·세부설정 */}
        <View style={styles.barRow}>
          <View style={styles.modeSwitch}>
            {(['tracked', 'trails'] as const).map(m => {
              const active = settings.mode === m;
              return (
                <PressScale
                  key={m}
                  onPress={() =>
                    onChange(s => ({
                      ...s,
                      mode: m,
                      rejectCloudyFrames: m === 'tracked',
                      keepFixedGround: true,
                    }))
                  }
                  style={[styles.modeBtn, active && styles.modeBtnOn]}
                >
                  <Text style={[styles.modeBtnText, active && styles.modeBtnTextOn]}>
                    {m === 'tracked'
                      ? L3(language, '별 추적', 'Track', '星追尾')
                      : L3(language, '별 궤적', 'Trails', '星軌跡')}
                  </Text>
                </PressScale>
              );
            })}
          </View>

          <View style={styles.rightActions}>
            {showPrediction && (
              <PressScale
                onPress={onRefreshPrediction}
                style={[styles.actionChip, isSimRendering && { opacity: 0.6 }]}
              >
                <Text style={styles.actionChipText}>
                  {isSimRendering
                    ? L3(language, '시뮬 중…', 'Sim…', '計算中…')
                    : L3(language, '시뮬 갱신', 'Sim', '再描画')}
                </Text>
              </PressScale>
            )}
            <PressScale onPress={cycleCountdown} style={styles.actionChip}>
              <Timer size={12} color={color.accent} />
              <Text style={styles.actionChipText}>
                {settings.countdownDelaySec === 0
                  ? L3(language, '즉시', '0s', '即時')
                  : `${settings.countdownDelaySec}s`}
              </Text>
            </PressScale>
            <PressScale
              onPress={onToggleDrawer}
              style={[styles.actionChip, drawerOpen && styles.actionChipOn]}
            >
              <SlidersHorizontal size={12} color={drawerOpen ? color.accent : color.text} />
              <Text style={[styles.actionChipText, drawerOpen && { color: color.accent }]}>
                {`ISO ${summary.clampedIso}`}
              </Text>
            </PressScale>
          </View>
        </View>

        {/* 2행: 총 장노출 시간 슬라이더 (1~15분) + 셔터 분할 요약 */}
        <View style={styles.sliderRow}>
          <Text style={styles.sliderPrefix}>{L3(language, '장노출', 'Exp', '露光')}</Text>
          <View style={styles.sliderTrackWrap}>
            <ScrubTrack
              value={durationPct}
              height={34}
              trackHeight={4}
              knobTone={color.moon}
              formatLabel={(pct) => formatDurationLabel(durSecFromPct(pct), language)}
              getDisplayBucket={(pct) => durSecFromPct(pct)}
              onScrub={(pct) => {
                const nextSec = durSecFromPct(pct);
                onChange(s => (s.durationSec === nextSec ? s : { ...s, durationSec: nextSec }));
              }}
              onAdjust={(dir) =>
                onChange(s => ({
                  ...s,
                  durationSec: Math.max(MIN_DUR_SEC, Math.min(MAX_DUR_SEC, s.durationSec + dir * 60)),
                }))
              }
              accessibilityLabel={L3(language, '장노출 시간', 'Long exposure duration', '長時間露光時間')}
            >
              <View style={styles.durTrackBg}>
                <View style={[styles.durTrackFill, { width: `${durationPct}%` }]} />
              </View>
            </ScrubTrack>
          </View>
          <View style={styles.summaryBadge}>
            <Sparkles size={11} color={color.moon} />
            <Text style={styles.summaryText} numberOfLines={1}>
              {`${summary.subExposureSecUsed}s×${summary.totalFrames}${L3(language, '장', 'f', '枚')} · ${simParams.exposureGain}×`}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  forecastCard: {
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.overlay,
    gap: 5,
    maxWidth: 260,
  },
  forecastRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  riskDot: { width: 7, height: 7, borderRadius: 4 },
  forecastText: { ...type.label, color: color.text, flexShrink: 1 },
  timelineBarWrap: {
    height: 12,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  timelineSegments: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 12,
    gap: 1,
    paddingHorizontal: 1,
  },
  timelineCol: { flex: 1, justifyContent: 'flex-end', height: 12 },
  timelineFill: { width: '100%', borderRadius: 1 },
  exposureBracket: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderWidth: 1,
    borderColor: color.moon,
    backgroundColor: 'rgba(165, 180, 252, 0.14)',
    borderRadius: 3,
  },
  wrap: {
    position: 'absolute',
    left: space.md,
    right: TOUCH + space.md * 2,
    gap: space.xs,
  },
  wrapInline: {
    width: '100%',
    gap: space.xs,
  },
  drawer: {
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.overlay,
    gap: space.sm,
  },
  drawerInline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    marginBottom: space.xs,
    zIndex: 50,
  },
  drawerSection: { gap: 4 },
  drawerHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.xs },
  drawerLabel: { ...type.micro, color: color.textDim, flexShrink: 1 },
  chipRow: { flexDirection: 'row', gap: 6 },
  miniChip: {
    paddingHorizontal: 8,
    height: 26,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniChipOn: { borderColor: color.accentLine, backgroundColor: color.accentSoft },
  miniChipDisabled: { opacity: 0.35 },
  miniChipText: { ...type.micro, color: color.textDim },
  miniChipTextOn: { color: color.accent },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepBtn: {
    paddingHorizontal: 10,
    height: 26,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { ...type.micro, color: color.text },
  stepperVal: { ...type.label, color: color.text, flex: 1, textAlign: 'center' },
  switchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  toggleChip: {
    paddingHorizontal: 8,
    height: 28,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.fill,
    justifyContent: 'center',
  },
  toggleChipOn: { borderColor: color.moon, backgroundColor: 'rgba(165, 180, 252, 0.16)' },
  toggleText: { ...type.micro, color: color.textDim },
  toggleTextOn: { color: color.moon },
  bar: {
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.overlay,
    gap: 6,
  },
  barRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  modeSwitch: {
    flexDirection: 'row',
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.fill,
    padding: 2,
    gap: 2,
  },
  modeBtn: { paddingHorizontal: 8, height: 24, borderRadius: radius.xs - 2, justifyContent: 'center' },
  modeBtnOn: { backgroundColor: color.accentSoft },
  modeBtnText: { ...type.micro, color: color.textDim },
  modeBtnTextOn: { color: color.accent },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sliderPrefix: { ...type.micro, color: color.moon, fontWeight: '700' },
  sliderTrackWrap: { flex: 1, minWidth: 0 },
  durTrackBg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.borderStrong, overflow: 'hidden' },
  durTrackFill: { height: '100%', borderRadius: 2, backgroundColor: color.moon },
  summaryBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 0 },
  summaryText: { ...type.micro, color: color.textDim, flexShrink: 1 },
  rightActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    height: 26,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.fill,
  },
  actionChipOn: { borderColor: color.accentLine, backgroundColor: color.accentSoft },
  actionChipText: { ...type.micro, color: color.text },
});
