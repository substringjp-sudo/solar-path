/**
 * AstroSettingsPanel.tsx — 천체 탭의 **설정 패널**(docs/SANDBOX_MODE_PLAN.md 23절). 카메라 새 틀(`CameraFrame`)의 칩 "천체 설정" 이 펼치는 유리 패널 안 내용입니다.
 * 예전 `AstroControlsOverlay`(접힌 칩 + 서랍 + 슬라이더)를 대신합니다: 합성 방식 · 총 노출(칩) · ISO · 서브셔터 · 타이머 · 네 가지 켜고 끄기를 모두 유리 칩으로.
 * 값을 바꾸는 규칙은 예전과 같습니다(합성 방식을 바꾸면 구름 프레임 제외는 "별 추적"일 때만, 지상 고정은 켬). 계산은 `utils/astroCameraUi.ts`.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GlassChip } from '../glass/GlassChip';
import { glassTextShadow } from '../glass/GlassSurface';
import { TEXT } from '../../theme/glassTokens';
import { mono } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';
import type { AstroCameraCapabilities } from '../../../modules/astro-camera';
import {
  ASTRO_DURATION_CHIPS_SEC,
  ISO_PRESETS,
  countdownLabel,
  formatDurationLabel,
  nearestDurationChip,
  nextCountdown,
  type AstroSettingsState,
  type AstroShotSummary,
} from '../../utils/astroCameraUi';

interface Props {
  settings: AstroSettingsState;
  onChange: React.Dispatch<React.SetStateAction<AstroSettingsState>>;
  summary: AstroShotSummary;
  caps: AstroCameraCapabilities;
  language: Language;
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <View style={styles.section}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.chips}>{children}</View>
  </View>
);

export const AstroSettingsPanel: React.FC<Props> = ({ settings, onChange, summary, caps, language }) => {
  const minSubSec = caps.available ? Math.max(0.5, Number((caps.minExposureMs / 1000).toFixed(1))) : 1;
  const maxSubSec = caps.available ? Math.max(1, Math.floor(caps.maxExposureMs / 1000)) : 30;
  const minIso = caps.available ? caps.minIso : 100;
  const maxIso = caps.available ? caps.maxIso : 6400;
  const lang = language as 'ko' | 'en' | 'ja';
  const stepManualSub = (delta: number) => {
    onChange(s => {
      const cur = s.manualSubExposureSec ?? summary.autoRecommendedSec;
      const next = Math.max(minSubSec, Math.min(maxSubSec, Number((cur + delta).toFixed(1))));
      return { ...s, manualSubExposureSec: next };
    });
  };
  const nearest = nearestDurationChip(settings.durationSec);
  const auto = settings.manualSubExposureSec === null;
  const toggle = (key: 'rejectCloudyFrames' | 'keepFixedGround' | 'lockFocusInfinity') => onChange(s => ({ ...s, [key]: !s[key] }));

  return (
    <View testID="astro-panel" style={styles.root}>
      <Row label={L3(language, '합성 방식', 'Stack mode', '合成方式')}>
        {(['trails', 'tracked'] as const).map(m => (
          <GlassChip
            key={m}
            testID={`astro-mode-${m}`}
            label={m === 'tracked' ? L3(language, '별 추적', 'Track', '星追尾') : L3(language, '별 궤적', 'Trails', '星軌跡')}
            active={settings.mode === m}
            onPress={() => onChange(s => ({ ...s, mode: m, rejectCloudyFrames: m === 'tracked', keepFixedGround: true }))}
          />
        ))}
      </Row>
      <Row label={L3(language, '총 노출', 'Total exposure', '総露光')}>
        {ASTRO_DURATION_CHIPS_SEC.map(sec => (
          <GlassChip
            key={sec}
            testID={`astro-dur-${sec}`}
            label={formatDurationLabel(sec, lang)}
            mono
            active={nearest === sec}
            onPress={() => onChange(s => (s.durationSec === sec ? s : { ...s, durationSec: sec }))}
          />
        ))}
      </Row>
      <Row label={`ISO (${summary.clampedIso})`}>
        {ISO_PRESETS.map(iso => {
          const supported = iso >= minIso && iso <= maxIso;
          return (
            <View key={iso} style={!supported && styles.off} pointerEvents={supported ? 'auto' : 'none'}>
              <GlassChip testID={`astro-iso-${iso}`} label={String(iso)} mono active={summary.clampedIso === iso} onPress={supported ? () => onChange(s => ({ ...s, iso })) : undefined} />
            </View>
          );
        })}
      </Row>
      <Row label={L3(language, `서브셔터 (권장 ${summary.autoRecommendedSec}s · ${summary.declinationDeg}°)`, `Sub-shutter (NPF ${summary.autoRecommendedSec}s · dec ${summary.declinationDeg}°)`, `サブシャッター (推奨 ${summary.autoRecommendedSec}s)`)}>
        <GlassChip testID="astro-sub-auto" label={auto ? L3(language, 'NPF 자동', 'Auto NPF', 'NPF自動') : L3(language, '수동', 'Manual', '手動')} active={auto} onPress={() => onChange(s => ({ ...s, manualSubExposureSec: s.manualSubExposureSec === null ? summary.autoRecommendedSec : null }))} />
        <GlassChip testID="astro-sub-minus" label="−1s" mono onPress={() => stepManualSub(-1)} />
        <Text testID="astro-sub-value" style={styles.value}>{`${summary.subExposureSecUsed}s × ${summary.totalFrames}${L3(language, '장', 'f', '枚')}`}</Text>
        <GlassChip testID="astro-sub-plus" label="+1s" mono onPress={() => stepManualSub(1)} />
      </Row>
      <Row label={L3(language, '타이머 · 옵션', 'Timer · options', 'タイマー・設定')}>
        <GlassChip testID="astro-timer" label={countdownLabel(settings.countdownDelaySec, lang)} mono onPress={() => onChange(s => ({ ...s, countdownDelaySec: nextCountdown(s.countdownDelaySec) }))} accessibilityLabel={L3(language, '촬영 전 타이머', 'Countdown timer', '撮影前タイマー')} />
        <GlassChip testID="astro-raw" label={caps.available && !caps.rawSupported ? L3(language, 'RAW 미지원(YUV)', 'No RAW (YUV)', 'RAW非対応') : 'RAW 16bit'} active={summary.rawActive} onPress={() => onChange(s => ({ ...s, preferRaw: !s.preferRaw }))} />
        <GlassChip testID="astro-clouds" label={L3(language, '구름 프레임 제외', 'Filter clouds', '雲フレーム除外')} active={settings.rejectCloudyFrames} onPress={() => toggle('rejectCloudyFrames')} />
        <GlassChip testID="astro-ground" label={L3(language, '지상 고정 합성', 'Fixed ground', '地上固定合成')} active={settings.keepFixedGround} onPress={() => toggle('keepFixedGround')} />
        <GlassChip testID="astro-focus" label={L3(language, '무한대 초점 ∞', 'Focus ∞', '無限遠 ∞')} active={settings.lockFocusInfinity} onPress={() => toggle('lockFocusInfinity')} />
      </Row>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { gap: 10 },
  section: { gap: 6 },
  label: { fontFamily: mono, fontSize: 11, color: TEXT, ...glassTextShadow },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  value: { fontFamily: mono, fontSize: 12, color: TEXT, paddingHorizontal: 4, ...glassTextShadow },
  off: { opacity: 0.4 },
});
