import { useEffect, useState } from 'react';
import {
  DEFAULT_TASK_STATUS_CONFIG,
  isBaseTaskStatus,
  parseTaskStatusConfig,
  resolveTaskStatus,
  type TaskStatusConfig,
} from '@pomodoso/types';
import { api } from './api.ts';

// The user's task statuses (see @pomodoso/types task-status.ts). Fetched on
// mount rather than cached for the session: a module-level cache outlived a
// sign-out into another account and edits synced from other devices. Callers
// fetch once per view and pass the result down to their rows. The web is
// read-only for statuses — they're edited in the extension or the app.
export function useTaskStatuses(): TaskStatusConfig {
  const [config, setConfig] = useState<TaskStatusConfig>(DEFAULT_TASK_STATUS_CONFIG);
  useEffect(() => {
    let alive = true;
    api
      .get<unknown>('/task-statuses')
      .then(value => { if (alive) setConfig(parseTaskStatusConfig(value)); })
      .catch(() => { /* defaults: every task shows its built-in label */ });
    return () => { alive = false; };
  }, []);
  return config;
}

/** The custom label a task shows, or null when it shows its default status. */
export function customStatusLabel(
  status: string,
  statusId: string | null | undefined,
  config: TaskStatusConfig,
): string | null {
  if (!isBaseTaskStatus(status)) return null;
  const resolved = resolveTaskStatus(status, statusId, config);
  return resolved.statusId ? resolved.label : null;
}
