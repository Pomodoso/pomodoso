import { useEffect, useState } from 'react';
import {
  DEFAULT_TASK_STATUS_CONFIG,
  isBaseTaskStatus,
  parseTaskStatusConfig,
  resolveTaskStatus,
  type TaskStatusConfig,
} from '@pomodoso/types';
import { api } from './api.ts';

// The user's task statuses (see @pomodoso/types task-status.ts), fetched once
// per page load and shared by every component that shows a status. The web is
// read-only for statuses — they're edited in the extension or the app.
let pending: Promise<TaskStatusConfig> | null = null;

function load(): Promise<TaskStatusConfig> {
  pending ??= api
    .get<unknown>('/task-statuses')
    .then(parseTaskStatusConfig)
    .catch(() => {
      pending = null; // retry on the next mount rather than caching a failure
      return DEFAULT_TASK_STATUS_CONFIG;
    });
  return pending;
}

export function useTaskStatuses(): TaskStatusConfig {
  const [config, setConfig] = useState<TaskStatusConfig>(DEFAULT_TASK_STATUS_CONFIG);
  useEffect(() => {
    let alive = true;
    void load().then(c => { if (alive) setConfig(c); });
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
