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
      <Text style={[styles.offlineTitle, { color: theme.text }]}>오프라인 상태</Text>
      <Text style={[styles.offlineText, { color: theme.subText }]}>
        현재 네트워크에 연결되어 있지 않습니다. 기상 및 고도 데이터 조회를 위해 인터넷 연결이 필요합니다.
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
