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
  projectColor?: string | null;
  onPress?: () => void;
  onPlayPress?: () => void;
  onStatusPress?: () => void;
}

export function TaskRow({ title, ticket, meta, status, projectColor, onPress, onPlayPress, onStatusPress }: TaskRowProps) {
  const resolved = isResolvedStatus(status);
  const dotColor = STATUS_DOT_COLOR[status];

  return (
    <View style={[styles.row, projectColor && { borderLeftWidth: 3, borderLeftColor: projectColor, paddingLeft: 9 }]}>
      <Pressable
        style={[styles.statusDot, { borderColor: dotColor }, status !== 'todo' && { backgroundColor: dotColor }]}
        onPress={onStatusPress}
        hitSlop={8}
      >
        {status === 'done' && <Ionicons name="checkmark" size={13} color={colors.surface} />}
        {status === 'cancelled' && <Ionicons name="close" size={13} color={colors.surface} />}
      </Pressable>
      <Pressable style={styles.body} onPress={onPress} disabled={!onPress}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, resolved && styles.titleDone]} numberOfLines={2}>
            {title}
          </Text>
          {projectColor && <View style={[styles.projectDot, { backgroundColor: projectColor }]} />}
        </View>
        <View style={styles.metaRow}>
          {ticket && (
            <View style={styles.ticketPill}>
              <Text style={styles.ticketPillText}>{ticket}</Text>
            </View>
          )}
          <Text style={styles.meta}>{meta}</Text>
        </View>
      </Pressable>
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  title: { flexShrink: 1, fontSize: 14.5, fontWeight: '500', color: colors.text },
  titleDone: { textDecorationLine: 'line-through', color: colors.textTertiary },
  projectDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
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
