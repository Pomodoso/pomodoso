import { useState } from 'react';

import type { TimerMode } from './useTimer';

type StartSessionFn = (mode: TimerMode, taskTitle: string | null, ticketRef: string | null) => void;

/** Shared between Home and Tasks: tapping a task's play button opens a small
 *  "start with..." picker instead of silently using whatever mode happens to
 *  be toggled. Spread `pickerProps` onto <StartModePicker />. */
export function useStartPicker(startSession: StartSessionFn) {
  const [pending, setPending] = useState<{ title: string | null; ticket: string | null } | null>(null);

  function requestStart(title: string | null, ticket: string | null): void {
    setPending({ title, ticket });
  }

  function pick(mode: TimerMode): void {
    if (!pending) return;
    startSession(mode, pending.title, pending.ticket);
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
