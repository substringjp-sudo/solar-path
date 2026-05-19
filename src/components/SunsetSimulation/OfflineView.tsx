import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { WifiOff } from 'lucide-react-native';

export interface OfflineViewProps {
  theme: any;
}

export const OfflineView: React.FC<OfflineViewProps> = ({ theme }) => {
  return (
    <View style={[styles.offlineContainer, { backgroundColor: theme.background }]}>
      <View style={[styles.offlineIconBg, { backgroundColor: theme.glass, borderColor: theme.border }]}>
        <WifiOff size={32} color={theme.accent} />
      </View>
      <Text style={[styles.offlineTitle, { color: theme.text }]}>Offline Mode</Text>
      <Text style={[styles.offlineText, { color: theme.subText }]}>
        You are currently offline. An internet connection is required to fetch weather and terrain data.
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
