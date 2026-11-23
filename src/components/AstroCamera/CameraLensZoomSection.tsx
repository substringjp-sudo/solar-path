/**
 * CameraLensZoomSection.tsx — 카메라 확장 패널 상단에 놓는 렌즈(기기 인식) + 배율 선택 섹션.
 * 하단 칩 줄의 줌 버튼을 없애고 확장 막대 안으로 통합할 때 사용합니다.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, RadialGradient, Stop } from 'react-native-svg';
import { GlassChip } from '../glass/GlassChip';
import { ZoomDialPill } from '../glass/ZoomDialPill';
import { color as DARK } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';

export interface LensOption {
  id: string;
  label: string;
  sub?: string;
}

const ZOOM_PRESETS = [1, 1.5, 2, 3, 5] as const;

/** 물리 카메라 렌즈(초광각·광각·망원) 미니 대물렌즈 아이콘 */
const MiniLensBarrelIcon: React.FC<{ active?: boolean }> = ({ active = false }) => (
  <Svg width={16} height={16} viewBox="0 0 20 20">
    <Defs>
      <RadialGradient id="mini_lens_g" cx="35%" cy="32%" r="65%">
        <Stop offset="0%" stopColor="#38BDF8" stopOpacity="0.8" />
        <Stop offset="55%" stopColor="#0F172A" />
        <Stop offset="100%" stopColor="#020617" />
      </RadialGradient>
    </Defs>
    <Circle
      cx="10"
      cy="10"
      r="8.8"
      fill="#1E293B"
      stroke={active ? '#38BDF8' : '#64748B'}
      strokeWidth={active ? 1.8 : 1.2}
    />
    <Circle cx="10" cy="10" r="6.2" fill="url(#mini_lens_g)" />
    <Ellipse cx="8" cy="7.6" rx="2.1" ry="0.9" transform="rotate(-30 8 7.6)" fill="#FFFFFF" opacity="0.55" />
  </Svg>
);

/** 확장 광학 가방(원형 그라데이션 필터) 미니 아이콘 */
const MiniFilterRingIcon: React.FC<{ active?: boolean }> = ({ active = false }) => (
  <Svg width={16} height={16} viewBox="0 0 20 20">
    <Defs>
      <LinearGradient id="mini_flt_g" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0%" stopColor="#F59E0B" />
        <Stop offset="50%" stopColor="#0284C7" />
        <Stop offset="100%" stopColor="#1E1B4B" />
      </LinearGradient>
    </Defs>
    <Circle
      cx="10"
      cy="10"
      r="8.8"
      fill="#0F172A"
      stroke={active ? '#38BDF8' : '#94A3B8'}
      strokeWidth={active ? 1.8 : 1.2}
    />
    <Circle cx="10" cy="10" r="6.4" fill="url(#mini_flt_g)" />
    <Ellipse cx="7.8" cy="7.5" rx="2.2" ry="0.95" transform="rotate(-30 7.8 7.5)" fill="#FFFFFF" opacity="0.5" />
  </Svg>
);

interface Props {
  language: Language;
  lenses: readonly LensOption[];
  selectedLensId: string | null;
  onSelectLens: (id: string) => void;
  magnification: number;
  maxMag?: number;
  onChangeMagnification: (mag: number) => void;
  onOpenCameraBag?: () => void;
  gearActive?: boolean;
  gearBadge?: string;
}

export const CameraLensZoomSection: React.FC<Props> = ({
  language,
  lenses,
  selectedLensId,
  onSelectLens,
  magnification,
  maxMag = 5,
  onChangeMagnification,
  onOpenCameraBag,
  gearActive = false,
  gearBadge,
}) => {
  const presets = maxMag >= 10
    ? [1, 2, 3, 5, 10]
    : maxMag >= 7
      ? [1, 2, 3, 5, Math.floor(maxMag)]
      : ZOOM_PRESETS.filter(z => z <= maxMag + 0.05);
  return (
    <View style={styles.root}>
      {(lenses.length > 0 || onOpenCameraBag) && (
        <View style={styles.block}>
          <View style={styles.headerRow}>
            <Text style={styles.label}>
              {lenses.length > 0
                ? `${L3(language, '카메라 렌즈', 'CAMERA LENS', 'カメラレンズ')} (${lenses.length})`
                : L3(language, '확장 광학', 'OPTICAL GEAR', '拡張光学')}
            </Text>
            {onOpenCameraBag && (
              <GlassChip
                testID="open-gear-bag-chip"
                icon={<MiniFilterRingIcon active={gearActive} />}
                label={gearBadge
                  ? `${L3(language, '광학 가방', 'Gear Bag', '光学バッグ')} · ${gearBadge}`
                  : L3(language, '광학 렌즈·필터 ▾', 'Optical Gear ▾', '光学レンズ・フィルター ▾')}
                active={gearActive}
                onPress={onOpenCameraBag}
              />
            )}
          </View>
          {lenses.length > 0 && (
            <View style={styles.row}>
              {lenses.map(lens => {
                const isSel = selectedLensId === lens.id;
                return (
                  <GlassChip
                    key={lens.id}
                    testID={`lens-${lens.id}`}
                    icon={<MiniLensBarrelIcon active={isSel} />}
                    label={lens.sub ? `${lens.label} · ${lens.sub}` : lens.label}
                    mono
                    active={isSel}
                    onPress={() => onSelectLens(lens.id)}
                  />
                );
              })}
            </View>
          )}
        </View>
      )}
      <View style={styles.block}>
        <Text style={styles.label}>{L3(language, '배율', 'ZOOM', '倍率')}</Text>
        <View style={styles.row}>
          <ZoomDialPill
            magnification={magnification}
            maxMag={maxMag}
            onChange={onChangeMagnification}
            language={language}
          />
          {presets.map(z => (
            <GlassChip
              key={z}
              testID={`zoom-preset-${z}`}
              label={`${z}×`}
              mono
              active={Math.abs(magnification - z) < 0.12}
              onPress={() => onChangeMagnification(z)}
            />
          ))}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    gap: 10,
    marginBottom: 12,
  },
  block: {
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.7,
    color: DARK.textMute,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
});
