/**
 * CameraLensZoomSection.tsx — 카메라 확장 패널 상단에 놓는 렌즈(기기 인식) + 배율 선택 섹션.
 * 하단 칩 줄의 줌 버튼을 없애고 확장 막대 안으로 통합할 때 사용합니다.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, Line, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { GlassChip } from '../glass/GlassChip';
import { ZoomDialPill } from '../glass/ZoomDialPill';
import { color as DARK } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';

export type LensKind = 'ultrawide' | 'wide' | 'tele' | 'supertele';

export interface LensOption {
  id: string;
  label: string;
  sub?: string;
  kind?: LensKind;
}

const ZOOM_PRESETS = [1, 1.5, 2, 3, 5] as const;

/** 물리 카메라 렌즈(초광각·광각·망원·초망원)별 경통·후드·마운트 실루엣 아이콘 */
export const MiniLensBarrelIcon: React.FC<{ active?: boolean; kind?: LensKind }> = ({
  active = false,
  kind = 'wide',
}) => {
  const stroke = active ? '#38BDF8' : '#64748B';
  const rim = active ? '#38BDF8' : '#94A3B8';
  const sw = active ? 1.35 : 1;

  if (kind === 'ultrawide') {
    return (
      <Svg width={22} height={15} viewBox="0 0 30 20">
        {/* 짧은 마운트 + 넓게 퍼지는 어안/초광각 벌브 */}
        <Rect x="21" y="6" width="5" height="8" rx="1" fill="#0F172A" stroke={stroke} strokeWidth={0.9} />
        <Path d="M8 2.5 L21 5 L21 15 L8 17.5 Z" fill="#1E293B" stroke={stroke} strokeWidth={sw} />
        <Ellipse cx="7.5" cy="10" rx="4.2" ry="7.8" fill="#090D16" stroke={rim} strokeWidth={sw} />
        <Ellipse cx="8" cy="10" rx="2.9" ry="5.6" fill="#0284C7" opacity="0.85" />
        <Ellipse cx="7" cy="7.6" rx="1.1" ry="2.1" fill="#FFFFFF" opacity="0.65" />
      </Svg>
    );
  }

  if (kind === 'tele') {
    return (
      <Svg width={22} height={15} viewBox="0 0 30 20">
        {/* 긴 망원 경통 + 듀얼 그립 링 */}
        <Rect x="23" y="6" width="4.5" height="8" rx="0.8" fill="#0F172A" stroke={stroke} strokeWidth={0.9} />
        <Rect x="6" y="4.5" width="17" height="11" rx="1.1" fill="#1E293B" stroke={stroke} strokeWidth={sw} />
        <Line x1="12" y1="4.8" x2="12" y2="15.2" stroke={stroke} strokeWidth={0.9} />
        <Line x1="17" y1="4.8" x2="17" y2="15.2" stroke={stroke} strokeWidth={0.9} />
        <Ellipse cx="5.8" cy="10" rx="2.6" ry="5.8" fill="#090D16" stroke={rim} strokeWidth={sw} />
        <Ellipse cx="6.2" cy="10" rx="1.6" ry="3.8" fill="#D97706" opacity="0.85" />
        <Ellipse cx="5.5" cy="8.4" rx="0.65" ry="1.4" fill="#FFFFFF" opacity="0.6" />
      </Svg>
    );
  }

  if (kind === 'supertele') {
    return (
      <Svg width={22} height={15} viewBox="0 0 30 20">
        {/* 초망원: 깊은 후드 + 긴 화이트/슬레이트 경통 + 삼각대 칼라 풋 */}
        <Rect x="24.5" y="6.5" width="4" height="7" rx="0.8" fill="#0F172A" stroke={stroke} strokeWidth={0.9} />
        <Rect x="8" y="4.5" width="16.5" height="11" rx="1" fill="#334155" stroke={stroke} strokeWidth={sw} />
        <Rect x="16" y="15.5" width="4.5" height="2.4" rx="0.6" fill="#0F172A" stroke={stroke} strokeWidth={0.85} />
        <Path d="M2.5 3.5 L8 4.6 L8 15.4 L2.5 16.5 Z" fill="#0F172A" stroke={rim} strokeWidth={sw} />
        <Line x1="14" y1="4.8" x2="14" y2="15.2" stroke={rim} strokeWidth={0.9} />
        <Ellipse cx="3.2" cy="10" rx="1.8" ry="5.6" fill="#090D16" stroke={rim} strokeWidth={0.9} />
        <Ellipse cx="3.5" cy="10" rx="1.1" ry="3.6" fill="#F59E0B" opacity="0.88" />
      </Svg>
    );
  }

  return (
    <Svg width={22} height={15} viewBox="0 0 30 20">
      {/* 표준 광각: 균형 잡힌 단렌즈/표준 경통 */}
      <Rect x="20" y="6" width="5" height="8" rx="0.8" fill="#0F172A" stroke={stroke} strokeWidth={0.9} />
      <Rect x="8" y="4" width="12" height="12" rx="1" fill="#1E293B" stroke={stroke} strokeWidth={sw} />
      <Ellipse cx="8" cy="10" rx="3.1" ry="6.4" fill="#090D16" stroke={rim} strokeWidth={sw} />
      <Ellipse cx="8.5" cy="10" rx="2.0" ry="4.4" fill="#D97706" opacity="0.85" />
      <Ellipse cx="7.7" cy="8.2" rx="0.75" ry="1.7" fill="#FFFFFF" opacity="0.6" />
    </Svg>
  );
};

/** 확장 광학 가방(3/4 입체 원형 필터 링) 미니 아이콘 */
export const MiniFilterRingIcon: React.FC<{ active?: boolean }> = ({ active = false }) => (
  <Svg width={16} height={16} viewBox="0 0 20 20">
    <Defs>
      <LinearGradient id="mini_flt_g" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0%" stopColor="#0284C7" />
        <Stop offset="55%" stopColor="#0D9488" />
        <Stop offset="100%" stopColor="#F59E0B" />
      </LinearGradient>
    </Defs>
    <Ellipse
      cx="8.8"
      cy="10"
      rx="6.6"
      ry="8.2"
      fill="#1E293B"
      stroke={active ? '#38BDF8' : '#64748B'}
      strokeWidth={active ? 1.4 : 1}
    />
    <Ellipse
      cx="10.8"
      cy="10"
      rx="6.6"
      ry="8.2"
      fill="#0F172A"
      stroke={active ? '#38BDF8' : '#94A3B8'}
      strokeWidth={active ? 1.5 : 1.1}
    />
    <Ellipse cx="11.1" cy="10" rx="5.0" ry="6.4" fill="url(#mini_flt_g)" />
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
                    icon={<MiniLensBarrelIcon active={isSel} kind={lens.kind} />}
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
