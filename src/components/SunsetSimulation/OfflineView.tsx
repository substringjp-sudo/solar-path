import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { WifiOff } from 'lucide-react-native';
import { useCelestialStore } from '../../store/useCelestialStore';
import { t } from '../../utils/i18n';

export interface OfflineViewProps {
  theme: any;
}

export const OfflineView: React.FC<OfflineViewProps> = ({ theme }) => {
  const { language } = useCelestialStore();

  return (
    <View style={[styles.offlineContainer, { backgroundColor: theme.background }]}>
      <View style={[styles.offlineIconBg, { backgroundColor: theme.glass, borderColor: theme.border }]}>
        <WifiOff size={32} color={theme.accent} />
      </View>
      <Text style={[styles.offlineTitle, { color: theme.text }]}>{t('offlineMode', language)}</Text>
      <Text style={[styles.offlineText, { color: theme.subText }]}>
        {t('offlineDesc', language)}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  offlineContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  offlineIconBg: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  offlineTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  offlineText: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
