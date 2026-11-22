/**
 * CameraLensZoomSection.tsx — 카메라 확장 패널 상단에 놓는 렌즈(기기 인식) + 배율 선택 섹션.
 * 하단 칩 줄의 줌 버튼을 없애고 확장 막대 안으로 통합할 때 사용합니다.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
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

interface Props {
  language: Language;
  lenses: readonly LensOption[];
  selectedLensId: string | null;
  onSelectLens: (id: string) => void;
  magnification: number;
  onChangeMagnification: (mag: number) => void;
}

export const CameraLensZoomSection: React.FC<Props> = ({
  language,
  lenses,
  selectedLensId,
  onSelectLens,
  magnification,
  onChangeMagnification,
}) => {
  return (
    <View style={styles.root}>
      {lenses.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.label}>
            {`${L3(language, '카메라 렌즈', 'CAMERA LENS', 'カメラレンズ')} (${lenses.length})`}
          </Text>
          <View style={styles.row}>
            {lenses.map(lens => (
              <GlassChip
                key={lens.id}
                testID={`lens-${lens.id}`}
                label={lens.sub ? `${lens.label} · ${lens.sub}` : lens.label}
                mono
                active={selectedLensId === lens.id}
                onPress={() => onSelectLens(lens.id)}
              />
            ))}
          </View>
        </View>
      )}
      <View style={styles.block}>
        <Text style={styles.label}>{L3(language, '배율', 'ZOOM', '倍率')}</Text>
        <View style={styles.row}>
          <ZoomDialPill
            magnification={magnification}
            onChange={onChangeMagnification}
            language={language}
          />
          {ZOOM_PRESETS.map(z => (
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
