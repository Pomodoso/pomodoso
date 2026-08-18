import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';

const ITEMS: { icon: ComponentProps<typeof Ionicons>['name']; label: string }[] = [
  { icon: 'person-outline', label: 'Account' },
  { icon: 'briefcase-outline', label: 'Workspace' },
  { icon: 'notifications-outline', label: 'Notifications' },
  { icon: 'cloud-outline', label: 'Data & sync' },
  { icon: 'log-out-outline', label: 'Sign out' },
];

export default function MoreScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.pageTitle}>More</Text>
      </View>
      <View style={styles.list}>
        {ITEMS.map(item => (
          <View key={item.label} style={styles.row}>
            <Ionicons name={item.icon} size={19} color={colors.textSecondary} />
            <Text style={styles.rowLabel}>{item.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </View>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingVertical: 10 },
  pageTitle: { fontSize: 24, fontWeight: '700', color: colors.text },
  list: { paddingHorizontal: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLabel: { flex: 1, fontSize: 14.5, fontWeight: '500', color: colors.text },
});
