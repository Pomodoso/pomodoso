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

/**
 * Applies one edit to the stored config — the latest saved value, not the one
 * the caller rendered with. Edits land back to back (renaming commits on blur,
 * and the click that causes the blur is itself an edit), and building each
 * from the rendered value let the second overwrite the first. Dexie runs
 * read-write transactions on the same table one at a time, so each edit sees
 * the previous one. `edit` returns null to refuse.
 */
export async function updateTaskStatusConfig(
  edit: (current: TaskStatusConfig) => TaskStatusConfig | null,
): Promise<void> {
  let changed = false;
  await db.transaction('rw', db.settings, async () => {
    const current = parseTaskStatusConfig((await db.settings.get('task_statuses'))?.value);
    const next = edit(current);
    if (!next) return;
    await db.settings.put({ key: 'task_statuses', value: next });
    await db.settings.put({ key: 'task_statuses_updated_at', value: now() });
    changed = true;
  });
  if (changed) triggerSync();
}
