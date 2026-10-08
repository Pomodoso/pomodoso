import type { TaskStatusOption } from '@pomodoso/types';
import { resolveTaskStatus, taskStatusOptions } from '@pomodoso/types';
import { useState } from 'react';

import type { TaskStatus } from '@/db/schema';

import { useSettings } from './useSettings';

type SetTaskStatusFn = (id: string, status: TaskStatus, statusId: string | null) => void;

/** Same request/pick/cancel pattern as useStartPicker.ts: tapping a task's
 *  status dot opens a small picker instead of cycling silently. Spread
 *  `pickerProps` onto <StatusPicker />. Options are the user's statuses
 *  (Settings → Task statuses), not the five defaults. */
export function useStatusPicker(setTaskStatus: SetTaskStatusFn) {
  const { settings } = useSettings();
  const [pending, setPending] = useState<{ id: string; title: string; current: TaskStatusOption } | null>(null);

  function requestStatus(id: string, title: string, status: TaskStatus, statusId: string | null): void {
    setPending({ id, title, current: resolveTaskStatus(status, statusId, settings.taskStatuses) });
  }

  function pick(option: TaskStatusOption): void {
    if (!pending) return;
    setTaskStatus(pending.id, option.base, option.statusId);
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
      options: taskStatusOptions(settings.taskStatuses),
      current: pending?.current ?? null,
      onPick: pick,
      onCancel: cancel,
    },
  };
}
