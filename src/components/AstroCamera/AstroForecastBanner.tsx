/**
 * AstroForecastBanner.tsx — 천체 탭의 **야간 구름 예보 한 줄 + 얇은 막대**(유리, 2026-11-21 카메라 새 틀).
 * 30분 앞당김 타임라인 속 선택 노출 구간의 구름 방해 여부를 보입니다. 예전에는 `AstroControlsOverlay.tsx` 안에 있었습니다.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CloudAlert } from 'lucide-react-native';
import { color, radius, space } from '../../theme/tokens';
import { TEXT } from '../../theme/glassTokens';
import { GlassSurface, glassTextShadow } from '../glass/GlassSurface';
import { L3, type Language } from '../../utils/i18n';
import type { AstroWindowAnalysis } from '../../utils/astroForecast';

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
      <GlassSurface style={styles.forecastCard}>
        <View style={styles.forecastRow}>
          <CloudAlert size={13} color={color.moon} />
          <Text style={styles.forecastText}>
            {L3(language, '야간 구름 예보 계산 중…', 'Analyzing night cloud window…', '夜間雲予報を計算中…')}
          </Text>
        </View>
      </GlassSurface>
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
    <GlassSurface style={styles.forecastCard}>
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
    </GlassSurface>
  );
};


const styles = StyleSheet.create({
  forecastCard: { paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.md, gap: 5, maxWidth: 260 },
  forecastRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  riskDot: { width: 7, height: 7, borderRadius: 4 },
  forecastText: { fontSize: 11, fontWeight: '700', color: TEXT, flexShrink: 1, ...glassTextShadow },
  timelineBarWrap: { height: 12, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', justifyContent: 'flex-end' },
  timelineSegments: { flexDirection: 'row', alignItems: 'flex-end', height: 12, gap: 1, paddingHorizontal: 1 },
  timelineCol: { flex: 1, justifyContent: 'flex-end', height: 12 },
  timelineFill: { width: '100%', borderRadius: 1 },
  exposureBracket: { position: 'absolute', left: 0, top: 0, bottom: 0, borderWidth: 1, borderColor: color.moon, backgroundColor: 'rgba(165, 180, 252, 0.14)', borderRadius: 3 },
});
