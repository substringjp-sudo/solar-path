/**
 * LayerControlModal.tsx
 *
 * 3D 시뮬레이션 뷰의 천체 및 환경 레이어(해, 달, 별, 은하수, 행성, 구름, 궤적/그림자)를
 * 각각 ON/OFF 선택하고, 별의 밝기·한계등급을 조절하는 팝업 컴포넌트.
 */
import React from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity } from 'react-native';
import { LayerState, SkySettings } from '../SkyScene3D/SkyScene3D';
import { GenericSlider } from '../GenericSlider';
import { Sun, Moon, Sparkles, Star, Cloud, Navigation, X, Milestone } from 'lucide-react-native';

interface LayerControlModalProps {
  visible: boolean;
  onClose: () => void;
  layers: LayerState;
  onToggleLayer: (key: keyof LayerState) => void;
  skySettings: SkySettings;
  onChangeSkySettings: (next: Partial<SkySettings>) => void;
  theme: any;
}

/** 한계등급 슬라이더 범위 — 3등급(도심)부터 6.5등급(암천)까지 */
const MAG_MIN = 3.0;
const MAG_MAX = 6.5;
/** 밝기 배율 범위 */
const BRIGHT_MIN = 0.2;
const BRIGHT_MAX = 2.0;

/** 한계등급을 사용자가 알아볼 수 있는 하늘 상태로 옮깁니다 (Bortle 척도 근사) */
function skyQualityLabel(mag: number): string {
  if (mag < 3.6) return '도심 한복판';
  if (mag < 4.4) return '도시 외곽';
  if (mag < 5.2) return '교외';
  if (mag < 6.0) return '시골';
  return '완전한 암천';
}

export const LayerControlModal: React.FC<LayerControlModalProps> = ({
  visible,
  onClose,
  layers,
  onToggleLayer,
  skySettings,
  onChangeSkySettings,
  theme,
}) => {
  const layerItems: { key: keyof LayerState; label: string; icon: any }[] = [
    { key: 'sun', label: '태양 (Sun)', icon: <Sun size={18} color="#eab308" /> },
    { key: 'moon', label: '달 (Moon)', icon: <Moon size={18} color="#38bdf8" /> },
    { key: 'stars', label: '별 (Stars)', icon: <Sparkles size={18} color="#a78bfa" /> },
    { key: 'milkyway', label: '은하수 (Milky Way)', icon: <Milestone size={18} color="#c4b5fd" /> },
    { key: 'planets', label: '행성 (Planets)', icon: <Star size={18} color="#f43f5e" /> },
    { key: 'clouds', label: '구름 (Clouds)', icon: <Cloud size={18} color="#94a3b8" /> },
    { key: 'paths', label: '궤적 & 그림자 (Paths)', icon: <Navigation size={18} color="#22c55e" /> },
  ];

  // GenericSlider는 0~100을 다루므로 실제 단위와 서로 변환합니다.
  const brightnessPct =
    ((skySettings.starBrightness - BRIGHT_MIN) / (BRIGHT_MAX - BRIGHT_MIN)) * 100;
  const magPct = ((skySettings.starMagLimit - MAG_MIN) / (MAG_MAX - MAG_MIN)) * 100;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={[styles.modalContainer, { backgroundColor: theme.cardBackground || '#0f172a', borderColor: theme.border }]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>3D 레이어 제어</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={18} color={theme.subText} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.subTitle, { color: theme.subText }]}>
            화면에 표시할 천체 및 요소 레이어를 토글하세요.
          </Text>

          <View style={styles.list}>
            {layerItems.map((item) => {
              const isOn = layers[item.key];
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    styles.layerRow,
                    { borderColor: theme.border },
                    isOn && { backgroundColor: 'rgba(59, 130, 246, 0.15)', borderColor: '#3b82f6' },
                  ]}
                  onPress={() => onToggleLayer(item.key)}
                  activeOpacity={0.7}
                >
                  <View style={styles.rowLeft}>
                    {item.icon}
                    <Text style={[styles.layerLabel, { color: theme.text }]}>{item.label}</Text>
                  </View>
                  <View style={[styles.togglePill, isOn ? styles.toggleOn : styles.toggleOff]}>
                    <Text style={[styles.toggleText, { color: isOn ? '#fff' : '#64748b' }]}>
                      {isOn ? 'ON' : 'OFF'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* 별 표현 조절 — ON/OFF가 아닌 연속값이라 슬라이더로 둡니다 */}
          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <View style={styles.sliderBlock}>
            <View style={styles.sliderHeader}>
              <Text style={[styles.sliderLabel, { color: theme.text }]}>별 밝기</Text>
              <Text style={[styles.sliderValue, { color: theme.subText }]}>
                ×{skySettings.starBrightness.toFixed(2)}
              </Text>
            </View>
            <GenericSlider
              value={Math.max(0, Math.min(100, brightnessPct))}
              onChange={(p: number) =>
                onChangeSkySettings({
                  starBrightness: BRIGHT_MIN + (p / 100) * (BRIGHT_MAX - BRIGHT_MIN),
                })
              }
              theme={theme}
              fillColor="#a78bfa"
              knobColor="#ede9fe"
            />
          </View>

          <View style={styles.sliderBlock}>
            <View style={styles.sliderHeader}>
              <Text style={[styles.sliderLabel, { color: theme.text }]}>한계 등급</Text>
              <Text style={[styles.sliderValue, { color: theme.subText }]}>
                {skySettings.starMagLimit.toFixed(1)}등급 · {skyQualityLabel(skySettings.starMagLimit)}
              </Text>
            </View>
            <GenericSlider
              value={Math.max(0, Math.min(100, magPct))}
              onChange={(p: number) =>
                onChangeSkySettings({
                  starMagLimit: MAG_MIN + (p / 100) * (MAG_MAX - MAG_MIN),
                })
              }
              theme={theme}
              fillColor="#38bdf8"
              knobColor="#e0f2fe"
            />
            <Text style={[styles.sliderHint, { color: theme.subText }]}>
              6.5등급이면 맨눈으로 볼 수 있는 8,355개 항성이 모두 표시됩니다.
            </Text>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
  },
  closeBtn: {
    padding: 4,
  },
  subTitle: {
    fontSize: 12,
    marginTop: 4,
    marginBottom: 14,
  },
  list: {
    gap: 8,
  },
  layerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  layerLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  togglePill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  toggleOn: {
    backgroundColor: '#3b82f6',
  },
  toggleOff: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  toggleText: {
    fontSize: 10,
    fontWeight: '800',
  },
  divider: {
    height: 1,
    marginTop: 16,
    marginBottom: 4,
    opacity: 0.5,
  },
  sliderBlock: {
    marginTop: 8,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  sliderLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  sliderValue: {
    fontSize: 11,
    fontWeight: '600',
  },
  sliderHint: {
    fontSize: 10,
    lineHeight: 14,
    paddingHorizontal: 2,
  },
});
