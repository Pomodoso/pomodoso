import { useState } from 'react';

import type { TaskStatus } from '@/db/schema';

type SetTaskStatusFn = (id: string, status: TaskStatus) => void;

/** Same request/pick/cancel pattern as useStartPicker.ts: tapping a task's
 *  status dot opens a small picker instead of cycling silently. Spread
 *  `pickerProps` onto <StatusPicker />. */
export function useStatusPicker(setTaskStatus: SetTaskStatusFn) {
  const [pending, setPending] = useState<{ id: string; title: string; status: TaskStatus } | null>(null);

  function requestStatus(id: string, title: string, status: TaskStatus): void {
    setPending({ id, title, status });
  }

  function pick(status: TaskStatus): void {
    if (!pending) return;
    setTaskStatus(pending.id, status);
    setPending(null);
  }

  function cancel(): void {
    setPending(null);
  }

  return {
    requestStatus,
    pickerProps: {
      visible: pending !== null,
      taskTitle: pending?.title ?? null,
      currentStatus: pending?.status ?? null,
      onPick: pick,
      onCancel: cancel,
    },
  };
}
