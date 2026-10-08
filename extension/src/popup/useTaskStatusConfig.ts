import { createContext, useContext, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_TASK_STATUS_CONFIG, parseTaskStatusConfig, type TaskStatusConfig } from '@pomodoso/types';
import { db, now } from '../db';
import { triggerSync } from '../syncEngine';

// The user's task statuses (see @pomodoso/types task-status.ts). App reads the
// setting once and provides it; every row, picker and tooltip reads the context
// instead of opening its own live query.
export const TaskStatusConfigContext = createContext<TaskStatusConfig>(DEFAULT_TASK_STATUS_CONFIG);

export function useTaskStatusConfig(): TaskStatusConfig {
  return useContext(TaskStatusConfigContext);
}

/** App only — the single live query behind the context. */
export function useLiveTaskStatusConfig(): TaskStatusConfig {
  const row = useLiveQuery(() => db.settings.get('task_statuses'), []);
  return useMemo(() => parseTaskStatusConfig(row?.value), [row?.value]);
}

export async function saveTaskStatusConfig(config: TaskStatusConfig): Promise<void> {
  await db.settings.put({ key: 'task_statuses', value: config });
  await db.settings.put({ key: 'task_statuses_updated_at', value: now() });
  triggerSync();
}
