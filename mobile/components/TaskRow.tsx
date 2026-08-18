import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontMono } from '@/constants/theme';

interface TaskRowProps {
  title: string;
  ticket?: string;
  meta: string;
  done?: boolean;
  onPlayPress?: () => void;
}

export function TaskRow({ title, ticket, meta, done, onPlayPress }: TaskRowProps) {
  return (
    <View style={styles.row}>
      <View style={[styles.checkbox, done && styles.checkboxDone]}>
        {done && <Ionicons name="checkmark" size={13} color={colors.surface} />}
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>
          {title}
        </Text>
        <View style={styles.metaRow}>
          {ticket && (
            <View style={styles.ticketPill}>
              <Text style={styles.ticketPillText}>{ticket}</Text>
            </View>
          )}
          <Text style={styles.meta}>{meta}</Text>
        </View>
      </View>
      {onPlayPress && (
        <Pressable style={styles.playBtn} onPress={onPlayPress} hitSlop={8}>
          <Ionicons name="play" size={13} color={colors.accent} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  checkboxDone: {
    backgroundColor: colors.success,
    borderColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 14.5, fontWeight: '500', color: colors.text, marginBottom: 3 },
  titleDone: { textDecorationLine: 'line-through', color: colors.textTertiary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ticketPill: {
    backgroundColor: colors.infoSoft,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  ticketPillText: { fontFamily: fontMono, fontSize: 10.5, fontWeight: '700', color: colors.info },
  meta: { fontSize: 12, color: colors.textTertiary },
  playBtn: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
