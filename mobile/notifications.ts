import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// M0 spike validated in PR #21: a locally-scheduled notification survives the
// app backgrounded/killed on a real device — that's the only reliable way to
// end a pomodoro session on mobile, since JS timers don't survive
// backgrounding. Sessions below always schedule against an absolute fire
// date, never a running countdown.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureNotificationPermission(): Promise<boolean> {
  // iOS requires explicit authorization for local notifications too, on
  // simulator and real devices alike — without it, scheduled notifications
  // are silently dropped, no error. Device.isDevice is only useful to know
  // whether push tokens will work (they won't on simulator), not to skip
  // this.
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'Pomodoso',
    importance: Notifications.AndroidImportance.HIGH,
  }).catch(err => {
    console.warn('Failed to create Android notification channel', err);
  });
}

/** Schedules a test notification `seconds` from now — mirrors how a real
 *  pomodoro/break end notification would be scheduled: computed once, at
 *  session start, as an absolute fire date, never a running countdown. */
export async function scheduleTestNotification(seconds: number): Promise<string> {
  const granted = await ensureNotificationPermission();
  if (!granted) throw new Error('Notification permission not granted');

  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Pomodoso — test notification',
      body: `Scheduled ${seconds}s ago. If you're reading this with the app backgrounded or killed, background delivery works.`,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      channelId: 'default',
    },
  });
}

/** Schedules the real end-of-session notification for an absolute fire date
 *  (a pomodoro's endsAt). Reschedule on resume-from-pause by cancelling the
 *  old id and calling this again with the new date. */
export async function scheduleSessionEndNotification(endsAt: Date, title: string, body: string): Promise<string | null> {
  const granted = await ensureNotificationPermission();
  if (!granted) return null;

  return Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: endsAt,
      channelId: 'default',
    },
  });
}

/** Returns whether the cancellation actually succeeded — callers that rely on
 *  it (e.g. cleaning up a losing race's orphaned notification) should warn
 *  rather than silently assume it worked, since a failure here means the
 *  notification is still live and will fire. Retries once after a short
 *  delay: most real cancellation failures are a transient OS hiccup, not a
 *  permanent one, and there's no other way to force-cancel a scheduled local
 *  notification if this gives up. */
export async function cancelScheduledNotification(id: string | null | undefined): Promise<boolean> {
  if (!id) return true;
  for (const delayMs of [0, 500]) {
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
      return true;
    } catch (err) {
      if (delayMs === 0) continue;
      console.warn('Failed to cancel scheduled notification after retry', id, err);
      return false;
    }
  }
  return false;
}
