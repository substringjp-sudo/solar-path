import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { LucideIcon } from 'lucide-react-native';

interface InfoCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
  theme: any;
}

export const InfoCard: React.FC<InfoCardProps> = ({ icon, label, value, subValue, theme }) => {
  const { width } = Dimensions.get('window');
  return (
    <View style={[styles.card, { width: width * 0.3 }]}>
      <View style={[styles.iconContainer, { backgroundColor: theme.glass }]}>
        {icon}
      </View>
      <View style={styles.content}>
        <Text style={[styles.label, { color: theme.subText }]} numberOfLines={1}>{label}</Text>
        <View style={styles.valueRow}>
          <Text style={[styles.value, { color: theme.text }]}>{value}</Text>
          {subValue && <Text style={[styles.subValue, { color: theme.subText }]}>{subValue}</Text>}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  label: {
    fontSize: 8,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  value: {
    fontSize: 13,
    fontWeight: '800',
  },
  subValue: {
    fontSize: 8,
    fontWeight: '600',
  },
});
