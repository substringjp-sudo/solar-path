/**
 * SandboxShootPanel.tsx — 샌드박스 "촬영" 패널.
 * 노을(사진) 노출 · 천체 장노출 미리보기 · 타임랩스 미리보기를 한곳에서 설정하고
 * 현재 시선 · 배율 · 시각 · 촬영 값 그대로 카메라로 넘깁니다.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Camera, Moon, Sparkles, Sun, Timer } from 'lucide-react-native';
import { GlassChip } from '../glass/GlassChip';
import { AstroSettingsPanel } from '../AstroCamera/AstroSettingsPanel';
import { TimelapsePanel } from '../AstroCamera/TimelapsePanel';
import { ExposureCells } from '../AstroCamera/ExposureCells';
import { TEXT } from '../../theme/glassTokens';
import { L3, type Language } from '../../utils/i18n';
import type { AstroCameraCapabilities } from '../../../modules/astro-camera';
import type { AstroSettingsState, AstroShotSummary } from '../../utils/astroCameraUi';
import type { ExposureAdvice } from '../../utils/exposureAdvice';
import type { TimelapsePlan } from '../../utils/timelapsePlan';

export type SandboxShootMode = 'photo' | 'astro' | 'timelapse';

const EV_STEPS = [-1.0, -0.5, 0, 0.5, 1.0] as const;

interface Props {
  language: Language;
  mode: SandboxShootMode;
  onModeChange: (m: SandboxShootMode) => void;
  exposure: number;
  onExposureChange: (ev: number) => void;
  expoAdvice: ExposureAdvice | null;
  lensMm: string;
  lensText: string;
  astroSettings: AstroSettingsState;
  onAstroSettingsChange: React.Dispatch<React.SetStateAction<AstroSettingsState>>;
  astroSummary: AstroShotSummary;
  astroCaps: AstroCameraCapabilities;
  isLongExpRendering: boolean;
  hasLongExpPreview: boolean;
  onPreviewLongExp: () => void;
  onClearLongExp: () => void;
  events: { sunrise: number | null; sunset: number | null };
  nowMs: number;
  tzHours: number;
  sunAltAt: (ms: number) => number;
  timelapsePlan: TimelapsePlan | null;
  onTimelapsePlanChange: (plan: TimelapsePlan) => void;
  onPreviewTimelapse: (plan: TimelapsePlan, startMs: number, endMs: number) => void;
  onGoToCamera: (overridePlan?: TimelapsePlan) => void;
  onClosePanel: () => void;
}

export const SandboxShootPanel: React.FC<Props> = ({
  language,
  mode,
  onModeChange,
  exposure,
  onExposureChange,
  expoAdvice,
  lensMm,
  lensText,
  astroSettings,
  onAstroSettingsChange,
  astroSummary,
  astroCaps,
  isLongExpRendering,
  hasLongExpPreview,
  onPreviewLongExp,
  onClearLongExp,
  events,
  nowMs,
  tzHours,
  sunAltAt,
  timelapsePlan,
  onTimelapsePlanChange,
  onPreviewTimelapse,
  onGoToCamera,
  onClosePanel,
}) => {
  return (
    <View testID="sandbox-shoot-panel" style={styles.root}>
      {/* 촬영 종류 선택 */}
      <View style={styles.modeRow}>
        <GlassChip
          testID="sb-shoot-photo"
          label={L3(language, '사진', 'Photo', '写真')}
          icon={<Sun size={12} color={TEXT} />}
          active={mode === 'photo'}
          onPress={() => onModeChange('photo')}
        />
        <GlassChip
          testID="sb-shoot-astro"
          label={L3(language, '천체', 'Astro', '天体')}
          icon={<Moon size={12} color={TEXT} />}
          active={mode === 'astro'}
          onPress={() => onModeChange('astro')}
        />
        <GlassChip
          testID="sb-shoot-timelapse"
          label={L3(language, '타임랩스', 'Timelapse', 'タイムラプス')}
          icon={<Timer size={12} color={TEXT} />}
          active={mode === 'timelapse'}
          onPress={() => onModeChange('timelapse')}
        />
      </View>

      {mode === 'photo' && (
        <View style={styles.section}>
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
            <ExposureCells language={language} advice={expoAdvice} lensMm={lensMm} lensText={lensText} />
          ) : null}
          <View style={styles.actionRow}>
            <GlassChip
              testID="sb-go-camera"
              label={L3(language, '이 설정으로 카메라 이동', 'Open Camera with Preset', 'この設定でカメラへ')}
              icon={<Camera size={13} color={TEXT} />}
              active
              onPress={() => { onClosePanel(); onGoToCamera(); }}
              style={styles.fullBtn}
            />
          </View>
        </View>
      )}

      {mode === 'astro' && (
        <View style={styles.section}>
          <AstroSettingsPanel
            settings={astroSettings}
            onChange={onAstroSettingsChange}
            summary={astroSummary}
            caps={astroCaps}
            language={language}
          />
          <View style={styles.actionRow}>
            <GlassChip
              testID="sb-astro-preview"
              label={
                isLongExpRendering
                  ? L3(language, '장노출 계산 중…', 'Rendering…', '計算中…')
                  : hasLongExpPreview
                    ? L3(language, '미리보기 닫기', 'Close Preview', 'プレビュー終了')
                    : L3(language, '장노출 미리보기', 'Long-Exp Preview', '長露光プレビュー')
              }
              icon={isLongExpRendering ? <ActivityIndicator size="small" color={TEXT} /> : <Sparkles size={13} color={TEXT} />}
              active={hasLongExpPreview}
              onPress={() => {
                if (isLongExpRendering) return;
                if (hasLongExpPreview) onClearLongExp();
                else { onClosePanel(); onPreviewLongExp(); }
              }}
              style={styles.halfBtn}
            />
            <GlassChip
              testID="sb-go-camera-astro"
              label={L3(language, '카메라로 이동', 'Open Camera', 'カメラへ')}
              icon={<Camera size={13} color={TEXT} />}
              active
              onPress={() => { onClosePanel(); onGoToCamera(); }}
              style={styles.halfBtn}
            />
          </View>
        </View>
      )}

      {mode === 'timelapse' && (
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
          onPreview={(plan, startMs, endMs) => {
            onTimelapsePlanChange(plan);
            onPreviewTimelapse(plan, startMs, endMs);
          }}
          onStart={(plan) => {
            onTimelapsePlanChange(plan);
            onGoToCamera(plan);
          }}
          startLabel={L3(language, '카메라로 이동', 'Open Camera', 'カメラへ')}
          onClose={onClosePanel}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { gap: 10 },
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  section: { gap: 10 },
  label: { color: TEXT, opacity: 0.72, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  halfBtn: { flex: 1, minHeight: 36 },
  fullBtn: { flex: 1, minHeight: 36 },
});
