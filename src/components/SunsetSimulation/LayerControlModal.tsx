/**
 * LayerControlModal.tsx
 *
 * 3D 시뮬레이션 뷰의 천체 및 환경 레이어(해, 달, 별, 은하수, 행성, 구름, 궤적/그림자)를
 * 각각 ON/OFF 선택하고, 별의 밝기·한계등급을 조절하는 팝업 컴포넌트.
 */
import React from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, ScrollView } from 'react-native';
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

const MAG_MIN = 3.0;
const MAG_MAX = 6.5;
const BRIGHT_MIN = 0.2;
const BRIGHT_MAX = 2.0;

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
  const isDark = theme?.isDark ?? true;
  const bgColor = theme?.cardBackground ?? (isDark ? '#1e293b' : '#ffffff');
  const textColor = theme?.text ?? (isDark ? '#f8fafc' : '#0f172a');
  const subTextColor = theme?.subText ?? (isDark ? '#94a3b8' : '#64748b');
  const borderColor = theme?.border ?? (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)');

  const layerItems: { key: keyof LayerState; label: string; icon: any; iconBg: string }[] = [
    { key: 'sun', label: '태양 (Sun)', icon: <Sun size={18} color="#eab308" />, iconBg: 'rgba(234, 179, 8, 0.15)' },
    { key: 'moon', label: '달 (Moon)', icon: <Moon size={18} color="#38bdf8" />, iconBg: 'rgba(56, 189, 248, 0.15)' },
    { key: 'stars', label: '별 (Stars)', icon: <Sparkles size={18} color="#a78bfa" />, iconBg: 'rgba(167, 139, 250, 0.15)' },
    { key: 'milkyway', label: '은하수 (Milky Way)', icon: <Milestone size={18} color="#c4b5fd" />, iconBg: 'rgba(196, 181, 253, 0.15)' },
    { key: 'planets', label: '행성 (Planets)', icon: <Star size={18} color="#f43f5e" />, iconBg: 'rgba(244, 63, 94, 0.15)' },
    { key: 'clouds', label: '구름 (Clouds)', icon: <Cloud size={18} color="#94a3b8" />, iconBg: 'rgba(148, 163, 184, 0.15)' },
    { key: 'paths', label: '궤적 & 그림자 (Paths)', icon: <Navigation size={18} color="#22c55e" />, iconBg: 'rgba(34, 197, 94, 0.15)' },
  ];

  const brightnessPct = ((skySettings.starBrightness - BRIGHT_MIN) / (BRIGHT_MAX - BRIGHT_MIN)) * 100;
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
          style={[
            styles.modalContainer,
            {
              backgroundColor: bgColor,
              borderColor: borderColor,
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: textColor }]}>3D 레이어 제어</Text>
            <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)' }]}>
              <X size={16} color={subTextColor} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.subTitle, { color: subTextColor }]}>
            화면에 표시할 요소 레이어를 자유롭게 선택하세요.
          </Text>

          <ScrollView style={styles.scrollList} showsVerticalScrollIndicator={false}>
            <View style={styles.list}>
              {layerItems.map((item) => {
                const isOn = layers[item.key];
                return (
                  <TouchableOpacity
                    key={item.key}
                    style={[
                      styles.layerRow,
                      {
                        borderColor: isOn ? '#3b82f6' : borderColor,
                        backgroundColor: isOn
                          ? (isDark ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.08)')
                          : (isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)'),
                      },
                    ]}
                    onPress={() => onToggleLayer(item.key)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.rowLeft}>
                      <View style={[styles.iconChip, { backgroundColor: item.iconBg }]}>
                        {item.icon}
                      </View>
                      <Text style={[styles.layerLabel, { color: textColor, fontWeight: isOn ? '700' : '500' }]}>
                        {item.label}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.togglePill,
                        isOn
                          ? styles.toggleOn
                          : { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)' },
                      ]}
                    >
                      <Text style={[styles.toggleText, { color: isOn ? '#ffffff' : subTextColor }]}>
                        {isOn ? 'ON' : 'OFF'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={[styles.divider, { backgroundColor: borderColor }]} />

            {/* 별 표현 슬라이더 */}
            <View style={styles.sliderBlock}>
              <View style={styles.sliderHeader}>
                <Text style={[styles.sliderLabel, { color: textColor }]}>별 밝기</Text>
                <Text style={[styles.sliderValue, { color: subTextColor }]}>
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
                <Text style={[styles.sliderLabel, { color: textColor }]}>한계 등급</Text>
                <Text style={[styles.sliderValue, { color: subTextColor }]}>
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
              <Text style={[styles.sliderHint, { color: subTextColor }]}>
                6.5등급이면 맨눈으로 볼 수 있는 8,355개 항성이 모두 표시됩니다.
              </Text>
            </View>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '85%',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 20,
  },
  subTitle: {
    fontSize: 12,
    marginTop: 4,
    marginBottom: 16,
    lineHeight: 16,
  },
  scrollList: {
    flexGrow: 0,
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
    borderRadius: 14,
    borderWidth: 1,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconChip: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  layerLabel: {
    fontSize: 13,
  },
  togglePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  toggleOn: {
    backgroundColor: '#3b82f6',
  },
  toggleText: {
    fontSize: 11,
    fontWeight: '800',
  },
  divider: {
    height: 1,
    marginTop: 18,
    marginBottom: 12,
    opacity: 0.6,
  },
  sliderBlock: {
    marginTop: 8,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  sliderLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  sliderValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  sliderHint: {
    fontSize: 11,
    marginTop: 4,
    lineHeight: 15,
  },
});
