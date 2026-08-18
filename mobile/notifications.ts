import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// M0 spike (docs/mobile-app-plan.md): validate that a locally-scheduled
// notification actually fires while the app is backgrounded/killed on a real
// device — that's the only reliable way to end a pomodoro session on mobile,
// since JS timers don't survive backgrounding. Foreground behavior below just
// makes testing convenient; the thing that actually matters is background
// delivery, which needs a physical device or simulator to verify by hand.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) {
    // Simulators/emulators can still schedule and receive local notifications,
    // but permission prompts are unreliable there — assume granted and let the
    // schedule call itself fail loudly if it isn't.
    return true;
  }

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

if (Platform.OS === 'android') {
  void Notifications.setNotificationChannelAsync('default', {
    name: 'Pomodoso',
    importance: Notifications.AndroidImportance.HIGH,
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
    },
  });
}
