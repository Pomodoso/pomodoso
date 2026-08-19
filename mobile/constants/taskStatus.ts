// Mirrors extension/src/db.ts's TaskStatus and the mappings in
// extension/src/popup/HomeState.tsx (STATUS_OPTIONS/STATUS_DOT_COLOR), so
// mobile's status picker matches the extension's semantics and coloring.
import type { TaskStatus } from '@/db/schema';

import { colors } from './theme';

export const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const STATUS_LABEL: Record<TaskStatus, string> = Object.fromEntries(
  STATUS_OPTIONS.map(o => [o.value, o.label]),
) as Record<TaskStatus, string>;

export const STATUS_DOT_COLOR: Record<TaskStatus, string> = {
  todo: colors.borderStrong,
  in_progress: colors.warning,
  done: colors.success,
  delayed: colors.delayed,
  cancelled: colors.textTertiary,
};

// done/cancelled are "resolved" — struck through, and the reason a task can
// disappear from active lists. todo/in_progress/delayed are still "active".
export function isResolvedStatus(status: TaskStatus): boolean {
  return status === 'done' || status === 'cancelled';
}

// Extension's HomeState.tsx keeps a resolved task visible in Today for the
// rest of the calendar day it was resolved on (compares updatedAt's local
// date to today's), then it rolls off the next day. Same rule here.
export function isUpdatedToday(updatedAt: string): boolean {
  return new Date(updatedAt).toLocaleDateString('en-CA') === new Date().toLocaleDateString('en-CA');
}
