import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar';
import {
  durationLabel,
  isAllDayMeetingTime,
  nextTrackMode,
  parseMeetingTime,
  updateMeeting,
  useMeetings,
  type TodayMeeting,
} from '@/hooks/useMeetings';
import { useProjects } from '@/hooks/useProjects';
import { useSettings } from '@/hooks/useSettings';
import { useTimer } from '@/hooks/useTimer';
import { useTodayDate } from '@/hooks/useTodayDate';

// Ports the extension's Schedule tab (HomeState.tsx's ScheduleContent and
// MeetingCard): every meeting today, tracked or not, with the same badge to
// choose which ones show on Home (Off → Today only → Always), a Start that
// runs a stopwatch on the meeting, and Log for the ones already over.

const TRACK_LABEL = { off: '+ Track', once: 'Today', always: 'Always' } as const;

export default function ScheduleScreen(): React.JSX.Element {
  useTodayDate(); // re-renders at midnight, so "today" moves on
  const { meetings } = useMeetings({ tracked: false });
  const { projects } = useProjects();
  const { settings, update } = useSettings();
  const { display, startSession } = useTimer();
  // Connected for the active workspace; meetings synced from another device
  // still show without it.
  const { connection, loading } = useGoogleCalendar();
  const connected = connection !== null;

  const today = new Date();
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const startingSoon = meetings.find(m => m.minutesUntil !== null && m.minutesUntil <= 30);

  function start(m: TodayMeeting): void {
    if (display.status !== 'idle') {
      Alert.alert('A session is running', 'Stop the current session before starting this meeting.');
      return;
    }
    void startSession('stopwatch', m.id).then(() => {
      // Same as the extension: starting a meeting logs its scheduled length;
      // the detail screen corrects it.
      updateMeeting(m.id, { logged: true, loggedMinutes: m.durationMinutes });
      router.navigate('/');
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.dateStrip}>
          <Text style={styles.dateLabel}>Today · {dayName}</Text>
          <Text style={styles.date}>{dateStr}</Text>
        </View>

        {startingSoon && (
          <View style={styles.soon}>
            <Text style={styles.soonIcon}>🔔</Text>
            <View style={styles.soonBody}>
              <Text style={styles.soonLabel}>
                Starting in {startingSoon.minutesUntil} minute{startingSoon.minutesUntil === 1 ? '' : 's'}
              </Text>
              <Text style={styles.soonTitle} numberOfLines={1}>{startingSoon.title || 'Meeting'}</Text>
            </View>
            <Pressable style={styles.soonBtn} onPress={() => start(startingSoon)}>
              <Text style={styles.soonBtnText}>▶ Track</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>Today&apos;s meetings · {meetings.length}</Text>
          <View style={styles.sectionActions}>
            <Pressable onPress={() => router.push('/calendar')} hitSlop={8} accessibilityLabel="Calendar settings">
              <Ionicons name="settings-outline" size={16} color={colors.textTertiary} />
            </Pressable>
            <Pressable
              style={[styles.pill, settings.showMeetingsInToday && styles.pillOn]}
              onPress={() => update('showMeetingsInToday', !settings.showMeetingsInToday)}
            >
              <Text style={[styles.pillText, settings.showMeetingsInToday && styles.pillTextOn]}>
                📌 {settings.showMeetingsInToday ? 'In Today' : 'Show in Today'}
              </Text>
            </Pressable>
          </View>
        </View>

        {!loading && !connected && meetings.length === 0 && (
          <View style={styles.cta}>
            <Text style={styles.ctaText}>Connect Google Calendar to see today&apos;s meetings here.</Text>
            <Pressable style={styles.ctaBtn} onPress={() => router.push('/calendar')}>
              <Text style={styles.ctaBtnText}>Connect Calendar →</Text>
            </Pressable>
          </View>
        )}

        {connected && meetings.length === 0 && <Text style={styles.empty}>No meetings today.</Text>}

        {meetings.map(m => {
          const project = m.projectId ? projects.find(p => p.id === m.projectId) : undefined;
          const allDay = isAllDayMeetingTime(m.time);
          return (
            <View key={m.id} style={styles.item}>
              <Text style={styles.time}>
                {allDay ? 'All day' : parseMeetingTime(m.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </Text>
              <Pressable style={[styles.card, m.past && styles.cardPast]} onPress={() => router.push(`/meeting/${m.id}`)}>
                <View style={styles.titleRow}>
                  <View style={[styles.dot, { backgroundColor: m.calendarColor ?? colors.textTertiary }]} />
                  <Text style={styles.title} numberOfLines={1}>{m.title || 'Meeting'}</Text>
                  {!m.past && (
                    <Pressable
                      onPress={() => updateMeeting(m.id, { trackMode: nextTrackMode(m.trackMode) })}
                      hitSlop={6}
                      style={[styles.badge, m.trackMode === 'always' && styles.badgeAlways, m.trackMode === 'once' && styles.badgeOnce]}
                      accessibilityLabel={`Tracking: ${TRACK_LABEL[m.trackMode]}`}
                    >
                      <Text style={[styles.badgeText, m.trackMode === 'always' && styles.badgeTextAlways, m.trackMode === 'once' && styles.badgeTextOnce]}>
                        {TRACK_LABEL[m.trackMode]}
                      </Text>
                    </Pressable>
                  )}
                  <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
                </View>
                {project && (
                  <View style={styles.projectRow}>
                    <View style={[styles.projectDot, { backgroundColor: project.color }]} />
                    <Text style={styles.meta}>{project.name}</Text>
                  </View>
                )}
                <View style={styles.metaRow}>
                  <Text style={styles.meta}>
                    {durationLabel(m.durationMinutes)}
                    {m.past && m.logged && m.loggedMinutes != null
                      ? ` · tracked ${m.loggedMinutes}m`
                      : m.minutesUntil !== null
                        ? ` · in ${m.minutesUntil}m`
                        : m.recurringLabel
                          ? ` · ${m.recurringLabel}`
                          : ''}
                  </Text>
                  {m.past && m.logged ? (
                    <Text style={styles.logged}>✓ Logged</Text>
                  ) : m.past ? (
                    <Pressable style={styles.action} onPress={() => router.push(`/meeting/${m.id}`)}>
                      <Text style={styles.actionText}>Log</Text>
                    </Pressable>
                  ) : (
                    <Pressable style={[styles.action, styles.actionStart]} onPress={() => start(m)}>
                      <Text style={[styles.actionText, styles.actionStartText]}>▶ Start</Text>
                    </Pressable>
                  )}
                </View>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 20, paddingBottom: 40 },
  dateStrip: { alignItems: 'center', marginBottom: 16 },
  dateLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textTertiary, marginBottom: 2 },
  date: { fontSize: 18, fontWeight: '700', color: colors.text },
  soon: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.accentSoft, borderRadius: 12, padding: 12, marginBottom: 16 },
  soonIcon: { fontSize: 18 },
  soonBody: { flex: 1 },
  soonLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', color: colors.accent, letterSpacing: 0.4 },
  soonTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  soonBtn: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  soonBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textTertiary },
  sectionActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill: { borderWidth: 1, borderColor: colors.border, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  pillOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentSoft },
  pillText: { fontSize: 12, color: colors.textSecondary },
  pillTextOn: { color: colors.accent, fontWeight: '600' },
  cta: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 16, gap: 10, alignItems: 'flex-start' },
  ctaText: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  ctaBtn: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  ctaBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  empty: { fontSize: 14, color: colors.textTertiary, textAlign: 'center', marginTop: 24 },
  item: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  time: { width: 62, fontSize: 12, color: colors.textTertiary, paddingTop: 12, textAlign: 'right' },
  card: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, gap: 4 },
  cardPast: { opacity: 0.6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.text },
  badge: { borderWidth: 1, borderColor: colors.border, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  badgeOnce: { backgroundColor: colors.infoSoft, borderColor: colors.infoSoft },
  badgeAlways: { backgroundColor: colors.accentSoft, borderColor: colors.accentSoft },
  badgeText: { fontSize: 11, color: colors.textTertiary, fontWeight: '600' },
  badgeTextOnce: { color: colors.info },
  badgeTextAlways: { color: colors.accent },
  projectRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 16 },
  projectDot: { width: 7, height: 7, borderRadius: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16 },
  meta: { fontSize: 12, color: colors.textSecondary },
  logged: { fontSize: 12, color: colors.success, fontWeight: '600' },
  action: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  actionText: { fontSize: 12, fontWeight: '600', color: colors.text },
  actionStart: { backgroundColor: colors.successSoft, borderColor: colors.successSoft },
  actionStartText: { color: colors.success },
});
