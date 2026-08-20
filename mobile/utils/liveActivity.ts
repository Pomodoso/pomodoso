import PomodoroActivity, { type PomodoroActivityProps } from '@/widgets/PomodoroActivity';

type ActivityHandle = ReturnType<typeof PomodoroActivity.start>;

let current: { sessionId: string; instance: ActivityHandle } | null = null;

// A Live Activity's own OS-level lifecycle is independent of this JS
// module's — an app kill+relaunch resets `current` to null while the
// activity itself (if the session is still active) survives on the Lock
// Screen/Dynamic Island. Adopt whatever's already running rather than
// blindly starting a second one on top of it.
function adoptExisting(sessionId: string): ActivityHandle | null {
  const instances = PomodoroActivity.getInstances();
  // Only one pomodoro session is ever active at a time (enforced by
  // useTimer's own atomic start guard), so at most one Live Activity should
  // exist. If more than one somehow does, don't guess which is "the" one —
  // fall through to starting fresh instead.
  if (instances.length !== 1) return null;
  current = { sessionId, instance: instances[0] };
  return instances[0];
}

// Single reconciliation entry point, called from one useEffect in
// useTimer.ts keyed on the active session's own fields — deliberately NOT
// scattered across startSession/pauseSession/resumeSession/stopSession as
// separate start/update/end calls. Fase B6b's calendar-toggle work found
// that pattern (state changes reflected from multiple independent call
// sites) is exactly what produces missed-update/out-of-sync bugs; deriving
// "what should be showing" from the session row on every relevant change
// and diffing against what this module already knows is showing avoids
// that whole category by construction, and also means an app kill mid-
// session self-heals on next launch via adoptExisting above rather than
// needing every mutation path to remember to call this.
export function syncPomodoroActivity(sessionId: string, props: PomodoroActivityProps): void {
  try {
    if (current?.sessionId === sessionId) {
      current.instance.update(props).catch(err => console.warn('[liveActivity] update failed', err));
      return;
    }
    // A different (or no) session than what this module last knew about —
    // end any stale activity before starting fresh, so a just-completed
    // session's Live Activity doesn't linger showing superseded content.
    if (current) {
      current.instance.end('immediate').catch(err => console.warn('[liveActivity] end-stale failed', err));
      current = null;
    }
    const adopted = adoptExisting(sessionId);
    if (adopted) {
      adopted.update(props).catch(err => console.warn('[liveActivity] adopt-update failed', err));
      return;
    }
    const instance = PomodoroActivity.start(props);
    current = { sessionId, instance };
  } catch (err) {
    // Live Activities can be unavailable for reasons entirely outside this
    // app's control (user disabled them in Settings, iOS <16, "Frequent
    // Updates" not granted) — never let that block the actual timer state
    // transition, same principle as useTimer.ts's tryScheduleNotification.
    console.warn('[liveActivity] sync failed', err);
  }
}

export function endPomodoroActivity(): void {
  if (current) {
    const { instance } = current;
    current = null;
    instance.end('immediate').catch(err => console.warn('[liveActivity] end failed', err));
    return;
  }
  // `current` being empty doesn't guarantee nothing's actually showing — a
  // fresh JS module state (app relaunch) has no memory of an activity this
  // process didn't itself start/adopt. In practice every path that flips a
  // session to completed/interrupted runs while `current` is already
  // populated (see syncPomodoroActivity's comment), so this is a defense-
  // in-depth fallback, not a load-bearing path — but it's cheap, so end
  // whatever the OS reports rather than leaving it to linger indefinitely.
  try {
    for (const instance of PomodoroActivity.getInstances()) {
      instance.end('immediate').catch(err => console.warn('[liveActivity] end-orphan failed', err));
    }
  } catch (err) {
    console.warn('[liveActivity] end-orphan lookup failed', err);
  }
}
