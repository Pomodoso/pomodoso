import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { TIMER_STATUS_DATA_TYPE } from '@/utils/ongoingNotification';

// M0 spike validated in PR #21: a locally-scheduled notification survives the
// app backgrounded/killed on a real device — that's the only reliable way to
// end a pomodoro session on mobile, since JS timers don't survive
// backgrounding. Sessions below always schedule against an absolute fire
// date, never a running countdown.

Notifications.setNotificationHandler({
  handleNotification: async notification => {
    // The Android ongoing timer notification (utils/ongoingNotification.ts)
    // is re-posted on every pause/resume/kind change. Without this it would
    // pop a banner and play a sound each time, which is the opposite of what
    // a passive status display should do. It still belongs in the shade.
    const isTimerStatus = notification.request.content.data?.type === TIMER_STATUS_DATA_TYPE;
    return {
      shouldShowBanner: !isTimerStatus,
      shouldShowList: true,
      shouldPlaySound: !isTimerStatus,
      shouldSetBadge: false,
    };
  },
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

/** Clears end-of-session alerts already sitting in the shade, sparing the
 *  ongoing timer-status notification (identified by the same `data.type`
 *  marker its foreground handler uses above).
 *
 *  Called when a new session starts. Each session deliberately owns a unique
 *  notification id — `pomodoro_session.notification_id`, which pause/resume/
 *  stop cancel by — so alerts can't simply replace one another by sharing an
 *  identifier. Without this, a normal day of eight to twelve pomodoros leaves
 *  sixteen to twenty-four stale "complete" banners to dismiss by hand.
 *
 *  Best effort: failing to tidy the shade must never block a session start. */
export async function dismissDeliveredSessionAlerts(): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter(n => n.request.content.data?.type !== TIMER_STATUS_DATA_TYPE)
        .map(n => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch (err) {
    console.warn('Failed to clear delivered session alerts', err);
  }
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
