/**
 * LayerControlModal.tsx
 * 
 * 3D 시뮬레이션 뷰의 천체 및 환경 레이어(해, 달, 별, 행성, 구름, 궤적/그림자)를
 * 각각 ON/OFF 선택할 수 있는 레이어 조종 팝업 컴포넌트.
 */
import React from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity } from 'react-native';
import { LayerState } from '../SkyScene3D/SkyScene3D';
import { Sun, Moon, Sparkles, Star, Cloud, Navigation, X } from 'lucide-react-native';

interface LayerControlModalProps {
  visible: boolean;
  onClose: () => void;
  layers: LayerState;
  onToggleLayer: (key: keyof LayerState) => void;
  theme: any;
}

export const LayerControlModal: React.FC<LayerControlModalProps> = ({
  visible,
  onClose,
  layers,
  onToggleLayer,
  theme,
}) => {
  const layerItems: { key: keyof LayerState; label: string; icon: any }[] = [
    { key: 'sun', label: '태양 (Sun)', icon: <Sun size={18} color="#eab308" /> },
    { key: 'moon', label: '달 (Moon)', icon: <Moon size={18} color="#38bdf8" /> },
    { key: 'stars', label: '별 & 은하수 (Stars)', icon: <Sparkles size={18} color="#a78bfa" /> },
    { key: 'planets', label: '행성 (Planets)', icon: <Star size={18} color="#f43f5e" /> },
    { key: 'clouds', label: '구름 (Clouds)', icon: <Cloud size={18} color="#94a3b8" /> },
    { key: 'paths', label: '궤적 & 그림자 (Paths)', icon: <Navigation size={18} color="#22c55e" /> },
  ];

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
});
