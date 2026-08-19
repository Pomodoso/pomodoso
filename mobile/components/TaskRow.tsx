import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { isResolvedStatus, STATUS_DOT_COLOR } from '@/constants/taskStatus';
import { colors, fontMono } from '@/constants/theme';
import type { TaskStatus } from '@/db/schema';

interface TaskRowProps {
  title: string;
  ticket?: string;
  meta: string;
  status: TaskStatus;
  onPlayPress?: () => void;
  onStatusPress?: () => void;
}

export function TaskRow({ title, ticket, meta, status, onPlayPress, onStatusPress }: TaskRowProps) {
  const resolved = isResolvedStatus(status);
  const dotColor = STATUS_DOT_COLOR[status];

  return (
    <View style={styles.row}>
      <Pressable
        style={[styles.statusDot, { borderColor: dotColor }, status !== 'todo' && { backgroundColor: dotColor }]}
        onPress={onStatusPress}
        hitSlop={8}
      >
        {status === 'done' && <Ionicons name="checkmark" size={13} color={colors.surface} />}
        {status === 'cancelled' && <Ionicons name="close" size={13} color={colors.surface} />}
      </Pressable>
      <View style={styles.body}>
        <Text style={[styles.title, resolved && styles.titleDone]} numberOfLines={2}>
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
  statusDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
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
