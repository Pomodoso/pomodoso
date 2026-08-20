import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { syncNow } from '@/utils/sync';

const TASK_NAME = 'pomodoso-background-sync';

// Defined at module scope so it's reached by the static import graph
// expo-router/entry evaluates on bundle load, not deferred to React mount —
// the OS can invoke this task in a headless JS context with no component
// tree mounted at all, so it can't live inside a hook or component.
TaskManager.defineTask(TASK_NAME, async () => {
  try {
    await syncNow();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (err) {
    console.warn('[sync] background task failed', err);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// Best-effort catch-up only, not a guaranteed cadence: iOS's Background
// Tasks API is unavailable on the simulator (physical device only) and both
// platforms treat minimumInterval as a floor, not a schedule — the OS picks
// actual timing based on battery, network, and usage patterns, and may skip
// runs entirely for a backgrounded/killed app. The real-time path is
// useSyncLifecycle's foreground triggers; this only helps data arrive
// slightly fresher the next time the app is opened after being away a
// while. syncNow() itself no-ops quietly if not signed in, so registration
// doesn't need to gate on auth state.
export async function registerBackgroundSync(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
  // 15 minutes is the floor Android's WorkManager enforces; passing anything
  // lower would just get clamped up to it.
  await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: 15 });
}
