import { useState } from 'react';

import type { TimerMode } from './useTimer';

type StartSessionFn = (mode: TimerMode, taskId: string | null) => void;

/** Shared between Home and Tasks: tapping a task's play button opens a small
 *  "start with..." picker instead of silently using whatever mode happens to
 *  be toggled. Spread `pickerProps` onto <StartModePicker />. Needs the
 *  title alongside the id purely for display in the picker sheet before the
 *  session actually starts.
 *
 *  `attachTask` changes what the play button means while a focus session is
 *  already running: there is nothing to start, so the tap points the running
 *  pomodoro at that task instead, banking the time spent on the previous one.
 *  This mirrors the extension, whose handleStartTimer attaches rather than
 *  restarting when a pomodoro is active. Pass null whenever attaching isn't
 *  possible (idle, paused, or on a break) and the picker opens as usual —
 *  keeping that decision with the caller, which is the one holding the timer
 *  state. */
export function useStartPicker(startSession: StartSessionFn, attachTask?: ((taskId: string) => void) | null) {
  const [pending, setPending] = useState<{ taskId: string | null; title: string | null } | null>(null);

  function requestStart(taskId: string | null, title: string | null): void {
    // No taskId means "start something unattached", which is a start even
    // when a session is running — fall through to the picker.
    if (attachTask && taskId) {
      attachTask(taskId);
      return;
    }
    setPending({ taskId, title });
  }

  function pick(mode: TimerMode): void {
    if (!pending) return;
    startSession(mode, pending.taskId);
    setPending(null);
  }

  function cancel(): void {
    setPending(null);
  }

  return {
    requestStart,
    pickerProps: { visible: pending !== null, taskTitle: pending?.title ?? null, onPick: pick, onCancel: cancel },
  };
}
