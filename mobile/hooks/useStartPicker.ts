import { useState } from 'react';

import type { TimerMode } from './useTimer';

type StartSessionFn = (mode: TimerMode, taskId: string | null) => void;

/** Shared between Home and Tasks: tapping a task's play button opens a small
 *  "start with..." picker instead of silently using whatever mode happens to
 *  be toggled. Spread `pickerProps` onto <StartModePicker />. Needs the
 *  title alongside the id purely for display in the picker sheet before the
 *  session actually starts. */
export function useStartPicker(startSession: StartSessionFn) {
  const [pending, setPending] = useState<{ taskId: string | null; title: string | null } | null>(null);

  function requestStart(taskId: string | null, title: string | null): void {
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
