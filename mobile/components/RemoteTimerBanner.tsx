import { Ionicons } from '@expo/vector-icons';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import { db } from '@/db/client';
import { settings } from '@/db/schema';

// "A timer is running somewhere else." Mirrors the extension's own
// RemoteTimerBanner rather than inventing a second idea of what a remote
// session looks like.
//
// Deliberately read-only. Taking over another device's session would need the
// server to arbitrate who owns it — sync is Last-Write-Wins per record, which
// is fine for a task and wrong for a running clock, since two devices both
// "winning" would produce two divergent elapsed times for one session.

const REMOTE_TIMER_KEY = 'active_timer_remote';

interface Beacon {
  started_at?: string;
  mode?: string;
  duration_seconds?: number | null;
  updated_at?: string;
}

/** Beacons are retracted on stop, but a device that dies mid-session never
 *  sends that retraction. Rather than show a clock counting up forever,
 *  anything older than this is treated as abandoned. Generous enough not to
 *  hide a long stopwatch session someone is genuinely running. */
const STALE_AFTER_MS = 4 * 60 * 60 * 1000;

function elapsed(startedAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function remaining(startedAt: string, durationSeconds: number): string {
  const left = Math.max(0, durationSeconds - Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function RemoteTimerBanner(): React.JSX.Element | null {
  const { data: rows } = useLiveQuery(db.select().from(settings).where(eq(settings.key, REMOTE_TIMER_KEY)));

  // The clock has to move on its own — nothing in the database changes
  // between beacons, so a live query alone would leave it frozen.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const raw = rows?.[0]?.value;
  if (!raw) return null;

  let beacon: Beacon;
  try {
    beacon = JSON.parse(raw) as Beacon;
  } catch {
    return null;
  }
  if (!beacon.started_at) return null;
  if (Date.now() - new Date(beacon.started_at).getTime() > STALE_AFTER_MS) return null;

  const isPomodoro = beacon.mode === 'pomodoro' && typeof beacon.duration_seconds === 'number';
  const clock = isPomodoro
    ? remaining(beacon.started_at, beacon.duration_seconds as number)
    : elapsed(beacon.started_at);

  return (
    <View style={styles.banner}>
      <Ionicons name="phone-portrait-outline" size={14} color={colors.info} />
      <Text style={styles.label}>Running on another device</Text>
      <Text style={styles.clock}>{clock}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.infoSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 12,
  },
  label: { flex: 1, fontSize: 12.5, color: colors.textSecondary },
  clock: { fontSize: 13, fontWeight: '700', color: colors.info, fontVariant: ['tabular-nums'] },
});
