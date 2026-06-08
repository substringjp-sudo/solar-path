import React from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, Linking } from 'react-native';
import { ExternalLink } from 'lucide-react-native';
import { useCelestialStore } from '../../store/useCelestialStore';
import { t } from '../../utils/i18n';

export interface SourceInfoModalProps {
  visible: boolean;
  onClose: () => void;
  theme: any;
  weatherSource?: 'ultra-short' | 'open-meteo' | string;
}

export const SourceInfoModal: React.FC<SourceInfoModalProps> = ({
  visible,
  onClose,
  theme,
  weatherSource,
}) => {
  const { language } = useCelestialStore();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{t('dataSourceInfo', language)}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={[styles.closeText, { color: theme.accent }]}>{t('close', language)}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.sourceList}>
            <View style={styles.sourceSection}>
              <Text style={[styles.sourceCategory, { color: theme.accent }]}>{t('geospatial', language)}</Text>
              <TouchableOpacity 
                style={styles.sourceItem}
                onPress={() => Linking.openURL('https://open-meteo.com/en/docs/elevation-api')}
              >
                <View style={styles.sourceContent}>
                  <Text style={[styles.sourceLabel, { color: theme.text }]}>{t('digitalElevationModel', language)}</Text>
                  <Text style={[styles.sourceDesc, { color: theme.subText }]}>{t('openMeteoElevationApi', language)}</Text>
                </View>
                <ExternalLink size={14} color={theme.subText} />
              </TouchableOpacity>
            </View>

            <View style={styles.sourceSection}>
              <Text style={[styles.sourceCategory, { color: theme.accent }]}>{t('meteorology', language)}</Text>
              <TouchableOpacity 
                style={styles.sourceItem}
                onPress={() => Linking.openURL('https://open-meteo.com/')}
              >
                <View style={styles.sourceContent}>
                  <Text style={[styles.sourceLabel, { color: theme.text }]}>{t('weatherCloudsForecast', language)}</Text>
                  <Text style={[styles.sourceDesc, { color: theme.subText }]}>
                    {weatherSource === 'ultra-short' ? t('kmaForecastApi', language) : t('openMeteoWeatherApi', language)}
                  </Text>
                </View>
                <ExternalLink size={14} color={theme.subText} />
              </TouchableOpacity>
            </View>

            <View style={styles.sourceSection}>
              <Text style={[styles.sourceCategory, { color: theme.accent }]}>{t('astronomy', language)}</Text>
              <View style={styles.sourceItemNonClickable}>
                <View style={styles.sourceContent}>
                  <Text style={[styles.sourceLabel, { color: theme.text }]}>{t('solarTrajectoryAzimuth', language)}</Text>
                  <Text style={[styles.sourceDesc, { color: theme.subText }]}>{t('suncalcLibrary', language)}</Text>
                </View>
              </View>
            </View>
          </View>

          <Text style={[styles.attribution, { color: theme.subText }]}>
            {t('weatherAttribution', language)}
          </Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  closeText: {
    fontWeight: '700',
  },
  sourceList: {
    gap: 16,
    marginBottom: 20,
  },
  sourceSection: {
    marginBottom: 20,
  },
  sourceCategory: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 8,
    opacity: 0.8,
  },
  sourceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  sourceItemNonClickable: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
  },
  sourceContent: {
    flex: 1,
  },
  sourceLabel: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  sourceDesc: {
    fontSize: 11,
    fontWeight: '500',
    opacity: 0.7,
  },
  attribution: {
    fontSize: 11,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
