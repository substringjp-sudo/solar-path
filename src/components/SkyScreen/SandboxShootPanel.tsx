/**
 * SandboxShootPanel.tsx — 샌드박스 "촬영" 패널.
 * 상단 고정 탭 바(노을 · 천체 · 타임랩스) 아래에서 각 촬영 설정이 독립 스크롤됩니다.
 * 실제 카메라 진입은 하단 메인 셔터가 담당하므로 패널 안 중복 버튼은 두지 않습니다.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Moon, Sun, Timer } from 'lucide-react-native';
import { GlassChip } from '../glass/GlassChip';
import { AstroSettingsPanel } from '../AstroCamera/AstroSettingsPanel';
import { AstroForecastBanner } from '../AstroCamera/AstroForecastBanner';
import { TimelapsePanel } from '../AstroCamera/TimelapsePanel';
import { ExposureCells } from '../AstroCamera/ExposureCells';
import { GLASS, TEXT } from '../../theme/glassTokens';
import { color as DARK } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';
import type { AstroCameraCapabilities } from '../../../modules/astro-camera';
import type { AstroWindowAnalysis } from '../../utils/astroForecast';
import type { AstroSettingsState, AstroShotSummary } from '../../utils/astroCameraUi';
import type { ExposureAdvice, PhotoWbPreset } from '../../utils/exposureAdvice';
import type { TimelapsePlan } from '../../utils/timelapsePlan';

export type SandboxShootMode = 'photo' | 'astro' | 'timelapse';

const EV_STEPS = [-1.0, -0.5, 0, 0.5, 1.0] as const;
const LENS_ZOOM_PRESETS = [0.6, 1, 2, 3, 5, 10] as const;

interface Props {
  language: Language;
  mode: SandboxShootMode;
  onModeChange: (m: SandboxShootMode) => void;
  exposure: number;
  onExposureChange: (ev: number) => void;
  teleX?: number;
  onChangeTeleX?: (x: number) => void;
  manualIso?: number | null;
  manualShutterS?: number | null;
  manualWb?: PhotoWbPreset | null;
  onChangeIso?: (iso: number | null) => void;
  onChangeShutter?: (shutterS: number | null) => void;
  onChangeWb?: (wb: PhotoWbPreset | null) => void;
  expoAdvice: ExposureAdvice | null;
  lensMm: string;
  lensText: string;
  astroSettings: AstroSettingsState;
  onAstroSettingsChange: React.Dispatch<React.SetStateAction<AstroSettingsState>>;
  astroSummary: AstroShotSummary;
  astroCaps: AstroCameraCapabilities;
  astroAnalysis: AstroWindowAnalysis | null;
  events: { sunrise: number | null; sunset: number | null };
  nowMs: number;
  tzHours: number;
  sunAltAt: (ms: number) => number;
  timelapsePlan: TimelapsePlan | null;
  onTimelapsePlanChange: (plan: TimelapsePlan) => void;
}

export const SandboxShootPanel: React.FC<Props> = ({
  language,
  mode,
  onModeChange,
  exposure,
  onExposureChange,
  teleX = 1,
  onChangeTeleX,
  manualIso = null,
  manualShutterS = null,
  manualWb = null,
  onChangeIso,
  onChangeShutter,
  onChangeWb,
  expoAdvice,
  lensMm,
  lensText,
  astroSettings,
  onAstroSettingsChange,
  astroSummary,
  astroCaps,
  astroAnalysis,
  events,
  nowMs,
  tzHours,
  sunAltAt,
  timelapsePlan,
  onTimelapsePlanChange,
}) => {
  const tabs: Array<{ key: SandboxShootMode; label: string; icon: React.ReactNode }> = [
    { key: 'photo', label: L3(language, '일반', 'Normal', '通常'), icon: <Sun size={13} color={mode === 'photo' ? DARK.accent : TEXT} /> },
    { key: 'astro', label: L3(language, '천체', 'Astro', '天体'), icon: <Moon size={13} color={mode === 'astro' ? DARK.accent : TEXT} /> },
    { key: 'timelapse', label: L3(language, '타임랩스', 'Timelapse', 'タイムラプス'), icon: <Timer size={13} color={mode === 'timelapse' ? DARK.accent : TEXT} /> },
  ];

  return (
    <View testID="sandbox-shoot-panel" style={styles.root}>
      {/* 고정 세그먼트 탭 바 (스크롤되지 않음) */}
      <View style={styles.tabBar} accessibilityRole="tablist">
        {tabs.map(tab => {
          const active = mode === tab.key;
          return (
            <Pressable
              key={tab.key}
              testID={`sb-shoot-${tab.key}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onModeChange(tab.key)}
              style={[styles.tabItem, active && styles.tabItemActive]}
            >
              {tab.icon}
              <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
                {tab.label}
              </Text>
              {active && <View style={styles.tabIndicator} />}
            </Pressable>
          );
        })}
      </View>

      {/* 탭 본문 (내부 스크롤) */}
      <ScrollView
        style={styles.bodyScroll}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {mode === 'photo' && (
          <View style={styles.section}>
            {onChangeTeleX && (
              <>
                <Text style={styles.label}>{L3(language, '렌즈 · 배율', 'LENS · ZOOM', 'レンズ · 倍率')}</Text>
                <View style={styles.chipRow}>
                  {LENS_ZOOM_PRESETS.map(z => (
                    <GlassChip
                      key={z}
                      label={`${z}x`}
                      mono
                      active={Math.abs(teleX - z) < 0.08}
                      onPress={() => onChangeTeleX(z)}
                    />
                  ))}
                </View>
              </>
            )}
            <Text style={styles.label}>{L3(language, '노출 보정 (EV)', 'EXPOSURE (EV)', '露出補正 (EV)')}</Text>
            <View style={styles.chipRow}>
              {EV_STEPS.map(ev => (
                <GlassChip
                  key={ev}
                  label={ev === 0 ? '0' : `${ev > 0 ? '+' : ''}${ev.toFixed(1)}`}
                  mono
                  active={Math.abs(exposure - ev) < 0.05}
                  onPress={() => onExposureChange(ev)}
                />
              ))}
            </View>
            {expoAdvice ? (
              <ExposureCells
                language={language}
                advice={expoAdvice}
                lensMm={lensMm}
                lensText={lensText}
                manualIso={manualIso}
                manualShutterS={manualShutterS}
                manualWb={manualWb}
                onChangeIso={onChangeIso}
                onChangeShutter={onChangeShutter}
                onChangeWb={onChangeWb}
              />
            ) : null}
          </View>
        )}

        {mode === 'astro' && (
          <View style={styles.section}>
            <AstroForecastBanner
              analysis={astroAnalysis}
              durationSec={astroSettings.durationSec}
              language={language}
            />
            <AstroSettingsPanel
              settings={astroSettings}
              onChange={onAstroSettingsChange}
              summary={astroSummary}
              caps={astroCaps}
              language={language}
            />
          </View>
        )}

        {mode === 'timelapse' && (
          <View style={styles.section}>
            {(timelapsePlan?.kind ?? 'plain') !== 'plain' && (
              <AstroForecastBanner
                analysis={astroAnalysis}
                durationSec={(timelapsePlan?.totalMin ?? 60) * 60}
                language={language}
              />
            )}
            <TimelapsePanel
              inline
              visible
              language={language}
              events={events}
              nowMs={nowMs}
              tzHours={tzHours}
              sunAltAt={sunAltAt}
              initialPlan={timelapsePlan}
              onPlanChange={onTimelapsePlanChange}
              onClose={() => {}}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { maxHeight: '100%' },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 8,
    paddingTop: 4,
    gap: 4,
  },
  tabItem: {
    flex: 1,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    position: 'relative',
  },
  tabItemActive: {
    backgroundColor: `rgba(${GLASS.tintRGB.join(', ')}, ${GLASS.tintAlpha * 0.7})`,
  },
  tabText: {
    color: TEXT,
    opacity: 0.72,
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    opacity: 1,
    color: TEXT,
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 16,
    right: 16,
    height: 2,
    borderRadius: 1,
    backgroundColor: DARK.accent,
  },
  bodyScroll: { flexGrow: 0 },
  bodyContent: { padding: 12, gap: 10 },
  section: { gap: 10 },
  label: { color: TEXT, opacity: 0.72, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
