import React from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, Platform } from 'react-native';
import { X, Sunrise, Sunset, Calendar, PlayCircle, Sun } from 'lucide-react-native';
import { t } from '../../utils/i18n';
import { useCelestialStore } from '../../store/useCelestialStore';
import { color, radius, mono, dataColor } from '../../theme/tokens';
import { PressScale } from '../ui';
import { makeStyles, useThemeColors, useDataColors } from '../../theme/useTheme';

interface IsolineGuideModalProps {
  visible: boolean;
  onClose: () => void;
  theme: any;
}

export const IsolineGuideModal: React.FC<IsolineGuideModalProps> = ({ visible, onClose, theme }) => {
  const color = useThemeColors(); const dataColor = useDataColors(); const styles = useStyles();
  const { language } = useCelestialStore();

  const items = [
    { icon: <Sunrise size={16} color={dataColor.sunrise} />, text: t('isolineGuideSunrise', language) },
    { icon: <Sunset size={16} color={color.glow} />, text: t('isolineGuideSunset', language) },
    { icon: <Calendar size={16} color={theme.accent} />, text: t('isolineGuideSeason', language) },
    { icon: <PlayCircle size={16} color={theme.accent} />, text: t('isolineGuideAutoplay', language) },
    { icon: <Sun size={16} color={color.sun} />, text: t('isolineGuideSun', language) },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <PressScale style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>{t('isolineGuideTitle', language)}</Text>
            <PressScale onPress={onClose} style={styles.closeBtn}>
              <X size={20} color={theme.subText} />
            </PressScale>
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

const useStyles = makeStyles((color) => ({
  overlay: {
    flex: 1,
    backgroundColor: color.scrim,
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
    fontSize: 22,
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
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    paddingTop: 4,
  },
}));
