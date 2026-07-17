import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { X, Sunrise, Sunset, Calendar, PlayCircle, Sun } from 'lucide-react-native';
import { t } from '../../utils/i18n';
import { useCelestialStore } from '../../store/useCelestialStore';

interface IsolineGuideModalProps {
  visible: boolean;
  onClose: () => void;
  theme: any;
}

export const IsolineGuideModal: React.FC<IsolineGuideModalProps> = ({ visible, onClose, theme }) => {
  const { language } = useCelestialStore();

  const items = [
    { icon: <Sunrise size={16} color="#FFA500" />, text: t('isolineGuideSunrise', language) },
    { icon: <Sunset size={16} color="#FF4500" />, text: t('isolineGuideSunset', language) },
    { icon: <Calendar size={16} color={theme.accent} />, text: t('isolineGuideSeason', language) },
    { icon: <PlayCircle size={16} color={theme.accent} />, text: t('isolineGuideAutoplay', language) },
    { icon: <Sun size={16} color="#FFD700" />, text: t('isolineGuideSun', language) },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>{t('isolineGuideTitle', language)}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={20} color={theme.subText} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
            <Text style={[styles.intro, { color: theme.text }]}>{t('isolineGuideIntro', language)}</Text>

            <View style={{ gap: 14, marginTop: 16 }}>
              {items.map((item, i) => (
                <View key={i} style={styles.itemRow}>
                  <View style={[styles.itemIcon, { backgroundColor: theme.glass }]}>{item.icon}</View>
                  <Text style={[styles.itemText, { color: theme.subText }]}>{item.text}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 28,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    padding: 22,
    elevation: Platform.OS === 'android' ? 24 : 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
    flex: 1,
    paddingRight: 12,
  },
  closeBtn: {
    padding: 4,
  },
  intro: {
    fontSize: 13,
    lineHeight: 20,
    opacity: 0.9,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  itemIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    paddingTop: 4,
  },
});
